// Lot AE (#672, suivi de N5 du contrôle de cohérence de mode 1 du lot AA, #673) : règles de droits qui se ferment sans porteur.
// Cadrage v2 du lot AE, après le contrôle de cohérence de mode 1 sur c4420ff (« Cadrage v2 », point 5 du rapport, C3), qui
// fait foi. Règle 2 de la méthode : droits et périmètres, prouvés sur le code compilé et sur PostgreSQL jetable.
//
// Ce que le lot change (micro-arbitrage de droits, règle 5 : l'option la plus restrictive et la plus simple, choix par défaut,
// à confirmer ; cas inatteignable aujourd'hui, toute route de session commençant par requireAuth) :
//  - les six gardes de type de compte (blockCommercial, blockCommercialEtAssimiles par délégation à blockCommercial,
//    blockTechnicien et refuserTechnicien ; blockCommercialSeulement et refuserAssistanteTechniqueStatut, non exportées, sur
//    PATCH /api/chantiers/:id/statut) refusent une requête sans compte connecté comme requireAuth sans en-tête : 401
//    « Authentification requise » (refuseSansCompte), une clé seule comprise, au lieu de la laisser passer ;
//  - voitMontantsChantier est fausse sans session ni clé (aucun montant), au lieu de vraie ; saisieSelonDroits en hérite ;
//  - clientsActifsSeulement, désormais exportée, est vraie sans session ni clé (clients actifs seulement), au lieu de fausse.
// Aucun comportement ne change pour un compte ni pour une clé (matrices de droits inchangées).
//
// Pourquoi pas un test d'API : requireAuth répond 401 avant chacune de ces règles (lignes ANONYME de
// matrice-droits/entrees.txt). On joue donc le code compilé (dist), comme perimetre-sans-porteur.test.mjs (lot AA).
//
// Deux parties :
//  1. sans base : les six gardes relevées par leur nom dans app.router.stack de dist/index.js (procédé de scripts/routes.mjs
//     et des matrices ; l'import n'ouvre ni port ni base) et jouées chacune seule, sans porteur (trois écritures), avec une clé
//     seule et avec chacun des onze types de compte ; voitMontantsChantier, saisieSelonDroits (dist/src/droits/visibilite.js)
//     et clientsActifsSeulement (dist/src/domaines/clients/routes.js), sous les mêmes cas ;
//  2. PostgreSQL (base jetable propre au fichier) : les vrais gestionnaires des lectures de clients (liste, fiche, historique
//     des chantiers), relevés dans app.router.stack, montés derrière trois portes : sans garde (la route « montée un jour sans
//     garde »), le vrai requireAuth et le vrai requireApiKey('clients:read'). Sur un client désactivé, sans porteur : absent de
//     la liste, 404 sur la fiche et sur l'historique ; témoins : l'administrateur et la clé le lisent, le technicien reçoit 404.
//     Pas de preuve PostgreSQL pour voitMontantsChantier (aucune route discriminante, N5 du contrôle).
//     Sans TEST_DATABASE_URL, cette partie s'annonce ignorée : un SKIP n'est pas une réussite.
//
// Mutants que ce fichier tue (joués sur une copie de dist, hors du dépôt) :
//  - voitMontantsChantier : V1 retour à `user?.role !== TECHNICIEN` ; V2 branche de la clé retirée ; V3 compte testé avant la
//    clé ; V4 `user === undefined` au lieu de `!user` (une requête à `user: null` lèverait une erreur) ;
//  - saisieSelonDroits : S1 sans porteur, `sansTauxHoraire` (le montant HT resterait) ;
//  - clientsActifsSeulement : C1 retour à `!apiKey && user?.role === TECHNICIEN` ; C2 branche de la clé retirée ; C3 compte
//    testé avant la clé ; C4 `user === undefined` au lieu de `!user` ;
//  - gardes : G1 à G6 contrôle sans porteur retiré dans chaque garde ; G7 403, ou un autre message ; G8 refus d'un compte
//    admis ; G9 clé exemptée ; G10 blockCommercialEtAssimiles cesse de déléguer à blockCommercial.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { TYPES_DE_COMPTE as TYPES_DE_LA_MATRICE } from './matrice-droits/comptes.mjs';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Base jetable de la partie 2 : « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
// L'application compilée est importée dès la partie 1 (relevé des gardes), et db.js lit DATABASE_URL en se chargeant : la
// variable est donc posée ici, avant tout import de dist, vers la base que la partie 2 créera puis supprimera. La partie 1
// n'ouvre aucune connexion. Le secret des sessions est posé de même (auth.js le lit en se chargeant).
const nomBase = `iris_test_droits_sans_porteur_${randomBytes(6).toString('hex')}`;
let urlBase = null;
if (TEST_DATABASE_URL) {
  const cible = new URL(TEST_DATABASE_URL);
  cible.pathname = `/${nomBase}`;
  urlBase = cible.toString();
  process.env.DATABASE_URL = urlBase;
}
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secret-de-test-uniquement';

// Les modules compilés sont CommonJS : leurs exports nommés se lisent directement, ou par `default` (même lecture que
// perimetre-sans-porteur.test.mjs).
const exportDe = (module, nom) => module[nom] ?? module.default?.[nom];

// Les onze types de compte, repris de la table des matrices de droits (une seule source).
const TYPES_DE_COMPTE = TYPES_DE_LA_MATRICE.map((type) => type.role);

// Requêtes simulées : les règles ne lisent que `req.user` (posé par requireAuth) et `req.apiKey` (posé par requireApiKey).
// Trois écritures d'une requête sans porteur : rien de posé, des champs undefined, des champs null.
const SANS_PORTEUR = [
  ['rien de posé', () => ({})],
  ['champs undefined', () => ({ user: undefined, apiKey: undefined })],
  ['champs null', () => ({ user: null, apiKey: null })],
];
const compte = (role) => ({ user: { id: `compte-${role.toLowerCase()}`, name: `TEST ${role}`, role, accesFinance: false, permissions: [], equipeIds: [] } });
const cleSeule = () => ({ apiKey: { id: 'cle-lot-ae', nom: 'TEST clé lot AE', scopes: ['chantiers:read', 'clients:read'] } });

// Une garde jouée seule, avec une réponse qui consigne chaque appel, dans l'ordre, et un `next` qui se compte.
const jouer = async (garde, req) => {
  const appels = [];
  const res = {
    status(code) { appels.push(['status', code]); return res; },
    json(corps) { appels.push(['json', corps]); return res; },
  };
  await garde(req, res, (...args) => { appels.push(['next', ...args]); });
  return appels;
};
const PASSE = [['next']];
const refus403 = (message) => [['status', 403], ['json', { error: message }]];

// Les six gardes et leurs refus par type de compte, inchangés par le lot (matrice-droits/entrees.txt) :
//  - blockCommercial et blockCommercialSeulement : le commercial (décision de Nelson du 24-10-2026, point 14) ;
//  - blockCommercialEtAssimiles : le commercial, le directeur commercial, l'assistante commerciale et le comptable, chacun
//    nommé dans le message (décision 11 de la proposition de droits, #179) ;
//  - blockTechnicien (lot pilote 3) et refuserTechnicien (envoi du compte rendu, lot 6a-4d) : le technicien ;
//  - refuserAssistanteTechniqueStatut : l'assistante technique (clôturer ou rouvrir une affaire, lot « Assistante technique »).
// Les autres types passent.
const MESSAGE_COMMERCIAL = 'Accès non autorisé pour un compte commercial.';
const GARDES = {
  blockCommercial: { COMMERCIAL: MESSAGE_COMMERCIAL },
  blockCommercialEtAssimiles: {
    COMMERCIAL: MESSAGE_COMMERCIAL,
    DIRECTEUR_COMMERCIAL: 'Accès non autorisé pour un compte directeur commercial.',
    ASSISTANTE_COMMERCIALE: 'Accès non autorisé pour un compte assistante commerciale.',
    COMPTABLE: 'Accès non autorisé pour un compte comptable.',
  },
  blockTechnicien: { TECHNICIEN: 'Un technicien ne modifie ni le planning ni les référentiels.' },
  refuserTechnicien: { TECHNICIEN: 'L’envoi du compte rendu n’est pas ouvert au technicien.' },
  blockCommercialSeulement: { COMMERCIAL: MESSAGE_COMMERCIAL },
  refuserAssistanteTechniqueStatut: { ASSISTANTE_TECHNIQUE: 'Un compte assistante technique n’est pas autorisé à clôturer ni à rouvrir une affaire.' },
};
const NOMS_GARDES = Object.keys(GARDES);

// Réponse du vrai requireAuth sans en-tête, écrite en toutes lettres : le témoin vérifie que c'est bien la sienne.
const REFUS_AUTHENTIFICATION = [['status', 401], ['json', { error: 'Authentification requise' }]];

describe('Lot AE (#672) : gardes de type de compte sans porteur — relevées dans l’application compilée, sans base', () => {
  let requireAuth; let app;
  const gardes = new Map();
  const routesGardees = [];

  before(async () => {
    const serveur = await import('../dist/index.js');
    app = exportDe(serveur, 'app');
    requireAuth = exportDe(await import('../dist/src/http/auth.js'), 'requireAuth');
    assert.equal(typeof requireAuth, 'function');
    assert.ok(Array.isArray(app?.router?.stack), 'app.router.stack introuvable : recompiler le serveur (npm run build)');
    // Relevé des gardes par leur nom dans la pile de chaque route, comme scripts/routes.mjs.
    for (const couche of app.router.stack) {
      if (!couche.route) continue;
      const pile = couche.route.stack;
      const portees = pile.filter((maillon) => NOMS_GARDES.includes(maillon.name));
      if (!portees.length) continue;
      routesGardees.push({ chemin: couche.route.path, methodes: Object.keys(couche.route.methods), pile });
      for (const maillon of portees) {
        const deja = gardes.get(maillon.name);
        assert.ok(!deja || deja === maillon.handle, `${maillon.name} : deux fonctions distinctes sous le même nom`);
        gardes.set(maillon.name, maillon.handle);
      }
    }
  });

  // Cadrage v2 (C3, partie 1) : « relève les six fonctions par leur nom dans app.router.stack ». Témoin du relevé et de la
  // référence : chaque garde est trouvée, une seule fonction par nom ; le vrai requireAuth, appelé sans en-tête, répond 401
  // « Authentification requise » sans passer la main (c'est la réponse que les gardes doivent reproduire).
  test('témoin : les six gardes de type de compte sont relevées par leur nom dans les routes de l’application compilée, et le vrai requireAuth sans en-tête répond 401 « Authentification requise »', async () => {
    for (const nom of NOMS_GARDES) assert.equal(typeof gardes.get(nom), 'function', `${nom} absente des routes de l’application`);
    assert.deepEqual(await jouer(requireAuth, { headers: {} }), REFUS_AUTHENTIFICATION);
  });

  // Cadrage : « Cas inatteignable aujourd'hui » ; « Aucun comportement ne change pour un compte ni pour une clé ». Chaque route
  // qui porte une de ces gardes commence par le vrai requireAuth, et aucune n'est une porte /api/v1 de clé : le refus sans
  // porteur ne peut pas se produire aujourd'hui, et une clé ne rencontre jamais ces gardes.
  test('aujourd’hui, le refus sans porteur est inatteignable : chaque route qui porte une de ces gardes commence par le vrai requireAuth, et aucune n’est une route /api/v1', () => {
    assert.ok(routesGardees.length > 0);
    for (const { chemin, methodes, pile } of routesGardees) {
      const route = `${methodes.join(',').toUpperCase()} ${chemin}`;
      assert.equal(pile[0].handle, requireAuth, `${route} : requireAuth en tête`);
      assert.ok(!chemin.startsWith('/api/v1'), `${route} : porte de clé`);
    }
  });

  // Cadrage v2 (C3) : « sans porteur (trois écritures) […], 401 avec un corps égal (deepEqual) à celui du vrai requireAuth
  // appelé sans en-tête, next non appelé ». Lectures écartées : la garde qui laisse passer (la règle de c4420ff, mutants G1 à
  // G6 et G10), un 403 ou un autre message (G7).
  test('sans session ni clé, sous trois écritures, chaque garde jouée seule répond comme requireAuth sans en-tête : 401 « Authentification requise », corps identique, sans passer la main', async () => {
    const reference = await jouer(requireAuth, { headers: {} });
    for (const nom of NOMS_GARDES) {
      for (const [quoi, req] of SANS_PORTEUR) {
        assert.deepEqual(await jouer(gardes.get(nom), req()), reference, `${nom}, ${quoi}`);
      }
    }
  });

  // Cadrage v2 : « une fonction commune refuseSansCompte (401 « Authentification requise », clé seule comprise) ». Une clé
  // d'intégration, sans compte, n'a rien à faire sur ces routes de session : elle est refusée comme une requête anonyme.
  // Lecture écartée : la clé exemptée du refus (G9), qui la laisserait passer.
  test('une clé d’intégration seule, sans compte, est refusée par chaque garde comme sans porteur : 401 de requireAuth, la clé n’en est pas exemptée', async () => {
    const reference = await jouer(requireAuth, { headers: {} });
    for (const nom of NOMS_GARDES) assert.deepEqual(await jouer(gardes.get(nom), cleSeule()), reference, nom);
  });

  // Cadrage : « Aucun comportement ne change pour un compte » ; contrôle (C3) : « les 11 types de compte, verdict inchangé ».
  // Lectures écartées : le refus d'un compte admis (G8), un compte refusé qui passerait, un message changé, et, pour
  // blockCommercialEtAssimiles, la perte du refus du commercial s'il cessait de déléguer à blockCommercial sans le reprendre.
  test('les onze types de compte gardent le verdict de chaque garde : commercial refusé par blockCommercial et blockCommercialSeulement ; commercial, directeur commercial, assistante commerciale et comptable par blockCommercialEtAssimiles, chacun nommé ; technicien par blockTechnicien et refuserTechnicien ; assistante technique par refuserAssistanteTechniqueStatut ; les autres passent', async () => {
    assert.equal(TYPES_DE_COMPTE.length, 11);
    for (const [nom, refus] of Object.entries(GARDES)) {
      for (const role of TYPES_DE_COMPTE) {
        const attendu = refus[role] ? refus403(refus[role]) : PASSE;
        assert.deepEqual(await jouer(gardes.get(nom), compte(role)), attendu, `${nom}, ${role}`);
      }
    }
  });

  // La même preuve par HTTP réel : chaque garde seule, montée dans une application Express derrière un intercalaire qui pose
  // (ou non) `req.user` et `req.apiKey`, rend exactement la réponse du vrai requireAuth sans en-tête monté sur la même
  // application : même statut, même type de contenu, même corps ; le gestionnaire final n'est jamais atteint.
  test('par HTTP, dans une application Express réelle, chaque garde seule rend sans porteur, et avec une clé seule, la réponse de requireAuth sans en-tête : même statut, même type de contenu, même corps, sans atteindre la route', async () => {
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    const cas = [...SANS_PORTEUR, ['clé seule', cleSeule]];
    const appli = express();
    let atteinte = 0;
    const fin = (_req, res) => { atteinte += 1; res.json({ passe: true }); };
    appli.get('/reference', requireAuth, fin);
    for (const nom of NOMS_GARDES) {
      cas.forEach(([, req], i) => {
        const poser = (requete, _res, next) => { Object.assign(requete, req()); next(); };
        appli.get(`/${nom}/${i}`, poser, gardes.get(nom), fin);
      });
    }
    const reference = await request(appli).get('/reference');
    assert.equal(reference.status, 401);
    assert.deepEqual(reference.body, { error: 'Authentification requise' });
    for (const nom of NOMS_GARDES) {
      for (const [i, [quoi]] of cas.entries()) {
        const res = await request(appli).get(`/${nom}/${i}`);
        assert.equal(res.status, reference.status, `${nom}, ${quoi} : statut`);
        assert.equal(res.headers['content-type'], reference.headers['content-type'], `${nom}, ${quoi} : type de contenu`);
        assert.deepEqual(res.body, reference.body, `${nom}, ${quoi} : corps`);
      }
    }
    assert.equal(atteinte, 0, 'aucune requête n’atteint la route');
  });
});

describe('Lot AE (#672) : montants d’un chantier et clients désactivés sans porteur — fonctions de visibilité, sans base', () => {
  let voitMontantsChantier; let saisieSelonDroits; let sansMontantsSaisie; let sansTauxHoraire; let clientsActifsSeulement;

  before(async () => {
    const visibilite = await import('../dist/src/droits/visibilite.js');
    voitMontantsChantier = exportDe(visibilite, 'voitMontantsChantier');
    saisieSelonDroits = exportDe(visibilite, 'saisieSelonDroits');
    sansMontantsSaisie = exportDe(visibilite, 'sansMontantsSaisie');
    sansTauxHoraire = exportDe(visibilite, 'sansTauxHoraire');
    clientsActifsSeulement = exportDe(await import('../dist/src/domaines/clients/routes.js'), 'clientsActifsSeulement');
    for (const [nom, fonction] of Object.entries({ voitMontantsChantier, saisieSelonDroits, sansMontantsSaisie, sansTauxHoraire })) {
      assert.equal(typeof fonction, 'function', `${nom} absente de dist/src/droits/visibilite.js`);
    }
  });

  // Une saisie aux valeurs toutes distinctes : chaque clé retirée ou gardée se voit seule.
  const saisie = () => ({
    id: 'saisie-lot-ae', date: '2026-10-05', nbrHeures: '3.25', description: 'TEST saisie lot AE',
    montantHT: '123.45', tauxHoraireApplique: '37.85', tauxHoraireCharge: '40.10', prixVenteHoraireApplique: '55.20',
    intervenant: { id: 'intervenant-lot-ae', nom: 'TEST Intervenant lot AE', tauxHoraireCharge: '41.30' },
  });
  // Ce que garde chaque masquage (sansMontantsSaisie : ni montant HT ni taux, intervenant compris ; sansTauxHoraire : le
  // montant HT, sans aucun taux).
  const SANS_MONTANT_NI_TAUX = { id: 'saisie-lot-ae', date: '2026-10-05', nbrHeures: '3.25', description: 'TEST saisie lot AE', intervenant: { id: 'intervenant-lot-ae', nom: 'TEST Intervenant lot AE' } };
  const SANS_TAUX = { ...SANS_MONTANT_NI_TAUX, montantHT: '123.45' };

  // Cadrage v2 : « voitMontantsChantier (clé vrai ; sans compte faux) ». Contrôle (C3) : « sans porteur sous trois écritures
  // ({}, champs undefined, champs null) faux ». Lectures écartées : vrai (la règle de c4420ff, `user?.role !== TECHNICIEN`,
  // V1) ; une erreur sur `user: null` (V4, `user === undefined`).
  test('sans session ni clé, voitMontantsChantier est fausse sous les trois écritures : aucun montant de chantier', () => {
    for (const [quoi, req] of SANS_PORTEUR) assert.equal(voitMontantsChantier(req()), false, quoi);
  });

  // Comportement inchangé pour une clé (scope chantiers:read) : elle voit les montants, sans compte. Lectures écartées : la
  // branche de la clé retirée (V2) et le compte testé avant la clé (V3), sous lesquels une clé sans compte ne verrait rien.
  test('une clé d’intégration, sans compte, voit les montants du chantier', () => {
    assert.equal(voitMontantsChantier(cleSeule()), true);
  });

  // Comportement inchangé pour les onze types de compte (décisions de Nelson du 13-10-2026) : le technicien seul ne voit pas
  // les montants d'un chantier.
  test('les onze types de compte gardent leur visibilité des montants : seul le technicien ne les voit pas', () => {
    for (const role of TYPES_DE_COMPTE) assert.equal(voitMontantsChantier(compte(role)), role !== 'TECHNICIEN', role);
  });

  // Contrôle (C3) : « la saisie perd montantHT et les taux ». Sans porteur, saisieSelonDroits rend sansMontantsSaisie, comme
  // pour le technicien. Lecture écartée (S1) : sansTauxHoraire, sous lequel le montant HT de 123,45 resterait visible.
  test('sans session ni clé, une saisie perd son montant HT et tous ses taux, intervenant compris, et non les seuls taux', () => {
    for (const [quoi, req] of SANS_PORTEUR) {
      const masque = saisieSelonDroits(req());
      assert.equal(masque, sansMontantsSaisie, `${quoi} : masquage du technicien`);
      const valeur = saisie();
      assert.deepEqual(masque(valeur), SANS_MONTANT_NI_TAUX, quoi);
      assert.deepEqual(valeur, saisie(), `${quoi} : la saisie d’origine n’est pas modifiée`);
    }
  });

  // Comportement inchangé pour une clé et pour chaque type de compte : la clé et l'administration (super administrateur,
  // administrateur, directeur) reçoivent la saisie entière ; le technicien perd montant et taux ; les autres perdent les seuls
  // taux (décisions de Nelson du 13-10-2026, précisée le 16-10-2026).
  test('une clé et l’administration reçoivent la saisie entière ; le technicien perd montant et taux ; les autres types de compte perdent les seuls taux', () => {
    assert.deepEqual(saisieSelonDroits(cleSeule())(saisie()), saisie(), 'clé');
    for (const role of TYPES_DE_COMPTE) {
      const masque = saisieSelonDroits(compte(role));
      if (role === 'TECHNICIEN') {
        assert.equal(masque, sansMontantsSaisie, role);
        assert.deepEqual(masque(saisie()), SANS_MONTANT_NI_TAUX, role);
      } else if (['SUPERADMIN', 'ADMIN', 'DIRECTEUR'].includes(role)) {
        assert.deepEqual(masque(saisie()), saisie(), role);
      } else {
        assert.equal(masque, sansTauxHoraire, role);
        assert.deepEqual(masque(saisie()), SANS_TAUX, role);
      }
    }
  });

  // Cadrage v2 : « clientsActifsSeulement exportée (clé faux ; sans compte vrai) ». Lectures écartées : faux (la règle de
  // c4420ff, `!apiKey && user?.role === TECHNICIEN`, C1), qui laisserait lire les clients désactivés ; une erreur sur
  // `user: null` (C4, `user === undefined`).
  test('sans session ni clé, clientsActifsSeulement est vraie sous les trois écritures : clients actifs seulement', () => {
    assert.equal(typeof clientsActifsSeulement, 'function', 'clientsActifsSeulement non exportée de dist/src/domaines/clients/routes.js');
    for (const [quoi, req] of SANS_PORTEUR) assert.equal(clientsActifsSeulement(req()), true, quoi);
  });

  // Comportement inchangé pour une clé : elle lit les clients désactivés, sans compte. Lectures écartées : la branche de la clé
  // retirée (C2) et le compte testé avant la clé (C3), sous lesquels une clé sans compte serait limitée aux clients actifs.
  test('une clé d’intégration, sans compte, lit les clients désactivés', () => {
    assert.equal(typeof clientsActifsSeulement, 'function', 'clientsActifsSeulement non exportée de dist/src/domaines/clients/routes.js');
    assert.equal(clientsActifsSeulement(cleSeule()), false);
  });

  // Comportement inchangé pour les onze types de compte (décision de Nelson du 14-10-2026) : seul le technicien est limité aux
  // clients actifs.
  test('les onze types de compte gardent leur accès aux clients désactivés : seul le technicien est limité aux clients actifs', () => {
    assert.equal(typeof clientsActifsSeulement, 'function', 'clientsActifsSeulement non exportée de dist/src/domaines/clients/routes.js');
    for (const role of TYPES_DE_COMPTE) assert.equal(clientsActifsSeulement(compte(role)), role === 'TECHNICIEN', role);
  });
});

const TITRE_BASE = 'Lot AE (#672) : lectures de clients sans porteur — vrais gestionnaires derrière trois portes, sur PostgreSQL';

if (!TEST_DATABASE_URL) {
  describe(TITRE_BASE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE_BASE, () => {
    const source = new URL(TEST_DATABASE_URL);
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;
    let request; let prisma; let prismaApplication; let app;
    const donnees = {};
    const porteurs = {};
    const suffixe = randomBytes(4).toString('hex');
    // Porteur vu par la porte, relevé juste avant le gestionnaire.
    let vu = null;

    before(async () => {
      assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname), 'seul un PostgreSQL local est autorisé');
      assert.notEqual(source.pathname.slice(1), nomBase);
      assert.equal(process.env.DATABASE_URL, urlBase, 'DATABASE_URL de l’application : la base jetable du fichier');
      await administrationPg.connect();
      await administrationPg.query(`CREATE DATABASE "${nomBase}"`);
      baseCreee = true;
      execFileSync(resolve(dossierServeur, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', resolve(dossierServeur, 'prisma/schema.prisma')], {
        env: { ...process.env, DATABASE_URL: urlBase }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
      });
      request = (await import('supertest')).default;
      const jwt = (await import('jsonwebtoken')).default;
      const express = (await import('express')).default;
      const client = await import('@prisma/client');
      prisma = new client.PrismaClient({ datasources: { db: { url: urlBase } } });
      const serveur = await import('../dist/index.js');
      const appReelle = exportDe(serveur, 'app');
      prismaApplication = exportDe(await import('../dist/src/db.js'), 'prisma');
      const requireAuth = exportDe(await import('../dist/src/http/auth.js'), 'requireAuth');
      const clesApi = await import('../dist/src/http/cles-api.js');
      const requireApiKey = exportDe(clesApi, 'requireApiKey');
      const apiKeyHash = exportDe(clesApi, 'apiKeyHash');

      // --- Vrais gestionnaires, relevés dans les routes de l'application compilée : le dernier maillon de chaque route.
      const route = (methode, chemin) => {
        const couche = appReelle.router.stack.find((c) => c.route?.path === chemin && c.route.methods[methode]);
        assert.ok(couche, `${methode.toUpperCase()} ${chemin} absente de l’application`);
        return couche.route.stack;
      };
      const dernier = (pile) => pile[pile.length - 1].handle;
      const pileListe = route('get', '/api/clients');
      const pileFiche = route('get', '/api/clients/:id');
      const pileHistorique = route('get', '/api/clients/:id/chantiers');
      const lister = dernier(pileListe);
      const lire = dernier(pileFiche);
      const historique = dernier(pileHistorique);
      assert.equal(lister.name, 'listerClients');
      assert.equal(lire.name, 'lireClient');
      // La liste et la fiche sont montées sur les deux portes (routeMixte) : le même gestionnaire sert la clé sur /api/v1.
      assert.equal(dernier(route('get', '/api/v1/clients')), lister);
      assert.equal(dernier(route('get', '/api/v1/clients/:id')), lire);
      // Chacune commence par le vrai requireAuth dans l'application : c'est pourquoi le cas sans porteur y est inatteignable.
      for (const pile of [pileListe, pileFiche, pileHistorique]) assert.equal(pile[0].handle, requireAuth);
      assert.equal(typeof historique, 'function');

      // --- Données : un client actif et un client désactivé, chacun avec un chantier en cours.
      const admin = await prisma.user.create({ data: { email: `lot-ae.admin.${suffixe}@iris.test`, name: `TEST Administrateur lot AE ${suffixe}`, role: 'ADMIN' } });
      const technicien = await prisma.user.create({ data: { email: `lot-ae.technicien.${suffixe}@iris.test`, name: `TEST Technicien lot AE ${suffixe}`, role: 'TECHNICIEN' } });
      donnees.actif = await prisma.client.create({ data: { raisonSociale: `TEST Client actif lot AE ${suffixe}` } });
      donnees.desactive = await prisma.client.create({ data: { raisonSociale: `TEST Client désactivé lot AE ${suffixe}`, actif: false } });
      const chantier = (fiche, nom) => prisma.chantier.create({ data: {
        nom: `TEST Chantier lot AE ${nom} ${suffixe}`, client: fiche.raisonSociale, clientId: fiche.id, dateDebut: new Date('2026-10-01T00:00:00Z'),
        budgetGlobalVendu: '1000', responsableId: admin.id,
      } });
      donnees.chantierActif = await chantier(donnees.actif, 'client actif');
      donnees.chantierDesactive = await chantier(donnees.desactive, 'client désactivé');

      // --- Porteurs réels : un jeton de session (administrateur, technicien), une clé `clients:read`.
      const secret = `iris_${randomBytes(32).toString('hex')}`;
      await prisma.apiAccessKey.create({ data: { nom: `TEST clé lot AE ${suffixe}`, prefixe: secret.slice(0, 13), secretHash: apiKeyHash(secret), scopes: ['clients:read'], creeParId: admin.id } });
      porteurs.cle = { Authorization: `Bearer ${secret}` };
      porteurs.administrateur = { Authorization: `Bearer ${jwt.sign({ id: admin.id }, process.env.JWT_SECRET)}` };
      porteurs.technicien = { Authorization: `Bearer ${jwt.sign({ id: technicien.id }, process.env.JWT_SECRET)}` };

      // --- Application de test : les trois gestionnaires réels derrière chaque porte (sans garde, session, clé).
      const noter = (req, _res, next) => { vu = { session: Boolean(req.user), cle: Boolean(req.apiKey) }; next(); };
      app = express();
      for (const [porte, gardes] of [['sans-garde', []], ['session', [requireAuth]], ['cle', [requireApiKey('clients:read')]]]) {
        app.get(`/${porte}/clients`, ...gardes, noter, lister);
        app.get(`/${porte}/clients/:id`, ...gardes, noter, lire);
        app.get(`/${porte}/clients/:id/chantiers`, ...gardes, noter, historique);
      }
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

    // Appel par une porte ; vérifie la nature du porteur que la porte a laissé passer.
    const PORTES = {
      cle: ['cle', 'cle', { session: false, cle: true }],
      administrateur: ['session', 'administrateur', { session: true, cle: false }],
      technicien: ['session', 'technicien', { session: true, cle: false }],
      sansPorteur: ['sans-garde', null, { session: false, cle: false }],
    };
    const appeler = async (quoi, chemin) => {
      const [porte, porteur, attendu] = PORTES[quoi];
      vu = null;
      const requete = request(app).get(`/${porte}${chemin}`);
      if (porteur) requete.set(porteurs[porteur]);
      const res = await requete;
      assert.deepEqual(vu, attendu, `${quoi} ${chemin} : porteur vu par la porte (${res.status} ${JSON.stringify(res.body)})`);
      return res;
    };
    const idsDeLaListe = (res) => {
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.body.clients.map((fiche) => fiche.id).filter((id) => [donnees.actif.id, donnees.desactive.id].includes(id)).sort();
    };
    // État des deux fiches en base : une lecture n'écrit rien.
    const etatFiches = async () => prisma.client.findMany({ where: { id: { in: [donnees.actif.id, donnees.desactive.id] } }, orderBy: { id: 'asc' }, select: { id: true, actif: true, updatedAt: true } });
    const INTROUVABLE = { error: 'Client introuvable.' };

    // Contrôle (C3, partie 2) : « témoins : l'administrateur et la clé le lisent ». Le client désactivé est bien en base,
    // désactivé ; l'administrateur (vrai requireAuth) et la clé `clients:read` (vrai requireApiKey) le lisent en liste
    // (`?actif=false`), en fiche et dans son historique de chantiers (comportement inchangé).
    test('témoin : l’administrateur et une clé clients:read, passés par leur garde réelle, lisent le client désactivé en liste, en fiche et dans l’historique de ses chantiers', async () => {
      assert.deepEqual(Object.fromEntries((await etatFiches()).map((f) => [f.id, f.actif])), { [donnees.actif.id]: true, [donnees.desactive.id]: false });
      for (const quoi of ['administrateur', 'cle']) {
        assert.deepEqual(idsDeLaListe(await appeler(quoi, '/clients?actif=false')), [donnees.desactive.id], `${quoi} : liste des désactivés`);
        const fiche = await appeler(quoi, `/clients/${donnees.desactive.id}`);
        assert.equal(fiche.status, 200, `${quoi} : fiche`);
        assert.equal(fiche.body.id, donnees.desactive.id);
        assert.equal(fiche.body.actif, false);
        const historique = await appeler(quoi, `/clients/${donnees.desactive.id}/chantiers`);
        assert.equal(historique.status, 200, `${quoi} : historique`);
        assert.deepEqual(historique.body.map((c) => c.id), [donnees.chantierDesactive.id], `${quoi} : historique`);
      }
    });

    // Contrôle (C3, partie 2) : « le technicien reçoit 404 » (décision de Nelson du 14-10-2026, inchangée) : la liste des
    // désactivés lui rend les seuls clients actifs ; la fiche et l'historique du client désactivé, 404 « Client introuvable. ».
    test('témoin : le technicien, passé par le vrai requireAuth, ne lit pas le client désactivé : absent de la liste, 404 sur la fiche et sur l’historique', async () => {
      const avant = await etatFiches();
      assert.deepEqual(idsDeLaListe(await appeler('technicien', '/clients?actif=false')), [donnees.actif.id]);
      for (const chemin of [`/clients/${donnees.desactive.id}`, `/clients/${donnees.desactive.id}/chantiers`]) {
        const res = await appeler('technicien', chemin);
        assert.equal(res.status, 404, chemin);
        assert.deepEqual(res.body, INTROUVABLE, chemin);
      }
      assert.deepEqual(await etatFiches(), avant, 'rien n’est écrit');
    });

    // Cadrage v2 : « clientsActifsSeulement (sans compte vrai) » ; contrôle : « absent de la liste ». Sans porteur, `?actif=false`
    // ne rend que les clients actifs. Lecture écartée : la règle de c4420ff (fausse sans porteur), sous laquelle la liste
    // rendrait le client désactivé, et non l'actif ; et une liste vide (la règle ferme aux clients actifs, pas à tout).
    test('sans session ni clé, la liste des clients désactivés ne rend que les clients actifs : le client désactivé en est absent', async () => {
      const avant = await etatFiches();
      assert.deepEqual(idsDeLaListe(await appeler('sansPorteur', '/clients?actif=false')), [donnees.actif.id]);
      assert.deepEqual(await etatFiches(), avant, 'rien n’est écrit');
    });

    // Contrôle : « 404 sur la fiche ». Sans porteur, la fiche du client désactivé répond 404 « Client introuvable. », comme au
    // technicien ; celle du client actif reste lisible (clients actifs seulement, et non « aucun client »). Lecture écartée : la
    // règle de c4420ff, sous laquelle la fiche désactivée répondrait 200.
    test('sans session ni clé, la fiche du client désactivé répond 404 « Client introuvable. », celle du client actif reste lisible', async () => {
      const avant = await etatFiches();
      const refus = await appeler('sansPorteur', `/clients/${donnees.desactive.id}`);
      assert.equal(refus.status, 404);
      assert.deepEqual(refus.body, INTROUVABLE);
      const actif = await appeler('sansPorteur', `/clients/${donnees.actif.id}`);
      assert.equal(actif.status, 200);
      assert.equal(actif.body.id, donnees.actif.id);
      assert.deepEqual(await etatFiches(), avant, 'rien n’est écrit');
    });

    // Contrôle : « 404 sur l'historique ». Sans porteur, l'historique des chantiers du client désactivé répond 404 ; celui du
    // client actif répond 200, vide (le périmètre des chantiers est fermé sans porteur depuis le lot AA, #673). Lecture
    // écartée : la règle de c4420ff, sous laquelle l'historique désactivé répondrait 200.
    test('sans session ni clé, l’historique des chantiers du client désactivé répond 404 « Client introuvable. » ; celui du client actif répond, sans aucun chantier', async () => {
      const avant = await etatFiches();
      const refus = await appeler('sansPorteur', `/clients/${donnees.desactive.id}/chantiers`);
      assert.equal(refus.status, 404);
      assert.deepEqual(refus.body, INTROUVABLE);
      const actif = await appeler('sansPorteur', `/clients/${donnees.actif.id}/chantiers`);
      assert.equal(actif.status, 200);
      assert.deepEqual(actif.body, []);
      assert.deepEqual(await etatFiches(), avant, 'rien n’est écrit');
    });
  });
}
