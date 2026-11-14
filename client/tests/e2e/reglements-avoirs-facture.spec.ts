import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import type { Locator, Page } from '@playwright/test';
import { test, expect, dateDuJour, horsDuPassageDeMinuit } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot « Détail des avoirs comme règlements, à l'écran et sur le PDF » (cadrage v2, § 1 et section « Tests » : « E2E : panneau avec
// un avoir, PDF téléchargé » ; critères 1, 6, 7 et 10 ; T1 du contrôle de mode 1 : le panneau à 320 et 375 px). Réponse de Nelson
// du 10-11-2026 au point 4, mot pour mot : « oui c'est bien ca, avec le detail des avoir en tant que reglement. » Choix d'affichage
// par défaut, à confirmer, éprouvés tels qu'écrits : tableau « Règlements et avoirs de la facture », colonnes « Date »,
// « Règlement », « Montant », « Statut » ; ligne d'avoir « Avoir <numéro> », date d'émission, TTC, « Émis » ; ordre : date civile,
// instant de saisie, identifiant ; pied « Paiements : X € · Avoirs : Y € · Reste dû : Z € », ou « … · Trop-perçu : Z € », lu dans
// le solde de la réponse ; « Aucun règlement reçu. » sans part ni avoir.
//
// Parcours dans Chromium, par l'administration, libellés français, dates JJ-MM-AAAA, montants au format français :
//  1. FA (1 × 2 000,00 € HT à 20 %, TTC 2 400,00 €) : paiement de 500,00 € (virement), avoir partiel de 1 × 250,00 € HT (TTC
//     300,00 €), paiement de 100,00 € (chèque) contre-passé, saisis dans cet ordre le même jour : trois lignes dans cet ordre, le
//     pied « Paiements : 500,00 € · Avoirs : 300,00 € · Reste dû : 1 600,00 € » (lectures écartées : contre-passé compté,
//     1 500,00 € ; avoir déduit hors taxes, 1 650,00 €) ; le PDF téléchargé depuis l'écran porte le bloc « Règlements et avoirs »
//     (paiement, avoir, « Reste à payer : 1 600,00 € », sans le contre-passé) ;
//  2. le même panneau à 320 et 375 px : rien de coupé hors de l'écran ni rogné par son cadre, aucun titre recouvert (mesure de
//     entetes-mobile.spec.ts) ;
//  3. FB (TTC 120,00 €) soldée par un avoir de 120,00 € : une ligne « Avoir … », pas de « Aucun règlement reçu. », pied
//     « Paiements : 0,00 € · Avoirs : 120,00 € · Reste dû : 0,00 € » ; son PDF porte « Facture réglée par avoir. » ;
//  4. FC (TTC 120,00 €) réglée de 125,50 € : pied « … · Trop-perçu : 5,50 € » (lecture écartée : « Reste dû : -5,50 € ») ;
//  5. FD (TTC 120,00 €) sans règlement ni avoir : « Aucun règlement reçu. », aucun tableau.
// Les espaces des montants à l'écran (U+202F des milliers, U+00A0 avant « € ») sont lus par \s ; sur le PDF, les milliers sont
// une espace ordinaire et « € » l'octet 0x80 du jeu WinAnsi.

type Piece = { id: string; numero: string | null; type: string; statut: string; totalHt: number; totalTva: number; totalTtc: number };

// Texte d'un PDF produit par PDFKit (copie de compte-rendu-pdf.spec.ts) : les chaînes des opérateurs TJ et Tj de chaque flux de
// contenu, décompressé, lues en latin1.
function texteDuPdf(octets: Buffer): string {
  const brut = octets.toString('latin1');
  const lignes: string[] = [];
  for (const flux of brut.matchAll(/stream\r?\n/g)) {
    const debut = flux.index! + flux[0].length;
    let contenu: string;
    try { contenu = inflateSync(octets.subarray(debut, brut.indexOf('endstream', debut))).toString('latin1'); } catch { continue; }
    for (const [operation] of contenu.matchAll(/\[(?:[^\]]*)\]\s*TJ|<[0-9A-Fa-f]*>\s*Tj/g)) {
      lignes.push([...operation.matchAll(/<([0-9A-Fa-f]*)>/g)].map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1')).join(''));
    }
  }
  return lignes.join('\n');
}

// Mesure des défauts d'affichage sur téléphone (copie de defautsAffichage, entetes-mobile.spec.ts, qui ne l'exporte pas) : rien ne
// sort de l'écran ni n'est rogné par son cadre, hors du contenu d'un conteneur défilant ; aucun titre sous un bouton.
async function defautsAffichage(page: Page) {
  return page.evaluate(() => {
    const largeur = window.innerWidth;
    const principal = document.querySelector('main');
    const tolerance = 0.5;
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const ancetres = (el: Element) => {
      const liste: { el: Element; defile: boolean }[] = [];
      for (let p = el.parentElement; p && p !== principal && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (['auto', 'scroll'].includes(ox)) liste.push({ el: p, defile: true });
        else if (['hidden', 'clip'].includes(ox)) liste.push({ el: p, defile: false });
      }
      return liste;
    };
    const libelle = (el: Element) => (el.textContent || (el as HTMLInputElement).placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const coupes: string[] = [];
    if (principal && principal.scrollWidth > principal.clientWidth + tolerance) coupes.push(`zone principale : ${principal.scrollWidth} px de contenu pour ${principal.clientWidth}`);
    for (const el of Array.from(document.querySelectorAll('main *'))) {
      if (!visible(el) || (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') || el.closest('[aria-hidden="true"]:not(svg)')) continue;
      const r = el.getBoundingClientRect();
      const cadres = ancetres(el);
      const premier = cadres[0];
      if (premier?.defile) continue;
      if (r.right > largeur + tolerance || r.left < -tolerance) { coupes.push(`${el.tagName.toLowerCase()} hors de l'écran « ${libelle(el)} »`); continue; }
      if (premier && !premier.defile) {
        const c = premier.el.getBoundingClientRect();
        if (r.right > c.right + tolerance || r.left < c.left - tolerance) coupes.push(`${el.tagName.toLowerCase()} rogné par son cadre « ${libelle(el)} »`);
      }
      if (Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())) {
        for (let p = el.parentElement; p && p !== principal; p = p.parentElement) {
          const style = getComputedStyle(p);
          if (parseFloat(style.borderRightWidth) > 0 || style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
            const c = p.getBoundingClientRect();
            if (r.right > c.right + tolerance || r.left < c.left - tolerance) coupes.push(`${el.tagName.toLowerCase()} déborde de sa carte « ${libelle(el)} »`);
            break;
          }
        }
      }
    }
    const recouverts: string[] = [];
    for (const titre of Array.from(document.querySelectorAll('main h1, main h2'))) {
      const t = titre.getBoundingClientRect();
      if (!t.width || t.top > 700) continue;
      for (const el of Array.from(document.querySelectorAll('main button, main a'))) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && r.left < t.right - 1 && r.right > t.left + 1 && r.top < t.bottom - 1 && r.bottom > t.top + 1 && !titre.contains(el) && !el.contains(titre)) {
          recouverts.push(`« ${libelle(titre)} » sous « ${libelle(el)} »`);
        }
      }
    }
    return { coupes: [...new Set(coupes)].slice(0, 15), recouverts };
  });
}

// La ligne d'une pièce, cherchée de page en page (la base E2E est partagée et conservée ; modèle : statut-facture-avoirs.spec.ts).
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

// Le panneau d'une facture, ouvert depuis sa ligne.
async function ouvrirPanneau(page: Page, raisonSociale: string, facture: Piece) {
  const ligne = await ligneDe(page, raisonSociale, facture.numero!);
  await ligne.getByRole('button', { name: 'Règlements', exact: true }).click();
  const panneau = page.getByRole('region', { name: 'Règlements de la facture' });
  await expect(panneau.getByRole('heading', { name: `Règlements de la facture ${facture.numero}` })).toBeVisible();
  await expect(panneau.getByRole('status')).toHaveCount(0);
  return panneau;
}

test('panneau « Règlements et avoirs de la facture » : paiements et avoirs mêlés dans l’ordre de saisie, contre-passé affiché, pied « Paiements · Avoirs · Reste dû » (1 600,00 €) ou « Trop-perçu » ; facture soldée par avoir sans « Aucun règlement reçu. » ; PDF téléchargé avec le bloc ; panneau à 320 et 375 px', async ({ allerSurPageAdmin, request, session, creerClient }) => {
  test.slow();
  await horsDuPassageDeMinuit();
  const admin = { Authorization: `Bearer ${session.token}` };
  const appel = async <T>(path: string, data: object) => {
    const reponse = await request.post(`${api}${path}`, { headers: admin, data });
    expect(reponse.ok(), `${path} : ${await reponse.text()}`).toBeTruthy();
    return reponse.json() as Promise<T>;
  };
  const client = await creerClient('règlements et avoirs');
  const facture = async (designation: string, prixUnitaireHt: number) => {
    const brouillon = await appel<Piece>('/factures', { clientId: client.id, origine: 'HORS_AFFAIRE', motifHorsAffaire: `Règlements et avoirs ${designation}`, dateEmission: dateDuJour(), dateEcheance: dateDuJour(), lignes: [{ designation, nature: 'PRESTATION', quantite: 1, prixUnitaireHt, tauxTva: 20 }] });
    return appel<Piece>(`/factures/${brouillon.id}/emettre`, {});
  };
  const avoir = (id: string, designation: string, prixUnitaireHt: number) => appel<Piece>(`/factures/${id}/avoirs`, { lignes: [{ designation, nature: 'PRESTATION', quantite: 1, prixUnitaireHt, tauxTva: 20 }] });
  const regler = (id: string, montant: number, moyen: string, reference: string) => appel<{ id: string }>('/reglements', { clientId: client.id, dateReglement: dateDuJour(), montant, moyen, reference, affectations: [{ factureId: id, montant }] });

  // FA : paiement, avoir, paiement contre-passé, dans cet ordre.
  const fa = await facture('Installation de la chaufferie', 2000);
  expect([fa.statut, fa.totalTtc]).toEqual(['EMISE', 2400]);
  const referenceFa = `VIR-RA-${Date.now()}`;
  await regler(fa.id, 500, 'VIREMENT', referenceFa);
  const avoirFa = await avoir(fa.id, 'Reprise du brûleur', 250);
  expect([avoirFa.totalHt, avoirFa.totalTtc]).toEqual([250, 300]);
  const contrepasse = await regler(fa.id, 100, 'CHEQUE', `CHQ-RA-${Date.now()}`);
  await appel(`/reglements/${contrepasse.id}/contrepasser`, { motif: 'Chèque saisi par erreur' });
  // FB : soldée par un avoir ; FC : trop-perçu ; FD : rien.
  const fb = await facture('Contrôle annuel', 100);
  const avoirFb = await avoir(fb.id, 'Reprise du contrôle', 100);
  expect(avoirFb.totalTtc).toBe(120);
  const fc = await facture('Dépannage', 100);
  await regler(fc.id, 125.5, 'CHEQUE', `CHQ-RC-${Date.now()}`);
  const fd = await facture('Visite', 100);

  const page = await allerSurPageAdmin('/factures');
  const erreursPage: string[] = [];
  page.on('pageerror', (erreur) => erreursPage.push(erreur.message));
  const refusApi: string[] = [];
  page.on('response', (reponse) => {
    if (new URL(reponse.url()).pathname.startsWith('/api/') && reponse.status() >= 400) refusApi.push(`${reponse.request().method()} ${new URL(reponse.url()).pathname} : ${reponse.status()}`);
  });
  await expect(page.getByRole('heading', { name: 'Factures', level: 1 })).toBeVisible();

  // 1. FA : trois lignes dans l'ordre de saisie, le contre-passé compris ; pied du solde.
  let panneau = await ouvrirPanneau(page, client.raisonSociale, fa);
  const tableau = panneau.getByRole('table', { name: 'Règlements et avoirs de la facture' });
  await expect(tableau.locator('thead th')).toHaveText(['Date', 'Règlement', 'Montant', 'Statut']);
  const lignes = tableau.locator('tbody tr');
  await expect(lignes).toHaveCount(3);
  await expect(lignes.nth(0).locator('td').nth(0)).toHaveText(dateDuJour());
  await expect(lignes.nth(0).locator('td').nth(1)).toHaveText(`VirementRéf. ${referenceFa}`);
  await expect(lignes.nth(0).locator('td').nth(2)).toHaveText(/^500,00\s€$/);
  await expect(lignes.nth(0).locator('td').nth(3)).toHaveText('Enregistré');
  // Lecture écartée : avoir affiché hors taxes (250,00 €).
  await expect(lignes.nth(1).locator('td')).toHaveText([dateDuJour(), `Avoir ${avoirFa.numero}`, /^300,00\s€$/, 'Émis']);
  await expect(lignes.nth(2).locator('td').nth(1)).toContainText('Chèque');
  await expect(lignes.nth(2).locator('td').nth(2)).toHaveText(/^100,00\s€$/);
  await expect(lignes.nth(2).locator('td').nth(3)).toContainText(new RegExp(`^Contre-passé le ${dateDuJour()} \\d{2}:\\d{2}:\\d{2}`));
  await expect(lignes.nth(2).locator('td').nth(3)).toContainText('Motif : Chèque saisi par erreur');
  // Lectures écartées : contre-passé compté (Paiements 600,00 €, reste 1 500,00 €) ; avoir hors taxes (1 650,00 €).
  await expect(tableau.locator('tfoot')).toHaveText(/^Paiements : 500,00\s€ · Avoirs : 300,00\s€ · Reste dû : 1\s600,00\s€$/);
  await expect(panneau.getByText('Aucun règlement reçu.')).toHaveCount(0);

  // PDF téléchargé depuis l'écran : le bloc, sans le contre-passé ni la référence.
  const ligneFa = await ligneDe(page, client.raisonSociale, fa.numero!);
  const telechargement = page.waitForEvent('download');
  await ligneFa.getByRole('button', { name: 'PDF', exact: true }).click();
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toBe(`${fa.numero}.pdf`);
  const texte = texteDuPdf(await readFile(await fichier.path() as string));
  for (const attendu of ['Règlements et avoirs', `Paiement du ${dateDuJour()} (virement) : 500,00 \x80`, `Avoir ${avoirFa.numero} du ${dateDuJour()} : 300,00 \x80`, 'Reste à payer : 1 600,00 \x80']) {
    expect(texte, `PDF : « ${attendu} »`).toContain(attendu);
  }
  for (const absent of ['100,00 \x80', referenceFa, 'Facture réglée']) expect(texte, `PDF sans « ${absent} »`).not.toContain(absent);

  // 2. T1 : le panneau ouvert, à 320 et 375 px.
  for (const largeur of [320, 375]) {
    await page.setViewportSize({ width: largeur, height: 800 });
    await expect(tableau.locator('tfoot')).toBeVisible();
    expect(await defautsAffichage(page), `panneau à ${largeur} px`).toEqual({ coupes: [], recouverts: [] });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await panneau.getByRole('button', { name: 'Fermer' }).click();
  await expect(panneau).toHaveCount(0);

  // 3. FB, soldée par son avoir : une ligne, sans « Aucun règlement reçu. » ; PDF « Facture réglée par avoir. ».
  panneau = await ouvrirPanneau(page, client.raisonSociale, fb);
  const tableauFb = panneau.getByRole('table', { name: 'Règlements et avoirs de la facture' });
  await expect(tableauFb.locator('tbody tr')).toHaveCount(1);
  await expect(tableauFb.locator('tbody tr').first().locator('td')).toHaveText([dateDuJour(), `Avoir ${avoirFb.numero}`, /^120,00\s€$/, 'Émis']);
  await expect(tableauFb.locator('tfoot')).toHaveText(/^Paiements : 0,00\s€ · Avoirs : 120,00\s€ · Reste dû : 0,00\s€$/);
  await expect(panneau.getByText('Aucun règlement reçu.')).toHaveCount(0);
  const ligneFb = await ligneDe(page, client.raisonSociale, fb.numero!);
  const telechargementFb = page.waitForEvent('download');
  await ligneFb.getByRole('button', { name: 'PDF', exact: true }).click();
  const texteFb = texteDuPdf(await readFile(await (await telechargementFb).path() as string));
  expect(texteFb).toContain('Facture réglée par avoir.');
  expect(texteFb).toContain(`Avoir ${avoirFb.numero} du ${dateDuJour()} : 120,00 \x80`);
  expect(texteFb).not.toContain('Reste à payer');
  await panneau.getByRole('button', { name: 'Fermer' }).click();

  // 4. FC, trop-perçu de 5,50 €.
  panneau = await ouvrirPanneau(page, client.raisonSociale, fc);
  await expect(panneau.getByRole('table', { name: 'Règlements et avoirs de la facture' }).locator('tfoot')).toHaveText(/^Paiements : 125,50\s€ · Avoirs : 0,00\s€ · Trop-perçu : 5,50\s€$/);
  await panneau.getByRole('button', { name: 'Fermer' }).click();

  // 5. FD, ni règlement ni avoir.
  panneau = await ouvrirPanneau(page, client.raisonSociale, fd);
  await expect(panneau.getByText('Aucun règlement reçu.')).toBeVisible();
  await expect(panneau.getByRole('table')).toHaveCount(0);

  expect(erreursPage, 'aucune erreur de la page').toEqual([]);
  expect(refusApi, 'aucun refus d’API pendant le parcours').toEqual([]);
});

// Audit des montants de #534 (remarque R1) : le panneau ouvert suit les avoirs créés depuis le même écran. Facture de 120,00 €
// (1 × 100,00 € HT à 20 %) réglée de 50,00 € : panneau ouvert, pied « Paiements : 50,00 € · Avoirs : 0,00 € · Reste dû :
// 70,00 € ». Avoir partiel de 1 × 10,00 € HT (TTC 12,00 €) créé depuis l'écran, panneau toujours ouvert : la liste est relue, et
// le panneau doit l'être aussi, avec la ligne de l'avoir et le pied « Paiements : 50,00 € · Avoirs : 12,00 € · Reste dû :
// 58,00 € ». Lecture écartée : panneau resté sur l'instantané d'avant l'avoir (une ligne, « Reste dû : 70,00 € », alors que la
// liste affiche déjà 58,00 €).
test('panneau ouvert : un avoir partiel créé depuis l’écran y paraît, avec le pied relu (Reste dû 58,00 € et non 70,00 €)', async ({ allerSurPageAdmin, request, session, creerClient }) => {
  await horsDuPassageDeMinuit();
  const admin = { Authorization: `Bearer ${session.token}` };
  const appel = async <T>(path: string, data: object) => {
    const reponse = await request.post(`${api}${path}`, { headers: admin, data });
    expect(reponse.ok(), `${path} : ${await reponse.text()}`).toBeTruthy();
    return reponse.json() as Promise<T>;
  };
  const client = await creerClient('panneau relu après un avoir');
  const brouillon = await appel<Piece>('/factures', { clientId: client.id, origine: 'HORS_AFFAIRE', motifHorsAffaire: 'Panneau relu après un avoir', dateEmission: dateDuJour(), dateEcheance: dateDuJour(), lignes: [{ designation: 'Entretien de la pompe à chaleur', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 }] });
  const facture = await appel<Piece>(`/factures/${brouillon.id}/emettre`, {});
  expect([facture.statut, facture.totalTtc]).toEqual(['EMISE', 120]);
  await appel('/reglements', { clientId: client.id, dateReglement: dateDuJour(), montant: 50, moyen: 'VIREMENT', reference: `VIR-RELU-${Date.now()}`, affectations: [{ factureId: facture.id, montant: 50 }] });

  const page = await allerSurPageAdmin('/factures');
  await expect(page.getByRole('heading', { name: 'Factures', level: 1 })).toBeVisible();
  const panneau = await ouvrirPanneau(page, client.raisonSociale, facture);
  const tableau = panneau.getByRole('table', { name: 'Règlements et avoirs de la facture' });
  await expect(tableau.locator('tbody tr')).toHaveCount(1);
  await expect(tableau.locator('tfoot')).toHaveText(/^Paiements : 50,00\s€ · Avoirs : 0,00\s€ · Reste dû : 70,00\s€$/);

  const ligne = await ligneDe(page, client.raisonSociale, facture.numero!);
  await ligne.getByRole('button', { name: /Créer un avoir partiel/ }).click();
  await expect(page.getByRole('heading', { name: /Nouvel avoir partiel/ })).toBeVisible();
  await page.locator('input[aria-label="Désignation ligne avoir 1"]').fill('Geste commercial');
  await page.locator('select[aria-label="Nature ligne avoir 1"]').selectOption('PRESTATION');
  await page.locator('input[aria-label="Quantité ligne avoir 1"]').fill('1');
  await page.locator('input[aria-label="Prix unitaire HT ligne avoir 1"]').fill('10');
  await page.locator('input[aria-label="TVA ligne avoir 1"]').fill('20');
  await page.getByRole('button', { name: /Créer l’avoir partiel/ }).click();
  await expect(page.getByText(/Avoir .* créé et émis/)).toBeVisible();
  await expect(page.locator('tbody [role="status"]')).toHaveCount(0);

  // Le panneau, resté ouvert, porte l'avoir et le solde relus.
  await expect(panneau).toBeVisible();
  await expect(tableau.locator('tbody tr')).toHaveCount(2);
  await expect(tableau.locator('tbody tr').nth(1).locator('td').nth(2)).toHaveText(/^12,00\s€$/);
  await expect(tableau.locator('tfoot')).toHaveText(/^Paiements : 50,00\s€ · Avoirs : 12,00\s€ · Reste dû : 58,00\s€$/);
});

// La ligne d'un avoir dans la liste, cherchée de page en page : `ligneDe` écarte les lignes « Origine : … » des avoirs, et le numéro
// d'un avoir ne figure pas sur la ligne de sa facture.
async function ligneAvoirDe(page: Page, raisonSociale: string, numero: string): Promise<Locator> {
  await expect(page.getByTestId('pagination-factures')).toContainText('document(s)');
  await expect(page.locator('tbody [role="status"]')).toHaveCount(0);
  while (await page.getByRole('button', { name: 'Page précédente' }).isEnabled()) {
    await page.getByRole('button', { name: 'Page précédente' }).click();
    await expect(page.locator('tbody [role="status"]')).toHaveCount(0);
  }
  const ligne = page.locator('tbody tr', { hasText: raisonSociale }).filter({ hasText: numero });
  const presente = async () => {
    try { await expect(ligne.first()).toBeVisible({ timeout: 3_000 }); return true; } catch { return false; }
  };
  while (!(await presente())) {
    const suivante = page.getByRole('button', { name: 'Page suivante' });
    expect(await suivante.isEnabled(), `avoir ${numero} de ${raisonSociale} absent de la pagination`).toBeTruthy();
    await suivante.click();
    await expect(page.locator('tbody [role="status"]')).toHaveCount(0);
  }
  return ligne;
}

// Correctif R1 du passage hebdomadaire du 14-11-2026 (#540), cadrage « libellés du statut et de l'origine des factures », section
// « Tests » : T1 du contrôle (« un même avoir affiché « Émis » en correspondance exacte […] dans la cellule du statut de la liste
// et dans le panneau « Règlements » ») et fiche chantier (« Émise » et « Émis » exacts pour une facture et un avoir liés) ; critère
// « Un même avoir est « Émis » dans la liste, dans les factures liées de la fiche chantier et dans le panneau « Règlements » ».
// Libellés : choix d'affichage par défaut, à confirmer (règle 5). « Émise » contient « Émis » : chaque statut est lu cellule par
// cellule avec toHaveText, jamais avec toContainText. Le serveur garde le code EMISE pour les deux pièces ; seul l'écran accorde.
//
// Parcours dans Chromium, par l'administration : affaire vendue (devis signé converti en chantier) ; sa facture FA (1 × 100,00 € HT
// à 20 %, TTC 120,00 €) émise ; un avoir partiel de FA (1 × 10,00 € HT, TTC 12,00 €) :
//  1. liste des factures : FA « Émise » précisée « Partiellement réglée », origine « Affaire » ; l'avoir « Émis » (lecture écartée,
//     constat de #540 : « EMISE », ou « Émise » comme une facture), origine « Affaire » ;
//  2. panneau « Règlements » de FA : la ligne de l'avoir, statut « Émis » ;
//  3. fiche de l'affaire, « Factures liées » : FA « Facture », « Émise » ; l'avoir « Avoir », « Émis ».
test('un même avoir est « Émis » dans la colonne « Statut » de la liste, dans le panneau « Règlements » et dans les factures liées de la fiche affaire, sa facture « Émise » (correspondances exactes)', async ({ allerSurPageAdmin, request, session, creerClient }) => {
  await horsDuPassageDeMinuit();
  const admin = { Authorization: `Bearer ${session.token}` };
  const appel = async <T>(path: string, data: object) => {
    const reponse = await request.post(`${api}${path}`, { headers: admin, data });
    expect(reponse.ok(), `${path} : ${await reponse.text()}`).toBeTruthy();
    return reponse.json() as Promise<T>;
  };
  const client = await creerClient('libellés du statut');
  const devis = await appel<{ id: string }>('/devis', { clientId: client.id, objet: `Affaire des libellés du statut ${Date.now()}`, lignes: [{ designation: 'Pose de la centrale', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 }] });
  await appel(`/devis/${devis.id}/signature`, { signataire: 'Client E2E', confirme: true });
  const chantier = await appel<{ id: string }>(`/devis/${devis.id}/convertir`, { cible: 'CHANTIER' });
  const brouillon = await appel<Piece>('/factures', { clientId: client.id, origine: 'CHANTIER', chantierId: chantier.id, dateEmission: dateDuJour(), dateEcheance: dateDuJour(), lignes: [{ designation: 'Pose de la centrale', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 }] });
  const facture = await appel<Piece>(`/factures/${brouillon.id}/emettre`, {});
  expect([facture.type, facture.statut, facture.totalTtc]).toEqual(['FACTURE', 'EMISE', 120]);
  const avoir = await appel<Piece>(`/factures/${facture.id}/avoirs`, { lignes: [{ designation: 'Geste commercial', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 10, tauxTva: 20 }] });
  expect([avoir.type, avoir.statut, avoir.totalTtc]).toEqual(['AVOIR', 'EMISE', 12]);

  const page = await allerSurPageAdmin('/factures');
  const erreursPage: string[] = [];
  page.on('pageerror', (erreur) => erreursPage.push(erreur.message));
  const refusApi: string[] = [];
  page.on('response', (reponse) => {
    if (new URL(reponse.url()).pathname.startsWith('/api/') && reponse.status() >= 400) refusApi.push(`${reponse.request().method()} ${new URL(reponse.url()).pathname} : ${reponse.status()}`);
  });
  await expect(page.getByRole('heading', { name: 'Factures', level: 1 })).toBeVisible();
  await expect(page.locator('thead th')).toHaveText(['Type / numéro', 'Client', 'Émission', 'Origine', 'Total TTC', 'Reste dû', 'Statut', 'Actions']);

  // 1. La liste : colonnes « Origine » (4e) et « Statut » (7e).
  const ligneFa = await ligneDe(page, client.raisonSociale, facture.numero!);
  await expect(ligneFa).toHaveCount(1);
  await expect(ligneFa.locator('td').nth(3)).toHaveText('Affaire');
  await expect(ligneFa.locator('td').nth(6)).toHaveText(/^Émise\s*Partiellement réglée$/);
  const ligneAvoir = await ligneAvoirDe(page, client.raisonSociale, avoir.numero!);
  await expect(ligneAvoir).toHaveCount(1);
  await expect(ligneAvoir.locator('td').nth(0)).toContainText(`Origine : ${facture.numero}`);
  await expect(ligneAvoir.locator('td').nth(3)).toHaveText('Affaire');
  await expect(ligneAvoir.locator('td').nth(6)).toHaveText('Émis');

  // 2. Le panneau « Règlements » de FA : la ligne du même avoir, au même libellé.
  const panneau = await ouvrirPanneau(page, client.raisonSociale, facture);
  const lignesPanneau = panneau.getByRole('table', { name: 'Règlements et avoirs de la facture' }).locator('tbody tr');
  await expect(lignesPanneau).toHaveCount(1);
  await expect(lignesPanneau.first().locator('td')).toHaveText([dateDuJour(), `Avoir ${avoir.numero}`, /^12,00\s€$/, 'Émis']);
  await panneau.getByRole('button', { name: 'Fermer' }).click();
  await expect(panneau).toHaveCount(0);

  // 3. La fiche de l'affaire, « Factures liées » : colonnes « Numéro », « Type », « Statut ».
  await page.goto(`/chantiers/${chantier.id}`, { waitUntil: 'networkidle' });
  const liees = page.getByRole('region', { name: 'Factures liées' });
  await expect(liees.locator('thead th').nth(2)).toHaveText('Statut');
  await expect(liees.locator('tbody tr')).toHaveCount(2);
  for (const [piece, type, statut] of [[facture, 'Facture', 'Émise'], [avoir, 'Avoir', 'Émis']] as const) {
    const ligne = liees.locator('tbody tr').filter({ hasText: piece.numero! });
    await expect(ligne).toHaveCount(1);
    await expect(ligne.locator('td').nth(0)).toHaveText(piece.numero!);
    await expect(ligne.locator('td').nth(1)).toHaveText(type);
    await expect(ligne.locator('td').nth(2), `statut de ${piece.numero}`).toHaveText(statut);
  }

  expect(erreursPage, 'aucune erreur de la page').toEqual([]);
  expect(refusApi, 'aucun refus d’API pendant le parcours').toEqual([]);
});
