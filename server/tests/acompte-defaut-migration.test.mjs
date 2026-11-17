// Lot « acompte des devis » (cadrage v3.1 du 17-11-2026, section 1 : « migration ALTER TABLE "Parametres" ALTER COLUMN
// "tauxAcompteDefaut" SET DEFAULT 40 » ; « Une nouvelle installation prend donc 40. Une ligne déjà créée garde sa valeur :
// aucune reprise de données (règle 4) »). Décision de Nelson du 17-11-2026, mot pour mot : « par defaut, le reglage doit
// etre a 40% d'accompte, qui sera modifiable dans les parametre de société justement ».
//
// Migration 20261117120000_acompte_defaut_40, exécutée sur une base jetable distincte, créée et supprimée par le test
// (TEST_DATABASE_URL ne sert que de connexion administrative) :
//  - base existante : migrations jusqu'à la précédente, ligne de réglages créée sans le taux (elle prend 30, l'ancien
//    défaut), puis la migration : la ligne garde 30, ses autres réglages intacts ; une ligne réglée à 25 garde 25. Lectures
//    écartées : une reprise qui passerait les lignes existantes à 40, ou qui réécrirait un autre réglage ;
//  - base neuve : la colonne vaut 40 par défaut (information_schema), une ligne de réglages créée sans le taux le reçoit à
//    40 ; Decimal(5,2), NOT NULL. Lecture écartée : défaut resté à 30.
// Sans TEST_DATABASE_URL, le test s'annonce ignoré, comme les autres tests de migration : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import pg from 'pg';

const adminUrl = process.env.TEST_DATABASE_URL;
const prismaDir = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma');
const migration = '20261117120000_acompte_defaut_40';

// Base jetable propre au test, au nom qui porte « test » comme mot (règle de client/scripts/base-jetable.mjs), migrée jusqu'à
// `jusqua` exclu (toutes les migrations si null), dans un dossier de migrations temporaire.
async function avecBase(jusqua, corps) {
  const url = new URL(adminUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'seul PostgreSQL local est autorisé');
  const base = `iris_test_acompte_defaut_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  url.pathname = `/${base}`;
  const admin = new pg.Client({ connectionString: maintenance.toString() });
  const dir = mkdtempSync(join(tmpdir(), 'iris-acompte-defaut-'));
  const schema = join(dir, 'schema.prisma');
  const migrations = join(dir, 'migrations');
  let creee = false;
  let db;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${base}"`);
    creee = true;
    copyFileSync(join(prismaDir, 'schema.prisma'), schema);
    mkdirSync(migrations);
    copyFileSync(join(prismaDir, 'migrations/migration_lock.toml'), join(migrations, 'migration_lock.toml'));
    const toutes = readdirSync(join(prismaDir, 'migrations')).filter((nom) => nom !== 'migration_lock.toml').sort();
    assert.ok(toutes.includes(migration), `${migration} : migration absente`);
    for (const nom of toutes.filter((n) => jusqua === null || n < jusqua)) cpSync(join(prismaDir, 'migrations', nom), join(migrations, nom), { recursive: true });
    const deploy = () => execFileSync(resolve(prismaDir, '../node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', schema], {
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
    });
    deploy();
    db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    const appliquer = () => {
      cpSync(join(prismaDir, 'migrations', migration), join(migrations, migration), { recursive: true });
      deploy();
    };
    await corps(db, appliquer);
  } finally {
    await db?.end().catch(() => {});
    if (creee) await admin.query(`DROP DATABASE IF EXISTS "${base}" WITH (FORCE)`);
    await admin.end().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}

const colonne = async (db) => (await db.query(`SELECT data_type, numeric_precision, numeric_scale, is_nullable, column_default FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'Parametres' AND column_name = 'tauxAcompteDefaut'`)).rows;
const COLONNE_AVANT = { data_type: 'numeric', numeric_precision: 5, numeric_scale: 2, is_nullable: 'NO', column_default: '30' };
const COLONNE_APRES = { ...COLONNE_AVANT, column_default: '40' };

test('migration du taux d’acompte par défaut, installation existante : la ligne de réglages garde sa valeur (30 de l’ancien défaut, ou 25 réglé par la société), ses autres réglages intacts', { skip: !adminUrl && 'TEST_DATABASE_URL requis' }, async () => {
  for (const [quoi, insertion, attendu] of [
    ['ligne créée à l’ancien défaut', `INSERT INTO "Parametres" ("id", "seuilMargeFaible", "joursSansSaisie", "updatedAt") VALUES ('singleton', 12.34, 21, now())`, '30.00'],
    ['ligne réglée à 25 %', `INSERT INTO "Parametres" ("id", "tauxAcompteDefaut", "seuilMargeFaible", "joursSansSaisie", "updatedAt") VALUES ('singleton', 25, 12.34, 21, now())`, '25.00'],
  ]) {
    await avecBase(migration, async (db, appliquer) => {
      assert.deepEqual(await colonne(db), [COLONNE_AVANT], `${quoi} : avant la migration, le défaut est 30`);
      await db.query(insertion);
      const avant = (await db.query('SELECT * FROM "Parametres" WHERE id = $1', ['singleton'])).rows[0];
      assert.equal(avant.tauxAcompteDefaut, attendu, `${quoi} : valeur avant la migration`);
      appliquer();
      assert.deepEqual(await colonne(db), [COLONNE_APRES], `${quoi} : après la migration, le défaut est 40`);
      const apres = (await db.query('SELECT * FROM "Parametres" WHERE id = $1', ['singleton'])).rows[0];
      // Lecture écartée : la ligne existante passée à 40 (reprise de données, exclue par la règle 4).
      assert.deepEqual(apres, avant, `${quoi} : la ligne n’est pas réécrite (taux, autres réglages et updatedAt)`);
      assert.equal(apres.tauxAcompteDefaut, attendu);
    });
  }
});

test('migration du taux d’acompte par défaut, nouvelle installation : la colonne vaut 40 par défaut, et une ligne de réglages créée sans le taux le reçoit à 40', { skip: !adminUrl && 'TEST_DATABASE_URL requis' }, async () => {
  await avecBase(null, async (db) => {
    assert.deepEqual(await colonne(db), [COLONNE_APRES]);
    await db.query(`INSERT INTO "Parametres" ("id", "updatedAt") VALUES ('singleton', now())`);
    assert.equal((await db.query('SELECT "tauxAcompteDefaut" FROM "Parametres" WHERE id = $1', ['singleton'])).rows[0].tauxAcompteDefaut, '40.00');
    await assert.rejects(db.query('UPDATE "Parametres" SET "tauxAcompteDefaut" = NULL WHERE id = $1', ['singleton']), { code: '23502' });
  });
});
