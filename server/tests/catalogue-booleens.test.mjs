// Lot #587, volet catalogue : `stockSuivi` (articles) et `actif` (trois familles, main d'œuvre comprise) lus en booléen
// strict (cadrage « catalogue : stockSuivi et actif lus en booléen strict », v1 complétée de sa v2, contrôlée par le
// controleur-coherence, verdict « peut être codé tel quel » ; issue #587, section « Catalogue (joignable par une clé
// catalogue:write) », commentaire d'état du 18-11-2026 ; #324, N3 de l'audit 2 : « sur une modification du catalogue, la
// valeur texte "false" réactive une fiche, et null la désactive (!!body.actif) » ; messages de Nelson du 16-11-2026,
// « continu avec les issu. », et du 17-11-2026, « Ok continu »). Règle 2 de la méthode : une fiche désactivée n'entre plus
// dans un devis (forfait et temps passé de main d'œuvre) ni dans un rattachement d'intervenant ; la désactivation et la
// réactivation d'une main d'œuvre sont journalisées.
//
// Avant le lot, les deux champs étaient lus par `!!` : « false », « 0 », {} ou [] posaient le suivi du stock d'un article,
// null le retirait ; « false » réactivait une fiche désactivée, null, 0 et la chaîne vide la désactivaient (et, pour une
// main d'œuvre, écrivaient une entrée DESACTIVATION ou REACTIVATION au journal d'administration).
//
// Lectures appliquées (cadrage, « Périmètre » et v2, toutes « choix par défaut, à confirmer », règle 5) :
//  - stockSuivi : facultatif ; clé absente = false, à la création comme à la modification (le PUT remplace la fiche) ;
//    toute autre valeur que true ou false, null compris, répond 400 « « stockSuivi » doit valoir true ou false. » ;
//    contrôlé dans catalogueExtraPayload, après les contrôles communs (référence, nom, TVA, prix de vente) et avant toute
//    lecture ou écriture en base ; ignoré pour les prestations et les équipements ;
//  - actif : facultatif, en modification seulement ; clé absente : valeur gardée ; true et false inchangés ; toute autre
//    valeur, null compris, répond 400 « « actif » doit valoir true ou false. », sans écriture ni journal ; articles et
//    équipements : après cataloguePayload et catalogueExtraPayload, avant la mise à jour (donc avant le 404) ;
//    prestations : après le 403 d'une clé qui vise une main d'œuvre par son corps, après estMainOeuvreDemande et les
//    charges utiles, avant la transaction (donc avant le 404, le 403 d'une clé sur une main d'œuvre existante et le 409
//    des rattachements) ;
//  - hors périmètre, gardé (v2, N1 et T5) : `estMainOeuvre: null` reste lu comme une clé absente.
//
// Ce que prouve ce fichier, par des requêtes HTTP réelles, en session (super administrateur, administrateur, directeur :
// requireAdmin, catégorie A de la matrice) et par clé d'intégration catalogue:write (/api/v1) : chaque écriture admise
// relue en base ; chaque refus prouvé sans écriture par l'empreinte de toute la base (chaque table du schéma public,
// contenu compris, `updatedAt` compris ; seule la dernière utilisation d'une clé, notée sans attente par /api/v1, en est
// retirée, comme dans la matrice des clés), la relecture de la fiche visée et le décompte du journal d'administration.
// Les corps refusés portent aussi un nom, une TVA, des prix et le champ propre de la famille modifiés (v2, T4) : aucune
// écriture partielle d'un montant.
//
// Fichier propre au lot, avec sa base jetable (modèle : chantiers-booleens.test.mjs) : `node --test` exécute les fichiers
// en parallèle, et api.test.mjs purge les données « TEST » de TEST_DATABASE_URL. TEST_DATABASE_URL ne sert ici que de
// connexion administrative : une base neuve est créée, migrée, servie à l'application montée en mémoire, puis supprimée.
// Sans TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { empreinteBase, tablesChangees, tablesDeLaBase } from './matrice-droits/outils.mjs';

const TITRE = 'Lot #587 (catalogue) : stockSuivi et actif lus en booléen strict';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Message du drapeau refusé (cadrage, périmètre 1 et 2), puis messages existants que le lot range avant ou après lui.
const REFUS_DRAPEAU = (cle) => `« ${cle} » doit valoir true ou false.`;
const MESSAGES = {
  authentification: 'Authentification requise',
  compteDesactive: { code: 'COMPTE_DESACTIVE', error: 'Ce compte est désactivé.' },
  administrateurs: 'Accès réservé aux administrateurs',
  cleRequise: 'Clé API Iris requise',
  scopeEcriture: 'Scope requis : catalogue:write',
  familleInconnue: 'Famille catalogue inconnue.',
  ficheIntrouvable: 'Fiche catalogue introuvable.',
  referenceNom: 'Référence et nom sont obligatoires.',
  tva: 'Taux de TVA non accepté : 0 %, 5,5 %, 10 % ou 20 %.',
  prixVente: 'Prix de vente invalide.',
  estMainOeuvre: REFUS_DRAPEAU('estMainOeuvre'),
  seulePrestation: 'Seule une prestation peut être une main d’œuvre.',
  cleMainOeuvre: 'Une clé d’intégration ne crée, ne modifie, ne désactive ni ne réactive une main d’œuvre, et ne fait pas passer une prestation en main d’œuvre ou l’inverse : réservé à l’administration, en session.',
  prixHeureHorsContrat: 'Prix de vente HT à l’heure, hors contrat : montant obligatoire, positif ou nul, au centime (deux décimales au plus).',
  rattachee: (n) => `Cette main d’œuvre est rattachée à ${n} intervenant(s) : retirez d’abord ces rattachements dans Administration > Intervenants.`,
};

// Valeurs présentes non admises (cadrage, « Tests attendus » : « "false", "true", 0, 1, "", null, {}, [], "oui" » ; v2,
// T1 : « complétées de "0" et [true] »). « false » et 0 écartent `!!` lu vrai sur une chaîne non vide et `Boolean()` ;
// « true » et 1 une conversion qui les lirait vrai ; « 0 », la chaîne vide et [true] un lecteur qui n'accepterait que
// quelques chaînes, convertirait une chaîne ou lirait le premier élément d'un tableau ; null, que `!!` lisait faux, est
// refusé (choix par défaut, à confirmer).
const VALEURS_REFUSEES = [
  ['la chaîne « false »', 'false'], ['la chaîne « true »', 'true'], ['la chaîne « 0 »', '0'], ['la chaîne vide', ''],
  ['le nombre 0', 0], ['le nombre 1', 1], ['null', null], ['un objet vide', {}], ['un tableau vide', []],
  ['le tableau [true]', [true]], ['la chaîne « oui »', 'oui'],
];
// Échantillon pour les cas d'ordre : une valeur que `!!` lit vrai, une qu'il lit faux, null, un objet.
const ECHANTILLON = [['la chaîne « false »', 'false'], ['null', null], ['le nombre 0', 0], ['un objet vide', {}]];

// Valeurs de départ des fiches de test, distinctes de toute valeur envoyée : une écriture, même partielle, se voit.
const DEPART = { description: 'TEST Description de départ 587c', tauxTva: '5.5', prixVenteHt: '111.11', prixAchatHt: '22.22' };
const DEPART_PROPRES = {
  articles: { unite: 'mètre', stockSuivi: false, stockActuel: '3.25' },
  equipements: { fabricant: 'TEST Fabricant de départ 587c' },
  prestations: { unite: 'forfait', dureeIndicativeMin: 90 },
};
// Valeurs envoyées (cadrage v2, T4 : « les corps refusés portent aussi un nom et des prix modifiés »).
const ENVOI = { nom: 'TEST Nom envoyé 587c', description: 'TEST Description envoyée 587c', tauxTva: '10', prixVenteHt: '987.65', prixAchatHt: '123.45' };
const ENVOI_PROPRES = {
  articles: { unite: 'pièce', stockActuel: '42.5' },
  equipements: { fabricant: 'TEST Fabricant envoyé 587c' },
  prestations: { unite: 'heure', dureeIndicativeMin: 45 },
};
// Main d'œuvre : prix de départ, puis prix envoyés, tous différents (la demi-journée, vide au départ, est renseignée).
const PRIX_MO = { prixVenteHt: '45.50', prixJourHorsContratHt: '320', prixHeureSousContratHt: '40', prixJourSousContratHt: '280.25', heuresParJour: '7.5' };
const ENVOI_MO = { nom: 'TEST Main d’œuvre envoyée 587c', prixVenteHt: '99.99', prixJourHorsContratHt: '650', prixHeureSousContratHt: '55.55', prixJourSousContratHt: '600', heuresParJour: '8', prixDemiJourneeHorsContratHt: '330' };
const FAMILLES = ['articles', 'equipements', 'prestations'];
// Comptes refusés par requireAdmin (hors administration).
const HORS_ADMINISTRATION = ['CT', 'RESP', 'DC', 'AC', 'CPT', 'TECH', 'COM', 'AT'];

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_catbool587_${randomBytes(6).toString('hex')}`;
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
    const comptes = {};
    const cles = {};
    let rang = 0;
    const suffixe = () => `${Date.now()}-${(rang += 1)}`;
    const reference = (code) => `TEST-587C-${code}-${suffixe()}`;
    const creerCompte = async (code, role, extra = {}) => {
      const s = suffixe();
      const compte = await prisma.user.create({ data: { email: `catbool587.${code.toLowerCase()}.${s}@iris.test`, name: `TEST ${code} 587c ${s}`, role, ...extra } });
      comptes[code] = { ...compte, auth: entete(jwt.sign({ id: compte.id }, process.env.JWT_SECRET)) };
      return comptes[code];
    };
    // Les trois types de compte de l'administration (requireAdmin : super administrateur, administrateur et directeur,
    // qui a les droits de l'administration, décision du 24-10-2026, point 14), puis la clé catalogue:write sur /api/v1.
    const SESSION = () => ['SA', 'AD', 'DIR'].map((qui) => ({ qui, auth: comptes[qui].auth, porte: '/api/catalogue' }));
    const ECRIVAINS = () => [...SESSION(), { qui: 'clé catalogue:write', auth: cles.ecriture, porte: '/api/v1/catalogue' }];

    // --- État de la base ---
    const empreinte = () => empreinteBase(prisma, tables, { colonnesIgnorees: { ApiAccessKey: ['dernierUsageLe'] } });
    const modele = (famille) => ({ articles: prisma.catalogueArticle, equipements: prisma.catalogueEquipement, prestations: prisma.cataloguePrestation })[famille];
    const ficheEnBase = async (famille, id) => JSON.parse(JSON.stringify(await modele(famille).findUnique({ where: { id } })));
    const journalMainOeuvre = async (cibleId) => (await prisma.journalAdministration.findMany({ where: { type: 'MAIN_OEUVRE', cibleId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }))
      .map(({ domaine, type, action, cibleId: id, auteurId, avant, apres }) => ({ domaine, type, action, cibleId: id, auteurId, avant, apres }));

    // Un refus : statut et corps exacts ; aucune écriture dans toute la base ; la fiche relue identique (`updatedAt`
    // compris) ; aucune entrée nouvelle au journal d'administration.
    const refuse = async (envoi, statut, attendu, quoi, relire = null) => {
      const avant = await empreinte();
      const ficheAvant = relire ? await relire() : null;
      const journalAvant = await prisma.journalAdministration.count();
      const res = await envoi();
      assert.equal(res.status, statut, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, typeof attendu === 'string' ? { error: attendu } : attendu, quoi);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      if (relire) assert.deepEqual(await relire(), ficheAvant, `${quoi} : fiche relue en base, updatedAt compris`);
      assert.equal(await prisma.journalAdministration.count(), journalAvant, `${quoi} : aucune entrée au journal d’administration`);
      return res;
    };
    const ok = async (promesse, statut = 200) => {
      const res = await promesse;
      assert.equal(res.status, statut, `${res.req?.method} ${res.req?.path} : ${JSON.stringify(res.body)}`);
      return res.body;
    };
    // Le corps est calculé par l'appelant, avant `request(app)` : une exception levée en le construisant laisserait ouvert
    // le serveur éphémère de supertest.
    const appeler = (methode, chemin, auth, corps) => {
      const requete = request(app)[methode](chemin);
      if (auth) requete.set(auth);
      return corps === undefined ? requete : requete.send(corps);
    };

    // --- Données ---
    const fabriquer = (famille, extra = {}) => modele(famille).create({ data: {
      reference: reference(famille.slice(0, 3).toUpperCase()), nom: `TEST ${famille} de départ 587c ${suffixe()}`, ...DEPART, ...DEPART_PROPRES[famille], ...extra,
    } });
    // Corps complet d'une modification (le PUT remplace la fiche), aux valeurs envoyées.
    const corpsFiche = (famille, fiche, extra = {}) => ({ reference: fiche.reference, ...ENVOI, ...ENVOI_PROPRES[famille], ...extra });
    const corpsNouvelArticle = (extra = {}) => ({ reference: reference('NOUV'), ...ENVOI, ...ENVOI_PROPRES.articles, ...extra });
    const corpsMainOeuvre = (ref, extra = {}) => ({ estMainOeuvre: true, reference: ref, nom: `TEST Main d’œuvre ${ref}`, tauxTva: '20', ...PRIX_MO, ...extra });
    // Main d'œuvre créée par l'administration (création journalisée), désactivée ensuite en base si demandé.
    const creerMainOeuvre = async ({ actif = true } = {}) => {
      const corps = corpsMainOeuvre(reference('MO'));
      const fiche = await ok(appeler('post', '/api/catalogue/prestations', comptes.SA.auth, corps), 201);
      if (!actif) await prisma.cataloguePrestation.update({ where: { id: fiche.id }, data: { actif: false } });
      return { id: fiche.id, reference: fiche.reference, corps };
    };
    const rattacher = async (prestationId) => {
      const intervenant = await prisma.intervenant.create({ data: { nom: `TEST Intervenant rattaché 587c ${suffixe()}`, role: 'TECHNICIEN', tauxHoraireCharge: '35' } });
      await prisma.intervenantMainOeuvre.create({ data: { intervenantId: intervenant.id, prestationId } });
      return intervenant;
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
      await creerCompte('AD', 'ADMIN');
      await creerCompte('DIR', 'DIRECTEUR');
      await creerCompte('AD-DESACTIVE', 'ADMIN', { actif: false });
      for (const [code, role] of [['CT', 'CONDUCTEUR_TRAVAUX'], ['RESP', 'RESPONSABLE'], ['DC', 'DIRECTEUR_COMMERCIAL'], ['AC', 'ASSISTANTE_COMMERCIALE'],
        ['CPT', 'COMPTABLE'], ['TECH', 'TECHNICIEN'], ['COM', 'COMMERCIAL'], ['AT', 'ASSISTANTE_TECHNIQUE']]) {
        await creerCompte(code, role);
      }
      // Clés créées par l'administration (journalisées), avant la première empreinte.
      for (const [nom, scopes] of [['ecriture', ['catalogue:read', 'catalogue:write']], ['lecture', ['catalogue:read']]]) {
        const creation = await ok(appeler('post', '/api/admin/api-keys', comptes.SA.auth, { nom: `TEST Clé catalogue 587c ${nom} ${suffixe()}`, scopes }), 201);
        cles[nom] = entete(creation.apiKey);
      }
      // Réglages créés à leur première lecture : avant la première empreinte, pour qu'une lecture ne passe pas pour une
      // écriture.
      await ok(appeler('get', '/api/parametres', comptes.SA.auth));
      tables = await tablesDeLaBase(prisma);
      assert.ok(['CatalogueArticle', 'CatalogueEquipement', 'CataloguePrestation', 'IntervenantMainOeuvre', 'JournalAdministration', 'ApiAccessKey'].every((t) => tables.includes(t)) && tables.length > 40, `tables relevées : ${tables.join(', ')}`);
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
    // 1. stockSuivi (articles : POST /api/catalogue/articles et PUT /api/catalogue/articles/:id, et leur porte /api/v1)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage, périmètre 1 : « Une valeur présente autre que true ou false, null compris, répond 400 […], sans rien
    // écrire » ; « Tests attendus » : « création […] d'un article, en session (administration) et par clé catalogue:write ;
    // aucun article créé ». Avant le lot, « false », « 0 », {} et [] créaient un article suivi en stock, null un article non
    // suivi. Tue « `!!` rétabli » et « null admis ».
    test('stockSuivi, création d’un article : chaque valeur non booléenne, null compris, répond 400 « « stockSuivi » doit valoir true ou false. », par le super administrateur, l’administrateur, le directeur et une clé catalogue:write ; aucun article n’est créé', async () => {
      for (const { qui, auth, porte } of ECRIVAINS()) {
        for (const [nom, valeur] of VALEURS_REFUSEES) {
          const corps = corpsNouvelArticle({ stockSuivi: valeur });
          await refuse(() => appeler('post', `${porte}/articles`, auth, corps), 400, REFUS_DRAPEAU('stockSuivi'), `${qui}, création, ${nom}`);
          assert.equal(await prisma.catalogueArticle.count({ where: { reference: corps.reference } }), 0, `${qui}, ${nom} : aucun article créé`);
        }
      }
    });

    // Cadrage, périmètre 1 et 3 ; « Tests attendus » : « modification d'un article […] ; fiche relue inchangée (updatedAt
    // compris) » ; v2, T4 : le corps porte aussi un nom, une TVA, des prix et un stock modifiés. Sur un article suivi,
    // `!!null` retirait le suivi ; sur un article non suivi, `!!"false"` le posait. Tue « `!!` rétabli », « null admis » et
    // « contrôle placé après la mise à jour » (écriture partielle).
    test('stockSuivi, modification d’un article suivi ou non : chaque valeur non booléenne, null compris, répond 400, en session et par clé ; rien n’est écrit, pas même le nom, la TVA, les prix ou le stock envoyés avec', async () => {
      for (const stockSuivi of [true, false]) {
        const article = await fabriquer('articles', { stockSuivi });
        for (const { qui, auth, porte } of ECRIVAINS()) {
          for (const [nom, valeur] of VALEURS_REFUSEES) {
            const corps = corpsFiche('articles', article, { stockSuivi: valeur });
            await refuse(() => appeler('put', `${porte}/articles/${article.id}`, auth, corps), 400, REFUS_DRAPEAU('stockSuivi'),
              `${qui}, article ${stockSuivi ? 'suivi' : 'non suivi'}, ${nom}`, () => ficheEnBase('articles', article.id));
          }
        }
        const relu = await ficheEnBase('articles', article.id);
        assert.deepEqual([relu.stockSuivi, relu.nom, relu.tauxTva, relu.prixVenteHt, relu.prixAchatHt, relu.stockActuel, relu.updatedAt],
          [stockSuivi, article.nom, '5.5', '111.11', '22.22', '3.25', article.updatedAt.toISOString()], 'article intact');
      }
    });

    // Cadrage, périmètre 1 : « Une clé absente vaut false, comme aujourd'hui (le PUT envoie la fiche entière […]) » ; v2,
    // N2 et T2 : mutant « en modification, stockSuivi absent gardé au lieu de valoir false » (spread conditionnel), à
    // tuer : un article suivi, modifié sans la clé, ne l'est plus. Tue aussi « clé absente de stockSuivi refusée » (400).
    test('stockSuivi absent : un article créé sans la clé n’est pas suivi en stock ; un article suivi, modifié sans la clé, ne l’est plus (false) ; les autres champs sont écrits ; en session et par clé', async () => {
      for (const { qui, auth, porte } of ECRIVAINS()) {
        const corps = corpsNouvelArticle();
        const cree = await ok(appeler('post', `${porte}/articles`, auth, corps), 201);
        const reluCree = await ficheEnBase('articles', cree.id);
        assert.deepEqual([reluCree.stockSuivi, cree.stockSuivi], [false, false], `${qui}, création sans la clé : non suivi`);
        assert.deepEqual([reluCree.reference, reluCree.nom, reluCree.prixVenteHt, reluCree.stockActuel, reluCree.actif], [corps.reference, ENVOI.nom, '987.65', '42.5', true], `${qui} : article créé`);
        const suivi = await fabriquer('articles', { stockSuivi: true });
        const maj = await ok(appeler('put', `${porte}/articles/${suivi.id}`, auth, corpsFiche('articles', suivi)));
        const relu = await ficheEnBase('articles', suivi.id);
        assert.deepEqual([relu.stockSuivi, maj.stockSuivi], [false, false], `${qui}, modification sans la clé d’un article suivi : le suivi est retiré (T2)`);
        assert.deepEqual([relu.nom, relu.tauxTva, relu.prixVenteHt, relu.stockActuel, relu.unite, relu.actif], [ENVOI.nom, '10', '987.65', '42.5', 'pièce', true], `${qui} : autres champs écrits`);
      }
    });

    // Cadrage, périmètre 4 et « Tests attendus » : « true et false : comportement […] inchangé ».
    test('stockSuivi true et false : posé et retiré à la création comme à la modification, à l’identique compris, en session et par clé', async () => {
      for (const { qui, auth, porte } of ECRIVAINS()) {
        for (const stockSuivi of [true, false]) {
          const cree = await ok(appeler('post', `${porte}/articles`, auth, corpsNouvelArticle({ stockSuivi })), 201);
          assert.deepEqual([(await ficheEnBase('articles', cree.id)).stockSuivi, cree.stockSuivi], [stockSuivi, stockSuivi], `${qui}, création, stockSuivi: ${stockSuivi}`);
        }
        const article = await fabriquer('articles');
        for (const stockSuivi of [true, true, false, false, true]) {
          const maj = await ok(appeler('put', `${porte}/articles/${article.id}`, auth, corpsFiche('articles', article, { stockSuivi })));
          assert.deepEqual([(await ficheEnBase('articles', article.id)).stockSuivi, maj.stockSuivi], [stockSuivi, stockSuivi], `${qui}, modification, stockSuivi: ${stockSuivi}`);
        }
      }
    });

    // Cadrage, périmètre 1 : « Pour les prestations et les équipements, stockSuivi reste ignoré (le champ n'existe pas) ».
    // Tue « contrôle de stockSuivi placé dans les contrôles communs (cataloguePayload ou champsCommunsCatalogue) ».
    test('stockSuivi reste ignoré pour une prestation, une main d’œuvre et un équipement : une valeur non booléenne n’empêche ni la création ni la modification', async () => {
      for (const { qui, auth, porte } of ECRIVAINS()) {
        const prestation = await ok(appeler('post', `${porte}/prestations`, auth, { reference: reference('PRE-STK'), ...ENVOI, ...ENVOI_PROPRES.prestations, stockSuivi: 'false' }), 201);
        const equipement = await ok(appeler('post', `${porte}/equipements`, auth, { reference: reference('EQP-STK'), ...ENVOI, ...ENVOI_PROPRES.equipements, stockSuivi: null }), 201);
        for (const [famille, fiche] of [['prestations', prestation], ['equipements', equipement]]) {
          const relu = await ficheEnBase(famille, fiche.id);
          assert.equal('stockSuivi' in relu, false, `${qui}, ${famille} : pas de suivi de stock`);
          assert.deepEqual([relu.nom, relu.prixVenteHt, relu.actif], [ENVOI.nom, '987.65', true], `${qui}, ${famille} : créée`);
        }
        for (const famille of ['prestations', 'equipements']) {
          const fiche = await fabriquer(famille);
          await ok(appeler('put', `${porte}/${famille}/${fiche.id}`, auth, corpsFiche(famille, fiche, { nom: 'TEST Modifiée malgré stockSuivi', stockSuivi: {} })));
          assert.equal((await ficheEnBase(famille, fiche.id)).nom, 'TEST Modifiée malgré stockSuivi', `${qui}, ${famille} : modifiée`);
        }
      }
      const mo = await creerMainOeuvre();
      await ok(appeler('put', `/api/catalogue/prestations/${mo.id}`, comptes.SA.auth, { ...mo.corps, prixVenteHt: '46.75', stockSuivi: 'oui' }));
      assert.equal((await ficheEnBase('prestations', mo.id)).prixVenteHt, '46.75', 'main d’œuvre modifiée malgré stockSuivi');
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 2. actif (PUT /api/catalogue/:family/:id et sa porte /api/v1 ; trois familles, main d'œuvre comprise)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage, périmètre 2 et 3 ; « Tests attendus » : « modification d'un article, d'un équipement, d'une prestation
    // ordinaire […] (session), et d'un article, d'un équipement et d'une prestation ordinaire par clé ; fiche relue
    // inchangée […] ; empreinte de toute la base ». Avant le lot, « false » réactivait une fiche désactivée et null, 0 ou ""
    // désactivaient une fiche active (#324, N3). L'article envoie aussi un stockSuivi valide (true, la fiche ne l'est pas) :
    // il n'est pas écrit non plus. Tue « `!!` rétabli » (routes.ts et main-oeuvre.ts) et « null admis ».
    test('actif, modification d’un article, d’un équipement ou d’une prestation ordinaire, active ou désactivée : chaque valeur non booléenne, null compris, répond 400 « « actif » doit valoir true ou false. », en session et par clé ; rien n’est écrit, pas même le nom, la TVA ou les prix envoyés avec', async () => {
      for (const famille of FAMILLES) {
        for (const actif of [true, false]) {
          const fiche = await fabriquer(famille, { actif });
          for (const { qui, auth, porte } of ECRIVAINS()) {
            for (const [nom, valeur] of VALEURS_REFUSEES) {
              const corps = corpsFiche(famille, fiche, { ...(famille === 'articles' ? { stockSuivi: true } : {}), actif: valeur });
              await refuse(() => appeler('put', `${porte}/${famille}/${fiche.id}`, auth, corps), 400, REFUS_DRAPEAU('actif'),
                `${qui}, ${famille} ${actif ? 'active' : 'désactivée'}, ${nom}`, () => ficheEnBase(famille, fiche.id));
            }
          }
          const relu = await ficheEnBase(famille, fiche.id);
          assert.deepEqual([relu.actif, relu.nom, relu.tauxTva, relu.prixVenteHt, relu.prixAchatHt, relu.updatedAt],
            [actif, fiche.nom, '5.5', '111.11', '22.22', fiche.updatedAt.toISOString()], `${famille} ${actif ? 'active' : 'désactivée'} : intacte`);
        }
      }
    });

    // Cadrage, périmètre 2 : « sans écriture ni entrée au journal d'administration » ; « Tests attendus » : « d'une main
    // d'œuvre (session) ; […] journal d'administration inchangé (main d'œuvre) ». Avant le lot, null désactivait une main
    // d'œuvre active (entrée DESACTIVATION) et « false » réactivait une main d'œuvre désactivée (entrée REACTIVATION).
    test('actif, modification d’une main d’œuvre active ou désactivée : chaque valeur non booléenne, null compris, répond 400, par le super administrateur, l’administrateur et le directeur ; ni la fiche, ni ses prix, ni le journal d’administration ne changent', async () => {
      for (const actif of [true, false]) {
        const mo = await creerMainOeuvre({ actif });
        const journalAvant = await journalMainOeuvre(mo.id);
        const ficheAvant = await ficheEnBase('prestations', mo.id);
        for (const { qui, auth } of SESSION()) {
          for (const [nom, valeur] of VALEURS_REFUSEES) {
            const corps = { ...mo.corps, ...ENVOI_MO, actif: valeur };
            await refuse(() => appeler('put', `/api/catalogue/prestations/${mo.id}`, auth, corps), 400, REFUS_DRAPEAU('actif'),
              `${qui}, main d’œuvre ${actif ? 'active' : 'désactivée'}, ${nom}`, () => ficheEnBase('prestations', mo.id));
          }
        }
        assert.deepEqual(await journalMainOeuvre(mo.id), journalAvant, 'journal de la main d’œuvre inchangé');
        const relu = await ficheEnBase('prestations', mo.id);
        assert.deepEqual(relu, ficheAvant, 'main d’œuvre intacte');
        assert.deepEqual([relu.actif, relu.estMainOeuvre, relu.prixVenteHt, relu.prixJourHorsContratHt, relu.heuresParJour, relu.prixDemiJourneeHorsContratHt], [actif, true, '45.5', '320', '7.5', null], 'état et prix de départ');
      }
    });

    // Cadrage, périmètre 2 : « Une clé absente garde la valeur actuelle, comme aujourd'hui » ; « Tests attendus » : « Clé
    // absente : actif gardé ». Tue « clé absente de actif lue comme faux » (une fiche active serait désactivée, et une main
    // d'œuvre journalisée DESACTIVATION) et « clé absente lue comme vrai » (une fiche désactivée réactivée).
    test('actif absent : la fiche garde son état, active comme désactivée, et les autres champs sont écrits ; trois familles en session et par clé ; main d’œuvre en session, journalisée MODIFICATION sans actif', async () => {
      for (const famille of FAMILLES) {
        for (const { qui, auth, porte } of ECRIVAINS()) {
          for (const actif of [true, false]) {
            const fiche = await fabriquer(famille, { actif });
            const reponse = await ok(appeler('put', `${porte}/${famille}/${fiche.id}`, auth, corpsFiche(famille, fiche)));
            const relu = await ficheEnBase(famille, fiche.id);
            assert.deepEqual([relu.actif, reponse.actif], [actif, actif], `${qui}, ${famille} ${actif ? 'active' : 'désactivée'} : état gardé`);
            assert.deepEqual([relu.nom, relu.tauxTva, relu.prixVenteHt], [ENVOI.nom, '10', '987.65'], `${qui}, ${famille} : autres champs écrits`);
          }
        }
      }
      for (const { qui, auth } of SESSION()) {
        for (const actif of [true, false]) {
          const mo = await creerMainOeuvre({ actif });
          const reponse = await ok(appeler('put', `/api/catalogue/prestations/${mo.id}`, auth, { ...mo.corps, prixVenteHt: '46.75' }));
          const relu = await ficheEnBase('prestations', mo.id);
          assert.deepEqual([relu.actif, reponse.actif, relu.prixVenteHt], [actif, actif, '46.75'], `${qui}, main d’œuvre ${actif ? 'active' : 'désactivée'} : état gardé, prix écrit`);
          const journal = await journalMainOeuvre(mo.id);
          assert.deepEqual(journal.slice(1), [{ domaine: 'REGLAGES', type: 'MAIN_OEUVRE', action: 'MODIFICATION', cibleId: mo.id, auteurId: comptes[qui].id, avant: { prixVenteHt: 45.5 }, apres: { prixVenteHt: 46.75 } }],
            `${qui}, main d’œuvre ${actif ? 'active' : 'désactivée'} : une entrée MODIFICATION, sans actif`);
        }
      }
    });

    // Cadrage, périmètre 2 et 4 : « true et false : inchangés (désactivation, réactivation, journal de la main d'œuvre) » ;
    // « Tests attendus » : « true et false : comportement et journal inchangés (désactivation, réactivation d'une main
    // d'œuvre) ». Un enregistrement à l'identique n'écrit aucune entrée.
    test('actif true et false : désactivation et réactivation par la modification, à l’identique compris ; trois familles en session et par clé ; main d’œuvre en session avec une entrée DESACTIVATION puis REACTIVATION, et aucune à l’identique', async () => {
      for (const famille of FAMILLES) {
        for (const { qui, auth, porte } of ECRIVAINS()) {
          const fiche = await fabriquer(famille);
          for (const actif of [false, false, true, true, false]) {
            const reponse = await ok(appeler('put', `${porte}/${famille}/${fiche.id}`, auth, corpsFiche(famille, fiche, { actif })));
            assert.deepEqual([(await ficheEnBase(famille, fiche.id)).actif, reponse.actif], [actif, actif], `${qui}, ${famille}, actif: ${actif}`);
          }
        }
      }
      for (const { qui, auth } of SESSION()) {
        const mo = await creerMainOeuvre();
        const entree = (action, avant, apres) => ({ domaine: 'REGLAGES', type: 'MAIN_OEUVRE', action, cibleId: mo.id, auteurId: comptes[qui].id, avant: { actif: avant }, apres: { actif: apres } });
        const attendues = [];
        for (const [actif, action] of [[false, 'DESACTIVATION'], [false, null], [true, 'REACTIVATION'], [true, null]]) {
          const reponse = await ok(appeler('put', `/api/catalogue/prestations/${mo.id}`, auth, { ...mo.corps, actif }));
          assert.deepEqual([(await ficheEnBase('prestations', mo.id)).actif, reponse.actif], [actif, actif], `${qui}, main d’œuvre, actif: ${actif}`);
          if (action) attendues.push(entree(action, !actif, actif));
          assert.deepEqual((await journalMainOeuvre(mo.id)).slice(1), attendues, `${qui}, main d’œuvre, actif: ${actif} : journal`);
        }
      }
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 3. Ordre des refus
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage, périmètre 1 (« avant toute lecture ou écriture en base (400 avant 404, règle actuelle du catalogue) ») et 2
    // (« avant le 404 « Fiche catalogue introuvable. » ») ; « Tests attendus » : « 400 avant 404 (identifiant inconnu,
    // valeur invalide) ». Témoin : un corps valide sur la même fiche inconnue reçoit 404. Avant le lot, « false » ou null
    // répondaient 404. Tue « contrôle placé après la lecture en base (404 avant 400) ».
    test('ordre : sur une fiche inconnue, une valeur non booléenne de actif (trois familles) ou de stockSuivi (article) répond 400, et non 404 ; un corps valide y reçoit 404 « Fiche catalogue introuvable. » ; en session et par clé', async () => {
      for (const famille of FAMILLES) {
        const inconnue = { reference: reference('INCONNUE') };
        for (const { qui, auth, porte } of ECRIVAINS()) {
          const id = randomUUID();
          for (const [nom, valeur] of ECHANTILLON) {
            const corps = corpsFiche(famille, inconnue, { actif: valeur });
            await refuse(() => appeler('put', `${porte}/${famille}/${id}`, auth, corps), 400, REFUS_DRAPEAU('actif'), `${qui}, ${famille} inconnue, actif ${nom}`);
            if (famille === 'articles') {
              const corpsStock = corpsFiche(famille, inconnue, { stockSuivi: valeur });
              await refuse(() => appeler('put', `${porte}/${famille}/${id}`, auth, corpsStock), 400, REFUS_DRAPEAU('stockSuivi'), `${qui}, article inconnu, stockSuivi ${nom}`);
            }
          }
          for (const actif of [true, false, undefined]) {
            const corps = corpsFiche(famille, inconnue, actif === undefined ? {} : { actif });
            await refuse(() => appeler('put', `${porte}/${famille}/${id}`, auth, corps), 404, MESSAGES.ficheIntrouvable, `${qui}, ${famille} inconnue, témoin actif: ${actif}`);
          }
        }
      }
    });

    // Gardes existantes, inchangées, avant le 400 des drapeaux (règle 2 : droits et périmètres) : 401 sans session ou d'un
    // compte désactivé, 403 de requireAdmin pour chaque type de compte hors administration, 401 sans clé et 403 d'une clé
    // sans catalogue:write sur /api/v1, puis 404 d'une famille inconnue, testée avant le corps. Tue « contrôle placé avant
    // les gardes ».
    test('ordre : 401 sans session ou d’un compte désactivé, 403 de chaque type de compte hors administration, 401 sans clé, 403 d’une clé sans catalogue:write et 404 d’une famille inconnue passent avant le 400 des drapeaux ; rien n’est écrit', async () => {
      const article = await fabriquer('articles');
      const equipement = await fabriquer('equipements');
      const prestation = await fabriquer('prestations');
      const mo = await creerMainOeuvre();
      const cas = [
        ['création d’un article, stockSuivi « false »', 'post', '/articles', corpsNouvelArticle({ stockSuivi: 'false' }), null],
        ['article, actif null', 'put', `/articles/${article.id}`, corpsFiche('articles', article, { actif: null }), () => ficheEnBase('articles', article.id)],
        ['article, stockSuivi 0', 'put', `/articles/${article.id}`, corpsFiche('articles', article, { stockSuivi: 0 }), () => ficheEnBase('articles', article.id)],
        ['équipement, actif « true »', 'put', `/equipements/${equipement.id}`, corpsFiche('equipements', equipement, { actif: 'true' }), () => ficheEnBase('equipements', equipement.id)],
        ['prestation, actif {}', 'put', `/prestations/${prestation.id}`, corpsFiche('prestations', prestation, { actif: {} }), () => ficheEnBase('prestations', prestation.id)],
        ['main d’œuvre, actif « false »', 'put', `/prestations/${mo.id}`, { ...mo.corps, actif: 'false' }, () => ficheEnBase('prestations', mo.id)],
      ];
      for (const [quoi, methode, chemin, corps, relire] of cas) {
        await refuse(() => appeler(methode, `/api/catalogue${chemin}`, null, corps), 401, MESSAGES.authentification, `sans session, ${quoi}`, relire);
        await refuse(() => appeler(methode, `/api/catalogue${chemin}`, comptes['AD-DESACTIVE'].auth, corps), 401, MESSAGES.compteDesactive, `administrateur désactivé, ${quoi}`, relire);
        for (const code of HORS_ADMINISTRATION) {
          await refuse(() => appeler(methode, `/api/catalogue${chemin}`, comptes[code].auth, corps), 403, MESSAGES.administrateurs, `${code}, ${quoi}`, relire);
        }
        await refuse(() => appeler(methode, `/api/v1/catalogue${chemin}`, null, corps), 401, MESSAGES.cleRequise, `sans clé, ${quoi}`, relire);
        await refuse(() => appeler(methode, `/api/v1/catalogue${chemin}`, cles.lecture, corps), 403, MESSAGES.scopeEcriture, `clé catalogue:read, ${quoi}`, relire);
        const familleInconnue = chemin.replace(/^\/[a-z]+/, '/stocks');
        for (const { qui, auth, porte } of ECRIVAINS()) {
          await refuse(() => appeler(methode, `${porte}${familleInconnue}`, auth, corps), 404, MESSAGES.familleInconnue, `${qui}, famille inconnue, ${quoi}`, relire);
        }
      }
    });

    // Cadrage, périmètre 2, ordre des prestations : « après le 403 d'une clé qui vise une main d'œuvre par son corps
    // (corpsMainOeuvre) » ; « Tests attendus » : « pour une clé, 403 du corps de main d'œuvre avant le 400 ». Sur une
    // prestation ordinaire, une main d'œuvre existante ou une fiche inconnue. Tue « actif contrôlé en tête de
    // modifierPrestation, avant le refus du corps de main d'œuvre par une clé ».
    test('ordre, clé catalogue:write : un corps qui vise une main d’œuvre (drapeau ou prix propre) reçoit 403, même avec une valeur non booléenne de actif, sur une prestation ordinaire, une main d’œuvre ou une fiche inconnue ; rien n’est écrit', async () => {
      const prestation = await fabriquer('prestations');
      const mo = await creerMainOeuvre();
      const cibles = [['prestation ordinaire', prestation.id, prestation.reference], ['main d’œuvre', mo.id, mo.reference], ['fiche inconnue', randomUUID(), reference('INCONNUE')]];
      for (const [quoi, id, ref] of cibles) {
        const relire = quoi === 'fiche inconnue' ? null : () => ficheEnBase('prestations', id);
        for (const [nom, valeur] of ECHANTILLON) {
          for (const [corpsNom, corps] of [
            ['drapeau estMainOeuvre: true', corpsMainOeuvre(ref, { actif: valeur })],
            ['prix propre (heuresParJour) sans drapeau', { reference: ref, ...ENVOI, heuresParJour: '7', actif: valeur }],
            ['prix de la demi-journée, drapeau false', { reference: ref, ...ENVOI, estMainOeuvre: false, prixDemiJourneeSousContratHt: '150', actif: valeur }],
          ]) {
            await refuse(() => appeler('put', `/api/v1/catalogue/prestations/${id}`, cles.ecriture, corps), 403, MESSAGES.cleMainOeuvre, `clé, ${quoi}, ${corpsNom}, actif ${nom}`, relire);
          }
        }
      }
    });

    // Cadrage, périmètre 2 : avant la transaction, « donc […] avant le 403 d'une clé sur une main d'œuvre existante » (règle
    // de la matrice, « Une clé reçoit 403 sur une main d'œuvre existante […] après la validation du corps », routes.mjs) ;
    // « Tests attendus » : « 400 avant le 403 d'une clé sur une main d'œuvre existante ». Témoins : le même corps, actif
    // valide ou absent, reçoit 403. Avant le lot, « false » ou null répondaient 403. Tue « contrôle placé dans la
    // transaction de modifierPrestation » (après la lecture de la fiche).
    test('ordre, clé catalogue:write : sur une main d’œuvre existante, un corps de prestation ordinaire avec une valeur non booléenne de actif reçoit 400, et non 403 ; avec actif valide ou absent, 403 ; rien n’est écrit', async () => {
      for (const actifDepart of [true, false]) {
        const mo = await creerMainOeuvre({ actif: actifDepart });
        const relire = () => ficheEnBase('prestations', mo.id);
        const corpsOrdinaires = [
          ['sans drapeau', (extra) => ({ reference: mo.reference, ...ENVOI, ...ENVOI_PROPRES.prestations, ...extra })],
          ['drapeau estMainOeuvre: false', (extra) => ({ reference: mo.reference, ...ENVOI, ...ENVOI_PROPRES.prestations, estMainOeuvre: false, ...extra })],
          ['drapeau estMainOeuvre: null', (extra) => ({ reference: mo.reference, ...ENVOI, ...ENVOI_PROPRES.prestations, estMainOeuvre: null, ...extra })],
        ];
        for (const [corpsNom, corps] of corpsOrdinaires) {
          for (const [nom, valeur] of VALEURS_REFUSEES) {
            const envoye = corps({ actif: valeur });
            await refuse(() => appeler('put', `/api/v1/catalogue/prestations/${mo.id}`, cles.ecriture, envoye), 400, REFUS_DRAPEAU('actif'), `clé, main d’œuvre ${actifDepart ? 'active' : 'désactivée'}, ${corpsNom}, actif ${nom}`, relire);
          }
          for (const extra of [{ actif: true }, { actif: false }, {}]) {
            const envoye = corps(extra);
            await refuse(() => appeler('put', `/api/v1/catalogue/prestations/${mo.id}`, cles.ecriture, envoye), 403, MESSAGES.cleMainOeuvre, `clé, main d’œuvre, ${corpsNom}, témoin ${JSON.stringify(extra)}`, relire);
          }
        }
      }
    });

    // Cadrage, périmètre 2 : avant la transaction, « donc […] avant le 409 des rattachements » ; « Tests attendus » : « 400
    // avant le 409 des rattachements (retour en prestation ordinaire d'une main d'œuvre rattachée, avec actif invalide) ».
    // Témoins : actif valide ou absent, 409 au message exact. Avant le lot, « false » ou null répondaient 409. Tue
    // « contrôle placé dans la transaction de modifierPrestation » (après le décompte des rattachements).
    test('ordre : le retour en prestation ordinaire d’une main d’œuvre rattachée, avec une valeur non booléenne de actif, reçoit 400, et non 409 ; avec actif valide ou absent, 409 ; la main d’œuvre, son rattachement et le journal sont intacts', async () => {
      const mo = await creerMainOeuvre();
      const intervenant = await rattacher(mo.id);
      const relire = () => ficheEnBase('prestations', mo.id);
      const retour = (extra) => ({ estMainOeuvre: false, reference: mo.reference, ...ENVOI, ...ENVOI_PROPRES.prestations, ...extra });
      for (const { qui, auth } of SESSION()) {
        for (const [nom, valeur] of VALEURS_REFUSEES) {
          const corps = retour({ actif: valeur });
          await refuse(() => appeler('put', `/api/catalogue/prestations/${mo.id}`, auth, corps), 400, REFUS_DRAPEAU('actif'), `${qui}, main d’œuvre rattachée, actif ${nom}`, relire);
        }
        for (const extra of [{ actif: true }, { actif: false }, {}]) {
          const corps = retour(extra);
          await refuse(() => appeler('put', `/api/catalogue/prestations/${mo.id}`, auth, corps), 409, MESSAGES.rattachee(1), `${qui}, main d’œuvre rattachée, témoin ${JSON.stringify(extra)}`, relire);
        }
      }
      const relu = await ficheEnBase('prestations', mo.id);
      assert.deepEqual([relu.estMainOeuvre, relu.actif], [true, true], 'toujours une main d’œuvre active');
      assert.equal((await prisma.intervenantMainOeuvre.findUnique({ where: { intervenantId: intervenant.id } }))?.prestationId, mo.id, 'rattachement intact');
    });

    // Cadrage, périmètre 1 et 2 : « avant toute lecture en base » ; prestations : « avant la transaction » ; « Tests
    // attendus », mutant « contrôle placé dans la transaction de modifierPrestation ». Une transaction de test tient la ligne
    // de la fiche (SELECT … FOR UPDATE) : une valeur non booléenne reçoit son 400 sans attendre ce verrou, et n'écrit rien ;
    // témoins : un corps valide, lui, attend la ligne verrouillée (constaté par pg_blocking_pids), puis aboutit. Tue un
    // contrôle placé dans la transaction après la lecture verrouillée, même avant le 404, que les tests d'ordre ci-dessus ne
    // distinguent pas.
    test('ordre : le 400 de actif est rendu sans attendre la ligne verrouillée de la fiche (main d’œuvre et prestation ordinaire en session et par clé, article et équipement) ; un corps valide, lui, attend le verrou', async () => {
      const mo = await creerMainOeuvre();
      const prestation = await fabriquer('prestations');
      const article = await fabriquer('articles');
      const equipement = await fabriquer('equipements');
      const TABLES = { prestations: 'CataloguePrestation', articles: 'CatalogueArticle', equipements: 'CatalogueEquipement' };
      const sousVerrou = async (famille, id, lancer, verifier) => {
        let enCours = null;
        try {
          await prisma.$transaction(async (tx) => {
            const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
            await tx.$queryRawUnsafe(`SELECT "id" FROM "${TABLES[famille]}" WHERE "id" = $1 FOR UPDATE`, id);
            enCours = lancer().then((r) => r, (erreur) => ({ status: 'erreur', body: String(erreur) }));
            await verifier(enCours, pid);
          }, { timeout: 30_000, maxWait: 10_000 });
        } finally {
          if (enCours) await enCours;
        }
        return enCours;
      };
      const casRefuses = [
        ['main d’œuvre, super administrateur', 'prestations', mo.id, '/api/catalogue', comptes.SA.auth, { ...mo.corps, actif: 'false' }],
        ['main d’œuvre, directeur', 'prestations', mo.id, '/api/catalogue', comptes.DIR.auth, { ...mo.corps, actif: null }],
        ['main d’œuvre, clé (corps ordinaire)', 'prestations', mo.id, '/api/v1/catalogue', cles.ecriture, corpsFiche('prestations', mo, { actif: 0 })],
        ['prestation ordinaire, administrateur', 'prestations', prestation.id, '/api/catalogue', comptes.AD.auth, corpsFiche('prestations', prestation, { actif: 'true' })],
        ['prestation ordinaire, clé', 'prestations', prestation.id, '/api/v1/catalogue', cles.ecriture, corpsFiche('prestations', prestation, { actif: {} })],
        ['article, clé', 'articles', article.id, '/api/v1/catalogue', cles.ecriture, corpsFiche('articles', article, { actif: '' })],
        ['équipement, super administrateur', 'equipements', equipement.id, '/api/catalogue', comptes.SA.auth, corpsFiche('equipements', equipement, { actif: [] })],
      ];
      for (const [quoi, famille, id, porte, auth, corps] of casRefuses) {
        const avant = await empreinte();
        const ficheAvant = await ficheEnBase(famille, id);
        const journalAvant = await prisma.journalAdministration.count();
        await sousVerrou(famille, id, () => appeler('put', `${porte}/${famille}/${id}`, auth, corps), async (enCours) => {
          const res = await Promise.race([enCours, pause(3000).then(() => null)]);
          assert.ok(res, `${quoi} : la réponse arrive sans attendre la ligne verrouillée`);
          assert.deepEqual([res.status, res.body], [400, { error: REFUS_DRAPEAU('actif') }], quoi);
        });
        assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
        assert.deepEqual(await ficheEnBase(famille, id), ficheAvant, `${quoi} : fiche intacte`);
        assert.equal(await prisma.journalAdministration.count(), journalAvant, `${quoi} : aucune entrée au journal`);
      }
      // Témoins : un corps valide attend la ligne verrouillée, puis aboutit une fois le verrou rendu.
      const casValides = [
        ['main d’œuvre, super administrateur', 'prestations', mo.id, '/api/catalogue', comptes.SA.auth, { ...mo.corps, actif: true }],
        ['article, clé', 'articles', article.id, '/api/v1/catalogue', cles.ecriture, corpsFiche('articles', article, { actif: true })],
      ];
      for (const [quoi, famille, id, porte, auth, corps] of casValides) {
        const enCours = await sousVerrou(famille, id, () => appeler('put', `${porte}/${famille}/${id}`, auth, corps), async (requete, pid) => {
          let attente = false;
          for (let tour = 0; tour < 150 && !attente; tour += 1) {
            attente = (await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`)[0].n > 0;
            if (!attente) await pause(20);
          }
          assert.equal(attente, true, `témoin ${quoi} : la requête attend la ligne verrouillée`);
        });
        assert.equal((await enCours).status, 200, `témoin ${quoi} : aboutit après le verrou`);
      }
    });

    // Cadrage, périmètre 1 : stockSuivi contrôlé « dans catalogueExtraPayload, donc après les contrôles communs de la fiche
    // (référence, nom, TVA, prix de vente) » ; périmètre 2 : actif « après cataloguePayload et catalogueExtraPayload »
    // (articles, équipements) et, pour les prestations, « après estMainOeuvreDemande et les charges utiles ». Tue
    // « stockSuivi contrôlé avant les contrôles communs », « actif contrôlé avant les charges utiles » et « actif contrôlé
    // avant estMainOeuvreDemande ».
    test('ordre des contrôles du corps : la référence, le nom, la TVA et le prix de vente passent avant stockSuivi ; les charges utiles (stockSuivi compris) et estMainOeuvre passent avant actif ; en session et par clé', async () => {
      const article = await fabriquer('articles');
      const equipement = await fabriquer('equipements');
      const prestation = await fabriquer('prestations');
      const mo = await creerMainOeuvre();
      const relireArticle = () => ficheEnBase('articles', article.id);
      for (const { qui, auth, porte } of ECRIVAINS()) {
        const avantStock = [
          ['nom vide', { nom: '' }, MESSAGES.referenceNom],
          ['référence vide', { reference: '' }, MESSAGES.referenceNom],
          ['TVA à 7 %', { tauxTva: '7' }, MESSAGES.tva],
          ['prix de vente négatif', { prixVenteHt: '-1' }, MESSAGES.prixVente],
        ];
        for (const [quoi, ecart, message] of avantStock) {
          for (const [nom, valeur] of [['« false »', 'false'], ['null', null]]) {
            const creation = corpsNouvelArticle({ ...ecart, stockSuivi: valeur });
            await refuse(() => appeler('post', `${porte}/articles`, auth, creation), 400, message, `${qui}, création, ${quoi} et stockSuivi ${nom}`);
            const modification = corpsFiche('articles', article, { ...ecart, stockSuivi: valeur });
            await refuse(() => appeler('put', `${porte}/articles/${article.id}`, auth, modification), 400, message, `${qui}, modification, ${quoi} et stockSuivi ${nom}`, relireArticle);
            const avecActif = corpsFiche('articles', article, { ...ecart, actif: valeur });
            await refuse(() => appeler('put', `${porte}/articles/${article.id}`, auth, avecActif), 400, message, `${qui}, article, ${quoi} et actif ${nom}`, relireArticle);
            const equipementActif = corpsFiche('equipements', equipement, { ...ecart, actif: valeur });
            await refuse(() => appeler('put', `${porte}/equipements/${equipement.id}`, auth, equipementActif), 400, message, `${qui}, équipement, ${quoi} et actif ${nom}`, () => ficheEnBase('equipements', equipement.id));
            const prestationActif = corpsFiche('prestations', prestation, { ...ecart, actif: valeur });
            await refuse(() => appeler('put', `${porte}/prestations/${prestation.id}`, auth, prestationActif), 400, message, `${qui}, prestation, ${quoi} et actif ${nom}`, () => ficheEnBase('prestations', prestation.id));
          }
        }
        // stockSuivi (charge utile de l'article) avant actif.
        const lesDeux = corpsFiche('articles', article, { stockSuivi: 'oui', actif: 'false' });
        await refuse(() => appeler('put', `${porte}/articles/${article.id}`, auth, lesDeux), 400, REFUS_DRAPEAU('stockSuivi'), `${qui}, stockSuivi et actif invalides`, relireArticle);
      }
      for (const { qui, auth } of SESSION()) {
        // estMainOeuvre (lu par estMainOeuvreDemande) avant actif ; en session seulement : par clé, un drapeau autre
        // qu'absent ou faux vise une main d'œuvre et reçoit le 403 du corps (test précédent sur l'ordre des clés).
        const drapeau = corpsFiche('prestations', prestation, { estMainOeuvre: 'oui', actif: 'false' });
        await refuse(() => appeler('put', `/api/catalogue/prestations/${prestation.id}`, auth, drapeau), 400, MESSAGES.estMainOeuvre, `${qui}, estMainOeuvre et actif invalides`, () => ficheEnBase('prestations', prestation.id));
        // Main d'œuvre : un prix refusé passe avant actif.
        const corps = { ...mo.corps, prixVenteHt: '-5', actif: 'false' };
        await refuse(() => appeler('put', `/api/catalogue/prestations/${mo.id}`, auth, corps), 400, MESSAGES.prixHeureHorsContrat, `${qui}, main d’œuvre, prix et actif invalides`, () => ficheEnBase('prestations', mo.id));
      }
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 4. estMainOeuvre: null, hors périmètre, gardé (cadrage v2, N1 et T5)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, N1 : « estMainOeuvre: null, lu comme une clé absente et admis (main-oeuvre.ts:61 et :70, routes.ts:69 et
    // :88) » reste hors périmètre ; T5 : « non-régression : estMainOeuvre: null reste lu comme une clé absente ». Témoin :
    // true sur un article reste refusé. Combiné à une valeur non booléenne de actif, le 400 est celui de actif. Tue
    // « estMainOeuvre lu à son tour en booléen strict (null refusé) ».
    test('non-régression : estMainOeuvre: null reste lu comme une clé absente, à la création et à la modification des trois familles, main d’œuvre comprise, en session et par clé ; avec une valeur non booléenne de actif, le 400 est celui de actif', async () => {
      for (const { qui, auth, porte } of ECRIVAINS()) {
        const prestation = await ok(appeler('post', `${porte}/prestations`, auth, { reference: reference('PRE-NULL'), ...ENVOI, ...ENVOI_PROPRES.prestations, estMainOeuvre: null }), 201);
        assert.equal((await ficheEnBase('prestations', prestation.id)).estMainOeuvre, false, `${qui} : prestation ordinaire créée`);
        for (const famille of ['articles', 'equipements']) {
          const creee = await ok(appeler('post', `${porte}/${famille}`, auth, { reference: reference('NULL'), ...ENVOI, ...ENVOI_PROPRES[famille], estMainOeuvre: null }), 201);
          assert.equal((await ficheEnBase(famille, creee.id)).nom, ENVOI.nom, `${qui}, ${famille} : créée`);
          const corpsVrai = { reference: reference('VRAI'), ...ENVOI, ...ENVOI_PROPRES[famille], estMainOeuvre: true };
          await refuse(() => appeler('post', `${porte}/${famille}`, auth, corpsVrai), 400, MESSAGES.seulePrestation, `${qui}, ${famille}, témoin estMainOeuvre: true`);
        }
        for (const famille of FAMILLES) {
          const fiche = await fabriquer(famille);
          await ok(appeler('put', `${porte}/${famille}/${fiche.id}`, auth, corpsFiche(famille, fiche, { estMainOeuvre: null })));
          const relu = await ficheEnBase(famille, fiche.id);
          assert.deepEqual([relu.nom, relu.actif], [ENVOI.nom, true], `${qui}, ${famille} : modifiée`);
          if (famille === 'prestations') assert.equal(relu.estMainOeuvre, false, `${qui} : reste une prestation ordinaire`);
          const corpsActif = corpsFiche(famille, fiche, { estMainOeuvre: null, actif: 'false' });
          await refuse(() => appeler('put', `${porte}/${famille}/${fiche.id}`, auth, corpsActif), 400, REFUS_DRAPEAU('actif'), `${qui}, ${famille}, estMainOeuvre null et actif « false »`, () => ficheEnBase(famille, fiche.id));
        }
      }
      for (const { qui, auth } of SESSION()) {
        const mo = await creerMainOeuvre();
        await ok(appeler('put', `/api/catalogue/prestations/${mo.id}`, auth, { ...mo.corps, estMainOeuvre: null, prixVenteHt: '46.75' }));
        const relu = await ficheEnBase('prestations', mo.id);
        assert.deepEqual([relu.estMainOeuvre, relu.prixVenteHt, relu.actif], [true, '46.75', true], `${qui} : reste une main d’œuvre, prix écrit`);
        const corps = { ...mo.corps, estMainOeuvre: null, actif: null };
        await refuse(() => appeler('put', `/api/catalogue/prestations/${mo.id}`, auth, corps), 400, REFUS_DRAPEAU('actif'), `${qui}, main d’œuvre, estMainOeuvre null et actif null`, () => ficheEnBase('prestations', mo.id));
      }
    });

    // Cadrage, « Constat » : « Les écrans envoient toujours des booléens […] Catalogue.tsx:119 : la réactivation renvoie la
    // fiche entière lue (...fiche, dont stockSuivi booléen pour un article) avec actif: true » ; « Aucun écran ne change ».
    // Le corps réel de l'écran (fiche relue par GET /api/catalogue/:family, categorieId vide ramené à null, actif: true)
    // aboutit pour les trois familles, et un article suivi en stock le reste.
    test('non-régression de l’écran du catalogue : la réactivation, qui renvoie la fiche entière relue avec actif: true, aboutit pour un article suivi en stock, un équipement et une prestation, par chacun des trois comptes de l’administration ; le suivi du stock est gardé', async () => {
      for (const { qui, auth } of SESSION()) {
        for (const famille of FAMILLES) {
          const fiche = await fabriquer(famille, { actif: false, ...(famille === 'articles' ? { stockSuivi: true } : {}) });
          const lue = (await ok(appeler('get', `/api/catalogue/${famille}`, auth))).find((f) => f.id === fiche.id);
          assert.ok(lue, `${qui}, ${famille} : fiche relue par l’écran`);
          const corps = { ...lue, categorieId: lue.categorieId || null, actif: true };
          const reponse = await ok(appeler('put', `/api/catalogue/${famille}/${fiche.id}`, auth, corps));
          const relu = await ficheEnBase(famille, fiche.id);
          assert.deepEqual([relu.actif, reponse.actif, relu.nom, relu.prixVenteHt, relu.prixAchatHt, relu.tauxTva], [true, true, fiche.nom, '111.11', '22.22', '5.5'], `${qui}, ${famille} : réactivée, fiche gardée`);
          if (famille === 'articles') assert.deepEqual([relu.stockSuivi, reponse.stockSuivi, relu.stockActuel], [true, true, '3.25'], `${qui} : l’article reste suivi en stock`);
        }
      }
    });
  });
}
