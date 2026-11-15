// Lot « marge d'un contrat de maintenance, heures valorisées au prix sous contrat » (cadrage v3, § 4 « Écran
// Contrats de maintenance » ; décisions de Nelson du 15-11-2026 : « Par contrat », « Depuis le début », « Selon la
// politique », « Coût gardé, signalée », « Coût seul », « Coût seul, non vendues »). Mise en forme du détail et des
// signalements de la marge d'un contrat, que l'écran affiche à l'administration seule.
import assert from 'node:assert/strict';
import test from 'node:test';
import { alertesMargeContrat, detailMargeContrat, type MargeContrat } from '../src/lib/margeContrat.ts';
import { fmtEuroCentime } from '../src/lib/formats.ts';

// Format témoin, distinct du format de l'écran : il prouve que chaque montant passe par la fonction donnée (un montant
// écrit en dur ou par un autre format s'y verrait).
const euros = (valeur: number) => `<${valeur.toFixed(2)}>`;
// Valeurs toutes distinctes : une inversion de deux champs dans la phrase se voit.
const MARGE: MargeContrat = {
  ventesHT: 236.02, coutsHT: 205.35, materielHT: 0, materielExcluHT: 0, margeHT: 30.67,
  heuresValorisees: 4.97, heuresNonValorisees: 0, intervenantsNonValorises: [], heuresAnnulees: 0,
  contratAnnule: false, nombreInterventions: 3, nombreInterventionsAnnulees: 0,
};

test('détail de la marge d’un contrat : ventes au prix sous contrat et coût, depuis son début, au pluriel pour plusieurs interventions', () => {
  assert.equal(
    detailMargeContrat(MARGE, euros),
    'Heures des 3 interventions du contrat, depuis son début, vendues <236.02> HT au prix sous contrat des mains d’œuvre, moins leur coût de <205.35> HT.',
  );
});

test('détail de la marge d’un contrat : une seule intervention au singulier, aucune intervention en une phrase propre', () => {
  assert.equal(
    detailMargeContrat({ ...MARGE, nombreInterventions: 1 }, euros),
    'Heures de l’intervention du contrat, depuis son début, vendues <236.02> HT au prix sous contrat des mains d’œuvre, moins leur coût de <205.35> HT.',
  );
  // Sans intervention, la phrase ne cite aucun montant, même si des montants étaient transmis.
  assert.equal(detailMargeContrat({ ...MARGE, nombreInterventions: 0 }, euros), 'Aucune intervention sur ce contrat pour l’instant.');
  // Deux interventions : pluriel, et non « de l’intervention » (seuil écarté : > 1 et non > 2).
  assert.match(detailMargeContrat({ ...MARGE, nombreInterventions: 2 }, euros), /^Heures des 2 interventions du contrat, depuis son début,/);
});

test('détail de la marge d’un contrat : matériel inclus compté à son coût dans la phrase, matériel hors forfait montré à part, hors marge', () => {
  // Décision « Selon la politique » : matériel inclus compté à son coût ; hors forfait exclu de la marge, montré à part
  // (choix par défaut d'affichage, à confirmer).
  assert.equal(
    detailMargeContrat({ ...MARGE, materielHT: 12.5 }, euros),
    'Heures des 3 interventions du contrat, depuis son début, vendues <236.02> HT au prix sous contrat des mains d’œuvre, moins leur coût de <205.35> HT et le matériel inclus au contrat, à son coût de <12.50> HT.',
  );
  assert.equal(
    detailMargeContrat({ ...MARGE, materielExcluHT: 48.3 }, euros),
    'Heures des 3 interventions du contrat, depuis son début, vendues <236.02> HT au prix sous contrat des mains d’œuvre, moins leur coût de <205.35> HT. Matériel hors forfait, hors marge : <48.30> HT.',
  );
  assert.equal(
    detailMargeContrat({ ...MARGE, materielHT: 12.5, materielExcluHT: 48.3 }, euros),
    'Heures des 3 interventions du contrat, depuis son début, vendues <236.02> HT au prix sous contrat des mains d’œuvre, moins leur coût de <205.35> HT et le matériel inclus au contrat, à son coût de <12.50> HT. Matériel hors forfait, hors marge : <48.30> HT.',
  );
  // Aucun texte « facturé à part » (cadrage, § 4 : aucune règle de facturation décidée).
  assert.doesNotMatch(detailMargeContrat({ ...MARGE, materielHT: 12.5, materielExcluHT: 48.3 }, euros), /factur/i);
});

test('détail de la marge d’un contrat au format de l’écran : montants en euros au format français', () => {
  const texte = detailMargeContrat({ ...MARGE, ventesHT: 1234.5, coutsHT: 987.65, materielHT: 12.5, materielExcluHT: 48.3 }, fmtEuroCentime);
  // Espaces insécables du format français normalisées pour la lecture.
  assert.equal(
    texte.replace(/[  ]/g, ' '),
    'Heures des 3 interventions du contrat, depuis son début, vendues 1 234,50 € HT au prix sous contrat des mains d’œuvre, moins leur coût de 987,65 € HT et le matériel inclus au contrat, à son coût de 12,50 € HT. Matériel hors forfait, hors marge : 48,30 € HT.',
  );
});

test('signalements : aucun quand toutes les heures sont vendues', () => {
  assert.deepEqual(alertesMargeContrat(MARGE), []);
});

test('signalements : marge incomplète avec les heures sans prix et les intervenants nommés, homonymes compris', () => {
  // Décision « Coût gardé, signalée » : l'écran signale la marge incomplète avec les heures et les intervenants concernés.
  assert.deepEqual(alertesMargeContrat({ ...MARGE, heuresNonValorisees: 2.25, intervenantsNonValorises: ['TEST Dupont', 'TEST Émile'] }), [
    'Marge incomplète : 2,25 h sans prix de vente (TEST Dupont, TEST Émile). Une heure d’un intervenant sans main d’œuvre le jour de la saisie, ou saisie avant la valorisation sous contrat, n’est pas vendue ; son coût reste compté.',
  ]);
  // Deux homonymes distincts (dédoublonnés par identifiant côté serveur) : le nom deux fois, tel qu'envoyé.
  assert.deepEqual(alertesMargeContrat({ ...MARGE, heuresNonValorisees: 1.5, intervenantsNonValorises: ['TEST Martin', 'TEST Martin'] }), [
    'Marge incomplète : 1,5 h sans prix de vente (TEST Martin, TEST Martin). Une heure d’un intervenant sans main d’œuvre le jour de la saisie, ou saisie avant la valorisation sous contrat, n’est pas vendue ; son coût reste compté.',
  ]);
  // Une heure à zéro sans prix suffit à signaler : le signalement suit les intervenants, non le total d'heures.
  assert.match(alertesMargeContrat({ ...MARGE, heuresNonValorisees: 0, intervenantsNonValorises: ['TEST Dupont'] })[0] ?? '', /^Marge incomplète : 0 h sans prix de vente \(TEST Dupont\)\./);
});

test('signalements : heures des interventions annulées comptées au coût, sans vente, après la marge incomplète', () => {
  // Décision « Coût seul (Recommandé) » pour les heures d'une visite ou d'une suite annulée.
  assert.deepEqual(alertesMargeContrat({ ...MARGE, heuresAnnulees: 3, nombreInterventionsAnnulees: 1 }), [
    'Les heures des interventions annulées (3 h) comptent dans le coût, sans être vendues.',
  ]);
  const deux = alertesMargeContrat({ ...MARGE, heuresNonValorisees: 0.75, intervenantsNonValorises: ['TEST Zoé'], heuresAnnulees: 1.25, nombreInterventionsAnnulees: 1 });
  assert.equal(deux.length, 2);
  assert.match(deux[0], /^Marge incomplète : 0,75 h sans prix de vente \(TEST Zoé\)\./);
  assert.equal(deux[1], 'Les heures des interventions annulées (1,25 h) comptent dans le coût, sans être vendues.');
});

test('signalements : un contrat annulé n’a qu’un signalement, sans marge incomplète ni heures annulées', () => {
  // Décision « Coût seul, non vendues (Recommandé) » : aucune heure vendue, coût gardé. Le serveur envoie alors toutes les
  // heures en heuresAnnulees et aucun intervenant non valorisé ; même si des champs l'étaient, seul ce signalement reste.
  assert.deepEqual(alertesMargeContrat({ ...MARGE, contratAnnule: true, ventesHT: 0, heuresAnnulees: 4.5 }), [
    'Contrat annulé : aucune heure n’est vendue ; leur coût reste compté.',
  ]);
  assert.deepEqual(alertesMargeContrat({ ...MARGE, contratAnnule: true, heuresAnnulees: 4.5, heuresNonValorisees: 1, intervenantsNonValorises: ['TEST Dupont'] }), [
    'Contrat annulé : aucune heure n’est vendue ; leur coût reste compté.',
  ]);
});
