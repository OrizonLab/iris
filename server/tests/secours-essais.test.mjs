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
//     l'instant présent du premier essai de la fenêtre (comparaison stricte), ou, depuis #607 (cadrage du lot #607 et
//     #608, point 3), quand ce premier essai est daté dans le futur, après un recul de l'horloge (choix par défaut, à
//     confirmer) ;
//   - une borne dure, BREAK_GLASS_MAX_ADRESSES = 10 000 (choix par défaut, à confirmer) : table pleine, après la purge,
//     une adresse nouvelle fait sortir la fenêtre la plus ancienne, puis elle est admise, jamais refusée ;
//   - le blocage inchangé en deçà de la borne : 5 essais par adresse et par fenêtre, le 6e refusé ; accès inactif : 503
//     avant tout comptage.
//
// Tests sans base. L'horloge est simulée par `mock.timers` sur `Date` seulement (Node 20.11 au moins, comme
// api.test.mjs) ; la table est vidée avant et après chaque test. La remise à zéro par un accès réussi est prouvée par
// la route, dans le bloc « Accès de secours » d'api.test.mjs (test T2 du cadrage).
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
const FENETRE = 15 * MIN;
const T0 = Date.UTC(2026, 10, 17, 8); // 17-11-2026, 8 h UTC
const A = '198.51.100.10';
const B = '198.51.100.20';
const C = '198.51.100.30';
const D = '198.51.100.40';
const ipv6 = (i) => `2001:db8::${i.toString(16)}`;

const aller = (instant) => mock.timers.setTime(instant);
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
    mock.timers.enable({ apis: ['Date'], now: T0 });
  });
  afterEach(() => {
    mock.timers.reset();
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
    assert.deepEqual(suivi(A), { count: 6, depuis: T0 });
    aller(T0 + FENETRE);
    assert.equal(tropDEssaisSecours(A), true, 'à quinze minutes pile, la fenêtre est encore ouverte');
    assert.equal(suivi(A).depuis, T0, 'un essai refusé ne repousse pas la fenêtre');
    aller(T0 + FENETRE + 1);
    assert.equal(tropDEssaisSecours(A), false, 'une milliseconde après, la fenêtre est passée');
    assert.deepEqual(suivi(A), { count: 1, depuis: T0 + FENETRE + 1 });
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
    assert.deepEqual(suivi(A), { count: 5, depuis: T0 });
    aller(T0 + FENETRE + 1);
    assert.equal(tropDEssaisSecours(A), false, 'la fenêtre ouverte au premier essai est passée : nouvelle fenêtre');
    assert.deepEqual(suivi(A), { count: 1, depuis: T0 + FENETRE + 1 });
  });

  // Audit des droits de #591, R1, maintenu après #607 (cadrage du lot #607 et #608, v2, C1 ; test réécrit d'après la
  // proposition du contrôle de cohérence) : `Date.now()` suit l'horloge du système, qui peut reculer (correction NTP).
  // Une fenêtre datée dans le futur compte désormais comme passée (#607) ; mais un recul plus court que la fenêtre laisse
  // en tête de table une fenêtre ouverte avant lui et encore ouverte, derrière laquelle passent les fenêtres d'adresses
  // ouvertes après lui (B et C) : la purge s'arrête en tête, et le blocage de chaque adresse relit sa propre fenêtre.
  // Ici, D est ouverte dix minutes avant A ; après un recul de cinq minutes, D arrête d'abord la purge, puis, passée,
  // laisse A en tête, encore ouverte. Lectures écartées : un blocage qui ne tient qu'à la purge (contrôle par entrée
  // retiré), sous lequel B resterait bloquée jusqu'à ce que la fenêtre de A passe (cinq minutes de plus), et C serait
  // refusée au sixième essai de deux fenêtres ; une comparaison large (`maintenant <= depuis`), sous laquelle chaque
  // essai de B au même instant rouvrirait sa fenêtre (B jamais bloquée).
  test('horloge qui recule de cinq minutes : la fenêtre d’une adresse ouverte après le recul court quinze minutes, même derrière une fenêtre ouverte avant lui et encore ouverte ; les essais ne se cumulent pas d’une fenêtre à l’autre', () => {
    aller(T0 - 10 * MIN);
    tropDEssaisSecours(D);
    aller(T0);
    tropDEssaisSecours(A);
    const recul = T0 - 5 * MIN; // l'horloge recule de cinq minutes
    aller(recul);
    assert.deepEqual(essais(B, 6), [false, false, false, false, false, true]);
    essais(C, 3);
    assert.deepEqual(adresses(), [D, A, B, C], 'D, ouverte, arrête la purge : A, datée dans le futur, reste derrière elle');
    aller(recul + FENETRE);
    assert.equal(tropDEssaisSecours(B), true, 'à quinze minutes pile du premier essai de B, B reste bloquée');
    assert.deepEqual(adresses(), [A, B, C], 'D, passée, est purgée ; A, encore ouverte, arrête la purge');
    aller(recul + FENETRE + 1);
    assert.equal(tropDEssaisSecours(B), false, 'une milliseconde après, B repart de zéro, même avec A ouverte en tête');
    assert.deepEqual(suivi(B), { count: 1, depuis: recul + FENETRE + 1 });
    assert.deepEqual(essais(C, 3), [false, false, false], 'C : nouvelle fenêtre, ses trois premiers essais ne comptent plus');
    assert.deepEqual(suivi(C), { count: 3, depuis: recul + FENETRE + 1 });
    assert.deepEqual(suivi(A), { count: 1, depuis: T0 }, 'A, ouverte avant le recul et encore ouverte, reste en table avec son compte');
    assert.deepEqual(adresses(), [A, B, C], 'B et C, rouvertes, en fin de table, dans l’ordre de leur réouverture');
  });

  // #607 (cadrage du lot #607 et #608, point 3 ; « Tests attendus » : « 6 essais à T0 (bloqué), recul d'une heure :
  // l'essai suivant n'est plus bloqué (fenêtre repartie de zéro) » ; choix par défaut, à confirmer) : une fenêtre datée
  // dans le futur (ouverte avant un recul de l'horloge) compte comme passée. Lecture écartée : la règle d'avant #607
  // (`maintenant < depuis` retiré), sous laquelle A resterait bloquée jusqu'au terme de sa fenêtre, une heure et quart de
  // temps réel après le recul (sonde du contrôle de #606).
  test('#607 : après un recul d’une heure, une adresse bloquée repart de zéro au premier essai, pour une nouvelle fenêtre de cinq essais', () => {
    assert.deepEqual(essais(A, 6), [false, false, false, false, false, true]);
    const recul = T0 - 60 * MIN;
    aller(recul);
    assert.equal(tropDEssaisSecours(A), false, 'fenêtre datée dans le futur : passée');
    assert.deepEqual(suivi(A), { count: 1, depuis: recul });
    assert.deepEqual(essais(A, 5), [false, false, false, false, true], 'nouvelle fenêtre de cinq essais');
    aller(recul + FENETRE);
    assert.equal(tropDEssaisSecours(A), true, 'la nouvelle fenêtre court quinze minutes depuis son premier essai');
    aller(recul + FENETRE + 1);
    assert.equal(tropDEssaisSecours(A), false, 'une milliseconde après, elle est passée');
  });

  // #607 (cadrage, point 3, premier effet : « sa fenêtre repart de zéro, en fin de table (comme une fenêtre passée) ») :
  // le recul, de cinq minutes, est plus court que la fenêtre. D, ouverte dix minutes avant A et encore ouverte, arrête la
  // purge en tête de table : c'est le contrôle de l'entrée de A elle-même qui tient sa fenêtre, datée dans le futur, pour
  // passée. Lectures écartées : la règle d'avant #607, sous laquelle A resterait bloquée vingt minutes de temps réel
  // après le recul ; un blocage qui ne tient qu'à la purge (contrôle par entrée retiré), sous lequel A resterait bloquée
  // tant que D arrête la purge ; une entrée remise à zéro sur place, et non en fin de table.
  test('#607 : après un recul de cinq minutes, une adresse bloquée dont la fenêtre est datée dans le futur repart de zéro, en fin de table, même derrière une fenêtre encore ouverte', () => {
    aller(T0 - 10 * MIN);
    tropDEssaisSecours(D);
    aller(T0);
    assert.deepEqual(essais(A, 6), [false, false, false, false, false, true]);
    aller(T0 + 1);
    tropDEssaisSecours(B);
    assert.deepEqual(adresses(), [D, A, B]);
    const recul = T0 - 5 * MIN;
    aller(recul);
    assert.equal(tropDEssaisSecours(A), false, 'fenêtre de A datée dans le futur : passée, même derrière D encore ouverte');
    assert.deepEqual(suivi(A), { count: 1, depuis: recul });
    assert.deepEqual(adresses(), [D, B, A], 'A repart en fin de table ; D, ouverte, arrête la purge ; B, datée dans le futur, attend derrière elle');
    assert.deepEqual(suivi(D), { count: 1, depuis: T0 - 10 * MIN }, 'D garde son compte');
  });

  // #607 (cadrage, point 3, deuxième effet : « la purge au fil des essais retire aussi les fenêtres datées dans le futur
  // rencontrées en tête de table (elles sont « passées ») ») ; mesure de la sonde du contrôle (N4) : table stable au lieu
  // de grossir. Lecture écartée : la règle d'avant #607, sous laquelle la purge s'arrêterait sur A pendant une heure et
  // quart, et la table garderait A, B et C.
  test('#607 : après un recul d’une heure, la purge retire les fenêtres datées dans le futur en tête de table', () => {
    essais(A, 2);
    aller(T0 + 1);
    essais(B, 6);
    aller(T0 + 2);
    tropDEssaisSecours(C);
    aller(T0 - 60 * MIN);
    assert.equal(tropDEssaisSecours(D), false);
    assert.deepEqual(table(), [[D, 1, T0 - 60 * MIN]]);
  });

  // Audit des droits de #612 (C2 et T1) : limites de la règle de #607, écrites dans docs/ACCES-SANS-MICROSOFT.md. Une
  // fenêtre n'est tenue pour passée que tant qu'elle est datée dans le futur : (1) un recul plus court que son âge ne la
  // date pas dans le futur, et la prolonge de toute sa durée ; (2) une fenêtre datée dans le futur que l'horloge rattrape
  // sans qu'aucun essai l'ait retirée reprend son compte jusqu'à son terme. Dans les deux cas, le blocage dure jusqu'à la
  // durée du recul de plus, ce qui est conservateur (aucun essai de plus n'est admis).
  test('#607, audit de #612 : un recul de cinq minutes plus court que l’âge de la fenêtre la prolonge de cinq minutes de temps réel', () => {
    assert.deepEqual(essais(A, 6), [false, false, false, false, false, true]);
    aller(T0 + 10 * MIN);
    aller(T0 + 5 * MIN); // recul de cinq minutes, dix minutes après le premier essai
    assert.equal(tropDEssaisSecours(A), true, 'fenêtre non datée dans le futur : toujours bloquée');
    aller(T0 + FENETRE);
    assert.equal(tropDEssaisSecours(A), true, 'vingt minutes de temps réel après le premier essai : encore bloquée');
    aller(T0 + FENETRE + 1);
    assert.equal(tropDEssaisSecours(A), false, 'libérée au terme de la fenêtre lu sur l’horloge');
  });

  test('#607, audit de #612 : une fenêtre datée dans le futur que l’horloge rattrape sans essai reprend son compte jusqu’à son terme', () => {
    assert.deepEqual(essais(A, 6), [false, false, false, false, false, true]);
    aller(T0 + MIN);
    aller(T0 - 59 * MIN); // recul d'une heure ; aucun essai pendant l'heure qui suit
    aller(T0 + MIN);
    assert.equal(tropDEssaisSecours(A), true, 'l’horloge a rattrapé le début de la fenêtre : bloquée');
    assert.deepEqual(suivi(A), { count: 7, depuis: T0 });
    aller(T0 + FENETRE + 1);
    assert.equal(tropDEssaisSecours(A), false, 'libérée au terme de la fenêtre');
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
    assert.deepEqual(suivi(B), { count: 2, depuis: T0 + 2 * MIN });
    aller(T0 + 2 * MIN + FENETRE + 1);
    assert.equal(tropDEssaisSecours(C), false);
    assert.deepEqual(adresses(), [C], 'B, passée à son tour, est retirée');
    assert.deepEqual(suivi(C), { count: 2, depuis: T0 + FENETRE + 1 });
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
    assert.deepEqual(suivi(A), { count: 6, depuis: T0 });
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
    assert.deepEqual(suivi(A), { count: 1, depuis: T0 + FENETRE + 1 });
    aller(T0 + MIN + FENETRE + 1);
    tropDEssaisSecours(D);
    assert.deepEqual(adresses(), [A, D], 'B, passée, est purgée ; A, rouverte après elle, reste');
  });

  // Critère : « Après chaque appel, la table ne contient aucune fenêtre passée (horloge qui ne recule pas) ». Après
  // chaque essai, la réponse et toute la table (adresses, comptes, premiers essais, ordre) sont comparées à la règle du
  // cadrage, écrite à part dans ce test (modèle par parcours complet) : toutes les fenêtres passées retirées, cinq essais
  // par fenêtre ouverte au premier essai, une entrée nouvelle en fin de table. Une adresse insistante (un essai sur
  // trois, bloquée puis rouverte) et 37 autres, qui reviennent toutes les cinq à six minutes.
  test('essais de 38 adresses étalés sur une heure et demie : après chaque essai, aucune fenêtre passée en table, fenêtres rangées par ordre d’ouverture, réponses conformes à la règle', () => {
    const modele = new Map();
    const essaiModele = (ip, maintenant) => {
      for (const [cle, s] of [...modele]) if (maintenant - s.depuis > FENETRE) modele.delete(cle);
      const s = modele.get(ip);
      if (!s) {
        modele.set(ip, { count: 1, depuis: maintenant });
        return false;
      }
      s.count += 1;
      return s.count > SEUIL;
    };
    let refuses = 0;
    let rouvertures = 0;
    let insistanteBloquee = false;
    for (let i = 0; i < 600; i += 1) {
      const maintenant = T0 + i * 9_000 + (i % 7) * 1_000; // croissant : l'horloge ne recule pas
      aller(maintenant);
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
    assert.deepEqual(suivi(A), { count: 6, depuis: T0 }, 'A reste en table, avec son compte');
    // Adresse nouvelle : admise ; A, la fenêtre la plus ancienne, sort.
    aller(T0 + BORNE);
    assert.equal(tropDEssaisSecours(C), false, 'adresse nouvelle admise, jamais refusée parce que la table est pleine');
    assert.equal(essaisSecours.size, BORNE);
    assert.equal(suivi(A), undefined, 'la fenêtre la plus ancienne est sortie');
    assert.deepEqual(suivi(C), { count: 1, depuis: T0 + BORNE });
    assert.deepEqual(suivi(ipv6(1)), { count: 3, depuis: T0 + 1 });
    assert.deepEqual(suivi(ipv6(BORNE - 1)), { count: 1, depuis: T0 + BORNE - 1 });
    const ordre = adresses();
    assert.deepEqual([ordre[0], ordre.at(-1)], [ipv6(1), C]);
    // Sortie par la borne : A repart de zéro (seul effet sur le blocage) ; la plus ancienne qui reste sort à son tour.
    assert.equal(tropDEssaisSecours(A), false);
    assert.deepEqual(suivi(A), { count: 1, depuis: T0 + BORNE });
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
    assert.deepEqual(suivi(A), { count: 10, depuis: T0 + 5 * MIN });
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
