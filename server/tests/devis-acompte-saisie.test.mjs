// Lot devis (cadrage v3 du 16-11-2026, contrôlé « prêt à coder », section « Tests » ; règle 2 : le lot touche des
// montants, taux d'acompte et lignes de devis) : #252 (taux d'acompte explicite invalide refusé ; 0 % envoyé avec un
// acompte exigé refusé ; devis inconnu en 404), #250/#240 (taux par défaut lu avant la transaction de la modification,
// rafale au-delà du pool de connexions) et #426 pour le devis.
//
// Décisions et lectures appliquées :
//  - décision de Nelson du 16-11-2026 sur #252. Question, mot pour mot : « Devis (issue #252) : un taux d'acompte saisi
//    invalide (« abc », -5, 1000…) est aujourd'hui remplacé en silence par le taux par défaut (30 %). Il sera refusé
//    (400). Et un taux de 0 % avec « acompte exigé » coché : refusé ou admis ? » ; réponse : « Refuser 0 % (Recommandé) » ;
//  - décision de Nelson du 16-11-2026 sur #250 : « L'intégrer au lot devis (Recommandé) » (lecture du taux par défaut
//    avant la transaction, test de rafale) ;
//  - lectures retenues du cadrage (à confirmer) : un taux envoyé non vide est contrôlé même sans acompte exigé ; le refus
//    de 0 % vise le 0 % envoyé, et non le taux par défaut (Q1 posée à Nelson, comportement actuel gardé) ; toutes les
//    routes du domaine répondent 404 pour un devis inconnu (choix par défaut, règle 5).
//
// Règles du cadrage prouvées ici, chacune par HTTP réel et relecture de la base :
//  - forme du taux (section 1) : nombre décimal de 0 à 100, au plus 3 chiffres avant la virgule et 2 après, virgule
//    admise ; refus 400 au message exact, sans aucune écriture ni numéro consommé, en session (chaque compte qui porte
//    devis:write) et par clé ; ordre : à la création avant « Client introuvable. », avant le 409 du pas non réglé et avant
//    la numérotation ; à la modification avant le 404 et les 409 ;
//  - valeur vide (`null`, chaîne vide après retrait des blancs) : taux par défaut ; clé absente : taux précédent si
//    l'acompte était exigé (modification), taux par défaut sinon ;
//  - 0 % envoyé avec un acompte exigé : 400 dans la transaction, après le 404, les 409, « Client introuvable. » et les
//    refus du temps passé ; 0 sans acompte exigé : admis, taux non enregistré ; taux par défaut réglé à 0 : état actuel ;
//  - acompte encaissé : conditions reprises telles quelles (0 et 50 ignorés), forme invalide refusée ;
//  - devis inconnu (section 2) : 404 « Devis introuvable. » sur la modification, la révision, la signature, la
//    conversion et l'annulation en session, et par clé sur la modification, la révision et la conversion ; la forme du
//    corps passe d'abord ; les droits passent avant l'existence ;
//  - rafale (section 3) : des modifications simultanées au-delà du pool aboutissent toutes, au taux par défaut relu en
//    base (37,5 %, distinct de la valeur du schéma) ; ce test échoue sur `main` (lecture du taux par le client global
//    pendant la transaction) ;
//  - plafond de 100 % et taux par défaut à 37,5 % (tests de 78896b7, absents de `main`, repris) ;
//  - copie figée : révision, duplication, taux par défaut changé après coup ;
//  - lignes saisies à la virgule (section 4, « Ces valeurs sont envoyées brutes, puisque le serveur lit la virgule ») :
//    quantité « 1,5 », PU « 18,75 », TVA « 5,5 » enregistrées exactement.
//
// Fichier propre au lot, avec sa base jetable (#552 : suppression dans un `finally`, retentée, connexion administrative
// toujours fermée) : `node --test` exécute les fichiers en parallèle, api.test.mjs purge les données « TEST » de
// TEST_DATABASE_URL, et ce fichier change le taux d'acompte par défaut. TEST_DATABASE_URL ne sert ici que de connexion
// administrative : une base neuve est créée, migrée, servie à l'application montée en mémoire, puis supprimée. Sans
// TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { empreinteBase, tablesChangees, tablesDeLaBase } from './matrice-droits/outils.mjs';

const TITRE = 'Lot devis : taux d’acompte refusé plutôt que remplacé, 0 % exigé refusé, devis inconnu en 404, taux par défaut lu avant la transaction (#252, #250/#240, #426)';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// Refus du lot, mot pour mot (cadrage v3 et interfaces données par Claude Code), et refus existants qu'il range.
const REFUS = {
  taux: 'Le taux d’acompte doit être un pourcentage de 0 à 100, avec au plus deux décimales (par exemple 30 ou 37,5).',
  zero: 'Un acompte exigé ne peut pas être de 0 % : indiquez un taux, ou décochez « Exiger un acompte ».',
  introuvable: 'Devis introuvable.',
  client: 'Client introuvable.',
  corps: 'Client, objet et au moins une ligne sont requis.',
  signe: 'Ce devis est signé : créez une nouvelle révision brouillon pour le modifier.',
  nonModifiable: 'Seuls les devis brouillon ou envoyés, non signés, peuvent être modifiés.',
  pasNonRegle: 'Réglez d’abord le pas du temps passé dans l’administration (Administration > Marges & Commissions) : un devis au temps passé est refusé tant qu’il n’est pas fixé.',
  signataire: 'Le signataire et sa confirmation explicite sont obligatoires.',
  cible: 'Cible de conversion non disponible.',
  motif: 'Un motif d’annulation est obligatoire.',
  permission: 'Permission requise : devis:write',
  scope: 'Scope requis : devis:write',
  administration: 'Accès réservé aux administrateurs',
  cleRequise: 'Clé API Iris requise',
  session: 'Session expirée ou invalide',
  // Message du plafond avant le lot : il disparaît, la borne de 100 étant dans le contrôle de forme (cadrage, section 1).
  ancienPlafond: 'Le taux d’acompte ne peut pas dépasser 100 %.',
};

// Formes admises (cadrage, section 1 et critères « « 37,5 » et 100 sont admis et relus en base, en décimal exact »).
// [libellé, valeur envoyée, attendu en base (toString du Decimal(5,2)), attendu dans la réponse]. `{ brut }` : écrit tel
// quel dans le texte JSON (le nombre JSON 1e2). Chaque commentaire dit la lecture écartée ; le taux par défaut vaut 30 (ou
// 37,5 dans les tests qui le règlent), distinct de chaque attendu : un retour au taux par défaut se voit toujours.
const FORMES_ADMISES = [
  ['« 37,5 » (virgule)', '37,5', '37.5', 37.5], // critère du cadrage ; écarte `parseFloat` (37), une virgule lue en séparateur de milliers (375, hors bornes), un arrondi à l'unité (38) et le taux par défaut (30).
  ['« 37.5 » (point)', '37.5', '37.5', 37.5], // le point reste admis.
  ['37.5 (nombre)', 37.5, '37.5', 37.5], // nombre JSON, jugé sur son écriture décimale.
  ['« 12,25 »', '12,25', '12.25', 12.25], // au centième : écarte un arrondi au dixième (12,3 au demi supérieur, 12,2 au pair) et une troncature (12,2).
  ['« 0,01 »', '0,01', '0.01', 0.01], // plus petit taux non nul : écarte un arrondi à l'unité (0, alors refusé comme 0 %) et un refus de tout taux inférieur à 1.
  ['« 99,99 »', '99,99', '99.99', 99.99], // écarte un arrondi à l'unité (100) et un plafond strict mal placé (≤ 99).
  ['100 (nombre)', 100, '100', 100], // critère du cadrage ; borne incluse : écarte un plafond strict (< 100).
  ['« 100,00 »', '100,00', '100', 100], // borne écrite au centième : écarte une comparaison de texte (« 100,00 » > « 100 »).
  ['1e2 (nombre JSON en notation scientifique)', { brut: '1e2' }, '100', 100], // cadrage : « le nombre JSON `1e2` vaut 100 et reste admis » ; écarte un refus du nombre selon son écriture dans le texte JSON.
  ['« 37,5 » entouré de blancs', ' 37,5 ', '37.5', 37.5], // blancs retirés avant la lecture, comme pour tous les montants.
  ['« 7 »', '7', '7', 7], // un seul chiffre.
];

// Formes refusées (cadrage, section 1 : « abc », -5, « 12,345 », 1000, 100,01, la chaîne « 1e2 », un booléen ou un objet),
// qu'un acompte soit exigé ou non : 400 au message exact, sans aucune écriture. Avant le lot, toutes sauf 100,01 donnaient
// en silence le taux par défaut (30) ; 100,01 était refusé par l'ancien message du plafond.
const FORMES_REFUSEES = [
  ['« abc »', 'abc'], // cité par la question de Nelson ; avant : 30 en silence.
  ['-5 (nombre)', -5], // cité par la question ; écarte aussi une valeur absolue (5).
  ['« -5 »', '-5'], // idem, en chaîne.
  ['« 12,345 »', '12,345'], // trois décimales : écarte un arrondi (12,35) et une troncature (12,34).
  ['1000 (nombre)', 1000], // cité par la question ; quatre chiffres : écarte un plafonnement à 100 au lieu du refus.
  ['« 100,01 »', '100,01'], // un centième au-delà de 100 : écarte un plafond retiré ou arrondi à l'unité (100).
  ['100.01 (nombre)', 100.01], // idem, en nombre JSON.
  ['« 101 »', '101'], // trois chiffres admis par la forme, au-delà de la borne : écarte un contrôle de forme sans la borne de 100.
  ['« 1e2 » (chaîne)', '1e2'], // cadrage : la chaîne « 1e2 » est refusée ; écarte `Number('1e2')` (100).
  ['true', true], // booléen : écarte une lecture booléen = 1.
  ['false', false], // booléen : écarte une lecture de `false` comme valeur vide (taux par défaut).
  ['{} (objet)', {}], // objet.
  ['["30"] (tableau)', ['30']], // écarte une lecture du premier élément (30).
  ['« 37,5 % »', '37,5 %'], // le signe % n'est pas lu.
];

// Le 0 sous ses écritures (cadrage : « Le refus vise un taux **envoyé** égal à 0 »).
const FORMES_ZERO = [
  ['0 (nombre)', 0],
  ['« 0 »', '0'],
  ['« 0,00 »', '0,00'],
  ['« 0.0 »', '0.0'],
  ['« 000 »', '000'],
  ['« 0 » entouré de blancs', ' 0 '],
];

// Valeurs vides (cadrage : « `tauxAcompte` est « vide » s'il vaut `null` ou une chaîne vide après `trim` »).
const FORMES_VIDES = [['null', null], ['« » (chaîne vide)', ''], ['chaîne de blancs', '   ']];

// Identité de la société, nécessaire à la signature d'un devis (lot 6a-2) ; mêmes valeurs que la matrice des droits.
const SOCIETE = {
  raisonSociale: 'TEST Société lot devis', nomCommercial: '', siret: '73282932000074', tvaIntra: '',
  adresse: '1 rue des Devis', codePostal: '14000', ville: 'Caen', pays: 'France', telephone: '02 31 00 00 02',
  email: 'societe-lot-devis@iris.test', siteWeb: '', piedFacture: 'TEST Pied lot devis', couleurPrimaire: '#0f766e', fuseauHoraire: 'Europe/Paris',
};

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_devis_acompte_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;
    // Nombre de requêtes de la rafale (formule de 78896b7, N1 de l'audit de #250) : au-delà du pool de Prisma, qui ouvre
    // au plus 2 × cœurs physiques + 1 connexions, ou le connection_limit de l'adresse de l'application quand elle le fixe.
    const auDelaDuPool = Math.max(2 * cpus().length + 2, (Number(cible.searchParams.get('connection_limit')) || 0) + 1);

    let request; let app; let prisma; let appPrisma; let jwt; let jourCivilEntreprise;
    let tables = [];
    let rang = 0;
    const suffixe = () => `${Date.now()}-${(rang += 1)}`;
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const comptes = {};
    const cles = {};
    let client = null;
    let mainOeuvre = null;

    // --- Comptes ---
    const creerCompte = async (role, cle, extra = {}) => {
      const s = suffixe();
      const compte = await prisma.user.create({ data: { email: `devis-acompte.${cle.toLowerCase().replace(/[^a-z0-9]/g, '-')}.${s}@iris.test`, name: `TEST ${cle} ${s}`, role, ...extra } });
      return { ...compte, auth: entete(jwt.sign({ id: compte.id }, process.env.JWT_SECRET)) };
    };
    // Comptes qui portent devis:write (matrice entrees.txt : SA, AD, AD-COM, DIR, AT, COM, DC, AC, CPT, CPT-FINANCE), et un
    // conducteur de travaux à qui le droit individuel devis:write est donné : la règle du taux vaut pour chacun.
    const ECRIVENT = () => ['SA', 'AD', 'AD-COM', 'DIR', 'AT', 'COM', 'DC', 'AC', 'CPT', 'CT+devis:write'].map((cle) => [cle, comptes[cle].auth]);
    // Comptes sans devis:write : refusés (403) avant toute lecture du corps.
    const SANS_DROIT = () => ['CT', 'RESP', 'TECH'].map((cle) => [cle, comptes[cle].auth]);
    const SA = () => comptes.SA.auth;

    // --- Appels ---
    // Session : /api/devis ; clé : /api/v1/devis (routes mixtes, portée devis:write). Le corps est calculé avant la requête.
    const appeler = (methode, chemin, corps, auth = SA()) => request(app)[methode](chemin).set(auth).send(corps ?? {});
    // Corps JSON écrit à la main, pour un nombre en notation scientifique (`{ brut: '1e2' }`) que JSON.stringify réécrirait.
    const appelerBrut = (methode, chemin, texte, auth) => request(app)[methode](chemin).set(auth).set('Content-Type', 'application/json').send(texte);
    const PORTES = { session: '/api/devis', cle: '/api/v1/devis' };
    const ligneLibre = (extra = {}) => ({ designation: 'TEST Pose du lot devis', nature: 'MAIN_OEUVRE', quantite: 2, prixUnitaireHt: 100, tauxTva: 20, ...extra });
    const corpsDevis = (extra = {}) => ({ clientId: client.id, objet: `TEST Devis acompte ${suffixe()}`, lignes: [ligneLibre()], ...extra });
    // Corps avec un taux : `{ brut }` donne un texte JSON où le taux est écrit tel quel.
    const envoyerTaux = (methode, chemin, corps, taux, auth) => {
      if (taux && typeof taux === 'object' && 'brut' in taux) {
        const texte = JSON.stringify({ ...corps, tauxAcompte: '__TAUX__' }).replace('"__TAUX__"', taux.brut);
        return appelerBrut(methode, chemin, texte, auth);
      }
      return appeler(methode, chemin, { ...corps, tauxAcompte: taux }, auth);
    };
    const creer = (corps, auth = SA(), porte = PORTES.session) => appeler('post', porte, corps, auth);
    const modifier = (id, corps, auth = SA(), porte = PORTES.session) => appeler('patch', `${porte}/${id}`, corps, auth);
    const ok = async (reponse, statut = 200) => {
      const res = await reponse;
      assert.equal(res.status, statut, `${res.req?.method} ${res.req?.path} : ${JSON.stringify(res.body)}`);
      return res.body;
    };
    const creerOk = async (extra = {}, auth = SA()) => ok(creer(corpsDevis(extra), auth), 201);

    // --- État de la base ---
    // Toute la base, contenu compris ; la dernière utilisation d'une clé, notée sans attente par la porte /api/v1, est
    // retirée de l'empreinte (comme la matrice des clés, D1a-2) : elle n'est pas une écriture du devis.
    const empreinte = () => empreinteBase(prisma, tables, { colonnesIgnorees: { ApiAccessKey: ['dernierUsageLe'] } });
    // Un refus : statut, message exact, et l'empreinte de toute la base inchangée (devis, lignes, numérotation, journaux…).
    const refuse = async (appel, statut, message, quoi) => {
      const avant = await empreinte();
      const res = await appel();
      assert.equal(res.status, statut, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, message, quoi);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      return res;
    };
    const conditions = async (id) => {
      const d = await prisma.devis.findUniqueOrThrow({ where: { id } });
      return { acompteExige: d.acompteExige, tauxAcompte: d.tauxAcompte === null ? null : d.tauxAcompte.toString() };
    };
    const reglerTauxParDefaut = async (taux) => {
      const res = await appeler('put', '/api/parametres', { tauxAcompteDefaut: taux });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal((await prisma.parametres.findUniqueOrThrow({ where: { id: 'singleton' } })).tauxAcompteDefaut.toString(), String(taux).replace(',', '.'));
    };
    // Le taux par défaut revient à 30 (valeur du schéma) même si une assertion échoue (N4 de l'audit de #250).
    const avecTauxParDefaut = async (taux, corps) => {
      await reglerTauxParDefaut(taux);
      try { await corps(); } finally { await reglerTauxParDefaut(30); }
    };
    const aujourdhui = async () => {
      const societe = await prisma.companySettings.findUnique({ where: { id: 'singleton' } });
      return jourCivilEntreprise(new Date(), societe?.fuseauHoraire || 'Europe/Paris').split('-').reverse().join('-');
    };
    const signer = (id, auth = SA()) => ok(appeler('post', `/api/devis/${id}/signature`, { signataire: 'TEST Signataire lot devis', confirme: true }, auth), 201);
    const refuser = async (id) => {
      await ok(appeler('put', `/api/devis/${id}/statut`, { statut: 'ENVOYE' }));
      await ok(appeler('put', `/api/devis/${id}/statut`, { statut: 'REFUSE' }));
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
      const secours = await prisma.user.findUniqueOrThrow({ where: { email: 'secours@iris.test' } });
      comptes.SA = { ...secours, auth: entete(connexion.body.token) };
      assert.equal(secours.role, 'SUPERADMIN', 'le compte de secours est super administrateur');
      comptes.AD = await creerCompte('ADMIN', 'AD');
      comptes['AD-COM'] = await creerCompte('ADMIN', 'AD-COM', { estCommercial: true });
      for (const [cle, role] of [
        ['DIR', 'DIRECTEUR'], ['AT', 'ASSISTANTE_TECHNIQUE'], ['COM', 'COMMERCIAL'], ['DC', 'DIRECTEUR_COMMERCIAL'], ['AC', 'ASSISTANTE_COMMERCIALE'],
        ['CPT', 'COMPTABLE'], ['CT', 'CONDUCTEUR_TRAVAUX'], ['RESP', 'RESPONSABLE'], ['TECH', 'TECHNICIEN'],
      ]) comptes[cle] = await creerCompte(role, cle);
      comptes['CT+devis:write'] = await creerCompte('CONDUCTEUR_TRAVAUX', 'CT-DEVIS', { permissions: ['devis:write'] });
      // Clés d'intégration : la portée des routes du devis, et une autre portée, refusée.
      for (const [nom, scopes] of [['devis', ['devis:write']], ['autre', ['devis:read']]]) {
        const cle = await ok(appeler('post', '/api/admin/api-keys', { nom: `TEST Clé lot devis ${nom}`, scopes }), 201);
        cles[nom] = entete(cle.apiKey);
      }
      // Identité de la société et du client : la signature d'un devis les exige (lots 6a-2 et 6a-2 bis).
      await ok(appeler('put', '/api/company', SOCIETE));
      client = await ok(appeler('post', '/api/clients', { raisonSociale: `TEST Client lot devis ${suffixe()}`, siren: String(randomInt(100_000_000, 1_000_000_000)) }), 201);
      await ok(appeler('post', `/api/clients/${client.id}/sites`, { nom: 'TEST Facturation lot devis', adresse: '3 rue de l’Acompte', codePostal: '14000', ville: 'Caen', estSiteFacturation: true }), 201);
      // Main d'œuvre pour une ligne au temps passé (refus du pas non réglé : base neuve, pas vide).
      mainOeuvre = await ok(appeler('post', '/api/catalogue/prestations', {
        estMainOeuvre: true, reference: `TEST-LOT-DEVIS-MO-${suffixe()}`, nom: 'TEST Main d’œuvre du lot devis', tauxTva: '20',
        prixVenteHt: '45.50', prixJourHorsContratHt: '320', prixHeureSousContratHt: '40', prixJourSousContratHt: '280.25', heuresParJour: '7.5',
      }), 201);
      const parametres = await prisma.parametres.findUniqueOrThrow({ where: { id: 'singleton' } });
      assert.equal(parametres.tauxAcompteDefaut.toString(), '30', 'taux par défaut de la base neuve : la valeur du schéma');
      assert.equal(parametres.pasTempsPasseMinutes, null, 'pas du temps passé vide dans une base neuve');
      tables = await tablesDeLaBase(prisma);
      assert.ok(tables.includes('Devis') && tables.includes('DevisLigne') && tables.includes('SequenceAffaire') && tables.length > 40, `tables relevées : ${tables.join(', ')}`);
    });

    // #552 : la connexion administrative est fermée même si la suppression de la base échoue ; la suppression est retentée.
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
    // Section 1 : forme du taux d'acompte envoyé (#252 N2).
    // ==================================================================================================================

    // Cadrage, critère « Taux valides : « 37,5 » et 100 sont admis et relus en base, en décimal exact », en session par
    // chaque compte qui porte devis:write et par clé. Les lectures écartées sont dans FORMES_ADMISES.
    test('création : chaque forme admise du taux (virgule, point, nombre, 1e2, bornes 0,01 et 100) est enregistrée exactement, en session par chaque compte qui écrit les devis et par clé', async () => {
      for (const [compte, auth, porte] of [...ECRIVENT().map(([c, a]) => [c, a, PORTES.session]), ['clé devis:write', cles.devis, PORTES.cle]]) {
        for (const [quoi, valeur, enBase, enReponse] of FORMES_ADMISES) {
          const res = await envoyerTaux('post', porte, corpsDevis({ acompteExige: true }), valeur, auth);
          assert.equal(res.status, 201, `${compte}, ${quoi} : ${JSON.stringify(res.body)}`);
          assert.equal(res.body.tauxAcompte, enReponse, `${compte}, ${quoi} : réponse`);
          assert.deepEqual(await conditions(res.body.id), { acompteExige: true, tauxAcompte: enBase }, `${compte}, ${quoi} : en base`);
        }
      }
    });

    // Cadrage, section 1 : « Sinon : 400, rien n'est écrit, et à la création aucun numéro n'est consommé » ; critère « Taux
    // invalide (…) en session comme par clé. La base ne change pas : nombre de devis, numérotation, taux, lignes » ;
    // « contrôlée qu'un acompte soit exigé ou non ». Toutes les formes pour SA et la clé ; deux formes (« abc », 101) pour
    // chaque autre compte. L'empreinte couvre toute la base, SequenceAffaire comprise.
    test('création : taux invalide refusé (400, message exact), acompte exigé ou non, sans écriture ni numéro consommé, en session par chaque compte et par clé', async () => {
      const joueurs = [
        ['SA', SA(), PORTES.session, FORMES_REFUSEES],
        ['clé devis:write', cles.devis, PORTES.cle, FORMES_REFUSEES],
        ...ECRIVENT().filter(([c]) => c !== 'SA').map(([c, a]) => [c, a, PORTES.session, FORMES_REFUSEES.filter(([q]) => ['« abc »', '« 101 »'].includes(q))]),
      ];
      const sequenceAvant = await prisma.sequenceAffaire.findMany();
      for (const [compte, auth, porte, formes] of joueurs) {
        for (const exige of [true, false]) {
          for (const [quoi, valeur] of formes) {
            await refuse(() => appeler('post', porte, { ...corpsDevis({ acompteExige: exige }), tauxAcompte: valeur }, auth), 400, REFUS.taux, `${compte}, acompte ${exige ? 'exigé' : 'non exigé'}, ${quoi}`);
          }
        }
      }
      assert.deepEqual(await prisma.sequenceAffaire.findMany(), sequenceAvant, 'aucun numéro d’affaire consommé');
    });

    // Cadrage, section 1, « Ordre des refus », création : « le contrôle de forme a lieu juste après `devisPayload`, avant
    // « Client introuvable », avant le 409 « pas non réglé » (`routes.ts:76`) et avant la numérotation (`:81`) ». Écarte un
    // contrôle placé dans l'appel d'origine (après le client et le temps passé). Un corps sans ligne reste refusé d'abord.
    test('création : la forme du taux est contrôlée avant « Client introuvable. », avant le 409 du pas non réglé et avant la numérotation ; un corps incomplet reste refusé d’abord', async () => {
      const ligneTp = { tempsPasse: true, designation: 'TEST Main d’œuvre au temps passé', quantite: 1, tarifTempsPasse: 'HORS_CONTRAT', catalogueFamille: 'prestations', catalogueId: mainOeuvre.id };
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        await refuse(() => appeler('post', porte, { ...corpsDevis({ acompteExige: true, tauxAcompte: 'abc' }), clientId: randomUUID() }, auth), 400, REFUS.taux, `${qui} : client inconnu et « abc »`);
        // Témoin : sans le taux invalide, le client inconnu est bien refusé.
        await refuse(() => appeler('post', porte, { ...corpsDevis({ acompteExige: true, tauxAcompte: '30' }), clientId: randomUUID() }, auth), 400, REFUS.client, `${qui} : client inconnu, taux valide`);
        await refuse(() => appeler('post', porte, corpsDevis({ auTempsPasse: true, lignes: [ligneTp], acompteExige: true, tauxAcompte: '1000' }), auth), 400, REFUS.taux, `${qui} : pas non réglé et 1000`);
        // Témoin : sans le taux invalide, le pas non réglé est bien refusé (409).
        await refuse(() => appeler('post', porte, corpsDevis({ auTempsPasse: true, lignes: [ligneTp], acompteExige: true, tauxAcompte: '30' }), auth), 409, REFUS.pasNonRegle, `${qui} : pas non réglé, taux valide`);
        await refuse(() => appeler('post', porte, { clientId: client.id, objet: 'TEST Sans ligne', lignes: [], acompteExige: true, tauxAcompte: 'abc' }, auth), 400, REFUS.corps, `${qui} : corps sans ligne et « abc »`);
      }
    });

    // Cadrage, section 1 : mêmes formes admises à la modification (un devis exigé à 35 %, chaque forme écrite puis relue ;
    // la valeur précédente change à chaque fois, la relecture prouve l'écriture), en session et par clé.
    test('modification : chaque forme admise du taux est enregistrée exactement, en session par chaque compte qui écrit les devis et par clé', async () => {
      for (const [compte, auth, porte] of [...ECRIVENT().map(([c, a]) => [c, a, PORTES.session]), ['clé devis:write', cles.devis, PORTES.cle]]) {
        const devis = await creerOk({ acompteExige: true, tauxAcompte: 35 });
        for (const [quoi, valeur, enBase, enReponse] of FORMES_ADMISES) {
          await prisma.devis.update({ where: { id: devis.id }, data: { tauxAcompte: '35' } });
          const res = await envoyerTaux('patch', `${porte}/${devis.id}`, corpsDevis({ objet: devis.objet }), valeur, auth);
          assert.equal(res.status, 200, `${compte}, ${quoi} : ${JSON.stringify(res.body)}`);
          assert.equal(res.body.tauxAcompte, enReponse, `${compte}, ${quoi} : réponse`);
          assert.deepEqual(await conditions(devis.id), { acompteExige: true, tauxAcompte: enBase }, `${compte}, ${quoi} : en base`);
        }
      }
    });

    // Cadrage, section 1 : à la modification, refus 400 sans écriture, acompte exigé ou non (devis exigé à 35 %, devis non
    // exigé) ; requête mêlée (objet et lignes changés) : rien n'est écrit, pas même l'objet. Toutes les formes pour SA et la
    // clé ; « abc » et 101 pour chaque autre compte.
    test('modification : taux invalide refusé (400, message exact), acompte exigé ou non, sans écriture, en session par chaque compte et par clé', async () => {
      const exigeA35 = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      const nonExige = await creerOk({ acompteExige: false });
      const joueurs = [
        ['SA', SA(), PORTES.session, FORMES_REFUSEES],
        ['clé devis:write', cles.devis, PORTES.cle, FORMES_REFUSEES],
        ...ECRIVENT().filter(([c]) => c !== 'SA').map(([c, a]) => [c, a, PORTES.session, FORMES_REFUSEES.filter(([q]) => ['« abc »', '« 101 »'].includes(q))]),
      ];
      for (const [compte, auth, porte, formes] of joueurs) {
        for (const [quoi, valeur] of formes) {
          for (const [devis, corps, cas] of [
            [exigeA35, { acompteExige: true }, 'devis exigé à 35 %, acompte exigé'],
            [exigeA35, {}, 'devis exigé à 35 %, sans la case'],
            [nonExige, { acompteExige: false }, 'devis non exigé'],
            [nonExige, { acompteExige: true }, 'devis non exigé, acompte exigé'],
          ]) {
            const envoye = { ...corpsDevis({ objet: `TEST Objet changé ${suffixe()}`, lignes: [ligneLibre({ quantite: 3 })] }), ...corps, tauxAcompte: valeur };
            await refuse(() => appeler('patch', `${porte}/${devis.id}`, envoye, auth), 400, REFUS.taux, `${compte}, ${cas}, ${quoi}`);
          }
        }
      }
      assert.deepEqual(await conditions(exigeA35.id), { acompteExige: true, tauxAcompte: '35' });
      assert.deepEqual(await conditions(nonExige.id), { acompteExige: false, tauxAcompte: null });
    });

    // Cadrage, section 1, « Ordre des refus », modification : « il a lieu avant la transaction, comme celui des lignes. Une
    // valeur mal formée répond donc 400 avant le 404 et les 409 » (la forme avant l'existence ; #393 ne s'applique pas
    // ici). Devis inconnu, devis signé, devis refusé ; chacun avec son témoin (taux valide : 404 ou 409).
    test('modification : la forme du taux est contrôlée avant le 404 du devis inconnu et les 409 du devis signé ou refusé, en session et par clé', async () => {
      const signe = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      await signer(signe.id);
      const refuse409 = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      await refuser(refuse409.id);
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        for (const [id, temoinStatut, temoinMessage, cas] of [
          [randomUUID(), 404, REFUS.introuvable, 'devis inconnu'],
          [signe.id, 409, REFUS.signe, 'devis signé'],
          [refuse409.id, 409, REFUS.nonModifiable, 'devis refusé'],
        ]) {
          await refuse(() => modifier(id, corpsDevis({ acompteExige: true, tauxAcompte: 'abc' }), auth, porte), 400, REFUS.taux, `${qui}, ${cas}, « abc »`);
          await refuse(() => modifier(id, corpsDevis({ acompteExige: false, tauxAcompte: '100,01' }), auth, porte), 400, REFUS.taux, `${qui}, ${cas}, « 100,01 » sans acompte exigé`);
          await refuse(() => modifier(id, corpsDevis({ acompteExige: true, tauxAcompte: '30' }), auth, porte), temoinStatut, temoinMessage, `${qui}, ${cas}, témoin au taux valide`);
        }
      }
    });

    // Tests de 78896b7 (#250, C2 de son audit), repris : création à 100,01 refusée, à 100 admise ; modification à 150
    // refusée sans rien écrire. Le message est désormais celui du contrôle de forme, et l'ancien message du plafond n'est plus
    // servi (cadrage : « Le message du plafond (`metier.ts:319`) devient inatteignable : il est retiré »).
    test('plafond : le taux d’acompte d’un devis ne dépasse jamais 100 %, à la création comme à la modification, avec le message du contrôle de forme', async () => {
      const lignes = [ligneLibre({ quantite: 1 })];
      const creation = await refuse(() => creer({ clientId: client.id, objet: 'TEST Acompte plafonné', acompteExige: true, tauxAcompte: 100.01, lignes }), 400, REFUS.taux, 'création à 100,01');
      assert.notEqual(creation.body.error, REFUS.ancienPlafond);
      const cree = await ok(creer({ clientId: client.id, objet: 'TEST Acompte plafonné', acompteExige: true, tauxAcompte: 100, lignes }), 201);
      assert.equal(cree.tauxAcompte, 100);
      const modification = await refuse(() => modifier(cree.id, { clientId: client.id, objet: 'TEST Acompte plafonné modifié', tauxAcompte: 150, lignes }), 400, REFUS.taux, 'modification à 150');
      assert.notEqual(modification.body.error, REFUS.ancienPlafond);
      const relu = await prisma.devis.findUniqueOrThrow({ where: { id: cree.id } });
      assert.deepEqual([relu.tauxAcompte.toString(), relu.objet], ['100', 'TEST Acompte plafonné'], 'le refus ne modifie ni le taux ni le devis');
    });

    // ==================================================================================================================
    // Valeur vide ou clé absente : comportement actuel conservé (cadrage, section 1, « Valeur vide »).
    // ==================================================================================================================

    // Cadrage, test nommé : « `null` et `""` en modification d'un devis exigé à 35 %, avec un taux par défaut à 30 %,
    // donnent 30 % ; la clé absente garde 35 % ». Rejoué avec un taux par défaut à 37,5 % : écarte une constante 30 dans le
    // code. Lectures écartées : vide traité comme absent (35 au lieu du défaut) ; absent traité comme vide (défaut au lieu
    // de 35) ; vide refusé comme une forme invalide (400).
    test('modification : un taux vide (null, chaîne vide, blancs) prend le taux par défaut (30 %, puis 37,5 %), la clé absente garde 35 %, en session et par clé', async () => {
      for (const [defaut, attendu] of [[30, '30'], ['37,5', '37.5']]) {
        await avecTauxParDefaut(defaut, async () => {
          for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
            for (const [quoi, valeur] of FORMES_VIDES) {
              for (const corps of [{ acompteExige: true }, {}]) {
                const devis = await creerOk({ acompteExige: true, tauxAcompte: 35 });
                const res = await ok(modifier(devis.id, corpsDevis({ objet: devis.objet, ...corps, tauxAcompte: valeur }), auth, porte));
                assert.equal(res.tauxAcompte, Number(attendu), `${qui}, défaut ${defaut}, ${quoi}, ${JSON.stringify(corps)} : réponse`);
                assert.deepEqual(await conditions(devis.id), { acompteExige: true, tauxAcompte: attendu }, `${qui}, défaut ${defaut}, ${quoi}, ${JSON.stringify(corps)}`);
              }
            }
            for (const corps of [{ acompteExige: true }, {}]) {
              const devis = await creerOk({ acompteExige: true, tauxAcompte: 35 });
              const res = await ok(modifier(devis.id, corpsDevis({ objet: `TEST Objet changé ${suffixe()}`, ...corps }), auth, porte));
              assert.equal(res.tauxAcompte, 35, `${qui}, défaut ${defaut}, clé absente, ${JSON.stringify(corps)} : réponse`);
              assert.deepEqual(await conditions(devis.id), { acompteExige: true, tauxAcompte: '35' }, `${qui}, défaut ${defaut}, clé absente, ${JSON.stringify(corps)} : le taux négocié est gardé`);
            }
          }
        });
      }
    });

    // Cadrage, section 1 : « un taux absent (…) garde le taux précédent en modification si l'acompte était déjà exigé, sinon
    // il prend le taux par défaut ; à la création, il prend le taux par défaut » ; un taux vide aussi. Taux par défaut à
    // 37,5 %. Écarte une lecture qui garderait un taux précédent nul (devis non exigé) ou qui renverrait null.
    test('création et passage à l’acompte exigé : un taux absent ou vide prend le taux par défaut (37,5 %) ; sans acompte exigé, aucun taux n’est enregistré', async () => {
      await avecTauxParDefaut('37,5', async () => {
        for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
          for (const [quoi, extra] of [['clé absente', {}], ...FORMES_VIDES.map(([q, v]) => [q, { tauxAcompte: v }])]) {
            const cree = await ok(creer(corpsDevis({ acompteExige: true, ...extra }), auth, porte), 201);
            assert.equal(cree.tauxAcompte, 37.5, `${qui}, création, ${quoi}`);
            assert.deepEqual(await conditions(cree.id), { acompteExige: true, tauxAcompte: '37.5' }, `${qui}, création, ${quoi}`);
            const sansAcompte = await ok(creer(corpsDevis({ acompteExige: false, ...extra }), auth, porte), 201);
            assert.deepEqual(await conditions(sansAcompte.id), { acompteExige: false, tauxAcompte: null }, `${qui}, création sans acompte, ${quoi}`);
            const nonExige = await creerOk({ acompteExige: false });
            await ok(modifier(nonExige.id, corpsDevis({ objet: nonExige.objet, acompteExige: true, ...extra }), auth, porte));
            assert.deepEqual(await conditions(nonExige.id), { acompteExige: true, tauxAcompte: '37.5' }, `${qui}, passage à l’acompte exigé, ${quoi}`);
          }
        }
      });
    });

    // ==================================================================================================================
    // 0 % envoyé avec un acompte exigé (décision de Nelson du 16-11-2026, « Refuser 0 % (Recommandé) »).
    // ==================================================================================================================

    // Cadrage : « Le refus vise un taux **envoyé** égal à 0, quand l'acompte effectivement exigé (celui du corps, ou celui du
    // devis précédent si la clé est absente) est vrai » ; « À la création, le refus a lieu (…) avant la numérotation (`:81`),
    // sans consommer de numéro ». Chaque écriture du 0, en session par chaque compte (0 seul pour les autres) et par clé.
    // Lecture écartée : 0 % admis avec un acompte exigé (comportement « Admettre 0 % », écarté par Nelson ; avant le lot, 0
    // devenait le taux par défaut).
    test('création : 0 % envoyé avec un acompte exigé est refusé (400, message exact), sous chacune de ses écritures, sans écriture ni numéro consommé, en session par chaque compte et par clé', async () => {
      const joueurs = [
        ['SA', SA(), PORTES.session, FORMES_ZERO],
        ['clé devis:write', cles.devis, PORTES.cle, FORMES_ZERO],
        ...ECRIVENT().filter(([c]) => c !== 'SA').map(([c, a]) => [c, a, PORTES.session, FORMES_ZERO.slice(0, 1)]),
      ];
      for (const [compte, auth, porte, formes] of joueurs) {
        for (const [quoi, valeur] of formes) {
          await refuse(() => appeler('post', porte, { ...corpsDevis({ acompteExige: true }), tauxAcompte: valeur }, auth), 400, REFUS.zero, `${compte}, ${quoi}`);
        }
      }
    });

    // Cadrage : à la modification, le 0 % est refusé avec la case cochée, ou sans la case quand le devis exigeait déjà un
    // acompte ; le devis garde ses conditions (35 %), son objet et ses lignes.
    test('modification : 0 % envoyé est refusé quand l’acompte est exigé, par la case ou par le devis précédent, sans écriture, en session et par clé', async () => {
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        const exigeA35 = await creerOk({ acompteExige: true, tauxAcompte: 35 });
        const nonExige = await creerOk({ acompteExige: false });
        for (const [quoi, valeur] of FORMES_ZERO) {
          await refuse(() => modifier(exigeA35.id, corpsDevis({ acompteExige: true, tauxAcompte: valeur }), auth, porte), 400, REFUS.zero, `${qui}, devis exigé, case cochée, ${quoi}`);
          await refuse(() => modifier(exigeA35.id, corpsDevis({ tauxAcompte: valeur }), auth, porte), 400, REFUS.zero, `${qui}, devis exigé, case absente, ${quoi}`);
          await refuse(() => modifier(nonExige.id, corpsDevis({ acompteExige: true, tauxAcompte: valeur }), auth, porte), 400, REFUS.zero, `${qui}, devis non exigé passé à l’acompte exigé, ${quoi}`);
        }
        assert.deepEqual(await conditions(exigeA35.id), { acompteExige: true, tauxAcompte: '35' });
        assert.deepEqual(await conditions(nonExige.id), { acompteExige: false, tauxAcompte: null });
      }
    });

    // Cadrage : « 0 envoyé avec `acompteExige: false` est admis : le taux n'est pas enregistré, comme aujourd'hui » ; et,
    // sans la case, sur un devis qui n'exigeait pas d'acompte. Écarte un refus du 0 quel que soit l'acompte exigé, et un 0
    // enregistré sur un devis sans acompte.
    test('0 sans acompte exigé : admis à la création et à la modification, le taux n’est pas enregistré (null), en session et par clé', async () => {
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        for (const [quoi, valeur] of FORMES_ZERO) {
          const cree = await ok(creer(corpsDevis({ acompteExige: false, tauxAcompte: valeur }), auth, porte), 201);
          assert.equal(cree.tauxAcompte, null, `${qui}, création, ${quoi}`);
          assert.deepEqual(await conditions(cree.id), { acompteExige: false, tauxAcompte: null }, `${qui}, création, ${quoi}`);
          const exigeA35 = await creerOk({ acompteExige: true, tauxAcompte: 35 });
          await ok(modifier(exigeA35.id, corpsDevis({ acompteExige: false, tauxAcompte: valeur }), auth, porte));
          assert.deepEqual(await conditions(exigeA35.id), { acompteExige: false, tauxAcompte: null }, `${qui}, case décochée, ${quoi}`);
          const nonExige = await creerOk({ acompteExige: false });
          await ok(modifier(nonExige.id, corpsDevis({ tauxAcompte: valeur }), auth, porte));
          assert.deepEqual(await conditions(nonExige.id), { acompteExige: false, tauxAcompte: null }, `${qui}, devis non exigé, case absente, ${quoi}`);
        }
      }
    });

    // Cadrage : « Le cas se joue dans la transaction, à l'endroit actuel de l'appel (`routes.ts:106`). Il passe donc après
    // le 404, les 409, « Client introuvable » et les refus du temps passé » ; à la création, après « Client introuvable » et
    // le 409 du pas non réglé. Écarte un refus du 0 avancé dans le contrôle de forme.
    test('0 % exigé : refusé après le 404, les 409, « Client introuvable. » et le 409 du pas non réglé, en session et par clé', async () => {
      const signe = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      await signer(signe.id);
      const refuse409 = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      await refuser(refuse409.id);
      const brouillon = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      const ligneTp = { tempsPasse: true, designation: 'TEST Main d’œuvre au temps passé', quantite: 1, tarifTempsPasse: 'HORS_CONTRAT', catalogueFamille: 'prestations', catalogueId: mainOeuvre.id };
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        const zero = { acompteExige: true, tauxAcompte: 0 };
        await refuse(() => modifier(randomUUID(), corpsDevis(zero), auth, porte), 404, REFUS.introuvable, `${qui}, devis inconnu`);
        await refuse(() => modifier(signe.id, corpsDevis(zero), auth, porte), 409, REFUS.signe, `${qui}, devis signé`);
        await refuse(() => modifier(refuse409.id, corpsDevis(zero), auth, porte), 409, REFUS.nonModifiable, `${qui}, devis refusé`);
        await refuse(() => modifier(brouillon.id, { ...corpsDevis(zero), clientId: randomUUID() }, auth, porte), 400, REFUS.client, `${qui}, modification, client inconnu`);
        await refuse(() => modifier(brouillon.id, corpsDevis({ ...zero, auTempsPasse: true, lignes: [ligneTp] }), auth, porte), 409, REFUS.pasNonRegle, `${qui}, modification, passage au temps passé, pas non réglé`);
        await refuse(() => creer({ ...corpsDevis(zero), clientId: randomUUID() }, auth, porte), 400, REFUS.client, `${qui}, création, client inconnu`);
        await refuse(() => creer(corpsDevis({ ...zero, auTempsPasse: true, lignes: [ligneTp] }), auth, porte), 409, REFUS.pasNonRegle, `${qui}, création, pas non réglé`);
      }
    });

    // Cadrage, « Taux par défaut à 0 % : non traité, question pour Nelson (Q1) » : « le devis est enregistré exigé à 0 %, et
    // la duplication recopie le taux par défaut ». État actuel, gardé en attente de Q1, et non une règle : ce test prouve que
    // le refus vise le 0 % envoyé, et non le taux qui résulte du calcul (un refus du taux calculé refuserait la clé absente).
    test('taux par défaut réglé à 0 % (Q1, comportement actuel gardé) : un taux absent ou vide donne un devis exigé à 0 %, la duplication recopie 0 ; seul le 0 envoyé est refusé', async () => {
      await avecTauxParDefaut(0, async () => {
        for (const [quoi, extra] of [['clé absente', {}], ['null', { tauxAcompte: null }], ['chaîne vide', { tauxAcompte: '' }]]) {
          const cree = await ok(creer(corpsDevis({ acompteExige: true, ...extra })), 201);
          assert.deepEqual(await conditions(cree.id), { acompteExige: true, tauxAcompte: '0' }, quoi);
        }
        const source = await creerOk({ acompteExige: true, tauxAcompte: 35 });
        const duplicata = await ok(appeler('post', `/api/devis/${source.id}/duplication`, {}), 201);
        assert.deepEqual(await conditions(duplicata.id), { acompteExige: true, tauxAcompte: '0' }, 'duplication : taux par défaut du jour');
        await refuse(() => creer(corpsDevis({ acompteExige: true, tauxAcompte: 0 })), 400, REFUS.zero, '0 envoyé');
      });
    });

    // ==================================================================================================================
    // Acompte déjà encaissé (cadrage, section 1).
    // ==================================================================================================================

    // Test nommé du cadrage : « un brouillon exigé à 30 %, l'acompte constaté, puis `PATCH` avec 0, puis 50, puis « abc ».
    // Attendu : 200 avec les conditions inchangées, 200 inchangé, puis 400. La base reste inchangée » (conditions et acompte
    // constaté ; le refus n'écrit rien du tout). Écarte un refus du 0 placé avant la reprise des conditions encaissées, et un
    // taux encaissé renégocié (50). Lu aussi par clé, et sur un devis envoyé.
    test('acompte encaissé : un PATCH avec 0 puis 50 garde les conditions (200), « abc » est refusé (400) sans écriture, en session et par clé, brouillon ou envoyé', async () => {
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        for (const envoye of [false, true]) {
          const devis = await creerOk({ acompteExige: true, tauxAcompte: 30 });
          if (envoye) await ok(appeler('put', `/api/devis/${devis.id}/statut`, { statut: 'ENVOYE' }));
          const recuLe = await aujourdhui();
          await ok(appeler('post', `/api/devis/${devis.id}/acompte`, { recuLe, montant: '72,00', reference: `TEST-ACOMPTE-${suffixe()}` }));
          const encaisse = async () => {
            const d = await prisma.devis.findUniqueOrThrow({ where: { id: devis.id } });
            return [d.acompteExige, d.tauxAcompte?.toString(), d.acompteRecuLe?.toISOString(), d.acompteMontant?.toString(), d.acompteReference, d.acompteConstateParId, d.statut];
          };
          const avant = await encaisse();
          assert.deepEqual(avant.slice(0, 2), [true, '30']);
          assert.equal(avant[3], '72');
          const cas = `${qui}, devis ${envoye ? 'envoyé' : 'brouillon'}`;
          for (const valeur of [0, 50]) {
            const res = await ok(modifier(devis.id, corpsDevis({ objet: devis.objet, acompteExige: true, tauxAcompte: valeur }), auth, porte));
            assert.deepEqual([res.acompteExige, res.tauxAcompte], [true, 30], `${cas}, ${valeur} : réponse`);
            assert.deepEqual(await encaisse(), avant, `${cas}, ${valeur} : conditions et acompte constaté inchangés`);
          }
          await ok(modifier(devis.id, corpsDevis({ objet: devis.objet, acompteExige: false, tauxAcompte: 0 }), auth, porte));
          assert.deepEqual(await encaisse(), avant, `${cas}, case décochée : conditions inchangées`);
          await refuse(() => modifier(devis.id, corpsDevis({ objet: devis.objet, acompteExige: true, tauxAcompte: 'abc' }), auth, porte), 400, REFUS.taux, `${cas}, « abc »`);
          assert.deepEqual(await encaisse(), avant, `${cas} : base inchangée`);
        }
      }
    });

    // ==================================================================================================================
    // Section 2 : devis inconnu, 404 et non 400 (#252 N3, #426 pour le devis).
    // ==================================================================================================================

    // Cadrage, section 2 : « Toutes les routes du domaine qui répondent 400 « Devis introuvable. » passent à 404 », en
    // session sur la modification, la révision, la signature, la conversion et l'annulation, et par clé sur la
    // modification, la révision et la conversion ; « L'ordre est inchangé : la forme du corps (400) passe avant
    // l'existence du devis ». Chaque compte qui écrit les devis (l'annulation : l'administration seule, requireAdmin).
    // Lecture écartée : 400 « Devis introuvable. » (avant le lot).
    test('devis inconnu : 404 « Devis introuvable. » sur la modification, la révision, la signature, la conversion et l’annulation en session, par chaque compte qui y a droit, sans écriture', async () => {
      const id = randomUUID();
      const ROUTES = [
        ['modification', 'patch', `/api/devis/${id}`, () => corpsDevis({ acompteExige: true, tauxAcompte: '30' }), false],
        ['révision', 'post', `/api/devis/${id}/revisions`, () => ({}), false],
        ['signature', 'post', `/api/devis/${id}/signature`, () => ({ signataire: 'TEST Signataire inconnu', confirme: true }), false],
        ['conversion en chantier', 'post', `/api/devis/${id}/convertir`, () => ({ cible: 'CHANTIER' }), false],
        ['annulation', 'post', `/api/devis/${id}/annulation`, () => ({ motif: 'TEST Annulation d’un devis inconnu' }), true],
      ];
      for (const [compte, auth] of ECRIVENT()) {
        const administration = ['SA', 'AD', 'AD-COM', 'DIR'].includes(compte);
        for (const [route, methode, chemin, corps, reserveeAdministration] of ROUTES) {
          if (reserveeAdministration && !administration) {
            await refuse(() => appeler(methode, chemin, corps(), auth), 403, REFUS.administration, `${compte}, ${route} : réservée à l’administration`);
            continue;
          }
          await refuse(() => appeler(methode, chemin, corps(), auth), 404, REFUS.introuvable, `${compte}, ${route}`);
        }
      }
      // Conversion en intervention ou en contrat d'un devis inconnu, par l'administration : le devis manque d'abord.
      for (const cible of ['INTERVENTION', 'CONTRAT']) {
        await refuse(() => appeler('post', `/api/devis/${id}/convertir`, { cible }), 404, REFUS.introuvable, `SA, conversion en ${cible.toLowerCase()}`);
      }
    });

    test('devis inconnu par clé d’intégration : 404 « Devis introuvable. » sur la modification, la révision et la conversion ; la signature et l’annulation n’ont pas de route /api/v1', async () => {
      const id = randomUUID();
      await refuse(() => modifier(id, corpsDevis(), cles.devis, PORTES.cle), 404, REFUS.introuvable, 'clé, modification');
      await refuse(() => appeler('post', `/api/v1/devis/${id}/revisions`, {}, cles.devis), 404, REFUS.introuvable, 'clé, révision');
      await refuse(() => appeler('post', `/api/v1/devis/${id}/convertir`, { cible: 'CHANTIER' }, cles.devis), 404, REFUS.introuvable, 'clé, conversion');
      for (const [route, corps] of [['signature', { signataire: 'TEST Signataire', confirme: true }], ['annulation', { motif: 'TEST motif' }]]) {
        const res = await appeler('post', `/api/v1/devis/${id}/${route}`, corps, cles.devis);
        assert.equal(res.status, 404, `clé, ${route} : aucune route /api/v1 (${res.status} ${JSON.stringify(res.body)})`);
        assert.notEqual(res.body?.error, REFUS.introuvable, `clé, ${route} : la route n’existe pas, ce n’est pas le devis qui manque`);
      }
    });

    // Cadrage, section 2 : « la forme du corps (400) passe avant l'existence du devis, lue sous verrou ». Corps incomplet sur
    // un devis inconnu : 400 du corps, comme avant le lot (matrice entrees.txt : modification, signature, conversion et
    // annulation y restent en 400).
    test('devis inconnu : un corps mal formé reste refusé (400) avant le 404, en session et par clé', async () => {
      const id = randomUUID();
      await refuse(() => appeler('patch', `/api/devis/${id}`, {}), 400, REFUS.corps, 'session, modification, corps vide');
      await refuse(() => appeler('patch', `/api/v1/devis/${id}`, {}, cles.devis), 400, REFUS.corps, 'clé, modification, corps vide');
      await refuse(() => appeler('post', `/api/devis/${id}/signature`, {}), 400, REFUS.signataire, 'session, signature sans signataire');
      await refuse(() => appeler('post', `/api/devis/${id}/convertir`, {}), 400, REFUS.cible, 'session, conversion sans cible');
      await refuse(() => appeler('post', `/api/v1/devis/${id}/convertir`, {}, cles.devis), 400, REFUS.cible, 'clé, conversion sans cible');
      await refuse(() => appeler('post', `/api/devis/${id}/annulation`, {}), 400, REFUS.motif, 'session, annulation sans motif');
    });

    // Droits avant l'existence et avant la forme du taux : un compte sans devis:write reçoit 403, que le devis existe ou non
    // et que le taux soit valide ou non (il n'apprend ni l'existence d'un devis ni la règle du taux) ; une clé d'une autre
    // portée, 403 ; une session sur /api/v1, 401 ; une clé sur une route de session, 401. Sans écriture.
    test('droits : sans devis:write, 403 avant le 404 et avant le contrôle du taux ; clé d’une autre portée 403 ; session sur /api/v1 et clé sur une route de session 401', async () => {
      const existant = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      for (const [compte, auth] of SANS_DROIT()) {
        for (const taux of ['abc', '30', 0]) {
          await refuse(() => creer(corpsDevis({ acompteExige: true, tauxAcompte: taux }), auth), 403, REFUS.permission, `${compte}, création, ${taux}`);
          for (const id of [existant.id, randomUUID()]) {
            await refuse(() => modifier(id, corpsDevis({ acompteExige: true, tauxAcompte: taux }), auth), 403, REFUS.permission, `${compte}, modification, ${taux}`);
          }
        }
        for (const [route, corps] of [['revisions', {}], ['signature', { signataire: 'TEST Signataire', confirme: true }], ['convertir', { cible: 'CHANTIER' }]]) {
          await refuse(() => appeler('post', `/api/devis/${randomUUID()}/${route}`, corps, auth), 403, REFUS.permission, `${compte}, ${route} d’un devis inconnu`);
        }
        await refuse(() => appeler('post', `/api/devis/${randomUUID()}/annulation`, { motif: 'TEST motif' }, auth), 403, REFUS.administration, `${compte}, annulation d’un devis inconnu`);
      }
      for (const taux of ['abc', 0]) {
        await refuse(() => creer(corpsDevis({ acompteExige: true, tauxAcompte: taux }), cles.autre, PORTES.cle), 403, REFUS.scope, `clé devis:read, création, ${taux}`);
        await refuse(() => modifier(randomUUID(), corpsDevis({ acompteExige: true, tauxAcompte: taux }), cles.autre, PORTES.cle), 403, REFUS.scope, `clé devis:read, modification, ${taux}`);
        await refuse(() => creer(corpsDevis({ acompteExige: true, tauxAcompte: taux }), SA(), PORTES.cle), 401, REFUS.cleRequise, `session sur /api/v1, ${taux}`);
        await refuse(() => creer(corpsDevis({ acompteExige: true, tauxAcompte: taux }), cles.devis, PORTES.session), 401, REFUS.session, `clé sur /api/devis, ${taux}`);
      }
      assert.deepEqual(await conditions(existant.id), { acompteExige: true, tauxAcompte: '35' });
    });

    // ==================================================================================================================
    // Section 3 : taux par défaut lu avant la transaction (#250, #240).
    // ==================================================================================================================

    // Cadrage, section 3 : « des modifications simultanées au-delà du pool, `auDelaDuPool = max(2 × cpus + 2,
    // connection_limit + 1)` » ; « Toutes aboutissent, avec le taux par défaut relu en base » ; « Le test échoue sur `main` »
    // (la modification lisait le taux par le client global pendant sa transaction : chaque modification gardait sa connexion
    // et le verrou du devis, et en réclamait une seconde ; au-delà du pool, elles expiraient en 500). Taux par défaut à
    // 37,5 %, distinct de la valeur du schéma (C1 de l'audit de #250) : écarte une constante dans le code.
    test(`rafale : ${auDelaDuPool} modifications simultanées d’un même devis, au-delà du pool de connexions, aboutissent toutes (200), au taux par défaut de 37,5 % relu en base`, async () => {
      const cree = await creerOk({ objet: 'TEST Affaire modifiée en rafale', lignes: [ligneLibre({ quantite: 1 })] });
      await avecTauxParDefaut('37,5', async () => {
        const objets = Array.from({ length: auDelaDuPool }, (_, n) => `TEST Affaire modifiée en rafale ${n}`);
        // Acompte exigé sans taux : chaque modification lit le taux par défaut (la moitié avec un taux vide).
        const corps = objets.map((objet, n) => ({ clientId: client.id, objet, acompteExige: true, ...(n % 2 ? { tauxAcompte: '' } : {}), lignes: [ligneLibre({ quantite: 2 })] }));
        const reponses = await Promise.all(corps.map((c) => request(app).patch(`/api/devis/${cree.id}`).set(SA()).send(c)));
        assert.deepEqual(reponses.map((r) => r.status), Array(auDelaDuPool).fill(200), JSON.stringify(reponses.map((r) => r.body.error).filter(Boolean)));
        const relu = await prisma.devis.findUniqueOrThrow({ where: { id: cree.id }, include: { lignes: true } });
        assert.ok(objets.includes(relu.objet), relu.objet);
        assert.deepEqual([relu.acompteExige, relu.tauxAcompte.toString(), relu.totalHt.toString()], [true, '37.5', '200'], 'le taux par défaut lu avant la transaction');
        assert.equal(relu.lignes.length, 1, 'chaque modification remplace les lignes, sans doublon');
      });
    });

    // ==================================================================================================================
    // Copie figée : révision, duplication, paramètre changé après coup.
    // ==================================================================================================================

    // Le taux saisi « 12,25 » est figé sur le devis : le taux par défaut changé ensuite ne le touche pas ; la révision du
    // devis signé le recopie exactement ; la duplication relit le taux par défaut du jour (comportement inchangé). Écarte
    // une révision qui relirait le défaut (37,5), une duplication qui recopierait le taux source (12,25), et un arrondi au
    // dixième (12,3 ou 12,2).
    test('copie figée : un taux saisi « 12,25 » reste 12,25 quand le taux par défaut change, la révision le recopie exactement, la duplication relit le taux par défaut du jour (37,5 %)', async () => {
      const devis = await creerOk({ acompteExige: true, tauxAcompte: '12,25' });
      await signer(devis.id);
      await avecTauxParDefaut('37,5', async () => {
        assert.deepEqual(await conditions(devis.id), { acompteExige: true, tauxAcompte: '12.25' }, 'devis émis inchangé');
        const revision = await ok(appeler('post', `/api/devis/${devis.id}/revisions`, {}), 201);
        assert.equal(revision.tauxAcompte, 12.25);
        assert.deepEqual(await conditions(revision.id), { acompteExige: true, tauxAcompte: '12.25' }, 'révision');
        const duplicata = await ok(appeler('post', `/api/devis/${devis.id}/duplication`, {}), 201);
        assert.deepEqual(await conditions(duplicata.id), { acompteExige: true, tauxAcompte: '37.5' }, 'duplication');
        // La révision brouillon se modifie : la clé absente garde 12,25 ; « abc » est refusé sans écriture.
        await ok(modifier(revision.id, corpsDevis({ objet: revision.objet })));
        assert.deepEqual(await conditions(revision.id), { acompteExige: true, tauxAcompte: '12.25' }, 'révision modifiée sans taux');
        await refuse(() => modifier(revision.id, corpsDevis({ objet: revision.objet, tauxAcompte: 'abc' })), 400, REFUS.taux, 'révision, « abc »');
      });
    });

    // ==================================================================================================================
    // Section 4, côté serveur : lignes saisies à la virgule, envoyées brutes par l'écran (#394 pour le devis).
    // ==================================================================================================================

    // Cadrage, section 4 : « `updateLine` (…) garde en chaîne la quantité, le PU et la TVA (…). Ces valeurs sont envoyées
    // brutes, puisque le serveur lit la virgule » ; critère « quantité « 1,5 », PU « 18,75 », TVA « 5,5 » ». Montant : 1,5 ×
    // 18,75 = 28,125, arrondi commercial à 28,13 (au pair ou tronqué : 28,12) ; TVA 5,5 % de 28,13 = 1,54715, soit 1,55 ;
    // TTC 29,68 (témoin en centimes entiers ci-dessous). Lectures écartées : « 1,5 » lu 15 par un champ numérique d'un
    // navigateur anglais (15 × 18,75 = 281,25) ; « 18,75 » lu 1 875 (2 812,50) ; « 5,5 » lu 55 (refusé, TVA non française) ;
    // `parseFloat` (1 × 18 = 18). Même montant en session et par clé, à la création et à la modification.
    test('lignes à la virgule : quantité « 1,5 », PU « 18,75 », TVA « 5,5 » enregistrées exactement (28,13 € HT, 1,55 € de TVA, 29,68 € TTC), à la création et à la modification, en session et par clé', async () => {
      // Témoin en décimal exact : quantité en millièmes (1 500), prix en centimes (1 875) ; le produit est en millièmes de
      // centime, ramené au centime le plus proche, demi vers le haut. TVA : 5,5 % = 55 ‰, au centime, demi vers le haut.
      const ht = (1_500n * 1_875n + 500n) / 1_000n;
      const tva = (ht * 55n + 500n) / 1_000n;
      assert.deepEqual([ht, tva, ht + tva], [2813n, 155n, 2968n]);
      const ligne = { designation: 'TEST Fourniture à la virgule', nature: 'FOURNITURE', quantite: '1,5', prixUnitaireHt: '18,75', tauxTva: '5,5' };
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        const cree = await ok(creer(corpsDevis({ lignes: [ligne] }), auth, porte), 201);
        const autre = await creerOk({ lignes: [ligneLibre()] });
        await ok(modifier(autre.id, corpsDevis({ objet: autre.objet, lignes: [ligne] }), auth, porte));
        for (const [cas, id] of [['création', cree.id], ['modification', autre.id]]) {
          const d = await prisma.devis.findUniqueOrThrow({ where: { id }, include: { lignes: true } });
          assert.deepEqual(d.lignes.map((l) => [l.quantite.toString(), l.prixUnitaireHt.toString(), l.tauxTva.toString(), l.totalHt.toString(), l.totalTtc.toString()]), [['1.5', '18.75', '5.5', '28.13', '29.68']], `${qui}, ${cas} : ligne`);
          assert.deepEqual([d.totalHt.toString(), d.totalTva.toString(), d.totalTtc.toString()], ['28.13', '1.55', '29.68'], `${qui}, ${cas} : totaux`);
        }
      }
    });
  });
}
