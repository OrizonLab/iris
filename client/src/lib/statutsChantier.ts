// Libellés des statuts d'un chantier, partagés par la fiche et Administration > Chantiers (lot V, #390, #392) : un écran
// n'affiche jamais le code brut (« EN_COURS », « ANNULE »). Un code inconnu est rendu tel quel, plutôt que masqué.
export const LIBELLES_STATUT_CHANTIER: Record<string, string> = { EN_COURS: 'En cours', TERMINE: 'Terminé', ANNULE: 'Annulé' };

export const libelleStatutChantier = (statut: string) => LIBELLES_STATUT_CHANTIER[statut] ?? statut;
