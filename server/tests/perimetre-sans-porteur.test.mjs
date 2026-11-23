// Lot AA (#668, suivi de l'audit des droits du lot Y, #667) : N1, le périmètre de lecture des chantiers se ferme sans porteur.
// Cadrage v2 du lot AA, après le contrôle de cohérence sur aaba7e2 (section « Cadrage v2 », point 2 du périmètre, « Critères
// observables » et « Tests »), qui fait foi. Règle 2 de la méthode : droits et périmètres, prouvés sur PostgreSQL jetable.
//
// Ce que le lot change (server/src/droits/perimetres.ts) : sans clé ni compte connecté, perimetreDemandeur renvoie
// `{ id: { in: [] } }` (aucun chantier) au lieu de `{}` (aucune restriction) ; perimetreChantiers et
// perimetreChantiersAnnulesCompris en héritent. Micro-arbitrage de droits, règle 5 : l'option la plus restrictive, choix par
// défaut, à confirmer. Cas inatteignable aujourd'hui (les dix appels sont gardés par requireAuth ou requireApiKey) : une
// route montée un jour sans garde ne lirait rien, au lieu de tout.
//
// Pourquoi pas un test d'API : la garde répond 401 avant le périmètre (lignes ANONYME de matrice-droits/entrees.txt). On
// importe donc le code compilé, comme heures-quart-heure.test.mjs : perimetreDemandeur n'est pas exporté, on passe par
// perimetreChantiers et perimetreChantiersAnnulesCompris ; aucun export n'est ajouté à index.ts (la liste EXPORT de la
// référence des routes changerait).
//
// Deux parties :
//  1. sans base : la forme rendue sans porteur, pour une clé et pour chaque type de compte (comportement inchangé) ;
//  2. PostgreSQL (base jetable propre au fichier) : une petite application Express, montée dans ce fichier, lit par les
//     compositions qu'emploient les appels du code. Ses portes : la garde réelle des sessions (requireAuth), la garde réelle
//     des clés (requireApiKey('chantiers:read')), et une porte SANS garde, la route « montée un jour sans garde » du
//     cadrage. Témoin : une clé, un administrateur et le conducteur titulaire lisent le chantier en cours et l'annulé ; sans
//     porteur, chacune des cinq compositions du cadrage ne lit rien (findMany vide, findFirst nul).
//     Sans TEST_DATABASE_URL, cette partie s'annonce ignorée : un SKIP n'est pas une réussite.
//
// Mutants que ce fichier tue (joués sur une copie de dist, hors du dépôt) : retour à `{}` sans porteur (la règle de aaba7e2) ;
// `notIn: []` à la place de `in: []` (Prisma lit `notIn: []` comme toujours vrai) ; branche de la clé retirée, ou test du
// compte placé avant celui de la clé (la clé, sans compte, tomberait sur le filtre fermé et ne lirait plus rien).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Le module compilé est CommonJS : ses exports nommés se lisent directement, ou par `default` (même lecture que
// heures-quart-heure.test.mjs).
const chargerPerimetres = async () => {
  const module = await import('../dist/src/droits/perimetres.js');
  const perimetreChantiers = module.perimetreChantiers ?? module.default.perimetreChantiers;
  const perimetreChantiersAnnulesCompris = module.perimetreChantiersAnnulesCompris ?? module.default.perimetreChantiersAnnulesCompris;
  assert.equal(typeof perimetreChantiers, 'function');
  assert.equal(typeof perimetreChantiersAnnulesCompris, 'function');
  return { perimetreChantiers, perimetreChantiersAnnulesCompris };
};

// Filtres attendus. `{ id: { in: [] } }` : aucun chantier (même forme que facturesVisibles, factures/droits.ts) ;
// `{ statut: { not: 'ANNULE' } }` : une affaire annulée sort des listes de tout le monde (AFFAIRE_NON_ANNULEE).
const FERME = { id: { in: [] } };
const NON_ANNULEE = { statut: { not: 'ANNULE' } };

// Requêtes simulées : perimetreDemandeur ne lit que `req.apiKey` (posé par requireApiKey) et `req.user` (posé par
// requireAuth). La partie PostgreSQL passe, elle, par les vraies gardes.
const compte = (role, id = `compte-${role.toLowerCase()}`, equipeIds = []) => ({ user: { id, name: `TEST ${role}`, role, accesFinance: false, permissions: [], equipeIds } });
const cle = { apiKey: { id: 'cle-lot-aa', nom: 'TEST clé lot AA', scopes: ['chantiers:read'] } };

describe('Lot AA (#668, N1) : périmètre de lecture des chantiers sans porteur — forme du filtre, sans base', () => {
  let perimetres;
  before(async () => { perimetres = await chargerPerimetres(); });

  // Cadrage v2, point 2 : « Sans clé ni compte connecté, perimetreDemandeur renvoie { id: { in: [] } } au lieu de {} ».
  // Lectures écartées : `{}` (la règle de aaba7e2, qui ouvrait tout), `{ id: { notIn: [] } }` (toujours vrai), un filtre
  // fermé sur les seules affaires en cours (les annulées resteraient lisibles par le journal).
  test('sans session ni clé, les deux périmètres des chantiers se ferment : aucun chantier, et non « aucune restriction », affaires annulées comprises', () => {
    const { perimetreChantiers, perimetreChantiersAnnulesCompris } = perimetres;
    // Trois écritures d'une requête sans porteur : rien de posé, des champs vides, des champs nuls.
    for (const [quoi, req] of [['rien de posé', {}], ['champs undefined', { user: undefined, apiKey: undefined }], ['champs null', { user: null, apiKey: null }]]) {
      assert.deepEqual(perimetreChantiers(req), { ...NON_ANNULEE, ...FERME }, `liste des chantiers, ${quoi}`);
      assert.deepEqual(perimetreChantiersAnnulesCompris(req), FERME, `journal, affaires annulées comprises, ${quoi}`);
    }
  });

  // Cadrage v2, « Tests » : « la forme rendue sans porteur, et celle d'une clé et d'un administrateur ». Comportement inchangé
  // pour une clé : le SCOPE décide, aucune restriction de porteur. Tue la branche de la clé retirée, et le test du compte placé
  // avant celui de la clé (une clé, sans compte, recevrait le filtre fermé).
  test('une clé d’intégration garde « aucune restriction » : les affaires en cours dans la liste, toutes dans le journal', () => {
    const { perimetreChantiers, perimetreChantiersAnnulesCompris } = perimetres;
    assert.deepEqual(perimetreChantiers(cle), NON_ANNULEE);
    assert.deepEqual(perimetreChantiersAnnulesCompris(cle), {});
  });

  // Comportement inchangé pour les comptes qui lisent toute la société (litToutesLesAffaires : administration, dont le
  // directeur, et assistante technique), et pour les comptes à périmètre (conducteur, technicien, responsable et sa branche,
  // commercial) : le lot ne touche que l'absence de porteur.
  test('les comptes gardent leur périmètre : super administrateur, administrateur, directeur et assistante technique sans restriction ; conducteur, technicien, responsable et commercial restreints comme avant', () => {
    const { perimetreChantiers, perimetreChantiersAnnulesCompris } = perimetres;
    for (const role of ['SUPERADMIN', 'ADMIN', 'DIRECTEUR', 'ASSISTANTE_TECHNIQUE']) {
      assert.deepEqual(perimetreChantiers(compte(role)), NON_ANNULEE, role);
      assert.deepEqual(perimetreChantiersAnnulesCompris(compte(role)), {}, role);
    }
    for (const role of ['CONDUCTEUR_TRAVAUX', 'TECHNICIEN']) {
      assert.deepEqual(perimetreChantiers(compte(role, 'u1')), { ...NON_ANNULEE, responsableId: 'u1' }, role);
      assert.deepEqual(perimetreChantiersAnnulesCompris(compte(role, 'u1')), { responsableId: 'u1' }, role);
    }
    assert.deepEqual(perimetreChantiers(compte('RESPONSABLE', 'r1', ['c1', 'c2'])), { ...NON_ANNULEE, responsableId: { in: ['r1', 'c1', 'c2'] } });
    assert.deepEqual(perimetreChantiersAnnulesCompris(compte('RESPONSABLE', 'r1', ['c1', 'c2'])), { responsableId: { in: ['r1', 'c1', 'c2'] } });
    assert.deepEqual(perimetreChantiers(compte('COMMERCIAL', 'v1')), { ...NON_ANNULEE, commercialId: 'v1' });
    assert.deepEqual(perimetreChantiersAnnulesCompris(compte('COMMERCIAL', 'v1')), { commercialId: 'v1' });
  });
});

const TITRE_BASE = 'Lot AA (#668, N1) : périmètre de lecture des chantiers sans porteur — compositions des appels, sur PostgreSQL';

if (!TEST_DATABASE_URL) {
  describe(TITRE_BASE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE_BASE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_perimetre_sans_porteur_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;
    let request; let prisma; let prismaApplication; let jwt; let app;
    const donnees = {};
    const porteurs = {};
    const suffixe = randomBytes(4).toString('hex');
    const tries = (lignes) => lignes.map((ligne) => ligne.id).sort();

    before(async () => {
      assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname), 'seul un PostgreSQL local est autorisé');
      assert.notEqual(source.pathname.slice(1), nomBase);
      await administrationPg.connect();
      await administrationPg.query(`CREATE DATABASE "${nomBase}"`);
      baseCreee = true;
      execFileSync(resolve(dossierServeur, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', resolve(dossierServeur, 'prisma/schema.prisma')], {
        env: { ...process.env, DATABASE_URL: cible.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
      });
      // Posés avant d'importer les gardes : db.js lit DATABASE_URL et auth.js le secret des sessions en se chargeant.
      process.env.DATABASE_URL = cible.toString();
      process.env.NODE_ENV = 'test';
      process.env.JWT_SECRET = 'secret-de-test-uniquement';
      request = (await import('supertest')).default;
      jwt = (await import('jsonwebtoken')).default;
      const express = (await import('express')).default;
      const client = await import('@prisma/client');
      prisma = new client.PrismaClient({ datasources: { db: { url: cible.toString() } } });
      const db = await import('../dist/src/db.js');
      prismaApplication = db.prisma ?? db.default.prisma;
      const auth = await import('../dist/src/http/auth.js');
      const requireAuth = auth.requireAuth ?? auth.default.requireAuth;
      const clesApi = await import('../dist/src/http/cles-api.js');
      const requireApiKey = clesApi.requireApiKey ?? clesApi.default.requireApiKey;
      const apiKeyHash = clesApi.apiKeyHash ?? clesApi.default.apiKeyHash;
      const { perimetreChantiers, perimetreChantiersAnnulesCompris } = await chargerPerimetres();

      // --- Données : un client, un chantier en cours et un chantier annulé, tous deux du même client et du même conducteur
      // titulaire ; sur chacun, un achat, un pointage d'heures et une affectation du planning (non archivés).
      const admin = await prisma.user.create({ data: { email: `lot-aa.admin.${suffixe}@iris.test`, name: `TEST Administrateur lot AA ${suffixe}`, role: 'ADMIN' } });
      const conducteur = await prisma.user.create({ data: { email: `lot-aa.conducteur.${suffixe}@iris.test`, name: `TEST Conducteur lot AA ${suffixe}`, role: 'CONDUCTEUR_TRAVAUX' } });
      const fiche = await prisma.client.create({ data: { raisonSociale: `TEST Client lot AA ${suffixe}` } });
      const chantier = (nom, extra = {}) => prisma.chantier.create({ data: {
        nom: `TEST Chantier lot AA ${nom} ${suffixe}`, client: fiche.raisonSociale, clientId: fiche.id, dateDebut: new Date('2026-10-01T00:00:00Z'),
        budgetGlobalVendu: '1000', responsableId: conducteur.id, ...extra,
      } });
      donnees.client = fiche;
      donnees.enCours = await chantier('en cours');
      donnees.annule = await chantier('annulé', { statut: 'ANNULE', annuleLe: new Date('2026-10-20T09:00:00Z'), annuleParId: admin.id, motifAnnulation: 'TEST annulation lot AA' });
      assert.equal(donnees.enCours.statut, 'EN_COURS');
      const categorie = await prisma.categorie.create({ data: { nom: `TEST Catégorie lot AA ${suffixe}` } });
      const fournisseur = await prisma.fournisseur.create({ data: { nom: `TEST Fournisseur lot AA ${suffixe}` } });
      const intervenant = await prisma.intervenant.create({ data: { nom: `TEST Intervenant lot AA ${suffixe}`, role: 'Technicien', tauxHoraireCharge: '40' } });
      for (const [code, c] of [['EnCours', donnees.enCours], ['Annule', donnees.annule]]) {
        donnees[`achat${code}`] = await prisma.achatReel.create({ data: {
          date: new Date('2026-10-05T00:00:00Z'), fournisseurId: fournisseur.id, categorieId: categorie.id, chantierId: c.id,
          description: `TEST achat lot AA ${code}`, montantHT: '123.45', createdById: admin.id, updatedById: admin.id,
        } });
        donnees[`pointage${code}`] = await prisma.pointageHeure.create({ data: {
          date: new Date('2026-10-05T00:00:00Z'), intervenantId: intervenant.id, chantierId: c.id, nbrHeures: '3.25', tauxHoraireApplique: '40',
          createdById: admin.id, updatedById: admin.id,
        } });
        donnees[`affectation${code}`] = await prisma.planningEvent.create({ data: {
          categorie: 'CHANTIER', dateDebut: new Date('2026-10-06T00:00:00Z'), dateFin: new Date('2026-10-06T00:00:00Z'), chantierId: c.id, titre: `TEST affectation lot AA ${code}`,
        } });
      }

      // --- Porteurs réels : un jeton de session (administrateur, conducteur titulaire), une clé `chantiers:read`.
      const secret = `iris_${randomBytes(32).toString('hex')}`;
      await prisma.apiAccessKey.create({ data: { nom: `TEST clé lot AA ${suffixe}`, prefixe: secret.slice(0, 13), secretHash: apiKeyHash(secret), scopes: ['chantiers:read'], creeParId: admin.id } });
      porteurs.cle = { Authorization: `Bearer ${secret}` };
      porteurs.administrateur = { Authorization: `Bearer ${jwt.sign({ id: admin.id }, process.env.JWT_SECRET)}` };
      porteurs.conducteur = { Authorization: `Bearer ${jwt.sign({ id: conducteur.id }, process.env.JWT_SECRET)}` };

      // --- Application de test : les cinq compositions du cadrage v2 (« Critères observables »), écrites comme les appels du
      // code, avec le client Prisma de l'application. Une porte par nature de porteur, et une porte sans garde.
      const lire = async (req, res) => {
        const db = prismaApplication;
        const premier = async (id) => (await db.chantier.findFirst({ where: { id, ...perimetreChantiersAnnulesCompris(req) }, select: { id: true } }))?.id ?? null;
        res.json({
          porteur: { session: Boolean(req.user), cle: Boolean(req.apiKey) },
          // Le filtre seul : `where: perimetreChantiers(req)` (GET /api/chantiers, statistiques) ; et, affaires annulées
          // comprises, le périmètre du journal sans identifiant.
          seul: tries(await db.chantier.findMany({ where: perimetreChantiers(req), select: { id: true } })),
          seulAnnulesCompris: tries(await db.chantier.findMany({ where: perimetreChantiersAnnulesCompris(req), select: { id: true } })),
          // Après l'identifiant, comme le journal (chantiers/routes.ts) : `{ id, ...perimetreChantiersAnnulesCompris(req) }`.
          apresIdentifiant: { enCours: await premier(donnees.enCours.id), annule: await premier(donnees.annule.id) },
          // Après le client (GET /api/clients/:id/chantiers) : `{ clientId, ...perimetreChantiers(req) }`.
          apresClient: tries(await db.chantier.findMany({ where: { clientId: donnees.client.id, ...perimetreChantiers(req) }, select: { id: true } })),
          // Imbriqué (GET /api/achats, GET /api/heures, statistiques) : `{ archivedAt: null, chantier: perimetreChantiers(req) }`.
          achats: tries(await db.achatReel.findMany({ where: { archivedAt: null, chantier: perimetreChantiers(req) }, select: { id: true } })),
          heures: tries(await db.pointageHeure.findMany({ where: { archivedAt: null, chantier: perimetreChantiers(req) }, select: { id: true } })),
          // Imbriqué par `is` (GET /api/planning/events) : `{ chantier: { is: perimetreChantiers(req) } }`.
          planning: tries(await db.planningEvent.findMany({ where: { chantier: { is: perimetreChantiers(req) } }, select: { id: true } })),
        });
      };
      app = express();
      app.get('/sans-garde', lire);
      app.get('/session', requireAuth, lire);
      app.get('/cle', requireApiKey('chantiers:read'), lire);
    });

    after(async () => {
      await prisma?.$disconnect().catch(() => {});
      await prismaApplication?.$disconnect().catch(() => {});
      if (baseCreee) {
        // Un autovacuum peut tenir la base un instant : quelques essais, puis l'erreur.
        for (let essai = 1; ; essai += 1) {
          try { await administrationPg.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`); break; } catch (erreur) { if (essai >= 5) throw erreur; await pause(500); }
        }
      }
      await administrationPg.end().catch(() => {});
    });

    // Lit les cinq compositions par une porte ; vérifie le statut et la nature du porteur que la porte a vue.
    const lecture = async (quoi) => {
      const [chemin, entete, porteur] = {
        cle: ['/cle', porteurs.cle, { session: false, cle: true }],
        administrateur: ['/session', porteurs.administrateur, { session: true, cle: false }],
        conducteur: ['/session', porteurs.conducteur, { session: true, cle: false }],
        sansPorteur: ['/sans-garde', null, { session: false, cle: false }],
      }[quoi];
      const requete = request(app).get(chemin);
      if (entete) requete.set(entete);
      const res = await requete;
      assert.equal(res.status, 200, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body.porteur, porteur, `${quoi} : porteur vu par la porte`);
      return res.body;
    };
    const AVEC_PORTEUR = ['cle', 'administrateur', 'conducteur'];

    // Cadrage v2, « Critères observables » : « Un compte et une clé d'intégration lisent au moins un chantier en cours et un
    // chantier annulé. C'est le témoin, qui ne doit pas être vide. » Les lignes sont bien en base (lecture sans filtre) ; une
    // clé `chantiers:read`, un administrateur et le conducteur titulaire, passés par leur garde réelle, lisent les deux
    // chantiers au périmètre du journal, et le seul chantier en cours au périmètre des listes (comportement inchangé).
    test('témoin : une clé chantiers:read, un administrateur et le conducteur titulaire, passés par leur garde réelle, lisent le chantier en cours et le chantier annulé', async () => {
      assert.equal(await prisma.chantier.count({ where: { id: { in: [donnees.enCours.id, donnees.annule.id] } } }), 2);
      assert.equal(await prisma.achatReel.count(), 2);
      assert.equal(await prisma.pointageHeure.count(), 2);
      assert.equal(await prisma.planningEvent.count(), 2);
      for (const quoi of AVEC_PORTEUR) {
        const lu = await lecture(quoi);
        assert.deepEqual(lu.seulAnnulesCompris, [donnees.enCours.id, donnees.annule.id].sort(), `${quoi} : en cours et annulé, au périmètre du journal`);
        assert.deepEqual(lu.apresIdentifiant, { enCours: donnees.enCours.id, annule: donnees.annule.id }, `${quoi} : fiche du journal, en cours et annulée`);
        assert.deepEqual(lu.seul, [donnees.enCours.id], `${quoi} : liste, en cours seulement`);
      }
    });

    // Cadrage v2 : « le filtre seul : where: perimetreChantiers(req) ». Sans porteur, la liste est vide ; le témoin (même
    // requête, avec porteur) lit le chantier en cours. Lectures écartées : `{}` (le chantier en cours serait lu), `notIn: []`
    // (de même). Affaires annulées comprises, sans porteur : rien non plus (sous `{}`, les deux chantiers seraient lus).
    test('le filtre seul (liste des chantiers, statistiques) : sans session ni clé, aucun chantier, ni en cours ni annulé', async () => {
      for (const quoi of AVEC_PORTEUR) assert.deepEqual((await lecture(quoi)).seul, [donnees.enCours.id], `témoin ${quoi}`);
      const lu = await lecture('sansPorteur');
      assert.deepEqual(lu.seul, [], 'liste des chantiers sans porteur');
      assert.deepEqual(lu.seulAnnulesCompris, [], 'périmètre du journal sans porteur, sans identifiant');
    });

    // Cadrage v2 : « le filtre après l'identifiant, comme pour le journal : { id, ...perimetreChantiersAnnulesCompris(req) } ».
    // Le filtre fermé, écrit après, remplace l'identifiant de l'appelant : findFirst nul pour le chantier en cours comme pour
    // l'annulé. Lecture écartée : `{}`, sous lequel la fiche du journal de chacun serait trouvée.
    test('le filtre après l’identifiant (journal d’audit du chantier) : sans session ni clé, ni le chantier en cours ni le chantier annulé ne sont trouvés', async () => {
      for (const quoi of AVEC_PORTEUR) assert.deepEqual((await lecture(quoi)).apresIdentifiant, { enCours: donnees.enCours.id, annule: donnees.annule.id }, `témoin ${quoi}`);
      assert.deepEqual((await lecture('sansPorteur')).apresIdentifiant, { enCours: null, annule: null });
    });

    // Cadrage v2 : « le filtre après le client : { clientId, ...perimetreChantiers(req) } » (historique des chantiers d'un client).
    test('le filtre après le client (chantiers d’une fiche client) : sans session ni clé, aucun chantier du client', async () => {
      for (const quoi of AVEC_PORTEUR) assert.deepEqual((await lecture(quoi)).apresClient, [donnees.enCours.id], `témoin ${quoi}`);
      assert.deepEqual((await lecture('sansPorteur')).apresClient, []);
    });

    // Cadrage v2 : « le filtre imbriqué : { chantier: perimetreChantiers(req) } sur achatReel et pointageHeure ».
    test('le filtre imbriqué (achats et heures) : sans session ni clé, aucun achat ni aucun pointage, alors que les deux chantiers en portent', async () => {
      for (const quoi of AVEC_PORTEUR) {
        const lu = await lecture(quoi);
        assert.deepEqual(lu.achats, [donnees.achatEnCours.id], `témoin ${quoi}, achats`);
        assert.deepEqual(lu.heures, [donnees.pointageEnCours.id], `témoin ${quoi}, heures`);
      }
      const lu = await lecture('sansPorteur');
      assert.deepEqual(lu.achats, [], 'achats sans porteur');
      assert.deepEqual(lu.heures, [], 'heures sans porteur');
    });

    // Cadrage v2 : « le filtre imbriqué par is : { chantier: { is: perimetreChantiers(req) } } sur planningEvent ».
    test('le filtre imbriqué par « is » (affectations du planning) : sans session ni clé, aucune affectation', async () => {
      for (const quoi of AVEC_PORTEUR) assert.deepEqual((await lecture(quoi)).planning, [donnees.affectationEnCours.id], `témoin ${quoi}`);
      assert.deepEqual((await lecture('sansPorteur')).planning, []);
    });
  });
}
