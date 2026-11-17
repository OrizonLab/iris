import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ciblesEncorePossibles, ciblesProposees, questionAnnulation, texteCible, type DevisAConvertir } from '../src/lib/ciblesDevis.ts';
import { INFORMATION_SANS_ACOMPTE, informationAcompte } from '../src/lib/acompteDevis.ts';

// Lot 4 suite : au plus deux conversions par devis, de types différents.
const conversion = (cibleType: string, rang = 1) => ({ cibleType, cibleId: `${cibleType}-1`, rang });

test('un devis sans conversion propose les trois cibles', () => {
  assert.deepEqual(ciblesEncorePossibles([]), ['CHANTIER', 'INTERVENTION', 'CONTRAT']);
});

test('après une conversion, les deux autres types restent proposés', () => {
  assert.deepEqual(ciblesEncorePossibles([conversion('CHANTIER')]), ['INTERVENTION', 'CONTRAT']);
  assert.deepEqual(ciblesEncorePossibles([conversion('CONTRAT')]), ['CHANTIER', 'INTERVENTION']);
  assert.deepEqual(ciblesEncorePossibles([conversion('INTERVENTION')]), ['CHANTIER', 'CONTRAT']);
});

test('après deux conversions, plus rien n’est proposé', () => {
  assert.deepEqual(ciblesEncorePossibles([conversion('CHANTIER'), conversion('CONTRAT', 2)]), []);
  assert.deepEqual(ciblesEncorePossibles([conversion('INTERVENTION'), conversion('CHANTIER', 2)]), []);
});

test('la question d’annulation dit ce qui sera annulé avec le devis', () => {
  assert.equal(questionAnnulation([]), 'Motif de l’annulation de ce devis ?');
  assert.equal(questionAnnulation([conversion('CHANTIER')]), 'L’annulation de ce devis annule aussi son chantier.\nMotif de l’annulation de ce devis ?');
  assert.equal(questionAnnulation([conversion('INTERVENTION'), conversion('CONTRAT', 2)]),
    'L’annulation de ce devis annule aussi son contrat de maintenance et les visites non réalisées de ce contrat, son intervention.\nMotif de l’annulation de ce devis ?');
  assert.equal(questionAnnulation([conversion('CONTRAT'), conversion('CHANTIER', 2)]),
    'L’annulation de ce devis annule aussi son chantier, son contrat de maintenance et les visites non réalisées de ce contrat.\nMotif de l’annulation de ce devis ?');
});

test('chaque cible a sa ligne, avant et après l’annulation du devis', () => {
  assert.equal(texteCible('CHANTIER', false), 'Chantier issu de ce devis');
  assert.equal(texteCible('CHANTIER', true), 'Chantier annulé avec le devis');
  assert.equal(texteCible('INTERVENTION', false), 'Intervention issue de ce devis');
  assert.equal(texteCible('INTERVENTION', true), 'Intervention issue de ce devis, annulée');
  assert.equal(texteCible('CONTRAT', false), 'Contrat de maintenance issu de ce devis');
  assert.equal(texteCible('CONTRAT', true), 'Contrat de maintenance annulé avec le devis');
});

// Lot « acompte des devis » (cadrage v3.1 du 17-11-2026, section 4, « Écran (`Devis.tsx:267`, `conversionsProposees`) :
// intervention et contrat : statut `ACCEPTE` ou `EN_ATTENTE_ACOMPTE`, devis signé, dernière version ; chantier : statut
// `ACCEPTE`, acompte non exigé ou constaté ») ; décision de Nelson du 17-11-2026, « L'acompte ne bloque que le chantier ».
// Lectures écartées : l'ancienne condition commune (rien n'est proposé tant que l'acompte exigé n'est pas constaté) ;
// l'intervention non proposée en attente d'acompte ; le chantier proposé avant la constatation ou en attente d'acompte.
const devisEcran = (extra: Partial<DevisAConvertir> = {}): DevisAConvertir => ({
  statut: 'ACCEPTE', signature: { signataire: 'Client' }, acompteExige: false, acompteRecuLe: null, conversions: [], ...extra,
});
const TOUTES = ['CHANTIER', 'INTERVENTION', 'CONTRAT'];

test('acompte exigé non constaté, devis accepté : l’intervention et le contrat sont proposés, pas le chantier', () => {
  assert.deepEqual(ciblesProposees(devisEcran({ acompteExige: true }), true), ['INTERVENTION', 'CONTRAT']);
});

test('en attente d’acompte : l’intervention et le contrat sont proposés, jamais le chantier, même acompte constaté', () => {
  assert.deepEqual(ciblesProposees(devisEcran({ statut: 'EN_ATTENTE_ACOMPTE', acompteExige: true }), true), ['INTERVENTION', 'CONTRAT']);
  // En attente d'acompte, acompte constaté (la route de statut y fait passer un devis accepté dont l'acompte est déjà
  // constaté, audit des droits de #576) : le chantier suit le statut.
  assert.deepEqual(ciblesProposees(devisEcran({ statut: 'EN_ATTENTE_ACOMPTE', acompteExige: true, acompteRecuLe: '2026-11-17T00:00:00.000Z' }), true), ['INTERVENTION', 'CONTRAT']);
});

test('acompte constaté ou non exigé, devis accepté : les trois cibles sont proposées', () => {
  assert.deepEqual(ciblesProposees(devisEcran({ acompteExige: true, acompteRecuLe: '2026-11-17T00:00:00.000Z' }), true), TOUTES);
  assert.deepEqual(ciblesProposees(devisEcran(), true), TOUTES);
});

test('conversions déjà faites : seules les cibles encore possibles, selon l’acompte', () => {
  const converti = devisEcran({ statut: 'EN_ATTENTE_ACOMPTE', acompteExige: true, conversions: [conversion('INTERVENTION')] });
  assert.deepEqual(ciblesProposees(converti, true), ['CONTRAT']);
  assert.deepEqual(ciblesProposees({ ...converti, statut: 'ACCEPTE', acompteRecuLe: '2026-11-17T00:00:00.000Z' }, true), ['CHANTIER', 'CONTRAT']);
  assert.deepEqual(ciblesProposees({ ...converti, conversions: [conversion('INTERVENTION'), conversion('CONTRAT', 2)] }, true), []);
});

test('rien n’est proposé sans signature, hors de la dernière version, ni dans un autre statut', () => {
  assert.deepEqual(ciblesProposees(devisEcran({ signature: null }), true), []);
  assert.deepEqual(ciblesProposees(devisEcran({ statut: 'EN_ATTENTE_ACOMPTE', acompteExige: true, signature: null }), true), []);
  assert.deepEqual(ciblesProposees(devisEcran({ acompteExige: true }), false), []);
  assert.deepEqual(ciblesProposees(devisEcran({ statut: 'EN_ATTENTE_ACOMPTE', acompteExige: true }), false), []);
  for (const statut of ['BROUILLON', 'ENVOYE', 'REFUSE', 'ANNULE']) {
    assert.deepEqual(ciblesProposees(devisEcran({ statut }), true), [], statut);
    assert.deepEqual(ciblesProposees(devisEcran({ statut, acompteExige: true }), true), [], `${statut}, acompte exigé`);
  }
});

// Cadrage v3.1, section 3, « Information après l'enregistrement » (choix par défaut d'affichage, règle 5, à confirmer) :
// « quand la requête portait `acompteExige: true` et que la réponse porte `false`, l'écran affiche une information (…) :
// « Devis enregistré sans acompte : le taux d'acompte par défaut de la société est de 0 %. » ». Lectures écartées :
// information sans acompte demandé ; condition inversée (réponse exigée) ; information sur une réponse sans le champ.
test('information « enregistré sans acompte » : seulement quand l’acompte était demandé et que la réponse n’en exige pas', () => {
  assert.equal(INFORMATION_SANS_ACOMPTE, 'Devis enregistré sans acompte : le taux d’acompte par défaut de la société est de 0 %.');
  assert.equal(informationAcompte(true, { acompteExige: false }), INFORMATION_SANS_ACOMPTE);
  assert.equal(informationAcompte(true, { acompteExige: true }), '');
  assert.equal(informationAcompte(false, { acompteExige: false }), '');
  assert.equal(informationAcompte(false, { acompteExige: true }), '');
  assert.equal(informationAcompte(true, {}), '');
  assert.equal(informationAcompte(true, null), '');
  assert.equal(informationAcompte(true, undefined), '');
});
