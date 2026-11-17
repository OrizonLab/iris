import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import type { APIRequestContext, Page, Response } from '@playwright/test';
import { test, expect, choisirClient, dateDuJour } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot « acompte des devis » (cadrage v3.1 du 17-11-2026, contrôlé « prêt à coder », sections 2 à 4, critères métier observables
// et section « Tests », « Écran (unitaires et E2E) » ; règle 2 : montants et conversion des devis). Décisions de Nelson du
// 17-11-2026, mot pour mot :
//  - réponse à Q1 : « 1. si l'accompte est reglé a 0% du coup rien n'est exiger en accompte et donc ne figure pas sur la facture
//    ni le devis, par defaut, le reglage doit etre a 40% d'accompte, qui sera modifiable dans les parametre de société
//    justement » ;
//  - case de l'écran : « Cochée d'office (Recommandé) » ;
//  - conversion : « L'acompte ne bloque que le chantier ».
// Choix par défaut d'affichage du cadrage (règle 5, à confirmer) : l'information « Devis enregistré sans acompte : le taux
// d’acompte par défaut de la société est de 0 %. », distincte de l'alerte d'erreur (`role="status"`), seulement quand la
// requête demandait l'acompte et que la réponse n'en exige pas ; le texte de l'historique « Acompte de X % exigé avant
// l’ouverture du chantier ». Chaque test qui règle le taux par défaut remet, dans un `finally`, la valeur lue au départ.

const INFORMATION = 'Devis enregistré sans acompte : le taux d’acompte par défaut de la société est de 0 %.';
const CASE_ACOMPTE = 'Exiger un acompte avant l’ouverture du chantier';

async function envoyer(request: APIRequestContext, token: string, methode: 'post' | 'put', chemin: string, data: object) {
  const reponse = await request[methode](`${api}${chemin}`, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(reponse.ok(), `${chemin} : ${await reponse.text()}`).toBeTruthy();
  return reponse.json();
}
const lireTauxParDefaut = async (request: APIRequestContext, token: string) =>
  ((await (await request.get(`${api}/parametres`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { tauxAcompteDefaut: number }).tauxAcompteDefaut;
// Règle le taux par défaut le temps du test, puis remet la valeur lue au départ, même si une assertion échoue.
async function avecTauxParDefaut(request: APIRequestContext, token: string, taux: number, corps: () => Promise<void>) {
  const depart = await lireTauxParDefaut(request, token);
  try {
    await envoyer(request, token, 'put', '/parametres', { tauxAcompteDefaut: taux });
    expect(await lireTauxParDefaut(request, token)).toBe(taux);
    await corps();
  } finally {
    await envoyer(request, token, 'put', '/parametres', { tauxAcompteDefaut: depart });
  }
}

type DevisLu = { id: string; numero: string; version: number; objet: string; acompteExige: boolean; tauxAcompte: number | null };
// Devis créé, envoyé et signé par l'API (la signature le passe « accepté »).
async function devisSigne(request: APIRequestContext, token: string, clientId: string, objet: string, extra: object) {
  const devis = await envoyer(request, token, 'post', '/devis', { clientId, objet, lignes: [{ designation: 'Installation', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 500, tauxTva: 20 }], ...extra }) as DevisLu;
  await envoyer(request, token, 'put', `/devis/${devis.id}/statut`, { statut: 'ENVOYE' });
  await envoyer(request, token, 'post', `/devis/${devis.id}/signature`, { signataire: 'Client E2E acompte', confirme: true });
  return devis;
}

// Nouveau devis saisi à l'écran : client, objet, une ligne de 2 × 125,00 € HT à 20 % (300,00 € TTC).
async function remplirDevis(page: Page, client: { id: string; raisonSociale: string }, objet: string) {
  await choisirClient(page, client);
  await page.getByRole('textbox', { name: 'Objet' }).fill(objet);
  await page.getByRole('textbox', { name: /Désignation/ }).first().fill('Pose de la centrale');
  await page.getByRole('textbox', { name: 'Qté' }).first().fill('2');
  await page.getByRole('textbox', { name: 'PU HT' }).first().fill('125');
}
const reponseDevis = (page: Page, methode: 'POST' | 'PATCH') => page.waitForResponse((r) => r.request().method() === methode && /^\/api\/devis(\/[0-9a-f-]+)?$/.test(new URL(r.url()).pathname));
async function enregistrer(page: Page, bouton: 'Créer le brouillon' | 'Enregistrer le brouillon', attendu: number) {
  const reponse = reponseDevis(page, bouton === 'Créer le brouillon' ? 'POST' : 'PATCH');
  await page.getByRole('button', { name: bouton }).click();
  const res: Response = await reponse;
  expect(res.status(), await res.text()).toBe(attendu);
  return { envoye: res.request().postDataJSON() as Record<string, unknown>, recu: await res.json() as DevisLu };
}
// Ligne de l'historique d'un devis, désignée par son numéro et sa version (le duplicata garde l'objet de sa source).
const ligneDevis = (page: Page, devis: { numero: string; version?: number }) => page.getByRole('listitem').filter({ hasText: `${devis.numero} — ` }).filter({ hasText: `v${devis.version ?? 1} · ` });

// Texte d'un PDF téléchargé depuis l'écran, lu par pdf-parse, la bibliothèque des tests du serveur (server/node_modules).
type LecteurPdf = { getText: () => Promise<{ text: string }>; destroy: () => Promise<void> };
const { PDFParse } = createRequire(new URL('../../../server/package.json', import.meta.url))('pdf-parse') as { PDFParse: new (options: { data: Buffer }) => LecteurPdf };
async function textePdfTelecharge(page: Page, devis: { numero: string }) {
  const telechargement = page.waitForEvent('download');
  await page.getByRole('button', { name: `PDF du devis ${devis.numero} version 1` }).click();
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toBe(`${devis.numero}-v1.pdf`);
  const lecteur = new PDFParse({ data: await readFile(await fichier.path() as string) });
  try { return (await lecteur.getText()).text; } finally { await lecteur.destroy(); }
}

// Critères « Nouvelle installation : (…) Un nouveau devis, case cochée d'office, est enregistré exigé à 40 % » et « case
// cochée d'office, y compris après un enregistrement et après « Annuler l'édition » ; état du devis repris en modification ;
// information seulement dans le bon cas ». Taux par défaut réglé à 40 % (la base E2E peut porter une autre valeur). La case
// envoie `acompteExige: true` sans clé de taux (« l'écran ne lit pas le taux par défaut ») ; à 40 %, aucune information.
// Lectures écartées : case décochée d'office (`formulaireVide` d'avant le lot) ; case recochée seulement au chargement de
// l'écran, et non après un enregistrement ou « Annuler l’édition » ; modification qui imposerait la case cochée à un devis
// sans acompte ; information affichée alors que le devis est exigé (condition inversée) ; ancien texte « exigé avant
// conversion du devis ».
test('nouveau devis : la case « Exiger un acompte avant l’ouverture du chantier » est cochée d’office, aussi après un enregistrement et après « Annuler l’édition » ; la modification reprend l’état du devis ; à 40 %, le devis est exigé à 40 % sans information', async ({ request, session, creerClient, allerSurPageAdmin }) => {
  test.slow();
  await avecTauxParDefaut(request, session.token, 40, async () => {
    const client = await creerClient('Acompte coché d’office');
    const suffixe = `${Date.now()}`;
    const page = await allerSurPageAdmin('/devis');
    const caseAcompte = page.getByRole('checkbox', { name: CASE_ACOMPTE });
    await expect(caseAcompte).toBeChecked();

    // Case laissée cochée : exigé au taux par défaut, 40 %.
    await remplirDevis(page, client, `Acompte coché E2E ${suffixe}`);
    const exige = await enregistrer(page, 'Créer le brouillon', 201);
    expect(exige.envoye.acompteExige).toBe(true);
    expect(Object.hasOwn(exige.envoye, 'tauxAcompte'), 'l’écran n’envoie pas de taux').toBe(false);
    expect([exige.recu.acompteExige, exige.recu.tauxAcompte]).toEqual([true, 40]);
    await expect(caseAcompte, 'formulaire neuf après l’enregistrement').toBeChecked();
    await expect(page.getByText(INFORMATION)).toHaveCount(0);
    const ligneExige = ligneDevis(page, exige.recu);
    await expect(ligneExige.getByText(/^Acompte de/)).toHaveText('Acompte de 40 % exigé avant l’ouverture du chantier');

    // Case décochée : sans acompte ; le formulaire suivant repart coché ; rien n'est annoncé (aucun acompte demandé).
    await remplirDevis(page, client, `Acompte décoché E2E ${suffixe}`);
    await caseAcompte.uncheck();
    const sans = await enregistrer(page, 'Créer le brouillon', 201);
    expect(sans.envoye.acompteExige).toBe(false);
    expect([sans.recu.acompteExige, sans.recu.tauxAcompte]).toEqual([false, null]);
    await expect(caseAcompte, 'formulaire neuf après un devis sans acompte').toBeChecked();
    await expect(page.getByText(INFORMATION)).toHaveCount(0);
    const ligneSans = ligneDevis(page, sans.recu);
    await expect(ligneSans).toBeVisible();
    await expect(ligneSans.getByText(/^Acompte de/)).toHaveCount(0);

    // Modification : le formulaire reprend l'état du devis (sans acompte : décochée) ; « Annuler l’édition » rend un
    // formulaire neuf, coché.
    await ligneSans.getByRole('button', { name: 'Modifier' }).click();
    await expect(page.getByRole('button', { name: 'Enregistrer le brouillon' })).toBeVisible();
    await expect(caseAcompte, 'devis sans acompte en modification').not.toBeChecked();
    await page.getByRole('button', { name: 'Annuler l’édition' }).click();
    await expect(page.getByRole('button', { name: 'Créer le brouillon' })).toBeVisible();
    await expect(caseAcompte, 'formulaire neuf après « Annuler l’édition »').toBeChecked();

    // Modification du devis exigé : cochée ; décochée puis enregistrée, il passe sans acompte ; le formulaire repart coché.
    await ligneExige.getByRole('button', { name: 'Modifier' }).click();
    await expect(page.getByRole('button', { name: 'Enregistrer le brouillon' })).toBeVisible();
    await expect(caseAcompte, 'devis exigé en modification').toBeChecked();
    await caseAcompte.uncheck();
    const decoche = await enregistrer(page, 'Enregistrer le brouillon', 200);
    expect(decoche.envoye.acompteExige).toBe(false);
    expect([decoche.recu.acompteExige, decoche.recu.tauxAcompte]).toEqual([false, null]);
    await expect(caseAcompte, 'formulaire neuf après une modification').toBeChecked();
    await expect(page.getByText(INFORMATION)).toHaveCount(0);
    await expect(ligneExige.getByText(/^Acompte de/)).toHaveCount(0);
  });
});

// Critères du réglage à 0 % : « création avec acompte exigé sans taux : enregistré sans acompte ni taux ; l'écran affiche
// l'information ; PDF et historique sans acompte » ; « (a) modification d'un devis exigé à 40 %, clé du taux absente : 40 %
// gardé » ; « (e) devis non exigé dont on coche la case en modification : enregistré sans acompte » ; « La duplication d'un
// devis exigé, avec un réglage à 0 %, affiche la même information si sa réponse porte `false` ». Lectures écartées : devis
// exigé à 0 % (« Acompte de 0 % exigé… », « Acompte demandé : 0 % » au PDF) ; information absente quand l'acompte demandé
// n'est pas enregistré ; information affichée case décochée, sur un devis exigé gardé à 40 % ou sur la duplication d'un
// devis sans acompte ; information restée affichée après l'enregistrement suivant.
test('réglage à 0 % : un devis créé case cochée est enregistré sans acompte et l’écran l’annonce, sans acompte à l’historique ni au PDF ; rien n’est annoncé case décochée ni pour un devis exigé gardé à 40 % ; la case cochée en modification et la duplication d’un devis exigé l’annoncent', async ({ request, session, creerClient, allerSurPageAdmin }) => {
  test.slow();
  const client = await creerClient('Acompte réglé à 0 %');
  const suffixe = `${Date.now()}`;
  // Devis exigés à 40 % et à 25 % (taux explicites, enregistrés quel que soit le réglage), préparés par l'API.
  const exigeA40 = await envoyer(request, session.token, 'post', '/devis', { clientId: client.id, objet: `Acompte gardé à 40 % E2E ${suffixe}`, acompteExige: true, tauxAcompte: 40, lignes: [{ designation: 'Visite', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 }] }) as DevisLu;
  const exigeA25 = await envoyer(request, session.token, 'post', '/devis', { clientId: client.id, objet: `Acompte à dupliquer E2E ${suffixe}`, acompteExige: true, tauxAcompte: 25, lignes: [{ designation: 'Visite', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 }] }) as DevisLu;
  await avecTauxParDefaut(request, session.token, 0, async () => {
    const page = await allerSurPageAdmin('/devis');
    const caseAcompte = page.getByRole('checkbox', { name: CASE_ACOMPTE });
    const information = page.getByRole('status').filter({ hasText: 'Devis enregistré sans acompte' });

    // Création, case cochée d'office : enregistré sans acompte ; l'information s'affiche, distincte de l'alerte d'erreur.
    await expect(caseAcompte).toBeChecked();
    await remplirDevis(page, client, `Case cochée, réglage à 0 % E2E ${suffixe}`);
    const cree = await enregistrer(page, 'Créer le brouillon', 201);
    expect(cree.envoye.acompteExige).toBe(true);
    expect([cree.recu.acompteExige, cree.recu.tauxAcompte]).toEqual([false, null]);
    await expect(information).toHaveText(INFORMATION);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(caseAcompte, 'le formulaire suivant repart coché').toBeChecked();
    const ligneCree = ligneDevis(page, cree.recu);
    await expect(ligneCree).toContainText('HT 250,00 € · TVA 50,00 € · TTC 300,00 €');
    await expect(ligneCree.getByText(/^Acompte de/)).toHaveCount(0);
    const texte = await textePdfTelecharge(page, cree.recu);
    expect(texte, 'le PDF lu est celui du devis').toContain('Total TTC : 300,00 €');
    expect(texte, 'aucun acompte au PDF').not.toMatch(/Acompte demandé :/);

    // Case décochée : rien n'est demandé, rien n'est annoncé ; l'information précédente disparaît.
    await remplirDevis(page, client, `Case décochée, réglage à 0 % E2E ${suffixe}`);
    await caseAcompte.uncheck();
    const sans = await enregistrer(page, 'Créer le brouillon', 201);
    expect([sans.envoye.acompteExige, sans.recu.acompteExige]).toEqual([false, false]);
    await expect(page.getByText(INFORMATION)).toHaveCount(0);

    // (e) Devis sans acompte, case cochée en modification : enregistré sans acompte, l'information s'affiche.
    await ligneDevis(page, sans.recu).getByRole('button', { name: 'Modifier' }).click();
    await expect(caseAcompte).not.toBeChecked();
    await caseAcompte.check();
    const coche = await enregistrer(page, 'Enregistrer le brouillon', 200);
    expect(coche.envoye.acompteExige).toBe(true);
    expect([coche.recu.acompteExige, coche.recu.tauxAcompte]).toEqual([false, null]);
    await expect(information).toHaveText(INFORMATION);

    // (a) Devis exigé à 40 %, enregistré depuis l'écran (case cochée, sans clé de taux) : 40 % gardé, aucune information.
    const ligne40 = ligneDevis(page, exigeA40);
    await ligne40.getByRole('button', { name: 'Modifier' }).click();
    await expect(caseAcompte).toBeChecked();
    const garde = await enregistrer(page, 'Enregistrer le brouillon', 200);
    expect(Object.hasOwn(garde.envoye, 'tauxAcompte')).toBe(false);
    expect([garde.recu.acompteExige, garde.recu.tauxAcompte]).toEqual([true, 40]);
    await expect(page.getByText(INFORMATION)).toHaveCount(0);
    await expect(ligne40.getByText(/^Acompte de/)).toHaveText('Acompte de 40 % exigé avant l’ouverture du chantier');

    // Duplication d'un devis exigé à 25 % : duplicata sans acompte, l'information s'affiche ; duplication d'un devis sans
    // acompte : aucune information.
    const duplication = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/devis/${exigeA25.id}/duplication`));
    await ligneDevis(page, exigeA25).getByRole('button', { name: 'Dupliquer' }).click();
    const reponseDuplication = await duplication;
    expect(reponseDuplication.status()).toBe(201);
    const duplicata = await reponseDuplication.json() as DevisLu;
    expect([duplicata.acompteExige, duplicata.tauxAcompte]).toEqual([false, null]);
    await expect(information).toHaveText(INFORMATION);
    await expect(ligneDevis(page, duplicata).getByText(/^Acompte de/)).toHaveCount(0);
    const duplicationSans = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/devis/${cree.recu.id}/duplication`));
    await ligneCree.getByRole('button', { name: 'Dupliquer' }).click();
    expect((await duplicationSans).status()).toBe(201);
    await expect(page.getByText(INFORMATION)).toHaveCount(0);
  });
});

// Critères « Conversion (…) À l'écran, « Créer l'intervention » et « Créer le contrat » sont proposés, et « Ouvrir le
// chantier » ne l'est qu'une fois l'acompte constaté » ; « depuis `ACCEPTE`, une fois le devis converti, « Attendre
// l'acompte » n'est plus proposé » ; « le texte de l'historique dit « exigé avant l’ouverture du chantier » ». Devis
// signés à 40 % (500,00 € HT, 600,00 € TTC ; acompte constaté de 240,00 €), l'un accepté, l'autre en attente d'acompte ;
// l'assistante technique se voit proposer l'intervention et le contrat, sans « Constater l’acompte ». Lectures écartées :
// l'ancienne condition (rien de proposé avant la constatation) ; l'intervention non proposée en attente d'acompte ; le
// chantier proposé avant la constatation ; « Attendre l’acompte » encore proposé après une conversion.
test('conversions proposées selon la cible : un devis signé à l’acompte attendu propose l’intervention et le contrat, accepté ou en attente d’acompte, et le chantier une fois l’acompte constaté ; converti, il ne propose plus « Attendre l’acompte »', async ({ request, session, creerClient, allerSurPageAdmin, connexion, page }) => {
  test.slow();
  const client = await creerClient('Acompte et conversions');
  const suffixe = `${Date.now()}`;
  const accepte = await devisSigne(request, session.token, client.id, `Acompte attendu accepté E2E ${suffixe}`, { acompteExige: true, tauxAcompte: 40 });
  const attente = await devisSigne(request, session.token, client.id, `Acompte attendu en attente E2E ${suffixe}`, { acompteExige: true, tauxAcompte: 40 });
  await envoyer(request, session.token, 'put', `/devis/${attente.id}/statut`, { statut: 'EN_ATTENTE_ACOMPTE' });
  const boutons = (ligne: ReturnType<typeof ligneDevis>) => ({
    chantier: ligne.getByRole('button', { name: 'Ouvrir le chantier', exact: true }),
    intervention: ligne.getByRole('button', { name: 'Créer l’intervention', exact: true }),
    contrat: ligne.getByRole('button', { name: 'Créer le contrat', exact: true }),
    attendre: ligne.getByRole('button', { name: 'Attendre l’acompte', exact: true }),
    constater: ligne.getByRole('button', { name: 'Constater l’acompte', exact: true }),
  });

  // Assistante technique : l'intervention et le contrat proposés, accepté ou en attente d'acompte ; ni le chantier ni la
  // constatation, réservée à l'administration.
  const creationAt = await request.post(`${api}/users`, { headers: { Authorization: `Bearer ${session.token}` }, data: { email: `acompte.at.${suffixe}@iris.test`, name: `Assistante acompte ${suffixe}`, role: 'ASSISTANTE_TECHNIQUE' } });
  expect(creationAt.status(), await creationAt.text()).toBe(201);
  const vueAt = await connexion(await creationAt.json() as { id: string });
  await vueAt.goto('/devis', { waitUntil: 'networkidle' });
  for (const devis of [accepte, attente]) {
    const b = boutons(ligneDevis(vueAt, devis));
    await expect(b.intervention, `AT, ${devis.objet}`).toBeVisible();
    await expect(b.contrat, `AT, ${devis.objet}`).toBeVisible();
    await expect(b.chantier).toHaveCount(0);
    await expect(b.constater).toHaveCount(0);
  }

  await allerSurPageAdmin('/devis');
  const ligneAccepte = ligneDevis(page, accepte);
  const ligneAttente = ligneDevis(page, attente);
  for (const ligne of [ligneAccepte, ligneAttente]) await expect(ligne.getByText(/^Acompte de/)).toHaveText('Acompte de 40 % exigé avant l’ouverture du chantier');
  const a = boutons(ligneAccepte);
  await expect(a.intervention).toBeVisible();
  await expect(a.contrat).toBeVisible();
  await expect(a.attendre).toBeVisible();
  await expect(a.constater).toBeVisible();
  await expect(a.chantier).toHaveCount(0);
  const w = boutons(ligneAttente);
  await expect(ligneAttente).toContainText('v1 · EN_ATTENTE_ACOMPTE');
  await expect(w.intervention).toBeVisible();
  await expect(w.contrat).toBeVisible();
  await expect(w.chantier).toHaveCount(0);

  // En attente d'acompte : l'intervention est créée ; le devis reste en attente, le contrat reste proposé, pas le chantier.
  await w.intervention.click();
  const formulaireIntervention = page.getByRole('dialog', { name: 'Créer l’intervention du devis' });
  const creationIntervention = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/devis/${attente.id}/convertir`));
  await formulaireIntervention.getByRole('button', { name: 'Créer l’intervention' }).click();
  expect((await creationIntervention).status()).toBe(201);
  await expect(formulaireIntervention).toHaveCount(0);
  await expect(ligneAttente).toContainText('Intervention issue de ce devis');
  await expect(ligneAttente).toContainText('v1 · EN_ATTENTE_ACOMPTE');
  await expect(w.intervention).toHaveCount(0);
  await expect(w.contrat).toBeVisible();
  await expect(w.chantier).toHaveCount(0);

  // Accepté : le contrat est créé ; « Attendre l’acompte » n'est plus proposé, ni le chantier tant que l'acompte manque.
  await a.contrat.click();
  const formulaireContrat = page.getByRole('dialog', { name: 'Créer le contrat du devis' });
  await expect(formulaireContrat.getByLabel('Date de début')).toHaveValue(dateDuJour());
  await formulaireContrat.getByLabel('Périodicité (mois)').fill('12');
  await formulaireContrat.getByLabel('Durée prévue (minutes)').fill('60');
  const creationContrat = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/devis/${accepte.id}/convertir`));
  await formulaireContrat.getByRole('button', { name: 'Créer le contrat' }).click();
  expect((await creationContrat).status()).toBe(201);
  await expect(ligneAccepte).toContainText('Contrat de maintenance issu de ce devis');
  await expect(a.attendre).toHaveCount(0);
  await expect(a.contrat).toHaveCount(0);
  await expect(a.intervention).toBeVisible();
  await expect(a.chantier).toHaveCount(0);

  // Constatation par l'administration (date, montant, référence) : « Ouvrir le chantier » apparaît, et le chantier s'ouvre.
  const reponses = [dateDuJour(), '240,00', `VIR-ACOMPTE-${suffixe}`];
  const questions: string[] = [];
  page.on('dialog', (dialogue) => { questions.push(dialogue.message()); void dialogue.accept(reponses.shift()); });
  await a.constater.click();
  await expect(ligneAccepte.getByText(/^Acompte de/)).toHaveText('Acompte de 240,00 € constaté');
  expect(questions).toEqual(['Date de réception de l’acompte (JJ-MM-AAAA) ?', 'Montant reçu (€) ?', 'Référence du règlement ?']);
  await expect(a.chantier).toBeVisible();
  const ouverture = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/devis/${accepte.id}/convertir`));
  await a.chantier.click();
  expect((await ouverture).status()).toBe(201);
  await expect(ligneAccepte).toContainText('Chantier issu de ce devis');
  await expect(a.chantier).toHaveCount(0);

  // Le devis en attente d'acompte, constaté, repasse accepté et propose son chantier.
  reponses.push(dateDuJour(), '240,00', `VIR-ACOMPTE-ATTENTE-${suffixe}`);
  await w.constater.click();
  await expect(ligneAttente).toContainText('v1 · ACCEPTE');
  await expect(w.chantier).toBeVisible();
});

// Cadrage v3.1, section 5 (décision 4 de Nelson du 17-11-2026, « Garder Marges & Commissions (Recommandé) ») : le réglage
// reste dans l'onglet « Marges & Commissions », même formulaire et même route, dans un groupe « Devis et acompte », avec
// l'aide « Proposé sur chaque nouveau devis ; 0 % : aucun acompte n’est exigé. » ; bornes inchangées, journalisé. Réglé à 0
// depuis l'écran, il est relu à 0 et journalisé (avant, après). Lectures écartées : champ hors du groupe, aide absente ou
// non reliée au champ, valeur affichée autre que celle de la société.
test('réglage du taux d’acompte par défaut : dans « Marges & Commissions », groupe « Devis et acompte », avec son aide ; réglé à 0 depuis l’écran, il est enregistré et journalisé', async ({ page, request, session, allerSurPageAdmin }) => {
  await avecTauxParDefaut(request, session.token, 40, async () => {
    await allerSurPageAdmin('/admin');
    await page.getByRole('button', { name: 'Marges & Commissions' }).click();
    const groupe = page.getByRole('group', { name: 'Devis et acompte' });
    const champ = groupe.getByRole('spinbutton', { name: /Taux d'acompte proposé par défaut/ });
    await expect(champ).toHaveValue('40');
    await expect(champ).toHaveAccessibleDescription('Proposé sur chaque nouveau devis ; 0 % : aucun acompte n’est exigé.');
    await champ.fill('0');
    const enregistrement = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/parametres');
    await page.locator('form').filter({ has: groupe }).getByRole('button', { name: 'Enregistrer', exact: true }).click();
    const reponse = await enregistrement;
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect(reponse.request().postDataJSON()).toMatchObject({ tauxAcompteDefaut: '0' });
    expect(await lireTauxParDefaut(request, session.token)).toBe(0);
    const journal = await (await request.get(`${api}/journal-administration?type=PARAMETRES`, { headers: { Authorization: `Bearer ${session.token}` } })).json() as { entrees: { avant: Record<string, unknown> | null; apres: Record<string, unknown> | null }[] };
    expect(journal.entrees[0]?.avant).toMatchObject({ tauxAcompteDefaut: 40 });
    expect(journal.entrees[0]?.apres).toMatchObject({ tauxAcompteDefaut: 0 });
  });
});
