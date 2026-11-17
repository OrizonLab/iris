// Lot #304 (cadrage v2 du 17-11-2026, prêt à coder ; note N4 du troisième audit interne de #302 ; message de Nelson du
// 17-11-2026, « Ok continu ») : le journal des chantiers, des interventions et des contrats (« JournalSaisieChantier »)
// est en ajout seul en base, comme les autres journaux d'audit (règle 2 de la méthode ; C-15 de PARAMETRAGE-CIBLE.md,
// « Journaux en ajout seul »). Choix par défaut, à confirmer. Critères du cadrage : « Un UPDATE, un DELETE ou un TRUNCATE
// sur JournalSaisieChantier est refusé par la base, avec le message, et l'écriture reste inchangée » ; « la migration
// s'applique sur une base qui contient déjà des écritures, et ne modifie aucune d'elles » ; « l'insertion reste libre. La
// contrainte CHECK sur l'auteur (#302) reste en place ».
//
// Migration 20261117140000_journal_saisie_ajout_seul, exécutée sur une base jetable distincte, créée et supprimée par le
// test (TEST_DATABASE_URL ne sert que de connexion administrative), migrée par étapes :
//  - jusqu'à 20261022210000_compte_systeme_generation exclue : une écriture historique sans auteur (« Génération
//    automatique », admise avant #302 et gardée telle quelle depuis, contrainte NOT VALID) ;
//  - jusqu'à la migration du lot exclue : des écritures sur les trois parents (chantier, intervention, contrat), avec
//    avant, après et motif, dont une du compte système ; témoin : la base accepte encore leur modification, leur
//    suppression et le vidage (transactions annulées) ;
//  - la migration du lot : chaque ligne est identique avant et après (to_jsonb, toutes colonnes). Lecture écartée : une
//    migration qui reprendrait les écritures (auteur posé sur l'écriture historique, par exemple ; règle 4) ;
//  - puis UPDATE, DELETE et TRUNCATE refusés, avec le message exact (P0001), chacun dans une transaction annulée : les
//    lignes restent identiques ; l'insertion reste libre sur les trois parents ; les contraintes CHECK de l'auteur (#302)
//    et du parent unique restent actives ; le changement d'identifiant d'un compte auteur (cascade ON UPDATE de la clé
//    auteurId, effet nouveau écrit dans la migration) est refusé, et la suppression d'un compte auteur l'est toujours par
//    la clé (RESTRICT, 23503), avant le déclencheur.
// Les clés chantierId, interventionId et contratMaintenanceId n'ont pas de clé étrangère : un identifiant suffit à poser
// une écriture sur chacun des trois parents.
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
const migration = '20261117140000_journal_saisie_ajout_seul';
// Première migration où une écriture sans auteur n'est plus admise (contrainte NOT VALID : les anciennes restent).
const compteSysteme = '20261022210000_compte_systeme_generation';
const COMPTE_SYSTEME_ID = '00000000-0000-4000-8000-000000000001';

const REFUS_AJOUT_SEUL = 'Le journal des chantiers, interventions et contrats est en ajout seul : une écriture ne se modifie ni ne se supprime.';
const REFUS_VIDAGE = 'Vidage de « JournalSaisieChantier » interdit (TRUNCATE) : ses lignes ne se suppriment pas.';

// Base jetable propre au test, au nom qui porte « test » comme mot (règle de client/scripts/base-jetable.mjs). `etape(jusqua)`
// applique toutes les migrations antérieures à `jusqua` qui ne le sont pas encore ; `appliquer()` ajoute celle du lot.
async function avecBase(corps) {
  const url = new URL(adminUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'seul PostgreSQL local est autorisé');
  const base = `iris_test_journal_saisie_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  assert.notEqual(url.pathname.slice(1), base);
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  url.pathname = `/${base}`;
  const admin = new pg.Client({ connectionString: maintenance.toString() });
  const dir = mkdtempSync(join(tmpdir(), 'iris-journal-saisie-'));
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
    assert.ok(toutes.includes(compteSysteme), `${compteSysteme} : migration absente`);
    const deploy = () => execFileSync(resolve(prismaDir, '../node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', schema], {
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
    });
    const etape = (jusqua) => {
      for (const nom of toutes.filter((n) => n < jusqua)) cpSync(join(prismaDir, 'migrations', nom), join(migrations, nom), { recursive: true });
      deploy();
    };
    const appliquer = () => {
      cpSync(join(prismaDir, 'migrations', migration), join(migrations, migration), { recursive: true });
      deploy();
    };
    db = new pg.Client({ connectionString: url.toString() });
    await corps({ etape, appliquer, connecter: async () => { await db.connect(); return db; } });
  } finally {
    await db?.end().catch(() => {});
    if (creee) await admin.query(`DROP DATABASE IF EXISTS "${base}" WITH (FORCE)`);
    await admin.end().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}

// Requête jouée dans une transaction annulée. Refusée, l'erreur de la base remonte ; acceptée, elle n'est pas gardée et
// la promesse est rejetée sur « acceptée », que le motif attendu du refus ne reconnaît pas.
async function annulee(db, sql, params = []) {
  await db.query('BEGIN');
  try {
    await db.query(sql, params);
  } finally {
    await db.query('ROLLBACK');
  }
  throw new Error(`acceptée : ${sql}`);
}
// Témoin d'avant la migration : la requête passe, dans une transaction annulée ; renvoie le nombre de lignes touchées.
async function accepteeAnnulee(db, sql, params = []) {
  await db.query('BEGIN');
  try {
    return (await db.query(sql, params)).rowCount;
  } finally {
    await db.query('ROLLBACK');
  }
}

const lignes = async (db) => (await db.query('SELECT to_jsonb(j) AS ligne FROM "JournalSaisieChantier" j ORDER BY j."id"')).rows.map((r) => r.ligne);
const insertion = 'INSERT INTO "JournalSaisieChantier" ("id", "chantierId", "interventionId", "contratMaintenanceId", "cible", "cibleId", "action", "auteurId", "auteurNom", "avant", "apres", "motif") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)';

test('migration du journal des chantiers, interventions et contrats en ajout seul : les écritures existantes, sur les trois parents, restent identiques ; ensuite UPDATE, DELETE et TRUNCATE sont refusés avec le message, l’insertion reste libre et les contraintes de l’auteur (#302) et du parent restent actives', { skip: !adminUrl && 'TEST_DATABASE_URL requis' }, async () => {
  await avecBase(async ({ etape, appliquer, connecter }) => {
    const chantierId = randomUUID();
    const interventionId = randomUUID();
    const contratId = randomUUID();
    const auteurId = randomUUID();
    const autreAuteurId = randomUUID();
    // L'écriture historique est éprouvée en dernier : sa modification est refusée aussi par la contrainte de l'auteur (NOT
    // VALID, vérifiée à chaque UPDATE) ; éprouvée en premier, elle masquerait un déclencheur absent derrière ce refus-là.
    const ids = {
      achat: `b-${randomUUID()}`, correction: `c-${randomUUID()}`, client: `d-${randomUUID()}`,
      intervention: `e-${randomUUID()}`, contrat: `f-${randomUUID()}`, systeme: `g-${randomUUID()}`, historique: `a-${randomUUID()}`,
    };

    // 1. Écriture historique sans auteur, admise avant #302 (génération automatique des visites, lot pilote 5).
    etape(compteSysteme);
    const db = await connecter();
    await db.query('INSERT INTO "User" ("id", "email", "name", "updatedAt") VALUES ($1, $2, $3, now()), ($4, $5, $6, now())',
      [auteurId, `${auteurId}@iris.test`, 'TEST Auteur du journal 304', autreAuteurId, `${autreAuteurId}@iris.test`, 'TEST Autre auteur 304']);
    await db.query(insertion, [ids.historique, null, interventionId, null, 'INTERVENTION', interventionId, 'CREATION_CONTRAT', null, 'Génération automatique', null, JSON.stringify({ id: interventionId, statut: 'A_PLANIFIER' }), null]);

    // 2. Écritures sur les trois parents, telles que les routes les posent, juste avant la migration du lot.
    etape(migration);
    const achatId = randomUUID();
    await db.query(insertion, [ids.achat, chantierId, null, null, 'ACHAT', achatId, 'CREATION', auteurId, 'TEST Auteur du journal 304', null, JSON.stringify({ id: achatId, montantHT: '25.50', description: 'Câble « TEST » 2,5 mm²' }), null]);
    await db.query(insertion, [ids.correction, chantierId, null, null, 'ACHAT', achatId, 'CORRECTION', auteurId, 'TEST Auteur du journal 304', JSON.stringify({ montantHT: '25.50' }), JSON.stringify({ montantHT: '30.00' }), 'Correction nécessaire']);
    await db.query(insertion, [ids.client, chantierId, null, null, 'CHANTIER', chantierId, 'CHANGEMENT_CLIENT', autreAuteurId, 'TEST Autre auteur 304', JSON.stringify({ clientId: null, raisonSociale: null, libelle: 'TEST Ancien client' }), JSON.stringify({ clientId: randomUUID(), raisonSociale: 'TEST Nouveau client', libelle: 'TEST Nouveau client' }), null]);
    await db.query(insertion, [ids.intervention, null, interventionId, null, 'INTERVENTION', interventionId, 'CHANGEMENT_STATUT', auteurId, 'TEST Auteur du journal 304', JSON.stringify({ statut: 'A_PLANIFIER' }), JSON.stringify({ statut: 'ANNULEE' }), 'Annulation : client injoignable']);
    await db.query(insertion, [ids.contrat, null, null, contratId, 'CONTRAT', contratId, 'SUSPENSION', autreAuteurId, 'TEST Autre auteur 304', JSON.stringify({ statut: 'ACTIF' }), JSON.stringify({ statut: 'SUSPENDU' }), 'Client en travaux']);
    await db.query(insertion, [ids.systeme, null, null, contratId, 'CONTRAT', contratId, 'AVANCEMENT_ECHEANCE', COMPTE_SYSTEME_ID, 'Iris (automatique)', JSON.stringify({ prochaineEcheance: '2026-11-01' }), JSON.stringify({ prochaineEcheance: '2027-05-01' }), 'Visite générée']);
    const avant = await lignes(db);
    assert.equal(avant.length, 7);
    assert.equal(avant.find((l) => l.id === ids.historique).auteurId, null, 'écriture historique sans auteur posée');

    // Témoin : sans la migration du lot, la base accepte modification, suppression et vidage (annulés aussitôt).
    assert.equal(await accepteeAnnulee(db, 'UPDATE "JournalSaisieChantier" SET "motif" = $1 WHERE "id" = $2', ['TEST réécrit', ids.correction]), 1, 'témoin : UPDATE accepté avant la migration');
    assert.equal(await accepteeAnnulee(db, 'DELETE FROM "JournalSaisieChantier" WHERE "id" = $1', [ids.achat]), 1, 'témoin : DELETE accepté avant la migration');
    await accepteeAnnulee(db, 'TRUNCATE "JournalSaisieChantier"');
    assert.deepEqual(await lignes(db), avant, 'témoins annulés : rien n’a changé');

    // 3. La migration du lot : aucune écriture n'est reprise (règle 4).
    appliquer();
    assert.deepEqual(await lignes(db), avant, 'chaque écriture est identique après la migration (toutes colonnes, horodatage compris)');

    // 4. Modification refusée, quelle que soit la colonne, une écriture ou plusieurs.
    const refusAjoutSeul = { code: 'P0001', message: REFUS_AJOUT_SEUL };
    const modifications = [
      ['motif', 'UPDATE "JournalSaisieChantier" SET "motif" = $2 WHERE "id" = $1', ['TEST motif réécrit']],
      ['auteur', 'UPDATE "JournalSaisieChantier" SET "auteurId" = $2, "auteurNom" = $3 WHERE "id" = $1', [autreAuteurId, 'TEST Autre auteur 304']],
      ['horodatage', 'UPDATE "JournalSaisieChantier" SET "createdAt" = $2 WHERE "id" = $1', [new Date('2020-01-01T00:00:00.000Z')]],
      ['contenu', 'UPDATE "JournalSaisieChantier" SET "avant" = NULL, "apres" = $2::jsonb WHERE "id" = $1', ['{}']],
      ['cible', 'UPDATE "JournalSaisieChantier" SET "cibleId" = $2 WHERE "id" = $1', ['TEST-autre-cible']],
      ['sans changement', 'UPDATE "JournalSaisieChantier" SET "motif" = "motif" WHERE "id" = $1', []],
    ];
    for (const [nom, id] of Object.entries(ids)) {
      for (const [colonne, sql, params] of modifications) {
        await assert.rejects(annulee(db, sql, [id, ...params]), refusAjoutSeul, `${nom} : modification (${colonne}) refusée`);
      }
    }
    await assert.rejects(annulee(db, 'UPDATE "JournalSaisieChantier" SET "motif" = $1', ['TEST tout réécrit']), refusAjoutSeul, 'modification de toutes les écritures refusée');
    // Changement d'identifiant d'un compte auteur : la cascade ON UPDATE de la clé auteurId réécrirait ses écritures.
    await assert.rejects(annulee(db, 'UPDATE "User" SET "id" = $1 WHERE "id" = $2', [randomUUID(), auteurId]), refusAjoutSeul, 'identifiant d’un compte auteur : cascade refusée');
    assert.deepEqual(await lignes(db), avant, 'modifications refusées : aucune écriture n’a changé');

    // 5. Suppression refusée, une écriture ou toutes ; celle d'un compte auteur l'est par la clé, avant le déclencheur.
    for (const [nom, id] of Object.entries(ids)) {
      await assert.rejects(annulee(db, 'DELETE FROM "JournalSaisieChantier" WHERE "id" = $1', [id]), refusAjoutSeul, `${nom} : suppression refusée`);
    }
    for (const [parent, colonne, valeur] of [['chantier', 'chantierId', chantierId], ['intervention', 'interventionId', interventionId], ['contrat', 'contratMaintenanceId', contratId]]) {
      await assert.rejects(annulee(db, `DELETE FROM "JournalSaisieChantier" WHERE "${colonne}" = $1`, [valeur]), refusAjoutSeul, `${parent} : suppression de ses écritures refusée`);
    }
    await assert.rejects(annulee(db, 'DELETE FROM "JournalSaisieChantier"'), refusAjoutSeul, 'suppression de toutes les écritures refusée');
    await assert.rejects(annulee(db, 'DELETE FROM "User" WHERE "id" = $1', [auteurId]), { code: '23503' }, 'compte auteur : suppression refusée par la clé auteurId');
    assert.deepEqual(await lignes(db), avant, 'suppressions refusées : aucune écriture ne manque');

    // 6. Vidage refusé, la table nommée.
    await assert.rejects(annulee(db, 'TRUNCATE "JournalSaisieChantier"'), { code: 'P0001', message: REFUS_VIDAGE }, 'vidage refusé');
    assert.deepEqual(await lignes(db), avant, 'vidage refusé : aucune écriture ne manque');

    // 7. L'insertion reste libre sur les trois parents ; les contraintes de l'auteur (#302) et du parent restent actives.
    const nouvelles = [randomUUID(), randomUUID(), randomUUID()];
    await db.query(insertion, [nouvelles[0], chantierId, null, null, 'HEURE', randomUUID(), 'CREATION', auteurId, 'TEST Auteur du journal 304', null, JSON.stringify({ nbrHeures: '2.00' }), null]);
    await db.query(insertion, [nouvelles[1], null, interventionId, null, 'INTERVENTION_RAPPORT', randomUUID(), 'CREATION', autreAuteurId, 'TEST Autre auteur 304', null, JSON.stringify({ contenu: 'TEST compte rendu' }), null]);
    await db.query(insertion, [nouvelles[2], null, null, contratId, 'CONTRAT', contratId, 'REACTIVATION', auteurId, 'TEST Auteur du journal 304', JSON.stringify({ statut: 'SUSPENDU' }), JSON.stringify({ statut: 'ACTIF' }), 'Travaux terminés']);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM "JournalSaisieChantier" WHERE "id" = ANY($1)', [nouvelles])).rows[0].total, 3, 'trois écritures ajoutées');
    const refusInsertion = [
      ['sans auteur', [randomUUID(), chantierId, null, null, 'ACHAT', randomUUID(), 'CREATION', null, 'Génération automatique', null, null, null]],
      ['compte système hors génération', [randomUUID(), chantierId, null, null, 'ACHAT', randomUUID(), 'CREATION', COMPTE_SYSTEME_ID, 'Iris (automatique)', null, null, null]],
      ['deux parents', [randomUUID(), chantierId, interventionId, null, 'ACHAT', randomUUID(), 'CREATION', auteurId, 'TEST Auteur du journal 304', null, null, null]],
      ['aucun parent', [randomUUID(), null, null, null, 'ACHAT', randomUUID(), 'CREATION', auteurId, 'TEST Auteur du journal 304', null, null, null]],
    ];
    for (const [nom, valeurs] of refusInsertion) await assert.rejects(annulee(db, insertion, valeurs), { code: '23514' }, `${nom} : insertion refusée par la contrainte`);
    const apres = await lignes(db);
    assert.equal(apres.length, 10);
    assert.deepEqual(apres.filter((l) => !nouvelles.includes(l.id)), avant, 'les écritures d’avant la migration restent identiques');
  });
});
