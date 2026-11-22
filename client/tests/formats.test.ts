import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { fmtDate, fmtEuro, fmtEuroCentime, fmtHeures, fmtMontantDocument, fmtNombreHeures, fmtPourcentage, toDateFrancaise } from '../src/lib/formats.ts';
import { jourFrancais } from '../src/lib/dateFormatting.ts';
import { arrondiCentime, arrondiEuro, sommeExacte } from '../src/lib/montants.ts';
import { formatEuros, formatHeures } from '../src/lib/mainOeuvre.ts';
import { formatPrix, heuresMinimum, refusQuantiteTempsPasse } from '../src/lib/tempsPasse.ts';
import { heuresFr } from '../src/lib/factureTempsPasse.ts';
import { formatHeuresPrevues } from '../src/lib/catalogueDevis.ts';
import { alerteMargeSav, detailMargeSav, type MargeSavHorsContrat } from '../src/lib/coutsIntervention.ts';

// Lot A5, #205 : un seul module de formats (cadrage du lot « anomalies d'écran », PR A5, version 2, et vérification
// des C5 à C7 du contrôle avant le code). Six familles : les cinq de #205, chacune gardant son texte d'avant #205, et le
// pourcentage, ajouté par #499 (cadrage du correctif, version 2, point 1), dont le texte change (effets déclarés) :
//  - le montant à l'euro près (`fmtEuro`) : `arrondiEuro`, `fr-FR`, une espace ordinaire puis « € » ;
//  - le montant au centime en devise (`fmtEuroCentime`) : `arrondiCentime`, format monétaire `fr-FR`/`EUR` d'Intl,
//    avec son espace insécable avant « € » ;
//  - la forme des documents (`fmtMontantDocument`, C5) : le texte de `formatMontantFacture` du serveur, espace ordinaire ;
//  - les heures, deux décimales au plus, ou trois pour le temps passé, avec ou sans « h » ;
//  - le pourcentage (`fmtPourcentage`, #499) : valeur en pour cent, au plus 0, 1 ou 2 décimales selon l'usage, sans zéro
//    inutile, espace ordinaire avant « % », jamais « -0 % » (choix par défaut, à confirmer, règle 5) ;
//  - les jours `JJ-MM-AAAA`, par `jourFrancais`, avec le repli d'un jour absent vers ''.
// Montants (règle 2) : chaque attendu est choisi pour qu'une autre lecture plausible donne un autre texte ; le commentaire
// dit la lecture écartée. `test:unit` tourne avec TZ=Pacific/Gambier (UTC-9) ; la langue par défaut de Node y est celle
// de l'environnement (en-US en CI) : un format sans locale y écrirait « 1,235 ».

// Caractères relevés sous Node 20 (ICU 77) et Chromium : séparateur des milliers de `fr-FR`, l'espace fine insécable
// U+202F ; espace du format monétaire d'Intl avant « € », l'espace insécable U+00A0 ; espace ordinaire U+0020 ailleurs.
const FINE = ' ';
const INSECABLE = ' ';

test('euro près (fmtEuro) : arrondi de #198, moitié vers l’extérieur, sans « -0 », milliers fr-FR et espace ordinaire avant « € »', () => {
  assert.equal(fmtEuro(0), '0 €');
  // Moitiés : 12,5 € donne 13 € (un arrondi au pair donnerait 12), -12,5 € donne -13 € (Math.round donnerait -12).
  assert.equal(fmtEuro(12.5), '13 €');
  assert.equal(fmtEuro(-12.5), '-13 €');
  assert.equal(fmtEuro(12.49), '12 €');
  assert.equal(fmtEuro(-12.49), '-12 €');
  // Négatif arrondi à zéro : « 0 € », jamais « -0 € » (Math.round(-0,4) vaut -0, que toLocaleString écrit « -0 »).
  assert.equal(fmtEuro(-0.4), '0 €');
  assert.equal(fmtEuro(-0.49), '0 €');
  // -0,5 € s'éloigne de zéro : « -1 € » (Math.round donnerait « -0 € »).
  assert.equal(fmtEuro(-0.5), '-1 €');
  // Total flottant : 0,01 + 2,01 + 0,48 vaut 2,4999999999999996 et non 2,50. Écarte Math.round et l'arrondi d'Intl
  // (« 2 € »), comme un format sans arrondi préalable (« 2,5 € »).
  assert.equal(0.01 + 2.01 + 0.48, 2.4999999999999996, 'témoin : le total flottant');
  assert.equal(fmtEuro(0.01 + 2.01 + 0.48), '3 €');
  assert.equal(fmtEuro(sommeExacte([0.01, 2.01, 0.48])), '3 €');
  // Pas de centimes à l'euro près : 45,55 € donne « 46 € » (et non « 45,55 € »).
  assert.equal(fmtEuro(45.55), '46 €');
  // Milliers : l'espace fine insécable de fr-FR. Écarte la langue du navigateur (en-US « 1,235 € »), l'espace
  // ordinaire et l'espace insécable U+00A0.
  assert.equal(fmtEuro(1234.5), `1${FINE}235 €`);
  assert.equal(fmtEuro(-1234.5), `-1${FINE}235 €`, 'Math.round donnerait -1 234');
  assert.equal(fmtEuro(1234567.5), `1${FINE}234${FINE}568 €`);
  assert.equal(fmtEuro(-2345.5), `-2${FINE}346 €`);
  // L'espace avant « € » est l'espace ordinaire (U+0020), comme avant #205 (N8).
  assert.equal(fmtEuro(1234.5).at(-2), ' ');
  for (const montant of [-1234.5, -12.5, -0.4, 0, 0.4, 12.5, 1234567.5]) {
    assert.equal(fmtEuro(montant), `${arrondiEuro(montant).toLocaleString('fr-FR')} €`, String(montant));
  }
});

test('centime en devise (fmtEuroCentime) : arrondiCentime puis format monétaire fr-FR, espace insécable d’Intl, sans « -0,00 € »', () => {
  assert.equal(fmtEuroCentime(0), `0,00${INSECABLE}€`);
  assert.equal(fmtEuroCentime(45.5), `45,50${INSECABLE}€`);
  // Milliers en espace fine insécable, puis l'espace insécable d'Intl avant « € » (et non l'espace ordinaire des documents).
  assert.equal(fmtEuroCentime(1234.5), `1${FINE}234,50${INSECABLE}€`);
  assert.equal(fmtEuroCentime(-1234567.89), `-1${FINE}234${FINE}567,89${INSECABLE}€`);
  // Moitié de centime : 1,005 € donne 1,01 € (1,005 × 100 vaut 100,4999… en flottant : Math.round donnerait 1,00 €).
  assert.equal(fmtEuroCentime(1.005), `1,01${INSECABLE}€`);
  assert.equal(fmtEuroCentime(-1.005), `-1,01${INSECABLE}€`);
  assert.equal(fmtEuroCentime(-0.005), `-0,01${INSECABLE}€`);
  // Négatif arrondi à zéro : « 0,00 € ». Écarte le format monétaire sans arrondi préalable (anciens formatMontant de
  // Factures, Règlements et FactureTempsPasse, euros d'OuvrirChantierAffaire, montantEuros d'Interventions), qui écrit
  // « -0,00 € » : le seul changement de texte annoncé pour cette famille (cadrage, « Changements visibles attendus »).
  assert.equal((-0.004).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }), `-0,00${INSECABLE}€`, 'témoin : Intl seul');
  assert.equal(fmtEuroCentime(-0.004), `0,00${INSECABLE}€`);
  assert.equal(fmtEuroCentime(-0.001), `0,00${INSECABLE}€`);
  // Somme flottante : 0,1 + 0,2 vaut 0,30000000000000004.
  assert.equal(fmtEuroCentime(0.1 + 0.2), `0,30${INSECABLE}€`);
  // Rapport (taux moyen, estimation) : arrondi une seule fois, 104,03 € (un double arrondi par 104,0350 donnerait 104,04 €).
  assert.equal(fmtEuroCentime(104.034996), `104,03${INSECABLE}€`);
  for (const montant of [-1234.5, -1.005, -0.004, 0, 1.005, 2.675, 1234.5]) {
    assert.equal(fmtEuroCentime(montant), arrondiCentime(montant).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }), String(montant));
  }
});

// Le module du serveur ne se charge pas ici (il importe Prisma, absent du travail « Frontend » de la CI) : comme
// envoiMicrosoft365.test.ts, on relit son source. Sa fonction est une seule expression, relue telle quelle puis
// évaluée : c'est le texte du serveur qui sert de référence, et non une copie écrite dans ce test.
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function formatMontantFactureDuServeur(): (valeur: unknown) => string {
  const source = readFileSync(path.join(racine, 'server/src/domaines/factures/metier.ts'), 'utf8');
  const fonction = /export function formatMontantFacture\(valeur: unknown\) \{\n {2}return (`[^`\n]*`);\n\}/.exec(source);
  assert.ok(fonction, 'formatMontantFacture relue dans server/src/domaines/factures/metier.ts');
  return new Function('valeur', `return ${fonction[1]};`) as (valeur: unknown) => string;
}

test('forme des documents (fmtMontantDocument) : deux décimales, espace ordinaire avant « € », le texte de formatMontantFacture du serveur', () => {
  assert.equal(fmtMontantDocument(45.5), '45,50 €');
  assert.equal(fmtMontantDocument(45.55), '45,55 €');
  assert.equal(fmtMontantDocument(0), '0,00 €');
  // Espace ordinaire U+0020 avant « € », et non l'espace insécable du format monétaire d'Intl (C5) ; milliers en U+202F.
  assert.equal(fmtMontantDocument(1234.5), `1${FINE}234,50 €`);
  assert.equal(fmtMontantDocument(-1234.56), `-1${FINE}234,56 €`);
  assert.equal(fmtMontantDocument(1234567.89), `1${FINE}234${FINE}567,89 €`);
  assert.notEqual(fmtMontantDocument(1234.5), fmtEuroCentime(1234.5), 'deux familles distinctes');
  assert.equal(fmtEuroCentime(1234.5).replace(INSECABLE, ' '), fmtMontantDocument(1234.5), 'elles ne diffèrent que par l’espace avant « € »');
  // Identique au serveur, valeur par valeur (le PDF et la mention du devis au temps passé). -0,004 € y donne « -0,00 € »
  // des deux côtés : la forme des documents garde le texte du serveur, sur des montants au centime (Decimal(12,2)).
  const serveur = formatMontantFactureDuServeur();
  assert.equal(serveur(45.5), '45,50 €', 'témoin : la fonction du serveur relue');
  for (const montant of [0, 0.5, 1.005, 2.675, 45.5, 45.55, 1234.05, 1234.5, -1234.56, 999999.995, 1234567.89, 9999999999.99, -0.004]) {
    assert.equal(fmtMontantDocument(montant), serveur(montant), String(montant));
  }
  // formatEuros (main d'œuvre) et formatPrix (mention du devis au temps passé) restent, au texte de cette famille.
  for (const montant of [0, 45.5, 45.55, 1234.05, 1234.5, -1234.56]) {
    assert.equal(formatEuros(montant), fmtMontantDocument(montant), `formatEuros(${montant})`);
    assert.equal(formatPrix(montant), fmtMontantDocument(montant), `formatPrix(${montant})`);
  }
});

test('heures : deux décimales au plus, ou trois pour le temps passé, sans décimale inutile ; avec ou sans « h »', () => {
  assert.equal(fmtNombreHeures(18.75), '18,75');
  assert.equal(fmtNombreHeures(8), '8');
  assert.equal(fmtNombreHeures(7.5), '7,5');
  assert.equal(fmtNombreHeures(0), '0');
  // 1,125 h : « 1,13 » à deux décimales, « 1,125 » à trois. Écarte un decimalesMax ignoré, dans un sens ou dans l'autre.
  assert.equal(fmtNombreHeures(1.125), '1,13');
  assert.equal(fmtNombreHeures(1.125, 2), '1,13');
  assert.equal(fmtNombreHeures(1.125, 3), '1,125');
  assert.equal(fmtNombreHeures(2 / 3), '0,67');
  assert.equal(fmtNombreHeures(2 / 3, 3), '0,667');
  assert.equal(fmtNombreHeures(1234.5), `1${FINE}234,5`);
  // Avec « h », après une espace ordinaire.
  assert.equal(fmtHeures(18.75), '18,75 h');
  assert.equal(fmtHeures(8), '8 h');
  assert.equal(fmtHeures(0), '0 h');
  assert.equal(fmtHeures(1.125), '1,13 h');
  assert.equal(fmtHeures(1.125, 3), '1,125 h');
  // Heures enregistrées du tableau de bord : arrondies à l'heure, puis au format fr-FR (et non « 1,234 h »).
  assert.equal(fmtHeures(Math.round(1234.4)), `1${FINE}234 h`);
  // Les fonctions gardées l'emploient : facture au temps passé au millième, heures prévues du devis au centième.
  assert.equal(heuresFr(1.125), '1,125 h');
  assert.equal(heuresFr(1.42), '1,42 h');
  assert.equal(formatHeuresPrevues(1.125), '1,13 h');
  assert.equal(formatHeuresPrevues(7.5), '7,5 h');
  // Temps passé, sans « h » et au millième : minimum facturé, et exemples du refus (60, 85 puis 110 minutes).
  assert.equal(heuresMinimum(1.125), '1,125 heure minimum facturée');
  assert.equal(heuresMinimum(2.5), '2,5 heures minimum facturées');
  assert.match(refusQuantiteTempsPasse(1.2, { tempsMinimumMinutes: 60, pasTempsPasseMinutes: 25 }) || '', /en heures, 1 ; 1,417 ; 1,833…$/);
  // Marge d'un SAV hors contrat : heures au centième, avec « h ».
  const marge: MargeSavHorsContrat = {
    ventesHT: 136.5, coutsHT: 84, materielHT: 0, margeHT: 52.5, nombreSuites: 2,
    heuresNonValorisees: 1.125, intervenantsNonValorises: ['TEST Dupont'], heuresSuitesAnnulees: 1.125,
  };
  assert.match(alerteMargeSav(marge) || '', /^Marge incomplète : 1,13 h sans prix de vente \(TEST Dupont\)\./);
  assert.match(detailMargeSav(marge, fmtEuroCentime), /Les heures des suites annulées \(1,13 h\) comptent dans le coût/);
});

test('jours : JJ-MM-AAAA par jourFrancais, avec ou sans heure, sans changer de jour ; rien pour un jour absent', () => {
  assert.equal(toDateFrancaise('2026-11-05'), '05-11-2026');
  // Instant à 03:00 UTC : le jour écrit reste le 05 (relu dans le fuseau du processus, UTC-9, il deviendrait le 04).
  assert.equal(toDateFrancaise('2026-11-05T03:00:00.000Z'), '05-11-2026');
  assert.equal(toDateFrancaise('2026-01-31T23:59:59.999Z'), '31-01-2026');
  for (const absent of [null, undefined, '']) assert.equal(toDateFrancaise(absent), '', JSON.stringify(absent) ?? 'undefined');
  for (const jour of ['2026-11-05', '2026-11-05T03:00:00.000Z', '2024-02-29']) assert.equal(toDateFrancaise(jour), jourFrancais(jour), jour);
  // fmtDate, inchangé : une date métier stockée à minuit UTC.
  assert.equal(fmtDate('2026-11-05T00:00:00.000Z'), '05-11-2026');
  assert.equal(fmtDate('2024-02-29'), '29-02-2024');
});

// Textes d'avant #205, recopiés de e39f005 (tête de A4, base de A5) : chaque famille garde son texte (cadrage, « chaque
// famille garde son texte actuel » ; N8, C5). Les fonctions sans locale y sont écrites en fr-FR : leur texte dans un
// navigateur français, le seul où elles étaient justes.
const AVANT = {
  // lib/formatsChantier.ts:12, ListeChantiers.tsx:34, Dashboard.tsx:86 (euros) ; sans locale : MesCommerciaux.tsx:22,
  // ResultatCommercial.tsx:21, EditeurBareme.tsx:3 et les montants en ligne du tableau de bord, de Performances et de
  // Statistiques.
  euro: (n: number) => `${arrondiEuro(n).toLocaleString('fr-FR')} €`,
  // CoutsSuitesChantier.tsx:4.
  centimeArrondi: (n: number) => arrondiCentime(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }),
  // Factures.tsx:60, Reglements.tsx:25, FactureTempsPasse.tsx:5, OuvrirChantierAffaire.tsx:12.
  centimeIntl: (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }),
  // Interventions.tsx:57.
  montantEuros: (n: number) => Number(n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }),
  // mainOeuvre.ts:50 (formatEuros), tempsPasse.ts:26 (formatPrix).
  document: (n: number) => `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`,
  // formatsChantier.ts:14, ListeChantiers.tsx:35, coutsIntervention.ts:43 (heuresFr), catalogueDevis.ts:54.
  heures: (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} h`,
  // CoutsSuitesChantier.tsx:5, sans « h ».
  nombreHeures: (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }),
  // factureTempsPasse.ts:26 (heuresFr).
  heures3: (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} h`,
  // tempsPasse.ts:61 (quantiteFr), sans « h ».
  nombreHeures3: (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 }),
  // Dashboard.tsx:195 (heures enregistrées, sans locale).
  heuresArrondies: (n: number) => `${Math.round(n).toLocaleString('fr-FR')} h`,
  // formatsChantier.ts:5.
  jour: (d: string | null | undefined) => {
    if (!d) return '';
    const [annee, mois, jour] = d.slice(0, 10).split('-');
    return `${jour}-${mois}-${annee}`;
  },
};
const MONTANTS = [
  -1234567.5, -2345.5, -1234.56, -12.5, -1.005, -0.5, -0.4, -0.005, -0.004, -0.001, 0, 0.001, 0.004, 0.005, 0.1 + 0.2, 0.4, 0.5,
  1.005, 2.675, 0.01 + 2.01 + 0.48, 12.49, 12.5, 45.5, 45.55, 104.034996, 999.5, 1234.05, 1234.5, 999999.995, 1234567.89,
];
const HEURES = [0, 0.25, 0.5, 2 / 3, 1, 1.125, 1.42, 1.4166666666666667, 7.5, 7.75, 8, 18.75, 1234.4, 1234.5, 12345.678];
const ecarts = (valeurs: number[], avant: (n: number) => string, apres: (n: number) => string) => valeurs.filter((v) => avant(v) !== apres(v));

test('chaque famille garde son texte d’avant #205 ; au centime, seul « -0,00 € » devient « 0,00 € »', () => {
  assert.deepEqual(ecarts(MONTANTS, AVANT.euro, fmtEuro), []);
  assert.deepEqual(ecarts(MONTANTS, AVANT.centimeArrondi, fmtEuroCentime), []);
  // Sans arrondi préalable, l'ancien format ne diffère que pour un négatif arrondi à zéro (« -0,00 € »), inatteignable
  // pour des montants au centime renvoyés par le serveur (cadrage, Nd).
  assert.deepEqual(ecarts(MONTANTS, AVANT.centimeIntl, fmtEuroCentime), [-0.004, -0.001]);
  assert.deepEqual(ecarts(MONTANTS, AVANT.montantEuros, fmtEuroCentime), [-0.004, -0.001]);
  assert.deepEqual(ecarts(MONTANTS, AVANT.document, fmtMontantDocument), []);
  assert.deepEqual(ecarts(HEURES, AVANT.heures, (n) => fmtHeures(n)), []);
  assert.deepEqual(ecarts(HEURES, AVANT.nombreHeures, (n) => fmtNombreHeures(n)), []);
  assert.deepEqual(ecarts(HEURES, AVANT.heures3, (n) => fmtHeures(n, 3)), []);
  assert.deepEqual(ecarts(HEURES, AVANT.nombreHeures3, (n) => fmtNombreHeures(n, 3)), []);
  assert.deepEqual(ecarts(HEURES, AVANT.heuresArrondies, (n) => fmtHeures(Math.round(n))), []);
  for (const jour of ['2026-11-05', '2026-11-05T03:00:00.000Z', '', null, undefined]) assert.equal(toDateFrancaise(jour), AVANT.jour(jour), String(jour));
  // Témoin : les grilles distinguent bien les familles (trois décimales contre deux, euro contre centime).
  assert.notDeepEqual(ecarts(HEURES, AVANT.heures, (n) => fmtHeures(n, 3)), []);
  assert.notDeepEqual(ecarts(MONTANTS, AVANT.euro, fmtEuroCentime), []);
});

// --- #499 : famille « pourcentage » et heures (cadrage du correctif, version 2, points 1 et 2) ---
// fmtPourcentage(valeur, decimalesMax) : valeur en pour cent, `fr-FR`, au plus 0, 1 ou 2 décimales déclarées par l'usage
// (marges, taux de dépassement, répartition des types : 1 ; avancement, objectifs, répartition des chantiers : 0 ; taux de
// TVA : 2), sans zéro inutile, espace ordinaire U+0020 avant « % », jamais « -0 % » (choix par défaut, à confirmer,
// règle 5). Chaque attendu dit la lecture qu'il écarte.
test('pourcentage (fmtPourcentage, #499) : décimales déclarées par l’usage, sans zéro inutile, arrondi d’Intl, espace ordinaire avant « % », jamais « -0 % »', () => {
  // 1,125 % : « 1 % », « 1,1 % », « 1,13 % ». Écarte un decimalesMax ignoré ou figé, dans un sens ou dans l'autre.
  assert.equal(fmtPourcentage(1.125, 0), '1 %');
  assert.equal(fmtPourcentage(1.125, 1), '1,1 %');
  assert.equal(fmtPourcentage(1.125, 2), '1,13 %');
  // Pas de valeur par défaut : chaque usage déclare ses décimales (un paramètre par défaut ramènerait length à 1).
  assert.equal(fmtPourcentage.length, 2);
  // Sans zéro inutile : 12,0 donne « 12 % » (et non « 12.0% » de toFixed(1), effet visible déclaré, ni « 12,0 % ») ; les
  // taux de TVA « 5,5 % » et « 20 % » (et non « 5.50 % » ni « 20.00 % » de toFixed(2), ni « 5,50 % » à deux décimales fixes).
  assert.equal(fmtPourcentage(12, 1), '12 %');
  assert.equal(fmtPourcentage(5.5, 2), '5,5 %');
  assert.equal(fmtPourcentage(20, 2), '20 %');
  assert.equal(fmtPourcentage(0, 2), '0 %');
  // Arrondi d'Intl, moitié vers l'extérieur sur l'écriture décimale : 0,15 donne « 0,2 % » à une décimale (toFixed(1) sur
  // le flottant donne « 0.1 », effet visible déclaré) ; 1,005 donne « 1,01 % » (toFixed(2) : « 1.00 ») ; 99,95 donne
  // « 100 % » (une troncature : « 99,9 % ») ; 12,5 donne « 13 % » sans décimale (un arrondi au pair : « 12 % »).
  assert.equal((0.15).toFixed(1), '0.1', 'témoin : toFixed sur le flottant');
  assert.equal(fmtPourcentage(0.15, 1), '0,2 %');
  assert.equal(fmtPourcentage(1.005, 2), '1,01 %');
  assert.equal(fmtPourcentage(99.95, 1), '100 %');
  assert.equal(fmtPourcentage(12.5, 0), '13 %');
  assert.equal(fmtPourcentage(-12.5, 0), '-13 %');
  // Jamais « -0 % » : un négatif arrondi à zéro s'écrit « 0 % » (Intl seul écrit « -0 », toFixed « -0.0 ») ; un négatif
  // non nul garde son signe, le trait d'union U+002D (et non le signe moins U+2212).
  assert.equal((-0.04).toLocaleString('fr-FR', { maximumFractionDigits: 1 }), '-0', 'témoin : Intl seul');
  assert.equal((-0.04).toFixed(1), '-0.0', 'témoin : toFixed');
  for (const [valeur, decimales] of [[-0.04, 1], [-0.049, 1], [-0.4, 0], [-0.004, 2], [-0, 0], [-0, 2]] as [number, 0 | 1 | 2][]) {
    assert.equal(fmtPourcentage(valeur, decimales), '0 %', `${Object.is(valeur, -0) ? '-0' : valeur} à ${decimales} décimale(s)`);
  }
  assert.equal(fmtPourcentage(-0.05, 1), '-0,1 %');
  assert.equal(fmtPourcentage(-0.5, 0), '-1 %');
  assert.equal(fmtPourcentage(-19, 1), '-19 %');
  assert.equal(fmtPourcentage(-19, 1).codePointAt(0), 0x2d, 'trait d’union U+002D');
  // Espace ordinaire U+0020 avant « % » (cadrage : « comme les textes déjà en français »), et non l'espace insécable
  // U+00A0 ni l'espace fine U+202F ; milliers de fr-FR en U+202F (écarte la langue du navigateur : « 1,235 % »).
  assert.equal(fmtPourcentage(12.5, 1), '12,5 %');
  assert.equal(fmtPourcentage(12.5, 1).at(-2), ' ');
  assert.equal(fmtPourcentage(1234.5, 0), `1${FINE}235 %`);
});

// Pourcentages déjà écrits en français avant #499, que la famille reprend : Dashboard.tsx:283 de 8a47a50 (marge estimée
// du portefeuille, `toLocaleString('fr-FR', { maximumFractionDigits: 1 })`), la marge faible de suiviChantiers.ts
// (`nombre(…, 1)`), l'acompte exigé de l'historique des devis (deux décimales), le taux du tableau des règles TVA
// (Intl.NumberFormat('fr-FR'), trois décimales au plus, sur des taux à deux décimales).
const POURCENTS = [-19, -12.5, -0.05, -0.049, -0.04, -0.004, -0, 0, 0.004, 0.04, 0.05, 0.15, 1.005, 1.125, 2.675, 5.5, 12, 12.5, 12.345, 99.95, 100, 1234.5];
test('pourcentage : même texte que les pourcentages déjà en français, sauf « -0 % » qui devient « 0 % » ; effets déclarés des anciens toFixed', () => {
  const francais = (decimales: number) => (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: decimales })} %`;
  const nomme = (valeurs: number[]) => valeurs.map((v) => (Object.is(v, -0) ? '-0' : String(v)));
  // Seuls changent les négatifs arrondis à zéro (lecture écartée : une famille qui changerait un autre texte déjà juste).
  assert.deepEqual(nomme(ecarts(POURCENTS, francais(1), (n) => fmtPourcentage(n, 1))), ['-0.049', '-0.04', '-0.004', '-0']);
  assert.deepEqual(nomme(ecarts(POURCENTS, francais(0), (n) => fmtPourcentage(n, 0))), ['-0.05', '-0.049', '-0.04', '-0.004', '-0']);
  assert.deepEqual(nomme(ecarts(POURCENTS, francais(2), (n) => fmtPourcentage(n, 2))), ['-0.004', '-0']);
  const tauxTva = [0, 2.1, 5.5, 8.25, 10, 19.6, 20];
  assert.deepEqual(ecarts(tauxTva, (n) => `${new Intl.NumberFormat('fr-FR').format(n)} %`, (n) => fmtPourcentage(n, 2)), []);
  // Effets visibles déclarés (cadrage, point 1), texte de 8a47a50 → texte de la famille : marge « 12.0% » → « 12 % »
  // (Dashboard.tsx:221, Performances.tsx:118) ; répartition « 38% » → « 38 % » (Statistiques.tsx:127) ; taux de TVA
  // « 20.00 % » → « 20 % » (Catalogue.tsx:241) ; arrondi d'Intl « 0.1% » → « 0,2 % » pour 0,15.
  const avantToFixed = (decimales: number, espace = '') => (n: number) => `${n.toFixed(decimales)}${espace}%`;
  assert.deepEqual([12, 37.5, 20, 0.15].map((n, i) => [avantToFixed([1, 0, 2, 1][i], i === 2 ? ' ' : '')(n), fmtPourcentage(n, [1, 0, 2, 1][i] as 0 | 1 | 2)]), [
    ['12.0%', '12 %'], ['38%', '38 %'], ['20.00 %', '20 %'], ['0.1%', '0,2 %'],
  ]);
});

test('heures (#499, point 2) : formatHeures est l’alias de fmtHeures ; « 3.0 h » devient « 3 h », « 7.3h » devient « 7,33 h »', () => {
  for (const heures of HEURES) assert.equal(formatHeures(heures), fmtHeures(heures), String(heures));
  // Heures par jour d'une fiche de main d'œuvre (au centième, sous 24 h) : même texte qu'avant l'alias.
  const avantAlias = (heures: number) => `${String(Number(heures)).replace('.', ',')} h`;
  assert.deepEqual(ecarts([0.25, 7, 7.5, 7.75, 8, 23.99], avantAlias, formatHeures), []);
  // Hors de ce domaine, l'ancien texte n'arrondissait pas et n'avait pas de séparateur des milliers.
  assert.equal(avantAlias(2 / 3), '0,6666666666666666 h', 'témoin : l’ancien texte');
  assert.equal(formatHeures(2 / 3), '0,67 h');
  assert.equal(formatHeures(1234.5), `1${FINE}234,5 h`);
  // Effets visibles déclarés : toFixed(1) suivi de « h » (Statistiques.tsx:193, Performances.tsx:209-217) → fmtHeures.
  assert.equal(`${(3).toFixed(1)} h`, '3.0 h', 'témoin : Statistiques.tsx:193 de 8a47a50');
  assert.equal(fmtHeures(3), '3 h');
  assert.equal(`${(22 / 3).toFixed(1)}h`, '7.3h', 'témoin : Performances.tsx:217 de 8a47a50');
  assert.equal(fmtHeures(22 / 3), '7,33 h');
  // Quantité de la facture au temps passé (FactureTempsPasse.tsx:70) : fmtNombreHeures(q, 3), même texte qu'avant.
  assert.deepEqual(ecarts(HEURES, (q) => q.toLocaleString('fr-FR', { maximumFractionDigits: 3 }), (q) => fmtNombreHeures(q, 3)), []);
});

// --- Liste fermée de l'inventaire (C4 et C6 du contrôle du cadrage) ---
// Garde sur les sources : elle échoue si l'une des fonctions locales de l'inventaire, ou l'un de ses toLocaleString()
// sans locale, subsiste. Elle ne porte que sur cette liste, relevée par le cadrage sur 1d9eb57 (lignes de e39f005
// ci-dessous) : les montants alors hors périmètre, versés à #499 (Admin.tsx:625-637, Achats.tsx:127,
// lib/suiviChantiers.ts:148), sont passés au module par la version 2 de son cadrage, et gardés plus bas (familles de
// FAMILLE_PAR_FICHIER, et aucun toLocaleString() sans locale dans tout src/). L'E2E formats-locale.spec.ts montre le
// format à l'écran, navigateur en anglais ; ce test couvre aussi les écrans où un navigateur français ne le montrerait pas.
const racineClient = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relatif: string) => readFileSync(path.join(racineClient, 'src', relatif), 'utf8');

// Exception nommée (C6) : la fiche chantier garde ses dix toLocaleString() sans locale (l. 54, 103, 117, 136, 150, 186,
// 187, 211, 212 et 218), suivis par #388 ; A5 n'y a changé que l'import du module.
const EXCEPTIONS: Record<string, string> = {
  'components/ChantierIndicateurs.tsx': '#388 : montants de la fiche chantier sans locale française ni deux décimales',
};

// Fonctions locales de l'inventaire, retirées : [fichier, fonction, ligne sur e39f005].
const FONCTIONS_LOCALES: [string, string, number][] = [
  ['pages/ListeChantiers.tsx', 'fmtEuro', 34],
  ['pages/ListeChantiers.tsx', 'fmtHeures', 35],
  ['pages/Dashboard.tsx', 'euros', 86],
  ['pages/MesCommerciaux.tsx', 'fmtEuro', 22],
  ['pages/ResultatCommercial.tsx', 'fmtEuro', 21],
  ['components/EditeurBareme.tsx', 'fmtEuro', 3],
  ['components/CoutsSuitesChantier.tsx', 'euros', 4],
  ['components/CoutsSuitesChantier.tsx', 'heures', 5],
  ['components/OuvrirChantierAffaire.tsx', 'euros', 12],
  ['pages/Factures.tsx', 'formatMontant', 60],
  ['pages/Reglements.tsx', 'formatMontant', 25],
  ['components/FactureTempsPasse.tsx', 'formatMontant', 5],
  ['pages/Interventions.tsx', 'montantEuros', 57],
  ['lib/coutsIntervention.ts', 'heuresFr', 43],
  ['lib/tempsPasse.ts', 'quantiteFr', 61],
];
// Définition d'une fonction de ce nom : `const nom = (…) =>`, `const nom = x =>`, ou `function nom(`.
const definition = (nom: string) => new RegExp(`(?:\\b(?:const|let|var)\\s+${nom}\\s*=\\s*(?:\\(|\\w+\\s*=>))|(?:\\bfunction\\s+${nom}\\s*\\()`);

// Fonctions gardées pour leurs appelants, qui deviennent des appels du module : [fichier, nom, appel attendu].
const FONCTIONS_GARDEES: [string, string, RegExp][] = [
  ['lib/mainOeuvre.ts', 'formatEuros', /\bfmtMontantDocument\b/],
  ['lib/tempsPasse.ts', 'formatPrix', /\bfmtMontantDocument\b/],
  ['lib/factureTempsPasse.ts', 'heuresFr', /\bfmtHeures\(heures, 3\)/],
  ['lib/catalogueDevis.ts', 'formatHeuresPrevues', /\bfmtHeures\(heures\)/],
  // #499, cadrage version 2, point 2 : heures par jour d'une fiche de main d'œuvre, alias de `fmtHeures` (et non plus
  // `String(…).replace('.', ',')`, sans arrondi ni séparateur des milliers).
  ['lib/mainOeuvre.ts', 'formatHeures', /\bfmtHeures\(heures\)/],
];

// Fichiers dont les montants s'écrivaient sans locale (toLocaleString()) : [fichier, lignes sur e39f005]. Sur e39f005,
// tous leurs toLocaleString() sans locale étaient des entrées de l'inventaire ; il n'en reste aucun.
const SANS_LOCALE: [string, number[]][] = [
  ['pages/Dashboard.tsx', [184, 195, 206, 218, 236]],
  ['pages/Performances.tsx', [103, 107, 165]],
  ['pages/Statistiques.tsx', [195, 246]],
  ['pages/MesCommerciaux.tsx', [22]],
  ['pages/ResultatCommercial.tsx', [21]],
  ['components/EditeurBareme.tsx', [3]],
];
const TO_LOCALE_SANS_LOCALE = /\.toLocaleString\(\s*\)/;
const lignesSansLocale = (texte: string) => texte.split('\n').flatMap((ligne, rang) => (TO_LOCALE_SANS_LOCALE.test(ligne) ? [rang + 1] : []));

// fmtPourcentage (#499, cadrage version 2, point 1) : nom du module, qu'aucun écran ne redéfinit ; ce n'est pas une famille
// de montant (FAMILLES_MONTANT, plus bas, ne le compte pas).
const NOMS_DU_MODULE = ['fmtEuro', 'fmtEuroCentime', 'fmtMontantDocument', 'fmtNombreHeures', 'fmtHeures', 'fmtPourcentage', 'toDateFrancaise', 'fmtDate'];
const IMPORT_DU_MODULE = /from '(?:\.\.\/lib|\.)\/formats'/;
const fichiersSources = (dossier: string): string[] => readdirSync(dossier).flatMap((nom) => {
  const chemin = path.join(dossier, nom);
  return statSync(chemin).isDirectory() ? fichiersSources(chemin) : /\.tsx?$/.test(nom) ? [chemin] : [];
});

test('liste fermée de l’inventaire : aucune fonction de format locale ni montant sans locale ne subsiste, et chaque entrée emploie le module (#205)', () => {
  for (const [fichier, nom, ligne] of FONCTIONS_LOCALES) {
    const texte = source(fichier);
    assert.doesNotMatch(texte, definition(nom), `${fichier} : la fonction locale ${nom} (l. ${ligne} sur e39f005) subsiste`);
    assert.match(texte, IMPORT_DU_MODULE, `${fichier} : le module lib/formats est employé`);
  }
  for (const [fichier, nom, appel] of FONCTIONS_GARDEES) {
    const texte = source(fichier);
    const ligne = texte.split('\n').find((l) => l.startsWith(`export const ${nom} =`));
    assert.ok(ligne, `${fichier} : ${nom} reste exportée`);
    assert.doesNotMatch(ligne, /toLocaleString/, `${fichier} : ${nom} n’écrit plus son propre format`);
    assert.match(ligne, appel, `${fichier} : ${nom} appelle le module`);
    assert.match(texte, IMPORT_DU_MODULE, `${fichier} : le module lib/formats est importé`);
  }
  for (const [fichier, lignes] of SANS_LOCALE) {
    const restants = lignesSansLocale(source(fichier));
    assert.deepEqual(restants, [], `${fichier} : toLocaleString() sans locale aux lignes ${restants.join(', ')} (inventaire : l. ${lignes.join(', ')} sur e39f005)`);
    assert.match(source(fichier), IMPORT_DU_MODULE, `${fichier} : le module lib/formats est employé`);
  }
  // L'exception nommée n'entre dans aucune liste ; sa garde reste à #388.
  for (const fichier of Object.keys(EXCEPTIONS)) {
    assert.ok(![...FONCTIONS_LOCALES, ...FONCTIONS_GARDEES, ...SANS_LOCALE].some(([f]) => f === fichier), `${fichier} : exception (${EXCEPTIONS[fichier]})`);
  }
});

// Famille de montant de chaque fichier (C1 de l'audit des montants de #500). Le centime en devise et la forme des
// documents ne diffèrent que par l'espace avant « € » (U+00A0 contre U+0020) : un écran passé de l'une à l'autre changerait
// de texte sans qu'aucun parcours E2E ne le voie, `toHaveText` et `\s` acceptant toute espace. Chaque fichier qui met en
// forme un montant par le module est donc lié à la famille de son texte d'avant #205, et à elle seule. Chaque nom compte,
// alias de la forme des documents compris.
const FAMILLES_MONTANT: Record<string, string> = {
  fmtEuro: 'euro près',
  fmtEuroCentime: 'centime en devise',
  fmtMontantDocument: 'forme des documents',
  formatEuros: 'forme des documents',
  formatPrix: 'forme des documents',
  formatPrixFacultatif: 'forme des documents',
};
// Relevé par le parseur TypeScript : seuls les identifiants du code comptent (N9 de la vérification de l'audit de #500).
// Un commentaire, une chaîne, une expression régulière ou un texte JSX peuvent nommer une famille, ou contenir « /* » et
// « // », sans rien employer ni rien cacher. Un retrait des commentaires par expression régulière laissait un « /* » écrit
// dans un commentaire de ligne (« /api/factures/* »), une chaîne ou une expression régulière avaler le code jusqu'au
// prochain « */ ».
const arbre = (texte: string, fichier = 'extrait.tsx') => ts.createSourceFile(fichier, texte, ts.ScriptTarget.Latest, false, fichier.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
const identifiants = (noeud: ts.Node, vus = new Set<string>()) => {
  if (ts.isIdentifier(noeud)) vus.add(noeud.text);
  // Rappel sans valeur rendue : forEachChild s'arrête au premier enfant dont le rappel rend une valeur.
  ts.forEachChild(noeud, (enfant) => { identifiants(enfant, vus); });
  return vus;
};
const famillesDe = (noeud: ts.Node) => {
  const vus = identifiants(noeud);
  return [...new Set(Object.keys(FAMILLES_MONTANT).filter((nom) => vus.has(nom)).map((nom) => FAMILLES_MONTANT[nom]))];
};
const famillesEmployees = (texte: string, fichier?: string) => famillesDe(arbre(texte, fichier));
// Enveloppes exportées : export dont le corps se réduit à une expression hors JSX (alias, flèche à expression, fonction à
// un seul return), sur une ou plusieurs lignes. Un composant qui rend du JSX n'en est pas une.
const expressionSeule = (noeud: ts.Node | undefined): ts.Node | null => {
  if (!noeud) return null;
  if (!ts.isArrowFunction(noeud) && !ts.isFunctionExpression(noeud) && !ts.isFunctionDeclaration(noeud)) return noeud;
  const corps = noeud.body;
  if (!corps || !ts.isBlock(corps)) return corps ?? null;
  const [seule, ...autres] = corps.statements;
  return seule && !autres.length && ts.isReturnStatement(seule) ? seule.expression ?? null : null;
};
const estJsx = (noeud: ts.Node): boolean => (ts.isParenthesizedExpression(noeud) ? estJsx(noeud.expression) : ts.isJsxElement(noeud) || ts.isJsxFragment(noeud) || ts.isJsxSelfClosingElement(noeud));
const deFamille = (expression: ts.Node | null | undefined) => !!expression && !estJsx(expression) && famillesDe(expression).length > 0;
const enveloppesDeFamille = (fichierArbre: ts.SourceFile) => {
  // Déclarations du fichier, pour un « export { x } » d'une constante ou d'une fonction locale (vérification N9 de l'audit).
  const locales = new Map<string, ts.Node | null>();
  for (const instruction of fichierArbre.statements) {
    if (ts.isVariableStatement(instruction)) for (const d of instruction.declarationList.declarations) if (ts.isIdentifier(d.name)) locales.set(d.name.text, expressionSeule(d.initializer));
    if (ts.isFunctionDeclaration(instruction) && instruction.name) locales.set(instruction.name.text, expressionSeule(instruction));
  }
  return fichierArbre.statements.flatMap((instruction) => {
    // Réexport : « export { fmtMontantDocument as x } from './formats' », ou « export { x } » d'une enveloppe locale.
    if (ts.isExportDeclaration(instruction) && instruction.exportClause && ts.isNamedExports(instruction.exportClause)) {
      return instruction.exportClause.elements
        .filter((element) => { const local = (element.propertyName ?? element.name).text; return local in FAMILLES_MONTANT || (!instruction.moduleSpecifier && deFamille(locales.get(local))); })
        .map((element) => element.name.text);
    }
    // Export par défaut (N3 du contrôle de cohérence de #500, versée à #499) : « export default fmtMontantDocument; », d'une
    // enveloppe locale (« export default montantPiece; ») ou d'une expression (« export default (m) => fmtEuro(m); »).
    // Son nom à l'import est libre, et aucun identifiant ne le relie à sa famille : il est rendu sous le nom « default »,
    // que FAMILLES_MONTANT ne compte pas.
    if (ts.isExportAssignment(instruction)) {
      const expression = instruction.expression;
      const locale = ts.isIdentifier(expression) ? locales.get(expression.text) : undefined;
      return !instruction.isExportEquals && (deFamille(expressionSeule(expression)) || deFamille(locale)) ? ['default'] : [];
    }
    const modificateurs = ts.canHaveModifiers(instruction) ? ts.getModifiers(instruction) ?? [] : [];
    if (!modificateurs.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return [];
    // « export default function », nommée ou non : rendue elle aussi sous le nom « default ».
    const parDefaut = modificateurs.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    const exports: [string, ts.Node | null][] = ts.isVariableStatement(instruction)
      ? instruction.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [[d.name.text, expressionSeule(d.initializer)] as [string, ts.Node | null]] : []))
      : ts.isFunctionDeclaration(instruction) && (parDefaut || instruction.name) ? [[parDefaut ? 'default' : instruction.name!.text, expressionSeule(instruction)]] : [];
    return exports.filter(([, expression]) => deFamille(expression)).map(([nom]) => nom);
  });
};
// Famille du texte d'avant #205, fichier par fichier (test « chaque famille garde son texte ») ; pour les écrans passés au
// module par #499, la famille choisie par ce correctif.
const FAMILLE_PAR_FICHIER: [string, string][] = [
  // Inventaire du cadrage.
  ['pages/ListeChantiers.tsx', 'euro près'],
  ['pages/Dashboard.tsx', 'euro près'],
  ['pages/MesCommerciaux.tsx', 'euro près'],
  ['pages/ResultatCommercial.tsx', 'euro près'],
  ['components/EditeurBareme.tsx', 'euro près'],
  ['pages/Performances.tsx', 'euro près'],
  ['pages/Statistiques.tsx', 'euro près'],
  ['components/CoutsSuitesChantier.tsx', 'centime en devise'],
  ['components/OuvrirChantierAffaire.tsx', 'centime en devise'],
  ['pages/Factures.tsx', 'centime en devise'],
  ['pages/Reglements.tsx', 'centime en devise'],
  ['components/FactureTempsPasse.tsx', 'centime en devise'],
  ['pages/Interventions.tsx', 'centime en devise'],
  ['lib/mainOeuvre.ts', 'forme des documents'],
  ['lib/tempsPasse.ts', 'forme des documents'],
  // Hors inventaire : écrans qui employaient déjà ces noms avant #205, au même texte. Le prix du devis au temps passé et
  // du forfait reste celui du PDF.
  ['components/ChantierJournalAchats.tsx', 'euro près'],
  ['components/CatalogueMainOeuvre.tsx', 'forme des documents'],
  ['components/DevisTempsPasse.tsx', 'forme des documents'],
  ['components/DevisForfaitMainOeuvre.tsx', 'forme des documents'],
  // #499 (cadrage du correctif, version 2) : écrans du pilote qui n'employaient aucune famille avant #205, et dont le texte
  // change (point décimal, coût horaire brut, résumé des règlements sans séparateur des milliers). Famille choisie par
  // #499, choix par défaut, à confirmer (règle 5) :
  //  - devis (prix d'une fiche du catalogue, HT, TVA et TTC de l'historique, acompte constaté) : le texte du PDF du même
  //    devis (devis/document.ts, formatMontantFacture) ;
  //  - catalogue (prix de vente, prix d'achat) : le texte de l'onglet de la main d'œuvre du même écran (formatEuros) ;
  //  - administration, Intervenants (coût horaire chargé) : la famille des coûts de main-d'œuvre que ce taux valorise
  //    (Interventions.tsx) ; il n'est imprimé sur aucun document.
  // Reglements.tsx, plus haut, reste au centime en devise : #499 y passe les quatre phrases du résumé de la saisie.
  ['pages/Devis.tsx', 'forme des documents'],
  ['pages/Catalogue.tsx', 'forme des documents'],
  ['components/AdminReferentiels.tsx', 'centime en devise'],
  // Lot « Assistante technique », PR AT-2a (cadrage, version 2, C2 ; réponse 8 du 06-11-2026 : catalogue et parc en lecture
  // seule) : chaque équipement du parc affiche le prix d'achat HT de son modèle à qui le lit, « au format
  // fmtMontantDocument », comme le prix d'une fiche dans la recherche du catalogue du devis (Devis.tsx, plus haut).
  ['pages/ClientDetail.tsx', 'forme des documents'],
  // Lot « Assistante technique », PR AT-3 (cadrage v2, C1 : règlements de sa facture en lecture) : la part d'un règlement
  // affectée à une facture, affichée sous la liste des factures, au texte des montants de cette liste (Factures.tsx : TTC, reste
  // dû, situation du règlement).
  ['components/ReglementsFacture.tsx', 'centime en devise'],
  // Lot « marge d'un contrat » (cadrage v3, § 4 : « Montants par fmtEuroCentime ») : marge du contrat sur l'écran des
  // contrats, au texte de la marge à l'heure d'un SAV hors contrat (Interventions.tsx, plus haut), dont elle est la variante
  // sous contrat.
  ['components/MargeDuContrat.tsx', 'centime en devise'],
  // #499, cadrage du correctif, version 2, point 4 (C4, montants des écrans Travaux ; choix par défaut, à confirmer,
  // règle 5) : famille choisie pour garder le texte d'origine quand il était déjà juste.
  //  - journal des heures, coût interne d'une ligne : centime en devise (« 141,00 € », et non « 141.00 € » de toFixed) ;
  //  - fiche chantier, hypothèses de la marge estimée : centime en devise, une seule famille par fichier (« 47,00 €/h » sur
  //    la fiche, comme dans l'administration ; « 234,50 € HT ») ;
  //  - administration, Chantiers : budgets à l'euro près, comme la liste des chantiers (ListeChantiers.tsx), « — » gardé
  //    pour un vendu non communiqué (réponse de Nelson du 06-11-2026) ;
  //  - journal des achats : euro près, comme le journal des achats de la fiche (ChantierJournalAchats.tsx) ; « 901,50 € »
  //    s'y affiche « 902 € ».
  ['pages/Heures.tsx', 'centime en devise'],
  ['lib/suiviChantiers.ts', 'centime en devise'],
  ['pages/Admin.tsx', 'euro près'],
  ['pages/Achats.tsx', 'euro près'],
];

test('famille de montant de chaque fichier : celle de son texte d’avant #205 (ou choisie par #499), et elle seule ; tout fichier qui met en forme un montant est lié à la sienne', () => {
  // Témoins du relevé : un nom se reconnaît seul (fmtEuro n'est pas lu dans fmtEuroCentime), un alias compte pour sa
  // famille, un commentaire, une chaîne ou un texte JSX ne comptent pas.
  assert.deepEqual(famillesEmployees('{fmtEuroCentime(facture.totalTtc)}'), ['centime en devise']);
  assert.deepEqual(famillesEmployees("import { formatEuros } from '../lib/mainOeuvre';"), ['forme des documents']);
  assert.deepEqual(famillesEmployees('{fmtEuro(a)} {fmtEuroCentime(b)}'), ['euro près', 'centime en devise']);
  assert.deepEqual(famillesEmployees('{fmtEuroCentime(a)} // et non fmtMontantDocument\n/* ni fmtEuro */ {/* ni formatPrix */}'), ['centime en devise']);
  assert.deepEqual(famillesEmployees("const lien = 'https://exemple.fr'; fmtEuro(a);"), ['euro près']);
  assert.deepEqual(famillesEmployees("const nom = 'fmtEuroCentime'; const p = <p>fmtMontantDocument</p>;"), []);
  // Un « /* » dans un commentaire de ligne, une chaîne ou une expression régulière n'efface pas le code qui suit (N9).
  assert.deepEqual(famillesEmployees('// routes /api/factures/*\n{fmtEuroCentime(a)} {fmtMontantDocument(b)}\n{/* fin */}'), ['centime en devise', 'forme des documents']);
  assert.deepEqual(famillesEmployees("const routes = '/api/factures/*';\n{fmtEuroCentime(a)} {fmtMontantDocument(b)}\n/* fin */"), ['centime en devise', 'forme des documents']);
  assert.deepEqual(famillesEmployees("const sansBarre = (c: string) => c.replace(/\\/*$/, '');\n{fmtMontantDocument(b)}\n/* fin */"), ['forme des documents']);
  // Témoins des enveloppes : alias, flèche et fonction à un seul return, sur une ou plusieurs lignes ; ni un composant,
  // ni une fonction qui compose sa phrase en plusieurs instructions.
  assert.deepEqual(enveloppesDeFamille(arbre([
    'export const a = fmtMontantDocument;',
    'export const b = (m: number) =>\n  fmtEuro(m);',
    'export function c(m: number) {\n  return fmtEuroCentime(m);\n}',
    'export function Composant() {\n  return (<span>{fmtEuro(1)}</span>);\n}',
    'export const phrase = (m: number) => { const t = fmtEuro(m); return `Total ${t}`; };',
    'export const sansFamille = (m: number) => m;',
  ].join('\n'))), ['a', 'b', 'c']);
  // Réexports : sous un autre nom depuis le module, ou d'une enveloppe locale ; le nom d'une famille reste une famille.
  assert.deepEqual(enveloppesDeFamille(arbre([
    "export { fmtMontantDocument as d } from './formats';",
    "export { fmtEuro } from './formats';",
    'const e = fmtEuroCentime;',
    'const f = (m: number) => m;',
    'export { e, f };',
  ].join('\n'))), ['d', 'fmtEuro', 'e']);
  // Exports par défaut (N3 du contrôle de cohérence de #500) : d'une famille, d'une enveloppe locale, d'une flèche, d'une
  // fonction anonyme ou nommée, ou par « export { … as default } » ; tous rendus sous le nom « default ». Un composant
  // exporté par défaut n'en est pas un (21 « export default Composant; » dans client/src).
  for (const [texte, attendu] of [
    ['export default fmtMontantDocument;', ['default']],
    ['const montantPiece = fmtEuroCentime;\nexport default montantPiece;', ['default']],
    ['export default (m: number) => fmtEuro(m);', ['default']],
    ['export default function (m: number) {\n  return formatEuros(m);\n}', ['default']],
    ['export default function montantPiece(m: number) {\n  return fmtEuro(m);\n}', ['default']],
    ["export { fmtMontantDocument as default } from './formats';", ['default']],
    ['function Composant() {\n  return (<span>{fmtEuro(1)}</span>);\n}\nexport default Composant;', []],
    ['const Page = () => {\n  const total = fmtEuro(1);\n  return <p>{total}</p>;\n};\nexport default Page;', []],
    ['export default function Page() {\n  return (<span>{fmtEuroCentime(1)}</span>);\n}', []],
    ['const sansFamille = (m: number) => m;\nexport default sansFamille;', []],
  ] as [string, string[]][]) assert.deepEqual(enveloppesDeFamille(arbre(texte)), attendu, texte);
  for (const [fichier, famille] of FAMILLE_PAR_FICHIER) {
    assert.deepEqual(famillesEmployees(source(fichier), fichier), [famille], `${fichier} : familles de montant employées`);
  }
  // Liste close : tout fichier de src/ qui emploie une famille y figure, hors le module et l'exception nommée (#388) ; et
  // toute enveloppe exportée d'une famille (alias, flèche ou fonction réduite à une expression) est comptée dans
  // FAMILLES_MONTANT.
  const sources = path.join(racineClient, 'src');
  for (const chemin of fichiersSources(sources)) {
    const relatif = path.relative(sources, chemin).split(path.sep).join('/');
    if (relatif === 'lib/formats.ts' || relatif in EXCEPTIONS) continue;
    const fichierArbre = arbre(readFileSync(chemin, 'utf8'), chemin);
    if (famillesDe(fichierArbre).length) assert.ok(FAMILLE_PAR_FICHIER.some(([f]) => f === relatif), `${relatif} : met en forme un montant ; sa famille est à fixer dans FAMILLE_PAR_FICHIER`);
    for (const nom of enveloppesDeFamille(fichierArbre)) {
      // Un export par défaut d'une famille n'a pas de nom que le relevé puisse suivre chez ses importateurs (N3).
      assert.ok(nom !== 'default', `${relatif} : un export par défaut renvoie à une famille de montant ; à exporter sous un nom compté dans FAMILLES_MONTANT`);
      assert.ok(Object.hasOwn(FAMILLES_MONTANT, nom), `${relatif} : ${nom} renvoie à une famille de montant ; à compter dans FAMILLES_MONTANT`);
    }
  }
});

// --- #499 : montants des écrans du pilote au format français (cadrage du correctif #499, version 2, « Tests ») ---
// Garde sur les sources : un montant ne s'écrit plus à la main avant « € ». FAMILLE_PAR_FICHIER ne voit qu'une famille
// employée, et non un montant écrit hors du module à côté d'elle : ces motifs, relevés sur 33013bf (base du correctif),
// le voient. Le corps de la requête des règlements (montant: (…).toFixed(2)) n'est pas suivi de « € » : il reste (liste
// fermée des toFixed, plus bas). Le taux de TVA du catalogue, que ce motif ne voyait pas (« 20.00 % », Catalogue.tsx),
// passe par fmtPourcentage depuis la version 2 du cadrage de #499 (« 20 % ») : garde des pourcentages, plus bas.
const ECRANS_499 = ['pages/Devis.tsx', 'pages/Catalogue.tsx', 'components/AdminReferentiels.tsx', 'pages/Reglements.tsx'];
// toFixed(…), éventuellement suivi d'appels (.replace(…)), puis la fin de l'expression (« } » d'un JSX ou d'un gabarit,
// ou une concaténation) et « € ».
const TO_FIXED_EURO = /\.toFixed\([^()]*\)(?:\.\w+\((?:[^()]|\([^()]*\))*\))*\s*(?:\}|\+\s*['"`])\s*€/g;
// Coût horaire chargé écrit tel que le serveur le rend, avant « € » : « ${i.tauxHoraireCharge} € » (« 45.5 € »).
const TAUX_HORAIRE_EURO = /\{[^{}]*\btauxHoraireCharge\b[^{}]*\}\s*€/g;
// saisieDeCentimes(…), texte d'un champ de saisie (« 1234,50 », sans séparateur des milliers), suivi de « € » ; son toFixed
// est dans lib/reglements.ts, que TO_FIXED_EURO ne voit pas. Deux niveaux de parenthèses dans l'argument.
const SAISIE_EURO = /\bsaisieDeCentimes\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)\s*(?:\}|\+\s*['"`])\s*€/g;
const occurrences = (texte: string, motif: RegExp) => texte.match(motif) ?? [];

test('#499 : plus aucun montant au point décimal (toFixed suivi de « € ») sur les écrans du devis, du catalogue, des intervenants et des règlements', () => {
  // Témoins, recopiés de 33013bf : prix d'une fiche du catalogue et totaux de l'historique (Devis.tsx:280 et :287), acompte
  // constaté (:287), prix de vente et prix d'achat (Catalogue.tsx:238-239).
  assert.equal(occurrences('· Réf. {fiche.reference} · {fiche.prixVenteHt.toFixed(2)} € HT{fiche.unite ? ` / ${fiche.unite}` : \'\'}', TO_FIXED_EURO).length, 1);
  assert.equal(occurrences('{d.client.raisonSociale} · HT {d.totalHt.toFixed(2)} € · TVA {d.totalTva.toFixed(2)} € · TTC {d.totalTtc.toFixed(2)} € · <span>', TO_FIXED_EURO).length, 3);
  assert.equal(occurrences('{d.acompteRecuLe ? `Acompte de ${(d.acompteMontant ?? 0).toFixed(2)} € constaté` : `Acompte de ${d.tauxAcompte ?? 0} % exigé`}', TO_FIXED_EURO).length, 1);
  assert.equal(occurrences('<td className="px-4 py-3 text-right">{Number(f.prixVenteHt).toFixed(2)} €</td>', TO_FIXED_EURO).length, 1);
  assert.equal(occurrences("<td>{f.prixAchatHt == null ? '—' : `${Number(f.prixAchatHt).toFixed(2)} €`}</td>", TO_FIXED_EURO).length, 1);
  // Autres écritures du même défaut : concaténation, point remplacé par une virgule, sans espace.
  assert.equal(occurrences("const t = prix.toFixed(2) + ' €';", TO_FIXED_EURO).length, 1);
  assert.equal(occurrences("{prix.toFixed(2).replace('.', ',')} €", TO_FIXED_EURO).length, 1);
  assert.equal(occurrences('{prix.toFixed(2)}€', TO_FIXED_EURO).length, 1);
  // Ni un taux, ni le corps d'une requête, ni le module.
  assert.deepEqual(occurrences('<td className="px-4 py-3 text-right">{Number(f.tauxTva).toFixed(2)} %</td>', TO_FIXED_EURO), []);
  assert.deepEqual(occurrences("body: JSON.stringify({ montant: (montantCentimes / 100).toFixed(2), moyen })", TO_FIXED_EURO), []);
  assert.deepEqual(occurrences('{fmtMontantDocument(fiche.prixVenteHt)} HT', TO_FIXED_EURO), []);
  for (const fichier of ECRANS_499) {
    const restants = occurrences(source(fichier), TO_FIXED_EURO);
    assert.deepEqual(restants, [], `${fichier} : montant au point décimal avant « € » (${restants.length})`);
  }
});

test('#499 : plus aucun coût horaire chargé écrit brut avant « € », dans aucun fichier du client', () => {
  // Témoin, recopié de 33013bf (AdminReferentiels.tsx:100), et d'autres écritures du même défaut.
  assert.equal(occurrences('                          : `${i.tauxHoraireCharge} €`}', TAUX_HORAIRE_EURO).length, 1);
  assert.equal(occurrences('<td>{i.tauxHoraireCharge} €</td>', TAUX_HORAIRE_EURO).length, 1);
  assert.equal(occurrences('<td>{Number(i.tauxHoraireCharge).toFixed(2)} €</td>', TAUX_HORAIRE_EURO).length, 1);
  // Ni la valeur d'un champ de saisie, ni l'en-tête de la colonne, ni le module.
  assert.deepEqual(occurrences('<input type="number" value={editRow.tauxHoraireCharge} onChange={e => editField(\'tauxHoraireCharge\', e.target.value)} />', TAUX_HORAIRE_EURO), []);
  assert.deepEqual(occurrences("<th style={{padding: '8px'}}>Coût Horaire (€/h)</th>", TAUX_HORAIRE_EURO), []);
  assert.deepEqual(occurrences(': fmtEuroCentime(Number(i.tauxHoraireCharge))}', TAUX_HORAIRE_EURO), []);
  const sources = path.join(racineClient, 'src');
  for (const chemin of fichiersSources(sources)) {
    const restants = occurrences(readFileSync(chemin, 'utf8'), TAUX_HORAIRE_EURO);
    assert.deepEqual(restants, [], `${path.relative(sources, chemin)} : coût horaire chargé écrit brut avant « € »`);
  }
});

test('#499 : le résumé de la saisie d’un règlement n’écrit plus saisieDeCentimes(…) suivi de « € » ; les champs de saisie le gardent', () => {
  // Témoins, recopiés de 33013bf : les quatre phrases du résumé (Reglements.tsx:264, :265, :266 et :270).
  assert.equal(occurrences('Affecté : {saisieDeCentimes(affecte)} € sur {saisieDeCentimes(montantCentimes ?? 0)} €', SAISIE_EURO).length, 2);
  assert.equal(occurrences('{resteAAffecter > 0 && ` — reste à affecter : ${saisieDeCentimes(resteAAffecter)} €`}', SAISIE_EURO).length, 1);
  assert.equal(occurrences('{resteAAffecter < 0 && ` — affecté en trop : ${saisieDeCentimes(-resteAAffecter)} €`}', SAISIE_EURO).length, 1);
  assert.equal(occurrences('Trop-perçu de {saisieDeCentimes((part.centimes ?? 0) - centimesDe(part.facture.resteDu))} € sur la facture {part.facture.numero}', SAISIE_EURO).length, 1);
  // Les champs de saisie gardent saisieDeCentimes, sans « € » (Reglements.tsx:105, :108 et :139 de 33013bf).
  assert.deepEqual(occurrences("setMontant(facture ? saisieDeCentimes(centimesDe(facture.resteDu)) : '');", SAISIE_EURO), []);
  assert.deepEqual(occurrences("[id, centimes ? saisieDeCentimes(centimes) : '']", SAISIE_EURO), []);
  const reglements = source('pages/Reglements.tsx');
  assert.ok((reglements.match(/\bsaisieDeCentimes\(/g) ?? []).length >= 3, 'témoin : les champs de saisie emploient encore saisieDeCentimes');
  const sources = path.join(racineClient, 'src');
  for (const chemin of fichiersSources(sources)) {
    const restants = occurrences(readFileSync(chemin, 'utf8'), SAISIE_EURO);
    assert.deepEqual(restants, [], `${path.relative(sources, chemin)} : saisieDeCentimes(…) suivi de « € » (${restants.length})`);
  }
});

test('un seul module de formats : lib/formats.ts remplace lib/formatsChantier.ts, et aucun écran ne redéfinit ses fonctions (#205)', () => {
  assert.ok(existsSync(path.join(racineClient, 'src/lib/formats.ts')), 'lib/formats.ts existe');
  assert.ok(!existsSync(path.join(racineClient, 'src/lib/formatsChantier.ts')), 'lib/formatsChantier.ts est remplacé');
  const fichiers = fichiersSources(path.join(racineClient, 'src'));
  for (const chemin of fichiers) {
    const relatif = path.relative(path.join(racineClient, 'src'), chemin);
    const texte = readFileSync(chemin, 'utf8');
    assert.doesNotMatch(texte, /formatsChantier/, `${relatif} : plus d’import de formatsChantier`);
    if (relatif === path.join('lib', 'formats.ts')) continue;
    for (const nom of NOMS_DU_MODULE) assert.doesNotMatch(texte, definition(nom), `${relatif} : ${nom} redéfinie hors du module`);
  }
  // Le module ne dépend pas de la langue du navigateur : chacun de ses toLocaleString() nomme fr-FR.
  const module = source('lib/formats.ts');
  const appels = module.match(/toLocaleString\(/g) ?? [];
  assert.ok(appels.length >= 4, 'témoin : les toLocaleString() du module sont relevés');
  assert.equal((module.match(/toLocaleString\('fr-FR'/g) ?? []).length, appels.length, 'chaque toLocaleString() du module nomme fr-FR');
  // Les jours passent par jourFrancais (cadrage : « les dates passent par jourFrancais »).
  assert.match(module, /export const toDateFrancaise = [^\n]*\bjourFrancais\(/);
});

test('témoin des gardes : elles reconnaissent les formes de l’inventaire, et non une variable du même nom', () => {
  // Formes relevées sur e39f005.
  assert.match('const fmtEuro = (n: number) => `${arrondiEuro(n).toLocaleString()} €`;', definition('fmtEuro'));
  assert.match('  const euros = (n: number) => `${arrondiEuro(n).toLocaleString(\'fr-FR\')} €`;', definition('euros'));
  assert.match('const heures = (nombre: number) => nombre.toLocaleString(\'fr-FR\', { maximumFractionDigits: 2 });', definition('heures'));
  assert.match('const quantiteFr = (heures: number) => heures.toLocaleString(\'fr-FR\', { maximumFractionDigits: 3 });', definition('quantiteFr'));
  assert.match('function formatMontant(montant: number) {', definition('formatMontant'));
  assert.match('const montantEuros = montant => Number(montant || 0).toLocaleString();', definition('montantEuros'));
  assert.equal(lignesSansLocale('a\n{arrondiEuro(globalStats.achatsTotal).toLocaleString()} €\nb').join(), '2');
  assert.equal(lignesSansLocale('{Math.round(globalStats.heuresTotal).toLocaleString( )} h').join(), '1');
  // Ni une variable du même nom, ni un format qui nomme sa locale.
  assert.doesNotMatch('  const heures = Math.floor(minutes / 60);', definition('heures'));
  assert.doesNotMatch('import { fmtEuro } from \'../lib/formats\';', definition('fmtEuro'));
  assert.deepEqual(lignesSansLocale('{arrondiEuro(x).toLocaleString(\'fr-FR\')} €'), []);
});

// --- #499, cadrage du correctif, version 2, point 8 : gardes étendues à tout src/ ---
// Après #499, plus aucun montant, heure ou pourcentage ne s'écrit hors du module dans client/src, hors l'exception nommée
// (ChantierIndicateurs.tsx, #388). Les appels sont relevés par le parseur TypeScript : un commentaire ou une chaîne qui les
// nomme ne compte pas (montants.ts cite `toFixed` dans deux commentaires).
const sourcesDuClient = () => {
  const sources = path.join(racineClient, 'src');
  return fichiersSources(sources).map((chemin) => ({ relatif: path.relative(sources, chemin).split(path.sep).join('/'), texte: readFileSync(chemin, 'utf8') }));
};
// Appels d'une méthode ou constructions relevés dans l'arbre : [ligne, texte de l'appel].
const appelsRetenus = (texte: string, fichier: string, retenir: (noeud: ts.CallExpression | ts.NewExpression) => boolean) => {
  const fichierArbre = arbre(texte, fichier);
  const trouves: [number, string][] = [];
  const visiter = (noeud: ts.Node) => {
    if ((ts.isCallExpression(noeud) || ts.isNewExpression(noeud)) && retenir(noeud)) {
      trouves.push([fichierArbre.getLineAndCharacterOfPosition(noeud.getStart(fichierArbre)).line + 1, noeud.getText(fichierArbre)]);
    }
    ts.forEachChild(noeud, visiter);
  };
  visiter(fichierArbre);
  return trouves;
};
const nomAppele = (noeud: ts.CallExpression | ts.NewExpression) => (ts.isPropertyAccessExpression(noeud.expression) ? noeud.expression.name.text : ts.isIdentifier(noeud.expression) ? noeud.expression.text : '');
const appelsToFixed = (texte: string, fichier: string) => appelsRetenus(texte, fichier, (n) => ts.isCallExpression(n) && nomAppele(n) === 'toFixed');
// toLocaleString(), toLocaleDateString(), toLocaleTimeString(), Intl.NumberFormat() ou Intl.DateTimeFormat() sans locale
// (aucun argument, ou `undefined`) : le texte suit alors la langue du navigateur (« 1,234.5 € » en anglais).
const METHODES_DE_LOCALE = new Set(['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']);
const FORMATS_INTL = new Set(['NumberFormat', 'DateTimeFormat']);
const appelsSansLocale = (texte: string, fichier: string) => appelsRetenus(texte, fichier, (n) => {
  const nom = nomAppele(n);
  const intl = FORMATS_INTL.has(nom) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'Intl';
  if (!(ts.isCallExpression(n) && METHODES_DE_LOCALE.has(nom)) && !intl) return false;
  const [premier] = n.arguments ?? [];
  return !premier || (ts.isIdentifier(premier) && premier.text === 'undefined');
});

// toFixed restants dans src/ hors l'exception nommée, liste fermée (cadrage v2, point 8 ; lignes sur 39ad174) : aucun
// n'est un affichage. Clé : le fichier et le texte de l'appel, plutôt que la ligne, qu'une modification voisine déplace.
const TO_FIXED_RESTANTS: [string, string][] = [
  // montants.ts l. 38 : arrondi d'un rapport sur sa valeur exacte en binaire ; rend un nombre, jamais affiché.
  ['lib/montants.ts', 'Math.abs(montant).toFixed(decimales)'],
  // reglements.ts l. 26 : valeur d'un champ de saisie (« 1234,50 », virgule remise), jamais suivie de « € » (SAISIE_EURO).
  ['lib/reglements.ts', '(centimes / 100).toFixed(2)'],
  // traceSignature.ts l. 54 et 57 : coordonnées du tracé SVG de la signature.
  ['lib/traceSignature.ts', '(premier[0] * largeur).toFixed(1)'],
  ['lib/traceSignature.ts', '(premier[1] * 100).toFixed(1)'],
  ['lib/traceSignature.ts', '(x * largeur).toFixed(1)'],
  ['lib/traceSignature.ts', '(y * 100).toFixed(1)'],
  // Reglements.tsx l. 149 et 150 : montants du corps de la requête d'un règlement, au point décimal, pour le serveur.
  ['pages/Reglements.tsx', '((part.centimes ?? 0) / 100).toFixed(2)'],
  ['pages/Reglements.tsx', '(montantCentimes / 100).toFixed(2)'],
];
const triees = (paires: [string, string][]) => [...paires].sort(([a, b], [c, d]) => (a === c ? b.localeCompare(d) : a.localeCompare(c)));

test('#499 v2 : liste fermée des toFixed restants dans src/ (aucun n’est un affichage), hors l’exception nommée', () => {
  // Témoins : le parseur relève un toFixed d'un affichage de 8a47a50 (Heures.tsx:195), et non un toFixed cité dans un
  // commentaire ou une chaîne.
  assert.deepEqual(appelsToFixed('<td>{coutLigneHeures(h.nbrHeures, h.tauxHoraireApplique).toFixed(2)} €</td>', 'extrait.tsx').map(([, t]) => t), ['coutLigneHeures(h.nbrHeures, h.tauxHoraireApplique).toFixed(2)']);
  assert.deepEqual(appelsToFixed("// alors que `toFixed(2)` donne 1,02 €\nconst t = 'x.toFixed(2)';", 'extrait.ts'), []);
  assert.deepEqual(appelsToFixed('const a = b?.toFixed(1);', 'extrait.ts').map(([, t]) => t), ['b?.toFixed(1)']);
  const restants: [string, string][] = [];
  const lignes: string[] = [];
  for (const { relatif, texte } of sourcesDuClient()) {
    if (relatif in EXCEPTIONS) continue;
    for (const [ligne, appel] of appelsToFixed(texte, relatif)) { restants.push([relatif, appel]); lignes.push(`${relatif}:${ligne} ${appel}`); }
  }
  assert.deepEqual(triees(restants), triees(TO_FIXED_RESTANTS), `toFixed relevés :\n${lignes.join('\n')}`);
  // L'exception nommée en garde (fiche chantier, #388) : elle n'entre pas dans cette liste.
  assert.ok(appelsToFixed(source('components/ChantierIndicateurs.tsx'), 'components/ChantierIndicateurs.tsx').length > 0, 'témoin : l’exception nommée garde des toFixed');
});

test('#499 v2 : plus aucun montant au point décimal (toFixed suivi de « € ») dans aucun fichier de src/', () => {
  // Témoin, recopié de 8a47a50 : coût interne d'une ligne du journal des heures (Heures.tsx:195).
  assert.equal(occurrences('{coutLigneHeures(h.nbrHeures, h.tauxHoraireApplique).toFixed(2)} €', TO_FIXED_EURO).length, 1);
  for (const { relatif, texte } of sourcesDuClient()) {
    const restants = occurrences(texte, TO_FIXED_EURO);
    assert.deepEqual(restants, [], `${relatif} : montant au point décimal avant « € » (${restants.length})`);
  }
});

test('#499 v2 : aucun toLocaleString() sans locale dans src/, hors l’exception nommée', () => {
  // Témoins, recopiés de 8a47a50 : budgets d'Administration > Chantiers (Admin.tsx:642 et :650), achat (Achats.tsx:127).
  assert.equal(appelsSansLocale("<div>{c.budgetGlobalVendu == null ? '—' : `${c.budgetGlobalVendu.toLocaleString()} €`}</div>", 'extrait.tsx').length, 1);
  assert.equal(appelsSansLocale('<div>{c.budgetMaterielVendu.toLocaleString()} €</div>', 'extrait.tsx').length, 1);
  assert.equal(appelsSansLocale("<td style={{padding: '8px'}}>{a.montantHT.toLocaleString()} €</td>", 'extrait.tsx').length, 1);
  // Autres écritures du même défaut : espaces, `undefined` pour locale, chaînage optionnel, date, Intl sans locale.
  for (const extrait of ['x.toLocaleString( )', 'x.toLocaleString(undefined, { maximumFractionDigits: 2 })', 'x?.toLocaleString()', 'd.toLocaleDateString()', 'new Intl.NumberFormat().format(x)', 'Intl.DateTimeFormat(undefined, { timeZone: f })']) {
    assert.equal(appelsSansLocale(extrait, 'extrait.ts').length, 1, extrait);
  }
  // Ni une locale nommée (fr-FR, ou en-CA de dateFormatting.ts pour un jour AAAA-MM-JJ), ni un commentaire ou une chaîne.
  for (const extrait of ["x.toLocaleString('fr-FR')", "x.toLocaleString('fr-FR', { maximumFractionDigits: 1 })", "new Intl.NumberFormat('fr-FR').format(r.taux)", "new Intl.DateTimeFormat('en-CA', { timeZone: f })", "// x.toLocaleString() sans locale\nconst t = 'x.toLocaleString()';"]) {
    assert.deepEqual(appelsSansLocale(extrait, 'extrait.ts'), [], extrait);
  }
  for (const { relatif, texte } of sourcesDuClient()) {
    if (relatif in EXCEPTIONS) continue;
    const restants = appelsSansLocale(texte, relatif);
    assert.deepEqual(restants, [], `${relatif} : format sans locale, l. ${restants.map(([l]) => l).join(', ')}`);
  }
});

// Motifs ciblés des heures et des taux écrits bruts (cadrage v2, point 8). Une expression « nue » : un identifiant ou une
// propriété, sans appel (un appel du module, fmtHeures(…), fmtPourcentage(…), n'en est pas une), éventuellement suivie de
// « ?? valeur ».
const nue = (nom: string) => `[\\w$.?!]*(?:${nom})[\\w$.?!]*(?:\\s*\\?\\?\\s*[\\w$.]+)?`;
// Heures : expression nue dont le nom dit une durée (« heures », « Heures », « realisees »), éventuellement suivie de
// toFixed(…), puis « h » comme mot. L'heure d'horloge de Performances (heurePic, HOUR_RANGE, h du créneau) n'a pas ce nom.
const HEURES_BRUTES = new RegExp(`\\{\\s*${nue('[hH]eures|realisees')}(?:\\.toFixed\\([^()]*\\))?\\s*\\}\\s*h\\b`, 'g');
// Pourcentage au point décimal : toFixed(…), la fin de l'expression, puis « % » (« 12.0% », « 20.00 % »).
const TO_FIXED_POURCENT = /\.toFixed\([^()]*\)\s*\}\s*%/g;
// Taux brut : expression nue dont le nom dit un taux, ou la cible d'une trace de règle TVA, puis « % ».
const TAUX_BRUT = new RegExp(`\\{\\s*${nue('taux|Taux|cible')}\\s*\\}\\s*%`, 'g');
// Pourcentage nu dans un texte JSX (« {pct}% »). Le « % » du CSS est dans un gabarit (« width: `${pct}%` »,
// « `${from}% ${cumulative}%` ») : l'accolade y suit « $ », qu'exclut ce motif.
const POURCENT_JSX_BRUT = new RegExp(`(?<![$\\w])\\{\\s*${nue('\\w')}\\s*\\}\\s*%`, 'g');
// Pourcentage nu dans un gabarit, nommé « pct » ou « Pct », hors d'une propriété CSS de dimension (« height: `${heightPct}%` »).
const POURCENT_GABARIT_BRUT = new RegExp(`(?<!\\b(?:width|height|left|right|top|bottom|minWidth|maxWidth|flexBasis)\\s*:\\s*\`)\\$\\{\\s*${nue('pct|Pct')}\\s*\\}\\s*%`, 'g');
const MOTIFS_BRUTS: [string, RegExp][] = [['heure brute', HEURES_BRUTES], ['pourcentage au point décimal', TO_FIXED_POURCENT], ['taux brut', TAUX_BRUT], ['pourcentage nu (JSX)', POURCENT_JSX_BRUT], ['pourcentage nu (gabarit)', POURCENT_GABARIT_BRUT]];
// Liste fermée des écritures nues gardées : dureeTempsPasse (tempsPasse.ts:60), heures entières d'une durée (Math.floor
// des minutes), suivies des minutes, comme le PDF : « 1 h 15 min ». Un entier ne prend ni décimale ni séparateur.
const ECRITURES_NUES_GARDEES: [string, string, string][] = [
  ['lib/tempsPasse.ts', 'heure brute', '{heures} h'],
  ['lib/tempsPasse.ts', 'heure brute', '{heures} h'],
];

test('#499 v2 : motifs ciblés des heures et des taux bruts ; témoins de 8a47a50, ni le « % » du CSS ni l’heure d’horloge', () => {
  const trouve = (extrait: string) => MOTIFS_BRUTS.flatMap(([nom, motif]) => occurrences(extrait, motif).map(() => nom));
  // Heures, recopiées de 8a47a50 : Heures.tsx:73, :74, :164 et :192 ; Statistiques.tsx:193 ; Performances.tsx:209, :216 et
  // :217 ; Interventions.tsx:326 (pilote, #259) ; Admin.tsx:646.
  for (const extrait of [
    '<span>{realisees}h réalisées</span>',
    '<span>{c.heuresVendues}h vendues</span>',
    '<span className="font-extrabold text-primary text-lg">{h.nbrHeures}h</span>',
    '<td className="px-6 py-4 font-bold text-primary">{h.nbrHeures}h</td>',
    '<div className="font-black text-purple-600">{iv.heures.toFixed(1)} h</div>',
    "{d.nbSaisies > 0 ? `${d.heuresSaisies.toFixed(1)}h` : '—'}",
    "<span>{a.heuresTotalesSaisies.toFixed(1)}h saisies · {a.nbSaisiesTotal} saisie{a.nbSaisiesTotal > 1 ? 's' : ''}</span>",
    '<span>{a.moyenneHeuresParJourActif.toFixed(1)}h / jour actif en moyenne</span>',
    "<li key={heure.id}>{formatDateOnlyOrEmpty(heure.date)} — {heure.nbrHeures} h{heure.commentaire ? ` — ${heure.commentaire}` : ''}</li>",
    '<div className="font-bold">{c.heuresVendues} h</div>',
    '<td>{x.nbrHeures ?? 0} h</td>',
  ]) assert.deepEqual(trouve(extrait), ['heure brute'], extrait);
  // Pourcentages et taux, recopiés de 8a47a50 : Dashboard.tsx:221, :366 et :371 ; Statistiques.tsx:127 et :305 ;
  // Performances.tsx:118, :169 et :184 ; Catalogue.tsx:241.
  for (const extrait of [
    "{globalStats.margePct != null ? `${globalStats.margePct.toFixed(1)}% · ` : ''}{periodLabel}",
    '<span className="text-sm font-black text-primary-dark">{pct.toFixed(0)}%</span>',
    '<span className="sm:hidden text-sm font-black text-primary-dark w-12 text-right">{pct.toFixed(0)}%</span>',
    '<span className="text-sm font-semibold text-gray-400">({c.pct.toFixed(0)}%)</span>',
    "<td style={{ padding: '8px', textAlign: 'right' }} className=\"text-gray-500 font-semibold\">{t.pct.toFixed(1)}%</td>",
    "<div className=\"font-bold text-gray-800 mt-0.5\">{p.margePct == null ? '—' : `${p.margePct.toFixed(1)}%`}</div>",
    '{p.tauxDepassementHeures.toFixed(1)}%',
    '{p.nbObjectifsRespectes}/{p.nbChantiersTermines} ({p.tauxObjectifsRespectes.toFixed(0)}%)',
    '<td className="px-4 py-3 text-right">{Number(f.tauxTva).toFixed(2)} %</td>',
  ]) assert.deepEqual(trouve(extrait), ['pourcentage au point décimal'], extrait);
  // Taux de TVA de l'écran Comptabilité, recopiés de 8a47a50 : message d'enregistrement (:57), message de retrait (:73),
  // historique, titre et texte de la boîte de retrait (:97) ; acompte exigé de l'historique des devis (33013bf, corrigé par #571).
  for (const extrait of [
    'setSucces(`TVA ${b.taux}% enregistrée.`)',
    'setSucces(`Règle TVA ${retraitTva.taux} % retirée. Le compte reste disponible.`)',
    "{j.type === 'TVA' ? `TVA ${j.cible} %` : libelles[j.cible] ?? j.cible}",
    '<h2 className="text-lg font-semibold">Retirer la règle TVA {retraitTva.taux} % ?</h2>',
    'les émissions futures à {retraitTva.taux} % seront bloquées',
    '`Acompte de ${d.tauxAcompte ?? 0} % exigé`',
  ]) assert.ok(trouve(extrait).includes('taux brut'), extrait); // dans un texte JSX, le motif du pourcentage nu le voit aussi
  // Pourcentages nus, autres écritures du même défaut.
  assert.deepEqual(trouve('<span>{pct}%</span>'), ['pourcentage nu (JSX)']);
  assert.deepEqual(trouve('<td>{p.margePct} %</td>'), ['pourcentage nu (JSX)']);
  assert.deepEqual(trouve('`${p.margePct}% · `'), ['pourcentage nu (gabarit)']);
  assert.deepEqual(trouve('`${margeEstimeeEnCoursPct} % du vendu`'), ['pourcentage nu (gabarit)']);
  // Ni le « % » du CSS, ni l'heure d'horloge (Performances.tsx:221, :228, :238 et :239), ni un appel du module ou un
  // format français, ni la durée entière gardée.
  for (const extrait of [
    "style={{ width: `${pct}%`, backgroundColor: fillColor(color, ratio) }}",
    "style={{ height: `${heightPct}%` }}",
    "style={{ width: `${Math.min(100, percent)}%` }}",
    "style={{ width: `${(iv.heures / maxHeures) * 100}%` }}",
    '`${CHANTIER_COLORS[c.key]} ${from}% ${cumulative}%`',
    "Créneau de saisie habituel {a.heurePic != null && <span className=\"text-accent\">— vers {a.heurePic}h-{a.heurePic + 1}h</span>}",
    "title={`${h}h : ${count} saisie${count > 1 ? 's' : ''}`}",
    '<span>{HOUR_RANGE[0]}h</span>',
    '<span>{HOUR_RANGE[HOUR_RANGE.length - 1]}h</span>',
    '<span>{fmtHeures(realisees)} réalisées</span>',
    '{fmtPourcentage(p.margePct, 1)}',
    "<td className=\"p-2\">{new Intl.NumberFormat('fr-FR').format(r.taux)} %</td>",
    "<td className=\"p-2\">{ligne.tauxTva.toLocaleString('fr-FR')} %</td>",
    "<td>{String(f.tauxTva).replace('.', ',')} %</td>",
    '`, plus le coût réel des ${nombre(heuresSuites, 2)} h de suites SAV`',
    "placeholder={String(retraitTva.taux)}",
  ]) assert.deepEqual(trouve(extrait), [], extrait);
  const relevees: [string, string, string][] = [];
  for (const { relatif, texte } of sourcesDuClient()) {
    if (relatif in EXCEPTIONS) continue;
    for (const [nom, motif] of MOTIFS_BRUTS) for (const brute of occurrences(texte, motif)) relevees.push([relatif, nom, brute]);
  }
  assert.deepEqual(relevees, ECRITURES_NUES_GARDEES);
});

// T1 du contrôle de cohérence (N6 de #499) : l'exception nommée ne reste que tant qu'elle sert. La fiche chantier
// (ChantierIndicateurs.tsx, #388) garde au moins un toLocaleString() sans locale ou un pourcentage au point décimal ;
// sinon, le test demande de la retirer.
test('#499 v2 : l’exception nommée (ChantierIndicateurs.tsx, #388) reste nécessaire, sinon elle est à retirer d’EXCEPTIONS', () => {
  assert.deepEqual(Object.keys(EXCEPTIONS), ['components/ChantierIndicateurs.tsx']);
  for (const fichier of Object.keys(EXCEPTIONS)) {
    const texte = source(fichier);
    const defauts = appelsSansLocale(texte, fichier).length + occurrences(texte, TO_FIXED_POURCENT).length;
    assert.ok(defauts > 0, `${fichier} : plus aucun toLocaleString() sans locale ni toFixed(…)}% ; l’exception (${EXCEPTIONS[fichier]}) n’est plus nécessaire, la retirer d’EXCEPTIONS`);
  }
  // fmtPourcentage est un nom du module, et non une famille de montant.
  assert.ok(NOMS_DU_MODULE.includes('fmtPourcentage'));
  assert.ok(!Object.hasOwn(FAMILLES_MONTANT, 'fmtPourcentage'));
  assert.match(source('lib/formats.ts'), /export const fmtPourcentage = \(valeur: number, decimalesMax: 0 \| 1 \| 2\) =>/);
});
