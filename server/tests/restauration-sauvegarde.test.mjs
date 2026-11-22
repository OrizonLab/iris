// Lot #618 : restauration d'une sauvegarde sans réécrire les journaux d'audit (cadrage v1 complété de la v2, qui fait
// foi ; issue `suivi-audit` #618, note N3 de l'audit des droits de #617, commentaire d'état du 19-11-2026 ; règle 2 de la
// méthode, journaux d'audit ; message de Nelson du 20-11-2026, « Ordre : fait les correctif d'issu d'abord »).
//
// Ce fichier éprouve la procédure de deploy_guide.md, sous-section « Restauration d'une sauvegarde », commande par
// commande, transposée hors Docker : `docker exec [-i] iris_db` retiré ; `-U iris` remplacé par PGHOST, PGPORT, PGUSER et
// PGPASSWORD tirés de TEST_DATABASE_URL et passés aux processus enfants par leur environnement (N3 de la v2 : libpq
// refuse `?schema=public`, et aucun mot de passe sur la ligne de commande) ; la base `iris` remplacée par une base
// jetable ; `sauvegarde_AAAA-MM-JJ.sql` par un fichier du dossier temporaire du test. Correspondance :
//  - sauvegarde (sous-section précédente) : `pg_dump <base> > fichier` ;
//  - étape 1 : `grep -cx -- '-- PostgreSQL database dump complete' fichier`, qui doit afficher 1 (ligne entière, N3 de #642) ;
//  - étape 4 : `pg_dump <base> > avant_restauration.sql`, code 0 et contrôle de l'étape 1 sur ce fichier (« 1 ») ;
//  - étape 5 : `dropdb --force <base>`, puis `createdb <base>` ;
//  - étape 6 : `psql -d <base> -v ON_ERROR_STOP=1 --single-transaction < fichier` (entrée standard, T3), code 0 attendu ;
//  - étape 7 : `psql -d <base> -tAc 'SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal'` égal à
//    `grep -cE '^CREATE (CONSTRAINT )?TRIGGER ' fichier`, puis la requête des huit journaux, lue telle quelle dans le
//    guide (seul bloc `sql` de la sous-section) et lancée par `psql -tA -c` : la plus récente date de chaque journal
//    précède le début de la restauration, et le résultat égale celui de la base sauvegardée ;
//  - étapes 2, 3 et 8 (image d'Iris, arrêt et redémarrage du backend) : aucun backend ne tourne sur une base jetable ;
//    le redémarrage, qui applique les migrations (server/Dockerfile), est éprouvé par `prisma migrate deploy` (T5).
//
// Jeu d'essai (cadrage, point 3 ; T6 de la v2) : base migrée, puis, en mode réplica (déclencheurs ordinaires inactifs),
// une ligne au passé dans chacun des huit journaux horodatés par la base, chacune à un instant distinct et précis à la
// milliseconde, avec ses lignes parentes : une intervention sous contrat (`couvertureContrat`) et une facture émise
// (ligne, ventilation, identité de l'émetteur, mentions) ; la signature a une date d'acceptation distincte de sa date de
// création (le déclencheur les rendrait égales). Copies figées modifiées après coup, toujours en mode réplica : compte
// cité par le journal des règles renommé (`journal_regle_figer_comptes` rejoué recopierait le nouveau libellé), client
// renommé (la facture garde l'ancienne raison sociale), politique du contrat changée (l'intervention garde sa
// couverture). Depuis #642 (N3), la marque de fin figure aussi dans une donnée (détail du journal des paramètres et des
// droits) : non ancré, `grep -c` compterait 2 sur la sauvegarde complète et 1 sur la sauvegarde coupée.
//
// Cas (cadrage v2) :
//  - procédure retenue : chaque table identique (toutes colonnes), dont chaque ligne des huit journaux et
//    `_prisma_migrations`, déclencheurs, fonctions, contraintes (nom, type, état, noms des colonnes ; N4 : pas leur
//    texte, que `pg_get_constraintdef` change de parenthèses), index, séquences et droits (N4 : `aclexplode(coalesce(relacl,
//    acldefault(…)))`) ; `dropdb` sans `--force` refusé tant qu'une connexion est ouverte ; copie de sécurité (C3)
//    restaurable ; ensuite (T5) `prisma migrate deploy` ne trouve rien à appliquer et ne change rien, une insertion
//    ordinaire est horodatée par la base et la modification d'un journal est refusée ;
//  - R1 : une sauvegarde coupée avant ses déclencheurs est refusée par l'étape 1, avant que la base ne soit touchée ;
//    témoin : restaurée avec les options retenues, elle rend 0 et laisse une base sans déclencheur ni clé étrangère,
//    que `migrate deploy` ne complète pas et que le contrôle des déclencheurs ne voit pas (0 dans la base, 0 dans le
//    fichier coupé : seule l'étape 1 la détecte) ;
//  - échec franc : la sauvegarde complète restaurée avec les options dans une base déjà migrée (backend démarré trop
//    tôt) rend un code non nul et ne change rien ; reprise à l'étape 5 ;
//  - C2, témoin du danger : restaurée sans `-v ON_ERROR_STOP=1 --single-transaction` dans une base migrée, elle rend 0,
//    le journal des paramètres et des droits prend l'instant de la restauration et `_prisma_migrations` double ; la
//    requête des journaux du guide le montre (T4), pas le contrôle des déclencheurs ; s'y ajoutent les autres
//    affirmations du « Pourquoi » du guide : ligne du journal des règles refusée par `journal_regle_figer_comptes`,
//    conflits sur le compte système et les paramètres de rémunération ;
//  - T1 : erreur tardive (`SELECT 1/0;` avant le premier `CREATE TRIGGER`) : sans `--single-transaction`, base chargée
//    sans déclencheurs ni clés étrangères, signalée par le contrôle des déclencheurs (mais pas par le contrôle du
//    fichier) ; avec, base vide ;
//  - T7 : sauvegarde sous un fuseau, restauration sous un autre ; la requête des journaux du guide rend ses dates en
//    UTC quel que soit le fuseau de sa session (« Les dates sont en UTC »).
//
// Mutants de la procédure tués (rapport du lot) : `--single-transaction` retiré (T1), `ON_ERROR_STOP` retiré (échec
// franc, T1), restauration dans la base migrée au lieu d'une base recréée vide (procédure retenue), étape 1 omise (R1).
//
// Prérequis (C4 de la v2 ; N6 de #642) : PostgreSQL local (TEST_DATABASE_URL sur localhost, 127.0.0.1 ou [::1] : ce
// fichier crée et supprime des bases) ; rôle de TEST_DATABASE_URL qui peut créer des bases (CREATEDB) et poser
// session_replication_role (jeu d'essai en mode réplica) ; pg_dump, psql, createdb et dropdb dans le PATH, de version
// majeure au moins égale à celle du serveur ; grep. S'il en manque un, le premier test échoue avec un message qui dit
// lequel, et chacun des autres échoue en le citant : jamais un SKIP. Sans TEST_DATABASE_URL, le fichier s'annonce ignoré,
// comme les autres fichiers à base propre (server/tests/README.md).
//
// Bases jetables créées à côté de celle de TEST_DATABASE_URL, au nom qui porte « test » comme mot (règle de
// client/scripts/base-jetable.mjs), toutes supprimées à la fin, même en cas d'échec, comme le dossier temporaire des
// fichiers de sauvegarde.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';
import pg from 'pg';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TITRE = 'Restauration d’une sauvegarde complète sans réécrire les journaux d’audit (#618)';
const ici = dirname(fileURLToPath(import.meta.url));
const PRISMA = resolve(ici, '../node_modules/.bin/prisma');
const SCHEMA = resolve(ici, '../prisma/schema.prisma');
const DOSSIER_MIGRATIONS = resolve(ici, '../prisma/migrations');
const GUIDE = resolve(ici, '../../deploy_guide.md');
const DELAI_MS = 180_000;

// Commandes du guide.
const OPTIONS_RETENUES = ['-v', 'ON_ERROR_STOP=1', '--single-transaction'];
const MARQUE_FIN = '-- PostgreSQL database dump complete';
const MOTIF_DECLENCHEURS = '^CREATE (CONSTRAINT )?TRIGGER ';
const REQUETE_DECLENCHEURS = 'SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal';
const AUCUNE_MIGRATION = 'No pending migrations to apply.';
const MESSAGE_AJOUT_SEUL = 'Journal des paramètres et des droits immuable : modification interdite';

// Les huit journaux horodatés par un déclencheur `BEFORE INSERT` (constat du cadrage).
const JOURNAUX = ['JournalAdministration', 'JournalFacture', 'InterventionRapport', 'InterventionSignature', 'EnvoiDocument', 'JournalSaisieChantier', 'JournalCompteComptable', 'JournalRegleComptable'];
// Instants du jeu d'essai, au format de to_jsonb (session en UTC) : distincts, au passé, précis à la milliseconde.
// `EnvoiDocument.createdAt` est la seule colonne avec fuseau (TIMESTAMPTZ(3)).
const INSTANTS = {
  JournalAdministration: '2021-03-04T05:06:07.891',
  JournalFacture: '2021-03-05T06:07:08.912',
  InterventionRapport: '2021-03-06T07:08:09.123',
  InterventionSignature: '2021-03-06T07:08:10.345',
  EnvoiDocument: '2021-03-07T08:09:10.456+00:00',
  JournalSaisieChantier: '2021-03-08T09:10:11.567',
  JournalCompteComptable: '2021-03-09T10:11:12.678',
  JournalRegleComptable: '2021-03-10T11:12:13.789',
};
// Date d'acceptation de la signature, distincte de sa date de création : `horodater_signature_intervention` rejoué
// donnerait aux deux l'instant de la restauration.
const ACCEPTE_LE = '2021-03-06T07:08:10.234';
// Fuseaux de T7 : sauvegarde à UTC+14, restauration à UTC−10 (le 07-03-2021, avant l'heure d'été d'Adak).
const FUSEAU_SAUVEGARDE = 'Pacific/Kiritimati';
const FUSEAU_RESTAURATION = 'America/Adak';
const ENVOI_A_KIRITIMATI = '2021-03-07 22:09:10.456+14';

// Littéral SQL d'un instant du jeu d'essai.
const sql = (instant) => `'${instant.replace('T', ' ')}'`;

const suffixe = randomBytes(6).toString('hex');
const bases = new Set();
let dossier = null;

// ——— Connexion ———

const urlBase = (base) => {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${base}`;
  return url.toString();
};

// Environnement des processus enfants : celui du processus sans ses variables PG* (un PGTZ ou un PGOPTIONS du poste
// changerait la sauvegarde), plus les paramètres de connexion tirés de TEST_DATABASE_URL, et le fuseau voulu (T7).
function environnementSansPg() {
  return Object.fromEntries(Object.entries(process.env).filter(([nom]) => !nom.toUpperCase().startsWith('PG')));
}
function environnementPg(fuseau) {
  const url = new URL(TEST_DATABASE_URL);
  const env = environnementSansPg();
  env.PGHOST = url.hostname.replace(/^\[(.*)\]$/, '$1');
  env.PGPORT = url.port || '5432';
  env.PGUSER = decodeURIComponent(url.username);
  env.PGPASSWORD = decodeURIComponent(url.password);
  env.PGCONNECT_TIMEOUT = '10';
  if (fuseau) env.PGTZ = fuseau;
  return env;
}

// Commande lancée sans interpréteur de commandes ; `entree` et `sortie` jouent `< fichier` et `> fichier`.
function executer(commande, args, { env = environnementPg(), entree, sortie } = {}) {
  const descripteurs = [];
  const ouvrir = (chemin, mode) => {
    const fd = openSync(chemin, mode);
    descripteurs.push(fd);
    return fd;
  };
  try {
    const stdio = [entree ? ouvrir(entree, 'r') : 'ignore', sortie ? ouvrir(sortie, 'w') : 'pipe', 'pipe'];
    const r = spawnSync(commande, args, { env, stdio, encoding: 'utf8', timeout: DELAI_MS, maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new Error(`${commande} n’a pas pu être lancé : ${r.error.message}`);
    return { code: r.status, signal: r.signal, sortie: r.stdout ?? '', erreurs: r.stderr ?? '' };
  } finally {
    for (const fd of descripteurs) closeSync(fd);
  }
}
const decrire = (r) => `code ${r.code}${r.signal ? `, signal ${r.signal}` : ''} ; sortie « ${r.sortie.slice(-800)} » ; erreurs « ${r.erreurs.slice(-1500)} »`;

// Requête des journaux, lue dans le guide : seul bloc `sql` de la sous-section « Restauration d'une sauvegarde ».
function requeteJournauxDuGuide() {
  const texte = readFileSync(GUIDE, 'utf8');
  const debut = texte.indexOf('### Restauration d\'une sauvegarde');
  assert.ok(debut >= 0, 'deploy_guide.md : sous-section « Restauration d’une sauvegarde » introuvable');
  const reste = texte.slice(debut + 4);
  const fin = reste.search(/^#{2,3} /m);
  const section = fin >= 0 ? reste.slice(0, fin) : reste;
  const blocs = [...section.matchAll(/^[ \t]*```sql\n([\s\S]*?)^[ \t]*```/gm)].map(([, bloc]) => bloc);
  assert.equal(blocs.length, 1, 'deploy_guide.md : la sous-section « Restauration d’une sauvegarde » doit porter un seul bloc sql, la requête des journaux');
  for (const journal of JOURNAUX) assert.ok(blocs[0].includes(`"${journal}"`), `requête des journaux du guide : ${journal} absent`);
  return blocs[0];
}

// Commandes du guide, transposées (correspondance en tête du fichier).
const guide = {
  sauvegarder: (base, fichier, fuseau) => executer('pg_dump', [base], { env: environnementPg(fuseau), sortie: fichier }),
  controlerFichier: (fichier) => executer('grep', ['-cx', '--', MARQUE_FIN, fichier]),
  supprimerBase: (base) => executer('dropdb', ['--force', base]),
  creerBase: (base) => executer('createdb', [base]),
  restaurer: (base, fichier, { options = OPTIONS_RETENUES, fuseau } = {}) => executer('psql', ['-d', base, ...options], { env: environnementPg(fuseau), entree: fichier }),
  declencheursEnBase: (base) => executer('psql', ['-d', base, '-tAc', REQUETE_DECLENCHEURS]),
  declencheursDuFichier: (fichier) => executer('grep', ['-cE', MOTIF_DECLENCHEURS, fichier]),
  journaux: (base, fuseau) => executer('psql', ['-d', base, '-tA', '-c', requeteJournauxDuGuide()], { env: environnementPg(fuseau) }),
};

// Commandes de la sous-section, dans l'ordre où le guide les donne : la transposition de `guide` les suit.
const COMMANDES_DU_GUIDE = [
  `grep -cx -- '${MARQUE_FIN}' sauvegarde_AAAA-MM-JJ.sql`,
  'docker exec iris_db pg_dump -U iris iris > avant_restauration_$(date +%F_%H%M).sql',
  'docker exec iris_db dropdb -U iris --force iris',
  'docker exec iris_db createdb -U iris iris',
  `docker exec -i iris_db psql -U iris -d iris ${OPTIONS_RETENUES.join(' ')} < sauvegarde_AAAA-MM-JJ.sql`,
  `docker exec iris_db psql -U iris -d iris -tAc '${REQUETE_DECLENCHEURS}'`,
  `grep -cE '${MOTIF_DECLENCHEURS}' sauvegarde_AAAA-MM-JJ.sql`,
];
function commandesDuGuide() {
  const texte = readFileSync(GUIDE, 'utf8');
  const debut = texte.indexOf('### Restauration d\'une sauvegarde');
  assert.ok(debut >= 0, 'deploy_guide.md : sous-section « Restauration d’une sauvegarde » introuvable');
  const reste = texte.slice(debut + 4);
  const fin = reste.search(/^#{2,3} /m);
  const section = fin >= 0 ? reste.slice(0, fin) : reste;
  return [...section.matchAll(/^[ \t]*```bash\n([\s\S]*?)^[ \t]*```/gm)].flatMap(([, bloc]) => bloc.split('\n').map((l) => l.trim()).filter(Boolean));
}

// Résultat de la requête des journaux : une ligne par journal, nombre, plus ancienne et plus récente date (UTC).
function lireJournaux(r) {
  assert.equal(r.code, 0, `requête des journaux du guide : ${decrire(r)}`);
  const lignes = r.sortie.trim().split('\n').map((ligne) => {
    const [journal, nombre, min, max] = ligne.split('|');
    return { journal, nombre: Number(nombre), min: min || null, max: max || null };
  });
  assert.deepEqual(lignes.map((l) => l.journal), JOURNAUX, 'requête des journaux du guide : un journal par ligne, dans l’ordre');
  return lignes;
}
// Date UTC sans fuseau rendue par psql, en millisecondes.
const enMs = (texte) => Date.parse(`${texte.replace(' ', 'T')}Z`);

async function connecter(base) {
  const db = new pg.Client({ connectionString: urlBase(base), application_name: 'iris-test-restauration' });
  // Une connexion fermée par `dropdb --force` émet une erreur : elle est constatée par la requête suivante.
  db.on('error', () => {});
  await db.connect();
  await db.query("SET TimeZone = 'UTC'");
  return db;
}
async function avec(base, corps) {
  const db = await connecter(base);
  try {
    return await corps(db);
  } finally {
    await db.end().catch(() => {});
  }
}
// Instant de l'horloge du serveur, en millisecondes, tronqué.
const instantServeur = () => avec('postgres', async (db) => Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms')).rows[0].ms));

// ——— Bases jetables ———

function nouvelleBase(partie) {
  const base = `iris_test_restauration_${partie}_${suffixe}`;
  assert.notEqual(base, new URL(TEST_DATABASE_URL).pathname.slice(1));
  bases.add(base);
  return base;
}
function creerVide(base) {
  const r = guide.creerBase(base);
  assert.equal(r.code, 0, `createdb ${base} : ${decrire(r)}`);
}
function migrer(base) {
  const r = executer(PRISMA, ['migrate', 'deploy', '--schema', SCHEMA], { env: { ...environnementSansPg(), DATABASE_URL: urlBase(base) } });
  assert.equal(r.code, 0, `prisma migrate deploy sur ${base} : ${decrire(r)}`);
  return r.sortie;
}
function creerMigree(base) {
  creerVide(base);
  migrer(base);
}
const baseExiste = (base) => avec('postgres', async (db) => (await db.query('SELECT 1 FROM pg_database WHERE datname = $1', [base])).rowCount === 1);
const nombre = async (db, requete) => Number((await db.query(requete)).rows[0].n);
const declencheursNonInternes = (db) => nombre(db, 'SELECT count(*) AS n FROM pg_trigger WHERE NOT tgisinternal');
const clesEtrangeres = (db) => nombre(db, "SELECT count(*) AS n FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace");
const migrationsAppliquees = (db) => nombre(db, 'SELECT count(*) AS n FROM public."_prisma_migrations"');
const migrationsDuDepot = () => readdirSync(DOSSIER_MIGRATIONS, { withFileTypes: true }).filter((e) => e.isDirectory()).length;

// Lignes d'un journal (toutes colonnes), triées par identifiant.
const lignesDe = async (db, table) => (await db.query(`SELECT to_jsonb(t) AS ligne FROM public.${db.escapeIdentifier(table)} t ORDER BY t."id"`)).rows.map((r) => r.ligne);
async function lignesDesJournaux(db) {
  const resultat = {};
  for (const journal of JOURNAUX) resultat[journal] = await lignesDe(db, journal);
  return resultat;
}

// Empreinte de la base : données de chaque table (to_jsonb de toutes les lignes), `_prisma_migrations` ligne à ligne,
// déclencheurs, fonctions, contraintes (nom, type, état et noms des colonnes ; N4 : pas leur texte ; ni les numéros des
// colonnes, que la base restaurée renumérote après les colonnes supprimées par les migrations), index, séquences, droits
// (N4 : aclexplode du droit effectif, ACL par défaut comprise).
async function empreinte(db) {
  const lire = async (requete) => (await db.query(requete)).rows;
  const tables = (await lire(`SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') ORDER BY relname`)).map((r) => r.relname);
  const donnees = {};
  for (const table of tables) {
    const [r] = await lire(`SELECT count(*)::int AS lignes, md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), '')) AS md5 FROM public.${db.escapeIdentifier(table)} t`);
    donnees[table] = r;
  }
  return {
    donnees,
    migrations: tables.includes('_prisma_migrations') ? (await lire('SELECT to_jsonb(m) AS ligne FROM public."_prisma_migrations" m ORDER BY m."id"')).map((r) => r.ligne) : null,
    declencheurs: await lire(`SELECT c.relname AS table, t.tgname AS nom, t.tgenabled AS etat, t.tgtype::int AS type, p.proname AS fonction, pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid WHERE NOT t.tgisinternal ORDER BY 1, 2`),
    fonctions: await lire(`SELECT p.proname AS nom, pg_get_function_identity_arguments(p.oid) AS arguments, p.prosrc AS source, p.prosecdef AS definisseur,
        p.proconfig AS reglages, p.provolatile AS volatilite, l.lanname AS langage
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1, 2`),
    contraintes: await lire(`SELECT c.conrelid::regclass::text AS table, c.conname AS nom, c.contype AS type, c.convalidated AS validee, c.condeferrable AS differable,
        c.condeferred AS differee, c.confrelid::regclass::text AS reference, c.confupdtype AS "surModification", c.confdeltype AS "surSuppression",
        (SELECT array_agg(a.attname::text ORDER BY k.rang) FROM unnest(c.conkey) WITH ORDINALITY k(numero, rang)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.numero) AS colonnes,
        (SELECT array_agg(a.attname::text ORDER BY k.rang) FROM unnest(c.confkey) WITH ORDINALITY k(numero, rang)
          JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.numero) AS "colonnesReferencees"
      FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    index: await lire(`SELECT i.indrelid::regclass::text AS table, c.relname AS nom, pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relnamespace = 'public'::regnamespace ORDER BY 1, 2`),
    sequences: await lire(`SELECT sequencename AS nom, last_value::text AS valeur FROM pg_sequences WHERE schemaname = 'public' ORDER BY 1`),
    droits: await lire(`SELECT d.objet, coalesce(g.rolname, a.grantor::text) AS concedant, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE coalesce(b.rolname, a.grantee::text) END AS beneficiaire,
        a.privilege_type AS droit, a.is_grantable AS transmissible
      FROM (
        SELECT 'relation ' || c.relname AS objet, coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner)) AS acl
          FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
        UNION ALL SELECT 'fonction ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', coalesce(p.proacl, acldefault('f', p.proowner))
          FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        UNION ALL SELECT 'schéma ' || n.nspname, coalesce(n.nspacl, acldefault('n', n.nspowner)) FROM pg_namespace n WHERE n.nspname = 'public'
      ) d CROSS JOIN LATERAL aclexplode(d.acl) a
      LEFT JOIN pg_roles g ON g.oid = a.grantor LEFT JOIN pg_roles b ON b.oid = a.grantee
      ORDER BY 1, 2, 3, 4`),
  };
}
const empreinteDe = (base) => avec(base, empreinte);
const PARTIES_EMPREINTE = ['migrations', 'declencheurs', 'fonctions', 'contraintes', 'index', 'sequences', 'droits', 'donnees'];
// Comparaison partie par partie, pour un message qui nomme la partie, puis complète.
function memeEmpreinte(obtenue, attendue, contexte) {
  assert.deepEqual(Object.keys(obtenue).sort(), [...PARTIES_EMPREINTE].sort(), `${contexte} : parties de l’empreinte`);
  for (const partie of PARTIES_EMPREINTE) assert.deepEqual(obtenue[partie], attendue[partie], `${contexte} : ${partie}`);
  assert.deepEqual(obtenue, attendue, `${contexte} : empreinte complète`);
}

// ——— Jeu d'essai ———

const ids = Object.fromEntries(['auteur', 'client', 'contrat', 'intervention', 'chantier', 'identite', 'mentions', 'facture', 'ligne', 'ventilation', 'compteClient', 'comptePrestations', 'regle',
  ...JOURNAUX].map((cle) => [cle, randomUUID()]));
const LIBELLES = {
  auteur: `TEST Auteur restauration 618 ${suffixe}`,
  client: `TEST Client restauration 618 ${suffixe}`,
  clientRenomme: `TEST Client renommé 618 ${suffixe}`,
  prestations: 'TEST Prestations 618',
  prestationsRenommees: 'TEST Prestations renommées 618',
  numeroFacture: `TEST-F-2021-0001-${suffixe}`,
};
const COUVERTURE = { politiqueMainOeuvre: 'INCLUSE', politiqueMateriel: 'HORS_FORFAIT', noteCouverture: 'TEST Visite annuelle comprise 618' };

function sqlDuJeu() {
  const i = ids;
  const auteur = LIBELLES.auteur.replaceAll("'", "''");
  return `
INSERT INTO "User" ("id", "email", "name", "updatedAt") VALUES ('${i.auteur}', 'test-restauration-618-${suffixe}@iris.test', '${auteur}', '2021-01-02 03:04:05.006');
INSERT INTO "Client" ("id", "raisonSociale", "updatedAt") VALUES ('${i.client}', '${LIBELLES.client}', '2021-01-02 03:04:05.006');
INSERT INTO "ContratMaintenance" ("id", "clientId", "titre", "statut", "periodiciteMois", "dureePrevisionnelleMinutes", "dateDebut", "prochaineEcheance",
    "politiqueMainOeuvre", "politiqueMateriel", "noteCouverture", "createdById", "updatedAt")
  VALUES ('${i.contrat}', '${i.client}', 'TEST Contrat de maintenance 618', 'ACTIF', 12, 120, '2021-01-01', '2022-02-01',
    'INCLUSE', 'HORS_FORFAIT', '${COUVERTURE.noteCouverture}', '${i.auteur}', '2021-01-02 03:04:05.006');
INSERT INTO "Intervention" ("id", "reference", "clientId", "contratMaintenanceId", "echeanceContrat", "couvertureContrat", "titre", "statut", "dateDemande", "createdById", "updatedAt")
  VALUES ('${i.intervention}', 'TEST-I21-0001-${suffixe}', '${i.client}', '${i.contrat}', '2021-02-01', '${JSON.stringify(COUVERTURE)}'::jsonb,
    'TEST Visite annuelle 618', 'TERMINEE', '2021-01-15', '${i.auteur}', '2021-03-02 08:00:00.001');
INSERT INTO "Chantier" ("id", "nom", "client", "dateDebut", "budgetGlobalVendu", "updatedAt")
  VALUES ('${i.chantier}', 'TEST Chantier restauration 618', '${LIBELLES.client}', '2021-01-01', 0, '2021-01-02 03:04:05.006');
INSERT INTO "IdentiteEmetteur" ("id", "empreinte", "raisonSociale", "siret", "adresse", "codePostal", "ville", "couleurPrimaire")
  VALUES ('${i.identite}', 'test-identite-618-${suffixe}', 'TEST Émetteur 618', '00000000000000', '1 rue de l’Essai', '75001', 'Paris', '#1e3a8a');
INSERT INTO "MentionsLegalesVersion" ("id", "version", "mentions", "cgv", "penalites", "actif", "publieeLe")
  VALUES ('${i.mentions}', 1, 'TEST Mentions 618', 'TEST Conditions 618', 'TEST Pénalités 618', true, '2021-01-01 00:00:00.000');
INSERT INTO "Facture" ("id", "numero", "annee", "clientId", "clientRaisonSociale", "statut", "type", "dateEmission", "dateEcheance",
    "totalHt", "totalTva", "totalTtc", "origine", "interventionId", "mentionsLegalesVersionId", "identiteEmetteurId", "emisLe", "createdById", "updatedAt")
  VALUES ('${i.facture}', '${LIBELLES.numeroFacture}', 2021, '${i.client}', '${LIBELLES.client}', 'EMISE', 'FACTURE', '2021-03-03', '2021-04-02',
    100.00, 20.00, 120.00, 'INTERVENTION', '${i.intervention}', '${i.mentions}', '${i.identite}', '2021-03-03 09:10:11.121', '${i.auteur}', '2021-03-03 09:10:11.121');
INSERT INTO "FactureLigne" ("id", "factureId", "ordre", "designation", "nature", "quantite", "prixUnitaireHt", "tauxTva", "totalHt", "totalTtc")
  VALUES ('${i.ligne}', '${i.facture}', 1, 'TEST Visite annuelle 618', 'PRESTATION', 1.250, 80.00, 20.00, 100.00, 120.00);
INSERT INTO "FactureVentilationTva" ("id", "factureId", "tauxTva", "totalHt", "totalTva", "totalTtc") VALUES ('${i.ventilation}', '${i.facture}', 20.00, 100.00, 20.00, 120.00);
INSERT INTO "CompteComptable" ("id", "code", "libelle", "nature", "actif", "updatedAt") VALUES
  ('${i.compteClient}', '411000', 'TEST Clients 618', 'ACTIF', false, '2021-01-02 03:04:05.006'),
  ('${i.comptePrestations}', '706000', '${LIBELLES.prestations}', 'PRODUIT', true, '2021-01-02 03:04:05.006');
INSERT INTO "RegleComptable" ("id", "cle", "compteId", "updatedAt") VALUES ('${i.regle}', 'VENTE_PRESTATION', '${i.comptePrestations}', ${sql(INSTANTS.JournalRegleComptable)});
INSERT INTO "JournalAdministration" ("id", "domaine", "type", "action", "detail", "auteurNom", "createdAt")
  VALUES ('${i.JournalAdministration}', 'REGLAGES', 'PARAMETRES', 'MODIFICATION', '${MARQUE_FIN}', '${auteur}', ${sql(INSTANTS.JournalAdministration)});
INSERT INTO "JournalFacture" ("id", "factureId", "acteurId", "action", "createdAt") VALUES ('${i.JournalFacture}', '${i.facture}', '${i.auteur}', 'EMISSION', ${sql(INSTANTS.JournalFacture)});
INSERT INTO "InterventionRapport" ("id", "interventionId", "auteurId", "contenu", "createdAt")
  VALUES ('${i.InterventionRapport}', '${i.intervention}', '${i.auteur}', 'TEST Compte rendu de la visite 618', ${sql(INSTANTS.InterventionRapport)});
INSERT INTO "InterventionSignature" ("id", "rapportId", "signataire", "trace", "enregistreParId", "empreinte", "accepteLe", "createdAt")
  VALUES ('${i.InterventionSignature}', '${i.InterventionRapport}', 'TEST Signataire 618', '{"ratio": 2, "traits": [[[0.1, 0.2], [0.3, 0.4]]]}'::jsonb, '${i.auteur}',
    '${'ab'.repeat(32)}', ${sql(ACCEPTE_LE)}, ${sql(INSTANTS.InterventionSignature)});
INSERT INTO "EnvoiDocument" ("id", "factureId", "canal", "destinataire", "objet", "auteurId", "auteurNom", "createdAt")
  VALUES ('${i.EnvoiDocument}', '${i.facture}', 'MESSAGERIE', 'client-618@iris.test', 'TEST Facture 618', '${i.auteur}', '${auteur}', ${sql(INSTANTS.EnvoiDocument)});
INSERT INTO "JournalSaisieChantier" ("id", "chantierId", "cible", "cibleId", "action", "auteurId", "auteurNom", "createdAt")
  VALUES ('${i.JournalSaisieChantier}', '${i.chantier}', 'ACHAT', '${randomUUID()}', 'CREATION', '${i.auteur}', '${auteur}', ${sql(INSTANTS.JournalSaisieChantier)});
INSERT INTO "JournalCompteComptable" ("id", "compteId", "auteurId", "auteurNom", "action", "avant", "apres", "motif", "createdAt")
  VALUES ('${i.JournalCompteComptable}', '${i.compteClient}', '${i.auteur}', '${auteur}', 'DESACTIVATION', true, false, 'TEST Désactivation du compte 618', ${sql(INSTANTS.JournalCompteComptable)});
INSERT INTO "JournalRegleComptable" ("id", "type", "cible", "action", "avant", "apres", "apresCode", "apresLibelle", "motif", "auteurId", "auteurNom", "createdAt")
  VALUES ('${i.JournalRegleComptable}', 'REGLE', 'VENTE_PRESTATION', 'CREATION', NULL, '${i.comptePrestations}', '706000', '${LIBELLES.prestations}',
    'TEST Création de la règle 618', '${i.auteur}', '${auteur}', ${sql(INSTANTS.JournalRegleComptable)});
-- Copies figées, modifiées après coup.
UPDATE "CompteComptable" SET "libelle" = '${LIBELLES.prestationsRenommees}', "updatedAt" = '2021-06-01 00:00:00.000' WHERE "id" = '${i.comptePrestations}';
UPDATE "Client" SET "raisonSociale" = '${LIBELLES.clientRenomme}', "updatedAt" = '2021-06-01 00:00:00.000' WHERE "id" = '${i.client}';
UPDATE "ContratMaintenance" SET "politiqueMainOeuvre" = 'HORS_FORFAIT', "updatedAt" = '2021-06-01 00:00:00.000' WHERE "id" = '${i.contrat}';
`;
}

// Écriture en mode réplica (déclencheurs ordinaires inactifs), dans une seule transaction.
async function enModeReplica(db, requete) {
  await db.query('BEGIN');
  try {
    await db.query('SET LOCAL session_replication_role = replica');
    await db.query(requete);
    await db.query('COMMIT');
  } catch (erreur) {
    await db.query('ROLLBACK').catch(() => {});
    throw erreur;
  }
}

// ——— Prérequis (C4) ———

const PREPARATION_INTERROMPUE = 'Préparation interrompue : un prérequis de ce fichier manque (voir le test « prérequis »). Ce fichier échoue au lieu de s’ignorer : un SKIP serait confondu avec une réussite.';
let prerequisManquants = null;

async function verifierPrerequis() {
  const manques = [];
  const url = new URL(TEST_DATABASE_URL);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) manques.push(`TEST_DATABASE_URL désigne « ${url.hostname} » : seul un PostgreSQL local est admis, ce fichier crée et supprime des bases.`);
  let majeureServeur = null;
  try {
    await avec('postgres', async (db) => {
      const { rows: [r] } = await db.query('SELECT current_user AS role, rolcreatedb OR rolsuper AS "peutCreer", current_setting(\'server_version_num\')::int AS version FROM pg_roles WHERE rolname = current_user');
      majeureServeur = Math.floor(r.version / 10000);
      if (!r.peutCreer) manques.push(`Le rôle « ${r.role} » de TEST_DATABASE_URL n’a pas le droit CREATEDB : ce fichier crée ses bases à côté de la sienne.`);
      await db.query('BEGIN');
      try {
        await db.query('SET LOCAL session_replication_role = replica');
      } catch (erreur) {
        manques.push(`Le rôle « ${r.role} » de TEST_DATABASE_URL ne peut pas poser session_replication_role (« ${erreur.message} ») : le jeu d’essai écrit ses journaux au passé en mode réplica, déclencheurs ordinaires inactifs. Il faut un rôle super-utilisateur, comme en CI (.github/scripts/postgresql-runner.sh) et dans la base Docker de server/tests/README.md, ou, depuis PostgreSQL 15, GRANT SET ON PARAMETER session_replication_role.`);
      } finally {
        await db.query('ROLLBACK');
      }
    });
  } catch (erreur) {
    manques.push(`Serveur de TEST_DATABASE_URL injoignable : ${erreur.message}`);
  }
  for (const outil of ['pg_dump', 'psql', 'createdb', 'dropdb']) {
    const r = spawnSync(outil, ['--version'], { env: environnementSansPg(), encoding: 'utf8' });
    if (r.error || r.status !== 0) {
      manques.push(`${outil} introuvable dans le PATH (${r.error?.message ?? `code ${r.status}`}) : la procédure du guide l’emploie.`);
      continue;
    }
    const majeure = Number(/\b(\d+)(?:\.\d+)+/.exec(r.stdout)?.[1]);
    if (majeureServeur !== null && !(majeure >= majeureServeur)) {
      manques.push(`${outil} de version ${r.stdout.trim()} : version majeure au moins égale à celle du serveur (${majeureServeur}) requise (le psql d’une version plus ancienne refuse les sauvegardes récentes).`);
    }
  }
  const grep = spawnSync('grep', ['--version'], { encoding: 'utf8' });
  if (grep.error || grep.status !== 0) manques.push('grep introuvable dans le PATH : la procédure du guide l’emploie.');
  return manques;
}

// ——— Préparation commune : base source, jeu d'essai, sauvegarde complète et fichiers dérivés ———

let preparation = null;
const preparer = () => (preparation ??= (async () => {
  dossier = mkdtempSync(join(tmpdir(), 'iris-restauration-618-'));
  const source = nouvelleBase('source');
  creerMigree(source);
  await avec(source, (db) => enModeReplica(db, sqlDuJeu()));
  const empreinteSource = await empreinteDe(source);
  const lignesSource = await avec(source, lignesDesJournaux);
  const journauxSource = lireJournaux(guide.journaux(source));
  const declencheursSource = await avec(source, declencheursNonInternes);

  const sauvegarde = join(dossier, 'sauvegarde.sql');
  const r = guide.sauvegarder(source, sauvegarde);
  assert.equal(r.code, 0, `pg_dump de la base source : ${decrire(r)}`);
  const texte = readFileSync(sauvegarde, 'utf8');
  const lignes = texte.split('\n');
  const premierDeclencheur = lignes.findIndex((ligne) => new RegExp(MOTIF_DECLENCHEURS).test(ligne));
  assert.ok(premierDeclencheur > 0, 'sauvegarde : aucun CREATE TRIGGER');
  // R1 : sauvegarde coupée juste avant son premier déclencheur, à une limite d'instruction (une coupure au milieu d'une
  // instruction laisserait une instruction incomplète, que psql enverrait et que le serveur refuserait).
  const tronquee = join(dossier, 'sauvegarde-coupee.sql');
  writeFileSync(tronquee, `${lignes.slice(0, premierDeclencheur).join('\n')}\n`);
  // T1 : erreur tardive, juste avant le premier déclencheur.
  const tardive = join(dossier, 'sauvegarde-erreur-tardive.sql');
  writeFileSync(tardive, [...lignes.slice(0, premierDeclencheur), 'SELECT 1/0;', ...lignes.slice(premierDeclencheur)].join('\n'));
  return { source, empreinteSource, lignesSource, journauxSource, declencheursSource, sauvegarde, tronquee, tardive };
})());

const etatPrepare = async () => {
  if (prerequisManquants === null) assert.fail('Le test « prérequis » n’a pas été joué.');
  if (prerequisManquants.length > 0) assert.fail(PREPARATION_INTERROMPUE);
  return preparer();
};

// Témoin du jeu d'essai : la base source porte bien les valeurs choisies (sans quoi deux bases horodatées à l'instant
// présent seraient « identiques » sans rien prouver).
function verifierJeu(lignes, contexte) {
  for (const journal of JOURNAUX) {
    assert.equal(lignes[journal].length, 1, `${contexte} : ${journal} doit porter la seule ligne du jeu`);
    assert.equal(lignes[journal][0].id, ids[journal], `${contexte} : ${journal}, identifiant`);
    assert.equal(lignes[journal][0].createdAt, INSTANTS[journal], `${contexte} : ${journal}, horodatage d’origine`);
  }
  assert.equal(lignes.InterventionSignature[0].accepteLe, ACCEPTE_LE, `${contexte} : date d’acceptation de la signature`);
  assert.equal(lignes.JournalRegleComptable[0].apresCode, '706000', `${contexte} : code figé du journal des règles`);
  assert.equal(lignes.JournalRegleComptable[0].apresLibelle, LIBELLES.prestations, `${contexte} : libellé figé du journal des règles`);
}

// ——— Procédure du guide ———

// Suit les étapes du guide dans leur ordre et s'arrête au premier contrôle qui échoue : `arret` donne l'étape, ou null
// si la procédure va à son terme. `copie` : fichier de la copie de sécurité (étape 4).
async function procedureDuGuide({ fichier, base, copie, copier = guide.sauvegarder }) {
  const etapes = {};
  // 1. Fichier complet.
  etapes.controle = guide.controlerFichier(fichier);
  if (etapes.controle.sortie.trim() !== '1') return { arret: 1, etapes };
  // 4. Copie de sécurité de la base actuelle.
  etapes.copie = copier(base, copie);
  if (etapes.copie.code !== 0) return { arret: 4, etapes };
  etapes.controleCopie = guide.controlerFichier(copie);
  if (etapes.controleCopie.sortie.trim() !== '1') return { arret: 4, etapes };
  // 5. Base recréée vide.
  etapes.suppression = guide.supprimerBase(base);
  if (etapes.suppression.code !== 0) return { arret: 5, etapes };
  etapes.creation = guide.creerBase(base);
  if (etapes.creation.code !== 0) return { arret: 5, etapes };
  // 6. Restauration par l'entrée standard, code 0 attendu.
  etapes.debut = await instantServeur();
  etapes.restauration = guide.restaurer(base, fichier);
  if (etapes.restauration.code !== 0) return { arret: 6, etapes };
  // 7. Vérification : déclencheurs de la base et du fichier, puis journaux.
  const enBase = guide.declencheursEnBase(base);
  const duFichier = guide.declencheursDuFichier(fichier);
  etapes.declencheurs = { base: enBase.sortie.trim(), fichier: duFichier.sortie.trim() };
  if (enBase.code !== 0 || etapes.declencheurs.base !== etapes.declencheurs.fichier) return { arret: 7, etapes };
  etapes.journaux = lireJournaux(guide.journaux(base));
  if (etapes.journaux.some((j) => j.max !== null && enMs(j.max) >= etapes.debut)) return { arret: 7, etapes };
  return { arret: null, etapes };
}

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    // Bases et fichiers supprimés même après un échec (y compris une base recréée par la procédure sous le même nom).
    after(async () => {
      try {
        if (bases.size > 0) {
          await avec('postgres', async (db) => {
            for (const base of bases) await db.query(`DROP DATABASE IF EXISTS ${db.escapeIdentifier(base)} WITH (FORCE)`);
          });
        }
      } finally {
        if (dossier) rmSync(dossier, { recursive: true, force: true });
      }
    });

    test('prérequis : PostgreSQL local, rôle PostgreSQL qui crée des bases et pose session_replication_role, pg_dump, psql, createdb et dropdb au moins de la version du serveur, grep ; sinon échec explicite, jamais un SKIP', async () => {
      prerequisManquants = await verifierPrerequis();
      assert.deepEqual(prerequisManquants, [], `Prérequis manquants pour restauration-sauvegarde.test.mjs :\n- ${prerequisManquants.join('\n- ')}\nCe fichier échoue au lieu de s’ignorer : un SKIP serait confondu avec une réussite.`);
    });

    test('commandes du guide : chaque commande des blocs bash de la sous-section est celle que ce fichier transpose, dans le même ordre', () => {
      assert.deepEqual(commandesDuGuide(), COMMANDES_DU_GUIDE);
    });

    test('étape 4 : une copie de sécurité en échec (code non nul) ou incomplète (sans marque de fin) arrête la procédure avant dropdb ; la base en service reste intacte', async () => {
      const etat = await etatPrepare();
      const enService = nouvelleBase('copie_ko');
      creerMigree(enService);
      const avant = await empreinteDe(enService);
      // Copie impossible : pg_dump ne joint pas le serveur (port fermé), code non nul.
      const enEchec = await procedureDuGuide({ fichier: etat.sauvegarde, base: enService, copie: join(dossier, 'avant_restauration_ko.sql'),
        copier: (base, fichier) => executer('pg_dump', [base], { env: { ...environnementPg(), PGPORT: '1' }, sortie: fichier }) });
      assert.equal(enEchec.arret, 4, `copie en échec : arrêt attendu à l’étape 4 : ${JSON.stringify(enEchec.etapes, null, 1).slice(0, 2000)}`);
      assert.notEqual(enEchec.etapes.copie.code, 0);
      // Copie coupée mais code 0 (fichier tronqué après coup) : seul le contrôle du fichier l'arrête.
      const coupee = await procedureDuGuide({ fichier: etat.sauvegarde, base: enService, copie: join(dossier, 'avant_restauration_coupee.sql'),
        copier: (base, fichier) => {
          const r = guide.sauvegarder(base, fichier);
          const texte = readFileSync(fichier, 'utf8');
          writeFileSync(fichier, texte.slice(0, Math.floor(texte.length / 2)));
          return r;
        } });
      assert.equal(coupee.etapes.copie.code, 0, 'copie coupée : code 0');
      assert.equal(coupee.arret, 4, `copie coupée : arrêt attendu à l’étape 4 : ${JSON.stringify(coupee.etapes, null, 1).slice(0, 2000)}`);
      assert.equal(coupee.etapes.controleCopie.sortie.trim(), '0');
      assert.equal(await baseExiste(enService), true, 'base en service toujours là');
      memeEmpreinte(await empreinteDe(enService), avant, 'base en service inchangée');
    });

    test('procédure retenue : sauvegarde complète vérifiée puis restaurée par l’entrée standard dans une base recréée vide, avec -v ON_ERROR_STOP=1 --single-transaction ; chaque ligne des huit journaux, `_prisma_migrations` et toute la base identiques à la base sauvegardée, copies figées gardées, déclencheurs, contraintes, index et droits identiques ; la copie de sécurité de la base remplacée se restaure', async () => {
      const etat = await etatPrepare();
      verifierJeu(etat.lignesSource, 'base sauvegardée');
      assert.equal(etat.empreinteSource.migrations.length, migrationsDuDepot(), 'base sauvegardée : toutes les migrations du dépôt');

      // Base en service à remplacer : migrée, avec une écriture qui lui est propre, et une connexion ouverte (pgBackWeb,
      // par exemple).
      const cible = nouvelleBase('cible');
      creerMigree(cible);
      await avec(cible, (db) => enModeReplica(db, `INSERT INTO "JournalAdministration" ("id", "domaine", "type", "action", "auteurNom", "createdAt")
        VALUES ('${randomUUID()}', 'DROITS', 'COMPTE', 'MODIFICATION', 'TEST Base remplacée 618', '2020-02-02 02:02:02.202')`));
      const empreinteAvant = await empreinteDe(cible);
      const ouverte = await connecter(cible);
      try {
        // Étape 5, témoin de `--force` : sans lui, la base encore ouverte ne se supprime pas.
        const sansForce = executer('dropdb', [cible]);
        assert.notEqual(sansForce.code, 0, `dropdb sans --force, connexion ouverte : ${decrire(sansForce)}`);
        assert.match(sansForce.erreurs, /being accessed by other users|est en cours d.utilisation/, `dropdb sans --force : ${decrire(sansForce)}`);
        assert.equal(await baseExiste(cible), true, 'dropdb sans --force : la base reste');

        const copie = join(dossier, 'avant_restauration.sql');
        const { arret, etapes } = await procedureDuGuide({ fichier: etat.sauvegarde, base: cible, copie });
        assert.equal(arret, null, `procédure arrêtée à l’étape ${arret} : ${JSON.stringify(etapes, null, 1).slice(0, 4000)}`);
        assert.equal(etapes.controle.sortie.trim(), '1', 'étape 1 : le fichier complet porte sa marque de fin');
        assert.equal(etapes.restauration.code, 0, `étape 6 : ${decrire(etapes.restauration)}`);
        assert.equal(etapes.restauration.erreurs.match(/ERROR|ERREUR/g), null, `étape 6 : aucune erreur attendue : ${decrire(etapes.restauration)}`);
        // Étape 7 : autant de déclencheurs que dans le fichier et que dans la base sauvegardée.
        assert.deepEqual(etapes.declencheurs, { base: String(etat.declencheursSource), fichier: String(etat.declencheursSource) }, 'étape 7 : déclencheurs');
        assert.ok(etat.declencheursSource >= 100, `base sauvegardée : ${etat.declencheursSource} déclencheurs non internes`);
        // Requête des journaux du guide : même résultat que sur la base sauvegardée, chaque date antérieure au début de
        // la restauration.
        assert.deepEqual(etapes.journaux, etat.journauxSource, 'étape 7 : requête des journaux du guide, base restaurée contre base sauvegardée');
        for (const j of etapes.journaux) {
          assert.equal(j.nombre, 1, `${j.journal} : une ligne`);
          assert.ok(enMs(j.max) < etapes.debut, `${j.journal} : plus récente date ${j.max} antérieure au début de la restauration`);
        }
        // `--force` a fermé la connexion encore ouverte.
        await assert.rejects(ouverte.query('SELECT 1'), 'la connexion ouverte sur l’ancienne base est fermée par dropdb --force');

        // Toute la base, dont chaque ligne des huit journaux (toutes colonnes) et `_prisma_migrations`.
        const lignesRestaurees = await avec(cible, lignesDesJournaux);
        for (const journal of JOURNAUX) assert.deepEqual(lignesRestaurees[journal], etat.lignesSource[journal], `${journal} : chaque ligne, toutes colonnes`);
        verifierJeu(lignesRestaurees, 'base restaurée');
        const empreinteRestauree = await empreinteDe(cible);
        memeEmpreinte(empreinteRestauree, etat.empreinteSource, 'base restaurée contre base sauvegardée');
        assert.ok(empreinteRestauree.declencheurs.every((d) => d.etat === 'O'), 'chaque déclencheur ordinaire et actif (« O »)');

        // Copies figées (T6) : rien n'est recalculé, ni par `journal_regle_figer_comptes` ni ailleurs.
        await avec(cible, async (db) => {
          const { rows: [r] } = await db.query(`SELECT
              (SELECT "libelle" FROM "CompteComptable" WHERE "id" = $1) AS compte,
              (SELECT "apresLibelle" FROM "JournalRegleComptable" WHERE "id" = $2) AS journal,
              (SELECT "raisonSociale" FROM "Client" WHERE "id" = $3) AS client,
              (SELECT "clientRaisonSociale" FROM "Facture" WHERE "id" = $4) AS facture,
              (SELECT "statut" FROM "Facture" WHERE "id" = $4) AS statut,
              (SELECT "numero" FROM "Facture" WHERE "id" = $4) AS numero,
              (SELECT "totalHt"::text || ' ' || "totalTva"::text || ' ' || "totalTtc"::text FROM "Facture" WHERE "id" = $4) AS totaux,
              (SELECT "politiqueMainOeuvre" FROM "ContratMaintenance" WHERE "id" = $5) AS contrat,
              (SELECT "couvertureContrat" FROM "Intervention" WHERE "id" = $6) AS couverture`,
          [ids.comptePrestations, ids.JournalRegleComptable, ids.client, ids.facture, ids.contrat, ids.intervention]);
          assert.equal(r.compte, LIBELLES.prestationsRenommees, 'compte renommé après l’écriture du journal');
          assert.equal(r.journal, LIBELLES.prestations, 'journal des règles : libellé figé gardé (journal_regle_figer_comptes non rejoué)');
          assert.equal(r.client, LIBELLES.clientRenomme, 'client renommé après l’émission');
          assert.equal(r.facture, LIBELLES.client, 'facture émise : raison sociale figée gardée');
          assert.equal(r.statut, 'EMISE');
          assert.equal(r.numero, LIBELLES.numeroFacture);
          assert.equal(r.totaux, '100.00 20.00 120.00', 'facture émise : montants gardés');
          assert.equal(r.contrat, 'HORS_FORFAIT', 'politique du contrat changée après la génération de l’intervention');
          assert.deepEqual(r.couverture, COUVERTURE, 'intervention sous contrat : couverture figée gardée');
        });

        // Copie de sécurité (étape 4, C3) : complète, et restaurée dans une base vide elle rend la base remplacée.
        assert.equal(guide.controlerFichier(copie).sortie.trim(), '1', 'copie de sécurité complète');
        const retour = nouvelleBase('copie');
        creerVide(retour);
        const r = guide.restaurer(retour, copie);
        assert.equal(r.code, 0, `restauration de la copie de sécurité : ${decrire(r)}`);
        memeEmpreinte(await empreinteDe(retour), empreinteAvant, 'la copie de sécurité rend la base remplacée');
      } finally {
        await ouverte.end().catch(() => {});
      }
    });

    test('après la restauration : `prisma migrate deploy` (redémarrage du backend) n’applique rien et ne change rien ; les déclencheurs jouent de nouveau : une insertion ordinaire antidatée reçoit l’instant de la base, la modification d’un journal est refusée', async () => {
      const etat = await etatPrepare();
      const base = nouvelleBase('apres');
      creerVide(base);
      const { arret, etapes } = await procedureDuGuide({ fichier: etat.sauvegarde, base, copie: join(dossier, 'avant_restauration_apres.sql') });
      assert.equal(arret, null, `procédure arrêtée à l’étape ${arret} : ${JSON.stringify(etapes, null, 1).slice(0, 4000)}`);
      const avant = await empreinteDe(base);
      memeEmpreinte(avant, etat.empreinteSource, 'base restaurée contre base sauvegardée');

      // T5 : l'image d'Iris de la sauvegarde ne trouve aucune migration à appliquer.
      const sortie = migrer(base);
      assert.ok(sortie.includes(AUCUNE_MIGRATION), `prisma migrate deploy : « ${AUCUNE_MIGRATION} » attendu : ${sortie}`);
      memeEmpreinte(await empreinteDe(base), avant, 'prisma migrate deploy ne change rien');

      await avec(base, async (db) => {
        // Horodatage par la base : une insertion antidatée reçoit l'instant de son insertion (lecture écartée :
        // déclencheurs absents ou désactivés après la restauration).
        const id = randomUUID();
        const debut = Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms')).rows[0].ms);
        const { rows: [ecrite] } = await db.query(`INSERT INTO "JournalAdministration" ("id", "domaine", "type", "action", "auteurNom", "createdAt")
          VALUES ($1, 'REGLAGES', 'PARAMETRES', 'MODIFICATION', 'TEST Après restauration 618', '2001-01-01 00:00:00.000')
          RETURNING round(extract(epoch FROM ("createdAt" AT TIME ZONE 'UTC')) * 1000)::bigint AS ms`, [id]);
        const fin = Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms')).rows[0].ms);
        const ms = Number(ecrite.ms);
        assert.ok(ms >= debut && ms <= fin + 1, `insertion ordinaire : horodatage ${new Date(ms).toISOString()} hors de [${new Date(debut).toISOString()} ; ${new Date(fin).toISOString()} + 1 ms]`);
        // Ajout seul : la ligne restaurée ne se modifie pas.
        await assert.rejects(db.query('UPDATE "JournalAdministration" SET "detail" = \'TEST modifié\' WHERE "id" = $1', [ids.JournalAdministration]), (erreur) => {
          assert.match(erreur.message, new RegExp(MESSAGE_AJOUT_SEUL));
          return true;
        });
        const { rows: [ligne] } = await db.query('SELECT to_jsonb(j) AS ligne FROM "JournalAdministration" j WHERE "id" = $1', [ids.JournalAdministration]);
        assert.deepEqual(ligne.ligne, etat.lignesSource.JournalAdministration[0], 'ligne restaurée inchangée après le refus');
      });
    });

    test('R1 : une sauvegarde coupée avant ses déclencheurs est refusée par le contrôle du fichier, avant que la base ne soit touchée ; témoin : restaurée avec les options retenues, elle rend 0 et laisse une base sans déclencheur ni clé étrangère, que le contrôle des déclencheurs ne voit pas et que `migrate deploy` ne complète pas', async () => {
      const etat = await etatPrepare();
      const coupee = readFileSync(etat.tronquee, 'utf8');
      for (const journal of JOURNAUX) assert.ok(coupee.includes(`COPY public."${journal}" `), `sauvegarde coupée : données de ${journal} présentes`);
      assert.ok(!coupee.split('\n').includes(MARQUE_FIN), 'sauvegarde coupée : sans ligne de fin');
      assert.ok(coupee.includes(MARQUE_FIN), 'sauvegarde coupée : la marque de fin figure dans une donnée (témoin de N3, #642)');
      assert.ok(!/FOREIGN KEY/.test(coupee), 'sauvegarde coupée : sans clé étrangère');

      // Étape 1 : le fichier coupé est refusé (« 0 »), la base en service n'est pas touchée.
      const enService = nouvelleBase('r1_service');
      creerMigree(enService);
      const avant = await empreinteDe(enService);
      const { arret, etapes } = await procedureDuGuide({ fichier: etat.tronquee, base: enService, copie: join(dossier, 'avant_restauration_r1.sql') });
      assert.equal(arret, 1, `procédure : arrêt attendu à l’étape 1 (contrôle du fichier), obtenu ${arret}`);
      assert.equal(etapes.controle.sortie.trim(), '0', `contrôle du fichier : « 0 » attendu : ${decrire(etapes.controle)}`);
      assert.equal(guide.controlerFichier(etat.sauvegarde).sortie.trim(), '1', 'contrôle du fichier complet : « 1 »');
      // Témoin (N3 de #642) : non ancré, grep -c compte aussi la marque écrite dans une donnée.
      assert.equal(executer('grep', ['-c', '--', MARQUE_FIN, etat.tronquee]).sortie.trim(), '1', 'témoin : grep -c non ancré, fichier coupé');
      assert.equal(executer('grep', ['-c', '--', MARQUE_FIN, etat.sauvegarde]).sortie.trim(), '2', 'témoin : grep -c non ancré, fichier complet');
      assert.equal(await baseExiste(enService), true, 'base en service toujours là');
      memeEmpreinte(await empreinteDe(enService), avant, 'base en service inchangée');

      // Témoin : sans l'étape 1, la restauration ne voit rien.
      const base = nouvelleBase('r1_coupee');
      creerVide(base);
      const r = guide.restaurer(base, etat.tronquee);
      assert.equal(r.code, 0, `restauration de la sauvegarde coupée avec les options retenues : code 0 attendu (témoin) : ${decrire(r)}`);
      await avec(base, async (db) => {
        assert.equal(await declencheursNonInternes(db), 0, 'sauvegarde coupée : aucun déclencheur');
        assert.equal(await clesEtrangeres(db), 0, 'sauvegarde coupée : aucune clé étrangère');
        assert.equal(await migrationsAppliquees(db), migrationsDuDepot(), 'sauvegarde coupée : toutes les migrations inscrites');
        const lignes = await lignesDesJournaux(db);
        for (const journal of JOURNAUX) assert.deepEqual(lignes[journal], etat.lignesSource[journal], `sauvegarde coupée : ${journal} chargé`);
      });
      // Le contrôle des déclencheurs compare la base à son propre fichier : 0 et 0. Seul le contrôle du fichier
      // (étape 1) détecte une sauvegarde coupée avant ses déclencheurs.
      assert.equal(guide.declencheursEnBase(base).sortie.trim(), '0', 'contrôle des déclencheurs : base');
      assert.equal(guide.declencheursDuFichier(etat.tronquee).sortie.trim(), '0', 'contrôle des déclencheurs : fichier coupé');
      assert.equal(guide.declencheursDuFichier(etat.sauvegarde).sortie.trim(), String(etat.declencheursSource), 'contrôle des déclencheurs : fichier complet');
      // Le backend redémarré n'y applique aucune migration : la base resterait sans ses gardes.
      const sortie = migrer(base);
      assert.ok(sortie.includes(AUCUNE_MIGRATION), `prisma migrate deploy sur la base coupée : ${sortie}`);
      assert.equal(await avec(base, declencheursNonInternes), 0, 'après migrate deploy : toujours aucun déclencheur');
    });

    test('échec franc : la sauvegarde complète restaurée avec -v ON_ERROR_STOP=1 --single-transaction dans une base déjà migrée (backend démarré trop tôt) rend un code non nul et ne change rien ; recréée vide à l’étape 5, la base se restaure', async () => {
      const etat = await etatPrepare();
      const base = nouvelleBase('migree');
      creerMigree(base);
      const avant = await empreinteDe(base);
      const r = guide.restaurer(base, etat.sauvegarde);
      assert.notEqual(r.code, 0, `restauration dans une base migrée : code non nul attendu : ${decrire(r)}`);
      assert.equal(r.code, 3, `psql s’arrête sur l’erreur du script (ON_ERROR_STOP) : ${decrire(r)}`);
      assert.match(r.erreurs, /already exists|existe déjà/, `première erreur : un objet déjà créé par les migrations : ${decrire(r)}`);
      memeEmpreinte(await empreinteDe(base), avant, 'base migrée inchangée : rien n’est écrit');

      // Reprise à l'étape 5 : base recréée vide, puis restaurée.
      for (const etape of [guide.supprimerBase(base), guide.creerBase(base), guide.restaurer(base, etat.sauvegarde)]) assert.equal(etape.code, 0, decrire(etape));
      memeEmpreinte(await empreinteDe(base), etat.empreinteSource, 'après la reprise, base restaurée contre base sauvegardée');
    });

    test('C2, témoin du danger : sans -v ON_ERROR_STOP=1 --single-transaction, la sauvegarde restaurée dans une base migrée rend 0, le journal des paramètres et des droits prend l’instant de la restauration et `_prisma_migrations` double ; la requête des journaux du guide le montre', async () => {
      const etat = await etatPrepare();
      const base = nouvelleBase('temoin');
      creerMigree(base);
      const debut = await instantServeur();
      const r = guide.restaurer(base, etat.sauvegarde, { options: [] });
      assert.equal(r.code, 0, `restauration sans les options : code 0 malgré les erreurs (témoin) : ${decrire(r)}`);
      assert.match(r.erreurs, /ERROR|ERREUR/, 'restauration sans les options : des erreurs, ignorées');
      await avec(base, async (db) => {
        assert.equal(await migrationsAppliquees(db), 2 * migrationsDuDepot(), '_prisma_migrations doublée');
        const { rows } = await db.query(`SELECT "createdAt"::text AS texte, round(extract(epoch FROM ("createdAt" AT TIME ZONE 'UTC')) * 1000)::bigint AS ms FROM "JournalAdministration" WHERE "id" = $1`, [ids.JournalAdministration]);
        assert.equal(rows.length, 1, 'journal des paramètres et des droits : la ligne sans auteur est chargée');
        assert.ok(Number(rows[0].ms) >= debut, `journal des paramètres et des droits : horodatage remplacé par l’instant de la restauration attendu, obtenu ${rows[0].texte}`);
        // Autres affirmations du « Pourquoi » du guide : la ligne du journal des règles est refusée, son déclencheur ne
        // trouvant pas le plan comptable sous le chemin de recherche vide de la sauvegarde ; le compte système et les
        // paramètres de rémunération entrent en conflit avec ceux de la sauvegarde.
        assert.equal((await lignesDe(db, 'JournalRegleComptable')).length, 0, 'journal des règles : ligne refusée');
        assert.match(r.erreurs, /figer_comptes_journal_regle/, 'journal des règles : refus venu de journal_regle_figer_comptes');
        assert.match(r.erreurs, /"User_pkey"/, 'compte système : conflit');
        assert.match(r.erreurs, /"ParametresRemuneration_pkey"/, 'paramètres de rémunération : conflit');
        assert.equal(await nombre(db, `SELECT count(*) AS n FROM "User" WHERE "id" = '${ids.auteur}'`), 0, 'les comptes de la sauvegarde ne sont pas chargés');
      });
      // T4 : la requête du guide le montre, la plus récente date ne précède pas le début de la restauration.
      const journaux = lireJournaux(guide.journaux(base));
      const administration = journaux.find((j) => j.journal === 'JournalAdministration');
      assert.ok(administration.max !== null && enMs(administration.max) >= debut, `requête des journaux du guide : plus récente date ${administration.max} postérieure au début de la restauration`);
      assert.notDeepEqual(journaux, etat.journauxSource, 'requête des journaux du guide : résultat différent de la base sauvegardée');
      // Le contrôle des déclencheurs ne le voit pas : ceux des migrations sont déjà là.
      assert.equal(guide.declencheursEnBase(base).sortie.trim(), guide.declencheursDuFichier(etat.sauvegarde).sortie.trim(), 'contrôle des déclencheurs : égal, sans rien signaler');
    });

    test('T1, erreur tardive avant le premier déclencheur : sans --single-transaction, la base reste chargée sans déclencheurs ni clés étrangères, ce que signale le contrôle des déclencheurs ; avec, la base reste vide', async () => {
      const etat = await etatPrepare();
      assert.equal(guide.controlerFichier(etat.tardive).sortie.trim(), '1', 'le fichier à l’erreur tardive passe le contrôle du fichier');

      // Sans --single-transaction (ON_ERROR_STOP gardé).
      const sansTransaction = nouvelleBase('tardive');
      creerVide(sansTransaction);
      const r1 = guide.restaurer(sansTransaction, etat.tardive, { options: ['-v', 'ON_ERROR_STOP=1'] });
      assert.equal(r1.code, 3, `sans --single-transaction : arrêt sur l’erreur : ${decrire(r1)}`);
      assert.match(r1.erreurs, /division by zero|division par zéro/, decrire(r1));
      await avec(sansTransaction, async (db) => {
        const lignes = await lignesDesJournaux(db);
        for (const journal of JOURNAUX) assert.deepEqual(lignes[journal], etat.lignesSource[journal], `sans --single-transaction : ${journal} chargé`);
        assert.equal(await declencheursNonInternes(db), 0, 'sans --single-transaction : aucun déclencheur');
        assert.equal(await clesEtrangeres(db), 0, 'sans --single-transaction : aucune clé étrangère');
      });
      assert.notEqual(guide.declencheursEnBase(sansTransaction).sortie.trim(), guide.declencheursDuFichier(etat.tardive).sortie.trim(), 'contrôle des déclencheurs : l’écart est signalé');
      // Le backend redémarré n'y appliquerait rien.
      assert.ok(migrer(sansTransaction).includes(AUCUNE_MIGRATION), 'prisma migrate deploy : rien à appliquer sur la base chargée sans déclencheurs');

      // Avec les options retenues : rien n'est écrit.
      const avecTransaction = nouvelleBase('tardive_st');
      creerVide(avecTransaction);
      const r2 = guide.restaurer(avecTransaction, etat.tardive);
      assert.equal(r2.code, 3, `avec --single-transaction : arrêt sur l’erreur : ${decrire(r2)}`);
      assert.match(r2.erreurs, /division by zero|division par zéro/, decrire(r2));
      await avec(avecTransaction, async (db) => {
        assert.equal(await nombre(db, "SELECT count(*) AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace"), 0, 'avec --single-transaction : aucune table, séquence ni index');
        assert.equal(await nombre(db, "SELECT count(*) AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace"), 0, 'avec --single-transaction : aucune fonction');
        assert.equal(await declencheursNonInternes(db), 0, 'avec --single-transaction : aucun déclencheur');
      });
    });

    test('T7 : sauvegarde sous un fuseau (UTC+14) et restauration sous un autre (UTC−10) : chaque date des journaux et toute la base identiques ; la requête des journaux du guide rend les mêmes dates, en UTC, quel que soit le fuseau de sa session', async () => {
      const etat = await etatPrepare();
      const fichier = join(dossier, 'sauvegarde-fuseau.sql');
      const s = guide.sauvegarder(etat.source, fichier, FUSEAU_SAUVEGARDE);
      assert.equal(s.code, 0, `pg_dump sous ${FUSEAU_SAUVEGARDE} : ${decrire(s)}`);
      // Témoin du fuseau : la date avec fuseau de l'envoi est écrite à UTC+14.
      const texte = readFileSync(fichier, 'utf8');
      assert.ok(texte.includes(ENVOI_A_KIRITIMATI), `sauvegarde sous ${FUSEAU_SAUVEGARDE} : « ${ENVOI_A_KIRITIMATI} » attendu`);
      assert.equal(guide.controlerFichier(fichier).sortie.trim(), '1');
      const base = nouvelleBase('fuseau');
      creerVide(base);
      const r = guide.restaurer(base, fichier, { fuseau: FUSEAU_RESTAURATION });
      assert.equal(r.code, 0, `restauration sous ${FUSEAU_RESTAURATION} : ${decrire(r)}`);
      const lignes = await avec(base, lignesDesJournaux);
      for (const journal of JOURNAUX) assert.deepEqual(lignes[journal], etat.lignesSource[journal], `${journal} : chaque ligne, toutes colonnes`);
      verifierJeu(lignes, `base restaurée sous ${FUSEAU_RESTAURATION}`);
      assert.deepEqual(lireJournaux(guide.journaux(base)), etat.journauxSource, 'requête des journaux du guide');
      // « Les dates sont en UTC » : la requête du guide rend les mêmes dates quel que soit le fuseau de sa session
      // (lecture écartée : la date avec fuseau de l'envoi lue sans `AT TIME ZONE 'UTC'`).
      const envoi = etat.journauxSource.find((j) => j.journal === 'EnvoiDocument');
      assert.equal(envoi.max, INSTANTS.EnvoiDocument.replace('T', ' ').replace('+00:00', ''), 'requête du guide : date de l’envoi en UTC');
      assert.deepEqual(lireJournaux(guide.journaux(base, FUSEAU_SAUVEGARDE)), etat.journauxSource, `requête des journaux du guide, session sous ${FUSEAU_SAUVEGARDE}`);
      memeEmpreinte(await empreinteDe(base), etat.empreinteSource, `base restaurée sous ${FUSEAU_RESTAURATION} contre base sauvegardée`);
    });
  });
}
