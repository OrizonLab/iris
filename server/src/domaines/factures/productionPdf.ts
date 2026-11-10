import type { Prisma } from '@prisma/client';
import { decimalToNumber } from '../../commun/montants';
import { type DonneesPdf, type PdfProduit, refusPdf } from '../documents/productionPdf';
import { factureInclude, refusDocumentFacture } from './metier';
import { rendreDocumentFacturePdf } from './pdf';
import { lireReglementsEtAvoirsDeLaFacture } from '../reglements/lectureFacture';

// PDF d'une facture ou d'un avoir émis, en deux étapes (lot 6b-1a ; cf. documents/productionPdf.ts),
// sans droit ni verrou : la route garde les siens. La pièce s'imprime depuis ses copies figées
// (./pdf.ts), sans identité actuelle à exiger. Pour une facture émise ou réglée, ses règlements, ses avoirs
// partiels et son solde sont lus en plus, dans la transaction de l'appelant (lot « Détail des avoirs comme
// règlements ») : en REPEATABLE READ pour la route « PDF », après le verrou partagé de la facture pour un
// envoi (./envois.ts).
// Refus de la lecture : 404 « Facture introuvable. », pour une pièce absente ou hors du périmètre du
// lecteur (visibles, cf. ./droits.ts ; AT-3) ; 409 avec le message de refusDocumentFacture (pièce non
// émise, mentions légales ou adresse de facturation figées absentes).
export async function lireFacturePdf(tx: Prisma.TransactionClient, id: string, visibles: Prisma.FactureWhereInput = {}) {
  const facture = await tx.facture.findFirst({ where: { AND: [{ id }, visibles] }, include: { ...factureInclude, identiteEmetteur: { include: { logo: { select: { contenu: true } } } } } });
  if (!facture) return refusPdf(404, 'Facture introuvable.');
  const refus = refusDocumentFacture(facture);
  if (refus) return refusPdf(409, refus);
  const reglements = facture.type === 'FACTURE' && (facture.statut === 'EMISE' || facture.statut === 'REGLEE')
    ? await lireReglementsEtAvoirsDeLaFacture(tx, facture)
    : null;
  return { facture, reglements };
}

export type FacturePdfLu = DonneesPdf<typeof lireFacturePdf>;

export async function rendreFichierFacturePdf({ facture, reglements }: FacturePdfLu): Promise<PdfProduit> {
  // L'identité figée garde son logo en octets : elle échappe à la conversion des montants.
  const { identiteEmetteur, ...piece } = facture;
  const pdf = await rendreDocumentFacturePdf({ ...decimalToNumber(piece), identiteEmetteur }, decimalToNumber(reglements));
  return { pdf, nomFichier: `${facture.numero}.pdf` };
}
