// Lot #615 (cadrage v1 complété de la v2, qui fait foi ; issue `suivi-audit` #615, note C2 du contrôle de cohérence du
// cadrage de #582 ; messages de Nelson du 16-11-2026, « continu avec les issu. », et du 19-11-2026) : les journaux
// comptables (« JournalCompteComptable », activations et modifications des comptes ; « JournalRegleComptable »,
// créations, remappages et retraits des règles et des taux de TVA) reçoivent leur horodatage de la base, comme les
// autres journaux d'audit (règle 2 de la méthode ; C-15 de PARAMETRAGE-CIBLE.md, « Journaux en ajout seul »). Critères
// du cadrage : un déclencheur `BEFORE INSERT … FOR EACH ROW` par table, qui impose `NEW."createdAt" :=
// clock_timestamp() AT TIME ZONE 'UTC'` (C1 de la v2 : colonnes TIMESTAMP(3) sans fuseau) ; noms des déclencheurs et des
// fonctions (point 1 du périmètre) ; déclencheurs ordinaires, jamais `ENABLE ALWAYS` ; « aucune ligne existante
// modifiée (règle 4) ».
//
// Migration 20261119220000_journaux_comptables_horodates, exécutée sur une base jetable distincte, créée et supprimée
// par le test (TEST_DATABASE_URL ne sert que de connexion administrative), migrée par étapes :
//  - jusqu'à la migration du lot exclue (gardes d'ajout seul, de vidage et preuve des règles compris) : des écritures
//    antidatées et postdatées, pour chaque action de chaque journal (T1 de la v2 : comptes, DESACTIVATION, REACTIVATION
//    et MODIFICATION ; règles, REGLE et TVA, chacune en CREATION, REMAPPAGE et RETRAIT, et, au-delà du cadrage, la
//    règle JOURNAL_VENTES, que `figer_comptes` traite à part) ; témoin : sans la migration du lot, chacune garde la date
//    choisie par l'appelant. N1 de la v2 : la preuve différée `journal_regle_preuve` exige que chaque écriture du journal
//    des règles soit insérée avec la mutation de sa règle, dans la même transaction ; `avant` et `apres` désignent des
//    comptes existants, sauf pour JOURNAL_VENTES (codes de journal) ;
//  - la migration du lot : l'empreinte de chaque table de la base est identique avant et après (to_jsonb de toutes les
//    lignes) et `_prisma_migrations` ne gagne que la ligne du lot. Lecture écartée : une migration qui reprendrait les
//    horodatages existants (règle 4) ;
//  - puis, la session PostgreSQL au fuseau `Europe/Paris` (la CI tourne en UTC, où une conversion retirée ne se verrait
//    pas) : une insertion SQL antidatée, postdatée ou sans date, pour chaque action de chaque journal (mutant `WHEN`
//    restreint à certaines actions), reçoit l'instant de son insertion, encadré par deux instants relevés sur l'horloge
//    de la base autour de l'insertion, avec 1 ms de marge en haut (TIMESTAMP(3) arrondit à la milliseconde, la borne
//    relevée est tronquée) ; `RETURNING` rend cette valeur, relue en base après la validation (point 4 du périmètre :
//    Prisma relit la ligne écrite par la base) ; les écritures des règles sont validées avec leur mutation (N1) ;
//  - deux insertions d'une même transaction, espacées de 50 ms (sans cet écart, `CURRENT_TIMESTAMP` ou `now()`,
//    l'instant du début de la transaction, passeraient pour l'instant de l'insertion), et deux lignes d'une même
//    requête, produites à 50 ms d'écart (`statement_timestamp()`, l'instant du début de la requête, leur donnerait le
//    même), dans chaque journal ;
//  - en mode réplica (remise en état des matrices), les déclencheurs ordinaires ne jouent pas (lecture écartée :
//    `ENABLE ALWAYS`) ;
//  - catalogue des déclencheurs de chaque table, par nom (T1 : `journal_regle_figer_comptes` est lui aussi `BEFORE
//    INSERT ROW`) : type (`tgtype` 7, ligne par ligne avant l'insertion seule), état ordinaire (`O`), fonction et
//    définition exacte (`pg_get_triggerdef`) ; gardes existantes intactes, déclencheur et fonction
//    (`journal_compte_append_only`, `journal_compte_sans_vidage`, `journal_regle_append_only`,
//    `journal_regle_figer_comptes`, `journal_regle_preuve`, `journal_regle_sans_vidage`) ;
//  - l'ajout seul reste actif : UPDATE, DELETE et TRUNCATE refusés avec le message exact, sur une écriture d'avant la
//    migration comme d'après.
// N2 de la v2 : l'identifiant d'une écriture est un uuid v4 ; ce test ne promet aucun ordre entre deux écritures du même
// instant.
// Mutants que ce test tue (cadrage, « Mutants ») : déclencheur retiré, sur chaque table ou les deux ; `CURRENT_TIMESTAMP`,
// `now()`, `statement_timestamp()` au lieu de `clock_timestamp()` ; conversion de fuseau retirée ; `AFTER` au lieu de
// `BEFORE` ; `BEFORE INSERT OR UPDATE` ; `ENABLE ALWAYS` ; reprise des lignes existantes ; déclencheur posé sur une
// seule des deux tables ; `WHEN` restreint à certaines actions ou à un type de règle ; un déclencheur qui appelle une
// copie `SECURITY DEFINER` dans un autre schéma (dès le lot : assertion « déclencheur du lot », la définition du
// déclencheur nommant alors la copie qualifiée de son schéma) ; depuis #629, sur chacune des deux fonctions,
// `SECURITY DEFINER`, `SET search_path` sans `SECURITY DEFINER` et SQL dynamique (`EXECUTE`) au lieu de l'affectation.
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
const migration = '20261119220000_journaux_comptables_horodates';
// Gardes des deux journaux, qui doivent précéder la migration du lot et rester intactes après elle : ajout seul du
// journal des comptes, son extension aux modifications, journal des règles (ajout seul, comptes figés, preuve différée),
// gardes contre le vidage (#222).
const GARDES = ['20260925120000_journal_activation_comptes', '20261009100000_modification_compte_comptable', '20261009120000_journal_regles_comptables', '20261019120000_cycle_statuts_factures'];

const REFUS_COMPTE = 'Journal comptable immuable : modification ou suppression interdite';
const REFUS_REGLE = 'Journal des règles immuable';
const vidage = (table) => `Vidage de « ${table} » interdit (TRUNCATE) : ses lignes ne se suppriment pas.`;

// Dates choisies par l'appelant : l'une antidatée (une écriture qu'on ferait passer pour ancienne), l'autre postdatée.
const ANTIDATEE = '2020-01-01T00:00:00.000Z';
const POSTDATEE = '2099-12-31T23:59:59.999Z';
// Écart entre deux insertions d'une même transaction, ou deux lignes d'une même requête.
const ECART_MS = 50;
// La colonne TIMESTAMP(3) arrondit l'instant à la milliseconde (jusqu'à 0,5 ms plus tard), quand la borne relevée après
// l'insertion est tronquée à la milliseconde.
const MARGE_MS = 1;

// Catalogue attendu, déclencheur par déclencheur (hors déclencheurs internes des clés étrangères). tgtype : ROW 1,
// BEFORE 2, INSERT 4, DELETE 8, UPDATE 16, TRUNCATE 32 ; une contrainte différée AFTER INSERT ROW vaut 5. État « O » :
// déclencheur ordinaire, inactif en mode réplica (« A » serait ENABLE ALWAYS).
const declencheur = (nom, tgtype, fonction, definition) => ({ nom, tgtype, etat: 'O', fonction, definition });
const GARDES_CATALOGUE = {
  JournalCompteComptable: [
    declencheur('journal_compte_append_only', 27, 'refuser_mutation_journal_compte', 'CREATE TRIGGER journal_compte_append_only BEFORE DELETE OR UPDATE ON public."JournalCompteComptable" FOR EACH ROW EXECUTE FUNCTION refuser_mutation_journal_compte()'),
    declencheur('journal_compte_sans_vidage', 34, 'refuser_vidage_sans_suppression', 'CREATE TRIGGER journal_compte_sans_vidage BEFORE TRUNCATE ON public."JournalCompteComptable" FOR EACH STATEMENT EXECUTE FUNCTION refuser_vidage_sans_suppression()'),
  ],
  JournalRegleComptable: [
    declencheur('journal_regle_append_only', 27, 'interdire_changement_journal_regle', 'CREATE TRIGGER journal_regle_append_only BEFORE DELETE OR UPDATE ON public."JournalRegleComptable" FOR EACH ROW EXECUTE FUNCTION interdire_changement_journal_regle()'),
    declencheur('journal_regle_figer_comptes', 7, 'figer_comptes_journal_regle', 'CREATE TRIGGER journal_regle_figer_comptes BEFORE INSERT ON public."JournalRegleComptable" FOR EACH ROW EXECUTE FUNCTION figer_comptes_journal_regle()'),
    declencheur('journal_regle_preuve', 5, 'verifier_journal_regle', 'CREATE CONSTRAINT TRIGGER journal_regle_preuve AFTER INSERT ON public."JournalRegleComptable" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verifier_journal_regle()'),
    declencheur('journal_regle_sans_vidage', 34, 'refuser_vidage_sans_suppression', 'CREATE TRIGGER journal_regle_sans_vidage BEFORE TRUNCATE ON public."JournalRegleComptable" FOR EACH STATEMENT EXECUTE FUNCTION refuser_vidage_sans_suppression()'),
  ],
};
const DECLENCHEURS_DU_LOT = {
  JournalCompteComptable: declencheur('journal_compte_comptable_horodatage', 7, 'horodater_journal_compte_comptable', 'CREATE TRIGGER journal_compte_comptable_horodatage BEFORE INSERT ON public."JournalCompteComptable" FOR EACH ROW EXECUTE FUNCTION horodater_journal_compte_comptable()'),
  JournalRegleComptable: declencheur('journal_regle_comptable_horodatage', 7, 'horodater_journal_regle_comptable', 'CREATE TRIGGER journal_regle_comptable_horodatage BEFORE INSERT ON public."JournalRegleComptable" FOR EACH ROW EXECUTE FUNCTION horodater_journal_regle_comptable()'),
};
const TABLES = Object.keys(GARDES_CATALOGUE);

// Base jetable propre au test, au nom qui porte « test » comme mot (règle de client/scripts/base-jetable.mjs). `etape(jusqua)`
// applique toutes les migrations antérieures à `jusqua` qui ne le sont pas encore ; `appliquer()` ajoute celle du lot.
async function avecBase(corps) {
  const url = new URL(adminUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'seul PostgreSQL local est autorisé');
  const base = `iris_test_journaux_comptables_horodatage_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  assert.notEqual(url.pathname.slice(1), base);
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  url.pathname = `/${base}`;
  const admin = new pg.Client({ connectionString: maintenance.toString() });
  const dir = mkdtempSync(join(tmpdir(), 'iris-journaux-comptables-horodatage-'));
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
    for (const garde of GARDES) {
      assert.ok(toutes.includes(garde), `${garde} : migration absente`);
      assert.ok(garde < migration, `${garde} précède la migration du lot`);
    }
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

// Transaction validée ; annulée si une requête, ou la validation elle-même (preuve différée des règles), échoue.
async function enTransaction(db, corps) {
  await db.query('BEGIN');
  try {
    const resultat = await corps();
    await db.query('COMMIT');
    return resultat;
  } catch (erreur) {
    await db.query('ROLLBACK').catch(() => {});
    throw erreur;
  }
}

const iso = (ms) => new Date(ms).toISOString();
// Date choisie, au format d'une colonne sans fuseau.
const sansFuseau = (date) => date.replace('T', ' ').replace('Z', '');
// Instant de l'horloge de la base, en millisecondes depuis l'époque, tronqué (borne relevée autour d'une insertion).
const instantBase = async (db) => Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms')).rows[0].ms);
// Horodatage d'une écriture, lu comme un instant UTC (colonne sans fuseau), en millisecondes : indépendant du fuseau de
// la session comme de celui du processus Node.
const MS_CREATED_AT = `round(extract(epoch FROM ("createdAt" AT TIME ZONE 'UTC')) * 1000)::bigint`;
const horodatage = async (db, table, id) => {
  const ligne = (await db.query(`SELECT ${MS_CREATED_AT} AS ms FROM "${table}" WHERE "id" = $1`, [id])).rows[0];
  return ligne ? Number(ligne.ms) : null;
};
function encadre(ms, debut, fin, contexte) {
  assert.ok(ms >= debut && ms <= fin + MARGE_MS, `${contexte} : horodatage ${iso(ms)} hors de [${iso(debut)} ; ${iso(fin)} + ${MARGE_MS} ms]`);
}

const lignes = async (db, table) => (await db.query(`SELECT to_jsonb(j) AS ligne FROM "${table}" j ORDER BY j."id"`)).rows.map((r) => r.ligne);
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

// Déclencheurs non internes d'une table, par nom, et définition de leurs fonctions.
async function catalogue(db, table) {
  return (await db.query(`SELECT t.tgname AS nom, t.tgtype::int AS tgtype, t.tgenabled AS etat, p.proname AS fonction, pg_get_triggerdef(t.oid) AS definition,
      pg_get_functiondef(p.oid) AS "definitionFonction"
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = $1::regclass AND NOT t.tgisinternal ORDER BY t.tgname`, [`"${table}"`])).rows;
}
const sansFonction = (entrees) => entrees.map(({ definitionFonction, ...reste }) => reste);

test('migration des journaux comptables horodatés par la base : aucune ligne de la base n’est modifiée ; ensuite une insertion antidatée, postdatée ou sans date, pour chaque action du journal des comptes et du journal des règles, reçoit l’instant de son insertion en UTC quel que soit le fuseau de la session, chaque insertion d’une même transaction et chaque ligne d’une même requête le sien ; déclencheurs ordinaires nommés, gardes d’ajout seul, de vidage et de preuve intactes et toujours actives', { skip: !adminUrl && 'TEST_DATABASE_URL requis' }, async () => {
  await avecBase(async ({ etape, appliquer, connecter }) => {
    const auteurId = randomUUID();
    const auteurNom = 'TEST Auteur des journaux comptables 615';
    const compte = (code, libelle, nature) => ({ id: randomUUID(), code, libelle, nature });
    const comptes = {
      journalise: compte('606100', 'TEST Fournitures 615', 'CHARGE'),
      clientA: compte('411100', 'TEST Clients A 615', 'ACTIF'),
      clientB: compte('411200', 'TEST Clients B 615', 'ACTIF'),
      produitA: compte('706100', 'TEST Prestations A 615', 'PRODUIT'),
      produitB: compte('706200', 'TEST Prestations B 615', 'PRODUIT'),
      tvaA: compte('445710', 'TEST TVA collectée A 615', 'TVA'),
      tvaB: compte('445720', 'TEST TVA collectée B 615', 'TVA'),
    };

    // Journal des comptes : une écriture de chaque action, aux colonnes que la contrainte de transition exige.
    const ACTIONS_COMPTE = {
      DESACTIVATION: { avant: true, apres: false },
      REACTIVATION: { avant: false, apres: true },
      MODIFICATION: { avantLibelle: 'TEST Fournitures 615', apresLibelle: 'TEST Fournitures et petit matériel 615', avantNature: 'CHARGE', apresNature: 'CHARGE' },
    };
    const COLONNES_COMPTE = '"id", "compteId", "auteurId", "auteurNom", "action", "avant", "apres", "avantLibelle", "apresLibelle", "avantNature", "apresNature", "motif"';
    // Insertion SQL ordinaire, date choisie par l'appelant (texte : la colonne est sans fuseau), ou sans date.
    // `RETURNING` rend l'horodatage de la ligne écrite, comme Prisma le relit.
    const insererCompte = async (db, action, date) => {
      const id = randomUUID();
      const e = ACTIONS_COMPTE[action];
      const params = [id, comptes.journalise.id, auteurId, auteurNom, action, e.avant ?? null, e.apres ?? null, e.avantLibelle ?? null, e.apresLibelle ?? null, e.avantNature ?? null, e.apresNature ?? null, `TEST ${action} du compte 615`];
      const sql = date === undefined
        ? `INSERT INTO "JournalCompteComptable" (${COLONNES_COMPTE}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${MS_CREATED_AT} AS ms`
        : `INSERT INTO "JournalCompteComptable" (${COLONNES_COMPTE}, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamp(3)) RETURNING ${MS_CREATED_AT} AS ms`;
      const { rows: [r] } = await db.query(sql, date === undefined ? params : [...params, sansFuseau(date)]);
      return { id, ms: Number(r.ms) };
    };

    // Journal des règles : chaque écriture est insérée avec la mutation de sa règle, dans la même transaction (N1 de la
    // v2 : preuve différée `journal_regle_preuve`). Chaque sorte parcourt CREATION (rien → x), REMAPPAGE (x → y), RETRAIT
    // (y → rien) ; `avant` et `apres` désignent des comptes existants, sauf pour JOURNAL_VENTES (codes de journal).
    const SORTES_REGLE = {
      'règle CLIENT': { type: 'REGLE', cible: 'CLIENT', valeurs: [comptes.clientA.id, comptes.clientB.id] },
      'règle JOURNAL_VENTES': { type: 'REGLE', cible: 'JOURNAL_VENTES', valeurs: ['VTE', 'VTE2'] },
      'taux de TVA à 20 %': { type: 'TVA', cible: '20', taux: '20', valeurs: [comptes.tvaA.id, comptes.tvaB.id] },
    };
    const ACTIONS_REGLE = ['CREATION', 'REMAPPAGE', 'RETRAIT'];
    const transition = (sorte, action) => {
      const [x, y] = sorte.valeurs;
      return { avant: { CREATION: null, REMAPPAGE: x, RETRAIT: y }[action], apres: { CREATION: x, REMAPPAGE: y, RETRAIT: null }[action] };
    };
    const muterRegle = async (db, sorte, action, apres) => {
      if (sorte.type === 'TVA') {
        if (action === 'CREATION') await db.query('INSERT INTO "RegleTvaComptable" ("id", "taux", "compteId", "updatedAt") VALUES ($1, $2::numeric, $3, now())', [randomUUID(), sorte.taux, apres]);
        if (action === 'REMAPPAGE') await db.query('UPDATE "RegleTvaComptable" SET "compteId" = $2, "updatedAt" = now() WHERE "taux" = $1::numeric', [sorte.taux, apres]);
        if (action === 'RETRAIT') await db.query('DELETE FROM "RegleTvaComptable" WHERE "taux" = $1::numeric', [sorte.taux]);
        return;
      }
      const [compteId, journal] = sorte.cible === 'JOURNAL_VENTES' ? [null, apres] : [apres, null];
      if (action === 'CREATION') await db.query('INSERT INTO "RegleComptable" ("id", "cle", "compteId", "journal", "updatedAt") VALUES ($1, $2, $3, $4, now())', [randomUUID(), sorte.cible, compteId, journal]);
      if (action === 'REMAPPAGE') await db.query('UPDATE "RegleComptable" SET "compteId" = $2, "journal" = $3, "updatedAt" = now() WHERE "cle" = $1', [sorte.cible, compteId, journal]);
      if (action === 'RETRAIT') await db.query('DELETE FROM "RegleComptable" WHERE "cle" = $1', [sorte.cible]);
    };
    const COLONNES_REGLE = '"id", "type", "cible", "action", "avant", "apres", "motif", "auteurId", "auteurNom"';
    const insererJournalRegle = async (db, ecriture, date) => {
      const params = [ecriture.id, ecriture.type, ecriture.cible, ecriture.action, ecriture.avant, ecriture.apres, `TEST ${ecriture.action} ${ecriture.type} ${ecriture.cible} 615`, auteurId, auteurNom];
      const sql = date === undefined
        ? `INSERT INTO "JournalRegleComptable" (${COLONNES_REGLE}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${MS_CREATED_AT} AS ms`
        : `INSERT INTO "JournalRegleComptable" (${COLONNES_REGLE}, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamp(3)) RETURNING ${MS_CREATED_AT} AS ms`;
      const { rows: [r] } = await db.query(sql, date === undefined ? params : [...params, sansFuseau(date)]);
      return Number(r.ms);
    };
    // Mutation et écriture dans la transaction courante ; bornes relevées autour de la seule insertion au journal.
    const regleEtJournal = async (db, nomSorte, action, date) => {
      const sorte = SORTES_REGLE[nomSorte] ?? nomSorte;
      const { avant, apres } = transition(sorte, action);
      await muterRegle(db, sorte, action, apres);
      const id = randomUUID();
      const debut = await instantBase(db);
      const ms = await insererJournalRegle(db, { id, type: sorte.type, cible: sorte.cible, action, avant, apres }, date);
      const fin = await instantBase(db);
      return { id, ms, debut, fin };
    };

    // 1. Base migrée jusqu'à la migration du lot exclue ; session au fuseau de Paris pour tout le test.
    etape(migration);
    const db = await connecter();
    await db.query(`SET TIME ZONE 'Europe/Paris'`);
    assert.equal((await db.query('SHOW TimeZone')).rows[0].TimeZone, 'Europe/Paris');
    assert.notEqual(Number((await db.query('SELECT extract(timezone FROM clock_timestamp())::int AS decalage')).rows[0].decalage), 0, 'le fuseau de la session diffère d’UTC à cet instant');
    await db.query('INSERT INTO "User" ("id", "email", "name", "updatedAt") VALUES ($1, $2, $3, now())', [auteurId, `${auteurId}@iris.test`, auteurNom]);
    for (const c of Object.values(comptes)) {
      await db.query('INSERT INTO "CompteComptable" ("id", "code", "libelle", "nature", "updatedAt") VALUES ($1, $2, $3, $4, now())', [c.id, c.code, c.libelle, c.nature]);
    }
    const catalogueAvant = Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await catalogue(db, table)])));
    for (const table of TABLES) {
      assert.deepEqual(sansFonction(catalogueAvant[table]), GARDES_CATALOGUE[table], `${table} : avant la migration du lot, les seules gardes existantes`);
    }

    // 2. Témoin : sans la migration du lot, une écriture antidatée ou postdatée garde la date choisie par l'appelant,
    //    pour chaque action de chaque journal.
    const anciennes = { JournalCompteComptable: [], JournalRegleComptable: [] };
    for (const date of [ANTIDATEE, POSTDATEE]) {
      for (const action of Object.keys(ACTIONS_COMPTE)) {
        const { id, ms } = await insererCompte(db, action, date);
        assert.equal(iso(ms), date, `témoin, compte, ${action} : sans la migration du lot, la date choisie est gardée`);
        assert.equal(iso(await horodatage(db, 'JournalCompteComptable', id)), date, `témoin, compte, ${action} : relue en base`);
        anciennes.JournalCompteComptable.push(id);
      }
      for (const nomSorte of Object.keys(SORTES_REGLE)) {
        for (const action of ACTIONS_REGLE) {
          const { id, ms } = await enTransaction(db, () => regleEtJournal(db, nomSorte, action, date));
          assert.equal(iso(ms), date, `témoin, ${nomSorte}, ${action} : sans la migration du lot, la date choisie est gardée`);
          assert.equal(iso(await horodatage(db, 'JournalRegleComptable', id)), date, `témoin, ${nomSorte}, ${action} : relue en base après la validation`);
          anciennes.JournalRegleComptable.push(id);
        }
      }
    }
    const avant = Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await lignes(db, table)])));
    assert.equal(avant.JournalCompteComptable.length, 6);
    assert.equal(avant.JournalRegleComptable.length, 18);
    const empreinteAvant = await empreinte(db);
    assert.ok(Object.keys(empreinteAvant).length > 20 && empreinteAvant.User && empreinteAvant.TransitionRegleComptable?.lignes === 18, 'l’empreinte couvre toutes les tables, preuves des transitions comprises');
    const migrationsAvant = await migrationsAppliquees(db);
    assert.ok(!migrationsAvant.some((m) => m.migration_name === migration), 'migration du lot pas encore appliquée');

    // 3. La migration du lot : aucune ligne n'est modifiée, dans aucune table (règle 4).
    appliquer();
    assert.deepEqual(await empreinte(db), empreinteAvant, 'empreinte de toute la base identique après la migration');
    for (const table of TABLES) {
      assert.deepEqual(await lignes(db, table), avant[table], `${table} : chaque écriture est identique (toutes colonnes, horodatage compris)`);
      for (const id of anciennes[table]) assert.ok([ANTIDATEE, POSTDATEE].includes(iso(await horodatage(db, table, id))), `${table} : les dates d’avant la migration restent celles qui avaient été écrites`);
    }
    const migrationsApres = await migrationsAppliquees(db);
    assert.deepEqual(migrationsApres.filter((m) => m.migration_name !== migration), migrationsAvant, '_prisma_migrations : les lignes précédentes sont intactes');
    const ligneDuLot = migrationsApres.find((m) => m.migration_name === migration);
    assert.ok(ligneDuLot?.finished_at && !ligneDuLot.rolled_back_at, '_prisma_migrations : la migration du lot est appliquée');

    // 4. Insertions SQL ordinaires, session au fuseau de Paris, pour chaque action de chaque journal (mutant `WHEN`
    //    restreint) : la date antidatée, postdatée ou absente est remplacée par l'instant de l'insertion, en UTC, que
    //    `RETURNING` rend et que la base garde après la validation. Lectures écartées : déclencheur absent, posé sur une
    //    seule table ou AFTER (la date choisie resterait) ; conversion retirée (l'heure de Paris, une ou deux heures
    //    d'avance, sortirait de l'encadrement) ; défaut de la colonne (CURRENT_TIMESTAMP converti au fuseau de la session,
    //    lui aussi l'heure de Paris).
    const nouvelles = { JournalCompteComptable: [], JournalRegleComptable: [] };
    for (const [nomDate, date] of [['antidatée', ANTIDATEE], ['postdatée', POSTDATEE], ['sans date', undefined]]) {
      for (const action of Object.keys(ACTIONS_COMPTE)) {
        const debut = await instantBase(db);
        const { id, ms } = await insererCompte(db, action, date);
        const fin = await instantBase(db);
        encadre(ms, debut, fin, `compte, ${action}, ${nomDate} (RETURNING)`);
        assert.equal(await horodatage(db, 'JournalCompteComptable', id), ms, `compte, ${action}, ${nomDate} : RETURNING rend l’horodatage écrit en base`);
        nouvelles.JournalCompteComptable.push(id);
      }
      for (const nomSorte of Object.keys(SORTES_REGLE)) {
        for (const action of ACTIONS_REGLE) {
          const { id, ms, debut, fin } = await enTransaction(db, () => regleEtJournal(db, nomSorte, action, date));
          encadre(ms, debut, fin, `${nomSorte}, ${action}, ${nomDate} (RETURNING)`);
          assert.equal(await horodatage(db, 'JournalRegleComptable', id), ms, `${nomSorte}, ${action}, ${nomDate} : RETURNING rend l’horodatage gardé en base après la validation`);
          nouvelles.JournalRegleComptable.push(id);
        }
      }
    }

    // 5. Deux insertions d'une même transaction, espacées : chacune reçoit son propre instant, dans chaque journal.
    //    Lecture écartée : CURRENT_TIMESTAMP (ou now()), l'instant du début de la transaction, identique pour les deux et
    //    antérieur à la borne basse de la seconde.
    const compteEnDeux = await enTransaction(db, async () => {
      const debut1 = await instantBase(db);
      const premiere = await insererCompte(db, 'DESACTIVATION', ANTIDATEE);
      const fin1 = await instantBase(db);
      await db.query('SELECT pg_sleep($1)', [ECART_MS / 1000]);
      const debut2 = await instantBase(db);
      const seconde = await insererCompte(db, 'REACTIVATION', POSTDATEE);
      const fin2 = await instantBase(db);
      return [{ ...premiere, debut: debut1, fin: fin1 }, { ...seconde, debut: debut2, fin: fin2 }];
    });
    const VENTE_PRESTATION = { type: 'REGLE', cible: 'VENTE_PRESTATION', valeurs: [comptes.produitA.id, comptes.produitB.id] };
    const regleEnDeux = await enTransaction(db, async () => {
      const premiere = await regleEtJournal(db, VENTE_PRESTATION, 'CREATION', ANTIDATEE);
      await db.query('SELECT pg_sleep($1)', [ECART_MS / 1000]);
      const seconde = await regleEtJournal(db, VENTE_PRESTATION, 'REMAPPAGE', POSTDATEE);
      return [premiere, seconde];
    });
    for (const [table, [premiere, seconde]] of [['JournalCompteComptable', compteEnDeux], ['JournalRegleComptable', regleEnDeux]]) {
      const [h1, h2] = [await horodatage(db, table, premiere.id), await horodatage(db, table, seconde.id)];
      assert.deepEqual([h1, h2], [premiere.ms, seconde.ms], `${table}, même transaction : RETURNING rend l’horodatage gardé en base`);
      encadre(h1, premiere.debut, premiere.fin, `${table}, même transaction, première insertion`);
      encadre(h2, seconde.debut, seconde.fin, `${table}, même transaction, seconde insertion, ${ECART_MS} ms plus tard`);
      assert.ok(h2 - h1 >= ECART_MS - MARGE_MS, `${table}, même transaction : ${h2 - h1} ms entre les deux insertions, au moins ${ECART_MS - MARGE_MS} attendues`);
      nouvelles[table].push(premiere.id, seconde.id);
    }

    // 6. Une seule requête qui insère deux lignes, produites à 50 ms d'écart (attente corrélée à chaque ligne, donc
    //    rejouée pour chacune) : chaque ligne reçoit l'instant de sa propre insertion, dans chaque journal. Lecture
    //    écartée : statement_timestamp(), l'instant du début de la requête, identique pour les deux lignes. Les deux
    //    écritures des règles sont validées avec la création de leurs deux taux, dans la même transaction (N1).
    const compteEnUneRequete = (await db.query(`INSERT INTO "JournalCompteComptable" (${COLONNES_COMPTE}, "createdAt")
      SELECT gen_random_uuid()::text, $1, $2, $3, 'DESACTIVATION', true, false, NULL, NULL, NULL, NULL, 'TEST une requête, ligne ' || g, $4::timestamp(3)
      FROM generate_series(1, 2) AS g, LATERAL (SELECT pg_sleep($5::float8 * sign(g))) AS attente
      RETURNING "id", ${MS_CREATED_AT} AS ms, "motif"`, [comptes.journalise.id, auteurId, auteurNom, sansFuseau(ANTIDATEE), ECART_MS / 1000])).rows;
    const regleEnUneRequete = await enTransaction(db, async () => {
      await db.query('INSERT INTO "RegleTvaComptable" ("id", "taux", "compteId", "updatedAt") VALUES ($1, 5.5, $2, now()), ($3, 10, $4, now())', [randomUUID(), comptes.tvaA.id, randomUUID(), comptes.tvaB.id]);
      return (await db.query(`INSERT INTO "JournalRegleComptable" (${COLONNES_REGLE}, "createdAt")
        SELECT gen_random_uuid()::text, 'TVA', v.cible, 'CREATION', NULL, v.apres, 'TEST une requête, ligne ' || v.g, $3, $4, $5::timestamp(3)
        FROM (VALUES (1, '5.5', $1), (2, '10', $2)) AS v(g, cible, apres), LATERAL (SELECT pg_sleep($6::float8 * sign(v.g))) AS attente
        RETURNING "id", ${MS_CREATED_AT} AS ms, "motif"`, [comptes.tvaA.id, comptes.tvaB.id, auteurId, auteurNom, sansFuseau(POSTDATEE), ECART_MS / 1000])).rows;
    });
    for (const [table, rendues] of [['JournalCompteComptable', compteEnUneRequete], ['JournalRegleComptable', regleEnUneRequete]]) {
      assert.equal(rendues.length, 2, `${table} : deux lignes en une requête`);
      const [l1, l2] = [...rendues].sort((a, b) => a.motif.localeCompare(b.motif));
      for (const l of [l1, l2]) {
        assert.equal(await horodatage(db, table, l.id), Number(l.ms), `${table}, une requête : RETURNING rend l’horodatage gardé en base`);
        assert.ok(![ANTIDATEE, POSTDATEE].includes(iso(Number(l.ms))), `${table}, une requête : la date choisie est remplacée`);
      }
      const ecart = Math.abs(Number(l2.ms) - Number(l1.ms));
      assert.ok(ecart >= ECART_MS - MARGE_MS, `${table}, une requête, deux lignes : ${ecart} ms entre elles, au moins ${ECART_MS - MARGE_MS} attendues`);
      nouvelles[table].push(l1.id, l2.id);
    }

    // 7. Mode réplica (remise en état des matrices) : les déclencheurs ordinaires ne jouent pas, la ligne recopiée garde
    //    sa date, dans chaque journal (la preuve différée des règles, ordinaire elle aussi, ne joue pas non plus).
    //    Transaction annulée. Lecture écartée : ENABLE ALWAYS.
    const recopieeCompte = randomUUID();
    const recopieeRegle = randomUUID();
    await db.query('BEGIN');
    try {
      await db.query('SET LOCAL session_replication_role = replica');
      const { rows: [c] } = await db.query(`INSERT INTO "JournalCompteComptable" (${COLONNES_COMPTE}, "createdAt") VALUES ($1, $2, $3, $4, 'REACTIVATION', false, true, NULL, NULL, NULL, NULL, 'TEST recopie 615', $5::timestamp(3)) RETURNING ${MS_CREATED_AT} AS ms`,
        [recopieeCompte, comptes.journalise.id, auteurId, auteurNom, sansFuseau(ANTIDATEE)]);
      assert.equal(iso(Number(c.ms)), ANTIDATEE, 'mode réplica, journal des comptes : la date recopiée est gardée');
      const { rows: [r] } = await db.query(`INSERT INTO "JournalRegleComptable" (${COLONNES_REGLE}, "createdAt") VALUES ($1, 'REGLE', 'CLIENT', 'CREATION', NULL, $2, 'TEST recopie 615', $3, $4, $5::timestamp(3)) RETURNING ${MS_CREATED_AT} AS ms`,
        [recopieeRegle, comptes.clientA.id, auteurId, auteurNom, sansFuseau(POSTDATEE)]);
      assert.equal(iso(Number(r.ms)), POSTDATEE, 'mode réplica, journal des règles : la date recopiée est gardée');
    } finally {
      await db.query('ROLLBACK');
    }
    assert.equal(await horodatage(db, 'JournalCompteComptable', recopieeCompte), null, 'mode réplica : insertion annulée');
    assert.equal(await horodatage(db, 'JournalRegleComptable', recopieeRegle), null, 'mode réplica : insertion annulée');

    // 8. Catalogue, déclencheur par déclencheur et par nom : chaque déclencheur du lot est ligne par ligne avant
    //    l'insertion seule (tgtype 7 ; `BEFORE INSERT OR UPDATE` vaudrait 23, `AFTER` 5), ordinaire (« O »), avec sa
    //    fonction nommée et sa définition exacte (aucune clause WHEN) ; les gardes existantes sont intactes, déclencheur
    //    et fonction identiques à ceux d'avant la migration.
    for (const table of TABLES) {
      const apres = await catalogue(db, table);
      const parNom = Object.fromEntries(apres.map((t) => [t.nom, t]));
      const { definitionFonction, ...duLot } = parNom[DECLENCHEURS_DU_LOT[table].nom] ?? {};
      assert.deepEqual(duLot, DECLENCHEURS_DU_LOT[table], `${table} : déclencheur du lot`);
      assert.match(definitionFonction, /^CREATE OR REPLACE FUNCTION public\.horodater_journal_(compte|regle)_comptable\(\)\n RETURNS trigger\n LANGUAGE plpgsql\n/, `${table} : fonction du lot en plpgsql`);
      assert.deepEqual(apres.filter((t) => t.nom !== DECLENCHEURS_DU_LOT[table].nom), catalogueAvant[table], `${table} : gardes existantes intactes (déclencheur, état, définition et fonction)`);
      assert.deepEqual(sansFonction(apres), [...GARDES_CATALOGUE[table], DECLENCHEURS_DU_LOT[table]].sort((a, b) => a.nom.localeCompare(b.nom)), `${table} : catalogue complet`);
    }
    // #629 (T1 de l'audit des droits de #628) : fonctions du lot, corps exact, en plpgsql, ni SECURITY DEFINER ni réglage
    // propre (search_path). Lectures écartées : une fonction exécutée avec les droits de son propriétaire, dont un appel
    // non qualifié pourrait être détourné par le search_path de la session ; un search_path propre posé sans SECURITY
    // DEFINER ; du SQL dynamique (EXECUTE) à la place de l'affectation. Lues par leur nom dans public : la boucle
    // ci-dessus relie déjà chaque déclencheur à `public.horodater_journal_…` (définition exacte du déclencheur, puis de
    // la fonction qu'il exécute), si bien qu'une copie appelée dans un autre schéma y échoue.
    const CORPS_DU_LOT = `\nBEGIN\n  NEW."createdAt" := clock_timestamp() AT TIME ZONE 'UTC';\n  RETURN NEW;\nEND;\n`;
    const fonctionsDuLot = (await db.query(`SELECT p.proname AS nom, l.lanname AS langage, p.prosecdef AS "securityDefiner", p.proconfig AS reglages, p.prosrc AS corps
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('horodater_journal_compte_comptable', 'horodater_journal_regle_comptable') ORDER BY p.proname`)).rows;
    assert.deepEqual(fonctionsDuLot, ['horodater_journal_compte_comptable', 'horodater_journal_regle_comptable'].map((nom) => ({ nom, langage: 'plpgsql', securityDefiner: false, reglages: null, corps: CORPS_DU_LOT })),
      'fonctions du lot : corps exact, plpgsql, ni SECURITY DEFINER ni réglage propre');

    // 9. L'ajout seul reste actif, sur une écriture d'avant la migration comme d'après : ni l'horodatage ni une autre
    //    colonne ne se modifient, aucune écriture ne se supprime, la table ne se vide pas.
    const apresInsertions = Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await lignes(db, table)])));
    for (const [table, message] of [['JournalCompteComptable', REFUS_COMPTE], ['JournalRegleComptable', REFUS_REGLE]]) {
      const refus = { code: 'P0001', message };
      for (const [nom, id] of [['écriture d’avant la migration', anciennes[table][0]], ['écriture horodatée par la base', nouvelles[table][0]]]) {
        await assert.rejects(annulee(db, `UPDATE "${table}" SET "createdAt" = $2::timestamp(3) WHERE "id" = $1`, [id, '2020-06-01 00:00:00.000']), refus, `${table}, ${nom} : horodatage non modifiable`);
        await assert.rejects(annulee(db, `UPDATE "${table}" SET "motif" = $2 WHERE "id" = $1`, [id, 'TEST motif réécrit 615']), refus, `${table}, ${nom} : motif non modifiable`);
        await assert.rejects(annulee(db, `DELETE FROM "${table}" WHERE "id" = $1`, [id]), refus, `${table}, ${nom} : suppression refusée`);
      }
      await assert.rejects(annulee(db, `TRUNCATE "${table}"`), { code: 'P0001', message: vidage(table) }, `${table} : vidage refusé`);
      assert.deepEqual(await lignes(db, table), apresInsertions[table], `${table}, refus : aucune écriture n’a changé ni ne manque`);
      assert.equal(apresInsertions[table].length, anciennes[table].length + nouvelles[table].length);
      assert.deepEqual(apresInsertions[table].filter((l) => anciennes[table].includes(l.id)), avant[table], `${table} : les écritures d’avant la migration restent identiques`);
    }
  });
});
