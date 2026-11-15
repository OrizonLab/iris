import { Prisma } from '@prisma/client';
import { transactionVerifiee } from '../../db';
import { totalHeuresInterventionAuCentime } from '../interventions/metier';
import { auCentime, ventesHeuresAuCentime } from '../interventions/margeSav';

// --- Marge d'un contrat de maintenance (lot « marge d'un contrat ») ---
// Décisions de Nelson du 27-10-2026 à 10:27 UTC (« Oui prix du catalogue, continue » : la marge d'une visite de
// contrat et de ses suites utilise le prix sous contrat) et du 15-11-2026 :
// - le prix est celui de la main d'œuvre rattachée à l'intervenant (« Celle de l'intervenant »), à l'heure sous
//   contrat, figé sur l'heure à sa saisie (« Figé à la saisie » ; cf. prixVenteHoraireAFiger, margeSav.ts) ;
// - la marge se lit par contrat (« Par contrat ») : toutes ses interventions, visites, suites et suites de suites,
//   depuis le début du contrat (« Depuis le début (Recommandé) ») ; une visite n'a pas de marge propre ;
// - les heures sont vendues que la main d'œuvre soit incluse ou hors forfait (« Oui, valoriser (Recommandé) ») ;
// - le matériel suit la politique figée sur chaque intervention à sa création (« Selon la politique », « Figée sur
//   la visite (Recommandé) ») : inclus, compté à son coût ; hors forfait, exclu de la marge ;
// - les heures d'une intervention annulée (« Coût seul (Recommandé) ») et toutes celles d'un contrat annulé
//   (« Coût seul, non vendues (Recommandé) ») gardent leur coût sans être vendues ; un contrat suspendu ou terminé
//   vend ses heures normalement ;
// - une heure sans prix figé (intervenant sans main d'œuvre le jour de la saisie, ou heure saisie avant ce lot)
//   garde son coût, n'est pas vendue et rend la marge incomplète (« Coût gardé, signalée (Recommandé) »).
// Lectures retenues et choix par défaut de montant, à confirmer par Nelson (validation comptable) :
// - arrondi au centime ligne par ligne, ventes et coûts, comme la marge à l'heure d'un SAV hors contrat (la
//   convention commune reste une question ouverte de la passation, section 3) ;
// - le matériel inclus d'une intervention annulée, ou d'un contrat annulé, compte à son coût, comme leurs heures ;
// - une intervention sans instantané de couverture (aucun chemin de l'API n'en crée ; données antérieures à la
//   migration 20260925100000 seulement) suit la politique matériel actuelle du contrat.
// coutsHT est le coût des heures ; materielHT celui du matériel inclus ; materielExcluHT, montré à part, celui du
// matériel hors forfait ; margeHT, les ventes moins coutsHT et materielHT.
export type MargeContrat = {
  ventesHT: Prisma.Decimal;
  coutsHT: Prisma.Decimal;
  materielHT: Prisma.Decimal;
  materielExcluHT: Prisma.Decimal;
  margeHT: Prisma.Decimal;
  heuresValorisees: Prisma.Decimal;
  heuresNonValorisees: Prisma.Decimal;
  intervenantsNonValorises: string[];
  heuresAnnulees: Prisma.Decimal;
  contratAnnule: boolean;
  nombreInterventions: number;
  nombreInterventionsAnnulees: number;
};

const POLITIQUES_MATERIEL = ['INCLUS', 'HORS_FORFAIT'];

// Politique matériel figée sur l'intervention à sa création (contrats/metier.ts, creerVisiteContrat ; recopiée
// sur la suite, interventions/suites.ts) ; à défaut, celle du contrat.
function politiqueMaterielFigee(couverture: Prisma.JsonValue | null, politiqueDuContrat: string): string {
  if (couverture && typeof couverture === 'object' && !Array.isArray(couverture)) {
    const politique = (couverture as Record<string, unknown>).politiqueMateriel;
    if (typeof politique === 'string' && POLITIQUES_MATERIEL.includes(politique)) return politique;
  }
  return politiqueDuContrat;
}

const somme = <T>(lignes: T[], valeur: (ligne: T) => Prisma.Decimal) => lignes.reduce((total, ligne) => total.plus(valeur(ligne)), new Prisma.Decimal(0));

// Toutes les lectures dans un même instantané (REPEATABLE READ) : le contrat, ses interventions, leurs heures et
// leurs achats. null pour un contrat inexistant.
export function margeContrat(contratId: string): Promise<MargeContrat | null> {
  return transactionVerifiee(async (tx) => {
    const contrat = await tx.contratMaintenance.findUnique({ where: { id: contratId }, select: { id: true, statut: true, politiqueMateriel: true } });
    if (!contrat) return null;
    const contratAnnule = contrat.statut === 'ANNULE';
    // Le rattachement d'une intervention à son contrat est figé en base : la suite hérite du contrat de la
    // visite (interventions/suites.ts) ; le filtre porte sur le contrat, jamais sur le client ou le site.
    const interventions = await tx.intervention.findMany({ where: { contratMaintenanceId: contrat.id }, select: { id: true, statut: true, couvertureContrat: true } });
    const annulees = new Set(interventions.filter((intervention) => intervention.statut === 'ANNULEE').map((intervention) => intervention.id));
    const horsForfait = new Set(interventions.filter((intervention) => politiqueMaterielFigee(intervention.couvertureContrat, contrat.politiqueMateriel) === 'HORS_FORFAIT').map((intervention) => intervention.id));
    const duContrat = { interventionId: { in: interventions.map((intervention) => intervention.id) }, archivedAt: null };
    const heures = await tx.coutInterventionHeure.findMany({
      where: duContrat,
      select: { interventionId: true, intervenantId: true, nbrHeures: true, tauxHoraireApplique: true, prixVenteHoraireApplique: true, intervenant: { select: { nom: true } } },
    });
    const achats = await tx.coutInterventionAchat.findMany({ where: duContrat, select: { interventionId: true, montantHT: true } });
    const vendables = contratAnnule ? [] : heures.filter((heure) => !annulees.has(heure.interventionId));
    const valorisees = vendables.filter((heure) => heure.prixVenteHoraireApplique !== null);
    const nonValorisees = vendables.filter((heure) => heure.prixVenteHoraireApplique === null);
    const ventesHT = ventesHeuresAuCentime(valorisees);
    const coutsHT = totalHeuresInterventionAuCentime(heures);
    const materielHT = auCentime(somme(achats.filter((achat) => !horsForfait.has(achat.interventionId)), (achat) => achat.montantHT));
    const materielExcluHT = auCentime(somme(achats.filter((achat) => horsForfait.has(achat.interventionId)), (achat) => achat.montantHT));
    // Dédoublonnés par identifiant (#355, N7) : deux intervenants homonymes restent deux noms.
    const intervenants = new Map(nonValorisees.map((heure) => [heure.intervenantId, heure.intervenant.nom]));
    return {
      ventesHT,
      coutsHT,
      materielHT,
      materielExcluHT,
      margeHT: auCentime(ventesHT.minus(coutsHT).minus(materielHT)),
      heuresValorisees: somme(valorisees, (heure) => heure.nbrHeures),
      heuresNonValorisees: somme(nonValorisees, (heure) => heure.nbrHeures),
      intervenantsNonValorises: [...intervenants.values()].sort((a, b) => a.localeCompare(b, 'fr')),
      heuresAnnulees: somme(heures.filter((heure) => contratAnnule || annulees.has(heure.interventionId)), (heure) => heure.nbrHeures),
      contratAnnule,
      nombreInterventions: interventions.length,
      nombreInterventionsAnnulees: annulees.size,
    };
  }, { isolationLevel: 'RepeatableRead' });
}
