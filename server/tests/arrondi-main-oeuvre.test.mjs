// Lot AB : coût de la main-d'œuvre arrondi au centime ligne par ligne, partout (réponse de Nelson du 24-11-2026 à 14:24:51
// UTC, point 2, mot pour mot : « Arrindir chaque ligne », à la question du 23-11-2026 : « Quelle convention retenir partout ?
// 1. Arrondir chaque ligne au centime, puis additionner (132,47 €). 2. Additionner les montants exacts, puis arrondir le total
// (132,48 €). » ; lecture retenue : la réponse 1, pour tout coût de main-d'œuvre, heures × taux horaire chargé figé sur la
// ligne). Cadrage v2 du lot AB, après le contrôle de cohérence de mode 1 sur a7c7b79 (sections « Ce qui change », « Lectures
// retenues » et « Tests »), et son complément (N6 du contrôle de mode 2 de #675). Règle 2 de la méthode : le lot change des
// montants (classé C) ; sa fusion ne vaut pas validation comptable (Nelson et le cabinet).
//
// Ce que le lot change côté serveur, et que ce fichier prouve par des requêtes HTTP réelles sur une base PostgreSQL jetable :
//  - le coût de chaque ligne de main-d'œuvre (un pointage, une heure d'intervention : lecture L2) est arrondi au centime,
//    moitié vers le haut (lecture L1), avant d'être additionné, dans les trois boucles du coût d'un chantier : pointages,
//    intervention issue du devis et suites (chantiers/suivi.ts, cadrage v2, point 2) ;
//  - donc dans tout ce qui en dérive (point 5) : fiche (GET /api/chantiers/:id), liste (GET /api/chantiers), API
//    d'intégration (GET /api/v1/chantiers), statistiques des conducteurs, détail des commerciaux et tableau de bord
//    (GET /api/stats/commerciaux, /api/stats/global), répartition des chantiers terminés, alertes et marges ;
//  - le coût par intervenant (GET /api/stats/intervenants, point 4) ;
//  - le coût horaire moyen de la société, somme des coûts arrondis par ligne rapportée aux heures (point 3, lecture L4) ;
//  - la main-d'œuvre cumulée d'une intervention, déjà arrondie ligne par ligne, ne change pas : elle devient égale à la part de
//    son intervention dans la marge du chantier (lecture L2).
// La fonction commune (coutLigneHeuresAuCentime, commun/montants.ts) est jouée directement dans validation.test.mjs.
//
// Montants : le jeu du cadrage v2 sépare toutes les lectures. 3,25 h et 0,25 h à 37,85 €/h, puis trois fois 0,25 h à
// 10,02 €/h (taux de la fiche changé entre les saisies : le taux reste figé sur chaque ligne) :
//  - attendu 140,00 € : 123,01 + 9,46 + 3 × 2,51 (3,25 × 37,85 = 123,0125 ; 0,25 × 37,85 = 9,4625 ; 0,25 × 10,02 = 2,505) ;
//  - somme exacte, arrondie ou tronquée (le calcul d'avant le lot), ou total d'un groupe arrondi (par intervenant, par jour,
//    par intervention : les cinq lignes ont le même intervenant, le même jour et la même affaire) : 139,99 € ;
//  - arrondi au pair, troncature ou moitié vers le bas, par ligne : 123,01 + 9,46 + 3 × 2,50 = 139,97 € ;
//  - arrondi par excès, par ligne : 123,02 + 9,47 + 3 × 2,51 = 140,02 € ;
//  - marge pour un vendu de 1 000 € : 860,00 € (lectures écartées : 860,01 €, 860,03 €, 859,98 €).
// Chaque attendu écrit en commentaire la lecture qu'il écarte.
//
// Fichier propre au lot, avec sa base jetable (modèle : heures-quart-heure.test.mjs, lot W) : `node --test` exécute les fichiers
// en parallèle, et api.test.mjs purge les données « TEST » de TEST_DATABASE_URL ; surtout, le coût horaire moyen de la société
// se calcule sur tous les pointages de la base, que seule une base propre au fichier permet de connaître. TEST_DATABASE_URL ne
// sert ici que de connexion administrative : une base neuve est créée, migrée, servie à l'application montée en mémoire, puis
// supprimée. Sans TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';

const TITRE = 'Lot AB : coût de la main-d’œuvre arrondi au centime ligne par ligne, partout (chantier, statistiques, API d’intégration)';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Jeu du cadrage v2 (« Tests »), dans l'ordre des saisies. `taux` : taux horaire chargé de la fiche au moment de la saisie,
// figé sur la ligne ; `cible` : intervention qui reçoit la ligne quand le jeu est réparti sur deux suites (section 3).
const JEU = [
  { heures: '3,25', taux: '37.85', cible: 0 },
  { heures: '0,25', taux: '37.85', cible: 1 },
  { heures: '0,25', taux: '10.02', cible: 0 },
  { heures: '0,25', taux: '10.02', cible: 1 },
  { heures: '0,25', taux: '10.02', cible: 1 },
];
const TAUX_FIGES = JEU.map((ligne) => ligne.taux);
// Taux posé sur la fiche après toutes les saisies (fiche modifiée après coup) : aucun coût ne doit bouger. Lecture écartée : le
// taux de la fiche réappliqué aux lignes (4,25 h × 52 € = 221,00 €).
const TAUX_APRES_COUP = '52';
// Exemple de Nelson (question du 23-11-2026) : 3,25 h puis 0,25 h à 37,85 €/h.
const EXEMPLE_NELSON = JEU.slice(0, 2);

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_arrondi_mo_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const cibleApplication = new URL(cible);
    cibleApplication.searchParams.set('connection_limit', '12');
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;

    let request; let app; let prisma; let appPrisma; let jwt; let Decimal;
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const comptes = {};
    const cles = {};
    let client = null;
    let rang = 0;
    const suffixe = () => `${Date.now()}-${(rang += 1)}`;
    const creerCompte = async (code, role, extra = {}) => {
      const s = suffixe();
      const compte = await prisma.user.create({ data: { email: `lotab.${code.toLowerCase()}.${s}@iris.test`, name: `TEST ${code} lot AB ${s}`, role, ...extra } });
      comptes[code] = { ...compte, auth: entete(jwt.sign({ id: compte.id }, process.env.JWT_SECRET)) };
      return comptes[code];
    };

    // --- Appels ---
    // Le corps est calculé par l'appelant, avant `request(app)` : une exception levée en le construisant laisserait ouvert le
    // serveur éphémère de supertest.
    const appeler = (methode, chemin, auth, corps) => {
      const requete = request(app)[methode](chemin);
      if (auth) requete.set(auth);
      return corps === undefined ? requete : requete.send(corps);
    };
    const ok = async (promesse, statut = 200) => {
      const res = await promesse;
      assert.equal(res.status, statut, `${res.req?.method} ${res.req?.path} : ${JSON.stringify(res.body)}`);
      return res.body;
    };
    const SA = () => comptes.SA.auth;

    // Jour civil de la société (fuseau par défaut, Europe/Paris) : des heures se déclarent une fois faites, au plus aujourd'hui.
    const jourIso = () => {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date());
      const v = (type) => parts.find((p) => p.type === type).value;
      return `${v('year')}-${v('month')}-${v('day')}`;
    };
    const enFrancais = (iso) => iso.split('-').reverse().join('-');

    // --- Données ---
    // Fiche d'intervenant créée par l'API, au premier taux du jeu ; reliée au compte d'un technicien si demandé (seul le
    // technicien affecté saisit ses heures d'intervention).
    const creerFiche = async (nom, taux = JEU[0].taux, technicien = null) => {
      const fiche = await ok(appeler('post', '/api/intervenants', SA(), { nom: `TEST Intervenant lot AB ${nom} ${suffixe()}`, role: 'Technicien', tauxHoraireCharge: taux }));
      if (technicien) await ok(appeler('put', `/api/intervenants/${fiche.id}/compte`, SA(), { userId: technicien.id }));
      return fiche;
    };
    // Taux de la fiche changé par l'administration (PUT /api/intervenants/:id) : il ne s'applique qu'aux saisies futures.
    const changerTaux = (fiche, taux) => ok(appeler('put', `/api/intervenants/${fiche.id}`, SA(), { tauxHoraireCharge: taux }));
    // Joue les lignes dans l'ordre : le taux de la fiche suit celui de la ligne, changé par l'API entre deux saisies.
    const jouer = async (fiche, lignes, saisir) => {
      let taux = lignes[0].taux;
      for (const [index, ligne] of lignes.entries()) {
        if (ligne.taux !== taux) { await changerTaux(fiche, ligne.taux); taux = ligne.taux; }
        await saisir(ligne, index);
      }
    };
    // Affaire de travaux posée en base, confiée au conducteur donné : vendu 1 000 €, sans matériel vendu, budget de
    // main-d'œuvre et heures vendues assez hauts pour ne déclencher aucune alerte de dépassement, sauf surcharge.
    const creerChantier = (nom, responsableId, extra = {}) => prisma.chantier.create({ data: {
      nom: `TEST Chantier lot AB ${nom} ${suffixe()}`, client: client.raisonSociale, clientId: client.id, dateDebut: new Date('2026-10-01T00:00:00Z'),
      budgetGlobalVendu: '1000', budgetMaterielVendu: '0', budgetMainOeuvreVendu: '500', heuresVendues: '20', responsableId, ...extra,
    } });
    // Pointage saisi par le conducteur titulaire (POST /api/heures) : le taux de la fiche est copié sur la ligne.
    const pointer = (auth, chantierId, fiche, nbrHeures) => ok(appeler('post', '/api/heures', auth, { chantierId, intervenantId: fiche.id, date: enFrancais(jourIso()), nbrHeures, commentaire: 'TEST pointage lot AB' }));
    // Heure d'intervention saisie par le technicien affecté (POST /api/interventions/:id/couts/heures).
    const heureIntervention = (technicien, interventionId, nbrHeures) => ok(appeler('post', `/api/interventions/${interventionId}/couts/heures`, technicien.auth, { date: enFrancais(jourIso()), nbrHeures, commentaire: 'TEST heure lot AB' }), 201);
    const affecter = (interventionId, technicien) => prisma.interventionAffectation.create({ data: { interventionId, intervenantId: technicien.fiche.id } });
    const curative = (titre, extra = {}) => ok(appeler('post', '/api/interventions', SA(), { clientId: client.id, titre: `TEST ${titre} lot AB ${suffixe()}`, ...extra }), 201);
    const suiteDe = (interventionId) => ok(appeler('post', `/api/interventions/${interventionId}/suites`, SA(), {}), 201);
    const creerTechnicien = async (code) => {
      const compte = await creerCompte(code, 'TECHNICIEN');
      compte.fiche = await creerFiche(code, JEU[0].taux, compte);
      return compte;
    };
    // Conducteur propre à un scénario, rattaché au responsable du fichier : ses statistiques ne portent que sur son affaire.
    const creerConducteur = (code) => creerCompte(code, 'CONDUCTEUR_TRAVAUX', { responsableHierarchiqueId: comptes.RESP.id });

    // --- Lectures ---
    const fiche = (id, auth = SA()) => ok(appeler('get', `/api/chantiers/${id}`, auth));
    const dansListe = async (chemin, auth, id) => {
      const liste = await ok(appeler('get', chemin, auth));
      const ligne = liste.find((c) => c.id === id);
      assert.ok(ligne, `${chemin} : chantier absent`);
      return ligne;
    };
    const coutsIntervention = (id) => ok(appeler('get', `/api/interventions/${id}/couts`, SA()));
    const ligneConducteur = async (auth, id) => {
      const liste = await ok(appeler('get', '/api/stats/conducteurs', auth));
      const ligne = liste.find((u) => u.id === id);
      assert.ok(ligne, 'conducteur absent des statistiques');
      return ligne;
    };
    const MONTANTS = ['heuresRealisees', 'moReel', 'totalDepenses', 'margeBrute', 'margeCommerciale', 'coutsSuites', 'coutsInterventionDevis'];
    const montantsDe = (metrics) => Object.fromEntries(MONTANTS.map((cle) => [cle, metrics[cle]]));
    // Mêmes montants sur la fiche et la liste (super administrateur) et sur l'API d'intégration (clé chantiers:read et
    // finances:read) : cadrage v2, point 5, « Dérivés, sans code propre ».
    const memesMontantsPartout = async (id, attendu, quoi) => {
      assert.deepEqual(montantsDe((await fiche(id)).metrics), attendu, `${quoi} : fiche`);
      assert.deepEqual(montantsDe((await dansListe('/api/chantiers', SA(), id)).metrics), attendu, `${quoi} : liste`);
      assert.deepEqual(montantsDe((await dansListe('/api/v1/chantiers', cles.finances, id)).metrics), attendu, `${quoi} : /api/v1/chantiers`);
    };
    const SANS_COUTS = { heures: 0, coutMainOeuvre: 0, materiel: 0 };
    // Écart exact entre deux montants lus (relevés avant et après une écriture), sans erreur de virgule flottante.
    const ecart = (apres, avant) => new Decimal(apres).minus(avant).toNumber();

    before(async () => {
      assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname), 'seul un PostgreSQL local est autorisé');
      assert.notEqual(source.pathname.slice(1), nomBase);
      await administrationPg.connect();
      await administrationPg.query(`CREATE DATABASE "${nomBase}"`);
      baseCreee = true;
      execFileSync(resolve(dossierServeur, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', resolve(dossierServeur, 'prisma/schema.prisma')], {
        env: { ...process.env, DATABASE_URL: cible.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
      });
      process.env.DATABASE_URL = cibleApplication.toString();
      process.env.NODE_ENV = 'test';
      process.env.JWT_SECRET = 'secret-de-test-uniquement';
      process.env.BREAK_GLASS_EMAIL = 'secours@iris.test';
      process.env.BREAK_GLASS_TOKEN = 'jeton-de-secours-de-test-au-moins-32-caracteres';
      process.env.SUPERADMIN_EMAILS = 'secours@iris.test';
      request = (await import('supertest')).default;
      const serveur = await import('../dist/index.js');
      app = serveur.app;
      appPrisma = serveur.prisma;
      const clientPrisma = await import('@prisma/client');
      Decimal = clientPrisma.Prisma.Decimal;
      prisma = new clientPrisma.PrismaClient({ datasources: { db: { url: cible.toString() } } });
      jwt = (await import('jsonwebtoken')).default;
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      const secours = await prisma.user.findUniqueOrThrow({ where: { email: 'secours@iris.test' } });
      assert.equal(secours.role, 'SUPERADMIN');
      comptes.SA = { ...secours, auth: entete(connexion.body.token) };
      // Réglages par défaut de la société (marge commerciale active, rentabilité pour le conducteur, sa hiérarchie et les
      // directeurs, seuil de marge faible à 15 %) : relus ici, le fichier en dépend.
      const parametres = await prisma.parametres.findUniqueOrThrow({ where: { id: 'singleton' } });
      assert.deepEqual([parametres.margeCommercialeActive, parametres.rentabiliteConducteur, parametres.rentabiliteHierarchie, parametres.rentabiliteDirecteurs], [true, true, true, true]);
      // Identité de la société, exigée pour signer un devis (lot 6a-2).
      await ok(appeler('put', '/api/company', SA(), { raisonSociale: 'TEST Société lot AB', siret: '12345678900011', adresse: '1 rue des Tests', codePostal: '14000', ville: 'Caen' }));
      // Client identifié (SIREN tiré au hasard, site de facturation : lot 6a-2 bis).
      for (let essai = 1; ; essai += 1) {
        const res = await appeler('post', '/api/clients', SA(), { raisonSociale: `TEST Client lot AB ${suffixe()}`, siren: String(randomInt(100_000_000, 1_000_000_000)) });
        if (res.status === 409 && essai < 5) continue;
        assert.equal(res.status, 201, JSON.stringify(res.body));
        client = res.body;
        break;
      }
      await ok(appeler('post', `/api/clients/${client.id}/sites`, SA(), { nom: 'TEST Facturation lot AB', adresse: '2 rue des Tests', codePostal: '14000', ville: 'Caen', estSiteFacturation: true }), 201);
      // Comptes : administrateur et directeur (montants de la fiche), responsable (statistiques de sa branche), commercial
      // (son résultat commercial). Conducteurs et techniciens sont créés par scénario.
      await creerCompte('AD', 'ADMIN');
      await creerCompte('DIR', 'DIRECTEUR');
      await creerCompte('RESP', 'RESPONSABLE');
      await creerCompte('COM', 'COMMERCIAL');
      // Clés d'intégration : chantiers:read seule (coût de main-d'œuvre sans marge), et avec finances:read (marge en plus).
      for (const [nom, scopes] of [['lecture', ['chantiers:read']], ['finances', ['chantiers:read', 'finances:read']]]) {
        const creation = await ok(appeler('post', '/api/admin/api-keys', SA(), { nom: `TEST Clé lot AB ${nom} ${suffixe()}`, scopes }), 201);
        cles[nom] = entete(creation.apiKey);
      }
    });

    after(async () => {
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      if (baseCreee) {
        // Un autovacuum peut tenir la base un instant : quelques essais, puis l'erreur.
        for (let essai = 1; ; essai += 1) {
          try { await administrationPg.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`); break; } catch (erreur) { if (essai >= 5) throw erreur; await pause(500); }
        }
      }
      await administrationPg.end().catch(() => {});
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 1. Coût horaire moyen de la société (cadrage v2, point 3 ; lecture L4)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, point 3 : le numérateur du coût horaire moyen de la société devient SUM(ROUND(heures × taux, 2)) ; lecture
    // L4 : « son numérateur est la somme des lignes arrondies, comme le coût horaire d'un chantier » ; « Tests » : « Le coût
    // horaire moyen de la société, pour un chantier sans heure propre ». Il porte sur tous les pointages actifs des affaires non
    // annulées de la base : ce test passe donc le premier, sur la base neuve du fichier (aucun pointage, vérifié).
    // Une affaire en cours reçoit le jeu (4,25 h, 140,00 €) et 0,75 h à 40 € (30,00 €, sans arrondi) : 5 h pour 170,00 €, soit
    // 34 €/h. Une seconde affaire en cours, sans heure, vendue 1 000 € pour 10 h, sans matériel vendu, estime sa main-d'œuvre
    // au coût de la société : 10 h × 34 € = 340 € ; marge estimée 1 000 − 340 = 660 € (66 %). Lectures écartées :
    //  - SQL sans ROUND (somme exacte, le calcul d'avant le lot) : 169,99 € ÷ 5 h = 33,998 €/h ; 339,98 € ; marge 660,02 € ;
    //  - arrondi au pair ou troncature par ligne : 169,97 € ÷ 5 = 33,994 €/h ; 339,94 € ; marge 660,06 € ;
    //  - arrondi par excès par ligne : 170,02 € ÷ 5 = 34,004 €/h ; 340,04 € ; marge 659,96 €.
    // Le conducteur titulaire de la seconde affaire ne voit ni le coût horaire ni la main-d'œuvre attendue (masqués comme avant),
    // mais la même marge estimée.
    test('coût horaire moyen de la société : somme des pointages arrondis par ligne (170,00 € pour 5 h, 34 €/h) ; un chantier sans heure estime sa main-d’œuvre à 340 €, marge estimée 660 €', async () => {
      assert.equal(await prisma.pointageHeure.count(), 0, 'base neuve : aucun pointage avant ce test');
      const conducteur = await creerConducteur('CTSOC');
      const ficheSociete = await creerFiche('société');
      const avecHeures = await creerChantier('coût de la société, avec heures', conducteur.id);
      const sansHeure = await creerChantier('coût de la société, sans heure', conducteur.id, { budgetMainOeuvreVendu: '500', heuresVendues: '10' });
      await jouer(ficheSociete, [...JEU, { heures: '0,75', taux: '40' }], (ligne) => pointer(conducteur.auth, avecHeures.id, ficheSociete, ligne.heures));
      assert.deepEqual((await prisma.pointageHeure.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map((p) => [p.nbrHeures.toString(), p.tauxHoraireApplique.toString()]),
        [['3.25', '37.85'], ['0.25', '37.85'], ['0.25', '10.02'], ['0.25', '10.02'], ['0.25', '10.02'], ['0.75', '40']], 'taux figés à la saisie');
      const { metrics } = await fiche(sansHeure.id);
      assert.equal(metrics.heuresRealisees, 0);
      assert.deepEqual([metrics.estimation.sourceCoutHoraire, metrics.estimation.coutHoraireReference, metrics.estimation.coutMainOeuvreAttendu], ['SOCIETE', 34, 340]);
      assert.deepEqual([metrics.margeEstimee, metrics.margeEstimeePct], [660, 66]);
      const vueConducteur = (await fiche(sansHeure.id, conducteur.auth)).metrics;
      assert.deepEqual([vueConducteur.estimation.coutHoraireReference, vueConducteur.estimation.coutMainOeuvreAttendu, vueConducteur.margeEstimee], [null, null, 660], 'conducteur titulaire');
      // L'affaire avec heures garde son propre coût horaire, sur la même somme arrondie par ligne : 170,00 € ÷ 5 h.
      assert.deepEqual([(await fiche(avecHeures.id)).metrics.moReel, (await fiche(avecHeures.id)).metrics.estimation.coutHoraireReference], [170, 34]);

      // Lecture L3 (cadrage v2 : « coût horaire de référence […] sans arrondi propre ; seul l'affichage les arrondit ») : le coût
      // horaire moyen de la société n'est pas arrondi au centime. Les 34 €/h ci-dessus ne le montrent pas : 33,998 €/h (somme
      // exacte) arrondis au centime donnent aussi 34,00 €/h. Une heure de plus, à 1,01 € (sans reste) : 171,01 € pour 6 h, soit
      // 28,501666… €/h, et 285,0166… € de main-d'œuvre attendue pour 10 h vendues. Lectures écartées, toutes à 28,50 €/h et
      // 285,00 € : la somme exacte des produits (171,00 € ÷ 6, avant le lot), arrondie ou non, au total ou au quotient ; le coût
      // horaire arrondi au centime sur la somme des lignes arrondies (28,501666… → 28,50 €).
      await changerTaux(ficheSociete, '1.01');
      await pointer(conducteur.auth, avecHeures.id, ficheSociete, '1');
      const reference = (await fiche(sansHeure.id)).metrics.estimation;
      const tauxAttendu = new Decimal('171.01').div(6);
      assert.equal(reference.sourceCoutHoraire, 'SOCIETE');
      assert.ok(Math.abs(reference.coutHoraireReference - tauxAttendu.toNumber()) < 1e-9, `coût horaire de la société : ${reference.coutHoraireReference} ≠ ${tauxAttendu}`);
      assert.ok(Math.abs(reference.coutMainOeuvreAttendu - tauxAttendu.times(10).toNumber()) < 1e-9, `main-d’œuvre attendue : ${reference.coutMainOeuvreAttendu} ≠ ${tauxAttendu.times(10)}`);
      assert.notEqual(reference.coutHoraireReference, 28.5, 'coût horaire non arrondi au centime');
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 2. Pointages : fiche, liste, API d'intégration, statistiques des conducteurs et des intervenants
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, point 2 (boucle des pointages) et « Tests » : le jeu « sert pour les pointages […], sur la fiche, la liste,
    // /api/v1/chantiers, /api/stats/conducteurs, /api/stats/intervenants ». Le conducteur titulaire saisit les cinq lignes
    // (POST /api/heures) avec une seule fiche, le même jour ; l'administration passe la fiche de 37,85 € à 10,02 € entre la
    // deuxième et la troisième saisie, puis à 52 € après la dernière (fiche modifiée après coup).
    //  - En base : taux figés 37,85, 37,85, 10,02, 10,02, 10,02 (lecture écartée : le taux de la fiche relu à la lecture).
    //  - Fiche, liste et /api/v1/chantiers (clé chantiers:read et finances:read) : 4,25 h réalisées ; main-d'œuvre et dépenses
    //    140,00 € ; marge 860,00 €. Lectures écartées : 139,99 € (somme exacte, avant le lot ; ou total par intervenant ou par
    //    jour arrondi), marge 860,01 € ; 139,97 € (pair, troncature), marge 860,03 € ; 140,02 € (excès), marge 859,98 € ;
    //    221,00 € (4,25 h × 52 €, taux réappliqué).
    //  - Clé chantiers:read seule : le même coût, sans marge (règles de visibilité inchangées).
    //  - Administrateur et directeur : mêmes montants. Conducteur titulaire : la même marge (860,00 €), sans coût de
    //    main-d'œuvre ni dépenses (masqués comme avant).
    //  - /api/stats/conducteurs : dépenses 140,00 € et marge 860,00 € pour l'administration ; marge 860,00 € et dépenses masquées
    //    pour le responsable de la branche (mêmes lectures écartées).
    //  - /api/stats/intervenants (mois des saisies) : la fiche, 4,25 h, coût 140,00 € pour l'administration (point 4 ; lectures
    //    écartées : 139,99 € par intervenant arrondi une fois ou exact, 139,97 €, 140,02 €) ; coût masqué pour le conducteur.
    test('pointages : 3,25 h et 0,25 h à 37,85 €, puis trois fois 0,25 h à 10,02 € coûtent 140,00 €, marge 860,00 €, sur la fiche, la liste, /api/v1/chantiers, les statistiques des conducteurs et des intervenants ; taux figés, fiche modifiée après coup sans effet', async () => {
      const conducteur = await creerConducteur('CTP');
      const fichePointages = await creerFiche('pointages');
      const chantier = await creerChantier('pointages', conducteur.id);
      await jouer(fichePointages, JEU, (ligne) => pointer(conducteur.auth, chantier.id, fichePointages, ligne.heures));
      await changerTaux(fichePointages, TAUX_APRES_COUP);
      const lignes = await prisma.pointageHeure.findMany({ where: { chantierId: chantier.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      assert.deepEqual(lignes.map((p) => [p.nbrHeures.toString(), p.tauxHoraireApplique.toString(), p.date.toISOString().slice(0, 10)]), JEU.map((l) => [l.heures.replace(',', '.'), l.taux, jourIso()]), 'une ligne par saisie, taux figé, même jour');

      const attendu = { heuresRealisees: 4.25, moReel: 140, totalDepenses: 140, margeBrute: 860, margeCommerciale: 860, coutsSuites: SANS_COUTS, coutsInterventionDevis: SANS_COUTS };
      await memesMontantsPartout(chantier.id, attendu, 'pointages');
      const parCleLecture = (await dansListe('/api/v1/chantiers', cles.lecture, chantier.id)).metrics;
      assert.deepEqual([parCleLecture.moReel, parCleLecture.totalDepenses, parCleLecture.margeCommerciale], [140, 140, null], 'clé chantiers:read seule');
      for (const code of ['AD', 'DIR']) assert.deepEqual(montantsDe((await fiche(chantier.id, comptes[code].auth)).metrics), attendu, code);
      const vueConducteur = (await fiche(chantier.id, conducteur.auth)).metrics;
      assert.deepEqual([vueConducteur.moReel, vueConducteur.totalDepenses, vueConducteur.margeBrute, vueConducteur.margeCommerciale], [null, null, 860, 860], 'conducteur titulaire');

      const statsAdministration = await ligneConducteur(SA(), conducteur.id);
      assert.deepEqual([statsAdministration.depensesTotal, statsAdministration.caTotal, statsAdministration.margeTotal, statsAdministration.margePct], [140, 1000, 860, 86]);
      const statsResponsable = await ligneConducteur(comptes.RESP.auth, conducteur.id);
      assert.deepEqual([statsResponsable.depensesTotal, statsResponsable.margeTotal], [null, 860], 'responsable de la branche');

      const periode = `period=month&ref=${jourIso()}`;
      const intervenantVuPar = async (auth) => (await ok(appeler('get', `/api/stats/intervenants?${periode}`, auth))).intervenants.find((i) => i.id === fichePointages.id);
      assert.deepEqual(await intervenantVuPar(SA()), { id: fichePointages.id, nom: fichePointages.nom, role: 'Technicien', heures: 4.25, cout: 140 });
      assert.deepEqual(await intervenantVuPar(conducteur.auth), { id: fichePointages.id, nom: fichePointages.nom, role: 'Technicien', heures: 4.25, cout: null }, 'conducteur : coût masqué');
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 3. Suites : coûts des suites dans la marge du chantier, main-d'œuvre cumulée de chaque suite
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, point 2 (boucle des suites), lecture L2 (« la main-d'œuvre cumulée d'une suite est égale à sa part dans la
    // marge du chantier ») et « Tests » (« La main-d'œuvre cumulée d'une suite est égale à sa part dans
    // coutsSuites.coutMainOeuvre »). Une affaire en cours, une curative rattachée, sa suite et la suite de la suite ; le
    // technicien affecté aux deux suites saisit le jeu (taux de sa fiche changé entre les saisies, puis après coup) :
    // suite 1 : 3,25 h à 37,85 € et 0,25 h à 10,02 € ; suite 2 : 0,25 h à 37,85 € et deux fois 0,25 h à 10,02 €.
    //  - Main-d'œuvre cumulée (GET /api/interventions/:id/couts, inchangée par le lot) : suite 1, 123,01 + 2,51 = 125,52 € ;
    //    suite 2, 9,46 + 2,51 + 2,51 = 14,48 €.
    //  - Chantier : coutsSuites { 4,25 h, 140,00 €, matériel 0 } = 125,52 + 14,48 ; main-d'œuvre et dépenses 140,00 € ; heures
    //    réalisées 0 (heures des suites hors des heures réalisées, décision du 27-10-2026) ; marge 860,00 €. Lectures écartées :
    //    139,99 € (somme exacte, avant le lot) ; 139,99 € aussi pour un total par suite arrondi (125,5175 → 125,52 et
    //    14,4725 → 14,47), qui romprait l'égalité des parties et du total ; 139,97 € (pair, troncature : 125,51 + 14,46) ;
    //    140,02 € (excès : 125,53 + 14,49).
    //  - Conducteur titulaire : coût des suites masqué, même marge.
    test('suites : le jeu réparti sur une suite et la suite de la suite coûte 140,00 € dans la marge du chantier (860,00 €), égal à la somme des main-d’œuvre cumulées des suites (125,52 € + 14,48 €), sur la fiche, la liste, /api/v1/chantiers et les statistiques des conducteurs', async () => {
      const conducteur = await creerConducteur('CTS');
      const technicien = await creerTechnicien('TECHS');
      const chantier = await creerChantier('suites', conducteur.id);
      const initiale = await curative('initiale des suites', { chantierId: chantier.id });
      const suite1 = await suiteDe(initiale.id);
      const suite2 = await suiteDe(suite1.id);
      assert.deepEqual([suite1.chantierId, suite2.chantierId, suite2.interventionInitialeId], [chantier.id, chantier.id, suite1.id]);
      for (const s of [suite1, suite2]) await affecter(s.id, technicien);
      const suites = [suite1, suite2];
      await jouer(technicien.fiche, JEU, (ligne) => heureIntervention(technicien, suites[ligne.cible].id, ligne.heures));
      await changerTaux(technicien.fiche, TAUX_APRES_COUP);
      const lignes = await prisma.coutInterventionHeure.findMany({ where: { interventionId: { in: [suite1.id, suite2.id] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      assert.deepEqual(lignes.map((h) => [h.interventionId, h.nbrHeures.toString(), h.tauxHoraireApplique.toString()]), JEU.map((l) => [suites[l.cible].id, l.heures.replace(',', '.'), l.taux]), 'taux figés à la saisie');

      const cumul1 = await coutsIntervention(suite1.id);
      const cumul2 = await coutsIntervention(suite2.id);
      assert.deepEqual([cumul1.totalMainOeuvreHT, cumul1.totalCoutsHT, cumul2.totalMainOeuvreHT, cumul2.totalCoutsHT], [125.52, 125.52, 14.48, 14.48], 'main-d’œuvre cumulée de chaque suite');
      const attendu = { heuresRealisees: 0, moReel: 140, totalDepenses: 140, margeBrute: 860, margeCommerciale: 860, coutsSuites: { heures: 4.25, coutMainOeuvre: 140, materiel: 0 }, coutsInterventionDevis: SANS_COUTS };
      await memesMontantsPartout(chantier.id, attendu, 'suites');
      assert.equal(new Decimal(cumul1.totalMainOeuvreHT).plus(cumul2.totalMainOeuvreHT).toNumber(), (await fiche(chantier.id)).metrics.coutsSuites.coutMainOeuvre, 'somme des parts égale au total');
      const vueConducteur = (await fiche(chantier.id, conducteur.auth)).metrics;
      assert.deepEqual([vueConducteur.coutsSuites, vueConducteur.moReel, vueConducteur.margeCommerciale], [{ heures: 4.25, coutMainOeuvre: null, materiel: 0 }, null, 860], 'conducteur titulaire');
      const stats = await ligneConducteur(SA(), conducteur.id);
      assert.deepEqual([stats.depensesTotal, stats.margeTotal], [140, 860]);
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 4. Intervention issue du devis qui a aussi ouvert le chantier
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, point 2 (boucle de l'intervention issue du devis) et « Tests » (le jeu « sert pour […] l'intervention issue du
    // devis »). Un devis de 10 h de pose à 100 € (1 000 € HT), signé, converti en chantier puis en intervention : l'intervention
    // naît rattachée au chantier et compte comme son travail (décision du 27-10-2026). Le technicien affecté saisit le jeu.
    //  - Main-d'œuvre cumulée de l'intervention (inchangée) : 140,00 €.
    //  - Chantier : coutsInterventionDevis { 4,25 h, 140,00 €, matériel 0 } ; heures réalisées 4,25 ; main-d'œuvre et dépenses
    //    140,00 € ; marge 860,00 €. Lectures écartées : 139,99 € (somme exacte, avant le lot), marge 860,01 € ; 139,97 € ;
    //    140,02 €.
    test('intervention issue du devis du chantier : le jeu coûte 140,00 € dans la marge du chantier (860,00 €), égal à sa main-d’œuvre cumulée, sur la fiche, la liste, /api/v1/chantiers et les statistiques des conducteurs', async () => {
      const conducteur = await creerConducteur('CTD');
      const technicien = await creerTechnicien('TECHD');
      const devis = await ok(appeler('post', '/api/devis', SA(), { clientId: client.id, objet: `TEST Devis lot AB ${suffixe()}`, lignes: [
        { designation: 'TEST Pose lot AB', nature: 'MAIN_OEUVRE', quantite: 10, prixUnitaireHt: 100, tauxTva: 20 },
      ] }), 201);
      await ok(appeler('post', `/api/devis/${devis.id}/signature`, SA(), { signataire: 'TEST Signataire lot AB', confirme: true }), 201);
      const chantier = await ok(appeler('post', `/api/devis/${devis.id}/convertir`, SA(), { cible: 'CHANTIER', responsableId: conducteur.id }), 201);
      const intervention = await ok(appeler('post', `/api/devis/${devis.id}/convertir`, SA(), { cible: 'INTERVENTION' }), 201);
      assert.equal(intervention.chantierId, chantier.id, 'rattachée au chantier de son devis');
      await affecter(intervention.id, technicien);
      await jouer(technicien.fiche, JEU, (ligne) => heureIntervention(technicien, intervention.id, ligne.heures));
      await changerTaux(technicien.fiche, TAUX_APRES_COUP);
      assert.deepEqual((await prisma.coutInterventionHeure.findMany({ where: { interventionId: intervention.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map((h) => h.tauxHoraireApplique.toString()), TAUX_FIGES, 'taux figés à la saisie');

      const cumul = await coutsIntervention(intervention.id);
      assert.deepEqual([cumul.totalMainOeuvreHT, cumul.totalCoutsHT, cumul.margeDevis], [140, 140, null], 'main-d’œuvre cumulée de l’intervention');
      const { metrics, budgetGlobalVendu } = await fiche(chantier.id);
      assert.equal(budgetGlobalVendu, 1000, 'vendu : total HT du devis');
      const attendu = { heuresRealisees: 4.25, moReel: 140, totalDepenses: 140, margeBrute: 860, margeCommerciale: 860, coutsSuites: SANS_COUTS, coutsInterventionDevis: { heures: 4.25, coutMainOeuvre: 140, materiel: 0 } };
      assert.deepEqual(montantsDe(metrics), attendu);
      await memesMontantsPartout(chantier.id, attendu, 'intervention issue du devis');
      assert.equal(cumul.totalMainOeuvreHT, metrics.coutsInterventionDevis.coutMainOeuvre, 'main-d’œuvre cumulée égale à sa part dans la marge du chantier');
      const stats = await ligneConducteur(SA(), conducteur.id);
      assert.deepEqual([stats.depensesTotal, stats.margeTotal], [140, 860]);
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 5. Détail des commerciaux et tableau de bord
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, point 5 (/api/stats/commerciaux, « commission nulle sans plan commercial », /api/stats/global) et « Tests »
    // (le jeu « sert […] pour le détail des commerciaux »). Une affaire vendue par le commercial du fichier reçoit le jeu en
    // pointages, puis l'administration la clôture et l'encaisse (elle compte alors au mois de sa clôture).
    //  - /api/stats/commerciaux (administration, et le commercial pour sa ligne) : CA 1 000 € ; marge 860,00 € ; détail de
    //    l'affaire : marge 860,00 €, comptabilisée dans la période, commission estimée 0 (aucun plan commercial). Lectures
    //    écartées : 860,01 € (somme exacte, avant le lot), 860,03 €, 859,98 €.
    //  - /api/stats/global du mois : marge du commercial 860,00 €, commission 0 ; pour l'administration, la marge du mois
    //    augmente de 860,00 € à la clôture et à l'encaissement (relevé avant et après).
    test('détail des commerciaux et tableau de bord : l’affaire close et encaissée au jeu de pointages compte 860,00 € de marge, commission nulle sans plan commercial', async () => {
      const conducteur = await creerConducteur('CTC');
      const ficheCommerciale = await creerFiche('commerciaux');
      const chantier = await creerChantier('commerciaux', conducteur.id, { commercialId: comptes.COM.id });
      await jouer(ficheCommerciale, JEU, (ligne) => pointer(conducteur.auth, chantier.id, ficheCommerciale, ligne.heures));
      const moisDuJour = `period=month&ref=${jourIso()}`;
      const margeDuMoisAvant = (await ok(appeler('get', `/api/stats/global?${moisDuJour}`, SA()))).margeTotal;
      await ok(appeler('patch', `/api/chantiers/${chantier.id}/statut`, SA(), { statut: 'TERMINE' }));
      await ok(appeler('patch', `/api/chantiers/${chantier.id}/encaisse`, SA(), { encaisse: true }));
      const clos = await prisma.chantier.findUniqueOrThrow({ where: { id: chantier.id } });
      assert.deepEqual([clos.statut, clos.encaisse], ['TERMINE', true]);
      const moisDeCloture = `period=month&ref=${clos.dateFin.toISOString().slice(0, 10)}`;

      for (const [auth, quoi] of [[SA(), 'administration'], [comptes.COM.auth, 'commercial']]) {
        const { commerciaux } = await ok(appeler('get', `/api/stats/commerciaux?${moisDeCloture}`, auth));
        const ligne = commerciaux.find((c) => c.id === comptes.COM.id);
        assert.deepEqual([ligne.caTotal, ligne.margeTotal, ligne.margeStandard, ligne.commissionTotal, ligne.sansPlanCommercial], [1000, 860, 860, 0, true], `${quoi} : totaux`);
        const detail = ligne.chantiers.find((c) => c.id === chantier.id);
        assert.deepEqual([detail.budgetGlobalVendu, detail.margeCommerciale, detail.comptabiliseDansPeriode, detail.commissionEstimee], [1000, 860, true, 0], `${quoi} : détail de l’affaire`);
      }
      const tableauCommercial = await ok(appeler('get', `/api/stats/global?${moisDeCloture}`, comptes.COM.auth));
      assert.deepEqual([tableauCommercial.margeTotal, tableauCommercial.commissionTotal, tableauCommercial.sansPlanCommercial], [860, 0, true], 'tableau de bord du commercial');
      if (moisDeCloture === moisDuJour) {
        const margeDuMoisApres = (await ok(appeler('get', `/api/stats/global?${moisDuJour}`, SA()))).margeTotal;
        assert.equal(ecart(margeDuMoisApres, margeDuMoisAvant), 860, 'tableau de bord de l’administration : la marge du mois augmente de 860,00 €');
      }
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 6. Exemple de Nelson et bornes : alertes, perte, répartition des chantiers terminés
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, « Tests » : « L'exemple de Nelson, 3,25 h et 0,25 h à 37,85 €/h : 132,47 €, avec la marge correspondante
    // (867,53 € pour un vendu de 1 000 €) » ; « budget de main-d'œuvre de 132,47 € : pas d'alerte « Main-d’œuvre dépassée » ».
    // Le conducteur titulaire pointe 3,25 h puis 0,25 h ; budget de main-d'œuvre 132,47 €, 3,5 h vendues, vendu 1 000 €.
    //  - Main-d'œuvre et dépenses 132,47 € (123,01 + 9,46) ; marge 867,53 € ; budget de main-d'œuvre consommé à 100 % ; ni
    //    MAIN_OEUVRE_DEPASSEE ni HEURES_DEPASSEES (3,5 h pour 3,5 h vendues). Lectures écartées : 132,475 € (somme exacte, avant le
    //    lot : 132,475 > 132,47, d'où l'alerte « Main-d’œuvre dépassée », et une marge de 867,525 €) ; 132,48 € (total arrondi une
    //    fois), marge 867,52 € ; 132,49 € (excès par ligne : 123,02 + 9,47), marge 867,51 €, alerte.
    //  - Liste : les mêmes montants et les mêmes alertes.
    //  - Clôturé, le chantier entre dans la répartition des chantiers terminés comme « Tout positif » (heures, coût de
    //    main-d'œuvre et matériel dans le budget) : relevé avant et après la clôture, « positif » + 1. Lecture écartée : le coût
    //    exact (132,475 € > 132,47 €) le classerait « Dépassement budget temps uniquement ».
    test('exemple de Nelson : 3,25 h et 0,25 h à 37,85 € coûtent 132,47 €, marge 867,53 € ; un budget de main-d’œuvre de 132,47 € n’est pas dépassé, et le chantier clôturé compte « Tout positif »', async () => {
      const conducteur = await creerConducteur('CTN');
      const ficheNelson = await creerFiche('exemple de Nelson');
      const chantier = await creerChantier('exemple de Nelson', conducteur.id, { budgetMainOeuvreVendu: '132.47', heuresVendues: '3.5' });
      await jouer(ficheNelson, EXEMPLE_NELSON, (ligne) => pointer(conducteur.auth, chantier.id, ficheNelson, ligne.heures));
      const attendu = { heuresRealisees: 3.5, moReel: 132.47, totalDepenses: 132.47, margeBrute: 867.53, margeCommerciale: 867.53, coutsSuites: SANS_COUTS, coutsInterventionDevis: SANS_COUTS };
      await memesMontantsPartout(chantier.id, attendu, 'exemple de Nelson');
      for (const metrics of [(await fiche(chantier.id)).metrics, (await dansListe('/api/chantiers', SA(), chantier.id)).metrics]) {
        assert.equal(metrics.pctMainOeuvre, 100, 'budget de main-d’œuvre consommé à 100 %');
        assert.equal(metrics.alertes.includes('MAIN_OEUVRE_DEPASSEE'), false, 'pas d’alerte « Main-d’œuvre dépassée »');
        assert.equal(metrics.alertes.includes('HEURES_DEPASSEES'), false);
        assert.equal(metrics.alertes.includes('EN_PERTE'), false);
      }
      const repartition = async () => Object.fromEntries((await ok(appeler('get', '/api/stats/chantiers-repartition', SA()))).categories.map((c) => [c.key, c.count]));
      const avant = await repartition();
      await ok(appeler('patch', `/api/chantiers/${chantier.id}/statut`, SA(), { statut: 'TERMINE' }));
      const apres = await repartition();
      assert.deepEqual(Object.fromEntries(Object.keys(apres).map((cle) => [cle, apres[cle] - avant[cle]])), { positif: 1, tempsSeul: 0, materielSeul: 0, lesDeux: 0 }, 'chantier clôturé : « Tout positif »');
    });

    // Cadrage v2, « Tests » : « vendu de 132,47 € : marge 0,00 €, sans « En perte ». Aujourd'hui : -0,005 € et « En perte »,
    // sans montant. » Le conducteur titulaire pointe 3,25 h puis 0,25 h à 37,85 € sur une affaire vendue 132,47 € (budget de
    // main-d'œuvre 500 €, 20 h vendues).
    //  - Marge 0 € (132,47 − 132,47), 0 % ; pas d'alerte EN_PERTE, pour l'administration comme pour le conducteur titulaire, qui
    //    voit la marge. Lectures écartées : -0,005 € et EN_PERTE (somme exacte, avant le lot) ; -0,01 € (total arrondi une fois,
    //    132,48 €) ; -0,02 € (excès par ligne, 132,49 €).
    //  - Liste et /api/v1/chantiers : la même marge, sans EN_PERTE.
    test('borne de la perte : vendu 132,47 € pour 3,25 h et 0,25 h à 37,85 €, marge 0,00 € et 0 %, sans alerte « En perte », pour l’administration, le conducteur titulaire, la liste et /api/v1/chantiers', async () => {
      const conducteur = await creerConducteur('CTB');
      const ficheBorne = await creerFiche('borne de la perte');
      const chantier = await creerChantier('borne de la perte', conducteur.id, { budgetGlobalVendu: '132.47' });
      await jouer(ficheBorne, EXEMPLE_NELSON, (ligne) => pointer(conducteur.auth, chantier.id, ficheBorne, ligne.heures));
      const vues = [
        ['fiche, administration', (await fiche(chantier.id)).metrics],
        ['fiche, conducteur titulaire', (await fiche(chantier.id, conducteur.auth)).metrics],
        ['liste', (await dansListe('/api/chantiers', SA(), chantier.id)).metrics],
        ['/api/v1/chantiers', (await dansListe('/api/v1/chantiers', cles.finances, chantier.id)).metrics],
      ];
      for (const [quoi, metrics] of vues) {
        assert.deepEqual([metrics.margeBrute, metrics.margeCommerciale, metrics.margePct], [0, 0, 0], `${quoi} : marge nulle`);
        assert.equal(metrics.alertes.includes('EN_PERTE'), false, `${quoi} : pas d’alerte « En perte »`);
        // Effet en chaîne : une marge nulle n'est pas une perte, et l'affaire en cours, à son coût horaire (132,47 € ÷ 3,5 h),
        // estime 20 h × 132,47 € ÷ 3,5 h = 756,971428… € de main-d'œuvre, soit une marge estimée de 132,47 − 756,971428… =
        // -624,501428… € (-471,43 %) : l'alerte « Marge faible » prend la place d'« En perte ». Lectures
        // écartées : « En perte » sans « Marge faible » (somme exacte, avant le lot : marge -0,005 €) ; aucune des deux alertes
        // (marge nulle traitée comme ni perte ni affaire suivie : « Marge faible » réservée à une marge strictement positive).
        assert.equal(metrics.alertes.includes('MARGE_FAIBLE'), true, `${quoi} : alerte « Marge faible »`);
        assert.ok(Math.abs(metrics.margeEstimee - (132.47 - (20 * 132.47) / 3.5)) < 1e-9, `${quoi} : marge estimée ${metrics.margeEstimee}`);
      }
      assert.equal(vues[0][1].moReel, 132.47);
    });
  });
}
