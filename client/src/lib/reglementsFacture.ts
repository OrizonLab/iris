// Règlements et avoirs d'une facture, tels que les lit GET /api/factures/:id/reglements (lot « Détail des avoirs
// comme règlements » ; réponse de Nelson du 10-11-2026 au point 4, « avec le detail des avoir en tant que
// reglement »).

// Part d'un règlement affectée à la facture : ni les autres factures du règlement, ni son montant total (AT-3 ;
// point 33 et réponse 1 du 09-11-2026).
export type PartReglement = {
  id: string;
  montant: number;
  reglement: {
    id: string; dateReglement: string; createdAt: string; moyen: string; reference: string | null;
    statut: 'ENREGISTRE' | 'CONTREPASSE'; contrepasseLe: string | null; motifContrepassation: string | null;
  };
};

// Avoir partiel émis de la facture, en TTC : ni l'avoir d'annulation, ni un avoir brouillon.
export type AvoirDeLaFacture = { id: string; numero: string | null; dateEmission: string; emisLe: string | null; totalTtc: number };

// Solde lu dans le même instantané que les lignes ; null pour une pièce sans solde (brouillon, annulée, avoir).
export type SoldeDeLaFacture = { montantRegle: number; montantAvoirs: number; resteDu: number } | null;

export type ReglementsDeLaFacture = { parts: PartReglement[]; avoirs: AvoirDeLaFacture[]; solde: SoldeDeLaFacture };

export type LigneReglementFacture =
  | { nature: 'PART'; id: string; part: PartReglement }
  | { nature: 'AVOIR'; id: string; avoir: AvoirDeLaFacture };

const temps = (valeur: string | null) => (valeur ? new Date(valeur).getTime() : 0);

// Parts et avoirs mêlés, dans l'ordre du PDF de la facture (server/src/domaines/reglements/lectureFacture.ts,
// comparerReperes ; choix d'affichage par défaut, à confirmer) : date civile (date du règlement, date d'émission
// de l'avoir), puis instant de saisie (création du règlement, émission de l'avoir), puis identifiant. Ce n'est
// pas l'ordre du journal, qui suit le seul instant de saisie.
export function lignesReglementsFacture(parts: PartReglement[], avoirs: AvoirDeLaFacture[]): LigneReglementFacture[] {
  const lignes = [
    ...parts.map((part) => ({ ligne: { nature: 'PART' as const, id: part.id, part }, date: temps(part.reglement.dateReglement), instant: temps(part.reglement.createdAt) })),
    ...avoirs.map((avoir) => ({ ligne: { nature: 'AVOIR' as const, id: avoir.id, avoir }, date: temps(avoir.dateEmission), instant: temps(avoir.emisLe) })),
  ];
  lignes.sort((a, b) => a.date - b.date || a.instant - b.instant || (a.ligne.id < b.ligne.id ? -1 : a.ligne.id > b.ligne.id ? 1 : 0));
  return lignes.map(({ ligne }) => ligne);
}
