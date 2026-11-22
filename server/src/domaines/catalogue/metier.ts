import express from 'express';
import { prisma } from '../../db';
import { voitPrixAchatDevis } from '../../droits/visibilite';
import { estTauxTvaFrancais, REFUS_TAUX_TVA } from '../../commun/tva';
import { booleenStrict, nombreDecimalNonNegatif } from '../../commun/validation';

// --- Catalogue natif Iris ---
// Trois familles partagent la même forme (référence, nom, prix, TVA, catégorie) et sont
// donc servies par les mêmes routes, la famille étant un paramètre d'URL.
//
// Le typage passe par `Prisma.CataloguePrestationDelegate` volontairement élargi : les
// trois délégués Prisma ont des signatures génériques DIFFÉRENTES, si bien qu'une union
// des trois n'est plus appelable (TS2349 — « none of those signatures are compatible with
// each other »). On fixe donc UN type de délégué de référence pour la table de routage ;
// les champs propres à chaque famille (durée, stock, fabricant) sont ajoutés ensuite par
// `catalogueExtraPayload` et validés à l'exécution.
export type CatalogueFamily = 'prestations' | 'articles' | 'equipements';
type CatalogueDelegate = typeof prisma.cataloguePrestation;
export const catalogueModels: Record<CatalogueFamily, CatalogueDelegate> = {
  prestations: prisma.cataloguePrestation,
  articles: prisma.catalogueArticle as unknown as CatalogueDelegate,
  equipements: prisma.catalogueEquipement as unknown as CatalogueDelegate,
};

export function catalogueFamily(value: string): CatalogueFamily | null {
  return value === 'prestations' || value === 'articles' || value === 'equipements' ? value : null;
}

// Nombre positif ou nul d'une fiche (prix, stock ; durée par `catalogueEntier`), lu par la règle commune des saisies
// (#394) : virgule ou point décimal, au plus `chiffres` chiffres avant la virgule et `decimales` après (bornes des
// colonnes) ; la notation scientifique, un signe et une décimale en trop sont refusés, alors que `Number` les
// admettait (« 1e3 », « 12.345 », que PostgreSQL arrondissait sans le dire) et refusait « 18,75 ». Une valeur absente
// ou vide prend `defaut`, comme avant (`Number('')` valait 0). La TVA a sa propre lecture (`tauxTvaCatalogue`).
function catalogueNombre(value: unknown, champ: string, defaut = 0, chiffres = 10, decimales = 2): number {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return defaut;
  const n = nombreDecimalNonNegatif(value, chiffres, true, decimales);
  if (n === null) throw new Error(`${champ} invalide.`);
  return n;
}

// Prix d'achat facultatif : un champ laissé vide reste ABSENT. `Number('')` vaudrait 0, soit
// un achat gratuit, que la ligne de devis reprendrait ensuite comme prix d'achat prévu.
function cataloguePrixAchat(value: unknown): number | null {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '') ? null : catalogueNombre(value, "Prix d'achat");
}

// TVA d'une fiche : 20 % sans valeur, sinon un des taux français (commun/tva.ts), à la création comme à
// la modification ; une fiche enregistrée avant le lot « TVA française » garde son taux tant qu'elle
// n'est pas modifiée. Un champ vide est refusé, comme sur une ligne de devis ou de facture : `Number('')`
// vaudrait 0, soit une autoliquidation que personne n'a saisie (#324, N1). Lu à la virgule par la règle
// commune (#394), tout taux refusé, mal formé ou non français, reçoit le même message, qui dit les taux admis.
function tauxTvaCatalogue(value: unknown): number {
  if (value === undefined || value === null) return 20;
  const taux = nombreDecimalNonNegatif(value, 3, true, 2);
  if (taux === null || !estTauxTvaFrancais(taux)) throw new Error(REFUS_TAUX_TVA);
  return taux;
}

// Durée indicative en minutes, colonne entière : un entier positif ou nul de 9 chiffres au plus. « 12,5 », lu
// décimal, serait tronqué à 12 par la colonne sans le dire ; il est refusé, comme « 12.5 », que la lecture par
// `Number` d'avant #394 laissait déjà tronquer. Une valeur vide vaut 0, comme avant.
function catalogueEntier(value: unknown, champ: string): number {
  const n = catalogueNombre(value, champ, 0, 9, 2);
  if (!Number.isInteger(n)) throw new Error(`${champ} invalide.`);
  return n;
}

// Champs communs aux trois familles et aux mains d'œuvre : référence, nom, description,
// catégorie, TVA.
export function champsCommunsCatalogue(body: Record<string, unknown>) {
  const reference = String(body.reference || '').trim();
  const nom = String(body.nom || '').trim();
  if (!reference || !nom || reference.length > 80 || nom.length > 200) {
    throw new Error('Référence et nom sont obligatoires.');
  }
  return {
    reference,
    nom,
    description: body.description ? String(body.description).trim() : null,
    categorieId: body.categorieId ? String(body.categorieId) : null,
    tauxTva: tauxTvaCatalogue(body.tauxTva),
  };
}

// Champs communs aux trois familles, prix de vente compris. Celui d'une main d'œuvre suit la
// règle plus stricte de ses quatre prix (cf. main-oeuvre.ts).
export function cataloguePayload(body: Record<string, unknown>) {
  return {
    ...champsCommunsCatalogue(body),
    prixVenteHt: catalogueNombre(body.prixVenteHt, 'Prix de vente'),
  };
}

// Drapeau facultatif d'une fiche, lu en booléen strict (#587, volet catalogue ; #324) : clé absente,
// undefined ; true ou false, tels quels ; toute autre valeur, null compris, refusée en 400 (Error sans
// code, traduite par catalogueApiError) avant toute lecture en base. Le refus de null est un choix par
// défaut, à confirmer (règle 5 : l'option la plus restrictive, et la même lecture que booleenStrict partout).
export function drapeauCatalogue(body: Record<string, unknown>, cle: string): boolean | undefined {
  const lecture = booleenStrict(body, cle, { obligatoire: false });
  if (!lecture.ok) throw new Error(lecture.erreur);
  return lecture.valeur;
}

// Champs propres à une famille : une prestation a une durée, un article un stock, un
// équipement un fabricant (il devient un EquipementInstalle une fois posé chez un client).
export function catalogueExtraPayload(family: CatalogueFamily, body: Record<string, unknown>) {
  if (family === 'prestations') {
    return {
      unite: String(body.unite || 'unité'),
      dureeIndicativeMin: body.dureeIndicativeMin == null ? null : catalogueEntier(body.dureeIndicativeMin, 'Durée indicative'),
      prixAchatHt: cataloguePrixAchat(body.prixAchatHt),
    };
  }
  if (family === 'articles') {
    return {
      unite: String(body.unite || 'unité'),
      prixAchatHt: cataloguePrixAchat(body.prixAchatHt),
      // Clé absente : faux, comme avant, le PUT envoyant la fiche entière (choix par défaut, à confirmer ; la question
      // de la section 3 de la passation, bloc « Catalogue dans les devis (lot pilote 2, #161) », sur le prix d'achat
      // effacé par une modification qui l'omet, vaut aussi pour ce champ, #604).
      stockSuivi: drapeauCatalogue(body, 'stockSuivi') ?? false,
      stockActuel: catalogueNombre(body.stockActuel, 'Stock', 0, 9, 3),
    };
  }
  return { fabricant: body.fabricant ? String(body.fabricant).trim() : null, prixAchatHt: cataloguePrixAchat(body.prixAchatHt) };
}

// Le prix d'achat d'une fiche suit la règle du prix d'achat prévu des devis (voitPrixAchatDevis) :
// une clé d'intégration ne le lit qu'avec finances:read. Sinon, une clé catalogue:read retrouverait
// par la fiche le prix d'achat recopié dans une ligne de devis qu'elle lit (catalogueId).
export function ficheCataloguePourLecteur<T>(req: express.Request, valeur: T): T {
  if (voitPrixAchatDevis(req)) return valeur;
  const masquer = (fiche: unknown) => {
    if (!fiche || typeof fiche !== 'object') return fiche;
    const { prixAchatHt: _masque, ...reste } = fiche as Record<string, unknown>;
    return reste;
  };
  return (Array.isArray(valeur) ? valeur.map(masquer) : masquer(valeur)) as T;
}
