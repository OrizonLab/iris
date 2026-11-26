import { Prisma } from '@prisma/client';

// Convertit récursivement les Decimal Prisma en nombres pour la sérialisation JSON
// (sinon ils seraient sérialisés en chaînes côté client). Les montants sont stockés
// en Decimal (précis) en base, et exposés en `number` à l'API.
export function decimalToNumber(value: any): any {
  if (value === null || value === undefined) return value;
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(decimalToNumber);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = decimalToNumber(value[key]);
    }
    return out;
  }
  return value;
}

export const PLAFOND_MONTANT = 9_999_999_999.99;
export class FactureInvalideError extends Error {}

export type LigneTaxable = { tauxTva: unknown; totalHt: unknown };
export const tauxUtilises = (lignes: LigneTaxable[]) => [...new Set(lignes.map(ligne => Number(ligne.tauxTva)))];
// Somme exacte de montants au centime (#684, N1 de l'audit des montants de #681, lot AC) : la base compare les totaux d'une
// pièce émise à des sommes exactes ; une somme en nombres à virgule, puis arrondie (`centimes`), peut s'en écarter d'un
// centime sur des milliers de lignes (ligne de tête de 8 589 934 592,00 € suivie de 20 000 lignes de 0,03 € : 0,01 € de
// trop), et la base refuserait alors la pièce. Chaque terme est un montant au centime ; leur somme exacte l'est aussi, et le
// retour au centime ne fait que le garantir (`tvaDuTaux` refuse une base à plus de deux décimales). Tableau plutôt
// qu'arguments étalés : une pièce peut avoir des milliers de lignes.
export const sommeMontants = (termes: readonly unknown[]): number =>
  termes.reduce<Prisma.Decimal>((somme, terme) => somme.plus(Number(terme)), new Prisma.Decimal(0))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
export const baseHtDuTaux = (lignes: LigneTaxable[], taux: number) => sommeMontants(lignes.filter(ligne => Number(ligne.tauxTva) === taux).map(ligne => ligne.totalHt));
export const tvaDuTaux = (lignes: LigneTaxable[], taux: number) => {
  const baseCentimes = entierDecimal(baseHtDuTaux(lignes, taux), 2);
  const millièmesTaux = entierDecimal(taux, 3);
  return Number((baseCentimes * millièmesTaux + 50000n) / 100000n) / 100;
};
// Totaux d'une pièce chiffrée (facture, facture au temps passé, devis) depuis ses lignes déjà arrondies au centime : HT,
// somme exacte des lignes ; TVA arrondie sur la base HT cumulée de chaque taux, jamais ligne par ligne (règle C-07) ;
// TTC = HT + TVA. Seules les sommes changent (#684) : les arrondis restent ceux de la ligne et de chaque taux.
export const totauxPiece = (lignes: LigneTaxable[]) => {
  const totalHt = sommeMontants(lignes.map(ligne => ligne.totalHt));
  const totalTva = sommeMontants(tauxUtilises(lignes).map(taux => tvaDuTaux(lignes, taux)));
  return { totalHt, totalTva, totalTtc: sommeMontants([totalHt, totalTva]) };
};

// Arrondi commercial exact au centime d’une ligne : quantité (au millième) × PU HT
// (au centime). Les montants de facture et d’avoir sont toujours positifs ; leur sens est
// porté par le type du document. Aucun flottant ne participe à ce calcul.
function entierDecimal(value: unknown, decimales: number): bigint {
  const texte = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const expression = new RegExp(`^(\\d+)(?:[,.](\\d{1,${decimales}}))?$`);
  const resultat = expression.exec(texte);
  if (!resultat) throw new FactureInvalideError('Montant de ligne invalide.');
  return BigInt(resultat[1]) * 10n ** BigInt(decimales) + BigInt((resultat[2] || '').padEnd(decimales, '0') || '0');
}

export function arrondiCommercialLigneHt(quantite: unknown, prixUnitaireHt: unknown): number {
  const milliemes = entierDecimal(quantite, 3);
  const centimesPu = entierDecimal(prixUnitaireHt, 2);
  // Le produit est exprimé en millièmes de centime. Ajouter 500 puis diviser par 1 000
  // applique exactement « moitié vers le haut » pour les valeurs positives.
  return Number((milliemes * centimesPu + 500n) / 1000n) / 100;
}

export function centimesTtcLigne(totalHt: number, tauxTva: unknown): number {
  const centimesHt = entierDecimal(totalHt, 2);
  const millièmesTaux = entierDecimal(tauxTva, 3);
  // (100 % + taux) est exprimé en millièmes de pourcentage. L'arrondi final est
  // commercial, identique à la ligne HT, y compris aux taux 10 % et 5,5 %.
  return Number((centimesHt * (100000n + millièmesTaux) + 50000n) / 100000n) / 100;
}

export const centimes = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Sommes exactes de montants et de quantités (#198). Additionner des nombres à virgule
// dépend de l'ordre des termes et peut s'écarter de la somme exacte : 12,50 € devient
// 12,4999…, s'affiche 12 € une fois arrondi à l'euro, ou déclenche à tort une alerte de
// dépassement. Montants, heures et taux ont deux décimales en base ; l'écriture la plus
// courte de leur nombre, que lit Prisma.Decimal, redonne exactement ces décimales. Le
// calcul se fait donc en décimal exact. Un total partiel garde au plus quatre décimales et
// bien moins de quinze chiffres : repassé en nombre, il se relit exactement, ce qui permet
// de cumuler terme à terme (`total = sommeExacte(total, terme)`).
export const sommeExacte = (...termes: unknown[]): number =>
  termes.reduce<Prisma.Decimal>((somme, terme) => somme.plus(Number(terme)), new Prisma.Decimal(0)).toNumber();
export const differenceExacte = (a: unknown, b: unknown): number => new Prisma.Decimal(Number(a)).minus(Number(b)).toNumber();
// Coût d'une ligne de main-d'œuvre : heures × taux horaire chargé figé sur la ligne, en décimal exact, arrondi au
// centime, moitié vers le haut. C'est la convention unique du coût de la main-d'œuvre, partout (chantier, intervention,
// SAV, contrat) : chaque ligne est arrondie au centime avant d'être additionnée (réponse de Nelson du 24-11-2026 à la
// question « Quelle convention retenir partout ? » : « Arrindir chaque ligne » ; lot AB). Une ligne est une saisie
// d'heures (un pointage, une heure d'intervention), et « moitié vers le haut » (0,005 € donne 0,01 €) suit les autres
// arrondis de montant d'Iris : deux lectures retenues, à confirmer avec la validation comptable. Les durées ne sont
// jamais arrondies (#253, point 2) ; les sommes de lignes restent exactes (sommeExacte).
export const coutLigneHeuresAuCentime = (heures: Prisma.Decimal.Value, taux: Prisma.Decimal.Value): Prisma.Decimal =>
  new Prisma.Decimal(heures).mul(taux).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
// La même, pour des heures et un taux déjà repassés en nombre (decimalToNumber) : deux décimales en base, que relit
// exactement l'écriture la plus courte du nombre.
export const coutLigneHeures = (heures: unknown, taux: unknown): number =>
  coutLigneHeuresAuCentime(Number(heures), Number(taux)).toNumber();
// a × b ÷ c en décimal (précision 20), sans repasser par un nombre entre le produit et le
// quotient : retombe exactement sur a quand b = c.
export const regleDeTroisExacte = (a: unknown, b: unknown, c: unknown): number =>
  new Prisma.Decimal(Number(a)).times(Number(b)).div(Number(c)).toNumber();
