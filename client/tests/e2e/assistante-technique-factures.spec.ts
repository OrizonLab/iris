import { randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect, choisirClient, dateDuJour, horsDuPassageDeMinuit, jetonPour } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot « Assistante technique », PR AT-3 « Factures » (cadrage AT-3, version 2 ; T9 du contrôle de cohérence de mode 1 : « l'écran
// se charge sans erreur pour elle ; la section Facturation du menu ne montre que « Factures » ; la ligne « Dernière facture
// numérotée » s'affiche ; elle envoie une facture, le journal des envois est à son nom ; « Envoyer » est masqué sur un avoir ;
// les règlements de sa facture sont affichés »). Décisions de Nelson du 24-10-2026, points 27 (« L’assistante technique peut tout
// a fait emetre des factures, elle pourra les envoyer elle meme »), 30 (« non elle ne fait pas les avoir ou saisir des
// reglement »), 33 (ses factures, leurs avoirs et leurs règlements en lecture) et 36 (export comptable retiré) ; réponse 6 du
// 06-11-2026 ; réponse 1 du 09-11-2026. Choix par défaut, à confirmer, éprouvés tels quels : envoi d'un avoir fermé (C4).
//
// PR AT-4 (cadrage AT-4 v2, § 3, et N11 du contrôle de mode 1 ; message de Nelson du 09-11-2026, « elle peut egalement faire un
// avoir, », et réponse 1, « Partiels et annulation (Recommandé) » : « Elle envoie ces avoirs. Les règlements lui restent
// fermés. ») : ce parcours est mis à jour. « Créer un avoir partiel » et « Annuler la facture » lui sont montrés aux mêmes
// conditions qu'à l'administration (« Annulation totale impossible : … » compris), « Envoyer » sur un avoir aussi (choix par
// défaut, à confirmer, pour l'avoir de l'administration) ; « Enregistrer un règlement » et « Export comptable » restent masqués.
// Ses propres avoirs, l'aperçu et l'annulation depuis l'écran : assistante-technique-avoirs.spec.ts.
//
// Parcours dans Chromium, libellés français, dates JJ-MM-AAAA, montants au format français :
//  1. connectée, elle ouvre « Factures » depuis son menu (section Facturation réduite à cette entrée) : l'écran se charge sans
//     erreur ni refus d'API, avec « Dernière facture numérotée » au jour de la société, sans « Export comptable » ;
//  2. elle crée un brouillon hors affaire (1,5 × 12,33 € HT à 20 % : 18,495 arrondi à 18,50 € HT, TTC 22,20 € ; lecture écartée :
//     troncature, 18,49 € et 22,19 € ; l'arrondi au pair donne aussi 18,50 € et n'est pas écarté ici : il l'est par le bloc
//     « Assistante technique (AT-3) » de server/tests/api.test.mjs), relu par l'API à son type, puis l'émet ;
//  3. elle télécharge le PDF de sa facture, puis l'envoie par la messagerie : l'envoi est noté à son nom ; sur sa facture émise,
//     sans avoir ni règlement, « Créer un avoir partiel » et « Annuler la facture » lui sont proposés (AT-4), « Enregistrer un
//     règlement » non ;
//  4. l'administration crée un avoir partiel (5,00 € HT, 6,00 € TTC) et enregistre un règlement de 10,00 € sur sa facture : elle
//     lit l'avoir (PDF), et l'envoie par la messagerie, noté à son nom (AT-4) ; le reste dû 6,20 € (22,20 − 6,00 − 10,00 ; lecture
//     écartée : avoir déduit hors taxes, 7,20 €), et, dans « Règlements de la facture », l'avoir puis la part du règlement, mêlés
//     dans l'ordre de leur saisie, avec le pied « Paiements : 10,00 € · Avoirs : 6,00 € · Reste dû : 6,20 € » (lot « Détail des
//     avoirs comme règlements », cadrage v2, § 1, et C1 du contrôle de mode 1) ; un autre avoir partiel lui est proposé,
//     l'annulation non (« Annulation totale impossible : 1 avoir(s) partiel(s) déjà émis »), le règlement non ;
//  5. la facture de l'administration au même client ne lui apparaît sur aucune page de la liste.

type Compte = { id: string; name: string };
type Facture = { id: string; numero: string | null; type: string; creeParType: string | null; totalHt: number; totalTva: number; totalTtc: number; clientId: string };

// Lignes du client dans la liste paginée, page après page (la base E2E est partagée et conservée) : le texte de chaque ligne.
async function lignesDuClient(page: Page, raisonSociale: string) {
  await expect(page.getByTestId('pagination-factures')).toContainText('document(s)');
  await expect(page.locator('tbody [role="status"]')).toHaveCount(0);
  while (await page.getByRole('button', { name: 'Page précédente' }).isEnabled()) {
    await page.getByRole('button', { name: 'Page précédente' }).click();
    await expect(page.locator('tbody [role="status"]')).toHaveCount(0);
  }
  const textes: string[] = [];
  for (;;) {
    textes.push(...await page.locator('tbody tr', { hasText: raisonSociale }).allInnerTexts());
    const suivante = page.getByRole('button', { name: 'Page suivante' });
    if (!await suivante.isEnabled()) return textes;
    await suivante.click();
    await expect(page.locator('tbody [role="status"]')).toHaveCount(0);
  }
}
// La ligne d'une pièce, cherchée de page en page.
async function ligneDe(page: Page, raisonSociale: string, texte: string | RegExp): Promise<Locator> {
  await expect(page.getByTestId('pagination-factures')).toContainText('document(s)');
  await expect(page.locator('tbody [role="status"]')).toHaveCount(0);
  const ligne = page.locator('tbody tr', { hasText: raisonSociale }).filter({ hasText: texte });
  // La liste relue après une action (émission, actualisation) peut arriver après le message de succès : la ligne est attendue
  // un court instant sur la page affichée avant de passer à la suivante.
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
async function revenirEnPremierePage(page: Page) {
  while (await page.getByRole('button', { name: 'Page précédente' }).isEnabled()) {
    await page.getByRole('button', { name: 'Page précédente' }).click();
    await expect(page.locator('tbody [role="status"]')).toHaveCount(0);
  }
}

async function preparer(request: APIRequestContext, token: string, creerClient: (libelle: string, avecSite?: boolean) => Promise<{ id: string; raisonSociale: string }>) {
  const headers = { Authorization: `Bearer ${token}` };
  const envoyer = async (methode: 'post' | 'put', path: string, data: object = {}) => {
    const reponse = await request[methode](`${api}${path}`, { headers, data });
    expect(reponse.ok(), `${path} : ${await reponse.text()}`).toBeTruthy();
    return reponse.json();
  };
  const suffixe = `${Date.now()}-${randomInt(1_000_000)}`;
  const assistante = await envoyer('post', '/users', { email: `at3.assistante.${suffixe}@iris.test`, name: `Assistante technique AT-3 ${suffixe}`, role: 'ASSISTANTE_TECHNIQUE' }) as Compte;
  const client = await creerClient(`assistante factures ${suffixe}`);
  const courriel = `compta.at3.${suffixe}@client-e2e.test`;
  await envoyer('put', `/clients/${client.id}`, { email: courriel });
  // Facture de l'administration au même client, émise au jour de la société : elle ne doit pas apparaître à l'assistante.
  const brouillonAdmin = await envoyer('post', '/factures', { clientId: client.id, origine: 'HORS_AFFAIRE', motifHorsAffaire: 'Facture de l’administration AT-3', dateEmission: dateDuJour(), dateEcheance: dateDuJour(), lignes: [{ designation: 'Contrôle par l’administration', quantite: 1, prixUnitaireHt: 77.77, tauxTva: 20 }] }) as Facture;
  const factureAdmin = await envoyer('post', `/factures/${brouillonAdmin.id}/emettre`) as Facture;
  expect(factureAdmin.creeParType, 'facture de l’administration').toBe('SUPERADMIN');
  return { assistante, client, courriel, factureAdmin, envoyer };
}

test('assistante technique : écran Factures sans erreur, brouillon créé et émis par elle, PDF et envoi à son nom ; avoir partiel et annulation proposés sur sa facture (AT-4) ; avoir et règlement de l’administration lus, l’avoir envoyé par elle, sans saisie de règlement ; la facture de l’administration ne lui apparaît pas', async ({ connexion, request, session, creerClient }) => {
  test.slow();
  await horsDuPassageDeMinuit();
  const { assistante, client, courriel, factureAdmin, envoyer } = await preparer(request, session.token, creerClient);
  const page = await connexion(assistante);
  // Aucune erreur de la page, aucun refus d'API au chargement de l'écran (un 403 sur une lecture du Promise.all casserait l'écran).
  const erreursPage: string[] = [];
  page.on('pageerror', (erreur) => erreursPage.push(erreur.message));
  const refusApi: string[] = [];
  page.on('response', (reponse) => {
    if (new URL(reponse.url()).pathname.startsWith('/api/') && reponse.status() >= 400) refusApi.push(`${reponse.request().method()} ${new URL(reponse.url()).pathname} : ${reponse.status()}`);
  });
  // Listes des factures reçues par l'écran : jamais la pièce de l'administration.
  const idsLus = new Set<string>();
  page.on('response', async (reponse) => {
    if (new URL(reponse.url()).pathname === '/api/factures' && reponse.request().method() === 'GET' && reponse.ok()) {
      const corps = await reponse.json().catch(() => null) as { items?: Facture[] } | null;
      for (const f of corps?.items ?? []) idsLus.add(f.id);
    }
  });

  // 1. Menu, écran, dernière facture numérotée, sans export.
  await page.goto('/', { waitUntil: 'networkidle' });
  const facturation = page.locator('#menu-principal [role="group"][aria-label="Facturation"]');
  await expect(facturation.getByRole('link')).toHaveText(['Factures']);
  await facturation.getByRole('link', { name: 'Factures', exact: true }).click();
  await expect(page).toHaveURL(/\/factures$/);
  await expect(page.getByRole('heading', { name: 'Factures', level: 1 })).toBeVisible();
  await expect(page.getByTestId('pagination-factures')).toContainText('document(s)');
  await expect(page.getByTestId('derniere-date-facture')).toHaveText(`Dernière facture numérotée : ${dateDuJour()}.`);
  await expect(page.getByRole('button', { name: /Export comptable/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Nouvelle facture/ })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(refusApi, 'aucun refus d’API au chargement').toEqual([]);

  // 2. Brouillon créé par elle, au format français, puis émis.
  await page.getByRole('button', { name: /Nouvelle facture/ }).click();
  await choisirClient(page, client);
  await expect(page.getByRole('textbox', { name: 'Date d’émission' })).toHaveValue(dateDuJour());
  await page.locator('input[name="motifHorsAffaire"]').fill('Dépannage hors contrat AT-3');
  await page.getByRole('textbox', { name: 'Désignation ligne 1' }).fill('Remplacement du détecteur');
  await page.getByRole('textbox', { name: 'Quantité ligne 1' }).fill('1,5');
  await page.getByRole('textbox', { name: 'Prix unitaire HT ligne 1' }).fill('12,33');
  const creation = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/factures' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
  const reponseCreation = await creation;
  expect(reponseCreation.status()).toBe(201);
  const brouillon = await reponseCreation.json() as Facture;
  expect([brouillon.creeParType, brouillon.totalHt, brouillon.totalTva, brouillon.totalTtc]).toEqual(['ASSISTANTE_TECHNIQUE', 18.5, 3.7, 22.2]);
  await expect(page.getByText(/Brouillon créé/)).toBeVisible();
  const ligneBrouillon = await ligneDe(page, client.raisonSociale, 'Brouillon');
  await expect(ligneBrouillon).toContainText(/22,20\s€/);
  await expect(ligneBrouillon).toContainText(dateDuJour());
  await expect(ligneBrouillon.getByRole('button', { name: /^Envoyer/ })).toHaveCount(0);
  const emission = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/factures/${brouillon.id}/emettre`);
  await ligneBrouillon.getByRole('button', { name: 'Émettre', exact: true }).click();
  const reponseEmission = await emission;
  expect(reponseEmission.status()).toBe(200);
  const emise = await reponseEmission.json() as Facture;
  expect(emise.numero).toBeTruthy();
  await expect(page.getByText(`Facture ${emise.numero} émise et figée.`)).toBeVisible();

  // 3. PDF et envoi de sa facture.
  const ligne = await ligneDe(page, client.raisonSociale, emise.numero!);
  // Cellule « Statut » (7e colonne) : libellé exact, et non le code stocké (correctif R1 de #540, cadrage, section « Tests »).
  await expect(ligne.locator('td').nth(6)).toHaveText('Émise');
  // AT-4 : avoir partiel et annulation proposés sur sa facture émise sans avoir ni règlement ; la saisie d'un règlement, non.
  await expect(ligne.getByText('Enregistrer un règlement'), 'Enregistrer un règlement').toHaveCount(0);
  await expect(ligne.getByText(/Annulation totale impossible/)).toHaveCount(0);
  for (const present of ['PDF', 'Règlements', 'Voir l’origine', 'Créer un avoir partiel', 'Annuler la facture']) await expect(ligne.getByRole('button', { name: present, exact: true }), present).toBeVisible();
  const telechargement = page.waitForEvent('download');
  await ligne.getByRole('button', { name: 'PDF', exact: true }).click();
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toBe(`${emise.numero}.pdf`);
  const octets = await readFile(await fichier.path() as string);
  expect(octets.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(octets.includes(Buffer.from(`(Facture ${emise.numero})`))).toBe(true);
  await ligne.getByRole('button', { name: `Envoyer la facture ${emise.numero}`, exact: true }).click();
  const dialogue = page.getByRole('dialog', { name: `Envoyer la facture ${emise.numero}` });
  await expect(dialogue.getByRole('textbox', { name: 'Destinataire' })).toHaveValue(courriel);
  const pdfEnvoi = page.waitForEvent('download');
  await dialogue.getByRole('button', { name: 'Préparer l’envoi' }).click();
  expect((await pdfEnvoi).suggestedFilename()).toBe(`${emise.numero}.pdf`);
  await expect(dialogue.getByRole('region', { name: 'Envois' }).getByRole('listitem')).toHaveCount(1);
  await expect(dialogue.getByRole('region', { name: 'Envois' })).toContainText(assistante.name);
  const envois = await (await request.get(`${api}/factures/${emise.id}/envois`, { headers: { Authorization: `Bearer ${session.token}` } })).json() as { envois: { destinataire: string; auteurNom: string }[] };
  expect(envois.envois.map((e) => [e.destinataire, e.auteurNom])).toEqual([[courriel, assistante.name]]);
  await dialogue.getByTestId('fermer-envoi').click();
  await expect(dialogue).toHaveCount(0);

  // 4. L'administration crée un avoir partiel et enregistre un règlement ; elle les lit, envoie l'avoir (AT-4), sans saisir de
  //    règlement.
  const avoir = await envoyer('post', `/factures/${emise.id}/avoirs`, { lignes: [{ designation: 'Reprise partielle', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 5, tauxTva: 20 }] }) as Facture;
  expect([avoir.type, avoir.totalTtc, avoir.creeParType]).toEqual(['AVOIR', 6, 'SUPERADMIN']);
  await envoyer('post', '/reglements', { clientId: client.id, dateReglement: dateDuJour(), montant: 10, moyen: 'VIREMENT', reference: 'VIR-AT3', affectations: [{ factureId: emise.id, montant: 10 }] });
  await page.getByRole('button', { name: /Actualiser/ }).click();
  await revenirEnPremierePage(page);
  const ligneAvoir = await ligneDe(page, client.raisonSociale, `Origine : ${emise.numero}`);
  await expect(ligneAvoir).toContainText('Avoir');
  await expect(ligneAvoir.getByRole('button', { name: 'PDF', exact: true })).toBeVisible();
  await expect(ligneAvoir.getByRole('button', { name: 'Règlements', exact: true })).toHaveCount(0);
  // Un avoir ne reçoit ni avoir, ni annulation, ni règlement.
  for (const absent of ['Créer un avoir partiel', 'Annuler la facture', 'Enregistrer un règlement']) await expect(ligneAvoir.getByText(absent), absent).toHaveCount(0);
  // AT-4 : l'avoir que l'administration porte sur sa facture, elle l'envoie par la messagerie ; l'envoi est noté à son nom
  // (choix par défaut, à confirmer, cadrage v2, § 1, « Envoi d'un avoir »).
  await ligneAvoir.getByRole('button', { name: `Envoyer l’avoir ${avoir.numero}`, exact: true }).click();
  const dialogueAvoir = page.getByRole('dialog', { name: `Envoyer l’avoir ${avoir.numero}` });
  await expect(dialogueAvoir.getByRole('textbox', { name: 'Destinataire' })).toHaveValue(courriel);
  const pdfAvoir = page.waitForEvent('download');
  await dialogueAvoir.getByRole('button', { name: 'Préparer l’envoi' }).click();
  expect((await pdfAvoir).suggestedFilename()).toBe(`${avoir.numero}.pdf`);
  await expect(dialogueAvoir.getByRole('region', { name: 'Envois' }).getByRole('listitem')).toHaveCount(1);
  await expect(dialogueAvoir.getByRole('region', { name: 'Envois' })).toContainText(assistante.name);
  const envoisAvoir = await (await request.get(`${api}/factures/${avoir.id}/envois`, { headers: { Authorization: `Bearer ${session.token}` } })).json() as { envois: { destinataire: string; auteurNom: string }[] };
  expect(envoisAvoir.envois.map((e) => [e.destinataire, e.auteurNom])).toEqual([[courriel, assistante.name]]);
  await dialogueAvoir.getByTestId('fermer-envoi').click();
  await expect(dialogueAvoir).toHaveCount(0);
  await revenirEnPremierePage(page);
  const ligneReglee = (await ligneDe(page, client.raisonSociale, emise.numero!)).filter({ hasNotText: 'Origine :' });
  await expect(ligneReglee).toContainText(/6,20\s€/);
  // AT-4 : un autre avoir partiel lui est proposé ; l'annulation, non, avec le texte de l'administration ; le règlement, non.
  await expect(ligneReglee.getByRole('button', { name: 'Créer un avoir partiel', exact: true })).toBeVisible();
  await expect(ligneReglee).toContainText('Annulation totale impossible : 1 avoir(s) partiel(s) déjà émis');
  for (const absent of ['Enregistrer un règlement', 'Annuler la facture']) await expect(ligneReglee.getByText(absent, { exact: true }), absent).toHaveCount(0);
  await expect(ligneReglee.getByRole('button', { name: `Envoyer la facture ${emise.numero}`, exact: true })).toBeVisible();
  await ligneReglee.getByRole('button', { name: 'Règlements', exact: true }).click();
  const reglements = page.getByRole('region', { name: 'Règlements de la facture' });
  await expect(reglements.getByRole('heading', { name: `Règlements de la facture ${emise.numero}` })).toBeVisible();
  // Lot « Détail des avoirs comme règlements » : le tableau « Règlements et avoirs de la facture » compte deux lignes, l'avoir de
  // l'administration (saisi le premier, le même jour) puis la part du règlement ; le pied vient du solde de la réponse.
  const tableau = reglements.getByRole('table', { name: 'Règlements et avoirs de la facture' });
  await expect(tableau.locator('tbody tr')).toHaveCount(2);
  const ligneAvoirPanneau = tableau.locator('tbody tr').nth(0);
  await expect(ligneAvoirPanneau.locator('td')).toHaveText([dateDuJour(), `Avoir ${avoir.numero}`, /^6,00\s€$/, 'Émis']);
  const part = tableau.locator('tbody tr').nth(1);
  await expect(part).toContainText(dateDuJour());
  await expect(part).toContainText('Virement');
  await expect(part).toContainText('Réf. VIR-AT3');
  await expect(part).toContainText(/10,00\s€/);
  await expect(part).toContainText('Enregistré');
  await expect(tableau.locator('tfoot')).toHaveText(/^Paiements : 10,00\s€ · Avoirs : 6,00\s€ · Reste dû : 6,20\s€$/);
  await expect(reglements.getByText('Aucun règlement reçu.')).toHaveCount(0);
  await reglements.getByRole('button', { name: 'Fermer' }).click();
  await expect(reglements).toHaveCount(0);

  // 5. Sur toutes les pages de la liste : sa facture et son avoir, jamais la facture de l'administration au même client.
  const textes = await lignesDuClient(page, client.raisonSociale);
  expect(textes.some((t) => t.includes(emise.numero!) && !t.includes('Origine :'))).toBe(true);
  expect(textes.some((t) => t.includes(`Origine : ${emise.numero}`))).toBe(true);
  expect(textes.filter((t) => t.includes(factureAdmin.numero!)), 'facture de l’administration').toEqual([]);
  expect(textes).toHaveLength(2);
  expect(idsLus.has(factureAdmin.id), 'la facture de l’administration n’est jamais reçue par son écran').toBe(false);
  expect(idsLus.has(emise.id)).toBe(true);
  // Par l'API, avec son jeton : la même règle (liste, document).
  const sesFactures = await (await request.get(`${api}/factures`, { headers: { Authorization: `Bearer ${jetonPour(assistante.id)}` } })).json() as Facture[];
  expect(sesFactures.some((f) => f.id === factureAdmin.id)).toBe(false);
  expect((await request.get(`${api}/factures/${factureAdmin.id}/document.pdf`, { headers: { Authorization: `Bearer ${jetonPour(assistante.id)}` } })).status()).toBe(404);
  expect(erreursPage, 'aucune erreur de la page').toEqual([]);
  expect(refusApi, 'aucun refus d’API pendant le parcours').toEqual([]);
});
