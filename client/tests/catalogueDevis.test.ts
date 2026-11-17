import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTIF_PRIX_DEVIS, MOTIF_QUANTITE_DEVIS, MOTIF_TVA_DEVIS, formatHeuresPrevues, ligneAEnvoyer, ligneDepuisCatalogue, ligneEnEdition, ligneVierge, nombreSaisi,
  type FicheCatalogueDevis,
} from '../src/lib/catalogueDevis.ts';
import { FORFAITS, LIBELLES_QUANTITE_FORFAIT, REFUS_FORFAIT_TEMPS_PASSE, REFUS_QUANTITE_FORFAIT, TARIFS_FORFAIT, UNITES_FORFAIT, erreurForfait, ligneForfait, prixDuForfait } from '../src/lib/forfaitMainOeuvre.ts';

const fiche: FicheCatalogueDevis = { famille: 'articles', id: 'fiche-1', reference: 'CAB-01', nom: 'Câble', unite: 'm', nature: 'FOURNITURE', prixVenteHt: 2.5, tauxTva: 20, prixAchatHt: 0.8 };

// Lot devis (cadrage v3 du 16-11-2026, section 4, « Pré-remplissage ») : la quantité, le PU HT et la TVA, saisis en texte, sont
// pré-remplis à la virgule (« 2,5 ») ; seule leur écriture change, pas leur valeur (avant le lot : 1, 2.5 et 20 en nombres).
test('une fiche devient une ligne copiée ; le prix d’achat n’est repris que pour qui le voit', () => {
  assert.deepEqual(ligneDepuisCatalogue(fiche, true), {
    designation: 'Câble', nature: 'FOURNITURE', quantite: '1', prixUnitaireHt: '2,5', tauxTva: '20', unite: 'm',
    reference: 'CAB-01', catalogueFamille: 'articles', catalogueId: 'fiche-1', prixAchatUnitaireHt: '0,8',
  });
  assert.ok(!('prixAchatUnitaireHt' in ligneDepuisCatalogue(fiche, false)));
  assert.equal(ligneDepuisCatalogue({ ...fiche, prixAchatHt: null }, true).prixAchatUnitaireHt, '');
});

test('corps envoyé : pas de prix d’achat sans droit d’écriture, ni de référence ; vide = effacé', () => {
  const ligne = ligneDepuisCatalogue(fiche, true);
  const sansDroit = ligneAEnvoyer(ligne, false);
  assert.ok(!('prixAchatUnitaireHt' in sansDroit));
  assert.ok(!('reference' in sansDroit));
  assert.deepEqual([sansDroit.catalogueFamille, sansDroit.catalogueId, sansDroit.unite], ['articles', 'fiche-1', 'm']);
  assert.equal(ligneAEnvoyer(ligne, true).prixAchatUnitaireHt, '0,8');
  assert.equal(ligneAEnvoyer({ ...ligne, prixAchatUnitaireHt: '  ' }, true).prixAchatUnitaireHt, null);
  // Une ligne sans le champ (chargée pour un compte qui ne le voyait pas) n'efface rien.
  const { prixAchatUnitaireHt: _absent, ...sansChamp } = ligne;
  assert.ok(!('prixAchatUnitaireHt' in ligneAEnvoyer(sansChamp, true)));
  const libre = ligneAEnvoyer({ designation: 'Libre', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 10, tauxTva: 20, unite: ' ' }, false);
  assert.ok(!('catalogueFamille' in libre) && !('ligneId' in libre));
  assert.equal(libre.unite, null);
});

test('ligne existante remise en édition : son identifiant suit, le prix d’achat seulement pour qui le voit', () => {
  const existante = { id: 'ligne-1', designation: 'Câble', nature: 'FOURNITURE' as const, quantite: 10, prixUnitaireHt: 2.5, tauxTva: 20, unite: 'm', reference: 'CAB-01', catalogueFamille: 'articles' as const, catalogueId: 'fiche-1', prixAchatUnitaireHt: 0.8 };
  const pourAdmin = ligneEnEdition(existante, true);
  assert.deepEqual([pourAdmin.ligneId, pourAdmin.reference, pourAdmin.prixAchatUnitaireHt], ['ligne-1', 'CAB-01', '0,8']);
  assert.ok(!('prixAchatUnitaireHt' in ligneEnEdition(existante, false)));
  assert.equal(ligneAEnvoyer(pourAdmin, true).ligneId, 'ligne-1');
});

test('seule une ligne vierge est remplacée par la première fiche ajoutée', () => {
  assert.equal(ligneVierge({ designation: '', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 0, tauxTva: 20 }), true);
  assert.equal(ligneVierge({ designation: 'Pose', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 0, tauxTva: 20 }), false);
  assert.equal(ligneVierge({ designation: '', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 5, tauxTva: 20 }), false);
  assert.equal(ligneVierge({ ligneId: 'l', designation: '', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 0, tauxTva: 20 }), false);
});

test('total des heures prévues d’un devis : en heures, deux décimales au plus, à la française', () => {
  assert.equal(formatHeuresPrevues(8), '8 h');
  assert.equal(formatHeuresPrevues(2.5), '2,5 h');
  assert.equal(formatHeuresPrevues(0.75), '0,75 h');
  assert.equal(formatHeuresPrevues(0), '0 h');
});

// Ligne de main d'œuvre au jour ou à la demi-journée (lot « budget et heures prévues du chantier », troisième PR).
const mainOeuvre: FicheCatalogueDevis = {
  famille: 'prestations', id: 'mo-1', reference: 'MO-ELEC', nom: 'Électricien', unite: 'heure', nature: 'MAIN_OEUVRE', prixVenteHt: 45, tauxTva: 20,
  estMainOeuvre: true, prixHeureSousContratHt: 40, prixJourHorsContratHt: 300, prixJourSousContratHt: 280, prixDemiJourneeHorsContratHt: 160, prixDemiJourneeSousContratHt: null,
};

test('forfait : le prix de la fiche selon le forfait et le tarif ; aucun sans prix de la demi-journée ni pour une prestation ordinaire', () => {
  assert.deepEqual(FORFAITS.flatMap((f) => TARIFS_FORFAIT.map((t) => prixDuForfait(mainOeuvre, f, t))), [300, 280, 160, null]);
  assert.equal(prixDuForfait({ ...mainOeuvre, estMainOeuvre: undefined }, 'JOUR', 'HORS_CONTRAT'), null);
  assert.equal(prixDuForfait({ ...mainOeuvre, prixDemiJourneeHorsContratHt: undefined }, 'DEMI_JOURNEE', 'HORS_CONTRAT'), null);
  assert.equal(ligneForfait(mainOeuvre, 'DEMI_JOURNEE', 'SOUS_CONTRAT'), null);
});

test('forfait : la nouvelle ligne, d’une unité, au prix et à l’unité de la fiche ; envoyée sans référence ni prix d’achat', () => {
  const ligne = ligneForfait(mainOeuvre, 'DEMI_JOURNEE', 'HORS_CONTRAT')!;
  assert.deepEqual(ligne, {
    forfaitMainOeuvre: 'DEMI_JOURNEE', tarifForfait: 'HORS_CONTRAT', designation: 'Électricien — à la demi-journée, hors contrat',
    nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 160, tauxTva: 20, unite: 'demi-journée', reference: 'MO-ELEC', catalogueFamille: 'prestations', catalogueId: 'mo-1',
  });
  assert.deepEqual([ligneForfait(mainOeuvre, 'JOUR', 'SOUS_CONTRAT')!.designation, ligneForfait(mainOeuvre, 'JOUR', 'SOUS_CONTRAT')!.unite], ['Électricien — au jour, sous contrat', 'jour']);
  assert.equal(ligneVierge(ligne), false);
  // L'administration, qui écrit le prix d'achat prévu, ne l'envoie pas non plus pour cette ligne.
  assert.deepEqual(ligneAEnvoyer({ ...ligne, prixAchatUnitaireHt: '12' }, true), {
    forfaitMainOeuvre: 'DEMI_JOURNEE', tarifForfait: 'HORS_CONTRAT', designation: 'Électricien — à la demi-journée, hors contrat', nature: 'MAIN_OEUVRE',
    quantite: 1, prixUnitaireHt: 160, tauxTva: 20, catalogueFamille: 'prestations', catalogueId: 'mo-1',
  });
});

test('forfait : une ligne existante remise en édition garde son identifiant, son forfait et son tarif, jamais de prix d’achat', () => {
  const existante = {
    id: 'ligne-9', designation: 'Électricien — au jour', nature: 'MAIN_OEUVRE' as const, quantite: 2, prixUnitaireHt: 300, tauxTva: 20, unite: 'jour', reference: 'MO-ELEC',
    catalogueFamille: 'prestations' as const, catalogueId: 'mo-1', prixAchatUnitaireHt: null, forfaitMainOeuvre: 'JOUR' as const, tarifForfait: 'HORS_CONTRAT' as const,
  };
  const enEdition = ligneEnEdition(existante, true);
  assert.deepEqual([enEdition.ligneId, enEdition.forfaitMainOeuvre, enEdition.tarifForfait, enEdition.unite, 'prixAchatUnitaireHt' in enEdition], ['ligne-9', 'JOUR', 'HORS_CONTRAT', 'jour', false]);
  const envoyee = ligneAEnvoyer(enEdition, true);
  assert.deepEqual([envoyee.ligneId, envoyee.forfaitMainOeuvre, envoyee.tarifForfait, envoyee.prixUnitaireHt, 'prixAchatUnitaireHt' in envoyee], ['ligne-9', 'JOUR', 'HORS_CONTRAT', 300, false]);
  // Une ligne ordinaire n'envoie ni forfait ni tarif.
  const ordinaire = ligneAEnvoyer(ligneEnEdition({ ...existante, forfaitMainOeuvre: null, tarifForfait: null }, false), false);
  assert.ok(!('forfaitMainOeuvre' in ordinaire) && !('tarifForfait' in ordinaire));
});

test('forfait : refusé avant l’envoi sur un devis au temps passé', () => {
  const ligne = ligneForfait(mainOeuvre, 'JOUR', 'HORS_CONTRAT')!;
  assert.equal(erreurForfait(true, [ligne]), REFUS_FORFAIT_TEMPS_PASSE);
  assert.equal(erreurForfait(false, [ligne]), null);
  assert.equal(erreurForfait(true, [{ designation: 'Câble', nature: 'FOURNITURE', quantite: 1, prixUnitaireHt: 2, tauxTva: 20 }]), null);
  assert.deepEqual([UNITES_FORFAIT.JOUR, UNITES_FORFAIT.DEMI_JOURNEE, LIBELLES_QUANTITE_FORFAIT.JOUR, LIBELLES_QUANTITE_FORFAIT.DEMI_JOURNEE], ['jour', 'demi-journée', 'Jours', 'Demi-journées']);
});

test('forfait : une quantité entière, au moins 1, refusée avant l’envoi sinon (0,5 jour, 1,5 demi-journée, 0)', () => {
  const jour = ligneForfait(mainOeuvre, 'JOUR', 'HORS_CONTRAT')!;
  const demi = ligneForfait(mainOeuvre, 'DEMI_JOURNEE', 'HORS_CONTRAT')!;
  assert.equal(erreurForfait(false, [{ ...jour, quantite: 2 }, { ...demi, quantite: 3 }]), null);
  for (const ligne of [{ ...jour, quantite: 0.5 }, { ...demi, quantite: 1.5 }, { ...jour, quantite: 0 }, { ...demi, quantite: Number('') }]) {
    assert.equal(erreurForfait(false, [ligne]), REFUS_QUANTITE_FORFAIT, String(ligne.quantite));
  }
  // Une ligne ordinaire garde sa quantité au millième.
  assert.equal(erreurForfait(false, [{ designation: 'Câble', nature: 'FOURNITURE', quantite: 0.5, prixUnitaireHt: 2, tauxTva: 20 }]), null);
  // Sur un devis au temps passé, le refus de la ligne au forfait passe en premier.
  assert.equal(erreurForfait(true, [{ ...jour, quantite: 0.5 }]), REFUS_FORFAIT_TEMPS_PASSE);
});

// ===================================================================================================================
// Lot devis (cadrage v3 du 16-11-2026, section 4 ; #394 pour le devis) : quantité, PU HT et TVA d'une ligne ordinaire, et
// heures d'une ligne au temps passé, saisis en texte (`inputMode="decimal"`) et non plus dans un champ numérique, qu'un
// navigateur réglé en anglais lit autrement (« 18,75 » y devient 1875). La saisie est gardée telle que tapée et envoyée
// brute, le serveur lisant la virgule ; les valeurs pré-remplies s'écrivent à la virgule.
// ===================================================================================================================

// Cadrage, « Pré-remplissage » : « `ligneDepuisCatalogue` (…) écrit le PU et la TVA à la virgule (« 2,5 », « 5,5 ») » ;
// « l'édition d'un devis existant (`ligneEnEdition`) écrit aussi à la virgule la quantité, le PU et la TVA d'une ligne
// ordinaire (…) ; le prix et la TVA des lignes au temps passé et au forfait restent des nombres » ; « les valeurs ne
// changent pas, seule leur écriture change ». Lectures écartées : un pré-remplissage au point (« 2.5 », que le motif admet
// mais qu'un utilisateur français ne tape pas) ; une valeur arrondie ou tronquée (« 18,8 », « 18 »).
test('pré-remplissage à la virgule : PU « 1250,5 » et TVA « 5,5 » depuis le catalogue ; quantité, PU et TVA d’une ligne ordinaire remise en édition ; prix et TVA du temps passé et du forfait en nombres', () => {
  const article = { ...fiche, prixVenteHt: 1250.5, tauxTva: 5.5, prixAchatHt: 0.85 };
  const copiee = ligneDepuisCatalogue(article, true);
  assert.deepEqual([copiee.quantite, copiee.prixUnitaireHt, copiee.tauxTva, copiee.prixAchatUnitaireHt], ['1', '1250,5', '5,5', '0,85']);
  const ordinaire = ligneEnEdition({ id: 'l-ord', designation: 'Câble', nature: 'FOURNITURE', quantite: 1.5, prixUnitaireHt: 18.75, tauxTva: 5.5, unite: 'm' }, false);
  assert.deepEqual([ordinaire.quantite, ordinaire.prixUnitaireHt, ordinaire.tauxTva], ['1,5', '18,75', '5,5']);
  const entiere = ligneEnEdition({ id: 'l-ent', designation: 'Pose', nature: 'MAIN_OEUVRE', quantite: 2, prixUnitaireHt: 180, tauxTva: 20 }, false);
  assert.deepEqual([entiere.quantite, entiere.prixUnitaireHt, entiere.tauxTva], ['2', '180', '20']);
  const milliemes = ligneEnEdition({ id: 'l-mil', designation: 'Câble', nature: 'FOURNITURE', quantite: 12.125, prixUnitaireHt: 0.05, tauxTva: 10 }, false);
  assert.deepEqual([milliemes.quantite, milliemes.prixUnitaireHt, milliemes.tauxTva], ['12,125', '0,05', '10']);
  const tempsPasse = ligneEnEdition({ id: 'l-tp', designation: 'MO', nature: 'MAIN_OEUVRE', quantite: 1.25, prixUnitaireHt: 45.5, tauxTva: 5.5, tempsPasse: true, tarifTempsPasse: 'HORS_CONTRAT' }, true);
  assert.deepEqual([tempsPasse.quantite, tempsPasse.prixUnitaireHt, tempsPasse.tauxTva], ['1,25', 45.5, 5.5]);
  const forfait = ligneEnEdition({ id: 'l-fo', designation: 'MO au jour', nature: 'MAIN_OEUVRE', quantite: 2, prixUnitaireHt: 320.5, tauxTva: 5.5, forfaitMainOeuvre: 'JOUR', tarifForfait: 'HORS_CONTRAT' }, true);
  assert.deepEqual([forfait.quantite, forfait.prixUnitaireHt, forfait.tauxTva], [2, 320.5, 5.5]);
});

// Cadrage, « État du formulaire » : « Ces valeurs sont envoyées brutes, puisque le serveur lit la virgule. (…) Pour une saisie
// valide, le serveur reçoit la même valeur qu'avant. » Le corps porte la saisie telle quelle. Lectures écartées : `Number`
// (« 1,5 » → NaN, envoyé `null` par JSON.stringify) ; `parseFloat` (1, 18 et 5) ; une remise au point (« 1.5 »), sans effet
// sur la valeur mais qui changerait ce que le serveur reçoit.
test('corps envoyé : la quantité, le PU HT et la TVA d’une ligne ordinaire partent tels que saisis (« 1,5 », « 18,75 », « 5,5 »)', () => {
  const envoyee = ligneAEnvoyer({ designation: 'Fourniture', nature: 'FOURNITURE', quantite: '1,5', prixUnitaireHt: '18,75', tauxTva: '5,5', unite: 'm' }, false);
  assert.deepEqual([envoyee.quantite, envoyee.prixUnitaireHt, envoyee.tauxTva], ['1,5', '18,75', '5,5']);
  assert.deepEqual(JSON.parse(JSON.stringify(envoyee)).quantite, '1,5');
  // Une ligne copiée du catalogue, non retouchée : son pré-remplissage à la virgule part tel quel.
  const copiee = ligneAEnvoyer(ligneDepuisCatalogue({ ...fiche, tauxTva: 5.5 }, false), false);
  assert.deepEqual([copiee.quantite, copiee.prixUnitaireHt, copiee.tauxTva], ['1', '2,5', '5,5']);
});

// Cadrage : « `ligneVierge` (…) reconnaît « 0 », « 0,00 » et « 0.00 » comme vierges, et pas seulement `Number(...) === 0`
// sur une chaîne à virgule » (avant le lot, `Number('0,00')` valait NaN : la ligne vierge d'un formulaire à la virgule
// n'était plus remplacée par la première fiche ajoutée). Un prix non nul (« 0,01 ») ou une désignation la garde.
test('ligne vierge : prix « 0 », « 0,00 », « 0.00 », vide ou blancs ; pas un prix de « 0,01 », ni une ligne désignée ou existante', () => {
  const vierge = (prixUnitaireHt: string | number, extra = {}) => ligneVierge({ designation: '', nature: 'MAIN_OEUVRE', quantite: '1', prixUnitaireHt, tauxTva: '20', ...extra });
  for (const prix of ['0', '0,00', '0.00', '0,0', '', '  ', ' 0 ', 0]) assert.equal(vierge(prix), true, JSON.stringify(prix));
  for (const prix of ['0,01', '0.01', '5', '18,75', 0.01]) assert.equal(vierge(prix), false, JSON.stringify(prix));
  assert.equal(vierge('0,00', { designation: 'Pose' }), false);
  assert.equal(vierge('0,00', { ligneId: 'l' }), false);
  assert.equal(vierge('0,00', { catalogueId: 'fiche-1' }), false);
});

test('nombre saisi : lu à la virgule comme au point, blancs retirés ; NaN hors nombre, 0 pour un champ vide', () => {
  assert.deepEqual(['1,25', '1.25', ' 2,5 ', '18,75', '0,001', '1250,50'].map(nombreSaisi), [1.25, 1.25, 2.5, 18.75, 0.001, 1250.5]);
  assert.equal(nombreSaisi(''), 0);
  assert.equal(nombreSaisi(3), 3);
  for (const saisie of ['abc', '1,2,3', '1 000', '1,25 h']) assert.ok(Number.isNaN(nombreSaisi(saisie)), saisie);
});

// Motifs des champs, aux bornes du serveur (cadrage : « champ texte, `inputMode="decimal"`, avec un `pattern` aux bornes du
// serveur ; quantité : `(v, 9, false, 3)`, strictement positive ; PU HT : `(v, 10, true)`, zéro admis ; TVA : `(v, 3,
// true)` »). Le navigateur compile un `pattern` en `^(?:motif)$` avec le drapeau `v`, et ignore en silence un motif
// invalide (cadrage, « Mode `v` des `pattern` ») : le test le compile de même, puis compare chaque saisie à la règle du
// serveur, réécrite ici (chiffres avant et après le séparateur, valeur). Exhaustif sur les parties décimales d'un à
// quatre chiffres et des parties entières aux bornes. Le serveur retire les blancs ; le navigateur, non : une saisie
// entourée de blancs est refusée par le motif.
const compiler = (motif: string) => new RegExp(`^(?:${motif})$`, 'v');
// Règle du serveur (nombreDecimalNonNegatif), réécrite : au plus `entiers` chiffres avant le séparateur (zéros de tête
// compris), au plus `decimales` après ; la valeur, en millièmes, est jugée par `valeurAdmise`.
const formeServeur = (saisie: string, entiers: number, decimales: number) => new RegExp(`^\\d{1,${entiers}}(?:[.,]\\d{1,${decimales}})?$`).test(saisie);
const milliemes = (saisie: string) => {
  const [entier, decimal = ''] = saisie.split(/[.,]/);
  return BigInt(entier) * 1000n + BigInt((decimal + '000').slice(0, 3));
};
function saisiesExhaustives(): string[] {
  const entiers = ['0', '1', '7', '00', '01', '10', '100', '999', '1000', '000000000', '123456789', '0123456789', '1234567890', '12345678901'];
  const decimales: string[] = [];
  for (let longueur = 1; longueur <= 4; longueur += 1) for (let n = 0; n < 10 ** longueur; n += 1) decimales.push(String(n).padStart(longueur, '0'));
  return entiers.flatMap((entier) => [entier, ...decimales.flatMap((decimal) => [`${entier},${decimal}`, `${entier}.${decimal}`])]);
}
const HORS_FORME = ['', ' 1', '1 ', '-1', '+1', '1e3', ',5', '.5', '1,', '1.', '1,,5', '1,5,5', '1.5.5', '1 000', 'abc', '1,5 %', '١'];

test('motifs de la quantité, du PU HT et de la TVA : compilés avec le drapeau v, comme le navigateur, et aux bornes du serveur', () => {
  const regles = [
    ['quantité (9 chiffres, 3 décimales, strictement positive)', MOTIF_QUANTITE_DEVIS, 9, 3, (m: bigint) => m > 0n],
    ['PU HT (10 chiffres, 2 décimales, zéro admis)', MOTIF_PRIX_DEVIS, 10, 2, () => true],
    ['TVA (3 chiffres, 2 décimales, zéro admis)', MOTIF_TVA_DEVIS, 3, 2, () => true],
  ] as const;
  const saisies = saisiesExhaustives();
  for (const [nom, motif, entiers, decimales, valeurAdmise] of regles) {
    const expression = compiler(motif);
    const ecarts = saisies.filter((saisie) => expression.test(saisie) !== (formeServeur(saisie, entiers, decimales) && valeurAdmise(milliemes(saisie))));
    assert.deepEqual(ecarts.slice(0, 10), [], `${nom} : saisies où le motif diffère du serveur`);
    for (const saisie of HORS_FORME) assert.equal(expression.test(saisie), false, `${nom} : « ${saisie} »`);
  }
  // Témoins nommés du cadrage : « 0 » refusé pour la quantité (comme l'ancien min="0.001"), admis pour le PU et la TVA ;
  // « 18,755 » refusé pour le PU ; « 19,6 » admis par la forme (le serveur seul refuse une TVA non française).
  assert.deepEqual(['0', '0,000', '0,001', '1,5', '1,1234'].map((s) => compiler(MOTIF_QUANTITE_DEVIS).test(s)), [false, false, true, true, false]);
  assert.deepEqual(['0', '18,75', '18,755', '1250,50', '9999999999,99', '10000000000'].map((s) => compiler(MOTIF_PRIX_DEVIS).test(s)), [true, true, false, true, true, false]);
  assert.deepEqual(['0', '5,5', '5.5', '19,6', '5,555', '1000'].map((s) => compiler(MOTIF_TVA_DEVIS).test(s)), [true, true, true, true, false, false]);
});
