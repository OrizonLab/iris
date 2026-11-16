// Correctif « saisie des montants refusée plutôt que faussée » (cadrage v3 du 16-11-2026, contrôlé « prêt à coder »,
// section « Tests » ; montants classés C) : #443 (taux horaire chargé d'une fiche intervenant) et reste de #289 (statut et
// date de fin d'un chantier, PATCH /api/chantiers/:id). La saisie des heures vendues et des budgets de la fiche chantier
// (#393, #394) reste prouvée par chantier-saisie-montants.test.mjs et, à l'écran, par les parcours E2E du lot.
//
// Décision et choix appliqués :
//  - décision de Nelson du 16-11-2026, à la question « Chantier terminé (issue #289) : l'administration peut aujourd'hui
//    vider sa date de fin. (…) Faut-il refuser ce vidage ? » : « Refuser le vidage (Recommandé) » (« Un chantier terminé
//    garde toujours une date de fin : le mois de commission ne glisse plus. L'administration peut encore changer la
//    date, pas la supprimer. ») ;
//  - #443 (cadrage, point 1) : taux lu par la règle commune `nombreDecimalNonNegatif(v, 8, true)` (virgule admise, deux
//    décimales au plus, zéro admis comme aujourd'hui) ; création : absent, vide, `null` ou invalide → 400 ; modification :
//    absent → inchangé, vide, `null` ou invalide → 400 ; les valeurs existantes des tests (40, 48.13, 37.85, 57.89,
//    1234.5, '35') restent admises ;
//  - #289 (cadrage, point 3), choix par défaut, à confirmer : un `statut` envoyé à la fiche par l'administration reçoit
//    un 400 qui renvoie à la clôture et à la réouverture (PATCH /api/chantiers/:id/statut) ; pour les autres comptes, il
//    reste ignoré en silence ; le refus du vidage est contrôlé sur la ligne verrouillée, après les refus existants de la
//    fiche (404, 403, 409 de l'affaire annulée, saisies invalides) et avant les 409 d'un changement de client décidés sous le
//    verrou, comme toute saisie invalide (#393) ; aucune entrée de journal n'est ajoutée.
//
// Avant le correctif, PUT /api/intervenants/:id lisait le taux par `parseFloat(…) || 0` (« abc », « », null → 0 ;
// « 12abc » → 12 ; « 42,50 » → 42 ; « -5 » → -5), POST /api/intervenants par `parseFloat` seul (absent, « », null ou
// « abc » → NaN, puis une erreur 500), et PostgreSQL arrondissait au centime une troisième décimale (Decimal(10,2)).
// Chaque forme refusée est commentée de la lecture qu'elle écarte. Chaque refus est prouvé sans aucune écriture :
// empreinte de toute la base (chaque table du schéma public, contenu compris), relue après l'appel.
//
// Fichier propre au correctif, avec sa base jetable (#552 : suppression protégée par un `finally`, retentée, connexion
// administrative toujours fermée) : `node --test` exécute les fichiers en parallèle, et api.test.mjs, qui tourne en même
// temps sur TEST_DATABASE_URL, purge les données « TEST ». TEST_DATABASE_URL ne sert donc ici que de connexion
// administrative : une base neuve est créée, migrée (`prisma migrate deploy`), servie à l'application montée en mémoire,
// puis supprimée. Sans TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { empreinteBase, tablesChangees, tablesDeLaBase } from './matrice-droits/outils.mjs';

const TITRE = 'Saisie des montants refusée plutôt que faussée : taux horaire chargé d’une fiche intervenant, statut et date de fin d’un chantier terminé (#443, #289)';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// Refus du lot, mot pour mot (apostrophe typographique), et refus existants qu'il range avant eux.
const REFUS = {
  taux: 'Le taux horaire chargé doit être un nombre positif ou nul, avec au plus deux décimales (par exemple 42,50).',
  statutParLaFiche: 'Le statut d’un chantier ne se change pas par sa fiche : clôturez-le ou rouvrez-le depuis la liste des chantiers.',
  dateFinVidee: 'Un chantier terminé garde sa date de fin : elle fixe le mois de son chiffre d’affaires validé. Vous pouvez la changer, pas la vider.',
  administration: 'Accès réservé aux administrateurs',
  session: 'Session expirée ou invalide',
  introuvable: 'Chantier introuvable',
  ficheAnnulee: 'Cette affaire est annulée : elle n’est plus modifiable.',
  ficheCloture: 'Ce chantier est clôturé : seul un administrateur peut encore le modifier.',
  technicienFiche: 'Un compte technicien n’est pas autorisé à modifier une affaire. Adressez-vous à votre responsable.',
  technicienCloture: 'Un compte technicien n’est pas autorisé à clôturer une affaire : la clôture revient à un compte Responsable de sa branche, à la direction ou à l’administration.',
  compteCommercial: 'Accès non autorisé pour un compte commercial.',
  assistanteStatut: 'Un compte assistante technique n’est pas autorisé à clôturer ni à rouvrir une affaire.',
  reouverture: 'Seul un administrateur peut réouvrir un chantier clôturé.',
  statutInvalide: 'Statut invalide.',
  statutAnnulee: 'Cette affaire est annulée : son statut ne change plus.',
  heuresInvalides: 'Les heures vendues doivent être un nombre positif ou nul, d’au plus 8 chiffres avant la virgule et 2 après.',
  dateFinFormat: 'La date de fin doit être valide au format JJ-MM-AAAA.',
};

// Formes admises du taux (cadrage, point 1, et critères observables), à la création comme à la modification, avec la
// valeur exacte attendue en base (`toString()` du Decimal) et dans la réponse. Chaque commentaire dit la lecture écartée.
const FORMES_ADMISES = [
  ['« 42,50 »', '42,50', '42.5'], // critère du cadrage ; écarte `parseFloat` (42, lecture arrêtée à la virgule) et une virgule lue en séparateur de milliers (4 250).
  ['« 37,85 »', '37,85', '37.85'], // au centime : écarte en plus une troncature (37,8) ou un arrondi (37,9) au dixième, que 42,50 ne distingue pas.
  ['« 42.50 »', '42.50', '42.5'], // le point reste admis.
  ['« 42,50 » entouré de blancs', ' \t42,50  ', '42.5'], // blancs retirés avant la lecture, comme pour tous les montants (#393).
  ['42.5 (nombre)', 42.5, '42.5'], // un nombre JSON, jugé sur son écriture décimale.
  ['48.13 (nombre)', 48.13, '48.13'], // valeur des tests existants (cadrage) : 48,13 n'a pas d'écriture binaire exacte, il ne doit pas devenir 48,12 ou 48,14.
  ['37.85 (nombre)', 37.85, '37.85'], // valeur des tests existants (cadrage), en nombre JSON.
  ['57.89 (nombre)', 57.89, '57.89'], // valeur des tests existants (cadrage), en nombre JSON.
  ['40 (nombre)', 40, '40'], // valeur des tests existants (cadrage), entière, en nombre JSON.
  ['« 1234.5 »', '1234.5', '1234.5'], // valeur des tests existants (cadrage).
  ['« 35 »', '35', '35'], // valeur des tests existants (cadrage), entière.
  ['« 0042,50 » (zéros de tête)', '0042,50', '42.5'], // zéros de tête dans les huit chiffres saisis : admis, à 42,50 (README) ; écarte un refus de tout zéro de tête et `parseFloat` (42).
  ['« 0,01 »', '0,01', '0.01'], // plus petit taux non nul : écarte un arrondi à l'unité (0) et un refus « < 1 € ».
  ['« 0 »', '0', '0'], // zéro admis comme aujourd'hui (cadrage) : écarte `zeroAutorise` à faux. La valeur de départ, non nulle, doit devenir 0.
  ['0 (nombre)', 0, '0'], // idem, en nombre JSON.
  ['« 0,00 »', '0,00', '0'], // idem, au centime.
  ['plafond « 99999999,99 »', '99999999,99', '99999999.99'], // huit chiffres avant la virgule (colonne Decimal(10,2)) : écarte un plafond à sept chiffres, ou arrondi.
  ['plafond 99999999.99 (nombre)', 99999999.99, '99999999.99'], // idem, en nombre JSON : écarte une écriture par un flottant qui perdrait le dernier centime.
];

// Formes refusées (cadrage, critères observables : « abc », « -5 », « 12abc », vide, `null` ; règle commune pour le
// reste), à la création comme à la modification : 400 au message exact, sans aucune écriture.
const FORMES_REFUSEES = [
  ['« abc »', 'abc'], // avant : 0 à la modification (NaN || 0), 500 à la création (NaN).
  ['« -5 »', '-5'], // avant : -5 écrit ; écarte aussi une lecture en valeur absolue (5).
  ['-5 (nombre)', -5], // idem, en nombre JSON.
  ['« -0,01 »', '-0,01'], // avant : 0 (`parseFloat` lit « -0 », puis `|| 0`) ; écarte un contrôle « ≥ -1 centime ».
  ['« 12abc »', '12abc'], // avant : 12 (`parseFloat` lit le début de la saisie).
  ['« » (chaîne vide)', ''], // avant : 0 à la modification, 500 à la création.
  ['chaîne de blancs', '   '], // avant : idem ; le retrait des blancs ne la rend pas valide.
  ['null', null], // avant : 0 à la modification, 500 à la création ; `null` ne vaut pas 0.
  ['true', true], // écarte une lecture booléen = 1.
  ['[] (tableau vide)', []], // avant : 0 à la modification.
  ['["42"] (tableau)', ['42']], // avant : 42 (`parseFloat` d'un tableau lit son premier élément).
  ['{} (objet)', {}], // avant : 0 à la modification.
  ['« 42,505 »', '42,505'], // trois décimales : avant, 42 (`parseFloat`) ; écarte un arrondi (42,51) et une troncature (42,50).
  ['« 42.505 »', '42.505'], // avant : 42,51 (arrondi de PostgreSQL au centime) ; écarte aussi une troncature à 42,50.
  ['42.505 (nombre)', 42.505], // idem, en nombre JSON, jugé sur son écriture décimale.
  ['« 0.005 » (demi-centime)', '0.005'], // avant : 0,01 (arrondi au demi supérieur) ; écarte aussi 0 (arrondi au pair).
  ['« 1e3 »', '1e3'], // avant : 1 000 (`parseFloat` lit la notation scientifique).
  ['1e21 (nombre)', 1e21], // écrit « 1e+21 » : notation scientifique ; avant, erreur 500 (dépassement de la colonne).
  ['1e-7 (nombre)', 1e-7], // écrit « 1e-7 » ; avant, 0 (arrondi de PostgreSQL au centime).
  ['« Infinity »', 'Infinity'], // avant : Infinity, puis une erreur 500.
  ['« .5 »', '.5'], // au moins un chiffre avant la virgule : règle commune inchangée (« ,5 » hors périmètre, cadrage).
  ['« 5. »', '5.'], // au moins une décimale après le séparateur.
  ['« 1 000 »', '1 000'], // avant : 1 (lecture arrêtée à l'espace) ; écarte aussi une lecture en milliers (1 000).
  ['« +5 »', '+5'], // aucun signe, même positif.
  ['plafond plus un centime « 100000000,00 »', '100000000,00'], // neuf chiffres : avant, erreur 500 (Decimal(10,2) déborde) ; écarte un plafond à neuf chiffres.
  ['100000000 (nombre)', 100000000], // idem, en nombre JSON.
  ['zéros de tête « 000000001 »', '000000001'], // neuf chiffres saisis : écarte une lecture qui compterait les chiffres de la valeur (1), et non ceux de la saisie.
];

// Valeur posée en base avant chaque forme admise à la modification : la relecture prouve que l'écriture a eu lieu, même
// quand deux formes successives donnent la même valeur (« 42,50 » puis « 42.50 »).
const SENTINELLE = '4321.09';
// Taux de départ des fiches de modification, distinct de toute valeur envoyée.
const DEPART_TAUX = '57.89';
// Date de fin d'un chantier terminé de test, distincte de toute date envoyée.
const DATE_FIN = new Date('2026-10-15T00:00:00.000Z');

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_taux_cloture_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;

    let request; let app; let prisma; let appPrisma; let jwt; let jourCivilEntreprise;
    let session = '';
    let tables = [];
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const admin = () => entete(session);
    let rang = 0;
    const suffixe = () => `${Date.now()}-${(rang += 1)}`;
    const comptes = {};

    const creerCompte = async (role, cle, extra = {}) => {
      const s = suffixe();
      const compte = await prisma.user.create({ data: { email: `taux-cloture.${cle.toLowerCase()}.${s}@iris.test`, name: `TEST ${cle} ${s}`, role, ...extra } });
      return { ...compte, auth: entete(jwt.sign({ id: compte.id }, process.env.JWT_SECRET)) };
    };
    // Les quatre comptes de l'administration (TYPES_ADMINISTRATION, administrateur commercial compris).
    const ADMINISTRATION = () => [['SA', admin()], ['AD', comptes.AD.auth], ['AD-COM', comptes['AD-COM'].auth], ['DIR', comptes.DIR.auth]];
    // Les comptes hors administration, refusés par requireAdmin sur les fiches intervenants.
    const HORS_ADMINISTRATION = () => ['CT', 'RESP', 'DC', 'AC', 'CPT', 'TECH', 'COM', 'AT'].map((cle) => [cle, comptes[cle].auth]);

    // --- Appels ---
    const appeler = (methode, chemin, corps, auth = admin()) => request(app)[methode](`/api${chemin}`).set(auth).send(corps ?? {});
    const creerFiche = (corps, auth = admin()) => appeler('post', '/intervenants', corps, auth);
    const modifierFiche = (id, corps, auth = admin()) => appeler('put', `/intervenants/${id}`, corps, auth);
    const modifierChantier = (id, corps, auth = admin()) => appeler('patch', `/chantiers/${id}`, corps, auth);
    const changerStatut = (id, corps, auth = admin()) => appeler('patch', `/chantiers/${id}/statut`, corps, auth);
    const ok = async (reponse, statut = 200) => {
      const res = await reponse;
      assert.equal(res.status, statut, `${res.req?.method} ${res.req?.path} : ${JSON.stringify(res.body)}`);
      return res.body;
    };

    // --- État de la base ---
    const empreinte = (client = prisma) => empreinteBase(client, tables);
    // Un refus : statut et message attendus, et l'empreinte de toute la base inchangée (pas même un `updatedAt`).
    const refuse = async (appel, statut, message, quoi) => {
      const avant = await empreinte();
      const res = await appel();
      assert.equal(res.status, statut, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, message, quoi);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      return res;
    };
    const tauxEnBase = async (id) => (await prisma.intervenant.findUniqueOrThrow({ where: { id } })).tauxHoraireCharge.toString();
    const ligne = (id) => prisma.chantier.findUniqueOrThrow({ where: { id } });
    const jourIso = (date) => (date ? date.toISOString().slice(0, 10) : null);
    const aujourdhui = async () => {
      const societe = await prisma.companySettings.findUnique({ where: { id: 'singleton' } });
      return jourCivilEntreprise(new Date(), societe?.fuseauHoraire || 'Europe/Paris');
    };

    // --- Données ---
    // Fiche intervenant posée en base au taux de départ : la modification seule est en cause.
    const ficheEnBase = (taux = DEPART_TAUX) => prisma.intervenant.create({ data: { nom: `TEST Fiche taux ${suffixe()}`, role: 'Technicien', tauxHoraireCharge: taux } });
    // Chantier posé en base, titulaire CT par défaut : le lot porte sur sa modification, et non sur son ouverture.
    const creerChantier = (extra = {}) => prisma.chantier.create({ data: {
      nom: `TEST Chantier taux et clôture ${suffixe()}`, client: 'TEST Client taux et clôture', dateDebut: new Date('2026-09-01T00:00:00.000Z'),
      budgetGlobalVendu: '1234.56', budgetMaterielVendu: '345.67', budgetMainOeuvreVendu: '456.78', heuresVendues: '12.34',
      responsableId: comptes.CT.id, ...extra,
    } });
    const creerTermine = (extra = {}) => creerChantier({ statut: 'TERMINE', dateFin: DATE_FIN, ...extra });
    const creerAnnule = (extra = {}) => creerChantier({ statut: 'ANNULE', annuleLe: new Date('2026-10-20T08:00:00.000Z'), annuleParId: comptes.SA.id, motifAnnulation: 'TEST annulation posée en base', ...extra });

    // Course : une transaction de test tient la ligne du chantier (FOR UPDATE) ; la requête part, attend ce verrou (constaté
    // par pg_blocking_pids), puis la transaction change la ligne directement en base et valide. L'état attendu après la
    // réponse est relevé dans la transaction : toute la base avant le départ de la requête, puis toute la base une fois le
    // changement fait ; la requête, si elle refuse, n'y change rien. Modèle : `sousVerrou` de chantier-annule-termine.test.mjs.
    const sousVerrou = async (chantierId, lancer, changer) => {
      let reponse; let attendu;
      await prisma.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        await tx.$queryRaw`SELECT "id" FROM "Chantier" WHERE "id" = ${chantierId} FOR UPDATE`;
        reponse = lancer().then((r) => r);
        let attente = false;
        for (let tour = 0; tour < 300 && !attente; tour += 1) {
          attente = (await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`)[0].n > 0;
          if (!attente) await new Promise((r) => setTimeout(r, 20));
        }
        assert.equal(attente, true, 'la requête attend la ligne du chantier');
        await changer(tx);
        attendu = await empreinte(tx);
      }, { timeout: 30_000, maxWait: 10_000 });
      return { res: await reponse, attendu };
    };

    before(async () => {
      assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname), 'seul un PostgreSQL local est autorisé');
      assert.notEqual(source.pathname.slice(1), nomBase);
      await administrationPg.connect();
      await administrationPg.query(`CREATE DATABASE "${nomBase}"`);
      baseCreee = true;
      const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');
      execFileSync(resolve(dossierServeur, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', resolve(dossierServeur, 'prisma/schema.prisma')], {
        env: { ...process.env, DATABASE_URL: cible.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
      });
      process.env.DATABASE_URL = cible.toString();
      process.env.NODE_ENV = 'test';
      process.env.JWT_SECRET = 'secret-de-test-uniquement';
      process.env.BREAK_GLASS_EMAIL = 'secours@iris.test';
      process.env.BREAK_GLASS_TOKEN = 'jeton-de-secours-de-test-au-moins-32-caracteres';
      process.env.SUPERADMIN_EMAILS = 'secours@iris.test';
      request = (await import('supertest')).default;
      const serveur = await import('../dist/index.js');
      app = serveur.app;
      appPrisma = serveur.prisma;
      jourCivilEntreprise = serveur.jourCivilEntreprise;
      const { PrismaClient } = await import('@prisma/client');
      prisma = new PrismaClient({ datasources: { db: { url: cible.toString() } } });
      jwt = (await import('jsonwebtoken')).default;
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      session = connexion.body.token;
      comptes.SA = await prisma.user.findUniqueOrThrow({ where: { email: 'secours@iris.test' }, select: { id: true, role: true } });
      assert.equal(comptes.SA.role, 'SUPERADMIN', 'le compte de secours est super administrateur');
      comptes.AD = await creerCompte('ADMIN', 'AD');
      comptes['AD-COM'] = await creerCompte('ADMIN', 'AD-COM', { estCommercial: true });
      comptes.DIR = await creerCompte('DIRECTEUR', 'DIR');
      for (const [cle, role] of [
        ['CT', 'CONDUCTEUR_TRAVAUX'], ['RESP', 'RESPONSABLE'], ['DC', 'DIRECTEUR_COMMERCIAL'], ['AC', 'ASSISTANTE_COMMERCIALE'], ['CPT', 'COMPTABLE'],
        ['TECH', 'TECHNICIEN'], ['COM', 'COMMERCIAL'], ['AT', 'ASSISTANTE_TECHNIQUE'],
      ]) comptes[cle] = await creerCompte(role, cle);
      tables = await tablesDeLaBase(prisma);
      assert.ok(tables.includes('Intervenant') && tables.includes('Chantier') && tables.includes('PointageHeure') && tables.length > 40, `tables relevées : ${tables.join(', ')}`);
    });

    // #552 : la connexion administrative est fermée même si la suppression de la base échoue (sinon le processus du fichier
    // ne se termine jamais, et l'échec n'est jamais rapporté) ; une connexion de l'application rouverte pendant la
    // suppression la fait échouer : elle est retentée deux fois, puis l'erreur est rapportée.
    after(async () => {
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      try {
        for (let essai = 1; baseCreee; essai += 1) {
          try {
            await administrationPg.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`);
            baseCreee = false;
          } catch (erreur) {
            if (essai >= 3) throw erreur;
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      } finally {
        await administrationPg.end().catch(() => {});
      }
    });

    // ==================================================================================================================
    // #443 : taux horaire chargé d'une fiche intervenant (cadrage, point 1).
    // ==================================================================================================================

    // Cadrage, point 1 et critères : « « 42,50 » → 42.50 ; « 0 » admis » ; virgule admise, deux décimales au plus, zéro
    // admis, plafond de la colonne. Création par chacun des quatre comptes de l'administration : la fiche est écrite au
    // taux exact (réponse et base), sous son nom et sa fonction. Les lectures écartées sont dans FORMES_ADMISES.
    test('création d’une fiche : chaque forme admise du taux (virgule, point, blancs, nombre, zéro, plafond) est écrite exactement, par chaque compte de l’administration', async () => {
      for (const [compte, auth] of ADMINISTRATION()) {
        for (const [quoi, valeur, attendu] of FORMES_ADMISES) {
          const nom = `TEST Création ${compte} ${suffixe()}`;
          const res = await creerFiche({ nom, role: 'Technicien', tauxHoraireCharge: valeur }, auth);
          assert.equal(res.status, 200, `${compte}, ${quoi} : ${JSON.stringify(res.body)}`);
          assert.equal(String(res.body.tauxHoraireCharge), attendu, `${compte}, ${quoi} : réponse`);
          const cree = await prisma.intervenant.findMany({ where: { nom } });
          assert.deepEqual(cree.map((f) => [f.tauxHoraireCharge.toString(), f.role]), [[attendu, 'Technicien']], `${compte}, ${quoi} : en base`);
        }
      }
    });

    // Cadrage, point 1 : « Création : taux absent, vide, `null` ou invalide → 400 » ; critères : « « abc », « -5 », « 12abc »,
    // vide, `null` → 400 sans écriture (empreinte de la base) » ; « un taux absent à la création donne `NaN` puis un 500
    // probable (…) : il devient un 400 ». Chaque forme, par chaque compte de l'administration, et l'absence du champ : 400 au
    // message exact, aucune fiche créée (empreinte de toute la base). Les lectures écartées sont dans FORMES_REFUSEES.
    test('création d’une fiche : taux absent, vide, null, négatif, texte, tableau, trois décimales, notation scientifique ou au-delà de la colonne : 400 au message exact, sans aucune écriture, par chaque compte de l’administration', async () => {
      for (const [compte, auth] of ADMINISTRATION()) {
        const nom = `TEST Création refusée ${compte} ${suffixe()}`;
        await refuse(() => creerFiche({ nom, role: 'Technicien' }, auth), 400, REFUS.taux, `${compte}, taux absent`);
        for (const [quoi, valeur] of FORMES_REFUSEES) {
          await refuse(() => creerFiche({ nom, role: 'Technicien', tauxHoraireCharge: valeur }, auth), 400, REFUS.taux, `${compte}, ${quoi}`);
        }
        assert.equal(await prisma.intervenant.count({ where: { nom } }), 0, `${compte} : aucune fiche créée`);
      }
    });

    // Cadrage, point 1 : modification, les mêmes formes admises (valeur de départ remplacée par la sentinelle avant chacune,
    // pour que la relecture prouve l'écriture). Le nom et la fonction envoyés avec le taux sont écrits avec lui.
    test('modification d’une fiche : chaque forme admise du taux est écrite exactement, par chaque compte de l’administration, avec le nom et la fonction envoyés', async () => {
      for (const [compte, auth] of ADMINISTRATION()) {
        const fiche = await ficheEnBase();
        for (const [quoi, valeur, attendu] of FORMES_ADMISES) {
          await prisma.intervenant.update({ where: { id: fiche.id }, data: { tauxHoraireCharge: SENTINELLE } });
          const nom = `TEST Modifiée ${compte} ${suffixe()}`;
          const res = await modifierFiche(fiche.id, { nom, role: 'Chef d’équipe', tauxHoraireCharge: valeur }, auth);
          assert.equal(res.status, 200, `${compte}, ${quoi} : ${JSON.stringify(res.body)}`);
          assert.equal(String(res.body.tauxHoraireCharge), attendu, `${compte}, ${quoi} : réponse`);
          const relue = await prisma.intervenant.findUniqueOrThrow({ where: { id: fiche.id } });
          assert.deepEqual([relue.tauxHoraireCharge.toString(), relue.nom, relue.role], [attendu, nom, 'Chef d’équipe'], `${compte}, ${quoi} : en base`);
        }
      }
    });

    // Cadrage, point 1 : « Modification : (…) vide, `null` ou invalide → 400 » ; critère : « sans écriture (empreinte de la
    // base) ». Une requête mêlée (nom et fonction valides, taux refusé) n'écrit rien non plus : écarte une écriture partielle
    // du nom avant le contrôle du taux. Avant le correctif, chaque forme vide, nulle ou non numérique ramenait le taux à 0.
    test('modification d’une fiche : taux vide, null, négatif, texte, tableau, trois décimales, notation scientifique ou au-delà de la colonne : 400 au message exact, sans aucune écriture, même avec un nom et une fonction valides', async () => {
      for (const [compte, auth] of ADMINISTRATION()) {
        const fiche = await ficheEnBase();
        for (const [quoi, valeur] of FORMES_REFUSEES) {
          await refuse(() => modifierFiche(fiche.id, { tauxHoraireCharge: valeur }, auth), 400, REFUS.taux, `${compte}, ${quoi}`);
          await refuse(() => modifierFiche(fiche.id, { nom: `TEST Renommée ${suffixe()}`, role: 'Chef d’équipe', tauxHoraireCharge: valeur }, auth), 400, REFUS.taux, `${compte}, ${quoi}, avec un nom et une fonction`);
        }
        const relue = await prisma.intervenant.findUniqueOrThrow({ where: { id: fiche.id } });
        assert.deepEqual([relue.tauxHoraireCharge.toString(), relue.nom, relue.role], [DEPART_TAUX, fiche.nom, 'Technicien'], compte);
      }
    });

    // Cadrage, point 1 : « Modification : taux absent → inchangé » ; critère : « absent en modification → inchangé ». Le nom
    // seul s'écrit et le taux garde sa valeur exacte ; un corps vide ne change rien. Écarte une lecture de l'absence comme
    // une saisie vide (400, ou 0 comme avant le correctif pour une saisie vide).
    test('modification d’une fiche sans taux : 200, le nom et la fonction envoyés sont écrits et le taux reste exactement le même ; un corps vide ne change rien', async () => {
      for (const [compte, auth] of ADMINISTRATION()) {
        const fiche = await ficheEnBase();
        const nom = `TEST Sans taux ${compte} ${suffixe()}`;
        const res = await modifierFiche(fiche.id, { nom, role: 'Chef d’équipe' }, auth);
        assert.equal(res.status, 200, `${compte} : ${JSON.stringify(res.body)}`);
        assert.equal(String(res.body.tauxHoraireCharge), DEPART_TAUX, `${compte} : réponse`);
        const relue = await prisma.intervenant.findUniqueOrThrow({ where: { id: fiche.id } });
        assert.deepEqual([relue.tauxHoraireCharge.toString(), relue.nom, relue.role], [DEPART_TAUX, nom, 'Chef d’équipe'], compte);
        const avant = await empreinte();
        assert.equal((await modifierFiche(fiche.id, {}, auth)).status, 200, `${compte} : corps vide`);
        assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${compte} : un corps vide ne change rien`);
      }
    });

    // Droits (redacteur-tests : « chaque type de compte concerné », « le passage par une clé d'intégration ») : les deux
    // routes restent réservées à l'administration (requireAdmin), et la garde passe avant la lecture du taux : un compte
    // hors administration reçoit 403, que le taux soit valide ou non (et non le 400 du taux, qui lui apprendrait la règle),
    // sans écriture. Une clé d'intégration n'ouvre pas ces routes de session (401, matrice cles.txt).
    test('fiches intervenants : chaque compte hors administration reçoit 403, taux valide ou non, et une clé d’intégration 401, sans écriture ; la garde passe avant la lecture du taux', async () => {
      const fiche = await ficheEnBase();
      for (const [compte, auth] of HORS_ADMINISTRATION()) {
        for (const valeur of ['42,50', 'abc']) {
          await refuse(() => creerFiche({ nom: `TEST Hors administration ${compte}`, role: 'Technicien', tauxHoraireCharge: valeur }, auth), 403, REFUS.administration, `${compte}, création, ${valeur}`);
          await refuse(() => modifierFiche(fiche.id, { tauxHoraireCharge: valeur }, auth), 403, REFUS.administration, `${compte}, modification, ${valeur}`);
        }
      }
      const cle = await ok(appeler('post', '/admin/api-keys', { nom: `TEST Clé taux horaire ${suffixe()}`, scopes: ['chantiers:read'] }), 201);
      for (const valeur of ['42,50', 'abc']) {
        await refuse(() => creerFiche({ nom: 'TEST Par une clé', role: 'Technicien', tauxHoraireCharge: valeur }, entete(cle.apiKey)), 401, REFUS.session, `clé d’intégration, création, ${valeur}`);
        await refuse(() => modifierFiche(fiche.id, { tauxHoraireCharge: valeur }, entete(cle.apiKey)), 401, REFUS.session, `clé d’intégration, modification, ${valeur}`);
      }
      assert.equal(await tauxEnBase(fiche.id), DEPART_TAUX);
    });

    // Copie figée (redacteur-tests ; commentaire de la route : « Le nouveau taux ne s'applique qu'aux pointages FUTURS ») et
    // montant (classé C) : le taux saisi à la virgule est celui que copie le pointage suivant, et le coût de main-d'œuvre du
    // chantier (metrics.moReel) en suit. Pointages de 2 h à 40 €, puis 2 h après « 42,50 », puis, après un « abc » refusé,
    // 1 h : 2 × 40 + 2 × 42,50 + 1 × 42,50 = 207,50 €, recalculé en centimes entiers par le témoin. Lectures écartées :
    // « 42,50 » lu 42 par `parseFloat` (2 × 40 + 3 × 42 = 206) ; virgule lue en milliers (2 × 40 + 3 × 4 250 = 12 830) ;
    // nouveau taux appliqué aussi au pointage passé (5 × 42,50 = 212,50) ; taux ramené à 0 par le « abc » refusé, comme avant
    // le correctif (2 × 40 + 2 × 42,50 + 1 × 0 = 165) ; taux inchangé (5 × 40 = 200).
    test('copie figée : un taux saisi « 42,50 » est copié à 42,50 € par les pointages suivants, le pointage passé garde 40 € ; un « abc » refusé ne change rien ; coût de main-d’œuvre 207,50 €', async () => {
      const centimes = (texte) => { const [e, d = ''] = String(texte).split('.'); return BigInt(e) * 100n + BigInt(d.padEnd(2, '0')); };
      const fiche = await ok(creerFiche({ nom: `TEST Copie figée ${suffixe()}`, role: 'Technicien', tauxHoraireCharge: '40' }));
      const chantier = await creerChantier({ dateDebut: new Date('2026-10-01T00:00:00.000Z') });
      const pointer = async (nbrHeures) => (await ok(appeler('post', '/heures', { chantierId: chantier.id, intervenantId: fiche.id, date: '20-10-2026', nbrHeures }))).id;
      const tauxApplique = async (id) => (await prisma.pointageHeure.findUniqueOrThrow({ where: { id } })).tauxHoraireApplique.toString();

      const premier = await pointer('2');
      assert.equal(await tauxApplique(premier), '40');
      await ok(modifierFiche(fiche.id, { tauxHoraireCharge: '42,50' }));
      const second = await pointer('2');
      await refuse(() => modifierFiche(fiche.id, { tauxHoraireCharge: 'abc' }), 400, REFUS.taux, '« abc » après « 42,50 »');
      const troisieme = await pointer('1');
      assert.deepEqual([await tauxApplique(premier), await tauxApplique(second), await tauxApplique(troisieme)], ['40', '42.5', '42.5']);
      // Témoin en décimal exact : somme des heures × taux figés, en centimes.
      const attendu = [['2', '40'], ['2', '42.50'], ['1', '42.50']].reduce((total, [h, t]) => total + (centimes(h) * centimes(t)) / 100n, 0n);
      assert.equal(attendu, 20750n);
      const lu = await ok(appeler('get', `/chantiers/${chantier.id}`));
      assert.equal(lu.metrics.moReel, 207.5, 'coût de main-d’œuvre du chantier');
    });

    // ==================================================================================================================
    // Reste de #289 : statut envoyé à la fiche (cadrage, point 3, choix par défaut, à confirmer).
    // ==================================================================================================================

    // Cadrage, point 3 : « pour l'administration seule, comme le 400 de #449, un `statut` envoyé reçoit un 400 qui renvoie à
    // la clôture et à la réouverture » ; critère : « PATCH /api/chantiers/:id avec `statut` → 400 renvoyant aux routes
    // dédiées ». Toute valeur, celle du chantier comprise, seule ou avec d'autres champs valides, sur un chantier en cours
    // comme terminé, par chacun des quatre comptes de l'administration. Écarte : le statut écrit (avant le correctif,
    // TERMINE et EN_COURS l'étaient), ignoré en silence (200, le nom écrit), un contrôle limité aux valeurs qui changent
    // le statut ou aux valeurs hors EN_COURS et TERMINE (refus de #449), et une écriture des autres champs du même corps.
    test('statut envoyé à la fiche par l’administration : 400 qui renvoie à la liste des chantiers, quelle que soit sa valeur, celle du chantier comprise, seul ou avec d’autres champs, sans écriture ; sans statut, le même corps est écrit', async () => {
      const enCours = await creerChantier();
      const termine = await creerTermine();
      const corps = [
        ['TERMINE', { statut: 'TERMINE' }], ['EN_COURS', { statut: 'EN_COURS' }], ['ANNULE', { statut: 'ANNULE' }],
        ['chaîne vide', { statut: '' }], ['null', { statut: null }], ['inconnu', { statut: 'INVENTE' }], ['tableau', { statut: ['TERMINE'] }],
        ['TERMINE avec un nom', { statut: 'TERMINE', nom: 'TEST nom glissé avec la clôture' }],
        ['EN_COURS avec heures vendues et date de fin', { statut: 'EN_COURS', heuresVendues: '18,75', dateFin: '31-10-2026' }],
      ];
      for (const [compte, auth] of ADMINISTRATION()) {
        for (const [quoi, c] of corps) {
          await refuse(() => modifierChantier(enCours.id, c, auth), 400, REFUS.statutParLaFiche, `${compte}, chantier en cours, statut ${quoi}`);
          await refuse(() => modifierChantier(termine.id, c, auth), 400, REFUS.statutParLaFiche, `${compte}, chantier terminé, statut ${quoi}`);
        }
      }
      assert.deepEqual([(await ligne(enCours.id)).statut, (await ligne(termine.id)).statut, jourIso((await ligne(termine.id)).dateFin)], ['EN_COURS', 'TERMINE', '2026-10-15']);
      // Ordre (comme le 400 de #449) : affaire annulée (409) et chantier inexistant (404) passent avant.
      const annule = await creerAnnule();
      await refuse(() => modifierChantier(annule.id, { statut: 'EN_COURS' }), 409, REFUS.ficheAnnulee, 'affaire annulée, statut EN_COURS');
      await refuse(() => modifierChantier('00000000-0000-0000-0000-000000000000', { statut: 'TERMINE' }), 404, REFUS.introuvable, 'chantier inexistant');
      // Témoin : sans le statut, le même corps est écrit (le refus tient au seul champ statut).
      const res = await modifierChantier(enCours.id, { nom: 'TEST nom sans statut', heuresVendues: '18,75' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const relu = await ligne(enCours.id);
      assert.deepEqual([relu.nom, relu.heuresVendues.toString(), relu.statut], ['TEST nom sans statut', '18.75', 'EN_COURS']);
    });

    // Cadrage, point 3 : « pour les autres comptes, le champ reste ignoré en silence comme aujourd'hui ». Assistante technique
    // (affaire d'autrui en cours) et chaque titulaire hors administration (CT, RESP, DC, AC, CPT) : 200, les autres champs
    // écrits, le statut et la date de fin inchangés. Les refus existants passent avant : technicien titulaire 403, compte
    // commercial 403, chantier terminé 403 pour son titulaire. Écarte un refus étendu à tous les comptes (400).
    test('statut envoyé à la fiche par un autre compte : ignoré en silence (200, le nom écrit, statut et date de fin inchangés) pour l’assistante technique et chaque titulaire hors administration ; refus existants inchangés', async () => {
      const cas = [['AT', comptes.CT.id], ['CT', comptes.CT.id], ['RESP', comptes.RESP.id], ['DC', comptes.DC.id], ['AC', comptes.AC.id], ['CPT', comptes.CPT.id]];
      for (const [cle, titulaire] of cas) {
        for (const statut of ['TERMINE', 'ANNULE', 'INVENTE']) {
          const chantier = await creerChantier({ responsableId: titulaire, dateFin: new Date('2026-12-15T00:00:00.000Z') });
          const nom = `TEST nom par ${cle} ${suffixe()}`;
          const res = await modifierChantier(chantier.id, { nom, statut }, comptes[cle].auth);
          assert.equal(res.status, 200, `${cle}, ${statut} : ${JSON.stringify(res.body)}`);
          assert.equal(res.body.statut, 'EN_COURS', `${cle}, ${statut} : réponse`);
          const relu = await ligne(chantier.id);
          assert.deepEqual([relu.nom, relu.statut, jourIso(relu.dateFin)], [nom, 'EN_COURS', '2026-12-15'], `${cle}, ${statut}`);
        }
      }
      const deTechnicien = await creerChantier({ responsableId: comptes.TECH.id });
      await refuse(() => modifierChantier(deTechnicien.id, { statut: 'TERMINE' }, comptes.TECH.auth), 403, REFUS.technicienFiche, 'technicien titulaire');
      const chantier = await creerChantier();
      await refuse(() => modifierChantier(chantier.id, { statut: 'TERMINE' }, comptes.COM.auth), 403, REFUS.compteCommercial, 'compte commercial');
      const termine = await creerTermine();
      await refuse(() => modifierChantier(termine.id, { statut: 'EN_COURS' }, comptes.CT.auth), 403, REFUS.ficheCloture, 'titulaire, chantier terminé');
      await refuse(() => modifierChantier(termine.id, { statut: 'EN_COURS' }, comptes.AT.auth), 403, REFUS.ficheCloture, 'assistante technique, chantier terminé');
    });

    // Cadrage, critère : « la route `/statut` garde ses refus et pose la date de fin à la clôture » ; non-régression de PATCH
    // /api/chantiers/:id/statut (dont le test existant d'api.test.mjs, commissions sans plan). Clôture par chaque compte de
    // l'administration et par le titulaire : date de fin posée au jour de la société, ou gardée si elle était saisie ;
    // réouverture par l'administration, la date de fin gardée ; refus du titulaire qui rouvre, du technicien, du compte
    // commercial, de l'assistante technique, d'un statut invalide et d'une affaire annulée, sans écriture.
    test('route dédiée /statut : clôture par l’administration et le titulaire (date de fin posée au jour de la société, ou gardée), réouverture par l’administration, ses refus inchangés et sans écriture', async () => {
      for (const [compte, auth] of [...ADMINISTRATION(), ['CT titulaire', comptes.CT.auth]]) {
        const chantier = await creerChantier();
        const avant = await aujourdhui();
        const res = await changerStatut(chantier.id, { statut: 'TERMINE' }, auth);
        assert.equal(res.status, 200, `${compte} : ${JSON.stringify(res.body)}`);
        const apres = await aujourdhui();
        const relu = await ligne(chantier.id);
        assert.equal(relu.statut, 'TERMINE', compte);
        assert.ok([avant, apres].includes(jourIso(relu.dateFin)), `${compte} : date de fin posée au jour de la société (${jourIso(relu.dateFin)})`);
        const saisie = await creerChantier({ dateFin: new Date('2026-10-20T00:00:00.000Z') });
        await ok(changerStatut(saisie.id, { statut: 'TERMINE' }, auth));
        assert.deepEqual([(await ligne(saisie.id)).statut, jourIso((await ligne(saisie.id)).dateFin)], ['TERMINE', '2026-10-20'], `${compte} : date de fin saisie gardée`);
      }
      const termine = await creerTermine();
      await refuse(() => changerStatut(termine.id, { statut: 'EN_COURS' }, comptes.CT.auth), 403, REFUS.reouverture, 'titulaire qui rouvre');
      await refuse(() => changerStatut(termine.id, { statut: 'EN_COURS' }, comptes.AT.auth), 403, REFUS.assistanteStatut, 'assistante technique');
      await refuse(() => changerStatut(termine.id, { statut: 'EN_COURS' }, comptes.COM.auth), 403, REFUS.compteCommercial, 'compte commercial');
      await refuse(() => changerStatut(termine.id, { statut: 'ANNULE' }), 400, REFUS.statutInvalide, 'statut invalide');
      const deTechnicien = await creerChantier({ responsableId: comptes.TECH.id });
      await refuse(() => changerStatut(deTechnicien.id, { statut: 'TERMINE' }, comptes.TECH.auth), 403, REFUS.technicienCloture, 'technicien titulaire');
      const annule = await creerAnnule();
      await refuse(() => changerStatut(annule.id, { statut: 'TERMINE' }), 409, REFUS.statutAnnulee, 'affaire annulée');
      for (const [compte, auth] of ADMINISTRATION()) {
        const aRouvrir = await creerTermine();
        await ok(changerStatut(aRouvrir.id, { statut: 'EN_COURS' }, auth));
        assert.deepEqual([(await ligne(aRouvrir.id)).statut, jourIso((await ligne(aRouvrir.id)).dateFin)], ['EN_COURS', '2026-10-15'], `${compte} : réouverture, date de fin gardée`);
      }
    });

    // ==================================================================================================================
    // Reste de #289 : date de fin d'un chantier terminé (décision de Nelson du 16-11-2026, « Refuser le vidage »).
    // ==================================================================================================================

    // Décision du 16-11-2026 ; critère : « vider la date de fin d'un chantier terminé → 400 sans écriture ; la changer → 200 ».
    // Par chacun des quatre comptes de l'administration (seuls à modifier un chantier terminé), en chaîne vide et en `null`,
    // seule ou avec d'autres champs valides : 400 au message exact, rien n'est écrit (ni les autres champs, ni `updatedAt`).
    // Puis la date changée est écrite, au jour saisi. Écarte : le vidage admis (comportement d'avant), un refus du seul
    // `null` ou de la seule chaîne vide, une écriture des autres champs, et un refus étendu au changement de date.
    test('chantier terminé : vider sa date de fin (chaîne vide ou null, seule ou avec d’autres champs) est refusé (400) à chaque compte de l’administration, sans écriture ; la changer est admis', async () => {
      for (const [compte, auth] of ADMINISTRATION()) {
        const chantier = await creerTermine();
        for (const [quoi, corps] of [
          ['chaîne vide', { dateFin: '' }], ['null', { dateFin: null }],
          ['avec un nom, des heures vendues et une date de début', { dateFin: '', nom: 'TEST nom glissé avec le vidage', heuresVendues: '18,75', dateDebut: '02-09-2026' }],
        ]) {
          await refuse(() => modifierChantier(chantier.id, corps, auth), 400, REFUS.dateFinVidee, `${compte}, vidage, ${quoi}`);
        }
        const res = await modifierChantier(chantier.id, { dateFin: '31-10-2026' }, auth);
        assert.equal(res.status, 200, `${compte}, date changée : ${JSON.stringify(res.body)}`);
        const relu = await ligne(chantier.id);
        assert.deepEqual([relu.statut, jourIso(relu.dateFin)], ['TERMINE', '2026-10-31'], `${compte}, date changée`);
        // Cadrage, point 3 : « Aucune entrée de journal ajoutée » (la question du journal de la clôture reste ouverte).
        assert.equal(await prisma.journalSaisieChantier.count({ where: { chantierId: chantier.id } }), 0, `${compte}, aucune entrée de journal`);
      }
    });

    // Le refus ne vise que le chantier terminé (décision : « Un chantier terminé garde toujours une date de fin ») : sur un
    // chantier en cours, la date de fin reste facultative et se vide, par l'administration comme par le titulaire. Ordre
    // (cadrage : « après les refus existants ») : sur un chantier terminé, une saisie invalide garde son message (heures
    // vendues, format de la date), le titulaire son 403 et l'affaire annulée son 409, sans écriture. Écarte un refus de
    // tout vidage, et un contrôle placé avant les refus existants.
    test('chantier en cours : sa date de fin se vide toujours (administration et titulaire) ; sur un chantier terminé, les refus existants passent avant celui du vidage, sans écriture', async () => {
      for (const [compte, auth] of [['SA', admin()], ['CT titulaire', comptes.CT.auth]]) {
        const chantier = await creerChantier({ dateFin: new Date('2026-12-15T00:00:00.000Z') });
        const res = await modifierChantier(chantier.id, { dateFin: '' }, auth);
        assert.equal(res.status, 200, `${compte} : ${JSON.stringify(res.body)}`);
        assert.deepEqual([(await ligne(chantier.id)).statut, (await ligne(chantier.id)).dateFin], ['EN_COURS', null], compte);
      }
      const termine = await creerTermine();
      await refuse(() => modifierChantier(termine.id, { dateFin: '', heuresVendues: 'abc' }), 400, REFUS.heuresInvalides, 'vidage et heures vendues invalides');
      await refuse(() => modifierChantier(termine.id, { dateFin: '31-02-2026' }), 400, REFUS.dateFinFormat, 'date de fin invalide');
      await refuse(() => modifierChantier(termine.id, { dateFin: '' }, comptes.CT.auth), 403, REFUS.ficheCloture, 'titulaire, vidage');
      const annule = await creerAnnule({ dateFin: DATE_FIN });
      await refuse(() => modifierChantier(annule.id, { dateFin: '' }), 409, REFUS.ficheAnnulee, 'affaire annulée, vidage');
      // Clôturé par la route dédiée (date de fin posée), le chantier garde sa date : le vidage par la fiche est refusé.
      const cloture = await creerChantier();
      await ok(changerStatut(cloture.id, { statut: 'TERMINE' }));
      const posee = jourIso((await ligne(cloture.id)).dateFin);
      assert.ok(posee, 'date de fin posée à la clôture');
      await refuse(() => modifierChantier(cloture.id, { dateFin: null }), 400, REFUS.dateFinVidee, 'chantier clôturé par la route dédiée, vidage');
      assert.equal(jourIso((await ligne(cloture.id)).dateFin), posee);
    });

    // Cadrage, point 3 : « Contrôle sur la ligne verrouillée (`verrouille.statut`) » ; tests : « course « clôture validée
    // pendant l'attente du verrou » (le vidage est refusé si la clôture est passée avant) ». Le vidage d'un chantier en cours
    // part, attend la ligne ; la clôture est validée pendant l'attente (date de fin saisie gardée, ou posée par la clôture) :
    // 400, la date de fin de la clôture reste. Réciproque : un chantier terminé rouvert pendant l'attente se vide (200).
    // Témoin : sans clôture pendant l'attente, le vidage passe. Écarte un contrôle fait sur la lecture d'avant le verrou
    // (`existant.statut`), qui laisserait un chantier terminé sans date de fin dans le premier cas et refuserait le second.
    test('course : une clôture validée pendant que le vidage de la date de fin attend la ligne fait refuser le vidage (400), sans écriture ; une réouverture pendant l’attente le laisse passer', async () => {
      for (const [quoi, depart, cloture] of [
        ['date de fin saisie avant la clôture', { dateFin: new Date('2026-10-20T00:00:00.000Z') }, { statut: 'TERMINE' }],
        ['date de fin posée par la clôture', {}, { statut: 'TERMINE', dateFin: new Date('2026-10-30T00:00:00.000Z') }],
      ]) {
        const chantier = await creerChantier(depart);
        const { res, attendu } = await sousVerrou(chantier.id, () => modifierChantier(chantier.id, { dateFin: '' }), (tx) => tx.chantier.update({ where: { id: chantier.id }, data: cloture }));
        assert.equal(res.status, 400, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
        assert.equal(res.body.error, REFUS.dateFinVidee, quoi);
        assert.deepEqual(tablesChangees(attendu, await empreinte()), [], `${quoi} : la requête refusée ne doit rien écrire`);
        const relu = await ligne(chantier.id);
        assert.deepEqual([relu.statut, jourIso(relu.dateFin)], ['TERMINE', jourIso(depart.dateFin ?? cloture.dateFin)], quoi);
      }
      // Réciproque : terminé au départ, rouvert pendant l'attente : la ligne verrouillée est en cours, le vidage passe.
      const rouvert = await creerTermine();
      const reouverture = await sousVerrou(rouvert.id, () => modifierChantier(rouvert.id, { dateFin: null }), (tx) => tx.chantier.update({ where: { id: rouvert.id }, data: { statut: 'EN_COURS' } }));
      assert.equal(reouverture.res.status, 200, JSON.stringify(reouverture.res.body));
      assert.deepEqual([(await ligne(rouvert.id)).statut, (await ligne(rouvert.id)).dateFin], ['EN_COURS', null]);
      // Ordre sous le verrou (cadrage, point 3 : « après les refus existants ») : le titulaire vide la date de fin de son chantier
      // en cours ; l'administration le clôture pendant l'attente. Le refus du chantier clôturé (403, refusEcritureChantier relu
      // sous le verrou) passe avant celui du vidage, sans écriture. Écarte un contrôle du vidage placé avant les refus relus
      // sous le verrou (400 du vidage).
      const duTitulaire = await creerChantier({ dateFin: new Date('2026-10-20T00:00:00.000Z') });
      const parTitulaire = await sousVerrou(duTitulaire.id, () => modifierChantier(duTitulaire.id, { dateFin: '' }, comptes.CT.auth), (tx) => tx.chantier.update({ where: { id: duTitulaire.id }, data: { statut: 'TERMINE' } }));
      assert.deepEqual([parTitulaire.res.status, parTitulaire.res.body.error], [403, REFUS.ficheCloture], 'titulaire, clôture pendant l’attente du vidage');
      assert.deepEqual(tablesChangees(parTitulaire.attendu, await empreinte()), [], 'titulaire : la requête refusée ne doit rien écrire');
      assert.deepEqual([(await ligne(duTitulaire.id)).statut, jourIso((await ligne(duTitulaire.id)).dateFin)], ['TERMINE', '2026-10-20']);
      // Témoin : en cours, sans clôture pendant l'attente (seul le nom change), le vidage passe.
      const temoin = await creerChantier({ dateFin: new Date('2026-10-20T00:00:00.000Z') });
      const libre = await sousVerrou(temoin.id, () => modifierChantier(temoin.id, { dateFin: '' }), (tx) => tx.chantier.update({ where: { id: temoin.id }, data: { nom: 'TEST nom changé pendant l’attente' } }));
      assert.equal(libre.res.status, 200, JSON.stringify(libre.res.body));
      assert.deepEqual([(await ligne(temoin.id)).nom, (await ligne(temoin.id)).dateFin], ['TEST nom changé pendant l’attente', null]);
    });

    // Montant (classé C) : l'effet de la décision du 16-11-2026, « le mois de commission ne glisse plus ». Un chantier terminé
    // et encaissé de 1 234,56 € HT, daté du 15-03-2025, porte son CA validé dans le mois de mars 2025
    // (GET /api/stats/commerciaux, commissions/metier.ts) ; le vidage refusé l'y laisse, et le mois courant reste à 0 ; la date
    // changée au 10-04-2025 le porte en avril. Lecture écartée : vidage admis, le chantier prend sa date de dernière
    // modification (`updatedAt`, le mois courant) : mars à 0, mois courant à 1 234,56 €. Dates de 2025, jamais le mois courant.
    test('mois du CA validé : un chantier terminé et encaissé reste dans le mois de sa date de fin après un vidage refusé (1 234,56 € en mars 2025, 0 dans le mois courant) ; sa date changée le porte dans le nouveau mois', async () => {
      const commercial = await creerCompte('COMMERCIAL', 'COM-CA');
      const chantier = await creerChantier({
        statut: 'TERMINE', dateFin: new Date('2025-03-15T00:00:00.000Z'), encaisse: true, dateEncaissement: new Date('2025-03-20T09:00:00.000Z'),
        budgetGlobalVendu: '1234.56', commercialId: commercial.id,
      });
      const caDuMois = async (ref) => {
        const stats = await ok(appeler('get', `/stats/commerciaux?period=month&ref=${ref}`));
        const ligneCommercial = stats.commerciaux.find((c) => c.id === commercial.id);
        assert.ok(ligneCommercial, `commercial présent (${ref})`);
        return [ligneCommercial.caTotal, ligneCommercial.chantiers.find((c) => c.id === chantier.id)?.comptabiliseDansPeriode];
      };
      const moisCourant = await aujourdhui();
      assert.ok(!moisCourant.startsWith('2025-03') && !moisCourant.startsWith('2025-04'), 'mois courant distinct des mois du test');
      assert.deepEqual(await caDuMois('2025-03-15'), [1234.56, true], 'mars 2025, avant le vidage');
      await refuse(() => modifierChantier(chantier.id, { dateFin: '' }), 400, REFUS.dateFinVidee, 'vidage');
      assert.deepEqual(await caDuMois('2025-03-15'), [1234.56, true], 'mars 2025, après le vidage refusé');
      assert.deepEqual(await caDuMois(moisCourant), [0, false], 'mois courant, après le vidage refusé');
      await ok(modifierChantier(chantier.id, { dateFin: '10-04-2025' }));
      assert.deepEqual(await caDuMois('2025-03-15'), [0, false], 'mars 2025, après le changement de date');
      assert.deepEqual(await caDuMois('2025-04-15'), [1234.56, true], 'avril 2025, après le changement de date');
    });
  });
}
