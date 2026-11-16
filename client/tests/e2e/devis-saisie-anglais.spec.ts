import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect, choisirClient } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot devis (cadrage v3 du 16-11-2026, contrôlé « prêt à coder », section 4 et critères « Saisie en anglais » ; règle 2 :
// montants) : #394 pour le devis. Les heures d'une ligne au temps passé, et la quantité, le PU HT et la TVA d'une ligne
// ordinaire étaient des champs `type="number"`, qu'un Chromium réglé en anglais lit autrement (« 18,75 » y devient 1875,
// sans refus). Ils passent en texte, `inputMode="decimal"`, avec un `pattern` aux bornes du serveur ; la saisie est envoyée
// telle quelle, le serveur lisant la virgule ; les valeurs pré-remplies (édition, catalogue) s'écrivent à la virgule ; le
// taux de l'acompte s'affiche au format français (« 37,5 % ») ; les flèches du champ des heures avancent d'un pas.
//
// Chromium en anglais, comme saisie-montants-anglais.spec.ts (#564) : sous Linux, `--lang=en-US` seul ne change pas la
// langue qui lit un champ `type="number"` ; c'est LANG/LANGUAGE du processus du navigateur. Les deux sont posés, et le
// témoin `navigateurAnglais` prouve, dans chaque test, qu'un champ `type="number"` de ce navigateur fausse bien « 18,75 » :
// sans lui, un poste réglé en français ferait passer ces tests même avec les anciens champs. La saisie se fait touche à
// touche (`pressSequentially`), comme au clavier. Le contexte garde la locale fr-FR de playwright.config.ts.
test.use({ launchOptions: { args: ['--lang=en-US'], env: { ...process.env, LANG: 'en_US.UTF-8', LANGUAGE: 'en_US' } } });

// Témoin : dans ce navigateur, un champ `type="number"` lit « 18,75 » autrement que 18,75 (1875 dans Chromium en anglais).
async function navigateurAnglais(page: Page) {
  const id = await page.evaluate(() => {
    const champ = document.createElement('input');
    champ.type = 'number';
    champ.id = 'temoin-langue-devis';
    document.body.appendChild(champ);
    return champ.id;
  });
  const temoin = page.locator(`#${id}`);
  await temoin.pressSequentially('18,75');
  const valeur = await temoin.inputValue();
  await temoin.evaluate((element) => element.remove());
  expect(valeur, 'témoin : un champ number de ce navigateur fausse « 18,75 » (Chromium en anglais)').not.toBe('18.75');
}

// Saisie au clavier dans un champ vidé.
async function saisir(champ: Locator, valeur: string) {
  await champ.fill('');
  await champ.pressSequentially(valeur, { delay: 10 });
  await expect(champ).toHaveValue(valeur);
}

const validite = (champ: Locator) => champ.evaluate((element) => {
  const { valid, patternMismatch } = (element as HTMLInputElement).validity;
  return { valid, patternMismatch };
});

async function envoyer(request: APIRequestContext, token: string, methode: 'post' | 'put', chemin: string, data: object) {
  const reponse = await request[methode](`${api}${chemin}`, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(reponse.ok(), `${chemin} : ${await reponse.text()}`).toBeTruthy();
  return reponse.json();
}

type DevisLu = {
  id: string; objet: string; acompteExige: boolean; tauxAcompte: number | null; totalHt: number; totalTva: number; totalTtc: number;
  lignes: { designation: string; quantite: number; prixUnitaireHt: number; tauxTva: number; totalHt: number; totalTtc: number; tempsPasse?: boolean }[];
};
async function devisParObjet(request: APIRequestContext, token: string, objet: string) {
  const liste = await (await request.get(`${api}/devis`, { headers: { Authorization: `Bearer ${token}` } })).json() as DevisLu[];
  return liste.filter((d) => d.objet === objet);
}
const lireParametres = async (request: APIRequestContext, token: string) => (await (await request.get(`${api}/parametres`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { tauxAcompteDefaut: number; pasTempsPasseMinutes: number | null; tempsMinimumMinutes: number };
const champsLigne = (page: Page) => ({ qte: page.getByRole('textbox', { name: 'Qté' }), pu: page.getByRole('textbox', { name: 'PU HT' }), tva: page.getByRole('textbox', { name: 'TVA %' }) });
// Envois de création ou de modification d'un devis par l'écran.
const suivreEnvois = (page: Page) => {
  const envois: string[] = [];
  page.on('request', (requete) => {
    if (['POST', 'PATCH'].includes(requete.method()) && /\/api\/devis(\/[0-9a-f-]+)?$/.test(new URL(requete.url()).pathname)) envois.push(`${requete.method()} ${new URL(requete.url()).pathname}`);
  });
  return envois;
};

// Critères du cadrage : « sous Chromium en anglais (…), la saisie est enregistrée exactement : quantité « 1,5 », PU « 18,75 »,
// TVA « 5,5 » » ; « la valeur pré-remplie à l'édition (…) s'écrit à la virgule » ; « Affichage du taux de l'acompte (…) au
// format français, « 37,5 % » » (taux par défaut réglé à 37,5 %). Montants : 1,5 × 18,75 = 28,125, arrondi commercial à
// 28,13 € HT ; TVA 5,5 % de 28,13 = 1,54715, soit 1,55 € ; TTC 29,68 €. Puis, à l'édition, « 2,25 » : 2,25 × 18,75 = 42,1875,
// soit 42,19 € HT ; TVA 2,32045, soit 2,32 € ; TTC 44,51 €. Lectures écartées : champ number en anglais (« 1,5 » lu 15 :
// 281,25 € HT ; « 18,75 » lu 1875 : 2 812,50 € HT ; « 5,5 » lu 55 : refusé par le serveur) ; lecture arrêtée à la virgule
// (1 × 18 = 18 € HT) ; arrondi au pair (28,12 €, 42,19 inchangé) ; taux affiché « 37.5 % » (point, avant le lot).
test('devis à l’écran, Chromium en anglais : « 1,5 » × « 18,75 » à « 5,5 » % enregistrés exactement (28,13 € HT, 29,68 € TTC), refus du navigateur hors forme sans envoi, acompte « 37,5 % », édition à la virgule puis « 2,25 » (44,51 € TTC)', async ({ page, request, session, creerClient, allerSurPageAdmin }) => {
  test.slow();
  const { tauxAcompteDefaut: tauxAvant } = await lireParametres(request, session.token);
  try {
    await envoyer(request, session.token, 'put', '/parametres', { tauxAcompteDefaut: '37,5' });
    expect((await lireParametres(request, session.token)).tauxAcompteDefaut).toBe(37.5);
    const client = await creerClient('Devis saisie anglais');
    const objet = `Devis saisie anglais E2E ${Date.now()}`;
    const envois = suivreEnvois(page);
    await allerSurPageAdmin('/devis');
    await navigateurAnglais(page);
    await choisirClient(page, client);
    await page.getByRole('textbox', { name: 'Objet' }).fill(objet);
    await page.getByRole('textbox', { name: /Désignation/ }).fill('Fourniture saisie en anglais');
    await page.getByRole('combobox', { name: 'Nature' }).selectOption('FOURNITURE');
    const { qte, pu, tva } = champsLigne(page);
    // Champs texte décimaux ; ligne vierge aux valeurs d'une nouvelle ligne (1, 0 et 20), écrites comme saisies.
    for (const champ of [qte, pu, tva]) {
      await expect(champ).toHaveAttribute('type', 'text');
      await expect(champ).toHaveAttribute('inputmode', 'decimal');
      await expect(champ).toHaveAttribute('pattern', /.+/);
    }
    await expect(qte).toHaveValue('1');
    await expect(pu).toHaveValue('0');
    await expect(tva).toHaveValue('20');

    // Hors forme : refusé par le navigateur (`pattern`), rien n'est envoyé. Quantité nulle (comme l'ancien min="0.001") ou à
    // quatre décimales ; PU à trois décimales ; TVA à trois décimales. Chaque refus prouve aussi que le navigateur compile
    // le motif (il ignore en silence un motif invalide).
    await page.getByRole('checkbox', { name: 'Exiger un acompte avant l’ouverture du chantier' }).check();
    for (const [champ, saisie] of [[qte, '0'], [qte, '1,1234'], [pu, '18,755'], [tva, '5,555']] as const) {
      await saisir(qte, '1,5');
      await saisir(pu, '18,75');
      await saisir(tva, '5,5');
      await saisir(champ, saisie);
      expect(await validite(champ), `« ${saisie} »`).toEqual({ valid: false, patternMismatch: true });
      await page.getByRole('button', { name: 'Créer le brouillon' }).click();
      await expect(champ).toHaveValue(saisie);
    }
    expect(envois, 'aucune création envoyée').toEqual([]);
    expect(await devisParObjet(request, session.token, objet)).toEqual([]);

    // « 1,5 », « 18,75 » et « 5,5 », au clavier : admis par le navigateur, envoyés tels quels, lus exactement par le serveur.
    await saisir(qte, '1,5');
    await saisir(pu, '18,75');
    await saisir(tva, '5,5');
    for (const champ of [qte, pu, tva]) expect(await validite(champ)).toEqual({ valid: true, patternMismatch: false });
    const creation = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/devis');
    await page.getByRole('button', { name: 'Créer le brouillon' }).click();
    const reponse = await creation;
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect(reponse.request().postDataJSON()).toMatchObject({ acompteExige: true, lignes: [{ quantite: '1,5', prixUnitaireHt: '18,75', tauxTva: '5,5' }] });
    const [cree] = await devisParObjet(request, session.token, objet);
    expect(cree.lignes.map((l) => [l.quantite, l.prixUnitaireHt, l.tauxTva, l.totalHt, l.totalTtc])).toEqual([[1.5, 18.75, 5.5, 28.13, 29.68]]);
    expect([cree.totalHt, cree.totalTva, cree.totalTtc, cree.acompteExige, cree.tauxAcompte]).toEqual([28.13, 1.55, 29.68, true, 37.5]);
    const item = page.getByRole('listitem').filter({ hasText: objet });
    // #499 : forme des documents (virgule, espace ordinaire U+0020 avant « € »).
    await expect(item).toContainText(/HT 28,13 € · TVA 1,55 € · TTC 29,68 €/);
    await expect(item.getByText(/^Acompte de/)).toHaveText('Acompte de 37,5 % exigé avant conversion du devis');

    // Édition : quantité, PU et TVA pré-remplis à la virgule ; « 2,25 » au clavier, envoyé tel quel.
    await item.getByRole('button', { name: 'Modifier' }).click();
    await expect(page.getByRole('button', { name: 'Enregistrer le brouillon' })).toBeVisible();
    await expect(qte).toHaveValue('1,5');
    await expect(pu).toHaveValue('18,75');
    await expect(tva).toHaveValue('5,5');
    await saisir(qte, '2,25');
    const modification = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/devis/${cree.id}`);
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
    const reponseModification = await modification;
    expect(reponseModification.status(), await reponseModification.text()).toBe(200);
    expect(reponseModification.request().postDataJSON()).toMatchObject({ lignes: [{ quantite: '2,25', prixUnitaireHt: '18,75', tauxTva: '5,5' }] });
    const [modifie] = await devisParObjet(request, session.token, objet);
    expect(modifie.lignes.map((l) => [l.quantite, l.prixUnitaireHt, l.tauxTva, l.totalHt, l.totalTtc])).toEqual([[2.25, 18.75, 5.5, 42.19, 44.51]]);
    expect([modifie.totalHt, modifie.totalTva, modifie.totalTtc, modifie.tauxAcompte]).toEqual([42.19, 2.32, 44.51, 37.5]);
    await expect(item).toContainText(/HT 42,19 € · TVA 2,32 € · TTC 44,51 €/);
    expect(envois).toEqual(['POST /api/devis', `PATCH /api/devis/${cree.id}`]);
  } finally {
    await envoyer(request, session.token, 'put', '/parametres', { tauxAcompteDefaut: tauxAvant });
  }
});

// Critère du cadrage : « la valeur pré-remplie (…) depuis le catalogue s'écrit à la virgule » (`ligneDepuisCatalogue`, PU
// « 2,5 » et TVA « 5,5 ») ; la ligne vierge du formulaire (« 0 » écrit en chaîne) est remplacée par la fiche (`ligneVierge`).
// Montant : 4,5 × 2,50 = 11,25 € HT ; TVA 5,5 % = 0,61875, soit 0,62 € ; TTC 11,87 €. Lectures écartées : PU pré-rempli
// « 2.5 » (point, avant le lot) ; « 4,5 » lu 45 (112,50 € HT) ; « 2,5 » lu 25 (112,50 € HT) ; ligne vierge gardée (deux
// lignes, la première refusée faute de désignation).
test('catalogue, Chromium en anglais : la fiche remplace la ligne vierge, PU « 2,5 » et TVA « 5,5 » pré-remplis à la virgule ; « 4,5 » au clavier, 11,25 € HT et 11,87 € TTC enregistrés', async ({ page, request, session, creerClient, allerSurPageAdmin }) => {
  const suffixe = `${Date.now()}`;
  const fiche = await envoyer(request, session.token, 'post', '/catalogue/articles', { reference: `E2E-ANG-${suffixe}`, nom: `Gaine anglais E2E ${suffixe}`, unite: 'm', prixVenteHt: '2.5', tauxTva: '5.5' }) as { id: string; nom: string };
  const client = await creerClient('Catalogue saisie anglais');
  const objet = `Devis catalogue anglais E2E ${suffixe}`;
  await allerSurPageAdmin('/devis');
  await navigateurAnglais(page);
  await choisirClient(page, client);
  await page.getByRole('textbox', { name: 'Objet' }).fill(objet);
  await page.getByRole('searchbox', { name: 'Rechercher dans le catalogue' }).fill(suffixe);
  await page.getByRole('button', { name: `Ajouter ${fiche.nom}` }).click();
  await expect(page.getByRole('textbox', { name: /Désignation/ })).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: /Désignation/ })).toHaveValue(fiche.nom);
  const { qte, pu, tva } = champsLigne(page);
  await expect(qte).toHaveValue('1');
  await expect(pu).toHaveValue('2,5');
  await expect(tva).toHaveValue('5,5');
  await saisir(qte, '4,5');
  const creation = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/devis');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  const reponse = await creation;
  expect(reponse.status(), await reponse.text()).toBe(201);
  expect(reponse.request().postDataJSON()).toMatchObject({ lignes: [{ catalogueId: fiche.id, quantite: '4,5', prixUnitaireHt: '2,5', tauxTva: '5,5' }] });
  const [cree] = await devisParObjet(request, session.token, objet);
  expect(cree.lignes.map((l) => [l.quantite, l.prixUnitaireHt, l.tauxTva, l.totalHt, l.totalTtc])).toEqual([[4.5, 2.5, 5.5, 11.25, 11.87]]);
  expect([cree.totalHt, cree.totalTva, cree.totalTtc]).toEqual([11.25, 0.62, 11.87]);
  await expect(page.getByRole('listitem').filter({ hasText: objet })).toContainText(/HT 11,25 € · TVA 0,62 € · TTC 11,87 €/);
});

// Critère du cadrage : « heures « 1,25 », avec un minimum d'une heure et un pas de 15 minutes » ; flèches : « avec un minimum
// d'une heure et un pas de 15 minutes : de 1 à 1,25, puis 1,5 » ; à l'édition, les heures pré-remplies à la virgule. Montants
// (main d'œuvre à 45,50 € HT de l'heure, TVA 20 %) : 1,25 h = 56,875, soit 56,88 € HT ; TVA 11,376, soit 11,38 € ; TTC
// 68,26 € ; puis 1,5 h = 68,25 € HT, TVA 13,65 €, TTC 81,90 €. Lectures écartées : « 1,25 » lu 125 par un champ number en
// anglais (5 687,50 € HT) ; lu 1 (lecture arrêtée à la virgule : 45,50 € HT) ; « 1,25 » refusé avant l'envoi par l'écran
// (`Number('1,25')` = NaN, C7 du contrôle) ; flèches au point (« 1.5 ») ou au flottant (« 1.0019999999999998 »).
test('temps passé, Chromium en anglais : « 1,25 » h au minimum d’une heure et au pas de 15 minutes enregistrées exactement (68,26 € TTC) ; à l’édition « 1,25 », puis « 1,5 » par la flèche (81,90 € TTC)', async ({ page, request, session, creerClient, allerSurPageAdmin }) => {
  test.slow();
  const suffixe = `${Date.now()}`;
  const { pasTempsPasseMinutes: pasAvant, tempsMinimumMinutes: minimumAvant } = await lireParametres(request, session.token);
  try {
    await envoyer(request, session.token, 'put', '/parametres', { pasTempsPasseMinutes: 15, tempsMinimumMinutes: 60 });
    const mainOeuvre = await envoyer(request, session.token, 'post', '/catalogue/prestations', {
      estMainOeuvre: true, reference: `E2E-TP-ANG-${suffixe}`, nom: `Électricien anglais E2E ${suffixe}`, tauxTva: '20',
      prixVenteHt: '45.50', prixJourHorsContratHt: '320', prixHeureSousContratHt: '40', prixJourSousContratHt: '280', heuresParJour: '7',
    }) as { id: string };
    const client = await creerClient('Temps passé saisie anglais');
    const objet = `Temps passé anglais E2E ${suffixe}`;
    const envois = suivreEnvois(page);
    await allerSurPageAdmin('/devis');
    await navigateurAnglais(page);
    await choisirClient(page, client);
    await page.getByRole('textbox', { name: 'Objet' }).fill(objet);
    await page.getByRole('checkbox', { name: 'Devis au temps passé' }).check();
    await page.getByRole('combobox', { name: 'Main d’œuvre au temps passé' }).selectOption(mainOeuvre.id);
    const ligne = page.getByRole('group', { name: 'Ligne au temps passé' });
    const heures = ligne.getByRole('textbox', { name: 'Heures', exact: true });
    await expect(heures).toHaveAttribute('type', 'text');
    await expect(heures).toHaveAttribute('inputmode', 'decimal');
    await expect(heures).toHaveValue('1');
    // « 1,1 » : hors des quarts d'heure, refusé par le navigateur, rien d'envoyé.
    await saisir(heures, '1,1');
    expect(await validite(heures)).toEqual({ valid: false, patternMismatch: true });
    await page.getByRole('button', { name: 'Créer le brouillon' }).click();
    expect(envois).toEqual([]);
    await saisir(heures, '1,25');
    expect(await validite(heures)).toEqual({ valid: true, patternMismatch: false });
    const creation = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/devis');
    await page.getByRole('button', { name: 'Créer le brouillon' }).click();
    const reponse = await creation;
    expect(reponse.status(), await reponse.text()).toBe(201);
    expect(reponse.request().postDataJSON()).toMatchObject({ auTempsPasse: true, lignes: [{ tempsPasse: true, quantite: '1,25' }] });
    const [cree] = await devisParObjet(request, session.token, objet);
    expect(cree.lignes.map((l) => [l.tempsPasse, l.quantite, l.prixUnitaireHt, l.totalHt, l.totalTtc])).toEqual([[true, 1.25, 45.5, 56.88, 68.26]]);
    expect([cree.totalHt, cree.totalTva, cree.totalTtc]).toEqual([56.88, 11.38, 68.26]);
    const item = page.getByRole('listitem').filter({ hasText: objet });
    await expect(item).toContainText(/HT 56,88 € · TVA 11,38 € · TTC 68,26 €/);
    await expect(item.getByTestId('mention-temps-passe')).toContainText('Ce devis prévoit 1 h 15 min');

    // Édition : réglages figés connus de l'écran ; heures pré-remplies à la virgule ; la flèche vers le haut mène à « 1,5 ».
    await item.getByRole('button', { name: 'Modifier' }).click();
    const figees = ligne.getByRole('textbox', { name: 'Heures (1 h minimum)' });
    await expect(figees).toHaveValue('1,25');
    await figees.press('ArrowDown');
    await expect(figees).toHaveValue('1');
    await figees.press('ArrowDown');
    await expect(figees).toHaveValue('1', { timeout: 2_000 });
    await figees.press('ArrowUp');
    await expect(figees).toHaveValue('1,25');
    await figees.press('ArrowUp');
    await expect(figees).toHaveValue('1,5');
    const modification = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/devis/${cree.id}`);
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
    const reponseModification = await modification;
    expect(reponseModification.status(), await reponseModification.text()).toBe(200);
    expect(reponseModification.request().postDataJSON()).toMatchObject({ lignes: [{ tempsPasse: true, quantite: '1,5' }] });
    const [modifie] = await devisParObjet(request, session.token, objet);
    expect([modifie.lignes[0].quantite, modifie.totalHt, modifie.totalTva, modifie.totalTtc]).toEqual([1.5, 68.25, 13.65, 81.9]);
    await expect(item).toContainText(/HT 68,25 € · TVA 13,65 € · TTC 81,90 €/);
  } finally {
    await envoyer(request, session.token, 'put', '/parametres', { pasTempsPasseMinutes: pasAvant === null ? '' : pasAvant, tempsMinimumMinutes: minimumAvant });
  }
});
