import { valeurSaisie } from './mainOeuvre';

// Motifs (`pattern`) des champs décimaux saisis en texte, `inputMode="decimal"`, et non `type="number"`, qu'un
// navigateur réglé dans une autre langue lit autrement (« 18,75 » y devient 1875, « 5,5 » devient 55, sans aucun
// refus ; #394). Le navigateur refuse avant l'envoi une saisie hors forme, avec le titre du champ pour message ; le
// serveur lit la virgule (nombreDecimalNonNegatif) et refuse le reste. Le navigateur compile un motif en `^(?:motif)$`
// avec le drapeau `v`, et ignore en silence un motif invalide : seule la classe `[.,]`, sans caractère réservé, y
// figure. Les montants positifs ou nuls et les taux de TVA reprennent les motifs du devis (catalogueDevis.ts).

// Heures saisies au quart d'heure, aux bornes du serveur (heuresAuQuartDHeure, commun/validation.ts) : huit chiffres
// avant la virgule, décimales 0, 00, 25, 5, 50 ou 75. Règle qui touche un montant, gardée dans le code (règle
// permanente 1 ; choix par défaut, à confirmer). Le motif du devis au temps passé (MOTIF_HEURES_QUART_HEURE,
// lib/tempsPasse.ts) n'est pas réutilisable : il admet neuf chiffres et trois décimales.
// - Heures d'un chantier, à partir de 0,25 h (décision de Nelson du 22-11-2026, soir : « 1. Quart d'heure » ; lot W).
export const MOTIF_QUART_HEURE_CHANTIER = String.raw`(?!0+(?:[.,]0+)?$)\d{1,8}(?:[.,](?:00?|25|50?|75))?`;
export const TITRE_QUART_HEURE_CHANTIER = 'Un nombre d’heures au quart d’heure, à partir de 0,25 (par exemple 3,25)';
// - Heures d'une intervention, zéro compris (réponse de Nelson du 23-11-2026 : « les heures sur une intervention Passe
//   au quart d'heure » ; lot Z) : zéro heure reste admis avec un motif, que l'écran exige avant l'envoi. Le titre
//   n'indique aucun sens d'arrondi : le technicien saisit ce qu'il veut (réponse de Nelson du 24-11-2026).
export const MOTIF_QUART_HEURE_INTERVENTION = String.raw`\d{1,8}(?:[.,](?:00?|25|50?|75))?`;
export const TITRE_QUART_HEURE_INTERVENTION = 'Un nombre d’heures au quart d’heure (par exemple 1,25), ou 0 avec un motif';

// Taux en pourcentage de 0 à 100, deux décimales au plus (taux d'acompte par défaut, seuil de marge faible, taux
// d'une tranche de barème), aux bornes du serveur : trois chiffres au plus, un zéro de tête admis (« 050 »).
export const MOTIF_POURCENTAGE = String.raw`100(?:[.,]0{1,2})?|0?\d{1,2}(?:[.,]\d{1,2})?`;
export const TITRE_POURCENTAGE = 'Taux de 0 à 100 %, deux décimales au plus (par exemple 5,5)';

// Plafond d'une tranche de barème : un montant strictement positif, au centime, dix chiffres avant la virgule ; vide
// pour la dernière tranche, sans plafond.
export const MOTIF_PLAFOND = String.raw`(?!0+(?:[.,]0+)?$)\d{1,10}(?:[.,]\d{1,2})?`;
export const TITRE_PLAFOND = 'Montant supérieur à zéro, deux décimales au plus (par exemple 1500,50), ou vide pour la dernière tranche';

// Stock d'un article : positif ou nul, au millième, neuf chiffres avant la virgule (colonne Decimal(12, 3)).
export const MOTIF_STOCK = String.raw`\d{1,9}(?:[.,]\d{1,3})?`;
export const TITRE_STOCK = 'Quantité positive ou nulle, trois décimales au plus (par exemple 1,5)';

// Nombre entier d'au moins 1 (jours ou demi-journées d'une ligne au forfait) : en `type="number"`, « 1,5 » y devenait 15
// dans un navigateur réglé en anglais, un entier valide (#394, C3 du contrôle de cohérence).
export const MOTIF_ENTIER_POSITIF = String.raw`[1-9]\d{0,8}`;
export const TITRE_ENTIER_POSITIF = 'Un nombre entier supérieur ou égal à 1';

// Valeur affichée d'un champ décimal contrôlé : un nombre reçu du serveur s'écrit à la virgule ; une saisie en cours
// (texte) reste telle que l'utilisateur l'écrit.
export const affichageSaisie = (valeur: number | string | null | undefined) => (typeof valeur === 'number' ? valeurSaisie(valeur) : valeur ?? '');
