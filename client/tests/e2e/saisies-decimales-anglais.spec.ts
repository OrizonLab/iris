import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect, choisirClient, dateDuJour } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot U, fin de #394 (saisies décimales encore en `type="number"`) et #135 point 3 (cadrage v2 du 22-11-2026, après le contrôle
// de cohérence sur fcc6708 : « Inventaire complet », points 1 à 7, « Critères, champ par champ » et « Tests » ; règle 2 :
// montants, classés C). Un champ `type="number"` lit la virgule selon la langue de l'interface de Chromium : en anglais,
// « 18,75 » y devient 1875, « 5,5 » devient 55, « 1250,50 » devient 125050, « 1,5 » jour devient 15 jours, sans aucun refus
// (#394, N5 de l'audit n° 1 de #393). Les champs passent en texte (`inputMode="decimal"`, ou `numeric` pour la quantité au
// forfait), avec un `pattern` aux bornes du serveur ; la saisie est envoyée telle quelle, le serveur lisant la virgule ; la
// valeur pré-remplie s'écrit à la virgule. Achats et Heures affichent le refus du serveur et gardent la saisie (#135, point 3).
//
// Chromium en anglais, comme saisie-montants-anglais.spec.ts (#564) et devis-saisie-anglais.spec.ts (#571) : sous Linux,
// `--lang=en-US` seul ne change pas la langue qui lit un champ `type="number"` ; c'est LANG/LANGUAGE du processus du
// navigateur. Les deux sont posés, et le témoin `navigateurAnglais` prouve, dans chaque test, qu'un champ `type="number"` de ce
// navigateur fausse bien « 18,75 » : sans lui, un poste réglé en français ferait passer ces tests même avec les anciens champs.
// La saisie se fait touche à touche (`pressSequentially`), comme au clavier, et non par `fill`. Le contexte garde la locale
// fr-FR de playwright.config.ts : l'affichage reste celui d'un utilisateur français.
//
// Chaque test de montant échoue sur fcc6708 (joué sur une copie extraite, cache de Vite isolé) : le champ y lit « 1875 » pour
// « 18,75 », ou la valeur pré-remplie s'y écrit au point, ou le serveur y refuse la virgule.
test.use({ launchOptions: { args: ['--lang=en-US'], env: { ...process.env, LANG: 'en_US.UTF-8', LANGUAGE: 'en_US' } } });

// Séparateur de milliers du français dans `toLocaleString('fr-FR')` : l'espace fine insécable (U+202F). `toHaveText` avec une
// chaîne ramène toute espace à l'espace ordinaire : une expression ancrée compare le texte exact.
const FINE = ' ';
const echapper = (texte: string) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactement = (texte: string) => new RegExp(`^${echapper(texte)}$`);

// Témoin : dans ce navigateur, un champ `type="number"` lit « 18,75 » autrement que 18,75 (1875 dans Chromium en anglais).
async function navigateurAnglais(page: Page) {
  const id = await page.evaluate(() => {
    const champ = document.createElement('input');
    champ.type = 'number';
    champ.id = 'temoin-langue-saisies';
    document.body.appendChild(champ);
    return champ.id;
  });
  const temoin = page.locator(`#${id}`);
  await temoin.pressSequentially('18,75');
  const valeur = await temoin.inputValue();
  await temoin.evaluate((element) => element.remove());
  expect(valeur, 'témoin : un champ number de ce navigateur fausse « 18,75 » (Chromium en anglais)').not.toBe('18.75');
}

// Saisie au clavier dans un champ vidé : le champ garde exactement ce qui est tapé (un champ number en anglais y lirait 1875).
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
const MANQUANT = { valid: false, patternMismatch: false, valueMissing: true };

// Champ texte décimal du lot : texte, clavier décimal (ou numérique), avec un motif.
async function champTexte(champ: Locator, clavier: 'decimal' | 'numeric' = 'decimal') {
  await expect(champ).toHaveAttribute('type', 'text');
  await expect(champ).toHaveAttribute('inputmode', clavier);
  await expect(champ).toHaveAttribute('pattern', /.+/);
}

const entete = (token: string) => ({ Authorization: `Bearer ${token}` });
async function envoyer(request: APIRequestContext, token: string, methode: 'post' | 'put' | 'patch', chemin: string, data: object) {
  const reponse = await request[methode](`${api}${chemin}`, { headers: entete(token), data });
  expect(reponse.ok(), `${chemin} : ${await reponse.text()}`).toBeTruthy();
  return reponse.json();
}
async function lire<T>(request: APIRequestContext, token: string, chemin: string): Promise<T> {
  const reponse = await request.get(`${api}${chemin}`, { headers: entete(token) });
  expect(reponse.ok(), `${chemin} : ${await reponse.text()}`).toBeTruthy();
  return reponse.json() as Promise<T>;
}

// Requêtes d'écriture émises par la page vers un chemin de l'API (refus du navigateur : aucune ne part).
function suivreEnvois(page: Page, motif: RegExp) {
  const envois: string[] = [];
  page.on('request', (requete) => {
    const chemin = new URL(requete.url()).pathname;
    if (['POST', 'PUT', 'PATCH'].includes(requete.method()) && motif.test(chemin)) envois.push(`${requete.method()} ${chemin}`);
  });
  return envois;
}

// Affaire de travaux ouverte par la conversion d'un devis signé, avec une catégorie, un fournisseur et un intervenant à elle.
async function ouvrirChantier(request: APIRequestContext, token: string, creerClient: (libelle: string) => Promise<{ id: string }>, libelle: string) {
  const suffixe = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const client = await creerClient(`${libelle} ${suffixe}`);
  const devis = await envoyer(request, token, 'post', '/devis', { clientId: client.id, objet: `TEST ${libelle} ${suffixe}`, lignes: [{ designation: 'Pose', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 }] }) as { id: string };
  await envoyer(request, token, 'put', `/devis/${devis.id}/statut`, { statut: 'ENVOYE' });
  await envoyer(request, token, 'post', `/devis/${devis.id}/signature`, { signataire: 'Client E2E', confirme: true });
  const chantier = await envoyer(request, token, 'post', `/devis/${devis.id}/convertir`, { cible: 'CHANTIER' }) as { id: string; nom: string };
  const categorie = await envoyer(request, token, 'post', '/categories', { nom: `TEST ${libelle} ${suffixe} catégorie` }) as { id: string; nom: string };
  const fournisseur = await envoyer(request, token, 'post', '/fournisseurs', { nom: `TEST ${libelle} ${suffixe} fournisseur` }) as { id: string; nom: string };
  const intervenant = await envoyer(request, token, 'post', '/intervenants', { nom: `TEST Intervenant ${libelle} ${suffixe}`, role: 'Technicien', tauxHoraireCharge: 40 }) as { id: string; nom: string };
  return { suffixe, chantier, categorie, fournisseur, intervenant };
}
// Chantier clôturé à la fin : il ne s'ajoute pas aux chantiers en cours des autres parcours.
const cloturer = (request: APIRequestContext, token: string, chantierId: string) => request.patch(`${api}/chantiers/${chantierId}/statut`, { headers: entete(token), data: { statut: 'TERMINE' } }).catch(() => undefined);

type FicheLue = { id: string; reference: string; prixVenteHt: number; prixAchatHt: number | null; tauxTva: number; stockActuel?: number };
type AchatLu = { id: string; description: string; montantHT: number };
type PointageLu = { id: string; intervenantId: string; nbrHeures: number; commentaire: string | null };

// Critère du cadrage v2 : « Catalogue prix « 18,75 », prix d'achat « 1250,50 », TVA « 5,5 », stock « 1,5 » → 18,75 ; 1 250,50 ;
// 5,5 ; 1,5 ». Lectures écartées : champ number en anglais (« 18,75 » lu 1875, « 1250,50 » lu 125050, « 1,5 » lu 15, « 5,5 »
// lu 55 et refusé comme TVA non française) ; lecture arrêtée à la virgule (18, 1250, 1, 5) ; serveur d'avant le lot (« 18,75 »
// refusé, « Prix de vente invalide. »). Affichage, forme des documents : « 18,75 € », « 1 250,50 € » (U+202F), « 5,5 % ».
test('Catalogue, Chromium en anglais : article à « 18,75 », prix d’achat « 1250,50 » et stock « 1,5 » enregistrés à 18,75 €, 1 250,50 € et 1,5 ; TVA « 5,5 » à 5,5 % ; saisies hors forme refusées par le navigateur, sans envoi', async ({ page, request, session, allerSurPageAdmin }) => {
  const suffixe = `${Date.now()}`;
  const envois = suivreEnvois(page, /^\/api\/catalogue\/articles$/);
  const articles = () => lire<FicheLue[]>(request, session.token, '/catalogue/articles');
  await allerSurPageAdmin('/catalogue');
  await navigateurAnglais(page);
  await page.getByRole('button', { name: 'Articles', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Articles', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Champs repérés par le texte de leur libellé, et non par le lien `htmlFor` ajouté par le lot (contrôlé plus bas) : sur
  // fcc6708, le test échoue ainsi sur le montant lu, et non faute de trouver le champ.
  const champDe = (libelle: string) => page.locator('.form-group', { has: page.getByText(libelle, { exact: true }) }).locator('input');
  const reference = champDe('Référence *');
  const designation = champDe('Désignation *');
  const prix = champDe('Prix de vente HT (€)');
  const tva = champDe('TVA (%)');
  const achat = champDe('Prix d\'achat HT (€, facultatif)');
  const stock = champDe('Stock actuel');
  const creer = page.getByRole('button', { name: 'Créer la fiche' });

  // Article 1 : prix, prix d'achat et stock à la virgule, TVA laissée à 20.
  const ref1 = `E2E-394-ART-${suffixe}`;
  await reference.fill(ref1);
  await designation.fill(`Gaine 394 E2E ${suffixe}`);
  await saisir(prix, '18,75');
  await saisir(achat, '1250,50');
  await saisir(stock, '1,5');
  await expect(tva).toHaveValue('20');
  const creation1 = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/catalogue/articles');
  await creer.click();
  const reponse1 = await creation1;
  expect(reponse1.status(), await reponse1.text()).toBe(201);
  expect(reponse1.request().postDataJSON()).toMatchObject({ reference: ref1, prixVenteHt: '18,75', prixAchatHt: '1250,50', stockActuel: '1,5', tauxTva: '20' });
  const [fiche1] = (await articles()).filter((f) => f.reference === ref1);
  expect([fiche1.prixVenteHt, fiche1.prixAchatHt, fiche1.stockActuel, fiche1.tauxTva]).toEqual([18.75, 1250.5, 1.5, 20]);
  const ligne1 = page.getByRole('row').filter({ hasText: ref1 });
  await expect(ligne1.getByRole('cell').nth(3)).toHaveText(exactement('18,75 €'));
  await expect(ligne1.getByRole('cell').nth(4)).toHaveText(exactement(`1${FINE}250,50 €`));
  await expect(ligne1.getByRole('cell').nth(5)).toHaveText(exactement('20 %'));

  // Article 2 : TVA « 5,5 ».
  const ref2 = `E2E-394-TVA-${suffixe}`;
  await reference.fill(ref2);
  await designation.fill(`Câble 394 E2E ${suffixe}`);
  await saisir(prix, '2,5');
  await saisir(tva, '5,5');
  const creation2 = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/catalogue/articles');
  await creer.click();
  const reponse2 = await creation2;
  expect(reponse2.status(), await reponse2.text()).toBe(201);
  expect(reponse2.request().postDataJSON()).toMatchObject({ reference: ref2, prixVenteHt: '2,5', tauxTva: '5,5' });
  const [fiche2] = (await articles()).filter((f) => f.reference === ref2);
  expect([fiche2.prixVenteHt, fiche2.tauxTva, fiche2.prixAchatHt, fiche2.stockActuel]).toEqual([2.5, 5.5, null, 0]);
  await expect(page.getByRole('row').filter({ hasText: ref2 }).getByRole('cell').nth(5)).toHaveText(exactement('5,5 %'));

  // Champs texte décimaux ; hors forme, refusés par le navigateur (`pattern`), rien n'est envoyé : prix et prix d'achat à trois
  // décimales, TVA à trois décimales, stock à quatre décimales et à dix chiffres. Chaque refus prouve aussi que le navigateur
  // compile le motif (il ignore en silence un motif invalide).
  for (const saisie of [prix, tva, achat, stock]) await champTexte(saisie);
  // Libellés reliés à leur champ (`htmlFor`, N10 du contrôle de cohérence).
  for (const libelle of ['Prix de vente HT (€)', 'TVA (%)', 'Prix d\'achat HT (€, facultatif)', 'Stock actuel']) await expect(page.getByLabel(libelle, { exact: true })).toHaveCount(1);
  const ref3 = `E2E-394-REF-${suffixe}`;
  await reference.fill(ref3);
  await designation.fill(`Refus 394 E2E ${suffixe}`);
  for (const [champ, saisie] of [[prix, '18,755'], [achat, '1250,505'], [tva, '5,555'], [stock, '1,5555'], [stock, '1234567890']] as const) {
    await saisir(prix, '18,75');
    await saisir(achat, '1250,50');
    await saisir(tva, '5,5');
    await saisir(stock, '1,5');
    await saisir(champ, saisie);
    expect(await validite(champ), `« ${saisie} »`).toEqual(HORS_MOTIF);
    await creer.click();
    await expect(champ).toHaveValue(saisie);
  }
  expect(envois, 'deux créations, aucune pour les saisies hors forme').toEqual(['POST /api/catalogue/articles', 'POST /api/catalogue/articles']);
  expect((await articles()).filter((f) => f.reference === ref3)).toEqual([]);
});

// Critère du cadrage v2 : « Main d'œuvre TVA « 5,5 » acceptée » (CatalogueMainOeuvre.tsx:133, champ déjà en texte ; le serveur
// d'avant le lot refusait « 5,5 » : « TVA invalide. »). Lectures écartées : refus du serveur ; 55 (virgule ignorée, refusé) ;
// 5 (lecture arrêtée à la virgule, refusé) ; affichage « TVA 5.5 % ».
test('Catalogue > Main d’œuvre, Chromium en anglais : TVA « 5,5 » acceptée, enregistrée à 5,5 % et affichée « TVA 5,5 % »', async ({ page, request, session, allerSurPageAdmin }) => {
  const suffixe = `${Date.now()}`;
  const reference = `E2E-394-MO-${suffixe}`;
  const nom = `Électricien 394 E2E ${suffixe}`;
  await allerSurPageAdmin('/catalogue');
  await navigateurAnglais(page);
  await page.getByRole('button', { name: 'Main d’œuvre', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nouvelle main d’œuvre' })).toBeVisible();
  await page.getByLabel('Référence').fill(reference);
  await page.getByLabel('Désignation').fill(nom);
  await saisir(page.getByLabel('Prix de vente HT à l’heure, hors contrat (€)'), '45,50');
  await saisir(page.getByLabel('Prix de vente HT au forfait jour, hors contrat (€)'), '320');
  await saisir(page.getByLabel('Prix de vente HT à l’heure, sous contrat (€)'), '40');
  await saisir(page.getByLabel('Prix de vente HT au forfait jour, sous contrat (€)'), '280,25');
  await saisir(page.getByLabel('Heures par jour (forfait jour)'), '7,5');
  await saisir(page.getByLabel('TVA (%)'), '5,5');
  const creation = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/catalogue/prestations');
  await page.getByRole('button', { name: 'Créer la main d’œuvre' }).click();
  const reponse = await creation;
  expect(reponse.status(), await reponse.text()).toBe(201);
  expect(reponse.request().postDataJSON()).toMatchObject({ estMainOeuvre: true, reference, tauxTva: '5,5' });
  await expect(page.getByRole('status')).toHaveText(`Main d’œuvre « ${nom} » créée.`);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const [fiche] = (await lire<(FicheLue & { estMainOeuvre: boolean })[]>(request, session.token, '/catalogue/prestations')).filter((f) => f.reference === reference);
  expect([fiche.estMainOeuvre, fiche.tauxTva, fiche.prixVenteHt]).toEqual([true, 5.5, 45.5]);
  await expect(page.getByRole('article', { name: nom })).toContainText('TVA 5,5 %');
});

// Critères du cadrage v2 : « Achats « 1250,50 » → 1 250,50 » ; point 7 (#135, point 3) : « afficher le refus du serveur et
// garder la saisie ». Le refus du serveur est provoqué par une date bien formée mais inexistante (« 31-02-2026 », admise par
// le motif JJ-MM-AAAA, refusée par dateIsoStricte) : 400 « La date doit être valide au format JJ-MM-AAAA. ». Lectures écartées :
// champ number en anglais (« 1250,50 » lu 125050 : « 125 050 € ») ; lecture arrêtée à la virgule (1 250 €) ; formulaire vidé
// sans message après un refus (écran d'avant le lot) ; « 1250,505 » arrondi à 1 250,51 € ou tronqué. Affichage à l'euro près
// du journal des achats (#499) : 1 250,50 € → « 1 251 € » (moitié vers l'extérieur ; « 1 250 € » pour un arrondi au pair).
test('Achats, Chromium en anglais : refus du serveur affiché et saisie gardée (#135) ; « 1250,505 » refusé par le navigateur ; « 1250,50 » enregistré à 1 250,50 € et affiché « 1 251 € »', async ({ page, request, session, creerClient, allerSurPageAdmin }) => {
  test.slow();
  const { suffixe, chantier, categorie, fournisseur } = await ouvrirChantier(request, session.token, creerClient, 'Achats 394');
  try {
    const description = `TEST Achat 394 ${suffixe}`;
    const achatsDecrits = async () => (await lire<AchatLu[]>(request, session.token, '/achats')).filter((a) => a.description === description);
    const envois = suivreEnvois(page, /^\/api\/achats$/);
    await allerSurPageAdmin('/achats');
    await navigateurAnglais(page);
    const formulaire = page.locator('form').filter({ has: page.locator('input[name="montantHT"]') });
    const date = formulaire.locator('input[name="date"]');
    const montant = formulaire.locator('input[name="montantHT"]');
    const libelle = formulaire.locator('input[name="description"]');
    const enregistrer = formulaire.getByRole('button', { name: 'Enregistrer l\'achat' });
    await formulaire.locator('select[name="fournisseurId"]').selectOption(fournisseur.id);
    await formulaire.locator('select[name="chantierId"]').selectOption(chantier.id);
    await formulaire.locator('select[name="categorieId"]').selectOption(categorie.id);
    await libelle.fill(description);
    await saisir(montant, '1250,50');
    await champTexte(montant);

    // Refus du serveur : message affiché (role="alert"), saisie gardée, rien d'écrit.
    await date.fill('31-02-2026');
    const refus = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/achats');
    await enregistrer.click();
    const reponseRefus = await refus;
    expect(reponseRefus.status()).toBe(400);
    expect(reponseRefus.request().postDataJSON()).toMatchObject({ date: '31-02-2026', montantHT: '1250,50' });
    await expect(page.getByRole('alert')).toHaveText('La date doit être valide au format JJ-MM-AAAA.');
    await expect(date).toHaveValue('31-02-2026');
    await expect(montant).toHaveValue('1250,50');
    await expect(libelle).toHaveValue(description);
    await expect(formulaire.locator('select[name="chantierId"]')).toHaveValue(chantier.id);
    expect(await achatsDecrits()).toEqual([]);

    // Hors forme : refusé par le navigateur, rien n'est envoyé.
    await date.fill(dateDuJour());
    for (const saisie of ['1250,505', '12345678901']) {
      await saisir(montant, saisie);
      expect(await validite(montant), `« ${saisie} »`).toEqual(HORS_MOTIF);
      await enregistrer.click();
      await expect(montant).toHaveValue(saisie);
    }
    expect(envois).toEqual(['POST /api/achats']);

    // « 1250,50 » au clavier : envoyé tel quel, enregistré à 1 250,50 €, le message de refus retiré et le formulaire vidé.
    await saisir(montant, '1250,50');
    const creation = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/achats');
    await enregistrer.click();
    const reponse = await creation;
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect(reponse.request().postDataJSON()).toMatchObject({ montantHT: '1250,50', description });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(montant).toHaveValue('');
    await expect(libelle).toHaveValue('');
    expect((await achatsDecrits()).map((a) => a.montantHT)).toEqual([1250.5]);
    await expect(page.getByRole('row').filter({ hasText: description }).getByRole('cell').nth(6)).toHaveText(exactement(`1${FINE}251 €`));
    expect(envois).toEqual(['POST /api/achats', 'POST /api/achats']);
  } finally {
    await cloturer(request, session.token, chantier.id);
  }
});

// Critère du cadrage v2 : « Journal des achats : correction « 18,75 », pré-rempli à la virgule ». Achat de départ à 1 234,50 €,
// pré-rempli « 1234,5 ». Lectures écartées : pré-remplissage au point (« 1234.5 », `defaultValue` d'un nombre, avant le lot) ;
// « 18,75 » lu 1875 (champ number en anglais) ou 18 ; « 18,755 » arrondi à 18,76 €. Affichage à l'euro près : « 19 € ».
test('Journal des achats de la fiche chantier, Chromium en anglais : montant pré-rempli à la virgule « 1234,5 » ; « 18,755 » refusé par le navigateur ; correction « 18,75 » enregistrée à 18,75 € et pré-remplie « 18,75 »', async ({ page, request, session, creerClient, allerSurPageAdmin }) => {
  test.slow();
  const { suffixe, chantier, categorie, fournisseur } = await ouvrirChantier(request, session.token, creerClient, 'Journal achats 394');
  try {
    const description = `TEST Achat journal 394 ${suffixe}`;
    const achat = await envoyer(request, session.token, 'post', '/achats', { chantierId: chantier.id, categorieId: categorie.id, fournisseurId: fournisseur.id, date: dateDuJour(), description, montantHT: '1234.5' }) as { id: string };
    const montantEnBase = async () => (await lire<AchatLu[]>(request, session.token, '/achats')).filter((a) => a.id === achat.id).map((a) => a.montantHT);
    expect(await montantEnBase()).toEqual([1234.5]);
    const envois = suivreEnvois(page, /^\/api\/achats\//);
    await allerSurPageAdmin(`/chantiers/${chantier.id}`);
    await expect(page.getByRole('heading', { name: chantier.nom })).toBeVisible();
    await navigateurAnglais(page);
    const ouvrir = async () => {
      await page.getByTitle('Corriger cet achat').click();
      await expect(page.locator('input[name="motifCorrection"]')).toBeVisible();
    };
    const formulaire = page.locator('form').filter({ has: page.locator('input[name="motifCorrection"]') });
    const montant = formulaire.locator('input[name="montantHT"]');

    await ouvrir();
    await expect(montant).toHaveValue('1234,5');
    await champTexte(montant);
    // Champ nommé pour les lecteurs d'écran (aria-label « Montant HT », ajouté par le lot).
    await expect(formulaire.getByRole('textbox', { name: 'Montant HT' })).toHaveCount(1);
    await formulaire.locator('input[name="motifCorrection"]').fill('Correction E2E 394');
    await saisir(montant, '18,755');
    expect(await validite(montant)).toEqual(HORS_MOTIF);
    await formulaire.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(montant).toHaveValue('18,755');
    expect(envois, 'aucune correction envoyée').toEqual([]);

    await saisir(montant, '18,75');
    const correction = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/achats/${achat.id}`);
    await formulaire.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    const reponse = await correction;
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect(reponse.request().postDataJSON()).toMatchObject({ montantHT: '18,75', motifCorrection: 'Correction E2E 394' });
    await expect(page.locator('input[name="motifCorrection"]')).toHaveCount(0);
    expect(await montantEnBase()).toEqual([18.75]);
    await expect(page.getByText(description, { exact: true }).locator('xpath=../..').getByText(exactement('19 €'))).toBeVisible();
    await ouvrir();
    await expect(montant).toHaveValue('18,75');
    expect(envois).toEqual([`PATCH /api/achats/${achat.id}`]);
  } finally {
    await cloturer(request, session.token, chantier.id);
  }
});

// Titre du champ des heures d'un chantier : le message du navigateur quand il refuse la saisie (lot W, cadrage v2, point 3).
const TITRE_HEURES = 'Un nombre d’heures au quart d’heure, à partir de 0,25 (par exemple 3,25)';

// Lot W (décision de Nelson du 22-11-2026, soir : « 1. Quart d'heure » ; cadrage v2 du lot W, « Critères observables » et
// « Tests », qui remplacent ici la demi-heure du lot U) : « 3,25 » enregistré à 3,25 h ; « 1,1 », « 0,2 », « 0 » (et les autres
// saisies refusées des critères : « 1,10 », « 0,05 », « 3,250 », « 123456789 ») refusés par le navigateur, sans envoi, avec le
// titre en français ; « 3,75 », « 0,25 », « 3,00 » et « 3 » admis par le champ ; placeholder « Ex. : 3,25 ». Lot U, point 7
// (#135, point 3) : refus du serveur affiché, saisie gardée. Lectures écartées : champ number en anglais (« 3,25 » lu 325 h,
// admis sans refus) ; lecture arrêtée à la virgule (3 h) ; la demi-heure d'avant le lot (« 3,25 » ou « 0,25 » refusé par le
// navigateur) ; « 1,1 », « 0,2 » ou « 0,05 » admis (centième) ; « 0 » admis ; formulaire vidé sans message après un refus.
test('Heures, Chromium en anglais : refus du serveur affiché et saisie gardée (#135) ; « 1,1 », « 0,2 » et « 0 » refusés par le navigateur, sans écriture ; « 3,25 » enregistré à 3,25 h', async ({ page, request, session, creerClient, allerSurPageAdmin }) => {
  test.slow();
  const { chantier, intervenant } = await ouvrirChantier(request, session.token, creerClient, 'Heures 394');
  try {
    const pointages = async () => (await lire<PointageLu[]>(request, session.token, '/heures')).filter((p) => p.intervenantId === intervenant.id);
    const envois = suivreEnvois(page, /^\/api\/heures$/);
    await allerSurPageAdmin('/heures');
    await navigateurAnglais(page);
    const formulaire = page.locator('form').filter({ has: page.locator('input[name="nbrHeures"]') });
    const date = formulaire.locator('input[name="date"]');
    const heures = formulaire.locator('input[name="nbrHeures"]');
    const commentaire = formulaire.locator('input[name="commentaire"]');
    const enregistrer = formulaire.getByRole('button', { name: 'Enregistrer le pointage' });
    await formulaire.locator('select[name="intervenantId"]').selectOption(intervenant.id);
    await formulaire.locator('select[name="chantierId"]').selectOption(chantier.id);
    await commentaire.fill('Pose E2E 394');
    await saisir(heures, '3,25');
    await champTexte(heures);
    await expect(heures).toHaveAttribute('placeholder', 'Ex. : 3,25');
    await expect(heures).toHaveAttribute('title', TITRE_HEURES);

    // Refus du serveur : message affiché, saisie gardée, rien d'écrit.
    await date.fill('31-02-2026');
    const refus = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/heures');
    await enregistrer.click();
    const reponseRefus = await refus;
    expect(reponseRefus.status()).toBe(400);
    expect(reponseRefus.request().postDataJSON()).toMatchObject({ date: '31-02-2026', nbrHeures: '3,25' });
    await expect(page.getByRole('alert')).toHaveText('La date doit être valide au format JJ-MM-AAAA.');
    await expect(date).toHaveValue('31-02-2026');
    await expect(heures).toHaveValue('3,25');
    await expect(commentaire).toHaveValue('Pose E2E 394');
    await expect(formulaire.locator('select[name="intervenantId"]')).toHaveValue(intervenant.id);
    expect(await pointages()).toEqual([]);

    // Hors du quart d'heure : refusés par le navigateur, rien n'est envoyé ni écrit.
    await date.fill(dateDuJour());
    for (const saisie of ['1,1', '0,2', '0', '1,10', '0,05', '3,250', '123456789']) {
      await saisir(heures, saisie);
      expect(await validite(heures), `« ${saisie} »`).toEqual(HORS_MOTIF);
      await enregistrer.click();
      await expect(heures).toHaveValue(saisie);
    }
    // Au quart d'heure : admis par le champ (rien n'est envoyé ici).
    for (const saisie of ['3,75', '0,25', '3,00', '3']) {
      await saisir(heures, saisie);
      expect(await validite(heures), `« ${saisie} »`).toEqual(ADMIS);
    }
    expect(envois).toEqual(['POST /api/heures']);
    expect(await pointages()).toEqual([]);

    // « 3,25 » au clavier : envoyé tel quel, enregistré à 3,25 h ; message retiré, formulaire vidé.
    await saisir(heures, '3,25');
    const creation = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/heures');
    await enregistrer.click();
    const reponse = await creation;
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect(reponse.request().postDataJSON()).toMatchObject({ nbrHeures: '3,25', intervenantId: intervenant.id, chantierId: chantier.id });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(heures).toHaveValue('');
    expect((await pointages()).map((p) => [p.nbrHeures, p.commentaire])).toEqual([[3.25, 'Pose E2E 394']]);
    expect(envois).toEqual(['POST /api/heures', 'POST /api/heures']);
  } finally {
    await cloturer(request, session.token, chantier.id);
  }
});

// Critère du cadrage v2 du lot U : « Journal des heures : pré-rempli à la virgule » ; lot W (cadrage v2, « Tests ») : « journal
// pré-rempli « 7,5 », « 2,3 » refusé, correction « 2,75 » enregistrée ». Pointage de départ à 7,5 h, pré-rempli « 7,5 » et
// admis tel quel par le champ. Lectures écartées : pré-remplissage au point (« 7.5 », avant le lot U) ; « 7,5 » refusé par le
// motif (deux décimales exigées) ; « 2,3 » admis (centième) ; « 2,75 » refusé (demi-heure d'avant le lot W) ou lu 275 h
// (champ number en anglais).
test('Journal des heures de la fiche chantier, Chromium en anglais : nombre d’heures pré-rempli à la virgule « 7,5 » ; « 2,3 » refusé par le navigateur ; correction « 2,75 » enregistrée à 2,75 h', async ({ page, request, session, creerClient, allerSurPageAdmin }) => {
  test.slow();
  const { chantier, intervenant } = await ouvrirChantier(request, session.token, creerClient, 'Journal heures 394');
  try {
    const pointage = await envoyer(request, session.token, 'post', '/heures', { chantierId: chantier.id, intervenantId: intervenant.id, date: dateDuJour(), nbrHeures: '7.5' }) as { id: string };
    const heuresEnBase = async () => (await lire<PointageLu[]>(request, session.token, '/heures')).filter((p) => p.id === pointage.id).map((p) => p.nbrHeures);
    expect(await heuresEnBase()).toEqual([7.5]);
    const envois = suivreEnvois(page, /^\/api\/heures\//);
    await allerSurPageAdmin(`/chantiers/${chantier.id}`);
    await expect(page.getByRole('heading', { name: chantier.nom })).toBeVisible();
    await navigateurAnglais(page);
    const ouvrir = async () => {
      await page.getByTitle('Corriger ce pointage').click();
      await expect(page.locator('input[name="motifCorrection"]')).toBeVisible();
    };
    const formulaire = page.locator('form').filter({ has: page.locator('input[name="motifCorrection"]') });
    const heures = formulaire.locator('input[name="nbrHeures"]');

    await ouvrir();
    await expect(heures).toHaveValue('7,5');
    expect(await validite(heures), 'valeur pré-remplie admise').toEqual(ADMIS);
    await champTexte(heures);
    await expect(heures).toHaveAttribute('title', TITRE_HEURES);
    // Champ nommé pour les lecteurs d'écran (aria-label « Nombre d’heures », ajouté par le lot).
    await expect(formulaire.getByRole('textbox', { name: 'Nombre d’heures' })).toHaveCount(1);
    await formulaire.locator('input[name="motifCorrection"]').fill('Correction E2E 394');
    await saisir(heures, '2,3');
    expect(await validite(heures)).toEqual(HORS_MOTIF);
    await formulaire.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(heures).toHaveValue('2,3');
    expect(envois, 'aucune correction envoyée').toEqual([]);

    await saisir(heures, '2,75');
    const correction = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/heures/${pointage.id}`);
    await formulaire.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    const reponse = await correction;
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect(reponse.request().postDataJSON()).toMatchObject({ nbrHeures: '2,75' });
    await expect(page.locator('input[name="motifCorrection"]')).toHaveCount(0);
    expect(await heuresEnBase()).toEqual([2.75]);
    await ouvrir();
    await expect(heures).toHaveValue('2,75');
    expect(envois).toEqual([`PATCH /api/heures/${pointage.id}`]);
  } finally {
    await cloturer(request, session.token, chantier.id);
  }
});

type Parametres = { margeCommercialeActive: boolean; tauxAcompteDefaut: number; seuilMargeFaible: number | null; joursSansSaisie: number | null };

// Critères du cadrage v2 : « Taux d'acompte « 5,5 » → 5,5, pré-rempli « 5,5 ». Seuil « 12,5 » → 12,5. » Valeurs de départ
// posées par l'API, 37,5 % et 8,25 %, pré-remplies « 37,5 » et « 8,25 ». Lectures écartées : champ number en anglais (« 5,5 »
// lu 55 %, admis sous le maximum de 100 ; « 12,5 » lu 125, bloqué par max="100") ; pré-remplissage au point (« 37.5 »,
// « 8.25 ») ; lecture arrêtée à la virgule (5 %, 12 %). « 100,5 », « 101 » et « 5,555 » refusés par le navigateur (bornes du
// serveur : 0 à 100, deux décimales).
test('Marges & Commissions, Chromium en anglais : taux d’acompte par défaut « 5,5 » et seuil de marge faible « 12,5 » enregistrés à 5,5 % et 12,5 %, pré-remplis à la virgule ; hors bornes refusés par le navigateur, sans envoi', async ({ page, request, session, allerSurPageAdmin }) => {
  test.slow();
  const avant = await lire<Parametres>(request, session.token, '/parametres');
  try {
    await envoyer(request, session.token, 'put', '/parametres', { tauxAcompteDefaut: '37,5', seuilMargeFaible: '8,25' });
    const reglages = async () => { const p = await lire<Parametres>(request, session.token, '/parametres'); return [p.tauxAcompteDefaut, p.seuilMargeFaible]; };
    expect(await reglages()).toEqual([37.5, 8.25]);
    const fenetres: string[] = [];
    page.on('dialog', (dialogue) => { fenetres.push(dialogue.message()); void dialogue.accept(); });
    const envois = suivreEnvois(page, /^\/api\/parametres$/);
    const ouvrirOnglet = async () => {
      await page.getByRole('button', { name: 'Marges & Commissions', exact: true }).click();
      await expect(page.getByRole('group', { name: 'Devis et acompte' })).toBeVisible();
    };
    await allerSurPageAdmin('/admin');
    await navigateurAnglais(page);
    await ouvrirOnglet();
    const taux = page.getByRole('group', { name: 'Devis et acompte' }).locator('input[name="tauxAcompteDefaut"]');
    const seuil = page.locator('input[name="seuilMargeFaible"]');
    const enregistrer = page.locator('form').filter({ has: page.getByRole('group', { name: 'Devis et acompte' }) }).getByRole('button', { name: 'Enregistrer', exact: true });
    await expect(taux).toHaveValue('37,5');
    await expect(seuil).toHaveValue('8,25');
    await champTexte(taux);
    await champTexte(seuil);
    await expect(page.getByRole('group', { name: 'Devis et acompte' }).getByRole('textbox', { name: /Taux d'acompte proposé par défaut/ })).toHaveCount(1);
    await expect(page.getByRole('textbox', { name: 'Seuil de marge faible en pourcentage' })).toHaveCount(1);

    // Hors bornes ou hors forme : refusé par le navigateur, rien n'est envoyé.
    for (const [champ, saisie] of [[taux, '100,5'], [taux, '101'], [taux, '5,555'], [seuil, '12,555'], [seuil, '100,01']] as const) {
      await saisir(taux, '5,5');
      await saisir(seuil, '12,5');
      await saisir(champ, saisie);
      expect(await validite(champ), `« ${saisie} »`).toEqual(HORS_MOTIF);
      await enregistrer.click();
      await expect(champ).toHaveValue(saisie);
    }
    // Taux vidé : le champ est obligatoire.
    await taux.fill('');
    expect(await validite(taux)).toEqual(MANQUANT);
    await enregistrer.click();
    expect(envois).toEqual([]);

    // Taux « 5,5 », seuil inchangé (« 8,25 ») : envoyés tels quels.
    await saisir(taux, '5,5');
    await saisir(seuil, '8,25');
    let enregistrement = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/parametres');
    await enregistrer.click();
    let reponse = await enregistrement;
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect(reponse.request().postDataJSON()).toMatchObject({ tauxAcompteDefaut: '5,5', seuilMargeFaible: '8,25' });
    expect(await reglages()).toEqual([5.5, 8.25]);
    // Seuil « 12,5 ».
    await saisir(seuil, '12,5');
    enregistrement = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/parametres');
    await enregistrer.click();
    reponse = await enregistrement;
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect(reponse.request().postDataJSON()).toMatchObject({ tauxAcompteDefaut: '5,5', seuilMargeFaible: '12,5' });
    expect(await reglages()).toEqual([5.5, 12.5]);
    await expect.poll(() => fenetres).toEqual(['Paramètres mis à jour', 'Paramètres mis à jour']);

    // Page rechargée : les valeurs enregistrées sont pré-remplies à la virgule.
    await page.reload({ waitUntil: 'networkidle' });
    await ouvrirOnglet();
    await expect(taux).toHaveValue('5,5');
    await expect(seuil).toHaveValue('12,5');
  } finally {
    await request.put(`${api}/parametres`, { headers: entete(session.token), data: { tauxAcompteDefaut: avant.tauxAcompteDefaut, seuilMargeFaible: avant.seuilMargeFaible ?? '' } });
  }
});

type Tranche = { plafond: number | null; taux: number };
type Remuneration = { baremeStandard: Tranche[]; baremeReduit: Tranche[]; libelleBaremeReduit: string; objectifCaMensuel: number; primeObjectifCa: number; objectifMargeMensuel: number; primeObjectifMarge: number; primeSuiviAdministratif: number };

// Critère du cadrage v2 : « Rémunération : objectif « 1250,50 », tranche « 1500,50 » / « 12,5 » enregistrés tels quels (et non
// « sans plafond » / 0), étiquette « dès 1 501 € ». » Règles de départ posées par l'API (tranche 1 000 € à 10 %, puis 20 % sans
// plafond ; objectif 500 €), relues et rétablies à la fin. Lectures écartées : champ number en anglais (« 1250,50 » lu 125050 ;
// « 1500,50 » lu 150050, « dès 150 050 € » ; « 12,5 » lu 125, bloqué par max="100") ; l'écran qui convertirait par `Number`
// (« 1500,50 » envoyé null, enregistré « sans plafond », et « 12,5 » envoyé null, enregistré 0 % : C2 du contrôle) ; l'étiquette
// calculée par `Number` (« dès NaN € ») ; l'arrondi au pair ou la troncature (« dès 1 500 € »). Après l'enregistrement, les
// champs reprennent les valeurs du serveur, à la virgule (« 1500,5 », « 12,5 », « 1250,5 »).
test('Rémunération, Chromium en anglais : objectif « 1250,50 », tranche « 1500,50 » à « 12,5 » % enregistrés tels quels, étiquette « dès 1 501 € » ; taux vidé, plafond « 0 » ou « 1500,505 » refusés par le navigateur, sans envoi', async ({ page, request, session, allerSurPageAdmin }) => {
  test.slow();
  const avant = await lire<Remuneration>(request, session.token, '/parametres/remuneration');
  try {
    await envoyer(request, session.token, 'put', '/parametres/remuneration', {
      ...avant, baremeStandard: [{ plafond: 1000, taux: 10 }, { plafond: null, taux: 20 }], baremeReduit: [{ plafond: null, taux: 5 }],
      objectifCaMensuel: 500, primeObjectifCa: 0, objectifMargeMensuel: 0, primeObjectifMarge: 0, primeSuiviAdministratif: 0,
    });
    const envois = suivreEnvois(page, /^\/api\/parametres\/remuneration$/);
    await allerSurPageAdmin('/admin');
    await navigateurAnglais(page);
    await page.getByRole('button', { name: 'Marges & Commissions', exact: true }).click();
    const bareme = page.locator('div.p-4.rounded.border', { hasText: 'Barème standard' });
    // Champs repérés par leur place (plafond puis taux de chaque tranche ; objectif par son libellé), et non par leur nom
    // accessible, ajouté par le lot : sur fcc6708, le test échoue ainsi sur le montant lu, et non faute de trouver le champ.
    const champsBareme = bareme.locator('input');
    const plafond1 = champsBareme.nth(0);
    const taux1 = champsBareme.nth(1);
    const plafond2 = champsBareme.nth(2);
    const etiquettes = bareme.locator('span', { hasText: /^dès / });
    const objectif = page.locator('.form-group', { has: page.getByText('Objectif de CA mensuel (€)', { exact: true }) }).locator('input');
    const enregistrer = page.getByRole('button', { name: 'Enregistrer les règles' });
    await expect(plafond1).toHaveValue('1000');
    await expect(taux1).toHaveValue('10');
    await expect(plafond2).toHaveValue('');
    await expect(objectif).toHaveValue('500');
    await expect(etiquettes).toHaveText([exactement('dès 0 €'), exactement(`dès 1${FINE}000 €`)]);

    // Saisie au clavier : l'étiquette de la tranche suivante suit le plafond saisi à la virgule.
    await saisir(objectif, '1250,50');
    await saisir(plafond1, '1500,50');
    await saisir(taux1, '12,5');
    await expect(etiquettes).toHaveText([exactement('dès 0 €'), exactement(`dès 1${FINE}501 €`)]);
    for (const champ of [plafond1, taux1, objectif]) await champTexte(champ);
    // Noms accessibles ajoutés par le lot (aria-label des tranches, `htmlFor` des objectifs).
    await expect(bareme.getByRole('textbox', { name: 'Plafond de la tranche 1' })).toHaveCount(1);
    await expect(bareme.getByRole('textbox', { name: 'Taux de la tranche 1' })).toHaveCount(1);
    await expect(page.getByRole('textbox', { name: 'Objectif de CA mensuel (€)' })).toHaveCount(1);

    // Hors forme : refusé par le navigateur, rien n'est envoyé.
    for (const [champ, saisie] of [[plafond1, '1500,505'], [plafond1, '0'], [taux1, '100,5'], [objectif, '1250,505']] as const) {
      await saisir(champ, saisie);
      expect(await validite(champ), `« ${saisie} »`).toEqual(HORS_MOTIF);
      await enregistrer.click();
      await expect(champ).toHaveValue(saisie);
      await saisir(objectif, '1250,50');
      await saisir(plafond1, '1500,50');
      await saisir(taux1, '12,5');
    }
    await taux1.fill('');
    expect(await validite(taux1)).toEqual(MANQUANT);
    await enregistrer.click();
    expect(envois).toEqual([]);

    await saisir(taux1, '12,5');
    const enregistrement = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/parametres/remuneration');
    await enregistrer.click();
    const reponse = await enregistrement;
    expect(reponse.status(), await reponse.text()).toBe(200);
    expect(reponse.request().postDataJSON()).toMatchObject({
      baremeStandard: [{ plafond: '1500,50', taux: '12,5' }, { plafond: null, taux: 20 }], objectifCaMensuel: '1250,50',
    });
    await expect(page.getByText('Règles de rémunération enregistrées.')).toBeVisible();
    const relues = await lire<Remuneration>(request, session.token, '/parametres/remuneration');
    expect([relues.baremeStandard, relues.baremeReduit, relues.objectifCaMensuel]).toEqual([[{ plafond: 1500.5, taux: 12.5 }, { plafond: null, taux: 20 }], [{ plafond: null, taux: 5 }], 1250.5]);
    await expect(plafond1).toHaveValue('1500,5');
    await expect(taux1).toHaveValue('12,5');
    await expect(objectif).toHaveValue('1250,5');
    await expect(etiquettes).toHaveText([exactement('dès 0 €'), exactement(`dès 1${FINE}501 €`)]);
    expect(envois).toEqual(['PUT /api/parametres/remuneration']);
  } finally {
    await request.put(`${api}/parametres/remuneration`, { headers: entete(session.token), data: avant });
  }
});

// Critère du cadrage v2 : « Ligne au forfait « 1,5 » refusé, « 2 » accepté » (point 6 ; motif « [1-9]\d{0,8} », choix par défaut,
// à confirmer). Main d'œuvre au forfait jour hors contrat de 300 € HT. Lectures écartées : champ number en anglais (« 1,5 » lu
// 15 jours, un entier valide : 4 500 € HT) ; « 1,5 » admis puis arrondi (2 jours) ou tronqué (1 jour, 300 € HT) ; « 0 » admis ;
// une saisie convertie en nombre à chaque touche (« 1. » lu 1, puis « 15 » : « 1.5 » tapé au clavier devient 15 jours, et
// « 1, » devient « NaN ») : le champ doit garder ce qui est tapé, pour que le navigateur le refuse.
test('Devis, ligne au jour, Chromium en anglais : « 1,5 » jour et « 0 » refusés par le navigateur, sans envoi ; « 2 » accepté et enregistré à 2 jours, 600 € HT', async ({ page, request, session, creerClient, allerSurPageAdmin }) => {
  test.slow();
  const suffixe = `${Date.now()}`;
  const mainOeuvre = await envoyer(request, session.token, 'post', '/catalogue/prestations', {
    estMainOeuvre: true, reference: `E2E-394-FJ-${suffixe}`, nom: `Forfait 394 E2E ${suffixe}`, tauxTva: '20',
    prixVenteHt: '42', prixJourHorsContratHt: '300', prixHeureSousContratHt: '38', prixJourSousContratHt: '270', heuresParJour: '7',
  }) as { id: string };
  const client = await creerClient('Forfait 394');
  const objet = `Devis forfait 394 E2E ${suffixe}`;
  const envois = suivreEnvois(page, /^\/api\/devis$/);
  await allerSurPageAdmin('/devis');
  await navigateurAnglais(page);
  await choisirClient(page, client);
  await page.getByRole('textbox', { name: 'Objet' }).fill(objet);
  const bloc = page.getByRole('group', { name: 'Main d’œuvre au jour ou à la demi-journée', exact: true });
  // Liste nommée par son libellé visible, « Main d’œuvre », distinct de la légende du groupe (lot V, note W1 de #390).
  await bloc.getByRole('combobox', { name: 'Main d’œuvre', exact: true }).selectOption(mainOeuvre.id);
  await bloc.getByRole('button', { name: 'Ajouter la ligne au jour ou à la demi-journée', exact: true }).click();
  const ligne = page.getByRole('group', { name: 'Ligne au jour ou à la demi-journée', exact: true });
  await expect(ligne).toHaveCount(1);
  const jours = ligne.getByLabel('Jours');
  await expect(jours).toHaveValue('1');
  for (const saisie of ['1.5', '1,5', '0']) {
    await saisir(jours, saisie);
    expect(await validite(jours), `« ${saisie} »`).toEqual(HORS_MOTIF);
    await page.getByRole('button', { name: 'Créer le brouillon' }).click();
    await expect(jours).toHaveValue(saisie);
  }
  expect(envois, 'aucune création envoyée').toEqual([]);
  await champTexte(jours, 'numeric');

  await saisir(jours, '2');
  expect(await validite(jours)).toEqual(ADMIS);
  const creation = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/devis');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  const reponse = await creation;
  expect(reponse.status(), await reponse.text()).toBe(201);
  const devis = (await lire<{ objet: string; totalHt: number; lignes: { forfaitMainOeuvre: string | null; quantite: number; prixUnitaireHt: number }[] }[]>(request, session.token, '/devis')).filter((d) => d.objet === objet);
  expect(devis.map((d) => [d.totalHt, d.lignes.map((l) => [l.forfaitMainOeuvre, l.quantite, l.prixUnitaireHt])])).toEqual([[600, [['JOUR', 2, 300]]]]);
  await expect(page.getByRole('listitem').filter({ hasText: objet })).toContainText(/HT 600,00 €/);
  expect(envois).toEqual(['POST /api/devis']);
});
