// Réglage de la société à 0 % : aucun acompte n'est exigé (décision de Nelson du 17-11-2026), et le
// serveur enregistre sans acompte un devis dont la case « Exiger un acompte » était cochée. L'écran le
// dit après l'enregistrement et après la duplication, dans une information distincte de l'alerte
// d'erreur (choix par défaut d'affichage, à confirmer). L'écran ne lit pas le taux par défaut : seule la
// réponse du serveur, comparée à la demande, révèle ce cas.
export const INFORMATION_SANS_ACOMPTE = 'Devis enregistré sans acompte : le taux d’acompte par défaut de la société est de 0 %.';

// Information à afficher : un acompte était demandé (case cochée, ou devis dupliqué qui en exigeait un)
// et le devis enregistré n'en exige pas. Chaîne vide sinon.
export function informationAcompte(acompteDemande: boolean, enregistre: { acompteExige?: unknown } | null | undefined): string {
  return acompteDemande && enregistre?.acompteExige === false ? INFORMATION_SANS_ACOMPTE : '';
}
