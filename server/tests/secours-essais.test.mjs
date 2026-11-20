// Lot #563, « compteur d'essais de l'accès de secours purgé et borné » (cadrage v2 du controleur-coherence, `main` à
// 289dc67 ; issue `suivi-audit` #563, note N3 de l'audit des droits de #562 ; message de Nelson du 17-11-2026, « Ok
// continu »). Parcours de sécurité de la connexion (règle 2 de la méthode).
//
// Avant ce lot, la table en mémoire des essais (`essaisSecours`, une entrée par adresse cliente) ne perdait une entrée
// que sur un accès de secours réussi : une fenêtre passée restait en table et chaque adresse distincte en ajoutait une,
// sans limite (mémoire consommée à volonté de l'extérieur depuis TRUST_PROXY, #261). Le cadrage fixe :
//   - une purge au fil des essais, avant la lecture de l'entrée de l'adresse, qui s'arrête à la première fenêtre encore
//     ouverte : la table garde l'ordre d'ouverture des fenêtres, chaque entrée n'est visitée qu'une fois, sans parcours
//     complet à chaque essai ;
//   - une seule règle pour le blocage et pour la purge : une fenêtre est passée quand plus de 15 minutes séparent
//     l'instant présent du premier essai de la fenêtre (comparaison stricte). Depuis le lot #614, ces quinze minutes se
//     comptent sur l'horloge monotone du processus (`performance.now()`), que ne déplace aucun réglage de l'horloge du
//     système (choix par défaut, à confirmer ; il remplace celui de #607, qui tenait pour passée une fenêtre datée dans
//     le futur par l'horloge du système) ;
//   - une borne dure, BREAK_GLASS_MAX_ADRESSES = 10 000 (choix par défaut, à confirmer) : table pleine, après la purge,
//     une adresse nouvelle fait sortir la fenêtre la plus ancienne, puis elle est admise, jamais refusée ;
//   - le blocage inchangé en deçà de la borne : 5 essais par adresse et par fenêtre, le 6e refusé ; accès inactif : 503
//     avant tout comptage.
//
// Lot #614, « fenêtre des essais comptée sur l'horloge monotone » (cadrage v2 du controleur-coherence, `main` à
// 6b98e34 ; issue `suivi-audit` #614, note N1 de l'audit des droits de #612, T1 et N1 de son contrôle de cohérence ;
// messages de Nelson des 16 et 20-11-2026, « continu avec les issu. » et « Ordre : fait les correctif d'issu d'abord »).
// Avant ce lot, `depuis` était relevé par `Date.now()`, qui suit l'horloge du système : une fenêtre datée dans le futur
// par un recul était tenue pour passée (#607), mais un recul plus court que l'âge de la fenêtre, ou que l'horloge
// rattrapait sans essai, la prolongeait jusqu'à la durée du recul (limites épinglées par #612). Sept tests sont
// réécrits ou changent d'attendu (cadrage v2, C1) : un réglage de l'horloge du système, en arrière comme en avant, ne
// change ni l'ordre de la table, ni les comptes, ni l'instant de libération ; un test nouveau prouve qu'un saut en avant
// ne raccourcit pas la fenêtre, et un parcours long mêle des réglages aux essais. Les autres tests gardent leurs
// attendus. Le contrôle par entrée (R1 de #591) est gardé, redondant tant que l'horloge est monotone (C3) : son retrait,
// comme le maintien de `maintenant < depuis`, est un mutant équivalent, qu'aucun test ne peut tuer.
//
// Tests sans base. Deux horloges sont simulées (lot #614, cadrage v2, C1) : celle du système par `mock.timers` sur
// `Date` seulement (Node 20.11 au moins, comme api.test.mjs), et l'horloge monotone du processus par
// `mock.method(performance, 'now', …)`, que `mock.timers` ne pilote pas, d'une autre origine (cinq heures depuis le
// démarrage du processus, comme cles-microsoft.test.mjs), restaurée après chaque test. `aller` fait s'écouler le temps :
// les deux horloges avancent du même écart ; `regler` déplace l'horloge du système seule, en arrière ou en avant
// (correction NTP). Les instants d'ouverture des fenêtres (`depuis`) sont lus sur l'horloge monotone simulée. La table
// est vidée avant et après chaque test. La remise à zéro par un accès réussi est prouvée par la route, dans le bloc
// « Accès de secours » d'api.test.mjs (test T2 du cadrage).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test, { afterEach, beforeEach, describe, mock } from 'node:test';

// Accès de secours inactif pour ce fichier (dernier test) : posées vides avant le chargement du module, ces variables ne
// sont pas remplacées par un server/.env du poste (dotenv ne remplace pas une variable déjà posée, même vide). Le
// compteur, lui, ne dépend pas de ce réglage.
process.env.BREAK_GLASS_EMAIL = '';
process.env.BREAK_GLASS_TOKEN = '';

const require = createRequire(import.meta.url);
const { BREAK_GLASS_MAX_ADRESSES, essaisSecours, tropDEssaisSecours } = require('../dist/src/domaines/authentification/secours.js');

const BORNE = 10_000; // valeur du cadrage, écrite dans docs/ACCES-SANS-MICROSOFT.md (« au plus 10 000 adresses »)
const SEUIL = 5; // essais admis par adresse et par fenêtre
const MIN = 60_000;
const HEURE = 60 * MIN;
const FENETRE = 15 * MIN;
const T0 = Date.UTC(2026, 10, 17, 8); // horloge du système au début de chaque test : 17-11-2026, 8 h UTC
// Horloge monotone au début de chaque test (lot #614) : une autre origine que l'horloge du système, si bien qu'un
// `depuis` relevé sur la mauvaise horloge, ou comparé à l'autre, se voit aussitôt.
const M0 = 5 * HEURE;
let monotone = M0;
const A = '198.51.100.10';
const B = '198.51.100.20';
const C = '198.51.100.30';
const D = '198.51.100.40';
const ipv6 = (i) => `2001:db8::${i.toString(16)}`;

// Le temps s'écoule jusqu'à l'instant `instant` de l'horloge du système : les deux horloges avancent du même écart. Le
// temps écoulé ne recule jamais : un réglage de l'horloge du système passe par `regler`.
const aller = (instant) => {
  const ecart = instant - Date.now();
  assert.ok(ecart >= 0, `aller : le temps écoulé ne recule pas (écart de ${ecart} ms) ; un réglage de l’horloge passe par regler`);
  monotone += ecart;
  mock.timers.setTime(instant);
};
// Réglage de l'horloge du système seule (correction NTP, en arrière ou en avant), sans temps écoulé : l'horloge monotone
// ne bouge pas.
const regler = (instant) => mock.timers.setTime(instant);
const essais = (ip, n) => Array.from({ length: n }, () => tropDEssaisSecours(ip));
// État de la table, lu par les méthodes de Map elles-mêmes (et non par celles de l'instance, enveloppées par les tests
// du coût).
const suivi = (ip) => {
  const s = Map.prototype.get.call(essaisSecours, ip);
  return s && { count: s.count, depuis: s.depuis };
};
const adresses = () => [...Map.prototype.keys.call(essaisSecours)];
const table = () => [...Map.prototype.entries.call(essaisSecours)].map(([ip, s]) => [ip, s.count, s.depuis]);

describe('#563 : compteur des essais de l’accès de secours, purgé au fil des essais et borné', () => {
  beforeEach(() => {
    essaisSecours.clear();
    monotone = M0;
    mock.timers.enable({ apis: ['Date'], now: T0 });
    mock.method(performance, 'now', () => monotone);
  });
  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
    essaisSecours.clear();
  });

  // --- Blocage inchangé ---

  // Cadrage, « Comportement inchangé » et critère « Le blocage reste identique » : « 5 essais admis, le 6e refusé dans
  // la fenêtre ; encore refusé à 15 minutes pile ; un nouvel essai est admis une milliseconde après la fenêtre ».
  // Lectures écartées : comparaison large (`>=`), sous laquelle l'essai à 15 minutes pile ouvrirait une nouvelle fenêtre
  // (admis) ; seuil de 6, sous lequel le sixième essai serait admis ; fenêtre repoussée à chaque essai, sous laquelle
  // l'essai d'une milliseconde après resterait refusé.
  test('blocage inchangé : cinq essais admis, le sixième refusé ; encore refusé à quinze minutes pile du premier essai ; une milliseconde après, une nouvelle fenêtre de cinq essais s’ouvre', () => {
    assert.deepEqual(essais(A, 6), [false, false, false, false, false, true]);
    assert.deepEqual(suivi(A), { count: 6, depuis: M0 });
    aller(T0 + FENETRE);
    assert.equal(tropDEssaisSecours(A), true, 'à quinze minutes pile, la fenêtre est encore ouverte');
    assert.equal(suivi(A).depuis, M0, 'un essai refusé ne repousse pas la fenêtre');
    aller(T0 + FENETRE + 1);
    assert.equal(tropDEssaisSecours(A), false, 'une milliseconde après, la fenêtre est passée');
    assert.deepEqual(suivi(A), { count: 1, depuis: M0 + FENETRE + 1 });
    assert.deepEqual(essais(A, 5), [false, false, false, false, true], 'nouvelle fenêtre : quatre essais de plus admis, le sixième refusé');
    assert.deepEqual(adresses(), [A]);
  });

  // Cadrage : « une fenêtre est passée quand plus de 15 minutes séparent l'instant présent du premier essai de la
  // fenêtre ». Lecture écartée : fenêtre comptée depuis le dernier essai, sous laquelle le sixième essai, une minute et
  // une milliseconde après le cinquième, serait refusé.
  test('la fenêtre court depuis le premier essai, et non depuis le dernier : des essais espacés ne la prolongent pas', () => {
    for (const minutes of [0, 5, 10, 14]) {
      aller(T0 + minutes * MIN);
      assert.equal(tropDEssaisSecours(A), false, `essai à ${minutes} min`);
    }
    aller(T0 + FENETRE);
    assert.equal(tropDEssaisSecours(A), false, 'cinquième essai, à quinze minutes pile : dans la fenêtre');
    assert.deepEqual(suivi(A), { count: 5, depuis: M0 });
    aller(T0 + FENETRE + 1);
    assert.equal(tropDEssaisSecours(A), false, 'la fenêtre ouverte au premier essai est passée : nouvelle fenêtre');
    assert.deepEqual(suivi(A), { count: 1, depuis: M0 + FENETRE + 1 });
  });

  // --- Réglages de l'horloge du système (lot #614) ---

  // Audit des droits de #591, R1 (« un recul ne change ni l'ordre, ni les comptes, ni l'instant de libération »),
  // réécrit par le lot #614 (cadrage v2, C1) : la fenêtre se compte sur l'horloge monotone, qu'un recul de l'horloge du
  // système ne déplace pas. D s'ouvre dix minutes avant A ; l'horloge du système recule de cinq minutes ; deux minutes
  // plus tard, B (bloquée) et C s'ouvrent. Chaque fenêtre passe à quinze minutes de temps écoulé depuis son premier
  // essai, qu'elle soit ouverte avant le recul (D, A) ou après (B, C), et la table reste rangée par ordre d'ouverture.
  // Lectures écartées : fenêtre comptée sur l'horloge du système (code de `main`, ou `Date.now()` seule), sous laquelle
  // D, ouverte avant le recul, resterait en table jusqu'à vingt minutes de temps écoulé ; comparaison large (`>=`), sous
  // laquelle A sortirait et B serait libérée à quinze minutes pile ; essais cumulés d'une fenêtre à l'autre, sous
  // lesquels C serait refusée au sixième essai de deux fenêtres.
  test('#614 : l’horloge du système recule de cinq minutes : rien ne change, ni l’ordre de la table, ni les comptes, ni l’instant de libération ; chaque fenêtre, ouverte avant le recul ou après, passe à quinze minutes de l’horloge monotone ; les essais ne se cumulent pas d’une fenêtre à l’autre', () => {
    tropDEssaisSecours(D);
    aller(T0 + 10 * MIN);
    tropDEssaisSecours(A);
    regler(T0 + 5 * MIN); // l'horloge du système recule de cinq minutes, sans temps écoulé
    aller(T0 + 7 * MIN); // deux minutes de temps écoulé après le recul
    assert.deepEqual(essais(B, 6), [false, false, false, false, false, true]);
    essais(C, 3);
    assert.deepEqual(adresses(), [D, A, B, C], 'ordre d’ouverture');
    aller(T0 + 10 * MIN + 1); // quinze minutes et une milliseconde de temps écoulé depuis D
    assert.equal(tropDEssaisSecours(B), true, 'B reste bloquée');
    assert.deepEqual(adresses(), [A, B, C], 'D, ouverte avant le recul, passe à quinze minutes de temps écoulé, et non vingt ; A, ouverte, arrête la purge');
    aller(T0 + 20 * MIN); // quinze minutes pile de temps écoulé depuis A
    assert.equal(tropDEssaisSecours(B), true, 'B reste bloquée');
    assert.deepEqual(adresses(), [A, B, C], 'à quinze minutes pile, A est encore en table');
    aller(T0 + 20 * MIN + 1);
    assert.equal(tropDEssaisSecours(B), true, 'B, ouverte deux minutes après A, reste bloquée');
    assert.deepEqual(adresses(), [B, C], 'A, ouverte avant le recul, passe à quinze minutes de temps écoulé');
    aller(T0 + 22 * MIN); // quinze minutes pile de temps écoulé depuis le premier essai de B
    assert.equal(tropDEssaisSecours(B), true, 'à quinze minutes pile du premier essai de B, B reste bloquée');
    aller(T0 + 22 * MIN + 1);
    assert.equal(tropDEssaisSecours(B), false, 'une milliseconde après, B repart de zéro');
    assert.deepEqual(essais(C, 3), [false, false, false], 'C : nouvelle fenêtre, ses trois premiers essais ne comptent plus');
    assert.deepEqual(adresses(), [B, C], 'B et C, rouvertes, en fin de table, dans l’ordre de leur réouverture');
    assert.deepEqual(suivi(B), { count: 1, depuis: M0 + 27 * MIN + 1 }, 'vingt-sept minutes et une milliseconde de temps écoulé');
    assert.deepEqual(suivi(C), { count: 3, depuis: M0 + 27 * MIN + 1 });
  });

  // Lot #614 (cadrage v2, C1 : test de #607 dont l'attendu est inversé ; choix par défaut, à confirmer) : après un recul
  // d'une heure de l'horloge du système, la fenêtre d'une adresse bloquée, datée dans le futur par cette horloge, reste
  // ouverte jusqu'à quinze minutes de l'horloge monotone depuis son premier essai. Lectures écartées : la règle de #607
  // (code de `main`, ou variante de l'issue : passée si l'horloge du système la date dans le futur), sous laquelle A
  // repartirait de zéro dès le premier essai après le recul ; fenêtre comptée sur l'horloge du système seule
  // (`Date.now()` sans la règle de #607), sous laquelle A resterait bloquée une heure et quart de temps écoulé.
  test('#614 : après un recul d’une heure de l’horloge du système, une adresse bloquée le reste jusqu’à quinze minutes de l’horloge monotone depuis son premier essai ; une milliseconde après, une nouvelle fenêtre de cinq essais s’ouvre', () => {
    assert.deepEqual(essais(A, 6), [false, false, false, false, false, true]);
    const recul = T0 - HEURE;
    regler(recul); // l'horloge du système recule d'une heure, sans temps écoulé
    assert.equal(tropDEssaisSecours(A), true, 'juste après le recul : toujours bloquée');
    aller(recul + FENETRE);
    assert.equal(tropDEssaisSecours(A), true, 'à quinze minutes pile de temps écoulé : encore bloquée');
    aller(recul + FENETRE + 1);
    assert.equal(tropDEssaisSecours(A), false, 'une milliseconde après : la fenêtre est passée, et non une heure plus tard');
    assert.deepEqual(essais(A, 5), [false, false, false, false, true], 'nouvelle fenêtre de cinq essais');
    assert.deepEqual(suivi(A), { count: 6, depuis: M0 + FENETRE + 1 });
  });

  // Lot #614 (cadrage v2, C1 : test de #607 dont l'attendu est inversé) : le recul, de cinq minutes, date dans le futur
  // les fenêtres de A (bloquée) et de B ; D, ouverte dix minutes avant A, est encore ouverte en tête de table. A reste
  // bloquée à sa place, et la table garde l'ordre d'ouverture : A passe à quinze minutes de temps écoulé depuis son premier
  // essai, puis repart en fin de table, derrière B encore ouverte. Lectures écartées : la règle de #607 (code de `main`,
  // ou variante de l'issue), sous laquelle A repartirait de zéro, en fin de table, dès le premier essai après le recul ;
  // fenêtre comptée sur l'horloge du système seule, sous laquelle A resterait bloquée vingt minutes de temps écoulé ;
  // comparaison large, sous laquelle A serait libérée à quinze minutes pile.
  test('#614 : après un recul de cinq minutes, une adresse bloquée dont la fenêtre est datée dans le futur par l’horloge du système reste bloquée, à sa place dans la table, derrière une fenêtre encore ouverte, jusqu’à quinze minutes de l’horloge monotone', () => {
    tropDEssaisSecours(D);
    aller(T0 + 10 * MIN);
    assert.deepEqual(essais(A, 6), [false, false, false, false, false, true]);
    aller(T0 + 10 * MIN + 1);
    tropDEssaisSecours(B);
    regler(T0 + 5 * MIN + 1); // l'horloge du système recule de cinq minutes, sans temps écoulé
    assert.equal(tropDEssaisSecours(A), true, 'fenêtre de A datée dans le futur par l’horloge du système : toujours bloquée');
    assert.deepEqual(adresses(), [D, A, B], 'A reste à sa place, derrière D encore ouverte');
    aller(T0 + 20 * MIN); // quinze minutes pile de temps écoulé depuis le premier essai de A
    assert.equal(tropDEssaisSecours(A), true, 'à quinze minutes pile : encore bloquée');
    assert.deepEqual(adresses(), [A, B], 'D, passée, est purgée ; A, ouverte, arrête la purge');
    aller(T0 + 20 * MIN + 1);
    assert.equal(tropDEssaisSecours(A), false, 'une milliseconde après : A repart de zéro');
    assert.deepEqual(adresses(), [B, A], 'A repart en fin de table, derrière B encore ouverte');
    assert.deepEqual(suivi(A), { count: 1, depuis: M0 + 25 * MIN + 1 });
    assert.deepEqual(suivi(B), { count: 1, depuis: M0 + 10 * MIN + 1 }, 'B garde son compte');
  });

  // Lot #614 (cadrage v2, C1 : test de #607 dont l'attendu est inversé ; « la purge ne retire plus une fenêtre
  // ouverte ») : après un recul d'une heure, la purge ne retire pas les fenêtres datées dans le futur par l'horloge du
  // système tant qu'elles sont ouvertes sur l'horloge monotone ; elle les retire à leur terme, en tête de table. Lectures
  // écartées : la règle de #607 (code de `main`, ou variante de l'issue), sous laquelle la purge retirerait A, B et C dès
  // l'essai de D, et B, bloquée, repartirait de zéro ; fenêtre comptée sur l'horloge du système seule, sous laquelle la
  // purge garderait A une heure et quart de temps écoulé ; comparaison large, sous laquelle B, à quinze minutes pile,
  // serait purgée.
  test('#614 : après un recul d’une heure, la purge ne retire pas les fenêtres datées dans le futur par l’horloge du système tant qu’elles sont ouvertes ; elle les retire à quinze minutes de l’horloge monotone, en tête de table', () => {
    essais(A, 2);
    aller(T0 + 1);
    essais(B, 6);
    aller(T0 + 2);
    tropDEssaisSecours(C);
    regler(T0 + 2 - HEURE); // l'horloge du système recule d'une heure, sans temps écoulé
    assert.equal(tropDEssaisSecours(D), false);
    assert.deepEqual(adresses(), [A, B, C, D], 'aucune fenêtre ouverte n’est purgée');
    assert.equal(tropDEssaisSecours(B), true, 'B reste bloquée');
    aller(T0 - HEURE + FENETRE + 1); // quinze minutes et une milliseconde de temps écoulé depuis A
    assert.equal(tropDEssaisSecours(D), false);
    assert.deepEqual(adresses(), [B, C, D], 'A, passée, est purgée ; B, à quinze minutes pile, arrête la purge');
    assert.equal(tropDEssaisSecours(B), true, 'à quinze minutes pile, B reste bloquée');
    assert.deepEqual(table(), [[B, 8, M0 + 1], [C, 1, M0 + 2], [D, 2, M0 + 2]]);
  });

  // Lot #614 (cadrage v2, C1 : limite de #612 levée, attendu changé) : un recul de cinq minutes, dix minutes après le
  // premier essai, ne date pas la fenêtre dans le futur ; elle passe à quinze minutes de temps écoulé. Lecture écartée :
  // fenêtre comptée sur l'horloge du système (code de `main`, ou `Date.now()` seule), sous laquelle le blocage durerait
  // vingt minutes de temps écoulé (limite épinglée par #612).
  test('#614 : un recul de cinq minutes de l’horloge du système, plus court que l’âge de la fenêtre, ne la prolonge pas : l’adresse est libérée à quinze minutes de l’horloge monotone depuis son premier essai', () => {
    assert.deepEqual(essais(A, 6), [false, false, false, false, false, true]);
    aller(T0 + 10 * MIN);
    regler(T0 + 5 * MIN); // l'horloge du système recule de cinq minutes, dix minutes après le premier essai
    assert.equal(tropDEssaisSecours(A), true, 'après le recul : toujours bloquée');
    aller(T0 + 10 * MIN); // quinze minutes pile de temps écoulé depuis le premier essai
    assert.equal(tropDEssaisSecours(A), true, 'à quinze minutes pile de temps écoulé : encore bloquée');
    aller(T0 + 10 * MIN + 1);
    assert.equal(tropDEssaisSecours(A), false, 'une milliseconde après : libérée, et non cinq minutes plus tard');
    assert.deepEqual(suivi(A), { count: 1, depuis: M0 + FENETRE + 1 });
  });

  // Lot #614 (cadrage v2, C1 : limite de #612 levée, attendu changé ; « le test fait son premier essai après le
  // rattrapage de l'horloge, 1 h 01 ou plus ») : l'horloge du système recule d'une heure une minute après le premier
  // essai, et aucun essai n'a lieu pendant l'heure qui suit. Au premier essai, l'horloge du système a rattrapé
  // l'ouverture de la fenêtre (une minute plus tard sur elle), mais une heure et une minute de temps se sont écoulées :
  // la fenêtre est passée, une nouvelle s'ouvre. Lecture écartée : fenêtre comptée sur l'horloge du système (code de
  // `main`, ou `Date.now()` seule), sous laquelle A serait encore bloquée (429 à 1 h 01 de temps écoulé, libération à
  // 1 h 15, limite épinglée par #612).
  test('#614 : recul d’une heure de l’horloge du système sans essai pendant ce temps : au premier essai, après que l’horloge a rattrapé l’ouverture de la fenêtre, une heure et une minute de temps écoulé après le premier, la fenêtre est passée ; une nouvelle fenêtre de cinq essais s’ouvre', () => {
    assert.deepEqual(essais(A, 6), [false, false, false, false, false, true]);
    aller(T0 + MIN);
    regler(T0 - 59 * MIN); // recul d'une heure ; aucun essai pendant l'heure qui suit
    aller(T0 + MIN); // l'horloge du système a rattrapé l'ouverture de la fenêtre : une heure et une minute de temps écoulé
    assert.equal(tropDEssaisSecours(A), false, 'la fenêtre est passée : une nouvelle s’ouvre');
    assert.deepEqual(essais(A, 5), [false, false, false, false, true], 'nouvelle fenêtre de cinq essais');
    aller(T0 + MIN + FENETRE);
    assert.equal(tropDEssaisSecours(A), true, 'la nouvelle fenêtre court quinze minutes depuis son premier essai');
    aller(T0 + MIN + FENETRE + 1);
    assert.equal(tropDEssaisSecours(A), false, 'une milliseconde après, elle est passée');
    assert.deepEqual(suivi(A), { count: 1, depuis: M0 + HEURE + MIN + FENETRE + 1 });
  });

  // Lot #614 (cadrage v2, C1 ; « Tests attendus » : « saut en avant de l'horloge du système → la fenêtre ne raccourcit
  // pas » ; N4 : plus restrictif qu'avant) : l'horloge du système avance d'une heure, une minute après le premier essai.
  // A reste bloquée, et en table, jusqu'à quinze minutes de temps écoulé ; B, ouverte une minute après A, n'est pas
  // purgée. Lectures écartées : fenêtre comptée sur l'horloge du système, seule (`Date.now()`, code de `main`) ou avec
  // l'horloge monotone (variante de l'issue : passée si l'une des deux horloges dépasse quinze minutes), sous laquelle
  // A serait libérée, et purgée avec B, dès le premier essai après le saut.
  test('#614 : saut en avant d’une heure de l’horloge du système : la fenêtre ne raccourcit pas ; l’adresse reste bloquée, et en table, jusqu’à quinze minutes de l’horloge monotone depuis son premier essai', () => {
    assert.deepEqual(essais(A, 6), [false, false, false, false, false, true]);
    aller(T0 + MIN);
    tropDEssaisSecours(B);
    regler(T0 + MIN + HEURE); // l'horloge du système avance d'une heure, sans temps écoulé
    assert.equal(tropDEssaisSecours(A), true, 'après le saut : toujours bloquée');
    tropDEssaisSecours(C);
    assert.deepEqual(adresses(), [A, B, C], 'la purge ne retire ni A ni B, encore ouvertes');
    aller(T0 + HEURE + FENETRE); // quinze minutes pile de temps écoulé depuis le premier essai de A
    assert.equal(tropDEssaisSecours(A), true, 'à quinze minutes pile de temps écoulé : encore bloquée');
    aller(T0 + HEURE + FENETRE + 1);
    assert.equal(tropDEssaisSecours(A), false, 'une milliseconde après : libérée');
    assert.deepEqual(adresses(), [B, C, A], 'A repart en fin de table ; B, ouverte une minute après A, reste');
    assert.deepEqual(suivi(A), { count: 1, depuis: M0 + FENETRE + 1 });
    assert.deepEqual(suivi(B), { count: 1, depuis: M0 + MIN });
  });

  // --- Purge au fil des essais ---

  // Critère : « Une adresse dont le premier essai date de plus de 15 minutes n'est plus dans la table dès l'essai
  // suivant d'une autre adresse ». Avant le lot (purge absente), A restait en table jusqu'à son prochain essai.
  test('purge : une fenêtre passée sort de la table au premier essai d’une autre adresse ; une fenêtre encore ouverte y reste avec son compte', () => {
    essais(A, 3);
    aller(T0 + 2 * MIN);
    essais(B, 2);
    aller(T0 + FENETRE + 1);
    assert.equal(tropDEssaisSecours(C), false);
    assert.deepEqual(adresses(), [B, C], 'A, passée, est retirée ; B, ouverte, reste');
    assert.deepEqual(suivi(B), { count: 2, depuis: M0 + 2 * MIN });
    aller(T0 + 2 * MIN + FENETRE + 1);
    assert.equal(tropDEssaisSecours(C), false);
    assert.deepEqual(adresses(), [C], 'B, passée à son tour, est retirée');
    assert.deepEqual(suivi(C), { count: 2, depuis: M0 + FENETRE + 1 });
  });

  // Critère : « À 15 minutes pile, sa fenêtre est encore ouverte : elle reste en table, avec son compte ». Lectures
  // écartées : purge en comparaison large (`>=`), qui retirerait A à quinze minutes pile ; purge qui retirerait aussi
  // les fenêtres encore ouvertes, qui retirerait A dès l'essai de B.
  test('purge : à quinze minutes pile de son premier essai, une fenêtre est encore ouverte ; elle reste en table, avec son compte et son blocage', () => {
    assert.equal(essais(A, 6).at(-1), true);
    aller(T0 + 10 * MIN);
    tropDEssaisSecours(B);
    assert.deepEqual(adresses(), [A, B], 'une fenêtre ouverte n’est pas purgée');
    aller(T0 + FENETRE);
    tropDEssaisSecours(C);
    assert.deepEqual(adresses(), [A, B, C], 'à quinze minutes pile, A est encore en table');
    assert.deepEqual(suivi(A), { count: 6, depuis: M0 });
    assert.equal(tropDEssaisSecours(A), true, 'A reste bloqué');
    aller(T0 + FENETRE + 1);
    tropDEssaisSecours(C);
    assert.deepEqual(adresses(), [B, C]);
  });

  // Cadrage : « une entrée n'y entre qu'en fin, à l'ouverture de sa fenêtre (après la purge, une fenêtre passée de la
  // même adresse a déjà été retirée). Les fenêtres passées sont donc en tête ». Une adresse bloquée, revenue après sa
  // fenêtre, est retirée puis remise en fin de table, compte à 1 ; la fenêtre ouverte avant elle sort la première.
  test('une adresse bloquée revenue après sa fenêtre repart de zéro, en fin de table : la table reste rangée par ordre d’ouverture des fenêtres', () => {
    essais(A, 6);
    aller(T0 + MIN);
    tropDEssaisSecours(B);
    aller(T0 + FENETRE + 1);
    assert.equal(tropDEssaisSecours(A), false);
    assert.deepEqual(adresses(), [B, A]);
    assert.deepEqual(suivi(A), { count: 1, depuis: M0 + FENETRE + 1 });
    aller(T0 + MIN + FENETRE + 1);
    tropDEssaisSecours(D);
    assert.deepEqual(adresses(), [A, D], 'B, passée, est purgée ; A, rouverte après elle, reste');
  });

  // Règle du cadrage, écrite à part (modèle par parcours complet) : toutes les fenêtres passées retirées, cinq essais
  // par fenêtre ouverte au premier essai, une entrée nouvelle en fin de table. Depuis le lot #614, `maintenant` est lu
  // sur l'horloge monotone : le modèle ne connaît que le temps écoulé.
  const modeleDesEssais = () => {
    const modele = new Map();
    const essai = (ip, maintenant) => {
      for (const [cle, s] of [...modele]) if (maintenant - s.depuis > FENETRE) modele.delete(cle);
      const s = modele.get(ip);
      if (!s) {
        modele.set(ip, { count: 1, depuis: maintenant });
        return false;
      }
      s.count += 1;
      return s.count > SEUIL;
    };
    return { modele, essai };
  };

  // Critère : « Après chaque appel, la table ne contient aucune fenêtre passée (horloge qui ne recule pas) ». Après
  // chaque essai, la réponse et toute la table (adresses, comptes, premiers essais, ordre) sont comparées à la règle du
  // cadrage (modèle ci-dessus). Une adresse insistante (un essai sur trois, bloquée puis rouverte) et 37 autres, qui
  // reviennent toutes les cinq à six minutes.
  test('essais de 38 adresses étalés sur une heure et demie : après chaque essai, aucune fenêtre passée en table, fenêtres rangées par ordre d’ouverture, réponses conformes à la règle', () => {
    const { modele, essai: essaiModele } = modeleDesEssais();
    let refuses = 0;
    let rouvertures = 0;
    let insistanteBloquee = false;
    for (let i = 0; i < 600; i += 1) {
      const ecoule = i * 9_000 + (i % 7) * 1_000; // croissant : l'horloge ne recule pas
      aller(T0 + ecoule);
      const maintenant = M0 + ecoule; // horloge monotone (#614)
      const ip = i % 3 === 0 ? A : `203.0.113.${i % 37}`;
      const attendu = essaiModele(ip, maintenant);
      assert.equal(tropDEssaisSecours(ip), attendu, `essai ${i} (${ip})`);
      if (attendu) refuses += 1;
      if (ip === A) {
        if (insistanteBloquee && !attendu) rouvertures += 1;
        insistanteBloquee = attendu;
      }
      const etat = table();
      assert.deepEqual(etat.filter(([, , depuis]) => maintenant - depuis > FENETRE), [], `essai ${i} : fenêtre passée en table`);
      for (let k = 1; k < etat.length; k += 1) assert.ok(etat[k - 1][2] <= etat[k][2], `essai ${i} : table hors de l’ordre d’ouverture`);
      assert.deepEqual(etat, [...modele].map(([cle, s]) => [cle, s.count, s.depuis]), `essai ${i} : table`);
    }
    // Témoins du scénario : des essais ont été refusés, et l'adresse insistante a été rouverte après sa fenêtre.
    assert.ok(refuses > 0, `essais refusés : ${refuses}`);
    assert.ok(rouvertures > 0, `rouvertures de l’adresse insistante : ${rouvertures}`);
  });

  // Lot #614 (cadrage v2, C1 et C3) : même parcours, entrecoupé tous les quarante essais (six minutes environ) d'un
  // réglage de l'horloge du système, en arrière ou en avant, de trente secondes à trois heures. Après chaque essai, la
  // réponse et la table entière sont comparées au même modèle, tenu sur le seul temps écoulé, et la table reste rangée
  // par ordre d'ouverture : la purge en tête suffit (C3). Témoins du scénario, relevés sur le modèle : des essais refusés
  // alors que l'horloge du système datait l'ouverture de leur fenêtre dans le futur, ou la comptait à plus de quinze
  // minutes, et des fenêtres rouvertes alors qu'elle la comptait à quinze minutes au plus. Lectures écartées : fenêtre
  // comptée sur l'horloge du système, seule (`Date.now()`) ou avec l'horloge monotone (code de `main`, variante de
  // l'issue), sous laquelle la réponse à l'un de ces essais s'écarterait du modèle.
  test('#614 : 600 essais de 38 adresses entrecoupés de réglages de l’horloge du système en arrière et en avant : réponses et table conformes à la règle tenue sur le seul temps écoulé, table rangée par ordre d’ouverture', () => {
    const { modele, essai: essaiModele } = modeleDesEssais();
    const reglages = [-HEURE, 5 * MIN, -5 * MIN, HEURE, -30_000, 20 * MIN, -20 * MIN, 3 * HEURE, -3 * HEURE, 10 * MIN, -12 * MIN, 45 * MIN, -50 * MIN, 2 * MIN];
    const ouvertureSysteme = new Map(); // dernière ouverture de fenêtre de chaque adresse, sur l'horloge du système
    const temoins = { refusDatesDansLeFutur: 0, refusAuDelaDeQuinzeMinutesSysteme: 0, rouverturesEnDecaDeQuinzeMinutesSysteme: 0 };
    let decalage = 0; // avance cumulée de l'horloge du système sur le temps écoulé
    let ecoulePrecedent = 0;
    let nombreDeReglages = 0;
    for (let i = 0; i < 600; i += 1) {
      const ecoule = i * 9_000 + (i % 7) * 1_000; // temps écoulé, croissant
      if (i > 0 && i % 40 === 0) {
        decalage += reglages[i / 40 - 1];
        regler(T0 + ecoulePrecedent + decalage);
        nombreDeReglages += 1;
      }
      aller(T0 + ecoule + decalage);
      ecoulePrecedent = ecoule;
      const maintenant = M0 + ecoule; // horloge monotone
      const ip = i % 3 === 0 ? A : `203.0.113.${i % 37}`;
      // Âge, sur l'horloge du système, de la dernière fenêtre ouverte par l'adresse (encore ouverte ou non).
      const ageSysteme = ouvertureSysteme.has(ip) ? Date.now() - ouvertureSysteme.get(ip) : undefined;
      const attendu = essaiModele(ip, maintenant);
      assert.equal(tropDEssaisSecours(ip), attendu, `essai ${i} (${ip}), horloge du système décalée de ${decalage / MIN} min`);
      const nouvelle = modele.get(ip).count === 1;
      if (attendu && ageSysteme < 0) temoins.refusDatesDansLeFutur += 1;
      if (attendu && ageSysteme > FENETRE) temoins.refusAuDelaDeQuinzeMinutesSysteme += 1;
      if (nouvelle && ageSysteme >= 0 && ageSysteme <= FENETRE) temoins.rouverturesEnDecaDeQuinzeMinutesSysteme += 1;
      if (nouvelle) ouvertureSysteme.set(ip, Date.now());
      const etat = table();
      assert.deepEqual(etat.filter(([, , depuis]) => maintenant - depuis > FENETRE), [], `essai ${i} : fenêtre passée en table`);
      for (let k = 1; k < etat.length; k += 1) assert.ok(etat[k - 1][2] <= etat[k][2], `essai ${i} : table hors de l’ordre d’ouverture`);
      assert.deepEqual(etat, [...modele].map(([cle, s]) => [cle, s.count, s.depuis]), `essai ${i} : table`);
    }
    assert.equal(nombreDeReglages, reglages.length);
    for (const [nom, nombre] of Object.entries(temoins)) assert.ok(nombre > 0, `témoin ${nom} : ${nombre}`);
  });

  // --- Borne dure ---

  // Cadrage, « Borne dure de la table » : BREAK_GLASS_MAX_ADRESSES = 10 000 (choix par défaut, à confirmer) ; « Table
  // pleine, après la purge, une adresse nouvelle fait sortir la fenêtre la plus ancienne (tête de table), puis elle est
  // admise. Elle n'est jamais refusée parce que la table est pleine » ; « Seul effet sur le blocage : une adresse dont
  // la fenêtre sort par la borne repart de zéro ». Lectures écartées : borne absente ou dépassée d'une unité (taille
  // 10 001) ; adresse nouvelle refusée ; sortie de la fenêtre la plus récente (A resterait) ; sortie à chaque essai
  // d'une table pleine, même pour une adresse déjà suivie (A sortirait sans adresse nouvelle).
  test('borne : table pleine, une adresse déjà suivie ne fait rien sortir ; une adresse nouvelle est admise, la fenêtre la plus ancienne sort, les autres gardent leur compte', () => {
    assert.equal(BREAK_GLASS_MAX_ADRESSES, BORNE);
    assert.equal(essais(A, 6).at(-1), true, 'A, la plus ancienne, est bloquée');
    for (let i = 1; i < BORNE; i += 1) {
      aller(T0 + i);
      tropDEssaisSecours(ipv6(i));
    }
    assert.equal(essaisSecours.size, BORNE);
    // Adresse déjà suivie, table pleine : rien ne sort.
    assert.deepEqual(essais(ipv6(1), 2), [false, false]);
    assert.equal(essaisSecours.size, BORNE);
    assert.deepEqual(suivi(A), { count: 6, depuis: M0 }, 'A reste en table, avec son compte');
    // Adresse nouvelle : admise ; A, la fenêtre la plus ancienne, sort.
    aller(T0 + BORNE);
    assert.equal(tropDEssaisSecours(C), false, 'adresse nouvelle admise, jamais refusée parce que la table est pleine');
    assert.equal(essaisSecours.size, BORNE);
    assert.equal(suivi(A), undefined, 'la fenêtre la plus ancienne est sortie');
    assert.deepEqual(suivi(C), { count: 1, depuis: M0 + BORNE });
    assert.deepEqual(suivi(ipv6(1)), { count: 3, depuis: M0 + 1 });
    assert.deepEqual(suivi(ipv6(BORNE - 1)), { count: 1, depuis: M0 + BORNE - 1 });
    const ordre = adresses();
    assert.deepEqual([ordre[0], ordre.at(-1)], [ipv6(1), C]);
    // Sortie par la borne : A repart de zéro (seul effet sur le blocage) ; la plus ancienne qui reste sort à son tour.
    assert.equal(tropDEssaisSecours(A), false);
    assert.deepEqual(suivi(A), { count: 1, depuis: M0 + BORNE });
    assert.equal(suivi(ipv6(1)), undefined);
    assert.equal(essaisSecours.size, BORNE);
  });

  // Cadrage : « un refus laisserait un tiers bloquer l'accès de secours pour tous, ce que #261 a corrigé (décision 5.4
  // du 16-11-2026) ». Table pleine d'adresses toutes bloquées : une adresse nouvelle est encore admise, et les adresses
  // restées en table restent bloquées.
  test('borne : même quand toutes les adresses suivies sont bloquées, une adresse nouvelle est admise ; l’accès de secours n’est jamais fermé pour tous', () => {
    for (let i = 0; i < BORNE; i += 1) {
      aller(T0 + i);
      assert.equal(essais(ipv6(i), SEUIL + 1).at(-1), true, `adresse ${i} bloquée`);
    }
    assert.equal(essaisSecours.size, BORNE);
    aller(T0 + BORNE);
    assert.equal(tropDEssaisSecours(C), false);
    assert.equal(essaisSecours.size, BORNE);
    assert.equal(suivi(ipv6(0)), undefined, 'la plus ancienne est sortie');
    assert.equal(tropDEssaisSecours(ipv6(1)), true, 'les autres restent bloquées');
    assert.equal(tropDEssaisSecours(ipv6(BORNE - 1)), true);
  });

  // Cadrage : « Table pleine, après la purge » : les fenêtres passées sortent d'abord ; tant que la purge a libéré de la
  // place, aucune fenêtre ouverte ne sort. Lecture écartée : purge absente, sous laquelle l'adresse nouvelle ferait
  // sortir une seule fenêtre (taille 10 000) et les neuf autres fenêtres passées resteraient en table.
  test('borne : table pleine dont les dix plus anciennes fenêtres sont passées, la purge les retire et aucune fenêtre ouverte ne sort', () => {
    for (let i = 0; i < 10; i += 1) {
      aller(T0 + i);
      tropDEssaisSecours(ipv6(i));
    }
    for (let i = 10; i < BORNE; i += 1) {
      aller(T0 + 5 * MIN + i);
      tropDEssaisSecours(ipv6(i));
    }
    assert.equal(essaisSecours.size, BORNE);
    aller(T0 + FENETRE + 10); // ipv6(9) : premier essai il y a quinze minutes et une milliseconde
    assert.equal(tropDEssaisSecours(C), false);
    assert.equal(essaisSecours.size, BORNE - 10 + 1);
    const ordre = adresses();
    assert.deepEqual([ordre[0], ordre.at(-1)], [ipv6(10), C]);
  });

  // --- Coût de la purge ---

  // Critère : « Un essai ne visite que les fenêtres passées et la première fenêtre ouverte : dix essais sur une table de
  // 1 000 fenêtres ouvertes en visitent au plus dix » ; « Chaque entrée n'est visitée qu'une fois ; un parcours complet
  // de la table à chaque essai est exclu ». Les parcours de la table elle-même sont comptés : son itérateur, `entries`,
  // `keys`, `values` et `forEach`, enveloppés sur l'instance le temps de la mesure. Lecture écartée : purge par parcours
  // complet (au moins mille entrées visitées à chaque essai).
  const compterLesVisites = () => {
    const compteur = { visites: 0 };
    const compter = function* (iterateur) {
      for (const valeur of iterateur) {
        compteur.visites += 1;
        yield valeur;
      }
    };
    for (const nom of [Symbol.iterator, 'entries', 'keys', 'values']) {
      const origine = Map.prototype[nom];
      essaisSecours[nom] = function () { return compter(origine.call(this)); };
    }
    const forEach = Map.prototype.forEach;
    essaisSecours.forEach = function (rappel, ceci) {
      return forEach.call(this, (valeur, cle, map) => {
        compteur.visites += 1;
        return rappel.call(ceci, valeur, cle, map);
      });
    };
    compteur.retirer = () => {
      for (const nom of [Symbol.iterator, 'entries', 'keys', 'values', 'forEach']) delete essaisSecours[nom];
    };
    return compteur;
  };

  test('coût : dix essais sur une table de mille fenêtres ouvertes en visitent au plus dix', () => {
    for (let i = 0; i < 1000; i += 1) {
      aller(T0 + i);
      tropDEssaisSecours(ipv6(i));
    }
    aller(T0 + 5 * MIN);
    const compteur = compterLesVisites();
    try {
      for (let k = 0; k < 10; k += 1) tropDEssaisSecours(A);
      assert.ok(compteur.visites <= 10, `entrées visitées pour dix essais : ${compteur.visites}`);
      // Témoin de la mesure : un parcours de la table enveloppée est bien compté.
      const avant = compteur.visites;
      assert.equal([...essaisSecours].length, 1001);
      assert.equal(compteur.visites - avant, 1001, 'le compteur voit les parcours de la table');
    } finally {
      compteur.retirer();
    }
    assert.deepEqual(suivi(A), { count: 10, depuis: M0 + 5 * MIN });
  });

  test('coût : un essai retire mille fenêtres passées en ne visitant au-delà que la première fenêtre ouverte ; les neuf essais suivants en visitent au plus neuf', () => {
    for (let i = 0; i < 1000; i += 1) {
      aller(T0 + i);
      tropDEssaisSecours(ipv6(i));
    }
    for (let i = 0; i < 1000; i += 1) {
      aller(T0 + 10 * MIN + i);
      tropDEssaisSecours(ipv6(1000 + i));
    }
    aller(T0 + FENETRE + 1000); // les mille premières sont passées, les mille suivantes ouvertes
    const compteur = compterLesVisites();
    try {
      assert.equal(tropDEssaisSecours(A), false);
      assert.ok(compteur.visites <= 1001, `entrées visitées par le premier essai : ${compteur.visites}`);
      const apres = compteur.visites;
      for (let k = 0; k < 9; k += 1) tropDEssaisSecours(A);
      assert.ok(compteur.visites - apres <= 9, `entrées visitées par les neuf suivants : ${compteur.visites - apres}`);
    } finally {
      compteur.retirer();
    }
    assert.equal(essaisSecours.size, 1001);
    assert.deepEqual([adresses()[0], adresses().at(-1)], [ipv6(1000), A]);
  });
});

describe('#563 : accès de secours inactif', () => {
  // Cadrage, « Comportement inchangé » : « accès inactif : 503 avant tout comptage (la table ne grossit pas) ». Lecture
  // écartée : un comptage fait avant le contrôle de l'activation, qui ferait grossir la table sur une instance sans
  // accès de secours.
  test('accès de secours inactif : 503 avant tout comptage, la table des essais ne grossit pas', async () => {
    const request = require('supertest');
    const { app } = require('../dist/index.js');
    // Une seule instance du module dans le processus : la table lue ici est celle des routes de l'application.
    assert.equal(Object.keys(require.cache).filter((f) => /[\\/]authentification[\\/]secours\.js$/.test(f)).length, 1);
    essaisSecours.clear();
    try {
      for (let i = 1; i <= SEUIL + 2; i += 1) {
        const res = await request(app).post('/api/auth/secours').send({ token: 'jeton-de-secours-faux-au-moins-32-caracteres' });
        assert.deepEqual([res.status, res.body], [503, { code: 'SECOURS_INACTIF', error: "L'accès de secours n'est pas configuré sur cette instance." }], `essai ${i}`);
        assert.equal(essaisSecours.size, 0, `essai ${i} : rien n’est compté`);
      }
    } finally {
      essaisSecours.clear();
    }
  });
});
