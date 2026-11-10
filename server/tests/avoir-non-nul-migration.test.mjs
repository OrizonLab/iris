// Lot « Pas d'avoir à 0,00 € » (cadrage v2, § 3, « Garde en base », choix par défaut, à confirmer ; C4 du contrôle de cohérence de
// mode 1). Réponses de Nelson du 10-11-2026 : « si 0€ pas d'avoir, on ne fais pas d'avoir a 0€ » (point 5) et « Refuser l'annulation
// (Recommandé) » (annulation d'une facture à 0,00 €). Principe de #235 (20261019180000_plafond_avoirs, l. 1-2) : « les règles que
// l'application applique en créant un avoir partiel ou en annulant une facture sont garanties en base, pour un avoir écrit directement
// en SQL ». Règle 4 de la méthode : aucune donnée réelle, aucune reprise.
//
// Migration 20261110120000_avoir_non_nul, jouée sur une base jetable distincte, créée et supprimée par le test (TEST_DATABASE_URL ne
// sert que de connexion administrative) :
//  - avant elle, l'ancienne garde admet un avoir partiel émis à 0,00 € (sur une facture de 120,00 €) et une facture à 0,00 € annulée
//    par son avoir d'annulation à 0,00 € (ce que l'API écrivait avant le lot) ; une facture témoin porte un avoir de 20,00 € ;
//  - la migration passe sans rien modifier (empreinte de toute la base identique, chaque pièce relue à l'identique) : aucune reprise ;
//  - après elle, la prochaine écriture qui déclenche la garde sur ces pièces est refusée au COMMIT, au message exact : écriture simple
//    ou transaction sur l'avoir à 0,00 €, nouvel avoir sur sa facture, écriture sur la facture annulée ou sur son avoir d'annulation ;
//    une écriture qui ne la déclenche pas (la facture émise elle-même) passe, comme le dit le cadrage (« refusée à sa prochaine
//    écriture qui déclenche la garde ») ; la facture témoin s'écrit, et reçoit un avoir positif mais plus un avoir à 0,00 € ;
//  - les refus de l'ancienne garde restent servis, à leur message (montant négatif, avant le nouveau refus ; dépassement).
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
const migration = '20261110120000_avoir_non_nul';
const TITRE = 'Migration 20261110120000_avoir_non_nul : un avoir émis à 0,00 € déjà en base n’est pas repris, et la prochaine écriture qui déclenche la garde sur lui est refusée au COMMIT';

// Messages exacts des gardes (apostrophes droites, celles de PostgreSQL).
const GARDE = {
  avoirZero: (avoirId, factureId) => `L'avoir ${avoirId} de la facture ${factureId} est à 0,00 € : Iris n'émet pas d'avoir à 0,00 €.`,
  montantNegatif: (avoirId, factureId) => `L'avoir ${avoirId} de la facture ${factureId} porte un montant négatif.`,
  montantTotal: (factureId) => `Les avoirs de la facture ${factureId} dépassent son montant total (HT, TVA ou TTC).`,
};

if (!adminUrl) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const url = new URL(adminUrl);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs), suffixe tiré au hasard.
    const base = `iris_test_avoir_non_nul_migration_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const maintenance = new URL(url);
    maintenance.pathname = '/postgres';
    const cible = new URL(url);
    cible.pathname = `/${base}`;
    const admin = new pg.Client({ connectionString: maintenance.toString() });
    const dossier = mkdtempSync(join(tmpdir(), 'iris-avoir-non-nul-'));
    const schema = join(dossier, 'schema.prisma');
    const migrations = join(dossier, 'migrations');
    let creee = false;
    let db = null;
    let prisma = null;
    const ids = {};
    const deploy = () => execFileSync(resolve(prismaDir, '../node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', schema], {
      env: { ...process.env, DATABASE_URL: cible.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
    });

    // Empreinte de toute la base (hors historique des migrations) : nombre de lignes et contenu de chaque table.
    const empreinte = async () => {
      const tables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`)).rows.map((r) => r.tablename);
      assert.ok(tables.includes('Facture') && tables.includes('EcritureFacture'));
      const sql = tables.map((t) => `SELECT '${t}' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${t}" x`).join(' UNION ALL ');
      return Object.fromEntries((await db.query(sql)).rows.map(({ t, n, h }) => [t, `${n}:${h}`]));
    };
    const changees = (avant, apres) => Object.keys({ ...avant, ...apres }).filter((t) => avant[t] !== apres[t]);
    const ligneFacture = async (id) => (await db.query('SELECT * FROM "Facture" WHERE "id" = $1', [id])).rows[0];
    // Écriture directe refusée : message exact (celui de PostgreSQL tel quel par pg, ou cité par Prisma), rien d'écrit.
    const refusee = async (ecriture, message, quoi) => {
      const avant = await empreinte();
      await assert.rejects(ecriture, (erreur) => {
        assert.ok(erreur.message === message || String(erreur.message).includes(message), `${quoi} : ${erreur.message}`);
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

    // Pièce écrite en base comme l'application l'écrit (modèle : reglee-par-avoirs-migration.test.mjs) : lignes et ventilation égales
    // aux totaux, écritures équilibrées sur le TTC, scellée. 1 × HT à 20 % ; `montants` remplace les totaux (pièce incohérente).
    const piece = async (tx, { id = randomUUID(), type, numero = null, factureOrigineId = null, estAvoirAnnulation = false, ht, montants = null }) => {
      const tva = montants?.totalTva ?? Math.round(ht * 20) / 100;
      const totalHt = montants?.totalHt ?? ht;
      const ttc = montants?.totalTtc ?? Math.round((ht + tva) * 100) / 100;
      const creee = await tx.facture.create({ data: {
        id, clientId: ids.client, clientRaisonSociale: 'TEST Client migration avoir non nul', type, statut: 'EMISE', numero, factureOrigineId, estAvoirAnnulation,
        dateEmission: new Date('2026-11-09T00:00:00.000Z'), dateEcheance: new Date('2026-12-09T00:00:00.000Z'), totalHt, totalTva: tva, totalTtc: ttc,
        origine: 'HORS_AFFAIRE', motifHorsAffaire: 'TEST migration avoir non nul', identiteEmetteurId: ids.identite,
      } });
      await tx.factureLigne.create({ data: { factureId: creee.id, ordre: 0, designation: `TEST ${numero ?? id}`, nature: 'PRESTATION', quantite: 1, prixUnitaireHt: Math.abs(ht), tauxTva: 20, totalHt: ht, totalTtc: Math.round((ht + Math.round(ht * 20) / 100) * 100) / 100 } });
      await tx.factureVentilationTva.create({ data: { factureId: creee.id, tauxTva: 20, totalHt: ht, totalTva: Math.round(ht * 20) / 100, totalTtc: Math.round((ht + Math.round(ht * 20) / 100) * 100) / 100 } });
      const sens = (montant, debit) => (debit === (type === 'FACTURE') ? { debit: montant, credit: 0 } : { debit: 0, credit: montant });
      await tx.ecritureFacture.createMany({ data: [
        { factureId: creee.id, ordre: 0, cle: 'CLIENT', journalCode: 'VE', compteNum: '411000', compteLib: 'TEST Clients', ...sens(Math.max(ttc, 0), true) },
        { factureId: creee.id, ordre: 1, cle: 'VENTE_PRESTATION', journalCode: 'VE', compteNum: '706000', compteLib: 'TEST Ventes', ...sens(Math.max(Math.round((ttc - tva) * 100) / 100, 0), false) },
        { factureId: creee.id, ordre: 2, cle: 'TVA', journalCode: 'VE', compteNum: '445710', compteLib: 'TEST TVA', ...sens(Math.max(tva, 0), false) },
      ] });
      await tx.facture.update({ where: { id: creee.id }, data: { ecrituresScellees: true } });
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
      const toutes = readdirSync(join(prismaDir, 'migrations')).filter((nom) => nom !== 'migration_lock.toml').sort();
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
      await db?.end().catch(() => {});
      if (creee) await admin.query(`DROP DATABASE IF EXISTS "${base}" WITH (FORCE)`).catch(() => {});
      await admin.end().catch(() => {});
      rmSync(dossier, { recursive: true, force: true });
    });

    test('avant la migration : l’ancienne garde admet un avoir partiel émis à 0,00 € sur une facture de 120,00 €, et une facture à 0,00 € annulée par son avoir d’annulation à 0,00 € ; une écriture simple sur l’avoir à 0,00 € passe ; une facture témoin porte un avoir de 20,00 €', async () => {
      ids.identite = randomUUID();
      await db.query(`INSERT INTO "IdentiteEmetteur" ("id", "empreinte", "raisonSociale", "siret", "adresse", "codePostal", "ville", "couleurPrimaire")
        VALUES ($1, 'TEST-IDENTITE-MIGRATION-AVOIR-NON-NUL', 'TEST Société émettrice', '12345678900011', '1 rue des Tests', '14000', 'Caen', '#1e3a8a')`, [ids.identite]);
      ids.client = (await prisma.client.create({ data: { raisonSociale: 'TEST Client migration avoir non nul' } })).id;
      // F (1 × 100,00 € HT, TTC 120,00 €) et son avoir partiel A0 à 0,00 € (lecture écartée : refusé dès avant le lot).
      ids.f = (await transaction((tx) => piece(tx, { type: 'FACTURE', numero: 'TEST-F-CENT', ht: 100 }))).id;
      ids.a0 = (await transaction((tx) => piece(tx, { type: 'AVOIR', numero: 'TEST-A-ZERO', factureOrigineId: ids.f, ht: 0 }))).id;
      // Z, facture à 0,00 €, annulée par son avoir d'annulation Z0 à 0,00 €, comme l'API l'écrivait avant le lot.
      ids.z = (await transaction((tx) => piece(tx, { type: 'FACTURE', numero: 'TEST-F-ZERO', ht: 0 }))).id;
      ids.z0 = (await transaction(async (tx) => {
        await tx.facture.update({ where: { id: ids.z }, data: { statut: 'ANNULEE' } });
        return piece(tx, { type: 'AVOIR', numero: 'TEST-A-ANNULATION-ZERO', factureOrigineId: ids.z, estAvoirAnnulation: true, ht: 0 });
      })).id;
      // G (120,00 €) et son avoir partiel B de 20,00 € (16,67 € HT, TVA 3,33 €).
      ids.g = (await transaction((tx) => piece(tx, { type: 'FACTURE', numero: 'TEST-F-TEMOIN', ht: 100 }))).id;
      ids.b = (await transaction((tx) => piece(tx, { type: 'AVOIR', numero: 'TEST-A-TEMOIN', factureOrigineId: ids.g, ht: 16.67 }))).id;
      const montants = async (id) => { const l = await ligneFacture(id); return [l.statut, Number(l.totalHt), Number(l.totalTva), Number(l.totalTtc)]; };
      assert.deepEqual(await montants(ids.a0), ['EMISE', 0, 0, 0]);
      assert.deepEqual(await montants(ids.z), ['ANNULEE', 0, 0, 0]);
      assert.deepEqual(await montants(ids.z0), ['EMISE', 0, 0, 0]);
      assert.deepEqual(await montants(ids.b), ['EMISE', 16.67, 3.33, 20]);
      // L'ancienne garde relit l'avoir à 0,00 € à son écriture, et l'admet.
      assert.equal((await toucher(ids.a0)).rowCount, 1);
      assert.equal((await toucher(ids.z0)).rowCount, 1);
    });

    test('la migration passe sans reprise : aucune ligne modifiée (empreinte de toute la base identique), l’avoir à 0,00 €, la facture annulée et son avoir d’annulation relus à l’identique', async () => {
      assert.ok(ids.a0, 'données d’avant la migration absentes');
      const avant = await empreinte();
      const lignesAvant = await Promise.all([ids.f, ids.a0, ids.z, ids.z0].map(ligneFacture));
      cpSync(join(prismaDir, 'migrations', migration), join(migrations, migration), { recursive: true });
      deploy();
      const appliquee = (await db.query('SELECT "migration_name", "finished_at" IS NOT NULL AS terminee, "rolled_back_at" IS NULL AS valide FROM "_prisma_migrations" WHERE "migration_name" = $1', [migration])).rows;
      assert.deepEqual(appliquee, [{ migration_name: migration, terminee: true, valide: true }]);
      assert.deepEqual(changees(avant, await empreinte()), [], 'aucune ligne reprise ni réécrite');
      assert.deepEqual(await Promise.all([ids.f, ids.a0, ids.z, ids.z0].map(ligneFacture)), lignesAvant, 'pièces relues à l’identique, updatedAt compris');
    });

    test('après la migration : écriture simple et transaction sur l’avoir à 0,00 €, nouvel avoir positif sur sa facture, écriture sur la facture à 0,00 € annulée ou sur son avoir d’annulation : refusées au COMMIT au message exact, rien d’écrit ; la facture émise elle-même, qui ne déclenche pas la garde, s’écrit', async () => {
      assert.ok(ids.a0, 'données d’avant la migration absentes');
      await refusee(() => toucher(ids.a0), GARDE.avoirZero(ids.a0, ids.f), 'écriture simple sur l’avoir à 0,00 €');
      await refusee(() => enTransaction(() => toucher(ids.a0)), GARDE.avoirZero(ids.a0, ids.f), 'transaction sur l’avoir à 0,00 €, refusée au COMMIT');
      // Un nouvel avoir de 1,20 € sur F relit tous ses avoirs émis, dont A0.
      const nouveau = randomUUID();
      await refusee(() => transaction((tx) => piece(tx, { id: nouveau, type: 'AVOIR', factureOrigineId: ids.f, ht: 1 })), GARDE.avoirZero(ids.a0, ids.f), 'nouvel avoir de 1,20 € sur la facture de l’avoir à 0,00 €');
      // La facture annulée à 0,00 € est revérifiée à son écriture (déclencheur sur une facture annulée), et son avoir d'annulation aussi.
      await refusee(() => toucher(ids.z), GARDE.avoirZero(ids.z0, ids.z), 'écriture simple sur la facture à 0,00 € annulée');
      await refusee(() => toucher(ids.z0), GARDE.avoirZero(ids.z0, ids.z), 'écriture simple sur l’avoir d’annulation à 0,00 €');
      // Aucune reprise : la facture émise elle-même ne déclenche pas la garde, et s'écrit.
      const avant = (await ligneFacture(ids.f)).updatedAt;
      assert.equal((await toucher(ids.f)).rowCount, 1);
      assert.notDeepEqual((await ligneFacture(ids.f)).updatedAt, avant);
      assert.equal((await ligneFacture(ids.a0)).statut, 'EMISE');
    });

    test('après la migration, facture témoin : son avoir de 20,00 € s’écrit, elle reçoit un avoir de 1,20 €, mais plus un avoir à 0,00 € ; les refus de l’ancienne garde restent servis à leur message (montant négatif avant le refus de l’avoir à 0,00 ; dépassement du total)', async () => {
      assert.ok(ids.g, 'données d’avant la migration absentes');
      assert.equal((await toucher(ids.b)).rowCount, 1);
      const admis = await transaction((tx) => piece(tx, { type: 'AVOIR', factureOrigineId: ids.g, ht: 1 }));
      assert.deepEqual([Number(admis.totalHt), Number(admis.totalTva), Number(admis.totalTtc)], [1, 0.2, 1.2]);
      const zero = randomUUID();
      await refusee(() => transaction((tx) => piece(tx, { id: zero, type: 'AVOIR', factureOrigineId: ids.g, ht: 0 })), GARDE.avoirZero(zero, ids.g), 'nouvel avoir à 0,00 € sur la facture témoin');
      // Montant négatif de TTC nul : le refus des montants négatifs passe avant celui de l'avoir à 0,00 €.
      const negatif = randomUUID();
      await refusee(() => transaction((tx) => piece(tx, { id: negatif, type: 'AVOIR', factureOrigineId: ids.g, ht: 0, montants: { totalHt: -5, totalTva: 0, totalTtc: 0 } })), GARDE.montantNegatif(negatif, ids.g), 'avoir à HT négatif et TTC nul');
      // Dépassement : G (120,00 €) porte déjà 21,20 € ; un avoir de 100,00 € HT (TTC 120,00 €) dépasse son total.
      await refusee(() => transaction((tx) => piece(tx, { type: 'AVOIR', factureOrigineId: ids.g, ht: 100 })), GARDE.montantTotal(ids.g), 'dépassement du total');
    });
  });
}
