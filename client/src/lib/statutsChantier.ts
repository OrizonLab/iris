// Libellés des statuts d'un chantier, partagés par la fiche et Administration > Chantiers (lot V, #390, #392) : un écran
// n'affiche jamais le code brut (« EN_COURS », « ANNULE »). Un code inconnu est rendu tel quel, plutôt que masqué.
export const LIBELLES_STATUT_CHANTIER: Record<string, string> = { EN_COURS: 'En cours', TERMINE: 'Terminé', ANNULE: 'Annulé' };

// `Object.hasOwn` : une clé héritée (« toString », « constructor ») n'est pas un libellé, et le code est rendu tel quel.
export const libelleStatutChantier = (statut: string) => (Object.hasOwn(LIBELLES_STATUT_CHANTIER, statut) ? LIBELLES_STATUT_CHANTIER[statut] : statut);
