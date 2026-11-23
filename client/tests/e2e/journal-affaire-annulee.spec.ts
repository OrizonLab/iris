import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, dateDuJour, horsDuPassageDeMinuit } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Lot Y (cadrage v2 du 23-11-2026, qui fait foi ; R1 du passage hebdomadaire #661, point 1 de #136 ; choix par défaut, à
// confirmer, micro-arbitrage de droits et d'affichage, règle 5). Sur la fiche chantier :
//  - le journal d'audit d'une affaire annulée est lu au périmètre de lecture des chantiers : son titre « Journal d’audit des
//    saisies » montre ses entrées, dont l'archivage, et non plus « Aucune entrée au journal de ce chantier. » (l'API répondait
//    404 à tous, que l'écran avalait) ;
//  - « Restaurer » n'est plus proposé sur une affaire annulée (le serveur y refuse toute écriture, 409) ; il l'était avant
//    l'annulation (témoin) ;
//  - un journal illisible (404, 500, coupure) affiche « Journal d’audit indisponible. », jamais « Aucune entrée au journal
//    de ce chantier. », que garde un journal réellement vide (témoin).
// Dates affichées au format JJ-MM-AAAA, au fuseau de la société (Europe/Paris, comme dateDuJour).

type Chantier = { id: string; nom: string; statut: string };
type Compte = { id: string; name: string };

async function appel<T>(request: APIRequestContext, token: string, methode: 'get' | 'post' | 'put' | 'patch' | 'delete', chemin: string, data?: object, attendu = methode === 'post' ? 201 : 200): Promise<T> {
  const reponse = await request[methode](`${api}${chemin}`, { headers: auth(token), ...(data ? { data } : {}) });
  expect(reponse.status(), `${methode.toUpperCase()} ${chemin} : ${await reponse.text()}`).toBe(attendu);
  return reponse.json() as Promise<T>;
}
// Affaire ouverte par la conversion d'un devis signé (seule porte d'ouverture), au titulaire donné.
async function affaireConvertie(request: APIRequestContext, token: string, clientId: string, nom: string, responsableId?: string) {
  const devis = await appel<{ id: string }>(request, token, 'post', '/devis', { clientId, objet: nom, lignes: [{ designation: 'Pose et mise en service', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 }] });
  await appel(request, token, 'put', `/devis/${devis.id}/statut`, { statut: 'ENVOYE' });
  await appel(request, token, 'post', `/devis/${devis.id}/signature`, { signataire: 'Client E2E', confirme: true });
  const chantier = await appel<Chantier>(request, token, 'post', `/devis/${devis.id}/convertir`, { cible: 'CHANTIER', ...(responsableId ? { responsableId } : {}) });
  return { devis, chantier };
}
// Achat saisi puis archivé : l'affaire porte deux entrées au journal (création, archivage) et peut encore s'annuler.
async function achatArchive(request: APIRequestContext, token: string, chantierId: string, suffixe: string, motif: string) {
  const categorie = await appel<{ id: string }>(request, token, 'post', '/categories', { nom: `Catégorie E2E lot Y ${suffixe}` }, 200);
  const fournisseur = await appel<{ id: string }>(request, token, 'post', '/fournisseurs', { nom: `Fournisseur E2E lot Y ${suffixe}` }, 200);
  const achat = await appel<{ id: string }>(request, token, 'post', '/achats', { chantierId, categorieId: categorie.id, fournisseurId: fournisseur.id, date: '01-10-2026', description: `Matériel E2E lot Y ${suffixe}`, montantHT: 123.45 }, 200);
  await appel(request, token, 'delete', `/achats/${achat.id}`, { motifArchivage: motif });
  return achat;
}
const annuler = (request: APIRequestContext, token: string, devisId: string) => appel(request, token, 'post', `/devis/${devisId}/annulation`, { motif: 'Annulation E2E du lot Y' }, 200);
const creerCompte = (request: APIRequestContext, token: string, cle: string, nom: string, role: string, suffixe: string) =>
  appel<Compte>(request, token, 'post', '/users', { email: `lot-y.${cle}.${suffixe}@iris.test`, name: `${nom} ${suffixe}`, role });

const journalDe = (page: Page) => page.getByRole('region', { name: 'Journal d’audit des saisies' });
const entree = (page: Page, titre: string) => journalDe(page).locator('div.px-6.py-4', { has: page.getByText(titre, { exact: true }) });
const AUCUNE_ENTREE = 'Aucune entrée au journal de ce chantier.';
const INDISPONIBLE = 'Journal d’audit indisponible.';
// Les deux entrées de l'achat : l'archivage (titre « Achat — archivage ») et la création, reconnue à ses « Valeurs
// enregistrées » (son titre s'écrit aujourd'hui « Achat — creation », sans accent : libellé préexistant, hors du lot,
// que ce parcours ne fige pas).
const entreesDeLAchat = async (page: Page, motif: string) => {
  await expect(journalDe(page).locator('div.px-6.py-4.text-sm')).toHaveCount(2);
  await expect(entree(page, 'Achat — archivage')).toHaveCount(1);
  await expect(entree(page, 'Achat — archivage')).toContainText(`Motif : ${motif}`);
  await expect(entree(page, 'Achat — archivage')).toContainText('Valeurs archivées');
  await expect(entree(page, 'Achat — archivage')).toContainText('"date":"01-10-2026"');
  await expect(journalDe(page).getByText(/^Valeurs enregistrées : /)).toHaveCount(1);
};
const reponseDuJournal = (page: Page, chantierId: string) => page.waitForResponse((r) => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/chantiers/${chantierId}/journal-saisies`);

test('affaire annulée : le journal d’audit des saisies montre l’archivage de l’achat, à l’administration comme au conducteur titulaire ; « Restaurer » proposé avant l’annulation, plus après', async ({ allerSurPageAdmin, creerClient, connexion, request, session, page }) => {
  test.slow();
  await horsDuPassageDeMinuit();
  const token = session.token;
  const suffixe = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const nom = `E2E Journal affaire annulée lot Y ${suffixe}`;
  const motif = `Achat saisi en double ${suffixe}`;
  const auteur = (session.user as { name: string }).name;
  const client = await creerClient('journal affaire annulée lot Y');
  const conducteur = await creerCompte(request, token, 'conducteur', 'Conducteur lot Y', 'CONDUCTEUR_TRAVAUX', suffixe);
  const { devis, chantier } = await affaireConvertie(request, token, client.id, nom, conducteur.id);
  await achatArchive(request, token, chantier.id, suffixe, motif);

  // Témoin, affaire en cours : l'entrée d'archivage et « Restaurer ».
  const lectureAvant = reponseDuJournal(page, chantier.id);
  await allerSurPageAdmin(`/chantiers/${chantier.id}`);
  expect((await lectureAvant).status()).toBe(200);
  await expect(page.getByRole('heading', { name: nom, exact: true })).toBeVisible();
  await entreesDeLAchat(page, motif);
  await expect(entree(page, 'Achat — archivage')).toContainText(`${dateDuJour()} · ${auteur}`);
  await expect(journalDe(page).getByRole('button', { name: 'Restaurer' })).toHaveCount(1);

  // Annulation du devis, qui annule l'affaire : le journal reste lu, ses entrées sont les mêmes, « Restaurer » disparaît.
  await annuler(request, token, devis.id);
  expect((await appel<Chantier>(request, token, 'get', `/chantiers/${chantier.id}`)).statut).toBe('ANNULE');
  const lectureApres = reponseDuJournal(page, chantier.id);
  await page.reload({ waitUntil: 'networkidle' });
  expect((await lectureApres).status(), 'le journal d’une affaire annulée se lit (200), et non plus 404').toBe(200);
  await expect(page.getByRole('heading', { name: nom, exact: true }).locator('..').getByText('Annulé', { exact: true })).toBeVisible();
  await entreesDeLAchat(page, motif);
  await expect(entree(page, 'Achat — archivage')).toContainText(`${dateDuJour()} · ${auteur}`);
  await expect(page.getByRole('button', { name: 'Restaurer' })).toHaveCount(0);
  await expect(journalDe(page)).not.toContainText(AUCUNE_ENTREE);
  await expect(journalDe(page)).not.toContainText(INDISPONIBLE);

  // Le conducteur titulaire, hors administration, lit lui aussi le journal de son affaire annulée, sans « Restaurer ».
  const pageConducteur = await connexion(conducteur);
  const lectureConducteur = reponseDuJournal(pageConducteur, chantier.id);
  await pageConducteur.goto(`/chantiers/${chantier.id}`, { waitUntil: 'networkidle' });
  expect((await lectureConducteur).status()).toBe(200);
  await expect(pageConducteur.getByRole('heading', { name: nom, exact: true })).toBeVisible();
  await entreesDeLAchat(pageConducteur, motif);
  await expect(pageConducteur.getByRole('button', { name: 'Restaurer' })).toHaveCount(0);
  await expect(journalDe(pageConducteur)).not.toContainText(AUCUNE_ENTREE);
  await expect(journalDe(pageConducteur)).not.toContainText(INDISPONIBLE);
});

test('un journal illisible n’est jamais présenté comme vide : « Journal d’audit indisponible. » sur une erreur 500, une requête coupée et le refus 404 du commercial titulaire ; « Aucune entrée au journal de ce chantier. » sur un journal réellement vide', async ({ allerSurPageAdmin, creerClient, connexion, request, session, page }) => {
  test.slow();
  const token = session.token;
  const suffixe = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const client = await creerClient('journal illisible lot Y');
  const nomVide = `E2E Journal vide lot Y ${suffixe}`;
  const { chantier: vide } = await affaireConvertie(request, token, client.id, nomVide);

  // Témoin : un journal réellement vide, lu (200), se dit vide.
  const lecture = reponseDuJournal(page, vide.id);
  await allerSurPageAdmin(`/chantiers/${vide.id}`);
  expect((await lecture).status()).toBe(200);
  await expect(page.getByRole('heading', { name: nomVide, exact: true })).toBeVisible();
  await expect(journalDe(page).getByText(AUCUNE_ENTREE, { exact: true })).toBeVisible();
  await expect(journalDe(page)).not.toContainText(INDISPONIBLE);

  // Lecture en erreur (500) : la fiche reste affichée, le journal se dit indisponible, et non vide.
  const chemin = `**/api/chantiers/${vide.id}/journal-saisies`;
  await page.route(chemin, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Error fetching journal des saisies' }) }));
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: nomVide, exact: true })).toBeVisible();
  await expect(journalDe(page).getByText(INDISPONIBLE, { exact: true })).toBeVisible();
  await expect(journalDe(page)).not.toContainText(AUCUNE_ENTREE);
  await page.unroute(chemin);

  // Requête coupée (réseau) : de même.
  await page.route(chemin, (route) => route.abort('failed'));
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: nomVide, exact: true })).toBeVisible();
  await expect(journalDe(page).getByText(INDISPONIBLE, { exact: true })).toBeVisible();
  await expect(journalDe(page)).not.toContainText(AUCUNE_ENTREE);
  await page.unroute(chemin);

  // Interception retirée : le journal, relu, redevient vide (la panne simulée était bien la cause).
  await page.reload({ waitUntil: 'networkidle' });
  await expect(journalDe(page).getByText(AUCUNE_ENTREE, { exact: true })).toBeVisible();
  await expect(journalDe(page)).not.toContainText(INDISPONIBLE);

  // Refus réel (404) : un compte COMMERCIAL mis titulaire lit la fiche de son affaire annulée, pas son journal (écart
  // fiche / journal gardé, hors périmètre du lot) ; l'écran ne la dit pas sans entrée alors qu'elle en a deux.
  const commercialTitulaire = await creerCompte(request, token, 'commercial-titulaire', 'Commercial titulaire lot Y', 'COMMERCIAL', suffixe);
  const nomAnnulee = `E2E Journal refusé lot Y ${suffixe}`;
  const { devis, chantier: annulee } = await affaireConvertie(request, token, client.id, nomAnnulee, commercialTitulaire.id);
  await achatArchive(request, token, annulee.id, `${suffixe}-refus`, `Achat archivé avant l’annulation ${suffixe}`);
  await annuler(request, token, devis.id);
  const pageCommercial = await connexion(commercialTitulaire);
  const refus = reponseDuJournal(pageCommercial, annulee.id);
  await pageCommercial.goto(`/chantiers/${annulee.id}`, { waitUntil: 'networkidle' });
  expect((await refus).status()).toBe(404);
  await expect(pageCommercial.getByRole('heading', { name: nomAnnulee, exact: true })).toBeVisible();
  await expect(journalDe(pageCommercial).getByText(INDISPONIBLE, { exact: true })).toBeVisible();
  await expect(journalDe(pageCommercial)).not.toContainText(AUCUNE_ENTREE);
  await expect(entree(pageCommercial, 'Achat — archivage')).toHaveCount(0);
});

// T1 de l'audit droits et sécurité de #667 : la relecture qui suit une action dans la page (ici « Restaurer ») remet l'état
// du journal à « non lu » avant de le relire. Sans cette remise (ChantierDetail.tsx, fetchChantier), un journal devenu
// illisible garderait à l'écran les entrées de la lecture précédente, présentées comme le journal à jour.
test('relecture après une action : un journal devenu illisible ne garde pas les entrées de la lecture précédente, il se dit « Journal d’audit indisponible. »', async ({ allerSurPageAdmin, creerClient, request, session, page }) => {
  test.slow();
  const token = session.token;
  const suffixe = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const nom = `E2E Journal relu lot Y ${suffixe}`;
  const motif = `Achat archivé puis restauré ${suffixe}`;
  const client = await creerClient('journal relu lot Y');
  const { chantier } = await affaireConvertie(request, token, client.id, nom);
  await achatArchive(request, token, chantier.id, suffixe, motif);

  const lecture = reponseDuJournal(page, chantier.id);
  await allerSurPageAdmin(`/chantiers/${chantier.id}`);
  expect((await lecture).status()).toBe(200);
  await expect(page.getByRole('heading', { name: nom, exact: true })).toBeVisible();
  await entreesDeLAchat(page, motif);

  // La restauration réussit ; la relecture du journal qui la suit échoue (500).
  const chemin = `**/api/chantiers/${chantier.id}/journal-saisies`;
  await page.route(chemin, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Error fetching journal des saisies' }) }));
  page.once('dialog', (dialogue) => dialogue.accept(`Restauration E2E ${suffixe}`));
  const restauration = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/restaurer'));
  const relecture = page.waitForResponse((r) => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/chantiers/${chantier.id}/journal-saisies`);
  await journalDe(page).getByRole('button', { name: 'Restaurer' }).click();
  expect((await restauration).ok(), 'restauration admise sur une affaire en cours').toBe(true);
  expect((await relecture).status()).toBe(500);
  await expect(page.getByRole('heading', { name: nom, exact: true })).toBeVisible();
  await expect(journalDe(page).getByText(INDISPONIBLE, { exact: true })).toBeVisible();
  await expect(journalDe(page)).not.toContainText(AUCUNE_ENTREE);
  await expect(entree(page, 'Achat — archivage')).toHaveCount(0);
  await page.unroute(chemin);
});
