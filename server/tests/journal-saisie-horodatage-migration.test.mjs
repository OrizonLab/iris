// Lot #582 (cadrage v1 complété de la v2, qui fait foi ; issue `suivi-audit` #582, note N8 du contrôle de cohérence du
// cadrage de #304 ; messages de Nelson du 16-11-2026, « continu avec les issu. », et du 19-11-2026) : le journal des
// chantiers, des interventions et des contrats (« JournalSaisieChantier ») reçoit son horodatage de la base, comme les
// autres journaux d'audit (règle 2 de la méthode ; C-15 de PARAMETRAGE-CIBLE.md, « Journaux en ajout seul »). Critères
// du cadrage : déclencheur `BEFORE INSERT … FOR EACH ROW` qui impose `NEW."createdAt" := clock_timestamp() AT TIME ZONE
// 'UTC'` ; « aucune ligne existante n'est modifiée (règle 4) » ; déclencheur ordinaire, jamais `ENABLE ALWAYS` (N2) ;
// noms du déclencheur et de la fonction (N1).
//
// Migration 20261119140000_journal_saisie_horodate, exécutée sur une base jetable distincte, créée et supprimée par le
// test (TEST_DATABASE_URL ne sert que de connexion administrative), migrée par étapes :
//  - jusqu'à la migration du lot exclue (ajout seul de #304/#583 compris) : des écritures sur les trois parents
//    (chantier, intervention, contrat), dont deux du compte système, antidatées ou postdatées ; témoin : sans la
//    migration du lot, chacune garde la date choisie par l'appelant ;
//  - la migration du lot : l'empreinte de chaque table de la base est identique avant et après (to_jsonb de toutes
//    les lignes) et `_prisma_migrations` ne gagne que la ligne du lot. Lecture écartée : une migration qui reprendrait
//    les horodatages existants, ou toucherait une autre table (règle 4) ;
//  - puis, la session PostgreSQL au fuseau `Europe/Paris` (T1 de la v2 : la CI tourne en UTC, où une conversion
//    retirée ne se verrait pas) : une insertion SQL antidatée, postdatée ou sans date reçoit l'instant de son insertion,
//    encadré par deux instants relevés sur l'horloge de la base autour de l'insertion, avec 1 ms de marge en haut (C3 :
//    TIMESTAMP(3) arrondit à la milliseconde, la borne relevée est tronquée) ; `RETURNING` rend cette valeur (point 2 du
//    périmètre : Prisma lit la ligne écrite par la base) ;
//  - deux insertions d'une même transaction, espacées de 50 ms (T1 : sans cet écart, `CURRENT_TIMESTAMP`, l'instant
//    du début de la transaction, passerait pour l'instant de l'insertion), et deux lignes d'une même requête, produites
//    à 50 ms d'écart (`statement_timestamp()`, l'instant du début de la requête, leur donnerait le même) ;
//  - en mode réplica (remise en état des matrices), le déclencheur ordinaire ne joue pas (N2) ;
//  - les gardes d'ajout seul de #583 restent actives : UPDATE, DELETE et TRUNCATE refusés avec le message exact.
// Mutants que ce test tue (cadrage, « Mutants ») : déclencheur retiré ; `CURRENT_TIMESTAMP` au lieu de
// `clock_timestamp()` ; conversion de fuseau retirée ; déclencheur `AFTER` au lieu de `BEFORE` ; et, au-delà, `now()`,
// `statement_timestamp()`, déclencheur sur UPDATE au lieu d'INSERT, `ENABLE ALWAYS`, une migration qui réécrirait une
// ligne existante du journal ou toucherait une autre table.
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
const migration = '20261119140000_journal_saisie_horodate';
// Ajout seul du journal (#304, fusionné par #583) : ses gardes doivent rester actives après la migration du lot.
const ajoutSeul = '20261117140000_journal_saisie_ajout_seul';
const COMPTE_SYSTEME_ID = '00000000-0000-4000-8000-000000000001';

const REFUS_AJOUT_SEUL = 'Le journal des chantiers, interventions et contrats est en ajout seul : une écriture ne se modifie ni ne se supprime.';
const REFUS_VIDAGE = 'Vidage de « JournalSaisieChantier » interdit (TRUNCATE) : ses lignes ne se suppriment pas.';

// Dates choisies par l'appelant : l'une antidatée (une écriture qu'on ferait passer pour ancienne), l'autre postdatée.
const ANTIDATEE = '2020-01-01T00:00:00.000Z';
const POSTDATEE = '2099-12-31T23:59:59.999Z';
// Écart entre deux insertions d'une même transaction : sous `CURRENT_TIMESTAMP`, elles porteraient le même instant.
const ECART_MS = 50;
// C3 de la v2 : la colonne TIMESTAMP(3) arrondit l'instant à la milliseconde (jusqu'à 0,5 ms plus tard), quand la borne
// relevée après l'insertion est tronquée à la milliseconde.
const MARGE_MS = 1;

// Base jetable propre au test, au nom qui porte « test » comme mot (règle de client/scripts/base-jetable.mjs). `etape(jusqua)`
// applique toutes les migrations antérieures à `jusqua` qui ne le sont pas encore ; `appliquer()` ajoute celle du lot.
async function avecBase(corps) {
  const url = new URL(adminUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'seul PostgreSQL local est autorisé');
  const base = `iris_test_journal_horodatage_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  assert.notEqual(url.pathname.slice(1), base);
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  url.pathname = `/${base}`;
  const admin = new pg.Client({ connectionString: maintenance.toString() });
  const dir = mkdtempSync(join(tmpdir(), 'iris-journal-horodatage-'));
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
    assert.ok(toutes.includes(ajoutSeul), `${ajoutSeul} : migration absente`);
    assert.ok(ajoutSeul < migration, 'l’ajout seul de #583 précède la migration du lot');
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

const iso = (ms) => new Date(ms).toISOString();
// Instant de l'horloge de la base, en millisecondes depuis l'époque, tronqué (borne relevée autour d'une insertion).
const instantBase = async (db) => Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms')).rows[0].ms);
// Horodatage d'une écriture, lu comme un instant UTC (colonne sans fuseau), en millisecondes : indépendant du fuseau de
// la session comme de celui du processus Node.
const MS_CREATED_AT = `round(extract(epoch FROM ("createdAt" AT TIME ZONE 'UTC')) * 1000)::bigint`;
const horodatage = async (db, id) => {
  const ligne = (await db.query(`SELECT ${MS_CREATED_AT} AS ms FROM "JournalSaisieChantier" WHERE "id" = $1`, [id])).rows[0];
  return ligne ? Number(ligne.ms) : null;
};
function encadre(ms, debut, fin, contexte) {
  assert.ok(ms >= debut && ms <= fin + MARGE_MS, `${contexte} : horodatage ${iso(ms)} hors de [${iso(debut)} ; ${iso(fin)} + ${MARGE_MS} ms]`);
}

const lignes = async (db) => (await db.query('SELECT to_jsonb(j) AS ligne FROM "JournalSaisieChantier" j ORDER BY j."id"')).rows.map((r) => r.ligne);
// Empreinte de toute la base : pour chaque table du schéma public (hors `_prisma_migrations`, relue à part), le nombre de
// lignes et l'empreinte md5 de leurs to_jsonb triés.
async function empreinte(db) {
  const tables = (await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations' ORDER BY c.relname`)).rows.map((r) => r.relname);
  const resultat = {};
  for (const table of tables) {
    const { rows: [r] } = await db.query(`SELECT count(*)::int AS lignes, md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), '')) AS md5 FROM ${db.escapeIdentifier(table)} t`);
    resultat[table] = r;
  }
  return resultat;
}
const migrationsAppliquees = async (db) => (await db.query('SELECT to_jsonb(m) AS ligne FROM "_prisma_migrations" m ORDER BY m."migration_name"')).rows.map((r) => r.ligne);

// Insertion SQL ordinaire, date choisie par l'appelant (texte : la colonne est sans fuseau). `RETURNING` rend l'horodatage
// de la ligne écrite, comme Prisma le relit.
const colonnes = '"id", "chantierId", "interventionId", "contratMaintenanceId", "cible", "cibleId", "action", "auteurId", "auteurNom", "avant", "apres", "motif"';
const valeurs = '$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12';
async function inserer(db, ecriture, date) {
  const params = [ecriture.id, ecriture.chantierId ?? null, ecriture.interventionId ?? null, ecriture.contratMaintenanceId ?? null, ecriture.cible, ecriture.cibleId,
    ecriture.action, ecriture.auteurId, ecriture.auteurNom, ecriture.avant ? JSON.stringify(ecriture.avant) : null, ecriture.apres ? JSON.stringify(ecriture.apres) : null, ecriture.motif ?? null];
  const sql = date === undefined
    ? `INSERT INTO "JournalSaisieChantier" (${colonnes}) VALUES (${valeurs}) RETURNING ${MS_CREATED_AT} AS ms`
    : `INSERT INTO "JournalSaisieChantier" (${colonnes}, "createdAt") VALUES (${valeurs}, $13::timestamp(3)) RETURNING ${MS_CREATED_AT} AS ms`;
  const { rows: [r] } = await db.query(sql, date === undefined ? params : [...params, date.replace('T', ' ').replace('Z', '')]);
  return Number(r.ms);
}

test('migration du journal des chantiers, interventions et contrats horodaté par la base : aucune ligne de la base n’est modifiée ; ensuite une insertion antidatée, postdatée ou sans date, sur les trois parents et au nom du compte système, reçoit l’instant de son insertion en UTC quel que soit le fuseau de la session, chaque insertion d’une même transaction le sien ; déclencheur ordinaire, gardes d’ajout seul de #583 toujours actives', { skip: !adminUrl && 'TEST_DATABASE_URL requis' }, async () => {
  await avecBase(async ({ etape, appliquer, connecter }) => {
    const chantierId = randomUUID();
    const interventionId = randomUUID();
    const contratId = randomUUID();
    const auteurId = randomUUID();
    const auteurNom = 'TEST Auteur du journal 582';
    // Une écriture de chaque sorte que posent les routes : saisie Travaux et changement d'un chantier, intervention et
    // son coût, contrat, et les deux seules écritures admises du compte système (génération des visites).
    const sortes = {
      achat: (id) => ({ id, chantierId, cible: 'ACHAT', cibleId: randomUUID(), action: 'CREATION', auteurId, auteurNom, apres: { montantHT: '25.50', description: 'Câble « TEST » 2,5 mm²' } }),
      chantier: (id) => ({ id, chantierId, cible: 'CHANTIER', cibleId: chantierId, action: 'CHANGEMENT_CLIENT', auteurId, auteurNom, avant: { clientId: null }, apres: { clientId: randomUUID() } }),
      intervention: (id) => ({ id, interventionId, cible: 'INTERVENTION', cibleId: interventionId, action: 'CHANGEMENT_STATUT', auteurId, auteurNom, avant: { statut: 'A_PLANIFIER' }, apres: { statut: 'PLANIFIEE' } }),
      cout: (id) => ({ id, interventionId, cible: 'COUT_INTERVENTION_ACHAT', cibleId: randomUUID(), action: 'CREATION', auteurId, auteurNom, apres: { montantHT: '12.00' } }),
      contrat: (id) => ({ id, contratMaintenanceId: contratId, cible: 'CONTRAT', cibleId: contratId, action: 'SUSPENSION', auteurId, auteurNom, avant: { statut: 'ACTIF' }, apres: { statut: 'SUSPENDU' }, motif: 'Client en travaux' }),
      'visite du compte système': (id) => ({ id, interventionId: randomUUID(), cible: 'INTERVENTION', action: 'CREATION_CONTRAT', auteurId: COMPTE_SYSTEME_ID, auteurNom: 'Iris (automatique)', apres: { statut: 'A_PLANIFIER' }, motif: 'Génération automatique : échéance du 01-12-2026.' }),
      'échéance du compte système': (id) => ({ id, contratMaintenanceId: contratId, cible: 'CONTRAT', cibleId: contratId, action: 'AVANCEMENT_ECHEANCE', auteurId: COMPTE_SYSTEME_ID, auteurNom: 'Iris (automatique)', avant: { prochaineEcheance: '2026-11-01' }, apres: { prochaineEcheance: '2027-05-01' }, motif: 'Visite générée' }),
    };
    const ecriture = (sorte, id = randomUUID()) => {
      const e = sortes[sorte](id);
      return { ...e, cibleId: e.cibleId ?? e.interventionId };
    };

    // 1. Base migrée jusqu'à la migration du lot exclue, ajout seul compris ; session au fuseau de Paris pour tout le test.
    etape(migration);
    const db = await connecter();
    await db.query(`SET TIME ZONE 'Europe/Paris'`);
    assert.equal((await db.query('SHOW TimeZone')).rows[0].TimeZone, 'Europe/Paris');
    assert.notEqual(Number((await db.query('SELECT extract(timezone FROM clock_timestamp())::int AS decalage')).rows[0].decalage), 0, 'le fuseau de la session diffère d’UTC à cet instant');
    await db.query('INSERT INTO "User" ("id", "email", "name", "updatedAt") VALUES ($1, $2, $3, now())', [auteurId, `${auteurId}@iris.test`, auteurNom]);

    // 2. Témoin : sans la migration du lot, une écriture antidatée ou postdatée garde la date choisie par l'appelant.
    const anciennes = [];
    for (const sorte of Object.keys(sortes)) {
      for (const date of [ANTIDATEE, POSTDATEE]) {
        const e = ecriture(sorte);
        const ms = await inserer(db, e, date);
        assert.equal(iso(ms), date, `témoin, ${sorte} : sans la migration du lot, la date choisie est gardée`);
        assert.equal(iso(await horodatage(db, e.id)), date, `témoin, ${sorte} : relue en base`);
        anciennes.push(e.id);
      }
    }
    const avant = await lignes(db);
    assert.equal(avant.length, anciennes.length);
    const empreinteAvant = await empreinte(db);
    assert.ok(Object.keys(empreinteAvant).length > 20 && empreinteAvant.JournalSaisieChantier && empreinteAvant.User, 'l’empreinte couvre toutes les tables');
    assert.equal(empreinteAvant.JournalSaisieChantier.lignes, anciennes.length);
    const migrationsAvant = await migrationsAppliquees(db);
    assert.ok(!migrationsAvant.some((m) => m.migration_name === migration), 'migration du lot pas encore appliquée');

    // 3. La migration du lot : aucune ligne n'est modifiée, dans aucune table (règle 4).
    appliquer();
    assert.deepEqual(await empreinte(db), empreinteAvant, 'empreinte de toute la base identique après la migration');
    assert.deepEqual(await lignes(db), avant, 'chaque écriture du journal est identique (toutes colonnes, horodatage compris)');
    for (const id of anciennes) assert.ok([ANTIDATEE, POSTDATEE].includes(iso(await horodatage(db, id))), 'les dates d’avant la migration restent celles qui avaient été écrites');
    const migrationsApres = await migrationsAppliquees(db);
    assert.deepEqual(migrationsApres.filter((m) => m.migration_name !== migration), migrationsAvant, '_prisma_migrations : les lignes précédentes sont intactes');
    const ligneDuLot = migrationsApres.find((m) => m.migration_name === migration);
    assert.ok(ligneDuLot?.finished_at && !ligneDuLot.rolled_back_at, '_prisma_migrations : la migration du lot est appliquée');

    // 4. Déclencheur et fonction nommés (N1), ligne par ligne avant l'insertion seule (tgtype : ROW 1 + BEFORE 2 +
    //    INSERT 4), ordinaire (N2 : tgenabled « O », jamais « A » pour ENABLE ALWAYS) ; gardes de #583 actives.
    const declencheurs = (await db.query(`SELECT t.tgname, t.tgtype, t.tgenabled, p.proname FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = '"JournalSaisieChantier"'::regclass AND NOT t.tgisinternal ORDER BY t.tgname`)).rows;
    assert.deepEqual(declencheurs.find((t) => t.tgname === 'journal_saisie_chantier_horodatage'),
      { tgname: 'journal_saisie_chantier_horodatage', tgtype: 7, tgenabled: 'O', proname: 'horodater_journal_saisie_chantier' });
    assert.deepEqual(declencheurs.filter((t) => t.tgname !== 'journal_saisie_chantier_horodatage').map((t) => [t.tgname, t.tgenabled]),
      [['journal_saisie_chantier_ajout_seul', 'O'], ['journal_saisie_chantier_sans_vidage', 'O']], 'les gardes d’ajout seul de #583 restent en place');

    // 5. Insertions SQL ordinaires, session au fuseau de Paris : la date antidatée, postdatée ou absente est remplacée par
    //    l'instant de l'insertion, en UTC. Lectures écartées : déclencheur absent ou AFTER (la date choisie resterait) ;
    //    conversion retirée (l'heure de Paris, une ou deux heures d'avance, sortirait de l'encadrement) ; défaut de la
    //    colonne (CURRENT_TIMESTAMP converti au fuseau de la session, lui aussi l'heure de Paris).
    const nouvelles = [];
    const parSorte = {};
    for (const sorte of Object.keys(sortes)) {
      for (const [nom, date] of [['antidatée', ANTIDATEE], ['postdatée', POSTDATEE], ['sans date', undefined]]) {
        const e = ecriture(sorte);
        const debut = await instantBase(db);
        const rendu = await inserer(db, e, date);
        const fin = await instantBase(db);
        encadre(rendu, debut, fin, `${sorte}, ${nom} (RETURNING)`);
        assert.equal(await horodatage(db, e.id), rendu, `${sorte}, ${nom} : RETURNING rend l’horodatage écrit en base`);
        nouvelles.push(e.id);
        parSorte[sorte] = e.id;
      }
    }

    // 6. Deux insertions d'une même transaction, espacées : chacune reçoit son propre instant. Lecture écartée :
    //    CURRENT_TIMESTAMP (ou now()), l'instant du début de la transaction, identique pour les deux et antérieur à la
    //    borne basse de la seconde.
    const premiere = ecriture('achat');
    const seconde = ecriture('contrat');
    await db.query('BEGIN');
    let bornes;
    try {
      const debut1 = await instantBase(db);
      await inserer(db, premiere, ANTIDATEE);
      const fin1 = await instantBase(db);
      await db.query('SELECT pg_sleep($1)', [ECART_MS / 1000]);
      const debut2 = await instantBase(db);
      await inserer(db, seconde, POSTDATEE);
      const fin2 = await instantBase(db);
      await db.query('COMMIT');
      bornes = { debut1, fin1, debut2, fin2 };
    } catch (erreur) {
      await db.query('ROLLBACK');
      throw erreur;
    }
    const [h1, h2] = [await horodatage(db, premiere.id), await horodatage(db, seconde.id)];
    encadre(h1, bornes.debut1, bornes.fin1, 'même transaction, première insertion');
    encadre(h2, bornes.debut2, bornes.fin2, 'même transaction, seconde insertion, 50 ms plus tard');
    assert.ok(h2 - h1 >= ECART_MS - MARGE_MS, `même transaction : ${h2 - h1} ms entre les deux insertions, au moins ${ECART_MS - MARGE_MS} attendues`);
    nouvelles.push(premiere.id, seconde.id);

    // 6 bis. Une seule requête qui insère deux lignes, produites à 50 ms d'écart (attente corrélée à chaque ligne, donc
    //    rejouée pour chacune) : chaque ligne reçoit l'instant de sa propre insertion. Lecture écartée :
    //    statement_timestamp(), l'instant du début de la requête, identique pour les deux lignes.
    const enUneRequete = (await db.query(`INSERT INTO "JournalSaisieChantier" (${colonnes}, "createdAt")
      SELECT gen_random_uuid()::text, $1, NULL, NULL, 'ACHAT', 'TEST-une-requete-' || g, 'CREATION', $2, $3, NULL, NULL, NULL, $4::timestamp(3)
      FROM generate_series(1, 2) AS g, LATERAL (SELECT pg_sleep($5::float8 * sign(g))) AS attente
      RETURNING "id", ${MS_CREATED_AT} AS ms, "cibleId"`, [chantierId, auteurId, auteurNom, ANTIDATEE.replace('T', ' ').replace('Z', ''), ECART_MS / 1000])).rows
      .sort((a, b) => a.cibleId.localeCompare(b.cibleId));
    assert.equal(enUneRequete.length, 2);
    const ecartRequete = Number(enUneRequete[1].ms) - Number(enUneRequete[0].ms);
    assert.ok(ecartRequete >= ECART_MS - MARGE_MS, `une requête, deux lignes : ${ecartRequete} ms entre elles, au moins ${ECART_MS - MARGE_MS} attendues`);
    nouvelles.push(...enUneRequete.map((r) => r.id));

    // 7. Mode réplica (remise en état des matrices) : le déclencheur ordinaire ne joue pas, la ligne recopiée garde sa
    //    date (N2). Transaction annulée. Lecture écartée : ENABLE ALWAYS.
    const recopiee = ecriture('chantier');
    await db.query('BEGIN');
    try {
      await db.query('SET LOCAL session_replication_role = replica');
      assert.equal(iso(await inserer(db, recopiee, ANTIDATEE)), ANTIDATEE, 'mode réplica : la date recopiée est gardée');
    } finally {
      await db.query('ROLLBACK');
    }
    assert.equal(await horodatage(db, recopiee.id), null, 'mode réplica : insertion annulée');

    // 8. Les gardes d'ajout seul de #583 restent actives, sur une écriture d'avant la migration comme d'après : ni
    //    l'horodatage ni une autre colonne ne se modifient, aucune écriture ne se supprime, la table ne se vide pas.
    const apresInsertions = await lignes(db);
    const refusAjoutSeul = { code: 'P0001', message: REFUS_AJOUT_SEUL };
    for (const [nom, id] of [['écriture d’avant la migration', anciennes[0]], ['écriture horodatée par la base', nouvelles[0]], ['écriture du compte système', parSorte['échéance du compte système']]]) {
      await assert.rejects(annulee(db, 'UPDATE "JournalSaisieChantier" SET "createdAt" = $2::timestamp(3) WHERE "id" = $1', [id, '2020-06-01 00:00:00.000']), refusAjoutSeul, `${nom} : horodatage non modifiable`);
      await assert.rejects(annulee(db, 'UPDATE "JournalSaisieChantier" SET "motif" = $2 WHERE "id" = $1', [id, 'TEST motif réécrit']), refusAjoutSeul, `${nom} : motif non modifiable`);
      await assert.rejects(annulee(db, 'DELETE FROM "JournalSaisieChantier" WHERE "id" = $1', [id]), refusAjoutSeul, `${nom} : suppression refusée`);
    }
    await assert.rejects(annulee(db, 'TRUNCATE "JournalSaisieChantier"'), { code: 'P0001', message: REFUS_VIDAGE }, 'vidage refusé');
    assert.deepEqual(await lignes(db), apresInsertions, 'refus : aucune écriture n’a changé ni ne manque');
    assert.equal(apresInsertions.length, anciennes.length + nouvelles.length);
    assert.deepEqual(apresInsertions.filter((l) => anciennes.includes(l.id)), avant, 'les écritures d’avant la migration restent identiques');
  });
});
