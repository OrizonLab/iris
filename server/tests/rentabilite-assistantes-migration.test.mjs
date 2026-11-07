// Lot « Assistante technique », PR AT-2b (cadrage AT-2, version 3, C6 : « migration : rentabiliteAssistantesTechniques à
// false sur une base existante et sur une base neuve » ; version 4, C6 de la v3 maintenue). Réponses de Nelson du
// 06-11-2026, 1 et 2 (« Décochée (Recommandé) ») : les assistantes techniques deviennent un quatrième destinataire réglable
// de la rentabilité des chantiers, décoché à l'installation comme sur une installation déjà en service.
//
// Migration 20261107120000_rentabilite_assistantes_techniques, exécutée sur une base jetable distincte, créée et supprimée
// par le test (TEST_DATABASE_URL ne sert que de connexion administrative) :
//  - base existante : migrations jusqu'à la précédente, réglages déjà posés par la société (trois destinataires changés,
//    seuil, anticipation, mode d'envoi), puis la migration : la colonne vaut false sur la ligne existante, ses autres
//    réglages sont intacts (la migration n'en réécrit aucun) ; lecture écartée : la colonne créée à true, ou recopiée d'un
//    autre destinataire (rentabiliteDirecteurs, rentabiliteConducteur) ;
//  - base neuve : une ligne de réglages créée sans la colonne la reçoit à false ; la colonne est booléenne, NOT NULL, de
//    défaut false (information_schema), et refuse NULL (23502).
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
const migration = '20261107120000_rentabilite_assistantes_techniques';

// Base jetable propre au test, au nom qui porte « test » comme mot (règle de client/scripts/base-jetable.mjs), migrée jusqu'à
// `jusqua` exclu (toutes les migrations si null), dans un dossier de migrations temporaire.
async function avecBase(jusqua, corps) {
  const url = new URL(adminUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'seul PostgreSQL local est autorisé');
  const base = `iris_test_rentabilite_at_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  url.pathname = `/${base}`;
  const admin = new pg.Client({ connectionString: maintenance.toString() });
  const dir = mkdtempSync(join(tmpdir(), 'iris-rentabilite-at-'));
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

const colonne = async (db) => (await db.query(`SELECT data_type, is_nullable, column_default FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'Parametres' AND column_name = 'rentabiliteAssistantesTechniques'`)).rows;

test('migration de la rentabilité des assistantes techniques, base existante : la ligne de réglages en place reçoit false, ses autres réglages intacts', { skip: !adminUrl && 'TEST_DATABASE_URL requis' }, async () => {
  await avecBase(migration, async (db, appliquer) => {
    assert.deepEqual(await colonne(db), [], 'avant la migration, la colonne n’existe pas');
    // Réglages déjà posés par la société, distincts des défauts du schéma : les trois destinataires changés (dont le conducteur
    // et les directeurs, que la lecture écartée recopierait), seuil, délai, anticipation et mode d'envoi.
    await db.query(`INSERT INTO "Parametres" ("id", "rentabiliteConducteur", "rentabiliteHierarchie", "rentabiliteDirecteurs", "seuilMargeFaible", "joursSansSaisie", "anticipationVisitesJours", "modeEnvoi", "updatedAt")
      VALUES ('singleton', true, false, true, 12.34, 21, 9, 'MESSAGERIE', now())`);
    const avant = (await db.query('SELECT * FROM "Parametres" WHERE id = $1', ['singleton'])).rows[0];
    appliquer();
    assert.deepEqual(await colonne(db), [{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);
    const apres = (await db.query('SELECT * FROM "Parametres" WHERE id = $1', ['singleton'])).rows[0];
    // Lectures écartées : la colonne à true (défaut des trois autres destinataires) ou recopiée d'un destinataire coché.
    assert.equal(apres.rentabiliteAssistantesTechniques, false);
    const { rentabiliteAssistantesTechniques: _nouvelle, ...autres } = apres;
    assert.deepEqual(autres, avant, 'aucun autre réglage réécrit (updatedAt compris)');
    assert.deepEqual([autres.rentabiliteConducteur, autres.rentabiliteHierarchie, autres.rentabiliteDirecteurs, autres.seuilMargeFaible, autres.modeEnvoi], [true, false, true, '12.34', 'MESSAGERIE']);
  });
});

test('migration de la rentabilité des assistantes techniques, base neuve : une ligne de réglages créée sans la colonne la reçoit à false ; booléenne, NOT NULL, refuse NULL', { skip: !adminUrl && 'TEST_DATABASE_URL requis' }, async () => {
  await avecBase(null, async (db) => {
    assert.deepEqual(await colonne(db), [{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);
    await db.query(`INSERT INTO "Parametres" ("id", "updatedAt") VALUES ('singleton', now())`);
    const ligne = (await db.query('SELECT "rentabiliteAssistantesTechniques", "rentabiliteConducteur", "rentabiliteHierarchie", "rentabiliteDirecteurs" FROM "Parametres" WHERE id = $1', ['singleton'])).rows[0];
    // Décochée à l'installation (réponse 2 du 06-11-2026), quand les trois autres destinataires sont cochés par défaut.
    assert.deepEqual(ligne, { rentabiliteAssistantesTechniques: false, rentabiliteConducteur: true, rentabiliteHierarchie: true, rentabiliteDirecteurs: true });
    await assert.rejects(db.query('UPDATE "Parametres" SET "rentabiliteAssistantesTechniques" = NULL WHERE id = $1', ['singleton']), { code: '23502' });
    await db.query('UPDATE "Parametres" SET "rentabiliteAssistantesTechniques" = true WHERE id = $1', ['singleton']);
    assert.equal((await db.query('SELECT "rentabiliteAssistantesTechniques" FROM "Parametres"')).rows[0].rentabiliteAssistantesTechniques, true);
  });
});
