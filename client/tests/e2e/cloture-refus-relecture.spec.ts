import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot AG-a, suites de #451 (cadrage v2 du 26-11-2026, « Périmètre », point 3 ; N2 du contrôle de cohérence de #453 et N6 du
// contrôle de mode 1) : l'écran de la liste des chantiers relit la liste après un refus de clôture et de réouverture, et
// plus seulement après un succès. Critère : « Après un refus de clôture ou de réouverture, la liste des chantiers est relue
// (le bouton disparaît si le chantier n'est plus clôturable). » Le refus lui-même vient du serveur, inchangé hors du message
// du cas « déjà clôturé » (périmètre 2, choix par défaut, à confirmer : 403 « Ce chantier est déjà clôturé. »).
//
// Pourquoi un parcours, et non un test unitaire : la relecture tient au gestionnaire de clic de la page
// (`ListeChantiers.tsx`), qui n'exporte aucune fonction testable seule, et les tests unitaires du client ne rendent pas
// de composant React. Le parcours joue donc la vraie page, dans Chromium, contre le backend compilé et la base jetable :
// la liste est affichée, l'état du chantier change ensuite côté serveur (par un autre compte), puis le bouton encore
// affiché est cliqué. Sans relecture après le refus, le bouton resterait affiché sur une ligne périmée : c'est ce que
// chaque attendu écarte.

type Compte = { id: string; name: string };
type Envoyer = <T = unknown>(methode: 'post' | 'put' | 'patch', chemin: string, data: object) => Promise<T>;

const envoyeur = (request: APIRequestContext, token: string): Envoyer => async (methode, chemin, data) => {
  const reponse = await request[methode](`${api}${chemin}`, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(reponse.ok(), `${methode.toUpperCase()} ${chemin} : ${reponse.status()} ${await reponse.text()}`).toBeTruthy();
  return reponse.json();
};

// Chantier ouvert comme dans l'application : devis envoyé, signé, puis converti (seule porte d'ouverture d'une affaire).
async function ouvrirChantier(envoyer: Envoyer, clientId: string, objet: string) {
  const devis = await envoyer<{ id: string }>('post', '/devis', { clientId, objet, lignes: [
    { designation: 'Pose', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 },
  ] });
  await envoyer('put', `/devis/${devis.id}/statut`, { statut: 'ENVOYE' });
  await envoyer('post', `/devis/${devis.id}/signature`, { signataire: 'Client E2E', confirme: true });
  const chantier = await envoyer<{ id: string; nom: string }>('post', `/devis/${devis.id}/convertir`, { cible: 'CHANTIER' });
  return { devisId: devis.id, chantier };
}

// Fenêtres du navigateur (confirmation, puis alerte du refus) : notées et acceptées.
function noterFenetres(page: Page) {
  const fenetres: string[] = [];
  page.on('dialog', (dialogue) => { fenetres.push(`${dialogue.type()} : ${dialogue.message()}`); void dialogue.accept(); });
  return fenetres;
}

// Réponses attendues d'un clic : la demande de statut, puis la relecture de la liste (GET /api/chantiers), guettées avant
// le clic. La liste a déjà été lue au chargement de la page : la relecture guettée est donc celle qui suit le clic.
function guetter(page: Page, chantierId: string) {
  const statut = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/chantiers/${chantierId}/statut`);
  const relecture = page.waitForResponse((r) => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/chantiers', { timeout: 15_000 });
  return { statut, relecture };
}

test('liste des chantiers relue après un refus de clôture : chantier clôturé entre-temps (403 « Ce chantier est déjà clôturé. ») ou confié à un autre conducteur (404), le bouton « Clôturer » disparaît', async ({ connexion, creerClient, request, session }) => {
  test.slow();
  const envoyer = envoyeur(request, session.token);
  const suffixe = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const compte = (cle: string, nom: string) => envoyer<Compte>('post', '/users', { email: `ag451.${cle}.${suffixe}@iris.test`, name: `${nom} ${suffixe}`, role: 'CONDUCTEUR_TRAVAUX' });
  const conducteur = await compte('titulaire', 'Conducteur titulaire AG');
  const autreConducteur = await compte('autre', 'Autre conducteur AG');
  const client = await creerClient('cloture-refus-relecture');
  const { chantier: dejaClos } = await ouvrirChantier(envoyer, client.id, `Clôture refusée, déjà clôturé ${suffixe}`);
  const { chantier: confie } = await ouvrirChantier(envoyer, client.id, `Clôture refusée, confié ailleurs ${suffixe}`);
  for (const chantier of [dejaClos, confie]) await envoyer('patch', `/chantiers/${chantier.id}`, { responsableId: conducteur.id });

  const page = await connexion(conducteur);
  const fenetres = noterFenetres(page);
  await page.goto('/chantiers', { waitUntil: 'networkidle' });
  const ligneDejaClos = page.locator(`tr[data-chantier="${dejaClos.id}"]`);
  const ligneConfie = page.locator(`tr[data-chantier="${confie.id}"]`);
  await expect(ligneDejaClos.getByRole('button', { name: 'Clôturer' })).toBeVisible();
  await expect(ligneConfie.getByRole('button', { name: 'Clôturer' })).toBeVisible();

  // 1. Chantier clôturé par l'administration pendant que la liste du conducteur est affichée : la clôture du conducteur
  //    est refusée (403, « Ce chantier est déjà clôturé. »), puis la liste relue range le chantier parmi les chantiers
  //    terminés, sans bouton « Clôturer ».
  await envoyer('patch', `/chantiers/${dejaClos.id}/statut`, { statut: 'TERMINE' });
  await expect(ligneDejaClos.getByRole('button', { name: 'Clôturer' })).toBeVisible();
  let attendu = guetter(page, dejaClos.id);
  await ligneDejaClos.getByRole('button', { name: 'Clôturer' }).click();
  const refusDejaClos = await attendu.statut;
  expect([refusDejaClos.status(), (await refusDejaClos.json()).error]).toEqual([403, 'Ce chantier est déjà clôturé.']);
  await expect(ligneDejaClos).toHaveCount(0);
  expect((await attendu.relecture).status()).toBe(200);
  expect(fenetres).toEqual([
    `confirm : Clôturer « ${dejaClos.nom} » ? Il passera en Terminé/Archivé et il ne sera plus possible d'y ajouter des heures ou des dépenses.`,
    'alert : Ce chantier est déjà clôturé.',
  ]);
  await page.getByRole('button', { name: /Chantiers Terminés \/ Archivés/ }).click();
  await expect(ligneDejaClos).toBeVisible();
  await expect(ligneDejaClos.getByRole('button', { name: 'Clôturer' })).toHaveCount(0);
  await expect(ligneDejaClos.getByRole('button', { name: 'Réouvrir' })).toHaveCount(0);

  // 2. Chantier confié à un autre conducteur pendant que la liste est affichée : la clôture est refusée (404, le chantier
  //    n'est plus dans son périmètre), puis la liste relue ne le montre plus du tout.
  fenetres.length = 0;
  await envoyer('patch', `/chantiers/${confie.id}`, { responsableId: autreConducteur.id });
  await expect(ligneConfie.getByRole('button', { name: 'Clôturer' })).toBeVisible();
  attendu = guetter(page, confie.id);
  await ligneConfie.getByRole('button', { name: 'Clôturer' }).click();
  const refusConfie = await attendu.statut;
  expect([refusConfie.status(), (await refusConfie.json()).error]).toEqual([404, 'Chantier introuvable']);
  await expect(ligneConfie).toHaveCount(0);
  expect((await attendu.relecture).status()).toBe(200);
  expect(fenetres).toEqual([
    `confirm : Clôturer « ${confie.nom} » ? Il passera en Terminé/Archivé et il ne sera plus possible d'y ajouter des heures ou des dépenses.`,
    'alert : Chantier introuvable',
  ]);

  // Le serveur n'a rien écrit : le chantier confié ailleurs reste en cours, à son nouveau titulaire.
  const relu = await (await request.get(`${api}/chantiers/${confie.id}`, { headers: { Authorization: `Bearer ${session.token}` } })).json() as { statut: string; responsableId: string; dateFin: string | null };
  expect([relu.statut, relu.responsableId, relu.dateFin]).toEqual(['EN_COURS', autreConducteur.id, null]);
});

test('liste des chantiers relue après un refus de réouverture : affaire annulée entre-temps par son devis (409), elle disparaît de la liste avec son bouton « Réouvrir »', async ({ connexion, creerClient, request, session }) => {
  test.slow();
  const envoyer = envoyeur(request, session.token);
  const suffixe = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const client = await creerClient('reouverture-refus-relecture');
  const { devisId, chantier } = await ouvrirChantier(envoyer, client.id, `Réouverture refusée, affaire annulée ${suffixe}`);
  await envoyer('patch', `/chantiers/${chantier.id}/statut`, { statut: 'TERMINE' });

  const page = await connexion('SA');
  const fenetres = noterFenetres(page);
  await page.goto('/chantiers', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Chantiers Terminés \/ Archivés/ }).click();
  const ligne = page.locator(`tr[data-chantier="${chantier.id}"]`);
  await expect(ligne.getByRole('button', { name: 'Réouvrir' })).toBeVisible();

  // L'affaire est annulée par son devis pendant que la liste est affichée (chantier clôturé, sans heure ni achat, non
  // encaissé : l'annulation passe). La réouverture est refusée (409), puis la liste relue ne montre plus l'affaire
  // annulée, qui sort de toute liste (périmètre des chantiers).
  await envoyer('post', `/devis/${devisId}/annulation`, { motif: 'Annulation E2E pendant l’affichage de la liste (lot AG-a)' });
  await expect(ligne.getByRole('button', { name: 'Réouvrir' })).toBeVisible();
  const attendu = guetter(page, chantier.id);
  await ligne.getByRole('button', { name: 'Réouvrir' }).click();
  const refus = await attendu.statut;
  expect([refus.status(), (await refus.json()).error]).toEqual([409, 'Cette affaire est annulée : son statut ne change plus.']);
  await expect(ligne).toHaveCount(0);
  expect((await attendu.relecture).status()).toBe(200);
  expect(fenetres).toEqual([
    `confirm : Réouvrir « ${chantier.nom} » ? Il repassera en cours.`,
    'alert : Cette affaire est annulée : son statut ne change plus.',
  ]);
  const relu = await (await request.get(`${api}/chantiers/${chantier.id}`, { headers: { Authorization: `Bearer ${session.token}` } })).json() as { statut: string };
  expect(relu.statut).toBe('ANNULE');
});
