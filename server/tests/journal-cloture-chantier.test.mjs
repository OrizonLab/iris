// Lot AG-b (#451, suites) : la clôture et la réouverture d'un chantier s'inscrivent au journal de la fiche chantier
// (cadrage du lot AG-b du 26-11-2026, sections « Périmètre », « Critères métier observables » et « Tests »).
//
// Décision appliquée, mot pour mot. Question posée par Claude Code le 26-11-2026 : « Clôture et réouverture d'un
// chantier : aujourd'hui, elles ne laissent aucune trace au journal. Pourtant, la clôture pose la date de fin, qui fixe le
// mois du chiffre d'affaires validé. Faut-il les journaliser ? A. Oui (recommandé) : on les inscrit au journal de la fiche
// chantier, avec l'auteur, la date, et le statut et la date de fin avant et après, comme les réattributions et
// l'encaissement. B. Non : on garde le comportement actuel. » Conséquence annoncée de A : « un compte qui a clôturé un
// chantier devient auteur d'une trace et ne pourra plus être supprimé, seulement désactivé, comme aujourd'hui pour les
// autres changements journalisés. » Réponse de Nelson du 26-11-2026 à 21:34:57 UTC (point 1 de son message) : « 1. A ».
//
// Cadrage, périmètre 1 : PATCH /api/chantiers/:id/statut, dans la transaction et sous le verrou, après les refus
// inchangés :
//  - si `statut` et `dateFin` ne changent pas (administration seule : reclôture d'un chantier terminé daté, EN_COURS sur
//    un chantier en cours), ni entrée ni réécriture : la route renvoie la ligne telle quelle, comme l'encaissement (C4 du
//    contrôle de mode 1) ;
//  - sinon, une entrée de JournalSaisieChantier, cible CHANTIER, action CHANGEMENT_STATUT, dans la même transaction que
//    la mise à jour (« sans la trace, le changement n'a pas lieu », #181) ; avant = { statut, dateFin } lus sur la ligne
//    verrouillée, après = { statut, dateFin } écrits ; dateFin en ISO (toISOString()) ou null ; auteur et nom figés à
//    l'acte (compte en session ; une clé d'intégration reçoit 401 sur cette route) ;
//  - un chantier terminé sans date de fin que l'administration reclôt reçoit sa date : vrai changement, journalisé (C4).
// Critères : clôture par les titulaires CT, RESP, DC, AC, CPT, par le responsable de la branche d'un technicien titulaire
// et par l'administration (SA, AD, DIR ; AD-COM en plus, administrateur aussi commercial) ; réouverture par
// l'administration ; une demande qui ne change rien n'écrit rien ; un refus (404, 403, 409, 400) n'écrit rien ; un compte
// qui a clôturé un chantier ne peut plus être supprimé (409 « auteur de données tracées »), seulement désactivé.
//
// La date de fin fixe le mois du chiffre d'affaires validé (commissions/metier.ts, dateClotureChantier) : sa trace touche
// un montant (règle 2). Chaque refus et chaque demande sans changement sont prouvés sans aucune écriture : empreinte de
// toute la base (chaque table du schéma public, contenu compris, `updatedAt` du chantier compris), relue après l'appel ;
// chaque écriture admise, par la liste exacte des tables changées (Chantier et JournalSaisieChantier, rien d'autre) et
// par le contenu exact de l'entrée. Les dates de fin saisies (15-10-2026, 15-12-2025, 20-06-2025) sont distinctes entre
// elles et antérieures au jour de tout passage (26-11-2026 au plus tôt) : une date du jour écrite à la place d'une date
// gardée, ou l'inverse, se voit.
//
// Fichier propre au lot, avec sa base jetable : `node --test` exécute les fichiers en parallèle, et api.test.mjs, qui
// tourne en même temps sur TEST_DATABASE_URL, purge les données « TEST » ; les déclencheurs posés par le test d'atomicité
// ne doivent pas toucher les autres fichiers. TEST_DATABASE_URL ne sert ici que de connexion administrative : une base
// neuve est créée, migrée (`prisma migrate deploy`), servie à l'application montée en mémoire, puis supprimée (retentée
// dans un `finally`, comme #552). Sans TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';

const TITRE = 'Lot AG-b : clôture et réouverture d’un chantier inscrites au journal de la fiche chantier (décision de Nelson du 26-11-2026, « 1. A »)';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// Refus existants, mot pour mot (apostrophe typographique) : le lot ne les change pas (cadrage : « après les refus
// inchangés »).
const REFUS = {
  introuvable: 'Chantier introuvable',
  statutInvalide: 'Statut invalide.',
  statutAnnulee: 'Cette affaire est annulée : son statut ne change plus.',
  dejaCloture: 'Ce chantier est déjà clôturé.',
  reouverture: 'Seul un administrateur peut réouvrir un chantier clôturé.',
  technicienCloture: 'Un compte technicien n’est pas autorisé à clôturer une affaire : la clôture revient à un compte Responsable de sa branche, à la direction ou à l’administration.',
  assistanteStatut: 'Un compte assistante technique n’est pas autorisé à clôturer ni à rouvrir une affaire.',
  compteCommercial: 'Accès non autorisé pour un compte commercial.',
  authentification: 'Authentification requise',
  session: 'Session expirée ou invalide',
  auteurTrace: 'Ce compte est l’auteur de données tracées : le supprimer effacerait une preuve de traçabilité. Désactivez-le plutôt pour lui retirer l’accès.',
};
// Cadrage, critères : « titulaires CT, RESP, DC, AC, CPT » (la route ne ferme que le commercial, le technicien et
// l'assistante technique).
const TITULAIRES = [['CT', 'CONDUCTEUR_TRAVAUX'], ['RESP', 'RESPONSABLE'], ['DC', 'DIRECTEUR_COMMERCIAL'], ['AC', 'ASSISTANTE_COMMERCIALE'], ['CPT', 'COMPTABLE']];

// Valeurs de départ d'un chantier de test. Dates de fin saisies : passées, jamais le jour d'un passage.
const DEPART = {
  budgetGlobalVendu: '1234.56', budgetMaterielVendu: '345.67', budgetMainOeuvreVendu: '456.78', heuresVendues: '12.34',
  dateDebut: new Date('2026-09-01T00:00:00.000Z'), adresse: 'TEST 1 rue de la clôture journalisée', types: ['Alarme'],
};
const DATE_FIN = new Date('2026-10-15T00:00:00.000Z');
const SAISIE = new Date('2025-12-15T00:00:00.000Z');
const SAISIE_EN_COURS = new Date('2025-06-20T00:00:00.000Z');
const FUSEAU = 'Europe/Paris';

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_agb_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;

    let request; let app; let prisma; let appPrisma; let jwt; let jourCivilEntreprise;
    let session = '';
    let secours = { id: '', name: '' };
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const admin = () => entete(session);
    let rang = 0;
    const suffixe = () => `${Date.now()}${(rang += 1)}`;
    const comptes = {};

    const creerCompte = async (role, cle, extra = {}) => {
      const s = suffixe();
      const compte = await prisma.user.create({ data: { email: `agb.${cle.toLowerCase()}.${s}@iris.test`, name: `TEST ${cle} ${s}`, role, ...extra } });
      return { ...compte, auth: entete(jwt.sign({ id: compte.id }, process.env.JWT_SECRET)) };
    };
    // Administration : super administrateur (secours), administrateur, administrateur aussi commercial, directeur
    // (aligné sur l'administration, décision de Nelson du 24-10-2026, point 14).
    const ADMINISTRATION = () => [
      ['SA', admin(), secours], ['AD', comptes.AD.auth, comptes.AD], ['AD-COM', comptes['AD-COM'].auth, comptes['AD-COM']], ['DIR', comptes.DIR.auth, comptes.DIR],
    ];

    // --- Appels ---
    const appeler = (methode, chemin, corps, auth = admin()) => request(app)[methode](`/api${chemin}`).set(auth).send(corps ?? {});
    const ok = async (reponse, statut = 200) => {
      const res = await reponse;
      assert.equal(res.status, statut, `${res.req?.method} ${res.req?.path} : ${JSON.stringify(res.body)}`);
      return res.body;
    };
    const changerStatut = (id, corps, auth = admin()) => appeler('patch', `/chantiers/${id}/statut`, corps, auth);

    // --- État de la base ---
    // Empreinte de toute la base : chaque table du schéma public (hors historique des migrations), nombre de lignes et
    // empreinte de leur contenu, en une seule requête (tables relevées une fois : le schéma ne change pas).
    const sqlEmpreinte = (table) => `SELECT '${table}' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${table}" x`;
    const empreinteTable = async (client, table) => {
      const [{ n, h }] = await client.$queryRawUnsafe(sqlEmpreinte(table));
      return `${n}:${h}`;
    };
    let requeteEmpreinte = null;
    const empreinte = async (client = prisma) => {
      if (!requeteEmpreinte) {
        const tables = (await client.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`).map((t) => t.tablename);
        assert.ok(tables.includes('Chantier') && tables.includes('JournalSaisieChantier') && tables.includes('User') && tables.length > 40, `tables relevées : ${tables.join(', ')}`);
        assert.ok(tables.every((table) => /^[A-Za-z_]+$/.test(table)), 'noms de tables sans guillemet');
        requeteEmpreinte = tables.map(sqlEmpreinte).join(' UNION ALL ');
      }
      return Object.fromEntries((await client.$queryRawUnsafe(requeteEmpreinte)).map(({ t, n, h }) => [t, `${n}:${h}`]));
    };
    const tablesChangees = (avant, apres) => Object.keys({ ...avant, ...apres }).filter((t) => avant[t] !== apres[t]).sort();
    const journal = (chantierId) => prisma.journalSaisieChantier.findMany({ where: { chantierId }, orderBy: { createdAt: 'asc' } });
    const ligne = (id) => prisma.chantier.findUniqueOrThrow({ where: { id } });
    // Jour civil de la société, à minuit UTC, comme toute date-seule stockée (dateFin). Relevé avant et après l'appel :
    // un passage à minuit pendant l'appel admet l'un ou l'autre.
    const jourSociete = () => `${jourCivilEntreprise(new Date(), FUSEAU)}T00:00:00.000Z`;
    // Une entrée telle que le lot l'écrit : tous ses champs hors identifiant et horodatage (imposé par la base, #582).
    const contenu = (e) => ({
      chantierId: e.chantierId, interventionId: e.interventionId, contratMaintenanceId: e.contratMaintenanceId, cible: e.cible, cibleId: e.cibleId,
      action: e.action, auteurId: e.auteurId, auteurNom: e.auteurNom, avant: e.avant, apres: e.apres, motif: e.motif,
    });
    const attendue = (chantierId, auteur, avant, apres) => ({
      chantierId, interventionId: null, contratMaintenanceId: null, cible: 'CHANTIER', cibleId: chantierId,
      action: 'CHANGEMENT_STATUT', auteurId: auteur.id, auteurNom: auteur.name, avant, apres, motif: null,
    });
    const iso = (date) => (date ? date.toISOString() : null);

    // Un refus, ou une demande admise qui ne doit rien écrire (`message` vaut alors `undefined`) : statut attendu, message
    // exact, empreinte de toute la base inchangée et journal du chantier inchangé.
    const sansEcriture = async (appel, statut, message, quoi, chantierId) => {
      const avant = await empreinte();
      const journalAvant = chantierId ? (await journal(chantierId)).length : 0;
      const res = await appel();
      assert.equal(res.status, statut, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      if (message !== undefined) assert.equal(res.body.error, message, quoi);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      if (chantierId) assert.equal((await journal(chantierId)).length, journalAvant, `${quoi} : aucune entrée de journal`);
      return res;
    };
    // Un changement de statut admis : 200, seules les tables Chantier et JournalSaisieChantier changent, une seule entrée
    // nouvelle au journal du chantier. Rend l'entrée, la ligne relue, la réponse et les jours de la société relevés.
    const ecrit = async (appel, quoi, chantierId) => {
      const avant = await empreinte();
      const journalAvant = await journal(chantierId);
      const jours = [jourSociete()];
      const res = await appel();
      jours.push(jourSociete());
      assert.equal(res.status, 200, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(tablesChangees(avant, await empreinte()), ['Chantier', 'JournalSaisieChantier'], `${quoi} : seuls le chantier et son journal sont écrits`);
      const entrees = await journal(chantierId);
      assert.equal(entrees.length, journalAvant.length + 1, `${quoi} : une seule entrée nouvelle`);
      const anciens = new Set(journalAvant.map((e) => e.id));
      const [entree] = entrees.filter((e) => !anciens.has(e.id));
      return { res, entree, relu: await ligne(chantierId), jours };
    };
    // Date de fin posée par la clôture : le jour de la société, à minuit UTC.
    const dateDuJour = (relu, jours, quoi) => {
      assert.ok(relu.dateFin instanceof Date, `${quoi} : date de fin posée`);
      assert.ok(jours.includes(relu.dateFin.toISOString()), `${quoi} : date de fin ${relu.dateFin.toISOString()} au jour de la société (${jours.join(' ou ')})`);
      assert.ok(![iso(DATE_FIN), iso(SAISIE), iso(SAISIE_EN_COURS)].includes(relu.dateFin.toISOString()), `${quoi} : jour du passage distinct des dates saisies du test`);
      return relu.dateFin.toISOString();
    };

    // --- Données ---
    const creerChantier = (extra = {}) => prisma.chantier.create({ data: {
      nom: `TEST Chantier AG-b ${suffixe()}`, client: 'TEST Client AG-b', ...DEPART,
      responsableId: comptes.CT.id, commercialId: comptes.COM.id, ...extra,
    } });
    const ANNULATION = () => ({ statut: 'ANNULE', annuleLe: new Date('2026-10-20T08:00:00.000Z'), annuleParId: secours.id, motifAnnulation: 'TEST annulation posée en base' });

    // Une transaction de test tient la ligne du chantier (FOR UPDATE) : la requête part, attend ce verrou (constaté par
    // pg_blocking_pids), puis la transaction change la ligne directement en base et valide. L'état attendu après la
    // réponse est relevé dans la transaction : toute la base avant le départ de la requête, puis la table des chantiers
    // une fois changée. Modèle : `sousVerrou` de chantier-annule-termine.test.mjs.
    const sousVerrou = async (chantierId, lancer, changer) => {
      let reponse; let attendu;
      await prisma.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        await tx.$queryRaw`SELECT "id" FROM "Chantier" WHERE "id" = ${chantierId} FOR UPDATE`;
        attendu = await empreinte(tx);
        reponse = lancer().then((r) => r);
        let attente = false;
        for (let tour = 0; tour < 300 && !attente; tour += 1) {
          attente = (await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`)[0].n > 0;
          if (!attente) await new Promise((r) => setTimeout(r, 20));
        }
        assert.equal(attente, true, 'la requête attend la ligne du chantier');
        await changer(tx);
        attendu.Chantier = await empreinteTable(tx, 'Chantier');
      }, { timeout: 30_000, maxWait: 10_000 });
      return { res: await reponse, attendu };
    };

    before(async () => {
      assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname), 'seul un PostgreSQL local est autorisé');
      assert.notEqual(source.pathname.slice(1), nomBase);
      await administrationPg.connect();
      await administrationPg.query(`CREATE DATABASE "${nomBase}"`);
      baseCreee = true;
      const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');
      execFileSync(resolve(dossierServeur, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', resolve(dossierServeur, 'prisma/schema.prisma')], {
        env: { ...process.env, DATABASE_URL: cible.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
      });
      process.env.DATABASE_URL = cible.toString();
      process.env.NODE_ENV = 'test';
      process.env.JWT_SECRET = 'secret-de-test-uniquement';
      process.env.BREAK_GLASS_EMAIL = 'secours@iris.test';
      process.env.BREAK_GLASS_TOKEN = 'jeton-de-secours-de-test-au-moins-32-caracteres';
      process.env.SUPERADMIN_EMAILS = 'secours@iris.test';
      request = (await import('supertest')).default;
      const serveur = await import('../dist/index.js');
      app = serveur.app;
      appPrisma = serveur.prisma;
      jourCivilEntreprise = serveur.jourCivilEntreprise;
      assert.equal(typeof jourCivilEntreprise, 'function', 'jourCivilEntreprise exportée par le serveur');
      const { PrismaClient } = await import('@prisma/client');
      prisma = new PrismaClient({ datasources: { db: { url: cible.toString() } } });
      jwt = (await import('jsonwebtoken')).default;
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      session = connexion.body.token;
      secours = await prisma.user.findUniqueOrThrow({ where: { email: 'secours@iris.test' }, select: { id: true, name: true, role: true } });
      assert.equal(secours.role, 'SUPERADMIN', 'le compte de secours est super administrateur');
      // Identité de la société, fuseau compris : la clôture date le chantier du jour civil de la société.
      await ok(appeler('put', '/company', { raisonSociale: 'TEST Émetteur lot AG-b', siret: '45145145100045', adresse: '45 rue de la Clôture', codePostal: '14000', ville: 'Caen', fuseauHoraire: FUSEAU }));
      comptes.AD = await creerCompte('ADMIN', 'AD');
      comptes['AD-COM'] = await creerCompte('ADMIN', 'AD-COM', { estCommercial: true });
      for (const [cle, role] of [...TITULAIRES, ['CT2', 'CONDUCTEUR_TRAVAUX'], ['TECH', 'TECHNICIEN'], ['COM', 'COMMERCIAL'], ['AT', 'ASSISTANTE_TECHNIQUE'], ['DIR', 'DIRECTEUR']]) {
        comptes[cle] = await creerCompte(role, cle);
      }
      comptes['TECH-BRANCHE'] = await creerCompte('TECHNICIEN', 'TECH-BRANCHE', { responsableHierarchiqueId: comptes.RESP.id });
    });

    after(async () => {
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      try {
        if (baseCreee) {
          for (let essai = 1; ; essai += 1) {
            try { await administrationPg.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`); break; } catch (erreur) {
              if (essai >= 5) throw erreur;
              await new Promise((r) => setTimeout(r, 500 * essai));
            }
          }
        }
      } finally {
        await administrationPg.end().catch(() => {});
      }
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Clôture (critère : « Une clôture (titulaires CT, RESP, DC, AC, CPT ; responsable de la branche d'un technicien
    // titulaire ; administration SA, AD, DIR) […] écri[t] une entrée au journal du chantier : auteur, statut et date de fin
    // avant et après »).
    // ------------------------------------------------------------------------------------------------------------------

    // Contenu exact de l'entrée, pour chaque titulaire qui clôture et pour le responsable de la branche d'un technicien
    // titulaire, qui clôture en tiers. Écarte : une clôture sans entrée (comportement d'avant le lot) ; une entrée au nom
    // du titulaire du chantier plutôt que du compte qui agit (le responsable de branche n'est pas titulaire) ; un « avant »
    // pris sur l'« après » ; une date de fin d'après prise à l'instant de l'appel (Date ISO avec heure) plutôt que la date
    // écrite (minuit UTC du jour de la société) ; une date sous un autre format que l'ISO (`'2026-11-26'`, objet Date) ;
    // un instantané qui emporterait d'autres champs du chantier (budgets : montants), écarté par l'égalité stricte des
    // clés ; une autre table écrite (journal d'administration, par exemple).
    test('clôture par chaque titulaire (CT, RESP, DC, AC, CPT) et par le responsable de la branche d’un technicien titulaire : une entrée CHANTIER CHANGEMENT_STATUT à son nom, de « en cours » sans date de fin à « terminé » daté du jour de la société, et rien d’autre d’écrit', async () => {
      const cas = [
        ...TITULAIRES.map(([cle]) => [`${cle} titulaire`, comptes[cle].id, comptes[cle]]),
        ['RESP, responsable de la branche du technicien titulaire', comptes['TECH-BRANCHE'].id, comptes.RESP],
      ];
      for (const [quoi, responsableId, auteur] of cas) {
        const chantier = await creerChantier({ responsableId });
        const { res, entree, relu, jours } = await ecrit(() => changerStatut(chantier.id, { statut: 'TERMINE' }, auteur.auth), quoi, chantier.id);
        const jour = dateDuJour(relu, jours, quoi);
        assert.equal(relu.statut, 'TERMINE', quoi);
        assert.deepEqual(contenu(entree), attendue(chantier.id, auteur, { statut: 'EN_COURS', dateFin: null }, { statut: 'TERMINE', dateFin: jour }), quoi);
        assert.equal(typeof entree.apres.dateFin, 'string', `${quoi} : date de fin en chaîne ISO`);
        assert.deepEqual([res.body.id, res.body.statut, res.body.dateFin], [chantier.id, 'TERMINE', jour], `${quoi} : réponse`);
      }
    });

    // Même contenu pour chaque compte de l'administration, sur le chantier d'un conducteur. Le nom figé de l'entrée du
    // super administrateur est celui du compte de secours. Écarte une entrée réservée aux titulaires, ou au nom du
    // titulaire du chantier (CT) plutôt que de l'administrateur qui clôture.
    test('clôture par l’administration (SA, AD, AD-COM, DIR) d’un chantier en cours : une entrée à son nom, de « en cours » à « terminé » daté du jour de la société', async () => {
      for (const [quoi, auth, auteur] of ADMINISTRATION()) {
        const chantier = await creerChantier();
        const { entree, relu, jours } = await ecrit(() => changerStatut(chantier.id, { statut: 'TERMINE' }, auth), quoi, chantier.id);
        const jour = dateDuJour(relu, jours, quoi);
        assert.deepEqual(contenu(entree), attendue(chantier.id, auteur, { statut: 'EN_COURS', dateFin: null }, { statut: 'TERMINE', dateFin: jour }), quoi);
        assert.notEqual(entree.auteurId, comptes.CT.id, `${quoi} : l’auteur n’est pas le titulaire`);
      }
    });

    // Date de fin déjà saisie (règle de la clôture inchangée : elle est gardée) : l'entrée la porte des deux côtés, à
    // l'identique. Écarte : un « après » qui prendrait toujours le jour de la clôture, alors que la ligne garde la date
    // saisie (la trace contredirait le mois du CA validé) ; un « avant » toujours sans date de fin.
    test('clôture d’un chantier dont la date de fin est déjà saisie, par son titulaire et par l’administration : l’entrée porte la date saisie des deux côtés, et non le jour de la clôture', async () => {
      for (const [quoi, auteur] of [['CT titulaire', comptes.CT], ['AD', comptes.AD], ['DIR', comptes.DIR]]) {
        const chantier = await creerChantier({ dateFin: SAISIE });
        const { entree, relu } = await ecrit(() => changerStatut(chantier.id, { statut: 'TERMINE' }, auteur.auth), quoi, chantier.id);
        assert.deepEqual([relu.statut, iso(relu.dateFin)], ['TERMINE', iso(SAISIE)], quoi);
        assert.deepEqual(contenu(entree), attendue(chantier.id, auteur, { statut: 'EN_COURS', dateFin: '2025-12-15T00:00:00.000Z' }, { statut: 'TERMINE', dateFin: '2025-12-15T00:00:00.000Z' }), quoi);
      }
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Réouverture (critère : « une réouverture (administration) écri[t] une entrée au journal du chantier »).
    // ------------------------------------------------------------------------------------------------------------------

    // La réouverture garde la date de fin (règle inchangée, taux-horaire-et-cloture.test.mjs) : l'entrée la porte des
    // deux côtés ; un chantier terminé sans date de fin rouvert n'en a d'aucun côté. Écarte : une réouverture sans entrée ;
    // un « après » sans date de fin alors que la ligne la garde ; un avant et un après inversés ; une date du jour posée
    // à la réouverture.
    test('réouverture par l’administration (SA, AD, AD-COM, DIR) : une entrée à son nom, de « terminé » à « en cours », la date de fin gardée des deux côtés ; terminé sans date de fin : sans date des deux côtés', async () => {
      for (const [quoi, auth, auteur] of ADMINISTRATION()) {
        const date = await creerChantier({ statut: 'TERMINE', dateFin: DATE_FIN });
        let ecriture = await ecrit(() => changerStatut(date.id, { statut: 'EN_COURS' }, auth), `${quoi}, terminé daté`, date.id);
        assert.deepEqual([ecriture.relu.statut, iso(ecriture.relu.dateFin)], ['EN_COURS', iso(DATE_FIN)], quoi);
        assert.deepEqual(contenu(ecriture.entree), attendue(date.id, auteur, { statut: 'TERMINE', dateFin: '2026-10-15T00:00:00.000Z' }, { statut: 'EN_COURS', dateFin: '2026-10-15T00:00:00.000Z' }), `${quoi}, terminé daté`);
        assert.deepEqual([ecriture.res.body.statut, ecriture.res.body.dateFin], ['EN_COURS', '2026-10-15T00:00:00.000Z'], `${quoi} : réponse`);
        const sansDate = await creerChantier({ statut: 'TERMINE' });
        ecriture = await ecrit(() => changerStatut(sansDate.id, { statut: 'EN_COURS' }, auth), `${quoi}, terminé sans date de fin`, sansDate.id);
        assert.deepEqual([ecriture.relu.statut, ecriture.relu.dateFin], ['EN_COURS', null], quoi);
        assert.deepEqual(contenu(ecriture.entree), attendue(sansDate.id, auteur, { statut: 'TERMINE', dateFin: null }, { statut: 'EN_COURS', dateFin: null }), `${quoi}, terminé sans date de fin`);
      }
    });

    // Parcours réel : le conducteur clôture, l'administration rouvre, le conducteur reclôt. Trois entrées enchaînées, dans
    // l'ordre des actes, chaque « avant » égal à l'« après » précédent ; la date posée à la première clôture est gardée
    // par la réouverture et par la reclôture. Écarte un « avant » qui ne serait pas relu sur la ligne (par exemple
    // toujours « en cours » sans date à la clôture, ou « terminé » à la réouverture sans sa date).
    test('clôture par le conducteur, réouverture par l’administration, reclôture par le conducteur : trois entrées enchaînées, chaque « avant » égal à l’« après » précédent, la date de la première clôture gardée', async () => {
      const chantier = await creerChantier();
      const premiere = await ecrit(() => changerStatut(chantier.id, { statut: 'TERMINE' }, comptes.CT.auth), 'clôture', chantier.id);
      const jour = dateDuJour(premiere.relu, premiere.jours, 'clôture');
      await ecrit(() => changerStatut(chantier.id, { statut: 'EN_COURS' }, comptes.AD.auth), 'réouverture', chantier.id);
      await ecrit(() => changerStatut(chantier.id, { statut: 'TERMINE' }, comptes.CT.auth), 'reclôture', chantier.id);
      const entrees = (await journal(chantier.id)).map(contenu);
      assert.deepEqual(entrees, [
        attendue(chantier.id, comptes.CT, { statut: 'EN_COURS', dateFin: null }, { statut: 'TERMINE', dateFin: jour }),
        attendue(chantier.id, comptes.AD, { statut: 'TERMINE', dateFin: jour }, { statut: 'EN_COURS', dateFin: jour }),
        attendue(chantier.id, comptes.CT, { statut: 'EN_COURS', dateFin: jour }, { statut: 'TERMINE', dateFin: jour }),
      ]);
      const relu = await ligne(chantier.id);
      assert.deepEqual([relu.statut, iso(relu.dateFin)], ['TERMINE', jour]);
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Demande sans changement, et reclôture d'un chantier terminé sans date (cadrage : « ni entrée ni réécriture » ; C4).
    // ------------------------------------------------------------------------------------------------------------------

    // Cadrage, périmètre 1 : « si `statut` et `dateFin` ne changent pas […], ni entrée ni réécriture : la route renvoie la
    // ligne telle quelle, comme l'encaissement ». Par chaque compte de l'administration (seule à pouvoir le demander), sur
    // un chantier terminé et daté (TERMINE), terminé, daté et encaissé (TERMINE), en cours sans date de fin (EN_COURS) et
    // en cours avec une date de fin saisie (EN_COURS). Écarte : une entrée écrite à l'identique (avant = après) ; une
    // réécriture du chantier (son `updatedAt` est la date de clôture de repli du résultat commercial) ; une date du jour
    // posée sur un chantier en cours daté ou terminé daté ; un refus (403 ou 409) de la demande identique.
    test('demande de l’administration qui ne change rien (TERMINE sur un chantier terminé et daté, encaissé ou non ; EN_COURS sur un chantier en cours, avec ou sans date de fin) : 200, la ligne rendue telle quelle, ni entrée ni réécriture (empreinte de toute la base)', async () => {
      const etats = [
        ['terminé et daté, TERMINE', { statut: 'TERMINE', dateFin: DATE_FIN }, 'TERMINE'],
        ['terminé, daté et encaissé, TERMINE', { statut: 'TERMINE', dateFin: DATE_FIN, encaisse: true, dateEncaissement: new Date('2026-10-20T09:00:00.000Z') }, 'TERMINE'],
        ['en cours sans date de fin, EN_COURS', {}, 'EN_COURS'],
        ['en cours avec une date de fin saisie, EN_COURS', { dateFin: SAISIE_EN_COURS }, 'EN_COURS'],
      ];
      for (const [compte, auth] of ADMINISTRATION()) {
        for (const [etat, depart, statut] of etats) {
          const chantier = await creerChantier(depart);
          const quoi = `${compte}, chantier ${etat}`;
          const res = await sansEcriture(() => changerStatut(chantier.id, { statut }, auth), 200, undefined, quoi, chantier.id);
          assert.deepEqual([res.body.id, res.body.statut, res.body.dateFin ?? null], [chantier.id, depart.statut ?? 'EN_COURS', iso(depart.dateFin ?? null)], `${quoi} : ligne rendue telle quelle`);
          assert.equal((await journal(chantier.id)).length, 0, quoi);
        }
      }
    });

    // Cadrage, périmètre 1 : « Un chantier terminé sans date de fin que l'administration reclôt reçoit sa date : vrai
    // changement, journalisé (C4). » Écarte : une comparaison sur le seul statut (TERMINE = TERMINE : ni date ni entrée,
    // le chantier resterait terminé sans mois de CA validé) ; une date posée sans entrée.
    test('reclôture par l’administration (SA, AD, AD-COM, DIR) d’un chantier terminé sans date de fin : la date du jour est posée, et l’entrée la journalise (de « terminé » sans date à « terminé » daté)', async () => {
      for (const [quoi, auth, auteur] of ADMINISTRATION()) {
        const chantier = await creerChantier({ statut: 'TERMINE' });
        const { entree, relu, jours } = await ecrit(() => changerStatut(chantier.id, { statut: 'TERMINE' }, auth), quoi, chantier.id);
        const jour = dateDuJour(relu, jours, quoi);
        assert.equal(relu.statut, 'TERMINE', quoi);
        assert.deepEqual(contenu(entree), attendue(chantier.id, auteur, { statut: 'TERMINE', dateFin: null }, { statut: 'TERMINE', dateFin: jour }), quoi);
      }
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Refus (critère : « Un refus (404, 403, 409, 400) n'écrit rien (empreinte de toute la base) »).
    // ------------------------------------------------------------------------------------------------------------------

    // Chaque refus de la route, avec son message inchangé, sans entrée ni écriture. Écarte une entrée écrite avant les
    // refus (trace d'une clôture qui n'a pas lieu), notamment avant ceux relus sous le verrou (409, 403).
    test('chaque refus n’écrit rien, ni entrée ni chantier (empreinte de toute la base) : 404 (inexistant, hors du périmètre), 403 (technicien, assistante technique, commercial, titulaire qui rouvre ou reclôt), 409 (affaire annulée), 400 (statut invalide), 401 (sans session, clé d’intégration)', async () => {
      const enCours = await creerChantier();
      const termine = await creerChantier({ statut: 'TERMINE', dateFin: DATE_FIN });
      const deTechnicien = await creerChantier({ responsableId: comptes.TECH.id });
      const deLAssistante = await creerChantier({ responsableId: comptes.AT.id });
      const annule = await creerChantier(ANNULATION());
      const annuleDate = await creerChantier({ ...ANNULATION(), dateFin: DATE_FIN });
      const inexistant = '00000000-0000-0000-0000-000000000000';
      const cle = await ok(appeler('post', '/admin/api-keys', { nom: `TEST Clé lot AG-b ${suffixe()}`, scopes: ['chantiers:read', 'chantiers:write', 'chantiers:archive', 'finances:read'] }), 201);
      const cas = [
        ['404, chantier inexistant, CT', inexistant, 'TERMINE', comptes.CT.auth, 404, REFUS.introuvable],
        ['404, chantier inexistant, administration', inexistant, 'TERMINE', admin(), 404, REFUS.introuvable],
        ['404, autre conducteur', enCours.id, 'TERMINE', comptes.CT2.auth, 404, REFUS.introuvable],
        ['404, responsable hors de sa branche', enCours.id, 'TERMINE', comptes.RESP.auth, 404, REFUS.introuvable],
        ['404, directeur commercial non titulaire', enCours.id, 'TERMINE', comptes.DC.auth, 404, REFUS.introuvable],
        ['403, technicien titulaire', deTechnicien.id, 'TERMINE', comptes.TECH.auth, 403, REFUS.technicienCloture],
        ['403, assistante technique titulaire', deLAssistante.id, 'TERMINE', comptes.AT.auth, 403, REFUS.assistanteStatut],
        ['403, assistante technique, chantier d’un conducteur', enCours.id, 'TERMINE', comptes.AT.auth, 403, REFUS.assistanteStatut],
        ['403, compte commercial', enCours.id, 'TERMINE', comptes.COM.auth, 403, REFUS.compteCommercial],
        ['403, titulaire qui rouvre', termine.id, 'EN_COURS', comptes.CT.auth, 403, REFUS.reouverture],
        ['403, titulaire qui demande EN_COURS sur son chantier en cours', enCours.id, 'EN_COURS', comptes.CT.auth, 403, REFUS.reouverture],
        ['403, titulaire qui reclôt', termine.id, 'TERMINE', comptes.CT.auth, 403, REFUS.dejaCloture],
        ['409, affaire annulée, clôture par l’administration', annule.id, 'TERMINE', admin(), 409, REFUS.statutAnnulee],
        ['409, affaire annulée datée, réouverture par l’administration', annuleDate.id, 'EN_COURS', comptes.DIR.auth, 409, REFUS.statutAnnulee],
        ['409, affaire annulée, clôture par le titulaire', annule.id, 'TERMINE', comptes.CT.auth, 409, REFUS.statutAnnulee],
        ['400, statut ANNULE, administration', enCours.id, 'ANNULE', admin(), 400, REFUS.statutInvalide],
        ['400, statut en minuscules, titulaire', enCours.id, 'termine', comptes.CT.auth, 400, REFUS.statutInvalide],
        ['400, statut absent, administration', termine.id, undefined, comptes.AD.auth, 400, REFUS.statutInvalide],
        ['401, sans session', enCours.id, 'TERMINE', {}, 401, REFUS.authentification],
        ['401, jeton invalide', enCours.id, 'TERMINE', entete('jeton-invalide'), 401, REFUS.session],
        ['401, clé d’intégration (portées des chantiers et des finances)', enCours.id, 'TERMINE', entete(cle.apiKey), 401, REFUS.session],
        ['401, clé d’intégration, réouverture', termine.id, 'EN_COURS', entete(cle.apiKey), 401, REFUS.session],
      ];
      for (const [quoi, id, statut, auth, code, message] of cas) {
        await sansEcriture(() => changerStatut(id, statut === undefined ? {} : { statut }, auth), code, message, quoi, id === inexistant ? undefined : id);
      }
      for (const [chantier, statut, dateFin] of [[enCours, 'EN_COURS', null], [termine, 'TERMINE', iso(DATE_FIN)], [deTechnicien, 'EN_COURS', null], [deLAssistante, 'EN_COURS', null], [annule, 'ANNULE', null], [annuleDate, 'ANNULE', iso(DATE_FIN)]]) {
        const relu = await ligne(chantier.id);
        assert.deepEqual([relu.statut, iso(relu.dateFin)], [statut, dateFin], chantier.nom);
        assert.equal((await journal(chantier.id)).length, 0, chantier.nom);
      }
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Ligne verrouillée et transaction (cadrage : « dans la transaction, sous le verrou » ; « avant = { statut, dateFin }
    // lus sur la ligne verrouillée » ; « sans la trace, le changement n'a pas lieu »).
    // ------------------------------------------------------------------------------------------------------------------

    // La requête attend la ligne pendant qu'une transaction la change. Écarte : un « avant » pris sur la lecture d'avant
    // le verrou (il dirait « en cours » sans date de fin) ; une comparaison « rien ne change » faite sur cette lecture (une
    // reclôture devenue identique écrirait une entrée et réécrirait la ligne, ou une date posée pendant l'attente serait
    // ignorée).
    test('course : la ligne change pendant l’attente du verrou ; l’« avant » est celui de la ligne verrouillée, et une demande devenue identique n’écrit rien', async () => {
      // Clôturé et daté pendant l'attente de la clôture de l'administration : demande devenue identique, ni entrée ni écriture.
      const devenuIdentique = await creerChantier();
      const course = await sousVerrou(devenuIdentique.id, () => changerStatut(devenuIdentique.id, { statut: 'TERMINE' }, comptes.AD.auth), (tx) => tx.chantier.update({ where: { id: devenuIdentique.id }, data: { statut: 'TERMINE', dateFin: DATE_FIN } }));
      assert.equal(course.res.status, 200, JSON.stringify(course.res.body));
      assert.deepEqual([course.res.body.statut, course.res.body.dateFin], ['TERMINE', iso(DATE_FIN)], 'ligne rendue telle que la transaction l’a laissée');
      assert.deepEqual(tablesChangees(course.attendu, await empreinte()), [], 'demande devenue identique : rien n’est écrit');
      assert.equal((await journal(devenuIdentique.id)).length, 0);

      for (const [quoi, auteur, changement, avant, apres] of [
        // Date de fin saisie pendant l'attente : gardée, et lue des deux côtés de l'entrée.
        ['clôture par l’administration, date de fin saisie pendant l’attente', comptes.AD, { dateFin: SAISIE }, { statut: 'EN_COURS', dateFin: iso(SAISIE) }, { statut: 'TERMINE', dateFin: iso(SAISIE) }],
        ['clôture par le titulaire, date de fin saisie pendant l’attente', comptes.CT, { dateFin: SAISIE }, { statut: 'EN_COURS', dateFin: iso(SAISIE) }, { statut: 'TERMINE', dateFin: iso(SAISIE) }],
        // Clôturé sans date pendant l'attente de la clôture de l'administration : la reclôture pose la date (C4).
        ['clôture par l’administration, chantier clôturé sans date pendant l’attente', comptes.DIR, { statut: 'TERMINE' }, { statut: 'TERMINE', dateFin: null }, { statut: 'TERMINE', dateFin: 'jour' }],
      ]) {
        const chantier = await creerChantier();
        const jours = [jourSociete()];
        const { res, attendu } = await sousVerrou(chantier.id, () => changerStatut(chantier.id, { statut: 'TERMINE' }, auteur.auth), (tx) => tx.chantier.update({ where: { id: chantier.id }, data: changement }));
        jours.push(jourSociete());
        assert.equal(res.status, 200, `${quoi} : ${JSON.stringify(res.body)}`);
        assert.deepEqual(tablesChangees(attendu, await empreinte()), ['Chantier', 'JournalSaisieChantier'], quoi);
        const relu = await ligne(chantier.id);
        const apresAttendu = apres.dateFin === 'jour' ? { ...apres, dateFin: dateDuJour(relu, jours, quoi) } : apres;
        assert.deepEqual([relu.statut, iso(relu.dateFin)], ['TERMINE', apresAttendu.dateFin], quoi);
        assert.deepEqual((await journal(chantier.id)).map(contenu), [attendue(chantier.id, auteur, avant, apresAttendu)], quoi);
      }
    });

    // Cadrage : « dans la même transaction que la mise à jour : « sans la trace, le changement n'a pas lieu » (#181) ».
    // L'écriture de l'entrée refusée par la base (déclencheur de test, sur ce seul chantier) : la clôture et la réouverture
    // échouent (500) sans rien écrire. Dans l'autre sens, la mise à jour du chantier refusée : l'entrée part avec elle.
    // Écarte : une entrée écrite hors de la transaction (avant ou après elle), ou une mise à jour validée avant l'entrée.
    test('sans la trace, la clôture et la réouverture n’ont pas lieu ; sans la mise à jour du chantier, la trace non plus (même transaction)', async () => {
      const aClore = await creerChantier();
      const aRouvrir = await creerChantier({ statut: 'TERMINE', dateFin: DATE_FIN });
      const ids = [aClore.id, aRouvrir.id].map((id) => `'${id}'`).join(', ');
      const essayer = async (quoi) => {
        await sansEcriture(() => changerStatut(aClore.id, { statut: 'TERMINE' }, comptes.CT.auth), 500, undefined, `${quoi}, clôture par le titulaire`, aClore.id);
        await sansEcriture(() => changerStatut(aRouvrir.id, { statut: 'EN_COURS' }, comptes.AD.auth), 500, undefined, `${quoi}, réouverture par l’administration`, aRouvrir.id);
        assert.deepEqual([(await ligne(aClore.id)).statut, (await ligne(aClore.id)).dateFin], ['EN_COURS', null], quoi);
        assert.deepEqual([(await ligne(aRouvrir.id)).statut, iso((await ligne(aRouvrir.id)).dateFin)], ['TERMINE', iso(DATE_FIN)], quoi);
      };
      await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "test_refuser_journal_agb"()
        RETURNS TRIGGER AS $$ BEGIN
          IF NEW."chantierId" IN (${ids}) THEN RAISE EXCEPTION 'journal refusé pour le test du lot AG-b'; END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;`);
      await prisma.$executeRawUnsafe('CREATE TRIGGER "test_refuser_journal_agb" BEFORE INSERT ON "JournalSaisieChantier" FOR EACH ROW EXECUTE FUNCTION "test_refuser_journal_agb"()');
      try {
        await essayer('entrée du journal refusée par la base');
      } finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "test_refuser_journal_agb" ON "JournalSaisieChantier"');
        await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "test_refuser_journal_agb"()');
      }
      await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "test_refuser_chantier_agb"()
        RETURNS TRIGGER AS $$ BEGIN
          IF NEW."id" IN (${ids}) THEN RAISE EXCEPTION 'mise à jour refusée pour le test du lot AG-b'; END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;`);
      await prisma.$executeRawUnsafe('CREATE TRIGGER "test_refuser_chantier_agb" BEFORE UPDATE ON "Chantier" FOR EACH ROW EXECUTE FUNCTION "test_refuser_chantier_agb"()');
      try {
        await essayer('mise à jour du chantier refusée par la base');
      } finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "test_refuser_chantier_agb" ON "Chantier"');
        await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "test_refuser_chantier_agb"()');
      }
      // Témoins : sans déclencheur, les deux changements passent et s'écrivent au journal.
      await ecrit(() => changerStatut(aClore.id, { statut: 'TERMINE' }, comptes.CT.auth), 'témoin, clôture', aClore.id);
      await ecrit(() => changerStatut(aRouvrir.id, { statut: 'EN_COURS' }, comptes.AD.auth), 'témoin, réouverture', aRouvrir.id);
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Auteur figé, lecture par la fiche, suppression du compte auteur.
    // ------------------------------------------------------------------------------------------------------------------

    // Cadrage : « auteur et nom figés à l'acte » ; la fiche l'affiche (GET /api/chantiers/:id/journal-saisies, au
    // périmètre de la fiche). Le conducteur qui a clôturé lit son entrée ; un autre conducteur reçoit 404. Renommé puis
    // désactivé ensuite, le compte reste l'auteur de l'entrée sous le nom qu'il portait à l'acte. Écarte : un nom relu sur
    // le compte à la lecture (copie non figée) ; une entrée invisible de la fiche.
    test('auteur figé à l’acte et lecture par la fiche : le conducteur lit l’entrée de sa clôture, un autre conducteur reçoit 404 ; renommé puis désactivé, il reste l’auteur sous le nom de l’acte', async () => {
      const conducteur = await creerCompte('CONDUCTEUR_TRAVAUX', 'CT-FIGE');
      const chantier = await creerChantier({ responsableId: conducteur.id });
      const { entree, relu, jours } = await ecrit(() => changerStatut(chantier.id, { statut: 'TERMINE' }, conducteur.auth), 'clôture', chantier.id);
      const jour = dateDuJour(relu, jours, 'clôture');
      const nomDeLActe = conducteur.name;
      const lu = await ok(appeler('get', `/chantiers/${chantier.id}/journal-saisies`, undefined, conducteur.auth));
      assert.deepEqual(lu.map((e) => [e.id, e.cible, e.action, e.auteurId, e.auteurNom, e.avant, e.apres]), [
        [entree.id, 'CHANTIER', 'CHANGEMENT_STATUT', conducteur.id, nomDeLActe, { statut: 'EN_COURS', dateFin: null }, { statut: 'TERMINE', dateFin: jour }],
      ], 'le conducteur lit l’entrée de sa clôture');
      await sansEcriture(() => appeler('get', `/chantiers/${chantier.id}/journal-saisies`, undefined, comptes.CT2.auth), 404, REFUS.introuvable, 'autre conducteur, lecture du journal');
      await prisma.user.update({ where: { id: conducteur.id }, data: { name: `TEST CT renommé ${suffixe()}` } });
      await ok(appeler('patch', `/users/${conducteur.id}/actif`, { actif: false }));
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: conducteur.id } })).actif, false);
      const relue = await ok(appeler('get', `/chantiers/${chantier.id}/journal-saisies`));
      assert.deepEqual(relue.map((e) => [e.id, e.auteurId, e.auteurNom, e.avant, e.apres]), [[entree.id, conducteur.id, nomDeLActe, { statut: 'EN_COURS', dateFin: null }, { statut: 'TERMINE', dateFin: jour }]], 'nom figé à l’acte');
    });

    // Cadrage, critère : « Un compte qui a clôturé un chantier ne peut plus être supprimé (409 « auteur de données
    // tracées »), seulement désactivé. » ; périmètre 3 : « un compte qui a clôturé ou rouvert devient auteur de données
    // tracées : sa suppression répond 409 ». Témoin : un conducteur titulaire d'un chantier clôturé par l'administration,
    // auteur de rien, se supprime (200). Écarte : une clôture ou une réouverture sans entrée (comportement d'avant le lot :
    // la suppression passait) ; une entrée au nom du titulaire plutôt que de l'auteur (le témoin serait refusé).
    test('suppression d’un compte qui a clôturé un chantier, ou qui en a rouvert un : refusée (409 « auteur de données tracées »), sans rien écrire ; il se désactive ; témoin : le titulaire d’un chantier clôturé par l’administration se supprime', async () => {
      const conducteur = await creerCompte('CONDUCTEUR_TRAVAUX', 'CT-AUTEUR');
      const administrateur = await creerCompte('ADMIN', 'AD-AUTEUR');
      const temoin = await creerCompte('CONDUCTEUR_TRAVAUX', 'CT-TEMOIN');
      const clos = await creerChantier({ responsableId: conducteur.id });
      await ecrit(() => changerStatut(clos.id, { statut: 'TERMINE' }, conducteur.auth), 'clôture par le conducteur', clos.id);
      const rouvert = await creerChantier({ statut: 'TERMINE', dateFin: DATE_FIN });
      await ecrit(() => changerStatut(rouvert.id, { statut: 'EN_COURS' }, administrateur.auth), 'réouverture par l’administrateur', rouvert.id);
      const duTemoin = await creerChantier({ responsableId: temoin.id });
      await ecrit(() => changerStatut(duTemoin.id, { statut: 'TERMINE' }), 'clôture par le super administrateur du chantier du témoin', duTemoin.id);
      // Chacun n'est l'auteur que de son acte : rien d'autre ne le rend auteur de données tracées.
      assert.equal(await prisma.journalSaisieChantier.count({ where: { auteurId: conducteur.id } }), 1);
      assert.equal(await prisma.journalSaisieChantier.count({ where: { auteurId: administrateur.id } }), 1);
      assert.equal(await prisma.journalSaisieChantier.count({ where: { auteurId: temoin.id } }), 0);
      for (const [quoi, compte] of [['conducteur qui a clôturé', conducteur], ['administrateur qui a rouvert', administrateur]]) {
        await sansEcriture(() => appeler('delete', `/users/${compte.id}`), 409, REFUS.auteurTrace, `suppression du ${quoi}`);
        assert.ok(await prisma.user.findUnique({ where: { id: compte.id } }), quoi);
        await ok(appeler('patch', `/users/${compte.id}/actif`, { actif: false }));
        assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: compte.id } })).actif, false, `${quoi} : désactivé`);
      }
      await ok(appeler('delete', `/users/${temoin.id}`));
      assert.equal(await prisma.user.findUnique({ where: { id: temoin.id } }), null, 'témoin supprimé');
      assert.equal((await ligne(duTemoin.id)).statut, 'TERMINE', 'le chantier du témoin reste clôturé');
    });
  });
}
