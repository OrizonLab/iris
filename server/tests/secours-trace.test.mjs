// Lot #589, « trace `[SECOURS]` d'un essai bloqué limitée » (cadrage v1, complété des v2 et v3 du controleur-coherence,
// `main` à 890d384 ; issue `suivi-audit` #589 ; messages de Nelson des 16, 17 et 18-11-2026). Parcours de sécurité de la
// connexion et journaux (règle 2 de la méthode).
//
// Avant ce lot, chaque essai bloqué (429) de l'accès de secours écrivait une ligne
// `[SECOURS] Trop de tentatives depuis <ip> — blocage temporaire.`, sans limite : une rafale remplissait les journaux du
// conteneur. Le cadrage fixe (point 2 ; v2, N1) :
//   - une seule ligne « Trop de tentatives » par adresse et par fenêtre, au premier essai bloqué de la fenêtre, au texte
//     inchangé ; les essais bloqués suivants de la même fenêtre ne sont plus tracés, sans ligne de synthèse ;
//   - les essais non bloqués (401), le succès, le compte absent et les lignes de démarrage restent tous tracés,
//     inchangés ;
//   - le 429 et le décompte des essais ne changent pas (#563, #261).
// Une ligne par adresse et par fenêtre, sans synthèse : choix par défaut, à confirmer.
//
// Tests sans base (v2, point 11) : les réponses 401 et 429 ne lisent pas la base. L'accès de secours actif est posé avant
// le chargement de l'application (BREAK_GLASS_EMAIL et BREAK_GLASS_TOKEN sont lus à son chargement), avec une base
// injoignable : un 401 ou un 429 y prouve qu'aucune lecture en base n'a été tentée (le bon jeton, bloqué, aurait sinon
// répondu 500). TRUST_PROXY=1 fait retenir, pour chaque requête, l'adresse que porte X-Forwarded-For (la connexion,
// 127.0.0.1, tient le rôle du proxy) : le test choisit ainsi l'adresse de chaque essai. Deux horloges sont simulées pour
// la fenêtre suivante (lot #614, cadrage v2, C1) : celle du système par `mock.timers` (`Date` seulement), et l'horloge
// monotone du processus, sur laquelle se compte la fenêtre, par `mock.method(performance, 'now', …)`, d'une autre origine
// (cinq heures, comme cles-microsoft.test.mjs), restaurée après chaque test ; `aller` fait s'écouler le temps (les deux
// horloges avancent du même écart), `regler` déplace l'horloge du système seule. La table des essais est vidée avant et
// après chaque test.
// Le succès et le compte absent, qui lisent la base, sont prouvés dans api.test.mjs (bloc « Trace de l’accès de secours
// (#589) ») ; la preuve HTTP en processus séparé, derrière deux proxys, est dans trust-proxy.test.mjs.
//
// Lot #607 et #608, « accès de secours : traces complètes et recul de l'horloge » (cadrage v1 complété de la v2 du
// controleur-coherence, `main` à c575020 ; issues `suivi-audit` #608, N4 de l'audit des droits de #606, et #607, N4 du
// contrôle de cohérence de #606 ; messages de Nelson des 16 au 19-11-2026). Dernier bloc de ce fichier :
//   - un bon jeton suivi d'une erreur à l'ouverture de la session répond toujours 500, au corps inchangé, et laisse une
//     ligne `[SECOURS] Jeton valide mais erreur lors de l'ouverture de la session de secours depuis <ip>.`, sans le
//     message ni la pile de l'erreur (point 2 ; v2, N1 et N2 ; texte de la ligne : choix par défaut, à confirmer). La base
//     injoignable de ce fichier fournit l'erreur : la lecture du compte de secours échoue, après le contrôle du secret ;
//   - l'essai suivi d'une erreur reste compté (v2, T1) ;
//   - une fenêtre datée dans le futur, après un recul de l'horloge, était passée : l'adresse repartait de zéro, et le
//     premier blocage de la fenêtre rouverte avait sa ligne (point 3 ; v2, T1, option). Le lot #614 (cadrage v2 du
//     controleur-coherence, `main` à 6b98e34 ; issue `suivi-audit` #614 ; choix par défaut, à confirmer) remplace cette
//     règle : la fenêtre se compte sur l'horloge monotone du processus, que ne déplace aucun réglage de l'horloge du
//     système. Après un recul d'une heure, l'adresse bloquée le reste, sans nouvelle ligne, jusqu'à quinze minutes de
//     temps écoulé depuis son premier essai ; la fenêtre suivante a sa ligne au premier blocage (test réécrit, C1).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test, { afterEach, beforeEach, describe, mock } from 'node:test';
import { format } from 'node:util';

const EMAIL_SECOURS = 'secours-589@iris.test';
const JETON_SECOURS = 'jeton-de-secours-de-test-589-au-moins-32-caracteres';
const JETON_FAUX = 'jeton-de-secours-faux-589-au-moins-32-caracteres';

// Posées avant le chargement : accès de secours actif, un proxy de confiance, base injoignable, connexion Microsoft
// inactive. Posées même vides, elles ne sont pas remplacées par un server/.env du poste.
process.env.BREAK_GLASS_EMAIL = EMAIL_SECOURS;
process.env.BREAK_GLASS_TOKEN = JETON_SECOURS;
process.env.TRUST_PROXY = '1';
process.env.DATABASE_URL = 'postgresql://iris:iris@127.0.0.1:1/iris_injoignable?schema=public&connect_timeout=5';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secret-de-test-secours-trace-589';
process.env.AZURE_TENANT_ID = '';
process.env.AZURE_CLIENT_ID = '';
process.env.SUPERADMIN_EMAILS = '';
delete process.env.MICROSOFT_GRAPH_URL;

// Lignes écrites au chargement de l'application (lignes de démarrage de l'accès de secours).
const lignesDemarrage = [];
const consoleOrigine = {};
for (const methode of ['log', 'info', 'warn', 'error']) {
  consoleOrigine[methode] = console[methode];
  console[methode] = (...args) => { lignesDemarrage.push({ methode, texte: format(...args) }); };
}
const require = createRequire(import.meta.url);
let app;
let essaisSecours;
let request;
try {
  request = require('supertest');
  ({ app } = require('../dist/index.js'));
  ({ essaisSecours } = require('../dist/src/domaines/authentification/secours.js'));
} finally {
  for (const [methode, origine] of Object.entries(consoleOrigine)) console[methode] = origine;
}

const SEUIL = 5; // essais admis par adresse et par fenêtre (#563)
const MIN = 60_000;
const HEURE = 60 * MIN;
const FENETRE = 15 * MIN;
const T0 = Date.UTC(2026, 10, 19, 9); // horloge du système au début de chaque test : 19-11-2026, 9 h UTC
// Horloge monotone au début de chaque test (lot #614) : une autre origine que l'horloge du système.
const M0 = 5 * HEURE;
let monotone = M0;
const A = '198.51.100.11';
const B = '198.51.100.22';
const C = '198.51.100.33';
// Le temps s'écoule jusqu'à l'instant `instant` de l'horloge du système : les deux horloges avancent du même écart. Le
// temps écoulé ne recule jamais : un réglage de l'horloge du système passe par `regler`.
const aller = (instant) => {
  const ecart = instant - Date.now();
  assert.ok(ecart >= 0, `aller : le temps écoulé ne recule pas (écart de ${ecart} ms) ; un réglage de l’horloge passe par regler`);
  monotone += ecart;
  mock.timers.setTime(instant);
};
// Réglage de l'horloge du système seule (correction NTP), sans temps écoulé : l'horloge monotone ne bouge pas.
const regler = (instant) => mock.timers.setTime(instant);

// Réponses et lignes exactes (routes d'authentification ; texte de la ligne de blocage inchangé, v2, N1).
const REFUS = { error: 'Jeton de secours invalide.' };
const BLOCAGE = { error: 'Trop de tentatives. Réessayez dans quinze minutes.' };
const ligneRefus = (ip) => `warn [SECOURS] Tentative d'accès de secours REFUSÉE depuis ${ip}.`;
const ligneBlocage = (ip) => `warn [SECOURS] Trop de tentatives depuis ${ip} — blocage temporaire.`;
// Lot #607 et #608 : corps du 500 inchangé (point 2) ; ligne de l'erreur (v2, N1 : choix par défaut, à confirmer).
const ERREUR = { error: "Erreur lors de l'ouverture de la session de secours." };
const ligneErreur = (ip) => `warn [SECOURS] Jeton valide mais erreur lors de l'ouverture de la session de secours depuis ${ip}.`;

const AVERTISSEMENT_NODE = /^\(node:\d+\) [A-Za-z]*Warning: /;
let lignes = [];
// Un essai depuis `ip` : réponse, lignes écrites pendant l'essai et compte de l'adresse après lui.
async function essai(ip, corps = { token: JETON_FAUX }) {
  const debut = lignes.length;
  const res = await request(app).post('/api/auth/secours').set('X-Forwarded-For', ip).send(corps);
  return { statut: res.status, corps: res.body, lignes: lignes.slice(debut), compte: essaisSecours.get(ip)?.count };
}
// Essai refusé (401) : une ligne « REFUSÉE », compte attendu.
async function refuse(ip, compte, quoi, corps) {
  const r = await essai(ip, corps);
  assert.deepEqual(r, { statut: 401, corps: REFUS, lignes: [ligneRefus(ip)], compte }, quoi);
}
// Essai bloqué (429) : la ligne « Trop de tentatives » si c'est le premier blocage de la fenêtre, aucune sinon.
async function bloque(ip, compte, tracee, quoi, corps) {
  const r = await essai(ip, corps);
  assert.deepEqual(r, { statut: 429, corps: BLOCAGE, lignes: tracee ? [ligneBlocage(ip)] : [], compte }, quoi);
}

describe('#589 : trace de l’accès de secours, une ligne « Trop de tentatives » par adresse et par fenêtre', () => {
  beforeEach(() => {
    essaisSecours.clear();
    lignes = [];
    for (const methode of ['log', 'info', 'warn', 'error', 'debug']) {
      mock.method(console, methode, (...args) => {
        const texte = format(...args);
        // Avertissement de Node (« ExperimentalWarning » de mock.timers), écrit une fois par processus : il n'est pas de
        // l'application.
        if (!AVERTISSEMENT_NODE.test(texte)) lignes.push(`${methode} ${texte}`);
      });
    }
    monotone = M0;
    mock.timers.enable({ apis: ['Date'], now: T0 });
    mock.method(performance, 'now', () => monotone);
  });
  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
    essaisSecours.clear();
  });

  // Cadrage, point 2 : « les essais non bloqués (401), le succès, le compte absent et les lignes de démarrage restent
  // tous tracés, inchangés ». Une seule instance du module de l'accès de secours : la table lue ici est celle des routes.
  test('lignes de démarrage inchangées : l’accès de secours actif s’annonce une fois au chargement, et la table lue par ce fichier est celle des routes', () => {
    assert.deepEqual(
      lignesDemarrage.filter((l) => l.texte.includes('[SECOURS]')).map((l) => `${l.methode} ${l.texte}`),
      [`log [SECOURS] Accès de secours actif pour ${EMAIL_SECOURS} (session limitée à 1 h).`],
    );
    assert.equal(Object.keys(require.cache).filter((f) => /[\\/]authentification[\\/]secours\.js$/.test(f)).length, 1);
  });

  // Cadrage, « Tests attendus » : « 5 essais refusés (5 lignes « REFUSÉE »), puis K essais bloqués : une seule ligne
  // « Trop de tentatives », 429 à chaque fois » ; point 2 : « au premier essai bloqué de la fenêtre » ; « le 429 et le
  // décompte des essais ne changent pas ». Les essais bloqués portent tour à tour un jeton faux, le bon jeton et aucun
  // jeton : le blocage passe avant le contrôle du secret, et aucun n'est tracé. Lectures écartées : une ligne à chaque
  // essai bloqué (comportement d'avant ce lot : vingt-cinq lignes) ; aucune ligne de blocage ; une ligne écrite à un
  // autre essai que le premier bloqué (le septième, par exemple) ; un décompte arrêté au premier blocage, ou des 401
  // dont la trace disparaît.
  test('cinq essais refusés laissent cinq lignes « REFUSÉE » ; puis vingt-cinq essais bloqués, chacun en 429, une seule ligne « Trop de tentatives », au premier d’entre eux ; le décompte continue', async () => {
    await refuse(A, 1, 'essai 1, jeton faux');
    await refuse(A, 2, 'essai 2, sans jeton', {});
    for (let i = 3; i <= SEUIL; i += 1) await refuse(A, i, `essai ${i}, jeton faux`);
    await bloque(A, SEUIL + 1, true, 'essai 6 : premier blocage de la fenêtre, tracé');
    const corps = [{ token: JETON_FAUX }, { token: JETON_SECOURS }, {}];
    for (let i = SEUIL + 2; i <= SEUIL + 25; i += 1) {
      await bloque(A, i, false, `essai ${i} : bloqué, non tracé (${JSON.stringify(corps[i % 3]).slice(0, 20)}…)`, corps[i % 3]);
    }
    assert.deepEqual(lignes, [...Array(SEUIL).fill(ligneRefus(A)), ligneBlocage(A)], 'trente essais : cinq refus et un blocage tracés');
  });

  // Cadrage, « Tests attendus » : « une autre adresse : sa propre ligne ». Lecture écartée : une seule ligne de blocage
  // pour toutes les adresses (un repère commun), sous laquelle le blocage de B ne serait pas tracé ; le blocage de B qui
  // ferait retracer A.
  test('une autre adresse a sa propre ligne, au premier de ses essais bloqués ; la première reste bloquée sans nouvelle ligne', async () => {
    for (let i = 1; i <= SEUIL; i += 1) await refuse(A, i, `A, essai ${i}`);
    await bloque(A, 6, true, 'A, essai 6 : tracé');
    for (let i = 1; i <= 3; i += 1) await refuse(B, i, `B, essai ${i}`);
    await bloque(A, 7, false, 'A, essai 7 : non tracé');
    await bloque(A, 8, false, 'A, essai 8 : non tracé');
    for (let i = 4; i <= SEUIL; i += 1) await refuse(B, i, `B, essai ${i}`);
    await bloque(B, 6, true, 'B, essai 6 : premier blocage de B, tracé');
    for (let i = 7; i <= 9; i += 1) await bloque(B, i, false, `B, essai ${i} : non tracé`);
    await bloque(A, 9, false, 'A, essai 9 : toujours non tracé');
    await refuse(C, 1, 'C, essai 1 : une troisième adresse n’est pas bloquée');
    assert.deepEqual(lignes.filter((l) => l.includes('Trop de tentatives')), [ligneBlocage(A), ligneBlocage(B)]);
  });

  // Cadrage, « Tests attendus » : « fenêtre suivante (horloge simulée) : une nouvelle ligne au premier blocage » ; #563 :
  // « encore refusé à 15 minutes pile ; un nouvel essai est admis une milliseconde après la fenêtre ». Lectures écartées :
  // une ligne par adresse pour toute la vie du processus (adresse retenue sans fenêtre), sous laquelle le blocage de la
  // deuxième fenêtre ne serait pas tracé ; une ligne reprise à quinze minutes pile, dans la même fenêtre.
  test('fenêtre suivante : encore bloquée sans ligne à quinze minutes pile ; une milliseconde après, cinq refus tracés, puis une nouvelle ligne au premier blocage, et rien ensuite', async () => {
    for (let i = 1; i <= SEUIL; i += 1) await refuse(A, i, `fenêtre 1, essai ${i}`);
    await bloque(A, 6, true, 'fenêtre 1, essai 6 : tracé');
    await bloque(A, 7, false, 'fenêtre 1, essai 7 : non tracé');
    aller(T0 + 10 * MIN);
    await bloque(A, 8, false, 'fenêtre 1, à dix minutes : non tracé');
    aller(T0 + FENETRE);
    await bloque(A, 9, false, 'fenêtre 1, à quinze minutes pile : encore bloqué, non tracé');
    aller(T0 + FENETRE + 1);
    for (let i = 1; i <= SEUIL; i += 1) await refuse(A, i, `fenêtre 2, essai ${i}`);
    await bloque(A, 6, true, 'fenêtre 2, essai 6 : premier blocage de la fenêtre, tracé');
    await bloque(A, 7, false, 'fenêtre 2, essai 7 : non tracé');
    aller(T0 + FENETRE + 1 + 5 * MIN);
    await bloque(A, 8, false, 'fenêtre 2, cinq minutes plus tard : non tracé');
    assert.deepEqual(lignes.filter((l) => l.includes('Trop de tentatives')), [ligneBlocage(A), ligneBlocage(A)], 'une ligne par fenêtre');
    assert.equal(lignes.filter((l) => l.includes('REFUSÉE')).length, 2 * SEUIL, 'tous les refus sont tracés');
  });
});

describe('#608 et #614 : erreur après un bon jeton tracée avec l’adresse, sans son détail ; fenêtre comptée sur l’horloge monotone après un recul de l’horloge du système', () => {
  beforeEach(() => {
    essaisSecours.clear();
    lignes = [];
    for (const methode of ['log', 'info', 'warn', 'error', 'debug']) {
      mock.method(console, methode, (...args) => {
        const texte = format(...args);
        if (!AVERTISSEMENT_NODE.test(texte)) lignes.push(`${methode} ${texte}`);
      });
    }
    monotone = M0;
    mock.timers.enable({ apis: ['Date'], now: T0 });
    mock.method(performance, 'now', () => monotone);
  });
  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
    essaisSecours.clear();
  });

  // Cadrage du lot #607 et #608, point 2 : « dans le `catch`, une ligne […] depuis ${ip}, sans le message ni la pile de
  // l'erreur (qui pourraient contenir une adresse de base ou un extrait de requête). Le 500 et son corps ne changent
  // pas » ; v2, N1 (texte retenu, choix par défaut, à confirmer) ; v2, N2 : « bon jeton depuis une adresse neuve, 500, une
  // ligne, sans `iris_injoignable` ni `127.0.0.1:1` » ; v2, T1 : « l'entrée de l'adresse reste après un 500 (pas de
  // remise à zéro du compteur) ». Cinq bons jetons depuis A, adresse neuve, répondent chacun 500 avec une seule ligne ; la
  // fenêtre reste celle du premier essai ; le sixième, bon jeton encore, est bloqué (429, ligne « Trop de tentatives ») :
  // chaque essai suivi d'une erreur compte. Lectures écartées : aucune trace (comportement d'avant #608) ; une trace sans
  // l'adresse ; le message ou la pile de l'erreur recopiés dans la trace (celle de Prisma cite l'adresse de la base) ; une
  // trace sous un autre niveau que les autres lignes `[SECOURS]` d'un essai (`warn`) ; l'entrée de l'adresse retirée ou
  // remise à zéro sur un 500, sous laquelle une panne de la base laisserait essayer le secret sans limite.
  test('#608 : bon jeton suivi d’une erreur à l’ouverture de la session : 500 au corps inchangé, une seule ligne « Jeton valide mais erreur … depuis <ip>. », sans le détail de l’erreur ; l’essai reste compté, et le sixième est bloqué', async () => {
    assert.equal(essaisSecours.get(A), undefined, 'adresse neuve');
    for (let i = 1; i <= SEUIL; i += 1) {
      const r = await essai(A, { token: JETON_SECOURS });
      assert.deepEqual(r, { statut: 500, corps: ERREUR, lignes: [ligneErreur(A)], compte: i }, `bon jeton ${i} : 500, une ligne, essai compté`);
      assert.equal(essaisSecours.get(A).depuis, M0, `bon jeton ${i} : la fenêtre reste celle du premier essai`);
    }
    await bloque(A, SEUIL + 1, true, 'sixième essai, bon jeton : bloqué, tracé', { token: JETON_SECOURS });
    assert.deepEqual(lignes, [...Array(SEUIL).fill(ligneErreur(A)), ligneBlocage(A)], 'cinq erreurs et un blocage tracés, rien d’autre');
    // Rien de l'erreur dans les journaux : ni l'adresse de la base, ni ses identifiants, ni le message de Prisma, ni le
    // secret présenté.
    for (const ligne of lignes) {
      for (const fragment of ['iris_injoignable', '127.0.0.1:1', 'iris:iris', 'postgresql://', 'prisma', "can't reach", 'database', JETON_SECOURS.toLowerCase()]) {
        assert.ok(!ligne.toLowerCase().includes(fragment), `« ${fragment} » recopié dans la trace : ${ligne}`);
      }
    }
  });

  // Une autre adresse : sa ligne d'erreur porte la sienne, et l'erreur de A ne bloque ni ne compte pour elle. Lecture
  // écartée : une adresse figée dans la trace, ou un compteur commun aux essais suivis d'une erreur.
  test('#608 : l’erreur d’une autre adresse est tracée avec son adresse, et compte pour elle seule', async () => {
    const r1 = await essai(A, { token: JETON_SECOURS });
    assert.deepEqual(r1, { statut: 500, corps: ERREUR, lignes: [ligneErreur(A)], compte: 1 }, 'A');
    const r2 = await essai(B, { token: JETON_SECOURS });
    assert.deepEqual(r2, { statut: 500, corps: ERREUR, lignes: [ligneErreur(B)], compte: 1 }, 'B');
    await refuse(A, 2, 'A, jeton faux : refus tracé, compte de A seul');
    assert.equal(essaisSecours.get(B).count, 1, 'B garde son compte');
  });

  // Lot #614 (cadrage v2, C1 : test de #607 réécrit, attendu inversé ; choix par défaut, à confirmer) : la fenêtre se
  // compte sur l'horloge monotone, qu'un recul de l'horloge du système ne déplace pas. Après un recul d'une heure,
  // l'adresse bloquée le reste (429), sans nouvelle ligne, jusqu'à quinze minutes de temps écoulé depuis son premier
  // essai ; une milliseconde après, la fenêtre suivante s'ouvre : cinq refus tracés, puis une nouvelle ligne « Trop de
  // tentatives » à son premier blocage. Lectures écartées : la règle de #607 (code de `main`, ou variante de l'issue :
  // passée si l'horloge du système la date dans le futur), sous laquelle A repartirait de zéro dès le premier essai après
  // le recul (401 tracé au lieu de 429) ; fenêtre comptée sur l'horloge du système seule (`Date.now()`), sous laquelle A
  // resterait bloquée une heure et quart de temps écoulé ; une ligne de blocage reprise après le recul, dans la même
  // fenêtre.
  test('#614 : après un recul d’une heure de l’horloge du système, une adresse bloquée le reste, sans nouvelle ligne, jusqu’à quinze minutes de l’horloge monotone depuis son premier essai ; la fenêtre suivante a cinq refus tracés, puis une nouvelle ligne « Trop de tentatives » au premier blocage', async () => {
    for (let i = 1; i <= SEUIL; i += 1) await refuse(A, i, `fenêtre 1, essai ${i}`);
    await bloque(A, SEUIL + 1, true, 'fenêtre 1, essai 6 : tracé');
    await bloque(A, SEUIL + 2, false, 'fenêtre 1, essai 7 : non tracé');
    const recul = T0 - HEURE;
    regler(recul); // l'horloge du système recule d'une heure, sans temps écoulé
    await bloque(A, SEUIL + 3, false, 'après le recul : toujours bloquée, non tracé');
    aller(recul + FENETRE);
    await bloque(A, SEUIL + 4, false, 'à quinze minutes pile de temps écoulé : encore bloquée, non tracé');
    aller(recul + FENETRE + 1);
    for (let i = 1; i <= SEUIL; i += 1) await refuse(A, i, `fenêtre 2, essai ${i}`);
    assert.equal(essaisSecours.get(A).depuis, M0 + FENETRE + 1, 'la fenêtre 2 court depuis son premier essai, sur l’horloge monotone');
    await bloque(A, SEUIL + 1, true, 'fenêtre 2, essai 6 : premier blocage de la fenêtre, tracé');
    await bloque(A, SEUIL + 2, false, 'fenêtre 2, essai 7 : non tracé');
    assert.deepEqual(lignes.filter((l) => l.includes('Trop de tentatives')), [ligneBlocage(A), ligneBlocage(A)], 'une ligne par fenêtre');
    assert.equal(lignes.filter((l) => l.includes('REFUSÉE')).length, 2 * SEUIL, 'tous les refus sont tracés');
  });
});
