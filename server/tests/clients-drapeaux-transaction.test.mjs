// Lot #306 : drapeaux des sites et du contact principal écrits dans une seule transaction, sous le verrou du client
// (cadrage v1 contrôlé, sections « Critères métier observables » et « Tests » ; issue #306, note N3 du treizième audit
// interne de #301 ; message de Nelson du 17-11-2026, « Ok continu », qui renvoie à celui du 16-11-2026, « continu avec
// les issu. »). Règle 2 de la méthode : une facture émise ou un devis signé copie l'adresse du site de facturation du
// client, et la garde figée.
//
// Avant le lot, `creerSite`, `modifierSite`, `creerContact` et `modifierContact` retiraient le drapeau (site de
// facturation, siège social, site principal, contact principal) aux autres fiches du client hors transaction, avant
// d'écrire la fiche. Un refus (404 d'une fiche inconnue, valeur refusée par la base) laissait le client sans site de
// facturation, sans siège, sans site principal ou sans contact principal ; une signature ou une émission lue entre les
// deux écritures copiait une troisième adresse ; deux écritures simultanées laissaient deux contacts principaux, ou
// répondaient 409 pour le site.
//
// Ce que prouve ce fichier, par des requêtes HTTP réelles (session de chaque compte qui gère les clients, et clé
// d'intégration `clients:write`), chaque écriture relue en base, chaque refus prouvé sans écriture (empreinte de toute
// la base) :
//   1. modification d'un site ou d'un contact inconnu (ou d'un autre client, ou sous un client inexistant) avec un
//      drapeau : 404 au message actuel, et l'ancien porteur garde son drapeau (tue « 404 vérifié après la libération ») ;
//   2. octet nul (U+0000) refusé par PostgreSQL, à la création et à la modification d'un site avec un drapeau et d'un
//      contact principal : 500 « Erreur client. », aucun drapeau retiré (test obligatoire du cadrage : seul à tuer
//      « libération hors transaction ») ;
//   3. cas nominal : poser un drapeau le retire à l'ancien porteur, et à lui seul ; jamais zéro ni deux ;
//   4. barrière de concurrence déterministe : une connexion témoin tient la fiche client `FOR UPDATE`, deux écritures
//      attendent son verrou (relevé dans `pg_stat_activity`), puis sont libérées : deux succès, un seul porteur de
//      chaque drapeau (tue « verrou retiré » et « REPEATABLE READ ») ; et la pièce lue pendant l'attente (devis signé,
//      facture émise) fige l'ancienne adresse de facturation, jamais celle du site principal ;
//   5. comportements gardés (#426, hors périmètre) : corps sans champ modifiable en modification, 404 sans rien écrire ;
//      client inexistant en création, 500 « Erreur client. », ou 400 si le corps est invalide ;
//   6. droits inchangés : les autres comptes et une clé sans `clients:write` sont refusés sans rien écrire.
//
// Fichier propre au lot, avec sa base jetable : `node --test` exécute les fichiers en parallèle, et api.test.mjs purge
// les données « TEST » de TEST_DATABASE_URL. Celle-ci ne sert donc ici que de connexion administrative : une base neuve
// est créée, migrée, servie à l'application montée en mémoire, puis supprimée. La barrière relève les attentes de verrou
// de cette seule base. Sans TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { empreinteBase, tablesChangees, tablesDeLaBase } from './matrice-droits/outils.mjs';

const TITRE = 'Lot #306 : drapeaux des sites et du contact principal écrits dans une seule transaction, sous le verrou du client';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Messages exacts, inchangés par le lot (cadrage, périmètre 2, 3 et 5).
const MESSAGES = {
  siteIntrouvable: 'Site introuvable.',
  contactIntrouvable: 'Contact introuvable.',
  erreurClient: 'Erreur client.',
  nomSiteObligatoire: 'Le champ nom est obligatoire.',
  nomContactObligatoire: 'Le nom du contact est obligatoire.',
  gestion: 'Accès réservé à l’administration et à l’assistante technique.',
  scope: 'Scope requis : clients:write',
};
// Les trois drapeaux d'un site, uniques par client (cadrage, constat).
const DRAPEAUX_SITE = ['estSiteFacturation', 'estSiegeSocial', 'principal'];
// Comptes refusés aux écritures des clients (requireGestionClients) : tous sauf l'administration et l'assistante technique.
const TYPES_REFUSES = ['CONDUCTEUR_TRAVAUX', 'RESPONSABLE', 'TECHNICIEN', 'COMMERCIAL', 'DIRECTEUR_COMMERCIAL', 'ASSISTANTE_COMMERCIALE', 'COMPTABLE'];
// Barrière : délai d'attente des écritures bloquées, puis de la lecture faite pendant l'attente. Leur somme reste sous les
// 5 s d'une transaction interactive de Prisma (au-delà, 500 P2028 ; cadrage, « Mutants à tuer »).
const ATTENTE_VERROU_MAX_MS = 2_000;
const DELAI_LECTURE_PENDANT_MS = 2_000;
// Trois adresses distinctes en chaque champ (pièces) : l'ancien site de facturation, le site principal (celui que
// SITE_FACTURATION_ORDRE retient quand aucun site ne porte le drapeau : la « troisième adresse » du constat) et le
// nouveau site de facturation.
const ADRESSE_ANCIENNE = { adresse: '1 rue Ancienne', codePostal: '14000', ville: 'Caen' };
const ADRESSE_TROISIEME = { adresse: '9 rue Troisième', codePostal: '75009', ville: 'Paris' };
const ADRESSE_NOUVELLE = { adresse: '5 rue Nouvelle', codePostal: '69002', ville: 'Lyon' };
const copieAdresse = ({ adresse, codePostal, ville }) => `${adresse}\n${codePostal} ${ville}`;

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    const nomBase = `iris_test_drapeaux306_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    // L'application tient deux transactions interactives en attente pendant la barrière, plus ses lectures et la pièce
    // lue pendant l'attente : quelques connexions de plus que la valeur par défaut de Prisma, comme les matrices.
    const cibleApplication = new URL(cible);
    cibleApplication.searchParams.set('connection_limit', '12');
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;

    let request; let app; let prisma; let appPrisma; let jwt;
    let tables = [];
    let session = '';
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const comptes = {};
    let cleEcriture = '';
    let cleLecture = '';
    let rang = 0;
    const suffixe = () => `${Date.now()}-${(rang += 1)}`;

    // Portes d'entrée qui écrivent les clients : chaque compte qui les gère (super administrateur de secours,
    // administrateur, directeur, assistante technique) par la session, et la clé d'intégration `clients:write` par /api/v1
    // (cadrage, « Tests » : « en session et par clé, par l'administration et l'assistante technique »).
    const PORTES = [
      { nom: 'session du super administrateur', base: '/api', auth: () => entete(session) },
      { nom: 'session de l’administrateur', base: '/api', auth: () => comptes.AD.auth },
      { nom: 'session du directeur', base: '/api', auth: () => comptes.DIR.auth },
      { nom: 'session de l’assistante technique', base: '/api', auth: () => comptes.AT.auth },
      { nom: 'clé d’intégration clients:write', base: '/api/v1', auth: () => entete(cleEcriture) },
    ];
    const porte = (nom) => PORTES.find((p) => p.nom === nom);
    const appel = (p, methode, chemin, corps) => request(app)[methode](`${p.base}${chemin}`).set(p.auth()).send(corps);
    const creerSite = (p, clientId, corps) => appel(p, 'post', `/clients/${clientId}/sites`, corps);
    const modifierSite = (p, clientId, siteId, corps) => appel(p, 'put', `/clients/${clientId}/sites/${siteId}`, corps);
    const creerContact = (p, clientId, corps) => appel(p, 'post', `/clients/${clientId}/contacts`, corps);
    const modifierContact = (p, clientId, contactId, corps) => appel(p, 'put', `/clients/${clientId}/contacts/${contactId}`, corps);
    const corpsSite = (nom, extra = {}) => ({ nom, adresse: '2 rue du Test', codePostal: '14000', ville: 'Caen', ...extra });

    const creerCompte = async (code, role) => {
      const s = suffixe();
      const compte = await prisma.user.create({ data: { email: `drapeaux306.${code.toLowerCase()}.${s}@iris.test`, name: `TEST ${code} drapeaux 306 ${s}`, role } });
      comptes[code] = { ...compte, auth: entete(jwt.sign({ id: compte.id }, process.env.JWT_SECRET)) };
    };
    const ok = async (promesse, statut = 200) => {
      const res = await promesse;
      assert.equal(res.status, statut, JSON.stringify(res.body));
      return res.body;
    };

    // Fixture posée en base, sans passer par les routes du lot : un client, son site « A » qui porte les trois drapeaux,
    // un site « B » ordinaire, son contact principal « P » et un contact ordinaire « Q ». `extra` complète la fiche client
    // (SIREN des pièces).
    const nouveauClient = async (quoi, { extra = {}, siteA = {}, avecSiren = false } = {}) => {
      let siren = null;
      if (avecSiren) siren = String(randomInt(100_000_000, 1_000_000_000));
      const client = await prisma.client.create({ data: { raisonSociale: `TEST Client drapeaux 306 ${quoi} ${suffixe()}`, ...(siren ? { siren } : {}), ...extra } });
      const a = await prisma.clientSite.create({ data: { clientId: client.id, nom: 'TEST A porteur', ...ADRESSE_ANCIENNE, estSiteFacturation: true, estSiegeSocial: true, principal: true, ...siteA } });
      const b = await prisma.clientSite.create({ data: { clientId: client.id, nom: 'TEST B ordinaire', adresse: '3 rue Ordinaire', codePostal: '14000', ville: 'Caen' } });
      const p = await prisma.clientContact.create({ data: { clientId: client.id, nom: 'TEST P principal', principal: true } });
      const q = await prisma.clientContact.create({ data: { clientId: client.id, nom: 'TEST Q ordinaire' } });
      return { client, a, b, p, q };
    };
    // Porteurs de chaque drapeau du client, par nom, relus en base.
    const drapeaux = async (clientId) => {
      const sites = await prisma.clientSite.findMany({ where: { clientId }, orderBy: [{ nom: 'asc' }, { id: 'asc' }] });
      const contacts = await prisma.clientContact.findMany({ where: { clientId }, orderBy: [{ nom: 'asc' }, { id: 'asc' }] });
      return {
        facturation: sites.filter((s) => s.estSiteFacturation).map((s) => s.nom),
        siege: sites.filter((s) => s.estSiegeSocial).map((s) => s.nom),
        sitePrincipal: sites.filter((s) => s.principal).map((s) => s.nom),
        contactPrincipal: contacts.filter((c) => c.principal).map((c) => c.nom),
      };
    };
    const tousSurA = { facturation: ['TEST A porteur'], siege: ['TEST A porteur'], sitePrincipal: ['TEST A porteur'], contactPrincipal: ['TEST P principal'] };
    // Fiches entières du client (horodatages compris) : une écriture, même d'un seul drapeau, s'y voit.
    const etatClient = async (clientId) => JSON.parse(JSON.stringify({
      client: await prisma.client.findUniqueOrThrow({ where: { id: clientId } }),
      sites: await prisma.clientSite.findMany({ where: { clientId }, orderBy: { id: 'asc' } }),
      contacts: await prisma.clientContact.findMany({ where: { clientId }, orderBy: { id: 'asc' } }),
    }));
    // Empreinte de toute la base, hors la dernière utilisation d'une clé, écrite sans attente par la porte /api/v1 (comme
    // la matrice des clés, D1a-2).
    const empreinte = () => empreinteBase(prisma, tables, { colonnesIgnorees: { ApiAccessKey: ['dernierUsageLe'] } });
    // Un refus : statut et corps exacts, et aucune écriture dans toute la base.
    const refuse = async (envoi, statut, message, quoi) => {
      const avant = await empreinte();
      const res = await envoi();
      assert.equal(res.status, statut, `${quoi} : ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, { error: message }, quoi);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
    };

    // Barrière (cadrage, « Mutants à tuer », méthode éprouvée par le contrôleur) : une connexion témoin, hors de
    // l'application, tient la fiche client `FOR UPDATE` dans une transaction ; les écritures sont lancées ; on attend dans
    // `pg_stat_activity` que `attendues` processus de cette base attendent un verrou (`wait_event_type = 'Lock'`, hors la
    // connexion témoin) ; puis le verrou est rendu, bien avant les 5 s d'une transaction interactive. Rend le nombre
    // d'attentes relevées, les réponses, le sort de `pendant` et la durée de la fenêtre.
    //
    // `pendant` : une pièce (signature d'un devis, émission d'une facture), lancée une fois les écritures en attente.
    // Elle lit les sites dans la fenêtre, puis soit elle aboutit avant que le verrou soit rendu (signature d'un devis),
    // soit elle attend à son tour la fiche client (relevé : une attente de plus). L'émission d'une facture est dans ce
    // second cas, constaté par une sonde du rédacteur : elle met à jour deux fois la facture dans sa transaction, et à la
    // seconde, la ligne venant d'être écrite par elle-même, PostgreSQL revérifie la clé étrangère `clientId` (`FOR KEY
    // SHARE` sur la fiche client, qui attend la connexion témoin) ; elle a lu le site de facturation avant (exigerIdentiteClient).
    const attentesDeVerrou = async (pidTemoin) => {
      const { rows: [{ n }] } = await administrationPg.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = 'Lock' AND pid <> $2",
        [nomBase, pidTemoin],
      );
      return n;
    };
    const sousBarriere = async (clientId, envois, { attendues = envois.length, pendant = null } = {}) => {
      const temoin = new pg.Client({ connectionString: cible.toString() });
      await temoin.connect();
      const debut = Date.now();
      let enAttente = 0;
      let lu = null;
      let enCours = [];
      let duree = 0;
      try {
        const { rows: [{ pid }] } = await temoin.query('SELECT pg_backend_pid() AS pid');
        await temoin.query('BEGIN');
        const verrou = await temoin.query('SELECT "id" FROM "Client" WHERE "id" = $1 FOR UPDATE', [clientId]);
        assert.equal(verrou.rowCount, 1, 'la connexion témoin tient la fiche client');
        // Une requête supertest ne part qu'au premier `then`.
        enCours = envois.map((envoi) => envoi().then((res) => res, (erreur) => ({ status: 'erreur', body: String(erreur) })));
        while (Date.now() - debut < ATTENTE_VERROU_MAX_MS) {
          enAttente = await attentesDeVerrou(pid);
          if (enAttente >= attendues) break;
          await pause(15);
        }
        if (pendant && enAttente >= attendues) {
          let finie = false;
          const travail = pendant().then((valeur) => { finie = true; return valeur; });
          const debutPendant = Date.now();
          let bloquee = false;
          while (!finie && Date.now() - debutPendant < DELAI_LECTURE_PENDANT_MS) {
            if (await attentesDeVerrou(pid) > attendues) { bloquee = true; break; }
            await pause(15);
          }
          lu = { travail, finiePendant: finie, bloqueePendant: bloquee && !finie };
        }
      } finally {
        duree = Date.now() - debut;
        await temoin.query('ROLLBACK').catch(() => {});
        await temoin.end().catch(() => {});
      }
      if (lu) lu = { valeur: await lu.travail, finiePendant: lu.finiePendant, bloqueePendant: lu.bloqueePendant };
      const reponses = await Promise.all(enCours);
      return { enAttente, reponses, lu, duree };
    };
    const decrire = (barriere) => JSON.stringify({
      enAttente: barriere.enAttente, duree: barriere.duree, reponses: barriere.reponses.map((r) => [r.status, r.body]),
      ...(barriere.lu ? { piece: { finiePendant: barriere.lu.finiePendant, bloqueePendant: barriere.lu.bloqueePendant, statut: barriere.lu.valeur?.status, corps: barriere.lu.valeur?.body } } : {}),
    });

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
      session = connexion.body.token;
      const secours = await prisma.user.findUniqueOrThrow({ where: { email: 'secours@iris.test' }, select: { role: true } });
      assert.equal(secours.role, 'SUPERADMIN');
      for (const [code, role] of [['AD', 'ADMIN'], ['DIR', 'DIRECTEUR'], ['AT', 'ASSISTANTE_TECHNIQUE'], ...TYPES_REFUSES.map((r) => [r, r])]) await creerCompte(code, role);
      const SA = entete(session);
      cleEcriture = (await ok(request(app).post('/api/admin/api-keys').set(SA).send({ nom: `TEST drapeaux 306 écriture ${suffixe()}`, scopes: ['clients:write'] }), 201)).apiKey;
      cleLecture = (await ok(request(app).post('/api/admin/api-keys').set(SA).send({ nom: `TEST drapeaux 306 lecture ${suffixe()}`, scopes: ['clients:read'] }), 201)).apiKey;
      assert.match(cleEcriture, /^iris_/);
      assert.match(cleLecture, /^iris_/);
      // Pièces lues pendant la barrière : identité de la société (signature d'un devis, émission d'une facture), plan
      // comptable minimal et mentions légales publiées (émission).
      await ok(request(app).put('/api/company').set(SA).send({ raisonSociale: 'TEST Émetteur drapeaux 306', siret: '30630630600030', adresse: '6 rue des Drapeaux', codePostal: '14000', ville: 'Caen', fuseauHoraire: 'Europe/Paris' }));
      const compte = async (code, libelle, nature) => ok(request(app).post('/api/comptabilite/comptes').set(SA).send({ code, libelle, nature }), 201);
      const clients = await compte('411000', 'TEST Clients drapeaux 306', 'ACTIF');
      const prestations = await compte('706000', 'TEST Prestations drapeaux 306', 'PRODUIT');
      const articles = await compte('707000', 'TEST Articles drapeaux 306', 'PRODUIT');
      const tva20 = await compte('445710', 'TEST TVA 20 drapeaux 306', 'TVA');
      const motif = 'TEST paramétrage comptable du lot 306';
      for (const [regle, donnees] of [['CLIENT', { compteId: clients.id }], ['VENTE_PRESTATION', { compteId: prestations.id }], ['VENTE_ARTICLE', { compteId: articles.id }], ['JOURNAL_VENTES', { journal: 'VE' }]]) {
        await ok(request(app).put(`/api/comptabilite/regles/${regle}`).set(SA).send({ ...donnees, motif }));
      }
      await ok(request(app).put('/api/comptabilite/tva/20').set(SA).send({ compteId: tva20.id, motif }));
      const version = await ok(request(app).post('/api/mentions-legales').set(SA).send({ mentions: 'TEST mentions drapeaux 306', cgv: 'TEST CGV drapeaux 306', penalites: 'TEST pénalités drapeaux 306' }), 201);
      await ok(request(app).post(`/api/mentions-legales/${version.version}/publier`).set(SA));
      tables = await tablesDeLaBase(prisma);
      assert.ok(['Client', 'ClientSite', 'ClientContact', 'Devis', 'DevisSignature', 'Facture'].every((t) => tables.includes(t)) && tables.length > 40, `tables relevées : ${tables.join(', ')}`);
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

    // --- 1. Fiche inconnue : 404, aucun drapeau retiré ---

    // Cadrage, « Critères métier observables », premier point, et périmètre 2 (« Existence vérifiée d'abord ») : la
    // modification d'un site inconnu avec un drapeau répond 404 « Site introuvable. », et l'ancien porteur garde son
    // drapeau, relu en base. Chaque drapeau seul, puis les trois ensemble. Écarte la lecture d'avant le lot (libération
    // avant l'écriture, 404 ensuite : le client perdait son site de facturation) et le mutant « 404 vérifié après la
    // libération » (même perte, dans la transaction validée).
    test('modification d’un site inconnu avec un drapeau de facturation, de siège ou de site principal : 404 « Site introuvable. », l’ancien site garde son drapeau, par chaque compte qui gère les clients et par clé', async () => {
      for (const p of PORTES) {
        const { client } = await nouveauClient(`site inconnu ${p.nom}`);
        for (const corps of [...DRAPEAUX_SITE.map((d) => ({ [d]: true })), { estSiteFacturation: true, estSiegeSocial: true, principal: true, nom: 'TEST renommé' }]) {
          await refuse(() => modifierSite(p, client.id, randomUUID(), corps), 404, MESSAGES.siteIntrouvable, `${p.nom}, site inconnu, ${JSON.stringify(corps)}`);
          assert.deepEqual(await drapeaux(client.id), tousSurA, `${p.nom}, ${JSON.stringify(corps)} : l’ancien site garde ses drapeaux`);
        }
      }
    });

    // Même règle, cadrage périmètre 2 et 3 : le clientId de l'URL fait partie du filtre. Le site d'un autre client, adressé
    // sous l'URL d'un client, répond 404 sans retirer aucun drapeau ni à l'un ni à l'autre ; sous un client inexistant,
    // 404 (« La modification sous un client inexistant répond 404 »). Écarte une libération faite sur le client de l'URL
    // avant de constater que le site ne lui appartient pas.
    test('modification du site d’un autre client, ou sous un client inexistant, avec les trois drapeaux : 404 « Site introuvable. », les deux clients gardent leurs drapeaux', async () => {
      for (const p of [porte('session de l’assistante technique'), porte('clé d’intégration clients:write')]) {
        const x = await nouveauClient(`site d’autrui X ${p.nom}`);
        const y = await nouveauClient(`site d’autrui Y ${p.nom}`);
        const tous = { estSiteFacturation: true, estSiegeSocial: true, principal: true };
        await refuse(() => modifierSite(p, x.client.id, y.b.id, tous), 404, MESSAGES.siteIntrouvable, `${p.nom}, site de Y sous l’URL de X`);
        await refuse(() => modifierSite(p, x.client.id, y.a.id, tous), 404, MESSAGES.siteIntrouvable, `${p.nom}, porteur de Y sous l’URL de X`);
        await refuse(() => modifierSite(p, randomUUID(), x.b.id, tous), 404, MESSAGES.siteIntrouvable, `${p.nom}, site de X sous un client inexistant`);
        assert.deepEqual(await drapeaux(x.client.id), tousSurA, `${p.nom} : X garde ses drapeaux`);
        assert.deepEqual(await drapeaux(y.client.id), tousSurA, `${p.nom} : Y garde ses drapeaux`);
      }
    });

    // Cadrage, « Critères métier observables » : « Même chose pour le contact principal (404 sans perte […]) » ; constat :
    // « `modifierContact` sur un contact inconnu répond 404 après avoir retiré le drapeau ». Contact inconnu, contact d'un
    // autre client, contact sous un client inexistant : 404 « Contact introuvable. », le contact principal le reste.
    test('modification d’un contact inconnu, d’un autre client ou sous un client inexistant, marqué principal : 404 « Contact introuvable. », l’ancien contact principal le reste, par chaque compte qui gère les clients et par clé', async () => {
      for (const p of PORTES) {
        const x = await nouveauClient(`contact inconnu X ${p.nom}`);
        const y = await nouveauClient(`contact inconnu Y ${p.nom}`);
        await refuse(() => modifierContact(p, x.client.id, randomUUID(), { principal: true }), 404, MESSAGES.contactIntrouvable, `${p.nom}, contact inconnu`);
        await refuse(() => modifierContact(p, x.client.id, randomUUID(), { principal: true, nom: 'TEST renommé' }), 404, MESSAGES.contactIntrouvable, `${p.nom}, contact inconnu renommé`);
        await refuse(() => modifierContact(p, x.client.id, y.q.id, { principal: true }), 404, MESSAGES.contactIntrouvable, `${p.nom}, contact de Y sous l’URL de X`);
        await refuse(() => modifierContact(p, randomUUID(), x.q.id, { principal: true }), 404, MESSAGES.contactIntrouvable, `${p.nom}, contact de X sous un client inexistant`);
        assert.deepEqual((await drapeaux(x.client.id)).contactPrincipal, ['TEST P principal'], `${p.nom} : X garde son contact principal`);
        assert.deepEqual((await drapeaux(y.client.id)).contactPrincipal, ['TEST P principal'], `${p.nom} : Y garde son contact principal`);
      }
    });

    // --- 2. Octet nul refusé par la base : aucun drapeau retiré (test obligatoire) ---

    // Cadrage, « Critères métier observables », deuxième point : « Création ou modification d'un site avec un drapeau,
    // refusée par la base : aucun drapeau n'est retiré. […] un octet nul (U+0000) dans un champ texte (`nom`, `adresse`,
    // `ville`…, ou `nom` d'un contact) est refusé par PostgreSQL, 500 « Erreur client. ». […] Ce test est obligatoire :
    // c'est le seul qui tue le mutant « libération hors transaction » quand l'existence est vérifiée d'abord. » La réponse
    // (500, message exact) est celle du code d'avant le lot (sonde du contrôleur) : le lot ne la change pas. Écarte la
    // libération validée avant l'écriture refusée (le client perdait ses drapeaux, sonde sur `main`).
    test('octet nul dans un champ du site créé ou modifié avec un drapeau : 500 « Erreur client. », aucun drapeau retiré, rien n’est écrit, par chaque compte qui gère les clients et par clé', async () => {
      for (const p of PORTES) {
        const { client, b } = await nouveauClient(`octet nul site ${p.nom}`);
        const cas = [
          ['création, nom avec U+0000, trois drapeaux', () => creerSite(p, client.id, corpsSite('TEST C\u0000nul', { estSiteFacturation: true, estSiegeSocial: true, principal: true }))],
          ['création, adresse avec U+0000, site de facturation', () => creerSite(p, client.id, corpsSite('TEST C adresse', { adresse: '2 rue\u0000du Test', estSiteFacturation: true }))],
          ['création, ville avec U+0000, siège social', () => creerSite(p, client.id, corpsSite('TEST C ville', { ville: 'Caen\u0000', estSiegeSocial: true }))],
          ['création, complément avec U+0000, site principal', () => creerSite(p, client.id, corpsSite('TEST C complément', { complementAdresse: 'Bât.\u0000C', principal: true }))],
          ['modification du site B, ville avec U+0000, site de facturation', () => modifierSite(p, client.id, b.id, { ville: 'Caen\u0000', estSiteFacturation: true })],
          ['modification du site B, nom avec U+0000, trois drapeaux', () => modifierSite(p, client.id, b.id, { nom: 'TEST B\u0000nul', estSiteFacturation: true, estSiegeSocial: true, principal: true })],
        ];
        for (const [quoi, envoi] of cas) {
          const avant = await etatClient(client.id);
          await refuse(envoi, 500, MESSAGES.erreurClient, `${p.nom}, ${quoi}`);
          assert.deepEqual(await drapeaux(client.id), tousSurA, `${p.nom}, ${quoi} : aucun drapeau retiré`);
          assert.deepEqual(await etatClient(client.id), avant, `${p.nom}, ${quoi} : fiches inchangées`);
        }
      }
    });

    test('octet nul dans le nom d’un contact créé ou modifié comme principal : 500 « Erreur client. », l’ancien contact principal le reste, rien n’est écrit, par chaque compte qui gère les clients et par clé', async () => {
      for (const p of PORTES) {
        const { client, q } = await nouveauClient(`octet nul contact ${p.nom}`);
        const cas = [
          ['création, nom avec U+0000, principal', () => creerContact(p, client.id, { nom: 'TEST R\u0000nul', principal: true })],
          ['création, nom et prénom, U+0000 dans le prénom, principal', () => creerContact(p, client.id, { nom: 'TEST R prénom', prenom: 'Ana\u0000ïs', principal: true })],
          ['modification du contact Q, nom avec U+0000, principal', () => modifierContact(p, client.id, q.id, { nom: 'TEST Q\u0000nul', principal: true })],
        ];
        for (const [quoi, envoi] of cas) {
          const avant = await etatClient(client.id);
          await refuse(envoi, 500, MESSAGES.erreurClient, `${p.nom}, ${quoi}`);
          assert.deepEqual((await drapeaux(client.id)).contactPrincipal, ['TEST P principal'], `${p.nom}, ${quoi} : P reste principal`);
          assert.deepEqual(await etatClient(client.id), avant, `${p.nom}, ${quoi} : fiches inchangées`);
        }
      }
    });

    // --- 3. Cas nominal : le drapeau passe d'un porteur à l'autre, jamais zéro ni deux ---

    // Cadrage, « Critères métier observables », troisième point : « Création d'un nouveau site de facturation : l'ancien
    // perd le drapeau et le nouveau le porte. Il n'y a jamais zéro ni deux sites de facturation » ; « Même chose pour le
    // siège, le site principal et le contact principal. » Périmètre 5 : aucune règle métier ne change. Chaque drapeau
    // n'est retiré qu'à l'ancien porteur de ce drapeau (le site A garde les deux autres) ; un site ou un contact sans
    // drapeau n'en retire aucun ; un autre client n'est jamais touché. Écarte une libération de tous les drapeaux pour un
    // seul posé, une libération sans filtre par client, et une libération faite pour un drapeau à `false`.
    test('création d’un site de facturation, de siège ou principal : l’ancien porteur perd ce seul drapeau, le nouveau le porte, un seul porteur à chaque étape, autre client intact, par chaque compte qui gère les clients et par clé', async () => {
      for (const p of PORTES) {
        const { client } = await nouveauClient(`création site ${p.nom}`);
        const autre = await nouveauClient(`création site, autre client ${p.nom}`);
        const autreAvant = await etatClient(autre.client.id);
        const etapes = [
          // [corps, porteurs attendus après l'écriture]
          [corpsSite('TEST C sans drapeau', { estSiteFacturation: false, estSiegeSocial: false, principal: false, estSiteIntervention: true }), tousSurA],
          [corpsSite('TEST D facturation', { estSiteFacturation: true }), { ...tousSurA, facturation: ['TEST D facturation'] }],
          [corpsSite('TEST E siège', { estSiegeSocial: true }), { ...tousSurA, facturation: ['TEST D facturation'], siege: ['TEST E siège'] }],
          [corpsSite('TEST F principal', { principal: true }), { ...tousSurA, facturation: ['TEST D facturation'], siege: ['TEST E siège'], sitePrincipal: ['TEST F principal'] }],
          [corpsSite('TEST G trois drapeaux', { estSiteFacturation: true, estSiegeSocial: true, principal: true }), { ...tousSurA, facturation: ['TEST G trois drapeaux'], siege: ['TEST G trois drapeaux'], sitePrincipal: ['TEST G trois drapeaux'] }],
        ];
        for (const [corps, attendu] of etapes) {
          const res = await creerSite(p, client.id, corps);
          assert.equal(res.status, 201, `${p.nom}, ${corps.nom} : ${JSON.stringify(res.body)}`);
          for (const d of DRAPEAUX_SITE) assert.equal(res.body[d], corps[d] === true, `${p.nom}, ${corps.nom} : ${d} dans la réponse`);
          const enBase = await prisma.clientSite.findUniqueOrThrow({ where: { id: res.body.id } });
          assert.deepEqual([enBase.clientId, enBase.nom, enBase.adresse], [client.id, corps.nom, corps.adresse], `${p.nom}, ${corps.nom} : site écrit`);
          assert.deepEqual(await drapeaux(client.id), attendu, `${p.nom}, après ${corps.nom}`);
        }
        assert.deepEqual(await etatClient(autre.client.id), autreAvant, `${p.nom} : l’autre client n’est pas touché`);
      }
    });

    test('modification d’un site existant vers la facturation, le siège ou le principal : l’ancien porteur perd ce seul drapeau, le site modifié le porte ; le porteur qui se repose le drapeau le garde, par chaque compte qui gère les clients et par clé', async () => {
      for (const p of PORTES) {
        const { client, a, b } = await nouveauClient(`modification site ${p.nom}`);
        const c = await prisma.clientSite.create({ data: { clientId: client.id, nom: 'TEST C ordinaire', adresse: '4 rue Ordinaire', codePostal: '14000', ville: 'Caen' } });
        const autre = await nouveauClient(`modification site, autre client ${p.nom}`);
        const autreAvant = await etatClient(autre.client.id);
        const etapes = [
          [b, { estSiteFacturation: true }, { ...tousSurA, facturation: ['TEST B ordinaire'] }],
          // Le porteur se repose le drapeau, avec un autre champ : il le garde (la libération l'exclut).
          [b, { estSiteFacturation: true, ville: 'Bayeux' }, { ...tousSurA, facturation: ['TEST B ordinaire'] }],
          [c, { estSiegeSocial: true }, { ...tousSurA, facturation: ['TEST B ordinaire'], siege: ['TEST C ordinaire'] }],
          [c, { principal: true }, { ...tousSurA, facturation: ['TEST B ordinaire'], siege: ['TEST C ordinaire'], sitePrincipal: ['TEST C ordinaire'] }],
          [a, { estSiteFacturation: true, estSiegeSocial: true, principal: true, nom: 'TEST A porteur' }, tousSurA],
        ];
        for (const [site, corps, attendu] of etapes) {
          const res = await modifierSite(p, client.id, site.id, corps);
          assert.equal(res.status, 200, `${p.nom}, ${site.nom} ${JSON.stringify(corps)} : ${JSON.stringify(res.body)}`);
          assert.equal(res.body.id, site.id);
          for (const [champ, valeur] of Object.entries(corps)) assert.equal(res.body[champ], valeur, `${p.nom}, ${site.nom} : ${champ} dans la réponse`);
          assert.deepEqual(await drapeaux(client.id), attendu, `${p.nom}, après ${site.nom} ${JSON.stringify(corps)}`);
        }
        assert.equal((await prisma.clientSite.findUniqueOrThrow({ where: { id: b.id } })).ville, 'Bayeux');
        assert.deepEqual(await etatClient(autre.client.id), autreAvant, `${p.nom} : l’autre client n’est pas touché`);
      }
    });

    test('contact principal créé ou modifié : l’ancien perd le drapeau, le nouveau le porte, un contact ordinaire n’en retire aucun, un seul principal à chaque étape, autre client intact, par chaque compte qui gère les clients et par clé', async () => {
      for (const p of PORTES) {
        const { client, q } = await nouveauClient(`contact principal ${p.nom}`);
        const autre = await nouveauClient(`contact principal, autre client ${p.nom}`);
        const autreAvant = await etatClient(autre.client.id);
        const ordinaire = await creerContact(p, client.id, { nom: 'TEST R ordinaire', principal: false });
        assert.equal(ordinaire.status, 201, JSON.stringify(ordinaire.body));
        assert.deepEqual((await drapeaux(client.id)).contactPrincipal, ['TEST P principal'], `${p.nom} : un contact ordinaire n’en retire aucun`);
        const nouveau = await creerContact(p, client.id, { nom: 'TEST S principal', principal: true });
        assert.equal(nouveau.status, 201, JSON.stringify(nouveau.body));
        assert.equal(nouveau.body.principal, true);
        assert.deepEqual((await drapeaux(client.id)).contactPrincipal, ['TEST S principal'], `${p.nom} : création d’un contact principal`);
        const modifie = await modifierContact(p, client.id, q.id, { principal: true });
        assert.equal(modifie.status, 200, JSON.stringify(modifie.body));
        assert.deepEqual([modifie.body.id, modifie.body.principal], [q.id, true]);
        assert.deepEqual((await drapeaux(client.id)).contactPrincipal, ['TEST Q ordinaire'], `${p.nom} : modification d’un contact vers principal`);
        const repose = await modifierContact(p, client.id, q.id, { principal: true, fonction: 'TEST Gérant' });
        assert.equal(repose.status, 200, JSON.stringify(repose.body));
        assert.deepEqual((await drapeaux(client.id)).contactPrincipal, ['TEST Q ordinaire'], `${p.nom} : le principal qui se repose le drapeau le garde`);
        assert.deepEqual(await etatClient(autre.client.id), autreAvant, `${p.nom} : l’autre client n’est pas touché`);
      }
    });

    // Cadrage, périmètre 3 : « Le verrou ne filtre pas sur `actif` : un client désactivé reçoit toujours ses sites et
    // contacts (201, `ecritures-modifications.txt`). » Le drapeau passe de l'un à l'autre comme pour un client actif.
    test('client désactivé : ses sites et contacts s’écrivent toujours (201 et 200), le drapeau passe de l’ancien porteur au nouveau', async () => {
      for (const p of [porte('session de l’administrateur'), porte('clé d’intégration clients:write')]) {
        const { client, b, q } = await nouveauClient(`désactivé ${p.nom}`, { extra: { actif: false } });
        assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).actif, false);
        assert.equal((await creerSite(p, client.id, corpsSite('TEST C facturation', { estSiteFacturation: true }))).status, 201);
        assert.equal((await modifierSite(p, client.id, b.id, { estSiegeSocial: true })).status, 200);
        assert.equal((await creerContact(p, client.id, { nom: 'TEST R principal', principal: true })).status, 201);
        assert.deepEqual(await drapeaux(client.id), { facturation: ['TEST C facturation'], siege: ['TEST B ordinaire'], sitePrincipal: ['TEST A porteur'], contactPrincipal: ['TEST R principal'] }, p.nom);
        assert.equal((await modifierContact(p, client.id, q.id, { principal: true })).status, 200);
        assert.deepEqual((await drapeaux(client.id)).contactPrincipal, ['TEST Q ordinaire'], p.nom);
      }
    });

    // --- 4. Barrière de concurrence déterministe ---

    // Cadrage, périmètre 1 (« Deux écritures simultanées sur les sites d'un même client se suivent : le verrou du client
    // garantit un seul drapeau ») et périmètre 5 (sous des écritures simultanées, plus de 409 : la dernière porte le
    // drapeau) ; « Mutants à tuer » : « Attendu : deux 201, un seul contact principal, un seul site de facturation. Sur le
    // mutant : deux contacts principaux, et 201 puis 409 pour les sites. » Les deux écritures attendent le verrou du
    // client, pris en tête de transaction (relevé : deux processus en attente) ; libérées, elles passent l'une après
    // l'autre. Écarte le verrou retiré (deux contacts principaux, 409), et REPEATABLE READ (l'instantané pris avant
    // l'attente ignore l'écriture qui vient d'aboutir : 500). Les deux écritures passent par deux portes distinctes.
    test('barrière : deux contacts principaux créés en même temps attendent le verrou du client, puis deux 201 et un seul contact principal', async () => {
      for (const [p1, p2] of [[porte('session de l’assistante technique'), porte('clé d’intégration clients:write')], [porte('session de l’administrateur'), porte('session du directeur')]]) {
        const { client } = await nouveauClient(`barrière contacts ${p1.nom}`);
        const barriere = await sousBarriere(client.id, [
          () => creerContact(p1, client.id, { nom: 'TEST S1 principal', principal: true }),
          () => creerContact(p2, client.id, { nom: 'TEST S2 principal', principal: true }),
        ]);
        assert.equal(barriere.enAttente, 2, `les deux écritures attendent le verrou du client : ${decrire(barriere)}`);
        assert.deepEqual(barriere.reponses.map((r) => r.status), [201, 201], decrire(barriere));
        const { contactPrincipal } = await drapeaux(client.id);
        assert.equal(contactPrincipal.length, 1, `un seul contact principal : ${contactPrincipal}`);
        assert.ok(['TEST S1 principal', 'TEST S2 principal'].includes(contactPrincipal[0]), `le principal est l’un des deux créés : ${contactPrincipal}`);
        assert.equal(await prisma.clientContact.count({ where: { clientId: client.id } }), 4, 'les deux contacts sont créés');
      }
    });

    test('barrière : deux sites portant les trois drapeaux créés en même temps attendent le verrou du client, puis deux 201 (plus de 409) et un seul porteur de chaque drapeau', async () => {
      for (const [p1, p2] of [[porte('session de l’assistante technique'), porte('clé d’intégration clients:write')], [porte('session du super administrateur'), porte('session de l’administrateur')]]) {
        const { client } = await nouveauClient(`barrière sites ${p1.nom}`);
        const tous = { estSiteFacturation: true, estSiegeSocial: true, principal: true };
        const barriere = await sousBarriere(client.id, [
          () => creerSite(p1, client.id, corpsSite('TEST S1 trois drapeaux', tous)),
          () => creerSite(p2, client.id, corpsSite('TEST S2 trois drapeaux', tous)),
        ]);
        assert.equal(barriere.enAttente, 2, `les deux écritures attendent le verrou du client : ${decrire(barriere)}`);
        assert.deepEqual(barriere.reponses.map((r) => r.status), [201, 201], decrire(barriere));
        const porteurs = await drapeaux(client.id);
        assert.equal(porteurs.facturation.length, 1, `un seul site de facturation : ${JSON.stringify(porteurs)}`);
        assert.ok(['TEST S1 trois drapeaux', 'TEST S2 trois drapeaux'].includes(porteurs.facturation[0]), JSON.stringify(porteurs));
        // La même écriture, la dernière, porte les trois drapeaux.
        assert.deepEqual([porteurs.siege, porteurs.sitePrincipal], [porteurs.facturation, porteurs.facturation], JSON.stringify(porteurs));
        assert.equal(await prisma.clientSite.count({ where: { clientId: client.id } }), 4, 'les deux sites sont créés');
      }
    });

    // Même règle pour la modification : le verrou est pris en tête de transaction, avant la vérification d'existence et
    // la libération (cadrage, périmètre 1 et 2). Deux sites existants passés en même temps « facturation, siège et
    // principal », deux contacts existants passés principaux, et une création mêlée à une modification.
    test('barrière : deux modifications simultanées (sites vers les trois drapeaux, contacts vers principal), et une création mêlée à une modification, attendent le verrou du client ; un seul porteur de chaque drapeau', async () => {
      const at = porte('session de l’assistante technique');
      const cle = porte('clé d’intégration clients:write');
      const tous = { estSiteFacturation: true, estSiegeSocial: true, principal: true };
      {
        const { client, b } = await nouveauClient('barrière modification sites');
        const c = await prisma.clientSite.create({ data: { clientId: client.id, nom: 'TEST C ordinaire', adresse: '4 rue Ordinaire', codePostal: '14000', ville: 'Caen' } });
        const barriere = await sousBarriere(client.id, [() => modifierSite(at, client.id, b.id, tous), () => modifierSite(cle, client.id, c.id, tous)]);
        assert.equal(barriere.enAttente, 2, `les deux modifications attendent le verrou du client : ${decrire(barriere)}`);
        assert.deepEqual(barriere.reponses.map((r) => r.status), [200, 200], decrire(barriere));
        const porteurs = await drapeaux(client.id);
        assert.equal(porteurs.facturation.length, 1, JSON.stringify(porteurs));
        assert.ok(['TEST B ordinaire', 'TEST C ordinaire'].includes(porteurs.facturation[0]), JSON.stringify(porteurs));
        assert.deepEqual([porteurs.siege, porteurs.sitePrincipal], [porteurs.facturation, porteurs.facturation], JSON.stringify(porteurs));
      }
      {
        const { client, q } = await nouveauClient('barrière modification contacts');
        const r = await prisma.clientContact.create({ data: { clientId: client.id, nom: 'TEST R ordinaire' } });
        const barriere = await sousBarriere(client.id, [() => modifierContact(at, client.id, q.id, { principal: true }), () => modifierContact(cle, client.id, r.id, { principal: true })]);
        assert.equal(barriere.enAttente, 2, `les deux modifications attendent le verrou du client : ${decrire(barriere)}`);
        assert.deepEqual(barriere.reponses.map((res) => res.status), [200, 200], decrire(barriere));
        const { contactPrincipal } = await drapeaux(client.id);
        assert.equal(contactPrincipal.length, 1, `un seul contact principal : ${contactPrincipal}`);
        assert.ok(['TEST Q ordinaire', 'TEST R ordinaire'].includes(contactPrincipal[0]), `${contactPrincipal}`);
      }
      {
        const { client, b, q } = await nouveauClient('barrière création et modification');
        const barriere = await sousBarriere(client.id, [
          () => creerSite(at, client.id, corpsSite('TEST S nouveau', { estSiteFacturation: true })),
          () => modifierSite(cle, client.id, b.id, { estSiteFacturation: true }),
          () => creerContact(cle, client.id, { nom: 'TEST S principal', principal: true }),
          () => modifierContact(at, client.id, q.id, { principal: true }),
        ]);
        assert.equal(barriere.enAttente, 4, `les quatre écritures attendent le verrou du client : ${decrire(barriere)}`);
        assert.deepEqual(barriere.reponses.map((res) => res.status), [201, 200, 201, 200], decrire(barriere));
        const porteurs = await drapeaux(client.id);
        assert.equal(porteurs.facturation.length, 1, JSON.stringify(porteurs));
        assert.ok(['TEST S nouveau', 'TEST B ordinaire'].includes(porteurs.facturation[0]), JSON.stringify(porteurs));
        assert.equal(porteurs.contactPrincipal.length, 1, JSON.stringify(porteurs));
        assert.ok(['TEST S principal', 'TEST Q ordinaire'].includes(porteurs.contactPrincipal[0]), JSON.stringify(porteurs));
        assert.deepEqual([porteurs.siege, porteurs.sitePrincipal], [['TEST A porteur'], ['TEST A porteur']], JSON.stringify(porteurs));
      }
    });

    // Cadrage, « Critères métier observables », dernier point (« Une facture émise pendant le changement de site de
    // facturation copie l'ancienne adresse ou la nouvelle, jamais une troisième ») et « Mutants à tuer » (« La même
    // barrière rend déterministe le critère de la pièce : un devis signé (ou une facture émise) pendant que la création
    // d'un nouveau site de facturation attend fige l'ancienne adresse ; sur `main`, il fige celle du site principal, une
    // troisième adresse »). Le client a un site de facturation (ancienne adresse) et un autre site, principal (troisième
    // adresse, retenue par SITE_FACTURATION_ORDRE faute de site de facturation). Le nouveau site de facturation (nouvelle
    // adresse) est créé, ou un site existant modifié, pendant que la connexion témoin tient le verrou ; la pièce est signée
    // ou émise pendant l'attente : elle fige l'ancienne adresse. La signature aboutit dans la fenêtre ; l'émission y lit
    // le site, puis attend elle-même la fiche client (clé étrangère revérifiée, voir sousBarriere) et aboutit après la
    // libération, avec l'adresse lue. Après la libération, une seconde pièce fige la nouvelle.
    // Écarte : la troisième adresse (état intermédiaire visible : libération validée avant l'écriture du site, `main`) ;
    // la nouvelle adresse pendant l'attente (la pièce aurait attendu l'écriture, ou lu une écriture non validée).
    for (const piece of ['devis signé', 'facture émise']) {
      for (const ecriture of ['création', 'modification']) {
        const quelleEcriture = ecriture === 'création' ? 'la création d’un nouveau site de facturation' : 'le passage d’un site existant en site de facturation';
        test(`barrière : ${piece === 'devis signé' ? 'un devis signé' : 'une facture émise'} pendant ${quelleEcriture} fige l’ancienne adresse, jamais celle du site principal ; la pièce suivante fige la nouvelle`, async () => {
          const SA = entete(session);
          const at = porte('session de l’assistante technique');
          const { client } = await nouveauClient(`pièce ${piece} ${ecriture}`, { avecSiren: true, siteA: { nom: 'TEST A facturation', estSiegeSocial: false, principal: false } });
          // Le site B de la fixture devient le site principal, à la troisième adresse.
          const fixture = await prisma.clientSite.findFirstOrThrow({ where: { clientId: client.id, nom: 'TEST B ordinaire' } });
          await prisma.clientSite.update({ where: { id: fixture.id }, data: { nom: 'TEST Z principal', ...ADRESSE_TROISIEME, principal: true } });
          const existant = await prisma.clientSite.create({ data: { clientId: client.id, nom: 'TEST N existant', ...ADRESSE_NOUVELLE } });
          assert.deepEqual(await drapeaux(client.id), { facturation: ['TEST A facturation'], siege: [], sitePrincipal: ['TEST Z principal'], contactPrincipal: ['TEST P principal'] });
          const preparer = async () => {
            if (piece === 'devis signé') {
              const devis = await ok(request(app).post('/api/devis').set(SA).send({ clientId: client.id, objet: `TEST devis drapeaux 306 ${suffixe()}`, lignes: [{ designation: 'TEST prestation', quantite: 1, prixUnitaireHt: 10, tauxTva: 20 }] }), 201);
              return {
                lire: () => request(app).post(`/api/devis/${devis.id}/signature`).set(SA).send({ signataire: 'TEST Signataire', confirme: true }),
                statut: 201,
                adresseFigee: async () => (await prisma.devisSignature.findUniqueOrThrow({ where: { devisId: devis.id } })).clientAdresse,
              };
            }
            const brouillon = await ok(request(app).post('/api/factures').set(SA).send({ clientId: client.id, origine: 'HORS_AFFAIRE', motifHorsAffaire: 'TEST drapeaux 306', dateEmission: '10-09-2026', dateEcheance: '10-10-2026', lignes: [{ designation: 'TEST prestation', quantite: 1, prixUnitaireHt: 10, tauxTva: 20 }] }), 201);
            return {
              lire: () => request(app).post(`/api/factures/${brouillon.id}/emettre`).set(SA),
              statut: 200,
              adresseFigee: async () => (await prisma.facture.findUniqueOrThrow({ where: { id: brouillon.id } })).clientAdresse,
            };
          };
          const pendant = await preparer();
          const ecrire = ecriture === 'création'
            ? () => creerSite(at, client.id, { nom: 'TEST N nouveau', ...ADRESSE_NOUVELLE, estSiteFacturation: true })
            : () => modifierSite(at, client.id, existant.id, { estSiteFacturation: true });
          const barriere = await sousBarriere(client.id, [ecrire], { attendues: 1, pendant: () => pendant.lire().then((res) => res) });
          assert.equal(barriere.enAttente, 1, `l’écriture du site attend le verrou du client : ${decrire(barriere)}`);
          // La pièce a lu les sites dans la fenêtre : elle a abouti avant que le verrou soit rendu (devis), ou elle attendait
          // à son tour la fiche client, après sa lecture (facture, voir sousBarriere).
          assert.ok(barriere.lu && (barriere.lu.finiePendant || barriere.lu.bloqueePendant), `la pièce lit les sites pendant l’attente : ${decrire(barriere)}`);
          if (piece === 'devis signé') assert.equal(barriere.lu.finiePendant, true, `la signature n’attend pas la fiche client : ${decrire(barriere)}`);
          assert.equal(barriere.lu.valeur.status, pendant.statut, JSON.stringify(barriere.lu.valeur.body));
          assert.deepEqual(barriere.reponses.map((r) => r.status), [ecriture === 'création' ? 201 : 200], decrire(barriere));
          const figee = await pendant.adresseFigee();
          assert.notEqual(figee, copieAdresse(ADRESSE_TROISIEME), `${piece} : jamais la troisième adresse (site principal)`);
          assert.equal(figee, copieAdresse(ADRESSE_ANCIENNE), `${piece} pendant l’attente : l’ancienne adresse`);
          const porteurs = await drapeaux(client.id);
          assert.deepEqual(porteurs.facturation, [ecriture === 'création' ? 'TEST N nouveau' : 'TEST N existant'], JSON.stringify(porteurs));
          // Après la libération, une nouvelle pièce copie la nouvelle adresse, et la première garde l'ancienne.
          const suivante = await preparer();
          const res = await suivante.lire();
          assert.equal(res.status, suivante.statut, JSON.stringify(res.body));
          assert.equal(await suivante.adresseFigee(), copieAdresse(ADRESSE_NOUVELLE), `${piece} après la libération : la nouvelle adresse`);
          assert.equal(await pendant.adresseFigee(), copieAdresse(ADRESSE_ANCIENNE), `${piece} pendant l’attente : toujours l’ancienne adresse`);
        });
      }
    }

    // --- 5. Comportements gardés (#426, hors périmètre) ---

    // Cadrage, périmètre 2 : « Corps sans champ modifiable (corps vide, ou champs inconnus seulement) : la réponse
    // actuelle est gardée, 404 « Site introuvable. » ou « Contact introuvable. », sans rien écrire » (défaut connu de
    // #426, traité après le pilote ; `entrees.txt` et `cles.txt` inchangées). Fige le comportement, sans le corriger.
    test('corps vide ou sans champ modifiable en modification d’un site ou d’un contact existant : 404 gardé (#426), rien n’est écrit, aucun drapeau retiré', async () => {
      for (const p of PORTES) {
        const { client, a, b, p: principal, q } = await nouveauClient(`corps vide ${p.nom}`);
        for (const corps of [{}, { inconnu: true }, { estSiteFacturationX: true, id: randomUUID() }]) {
          for (const site of [a, b]) await refuse(() => modifierSite(p, client.id, site.id, corps), 404, MESSAGES.siteIntrouvable, `${p.nom}, site ${site.nom}, ${JSON.stringify(corps)}`);
          for (const contact of [principal, q]) await refuse(() => modifierContact(p, client.id, contact.id, corps), 404, MESSAGES.contactIntrouvable, `${p.nom}, contact ${contact.nom}, ${JSON.stringify(corps)}`);
        }
        assert.deepEqual(await drapeaux(client.id), tousSurA, p.nom);
      }
    });

    // Cadrage, périmètre 3 : « La création d'un site ou d'un contact pour un client inexistant garde son comportement
    // actuel, vérifié par le contrôleur : 500 « Erreur client. » (clé étrangère, `P2003`, non traduite), aucun drapeau
    // modifié ; 400 si le corps est invalide (contrôlé avant la base). » (#426, hors périmètre ; `cles-montants.txt`,
    // l. 113 et 119, inchangées.) Fige le comportement, sans le corriger.
    test('création d’un site ou d’un contact pour un client inexistant : 500 « Erreur client. » gardé (#426), 400 si le corps est invalide, rien n’est écrit', async () => {
      for (const p of PORTES) {
        const absent = randomUUID();
        const temoin = await nouveauClient(`client inexistant, témoin ${p.nom}`);
        await refuse(() => creerSite(p, absent, corpsSite('TEST X facturation', { estSiteFacturation: true, estSiegeSocial: true, principal: true })), 500, MESSAGES.erreurClient, `${p.nom}, site`);
        await refuse(() => creerContact(p, absent, { nom: 'TEST X principal', principal: true }), 500, MESSAGES.erreurClient, `${p.nom}, contact`);
        await refuse(() => creerSite(p, absent, { estSiteFacturation: true }), 400, MESSAGES.nomSiteObligatoire, `${p.nom}, site, corps invalide`);
        await refuse(() => creerSite(p, absent, {}), 400, MESSAGES.nomSiteObligatoire, `${p.nom}, site, corps vide`);
        await refuse(() => creerContact(p, absent, { principal: true }), 400, MESSAGES.nomContactObligatoire, `${p.nom}, contact, corps invalide`);
        await refuse(() => creerContact(p, absent, {}), 400, MESSAGES.nomContactObligatoire, `${p.nom}, contact, corps vide`);
        assert.deepEqual(await drapeaux(temoin.client.id), tousSurA, p.nom);
      }
    });

    // --- 6. Droits inchangés ---

    // Cadrage, périmètre 5 : « réponses, messages, droits et drapeaux restent les mêmes ». Les écritures des clients sont
    // réservées à l'administration et à l'assistante technique (requireGestionClients, décision de Nelson du 24-10-2026,
    // point 24) et, par /api/v1, à la clé `clients:write` : chaque autre type de compte, et une clé `clients:read`, sont
    // refusés aux quatre routes avec un drapeau, sans rien écrire et sans retirer aucun drapeau.
    test('les autres comptes et une clé sans clients:write sont refusés aux quatre routes avec un drapeau (403, message exact), rien n’est écrit, aucun drapeau retiré', async () => {
      const { client, b, q } = await nouveauClient('droits');
      const tous = { estSiteFacturation: true, estSiegeSocial: true, principal: true };
      const refusees = [
        ...TYPES_REFUSES.map((code) => ({ nom: `session ${code}`, base: '/api', auth: () => comptes[code].auth, message: MESSAGES.gestion })),
        { nom: 'clé d’intégration clients:read', base: '/api/v1', auth: () => entete(cleLecture), message: MESSAGES.scope },
      ];
      for (const p of refusees) {
        await refuse(() => creerSite(p, client.id, corpsSite('TEST X refusé', tous)), 403, p.message, `${p.nom}, création de site`);
        await refuse(() => modifierSite(p, client.id, b.id, tous), 403, p.message, `${p.nom}, modification de site`);
        await refuse(() => creerContact(p, client.id, { nom: 'TEST X refusé', principal: true }), 403, p.message, `${p.nom}, création de contact`);
        await refuse(() => modifierContact(p, client.id, q.id, { principal: true }), 403, p.message, `${p.nom}, modification de contact`);
      }
      assert.deepEqual(await drapeaux(client.id), tousSurA);
    });
  });
}
