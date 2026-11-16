// Libellés du journal des paramètres et des droits (JournalAdministration.tsx), sortis du composant pour
// être testés sous tsx --test (lot 6b-2, N3) : pas d'import de roles.ts, qui charge api.ts et
// import.meta.env, mais de lib/droits.ts, où roleLabel est défini (V-N6).
import { roleLabel } from './droits';
import { LIBELLES_MODE_ENVOI } from './envoiMicrosoft365';

// Libellés des actions journalisées ; une action absente de la liste garde son code. Sorties du composant avec
// les deux actions de la connexion Microsoft (#264), écrites au nom du compte lui-même.
export const ACTIONS_JOURNAL: Record<string, string> = {
  CREATION: 'Création',
  SUPPRESSION: 'Suppression',
  MODIFICATION: 'Modification',
  TYPE_COMPTE: 'Type de compte',
  RATTACHEMENT: 'Rattachement hiérarchique',
  AUSSI_COMMERCIAL: '« Aussi commercial »',
  PERMISSIONS: 'Permissions',
  ACCES_FINANCE: 'Accès financier',
  ACTIVATION: 'Activation',
  DESACTIVATION: 'Désactivation',
  REVOCATION: 'Révocation',
  PUBLICATION: 'Publication',
  NOUVEAU_LIEN: 'Nouveau lien',
  FICHE_INTERVENANT: 'Fiche intervenant',
  LOGO_DOCUMENTS: 'Logo des documents',
  LOGO_DOCUMENTS_RETIRE: 'Logo des documents retiré',
  REACTIVATION: 'Réactivation',
  PASSAGE_MAIN_OEUVRE: 'Prestation passée en main d’œuvre',
  RETRAIT_MAIN_OEUVRE: 'Main d’œuvre redevenue prestation',
  RATTACHEMENT_MAIN_OEUVRE: 'Main d’œuvre rattachée',
  // Première connexion Microsoft d'un compte : ses identifiants immuables lui sont liés (ils ne sont pas journalisés).
  LIAISON_MICROSOFT: 'Liaison Microsoft enregistrée',
  // Connexion d'un compte lié sous une autre adresse que la sienne : avant, l'adresse du compte Iris, qui ne
  // change pas ; après, celle que Microsoft a renvoyée.
  ADRESSE_MICROSOFT_CHANGEE: 'Changement d’adresse Microsoft détecté',
};

// Libellés des champs journalisés ; un champ absent de la liste garde son nom technique.
export const CHAMPS_JOURNAL: Record<string, string> = {
  role: 'Type de compte',
  estCommercial: 'Aussi commercial',
  accesFinance: 'Accès financier',
  permissions: 'Permissions',
  actif: 'Actif',
  responsableHierarchique: 'Responsable hiérarchique',
  ficheIntervenant: 'Fiche intervenant',
  // Changement d'adresse Microsoft détecté (#264).
  email: 'Adresse e-mail',
  margeCommercialeActive: 'Marge commerciale',
  tauxAcompteDefaut: 'Acompte par défaut (%)',
  seuilMargeFaible: 'Seuil de marge faible (%)',
  joursSansSaisie: 'Jours sans saisie',
  anticipationVisitesJours: 'Anticipation des visites (jours)',
  pasTempsPasseMinutes: 'Pas du temps passé (minutes)',
  tempsMinimumMinutes: 'Temps minimum facturé (minutes)',
  rentabiliteConducteur: 'Rentabilité : conducteur',
  rentabiliteHierarchie: 'Rentabilité : hiérarchie',
  rentabiliteDirecteurs: 'Rentabilité : directeurs',
  rentabiliteAssistantesTechniques: 'Rentabilité : assistantes techniques',
  planningActif: 'Planning',
  // Mode d'envoi des documents (lot 6b-1b, C-N1 de #411).
  modeEnvoi: 'Mode d’envoi des documents',
  suiviAdministratif: 'Prime de suivi administratif',
  journalConservationJours: 'Conservation (jours)',
  logoDocuments: 'Logo des documents',
  estMainOeuvre: 'Main d’œuvre',
  reference: 'Référence',
  nom: 'Nom',
  description: 'Description',
  categorie: 'Catégorie',
  tauxTva: 'TVA (%)',
  prixVenteHt: 'Prix de vente HT à l’heure, hors contrat',
  prixJourHorsContratHt: 'Prix de vente HT au forfait jour, hors contrat',
  prixHeureSousContratHt: 'Prix de vente HT à l’heure, sous contrat',
  prixJourSousContratHt: 'Prix de vente HT au forfait jour, sous contrat',
  prixDemiJourneeHorsContratHt: 'Prix de vente HT à la demi-journée, hors contrat',
  prixDemiJourneeSousContratHt: 'Prix de vente HT à la demi-journée, sous contrat',
  heuresParJour: 'Heures par jour',
  unite: 'Unité',
  prixAchatHt: 'Prix d’achat HT',
  dureeIndicativeMin: 'Durée indicative (min)',
  mainOeuvre: 'Main d’œuvre',
};

// Valeur lisible d'un champ journalisé. Le type de compte et le mode d'envoi s'affichent par leur
// libellé (« Microsoft 365 », « Messagerie seule »), et non par leur code ; un code inconnu reste tel quel,
// et un type de compte vide s'affiche « — » comme toute valeur vide (#206, choix par défaut, à confirmer).
export function lisible(valeur: unknown, champ?: string): string {
  if (champ === 'role' && typeof valeur === 'string' && valeur !== '') return roleLabel(valeur) || valeur;
  if (valeur === null || valeur === undefined || valeur === '') return '—';
  if (champ === 'modeEnvoi' && typeof valeur === 'string') return Object.hasOwn(LIBELLES_MODE_ENVOI, valeur) ? LIBELLES_MODE_ENVOI[valeur] : valeur;
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non';
  if (Array.isArray(valeur)) return valeur.length ? valeur.map((v) => lisible(v)).join(', ') : 'aucune';
  if (typeof valeur === 'object') return JSON.stringify(valeur);
  return String(valeur);
}
