import type { Prisma } from '@prisma/client';
import type { prisma } from '../../db';

type Db = Prisma.TransactionClient | typeof prisma;

// Facture « vivante » : une facture (et non un avoir) qui n'est pas annulée, brouillon, émise ou réglée.
// Définition commune au contrôle d'unicité de la facture au temps passé (./tempsPasse.ts) et au repère
// « déjà facturée » ci-dessous. Une facture couverte, en tout ou en partie, par des avoirs partiels n'est pas
// annulée : elle reste vivante (décision 4 du 09-11-2026 sur AT-4).
export const FACTURE_VIVANTE = { type: 'FACTURE', statut: { not: 'ANNULEE' } } satisfies Prisma.FactureWhereInput;

// Repère « déjà facturée » (lot « Assistante technique », AT-4 ; message de Nelson du 09-11-2026, « Oui il faut
// un repere deja facturer », et réponses « Toute facture non annulée (Recommandé) » et « Même origine seulement
// (Recommandé) ») : une origine est facturée quand une facture vivante la porte, de qui qu'elle soit,
// administration comprise. Seule l'origine choisie compte : une facture du chantier ne marque pas ses
// interventions, ni celle d'un contrat ses visites. La réponse ne donne que ce booléen : ni montant, ni numéro,
// ni nombre de factures, l'assistante technique ne voyant pas les pièces de l'administration (./droits.ts).
export const ORIGINES_REPERE = ['CHANTIER', 'INTERVENTION', 'CONTRAT'] as const;
export type OrigineRepere = typeof ORIGINES_REPERE[number];

export function lireOrigineRepere(origine: unknown, id: unknown): { origine: OrigineRepere; id: string } | null {
  if (typeof origine !== 'string' || !(ORIGINES_REPERE as readonly string[]).includes(origine)) return null;
  if (typeof id !== 'string' || !id.trim()) return null;
  return { origine: origine as OrigineRepere, id };
}

// null : origine introuvable (404).
export async function origineDejaFacturee(db: Db, origine: OrigineRepere, id: string): Promise<boolean | null> {
  const existe = origine === 'CHANTIER'
    ? await db.chantier.findUnique({ where: { id }, select: { id: true } })
    : origine === 'INTERVENTION'
      ? await db.intervention.findUnique({ where: { id }, select: { id: true } })
      : await db.contratMaintenance.findUnique({ where: { id }, select: { id: true } });
  if (!existe) return null;
  const rattachement: Prisma.FactureWhereInput = origine === 'CHANTIER' ? { chantierId: id } : origine === 'INTERVENTION' ? { interventionId: id } : { contratMaintenanceId: id };
  const facture = await db.facture.findFirst({ where: { AND: [FACTURE_VIVANTE, { origine }, rattachement] }, select: { id: true } });
  return Boolean(facture);
}
