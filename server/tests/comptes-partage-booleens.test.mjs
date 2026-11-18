// Lot #587, volet droits et sécurité : drapeaux des comptes et du partage du planning lus en booléen strict (cadrage
// v2, rédigée par le controleur-coherence sur main à 4f71e8e, sections « Périmètre », « Critères observables » et
// « Tests » ; issue #587, note N3 du contrôle de cohérence du cadrage de #570 ; message de Nelson du 17-11-2026,
// « Ok continu », qui renvoie à celui du 16-11-2026, « continu avec les issu. »). Règle 2 de la méthode : activation
// d'un compte, accès financier, marqueur « aussi commercial », lien public du planning et leurs entrées au journal
// d'administration.
//
// Avant le lot, `PATCH /api/users/:id/actif`, `…/acces-finance`, `…/est-commercial`, `PATCH /api/planning/share` et
// `POST /api/users` lisaient leur drapeau par `!!req.body.x` : la chaîne « false » valait vrai (elle réactivait un
// compte, accordait l'accès financier, ouvrait le lien public), une clé absente ou `null` valait faux (un corps `{}`
// désactivait un compte ou fermait le lien), et une requête sans corps JSON répondait 500.
//
// Ce que prouve ce fichier, par des requêtes HTTP réelles, chaque écriture relue en base, chaque refus prouvé sans
// écriture (empreinte de toute la base : le compte et le partage, leurs `updatedAt` compris, et le journal
// d'administration ; plus la relecture explicite de la cible et le décompte du journal) :
//   1. chaque route de modification refuse en 400, au message exact « « <clé> » doit valoir true ou false. », les
//      valeurs « false », « true », « 0 », « », 0, 1, null, {}, [], [true], la clé absente, une clé voisine seule, un
//      corps tableau, une requête sans corps JSON (sans Content-Type, JSON vide, texte brut, formulaire), par chaque
//      compte admis (super administrateur, administrateur, directeur selon les gardes) ;
//   2. l'ordre des contrôles : 401 et 403 des gardes, et 403 PLANNING_DESACTIVE pour le partage, avant le 400 ; le 400
//      avant le 404 du compte inconnu, du compte système et du partage jamais publié (base neuve, propre au fichier),
//      et avant les refus métier (super administrateur ciblé, son propre compte, dernier super administrateur actif,
//      type « aussi commercial », technicien et accès financier) ;
//   3. `true` et `false` gardent leur comportement : mêmes refus, mêmes messages, même journal, verrou des retraits
//      pris pour la seule désactivation (#216), lien ouvert et fermé sans changer de jeton ;
//   4. `POST /api/users` : une valeur non booléenne des cases facultatives est refusée en tête du gestionnaire, pour
//      tout demandeur et tout type de compte créé (même quand la valeur serait ignorée), avant le 403 du type, le 400
//      du technicien, les 400 de l'adresse et du nom et le 409 ; la clé absente vaut false ; `true` est accordé selon
//      les règles actuelles.
//
// Fichier propre au lot, avec sa base jetable : `node --test` exécute les fichiers en parallèle, et api.test.mjs purge
// les données « TEST » de TEST_DATABASE_URL ; surtout, le cas « partage jamais publié » demande une base sans partage
// (cadrage v2, « Tests »). TEST_DATABASE_URL ne sert donc ici que de connexion administrative : une base neuve est
// créée, migrée, servie à l'application montée en mémoire, puis supprimée. Sans TEST_DATABASE_URL, le fichier s'annonce
// ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { empreinteBase, tablesChangees, tablesDeLaBase } from './matrice-droits/outils.mjs';

const TITRE = 'Lot #587 (droits et sécurité) : drapeaux des comptes et du partage du planning lus en booléen strict';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Compte système créé par la migration (server/src/droits/roles.ts, COMPTE_SYSTEME_ID).
const COMPTE_SYSTEME_ID = '00000000-0000-4000-8000-000000000001';
// Verrou consultatif des retraits de comptes (comptes.ts, verrouillerRetraitsComptes, #216).
const VERROU_RETRAITS = 814091;

// Messages exacts. Le refus du drapeau est celui du cadrage (périmètre 1) ; les autres sont inchangés par le lot.
const REFUS_DRAPEAU = (cle) => `« ${cle} » doit valoir true ou false.`;
const MESSAGES = {
  authentification: 'Authentification requise',
  compteDesactive: 'Ce compte est désactivé.',
  administrateurs: 'Accès réservé aux administrateurs',
  superAdministrateur: 'Accès réservé au super administrateur',
  planningDesactive: "Le module Planning est désactivé par l'administration.",
  introuvable: 'Utilisateur introuvable.',
  jamaisPublie: "Le planning n'a encore jamais été publié.",
  lienIndisponible: "Ce lien de planning n'est plus disponible. Contactez votre administrateur.",
  cibleSuperAdmin: 'Seul un super administrateur peut gérer un compte super administrateur.',
  propreCompte: 'Vous ne pouvez pas désactiver votre propre compte.',
  dernierSuperAdmin: 'Ce compte est le dernier super administrateur : il ne peut pas être désactivé.',
  aussiCommercial: 'Seul un compte Administrateur peut être marqué "aussi commercial".',
  technicienFinance: 'L’accès financier ne s’accorde pas à un compte technicien.',
  typeAdminParDirecteur: 'Un directeur n’attribue pas le type Administrateur.',
  adresse: 'Adresse email invalide.',
  nom: 'Le nom est requis.',
  adressePrise: 'Un compte existe déjà pour cet email.',
};
// Types de compte refusés par requireAdmin (tous sauf super administrateur, administrateur et directeur).
const TYPES_HORS_ADMINISTRATION = ['RESPONSABLE', 'CONDUCTEUR_TRAVAUX', 'COMMERCIAL', 'DIRECTEUR_COMMERCIAL', 'ASSISTANTE_COMMERCIALE', 'ASSISTANTE_TECHNIQUE', 'COMPTABLE', 'TECHNICIEN'];
// Types qu'une création de compte accepte (comptes.ts, ALLOWED_ROLES).
const TYPES_CREES = ['SUPERADMIN', 'ADMIN', 'DIRECTEUR', 'RESPONSABLE', 'CONDUCTEUR_TRAVAUX', 'COMMERCIAL', 'DIRECTEUR_COMMERCIAL', 'ASSISTANTE_COMMERCIALE', 'ASSISTANTE_TECHNIQUE', 'COMPTABLE', 'TECHNICIEN'];
// Valeurs présentes non admises (cadrage, « Critères observables » : « "false", "true", 0, 1, null, {}, [] » ; null
// refusé, lecture de #570). « 0 », la chaîne vide et [true] écartent un lecteur qui n'accepterait que quelques chaînes,
// convertirait une chaîne ou lirait le premier élément d'un tableau.
const VALEURS_REFUSEES = [
  ['la chaîne « false »', 'false'], ['la chaîne « true »', 'true'], ['la chaîne « 0 »', '0'], ['la chaîne vide', ''],
  ['le nombre 0', 0], ['le nombre 1', 1], ['null', null], ['un objet vide', {}], ['un tableau vide', []], ['le tableau [true]', [true]],
];
// Envois refusés d'une route de modification, dont le drapeau est obligatoire (cadrage, périmètre 2) : chaque valeur
// non admise, la clé absente (corps {}), une clé voisine seule, un corps tableau, et une requête sans corps JSON
// (Express 5 laisse alors req.body à undefined ; avant le lot : 500).
const envoisRefuses = (cle, voisine) => [
  ...VALEURS_REFUSEES.map(([nom, valeur]) => ({ nom: `${cle} vaut ${nom}`, envoyer: (r) => r.send({ [cle]: valeur }) })),
  { nom: 'clé absente (corps {})', envoyer: (r) => r.send({}) },
  { nom: `clé voisine seule (${voisine}: false)`, envoyer: (r) => r.send({ [voisine]: false }) },
  { nom: 'corps tableau vide', envoyer: (r) => r.send([]) },
  { nom: `corps tableau [{ ${cle}: false }]`, envoyer: (r) => r.send([{ [cle]: false }]) },
  { nom: 'sans corps ni Content-Type', envoyer: (r) => r },
  { nom: 'Content-Type JSON sans corps', envoyer: (r) => r.set('Content-Type', 'application/json') },
  { nom: 'texte brut', envoyer: (r) => r.set('Content-Type', 'text/plain').send(`${cle}=false`) },
  { nom: 'formulaire', envoyer: (r) => r.type('form').send(`${cle}=false`) },
];

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    const nomBase = `iris_test_booleens587_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const cibleApplication = new URL(cible);
    cibleApplication.searchParams.set('connection_limit', '12');
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;

    let request; let app; let prisma; let appPrisma; let jwt;
    let tables = [];
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    // Comptes demandeurs : SA (accès de secours), SA2 (second super administrateur), AD, DIR, AD-DESACTIVE, et un
    // compte par type hors administration.
    const comptes = {};
    let rang = 0;
    const suffixe = () => `${Date.now()}-${(rang += 1)}`;

    const signer = (id) => entete(jwt.sign({ id }, process.env.JWT_SECRET));
    const creerCompte = async (code, role, extra = {}) => {
      const s = suffixe();
      const compte = await prisma.user.create({ data: { email: `booleens587.${code.toLowerCase()}.${s}@iris.test`, name: `TEST ${code} booléens 587 ${s}`, role, ...extra } });
      comptes[code] = { ...compte, auth: signer(compte.id) };
      return comptes[code];
    };
    // Cible fraîche d'un cas : un compte posé en base, sans passer par les routes du lot.
    const nouvelleCible = async (role, extra = {}) => {
      const s = suffixe();
      return prisma.user.create({ data: { email: `booleens587.cible.${s}@iris.test`, name: `TEST Cible booléens 587 ${s}`, role, ...extra } });
    };
    const ADMIS = () => [['super administrateur', comptes.SA.auth], ['administrateur', comptes.AD.auth], ['directeur', comptes.DIR.auth]];

    const empreinte = () => empreinteBase(prisma, tables);
    const compteEnBase = async (id) => JSON.parse(JSON.stringify(await prisma.user.findUnique({ where: { id } })));
    const partageEnBase = async () => JSON.parse(JSON.stringify(await prisma.planningPublicShare.findUnique({ where: { id: 'singleton' } })));
    const idsJournal = async () => new Set((await prisma.journalAdministration.findMany({ select: { id: true } })).map((e) => e.id));
    // Entrées du journal d'administration écrites depuis `avant` (ensemble d'identifiants), sans identifiant ni date.
    const entreesDepuis = async (avant) => (await prisma.journalAdministration.findMany({ orderBy: { createdAt: 'asc' } }))
      .filter((e) => !avant.has(e.id))
      .map(({ id: _id, createdAt: _date, ...reste }) => reste);
    const entreeCompte = (action, cible, auteur, avant, apres, { concerneSuperAdmin = false } = {}) => ({
      domaine: 'DROITS', type: 'COMPTE', action, cibleId: cible.id, cibleLibelle: `${cible.name} (${cible.email})`, avant, apres, detail: null,
      concerneSuperAdmin, reserveSuperAdmin: false, auteurId: auteur.id, auteurNom: auteur.name, auteurSuperAdmin: auteur.role === 'SUPERADMIN',
    });
    const entreePartage = (action, auteur, avant, apres) => ({
      domaine: 'REGLAGES', type: 'PARTAGE_PLANNING', action, cibleId: null, cibleLibelle: null, avant, apres, detail: null,
      concerneSuperAdmin: false, reserveSuperAdmin: false, auteurId: auteur.id, auteurNom: auteur.name, auteurSuperAdmin: auteur.role === 'SUPERADMIN',
    });

    // Un refus : statut et corps exacts, aucune écriture dans toute la base (le compte ou le partage et leurs
    // `updatedAt`, le journal d'administration), la cible relue identique, le journal sans entrée nouvelle.
    const refuse = async (envoi, statut, attendu, quoi, relire = null) => {
      const avant = await empreinte();
      const cibleAvant = relire ? await relire() : null;
      const journalAvant = await prisma.journalAdministration.count();
      const res = await envoi();
      assert.equal(res.status, statut, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, typeof attendu === 'string' ? { error: attendu } : attendu, quoi);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      if (relire) assert.deepEqual(await relire(), cibleAvant, `${quoi} : cible relue en base, updatedAt compris`);
      assert.equal(await prisma.journalAdministration.count(), journalAvant, `${quoi} : aucune entrée du journal d’administration`);
    };
    const ok = async (promesse, statut = 200) => {
      const res = await promesse;
      assert.equal(res.status, statut, JSON.stringify(res.body));
      return res.body;
    };
    const patch = (chemin, auth) => (auth ? request(app).patch(chemin).set(auth) : request(app).patch(chemin));

    // Verrou consultatif des retraits tenu par une connexion témoin, hors de l'application ; `avant` s'exécute dans la
    // même transaction (écriture de préparation). Rend la connexion pour relever les attentes et conclure.
    const tenirVerrouRetraits = async (avant = null) => {
      const temoin = new pg.Client({ connectionString: cible.toString() });
      await temoin.connect();
      const { rows: [{ pid }] } = await temoin.query('SELECT pg_backend_pid() AS pid');
      await temoin.query('BEGIN');
      await temoin.query('SELECT pg_advisory_xact_lock($1)', [VERROU_RETRAITS]);
      if (avant) await avant(temoin);
      const attentesConsultatives = async () => (await administrationPg.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = 'Lock' AND wait_event = 'advisory' AND pid <> $2",
        [nomBase, pid],
      )).rows[0].n;
      const conclure = async (validation) => { await temoin.query(validation ? 'COMMIT' : 'ROLLBACK').catch(() => {}); await temoin.end().catch(() => {}); };
      return { attentesConsultatives, conclure };
    };
    // Une requête attendue sans attente du verrou : elle doit répondre en moins de `delai` ms (sinon null). Restée en
    // attente, elle est gardée dans `enSuspens`, que le test attend une fois le verrou rendu : elle ne peut pas aboutir
    // pendant le test suivant et y passer pour une écriture.
    const sansAttente = async (envoi, enSuspens, delai = 3_000) => {
      let minuteur;
      const requete = envoi().then((r) => r, (erreur) => ({ status: 'erreur', body: String(erreur) }));
      const res = await Promise.race([requete, new Promise((ok) => { minuteur = setTimeout(() => ok(null), delai); })]);
      clearTimeout(minuteur);
      if (!res) enSuspens.push(requete);
      return res;
    };
    const attendreAttente = async (verrou) => {
      for (let tour = 0; tour < 150; tour += 1) {
        if (await verrou.attentesConsultatives() >= 1) return true;
        await pause(20);
      }
      return false;
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
      const { PrismaClient } = await import('@prisma/client');
      prisma = new PrismaClient({ datasources: { db: { url: cible.toString() } } });
      jwt = (await import('jsonwebtoken')).default;
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      const secours = await prisma.user.findUniqueOrThrow({ where: { email: 'secours@iris.test' } });
      assert.equal(secours.role, 'SUPERADMIN');
      comptes.SA = { ...secours, auth: entete(connexion.body.token) };
      await creerCompte('SA2', 'SUPERADMIN');
      await creerCompte('AD', 'ADMIN');
      await creerCompte('DIR', 'DIRECTEUR');
      await creerCompte('AD-DESACTIVE', 'ADMIN', { actif: false });
      for (const type of TYPES_HORS_ADMINISTRATION) await creerCompte(type, type);
      // Réglages créés à leur première lecture (getParametres, lu par requirePlanningActif) : avant la première
      // empreinte, pour qu'une lecture ne passe pas pour une écriture. La base est neuve : aucun partage publié.
      const partage = await ok(request(app).get('/api/planning/share').set(comptes.AD.auth));
      assert.deepEqual(partage, { published: false, active: false, token: null, updatedAt: null }, 'base neuve : planning jamais publié');
      tables = await tablesDeLaBase(prisma);
      assert.ok(['User', 'PlanningPublicShare', 'JournalAdministration', 'Parametres'].every((t) => tables.includes(t)) && tables.length > 40, `tables relevées : ${tables.join(', ')}`);
    });

    // #552 : la connexion administrative est fermée même si la suppression de la base échoue ; une connexion de
    // l'application rouverte pendant la suppression la fait échouer : elle est retentée deux fois.
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
            await pause(500);
          }
        }
      } finally {
        await administrationPg.end().catch(() => {});
      }
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 1. Partage du planning (PATCH /api/planning/share)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, « Critères observables » (400 avant le 404 du partage jamais publié) et « Tests » : « Le cas « partage
    // jamais publié » demande une base sans partage […]. Sinon, le mutant « contrôle après la lecture du partage »
    // survit. » Joué en premier, sur la base neuve du fichier : aucune ligne PlanningPublicShare n'existe.
    test('partage jamais publié (base neuve) : chaque valeur non booléenne, la clé absente ou une requête sans corps JSON répond 400 « « active » doit valoir true ou false. » avant le 404 « Le planning n’a encore jamais été publié. », que true et false reçoivent ; rien n’est écrit', async () => {
      assert.equal(await prisma.planningPublicShare.count(), 0, 'base neuve : aucun partage');
      for (const [qui, auth] of ADMIS()) {
        for (const envoi of envoisRefuses('active', 'actif')) {
          await refuse(() => envoi.envoyer(patch('/api/planning/share', auth)), 400, REFUS_DRAPEAU('active'), `${qui}, partage jamais publié, ${envoi.nom}`);
        }
        for (const active of [true, false]) {
          await refuse(() => patch('/api/planning/share', auth).send({ active }), 404, MESSAGES.jamaisPublie, `${qui}, partage jamais publié, active: ${active}`);
        }
      }
      assert.equal(await prisma.planningPublicShare.count(), 0, 'aucun partage créé par un refus');
    });

    // Cadrage v2, périmètre 4 (« le contrôle du corps passe après les gardes de la route : 401 de requireAuth, 403 de
    // requireAdmin […] ») : les gardes répondent d'abord, quelle que soit la valeur envoyée.
    test('partage : sans session, avec un compte désactivé ou un type hors administration, la garde répond (401, 403) avant le contrôle du drapeau, quelle que soit la valeur ; rien n’est écrit', async () => {
      for (const corps of [{ active: 'false' }, {}, { active: null }, { active: true }]) {
        await refuse(() => patch('/api/planning/share').send(corps), 401, MESSAGES.authentification, `sans session, ${JSON.stringify(corps)}`);
        await refuse(() => patch('/api/planning/share', comptes['AD-DESACTIVE'].auth).send(corps), 401, { code: 'COMPTE_DESACTIVE', error: MESSAGES.compteDesactive }, `administrateur désactivé, ${JSON.stringify(corps)}`);
        for (const type of TYPES_HORS_ADMINISTRATION) {
          await refuse(() => patch('/api/planning/share', comptes[type].auth).send(corps), 403, MESSAGES.administrateurs, `${type}, ${JSON.stringify(corps)}`);
        }
      }
      await refuse(() => patch('/api/planning/share'), 401, MESSAGES.authentification, 'sans session, sans corps');
      await refuse(() => patch('/api/planning/share', comptes.TECHNICIEN.auth), 403, MESSAGES.administrateurs, 'technicien, sans corps');
    });

    // Cadrage v2, périmètre 4 : « (v2) et 403 PLANNING_DESACTIVE de requirePlanningActif pour le partage (le super
    // administrateur en est exempté) » ; critère « 403 PLANNING_DESACTIVE (administrateur, directeur) avant le 400 ».
    // Tue le mutant « contrôle du partage placé avant requirePlanningActif ».
    test('partage, module Planning désactivé : l’administrateur et le directeur reçoivent 403 PLANNING_DESACTIVE avant le contrôle du drapeau ; le super administrateur, exempté, reçoit le 400 du drapeau ; rien n’est écrit', async () => {
      await ok(request(app).put('/api/modules').set(comptes.SA.auth).send({ planningActif: false }));
      try {
        for (const [qui, auth] of [['administrateur', comptes.AD.auth], ['directeur', comptes.DIR.auth]]) {
          for (const envoi of envoisRefuses('active', 'actif')) {
            await refuse(() => envoi.envoyer(patch('/api/planning/share', auth)), 403, { code: 'PLANNING_DESACTIVE', error: MESSAGES.planningDesactive }, `${qui}, planning désactivé, ${envoi.nom}`);
          }
          await refuse(() => patch('/api/planning/share', auth).send({ active: true }), 403, { code: 'PLANNING_DESACTIVE', error: MESSAGES.planningDesactive }, `${qui}, planning désactivé, active: true`);
        }
        for (const envoi of envoisRefuses('active', 'actif')) {
          await refuse(() => envoi.envoyer(patch('/api/planning/share', comptes.SA.auth)), 400, REFUS_DRAPEAU('active'), `super administrateur, planning désactivé, ${envoi.nom}`);
        }
      } finally {
        await ok(request(app).put('/api/modules').set(comptes.SA.auth).send({ planningActif: true }));
      }
    });

    // Cadrage v2, « Critères observables » : sur un partage publié, chaque valeur refusée répond 400 ; « Le compte ou le
    // partage est inchangé (updatedAt compris, relu en base) et le journal d'administration n'a aucune entrée
    // nouvelle. » Avant le lot, « false » ouvrait le lien, et {} ou une requête sans corps le fermait (ou 500).
    test('partage publié, ouvert puis fermé : chaque valeur non booléenne, la clé absente ou une requête sans corps JSON répond 400 au message exact, sans changer le partage (actif, jeton, updatedAt) ni écrire au journal', async () => {
      const publication = await ok(request(app).post('/api/planning/share').set(comptes.SA.auth));
      assert.equal(publication.published, true);
      assert.equal(publication.active, true);
      for (const etat of [true, false]) {
        await prisma.planningPublicShare.update({ where: { id: 'singleton' }, data: { active: etat } });
        for (const [qui, auth] of ADMIS()) {
          for (const envoi of envoisRefuses('active', 'actif')) {
            await refuse(() => envoi.envoyer(patch('/api/planning/share', auth)), 400, REFUS_DRAPEAU('active'), `${qui}, partage ${etat ? 'ouvert' : 'fermé'}, ${envoi.nom}`, partageEnBase);
          }
        }
        assert.equal((await partageEnBase()).active, etat);
        assert.equal((await partageEnBase()).token, publication.token, 'le jeton ne change pas');
      }
      await prisma.planningPublicShare.update({ where: { id: 'singleton' }, data: { active: true } });
    });

    // Cadrage v2, périmètre 6 et critère « true et false : comportement inchangé […] ouverture et fermeture du lien sans
    // changer le jeton ; journal identique » (journal-administration.ts : seuls les changements sont journalisés).
    test('partage : false ferme le lien et true le rouvre, sans changer le jeton, avec les mêmes entrées du journal (DESACTIVATION, ACTIVATION, rien sans changement) ; le super administrateur l’écrit sous le module désactivé', async () => {
      const { token } = await partageEnBase();
      assert.equal((await partageEnBase()).active, true);
      assert.equal((await request(app).get(`/api/planning/public/${token}`)).status, 200, 'lien ouvert');
      // Fermeture par l'administrateur.
      let avant = await idsJournal();
      let reponse = await ok(patch('/api/planning/share', comptes.AD.auth).send({ active: false }));
      let enBase = await partageEnBase();
      assert.deepEqual(reponse, { published: true, active: false, token, updatedAt: enBase.updatedAt });
      assert.equal(enBase.active, false);
      assert.deepEqual(await entreesDepuis(avant), [entreePartage('DESACTIVATION', comptes.AD, { actif: true }, { actif: false })]);
      const lienFerme = await request(app).get(`/api/planning/public/${token}`);
      assert.deepEqual([lienFerme.status, lienFerme.body], [404, { error: MESSAGES.lienIndisponible }], 'lien fermé');
      // Même valeur : aucune entrée.
      avant = await idsJournal();
      reponse = await ok(patch('/api/planning/share', comptes.AD.auth).send({ active: false }));
      assert.equal(reponse.active, false);
      assert.deepEqual(await entreesDepuis(avant), [], 'aucune entrée sans changement');
      // Réouverture par le directeur, même jeton.
      avant = await idsJournal();
      reponse = await ok(patch('/api/planning/share', comptes.DIR.auth).send({ active: true }));
      enBase = await partageEnBase();
      assert.deepEqual(reponse, { published: true, active: true, token, updatedAt: enBase.updatedAt });
      assert.deepEqual(await entreesDepuis(avant), [entreePartage('ACTIVATION', comptes.DIR, { actif: false }, { actif: true })]);
      assert.equal((await request(app).get(`/api/planning/public/${token}`)).status, 200, 'lien rouvert, même jeton');
      // Module désactivé : le super administrateur ferme et rouvre ; l'administrateur et le directeur sont refusés.
      await ok(request(app).put('/api/modules').set(comptes.SA.auth).send({ planningActif: false }));
      try {
        avant = await idsJournal();
        assert.equal((await ok(patch('/api/planning/share', comptes.SA.auth).send({ active: false }))).active, false);
        assert.deepEqual(await entreesDepuis(avant), [entreePartage('DESACTIVATION', comptes.SA, { actif: true }, { actif: false })]);
        for (const [qui, auth] of [['administrateur', comptes.AD.auth], ['directeur', comptes.DIR.auth]]) {
          await refuse(() => patch('/api/planning/share', auth).send({ active: true }), 403, { code: 'PLANNING_DESACTIVE', error: MESSAGES.planningDesactive }, `${qui}, module désactivé`, partageEnBase);
        }
        avant = await idsJournal();
        assert.equal((await ok(patch('/api/planning/share', comptes.SA.auth).send({ active: true }))).active, true);
        assert.deepEqual(await entreesDepuis(avant), [entreePartage('ACTIVATION', comptes.SA, { actif: false }, { actif: true })]);
      } finally {
        await ok(request(app).put('/api/modules').set(comptes.SA.auth).send({ planningActif: true }));
      }
      assert.equal((await partageEnBase()).token, token, 'le jeton n’a jamais changé');
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 2. Activation d'un compte (PATCH /api/users/:id/actif)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, constat (« "false" réactive le compte ; une clé absente ou null le désactive ; sans corps : 500 ») et
    // critère « Chacune des quatre routes de modification […] : 400 au message exact ». Compte actif et compte désactivé.
    test('activation d’un compte : chaque valeur non booléenne, la clé absente ou une requête sans corps JSON répond 400 « « actif » doit valoir true ou false. », par le super administrateur, l’administrateur et le directeur, sur un compte actif et sur un compte désactivé ; rien n’est écrit', async () => {
      for (const actif of [true, false]) {
        const compte = await nouvelleCible('COMMERCIAL', { actif });
        for (const [qui, auth] of ADMIS()) {
          for (const envoi of envoisRefuses('actif', 'active')) {
            await refuse(() => envoi.envoyer(patch(`/api/users/${compte.id}/actif`, auth)), 400, REFUS_DRAPEAU('actif'), `${qui}, compte ${actif ? 'actif' : 'désactivé'}, ${envoi.nom}`, () => compteEnBase(compte.id));
          }
        }
      }
    });

    // Cadrage v2, périmètre 4 et critères d'ordre : gardes avant le 400 ; 400 avant le 404 du compte inconnu et du
    // compte système ; 400 avant les refus métier (super administrateur ciblé par un administrateur ou un directeur, son
    // propre compte avec {} : « reçoit le message du booléen, et non « Vous ne pouvez pas désactiver votre propre
    // compte. » »). Les mêmes cibles avec un booléen gardent leur refus (témoin de l'ordre). Tue « contrôle après la
    // lecture du compte ».
    test('activation d’un compte, ordre des contrôles : 401 et 403 des gardes d’abord ; puis le 400 du drapeau avant le 404 du compte inconnu ou système, le 403 du super administrateur ciblé et le 400 de son propre compte, que true ou false reçoivent ; rien n’est écrit', async () => {
      const compte = await nouvelleCible('COMMERCIAL');
      const chemin = (id) => `/api/users/${id}/actif`;
      for (const corps of [{ actif: 'false' }, {}, { actif: null }, { actif: false }]) {
        await refuse(() => patch(chemin(compte.id)).send(corps), 401, MESSAGES.authentification, `sans session, ${JSON.stringify(corps)}`, () => compteEnBase(compte.id));
        await refuse(() => patch(chemin(compte.id), comptes['AD-DESACTIVE'].auth).send(corps), 401, { code: 'COMPTE_DESACTIVE', error: MESSAGES.compteDesactive }, `administrateur désactivé, ${JSON.stringify(corps)}`, () => compteEnBase(compte.id));
        for (const type of TYPES_HORS_ADMINISTRATION) {
          await refuse(() => patch(chemin(compte.id), comptes[type].auth).send(corps), 403, MESSAGES.administrateurs, `${type}, ${JSON.stringify(corps)}`, () => compteEnBase(compte.id));
        }
      }
      for (const [qui, auth] of ADMIS()) {
        for (const corps of [{ actif: 'false' }, {}, { actif: 0 }]) {
          await refuse(() => patch(chemin(randomUUID()), auth).send(corps), 400, REFUS_DRAPEAU('actif'), `${qui}, compte inconnu, ${JSON.stringify(corps)}`);
          await refuse(() => patch(chemin(COMPTE_SYSTEME_ID), auth).send(corps), 400, REFUS_DRAPEAU('actif'), `${qui}, compte système, ${JSON.stringify(corps)}`, () => compteEnBase(COMPTE_SYSTEME_ID));
        }
        await refuse(() => patch(chemin(randomUUID()), auth), 400, REFUS_DRAPEAU('actif'), `${qui}, compte inconnu, sans corps`);
        for (const actif of [true, false]) {
          await refuse(() => patch(chemin(randomUUID()), auth).send({ actif }), 404, MESSAGES.introuvable, `${qui}, compte inconnu, actif: ${actif}`);
          await refuse(() => patch(chemin(COMPTE_SYSTEME_ID), auth).send({ actif }), 404, MESSAGES.introuvable, `${qui}, compte système, actif: ${actif}`, () => compteEnBase(COMPTE_SYSTEME_ID));
        }
      }
      // Super administrateur ciblé par un administrateur ou un directeur.
      for (const [qui, auth] of [['administrateur', comptes.AD.auth], ['directeur', comptes.DIR.auth]]) {
        for (const corps of [{ actif: 'false' }, {}, { actif: [] }]) {
          await refuse(() => patch(chemin(comptes.SA2.id), auth).send(corps), 400, REFUS_DRAPEAU('actif'), `${qui} sur un super administrateur, ${JSON.stringify(corps)}`, () => compteEnBase(comptes.SA2.id));
        }
        for (const actif of [true, false]) {
          await refuse(() => patch(chemin(comptes.SA2.id), auth).send({ actif }), 403, MESSAGES.cibleSuperAdmin, `${qui} sur un super administrateur, actif: ${actif}`, () => compteEnBase(comptes.SA2.id));
        }
      }
      // Son propre compte.
      for (const [qui, compteDemandeur] of [['super administrateur', comptes.SA], ['administrateur', comptes.AD], ['directeur', comptes.DIR]]) {
        for (const corps of [{}, { actif: 'false' }, { actif: null }]) {
          await refuse(() => patch(chemin(compteDemandeur.id), compteDemandeur.auth).send(corps), 400, REFUS_DRAPEAU('actif'), `${qui} sur son propre compte, ${JSON.stringify(corps)}`, () => compteEnBase(compteDemandeur.id));
        }
        await refuse(() => patch(chemin(compteDemandeur.id), compteDemandeur.auth), 400, REFUS_DRAPEAU('actif'), `${qui} sur son propre compte, sans corps`, () => compteEnBase(compteDemandeur.id));
        await refuse(() => patch(chemin(compteDemandeur.id), compteDemandeur.auth).send({ actif: false }), 400, MESSAGES.propreCompte, `${qui} sur son propre compte, actif: false`, () => compteEnBase(compteDemandeur.id));
      }
    });

    // Cadrage v2, périmètre 6 et critère « true et false : comportement inchangé : désactivation et réactivation ; refus
    // de se désactiver soi-même ; […] super administrateur ciblé par un administrateur ; […] journal identique ».
    test('activation d’un compte : false désactive et true réactive, avec les mêmes entrées du journal (DESACTIVATION, ACTIVATION, rien sans changement), par le super administrateur, l’administrateur et le directeur ; un super administrateur ciblé par le super administrateur ; true sur son propre compte admis', async () => {
      for (const [qui, compteDemandeur] of [['super administrateur', comptes.SA], ['administrateur', comptes.AD], ['directeur', comptes.DIR]]) {
        const compte = await nouvelleCible('CONDUCTEUR_TRAVAUX');
        let avant = await idsJournal();
        let reponse = await ok(patch(`/api/users/${compte.id}/actif`, compteDemandeur.auth).send({ actif: false }));
        assert.deepEqual(reponse, { id: compte.id, name: compte.name, email: compte.email, role: 'CONDUCTEUR_TRAVAUX', estCommercial: false, accesFinance: false, permissions: [], actif: false }, `${qui} : réponse`);
        assert.equal((await compteEnBase(compte.id)).actif, false, `${qui} : compte désactivé en base`);
        assert.deepEqual(await entreesDepuis(avant), [entreeCompte('DESACTIVATION', compte, compteDemandeur, { actif: true }, { actif: false })], `${qui} : journal de la désactivation`);
        avant = await idsJournal();
        assert.equal((await ok(patch(`/api/users/${compte.id}/actif`, compteDemandeur.auth).send({ actif: false }))).actif, false);
        assert.deepEqual(await entreesDepuis(avant), [], `${qui} : aucune entrée sans changement`);
        avant = await idsJournal();
        reponse = await ok(patch(`/api/users/${compte.id}/actif`, compteDemandeur.auth).send({ actif: true }));
        assert.equal(reponse.actif, true);
        assert.equal((await compteEnBase(compte.id)).actif, true, `${qui} : compte réactivé en base`);
        assert.deepEqual(await entreesDepuis(avant), [entreeCompte('ACTIVATION', compte, compteDemandeur, { actif: false }, { actif: true })], `${qui} : journal de la réactivation`);
        // true sur son propre compte, déjà actif : admis, sans entrée.
        avant = await idsJournal();
        assert.equal((await ok(patch(`/api/users/${compteDemandeur.id}/actif`, compteDemandeur.auth).send({ actif: true }))).actif, true);
        assert.deepEqual(await entreesDepuis(avant), [], `${qui} : true sur son propre compte, aucune entrée`);
      }
      // Un super administrateur désactivé puis réactivé par le super administrateur : entrées « concerne un SA ».
      const second = await nouvelleCible('SUPERADMIN');
      let avant = await idsJournal();
      assert.equal((await ok(patch(`/api/users/${second.id}/actif`, comptes.SA.auth).send({ actif: false }))).actif, false);
      assert.deepEqual(await entreesDepuis(avant), [entreeCompte('DESACTIVATION', second, comptes.SA, { actif: true }, { actif: false }, { concerneSuperAdmin: true })]);
      avant = await idsJournal();
      assert.equal((await ok(patch(`/api/users/${second.id}/actif`, comptes.SA.auth).send({ actif: true }))).actif, true);
      assert.deepEqual(await entreesDepuis(avant), [entreeCompte('ACTIVATION', second, comptes.SA, { actif: false }, { actif: true }, { concerneSuperAdmin: true })]);
    });

    // Cadrage v2, périmètre 6 : « Le verrou des retraits n'est pris que pour une désactivation (#216) » ; périmètre 4 :
    // le contrôle passe « avant toute lecture ou écriture en base », donc avant le verrou et le contrôle du dernier super
    // administrateur actif. Une connexion témoin tient le verrou des retraits : la réactivation et un drapeau refusé
    // répondent sans l'attendre ; la désactivation l'attend (relevé dans pg_stat_activity), puis aboutit.
    test('activation d’un compte : sous le verrou des retraits tenu ailleurs, un drapeau refusé répond 400 sans attendre et la réactivation aboutit sans attendre ; la désactivation attend le verrou, puis aboutit', async () => {
      const desactive = await nouvelleCible('COMMERCIAL', { actif: false });
      const actif = await nouvelleCible('COMMERCIAL');
      const verrou = await tenirVerrouRetraits();
      let desactivation = null;
      const enSuspens = [];
      try {
        for (const corps of [{}, { actif: 'false' }, { actif: null }]) {
          const refus = await sansAttente(() => patch(`/api/users/${actif.id}/actif`, comptes.AD.auth).send(corps), enSuspens);
          assert.ok(refus, `${JSON.stringify(corps)} : la réponse attend le verrou des retraits`);
          assert.deepEqual([refus.status, refus.body], [400, { error: REFUS_DRAPEAU('actif') }], JSON.stringify(corps));
        }
        const reactivation = await sansAttente(() => patch(`/api/users/${desactive.id}/actif`, comptes.AD.auth).send({ actif: true }), enSuspens);
        assert.ok(reactivation, 'la réactivation attend le verrou des retraits');
        assert.equal(reactivation.status, 200, JSON.stringify(reactivation.body));
        assert.equal(await verrou.attentesConsultatives(), 0);
        desactivation = patch(`/api/users/${actif.id}/actif`, comptes.AD.auth).send({ actif: false }).then((r) => r);
        assert.equal(await attendreAttente(verrou), true, 'la désactivation attend le verrou des retraits');
        assert.equal((await compteEnBase(actif.id)).actif, true, 'rien d’écrit pendant l’attente');
      } finally {
        await verrou.conclure(false);
        await Promise.allSettled([...enSuspens, desactivation]);
      }
      const fin = await desactivation;
      assert.equal(fin.status, 200, JSON.stringify(fin.body));
      assert.equal((await compteEnBase(actif.id)).actif, false);
      assert.equal((await compteEnBase(desactive.id)).actif, true);
    });

    // Cadrage v2, critère « true et false : comportement inchangé : […] dernier super administrateur actif ». Le refus ne
    // s'atteint que si le demandeur, actif à son entrée, cesse de l'être pendant la requête (comme dans api.test.mjs,
    // « Dernier super administrateur actif ») : la connexion témoin tient le verrou des retraits et désactive le
    // demandeur dans sa transaction ; un drapeau refusé répond aussitôt 400 ; la désactivation de l'autre super
    // administrateur attend le verrou, puis, la transaction témoin validée, est refusée.
    test('activation d’un compte : la désactivation du dernier super administrateur actif reste refusée (400, message inchangé, rien n’est écrit), et un drapeau refusé y reçoit le 400 du drapeau, avant le verrou et ce contrôle', async () => {
      const demandeur = await nouvelleCible('SUPERADMIN');
      const dernier = await nouvelleCible('SUPERADMIN');
      const authDemandeur = signer(demandeur.id);
      // Seuls ces deux super administrateurs sont actifs le temps du test.
      const suspendus = (await prisma.user.findMany({ where: { role: 'SUPERADMIN', actif: true, id: { notIn: [demandeur.id, dernier.id] } }, select: { id: true } })).map((c) => c.id);
      await prisma.user.updateMany({ where: { id: { in: suspendus } }, data: { actif: false } });
      try {
        const avantDernier = await compteEnBase(dernier.id);
        const avantJournal = await idsJournal();
        const verrou = await tenirVerrouRetraits((temoin) => temoin.query('UPDATE "User" SET "actif" = false WHERE "id" = $1', [demandeur.id]));
        let desactivation = null;
        let validee = false;
        const enSuspens = [];
        try {
          for (const corps of [{}, { actif: 'false' }]) {
            const refus = await sansAttente(() => patch(`/api/users/${dernier.id}/actif`, authDemandeur).send(corps), enSuspens);
            assert.ok(refus, `${JSON.stringify(corps)} : la réponse attend le verrou des retraits`);
            assert.deepEqual([refus.status, refus.body], [400, { error: REFUS_DRAPEAU('actif') }], JSON.stringify(corps));
          }
          desactivation = patch(`/api/users/${dernier.id}/actif`, authDemandeur).send({ actif: false }).then((r) => r);
          assert.equal(await attendreAttente(verrou), true, 'la désactivation attend le verrou des retraits');
          await verrou.conclure(true);
          validee = true;
        } finally {
          if (!validee) await verrou.conclure(false);
          await Promise.allSettled([...enSuspens, desactivation]);
        }
        const refus = await desactivation;
        assert.deepEqual([refus.status, refus.body], [400, { error: MESSAGES.dernierSuperAdmin }]);
        assert.deepEqual(await compteEnBase(dernier.id), avantDernier, 'le dernier super administrateur reste actif, updatedAt compris');
        assert.deepEqual(await entreesDepuis(avantJournal), [], 'aucune entrée du journal');
      } finally {
        await prisma.user.updateMany({ where: { id: { in: [...suspendus, demandeur.id] } }, data: { actif: true } });
      }
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 3. Marque « aussi commercial » (PATCH /api/users/:id/est-commercial)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, constat (« "false" marque le compte commercial ; une clé absente retire la marque ; sans corps : 500 »).
    test('marque « aussi commercial » : chaque valeur non booléenne, la clé absente ou une requête sans corps JSON répond 400 « « estCommercial » doit valoir true ou false. », par le super administrateur, l’administrateur et le directeur, sur un administrateur marqué ou non ; rien n’est écrit', async () => {
      for (const estCommercial of [false, true]) {
        const compte = await nouvelleCible('ADMIN', { estCommercial });
        for (const [qui, auth] of ADMIS()) {
          for (const envoi of envoisRefuses('estCommercial', 'accesFinance')) {
            await refuse(() => envoi.envoyer(patch(`/api/users/${compte.id}/est-commercial`, auth)), 400, REFUS_DRAPEAU('estCommercial'), `${qui}, administrateur ${estCommercial ? 'marqué' : 'non marqué'}, ${envoi.nom}`, () => compteEnBase(compte.id));
          }
        }
      }
    });

    // Cadrage v2, périmètre 4 : gardes avant le 400 ; 400 avant le 404 (inconnu, système) et avant les refus métier
    // (compte non administrateur « aussi commercial » : 400 ; super administrateur ciblé par un administrateur : 403).
    test('marque « aussi commercial », ordre des contrôles : gardes d’abord ; le 400 du drapeau avant le 404 du compte inconnu ou système, le 400 du compte qui n’est pas administrateur et le 403 du super administrateur ciblé, que true ou false reçoivent ; rien n’est écrit', async () => {
      const administrateur = await nouvelleCible('ADMIN');
      const commercial = await nouvelleCible('COMMERCIAL');
      const chemin = (id) => `/api/users/${id}/est-commercial`;
      for (const corps of [{ estCommercial: 'false' }, {}, { estCommercial: true }]) {
        await refuse(() => patch(chemin(administrateur.id)).send(corps), 401, MESSAGES.authentification, `sans session, ${JSON.stringify(corps)}`, () => compteEnBase(administrateur.id));
        for (const type of TYPES_HORS_ADMINISTRATION) {
          await refuse(() => patch(chemin(administrateur.id), comptes[type].auth).send(corps), 403, MESSAGES.administrateurs, `${type}, ${JSON.stringify(corps)}`, () => compteEnBase(administrateur.id));
        }
      }
      for (const [qui, auth] of ADMIS()) {
        for (const corps of [{ estCommercial: 'true' }, {}, { estCommercial: 1 }]) {
          await refuse(() => patch(chemin(randomUUID()), auth).send(corps), 400, REFUS_DRAPEAU('estCommercial'), `${qui}, compte inconnu, ${JSON.stringify(corps)}`);
          await refuse(() => patch(chemin(COMPTE_SYSTEME_ID), auth).send(corps), 400, REFUS_DRAPEAU('estCommercial'), `${qui}, compte système, ${JSON.stringify(corps)}`, () => compteEnBase(COMPTE_SYSTEME_ID));
          await refuse(() => patch(chemin(commercial.id), auth).send(corps), 400, REFUS_DRAPEAU('estCommercial'), `${qui}, compte commercial, ${JSON.stringify(corps)}`, () => compteEnBase(commercial.id));
        }
        for (const estCommercial of [true, false]) {
          await refuse(() => patch(chemin(randomUUID()), auth).send({ estCommercial }), 404, MESSAGES.introuvable, `${qui}, compte inconnu, estCommercial: ${estCommercial}`);
          await refuse(() => patch(chemin(COMPTE_SYSTEME_ID), auth).send({ estCommercial }), 404, MESSAGES.introuvable, `${qui}, compte système, estCommercial: ${estCommercial}`, () => compteEnBase(COMPTE_SYSTEME_ID));
          await refuse(() => patch(chemin(commercial.id), auth).send({ estCommercial }), 400, MESSAGES.aussiCommercial, `${qui}, compte commercial, estCommercial: ${estCommercial}`, () => compteEnBase(commercial.id));
        }
      }
      for (const [qui, auth] of [['administrateur', comptes.AD.auth], ['directeur', comptes.DIR.auth]]) {
        for (const corps of [{ estCommercial: 'false' }, {}]) {
          await refuse(() => patch(chemin(comptes.SA2.id), auth).send(corps), 400, REFUS_DRAPEAU('estCommercial'), `${qui} sur un super administrateur, ${JSON.stringify(corps)}`, () => compteEnBase(comptes.SA2.id));
        }
        for (const estCommercial of [true, false]) {
          await refuse(() => patch(chemin(comptes.SA2.id), auth).send({ estCommercial }), 403, MESSAGES.cibleSuperAdmin, `${qui} sur un super administrateur, estCommercial: ${estCommercial}`, () => compteEnBase(comptes.SA2.id));
        }
      }
    });

    // Cadrage v2, critère « true et false : comportement inchangé : […] compte de type administrateur seul « aussi
    // commercial » ; journal identique ».
    test('marque « aussi commercial » : true marque et false retire la marque d’un administrateur, avec les mêmes entrées du journal (AUSSI_COMMERCIAL, rien sans changement) ; un super administrateur marqué par le super administrateur', async () => {
      for (const [qui, compteDemandeur] of [['super administrateur', comptes.SA], ['administrateur', comptes.AD], ['directeur', comptes.DIR]]) {
        const compte = await nouvelleCible('ADMIN');
        let avant = await idsJournal();
        const reponse = await ok(patch(`/api/users/${compte.id}/est-commercial`, compteDemandeur.auth).send({ estCommercial: true }));
        assert.deepEqual(reponse, { id: compte.id, name: compte.name, email: compte.email, role: 'ADMIN', estCommercial: true, accesFinance: false, permissions: [], actif: true }, `${qui} : réponse`);
        assert.equal((await compteEnBase(compte.id)).estCommercial, true);
        assert.deepEqual(await entreesDepuis(avant), [entreeCompte('AUSSI_COMMERCIAL', compte, compteDemandeur, { estCommercial: false }, { estCommercial: true })], `${qui} : journal de la marque`);
        avant = await idsJournal();
        assert.equal((await ok(patch(`/api/users/${compte.id}/est-commercial`, compteDemandeur.auth).send({ estCommercial: true }))).estCommercial, true);
        assert.deepEqual(await entreesDepuis(avant), [], `${qui} : aucune entrée sans changement`);
        avant = await idsJournal();
        assert.equal((await ok(patch(`/api/users/${compte.id}/est-commercial`, compteDemandeur.auth).send({ estCommercial: false }))).estCommercial, false);
        assert.equal((await compteEnBase(compte.id)).estCommercial, false);
        assert.deepEqual(await entreesDepuis(avant), [entreeCompte('AUSSI_COMMERCIAL', compte, compteDemandeur, { estCommercial: true }, { estCommercial: false })], `${qui} : journal du retrait`);
      }
      const second = await nouvelleCible('SUPERADMIN');
      const avant = await idsJournal();
      assert.equal((await ok(patch(`/api/users/${second.id}/est-commercial`, comptes.SA.auth).send({ estCommercial: true }))).estCommercial, true);
      assert.deepEqual(await entreesDepuis(avant), [entreeCompte('AUSSI_COMMERCIAL', second, comptes.SA, { estCommercial: false }, { estCommercial: true }, { concerneSuperAdmin: true })]);
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 4. Accès financier (PATCH /api/users/:id/acces-finance, super administrateur seul)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, constat (« "false" accorde l'accès financier ; une clé absente le retire ; sans corps : 500. Le refus
    // pour un technicien […] suit la même vérité »).
    test('accès financier : chaque valeur non booléenne, la clé absente ou une requête sans corps JSON répond 400 « « accesFinance » doit valoir true ou false. », par le super administrateur, sur un compte avec ou sans l’accès et sur un technicien ; rien n’est écrit', async () => {
      const cibles = [
        ['commercial sans l’accès', await nouvelleCible('COMMERCIAL')],
        ['commercial avec l’accès', await nouvelleCible('COMMERCIAL', { accesFinance: true })],
        ['technicien', await nouvelleCible('TECHNICIEN')],
      ];
      for (const [nom, compte] of cibles) {
        for (const envoi of envoisRefuses('accesFinance', 'estCommercial')) {
          await refuse(() => envoi.envoyer(patch(`/api/users/${compte.id}/acces-finance`, comptes.SA.auth)), 400, REFUS_DRAPEAU('accesFinance'), `${nom}, ${envoi.nom}`, () => compteEnBase(compte.id));
        }
      }
    });

    // Cadrage v2, périmètre 4 : 403 de requireSuperAdmin avant le 400 ; 400 avant le 404 et avant le refus du technicien
    // (« technicien et accès financier (400) ») ; « "false" sur un technicien » répondait le refus du technicien.
    test('accès financier, ordre des contrôles : 401, et 403 « Accès réservé au super administrateur » pour l’administrateur, le directeur et les autres types, avant le drapeau ; puis le 400 du drapeau avant le 404 du compte inconnu ou système et avant le refus du technicien ; rien n’est écrit', async () => {
      const commercial = await nouvelleCible('COMMERCIAL');
      const technicien = await nouvelleCible('TECHNICIEN');
      const chemin = (id) => `/api/users/${id}/acces-finance`;
      for (const corps of [{ accesFinance: 'false' }, {}, { accesFinance: true }]) {
        await refuse(() => patch(chemin(commercial.id)).send(corps), 401, MESSAGES.authentification, `sans session, ${JSON.stringify(corps)}`, () => compteEnBase(commercial.id));
        for (const code of ['AD', 'DIR', ...TYPES_HORS_ADMINISTRATION]) {
          await refuse(() => patch(chemin(commercial.id), comptes[code].auth).send(corps), 403, MESSAGES.superAdministrateur, `${code}, ${JSON.stringify(corps)}`, () => compteEnBase(commercial.id));
        }
      }
      await refuse(() => patch(chemin(commercial.id), comptes.AD.auth), 403, MESSAGES.superAdministrateur, 'administrateur, sans corps', () => compteEnBase(commercial.id));
      for (const corps of [{ accesFinance: 'false' }, { accesFinance: 'true' }, {}, { accesFinance: null }]) {
        await refuse(() => patch(chemin(randomUUID()), comptes.SA.auth).send(corps), 400, REFUS_DRAPEAU('accesFinance'), `compte inconnu, ${JSON.stringify(corps)}`);
        await refuse(() => patch(chemin(COMPTE_SYSTEME_ID), comptes.SA.auth).send(corps), 400, REFUS_DRAPEAU('accesFinance'), `compte système, ${JSON.stringify(corps)}`, () => compteEnBase(COMPTE_SYSTEME_ID));
        await refuse(() => patch(chemin(technicien.id), comptes.SA.auth).send(corps), 400, REFUS_DRAPEAU('accesFinance'), `technicien, ${JSON.stringify(corps)}`, () => compteEnBase(technicien.id));
      }
      for (const accesFinance of [true, false]) {
        await refuse(() => patch(chemin(randomUUID()), comptes.SA.auth).send({ accesFinance }), 404, MESSAGES.introuvable, `compte inconnu, accesFinance: ${accesFinance}`);
        await refuse(() => patch(chemin(COMPTE_SYSTEME_ID), comptes.SA.auth).send({ accesFinance }), 404, MESSAGES.introuvable, `compte système, accesFinance: ${accesFinance}`, () => compteEnBase(COMPTE_SYSTEME_ID));
      }
      await refuse(() => patch(chemin(technicien.id), comptes.SA.auth).send({ accesFinance: true }), 400, MESSAGES.technicienFinance, 'technicien, accesFinance: true', () => compteEnBase(technicien.id));
    });

    // Cadrage v2, critère « true et false : comportement inchangé : […] technicien sans accès financier ; journal
    // identique » : true accorde, false retire, false sur un technicien reste admis (retrait d'un accès posé avant).
    test('accès financier : true accorde et false retire l’accès, avec les mêmes entrées du journal (ACCES_FINANCE, rien sans changement) ; false admis sur un technicien, qui perd un accès posé avant ; true sur un super administrateur concerne un SA', async () => {
      const compte = await nouvelleCible('COMPTABLE');
      let avant = await idsJournal();
      const reponse = await ok(patch(`/api/users/${compte.id}/acces-finance`, comptes.SA.auth).send({ accesFinance: true }));
      assert.deepEqual(reponse, { id: compte.id, name: compte.name, email: compte.email, role: 'COMPTABLE', estCommercial: false, accesFinance: true, permissions: [], actif: true });
      assert.equal((await compteEnBase(compte.id)).accesFinance, true);
      assert.deepEqual(await entreesDepuis(avant), [entreeCompte('ACCES_FINANCE', compte, comptes.SA, { accesFinance: false }, { accesFinance: true })]);
      avant = await idsJournal();
      assert.equal((await ok(patch(`/api/users/${compte.id}/acces-finance`, comptes.SA.auth).send({ accesFinance: true }))).accesFinance, true);
      assert.deepEqual(await entreesDepuis(avant), [], 'aucune entrée sans changement');
      avant = await idsJournal();
      assert.equal((await ok(patch(`/api/users/${compte.id}/acces-finance`, comptes.SA.auth).send({ accesFinance: false }))).accesFinance, false);
      assert.equal((await compteEnBase(compte.id)).accesFinance, false);
      assert.deepEqual(await entreesDepuis(avant), [entreeCompte('ACCES_FINANCE', compte, comptes.SA, { accesFinance: true }, { accesFinance: false })]);
      // Technicien : false sans accès, admis sans entrée ; false retire un accès posé avant le passage en technicien.
      const technicien = await nouvelleCible('TECHNICIEN');
      avant = await idsJournal();
      assert.equal((await ok(patch(`/api/users/${technicien.id}/acces-finance`, comptes.SA.auth).send({ accesFinance: false }))).accesFinance, false);
      assert.deepEqual(await entreesDepuis(avant), []);
      const technicienAvecAcces = await nouvelleCible('TECHNICIEN', { accesFinance: true });
      avant = await idsJournal();
      assert.equal((await ok(patch(`/api/users/${technicienAvecAcces.id}/acces-finance`, comptes.SA.auth).send({ accesFinance: false }))).accesFinance, false);
      assert.deepEqual(await entreesDepuis(avant), [entreeCompte('ACCES_FINANCE', technicienAvecAcces, comptes.SA, { accesFinance: true }, { accesFinance: false })]);
      const second = await nouvelleCible('SUPERADMIN');
      avant = await idsJournal();
      assert.equal((await ok(patch(`/api/users/${second.id}/acces-finance`, comptes.SA.auth).send({ accesFinance: true }))).accesFinance, true);
      assert.deepEqual(await entreesDepuis(avant), [entreeCompte('ACCES_FINANCE', second, comptes.SA, { accesFinance: false }, { accesFinance: true }, { concerneSuperAdmin: true })]);
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 5. Création d'un compte (POST /api/users) : cases facultatives
    // ---------------------------------------------------------------------------------------------------------------

    const adresse = () => `booleens587.cree.${suffixe()}@iris.test`;
    const creer = (auth, corps) => request(app).post('/api/users').set(auth).send(corps);
    const relireParAdresse = (email) => async () => JSON.parse(JSON.stringify(await prisma.user.findUnique({ where: { email } })));

    // Cadrage v2, périmètre 3 : « Une valeur non booléenne, null compris, répond 400, sans création ni journal » ; choix
    // par défaut v2 : « le contrôle vaut pour tout demandeur et tout type de compte créé, même quand la valeur serait
    // ignorée » (accesFinance envoyé par un administrateur ou un directeur, estCommercial pour un type autre
    // qu'Administrateur ou super administrateur). Le compte est relu par son adresse. Tue « contrôle conditionné au
    // rôle du demandeur ou au type créé » et « null admis à la création ».
    test('création d’un compte : chaque valeur non booléenne d’estCommercial ou d’accesFinance, null compris, répond 400 au message de la case, sans création ni journal, pour le super administrateur, l’administrateur et le directeur, et pour chaque type créé, même quand la case serait ignorée', async () => {
      for (const [qui, auth] of ADMIS()) {
        for (const cle of ['estCommercial', 'accesFinance']) {
          for (const [nom, valeur] of VALEURS_REFUSEES) {
            const email = adresse();
            await refuse(() => creer(auth, { email, name: 'TEST Compte refusé booléens 587', role: 'ADMIN', [cle]: valeur }), 400, REFUS_DRAPEAU(cle), `${qui}, ${cle} vaut ${nom}`, relireParAdresse(email));
            assert.equal(await prisma.user.findUnique({ where: { email } }), null, `${qui}, ${cle} vaut ${nom} : aucun compte créé`);
          }
          for (const role of TYPES_CREES) {
            for (const valeur of ['false', null]) {
              const email = adresse();
              await refuse(() => creer(auth, { email, name: 'TEST Compte refusé booléens 587', role, [cle]: valeur }), 400, REFUS_DRAPEAU(cle), `${qui}, type ${role}, ${cle} vaut ${JSON.stringify(valeur)}`, relireParAdresse(email));
              assert.equal(await prisma.user.findUnique({ where: { email } }), null, `${qui}, type ${role}, ${cle} : aucun compte créé`);
            }
          }
        }
      }
    });

    // Cadrage v2, périmètre 4, choix par défaut : « le contrôle des deux cases passe en tête du gestionnaire, avant : le
    // 403 du type […] ; le 400 du technicien avec l'accès financier ; les 400 de l'adresse et du nom ; le 409 de
    // l'adresse déjà prise » ; critère « POST : 400 des cases avant le 403 du type et avant le 400 de l'adresse ». Chaque
    // corps, rejoué avec des cases valides, garde son refus : témoin que l'ordre est éprouvé.
    test('création d’un compte, ordre des contrôles : le 400 des cases passe avant le 403 du type, le 400 du technicien avec l’accès financier, les 400 de l’adresse et du nom et le 409 de l’adresse prise, qui restent inchangés avec des cases valides ; rien n’est écrit', async () => {
      const prise = (await prisma.user.findUniqueOrThrow({ where: { id: comptes.COMMERCIAL.id } })).email;
      const cas = [
        ['administrateur, type super administrateur', comptes.AD.auth, (email) => ({ email, name: 'TEST Type refusé', role: 'SUPERADMIN' }), 403, MESSAGES.cibleSuperAdmin],
        ['directeur, type super administrateur', comptes.DIR.auth, (email) => ({ email, name: 'TEST Type refusé', role: 'SUPERADMIN' }), 403, MESSAGES.cibleSuperAdmin],
        ['directeur, type Administrateur', comptes.DIR.auth, (email) => ({ email, name: 'TEST Type refusé', role: 'ADMIN' }), 403, MESSAGES.typeAdminParDirecteur],
        ['super administrateur, technicien avec l’accès financier', comptes.SA.auth, (email) => ({ email, name: 'TEST Technicien', role: 'TECHNICIEN', accesFinance: true }), 400, MESSAGES.technicienFinance],
        ['administrateur, adresse invalide', comptes.AD.auth, () => ({ email: 'pas-une-adresse', name: 'TEST Adresse invalide', role: 'COMMERCIAL' }), 400, MESSAGES.adresse],
        ['directeur, adresse absente', comptes.DIR.auth, () => ({ name: 'TEST Adresse absente', role: 'COMMERCIAL' }), 400, MESSAGES.adresse],
        ['super administrateur, nom absent', comptes.SA.auth, (email) => ({ email, role: 'COMMERCIAL' }), 400, MESSAGES.nom],
        ['administrateur, nom blanc', comptes.AD.auth, (email) => ({ email, name: '   ', role: 'COMMERCIAL' }), 400, MESSAGES.nom],
        ['administrateur, adresse déjà prise', comptes.AD.auth, () => ({ email: prise, name: 'TEST Adresse prise', role: 'COMMERCIAL' }), 409, MESSAGES.adressePrise],
      ];
      for (const [nom, auth, corps, statut, message] of cas) {
        for (const [cle, valeur] of [['estCommercial', 'false'], ['accesFinance', 'true'], ['estCommercial', null], ['accesFinance', 0]]) {
          const email = adresse();
          const envoye = corps(email);
          // La case refusée remplace celle du corps (le technicien porte accesFinance: true dans son corps valide).
          await refuse(() => creer(auth, { ...envoye, [cle]: valeur }), 400, REFUS_DRAPEAU(cle), `${nom}, ${cle} vaut ${JSON.stringify(valeur)}`, relireParAdresse(envoye.email ?? email));
        }
        const email = adresse();
        const envoye = corps(email);
        await refuse(() => creer(auth, envoye), statut, message, `${nom}, cases valides`, relireParAdresse(envoye.email ?? email));
      }
    });

    // Cadrage v2, périmètre 3 : « estCommercial et accesFinance restent facultatifs. Une clé absente vaut false, comme
    // aujourd'hui » ; critère « true accordé selon les règles actuelles » (estCommercial pour un administrateur ou un
    // super administrateur seulement ; accesFinance par un super administrateur seulement, jamais à un technicien) ;
    // journal de la création inchangé.
    test('création d’un compte : sans les cases, le compte est créé sans marque ni accès financier ; true est accordé selon les règles actuelles (marque pour un administrateur, accès financier par le super administrateur seul) et ignoré ailleurs ; le journal de la création est inchangé', async () => {
      const cas = [
        // [demandeur, type, cases envoyées, estCommercial attendu, accesFinance attendu]
        ['SA', 'ADMIN', {}, false, false],
        ['AD', 'COMMERCIAL', {}, false, false],
        ['DIR', 'TECHNICIEN', {}, false, false],
        ['SA', 'ADMIN', { estCommercial: false, accesFinance: false }, false, false],
        ['SA', 'ADMIN', { estCommercial: true }, true, false],
        ['SA', 'SUPERADMIN', { estCommercial: true }, true, false],
        ['AD', 'ADMIN', { estCommercial: true }, true, false],
        ['DIR', 'COMMERCIAL', { estCommercial: true }, false, false],
        ['AD', 'CONDUCTEUR_TRAVAUX', { estCommercial: true }, false, false],
        ['SA', 'COMMERCIAL', { accesFinance: true }, false, true],
        ['SA', 'ADMIN', { estCommercial: true, accesFinance: true }, true, true],
        ['AD', 'COMMERCIAL', { accesFinance: true }, false, false],
        ['DIR', 'COMPTABLE', { accesFinance: true }, false, false],
        ['AD', 'TECHNICIEN', { accesFinance: true }, false, false],
        ['SA', 'TECHNICIEN', { accesFinance: false }, false, false],
      ];
      for (const [code, role, cases, estCommercial, accesFinance] of cas) {
        const quoi = `${code}, type ${role}, cases ${JSON.stringify(cases)}`;
        const email = adresse();
        const name = `TEST Créé booléens 587 ${suffixe()}`;
        const avant = await idsJournal();
        const reponse = await ok(creer(comptes[code].auth, { email, name, role, ...cases }), 201);
        const enBase = await prisma.user.findUniqueOrThrow({ where: { email } });
        assert.deepEqual(reponse, { id: enBase.id, name, email, role, estCommercial, accesFinance, permissions: [], actif: true, hasPassword: false }, `${quoi} : réponse`);
        assert.deepEqual([enBase.role, enBase.estCommercial, enBase.accesFinance, enBase.actif], [role, estCommercial, accesFinance, true], `${quoi} : compte en base`);
        assert.deepEqual(await entreesDepuis(avant), [{
          domaine: 'DROITS', type: 'COMPTE', action: 'CREATION', cibleId: enBase.id, cibleLibelle: `${name} (${email})`, avant: null,
          apres: { role, estCommercial, accesFinance, permissions: [], actif: true }, detail: null, concerneSuperAdmin: role === 'SUPERADMIN',
          reserveSuperAdmin: false, auteurId: comptes[code].id, auteurNom: comptes[code].name, auteurSuperAdmin: code === 'SA',
        }], `${quoi} : journal de la création`);
      }
    });
  });
}
