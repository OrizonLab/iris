import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTIF_HEURES_ANCIEN_DEVIS, MOTIF_HEURES_QUART_HEURE, dureeTempsPasse, erreurTempsPasse, formatPrix, heuresAuPas, ligneTempsPasse, mentionTempsPasse, prixDuTarif,
  refusQuantiteTempsPasse, REFUS_QUANTITE, REFUS_QUANTITE_POSITIVE, REFUS_SANS_LIGNE,
} from '../src/lib/tempsPasse.ts';
import { ligneAEnvoyer, ligneEnEdition, type FicheCatalogueDevis } from '../src/lib/catalogueDevis.ts';

const mainOeuvre: FicheCatalogueDevis = { famille: 'prestations', id: 'mo-1', reference: 'MO-ELEC', nom: 'Électricien', unite: 'heure', nature: 'MAIN_OEUVRE', prixVenteHt: 45.5, tauxTva: 20, estMainOeuvre: true, prixHeureSousContratHt: 40 };
const prestation: FicheCatalogueDevis = { famille: 'prestations', id: 'p-1', reference: 'POSE', nom: 'Pose', unite: 'forfait', nature: 'MAIN_OEUVRE', prixVenteHt: 250, tauxTva: 20 };

test('prix de l’heure : hors contrat, le prix de vente ; sous contrat, le prix à l’heure sous contrat ; jamais pour une prestation ordinaire', () => {
  assert.equal(prixDuTarif(mainOeuvre, 'HORS_CONTRAT'), 45.5);
  assert.equal(prixDuTarif(mainOeuvre, 'SOUS_CONTRAT'), 40);
  assert.equal(prixDuTarif(prestation, 'HORS_CONTRAT'), null);
  assert.equal(ligneTempsPasse(prestation, 'HORS_CONTRAT'), null);
});

test('ligne créée à une heure, à l’heure, au prix et à la TVA de la main d’œuvre ; le corps envoyé porte le prix affiché, sans prix d’achat', () => {
  const ligne = ligneTempsPasse(mainOeuvre, 'SOUS_CONTRAT')!;
  assert.deepEqual(ligne, {
    tempsPasse: true, tarifTempsPasse: 'SOUS_CONTRAT', designation: 'Main d’œuvre au temps passé — Électricien',
    nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 40, tauxTva: 20, unite: 'heure', reference: 'MO-ELEC', catalogueFamille: 'prestations', catalogueId: 'mo-1',
  });
  assert.deepEqual(ligneAEnvoyer({ ...ligne, prixAchatUnitaireHt: '3' }, true), {
    tempsPasse: true, designation: 'Main d’œuvre au temps passé — Électricien', quantite: 1, prixUnitaireHt: 40, tauxTva: 20, tarifTempsPasse: 'SOUS_CONTRAT', catalogueFamille: 'prestations', catalogueId: 'mo-1',
  });
  // La TVA de la ligne est celle de la main d'œuvre.
  assert.equal(ligneTempsPasse({ ...mainOeuvre, tauxTva: 10 }, 'HORS_CONTRAT')!.tauxTva, 10);
  // Une ligne existante garde son identifiant, son tarif et son prix figé.
  const existante = ligneEnEdition({ id: 'l-1', designation: 'MO', nature: 'MAIN_OEUVRE', quantite: 2, prixUnitaireHt: 45.5, tauxTva: 20, unite: 'heure', reference: 'MO-ELEC', catalogueFamille: 'prestations', catalogueId: 'mo-1', tempsPasse: true, tarifTempsPasse: 'HORS_CONTRAT', prixAchatUnitaireHt: null }, true);
  assert.deepEqual([existante.ligneId, existante.tempsPasse, existante.tarifTempsPasse, existante.prixUnitaireHt, 'prixAchatUnitaireHt' in existante], ['l-1', true, 'HORS_CONTRAT', 45.5, false]);
  // Lot devis (cadrage v3, section 4) : les heures, saisies en texte, sont remises en édition à la virgule (« 2 ») et envoyées
  // telles quelles ; le prix et la TVA, fixés par la main d'œuvre, restent des nombres (avant le lot : quantite 2, en nombre).
  assert.deepEqual(ligneAEnvoyer(existante, true), { ligneId: 'l-1', tempsPasse: true, designation: 'MO', quantite: '2', prixUnitaireHt: 45.5, tauxTva: 20, tarifTempsPasse: 'HORS_CONTRAT', catalogueFamille: 'prestations', catalogueId: 'mo-1' });
  // Heures au millième : envoyées telles que saisies, remises en édition à la virgule (« 1,25 », et non 1.25).
  assert.equal(ligneAEnvoyer({ ...ligne, quantite: 1.25 }, true).quantite, 1.25);
  assert.equal(ligneAEnvoyer({ ...ligne, quantite: '1,25' }, true).quantite, '1,25');
  assert.equal(ligneEnEdition({ id: 'l-2', designation: 'MO', nature: 'MAIN_OEUVRE', quantite: 1.25, prixUnitaireHt: 45.5, tauxTva: 20, unite: 'heure', reference: 'MO-ELEC', catalogueFamille: 'prestations', catalogueId: 'mo-1', tempsPasse: true, tarifTempsPasse: 'HORS_CONTRAT' }, true).quantite, '1,25');
  // Une ligne existante à un autre prix et une autre TVA les garde, en édition comme dans le corps envoyé.
  const autre = ligneEnEdition({ id: 'l-3', designation: 'MO', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 47, tauxTva: 10, unite: 'heure', reference: 'MO-PLOMB', catalogueFamille: 'prestations', catalogueId: 'mo-2', tempsPasse: true, tarifTempsPasse: 'SOUS_CONTRAT' }, true);
  assert.deepEqual([autre.prixUnitaireHt, autre.tauxTva, ligneAEnvoyer(autre, true).prixUnitaireHt, ligneAEnvoyer(autre, true).tauxTva], [47, 10, 47, 10]);
});

test('quantité : le minimum figé puis des multiples du pas ; une heure au moins sans minimum ; positive seulement quand les réglages sont inconnus', () => {
  const reglages = { tempsMinimumMinutes: 60, pasTempsPasseMinutes: 15 };
  for (const quantite of [1, 1.25, 1.5, 2, 10]) assert.equal(refusQuantiteTempsPasse(quantite, reglages), null, String(quantite));
  const refus = 'La ligne au temps passé vaut le temps minimum facturé du devis (1 h), puis des tranches de 15 minutes : en heures, 1 ; 1,25 ; 1,5…';
  for (const quantite of [0.25, 0.75, 0.999, 1.001, 1.1, 1.333]) assert.equal(refusQuantiteTempsPasse(quantite, reglages), refus, String(quantite));
  const autres = { tempsMinimumMinutes: 30, pasTempsPasseMinutes: 45 };
  for (const quantite of [0.5, 1.25, 2]) assert.equal(refusQuantiteTempsPasse(quantite, autres), null, String(quantite));
  for (const quantite of [1, 0.75, 1.5]) assert.equal(refusQuantiteTempsPasse(quantite, autres), 'La ligne au temps passé vaut le temps minimum facturé du devis (30 min), puis des tranches de 45 minutes : en heures, 0,5 ; 1,25 ; 2…', String(quantite));
  // Devis antérieur au lot : minimum vide, une heure au moins, au millième.
  const ancien = { tempsMinimumMinutes: null, pasTempsPasseMinutes: 10 };
  assert.equal(refusQuantiteTempsPasse(1, ancien), null, 'une heure tout juste, comme avant le lot');
  assert.equal(refusQuantiteTempsPasse(1.001, ancien), null);
  assert.equal(refusQuantiteTempsPasse(0.999, ancien), REFUS_QUANTITE);
  // Nouveau devis : réglages inconnus de l'écran, le serveur contrôle le reste.
  assert.equal(refusQuantiteTempsPasse(0.25, null), null);
  for (const quantite of [0, -1, Number(''), Infinity, NaN]) assert.equal(refusQuantiteTempsPasse(quantite, null), REFUS_QUANTITE_POSITIVE, String(quantite));
  for (const [minutes, texte] of [[15, '15 min'], [60, '1 h'], [75, '1 h 15 min'], [480, '8 h']] as const) assert.equal(dureeTempsPasse(minutes), texte);
});

test('une ligne au temps passé et une seule sur un devis au temps passé, à la quantité permise par le devis', () => {
  const ligne = ligneTempsPasse(mainOeuvre, 'HORS_CONTRAT')!;
  const libre = { designation: 'Câble', nature: 'FOURNITURE' as const, quantite: 2, prixUnitaireHt: 3, tauxTva: 20 };
  assert.equal(erreurTempsPasse(true, [ligne, libre]), null);
  assert.equal(erreurTempsPasse(true, [{ ...ligne, quantite: 0.5 }]), null);
  assert.equal(erreurTempsPasse(true, [{ ...ligne, quantite: 0 }]), REFUS_QUANTITE_POSITIVE);
  assert.equal(erreurTempsPasse(true, [{ ...ligne, quantite: 0.5 }], { tempsMinimumMinutes: null, pasTempsPasseMinutes: 15 }), REFUS_QUANTITE);
  assert.match(erreurTempsPasse(true, [{ ...ligne, quantite: 1.1 }], { tempsMinimumMinutes: 60, pasTempsPasseMinutes: 15 })!, /tranches de 15 minutes/);
  assert.equal(erreurTempsPasse(true, [libre]), REFUS_SANS_LIGNE);
  assert.equal(erreurTempsPasse(true, [ligne, { ...ligne }]), REFUS_SANS_LIGNE);
  assert.equal(erreurTempsPasse(false, [libre]), null);
});

test('mention d’un devis antérieur au temps minimum (minimum vide) : prix, tarif et pas figés du devis, le texte d’alors, comme le PDF ; aucune pour un devis ordinaire', () => {
  const devis = { auTempsPasse: true, pasTempsPasseMinutes: 15, lignes: [{ tempsPasse: false, prixUnitaireHt: 3, quantite: 2 }, { tempsPasse: true, tarifTempsPasse: 'HORS_CONTRAT' as const, prixUnitaireHt: 45.5, quantite: 1 }] };
  assert.equal(mentionTempsPasse(devis), 'Devis au temps passé : une heure minimum facturée au prix de 45,50 € HT de l’heure (tarif à l’heure hors contrat), hors matériel ; au-delà de la première heure, le temps passé se facture par tranches de 15 minutes, toute tranche commencée étant due. Le total de ce devis est un minimum.');
  assert.match(mentionTempsPasse({ ...devis, pasTempsPasseMinutes: 1, lignes: [{ tempsPasse: true, tarifTempsPasse: 'SOUS_CONTRAT', prixUnitaireHt: 40, quantite: 1 }] })!, /40,00 € HT de l’heure \(tarif à l’heure sous contrat\).*tranches de 1 minute, toute/);
  // Plus d'une heure : la quantité de la ligne est le minimum facturé, au pluriel dès deux heures.
  assert.match(mentionTempsPasse({ ...devis, lignes: [{ tempsPasse: true, tarifTempsPasse: 'HORS_CONTRAT', prixUnitaireHt: 45.5, quantite: 2 }] })!, /^Devis au temps passé : 2 heures minimum facturées au prix de 45,50 €/);
  assert.match(mentionTempsPasse({ ...devis, lignes: [{ tempsPasse: true, tarifTempsPasse: 'HORS_CONTRAT', prixUnitaireHt: 45.5, quantite: 1.5 }] })!, /^Devis au temps passé : 1,5 heure minimum facturée au prix de 45,50 €/);
  // Quantités au millième : la quantité exacte de la ligne, au singulier sous deux heures, comme le PDF.
  for (const [quantite, heures] of [[1.001, '1,001 heure minimum facturée'], [1.999, '1,999 heure minimum facturée'], [10.125, '10,125 heures minimum facturées']] as const) {
    const texte = mentionTempsPasse({ ...devis, lignes: [{ tempsPasse: true, tarifTempsPasse: 'HORS_CONTRAT', prixUnitaireHt: 45.5, quantite }] })!;
    assert.ok(texte.startsWith(`Devis au temps passé : ${heures} au prix de 45,50 € HT de l’heure`), `${quantite} : ${texte}`);
  }
  assert.equal(mentionTempsPasse({ ...devis, auTempsPasse: false }), null);
  assert.equal(mentionTempsPasse({ ...devis, pasTempsPasseMinutes: null }), null);
  assert.equal(formatPrix(1234.5).replace(/\s/g, ' '), '1 234,50 €');
  // Prix au centime et pas de deux minutes : le prix exact, et le pluriel dès deux minutes.
  assert.equal(formatPrix(45.55), '45,55 €');
  assert.match(mentionTempsPasse({ ...devis, pasTempsPasseMinutes: 2, lignes: [{ tempsPasse: true, tarifTempsPasse: 'HORS_CONTRAT', prixUnitaireHt: 45.55, quantite: 1 }] })!, /au prix de 45,55 € HT de l’heure \(tarif à l’heure hors contrat\).*tranches de 2 minutes, toute/);
});

test('mention avec le minimum figé : minimum et pas, total minimum ou estimation au-delà, le même texte que le PDF', () => {
  const devis = (quantite: number, tempsMinimumMinutes = 60, pasTempsPasseMinutes = 15) => ({ auTempsPasse: true, pasTempsPasseMinutes, tempsMinimumMinutes, lignes: [{ tempsPasse: true, tarifTempsPasse: 'HORS_CONTRAT' as const, prixUnitaireHt: 45.5, quantite }] });
  const regle = (minimum: string, pas: number) => `Devis au temps passé : au prix de 45,50 € HT de l’heure (tarif à l’heure hors contrat), hors matériel, le temps passé se facture avec un minimum de ${minimum}, puis par tranches de ${pas} minutes au-delà, toute tranche commencée étant due.`;
  assert.equal(mentionTempsPasse(devis(1)), `${regle('1 h', 15)} Le total de ce devis est un minimum.`);
  assert.equal(mentionTempsPasse(devis(1.5)), `${regle('1 h', 15)} Ce devis prévoit 1 h 30 min : son total est une estimation, la facture reprenant le temps réellement passé, avec au moins le minimum.`);
  assert.equal(mentionTempsPasse(devis(0.5, 30, 45)), `${regle('30 min', 45)} Le total de ce devis est un minimum.`);
  assert.equal(mentionTempsPasse(devis(2.75, 30, 45)), `${regle('30 min', 45)} Ce devis prévoit 2 h 45 min : son total est une estimation, la facture reprenant le temps réellement passé, avec au moins le minimum.`);
  assert.equal(mentionTempsPasse(devis(8, 480, 60)), `${regle('8 h', 60)} Le total de ce devis est un minimum.`);
});

// ===================================================================================================================
// Lot devis (cadrage v3 du 16-11-2026, section 4 ; #394 pour le devis) : les heures d'une ligne au temps passé sont saisies
// en texte. Règle d'écran gardée (C9 du contrôle, option (a)) : des quarts d'heure à partir d'un quart d'heure (nouveau devis
// ou réglages figés), une heure au moins au millième (devis antérieur) ; le minimum et le pas figés refusés avant l'envoi
// par erreurTempsPasse, qui lit la virgule ; les flèches du clavier rétablies (heuresAuPas).
// ===================================================================================================================

// Cadrage, C7 : « `client/src/lib/tempsPasse.ts:80` (`refusQuantiteTempsPasse(Number(quantite))`) doit lire la virgule.
// Sinon « 1,25 » devient `NaN` et l'écran refuse une saisie valide (`Devis.tsx:157-158`). » Lecture écartée : `Number`
// (« 1,25 » → NaN → « quantité positive » refusée).
test('heures saisies à la virgule : « 1,25 » admise au minimum d’une heure et au pas de 15 minutes, comme « 1.25 » ; « 1,1 » refusée ; vide ou texte : quantité positive exigée', () => {
  const reglages = { tempsMinimumMinutes: 60, pasTempsPasseMinutes: 15 };
  const refus = 'La ligne au temps passé vaut le temps minimum facturé du devis (1 h), puis des tranches de 15 minutes : en heures, 1 ; 1,25 ; 1,5…';
  for (const saisie of ['1,25', '1.25', '1', '1,5', '1,750', ' 2,25 ']) assert.equal(refusQuantiteTempsPasse(saisie, reglages), null, saisie);
  for (const saisie of ['1,1', '0,75', '1,001', '1,333']) assert.equal(refusQuantiteTempsPasse(saisie, reglages), refus, saisie);
  for (const saisie of ['', '  ', 'abc', '0', '0,00', '-1']) assert.equal(refusQuantiteTempsPasse(saisie, reglages), REFUS_QUANTITE_POSITIVE, saisie);
  // Devis antérieur au lot (minimum vide) : une heure au moins, au millième, lue à la virgule.
  const ancien = { tempsMinimumMinutes: null, pasTempsPasseMinutes: 10 };
  assert.equal(refusQuantiteTempsPasse('1,001', ancien), null);
  assert.equal(refusQuantiteTempsPasse('0,999', ancien), REFUS_QUANTITE);
  // Nouveau devis : réglages inconnus de l'écran, une quantité positive à la virgule passe au serveur.
  assert.equal(refusQuantiteTempsPasse('0,25', null), null);
  // La ligne du formulaire, telle que saisie : avant le lot, « 1,25 » y était refusée (Number('1,25') = NaN).
  const ligne = ligneTempsPasse(mainOeuvre, 'HORS_CONTRAT')!;
  assert.equal(erreurTempsPasse(true, [{ ...ligne, quantite: '1,25' }], reglages), null);
  assert.equal(erreurTempsPasse(true, [{ ...ligne, quantite: '1,25' }], null), null);
  assert.match(erreurTempsPasse(true, [{ ...ligne, quantite: '2,25' }], { tempsMinimumMinutes: 60, pasTempsPasseMinutes: 30 })!, /tranches de 30 minutes/);
  assert.match(erreurTempsPasse(true, [{ ...ligne, quantite: '0,5' }], { tempsMinimumMinutes: 60, pasTempsPasseMinutes: 30 })!, /temps minimum facturé du devis \(1 h\)/);
});

// Cadrage, « Flèches » : « Les touches ArrowUp et ArrowDown ajoutent ou retirent un pas (`champ.step`), sans descendre sous le
// minimum (`champ.min`), et la valeur s'écrit à la virgule. Pour garder le comportement de `stepUp` : la valeur est recalée
// sur minimum + k × pas (de 1,25, avec un minimum de 1 et un pas de 0,5, ArrowUp donne 1,5) ; le résultat est arrondi au
// millième (`1.001 + 0.001` ne doit pas donner `1.0019999999999998`) ; un champ vide passe au minimum. Avec un minimum d'une
// heure et un pas de 15 minutes : de 1 à 1,25, puis 1,5. » Les réglages arrivent en minutes / 60, comme dans l'écran.
test('flèches : un pas de plus ou de moins, recalé sur minimum + k × pas, jamais sous le minimum, au millième, écrit à la virgule ; vide : le minimum', () => {
  const quartDHeure = { min: 60 / 60, step: 15 / 60 };
  assert.equal(heuresAuPas('1', quartDHeure, 1), '1,25');
  assert.equal(heuresAuPas('1,25', quartDHeure, 1), '1,5');
  assert.equal(heuresAuPas('1.25', quartDHeure, 1), '1,5', 'le point est lu aussi, la valeur s’écrit à la virgule');
  assert.equal(heuresAuPas('1,5', quartDHeure, -1), '1,25');
  assert.equal(heuresAuPas('1', quartDHeure, -1), '1', 'jamais sous le minimum');
  // Recalage, comme stepUp : de 1,25, minimum 1 et pas 0,5 → 1,5 vers le haut, 1 vers le bas.
  const demiHeure = { min: 60 / 60, step: 30 / 60 };
  assert.equal(heuresAuPas('1,25', demiHeure, 1), '1,5');
  assert.equal(heuresAuPas('1,25', demiHeure, -1), '1');
  // Minimum 1 h 30 et pas de 45 minutes : 1,5 puis 2,25 ; une valeur hors de la grille (2) est recalée.
  const troisQuarts = { min: 90 / 60, step: 45 / 60 };
  assert.equal(heuresAuPas('1,5', troisQuarts, 1), '2,25');
  assert.equal(heuresAuPas('2', troisQuarts, 1), '2,25');
  assert.equal(heuresAuPas('2', troisQuarts, -1), '1,5');
  // Devis antérieur (une heure au moins, au millième) : 1,001 puis 1,002, et non 1,0019999999999998.
  const ancien = { min: 1, step: 0.001 };
  assert.equal(heuresAuPas('1', ancien, 1), '1,001');
  assert.equal(heuresAuPas('1,001', ancien, 1), '1,002');
  assert.equal(heuresAuPas('1,999', ancien, 1), '2');
  assert.equal(heuresAuPas('2,5', ancien, -1), '2,499');
  // Audit des montants de #571 (N, mutant C21) : en millièmes entiers, chaque valeur de 1 à 20 heures au millième avance et
  // recule d'un millième exact ; un calcul en flottant (minimum + rang × pas) écrirait « 1,1219999999999999 » après 1,121.
  for (let m = 1000; m < 20_000; m += 1) {
    assert.equal(heuresAuPas(String(m / 1000).replace('.', ','), ancien, 1), String((m + 1) / 1000).replace('.', ','), `${m} ‰ vers le haut`);
    if (m > 1000) assert.equal(heuresAuPas(String(m / 1000).replace('.', ','), ancien, -1), String((m - 1) / 1000).replace('.', ','), `${m} ‰ vers le bas`);
  }
  // Nouveau devis (réglages inconnus) : un quart d'heure au moins, par quarts d'heure.
  const nouveau = { min: 0.25, step: 0.25 };
  assert.equal(heuresAuPas('0,25', nouveau, -1), '0,25');
  assert.equal(heuresAuPas('0,25', nouveau, 1), '0,5');
  // Champ vide, ou qui n'est pas un nombre : le minimum, dans les deux sens.
  for (const sens of [1, -1] as const) {
    assert.equal(heuresAuPas('', quartDHeure, sens), '1');
    assert.equal(heuresAuPas('abc', troisQuarts, sens), '1,5');
  }
  // Sous le minimum : vers le haut, le minimum ; vers le bas, rien ne change (null).
  assert.equal(heuresAuPas('0,5', quartDHeure, 1), '1');
  assert.equal(heuresAuPas('0,5', quartDHeure, -1), null);
});

// Motifs des heures (cadrage, « Règle d'écran gardée ») : nouveau devis ou réglages figés, des quarts d'heure à partir d'un
// quart d'heure, 9 chiffres avant la virgule (borne du serveur), 3 décimales au plus ; devis antérieur, une heure au moins,
// au millième, comme avant (« sans écart avec « forme du serveur, valeur ≥ 1 » »). Compilés avec le drapeau `v`, comme le
// navigateur, qui ignorerait en silence un motif invalide ; comparés à la règle réécrite sur toutes les parties décimales
// d'un à quatre chiffres et des parties entières aux bornes. Lectures écartées : zéro admis (« 0 », « 0,000 ») ; un pas de
// 0,25 sans les écritures « 1,250 », « 1,50 », « 1,500 » ; « 1,05 » ou « 1,2 » admis ; 10 chiffres admis.
test('motifs des heures : quarts d’heure à partir d’un quart d’heure, et une heure au moins au millième pour un devis antérieur ; compilés avec le drapeau v, aux bornes du serveur', () => {
  const compiler = (motif: string) => new RegExp(`^(?:${motif})$`, 'v');
  const entiers = ['0', '1', '2', '00', '01', '10', '000000000', '123456789', '0123456789', '1234567890'];
  const decimales: string[] = [];
  for (let longueur = 1; longueur <= 4; longueur += 1) for (let n = 0; n < 10 ** longueur; n += 1) decimales.push(String(n).padStart(longueur, '0'));
  const saisies = entiers.flatMap((entier) => [entier, ...decimales.flatMap((decimal) => [`${entier},${decimal}`, `${entier}.${decimal}`])]);
  const forme = (saisie: string) => /^\d{1,9}(?:[.,]\d{1,3})?$/.test(saisie);
  const milliemes = (saisie: string) => {
    const [entier, decimal = ''] = saisie.split(/[.,]/);
    return BigInt(entier) * 1000n + BigInt((decimal + '000').slice(0, 3));
  };
  const regles = [
    ['quart d’heure', MOTIF_HEURES_QUART_HEURE, (m: bigint) => m > 0n && m % 250n === 0n],
    ['devis antérieur', MOTIF_HEURES_ANCIEN_DEVIS, (m: bigint) => m >= 1000n],
  ] as const;
  for (const [nom, motif, valeurAdmise] of regles) {
    const expression = compiler(motif);
    const ecarts = saisies.filter((saisie) => expression.test(saisie) !== (forme(saisie) && valeurAdmise(milliemes(saisie))));
    assert.deepEqual(ecarts.slice(0, 10), [], `${nom} : saisies où le motif diffère de la règle`);
    for (const saisie of ['', ' 1', '1 ', '-1', '+1,25', '1e3', ',25', '1,', '1,,25', '1,25,5', 'abc']) assert.equal(expression.test(saisie), false, `${nom} : « ${saisie} »`);
  }
  // Témoins nommés du cadrage (E2E de devis-temps-passe : « 0 » et « 1.1 » refusés, « 2.25 », « 0.5 », « 1.25 » admis par le motif).
  assert.deepEqual(['0', '1.1', '1.25', '2.25', '0.5', '0,25', '1,250', '1,05'].map((s) => compiler(MOTIF_HEURES_QUART_HEURE).test(s)), [false, false, true, true, true, true, true, false]);
  assert.deepEqual(['0,999', '1', '01', '1,001', '0,5'].map((s) => compiler(MOTIF_HEURES_ANCIEN_DEVIS).test(s)), [false, true, true, true, false]);
});
