// Lot AC : cohérence en base des factures et avoirs émis (#243 ; cadrage v2 du 25-11-2026, sections « Origine et décisions »,
// « Refus métier de l'annulation » et « Tests » : « pièce antérieure simulée (insérée, puis migration appliquée) : contrôlée à sa
// prochaine écriture (règlement) »). Règle 4 de la méthode : aucune donnée réelle, aucune reprise ; une pièce émise avant la migration
// n'est contrôlée qu'à sa prochaine écriture sur sa ligne « Facture ».
//
// Migration 20261125120000_coherence_pieces_emises, jouée sur une base jetable distincte, créée et supprimée par le test
// (TEST_DATABASE_URL ne sert que de connexion administrative) :
//  - avant elle, les gardes en place admettent une facture émise du cas (g) du cadrage (ligne de 10,00 € à 20 %, ventilation
//    enregistrée 8 / 2 / 10 €, totaux 10 / 2 / 12 €, écritures 12 = 10 + 2) et une facture cohérente dont l'écriture de TVA porte la
//    clé `TVA` sans taux ; deux factures témoins, écrites comme l'application les écrit, les accompagnent ;
//  - la migration passe sans rien modifier (empreinte de toute la base identique) et pose un déclencheur différé ;
//  - après elle, la prochaine écriture sur la ligne de chacune des deux factures est refusée au COMMIT, au message exact ; une
//    facture témoin s'écrit ;
//  - par l'application, montée sur cette base : un témoin s'annule ; l'annulation de la facture du cas (g) répond 500, comme avant
//    le lot (point 4 du cadrage, choix par défaut, à confirmer : aucun refus métier ajouté à l'API, aucune pièce antérieure
//    n'existant) ; un règlement partiel, qui n'écrit pas sa ligne « Facture », passe ; le règlement qui la solde, et la passe
//    « réglée », est refusé (500, rien d'écrit), et elle reste « émise » ; le règlement complet de l'autre témoin la passe « réglée ».
// Sans TEST_DATABASE_URL, le test s'annonce ignoré, comme les autres tests de migration : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';

const adminUrl = process.env.TEST_DATABASE_URL;
const prismaDir = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma');
const migration = '20261125120000_coherence_pieces_emises';
const TITRE = 'Migration 20261125120000_coherence_pieces_emises : une pièce émise incohérente déjà en base n’est pas reprise, et sa prochaine écriture sur sa ligne est refusée au COMMIT';

// Messages exacts de la migration (apostrophes droites, celles de PostgreSQL).
const COHERENCE = {
  totaux: (id) => `La pièce ${id} n'a pas des totaux égaux à sa ventilation de TVA (HT, TVA, TTC = HT + TVA).`,
  cleInconnue: (id, cle) => `La pièce ${id} porte une écriture comptable de clé inconnue (${cle}).`,
};

if (!adminUrl) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const url = new URL(adminUrl);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs), suffixe tiré au hasard.
    const base = `iris_test_coherence_migration_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const maintenance = new URL(url);
    maintenance.pathname = '/postgres';
    const cible = new URL(url);
    cible.pathname = `/${base}`;
    const admin = new pg.Client({ connectionString: maintenance.toString() });
    const dossier = mkdtempSync(join(tmpdir(), 'iris-coherence-pieces-'));
    const schema = join(dossier, 'schema.prisma');
    const migrations = join(dossier, 'migrations');
    let creee = false;
    let db = null;
    let appPrisma = null;
    const ids = {};
    let toutes = [];
    const environnementAvant = {};
    const NOMS_ENVIRONNEMENT = ['DATABASE_URL', 'NODE_ENV', 'JWT_SECRET', 'BREAK_GLASS_EMAIL', 'BREAK_GLASS_TOKEN', 'SUPERADMIN_EMAILS', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID'];
    const deploy = () => execFileSync(resolve(prismaDir, '../node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', schema], {
      env: { ...process.env, DATABASE_URL: cible.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
    });

    // Empreinte de toute la base (hors historique des migrations) : nombre de lignes et contenu de chaque table.
    const empreinte = async () => {
      const tables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`)).rows.map((r) => r.tablename);
      assert.ok(tables.includes('Facture') && tables.includes('EcritureFacture') && tables.includes('Reglement'));
      const sql = tables.map((t) => `SELECT '${t}' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${t}" x`).join(' UNION ALL ');
      return Object.fromEntries((await db.query(sql)).rows.map(({ t, n, h }) => [t, `${n}:${h}`]));
    };
    const changees = (avant, apres) => Object.keys({ ...avant, ...apres }).filter((t) => avant[t] !== apres[t]);
    const ligneFacture = async (id) => (await db.query('SELECT * FROM "Facture" WHERE "id" = $1', [id])).rows[0];
    // Écriture directe refusée : message exact (celui de PostgreSQL tel quel par pg), rien d'écrit.
    const refusee = async (ecriture, message, quoi) => {
      const avant = await empreinte();
      await assert.rejects(ecriture, (erreur) => {
        assert.equal(erreur.message, message, quoi);
        return true;
      }, quoi);
      assert.deepEqual(changees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
    };
    const toucher = (id) => db.query('UPDATE "Facture" SET "updatedAt" = now() WHERE "id" = $1', [id]);
    const enTransaction = async (operations) => {
      await db.query('BEGIN');
      try {
        await operations();
        await db.query('COMMIT');
      } catch (erreur) { await db.query('ROLLBACK').catch(() => {}); throw erreur; }
    };

    // Facture émise écrite en SQL, en une transaction (les gardes différées de l'époque vérifiées au COMMIT) : totaux [HT, TVA, TTC],
    // une ligne [HT, TTC] à 20 %, sa ventilation [HT, TVA, TTC] à 20 %, écritures [[clé, taux, débit, crédit]], puis scellement.
    const factureSql = async ({ numero, totaux: [ht, tva, ttc], ligne: [ligneHt, ligneTtc], ventilation: [vHt, vTva, vTtc], ecritures }) => {
      const id = randomUUID();
      await enTransaction(async () => {
        await db.query(`INSERT INTO "Facture" ("id", "numero", "annee", "clientId", "clientRaisonSociale", "statut", "type", "dateEmission", "dateEcheance", "totalHt", "totalTva", "totalTtc", "origine", "motifHorsAffaire", "identiteEmetteurId", "emisLe", "updatedAt")
          VALUES ($1, $2, 2026, $3, 'TEST Client migration cohérence', 'EMISE', 'FACTURE', '2026-11-20', '2026-12-20', $4, $5, $6, 'HORS_AFFAIRE', 'TEST migration cohérence', $7, now(), now())`, [id, numero, ids.client, ht, tva, ttc, ids.identite]);
        await db.query(`INSERT INTO "FactureLigne" ("id", "factureId", "ordre", "designation", "nature", "quantite", "prixUnitaireHt", "tauxTva", "totalHt", "totalTtc") VALUES ($1, $2, 0, $3, 'PRESTATION', 1, $4, 20, $4, $5)`, [randomUUID(), id, `TEST ${numero}`, ligneHt, ligneTtc]);
        await db.query(`INSERT INTO "FactureVentilationTva" ("id", "factureId", "tauxTva", "totalHt", "totalTva", "totalTtc") VALUES ($1, $2, 20, $3, $4, $5)`, [randomUUID(), id, vHt, vTva, vTtc]);
        for (const [ordre, [cle, taux, debit, credit]] of ecritures.entries()) {
          await db.query(`INSERT INTO "EcritureFacture" ("id", "factureId", "ordre", "cle", "tauxTva", "journalCode", "compteNum", "compteLib", "debit", "credit") VALUES ($1, $2, $3, $4, $5, 'VE', $6, $7, $8, $9)`,
            [randomUUID(), id, ordre, cle, taux, { CLIENT: '411000', VENTE_PRESTATION: '706000' }[cle] ?? '445710', `TEST ${cle}`, debit, credit]);
        }
        await db.query('UPDATE "Facture" SET "ecrituresScellees" = true WHERE "id" = $1', [id]);
      });
      return id;
    };

    before(async () => {
      assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'seul PostgreSQL local est autorisé');
      await admin.connect();
      await admin.query(`CREATE DATABASE "${base}"`);
      creee = true;
      copyFileSync(join(prismaDir, 'schema.prisma'), schema);
      mkdirSync(migrations);
      copyFileSync(join(prismaDir, 'migrations/migration_lock.toml'), join(migrations, 'migration_lock.toml'));
      toutes = readdirSync(join(prismaDir, 'migrations')).filter((nom) => nom !== 'migration_lock.toml').sort();
      assert.ok(toutes.includes(migration), `${migration} : migration absente`);
      for (const nom of toutes.filter((n) => n < migration)) cpSync(join(prismaDir, 'migrations', nom), join(migrations, nom), { recursive: true });
      deploy();
      db = new pg.Client({ connectionString: cible.toString() });
      await db.connect();
    });

    after(async () => {
      await appPrisma?.$disconnect().catch(() => {});
      await db?.end().catch(() => {});
      for (const nom of NOMS_ENVIRONNEMENT) { if (environnementAvant[nom] === undefined) delete process.env[nom]; else process.env[nom] = environnementAvant[nom]; }
      if (creee) await admin.query(`DROP DATABASE IF EXISTS "${base}" WITH (FORCE)`).catch(() => {});
      await admin.end().catch(() => {});
      rmSync(dossier, { recursive: true, force: true });
    });

    test('avant la migration : les gardes en place admettent une facture émise du cas g (ventilation 8 / 2 / 10 € sous une ligne de 10,00 €) et une facture à écriture `TVA` sans taux, et laissent s’écrire leur ligne ; deux factures témoins, cohérentes, les accompagnent', async () => {
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'verifier_coherence_piece'`)).rows[0].n, 0, 'fonction du lot absente avant la migration');
      ids.identite = randomUUID();
      await db.query(`INSERT INTO "IdentiteEmetteur" ("id", "empreinte", "raisonSociale", "siret", "adresse", "codePostal", "ville", "couleurPrimaire")
        VALUES ($1, 'TEST-IDENTITE-MIGRATION-COHERENCE', 'TEST Société émettrice', '12345678900011', '1 rue des Tests', '14000', 'Caen', '#1e3a8a')`, [ids.identite]);
      ids.client = randomUUID();
      await db.query(`INSERT INTO "Client" ("id", "raisonSociale", "updatedAt") VALUES ($1, 'TEST Client migration cohérence', now())`, [ids.client]);
      const ecrituresJustes = [['CLIENT', null, '12', '0'], ['VENTE_PRESTATION', null, '0', '10'], ['TVA:20', 20, '0', '2']];
      ids.g = await factureSql({ numero: 'TEST-F-CAS-G', totaux: ['10', '2', '12'], ligne: ['10', '12'], ventilation: ['8', '2', '10'], ecritures: ecrituresJustes });
      ids.t = await factureSql({ numero: 'TEST-F-TVA-SANS-TAUX', totaux: ['10', '2', '12'], ligne: ['10', '12'], ventilation: ['10', '2', '12'], ecritures: [['CLIENT', null, '12', '0'], ['VENTE_PRESTATION', null, '0', '10'], ['TVA', null, '0', '2']] });
      ids.w = await factureSql({ numero: 'TEST-F-TEMOIN', totaux: ['10', '2', '12'], ligne: ['10', '12'], ventilation: ['10', '2', '12'], ecritures: ecrituresJustes });
      ids.w2 = await factureSql({ numero: 'TEST-F-TEMOIN-ANNULEE', totaux: ['10', '2', '12'], ligne: ['10', '12'], ventilation: ['10', '2', '12'], ecritures: ecrituresJustes });
      for (const id of [ids.g, ids.t, ids.w, ids.w2]) {
        const f = await ligneFacture(id);
        assert.deepEqual([f.statut, f.ecrituresScellees, Number(f.totalHt), Number(f.totalTva), Number(f.totalTtc)], ['EMISE', true, 10, 2, 12]);
        assert.equal((await toucher(id)).rowCount, 1, 'écriture simple admise avant la migration');
      }
    });

    test('la migration passe sans reprise (empreinte de toute la base identique, pièces relues à l’identique) et pose le déclencheur différé facture_verification_coherence', async () => {
      assert.ok(ids.g, 'données d’avant la migration absentes');
      const avant = await empreinte();
      const lignesAvant = await Promise.all([ids.g, ids.t, ids.w, ids.w2].map(ligneFacture));
      cpSync(join(prismaDir, 'migrations', migration), join(migrations, migration), { recursive: true });
      deploy();
      const appliquee = (await db.query('SELECT "migration_name", "finished_at" IS NOT NULL AS terminee, "rolled_back_at" IS NULL AS valide FROM "_prisma_migrations" WHERE "migration_name" = $1', [migration])).rows;
      assert.deepEqual(appliquee, [{ migration_name: migration, terminee: true, valide: true }]);
      assert.deepEqual(changees(avant, await empreinte()), [], 'aucune ligne reprise ni réécrite');
      assert.deepEqual(await Promise.all([ids.g, ids.t, ids.w, ids.w2].map(ligneFacture)), lignesAvant, 'pièces relues à l’identique, updatedAt compris');
      const declencheur = (await db.query(`SELECT t.tgdeferrable AS differable, t.tginitdeferred AS differe, c.relname AS table_ FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = 'facture_verification_coherence'`)).rows;
      assert.deepEqual(declencheur, [{ differable: true, differe: true, table_: 'Facture' }]);
    });

    test('après la migration : la prochaine écriture sur la facture du cas g, simple ou en transaction, et sur la facture à écriture `TVA` sans taux est refusée au COMMIT au message exact, rien d’écrit ; la facture témoin s’écrit', async () => {
      assert.ok(ids.g, 'données d’avant la migration absentes');
      await refusee(() => toucher(ids.g), COHERENCE.totaux(ids.g), 'écriture simple sur la facture du cas g');
      await refusee(() => enTransaction(() => toucher(ids.g)), COHERENCE.totaux(ids.g), 'transaction sur la facture du cas g, refusée au COMMIT');
      await refusee(() => toucher(ids.t), COHERENCE.cleInconnue(ids.t, 'TVA'), 'écriture simple sur la facture à écriture TVA sans taux');
      const avant = (await ligneFacture(ids.w)).updatedAt;
      assert.equal((await toucher(ids.w)).rowCount, 1);
      assert.notDeepEqual((await ligneFacture(ids.w)).updatedAt, avant);
    });

    test('après la migration, par l’application : facture témoin annulée ; annulation de la facture du cas g, 500 « Annulation de facture impossible. » comme avant le lot ; règlement partiel de 5,00 € admis (sa ligne « Facture » n’est pas écrite) ; règlement des 7,00 € restants refusé (500 « Enregistrement du règlement impossible. »), rien d’écrit, la facture restant « émise » ; facture témoin réglée', async () => {
      assert.ok(ids.g, 'données d’avant la migration absentes');
      // L'application suppose le schéma de toutes les migrations : celles qui suivraient celle du lot sont jouées avant de la monter.
      const posterieures = toutes.filter((n) => n > migration);
      for (const nom of posterieures) cpSync(join(prismaDir, 'migrations', nom), join(migrations, nom), { recursive: true });
      if (posterieures.length) deploy();
      const appliquees = (await db.query('SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL')).rows.map((r) => r.migration_name).sort();
      assert.deepEqual(appliquees, toutes, 'toutes les migrations du dépôt sont appliquées');
      for (const nom of NOMS_ENVIRONNEMENT) environnementAvant[nom] = process.env[nom];
      delete process.env.AZURE_TENANT_ID;
      delete process.env.AZURE_CLIENT_ID;
      process.env.DATABASE_URL = cible.toString();
      process.env.NODE_ENV = 'test';
      process.env.JWT_SECRET = 'secret-de-test-uniquement';
      process.env.BREAK_GLASS_EMAIL = 'secours@iris.test';
      process.env.BREAK_GLASS_TOKEN = 'jeton-de-secours-de-test-au-moins-32-caracteres';
      process.env.SUPERADMIN_EMAILS = 'secours@iris.test';
      const request = (await import('supertest')).default;
      const serveur = await import('../dist/index.js');
      appPrisma = serveur.prisma;
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      const connexion = await request(serveur.app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      const auth = { Authorization: `Bearer ${connexion.body.token}` };
      // Identité de la société et mentions légales publiées : sans elles, l'annulation est refusée avant la base (409).
      const prealable = async (appel, statut) => { const res = await appel; assert.equal(res.status, statut, JSON.stringify(res.body)); return res.body; };
      await prealable(request(serveur.app).put('/api/company').set(auth).send({ raisonSociale: 'TEST Émetteur migration cohérence', siret: '24324324300024', adresse: '24 rue des Pièces', codePostal: '14000', ville: 'Caen', fuseauHoraire: 'Europe/Paris' }), 200);
      const version = await prealable(request(serveur.app).post('/api/mentions-legales').set(auth).send({ mentions: 'TEST mentions migration cohérence', cgv: 'TEST CGV', penalites: 'TEST pénalités' }), 201);
      await prealable(request(serveur.app).post(`/api/mentions-legales/${version.version}/publier`).set(auth).send({}), 200);
      const jour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()).replaceAll('/', '-');
      const reglement = (factureId, montant) => request(serveur.app).post('/api/reglements').set(auth).send({ clientId: ids.client, dateReglement: jour, montant, moyen: 'VIREMENT', affectations: [{ factureId, montant }] });
      const refus = async (appel, statutAttendu, message, quoi) => {
        const avant = await empreinte();
        const res = await appel();
        assert.deepEqual([res.status, res.body?.error], [statutAttendu, message], `${quoi} : ${JSON.stringify(res.body)}`);
        assert.deepEqual(changees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      };
      // Point 4 du cadrage (choix par défaut, à confirmer) : aucun refus métier ajouté ; une pièce antérieure incohérente ne peut
      // exister (règle 4). Le 500 d'avant le lot reste, refusé en base. Témoin d'abord : une facture cohérente de la même base
      // s'annule (les préalables de l'annulation sont réunis ; le 500 vient de la base).
      const annulationTemoin = await request(serveur.app).post(`/api/factures/${ids.w2}/annuler`).set(auth).send({});
      assert.equal(annulationTemoin.status, 200, JSON.stringify(annulationTemoin.body));
      assert.equal((await ligneFacture(ids.w2)).statut, 'ANNULEE');
      await refus(() => request(serveur.app).post(`/api/factures/${ids.g}/annuler`).set(auth).send({}), 500, 'Annulation de facture impossible.', 'annulation de la facture du cas g');
      // Règlement partiel : la facture reste « émise », sa ligne n'est pas écrite, et n'est donc pas contrôlée (cadrage v2 : contrôlée
      // « à sa prochaine écriture sur sa ligne Facture »).
      const ligneAvant = await ligneFacture(ids.g);
      const partiel = await reglement(ids.g, 5);
      assert.equal(partiel.status, 201, JSON.stringify(partiel.body));
      assert.deepEqual(await ligneFacture(ids.g), ligneAvant, 'ligne de la facture non écrite par le règlement partiel');
      // Règlement du reste dû (7,00 €) : la facture passerait « réglée », écriture sur sa ligne, refusée au COMMIT.
      await refus(() => reglement(ids.g, 7), 500, 'Enregistrement du règlement impossible.', 'règlement qui solde la facture du cas g');
      assert.equal((await ligneFacture(ids.g)).statut, 'EMISE');
      // Témoin : réglée en entier.
      const temoin = await reglement(ids.w, 12);
      assert.equal(temoin.status, 201, JSON.stringify(temoin.body));
      assert.equal((await ligneFacture(ids.w)).statut, 'REGLEE');
    });
  });
}
