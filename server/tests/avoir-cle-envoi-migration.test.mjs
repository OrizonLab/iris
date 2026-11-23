// Lot X « Clé d'envoi de la création d'un avoir partiel » (#247 ; cadrage v2 du 23-11-2026, § 1 « Modèle » et « Tests à écrire » :
// « migration (base existante et base neuve, modèle facture-cree-par-type-migration.test.mjs) »). Décision déléguée par Nelson le
// 22-11-2026 (soir), point 3 ; choix par défaut, à confirmer : une clé tirée par le formulaire et enregistrée sur l'avoir partiel,
// figée dès la création. Règle 4 de la méthode : aucune reprise, les pièces existantes restent sans clé.
//
// Migration 20261123120000_avoir_cle_envoi, exécutée sur des bases jetables distinctes, créées et supprimées par le test
// (TEST_DATABASE_URL ne sert que de connexion administrative) :
//  - base existante : migrations jusqu'à la précédente, une facture et un avoir partiel déjà là (brouillons, écrits en SQL), puis la
//    migration : la colonne est ajoutée, nulle sur ces pièces, leurs autres colonnes intactes ; lecture écartée : une reprise qui
//    tirerait une clé pour les avoirs existants. Une clé posée ensuite sur une pièce existante est refusée par le déclencheur
//    (23514, message exact) : figée dès la création, même nulle. Un avoir d'annulation ne s'écrit qu'émis, avec sa facture
//    annulée (garde différée facture_avoir_annulation_origine) : il est éprouvé dans une transaction annulée (base neuve) et, émis
//    par l'API, dans avoir-cle-envoi.test.mjs ;
//  - base neuve : colonne `uuid`, nullable, sans défaut, index unique « Facture_cleEnvoi_key » ; contrainte
//    « Facture_cleEnvoi_avoir_partiel » (choix par défaut, à confirmer : seul un avoir partiel porte une clé) ; déclencheur
//    facture_cle_envoi_figee, BEFORE UPDATE … WHEN (OLD."cleEnvoi" IS DISTINCT FROM NEW."cleEnvoi"), fonction
//    figer_cle_envoi_facture() en plpgsql, ni SECURITY DEFINER ni réglage propre ; une facture ou un avoir d'annulation à clé refusés
//    à l'insertion (23514, contrainte nommée), un avoir partiel à clé admis (clé relue en minuscules), la même clé refusée sur un
//    second avoir (23505, même en majuscules), une clé qui n'est pas un UUID refusée (22P02), plusieurs pièces sans clé admises ;
//    clé changée, vidée ou posée après coup refusée (23514, « La clé d’envoi d’une pièce ne se modifie pas. »), la même valeur
//    réécrite et une autre colonne modifiée admises, une mise à jour de plusieurs lignes qui en change une refusée en entier.
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
const migration = '20261123120000_avoir_cle_envoi';
const FIGEE = 'La clé d’envoi d’une pièce ne se modifie pas.';
const CONTRAINTE = 'Facture_cleEnvoi_avoir_partiel';
const INDEX = 'Facture_cleEnvoi_key';

// Base jetable propre au test, au nom qui porte « test » comme mot (règle de client/scripts/base-jetable.mjs), migrée jusqu'à
// `jusqua` exclu (toutes les migrations si null), dans un dossier de migrations temporaire.
async function avecBase(jusqua, corps) {
  const url = new URL(adminUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'seul PostgreSQL local est autorisé');
  const base = `iris_test_cle_envoi_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  url.pathname = `/${base}`;
  const admin = new pg.Client({ connectionString: maintenance.toString() });
  const dir = mkdtempSync(join(tmpdir(), 'iris-cle-envoi-'));
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
  WHERE table_schema = 'public' AND table_name = 'Facture' AND column_name = 'cleEnvoi'`)).rows;
// Index uniques qui portent sur la seule colonne cleEnvoi.
const indexUnique = async (db) => (await db.query(`SELECT c.relname AS nom, i.indisunique AS unique
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = '"Facture"'::regclass AND i.indnatts = 1 AND i.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = '"Facture"'::regclass AND attname = 'cleEnvoi')`)).rows;
const contrainte = async (db) => (await db.query(`SELECT conname, contype, convalidated FROM pg_constraint WHERE conrelid = '"Facture"'::regclass AND conname = $1`, [CONTRAINTE])).rows;
const declencheur = async (db) => (await db.query(`SELECT t.tgname, (t.tgtype & 2) <> 0 AS avant, (t.tgtype & 16) <> 0 AS mise_a_jour, (t.tgtype & 4) <> 0 AS insertion, (t.tgtype & 1) <> 0 AS par_ligne,
    t.tgenabled, p.proname, n.nspname AS schema, l.lanname AS langage, p.prosecdef AS security_definer, p.proconfig AS reglages, pg_get_triggerdef(t.oid) AS definition
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
  WHERE t.tgrelid = '"Facture"'::regclass AND t.tgname = 'facture_cle_envoi_figee'`)).rows;
// Un client et des pièces brouillons hors affaire, écrits en SQL (le schéma de la base, et non celui du client Prisma de l'application).
const client = async (db) => {
  const id = randomUUID();
  await db.query('INSERT INTO "Client" (id, "raisonSociale", "updatedAt") VALUES ($1, $2, now())', [id, 'TEST Client migration cleEnvoi']);
  return id;
};
const piece = async (db, clientId, motif, colonnes = {}) => {
  const id = randomUUID();
  const extra = Object.keys(colonnes);
  await db.query(`INSERT INTO "Facture" (id, "clientId", "clientRaisonSociale", "dateEmission", "dateEcheance", "totalHt", "totalTva", "totalTtc", origine, "motifHorsAffaire", "updatedAt"${extra.map((c) => `, "${c}"`).join('')})
    VALUES ($1, $2, $3, '2026-11-01', '2026-11-30', 10, 2, 12, 'HORS_AFFAIRE', $4, now()${extra.map((_, i) => `, $${5 + i}`).join('')})`,
  [id, clientId, 'TEST Client migration cleEnvoi', motif, ...Object.values(colonnes)]);
  return id;
};
const avoirPartiel = (db, clientId, factureOrigineId, motif, colonnes = {}) => piece(db, clientId, motif, { type: 'AVOIR', factureOrigineId, estAvoirAnnulation: false, ...colonnes });
const avoirAnnulation = (db, clientId, factureOrigineId, motif, colonnes = {}) => piece(db, clientId, motif, { type: 'AVOIR', factureOrigineId, estAvoirAnnulation: true, ...colonnes });
const ligne = async (db, id) => (await db.query('SELECT * FROM "Facture" WHERE id = $1', [id])).rows[0];
// Clé et date d'échéance, lues en texte par PostgreSQL (indépendantes du fuseau du processus).
const cleEtEcheance = async (db, id) => Object.values((await db.query(`SELECT "cleEnvoi"::text AS cle, to_char("dateEcheance", 'YYYY-MM-DD') AS echeance FROM "Facture" WHERE id = $1`, [id])).rows[0]);
// Un refus du déclencheur : check_violation (23514), au message exact.
const refusFigee = (erreur) => {
  assert.equal(erreur.code, '23514', erreur.message);
  assert.equal(erreur.message, FIGEE);
  return true;
};
// Un refus de la contrainte : check_violation (23514), contrainte nommée.
const refusContrainte = (erreur) => {
  assert.equal(erreur.code, '23514', erreur.message);
  assert.equal(erreur.constraint, CONTRAINTE, erreur.message);
  return true;
};

test('migration de la clé d’envoi d’un avoir, base existante : colonne ajoutée nulle sur la facture et l’avoir partiel déjà là, leurs autres colonnes intactes ; une clé posée ensuite sur une pièce existante est refusée (23514, message exact), une autre colonne se modifie', { skip: !adminUrl && 'TEST_DATABASE_URL requis' }, async () => {
  await avecBase(migration, async (db, appliquer) => {
    assert.deepEqual(await colonne(db), [], 'avant la migration, la colonne n’existe pas');
    const clientId = await client(db);
    const facture = await piece(db, clientId, 'TEST facture existante');
    const pieces = [facture, await avoirPartiel(db, clientId, facture, 'TEST avoir partiel existant')];
    const avant = [];
    for (const id of pieces) avant.push(await ligne(db, id));
    appliquer();
    assert.deepEqual(await colonne(db), [{ data_type: 'uuid', is_nullable: 'YES', column_default: null }]);
    assert.equal((await declencheur(db)).length, 1, 'déclencheur posé par la migration');
    for (const [i, id] of pieces.entries()) {
      const apres = await ligne(db, id);
      // Lecture écartée : une reprise des avoirs existants (clé tirée pour eux).
      assert.equal(apres.cleEnvoi, null, `pièce ${i + 1} : aucune clé reprise`);
      const { cleEnvoi: _nouvelle, ...autres } = apres;
      assert.deepEqual(autres, avant[i], `pièce ${i + 1} : aucune autre colonne réécrite (updatedAt compris)`);
    }
    // Une pièce existante ne reçoit pas de clé après coup (figée dès la création, même nulle) ; le déclencheur passe avant la contrainte.
    for (const [i, id] of pieces.entries()) {
      await assert.rejects(db.query('UPDATE "Facture" SET "cleEnvoi" = $1 WHERE id = $2', [randomUUID(), id]), refusFigee, `pièce ${i + 1}`);
      assert.equal((await ligne(db, id)).cleEnvoi, null);
    }
    // Une autre colonne de l'avoir existant se modifie ; la même valeur (nulle) se réécrit.
    await db.query(`UPDATE "Facture" SET "dateEcheance" = '2026-12-31', "cleEnvoi" = NULL WHERE id = $1`, [pieces[1]]);
    assert.deepEqual(await cleEtEcheance(db, pieces[1]), [null, '2026-12-31']);
  });
});

test('migration de la clé d’envoi d’un avoir, base neuve : colonne uuid nullable sans défaut, index unique, contrainte « avoir partiel seulement », déclencheur BEFORE UPDATE WHEN clé distincte (plpgsql, ni SECURITY DEFINER ni réglage) ; facture et avoir d’annulation à clé refusés (23514), avoir partiel à clé admis (minuscules), clé en double refusée (23505), clé non UUID refusée (22P02) ; clé changée, vidée ou posée après coup refusée (23514, « La clé d’envoi d’une pièce ne se modifie pas. »), la même valeur réécrite, une autre colonne modifiée', { skip: !adminUrl && 'TEST_DATABASE_URL requis' }, async () => {
  await avecBase(null, async (db) => {
    assert.deepEqual(await colonne(db), [{ data_type: 'uuid', is_nullable: 'YES', column_default: null }]);
    assert.deepEqual(await indexUnique(db), [{ nom: INDEX, unique: true }]);
    assert.deepEqual(await contrainte(db), [{ conname: CONTRAINTE, contype: 'c', convalidated: true }]);
    assert.deepEqual(await declencheur(db), [{
      tgname: 'facture_cle_envoi_figee', avant: true, mise_a_jour: true, insertion: false, par_ligne: true, tgenabled: 'O',
      proname: 'figer_cle_envoi_facture', schema: 'public', langage: 'plpgsql', security_definer: false, reglages: null,
      definition: 'CREATE TRIGGER facture_cle_envoi_figee BEFORE UPDATE ON public."Facture" FOR EACH ROW WHEN ((old."cleEnvoi" IS DISTINCT FROM new."cleEnvoi")) EXECUTE FUNCTION figer_cle_envoi_facture()',
    }]);
    const clientId = await client(db);
    const facture = await piece(db, clientId, 'TEST facture d’origine');
    // Contrainte : seule un avoir partiel porte une clé (choix par défaut, à confirmer). Lectures écartées : clé admise sur une
    // facture, ou sur un avoir d'annulation.
    await assert.rejects(piece(db, clientId, 'TEST facture à clé', { cleEnvoi: randomUUID() }), refusContrainte, 'facture à clé');
    await assert.rejects(avoirAnnulation(db, clientId, facture, 'TEST avoir d’annulation à clé', { cleEnvoi: randomUUID() }), refusContrainte, 'avoir d’annulation à clé');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "Facture"')).rows[0].n, 1, 'rien d’écrit par les refus');
    // Un avoir partiel à clé est admis ; la clé est relue en minuscules, quelle que soit la casse écrite.
    const cle = randomUUID();
    const avecCle = await avoirPartiel(db, clientId, facture, 'TEST avoir partiel à clé', { cleEnvoi: cle.toUpperCase() });
    assert.equal((await ligne(db, avecCle)).cleEnvoi, cle);
    // Index unique : la même clé, en majuscules ou en minuscules, est refusée sur un second avoir.
    for (const variante of [cle, cle.toUpperCase()]) {
      await assert.rejects(avoirPartiel(db, clientId, facture, 'TEST avoir partiel en double', { cleEnvoi: variante }), (erreur) => {
        assert.equal(erreur.code, '23505', erreur.message);
        assert.equal(erreur.constraint, INDEX, erreur.message);
        return true;
      }, `clé en double (${variante === cle ? 'minuscules' : 'majuscules'})`);
    }
    // Type uuid : une clé qui n'est pas un UUID est refusée par la base.
    await assert.rejects(avoirPartiel(db, clientId, facture, 'TEST avoir partiel à clé invalide', { cleEnvoi: 'pas-une-cle' }), (erreur) => {
      assert.equal(erreur.code, '22P02', erreur.message);
      return true;
    });
    // Plusieurs pièces sans clé sont admises (aucune clé inventée, l'index unique laisse passer les valeurs nulles).
    const sansCle = [await avoirPartiel(db, clientId, facture, 'TEST avoir sans clé 1'), await avoirPartiel(db, clientId, facture, 'TEST avoir sans clé 2')];
    for (const id of [facture, ...sansCle]) assert.equal((await ligne(db, id)).cleEnvoi, null);

    // Déclencheur : clé changée ou vidée refusée ; clé posée après coup refusée, sur un avoir partiel, une facture, un avoir d'annulation.
    for (const valeur of [randomUUID(), null]) {
      await assert.rejects(db.query('UPDATE "Facture" SET "cleEnvoi" = $1 WHERE id = $2', [valeur, avecCle]), refusFigee, `clé ${valeur === null ? 'vidée' : 'changée'}`);
    }
    for (const [quoi, id] of [['avoir partiel sans clé', sansCle[0]], ['facture', facture]]) {
      await assert.rejects(db.query('UPDATE "Facture" SET "cleEnvoi" = $1 WHERE id = $2', [randomUUID(), id]), refusFigee, `clé posée après coup : ${quoi}`);
    }
    const cles = [];
    for (const id of [avecCle, sansCle[0], facture]) cles.push((await ligne(db, id)).cleEnvoi);
    assert.deepEqual(cles, [cle, null, null]);
    // Avoir d'annulation sans clé, écrit dans une transaction annulée (sa garde différée ne l'admet qu'émis, avec sa facture
    // annulée) : une clé posée après coup est refusée par le déclencheur, avant toute garde différée.
    await db.query('BEGIN');
    try {
      const annulation = await avoirAnnulation(db, clientId, await piece(db, clientId, 'TEST facture annulée'), 'TEST avoir d’annulation sans clé');
      assert.equal((await ligne(db, annulation)).cleEnvoi, null);
      await assert.rejects(db.query('UPDATE "Facture" SET "cleEnvoi" = $1 WHERE id = $2', [randomUUID(), annulation]), refusFigee, 'clé posée après coup : avoir d’annulation');
    } finally {
      await db.query('ROLLBACK');
    }
    // La même valeur se réécrit, en majuscules comme en minuscules ; une autre colonne se modifie, la clé reste.
    for (const variante of [cle, cle.toUpperCase()]) {
      assert.equal((await db.query('UPDATE "Facture" SET "cleEnvoi" = $1, "dateEcheance" = $2 WHERE id = $3', [variante, '2026-12-15', avecCle])).rowCount, 1);
      assert.deepEqual(await cleEtEcheance(db, avecCle), [cle, '2026-12-15']);
    }
    assert.equal((await db.query(`UPDATE "Facture" SET "dateEcheance" = '2026-12-20' WHERE id = $1`, [sansCle[1]])).rowCount, 1);
    assert.deepEqual(await cleEtEcheance(db, sansCle[1]), [null, '2026-12-20']);
    // Une mise à jour de plusieurs lignes qui en change une seule est refusée en entier.
    await assert.rejects(db.query(`UPDATE "Facture" SET "cleEnvoi" = $1, "dateEcheance" = '2027-01-15' WHERE id = ANY($2::text[])`, [cle, [avecCle, sansCle[1]]]), refusFigee);
    assert.deepEqual([await cleEtEcheance(db, avecCle), await cleEtEcheance(db, sansCle[1])], [[cle, '2026-12-15'], [null, '2026-12-20']]);
  });
});
