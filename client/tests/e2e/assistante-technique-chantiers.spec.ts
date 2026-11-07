import { randomInt } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, dateDuJour } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot « Assistante technique », PR AT-2b « Chantiers, saisies Travaux et rentabilité » (cadrage AT-2, version 4, qui fait foi ;
// v3, liste C6 : « un E2E : fiche modifiée et saisie d'achat ou d'heures par elle » ; v4, C5 (d) : « l'administration coche la
// case ; sur la fiche, l'assistante technique voit le vendu et la marge, sans « Facturé HT » ni « Factures liées » » ; T1 :
// « « Clôturer » lui reste absent quand elle est titulaire »). Réponses de Nelson du 06-11-2026, 1, 2, 5 et 10, et du
// 07-11-2026, 1 et 3 (docs/HISTORIQUE-DECISIONS.md#décisions-du-07-11-2026-sur-at-2b). Choix par défaut, à confirmer, éprouvés
// tels quels : facturation de la fiche masquée jusqu'à AT-3, réglage coché compris ; libellé de la case.
//
// Parcours dans Chromium, libellés français, dates JJ-MM-AAAA, montants au format français :
//  1. sur une affaire en cours d'un conducteur, elle ouvre « Modifier » (sans « Budget Global », réglage décoché), change le
//     nom, la date de fin, le budget matériel et le barème réduit, et réaffecte l'affaire à un second client par le sélecteur
//     « Client du chantier » (v4, C1 ; T1 de l'audit des droits de #515) ; l'API relit chaque champ, le client et son libellé,
//     et l'entrée CHANGEMENT_CLIENT à son nom ;
//  2. elle saisit un achat dans le Journal des achats et un pointage dans le Journal des heures, sur cette affaire dont elle
//     n'est pas titulaire, relus par l'API à son nom ; aucun coût interne ni taux à l'écran ;
//  3. « Clôturer » ne lui est pas proposé, même titulaire ; un conducteur titulaire, témoin, se le voit proposer.

type Compte = { id: string; name: string; email: string; role: string };

async function preparer(request: APIRequestContext, token: string, creerClient: (libelle: string, avecSite?: boolean) => Promise<{ id: string; raisonSociale: string }>) {
  const headers = { Authorization: `Bearer ${token}` };
  const envoyer = async (methode: 'post' | 'put' | 'patch', path: string, data: object) => {
    const reponse = await request[methode](`${api}${path}`, { headers, data });
    expect(reponse.ok(), `${path} : ${await reponse.text()}`).toBeTruthy();
    return reponse.json();
  };
  const suffixe = `${Date.now()}-${randomInt(1_000_000)}`;
  const assistante = await envoyer('post', '/users', { email: `at2b.assistante.${suffixe}@iris.test`, name: `Assistante technique AT-2b ${suffixe}`, role: 'ASSISTANTE_TECHNIQUE' }) as Compte;
  const conducteur = await envoyer('post', '/users', { email: `at2b.conducteur.${suffixe}@iris.test`, name: `Conducteur AT-2b ${suffixe}`, role: 'CONDUCTEUR_TRAVAUX' }) as Compte;
  // Un commercial rattaché à chaque affaire : « Modifier » exige un commercial dès que la société en compte un (formulaire).
  const commercial = await envoyer('post', '/users', { email: `at2b.commercial.${suffixe}@iris.test`, name: `Commercial AT-2b ${suffixe}`, role: 'COMMERCIAL' }) as Compte;
  const client = await creerClient(`assistante technique chantiers ${suffixe}`);
  // Devis signé : 4 détecteurs à 35,00 € et 2 h de pose à 50,00 € : 240,00 € HT vendus.
  const chantierDe = async (objet: string, responsableId: string) => {
    const devis = await envoyer('post', '/devis', { clientId: client.id, objet: `${objet} ${suffixe}`, lignes: [
      { designation: 'Détecteur', nature: 'FOURNITURE', quantite: 4, prixUnitaireHt: 35, tauxTva: 20 },
      { designation: 'Pose', nature: 'MAIN_OEUVRE', quantite: 2, prixUnitaireHt: 50, tauxTva: 20 },
    ] });
    await envoyer('put', `/devis/${devis.id}/statut`, { statut: 'ENVOYE' });
    await envoyer('post', `/devis/${devis.id}/signature`, { signataire: 'Client E2E', confirme: true });
    return await envoyer('post', `/devis/${devis.id}/convertir`, { cible: 'CHANTIER', responsableId, commercialId: commercial.id }) as { id: string; nom: string };
  };
  return { headers, envoyer, suffixe, assistante, conducteur, commercial, client, chantierDe };
}

const menuDe = (page: Page) => page.locator('#menu-principal');

test('assistante technique : elle modifie la fiche d’une affaire en cours d’un conducteur, y saisit un achat et des heures depuis les journaux Travaux, à son nom, sans coût interne ; « Clôturer » ne lui est pas proposé, même titulaire', async ({ connexion, request, session, creerClient }) => {
  test.slow();
  const { headers, envoyer, suffixe, assistante, conducteur, commercial, client, chantierDe } = await preparer(request, session.token, creerClient);
  // Second client, cible de la réaffectation de l'étape 1 (C1 du cadrage v4).
  const second = await creerClient(`assistante technique chantiers second ${suffixe}`);
  const affaire = await chantierDe('Affaire du conducteur AT-2b', conducteur.id);
  const sienne = await chantierDe('Affaire de l’assistante AT-2b', assistante.id);
  const fournisseur = await envoyer('post', '/fournisseurs', { nom: `Fournisseur AT-2b ${suffixe}` }) as { id: string; nom: string };
  const categorie = await envoyer('post', '/categories', { nom: `Catégorie AT-2b ${suffixe}` }) as { id: string; nom: string };
  const fiche = await envoyer('post', '/intervenants', { nom: `Technicien AT-2b ${suffixe}`, role: 'Technicien', tauxHoraireCharge: 37.85 }) as { id: string; nom: string };
  await envoyer('put', '/parametres', { rentabiliteAssistantesTechniques: false });
  const relire = async (id: string) => (await request.get(`${api}/chantiers/${id}`, { headers })).json() as Promise<Record<string, any>>;

  const page = await connexion(assistante);
  // Menu : les journaux Travaux, sans les statistiques.
  await page.goto('/', { waitUntil: 'networkidle' });
  for (const entree of ['Journal des achats', 'Journal des heures']) await expect(menuDe(page).getByRole('link', { name: entree, exact: true }), entree).toBeVisible();
  await expect(menuDe(page).getByRole('link', { name: 'Statistiques', exact: true })).toHaveCount(0);

  // 1. Fiche d'une affaire en cours dont elle n'est pas titulaire : « Modifier », sans « Budget Global » (réglage décoché).
  await page.goto(`/chantiers/${affaire.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: affaire.nom })).toBeVisible();
  await page.getByRole('button', { name: 'Modifier', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Modifier le chantier' })).toBeVisible();
  await expect(page.locator('input[name="budgetGlobalVendu"]')).toHaveCount(0);
  const nouveauNom = `Affaire renommée par l’assistante AT-2b ${suffixe}`;
  await page.locator('input[name="nom"]').fill(nouveauNom);
  await page.locator('input[name="dateFin"]').fill('27-02-2027');
  await page.locator('input[name="budgetMaterielVendu"]').fill('1234.56');
  await page.locator('input[name="baremeReduit"]').check();
  // Client du chantier (cadrage v4, C1 ; réponse 3 du 07-11-2026, « comme l'administration ») : le sélecteur lui est ouvert ;
  // réaffectation à un second client, retrouvé par la recherche.
  const selecteurClient = page.getByRole('combobox', { name: 'Client du chantier' });
  await expect(selecteurClient).toBeEnabled();
  await expect(selecteurClient).toHaveValue(client.id);
  await page.getByRole('searchbox', { name: 'Rechercher un client' }).fill(second.raisonSociale);
  await expect(selecteurClient.locator(`option[value="${second.id}"]`)).toHaveCount(1);
  await selecteurClient.selectOption(second.id);
  await expect(selecteurClient).toHaveValue(second.id);
  const enregistrement = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/chantiers/${affaire.id}`);
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  const reponse = await enregistrement;
  expect(reponse.status()).toBe(200);
  expect(reponse.request().postDataJSON()).not.toHaveProperty('budgetGlobalVendu');
  expect(reponse.request().postDataJSON().clientId).toBe(second.id);
  await expect(page.getByRole('heading', { name: 'Modifier le chantier' })).toHaveCount(0);
  // Elle reste sur la fiche (elle lit toutes les affaires), au nouveau nom, budget matériel au format français.
  await expect(page.getByRole('heading', { name: nouveauNom })).toBeVisible();
  await expect(page.getByText('Matériel Prévu', { exact: true }).locator('xpath=following-sibling::div[1]')).toHaveText(/^1\s?234,56\s€$/);
  const relue = await relire(affaire.id);
  // Client et libellé relus ; changement journalisé à son nom (CHANGEMENT_CLIENT).
  expect([relue.clientId, relue.client]).toEqual([second.id, second.raisonSociale]);
  const journalFiche = await (await request.get(`${api}/chantiers/${affaire.id}/journal-saisies`, { headers })).json() as { action: string; auteurId: string; apres: { clientId?: string } }[];
  expect(journalFiche.filter((e) => e.action === 'CHANGEMENT_CLIENT').map((e) => [e.auteurId, e.apres.clientId])).toEqual([[assistante.id, second.id]]);
  expect([relue.nom, relue.dateFin.slice(0, 10), relue.budgetMaterielVendu, relue.baremeReduit, relue.statut, relue.responsable.id, relue.commercial.id]).toEqual([nouveauNom, '2027-02-27', 1234.56, true, 'EN_COURS', conducteur.id, commercial.id]);

  // 2. Journal des achats : achat au format français sur cette affaire, relu par l'API à son nom.
  await page.goto('/achats', { waitUntil: 'networkidle' });
  const formulaireAchat = page.locator('form').filter({ has: page.getByRole('button', { name: 'Enregistrer l\'achat' }) });
  await formulaireAchat.locator('input[name="date"]').fill(dateDuJour());
  await formulaireAchat.locator('select[name="fournisseurId"]').selectOption(fournisseur.id);
  await formulaireAchat.locator('input[name="description"]').fill(`Câble AT-2b ${suffixe}`);
  await formulaireAchat.locator('select[name="chantierId"]').selectOption(affaire.id);
  await formulaireAchat.locator('select[name="categorieId"]').selectOption(categorie.id);
  await formulaireAchat.locator('input[name="montantHT"]').fill('47.33');
  const achat = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/achats');
  await formulaireAchat.getByRole('button', { name: 'Enregistrer l\'achat' }).click();
  expect((await achat).status()).toBe(200);
  await expect(page.getByText(`Câble AT-2b ${suffixe}`)).toBeVisible();

  // Journal des heures : pointage de 2,5 h sur la même affaire ; pas de colonne « Coût Interne » (taux réservé à
  // l'administration).
  await page.goto('/heures', { waitUntil: 'networkidle' });
  const formulaireHeures = page.locator('form').filter({ has: page.getByRole('button', { name: /Enregistrer le pointage/ }) });
  await formulaireHeures.locator('input[name="date"]').fill(dateDuJour());
  await formulaireHeures.locator('select[name="intervenantId"]').selectOption(fiche.id);
  await formulaireHeures.locator('select[name="chantierId"]').selectOption(affaire.id);
  await formulaireHeures.locator('input[name="nbrHeures"]').fill('2.5');
  const pointage = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/heures');
  await formulaireHeures.getByRole('button', { name: /Enregistrer le pointage/ }).click();
  const reponsePointage = await pointage;
  expect(reponsePointage.status()).toBe(200);
  expect(await reponsePointage.json()).not.toHaveProperty('tauxHoraireApplique');
  await expect(page.getByRole('columnheader', { name: 'Coût Interne' })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/94,63|94\.63/);

  // Relus par l'API (administration) : montant et heures exacts, à son nom ; le taux de la fiche figé sur le pointage.
  const fiche2 = await relire(affaire.id);
  expect(fiche2.achats.map((a: { montantHT: number; description: string }) => [a.montantHT, a.description])).toEqual([[47.33, `Câble AT-2b ${suffixe}`]]);
  expect(fiche2.pointages.map((p: { nbrHeures: number; tauxHoraireApplique: number }) => [p.nbrHeures, p.tauxHoraireApplique])).toEqual([[2.5, 37.85]]);
  const journal = await (await request.get(`${api}/chantiers/${affaire.id}/journal-saisies`, { headers })).json() as { cible: string; action: string; auteurId: string }[];
  expect(journal.filter((e) => ['ACHAT', 'HEURE'].includes(e.cible)).map((e) => [e.cible, e.action, e.auteurId]).sort()).toEqual([['ACHAT', 'CREATION', assistante.id], ['HEURE', 'CREATION', assistante.id]]);

  // 3. « Clôturer » : jamais proposé à elle, même sur son affaire ; le conducteur titulaire, témoin, le voit sur la sienne.
  await page.goto('/chantiers', { waitUntil: 'networkidle' });
  for (const id of [sienne.id, affaire.id]) {
    const ligne = page.locator(`tr[data-chantier="${id}"]`);
    await expect(ligne).toBeVisible();
    await expect(ligne.getByRole('button', { name: /Clôturer/ })).toHaveCount(0);
  }
  await page.goto(`/chantiers/${sienne.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Modifier', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Clôturer/ })).toHaveCount(0);
  const vueConducteur = await connexion(conducteur);
  await vueConducteur.goto('/chantiers', { waitUntil: 'networkidle' });
  await expect(vueConducteur.locator(`tr[data-chantier="${affaire.id}"]`).getByRole('button', { name: /Clôturer/ })).toBeVisible();
});

// Cadrage v4, C5 (d), classé C (montants) : l'administration coche la case dans Administration > Marges ; sur la fiche,
// l'assistante technique voit le vendu (« Budget Vendu », 240 €) et la marge (« Marge Commerciale », 240 − 61,35 = 178,65 €),
// sans « Facturé HT » ni « Factures liées » (facture émise de 100,00 € HT). Avant : case décochée, ni vendu ni marge.
// Témoin : l'administration lit les deux encarts de la facturation. Lectures écartées : réglage sans effet (vendu toujours
// masqué) ; facturation ouverte avec la rentabilité (le cas du directeur) ; marge sans l'achat (240 €).
test.describe('rentabilité des assistantes techniques réglée par l’administration', () => {
  let reglageAvant: boolean | null = null;
  test.beforeEach(async ({ apiAdmin }) => {
    reglageAvant = Boolean((await (await apiAdmin.get('/parametres')).json() as { rentabiliteAssistantesTechniques?: boolean }).rentabiliteAssistantesTechniques);
  });
  test.afterEach(async ({ request, session }) => {
    if (reglageAvant === null) return;
    const restauration = await request.put(`${api}/parametres`, { headers: { Authorization: `Bearer ${session.token}` }, data: { rentabiliteAssistantesTechniques: reglageAvant } });
    expect(restauration.ok(), await restauration.text()).toBeTruthy();
    reglageAvant = null;
  });

  test('l’administration coche « Les assistantes techniques » dans Marges & Commissions : l’assistante technique voit le vendu et la marge sur la fiche, jamais « Facturé HT » ni « Factures liées » ; décochée, ni l’un ni l’autre', async ({ connexion, request, session, creerClient }) => {
    test.slow();
    const { envoyer, suffixe, assistante, conducteur, client, chantierDe } = await preparer(request, session.token, creerClient);
    const affaire = await chantierDe('Affaire rentabilité AT-2b', conducteur.id);
    const fournisseur = await envoyer('post', '/fournisseurs', { nom: `Fournisseur rentabilité AT-2b ${suffixe}` }) as { id: string };
    const categorie = await envoyer('post', '/categories', { nom: `Catégorie rentabilité AT-2b ${suffixe}` }) as { id: string };
    await envoyer('post', '/achats', { chantierId: affaire.id, fournisseurId: fournisseur.id, categorieId: categorie.id, date: dateDuJour(), description: `Achat rentabilité ${suffixe}`, montantHT: 61.35 });
    const facture = await envoyer('post', '/factures', { clientId: client.id, origine: 'CHANTIER', chantierId: affaire.id, dateEmission: dateDuJour(), dateEcheance: dateDuJour(), lignes: [{ designation: 'Situation AT-2b', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 }] }) as { id: string };
    await envoyer('post', `/factures/${facture.id}/emettre`, {});
    await envoyer('put', '/parametres', { rentabiliteAssistantesTechniques: false });

    const encarts = (page: Page) => ({
      vendu: page.getByText('Budget Vendu', { exact: true }),
      marge: page.locator('[data-marge-commerciale]'),
      facture: page.getByText('Facturé HT', { exact: true }),
      factures: page.getByRole('region', { name: 'Factures liées' }),
    });
    // Décochée : ni vendu, ni marge, ni facturation.
    const vueAssistante = await connexion(assistante);
    await vueAssistante.goto(`/chantiers/${affaire.id}`, { waitUntil: 'networkidle' });
    await expect(vueAssistante.getByRole('heading', { name: affaire.nom })).toBeVisible();
    const avant = encarts(vueAssistante);
    for (const [nom, encart] of Object.entries(avant)) await expect(encart, `décochée : ${nom}`).toHaveCount(0);
    // Tableau de bord : l'encart « Rentabilité des chantiers en cours » (marge estimée de la liste) lui est absent.
    const encartTableau = vueAssistante.getByRole('region', { name: 'Rentabilité des chantiers en cours' });
    await vueAssistante.goto('/', { waitUntil: 'networkidle' });
    await expect(vueAssistante.getByRole('heading', { name: 'Tableau de Bord' })).toBeVisible();
    await expect(encartTableau).toHaveCount(0);

    // L'administration (super administrateur) coche la case dans Administration > Marges & Commissions, décochée à l'ouverture.
    const administration = await connexion('SA');
    await administration.goto('/admin', { waitUntil: 'networkidle' });
    await administration.getByRole('button', { name: 'Marges & Commissions', exact: true }).click();
    const caseAt = administration.getByRole('checkbox', { name: 'Les assistantes techniques (tous les chantiers, sans la facturation de la fiche)' });
    await expect(caseAt).not.toBeChecked();
    await caseAt.check();
    administration.once('dialog', (dialogue) => void dialogue.accept());
    const enregistrement = administration.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/parametres');
    await caseAt.locator('xpath=ancestor::form').getByRole('button', { name: 'Enregistrer', exact: true }).click();
    const reponse = await enregistrement;
    expect(reponse.status()).toBe(200);
    expect(reponse.request().postDataJSON()).toMatchObject({ rentabiliteAssistantesTechniques: true });
    expect((await reponse.json()).rentabiliteAssistantesTechniques).toBe(true);
    // Le journal d'administration la nomme en clair.
    await administration.getByRole('button', { name: 'Journal', exact: true }).click();
    await expect(administration.locator('main')).toContainText('Rentabilité : assistantes techniques');

    // Cochée : l'encart du tableau de bord apparaît ; sur la fiche, le vendu et la marge, au format français, ni « Facturé
    // HT » ni « Factures liées ».
    await vueAssistante.reload({ waitUntil: 'networkidle' });
    await expect(encartTableau).toBeVisible();
    await expect(encartTableau).toContainText('Marge estimée en fin de chantier');
    // Le dépensé inclut le coût de main-d'œuvre, qu'elle ne reçoit pas (C5 (c)) : il n'est pas affiché.
    await expect(encartTableau).not.toContainText('Dépensé à ce jour');
    await vueAssistante.goto(`/chantiers/${affaire.id}`, { waitUntil: 'networkidle' });
    const apres = encarts(vueAssistante);
    await expect(apres.vendu.locator('xpath=following-sibling::div[1]')).toHaveText(/^240\s€$/);
    await expect(apres.marge).toContainText('Marge Commerciale');
    await expect(apres.marge).toContainText(/178,65\s€/);
    await expect(apres.facture).toHaveCount(0);
    await expect(apres.factures).toHaveCount(0);
    await expect(vueAssistante.locator('main')).not.toContainText('Reste à facturer');

    // Témoin : l'administration lit la facturation de la même fiche (100 € facturés, 140 € restants).
    await administration.goto(`/chantiers/${affaire.id}`, { waitUntil: 'networkidle' });
    const temoin = encarts(administration);
    await expect(temoin.facture).toBeVisible();
    await expect(temoin.factures).toBeVisible();
    await expect(administration.locator('main')).toContainText(/Reste à facturer : 140\s€/);
  });
});
