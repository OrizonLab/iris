import { randomInt } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { test, expect, dateDuJour, horsDuPassageDeMinuit, jetonPour } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot « Pas d'avoir à 0,00 € » (cadrage v2, § 4 « Écran » et critère 8 ; T2 du contrôle de cohérence de mode 1). Réponses de Nelson du
// 10-11-2026 : « si 0€ pas d'avoir, on ne fais pas d'avoir a 0€ » (point 5) et « Refuser l'annulation (Recommandé) » (annulation d'une
// facture à 0,00 €). Choix par défaut d'affichage, à confirmer (règle 5, le plus restrictif) : sur une facture émise à 0,00 € TTC, ni
// « Annuler la facture » ni « Créer un avoir partiel », une seule mention « Aucun avoir possible : facture à 0,00 € ». Formulaire
// d'avoir partiel : le message du serveur s'affiche (pas de contrôle client supplémentaire).
//
// Parcours dans Chromium, libellés français, dates JJ-MM-AAAA, montants au format français :
//  1. l'administration ouvre « Factures » : sa facture FZ (1 × 0,00 € HT à 20 %, TTC 0,00 €), émise, porte la mention à la place des
//     deux boutons (ni « Annulation totale impossible », ni « Enregistrer un règlement ») ; sa facture FP (1 × 100,00 € HT à 20 %,
//     TTC 120,00 €) garde les deux boutons, sans la mention ;
//  2. sur FP, elle saisit un avoir partiel de 0,001 × 0,01 € HT à 20 % : l'aperçu annonce 0,00 € ; l'envoi reçoit le refus du serveur
//     (400), dont le message exact s'affiche, le formulaire reste ouvert, aucun avoir n'apparaît (liste et API), FP reste due de
//     120,00 € ;
//  3. l'assistante technique ouvre « Factures » : sa facture à 0,00 € porte la même mention, sans les deux boutons.
// Les espaces des montants (U+202F des milliers, U+00A0 avant « € ») sont lus par \s.

type Piece = { id: string; numero: string | null; type: string; statut: string; totalHt: number; totalTva: number; totalTtc: number; resteDu?: number | null; factureOrigine?: { id: string; numero: string | null } | null };
const MENTION = 'Aucun avoir possible : facture à 0,00 €';
const REFUS_LIGNE_ZERO = 'Une ligne d’avoir à 0,00 € n’est pas admise : Iris n’émet pas d’avoir à 0,00 €.';

// La ligne d'une pièce, cherchée de page en page (la base E2E est partagée et conservée ; modèle : statut-facture-avoirs).
async function ligneDe(page: Page, raisonSociale: string, texte: string): Promise<Locator> {
  await expect(page.getByTestId('pagination-factures')).toContainText('document(s)');
  await expect(page.locator('tbody [role="status"]')).toHaveCount(0);
  while (await page.getByRole('button', { name: 'Page précédente' }).isEnabled()) {
    await page.getByRole('button', { name: 'Page précédente' }).click();
    await expect(page.locator('tbody [role="status"]')).toHaveCount(0);
  }
  const ligne = page.locator('tbody tr', { hasText: raisonSociale }).filter({ hasText: texte }).filter({ hasNotText: 'Origine :' });
  const presente = async () => {
    try { await expect(ligne.first()).toBeVisible({ timeout: 3_000 }); return true; } catch { return false; }
  };
  while (!(await presente())) {
    const suivante = page.getByRole('button', { name: 'Page suivante' });
    expect(await suivante.isEnabled(), `pièce ${texte} de ${raisonSociale} absente de la pagination`).toBeTruthy();
    await suivante.click();
    await expect(page.locator('tbody [role="status"]')).toHaveCount(0);
  }
  return ligne;
}
const cellules = (ligne: Locator) => ({ emission: ligne.locator('td').nth(2), totalTtc: ligne.locator('td').nth(4), resteDu: ligne.locator('td').nth(5), statut: ligne.locator('td').nth(6) });

test('facture à 0,00 € : « Aucun avoir possible : facture à 0,00 € » à la place de « Créer un avoir partiel » et « Annuler la facture » ; avoir partiel de 0,001 × 0,01 € (aperçu 0,00 €) refusé avec le message du serveur, aucun avoir créé', async ({ allerSurPageAdmin, request, session, creerClient }) => {
  test.slow();
  await horsDuPassageDeMinuit();
  const admin = { Authorization: `Bearer ${session.token}` };
  const appel = async <T>(path: string, data: object) => {
    const reponse = await request.post(`${api}${path}`, { headers: admin, data });
    expect(reponse.ok(), `${path} : ${await reponse.text()}`).toBeTruthy();
    return reponse.json() as Promise<T>;
  };
  const client = await creerClient('pas d’avoir à zéro');
  const facture = async (designation: string, prixUnitaireHt: number) => {
    const brouillon = await appel<Piece>('/factures', { clientId: client.id, origine: 'HORS_AFFAIRE', motifHorsAffaire: `Avoir non nul ${designation}`, dateEmission: dateDuJour(), dateEcheance: dateDuJour(), lignes: [{ designation, nature: 'PRESTATION', quantite: 1, prixUnitaireHt, tauxTva: 20 }] });
    return appel<Piece>(`/factures/${brouillon.id}/emettre`, {});
  };
  const fz = await facture('Visite de contrôle offerte', 0);
  expect([fz.statut, fz.totalHt, fz.totalTva, fz.totalTtc]).toEqual(['EMISE', 0, 0, 0]);
  const fp = await facture('Contrôle annuel', 100);
  expect([fp.statut, fp.totalHt, fp.totalTva, fp.totalTtc]).toEqual(['EMISE', 100, 20, 120]);

  const page = await allerSurPageAdmin('/factures');
  const erreursPage: string[] = [];
  page.on('pageerror', (erreur) => erreursPage.push(erreur.message));
  const refusApi: string[] = [];
  page.on('response', (reponse) => {
    if (new URL(reponse.url()).pathname.startsWith('/api/') && reponse.status() >= 400) refusApi.push(`${reponse.request().method()} ${new URL(reponse.url()).pathname} : ${reponse.status()}`);
  });
  await expect(page.getByRole('heading', { name: 'Factures', level: 1 })).toBeVisible();

  // 1. FZ : la mention remplace les deux boutons (lecture écartée, avant le lot : « Créer un avoir partiel » et « Annuler la facture »).
  const ligneFz = await ligneDe(page, client.raisonSociale, fz.numero!);
  await expect(cellules(ligneFz).emission).toHaveText(dateDuJour());
  await expect(cellules(ligneFz).totalTtc).toHaveText(/^0,00\s€$/);
  await expect(cellules(ligneFz).resteDu).toHaveText(/^0,00\s€$/);
  await expect(cellules(ligneFz).statut).toHaveText('EMISE');
  await expect(ligneFz.getByText(MENTION, { exact: true })).toBeVisible();
  for (const absent of ['Créer un avoir partiel', 'Annuler la facture', 'Enregistrer un règlement']) {
    await expect(ligneFz.getByText(absent, { exact: true }), absent).toHaveCount(0);
    await expect(ligneFz.getByRole('button', { name: absent }), absent).toHaveCount(0);
    await expect(ligneFz.getByRole('link', { name: absent }), absent).toHaveCount(0);
  }
  await expect(ligneFz).not.toContainText('Annulation totale impossible');
  await expect(ligneFz.getByRole('button', { name: 'PDF' })).toBeVisible();
  // FP, facture de 120,00 € : les deux boutons, sans la mention.
  const ligneFp = await ligneDe(page, client.raisonSociale, fp.numero!);
  await expect(cellules(ligneFp).totalTtc).toHaveText(/^120,00\s€$/);
  await expect(ligneFp.getByRole('button', { name: 'Créer un avoir partiel', exact: true })).toBeVisible();
  await expect(ligneFp.getByRole('button', { name: 'Annuler la facture', exact: true })).toBeVisible();
  await expect(ligneFp).not.toContainText(MENTION);

  // 2. Avoir partiel de 0,001 × 0,01 € sur FP : aperçu à 0,00 €, refus du serveur affiché tel quel, formulaire toujours ouvert.
  await ligneFp.getByRole('button', { name: 'Créer un avoir partiel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nouvel avoir partiel' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Désignation ligne avoir 1' }).fill('Remise d’un millième de centime');
  await page.getByRole('combobox', { name: 'Nature ligne avoir 1' }).selectOption('PRESTATION');
  await page.getByRole('textbox', { name: 'Quantité ligne avoir 1' }).fill('0,001');
  await page.getByRole('textbox', { name: 'Prix unitaire HT ligne avoir 1' }).fill('0,01');
  await page.getByRole('textbox', { name: 'TVA ligne avoir 1' }).fill('20');
  const apercu = page.getByTestId('aperçu-avoir');
  await expect(apercu).toContainText(/Total HT\s*0,00\s€/);
  await expect(apercu).toContainText(/Total TTC\s*0,00\s€/);
  const envoi = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/factures/${fp.id}/avoirs` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Créer l’avoir partiel', exact: true }).click();
  const reponse = await envoi;
  expect(reponse.status()).toBe(400);
  expect(await reponse.json()).toEqual({ error: REFUS_LIGNE_ZERO });
  await expect(page.getByRole('alert').filter({ hasText: REFUS_LIGNE_ZERO })).toHaveText(REFUS_LIGNE_ZERO);
  await expect(page.getByRole('heading', { name: 'Nouvel avoir partiel' })).toBeVisible();
  await expect(page.getByText(/créé et émis/)).toHaveCount(0);
  await expect(page.locator('tbody tr', { hasText: `Origine : ${fp.numero}` })).toHaveCount(0);

  // Relu par l'API : aucun avoir sur FP ni sur FZ, FP toujours due de 120,00 €.
  const pieces = await (await request.get(`${api}/factures`, { headers: admin })).json() as Piece[];
  expect(pieces.filter((p) => p.factureOrigine && [fp.id, fz.id].includes(p.factureOrigine.id))).toEqual([]);
  const lue = (id: string) => pieces.find((p) => p.id === id)!;
  expect([lue(fp.id).statut, lue(fp.id).resteDu]).toEqual(['EMISE', 120]);
  expect([lue(fz.id).statut, lue(fz.id).resteDu]).toEqual(['EMISE', 0]);

  expect(erreursPage, 'aucune erreur de la page').toEqual([]);
  expect(refusApi, 'seul refus : l’avoir de 0,00 €').toEqual([`POST /api/factures/${fp.id}/avoirs : 400`]);
});

test('assistante technique : sa facture à 0,00 € porte « Aucun avoir possible : facture à 0,00 € », sans « Créer un avoir partiel » ni « Annuler la facture »', async ({ connexion, request, session, creerClient }) => {
  test.slow();
  await horsDuPassageDeMinuit();
  const admin = { Authorization: `Bearer ${session.token}` };
  const appel = async <T>(path: string, data: object, headers: Record<string, string>) => {
    const reponse = await request.post(`${api}${path}`, { headers, data });
    expect(reponse.ok(), `${path} : ${await reponse.text()}`).toBeTruthy();
    return reponse.json() as Promise<T>;
  };
  const suffixe = `${Date.now()}-${randomInt(1_000_000)}`;
  const assistante = await appel<{ id: string }>('/users', { email: `zero.at.${suffixe}@iris.test`, name: `Assistante technique zéro ${suffixe}`, role: 'ASSISTANTE_TECHNIQUE' }, admin);
  const elle = { Authorization: `Bearer ${jetonPour(assistante.id)}` };
  const client = await creerClient(`facture à zéro de l’assistante ${suffixe}`);
  const brouillon = await appel<Piece>('/factures', { clientId: client.id, origine: 'HORS_AFFAIRE', motifHorsAffaire: 'Avoir non nul, assistante', dateEmission: dateDuJour(), dateEcheance: dateDuJour(), lignes: [{ designation: 'Mise en service offerte', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 0, tauxTva: 20 }] }, elle);
  const fz = await appel<Piece>(`/factures/${brouillon.id}/emettre`, {}, elle);
  expect([fz.statut, fz.totalTtc]).toEqual(['EMISE', 0]);

  const page = await connexion(assistante);
  const erreursPage: string[] = [];
  page.on('pageerror', (erreur) => erreursPage.push(erreur.message));
  await page.goto('/factures', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Factures', level: 1 })).toBeVisible();
  const ligneFz = await ligneDe(page, client.raisonSociale, fz.numero!);
  await expect(cellules(ligneFz).totalTtc).toHaveText(/^0,00\s€$/);
  await expect(cellules(ligneFz).statut).toHaveText('EMISE');
  await expect(ligneFz.getByText(MENTION, { exact: true })).toBeVisible();
  for (const absent of ['Créer un avoir partiel', 'Annuler la facture', 'Enregistrer un règlement']) {
    await expect(ligneFz.getByText(absent, { exact: true }), absent).toHaveCount(0);
    await expect(ligneFz.getByRole('button', { name: absent }), absent).toHaveCount(0);
    await expect(ligneFz.getByRole('link', { name: absent }), absent).toHaveCount(0);
  }
  await expect(ligneFz).not.toContainText('Annulation totale impossible');
  expect(erreursPage, 'aucune erreur de la page').toEqual([]);
});
