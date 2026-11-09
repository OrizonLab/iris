import type { Prisma } from '@prisma/client';

// Règlements reçus par une facture, vus depuis cette facture (lot « Assistante technique », AT-3 ; décision de
// Nelson du 24-10-2026, point 33, « elle pourra voir les avoirs porté sur ses factures ainsi que les
// reglements », et réponse 1 du 09-11-2026, « ses règlements en lecture ») : pour chaque règlement, sa date,
// son moyen, sa référence, son statut et sa contre-passation (date et motif), et la seule part affectée à
// cette facture. Ni les autres factures du règlement, ni son montant total : un règlement peut couvrir des
// factures que le lecteur ne voit pas. Du plus ancien au plus récent, comme le journal de la facture.
// Lecture seule : la route qui l'appelle vérifie d'abord que la facture est dans le périmètre du lecteur.
export async function lireReglementsDeLaFacture(tx: Prisma.TransactionClient, factureId: string) {
  return tx.affectationReglement.findMany({
    where: { factureId },
    select: {
      id: true, montant: true,
      reglement: { select: { id: true, dateReglement: true, moyen: true, reference: true, statut: true, contrepasseLe: true, motifContrepassation: true } },
    },
    orderBy: [{ reglement: { dateReglement: 'asc' } }, { reglement: { createdAt: 'asc' } }, { id: 'asc' }],
  });
}
