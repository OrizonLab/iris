import express from 'express';
import { Prisma } from '@prisma/client';
import { ROLE_RESPONSABLE, litToutesLesAffaires } from './roles';
import type { AuthRequest } from '../http/auth';
import type { ApiRequest } from '../http/cles-api';

// --- Périmètre de lecture du domaine chantier ---
// Une même liste (achats, heures, chantiers) ne montre pas la même chose selon qui la
// demande. Deux natures de porteur, deux façons de le décider ; sans porteur, rien n'est lu :
//
//   - session humaine : le RÔLE décide. Un administrateur, un directeur ou une assistante
//     technique voit tout (cf. litToutesLesAffaires) ; un
//     conducteur de travaux, les chantiers dont il est responsable ; un responsable, les
//     siens et ceux de toute sa branche hiérarchique ; un commercial, ceux qu'il a vendus.
//     C'est exactement la règle qu'applique déjà GET /api/chantiers.
//   - clé d'intégration : le SCOPE décide. Une clé ne représente personne en particulier,
//     elle n'a donc pas de rôle à interroger ; porter `chantiers:read` vaut autorisation
//     sur le domaine, et c'est au superadmin de ne délivrer que les scopes utiles.
//   - aucun porteur (ni session ni clé) : aucun chantier. La règle se ferme au lieu de
//     s'ouvrir (#668, N1 de l'audit des droits du lot Y ; micro-arbitrage de droits, règle 5,
//     l'option la plus restrictive, choix par défaut, à confirmer). C'est inatteignable
//     aujourd'hui : toutes les routes qui emploient ces filtres passent par requireAuth ou
//     requireApiKey ; une route montée un jour sans garde ne lirait rien, au lieu de tout.
//
// Renvoie un filtre Prisma applicable à un champ `chantier` imbriqué comme à un chantier
// racine ; `{}` signifie « aucune restriction », `{ id: { in: [] } }` « aucun chantier ».
// L'appelant écrit le périmètre APRÈS ses propres clés (`{ id, ...perimetre }`), ou le
// compose dans un `AND` (`{ AND: [{ id }, perimetre] }`, comme pieceVisible pour les factures) :
// écrit avant, une clé `id` de l'appelant remplacerait le filtre fermé et rouvrirait la lecture.
// Une affaire ANNULÉE sort du périmètre de tout le monde, administrateurs compris : elle
// n'a plus à peser sur une liste, un coût, une marge ou une commission. Elle n'est pas
// perdue pour autant — GET /api/chantiers/:id la rend toujours, avec le motif de son
// annulation, et c'est bien là qu'on va la chercher quand on veut comprendre ; son journal
// d'audit aussi (cf. perimetreChantiersAnnulesCompris).
export const AFFAIRE_NON_ANNULEE = { statut: { not: 'ANNULE' } } as const;

export function perimetreChantiers(req: express.Request): Prisma.ChantierWhereInput {
  return { ...AFFAIRE_NON_ANNULEE, ...perimetreDemandeur(req) };
}

// Le même périmètre de lecture, affaires annulées comprises : celui du journal d'audit d'un
// chantier (GET /api/chantiers/:id/journal-saisies ; lot Y, #136 point 1, R1 du passage
// hebdomadaire #661 ; choix par défaut, à confirmer). Il est compris dans celui de la fiche,
// qui a sa règle propre (isOwner) : un commercial titulaire, ou un compte commercial d'un autre
// type, lit la fiche sans ce journal (règle historique, harmonisée en D2, décision 8 de
// docs/MODELE-DROITS-CIBLE.md). Le journal est figé après l'annulation (toute écriture y est
// refusée, hors l'entrée de l'annulation elle-même, écrite dans sa transaction, lot AG-c) : à
// périmètre inchangé, chacun n'y lit, en plus de cette entrée, que ce qu'il pouvait y lire avant
// l'annulation (statut, date et motif figurent déjà sur la fiche ; seul le nom de l'auteur est nouveau).
export function perimetreChantiersAnnulesCompris(req: express.Request): Prisma.ChantierWhereInput {
  return perimetreDemandeur(req);
}

function perimetreDemandeur(req: express.Request): Prisma.ChantierWhereInput {
  if ((req as ApiRequest).apiKey) return {};
  const user = (req as AuthRequest).user;
  if (!user) return { id: { in: [] } };
  if (litToutesLesAffaires(user.role)) return {};
  if (user.role === 'COMMERCIAL') return { commercialId: user.id };
  if (user.role === ROLE_RESPONSABLE) return { responsableId: { in: [user.id, ...user.equipeIds] } };
  return { responsableId: user.id };
}
