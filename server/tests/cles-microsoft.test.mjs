// Lot #589, « clés Microsoft relues au plus une fois par minute » (cadrage v1, complété des v2 et v3 du
// controleur-coherence, `main` à 890d384 ; issue `suivi-audit` #589, note N4 du contrôle de cohérence du cadrage de
// #563 ; messages de Nelson des 16, 17 et 18-11-2026, « continu avec les issu. », « Ok continu », « Reprend […] »).
// Parcours de sécurité de la connexion (règle 2 de la méthode).
//
// Avant ce lot, un jeton dont le `kid` manquait au cache des clés de signature Microsoft (JWKS) faisait relire
// MS_JWKS_URI à chaque fois, sans limite ; une lecture en échec ne notait rien ; des demandes simultanées lançaient
// chacune la leur ; un cache expiré avec un `kid` inconnu faisait deux lectures dans la même requête (N10). Un client
// non authentifié faisait donc lancer au serveur autant d'appels sortants qu'il envoyait de jetons forgés à
// POST /api/auth/sso. Le cadrage fixe :
//   - toute lecture note l'instant de sa tentative, réussie ou non ; un `kid` inconnu ne relance une lecture que si la
//     dernière tentative date de plus de 60 secondes, sinon le jeton est refusé sans appel sortant (point 1) ;
//   - la dernière tentative vaut « jamais » au départ (null), et non 0 (v2, N6 ; v3, N-a) ;
//   - une tentative datée dans le futur, après un recul de l'horloge, n'empêche pas la lecture (v2, C3) ;
//   - le cache expiré (une heure) suit la même borne ; une lecture en échec laisse une trace
//     `[SSO] Lecture des clés Microsoft impossible : <motif>.`, sans jeton ni identifiant (v2, N3) ; « échec » : statut
//     hors 2xx, exception (réseau, délai), JSON invalide, `keys` absent ou qui n'est pas un tableau (v2, N3) ;
//   - seul un cache encore valable (moins d'une heure) sert, avant comme après une tentative de lecture : en cas d'échec,
//     un cache encore valable laisse accepter un `kid` connu, un cache expiré ne sert plus, comme avant ce lot. Règle
//     retenue par Claude Code après l'audit des droits de #606 (N2 : option la plus restrictive, règle 5 de la méthode,
//     et comportement actuel, règle permanente 1), qui remplace le « cache précédent gardé, même expiré » du cadrage :
//     une clé retirée par Microsoft ne doit pas rester acceptée sans limite de durée tant que la relecture échoue ;
//   - des demandes simultanées partagent une seule lecture en cours ; une demande dont le `kid` est dans le cache frais
//     n'attend jamais une lecture en cours (point 1 ; v2, N4) ;
//   - une lecture dure au plus 10 s (`AbortSignal.timeout(10_000)`), et un dépassement compte comme une tentative en
//     échec (v2, point 4 ; v3, T1).
//   - la lecture en cours est effacée à la fin de sa promesse, même quand `fetch` lève sans rendre la main (audit des
//     droits de #606, N1) ;
//   - depuis le lot #607 et #608 (cadrage v2, N6 du contrôle de cohérence) : un cache n'est valable que si
//     `0 <= instant - fetchedAt < 1 h` ; daté dans le futur (horloge reculée depuis sa lecture), il est expiré et relu, la
//     borne des lectures laissant passer une tentative datée dans le futur ;
//   - depuis l'audit des droits de #612 (R1) : l'heure du cache se compte aussi sur l'horloge monotone du processus
//     (`performance.now()`, simulée à la main dans les trois tests qui la font avancer) ; un recul de l'horloge du système,
//     court ou long, ne fait servir aucun cache plus d'une heure de temps réel après sa lecture.
// Valeurs (60 s, 10 s) : choix par défaut, à confirmer.
//
// Tests sans base (v2, point 11) : `verifyMicrosoftIdentity(req)` ne lit que `req.body.idToken` et `req.ip`. Microsoft
// est simulé dans le processus, comme dans sso-identifiant.test.mjs : AZURE_TENANT_ID et AZURE_CLIENT_ID sont posés
// avant le chargement de sso.js (qui les lit à son chargement), `globalThis.fetch` est remplacé et compte les appels à
// la seule adresse des clés du locataire (toute autre adresse est relevée et refusée), et les jetons sont signés en
// RS256 par des clés tirées par ce fichier, avec l'audience et l'émetteur attendus. Un jeton « forgé » est signé par
// une autre clé, sous un `kid` encore jamais vu.
//
// Horloge : `mock.timers` sur `Date` seulement (Node 20.11 au moins) ; les minuteries restent réelles. Or `mock.timers`
// ne pilote pas `AbortSignal.timeout` (v3, T1) : il est remplacé, dans chaque test, par un signal piloté à la main, qui
// relève le délai demandé ; le test du délai abandonne lui-même la lecture suspendue, avec l'erreur `TimeoutError` que
// rendrait le signal du délai.
//
// Remise à zéro entre deux tests : le module compilé sso.js est rechargé avant chaque test (son entrée est retirée de
// `require.cache`). Son cache, sa dernière tentative et sa lecture en cours repartent ainsi de leur valeur initiale, sans
// export réservé aux tests ; les modules dont il dépend (base, journal) restent ceux du premier chargement. Le test HTTP,
// en fin de fichier, passe par l'application chargée au début du fichier : elle garde l'instance de sso.js chargée
// avec elle, que lui seul utilise. Une base injoignable lui est donnée : un 401 y prouve qu'aucune lecture ni écriture
// en base n'a été tentée (elle aurait répondu 500).
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import test, { afterEach, beforeEach, describe, mock } from 'node:test';
import { setTimeout as attendre } from 'node:timers/promises';
import { format } from 'node:util';
import jwt from 'jsonwebtoken';

// --- Microsoft simulé ---
const LOCATAIRE = '00000000-0000-4000-8000-0000000a5890';
const APPLICATION = '00000000-0000-4000-8000-0000000b5890';
const EMETTEUR = `https://login.microsoftonline.com/${LOCATAIRE}/v2.0`;
const ADRESSE_CLES = `https://login.microsoftonline.com/${LOCATAIRE}/discovery/v2.0/keys`;

// Posées avant le chargement de l'application et de sso.js : connexion Microsoft active, base injoignable, accès de
// secours inactif, aucun proxy de confiance. Posées même vides, elles ne sont pas remplacées par un server/.env du poste
// (dotenv ne remplace pas une variable déjà posée).
process.env.AZURE_TENANT_ID = LOCATAIRE;
process.env.AZURE_CLIENT_ID = APPLICATION;
process.env.DATABASE_URL = 'postgresql://iris:iris@127.0.0.1:1/iris_injoignable?schema=public&connect_timeout=5';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secret-de-test-cles-microsoft-589';
process.env.BREAK_GLASS_EMAIL = '';
process.env.BREAK_GLASS_TOKEN = '';
process.env.TRUST_PROXY = '';
process.env.SUPERADMIN_EMAILS = '';
delete process.env.MICROSOFT_GRAPH_URL;

const require = createRequire(import.meta.url);
const request = require('supertest');
const { app } = require('../dist/index.js');
const CHEMIN_SSO = require.resolve('../dist/src/domaines/authentification/sso.js');
// Nouvelle instance de sso.js : cache vide, dernière tentative « jamais », aucune lecture en cours.
const chargerSso = () => {
  delete require.cache[CHEMIN_SSO];
  return require(CHEMIN_SSO);
};

const KID_A = 'cle-589-a';
const KID_B = 'cle-589-b'; // clé publiée par Microsoft après coup (rotation)
const paireA = generateKeyPairSync('rsa', { modulusLength: 2048 });
const paireB = generateKeyPairSync('rsa', { modulusLength: 2048 });
const paireForge = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privee = (paire) => paire.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publique = (paire, kid) => ({ ...paire.publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' });
const CLE_A = privee(paireA);
const CLE_B = privee(paireB);
const CLE_FORGE = privee(paireForge);
const JWK_A = publique(paireA, KID_A);
const JWK_B = publique(paireB, KID_B);

const OID = '00000000-0000-4000-8000-00000000c589';
const ADRESSE = 'personne.589@iris.test';
const IP = '198.51.100.89';
const IDENTITE = { email: ADRESSE, oid: OID, tid: LOCATAIRE };
const REFUS_GENERIQUE = { code: 'SSO_TOKEN_INVALID', error: 'Jeton Microsoft invalide ou non vérifié.' };

// Jetons signés à l'instant simulé, valables dix minutes : chaque test les tire au moment de les présenter.
const signer = (cle, kid) => jwt.sign(
  { oid: OID, tid: LOCATAIRE, preferred_username: ADRESSE, email: ADRESSE, name: 'TEST Personne 589' },
  cle,
  { algorithm: 'RS256', keyid: kid, audience: APPLICATION, issuer: EMETTEUR, expiresIn: '10m' },
);
const jetonA = () => signer(CLE_A, KID_A);
const jetonB = () => signer(CLE_B, KID_B);
let rangForge = 0;
const kidsForges = [];
const jetonForge = () => {
  const kid = `cle-forgee-589-${(rangForge += 1)}`;
  kidsForges.push(kid);
  return signer(CLE_FORGE, kid);
};

// --- Temps ---
const S = 1000;
const MIN = 60 * S;
const HEURE = 60 * MIN;
const INTERVALLE = 60 * S; // cadrage, point 1 : 60 s entre deux lectures
const DELAI = 10 * S; // cadrage v2, point 4 : 10 s au plus par lecture
const DUREE_CACHE = HEURE; // cache des clés, inchangé
const T0 = Date.UTC(2026, 10, 19, 8); // 19-11-2026, 8 h UTC
const aller = (instant) => mock.timers.setTime(instant);

// --- Réponses de Microsoft ---
const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } });
const jwks = (...cles) => () => json({ keys: cles });
const differee = () => {
  let resoudre;
  const promesse = new Promise((r) => { resoudre = r; });
  return { promesse, resoudre };
};
// Lecture suspendue jusqu'à l'abandon par son signal, comme le `fetch` de Node : elle rejette alors avec la raison du
// signal. Sans signal (mutant « délai retiré »), elle ne se termine jamais.
const suspendue = ({ signal } = {}) => new Promise((_, rejeter) => {
  if (!signal) return;
  if (signal.aborted) { rejeter(signal.reason); return; }
  signal.addEventListener('abort', () => rejeter(signal.reason), { once: true });
});

// État simulé, remis à zéro avant chaque test.
const fetchOrigine = globalThis.fetch;
let repondre = jwks(JWK_A);
let appels = []; // lectures de l'adresse des clés : { signal }
let autresAppels = [];
let delais = []; // délais demandés à AbortSignal.timeout
let controleurs = []; // un contrôleur par signal rendu, pour abandonner à la main
let lignes = []; // sortie console de l'application

function simulerMicrosoft() {
  repondre = jwks(JWK_A);
  appels = [];
  autresAppels = [];
  delais = [];
  controleurs = [];
  lignes = [];
  globalThis.fetch = async (entree, options = {}) => {
    const adresse = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url;
    if (adresse !== ADRESSE_CLES) {
      autresAppels.push(adresse);
      throw new Error(`adresse inattendue : ${adresse}`);
    }
    appels.push({ signal: options.signal });
    return repondre(options);
  };
  mock.method(AbortSignal, 'timeout', (ms) => {
    const controleur = new AbortController();
    delais.push(ms);
    controleurs.push(controleur);
    return controleur.signal;
  });
  for (const methode of ['log', 'info', 'warn', 'error', 'debug']) {
    mock.method(console, methode, (...args) => {
      const texte = format(...args);
      // Avertissement de Node (« ExperimentalWarning » de mock.timers), écrit une fois par processus : il n'est pas de
      // l'application.
      if (!/^\(node:\d+\) [A-Za-z]*Warning: /.test(texte)) lignes.push({ methode, texte });
    });
  }
}
function retablir() {
  mock.timers.reset();
  mock.restoreAll();
  globalThis.fetch = fetchOrigine;
}

const lectures = () => appels.length;
const textes = () => lignes.map((l) => `${l.methode} ${l.texte}`);

// Cadrage v2, N3 : « Une trace `[SSO] Lecture des clés Microsoft impossible : <motif>.` est écrite à chaque lecture en
// échec […], sans jeton ni identifiant. » Le cadrage ne fixe pas le texte du motif ; l'exploitant s'y fie pourtant pour
// distinguer une panne du réseau d'une réponse de Microsoft (audit des droits de #606, T1) : le motif de chaque sorte
// d'échec est vérifié au mot près, ce qui écarte aussi la recopie du message brut d'une erreur (l'extrait du corps que
// cite `JSON.parse`, par exemple). Lectures écartées : `keys` non tableau lu comme une erreur réseau ; délai dépassé ou
// réponse illisible lus comme une erreur réseau ; message brut de l'erreur ajouté au motif.
const TRACE_ECHEC = /^\[SSO\] Lecture des clés Microsoft impossible : \S.*\.$/;
function uneTraceDEchec(depuis, jetons, quoi, motif) {
  const nouvelles = lignes.slice(depuis);
  assert.equal(nouvelles.length, 1, `${quoi} : une seule ligne attendue, reçu :\n${textes().slice(depuis).join('\n')}`);
  assert.equal(nouvelles[0].methode, 'warn', quoi);
  assert.match(nouvelles[0].texte, TRACE_ECHEC, quoi);
  assert.equal(nouvelles[0].texte, `[SSO] Lecture des clés Microsoft impossible : ${motif}.`, `${quoi} : motif`);
  const texte = nouvelles[0].texte.toLowerCase();
  const secrets = { oid: OID, locataire: LOCATAIRE, application: APPLICATION, adresse: ADRESSE, ip: IP, kidA: KID_A, kidB: KID_B, ...Object.fromEntries(kidsForges.map((k, i) => [`kidForge${i}`, k])) };
  for (const jeton of jetons) {
    secrets[`jeton ${jeton.slice(0, 12)}`] = jeton;
    secrets[`signature ${jeton.slice(0, 12)}`] = jeton.split('.')[2];
  }
  for (const [nom, valeur] of Object.entries(secrets)) {
    assert.ok(!texte.includes(String(valeur).toLowerCase()), `${quoi} : ${nom} recopié dans la trace : ${nouvelles[0].texte}`);
  }
}
const aucuneLigne = (depuis, quoi) => assert.deepEqual(textes().slice(depuis), [], quoi);

// Titre repris du lot #607 et #608 (cadrage, point 5 : texte du commentaire 6998759218 de #608) : la formule « cache
// gardé sur un échec » était celle de la première version de #606.
describe('#589 : clés Microsoft relues au plus une fois par minute, lecture partagée, limitée à 10 s, seul un cache encore valable sert après un échec', () => {
  let verifier;
  beforeEach(() => {
    const sso = chargerSso();
    verifier = (idToken) => sso.verifyMicrosoftIdentity({ body: { idToken }, ip: IP });
    simulerMicrosoft();
    mock.timers.enable({ apis: ['Date'], now: T0 });
  });
  afterEach(() => {
    retablir();
    assert.deepEqual(autresAppels, [], 'aucune autre adresse n’est appelée');
  });

  // Cadrage v2, N6 : « la dernière tentative vaut « jamais » au départ (`null`), et non 0 (avec `mock.timers`,
  // l'horloge part de 0) » ; v3, N-a : « sous `mock.timers`, horloge à 0 : la toute première lecture doit avoir lieu ».
  // Lecture écartée : une dernière tentative initialisée à 0, sous laquelle, à l'instant 0, l'écart nul ne dépasse pas
  // 60 s : aucune lecture, et le jeton serait refusé.
  test('première lecture à l’instant 0 de l’horloge : elle a lieu (dernière tentative « jamais », et non 0), le jeton est accepté, puis la clé connue l’est sans nouvel appel', async () => {
    aller(0);
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'première connexion à l’instant 0');
    assert.equal(lectures(), 1, 'une lecture, la toute première');
    aller(30 * S);
    assert.deepEqual(await verifier(jetonA()), IDENTITE);
    assert.equal(lectures(), 1, 'clé connue : aucun appel');
    aucuneLigne(0, 'aucune trace');
  });

  // Cadrage, « Tests attendus » : « non-régression : `kid` connu accepté sans appel ; cache expiré relu une fois » ; v2,
  // N10 : « aujourd'hui, un cache expiré avec un `kid` inconnu fait deux lectures dans une même requête ». Lectures
  // écartées : une relecture d'un `kid` connu avant l'heure ; deux lectures pour un cache expiré et un `kid` inconnu
  // (comportement d'avant ce lot) ; un cache expiré servi sans relecture.
  test('non-régression : une clé connue est acceptée sans appel pendant une heure ; le cache expiré est relu une seule fois, même pour un kid inconnu (avant ce lot : deux lectures dans la même requête)', async () => {
    assert.deepEqual(await verifier(jetonA()), IDENTITE);
    assert.equal(lectures(), 1);
    for (const instant of [T0 + 30 * S, T0 + INTERVALLE + 1, T0 + 30 * MIN, T0 + DUREE_CACHE - 1]) {
      aller(instant);
      assert.deepEqual(await verifier(jetonA()), IDENTITE, `clé connue à T0 + ${instant - T0} ms`);
    }
    assert.equal(lectures(), 1, 'clé connue du cache frais : aucun appel pendant une heure');
    aller(T0 + DUREE_CACHE + 1);
    assert.equal(await verifier(jetonForge()), null, 'cache expiré, kid inconnu : refusé');
    assert.equal(lectures(), 2, 'cache expiré et kid inconnu : une seule lecture');
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'cache relu : la clé connue est acceptée');
    assert.equal(lectures(), 2, 'cache relu à l’instant : aucun appel de plus');
    aller(T0 + 2 * DUREE_CACHE + 2);
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'cache de nouveau expiré, clé connue');
    assert.equal(lectures(), 3, 'cache expiré et clé connue : une lecture');
    assert.deepEqual(await verifier(jetonA()), IDENTITE);
    assert.equal(lectures(), 3);
    aucuneLigne(0, 'aucune trace');
  });

  // Cadrage v2, N5 : « lecture à t0 ; à t0 + 61 s, N jetons forgés donnent exactement 1 lecture ; jusqu'à t0 + 121 s,
  // aucune autre » ; point 1 : « un `kid` inconnu ne déclenche une nouvelle lecture que si la dernière tentative date de
  // plus de 60 secondes ; sinon le jeton est refusé […], sans appel sortant ». Lectures écartées : aucune borne (une
  // lecture par jeton forgé, comportement d'avant ce lot : 81 lectures) ; une borne large (`>=`), sous laquelle 60 s pile
  // relancerait une lecture ; une borne comptée depuis la dernière lecture réussie avec la clé du jeton, ou depuis t0
  // seulement, sous laquelle t0 + 121 s relancerait une lecture.
  test('au plus une lecture par minute : lecture à t0 ; rien à t0 + 60 s pile ; à t0 + 61 s, vingt jetons forgés en donnent exactement une ; aucune autre jusqu’à t0 + 121 s ; une milliseconde après, vingt jetons simultanés en donnent une seule', async () => {
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'lecture à t0');
    assert.equal(lectures(), 1);
    const forges = async (n, quoi) => {
      for (let i = 1; i <= n; i += 1) assert.equal(await verifier(jetonForge()), null, `${quoi}, jeton forgé ${i}`);
    };
    aller(T0 + 30 * S);
    await forges(20, 't0 + 30 s');
    aller(T0 + INTERVALLE);
    await forges(20, 't0 + 60 s pile');
    assert.equal(lectures(), 1, 'dans les 60 s de la lecture de t0 : aucun appel sortant');
    aller(T0 + 61 * S);
    await forges(20, 't0 + 61 s');
    assert.equal(lectures(), 2, 'à t0 + 61 s, vingt jetons forgés : exactement une lecture');
    aller(T0 + 90 * S);
    await forges(20, 't0 + 90 s');
    aller(T0 + 121 * S);
    await forges(20, 't0 + 121 s');
    assert.equal(lectures(), 2, 'jusqu’à t0 + 121 s : aucune autre lecture');
    aller(T0 + 121 * S + 1);
    const ensemble = await Promise.all(Array.from({ length: 20 }, () => verifier(jetonForge())));
    assert.deepEqual(ensemble, Array(20).fill(null), 'vingt jetons forgés simultanés : tous refusés');
    assert.equal(lectures(), 3, 'une milliseconde après : une seule lecture pour vingt jetons simultanés');
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'la clé connue reste acceptée');
    assert.equal(lectures(), 3);
    // Chaque lecture a demandé le délai de 10 s et l'a transmis à `fetch`.
    assert.deepEqual(delais, [DELAI, DELAI, DELAI]);
    appels.forEach((appel, i) => assert.equal(appel.signal, controleurs[i].signal, `lecture ${i + 1} : signal du délai transmis`));
    // Cadrage v2, point 6 (note N2 du contrôle) : aucune ligne `[SSO]` de refus pour un jeton forgé.
    aucuneLigne(0, 'aucune trace pour des jetons forgés');
  });

  // Cadrage, « Tests attendus » : « après l'intervalle […], un `kid` inconnu relance une lecture ; un `kid` apparu
  // entre-temps (rotation) est alors accepté » ; point 1, effet accepté : « un jeton signé par la nouvelle clé peut être
  // refusé pendant au plus 60 s si une lecture vient d'avoir lieu ». Lecture écartée : une clé publiée après la lecture
  // qui resterait refusée jusqu'à l'expiration du cache (une heure).
  test('rotation des clés : une clé publiée par Microsoft après la dernière lecture est refusée dans la minute qui suit celle-ci (effet accepté), puis acceptée par la lecture suivante, sans relecture pour les clés connues', async () => {
    assert.deepEqual(await verifier(jetonA()), IDENTITE);
    assert.equal(lectures(), 1);
    repondre = jwks(JWK_A, JWK_B); // Microsoft publie la clé B
    aller(T0 + 30 * S);
    assert.equal(await verifier(jetonB()), null, 'clé B, 30 s après la lecture : refusée, sans appel');
    assert.equal(lectures(), 1);
    aller(T0 + INTERVALLE + 1);
    assert.deepEqual(await verifier(jetonB()), IDENTITE, 'clé B, 60 s et 1 ms après la lecture : relue et acceptée');
    assert.equal(lectures(), 2);
    assert.deepEqual(await verifier(jetonA()), IDENTITE);
    assert.deepEqual(await verifier(jetonB()), IDENTITE);
    assert.equal(lectures(), 2, 'clés connues : aucun appel de plus');
    aucuneLigne(0, 'aucune trace');
  });

  // Cadrage, point 1 : « des demandes simultanées partagent une seule lecture en cours (une seule promesse) ». Lectures
  // écartées : une lecture par demande (vingt appels) ; une borne sans partage, sous laquelle la première demande lirait
  // et les dix-neuf autres, bornées, seraient refusées sans attendre la lecture en cours.
  test('demandes simultanées : vingt jetons de deux clés présentés ensemble avant toute lecture n’en lancent qu’une, et tous sont acceptés à son retour', async () => {
    const reponse = differee();
    repondre = () => reponse.promesse;
    const enCours = Array.from({ length: 20 }, (_, i) => verifier(i % 2 ? jetonA() : jetonB()));
    assert.equal(lectures(), 1, 'une seule lecture lancée pour vingt demandes');
    reponse.resoudre(json({ keys: [JWK_A, JWK_B] }));
    assert.deepEqual(await Promise.all(enCours), Array(20).fill(IDENTITE), 'toutes servies par la lecture partagée');
    assert.equal(lectures(), 1);
    aucuneLigne(0, 'aucune trace');
  });

  // Cadrage v2, N4 (point 8) : « une requête dont le `kid` est dans le cache frais n'attend jamais une lecture en
  // cours. Test : `fetch` suspendu, clé connue acceptée tout de suite. » Lecture écartée : toute demande qui attend la
  // lecture en cours, sous laquelle une lecture suspendue retarderait toutes les connexions (jusqu'à 10 s, ou bien plus
  // sans délai).
  test('une clé connue du cache frais n’attend pas une lecture en cours : pendant une lecture suspendue, lancée par un jeton forgé, la clé connue est acceptée tout de suite', async () => {
    assert.deepEqual(await verifier(jetonA()), IDENTITE);
    aller(T0 + 61 * S);
    const reponse = differee();
    repondre = () => reponse.promesse;
    const forge = verifier(jetonForge());
    const minuterie = new AbortController();
    try {
      assert.equal(lectures(), 2, 'le jeton forgé a lancé une lecture, suspendue');
      const issues = await Promise.race([
        Promise.all([verifier(jetonA()), verifier(jetonA()), verifier(jetonA())]),
        attendre(2000, 'en attente de la lecture en cours', { signal: minuterie.signal }),
      ]);
      assert.deepEqual(issues, [IDENTITE, IDENTITE, IDENTITE], 'clé connue acceptée sans attendre la lecture');
      assert.equal(lectures(), 2);
    } finally {
      minuterie.abort();
      reponse.resoudre(json({ keys: [JWK_A] }));
    }
    assert.equal(await forge, null, 'le jeton forgé reste refusé au retour de la lecture');
    assert.equal(lectures(), 2);
    aucuneLigne(0, 'aucune trace');
  });

  // Cadrage v2, C3 (point 3) : « une dernière tentative datée dans le futur n'empêche pas la lecture : lire si
  // `écart < 0 || écart > 60 s` ». Lecture écartée : `écart > 60 s` seul, sous lequel, après un recul d'une heure, aucune
  // lecture n'aurait lieu avant que l'horloge ait rattrapé t0 + 60 s (une heure et une minute), si bien que la clé B
  // publiée entre-temps resterait refusée.
  test('horloge qui recule d’une heure : la dernière tentative, datée dans le futur, n’empêche pas la lecture ; la borne repart de la nouvelle tentative', async () => {
    assert.deepEqual(await verifier(jetonA()), IDENTITE);
    assert.equal(lectures(), 1);
    repondre = jwks(JWK_A, JWK_B);
    const recul = T0 - HEURE;
    aller(recul);
    assert.deepEqual(await verifier(jetonB()), IDENTITE, 'après le recul, la clé B est lue et acceptée');
    assert.equal(lectures(), 2, 'une lecture, malgré la dernière tentative datée dans le futur');
    aller(recul + 30 * S);
    assert.equal(await verifier(jetonForge()), null);
    assert.equal(lectures(), 2, '30 s après la nouvelle tentative : aucune lecture');
    aller(recul + INTERVALLE + 1);
    assert.equal(await verifier(jetonForge()), null);
    assert.equal(lectures(), 3, 'plus de 60 s après la nouvelle tentative : une lecture');
    aucuneLigne(0, 'aucune trace');
  });

  // Lot #607 et #608, cadrage v2, N6 (intégré au lot) : « `sso.ts` traite un cache daté dans le futur (horloge reculée)
  // comme frais : après un recul d'1 h, une clé retirée par Microsoft reste acceptée 1 h 30 de temps réel après la
  // lecture. Correctif : un cache n'est valable que si `0 <= instant - fetchedAt < 1 h` ; daté dans le futur, il est
  // expiré et relu ». Ici, le cache est lu à t0 avec les clés A et B ; à t0 + 30 min, Microsoft retire B, puis l'horloge
  // recule d'une heure. L'horloge monotone n'est pas simulée dans ce test : réelle, elle n'avance que de quelques
  // millisecondes, si bien que seule la règle « daté dans le futur » fait relire le cache au recul. Lecture écartée : un
  // cache daté dans le futur tenu pour frais (`âge >= 0` retiré), sous laquelle B serait encore acceptée sans lecture
  // après le recul : jusqu'à la fin de l'heure du cache comptée sur l'horloge monotone (une demi-heure de temps réel
  // après le recul, depuis l'audit des droits de #612), et, sans cette horloge, jusqu'à ce que l'horloge du système
  // rattrape t0 + 1 h (une heure et demie de temps réel après le recul : règle d'avant le lot).
  test('#607, N6 : après un recul d’une heure, le cache, daté dans le futur, n’est pas tenu pour frais : il est relu, et une clé retirée par Microsoft entre-temps est refusée', async () => {
    repondre = jwks(JWK_A, JWK_B);
    assert.deepEqual(await verifier(jetonB()), IDENTITE, 'lecture à t0 : clé B publiée, acceptée');
    assert.equal(lectures(), 1);
    aller(T0 + 30 * MIN);
    assert.deepEqual(await verifier(jetonB()), IDENTITE, 't0 + 30 min, cache frais : clé B acceptée sans lecture');
    assert.equal(lectures(), 1);
    repondre = jwks(JWK_A); // Microsoft retire la clé B
    const recul = T0 - 30 * MIN; // l'horloge recule d'une heure : le cache, lu à t0, est daté dans le futur
    aller(recul);
    assert.equal(await verifier(jetonB()), null, 'cache daté dans le futur : relu, la clé B retirée est refusée');
    assert.equal(lectures(), 2, 'une lecture, le cache daté dans le futur n’étant pas frais');
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'la clé A, toujours publiée, est servie par le cache relu');
    assert.equal(lectures(), 2, 'cache relu à l’instant : aucun appel de plus');
    aller(recul + 30 * S);
    assert.equal(await verifier(jetonB()), null, 'trente secondes après : la clé B reste refusée, sans lecture (borne)');
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'la clé A est acceptée sans lecture : le cache relu est frais');
    assert.equal(lectures(), 2);
    aucuneLigne(0, 'aucune trace');
  });

  // Même règle, relecture en échec : N6 (« daté dans le futur, il est expiré et relu »), combiné à la règle retenue après
  // l'audit des droits de #606 (N2 : un cache expiré ne sert plus, avant comme après une tentative de lecture). Le cache
  // daté dans le futur est relu ; la relecture échoue ; tant qu'il reste daté dans le futur (ici, une heure après le
  // recul, dont le test observe la première minute), il ne sert pas, et la clé connue est refusée jusqu'à la lecture
  // réussie suivante. Effet écrit dans `sso.ts` (et, pour les clés datées dans le futur, « ne servent pas tant qu'elles
  // le restent », dans `docs/CONFIGURATION-ENVIRONNEMENT.md`) : après un recul de l'horloge plus long que l'âge du cache,
  // les connexions Microsoft sont refusées tant que le cache reste daté dans le futur et que Microsoft est injoignable
  // (choix par défaut, à confirmer). Ce test ne va pas au-delà : quand l'horloge du système rattrape la lecture du cache
  // sans relecture réussie, le cache sert de nouveau, mais seulement dans l'heure de temps réel qui suit sa lecture,
  // comptée sur l'horloge monotone (test du contrôle de #612, plus bas, où le rattrapage survient dans cette heure ;
  // premier test de l'audit des droits de #612, où il survient au-delà). Lecture écartée : un cache daté dans le futur
  // tenu pour frais (`âge >= 0` retiré), sous lequel la clé A serait acceptée sans lecture ni trace dès le recul.
  test('#607, N6 : après un recul d’une heure et une relecture en échec, le cache, encore daté dans le futur, ne sert pas : la clé connue est refusée, une trace ; la lecture permise suivante, réussie, la rétablit', async () => {
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'lecture à t0');
    assert.equal(lectures(), 1);
    repondre = () => new Response('Erreur interne', { status: 500 });
    const recul = T0 - HEURE;
    aller(recul);
    const jeton = jetonA();
    assert.equal(await verifier(jeton), null, 'cache daté dans le futur, relecture en échec : clé connue refusée');
    assert.equal(lectures(), 2, 'le cache daté dans le futur est relu');
    uneTraceDEchec(0, [jeton], 'relecture du cache daté dans le futur en échec', 'statut HTTP 500');
    const depuis = lignes.length;
    aller(recul + 30 * S);
    assert.equal(await verifier(jetonA()), null, 'dans la minute de la tentative : clé connue toujours refusée, sans lecture');
    assert.equal(lectures(), 2);
    aucuneLigne(depuis, 'aucune autre trace dans la minute');
    aller(recul + INTERVALLE + 1);
    repondre = jwks(JWK_A);
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'lecture permise et réussie : connexion rétablie');
    assert.equal(lectures(), 3);
    aucuneLigne(depuis, 'une lecture réussie ne laisse aucune trace');
  });

  // Audit des droits de #612, R1 : l'heure du cache se compte aussi sur l'horloge monotone du processus
  // (`performance.now()`, que `mock.timers` ne pilote pas : elle est simulée ici à la main, et reste réelle, donc
  // quasi immobile, dans les autres tests). Sans elle, la règle « daté dans le futur, pas valable » ne vaut que tant
  // que l'horloge n'a pas rattrapé la lecture : (1) sortie coupée, la relecture échoue et laisse le cache en place, qui
  // sert de nouveau dès que l'horloge a rattrapé sa lecture ; (2) sans connexion pendant le recul, le cache n'est même
  // pas relu ; (3) un recul plus court que l'âge du cache le prolonge de toute sa durée. Dans les trois cas, une clé
  // retirée par Microsoft serait acceptée au-delà de l'heure du cache (sondes de l'audit, sur la tête 1d2e1a5).
  // Lecture écartée : l'âge compté sur la seule horloge du système.
  test('#607, audit de #612 : sortie coupée et recul d’une heure : le cache daté dans le futur ne sert pas de nouveau quand l’horloge rattrape sa lecture ; la clé retirée reste refusée', async () => {
    let monotone = 5 * HEURE;
    mock.method(performance, 'now', () => monotone);
    repondre = jwks(JWK_A, JWK_B);
    assert.deepEqual(await verifier(jetonB()), IDENTITE, 'lecture à t0');
    repondre = () => new Response('Indisponible', { status: 503 }); // Microsoft retire B ; la sortie est coupée
    monotone += 10 * MIN;
    aller(T0 - 50 * MIN); // l'horloge recule d'une heure, dix minutes après la lecture
    const j1 = jetonB();
    assert.equal(await verifier(j1), null, 'pendant le recul : cache daté dans le futur, relecture en échec');
    assert.equal(lectures(), 2);
    uneTraceDEchec(0, [j1], 'relecture pendant le recul', 'statut HTTP 503');
    monotone += 61 * MIN;
    aller(T0 + MIN); // l'horloge a rattrapé la lecture : une heure et onze minutes de temps réel après elle
    const depuis = lignes.length;
    const j2 = jetonB();
    assert.equal(await verifier(j2), null, 'la clé retirée reste refusée : le cache a plus d’une heure de temps réel');
    assert.equal(lectures(), 3, 'le cache est relu');
    uneTraceDEchec(depuis, [j2], 'relecture après le rattrapage', 'statut HTTP 503');
    assert.equal(await verifier(jetonA()), null, 'la clé A, connue du vieux cache, ne sert pas non plus, sans lecture (borne)');
    assert.equal(lectures(), 3);
  });

  test('#607, audit de #612 : recul d’une heure sans connexion pendant ce temps : après le rattrapage, le cache, lu plus d’une heure de temps réel avant, est relu ; la clé retirée est refusée', async () => {
    let monotone = 5 * HEURE;
    mock.method(performance, 'now', () => monotone);
    repondre = jwks(JWK_A, JWK_B);
    assert.deepEqual(await verifier(jetonB()), IDENTITE, 'lecture à t0');
    repondre = jwks(JWK_A); // Microsoft retire B, et reste joignable
    monotone += 10 * MIN;
    aller(T0 - 50 * MIN); // recul d'une heure ; aucune connexion pendant l'heure qui suit
    monotone += 62 * MIN;
    aller(T0 + 2 * MIN); // au-delà de la minute qui suit la lecture de t0 (borne des lectures, sur l'horloge du système)
    assert.equal(await verifier(jetonB()), null, 'clé retirée refusée');
    assert.equal(lectures(), 2, 'le cache est relu');
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'la clé A est servie par le cache relu, sans autre lecture');
    assert.equal(lectures(), 2);
    aucuneLigne(0, 'aucune trace');
  });

  test('#607, audit de #612 : recul de 45 minutes, plus court que l’âge du cache (50 minutes) : le cache sert jusqu’à une heure de temps réel après sa lecture, pas au-delà', async () => {
    let monotone = 5 * HEURE;
    mock.method(performance, 'now', () => monotone);
    repondre = jwks(JWK_A, JWK_B);
    assert.deepEqual(await verifier(jetonB()), IDENTITE, 'lecture à t0');
    repondre = jwks(JWK_A); // Microsoft retire B
    monotone += 50 * MIN;
    aller(T0 + 5 * MIN); // t0 + 50 min de temps réel, l'horloge ayant reculé de 45 minutes
    assert.deepEqual(await verifier(jetonB()), IDENTITE, 'dans l’heure du cache : servie sans lecture');
    monotone += 10 * MIN - 1;
    aller(T0 + 15 * MIN - 1);
    assert.deepEqual(await verifier(jetonB()), IDENTITE, 'une milliseconde avant l’heure de temps réel : encore servie');
    assert.equal(lectures(), 1);
    monotone += 1;
    aller(T0 + 15 * MIN);
    assert.equal(await verifier(jetonB()), null, 'à une heure de temps réel pile : le cache n’est plus valable, il est relu, la clé retirée est refusée');
    assert.equal(lectures(), 2);
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'la clé A est servie par le cache relu');
    assert.equal(lectures(), 2);
    aucuneLigne(0, 'aucune trace');
  });

  // Contrôle de cohérence de #612 (passage de vérification, T) : effet du refus d'un cache daté dans le futur, écrit dans
  // `sso.ts` (choix par défaut, à confirmer). Sortie coupée, recul plus long que l'âge du cache mais plus court que
  // l'heure : refus tant qu'il reste daté dans le futur, puis il sert de nouveau, sans lecture ni trace, jusqu'à une heure
  // de temps réel après sa lecture. Lectures écartées : refus maintenu tant que Microsoft est injoignable ; cache servi
  // au-delà de l'heure de temps réel.
  test('#607, contrôle de #612 : sortie coupée et recul de vingt minutes, dix minutes après la lecture : refus tant que le cache est daté dans le futur, puis il sert de nouveau, sans lecture, jusqu’à une heure de temps réel après sa lecture', async () => {
    let monotone = 5 * HEURE;
    mock.method(performance, 'now', () => monotone);
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'lecture à t0');
    repondre = () => new Response('Indisponible', { status: 503 }); // la sortie est coupée
    monotone += 10 * MIN;
    aller(T0 - 10 * MIN); // l'horloge recule de vingt minutes, dix minutes après la lecture
    const j1 = jetonA();
    assert.equal(await verifier(j1), null, 'cache daté dans le futur, relecture en échec : refusée');
    assert.equal(lectures(), 2);
    uneTraceDEchec(0, [j1], 'relecture pendant le recul', 'statut HTTP 503');
    monotone += 10 * MIN;
    aller(T0); // l'horloge a rattrapé la lecture, vingt minutes de temps réel après elle
    const depuis = lignes.length;
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'le cache sert de nouveau, sans lecture');
    monotone += 40 * MIN - 1;
    aller(T0 + 40 * MIN - 1);
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'une milliseconde avant l’heure de temps réel : encore servie');
    assert.equal(lectures(), 2);
    aucuneLigne(depuis, 'aucune trace tant que le cache sert');
    monotone += 1;
    aller(T0 + 40 * MIN);
    const j2 = jetonA();
    assert.equal(await verifier(j2), null, 'à une heure de temps réel pile : le cache ne sert plus, la relecture échoue');
    assert.equal(lectures(), 3);
    uneTraceDEchec(depuis, [j2], 'relecture à l’heure de temps réel', 'statut HTTP 503');
  });

  // Lectures en échec. Cadrage v2, N3 : « Échec » : statut hors 2xx, exception (réseau, délai), JSON invalide, `keys`
  // absent ou qui n'est pas un tableau. Le statut 503 porte une liste de clés valide (avec la clé B) : elle ne doit pas
  // servir (lecture écartée : un statut ignoré). Le corps `null` est un JSON valide sans `keys`.
  const ECHECS = [
    ['statut HTTP 500', () => new Response('Erreur interne', { status: 500 }), 'statut HTTP 500'],
    ['statut HTTP 503 avec une liste de clés', () => json({ keys: [JWK_A, JWK_B] }, 503), 'statut HTTP 503'],
    ['exception de fetch (réseau)', () => { throw new TypeError('fetch failed'); }, 'erreur réseau'],
    ['JSON invalide', () => new Response('<html>Service indisponible</html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'réponse illisible'],
    ['keys absent', () => json({ autre: [JWK_B] }), 'réponse sans liste de clés'],
    ['corps JSON null', () => json(null), 'réponse sans liste de clés'],
    ['keys qui est un objet', () => json({ keys: JWK_B }), 'réponse sans liste de clés'],
    ['keys qui est un texte', () => json({ keys: KID_B }), 'réponse sans liste de clés'],
  ];

  for (const [quoi, echec, motif] of ECHECS) {
    // Cadrage, point 1 : « toute lecture […] note l'instant de la tentative, réussie ou non » ; « le cache expiré […] suit
    // la même borne ». Règle retenue après l'audit des droits de #606 (N2), qui remplace le « cache précédent gardé, même
    // expiré » du cadrage : en cas d'échec, seul un cache encore valable (moins d'une heure) sert ; un cache expiré ne sert
    // plus, avant comme après la tentative, comme avant ce lot. Lectures écartées : instant noté seulement en cas de
    // succès (le jeton suivant relancerait une lecture) ; cache vidé sur un échec (la clé A serait refusée alors que le
    // cache est encore valable) ; cache expiré servi après un échec, ou tant que la borne empêche de le relire (la clé A
    // serait acceptée au-delà de l'heure : lecture du cadrage v1, écartée par N2) ; cache expiré relu sans borne après un
    // échec (une lecture par jeton) ; échec sans trace, ou trace à chaque jeton.
    test(`lecture en échec (${quoi}) : tentative notée, une trace sans jeton ni identifiant, aucune relecture dans les 60 s ; le cache encore valable laisse accepter la clé connue jusqu’à la fin de son heure ; expiré, il ne sert plus, et la clé connue est refusée jusqu’à la lecture réussie suivante`, async () => {
      assert.deepEqual(await verifier(jetonA()), IDENTITE);
      assert.equal(lectures(), 1);
      aller(T0 + 61 * S);
      repondre = echec;
      let depuis = lignes.length;
      const jeton = jetonB();
      assert.equal(await verifier(jeton), null, 'kid inconnu, lecture en échec : refusé');
      assert.equal(lectures(), 2, 'la lecture a eu lieu');
      uneTraceDEchec(depuis, [jeton], 'lecture en échec', motif);
      depuis = lignes.length;
      assert.deepEqual(await verifier(jetonA()), IDENTITE, 'cache encore valable : la clé connue reste acceptée');
      aller(T0 + 91 * S);
      assert.equal(await verifier(jetonB()), null);
      assert.equal(await verifier(jetonForge()), null);
      aller(T0 + 121 * S);
      assert.equal(await verifier(jetonForge()), null);
      assert.equal(lectures(), 2, 'la tentative en échec est notée : aucune relecture dans les 60 s');
      aller(T0 + DUREE_CACHE - 1); // cache lu à t0 : encore valable une milliseconde
      assert.deepEqual(await verifier(jetonA()), IDENTITE, 'cache encore valable, une milliseconde avant la fin de son heure : clé connue acceptée');
      assert.equal(lectures(), 2, 'clé connue du cache valable : aucune lecture');
      aucuneLigne(depuis, 'aucune autre trace');

      aller(T0 + DUREE_CACHE + 1); // cache lu à t0 : expiré
      depuis = lignes.length;
      assert.equal(await verifier(jetonA()), null, 'cache expiré, relecture en échec : la clé connue est refusée');
      assert.equal(lectures(), 3, 'cache expiré : une lecture');
      uneTraceDEchec(depuis, [], 'relecture du cache expiré en échec', motif);
      depuis = lignes.length;
      for (const instant of [T0 + DUREE_CACHE + 30 * S, T0 + DUREE_CACHE + 1 + INTERVALLE]) {
        aller(instant);
        assert.equal(await verifier(jetonA()), null, `T0 + ${instant - T0} ms : la clé du cache expiré reste refusée`);
        assert.equal(await verifier(jetonB()), null, `T0 + ${instant - T0} ms`);
      }
      assert.equal(lectures(), 3, 'cache expiré : même borne, aucune relecture dans les 60 s');
      aucuneLigne(depuis, 'aucune autre trace dans la minute');

      aller(T0 + DUREE_CACHE + INTERVALLE + 2);
      repondre = jwks(JWK_A, JWK_B); // Microsoft répond de nouveau
      assert.deepEqual(await verifier(jetonA()), IDENTITE, 'lecture suivante réussie : connexion rétablie');
      assert.deepEqual(await verifier(jetonB()), IDENTITE, 'et la clé B est acceptée');
      assert.equal(lectures(), 4);
      aucuneLigne(depuis, 'une lecture réussie ne laisse aucune trace');
    });

    // Cadrage, point 1 : le cache précédent ne sert « que s'il existe » (et, depuis N2 de l'audit des droits de #606,
    // s'il est encore valable) ; la tentative est notée même sans cache.
    // Lectures écartées : instant noté seulement en cas de succès (une lecture par jeton pendant toute la panne) ; une
    // réponse en échec mise en cache (la clé B du statut 503 serait acceptée, ou le cache vide empêcherait la lecture
    // suivante).
    test(`lecture en échec (${quoi}) sans cache précédent : jeton refusé, une trace, aucune relecture dans les 60 s ; la lecture suivante rétablit la connexion`, async () => {
      repondre = echec;
      const jeton = jetonB();
      assert.equal(await verifier(jeton), null, 'première lecture en échec : refusé');
      assert.equal(lectures(), 1);
      uneTraceDEchec(0, [jeton], 'première lecture en échec', motif);
      const depuis = lignes.length;
      for (const instant of [T0 + 1, T0 + 30 * S, T0 + INTERVALLE]) {
        aller(instant);
        assert.equal(await verifier(jetonB()), null, `T0 + ${instant - T0} ms`);
        assert.equal(await verifier(jetonA()), null, `T0 + ${instant - T0} ms`);
      }
      assert.equal(lectures(), 1, 'aucune relecture dans les 60 s de la tentative en échec');
      aucuneLigne(depuis, 'aucune autre trace');
      aller(T0 + INTERVALLE + 1);
      repondre = jwks(JWK_A);
      assert.deepEqual(await verifier(jetonA()), IDENTITE, 'lecture suivante réussie : connexion rétablie');
      assert.equal(lectures(), 2);
      aucuneLigne(depuis, 'une lecture réussie ne laisse aucune trace');
    });
  }

  // Règle retenue après l'audit des droits de #606 (N2) : un cache expiré ne sert plus, « ni avant ni après une tentative
  // de lecture ». Ici, une tentative en échec trente secondes avant la fin de l'heure du cache fait que la borne empêche
  // de le relire au moment où il expire : la clé connue est refusée, sans lecture, jusqu'à la lecture permise suivante,
  // qui la rétablit. Lecture écartée : un cache expiré servi tant que la borne empêche de le relire (lecture du cadrage
  // v1), sous laquelle la clé A resterait acceptée sans lecture.
  test('cache qui expire pendant que la borne empêche de le relire : la clé connue est refusée sans lecture, puis acceptée après la lecture permise suivante', async () => {
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'lecture à t0');
    aller(T0 + DUREE_CACHE - 30 * S);
    repondre = () => new Response('Erreur interne', { status: 500 });
    const forge = jetonForge();
    assert.equal(await verifier(forge), null);
    assert.equal(lectures(), 2, 'tentative en échec trente secondes avant la fin de l’heure du cache');
    uneTraceDEchec(0, [forge], 'tentative en échec', 'statut HTTP 500');
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'cache encore valable : clé connue acceptée');
    const depuis = lignes.length;
    for (const instant of [T0 + DUREE_CACHE + 1, T0 + DUREE_CACHE + 30 * S]) {
      aller(instant);
      assert.equal(await verifier(jetonA()), null, `T0 + ${instant - T0} ms : cache expiré, relecture bornée, clé connue refusée`);
    }
    assert.equal(lectures(), 2, 'aucune lecture : la dernière tentative date de 60 s au plus');
    aucuneLigne(depuis, 'aucune trace sans lecture');
    aller(T0 + DUREE_CACHE + 30 * S + 1);
    repondre = jwks(JWK_A);
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'lecture permise et réussie : connexion rétablie');
    assert.equal(lectures(), 3);
    aucuneLigne(depuis, 'une lecture réussie ne laisse aucune trace');
  });

  // Audit des droits de #606, N1 (correctif appliqué par Claude Code) : la lecture en cours est effacée à la fin de sa
  // promesse, même quand `fetch` lève sans rendre la main. Effacée dans le corps de la lecture, elle l'était avant que la
  // lecture ne soit notée « en cours » : elle le restait alors, déjà terminée, et toute demande suivante l'attendait sans
  // jamais relire. Lecture écartée : la lecture en cours effacée dans son propre corps, sous laquelle la connexion ne
  // reviendrait jamais, même après la minute de la borne.
  test('fetch qui lève sans rendre la main : lecture notée en échec (erreur réseau), et la lecture permise suivante a bien lieu', async () => {
    const fetchSimule = globalThis.fetch;
    let leverAussitot = true;
    globalThis.fetch = (entree, options = {}) => {
      if (!leverAussitot) return fetchSimule(entree, options);
      const adresse = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url;
      if (adresse !== ADRESSE_CLES) autresAppels.push(adresse);
      appels.push({ signal: options.signal });
      throw new TypeError('fetch failed');
    };
    const jeton = jetonA();
    assert.equal(await verifier(jeton), null, 'lecture en échec, sans cache : refusé');
    assert.equal(lectures(), 1);
    uneTraceDEchec(0, [jeton], 'fetch qui lève aussitôt', 'erreur réseau');
    aller(T0 + 30 * S);
    assert.equal(await verifier(jetonA()), null);
    assert.equal(lectures(), 1, 'dans la minute : aucune lecture');
    leverAussitot = false;
    repondre = jwks(JWK_A);
    aller(T0 + INTERVALLE + 1);
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'après la minute : la lecture a lieu et rétablit la connexion');
    assert.equal(lectures(), 2);
  });

  // Ajout de Claude Code après la note 5 du rédacteur des tests (règle retenue sur la même branche) : une lecture réussie
  // ne garde que les éléments de `keys` qui sont des objets (ni nul, ni tableau, ni valeur simple). Sans ce filtre, un
  // élément nul faisait échouer la recherche d'un `kid` dans le cache frais, avant toute relecture, et refusait toutes les
  // connexions pendant une heure. L'élément nul est placé en tête, pour que la recherche le rencontre avant la clé
  // valide. Lectures écartées : la liste gardée telle quelle (filtre retiré), sous laquelle le jeton signé par la clé
  // valide serait refusé à chaque présentation ; une réponse avec des éléments invalides lue comme un échec (trace, cache
  // non mis à jour) ; une relecture pour un `kid` connu.
  test('réponse dont la liste mêle des éléments invalides (nul, nombre, texte, tableau) et une clé valide : lecture réussie, sans trace ; la clé valide est gardée et son jeton accepté, sans relecture pour ce kid connu', async () => {
    repondre = () => json({ keys: [null, 7, 'x', [], JWK_A] });
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'jeton signé par la clé valide : accepté');
    assert.equal(lectures(), 1);
    aucuneLigne(0, 'lecture réussie : aucune trace d’échec');
    for (const instant of [T0 + 30 * S, T0 + INTERVALLE + 1, T0 + 30 * MIN]) {
      aller(instant);
      assert.deepEqual(await verifier(jetonA()), IDENTITE, `T0 + ${instant - T0} ms : toujours accepté`);
    }
    assert.equal(lectures(), 1, 'kid connu du cache frais : aucune relecture');
    aucuneLigne(0, 'aucune trace');
  });

  // Cadrage v2, point 4 : « `fetch(MS_JWKS_URI, { signal: AbortSignal.timeout(10_000) })` : au-delà de 10 s, la lecture
  // échoue (et compte comme une tentative) » ; v3, T1 : « remplacer `AbortSignal.timeout` par un signal piloté à la
  // main ; le double de `fetch` rejette sur l'abandon (`TimeoutError`). Vérifier : lecture notée en échec, cache
  // précédent gardé, trace écrite, aucune relecture dans les 60 s. Mutant à tuer : « délai retiré ». » Lectures écartées :
  // aucun délai (la lecture ne finit jamais : ni signal demandé, ni signal transmis) ; un autre délai que 10 s ; un
  // signal demandé mais non transmis à `fetch` ; un abandon qui ne compte pas comme une tentative en échec.
  test('délai de 10 s : chaque lecture demande un signal de 10 s et le transmet à fetch ; une lecture suspendue, abandonnée par ce signal, est notée en échec, cache encore valable gardé, une trace, aucune relecture dans les 60 s', async () => {
    assert.deepEqual(await verifier(jetonA()), IDENTITE);
    assert.deepEqual(delais, [DELAI], 'la lecture demande un délai de 10 s');
    assert.equal(appels[0].signal, controleurs[0].signal, 'le signal du délai est transmis à fetch');
    aller(T0 + 61 * S);
    repondre = suspendue;
    const jeton = jetonB();
    const enCours = verifier(jeton);
    assert.equal(lectures(), 2);
    assert.deepEqual(delais, [DELAI, DELAI], 'la lecture suspendue a demandé un délai de 10 s');
    assert.equal(appels[1].signal, controleurs[1].signal, 'le signal du délai est transmis à la lecture suspendue');
    assert.equal(await Promise.race([enCours, attendre(50).then(() => 'en cours')]), 'en cours', 'la lecture reste suspendue tant que le délai ne l’abandonne pas');
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'pendant la lecture suspendue, la clé connue est acceptée');
    const depuis = lignes.length;
    aller(T0 + 71 * S);
    controleurs[1].abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    assert.equal(await enCours, null, 'lecture abandonnée au bout de 10 s : jeton refusé');
    uneTraceDEchec(depuis, [jeton], 'lecture abandonnée', 'délai de 10 s dépassé');
    assert.deepEqual(await verifier(jetonA()), IDENTITE, 'cache encore valable (lu à t0) gardé : clé connue acceptée');
    aller(T0 + 101 * S); // 40 s après la tentative, 30 s après son abandon
    assert.equal(await verifier(jetonB()), null);
    assert.equal(await verifier(jetonForge()), null);
    assert.equal(lectures(), 2, 'la lecture abandonnée compte comme une tentative : aucune relecture dans les 60 s');
    aller(T0 + 131 * S + 1); // plus de 60 s après la tentative comme après son abandon
    repondre = jwks(JWK_A, JWK_B);
    assert.deepEqual(await verifier(jetonB()), IDENTITE, 'lecture suivante réussie');
    assert.equal(lectures(), 3);
    assert.deepEqual(delais, [DELAI, DELAI, DELAI]);
    assert.equal(lignes.length, depuis + 1, 'une seule trace en tout');
  });
});

describe('#589 : POST /api/auth/sso, jetons forgés refusés sans multiplier les lectures des clés', () => {
  beforeEach(() => {
    simulerMicrosoft();
    mock.timers.enable({ apis: ['Date'], now: T0 });
  });
  afterEach(() => {
    retablir();
    assert.deepEqual(autresAppels, [], 'aucune autre adresse n’est appelée');
  });

  // Cadrage, « Tests attendus » : « N jetons forgés à `kid` inconnu dans l'intervalle : un seul appel sortant (après la
  // première lecture), tous refusés 401, sans liaison ni écriture » ; constat : « Un client non authentifié peut donc
  // faire lancer au serveur autant d'appels sortants qu'il envoie de jetons forgés (`POST /api/auth/sso`) » ; v2, point 6 (note N2 du contrôle) : « Aucune ligne
  // `[SSO]` de refus pour un jeton forgé ». La base est injoignable : une lecture ou une écriture aurait répondu 500. Cette
  // instance de sso.js, chargée avec l'application, ne sert qu'à ce test. Lecture écartée : une lecture par jeton forgé
  // (comportement d'avant ce lot : soixante lectures).
  test('quarante jetons forgés (vingt ensemble, puis vingt à la suite) répondent tous 401 sans toucher à la base, pour une seule lecture des clés ; une minute après, vingt de plus n’en font qu’une', async () => {
    const connecter = (idToken) => request(app).post('/api/auth/sso').send({ idToken });
    const ensemble = await Promise.all(Array.from({ length: 20 }, () => connecter(jetonForge())));
    ensemble.forEach((res, i) => assert.deepEqual([res.status, res.body], [401, REFUS_GENERIQUE], `jeton forgé simultané ${i + 1}`));
    for (let i = 1; i <= 20; i += 1) {
      const res = await connecter(jetonForge());
      assert.deepEqual([res.status, res.body], [401, REFUS_GENERIQUE], `jeton forgé à la suite ${i}`);
    }
    assert.equal(lectures(), 1, 'quarante jetons forgés dans la minute : une seule lecture');
    aller(T0 + 61 * S);
    const apres = await Promise.all(Array.from({ length: 20 }, () => connecter(jetonForge())));
    apres.forEach((res, i) => assert.deepEqual([res.status, res.body], [401, REFUS_GENERIQUE], `une minute après, jeton forgé ${i + 1}`));
    assert.equal(lectures(), 2, 'une minute après : une seule lecture de plus');
    assert.deepEqual(textes(), [], 'aucune trace pour des jetons forgés');
  });
});
