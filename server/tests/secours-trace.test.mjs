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
// 127.0.0.1, tient le rôle du proxy) : le test choisit ainsi l'adresse de chaque essai. L'horloge est simulée par
// `mock.timers` (`Date` seulement) pour la fenêtre suivante ; la table des essais est vidée avant et après chaque test.
// Le succès et le compte absent, qui lisent la base, sont prouvés dans api.test.mjs (bloc « Trace de l’accès de secours
// (#589) ») ; la preuve HTTP en processus séparé, derrière deux proxys, est dans trust-proxy.test.mjs.
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
const FENETRE = 15 * MIN;
const T0 = Date.UTC(2026, 10, 19, 9); // 19-11-2026, 9 h UTC
const A = '198.51.100.11';
const B = '198.51.100.22';
const C = '198.51.100.33';
const aller = (instant) => mock.timers.setTime(instant);

// Réponses et lignes exactes (routes d'authentification ; texte de la ligne de blocage inchangé, v2, N1).
const REFUS = { error: 'Jeton de secours invalide.' };
const BLOCAGE = { error: 'Trop de tentatives. Réessayez dans quinze minutes.' };
const ligneRefus = (ip) => `warn [SECOURS] Tentative d'accès de secours REFUSÉE depuis ${ip}.`;
const ligneBlocage = (ip) => `warn [SECOURS] Trop de tentatives depuis ${ip} — blocage temporaire.`;

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
    mock.timers.enable({ apis: ['Date'], now: T0 });
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
