// Libellés affichés du statut stocké d'une pièce (facture ou avoir) et de son origine : l'écran n'affiche jamais le
// code (correctif R1 du passage hebdomadaire du 14-11-2026, #540). Un avoir est « émis » (masculin), une facture
// « émise ». Côté serveur, seule une pièce de type FACTURE devient REGLEE ou ANNULEE ; un avoir naît EMISE.
// Un code inconnu reste affiché tel quel, pour ne rien masquer. Libellés : choix d'affichage par défaut, à confirmer.

const STATUTS_FACTURE: Readonly<Record<string, string>> = { BROUILLON: 'Brouillon', EMISE: 'Émise', REGLEE: 'Réglée', ANNULEE: 'Annulée' };
const STATUTS_AVOIR: Readonly<Record<string, string>> = { BROUILLON: 'Brouillon', EMISE: 'Émis' };

export function libelleStatutPiece(type: string, statut: string): string {
  const libelles = type === 'AVOIR' ? STATUTS_AVOIR : STATUTS_FACTURE;
  return Object.hasOwn(libelles, statut) ? libelles[statut] : statut;
}

// Même désignation que le panneau « Origine de la facture » de l'écran Factures.
const ORIGINES_FACTURE: Readonly<Record<string, string>> = { CHANTIER: 'Affaire', INTERVENTION: 'Intervention SAV', CONTRAT: 'Contrat de maintenance', HORS_AFFAIRE: 'Hors affaire' };

export function libelleOrigineFacture(origine: string): string {
  return Object.hasOwn(ORIGINES_FACTURE, origine) ? ORIGINES_FACTURE[origine] : origine;
}
