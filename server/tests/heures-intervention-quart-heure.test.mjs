// Lot Z : heures d'une intervention saisies au quart d'heure, zéro compris avec son motif obligatoire (réponse de Nelson du
// 23-11-2026, mot pour mot : « les heures sur une intervention Passe au quart d'heure » ; lecture retenue, à corriger par Nelson
// si besoin : toutes les heures saisies sur une intervention, curative, visite de contrat, suite, intervention issue d'un devis).
// Cadrage v2 du lot Z, après le contrôle de cohérence de mode 1 sur afed682 (section « Cadrage v2 », points 0 à 6, « Critères
// observables » et « Tests ») ; règle 2 de la méthode : le lot touche un montant, le coût de la main-d'œuvre d'une intervention,
// donc la marge SAV, la facture au temps passé et la marge d'un chantier (classé C).
//
// Ce que le lot change côté serveur, et que ce fichier prouve par des requêtes HTTP réelles sur une base PostgreSQL jetable :
//  - POST /api/interventions/:id/couts/heures et PATCH /api/interventions/:id/couts/heures/:coutId (quand `nbrHeures` est dans le
//    corps) n'admettent que des quarts d'heure, zéro compris : `heuresAuQuartDHeure(v, true)` (commun/validation.ts), soit la
//    lecture commune `nombreDecimalNonNegatif(v, 8, true)` (virgule ou point, huit chiffres, deux décimales), puis un multiple
//    de 0,25 (cadrage v2, point 2 : « Serveur juge ») ; aucune valeur n'est arrondie ;
//  - un seul refus des heures, 400 « Le nombre d’heures se saisit au quart d’heure (par exemple 1,25). », sans écriture
//    (empreinte de toute la base, heures et journal de l'intervention relus identiques) ;
//  - en création, le refus combiné « Date ou nombre d’heures invalide. » est scindé, date d'abord : une date illisible reçoit
//    « La date doit être valide au format JJ-MM-AAAA. » (le message de la correction), puis les heures leur refus ;
//  - zéro reste admis, avec son motif obligatoire en création (règle et message inchangés), avec le motif de correction en
//    correction (point 2, « Zéro gardé ») ;
//  - le contrôle est au même endroit que l'ancienne lecture : l'ordre des refus est celui de main (404, 403, 409 et refus de
//    l'affaire d'une suite avant les heures en création, puis la date ; motif de correction et date avant les heures en
//    correction) ;
//  - une heure déjà enregistrée hors du quart d'heure reste telle quelle (point 6, règle 4 : aucune reprise) ;
//  - le matériel garde sa lecture et son message (« Montant invalide. ») ; aucune route d'intégration n'écrit d'heures d'une
//    intervention (inventaire du contrôle : « ni /api/v1 (aucune route d'intervention) »).
// Montants (point 5 : « Aucun calcul ne change ») : le coût d'une ligne reste heures × taux figé, arrondi au centime ligne par
// ligne dans les coûts de l'intervention, exact dans la marge du chantier d'une suite ; chaque valeur est choisie pour qu'une
// autre lecture plausible donne un autre résultat, et la lecture écartée est écrite en commentaire.
//
// Fichier propre au lot, avec sa base jetable (modèle : heures-quart-heure.test.mjs, lot W) : `node --test` exécute les fichiers
// en parallèle, et api.test.mjs purge les données « TEST » de TEST_DATABASE_URL. TEST_DATABASE_URL ne sert ici que de connexion
// administrative : une base neuve est créée, migrée, servie à l'application montée en mémoire, puis supprimée. Sans
// TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { empreinteBase, tablesChangees, tablesDeLaBase } from './matrice-droits/outils.mjs';

const TITRE = 'Lot Z : heures d’une intervention saisies au quart d’heure, zéro compris avec son motif (POST et PATCH /api/interventions/:id/couts/heures)';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MESSAGES = {
  // Cadrage v2, point 2 : `REFUS_HEURES_INTERVENTION`, même racine que le message du lot W, sans plancher (zéro admis).
  quartDHeure: 'Le nombre d’heures se saisit au quart d’heure (par exemple 1,25).',
  // Cadrage v2, point 2 : message de la correction, repris par la création quand la date est illisible.
  date: 'La date doit être valide au format JJ-MM-AAAA.',
  dateFuture: 'Des heures se déclarent une fois faites : la date ne peut pas dépasser aujourd’hui.',
  zeroSansMotif: 'Un motif de 3 à 500 caractères est obligatoire pour zéro heure.',
  motifCorrection: 'Le motif de correction doit contenir entre 3 et 500 caractères.',
  authentification: 'Authentification requise',
  sessionInvalide: 'Session expirée ou invalide',
  commercial: 'Accès non autorisé pour un compte commercial.',
  intervention: 'Intervention introuvable.',
  reserveeTechnicien: 'Saisie d’heures réservée au technicien affecté.',
  accesNonAutorise: 'Accès non autorisé.',
  nonEligible: 'Cette intervention ne peut pas recevoir de coûts.',
  suiteCloturee: 'Le chantier de cette suite est clôturé : ses coûts ne peuvent plus être saisis ni modifiés.',
  suiteAnnulee: 'L’affaire de cette suite est annulée : plus aucun coût ne peut y être saisi.',
  coutIntrouvable: 'Coût introuvable.',
  coutArchive: 'Un coût archivé ne peut pas être corrigé.',
  montantInvalide: 'Montant invalide.',
};

// Saisies admises (cadrage v2, « Critères observables » : « 1,25 », « 0,75 », « 0,25 », « 2 », « 2,5 », puis « 0 » et « 0,00 »
// avec un motif ; API : « 1.25 et 0 en nombre JSON compris »), avec la valeur relue en base (`toString()` du Decimal) ; la
// réponse porte le même nombre. Le dernier champ dit si la saisie est un zéro (envoyé avec son motif). Chaque saisie écarte au
// moins une lecture :
const ADMISES = [
  // Quart d'heure : écarte le refus du quart (pas de 0,50), une virgule ignorée (125 h), une lecture arrêtée à la virgule
  // (1 h), un arrondi au dixième (1,3 h) ou à la demi-heure (1,5 h).
  ['« 1,25 »', '1,25', '1.25', false],
  // Trois quarts : écarte un motif qui n'admettrait que « 25 » ou « 50 », un arrondi au dixième (0,8 h).
  ['« 0,75 »', '0,75', '0.75', false],
  // Premier quart : écarte un plancher de 0,5 h ou d'une heure, un arrondi au dixième (0,3 h).
  ['« 0,25 »', '0,25', '0.25', false],
  // Entier : écarte une décimale exigée.
  ['« 2 »', '2', '2', false],
  // Une seule décimale « 5 » : écarte un refus de « ,5 » (deux décimales exigées).
  ['« 2,5 »', '2,5', '2.5', false],
  // Deux zéros après la virgule : écarte un refus de « ,00 » (motif « 25|5|75 » sans zéro).
  ['« 3,00 »', '3,00', '3', false],
  // Point : écarte une saisie lue à la seule virgule.
  ['« 1.25 » au point', '1.25', '1.25', false],
  // Nombre JSON : écarte un contrôle réservé aux chaînes, ou un refus des nombres.
  ['1.25 en nombre JSON', 1.25, '1.25', false],
  // Zéro avec son motif : écarte zéro refusé (règle du lot W reprise sans `zeroAutorise`) ; « 0,00 » écarte un zéro reconnu au
  // seul « 0 » ; 0 en nombre écarte un zéro réservé aux chaînes.
  ['« 0 » avec motif', '0', '0', true],
  ['« 0,00 » avec motif', '0,00', '0', true],
  ['0 en nombre JSON avec motif', 0, '0', true],
  // Borne de la colonne (Decimal(10, 2)) au quart d'heure : huit chiffres, « 75 » ; écarte une borne plus étroite.
  ['« 99999999,75 »', '99999999,75', '99999999.75', false],
];

// Saisies refusées (cadrage v2, « Critères observables » : « 1,1 », « 0,2 », « 1,10 », « 0,05 », « 3,250 », « 123456789 »,
// « -0,25 »), chacune au message unique du lot. Elles partent avec un motif : un arrondi à zéro (« 0,05 » lu 0) serait sinon
// refusé par le motif de zéro, et non par le contrôle du lot. Chaque saisie écarte au moins une lecture :
const REFUSEES = [
  // Dixième : écarte le centième d'avant le lot (1,10 h enregistré), un arrondi au quart le plus proche (1 h).
  ['« 1,1 »', '1,1'],
  // Dixième sous le premier quart : écarte le centième d'avant (0,20 h), un arrondi au quart supérieur (0,25 h) ou le plus
  // proche (0,25 h).
  ['« 0,2 »', '0,2'],
  // Même valeur qu'« 1,1 », à deux décimales : écarte un contrôle du seul texte (« ,1 » refusé, « ,10 » admis).
  ['« 1,10 »', '1,10'],
  // Centième : écarte le centième d'avant (0,05 h), un arrondi au quart le plus proche (0 h, admis avec le motif envoyé).
  ['« 0,05 »', '0,05'],
  ['« 0,01 »', '0,01'],
  // Trois décimales, valeur au quart : écarte trois décimales admises (lu 3,25 h, puis jugé au quart).
  ['« 3,250 »', '3,250'],
  // Neuf chiffres, entier (multiple du quart) : écarte une colonne élargie, ou le quart jugé avant la forme.
  ['« 123456789 »', '123456789'],
  // Quart négatif : écarte une lecture en valeur absolue (0,25 h).
  ['« -0,25 »', '-0,25'],
  // Nombre JSON : écarte un contrôle réservé aux chaînes.
  ['1.1 en nombre JSON', 1.1],
  // Un centième de part et d'autre d'un quart : écarte une tolérance, ou un arrondi au quart le plus proche (1,25 h).
  ['« 1,26 »', '1,26'],
  ['« 1,24 »', '1,24'],
  // Produit flottant par 100 juste sous un entier (« 2,01 » × 100 = 200,99999999999997) ou juste au-dessus (« 2,24 » × 100 =
  // 224,00000000000003) : écarte des centièmes tronqués (200, multiple de 25) ou pris par excès (225) au lieu de Math.round.
  ['« 2,01 »', '2,01'],
  ['« 2,24 »', '2,24'],
  // Borne de la colonne hors quart : admise avant le lot (99 999 999,99 h).
  ['« 99999999,99 »', '99999999,99'],
  // Valeurs vides : écarte une valeur vide lue 0 (zéro admis avec le motif envoyé), ou un message distinct.
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
    const nomBase = `iris_test_heures_intervention_${randomBytes(6).toString('hex')}`;
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
    let cleToutesPortees = null;
    let client = null;
    let fournisseur = null;
    let rang = 0;
    const suffixe = () => `${Date.now()}-${(rang += 1)}`;
    const creerCompte = async (code, role) => {
      const s = suffixe();
      const compte = await prisma.user.create({ data: { email: `lotz.${code.toLowerCase()}.${s}@iris.test`, name: `TEST ${code} lot Z ${s}`, role } });
      comptes[code] = { ...compte, auth: entete(jwt.sign({ id: compte.id }, process.env.JWT_SECRET)) };
      return comptes[code];
    };
    // Taux horaire de la fiche du technicien, avec des centimes : 1,25 h × 37,85 € = 47,3125 €, qu'un arrondi au centime par
    // ligne change (47,31 €).
    const TAUX = '37.85';
    const creerTechnicien = async (code, taux = TAUX) => {
      const compte = await creerCompte(code, 'TECHNICIEN');
      compte.fiche = await prisma.intervenant.create({ data: { nom: `TEST Intervenant lot Z ${code} ${suffixe()}`, role: 'Technicien', tauxHoraireCharge: taux, userId: compte.id } });
      return compte;
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
    const creer = (auth, interventionId, corps) => appeler('post', `/api/interventions/${interventionId}/couts/heures`, auth, corps);
    const corriger = (auth, interventionId, coutId, corps, type = 'heures') => appeler('patch', `/api/interventions/${interventionId}/couts/${type}/${coutId}`, auth, corps);

    // Jour civil de la société (fuseau par défaut, Europe/Paris) : des heures se déclarent une fois faites, au plus aujourd'hui.
    const jour = (decalage = 0) => {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date());
      const v = (type) => parts.find((p) => p.type === type).value;
      // Jour calendaire suivant, et non « maintenant + 24 h » : le jour du passage à l'heure d'hiver dure 25 h.
      const date = new Date(`${v('year')}-${v('month')}-${v('day')}T12:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + decalage);
      const iso = date.toISOString().slice(0, 10);
      return iso.split('-').reverse().join('-');
    };
    const MOTIF_ZERO = 'TEST zéro heure lot Z, déplacement sans intervention';
    const MOTIF = 'TEST correction des heures lot Z';
    const corpsCreation = (nbrHeures, extra = {}) => ({ date: jour(), nbrHeures, commentaire: 'TEST heures lot Z', ...extra });
    const corpsCorrection = (nbrHeures, extra = {}) => ({ nbrHeures, motifCorrection: MOTIF, ...extra });

    // --- Données ---
    // Client créé par l'API (SIREN tiré au hasard, nouvel essai en cas de doublon).
    const creerClient = async () => {
      for (let essai = 1; ; essai += 1) {
        const res = await appeler('post', '/api/clients', comptes.SA.auth, { raisonSociale: `TEST Client lot Z ${suffixe()}`, siren: String(randomInt(100_000_000, 1_000_000_000)) });
        if (res.status === 409 && essai < 5) continue;
        assert.equal(res.status, 201, JSON.stringify(res.body));
        return res.body;
      }
    };
    const affecter = (interventionId, ...techniciens) => prisma.interventionAffectation.createMany({ data: techniciens.map((t) => ({ interventionId, intervenantId: t.fiche.id })) });
    // Curative hors contrat, créée par le super administrateur (encadrement du SAV), éventuellement rattachée à une affaire.
    const curative = async (titre, extra = {}) => ok(appeler('post', '/api/interventions', comptes.SA.auth, { clientId: client.id, titre: `TEST ${titre} lot Z ${suffixe()}`, ...extra }), 201);
    // Visite de l'échéance courante d'un contrat actif, créée par l'API (instantané de la couverture compris).
    const visite = async (titre) => {
      const contrat = await ok(appeler('post', '/api/contrats-maintenance', comptes.SA.auth, { clientId: client.id, titre: `TEST Contrat ${titre} lot Z ${suffixe()}`, periodiciteMois: 12, dureePrevisionnelleMinutes: 60, dateDebut: '01-01-2026' }), 201);
      const generee = await ok(appeler('post', `/api/contrats-maintenance/${contrat.id}/generer-intervention`, comptes.SA.auth, {}), 201);
      return { ...generee, contrat };
    };
    // Affaire de travaux posée en base (budget vendu 1 000 €), au client du fichier, confiée au conducteur.
    const creerChantier = (nom) => prisma.chantier.create({ data: {
      nom: `TEST Chantier lot Z ${nom} ${suffixe()}`, client: client.raisonSociale, clientId: client.id, dateDebut: new Date('2026-10-01T00:00:00Z'),
      budgetGlobalVendu: '1000', responsableId: comptes.CT.id,
    } });
    // Suite d'une intervention rattachée à une affaire en cours, créée par l'API ; ses coûts entrent dans la marge du chantier.
    const suite = async (titre) => {
      const chantier = await creerChantier(titre);
      const initiale = await curative(`${titre} initiale`, { chantierId: chantier.id });
      const creee = await ok(appeler('post', `/api/interventions/${initiale.id}/suites`, comptes.SA.auth, {}), 201);
      assert.equal(creee.interventionInitialeId, initiale.id);
      return { ...creee, chantier, initiale };
    };
    const TYPES = [
      ['curative', 'une curative hors contrat', curative],
      ['visite', 'une visite d’un contrat actif', visite],
      ['suite', 'une suite rattachée à une affaire en cours', suite],
    ];
    // Intervention du type donné, le technicien du fichier affecté.
    const nouvelle = async (type, titre, ...techniciens) => {
      const [, , fabrique] = TYPES.find(([t]) => t === type);
      const intervention = await fabrique(`${type} ${titre}`);
      await affecter(intervention.id, ...(techniciens.length ? techniciens : [comptes.TECH]));
      return intervention;
    };
    // Heure posée en base (le lot ne porte que sur la saisie par les routes) : heures de départ distinctes de toute valeur
    // envoyée, si bien qu'une écriture, même partielle, se voit.
    const DEPART = '7.5';
    const poserHeure = (interventionId, nbrHeures = DEPART, technicien = comptes.TECH, extra = {}) => prisma.coutInterventionHeure.create({ data: {
      interventionId, intervenantId: technicien.fiche.id, date: new Date('2026-10-05T00:00:00Z'), nbrHeures, tauxHoraireApplique: TAUX,
      commentaire: 'TEST heure de départ lot Z', createdById: technicien.id, ...extra,
    } });

    // --- État de la base ---
    const empreinte = () => empreinteBase(prisma, tables);
    const heureEnBase = (id) => prisma.coutInterventionHeure.findUnique({ where: { id } });
    const heuresDe = (interventionId) => prisma.coutInterventionHeure.findMany({ where: { interventionId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const journalDe = (filtre) => prisma.journalSaisieChantier.findMany({
      where: filtre, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { chantierId: true, interventionId: true, contratMaintenanceId: true, cible: true, cibleId: true, action: true, auteurId: true, auteurNom: true, avant: true, apres: true, motif: true },
    });
    // Instantané d'une heure tel que le journal l'écrit (valeurJournal) : décimaux en nombres, dates en ISO.
    const instantane = (ligne) => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(ligne).map(([cle, valeur]) => [cle, Decimal.isDecimal(valeur) ? valeur.toNumber() : valeur]))));

    // Un refus : statut et corps exacts ; aucune écriture dans toute la base ; heures et journal des saisies de l'intervention
    // relus identiques (`updatedAt` compris).
    const refuse = async (envoi, statut, message, quoi, interventionId) => {
      const avant = await empreinte();
      const heuresAvant = interventionId ? await heuresDe(interventionId) : null;
      const journalAvant = interventionId ? await journalDe({ interventionId }) : null;
      const res = await envoi();
      assert.equal(res.status, statut, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, { error: message }, quoi);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      if (interventionId) {
        assert.deepEqual(await heuresDe(interventionId), heuresAvant, `${quoi} : heures de l’intervention inchangées`);
        assert.deepEqual(await journalDe({ interventionId }), journalAvant, `${quoi} : journal des saisies inchangé`);
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
      const clientPrisma = await import('@prisma/client');
      Decimal = clientPrisma.Prisma.Decimal;
      prisma = new clientPrisma.PrismaClient({ datasources: { db: { url: cible.toString() } } });
      jwt = (await import('jsonwebtoken')).default;
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      tables = await tablesDeLaBase(prisma);
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      const secours = await prisma.user.findUniqueOrThrow({ where: { email: 'secours@iris.test' } });
      assert.equal(secours.role, 'SUPERADMIN');
      comptes.SA = { ...secours, auth: entete(connexion.body.token) };
      // Seul le technicien affecté saisit et corrige ses heures (cadrage v2, point 2 : aucun droit ne change) : un technicien
      // affecté (TECH), un collègue affecté à la même intervention (TECH2), un technicien non affecté (TECH3) ; l'encadrement
      // (administrateur, assistante technique, conducteur) et un commercial, refusés avant les heures.
      await creerTechnicien('TECH');
      await creerTechnicien('TECH2', '41');
      await creerTechnicien('TECH3');
      await creerCompte('AD', 'ADMIN');
      await creerCompte('AT', 'ASSISTANTE_TECHNIQUE');
      await creerCompte('CT', 'CONDUCTEUR_TRAVAUX');
      await creerCompte('COM', 'COMMERCIAL');
      client = await creerClient();
      fournisseur = await prisma.fournisseur.create({ data: { nom: `TEST Fournisseur lot Z ${suffixe()}` } });
      // Clé d'intégration qui porte toutes les portées (aucune ne concerne le SAV : l'inventaire du contrôle n'en relève aucune).
      const creation = await ok(appeler('post', '/api/admin/api-keys', comptes.SA.auth, { nom: `TEST Clé lot Z ${suffixe()}`, scopes: [
        'clients:read', 'clients:write', 'catalogue:read', 'catalogue:write', 'equipements:read', 'equipements:write', 'devis:read', 'devis:write',
        'company:read', 'chantiers:read', 'chantiers:write', 'chantiers:archive', 'finances:read',
      ] }), 201);
      cleToutesPortees = entete(creation.apiKey);
    });

    after(async () => {
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      try {
        for (let essai = 1; baseCreee; essai += 1) {
          // Un autovacuum peut tenir la base un instant : quelques essais, puis l'erreur.
          try { await administrationPg.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`); baseCreee = false; } catch (erreur) { if (essai >= 5) throw erreur; await pause(500); }
        }
      } finally {
        await administrationPg.end().catch(() => {});
      }
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 1. Création : POST /api/interventions/:id/couts/heures
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, « Critères observables » : « API, création […] : mêmes admis (1.25 et 0 en nombre JSON compris) » ; « Tests » :
    // « par le technicien affecté, sur une curative, une visite de contrat actif et une suite ». Chaque saisie : 201, une ligne,
    // relue exactement en base et dans la réponse, au taux de la fiche copié. Lectures écartées : voir ADMISES ; aussi le contrôle
    // réservé à un type d'intervention.
    for (const [type, libelle] of TYPES) {
      test(`création admise au quart d’heure sur ${libelle} : « 1,25 », « 0,75 », « 0,25 », « 2 », « 2,5 », « 3,00 », « 1.25 », 1.25 en nombre, « 0 », « 0,00 » et 0 avec motif, « 99999999,75 », relus exactement en base et dans la réponse`, async () => {
        const intervention = await nouvelle(type, 'création admise');
        const ids = [];
        for (const [quoi, envoye, enBase, zero] of ADMISES) {
          const corps = corpsCreation(envoye, zero ? { motif: MOTIF_ZERO } : {});
          const cree = await ok(creer(comptes.TECH.auth, intervention.id, corps), 201);
          ids.push(cree.id);
          assert.equal(cree.nbrHeures, Number(enBase), `${type}, ${quoi} : réponse`);
          assert.equal((await heureEnBase(cree.id)).nbrHeures.toString(), enBase, `${type}, ${quoi} : en base`);
        }
        const lignes = await heuresDe(intervention.id);
        assert.deepEqual(
          lignes.map((h) => [h.id, h.nbrHeures.toString(), h.tauxHoraireApplique.toString(), h.intervenantId, h.createdById, h.archivedAt]),
          ADMISES.map(([, , enBase], i) => [ids[i], enBase, TAUX, comptes.TECH.fiche.id, comptes.TECH.id, null]),
          `${type} : une ligne par saisie, au taux de la fiche`,
        );
      });
    }

    // Cadrage v2, « Critères observables » : « refus en 400 au message unique, sans écriture (heures et journal SAV relus,
    // empreinte de la base) ». Lectures écartées : voir REFUSEES ; aussi une heure absente du corps admise ou lue 0. Témoin : le
    // même corps à « 1,25 » s'enregistre (le refus tient aux seules heures).
    for (const [type, libelle] of TYPES) {
      test(`création refusée hors du quart d’heure sur ${libelle} : « 1,1 », « 0,2 », « 1,10 », « 0,05 », « 3,250 », « 123456789 », « -0,25 » et les autres formes, 400 au message du lot, rien d’écrit ; témoin « 1,25 » enregistré`, async () => {
        const intervention = await nouvelle(type, 'création refusée');
        for (const [quoi, envoye] of REFUSEES) {
          const corps = corpsCreation(envoye, { motif: MOTIF_ZERO });
          await refuse(() => creer(comptes.TECH.auth, intervention.id, corps), 400, MESSAGES.quartDHeure, `${type}, ${quoi}`, intervention.id);
        }
        const { nbrHeures: _absent, ...sansHeures } = corpsCreation('1,25', { motif: MOTIF_ZERO });
        await refuse(() => creer(comptes.TECH.auth, intervention.id, sansHeures), 400, MESSAGES.quartDHeure, `${type}, heures absentes`, intervention.id);
        assert.equal(await prisma.coutInterventionHeure.count({ where: { interventionId: intervention.id } }), 0, `${type} : aucune heure`);
        assert.equal(await prisma.journalSaisieChantier.count({ where: { interventionId: intervention.id, cible: 'COUT_INTERVENTION_HEURE' } }), 0, `${type} : aucune heure au journal`);
        const temoin = await ok(creer(comptes.TECH.auth, intervention.id, corpsCreation('1,25')), 201);
        assert.deepEqual((await heuresDe(intervention.id)).map((h) => [h.id, h.nbrHeures.toString()]), [[temoin.id, '1.25']], `${type} : témoin`);
      });
    }

    // Cadrage v2, point 2 : « Zéro gardé […] en création avec son motif obligatoire, règle et message inchangés » ; « Critères
    // observables » : « zéro sans motif en création : 400 actuel, inchangé ». « 0 », « 0,00 » et 0 en nombre, sans motif ou avec
    // un motif de deux caractères : 400 au message d'avant le lot, rien d'écrit. Lecture écartée : le contrôle du lot qui
    // dispenserait zéro de son motif, ou qui le refuserait au message des heures. Témoin : « 0 » avec un motif s'enregistre, et
    // le journal garde ce motif.
    test('zéro sans motif en création : « 0 », « 0,00 » et 0 en nombre, sans motif ou avec un motif trop court, 400 au message d’avant le lot, rien d’écrit ; avec un motif, admis et journalisé avec lui', async () => {
      const intervention = await nouvelle('curative', 'zéro sans motif');
      for (const [quoi, envoye, extra] of [['« 0 » sans motif', '0', {}], ['« 0,00 » sans motif', '0,00', {}], ['0 en nombre sans motif', 0, {}], ['« 0 », motif de deux caractères', '0', { motif: 'ab' }]]) {
        const corps = corpsCreation(envoye, extra);
        await refuse(() => creer(comptes.TECH.auth, intervention.id, corps), 400, MESSAGES.zeroSansMotif, quoi, intervention.id);
      }
      const cree = await ok(creer(comptes.TECH.auth, intervention.id, corpsCreation('0', { motif: MOTIF_ZERO })), 201);
      assert.equal(cree.nbrHeures, 0);
      assert.deepEqual((await journalDe({ interventionId: intervention.id, cible: 'COUT_INTERVENTION_HEURE' })).map((e) => [e.action, e.cibleId, e.apres.nbrHeures, e.motif]), [['CREATION', cree.id, 0, MOTIF_ZERO]]);
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 2. Correction : PATCH /api/interventions/:id/couts/heures/:coutId
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, point 2 et « Critères observables » : en correction aussi, `nbrHeures` présent ; zéro admis avec le motif de
    // correction, toujours exigé. Avant chaque correction, l'heure est remise à 7,5 h (valeur de départ distincte de toute
    // saisie) : chaque relecture prouve une écriture, même quand deux saisies successives donnent la même valeur (« 1,25 » puis
    // 1.25). Le taux figé ne change pas. Lectures écartées : voir ADMISES ; aussi le contrôle réservé à la création.
    for (const [type, libelle] of TYPES) {
      test(`correction admise au quart d’heure sur ${libelle} : les mêmes saisies, zéro compris, relues exactement en base et dans la réponse, taux figé inchangé`, async () => {
        const intervention = await nouvelle(type, 'correction admise');
        const heure = await poserHeure(intervention.id);
        for (const [quoi, envoye, enBase] of ADMISES) {
          await prisma.coutInterventionHeure.update({ where: { id: heure.id }, data: { nbrHeures: DEPART } });
          const corps = corpsCorrection(envoye);
          const corrige = await ok(corriger(comptes.TECH.auth, intervention.id, heure.id, corps));
          assert.equal(corrige.nbrHeures, Number(enBase), `${type}, ${quoi} : réponse`);
          const relu = await heureEnBase(heure.id);
          assert.deepEqual([relu.nbrHeures.toString(), relu.tauxHoraireApplique.toString(), relu.archivedAt], [enBase, TAUX, null], `${type}, ${quoi} : en base`);
        }
        assert.equal(await prisma.journalSaisieChantier.count({ where: { cibleId: heure.id, action: 'CORRECTION' } }), ADMISES.length, `${type} : une correction journalisée par saisie`);
      });
    }

    // Cadrage v2, « Critères observables » : refus en 400 au message unique, sans écriture, en correction. Le corps porte aussi un
    // commentaire, qui ne doit pas être écrit. Lectures écartées : voir REFUSEES ; le contrôle réservé à la création ; le message
    // d'avant le lot (« Montant invalide. »). Témoin : la même correction à « 0,75 » s'enregistre.
    for (const [type, libelle] of TYPES) {
      test(`correction refusée hors du quart d’heure sur ${libelle} : les mêmes formes, 400 au message du lot et non « Montant invalide. », heure, journal et base inchangés ; témoin « 0,75 » enregistré`, async () => {
        const intervention = await nouvelle(type, 'correction refusée');
        const heure = await poserHeure(intervention.id);
        for (const [quoi, envoye] of REFUSEES) {
          const corps = corpsCorrection(envoye, { commentaire: 'TEST commentaire qui ne doit pas être écrit' });
          await refuse(() => corriger(comptes.TECH.auth, intervention.id, heure.id, corps), 400, MESSAGES.quartDHeure, `${type}, ${quoi}`, intervention.id);
        }
        const relu = await heureEnBase(heure.id);
        assert.deepEqual([relu.nbrHeures.toString(), relu.commentaire, relu.updatedAt.toISOString()], ['7.5', 'TEST heure de départ lot Z', heure.updatedAt.toISOString()], `${type} : heure de départ intacte`);
        assert.equal(await prisma.journalSaisieChantier.count({ where: { cibleId: heure.id } }), 0, `${type} : journal vide`);
        await ok(corriger(comptes.TECH.auth, intervention.id, heure.id, corpsCorrection('0,75')));
        assert.equal((await heureEnBase(heure.id)).nbrHeures.toString(), '0.75', `${type} : témoin`);
      });
    }

    // ---------------------------------------------------------------------------------------------------------------
    // 3. Journal des saisies : création et correction exactes
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, « Tests » : « journal exact (création et correction) ». Sur une curative, par le technicien affecté : création à
    // « 1,25 », correction refusée à « 1,1 » (rien d'écrit), correction à « 0,75 », création de zéro heure avec son motif, puis
    // correction de la première à « 0 ». Quatre entrées, au nom et à l'identifiant du technicien, cible COUT_INTERVENTION_HEURE,
    // heure avant et après relues en base (heures en nombre), motif de zéro à sa création, motif de correction. Lectures
    // écartées : un journal qui garderait la saisie brute (« 1,25 », chaîne) au lieu de la valeur enregistrée ; une correction
    // journalisée sans son « avant » ; une entrée de plus pour la saisie refusée ; le motif de zéro perdu.
    test('journal des saisies : création à « 1,25 », correction à « 0,75 », zéro avec motif, correction à « 0 » journalisés exactement (auteur, avant, après, motif) ; la correction refusée à « 1,1 » n’écrit rien', async () => {
      const intervention = await nouvelle('curative', 'journal');
      const premiere = await ok(creer(comptes.TECH.auth, intervention.id, corpsCreation('1,25')), 201);
      const apresCreation = await heureEnBase(premiere.id);
      await refuse(() => corriger(comptes.TECH.auth, intervention.id, premiere.id, corpsCorrection('1,1')), 400, MESSAGES.quartDHeure, '« 1,1 » entre les deux', intervention.id);
      await pause(5);
      await ok(corriger(comptes.TECH.auth, intervention.id, premiere.id, corpsCorrection('0,75')));
      const apresCorrection = await heureEnBase(premiere.id);
      await pause(5);
      const zero = await ok(creer(comptes.TECH.auth, intervention.id, corpsCreation('0', { motif: MOTIF_ZERO })), 201);
      const zeroEnBase = await heureEnBase(zero.id);
      await pause(5);
      await ok(corriger(comptes.TECH.auth, intervention.id, premiere.id, corpsCorrection('0')));
      const apresZero = await heureEnBase(premiere.id);
      assert.deepEqual([apresCreation.nbrHeures.toString(), apresCorrection.nbrHeures.toString(), zeroEnBase.nbrHeures.toString(), apresZero.nbrHeures.toString()], ['1.25', '0.75', '0', '0']);
      const commun = { chantierId: null, interventionId: intervention.id, contratMaintenanceId: null, cible: 'COUT_INTERVENTION_HEURE', auteurId: comptes.TECH.id, auteurNom: comptes.TECH.name };
      assert.deepEqual(await journalDe({ interventionId: intervention.id, cible: 'COUT_INTERVENTION_HEURE' }), [
        { ...commun, cibleId: premiere.id, action: 'CREATION', avant: null, apres: instantane(apresCreation), motif: null },
        { ...commun, cibleId: premiere.id, action: 'CORRECTION', avant: instantane(apresCreation), apres: instantane(apresCorrection), motif: MOTIF },
        { ...commun, cibleId: zero.id, action: 'CREATION', avant: null, apres: instantane(zeroEnBase), motif: MOTIF_ZERO },
        { ...commun, cibleId: premiere.id, action: 'CORRECTION', avant: instantane(apresCorrection), apres: instantane(apresZero), motif: MOTIF },
      ]);
      const entrees = await journalDe({ interventionId: intervention.id, cible: 'COUT_INTERVENTION_HEURE' });
      assert.deepEqual(entrees.map((e) => [e.avant?.nbrHeures ?? null, e.apres.nbrHeures, e.apres.tauxHoraireApplique]), [[null, 1.25, 37.85], [1.25, 0.75, 37.85], [null, 0, 37.85], [0.75, 0, 37.85]], 'heures et taux en nombres');
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 4. Coûts et marge du chantier d'une suite : mêmes calculs
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, point 5 : « Aucun calcul ne change » (coûts, « Main-d’œuvre cumulée », coûts des suites dans la marge d'un
    // chantier) ; « Critères observables » : « Coûts, marges, heures réalisées […] : mêmes calculs ». Sur une suite d'une affaire
    // en cours (budget vendu 1 000 €), le technicien saisit « 1,25 » h, « 2,25 » h et « 0 » h (avec son motif), au taux figé de
    // 37,85 €.
    //  - Coûts de la suite (GET /api/interventions/:id/couts, super administrateur), arrondis au centime ligne par ligne
    //    (totalHeuresInterventionAuCentime) : 1,25 × 37,85 = 47,3125 → 47,31 ; 2,25 × 37,85 = 85,1625 → 85,16 ; 0 × 37,85 = 0 ;
    //    main-d'œuvre 132,47 €, matériel 0, total 132,47 €. Lectures écartées : un arrondi unique du total exact (132,475 → 132,48) ;
    //    « 1,25 » lu 1 h (37,85 + 85,16 = 123,01) ou 1,3 h (49,21 + 85,16 = 134,37) ; « 2,25 » arrondi au quart supérieur ou à la
    //    demi-heure (2,5 h : 47,31 + 94,63 = 141,94).
    //  - Marge du chantier (GET /api/chantiers/:id, metrics) : les coûts des suites s'y ajoutent en décimal exact (sommeExacte,
    //    produitExact) : 47,3125 + 85,1625 = 132,475 € ; marge 1 000 − 132,475 = 867,525 € ; leurs heures restent hors des heures
    //    réalisées (0, décision du 27-10-2026). Lectures écartées : les centimes par ligne de la vue SAV (132,47, marge 867,53) ;
    //    les heures de la suite comptées dans les heures réalisées (3,5).
    test('coûts et marge : « 1,25 » h, « 2,25 » h et « 0 » h d’une suite à 37,85 € font 132,47 € de main-d’œuvre dans ses coûts (centime par ligne) et 132,475 € dans la marge de son chantier (867,525 €), heures réalisées inchangées', async () => {
      const intervention = await nouvelle('suite', 'coût');
      await ok(creer(comptes.TECH.auth, intervention.id, corpsCreation('1,25')), 201);
      await ok(creer(comptes.TECH.auth, intervention.id, corpsCreation('2,25')), 201);
      await ok(creer(comptes.TECH.auth, intervention.id, corpsCreation('0', { motif: MOTIF_ZERO })), 201);
      const couts = await ok(appeler('get', `/api/interventions/${intervention.id}/couts`, comptes.SA.auth));
      assert.deepEqual(couts.heures.map((h) => h.nbrHeures).sort(), [0, 1.25, 2.25]);
      assert.deepEqual([couts.totalMainOeuvreHT, couts.totalMaterielHT, couts.totalCoutsHT], [132.47, 0, 132.47]);
      const { metrics } = await ok(appeler('get', `/api/chantiers/${intervention.chantier.id}`, comptes.SA.auth));
      assert.deepEqual([metrics.heuresRealisees, metrics.moReel, metrics.totalDepenses, metrics.margeBrute], [0, 132.475, 132.475, 867.525]);
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 5. Données existantes hors du quart d'heure (cadrage v2, point 6 ; règle 4 : aucune reprise)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, « Tests » : « heure posée en base à 1,1 h : correction sans nbrHeures, archivage et restauration admis, « 1,1 »
    // renvoyé refusé » ; point 6 : « Une heure antérieure hors du quart d'heure se lit et se calcule comme avant ; sa correction
    // sans nbrHeures (date, commentaire), son archivage et sa restauration restent admis ». Une heure à 1,1 h (possible avant le
    // lot, au centième) :
    //  - une correction du seul commentaire, puis de la seule date, est admise, ses heures restent 1,1 h (journal : 1,1 avant et
    //    après) ; lectures écartées : un contrôle des heures déjà en base (refus), ou une reprise silencieuse (1 h, 1,25 h) ;
    //  - renvoyer « 1,1 » tel quel, ou 1.1 en nombre, est refusé, rien n'est écrit ;
    //  - l'archivage et la restauration par l'encadrement, qui ne lisent pas les heures, sont admis, heures inchangées ;
    //  - ses coûts se lisent comme avant : 1,1 × 37,85 = 41,635 → 41,64 € (lecture écartée : 1,25 h, 47,31 €) ;
    //  - une correction à « 1,25 » est admise.
    test('heure enregistrée à 1,1 h avant le lot : correction sans nbrHeures admise, heures inchangées ; « 1,1 » renvoyé refusé ; coût lu 41,64 € ; archivage et restauration admis ; « 1,25 » admis', async () => {
      const intervention = await nouvelle('curative', 'donnée existante');
      const heure = await poserHeure(intervention.id, '1.1');
      const commentaire = await ok(corriger(comptes.TECH.auth, intervention.id, heure.id, { commentaire: 'TEST commentaire corrigé lot Z', motifCorrection: MOTIF }));
      assert.equal(commentaire.nbrHeures, 1.1, 'réponse');
      let relu = await heureEnBase(heure.id);
      assert.deepEqual([relu.nbrHeures.toString(), relu.commentaire], ['1.1', 'TEST commentaire corrigé lot Z']);
      await ok(corriger(comptes.TECH.auth, intervention.id, heure.id, { date: '07-10-2026', motifCorrection: MOTIF }));
      relu = await heureEnBase(heure.id);
      assert.deepEqual([relu.nbrHeures.toString(), relu.date.toISOString()], ['1.1', '2026-10-07T00:00:00.000Z']);
      const journal = await journalDe({ cibleId: heure.id });
      assert.deepEqual(journal.map((e) => [e.action, e.avant.nbrHeures, e.apres.nbrHeures]), [['CORRECTION', 1.1, 1.1], ['CORRECTION', 1.1, 1.1]], 'journal : heures inchangées');
      assert.deepEqual([journal[0].apres.commentaire, journal[1].avant.date, journal[1].apres.date], ['TEST commentaire corrigé lot Z', '2026-10-05T00:00:00.000Z', '2026-10-07T00:00:00.000Z']);
      await refuse(() => corriger(comptes.TECH.auth, intervention.id, heure.id, corpsCorrection('1,1', { commentaire: 'TEST renvoi tel quel' })), 400, MESSAGES.quartDHeure, '« 1,1 » renvoyé tel quel', intervention.id);
      await refuse(() => corriger(comptes.TECH.auth, intervention.id, heure.id, corpsCorrection(1.1)), 400, MESSAGES.quartDHeure, '1.1 en nombre renvoyé tel quel', intervention.id);
      const couts = await ok(appeler('get', `/api/interventions/${intervention.id}/couts`, comptes.SA.auth));
      assert.deepEqual([couts.heures.map((h) => h.nbrHeures), couts.totalMainOeuvreHT], [[1.1], 41.64], 'coût d’une heure existante lu comme avant');
      await ok(appeler('post', `/api/interventions/${intervention.id}/couts/heures/${heure.id}/archiver`, comptes.SA.auth, { motif: 'TEST archivage lot Z' }));
      assert.deepEqual([(await heureEnBase(heure.id)).nbrHeures.toString(), (await heureEnBase(heure.id)).archivedAt !== null], ['1.1', true], 'archivée, heures inchangées');
      const restauree = await ok(appeler('post', `/api/interventions/${intervention.id}/couts/heures/${heure.id}/restaurer`, comptes.SA.auth, { motif: 'TEST restauration lot Z' }));
      assert.equal(restauree.nbrHeures, 1.1, 'restaurée, heures inchangées');
      assert.equal((await heureEnBase(heure.id)).archivedAt, null);
      await ok(corriger(comptes.TECH.auth, intervention.id, heure.id, corpsCorrection('1,25')));
      assert.equal((await heureEnBase(heure.id)).nbrHeures.toString(), '1.25');
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 6. Ordre des refus, inchangé (cadrage v2, point 2 : « au même endroit »)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, « Tests » : « ordre des refus inchangé, joué avec « 1,1 » (404, 403, 409 et refus de l'affaire d'une suite avant
    // les heures en création, date illisible avant les heures) ». POST, dans l'ordre de main : session (401), commercial (403),
    // intervention hors périmètre (404), compte autre que technicien (403), intervention qui ne reçoit pas de coûts (409),
    // affaire de la suite (409 annulée, 403 clôturée), date illisible (400, message scindé), heures (400), puis date future,
    // motif de zéro et intervenant. Une intervention qui ne reçoit plus de coûts est jouée par la visite d'un contrat suspendu :
    // l'annulation d'une intervention retire ses affectations, et le technicien n'y voit plus rien (404). Lectures écartées : le
    // contrôle du lot passé devant l'un des refus qui le précèdent (400 au lieu de 401, 403, 404 ou 409) ; la date illisible
    // jugée après les heures, ou au message combiné d'avant le lot ; le contrôle passé derrière la date future (« 1,1 » daté de
    // demain : refus des heures, et non de la date) ; une écriture.
    test('création, ordre des refus avec « 1,1 » : session, commercial, périmètre, technicien, intervention fermée et affaire de la suite avant les heures ; date illisible avant les heures, au message de la date ; les heures avant la date future ; rien d’écrit', async () => {
      const ouverte = await nouvelle('curative', 'ordre ouverte', comptes.TECH);
      const visiteSuspendue = await nouvelle('visite', 'ordre contrat suspendu', comptes.TECH);
      await ok(appeler('patch', `/api/contrats-maintenance/${visiteSuspendue.contrat.id}/statut`, comptes.SA.auth, { statut: 'SUSPENDU', motif: 'TEST suspension lot Z' }));
      const suiteCloturee = await nouvelle('suite', 'ordre affaire clôturée', comptes.TECH);
      await prisma.chantier.update({ where: { id: suiteCloturee.chantier.id }, data: { statut: 'TERMINE', dateFin: new Date('2026-11-01T00:00:00Z') } });
      const suiteAnnulee = await nouvelle('suite', 'ordre affaire annulée', comptes.TECH);
      await prisma.chantier.update({ where: { id: suiteAnnulee.chantier.id }, data: { statut: 'ANNULE' } });
      const corps = corpsCreation('1,1');
      await refuse(() => creer(null, ouverte.id, corps), 401, MESSAGES.authentification, 'sans session', ouverte.id);
      await refuse(() => creer(cleToutesPortees, ouverte.id, corps), 401, MESSAGES.sessionInvalide, 'clé d’intégration sur la route de session', ouverte.id);
      await refuse(() => creer(comptes.COM.auth, ouverte.id, corps), 403, MESSAGES.commercial, 'commercial', ouverte.id);
      await refuse(() => creer(comptes.TECH.auth, randomUUID(), corps), 404, MESSAGES.intervention, 'intervention inconnue', null);
      await refuse(() => creer(comptes.TECH3.auth, ouverte.id, corps), 404, MESSAGES.intervention, 'technicien non affecté', ouverte.id);
      await refuse(() => creer(comptes.CT.auth, ouverte.id, corps), 404, MESSAGES.intervention, 'conducteur hors périmètre', ouverte.id);
      for (const code of ['SA', 'AD', 'AT']) await refuse(() => creer(comptes[code].auth, ouverte.id, corps), 403, MESSAGES.reserveeTechnicien, `encadrement ${code}`, ouverte.id);
      await refuse(() => creer(comptes.TECH.auth, visiteSuspendue.id, corps), 409, MESSAGES.nonEligible, 'visite d’un contrat suspendu', visiteSuspendue.id);
      await refuse(() => creer(comptes.TECH.auth, suiteAnnulee.id, corps), 409, MESSAGES.suiteAnnulee, 'suite d’une affaire annulée', suiteAnnulee.id);
      await refuse(() => creer(comptes.TECH.auth, suiteCloturee.id, corps), 403, MESSAGES.suiteCloturee, 'suite d’une affaire clôturée', suiteCloturee.id);
      // Date illisible, absente ou au mauvais format : le refus de la date, et non le message combiné d'avant le lot.
      for (const [quoi, date] of [['date impossible', '31-02-2026'], ['date au mauvais format', '2026/11/02'], ['date vide', '']]) {
        await refuse(() => creer(comptes.TECH.auth, ouverte.id, { ...corps, date }), 400, MESSAGES.date, `${quoi} avec « 1,1 »`, ouverte.id);
        await refuse(() => creer(comptes.TECH.auth, ouverte.id, { ...corps, date, nbrHeures: '1,25' }), 400, MESSAGES.date, `${quoi} avec « 1,25 »`, ouverte.id);
      }
      const { date: _sansDate, ...sansDate } = corps;
      await refuse(() => creer(comptes.TECH.auth, ouverte.id, sansDate), 400, MESSAGES.date, 'date absente avec « 1,1 »', ouverte.id);
      // Les heures avant la date future et le motif de zéro.
      await refuse(() => creer(comptes.TECH.auth, ouverte.id, { ...corps, date: jour(1) }), 400, MESSAGES.quartDHeure, '« 1,1 » daté de demain', ouverte.id);
      await refuse(() => creer(comptes.TECH.auth, ouverte.id, corpsCreation('0,05')), 400, MESSAGES.quartDHeure, '« 0,05 » sans motif', ouverte.id);
      // Témoins à « 1,25 » (ou zéro) : chaque corps reçoit le refus suivant de l'ordre.
      await refuse(() => creer(comptes.TECH.auth, ouverte.id, corpsCreation('1,25', { date: jour(1) })), 400, MESSAGES.dateFuture, 'témoin « 1,25 » daté de demain', ouverte.id);
      await refuse(() => creer(comptes.TECH.auth, ouverte.id, corpsCreation('0')), 400, MESSAGES.zeroSansMotif, 'témoin « 0 » sans motif', ouverte.id);
      assert.equal(await prisma.coutInterventionHeure.count({ where: { interventionId: { in: [ouverte.id, visiteSuspendue.id, suiteCloturee.id, suiteAnnulee.id] } } }), 0, 'aucune heure écrite');
      await ok(creer(comptes.TECH.auth, ouverte.id, corpsCreation('1,25')), 201);
    });

    // Cadrage v2, « Tests » : « motif de correction et date avant les heures en correction ». PATCH, dans l'ordre de main :
    // session et commercial, intervention (404), type de coût (404), compte autre que technicien (403), motif de correction
    // (400), date illisible (400), date future (400), puis heures (400), puis intervention qui ne reçoit plus de coûts (409, visite
    // d'un contrat suspendu), affaire de la suite (403), coût inconnu ou d'un collègue (404), coût archivé (409). Lectures
    // écartées : le contrôle du lot passé devant l'un des refus qui le précèdent, ou derrière l'un de ceux qui le suivent ; une
    // écriture. Témoins à « 1,25 » : chacun reçoit le refus suivant de l'ordre.
    test('correction, ordre des refus avec « 1,1 » : intervention, type, technicien, motif de correction et date avant les heures ; les heures avant l’intervention fermée, l’affaire de la suite, le coût inconnu, d’un collègue ou archivé ; rien d’écrit', async () => {
      const ouverte = await nouvelle('curative', 'ordre correction', comptes.TECH, comptes.TECH2);
      const heure = await poserHeure(ouverte.id);
      const archivee = await poserHeure(ouverte.id, DEPART, comptes.TECH, { archivedAt: new Date(), archivedById: comptes.SA.id, motifArchivage: 'TEST archivée lot Z' });
      const duCollegue = await poserHeure(ouverte.id, DEPART, comptes.TECH2);
      const visiteSuspendue = await nouvelle('visite', 'ordre correction contrat suspendu', comptes.TECH);
      const heureSuspendue = await poserHeure(visiteSuspendue.id);
      await ok(appeler('patch', `/api/contrats-maintenance/${visiteSuspendue.contrat.id}/statut`, comptes.SA.auth, { statut: 'SUSPENDU', motif: 'TEST suspension lot Z' }));
      const suiteCloturee = await nouvelle('suite', 'ordre correction affaire clôturée', comptes.TECH);
      const heureSuite = await poserHeure(suiteCloturee.id);
      await prisma.chantier.update({ where: { id: suiteCloturee.chantier.id }, data: { statut: 'TERMINE', dateFin: new Date('2026-11-01T00:00:00Z') } });
      const corps = corpsCorrection('1,1');
      await refuse(() => corriger(null, ouverte.id, heure.id, corps), 401, MESSAGES.authentification, 'sans session', ouverte.id);
      await refuse(() => corriger(cleToutesPortees, ouverte.id, heure.id, corps), 401, MESSAGES.sessionInvalide, 'clé d’intégration sur la route de session', ouverte.id);
      await refuse(() => corriger(comptes.COM.auth, ouverte.id, heure.id, corps), 403, MESSAGES.commercial, 'commercial', ouverte.id);
      await refuse(() => corriger(comptes.TECH.auth, randomUUID(), heure.id, corps), 404, MESSAGES.intervention, 'intervention inconnue', null);
      await refuse(() => corriger(comptes.TECH3.auth, ouverte.id, heure.id, corps), 404, MESSAGES.intervention, 'technicien non affecté', ouverte.id);
      await refuse(() => corriger(comptes.TECH.auth, ouverte.id, heure.id, corps, 'materiel'), 404, MESSAGES.coutIntrouvable, 'type de coût inconnu', ouverte.id);
      for (const code of ['SA', 'AD', 'AT']) await refuse(() => corriger(comptes[code].auth, ouverte.id, heure.id, corps), 403, MESSAGES.accesNonAutorise, `encadrement ${code}`, ouverte.id);
      const { motifCorrection: _motif, ...sansMotif } = corps;
      await refuse(() => corriger(comptes.TECH.auth, ouverte.id, heure.id, sansMotif), 400, MESSAGES.motifCorrection, 'sans motif de correction', ouverte.id);
      await refuse(() => corriger(comptes.TECH.auth, ouverte.id, heure.id, { ...corps, date: '31-02-2026' }), 400, MESSAGES.date, 'date illisible', ouverte.id);
      await refuse(() => corriger(comptes.TECH.auth, ouverte.id, heure.id, { ...corps, date: jour(1) }), 400, MESSAGES.dateFuture, 'date future', ouverte.id);
      // Après les heures : « 1,1 » refusé par le lot à chacun de ces cas.
      const apres = [
        ['visite d’un contrat suspendu', visiteSuspendue.id, heureSuspendue.id, 409, MESSAGES.nonEligible],
        ['suite d’une affaire clôturée', suiteCloturee.id, heureSuite.id, 403, MESSAGES.suiteCloturee],
        ['coût inconnu', ouverte.id, randomUUID(), 404, MESSAGES.coutIntrouvable],
        ['coût d’un collègue', ouverte.id, duCollegue.id, 404, MESSAGES.coutIntrouvable],
        ['coût archivé', ouverte.id, archivee.id, 409, MESSAGES.coutArchive],
      ];
      for (const [quoi, interventionId, coutId] of apres) await refuse(() => corriger(comptes.TECH.auth, interventionId, coutId, corps), 400, MESSAGES.quartDHeure, `« 1,1 », ${quoi}`, interventionId);
      for (const [quoi, interventionId, coutId, statut, message] of apres) await refuse(() => corriger(comptes.TECH.auth, interventionId, coutId, corpsCorrection('1,25')), statut, message, `témoin « 1,25 », ${quoi}`, interventionId);
      for (const id of [heure.id, archivee.id, duCollegue.id, heureSuspendue.id, heureSuite.id]) assert.equal((await heureEnBase(id)).nbrHeures.toString(), '7.5', `heure ${id} intacte`);
      await ok(corriger(comptes.TECH.auth, ouverte.id, heure.id, corpsCorrection('1,25')));
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 7. Matériel : lecture et message inchangés ; clé d'intégration : aucune route n'écrit d'heures d'une intervention
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, point 2 : « Le matériel garde sa lecture et son message ». La correction d'un achat, par le super
    // administrateur : « abc » refusé au message d'avant (« Montant invalide. »), rien d'écrit ; « 10,10 » (hors du quart, au
    // centime) admis, 10,1 € en base. Lectures écartées : le contrôle des heures appliqué au matériel (« 10,10 » refusé) ; le
    // message des heures servi au matériel.
    test('matériel : correction d’un achat à « abc » refusée au message d’avant le lot (« Montant invalide. »), à « 10,10 » admise au centime', async () => {
      const intervention = await nouvelle('curative', 'matériel');
      const achat = await prisma.coutInterventionAchat.create({ data: { interventionId: intervention.id, fournisseurId: fournisseur.id, date: new Date('2026-10-05T00:00:00Z'), description: 'TEST matériel lot Z', montantHT: '25', createdById: comptes.SA.id } });
      for (const valeur of ['abc', '1,234', '-1']) await refuse(() => corriger(comptes.SA.auth, intervention.id, achat.id, { montantHT: valeur, motifCorrection: MOTIF }, 'achats'), 400, MESSAGES.montantInvalide, `achat « ${valeur} »`, intervention.id);
      const corrige = await ok(corriger(comptes.SA.auth, intervention.id, achat.id, { montantHT: '10,10', motifCorrection: MOTIF }, 'achats'));
      assert.equal(corrige.montantHT, 10.1);
      assert.equal((await prisma.coutInterventionAchat.findUniqueOrThrow({ where: { id: achat.id } })).montantHT.toString(), '10.1');
    });

    // Inventaire du contrôle de mode 1 : « ni /api/v1 (aucune route d'intervention) ». Une clé qui porte toutes les portées ne
    // trouve ni POST ni PATCH /api/v1/interventions/:id/couts/heures (404), avec une saisie au quart d'heure comme hors du quart
    // d'heure ; rien n'est écrit. Lecture écartée : une porte d'intégration qui écrirait des heures sans le contrôle du lot.
    test('clé d’intégration à toutes les portées : ni création ni correction d’heures par /api/v1 (404), rien d’écrit', async () => {
      const intervention = await nouvelle('curative', 'clé');
      const heure = await poserHeure(intervention.id);
      for (const valeur of ['1,25', '1,1']) {
        const creation = corpsCreation(valeur);
        const correction = corpsCorrection(valeur);
        const avant = await empreinte();
        assert.equal((await appeler('post', `/api/v1/interventions/${intervention.id}/couts/heures`, cleToutesPortees, creation)).status, 404, `POST /api/v1 « ${valeur} »`);
        assert.equal((await appeler('patch', `/api/v1/interventions/${intervention.id}/couts/heures/${heure.id}`, cleToutesPortees, correction)).status, 404, `PATCH /api/v1 « ${valeur} »`);
        assert.deepEqual(tablesChangees(avant, await empreinte()), [], `« ${valeur} » : rien d’écrit`);
      }
      assert.equal((await heureEnBase(heure.id)).nbrHeures.toString(), '7.5');
    });
  });
}
