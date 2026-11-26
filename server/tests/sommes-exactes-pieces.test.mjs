// Lot AF : sommes exactes des montants d'une pièce (#684, N1 de l'audit des montants de #681, lot AC ; cadrage v2 du 26-11-2026,
// contrôlé « prêt à coder » par le controleur-coherence en mode 1 : sections « Périmètre », « Critères métier observables » et
// « Tests »). Tests unitaires des fonctions pures, appelées dans le serveur compilé (dist), sans base de données ; la cohérence en
// base (lot AC) du même cas théorique est éprouvée par sommes-exactes-pieces-coherence.test.mjs.
//
// Règle éprouvée (cadrage, § 1) : les sommes de montants d'une pièce chiffrée (facture saisie, facture au temps passé, avoir, devis,
// écritures, budgets de l'affaire née d'un devis) se font en décimal exact, et le résultat reste au centime. Aucune règle d'arrondi
// ne change (règle C-07, gardée dans le code) : chaque ligne reste arrondie au centime (arrondiCommercialLigneHt), la TVA reste
// arrondie sur la base HT cumulée de chaque taux (tvaDuTaux), le plafond (PLAFOND_MONTANT) et son message restent ceux d'avant.
// Fonctions éprouvées (noms donnés par Claude Code) :
//  - commun/montants : sommeMontants, baseHtDuTaux, totauxPiece (HT = somme exacte des HT de lignes ; TVA = somme des TVA de chaque
//    taux ; TTC = HT + TVA) ;
//  - factures/metier : ventilationTvaDerivee (TTC d'un taux en somme exacte) ;
//  - devis/metier : totauxDevis (sur totauxPiece, refus du plafond gardé) et budgetsConversionDevis (matériel vendu, main-d'œuvre
//    vendue, coût matériel prévu, extraits de la conversion d'un devis en chantier, C1 du contrôle de mode 1) ;
//  - comptabilite/metier : montantsDesEcritures (clés CLIENT, VENTE_PRESTATION, VENTE_ARTICLE, TVA:<taux>), extraite
//    d'ecrituresPourPiece.
//
// Cas théorique (critère « Cas théorique » ; règle 4 de la méthode : construit, aucune donnée réelle ; inatteignable par l'API, dont
// la limite de 100 Ko du corps borne une facture à environ 1 550 lignes et un devis à 1 969, alors qu'une dérive en exige au moins
// 5 460, N1 du contrôle) : une ligne de 8 589 934 592,00 € HT (2^33 €) EN TÊTE (ordre 0), puis 20 000 lignes de 0,03 € HT, au taux de
// 0 %. Somme exacte : 8 589 935 192,00 €. La somme en nombres à virgule, arrondie au centime (`reduce` puis `centimes`, le code
// d'avant), donne 8 589 935 192,01 € : à ce niveau, chaque ajout de 0,03 € s'arrondit à 15 729 fois 2^-19 € (0,030000686… €). Avec des
// lignes de 0,07 €, l'écart change de sens : 8 589 935 992,00 € exacts, contre 8 589 935 991,99 € (36 700 fois 2^-19 €, 0,069999694… €
// par ajout). La grande ligne doit être en tête (N2 du contrôle) : petites lignes d'abord, la somme en flottants tombe juste et le
// mutant survit (le témoin le vérifie). Le TTC du cas reste sous le plafond (9 999 999 999,99 €).
//
// Mutants que ce fichier tue (« somme en flottants » : retour à `reduce` + `centimes`), chacun dans les deux sens (0,03 € et 0,07 €) :
// sommeMontants ; baseHtDuTaux (et, par elle, ventilationTvaDerivee et tvaDuTaux) ; HT de totauxPiece ; totauxDevis ramené au code
// d'avant ; ventes de montantsDesEcritures (VENTE_PRESTATION, VENTE_ARTICLE : l'écriture client, au TTC exact, ne s'équilibre plus
// avec elles) ; matériel vendu (et, par lui, main-d'œuvre vendue) et coût matériel prévu de budgetsConversionDevis. Plafond de
// totauxDevis : « > » devenu « ≥ », et refus retiré. Règles d'arrondi (cas réaliste) : TVA ligne par ligne, TVA tronquée, TTC égal à
// la somme des TTC de lignes, coût prévu arrondi une seule fois, prix d'achat de la main-d'œuvre ignoré.
// Mutants équivalents, déclarés comme tels (cadrage, N3) : les sommes de 2, 3 ou 4 termes au centime, sous le plafond, ne peuvent pas
// dériver (TTC = HT + TVA d'une pièce ou d'un taux, factures/metier.ts:76, factures/routes.ts:246-247, factures/tempsPasse.ts:228-229,
// devis/metier.ts:73-74 ; TVA d'une pièce, somme des TVA de ses taux, quatre au plus ; main-d'œuvre vendue, différence de deux
// montants) : le dernier test le montre, borne d'erreur écrite à côté ; leur conversion relève de l'uniformité. Retour au centime de
// sommeMontants retiré : équivalent tant que chaque terme est au centime, ce que garantissent les arrondis de ligne. Sommes des
// routes (facture saisie, facture au temps passé) : elles passent par totauxPiece et ventilationTvaDerivee, éprouvées ici ; leur
// retour au code d'avant n'est pas atteignable par l'API (limite du corps, ci-dessus) et ne se tue donc par aucun test HTTP.
//
// Montants (classés C : CLAUDE.md, « un test manquant qui touche un montant ») : chaque attendu est écrit en dur, en centimes, et
// recalculé par le témoin en entiers (BigInt), hors de l'application ; la lecture écartée par chaque attendu est écrite en
// commentaire à côté de lui, et calculée par le modèle du code d'avant (`avant`, copie des sommes de main 9791f66) ou par le témoin,
// distincte de l'attendu. Chaque résultat de l'application est relu en centimes depuis son écriture décimale la plus courte : plus de
// deux décimales y est refusé (N5 du contrôle : tvaDuTaux ne doit jamais recevoir de base à plus de deux décimales).
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

const { Prisma } = await import('@prisma/client');
const { PLAFOND_MONTANT, sommeMontants, baseHtDuTaux, tvaDuTaux, totauxPiece } = await import('../dist/src/commun/montants.js');
const { ventilationTvaDerivee } = await import('../dist/src/domaines/factures/metier.js');
const { totauxDevis, budgetsConversionDevis, DevisSaisieError } = await import('../dist/src/domaines/devis/metier.js');
const { montantsDesEcritures } = await import('../dist/src/domaines/comptabilite/metier.js');

const TITRE = 'Sommes exactes des montants d’une pièce (lot AF, #684 N1) : totaux, ventilation, écritures et budgets d’une affaire en somme exacte des lignes, au centime, sans changer aucun arrondi ; cas théorique de 20 001 lignes dans les deux sens ; cas réaliste inchangé';
const REFUS_PLAFOND_DEVIS = 'Montant de devis hors des limites acceptées.';

// --- Témoin en entiers (centimes), hors de l'application ---
const exact = {
  // Texte décimal positif, au plus `decimales` décimales → entier d'unités (centimes pour 2, millièmes pour 3).
  unites: (texte, decimales) => {
    const m = /^(\d+)(?:\.(\d+))?$/.exec(String(texte));
    assert.ok(m && (m[2] ?? '').length <= decimales, `« ${texte} » : nombre décimal à ${decimales} décimales au plus`);
    return BigInt(m[1]) * 10n ** BigInt(decimales) + BigInt((m[2] ?? '').padEnd(decimales, '0') || '0');
  },
  // TVA d'une base (centimes) à un taux (en %), arrondie au centime moitié vers le haut (tvaDuTaux, inchangée).
  tva: (base, taux) => (base * exact.unites(taux, 3) + 50000n) / 100000n,
  // Lecture écartée : TVA tronquée.
  tvaTronquee: (base, taux) => (base * exact.unites(taux, 3)) / 100000n,
  // TTC d'une ligne arrondi au centime (centimesTtcLigne, inchangée).
  ttcLigne: (ht, taux) => (ht * (100000n + exact.unites(taux, 3)) + 50000n) / 100000n,
  // HT d'une ligne : quantité (au millième) × prix (au centime), arrondi au centime moitié vers le haut (arrondiCommercialLigneHt).
  ligneHt: (quantite, prix) => (exact.unites(quantite, 3) * exact.unites(prix, 2) + 500n) / 1000n,
  somme: (valeurs) => valeurs.reduce((s, v) => s + v, 0n),
};
// Centimes → le nombre que manipule l'application (le même que relit Prisma.Decimal#toNumber depuis le texte décimal).
const euros = (centimes) => Number(centimes) / 100;
// Montant au format français, pour les messages.
const fr = (centimes) => `${(Number(centimes) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
// Résultat de l'application relu en centimes : un nombre, positif, dont l'écriture la plus courte porte au plus deux décimales.
const lu = (valeur, quoi) => {
  assert.equal(typeof valeur, 'number', `${quoi} : un nombre (lu ${typeof valeur})`);
  const texte = String(valeur);
  assert.match(texte, /^\d+(\.\d{1,2})?$/, `${quoi} : au plus deux décimales (lu ${texte})`);
  return exact.unites(texte, 2);
};
const luTotaux = (t, quoi) => [lu(t.totalHt, `${quoi}, HT`), lu(t.totalTva, `${quoi}, TVA`), lu(t.totalTtc, `${quoi}, TTC`)];
const luVentilation = (v, quoi) => v.map((x) => [x.tauxTva, lu(x.totalHt, `${quoi}, HT à ${x.tauxTva} %`), lu(x.totalTva, `${quoi}, TVA à ${x.tauxTva} %`), lu(x.totalTtc, `${quoi}, TTC à ${x.tauxTva} %`)]);
// Écritures relues dans l'ordre de la table (ordre des écritures enregistrées) : [clé, débit, crédit, taux ou null].
const luEcritures = (montants, quoi) => {
  assert.ok(montants instanceof Map, `${quoi} : une table des montants par clé`);
  return [...montants.entries()].map(([cle, m]) => [cle, lu(m.debit, `${quoi}, ${cle} au débit`), lu(m.credit, `${quoi}, ${cle} au crédit`), m.tauxTva ?? null]);
};
const equilibre = (ecritures) => exact.somme(ecritures.map(([, debit, credit]) => debit - credit));

// --- Le code d'avant (sommes de main 9791f66), lectures écartées : sommes en nombres à virgule, arrondies au centime ---
const centimesAvant = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const sommeAvant = (valeurs) => centimesAvant(valeurs.reduce((s, v) => s + Number(v), 0));
const tauxDe = (lignes) => [...new Set(lignes.map((l) => Number(l.tauxTva)))];
const avant = {
  baseHtDuTaux: (lignes, taux) => sommeAvant(lignes.filter((l) => Number(l.tauxTva) === taux).map((l) => l.totalHt)),
  tvaDuTaux: (lignes, taux) => euros(exact.tva(lu(avant.baseHtDuTaux(lignes, taux), 'base d’avant'), taux)),
  ventilation: (lignes) => tauxDe(lignes).sort((a, b) => a - b).map((tauxTva) => {
    const totalHt = avant.baseHtDuTaux(lignes, tauxTva);
    const totalTva = avant.tvaDuTaux(lignes, tauxTva);
    return { tauxTva, totalHt, totalTva, totalTtc: centimesAvant(totalHt + totalTva) };
  }),
  // Facture saisie ligne par ligne et facture au temps passé : TVA, somme de la ventilation.
  totauxFacture: (lignes) => {
    const totalHt = sommeAvant(lignes.map((l) => l.totalHt));
    const totalTva = centimesAvant(avant.ventilation(lignes).reduce((s, v) => s + v.totalTva, 0));
    return { totalHt, totalTva, totalTtc: centimesAvant(totalHt + totalTva) };
  },
  totauxDevis: (lignes) => {
    const totalHt = centimesAvant(lignes.reduce((t, l) => t + l.totalHt, 0));
    const totalTva = centimesAvant(tauxDe(lignes).reduce((t, taux) => t + avant.tvaDuTaux(lignes, taux), 0));
    return { totalHt, totalTva, totalTtc: centimesAvant(totalHt + totalTva) };
  },
  ecritures: (piece) => {
    const montants = new Map([['CLIENT', { debit: Number(piece.totalTtc), credit: 0 }]]);
    for (const nature of ['PRESTATION', 'ARTICLE']) {
      const ht = sommeAvant(piece.lignes.filter((l) => l.nature === nature).map((l) => l.totalHt));
      if (ht) montants.set(`VENTE_${nature}`, { debit: 0, credit: ht });
    }
    for (const v of piece.ventilationTva) if (Number(v.totalTva)) montants.set(`TVA:${Number(v.tauxTva)}`, { debit: 0, credit: Number(v.totalTva), tauxTva: Number(v.tauxTva) });
    return montants;
  },
  budgets: (devis) => {
    const budgetMaterielVendu = sommeAvant(devis.lignes.filter((l) => l.nature === 'FOURNITURE').map((l) => l.totalHt));
    const budgetMainOeuvreVendu = centimesAvant(Number(devis.totalHt) - budgetMaterielVendu);
    const coutMaterielPrevu = centimesAvant(devis.lignes.reduce((t, l) => t + (l.prixAchatUnitaireHt === null ? 0 : euros(exact.ligneHt(String(l.quantite), String(l.prixAchatUnitaireHt)))), 0));
    return { budgetMaterielVendu, budgetMainOeuvreVendu, coutMaterielPrevu };
  },
};

// --- Jeu de montants (centimes) ---
// Cas théorique du cadrage : la grande ligne de 8 589 934 592,00 € en tête (ordre 0), puis 20 000 petites lignes identiques.
const TETE = 858993459200n;
const NOMBRE = 20_000;
// Les deux sens : [petite ligne, somme exacte (attendu), somme en flottants arrondie au centime (lecture écartée)].
const SENS = [
  { nom: '0,03 €', petite: 3n, exacte: 858993519200n, flottants: 858993519201n }, // 8 589 935 192,00 € ; écarté : 8 589 935 192,01 €
  { nom: '0,07 €', petite: 7n, exacte: 858993599200n, flottants: 858993599199n }, // 8 589 935 992,00 € ; écarté : 8 589 935 991,99 €
];
// Plafond d'un devis (PLAFOND_MONTANT, 9 999 999 999,99 €), même dérive, au taux de 0 % (TTC = HT) :
//  - admis : 9 999 999 399,99 € + 20 000 × 0,03 € = 9 999 999 999,99 €, le plafond exact, admis (« TTC > plafond » refusé seul) ;
//    lectures écartées : somme en flottants, 10 000 000 000,00 €, refusée ; plafond au sens large (« ≥ »), refusé ;
//  - refusé : 9 999 998 600,00 € + 20 000 × 0,07 € = 10 000 000 000,00 €, refusé au message du plafond ; lectures écartées : somme en
//    flottants, 9 999 999 999,99 €, admise ; plafond retiré, admis.
const PLAFOND = {
  admis: { tete: 999999939999n, petite: 3n, exacte: 999999999999n, flottants: 1000000000000n },
  refuse: { tete: 999999860000n, petite: 7n, exacte: 1000000000000n, flottants: 999999999999n },
};
// Variante à 20 % (TVA arrondie sur la base exacte) : 4 294 967 296,03 € en tête, puis 20 000 × 0,03 €. Sous 2^33 €, chaque ajout de
// 0,03 € perd 0,28 fois 2^-20 € : la somme en flottants donne un centime de moins. Base exacte 4 294 967 896,03 € ; TVA 858 993 579,206 €
// → 858 993 579,21 € ; TTC 5 153 961 475,24 €. Lectures écartées : base en flottants 4 294 967 896,02 € (TVA 858 993 579,204 € →
// 858 993 579,20 €, TTC 5 153 961 475,22 €) ; TVA tronquée (858 993 579,20 €) ; TVA ligne par ligne (858 993 459,21 € + 20 000 ×
// 0,01 € = 858 993 659,21 €).
const VARIANTE_20 = {
  tete: 429496729603n, petite: 3n, taux: 20,
  ht: 429496789603n, tva: 85899357921n, ttc: 515396147524n,
  flottants: { ht: 429496789602n, tva: 85899357920n, ttc: 515396147522n },
};
const lignesTheoriques = (tete, petite, { taux = 0, nature = 'PRESTATION', nombre = NOMBRE } = {}) => [
  { tauxTva: taux, totalHt: euros(tete), nature },
  ...Array.from({ length: nombre }, () => ({ tauxTva: taux, totalHt: euros(petite), nature })),
];
// Une pièce relue en base (émission : ecrituresPourPiece reçoit la facture lue par Prisma), montants en Prisma.Decimal.
const D = (centimes) => new Prisma.Decimal(euros(centimes));
const pieceEnBase = (lignes, { ht, tva, ttc, taux }) => ({
  totalTtc: D(ttc),
  lignes: lignes.map((l) => ({ nature: l.nature, tauxTva: new Prisma.Decimal(l.tauxTva), totalHt: new Prisma.Decimal(l.totalHt) })),
  ventilationTva: [{ tauxTva: new Prisma.Decimal(taux), totalHt: D(ht), totalTva: D(tva), totalTtc: D(ttc) }],
});
// Devis relu en base (conversion en chantier : budgetsConversionDevis reçoit le devis lu par Prisma), montants en Prisma.Decimal.
const devisEnBase = (lignes) => {
  const enBase = lignes.map((l) => ({
    nature: l.nature, quantite: new Prisma.Decimal(l.quantite), totalHt: new Prisma.Decimal(euros(l.ht)),
    prixAchatUnitaireHt: l.prixAchat === null ? null : new Prisma.Decimal(euros(l.prixAchat)),
  }));
  return { totalHt: D(exact.somme(lignes.map((l) => l.ht))), lignes: enBase };
};
// Devis théorique : la grande fourniture en tête (prix d'achat égal à son prix de vente), 20 000 petites fournitures (de même), puis
// une main-d'œuvre de 100,00 € sans prix d'achat. Matériel vendu et coût prévu : somme exacte des fournitures ; main-d'œuvre vendue :
// 100,00 €. Lectures écartées (somme en flottants) : matériel et coût à 8 589 935 192,01 € et main-d'œuvre à 99,99 € (0,03 €) ;
// matériel et coût à 8 589 935 991,99 € et main-d'œuvre à 100,01 € (0,07 €).
const MAIN_OEUVRE_THEORIQUE = 10000n;
const devisTheorique = (petite) => devisEnBase([
  { nature: 'FOURNITURE', quantite: 1, ht: TETE, prixAchat: TETE },
  ...Array.from({ length: NOMBRE }, () => ({ nature: 'FOURNITURE', quantite: 1, ht: petite, prixAchat: petite })),
  { nature: 'MAIN_OEUVRE', quantite: 1, ht: MAIN_OEUVRE_THEORIQUE, prixAchat: null },
]);

// Cas réaliste (quelques lignes, quatre taux, deux natures) : HT de chaque ligne arrondi au centime par le témoin.
const REALISTE = [
  { nature: 'PRESTATION', tauxTva: 20, quantite: '1.333', prix: '45.50' }, // 60,6515 € → 60,65 €
  { nature: 'ARTICLE', tauxTva: 20, quantite: '3', prix: '12.34' }, // 37,02 €
  { nature: 'PRESTATION', tauxTva: 10, quantite: '2.5', prix: '0.07' }, // 0,175 € → 0,18 €
  { nature: 'ARTICLE', tauxTva: 10, quantite: '1', prix: '19.99' }, // 19,99 €
  { nature: 'PRESTATION', tauxTva: 5.5, quantite: '1', prix: '0.10' }, // 0,10 €
  { nature: 'ARTICLE', tauxTva: 5.5, quantite: '1', prix: '0.10' }, // 0,10 €
  { nature: 'ARTICLE', tauxTva: 0, quantite: '1', prix: '7.77' }, // 7,77 €
].map((l) => ({ ...l, ht: exact.ligneHt(l.quantite, l.prix) }));
const lignesRealistes = () => REALISTE.map((l) => ({ nature: l.nature, tauxTva: l.tauxTva, totalHt: euros(l.ht) }));
// Ventilation attendue [taux, HT, TVA, TTC] : 0 % : 7,77 € ; 5,5 % : 0,20 € → TVA 0,011 € → 0,01 € (lecture écartée : ligne par ligne,
// 2 × 0,0055 € → 0,02 €) ; 10 % : 20,17 € → TVA 2,017 € → 2,02 € (écartée : tronquée, 2,01 €) ; 20 % : 97,67 € → TVA 19,534 € → 19,53 €.
const VENTILATION_REALISTE = [[0, 777n, 0n, 777n], [5.5, 20n, 1n, 21n], [10, 2017n, 202n, 2219n], [20, 9767n, 1953n, 11720n]];
// Totaux attendus : 125,81 € HT, 21,56 € de TVA, 147,37 € TTC. Lectures écartées : TVA ligne par ligne 21,57 € ; TVA tronquée 21,55 € ;
// TTC égal à la somme des TTC de lignes, 147,38 €.
const TOTAUX_REALISTE = [12581n, 2156n, 14737n];
// Écritures attendues, dans l'ordre enregistré : client au TTC ; ventes par nature (prestations 60,65 + 0,18 + 0,10 = 60,93 € ; articles
// 37,02 + 19,99 + 0,10 + 7,77 = 64,88 €) ; TVA par taux non nul, dans l'ordre de la ventilation. Lecture écartée : nature mal lue (tout
// le HT, 125,81 €, en prestations).
const ECRITURES_REALISTE = [
  ['CLIENT', 14737n, 0n, null], ['VENTE_PRESTATION', 0n, 6093n, null], ['VENTE_ARTICLE', 0n, 6488n, null],
  ['TVA:5.5', 0n, 1n, 5.5], ['TVA:10', 0n, 202n, 10], ['TVA:20', 0n, 1953n, 20],
];
// Devis réaliste (conversion en chantier) : deux fournitures de 1,5 × 12,34 € = 18,51 €, au prix d'achat de 0,03 € (1,5 × 0,03 € =
// 0,045 € → 0,05 € chacune, arrondie comme une ligne) ; une fourniture de 2 × 25,00 € = 50,00 € sans prix d'achat (zéro, réponse
// « Zéro » du 30-10-2026) ; une main-d'œuvre de 2,5 × 45,50 € = 113,75 € au prix d'achat de 30,00 € (75,00 €, ajoutés au coût prévu,
// réponse « Ajouté au coût prévu » du même jour). Attendus : matériel vendu 87,02 € (lecture écartée : toutes les lignes, 200,77 €) ;
// main-d'œuvre vendue 113,75 € ; coût matériel prévu 75,10 € (lectures écartées : arrondi une seule fois, 0,09 € + 75,00 € = 75,09 € ;
// prix d'achat de la main-d'œuvre ignoré, 0,10 €).
const DEVIS_REALISTE = [
  { nature: 'FOURNITURE', quantite: '1.5', prix: '12.34', prixAchat: '0.03' },
  { nature: 'FOURNITURE', quantite: '1.5', prix: '12.34', prixAchat: '0.03' },
  { nature: 'FOURNITURE', quantite: '2', prix: '25', prixAchat: null },
  { nature: 'MAIN_OEUVRE', quantite: '2.5', prix: '45.50', prixAchat: '30' },
].map((l) => ({ ...l, ht: exact.ligneHt(l.quantite, l.prix), prixAchat: l.prixAchat === null ? null : exact.unites(l.prixAchat, 2) }));
const BUDGETS_REALISTE = { budgetMaterielVendu: 8702n, budgetMainOeuvreVendu: 11375n, coutMaterielPrevu: 7510n };
const luBudgets = (b, quoi) => ({
  budgetMaterielVendu: lu(b.budgetMaterielVendu, `${quoi}, matériel vendu`),
  budgetMainOeuvreVendu: lu(b.budgetMainOeuvreVendu, `${quoi}, main-d’œuvre vendue`),
  coutMaterielPrevu: lu(b.coutMaterielPrevu, `${quoi}, coût matériel prévu`),
});

describe(TITRE, () => {
  // Règle du rédacteur des tests (montants) : chaque attendu recalculé en entiers, hors de l'application, et chaque lecture écartée
  // calculée et distincte de l'attendu ; la grande ligne en tête (N2 du contrôle).
  test('témoin des montants : 8 589 934 592,00 € en tête puis 20 000 lignes de 0,03 € ou de 0,07 € font 8 589 935 192,00 € ou 8 589 935 992,00 € ; la somme en flottants arrondie au centime s’en écarte d’un centime dans chaque sens, et tombe juste petites lignes d’abord ; plafond, variante à 20 %, cas réaliste recalculés, chaque lecture écartée distincte', () => {
    for (const s of SENS) {
      assert.equal(TETE + BigInt(NOMBRE) * s.petite, s.exacte, `${s.nom} : somme exacte`);
      const lignes = lignesTheoriques(TETE, s.petite);
      assert.equal(lignes.length, NOMBRE + 1);
      assert.equal(lignes[0].totalHt, 8589934592, `${s.nom} : la grande ligne est en tête (ordre 0)`);
      // Lecture écartée : la somme en flottants arrondie au centime (code d'avant), un centime à côté.
      assert.equal(lu(sommeAvant(lignes.map((l) => l.totalHt)), `${s.nom}, flottants`), s.flottants, `${s.nom} : somme en flottants ${fr(s.flottants)}`);
      // Non arrondie, elle porte plus de deux décimales (N5 : tvaDuTaux la refuserait).
      assert.doesNotMatch(String(lignes.reduce((t, l) => t + l.totalHt, 0)), /^\d+(\.\d{1,2})?$/, `${s.nom} : somme en flottants non arrondie`);
      // Petites lignes d'abord, la somme en flottants tombe juste : le cas ne départagerait rien (N2 du contrôle).
      assert.equal(lu(sommeAvant([...lignes.slice(1), lignes[0]].map((l) => l.totalHt)), `${s.nom}, petites lignes d’abord`), s.exacte, `${s.nom} : petites lignes d’abord, la somme en flottants tombe juste`);
    }
    assert.deepEqual(SENS.map((s) => s.flottants - s.exacte), [1n, -1n], 'un centime de trop avec 0,03 €, un de moins avec 0,07 €');

    // Plafond d'un devis.
    assert.equal(lu(PLAFOND_MONTANT, 'plafond'), 999999999999n, 'plafond : 9 999 999 999,99 €');
    for (const [nom, p] of Object.entries(PLAFOND)) {
      assert.equal(p.tete + BigInt(NOMBRE) * p.petite, p.exacte, `plafond ${nom} : somme exacte`);
      assert.equal(lu(sommeAvant(lignesTheoriques(p.tete, p.petite).map((l) => l.totalHt)), `plafond ${nom}`), p.flottants, `plafond ${nom} : somme en flottants`);
    }
    assert.deepEqual([PLAFOND.admis.exacte <= 999999999999n, PLAFOND.admis.flottants <= 999999999999n], [true, false], 'plafond atteint exactement : admis ; en flottants : refusé');
    assert.deepEqual([PLAFOND.refuse.exacte <= 999999999999n, PLAFOND.refuse.flottants <= 999999999999n], [false, true], 'plafond dépassé d’un centime : refusé ; en flottants : admis');

    // Variante à 20 %.
    const v = VARIANTE_20;
    assert.equal(v.tete + BigInt(NOMBRE) * v.petite, v.ht);
    assert.deepEqual([exact.tva(v.ht, 20), v.ht + exact.tva(v.ht, 20)], [v.tva, v.ttc]);
    const lignes20 = lignesTheoriques(v.tete, v.petite, { taux: 20 });
    assert.equal(lu(sommeAvant(lignes20.map((l) => l.totalHt)), 'variante à 20 %, flottants'), v.flottants.ht);
    assert.deepEqual([exact.tva(v.flottants.ht, 20), v.flottants.ht + exact.tva(v.flottants.ht, 20)], [v.flottants.tva, v.flottants.ttc]);
    const ecarteesTva20 = { 'base en flottants': v.flottants.tva, 'TVA tronquée': exact.tvaTronquee(v.ht, 20), 'TVA ligne par ligne': exact.tva(v.tete, 20) + BigInt(NOMBRE) * exact.tva(v.petite, 20) };
    assert.deepEqual(ecarteesTva20, { 'base en flottants': 85899357920n, 'TVA tronquée': 85899357920n, 'TVA ligne par ligne': 85899365921n });
    for (const [lecture, tva] of Object.entries(ecarteesTva20)) assert.notEqual(tva, v.tva, `variante à 20 %, lecture écartée « ${lecture} »`);
    assert.ok(v.ttc <= 999999999999n, 'variante à 20 % sous le plafond');

    // Cas réaliste.
    assert.deepEqual(REALISTE.map((l) => l.ht), [6065n, 3702n, 18n, 1999n, 10n, 10n, 777n]);
    const ventilation = [0, 5.5, 10, 20].map((taux) => {
      const base = exact.somme(REALISTE.filter((l) => l.tauxTva === taux).map((l) => l.ht));
      return [taux, base, exact.tva(base, taux), base + exact.tva(base, taux)];
    });
    assert.deepEqual(ventilation, VENTILATION_REALISTE);
    const ht = exact.somme(ventilation.map((x) => x[1])); const tva = exact.somme(ventilation.map((x) => x[2]));
    assert.deepEqual([ht, tva, ht + tva], TOTAUX_REALISTE);
    const ecarteesRealiste = {
      'TVA ligne par ligne': exact.somme(REALISTE.map((l) => exact.tva(l.ht, l.tauxTva))),
      'TVA tronquée': exact.somme(ventilation.map(([taux, base]) => exact.tvaTronquee(base, taux))),
      'TTC des lignes': exact.somme(REALISTE.map((l) => exact.ttcLigne(l.ht, l.tauxTva))),
    };
    assert.deepEqual(ecarteesRealiste, { 'TVA ligne par ligne': 2157n, 'TVA tronquée': 2155n, 'TTC des lignes': 14738n });
    assert.notEqual(ecarteesRealiste['TVA ligne par ligne'], tva); assert.notEqual(ecarteesRealiste['TVA tronquée'], tva); assert.notEqual(ecarteesRealiste['TTC des lignes'], ht + tva);
    const vente = (nature) => exact.somme(REALISTE.filter((l) => l.nature === nature).map((l) => l.ht));
    assert.deepEqual([vente('PRESTATION'), vente('ARTICLE')], [ECRITURES_REALISTE[1][2], ECRITURES_REALISTE[2][2]]);
    assert.equal(equilibre(ECRITURES_REALISTE), 0n, 'écritures réalistes équilibrées');
    assert.notEqual(ht, vente('PRESTATION'), 'lecture écartée : tout le HT en prestations');

    // Devis réaliste.
    assert.deepEqual(DEVIS_REALISTE.map((l) => l.ht), [1851n, 1851n, 5000n, 11375n]);
    const achat = DEVIS_REALISTE.map((l) => (l.prixAchat === null ? 0n : exact.ligneHt(l.quantite, euros(l.prixAchat).toString())));
    assert.deepEqual(achat, [5n, 5n, 0n, 7500n], 'coût de chaque ligne, arrondi comme une ligne');
    const materiel = exact.somme(DEVIS_REALISTE.filter((l) => l.nature === 'FOURNITURE').map((l) => l.ht));
    assert.deepEqual({ budgetMaterielVendu: materiel, budgetMainOeuvreVendu: exact.somme(DEVIS_REALISTE.map((l) => l.ht)) - materiel, coutMaterielPrevu: exact.somme(achat) }, BUDGETS_REALISTE);
    // Lectures écartées du coût prévu : arrondi une seule fois (1,5 × 0,03 € × 2 = 0,09 €, + 75,00 €) ; main-d'œuvre ignorée.
    const coutArrondiUneFois = (exact.unites('1.5', 3) * 3n * 2n + 500n) / 1000n + 7500n;
    assert.deepEqual([coutArrondiUneFois, exact.somme(achat.slice(0, 3))], [7509n, 10n]);
    for (const ecarte of [coutArrondiUneFois, exact.somme(achat.slice(0, 3))]) assert.notEqual(ecarte, BUDGETS_REALISTE.coutMaterielPrevu);
    assert.notEqual(exact.somme(DEVIS_REALISTE.map((l) => l.ht)), BUDGETS_REALISTE.budgetMaterielVendu, 'lecture écartée : toutes les lignes en matériel');
  });

  test('sommeMontants : la somme des 20 001 montants du cas théorique est exacte, au centime, dans les deux sens (8 589 935 192,00 € et non 8 589 935 192,01 € ; 8 589 935 992,00 € et non 8 589 935 991,99 €), en nombres comme en Prisma.Decimal', () => {
    for (const s of SENS) {
      const termes = lignesTheoriques(TETE, s.petite).map((l) => l.totalHt);
      // Lecture écartée : somme en flottants arrondie au centime (s.flottants).
      assert.equal(lu(sommeMontants(termes), `${s.nom}, nombres`), s.exacte, `${s.nom} : ${fr(s.exacte)} attendus (écarté : ${fr(s.flottants)})`);
      assert.equal(lu(sommeMontants(termes.map((t) => new Prisma.Decimal(t))), `${s.nom}, Prisma.Decimal`), s.exacte, `${s.nom} : termes relus en base`);
      // Le tableau n'est pas modifié (la pièce garde ses lignes).
      assert.deepEqual([termes.length, termes[0], termes[1]], [NOMBRE + 1, 8589934592, euros(s.petite)]);
    }
    assert.equal(sommeMontants([]), 0, 'aucun terme : zéro');
  });

  test('baseHtDuTaux : base HT exacte du taux, dans les deux sens (8 589 935 192,00 € et 8 589 935 992,00 € à 0 % ; 4 294 967 896,03 € à 20 %), sans les lignes des autres taux ; tvaDuTaux arrondie sur cette base exacte', () => {
    for (const s of SENS) {
      // Une ligne d'un autre taux en fin de pièce : elle ne compte pas dans la base à 0 %.
      const lignes = [...lignesTheoriques(TETE, s.petite), { tauxTva: 20, totalHt: 1, nature: 'PRESTATION' }];
      assert.equal(lu(baseHtDuTaux(lignes, 0), `${s.nom}, base à 0 %`), s.exacte, `${s.nom} : base à 0 % (écarté : ${fr(s.flottants)})`);
      assert.equal(lu(baseHtDuTaux(lignes, 20), `${s.nom}, base à 20 %`), 100n, `${s.nom} : base à 20 %, la seule ligne de ce taux`);
      assert.equal(lu(tvaDuTaux(lignes, 0), `${s.nom}, TVA à 0 %`), 0n);
      assert.equal(lu(tvaDuTaux(lignes, 20), `${s.nom}, TVA à 20 %`), 20n);
    }
    const v = VARIANTE_20;
    const lignes20 = lignesTheoriques(v.tete, v.petite, { taux: 20 });
    // Lecture écartée : base en flottants, 4 294 967 896,02 €.
    assert.equal(lu(baseHtDuTaux(lignes20, 20), 'variante à 20 %, base'), v.ht);
    // Lectures écartées : TVA sur la base en flottants ou tronquée (858 993 579,20 €), ligne par ligne (858 993 659,21 €).
    assert.equal(lu(tvaDuTaux(lignes20, 20), 'variante à 20 %, TVA'), v.tva, `variante à 20 % : TVA ${fr(v.tva)}`);
  });

  test('ventilationTvaDerivee : ventilation du cas théorique en somme exacte, dans les deux sens (HT et TTC à 8 589 935 192,00 € puis 8 589 935 992,00 €, TVA nulle à 0 %) ; à 20 %, TVA arrondie sur la base exacte (858 993 579,21 €, TTC 5 153 961 475,24 €)', () => {
    for (const s of SENS) {
      const ventilation = ventilationTvaDerivee(lignesTheoriques(TETE, s.petite));
      // Lecture écartée : HT et TTC du taux à s.flottants (somme en flottants).
      assert.deepEqual(luVentilation(ventilation, s.nom), [[0, s.exacte, 0n, s.exacte]], `${s.nom} : ventilation (écarté : ${fr(s.flottants)})`);
      assert.notDeepEqual(luVentilation(avant.ventilation(lignesTheoriques(TETE, s.petite)), `${s.nom}, avant`), [[0, s.exacte, 0n, s.exacte]], `${s.nom} : le code d’avant s’en écarte`);
    }
    const v = VARIANTE_20;
    // Lectures écartées : base, TVA et TTC en flottants (…896,02 €, …579,20 €, …475,22 €) ; TVA ligne par ligne (…659,21 €).
    assert.deepEqual(luVentilation(ventilationTvaDerivee(lignesTheoriques(v.tete, v.petite, { taux: 20 })), 'variante à 20 %'), [[20, v.ht, v.tva, v.ttc]]);
  });

  test('totauxPiece : totaux d’une pièce (facture saisie, facture au temps passé, devis) en somme exacte des lignes, dans les deux sens (8 589 935 192,00 € puis 8 589 935 992,00 € HT et TTC à 0 %), sans plafond ; à 20 %, 4 294 967 896,03 € HT, 858 993 579,21 € de TVA, 5 153 961 475,24 € TTC', () => {
    for (const s of SENS) {
      const lignes = lignesTheoriques(TETE, s.petite);
      // Lecture écartée : HT et TTC à s.flottants (code d'avant des routes des factures et du devis).
      assert.deepEqual(luTotaux(totauxPiece(lignes), s.nom), [s.exacte, 0n, s.exacte], `${s.nom} : totaux (écarté : ${fr(s.flottants)})`);
      assert.deepEqual(luTotaux(avant.totauxFacture(lignes), `${s.nom}, avant`), [s.flottants, 0n, s.flottants], `${s.nom} : code d’avant`);
    }
    for (const [nom, p] of Object.entries(PLAFOND)) {
      // totauxPiece ne porte pas le plafond : chaque route garde le sien, avec son erreur (cadrage, choix d'implémentation).
      assert.deepEqual(luTotaux(totauxPiece(lignesTheoriques(p.tete, p.petite)), `plafond ${nom}`), [p.exacte, 0n, p.exacte], `plafond ${nom}`);
    }
    const v = VARIANTE_20;
    // Lectures écartées : …896,02 € HT, …579,20 € de TVA, …475,22 € TTC (flottants) ; TVA ligne par ligne, …659,21 €.
    assert.deepEqual(luTotaux(totauxPiece(lignesTheoriques(v.tete, v.petite, { taux: 20 })), 'variante à 20 %'), [v.ht, v.tva, v.ttc]);
  });

  test('totauxDevis : totaux du devis en somme exacte, dans les deux sens ; refus du plafond gardé, au message exact : 9 999 999 999,99 € TTC exacts admis (la somme en flottants, 10 000 000 000,00 €, serait refusée), 10 000 000 000,00 € exacts refusés (la somme en flottants, 9 999 999 999,99 €, serait admise)', () => {
    for (const s of SENS) {
      const lignes = lignesTheoriques(TETE, s.petite);
      assert.deepEqual(luTotaux(totauxDevis(lignes), s.nom), [s.exacte, 0n, s.exacte], `${s.nom} : totaux du devis (écarté : ${fr(s.flottants)})`);
      assert.deepEqual(luTotaux(avant.totauxDevis(lignes), `${s.nom}, avant`), [s.flottants, 0n, s.flottants], `${s.nom} : code d’avant`);
    }
    const v = VARIANTE_20;
    assert.deepEqual(luTotaux(totauxDevis(lignesTheoriques(v.tete, v.petite, { taux: 20 })), 'variante à 20 %'), [v.ht, v.tva, v.ttc]);
    // Plafond atteint exactement : admis. Lectures écartées : somme en flottants (10 000 000 000,00 €, refusée) ; « ≥ » (refusé).
    assert.deepEqual(luTotaux(totauxDevis(lignesTheoriques(PLAFOND.admis.tete, PLAFOND.admis.petite)), 'plafond admis'), [999999999999n, 0n, 999999999999n]);
    // Plafond dépassé d'un centime : refusé, au message d'avant. Lectures écartées : somme en flottants (9 999 999 999,99 €, admise) ;
    // plafond retiré (admis).
    assert.throws(() => totauxDevis(lignesTheoriques(PLAFOND.refuse.tete, PLAFOND.refuse.petite)), (erreur) => {
      assert.ok(erreur instanceof DevisSaisieError, `erreur de saisie du devis attendue (400), obtenu ${erreur?.constructor?.name}`);
      assert.equal(erreur.message, REFUS_PLAFOND_DEVIS);
      return true;
    });
  });

  test('montantsDesEcritures : ventes en somme exacte des lignes de chaque nature, dans les deux sens, pour des prestations comme pour des articles ; écriture client au TTC exact ; écritures équilibrées au centime (pièce relue en base, montants en Prisma.Decimal) ; à 20 %, TVA de la ventilation', () => {
    for (const s of SENS) {
      for (const [nature, cle] of [['PRESTATION', 'VENTE_PRESTATION'], ['ARTICLE', 'VENTE_ARTICLE']]) {
        const piece = pieceEnBase(lignesTheoriques(TETE, s.petite, { nature }), { ht: s.exacte, tva: 0n, ttc: s.exacte, taux: 0 });
        const ecritures = luEcritures(montantsDesEcritures(piece), `${s.nom}, ${nature}`);
        // Client au TTC exact, vente de la nature à la somme exacte ; aucune vente de l'autre nature, aucune TVA (0 %). Lecture
        // écartée : vente en flottants (s.flottants), qui ne s'équilibre plus avec l'écriture client.
        assert.deepEqual(ecritures, [['CLIENT', s.exacte, 0n, null], [cle, 0n, s.exacte, null]], `${s.nom}, ${nature} : écritures (écarté : vente à ${fr(s.flottants)})`);
        assert.equal(equilibre(ecritures), 0n, `${s.nom}, ${nature} : écritures équilibrées`);
        const ecrituresAvant = luEcritures(avant.ecritures(piece), `${s.nom}, ${nature}, avant`);
        assert.equal(ecrituresAvant[1][2], s.flottants, `${s.nom}, ${nature} : vente du code d’avant`);
        assert.notEqual(equilibre(ecrituresAvant), 0n, `${s.nom}, ${nature} : le code d’avant ne s’équilibre pas`);
      }
    }
    const v = VARIANTE_20;
    const piece20 = pieceEnBase(lignesTheoriques(v.tete, v.petite, { taux: 20 }), { ht: v.ht, tva: v.tva, ttc: v.ttc, taux: 20 });
    const ecritures20 = luEcritures(montantsDesEcritures(piece20), 'variante à 20 %');
    assert.deepEqual(ecritures20, [['CLIENT', v.ttc, 0n, null], ['VENTE_PRESTATION', 0n, v.ht, null], ['TVA:20', 0n, v.tva, 20]]);
    assert.equal(equilibre(ecritures20), 0n, 'variante à 20 % : écritures équilibrées');
  });

  test('budgetsConversionDevis : matériel vendu et coût matériel prévu en somme exacte, main-d’œuvre vendue par différence exacte, dans les deux sens (8 589 935 192,00 €, 100,00 €, 8 589 935 192,00 € ; 8 589 935 992,00 €, 100,00 €, 8 589 935 992,00 €) ; devis relu en base', () => {
    for (const s of SENS) {
      const devis = devisTheorique(s.petite);
      assert.equal(devis.lignes[0].totalHt.toString(), '8589934592', `${s.nom} : la grande fourniture est en tête`);
      // Lectures écartées (somme en flottants) : matériel et coût à s.flottants, main-d'œuvre à 99,99 € (0,03 €) ou 100,01 € (0,07 €).
      const attendu = { budgetMaterielVendu: s.exacte, budgetMainOeuvreVendu: MAIN_OEUVRE_THEORIQUE, coutMaterielPrevu: s.exacte };
      assert.deepEqual(luBudgets(budgetsConversionDevis(devis), s.nom), attendu, `${s.nom} : budgets de l’affaire`);
      const ecartes = luBudgets(avant.budgets(devis), `${s.nom}, avant`);
      assert.deepEqual(ecartes, { budgetMaterielVendu: s.flottants, budgetMainOeuvreVendu: MAIN_OEUVRE_THEORIQUE - (s.flottants - s.exacte), coutMaterielPrevu: s.flottants }, `${s.nom} : code d’avant`);
      for (const champ of Object.keys(attendu)) assert.notEqual(ecartes[champ], attendu[champ], `${s.nom} : ${champ} du code d’avant distinct`);
    }
  });

  // Critère « Aucun montant atteignable par l'API ne change » : le cas réaliste donne exactement ce que donnait le code d'avant, et ce
  // que recalcule le témoin.
  test('cas réaliste (sept lignes, quatre taux, deux natures ; devis de quatre lignes) : ventilation, totaux, totaux du devis, écritures et budgets exactement ceux d’avant (125,81 € HT, 21,56 € de TVA, 147,37 € TTC ; matériel vendu 87,02 €, main-d’œuvre vendue 113,75 €, coût prévu 75,10 €), lectures écartées distinctes', () => {
    const lignes = lignesRealistes();
    // Ventilation : lectures écartées, TVA ligne par ligne à 5,5 % (0,02 €), TVA tronquée à 10 % (2,01 €).
    assert.deepEqual(luVentilation(ventilationTvaDerivee(lignes), 'réaliste'), VENTILATION_REALISTE);
    assert.deepEqual(luVentilation(avant.ventilation(lignes), 'réaliste, avant'), VENTILATION_REALISTE, 'ventilation d’avant identique');
    for (const [taux, base, tva] of VENTILATION_REALISTE) {
      assert.equal(lu(baseHtDuTaux(lignes, taux), `base à ${taux} %`), base);
      assert.equal(lu(tvaDuTaux(lignes, taux), `TVA à ${taux} %`), tva);
    }
    // Totaux : lectures écartées, TVA ligne par ligne (21,57 €), tronquée (21,55 €), TTC des lignes (147,38 €).
    assert.deepEqual(luTotaux(totauxPiece(lignes), 'réaliste'), TOTAUX_REALISTE);
    assert.deepEqual(luTotaux(totauxDevis(lignes), 'réaliste, devis'), TOTAUX_REALISTE);
    assert.deepEqual(luTotaux(avant.totauxFacture(lignes), 'réaliste, facture d’avant'), TOTAUX_REALISTE, 'totaux d’une facture d’avant identiques');
    assert.deepEqual(luTotaux(avant.totauxDevis(lignes), 'réaliste, devis d’avant'), TOTAUX_REALISTE, 'totaux d’un devis d’avant identiques');
    // Écritures d'un avoir (montants en nombres, comme à la création d'un avoir partiel) : lecture écartée, tout en prestations.
    const ventilationTva = VENTILATION_REALISTE.map(([taux, ht, tva, ttc]) => ({ tauxTva: taux, totalHt: euros(ht), totalTva: euros(tva), totalTtc: euros(ttc) }));
    const piece = { totalTtc: euros(TOTAUX_REALISTE[2]), lignes, ventilationTva };
    assert.deepEqual(luEcritures(montantsDesEcritures(piece), 'réaliste'), ECRITURES_REALISTE);
    assert.deepEqual(luEcritures(avant.ecritures(piece), 'réaliste, avant'), ECRITURES_REALISTE, 'écritures d’avant identiques');
    // Sans ventilation enregistrée (pièce historique), la TVA vient de la ventilation dérivée : mêmes écritures.
    assert.deepEqual(luEcritures(montantsDesEcritures({ totalTtc: euros(TOTAUX_REALISTE[2]), lignes }), 'réaliste, sans ventilation'), ECRITURES_REALISTE);
    // Budgets de l'affaire née du devis réaliste : lectures écartées, coût arrondi une seule fois (75,09 €), main-d'œuvre ignorée (0,10 €),
    // toutes les lignes en matériel (200,77 €).
    const devis = devisEnBase(DEVIS_REALISTE.map((l) => ({ nature: l.nature, quantite: l.quantite, ht: l.ht, prixAchat: l.prixAchat })));
    assert.deepEqual(luBudgets(budgetsConversionDevis(devis), 'réaliste'), BUDGETS_REALISTE);
    assert.deepEqual(luBudgets(avant.budgets(devis), 'réaliste, avant'), BUDGETS_REALISTE, 'budgets d’avant identiques');
  });

  // Cadrage, N3 : mutants équivalents. Borne : un montant au centime inférieur au plafond (< 2^34 €) est représenté à 2^-20 € près, et
  // chaque addition d'un total partiel inférieur à 2^34 € s'arrondit à 2^-20 € près ; k termes s'écartent donc de leur somme exacte
  // d'au plus (2k − 1) × 2^-20 €, soit moins de 6,7 × 10^-6 € pour 4 termes, loin du demi-centime (0,005 €) qui ferait changer
  // l'arrondi au centime d'une somme exacte au centime. Le test le montre sur des sommes tirées au hasard (graine fixe) et sur les sommes
  // les plus exposées (termes à 2^33 € et au plafond) : la somme en flottants arrondie (code d'avant) et sommeMontants rendent la somme
  // exacte. Ces mutants ne se tuent donc par aucun test.
  test('mutants équivalents (cadrage, N3) : une somme de 2, 3 ou 4 montants au centime, sous le plafond, faite en nombres à virgule puis arrondie au centime, vaut toujours la somme exacte ; sommeMontants la rend aussi', () => {
    let graine = 0x2545f491;
    const hasard = () => { graine ^= graine << 13; graine ^= graine >>> 17; graine ^= graine << 5; return (graine >>> 0) / 2 ** 32; };
    const tirage = (k) => {
      const termes = []; let reste = 999999999999n;
      for (let j = 0; j < k; j += 1) {
        const terme = BigInt(Math.floor(hasard() * (Number(reste) + 1)));
        termes.push(terme); reste -= terme;
      }
      return termes;
    };
    const exposees = [
      [858993459203n, 3n], [858993459207n, 7n], [999999999998n, 1n], [999999939999n, 60000n], [429496789603n, 85899357921n],
      [858993459299n, 1n, 1n], [858993459201n, 99n, 99n, 99n], [499999999999n, 499999999999n, 1n], [333333333333n, 333333333333n, 333333333333n],
      [858993459200n, 3n, 7n, 11n], [999999999996n, 1n, 1n, 1n], [1n, 2n, 3n, 999999999993n],
    ];
    let nombre = 0;
    const verifier = (termes) => {
      const attendu = exact.somme(termes);
      const nombres = termes.map(euros);
      const enFlottants = lu(sommeAvant(nombres), 'somme en flottants');
      const parSommeMontants = lu(sommeMontants(nombres), 'sommeMontants');
      // Message construit au seul échec : 60 000 sommes.
      if (enFlottants !== attendu || parSommeMontants !== attendu) assert.fail(`${termes.map(fr).join(' + ')} : ${fr(attendu)} attendus, ${fr(enFlottants)} en flottants, ${fr(parSommeMontants)} par sommeMontants`);
      nombre += 1;
    };
    for (const termes of exposees) verifier(termes);
    for (const k of [2, 3, 4]) for (let i = 0; i < 20_000; i += 1) verifier(tirage(k));
    assert.equal(nombre, exposees.length + 60_000);
  });
});
