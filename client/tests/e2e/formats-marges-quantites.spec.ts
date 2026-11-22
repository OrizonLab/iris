import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, choisirClient, dateDuJour, jetonPour } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Audit des montants de #655 (#499, cadrage du correctif, version 2, points 1 et 2) : décimales déclarées par chaque usage
// de fmtPourcentage pour les marges et le taux de dépassement des heures vendues (une au plus), et quantité de l'aperçu de
// la facture au temps passé (trois au plus). Chaque attendu écarte les autres lectures plausibles d'un appel : une autre
// décimale (0 ou 2), la troncature, le texte d'avant #499 ; les espaces sont nommées par leur caractère (U+0020 avant « % »).
// Les valeurs sont injectées dans les réponses du serveur (comme formats-locale.spec.ts) quand seul l'affichage est en cause.

async function remplacerReponse(page: Page, motif: string, modifier: (donnees: any) => unknown) {
  await page.route(motif, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const reponse = await route.fetch();
    await route.fulfill({ response: reponse, json: modifier(await reponse.json()) });
  });
}

// Tableau de bord : marge totale de la période (Dashboard.tsx, « … % · période ») et marge estimée du portefeuille en cours
// (« … % du vendu »), une décimale au plus, jamais « -0 % ».
test('tableau de bord : marge de la période et marge estimée du portefeuille à une décimale au plus, « 0 % » pour une marge négative arrondie à zéro', async ({ page, request, session, creerClient, allerSurPageAdmin }) => {
  const headers = { Authorization: `Bearer ${session.token}` };
  const envoyer = async (methode: 'post' | 'put' | 'patch', chemin: string, data: object) => {
    const response = await request[methode](`${api}${chemin}`, { headers, data });
    expect(response.ok(), `${chemin} : ${await response.text()}`).toBeTruthy();
    return response.json();
  };
  const suffixe = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const client = await creerClient(`formats-marges ${suffixe}`);
  const devis = await envoyer('post', '/devis', { clientId: client.id, objet: `TEST Marges décimales ${suffixe}`, lignes: [
    { designation: 'Pose', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 1000, tauxTva: 20 },
  ] }) as { id: string };
  await envoyer('put', `/devis/${devis.id}/statut`, { statut: 'ENVOYE' });
  await envoyer('post', `/devis/${devis.id}/signature`, { signataire: 'Client E2E', confirme: true });
  const chantier = await envoyer('post', `/devis/${devis.id}/convertir`, { cible: 'CHANTIER' }) as { id: string };
  // Portefeuille réduit au chantier du parcours, vendu 1 000 €, marge estimée injectée (affichage seul).
  let margeEstimee = 123.4;
  await page.route('**/api/chantiers', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const reponse = await route.fetch();
    const liste = await reponse.json() as { id: string; metrics?: Record<string, unknown> }[];
    await route.fulfill({ response: reponse, json: liste.filter((c) => c.id === chantier.id).map((c) => ({ ...c, budgetGlobalVendu: 1000, metrics: { ...c.metrics, margeEstimee } })) });
  });
  // Marge de la période 12,25 % : « 12,3 % » (moitié vers l'extérieur). Lectures écartées : « 12 % » (aucune décimale),
  // « 12,25 % » (deux décimales), « 12,2 % » (troncature), « 12.3% » (toFixed(1), avant #499).
  await remplacerReponse(page, '**/api/stats/global?*', (donnees) => ({ ...donnees, margeTotal: 1225, margePct: 12.25 }));
  try {
    await allerSurPageAdmin('/');
    await expect(page.locator('div.bg-white.p-4', { hasText: 'Marge totale' }).last().locator('div.text-xs.text-gray-400')).toHaveText(/^12,3 % · \S.*$/);
    // Marge estimée du portefeuille, 123,40 € sur 1 000 € vendus : 12,34 %, « 12,3 % du vendu ». Lectures écartées : « 12 % »
    // (aucune décimale), « 12,34 % » (deux décimales).
    const portefeuille = page.getByRole('region', { name: 'Rentabilité des chantiers en cours' });
    await expect(portefeuille.locator('[data-marge-portefeuille] + div')).toHaveText(/^12,3 % du vendu$/);
    // Marge estimée de -0,30 € sur 1 000 € : -0,03 %, « 0 % du vendu ». Lecture écartée : « -0 % du vendu », le texte d'avant
    // #499 (toLocaleString('fr-FR') sans signDisplay).
    margeEstimee = -0.3;
    await page.reload({ waitUntil: 'networkidle' });
    await expect(portefeuille.locator('[data-marge-portefeuille] + div')).toHaveText(/^0 % du vendu$/);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
    await request.patch(`${api}/chantiers/${chantier.id}/statut`, { headers, data: { statut: 'TERMINE' } }).catch(() => undefined);
  }
});

// Performances : marge % et taux de dépassement des heures vendues, une décimale au plus.
test('Performances : marge % et dépassement des heures vendues à une décimale au plus', async ({ page, allerSurPageAdmin }) => {
  const nom = `TEST Conducteur décimales ${Date.now()}`;
  await page.route('**/api/stats/conducteurs', (route) => route.fulfill({
    json: [{
      id: 'e2e-decimales-conducteur', name: nom, email: 'test.decimales.conducteur@iris.test', nbChantiersEnCours: 1, nbChantiersTermines: 1,
      caTotal: 1000, margeTotal: -192.5, margePct: -19.25, nbEnAvanceHeures: 0, nbEnRetardHeures: 1, nbMaterielDansBudget: 1, nbMaterielDepasse: 0,
      nbTermineEnAvanceHeures: 0, nbTermineEnRetardHeures: 1, nbTermineMaterielDansBudget: 1, nbTermineMaterielDepasse: 0,
      tauxDepassementHeures: 7.25, manqueAGagnerMainOeuvre: 10, tauxObjectifsRespectes: 0, nbObjectifsRespectes: 0,
    }],
  }));
  try {
    await allerSurPageAdmin('/performances');
    const carte = page.locator('div.bg-white.rounded-xl', { hasText: nom });
    // Marge -19,25 % : « -19,3 % » (moitié vers l'extérieur). Lectures écartées : « -19 % » (aucune décimale), « -19,25 % »
    // (deux décimales), « -19,2 % » (troncature).
    await expect(carte.locator('div.bg-gray-50', { hasText: 'Marge %' }).locator('div.mt-0\\.5')).toHaveText(/^-19,3 %$/);
    // Dépassement des heures vendues 7,25 % : « 7,3 % ». Lectures écartées : « 7 % », « 7,25 % », « 7,2 % ».
    await expect(carte.locator('div.border-t', { hasText: 'Dépassement heures' }).locator('span.text-sm.font-black').first()).toHaveText(/^7,3 %$/);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
  }
});

// Aperçu de la facture au temps passé (FactureTempsPasse.tsx) : la quantité d'une ligne, au millième (Decimal(12, 3)), s'écrit
// par fmtNombreHeures(q, 3), comme avant #499. Une fourniture de 2,125 u à 10 € HT : « 2,125 » et 21,25 € HT. Lecture
// écartée : « 2,13 », la valeur par défaut de fmtNombreHeures (deux décimales), qui ne donnerait plus le total de la ligne.
async function preparerTempsPasse(request: APIRequestContext, token: string, creerClient: (libelle: string) => Promise<{ id: string; raisonSociale: string }>) {
  const envoyer = async (methode: 'post' | 'put' | 'patch', path: string, data?: object, auth = token) => {
    const response = await request[methode](`${api}${path}`, { headers: { Authorization: `Bearer ${auth}` }, data });
    expect(response.ok(), `${path} : ${await response.text()}`).toBeTruthy();
    return response.json();
  };
  const suffixe = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const technicien = await envoyer('post', '/users', { email: `quantite-tp.${suffixe}@iris.test`, name: `Technicien quantité temps passé ${suffixe}`, role: 'TECHNICIEN' }) as { id: string };
  const fiche = await envoyer('post', '/intervenants', { nom: `Fiche quantité temps passé ${suffixe}`, role: 'Technicien', tauxHoraireCharge: 40 }) as { id: string };
  await envoyer('put', `/intervenants/${fiche.id}/compte`, { userId: technicien.id });
  const mainOeuvre = await envoyer('post', '/catalogue/prestations', {
    estMainOeuvre: true, reference: `E2E-QTP-${suffixe}`, nom: `Électricien quantité temps passé ${suffixe}`, tauxTva: '20',
    prixVenteHt: '45.50', prixJourHorsContratHt: '320', prixHeureSousContratHt: '40', prixJourSousContratHt: '280', heuresParJour: '7',
  }) as { id: string };
  const client = await creerClient(`quantite-temps-passe ${suffixe}`);
  const jour = dateDuJour();
  const jourIso = jour.split('-').reverse().join('-');
  const devis = await envoyer('post', '/devis', { clientId: client.id, objet: `Quantité au millième ${suffixe}`, auTempsPasse: true, lignes: [
    { tempsPasse: true, designation: 'Main d’œuvre au temps passé', quantite: 1, tarifTempsPasse: 'HORS_CONTRAT', catalogueFamille: 'prestations', catalogueId: mainOeuvre.id },
    { designation: 'Câble au mètre', nature: 'FOURNITURE', quantite: '2.125', prixUnitaireHt: 10, tauxTva: 20 },
  ] }) as { id: string };
  await envoyer('post', `/devis/${devis.id}/signature`, { signataire: 'Client E2E', confirme: true });
  const intervention = await envoyer('post', `/devis/${devis.id}/convertir`, { cible: 'INTERVENTION' }) as { id: string };
  await envoyer('put', `/interventions/${intervention.id}/planning`, { dateDebut: jourIso, creneau: 'HEURES', heureDebut: '08:30', heureFin: '09:30', intervenantIds: [fiche.id] });
  await envoyer('post', `/interventions/${intervention.id}/couts/heures`, { date: jour, nbrHeures: 1 }, jetonPour(technicien.id));
  await envoyer('patch', `/interventions/${intervention.id}/statut`, { statut: 'EN_COURS' });
  await envoyer('post', `/interventions/${intervention.id}/rapports`, { contenu: 'Dépannage fait.', cleEnvoi: randomUUID() });
  await envoyer('patch', `/interventions/${intervention.id}/statut`, { statut: 'TERMINEE', motifSansSignature: 'CLIENT_ABSENT' });
  return { client, intervention };
}

test('aperçu de la facture au temps passé : la quantité d’une ligne au millième s’écrit « 2,125 », et non « 2,13 »', async ({ session, request, creerClient, allerSurPageAdmin }) => {
  const lire = async () => (await (await request.get(`${api}/parametres`, { headers: { Authorization: `Bearer ${session.token}` } })).json()) as { pasTempsPasseMinutes: number | null; tempsMinimumMinutes: number };
  const avant = await lire();
  const regler = (reglages: object) => request.put(`${api}/parametres`, { headers: { Authorization: `Bearer ${session.token}` }, data: reglages });
  expect((await regler({ pasTempsPasseMinutes: 15, tempsMinimumMinutes: 60 })).ok()).toBeTruthy();
  try {
    const { client, intervention } = await preparerTempsPasse(request, session.token, creerClient);
    const page = await allerSurPageAdmin('/factures');
    await page.getByRole('button', { name: /Nouvelle facture/ }).click();
    await choisirClient(page, client);
    await page.locator('select[name="origine"]').selectOption('INTERVENTION');
    await page.getByRole('combobox', { name: 'Intervention facturée' }).selectOption(intervention.id);
    const apercu = page.getByRole('region', { name: 'Facture au temps passé' });
    const ligne = apercu.getByRole('row').filter({ hasText: 'Câble au mètre' });
    await expect(ligne.getByRole('cell').nth(1)).toHaveText(/^2,125$/);
    await expect(ligne.getByRole('cell').nth(4)).toHaveText(/^21,25 €$/);
    // Totaux : 1 h × 45,50 € + 21,25 € = 66,75 € HT, TVA 13,35 €, TTC 80,10 €.
    await expect(apercu.getByLabel('Totaux de la facture au temps passé')).toHaveText(/^Total HT 66,75 € · TVA 13,35 € · Total TTC 80,10 €$/);
  } finally {
    await regler({ pasTempsPasseMinutes: avant.pasTempsPasseMinutes === null ? '' : avant.pasTempsPasseMinutes, tempsMinimumMinutes: avant.tempsMinimumMinutes });
  }
});

// Comptabilité, message d'enregistrement d'une règle TVA : il dit le taux que le serveur a enregistré. Un taux tapé « 5,5/ »
// est accepté par le serveur (paramètre de route « 5,5 », la barre finale étant ignorée) et crée la règle à 5,5 % : le message
// est « TVA 5,5 % enregistrée. ». Lecture écartée : le texte tapé relu par Number après la virgule ramenée au point
// (« TVA NaN % enregistrée. »). Le taux 5,5 % est laissé sans règle à la fin, comme comptabilite.spec.ts le suppose.
test('Comptabilité : le message d’enregistrement d’une règle TVA dit le taux enregistré par le serveur, même tapé « 5,5/ »', async ({ page, request, session, allerSurPageAdmin }) => {
  const headers = { Authorization: `Bearer ${session.token}` };
  type Plan = { reglesTva: { taux: number; compteId: string; updatedAt: string }[] };
  const plan = async () => (await (await request.get(`${api}/comptabilite`, { headers })).json()) as Plan;
  const retirer55 = async (motif: string) => {
    const regle = (await plan()).reglesTva.find((r) => r.taux === 5.5);
    if (!regle) return;
    const retrait = await request.delete(`${api}/comptabilite/tva/5.5`, { headers, data: { confirmation: '5.5', expectedCompteId: regle.compteId, expectedUpdatedAt: regle.updatedAt, motif } });
    expect(retrait.ok(), await retrait.text()).toBeTruthy();
  };
  await retirer55('Remise à zéro du parcours du message TVA');
  const code = `445${String(Date.now()).slice(-9)}`;
  const creation = await request.post(`${api}/comptabilite/comptes`, { headers, data: { code, libelle: `TVA message ${code}`, nature: 'TVA' } });
  expect(creation.status(), await creation.text()).toBe(201);
  const compteId = (await creation.json() as { id: string }).id;
  try {
    await allerSurPageAdmin('/comptabilite');
    await page.getByRole('textbox', { name: 'Taux de TVA (%)' }).fill('5,5/');
    await page.getByRole('combobox', { name: 'Compte TVA à associer' }).selectOption(compteId);
    await page.getByRole('textbox', { name: /Motif de création TVA/ }).fill('TEST message du taux enregistré');
    const enregistrement = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/api/comptabilite/tva/'));
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    expect((await enregistrement).status()).toBe(200);
    expect((await plan()).reglesTva.filter((r) => r.taux === 5.5).map((r) => r.compteId)).toEqual([compteId]);
    await expect(page.locator('p.text-emerald-700')).toHaveText(/^TVA 5,5 % enregistrée\.$/);
  } finally {
    await retirer55('Nettoyage du parcours du message TVA');
  }
});
