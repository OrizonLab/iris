// Lot AG-c (#451, suites) : l'annulation d'une affaire par son devis s'inscrit au journal de la fiche chantier (cadrage du
// lot AG-c du 28-11-2026, sections « Périmètre », « Critères métier observables », « Tests » et « v2 »).
//
// Décision appliquée, mot pour mot. Question posée par Claude Code le 26-11-2026 à 22:53:17 UTC : « Annulation d'une
// affaire par son devis : elle fait passer le chantier en « Annulé » et retire son chiffre d'affaires, mais elle ne s'écrit
// pas au journal du chantier. Elle s'écrit pourtant au journal des interventions et du contrat concernés. Faut-il aussi
// l'inscrire au journal du chantier ? - A. Oui (recommandé) : on l'inscrit au journal de la fiche, avec l'auteur, la date,
// le motif, et le statut avant et après, comme la clôture. - B. Non : la trace reste celle d'aujourd'hui, c'est-à-dire la
// date et le motif affichés en tête de la fiche. » Réponse de Nelson du 28-11-2026 à 02:10:35 UTC (point 1 de son
// message) : « 1. Oui ».
//
// Cadrage, périmètre 1, et v2 (choix arrêtés, choix par défaut, à confirmer, règle 5 ; mise en œuvre, N5) : quand
// POST /api/devis/:id/annulation fait passer le chantier de l'affaire en ANNULE, une entrée de JournalSaisieChantier, cible
// CHANTIER, action CHANGEMENT_STATUT (comme la clôture, AG-b), dans la même transaction, sous le verrou du chantier déjà
// pris (FOR NO KEY UPDATE) :
//  - avant = { statut, dateFin } lus sous ce verrou ; après = { statut: 'ANNULE', dateFin } : la date de fin n'est pas
//    changée par l'annulation ; dateFin en ISO (toISOString()) ou null, la même des deux côtés ;
//  - motif = « Annulation du devis <numéro> (version <v>) : <motif> », le même que celui des journaux des interventions et
//    du contrat de la même annulation (N2) ;
//  - auteur et nom figés à l'acte (le compte en session : aucune route d'intégration n'annule un devis) ;
//  - « Sans la trace, le changement n'a pas lieu » (#181).
// Critères : un refus d'annulation n'écrit rien ; une annulation sans chantier (devis converti en intervention ou en
// contrat seulement, ou non converti) n'écrit rien au journal d'un chantier ; un administrateur qui a annulé une affaire
// ouverte seulement en chantier devient auteur de données tracées : sa suppression répond 409, il se désactive (v2, N8 à
// N10). Tests demandés par la v2 (T1, N6, N7) : chantier TERMINE annulé (« Terminé, date de fin X » → « Annulé, date de
// fin X ») ; exactement une entrée au journal du chantier quand le devis a aussi créé une intervention ou un contrat ;
// clôture et annulation concurrentes (« avant » lu sous le verrou).
//
// L'annulation retire au chantier son chiffre d'affaires, et sa date de fin fixe le mois du CA validé
// (commissions/metier.ts) : la trace touche un montant (règle 2). Chaque refus est prouvé sans aucune écriture : empreinte
// de toute la base (chaque table du schéma public, contenu compris), relue après l'appel, et journal du chantier relu.
// Chaque annulation admise, par la liste exacte des tables changées et le contenu exact de l'entrée. Les dates de fin
// saisies (15-10-2026, 15-12-2025) sont distinctes entre elles et antérieures au jour de tout passage (28-11-2026 au plus
// tôt) : une date du jour écrite à la place de la date gardée se voit.
//
// Fichier propre au lot, avec sa base jetable : `node --test` exécute les fichiers en parallèle, et api.test.mjs, qui
// tourne en même temps sur TEST_DATABASE_URL, purge les données « TEST » ; les déclencheurs posés par le test d'atomicité
// ne doivent pas toucher les autres fichiers. TEST_DATABASE_URL ne sert ici que de connexion administrative : une base
// neuve est créée, migrée (`prisma migrate deploy`), servie à l'application montée en mémoire, puis supprimée (retentée
// dans un `finally`, comme #552). Sans TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';

const TITRE = 'Lot AG-c : annulation d’une affaire par son devis inscrite au journal de la fiche chantier (décision de Nelson du 28-11-2026, « 1. Oui »)';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// Refus existants, mot pour mot (apostrophe typographique) : le lot ne les change pas.
const REFUS = {
  administration: 'Accès réservé aux administrateurs',
  motif: 'Un motif d’annulation est obligatoire.',
  devisIntrouvable: 'Devis introuvable.',
  dejaAnnule: 'Ce devis est déjà annulé.',
  encaisse: 'Annulation impossible : ce chantier est déjà encaissé. Une affaire encaissée ne s’annule pas.',
  heures: 'Annulation impossible : ce chantier porte déjà 1 pointage(s) d’heures et 0 achat(s). Une affaire commencée ne s’annule pas.',
  achat: 'Annulation impossible : ce chantier porte déjà 0 pointage(s) d’heures et 1 achat(s). Une affaire commencée ne s’annule pas.',
  coutsIntervention: 'Annulation impossible : l’intervention issue de ce devis porte déjà 1 coût(s), comptés dans la marge de son chantier. Une affaire commencée ne s’annule pas.',
  coutsSuites: 'Annulation impossible : les suites SAV de ce chantier portent déjà 1 coût(s), comptés dans sa marge. Une affaire commencée ne s’annule pas.',
  interventionEnCours: (ref) => `Annulation impossible : l’intervention ${ref} issue de ce devis est en cours. Une affaire commencée ne s’annule pas.`,
  suiteEnCours: (refSuite, ref) => `Annulation impossible : la suite ${refSuite} de l’intervention ${ref} est en cours. Une affaire commencée ne s’annule pas.`,
  visiteEnCours: (ref) => `Annulation impossible : la visite ${ref} du contrat issu de ce devis est en cours. Terminez-la ou annulez-la d’abord depuis sa fiche.`,
  introuvable: 'Chantier introuvable',
  authentification: 'Authentification requise',
  session: 'Session expirée ou invalide',
  auteurTrace: 'Ce compte est l’auteur de données tracées : le supprimer effacerait une preuve de traçabilité. Désactivez-le plutôt pour lui retirer l’accès.',
};
const FUSEAU = 'Europe/Paris';
const DATE_FIN = new Date('2026-10-15T00:00:00.000Z');
const SAISIE = new Date('2025-12-15T00:00:00.000Z');
const MOTIF = 'TEST client renonce avant tout démarrage';

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_agc_${randomBytes(6).toString('hex')}`;
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
    let intervenant = null; let fournisseur = null; let categorie = null;

    const creerCompte = async (role, cle, extra = {}) => {
      const s = suffixe();
      const compte = await prisma.user.create({ data: { email: `agc.${cle.toLowerCase()}.${s}@iris.test`, name: `TEST ${cle} ${s}`, role, ...extra } });
      return { ...compte, auth: entete(jwt.sign({ id: compte.id }, process.env.JWT_SECRET)) };
    };
    // Administration, seule à annuler un devis (requireAdmin) : super administrateur (secours), administrateur,
    // administrateur aussi commercial, directeur (aligné sur l'administration, décision de Nelson du 24-10-2026, point 14).
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
    // `motif` à null : corps sans motif.
    const annuler = (devisId, motif = MOTIF, auth = admin()) => appeler('post', `/devis/${devisId}/annulation`, motif === null ? {} : { motif }, auth);
    const changerStatut = (id, corps, auth = admin()) => appeler('patch', `/chantiers/${id}/statut`, corps, auth);
    const passerA = (id, statut) => ok(appeler('patch', `/interventions/${id}/statut`, { statut }));
    const demarrer = async (id) => { await passerA(id, 'PLANIFIEE'); await passerA(id, 'EN_COURS'); };

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
        assert.ok(tables.includes('Chantier') && tables.includes('JournalSaisieChantier') && tables.includes('Devis') && tables.length > 40, `tables relevées : ${tables.join(', ')}`);
        assert.ok(tables.every((table) => /^[A-Za-z_]+$/.test(table)), 'noms de tables sans guillemet');
        requeteEmpreinte = tables.map(sqlEmpreinte).join(' UNION ALL ');
      }
      return Object.fromEntries((await client.$queryRawUnsafe(requeteEmpreinte)).map(({ t, n, h }) => [t, `${n}:${h}`]));
    };
    const tablesChangees = (avant, apres) => Object.keys({ ...avant, ...apres }).filter((t) => avant[t] !== apres[t]).sort();
    const journal = (chantierId) => prisma.journalSaisieChantier.findMany({ where: { chantierId }, orderBy: { createdAt: 'asc' } });
    // Toutes les entrées du journal, toutes cibles : une entrée de l'annulation écrite sans chantier se voit aussi.
    const toutLeJournal = () => prisma.journalSaisieChantier.findMany({ orderBy: { createdAt: 'asc' } });
    const ligne = (id) => prisma.chantier.findUniqueOrThrow({ where: { id } });
    const statutDevis = async (id) => (await prisma.devis.findUniqueOrThrow({ where: { id } })).statut;
    // Jour civil de la société, à minuit UTC, comme toute date-seule stockée (dateFin). Relevé avant et après l'appel.
    const jourSociete = () => `${jourCivilEntreprise(new Date(), FUSEAU)}T00:00:00.000Z`;
    // Une entrée telle que le lot l'écrit : tous ses champs hors identifiant et horodatage (imposé par la base, #582).
    const contenu = (e) => ({
      chantierId: e.chantierId, interventionId: e.interventionId, contratMaintenanceId: e.contratMaintenanceId, cible: e.cible, cibleId: e.cibleId,
      action: e.action, auteurId: e.auteurId, auteurNom: e.auteurNom, avant: e.avant, apres: e.apres, motif: e.motif,
    });
    const attendue = (chantierId, auteur, avant, apres, motif) => ({
      chantierId, interventionId: null, contratMaintenanceId: null, cible: 'CHANTIER', cibleId: chantierId,
      action: 'CHANGEMENT_STATUT', auteurId: auteur.id, auteurNom: auteur.name, avant, apres, motif,
    });
    const iso = (date) => (date ? date.toISOString() : null);
    // Motif attendu, écrit à la main (numéro relu sur le devis créé, version en chiffre) : « Annulation du devis <numéro>
    // (version <v>) : <motif> » (cadrage v2, N2).
    const motifDe = (devis, version, motif = MOTIF) => `Annulation du devis ${devis.numero} (version ${version}) : ${motif}`;

    // Un refus : statut et message attendus, empreinte de toute la base inchangée et journal du chantier inchangé.
    const sansEcriture = async (appel, statut, message, quoi, chantierId) => {
      const avant = await empreinte();
      const journalAvant = chantierId ? (await journal(chantierId)).length : 0;
      const res = await appel();
      assert.equal(res.status, statut, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      if (message !== undefined) assert.equal(res.body.error, message, quoi);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      if (chantierId) assert.equal((await journal(chantierId)).length, journalAvant, `${quoi} : aucune entrée au journal du chantier`);
      return res;
    };
    // Une annulation admise : 200 ; rend les tables changées, toutes les entrées nouvelles du journal (toutes cibles), et,
    // s'il y a un chantier, ses entrées nouvelles et sa ligne relue.
    const annulationAdmise = async (appel, quoi, chantierId = null) => {
      const avant = await empreinte();
      const anciens = new Set((await toutLeJournal()).map((e) => e.id));
      const res = await appel();
      assert.equal(res.status, 200, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      const tables = tablesChangees(avant, await empreinte());
      const nouvelles = (await toutLeJournal()).filter((e) => !anciens.has(e.id));
      const duChantier = chantierId ? nouvelles.filter((e) => e.chantierId === chantierId) : [];
      return { res, tables, nouvelles, duChantier, relu: chantierId ? await ligne(chantierId) : null };
    };

    // --- Données ---
    // Client identifié (un devis ne se signe que pour lui) : SIREN tiré au hasard, site de facturation.
    const creerClient = async (libelle) => {
      let client;
      for (let essai = 1; ; essai += 1) {
        const res = await appeler('post', '/clients', { raisonSociale: `TEST Client AG-c ${libelle} ${suffixe()}`, siren: String(randomInt(100_000_000, 1_000_000_000)) });
        if (res.status === 409 && essai < 5) continue;
        assert.equal(res.status, 201, JSON.stringify(res.body));
        client = res.body;
        break;
      }
      await ok(appeler('post', `/clients/${client.id}/sites`, { nom: 'TEST Facturation AG-c', adresse: '12 rue de l’Annulation', codePostal: '14000', ville: 'Caen', estSiteFacturation: true }), 201);
      return client;
    };
    // Devis d'un client neuf, au statut demandé : BROUILLON, ENVOYE, ou signé (ACCEPTE) ; `revision` : la version 2 du
    // même dossier, signée (une révision part d'un devis signé, et seule la dernière version se convertit).
    const creerDevis = async (libelle, { etat = 'ACCEPTE', revision = false } = {}) => {
      const client = await creerClient(libelle);
      let devis = await ok(appeler('post', '/devis', { clientId: client.id, objet: `TEST Devis AG-c ${libelle}`, lignes: [{ designation: 'TEST Pose', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 }] }), 201);
      if (etat === 'BROUILLON') return devis;
      await ok(appeler('put', `/devis/${devis.id}/statut`, { statut: 'ENVOYE' }));
      if (etat === 'ENVOYE') return devis;
      await ok(appeler('post', `/devis/${devis.id}/signature`, { signataire: 'TEST Signataire AG-c', confirme: true }), 201);
      if (revision) {
        const v2 = await ok(appeler('post', `/devis/${devis.id}/revisions`, {}), 201);
        assert.deepEqual([v2.numero, v2.version], [devis.numero, 2], 'révision : même numéro, version 2');
        devis = v2;
        await ok(appeler('put', `/devis/${devis.id}/statut`, { statut: 'ENVOYE' }));
        await ok(appeler('post', `/devis/${devis.id}/signature`, { signataire: 'TEST Signataire AG-c v2', confirme: true }), 201);
      }
      return devis;
    };
    const convertir = (devisId, cibleConversion) => {
      if (cibleConversion === 'CHANTIER') return ok(appeler('post', `/devis/${devisId}/convertir`, { cible: 'CHANTIER', responsableId: comptes.CT.id, commercialId: comptes.COM.id }), 201);
      if (cibleConversion === 'CONTRAT') return ok(appeler('post', `/devis/${devisId}/convertir`, { cible: 'CONTRAT', periodiciteMois: 12, dureePrevisionnelleMinutes: 60, dateDebut: '01-01-2099' }), 201);
      return ok(appeler('post', `/devis/${devisId}/convertir`, { cible: 'INTERVENTION' }), 201);
    };
    // Affaire ouverte par la conversion d'un devis signé (seule porte d'ouverture d'un chantier), titulaire CT, commercial
    // COM ; `conversions` : la liste des cibles, dans l'ordre (une affaire se convertit au plus deux fois).
    const affaire = async (libelle, { conversions = ['CHANTIER'], revision = false } = {}) => {
      const devis = await creerDevis(libelle, { revision });
      const ids = {};
      for (const cibleConversion of conversions) ids[cibleConversion] = (await convertir(devis.id, cibleConversion)).id;
      const enBase = await prisma.devisConversion.findMany({ where: { devisId: devis.id }, orderBy: { rang: 'asc' } });
      assert.deepEqual(enBase.map((c) => [c.cibleType, c.cibleId]), conversions.map((c) => [c, ids[c]]), `${libelle} : conversions`);
      if (ids.CHANTIER) assert.deepEqual((await journal(ids.CHANTIER)).length, 0, `${libelle} : la conversion n’écrit pas au journal du chantier`);
      return { devis, chantierId: ids.CHANTIER ?? null, contratId: ids.CONTRAT ?? null, interventionId: ids.INTERVENTION ?? null };
    };
    const reference = async (id) => (await prisma.intervention.findUniqueOrThrow({ where: { id }, select: { reference: true } })).reference;

    // Une transaction de test tient la ligne du chantier (FOR UPDATE) : l'annulation part, prend le verrou du devis, puis
    // attend celui du chantier (constaté par pg_blocking_pids) ; la transaction change alors la ligne directement en base
    // et valide. L'état attendu après la réponse est relevé dans la transaction : toute la base avant le départ de la
    // requête, puis la table des chantiers une fois changée. Modèle : `sousVerrou` de journal-cloture-chantier.test.mjs.
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
        assert.equal(attente, true, 'l’annulation attend la ligne du chantier');
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
      // Identité de la société, fuseau compris : un devis ne se signe qu'avec elle, et la clôture date du jour de la société.
      await ok(appeler('put', '/company', { raisonSociale: 'TEST Émetteur lot AG-c', siret: '45245245200052', adresse: '52 rue de l’Annulation', codePostal: '14000', ville: 'Caen', fuseauHoraire: FUSEAU }));
      comptes.AD = await creerCompte('ADMIN', 'AD');
      comptes['AD-COM'] = await creerCompte('ADMIN', 'AD-COM', { estCommercial: true });
      for (const [cle, role] of [['CT', 'CONDUCTEUR_TRAVAUX'], ['CT2', 'CONDUCTEUR_TRAVAUX'], ['RESP', 'RESPONSABLE'], ['DC', 'DIRECTEUR_COMMERCIAL'], ['AC', 'ASSISTANTE_COMMERCIALE'], ['CPT', 'COMPTABLE'], ['TECH', 'TECHNICIEN'], ['COM', 'COMMERCIAL'], ['AT', 'ASSISTANTE_TECHNIQUE'], ['DIR', 'DIRECTEUR']]) {
        comptes[cle] = await creerCompte(role, cle);
      }
      intervenant = await prisma.intervenant.create({ data: { nom: `TEST Intervenant AG-c ${suffixe()}`, role: 'Technicien', tauxHoraireCharge: '40' } });
      fournisseur = await prisma.fournisseur.create({ data: { nom: `TEST Fournisseur AG-c ${suffixe()}` } });
      categorie = await prisma.categorie.create({ data: { nom: `TEST Catégorie AG-c ${suffixe()}` } });
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
    // Contenu exact de l'entrée (critère : « L'annulation d'un devis converti en chantier écrit une entrée au journal du
    // chantier : auteur, statut avant (EN_COURS ou autre) et après (ANNULE), date de fin inchangée, motif »).
    // ------------------------------------------------------------------------------------------------------------------

    // Chantier en cours, sans date de fin puis avec une date de fin saisie, annulé par chaque compte de l'administration.
    // Le motif est envoyé entouré d'espaces : la route l'enregistre sans elles, sur le chantier comme dans l'entrée. Écarte :
    // une annulation sans entrée (comportement d'avant le lot) ; une entrée au nom du titulaire (CT) ou du commercial (COM)
    // plutôt que du compte qui annule ; un motif d'entrée réduit au motif saisi, ou laissé vide, ou pris avant d'en retirer
    // les espaces ; un « après » sans la date de fin gardée, ou à la date de l'annulation ; une date en un autre format que
    // l'ISO (« 2026-10-15 ») ; un instantané qui emporterait d'autres champs du chantier (budgets : montants), écarté par
    // l'égalité stricte des clés ; une autre table écrite (journal d'administration, par exemple) ; un chantier dont le motif
    // d'annulation deviendrait celui de l'entrée (le motif du chantier reste le motif saisi).
    test('chantier en cours annulé par son devis, par chaque compte de l’administration (SA, AD, AD-COM, DIR) : une entrée CHANTIER CHANGEMENT_STATUT à son nom, de « en cours » à « annulé », la date de fin inchangée (sans date, ou saisie), motif « Annulation du devis <numéro> (version 1) : <motif> » ; seuls le devis, le chantier et son journal sont écrits', async () => {
      for (const [compte, auth, auteur] of ADMINISTRATION()) {
        for (const [etat, dateFin] of [['sans date de fin', null], ['avec une date de fin saisie', DATE_FIN]]) {
          const quoi = `${compte}, chantier en cours ${etat}`;
          const { devis, chantierId } = await affaire(quoi);
          if (dateFin) await prisma.chantier.update({ where: { id: chantierId }, data: { dateFin } });
          const motif = `${MOTIF} (${compte})`;
          const { res, tables, nouvelles, duChantier, relu } = await annulationAdmise(() => annuler(devis.id, `   ${motif}  `, auth), quoi, chantierId);
          assert.deepEqual(tables, ['Chantier', 'Devis', 'JournalSaisieChantier'], `${quoi} : seuls le devis, le chantier et son journal sont écrits`);
          assert.equal(nouvelles.length, 1, `${quoi} : une seule entrée nouvelle, toutes cibles comprises`);
          assert.deepEqual(duChantier.map(contenu), [attendue(chantierId, auteur, { statut: 'EN_COURS', dateFin: iso(dateFin) }, { statut: 'ANNULE', dateFin: iso(dateFin) }, `Annulation du devis ${devis.numero} (version 1) : ${motif}`)], quoi);
          assert.notEqual(duChantier[0].auteurId, comptes.CT.id, `${quoi} : l’auteur n’est pas le titulaire`);
          if (dateFin) assert.equal(duChantier[0].apres.dateFin, '2026-10-15T00:00:00.000Z', `${quoi} : date de fin en chaîne ISO`);
          assert.deepEqual([relu.statut, iso(relu.dateFin), relu.annuleParId, relu.motifAnnulation, relu.encaisse], ['ANNULE', iso(dateFin), auteur.id, motif, false], `${quoi} : ligne du chantier`);
          assert.ok(relu.annuleLe instanceof Date, `${quoi} : date d’annulation posée`);
          assert.deepEqual([res.body.chantierArchive, res.body.devis.statut, res.body.contratAnnule, res.body.interventionsAnnulees], [chantierId, 'ANNULE', null, []], `${quoi} : réponse`);
        }
      }
    });

    // Cadrage v2, T1 : « chantier TERMINE annulé par son devis (« Terminé, date de fin X » → « Annulé, date de fin X ») ».
    // Trois chantiers terminés : clôturé par son titulaire avec une date de fin saisie avant (gardée par la clôture),
    // clôturé par l'administration (date du jour de la société), terminé sans date de fin (posé en base : aucune route n'y
    // mène plus, mais la base le permet). L'« avant » de l'annulation égale l'« après » de la clôture journalisée (AG-b).
    // Écarte : un « avant » écrit toujours « EN_COURS » (la seule ouverture d'un chantier) ; un « après » sans la date de
    // fin, ou à la date de l'annulation (le 15-10-2026 et le 15-12-2025 précèdent tout passage) ; une date de fin posée par
    // l'annulation sur un chantier terminé qui n'en avait pas.
    test('chantier terminé annulé par son devis : de « terminé, date de fin X » à « annulé, date de fin X », l’« avant » égal à l’« après » de la clôture journalisée ; terminé sans date de fin : sans date des deux côtés', async () => {
      // Clôturé par son titulaire, date de fin saisie avant la clôture ; annulé par l'administrateur.
      const saisie = await affaire('terminé, date saisie');
      await prisma.chantier.update({ where: { id: saisie.chantierId }, data: { dateFin: SAISIE } });
      await ok(changerStatut(saisie.chantierId, { statut: 'TERMINE' }, comptes.CT.auth));
      let ecriture = await annulationAdmise(() => annuler(saisie.devis.id, MOTIF, comptes.AD.auth), 'terminé, date saisie', saisie.chantierId);
      assert.deepEqual(ecriture.tables, ['Chantier', 'Devis', 'JournalSaisieChantier']);
      let entrees = (await journal(saisie.chantierId)).map(contenu);
      assert.equal(entrees.length, 2, 'clôture puis annulation');
      assert.deepEqual(entrees[1], attendue(saisie.chantierId, comptes.AD, { statut: 'TERMINE', dateFin: '2025-12-15T00:00:00.000Z' }, { statut: 'ANNULE', dateFin: '2025-12-15T00:00:00.000Z' }, motifDe(saisie.devis, 1)));
      assert.deepEqual(entrees[1].avant, entrees[0].apres, 'l’« avant » de l’annulation est l’« après » de la clôture');
      assert.deepEqual([entrees[0].auteurId, entrees[0].avant], [comptes.CT.id, { statut: 'EN_COURS', dateFin: '2025-12-15T00:00:00.000Z' }], 'clôture du titulaire, journalisée (AG-b)');
      assert.deepEqual([ecriture.relu.statut, iso(ecriture.relu.dateFin)], ['ANNULE', iso(SAISIE)]);

      // Clôturé par l'administration, au jour de la société ; annulé par le directeur.
      const duJour = await affaire('terminé, date du jour');
      const jours = [jourSociete()];
      const close = await ok(changerStatut(duJour.chantierId, { statut: 'TERMINE' }));
      jours.push(jourSociete());
      assert.ok(jours.includes(close.dateFin), `date de fin de la clôture au jour de la société : ${close.dateFin}`);
      ecriture = await annulationAdmise(() => annuler(duJour.devis.id, MOTIF, comptes.DIR.auth), 'terminé, date du jour', duJour.chantierId);
      entrees = (await journal(duJour.chantierId)).map(contenu);
      assert.deepEqual(entrees.map((e) => e.auteurId), [secours.id, comptes.DIR.id]);
      assert.deepEqual(entrees[1], attendue(duJour.chantierId, comptes.DIR, { statut: 'TERMINE', dateFin: close.dateFin }, { statut: 'ANNULE', dateFin: close.dateFin }, motifDe(duJour.devis, 1)));
      assert.deepEqual(entrees[1].avant, entrees[0].apres);

      // Terminé sans date de fin, posé en base : aucune date posée par l'annulation.
      const sansDate = await affaire('terminé sans date de fin');
      await prisma.chantier.update({ where: { id: sansDate.chantierId }, data: { statut: 'TERMINE' } });
      ecriture = await annulationAdmise(() => annuler(sansDate.devis.id), 'terminé sans date de fin', sansDate.chantierId);
      assert.deepEqual(ecriture.duChantier.map(contenu), [attendue(sansDate.chantierId, secours, { statut: 'TERMINE', dateFin: null }, { statut: 'ANNULE', dateFin: null }, motifDe(sansDate.devis, 1))]);
      assert.deepEqual([ecriture.relu.statut, ecriture.relu.dateFin], ['ANNULE', null]);
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Une seule entrée au journal du chantier (cadrage v2, N6), motif commun avec les journaux SAV (v2, N2).
    // ------------------------------------------------------------------------------------------------------------------

    // Le devis a aussi créé une intervention (avec une suite), ou un contrat (avec une visite à planifier) : chacun écrit sa
    // propre entrée à son journal, au même motif ; le journal du chantier n'en reçoit qu'une, la sienne. Puis un devis révisé
    // (version 2), converti en chantier et en intervention : « (version 2) » au motif des deux journaux. Écarte : une entrée
    // du chantier écrite par intervention ou par visite annulée (boucle) ; une entrée d'intervention ou de contrat rangée au
    // journal du chantier (chantierId posé) ; un motif d'entrée du chantier différent de celui des journaux SAV ; une version
    // écrite en dur (« version 1 ») ou un numéro pris ailleurs que sur le devis annulé.
    test('devis qui a aussi créé une intervention (et sa suite) ou un contrat (et sa visite) : exactement une entrée au journal du chantier ; les journaux de l’intervention, de la suite, du contrat et de la visite portent le même motif ; devis révisé : « (version 2) »', async () => {
      for (const [quoi, conversions, revision] of [
        ['chantier et intervention, avec une suite', ['CHANTIER', 'INTERVENTION'], false],
        ['chantier et contrat, avec une visite', ['CHANTIER', 'CONTRAT'], false],
        ['devis révisé, version 2, chantier et intervention', ['CHANTIER', 'INTERVENTION'], true],
      ]) {
        const { devis, chantierId, contratId, interventionId } = await affaire(quoi, { conversions, revision });
        assert.equal(devis.version, revision ? 2 : 1, quoi);
        let suite = null; let visite = null;
        if (interventionId) {
          assert.equal((await prisma.intervention.findUniqueOrThrow({ where: { id: interventionId } })).chantierId, chantierId, `${quoi} : intervention rattachée au chantier`);
          if (!revision) suite = await ok(appeler('post', `/interventions/${interventionId}/suites`, {}), 201);
        }
        if (contratId) visite = await ok(appeler('post', `/contrats-maintenance/${contratId}/generer-intervention`, {}), 201);
        const motif = motifDe(devis, revision ? 2 : 1);
        const { res, nouvelles, duChantier } = await annulationAdmise(() => annuler(devis.id), quoi, chantierId);
        assert.deepEqual(duChantier.map(contenu), [attendue(chantierId, secours, { statut: 'EN_COURS', dateFin: null }, { statut: 'ANNULE', dateFin: null }, motif)], `${quoi} : une seule entrée au journal du chantier`);
        assert.equal(await prisma.journalSaisieChantier.count({ where: { cible: 'CHANTIER', cibleId: chantierId } }), 1, `${quoi} : une seule entrée de cible CHANTIER pour ce chantier`);
        // Les autres entrées nouvelles : une par intervention annulée, une pour le contrat ; aucune au journal du chantier.
        const annulees = [interventionId, suite?.id, visite?.id].filter(Boolean).sort();
        assert.deepEqual([...res.body.interventionsAnnulees].sort(), annulees, `${quoi} : interventions annulées`);
        assert.equal(res.body.contratAnnule, contratId, quoi);
        const autres = nouvelles.filter((e) => e.chantierId !== chantierId);
        assert.equal(nouvelles.length, 1 + annulees.length + (contratId ? 1 : 0), `${quoi} : entrées nouvelles, toutes cibles`);
        assert.deepEqual(autres.map((e) => [e.chantierId, e.cible, e.cibleId, e.action, e.motif, e.auteurId]).sort((a, b) => `${a[1]}${a[2]}`.localeCompare(`${b[1]}${b[2]}`)), [
          ...(contratId ? [[null, 'CONTRAT', contratId, 'ANNULATION', motif, secours.id]] : []),
          ...annulees.map((id) => [null, 'INTERVENTION', id, 'CHANGEMENT_STATUT', motif, secours.id]),
        ].sort((a, b) => `${a[1]}${a[2]}`.localeCompare(`${b[1]}${b[2]}`)), `${quoi} : journaux de l’intervention, de la suite, du contrat et de la visite, au même motif`);
      }
    });

    // Critère : « Une annulation sans chantier (devis converti en intervention ou contrat seulement, ou non converti)
    // n'écrit rien au journal d'un chantier. » Devis brouillon, envoyé ou signé non converti : seul le devis est écrit ;
    // converti en intervention, en contrat, ou les deux : leurs journaux seulement, aucune entrée au chantier ni de cible
    // CHANTIER, aucune entrée nouvelle au journal d'un chantier existant (témoin). Écarte une entrée écrite à toute
    // annulation, chantier ou non (sans identifiant de chantier, ou à celui d'un autre chantier).
    test('devis sans chantier (brouillon, envoyé ou signé non converti ; converti en intervention, en contrat, ou les deux) : son annulation n’écrit rien au journal d’un chantier', async () => {
      const temoin = await affaire('témoin, chantier existant');
      // Les tests précédents du fichier ont écrit au journal de leurs chantiers : comptes relevés avant, comparés après.
      const entreesDeChantier = async () => [await prisma.journalSaisieChantier.count({ where: { cible: 'CHANTIER' } }), await prisma.journalSaisieChantier.count({ where: { chantierId: { not: null } } })];
      const avant = await entreesDeChantier();
      for (const [quoi, etat] of [['brouillon', 'BROUILLON'], ['envoyé', 'ENVOYE'], ['signé, non converti', 'ACCEPTE']]) {
        const devis = await creerDevis(`sans chantier, ${quoi}`, { etat });
        const { tables, nouvelles, res } = await annulationAdmise(() => annuler(devis.id), quoi);
        assert.deepEqual(tables, ['Devis'], `${quoi} : seul le devis est écrit`);
        assert.deepEqual([nouvelles.length, res.body.chantierArchive, await statutDevis(devis.id)], [0, null, 'ANNULE'], quoi);
      }
      for (const [quoi, conversions] of [['intervention seule', ['INTERVENTION']], ['contrat seul', ['CONTRAT']], ['contrat et intervention', ['CONTRAT', 'INTERVENTION']]]) {
        const { devis, contratId, interventionId } = await affaire(`sans chantier, ${quoi}`, { conversions });
        const { nouvelles, res } = await annulationAdmise(() => annuler(devis.id), quoi);
        assert.equal(res.body.chantierArchive, null, quoi);
        assert.deepEqual(nouvelles.map((e) => [e.chantierId, e.cible, e.motif]).sort(), [
          ...(contratId ? [[null, 'CONTRAT', motifDe(devis, 1)]] : []), ...(interventionId ? [[null, 'INTERVENTION', motifDe(devis, 1)]] : []),
        ].sort(), `${quoi} : journaux de l’intervention et du contrat seulement`);
      }
      assert.deepEqual(await entreesDeChantier(), avant, 'aucune entrée de cible CHANTIER, ni au journal d’un chantier');
      assert.deepEqual([(await ligne(temoin.chantierId)).statut, (await journal(temoin.chantierId)).length], ['EN_COURS', 0], 'témoin : chantier existant intact');
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Refus (critère : « Un refus d'annulation (affaire commencée, chantier encaissé, etc.) n'écrit rien »).
    // ------------------------------------------------------------------------------------------------------------------

    // Chaque refus de la route, sur un devis converti en chantier, au message inchangé : sans entrée au journal du chantier
    // ni aucune autre écriture (empreinte de toute la base). Écarte une entrée écrite avant les contrôles (trace d'une
    // annulation qui n'a pas lieu), notamment avant ceux qui suivent le verrou du chantier (heures, achats, coûts, SAV
    // commencé, encaissement), et une entrée écrite hors de la transaction qu'un refus annule.
    test('chaque refus de l’annulation d’un devis converti en chantier n’écrit rien, ni entrée au journal du chantier ni rien d’autre (empreinte de toute la base) : 401, 403, 400, 404, 409 de l’affaire commencée, du SAV commencé et du chantier encaissé, 400 du devis déjà annulé', async () => {
      const base = await affaire('refus de session et de saisie');
      const cle = await ok(appeler('post', '/admin/api-keys', { nom: `TEST Clé lot AG-c ${suffixe()}`, scopes: ['devis:read', 'devis:write', 'chantiers:read', 'chantiers:write', 'chantiers:archive', 'finances:read'] }), 201);
      const cas = [
        ['401, sans session', () => annuler(base.devis.id, MOTIF, {}), 401, REFUS.authentification],
        ['401, jeton invalide', () => annuler(base.devis.id, MOTIF, entete('jeton-invalide')), 401, REFUS.session],
        ['401, clé d’intégration (portées des devis, des chantiers et des finances)', () => annuler(base.devis.id, MOTIF, entete(cle.apiKey)), 401, REFUS.session],
        // Aucune route d'intégration n'annule un devis (cadrage v2, N5) : la même demande sous /api/v1 n'y trouve rien.
        ['404, clé d’intégration sous /api/v1', () => request(app).post(`/api/v1/devis/${base.devis.id}/annulation`).set(entete(cle.apiKey)).send({ motif: MOTIF }), 404, undefined],
        ...[['CT', 'conducteur titulaire'], ['RESP', 'responsable'], ['DC', 'directeur commercial'], ['AC', 'assistante commerciale'], ['CPT', 'comptable'], ['TECH', 'technicien'], ['COM', 'commercial de l’affaire'], ['AT', 'assistante technique']]
          .map(([c, qui]) => [`403, ${qui}`, () => annuler(base.devis.id, MOTIF, comptes[c].auth), 403, REFUS.administration]),
        ['400, sans motif', () => annuler(base.devis.id, null), 400, REFUS.motif],
        ['400, motif vide', () => annuler(base.devis.id, ''), 400, REFUS.motif],
        ['400, motif d’espaces', () => annuler(base.devis.id, '   '), 400, REFUS.motif],
        ['404, devis inexistant', () => annuler(randomUUID()), 404, REFUS.devisIntrouvable],
      ];
      for (const [quoi, appel, statut, message] of cas) await sansEcriture(appel, statut, message, quoi, base.chantierId);

      // Affaire commencée côté chantier : un pointage d'heures, un achat, vivants.
      const heures = await affaire('refus, heures');
      await prisma.pointageHeure.create({ data: { chantierId: heures.chantierId, intervenantId: intervenant.id, date: new Date('2026-09-02T00:00:00.000Z'), nbrHeures: '2', tauxHoraireApplique: '40', createdById: secours.id, updatedById: secours.id } });
      await sansEcriture(() => annuler(heures.devis.id), 409, REFUS.heures, 'heures saisies', heures.chantierId);
      const achat = await affaire('refus, achat');
      await prisma.achatReel.create({ data: { chantierId: achat.chantierId, fournisseurId: fournisseur.id, categorieId: categorie.id, date: new Date('2026-09-02T00:00:00.000Z'), description: 'TEST Achat AG-c', montantHT: '10', createdById: secours.id, updatedById: secours.id } });
      await sansEcriture(() => annuler(achat.devis.id), 409, REFUS.achat, 'achat saisi', achat.chantierId);
      // Coûts de l'intervention du devis rattachée au chantier, puis d'une suite de cette intervention.
      const coutIntervention = await affaire('refus, coût de l’intervention', { conversions: ['CHANTIER', 'INTERVENTION'] });
      await prisma.coutInterventionHeure.create({ data: { interventionId: coutIntervention.interventionId, intervenantId: intervenant.id, date: new Date('2026-10-20T00:00:00Z'), nbrHeures: '1', tauxHoraireApplique: '40', createdById: secours.id } });
      await sansEcriture(() => annuler(coutIntervention.devis.id), 409, REFUS.coutsIntervention, 'coût de l’intervention rattachée', coutIntervention.chantierId);
      const coutSuite = await affaire('refus, coût d’une suite', { conversions: ['CHANTIER', 'INTERVENTION'] });
      const suiteAvecCout = await ok(appeler('post', `/interventions/${coutSuite.interventionId}/suites`, {}), 201);
      await prisma.coutInterventionHeure.create({ data: { interventionId: suiteAvecCout.id, intervenantId: intervenant.id, date: new Date('2026-10-20T00:00:00Z'), nbrHeures: '1', tauxHoraireApplique: '40', createdById: secours.id } });
      await sansEcriture(() => annuler(coutSuite.devis.id), 409, REFUS.coutsSuites, 'coût d’une suite rattachée', coutSuite.chantierId);
      // SAV commencé : intervention du devis en cours, suite en cours, visite du contrat en cours.
      const savEnCours = await affaire('refus, intervention en cours', { conversions: ['CHANTIER', 'INTERVENTION'] });
      await demarrer(savEnCours.interventionId);
      await sansEcriture(() => annuler(savEnCours.devis.id), 409, REFUS.interventionEnCours(await reference(savEnCours.interventionId)), 'intervention du devis en cours', savEnCours.chantierId);
      const suiteEnCours = await affaire('refus, suite en cours', { conversions: ['CHANTIER', 'INTERVENTION'] });
      const suite = await ok(appeler('post', `/interventions/${suiteEnCours.interventionId}/suites`, {}), 201);
      await demarrer(suite.id);
      await sansEcriture(() => annuler(suiteEnCours.devis.id), 409, REFUS.suiteEnCours(suite.reference, await reference(suiteEnCours.interventionId)), 'suite en cours', suiteEnCours.chantierId);
      const visiteEnCours = await affaire('refus, visite en cours', { conversions: ['CHANTIER', 'CONTRAT'] });
      const visite = await ok(appeler('post', `/contrats-maintenance/${visiteEnCours.contratId}/generer-intervention`, {}), 201);
      await demarrer(visite.id);
      await sansEcriture(() => annuler(visiteEnCours.devis.id), 409, REFUS.visiteEnCours(visite.reference), 'visite du contrat en cours', visiteEnCours.chantierId);
      // Chantier encaissé, en cours puis terminé (l'encaissement s'écrit au journal, comme avant : seule cette entrée y reste).
      for (const [quoi, terminer] of [['en cours', false], ['terminé', true]]) {
        const encaisse = await affaire(`refus, encaissé ${quoi}`);
        if (terminer) await ok(changerStatut(encaisse.chantierId, { statut: 'TERMINE' }));
        await ok(appeler('patch', `/chantiers/${encaisse.chantierId}/encaisse`, { encaisse: true }));
        const avant = (await journal(encaisse.chantierId)).map((e) => e.action);
        assert.deepEqual(avant, [...(terminer ? ['CHANGEMENT_STATUT'] : []), 'CHANGEMENT_ENCAISSEMENT'], quoi);
        await sansEcriture(() => annuler(encaisse.devis.id), 409, REFUS.encaisse, `chantier encaissé ${quoi}`, encaisse.chantierId);
        assert.deepEqual((await journal(encaisse.chantierId)).map((e) => e.action), avant, `${quoi} : aucune entrée d’annulation`);
      }
      // Devis déjà annulé : la seconde demande ne réécrit rien, et le journal garde la seule entrée de la première.
      const deuxFois = await affaire('refus, déjà annulé');
      await ok(annuler(deuxFois.devis.id));
      assert.equal((await journal(deuxFois.chantierId)).length, 1);
      for (const [compte, auth] of ADMINISTRATION()) await sansEcriture(() => annuler(deuxFois.devis.id, `${MOTIF} bis`, auth), 400, REFUS.dejaAnnule, `${compte}, devis déjà annulé`, deuxFois.chantierId);
      assert.deepEqual((await journal(deuxFois.chantierId)).map((e) => e.motif), [motifDe(deuxFois.devis, 1)]);

      // Aucun chantier refusé n'est annulé, et aucun n'a d'entrée d'annulation.
      for (const { chantierId } of [base, heures, achat, coutIntervention, coutSuite, savEnCours, suiteEnCours, visiteEnCours]) {
        assert.equal((await ligne(chantierId)).statut, 'EN_COURS');
        assert.equal(await prisma.journalSaisieChantier.count({ where: { chantierId, cible: 'CHANTIER' } }), 0);
      }
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Ligne verrouillée et transaction (cadrage : « sous le verrou du chantier déjà pris (FOR NO KEY UPDATE) », « avant =
    // { statut, dateFin } lus sous le verrou », « dans la même transaction » ; « sans la trace, le changement n'a pas lieu »).
    // ------------------------------------------------------------------------------------------------------------------

    // Cadrage v2, N6 : « clôture et annulation concurrentes (« avant » lu sous le verrou) ». L'annulation attend la ligne du
    // chantier pendant qu'une transaction la clôture (avec ou sans date de fin) ou y saisit une date de fin. Écarte un
    // « avant » lu avant le verrou (il dirait « en cours » sans date de fin), ou relu sur la conversion du devis.
    test('course : chantier clôturé, ou daté, pendant que l’annulation attend sa ligne : l’« avant » de l’entrée est celui de la ligne verrouillée, la date de fin gardée', async () => {
      for (const [quoi, changement, avant] of [
        ['clôturé et daté pendant l’attente', { statut: 'TERMINE', dateFin: DATE_FIN }, { statut: 'TERMINE', dateFin: '2026-10-15T00:00:00.000Z' }],
        ['clôturé sans date pendant l’attente', { statut: 'TERMINE' }, { statut: 'TERMINE', dateFin: null }],
        ['date de fin saisie pendant l’attente', { dateFin: SAISIE }, { statut: 'EN_COURS', dateFin: '2025-12-15T00:00:00.000Z' }],
      ]) {
        const { devis, chantierId } = await affaire(`course, ${quoi}`);
        const { res, attendu } = await sousVerrou(chantierId, () => annuler(devis.id, MOTIF, comptes.AD.auth), (tx) => tx.chantier.update({ where: { id: chantierId }, data: changement }));
        assert.equal(res.status, 200, `${quoi} : ${JSON.stringify(res.body)}`);
        assert.deepEqual(tablesChangees(attendu, await empreinte()), ['Chantier', 'Devis', 'JournalSaisieChantier'], quoi);
        assert.deepEqual((await journal(chantierId)).map(contenu), [attendue(chantierId, comptes.AD, avant, { statut: 'ANNULE', dateFin: avant.dateFin }, motifDe(devis, 1))], quoi);
        const relu = await ligne(chantierId);
        assert.deepEqual([relu.statut, iso(relu.dateFin)], ['ANNULE', avant.dateFin], quoi);
      }
    });

    // Les deux requêtes réelles, lancées ensemble sur la même affaire : clôture par l'administration et annulation du devis
    // se suivent sur la ligne du chantier. L'annulation passe toujours (un chantier terminé s'annule) ; la clôture passe si
    // elle prend la ligne la première, sinon elle est refusée (409, affaire annulée). Dans les deux cas, l'« avant » de
    // l'entrée d'annulation est l'état laissé par ce qui l'a précédée : « en cours » sans date de fin, ou l'« après » de la
    // clôture. Écarte un « avant » lu hors du verrou, et une entrée d'annulation manquante d'un côté de la course.
    test('course réelle : clôture et annulation lancées ensemble ; l’annulation passe toujours et son « avant » est l’état laissé par ce qui l’a précédée', async () => {
      const affaires = [];
      for (let i = 0; i < 6; i += 1) affaires.push(await affaire(`course réelle ${i}`));
      const jours = [jourSociete()];
      const resultats = await Promise.all(affaires.map(async ({ devis, chantierId }, i) => {
        const [annulation, cloture] = i % 2
          ? await Promise.all([annuler(devis.id), changerStatut(chantierId, { statut: 'TERMINE' }, comptes.DIR.auth)])
          : (await Promise.all([changerStatut(chantierId, { statut: 'TERMINE' }, comptes.DIR.auth), annuler(devis.id)])).reverse();
        return { devis, chantierId, annulation, cloture };
      }));
      jours.push(jourSociete());
      for (const { devis, chantierId, annulation, cloture } of resultats) {
        const quoi = `${annulation.status}/${cloture.status} ${JSON.stringify([annulation.body.error, cloture.body.error])}`;
        assert.equal(annulation.status, 200, quoi);
        const relu = await ligne(chantierId);
        assert.equal(relu.statut, 'ANNULE', quoi);
        const entrees = (await journal(chantierId)).map(contenu);
        if (cloture.status === 200) {
          const jour = cloture.body.dateFin;
          assert.ok(jours.includes(jour), `${quoi} : date de fin au jour de la société`);
          assert.deepEqual(entrees, [
            attendue(chantierId, comptes.DIR, { statut: 'EN_COURS', dateFin: null }, { statut: 'TERMINE', dateFin: jour }, null),
            attendue(chantierId, secours, { statut: 'TERMINE', dateFin: jour }, { statut: 'ANNULE', dateFin: jour }, motifDe(devis, 1)),
          ], quoi);
          assert.equal(iso(relu.dateFin), jour, quoi);
        } else {
          assert.deepEqual([cloture.status, cloture.body.error], [409, 'Cette affaire est annulée : son statut ne change plus.'], quoi);
          assert.deepEqual(entrees, [attendue(chantierId, secours, { statut: 'EN_COURS', dateFin: null }, { statut: 'ANNULE', dateFin: null }, motifDe(devis, 1))], quoi);
          assert.equal(relu.dateFin, null, quoi);
        }
      }
    });

    // Cadrage : « dans la même transaction » ; « Sans la trace, le changement n'a pas lieu » (#181). L'écriture de l'entrée
    // refusée par la base (déclencheur de test, sur ce seul chantier) : l'annulation échoue (500) sans rien écrire, ni le
    // devis, ni le chantier, ni l'intervention du devis. Dans l'autre sens, la mise à jour du chantier refusée, puis celle du
    // devis (dernière écriture de l'annulation) : l'entrée part avec elles. Écarte une entrée écrite hors de la
    // transaction (avant elle, ou validée à part), et une annulation qui passerait sans sa trace.
    test('sans la trace, l’annulation n’a pas lieu ; sans l’écriture du chantier ou du devis, la trace non plus (même transaction)', async () => {
      const { devis, chantierId, interventionId } = await affaire('même transaction', { conversions: ['CHANTIER', 'INTERVENTION'] });
      const essayer = async (quoi) => {
        await sansEcriture(() => annuler(devis.id), 500, 'Opération devis impossible.', quoi, chantierId);
        assert.deepEqual([(await ligne(chantierId)).statut, await statutDevis(devis.id), (await prisma.intervention.findUniqueOrThrow({ where: { id: interventionId } })).statut], ['EN_COURS', 'ACCEPTE', 'A_PLANIFIER'], quoi);
      };
      const poser = async (nom, table, condition, message) => {
        await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "${nom}"()
          RETURNS TRIGGER AS $$ BEGIN
            IF ${condition} THEN RAISE EXCEPTION '${message}'; END IF;
            RETURN NEW;
          END; $$ LANGUAGE plpgsql;`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER "${nom}" BEFORE ${table === 'JournalSaisieChantier' ? 'INSERT' : 'UPDATE'} ON "${table}" FOR EACH ROW EXECUTE FUNCTION "${nom}"()`);
      };
      const retirer = async (nom, table) => {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${nom}" ON "${table}"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${nom}"()`);
      };
      for (const [quoi, nom, table, condition] of [
        ['entrée du journal du chantier refusée par la base', 'test_refuser_journal_agc', 'JournalSaisieChantier', `NEW."chantierId" = '${chantierId}'`],
        ['mise à jour du chantier refusée par la base', 'test_refuser_chantier_agc', 'Chantier', `NEW."id" = '${chantierId}'`],
        ['mise à jour du devis refusée par la base', 'test_refuser_devis_agc', 'Devis', `NEW."id" = '${devis.id}'`],
      ]) {
        await poser(nom, table, condition, `${quoi} pour le test du lot AG-c`);
        try {
          await essayer(quoi);
        } finally {
          await retirer(nom, table);
        }
      }
      // Témoin : sans déclencheur, l'annulation passe, avec son entrée.
      const { duChantier } = await annulationAdmise(() => annuler(devis.id), 'témoin', chantierId);
      assert.deepEqual(duChantier.map(contenu), [attendue(chantierId, secours, { statut: 'EN_COURS', dateFin: null }, { statut: 'ANNULE', dateFin: null }, motifDe(devis, 1))]);
    });

    // ------------------------------------------------------------------------------------------------------------------
    // Auteur figé, lecture par la fiche, suppression du compte auteur (cadrage v2, N8 à N10).
    // ------------------------------------------------------------------------------------------------------------------

    // Cadrage : « auteur et nom figés à l'acte » ; critère : « la fiche l'affiche » ; v2, C2 : « à périmètre inchangé,
    // chacun n'y lit, en plus de cette entrée, que ce qu'il pouvait y lire avant ». Le conducteur titulaire lit l'entrée de
    // l'annulation de son affaire, telle qu'écrite ; un autre conducteur reçoit 404. L'administrateur qui a annulé, renommé
    // puis désactivé, reste l'auteur sous le nom de l'acte ; la duplication du devis annulé (voie de reprise) n'écrit rien
    // au journal de l'ancien chantier. Écarte : un nom relu sur le compte à la lecture ; une entrée invisible de la fiche ;
    // une écriture au journal de l'affaire annulée par sa reprise.
    test('auteur figé et lecture par la fiche : le conducteur titulaire lit l’entrée de l’annulation, un autre conducteur reçoit 404 ; renommé puis désactivé, l’administrateur reste l’auteur sous le nom de l’acte ; la duplication du devis annulé n’écrit rien à ce journal', async () => {
      const administrateur = await creerCompte('ADMIN', 'AD-FIGE');
      const { devis, chantierId } = await affaire('auteur figé');
      const { duChantier } = await annulationAdmise(() => annuler(devis.id, MOTIF, administrateur.auth), 'annulation', chantierId);
      const [entree] = duChantier;
      const nomDeLActe = administrateur.name;
      const attenduLu = [entree.id, 'CHANTIER', 'CHANGEMENT_STATUT', administrateur.id, nomDeLActe, { statut: 'EN_COURS', dateFin: null }, { statut: 'ANNULE', dateFin: null }, motifDe(devis, 1)];
      const lu = await ok(appeler('get', `/chantiers/${chantierId}/journal-saisies`, undefined, comptes.CT.auth));
      assert.deepEqual(lu.map((e) => [e.id, e.cible, e.action, e.auteurId, e.auteurNom, e.avant, e.apres, e.motif]), [attenduLu], 'le conducteur titulaire lit l’entrée');
      await sansEcriture(() => appeler('get', `/chantiers/${chantierId}/journal-saisies`, undefined, comptes.CT2.auth), 404, REFUS.introuvable, 'autre conducteur, lecture du journal');
      await prisma.user.update({ where: { id: administrateur.id }, data: { name: `TEST AD renommé ${suffixe()}` } });
      await ok(appeler('patch', `/users/${administrateur.id}/actif`, { actif: false }));
      const duplicata = await ok(appeler('post', `/devis/${devis.id}/duplication`, {}), 201);
      assert.notEqual(duplicata.id, devis.id);
      const relu = await ok(appeler('get', `/chantiers/${chantierId}/journal-saisies`));
      assert.deepEqual(relu.map((e) => [e.id, e.cible, e.action, e.auteurId, e.auteurNom, e.avant, e.apres, e.motif]), [attenduLu], 'nom figé à l’acte ; rien d’écrit par la duplication');
    });

    // Cadrage v2, N8 à N10 : « un administrateur qui a annulé une affaire ouverte seulement en chantier devient non
    // supprimable, 409, seulement désactivable ». Avant le lot, rien ne le rendait auteur de données tracées (ni journal
    // d'intervention, ni journal de contrat). Témoin : un administrateur qui n'a annulé qu'un devis non converti se
    // supprime (200). Écarte une annulation sans entrée (la suppression passerait) et une entrée au nom du titulaire.
    test('suppression d’un administrateur qui n’a annulé qu’une affaire ouverte en chantier : refusée (409 « auteur de données tracées »), sans rien écrire ; il se désactive ; témoin : un administrateur qui n’a annulé qu’un devis non converti se supprime', async () => {
      const auteur = await creerCompte('ADMIN', 'AD-AUTEUR');
      const temoin = await creerCompte('ADMIN', 'AD-TEMOIN');
      const { devis, chantierId } = await affaire('suppression de l’auteur');
      await annulationAdmise(() => annuler(devis.id, MOTIF, auteur.auth), 'annulation par l’auteur', chantierId);
      const nonConverti = await creerDevis('suppression du témoin');
      await annulationAdmise(() => annuler(nonConverti.id, MOTIF, temoin.auth), 'annulation par le témoin');
      assert.equal(await prisma.journalSaisieChantier.count({ where: { auteurId: auteur.id } }), 1);
      assert.equal(await prisma.journalSaisieChantier.count({ where: { auteurId: temoin.id } }), 0);
      assert.deepEqual((await journal(chantierId)).map((e) => [e.cible, e.action, e.auteurId]), [['CHANTIER', 'CHANGEMENT_STATUT', auteur.id]], 'l’entrée est au nom de l’administrateur qui annule, et non du titulaire');
      await sansEcriture(() => appeler('delete', `/users/${auteur.id}`), 409, REFUS.auteurTrace, 'suppression de l’administrateur qui a annulé l’affaire');
      assert.ok(await prisma.user.findUnique({ where: { id: auteur.id } }));
      await ok(appeler('patch', `/users/${auteur.id}/actif`, { actif: false }));
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: auteur.id } })).actif, false, 'désactivé');
      await ok(appeler('delete', `/users/${temoin.id}`));
      assert.equal(await prisma.user.findUnique({ where: { id: temoin.id } }), null, 'témoin supprimé');
      assert.equal(await statutDevis(nonConverti.id), 'ANNULE');
    });
  });
}
