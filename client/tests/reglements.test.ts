import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centimesSaisis, libelleMoyen, repartirReglement, saisieDeCentimes, situationReglement } from '../src/lib/reglements.ts';
import { lignesReglementsFacture, type AvoirDeLaFacture, type PartReglement } from '../src/lib/reglementsFacture.ts';

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

// Lot « Détail des avoirs comme règlements, à l'écran et sur le PDF » (cadrage v2, § 1 ; C5 du contrôle de mode 1). Réponse de
// Nelson du 10-11-2026 au point 4, mot pour mot : « oui c'est bien ca, avec le detail des avoir en tant que reglement. » Le panneau
// mêle les parts de règlement et les avoirs partiels émis de la facture, dans l'ordre du PDF (choix d'affichage par défaut, à
// confirmer) : date civile (date du règlement, date d'émission de l'avoir), puis instant de saisie (création du règlement,
// émission de l'avoir), puis identifiant (de la part, de l'avoir). Ce n'est pas l'ordre du journal (instant de saisie seul).
// Le module ne met en forme aucun montant et n'additionne rien : le pied vient du solde de la réponse (C3).
const part = (id: string, dateReglement: string, createdAt: string, statut: 'ENREGISTRE' | 'CONTREPASSE' = 'ENREGISTRE'): PartReglement => ({
  id, montant: 10, reglement: { id: `r-${id}`, dateReglement, createdAt, moyen: 'VIREMENT', reference: null, statut, contrepasseLe: null, motifContrepassation: null },
});
const avoirDe = (id: string, dateEmission: string, emisLe: string): AvoirDeLaFacture => ({ id, numero: `A-${id}`, dateEmission, emisLe, totalTtc: 20 });
const ordre = (parts: PartReglement[], avoirs: AvoirDeLaFacture[]) => lignesReglementsFacture(parts, avoirs).map((l) => `${l.nature}:${l.id}`);

test('panneau des règlements et avoirs : lignes mêlées par date civile, puis instant de saisie, puis identifiant ; ni l’ordre du journal, ni paiements d’abord, ni avoirs d’abord', () => {
  const J2 = '2026-11-08T00:00:00.000Z'; const J1 = '2026-11-09T00:00:00.000Z'; const J = '2026-11-10T00:00:00.000Z';
  // Saisies, dans l'ordre : P1 (J−1), A1 (avoir, J), P2 (J−2), P3 (J), A2 (avoir, J), P4 (J−1, contre-passé).
  const parts = [
    part('p1', J1, '2026-11-10T09:00:00.000Z'), part('p2', J2, '2026-11-10T09:02:00.000Z'), part('p3', J, '2026-11-10T09:03:00.000Z'),
    part('p4', J1, '2026-11-10T09:05:00.000Z', 'CONTREPASSE'),
  ];
  const avoirs = [avoirDe('a1', J, '2026-11-10T09:01:00.000Z'), avoirDe('a2', J, '2026-11-10T09:04:00.000Z')];
  const attendu = ['PART:p2', 'PART:p1', 'PART:p4', 'AVOIR:a1', 'PART:p3', 'AVOIR:a2'];
  assert.deepEqual(ordre(parts, avoirs), attendu);
  // L'ordre des entrées ne compte pas (lecture écartée : ordre reçu conservé).
  assert.deepEqual(ordre([...parts].reverse(), [...avoirs].reverse()), attendu);
  // Lectures écartées, chacune distincte de l'attendu : journal (instant seul), paiements puis avoirs, avoirs puis paiements.
  for (const ecartee of [
    ['PART:p1', 'AVOIR:a1', 'PART:p2', 'PART:p3', 'AVOIR:a2', 'PART:p4'],
    ['PART:p2', 'PART:p1', 'PART:p4', 'PART:p3', 'AVOIR:a1', 'AVOIR:a2'],
    ['AVOIR:a1', 'AVOIR:a2', 'PART:p2', 'PART:p1', 'PART:p4', 'PART:p3'],
  ]) assert.notDeepEqual(ecartee, attendu);
  // La part contre-passée reste une ligne du panneau (critère 6 : « présent dans le panneau avec son statut »).
  assert.equal(lignesReglementsFacture(parts, avoirs).find((l) => l.id === 'p4')?.nature, 'PART');
  // Chaque ligne porte la part ou l'avoir reçus, tels quels.
  const lignes = lignesReglementsFacture(parts, avoirs);
  const ligneP2 = lignes[0]; const ligneA1 = lignes[3];
  assert.ok(ligneP2.nature === 'PART' && ligneP2.part === parts[1]);
  assert.ok(ligneA1.nature === 'AVOIR' && ligneA1.avoir === avoirs[0]);
  // Les tableaux reçus ne sont pas réordonnés.
  assert.deepEqual(parts.map((p) => p.id), ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(avoirs.map((a) => a.id), ['a1', 'a2']);
  // Sans part ni avoir : aucune ligne (le panneau affiche alors « Aucun règlement reçu. »).
  assert.deepEqual(lignesReglementsFacture([], []), []);
  // Avoir seul : une ligne, et non « Aucun règlement reçu. » (critère 1).
  assert.deepEqual(ordre([], [avoirDe('a1', J, '2026-11-10T09:01:00.000Z')]), ['AVOIR:a1']);
});

test('panneau des règlements et avoirs : à date et instant égaux, l’identifiant départage une part et un avoir, quel que soit l’ordre reçu ; l’instant compte à l’heure près et non au jour', () => {
  const J = '2026-11-10T00:00:00.000Z';
  const instant = '2026-11-10T10:00:00.000Z';
  // Identifiants : l'avoir « 0… » avant la part « f… » ; puis l'inverse. Lecture écartée : départage par la nature (parts d'abord,
  // ou avoirs d'abord), ou ordre reçu.
  assert.deepEqual(ordre([part('f-part', J, instant)], [avoirDe('0-avoir', J, instant)]), ['AVOIR:0-avoir', 'PART:f-part']);
  assert.deepEqual(ordre([part('0-part', J, instant)], [avoirDe('f-avoir', J, instant)]), ['PART:0-part', 'AVOIR:f-avoir']);
  // Deux parts au même instant : par identifiant, quel que soit l'ordre reçu.
  assert.deepEqual(ordre([part('p-b', J, instant), part('p-a', J, instant)], []), ['PART:p-a', 'PART:p-b']);
  // Une milliseconde départage (lecture écartée : instant comparé à la seconde ou au jour).
  assert.deepEqual(ordre([part('0-part', J, '2026-11-10T10:00:00.001Z')], [avoirDe('f-avoir', J, '2026-11-10T10:00:00.000Z')]), ['AVOIR:f-avoir', 'PART:0-part']);
  // La date civile prime sur l'instant : une part datée de la veille, saisie le lendemain de l'avoir, vient avant lui.
  assert.deepEqual(ordre([part('f-part', '2026-11-09T00:00:00.000Z', '2026-11-11T08:00:00.000Z')], [avoirDe('0-avoir', J, '2026-11-10T08:00:00.000Z')]), ['PART:f-part', 'AVOIR:0-avoir']);
});
