// Lot « Statut d'une facture couverte par des avoirs » (cadrage v3, § 1, « Aucune reprise des lignes existantes », et section
// « Tests », « Gardes SQL », dernière puce ; C4 du contrôle de mode 1, N14 du passage de vérification). Réponse de Nelson du
// 09-11-2026 (lecture retenue, à corriger par Nelson si besoin) : une facture couverte en totalité par ses avoirs partiels est
// « réglée ». Règle 4 de la méthode : aucune donnée réelle, aucune reprise.
//
// Migration 20261110090000_reglee_par_avoirs, jouée sur une base jetable distincte, créée et supprimée par le test
// (TEST_DATABASE_URL ne sert que de connexion administrative) :
//  - avant elle, une facture émise soldée par son seul avoir partiel (120,00 € sur 120,00 €) est admise par les anciennes gardes,
//    qui refusent alors de la passer « réglée » (preuve que la base est bien dans l'état d'avant) ; une facture témoin, couverte
//    en partie par un avoir de 20,00 €, l'accompagne ;
//  - la migration passe sans rien modifier (empreinte de toute la base identique, statut « émise » conservé) ;
//  - après elle, une écriture directe sur cette facture ou sur son avoir est refusée au COMMIT par la vérification différée,
//    au message exact, en écriture simple comme en transaction ; la facture témoin s'écrit toujours ;
//  - l'application, montée sur cette base, la laisse « émise » : un règlement est refusé (409 « déjà soldée », N14), un nouvel
//    avoir par le plafond, l'annulation par ses avoirs partiels ; elle n'a aucun règlement à contre-passer ; rien n'est écrit. Les
//    migrations postérieures à celle du lot sont jouées juste avant de monter l'application, qui suppose le schéma complet (#526, N3 de
//    l'audit des montants de #524 : le test n'exige plus que la migration du lot soit la dernière ; corrigé par le lot « Pas d'avoir
//    à 0,00 € », première PR qui ajoute une migration) ;
//  - seule l'écriture directe qui la passe « réglée » est admise : elle est soldée au sens de la nouvelle garde.
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
const migration = '20261110090000_reglee_par_avoirs';
const TITRE = 'Migration 20261110090000_reglee_par_avoirs : une facture émise déjà soldée par ses avoirs n’est pas reprise, reste « émise », et toute écriture directe incohérente sur elle est refusée au COMMIT';

const ANCIENNE_GARDE = 'Une facture ne passe à « réglée » que soldée par ses règlements.';
const differee = (id) => `Facture ${id} : statut EMISE incohérent avec ses règlements et ses avoirs (réglée si le reste dû est nul ou négatif, avec un montant positif réglé ou crédité par des avoirs partiels).`;

if (!adminUrl) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const url = new URL(adminUrl);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs), suffixe tiré au hasard.
    const base = `iris_test_reglee_avoirs_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const maintenance = new URL(url);
    maintenance.pathname = '/postgres';
    const cible = new URL(url);
    cible.pathname = `/${base}`;
    const admin = new pg.Client({ connectionString: maintenance.toString() });
    const dossier = mkdtempSync(join(tmpdir(), 'iris-reglee-avoirs-'));
    const schema = join(dossier, 'schema.prisma');
    const migrations = join(dossier, 'migrations');
    let creee = false;
    let db = null;
    let prisma = null;
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
      assert.ok(tables.includes('Facture') && tables.includes('JournalFacture'));
      const sql = tables.map((t) => `SELECT '${t}' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${t}" x`).join(' UNION ALL ');
      return Object.fromEntries((await db.query(sql)).rows.map(({ t, n, h }) => [t, `${n}:${h}`]));
    };
    const changees = (avant, apres) => Object.keys({ ...avant, ...apres }).filter((t) => avant[t] !== apres[t]);
    const statut = async (id) => (await db.query('SELECT "statut" FROM "Facture" WHERE "id" = $1', [id])).rows[0]?.statut;
    const resteDu = async (id) => Number((await db.query('SELECT reste_du_facture($1) AS r', [id])).rows[0].r);
    // Écriture directe refusée : message exact (celui de PostgreSQL tel quel par pg, ou cité par Prisma), rien d'écrit.
    const refusee = async (ecriture, message, quoi) => {
      const avant = await empreinte();
      await assert.rejects(ecriture, (erreur) => {
        assert.ok(erreur.message === message || String(erreur.message).includes(`ERROR: ${message}`) || String(erreur.message).includes(`message: "${message}"`), `${quoi} : ${erreur.message}`);
        return true;
      }, quoi);
      assert.deepEqual(changees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
    };

    // Pièce écrite en base comme l'application l'écrit (modèle : le test #230 d'api.test.mjs) : lignes et ventilation égales aux
    // totaux, écritures équilibrées sur le TTC, scellée. 1 × HT à 20 %. Écriture de TVA à la clé et au taux que l'application écrit
    // (`TVA:20`, tauxTva) : la migration du lot AC (#243), jouée avant le dernier test, contrôle la pièce à sa prochaine écriture,
    // et refuserait une écriture `TVA` sans taux.
    const piece = async (tx, { type, numero, factureOrigineId = null, ht }) => {
      const tva = Math.round(ht * 20) / 100;
      const ttc = Math.round((ht + tva) * 100) / 100;
      const creee = await tx.facture.create({ data: {
        clientId: ids.client, clientRaisonSociale: 'TEST Client migration réglée par avoirs', type, statut: 'EMISE', numero, factureOrigineId, estAvoirAnnulation: false,
        dateEmission: new Date('2026-09-08T00:00:00.000Z'), dateEcheance: new Date('2026-10-08T00:00:00.000Z'), totalHt: ht, totalTva: tva, totalTtc: ttc,
        origine: 'HORS_AFFAIRE', motifHorsAffaire: 'TEST migration réglée par avoirs', identiteEmetteurId: ids.identite,
        // Colonnes lues nommées : le client Prisma suit le schéma courant, dont les colonnes ajoutées après cette migration
        // (Facture.cleEnvoi, lot X) n'existent pas dans cette base.
      }, select: { id: true } });
      await tx.factureLigne.create({ data: { factureId: creee.id, ordre: 0, designation: `TEST ${numero}`, nature: 'PRESTATION', quantite: 1, prixUnitaireHt: ht, tauxTva: 20, totalHt: ht, totalTtc: ttc } });
      await tx.factureVentilationTva.create({ data: { factureId: creee.id, tauxTva: 20, totalHt: ht, totalTva: tva, totalTtc: ttc } });
      const sens = (montant, debit) => (debit === (type === 'FACTURE') ? { debit: montant, credit: 0 } : { debit: 0, credit: montant });
      await tx.ecritureFacture.createMany({ data: [
        { factureId: creee.id, ordre: 0, cle: 'CLIENT', journalCode: 'VE', compteNum: '411000', compteLib: 'TEST Clients', ...sens(ttc, true) },
        { factureId: creee.id, ordre: 1, cle: 'VENTE_PRESTATION', journalCode: 'VE', compteNum: '706000', compteLib: 'TEST Ventes', ...sens(ht, false) },
        { factureId: creee.id, ordre: 2, cle: 'TVA:20', tauxTva: 20, journalCode: 'VE', compteNum: '445710', compteLib: 'TEST TVA', ...sens(tva, false) },
      ] });
      await tx.facture.update({ where: { id: creee.id }, data: { ecrituresScellees: true }, select: { id: true } });
      return creee;
    };
    const transaction = (operations) => prisma.$transaction(async (tx) => {
      const resultat = await operations(tx);
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return resultat;
    });

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
      const { PrismaClient } = await import('@prisma/client');
      prisma = new PrismaClient({ datasources: { db: { url: cible.toString() } } });
    });

    after(async () => {
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      await db?.end().catch(() => {});
      for (const nom of NOMS_ENVIRONNEMENT) { if (environnementAvant[nom] === undefined) delete process.env[nom]; else process.env[nom] = environnementAvant[nom]; }
      if (creee) await admin.query(`DROP DATABASE IF EXISTS "${base}" WITH (FORCE)`).catch(() => {});
      await admin.end().catch(() => {});
      rmSync(dossier, { recursive: true, force: true });
    });

    test('avant la migration : une facture émise de 120,00 € soldée par son seul avoir partiel de 120,00 € est admise par les anciennes gardes, qui refusent de la passer « réglée » ; une facture témoin couverte en partie (20,00 €) l’accompagne', async () => {
      ids.identite = randomUUID();
      await db.query(`INSERT INTO "IdentiteEmetteur" ("id", "empreinte", "raisonSociale", "siret", "adresse", "codePostal", "ville", "couleurPrimaire")
        VALUES ($1, 'TEST-IDENTITE-MIGRATION-REGLEE', 'TEST Société émettrice', '12345678900011', '1 rue des Tests', '14000', 'Caen', '#1e3a8a')`, [ids.identite]);
      ids.client = (await prisma.client.create({ data: { raisonSociale: 'TEST Client migration réglée par avoirs' } })).id;
      // Facture F soldée par son avoir A (1 × 100,00 € HT, TTC 120,00 € chacun) ; facture témoin G, avoir partiel B de 20,00 €.
      ids.f = (await transaction((tx) => piece(tx, { type: 'FACTURE', numero: 'TEST-F-ANCIENNE', ht: 100 }))).id;
      ids.a = (await transaction((tx) => piece(tx, { type: 'AVOIR', numero: 'TEST-A-ANCIEN', factureOrigineId: ids.f, ht: 100 }))).id;
      ids.g = (await transaction((tx) => piece(tx, { type: 'FACTURE', numero: 'TEST-F-TEMOIN', ht: 100 }))).id;
      // 16,67 € HT, TVA 3,33 €, TTC 20,00 €.
      ids.b = (await transaction((tx) => piece(tx, { type: 'AVOIR', numero: 'TEST-A-TEMOIN', factureOrigineId: ids.g, ht: 16.67 }))).id;
      assert.deepEqual([await statut(ids.f), await resteDu(ids.f), await statut(ids.g), await resteDu(ids.g)], ['EMISE', 0, 'EMISE', 100]);
      // L'ancienne garde immédiate ne compte que les règlements : la passer « réglée » est refusé, avec l'ancien message.
      await assert.rejects(db.query(`UPDATE "Facture" SET "statut" = 'REGLEE' WHERE "id" = $1`, [ids.f]), (erreur) => { assert.equal(erreur.message, ANCIENNE_GARDE); return true; });
      // Et l'ancienne vérification différée l'admet « émise » : une écriture simple sur elle passe.
      await db.query(`UPDATE "Facture" SET "updatedAt" = now() WHERE "id" = $1`, [ids.f]);
      assert.equal(await statut(ids.f), 'EMISE');
    });

    test('la migration passe sans modifier la facture déjà soldée par ses avoirs ni aucune autre ligne : statut « émise » conservé, empreinte de toute la base identique', async () => {
      assert.ok(ids.f, 'données d’avant la migration absentes');
      const avant = await empreinte();
      const ligneAvant = (await db.query('SELECT * FROM "Facture" WHERE "id" = $1', [ids.f])).rows[0];
      cpSync(join(prismaDir, 'migrations', migration), join(migrations, migration), { recursive: true });
      deploy();
      const appliquee = (await db.query('SELECT "migration_name", "finished_at" IS NOT NULL AS terminee, "rolled_back_at" IS NULL AS valide FROM "_prisma_migrations" WHERE "migration_name" = $1', [migration])).rows;
      assert.deepEqual(appliquee, [{ migration_name: migration, terminee: true, valide: true }]);
      assert.deepEqual(changees(avant, await empreinte()), [], 'aucune ligne reprise ni réécrite');
      assert.deepEqual((await db.query('SELECT * FROM "Facture" WHERE "id" = $1', [ids.f])).rows[0], ligneAvant, 'la facture, updatedAt compris');
      assert.deepEqual([await statut(ids.f), await resteDu(ids.f)], ['EMISE', 0]);
    });

    // N21 du contrôle : la garde refuse toute écriture directe qui la laisse « émise » (sa ligne, son avoir, un nouvel avoir) ; seule
    // celle qui la passe « réglée » est admise (dernier test).
    test('après la migration : une écriture directe qui laisse « émise » la facture soldée par ses avoirs (sa ligne, son avoir, un nouvel avoir brouillon) est refusée au COMMIT par la vérification différée (message exact), en écriture simple comme en transaction ; la facture témoin s’écrit toujours', async () => {
      assert.ok(ids.f, 'données d’avant la migration absentes');
      await refusee(() => db.query('UPDATE "Facture" SET "updatedAt" = now() WHERE "id" = $1', [ids.f]), differee(ids.f), 'écriture simple sur la facture');
      await refusee(() => db.query('UPDATE "Facture" SET "updatedAt" = now() WHERE "id" = $1', [ids.a]), differee(ids.f), 'écriture simple sur son avoir');
      await refusee(async () => {
        await db.query('BEGIN');
        try {
          await db.query('UPDATE "Facture" SET "updatedAt" = now() WHERE "id" = $1', [ids.f]);
          await db.query('COMMIT');
        } catch (erreur) { await db.query('ROLLBACK').catch(() => {}); throw erreur; }
      }, differee(ids.f), 'transaction sur la facture, refusée au COMMIT');
      // Un nouvel avoir, même resté brouillon (il ne compte pas), relit sa facture d'origine : refusé de même.
      await refusee(() => prisma.facture.create({ data: {
        clientId: ids.client, clientRaisonSociale: 'TEST Client migration réglée par avoirs', type: 'AVOIR', statut: 'BROUILLON', factureOrigineId: ids.f, estAvoirAnnulation: false,
        dateEmission: new Date('2026-09-08T00:00:00.000Z'), dateEcheance: new Date('2026-10-08T00:00:00.000Z'), totalHt: 1, totalTva: 0.2, totalTtc: 1.2,
        origine: 'HORS_AFFAIRE', motifHorsAffaire: 'TEST nouvel avoir', identiteEmetteurId: ids.identite,
      }, select: { id: true } }).then(() => null), differee(ids.f), 'nouvel avoir brouillon');
      assert.equal(await statut(ids.f), 'EMISE');
      // Témoin : la facture couverte en partie (reste dû 100,00 €) n'est pas soldée, et s'écrit.
      const avant = (await db.query('SELECT "updatedAt" FROM "Facture" WHERE "id" = $1', [ids.g])).rows[0].updatedAt;
      assert.equal((await db.query('UPDATE "Facture" SET "updatedAt" = now() WHERE "id" = $1', [ids.g])).rowCount, 1);
      assert.notDeepEqual((await db.query('SELECT "updatedAt" FROM "Facture" WHERE "id" = $1', [ids.g])).rows[0].updatedAt, avant);
      assert.equal(await statut(ids.g), 'EMISE');
    });

    test('après la migration, par l’application (migrations postérieures jouées) : la facture reste « émise » (reste dû 0,00 €, avoirs 120,00 €) ; règlement refusé (409 « déjà soldée »), avoir refusé par le plafond (409), annulation refusée par ses avoirs partiels (409), sans écriture ; aucun règlement à contre-passer', async () => {
      assert.ok(ids.f, 'données d’avant la migration absentes');
      // L'application suppose le schéma de toutes les migrations : celles qui suivent la migration du lot sont jouées avant de la
      // monter (#526, N3), et la facture reste telle quelle.
      const posterieures = toutes.filter((n) => n > migration);
      for (const nom of posterieures) cpSync(join(prismaDir, 'migrations', nom), join(migrations, nom), { recursive: true });
      if (posterieures.length) deploy();
      const appliquees = (await db.query('SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL')).rows.map((r) => r.migration_name).sort();
      assert.deepEqual(appliquees, toutes, 'toutes les migrations du dépôt sont appliquées');
      assert.deepEqual([await statut(ids.f), await resteDu(ids.f)], ['EMISE', 0]);
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
      const lue = (await request(serveur.app).get('/api/factures').set(auth)).body.find((x) => x.id === ids.f);
      assert.deepEqual([lue.statut, lue.montantAvoirs, lue.montantRegle, lue.resteDu], ['EMISE', 120, 0, 0]);
      const jour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()).replaceAll('/', '-');
      const refus = async (appel, statutAttendu, message, quoi) => {
        const avant = await empreinte();
        const res = await appel();
        assert.deepEqual([res.status, res.body?.error], [statutAttendu, message], `${quoi} : ${JSON.stringify(res.body)}`);
        assert.deepEqual(changees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      };
      await refus(() => request(serveur.app).post('/api/reglements').set(auth).send({ clientId: ids.client, dateReglement: jour, montant: 10, moyen: 'VIREMENT', affectations: [{ factureId: ids.f, montant: 10 }] }),
        409, 'La facture TEST-F-ANCIENNE est déjà soldée (reste dû 0,00 €) : elle ne reçoit plus de règlement.', 'règlement');
      await refus(() => request(serveur.app).post(`/api/factures/${ids.f}/avoirs`).set(auth).send({ lignes: [{ designation: 'TEST un centime', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 0.01, tauxTva: 20 }] }),
        409, 'Cet avoir dépasse le montant total restant à créditer sur la facture d’origine.', 'avoir');
      await refus(() => request(serveur.app).post(`/api/factures/${ids.f}/annuler`).set(auth).send({}),
        409, 'Cette facture porte déjà un ou plusieurs avoirs partiels : elle ne peut plus être annulée en totalité.', 'annulation');
      assert.equal(Number((await db.query('SELECT count(*) AS n FROM "AffectationReglement" WHERE "factureId" = $1', [ids.f])).rows[0].n), 0, 'aucun règlement à contre-passer');
      assert.equal(await statut(ids.f), 'EMISE');
    });

    test('après la migration : seule l’écriture directe qui la passe « réglée » est admise, ses avoirs partiels la soldant au sens de la nouvelle garde', async () => {
      assert.ok(ids.f, 'données d’avant la migration absentes');
      assert.equal((await db.query(`UPDATE "Facture" SET "statut" = 'REGLEE' WHERE "id" = $1`, [ids.f])).rowCount, 1);
      assert.equal(await statut(ids.f), 'REGLEE');
      // Revenir à « émise » est refusé : soldée par ses avoirs partiels, elle reste « réglée ».
      await refusee(() => db.query(`UPDATE "Facture" SET "statut" = 'EMISE' WHERE "id" = $1`, [ids.f]), 'Une facture soldée par ses règlements ou ses avoirs partiels reste « réglée ».', 'retour à « émise »');
    });
  });
}
