// Formats d'affichage communs à tous les écrans (#205) : montants, heures et jours, toujours en
// français (`fr-FR`), quelle que soit la langue du navigateur. Un écran n'écrit plus son propre
// format : il emploie l'une de ces familles, qui gardent chacune leur texte d'avant #205.
import { formatDateOnly, jourFrancais } from './dateFormatting';
import { arrondiCentime, arrondiEuro } from './montants';

// Montant à l'euro près, moitié vers l'extérieur (#198), suivi d'une espace et de « € » :
// « 1 234 € », « -13 € » ; jamais « -0 € ».
export const fmtEuro = (montant: number) => `${arrondiEuro(montant).toLocaleString('fr-FR')} €`;

// Montant au centime, au format monétaire français, arrondi comme `fmtEuro` (#198) :
// « 1 234,50 € », avec l'espace insécable d'`Intl` avant « € » ; jamais « -0,00 € ».
export const fmtEuroCentime = (montant: number) => arrondiCentime(montant).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

// Forme des documents : le texte des PDF, identique à `formatMontantFacture` du serveur
// (server/src/domaines/factures/metier.ts), deux décimales et une espace ordinaire avant « € » :
// « 45,50 € », « 1 234,50 € ». La mention du devis au temps passé doit rester le texte du PDF.
export const fmtMontantDocument = (montant: number) => `${Number(montant).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

// Nombre d'heures, sans décimale inutile : deux décimales au plus (« 18,75 », « 8 », « 7,5 »),
// ou trois pour le temps passé, compté au millième d'heure.
export const fmtNombreHeures = (heures: number, decimalesMax: 2 | 3 = 2) => Number(heures).toLocaleString('fr-FR', { maximumFractionDigits: decimalesMax });

// Le même nombre suivi de « h » : « 18,75 h », « 8 h ».
export const fmtHeures = (heures: number, decimalesMax: 2 | 3 = 2) => `${fmtNombreHeures(heures, decimalesMax)} h`;

// Solde d'heures (vendues moins réalisées) arrondi au centième, moitié vers l'extérieur, comme les montants : un écart
// qui s'arrondit à zéro vaut 0, jamais -0. Le signe et la couleur se lisent sur cette valeur, celle qu'on affiche
// (lot V, #212) ; « +1,25 h », « -0,5 h », et « 0 h » sans signe, jamais « +0 h » ni « -0 h ».
export const soldeHeuresArrondi = (valeur: number) => arrondiCentime(valeur);
export const fmtSoldeHeures = (valeur: number) => {
  const solde = soldeHeuresArrondi(valeur);
  return `${solde > 0 ? '+' : ''}${fmtHeures(solde)}`;
};

// Pourcentage exprimé en pour cent (12.5 → « 12,5 % »), en français, avec au plus `decimalesMax` décimales, sans zéro
// inutile, et une espace ordinaire avant « % », comme les pourcentages déjà affichés en français (#499) ; jamais
// « -0 % ». Chaque usage déclare ses décimales : marges et taux de dépassement 1, avancements et objectifs 0, taux de
// TVA 2 (choix par défaut, à confirmer). Un négatif arrondi à zéro perd son signe dans le texte d'Intl, et non par
// `signDisplay: 'negative'`, que des navigateurs de la cible par défaut de Vite (Firefox 114 et 115) refusent par une
// RangeError (#655, N2 de l'audit des montants).
export const fmtPourcentage = (valeur: number, decimalesMax: 0 | 1 | 2) => {
  const texte = Number(valeur).toLocaleString('fr-FR', { maximumFractionDigits: decimalesMax });
  return `${/^[-\u2212]0$/.test(texte) ? '0' : texte} %`;
};

// Jour AAAA-MM-JJ (avec ou sans heure) au format JJ-MM-AAAA ; rien pour un jour absent.
export const toDateFrancaise = (jour: string | null | undefined) => (jour ? jourFrancais(jour) : '');

export const fmtDate = (d: string) => formatDateOnly(d);
