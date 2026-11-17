// Correctif « sécurité de la connexion », #264 : autorisation de la connexion Microsoft 365 sur l'identifiant
// immuable `oid` + `tid` (cadrage v2, section « 2. #264 — autorisation sur l'identifiant Microsoft immuable » et
// « Tests (redacteur-tests) » ; décision de Nelson du 16-11-2026, « Maintenant (Recommandé) » : « #264 ajoute deux
// champs au compte (migration), sans reprise de données »). Parcours de sécurité et de droits (règle 2).
//
// Avant ce correctif, la connexion retenait l'adresse du jeton (`email`, sinon `preferred_username`), que Microsoft
// dit modifiable, et cherchait un compte actif sous cette adresse : le compte suivait l'adresse, et non la personne.
// Désormais, le compte est lié au couple `oid` + `tid` à sa première connexion réussie (mise à jour conditionnelle,
// atomique, journalisée au nom du compte dans la même transaction), puis autorisé sur ce couple, quelle que soit
// l'adresse du jeton ; une adresse d'un compte lié à un autre couple, ou un couple lié à un autre compte que celui
// de l'adresse, est refusée (401 générique, sans détail, avec une trace serveur sans identifiants, sans jeton et sans
// adresse complète). Les identifiants ne sortent par aucune route, et la réponse de POST /api/auth/sso garde sa forme.
//
// Microsoft est simulé dans le processus : AZURE_TENANT_ID et AZURE_CLIENT_ID sont posés avant l'import de
// l'application (authentification/sso.ts les lit à son chargement), et `globalThis.fetch` est remplacé pour la seule
// adresse des clés de signature du locataire, qui rend la clé publique RSA d'une paire tirée par ce fichier. Les
// jetons d'ID sont signés en RS256 par la clé privée, avec l'audience et l'émetteur attendus : la vérification du
// serveur (signature, audience, émetteur, expiration) s'exerce telle quelle. Toute autre adresse passe au `fetch`
// d'origine et est relevée.
//
// Comme chantier-saisie-montants.test.mjs, ce fichier crée sur le serveur de TEST_DATABASE_URL une base jetable qui
// n'appartient qu'à lui (« test » comme mot, suffixe tiré au hasard), la migre, la sert à l'application montée en
// mémoire, puis la supprime. Sans TEST_DATABASE_URL, il s'annonce ignoré : un SKIP n'est pas une réussite. Les
// identifiants sont lus et posés en SQL brut, indépendamment du client Prisma généré.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';

const TITRE = 'Correctif « sécurité de la connexion », #264 : connexion Microsoft autorisée sur l’identifiant immuable oid + tid';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// --- Microsoft simulé ---
const LOCATAIRE = '00000000-0000-4000-8000-0000000a2640';
const APPLICATION = '00000000-0000-4000-8000-0000000b2640';
const EMETTEUR = `https://login.microsoftonline.com/${LOCATAIRE}/v2.0`;
const ADRESSE_CLES = `https://login.microsoftonline.com/${LOCATAIRE}/discovery/v2.0/keys`;
const KID = 'cle-de-test-264';
const paireMicrosoft = generateKeyPairSync('rsa', { modulusLength: 2048 });
const paireEtrangere = generateKeyPairSync('rsa', { modulusLength: 2048 });
const CLE_PRIVEE = paireMicrosoft.privateKey.export({ type: 'pkcs8', format: 'pem' });
const CLE_ETRANGERE = paireEtrangere.privateKey.export({ type: 'pkcs8', format: 'pem' });
const JWK_PUBLIQUE = { ...paireMicrosoft.publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' };

// --- Réponses exactes (inchangées, routes d'authentification) ---
// Cadrage : « refus (401 générique, aucun détail renvoyé) » ; le code rend, pour un refus de la règle des
// identifiants, la réponse même d'un jeton invalide, indiscernable de lui.
const REFUS_GENERIQUE = { code: 'SSO_TOKEN_INVALID', error: 'Jeton Microsoft invalide ou non vérifié.' };
const NON_AUTORISE = { code: 'SSO_NOT_AUTHORIZED', error: "Accès refusé : votre compte n'est pas autorisé. Contactez l'administrateur." };
const ERREUR_CONNEXION = { error: 'Erreur lors de la connexion SSO' };
// Champs du compte dans la réponse de connexion et dans GET /api/me (référence matrice-droits/donnees.txt, « clés . »
// de GET /api/me) : la forme n'a pas changé (cadrage : « La réponse de POST /api/auth/sso garde sa forme »).
const CHAMPS_COMPTE = ['accesFinance', 'email', 'id', 'name', 'permissions', 'role', 'theme'];
// Actions du journal d'administration (cadrage, « Journaux » : « liaison Microsoft enregistrée », « changement
// d'adresse Microsoft détecté » ; noms du code, libellés dans client/src/lib/journalAdministration.ts).
const ACTION_LIAISON = 'LIAISON_MICROSOFT';
const ACTION_ADRESSE = 'ADRESSE_MICROSOFT_CHANGEE';

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    const nomBase = `iris_test_sso264_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const cibleApplication = new URL(cible);
    cibleApplication.searchParams.set('connection_limit', '6');
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;

    let request; let app; let prisma; let appPrisma; let jwt;
    let sessionSuper = '';
    let secours = { id: '', name: '', email: '' };
    const comptes = {};

    // Appels interceptés : ceux de l'adresse des clés, et tous les autres (qui ne devraient pas exister).
    const fetchOrigine = globalThis.fetch;
    const appelsCles = [];
    const autresAppels = [];

    // Sortie console.* de l'application, capturée pour la durée du fichier.
    const sortieConsole = [];
    const consoleOrigine = {};

    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const jetonDe = (compte) => jwt.sign({ id: compte.id }, process.env.JWT_SECRET);
    const parCompte = (compte) => entete(jetonDe(compte));
    const superAdmin = () => entete(sessionSuper);
    let rang = 0;
    const suffixe = () => `${Date.now()}${(rang += 1)}`;
    const nouvelOid = () => randomUUID();

    const creerCompte = async (role, cle, extra = {}) => {
      const s = suffixe();
      return prisma.user.create({
        data: { email: `sso264.${cle}.${s}@iris.test`, name: `TEST SSO 264 ${cle} ${s}`, role, ...extra },
        select: { id: true, name: true, email: true, role: true },
      });
    };

    // Jeton d'ID Microsoft signé par la clé du locataire simulé. `claims` : oid, tid, adresse… ; `sans` retire des
    // revendications ; les options désignent une autre clé, un autre `kid`, une autre audience ou un autre émetteur.
    const jetonMicrosoft = ({ oid, tid = LOCATAIRE, adresse, ...autres }, { cle = CLE_PRIVEE, kid = KID, audience = APPLICATION, emetteur = EMETTEUR, expiresIn = '10m', sans = [] } = {}) => {
      const claims = { oid, tid, preferred_username: adresse, email: adresse, name: 'TEST Personne Microsoft', ...autres };
      for (const nom of sans) delete claims[nom];
      for (const [nom, valeur] of Object.entries(claims)) if (valeur === undefined) delete claims[nom];
      return jwt.sign(claims, cle, { algorithm: 'RS256', keyid: kid, audience, issuer: emetteur, expiresIn });
    };
    const connecterAvecJeton = (idToken) => request(app).post('/api/auth/sso').send({ idToken });
    const connecter = (claims, options) => connecterAvecJeton(jetonMicrosoft(claims, options));

    // Identifiants enregistrés d'un compte, lus en SQL brut.
    const identifiants = async (id) => {
      const [ligne] = await prisma.$queryRaw`SELECT "email", "actif", "microsoftOid" AS oid, "microsoftTid" AS tid, "updatedAt" FROM "User" WHERE "id" = ${id}`;
      assert.ok(ligne, `compte ${id} absent`);
      return { email: ligne.email, actif: ligne.actif, oid: ligne.oid, tid: ligne.tid, updatedAt: ligne.updatedAt.toISOString() };
    };
    const poserIdentifiants = (id, oid, tid = LOCATAIRE) => prisma.$executeRaw`UPDATE "User" SET "microsoftOid" = ${oid}, "microsoftTid" = ${tid} WHERE "id" = ${id}`;
    const journalDe = (id) => prisma.journalAdministration.findMany({ where: { cibleId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const totalJournal = () => prisma.journalAdministration.count();

    // Lie un compte par une première connexion réussie.
    const lier = async (compte, oid) => {
      const res = await connecter({ oid, adresse: compte.email });
      assert.equal(res.status, 200, `liaison de ${compte.email} : ${JSON.stringify(res.body)}`);
      assert.equal(res.body.user.id, compte.id);
      assert.deepEqual(await identifiants(compte.id).then(({ oid: o, tid }) => ({ o, tid })), { o: oid, tid: LOCATAIRE });
      return res;
    };

    // Exécute un rappel et rend, avec son résultat, les lignes de console écrites pendant ce temps.
    const pendant = async (rappel) => {
      const debut = sortieConsole.length;
      const resultat = await rappel();
      return { resultat, lignes: sortieConsole.slice(debut) };
    };
    // Aucune des valeurs données n'apparaît dans les lignes de console (casse ignorée).
    const aucuneDans = (lignes, valeurs, quoi) => {
      const texte = lignes.map((l) => l.texte).join('\n').toLowerCase();
      for (const [nom, valeur] of Object.entries(valeurs)) {
        assert.ok(!texte.includes(String(valeur).toLowerCase()), `${quoi} : ${nom} recopié dans la console :\n${texte}`);
      }
    };
    // Refus sans écriture : réponse exacte, aucun jeton applicatif, comptes et journal inchangés.
    const refuseSansEcriture = async (claims, attendu, statut, comptesTouches, quoi, options) => {
      const avant = await Promise.all(comptesTouches.map((c) => identifiants(c.id)));
      const totalAvant = await totalJournal();
      const idToken = jetonMicrosoft(claims, options);
      const { resultat: res, lignes } = await pendant(() => connecterAvecJeton(idToken));
      assert.equal(res.status, statut, `${quoi} : ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, attendu, quoi);
      assert.equal(res.body.token, undefined, `${quoi} : aucun jeton applicatif`);
      assert.deepEqual(await Promise.all(comptesTouches.map((c) => identifiants(c.id))), avant, `${quoi} : aucun compte modifié`);
      assert.equal(await totalJournal(), totalAvant, `${quoi} : rien n'est écrit au journal`);
      return { res, lignes, idToken };
    };

    // Toutes les clés d'un objet JSON, à toute profondeur.
    const clesProfondes = (valeur, cles = []) => {
      if (Array.isArray(valeur)) valeur.forEach((v) => clesProfondes(v, cles));
      else if (valeur && typeof valeur === 'object') for (const [cle, v] of Object.entries(valeur)) { cles.push(cle); clesProfondes(v, cles); }
      return cles;
    };
    // Une réponse n'expose aucun identifiant Microsoft : ni les valeurs liées, ni le locataire, ni un champ qui les
    // porterait.
    const nExposeRien = (res, valeurs, quoi) => {
      const texte = res.text ?? JSON.stringify(res.body);
      for (const valeur of valeurs) assert.ok(!texte.includes(valeur), `${quoi} : ${valeur} exposé`);
      const champs = clesProfondes(res.body).filter((cle) => /microsoft|^oid$|^tid$/i.test(cle));
      assert.deepEqual(champs, [], `${quoi} : champ d'identifiant exposé`);
    };
    const journalVu = async (auth, cibleId) => {
      const res = await request(app).get('/api/journal-administration').query({ cible: cibleId }).set(auth);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.body;
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
      // Cadrage : « AZURE_* posés avant l'import » ; la connexion Microsoft les lit au chargement de sso.ts.
      process.env.AZURE_TENANT_ID = LOCATAIRE;
      process.env.AZURE_CLIENT_ID = APPLICATION;
      delete process.env.MICROSOFT_GRAPH_URL;
      delete process.env.TRUST_PROXY;
      process.env.DATABASE_URL = cibleApplication.toString();
      process.env.NODE_ENV = 'test';
      process.env.JWT_SECRET = 'secret-de-test-uniquement';
      process.env.BREAK_GLASS_EMAIL = 'secours-sso264@iris.test';
      process.env.BREAK_GLASS_TOKEN = 'jeton-de-secours-de-test-au-moins-32-caracteres';
      process.env.SUPERADMIN_EMAILS = 'secours-sso264@iris.test';
      globalThis.fetch = async (entree, options) => {
        const adresse = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url;
        if (adresse === ADRESSE_CLES) {
          appelsCles.push(adresse);
          return new Response(JSON.stringify({ keys: [JWK_PUBLIQUE] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        autresAppels.push(adresse);
        return fetchOrigine(entree, options);
      };
      for (const methode of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
        consoleOrigine[methode] = console[methode];
        console[methode] = (...args) => { sortieConsole.push({ methode, texte: format(...args) }); consoleOrigine[methode].apply(console, args); };
      }
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
      sessionSuper = connexion.body.token;
      secours = await prisma.user.findUniqueOrThrow({ where: { email: 'secours-sso264@iris.test' }, select: { id: true, name: true, email: true, role: true } });
      assert.equal(secours.role, 'SUPERADMIN');
      // La connexion Microsoft est bien active pour ce fichier.
      const config = await request(app).get('/api/config');
      assert.deepEqual(config.body, { ssoConfigured: true, ssoClientId: APPLICATION, ssoTenantId: LOCATAIRE });
      comptes.admin = await creerCompte('ADMIN', 'admin');
      comptes.directeur = await creerCompte('DIRECTEUR', 'directeur');
    });

    after(async () => {
      globalThis.fetch = fetchOrigine;
      for (const [methode, origine] of Object.entries(consoleOrigine)) console[methode] = origine;
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      if (baseCreee) await administrationPg.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`);
      await administrationPg.end().catch(() => {});
    });

    // --- Témoins : la vérification du jeton reste entière ---

    // Témoins du simulateur et de la vérification, inchangée (cadrage : « signature, audience et émetteur déjà
    // vérifiés » ; « Aucune adresse JWKS réglable n'est ajoutée : elle ferait accepter des jetons signés par une autre
    // clé »). Un jeton valide ouvre la session, puis chaque altération est refusée, sans liaison ; les clés ne sont lues
    // qu'à l'adresse Microsoft du locataire configuré.
    test('témoins : un jeton signé par une autre clé, sous un kid inconnu, pour une autre audience, d’un autre émetteur ou expiré est refusé (401), sans liaison ; les clés sont lues à la seule adresse Microsoft du locataire', async () => {
      const compte = await creerCompte('CONDUCTEUR_TRAVAUX', 'temoins');
      const oid = nouvelOid();
      const claims = { oid, adresse: compte.email };
      for (const [quoi, options] of [
        ['signé par une autre clé, même kid', { cle: CLE_ETRANGERE }],
        ['signé par une autre clé, kid inconnu', { cle: CLE_ETRANGERE, kid: 'cle-inconnue-264' }],
        ['autre audience', { audience: '00000000-0000-4000-8000-0000000c2640' }],
        ['autre émetteur', { emetteur: 'https://login.microsoftonline.com/00000000-0000-4000-8000-0000000d2640/v2.0' }],
        ['expiré', { expiresIn: -60 }],
      ]) {
        await refuseSansEcriture(claims, REFUS_GENERIQUE, 401, [compte], quoi, options);
      }
      assert.deepEqual(await identifiants(compte.id).then(({ oid: o, tid }) => [o, tid]), [null, null]);
      await lier(compte, oid);
      assert.ok(appelsCles.length > 0, 'les clés de signature ont été lues');
      assert.deepEqual(autresAppels, [], 'aucune autre adresse n’est appelée');
    });

    // --- Liaison à la première connexion ---

    // Cadrage : « compte non lié trouvé par l'adresse, comme aujourd'hui : à la première connexion réussie, oid et tid
    // sont enregistrés […] ; la liaison est écrite au journal » ; « au journal d'administration, au nom du compte
    // lui-même (auteur : ce compte ; non « Iris (démarrage) ») […] avec concerneSuperAdmin: isSuperAdminRole(compte.role) » ;
    // « les identifiants eux-mêmes ne sont pas écrits dans le journal ». La deuxième connexion, adresse en majuscules
    // (comparée sans tenir compte de la casse, comme avant), ne relie ni ne journalise rien : ni nouvelle liaison, ni
    // « changement d'adresse ».
    test('première connexion : le couple oid + tid est lié au compte trouvé par l’adresse et journalisé au nom du compte, sans les identifiants ; la connexion suivante ne relie ni ne journalise rien', async () => {
      const compte = await creerCompte('CONDUCTEUR_TRAVAUX', 'liaison');
      const oid = nouvelOid();
      assert.deepEqual(await identifiants(compte.id).then(({ oid: o, tid }) => [o, tid]), [null, null]);
      const totalAvant = await totalJournal();
      const res = await connecter({ oid, adresse: compte.email });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.user.id, compte.id);
      const lie = await identifiants(compte.id);
      assert.deepEqual([lie.oid, lie.tid, lie.email], [oid, LOCATAIRE, compte.email]);
      assert.equal(await totalJournal(), totalAvant + 1, 'une seule entrée écrite');
      const [entree, ...autres] = await journalDe(compte.id);
      assert.deepEqual(autres, []);
      assert.deepEqual(
        { domaine: entree.domaine, type: entree.type, action: entree.action, cibleId: entree.cibleId, cibleLibelle: entree.cibleLibelle, auteurId: entree.auteurId, auteurNom: entree.auteurNom, auteurSuperAdmin: entree.auteurSuperAdmin, concerneSuperAdmin: entree.concerneSuperAdmin, reserveSuperAdmin: entree.reserveSuperAdmin },
        { domaine: 'DROITS', type: 'COMPTE', action: ACTION_LIAISON, cibleId: compte.id, cibleLibelle: `${compte.name} (${compte.email})`, auteurId: compte.id, auteurNom: compte.name, auteurSuperAdmin: false, concerneSuperAdmin: false, reserveSuperAdmin: false },
      );
      const ecrit = JSON.stringify(entree);
      assert.ok(!ecrit.includes(oid) && !ecrit.includes(LOCATAIRE), `identifiants écrits au journal : ${ecrit}`);
      // Lue par l'administration : l'entrée de la liaison, au nom du compte.
      const vue = await journalVu(parCompte(comptes.admin), compte.id);
      assert.deepEqual(vue.entrees.map((e) => [e.action, e.auteurId, e.auteurNom]), [[ACTION_LIAISON, compte.id, compte.name]]);
      // Connexion suivante, même couple, adresse en majuscules : rien n'est écrit.
      const encore = await connecter({ oid, adresse: compte.email.toUpperCase() });
      assert.equal(encore.status, 200, JSON.stringify(encore.body));
      assert.equal(encore.body.user.id, compte.id);
      assert.deepEqual(await identifiants(compte.id), lie, 'compte inchangé, `updatedAt` compris');
      assert.equal(await totalJournal(), totalAvant + 1, 'ni nouvelle liaison ni changement d’adresse journalisés');
    });

    // Lot #563 (cadrage v2, section 4 et test T1) : remplace par la route le témoin d'api.test.mjs, retiré avec
    // l'ancienne fonction d'autorisation par la seule adresse. À la première connexion, le compte non lié est trouvé par
    // son adresse sans tenir compte de la casse : une adresse Microsoft écrite en capitales désigne le compte Iris
    // enregistré en minuscules, qui est lié au couple et journalisé une fois, sans changement d'adresse. Lecture
    // écartée : un compte lu par l'adresse brute du jeton (sans mise en minuscules), qui ne le trouverait pas et
    // refuserait la connexion (403, « accès refusé »).
    test('première connexion sous l’adresse du compte écrite en capitales : compte trouvé sans tenir compte de la casse, lié au couple et journalisé une fois', async () => {
      const compte = await creerCompte('CONDUCTEUR_TRAVAUX', 'casse');
      const oid = nouvelOid();
      assert.deepEqual(await identifiants(compte.id).then(({ oid: o, tid }) => [o, tid]), [null, null]);
      const totalAvant = await totalJournal();
      const res = await connecter({ oid, adresse: compte.email.toUpperCase() });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.user.id, res.body.user.email], [compte.id, compte.email]);
      assert.ok(res.body.token, 'un jeton applicatif est émis');
      const lie = await identifiants(compte.id);
      assert.deepEqual([lie.oid, lie.tid, lie.email], [oid, LOCATAIRE, compte.email], 'compte lié au couple, adresse Iris inchangée');
      assert.deepEqual((await journalDe(compte.id)).map((e) => [e.action, e.auteurId]), [[ACTION_LIAISON, compte.id]]);
      assert.equal(await totalJournal(), totalAvant + 1, 'une seule entrée écrite');
    });

    // Cadrage : « dans la même transaction que l'écriture des identifiants ». L'entrée du journal est rendue impossible
    // pour ce seul compte (déclencheur posé par le test sur sa base) : la liaison est annulée avec elle, et la connexion
    // échoue (réponse d'erreur inchangée de la route), sans jeton applicatif. Écarte une liaison validée avant
    // l'écriture du journal, ou journalisée hors de sa transaction.
    test('la liaison et son entrée de journal sont écrites dans la même transaction : si l’entrée ne peut pas être écrite, la liaison n’est pas enregistrée', async () => {
      const compte = await creerCompte('COMMERCIAL', 'transaction');
      const fonction = `test_sso264_refus_${randomBytes(4).toString('hex')}`;
      await prisma.$executeRawUnsafe(`CREATE FUNCTION "${fonction}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."cibleId" = '${compte.id}' THEN RAISE EXCEPTION 'journal refusé par le test'; END IF; RETURN NEW; END $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${fonction}" BEFORE INSERT ON "JournalAdministration" FOR EACH ROW EXECUTE FUNCTION "${fonction}"()`);
      try {
        await refuseSansEcriture({ oid: nouvelOid(), adresse: compte.email }, ERREUR_CONNEXION, 500, [compte], 'journal impossible');
        assert.deepEqual(await identifiants(compte.id).then(({ oid, tid }) => [oid, tid]), [null, null]);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fonction}" ON "JournalAdministration"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fonction}"()`);
      }
      // Témoin : le déclencheur retiré, la même première connexion lie le compte.
      await lier(compte, nouvelOid());
    });

    // --- Compte lié ---

    // Cadrage : « compte déjà lié (microsoftOid/microsoftTid égaux à ceux du jeton) : connexion autorisée quelle que
    // soit l'adresse du jeton, si le compte est actif. Si l'adresse du jeton diffère de celle du compte, l'événement est
    // écrit au journal d'administration (« changement d'adresse Microsoft détecté »), sans changer l'adresse du compte
    // Iris » ; « l'entrée garde l'adresse du compte Iris (avant) et l'adresse du jeton (après) ». Critère : « Un
    // changement d'adresse côté Microsoft n'empêche plus la connexion, et il est journalisé au nom du compte. »
    // L'adresse du jeton n'est celle d'aucun compte d'Iris : avant le correctif, la connexion répondait 403.
    test('compte lié dont l’adresse Microsoft a changé : connexion acceptée au nom du compte, adresse Iris inchangée, changement journalisé au nom du compte (avant : adresse Iris, après : adresse du jeton), sans identifiants', async () => {
      const compte = await creerCompte('COMMERCIAL', 'adresse-changee');
      const oid = nouvelOid();
      await lier(compte, oid);
      const lie = await identifiants(compte.id);
      const nouvelleAdresse = `sso264.renomme.${suffixe()}@nouveau-domaine.test`;
      const totalAvant = await totalJournal();
      const res = await connecter({ oid, adresse: nouvelleAdresse });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.user.id, compte.id);
      assert.equal(res.body.user.email, compte.email, 'la réponse porte l’adresse du compte Iris');
      assert.deepEqual(await identifiants(compte.id), lie, 'adresse et identifiants du compte inchangés');
      // La session ouverte est bien celle du compte.
      const moi = await request(app).get('/api/me').set(entete(res.body.token));
      assert.equal(moi.status, 200);
      assert.deepEqual([moi.body.id, moi.body.email], [compte.id, compte.email]);
      assert.equal(await totalJournal(), totalAvant + 1);
      const entree = (await journalDe(compte.id)).at(-1);
      assert.deepEqual(
        { action: entree.action, domaine: entree.domaine, type: entree.type, auteurId: entree.auteurId, auteurNom: entree.auteurNom, concerneSuperAdmin: entree.concerneSuperAdmin },
        { action: ACTION_ADRESSE, domaine: 'DROITS', type: 'COMPTE', auteurId: compte.id, auteurNom: compte.name, concerneSuperAdmin: false },
      );
      assert.ok(JSON.stringify(entree.avant).includes(compte.email), `avant : ${JSON.stringify(entree.avant)}`);
      assert.ok(!JSON.stringify(entree.avant).includes(nouvelleAdresse));
      assert.ok(JSON.stringify(entree.apres).includes(nouvelleAdresse), `après : ${JSON.stringify(entree.apres)}`);
      const ecrit = JSON.stringify(entree);
      assert.ok(!ecrit.includes(oid) && !ecrit.includes(LOCATAIRE), `identifiants écrits au journal : ${ecrit}`);
    });

    // Cadrage : « adresse d'un compte déjà lié à un autre oid/tid : refus (401 générique, aucun détail renvoyé) » ;
    // « une tentative refusée laisse une trace serveur (console.warn, comme [SECOURS]), sans identifiants, sans jeton et
    // sans adresse complète, plutôt qu'une écriture en base ». Critère : « Une adresse réattribuée à une autre personne
    // (autre oid) ne donne pas accès au compte. » La réponse est celle d'un jeton invalide, indiscernable d'elle. Avant
    // le correctif, ce jeton ouvrait le compte (mutant « liaison non vérifiée, adresse seule »).
    test('adresse réattribuée : un autre oid sur l’adresse d’un compte lié est refusé (401 générique, comme un jeton invalide), sans écriture ni journal, avec une trace serveur sans identifiants, jeton ni adresse', async () => {
      const compte = await creerCompte('CONDUCTEUR_TRAVAUX', 'reattribuee');
      const oidTitulaire = nouvelOid();
      await lier(compte, oidTitulaire);
      const oidAutre = nouvelOid();
      const { lignes, idToken } = await refuseSansEcriture({ oid: oidAutre, adresse: compte.email }, REFUS_GENERIQUE, 401, [compte], 'autre oid sur l’adresse');
      assert.ok(lignes.some((l) => l.methode === 'warn'), 'une trace serveur (console.warn) est laissée');
      aucuneDans(lignes, { oidAutre, oidTitulaire, tid: LOCATAIRE, jeton: idToken, signature: idToken.split('.')[2], adresse: compte.email }, 'trace du refus');
      // Indiscernable d'un jeton invalide.
      const invalide = await connecter({ oid: oidAutre, adresse: compte.email }, { cle: CLE_ETRANGERE });
      assert.deepEqual([invalide.status, invalide.body], [401, REFUS_GENERIQUE]);
      // Le titulaire, lui, se connecte toujours.
      const titulaire = await connecter({ oid: oidTitulaire, adresse: compte.email });
      assert.deepEqual([titulaire.status, titulaire.body.user?.id], [200, compte.id]);
    });

    // Cadrage : « oid/tid déjà liés à un autre compte que celui de l'adresse : refus » ; « un compte désactivé garde sa
    // liaison : pour la même personne, on réactive l'ancien compte ». Le couple est lié à un compte désactivé ; l'adresse
    // du jeton est celle d'un autre compte, actif et non lié : il n'est pas lié à ce couple, et l'ancien n'est pas
    // ouvert.
    test('identifiants liés à un compte désactivé : la connexion sous l’adresse d’un autre compte, non lié, est refusée, sans le lier ni rien journaliser, avec une trace serveur sans identifiants', async () => {
      const ancien = await creerCompte('TECHNICIEN', 'ancien-desactive');
      const nouveau = await creerCompte('TECHNICIEN', 'nouveau-non-lie');
      const oid = nouvelOid();
      await lier(ancien, oid);
      await prisma.user.update({ where: { id: ancien.id }, data: { actif: false } });
      const { res, lignes, idToken } = await refuseSansEcriture({ oid, adresse: nouveau.email }, REFUS_GENERIQUE, 401, [ancien, nouveau], 'couple d’un compte désactivé, adresse d’un autre compte');
      assert.equal(res.body.token, undefined);
      assert.deepEqual(await identifiants(nouveau.id).then(({ oid: o, tid }) => [o, tid]), [null, null]);
      assert.ok(lignes.some((l) => l.methode === 'warn'), 'une trace serveur (console.warn) est laissée');
      aucuneDans(lignes, { oid, tid: LOCATAIRE, jeton: idToken, adresse: nouveau.email, ancienne: ancien.email }, 'trace du refus');
    });

    // Lecture retenue par le code entre deux règles du cadrage qui s'appliquent toutes deux (« connexion autorisée
    // quelle que soit l'adresse du jeton » et « oid/tid déjà liés à un autre compte que celui de l'adresse : refus ») :
    // le refus, « le choix le plus restrictif, à confirmer » (commentaire de autoriserConnexionMicrosoft). Le couple est
    // lié à un compte actif, et l'adresse du jeton est celle d'un autre compte d'Iris, non lié : ni l'un ni l'autre
    // n'est ouvert, rien n'est écrit. Point signalé à Claude Code comme ambigu.
    test('identifiants liés à un compte actif, adresse du jeton d’un autre compte non lié : refus (401 générique), ni connexion ni liaison ni journal (lecture la plus restrictive, à confirmer)', async () => {
      const lie = await creerCompte('CONDUCTEUR_TRAVAUX', 'lie-actif');
      const autre = await creerCompte('CONDUCTEUR_TRAVAUX', 'autre-non-lie');
      const oid = nouvelOid();
      await lier(lie, oid);
      await refuseSansEcriture({ oid, adresse: autre.email }, REFUS_GENERIQUE, 401, [lie, autre], 'couple d’un compte actif, adresse d’un autre compte');
      assert.deepEqual(await identifiants(autre.id).then(({ oid: o, tid }) => [o, tid]), [null, null]);
    });

    // --- Jeton sans oid ou sans tid ---

    // Cadrage : « Un jeton sans oid ou sans tid est refusé (401 générique) ». Ni liaison, ni journal ; et pour un compte
    // déjà lié, aucun repli sur l'adresse. La trace éventuelle ne recopie ni l'adresse ni le jeton.
    test('jeton sans oid ou sans tid : refusé (401 générique), sans liaison ni journal, et sans repli sur l’adresse pour un compte déjà lié', async () => {
      const nonLie = await creerCompte('CONDUCTEUR_TRAVAUX', 'sans-oid-non-lie');
      const dejaLie = await creerCompte('CONDUCTEUR_TRAVAUX', 'sans-oid-lie');
      const oid = nouvelOid();
      await lier(dejaLie, oid);
      for (const compte of [nonLie, dejaLie]) {
        for (const [quoi, sans] of [['sans oid', ['oid']], ['sans tid', ['tid']], ['sans oid ni tid', ['oid', 'tid']]]) {
          const { lignes, idToken } = await refuseSansEcriture({ oid: compte === dejaLie ? oid : nouvelOid(), adresse: compte.email }, REFUS_GENERIQUE, 401, [nonLie, dejaLie], `${compte === dejaLie ? 'compte lié' : 'compte non lié'}, ${quoi}`, { sans });
          aucuneDans(lignes, { jeton: idToken, adresse: compte.email }, `trace du refus (${quoi})`);
        }
      }
      assert.deepEqual(await identifiants(nonLie.id).then(({ oid: o, tid }) => [o, tid]), [null, null]);
    });

    // --- Course ---

    // Cadrage : « course : deux premières connexions simultanées d'un même compte avec deux oid différents ; une seule
    // liaison réussit, l'autre est refusée » ; « mise à jour conditionnelle (microsoftOid IS NULL), atomique ».
    // Critère : « Deux premières connexions concurrentes ne lient qu'un seul oid. » Pour que la course ait lieu à coup
    // sûr, la ligne du compte est verrouillée par le test (SELECT … FOR UPDATE) le temps que les deux connexions, qui
    // l'ont lue non liée, attendent toutes deux de l'écrire ; le verrou levé, l'une lie le compte, l'autre trouve le
    // compte déjà lié. Écarte une mise à jour non conditionnelle (mutant « liaison non conditionnelle ») : les deux
    // réussiraient, la seconde écrasant la première, avec deux entrées au journal.
    test('course : deux premières connexions simultanées d’un même compte avec deux oid ne lient qu’un seul oid ; l’autre est refusée (401 générique), une seule entrée au journal', async () => {
      const compte = await creerCompte('ASSISTANTE_COMMERCIALE', 'course');
      const oids = [nouvelOid(), nouvelOid()];
      const verrou = new pg.Client({ connectionString: cible.toString() });
      await verrou.connect();
      let reponses;
      let attentesVues = 0;
      try {
        await verrou.query('BEGIN');
        await verrou.query('SELECT 1 FROM "User" WHERE "id" = $1 FOR UPDATE', [compte.id]);
        const enCours = oids.map((oid) => connecter({ oid, adresse: compte.email }).then((r) => r));
        const limite = Date.now() + 3_500;
        while (Date.now() < limite) {
          const [{ n }] = await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
          attentesVues = n;
          if (n >= 2) break;
          await new Promise((r) => setTimeout(r, 20));
        }
        await verrou.query('COMMIT');
        reponses = await Promise.all(enCours);
      } finally {
        await verrou.query('ROLLBACK').catch(() => {});
        await verrou.end();
      }
      assert.ok(attentesVues >= 2, `les deux connexions attendaient d’écrire le compte : la course a bien eu lieu (${attentesVues} en attente)`);
      const statuts = reponses.map((r) => r.status);
      assert.deepEqual([...statuts].sort(), [200, 401], JSON.stringify(reponses.map((r) => r.body)));
      const gagnant = statuts.indexOf(200);
      assert.equal(reponses[gagnant].body.user.id, compte.id);
      assert.deepEqual(reponses[1 - gagnant].body, REFUS_GENERIQUE);
      const lie = await identifiants(compte.id);
      assert.deepEqual([lie.oid, lie.tid], [oids[gagnant], LOCATAIRE], 'le compte est lié à l’oid de la connexion acceptée');
      assert.deepEqual((await journalDe(compte.id)).map((e) => e.action), [ACTION_LIAISON], 'une seule liaison journalisée');
      // Ensuite, seul l'oid lié ouvre le compte.
      assert.equal((await connecter({ oid: oids[gagnant], adresse: compte.email })).status, 200);
      assert.equal((await connecter({ oid: oids[1 - gagnant], adresse: compte.email })).status, 401);
    });

    // Même règle, sans verrou posé par le test : quelle que soit l'entrelacement réel des deux requêtes, une seule
    // réussit, sur trois comptes.
    test('course sans verrou du test : sur trois comptes, deux premières connexions lancées ensemble donnent chaque fois une seule liaison', async () => {
      for (let i = 1; i <= 3; i += 1) {
        const compte = await creerCompte('COMMERCIAL', `course-libre-${i}`);
        const oids = [nouvelOid(), nouvelOid()];
        const reponses = await Promise.all(oids.map((oid) => connecter({ oid, adresse: compte.email })));
        const statuts = reponses.map((r) => r.status);
        assert.deepEqual([...statuts].sort(), [200, 401], `compte ${i} : ${JSON.stringify(reponses.map((r) => r.body))}`);
        const lie = await identifiants(compte.id);
        assert.equal(lie.oid, oids[statuts.indexOf(200)]);
        assert.deepEqual((await journalDe(compte.id)).map((e) => e.action), [ACTION_LIAISON]);
      }
    });

    // --- Course de la même personne (même oid) ---

    // Deux premières connexions simultanées de la même personne (double clic, deux onglets) portent le même couple. La
    // première lie le compte ; la seconde le trouve lié à ce même couple : elle est admise comme toute connexion d'un
    // compte lié (cadrage : « compte déjà lié […] : connexion autorisée »), et la liaison n'est journalisée qu'une fois.
    // Correction R1 du contrôle de cohérence, proposition de test du contrôleur reprise ici : la lecture par le couple
    // et celle par l'adresse ne sont pas faites au même instant, et sans R1 une connexion qui lisait le couple encore
    // libre, puis le compte de l'adresse déjà lié par l'autre, était refusée (401) comme une adresse liée à d'autres
    // identifiants (4 courses sur 100 relevées par le contrôleur).
    test('course de la même personne, ligne verrouillée par le test : deux premières connexions avec le même oid sont toutes deux admises, une seule liaison journalisée', async () => {
      const compte = await creerCompte('CONDUCTEUR_TRAVAUX', 'meme-oid-verrou');
      const oid = nouvelOid();
      const verrou = new pg.Client({ connectionString: cible.toString() });
      await verrou.connect();
      let reponses;
      let attentesVues = 0;
      try {
        await verrou.query('BEGIN');
        await verrou.query('SELECT 1 FROM "User" WHERE "id" = $1 FOR UPDATE', [compte.id]);
        const enCours = [0, 1].map(() => connecter({ oid, adresse: compte.email }).then((r) => r));
        const limite = Date.now() + 3_500;
        while (Date.now() < limite) {
          const [{ n }] = await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
          attentesVues = n;
          if (n >= 2) break;
          await new Promise((r) => setTimeout(r, 20));
        }
        await verrou.query('COMMIT');
        reponses = await Promise.all(enCours);
      } finally {
        await verrou.query('ROLLBACK').catch(() => {});
        await verrou.end();
      }
      assert.ok(attentesVues >= 2, `les deux connexions attendaient d’écrire le compte : la course a bien eu lieu (${attentesVues} en attente)`);
      assert.deepEqual(reponses.map((r) => [r.status, r.body.user?.id]), [[200, compte.id], [200, compte.id]], JSON.stringify(reponses.map((r) => r.body)));
      assert.deepEqual(await identifiants(compte.id).then(({ oid: o, tid }) => [o, tid]), [oid, LOCATAIRE]);
      assert.deepEqual((await journalDe(compte.id)).map((e) => e.action), [ACTION_LIAISON], 'une seule liaison journalisée');
    });

    // L'entrelacement exact qui faisait échouer la course sans R1, rendu certain : une sonde posée sur le client Prisma
    // de l'application laisse passer la lecture par le couple (encore libre), puis, avant la lecture par l'adresse, lie
    // le compte au même couple, comme l'aurait fait la connexion simultanée de la même personne. La connexion doit être
    // admise (200), sans rien journaliser elle-même ; sans R1, elle répond 401. La sonde vérifie que l'ordre attendu a
    // bien eu lieu : si le code ne lisait plus le couple puis l'adresse, ce test le dirait au lieu de passer à vide.
    let sondeLectures = null;
    let sondePosee = false;
    const poserSondeLectures = () => {
      if (sondePosee) return;
      sondePosee = true;
      appPrisma.$use(async (params, next) => {
        const sonde = sondeLectures;
        if (!sonde || params.model !== 'User' || params.action !== 'findUnique') return next(params);
        const ou = params.args?.where ?? {};
        if (ou.microsoftOid_microsoftTid?.microsoftOid === sonde.oid && !sonde.coupleLu) {
          const resultat = await next(params);
          sonde.coupleLu = true;
          sonde.coupleTrouve = resultat !== null;
          sonde.signalerCouple();
          return resultat;
        }
        if (ou.email === sonde.email && !sonde.lieeAilleurs) {
          sonde.lieeAilleurs = true;
          sonde.ordre = await Promise.race([
            sonde.couple.then(() => 'couple puis adresse'),
            new Promise((r) => setTimeout(() => r('adresse lue sans lecture préalable du couple'), 2_000)),
          ]);
          await sonde.lier();
          return next(params);
        }
        return next(params);
      });
    };
    test('course de la même personne, entrelacement certain : couple lu encore libre, compte lié au même couple avant la lecture par l’adresse, la connexion est admise sans rien journaliser', async () => {
      poserSondeLectures();
      const compte = await creerCompte('COMMERCIAL', 'meme-oid-entrelace');
      const oid = nouvelOid();
      let signalerCouple;
      const couple = new Promise((r) => { signalerCouple = r; });
      sondeLectures = { oid, email: compte.email, couple, signalerCouple, lier: () => poserIdentifiants(compte.id, oid) };
      let res;
      try {
        res = await connecter({ oid, adresse: compte.email });
      } finally {
        const sonde = sondeLectures;
        sondeLectures = null;
        assert.equal(sonde.ordre, 'couple puis adresse', 'la sonde a vu la lecture par le couple, puis celle par l’adresse');
        assert.equal(sonde.coupleTrouve, false, 'la lecture par le couple a trouvé le couple encore libre');
      }
      assert.deepEqual([res.status, res.body.user?.id], [200, compte.id], JSON.stringify(res.body));
      assert.deepEqual(await identifiants(compte.id).then(({ oid: o, tid }) => [o, tid]), [oid, LOCATAIRE]);
      assert.deepEqual(await journalDe(compte.id), [], 'la connexion admise n’a rien journalisé : la liaison est celle de l’autre connexion');
      // Ensuite, le même couple ouvre le compte, un autre est refusé.
      assert.equal((await connecter({ oid, adresse: compte.email })).status, 200);
      assert.equal((await connecter({ oid: nouvelOid(), adresse: compte.email })).status, 401);
    });

    // Course naturelle, répétée sur cent comptes : deux premières connexions de la même personne lancées ensemble ne
    // reçoivent jamais de refus, et chaque compte n'a qu'une liaison journalisée. Avec R1, l'issue ne dépend pas de
    // l'entrelacement ; sans R1, le contrôleur a relevé 4 refus sur 100 courses.
    test('course naturelle de la même personne, sur cent comptes : aucun refus, une seule liaison journalisée par compte', async () => {
      const refus = [];
      for (let i = 1; i <= 100; i += 1) {
        const compte = await creerCompte('CONDUCTEUR_TRAVAUX', `meme-oid-libre-${i}`);
        const oid = nouvelOid();
        const reponses = await Promise.all([0, 1].map(() => connecter({ oid, adresse: compte.email })));
        for (const r of reponses) if (r.status !== 200 || r.body.user?.id !== compte.id) refus.push(`course ${i} : ${r.status} ${JSON.stringify(r.body)}`);
        assert.equal((await identifiants(compte.id)).oid, oid, `course ${i}`);
        assert.deepEqual((await journalDe(compte.id)).map((e) => e.action), [ACTION_LIAISON], `course ${i} : une seule liaison journalisée`);
      }
      assert.deepEqual(refus, [], `${refus.length} refus pour la même personne`);
    });

    // --- Super administrateur ---

    // Cadrage : « avec concerneSuperAdmin: isSuperAdminRole(compte.role), comme toute entrée qui porte sur un compte
    // (un ADMIN ou un DIRECTEUR ne voit pas celles d'un super administrateur) ». La liaison puis le changement d'adresse
    // d'un super administrateur sont fermés à l'administrateur et au directeur (liste, auteurs proposés au filtre,
    // export), ouverts au super administrateur ; témoin : ceux d'un conducteur leur sont ouverts. Écarte une entrée
    // écrite sans concerneSuperAdmin (mutant « concerneSuperAdmin absent »).
    test('super administrateur : l’entrée de sa liaison et celle de son changement d’adresse sont invisibles d’un administrateur et d’un directeur (liste, auteurs, export), visibles d’un super administrateur', async () => {
      const superCompte = await creerCompte('SUPERADMIN', 'super');
      const temoin = await creerCompte('CONDUCTEUR_TRAVAUX', 'temoin-visible');
      const oidSuper = nouvelOid();
      await lier(superCompte, oidSuper);
      await lier(temoin, nouvelOid());
      const changee = await connecter({ oid: oidSuper, adresse: `sso264.super-renomme.${suffixe()}@nouveau-domaine.test` });
      assert.deepEqual([changee.status, changee.body.user?.id], [200, superCompte.id]);
      const enBase = await journalDe(superCompte.id);
      assert.deepEqual(enBase.map((e) => [e.action, e.auteurId, e.concerneSuperAdmin, e.auteurSuperAdmin]), [
        [ACTION_LIAISON, superCompte.id, true, true],
        [ACTION_ADRESSE, superCompte.id, true, true],
      ]);
      for (const [quoi, auth] of [['administrateur', parCompte(comptes.admin)], ['directeur', parCompte(comptes.directeur)]]) {
        const vue = await journalVu(auth, superCompte.id);
        assert.deepEqual([vue.total, vue.entrees], [0, []], `${quoi} : entrées du super administrateur`);
        assert.ok(!vue.auteurs.some((a) => a.id === superCompte.id), `${quoi} : le super administrateur n’est pas proposé comme auteur`);
        const csv = await request(app).get('/api/journal-administration/export.csv').set(auth);
        assert.equal(csv.status, 200);
        assert.ok(!csv.text.includes(superCompte.name), `${quoi} : export`);
        const vueTemoin = await journalVu(auth, temoin.id);
        assert.deepEqual(vueTemoin.entrees.map((e) => [e.action, e.auteurId]), [[ACTION_LIAISON, temoin.id]], `${quoi} : témoin visible`);
      }
      const vueSuper = await journalVu(superAdmin(), superCompte.id);
      assert.deepEqual(vueSuper.entrees.map((e) => [e.action, e.auteurId, e.auteurNom]).reverse(), [
        [ACTION_LIAISON, superCompte.id, superCompte.name],
        [ACTION_ADRESSE, superCompte.id, superCompte.name],
      ]);
      assert.ok(vueSuper.auteurs.some((a) => a.id === superCompte.id));
      const csvSuper = await request(app).get('/api/journal-administration/export.csv').set(superAdmin());
      assert.ok(csvSuper.text.includes(superCompte.name), 'export du super administrateur');
      nExposeRien({ body: vueSuper, text: JSON.stringify(vueSuper) }, [oidSuper, LOCATAIRE], 'journal lu par le super administrateur');
      nExposeRien(csvSuper, [oidSuper, LOCATAIRE], 'export du super administrateur');
    });

    // --- Exposition et forme de la réponse ---

    // Cadrage : « microsoftOid/microsoftTid ne sortent par aucune route (ni /api/me, ni la liste des comptes, ni
    // /api/v1) ». Des comptes liés (un conducteur titulaire d'un chantier, un commercial rattaché, le super
    // administrateur de secours) sont lus par chaque route qui rend un compte : ni leurs oid, ni le locataire, ni un
    // champ qui les porterait n'en sortent. Écarte des identifiants ajoutés à la sélection de /api/me (mutant) ou de la
    // liste des comptes.
    test('aucune route n’expose les identifiants : connexion, /api/me, liste et écritures des comptes, accès de secours, fiche et liste des chantiers, /api/v1', async () => {
      const conducteur = await creerCompte('CONDUCTEUR_TRAVAUX', 'expose-conducteur');
      const commercial = await creerCompte('COMMERCIAL', 'expose-commercial');
      const oidConducteur = nouvelOid();
      const oidCommercial = nouvelOid();
      const oidSecours = nouvelOid();
      const valeurs = [oidConducteur, oidCommercial, oidSecours, LOCATAIRE];
      const reponses = [];
      const garder = (quoi, res, statut = 200) => {
        assert.equal(res.status, statut, `${quoi} : ${JSON.stringify(res.body)}`);
        reponses.push([quoi, res]);
        return res;
      };
      garder('POST /api/auth/sso (liaison)', await lier(conducteur, oidConducteur));
      garder('POST /api/auth/sso (liaison du commercial)', await lier(commercial, oidCommercial));
      garder('POST /api/auth/sso (connexion suivante)', await connecter({ oid: oidConducteur, adresse: conducteur.email }));
      garder('POST /api/auth/sso (adresse changée)', await connecter({ oid: oidConducteur, adresse: `sso264.expose.${suffixe()}@nouveau-domaine.test` }));
      // Le compte de l'accès de secours, lié par une connexion Microsoft, puis ouvert par l'accès de secours.
      garder('POST /api/auth/sso (super administrateur de secours)', await lier(secours, oidSecours));
      garder('POST /api/auth/secours', await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN }));
      garder('GET /api/me (conducteur)', await request(app).get('/api/me').set(parCompte(conducteur)));
      garder('GET /api/me (super administrateur)', await request(app).get('/api/me').set(superAdmin()));
      garder('PUT /api/me/theme', await request(app).put('/api/me/theme').set(parCompte(conducteur)).send({ theme: 'dark' }));
      for (const [quoi, auth] of [['administrateur', parCompte(comptes.admin)], ['directeur', parCompte(comptes.directeur)], ['super administrateur', superAdmin()]]) {
        const liste = garder(`GET /api/users (${quoi})`, await request(app).get('/api/users').set(auth));
        assert.ok(liste.body.some((u) => u.id === conducteur.id), `${quoi} : le conducteur lié est dans la liste`);
      }
      garder('PATCH /api/users/:id/actif', await request(app).patch(`/api/users/${commercial.id}/actif`).set(parCompte(comptes.admin)).send({ actif: true }));
      garder('PUT /api/users/:id/permissions', await request(app).put(`/api/users/${commercial.id}/permissions`).set(superAdmin()).send({ permissions: ['clients:read'] }));
      garder('GET /api/commerciaux', await request(app).get('/api/commerciaux').set(parCompte(conducteur)));
      garder('GET /api/conducteurs', await request(app).get('/api/conducteurs').set(parCompte(conducteur)));
      const chantier = await prisma.chantier.create({ data: {
        nom: `TEST Chantier SSO 264 ${suffixe()}`, client: 'TEST Client SSO 264', dateDebut: new Date('2026-11-02T00:00:00Z'),
        budgetGlobalVendu: '1000.00', budgetMaterielVendu: '400.00', budgetMainOeuvreVendu: '600.00', heuresVendues: '10.00',
        responsableId: conducteur.id, commercialId: commercial.id,
      } });
      garder('GET /api/chantiers (conducteur)', await request(app).get('/api/chantiers').set(parCompte(conducteur)));
      garder('GET /api/chantiers/:id', await request(app).get(`/api/chantiers/${chantier.id}`).set(superAdmin()));
      garder('GET /api/journal-administration', await request(app).get('/api/journal-administration').set(superAdmin()));
      garder('GET /api/journal-administration/export.csv', await request(app).get('/api/journal-administration/export.csv').set(superAdmin()));
      const cle = garder('POST /api/admin/api-keys', await request(app).post('/api/admin/api-keys').set(superAdmin()).send({ nom: `TEST clé SSO 264 ${suffixe()}`, scopes: ['chantiers:read', 'devis:read', 'clients:read'] }), 201);
      const parCle = entete(cle.body.apiKey);
      const v1 = garder('GET /api/v1/chantiers', await request(app).get('/api/v1/chantiers').set(parCle));
      assert.ok(v1.body.some((c) => c.id === chantier.id), 'le chantier du conducteur lié est lu par la clé');
      for (const chemin of ['/api/v1/devis', '/api/v1/heures', '/api/v1/achats', '/api/v1/clients']) garder(`GET ${chemin}`, await request(app).get(chemin).set(parCle));
      for (const [quoi, res] of reponses) nExposeRien(res, valeurs, quoi);
      // Les identifiants sont bien en base : l'absence dans les réponses n'est pas celle d'une liaison manquée.
      assert.equal((await identifiants(conducteur.id)).oid, oidConducteur);
      assert.equal((await identifiants(secours.id)).oid, oidSecours);
    });

    // Cadrage : « La réponse de POST /api/auth/sso garde sa forme (envoi-microsoft-365.spec.ts:739 la simule). » Clés
    // `token` et `user`, le compte sous ses sept champs, identique à GET /api/me ; jeton applicatif de sept jours qui ne
    // porte que l'identifiant et le type du compte, comme avant.
    test('la réponse de POST /api/auth/sso garde sa forme : token et user, le compte sous ses sept champs, identique à /api/me, jeton applicatif de 7 jours', async () => {
      const compte = await creerCompte('RESPONSABLE', 'forme');
      for (const quoi of ['première connexion', 'connexion suivante']) {
        const res = await connecter({ oid: (await identifiants(compte.id)).oid ?? nouvelOid(), adresse: compte.email });
        assert.equal(res.status, 200, `${quoi} : ${JSON.stringify(res.body)}`);
        assert.deepEqual(Object.keys(res.body).sort(), ['token', 'user'], quoi);
        assert.deepEqual(Object.keys(res.body.user).sort(), CHAMPS_COMPTE, quoi);
        const moi = await request(app).get('/api/me').set(entete(res.body.token));
        assert.equal(moi.status, 200);
        assert.deepEqual(res.body.user, moi.body, `${quoi} : le compte rendu est celui de /api/me`);
        assert.deepEqual([res.body.user.id, res.body.user.email, res.body.user.role], [compte.id, compte.email, 'RESPONSABLE']);
        const charge = jwt.verify(res.body.token, process.env.JWT_SECRET);
        assert.deepEqual(Object.keys(charge).sort(), ['exp', 'iat', 'id', 'role'], quoi);
        assert.deepEqual([charge.id, charge.role, charge.exp - charge.iat], [compte.id, 'RESPONSABLE', 7 * 24 * 3600], quoi);
      }
    });

    // --- Comptes désactivés, supprimés, inconnus et système ---

    // Cadrage, limites (choix par défaut, à confirmer) : « un compte désactivé garde sa liaison : pour la même
    // personne, on réactive l'ancien compte » ; « connexion autorisée […] si le compte est actif ». Désactivé par
    // l'administration, le compte garde son couple et sa connexion est refusée comme avant (403, « accès refusé ») ;
    // réactivé, il se reconnecte par le même couple, sans nouvelle liaison. Un compte désactivé jamais lié n'est pas lié
    // par une tentative.
    test('compte désactivé : il garde sa liaison, sa connexion est refusée (403) sans rien écrire, et il se reconnecte par le même couple une fois réactivé ; un compte désactivé non lié n’est pas lié', async () => {
      const compte = await creerCompte('COMPTABLE', 'desactive');
      const oid = nouvelOid();
      await lier(compte, oid);
      const desactivation = await request(app).patch(`/api/users/${compte.id}/actif`).set(parCompte(comptes.admin)).send({ actif: false });
      assert.equal(desactivation.status, 200, JSON.stringify(desactivation.body));
      assert.deepEqual(await identifiants(compte.id).then(({ oid: o, tid, actif }) => [o, tid, actif]), [oid, LOCATAIRE, false], 'la liaison est gardée');
      await refuseSansEcriture({ oid, adresse: compte.email }, NON_AUTORISE, 403, [compte], 'compte lié désactivé');
      const reactivation = await request(app).patch(`/api/users/${compte.id}/actif`).set(parCompte(comptes.admin)).send({ actif: true });
      assert.equal(reactivation.status, 200);
      const liaisons = (await journalDe(compte.id)).filter((e) => e.action === ACTION_LIAISON).length;
      const res = await connecter({ oid, adresse: compte.email });
      assert.deepEqual([res.status, res.body.user?.id], [200, compte.id]);
      assert.equal((await journalDe(compte.id)).filter((e) => e.action === ACTION_LIAISON).length, liaisons, 'aucune nouvelle liaison');
      const jamaisLie = await creerCompte('COMPTABLE', 'desactive-non-lie', { actif: false });
      await refuseSansEcriture({ oid: nouvelOid(), adresse: jamaisLie.email }, NON_AUTORISE, 403, [jamaisLie], 'compte non lié désactivé');
    });

    // Cadrage, limites : « une liaison erronée ne se défait qu'en supprimant le compte, ce qui libère le couple ».
    // Supprimé par l'administration, le compte libère son couple, qui se lie alors à un autre compte.
    test('compte supprimé : son couple est libéré et se lie à la première connexion d’un autre compte', async () => {
      const errone = await creerCompte('CONDUCTEUR_TRAVAUX', 'liaison-erronee');
      const remplacant = await creerCompte('CONDUCTEUR_TRAVAUX', 'remplacant');
      const oid = nouvelOid();
      await lier(errone, oid);
      await refuseSansEcriture({ oid, adresse: remplacant.email }, REFUS_GENERIQUE, 401, [remplacant], 'couple encore lié au compte à supprimer');
      const suppression = await request(app).delete(`/api/users/${errone.id}`).set(parCompte(comptes.admin));
      assert.equal(suppression.status, 200, JSON.stringify(suppression.body));
      assert.equal(await prisma.user.count({ where: { id: errone.id } }), 0);
      await lier(remplacant, oid);
      assert.deepEqual((await journalDe(remplacant.id)).map((e) => [e.action, e.auteurId]), [[ACTION_LIAISON, remplacant.id]]);
    });

    // Comportement d'avant, gardé : une adresse inconnue d'Iris, sous un couple jamais lié, est refusée (403, « accès
    // refusé ») sans rien écrire ; l'adresse réservée du compte système non plus (il ne se connecte jamais, audit de
    // #302), et il n'est pas lié.
    test('adresse inconnue ou adresse du compte système : refus inchangé (403), aucun compte créé ni lié, rien au journal', async () => {
      const comptesAvant = await prisma.user.count();
      await refuseSansEcriture({ oid: nouvelOid(), adresse: `sso264.inconnu.${suffixe()}@iris.test` }, NON_AUTORISE, 403, [], 'adresse inconnue');
      const systeme = await prisma.user.findUniqueOrThrow({ where: { email: 'systeme@iris.invalid' }, select: { id: true } });
      await refuseSansEcriture({ oid: nouvelOid(), adresse: ' Systeme@IRIS.invalid ' }, NON_AUTORISE, 403, [systeme], 'compte système');
      assert.deepEqual(await identifiants(systeme.id).then(({ oid, tid }) => [oid, tid]), [null, null]);
      assert.equal(await prisma.user.count(), comptesAvant);
    });

    // --- Garanties de la base et liaison concurrente sur un autre compte (audit droits et sécurité) ---

    // Migration 20261116120000_identifiant_microsoft : « un compte est lié par les deux identifiants à la fois, jamais
    // par un seul, ni par une valeur vide » (CHECK) ; « un couple n'appartient qu'à un compte » (index unique) ; deux
    // comptes non liés ne se gênent pas. Le code n'écrit jamais un couple partiel ni un couple déjà pris : seule la base
    // les refuse, et ce test écarte une migration qui perdrait l'une ou l'autre garde.
    test('base : un couple partiel ou vide est refusé (23514), un couple déjà lié à un autre compte aussi (23505) ; deux comptes non liés coexistent', async () => {
      const a = await creerCompte('CONDUCTEUR_TRAVAUX', 'base-a');
      const b = await creerCompte('CONDUCTEUR_TRAVAUX', 'base-b');
      const codeDe = async (requete) => {
        try { await requete; return 'accepté'; } catch (error) { return error?.meta?.code ?? error?.code ?? String(error); }
      };
      const oid = nouvelOid();
      assert.equal(await codeDe(prisma.$executeRaw`UPDATE "User" SET "microsoftOid" = ${oid} WHERE "id" = ${a.id}`), '23514', 'oid sans tid');
      assert.equal(await codeDe(prisma.$executeRaw`UPDATE "User" SET "microsoftTid" = ${LOCATAIRE} WHERE "id" = ${a.id}`), '23514', 'tid sans oid');
      assert.equal(await codeDe(prisma.$executeRaw`UPDATE "User" SET "microsoftOid" = '', "microsoftTid" = ${LOCATAIRE} WHERE "id" = ${a.id}`), '23514', 'oid vide');
      assert.equal(await codeDe(prisma.$executeRaw`UPDATE "User" SET "microsoftOid" = ${oid}, "microsoftTid" = '' WHERE "id" = ${a.id}`), '23514', 'tid vide');
      assert.deepEqual(await identifiants(a.id).then(({ oid: o, tid }) => [o, tid]), [null, null]);
      assert.equal(await codeDe(poserIdentifiants(a.id, oid)), 'accepté');
      assert.equal(await codeDe(poserIdentifiants(b.id, oid)), '23505', 'couple déjà lié à un autre compte');
      assert.equal(await codeDe(poserIdentifiants(b.id, oid, '00000000-0000-4000-8000-0000000e2640')), 'accepté', 'même oid, autre locataire');
      const nonLies = await prisma.$queryRaw`SELECT count(*)::int AS n FROM "User" WHERE "microsoftOid" IS NULL AND "microsoftTid" IS NULL`;
      assert.ok(nonLies[0].n >= 2, 'plusieurs comptes non liés coexistent');
    });

    // Course entre deux comptes : la connexion lit le couple libre et le compte de l'adresse non lié, puis, avant
    // qu'elle n'écrive, le même couple est lié à un autre compte. L'index unique refuse la seconde liaison (P2002) :
    // la connexion est refusée comme un jeton invalide (401 générique), sans lier le compte de l'adresse ni rien
    // journaliser, avec une trace sans identifiants. Pour que l'entrelacement ait lieu à coup sûr, la ligne du compte
    // de l'adresse est verrouillée par le test le temps de lier l'autre compte. Écarte un refus de l'index non
    // intercepté (500) ou une liaison qui passerait outre.
    test('course entre deux comptes : un couple lié à un autre compte entre la lecture et l’écriture est refusé (401 générique), sans liaison ni journal', async () => {
      const compte = await creerCompte('CONDUCTEUR_TRAVAUX', 'course-autre-compte');
      const autre = await creerCompte('CONDUCTEUR_TRAVAUX', 'course-autre-compte-lie');
      const oid = nouvelOid();
      const totalAvant = await totalJournal();
      const verrou = new pg.Client({ connectionString: cible.toString() });
      await verrou.connect();
      let reponse; let lignes; let attentesVues = 0;
      try {
        await verrou.query('BEGIN');
        await verrou.query('SELECT 1 FROM "User" WHERE "id" = $1 FOR UPDATE', [compte.id]);
        const debut = sortieConsole.length;
        const enCours = connecter({ oid, adresse: compte.email }).then((r) => r);
        const limite = Date.now() + 3_500;
        while (Date.now() < limite) {
          const [{ n }] = await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
          attentesVues = n;
          if (n >= 1) break;
          await new Promise((r) => setTimeout(r, 20));
        }
        await poserIdentifiants(autre.id, oid);
        await verrou.query('COMMIT');
        reponse = await enCours;
        lignes = sortieConsole.slice(debut);
      } finally {
        await verrou.query('ROLLBACK').catch(() => {});
        await verrou.end();
      }
      assert.ok(attentesVues >= 1, `la connexion attendait d’écrire le compte : l’entrelacement a bien eu lieu (${attentesVues})`);
      assert.deepEqual([reponse.status, reponse.body], [401, REFUS_GENERIQUE]);
      assert.deepEqual(await identifiants(compte.id).then(({ oid: o, tid }) => [o, tid]), [null, null], 'le compte de l’adresse n’est pas lié');
      assert.deepEqual(await identifiants(autre.id).then(({ oid: o, tid }) => [o, tid]), [oid, LOCATAIRE]);
      assert.equal(await totalJournal(), totalAvant, 'rien n’est journalisé');
      assert.ok(lignes.some((l) => l.methode === 'warn' && l.texte.startsWith('[SSO]')), 'une trace serveur [SSO] est laissée');
      aucuneDans(lignes, { oid, tid: LOCATAIRE, adresse: compte.email }, 'trace du refus');
    });
  });
}
