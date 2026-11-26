// Lot AG-a, suites de #451 (cadrage v2 du 26-11-2026, après le contrôle de cohérence de mode 1 ; « Périmètre », point 1,
// « Critères » et « Tests ») : garde en base « affaire annulée, donc non encaissée » (N5 de l'audit des montants de #449).
// Règle appliquée : décision de Nelson du 02-11-2026 sur #285, « une affaire annulé ne peut etre encaissé », puis, à la
// question fermée, « Corriger maintenant » (refuser l'encaissement d'une affaire annulée et l'annulation d'un chantier déjà
// encaissé). Les routes l'assurent déjà sous verrou (#449) ; la migration 20261126120000_chantier_annule_non_encaisse
// l'impose à toute écriture, SQL direct compris, par la contrainte nommée `Chantier_annule_non_encaisse`,
// `CHECK (NOT ("statut" = 'ANNULE' AND "encaisse"))`. Règle 4 de la méthode : aucune donnée réelle, donc aucune reprise ;
// sur une base qui porterait déjà une affaire annulée et encaissée, la migration échoue au lieu de la corriger.
//
// Ce que prouve ce fichier, sur deux bases jetables distinctes, créées et supprimées par le test (TEST_DATABASE_URL ne sert
// que de connexion administrative), migrées jusqu'à la migration du lot exclue :
//  - base « propre » : avant la migration, une affaire annulée et encaissée s'écrit (la garde est nouvelle) ; la migration
//    passe sans reprise (empreinte de toute la base identique) et pose une contrainte validée, de ce nom ; ensuite, en SQL
//    direct, l'insertion d'une affaire annulée et encaissée, la mise à jour vers ANNULE d'un chantier encaissé (en cours ou
//    terminé) et le passage d'`encaisse` à vrai sur une affaire annulée sont refusés au nom exact de la contrainte (23514),
//    sans rien écrire ; une affaire annulée non encaissée, un chantier terminé encaissé et un chantier en cours encaissé
//    s'écrivent, comme l'annulation d'un chantier désencaissé ;
//  - base « en violation » : une affaire annulée et encaissée posée avant la migration la fait échouer (P3018, 23514, nom de
//    la contrainte), sans reprise : rien n'est écrit (empreinte de toute la base identique, ligne relue à l'identique), la
//    contrainte n'est pas posée et la migration reste inachevée.
// Sans TEST_DATABASE_URL, le fichier s'annonce ignoré, comme les autres tests de migration : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';

const adminUrl = process.env.TEST_DATABASE_URL;
const prismaDir = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma');
const migration = '20261126120000_chantier_annule_non_encaisse';
const CONTRAINTE = 'Chantier_annule_non_encaisse';
const TITRE = `Migration ${migration} : la base refuse une affaire annulée et encaissée, au nom de la contrainte ; la migration échoue, sans reprise, sur une base qui en porte une`;

const ANNULEE = { statut: 'ANNULE', annuleLe: '2026-10-20T08:00:00.000Z', motifAnnulation: 'TEST annulation posée en base (garde AG-a)' };
const DATE_ENCAISSEMENT = '2026-10-10T09:00:00.000Z';
const ENCAISSEE = { encaisse: true, dateEncaissement: DATE_ENCAISSEMENT };
const TERMINEE = { statut: 'TERMINE', dateFin: '2026-10-15T00:00:00.000Z' };

if (!adminUrl) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const url = new URL(adminUrl);
    const maintenance = new URL(url);
    maintenance.pathname = '/postgres';
    const admin = new pg.Client({ connectionString: maintenance.toString() });
    const dossier = mkdtempSync(join(tmpdir(), 'iris-annule-non-encaisse-'));
    const schema = join(dossier, 'schema.prisma');
    const migrations = join(dossier, 'migrations');
    // « test » comme mot (règle de client/scripts/base-jetable.mjs), suffixe tiré au hasard.
    const suffixe = randomBytes(6).toString('hex');
    const bases = {
      propre: { nom: `iris_test_annule_encaisse_propre_${suffixe}`, db: null, creee: false, ids: {} },
      violation: { nom: `iris_test_annule_encaisse_violation_${suffixe}`, db: null, creee: false, ids: {} },
    };
    const cible = (base) => { const u = new URL(url); u.pathname = `/${base.nom}`; return u.toString(); };
    const deploy = (base) => execFileSync(resolve(prismaDir, '../node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', schema], {
      env: { ...process.env, DATABASE_URL: cible(base) }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
    });

    // Empreinte de toute la base (hors historique des migrations) : nombre de lignes et contenu de chaque table.
    const empreinte = async (db) => {
      const tables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`)).rows.map((r) => r.tablename);
      assert.ok(tables.includes('Chantier') && tables.length > 40, `tables relevées : ${tables.join(', ')}`);
      assert.ok(tables.every((t) => /^[A-Za-z_]+$/.test(t)), 'noms de tables sans guillemet');
      const sql = tables.map((t) => `SELECT '${t}' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${t}" x`).join(' UNION ALL ');
      return Object.fromEntries((await db.query(sql)).rows.map(({ t, n, h }) => [t, `${n}:${h}`]));
    };
    const changees = (avant, apres) => Object.keys({ ...avant, ...apres }).filter((t) => avant[t] !== apres[t]);
    const ligne = async (db, id) => (await db.query('SELECT * FROM "Chantier" WHERE "id" = $1', [id])).rows[0];
    const contrainte = async (db) => (await db.query(
      `SELECT conname, contype, convalidated, condeferrable FROM pg_constraint WHERE conrelid = '"Chantier"'::regclass AND conname = $1`, [CONTRAINTE])).rows;

    // Chantier écrit en SQL direct, colonnes nommées ; `champs` complète ou remplace les valeurs de départ.
    const inserer = (db, champs = {}) => {
      const valeurs = { id: randomUUID(), nom: `TEST Chantier garde AG-a ${randomUUID().slice(0, 8)}`, client: 'TEST Client garde AG-a', dateDebut: '2026-09-01T00:00:00.000Z', budgetGlobalVendu: '1234.56', ...champs };
      const colonnes = Object.keys(valeurs);
      return db.query(
        `INSERT INTO "Chantier" (${colonnes.map((c) => `"${c}"`).join(', ')}, "updatedAt") VALUES (${colonnes.map((_c, i) => `$${i + 1}`).join(', ')}, now()) RETURNING "id"`,
        Object.values(valeurs),
      ).then((r) => r.rows[0].id);
    };
    const modifier = (db, id, champs) => {
      const colonnes = Object.keys(champs);
      return db.query(`UPDATE "Chantier" SET ${colonnes.map((c, i) => `"${c}" = $${i + 2}`).join(', ')}, "updatedAt" = now() WHERE "id" = $1`, [id, ...Object.values(champs)]);
    };
    // Écriture refusée par la contrainte : code 23514, nom exact de la contrainte et table, message de PostgreSQL ; rien
    // n'est écrit dans toute la base.
    const refusee = async (db, ecriture, quoi) => {
      const avant = await empreinte(db);
      await assert.rejects(ecriture, (erreur) => {
        assert.deepEqual([erreur.code, erreur.constraint, erreur.table], ['23514', CONTRAINTE, 'Chantier'], `${quoi} : ${erreur.message}`);
        assert.equal(erreur.message, `new row for relation "Chantier" violates check constraint "${CONTRAINTE}"`, quoi);
        return true;
      }, quoi);
      assert.deepEqual(changees(avant, await empreinte(db)), [], `${quoi} : rien ne doit être écrit`);
    };

    before(async () => {
      assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'seul un PostgreSQL local est autorisé');
      for (const base of Object.values(bases)) assert.notEqual(url.pathname.slice(1), base.nom);
      await admin.connect();
      copyFileSync(join(prismaDir, 'schema.prisma'), schema);
      mkdirSync(migrations);
      copyFileSync(join(prismaDir, 'migrations/migration_lock.toml'), join(migrations, 'migration_lock.toml'));
      const toutes = readdirSync(join(prismaDir, 'migrations')).filter((nom) => nom !== 'migration_lock.toml').sort();
      assert.ok(toutes.includes(migration), `${migration} : migration absente`);
      for (const nom of toutes.filter((n) => n < migration)) cpSync(join(prismaDir, 'migrations', nom), join(migrations, nom), { recursive: true });
      for (const base of Object.values(bases)) {
        await admin.query(`CREATE DATABASE "${base.nom}"`);
        base.creee = true;
        deploy(base);
        base.db = new pg.Client({ connectionString: cible(base) });
        await base.db.connect();
        assert.deepEqual(await contrainte(base.db), [], `${base.nom} : la contrainte n’existe pas avant la migration`);
      }
      // La migration du lot est ensuite ajoutée au dossier, pour les deux bases.
      cpSync(join(prismaDir, 'migrations', migration), join(migrations, migration), { recursive: true });
    });

    after(async () => {
      for (const base of Object.values(bases)) await base.db?.end().catch(() => {});
      for (const base of Object.values(bases)) {
        if (base.creee) await admin.query(`DROP DATABASE IF EXISTS "${base.nom}" WITH (FORCE)`).catch(() => {});
      }
      await admin.end().catch(() => {});
      rmSync(dossier, { recursive: true, force: true });
    });

    // Témoin de nouveauté : sans la migration, rien n'empêche en base une affaire annulée et encaissée (écrite puis
    // annulée par ROLLBACK, la base reste propre). Écarte un test qui passerait sans la contrainte du lot.
    test('base propre, avant la migration : une affaire annulée et encaissée s’écrit en SQL direct (la garde est nouvelle) ; les chantiers témoins sont posés', async () => {
      const { db, ids } = bases.propre;
      await db.query('BEGIN');
      try {
        const id = await inserer(db, { ...ANNULEE, ...ENCAISSEE });
        assert.deepEqual([(await ligne(db, id)).statut, (await ligne(db, id)).encaisse], ['ANNULE', true]);
      } finally {
        await db.query('ROLLBACK');
      }
      ids.annuleeNonEncaissee = await inserer(db, ANNULEE);
      ids.termineeEncaissee = await inserer(db, { ...TERMINEE, ...ENCAISSEE });
      ids.enCoursEncaissee = await inserer(db, ENCAISSEE);
      ids.enCoursNonEncaissee = await inserer(db);
      ids.termineeEncaissee2 = await inserer(db, { ...TERMINEE, ...ENCAISSEE });
      ids.annuleeNonEncaissee2 = await inserer(db, ANNULEE);
      const relus = await Promise.all(Object.values(ids).map((id) => ligne(db, id)));
      assert.deepEqual(relus.map((l) => [l.statut, l.encaisse]), [
        ['ANNULE', false], ['TERMINE', true], ['EN_COURS', true], ['EN_COURS', false], ['TERMINE', true], ['ANNULE', false],
      ]);
    });

    // Cadrage, périmètre 1 : « Règle 4 : aucune donnée réelle ; la migration échoue si une ligne la viole, sans reprise. »
    // Sur une base sans violation, elle passe sans rien écrire, et la contrainte est posée validée (et non NOT VALID, qui
    // laisserait en place une ligne en violation), sous son nom.
    test('base propre : la migration passe sans reprise (empreinte de toute la base identique) et pose la contrainte « Chantier_annule_non_encaisse », validée', async () => {
      const { db, ids } = bases.propre;
      assert.ok(ids.annuleeNonEncaissee, 'données d’avant la migration absentes');
      const avant = await empreinte(db);
      const lignesAvant = await Promise.all(Object.values(ids).map((id) => ligne(db, id)));
      deploy(bases.propre);
      const appliquee = (await db.query('SELECT "migration_name", "finished_at" IS NOT NULL AS terminee, "rolled_back_at" IS NULL AS valide FROM "_prisma_migrations" WHERE "migration_name" = $1', [migration])).rows;
      assert.deepEqual(appliquee, [{ migration_name: migration, terminee: true, valide: true }]);
      assert.deepEqual(changees(avant, await empreinte(db)), [], 'aucune ligne reprise ni réécrite');
      assert.deepEqual(await Promise.all(Object.values(ids).map((id) => ligne(db, id))), lignesAvant, 'chantiers relus à l’identique, updatedAt compris');
      assert.deepEqual(await contrainte(db), [{ conname: CONTRAINTE, contype: 'c', convalidated: true, condeferrable: false }]);
    });

    // Critère : « La base refuse un chantier ANNULE et encaissé, à l'insertion et à la mise à jour en SQL direct, au nom de
    // la contrainte ». Chaque chemin vers l'état interdit : insertion (avec et sans date d'encaissement, ce qui écarte une
    // garde portée sur la date au lieu de la case), annulation d'un chantier encaissé en cours ou terminé, encaissement
    // d'une affaire annulée, et les deux à la fois sur un chantier en cours non encaissé.
    test('après la migration, en SQL direct : insertion d’une affaire annulée et encaissée, mise à jour vers ANNULE d’un chantier encaissé, passage d’« encaisse » à vrai sur une affaire annulée : refusés au nom de la contrainte (23514), rien d’écrit', async () => {
      const { db, ids } = bases.propre;
      assert.deepEqual(await contrainte(db), [{ conname: CONTRAINTE, contype: 'c', convalidated: true, condeferrable: false }], 'migration appliquée');
      await refusee(db, () => inserer(db, { ...ANNULEE, ...ENCAISSEE }), 'insertion d’une affaire annulée et encaissée, datée');
      await refusee(db, () => inserer(db, { ...ANNULEE, encaisse: true }), 'insertion d’une affaire annulée et encaissée, sans date d’encaissement');
      await refusee(db, () => inserer(db, { ...ANNULEE, ...TERMINEE, statut: 'ANNULE', ...ENCAISSEE }), 'insertion d’une affaire annulée, encaissée et datée de fin');
      await refusee(db, () => modifier(db, ids.enCoursEncaissee, ANNULEE), 'chantier en cours encaissé passé à ANNULE');
      await refusee(db, () => modifier(db, ids.termineeEncaissee, ANNULEE), 'chantier terminé encaissé passé à ANNULE');
      await refusee(db, () => modifier(db, ids.termineeEncaissee, { statut: 'ANNULE' }), 'chantier terminé encaissé passé à ANNULE, statut seul');
      await refusee(db, () => modifier(db, ids.annuleeNonEncaissee, ENCAISSEE), 'affaire annulée encaissée (case et date)');
      await refusee(db, () => modifier(db, ids.annuleeNonEncaissee, { encaisse: true }), 'affaire annulée encaissée (case seule)');
      await refusee(db, () => modifier(db, ids.enCoursNonEncaissee, { ...ANNULEE, ...ENCAISSEE }), 'chantier en cours non encaissé, annulé et encaissé d’un coup');
      // Dans une transaction aussi, le refus tombe à l'instruction, et rien n'est validé.
      const avant = await empreinte(db);
      await db.query('BEGIN');
      try {
        await assert.rejects(modifier(db, ids.enCoursEncaissee, ANNULEE), (erreur) => erreur.code === '23514' && erreur.constraint === CONTRAINTE);
      } finally {
        await db.query('ROLLBACK');
      }
      assert.deepEqual(changees(avant, await empreinte(db)), [], 'transaction refusée : rien d’écrit');
      const relus = await Promise.all([ids.enCoursEncaissee, ids.termineeEncaissee, ids.annuleeNonEncaissee, ids.enCoursNonEncaissee].map((id) => ligne(db, id)));
      assert.deepEqual(relus.map((l) => [l.statut, l.encaisse]), [['EN_COURS', true], ['TERMINE', true], ['ANNULE', false], ['EN_COURS', false]]);
    });

    // Critère : « elle admet ANNULE non encaissé et TERMINE encaissé » ; cadrage, « Tests » du redacteur : « ANNULE non
    // encaissé, TERMINE encaissé, EN_COURS encaissé ». Écarte une contrainte trop large : « jamais encaissé » (refuserait
    // TERMINE ou EN_COURS encaissé), « jamais annulé » (refuserait ANNULE non encaissé), ou portée sur TERMINE. L'annulation
    // d'un chantier désencaissé (case remise à faux, date effacée) reste admise : c'est le chemin que l'API ouvre après un
    // désencaissement (#449, « encaissé puis désencaissé »).
    test('après la migration, en SQL direct : une affaire annulée non encaissée, un chantier terminé encaissé et un chantier en cours encaissé s’écrivent, à l’insertion comme à la mise à jour ; un chantier désencaissé s’annule', async () => {
      const { db, ids } = bases.propre;
      assert.deepEqual(await contrainte(db), [{ conname: CONTRAINTE, contype: 'c', convalidated: true, condeferrable: false }], 'migration appliquée');
      const admis = {
        annulee: await inserer(db, ANNULEE),
        annuleeDateeDeFin: await inserer(db, { ...TERMINEE, ...ANNULEE }),
        termineeEncaissee: await inserer(db, { ...TERMINEE, ...ENCAISSEE }),
        enCoursEncaissee: await inserer(db, ENCAISSEE),
      };
      const relus = await Promise.all(Object.values(admis).map((id) => ligne(db, id)));
      assert.deepEqual(relus.map((l) => [l.statut, l.encaisse]), [['ANNULE', false], ['ANNULE', false], ['TERMINE', true], ['EN_COURS', true]]);
      // Mises à jour admises : une affaire annulée non encaissée reste modifiable en base (motif), le chantier en cours
      // encaissé se clôture, le chantier terminé encaissé se rouvre et se désencaisse.
      assert.equal((await modifier(db, ids.annuleeNonEncaissee2, { motifAnnulation: 'TEST motif corrigé en base' })).rowCount, 1);
      assert.equal((await modifier(db, ids.enCoursEncaissee, TERMINEE)).rowCount, 1);
      assert.equal((await modifier(db, admis.termineeEncaissee, { statut: 'EN_COURS' })).rowCount, 1);
      assert.equal((await modifier(db, ids.enCoursNonEncaissee, ENCAISSEE)).rowCount, 1);
      assert.equal((await modifier(db, ids.termineeEncaissee2, { encaisse: false, dateEncaissement: null, ...ANNULEE })).rowCount, 1);
      const apres = await Promise.all([ids.annuleeNonEncaissee2, ids.enCoursEncaissee, admis.termineeEncaissee, ids.enCoursNonEncaissee, ids.termineeEncaissee2].map((id) => ligne(db, id)));
      assert.deepEqual(apres.map((l) => [l.statut, l.encaisse]), [['ANNULE', false], ['TERMINE', true], ['EN_COURS', true], ['EN_COURS', true], ['ANNULE', false]]);
      assert.equal(apres[0].motifAnnulation, 'TEST motif corrigé en base');
    });

    // Cadrage, périmètre 1 : « Règle 4 : aucune donnée réelle ; la migration échoue si une ligne la viole, sans reprise. »
    // Écarte une contrainte posée NOT VALID (la migration passerait), et une migration qui reprendrait la ligne
    // (désencaissement, retour en cours ou suppression) avant de poser la contrainte.
    test('base en violation : une affaire annulée et encaissée posée avant la migration la fait échouer (P3018, 23514, nom de la contrainte), sans reprise ni contrainte posée', async () => {
      const { db, ids } = bases.violation;
      ids.violation = await inserer(db, { ...ANNULEE, ...ENCAISSEE });
      ids.annuleeNonEncaissee = await inserer(db, ANNULEE);
      ids.termineeEncaissee = await inserer(db, { ...TERMINEE, ...ENCAISSEE });
      ids.enCoursEncaissee = await inserer(db, ENCAISSEE);
      const avant = await empreinte(db);
      const lignesAvant = await Promise.all(Object.values(ids).map((id) => ligne(db, id)));
      assert.deepEqual([lignesAvant[0].statut, lignesAvant[0].encaisse, lignesAvant[0].dateEncaissement instanceof Date], ['ANNULE', true, true]);
      assert.throws(() => deploy(bases.violation), (erreur) => {
        const sortie = `${erreur.stdout || ''}\n${erreur.stderr || ''}`;
        assert.match(sortie, /P3018/);
        assert.match(sortie, new RegExp(`Migration name: ${migration}`));
        assert.match(sortie, /Database error code: 23514/);
        assert.ok(sortie.includes(`check constraint "${CONTRAINTE}" of relation "Chantier" is violated by some row`), sortie);
        return true;
      });
      assert.deepEqual(changees(avant, await empreinte(db)), [], 'aucune ligne reprise, désencaissée ni supprimée');
      assert.deepEqual(await Promise.all(Object.values(ids).map((id) => ligne(db, id))), lignesAvant, 'chantiers relus à l’identique, updatedAt compris');
      assert.deepEqual(await contrainte(db), [], 'contrainte non posée');
      const etat = (await db.query('SELECT "finished_at" IS NULL AS inachevee, "rolled_back_at" IS NULL AS non_annulee FROM "_prisma_migrations" WHERE "migration_name" = $1', [migration])).rows;
      assert.deepEqual(etat, [{ inachevee: true, non_annulee: true }], 'migration inscrite en échec, inachevée');
      // Sans contrainte, la base admet toujours l'état interdit : la garde n'est pas posée à moitié.
      assert.equal((await modifier(db, ids.enCoursEncaissee, ANNULEE)).rowCount, 1);
    });
  });
}
