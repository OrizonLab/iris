import '../../env';
import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { prisma, transactionVerifiee } from '../../db';
import { isSuperAdminRole } from '../../droits/roles';
import type { AuthRequest } from '../../http/auth';
import { journaliserAdministration } from '../../commun/journal-administration';

// --- SSO Microsoft (OAuth 2.0 / OpenID Connect, endpoint v2.0) ---
// Le SSO n'est actif que si l'application Azure AD est renseignée (tenant + client).
export const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || '';
export const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '';
export const SSO_CONFIGURED = !!(AZURE_TENANT_ID && AZURE_CLIENT_ID);
const MS_ISSUER = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0`;
const MS_JWKS_URI = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/discovery/v2.0/keys`;

// Normalise un email pour les comparaisons/stockage (insensible à la casse).
export function normalizeEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase();
}

// Champs du compte que rend la connexion (réponse de POST /api/auth/sso, inchangée) : ni `actif`, ni les
// identifiants Microsoft, qui ne sortent par aucune route.
const CHAMPS_COMPTE_CONNEXION = { id: true, name: true, email: true, role: true, theme: true, accesFinance: true, permissions: true } as const;
type CompteConnexion = Prisma.UserGetPayload<{ select: typeof CHAMPS_COMPTE_CONNEXION }>;

// Récupère la clé publique de signature Microsoft correspondant au `kid` du jeton.
// Les clés (JWKS) sont mises en cache 1 h ; en cas de `kid` inconnu on rafraîchit une fois
// (rotation de clés). Utilise le support natif des JWK de Node (crypto.createPublicKey).
let msJwksCache: { keys: Array<Record<string, unknown>>; fetchedAt: number } | null = null;
async function getMicrosoftSigningKey(kid: string): Promise<crypto.KeyObject | null> {
  const fresh = msJwksCache && Date.now() - msJwksCache.fetchedAt < 3600_000;
  if (!fresh) {
    const res = await fetch(MS_JWKS_URI);
    if (!res.ok) return null;
    const data = (await res.json()) as { keys?: Array<Record<string, unknown>> };
    msJwksCache = { keys: data.keys || [], fetchedAt: Date.now() };
  }
  let jwk = msJwksCache!.keys.find((k) => k.kid === kid);
  if (!jwk) {
    // kid absent du cache : forcer un rafraîchissement (rotation possible).
    const res = await fetch(MS_JWKS_URI);
    if (!res.ok) return null;
    const data = (await res.json()) as { keys?: Array<Record<string, unknown>> };
    msJwksCache = { keys: data.keys || [], fetchedAt: Date.now() };
    jwk = msJwksCache.keys.find((k) => k.kid === kid);
  }
  if (!jwk) return null;
  return crypto.createPublicKey({ key: jwk as crypto.webcrypto.JsonWebKey, format: 'jwk' });
}

// Identité Microsoft vérifiée : l'adresse du jeton, et ses identifiants immuables (#264), `oid` (l'utilisateur
// dans l'annuaire) et `tid` (le locataire).
export type IdentiteMicrosoft = { email: string; oid: string; tid: string };

// Trace serveur d'une connexion Microsoft refusée par la règle des identifiants (#264), comme celles de
// l'accès de secours : ni jeton, ni identifiants, ni adresse, seulement le motif et l'adresse IP, plutôt
// qu'une écriture en base par un appel non authentifié.
export function tracerRefusSso(req: express.Request, motif: string): void {
  console.warn(`[SSO] Connexion Microsoft refusée depuis ${req.ip || 'inconnue'} : ${motif}.`);
}

// Vérifie le jeton d'identité Microsoft (idToken) fourni par le client (MSAL) et en extrait l'email VÉRIFIÉ,
// avec `oid` et `tid`. Contrôles : signature RS256 par une clé Microsoft, audience = client_id de notre app,
// issuer = notre tenant. Retourne null si quoi que ce soit échoue, et pour un jeton sans `oid` ou sans `tid`
// (#264), sur lesquels repose l'autorisation.
export async function verifyMicrosoftIdentity(req: express.Request): Promise<IdentiteMicrosoft | null> {
  const idToken = String(req.body?.idToken || '');
  if (!idToken) return null;
  try {
    const decoded = jwt.decode(idToken, { complete: true }) as { header?: { kid?: string } } | null;
    const kid = decoded?.header?.kid;
    if (!kid) return null;
    const key = await getMicrosoftSigningKey(kid);
    if (!key) return null;
    const pem = key.export({ type: 'spki', format: 'pem' }) as string;
    const payload = jwt.verify(idToken, pem, {
      algorithms: ['RS256'],
      audience: AZURE_CLIENT_ID,
      issuer: MS_ISSUER,
    }) as jwt.JwtPayload;
    // Comptes professionnels : `preferred_username` porte l'UPN/email ; `email` en secours.
    const email = (payload.email as string) || (payload.preferred_username as string) || '';
    if (!email) return null;
    const oid = typeof payload.oid === 'string' ? payload.oid : '';
    const tid = typeof payload.tid === 'string' ? payload.tid : '';
    if (!oid || !tid) {
      tracerRefusSso(req, 'jeton sans oid ou sans tid');
      return null;
    }
    return { email, oid, tid };
  } catch {
    return null;
  }
}

// Issue de l'autorisation d'une identité Microsoft vérifiée :
//   - AUTORISEE : le compte, sous les seuls champs de la réponse de connexion ;
//   - NON_AUTORISEE : aucun compte actif ne lui correspond (403, « accès refusé », comme avant #264) ;
//   - REFUSEE : l'adresse et les identifiants ne désignent pas le même compte (401 générique, sans détail ;
//     le motif ne sert qu'à la trace serveur).
export type ConnexionMicrosoft =
  | { statut: 'AUTORISEE'; compte: CompteConnexion }
  | { statut: 'NON_AUTORISEE' }
  | { statut: 'REFUSEE'; motif: string };

const CHAMPS_COMPTE_LIAISON = { ...CHAMPS_COMPTE_CONNEXION, actif: true, microsoftOid: true, microsoftTid: true } as const;
type CompteLiaison = Prisma.UserGetPayload<{ select: typeof CHAMPS_COMPTE_LIAISON }>;

function compteConnexion(compte: CompteLiaison): CompteConnexion {
  const { id, name, email, role, theme, accesFinance, permissions } = compte;
  return { id, name, email, role, theme, accesFinance, permissions };
}

// Entrée du journal d'administration écrite par la connexion d'un compte (choix par défaut, à confirmer) : au
// nom du compte lui-même, et non de l'administration ni du démarrage ; fermée au simple administrateur et au
// directeur si le compte est super administrateur, comme toute entrée qui porte sur un compte. Les
// identifiants Microsoft n'y figurent pas.
async function journaliserConnexionCompte(
  client: Prisma.TransactionClient,
  compte: CompteLiaison,
  action: 'LIAISON_MICROSOFT' | 'ADRESSE_MICROSOFT_CHANGEE',
  valeurs?: { avant: Record<string, unknown>; apres: Record<string, unknown> },
): Promise<void> {
  const auteur: Pick<AuthRequest, 'user'> = {
    user: { id: compte.id, name: compte.name, role: compte.role, accesFinance: compte.accesFinance, permissions: compte.permissions, equipeIds: [] },
  };
  await journaliserAdministration(client, auteur as AuthRequest, {
    domaine: 'DROITS', type: 'COMPTE', action, cibleId: compte.id,
    // Même libellé que libelleCompteJournal (domaines/utilisateurs/comptes.ts), qui importe ce module.
    cibleLibelle: `${compte.name} (${compte.email})`,
    concerneSuperAdmin: isSuperAdminRole(compte.role),
    avant: valeurs?.avant ?? null,
    apres: valeurs?.apres ?? null,
  });
}

// Couche d'autorisation de la connexion Microsoft, sur l'identifiant immuable (#264, décision de Nelson du
// 16-11-2026). L'adresse du jeton peut changer (renommage, changement de domaine) ou être réattribuée à une
// autre personne ; le couple `oid` + `tid`, lui, ne change pas. Un compte d'Iris est donc lié à ce couple à
// sa première connexion réussie, puis autorisé sur lui :
//   - compte déjà lié au couple du jeton : autorisé s'il est actif, quelle que soit l'adresse du jeton ; une
//     adresse différente de celle du compte est journalisée (« changement d'adresse Microsoft détecté »), sans
//     changer l'adresse du compte, qu'aucune route ne modifie ;
//   - sinon, compte actif trouvé par l'adresse, comme avant, et non lié : le couple lui est lié par une mise à
//     jour conditionnelle (identifiants encore vides), atomique, journalisée dans la même transaction ; de deux
//     premières connexions simultanées avec deux couples différents, une seule lie le compte ;
//   - refus (REFUSEE) : l'adresse d'un compte lié à un autre couple, ou un couple lié à un autre compte que
//     celui de l'adresse, même désactivé (le choix le plus restrictif, à confirmer).
// Un compte désactivé garde sa liaison : pour la même personne, on réactive l'ancien compte. Une liaison
// erronée ne se défait qu'en supprimant le compte, ce qui libère le couple.
export async function autoriserConnexionMicrosoft(identite: IdentiteMicrosoft): Promise<ConnexionMicrosoft> {
  const email = normalizeEmail(identite.email);
  const { oid, tid } = identite;
  if (!email || !oid || !tid) return { statut: 'REFUSEE', motif: 'jeton sans adresse, oid ou tid' };
  const [lie, deLAdresse] = await Promise.all([
    prisma.user.findUnique({ where: { microsoftOid_microsoftTid: { microsoftOid: oid, microsoftTid: tid } }, select: CHAMPS_COMPTE_LIAISON }),
    prisma.user.findUnique({ where: { email }, select: CHAMPS_COMPTE_LIAISON }),
  ]);

  if (lie) {
    if (deLAdresse && deLAdresse.id !== lie.id) return { statut: 'REFUSEE', motif: 'identifiants Microsoft liés à un autre compte que celui de l’adresse' };
    if (!lie.actif) return { statut: 'NON_AUTORISEE' };
    if (normalizeEmail(lie.email) !== email) {
      await journaliserConnexionCompte(prisma, lie, 'ADRESSE_MICROSOFT_CHANGEE', { avant: { email: lie.email }, apres: { email } });
    }
    return { statut: 'AUTORISEE', compte: compteConnexion(lie) };
  }

  if (!deLAdresse || !deLAdresse.actif) return { statut: 'NON_AUTORISEE' };
  // Compte de l'adresse déjà lié au couple de ce jeton, alors que la lecture par le couple ne l'a pas trouvé : les deux
  // lectures, parallèles, ne sont pas faites au même instant, et une connexion simultanée de la même personne l'a lié
  // entre les deux. Il est admis comme un compte lié (son adresse est celle du jeton : rien à journaliser), et non
  // refusé comme lié à d'autres identifiants.
  if (deLAdresse.microsoftOid === oid && deLAdresse.microsoftTid === tid) {
    return { statut: 'AUTORISEE', compte: compteConnexion(deLAdresse) };
  }
  if (deLAdresse.microsoftOid !== null || deLAdresse.microsoftTid !== null) {
    return { statut: 'REFUSEE', motif: 'adresse d’un compte lié à d’autres identifiants Microsoft' };
  }

  let lieIci: CompteLiaison | null;
  try {
    lieIci = await transactionVerifiee(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: deLAdresse.id, actif: true, microsoftOid: null, microsoftTid: null },
        data: { microsoftOid: oid, microsoftTid: tid },
      });
      if (count !== 1) return null;
      // Relu sous le verrou de la mise à jour : le journal porte le compte tel qu'il est lié.
      const compte = await tx.user.findUnique({ where: { id: deLAdresse.id }, select: CHAMPS_COMPTE_LIAISON });
      if (!compte) return null;
      await journaliserConnexionCompte(tx, compte, 'LIAISON_MICROSOFT');
      return compte;
    });
  } catch (error) {
    // Couple lié entre-temps à un autre compte : l'index unique refuse la seconde liaison.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { statut: 'REFUSEE', motif: 'identifiants Microsoft liés entre-temps à un autre compte' };
    }
    throw error;
  }
  if (lieIci) return { statut: 'AUTORISEE', compte: compteConnexion(lieIci) };

  // Mise à jour sans effet : le compte a été lié, ou désactivé, entre-temps. Relu, il n'est admis que s'il est
  // actif et lié au couple de ce jeton (deux premières connexions simultanées de la même personne).
  const relu = await prisma.user.findUnique({ where: { id: deLAdresse.id }, select: CHAMPS_COMPTE_LIAISON });
  if (!relu || !relu.actif) return { statut: 'NON_AUTORISEE' };
  if (relu.microsoftOid === oid && relu.microsoftTid === tid) return { statut: 'AUTORISEE', compte: compteConnexion(relu) };
  return { statut: 'REFUSEE', motif: 'compte lié entre-temps à d’autres identifiants Microsoft' };
}
