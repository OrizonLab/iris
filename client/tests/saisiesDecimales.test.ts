import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTIF_ENTIER_POSITIF, MOTIF_PLAFOND, MOTIF_POURCENTAGE, MOTIF_QUART_HEURE_CHANTIER, MOTIF_STOCK,
  TITRE_ENTIER_POSITIF, TITRE_PLAFOND, TITRE_POURCENTAGE, TITRE_QUART_HEURE_CHANTIER, TITRE_STOCK, affichageSaisie,
} from '../src/lib/saisiesDecimales.ts';
import { MOTIF_PRIX_DEVIS } from '../src/lib/catalogueDevis.ts';
import { valeurSaisie } from '../src/lib/mainOeuvre.ts';

// Lot U, fin de #394 (cadrage v2 du 22-11-2026, « Inventaire complet » et « Critères, champ par champ » ; montants, règle 2) :
// les champs décimaux encore en `type="number"` (Achats, Heures et leurs journaux, taux d'acompte par défaut, seuil de marge
// faible, objectifs et primes, barème, catalogue, quantité de la ligne au forfait) passent en texte, avec un `pattern` aux
// bornes du serveur. Un champ `type="number"` lit la virgule selon la langue du navigateur (« 18,75 » y devient 1875, « 5,5 »
// devient 55, sans refus) ; le motif, lui, est le même partout.
//
// Le navigateur compile un `pattern` en `^(?:motif)$` avec le drapeau `v`, et ignore en silence un motif invalide : chaque
// motif est compilé ici de même (une erreur de compilation ferait échouer le test, et non passer le champ sans contrôle).
const compiler = (motif: string) => new RegExp(`^(?:${motif})$`, 'v');

// Règle du serveur (nombreDecimalNonNegatif, server/src/commun/validation.ts), réécrite : au plus `entiers` chiffres avant
// le séparateur (zéros de tête compris), au plus `decimales` après, virgule ou point ; la valeur, en millièmes, est jugée
// par l'appelant (strictement positive, plafond…). Le serveur retire les blancs ; le navigateur, non.
const formeServeur = (saisie: string, entiers: number, decimales: number) => new RegExp(`^\\d{1,${entiers}}(?:[.,]\\d{1,${decimales}})?$`).test(saisie);
const milliemes = (saisie: string) => {
  const [entier, decimal = ''] = saisie.split(/[.,]/);
  return BigInt(entier) * 1000n + BigInt((decimal + '000').slice(0, 3));
};
// Parties entières aux bornes de chaque motif (1 à 11 chiffres, zéros de tête, 100 et ses voisins), chacune seule puis suivie
// de toutes les parties décimales d'un à quatre chiffres, à la virgule et au point.
function saisiesExhaustives(): string[] {
  const entiers = ['0', '1', '7', '00', '01', '10', '000', '001', '050', '099', '100', '101', '999', '1000', '00000000', '12345678', '000000000', '123456789',
    '0123456789', '1234567890', '12345678901'];
  const decimales: string[] = [];
  for (let longueur = 1; longueur <= 4; longueur += 1) for (let n = 0; n < 10 ** longueur; n += 1) decimales.push(String(n).padStart(longueur, '0'));
  return entiers.flatMap((entier) => [entier, ...decimales.flatMap((decimal) => [`${entier},${decimal}`, `${entier}.${decimal}`])]);
}
// Hors forme pour tout motif décimal : vide (le `required` du champ, et non le motif, le refuse), blancs, signe, notation
// scientifique, séparateur sans chiffre, deux séparateurs, espace des milliers, unité, chiffre non latin.
const HORS_FORME = ['', ' 1', '1 ', '-1', '+1', '1e3', '1E3', ',5', '.5', '1,', '1.', '1,,5', '1,5,5', '1.5.5', '1 000', 'abc', '1,5 %', '1,5 h', '١'];

// Cadrage v2, points 2 à 5 : chaque motif aux bornes de la route qui lit le champ.
//  - Heures d'un chantier (lot W, décision de Nelson du 22-11-2026, soir : « 1. Quart d'heure » ; cadrage v2 du lot W, points
//    1 et 3) : POST et PATCH /api/heures lisent heuresAuQuartDHeure (server/src/domaines/chantiers/saisies.ts), soit
//    nombreDecimalNonNegatif(v, 8), strictement positif, puis `Math.round(n * 100) % 25 === 0`. Cette règle est réécrite
//    ici deux fois : telle que le serveur la calcule (nombre flottant, `Math.round`), et en millièmes exacts (multiple de
//    250) ; les deux doivent s'accorder sur toutes les saisies, et le motif avec elles. Motif du cadrage
//    « (?!0+(?:[.,]0+)?$)\d{1,8}(?:[.,](?:00?|25|50?|75))? ». Lectures écartées : la demi-heure d'avant le lot (« 3,25 »
//    refusé), le centième admis (« 1,1 », « 0,05 »), zéro admis, trois décimales admises (« 3,250 »), neuf chiffres admis.
//  - Taux en pourcentage (taux d'acompte par défaut et seuil, PUT /api/parametres ; taux d'une tranche, validerBareme :
//    nombreDecimalNonNegatif(v, 3, true), au plus 100) : « Motif à 3 chiffres et 2 décimales ». Lectures écartées : 100,01 ou
//    101 admis, trois décimales admises, et un motif plus étroit que le serveur (« 050 », « 099 », trois chiffres admis par
//    le serveur et refusés par un motif à deux chiffres).
//  - Plafond d'une tranche (nombreDecimalNonNegatif(brut, 10), strictement positif, cadrage v2 « plafond à 0 refusé ») ;
//    vide, sans plafond (le champ n'est pas `required`, et un motif ne s'applique pas à un champ vide).
//  - Stock d'un article (catalogueNombre(…, 9, 3), zéro admis).
test('motifs des heures, des pourcentages, du plafond et du stock : compilés avec le drapeau v, comme le navigateur, et aux bornes du serveur', () => {
  // Quart d'heure : la règle du serveur telle qu'il la calcule (heuresAuQuartDHeure, après la forme et le zéro refusé), et en
  // millièmes exacts. Un désaccord entre les deux serait un artefact du calcul flottant, que le motif ne peut pas reproduire.
  const quartDHeureServeur = (saisie: string) => Math.round(Number(saisie.replace(',', '.')) * 100) % 25 === 0;
  const quartDHeureExact = (saisie: string) => milliemes(saisie) % 250n === 0n;
  const regles = [
    ['heures d’un chantier (8 chiffres, quart d’heure, à partir de 0,25)', MOTIF_QUART_HEURE_CHANTIER, (s: string) => formeServeur(s, 8, 2) && milliemes(s) > 0n && quartDHeureServeur(s)],
    ['pourcentage (3 chiffres, 2 décimales, au plus 100)', MOTIF_POURCENTAGE, (s: string) => formeServeur(s, 3, 2) && milliemes(s) <= 100_000n],
    ['plafond (10 chiffres, 2 décimales, strictement positif)', MOTIF_PLAFOND, (s: string) => formeServeur(s, 10, 2) && milliemes(s) > 0n],
    ['stock (9 chiffres, 3 décimales, zéro admis)', MOTIF_STOCK, (s: string) => formeServeur(s, 9, 3)],
  ] as const;
  const saisies = saisiesExhaustives();
  const desaccords = saisies.filter((s) => formeServeur(s, 8, 2) && quartDHeureServeur(s) !== quartDHeureExact(s));
  assert.deepEqual(desaccords.slice(0, 10), [], `quart d’heure : calcul du serveur et millièmes exacts en désaccord (${desaccords.length} en tout)`);
  for (const [nom, motif, admise] of regles) {
    const expression = compiler(motif);
    const ecarts = saisies.filter((saisie) => expression.test(saisie) !== admise(saisie));
    assert.deepEqual(ecarts.slice(0, 10), [], `${nom} : saisies où le motif diffère du serveur (${ecarts.length} en tout)`);
    for (const saisie of HORS_FORME) assert.equal(expression.test(saisie), false, `${nom} : « ${saisie} »`);
  }
});

// Témoins nommés du tableau des critères (cadrage v2 du lot U, et du lot W pour les heures d'un chantier). Heures, critères
// observables du lot W : « 3,25 », « 3,75 », « 0,25 », « 3,00 », « 3 » admis ; « 1,1 », « 0,2 », « 1,10 », « 0 », « 0,05 »,
// « 3,250 », « 123456789 » refusés par le navigateur. Chaque témoin écarte une lecture : « 3,25 » ou « 0,25 » refusé (demi-heure
// d'avant le lot, minimum à 0,5) ; « 3,75 » refusé (seul « 25 » admis) ; « 3,00 » refusé (« ,00 » oublié) ; « 7,5 » refusé
// (deux décimales exigées : valeur pré-remplie du journal) ; « 1,1 », « 1,10 », « 0,2 », « 0,05 » ou « 3,26 » admis
// (centième) ; « 0 » ou « 0,00 » admis (zéro) ; « 3,250 » admis (trois décimales) ; « 123456789 » admis (neuf chiffres).
// Autres motifs : taux d'acompte « 5,5 », seuil « 12,5 », taux de tranche « 12,5 » admis ; plafond « 1500,50 » admis, « 0 »
// refusé ; stock « 1,5 » admis ; « 100 » refusé (borne perdue) ; « 100,5 » ou « 101 » admis ; « 0 » admis comme plafond
// (tranche vide) ; « 1,5555 » admis comme stock.
test('témoins du tableau des critères : « 3,25 », « 3,75 », « 0,25 », « 3,00 » et « 3 » h admis, « 1,1 », « 0,2 », « 1,10 », « 0 », « 0,05 », « 3,250 » et « 123456789 » h refusés ; taux « 5,5 » et « 12,5 », plafond « 1500,50 », stock « 1,5 »', () => {
  const lire = (motif: string, saisies: string[]) => saisies.map((s) => compiler(motif).test(s));
  const heuresAdmises = ['3,25', '3,75', '0,25', '3,00', '3', '3.25', '7,5', '0,5', '0,50', '0,75', '99999999,75'];
  const heuresRefusees = ['1,1', '0,2', '1,10', '0', '0,05', '3,250', '123456789', '0,0', '0,00', '3,26', '3,24', '99999999,99', '3,2', '3,7'];
  assert.deepEqual(lire(MOTIF_QUART_HEURE_CHANTIER, heuresAdmises), heuresAdmises.map(() => true), 'heures admises');
  assert.deepEqual(lire(MOTIF_QUART_HEURE_CHANTIER, heuresRefusees), heuresRefusees.map(() => false), 'heures refusées');
  assert.deepEqual(lire(MOTIF_POURCENTAGE, ['5,5', '12,5', '0', '0,01', '100', '100,0', '100,00', '99,99', '100,01', '100,5', '101', '5,555', '1000']), [true, true, true, true, true, true, true, true, false, false, false, false, false]);
  assert.deepEqual(lire(MOTIF_PLAFOND, ['1500,50', '1500.50', '0,01', '9999999999,99', '0', '0,00', '00', '1500,505', '10000000000']), [true, true, true, true, false, false, false, false, false]);
  assert.deepEqual(lire(MOTIF_STOCK, ['1,5', '0', '0,001', '123456789,999', '1,5555', '1234567890']), [true, true, true, true, false, false]);
});

// Cadrage v2, point 6 : quantité d'une ligne au forfait (jours ou demi-journées), champ texte `inputMode="numeric"`, motif
// « [1-9]\d{0,8} ». En `type="number"`, « 1,5 » devenait 15 jours dans un navigateur réglé en anglais, un entier valide (C3
// du contrôle de cohérence). Lectures écartées : « 1,5 » ou « 1.5 » admis (décimal), « 0 » admis (ligne vide), « 01 » admis
// (zéro de tête), dix chiffres admis.
test('motif de la quantité au forfait : un entier de 1 à 999 999 999, sans zéro de tête ; « 1,5 » refusé, « 2 » admis', () => {
  const expression = compiler(MOTIF_ENTIER_POSITIF);
  assert.deepEqual(['1', '2', '9', '10', '999999999'].map((s) => expression.test(s)), [true, true, true, true, true]);
  assert.deepEqual(['1,5', '1.5', '0', '00', '01', '1000000000', '2,0', '2.0'].map((s) => expression.test(s)), [false, false, false, false, false, false, false, false]);
  for (const saisie of HORS_FORME) assert.equal(expression.test(saisie), false, `« ${saisie} »`);
});

// Le titre d'un champ est le message du navigateur quand il refuse la saisie : en français, et son exemple est lui-même admis
// par le motif du champ (un exemple refusé par son propre champ égarerait l'utilisateur).
test('titres des champs : en français, avec un exemple admis par leur motif', () => {
  const exemples = [
    [TITRE_QUART_HEURE_CHANTIER, MOTIF_QUART_HEURE_CHANTIER, '3,25'],
    [TITRE_POURCENTAGE, MOTIF_POURCENTAGE, '5,5'],
    [TITRE_PLAFOND, MOTIF_PLAFOND, '1500,50'],
    [TITRE_STOCK, MOTIF_STOCK, '1,5'],
  ] as const;
  for (const [titre, motif, exemple] of exemples) {
    assert.ok(titre.includes(`par exemple ${exemple}`), `« ${titre} » : exemple « ${exemple} »`);
    assert.equal(compiler(motif).test(exemple), true, `exemple « ${exemple} » admis par son motif`);
  }
  assert.equal(TITRE_ENTIER_POSITIF, 'Un nombre entier supérieur ou égal à 1');
  // Lot W, cadrage v2, point 3 : titre exact du champ des heures d'un chantier.
  assert.equal(TITRE_QUART_HEURE_CHANTIER, 'Un nombre d’heures au quart d’heure, à partir de 0,25 (par exemple 3,25)');
});

// Cadrage v2 : « valeurs pré-remplies à la virgule ». `affichageSaisie` écrit à la virgule un nombre reçu du serveur, et
// laisse une saisie en cours telle que l'utilisateur l'écrit (la réécrire déplacerait le curseur, et changerait « 1500.50 »
// tapé au point en « 1500,50 » sous ses doigts). Lectures écartées : un nombre écrit au point (« 12.5 », la valeur brute d'un
// `value={nombre}`) ; une chaîne réécrite (« 12.5 » rendu « 12,5 ») ; null rendu « null » ou « 0 » (un plafond vide doit
// rester vide : « sans plafond ») ; zéro rendu vide.
test('affichageSaisie : un nombre du serveur à la virgule, une saisie en cours inchangée, rien pour une valeur absente', () => {
  assert.equal(affichageSaisie(12.5), '12,5');
  assert.equal(affichageSaisie(1500.5), '1500,5');
  assert.equal(affichageSaisie(1250.5), '1250,5');
  assert.equal(affichageSaisie(18.75), '18,75');
  assert.equal(affichageSaisie(1250), '1250');
  assert.equal(affichageSaisie(0), '0');
  assert.equal(affichageSaisie('1500,50'), '1500,50');
  assert.equal(affichageSaisie('12.5'), '12.5');
  assert.equal(affichageSaisie('1,'), '1,');
  assert.equal(affichageSaisie(''), '');
  assert.equal(affichageSaisie(null), '');
  assert.equal(affichageSaisie(undefined), '');
});

// `valeurSaisie` accepte une chaîne depuis le lot (pré-remplissage d'un champ dont la valeur n'est pas encore relue en
// nombre) : le point devient la virgule, comme pour un nombre. Lectures écartées : une chaîne rendue telle quelle au point
// (« 7.5 »), une chaîne convertie par `Number` (« 1500,50 » rendu « NaN »), la chaîne vide rendue « 0 ».
test('valeurSaisie d’une chaîne : le point devient la virgule, la virgule reste, la chaîne vide reste vide', () => {
  assert.equal(valeurSaisie('7.5'), '7,5');
  assert.equal(valeurSaisie('1500,50'), '1500,50');
  assert.equal(valeurSaisie('40'), '40');
  assert.equal(valeurSaisie(''), '');
  assert.equal(valeurSaisie(7.5), '7,5');
  assert.equal(valeurSaisie(undefined), '');
});

// Un champ pré-rempli doit pouvoir être renvoyé sans retouche : la valeur à la virgule d'un nombre relu en base est admise par
// le motif du champ (sinon le navigateur refuserait d'enregistrer une fiche qu'on n'a pas modifiée). Valeurs aux bornes des
// colonnes : prix et montants au centime (Decimal(12, 2)), heures d'un chantier au quart d'heure (lot W, cadrage v2 : « valeurs
// pré-remplies au quart d'heure admises » ; « 0,25 » et « 0,75 » écartent un pré-remplissage refusé, « 7,5 » une décimale
// unique refusée), taux au centième, stock au millième.
test('valeurs pré-remplies : la valeur relue en base, écrite à la virgule, est admise par le motif de son champ', () => {
  const cas = [
    [MOTIF_PRIX_DEVIS, [0, 18.75, 1250.5, 1234.5, 9999999999.99]],
    [MOTIF_QUART_HEURE_CHANTIER, [0.25, 0.5, 0.75, 3.25, 7.5, 12, 99999999.75]],
    [MOTIF_POURCENTAGE, [0, 5.5, 12.5, 40, 99.99, 100]],
    [MOTIF_PLAFOND, [0.01, 1500.5, 1000, 9999999999.99]],
    [MOTIF_STOCK, [0, 1.5, 3.25, 123456789.999]],
  ] as const;
  for (const [motif, valeurs] of cas) {
    for (const valeur of valeurs) assert.equal(compiler(motif).test(valeurSaisie(valeur)), true, `${valeur} → « ${valeurSaisie(valeur)} »`);
  }
});
