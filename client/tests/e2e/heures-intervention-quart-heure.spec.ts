import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect, dateDuJour, horsDuPassageDeMinuit } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;
// Motif et titre du cadrage v2, point 4, écrits ici tels quels (et non importés de l'écran) : le parcours compare le champ au
// cadrage, et non à lui-même.
const MOTIF = String.raw`\d{1,8}(?:[.,](?:00?|25|50?|75))?`;
const TITRE = 'Un nombre d’heures au quart d’heure (par exemple 1,25), ou 0 avec un motif';

// Lot Z : heures d'une intervention saisies au quart d'heure, zéro compris avec son motif (réponse de Nelson du 23-11-2026,
// mot pour mot : « les heures sur une intervention Passe au quart d'heure »). Cadrage v2 du lot Z, point 4, « Critères
// observables » (« Écran : « 1,25 » […] admis ; « 1,1 », « 0,2 » […] refusés par le navigateur, sans envoi, avec le titre en
// français ; « 0 » sans motif refusé par le client, comme avant ») et « Tests » (« E2E, navigateur en anglais : « 1,25 »
// enregistré 1,25 h ; « 1,1 » et « 0,2 » refusés sans envoi ; « 0 » avec motif enregistré »). Règle 2 de la méthode : le lot
// touche un montant (coût de la main-d'œuvre d'une intervention), classé C.
//
// Le champ « Heures » du technicien (Interventions.tsx, seul formulaire d'heures d'une intervention, aussi ouvert depuis « Ma
// journée ») est un champ texte au clavier décimal, avec le motif et le titre du lot ; l'écran remplace la virgule par le point
// avant l'envoi (gardé, point 4) et refuse zéro sans motif avant l'envoi. Chromium en anglais, comme
// saisies-decimales-anglais.spec.ts : sous Linux, c'est LANG/LANGUAGE du processus du navigateur qui règle la langue ; le témoin
// `navigateurAnglais` prouve que ce navigateur fausse bien « 18,75 » dans un champ `type="number"`. La saisie se fait touche à
// touche. Le contexte garde la locale fr-FR et le fuseau Europe/Paris : l'affichage reste celui d'un utilisateur français.
test.use({ launchOptions: { args: ['--lang=en-US'], env: { ...process.env, LANG: 'en_US.UTF-8', LANGUAGE: 'en_US' } } });

async function navigateurAnglais(page: Page) {
  const id = await page.evaluate(() => {
    const champ = document.createElement('input');
    champ.type = 'number';
    champ.id = 'temoin-langue-heures-intervention';
    document.body.appendChild(champ);
    return champ.id;
  });
  const temoin = page.locator(`#${id}`);
  await temoin.pressSequentially('18,75');
  const valeur = await temoin.inputValue();
  await temoin.evaluate((element) => element.remove());
  expect(valeur, 'témoin : un champ number de ce navigateur fausse « 18,75 » (Chromium en anglais)').not.toBe('18.75');
}

async function saisir(champ: Locator, valeur: string) {
  await champ.fill('');
  await champ.pressSequentially(valeur, { delay: 10 });
  await expect(champ).toHaveValue(valeur);
}

const validite = (champ: Locator) => champ.evaluate((element) => {
  const { valid, patternMismatch, valueMissing } = (element as HTMLInputElement).validity;
  return { valid, patternMismatch, valueMissing };
});
const ADMIS = { valid: true, patternMismatch: false, valueMissing: false };
const HORS_MOTIF = { valid: false, patternMismatch: true, valueMissing: false };

const entete = (token: string) => ({ Authorization: `Bearer ${token}` });
async function envoyer(request: APIRequestContext, token: string, methode: 'post' | 'put', chemin: string, data: object) {
  const reponse = await request[methode](`${api}${chemin}`, { headers: entete(token), data });
  expect(reponse.ok(), `${chemin} : ${await reponse.text()}`).toBeTruthy();
  return reponse.json();
}
type HeureLue = { id: string; nbrHeures: number; commentaire: string | null };
async function heuresEnBase(request: APIRequestContext, token: string, interventionId: string) {
  const reponse = await request.get(`${api}/interventions/${interventionId}/couts`, { headers: entete(token) });
  expect(reponse.ok(), await reponse.text()).toBeTruthy();
  return (await reponse.json()) as { heures: HeureLue[]; totalMainOeuvreHT: number | null };
}

// Requêtes d'écriture émises par la page vers les heures de l'intervention (refus du navigateur ou du client : aucune ne part).
function suivreEnvois(page: Page, interventionId: string) {
  const envois: string[] = [];
  page.on('request', (requete) => {
    const chemin = new URL(requete.url()).pathname;
    if (['POST', 'PUT', 'PATCH'].includes(requete.method()) && chemin === `/api/interventions/${interventionId}/couts/heures`) envois.push(`${requete.method()} ${chemin}`);
  });
  return envois;
}

// Critères du cadrage v2 : « 1,25 » enregistré 1,25 h (lectures écartées : une virgule ignorée, 125 h ; une lecture arrêtée à la
// virgule, 1 h ; un champ number en anglais, 125) ; « 1,1 » et « 0,2 » refusés par le navigateur, sans envoi, au titre français
// (lecture écartée : le centième d'avant le lot, 1,1 h ou 0,2 h enregistrés) ; « 0 » sans motif refusé par le client, comme avant ;
// « 0 » avec un motif enregistré 0 h (lecture écartée : le motif du chantier repris, qui refuserait zéro). Coût lu par
// l'administration : 1,25 h × 40 € + 0 h = 50,00 € (lectures écartées : 1,1 h enregistré, 44,00 € ; « 1,25 » lu 125 h, 5 000,00 €).
test('heures d’une intervention, Chromium en anglais : « 1,25 » enregistré 1,25 h ; « 1,1 » et « 0,2 » refusés par le navigateur sans envoi ; « 0 » sans motif refusé par l’écran, avec motif enregistré 0 h ; coût de 50,00 € pour l’administration', async ({ request, session, creerClient, connexion, allerSurPageAdmin }) => {
  await horsDuPassageDeMinuit();
  const suffixe = `${Date.now()}`;
  const technicien = await envoyer(request, session.token, 'post', '/users', { email: `heures.z.${suffixe}@iris.test`, name: `Technicien lot Z ${suffixe}`, role: 'TECHNICIEN' }) as { id: string };
  const fiche = await envoyer(request, session.token, 'post', '/intervenants', { nom: `Fiche lot Z ${suffixe}`, role: 'Technicien', tauxHoraireCharge: 40 }) as { id: string };
  await envoyer(request, session.token, 'put', `/intervenants/${fiche.id}/compte`, { userId: technicien.id });
  const client = await creerClient('heures-intervention-quart-heure');
  const titre = `Dépannage au quart d’heure ${suffixe}`;
  const curative = await envoyer(request, session.token, 'post', '/interventions', { clientId: client.id, titre }) as { id: string };
  const jourIso = dateDuJour().split('-').reverse().join('-');
  await envoyer(request, session.token, 'put', `/interventions/${curative.id}/planning`, { dateDebut: jourIso, creneau: 'HEURES', heureDebut: '08:30', heureFin: '09:30', intervenantIds: [fiche.id] });

  const vue = await connexion(technicien, { locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const envois = suivreEnvois(vue, curative.id);
  await vue.goto('/interventions', { waitUntil: 'networkidle' });
  await navigateurAnglais(vue);
  const carte = vue.locator('article', { hasText: titre });
  const enregistrer = carte.getByRole('button', { name: 'Enregistrer mes heures' });
  await expect(enregistrer).toBeVisible();
  const date = carte.getByPlaceholder('Date (JJ-MM-AAAA)');
  const heures = carte.getByPlaceholder('Heures (ex. : 1,25)', { exact: true });
  const commentaire = carte.getByPlaceholder('Commentaire');
  const motif = carte.getByPlaceholder('Motif (obligatoire si 0)');
  // Champ du lot : texte, clavier décimal, motif et titre du lot (point 4 du cadrage).
  await expect(heures).toHaveAttribute('type', 'text');
  await expect(heures).toHaveAttribute('inputmode', 'decimal');
  await expect(heures).toHaveAttribute('pattern', MOTIF);
  await expect(heures).toHaveAttribute('title', TITRE);
  await date.fill(dateDuJour());

  // 1. « 1,1 » et « 0,2 » : refusés par le navigateur (motif), sans envoi. Le titre français (contrôlé plus haut) s'affiche dans la
  // bulle du navigateur, sous son message propre ; `validationMessage` ne rend que ce dernier (« Please match the requested
  // format. » dans ce navigateur en anglais).
  for (const valeur of ['1,1', '0,2']) {
    await saisir(heures, valeur);
    expect(await validite(heures), `« ${valeur} »`).toEqual(HORS_MOTIF);
    await enregistrer.click();
    expect(await validite(heures), `« ${valeur} » : toujours refusé après le clic`).toEqual(HORS_MOTIF);
  }
  expect(envois, 'aucun envoi pour « 1,1 » ni « 0,2 »').toEqual([]);

  // 2. « 1,25 » : admis, envoyé au point (l'écran remplace la virgule), enregistré 1,25 h, affiché « 1,25 h ».
  await saisir(heures, '1,25');
  expect(await validite(heures)).toEqual(ADMIS);
  await commentaire.fill('Réglage du thermostat');
  const creation = vue.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/interventions/${curative.id}/couts/heures`);
  await enregistrer.click();
  const reponse = await creation;
  expect(reponse.status(), await reponse.text()).toBe(201);
  expect(reponse.request().postDataJSON()).toMatchObject({ date: dateDuJour(), nbrHeures: '1.25' });
  await expect(carte.getByRole('listitem').filter({ hasText: 'Réglage du thermostat' })).toHaveText(new RegExp(`^${dateDuJour()} — 1,25 h — Réglage du thermostat$`));
  expect((await heuresEnBase(request, session.token, curative.id)).heures.map((h) => [h.nbrHeures, h.commentaire])).toEqual([[1.25, 'Réglage du thermostat']]);

  // 3. « 0 » sans motif : refusé par l'écran avant l'envoi (comme avant le lot), le motif du champ l'admettant.
  await date.fill(dateDuJour());
  await saisir(heures, '0');
  expect(await validite(heures), '« 0 » admis par le motif').toEqual(ADMIS);
  await enregistrer.click();
  await expect(vue.getByText('Un motif de 3 caractères minimum est obligatoire pour zéro heure.')).toBeVisible();
  expect(envois, 'aucun envoi pour « 0 » sans motif').toEqual(['POST /api/interventions/' + curative.id + '/couts/heures']);

  // 4. « 0 » avec un motif : enregistré 0 h.
  await motif.fill('Client absent, déplacement sans intervention');
  await commentaire.fill('Passage sans intervention');
  const zero = vue.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/interventions/${curative.id}/couts/heures`);
  await enregistrer.click();
  const reponseZero = await zero;
  expect(reponseZero.status(), await reponseZero.text()).toBe(201);
  expect(reponseZero.request().postDataJSON()).toMatchObject({ nbrHeures: '0', motif: 'Client absent, déplacement sans intervention' });
  await expect(carte.getByRole('listitem').filter({ hasText: 'Passage sans intervention' })).toHaveText(new RegExp(`^${dateDuJour()} — 0 h — Passage sans intervention$`));
  const enBase = await heuresEnBase(request, session.token, curative.id);
  expect(enBase.heures.map((h) => [h.nbrHeures, h.commentaire]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([[0, 'Passage sans intervention'], [1.25, 'Réglage du thermostat']]);
  expect(enBase.totalMainOeuvreHT).toBe(50);

  // 5. L'administration lit le coût de la main-d'œuvre au format français : 1,25 h × 40 € = 50,00 € HT.
  const admin = await allerSurPageAdmin('/interventions');
  const carteAdmin = admin.locator('article', { hasText: titre });
  await expect(carteAdmin.getByText(/Main-d’œuvre cumulée : 50,00\s€ HT/)).toBeVisible();
});

// Même champ sur téléphone (375 px), depuis la fiche de l'intervention ouverte par « Ma journée » (cadrage v2, point 4 : « seul
// formulaire d'heures d'une intervention, aussi ouvert depuis « Ma journée » »), Chromium en anglais : « 0,75 » enregistré 0,75 h
// (lectures écartées : un motif qui n'admettrait que « 25 » ou « 50 », 75 h, 0 h) ; « 1,10 » refusé par le navigateur sans envoi
// (lecture écartée : le centième d'avant le lot, 1,1 h) ; rien ne dépasse la largeur du téléphone.
test('heures d’une intervention sur téléphone (375 px), Chromium en anglais : depuis la fiche, « 1,10 » refusé sans envoi, « 0,75 » enregistré 0,75 h', async ({ request, session, creerClient, connexion }) => {
  await horsDuPassageDeMinuit();
  const suffixe = `${Date.now()}`;
  const technicien = await envoyer(request, session.token, 'post', '/users', { email: `heures.z.mobile.${suffixe}@iris.test`, name: `Technicien lot Z mobile ${suffixe}`, role: 'TECHNICIEN' }) as { id: string };
  const fiche = await envoyer(request, session.token, 'post', '/intervenants', { nom: `Fiche lot Z mobile ${suffixe}`, role: 'Technicien', tauxHoraireCharge: 40 }) as { id: string };
  await envoyer(request, session.token, 'put', `/intervenants/${fiche.id}/compte`, { userId: technicien.id });
  const client = await creerClient('heures-intervention-quart-heure-mobile');
  const titre = `Dépannage mobile au quart d’heure ${suffixe}`;
  const curative = await envoyer(request, session.token, 'post', '/interventions', { clientId: client.id, titre }) as { id: string };
  const jourIso = dateDuJour().split('-').reverse().join('-');
  await envoyer(request, session.token, 'put', `/interventions/${curative.id}/planning`, { dateDebut: jourIso, creneau: 'HEURES', heureDebut: '10:00', heureFin: '11:00', intervenantIds: [fiche.id] });

  const vue = await connexion(technicien, { viewport: { width: 375, height: 812 }, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const envois = suivreEnvois(vue, curative.id);
  await vue.goto(`/interventions/${curative.id}`, { waitUntil: 'networkidle' });
  await navigateurAnglais(vue);
  await expect(vue.getByRole('heading', { level: 1, name: 'Fiche intervention' })).toBeVisible();
  const carte = vue.locator('article', { hasText: titre });
  const heures = carte.getByPlaceholder('Heures (ex. : 1,25)', { exact: true });
  const enregistrer = carte.getByRole('button', { name: 'Enregistrer mes heures' });
  await expect(heures).toHaveAttribute('pattern', MOTIF);
  await expect(heures).toHaveAttribute('inputmode', 'decimal');
  await carte.getByPlaceholder('Date (JJ-MM-AAAA)').fill(dateDuJour());
  await saisir(heures, '1,10');
  expect(await validite(heures)).toEqual(HORS_MOTIF);
  await enregistrer.click();
  expect(envois, 'aucun envoi pour « 1,10 »').toEqual([]);
  await saisir(heures, '0,75');
  expect(await validite(heures)).toEqual(ADMIS);
  await carte.getByPlaceholder('Commentaire').fill('Purge du circuit');
  const creation = vue.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/interventions/${curative.id}/couts/heures`);
  await enregistrer.click();
  const reponse = await creation;
  expect(reponse.status(), await reponse.text()).toBe(201);
  expect(reponse.request().postDataJSON()).toMatchObject({ nbrHeures: '0.75' });
  await expect(carte.getByRole('listitem').filter({ hasText: 'Purge du circuit' })).toHaveText(new RegExp(`^${dateDuJour()} — 0,75 h — Purge du circuit$`));
  expect((await heuresEnBase(request, session.token, curative.id)).heures.map((h) => h.nbrHeures)).toEqual([0.75]);
  expect(await vue.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
