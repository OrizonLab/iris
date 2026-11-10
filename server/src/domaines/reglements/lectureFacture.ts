import type { Prisma } from '@prisma/client';
import { soldesFactures } from './metier';

// Règlements reçus par une facture, vus depuis cette facture (lot « Assistante technique », AT-3 ; décision de
// Nelson du 24-10-2026, point 33, « elle pourra voir les avoirs porté sur ses factures ainsi que les
// reglements », et réponse 1 du 09-11-2026, « ses règlements en lecture ») : pour chaque règlement, sa date,
// son instant de saisie, son moyen, sa référence, son statut et sa contre-passation (date et motif), et la
// seule part affectée à cette facture. Ni les autres factures du règlement, ni son montant total : un
// règlement peut couvrir des factures que le lecteur ne voit pas. Par date du règlement, puis instant de
// saisie, puis identifiant de la part. Lecture seule : la route qui l'appelle vérifie d'abord que la facture
// est dans le périmètre du lecteur.
export async function lireReglementsDeLaFacture(tx: Prisma.TransactionClient, factureId: string) {
  return tx.affectationReglement.findMany({
    where: { factureId },
    select: {
      id: true, montant: true,
      reglement: { select: { id: true, dateReglement: true, createdAt: true, moyen: true, reference: true, statut: true, contrepasseLe: true, motifContrepassation: true } },
    },
    orderBy: [{ reglement: { dateReglement: 'asc' } }, { reglement: { createdAt: 'asc' } }, { id: 'asc' }],
  });
}

// Avoirs partiels émis d'une facture, lus comme des règlements (lot « Détail des avoirs comme règlements » ;
// réponse de Nelson du 10-11-2026 au point 4, « avec le detail des avoir en tant que reglement ») : ceux que
// compte le reste dû (./metier.ts, soldesFactures), sans l'avoir d'annulation, qui annule la facture au lieu
// de la régler, ni un avoir brouillon. Par date d'émission, puis instant d'émission, puis identifiant.
export async function lireAvoirsPartielsDeLaFacture(tx: Prisma.TransactionClient, factureId: string) {
  return tx.facture.findMany({
    where: { factureOrigineId: factureId, type: 'AVOIR', estAvoirAnnulation: false, statut: { not: 'BROUILLON' } },
    select: { id: true, numero: true, dateEmission: true, emisLe: true, totalTtc: true },
    orderBy: [{ dateEmission: 'asc' }, { emisLe: 'asc' }, { id: 'asc' }],
  });
}

// Règlements, avoirs partiels et solde d'une facture, lus ensemble dans la transaction de l'appelant : le panneau
// « Règlements et avoirs » (GET /api/factures/:id/reglements) et le PDF de la facture
// (../factures/productionPdf.ts) montrent des lignes et un solde du même instantané. Le solde est null pour une
// pièce qui n'en a pas (brouillon, facture annulée, avoir), comme dans la liste des factures.
export async function lireReglementsEtAvoirsDeLaFacture(tx: Prisma.TransactionClient, facture: { id: string; type: string; statut: string; totalTtc: Prisma.Decimal | number }) {
  const parts = await lireReglementsDeLaFacture(tx, facture.id);
  const avoirs = await lireAvoirsPartielsDeLaFacture(tx, facture.id);
  const solde = (await soldesFactures(tx, [facture])).get(facture.id) ?? null;
  return { parts, avoirs, solde };
}

// Ordre commun au panneau et au PDF (choix d'affichage par défaut, à confirmer) : date civile (date du
// règlement, date d'émission de l'avoir, toutes deux à minuit UTC du jour civil), puis instant de saisie
// (création du règlement, émission de l'avoir), puis identifiant. Ce n'est pas l'ordre du journal, qui suit le
// seul instant de saisie. L'écran applique la même règle (client/src/lib/reglementsFacture.ts).
export type RepereOrdre = { date: Date; instant: Date | null; id: string };
export function comparerReperes(a: RepereOrdre, b: RepereOrdre) {
  return a.date.getTime() - b.date.getTime()
    || (a.instant?.getTime() ?? 0) - (b.instant?.getTime() ?? 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
