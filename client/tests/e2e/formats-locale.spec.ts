import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, jetonPour } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot A5, #205 : un seul module de formats. Preuve de la locale (C4 du contrôle du cadrage) : les parcours tournent en
// `fr-FR` (playwright.config.ts), où un `toLocaleString()` sans locale écrit déjà le format français. Ce fichier ouvre
// donc un navigateur en anglais (en-US) sur chaque écran dont les montants s'écrivaient sans locale avant #205 : tableau
// de bord, Résultat commercial, Mes commerciaux, Marges & Commissions (éditeur de barème), Performances et Statistiques.
// Chacun doit écrire « 1 235 € » au format français (milliers en espace fine insécable U+202F, espace ordinaire avant
// « € »), et non « 1,235 € », que la tête de A4 (e39f005) affiche dans ce navigateur.
// Les montants sont injectés dans les réponses du serveur (comme commissions-sans-plan.spec.ts) : seul leur affichage
// est en cause, et non leur calcul. Ils sont choisis pour que d'autres lectures donnent un autre texte : 1 234,5 €
// donne « 1 235 € » (moitié vers l'extérieur, #198) ; -2 345,5 € donne « -2 346 € » (Math.round donnerait -2 345).
test.use({ locale: 'en-US' });

const FINE = ' ';

// `toHaveText` avec une chaîne ramène toute espace (U+202F, U+00A0 comprises) à l'espace ordinaire : une expression
// ancrée compare le texte exact, caractère par caractère.
const echapper = (texte: string) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactement = (texte: string) => new RegExp(`^${echapper(texte)}$`);

// Témoin : la page est bien servie en anglais ; un `toLocaleString()` sans locale y écrirait « 1,235 ».
async function navigateurEnAnglais(page: Page) {
  expect(await page.evaluate(() => [navigator.language, (1235).toLocaleString(), (1235).toLocaleString('fr-FR')])).toEqual(['en-US', '1,235', `1${FINE}235`]);
}

async function remplacerReponse(page: Page, motif: string, modifier: (donnees: any) => unknown) {
  await page.route(motif, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const reponse = await route.fetch();
    await route.fulfill({ response: reponse, json: modifier(await reponse.json()) });
  });
}

test('tableau de bord, navigateur en anglais : achats, heures, CA, marge et commission au format français', async ({ page, allerSurPageAdmin }) => {
  await remplacerReponse(page, '**/api/stats/global?*', (donnees) => ({
    ...donnees, achatsTotal: 1234.5, heuresTotal: 1234.4, caTotal: 12345.5, margeTotal: -2345.5, commissionCommercialeTotal: 1500.4, commissionTotal: 1500.4, margePct: -0.04,
  }));
  await allerSurPageAdmin('/');
  await navigateurEnAnglais(page);
  const valeur = (libelle: string) => page.locator('div.bg-white.p-4', { hasText: libelle }).last().locator('div.text-2xl');
  await expect(valeur('Total des achats')).toHaveText(exactement(`1${FINE}235 €`));
  // Heures arrondies à l'heure, puis au format français (Dashboard.tsx:197 du cadrage).
  await expect(valeur('Heures enregistrées')).toHaveText(exactement(`1${FINE}234 h`));
  await expect(valeur('CA Vendu')).toHaveText(exactement(`12${FINE}346 €`));
  await expect(valeur('Marge totale')).toHaveText(exactement(`-2${FINE}346 €`));
  await expect(valeur('Commission commerciale')).toHaveText(exactement(`1${FINE}500 €`));
  // #499, cadrage version 2 (points 1 et 10) : marge de -0,04 % à une décimale, « 0 % » (fmtPourcentage, jamais « -0 % »).
  // Lectures écartées : « -0.0% » (toFixed(1), avant #499), « -0 % » (Intl sans signDisplay), « -0,04 % » (deux décimales).
  await expect(page.locator('div.bg-white.p-4', { hasText: 'Marge totale' }).last().locator('div.text-xs.text-gray-400')).toHaveText(/^0\u0020% · \S.*$/);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

async function creerCommercial(request: APIRequestContext, token: string) {
  const suffixe = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const creation = await request.post(`${api}/users`, { headers: { Authorization: `Bearer ${token}` }, data: { email: `test.format.${suffixe}@iris.test`, name: `TEST Commercial format ${suffixe}`, role: 'COMMERCIAL' } });
  expect(creation.ok(), await creation.text()).toBeTruthy();
  return creation.json() as Promise<{ id: string; name: string; email: string }>;
}

const chantierCommercial = (suffixe: string) => ({
  id: `e2e-format-${suffixe}`, nom: `TEST Chantier format ${suffixe}`, client: 'TEST Client format', dateDebut: new Date().toISOString(),
  statut: 'TERMINE', encaisse: true, valide: true, baremeReduit: false, comptabiliseDansPeriode: true,
  // 1 234,5 € : « 1 235 € » ; 999,5 € : « 1 000 € », le millier atteint par l'arrondi.
  budgetGlobalVendu: 1234.5, margeCommerciale: 999.5, commissionEstimee: 0,
});

test('Résultat commercial, navigateur en anglais : CA, marge, rémunération et chantiers au format français', async ({ page, request, session }) => {
  const commercial = await creerCommercial(request, session.token);
  const chantier = chantierCommercial(commercial.id);
  await remplacerReponse(page, '**/api/stats/commerciaux?*', (donnees) => ({
    ...donnees,
    commerciaux: (donnees.commerciaux ?? []).map((c: { id: string }) => (c.id === commercial.id
      ? { ...c, caTotal: 12345.5, margeTotal: -2345.5, commissionTotal: 1234.5, nbChantiers: 1, chantiers: [chantier] }
      : c)),
  }));
  await page.addInitScript(([jeton, utilisateur]) => {
    localStorage.setItem('token', jeton as string);
    localStorage.setItem('user', utilisateur as string);
  }, [jetonPour(commercial.id), JSON.stringify({ ...commercial, role: 'COMMERCIAL', permissions: [] })]);
  await page.goto('/resultat-commercial', { waitUntil: 'networkidle' });
  await navigateurEnAnglais(page);
  const carte = (libelle: string) => page.locator('div.bg-gray-50.rounded-xl', { hasText: libelle }).locator('div.text-2xl');
  await expect(carte('CA vendu (validé, période)')).toHaveText(exactement(`12${FINE}346 €`));
  await expect(carte('Marge commerciale (validée, période)')).toHaveText(exactement(`-2${FINE}346 €`));
  await expect(carte('Rémunération variable (période)')).toHaveText(exactement(`1${FINE}235 €`));
  const ligne = page.locator('tr', { hasText: chantier.nom });
  await expect(ligne.locator('td').nth(3)).toHaveText(exactement(`1${FINE}235 €`));
  await expect(ligne.locator('td').nth(4)).toHaveText(exactement(`1${FINE}000 €`));
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('Mes commerciaux, navigateur en anglais : CA, marge, rémunération et marge par chantier au format français', async ({ page, allerSurPageAdmin }) => {
  const nom = `TEST Commercial format ${Date.now()}`;
  const chantier = chantierCommercial(String(Date.now()));
  await remplacerReponse(page, '**/api/stats/commerciaux?*', (donnees) => ({
    ...donnees,
    commerciaux: [{
      id: 'e2e-format-commercial', name: nom, email: 'test.format.commercial@iris.test', nbChantiers: 1, sansPlanCommercial: true,
      caTotal: 12345.5, margeTotal: -2345.5, commissionTotal: 1234.5, chantiers: [chantier],
    }],
  }));
  await allerSurPageAdmin('/commerciaux');
  await navigateurEnAnglais(page);
  const carte = page.locator('div.bg-white.rounded-xl', { hasText: nom });
  const montant = (libelle: string) => carte.locator('div.text-right', { hasText: libelle }).locator('div.font-bold').last();
  await expect(montant('CA validé')).toHaveText(exactement(`12${FINE}346 €`));
  await expect(montant('Marge validée')).toHaveText(exactement(`-2${FINE}346 €`));
  await expect(montant('Rémunération variable')).toHaveText(exactement(`1${FINE}235 €`));
  await carte.getByText(nom, { exact: true }).click();
  await expect(carte.locator('tr', { hasText: chantier.nom }).locator('td').nth(2)).toHaveText(exactement(`1${FINE}000 €`));
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('Marges & Commissions, navigateur en anglais : les tranches du barème partent de montants au format français', async ({ page, allerSurPageAdmin }) => {
  // Lecture seule : aucune règle n'est enregistrée, seule la réponse lue par l'écran porte ces tranches.
  await remplacerReponse(page, '**/api/parametres/remuneration', (donnees) => ({
    ...donnees, baremeStandard: [{ plafond: 1234.5, taux: 10 }, { plafond: 12345.5, taux: 15 }, { plafond: null, taux: 20 }],
  }));
  await allerSurPageAdmin('/admin');
  await page.getByRole('button', { name: 'Marges & Commissions', exact: true }).click();
  await navigateurEnAnglais(page);
  const bareme = page.locator('div.p-4.rounded.border', { hasText: 'Barème standard' });
  await expect(bareme.locator('span', { hasText: /^dès / })).toHaveText([exactement('dès 0 €'), exactement(`dès 1${FINE}235 €`), exactement(`dès 12${FINE}346 €`)]);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('Performances, navigateur en anglais : CA, marge et manque à gagner au format français', async ({ page, allerSurPageAdmin }) => {
  const nom = `TEST Conducteur format ${Date.now()}`;
  await page.route('**/api/stats/conducteurs', (route) => route.fulfill({
    json: [{
      id: 'e2e-format-conducteur', name: nom, email: 'test.format.conducteur@iris.test', nbChantiersEnCours: 1, nbChantiersTermines: 1,
      caTotal: 12345.5, margeTotal: -2345.5, margePct: -19, nbEnAvanceHeures: 0, nbEnRetardHeures: 1, nbMaterielDansBudget: 1, nbMaterielDepasse: 0,
      nbTermineEnAvanceHeures: 0, nbTermineEnRetardHeures: 1, nbTermineMaterielDansBudget: 1, nbTermineMaterielDepasse: 0,
      tauxDepassementHeures: 12.5, manqueAGagnerMainOeuvre: 1234.5, tauxObjectifsRespectes: 0, nbObjectifsRespectes: 0,
    }],
  }));
  // Assiduité de la semaine du même conducteur : trois jours actifs (7,5 h, 7,25 h et 7,25 h), 22 h en trois saisies.
  await remplacerReponse(page, '**/api/stats/conducteurs/assiduite?*', (donnees) => ({
    ...donnees,
    conducteurs: [{
      id: 'e2e-format-conducteur', joursActifs: 3, nbSaisiesTotal: 3, heuresTotalesSaisies: 22, moyenneHeuresParJourActif: 22 / 3, heurePic: 8,
      tranchesHoraires: [{ heure: 8, nbSaisies: 3 }],
      days: [
        { date: '2026-11-16', label: 'Lundi', nbSaisies: 1, heuresSaisies: 7.5 },
        { date: '2026-11-17', label: 'Mardi', nbSaisies: 1, heuresSaisies: 7.25 },
        { date: '2026-11-18', label: 'Mercredi', nbSaisies: 1, heuresSaisies: 7.25 },
        { date: '2026-11-19', label: 'Jeudi', nbSaisies: 0, heuresSaisies: 0 },
        { date: '2026-11-20', label: 'Vendredi', nbSaisies: 0, heuresSaisies: 0 },
      ],
    }],
  }));
  await allerSurPageAdmin('/performances');
  await navigateurEnAnglais(page);
  const carte = page.locator('div.bg-white.rounded-xl', { hasText: nom });
  await expect(carte.locator('div.bg-gray-50', { hasText: 'CA vendu' }).locator('div.mt-0\\.5')).toHaveText(exactement(`12${FINE}346 €`));
  await expect(carte.locator('div.bg-gray-50', { hasText: 'Marge générée' }).locator('div.mt-0\\.5')).toHaveText(exactement(`-2${FINE}346 €`));
  await expect(carte.locator('div.border-t', { hasText: 'Dépassement heures' }).locator('span.text-sm.font-black').last()).toHaveText(exactement(`-1${FINE}235 €`));
  // #499, cadrage version 2 (points 1 et 10) : pourcentages par fmtPourcentage, virgule et espace ordinaire avant « % ».
  // Marge -19 % à une décimale : « -19 % » (et non « -19.0% », toFixed(1)) ; dépassement 12,5 % : « 12,5 % » (et non
  // « 12.5% ») ; objectifs 0 % sans décimale : « 0/1 (0 %) » (et non « 0/1 (0%) »).
  await expect(carte.locator('div.bg-gray-50', { hasText: 'Marge %' }).locator('div.mt-0\\.5')).toHaveText(/^-19\u0020%$/);
  await expect(carte.locator('div.border-t', { hasText: 'Dépassement heures' }).locator('span.text-sm.font-black').first()).toHaveText(/^12,5\u0020%$/);
  await expect(carte.locator('div.border-t', { hasText: 'Objectifs respectés' }).locator('span.text-sm.font-black')).toHaveText(/^0\/1 \(0\u0020%\)$/);
  // Assiduité de la semaine, heures par fmtHeures (deux décimales au plus) : 7,25 h dans la journée, « 7,25 h » (et non
  // « 7.3h », toFixed(1)) ; 22 h saisies, « 22 h » (et non « 22.0h ») ; 22 h sur 3 jours actifs, « 7,33 h » (et non « 7.3h »,
  // ni « 7,3 h » à une décimale). L'heure d'horloge du créneau habituel reste « 8h-9h ».
  const assiduite = carte.locator('div.pt-3.border-t', { hasText: 'Assiduité de saisie' });
  await expect(assiduite.locator('div.grid-cols-5 > div').nth(1).locator('div.text-sm')).toHaveText(/^7,25\u0020h$/);
  await expect(assiduite.locator('span', { hasText: 'saisies ·' })).toHaveText(/^22\u0020h saisies · 3 saisies$/);
  await expect(assiduite.locator('span', { hasText: 'jour actif en moyenne' })).toHaveText(/^7,33\u0020h \/ jour actif en moyenne$/);
  await expect(assiduite.getByText(/— vers 8h-9h/)).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('Statistiques, navigateur en anglais : coût d’un intervenant et achats d’un fournisseur au format français', async ({ page, allerSurPageAdmin }) => {
  await remplacerReponse(page, '**/api/stats/intervenants?*', (donnees) => ({
    ...donnees, intervenants: [{ id: 'e2e-format-intervenant', nom: 'TEST Intervenant format', role: 'Technicien', heures: 12.5, cout: 1234.5 }],
  }));
  await remplacerReponse(page, '**/api/stats/fournisseurs?*', (donnees) => ({
    ...donnees, fournisseurs: [{ id: 'e2e-format-fournisseur', nom: 'TEST Fournisseur format', nbAchats: 2, total: 12345.5 }],
  }));
  // #499 v2 : répartition des chantiers terminés (0 décimale) et des types de chantiers (1 décimale).
  await remplacerReponse(page, '**/api/stats/chantiers-repartition', (donnees) => ({
    ...donnees, total: 8, categories: [
      { key: 'positif', count: 1, pct: 12.5, label: 'TEST répartition format' },
      { key: 'tempsSeul', count: 7, pct: 87.5, label: 'TEST répartition format' },
    ],
  }));
  await remplacerReponse(page, '**/api/stats/types-chantiers?*', (donnees) => ({
    ...donnees, totalChantiers: 8, types: [{ type: 'TEST Type format A', count: 1, pct: 12.5 }, { type: 'TEST Type format B', count: 1, pct: 0.15 }],
  }));
  await allerSurPageAdmin('/statistiques');
  await navigateurEnAnglais(page);
  // #499, cadrage version 2, point 1 : répartition sans décimale, 12,5 % donne « 13 % » et 87,5 % « 88 % » (moitié vers
  // l'extérieur). Lectures écartées : « 13% » et « 88% » (toFixed(0), avant #499, sans espace), « 12 % » et « 88 % » (arrondi
  // au pair), « 12,5 % » (une décimale).
  await expect(page.locator('div.bg-gray-50.rounded-xl', { hasText: 'Tout positif' }).locator('span.text-sm.font-semibold')).toHaveText(/^\(13\u0020%\)$/);
  await expect(page.locator('div.bg-gray-50.rounded-xl', { hasText: 'Dépassement temps seul' }).locator('span.text-sm.font-semibold')).toHaveText(/^\(88\u0020%\)$/);
  await page.getByRole('button', { name: 'Intervenants' }).click();
  await expect(page.locator('[data-intervenant="e2e-format-intervenant"] div.text-right div.text-xs')).toHaveText(exactement(`1${FINE}235 €`));
  // #499, cadrage version 2, point 2 : heures de l'intervenant par fmtHeures, « 12,5 h » (et non « 12.5 h », toFixed(1)).
  await expect(page.locator('[data-intervenant="e2e-format-intervenant"] div.text-right div.font-black')).toHaveText(/^12,5\u0020h$/);
  await page.getByRole('button', { name: 'Fournisseurs' }).click();
  const fournisseur = page.locator('div.flex.items-center.gap-4', { hasText: 'TEST Fournisseur format' });
  await expect(fournisseur.locator('div.text-right div.font-black')).toHaveText(exactement(`12${FINE}346 €`));
  // Types de chantiers, une décimale : « 12,5 % » (et non « 12.5% ») ; 0,15 % donne « 0,2 % », l'arrondi d'Intl sur
  // l'écriture décimale (toFixed(1) sur le flottant donnait « 0.1% » ; une troncature donnerait « 0,1 % »).
  await page.getByRole('button', { name: 'Types de chantiers' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'TEST Type format A' }).getByRole('cell').nth(2)).toHaveText(/^12,5\u0020%$/);
  await expect(page.getByRole('row').filter({ hasText: 'TEST Type format B' }).getByRole('cell').nth(2)).toHaveText(/^0,2\u0020%$/);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

// #499, cadrage version 2 (points 3 et 10) : taux de TVA par fmtPourcentage, deux décimales au plus, sans zéro inutile.
// Catalogue : 5,5 % et 20 %, les deux taux réduit et normal admis par le catalogue. Lectures écartées : « 5.50 % » et
// « 20.00 % » (toFixed(2), avant #499), « 5,50 % » et « 20,00 % » (deux décimales fixes), « 5.5 % » (langue du navigateur).
test('Catalogue, navigateur en anglais : taux de TVA « 5,5 % » et « 20 % » au format français', async ({ page, request, session, allerSurPageAdmin }) => {
  const headers = { Authorization: `Bearer ${session.token}` };
  const suffixe = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const creer = async (reference: string, tauxTva: string) => {
    const response = await request.post(`${api}/catalogue/articles`, { headers, data: { reference, nom: `TEST Article TVA ${tauxTva} ${suffixe}`, unite: 'u', prixVenteHt: '10', tauxTva } });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json() as Promise<{ id: string; tauxTva: number }>;
  };
  const reduit = await creer(`E2E-TVA55-${suffixe}`, '5.5');
  const normal = await creer(`E2E-TVA20-${suffixe}`, '20');
  const fiches = await (await request.get(`${api}/catalogue/articles`, { headers })).json() as { id: string; tauxTva: number }[];
  expect([reduit.id, normal.id].map((id) => fiches.filter((f) => f.id === id).map((f) => Number(f.tauxTva)))).toEqual([[5.5], [20]]);
  await allerSurPageAdmin('/catalogue');
  await navigateurEnAnglais(page);
  await page.getByRole('button', { name: 'Articles', exact: true }).click();
  const tableau = page.getByRole('table');
  await expect(tableau.getByRole('columnheader').nth(5)).toHaveText('TVA');
  await expect(tableau.getByRole('row').filter({ hasText: `E2E-TVA55-${suffixe}` }).getByRole('cell').nth(5)).toHaveText(/^5,5\u0020%$/);
  await expect(tableau.getByRole('row').filter({ hasText: `E2E-TVA20-${suffixe}` }).getByRole('cell').nth(5)).toHaveText(/^20\u0020%$/);
});

// Comptabilité (cadrage v2, point 3 : Comptabilite.tsx:57, :73 et :97) : une règle TVA à 5,5 %, créée à l'écran en tapant
// « 5,5 », puis retirée. Message d'enregistrement « TVA 5,5 % enregistrée. » : le texte tapé est relu (virgule ramenée au
// point) puis mis en forme (lectures écartées : « TVA 5,5% enregistrée. », le texte tapé d'avant #499 ; « TVA NaN % », une
// virgule non relue). Historique « TVA 5,5 % » (et non « TVA 5.5 % », la cible brute), boîte de retrait « Retirer la règle
// TVA 5,5 % ? » et « les émissions futures à 5,5 % », message de retrait « Règle TVA 5,5 % retirée. » (et non « 5.5 % »).
// Le taux 5,5 % est laissé sans règle à la fin, comme le parcours comptabilite.spec.ts le suppose à son début.
test('Comptabilité, navigateur en anglais : règle TVA à 5,5 %, enregistrée puis retirée, au format français dans les messages, l’historique et la boîte de retrait', async ({ page, request, session, allerSurPageAdmin }) => {
  const headers = { Authorization: `Bearer ${session.token}` };
  type Plan = { reglesTva: { taux: number; compteId: string; updatedAt: string }[]; comptes: { id: string; actif: boolean }[] };
  const plan = async () => (await (await request.get(`${api}/comptabilite`, { headers })).json()) as Plan;
  const retirer55 = async (motif: string) => {
    const regle = (await plan()).reglesTva.find((r) => r.taux === 5.5);
    if (!regle) return;
    const retrait = await request.delete(`${api}/comptabilite/tva/5.5`, { headers, data: { confirmation: '5.5', expectedCompteId: regle.compteId, expectedUpdatedAt: regle.updatedAt, motif } });
    expect(retrait.ok(), await retrait.text()).toBeTruthy();
  };
  await retirer55('Remise à zéro du parcours des formats');
  const suffixe = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const code = `445${String(Date.now()).slice(-9)}`;
  const libelle = `TVA réduite format ${suffixe}`;
  const creation = await request.post(`${api}/comptabilite/comptes`, { headers, data: { code, libelle, nature: 'TVA' } });
  expect(creation.status(), await creation.text()).toBe(201);
  const compteId = (await creation.json() as { id: string }).id;
  const motifCreation = `TEST création TVA format ${suffixe}`;
  const motifRetrait = `TEST retrait TVA format ${suffixe}`;
  try {
    await allerSurPageAdmin('/comptabilite');
    await navigateurEnAnglais(page);
    await page.getByRole('textbox', { name: 'Taux de TVA (%)' }).fill('5,5');
    await page.getByRole('combobox', { name: 'Compte TVA à associer' }).selectOption(compteId);
    await page.getByRole('textbox', { name: /Motif de création TVA/ }).fill(motifCreation);
    const enregistrement = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/api/comptabilite/tva/'));
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    expect((await enregistrement).status()).toBe(200);
    await expect(page.locator('p.text-emerald-700')).toHaveText(/^TVA 5,5\u0020% enregistrée\.$/);
    expect((await plan()).reglesTva.filter((r) => r.taux === 5.5).map((r) => r.compteId)).toEqual([compteId]);

    await page.getByRole('button', { name: 'Historique des règles' }).click();
    const historique = page.getByRole('region', { name: 'Historique des règles' });
    await expect(historique.locator('p', { hasText: motifCreation })).toHaveText(new RegExp(`^Création de TVA 5,5\u0020% : — → ${code} — ${echapper(libelle)} · ${echapper(motifCreation)} · `));

    const ligne = page.getByRole('row').filter({ hasText: code });
    await ligne.getByRole('button', { name: 'Retirer' }).click();
    const dialogue = page.getByRole('dialog', { name: 'Retirer la règle TVA' });
    await expect(dialogue.getByRole('heading')).toHaveText(/^Retirer la règle TVA 5,5\u0020% \?$/);
    await expect(dialogue.locator('p.text-sm.text-gray-600')).toHaveText(new RegExp(`^Le compte ${code} reste dans le plan\\. Les exports des factures émises restent inchangés ; les émissions futures à 5,5\u0020% seront bloquées avant numérotation jusqu’à un nouveau mapping\\.$`));
    await dialogue.getByLabel('Confirmer le taux exact').fill('5,5');
    await dialogue.getByRole('textbox', { name: /Motif du retrait/ }).fill(motifRetrait);
    const suppression = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/api/comptabilite/tva/'));
    await dialogue.getByRole('button', { name: 'Confirmer le retrait' }).click();
    expect((await suppression).status()).toBe(204);
    await expect(page.locator('p.text-emerald-700')).toHaveText(/^Règle TVA 5,5\u0020% retirée\. Le compte reste disponible\.$/);
    const apres = await plan();
    expect(apres.reglesTva.some((r) => r.taux === 5.5)).toBe(false);
    expect(apres.comptes.find((c) => c.id === compteId)?.actif).toBe(true);
    await page.getByRole('button', { name: 'Historique des règles' }).click();
    await expect(historique.locator('p', { hasText: motifRetrait })).toHaveText(new RegExp(`^Retrait de TVA 5,5\u0020% : ${code} — ${echapper(libelle)} → retiré · ${echapper(motifRetrait)} · `));
  } finally {
    await retirer55('Nettoyage du parcours des formats');
  }
});
