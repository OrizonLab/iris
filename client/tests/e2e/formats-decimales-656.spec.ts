import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// #656, T1 à T3 (tests manquants hors montants de l'audit des montants de #655), lot AD, cadrage v2 qui fait foi (T1, T2,
// T3, N5 à N7) : chaque affichage d'une décimale déclarée par #655 reçoit une valeur dont l'arrondi à cette décimale diffère
// de l'arrondi à une décimale de plus. Les témoins d'avant (100 %, 0 %, 12,5 h, 3 h, 22 h) laissaient survivre le mutant à une
// décimale de chaque ligne : ici, chaque attendu est prouvé par ce mutant, joué sur une copie hors du dépôt.
//
// Les décimales testées sont des choix par défaut, à confirmer (micro-arbitrages d'affichage, règle 5 ; section 4 de la
// passation, bloc « Formats restants (#655) ») : avancement et objectifs respectés sans décimale (fmtPourcentage(…, 0)),
// heures à deux décimales au plus (fmtHeures).
//
// Seul l'affichage est en cause : les valeurs sont injectées dans les réponses du serveur par `page.route` (comme
// formats-locale.spec.ts et formats-marges-quantites.spec.ts), sans rien écrire en base. Ce fichier n'affirme aucun montant ni
// aucune couleur (cadrage v2, N5) : la couleur des objectifs de Performances, calculée sur la valeur brute, est la note N8 de
// #656, hors lot. Les heures d'une intervention (#259) sont couvertes par #675 (cadrage v2, N7).
//
// Les espaces sont nommées par leur caractère dans des expressions ancrées : espace ordinaire U+0020 avant « % » et « h ».

async function remplacerReponse(page: Page, motif: string, modifier: (donnees: any) => unknown) {
  await page.route(motif, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const reponse = await route.fetch();
    await route.fulfill({ response: reponse, json: modifier(await reponse.json()) });
  });
}

// Réponse entière remplacée (lecture seule) : la page ne voit que les éléments du parcours, quelle que soit la base conservée.
async function injecterReponse(page: Page, motif: string, donnees: unknown) {
  await page.route(motif, (route) => (route.request().method() === 'GET' ? route.fulfill({ json: donnees }) : route.fallback()));
}

// T1 : un chantier en cours, 6 h réalisées sur 9 h vendues, avancement 200/3 % (66,666… %), tel que le serveur l'envoie
// (metrics.pctHeures). Aucune alerte, aucune marge estimée : ni « À surveiller » ni encart de rentabilité.
const chantierEnCours = {
  id: 'e2e-656-chantier', nom: 'TEST Chantier décimales 656', client: 'TEST Client décimales 656', numeroDevis: null,
  statut: 'EN_COURS', dateDebut: '2026-11-02T00:00:00.000Z', heuresVendues: 9,
  budgetGlobalVendu: null, budgetMaterielVendu: null, budgetMainOeuvreVendu: null, responsable: null, commercial: null,
  metrics: { heuresRealisees: 6, pctHeures: 200 / 3, alertes: [] },
};

const ligneDuChantier = (page: Page) => page.locator('div.bg-white.rounded-2xl')
  .filter({ has: page.getByRole('heading', { name: 'Chantiers en cours' }) })
  .getByRole('button').filter({ hasText: chantierEnCours.nom });

// T1, Dashboard.tsx:366 (colonne de l'ordinateur, `hidden sm:flex`). 200/3 % sans décimale : « 67 % ». Lectures écartées :
// « 66,7 % » (une décimale, le mutant de la ligne), « 66,67 % » (deux décimales), « 66 % » (troncature).
test('tableau de bord sur ordinateur : un avancement de 200/3 % s’écrit « 67 % », sans décimale', async ({ page, allerSurPageAdmin }) => {
  await injecterReponse(page, '**/api/chantiers', [chantierEnCours]);
  try {
    await allerSurPageAdmin('/');
    const avancement = ligneDuChantier(page).locator('div.hidden.sm\\:flex > span');
    await expect(avancement).toBeVisible();
    await expect(avancement).toHaveText(/^67 %$/);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

// T1, Dashboard.tsx:371 (colonne du téléphone, `sm:hidden`, w-12), à 375 px. Mêmes lectures écartées qu'à la ligne 366.
test('tableau de bord sur téléphone (375 px) : un avancement de 200/3 % s’écrit « 67 % », sans décimale', async ({ connexion }) => {
  const page = await connexion('SA', { viewport: { width: 375, height: 740 } });
  await injecterReponse(page, '**/api/chantiers', [chantierEnCours]);
  await page.goto('/', { waitUntil: 'networkidle' });
  const avancement = ligneDuChantier(page).locator('span.sm\\:hidden');
  await expect(avancement).toBeVisible();
  await expect(avancement).toHaveText(/^67 %$/);
});

// T2 et T3, Performances : un conducteur dont 2 des 3 chantiers terminés respectent leurs objectifs (taux 200/3 %), et
// 22,25 h saisies en trois fois dans la semaine (7,5 h, 7,5 h et 7,25 h). CA, marge et marge % non communiqués (« — ») : aucun
// montant n'est affiché ni affirmé ici.
test('Performances : 2 objectifs respectés sur 3 s’écrivent « 2/3 (67 %) », et 22,25 h saisies « 22,25 h saisies · 3 saisies »', async ({ page, allerSurPageAdmin }) => {
  const nom = `TEST Conducteur décimales 656 ${Date.now()}`;
  await injecterReponse(page, '**/api/stats/conducteurs', [{
    id: 'e2e-656-conducteur', name: nom, email: 'test.decimales.656@iris.test', nbChantiersEnCours: 0, nbChantiersTermines: 3,
    caTotal: null, margeTotal: null, margePct: null, nbEnAvanceHeures: 0, nbEnRetardHeures: 0, nbMaterielDansBudget: 0, nbMaterielDepasse: 0,
    nbTermineEnAvanceHeures: 2, nbTermineEnRetardHeures: 1, nbTermineMaterielDansBudget: 3, nbTermineMaterielDepasse: 0,
    tauxDepassementHeures: 0, manqueAGagnerMainOeuvre: 0, tauxObjectifsRespectes: 200 / 3, nbObjectifsRespectes: 2,
  }]);
  await remplacerReponse(page, '**/api/stats/conducteurs/assiduite?*', (donnees) => ({
    ...donnees,
    conducteurs: [{
      id: 'e2e-656-conducteur', joursActifs: 3, nbSaisiesTotal: 3, heuresTotalesSaisies: 22.25, moyenneHeuresParJourActif: 22.25 / 3, heurePic: 8,
      tranchesHoraires: [{ heure: 8, nbSaisies: 3 }],
      days: [
        { date: '2026-11-16', label: 'Lundi', nbSaisies: 1, heuresSaisies: 7.5 },
        { date: '2026-11-17', label: 'Mardi', nbSaisies: 1, heuresSaisies: 7.5 },
        { date: '2026-11-18', label: 'Mercredi', nbSaisies: 1, heuresSaisies: 7.25 },
        { date: '2026-11-19', label: 'Jeudi', nbSaisies: 0, heuresSaisies: 0 },
        { date: '2026-11-20', label: 'Vendredi', nbSaisies: 0, heuresSaisies: 0 },
      ],
    }],
  }));
  try {
    await allerSurPageAdmin('/performances');
    const carte = page.locator('div.bg-white.rounded-xl', { hasText: nom });
    // T2, Performances.tsx:184 : 200/3 % sans décimale, « 2/3 (67 %) ». Lectures écartées : « 2/3 (66,7 %) » (une décimale, le
    // mutant de la ligne), « 2/3 (66,67 %) » (deux décimales), « 2/3 (66 %) » (troncature). La couleur n'est pas lue (N8).
    await expect(carte.locator('div.border-t', { hasText: 'Objectifs respectés' }).locator('span.text-sm.font-black')).toHaveText(/^2\/3 \(67 %\)$/);
    // T3, Performances.tsx:216 : 22,25 h à deux décimales au plus, « 22,25 h saisies · 3 saisies ». Lectures écartées :
    // « 22,3 h » (une décimale, le mutant de la ligne), « 22,2 h » (troncature à une décimale), « 22 h » (aucune décimale).
    const assiduite = carte.locator('div.pt-3.border-t', { hasText: 'Assiduité de saisie' });
    await expect(assiduite.locator('span', { hasText: 'saisies ·' })).toHaveText(/^22,25 h saisies · 3 saisies$/);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

// T3, écran Heures : un chantier en cours (10 h vendues) et un seul pointage de 7,25 h, d'un intervenant du parcours. Les
// heures réalisées de la carte d'avancement sont la somme des pointages du chantier : 7,25 h. Le coût interne de la ligne
// (colonne de l'administration) n'est pas affirmé : ce fichier ne lit aucun montant.
const chantierHeures = { id: 'e2e-656-chantier-heures', nom: 'TEST Chantier heures 656', client: 'TEST Client décimales 656', numeroDevis: null, statut: 'EN_COURS', heuresVendues: 10 };
const intervenantHeures = { id: 'e2e-656-intervenant-heures', nom: 'TEST Intervenant heures 656', role: 'Technicien' };
const pointage = {
  id: 'e2e-656-pointage', date: '2026-11-24T00:00:00.000Z', chantierId: chantierHeures.id, intervenantId: intervenantHeures.id,
  nbrHeures: 7.25, tauxHoraireApplique: 40, commentaire: null,
  chantier: { id: chantierHeures.id, nom: chantierHeures.nom }, intervenant: intervenantHeures,
};

async function injecterHeures(page: Page) {
  await injecterReponse(page, '**/api/heures', [pointage]);
  await injecterReponse(page, '**/api/chantiers', [chantierHeures]);
}

// Lectures écartées pour chaque 7,25 h de l'écran Heures : « 7,3 h » (une décimale, le mutant de la ligne), « 7,2 h »
// (troncature à une décimale), « 7 h » (aucune décimale).
test('écran Heures sur ordinateur : 7,25 h s’écrivent « 7,25 h réalisées » sur la carte d’avancement et « 7,25 h » dans le tableau du journal', async ({ page, allerSurPageAdmin }) => {
  await injecterHeures(page);
  try {
    await allerSurPageAdmin('/heures');
    // Heures.tsx:84 : heures réalisées de la carte d'avancement.
    const carte = page.locator('div.card').filter({ has: page.getByRole('heading', { name: chantierHeures.nom }) });
    await expect(carte.locator('span').filter({ hasText: 'réalisées' })).toHaveText(/^7,25 h réalisées$/);
    // Heures.tsx:204 : colonne « Heures » du tableau du journal (vue de l'ordinateur, `hidden md:block`).
    await page.getByRole('button', { name: /Historique récent/ }).click();
    await expect(page.getByRole('columnheader').nth(3)).toHaveText('Heures');
    const ligne = page.getByRole('row').filter({ hasText: intervenantHeures.nom });
    await expect(ligne).toBeVisible();
    await expect(ligne.getByRole('cell').nth(3)).toHaveText(/^7,25 h$/);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

// Heures.tsx:176 (cadrage v2, N6) : cartes du journal, vue du téléphone (`md:hidden`), à 375 px.
test('écran Heures sur téléphone (375 px) : 7,25 h s’écrivent « 7,25 h » sur la carte du pointage dans le journal', async ({ connexion }) => {
  const page = await connexion('SA', { viewport: { width: 375, height: 740 } });
  await injecterHeures(page);
  await page.goto('/heures', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Historique récent/ }).click();
  const cartePointage = page.locator('div.bg-white.p-4.rounded-xl').filter({ hasText: intervenantHeures.nom });
  await expect(cartePointage).toBeVisible();
  await expect(cartePointage.locator('span.font-extrabold')).toHaveText(/^7,25 h$/);
});

// T3, Statistiques.tsx:193, onglet Intervenants : un intervenant à 7,25 h sur la période, « 7,25 h ». Lectures écartées : « 7,3 h »
// (une décimale, le mutant de la ligne), « 7,2 h » (troncature à une décimale), « 7 h » (aucune décimale). Coût non communiqué
// (null) : la ligne n'affiche aucun montant.
test('Statistiques, onglet Intervenants : 7,25 h s’écrivent « 7,25 h »', async ({ page, allerSurPageAdmin }) => {
  await remplacerReponse(page, '**/api/stats/intervenants?*', (donnees) => ({
    ...donnees, intervenants: [{ id: 'e2e-656-intervenant', nom: 'TEST Intervenant décimales 656', role: 'Technicien', heures: 7.25, cout: null }],
  }));
  try {
    await allerSurPageAdmin('/statistiques');
    await page.getByRole('button', { name: 'Intervenants' }).click();
    await expect(page.locator('[data-intervenant="e2e-656-intervenant"] div.text-right div.font-black')).toHaveText(/^7,25 h$/);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});
