// Catalogue dans les devis (lot pilote 2, décision A8 du 16-10-2026) : une fiche du catalogue
// devient une ligne COPIÉE du devis. Le serveur recopie la référence et, pour qui n'écrit pas
// le prix d'achat prévu, celui de la fiche ; l'écran pré-remplit le reste, modifiable tant que
// le devis n'est pas signé.
import { fmtHeures } from './formats';
import { valeurSaisie } from './mainOeuvre';

export type NatureLigneDevis = 'MAIN_OEUVRE' | 'FOURNITURE';
export type FamilleCatalogue = 'prestations' | 'articles' | 'equipements';

export type FicheCatalogueDevis = {
  famille: FamilleCatalogue;
  id: string;
  reference: string;
  nom: string;
  unite: string | null;
  nature: NatureLigneDevis;
  prixVenteHt: number;
  tauxTva: number;
  // Présent seulement pour qui voit le prix d'achat prévu (administration et assistante technique, cf.
  // voitPrixAchatDevis).
  prixAchatHt?: number | null;
  // Main d'œuvre : son drapeau et son prix à l'heure sous contrat (devis au temps passé), ses forfaits jour
  // et ses prix de la demi-journée, vides si non réglés (ligne au jour ou à la demi-journée) ; jamais ses
  // heures par jour.
  estMainOeuvre?: true;
  prixHeureSousContratHt?: number;
  prixJourHorsContratHt?: number;
  prixJourSousContratHt?: number;
  prixDemiJourneeHorsContratHt?: number | null;
  prixDemiJourneeSousContratHt?: number | null;
};

// Champ chiffré d'une ligne saisie. La quantité, le PU HT et la TVA d'une ligne ordinaire, et les heures d'une
// ligne au temps passé, sont saisis en texte (#394, pour le devis) : la chaîne tapée (« 18,75 », « 1.5 ») est
// gardée telle quelle et envoyée brute, le serveur lisant la virgule (nombreDecimalNonNegatif). La quantité d'une
// ligne au forfait aussi, depuis le lot U (#394) : nombre à l'ajout et à la remise en édition, elle reste la chaîne
// tapée ensuite (Devis.tsx, updateLine). Le prix et la TVA des lignes au temps passé et au forfait, fixés par la
// main d'œuvre, restent des nombres.
export type ChiffreSaisi = number | string;

export type LigneDevisSaisie = {
  ligneId?: string;
  designation: string;
  nature: NatureLigneDevis;
  quantite: ChiffreSaisi;
  prixUnitaireHt: ChiffreSaisi;
  tauxTva: ChiffreSaisi;
  unite?: string | null;
  reference?: string | null;
  catalogueFamille?: FamilleCatalogue | null;
  catalogueId?: string | null;
  // Saisie libre de qui écrit le prix d'achat prévu (« 12,50 ») ; vide = pas de prix d'achat prévu.
  prixAchatUnitaireHt?: string;
  // Ligne « main d'œuvre au temps passé » d'un devis au temps passé : son tarif (cf. ./tempsPasse.ts).
  tempsPasse?: boolean;
  tarifTempsPasse?: 'HORS_CONTRAT' | 'SOUS_CONTRAT' | null;
  // Ligne de main d'œuvre au jour ou à la demi-journée : son forfait et son tarif (cf. ./forfaitMainOeuvre.ts).
  forfaitMainOeuvre?: 'JOUR' | 'DEMI_JOURNEE' | null;
  tarifForfait?: 'HORS_CONTRAT' | 'SOUS_CONTRAT' | null;
};

// Total des heures prévues d'un devis (lot « budget et heures prévues du chantier ») : calculé par le
// serveur, affiché à l'écran du devis seulement, jamais sur le PDF (réponse « Écran seulement »).
export const formatHeuresPrevues = (heures: number) => fmtHeures(heures);

export const LIBELLES_FAMILLES: Record<FamilleCatalogue, string> = {
  prestations: 'Prestation',
  articles: 'Article',
  equipements: 'Équipement',
};

// Nombre d'un champ chiffré saisi, lu à la virgule comme au point (« 1,25 », « 1.25 ») ; NaN s'il n'en est
// pas un, et 0 pour un champ vide, comme Number().
export const nombreSaisi = (valeur: ChiffreSaisi): number => (typeof valeur === 'number' ? valeur : Number(String(valeur).trim().replace(',', '.')));

// Motifs (`pattern`) des champs chiffrés d'une ligne ordinaire, aux bornes du serveur (nombreDecimalNonNegatif :
// quantité au millième, strictement positive, 9 chiffres avant la virgule ; PU HT au centime, zéro admis,
// 10 chiffres ; TVA au centième, 3 chiffres). Les champs sont en texte, `inputMode="decimal"`, et non
// `type="number"`, qu'un navigateur réglé dans une autre langue lit autrement (« 18,75 » y devenait 1875,
// #394) : le navigateur refuse avant l'envoi une saisie hors forme (« 0 » pour la quantité, comme l'ancien
// `min="0.001"`), et le serveur seul les taux de TVA autres que 0, 5,5, 10 et 20 %. Le navigateur compile un
// motif en `^(?:motif)$` avec le drapeau `v`, et ignore en silence un motif invalide : seule la classe `[.,]`,
// sans caractère réservé, y figure.
export const MOTIF_QUANTITE_DEVIS = String.raw`(?!0+(?:[.,]0+)?$)\d{1,9}(?:[.,]\d{1,3})?`;
export const MOTIF_PRIX_DEVIS = String.raw`\d{1,10}(?:[.,]\d{1,2})?`;
export const MOTIF_TVA_DEVIS = String.raw`\d{1,3}(?:[.,]\d{1,2})?`;
export const TITRE_QUANTITE_DEVIS = 'Quantité supérieure à zéro, trois décimales au plus (par exemple 1,5)';
export const TITRE_PRIX_DEVIS = 'Montant positif ou nul, deux décimales au plus (par exemple 1 250,50 s’écrit 1250,50)';
export const TITRE_TVA_DEVIS = 'Taux de TVA en pourcentage, deux décimales au plus : 0 %, 5,5 %, 10 % ou 20 %';

export function ligneDepuisCatalogue(fiche: FicheCatalogueDevis, voitPrixAchat: boolean): LigneDevisSaisie {
  return {
    designation: fiche.nom,
    nature: fiche.nature,
    // Champs saisis en texte, pré-remplis à la virgule (« 2,5 », « 5,5 ») : seule l'écriture change.
    quantite: '1',
    prixUnitaireHt: valeurSaisie(fiche.prixVenteHt),
    tauxTva: valeurSaisie(fiche.tauxTva),
    unite: fiche.unite,
    reference: fiche.reference,
    catalogueFamille: fiche.famille,
    catalogueId: fiche.id,
    ...(voitPrixAchat ? { prixAchatUnitaireHt: valeurSaisie(fiche.prixAchatHt) } : {}),
  };
}

// Une ligne encore vierge (désignation vide, prix nul : « 0 », « 0,00 », « 0.00 », ou vide) : remplacée
// plutôt que suivie par la première fiche ajoutée.
export function ligneVierge(ligne: LigneDevisSaisie): boolean {
  return !ligne.designation.trim() && !ligne.ligneId && !ligne.catalogueId && nombreSaisi(ligne.prixUnitaireHt) === 0;
}

// Corps envoyé à l'API. Le prix d'achat prévu n'est transmis que par qui l'écrit, et seulement
// si la ligne le porte (champ affiché) : sinon, le serveur conserve celui de la ligne existante
// (ou reprend celui de la fiche), et refuserait toute valeur reçue d'un autre compte. Une ligne
// chargée sans ce champ (droits relus en cours d'édition) ne l'efface donc pas. La référence
// n'est jamais envoyée : le serveur la recopie de la fiche.
export function ligneAEnvoyer(ligne: LigneDevisSaisie, ecritPrixAchat: boolean) {
  const prixAchat = (ligne.prixAchatUnitaireHt ?? '').trim();
  // Ligne au temps passé : le serveur fixe son prix, sa TVA, son unité et sa nature depuis la main
  // d'œuvre ; l'écran envoie le prix et la TVA qu'il affiche, que le serveur refuse s'ils ne sont plus
  // les siens. Jamais de prix d'achat prévu.
  if (ligne.tempsPasse) {
    return {
      ...(ligne.ligneId ? { ligneId: ligne.ligneId } : {}),
      tempsPasse: true,
      designation: ligne.designation,
      quantite: ligne.quantite,
      prixUnitaireHt: ligne.prixUnitaireHt,
      tauxTva: ligne.tauxTva,
      tarifTempsPasse: ligne.tarifTempsPasse ?? null,
      ...(ligne.catalogueId ? { catalogueFamille: 'prestations' as const, catalogueId: ligne.catalogueId } : {}),
    };
  }
  // Ligne au jour ou à la demi-journée : de même, le serveur fixe son prix, sa TVA, son unité et sa nature
  // depuis la main d'œuvre et refuse un prix ou une TVA qui ne sont plus les siens. Jamais de prix d'achat
  // prévu ; une ligne existante envoie son forfait et son tarif, qui ne changent pas.
  if (ligne.forfaitMainOeuvre) {
    return {
      ...(ligne.ligneId ? { ligneId: ligne.ligneId } : {}),
      forfaitMainOeuvre: ligne.forfaitMainOeuvre,
      tarifForfait: ligne.tarifForfait ?? null,
      designation: ligne.designation,
      nature: 'MAIN_OEUVRE' as const,
      quantite: ligne.quantite,
      prixUnitaireHt: ligne.prixUnitaireHt,
      tauxTva: ligne.tauxTva,
      ...(ligne.catalogueId ? { catalogueFamille: 'prestations' as const, catalogueId: ligne.catalogueId } : {}),
    };
  }
  return {
    ...(ligne.ligneId ? { ligneId: ligne.ligneId } : {}),
    designation: ligne.designation,
    nature: ligne.nature,
    quantite: ligne.quantite,
    prixUnitaireHt: ligne.prixUnitaireHt,
    tauxTva: ligne.tauxTva,
    unite: ligne.unite?.trim() ? ligne.unite.trim() : null,
    ...(ligne.catalogueFamille && ligne.catalogueId ? { catalogueFamille: ligne.catalogueFamille, catalogueId: ligne.catalogueId } : {}),
    ...(ecritPrixAchat && ligne.prixAchatUnitaireHt !== undefined ? { prixAchatUnitaireHt: prixAchat === '' ? null : prixAchat } : {}),
  };
}

// Ligne existante d'un devis remise en édition : son identifiant permet au serveur de garder
// sa fiche d'origine, sa référence et son prix d'achat prévu. Les champs saisis en texte (quantité, PU HT
// et TVA d'une ligne ordinaire, heures d'une ligne au temps passé) sont pré-remplis à la virgule ; le prix et
// la TVA des lignes au temps passé et au forfait, non modifiables, restent des nombres.
export function ligneEnEdition(ligne: {
  id: string; designation: string; nature: NatureLigneDevis; quantite: number; prixUnitaireHt: number; tauxTva: number;
  unite?: string | null; reference?: string | null; catalogueFamille?: FamilleCatalogue | null; catalogueId?: string | null; prixAchatUnitaireHt?: number | null;
  tempsPasse?: boolean; tarifTempsPasse?: 'HORS_CONTRAT' | 'SOUS_CONTRAT' | null;
  forfaitMainOeuvre?: 'JOUR' | 'DEMI_JOURNEE' | null; tarifForfait?: 'HORS_CONTRAT' | 'SOUS_CONTRAT' | null;
}, voitPrixAchat: boolean): LigneDevisSaisie {
  if (ligne.tempsPasse) {
    return {
      ligneId: ligne.id, tempsPasse: true, tarifTempsPasse: ligne.tarifTempsPasse ?? null,
      designation: ligne.designation, nature: ligne.nature, quantite: valeurSaisie(ligne.quantite), prixUnitaireHt: ligne.prixUnitaireHt, tauxTva: ligne.tauxTva,
      unite: ligne.unite ?? null, reference: ligne.reference ?? null, catalogueFamille: ligne.catalogueFamille ?? null, catalogueId: ligne.catalogueId ?? null,
    };
  }
  // Ligne au jour ou à la demi-journée : jamais de prix d'achat prévu, même pour qui le lit ailleurs.
  if (ligne.forfaitMainOeuvre) {
    return {
      ligneId: ligne.id, forfaitMainOeuvre: ligne.forfaitMainOeuvre, tarifForfait: ligne.tarifForfait ?? null,
      designation: ligne.designation, nature: ligne.nature, quantite: ligne.quantite, prixUnitaireHt: ligne.prixUnitaireHt, tauxTva: ligne.tauxTva,
      unite: ligne.unite ?? null, reference: ligne.reference ?? null, catalogueFamille: ligne.catalogueFamille ?? null, catalogueId: ligne.catalogueId ?? null,
    };
  }
  return {
    ligneId: ligne.id,
    designation: ligne.designation,
    nature: ligne.nature,
    quantite: valeurSaisie(ligne.quantite),
    prixUnitaireHt: valeurSaisie(ligne.prixUnitaireHt),
    tauxTva: valeurSaisie(ligne.tauxTva),
    unite: ligne.unite ?? null,
    reference: ligne.reference ?? null,
    catalogueFamille: ligne.catalogueFamille ?? null,
    catalogueId: ligne.catalogueId ?? null,
    ...(voitPrixAchat ? { prixAchatUnitaireHt: valeurSaisie(ligne.prixAchatUnitaireHt) } : {}),
  };
}
