import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centimesSaisis, libelleMoyen, repartirReglement, saisieDeCentimes, situationReglement } from '../src/lib/reglements.ts';

const euros = (montant: number) => `${montant.toFixed(2).replace('.', ',')} €`;

test('montant saisi : virgule ou point, deux décimales au plus, en centimes exacts', () => {
  assert.equal(centimesSaisis('50'), 5000);
  assert.equal(centimesSaisis('50,5'), 5050);
  assert.equal(centimesSaisis('1 234,56'), 123456);
  assert.equal(centimesSaisis('0.1')! + centimesSaisis('0,2')!, centimesSaisis('0,3'));
  for (const refus of ['', '-5', '1,234', '1e3', 'abc', '12,']) assert.equal(centimesSaisis(refus), null, refus);
  assert.equal(saisieDeCentimes(7000), '70,00');
  assert.equal(saisieDeCentimes(30), '0,30');
});

test('répartition : échéance la plus ancienne d’abord, surplus en trop-perçu sur la dernière', () => {
  const factures = [{ id: 'a', resteDu: 70 }, { id: 'b', resteDu: 240 }, { id: 'c', resteDu: 0.3 }];
  assert.deepEqual(repartirReglement(10000, factures), { a: 7000, b: 3000, c: 0 });
  assert.deepEqual(repartirReglement(31030, factures), { a: 7000, b: 24000, c: 30 });
  // Au-delà du total dû, le surplus va sur la dernière facture (trop-perçu, décision du 17-10-2026).
  assert.deepEqual(repartirReglement(40000, factures), { a: 7000, b: 24000, c: 9000 });
  assert.deepEqual(repartirReglement(0, factures), { a: 0, b: 0, c: 0 });
  assert.deepEqual(repartirReglement(500, []), {});
});

// Lot « Statut d'une facture couverte par des avoirs » (cadrage v3, § 3 et critères 1, 2, 4 et 7). Réponse de Nelson du
// 09-11-2026, mot pour mot : « La facture n’est pas annulé si payer par sob avoir, soit elle est regle entierement dans ce cas
// la facture est regler ou si seul une partie est couverte pas un ou plusieurs avoir, elle sera partiellement reglé. »
// Lecture retenue, à corriger par Nelson si besoin : couverte en totalité par ses avoirs, la facture est « réglée » (statut
// stocké) ; couverte en partie par un règlement ou un avoir, elle reste « émise », précisée « Partiellement réglée ». La
// précision « Soldée par avoir » passe de « émise » à « réglée » sans règlement (choix par défaut, à confirmer) ; une facture
// émise à 0,00 € sans avoir n'a plus de précision (N3).
test('situation affichée sous le statut : partielle par un règlement ou par un avoir, soldée par avoir sous « réglée » seulement, trop-perçu', () => {
  // Émise, ni règlement ni avoir : aucune précision.
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'EMISE', montantRegle: 0, montantAvoirs: 0, resteDu: 120 }, euros), '');
  // Émise, couverte en partie par un règlement (inchangé).
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'EMISE', montantRegle: 50, montantAvoirs: 0, resteDu: 70 }, euros), 'Partiellement réglée');
  // Critère 2 : émise, couverte en partie par un avoir de 20,00 € TTC, sans règlement. Lecture écartée (ancienne règle, seul un
  // règlement compte) : aucune précision.
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'EMISE', montantRegle: 0, montantAvoirs: 20, resteDu: 100 }, euros), 'Partiellement réglée');
  // Critère 4 : revenue « émise » par la contre-passation de son règlement, couverte en partie par son avoir de 70,00 €.
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'EMISE', montantRegle: 0, montantAvoirs: 70, resteDu: 50 }, euros), 'Partiellement réglée');
  // Couverte en partie par un règlement et un avoir.
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'EMISE', montantRegle: 30, montantAvoirs: 20, resteDu: 70 }, euros), 'Partiellement réglée');
  // Critères 1 et 7 : réglée par ses seuls avoirs (aucun règlement non contre-passé), reste dû nul : « Soldée par avoir ».
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'REGLEE', montantRegle: 0, montantAvoirs: 120, resteDu: 0 }, euros), 'Soldée par avoir');
  // N3 : émise à 0,00 € sans avoir, reste dû nul. Lecture écartée (ancienne branche « émise ») : « Soldée par avoir ».
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'EMISE', montantRegle: 0, montantAvoirs: 0, resteDu: 0 }, euros), '');
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'EMISE', montantRegle: null, montantAvoirs: null, resteDu: 0 }, euros), '');
  // Réglée par ses règlements, ou par un règlement et un avoir (critère 3) : aucune précision, un règlement la couvre.
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'REGLEE', montantRegle: 120, montantAvoirs: 0, resteDu: 0 }, euros), '');
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'REGLEE', montantRegle: 50, montantAvoirs: 70, resteDu: 0 }, euros), '');
  // Réglée sans règlement ni avoir connu : rien ne dit qu'un avoir la solde.
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'REGLEE', montantRegle: 0, montantAvoirs: null, resteDu: 0 }, euros), '');
  // Trop-perçu (inchangé), qu'un avoir suive le règlement ou non.
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'REGLEE', montantRegle: 120, montantAvoirs: 12, resteDu: -12 }, euros), 'Trop-perçu : 12,00 €');
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'REGLEE', montantRegle: 130, montantAvoirs: 0, resteDu: -10 }, euros), 'Trop-perçu : 10,00 €');
  // Ni un avoir, ni un brouillon, ni une facture annulée (soldes absents) n'ont de précision.
  assert.equal(situationReglement({ type: 'AVOIR', statut: 'EMISE', montantRegle: null, montantAvoirs: null, resteDu: null }, euros), '');
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'BROUILLON', resteDu: null }, euros), '');
  assert.equal(situationReglement({ type: 'FACTURE', statut: 'ANNULEE', montantRegle: null, montantAvoirs: null, resteDu: null }, euros), '');
  assert.equal(libelleMoyen('CHEQUE'), 'Chèque');
});
