// Lot #587, volet montants : encaissement d'un chantier, barème réduit de sa fiche et suivi administratif d'un commercial
// lus en booléen strict (cadrage v3, rédigée par le controleur-coherence sur main à dcdc2e4, sections « Périmètre »,
// « Critères observables » et « Tests » ; issue #587, commentaire d'état du 18-11-2026 après #596 ; messages de Nelson
// du 17-11-2026, « Ok continu », et du 18-11-2026, « Reprend, cela devrais fonctionner maintenant que je l'ai repasser
// en public »). Règle 2 de la méthode : l'encaissement fait entrer un chantier terminé dans le chiffre d'affaires et la
// marge validés du commercial (commissions/metier.ts) ; le barème réduit et le suivi administratif sont aujourd'hui sans
// effet sur un montant (aucun plan commercial, décision du 17-10-2026), et le plan commercial les reprendra.
//
// Avant le lot, les trois champs étaient lus par `!!req.body.x` : « false » ou 1 encaissaient le chantier, posaient le
// barème réduit ou accordaient le suivi ; une clé absente ou null désencaissait le chantier (il sortait du chiffre
// d'affaires validé) et effaçait sa date d'encaissement, retirait le suivi ou créait une ligne de prime sans journal ;
// null effaçait le barème.
//
// Lectures appliquées (cadrage v3, à reprendre dans la PR) :
//  - encaissement : drapeau obligatoire ; lecture retenue, à confirmer par Nelson (touche un montant) ; ordre (choix par
//    défaut, à confirmer) : 401, 403 de requireAdmin, puis, sous le verrou de la ligne, 404 « Chantier introuvable »,
//    409 de l'affaire annulée (« quel que soit le corps », #449, inchangé), enfin le 400 du drapeau, avant
//    l'enregistrement à l'identique et toute écriture ;
//  - barème réduit : champ facultatif, la clé absente garde la valeur ; null refusé (lecture retenue, à confirmer par
//    Nelson) ; contrôlé avec les autres contrôles de forme de la fiche, après le périmètre, l'état de l'affaire, le
//    statut, le client, le numéro de devis, le titulaire, le montant vendu, les champs numériques et les dates, et avant
//    la transaction ;
//  - suivi administratif : drapeau obligatoire (choix par défaut, à confirmer) ; contrôlé après la période et avant
//    toute lecture en base (404 du commercial, verrou, upsert, journal) ; une requête sans corps JSON répond 400 de la
//    période, et non plus 500 (cadrage v3, périmètre 3, « Corps absent » : choix du code, `req.body?.periode`).
//
// Ce que prouve ce fichier, par des requêtes HTTP réelles : chaque écriture admise relue en base ; chaque refus prouvé
// sans écriture par l'empreinte de toute la base (chaque table du schéma public, contenu compris, `updatedAt` compris),
// la relecture de la cible (chantier entier ; lignes de prime du commercial) et le décompte des deux journaux (journal
// des saisies du chantier, journal d'administration).
//
// Fichier propre au lot, avec sa base jetable : `node --test` exécute les fichiers en parallèle, et api.test.mjs purge
// les données « TEST » de TEST_DATABASE_URL. TEST_DATABASE_URL ne sert ici que de connexion administrative : une base
// neuve est créée, migrée, servie à l'application montée en mémoire, puis supprimée. Sans TEST_DATABASE_URL, le fichier
// s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { empreinteBase, tablesChangees, tablesDeLaBase } from './matrice-droits/outils.mjs';

const TITRE = 'Lot #587 (montants) : encaissement, barème réduit et suivi administratif lus en booléen strict';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Message du drapeau refusé (cadrage v3, périmètre 1 à 3), puis messages existants que le lot range avant lui.
const REFUS_DRAPEAU = (cle) => `« ${cle} » doit valoir true ou false.`;
const MESSAGES = {
  authentification: 'Authentification requise',
  compteDesactive: { code: 'COMPTE_DESACTIVE', error: 'Ce compte est désactivé.' },
  session: 'Session expirée ou invalide',
  administrateurs: 'Accès réservé aux administrateurs',
  compteCommercial: 'Accès non autorisé pour un compte commercial.',
  chantierIntrouvable: 'Chantier introuvable',
  encaissementAnnulee: 'Cette affaire est annulée : elle ne peut pas être encaissée.',
  ficheAnnulee: 'Cette affaire est annulée : elle n’est plus modifiable.',
  ficheCloture: 'Ce chantier est clôturé : seul un administrateur peut encore le modifier.',
  technicienFiche: 'Un compte technicien n’est pas autorisé à modifier une affaire. Adressez-vous à votre responsable.',
  statutParLaFiche: 'Le statut d’un chantier ne se change pas par sa fiche : clôturez-le ou rouvrez-le depuis la liste des chantiers.',
  clientIntrouvable: 'Client introuvable.',
  numeroDevisFormat: 'La référence d’affaire doit être au format AAA-NNNN : un A, l’année sur deux chiffres, un tiret et le rang (exemple : A26-0001).',
  numeroDevisPris: (numero) => `Le devis ${numero} est déjà rattaché à un autre chantier.`,
  titulaireVide: 'Un chantier doit toujours avoir un conducteur responsable.',
  titulaireIntrouvable: 'Conducteur responsable introuvable.',
  montantVendu: 'Le montant vendu n’est modifiable que par qui suit la rentabilité de ce chantier.',
  budgetMateriel: 'Le budget matériel doit être un montant positif ou nul, d’au plus 10 chiffres avant la virgule et 2 après.',
  heures: 'Les heures vendues doivent être un nombre positif ou nul, d’au plus 8 chiffres avant la virgule et 2 après.',
  dateDebut: 'La date de début doit être valide au format JJ-MM-AAAA.',
  dateFin: 'La date de fin doit être valide au format JJ-MM-AAAA.',
  dateFinVidee: 'Un chantier terminé garde sa date de fin : elle fixe le mois de son chiffre d’affaires validé. Vous pouvez la changer, pas la vider.',
  periode: 'Période invalide (attendu "YYYY-MM").',
  commercialIntrouvable: 'Commercial introuvable.',
};

// Valeurs présentes non admises (cadrage v3, « Critères observables » : « "false", "true", 0, 1, null, {} (objet), [] » ;
// null refusé). « 0 », la chaîne vide et [true] écartent un lecteur qui n'accepterait que quelques chaînes, convertirait
// une chaîne ou lirait le premier élément d'un tableau ; « false » et 0 écartent `!!` (vrai) et `Boolean()`, « true » et 1
// une conversion qui les lirait vrai.
const VALEURS_REFUSEES = [
  ['la chaîne « false »', 'false'], ['la chaîne « true »', 'true'], ['la chaîne « 0 »', '0'], ['la chaîne vide', ''],
  ['le nombre 0', 0], ['le nombre 1', 1], ['null', null], ['un objet vide', {}], ['un tableau vide', []], ['le tableau [true]', [true]],
];
// Envois refusés d'un drapeau obligatoire (cadrage v3, périmètre 1 : « Une clé absente, un corps absent, un corps qui
// n'est pas un objet ou une valeur non booléenne (null compris) répond 400 ») : chaque valeur non admise, la clé absente,
// une clé voisine seule, un corps tableau et une requête sans corps JSON (sans Content-Type, JSON vide, texte brut,
// formulaire ; Express 5 laisse alors req.body à undefined).
const envoisDrapeauObligatoire = (cle, voisine) => [
  ...VALEURS_REFUSEES.map(([nom, valeur]) => ({ nom: `${cle} vaut ${nom}`, envoyer: (r) => r.send({ [cle]: valeur }) })),
  { nom: 'clé absente (corps {})', envoyer: (r) => r.send({}) },
  { nom: `clé voisine seule (${voisine}: true)`, envoyer: (r) => r.send({ [voisine]: true }) },
  { nom: 'corps tableau vide', envoyer: (r) => r.send([]) },
  { nom: `corps tableau [{ ${cle}: true }]`, envoyer: (r) => r.send([{ [cle]: true }]) },
  { nom: 'sans corps ni Content-Type', envoyer: (r) => r },
  { nom: 'Content-Type JSON sans corps', envoyer: (r) => r.set('Content-Type', 'application/json') },
  { nom: 'texte brut', envoyer: (r) => r.set('Content-Type', 'text/plain').send(`${cle}=true`) },
  { nom: 'formulaire', envoyer: (r) => r.type('form').send(`${cle}=true`) },
];

// Valeurs de départ d'un chantier de test, distinctes de toute valeur envoyée : une écriture, même partielle, se voit.
const DEPART = {
  budgetGlobalVendu: '1234.56', budgetMaterielVendu: '345.67', budgetMainOeuvreVendu: '456.78', heuresVendues: '12.34',
  dateDebut: new Date('2026-09-01T00:00:00.000Z'), adresse: 'TEST 1 rue de départ 587', types: ['Alarme'],
};
const DATE_ENCAISSEMENT = new Date('2026-10-10T09:00:00.000Z');
const ENCAISSE = { encaisse: true, dateEncaissement: DATE_ENCAISSEMENT };
const TERMINE = { statut: 'TERMINE', dateFin: new Date('2026-10-15T00:00:00.000Z') };
// Comptes refusés par requireAdmin, titulaire du chantier compris pour CT (cadrage v3, « Ordre », encaissement : « 403
// (CT, technicien, commercial, assistante technique) avant tout ») ; et pour la prime.
const HORS_ADMINISTRATION = ['CT', 'RESP', 'DC', 'AC', 'CPT', 'TECH', 'COM', 'AT'];

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_chbool587_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const cibleApplication = new URL(cible);
    cibleApplication.searchParams.set('connection_limit', '12');
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;

    let request; let app; let prisma; let appPrisma; let jwt;
    let tables = [];
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const comptes = {};
    const clients = {};
    let rang = 0;
    const suffixe = () => `${Date.now()}-${(rang += 1)}`;
    const creerCompte = async (code, role, extra = {}) => {
      const s = suffixe();
      const compte = await prisma.user.create({ data: { email: `chbool587.${code.toLowerCase()}.${s}@iris.test`, name: `TEST ${code} 587 ${s}`, role, ...extra } });
      comptes[code] = { ...compte, auth: entete(jwt.sign({ id: compte.id }, process.env.JWT_SECRET)) };
      return comptes[code];
    };
    // Les quatre comptes de l'administration (cadrage v3, « Critères observables » : « SA, AD, admin « aussi
    // commercial », DIR » ; le directeur a les droits de l'administration, décision du 24-10-2026, point 14).
    const ADMINISTRATION = () => ['SA', 'AD', 'AD-COM', 'DIR'].map((code) => [code, comptes[code].auth]);
    // Comptes qui écrivent la fiche d'un chantier en cours (cadrage v3, « Tests » : « pour le barème, l'administration,
    // l'assistante technique et un conducteur titulaire »).
    const ECRIVENT_LA_FICHE = () => [...ADMINISTRATION(), ['AT', comptes.AT.auth], ['CT titulaire', comptes.CT.auth]];

    // --- État de la base ---
    const empreinte = (client = prisma) => empreinteBase(client, tables);
    const chantierEnBase = async (id) => JSON.parse(JSON.stringify(await prisma.chantier.findUnique({ where: { id } })));
    const primesEnBase = async (commercialId) => JSON.parse(JSON.stringify(await prisma.primeMensuelleCommercial.findMany({ where: { commercialId }, orderBy: { periode: 'asc' } })));
    const journalChantier = (chantierId) => prisma.journalSaisieChantier.findMany({ where: { chantierId }, orderBy: { createdAt: 'asc' } });
    const idsJournalAdministration = async () => new Set((await prisma.journalAdministration.findMany({ select: { id: true } })).map((e) => e.id));
    const entreesAdministrationDepuis = async (avant) => (await prisma.journalAdministration.findMany({ orderBy: { createdAt: 'asc' } }))
      .filter((e) => !avant.has(e.id))
      .map(({ id: _id, createdAt: _date, ...reste }) => reste);

    // Un refus : statut et corps exacts ; aucune écriture dans toute la base ; la cible relue identique (`updatedAt`
    // compris) ; aucune entrée nouvelle au journal des saisies ni au journal d'administration. Sans corps attendu
    // (`undefined`), un appel admis qui ne doit rien écrire (encaissement à l'identique).
    const refuse = async (envoi, statut, attendu, quoi, relire = null) => {
      const avant = await empreinte();
      const cibleAvant = relire ? await relire() : null;
      const saisiesAvant = await prisma.journalSaisieChantier.count();
      const administrationAvant = await prisma.journalAdministration.count();
      const res = await envoi();
      assert.equal(res.status, statut, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      if (attendu !== undefined) assert.deepEqual(res.body, typeof attendu === 'string' ? { error: attendu } : attendu, quoi);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      if (relire) assert.deepEqual(await relire(), cibleAvant, `${quoi} : cible relue en base, updatedAt compris`);
      assert.equal(await prisma.journalSaisieChantier.count(), saisiesAvant, `${quoi} : aucune entrée au journal des saisies`);
      assert.equal(await prisma.journalAdministration.count(), administrationAvant, `${quoi} : aucune entrée au journal d’administration`);
      return res;
    };
    const ok = async (promesse, statut = 200) => {
      const res = await promesse;
      assert.equal(res.status, statut, `${res.req?.method} ${res.req?.path} : ${JSON.stringify(res.body)}`);
      return res.body;
    };
    const requete = (methode, chemin, auth) => (auth ? request(app)[methode](chemin).set(auth) : request(app)[methode](chemin));
    const encaissement = (id, auth) => requete('patch', `/api/chantiers/${id}/encaisse`, auth);
    const fiche = (id, auth) => requete('patch', `/api/chantiers/${id}`, auth);
    const prime = (id, auth) => requete('put', `/api/commerciaux/${id}/prime-mensuelle`, auth);

    // --- Données ---
    const creerChantier = (extra = {}) => prisma.chantier.create({ data: {
      nom: `TEST Chantier 587 ${suffixe()}`, client: clients.A.raisonSociale, clientId: clients.A.id, ...DEPART,
      responsableId: comptes.CT.id, commercialId: comptes.COM.id, ...extra,
    } });
    const ANNULATION = () => ({ statut: 'ANNULE', annuleLe: new Date('2026-10-20T08:00:00.000Z'), annuleParId: comptes.SA.id, motifAnnulation: 'TEST annulation posée en base 587' });
    const nouveauCommercial = async (extra = {}) => {
      const s = suffixe();
      return prisma.user.create({ data: { email: `chbool587.commercial.${s}@iris.test`, name: `TEST Commercial cible 587 ${s}`, role: 'COMMERCIAL', ...extra } });
    };

    // Une transaction de test tient la ligne du chantier (FOR UPDATE) : la requête part et attend ce verrou (constaté par
    // pg_blocking_pids) ; la transaction change alors la ligne et valide. L'état attendu après la réponse est relevé
    // dans la transaction, une fois le changement fait : la requête refusée n'y change rien. Modèle : `sousVerrou` de
    // chantier-annule-termine.test.mjs. Relevé court : la transaction de la requête expire au bout de 5 s.
    const sousVerrou = async (chantierId, lancer, changer) => {
      let reponse; let attendu;
      await prisma.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        await tx.$queryRaw`SELECT "id" FROM "Chantier" WHERE "id" = ${chantierId} FOR UPDATE`;
        reponse = lancer().then((r) => r, (erreur) => ({ status: 'erreur', body: String(erreur) }));
        let attente = false;
        for (let tour = 0; tour < 150 && !attente; tour += 1) {
          attente = (await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`)[0].n > 0;
          if (!attente) await pause(20);
        }
        assert.equal(attente, true, 'la requête attend la ligne verrouillée du chantier');
        await changer(tx);
        attendu = await empreinte(tx);
      }, { timeout: 30_000, maxWait: 10_000 });
      return { res: await reponse, attendu };
    };

    before(async () => {
      assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname), 'seul un PostgreSQL local est autorisé');
      assert.notEqual(source.pathname.slice(1), nomBase);
      await administrationPg.connect();
      await administrationPg.query(`CREATE DATABASE "${nomBase}"`);
      baseCreee = true;
      execFileSync(resolve(dossierServeur, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', resolve(dossierServeur, 'prisma/schema.prisma')], {
        env: { ...process.env, DATABASE_URL: cible.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
      });
      process.env.DATABASE_URL = cibleApplication.toString();
      process.env.NODE_ENV = 'test';
      process.env.JWT_SECRET = 'secret-de-test-uniquement';
      process.env.BREAK_GLASS_EMAIL = 'secours@iris.test';
      process.env.BREAK_GLASS_TOKEN = 'jeton-de-secours-de-test-au-moins-32-caracteres';
      process.env.SUPERADMIN_EMAILS = 'secours@iris.test';
      request = (await import('supertest')).default;
      const serveur = await import('../dist/index.js');
      app = serveur.app;
      appPrisma = serveur.prisma;
      const { PrismaClient } = await import('@prisma/client');
      prisma = new PrismaClient({ datasources: { db: { url: cible.toString() } } });
      jwt = (await import('jsonwebtoken')).default;
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      const secours = await prisma.user.findUniqueOrThrow({ where: { email: 'secours@iris.test' } });
      assert.equal(secours.role, 'SUPERADMIN');
      comptes.SA = { ...secours, auth: entete(connexion.body.token) };
      await creerCompte('AD', 'ADMIN');
      await creerCompte('AD-COM', 'ADMIN', { estCommercial: true });
      await creerCompte('DIR', 'DIRECTEUR');
      await creerCompte('AD-DESACTIVE', 'ADMIN', { actif: false });
      for (const [code, role] of [['CT', 'CONDUCTEUR_TRAVAUX'], ['CT2', 'CONDUCTEUR_TRAVAUX'], ['RESP', 'RESPONSABLE'], ['DC', 'DIRECTEUR_COMMERCIAL'],
        ['AC', 'ASSISTANTE_COMMERCIALE'], ['CPT', 'COMPTABLE'], ['TECH', 'TECHNICIEN'], ['COM', 'COMMERCIAL'], ['AT', 'ASSISTANTE_TECHNIQUE']]) {
        await creerCompte(code, role);
      }
      clients.A = await prisma.client.create({ data: { raisonSociale: `TEST Client A 587 ${suffixe()}` } });
      clients.B = await prisma.client.create({ data: { raisonSociale: `TEST Client B 587 ${suffixe()}` } });
      // Réglages créés à leur première lecture (getParametres, lu par la fiche et par la réponse de l'encaissement) :
      // avant la première empreinte, pour qu'une lecture ne passe pas pour une écriture.
      await ok(request(app).get('/api/parametres').set(comptes.SA.auth));
      assert.equal((await prisma.parametres.findMany()).length, 1, 'réglages créés');
      tables = await tablesDeLaBase(prisma);
      assert.ok(['Chantier', 'JournalSaisieChantier', 'PrimeMensuelleCommercial', 'JournalAdministration'].every((t) => tables.includes(t)) && tables.length > 40, `tables relevées : ${tables.join(', ')}`);
    });

    // #552 : la connexion administrative est fermée même si la suppression de la base échoue ; une connexion de
    // l'application rouverte pendant la suppression la fait échouer : elle est retentée deux fois.
    after(async () => {
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      try {
        for (let essai = 1; baseCreee; essai += 1) {
          try {
            await administrationPg.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`);
            baseCreee = false;
          } catch (erreur) {
            if (essai >= 3) throw erreur;
            await pause(500);
          }
        }
      } finally {
        await administrationPg.end().catch(() => {});
      }
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 1. Encaissement d'un chantier (PATCH /api/chantiers/:id/encaisse)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v3, périmètre 1 et critère « Encaissement » : « "false", "true", 0, 1, null, {} (objet), [], une clé absente,
    // un corps tableau et une requête sans corps JSON (sans Content-Type, puis en text/plain) répondent 400 au message
    // exact, par chacun des quatre comptes d'administration […] sur un chantier existant non annulé, encaissé et non
    // encaissé […]. Le chantier est inchangé (encaisse, dateEncaissement, updatedAt, relus en base) et aucune entrée n'est
    // écrite au journal des saisies du chantier. » Lecture retenue, à confirmer par Nelson : avant le lot, {} ou null
    // retiraient le chantier du chiffre d'affaires validé, et « false » l'y faisait entrer.
    test('encaissement : chaque valeur non booléenne, la clé absente, un corps tableau ou une requête sans corps JSON répond 400 « « encaisse » doit valoir true ou false. », par chacun des quatre comptes de l’administration, sur un chantier en cours ou terminé, encaissé ou non ; rien n’est écrit', async () => {
      const chantiers = [
        ['en cours, non encaissé', await creerChantier()],
        ['en cours, encaissé', await creerChantier(ENCAISSE)],
        ['terminé, non encaissé', await creerChantier(TERMINE)],
        ['terminé, encaissé', await creerChantier({ ...TERMINE, ...ENCAISSE })],
      ];
      for (const [etat, chantier] of chantiers) {
        for (const [qui, auth] of ADMINISTRATION()) {
          for (const envoi of envoisDrapeauObligatoire('encaisse', 'encaissement')) {
            await refuse(() => envoi.envoyer(encaissement(chantier.id, auth)), 400, REFUS_DRAPEAU('encaisse'), `${qui}, chantier ${etat}, ${envoi.nom}`, () => chantierEnBase(chantier.id));
          }
        }
      }
      for (const [etat, chantier] of chantiers) {
        const relu = await chantierEnBase(chantier.id);
        assert.deepEqual([relu.encaisse, relu.dateEncaissement], etat.endsWith('non encaissé') ? [false, null] : [true, DATE_ENCAISSEMENT.toISOString()], `chantier ${etat} : état d’encaissement intact`);
        assert.deepEqual(await journalChantier(chantier.id), [], `chantier ${etat} : journal vide`);
      }
    });

    // Cadrage v3, « Ordre » et critère « 400 avant l'enregistrement à l'identique » : « {} et "false" sur un chantier non
    // encaissé compris : 400, et non 200 à l'identique ». Tue le mutant « 400 placé après l'enregistrement à l'identique »
    // (comparaison `ligne.encaisse === !!…` avant le refus) : sous ce mutant, les valeurs que `!!` lit faux répondraient
    // 200 sur un chantier non encaissé, et celles qu'il lit vrai 200 sur un chantier encaissé, sans rien écrire. Témoins :
    // le booléen égal à l'état répond 200 sans écriture (l'enregistrement à l'identique est inchangé, #181).
    test('encaissement, ordre : le 400 du drapeau passe avant l’enregistrement à l’identique (valeurs lues faux par `!!` sur un chantier non encaissé, lues vrai sur un chantier encaissé) ; le booléen égal à l’état répond 200 sans rien écrire', async () => {
      const nonEncaisse = await creerChantier();
      const encaisse = await creerChantier(ENCAISSE);
      for (const [qui, auth] of ADMINISTRATION()) {
        for (const corps of [{}, { encaisse: null }, { encaisse: 0 }, { encaisse: '' }, { encaissement: false }]) {
          await refuse(() => encaissement(nonEncaisse.id, auth).send(corps), 400, REFUS_DRAPEAU('encaisse'), `${qui}, non encaissé, ${JSON.stringify(corps)}`, () => chantierEnBase(nonEncaisse.id));
        }
        await refuse(() => encaissement(nonEncaisse.id, auth), 400, REFUS_DRAPEAU('encaisse'), `${qui}, non encaissé, sans corps`, () => chantierEnBase(nonEncaisse.id));
        for (const corps of [{ encaisse: 'false' }, { encaisse: 'true' }, { encaisse: 1 }, { encaisse: [true] }, { encaisse: {} }, { encaisse: 'oui' }]) {
          await refuse(() => encaissement(encaisse.id, auth).send(corps), 400, REFUS_DRAPEAU('encaisse'), `${qui}, encaissé, ${JSON.stringify(corps)}`, () => chantierEnBase(encaisse.id));
        }
        // Témoins : à l'identique, admis, sans écriture (ni chantier, ni updatedAt, ni journal).
        const identiqueNon = await refuse(() => encaissement(nonEncaisse.id, auth).send({ encaisse: false }), 200, undefined, `${qui}, non encaissé, false à l’identique`, () => chantierEnBase(nonEncaisse.id));
        assert.deepEqual([identiqueNon.body.encaisse, identiqueNon.body.dateEncaissement], [false, null], `${qui} : réponse à l’identique`);
        const identiqueOui = await refuse(() => encaissement(encaisse.id, auth).send({ encaisse: true }), 200, undefined, `${qui}, encaissé, true à l’identique`, () => chantierEnBase(encaisse.id));
        assert.deepEqual([identiqueOui.body.encaisse, identiqueOui.body.dateEncaissement], [true, DATE_ENCAISSEMENT.toISOString()], `${qui} : la date d’encaissement ne change pas`);
      }
    });

    // Cadrage v3, « Ordre » (encaissement) : « 401, 403 (CT, technicien, commercial, assistante technique) avant tout ;
    // 404 du chantier inconnu et 409 de l'affaire annulée (annulée et encaissée comprise) avant le 400, quel que soit le
    // corps » ; « Règle existante gardée, sans retouche » : 409 « quel que soit le corps » (#449, décision de Nelson du
    // 02-11-2026 sur #285, « une affaire annulé ne peut etre encaissé »). Facultatif (T) du cadrage, joué ici : une valeur
    // présente invalide (« x ») sur un chantier inconnu (404) et sur une affaire annulée (409). Tue « 400 placé avant le
    // 409, ou avant le 404 (en tête du gestionnaire) » et « contrôle placé avant requireAdmin ». Depuis le lot AG-a (#451,
    // cadrage v2 du 26-11-2026, périmètre 1 ; N5 de l'audit des montants de #449), une affaire annulée et encaissée ne se
    // pose plus en base (contrainte `Chantier_annule_non_encaisse`, 23514) : la base refuse la ligne, au nom de la
    // contrainte, sans rien écrire, et le 409 se prouve sur l'affaire annulée non encaissée.
    test('encaissement, ordre : 401 et 403 des gardes d’abord, titulaire compris ; puis le 404 du chantier inconnu et le 409 de l’affaire annulée, quel que soit le corps, avant le 400 du drapeau ; rien n’est écrit ; une affaire annulée et encaissée est refusée par la base', async () => {
      const chantier = await creerChantier();
      const annulee = await creerChantier(ANNULATION());
      const avantRefusBase = await empreinte();
      await assert.rejects(creerChantier({ ...ANNULATION(), ...ENCAISSE }), (erreur) => {
        assert.match(String(erreur.message), /code: \\?"23514\\?"/, erreur.message);
        assert.match(String(erreur.message), /violates check constraint \\?"Chantier_annule_non_encaisse\\?"/, erreur.message);
        return true;
      }, 'affaire annulée et encaissée posée en base');
      assert.deepEqual(tablesChangees(avantRefusBase, await empreinte()), [], 'affaire annulée et encaissée refusée par la base : rien n’est écrit');
      const corpsGardes = [{ encaisse: 'false' }, {}, { encaisse: null }, { encaisse: true }, { encaisse: false }];
      for (const corps of corpsGardes) {
        await refuse(() => encaissement(chantier.id).send(corps), 401, MESSAGES.authentification, `sans session, ${JSON.stringify(corps)}`, () => chantierEnBase(chantier.id));
        await refuse(() => encaissement(chantier.id, comptes['AD-DESACTIVE'].auth).send(corps), 401, MESSAGES.compteDesactive, `administrateur désactivé, ${JSON.stringify(corps)}`, () => chantierEnBase(chantier.id));
        for (const code of HORS_ADMINISTRATION) {
          await refuse(() => encaissement(chantier.id, comptes[code].auth).send(corps), 403, MESSAGES.administrateurs, `${code}${code === 'CT' ? ' titulaire' : ''}, ${JSON.stringify(corps)}`, () => chantierEnBase(chantier.id));
          await refuse(() => encaissement(annulee.id, comptes[code].auth).send(corps), 403, MESSAGES.administrateurs, `${code}, affaire annulée, ${JSON.stringify(corps)}`, () => chantierEnBase(annulee.id));
        }
      }
      await refuse(() => encaissement(chantier.id), 401, MESSAGES.authentification, 'sans session, sans corps', () => chantierEnBase(chantier.id));
      await refuse(() => encaissement(chantier.id, comptes.TECH.auth), 403, MESSAGES.administrateurs, 'technicien, sans corps', () => chantierEnBase(chantier.id));
      const envois = [
        ...envoisDrapeauObligatoire('encaisse', 'encaissement'),
        { nom: 'encaisse vaut « x »', envoyer: (r) => r.send({ encaisse: 'x' }) },
        { nom: 'encaisse: true', envoyer: (r) => r.send({ encaisse: true }) },
        { nom: 'encaisse: false', envoyer: (r) => r.send({ encaisse: false }) },
      ];
      for (const [qui, auth] of ADMINISTRATION()) {
        for (const envoi of envois) {
          await refuse(() => envoi.envoyer(encaissement(randomUUID(), auth)), 404, MESSAGES.chantierIntrouvable, `${qui}, chantier inconnu, ${envoi.nom}`);
          await refuse(() => envoi.envoyer(encaissement(annulee.id, auth)), 409, MESSAGES.encaissementAnnulee, `${qui}, affaire annulée, ${envoi.nom}`, () => chantierEnBase(annulee.id));
        }
      }
    });

    // Cadrage v3, périmètre 5 et critère « true et false restent inchangés : à l'identique sans écriture, […] journal » :
    // l'encaissement coche puis décoche, pose puis efface la date d'encaissement, et écrit chaque changement au journal
    // des saisies du chantier (#181) ; un chantier en cours reste encaissable par l'administration (question ouverte
    // « Chantier encaissé mais encore en cours », section 3 de la passation : le lot n'y répond pas).
    test('encaissement : true encaisse et false désencaisse, chantier en cours ou terminé, par chacun des quatre comptes de l’administration, avec la date d’encaissement posée puis effacée et une entrée CHANGEMENT_ENCAISSEMENT à chaque changement', async () => {
      for (const [etat, extra] of [['en cours', {}], ['terminé', TERMINE]]) {
        for (const [qui, auth] of ADMINISTRATION()) {
          const chantier = await creerChantier(extra);
          const auteur = qui === 'SA' ? comptes.SA : comptes[qui];
          const debut = Date.now();
          const coche = await ok(encaissement(chantier.id, auth).send({ encaisse: true }));
          let relu = await chantierEnBase(chantier.id);
          assert.equal(relu.encaisse, true, `${qui}, ${etat} : encaissé`);
          assert.ok(Date.parse(relu.dateEncaissement) >= debut - 1000, `${qui}, ${etat} : date d’encaissement posée`);
          assert.deepEqual([coche.encaisse, coche.dateEncaissement], [true, relu.dateEncaissement], `${qui}, ${etat} : réponse`);
          assert.equal(relu.statut, chantier.statut, `${qui}, ${etat} : le statut ne change pas`);
          let entrees = await journalChantier(chantier.id);
          assert.deepEqual(entrees.map(({ chantierId, cible, cibleId, action, auteurId, auteurNom, avant, apres }) => ({ chantierId, cible, cibleId, action, auteurId, auteurNom, avant, apres })), [{
            chantierId: chantier.id, cible: 'CHANTIER', cibleId: chantier.id, action: 'CHANGEMENT_ENCAISSEMENT', auteurId: auteur.id, auteurNom: auteur.name,
            avant: { encaisse: false, dateEncaissement: null }, apres: { encaisse: true, dateEncaissement: relu.dateEncaissement },
          }], `${qui}, ${etat} : journal de l’encaissement`);
          const dateEncaissement = relu.dateEncaissement;
          const decoche = await ok(encaissement(chantier.id, auth).send({ encaisse: false }));
          relu = await chantierEnBase(chantier.id);
          assert.deepEqual([relu.encaisse, relu.dateEncaissement, decoche.encaisse, decoche.dateEncaissement], [false, null, false, null], `${qui}, ${etat} : désencaissé`);
          entrees = await journalChantier(chantier.id);
          assert.equal(entrees.length, 2, `${qui}, ${etat} : deux entrées`);
          assert.deepEqual([entrees[1].action, entrees[1].avant, entrees[1].apres], ['CHANGEMENT_ENCAISSEMENT', { encaisse: true, dateEncaissement }, { encaisse: false, dateEncaissement: null }], `${qui}, ${etat} : journal du retrait`);
        }
      }
    });

    // Cadrage v3, « Ordre » : le 400 est rendu « dans la transaction, sur la ligne verrouillée (SELECT … FOR UPDATE) » ;
    // périmètre 4 : « pour l'encaissement, un corps invalide prend le verrou de la ligne, sans écriture ». Une transaction
    // de test tient la ligne : un corps invalide attend le verrou ; si l'affaire est annulée pendant l'attente, la
    // réponse est le 409, relu sur la ligne verrouillée, et non le 400 ; si elle est encaissée pendant l'attente, un corps
    // invalide reçoit le 400 et ne change rien à ce qui a été validé. Tue un refus du corps rendu avant la transaction,
    // ou après une lecture de l'état sans verrou.
    test('encaissement sous le verrou de la ligne : un corps invalide attend la ligne verrouillée ; l’affaire annulée pendant l’attente reçoit le 409, le chantier encaissé pendant l’attente le 400 ; la requête n’écrit rien', async () => {
      const aAnnuler = await creerChantier();
      const course1 = await sousVerrou(aAnnuler.id, () => encaissement(aAnnuler.id, comptes.AD.auth).send({}),
        (tx) => tx.chantier.update({ where: { id: aAnnuler.id }, data: ANNULATION() }));
      assert.deepEqual([course1.res.status, course1.res.body], [409, { error: MESSAGES.encaissementAnnulee }], 'annulée pendant l’attente');
      assert.deepEqual(tablesChangees(course1.attendu, await empreinte()), [], 'annulée pendant l’attente : la requête n’écrit rien');
      const aEncaisser = await creerChantier();
      const course2 = await sousVerrou(aEncaisser.id, () => encaissement(aEncaisser.id, comptes.DIR.auth).send({ encaisse: 1 }),
        (tx) => tx.chantier.update({ where: { id: aEncaisser.id }, data: ENCAISSE }));
      assert.deepEqual([course2.res.status, course2.res.body], [400, { error: REFUS_DRAPEAU('encaisse') }], 'encaissé pendant l’attente');
      assert.deepEqual(tablesChangees(course2.attendu, await empreinte()), [], 'encaissé pendant l’attente : la requête n’écrit rien');
      assert.deepEqual(await journalChantier(aEncaisser.id), [], 'aucune entrée au journal');
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 2. Barème réduit de la fiche d'un chantier (PATCH /api/chantiers/:id, champ baremeReduit)
    // ---------------------------------------------------------------------------------------------------------------

    // Autres champs de la fiche, distincts des valeurs de départ, dont un titulaire et un client journalisables
    // (CHANGEMENT_TITULAIRE, CHANGEMENT_CLIENT) : envoyés avec un barème refusé, aucun ne doit être écrit (cadrage v3,
    // critère « Barème réduit » : « sans aucune écriture de la fiche, pas même des autres champs envoyés (nom,
    // responsableId journalisable, clientId) »). Le client n'est pris en compte que pour l'administration et l'assistante
    // technique ; un conducteur l'envoie sans effet.
    const AUTRES_CHAMPS = () => ({
      nom: 'TEST Nom refusé 587', adresse: 'TEST 2 rue refusée 587', types: ['Interphonie', 'Vidéo'], heuresVendues: '35,5',
      budgetMaterielVendu: '999,99', budgetMainOeuvreVendu: '111,11', dateDebut: '15-09-2026', dateFin: '30-11-2026',
      numeroDevis: 'A26-9587', responsableId: comptes.CT2.id, clientId: clients.B.id,
    });

    // Cadrage v3, périmètre 2 et critère « Barème réduit » : « une valeur non booléenne répond 400, sans aucune écriture de
    // la fiche » ; null compris (lecture retenue, à confirmer par Nelson : avant le lot, null effaçait le barème, et
    // « false », « oui » ou « 1 » le posaient). Tue « barème contrôlé après la transaction (écriture partielle : nom écrit,
    // puis 400) » et « `!!` rétabli », « null admis ».
    test('fiche : une valeur non booléenne du barème réduit, null compris, répond 400 « « baremeReduit » doit valoir true ou false. », par l’administration, l’assistante technique et le conducteur titulaire, sur un chantier au barème réduit ou standard ; rien n’est écrit, pas même le nom, le titulaire, le client ou les montants envoyés avec', async () => {
      for (const baremeReduit of [true, false]) {
        const chantier = await creerChantier({ baremeReduit });
        for (const [qui, auth] of ECRIVENT_LA_FICHE()) {
          for (const [nom, valeur] of VALEURS_REFUSEES) {
            await refuse(() => fiche(chantier.id, auth).send({ baremeReduit: valeur }), 400, REFUS_DRAPEAU('baremeReduit'), `${qui}, barème ${baremeReduit ? 'réduit' : 'standard'}, seul, ${nom}`, () => chantierEnBase(chantier.id));
            await refuse(() => fiche(chantier.id, auth).send({ ...AUTRES_CHAMPS(), baremeReduit: valeur }), 400, REFUS_DRAPEAU('baremeReduit'), `${qui}, barème ${baremeReduit ? 'réduit' : 'standard'}, avec les autres champs, ${nom}`, () => chantierEnBase(chantier.id));
          }
          await refuse(() => fiche(chantier.id, auth).send({ ...AUTRES_CHAMPS(), baremeReduit: 'oui' }), 400, REFUS_DRAPEAU('baremeReduit'), `${qui}, « oui »`, () => chantierEnBase(chantier.id));
        }
        const relu = await chantierEnBase(chantier.id);
        assert.deepEqual([relu.baremeReduit, relu.nom, relu.responsableId, relu.clientId, relu.numeroDevis], [baremeReduit, chantier.nom, comptes.CT.id, clients.A.id, null], 'fiche intacte');
        assert.deepEqual(await journalChantier(chantier.id), [], 'aucune entrée au journal des saisies');
      }
    });

    // Cadrage v3, périmètre 2 : « La clé absente garde la valeur actuelle, comme aujourd'hui » ; critère « Une clé absente
    // garde la valeur (vrai comme faux) ». Tue « clé absente lue comme faux » (`data.baremeReduit = !!bareme.valeur`, ou
    // `bareme.valeur ?? false` : un chantier au barème réduit le perdrait) et « barème rendu obligatoire » (400).
    test('fiche : sans la clé du barème réduit, la fiche s’enregistre et le barème garde sa valeur, réduit comme standard, par l’administration, l’assistante technique et le conducteur titulaire', async () => {
      for (const baremeReduit of [true, false]) {
        for (const [qui, auth] of ECRIVENT_LA_FICHE()) {
          const chantier = await creerChantier({ baremeReduit });
          const nom = `TEST Nom gardant le barème ${suffixe()}`;
          const reponse = await ok(fiche(chantier.id, auth).send({ nom, heuresVendues: '20,25', types: ['Vidéo'] }));
          const relu = await chantierEnBase(chantier.id);
          assert.deepEqual([relu.nom, relu.heuresVendues, relu.types], [nom, '20.25', ['Vidéo']], `${qui} : les champs envoyés sont écrits`);
          assert.equal(relu.baremeReduit, baremeReduit, `${qui}, barème ${baremeReduit ? 'réduit' : 'standard'} : valeur gardée en base`);
          assert.equal(reponse.baremeReduit, baremeReduit, `${qui} : réponse`);
        }
      }
    });

    // Cadrage v3, périmètre 5 et critère « true et false restent inchangés, par l'administration, l'assistante technique
    // (affaire en cours) et un conducteur titulaire » ; la fiche n'écrit toujours aucune entrée de journal pour le barème
    // (question ouverte « Journal de la clôture d'un chantier et des champs de sa fiche qui pèsent sur un montant »,
    // section 3 de la passation : le lot n'y répond pas).
    test('fiche : true pose et false retire le barème réduit, à l’identique compris, par l’administration, l’assistante technique et le conducteur titulaire, sans entrée de journal', async () => {
      for (const [qui, auth] of ECRIVENT_LA_FICHE()) {
        const chantier = await creerChantier();
        const saisiesAvant = await prisma.journalSaisieChantier.count();
        const administrationAvant = await prisma.journalAdministration.count();
        for (const baremeReduit of [true, true, false, false, true]) {
          const reponse = await ok(fiche(chantier.id, auth).send({ baremeReduit }));
          assert.equal((await chantierEnBase(chantier.id)).baremeReduit, baremeReduit, `${qui}, baremeReduit: ${baremeReduit} : relu en base`);
          assert.equal(reponse.baremeReduit, baremeReduit, `${qui}, baremeReduit: ${baremeReduit} : réponse`);
        }
        assert.equal(await prisma.journalSaisieChantier.count(), saisiesAvant, `${qui} : aucune entrée au journal des saisies`);
        assert.equal(await prisma.journalAdministration.count(), administrationAvant, `${qui} : aucune entrée au journal d’administration`);
      }
      // Chantier terminé : l'administration seule écrit encore sa fiche (décision de Nelson du 02-11-2026, « A. Non, admin
      // seule »), barème compris.
      const termine = await creerChantier(TERMINE);
      for (const [qui, auth] of ADMINISTRATION()) {
        for (const baremeReduit of [true, false]) {
          await ok(fiche(termine.id, auth).send({ baremeReduit }));
          assert.equal((await chantierEnBase(termine.id)).baremeReduit, baremeReduit, `${qui}, chantier terminé, baremeReduit: ${baremeReduit}`);
        }
      }
    });

    // Cadrage v3, « Ordre » (fiche), étapes 1 et 2, et critère « fiche : 403 du commercial, 404 hors titulaire, 403
    // technicien, 409 affaire annulée, 403 chantier terminé hors administration avant le 400 du barème ». Les mêmes
    // cibles avec un booléen gardent leur refus (témoins). Tue « barème contrôlé en tête du gestionnaire (avant le 404 et
    // refusEcritureChantier) ».
    test('fiche, ordre : 401, 403 du commercial, 404 du chantier inconnu ou hors titulaire, 403 du technicien titulaire, 409 de l’affaire annulée et 403 du chantier terminé hors administration passent avant le 400 du barème réduit ; rien n’est écrit', async () => {
      const chantier = await creerChantier();
      const duTechnicien = await creerChantier({ responsableId: comptes.TECH.id });
      const annulee = await creerChantier(ANNULATION());
      const termine = await creerChantier(TERMINE);
      const corpsRefuses = [{ baremeReduit: 'false' }, { baremeReduit: null }, { nom: 'TEST Nom refusé 587', baremeReduit: 1 }];
      const corps = [...corpsRefuses, { baremeReduit: true }, { baremeReduit: false }];
      for (const c of corps) {
        const quoi = JSON.stringify(c);
        await refuse(() => fiche(chantier.id).send(c), 401, MESSAGES.authentification, `sans session, ${quoi}`, () => chantierEnBase(chantier.id));
        await refuse(() => fiche(chantier.id, comptes['AD-DESACTIVE'].auth).send(c), 401, MESSAGES.compteDesactive, `administrateur désactivé, ${quoi}`, () => chantierEnBase(chantier.id));
        await refuse(() => fiche(chantier.id, comptes.COM.auth).send(c), 403, MESSAGES.compteCommercial, `commercial du chantier, ${quoi}`, () => chantierEnBase(chantier.id));
        for (const [qui, auth] of ECRIVENT_LA_FICHE()) {
          await refuse(() => fiche(randomUUID(), auth).send(c), 404, MESSAGES.chantierIntrouvable, `${qui}, chantier inconnu, ${quoi}`);
          await refuse(() => fiche(annulee.id, auth).send(c), 409, MESSAGES.ficheAnnulee, `${qui}, affaire annulée, ${quoi}`, () => chantierEnBase(annulee.id));
        }
        // Hors titulaire : 404, sans dire que le chantier existe.
        for (const code of ['CT2', 'RESP', 'DC', 'AC', 'CPT', 'TECH']) {
          await refuse(() => fiche(chantier.id, comptes[code].auth).send(c), 404, MESSAGES.chantierIntrouvable, `${code} hors titulaire, ${quoi}`, () => chantierEnBase(chantier.id));
        }
        await refuse(() => fiche(duTechnicien.id, comptes.TECH.auth).send(c), 403, MESSAGES.technicienFiche, `technicien titulaire, ${quoi}`, () => chantierEnBase(duTechnicien.id));
        for (const [qui, auth] of [['AT', comptes.AT.auth], ['CT titulaire', comptes.CT.auth]]) {
          await refuse(() => fiche(termine.id, auth).send(c), 403, MESSAGES.ficheCloture, `${qui}, chantier terminé, ${quoi}`, () => chantierEnBase(termine.id));
        }
      }
      // Témoin : sur le chantier terminé, l'administration passe ces refus et reçoit le 400 du barème.
      for (const [qui, auth] of ADMINISTRATION()) {
        for (const c of corpsRefuses) {
          await refuse(() => fiche(termine.id, auth).send(c), 400, REFUS_DRAPEAU('baremeReduit'), `${qui}, chantier terminé, ${JSON.stringify(c)}`, () => chantierEnBase(termine.id));
        }
      }
    });

    // Cadrage v3, « Ordre » (fiche), étapes 3 à 6 : « 400 du statut envoyé par l'administration ; 404 « Client
    // introuvable. » ; 400 et 409 du numéro de devis ; 400 du titulaire ; 403 du montant vendu », puis « 400 des champs
    // numériques (le premier refusé, dans l'ordre de numericFields, #393), puis 400 des dates », puis le 400 du barème,
    // enfin la transaction (dont le 400 de la date de fin vidée d'un chantier terminé). Critère : « 400 d'un champ
    // numérique ou d'une date avant celui du barème ». Tue « barème contrôlé avant les champs numériques et les dates »,
    // et un barème contrôlé dans la transaction après la date de fin vidée.
    test('fiche, ordre : le statut envoyé par l’administration, le client introuvable, le numéro de devis, le titulaire, le montant vendu, un champ numérique ou une date refusés passent avant le 400 du barème réduit ; le barème passe avant le refus de la date de fin vidée ; rien n’est écrit', async () => {
      const chantier = await creerChantier({ baremeReduit: true });
      const termine = await creerChantier({ ...TERMINE, baremeReduit: true });
      await creerChantier({ numeroDevis: 'A26-9101' });
      for (const valeur of ['false', null, 1]) {
        for (const [qui, auth] of ECRIVENT_LA_FICHE()) {
          const cas = [
            [{ clientId: randomUUID() }, 404, MESSAGES.clientIntrouvable],
            [{ numeroDevis: 'XYZ-1' }, 400, MESSAGES.numeroDevisFormat],
            [{ numeroDevis: 'A26-9101' }, 409, MESSAGES.numeroDevisPris('A26-9101')],
            [{ responsableId: '' }, 400, MESSAGES.titulaireVide],
            [{ responsableId: randomUUID() }, 400, MESSAGES.titulaireIntrouvable],
            [{ heuresVendues: 'abc' }, 400, MESSAGES.heures],
            [{ budgetMaterielVendu: '-1', heuresVendues: 'abc', dateDebut: '31-02-2026' }, 400, MESSAGES.budgetMateriel],
            [{ dateDebut: '31-02-2026' }, 400, MESSAGES.dateDebut],
            [{ nom: 'TEST Nom refusé 587', dateFin: 'pas une date' }, 400, MESSAGES.dateFin],
          ];
          // Le client ne compte que pour l'administration et l'assistante technique ; le conducteur l'envoie sans effet.
          if (qui === 'CT titulaire') cas.shift();
          for (const [corps, statut, message] of cas) {
            await refuse(() => fiche(chantier.id, auth).send({ ...corps, baremeReduit: valeur }), statut, message, `${qui}, ${JSON.stringify(corps)}, baremeReduit: ${JSON.stringify(valeur)}`, () => chantierEnBase(chantier.id));
          }
          // Témoin : les mêmes champs, valides, laissent répondre le barème.
          await refuse(() => fiche(chantier.id, auth).send({ ...AUTRES_CHAMPS(), baremeReduit: valeur }), 400, REFUS_DRAPEAU('baremeReduit'), `${qui}, champs valides, baremeReduit: ${JSON.stringify(valeur)}`, () => chantierEnBase(chantier.id));
        }
        for (const [qui, auth] of ADMINISTRATION()) {
          await refuse(() => fiche(chantier.id, auth).send({ statut: 'EN_COURS', baremeReduit: valeur }), 400, MESSAGES.statutParLaFiche, `${qui}, statut envoyé, baremeReduit: ${JSON.stringify(valeur)}`, () => chantierEnBase(chantier.id));
          // Date de fin vidée d'un chantier terminé : refusée dans la transaction, après le barème.
          await refuse(() => fiche(termine.id, auth).send({ dateFin: '', baremeReduit: valeur }), 400, REFUS_DRAPEAU('baremeReduit'), `${qui}, chantier terminé, date de fin vidée, baremeReduit: ${JSON.stringify(valeur)}`, () => chantierEnBase(termine.id));
        }
        // Montant vendu : l'assistante technique ne suit pas la rentabilité par défaut (rentabiliteAssistantesTechniques).
        await refuse(() => fiche(chantier.id, comptes.AT.auth).send({ budgetGlobalVendu: '10', baremeReduit: valeur }), 403, MESSAGES.montantVendu, `AT, montant vendu, baremeReduit: ${JSON.stringify(valeur)}`, () => chantierEnBase(chantier.id));
      }
      // Témoins des refus repris : avec un booléen, la date de fin vidée d'un chantier terminé reste refusée.
      await refuse(() => fiche(termine.id, comptes.AD.auth).send({ dateFin: '', baremeReduit: false }), 400, MESSAGES.dateFinVidee, 'administrateur, chantier terminé, date de fin vidée, baremeReduit: false', () => chantierEnBase(termine.id));
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 3. Suivi administratif d'un commercial (PUT /api/commerciaux/:id/prime-mensuelle)
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v3, périmètre 3 et critère « Prime : une valeur non booléenne ou une clé absente répond 400, sans ligne
    // créée, sans updatedAt changé et sans entrée au journal d'administration » (choix par défaut, à confirmer). Avant le
    // lot, une clé absente retirait le suivi, ou créait une ligne à false sans journal ; « false » l'accordait. Sur une
    // ligne existante, la valeur que `!!` lirait est égale à celle de la ligne pour une partie des envois : seul
    // `updatedAt` révèlerait alors un upsert (mutant « contrôle après l'upsert »).
    test('prime : chaque valeur non booléenne du suivi administratif ou la clé absente répond 400 « « suiviAdministratif » doit valoir true ou false. », par chacun des quatre comptes de l’administration, sur une période sans ligne (aucune ligne créée) ou sur une ligne existante, accordée ou non (updatedAt inchangé) ; aucune entrée au journal', async () => {
      const commercial = await nouveauCommercial();
      await prisma.primeMensuelleCommercial.create({ data: { commercialId: commercial.id, periode: '2026-10', suiviAdministratif: true } });
      await prisma.primeMensuelleCommercial.create({ data: { commercialId: commercial.id, periode: '2026-11', suiviAdministratif: false } });
      const envois = (periode) => [
        ...VALEURS_REFUSEES.map(([nom, valeur]) => ({ nom: `suiviAdministratif vaut ${nom}`, corps: { periode, suiviAdministratif: valeur } })),
        { nom: 'clé absente', corps: { periode } },
        { nom: 'clé voisine seule (suivi: true)', corps: { periode, suivi: true } },
        { nom: 'suiviAdministratif vaut « oui »', corps: { periode, suiviAdministratif: 'oui' } },
      ];
      for (const [qui, auth] of ADMINISTRATION()) {
        for (const [ligne, periode] of [['période sans ligne', '2026-09'], ['ligne accordée', '2026-10'], ['ligne non accordée', '2026-11']]) {
          for (const envoi of envois(periode)) {
            await refuse(() => prime(commercial.id, auth).send(envoi.corps), 400, REFUS_DRAPEAU('suiviAdministratif'), `${qui}, ${ligne}, ${envoi.nom}`, () => primesEnBase(commercial.id));
          }
        }
      }
      const lignes = await primesEnBase(commercial.id);
      assert.deepEqual(lignes.map((l) => [l.periode, l.suiviAdministratif]), [['2026-10', true], ['2026-11', false]], 'aucune ligne créée, valeurs intactes');
    });

    // Cadrage v3, « Ordre » (prime, choix par défaut, à confirmer) : « 401 ; 403 de requireAdmin ; 400 « Période invalide
    // (attendu "YYYY-MM"). » ; 400 du suivi ; 404 « Commercial introuvable. » (compte inconnu ou non commercial) ; verrou,
    // upsert, journal ». Critère : « prime : 401, 403 avant les 400 ; 400 de la période avant celui du suivi ; 400 du suivi
    // avant le 404 (compte inconnu, compte non commercial) ». Tue « contrôle avant la période » et « après le 404 ».
    test('prime, ordre : 401 et 403 des gardes d’abord ; puis le 400 de la période avant celui du suivi administratif ; puis ce 400 avant le 404 du compte inconnu ou non commercial, que true et false reçoivent ; rien n’est écrit', async () => {
      const commercial = await nouveauCommercial();
      const corpsGardes = [{ periode: '2026-09', suiviAdministratif: 'false' }, { periode: '2026-09' }, {}, { periode: '2026-09', suiviAdministratif: true }];
      for (const corps of corpsGardes) {
        const quoi = JSON.stringify(corps);
        await refuse(() => prime(commercial.id).send(corps), 401, MESSAGES.authentification, `sans session, ${quoi}`, () => primesEnBase(commercial.id));
        await refuse(() => prime(commercial.id, comptes['AD-DESACTIVE'].auth).send(corps), 401, MESSAGES.compteDesactive, `administrateur désactivé, ${quoi}`, () => primesEnBase(commercial.id));
        for (const code of HORS_ADMINISTRATION) {
          await refuse(() => prime(commercial.id, comptes[code].auth).send(corps), 403, MESSAGES.administrateurs, `${code}, ${quoi}`, () => primesEnBase(commercial.id));
        }
      }
      await refuse(() => prime(commercial.id), 401, MESSAGES.authentification, 'sans session, sans corps', () => primesEnBase(commercial.id));
      await refuse(() => prime(commercial.id, comptes.COM.auth), 403, MESSAGES.administrateurs, 'commercial, sans corps', () => primesEnBase(commercial.id));
      // La période d'abord : une période absente ou hors format donne son refus, quel que soit le suivi.
      const periodesRefusees = [{}, { suiviAdministratif: 'false' }, { periode: '2026-9', suiviAdministratif: 'false' }, { periode: 202609 }, { periode: '09-2026', suiviAdministratif: null }, { periode: '2026-09-01', suiviAdministratif: true }];
      const nonCommerciaux = [['compte inconnu', randomUUID()], ['conducteur', comptes.CT.id], ['administrateur non commercial', comptes.AD.id]];
      for (const [qui, auth] of ADMINISTRATION()) {
        for (const corps of periodesRefusees) {
          await refuse(() => prime(commercial.id, auth).send(corps), 400, MESSAGES.periode, `${qui}, commercial, ${JSON.stringify(corps)}`, () => primesEnBase(commercial.id));
          await refuse(() => prime(randomUUID(), auth).send(corps), 400, MESSAGES.periode, `${qui}, compte inconnu, ${JSON.stringify(corps)}`);
        }
        await refuse(() => prime(commercial.id, auth).send([{ periode: '2026-09', suiviAdministratif: true }]), 400, MESSAGES.periode, `${qui}, corps tableau`, () => primesEnBase(commercial.id));
        // Puis le suivi, avant le 404.
        for (const [cibleNom, id] of nonCommerciaux) {
          for (const corps of [{ periode: '2026-09' }, { periode: '2026-09', suiviAdministratif: 'false' }, { periode: '2026-09', suiviAdministratif: null }]) {
            await refuse(() => prime(id, auth).send(corps), 400, REFUS_DRAPEAU('suiviAdministratif'), `${qui}, ${cibleNom}, ${JSON.stringify(corps)}`);
          }
          for (const suiviAdministratif of [true, false]) {
            await refuse(() => prime(id, auth).send({ periode: '2026-09', suiviAdministratif }), 404, MESSAGES.commercialIntrouvable, `${qui}, ${cibleNom}, suiviAdministratif: ${suiviAdministratif}`);
          }
        }
      }
      assert.deepEqual(await primesEnBase(commercial.id), [], 'aucune ligne');
    });

    // Cadrage v3, périmètre 3, « Corps absent » : « la lecture de periode (String(req.body.periode || '')) lève une
    // TypeError (500). Le lot la lit par req.body?.periode (un corps absent répond alors 400 « Période invalide… ») » ;
    // choix retenu par le code (demande de Claude Code après le rapport du rédacteur des tests). Une requête sans corps
    // JSON (Express 5 laisse req.body à undefined) répond donc 400 de la période, avant le suivi et avant le 404, sans
    // ligne créée, sans updatedAt changé ni entrée au journal. Tue le mutant « req.body.periode rétabli » (500).
    test('prime, requête sans corps JSON (sans Content-Type, JSON vide, texte brut, formulaire) : 400 « Période invalide (attendu "YYYY-MM"). » et non 500, par chacun des quatre comptes de l’administration, sur un commercial sans ligne ou avec une ligne, et sur un compte inconnu ; aucune ligne créée, updatedAt inchangé, aucune entrée au journal', async () => {
      const sansLigne = await nouveauCommercial();
      const avecLigne = await nouveauCommercial();
      await prisma.primeMensuelleCommercial.create({ data: { commercialId: avecLigne.id, periode: '2026-09', suiviAdministratif: true } });
      const sansCorps = [
        ['sans corps ni Content-Type', (r) => r],
        ['Content-Type JSON sans corps', (r) => r.set('Content-Type', 'application/json')],
        ['texte brut', (r) => r.set('Content-Type', 'text/plain').send('periode=2026-09&suiviAdministratif=true')],
        ['formulaire', (r) => r.type('form').send('periode=2026-09&suiviAdministratif=true')],
      ];
      for (const [qui, auth] of ADMINISTRATION()) {
        for (const [nom, envoyer] of sansCorps) {
          await refuse(() => envoyer(prime(sansLigne.id, auth)), 400, MESSAGES.periode, `${qui}, commercial sans ligne, ${nom}`, () => primesEnBase(sansLigne.id));
          await refuse(() => envoyer(prime(avecLigne.id, auth)), 400, MESSAGES.periode, `${qui}, commercial avec une ligne, ${nom}`, () => primesEnBase(avecLigne.id));
          await refuse(() => envoyer(prime(randomUUID(), auth)), 400, MESSAGES.periode, `${qui}, compte inconnu, ${nom}`);
        }
      }
      assert.deepEqual(await primesEnBase(sansLigne.id), [], 'aucune ligne créée');
      assert.deepEqual((await primesEnBase(avecLigne.id)).map((l) => [l.periode, l.suiviAdministratif]), [['2026-09', true]], 'ligne intacte');
    });

    // Cadrage v3, périmètre 5 et critère « true et false restent inchangés » : true accorde (entrée PRIME_COMMERCIAL
    // « Période MM-AAAA »), false retire (entrée), false sur une période sans ligne crée la ligne sans entrée (la prime
    // n'était pas accordée : l'avant vaut « non ») ; « une prime enregistrée à l'identique garde son comportement actuel
    // (l'upsert réécrit updatedAt, sans journal) ». Ce dernier point est aussi le témoin des refus : une écriture à
    // l'identique change bien updatedAt, que les refus laissent intact.
    test('prime : true accorde et false retire le suivi administratif, avec une entrée PRIME_COMMERCIAL à chaque changement ; false sur une période sans ligne crée la ligne sans entrée ; à l’identique, updatedAt réécrit sans entrée ; par chacun des quatre comptes de l’administration', async () => {
      for (const [qui, auth] of ADMINISTRATION()) {
        const auteur = comptes[qui];
        const commercial = await nouveauCommercial();
        const entree = (avant, apres) => ({
          domaine: 'REGLAGES', type: 'PRIME_COMMERCIAL', action: 'MODIFICATION', cibleId: commercial.id, cibleLibelle: commercial.name,
          avant: { suiviAdministratif: avant }, apres: { suiviAdministratif: apres }, detail: 'Période 09-2026',
          concerneSuperAdmin: false, reserveSuperAdmin: false, auteurId: auteur.id, auteurNom: auteur.name, auteurSuperAdmin: qui === 'SA',
        });
        let avant = await idsJournalAdministration();
        let reponse = await ok(prime(commercial.id, auth).send({ periode: '2026-09', suiviAdministratif: true }));
        let lignes = await primesEnBase(commercial.id);
        assert.deepEqual(lignes.map((l) => [l.periode, l.suiviAdministratif]), [['2026-09', true]], `${qui} : ligne créée, accordée`);
        assert.deepEqual([reponse.id, reponse.periode, reponse.suiviAdministratif, reponse.commercialId], [lignes[0].id, '2026-09', true, commercial.id], `${qui} : réponse`);
        assert.deepEqual(await entreesAdministrationDepuis(avant), [entree(false, true)], `${qui} : journal de l’accord`);
        // À l'identique : updatedAt réécrit, sans entrée.
        const misAJour = lignes[0].updatedAt;
        await pause(5);
        avant = await idsJournalAdministration();
        await ok(prime(commercial.id, auth).send({ periode: '2026-09', suiviAdministratif: true }));
        lignes = await primesEnBase(commercial.id);
        assert.ok(Date.parse(lignes[0].updatedAt) > Date.parse(misAJour), `${qui} : à l’identique, updatedAt réécrit`);
        assert.deepEqual(await entreesAdministrationDepuis(avant), [], `${qui} : à l’identique, aucune entrée`);
        // Retrait.
        avant = await idsJournalAdministration();
        reponse = await ok(prime(commercial.id, auth).send({ periode: '2026-09', suiviAdministratif: false }));
        assert.equal(reponse.suiviAdministratif, false);
        assert.deepEqual((await primesEnBase(commercial.id)).map((l) => [l.periode, l.suiviAdministratif]), [['2026-09', false]], `${qui} : retiré`);
        assert.deepEqual(await entreesAdministrationDepuis(avant), [entree(true, false)], `${qui} : journal du retrait`);
        // false sur une période sans ligne : ligne créée, sans entrée.
        avant = await idsJournalAdministration();
        await ok(prime(commercial.id, auth).send({ periode: '2026-12', suiviAdministratif: false }));
        assert.deepEqual((await primesEnBase(commercial.id)).map((l) => [l.periode, l.suiviAdministratif]), [['2026-09', false], ['2026-12', false]], `${qui} : ligne créée à false`);
        assert.deepEqual(await entreesAdministrationDepuis(avant), [], `${qui} : false sur une période sans ligne, aucune entrée`);
      }
      // Un administrateur « aussi commercial » est une cible admise, comme avant.
      const avant = await idsJournalAdministration();
      await ok(prime(comptes['AD-COM'].id, comptes.SA.auth).send({ periode: '2026-09', suiviAdministratif: true }));
      assert.equal((await primesEnBase(comptes['AD-COM'].id))[0].suiviAdministratif, true);
      assert.equal((await entreesAdministrationDepuis(avant)).length, 1);
    });

    // ---------------------------------------------------------------------------------------------------------------
    // 4. Clé d'intégration
    // ---------------------------------------------------------------------------------------------------------------

    // Cadrage v3, constat : « Aucune de ces routes n'a de jumelle par clé d'intégration […] ; une clé reçoit 401 sur ces
    // routes de session (cles.txt:1106 et :1186) ». Rejoué ici sur des cibles réelles, avec un corps valide ou invalide :
    // la clé aux 13 scopes est refusée avant tout contrôle du corps, sans écriture.
    test('clé d’intégration : une clé portant tous les scopes reçoit 401 « Session expirée ou invalide » sur l’encaissement, la fiche et la prime, quel que soit le corps ; rien n’est écrit', async () => {
      const { scopes } = await ok(request(app).get('/api/admin/api-scopes').set(comptes.SA.auth));
      const creation = await ok(request(app).post('/api/admin/api-keys').set(comptes.SA.auth).send({ nom: `TEST Clé 587 ${suffixe()}`, scopes }), 201);
      const cle = entete(creation.apiKey);
      const chantier = await creerChantier();
      const commercial = await nouveauCommercial();
      for (const corps of [{ encaisse: true }, { encaisse: 'false' }, {}]) {
        await refuse(() => encaissement(chantier.id, cle).send(corps), 401, MESSAGES.session, `clé, encaissement, ${JSON.stringify(corps)}`, () => chantierEnBase(chantier.id));
      }
      for (const corps of [{ baremeReduit: true }, { baremeReduit: 'false' }, { nom: 'TEST Nom par clé 587' }]) {
        await refuse(() => fiche(chantier.id, cle).send(corps), 401, MESSAGES.session, `clé, fiche, ${JSON.stringify(corps)}`, () => chantierEnBase(chantier.id));
      }
      for (const corps of [{ periode: '2026-09', suiviAdministratif: true }, { periode: '2026-09' }]) {
        await refuse(() => prime(commercial.id, cle).send(corps), 401, MESSAGES.session, `clé, prime, ${JSON.stringify(corps)}`, () => primesEnBase(commercial.id));
      }
    });
  });
}
