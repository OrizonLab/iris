// Lot « Assistante technique », PR AT-3 « Factures » (cadrage AT-3, version 1, « Modèle » et « Tests » : « Migration (colonne
// nulle sur base existante, déclencheur d'immutabilité, UPDATE refusé) » ; version 2, « Précisions retenues » : déclencheur sur le
// modèle de figer_marque_temps_passe_facture, figé dès la création ; T10 du contrôle de cohérence de mode 1). Décisions de Nelson
// du 24-10-2026, point 34 (« oui c’est lier au poste d’assiste technique ») et réponse 1 du 09-11-2026 (« Oui, il reste aux
// assistantes ») : le type du compte qui crée une pièce est enregistré sur elle et ne change plus. Règle 4 de la méthode : aucune
// reprise de données, les pièces existantes restent sans type (visibles de la seule administration).
//
// Migration 20261109120000_facture_cree_par_type, exécutée sur des bases jetables distinctes, créées et supprimées par le test
// (TEST_DATABASE_URL ne sert que de connexion administrative) :
//  - base existante : migrations jusqu'à la précédente, deux brouillons déjà là, puis la migration : la colonne est ajoutée,
//    nulle sur ces pièces, leurs autres colonnes intactes ; lecture écartée : une reprise qui poserait un type (celui du créateur,
//    ou ADMIN) sur les pièces existantes. Un type posé ensuite sur une pièce existante est refusé (23514) : une pièce de
//    l'administration ne passe pas dans le périmètre des assistantes techniques ;
//  - base neuve : colonne TEXT, nullable, sans défaut ; déclencheur facture_cree_par_type_fige, BEFORE UPDATE ; une pièce créée
//    avec son type le garde : changé ou vidé, refusé (23514, « Le type du compte qui a créé une facture est figé. ») ; une autre
//    colonne se modifie, et la même valeur se réécrit.
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
const migration = '20261109120000_facture_cree_par_type';
const FIGE = 'Le type du compte qui a créé une facture est figé.';

// Base jetable propre au test, au nom qui porte « test » comme mot (règle de client/scripts/base-jetable.mjs), migrée jusqu'à
// `jusqua` exclu (toutes les migrations si null), dans un dossier de migrations temporaire.
async function avecBase(jusqua, corps) {
  const url = new URL(adminUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'seul PostgreSQL local est autorisé');
  const base = `iris_test_cree_par_type_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  url.pathname = `/${base}`;
  const admin = new pg.Client({ connectionString: maintenance.toString() });
  const dir = mkdtempSync(join(tmpdir(), 'iris-cree-par-type-'));
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
  WHERE table_schema = 'public' AND table_name = 'Facture' AND column_name = 'creeParType'`)).rows;
const declencheur = async (db) => (await db.query(`SELECT t.tgname, (t.tgtype & 2) <> 0 AS avant, (t.tgtype & 16) <> 0 AS mise_a_jour, (t.tgtype & 4) <> 0 AS insertion, p.proname
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = '"Facture"'::regclass AND t.tgname = 'facture_cree_par_type_fige'`)).rows;
// Un client et un brouillon hors affaire, écrits en SQL (le schéma de la base, et non celui du client Prisma de l'application).
const client = async (db) => {
  const id = randomUUID();
  await db.query('INSERT INTO "Client" (id, "raisonSociale", "updatedAt") VALUES ($1, $2, now())', [id, 'TEST Client migration creeParType']);
  return id;
};
const brouillon = async (db, clientId, motif, colonnes = {}) => {
  const id = randomUUID();
  const extra = Object.keys(colonnes);
  await db.query(`INSERT INTO "Facture" (id, "clientId", "clientRaisonSociale", "dateEmission", "dateEcheance", "totalHt", "totalTva", "totalTtc", origine, "motifHorsAffaire", "updatedAt"${extra.map((c) => `, "${c}"`).join('')})
    VALUES ($1, $2, $3, '2026-10-01', '2026-10-31', 10, 2, 12, 'HORS_AFFAIRE', $4, now()${extra.map((_, i) => `, $${5 + i}`).join('')})`,
  [id, clientId, 'TEST Client migration creeParType', motif, ...Object.values(colonnes)]);
  return id;
};
const ligne = async (db, id) => (await db.query('SELECT * FROM "Facture" WHERE id = $1', [id])).rows[0];
// Date d'échéance et type, lus en texte par PostgreSQL (indépendants du fuseau du processus).
const echeanceEtType = async (db, id) => Object.values((await db.query(`SELECT to_char("dateEcheance", 'YYYY-MM-DD') AS echeance, "creeParType" FROM "Facture" WHERE id = $1`, [id])).rows[0]);
// Un refus du déclencheur : check_violation (23514), au message exact.
const refusFige = (erreur) => {
  assert.equal(erreur.code, '23514', erreur.message);
  assert.equal(erreur.message, FIGE);
  return true;
};

test('migration du type du créateur d’une facture, base existante : colonne ajoutée nulle sur les pièces déjà là, leurs autres colonnes intactes ; un type posé ensuite sur une pièce existante est refusé (23514), une autre colonne se modifie', { skip: !adminUrl && 'TEST_DATABASE_URL requis' }, async () => {
  await avecBase(migration, async (db, appliquer) => {
    assert.deepEqual(await colonne(db), [], 'avant la migration, la colonne n’existe pas');
    const clientId = await client(db);
    const pieces = [await brouillon(db, clientId, 'TEST brouillon existant 1'), await brouillon(db, clientId, 'TEST brouillon existant 2')];
    const avant = await Promise.all(pieces.map((id) => ligne(db, id)));
    appliquer();
    assert.deepEqual(await colonne(db), [{ data_type: 'text', is_nullable: 'YES', column_default: null }]);
    assert.equal((await declencheur(db)).length, 1, 'déclencheur posé par la migration');
    for (const [i, id] of pieces.entries()) {
      const apres = await ligne(db, id);
      // Lecture écartée : une reprise des pièces existantes (type posé, ADMIN ou autre).
      assert.equal(apres.creeParType, null, `pièce ${i + 1} : aucun type repris`);
      const { creeParType: _nouvelle, ...autres } = apres;
      assert.deepEqual(autres, avant[i], `pièce ${i + 1} : aucune autre colonne réécrite (updatedAt compris)`);
    }
    // Une pièce existante ne reçoit pas de type après coup : ni celui des assistantes techniques, ni un autre.
    for (const valeur of ['ASSISTANTE_TECHNIQUE', 'ADMIN']) {
      await assert.rejects(db.query('UPDATE "Facture" SET "creeParType" = $1 WHERE id = $2', [valeur, pieces[0]]), refusFige, valeur);
    }
    assert.equal((await ligne(db, pieces[0])).creeParType, null);
    // Une autre colonne de la pièce existante se modifie ; la même valeur (nulle) se réécrit.
    await db.query(`UPDATE "Facture" SET "dateEcheance" = '2026-11-30', "creeParType" = NULL WHERE id = $1`, [pieces[0]]);
    assert.deepEqual(await echeanceEtType(db, pieces[0]), ['2026-11-30', null]);
  });
});

test('migration du type du créateur d’une facture, base neuve : colonne TEXT, nullable, sans défaut ; déclencheur BEFORE UPDATE ; le type posé à la création est figé (changé ou vidé : 23514, « Le type du compte qui a créé une facture est figé. ») ; une autre colonne se modifie, la même valeur se réécrit', { skip: !adminUrl && 'TEST_DATABASE_URL requis' }, async () => {
  await avecBase(null, async (db) => {
    assert.deepEqual(await colonne(db), [{ data_type: 'text', is_nullable: 'YES', column_default: null }]);
    assert.deepEqual(await declencheur(db), [{ tgname: 'facture_cree_par_type_fige', avant: true, mise_a_jour: true, insertion: false, proname: 'figer_type_createur_facture' }]);
    const clientId = await client(db);
    // Sans type à la création : nul (aucun défaut inventé).
    const sansType = await brouillon(db, clientId, 'TEST brouillon sans type');
    assert.equal((await ligne(db, sansType)).creeParType, null);
    const parAssistante = await brouillon(db, clientId, 'TEST brouillon d’une assistante', { creeParType: 'ASSISTANTE_TECHNIQUE' });
    const parAdministration = await brouillon(db, clientId, 'TEST brouillon de l’administration', { creeParType: 'ADMIN' });
    for (const [id, initial, valeurs] of [
      [parAssistante, 'ASSISTANTE_TECHNIQUE', ['ADMIN', 'CONDUCTEUR_TRAVAUX', null, 'assistante_technique']],
      [parAdministration, 'ADMIN', ['ASSISTANTE_TECHNIQUE', null]],
      [sansType, null, ['ASSISTANTE_TECHNIQUE']],
    ]) {
      for (const valeur of valeurs) await assert.rejects(db.query('UPDATE "Facture" SET "creeParType" = $1 WHERE id = $2', [valeur, id]), refusFige, `${initial} → ${valeur}`);
      assert.equal((await ligne(db, id)).creeParType, initial, `${initial} inchangé`);
      // La même valeur se réécrit ; une autre colonne se modifie, le type reste.
      assert.equal((await db.query('UPDATE "Facture" SET "creeParType" = $1, "dateEcheance" = $2 WHERE id = $3', [initial, '2026-12-15', id])).rowCount, 1);
      assert.deepEqual(await echeanceEtType(db, id), ['2026-12-15', initial]);
    }
    // Une mise à jour de plusieurs lignes qui en change une seule est refusée en entier.
    await assert.rejects(db.query(`UPDATE "Facture" SET "creeParType" = 'ASSISTANTE_TECHNIQUE' WHERE id = ANY($1::text[])`, [[parAssistante, parAdministration]]), refusFige);
    assert.deepEqual((await db.query('SELECT id, "creeParType" FROM "Facture" WHERE id = ANY($1::text[]) ORDER BY "creeParType"', [[parAssistante, parAdministration]])).rows.map((r) => r.creeParType), ['ADMIN', 'ASSISTANTE_TECHNIQUE']);
  });
});
