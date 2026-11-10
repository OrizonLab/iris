import { formatMontantFacture, formatDateFacture, ventilationFacture } from './metier';
import { ligneColonnes, ouvrirDocumentPdf, replierTexte, type IdentiteImprimee } from '../documents/gabarit';
import { LIBELLES_MOYEN_REGLEMENT } from '../reglements/metier';
import { comparerReperes } from '../reglements/lectureFacture';

// Règlements et avoirs d'une facture émise ou réglée, lus à l'impression (../reglements/lectureFacture.ts),
// montants déjà convertis en nombres ; null pour une autre pièce.
export type ReglementsImprimes = {
  parts: { id: string; montant: number; reglement: { dateReglement: Date; createdAt: Date; moyen: string; statut: string } }[];
  avoirs: { id: string; numero: string | null; dateEmission: Date; emisLe: Date | null; totalTtc: number }[];
  solde: { montantRegle: number; montantAvoirs: number; resteDu: number } | null;
} | null;

// Mention de statut d'une facture réglée (réponse de Nelson du 10-11-2026, « Facture réglée par avoir(s) ») :
// soldée par ses seuls avoirs (aucun paiement non contre-passé, comme « Soldée par avoir » à l'écran),
// « Facture réglée par avoir. » ou « par avoirs. » selon leur nombre (lecture retenue : accord au nombre) ;
// avec au moins un paiement, « Facture réglée. », comme avant.
function mentionReglee(reglements: ReglementsImprimes) {
  if (!reglements?.solde || reglements.solde.montantRegle !== 0 || !reglements.avoirs.length) return 'Facture réglée.';
  return reglements.avoirs.length === 1 ? 'Facture réglée par avoir.' : 'Facture réglée par avoirs.';
}

// Bloc « Règlements et avoirs » (réponses de Nelson du 10-11-2026 : « Dès qu'un avoir existe » et « Oui,
// paiements et avoirs » ; sans avoir, une facture payée en tout ou en partie le porte aussi, lecture retenue, à
// corriger par Nelson si besoin) : ses paiements non contre-passés, part affectée à cette facture seulement, sans
// le total du règlement ni sa référence (choix par défaut, le plus restrictif, à confirmer), et ses avoirs
// partiels émis, en TTC, dans l'ordre du panneau de l'écran ; puis le reste à payer ou le trop-perçu, rien
// s'il est nul (choix d'affichage par défaut, à confirmer). Aucune ligne : aucun bloc.
export function lignesReglementsImprimes(reglements: ReglementsImprimes): string[] {
  if (!reglements) return [];
  const paiements = reglements.parts.filter(part => part.reglement.statut === 'ENREGISTRE').map(part => ({
    repere: { date: new Date(part.reglement.dateReglement), instant: new Date(part.reglement.createdAt), id: part.id },
    texte: `Paiement du ${formatDateFacture(part.reglement.dateReglement)} (${LIBELLES_MOYEN_REGLEMENT[part.reglement.moyen] ?? part.reglement.moyen}) : ${formatMontantFacture(part.montant)}`,
  }));
  const avoirs = reglements.avoirs.map(avoir => ({
    repere: { date: new Date(avoir.dateEmission), instant: avoir.emisLe ? new Date(avoir.emisLe) : null, id: avoir.id },
    texte: `Avoir ${avoir.numero} du ${formatDateFacture(avoir.dateEmission)} : ${formatMontantFacture(avoir.totalTtc)}`,
  }));
  const lignes = [...paiements, ...avoirs].sort((a, b) => comparerReperes(a.repere, b.repere)).map(ligne => ligne.texte);
  if (!lignes.length) return [];
  const reste = reglements.solde?.resteDu ?? 0;
  if (reste > 0) lignes.push(`Reste à payer : ${formatMontantFacture(reste)}`);
  else if (reste < 0) lignes.push(`Trop-perçu : ${formatMontantFacture(-reste)}`);
  return lignes;
}

// Une facture émise s'imprime depuis ses copies figées : lignes, totaux, client, mentions légales et,
// depuis le lot 6a-1, identité de l'émetteur avec son logo, sa couleur et son pied de page. Aucun
// paramètre vivant n'est lu. Une pièce émise avant ce lot n'a pas d'identité figée : son émetteur
// reste celui du texte des mentions légales figées, comme à l'origine. Seules la mention de statut
// (« Facture réglée… », « FACTURE ANNULÉE — … ») et, depuis le lot « Détail des avoirs comme règlements »,
// le bloc « Règlements et avoirs » décrivent la situation lue à l'impression : un règlement, une
// contre-passation ou un avoir partiel les change, le reste du document non.
export async function rendreDocumentFacturePdf(facture: any, reglements: ReglementsImprimes = null): Promise<Buffer> {
  const identite: IdentiteImprimee | null = facture.identiteEmetteur ?? null;
  const document = ouvrirDocumentPdf({ titre: `Facture ${facture.numero}`, identite });
  const { pdf, ligne, couleur } = document;
  const legal = facture.mentionsLegalesVersion;
  const colonnes = (...cellules: string[]) => ligneColonnes(cellules, [38, 9, 16, 8, 16]);

  pdf.fillColor(couleur);
  const estAvoir = facture.type === 'AVOIR';
  ligne(`${estAvoir ? 'AVOIR' : 'FACTURE'} ${facture.numero}`, { taille: 18 });
  pdf.fillColor('#000000');
  ligne(`Émise le ${formatDateFacture(facture.dateEmission)} · Échéance : ${formatDateFacture(facture.dateEcheance)}`, { taille: 10 });
  if (estAvoir) ligne(`Facture d’origine : ${facture.factureOrigine?.numero || 'référence indisponible'}`, { taille: 10 });
  // Les documents de statuts post-émission doivent expliciter leur situation : un PDF
  // annulé muet serait indistinguable d'une créance toujours due.
  if (facture.statut === 'ANNULEE') { pdf.fillColor('#b91c1c'); ligne('FACTURE ANNULÉE — ce document ne vaut pas justificatif de créance.', { taille: 12 }); pdf.fillColor('#000000'); }
  else if (facture.statut === 'REGLEE') ligne(mentionReglee(reglements), { taille: 10 });
  pdf.moveDown();
  if (!identite) {
    ligne('Émetteur', { taille: 11 });
    ligne(legal.mentions, { taille: 9 });
    pdf.moveDown();
  }
  ligne('Client', { taille: 11 });
  ligne(facture.clientRaisonSociale, { taille: 12 });
  ligne(facture.clientAdresse, { taille: 9 });
  pdf.moveDown();
  pdf.font('Courier');
  ligne(colonnes('Désignation', 'Qté', 'PU HT', 'TVA', 'Total HT'), { taille: 9 });
  for (const item of facture.lignes) {
    const [premiere, ...suite] = replierTexte(String(item.designation), 36);
    ligne(colonnes(premiere, String(item.quantite), formatMontantFacture(item.prixUnitaireHt), `${Number(item.tauxTva)} %`, formatMontantFacture(item.totalHt)), { taille: 9 });
    for (const reste of suite) ligne(reste, { taille: 9 });
  }
  pdf.font('Helvetica');
  pdf.moveDown();
  const tvaParTaux = ventilationFacture(facture).map(ventilation => ({ taux: ventilation.tauxTva, ht: ventilation.totalHt, tva: ventilation.totalTva }));
  ligne(`Total HT : ${formatMontantFacture(facture.totalHt)}`, { taille: 10, align: 'right' });
  for (const cumul of tvaParTaux) ligne(`TVA ${cumul.taux} % sur ${formatMontantFacture(cumul.ht)} : ${formatMontantFacture(cumul.tva)}`, { taille: 10, align: 'right' });
  ligne(`TVA totale : ${formatMontantFacture(facture.totalTva)}`, { taille: 10, align: 'right' });
  ligne(`Total TTC : ${formatMontantFacture(facture.totalTtc)}`, { taille: 13, align: 'right' });
  pdf.moveDown();
  const situation = facture.type === 'FACTURE' && (facture.statut === 'EMISE' || facture.statut === 'REGLEE') ? lignesReglementsImprimes(reglements) : [];
  if (situation.length) {
    ligne('Règlements et avoirs', { taille: 11 });
    for (const texte of situation) ligne(texte, { taille: 10 });
    pdf.moveDown();
  }
  ligne(`Mentions légales et CGV — version ${legal.version}`, { taille: 10 });
  // Avec l'identité figée en en-tête, le texte des mentions garde les autres mentions (décision 6).
  if (identite) ligne(legal.mentions, { taille: 8 });
  ligne(legal.cgv, { taille: 8 });
  ligne(`Pénalités : ${legal.penalites}`, { taille: 8 });
  if (legal.escompte) ligne(`Escompte : ${legal.escompte}`, { taille: 8 });
  return document.terminer();
}
