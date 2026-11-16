import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Correctif « saisie des montants refusée plutôt que faussée » (cadrage v3 du 16-11-2026, critères observables et section
// « Tests » ; montants classés C) : #394, champs décimaux de « Modifier le chantier » (heures vendues et budgets), et #443,
// taux horaire chargé de l'administration. Un champ `type="number"` lit la virgule selon la langue de l'interface de
// Chromium : dans un Chromium en anglais, « 18,75 » y devient 1875, sans aucun refus (#394, commentaire du contrôle de
// cohérence de #393). Les champs passent en texte (`inputMode="decimal"`), le serveur lit la virgule (#393) et refuse une
// saisie hors forme ; un `pattern` garde le refus côté navigateur (« 18,755 »), et la valeur pré-remplie s'écrit à la
// virgule (choix par défaut, à confirmer, cadrage, point 2). L'écran de l'administration envoie le taux tel que saisi, et
// affiche le refus du serveur (cadrage, point 1, R1).
//
// Chromium en anglais : le cadrage demande `--lang=en-US`. Sous Linux, ce drapeau seul ne change pas la langue qui lit un
// champ `type="number"` : c'est LANG/LANGUAGE du processus du navigateur (sondé dans le conteneur de la session : avec
// LANG=fr_FR.UTF-8, « 18,75 » donne 18.75 même avec `--lang=en-US`). Les deux sont donc posés ici, et le témoin
// `navigateurAnglais` prouve, dans chaque test, qu'un champ `type="number"` de ce navigateur fausse bien « 18,75 » : sans
// lui, un poste réglé en français ferait passer ces tests même avec les anciens champs. La saisie se fait touche à touche
// (`pressSequentially`), comme au clavier, et non par `fill`, qui écrit la valeur sans passer par la lecture du champ.
// Le contexte garde la locale fr-FR de playwright.config.ts : l'affichage reste celui d'un utilisateur français.
test.use({ launchOptions: { args: ['--lang=en-US'], env: { ...process.env, LANG: 'en_US.UTF-8', LANGUAGE: 'en_US' } } });

const REFUS_TAUX = 'Le taux horaire chargé doit être un nombre positif ou nul, avec au plus deux décimales (par exemple 42,50).';

// Témoin : dans ce navigateur, un champ `type="number"` lit « 18,75 » autrement que 18,75 (1875 dans Chromium en anglais).
async function navigateurAnglais(page: Page) {
  const lu = await page.evaluate(() => {
    const champ = document.createElement('input');
    champ.type = 'number';
    champ.id = 'temoin-langue';
    document.body.appendChild(champ);
    return champ.id;
  });
  const temoin = page.locator(`#${lu}`);
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

async function ouvrirAffaire(request: APIRequestContext, token: string, clientId: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const envoyer = async (methode: 'post' | 'put' | 'patch', chemin: string, data: object) => {
    const reponse = await request[methode](`${api}${chemin}`, { headers, data });
    expect(reponse.ok(), `${chemin} : ${await reponse.text()}`).toBeTruthy();
    return reponse.json();
  };
  const suffixe = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const devis = await envoyer('post', '/devis', { clientId, objet: `Saisie anglais E2E ${suffixe}`, lignes: [{ designation: 'Pose', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 }] }) as { id: string };
  await envoyer('put', `/devis/${devis.id}/statut`, { statut: 'ENVOYE' });
  await envoyer('post', `/devis/${devis.id}/signature`, { signataire: 'Client E2E', confirme: true });
  const chantier = await envoyer('post', `/devis/${devis.id}/convertir`, { cible: 'CHANTIER' }) as { id: string; nom: string };
  // Titulaire et commercial actifs : le formulaire « Modifier » les exige. Heures vendues et budget global de départ, saisis à
  // la virgule par l'API, distincts de toute valeur saisie à l'écran.
  const conducteur = await envoyer('post', '/users', { email: `saisie-anglais.conducteur.${suffixe}@iris.test`, name: `Conducteur saisie anglais ${suffixe}`, role: 'CONDUCTEUR_TRAVAUX' }) as { id: string };
  const commercial = await envoyer('post', '/users', { email: `saisie-anglais.commercial.${suffixe}@iris.test`, name: `Commercial saisie anglais ${suffixe}`, role: 'COMMERCIAL' }) as { id: string };
  await envoyer('patch', `/chantiers/${chantier.id}`, { responsableId: conducteur.id, heuresVendues: '12,5', budgetGlobalVendu: '980,40' });
  await envoyer('patch', `/chantiers/${chantier.id}/commercial`, { commercialId: commercial.id });
  return chantier;
}

// Critère du cadrage : « Dans la fiche chantier, Chromium en anglais : « 18,75 » (heures vendues) → 18.75 ; « 1250,50 »
// (budget) → 1250.50, affichés au format français ; « 18,755 » refusé par le navigateur, rien d'envoyé. » Lectures écartées :
// « 18,75 » lu 1875 et « 1250,50 » lu 125050 (champ number en anglais, #394) ; 18 et 1250 (lecture arrêtée à la virgule) ;
// « 18,755 » arrondi à 18,76 ou tronqué à 18,75 par une saisie admise.
test('fiche chantier, Chromium en anglais : « 18,75 » heures vendues et « 1250,50 » de budget enregistrés à 18,75 et 1 250,50, affichés à la française ; « 18,755 » refusé par le navigateur, sans rien envoyer', async ({ page, request, session, creerClient, allerSurPageAdmin }) => {
  test.slow();
  const client = await creerClient('saisie anglais fiche');
  const chantier = await ouvrirAffaire(request, session.token, client.id);
  const relire = async () => {
    const fiche = await (await request.get(`${api}/chantiers/${chantier.id}`, { headers: { Authorization: `Bearer ${session.token}` } })).json() as { heuresVendues: number; budgetGlobalVendu: number };
    return [fiche.heuresVendues, fiche.budgetGlobalVendu];
  };
  expect(await relire()).toEqual([12.5, 980.4]);
  const fenetres: string[] = [];
  page.on('dialog', (dialogue) => { fenetres.push(dialogue.message()); void dialogue.accept(); });
  const envois: string[] = [];
  page.on('request', (requete) => { if (requete.method() === 'PATCH' && new URL(requete.url()).pathname.startsWith('/api/chantiers/')) envois.push(new URL(requete.url()).pathname); });

  await allerSurPageAdmin(`/chantiers/${chantier.id}`);
  await expect(page.getByRole('heading', { name: chantier.nom })).toBeVisible();
  await navigateurAnglais(page);
  const modifier = page.getByRole('heading', { name: 'Modifier le chantier' });
  const ouvrir = async () => {
    await page.getByRole('button', { name: 'Modifier', exact: true }).first().click();
    await expect(modifier).toBeVisible();
  };
  const champ = (etiquette: string) => page.locator('.form-group', { has: page.getByText(etiquette, { exact: true }) }).locator('input');
  const heures = champ('Total Heures Vendues (h)');
  const budget = champ('Budget Global (€ HT)');

  // Champs texte décimaux, pré-remplis à la virgule (« 12,5 », « 980,4 ») : valeurs de départ lues par le serveur.
  await ouvrir();
  for (const [saisie, nom] of [[heures, 'heuresVendues'], [budget, 'budgetGlobalVendu']] as const) {
    await expect(saisie).toHaveAttribute('name', nom);
    await expect(saisie).toHaveAttribute('type', 'text');
    await expect(saisie).toHaveAttribute('inputmode', 'decimal');
  }
  await expect(heures).toHaveValue('12,5');
  await expect(budget).toHaveValue('980,4');

  // « 18,755 » : trois décimales, refusé par le navigateur (pattern) ; « Enregistrer les modifications » n'envoie rien.
  await saisir(heures, '18,755');
  expect(await validite(heures)).toEqual({ valid: false, patternMismatch: true });
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(modifier).toBeVisible();
  await expect(heures).toHaveValue('18,755');
  expect(envois, 'aucune modification envoyée').toEqual([]);
  expect(await relire()).toEqual([12.5, 980.4]);

  // « 18,75 » et « 1250,50 », au clavier : admis par le navigateur, envoyés tels quels, lus exactement par le serveur.
  await saisir(heures, '18,75');
  await saisir(budget, '1250,50');
  expect(await validite(heures)).toEqual({ valid: true, patternMismatch: false });
  expect(await validite(budget)).toEqual({ valid: true, patternMismatch: false });
  const enregistrement = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/chantiers/${chantier.id}`);
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  const reponse = await enregistrement;
  expect(reponse.status()).toBe(200);
  expect(reponse.request().postDataJSON()).toMatchObject({ heuresVendues: '18,75', budgetGlobalVendu: '1250,50' });
  await expect(modifier).toHaveCount(0);
  expect(await relire()).toEqual([18.75, 1250.5]);

  // Affichés à la française : « 18,75 h » (heures prévues) ; budget vendu « 1 250,5 € » (milliers en U+202F). La carte du
  // budget écrit le montant par `toLocaleString()`, sans deux décimales fixes (#388, ouverte, hors périmètre) : l'expression
  // admet aussi « 1 250,50 € », qu'en donnera le correctif. Elle écarte « 125 050 € » (#394), « 1,250.5 € » (anglais),
  // « 1 250 € » ou « 1 251 € » (euro près).
  await expect(page.getByText('Heures Prévues', { exact: true }).locator('xpath=following-sibling::div[1]')).toHaveText('18,75 h');
  await expect(page.getByText('Budget Vendu', { exact: true }).locator('xpath=following-sibling::div[1]')).toHaveText(/^1 250,50? €$/);
  // Rouverte, la fenêtre reprend les valeurs enregistrées, à la virgule.
  await ouvrir();
  await expect(heures).toHaveValue('18,75');
  await expect(budget).toHaveValue('1250,5');
  expect(envois).toEqual([`/api/chantiers/${chantier.id}`]);
  expect(fenetres).toEqual([]);
});

// Critère du cadrage : « À l'écran Administration > Intervenants, dans un Chromium en anglais : champ vidé → refus affiché,
// rien d'écrit ; « 42,50 » → 42.5, affiché « 42,50 € ». » La création suit la même saisie (pattern du champ, cadrage, point
// 1). Lectures écartées : champ vidé ramené à 0 (« 0,00 € », sans refus : `parseFloat(…) || 0` de l'écran d'avant) ;
// « 42,50 » lu 42 (« 42,00 € », `parseFloat`) ou 4250 (« 4 250,00 € », champ number en anglais) ; « 37,85 » lu 37 ou 3785.
test('Administration > Intervenants, Chromium en anglais : taux vidé refusé par le serveur, refus affiché, rien d’écrit ; « 42,50 » enregistré à 42,50 € et affiché « 42,50 € » ; à la création, « 42,505 » refusé par le navigateur et « 37,85 » enregistré', async ({ page, request, session, allerSurPageAdmin }) => {
  const headers = { Authorization: `Bearer ${session.token}` };
  const nom = `Taux anglais E2E ${Date.now()}`;
  const creation = await request.post(`${api}/intervenants`, { headers, data: { nom, role: 'Technicien', tauxHoraireCharge: 40 } });
  expect(creation.ok(), await creation.text()).toBeTruthy();
  const { id } = await creation.json() as { id: string };
  const tauxDe = async (nomFiche: string) => {
    const intervenants = await (await request.get(`${api}/intervenants`, { headers })).json() as { nom: string; tauxHoraireCharge: number }[];
    return intervenants.filter((i) => i.nom === nomFiche).map((i) => i.tauxHoraireCharge);
  };
  expect(await tauxDe(nom)).toEqual([40]);
  const fenetres: string[] = [];
  page.on('dialog', (dialogue) => { fenetres.push(dialogue.message()); void dialogue.accept(); });
  const envois: string[] = [];
  page.on('request', (requete) => { if (['POST', 'PUT'].includes(requete.method()) && new URL(requete.url()).pathname.startsWith('/api/intervenants')) envois.push(`${requete.method()} ${new URL(requete.url()).pathname}`); });

  await allerSurPageAdmin('/admin');
  await navigateurAnglais(page);
  await page.getByRole('button', { name: 'Intervenants', exact: true }).click();
  // La ligne de la fiche, en lecture comme en édition (le nom passe alors dans un champ) : par le sélecteur de son compte.
  const ligne = page.getByRole('row').filter({ has: page.getByLabel(`Compte technicien de ${nom}`) });
  const cout = ligne.getByRole('cell').nth(4);
  await expect(cout).toHaveText(/^40,00 €$/);
  const taux = page.getByLabel(`Taux horaire chargé de ${nom}`);

  // Champ vidé : envoyé tel quel, refusé par le serveur (400), son message affiché ; la ligne reste en édition, rien n'est écrit.
  await ligne.getByRole('button', { name: 'Modifier', exact: true }).click();
  await expect(taux).toHaveAttribute('type', 'text');
  await expect(taux).toHaveAttribute('inputmode', 'decimal');
  await expect(taux).toHaveValue('40');
  await taux.fill('');
  const refus = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/intervenants/${id}`);
  await ligne.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const reponseRefus = await refus;
  expect(reponseRefus.status()).toBe(400);
  expect(reponseRefus.request().postDataJSON()).toMatchObject({ tauxHoraireCharge: '' });
  await expect.poll(() => fenetres).toEqual([REFUS_TAUX]);
  await expect(taux).toBeVisible();
  expect(await tauxDe(nom)).toEqual([40]);

  // « 42,50 », au clavier : envoyé tel quel, enregistré à 42,50 €, affiché « 42,50 € ».
  await saisir(taux, '42,50');
  const enregistrement = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/intervenants/${id}`);
  await ligne.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const reponse = await enregistrement;
  expect(reponse.status()).toBe(200);
  expect(reponse.request().postDataJSON()).toMatchObject({ tauxHoraireCharge: '42,50' });
  await expect(taux).toHaveCount(0);
  await expect(cout).toHaveText(/^42,50 €$/);
  expect(await tauxDe(nom)).toEqual([42.5]);
  // Rouverte, l'édition reprend le taux à la virgule.
  await ligne.getByRole('button', { name: 'Modifier', exact: true }).click();
  await expect(taux).toHaveValue('42,5');
  await ligne.getByRole('button', { name: 'Annuler', exact: true }).click();

  // Création : « 42,505 » refusé par le navigateur (pattern), rien d'envoyé ; « 37,85 » enregistré et affiché « 37,85 € ».
  const formulaire = page.locator('form').filter({ has: page.locator('input[name="tauxHoraireCharge"]') });
  const nouveau = `Taux anglais E2E création ${Date.now()}`;
  await formulaire.locator('input[name="nom"]').fill(nouveau);
  await formulaire.locator('input[name="role"]').fill('Technicien');
  const tauxCree = formulaire.locator('input[name="tauxHoraireCharge"]');
  await expect(tauxCree).toHaveAttribute('type', 'text');
  await saisir(tauxCree, '42,505');
  expect(await validite(tauxCree)).toEqual({ valid: false, patternMismatch: true });
  await formulaire.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(tauxCree).toHaveValue('42,505');
  expect(envois.filter((e) => e.startsWith('POST'))).toEqual([]);
  expect(await tauxDe(nouveau)).toEqual([]);
  // Bornes du serveur (huit chiffres avant la virgule, colonne Decimal(10,2)) : « 100000000 » refusé par le navigateur, rien
  // d'envoyé ; « 99999999,99 », le plafond, admis par le navigateur. Écarte un `pattern` plus large ou plus étroit que le serveur.
  await saisir(tauxCree, '100000000');
  expect(await validite(tauxCree)).toEqual({ valid: false, patternMismatch: true });
  await formulaire.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  expect(envois.filter((e) => e.startsWith('POST'))).toEqual([]);
  await saisir(tauxCree, '99999999,99');
  expect(await validite(tauxCree)).toEqual({ valid: true, patternMismatch: false });
  await saisir(tauxCree, '37,85');
  const cree = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/intervenants');
  await formulaire.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const reponseCree = await cree;
  expect(reponseCree.status()).toBe(200);
  expect(reponseCree.request().postDataJSON()).toMatchObject({ nom: nouveau, tauxHoraireCharge: '37,85' });
  await expect(page.getByRole('row').filter({ has: page.getByLabel(`Compte technicien de ${nouveau}`) }).getByRole('cell').nth(4)).toHaveText(/^37,85 €$/);
  expect(await tauxDe(nouveau)).toEqual([37.85]);
  expect(fenetres).toEqual([REFUS_TAUX]);
});
