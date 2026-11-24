import assert from 'node:assert/strict';
import test from 'node:test';
import { arrondiCentime, arrondiEuro, coutLigneHeures, differenceExacte, sommeExacte } from '../src/lib/montants.ts';

// #198 : en nombres à virgule, 0,1 + 0,2 + 0,3 vaut 0,6000000000000001, mais 0,3 + 0,2 + 0,1 vaut 0,6.

test('une somme de montants est exacte, quel que soit l’ordre des lignes', () => {
  for (const valeurs of [[0.1, 0.2, 0.3], [0.3, 0.2, 0.1], [0.2, 0.3, 0.1]]) {
    assert.equal(sommeExacte(valeurs), 0.6, valeurs.join(' + '));
  }
  assert.equal(sommeExacte([]), 0);
  assert.equal(sommeExacte([1234567.89, -0.01, 0.12]), 1234568);
  // Coûts de main-d'œuvre (heures × taux) : quatre décimales.
  assert.equal(sommeExacte([0.0001, 0.0002], 4), 0.0003);
  assert.equal(sommeExacte(new Set([12.25, 12.25]).values()), 12.25, 'accepte tout itérable');
});

test('un écart au budget vaut zéro quand le budget est exactement consommé', () => {
  assert.equal(differenceExacte(0.6, 0.1 + 0.2 + 0.3), 0);
  assert.equal(differenceExacte(10, 8.8, 2), 1.2);
  assert.equal(differenceExacte(0.0001, 0.0003), -0.0002);
});

test('arrondi à l’euro : moitié vers l’extérieur, jamais « -0 »', () => {
  assert.equal(arrondiEuro(12.5), 13);
  assert.equal(arrondiEuro(-12.5), -13, 'Math.round donnerait -12');
  assert.equal(arrondiEuro(12.49), 12);
  assert.equal(arrondiEuro(-12.49), -12);
  // 0,01 + 2,01 + 0,48 vaut 2,50 €, mais 2,4999999999999996 en flottant : Math.round donnait 2 €.
  assert.equal(0.01 + 2.01 + 0.48, 2.4999999999999996, 'témoin : l’erreur corrigée');
  assert.equal(arrondiEuro(sommeExacte([0.01, 2.01, 0.48])), 3);
  assert.equal(arrondiEuro(0.01 + 2.01 + 0.48), 3, 'même un total flottant reçu tel quel');
  assert.ok(Object.is(arrondiEuro(-0.4), 0), 'pas de zéro négatif');
  assert.equal(arrondiEuro(-0.4).toLocaleString('fr-FR'), '0');
  assert.equal(arrondiEuro(1234567.5), 1234568);
});

test('arrondi au centime : moitié vers l’extérieur, sur des montants à quatre décimales', () => {
  assert.equal(arrondiCentime(1.005), 1.01, '1,005 × 100 vaut 100,4999… en flottant');
  assert.equal(arrondiCentime(-1.005), -1.01);
  assert.equal(arrondiCentime(1.0049), 1);
  assert.equal(arrondiCentime(8.8), 8.8);
  assert.ok(Object.is(arrondiCentime(-0.004), 0), 'pas de zéro négatif');
  assert.equal(arrondiCentime(0.1 + 0.2), 0.3);
});

test('un rapport (taux moyen, estimation) n’est arrondi qu’une fois', () => {
  // Manque à gagner : 2,07 h en trop au taux moyen de 1 055,4275 € pour 21 h = 104,034996… €.
  const manque = differenceExacte(21, 18.93, 2) * (1055.4275 / 21);
  assert.equal(arrondiCentime(manque), 104.03, 'passer par les dix-millièmes donnerait 104,04');
  assert.equal(arrondiCentime(-manque), -104.03);
  assert.equal(arrondiEuro(2.4999642857), 2, 'un rapport sous la moitié reste en dessous');
  assert.equal(arrondiEuro(2.5000357142), 3);
  assert.equal(arrondiCentime(1 / 3), 0.33);
});

test('coût d’une ligne d’heures : produit exact, arrondi au centime supérieur à la moitié', () => {
  assert.equal(coutLigneHeures(2.5, 0.41), 1.03, '1,025 € ; toFixed(2) donnerait 1,02 €');
  assert.equal((2.5 * 0.41).toFixed(2), '1.02', 'témoin : l’erreur corrigée');
  assert.equal(coutLigneHeures(1.1, 1.1), 1.21);
  assert.equal(coutLigneHeures(7.75, 42.5), 329.38);
  assert.equal(coutLigneHeures(0, 42), 0);
});

// Lot AB (réponse de Nelson du 24-11-2026, point 2 : « Arrindir chaque ligne » ; cadrage v2 du lot AB, « Tests ») : le journal
// des heures affiche chaque ligne arrondie au centime (coutLigneHeures), et le serveur additionne désormais ces mêmes lignes
// arrondies dans le coût de la main-d'œuvre d'un chantier. Sur le jeu du cadrage, la somme des lignes affichées est donc le
// coût que la fiche reçoit : 140,00 €. Lectures écartées : 139,99 € (somme exacte des produits, arrondie une fois, l'ancien calcul
// du serveur) ; 139,97 € (troncature, ou arrondi au pair, de chaque ligne) ; 140,02 € (arrondi par excès de chaque ligne).
test('journal des heures et serveur : chaque ligne arrondie au centime, puis additionnée, sur le jeu du lot AB : 140,00 €', () => {
  const jeu: Array<[number, number]> = [[3.25, 37.85], [0.25, 37.85], [0.25, 10.02], [0.25, 10.02], [0.25, 10.02]];
  const lignes = jeu.map(([heures, taux]) => coutLigneHeures(heures, taux));
  assert.deepEqual(lignes, [123.01, 9.46, 2.51, 2.51, 2.51], '2,505 € donne 2,51 € (moitié vers le haut) ; troncature ou arrondi au pair : 2,50 €');
  assert.equal(sommeExacte(lignes), 140);
  assert.equal(arrondiCentime(sommeExacte(jeu.map(([heures, taux]) => heures * taux), 4)), 139.99, 'témoin : le total exact arrondi une fois, écarté');
  // Exemple de Nelson : 3,25 h puis 0,25 h à 37,85 € : 132,47 €, et non 132,48 €.
  assert.equal(sommeExacte(lignes.slice(0, 2)), 132.47);
});
