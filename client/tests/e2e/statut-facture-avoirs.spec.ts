import type { Locator, Page } from '@playwright/test';
import { test, expect, dateDuJour, horsDuPassageDeMinuit } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot « Statut d'une facture couverte par des avoirs » (cadrage v3, section « Tests », puce « E2E » : « la liste affiche « Soldée
// par avoir » sous une facture réglée par avoir, et « Partiellement réglée » sous une facture couverte en partie par un avoir » ;
// critères 1 et 2 ; § 2, « Annulation d'une facture réglée par ses avoirs » ; § 3, affichage). Réponse de Nelson du 09-11-2026,
// mot pour mot : « La facture n’est pas annulé si payer par sob avoir, soit elle est regle entierement dans ce cas la facture est
// regler ou si seul une partie est couverte pas un ou plusieurs avoir, elle sera partiellement reglé. » Lecture retenue, à
// corriger par Nelson si besoin : « réglée » est le statut stocké ; la précision « Soldée par avoir » passe de « émise » à
// « réglée » sans règlement (choix par défaut, à confirmer).
//
// Parcours dans Chromium, par l'administration, libellés français, dates JJ-MM-AAAA, montants au format français :
//  1. FA (1 × 1 234,50 € HT à 20 % : TVA 246,90 €, TTC 1 481,40 €), émise, sans règlement : elle reçoit depuis l'écran un avoir
//     partiel de 1 × 1 234,50 € HT (aperçu TTC 1 481,40 €) ; sa ligne passe « Réglée », précisée « Soldée par avoir », reste dû
//     0,00 € ; ni « Enregistrer un règlement », ni « Annuler la facture », ni la mention « Annulation totale impossible » ;
//     « Créer un avoir partiel » reste proposé. Lecture écartée (avant le lot) : « Émise » précisée « Soldée par avoir ».
//  2. FB (1 × 1 000,00 € HT à 20 %, TTC 1 200,00 €) reçoit depuis l'écran un avoir de 1 × 250,00 € HT (TVA 50,00 €, TTC 300,00 €) :
//     sa ligne reste « Émise », précisée « Partiellement réglée », reste dû 900,00 € (lectures écartées : avant le lot, aucune
//     précision ; avoir déduit hors taxes, 950,00 €), « Enregistrer un règlement » proposé et « Annulation totale impossible :
//     1 avoir(s) partiel(s) déjà émis ».
// Les espaces des montants (U+202F des milliers, U+00A0 avant « € ») sont lus par \s.
// Libellés du statut (correctif R1 de #540, cadrage, section « Tests ») : la cellule affiche « Émise », « Réglée », et non le
// code stocké ; sa précision la suit.

type Piece = { id: string; numero: string | null; type: string; statut: string; totalHt: number; totalTva: number; totalTtc: number; resteDu?: number | null; montantAvoirs?: number | null; montantRegle?: number | null };

// La ligne d'une pièce, cherchée de page en page (la base E2E est partagée et conservée ; modèle : assistante-technique-avoirs).
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

// Avoir partiel saisi depuis l'écran, sur une ligne : une ligne de prestation à 20 %.
async function avoirDepuisLEcran(page: Page, ligne: Locator, factureId: string, designation: string, prixHt: string, apercuTtc: RegExp): Promise<Piece> {
  await ligne.getByRole('button', { name: 'Créer un avoir partiel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nouvel avoir partiel' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Désignation ligne avoir 1' }).fill(designation);
  await page.getByRole('combobox', { name: 'Nature ligne avoir 1' }).selectOption('PRESTATION');
  await page.getByRole('textbox', { name: 'Quantité ligne avoir 1' }).fill('1');
  await page.getByRole('textbox', { name: 'Prix unitaire HT ligne avoir 1' }).fill(prixHt);
  await page.getByRole('textbox', { name: 'TVA ligne avoir 1' }).fill('20');
  await expect(page.getByTestId('aperçu-avoir')).toContainText(apercuTtc);
  const creation = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/factures/${factureId}/avoirs` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Créer l’avoir partiel', exact: true }).click();
  const reponse = await creation;
  expect(reponse.status()).toBe(201);
  const avoir = await reponse.json() as Piece;
  await expect(page.getByText(`Avoir ${avoir.numero} créé et émis.`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nouvel avoir partiel' })).toHaveCount(0);
  return avoir;
}

test('liste des factures : « Réglée » précisée « Soldée par avoir » sous une facture soldée par son avoir partiel (1 481,40 €), « Émise » précisée « Partiellement réglée » sous une facture couverte en partie par un avoir (reste dû 900,00 €), avoirs créés depuis l’écran', async ({ allerSurPageAdmin, request, session, creerClient }) => {
  test.slow();
  await horsDuPassageDeMinuit();
  const admin = { Authorization: `Bearer ${session.token}` };
  const appel = async <T>(path: string, data: object) => {
    const reponse = await request.post(`${api}${path}`, { headers: admin, data });
    expect(reponse.ok(), `${path} : ${await reponse.text()}`).toBeTruthy();
    return reponse.json() as Promise<T>;
  };
  const client = await creerClient('statut par avoir');
  const facture = async (designation: string, prixUnitaireHt: number) => {
    const brouillon = await appel<Piece>('/factures', { clientId: client.id, origine: 'HORS_AFFAIRE', motifHorsAffaire: `Statut par avoir ${designation}`, dateEmission: dateDuJour(), dateEcheance: dateDuJour(), lignes: [{ designation, nature: 'PRESTATION', quantite: 1, prixUnitaireHt, tauxTva: 20 }] });
    return appel<Piece>(`/factures/${brouillon.id}/emettre`, {});
  };
  const fa = await facture('Installation de la centrale', 1234.5);
  expect([fa.statut, fa.totalHt, fa.totalTva, fa.totalTtc]).toEqual(['EMISE', 1234.5, 246.9, 1481.4]);
  const fb = await facture('Contrôle annuel', 1000);
  expect([fb.statut, fb.totalTtc]).toEqual(['EMISE', 1200]);

  const page = await allerSurPageAdmin('/factures');
  const erreursPage: string[] = [];
  page.on('pageerror', (erreur) => erreursPage.push(erreur.message));
  const refusApi: string[] = [];
  page.on('response', (reponse) => {
    if (new URL(reponse.url()).pathname.startsWith('/api/') && reponse.status() >= 400) refusApi.push(`${reponse.request().method()} ${new URL(reponse.url()).pathname} : ${reponse.status()}`);
  });
  await expect(page.getByRole('heading', { name: 'Factures', level: 1 })).toBeVisible();
  const cellules = (ligne: Locator) => ({ resteDu: ligne.locator('td').nth(5), statut: ligne.locator('td').nth(6) });

  // 1. FA, émise sans règlement ni avoir : aucune précision, annulable.
  let ligneFa = await ligneDe(page, client.raisonSociale, fa.numero!);
  await expect(ligneFa).toContainText(dateDuJour());
  await expect(cellules(ligneFa).statut).toHaveText('Émise');
  await expect(cellules(ligneFa).resteDu).toHaveText(/^1\s481,40\s€$/);
  await expect(ligneFa.getByRole('button', { name: 'Annuler la facture', exact: true })).toBeVisible();
  const avoirFa = await avoirDepuisLEcran(page, ligneFa, fa.id, 'Reprise de l’installation', '1234,50', /Total TTC\s*1\s481,40\s€/);
  expect([avoirFa.type, avoirFa.totalHt, avoirFa.totalTva, avoirFa.totalTtc]).toEqual(['AVOIR', 1234.5, 246.9, 1481.4]);
  ligneFa = await ligneDe(page, client.raisonSociale, fa.numero!);
  // Statut stocké « réglée », précision « Soldée par avoir » (lecture écartée : « Émise » précisée « Soldée par avoir »).
  await expect(cellules(ligneFa).statut).toHaveText(/^Réglée\s*Soldée par avoir$/);
  await expect(cellules(ligneFa).statut).toContainText('Soldée par avoir');
  // « Émis » couvre aussi « Émise ».
  await expect(cellules(ligneFa).statut).not.toContainText('Émis');
  await expect(cellules(ligneFa).statut).not.toContainText('Partiellement réglée');
  await expect(cellules(ligneFa).resteDu).toHaveText(/^0,00\s€$/);
  for (const absent of ['Enregistrer un règlement', 'Annuler la facture']) await expect(ligneFa.getByText(absent, { exact: true }), absent).toHaveCount(0);
  await expect(ligneFa).not.toContainText('Annulation totale impossible');
  await expect(ligneFa.getByRole('button', { name: 'Créer un avoir partiel', exact: true })).toBeVisible();
  const ligneAvoirFa = page.locator('tbody tr', { hasText: avoirFa.numero! });
  await expect(ligneAvoirFa).toContainText(`Origine : ${fa.numero}`);
  await expect(ligneAvoirFa).toContainText(/1\s481,40\s€/);

  // 2. FB, couverte en partie par un avoir de 300,00 € TTC.
  let ligneFb = await ligneDe(page, client.raisonSociale, fb.numero!);
  await expect(cellules(ligneFb).statut).toHaveText('Émise');
  const avoirFb = await avoirDepuisLEcran(page, ligneFb, fb.id, 'Geste commercial', '250', /Total TTC\s*300,00\s€/);
  expect([avoirFb.totalHt, avoirFb.totalTva, avoirFb.totalTtc]).toEqual([250, 50, 300]);
  ligneFb = await ligneDe(page, client.raisonSociale, fb.numero!);
  // Lecture écartée (avant le lot) : aucune précision sans règlement.
  await expect(cellules(ligneFb).statut).toHaveText(/^Émise\s*Partiellement réglée$/);
  await expect(cellules(ligneFb).statut).toContainText('Partiellement réglée');
  await expect(cellules(ligneFb).statut).not.toContainText('Soldée par avoir');
  // Lecture écartée : avoir déduit hors taxes (950,00 €).
  await expect(cellules(ligneFb).resteDu).toHaveText(/^900,00\s€$/);
  await expect(ligneFb.getByRole('link', { name: /Enregistrer un règlement/ })).toBeVisible();
  await expect(ligneFb).toContainText('Annulation totale impossible : 1 avoir(s) partiel(s) déjà émis');

  // Les mêmes pièces relues par l'API : statut stocké, soldes, et l'entrée du journal au nom de l'administration.
  const pieces = await (await request.get(`${api}/factures`, { headers: admin })).json() as Piece[];
  const lue = (id: string) => pieces.find((p) => p.id === id)!;
  expect([lue(fa.id).statut, lue(fa.id).montantAvoirs, lue(fa.id).montantRegle, lue(fa.id).resteDu]).toEqual(['REGLEE', 1481.4, 0, 0]);
  expect([lue(fb.id).statut, lue(fb.id).montantAvoirs, lue(fb.id).montantRegle, lue(fb.id).resteDu]).toEqual(['EMISE', 300, 0, 900]);
  const journal = await (await request.get(`${api}/factures/${fa.id}/journal`, { headers: admin })).json() as { action: string; detail: string }[];
  const transitions = journal.filter((j) => j.action === 'REGLEMENT');
  expect(transitions).toHaveLength(1);
  expect(transitions[0].detail).toMatch(new RegExp(`^Transition EMISE → REGLEE \\(avoir partiel ${avoirFa.numero}\\) : réglé 0,00\\s€, avoirs 1\\s481,40\\s€, reste dû 0,00\\s€$`));

  expect(erreursPage, 'aucune erreur de la page').toEqual([]);
  expect(refusApi, 'aucun refus d’API pendant le parcours').toEqual([]);
});
