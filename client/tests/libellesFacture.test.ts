import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libelleOrigineFacture, libelleStatutPiece } from '../src/lib/libellesFacture.ts';

// Correctif R1 du passage hebdomadaire du 14-11-2026 (#540), cadrage « libellés du statut et de l'origine des factures »,
// § 1 et section « Tests » : l'écran n'affiche plus le code stocké d'une pièce. Libellés (choix d'affichage par défaut, à
// confirmer, règle 5) : facture « Brouillon », « Émise », « Réglée », « Annulée » ; avoir « Brouillon », « Émis » ; origine
// « Affaire », « Intervention SAV », « Contrat de maintenance », « Hors affaire », comme le panneau « Origine de la facture ».
// Un code inconnu, ou un statut d'avoir non prévu, reste affiché tel quel, pour ne rien masquer.

// Clés que tout objet JavaScript hérite : un code de ce nom n'est pas un code connu. Lecture écartée : une table lue par
// `libelles[code] ?? code`, qui rendrait une fonction (`toString`, `constructor`…) ou `Object.prototype` (`__proto__`) au lieu
// du code.
const CLES_HERITEES = ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'];

test('statut d’une facture : « Brouillon », « Émise », « Réglée », « Annulée », au féminin', () => {
  assert.equal(libelleStatutPiece('FACTURE', 'BROUILLON'), 'Brouillon');
  assert.equal(libelleStatutPiece('FACTURE', 'EMISE'), 'Émise');
  assert.equal(libelleStatutPiece('FACTURE', 'REGLEE'), 'Réglée');
  assert.equal(libelleStatutPiece('FACTURE', 'ANNULEE'), 'Annulée');
});

test('statut d’un avoir : « Brouillon » et « Émis », au masculin (et non « Émise », le libellé d’une facture)', () => {
  assert.equal(libelleStatutPiece('AVOIR', 'BROUILLON'), 'Brouillon');
  // Lecture écartée : une seule table pour les deux types, l'avoir « Émise » comme la facture (l'écart relevé par #540 entre
  // la liste et le panneau « Règlements », qui écrit « Émis »).
  assert.equal(libelleStatutPiece('AVOIR', 'EMISE'), 'Émis');
  assert.notEqual(libelleStatutPiece('AVOIR', 'EMISE'), libelleStatutPiece('FACTURE', 'EMISE'));
});

test('statut d’avoir non prévu (« REGLEE », « ANNULEE ») affiché tel quel, sans emprunter le libellé d’une facture', () => {
  // Côté serveur, seule une pièce de type FACTURE devient réglée ou annulée (cadrage, § 1). Lecture écartée : un repli sur la
  // table des factures, qui afficherait « Réglée » ou « Annulée » sous un avoir et masquerait une donnée anormale.
  assert.equal(libelleStatutPiece('AVOIR', 'REGLEE'), 'REGLEE');
  assert.equal(libelleStatutPiece('AVOIR', 'ANNULEE'), 'ANNULEE');
});

test('statut inconnu affiché tel quel, pour une facture comme pour un avoir, y compris une clé héritée de l’objet', () => {
  for (const type of ['FACTURE', 'AVOIR']) {
    // Lectures écartées : un code inconnu masqué (chaîne vide, tiret) ou remplacé par un libellé voisin.
    assert.equal(libelleStatutPiece(type, 'PAYEE'), 'PAYEE', type);
    assert.equal(libelleStatutPiece(type, 'EN_ATTENTE'), 'EN_ATTENTE', type);
    for (const cle of CLES_HERITEES) {
      const libelle = libelleStatutPiece(type, cle);
      assert.equal(typeof libelle, 'string', `${type} ${cle}`);
      assert.equal(libelle, cle, `${type} ${cle}`);
    }
  }
});

test('origine : « Affaire », « Intervention SAV », « Contrat de maintenance », « Hors affaire », comme le panneau « Origine de la facture »', () => {
  // Lecture écartée : le code affiché (« CHANTIER », « INTERVENTION », « CONTRAT »), constat R1 de #540.
  assert.equal(libelleOrigineFacture('CHANTIER'), 'Affaire');
  assert.equal(libelleOrigineFacture('INTERVENTION'), 'Intervention SAV');
  assert.equal(libelleOrigineFacture('CONTRAT'), 'Contrat de maintenance');
  assert.equal(libelleOrigineFacture('HORS_AFFAIRE'), 'Hors affaire');
});

test('origine inconnue affichée telle quelle, y compris une clé héritée de l’objet', () => {
  // N9 du cadrage : pour une origine inconnue, le panneau « Origine » affiche désormais le code au lieu de rien.
  assert.equal(libelleOrigineFacture('FORFAIT'), 'FORFAIT');
  for (const cle of CLES_HERITEES) {
    const libelle = libelleOrigineFacture(cle);
    assert.equal(typeof libelle, 'string', cle);
    assert.equal(libelle, cle, cle);
  }
});
