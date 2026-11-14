import { randomInt } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { test, expect, dateDuJour, horsDuPassageDeMinuit, jetonPour } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot « Assistante technique », PR AT-4 : avoirs de l'assistante technique (cadrage AT-4, version 2, section « Tests », puces
// « Montants » (E2E : « l'aperçu « Nouvel avoir partiel » annonce, pour elle, les totaux de l'avoir créé (format 1 234,56 €) »)
// et « E2E » (« elle crée un avoir partiel et annule une facture depuis l'écran ») ; critères 1, 2, 4 et 6). Décisions de Nelson
// du 09-11-2026, mot pour mot : « Oui il faut un repere deja facturer, elle peut egalement faire un avoir, » ; réponse 1,
// « Partiels et annulation (Recommandé) » : « Elle crée des avoirs partiels et peut aussi annuler une facture émise par son avoir
// total, comme l'administration. Elle envoie ces avoirs. Les règlements lui restent fermés. »
//
// Parcours dans Chromium, libellés français, dates JJ-MM-AAAA, montants au format français :
//  1. sa facture FE (1 × 2 469,13 € HT à 20 % : TVA 493,826 → 493,83 €, TTC 2 962,96 €), créée et émise par elle, porte un premier
//     avoir partiel de l'administration (0,5 × 24,01 = 12,005 → 12,01 € HT, TVA 2,40 €, TTC 14,41 €) ; elle ouvre « Factures » :
//     « Créer un avoir partiel » proposé, l'annulation non (« Annulation totale impossible : 1 avoir(s) partiel(s) déjà émis »), ni
//     « Enregistrer un règlement » ni « Export comptable » ;
//  2. elle saisit un avoir partiel de 1 × 1234,57 € HT à 20 % : l'aperçu annonce 1 234,57 € HT, TVA 246,92 € (TVA de la base
//     cumulée 1 246,58 €, 249,316 → 249,32 €, moins les 2,40 € déjà crédités ; lecture écartée : TVA de l'avoir seul, 246,914 →
//     246,91 €, TTC 1 481,48 €), TTC 1 481,49 € ; l'avoir créé porte ces montants, à son type ; le reste dû de FE devient
//     1 467,06 € (2 962,96 − 14,41 − 1 481,49 ; lectures écartées : TVA de l'avoir seul, 1 467,07 € ; avoir déduit hors taxes,
//     1 713,98 €) ;
//  3. elle envoie son avoir par la messagerie : l'envoi est noté à son nom ;
//  4. elle annule depuis l'écran sa facture FE2 (1 × 1 000,00 € HT à 20 %, TTC 1 200,00 €), émise sans avoir ni règlement : la
//     fenêtre de confirmation, puis « Facture … annulée ; avoir … disponible. », la facture « Annulée » et son avoir total de
//     1 200,00 €, à son type, aux montants de la facture.

type Compte = { id: string; name: string };
type Piece = { id: string; numero: string | null; type: string; statut: string; creeParType: string | null; estAvoirAnnulation?: boolean; totalHt: number; totalTva: number; totalTtc: number; resteDu?: number | null; factureOrigine?: { id: string } | null };

// La ligne d'une pièce, cherchée de page en page (la base E2E est partagée et conservée).
async function ligneDe(page: Page, raisonSociale: string, texte: string | RegExp): Promise<Locator> {
  await expect(page.getByTestId('pagination-factures')).toContainText('document(s)');
  await expect(page.locator('tbody [role="status"]')).toHaveCount(0);
  while (await page.getByRole('button', { name: 'Page précédente' }).isEnabled()) {
    await page.getByRole('button', { name: 'Page précédente' }).click();
    await expect(page.locator('tbody [role="status"]')).toHaveCount(0);
  }
  const ligne = page.locator('tbody tr', { hasText: raisonSociale }).filter({ hasText: texte });
  const presente = async () => {
    try { await expect(ligne.first()).toBeVisible({ timeout: 3_000 }); return true; } catch { return false; }
  };
  while (!(await presente())) {
    const suivante = page.getByRole('button', { name: 'Page suivante' });
    expect(await suivante.isEnabled(), `pièce ${String(texte)} de ${raisonSociale} absente de la pagination`).toBeTruthy();
    await suivante.click();
    await expect(page.locator('tbody [role="status"]')).toHaveCount(0);
  }
  return ligne;
}

test('assistante technique : avoir partiel créé depuis l’écran après celui de l’administration (aperçu 1 234,57 € HT, 246,92 € de TVA, 1 481,49 € TTC), reste dû 1 467,06 €, avoir envoyé à son nom ; facture annulée depuis l’écran par son avoir total de 1 200,00 € ; ni règlement ni export comptable', async ({ connexion, request, session, creerClient }) => {
  test.slow();
  await horsDuPassageDeMinuit();
  const admin = { Authorization: `Bearer ${session.token}` };
  const appel = async <T>(methode: 'post' | 'put', path: string, data: object, headers: Record<string, string>) => {
    const reponse = await request[methode](`${api}${path}`, { headers, data });
    expect(reponse.ok(), `${path} : ${await reponse.text()}`).toBeTruthy();
    return reponse.json() as Promise<T>;
  };
  const suffixe = `${Date.now()}-${randomInt(1_000_000)}`;
  const assistante = await appel<Compte>('post', '/users', { email: `at4.avoirs.${suffixe}@iris.test`, name: `Assistante technique AT-4 ${suffixe}`, role: 'ASSISTANTE_TECHNIQUE' }, admin);
  const elle = { Authorization: `Bearer ${jetonPour(assistante.id)}` };
  const client = await creerClient(`avoirs de l’assistante ${suffixe}`);
  const courriel = `compta.at4.${suffixe}@client-e2e.test`;
  await appel('put', `/clients/${client.id}`, { email: courriel }, admin);
  const facture = async (designation: string, prixUnitaireHt: number) => {
    const brouillon = await appel<Piece>('post', '/factures', { clientId: client.id, origine: 'HORS_AFFAIRE', motifHorsAffaire: `Avoirs AT-4 ${designation}`, dateEmission: dateDuJour(), dateEcheance: dateDuJour(), lignes: [{ designation, nature: 'PRESTATION', quantite: 1, prixUnitaireHt, tauxTva: 20 }] }, elle);
    return appel<Piece>('post', `/factures/${brouillon.id}/emettre`, {}, elle);
  };
  const fe = await facture('Installation de la centrale', 2469.13);
  expect([fe.creeParType, fe.totalHt, fe.totalTva, fe.totalTtc]).toEqual(['ASSISTANTE_TECHNIQUE', 2469.13, 493.83, 2962.96]);
  const premier = await appel<Piece>('post', `/factures/${fe.id}/avoirs`, { lignes: [{ designation: 'Geste de l’administration', nature: 'PRESTATION', quantite: 0.5, prixUnitaireHt: 24.01, tauxTva: 20 }] }, admin);
  expect([premier.creeParType, premier.totalHt, premier.totalTva, premier.totalTtc]).toEqual(['SUPERADMIN', 12.01, 2.4, 14.41]);
  const fe2 = await facture('Contrôle annuel', 1000);
  expect([fe2.totalTtc, fe2.statut]).toEqual([1200, 'EMISE']);

  const page = await connexion(assistante);
  const erreursPage: string[] = [];
  page.on('pageerror', (erreur) => erreursPage.push(erreur.message));
  const refusApi: string[] = [];
  page.on('response', (reponse) => {
    if (new URL(reponse.url()).pathname.startsWith('/api/') && reponse.status() >= 400) refusApi.push(`${reponse.request().method()} ${new URL(reponse.url()).pathname} : ${reponse.status()}`);
  });

  // 1. L'écran : ses actions sur FE, sans règlement ni export.
  await page.goto('/factures', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Factures', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Export comptable/ })).toHaveCount(0);
  const ligneFe = (await ligneDe(page, client.raisonSociale, fe.numero!)).filter({ hasNotText: 'Origine :' });
  // Cellule « Statut » (7e colonne) : « Émise », précisée « Partiellement réglée » par le premier avoir partiel (correctif R1 de
  // #540 : libellé exact, et non le code stocké).
  await expect(ligneFe.locator('td').nth(6)).toHaveText(/^Émise\s*Partiellement réglée$/);
  await expect(ligneFe).toContainText(/2\s962,96\s€/);
  await expect(ligneFe.getByRole('button', { name: 'Créer un avoir partiel', exact: true })).toBeVisible();
  await expect(ligneFe).toContainText('Annulation totale impossible : 1 avoir(s) partiel(s) déjà émis');
  for (const absent of ['Annuler la facture', 'Enregistrer un règlement']) await expect(ligneFe.getByText(absent, { exact: true }), absent).toHaveCount(0);

  // 2. Avoir partiel saisi par elle : aperçu au format français, puis création.
  await ligneFe.getByRole('button', { name: 'Créer un avoir partiel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nouvel avoir partiel' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Désignation ligne avoir 1' }).fill('Reprise de la centrale');
  await page.getByRole('combobox', { name: 'Nature ligne avoir 1' }).selectOption('PRESTATION');
  await page.getByRole('textbox', { name: 'Quantité ligne avoir 1' }).fill('1');
  await page.getByRole('textbox', { name: 'Prix unitaire HT ligne avoir 1' }).fill('1234,57');
  await page.getByRole('textbox', { name: 'TVA ligne avoir 1' }).fill('20');
  const apercu = page.getByTestId('aperçu-avoir');
  await expect(apercu).toContainText(/Total HT\s*1\s234,57\s€/);
  await expect(apercu).toContainText(/TVA\s*246,92\s€/);
  await expect(apercu).toContainText(/Total TTC\s*1\s481,49\s€/);
  await expect(apercu).not.toContainText(/246,91\s€/);
  await expect(apercu).not.toContainText(/1\s481,48\s€/);
  const creation = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/factures/${fe.id}/avoirs` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Créer l’avoir partiel', exact: true }).click();
  const reponseAvoir = await creation;
  expect(reponseAvoir.status()).toBe(201);
  const avoir = await reponseAvoir.json() as Piece;
  expect([avoir.type, avoir.creeParType, avoir.totalHt, avoir.totalTva, avoir.totalTtc]).toEqual(['AVOIR', 'ASSISTANTE_TECHNIQUE', 1234.57, 246.92, 1481.49]);
  await expect(page.getByText(`Avoir ${avoir.numero} créé et émis.`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nouvel avoir partiel' })).toHaveCount(0);
  const ligneAvoir = await ligneDe(page, client.raisonSociale, avoir.numero!);
  await expect(ligneAvoir).toContainText(`Origine : ${fe.numero}`);
  await expect(ligneAvoir).toContainText(/1\s481,49\s€/);
  await expect(ligneAvoir).toContainText(dateDuJour());
  const ligneFeApres = (await ligneDe(page, client.raisonSociale, fe.numero!)).filter({ hasNotText: 'Origine :' });
  await expect(ligneFeApres).toContainText(/1\s467,06\s€/);
  await expect(ligneFeApres).not.toContainText(/1\s467,07\s€|1\s713,98\s€/);
  await expect(ligneFeApres).toContainText('Annulation totale impossible : 2 avoir(s) partiel(s) déjà émis');
  const lue = (await (await request.get(`${api}/factures`, { headers: elle })).json() as Piece[]).find((p) => p.id === fe.id);
  expect(lue?.resteDu).toBe(1467.06);

  // 3. Envoi de son avoir par la messagerie, noté à son nom.
  await ligneAvoir.getByRole('button', { name: `Envoyer l’avoir ${avoir.numero}`, exact: true }).click();
  const dialogue = page.getByRole('dialog', { name: `Envoyer l’avoir ${avoir.numero}` });
  await expect(dialogue.getByRole('textbox', { name: 'Destinataire' })).toHaveValue(courriel);
  const pdf = page.waitForEvent('download');
  await dialogue.getByRole('button', { name: 'Préparer l’envoi' }).click();
  expect((await pdf).suggestedFilename()).toBe(`${avoir.numero}.pdf`);
  await expect(dialogue.getByRole('region', { name: 'Envois' }).getByRole('listitem')).toHaveCount(1);
  await expect(dialogue.getByRole('region', { name: 'Envois' })).toContainText(assistante.name);
  const envois = await (await request.get(`${api}/factures/${avoir.id}/envois`, { headers: admin })).json() as { envois: { destinataire: string; auteurNom: string }[] };
  expect(envois.envois.map((e) => [e.destinataire, e.auteurNom])).toEqual([[courriel, assistante.name]]);
  await dialogue.getByTestId('fermer-envoi').click();
  await expect(dialogue).toHaveCount(0);

  // 4. Annulation de FE2 depuis l'écran, après la fenêtre de confirmation.
  const ligneFe2 = (await ligneDe(page, client.raisonSociale, fe2.numero!)).filter({ hasNotText: 'Origine :' });
  await expect(ligneFe2.getByText('Enregistrer un règlement')).toHaveCount(0);
  const confirmations: string[] = [];
  page.once('dialog', (fenetre) => { confirmations.push(fenetre.message()); void fenetre.accept(); });
  const annulation = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/factures/${fe2.id}/annuler`);
  await ligneFe2.getByRole('button', { name: 'Annuler la facture', exact: true }).click();
  const reponseAnnulation = await annulation;
  expect(reponseAnnulation.status()).toBe(200);
  expect(confirmations).toHaveLength(1);
  expect(confirmations[0]).toContain(`Annuler la facture ${fe2.numero} ?`);
  const annulee = await reponseAnnulation.json() as Piece & { avoir: Piece };
  expect([annulee.statut, annulee.avoir.type, annulee.avoir.estAvoirAnnulation, annulee.avoir.creeParType, annulee.avoir.totalHt, annulee.avoir.totalTva, annulee.avoir.totalTtc])
    .toEqual(['ANNULEE', 'AVOIR', true, 'ASSISTANTE_TECHNIQUE', 1000, 200, 1200]);
  await expect(page.getByText(`Facture ${fe2.numero} annulée ; avoir ${annulee.avoir.numero} disponible.`)).toBeVisible();
  const ligneFe2Apres = (await ligneDe(page, client.raisonSociale, fe2.numero!)).filter({ hasNotText: 'Origine :' });
  // Cellule « Statut » (7e colonne) : libellé exact, et non le code stocké (correctif R1 de #540, cadrage, section « Tests »).
  await expect(ligneFe2Apres.locator('td').nth(6)).toHaveText('Annulée');
  for (const absent of ['Annuler la facture', 'Créer un avoir partiel']) await expect(ligneFe2Apres.getByText(absent, { exact: true }), absent).toHaveCount(0);
  const ligneAvoirTotal = await ligneDe(page, client.raisonSociale, annulee.avoir.numero!);
  await expect(ligneAvoirTotal).toContainText(`Origine : ${fe2.numero}`);
  await expect(ligneAvoirTotal).toContainText(/1\s200,00\s€/);
  await expect(ligneAvoirTotal.getByRole('button', { name: `Envoyer l’avoir ${annulee.avoir.numero}`, exact: true })).toBeVisible();

  expect(erreursPage, 'aucune erreur de la page').toEqual([]);
  expect(refusApi, 'aucun refus d’API pendant le parcours').toEqual([]);
});
