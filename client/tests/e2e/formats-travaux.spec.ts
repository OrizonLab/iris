import type { APIRequestContext } from '@playwright/test';
import { test, expect, dateDuJour } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// #499 et #259, cadrage du correctif, version 2 (points 2 et 4 ; choix par défaut, à confirmer, règle 5) : les montants des
// écrans Travaux passent au module de formats, et chacun garde une famille :
//  - Administration > Chantiers, budgets à l'euro près (fmtEuro, comme la liste des chantiers), heures vendues par fmtHeures ;
//  - journal des achats, montant à l'euro près (fmtEuro, comme le journal des achats de la fiche) ;
//  - journal des heures, coût interne d'une ligne au centime en devise (fmtEuroCentime), heures par fmtHeures ;
//  - fiche chantier, hypothèses de la marge estimée au centime en devise : « €/h » et « € HT ».
// Avant le lot (8a47a50), ces montants s'écrivaient par toLocaleString() sans locale (« 1 234,25 € » en français, « 1,234.25 € »
// en anglais), toFixed(2) (« 1234.63 € ») ou toLocaleString('fr-FR') sans zéro, à l'espace ordinaire (« 1 000,5 € HT »). Chaque
// attendu nomme le caractère réel par une expression ancrée (précédent de #502) : séparateur des milliers U+202F, espace
// insécable U+00A0 d'Intl avant « € » au centime en devise, espace ordinaire U+0020 avant « € » à l'euro près et avant « h ».
//
// Montants (règle 2 ; un test manquant serait classé C), choisis pour qu'une autre lecture donne un autre texte :
//  - devis : 1 × 1 234,25 € HT de fourniture (prix d'achat prévu 1 000,50 €) et 1 × 1 110,50 € HT de pose : vendu
//    2 344,75 € HT, matériel 1 234,25 €, main-d'œuvre 1 110,50 €, coût d'achat prévu 1 000,50 € ; 18,75 heures vendues ;
//  - achat de 1 234,50 € HT ;
//  - pointage de 12,5 h au taux horaire chargé de 98,77 € : coût de la ligne 1 234,625 €, arrondi à 1 234,63 €, coût horaire
//    moyen du chantier 98,77 €.
const echapper = (texte: string) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function preparer(request: APIRequestContext, token: string, creerClient: (libelle: string) => Promise<{ id: string }>) {
  const headers = { Authorization: `Bearer ${token}` };
  const envoyer = async (methode: 'post' | 'put' | 'patch', chemin: string, data: object) => {
    const response = await request[methode](`${api}${chemin}`, { headers, data });
    expect(response.ok(), `${chemin} : ${await response.text()}`).toBeTruthy();
    return response.json();
  };
  const suffixe = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const client = await creerClient(`formats-travaux ${suffixe}`);
  const devis = await envoyer('post', '/devis', { clientId: client.id, objet: `TEST Formats Travaux ${suffixe}`, lignes: [
    { designation: 'Centrale', nature: 'FOURNITURE', quantite: 1, prixUnitaireHt: 1234.25, tauxTva: 20, prixAchatUnitaireHt: '1000.50' },
    { designation: 'Pose', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 1110.5, tauxTva: 20 },
  ] }) as { id: string };
  await envoyer('put', `/devis/${devis.id}/statut`, { statut: 'ENVOYE' });
  await envoyer('post', `/devis/${devis.id}/signature`, { signataire: 'Client E2E', confirme: true });
  const chantier = await envoyer('post', `/devis/${devis.id}/convertir`, { cible: 'CHANTIER' }) as { id: string; nom: string };
  await envoyer('patch', `/chantiers/${chantier.id}`, { heuresVendues: 18.75 });
  const categorie = await envoyer('post', '/categories', { nom: `TEST Formats Travaux ${suffixe} catégorie` }) as { id: string };
  const fournisseur = await envoyer('post', '/fournisseurs', { nom: `TEST Formats Travaux ${suffixe} fournisseur` }) as { id: string };
  const description = `TEST Achat formats ${suffixe}`;
  await envoyer('post', '/achats', { chantierId: chantier.id, categorieId: categorie.id, fournisseurId: fournisseur.id, date: dateDuJour(), description, montantHT: 1234.5 });
  const intervenant = await envoyer('post', '/intervenants', { nom: `TEST Intervenant formats ${suffixe}`, role: 'Technicien', tauxHoraireCharge: 98.77 }) as { id: string; nom: string };
  await envoyer('post', '/heures', { chantierId: chantier.id, intervenantId: intervenant.id, date: dateDuJour(), nbrHeures: 12.5 });
  return { headers, chantier, description, intervenant };
}

test('#499 : écrans Travaux, budgets et achat à l’euro près, coût d’une ligne d’heures et hypothèses de la fiche chantier au centime en devise, heures au format français', async ({ request, session, creerClient, allerSurPageAdmin, page }) => {
  test.slow();
  const { headers, chantier, description, intervenant } = await preparer(request, session.token, creerClient);
  try {
    // État relu par l'API : les montants affichés ensuite sont ceux que le serveur a enregistrés, sans autre calcul.
    const fiche = await (await request.get(`${api}/chantiers/${chantier.id}`, { headers })).json() as Record<string, unknown>;
    expect([fiche.budgetGlobalVendu, fiche.budgetMaterielVendu, fiche.budgetMainOeuvreVendu, fiche.heuresVendues, fiche.coutMaterielPrevu]).toEqual([2344.75, 1234.25, 1110.5, 18.75, 1000.5]);
    const achats = await (await request.get(`${api}/achats`, { headers })).json() as { description: string; montantHT: number }[];
    expect(achats.filter((a) => a.description === description).map((a) => a.montantHT)).toEqual([1234.5]);
    const pointages = await (await request.get(`${api}/heures`, { headers })).json() as { intervenantId: string; nbrHeures: number; tauxHoraireApplique: number }[];
    expect(pointages.filter((p) => p.intervenantId === intervenant.id).map((p) => [p.nbrHeures, p.tauxHoraireApplique])).toEqual([[12.5, 98.77]]);

    // 1. Administration > Chantiers : budgets à l'euro près, moitié vers l'extérieur, milliers en U+202F, espace ordinaire
    // avant « € ». Lectures écartées : le texte d'avant #499 dans ce navigateur français (« 2 344,75 € », « 1 234,25 € »,
    // « 1 110,5 € » ; « 2,344.75 € » en anglais), le centime en devise (« 2 344,75 € », U+00A0), la troncature (« 2 344 € »,
    // « 1 110 € »), l'arrondi au pair (« 1 110 € ») et l'arrondi vers le haut (« 1 235 € » pour 1 234,25 €).
    await allerSurPageAdmin('/admin');
    await expect(page.getByRole('heading', { name: 'Base de données des Chantiers' })).toBeVisible();
    const carte = page.locator('div.p-4.bg-white.border').filter({ hasText: chantier.nom });
    const valeur = (libelle: string) => carte.getByText(libelle, { exact: true }).locator('xpath=following-sibling::div[1]');
    await expect(valeur('Global Vendu')).toHaveText(/^2\u202F345\u0020€$/);
    await expect(valeur('Matériel')).toHaveText(/^1\u202F234\u0020€$/);
    await expect(valeur('Main d\'Œuvre')).toHaveText(/^1\u202F111\u0020€$/);
    // Heures vendues par fmtHeures : « 18,75 h », et non « 18.75 h » (nombre brut d'avant #499).
    await expect(valeur('Heures Vendues')).toHaveText(/^18,75\u0020h$/);

    // 2. Journal des achats : 1 234,50 € HT à l'euro près, « 1 235 € » (moitié vers l'extérieur). Lectures écartées : « 1 234,5 € »
    // d'avant #499 (toLocaleString() sans locale, ici en français), le centime en devise ou la forme des documents
    // (« 1 234,50 € »), l'arrondi au pair (« 1 234 € »).
    await page.goto('/achats', { waitUntil: 'networkidle' });
    const ligneAchat = page.getByRole('row').filter({ hasText: description });
    await expect(page.getByRole('columnheader').nth(6)).toHaveText('Montant (€ HT)');
    await expect(ligneAchat.getByRole('cell').nth(6)).toHaveText(/^1\u202F235\u0020€$/);

    // 3. Journal des heures : 12,5 h × 98,77 € = 1 234,625 €, coût de la ligne arrondi une fois au centime, moitié vers le haut
    // (coutLigneHeures), écrit au centime en devise : « 1 234,63 € ». Lectures écartées : « 1234.63 € » (toFixed, avant
    // #499), la forme des documents (« 1 234,63 € », U+0020), l'euro près (« 1 235 € »), la troncature (« 1 234,62 € »).
    // Les cartes d'avancement ne montrent que trois chantiers en cours : la liste des chantiers lue par l'écran est réduite
    // à celui du parcours (affichage seul ; les heures réalisées viennent des pointages réels).
    await page.route('**/api/chantiers', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const reponse = await route.fetch();
      const liste = await reponse.json() as { id: string }[];
      await route.fulfill({ response: reponse, json: liste.filter((c) => c.id === chantier.id) });
    });
    await page.goto('/heures', { waitUntil: 'networkidle' });
    const carteHeures = page.locator('div.card').filter({ has: page.getByRole('heading', { name: chantier.nom }) });
    // « 12,5 h réalisées », « 18,75 h vendues » (et non « 12.5h réalisées », « 18.75h vendues »).
    await expect(carteHeures.locator('span').filter({ hasText: 'réalisées' })).toHaveText(/^12,5\u0020h réalisées$/);
    await expect(carteHeures.locator('span').filter({ hasText: 'vendues' })).toHaveText(/^18,75\u0020h vendues$/);
    await page.getByRole('button', { name: /Historique récent/ }).click();
    await expect(page.getByRole('columnheader', { name: 'Coût Interne' })).toBeVisible();
    const lignePointage = page.getByRole('row').filter({ hasText: intervenant.nom });
    await expect(lignePointage.getByRole('cell').nth(3)).toHaveText(/^12,5\u0020h$/);
    await expect(lignePointage.getByRole('cell').nth(4)).toHaveText(/^1\u202F234,63\u00A0€$/);
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // 4. Fiche chantier, hypothèses de la marge estimée, au centime en devise (U+00A0 avant « € »), une famille par fichier :
    //  - coût horaire moyen du chantier, 1 234,625 € / 12,5 h = 98,77 € : « 98,77 €/h ». Lectures écartées : l'espace
    //    ordinaire d'avant #499 et de la forme des documents (« 98,77 €/h », U+0020), l'euro près (« 99 €/h ») ;
    //  - coût d'achat prévu 1 000,50 € : « 1 000,50 € HT ». Lectures écartées : « 1 000,5 € HT » d'avant #499 (sans zéro,
    //    U+0020), la forme des documents (U+0020), l'euro près (« 1 001 € HT »).
    // Les montants attendus restent à l'euro près : main-d'œuvre 18,75 h × 98,77 € = 1 851,94 €, « 1 852 € » ; matériel, le
    // réel de 1 234,50 € au-dessus du prévu, « 1 235 € ».
    await page.goto(`/chantiers/${chantier.id}`, { waitUntil: 'networkidle' });
    const estimation = page.locator('[data-estimation]');
    await expect(estimation.locator('li', { hasText: 'Main-d’œuvre attendue' })).toHaveText(new RegExp(`^${echapper('Main-d’œuvre attendue : ')}1\u202F852\u0020€ — heures vendues à 98,77\u00A0€/h, ${echapper('coût moyen réellement appliqué sur ce chantier.')}$`));
    await expect(estimation.locator('li', { hasText: 'Matériel attendu' })).toHaveText(new RegExp(`^Matériel attendu : 1\u202F235\u0020€ — coût d’achat prévu au devis \\(1\u202F000,50\u00A0€ HT\\), une fourniture sans prix d’achat prévu comptant pour zéro\\.$`));
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
    // Chantier clôturé à la fin : il ne s'ajoute pas aux chantiers en cours des autres parcours.
    await request.patch(`${api}/chantiers/${chantier.id}/statut`, { headers, data: { statut: 'TERMINE' } }).catch(() => undefined);
  }
});

// #499, cadrage version 2, point 1 (N10) : sur téléphone, l'avancement d'un chantier en cours du tableau de bord (Dashboard.tsx,
// colonne w-12) s'écrit « 100 % » (fmtPourcentage, espace ordinaire) sur une seule ligne, sans que la page déborde.
test('#499 : tableau de bord sur téléphone (375 px), l’avancement « 100 % » d’un chantier en cours tient sur une ligne', async ({ request, session, creerClient, connexion }) => {
  const headers = { Authorization: `Bearer ${session.token}` };
  const envoyer = async (methode: 'post' | 'put' | 'patch', chemin: string, data: object) => {
    const response = await request[methode](`${api}${chemin}`, { headers, data });
    expect(response.ok(), `${chemin} : ${await response.text()}`).toBeTruthy();
    return response.json();
  };
  const suffixe = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const client = await creerClient(`formats-avancement ${suffixe}`);
  const devis = await envoyer('post', '/devis', { clientId: client.id, objet: `TEST Avancement 375 ${suffixe}`, lignes: [
    { designation: 'Pose', nature: 'MAIN_OEUVRE', quantite: 2, prixUnitaireHt: 50, tauxTva: 20 },
  ] }) as { id: string };
  await envoyer('put', `/devis/${devis.id}/statut`, { statut: 'ENVOYE' });
  await envoyer('post', `/devis/${devis.id}/signature`, { signataire: 'Client E2E', confirme: true });
  const chantier = await envoyer('post', `/devis/${devis.id}/convertir`, { cible: 'CHANTIER' }) as { id: string; nom: string };
  try {
    await envoyer('patch', `/chantiers/${chantier.id}`, { heuresVendues: 2 });
    const intervenant = await envoyer('post', '/intervenants', { nom: `TEST Intervenant avancement ${suffixe}`, role: 'Technicien', tauxHoraireCharge: 40 }) as { id: string };
    await envoyer('post', '/heures', { chantierId: chantier.id, intervenantId: intervenant.id, date: dateDuJour(), nbrHeures: 2 });
    const relu = await (await request.get(`${api}/chantiers/${chantier.id}`, { headers })).json() as { metrics?: { pctHeures?: number } };
    expect(relu.metrics?.pctHeures).toBe(100);

    const page = await connexion('SA', { viewport: { width: 375, height: 740 } });
    await page.goto('/', { waitUntil: 'networkidle' });
    const enCours = page.locator('div.bg-white.rounded-2xl').filter({ has: page.getByRole('heading', { name: 'Chantiers en cours' }) });
    const ligne = enCours.getByRole('button').filter({ hasText: chantier.nom });
    const avancement = ligne.locator('span.sm\\:hidden');
    // « 100 % », espace ordinaire U+0020 (et non « 100% » d'avant #499).
    await expect(avancement).toHaveText(/^100\u0020%$/);
    // Une seule ligne de texte : les rectangles du texte partagent la même hauteur.
    const lignesDeTexte = await avancement.evaluate((element) => {
      const plage = document.createRange();
      plage.selectNodeContents(element);
      return new Set([...plage.getClientRects()].map((r) => Math.round(r.top))).size;
    });
    expect(lignesDeTexte).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await request.patch(`${api}/chantiers/${chantier.id}/statut`, { headers, data: { statut: 'TERMINE' } }).catch(() => undefined);
  }
});
