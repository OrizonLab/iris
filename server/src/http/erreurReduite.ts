import type express from 'express';

// Garde des journaux (lot des failles des dépendances, 14-11-2026). Express 5.3 journalise l'erreur entière par son
// gestionnaire final (`console.error(err)`), là où Express 5.2 n'en journalisait que la pile (`err.stack`). Une erreur
// porte parfois des données qui n'ont rien à faire dans un journal : le corps brut d'une requête JSON mal formée
// (`body`, posé par body-parser), les détails d'une erreur Prisma (`meta`), une `cause`.
//
// Le dernier gestionnaire d'erreurs, monté après toutes les routes, transmet donc au gestionnaire final une copie
// réduite : la même pile, et seulement ce que `finalhandler` lit pour fixer la réponse (`status`, `statusCode`,
// `headers`), en propriétés non énumérables, que `console.error` n'imprime pas. La réponse ne change pas, et le
// journal redevient la pile seule. Le message de l'erreur, qui figure dans la pile, peut citer un extrait du corps
// (message de `JSON.parse`), comme avant. Les journaux que les gestionnaires écrivent eux-mêmes ne passent pas ici.
const PROPRIETES_DE_LA_REPONSE = ['status', 'statusCode', 'headers'] as const;

// `String(valeur)`, sans lever d'exception pour un objet sans prototype (`Object.create(null)`) ni pour un `toString`
// qui échoue : la garde ne doit jamais changer le statut de la réponse.
function enTexte(valeur: object): string {
  try {
    return String(valeur);
  } catch {
    return Object.prototype.toString.call(valeur);
  }
}

export function erreurReduite(erreur: unknown): unknown {
  // Une fonction peut porter des propriétés, comme un objet : elle est réduite de même.
  if (erreur === null || (typeof erreur !== 'object' && typeof erreur !== 'function')) return erreur;
  const source = erreur as Record<string, unknown>;
  const copie = new Error(erreur instanceof Error ? erreur.message : enTexte(erreur));
  // Un objet sans pile : `finalhandler` répond hors production avec `String(err)`, que la copie reprend.
  Object.defineProperty(copie, 'stack', { value: typeof source.stack === 'string' ? source.stack : enTexte(erreur), enumerable: false, writable: true, configurable: true });
  for (const cle of PROPRIETES_DE_LA_REPONSE) {
    if (source[cle] !== undefined) Object.defineProperty(copie, cle, { value: source[cle], enumerable: false, writable: true, configurable: true });
  }
  return copie;
}

export const transmettreErreurReduite: express.ErrorRequestHandler = (erreur, _req, _res, next) => {
  next(erreurReduite(erreur));
};
