// Lot W : heures d'un chantier saisies au quart d'heure, à partir de 0,25 h (décision de Nelson du 22-11-2026, soir, point 1,
// mot pour mot : « 1. Quart d'heure » ; lecture retenue, à corriger par Nelson si besoin : les heures d'un chantier se
// saisissent au quart d'heure, ce qui remplace la demi-heure de l'écran gardée par #658). Cadrage v2 du lot W, après le contrôle
// de cohérence sur 8239d75 (section « Cadrage v2 », points 1, 4 et 5, « Critères observables » et « Tests ») ; règle 2 de la
// méthode : le lot touche un montant, le coût de la main-d'œuvre d'un chantier (heures × taux), donc sa marge (classé C).
//
// Ce que le lot change côté serveur, et que ce fichier prouve par des requêtes HTTP réelles sur une base PostgreSQL jetable :
//  - POST /api/heures et PATCH /api/heures/:id (quand `nbrHeures` est dans le corps) n'admettent que des quarts d'heure, à
//    partir de 0,25 : la lecture commune `nombreDecimalNonNegatif(v, 8)` (virgule ou point, huit chiffres, deux décimales),
//    puis un multiple de 0,25 (cadrage v2, point 1 : « le serveur reste juge, l'écran ne fait que prévenir ») ;
//  - un seul refus, 400 « Le nombre d’heures se saisit au quart d’heure, à partir de 0,25 (par exemple 3,25). », sans
//    écriture (empreinte de toute la base, pointage relu identique, journal des saisies inchangé) ;
//  - contrôle au même endroit que l'ancienne lecture : l'ordre des refus est celui de main (afed682), où POST reste
//    « validation-avant-droit » (les heures sont jugées avant l'intervenant et le périmètre du chantier) et PATCH juge
//    d'abord le pointage, le périmètre, l'archivage, le motif et la date ;
//  - une heure déjà enregistrée hors du quart d'heure reste telle quelle (point 4, règle 4 : aucune reprise) : une correction
//    qui ne touche pas aux heures, un archivage et une restauration l'admettent ; renvoyer ses heures telles quelles est refusé ;
//  - aucune clé d'intégration n'écrit d'heures d'un chantier (point 1 : « Seules ces deux routes écrivent des heures d'un
//    chantier »).
// Les heures d'une intervention, hors du lot W (point 5), passent aussi au quart d'heure, zéro compris avec son motif, par le
// lot Z (réponse de Nelson du 23-11-2026 : « les heures sur une intervention Passe au quart d'heure ») : la règle
// heuresAuQuartDHeure est déplacée dans commun/validation.ts, avec un paramètre « zéro admis », et re-exportée par
// domaines/chantiers/saisies.ts, d'où la section 9 l'importe ; ce fichier, rejoué après le déplacement, prouve que les heures
// d'un chantier n'en changent pas. Les heures d'une intervention sont jouées dans heures-intervention-quart-heure.test.mjs.
// Montants : le coût d'une ligne reste heures × taux figé, en décimal exact (point 5 : « Aucun calcul ») ; chaque valeur est
// choisie pour qu'une autre lecture plausible donne un autre résultat, et la lecture écartée est écrite en commentaire.
//
// Fichier propre au lot, avec sa base jetable (modèle : saisies-decimales.test.mjs) : `node --test` exécute les fichiers en
// parallèle, et api.test.mjs purge les données « TEST » de TEST_DATABASE_URL. TEST_DATABASE_URL ne sert ici que de connexion
// administrative : une base neuve est créée, migrée, servie à l'application montée en mémoire, puis supprimée. Sans
// TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { empreinteBase, tablesChangees, tablesDeLaBase } from './matrice-droits/outils.mjs';

const TITRE = 'Lot W : heures d’un chantier saisies au quart d’heure, à partir de 0,25 h (POST et PATCH /api/heures)';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MESSAGES = {
  // Cadrage v2, point 1 : un seul message, apostrophes typographiques, exemple « 3,25 ».
  quartDHeure: 'Le nombre d’heures se saisit au quart d’heure, à partir de 0,25 (par exemple 3,25).',
  date: 'La date doit être valide au format JJ-MM-AAAA.',
  motif: 'Le motif de correction doit contenir entre 3 et 500 caractères.',
  authentification: 'Authentification requise',
  sessionInvalide: 'Session expirée ou invalide',
  permission: 'Permission requise : chantiers:write',
  chantier: 'Chantier introuvable',
  intervenant: 'Intervenant introuvable.',
  pointage: 'Pointage introuvable.',
  archive: 'Un pointage archivé ne peut plus être corrigé.',
  annulee: 'Cette affaire est annulée : plus aucune saisie n’y est possible.',
  cloture: 'Ce chantier est clôturé : impossible d\'y ajouter une dépense ou des heures.',
};

// Saisies admises (cadrage v2, « Critères observables » : « 3,25 », « 3,75 », « 0,25 », « 3,00 », « 3 », et 3.25 en nombre
// JSON), avec la valeur relue en base (`toString()` du Decimal) : la réponse porte la même écriture (Decimal sérialisé).
// Chaque saisie écarte au moins une lecture :
const ADMISES = [
  // Quart d'heure : écarte la demi-heure (refus, comme l'écran avant le lot), une virgule ignorée (325 h), une lecture arrêtée
  // à la virgule (3 h), un arrondi au dixième (3,3 h) ou à la demi-heure (3,5 h).
  ['« 3,25 »', '3,25', '3.25'],
  // Trois quarts : écarte un motif qui n'admettrait que « 25 » ou « 50 » après la virgule, un arrondi au dixième (3,8 h).
  ['« 3,75 »', '3,75', '3.75'],
  // Minimum : écarte un minimum à 0,5 h (la demi-heure d'avant) ou à 1 h ; écarte un arrondi au dixième (0,3 h).
  ['« 0,25 »', '0,25', '0.25'],
  // Deux zéros : écarte un refus de « ,00 » (motif « 25|5|75 » sans zéro).
  ['« 3,00 »', '3,00', '3'],
  // Entier : écarte une décimale exigée.
  ['« 3 »', '3', '3'],
  // Nombre JSON : écarte un contrôle réservé aux chaînes, ou un refus des nombres.
  ['3.25 en nombre JSON', 3.25, '3.25'],
  // Point : écarte une saisie lue à la seule virgule.
  ['« 3.25 » au point', '3.25', '3.25'],
  // Une seule décimale « 5 » (valeur pré-remplie « 7,5 » du journal) : écarte un refus de « ,5 » (deux décimales exigées).
  ['« 7,5 »', '7,5', '7.5'],
  // Borne de la colonne (Decimal(10, 2)) au quart d'heure : huit chiffres, « 75 » ; écarte une borne plus étroite.
  ['« 99999999,75 »', '99999999,75', '99999999.75'],
];

// Saisies refusées (cadrage v2, « Critères observables » : « 1,1 », « 0,2 », « 1,10 », « 0 », « 0,05 », « 3,250 »,
// « 123456789 »), chacune au message unique du lot. Chaque saisie écarte au moins une lecture :
const REFUSEES = [
  // Dixième : écarte le centième d'avant le lot (1,10 h enregistré), un arrondi au quart le plus proche (1,00 h).
  ['« 1,1 »', '1,1'],
  // Sous le minimum, hors quart : écarte un arrondi au quart supérieur (0,25 h) ou le centième d'avant (0,20 h).
  ['« 0,2 »', '0,2'],
  // Même valeur qu'« 1,1 », à deux décimales : écarte un contrôle du seul texte (« ,1 » refusé, « ,10 » admis).
  ['« 1,10 »', '1,10'],
  // Zéro, multiple de 0,25 : écarte zéro admis (le quart d'heure se compte à partir de 0,25).
  ['« 0 »', '0'],
  // Centième : écarte le centième d'avant le lot (0,05 h).
  ['« 0,05 »', '0,05'],
  // Trois décimales, valeur au quart : écarte trois décimales admises (lu 3,25 h, puis jugé au quart).
  ['« 3,250 »', '3,250'],
  // Neuf chiffres, entier (multiple du quart) : écarte une colonne élargie, ou le quart jugé avant la forme.
  ['« 123456789 »', '123456789'],
  // Nombres JSON : écarte un contrôle réservé aux chaînes.
  ['1.1 en nombre JSON', 1.1],
  ['0 en nombre JSON', 0],
  // Zéro à deux décimales : écarte un zéro reconnu au seul « 0 ».
  ['« 0,00 »', '0,00'],
  // Un centième de part et d'autre d'un quart : écarte une tolérance, ou un arrondi au quart le plus proche (3,25 h).
  ['« 3,26 »', '3,26'],
  ['« 3,24 »', '3,24'],
  // Borne de la colonne hors quart : admise avant le lot (99 999 999,99 h).
  ['« 99999999,99 »', '99999999,99'],
  // Hors quart, dont le produit flottant par 100 tombe juste sous un entier (« 2,01 » × 100 = 200,99999999999997) ou juste
  // au-dessus (« 2,24 » × 100 = 224,00000000000003) : écarte des centièmes tronqués (Math.floor, Math.trunc : 200, multiple
  // de 25, donc 2,01 h enregistré) ou pris par excès (Math.ceil : 225, donc 2,24 h enregistré) au lieu de Math.round (audit
  // des montants de #669).
  ['« 2,01 »', '2,01'],
  ['« 2,24 »', '2,24'],
  // Quart négatif : écarte une lecture en valeur absolue (0,25 h).
  ['« -0,25 »', '-0,25'],
  // Valeurs vides : écarte une valeur vide lue 0, ou un message distinct (cadrage v2, point 1 : « Un seul message 400 »).
  ['chaîne vide', ''],
  ['null', null],
];

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_heures_quart_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const cibleApplication = new URL(cible);
    cibleApplication.searchParams.set('connection_limit', '12');
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;

    let request; let app; let prisma; let appPrisma; let jwt; let Decimal;
    let tables = [];
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const comptes = {};
    let cleEcriture = null;
    let rang = 0;
    const suffixe = () => `${Date.now()}-${(rang += 1)}`;
    const creerCompte = async (code, role, extra = {}) => {
      const s = suffixe();
      const compte = await prisma.user.create({ data: { email: `lotw.${code.toLowerCase()}.${s}@iris.test`, name: `TEST ${code} lot W ${s}`, role, ...extra } });
      comptes[code] = { ...compte, auth: entete(jwt.sign({ id: compte.id }, process.env.JWT_SECRET)) };
      return comptes[code];
    };

    // --- Données ---
    const fiches = {};
    const chantiers = {};
    // Taux horaire de la fiche, avec des centimes : 3,25 h × 37,85 € = 123,0125 €, qu'un arrondi au centime par ligne changerait.
    const TAUX = '37.85';
    const creerChantier = (nom, responsableId, extra = {}) => prisma.chantier.create({ data: {
      nom: `TEST Chantier lot W ${nom} ${suffixe()}`, client: 'TEST Client lot W', dateDebut: new Date('2026-10-01T00:00:00Z'),
      budgetGlobalVendu: '1000', responsableId, ...extra,
    } });
    const creerFiche = (nom, taux = TAUX) => prisma.intervenant.create({ data: { nom: `TEST Intervenant lot W ${nom} ${suffixe()}`, role: 'Technicien', tauxHoraireCharge: taux } });
    // Pointage posé en base (le lot ne porte que sur la saisie par les routes) : heures de départ distinctes de toute valeur
    // envoyée, si bien qu'une écriture, même partielle, se voit.
    const DEPART = '7.5';
    const poserPointage = (chantierId, nbrHeures = DEPART, extra = {}) => prisma.pointageHeure.create({ data: {
      date: new Date('2026-10-05T00:00:00Z'), intervenantId: fiches.base.id, chantierId, nbrHeures, tauxHoraireApplique: TAUX,
      commentaire: 'TEST pointage de départ lot W', createdById: comptes.CT.id, updatedById: comptes.CT.id, ...extra,
    } });
    const DATE = '06-10-2026';
    const corpsCreation = (chantierId, nbrHeures, extra = {}) => ({ chantierId, intervenantId: fiches.base.id, date: DATE, nbrHeures, commentaire: 'TEST pointage lot W', ...extra });
    const MOTIF = 'TEST correction des heures lot W';
    const corpsCorrection = (nbrHeures, extra = {}) => ({ nbrHeures, motifCorrection: MOTIF, ...extra });

    // --- Appels ---
    // Le corps est calculé par l'appelant, avant `request(app)` : une exception levée en le construisant laisserait ouvert le
    // serveur éphémère de supertest.
    const appeler = (methode, chemin, auth, corps) => {
      const requete = request(app)[methode](chemin);
      if (auth) requete.set(auth);
      return corps === undefined ? requete : requete.send(corps);
    };
    const creer = (auth, corps) => appeler('post', '/api/heures', auth, corps);
    const corriger = (auth, id, corps) => appeler('patch', `/api/heures/${id}`, auth, corps);
    const ok = async (promesse, statut = 200) => {
      const res = await promesse;
      assert.equal(res.status, statut, `${res.req?.method} ${res.req?.path} : ${JSON.stringify(res.body)}`);
      return res.body;
    };

    // --- État de la base ---
    const empreinte = () => empreinteBase(prisma, tables);
    const pointageEnBase = (id) => prisma.pointageHeure.findUnique({ where: { id } });
    const pointagesDu = (chantierId) => prisma.pointageHeure.findMany({ where: { chantierId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const journalDe = (filtre) => prisma.journalSaisieChantier.findMany({
      where: filtre, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { chantierId: true, interventionId: true, contratMaintenanceId: true, cible: true, cibleId: true, action: true, auteurId: true, auteurNom: true, avant: true, apres: true, motif: true },
    });
    // Instantané d'un pointage tel que le journal l'écrit (valeurJournal) : décimaux en nombres, dates en ISO.
    const instantane = (ligne) => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(ligne).map(([cle, valeur]) => [cle, Decimal.isDecimal(valeur) ? valeur.toNumber() : valeur]))));

    // Un refus : statut et corps exacts ; aucune écriture dans toute la base ; pointages et journal des saisies du chantier
    // relus identiques (`updatedAt` compris).
    const refuse = async (envoi, statut, message, quoi, chantierId) => {
      const avant = await empreinte();
      const pointagesAvant = chantierId ? await pointagesDu(chantierId) : null;
      const journalAvant = chantierId ? await journalDe({ chantierId }) : null;
      const res = await envoi();
      assert.equal(res.status, statut, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, { error: message }, quoi);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      if (chantierId) {
        assert.deepEqual(await pointagesDu(chantierId), pointagesAvant, `${quoi} : pointages du chantier inchangés`);
        assert.deepEqual(await journalDe({ chantierId }), journalAvant, `${quoi} : journal des saisies inchangé`);
      }
      return res;
    };

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
      const client = await import('@prisma/client');
      Decimal = client.Prisma.Decimal;
      prisma = new client.PrismaClient({ datasources: { db: { url: cible.toString() } } });
      jwt = (await import('jsonwebtoken')).default;
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      tables = await tablesDeLaBase(prisma);
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      const secours = await prisma.user.findUniqueOrThrow({ where: { email: 'secours@iris.test' } });
      assert.equal(secours.role, 'SUPERADMIN');
      comptes.SA = { ...secours, auth: entete(connexion.body.token) };
      // Comptes qui écrivent des heures (chantiers:write) : administration (super administrateur, administrateur, directeur),
      // conducteur titulaire, responsable de sa branche, assistante technique (affaires en cours de la société) ; un second
      // conducteur, hors périmètre ; un commercial et un technicien, sans chantiers:write.
      await creerCompte('AD', 'ADMIN');
      await creerCompte('DIR', 'DIRECTEUR');
      await creerCompte('RESP', 'RESPONSABLE');
      await creerCompte('CT', 'CONDUCTEUR_TRAVAUX', { responsableHierarchiqueId: comptes.RESP.id });
      await creerCompte('CT2', 'CONDUCTEUR_TRAVAUX');
      await creerCompte('AT', 'ASSISTANTE_TECHNIQUE');
      await creerCompte('COM', 'COMMERCIAL');
      await creerCompte('TECH', 'TECHNICIEN');
      fiches.base = await creerFiche('base');
      chantiers.ct = await creerChantier('du conducteur', comptes.CT.id);
      chantiers.autre = await creerChantier('d’un autre conducteur', comptes.CT2.id);
      chantiers.termine = await creerChantier('terminé', comptes.CT.id, { statut: 'TERMINE', dateFin: new Date('2026-10-20T00:00:00Z') });
      chantiers.annule = await creerChantier('annulé', comptes.CT.id, { statut: 'ANNULE' });
      // Clé d'intégration qui porte tous les scopes du domaine chantier, chantiers:write compris.
      const creation = await ok(appeler('post', '/api/admin/api-keys', comptes.SA.auth, { nom: `TEST Clé lot W ${suffixe()}`, scopes: ['chantiers:read', 'chantiers:write', 'chantiers:archive'] }), 201);
      cleEcriture = entete(creation.apiKey);
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
    // 1. Création : POST /api/heures
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, « Critères observables » : « API : les mêmes valeurs admises (et 3.25 en nombre JSON) ». Par le conducteur
    // titulaire, qui saisit sur l'écran Heures, et le super administrateur. Chaque saisie : 200, une ligne, relue exactement en
    // base et dans la réponse (Decimal sérialisé). Lectures écartées : voir ADMISES.
    for (const code of ['CT', 'SA']) {
      test(`création admise au quart d’heure par ${code === 'CT' ? 'le conducteur titulaire' : 'le super administrateur'} : « 3,25 », « 3,75 », « 0,25 », « 3,00 », « 3 », 3.25 en nombre, « 3.25 », « 7,5 » et « 99999999,75 », relus exactement en base et dans la réponse`, async () => {
        const chantier = await creerChantier(`création admise ${code}`, comptes.CT.id);
        const ids = [];
        for (const [quoi, envoye, enBase] of ADMISES) {
          const corps = corpsCreation(chantier.id, envoye);
          const cree = await ok(creer(comptes[code].auth, corps));
          ids.push(cree.id);
          assert.equal(cree.nbrHeures, enBase, `${code}, ${quoi} : réponse`);
          assert.equal((await pointageEnBase(cree.id)).nbrHeures.toString(), enBase, `${code}, ${quoi} : en base`);
        }
        const lignes = await pointagesDu(chantier.id);
        assert.deepEqual(lignes.map((p) => [p.id, p.nbrHeures.toString(), p.tauxHoraireApplique.toString()]), ADMISES.map(([, , enBase], i) => [ids[i], enBase, TAUX]), `${code} : une ligne par saisie, taux de la fiche copié`);
      });
    }

    // Cadrage v2, « Critères observables » : « refusées en 400 avec le message ci-dessus, sans écriture (table et journal
    // inchangés), en création ». Par le conducteur titulaire et le super administrateur. Lectures écartées : voir REFUSEES ;
    // aussi une heure absente du corps admise ou lue 0. Témoin : le même corps à « 3,25 » s'enregistre (le refus tient aux
    // seules heures).
    for (const code of ['CT', 'SA']) {
      test(`création refusée hors du quart d’heure par ${code === 'CT' ? 'le conducteur titulaire' : 'le super administrateur'} : « 1,1 », « 0,2 », « 1,10 », « 0 », « 0,05 », « 3,250 », « 123456789 » et les autres formes, 400 au message du lot, rien d’écrit ; témoin « 3,25 » enregistré`, async () => {
        const chantier = await creerChantier(`création refusée ${code}`, comptes.CT.id);
        for (const [quoi, envoye] of REFUSEES) {
          const corps = corpsCreation(chantier.id, envoye);
          await refuse(() => creer(comptes[code].auth, corps), 400, MESSAGES.quartDHeure, `${code}, ${quoi}`, chantier.id);
        }
        const { nbrHeures: _absent, ...sansHeures } = corpsCreation(chantier.id, '3,25');
        await refuse(() => creer(comptes[code].auth, sansHeures), 400, MESSAGES.quartDHeure, `${code}, heures absentes`, chantier.id);
        assert.equal(await prisma.pointageHeure.count({ where: { chantierId: chantier.id } }), 0, `${code} : aucun pointage`);
        assert.equal(await prisma.journalSaisieChantier.count({ where: { chantierId: chantier.id } }), 0, `${code} : journal vide`);
        const temoin = await ok(creer(comptes[code].auth, corpsCreation(chantier.id, '3,25')));
        assert.deepEqual((await pointagesDu(chantier.id)).map((p) => [p.id, p.nbrHeures.toString()]), [[temoin.id, '3.25']], `${code} : témoin`);
      });
    }

    // ---------------------------------------------------------------------------------------------------------------
    // 2. Correction : PATCH /api/heures/:id
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, point 1 et « Critères observables » : en correction aussi. Avant chaque correction, le pointage est remis à
    // 7,5 h (valeur de départ distincte de toute saisie) : chaque relecture prouve une écriture, même quand deux saisies
    // successives donnent la même valeur (« 3,25 » puis 3.25). Le taux figé ne change pas (seul un changement d'intervenant le
    // réapplique). Lectures écartées : voir ADMISES ; aussi le contrôle du lot réservé à la création.
    for (const code of ['CT', 'SA']) {
      test(`correction admise au quart d’heure par ${code === 'CT' ? 'le conducteur titulaire' : 'le super administrateur'} : les mêmes saisies relues exactement en base et dans la réponse, taux figé inchangé`, async () => {
        const chantier = await creerChantier(`correction admise ${code}`, comptes.CT.id);
        const pointage = await poserPointage(chantier.id);
        for (const [quoi, envoye, enBase] of ADMISES) {
          await prisma.pointageHeure.update({ where: { id: pointage.id }, data: { nbrHeures: DEPART } });
          const corps = corpsCorrection(envoye);
          const corrige = await ok(corriger(comptes[code].auth, pointage.id, corps));
          assert.equal(corrige.nbrHeures, enBase, `${code}, ${quoi} : réponse`);
          const relu = await pointageEnBase(pointage.id);
          assert.deepEqual([relu.nbrHeures.toString(), relu.tauxHoraireApplique.toString(), relu.archivedAt], [enBase, TAUX, null], `${code}, ${quoi} : en base`);
        }
        assert.equal(await prisma.journalSaisieChantier.count({ where: { cibleId: pointage.id, action: 'CORRECTION' } }), ADMISES.length, `${code} : une correction journalisée par saisie`);
      });
    }

    // Cadrage v2, « Critères observables » : « refusées en 400 avec le message ci-dessus, sans écriture (table et journal
    // inchangés), en […] correction ». Lectures écartées : voir REFUSEES ; aussi le contrôle du lot réservé à la création.
    // Témoin : la même correction à « 3,75 » s'enregistre.
    for (const code of ['CT', 'SA']) {
      test(`correction refusée hors du quart d’heure par ${code === 'CT' ? 'le conducteur titulaire' : 'le super administrateur'} : les mêmes formes, 400 au message du lot, pointage, journal et base inchangés ; témoin « 3,75 » enregistré`, async () => {
        const chantier = await creerChantier(`correction refusée ${code}`, comptes.CT.id);
        const pointage = await poserPointage(chantier.id);
        for (const [quoi, envoye] of REFUSEES) {
          const corps = corpsCorrection(envoye, { commentaire: 'TEST commentaire qui ne doit pas être écrit' });
          await refuse(() => corriger(comptes[code].auth, pointage.id, corps), 400, MESSAGES.quartDHeure, `${code}, ${quoi}`, chantier.id);
        }
        const relu = await pointageEnBase(pointage.id);
        assert.deepEqual([relu.nbrHeures.toString(), relu.commentaire, relu.updatedAt.toISOString()], ['7.5', 'TEST pointage de départ lot W', pointage.updatedAt.toISOString()], `${code} : pointage de départ intact`);
        assert.equal(await prisma.journalSaisieChantier.count({ where: { cibleId: pointage.id } }), 0, `${code} : journal vide`);
        await ok(corriger(comptes[code].auth, pointage.id, corpsCorrection('3,75')));
        assert.equal((await pointageEnBase(pointage.id)).nbrHeures.toString(), '3.75', `${code} : témoin`);
      });
    }

    // ---------------------------------------------------------------------------------------------------------------
    // 3. Journal des saisies : création et correction exactes
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, « Tests » : « journal de création et de correction exact ». Une création à « 3,25 » puis une correction à
    // « 0,25 » par le conducteur titulaire : deux entrées, au nom et à l'identifiant de l'auteur, cible HEURE, pointage avant et
    // après relus en base (heures en nombre, 3,25 puis 0,25), motif de la correction. Lectures écartées : un journal qui
    // garderait la saisie brute (« 3,25 », chaîne) au lieu de la valeur enregistrée ; une correction journalisée sans son
    // « avant » ; une entrée de plus pour une saisie refusée entre les deux (« 0,2 »).
    test('journal des saisies : création à « 3,25 » puis correction à « 0,25 » journalisées exactement (auteur, avant, après, motif) ; la correction refusée entre les deux n’écrit rien', async () => {
      const chantier = await creerChantier('journal', comptes.CT.id);
      const cree = await ok(creer(comptes.CT.auth, corpsCreation(chantier.id, '3,25')));
      const apresCreation = await pointageEnBase(cree.id);
      await refuse(() => corriger(comptes.CT.auth, cree.id, corpsCorrection('0,2')), 400, MESSAGES.quartDHeure, '« 0,2 » entre les deux', chantier.id);
      await pause(5);
      await ok(corriger(comptes.CT.auth, cree.id, corpsCorrection('0,25')));
      const apresCorrection = await pointageEnBase(cree.id);
      assert.equal(apresCorrection.nbrHeures.toString(), '0.25');
      const commun = { chantierId: chantier.id, interventionId: null, contratMaintenanceId: null, cible: 'HEURE', cibleId: cree.id, auteurId: comptes.CT.id, auteurNom: comptes.CT.name };
      assert.deepEqual(await journalDe({ chantierId: chantier.id }), [
        { ...commun, action: 'CREATION', avant: null, apres: instantane(apresCreation), motif: null },
        { ...commun, action: 'CORRECTION', avant: instantane(apresCreation), apres: instantane(apresCorrection), motif: MOTIF },
      ]);
      const [creation, correction] = await journalDe({ chantierId: chantier.id });
      assert.deepEqual([creation.apres.nbrHeures, correction.avant.nbrHeures, correction.apres.nbrHeures, correction.apres.tauxHoraireApplique], [3.25, 3.25, 0.25, 37.85], 'heures et taux en nombres');
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 4. Coût de la main-d'œuvre et marge : heures × taux figé, inchangés
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, « Critères observables » : « Coût d'une ligne et marge : heures × taux, inchangés » ; point 5 : « Aucun
    // calcul ». Deux saisies, « 3,25 » h et « 0,25 » h, au taux de 37,85 € copié de la fiche ; puis la fiche passe à 52 €
    // (modifiée après coup) et la première ligne est corrigée à « 3,75 » h : elle garde son taux figé.
    //  - Après les créations : 3,5 h ; main-d'œuvre 3,25 × 37,85 + 0,25 × 37,85 = 123,0125 + 9,4625 = 132,475 € ; marge
    //    1 000 − 132,475 = 867,525 €. Lectures écartées : un arrondi au centime par ligne (123,01 + 9,46 = 132,47) ; « 3,25 »
    //    lu 3 h (113,55 + 9,4625 = 123,0125) ou 3,5 h (132,475 + 9,4625 = 141,9375) ou 3,3 h (124,905 + 9,4625 = 134,3675) ;
    //    « 0,25 » refusé (123,0125 seul).
    //  - Après la correction : 4 h ; 3,75 × 37,85 + 9,4625 = 141,9375 + 9,4625 = 151,40 € ; marge 848,60 €. Lectures
    //    écartées : le taux de la fiche réappliqué (3,75 × 52 + 9,4625 = 204,4625) ; la correction ignorée (132,475).
    test('coût et marge : « 3,25 » h et « 0,25 » h à 37,85 € font 132,475 € de main-d’œuvre ; corrigée à « 3,75 » h après une hausse de la fiche à 52 €, la ligne garde son taux figé : 151,40 €, marge 848,60 €', async () => {
      const fiche = await creerFiche('coût');
      const chantier = await creerChantier('coût', comptes.CT.id);
      const metriques = async () => (await ok(appeler('get', `/api/chantiers/${chantier.id}`, comptes.SA.auth))).metrics;
      const premiere = await ok(creer(comptes.CT.auth, corpsCreation(chantier.id, '3,25', { intervenantId: fiche.id })));
      await ok(creer(comptes.CT.auth, corpsCreation(chantier.id, '0,25', { intervenantId: fiche.id })));
      const avant = await metriques();
      assert.deepEqual([avant.heuresRealisees, avant.moReel, avant.totalDepenses, avant.margeBrute], [3.5, 132.475, 132.475, 867.525]);
      await prisma.intervenant.update({ where: { id: fiche.id }, data: { tauxHoraireCharge: '52' } });
      await ok(corriger(comptes.CT.auth, premiere.id, corpsCorrection('3,75')));
      assert.equal((await pointageEnBase(premiere.id)).tauxHoraireApplique.toString(), TAUX, 'taux figé à la saisie');
      const apres = await metriques();
      assert.deepEqual([apres.heuresRealisees, apres.moReel, apres.totalDepenses, apres.margeBrute], [4, 151.4, 151.4, 848.6]);
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 5. Données existantes hors du quart d'heure (cadrage v2, point 4 ; règle 4 : aucune reprise)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, « Tests » : « une heure posée en base à 1,1 h puis corrigée par un PATCH sans nbrHeures : admise et
    // inchangée » ; point 4 : « Une ligne antérieure hors quart d'heure ne se corrige par le journal qu'en changeant ses heures ;
    // elle peut s'archiver et se ressaisir ». Un pointage à 1,1 h (possible avant le lot, au centième) :
    //  - une correction du seul commentaire, puis de la seule date, est admise, ses heures restent 1,1 h (journal : 1,1 avant
    //    et après) ; lectures écartées : un contrôle des heures déjà en base (refus), ou une reprise silencieuse (1 h, 1,25 h) ;
    //  - renvoyer « 1,1 » tel quel (ce que ferait le formulaire du journal, pré-rempli) est refusé, rien n'est écrit ;
    //  - l'archivage et la restauration, qui ne lisent pas les heures, sont admis, heures inchangées ;
    //  - une correction à « 1,25 » est admise.
    test('heure enregistrée à 1,1 h avant le lot : correction sans nbrHeures admise, heures inchangées ; « 1,1 » renvoyé refusé ; archivage et restauration admis ; « 1,25 » admis', async () => {
      const chantier = await creerChantier('donnée existante', comptes.CT.id);
      const pointage = await poserPointage(chantier.id, '1.1');
      const commentaire = await ok(corriger(comptes.CT.auth, pointage.id, { commentaire: 'TEST commentaire corrigé lot W', motifCorrection: MOTIF }));
      assert.equal(commentaire.nbrHeures, '1.1', 'réponse');
      let relu = await pointageEnBase(pointage.id);
      assert.deepEqual([relu.nbrHeures.toString(), relu.commentaire], ['1.1', 'TEST commentaire corrigé lot W']);
      await ok(corriger(comptes.CT.auth, pointage.id, { date: '07-10-2026', motifCorrection: MOTIF }));
      relu = await pointageEnBase(pointage.id);
      assert.deepEqual([relu.nbrHeures.toString(), relu.date.toISOString()], ['1.1', '2026-10-07T00:00:00.000Z']);
      const journal = await journalDe({ cibleId: pointage.id });
      assert.deepEqual(journal.map((e) => [e.action, e.avant.nbrHeures, e.apres.nbrHeures]), [['CORRECTION', 1.1, 1.1], ['CORRECTION', 1.1, 1.1]], 'journal : heures inchangées');
      assert.deepEqual([journal[0].apres.commentaire, journal[1].avant.date, journal[1].apres.date], ['TEST commentaire corrigé lot W', '2026-10-05T00:00:00.000Z', '2026-10-07T00:00:00.000Z']);
      await refuse(() => corriger(comptes.CT.auth, pointage.id, corpsCorrection('1,1', { commentaire: 'TEST renvoi tel quel' })), 400, MESSAGES.quartDHeure, '« 1,1 » renvoyé tel quel', chantier.id);
      await ok(appeler('delete', `/api/heures/${pointage.id}`, comptes.SA.auth, { motifArchivage: 'TEST archivage lot W' }));
      assert.equal((await pointageEnBase(pointage.id)).nbrHeures.toString(), '1.1', 'archivé, heures inchangées');
      const restaure = await ok(appeler('post', `/api/heures/${pointage.id}/restaurer`, comptes.SA.auth, { motifRestauration: 'TEST restauration lot W' }));
      assert.equal(restaure.nbrHeures, '1.1', 'restauré, heures inchangées');
      await ok(corriger(comptes.CT.auth, pointage.id, corpsCorrection('1,25')));
      assert.equal((await pointageEnBase(pointage.id)).nbrHeures.toString(), '1.25');
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 6. Chaque type de compte qui écrit des heures
    // ---------------------------------------------------------------------------------------------------------------

    // La règle vaut pour tout compte qui écrit des heures d'un chantier (chantiers:write ; cadrage v2, point 5 : aucun droit ne
    // change) : administrateur, directeur, responsable (chantier de son conducteur), assistante technique (affaire en cours),
    // en plus du conducteur titulaire et du super administrateur joués ci-dessus. Pour chacun : création « 3,25 » admise et
    // « 1,1 » refusée ; correction « 3,75 » admise et « 0,2 » refusée. Lecture écartée : un compte d'encadrement dispensé du
    // contrôle (centième admis).
    test('chaque compte qui écrit des heures : administrateur, directeur, responsable et assistante technique, « 3,25 » et « 3,75 » admis, « 1,1 » et « 0,2 » refusés sans écriture', async () => {
      for (const code of ['AD', 'DIR', 'RESP', 'AT']) {
        const chantier = await creerChantier(`compte ${code}`, comptes.CT.id);
        await refuse(() => creer(comptes[code].auth, corpsCreation(chantier.id, '1,1')), 400, MESSAGES.quartDHeure, `${code}, création « 1,1 »`, chantier.id);
        const cree = await ok(creer(comptes[code].auth, corpsCreation(chantier.id, '3,25')));
        await refuse(() => corriger(comptes[code].auth, cree.id, corpsCorrection('0,2')), 400, MESSAGES.quartDHeure, `${code}, correction « 0,2 »`, chantier.id);
        await ok(corriger(comptes[code].auth, cree.id, corpsCorrection('3,75')));
        assert.deepEqual((await pointagesDu(chantier.id)).map((p) => [p.id, p.nbrHeures.toString(), p.createdById]), [[cree.id, '3.75', comptes[code].id]], code);
      }
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 7. Ordre des refus, inchangé (cadrage v2, point 1 : « Contrôle au même endroit que la lecture actuelle »)
    // ---------------------------------------------------------------------------------------------------------------

    // Joué avec « 1,1 » (refusé par le lot) et « 0 » (refusé avant comme après le lot : sur afed682, même statut à chaque cas,
    // au message d'avant « Le nombre d’heures doit être strictement positif. »). POST, dans l'ordre de main : session (401),
    // chantiers:write (403), date (400), heures (400), puis intervenant (404) et chantier (404 hors périmètre, 409 annulé,
    // 403 clôturé) : les heures sont jugées avant l'intervenant et le périmètre (« validation-avant-droit » des matrices).
    // Lectures écartées : le contrôle du lot passé devant le droit (400 au lieu de 403) ou derrière le périmètre (404, 409
    // ou 403 au lieu de 400) ; un 404 qui révélerait l'ordre autrement ; une écriture.
    for (const [quoi, valeur] of [['« 1,1 »', '1,1'], ['« 0 »', '0']]) {
      test(`création, ordre des refus avec ${quoi} : session, droit et date avant les heures ; les heures avant l’intervenant et le périmètre ; rien d’écrit`, async () => {
        const surCt = corpsCreation(chantiers.ct.id, valeur);
        await refuse(() => creer(null, surCt), 401, MESSAGES.authentification, 'sans session', chantiers.ct.id);
        await refuse(() => creer(cleEcriture, surCt), 401, MESSAGES.sessionInvalide, 'clé chantiers:write sur la route de session', chantiers.ct.id);
        await refuse(() => creer(comptes.COM.auth, surCt), 403, MESSAGES.permission, 'commercial', chantiers.ct.id);
        await refuse(() => creer(comptes.TECH.auth, surCt), 403, MESSAGES.permission, 'technicien', chantiers.ct.id);
        const dateFausse = corpsCreation(chantiers.ct.id, valeur, { date: '31-02-2026' });
        await refuse(() => creer(comptes.CT.auth, dateFausse), 400, MESSAGES.date, 'date invalide', chantiers.ct.id);
        const cas = [
          ['intervenant inconnu', corpsCreation(chantiers.ct.id, valeur, { intervenantId: randomUUID() }), chantiers.ct.id],
          ['chantier inconnu', corpsCreation(randomUUID(), valeur), null],
          ['chantier hors périmètre', corpsCreation(chantiers.autre.id, valeur), chantiers.autre.id],
          ['chantier annulé', corpsCreation(chantiers.annule.id, valeur), chantiers.annule.id],
          ['chantier terminé', corpsCreation(chantiers.termine.id, valeur), chantiers.termine.id],
        ];
        for (const [nom, corps, chantierId] of cas) await refuse(() => creer(comptes.CT.auth, corps), 400, MESSAGES.quartDHeure, `${quoi}, ${nom}`, chantierId);
        // Témoins : les mêmes corps à « 3,25 » reçoivent le refus suivant de l'ordre.
        const temoins = [
          ['intervenant inconnu', corpsCreation(chantiers.ct.id, '3,25', { intervenantId: randomUUID() }), 404, MESSAGES.intervenant, chantiers.ct.id],
          ['chantier inconnu', corpsCreation(randomUUID(), '3,25'), 404, MESSAGES.chantier, null],
          ['chantier hors périmètre', corpsCreation(chantiers.autre.id, '3,25'), 404, MESSAGES.chantier, chantiers.autre.id],
          ['chantier annulé', corpsCreation(chantiers.annule.id, '3,25'), 409, MESSAGES.annulee, chantiers.annule.id],
          ['chantier terminé', corpsCreation(chantiers.termine.id, '3,25'), 403, MESSAGES.cloture, chantiers.termine.id],
        ];
        for (const [nom, corps, statut, message, chantierId] of temoins) await refuse(() => creer(comptes.CT.auth, corps), statut, message, `témoin « 3,25 », ${nom}`, chantierId);
      });
    }

    // PATCH, dans l'ordre de main : session et chantiers:write, pointage (404), périmètre du chantier (404 hors périmètre,
    // 409 annulé, 403 clôturé pour le conducteur), pointage archivé (409), motif (400), date (400), puis heures (400), puis
    // intervenant (404). Lectures écartées : le contrôle du lot passé devant le pointage, le périmètre, l'archivage, le motif ou
    // la date ; ou derrière l'intervenant ; une écriture. Le super administrateur, qui écrit sur un chantier terminé, y reçoit
    // le refus des heures (témoin : « 3,25 » admis).
    for (const [quoi, valeur] of [['« 1,1 »', '1,1'], ['« 0 »', '0']]) {
      test(`correction, ordre des refus avec ${quoi} : pointage, périmètre, archivage, motif et date avant les heures ; les heures avant l’intervenant ; rien d’écrit`, async () => {
        const surCt = await poserPointage(chantiers.ct.id);
        const surAutre = await poserPointage(chantiers.autre.id);
        const surAnnule = await poserPointage(chantiers.annule.id);
        const surTermine = await poserPointage(chantiers.termine.id);
        const archive = await poserPointage(chantiers.ct.id, DEPART, { archivedAt: new Date(), archivedById: comptes.SA.id, motifArchivage: 'TEST archivé lot W' });
        const corps = corpsCorrection(valeur);
        await refuse(() => corriger(null, surCt.id, corps), 401, MESSAGES.authentification, 'sans session', chantiers.ct.id);
        await refuse(() => corriger(cleEcriture, surCt.id, corps), 401, MESSAGES.sessionInvalide, 'clé chantiers:write sur la route de session', chantiers.ct.id);
        await refuse(() => corriger(comptes.COM.auth, surCt.id, corps), 403, MESSAGES.permission, 'commercial', chantiers.ct.id);
        await refuse(() => corriger(comptes.CT.auth, randomUUID(), corps), 404, MESSAGES.pointage, 'pointage inconnu', null);
        await refuse(() => corriger(comptes.CT.auth, surAutre.id, corps), 404, MESSAGES.chantier, 'chantier hors périmètre', chantiers.autre.id);
        await refuse(() => corriger(comptes.CT.auth, surAnnule.id, corps), 409, MESSAGES.annulee, 'chantier annulé', chantiers.annule.id);
        await refuse(() => corriger(comptes.CT.auth, surTermine.id, corps), 403, MESSAGES.cloture, 'chantier terminé, conducteur', chantiers.termine.id);
        await refuse(() => corriger(comptes.CT.auth, archive.id, corps), 409, MESSAGES.archive, 'pointage archivé', chantiers.ct.id);
        const { motifCorrection: _motif, ...sansMotif } = corps;
        await refuse(() => corriger(comptes.CT.auth, surCt.id, sansMotif), 400, MESSAGES.motif, 'sans motif', chantiers.ct.id);
        await refuse(() => corriger(comptes.CT.auth, surCt.id, { ...corps, date: '31-02-2026' }), 400, MESSAGES.date, 'date invalide', chantiers.ct.id);
        await refuse(() => corriger(comptes.CT.auth, surCt.id, { ...corps, intervenantId: randomUUID() }), 400, MESSAGES.quartDHeure, `${quoi}, intervenant inconnu`, chantiers.ct.id);
        await refuse(() => corriger(comptes.SA.auth, surTermine.id, corps), 400, MESSAGES.quartDHeure, `${quoi}, chantier terminé, super administrateur`, chantiers.termine.id);
        // Témoins à « 3,25 » : l'intervenant inconnu reçoit le refus suivant ; le super administrateur corrige le terminé.
        await refuse(() => corriger(comptes.CT.auth, surCt.id, corpsCorrection('3,25', { intervenantId: randomUUID() })), 404, MESSAGES.intervenant, 'témoin « 3,25 », intervenant inconnu', chantiers.ct.id);
        await ok(corriger(comptes.SA.auth, surTermine.id, corpsCorrection('3,25')));
        assert.equal((await pointageEnBase(surTermine.id)).nbrHeures.toString(), '3.25', 'témoin : le super administrateur corrige un chantier terminé');
      });
    }

    // ---------------------------------------------------------------------------------------------------------------
    // 8. Clé d'intégration : aucune route n'écrit d'heures d'un chantier
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, point 1 : « Seules ces deux routes écrivent des heures d'un chantier » (la porte /api/v1 n'a que la lecture,
    // GET /api/v1/heures). Une clé qui porte chantiers:write ne trouve ni POST /api/v1/heures ni PATCH /api/v1/heures/:id
    // (404), avec une saisie au quart d'heure comme hors du quart d'heure ; rien n'est écrit. Lecture écartée : une porte
    // d'intégration qui écrirait des heures sans le contrôle du lot.
    test('clé d’intégration chantiers:write : ni création ni correction d’heures par /api/v1 (404), rien d’écrit', async () => {
      const pointage = await poserPointage(chantiers.ct.id);
      for (const valeur of ['3,25', '1,1']) {
        const creation = corpsCreation(chantiers.ct.id, valeur);
        const avant = await empreinte();
        const res = await appeler('post', '/api/v1/heures', cleEcriture, creation);
        assert.equal(res.status, 404, `POST /api/v1/heures « ${valeur} »`);
        const correction = await appeler('patch', `/api/v1/heures/${pointage.id}`, cleEcriture, corpsCorrection(valeur));
        assert.equal(correction.status, 404, `PATCH /api/v1/heures/:id « ${valeur} »`);
        assert.deepEqual(tablesChangees(avant, await empreinte()), [], `« ${valeur} » : rien d’écrit`);
      }
      assert.equal((await pointageEnBase(pointage.id)).nbrHeures.toString(), '7.5');
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 9. Règle du serveur sur tout le domaine, en centièmes entiers (audit des montants de #669)
    // ---------------------------------------------------------------------------------------------------------------

    // heuresAuQuartDHeure lit un nombre flottant, puis le passe en centièmes par Math.round (saisies.ts). Les saisies des
    // sections 1 et 2 ne jouent que quelques valeurs ; le test client (saisiesDecimales.test.ts) compare le motif à une copie
    // de la règle, et non au serveur. Ici, la fonction compilée du serveur est comparée à la même règle écrite en centièmes
    // entiers (BigInt), sans flottant : chaque saisie à 0, 1 ou 2 décimales, à la virgule et au point, pour les entiers de 0 à
    // 2 000, autour de 16 384 (2^14 : « 16383,01 » × 100 tombe juste, « 16384,01 » × 100 juste sous l'entier) et en haut du
    // domaine (99 998 000 à 99 999 999), et les mêmes valeurs en nombre JSON. Lectures écartées : des centièmes tronqués (Math.floor, Math.trunc :
    // « 2,01 », « 2,26 », « 2,51 », « 16384,01 » admis) ou pris par excès (Math.ceil : « 2,24 », « 2,49 » admis), et toute
    // autre lecture flottante qui s'écarterait du quart d'heure exact.
    test('règle du serveur exacte sur tout le domaine : heuresAuQuartDHeure comparée à la règle en centièmes entiers, à la virgule, au point et en nombre', async () => {
      const module = await import('../dist/src/domaines/chantiers/saisies.js');
      const heuresAuQuartDHeure = module.heuresAuQuartDHeure ?? module.default.heuresAuQuartDHeure;
      assert.equal(typeof heuresAuQuartDHeure, 'function');
      const exacte = (texte) => {
        const lu = /^(\d{1,8})(?:[,.](\d{1,2}))?$/.exec(texte);
        if (!lu) return false;
        const centiemes = BigInt(lu[1]) * 100n + BigInt((lu[2] ?? '').padEnd(2, '0'));
        return centiemes > 0n && centiemes % 25n === 0n;
      };
      const ecarts = [];
      let saisies = 0;
      const comparer = (valeur, texte) => {
        saisies += 1;
        if ((heuresAuQuartDHeure(valeur) !== null) !== exacte(texte) && ecarts.length < 10) ecarts.push(typeof valeur === 'number' ? `${texte} en nombre` : `« ${texte} »`);
      };
      const fractions = [...Array.from({ length: 10 }, (_, i) => String(i)), ...Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'))];
      const entiers = [
        ...Array.from({ length: 2001 }, (_, i) => i),
        ...Array.from({ length: 21 }, (_, i) => 16_374 + i),
        ...Array.from({ length: 2000 }, (_, i) => 99_998_000 + i),
      ];
      for (const entier of entiers) {
        comparer(String(entier), String(entier));
        for (const fraction of fractions) {
          for (const separateur of [',', '.']) comparer(`${entier}${separateur}${fraction}`, `${entier}${separateur}${fraction}`);
          const nombre = Number(`${entier}.${fraction}`);
          comparer(nombre, String(nombre));
        }
      }
      assert.deepEqual(ecarts, [], `écarts entre le serveur et la règle exacte (${saisies} saisies)`);
      // Témoins nommés : chacun admis par l'une des lectures écartées, refusé par le serveur ; les quarts voisins admis.
      assert.deepEqual(['2,01', '2,26', '2,51', '16384,01', '2,24', '2,49', 2.01, 2.24].map((v) => heuresAuQuartDHeure(v)), [null, null, null, null, null, null, null, null]);
      assert.deepEqual(['2', '2,25', '2,5', '16384', '2,75', 2.25].map((v) => heuresAuQuartDHeure(v)), [2, 2.25, 2.5, 16384, 2.75, 2.25]);
    });
  });
}
