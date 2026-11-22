// Lot U, fin de #394 (saisies décimales encore en `type="number"`) et #135 point 3 (cadrage v2 du 22-11-2026, après le contrôle
// de cohérence sur fcc6708, « Inventaire complet », points 4 et 5, « Critères, champ par champ » et « Tests » ; messages de
// Nelson du 16-11-2026, « continu avec les issu. », et du 20-11-2026, « Ordre : fait les correctif d'issu d'abord » ; ordre
// du 19-10-2026 : un correctif qui touche un montant passe avant un lot). Règle 2 de la méthode : montants (classés C).
//
// Ce que le lot change côté serveur, et que ce fichier prouve par des requêtes HTTP réelles sur une base PostgreSQL jetable :
//  - catalogue (point 5) : prix de vente et prix d'achat (10 chiffres, 2 décimales), stock d'un article (9 chiffres,
//    3 décimales) et TVA (3 chiffres, 2 décimales, puis un taux français) lus par nombreDecimalNonNegatif, en session
//    (super administrateur, administrateur, directeur : requireAdmin) et par clé catalogue:write (/api/v1, contrat plus
//    restrictif, à écrire dans la PR) ; avant le lot, `Number` refusait « 18,75 » et admettait « 1e3 », « 12.345 » (que
//    PostgreSQL arrondissait sans le dire), true (1) ou [] (0) ; la TVA « 5,5 » d'une main d'œuvre, refusée, est admise ;
//    valeurs absentes ou vides au comportement actuel (prix 0, TVA absente 20 et vide refusée, prix d'achat vide null, stock 0) ;
//  - rémunération (point 4, PUT /api/parametres/remuneration, super administrateur) : objectifs et primes (10 chiffres,
//    2 décimales, montantPositif), plafond d'une tranche (10 chiffres, 2 décimales, strictement positif) et taux d'une
//    tranche (3 chiffres, 2 décimales, au plus 100) lus par nombreDecimalNonNegatif ; objectifs et primes vides à 0, plafond
//    vide sans plafond ; taux de tranche vide ou null refusé (choix par défaut, à confirmer ; avant le lot, lu 0 %, et l'écran,
//    en convertissant « 12,5 » par `Number`, l'envoyait null : C2 du contrôle de cohérence) ; l'entrée REMUNERATION du
//    journal d'administration a la même forme qu'une saisie au point.
//  - heures (#135 point 3 ; N2 de l'audit des droits de #658) : POST /api/heures répond en français à un intervenant
//    inconnu (404 « Intervenant introuvable. », sans écriture), message désormais affiché par l'écran Heures.
// Chaque refus : statut et corps exacts, aucune écriture dans toute la base (empreinte de chaque table du schéma public,
// contenu compris, hors dernière utilisation d'une clé notée sans attente par /api/v1), fiche ou réglage relu identique et
// journal d'administration inchangé.
//
// Montants : chaque valeur est choisie pour qu'une autre lecture plausible donne un autre résultat ; la lecture écartée est
// écrite en commentaire de chaque test.
//
// Fichier propre au lot, avec sa base jetable (modèle : catalogue-booleens.test.mjs) : `node --test` exécute les fichiers en
// parallèle, api.test.mjs purge les données « TEST » de TEST_DATABASE_URL et règle la rémunération, un singleton.
// TEST_DATABASE_URL ne sert ici que de connexion administrative : une base neuve est créée, migrée, servie à l'application
// montée en mémoire, puis supprimée. Sans TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { empreinteBase, tablesChangees, tablesDeLaBase } from './matrice-droits/outils.mjs';

const TITRE = 'Lot U (#394) : saisies décimales du catalogue et de la rémunération lues à la virgule';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MESSAGES = {
  authentification: 'Authentification requise',
  sessionInvalide: 'Session expirée ou invalide',
  administrateurs: 'Accès réservé aux administrateurs',
  superAdministrateur: 'Accès réservé au super administrateur',
  scopeEcriture: 'Scope requis : catalogue:write',
  prixVente: 'Prix de vente invalide.',
  prixAchat: 'Prix d\'achat invalide.',
  stock: 'Stock invalide.',
  // Tout taux de TVA refusé, mal formé, vide ou non français, reçoit le message des taux admis (choix par défaut
  // de Claude Code, à confirmer ; message déjà testé par #324, N1, pour « 5.555 » et « 1000 »).
  tva: 'Taux de TVA non accepté : 0 %, 5,5 %, 10 % ou 20 %.',
  duree: 'Durée indicative invalide.',
  cleMainOeuvre: 'Une clé d’intégration ne crée, ne modifie, ne désactive ni ne réactive une main d’œuvre, et ne fait pas passer une prestation en main d’œuvre ou l’inverse : réservé à l’administration, en session.',
  montant: (champ) => `${champ} : montant invalide.`,
  taux: (bareme, rang) => `${bareme}, tranche ${rang} : le taux doit être compris entre 0 et 100, deux décimales au plus.`,
  plafond: (bareme, rang) => `${bareme}, tranche ${rang} : le plafond doit être un montant positif, deux décimales au plus, ou vide pour la dernière tranche.`,
};

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_saisies394_${randomBytes(6).toString('hex')}`;
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
    const reference = (code) => `TEST-394-${code}-${suffixe()}`;
    const creerCompte = async (code, role) => {
      const s = suffixe();
      const compte = await prisma.user.create({ data: { email: `saisies394.${code.toLowerCase()}.${s}@iris.test`, name: `TEST ${code} 394 ${s}`, role } });
      comptes[code] = { ...compte, auth: entete(jwt.sign({ id: compte.id }, process.env.JWT_SECRET)) };
      return comptes[code];
    };
    // Les trois types de compte de l'administration (requireAdmin : super administrateur, administrateur et directeur,
    // décision du 24-10-2026, point 14), puis la clé catalogue:write sur /api/v1.
    const SESSION = () => ['SA', 'AD', 'DIR'].map((qui) => ({ qui, auth: comptes[qui].auth, porte: '/api/catalogue', cle: false }));
    const ECRIVAINS = () => [...SESSION(), { qui: 'clé catalogue:write', auth: cles.ecriture, porte: '/api/v1/catalogue', cle: true }];

    // --- État de la base ---
    const empreinte = () => empreinteBase(prisma, tables, { colonnesIgnorees: { ApiAccessKey: ['dernierUsageLe'] } });
    const modele = (famille) => ({ articles: prisma.catalogueArticle, equipements: prisma.catalogueEquipement, prestations: prisma.cataloguePrestation })[famille];
    // Relu en base, décimaux en chaînes (Decimal de Prisma) : la valeur enregistrée exactement, sans conversion en nombre.
    const ficheEnBase = async (famille, id) => JSON.parse(JSON.stringify(await modele(famille).findUnique({ where: { id } })));
    const reglesEnBase = async () => JSON.parse(JSON.stringify(await prisma.parametresRemuneration.findUnique({ where: { id: 'singleton' } })));
    const journal = async (type, cibleId) => (await prisma.journalAdministration.findMany({ where: { type, ...(cibleId ? { cibleId } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }))
      .map(({ domaine, type: t, action, cibleId: id, auteurId, avant, apres }) => ({ domaine, type: t, action, cibleId: id, auteurId, avant, apres }));

    // Un refus : statut et corps exacts ; aucune écriture dans toute la base ; la donnée relue identique (`updatedAt`
    // compris) ; aucune entrée nouvelle au journal d'administration.
    const refuse = async (envoi, statut, attendu, quoi, relire = null) => {
      const avant = await empreinte();
      const relueAvant = relire ? await relire() : null;
      const journalAvant = await prisma.journalAdministration.count();
      const res = await envoi();
      assert.equal(res.status, statut, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, typeof attendu === 'string' ? { error: attendu } : attendu, quoi);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      if (relire) assert.deepEqual(await relire(), relueAvant, `${quoi} : donnée relue en base identique`);
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

    // --- Données du catalogue ---
    // Valeurs de départ des fiches, distinctes de toute valeur envoyée : une écriture, même partielle, se voit.
    const DEPART = { tauxTva: '20', prixVenteHt: '111.11', prixAchatHt: '22.22' };
    const DEPART_PROPRES = { articles: { unite: 'mètre', stockActuel: '3.25' }, equipements: { fabricant: 'TEST Fabricant 394' }, prestations: { unite: 'forfait' } };
    const fabriquer = (famille, extra = {}) => modele(famille).create({ data: {
      reference: reference(famille.slice(0, 3).toUpperCase()), nom: `TEST ${famille} de départ 394 ${suffixe()}`, ...DEPART, ...DEPART_PROPRES[famille], ...extra,
    } });
    // Corps valide, à la virgule, distinct des valeurs de départ (un refus qui écrirait le reste se verrait).
    const ENVOI = { nom: 'TEST Nom envoyé 394', tauxTva: '10', prixVenteHt: '987,65', prixAchatHt: '123,45' };
    const ENVOI_PROPRES = { articles: { unite: 'pièce', stockActuel: '42,5' }, equipements: { fabricant: 'TEST Fabricant envoyé 394' }, prestations: { unite: 'heure' } };
    const corpsFiche = (famille, ref, extra = {}) => ({ reference: ref, ...ENVOI, ...ENVOI_PROPRES[famille], ...extra });
    const PRIX_MO = { prixVenteHt: '45,50', prixJourHorsContratHt: '320', prixHeureSousContratHt: '40', prixJourSousContratHt: '280,25', heuresParJour: '7,5' };
    const corpsMainOeuvre = (ref, extra = {}) => ({ estMainOeuvre: true, reference: ref, nom: `TEST Main d’œuvre ${ref}`, tauxTva: '20', ...PRIX_MO, ...extra });

    // --- Données de la rémunération ---
    const LIBELLE = 'TEST Barème réduit 394';
    // État de départ, posé par la route avec des nombres : distinct de chaque valeur envoyée ensuite.
    const DEPART_REMUNERATION = {
      baremeStandard: [{ plafond: 1000, taux: 10 }, { plafond: null, taux: 20 }], baremeReduit: [{ plafond: null, taux: 5 }], libelleBaremeReduit: LIBELLE,
      objectifCaMensuel: 500, primeObjectifCa: 50, objectifMargeMensuel: 300, primeObjectifMarge: 30, primeSuiviAdministratif: 20,
    };
    const poserDepartRemuneration = () => ok(appeler('put', '/api/parametres/remuneration', comptes.SA.auth, DEPART_REMUNERATION));
    // Corps valide, à la virgule (cadrage v2, critère « Rémunération » : objectif « 1250,50 », tranche « 1500,50 » / « 12,5 »).
    const corpsRemuneration = (extra = {}) => ({
      baremeStandard: [{ plafond: '1500,50', taux: '12,5' }, { plafond: '', taux: '20' }],
      baremeReduit: [{ plafond: '800,25', taux: '7,25' }, { plafond: null, taux: '15' }],
      libelleBaremeReduit: LIBELLE,
      objectifCaMensuel: '1250,50', primeObjectifCa: '0,01', objectifMargeMensuel: '9999999999,99', primeObjectifMarge: '100', primeSuiviAdministratif: '',
      ...extra,
    });

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
      await creerCompte('COM', 'COMMERCIAL');
      await creerCompte('CT', 'CONDUCTEUR_TRAVAUX');
      // Clés créées par l'administration (journalisées), avant la première empreinte.
      for (const [nom, scopes] of [['ecriture', ['catalogue:read', 'catalogue:write']], ['lecture', ['catalogue:read']]]) {
        const creation = await ok(appeler('post', '/api/admin/api-keys', comptes.SA.auth, { nom: `TEST Clé catalogue 394 ${nom} ${suffixe()}`, scopes }), 201);
        cles[nom] = entete(creation.apiKey);
      }
      // Réglages créés à leur première lecture : avant la première empreinte.
      await ok(appeler('get', '/api/parametres', comptes.SA.auth));
      tables = await tablesDeLaBase(prisma);
      assert.ok(['CatalogueArticle', 'CatalogueEquipement', 'CataloguePrestation', 'ParametresRemuneration', 'JournalAdministration', 'ApiAccessKey'].every((t) => tables.includes(t)) && tables.length > 40, `tables relevées : ${tables.join(', ')}`);
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
    // 1. Catalogue : POST /api/catalogue/:family et PUT /api/catalogue/:family/:id, et leur porte /api/v1 (catalogue:write)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, point 5 et critère « Catalogue prix « 18,75 », prix d'achat « 1250,50 », TVA « 5,5 », stock « 1,5 » →
    // 18,75 ; 1 250,50 ; 5,5 ; 1,5 ». Lectures écartées : `Number` d'avant le lot (« 18,75 » refusé en 400 « Prix de vente
    // invalide. ») ; la virgule ignorée (1875, 125050, 55 refusé comme TVA non française, 15) ; la lecture arrêtée à la
    // virgule (`parseFloat` : 18, 1250, 5 refusé, 1) ; le stock au centième (1,5 inchangé, mais le test « 0,125 » plus bas
    // l'écarte). La réponse d'une clé sans finances:read masque le prix d'achat (ficheCataloguePourLecteur) : il est relu en
    // base.
    test('catalogue, création à la virgule : article à « 18,75 », prix d’achat « 1250,50 », TVA « 5,5 » et stock « 1,5 » enregistrés à 18,75, 1 250,50, 5,5 et 1,5 ; équipement et prestation de même ; par le super administrateur, l’administrateur, le directeur et une clé catalogue:write', async () => {
      for (const { qui, auth, porte, cle } of ECRIVAINS()) {
        const corps = { reference: reference('ART-V'), nom: `TEST Article virgule ${qui}`, unite: 'm', prixVenteHt: '18,75', prixAchatHt: '1250,50', tauxTva: '5,5', stockActuel: '1,5' };
        const cree = await ok(appeler('post', `${porte}/articles`, auth, corps), 201);
        assert.deepEqual([cree.prixVenteHt, cree.tauxTva, cree.stockActuel], [18.75, 5.5, 1.5], `${qui} : réponse`);
        assert.equal(cree.prixAchatHt, cle ? undefined : 1250.5, `${qui} : prix d’achat de la réponse (masqué pour une clé sans finances:read)`);
        const relu = await ficheEnBase('articles', cree.id);
        assert.deepEqual([relu.prixVenteHt, relu.prixAchatHt, relu.tauxTva, relu.stockActuel], ['18.75', '1250.5', '5.5', '1.5'], `${qui} : article relu en base`);
        for (const famille of ['equipements', 'prestations']) {
          const autre = await ok(appeler('post', `${porte}/${famille}`, auth, { reference: reference(`${famille.slice(0, 3).toUpperCase()}-V`), nom: `TEST ${famille} virgule ${qui}`, prixVenteHt: '18,75', prixAchatHt: '1250,50', tauxTva: '5,5' }), 201);
          const reluAutre = await ficheEnBase(famille, autre.id);
          assert.deepEqual([reluAutre.prixVenteHt, reluAutre.prixAchatHt, reluAutre.tauxTva], ['18.75', '1250.5', '5.5'], `${qui}, ${famille} : relue en base`);
        }
      }
    });

    // Cadrage v2, point 5, en modification (le PUT remplace la fiche) ; le point et le nombre JSON, envoyés par l'écran de
    // réactivation et par les intégrations, restent admis (non-régression). Valeurs : « 1234,56 » (lectures écartées :
    // 123456, 1234), « 0,01 » (0, 1, ou null si la virgule rendait le champ vide), « 0,125 » de stock (125, 0, ou 0,13 arrondi
    // au centième par une colonne ou une lecture à deux décimales), « 10 » de TVA ; puis 18.75, 1250.5, 5.5 et 1.5 en nombres
    // JSON, et « 7.5 », « 99.9 », « 0.5 », « 2.375 » au point.
    test('catalogue, modification : « 1234,56 », « 0,01 », TVA « 10 » et stock « 0,125 » enregistrés exactement ; le nombre JSON et le point restent admis ; en session et par clé, pour les trois familles', async () => {
      for (const { qui, auth, porte } of ECRIVAINS()) {
        const article = await fabriquer('articles');
        await ok(appeler('put', `${porte}/articles/${article.id}`, auth, { reference: article.reference, nom: article.nom, prixVenteHt: '1234,56', prixAchatHt: '0,01', tauxTva: '10', stockActuel: '0,125' }));
        let relu = await ficheEnBase('articles', article.id);
        assert.deepEqual([relu.prixVenteHt, relu.prixAchatHt, relu.tauxTva, relu.stockActuel], ['1234.56', '0.01', '10', '0.125'], `${qui} : virgule`);
        await ok(appeler('put', `${porte}/articles/${article.id}`, auth, { reference: article.reference, nom: article.nom, prixVenteHt: 18.75, prixAchatHt: 1250.5, tauxTva: 5.5, stockActuel: 1.5 }));
        relu = await ficheEnBase('articles', article.id);
        assert.deepEqual([relu.prixVenteHt, relu.prixAchatHt, relu.tauxTva, relu.stockActuel], ['18.75', '1250.5', '5.5', '1.5'], `${qui} : nombres JSON`);
        await ok(appeler('put', `${porte}/articles/${article.id}`, auth, { reference: article.reference, nom: article.nom, prixVenteHt: '7.5', prixAchatHt: '99.9', tauxTva: '0', stockActuel: '2.375' }));
        relu = await ficheEnBase('articles', article.id);
        assert.deepEqual([relu.prixVenteHt, relu.prixAchatHt, relu.tauxTva, relu.stockActuel], ['7.5', '99.9', '0', '2.375'], `${qui} : point`);
        for (const famille of ['equipements', 'prestations']) {
          const fiche = await fabriquer(famille);
          await ok(appeler('put', `${porte}/${famille}/${fiche.id}`, auth, { reference: fiche.reference, nom: fiche.nom, prixVenteHt: '1234,56', prixAchatHt: '0,01', tauxTva: '5,5' }));
          const reluAutre = await ficheEnBase(famille, fiche.id);
          assert.deepEqual([reluAutre.prixVenteHt, reluAutre.prixAchatHt, reluAutre.tauxTva], ['1234.56', '0.01', '5.5'], `${qui}, ${famille} : virgule`);
        }
      }
    });

    // Bornes des colonnes (cadrage v2, point 5 : prix 10 chiffres et 2 décimales, Decimal(12, 2) ; stock 9 et 3,
    // Decimal(12, 3) ; TVA 3 et 2) : le plafond de chaque colonne est admis, zéro aussi (prix de vente, prix d'achat, stock),
    // et des zéros de tête ne comptent pas comme une valeur différente (« 0018,75 », comme « 0042,50 » du taux horaire, #443).
    // Lectures écartées : une borne plus étroite que la colonne (9 chiffres pour un prix, 8 pour le stock, 2 décimales pour le
    // stock) ; un prix d'achat « 0 » lu absent (null) au lieu de gratuit.
    test('catalogue, bornes des colonnes admises : prix et prix d’achat « 9999999999,99 », stock « 999999999,999 », TVA « 20,00 », zéros et zéros de tête', async () => {
      for (const { qui, auth, porte } of ECRIVAINS()) {
        const maxi = await ok(appeler('post', `${porte}/articles`, auth, { reference: reference('ART-MAX'), nom: 'TEST Article bornes', prixVenteHt: '9999999999,99', prixAchatHt: '9999999999.99', tauxTva: '20,00', stockActuel: '999999999,999' }), 201);
        let relu = await ficheEnBase('articles', maxi.id);
        assert.deepEqual([relu.prixVenteHt, relu.prixAchatHt, relu.tauxTva, relu.stockActuel], ['9999999999.99', '9999999999.99', '20', '999999999.999'], `${qui} : plafonds`);
        const zero = await ok(appeler('post', `${porte}/articles`, auth, { reference: reference('ART-ZERO'), nom: 'TEST Article zéros', prixVenteHt: '0', prixAchatHt: '0,00', tauxTva: '0', stockActuel: '0,000' }), 201);
        relu = await ficheEnBase('articles', zero.id);
        assert.deepEqual([relu.prixVenteHt, relu.prixAchatHt, relu.tauxTva, relu.stockActuel], ['0', '0', '0', '0'], `${qui} : zéros (prix d’achat gratuit, et non absent)`);
        const tete = await ok(appeler('post', `${porte}/articles`, auth, { reference: reference('ART-TETE'), nom: 'TEST Article zéros de tête', prixVenteHt: '0018,75', prixAchatHt: '01250,50', tauxTva: '05,5', stockActuel: '001,5' }), 201);
        relu = await ficheEnBase('articles', tete.id);
        assert.deepEqual([relu.prixVenteHt, relu.prixAchatHt, relu.tauxTva, relu.stockActuel], ['18.75', '1250.5', '5.5', '1.5'], `${qui} : zéros de tête`);
        // TVA à trois chiffres avant la virgule, zéros de tête compris (cadrage v2, point 5 : « TVA 3 et 2 » ; motif de l'écran
        // MOTIF_TVA_DEVIS, trois chiffres ; avant le lot, `Number` lisait « 020 » à 20 %). Lecture écartée : une TVA lue à deux
        // chiffres (« un taux français a au plus deux chiffres »), qui refuserait ces saisies (audit des montants de #658, S11).
        for (const [saisie, attendu] of [['020', '20'], ['005,5', '5.5'], ['010.00', '10']]) {
          const fiche = await ok(appeler('post', `${porte}/equipements`, auth, { reference: reference('EQP-TVA3'), nom: 'TEST TVA à trois chiffres', tauxTva: saisie, prixVenteHt: '1' }), 201);
          assert.equal((await ficheEnBase('equipements', fiche.id)).tauxTva, attendu, `${qui} : TVA « ${saisie} »`);
        }
      }
    });

    // Cadrage v2, section « Tests » : « notation scientifique refusée, décimale en trop refusée (3 pour un prix, 4 pour le
    // stock), 11 chiffres refusés, négatif refusé ; chaque refus sans écriture ». S'y ajoutent les formes que `Number`
    // admettait avant le lot et que la règle commune refuse (true lu 1, [] lu 0, blancs internes, unité). Chaque champ porte
    // son propre message (`${champ} invalide.`) ; une TVA refusée, mal formée (« 5,555 », « 1e1 », « 1000 ») comme non
    // française (« 19,6 », « 5,6 »), reçoit le message des taux admis (choix par défaut de Claude Code, à confirmer).
    // Lectures écartées : « 1e3 » lu 1000 ; « 18,755 » ou « 12,345 » arrondis par PostgreSQL à 18,76 ou 12,35
    // (Decimal(12, 2)) ; « 1,2345 » arrondi à 1,235 ; 11 chiffres tronqués ou refusés par la base (500) ; « -1 » admis ;
    // true lu 1 ; « 1e1 » lu 10 % (admis avant le lot) ; une TVA mal formée au message du champ (« TVA invalide. », mutant
    // joué) ; « 5,500 » et « 20.000 », taux français écrits à trois décimales, écartent une TVA lue à trois décimales (comme le
    // stock), que « 5,555 », refusé de toute façon comme taux non français, ne distingue pas ; une TVA lue à deux chiffres est
    // écartée par « 020 » et « 005,5 », admis dans le test des bornes (audit des montants de #658, S11 et S12).
    const REFUS_CATALOGUE = [
      ['prixVenteHt', '1e3', MESSAGES.prixVente], ['prixVenteHt', '1E3', MESSAGES.prixVente], ['prixVenteHt', 1e-7, MESSAGES.prixVente],
      ['prixVenteHt', 1e21, MESSAGES.prixVente], ['prixVenteHt', '18,755', MESSAGES.prixVente], ['prixVenteHt', '18.755', MESSAGES.prixVente],
      ['prixVenteHt', 18.755, MESSAGES.prixVente], ['prixVenteHt', '12345678901', MESSAGES.prixVente], ['prixVenteHt', '12345678901,5', MESSAGES.prixVente],
      ['prixVenteHt', '-1', MESSAGES.prixVente], ['prixVenteHt', -0.01, MESSAGES.prixVente], ['prixVenteHt', '18,75 €', MESSAGES.prixVente],
      ['prixVenteHt', '1 000', MESSAGES.prixVente], ['prixVenteHt', '18,7,5', MESSAGES.prixVente], ['prixVenteHt', 'abc', MESSAGES.prixVente],
      ['prixVenteHt', true, MESSAGES.prixVente], ['prixVenteHt', [], MESSAGES.prixVente], ['prixVenteHt', {}, MESSAGES.prixVente],
      ['prixAchatHt', '1e3', MESSAGES.prixAchat], ['prixAchatHt', '12,345', MESSAGES.prixAchat], ['prixAchatHt', '12345678901', MESSAGES.prixAchat],
      ['prixAchatHt', '-5', MESSAGES.prixAchat], ['prixAchatHt', true, MESSAGES.prixAchat],
      ['tauxTva', '5,555', MESSAGES.tva], ['tauxTva', '5.555', MESSAGES.tva], ['tauxTva', '1e1', MESSAGES.tva], ['tauxTva', '-5,5', MESSAGES.tva],
      ['tauxTva', '1000', MESSAGES.tva], ['tauxTva', true, MESSAGES.tva], ['tauxTva', 'abc', MESSAGES.tva], ['tauxTva', '19,6', MESSAGES.tva],
      ['tauxTva', '5,6', MESSAGES.tva], ['tauxTva', '55', MESSAGES.tva], ['tauxTva', '100', MESSAGES.tva], ['tauxTva', '', MESSAGES.tva],
      ['tauxTva', '   ', MESSAGES.tva], ['tauxTva', '5,500', MESSAGES.tva], ['tauxTva', '20.000', MESSAGES.tva],
    ];
    const REFUS_STOCK = [
      ['stockActuel', '1e3', MESSAGES.stock], ['stockActuel', '1,2345', MESSAGES.stock], ['stockActuel', '1234567890', MESSAGES.stock],
      ['stockActuel', '-1', MESSAGES.stock], ['stockActuel', '1,5 m', MESSAGES.stock], ['stockActuel', [], MESSAGES.stock],
    ];
    const libelleValeur = (valeur) => (typeof valeur === 'string' ? `« ${valeur} »` : JSON.stringify(valeur));

    test('catalogue, création refusée : notation scientifique, décimale en trop, 11 chiffres, négatif, forme non numérique et TVA non française répondent 400 au message du champ, par chacun des trois comptes de l’administration et par clé ; aucune fiche créée, rien d’écrit', async () => {
      for (const { qui, auth, porte } of ECRIVAINS()) {
        for (const [champ, valeur, message] of [...REFUS_CATALOGUE, ...REFUS_STOCK]) {
          const corps = corpsFiche('articles', reference('ART-REF'), { [champ]: valeur });
          await refuse(() => appeler('post', `${porte}/articles`, auth, corps), 400, message, `${qui}, création d’un article, ${champ} ${libelleValeur(valeur)}`);
          assert.equal(await prisma.catalogueArticle.count({ where: { reference: corps.reference } }), 0, `${qui}, ${champ} ${libelleValeur(valeur)} : aucun article créé`);
        }
        for (const famille of ['equipements', 'prestations']) {
          for (const [champ, valeur, message] of REFUS_CATALOGUE.filter((_, i) => i % 3 === 0)) {
            const corps = corpsFiche(famille, reference('REF'), { [champ]: valeur });
            await refuse(() => appeler('post', `${porte}/${famille}`, auth, corps), 400, message, `${qui}, création ${famille}, ${champ} ${libelleValeur(valeur)}`);
          }
        }
      }
    });

    test('catalogue, modification refusée : les mêmes saisies répondent 400 au message du champ, en session et par clé, pour un article, un équipement et une prestation ; rien n’est écrit, pas même le nom ni les autres prix envoyés avec', async () => {
      for (const famille of ['articles', 'equipements', 'prestations']) {
        const fiche = await fabriquer(famille);
        const cas = famille === 'articles' ? [...REFUS_CATALOGUE, ...REFUS_STOCK] : REFUS_CATALOGUE;
        for (const { qui, auth, porte } of ECRIVAINS()) {
          for (const [champ, valeur, message] of cas) {
            const corps = corpsFiche(famille, fiche.reference, { [champ]: valeur });
            await refuse(() => appeler('put', `${porte}/${famille}/${fiche.id}`, auth, corps), 400, message,
              `${qui}, modification ${famille}, ${champ} ${libelleValeur(valeur)}`, () => ficheEnBase(famille, fiche.id));
          }
        }
        const relu = await ficheEnBase(famille, fiche.id);
        assert.deepEqual([relu.nom, relu.prixVenteHt, relu.prixAchatHt, relu.tauxTva, relu.updatedAt], [fiche.nom, '111.11', '22.22', '20', fiche.updatedAt.toISOString()], `${famille} intacte`);
      }
    });

    // Cadrage v2, point 5 : « Valeurs vides au comportement actuel » (prix 0, TVA absente 20 et vide refusée, prix d'achat
    // vide null, stock 0). Lectures écartées : un vide refusé là où il valait un défaut (régression du formulaire, qui envoie
    // « 0 » ou une chaîne vide) ; un prix d'achat vide lu 0 (achat gratuit repris par les devis) ; une TVA vide lue 20 ou 0
    // (autoliquidation que personne n'a saisie, #324) ; null lu comme une saisie refusée. Témoin du comportement d'avant le
    // lot : sans virgule, ce test passe aussi sur fcc6708 (joué sur une copie extraite).
    test('catalogue, valeurs absentes ou vides au comportement actuel : prix 0, TVA absente ou null à 20 %, TVA vide refusée, prix d’achat vide absent, stock 0 ; en création comme en modification, en session et par clé', async () => {
      for (const { qui, auth, porte } of ECRIVAINS()) {
        for (const [nom, vide] of [['absent', undefined], ['vide', ''], ['blancs', '  '], ['null', null]]) {
          const corps = { reference: reference('ART-VIDE'), nom: `TEST Article ${nom}` };
          if (vide !== undefined) Object.assign(corps, { prixVenteHt: vide, prixAchatHt: vide, stockActuel: vide });
          const cree = await ok(appeler('post', `${porte}/articles`, auth, corps), 201);
          const relu = await ficheEnBase('articles', cree.id);
          assert.deepEqual([relu.prixVenteHt, relu.prixAchatHt, relu.tauxTva, relu.stockActuel], ['0', null, '20', '0'], `${qui}, création, prix, prix d’achat et stock ${nom}`);
        }
        const tvaNulle = await ok(appeler('post', `${porte}/equipements`, auth, { reference: reference('EQP-TVA'), nom: 'TEST TVA null', tauxTva: null, prixVenteHt: '18.75' }), 201);
        assert.equal((await ficheEnBase('equipements', tvaNulle.id)).tauxTva, '20', `${qui} : TVA null à 20 %`);
        for (const vide of ['', '   ']) {
          const corps = { reference: reference('EQP-TVA-VIDE'), nom: 'TEST TVA vide', tauxTva: vide, prixVenteHt: '18.75' };
          await refuse(() => appeler('post', `${porte}/equipements`, auth, corps), 400, MESSAGES.tva, `${qui} : TVA « ${vide} » refusée`);
        }
        const article = await fabriquer('articles');
        await ok(appeler('put', `${porte}/articles/${article.id}`, auth, { reference: article.reference, nom: article.nom }));
        const relu = await ficheEnBase('articles', article.id);
        assert.deepEqual([relu.prixVenteHt, relu.prixAchatHt, relu.tauxTva, relu.stockActuel], ['0', null, '20', '0'], `${qui}, modification sans les champs (le PUT remplace la fiche)`);
      }
    });

    // N1 du rapport du rédacteur des tests sur 74f6caf, corrigé dans le lot (aide catalogueEntier) : la durée indicative
    // d'une prestation (minutes, colonne Int) passait par la lecture décimale commune, et « 12,5 », refusé sur fcc6708, était
    // tronqué à 12 par la colonne sans le dire (« 12.5 » l'était déjà sur fcc6708, lu par `Number`). Elle est un entier de
    // minutes, 9 chiffres au plus ; « 12,0 » et « 12.00 » valent 12 ; vide, 0 (comportement actuel) ; null ou absente, pas
    // de durée. Lectures écartées : la troncature (12) ou l'arrondi (13) d'une durée décimale ; « 12,0 » refusé (virgule
    // non lue) ; « 1e3 » lu 1000 ; « -1 » admis ; dix chiffres admis (dépassement de la colonne, 500) ; vide refusé ou null
    // lu 0. Preuve d'échec jouée sur des copies extraites : sur 74f6caf, « 12,5 » répond 201 et s'enregistre 12 ; sur
    // fcc6708, « 12.5 » répond 201 et s'enregistre 12.
    test('durée indicative d’une prestation : un entier de minutes, « 15 » à 15, « 12,0 » et « 12.00 » à 12, vide à 0, null ou absente sans durée ; « 12,5 », « 12.5 », 12.5, « 0,5 », « 1e3 », « -1 » et dix chiffres refusés (400 « Durée indicative invalide. ») sans écriture, à la création comme à la modification, en session et par clé', async () => {
      const ADMISES = [['15', 15], ['12,0', 12], ['12.00', 12], [15, 15], ['999999999', 999999999], ['', 0], ['  ', 0], [null, null], [undefined, null]];
      const REFUSEES = ['12,5', '12.5', 12.5, '0,5', '12,05', '1e3', '-1', -1, '1234567890', 'abc', true];
      const corps = (ref, duree) => ({ reference: ref, nom: 'TEST Prestation durée 394', prixVenteHt: '10', tauxTva: '20', ...(duree === undefined ? {} : { dureeIndicativeMin: duree }) });
      for (const { qui, auth, porte } of ECRIVAINS()) {
        // Refus d'abord : sur une copie de 74f6caf, « 12,5 » y échoue en 201 (durée 12) ; sur fcc6708, « 12.5 » (durée 12).
        for (const saisie of REFUSEES) {
          const nouvelle = corps(reference('PRE-DUREE-REF'), saisie);
          await refuse(() => appeler('post', `${porte}/prestations`, auth, nouvelle), 400, MESSAGES.duree, `${qui}, création, durée ${libelleValeur(saisie)}`);
          assert.equal(await prisma.cataloguePrestation.count({ where: { reference: nouvelle.reference } }), 0, `${qui}, durée ${libelleValeur(saisie)} : aucune prestation créée`);
        }
        for (const [saisie, attendu] of ADMISES) {
          const cree = await ok(appeler('post', `${porte}/prestations`, auth, corps(reference('PRE-DUREE'), saisie)), 201);
          assert.equal((await ficheEnBase('prestations', cree.id)).dureeIndicativeMin, attendu, `${qui}, création, durée ${libelleValeur(saisie)}`);
        }
        const fiche = await fabriquer('prestations', { dureeIndicativeMin: 90 });
        for (const saisie of REFUSEES) {
          const modifiee = corps(fiche.reference, saisie);
          await refuse(() => appeler('put', `${porte}/prestations/${fiche.id}`, auth, modifiee), 400, MESSAGES.duree, `${qui}, modification, durée ${libelleValeur(saisie)}`, () => ficheEnBase('prestations', fiche.id));
        }
        assert.equal((await ficheEnBase('prestations', fiche.id)).dureeIndicativeMin, 90, `${qui} : durée de départ intacte`);
        for (const [saisie, attendu] of ADMISES) {
          await ok(appeler('put', `${porte}/prestations/${fiche.id}`, auth, corps(fiche.reference, saisie)));
          assert.equal((await ficheEnBase('prestations', fiche.id)).dureeIndicativeMin, attendu, `${qui}, modification, durée ${libelleValeur(saisie)}`);
        }
      }
    });

    // Cadrage v2, point 5 : « La TVA de la main d'œuvre (CatalogueMainOeuvre.tsx:133), aujourd'hui refusée à « 5,5 », est
    // corrigée du même coup » ; critère « Main d'œuvre TVA « 5,5 » acceptée ». Avant le lot : 400 « TVA invalide. » (le champ
    // de l'écran est déjà en texte et envoie « 5,5 »). L'entrée du journal MAIN_OEUVRE porte 5,5 en nombre, comme une saisie
    // au point. Lectures écartées : 5,5 refusé ; 55 (virgule ignorée, refusé comme TVA non française) ; 5 (`parseFloat`, refusé).
    // Une clé reste refusée (403) sur une main d'œuvre, avant toute lecture.
    test('main d’œuvre : TVA « 5,5 » admise à la création et à la modification, par le super administrateur, l’administrateur et le directeur, et journalisée en nombre ; « 5,555 » et « 19,6 » refusés sans écriture ; une clé reste refusée', async () => {
      for (const { qui, auth } of SESSION()) {
        const ref = reference('MO');
        const cree = await ok(appeler('post', '/api/catalogue/prestations', auth, corpsMainOeuvre(ref, { tauxTva: '5,5' })), 201);
        assert.equal(cree.tauxTva, 5.5, `${qui} : réponse`);
        let relu = await ficheEnBase('prestations', cree.id);
        assert.deepEqual([relu.tauxTva, relu.prixVenteHt, relu.prixJourSousContratHt, relu.heuresParJour, relu.estMainOeuvre], ['5.5', '45.5', '280.25', '7.5', true], `${qui} : relue en base`);
        let entrees = await journal('MAIN_OEUVRE', cree.id);
        assert.deepEqual([entrees.length, entrees[0].action, entrees[0].apres.tauxTva, entrees[0].auteurId], [1, 'CREATION', 5.5, comptes[qui].id], `${qui} : journal de création`);
        await ok(appeler('put', `/api/catalogue/prestations/${cree.id}`, auth, corpsMainOeuvre(ref, { tauxTva: '10' })));
        await ok(appeler('put', `/api/catalogue/prestations/${cree.id}`, auth, corpsMainOeuvre(ref, { tauxTva: '5,5' })));
        relu = await ficheEnBase('prestations', cree.id);
        assert.equal(relu.tauxTva, '5.5', `${qui} : modifiée`);
        entrees = await journal('MAIN_OEUVRE', cree.id);
        assert.deepEqual(entrees.slice(1).map((e) => [e.action, e.avant?.tauxTva, e.apres?.tauxTva]), [['MODIFICATION', 5.5, 10], ['MODIFICATION', 10, 5.5]], `${qui} : journal des modifications`);
        for (const [valeur, message] of [['5,555', MESSAGES.tva], ['1e1', MESSAGES.tva], ['19,6', MESSAGES.tva], ['', MESSAGES.tva]]) {
          await refuse(() => appeler('put', `/api/catalogue/prestations/${cree.id}`, auth, corpsMainOeuvre(ref, { tauxTva: valeur })), 400, message, `${qui}, main d’œuvre, TVA « ${valeur} »`, () => ficheEnBase('prestations', cree.id));
          const nouvelle = corpsMainOeuvre(reference('MO-REF'), { tauxTva: valeur });
          await refuse(() => appeler('post', '/api/catalogue/prestations', auth, nouvelle), 400, message, `${qui}, création d’une main d’œuvre, TVA « ${valeur} »`);
        }
      }
      const nouvelle = corpsMainOeuvre(reference('MO-CLE'), { tauxTva: '5,5' });
      await refuse(() => appeler('post', '/api/v1/catalogue/prestations', cles.ecriture, nouvelle), 403, MESSAGES.cleMainOeuvre, 'clé catalogue:write, main d’œuvre à « 5,5 »');
    });

    // Droits inchangés, et contrôlés avant la lecture des montants : un compte hors administration et une clé sans
    // catalogue:write sont refusés (403) avec une saisie admise comme avec une saisie refusée (le 400 du montant ne passe pas
    // devant le 403). Lecture écartée : un montant lu, voire écrit, avant le contrôle des droits.
    test('catalogue, droits avant la lecture des montants : un conducteur, un commercial et une clé catalogue:read seule sont refusés (403) avec « 18,75 » comme avec « 1e3 », sans écriture', async () => {
      const article = await fabriquer('articles');
      for (const valeur of ['18,75', '1e3']) {
        for (const code of ['CT', 'COM']) {
          await refuse(() => appeler('post', '/api/catalogue/articles', comptes[code].auth, corpsFiche('articles', reference('ART-DROIT'), { prixVenteHt: valeur })), 403, MESSAGES.administrateurs, `${code}, création, « ${valeur} »`);
          await refuse(() => appeler('put', `/api/catalogue/articles/${article.id}`, comptes[code].auth, corpsFiche('articles', article.reference, { prixVenteHt: valeur })), 403, MESSAGES.administrateurs, `${code}, modification, « ${valeur} »`, () => ficheEnBase('articles', article.id));
        }
        await refuse(() => appeler('post', '/api/v1/catalogue/articles', cles.lecture, corpsFiche('articles', reference('ART-DROIT'), { prixVenteHt: valeur })), 403, MESSAGES.scopeEcriture, `clé catalogue:read, création, « ${valeur} »`);
        await refuse(() => appeler('put', `/api/v1/catalogue/articles/${article.id}`, cles.lecture, corpsFiche('articles', article.reference, { prixVenteHt: valeur })), 403, MESSAGES.scopeEcriture, `clé catalogue:read, modification, « ${valeur} »`, () => ficheEnBase('articles', article.id));
      }
    });

    // Non-régression de l'écran du catalogue (Catalogue.tsx, réactivation) : la fiche relue par GET, en nombres JSON, est
    // renvoyée entière avec actif: true. Aux bornes des colonnes, le nombre relu doit rester admis par la nouvelle lecture
    // (9999999999.99, 123456789.999 écrits par `String` sans notation scientifique) : sinon, une fiche ne se réactiverait plus.
    test('réactivation par l’écran du catalogue : la fiche relue en nombres, aux bornes des colonnes, est renvoyée entière et réactivée sans changer ses montants, par chacun des trois comptes de l’administration', async () => {
      for (const { qui, auth } of SESSION()) {
        const fiche = await fabriquer('articles', { actif: false, prixVenteHt: '9999999999.99', prixAchatHt: '0.01', tauxTva: '5.5', stockActuel: '123456789.999' });
        const lue = (await ok(appeler('get', '/api/catalogue/articles', auth))).find((f) => f.id === fiche.id);
        assert.deepEqual([lue.prixVenteHt, lue.prixAchatHt, lue.tauxTva, lue.stockActuel], [9999999999.99, 0.01, 5.5, 123456789.999], `${qui} : lue en nombres`);
        await ok(appeler('put', `/api/catalogue/articles/${fiche.id}`, auth, { ...lue, categorieId: lue.categorieId || null, actif: true }));
        const relu = await ficheEnBase('articles', fiche.id);
        assert.deepEqual([relu.actif, relu.prixVenteHt, relu.prixAchatHt, relu.tauxTva, relu.stockActuel], [true, '9999999999.99', '0.01', '5.5', '123456789.999'], `${qui} : réactivée, montants gardés`);
      }
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 1 bis. Heures : POST /api/heures, intervenant inconnu (#135 point 3 : l'écran Heures affiche le refus du serveur)
    // ---------------------------------------------------------------------------------------------------------------

    // N2 de l'audit des droits et de la sécurité de #658 : les écrans Achats et Heures affichent désormais le message du
    // serveur (#135, point 3) ; un intervenant inconnu répond donc en français, 404 « Intervenant introuvable. » (avant :
    // « Intervenant not found »), sans écriture. Le corps porte une saisie admise à la virgule (« 3,5 »), qui ne masque
    // pas le refus ; le même corps, avec un intervenant réel, s'enregistre à 3,5 h (témoin : le 404 tient au seul
    // intervenant). Par les trois comptes de l'administration et le conducteur titulaire. Lectures écartées : le message
    // anglais d'avant ; un pointage écrit malgré l'intervenant inconnu ; un autre statut (400, 500).
    test('heures, intervenant inconnu : 404 « Intervenant introuvable. », sans écriture, par le super administrateur, l’administrateur, le directeur et le conducteur titulaire ; le même corps avec un intervenant réel s’enregistre à 3,5 h', async () => {
      const s = suffixe();
      const chantier = await prisma.chantier.create({ data: { nom: `TEST Chantier heures 394 ${s}`, client: 'TEST Client heures 394', dateDebut: new Date(), budgetGlobalVendu: '1000', responsableId: comptes.CT.id } });
      const intervenant = await prisma.intervenant.create({ data: { nom: `TEST Intervenant heures 394 ${s}`, role: 'Technicien', tauxHoraireCharge: '40' } });
      const corps = (intervenantId) => ({ chantierId: chantier.id, intervenantId, date: '05-10-2026', nbrHeures: '3,5', commentaire: 'TEST pointage 394' });
      for (const code of ['SA', 'AD', 'DIR', 'CT']) {
        const inconnu = corps(randomUUID());
        await refuse(() => appeler('post', '/api/heures', comptes[code].auth, inconnu), 404, 'Intervenant introuvable.', `${code}, intervenant inconnu`);
        assert.equal(await prisma.pointageHeure.count({ where: { chantierId: chantier.id } }), 0, `${code} : aucun pointage écrit`);
      }
      await ok(appeler('post', '/api/heures', comptes.SA.auth, corps(intervenant.id)));
      const pointages = await prisma.pointageHeure.findMany({ where: { chantierId: chantier.id } });
      assert.deepEqual(pointages.map((p) => [p.intervenantId, p.nbrHeures.toString()]), [[intervenant.id, '3.5']], 'témoin : intervenant réel, 3,5 h');
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 2. Rémunération : PUT /api/parametres/remuneration (super administrateur)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v2, point 4 et critère « Rémunération : objectif « 1250,50 », tranche « 1500,50 » / « 12,5 » enregistrés tels
    // quels (et non « sans plafond » / 0) ». Lectures écartées : `Number` d'avant le lot (« 1250,50 » et « 1500,50 » refusés,
    // 400) ; l'écran d'avant, qui convertissait par `Number` (plafond null, « sans plafond », et taux null, lu 0 %) ; la virgule
    // ignorée (125050, 150050 ; 125 refusé au-delà de 100) ; `parseFloat` (1250, 1500, 12, 7) ; un objectif vide refusé au
    // lieu de 0 ; un plafond vide lu 0 (refusé) au lieu de « sans plafond ». « 9999999999,99 », borne de la colonne
    // Decimal(12, 2), écarte une borne à 9 chiffres ; « 0,01 » une prime arrondie à l'euro ; « 800,25 » et « 7,25 », le barème
    // réduit lu autrement que le standard.
    test('rémunération à la virgule : objectif « 1250,50 », tranche « 1500,50 » à « 12,5 » %, barème réduit « 800,25 » à « 7,25 » % enregistrés tels quels ; prime vide à 0, plafond vide sans plafond ; réponse, base et journal REMUNERATION', async () => {
      await poserDepartRemuneration();
      const journalAvant = await journal('REMUNERATION');
      const reponse = await ok(appeler('put', '/api/parametres/remuneration', comptes.SA.auth, corpsRemuneration()));
      const attendu = {
        baremeStandard: [{ plafond: 1500.5, taux: 12.5 }, { plafond: null, taux: 20 }],
        baremeReduit: [{ plafond: 800.25, taux: 7.25 }, { plafond: null, taux: 15 }],
        libelleBaremeReduit: LIBELLE,
        objectifCaMensuel: 1250.5, primeObjectifCa: 0.01, objectifMargeMensuel: 9999999999.99, primeObjectifMarge: 100, primeSuiviAdministratif: 0,
      };
      assert.deepEqual(reponse, attendu, 'réponse');
      assert.deepEqual(await ok(appeler('get', '/api/parametres/remuneration', comptes.AD.auth)), attendu, 'relue par l’administration');
      const enBase = await reglesEnBase();
      assert.deepEqual([enBase.baremeStandard, enBase.baremeReduit, enBase.objectifCaMensuel, enBase.primeObjectifCa, enBase.objectifMargeMensuel, enBase.primeObjectifMarge, enBase.primeSuiviAdministratif],
        [attendu.baremeStandard, attendu.baremeReduit, '1250.5', '0.01', '9999999999.99', '100', '0'], 'relue en base : barèmes en nombres, montants exacts');
      const entrees = (await journal('REMUNERATION')).slice(journalAvant.length);
      assert.equal(entrees.length, 1, 'une entrée au journal');
      assert.deepEqual(entrees[0], {
        domaine: 'REGLAGES', type: 'REMUNERATION', action: 'MODIFICATION', cibleId: null, auteurId: comptes.SA.id,
        avant: { baremeStandard: DEPART_REMUNERATION.baremeStandard, baremeReduit: DEPART_REMUNERATION.baremeReduit, objectifCaMensuel: 500, primeObjectifCa: 50, objectifMargeMensuel: 300, primeObjectifMarge: 30, primeSuiviAdministratif: 20 },
        apres: { baremeStandard: attendu.baremeStandard, baremeReduit: attendu.baremeReduit, objectifCaMensuel: 1250.5, primeObjectifCa: 0.01, objectifMargeMensuel: 9999999999.99, primeObjectifMarge: 100, primeSuiviAdministratif: 0 },
      }, 'entrée REMUNERATION : avant et après en nombres');
    });

    // Cadrage v2, section « Tests » : « journal REMUNERATION de même forme ». La même règle saisie à la virgule et saisie au
    // point (nombres JSON, comme avant le lot) donne la même entrée, au caractère près, et la même base : aucune chaîne
    // (« 1500,50 ») n'entre au journal ni dans les barèmes. Lecture écartée : la saisie brute recopiée au journal ou en base.
    test('rémunération : la même règle saisie à la virgule ou en nombres donne la même base et la même entrée au journal REMUNERATION', async () => {
      const enNombres = {
        baremeStandard: [{ plafond: 1500.5, taux: 12.5 }, { plafond: null, taux: 20 }], baremeReduit: [{ plafond: 800.25, taux: 7.25 }, { plafond: null, taux: 15 }],
        libelleBaremeReduit: LIBELLE, objectifCaMensuel: 1250.5, primeObjectifCa: 0.01, objectifMargeMensuel: 9999999999.99, primeObjectifMarge: 100, primeSuiviAdministratif: 0,
      };
      const releves = [];
      for (const corps of [corpsRemuneration(), enNombres]) {
        await poserDepartRemuneration();
        const avant = (await journal('REMUNERATION')).length;
        await ok(appeler('put', '/api/parametres/remuneration', comptes.SA.auth, corps));
        const { updatedAt: _u, ...base } = await reglesEnBase();
        releves.push({ base, entrees: (await journal('REMUNERATION')).slice(avant) });
      }
      assert.equal(releves[0].entrees.length, 1);
      assert.deepEqual(releves[0], releves[1], 'virgule et nombres : même base, même entrée');
    });

    // Bornes admises (cadrage v2, point 4 : plafond 10 chiffres et 2 décimales, strictement positif ; taux 3 et 2, au plus
    // 100) : plafond « 0,01 » et « 9999999999,99 », taux « 0 », « 100 » et « 100,00 », au point comme à la virgule. Lectures
    // écartées : une borne plus étroite (9 chiffres, 99 %) ; « 100,00 » refusé comme trois chiffres et deux décimales au-delà de 100.
    test('rémunération, bornes admises : plafonds « 0,01 » et « 9999999999,99 », taux « 0 », « 100 » et « 100,00 »', async () => {
      await poserDepartRemuneration();
      await ok(appeler('put', '/api/parametres/remuneration', comptes.SA.auth, corpsRemuneration({
        baremeStandard: [{ plafond: '0,01', taux: '0' }, { plafond: '9999999999,99', taux: '100,00' }, { plafond: null, taux: '100' }],
        baremeReduit: [],
      })));
      const enBase = await reglesEnBase();
      assert.deepEqual([enBase.baremeStandard, enBase.baremeReduit], [[{ plafond: 0.01, taux: 0 }, { plafond: 9999999999.99, taux: 100 }, { plafond: null, taux: 100 }], []]);
    });

    // Cadrage v2, section « Tests » : « notation scientifique refusée ; décimale en trop refusée ; 11 chiffres refusés ; négatif
    // refusé ; taux de tranche `null` ou vide refusé ; plafond à 0 refusé ; chaque refus sans écriture ». Avant le lot, un taux
    // null, vide ou en blancs valait 0 % (enregistré sans refus), un taux absent était refusé, « 1e1 » admis à 10 %, true lu
    // 1 ; un objectif « 1e3 » valait 1000, « 12,345 » était arrondi à 12,35 par la colonne. Le message nomme le barème et le
    // rang de la tranche. Lectures écartées : taux vide lu 0 % (choix par défaut du lot : refusé, à confirmer) ; plafond « 0 »
    // lu « sans plafond » ; « 1500,505 » arrondi ; 11 chiffres admis ; « -5 » admis.
    const REFUS_REMUNERATION = [
      ['objectif de CA « 1e3 »', { objectifCaMensuel: '1e3' }, MESSAGES.montant('Objectif de CA mensuel')],
      ['objectif de CA 1e21 en nombre', { objectifCaMensuel: 1e21 }, MESSAGES.montant('Objectif de CA mensuel')],
      ['objectif de CA « abc »', { objectifCaMensuel: 'abc' }, MESSAGES.montant('Objectif de CA mensuel')],
      ['prime d’objectif de CA « 12,345 »', { primeObjectifCa: '12,345' }, MESSAGES.montant('Prime d\'objectif de CA')],
      ['prime d’objectif de CA 12.345 en nombre', { primeObjectifCa: 12.345 }, MESSAGES.montant('Prime d\'objectif de CA')],
      ['objectif de marge à 11 chiffres', { objectifMargeMensuel: '12345678901' }, MESSAGES.montant('Objectif de marge mensuel')],
      ['prime d’objectif de marge « -1 »', { primeObjectifMarge: '-1' }, MESSAGES.montant('Prime d\'objectif de marge')],
      ['prime de suivi -0.01 en nombre', { primeSuiviAdministratif: -0.01 }, MESSAGES.montant('Prime de suivi administratif')],
      ['prime de suivi true', { primeSuiviAdministratif: true }, MESSAGES.montant('Prime de suivi administratif')],
      ['prime de suivi « 1 250,50 »', { primeSuiviAdministratif: '1 250,50' }, MESSAGES.montant('Prime de suivi administratif')],
      ['taux null', { baremeStandard: [{ plafond: '1500,50', taux: null }, { plafond: null, taux: '20' }] }, MESSAGES.taux('Barème standard', 1)],
      ['taux vide', { baremeStandard: [{ plafond: '1500,50', taux: '' }, { plafond: null, taux: '20' }] }, MESSAGES.taux('Barème standard', 1)],
      ['taux en blancs', { baremeStandard: [{ plafond: '1500,50', taux: '  ' }, { plafond: null, taux: '20' }] }, MESSAGES.taux('Barème standard', 1)],
      ['taux absent', { baremeStandard: [{ plafond: '1500,50' }, { plafond: null, taux: '20' }] }, MESSAGES.taux('Barème standard', 1)],
      ['taux « 100,01 »', { baremeStandard: [{ plafond: '1500,50', taux: '100,01' }, { plafond: null, taux: '20' }] }, MESSAGES.taux('Barème standard', 1)],
      ['taux « 101 »', { baremeStandard: [{ plafond: '1500,50', taux: '101' }, { plafond: null, taux: '20' }] }, MESSAGES.taux('Barème standard', 1)],
      ['taux « 12,345 »', { baremeStandard: [{ plafond: '1500,50', taux: '12,345' }, { plafond: null, taux: '20' }] }, MESSAGES.taux('Barème standard', 1)],
      ['taux « 1e1 »', { baremeStandard: [{ plafond: '1500,50', taux: '1e1' }, { plafond: null, taux: '20' }] }, MESSAGES.taux('Barème standard', 1)],
      ['taux « -1 »', { baremeStandard: [{ plafond: '1500,50', taux: '-1' }, { plafond: null, taux: '20' }] }, MESSAGES.taux('Barème standard', 1)],
      ['taux true', { baremeStandard: [{ plafond: '1500,50', taux: true }, { plafond: null, taux: '20' }] }, MESSAGES.taux('Barème standard', 1)],
      ['taux null de la dernière tranche réduite', { baremeReduit: [{ plafond: '800,25', taux: '7,25' }, { plafond: null, taux: null }] }, MESSAGES.taux('Barème réduit', 2)],
      ['taux vide de la dernière tranche réduite', { baremeReduit: [{ plafond: '800,25', taux: '7,25' }, { plafond: null, taux: '' }] }, MESSAGES.taux('Barème réduit', 2)],
      ['plafond « 0 »', { baremeStandard: [{ plafond: '0', taux: '12,5' }, { plafond: null, taux: '20' }] }, MESSAGES.plafond('Barème standard', 1)],
      ['plafond « 0,00 »', { baremeStandard: [{ plafond: '0,00', taux: '12,5' }, { plafond: null, taux: '20' }] }, MESSAGES.plafond('Barème standard', 1)],
      ['plafond 0 en nombre', { baremeStandard: [{ plafond: 0, taux: '12,5' }, { plafond: null, taux: '20' }] }, MESSAGES.plafond('Barème standard', 1)],
      ['plafond « 1500,505 »', { baremeStandard: [{ plafond: '1500,505', taux: '12,5' }, { plafond: null, taux: '20' }] }, MESSAGES.plafond('Barème standard', 1)],
      ['plafond à 11 chiffres', { baremeStandard: [{ plafond: '12345678901', taux: '12,5' }, { plafond: null, taux: '20' }] }, MESSAGES.plafond('Barème standard', 1)],
      ['plafond « 1e3 »', { baremeStandard: [{ plafond: '1e3', taux: '12,5' }, { plafond: null, taux: '20' }] }, MESSAGES.plafond('Barème standard', 1)],
      ['plafond « -5 »', { baremeStandard: [{ plafond: '-5', taux: '12,5' }, { plafond: null, taux: '20' }] }, MESSAGES.plafond('Barème standard', 1)],
      ['plafond « 1 500 »', { baremeStandard: [{ plafond: '1 500', taux: '12,5' }, { plafond: null, taux: '20' }] }, MESSAGES.plafond('Barème standard', 1)],
      ['plafond « 0 » de la première tranche réduite', { baremeReduit: [{ plafond: '0', taux: '7,25' }, { plafond: null, taux: '15' }] }, MESSAGES.plafond('Barème réduit', 1)],
      // Plafond en blancs : refusé, comme avant le lot (`Number('  ')` valait 0, refusé), et non lu « sans plafond » comme les
      // objectifs et les primes en blancs, qui valent 0 (audit des montants de #658, S26).
      ['plafond en blancs de la dernière tranche', { baremeStandard: [{ plafond: '1500,50', taux: '12,5' }, { plafond: '  ', taux: '20' }] }, MESSAGES.plafond('Barème standard', 2)],
    ];
    test('rémunération refusée : objectif ou prime en notation scientifique, à décimale en trop, à 11 chiffres, négatif ou non numérique ; taux de tranche null, vide, absent ou hors bornes ; plafond à 0 ou mal formé ; 400 au message exact, rien d’écrit, journal inchangé', async () => {
      await poserDepartRemuneration();
      for (const [quoi, changement, message] of REFUS_REMUNERATION) {
        const corps = corpsRemuneration(changement);
        await refuse(() => appeler('put', '/api/parametres/remuneration', comptes.SA.auth, corps), 400, message, `rémunération, ${quoi}`, reglesEnBase);
      }
      const enBase = await reglesEnBase();
      assert.deepEqual([enBase.baremeStandard, enBase.objectifCaMensuel, enBase.primeSuiviAdministratif], [DEPART_REMUNERATION.baremeStandard, '500', '20'], 'règles de départ intactes');
    });

    // Valeurs vides au comportement actuel (cadrage v2, section « Tests » : « vides au comportement actuel » ; avant le lot,
    // `Number(valeur ?? 0)` valait 0 pour un objectif ou une prime absent, null, vide ou en blancs, et un plafond absent valait
    // « sans plafond »). Lectures écartées (audit des montants de #658, S29, S37, S38 et S39) : des blancs refusés, seule la
    // chaîne vide valant 0 ; null refusé ; une clé absente refusée ; un plafond absent refusé, seuls null et la chaîne vide
    // valant « sans plafond ». Les valeurs de départ, toutes non nulles, rendent chaque écriture visible.
    test('rémunération, valeurs vides au comportement actuel : objectif ou prime absent, null, vide ou en blancs à 0 ; plafond absent, sans plafond', async () => {
      await poserDepartRemuneration();
      const { objectifCaMensuel: _absent, ...sansObjectifCa } = corpsRemuneration();
      await ok(appeler('put', '/api/parametres/remuneration', comptes.SA.auth, {
        ...sansObjectifCa, primeObjectifCa: null, objectifMargeMensuel: '   ', primeObjectifMarge: '', primeSuiviAdministratif: ' \t ',
        baremeStandard: [{ plafond: '1500,50', taux: '12,5' }, { taux: '20' }],
      }));
      const enBase = await reglesEnBase();
      assert.deepEqual([enBase.objectifCaMensuel, enBase.primeObjectifCa, enBase.objectifMargeMensuel, enBase.primeObjectifMarge, enBase.primeSuiviAdministratif],
        ['0', '0', '0', '0', '0'], 'objectif absent, prime null, objectif en blancs, prime vide et prime en blancs à 0');
      assert.deepEqual(enBase.baremeStandard, [{ plafond: 1500.5, taux: 12.5 }, { plafond: null, taux: 20 }], 'plafond absent : dernière tranche, sans plafond');
    });

    // Droits inchangés (requireSuperAdmin), contrôlés avant la lecture des montants : l'administrateur et le directeur
    // (requireAdmin les admettrait), un commercial, une clé d'intégration et une requête sans session sont refusés avec une
    // saisie admise comme avec une saisie refusée. Lecture écartée : la validation des montants passée devant le droit (400
    // au lieu de 403), ou une écriture.
    test('rémunération, droits avant la lecture des montants : administrateur, directeur et commercial refusés (403), clé et absence de session (401), avec « 1250,50 » comme avec « 1e3 » ; rien d’écrit', async () => {
      await poserDepartRemuneration();
      for (const corps of [corpsRemuneration(), corpsRemuneration({ objectifCaMensuel: '1e3', baremeStandard: [{ plafond: '0', taux: null }] })]) {
        for (const code of ['AD', 'DIR', 'COM']) {
          await refuse(() => appeler('put', '/api/parametres/remuneration', comptes[code].auth, corps), 403, MESSAGES.superAdministrateur, `${code}, objectif ${corps.objectifCaMensuel}`, reglesEnBase);
        }
        await refuse(() => appeler('put', '/api/parametres/remuneration', cles.ecriture, corps), 401, MESSAGES.sessionInvalide, `clé, objectif ${corps.objectifCaMensuel}`, reglesEnBase);
        await refuse(() => appeler('put', '/api/parametres/remuneration', null, corps), 401, MESSAGES.authentification, `sans session, objectif ${corps.objectifCaMensuel}`, reglesEnBase);
      }
    });
  });
}
