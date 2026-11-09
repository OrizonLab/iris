import type { Prisma } from '@prisma/client';
import { ROLE_ASSISTANTE_TECHNIQUE, isAdminRole } from '../../droits/roles';

// Factures de l'assistante technique (lot « Assistante technique », AT-3 et AT-4 ; décisions de Nelson du
// 24-10-2026, points 27, 30, 33 et 34, réponse 6 du 06-11-2026, réponse 1 du 09-11-2026 sur AT-3 et
// décisions du 09-11-2026 sur AT-4).
// Une pièce est aux assistantes techniques quand le compte qui a créé le brouillon était de ce type
// (Facture.creeParType, figé à la création) : la facture, qu'elle l'ait émise elle-même ou que
// l'administration l'ait émise, et les avoirs portés sur elle, par l'administration ou par une assistante
// technique (AT-4). Le périmètre est celui du poste, et non de la personne : toute assistante technique voit
// les pièces de toutes (point 33, « non nomminative »). Une pièce hors de ce périmètre lui répond 404, comme
// un chantier hors du sien, en lecture comme pour un avoir, une annulation ou un envoi.
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

// Journal d'une facture lu par l'assistante technique : la contre-passation d'un règlement cite son montant
// total, qui peut couvrir d'autres factures que la sienne. Elle lit la part retirée de sa facture et le
// reste dû, sans ce total (choix par défaut, le plus restrictif, à confirmer). Le libellé est écrit par
// reglements/routes.ts : « Contre-passation du règlement <id> du <JJ-MM-AAAA> de <montant> : « <motif> »… ».
const TOTAL_CONTREPASSATION = /^(Contre-passation du règlement \S+ du \d{2}-\d{2}-\d{4}) de .+? € (: « )/;
// Retrait fermé par défaut : un libellé que l'expression ne reconnaît pas (format de montant changé, par exemple) n'est pas
// rendu tel quel, il est remplacé par ce texte, sans aucun montant.
export const CONTREPASSATION_SANS_DETAIL = 'Contre-passation d’un règlement : le détail est réservé à l’administration.';
export function journalPourLeLecteur<T extends { action: string; detail: string | null }>(role: string | undefined | null, lignes: T[]): T[] {
  if (isAdminRole(role)) return lignes;
  return lignes.map((ligne) => {
    if (ligne.action !== 'REGLEMENT_CONTREPASSE' || !ligne.detail) return ligne;
    const sansTotal = ligne.detail.replace(TOTAL_CONTREPASSATION, '$1 $2');
    return { ...ligne, detail: sansTotal === ligne.detail ? CONTREPASSATION_SANS_DETAIL : sansTotal };
  });
}
