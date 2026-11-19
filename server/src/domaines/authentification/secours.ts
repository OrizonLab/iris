import '../../env';
import crypto from 'crypto';
import { normalizeEmail } from './sso';
import { EMAIL_COMPTE_SYSTEME } from '../../droits/roles';

// --- Accès de secours (« break-glass ») du super administrateur ---
// Microsoft Entra ID est la porte d'entrée normale, et la seule pour les comptes de la
// société. Mais faire dépendre 100 % des accès d'un service extérieur crée une panne
// unique : tenant Microsoft indisponible, application Azure supprimée ou mal reconfigurée,
// migration de tenant, compte de direction verrouillé — et plus PERSONNE ne peut entrer,
// pas même pour réparer. Cette route est la porte de service : elle n'ouvre qu'à UN compte
// superadmin nommé, avec un secret qui ne vit que dans server/.env sur le VPS.
//
// Elle est volontairement plus stricte qu'une connexion normale :
//   - il faut connaître un secret d'au moins 32 caractères, jamais versionné ;
//   - le compte visé doit exister, être actif ET être SUPERADMIN ;
//   - la session ouverte dure 1 h, pas 7 jours (c'est un accès de dépannage) ;
//   - 5 tentatives par quart d'heure et par IP, puis blocage ;
//   - chaque tentative non bloquée (refus, succès, compte absent, erreur après un jeton valide) laisse une trace
//     dans les journaux du conteneur, avec l'adresse (#608) ; pendant un blocage, seul le premier essai bloqué de la
//     fenêtre en laisse une (#589).
// Sans BREAK_GLASS_EMAIL + BREAK_GLASS_TOKEN dans l'environnement, la route est inactive
// et répond 503 : une instance qui n'en veut pas n'a rien à désactiver.
export const BREAK_GLASS_EMAIL = normalizeEmail(process.env.BREAK_GLASS_EMAIL || '');
export const BREAK_GLASS_TOKEN = process.env.BREAK_GLASS_TOKEN || '';
export const BREAK_GLASS_MIN_LONGUEUR = 32;
// L'adresse réservée du compte système n'ouvre jamais l'accès de secours : ce compte ne se connecte pas.
export const BREAK_GLASS_ADRESSE_RESERVEE = BREAK_GLASS_EMAIL === EMAIL_COMPTE_SYSTEME;
export const BREAK_GLASS_ACTIF = !!BREAK_GLASS_EMAIL && !BREAK_GLASS_ADRESSE_RESERVEE && BREAK_GLASS_TOKEN.length >= BREAK_GLASS_MIN_LONGUEUR;

// Comparaison à temps constant. On compare les EMPREINTES et non les secrets eux-mêmes :
// timingSafeEqual exige deux tampons de même longueur, et hacher d'abord évite à la fois
// l'exception sur des longueurs différentes et la fuite de la longueur du secret attendu.
export function secretIdentique(fourni: string, attendu: string): boolean {
  const a = crypto.createHash('sha256').update(fourni).digest();
  const b = crypto.createHash('sha256').update(attendu).digest();
  return crypto.timingSafeEqual(a, b);
}

// Limitation du nombre d'essais, en mémoire du processus. Suffisant ici : il n'y a qu'un
// backend, et un redémarrage qui remettrait les compteurs à zéro n'aide pas un attaquant
// à deviner 256 bits d'entropie. (Un rate limiting partagé deviendra nécessaire le jour où
// l'API tournera en plusieurs instances.)
const BREAK_GLASS_FENETRE_MS = 15 * 60 * 1000;
const BREAK_GLASS_MAX_ESSAIS = 5;
// Borne dure de la table (#563) : protection technique (C-26 du paramétrage cible, gardée dans le code), et non règle
// de l'entreprise. Une adresse de plus que la borne fait sortir la fenêtre la plus ancienne, jamais refuser l'adresse
// nouvelle : un refus laisserait un tiers bloquer l'accès de secours pour tous (#261). Valeur et règle de sortie : choix
// par défaut, à confirmer.
export const BREAK_GLASS_MAX_ADRESSES = 10_000;
export const essaisSecours = new Map<string, { count: number; depuis: number }>();

// Même règle pour le blocage et pour la purge : une fenêtre est passée au-delà de quinze minutes, ou si elle est datée
// dans le futur, ce qui n'arrive qu'après un recul de l'horloge du système (correction NTP) : sans cela, le blocage d'une
// adresse serait prolongé de toute la durée du recul (#607). Une fenêtre ainsi passée repart de zéro, comme à son terme :
// un recul rend au plus cinq essais à une adresse, sur un secret d'au moins 32 caractères, et qui ferait reculer
// l'horloge du serveur ranimerait déjà les sessions expirées. Même règle que la borne de lecture des clés Microsoft
// (sso.ts). Choix par défaut, à confirmer.
const fenetrePassee = (depuis: number, maintenant: number) =>
  maintenant < depuis || maintenant - depuis > BREAK_GLASS_FENETRE_MS;

// Premier essai bloqué de la fenêtre de cette adresse (à lire juste après tropDEssaisSecours, qui l'a compté) : seul
// celui-ci est tracé (#589), pour qu'une rafale d'essais bloqués ne remplisse pas les journaux du conteneur. Les
// suivants ne lisent même pas le jeton. Une ligne par adresse et par fenêtre, sans ligne de synthèse : choix par
// défaut, à confirmer.
export function premierEssaiBloqueSecours(ip: string): boolean {
  return essaisSecours.get(ip)?.count === BREAK_GLASS_MAX_ESSAIS + 1;
}

export function tropDEssaisSecours(ip: string): boolean {
  const maintenant = Date.now();
  // Purge au fil des essais (#563). La table garde l'ordre d'ouverture des fenêtres : une entrée n'y entre qu'en fin,
  // à l'ouverture de sa fenêtre, si bien que, tant que l'horloge ne recule pas, les fenêtres passées sont en tête. On
  // s'arrête à la première encore ouverte : chaque entrée n'est parcourue qu'une fois, sans parcours complet à chaque essai.
  for (const [cle, suivi] of essaisSecours) {
    if (!fenetrePassee(suivi.depuis, maintenant)) break;
    essaisSecours.delete(cle);
  }
  let suivi = essaisSecours.get(ip);
  // Le blocage ne dépend pas de l'ordre de la table : `Date.now()` suit l'horloge du système, qui peut reculer
  // (correction NTP). La purge a pu alors s'arrêter avant la fenêtre passée de cette adresse ; elle repart de zéro, en
  // fin de table, comme avant #563.
  if (suivi && fenetrePassee(suivi.depuis, maintenant)) {
    essaisSecours.delete(ip);
    suivi = undefined;
  }
  if (!suivi) {
    if (essaisSecours.size >= BREAK_GLASS_MAX_ADRESSES) essaisSecours.delete(essaisSecours.keys().next().value as string);
    essaisSecours.set(ip, { count: 1, depuis: maintenant });
    return false;
  }
  suivi.count += 1;
  return suivi.count > BREAK_GLASS_MAX_ESSAIS;
}
