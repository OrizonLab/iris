import type { Prisma } from '@prisma/client';
import { ROLE_ASSISTANTE_TECHNIQUE, isAdminRole } from '../../droits/roles';

// Factures de l'assistante technique (lot « Assistante technique », AT-3 ; décisions de Nelson du 24-10-2026,
// points 27, 30, 33 et 34, réponse 6 du 06-11-2026 et réponse 1 du 09-11-2026).
// Une pièce est aux assistantes techniques quand le compte qui a créé le brouillon était de ce type
// (Facture.creeParType, figé à la création) : la facture, qu'elle l'ait émise elle-même ou que
// l'administration l'ait émise, et les avoirs que l'administration porte sur elle. Le périmètre est celui
// du poste, et non de la personne : toute assistante technique voit les pièces de toutes (point 33,
// « non nomminative »). Une pièce hors de ce périmètre lui répond 404, comme un chantier hors du sien.
// L'administration voit toutes les pièces ; tout autre type de compte, qu'une garde a déjà refusé, n'en
// verrait aucune.
export function facturesVisibles(role: string | undefined | null): Prisma.FactureWhereInput {
  if (isAdminRole(role)) return {};
  if (role !== ROLE_ASSISTANTE_TECHNIQUE) return { id: { in: [] } };
  return { OR: [
    { creeParType: ROLE_ASSISTANTE_TECHNIQUE },
    { type: 'AVOIR', factureOrigine: { creeParType: ROLE_ASSISTANTE_TECHNIQUE } },
  ] };
}

// Une pièce désignée par son identifiant, dans le périmètre du lecteur : sans elle, la route répond 404.
export function pieceVisible(id: string, role: string | undefined | null): Prisma.FactureWhereInput {
  return { AND: [{ id }, facturesVisibles(role)] };
}

// Ce que l'assistante technique ne fait pas sur les pièces qu'elle voit (point 30, « non elle ne fait pas
// les avoir ou saisir des reglement ») : ni avoir, ni annulation, ni règlement, routes restées à
// l'administration (requireAdmin). Leur envoi non plus : elle lit un avoir, ses envois compris, sans
// l'envoyer (choix par défaut, le plus restrictif, à confirmer).
export const REFUS_ENVOI_AVOIR_ASSISTANTE = 'L’envoi d’un avoir est réservé à l’administration.';
export function envoiAvoirRefuse(role: string | undefined | null, piece: { type: string }): boolean {
  return piece.type === 'AVOIR' && !isAdminRole(role);
}

// Journal d'une facture lu par l'assistante technique : la contre-passation d'un règlement cite son montant
// total, qui peut couvrir d'autres factures que la sienne. Elle lit la part retirée de sa facture et le
// reste dû, sans ce total (choix par défaut, le plus restrictif, à confirmer). Le libellé est écrit par
// reglements/routes.ts : « Contre-passation du règlement <id> du <JJ-MM-AAAA> de <montant> : « <motif> »… ».
const TOTAL_CONTREPASSATION = /^(Contre-passation du règlement \S+ du \d{2}-\d{2}-\d{4}) de .+? € (: « )/;
export function journalPourLeLecteur<T extends { action: string; detail: string | null }>(role: string | undefined | null, lignes: T[]): T[] {
  if (isAdminRole(role)) return lignes;
  return lignes.map((ligne) => (ligne.action === 'REGLEMENT_CONTREPASSE' && ligne.detail
    ? { ...ligne, detail: ligne.detail.replace(TOTAL_CONTREPASSATION, '$1 $2') }
    : ligne));
}
