// Lot X « Clé d'envoi de la création d'un avoir partiel » (#247 ; cadrage v2 du 23-11-2026, après le contrôle de cohérence de
// mode 1, « Tests à écrire »). Origine : note N3 de l'audit de #242 (un double envoi de POST /api/factures/:id/avoirs peut émettre
// deux avoirs, chacun figé) et note N5 (après une issue inconnue, l'écran ne peut pas nommer l'avoir émis).
//
// Décision appliquée : message de Nelson du 22-11-2026 (soir), point 3, mot pour mot : « 3. Je ne comprend pas. Decide ce qui est
// le mieux en tenant compte de ce qui se fait dans ce genre d'application, sinon exolique moi simplement pour que je puisse y
// repondre ». Lecture retenue par le cadrage, à corriger par Nelson si besoin : décision déléguée à Claude Code ; choix par défaut,
// à confirmer : une clé tirée par le formulaire et enregistrée sur l'avoir, sur le modèle de la clé d'envoi du compte rendu (lot
// 3b-3, #268).
//
// Contrat éprouvé (cadrage v2, § 2, et messages exacts donnés par Claude Code) :
//  - champ du corps `cleEnvoi`, facultatif (absent ou null : comportement d'avant) ; sinon un UUID (cleEnvoiValide), mis en
//    minuscules ; mal formée : 400 « Clé d’envoi de l’avoir invalide : rouvrez le formulaire. », lue avant la transaction (donc
//    avant le 404 du périmètre et le 409 du statut), sans écriture ;
//  - rejeu sous le verrou de la facture d'origine, après sa relecture dans le périmètre (404 d'abord), avant tout autre contrôle
//    et toute écriture (statut, taux, plafonds, identité de l'émetteur, séquence) : rendu seulement si l'avoir de la clé est un
//    avoir partiel de cette facture, créé par ce compte, aux mêmes lignes (ordre, désignation, nature, quantité, prix unitaire HT,
//    taux, comparés en décimal après lignesAvoirPartiel) : 200, même corps qu'à la création, `dejaEnregistre: true` ; sinon 409
//    « Cette clé d’envoi a déjà servi pour une autre demande d’avoir : rouvrez le formulaire. », corps `{ error }` seul ;
//  - le rejeu n'écrit rien (avoir, numéro, identité de l'émetteur, journal, statut de règlement) ;
//  - P2002 de cible `cleEnvoi` (distingué du numéro et de l'avoir total) relu hors transaction, rendu comme ci-dessus, jamais 500 ;
//  - droits inchangés (requireGestionFactures, pieceVisible) ; aucune route /api/v1 ne crée d'avoir : une clé d'intégration
//    reçoit 401.
// Chaque refus et chaque rejeu sont prouvés par l'empreinte de toute la base (journal, séquence, identité, écritures compris) et
// par la séquence des avoirs relue inchangée. La migration elle-même (base existante, base neuve) est éprouvée par
// avoir-cle-envoi-migration.test.mjs.
//
// Montants : le lot ne change aucun calcul. Les attendus de montant (reste dû, totaux de l'avoir rendu) servent à distinguer « un
// seul avoir émis » de « deux avoirs émis » ; les lignes des demandes refusées sont choisies pour donner les mêmes totaux que la
// demande d'origine, afin qu'une comparaison des totaux au lieu des lignes soit vue. La lecture écartée est écrite à chaque attendu.
//
// Comme avoir-non-nul.test.mjs, ce fichier crée sur le serveur de TEST_DATABASE_URL une base jetable qui n'appartient qu'à lui
// (« test » comme mot, suffixe tiré au hasard), la migre, la sert à l'application montée en mémoire, puis la supprime : l'empreinte
// de toute la base et le décompte des attentes de verrou n'y voient que ce fichier. Sans TEST_DATABASE_URL, le fichier s'annonce
// ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';

const TITRE = 'Clé d’envoi de la création d’un avoir partiel (#247) : un même envoi rend l’avoir déjà émis, une clé déjà servie pour une autre demande est refusée, une clé mal formée aussi, sans clé rien ne change';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROLE_AT = 'ASSISTANTE_TECHNIQUE';
const AUTRES_TYPES = [
  ['CT', 'CONDUCTEUR_TRAVAUX'], ['RESP', 'RESPONSABLE'], ['TECH', 'TECHNICIEN'], ['COM', 'COMMERCIAL'],
  ['DC', 'DIRECTEUR_COMMERCIAL'], ['AC', 'ASSISTANTE_COMMERCIALE'], ['CPT', 'COMPTABLE'],
];

// Messages exacts de l'API (apostrophes typographiques).
const REFUS = {
  cleInvalide: 'Clé d’envoi de l’avoir invalide : rouvrez le formulaire.',
  cleServie: 'Cette clé d’envoi a déjà servi pour une autre demande d’avoir : rouvrez le formulaire.',
  ancienP2002: 'Avoir total déjà créé ou numéro déjà attribué, veuillez relire la facture.',
  introuvable: 'Facture introuvable.',
  nonCreditable: 'Seule une facture émise ou réglée peut recevoir un avoir partiel.',
  plafondTotal: 'Cet avoir dépasse le montant total restant à créditer sur la facture d’origine.',
  tauxAbsent: 'Le taux de TVA d’une ligne d’avoir doit être présent sur la facture d’origine.',
  ligneInvalide: 'Ligne d’avoir partiel invalide.',
  gestion: 'Accès réservé à l’administration et à l’assistante technique.',
  identite: 'Identité de la société incomplète : renseignez SIRET dans l’écran Société avant d’émettre.',
};
// Message exact du déclencheur facture_cle_envoi_figee (check_violation, 23514).
const FIGEE = 'La clé d’envoi d’une pièce ne se modifie pas.';

// --- Jeu de lignes ---
const ligne = (designation, quantite, prixUnitaireHt, tauxTva = 20, nature = 'PRESTATION') => ({ designation: `TEST clé ${designation}`, nature, quantite, prixUnitaireHt, tauxTva });
// Facture de 120,00 € : 1 × 100,00 € HT à 20 %.
const LIGNES_CENT = [ligne('maintenance annuelle', 1, 100)];
// Facture de 230,00 € à deux taux : 1 × 100,00 € HT à 20 % (TVA 20,00 €) et 1 × 100,00 € HT à 10 % (TVA 10,00 €).
const LIGNES_DEUX_TAUX = [ligne('maintenance annuelle', 1, 100, 20), ligne('travaux de reprise', 1, 100, 10)];
// Avoir de 12,00 € : 1 × 10,00 € HT à 20 %. Sur la facture de 120,00 €, reste dû 108,00 € après un avoir, 96,00 € après deux
// (lecture écartée par chaque « reste dû 108 » : le second envoi émet un second avoir).
const DIX = () => [ligne('geste commercial', 1, 10)];
// Avoir de deux lignes, 1 × 4,00 € et 1 × 6,00 € HT à 20 % : HT 10,00 €, TVA 2,00 €, TTC 12,00 €.
const DEUX_LIGNES = () => [ligne('geste A', 1, 4), ligne('geste B', 1, 6)];

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_avoir_cle_envoi_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;
    const environnementAvant = {};
    const NOMS_ENVIRONNEMENT = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID'];

    let request; let app; let prisma; let appPrisma; let jwt; let sql;
    let session = '';
    const comptes = {};
    let rang = 0;
    const suffixe = () => `${Date.now()}${(rang += 1)}`;
    let client = null;

    // --- Appels ---
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const sa = () => entete(session);
    const par = (cle) => (cle === 'SA' ? sa() : entete(jwt.sign({ id: comptes[cle].id }, process.env.JWT_SECRET)));
    const appeler = (methode, chemin, corps, auth = sa()) => {
      const requete = request(app)[methode](`/api${chemin}`);
      if (auth) requete.set(auth);
      return methode === 'get' ? requete : requete.send(corps ?? {});
    };
    const ok = async (reponse, statut = 200) => {
      const res = await reponse;
      assert.equal(res.status, statut, `${res.req?.method} ${res.req?.path} : ${res.status} ${JSON.stringify(res.body)}`);
      return res.body;
    };
    const jour = () => {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date());
      const v = (type) => parts.find((p) => p.type === type).value;
      return { fr: `${v('day')}-${v('month')}-${v('year')}`, annee: Number(v('year')) };
    };

    // --- État de la base ---
    // Empreinte de toute la base (modèle : avoir-non-nul.test.mjs) : chaque table du schéma public, hors historique des migrations,
    // nombre de lignes et empreinte du contenu. Un refus ou un rejeu n'y change rien, ni `updatedAt`, ni journal, ni séquence.
    const sqlEmpreinte = (table) => `SELECT '${table}' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${table}" x`;
    let requeteEmpreinte = null;
    const empreinte = async () => {
      if (!requeteEmpreinte) {
        const tables = (await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`).map((t) => t.tablename);
        assert.ok(['Facture', 'FactureLigne', 'SequenceAvoir', 'JournalFacture', 'EcritureFacture', 'IdentiteEmetteur'].every((t) => tables.includes(t)), `tables relevées : ${tables.join(', ')}`);
        assert.ok(tables.every((table) => /^[A-Za-z_]+$/.test(table)), 'noms de tables sans guillemet');
        requeteEmpreinte = tables.map(sqlEmpreinte).join(' UNION ALL ');
      }
      return Object.fromEntries((await prisma.$queryRawUnsafe(requeteEmpreinte)).map(({ t, n, h }) => [t, `${n}:${h}`]));
    };
    const tablesChangees = (avant, apres) => Object.keys({ ...avant, ...apres }).filter((t) => avant[t] !== apres[t]);
    const sequence = async () => (await prisma.sequenceAvoir.findUnique({ where: { annee: jour().annee } }))?.dernierNumero ?? 0;
    // Un refus de l'API : statut et message exacts, corps `{ error }` seul, empreinte de toute la base et séquence inchangées.
    const refuse = async (appel, statut, message, quoi) => {
      const [avant, sequenceAvant] = [await empreinte(), await sequence()];
      const res = await appel();
      assert.deepEqual([res.status, res.body?.error], [statut, message], `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(Object.keys(res.body), ['error'], `${quoi} : rien d’autre que le message (aucune donnée de l’avoir de la clé)`);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      assert.equal(await sequence(), sequenceAvant, `${quoi} : aucun numéro d’avoir consommé`);
      return res;
    };
    // Un rejeu : 200, le corps de la création et `dejaEnregistre: true`, rien d'écrit (ni avoir, ni numéro, ni journal, ni identité
    // de l'émetteur, ni statut de règlement).
    const rejoue = async (appel, creation, quoi) => {
      const [avant, sequenceAvant] = [await empreinte(), await sequence()];
      const res = await appel();
      assert.equal(res.status, 200, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, { ...creation, dejaEnregistre: true }, `${quoi} : même corps qu’à la création, avec dejaEnregistre`);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : un rejeu n’écrit rien`);
      assert.equal(await sequence(), sequenceAvant, `${quoi} : aucun numéro d’avoir consommé`);
      return res.body;
    };
    // Clé relue en base, en texte (indépendant du client Prisma généré).
    const cleEnBase = async (id) => (await sql.query('SELECT "cleEnvoi"::text AS cle FROM "Facture" WHERE id = $1', [id])).rows[0].cle;
    const avoirsDe = async (factureId) => (await prisma.facture.findMany({ where: { factureOrigineId: factureId }, orderBy: { createdAt: 'asc' }, select: { id: true, numero: true, createdById: true } }));
    const journalDe = async (pieceId) => (await prisma.journalFacture.findMany({ where: { factureId: pieceId }, orderBy: { createdAt: 'asc' }, select: { action: true, acteurId: true } }));
    // Soldes d'une pièce dans la liste non paginée de l'administration : [statut, montantAvoirs, montantRegle, resteDu].
    const soldes = async (id) => {
      const f = (await ok(appeler('get', '/factures', null, par('AD')))).find((x) => x.id === id);
      return f ? [f.statut, f.montantAvoirs, f.montantRegle, f.resteDu] : null;
    };
    const nombres = (liste) => liste.map((valeur) => (valeur === null || valeur === undefined ? valeur : Number(valeur)));
    // Attentes de verrou dans cette base (propre au fichier).
    const attentesVerrou = async () => (await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database() AND wait_event_type = 'Lock'`)[0].n;
    const requetesEnAttente = async () => (await prisma.$queryRaw`SELECT query FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database() AND wait_event_type = 'Lock'`).map((r) => r.query);
    const attendreAttentes = async (n) => {
      for (let tour = 0; tour < 400; tour += 1) {
        if (await attentesVerrou() >= n) return true;
        await new Promise((r) => setTimeout(r, 20));
      }
      return false;
    };
    // Transaction de test tenue jusqu'à son relâchement.
    const tenirTransaction = async (travail) => {
      let liberer; let pret;
      const attente = new Promise((r) => { liberer = r; });
      const tenu = new Promise((r) => { pret = r; });
      const fin = prisma.$transaction(async (tx) => { await travail(tx); pret(); await attente; }, { timeout: 20000 });
      await tenu;
      return async () => { liberer(); await fin; };
    };

    // --- Données ---
    const creerCompte = async (cle, role) => {
      const s = suffixe();
      comptes[cle] = await prisma.user.create({ data: { email: `cle.${cle.toLowerCase()}.${s}@iris.test`, name: `TEST clé ${cle} ${s}`, role } });
    };
    const brouillon = (auth, motif, lignes) => ok(appeler('post', '/factures', {
      clientId: client.id, dateEmission: jour().fr, dateEcheance: jour().fr, lignes, origine: 'HORS_AFFAIRE', motifHorsAffaire: `TEST clé ${motif} ${suffixe()}`,
    }, auth), 201);
    const factureEmise = async (auth, motif, lignes = LIGNES_CENT) => ok(appeler('post', `/factures/${(await brouillon(auth, motif, lignes)).id}/emettre`, {}, auth));
    const avoir = (id, corps, auth) => appeler('post', `/factures/${id}/avoirs`, corps, auth);
    const avoirCree = (id, corps, auth) => ok(avoir(id, corps, auth), 201);

    before(async () => {
      assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname), 'seul un PostgreSQL local est autorisé');
      assert.notEqual(source.pathname.slice(1), nomBase);
      await administrationPg.connect();
      await administrationPg.query(`CREATE DATABASE "${nomBase}"`);
      baseCreee = true;
      execFileSync(resolve(dossierServeur, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', resolve(dossierServeur, 'prisma/schema.prisma')], {
        env: { ...process.env, DATABASE_URL: cible.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
      });
      for (const nom of NOMS_ENVIRONNEMENT) environnementAvant[nom] = process.env[nom];
      delete process.env.AZURE_TENANT_ID;
      delete process.env.AZURE_CLIENT_ID;
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
      const { PrismaClient } = await import('@prisma/client');
      prisma = new PrismaClient({ datasources: { db: { url: cible.toString() } } });
      sql = new pg.Client({ connectionString: cible.toString() });
      await sql.connect();
      jwt = (await import('jsonwebtoken')).default;
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      session = connexion.body.token;
      // Identité de la société, plan comptable à deux taux, mentions légales publiées.
      await ok(appeler('put', '/company', { raisonSociale: 'TEST Émetteur clé', siret: '24724724700047', adresse: '47 rue des Avoirs', codePostal: '14000', ville: 'Caen', fuseauHoraire: 'Europe/Paris' }));
      const compte = (code, libelle, nature) => ok(appeler('post', '/comptabilite/comptes', { code, libelle, nature }), 201);
      const clients = await compte('411000', 'TEST Clients clé', 'ACTIF');
      const prestations = await compte('706000', 'TEST Prestations clé', 'PRODUIT');
      const articles = await compte('707000', 'TEST Articles clé', 'PRODUIT');
      const tva20 = await compte('445710', 'TEST TVA 20 clé', 'TVA');
      const tva10 = await compte('445712', 'TEST TVA 10 clé', 'TVA');
      const motif = 'TEST paramétrage comptable du lot clé';
      for (const [cle, donnees] of [['CLIENT', { compteId: clients.id }], ['VENTE_PRESTATION', { compteId: prestations.id }], ['VENTE_ARTICLE', { compteId: articles.id }], ['JOURNAL_VENTES', { journal: 'VE' }]]) {
        await ok(appeler('put', `/comptabilite/regles/${cle}`, { ...donnees, motif }));
      }
      await ok(appeler('put', '/comptabilite/tva/20', { compteId: tva20.id, motif }));
      await ok(appeler('put', '/comptabilite/tva/10', { compteId: tva10.id, motif }));
      const version = await ok(appeler('post', '/mentions-legales', { mentions: 'TEST mentions clé', cgv: 'TEST CGV clé', penalites: 'TEST pénalités clé' }), 201);
      await ok(appeler('post', `/mentions-legales/${version.version}/publier`));
      for (const [cle, role] of [['AT', ROLE_AT], ['AT2', ROLE_AT], ['AD', 'ADMIN'], ['DIR', 'DIRECTEUR'], ...AUTRES_TYPES]) await creerCompte(cle, role);
      for (let essai = 1; ; essai += 1) {
        const res = await appeler('post', '/clients', { raisonSociale: `TEST Client clé ${suffixe()}`, siren: String(randomInt(100_000_000, 1_000_000_000)) });
        if (res.status === 409 && essai < 5) continue;
        assert.equal(res.status, 201, JSON.stringify(res.body));
        client = res.body;
        break;
      }
      await ok(appeler('post', `/clients/${client.id}/sites`, { nom: 'TEST Facturation clé', adresse: '47 rue des Avoirs', codePostal: '14000', ville: 'Caen', estSiteFacturation: true }), 201);
    });

    after(async () => {
      await sql?.end().catch(() => {});
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      for (const nom of NOMS_ENVIRONNEMENT) { if (environnementAvant[nom] === undefined) delete process.env[nom]; else process.env[nom] = environnementAvant[nom]; }
      if (baseCreee) await administrationPg.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`).catch(() => {});
      await administrationPg.end().catch(() => {});
    });

    // Cadrage v2, « Tests à écrire » : 201 puis 200 `dejaEnregistre`, clé en majuscules ; par chaque type de compte qui crée un avoir
    // (super administrateur, administrateur, directeur aligné sur l'administration, assistante technique sur sa facture, et
    // l'administration sur la facture de l'assistante). Lecture écartée : le second envoi émet un second avoir (201, deux numéros,
    // reste dû 96,00 € au lieu de 108,00 €).
    test('même envoi répété : 201 puis 200 au même corps avec dejaEnregistre, clé envoyée en majuscules ou en minuscules relue et enregistrée en minuscules, rien d’écrit au rejeu, un seul avoir et un seul numéro (reste dû 108,00 €) ; par le super administrateur, l’administrateur, le directeur, l’assistante technique et l’administration sur la facture de l’assistante', async () => {
      for (const [auteur, emetteur, majusculesALaCreation] of [['SA', 'AD', false], ['AD', 'AD', true], ['DIR', 'AD', false], ['AT', 'AT', true], ['AD', 'AT', false]]) {
        const quoi = `${auteur} sur une facture de ${emetteur}`;
        const facture = await factureEmise(par(emetteur), `rejeu ${quoi}`);
        const cle = randomUUID();
        const [cleCreation, cleRejeu] = majusculesALaCreation ? [cle.toUpperCase(), cle] : [cle, cle.toUpperCase()];
        const sequenceAvant = await sequence();
        const creation = await avoirCree(facture.id, { lignes: DIX(), cleEnvoi: cleCreation }, par(auteur));
        assert.deepEqual([creation.type, creation.estAvoirAnnulation, creation.factureOrigineId, ...nombres([creation.totalHt, creation.totalTva, creation.totalTtc])], ['AVOIR', false, facture.id, 10, 2, 12], quoi);
        assert.equal(await sequence(), sequenceAvant + 1, `${quoi} : un numéro`);
        // Mise en minuscules (cadrage v2, § 2) : la clé enregistrée est celle de cleEnvoiValide.
        assert.equal(await cleEnBase(creation.id), cle, `${quoi} : clé enregistrée en minuscules`);
        assert.deepEqual(await journalDe(creation.id), [{ action: 'CREATION_AVOIR_PARTIEL', acteurId: auteur === 'SA' ? creation.createdById : comptes[auteur].id }], `${quoi} : une entrée de journal`);
        await rejoue(() => avoir(facture.id, { lignes: DIX(), cleEnvoi: cleRejeu }, par(auteur)), creation, `${quoi}, rejeu avec la clé en ${majusculesALaCreation ? 'minuscules' : 'majuscules'}`);
        // Le même rejeu, une seconde fois : toujours 200, toujours rien d'écrit.
        await rejoue(() => avoir(facture.id, { lignes: DIX(), cleEnvoi: cleCreation }, par(auteur)), creation, `${quoi}, second rejeu`);
        assert.deepEqual((await avoirsDe(facture.id)).map((a) => a.id), [creation.id], `${quoi} : un seul avoir`);
        assert.deepEqual(await journalDe(creation.id), [{ action: 'CREATION_AVOIR_PARTIEL', acteurId: creation.createdById }], `${quoi} : toujours une seule entrée de journal`);
        // Lecture écartée : deux avoirs de 12,00 € (reste dû 96,00 €).
        assert.deepEqual(await soldes(facture.id), ['EMISE', 12, 0, 108], `${quoi} : reste dû d’un seul avoir`);
      }
    });

    // Cadrage v2 : « cinq rejeux simultanés : un 201, quatre 200 ». Le verrou de la facture d'origine les sérialise : le premier émet
    // l'avoir, les quatre autres le relisent sous le verrou. Lecture écartée : cinq avoirs (60,00 €, reste dû 60,00 €), ou une
    // erreur serveur sur l'index unique.
    test('cinq envois simultanés de la même demande : un 201 et quatre 200 au même corps (dejaEnregistre), un seul avoir, un seul numéro, une seule entrée de journal, aucun 500, reste dû 108,00 € ; par l’administration et par l’assistante technique sur sa facture ; avoir qui solde la facture : quatre 200 et non le refus du plafond, une seule transition « réglée »', async () => {
      for (const auteur of ['AD', 'AT']) {
        const facture = await factureEmise(par(auteur), `cinq envois ${auteur}`);
        const cle = randomUUID();
        const sequenceAvant = await sequence();
        const reponses = await Promise.all(Array.from({ length: 5 }, () => avoir(facture.id, { lignes: DIX(), cleEnvoi: cle }, par(auteur))));
        assert.deepEqual(reponses.map((r) => r.status).sort(), [200, 200, 200, 200, 201], `${auteur} : ${JSON.stringify(reponses.map((r) => [r.status, r.body?.error]))}`);
        const creation = reponses.find((r) => r.status === 201).body;
        for (const relue of reponses.filter((r) => r.status === 200)) assert.deepEqual(relue.body, { ...creation, dejaEnregistre: true }, `${auteur} : même corps qu’à la création`);
        assert.equal(await sequence(), sequenceAvant + 1, `${auteur} : un seul numéro`);
        const avoirs = await avoirsDe(facture.id);
        assert.deepEqual(avoirs.map((a) => a.id), [creation.id], `${auteur} : un seul avoir`);
        assert.equal(await cleEnBase(creation.id), cle);
        assert.deepEqual((await journalDe(creation.id)).map((e) => e.action), ['CREATION_AVOIR_PARTIEL'], `${auteur} : une seule entrée de journal`);
        assert.deepEqual(await soldes(facture.id), ['EMISE', 12, 0, 108], `${auteur} : reste dû d’un seul avoir`);
      }
      // Avoir qui solde la facture (1 × 100,00 € HT à 20 %, 120,00 € TTC) : les quatre demandes qui suivent la première trouvent
      // une facture « réglée » sans reste à créditer. Rejeu sous le verrou, avant le plafond : 200. Lectures écartées : clé
      // cherchée avant le verrou (les quatre reçoivent alors le 409 du plafond) ; plafond contrôlé avant le rejeu.
      const soldee = await factureEmise(par('AD'), 'cinq envois qui soldent');
      const cle = randomUUID();
      const reponses = await Promise.all(Array.from({ length: 5 }, () => avoir(soldee.id, { lignes: LIGNES_CENT, cleEnvoi: cle }, par('AD'))));
      assert.deepEqual(reponses.map((r) => r.status).sort(), [200, 200, 200, 200, 201], `avoir qui solde : ${JSON.stringify(reponses.map((r) => [r.status, r.body?.error]))}`);
      const creation = reponses.find((r) => r.status === 201).body;
      assert.deepEqual(nombres([creation.totalHt, creation.totalTva, creation.totalTtc]), [100, 20, 120]);
      for (const relue of reponses.filter((r) => r.status === 200)) assert.deepEqual(relue.body, { ...creation, dejaEnregistre: true });
      assert.deepEqual((await avoirsDe(soldee.id)).map((a) => a.id), [creation.id]);
      assert.deepEqual(await soldes(soldee.id), ['REGLEE', 120, 0, 0], 'facture réglée par son seul avoir');
      // Une seule transition « réglée » au journal de la facture (aucune écrite par un rejeu).
      assert.equal((await journalDe(soldee.id)).filter((e) => e.action === 'REGLEMENT').length, 1);
    });

    // Cadrage v2 : « même clé sur deux factures en même temps : 201 et 409 » ; § 2 : « P2002 de cible cleEnvoi (distingué du numéro
    // et de l'avoir total) relu hors transaction, rendu comme ci-dessus, jamais en 500 ». Deux temps : d'abord deux envois simultanés
    // sans contrôle de l'ordre ; puis le chemin de l'index unique forcé, la séquence des avoirs étant tenue par le test : les deux
    // demandes ont relu la clé (absente) et attendent le numéro, si bien que la seconde bute sur l'index unique de la clé après la
    // validation de la première. Lectures écartées : 500 ; 409 de l'ancien message du numéro ou de l'avoir total ; deux avoirs portant
    // la même clé ; avoir rendu en 200 sur une autre facture que la sienne.
    test('même clé envoyée en même temps sur deux factures : un 201 et un 409 « Cette clé d’envoi a déjà servi… » (corps { error } seul), jamais 500 ; y compris quand la seconde bute sur l’index unique de la clé (attente sur la séquence des avoirs observée) ; un seul avoir, un seul numéro, l’autre facture inchangée', async () => {
      const verifier = async (reponses, factures, sequenceAvant, quoi) => {
        assert.deepEqual(reponses.map((r) => r.status).sort(), [201, 409], `${quoi} : ${JSON.stringify(reponses.map((r) => [r.status, r.body?.error]))}`);
        const refus = reponses.find((r) => r.status === 409);
        assert.deepEqual(refus.body, { error: REFUS.cleServie }, `${quoi} : message exact, corps { error } seul`);
        const creation = reponses.find((r) => r.status === 201).body;
        const [emise, autre] = creation.factureOrigineId === factures[0].id ? factures : [factures[1], factures[0]];
        assert.deepEqual((await avoirsDe(emise.id)).map((a) => a.id), [creation.id], `${quoi} : l’avoir sur sa facture`);
        assert.deepEqual(await avoirsDe(autre.id), [], `${quoi} : rien sur l’autre facture`);
        assert.deepEqual(await soldes(autre.id), ['EMISE', 0, 0, 120], `${quoi} : l’autre facture inchangée`);
        assert.equal(await sequence(), sequenceAvant + 1, `${quoi} : un seul numéro (celui de la demande refusée n’est pas consommé)`);
        return creation;
      };
      // Premier temps : deux envois simultanés.
      const libres = [await factureEmise(par('AD'), 'deux factures A'), await factureEmise(par('AD'), 'deux factures B')];
      const cleLibre = randomUUID();
      let sequenceAvant = await sequence();
      const libresReponses = await Promise.all(libres.map((f) => avoir(f.id, { lignes: DIX(), cleEnvoi: cleLibre }, par('AD'))));
      await verifier(libresReponses, libres, sequenceAvant, 'envois simultanés');

      // Second temps : chemin de l'index unique forcé.
      const forcees = [await factureEmise(par('AD'), 'index unique A'), await factureEmise(par('AD'), 'index unique B')];
      const cle = randomUUID();
      sequenceAvant = await sequence();
      assert.ok(sequenceAvant > 0, 'la séquence de l’année existe déjà (avoirs du premier temps)');
      const relacher = await tenirTransaction((tx) => tx.$queryRaw`SELECT 1 FROM "SequenceAvoir" WHERE annee = ${jour().annee} FOR UPDATE`);
      let envois;
      try {
        envois = forcees.map((f) => avoir(f.id, { lignes: DIX(), cleEnvoi: cle }, par('AD')).then((r) => r));
        assert.ok(await attendreAttentes(2), 'les deux demandes attendent la séquence des avoirs');
        const attentes = await requetesEnAttente();
        assert.equal(attentes.length, 2, JSON.stringify(attentes));
        assert.ok(attentes.every((requete) => requete.includes('SequenceAvoir')), `les deux demandes attendent le numéro, la clé déjà relue : ${JSON.stringify(attentes)}`);
      } finally {
        await relacher();
      }
      const reponses = await Promise.all(envois);
      const creation = await verifier(reponses, forcees, sequenceAvant, 'index unique');
      assert.equal(await cleEnBase(creation.id), cle);
      assert.notEqual(reponses.find((r) => r.status === 409).body.error, REFUS.ancienP2002, 'lecture écartée : refus de l’ancien message du numéro');
      // La demande perdante, rejouée maintenant sur sa facture, reste refusée ; la gagnante relit son avoir.
      const autre = creation.factureOrigineId === forcees[0].id ? forcees[1] : forcees[0];
      await refuse(() => avoir(autre.id, { lignes: DIX(), cleEnvoi: cle }, par('AD')), 409, REFUS.cleServie, 'clé de l’autre facture, après coup');
      await rejoue(() => avoir(creation.factureOrigineId, { lignes: DIX(), cleEnvoi: cle }, par('AD')), creation, 'gagnante, après coup');
    });

    // Cadrage v2 : « 409 pour d'autres lignes, un autre compte, une autre facture, corps ['error'] ». Les demandes refusées gardent,
    // quand c'est possible, les totaux de la demande d'origine (HT 10,00 €, TVA 2,00 €, TTC 12,00 €) : une comparaison des totaux de
    // l'avoir ou des totaux de ligne, au lieu des lignes, les rendrait en 200 (lecture écartée, nommée à chaque cas). Les lignes
    // équivalentes après lignesAvoirPartiel (désignation entourée d'espaces, nombres en texte à la virgule, nature omise) sont la
    // même demande : une comparaison du corps brut les refuserait (lecture écartée).
    test('clé déjà servie pour une autre demande : 409 au message exact, corps { error } seul, rien d’écrit — autres lignes (mêmes totaux : quantité et prix, quantité au millième, nature, désignation, ordre, deux lignes fusionnées ; autres totaux : prix d’un centime, ligne en moins, ligne en plus, autre taux), autre compte (super administrateur, directeur ; seconde assistante et administration sur la facture d’une assistante), autre facture du même compte et des mêmes lignes, y compris une facture brouillon (avant le refus du statut) et une ligne à un taux absent de la facture d’origine (avant le refus du taux) ; les lignes équivalentes après normalisation sont relues en 200', async () => {
      const facture = await factureEmise(par('AD'), 'autres demandes', LIGNES_DEUX_TAUX);
      const cle = randomUUID();
      const creation = await avoirCree(facture.id, { lignes: DEUX_LIGNES(), cleEnvoi: cle }, par('AD'));
      assert.deepEqual(nombres([creation.totalHt, creation.totalTva, creation.totalTtc]), [10, 2, 12]);
      const [a, b] = DEUX_LIGNES();
      const autresLignes = [
        // Mêmes totaux (10,00 / 2,00 / 12,00).
        ['quantité et prix différents, même HT de ligne (2 × 2,00 € au lieu de 1 × 4,00 €) — lecture écartée : totaux de ligne comparés', [{ ...a, quantite: 2, prixUnitaireHt: 2 }, b]],
        ['quantité au millième (0,999 × 4,00 € = 3,996 €, arrondi à 4,00 €) — lecture écartée : HT de ligne arrondi comparé', [{ ...a, quantite: 0.999 }, b]],
        ['nature ARTICLE au lieu de PRESTATION — lecture écartée : totaux comparés', [{ ...a, nature: 'ARTICLE' }, b]],
        ['autre désignation — lecture écartée : totaux comparés', [{ ...a, designation: 'TEST clé geste A bis' }, b]],
        ['ordre des lignes inversé — lecture écartée : lignes comparées comme un ensemble', [b, a]],
        ['deux lignes fusionnées en une de 10,00 € — lecture écartée : totaux de l’avoir comparés', [{ ...a, prixUnitaireHt: 10 }]],
        // Autres totaux.
        ['prix d’un centime de plus (4,01 €)', [{ ...a, prixUnitaireHt: 4.01 }, b]],
        ['une ligne en moins', [a]],
        ['une ligne en plus (0,01 €)', [a, b, ligne('geste C', 1, 0.01)]],
        ['taux de 10 % au lieu de 20 % sur une ligne', [{ ...a, tauxTva: 10 }, b]],
      ];
      for (const [quoi, lignes] of autresLignes) await refuse(() => avoir(facture.id, { lignes, cleEnvoi: cle }, par('AD')), 409, REFUS.cleServie, `autres lignes : ${quoi}`);
      // Autre compte de l'administration, mêmes lignes, même facture.
      for (const auteur of ['SA', 'DIR']) await refuse(() => avoir(facture.id, { lignes: DEUX_LIGNES(), cleEnvoi: cle }, par(auteur)), 409, REFUS.cleServie, `autre compte : ${auteur}`);
      // Autre facture du même compte, mêmes lignes : rien n'est relu ni émis sur elle.
      const autreFacture = await factureEmise(par('AD'), 'autre facture même compte', LIGNES_DEUX_TAUX);
      await refuse(() => avoir(autreFacture.id, { lignes: DEUX_LIGNES(), cleEnvoi: cle }, par('AD')), 409, REFUS.cleServie, 'autre facture, même compte, mêmes lignes');
      assert.deepEqual(await avoirsDe(autreFacture.id), []);
      // Le rejeu passe avant le statut et les taux (cadrage v2, § 2 ; T1 de l'audit des montants de #663, mutants S31 et S32) : la
      // clé d'une autre facture envoyée sur une facture brouillon, ou déjà servie avec une ligne à un taux absent de la facture
      // d'origine (5,5 %), reçoit le 409 de la clé. Lectures écartées : statut contrôlé avant la clé (409 « Seule une facture émise ou
      // réglée… ») ; taux contrôlés avant la clé (400 du taux). Témoins : une clé neuve reçoit ces deux refus.
      const enBrouillon = await brouillon(par('AD'), 'clé servie sur un brouillon', LIGNES_DEUX_TAUX);
      await refuse(() => avoir(enBrouillon.id, { lignes: DEUX_LIGNES(), cleEnvoi: cle }, par('AD')), 409, REFUS.cleServie, 'clé d’une autre facture sur une facture brouillon');
      await refuse(() => avoir(enBrouillon.id, { lignes: DEUX_LIGNES(), cleEnvoi: randomUUID() }, par('AD')), 409, REFUS.nonCreditable, 'témoin : clé neuve sur la facture brouillon');
      const tauxAbsent = [{ ...a, tauxTva: 5.5 }, b];
      await refuse(() => avoir(facture.id, { lignes: tauxAbsent, cleEnvoi: cle }, par('AD')), 409, REFUS.cleServie, 'clé déjà servie, ligne à un taux absent de la facture d’origine');
      await refuse(() => avoir(facture.id, { lignes: tauxAbsent, cleEnvoi: randomUUID() }, par('AD')), 400, REFUS.tauxAbsent, 'témoin : clé neuve, ligne à un taux absent de la facture d’origine');
      // Facture d'une assistante technique : la seconde assistante (même poste, même périmètre) et l'administration ne relisent pas
      // l'avoir de la première.
      const sienne = await factureEmise(par('AT'), 'autre compte assistante');
      const cleAssistante = randomUUID();
      const creationAssistante = await avoirCree(sienne.id, { lignes: DIX(), cleEnvoi: cleAssistante }, par('AT'));
      for (const auteur of ['AT2', 'AD']) await refuse(() => avoir(sienne.id, { lignes: DIX(), cleEnvoi: cleAssistante }, par(auteur)), 409, REFUS.cleServie, `autre compte sur la facture de l’assistante : ${auteur}`);
      await rejoue(() => avoir(sienne.id, { lignes: DIX(), cleEnvoi: cleAssistante }, par('AT')), creationAssistante, 'assistante auteur, après les refus');

      // Lignes équivalentes après lignesAvoirPartiel : même demande, relue en 200.
      const equivalentes = [
        { designation: '  TEST clé geste A  ', quantite: '1,000', prixUnitaireHt: '4,00', tauxTva: '20' },
        { designation: 'TEST clé geste B', nature: 'PRESTATION', quantite: '1', prixUnitaireHt: '6.00', tauxTva: 20 },
      ];
      await rejoue(() => avoir(facture.id, { lignes: equivalentes, cleEnvoi: cle.toUpperCase() }, par('AD')), creation, 'lignes équivalentes après normalisation');
      assert.deepEqual((await avoirsDe(facture.id)).map((x) => x.id), [creation.id], 'un seul avoir sur la facture');
      // Une ligne mal formée reste refusée par la règle des lignes, avant la transaction, même avec la clé déjà servie.
      await refuse(() => avoir(facture.id, { lignes: [{ ...a, quantite: 0 }, b], cleEnvoi: cle }, par('AD')), 400, REFUS.ligneInvalide, 'ligne mal formée avec la clé déjà servie');
    });

    // Cadrage v2 : « 400 pour '', 'pas-une-cle', 42 » ; § 2 : clé mal formée « lue avant la transaction, sans écriture ». Elle passe
    // donc avant le 404 hors périmètre (assistante sur une facture de l'administration, facture inexistante) et le 409 du statut
    // (brouillon). Lectures écartées : clé mal formée ignorée (201, avoir émis sans clé) ; refus du périmètre ou du statut d'abord.
    test('clé mal formée : 400 « Clé d’envoi de l’avoir invalide : rouvrez le formulaire. » pour une chaîne vide, un texte, un nombre, un booléen, un objet, un tableau, un UUID sans tirets, entre accolades, entouré d’espaces ou nul ; avant le 404 du périmètre et le 409 du statut ; rien d’écrit, aucun numéro', async () => {
      const facture = await factureEmise(par('AD'), 'clé mal formée');
      const sienne = await factureEmise(par('AT'), 'clé mal formée assistante');
      const enBrouillon = await brouillon(par('AD'), 'clé mal formée brouillon', LIGNES_CENT);
      const uuid = randomUUID();
      const invalides = [
        ['chaîne vide', ''], ['texte', 'pas-une-cle'], ['nombre', 42], ['booléen', true], ['objet', {}], ['tableau', [uuid]],
        ['UUID sans tirets', uuid.replaceAll('-', '')], ['UUID entre accolades', `{${uuid}}`], ['UUID entouré d’espaces', ` ${uuid} `],
        ['UUID nul', '00000000-0000-0000-0000-000000000000'],
      ];
      for (const [quoi, cleEnvoi] of invalides) {
        await refuse(() => avoir(facture.id, { lignes: DIX(), cleEnvoi }, par('AD')), 400, REFUS.cleInvalide, `${quoi}, administration`);
        await refuse(() => avoir(sienne.id, { lignes: DIX(), cleEnvoi }, par('AT')), 400, REFUS.cleInvalide, `${quoi}, assistante sur sa facture`);
      }
      // Avant le 404 du périmètre et le 409 du statut.
      await refuse(() => avoir(facture.id, { lignes: DIX(), cleEnvoi: 'pas-une-cle' }, par('AT')), 400, REFUS.cleInvalide, 'assistante sur une facture de l’administration');
      await refuse(() => avoir(randomUUID(), { lignes: DIX(), cleEnvoi: 'pas-une-cle' }, par('AD')), 400, REFUS.cleInvalide, 'facture inexistante');
      await refuse(() => avoir(enBrouillon.id, { lignes: DIX(), cleEnvoi: 42 }, par('AD')), 400, REFUS.cleInvalide, 'facture brouillon');
      // Témoins : la même demande avec une clé valide reçoit le refus du périmètre ou du statut.
      await refuse(() => avoir(facture.id, { lignes: DIX(), cleEnvoi: randomUUID() }, par('AT')), 404, REFUS.introuvable, 'témoin : assistante sur une facture de l’administration');
      await refuse(() => avoir(enBrouillon.id, { lignes: DIX(), cleEnvoi: randomUUID() }, par('AD')), 409, REFUS.nonCreditable, 'témoin : facture brouillon');
      assert.deepEqual([await avoirsDe(facture.id), await avoirsDe(sienne.id)], [[], []]);
    });

    // Cadrage v2 : « sans clé inchangé » (champ absent ou null : comportement actuel). Lectures écartées : déduplication par contenu
    // sans clé (un seul avoir, reste dû 108,00 €) ; avoir sans clé relu par une demande à clé aux mêmes lignes ; clé null refusée.
    test('sans clé (champ absent ou null) : comportement d’avant, 201 et clé nulle en base ; deux envois identiques sans clé émettent deux avoirs (deux numéros, reste dû 96,00 €) ; une demande à clé aux mêmes lignes émet le sien (reste dû 84,00 €), relu ensuite par sa clé', async () => {
      const facture = await factureEmise(par('AD'), 'sans clé');
      const sequenceAvant = await sequence();
      const sansChamp = await avoirCree(facture.id, { lignes: DIX() }, par('AD'));
      const cleNulle = await avoirCree(facture.id, { lignes: DIX(), cleEnvoi: null }, par('AD'));
      assert.notEqual(sansChamp.id, cleNulle.id);
      assert.deepEqual([await cleEnBase(sansChamp.id), await cleEnBase(cleNulle.id)], [null, null], 'aucune clé inventée');
      assert.equal(await sequence(), sequenceAvant + 2, 'deux numéros');
      assert.deepEqual(await soldes(facture.id), ['EMISE', 24, 0, 96], 'deux avoirs de 12,00 €');
      const cle = randomUUID();
      const avecCle = await avoirCree(facture.id, { lignes: DIX(), cleEnvoi: cle }, par('AD'));
      assert.ok(![sansChamp.id, cleNulle.id].includes(avecCle.id), 'lecture écartée : un avoir sans clé relu par contenu');
      assert.deepEqual(await soldes(facture.id), ['EMISE', 36, 0, 84]);
      await rejoue(() => avoir(facture.id, { lignes: DIX(), cleEnvoi: cle }, par('AD')), avecCle, 'avoir à clé relu');
      assert.equal((await avoirsDe(facture.id)).length, 3);
    });

    // Cadrage v2 : « rejeu après REGLEE : 200 » ; § 2 : rejeu avant tout autre contrôle (statut, taux, plafonds, identité de
    // l'émetteur, séquence). La facture soldée par ses avoirs passe « réglée » : une nouvelle demande y reçoit le refus du plafond,
    // le rejeu non. Identité de la société incomplète : une nouvelle demande reçoit le refus de l'identité, le rejeu non. Lectures
    // écartées : rejeu placé après le plafond (409 du plafond) ou après l'identité figée (409 de l'identité, ou nouvelle identité
    // copiée).
    test('rejeu après que la facture est passée « réglée » par ses avoirs : 200 au même corps, sans le refus du plafond ; rejeu avec l’identité de la société incomplète : 200, sans le refus de l’identité ; une nouvelle demande reçoit, elle, ces refus ; rien d’écrit', async () => {
      const facture = await factureEmise(par('AD'), 'rejeu après réglée');
      const cle = randomUUID();
      // 1 × 50,00 € HT à 20 % : 60,00 € TTC, puis un second avoir sans clé de 60,00 € solde la facture de 120,00 €.
      const moitie = () => [ligne('moitié', 1, 50)];
      const creation = await avoirCree(facture.id, { lignes: moitie(), cleEnvoi: cle }, par('AD'));
      assert.deepEqual(await soldes(facture.id), ['EMISE', 60, 0, 60]);
      await avoirCree(facture.id, { lignes: moitie() }, par('AD'));
      assert.deepEqual(await soldes(facture.id), ['REGLEE', 120, 0, 0], 'facture réglée par ses avoirs');
      await rejoue(() => avoir(facture.id, { lignes: moitie(), cleEnvoi: cle }, par('AD')), creation, 'rejeu sur la facture réglée');
      // Témoin : une nouvelle demande aux mêmes lignes dépasse le plafond.
      await refuse(() => avoir(facture.id, { lignes: moitie(), cleEnvoi: randomUUID() }, par('AD')), 409, REFUS.plafondTotal, 'témoin : nouvelle demande sur la facture réglée');
      assert.deepEqual(await soldes(facture.id), ['REGLEE', 120, 0, 0]);

      // Identité de la société incomplète.
      const ouverte = await factureEmise(par('AD'), 'rejeu identité incomplète');
      const cleIdentite = randomUUID();
      const creationIdentite = await avoirCree(ouverte.id, { lignes: DIX(), cleEnvoi: cleIdentite }, par('AD'));
      const identite = await prisma.companySettings.findUniqueOrThrow({ where: { id: 'singleton' }, select: { siret: true } });
      await prisma.companySettings.update({ where: { id: 'singleton' }, data: { siret: '' } });
      try {
        await rejoue(() => avoir(ouverte.id, { lignes: DIX(), cleEnvoi: cleIdentite }, par('AD')), creationIdentite, 'rejeu, identité incomplète');
        await refuse(() => avoir(ouverte.id, { lignes: DIX(), cleEnvoi: randomUUID() }, par('AD')), 409, REFUS.identite, 'témoin : nouvelle demande, identité incomplète');
      } finally {
        await prisma.companySettings.update({ where: { id: 'singleton' }, data: { siret: identite.siret } });
      }
      assert.deepEqual(await soldes(ouverte.id), ['EMISE', 12, 0, 108]);
    });

    // Audit des montants de #663 (C1, test de montant) : le rejeu rend l'avoir aux montants figés à son émission, même quand un autre avoir de la
    // facture, émis entre-temps, change la TVA différentielle qu'une nouvelle demande aux mêmes lignes recevrait. Facture de 10 ×
    // 21,35 € HT à 10 % ; chaque avoir de 1 × 21,35 € HT : TVA de la base cumulée arrondie au centime, moins celle d'avant (2,135 € →
    // 2,14 € ; 4,27 € ; 6,405 € → 6,41 € ; 8,54 €). A1 (à clé) : 2,14 € ; A2 (sans clé) : 4,27 − 2,14 = 2,13 € ; A3 (sans clé) :
    // 6,41 − 4,27 = 2,14 €. Lectures écartées : rejeu admis seulement si une nouvelle demande recevrait les mêmes montants, A1 compté
    // parmi les précédents (8,54 − 6,41 = 2,13 € après A3 : 409) ou non (4,27 − 2,14 = 2,13 € après A2 : 409) ; montants du rejeu
    // recalculés au lieu des montants figés.
    test('rejeu après d’autres avoirs de la facture qui changent la TVA différentielle d’une nouvelle demande aux mêmes lignes : 200 aux montants figés de l’avoir (TVA 2,14 €, TTC 23,49 €), après un avoir intercalé (une nouvelle demande recevrait 2,13 €) comme après deux ; rien d’écrit', async () => {
      const facture = await factureEmise(par('AD'), 'TVA différentielle intercalée', [ligne('reprise au taux réduit', 10, 21.35, 10)]);
      const vingtEtUn = () => [ligne('geste au taux réduit', 1, 21.35, 10)];
      const cle = randomUUID();
      const creation = await avoirCree(facture.id, { lignes: vingtEtUn(), cleEnvoi: cle }, par('AD'));
      assert.deepEqual(nombres([creation.totalHt, creation.totalTva, creation.totalTtc]), [21.35, 2.14, 23.49], 'A1 : premier avoir, 2,135 € arrondi à 2,14 €');
      const a2 = await avoirCree(facture.id, { lignes: vingtEtUn() }, par('AD'));
      assert.deepEqual(nombres([a2.totalHt, a2.totalTva, a2.totalTtc]), [21.35, 2.13, 23.48], 'A2 : 4,27 − 2,14');
      await rejoue(() => avoir(facture.id, { lignes: vingtEtUn(), cleEnvoi: cle }, par('AD')), creation, 'rejeu après un avoir intercalé');
      const a3 = await avoirCree(facture.id, { lignes: vingtEtUn() }, par('AD'));
      assert.deepEqual(nombres([a3.totalHt, a3.totalTva, a3.totalTtc]), [21.35, 2.14, 23.49], 'A3 : 6,41 − 4,27');
      await rejoue(() => avoir(facture.id, { lignes: vingtEtUn(), cleEnvoi: cle.toUpperCase() }, par('AD')), creation, 'rejeu après deux avoirs intercalés');
      assert.deepEqual((await avoirsDe(facture.id)).map((a) => a.id), [creation.id, a2.id, a3.id]);
      // Facture de 234,85 € TTC (213,50 € HT, 21,35 € de TVA) : 23,49 + 23,48 + 23,49 = 70,46 € crédités, reste dû 164,39 €.
      assert.deepEqual(await soldes(facture.id), ['EMISE', 70.46, 0, 164.39]);
    });

    // Cadrage v2 : « hors périmètre : 404 » ; § 4 : droits inchangés, rejeu rendu au seul compte auteur, dans le périmètre de la
    // facture. Le 404 du périmètre passe avant la recherche de la clé : l'assistante ne relit pas, et n'apprend pas l'existence, de
    // l'avoir d'une facture de l'administration (lectures écartées : 409 ou 200). Sept autres types : 403 de requireGestionFactures,
    // avant la clé ; 401 sans session et par une clé d'intégration (aucune route /api/v1 ne crée d'avoir).
    test('droits : rejeu hors périmètre refusé en 404 « Facture introuvable. » avant la clé (assistante sur la facture de l’administration avec sa clé, avec la sienne, facture inexistante) ; sept autres types refusés en 403, clé valide ou mal formée ; 401 sans session et par une clé d’intégration ; rien d’écrit', async () => {
      const facture = await factureEmise(par('AD'), 'droits administration');
      const cle = randomUUID();
      const creation = await avoirCree(facture.id, { lignes: DIX(), cleEnvoi: cle }, par('AD'));
      const sienne = await factureEmise(par('AT'), 'droits assistante');
      const cleAssistante = randomUUID();
      const creationAssistante = await avoirCree(sienne.id, { lignes: DIX(), cleEnvoi: cleAssistante }, par('AT'));
      for (const [quoi, appel] of [
        ['assistante, clé de l’administration, facture de l’administration', () => avoir(facture.id, { lignes: DIX(), cleEnvoi: cle }, par('AT'))],
        ['assistante, sa propre clé, facture de l’administration', () => avoir(facture.id, { lignes: DIX(), cleEnvoi: cleAssistante }, par('AT'))],
        ['seconde assistante, clé de l’administration, facture de l’administration', () => avoir(facture.id, { lignes: DIX(), cleEnvoi: cle }, par('AT2'))],
        ['administration, sa clé, facture inexistante', () => avoir(randomUUID(), { lignes: DIX(), cleEnvoi: cle }, par('AD'))],
      ]) await refuse(appel, 404, REFUS.introuvable, quoi);
      const cleApi = await ok(appeler('post', '/admin/api-keys', { nom: `TEST clé d’intégration ${suffixe()}`, scopes: ['finances:read', 'clients:read'] }), 201);
      for (const [quoi, appel] of [
        ['clé de l’administration', (auth) => avoir(facture.id, { lignes: DIX(), cleEnvoi: cle }, auth)],
        ['clé neuve', (auth) => avoir(facture.id, { lignes: DIX(), cleEnvoi: randomUUID() }, auth)],
        ['clé mal formée', (auth) => avoir(facture.id, { lignes: DIX(), cleEnvoi: 'pas-une-cle' }, auth)],
      ]) {
        for (const [code] of AUTRES_TYPES) await refuse(() => appel(par(code)), 403, REFUS.gestion, `${quoi} par ${code}`);
        const [avant, sequenceAvant] = [await empreinte(), await sequence()];
        assert.equal((await appel(null)).status, 401, `${quoi} sans session`);
        assert.equal((await appel(entete(cleApi.apiKey))).status, 401, `${quoi} par une clé d’intégration`);
        assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
        assert.equal(await sequence(), sequenceAvant);
      }
      // Les auteurs relisent toujours leur avoir.
      await rejoue(() => avoir(facture.id, { lignes: DIX(), cleEnvoi: cle }, par('AD')), creation, 'administration auteur');
      await rejoue(() => avoir(sienne.id, { lignes: DIX(), cleEnvoi: cleAssistante }, par('AT')), creationAssistante, 'assistante auteur');
    });

    // Cadrage v2, § 1 : clé figée dès la création par le déclencheur facture_cle_envoi_figee (check_violation, message exact) ;
    // critère « La clé d'un avoir émis ne peut plus être modifiée en base ». Sur des pièces émises par l'API (la base neuve et la
    // base existante sont éprouvées par avoir-cle-envoi-migration.test.mjs). Lectures écartées : clé réécrite (rejeu détourné vers
    // une autre demande), vidée (second avoir possible), ou posée après coup sur un avoir sans clé ou sur une facture.
    test('clé figée en base sur les pièces émises par l’API : changée, vidée ou posée après coup (avoir sans clé, facture, avoir d’annulation) refusée (23514, « La clé d’envoi d’une pièce ne se modifie pas. ») ; la même valeur se réécrit ; rien d’écrit par les refus', async () => {
      const facture = await factureEmise(par('AD'), 'clé figée');
      const cle = randomUUID();
      const avecCle = await avoirCree(facture.id, { lignes: DIX(), cleEnvoi: cle }, par('AD'));
      const sansCle = await avoirCree(facture.id, { lignes: DIX() }, par('AD'));
      const annulee = await factureEmise(par('AD'), 'clé figée annulation');
      const annulation = await ok(appeler('post', `/factures/${annulee.id}/annuler`, {}, par('AD')));
      const avoirAnnulation = annulation.avoir?.id ?? (await avoirsDe(annulee.id))[0].id;
      const refusFigee = async (requete, valeurs, quoi) => {
        const avant = await empreinte();
        await assert.rejects(sql.query(requete, valeurs), (erreur) => {
          assert.equal(erreur.code, '23514', `${quoi} : ${erreur.message}`);
          assert.equal(erreur.message, FIGEE, quoi);
          return true;
        }, quoi);
        assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      };
      await refusFigee('UPDATE "Facture" SET "cleEnvoi" = $1 WHERE id = $2', [randomUUID(), avecCle.id], 'clé changée');
      await refusFigee('UPDATE "Facture" SET "cleEnvoi" = NULL WHERE id = $1', [avecCle.id], 'clé vidée');
      for (const [quoi, id] of [['avoir sans clé', sansCle.id], ['facture', facture.id], ['avoir d’annulation', avoirAnnulation]]) {
        await refusFigee('UPDATE "Facture" SET "cleEnvoi" = $1 WHERE id = $2', [randomUUID(), id], `clé posée après coup : ${quoi}`);
      }
      assert.deepEqual([await cleEnBase(avecCle.id), await cleEnBase(sansCle.id), await cleEnBase(facture.id), await cleEnBase(avoirAnnulation)], [cle, null, null, null]);
      // La même valeur se réécrit (le déclencheur ne compare que l'ancienne et la nouvelle clé), en majuscules comme en minuscules.
      assert.equal((await sql.query('UPDATE "Facture" SET "cleEnvoi" = $1 WHERE id = $2', [cle.toUpperCase(), avecCle.id])).rowCount, 1);
      assert.equal(await cleEnBase(avecCle.id), cle);
    });
  });
}
