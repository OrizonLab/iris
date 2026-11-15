import { fmtHeures } from './formats';

/**
 * Marge d'un contrat de maintenance (lot « marge d'un contrat », décisions de Nelson du 27-10-2026 et du
 * 15-11-2026), telle que GET /api/contrats-maintenance/:id/marge l'envoie, à l'administration seule : les heures
 * de toutes les interventions du contrat (visites et suites), depuis son début, vendues au prix à l'heure sous
 * contrat de la main d'œuvre de chaque intervenant, figé à la saisie, moins leur coût et le matériel inclus au
 * contrat selon la couverture figée sur chaque visite ; le matériel hors forfait est montré à part, hors marge.
 */
export type MargeContrat = {
  ventesHT: number; coutsHT: number; materielHT: number; materielExcluHT: number; margeHT: number;
  heuresValorisees: number; heuresNonValorisees: number; intervenantsNonValorises: string[]; heuresAnnulees: number;
  contratAnnule: boolean; nombreInterventions: number; nombreInterventionsAnnulees: number;
};

/** Détail de la marge du contrat, en une phrase ; les montants passent par le format de l'écran. */
export function detailMargeContrat(marge: MargeContrat, montant: (valeur: number) => string): string {
  if (marge.nombreInterventions === 0) return 'Aucune intervention sur ce contrat pour l’instant.';
  // Les interventions annulées sont comptées et nommées : leurs heures gardent leur coût sans être vendues.
  const annulees = marge.nombreInterventionsAnnulees;
  const portee = marge.nombreInterventions === 1
    ? `de l’intervention du contrat${annulees === 1 ? ' (annulée)' : ''}`
    : `des ${marge.nombreInterventions} interventions du contrat${annulees > 0 ? ` (dont ${annulees} annulée${annulees > 1 ? 's' : ''})` : ''}`;
  const materiel = marge.materielHT > 0 ? ` et le matériel inclus au contrat, à son coût de ${montant(marge.materielHT)} HT` : '';
  const exclu = marge.materielExcluHT > 0 ? ` Matériel hors forfait, hors marge : ${montant(marge.materielExcluHT)} HT.` : '';
  return `Heures ${portee}, depuis son début, vendues ${montant(marge.ventesHT)} HT au prix sous contrat des mains d’œuvre, moins leur coût de ${montant(marge.coutsHT)} HT${materiel}.${exclu}`;
}

/** Signalements de la marge du contrat : contrat annulé, heures sans prix de vente, heures des interventions annulées. */
export function alertesMargeContrat(marge: MargeContrat): string[] {
  if (marge.contratAnnule) return ['Contrat annulé : ses heures ne sont pas vendues ; leur coût reste compté.'];
  const alertes: string[] = [];
  if (marge.intervenantsNonValorises.length > 0) alertes.push(`Marge incomplète : ${fmtHeures(marge.heuresNonValorisees)} sans prix de vente (${marge.intervenantsNonValorises.join(', ')}). Une heure d’un intervenant sans main d’œuvre le jour de la saisie, ou saisie avant la valorisation sous contrat, n’est pas vendue ; son coût reste compté.`);
  if (marge.heuresAnnulees > 0) alertes.push(`Les heures des interventions annulées (${fmtHeures(marge.heuresAnnulees)}) comptent dans le coût, sans être vendues.`);
  return alertes;
}
