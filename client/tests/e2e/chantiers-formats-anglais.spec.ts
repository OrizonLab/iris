import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect, dateDuJour, horsDuPassageDeMinuit } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot V, fiche et liste des chantiers (#388, fin de #212, #390, #392 ; cadrage v2, qui fait foi, section « Tests »). Décision de
// Nelson du 22-11-2026 (soir), point 2 : « Oui passe au point 2 ». Règle de CLAUDE.md : écrans en français, montants au format
// français, dates JJ-MM-AAAA. Choix par défaut du cadrage, à confirmer (règle 5), éprouvés tels quels :
//  - formats de la fiche : tous les montants de ChantierIndicateurs.tsx en fmtEuro (à l'euro près, moitié vers l'extérieur,
//    milliers en U+202F, espace ordinaire avant « € »), marge du jour arrondie à l'euro, manque à gagner affiché seulement si
//    son arrondi à l'euro est positif (« fmtEuro(-m) »), marges en % par fmtPourcentage(…, 1) suivi de « du vendu »,
//    consommations par fmtPourcentage(…, 0) ; « 1 234,56 € » devient « 1 235 € », « 100.0% du budget vendu » « 100 % du vendu » ;
//  - liste : « % du vendu » et « Fin estimée » par fmtPourcentage(…, 1) ; solde d'heures arrondi au centième, signe et couleur
//    lus sur cette valeur, « 0 h » sans signe, en vert ;
//  - couleur : `arrondiEuro(valeur) >= 0` sur la valeur affichée, partout ; une marge nulle est verte sur la fiche, la liste et
//    le tableau de bord (limite connue, N4 : une perte de moins de 0,50 € s'affiche « 0 € » en vert) ;
//  - noms : « Montant vendu », « Budget matériel », « Budget main-d’œuvre », « Heures vendues », « Référence de l'affaire »
//    (rien quand elle manque), « Client : », « Resp. : » ;
//  - affaire annulée : badge « Annulé » gris, « Démarré le JJ-MM-AAAA — annulé avec son devis le JJ-MM-AAAA : motif » (date
//    d'annulation au jour civil de la société, motif s'il existe, sans nombre de jours), ni « terminé le » ni « Devis: N/A » ;
//  - Administration > Chantiers : statut par la table partagée (« En cours », « Terminé », « Annulé »).
// Navigateur réglé en anglais (en-US) : un format sans locale y écrirait « 1,234.56 € » ; le témoin navigateurEnAnglais le
// prouve dans chaque page. Chaque attendu nomme ses caractères par une expression ancrée (`toHaveText` avec une chaîne ramène
// toute espace à l'espace ordinaire) et écarte en commentaire les autres lectures plausibles.
//
// Montants (règle 2 de la méthode ; un test manquant serait classé C), choisis pour qu'une autre lecture donne un autre texte :
//  - affaire A : devis de 1 × 1 000,50 € HT de fourniture (prix d'achat prévu 950 €) et 1 × 234,06 € HT de main-d'œuvre, soit
//    vendu 1 234,56 €, budget matériel 1 000,50 €, budget main-d'œuvre 234,06 € ; 18,75 heures vendues ; un achat de 875 € HT et
//    12,5 h pointées à 10 €/h (125 €) : dépenses 1 000 €, marge 234,56 € (19 % du vendu), matériel consommé à 87,46 %,
//    main-d'œuvre à 53,40 %, heures à 66,67 % ; marge estimée 1 234,56 − (18,75 × 10 + 950) = 97,06 € (7,86 %) ;
//  - affaire B : vendu 1 000 € (fourniture, prix d'achat prévu 600 €), achat de 1 000 € : marge nulle, marge estimée nulle ;
//  - affaire C : vendu 1 000 € (fourniture, prix d'achat prévu 600 €), achat de 1 000,30 € : marge de -0,30 € (-0,03 %).
// Les valeurs injectées dans les réponses du serveur (solde d'heures, manque à gagner, motif et instant d'annulation) ne portent
// que sur l'affichage, que seul ce lot change ; les autres viennent de la base.
test.use({ locale: 'en-US' });

const FINE = ' ';
const echapper = (texte: string) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactement = (texte: string) => new RegExp(`^${echapper(texte)}$`);
// Classe CSS entière, et non une sous-chaîne d'une autre (« bg-emerald-50 » n'est pas « bg-emerald-500 »).
const classe = (nom: string) => new RegExp(`(?:^|\\s)${echapper(nom)}(?:\\s|$)`);
const ROUGE = /(?:^|\s)(?:bg|border|text)-red-\d+(?:\s|$)/;

// Témoin : la page est bien servie en anglais ; un `toLocaleString()` sans locale y écrirait « 1,234.56 ».
async function navigateurEnAnglais(page: Page) {
  expect(await page.evaluate(() => [navigator.language, (1234.56).toLocaleString(), (1234.56).toLocaleString('fr-FR')])).toEqual(['en-US', '1,234.56', `1${FINE}234,56`]);
}

type Metriques = {
  materielReel: number; moReel: number | null; totalDepenses: number | null; heuresRealisees: number; diffHeures: number;
  margeCommerciale: number | null; margePct: number | null; margeEstimee: number | null; margeEstimeePct: number | null;
};
type Fiche = {
  id: string; nom: string; client: string; numeroDevis: string | null; statut: string; heuresVendues: number;
  budgetGlobalVendu: number | null; budgetMaterielVendu: number | null; budgetMainOeuvreVendu: number | null; coutMaterielPrevu: number | null;
  dateFin: string | null; annuleLe: string | null; motifAnnulation: string | null; metrics: Metriques;
};
type Ligne = { designation: string; nature: 'FOURNITURE' | 'MAIN_OEUVRE'; quantite: number; prixUnitaireHt: number; tauxTva: number; prixAchatUnitaireHt?: string };

function outils(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const appel = async <T>(methode: 'get' | 'post' | 'put' | 'patch', chemin: string, data?: object): Promise<T> => {
    const reponse = await request[methode](`${api}${chemin}`, { headers, ...(data ? { data } : {}) });
    expect(reponse.ok(), `${methode.toUpperCase()} ${chemin} : ${reponse.status()} ${await reponse.text()}`).toBeTruthy();
    return reponse.json() as Promise<T>;
  };
  // Affaire ouverte par la conversion d'un devis signé, seule porte d'ouverture d'un chantier.
  const affaire = async (objet: string, clientId: string, lignes: Ligne[]) => {
    const devis = await appel<{ id: string }>('post', '/devis', { clientId, objet, lignes });
    await appel('put', `/devis/${devis.id}/statut`, { statut: 'ENVOYE' });
    await appel('post', `/devis/${devis.id}/signature`, { signataire: 'Client E2E', confirme: true });
    const chantier = await appel<Fiche>('post', `/devis/${devis.id}/convertir`, { cible: 'CHANTIER' });
    return { devis, chantier };
  };
  const fiche = (id: string) => appel<Fiche>('get', `/chantiers/${id}`);
  const cloturer = (id: string) => request.patch(`${api}/chantiers/${id}/statut`, { headers, data: { statut: 'TERMINE' } });
  return { headers, appel, affaire, fiche, cloturer };
}

// La marge se lit sous ses réglages par défaut (schema.prisma : margeCommercialeActive vaut true), au fuseau par défaut de la
// société (Europe/Paris, celui de dateDuJour) : si une spec précédente ne les a pas restaurés, le test échoue ici.
async function verifierReglages(appel: ReturnType<typeof outils>['appel']) {
  const parametres = await appel<{ margeCommercialeActive: boolean }>('get', '/parametres');
  expect(parametres.margeCommercialeActive, 'marge commerciale désactivée par une spec précédente').toBe(true);
  const societe = await appel<{ fuseauHoraire?: string | null }>('get', '/company');
  expect(societe.fuseauHoraire || 'Europe/Paris', 'fuseau de la société changé par une spec précédente').toBe('Europe/Paris');
}

// Remplace dans le navigateur la réponse GET d'une route du serveur (affichage seul).
async function remplacerReponse(page: Page, chemin: string, modifier: (donnees: any) => unknown) {
  await page.route((url) => url.pathname === chemin, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const reponse = await route.fetch();
    await route.fulfill({ response: reponse, json: modifier(await reponse.json()) });
  });
}

// Valeur d'une carte de la fiche ou de l'administration : le texte qui suit son libellé.
const valeurSous = (portee: Page | Locator, libelle: string) => portee.getByText(libelle, { exact: true }).locator('xpath=following-sibling::div[1]');
// Bloc d'une barre de consommation de la fiche, sous son titre.
const blocConsommation = (page: Page, titre: string) => page.getByRole('heading', { name: titre, exact: true }).locator('xpath=../..');
const enTete = (page: Page, nom: string) => page.getByRole('heading', { name: nom, exact: true }).locator('xpath=../..');

test('lot V, navigateur en anglais : fiche, « Modifier », liste, tableau de bord, Administration > Chantiers et Heures au format français, sans « -0 % » ni « ±0 h », marge nulle verte partout, un seul nom par valeur', async ({ request, session, creerClient, allerSurPageAdmin, page }) => {
  test.slow();
  const { appel, affaire, fiche, cloturer } = outils(request, session.token);
  await verifierReglages(appel);
  const suffixe = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const client = await creerClient(`lot V formats ${suffixe}`);
  const conducteur = await appel<{ id: string; name: string }>('post', '/users', { email: `lot-v.conducteur.${suffixe}@iris.test`, name: `TEST Conducteur lot V ${suffixe}`, role: 'CONDUCTEUR_TRAVAUX' });
  const categorie = await appel<{ id: string }>('post', '/categories', { nom: `TEST Lot V ${suffixe} catégorie` });
  const fournisseur = await appel<{ id: string }>('post', '/fournisseurs', { nom: `TEST Lot V ${suffixe} fournisseur` });
  const intervenant = await appel<{ id: string }>('post', '/intervenants', { nom: `TEST Intervenant lot V ${suffixe}`, role: 'Technicien', tauxHoraireCharge: 10 });
  const acheter = (chantierId: string, montantHT: number) => appel('post', '/achats', { chantierId, categorieId: categorie.id, fournisseurId: fournisseur.id, date: dateDuJour(), description: `TEST Achat lot V ${suffixe}`, montantHT });

  const A = (await affaire(`TEST Lot V fiche ${suffixe}`, client.id, [
    { designation: 'Centrale', nature: 'FOURNITURE', quantite: 1, prixUnitaireHt: 1000.5, tauxTva: 20, prixAchatUnitaireHt: '950.00' },
    { designation: 'Pose', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 234.06, tauxTva: 20 },
  ])).chantier;
  const B = (await affaire(`TEST Lot V marge nulle ${suffixe}`, client.id, [{ designation: 'Matériel', nature: 'FOURNITURE', quantite: 1, prixUnitaireHt: 1000, tauxTva: 20, prixAchatUnitaireHt: '600.00' }])).chantier;
  const C = (await affaire(`TEST Lot V perte de 30 centimes ${suffixe}`, client.id, [{ designation: 'Matériel', nature: 'FOURNITURE', quantite: 1, prixUnitaireHt: 1000, tauxTva: 20, prixAchatUnitaireHt: '600.00' }])).chantier;
  try {
    await appel('patch', `/chantiers/${A.id}`, { heuresVendues: 18.75, responsableId: conducteur.id });
    await acheter(A.id, 875);
    await appel('post', '/heures', { chantierId: A.id, intervenantId: intervenant.id, date: dateDuJour(), nbrHeures: 12.5 });
    await acheter(B.id, 1000);
    await acheter(C.id, 1000.3);

    // État relu par l'API : l'écran n'affiche que ces valeurs, sans autre calcul que le sien (le lot ne change aucun calcul).
    const [a, b, c] = [await fiche(A.id), await fiche(B.id), await fiche(C.id)];
    expect([a.budgetGlobalVendu, a.budgetMaterielVendu, a.budgetMainOeuvreVendu, a.heuresVendues, a.coutMaterielPrevu, a.statut]).toEqual([1234.56, 1000.5, 234.06, 18.75, 950, 'EN_COURS']);
    expect([a.metrics.materielReel, a.metrics.moReel, a.metrics.totalDepenses, a.metrics.heuresRealisees, a.metrics.margeCommerciale, a.metrics.margeEstimee]).toEqual([875, 125, 1000, 12.5, 234.56, 97.06]);
    expect(a.metrics.margePct).toBeCloseTo(18.9995, 3);
    expect(a.metrics.margeEstimeePct).toBeCloseTo(7.8619, 3);
    expect(a.numeroDevis, 'référence de l’affaire posée par la conversion').toBeTruthy();
    expect([b.budgetGlobalVendu, b.metrics.margeCommerciale, b.metrics.margePct, b.metrics.margeEstimee, b.metrics.margeEstimeePct]).toEqual([1000, 0, 0, 0, 0]);
    expect([c.budgetGlobalVendu, c.metrics.margeCommerciale, c.metrics.margeEstimee]).toEqual([1000, -0.3, -0.3]);
    expect(c.metrics.margePct).toBeCloseTo(-0.03, 6);
    expect(c.metrics.margeEstimeePct).toBeCloseTo(-0.03, 6);

    // 1. Fiche de A.
    await allerSurPageAdmin(`/chantiers/${A.id}`);
    await navigateurEnAnglais(page);
    const entete = enTete(page, A.nom);
    // Statut par la table partagée ; « Client : » à la française ; « Référence de l'affaire : … » (« Devis: … » avant le lot).
    await expect(entete.getByText('En cours', { exact: true })).toBeVisible();
    await expect(entete.locator('span', { has: page.locator('strong', { hasText: /^Client :$/ }) })).toHaveText(`Client : ${a.client}`);
    await expect(entete.locator('span', { has: page.locator('strong', { hasText: /^Référence de l'affaire :$/ }) })).toHaveText(`Référence de l'affaire : ${a.numeroDevis}`);
    await expect(entete).not.toContainText('Devis:');
    await expect(entete).not.toContainText('N/A');
    await expect(entete).not.toContainText('Client:');

    // Cartes : « Montant vendu » 1 234,56 € → « 1 235 € » ; « Budget matériel » 1 000,50 € → « 1 001 € » ; « Budget
    // main-d’œuvre » 234,06 € → « 234 € » ; « Heures vendues » « 18,75 h ». Lectures écartées : « 1,234.56 € », « 1,000.5 € »,
    // « 234.06 € » (toLocaleString() sans locale, texte d'avant le lot dans ce navigateur) ; « 1 234,56 € », « 1 000,50 € »
    // (au centime) ; « 1 234 € » (troncature) ; « 1 000 € » (troncature ou arrondi au pair de 1 000,5).
    await expect(valeurSous(page, 'Montant vendu')).toHaveText(exactement(`1${FINE}235 €`));
    await expect(valeurSous(page, 'Budget matériel')).toHaveText(exactement(`1${FINE}001 €`));
    await expect(valeurSous(page, 'Budget main-d’œuvre')).toHaveText(exactement('234 €'));
    await expect(valeurSous(page, 'Heures vendues')).toHaveText(exactement('18,75 h'));
    // Anciens noms absents (témoin : les nouveaux sont lus juste au-dessus, sur les mêmes cartes).
    for (const ancien of ['Budget Vendu', 'Matériel Prévu', 'Heures Prévues', 'Coût MO Prévu']) await expect(page.getByText(ancien, { exact: true }), ancien).toHaveCount(0);

    // Marge du jour : 234,56 € → « 235 € », en vert ; 18,9995 % → « 19 % du vendu ». Lectures écartées : « 234.56 € » (texte
    // d'avant le lot dans ce navigateur), « 234,56 € » (au centime), « 234 € » (troncature) ; « 19.0% du budget vendu »
    // (toFixed(1) d'avant le lot), « 19,0 % » (zéro inutile). Dépenses réelles cumulées 1 000 € : « 1 000 € », et non « 1,000 € »
    // (sans locale) ni « 1 000,00 € » (au centime).
    const marge = page.locator('[data-marge-commerciale]');
    await expect(marge.locator('div.text-5xl')).toHaveText(exactement('235 €'));
    await expect(marge.locator('div.text-5xl')).toHaveClass(classe('text-emerald-700'));
    await expect(marge.getByText(/du vendu$/)).toHaveText(exactement('19 % du vendu'));
    await expect(valeurSous(marge, 'Dépenses Réelles Cumulées')).toHaveText(exactement(`1${FINE}000 €`));
    // Marge estimée en fin de chantier : 97,06 € → « 97 € » ; 7,8619 % → « 7,9 % » (une décimale). Lectures écartées : « 8 % »
    // (aucune décimale), « 7,86 % » (deux), « 7,8 % » (troncature).
    const estimation = page.locator('[data-estimation]');
    await expect(estimation.locator('div.text-2xl')).toHaveText(new RegExp(`^97\\u0020€\\s*7,9\\u0020%$`));
    await expect(estimation.locator('div.text-2xl span')).toHaveText(exactement('7,9 %'));

    // Consommations, sans décimale (fmtPourcentage(…, 0), comme l'avancement du tableau de bord) :
    //  - matériel 875 / 1 000,50 = 87,46 % → « 87 % » ; lectures écartées : « 87.5% » (toFixed(1) d'avant le lot), « 87,5 % »
    //    (une décimale), « 88 % » (arrondi vers le haut) ; montants « 875 € » et « / 1 001 € » (et non « 1,000.5 € ») ;
    //  - main-d'œuvre 125 / 234,06 = 53,40 % → « 53 % » ; lectures écartées : « 53.4% », « 53,4 % » ; « 125 € » et « / 234 € »
    //    (et non « 125,00 € », au centime, ni « 234.06 € ») ;
    //  - heures 12,5 / 18,75 = 66,67 % → « 67 % » ; lectures écartées : « 66.7% » (toFixed(1)), « 66,7 % » (une décimale),
    //    « 66,67 % » (deux), « 66 % » (troncature).
    const materiel = blocConsommation(page, 'Consommation Matériel');
    await expect(materiel.locator('div.mb-2 > div.text-right > span')).toHaveText([exactement('875 €'), exactement(`/ 1${FINE}001 €`)]);
    await expect(materiel.locator('div.mt-2')).toHaveText(exactement('87 %'));
    const mainOeuvre = blocConsommation(page, 'Coût Main d\'Œuvre');
    await expect(mainOeuvre.locator('div.mb-2 > div.text-right > span')).toHaveText([exactement('125 €'), exactement('/ 234 €')]);
    await expect(mainOeuvre.locator('div.mt-2 > span').last()).toHaveText(exactement('53 %'));
    // Aucune heure en trop : pas de manque à gagner.
    await expect(mainOeuvre.locator('div.mt-2 > span').first()).toHaveText('');
    const heures = blocConsommation(page, 'Consommation Heures');
    await expect(heures.locator('div.mb-2 > div.text-right > span')).toHaveText([exactement('12,5 h'), exactement('/ 18,75 h')]);
    await expect(heures.locator('div.mt-2')).toHaveText(exactement('67 %'));
    // Aucun montant ni pourcentage au point décimal sur la fiche.
    await expect(page.locator('main')).not.toContainText(/\d\.\d+\s?[%€]/);

    // « Modifier » : un seul nom par valeur, chaque libellé sur son champ (nom du champ envoyé au serveur). Lectures écartées :
    // les libellés d'avant le lot, absents.
    await page.getByRole('button', { name: 'Modifier', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Modifier le chantier' })).toBeVisible();
    for (const [libelle, champ] of [
      ['Référence de l\'affaire', 'numeroDevis'], ['Montant vendu (€ HT)', 'budgetGlobalVendu'], ['Heures vendues (h)', 'heuresVendues'],
      ['Budget matériel (€ HT)', 'budgetMaterielVendu'], ['Budget main-d’œuvre (€ HT)', 'budgetMainOeuvreVendu'],
    ]) await expect(page.locator('.form-group', { has: page.getByText(libelle, { exact: true }) }).locator('input'), libelle).toHaveAttribute('name', champ);
    for (const ancien of ['N° de Devis', 'Budget Global (€ HT)', 'Total Heures Vendues (h)', 'Dont Matériel (€ HT)', 'Dont Main d\'Œuvre (€ HT)']) {
      await expect(page.getByText(ancien, { exact: true }), ancien).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Modifier le chantier' })).toHaveCount(0);

    // Manque à gagner (heures en trop × coût horaire moyen du chantier, calcul inchangé par le lot) : affiché seulement si son
    // arrondi à l'euro est positif, sous la forme fmtEuro(-m). Réponse de la fiche complétée dans le navigateur :
    //  - 20 h réalisées pour 18,75 vendues, 200 € de main-d'œuvre (10 €/h) : 1,25 h × 10 = 12,50 € → « Manque à gagner :
    //    -13 € » (moitié vers l'extérieur) ; lectures écartées : « -12.5 € » (texte d'avant le lot dans ce navigateur),
    //    « -12,50 € » (au centime), « -12 € » (Math.round, arrondi au pair) ;
    //  - 18,79 h pour 18,75, 187,90 € : 0,04 h × 10 = 0,40 € → rien ; lecture écartée : « -0.4 € » ou « -0,40 € », affiché avant
    //    le lot (arrondi au centime positif), à côté d'un montant à l'euro près.
    let realisees = { heuresRealisees: 20, moReel: 200 };
    await remplacerReponse(page, `/api/chantiers/${A.id}`, (lue: Fiche) => ({ ...lue, metrics: { ...lue.metrics, ...realisees } }));
    await page.reload({ waitUntil: 'networkidle' });
    await expect(mainOeuvre.locator('div.mt-2 > span').first()).toHaveText(exactement('Manque à gagner : -13 €'));
    await expect(mainOeuvre.locator('div.mt-2 > span').first()).toHaveClass(classe('text-red-600'));
    realisees = { heuresRealisees: 18.79, moReel: 187.9 };
    await page.reload({ waitUntil: 'networkidle' });
    await expect(heures.locator('div.mb-2 > div.text-right > span').first()).toHaveText(exactement('18,79 h'));
    await expect(mainOeuvre.locator('div.mt-2 > span').first()).toHaveText('');
    await expect(page.locator('main')).not.toContainText('Manque à gagner');
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // 2. Fiche de B, marge nulle (1 000 € vendus, 1 000 € d'achats) : « 0 € » et « 0 % du vendu », en vert (une seule règle,
    // `>= 0`, comme la liste et le tableau de bord). Lectures écartées : le rouge d'avant le lot (`margeAffichee > 0`), « 0.0% du
    // budget vendu » (toFixed(1)). Marge estimée nulle : « 0 € » et « 0 % », en vert.
    await page.goto(`/chantiers/${B.id}`, { waitUntil: 'networkidle' });
    await navigateurEnAnglais(page);
    await expect(marge.locator('div.text-5xl')).toHaveText(exactement('0 €'));
    await expect(marge.getByText(/du vendu$/)).toHaveText(exactement('0 % du vendu'));
    await expect(marge).toHaveClass(classe('bg-emerald-50'));
    await expect(marge).toHaveClass(classe('border-emerald-500'));
    for (const element of [marge.getByText('Marge Commerciale', { exact: true }), marge.locator('div.text-5xl'), marge.getByText(/du vendu$/)]) {
      await expect(element).toHaveClass(classe('text-emerald-700'));
    }
    await expect(marge).not.toHaveClass(ROUGE);
    await expect(estimation.locator('div.text-2xl')).toHaveText(new RegExp('^0\\u0020€\\s*0\\u0020%$'));
    await expect(estimation.locator('div.text-2xl')).toHaveClass(classe('text-emerald-700'));

    // 3. Fiche de C, marge de -0,30 € (-0,03 %) : « 0 € » et « 0 % du vendu », jamais « -0 % ». Lectures écartées : « -0.0% du
    // budget vendu » (toFixed(1) d'avant le lot), « -0 % » (Intl sans retrait du signe), « -0,03 % » (deux décimales) ; marge
    // estimée « 0 % », et non « -0 % » (toLocaleString('fr-FR') d'avant le lot). La couleur suit la valeur affichée (cadrage v2,
    // « Couleur ») : « 0 € » en vert, limite connue et déclarée (N4, une perte de moins de 0,50 €) ; lecture écartée : une
    // couleur lue sur la valeur brute (-0,30 €), qui mettrait « 0 € » en rouge.
    await page.goto(`/chantiers/${C.id}`, { waitUntil: 'networkidle' });
    await expect(marge.locator('div.text-5xl')).toHaveText(exactement('0 €'));
    await expect(marge.getByText(/du vendu$/)).toHaveText(exactement('0 % du vendu'));
    await expect(marge).toHaveClass(classe('bg-emerald-50'));
    await expect(estimation.locator('div.text-2xl')).toHaveText(new RegExp('^0\\u0020€\\s*0\\u0020%$'));
    await expect(page.locator('main')).not.toContainText(/[-−]0(?:[.,]0)?\s?%/);

    // 4. Liste des chantiers.
    await page.goto('/chantiers', { waitUntil: 'networkidle' });
    await navigateurEnAnglais(page);
    const ligne = (id: string) => page.locator(`tr[data-chantier="${id}"]`);
    const celluleMarge = (id: string) => ligne(id).locator('td').nth(3);
    // Noms : « Référence de l'affaire : … » et « Resp. : … » (« Devis : … » avant le lot).
    await expect(ligne(A.id).locator('td').first()).toContainText(`Référence de l'affaire : ${a.numeroDevis}`);
    await expect(ligne(A.id).locator('td').first()).toContainText(`Resp. : ${conducteur.name}`);
    await expect(ligne(A.id)).not.toContainText('Devis :');
    await expect(ligne(A.id)).not.toContainText('N/A');
    // A : « +235 € » en vert, « 19 % du vendu », « Fin estimée : 97 € · 7,9 % ».
    await expect(celluleMarge(A.id).locator('span').first()).toHaveText(exactement('+235 €'));
    await expect(celluleMarge(A.id).getByText(/du vendu$/)).toHaveText(exactement('19 % du vendu'));
    await expect(celluleMarge(A.id).locator('[data-marge-estimee]')).toHaveText(exactement('Fin estimée : 97 € · 7,9 %'));
    // B, marge nulle : « 0 € » sans signe, en vert ; « 0 % du vendu » en vert ; « Fin estimée : 0 € · 0 % ».
    await expect(celluleMarge(B.id).locator('span').first()).toHaveText(exactement('0 €'));
    await expect(celluleMarge(B.id).locator('span').first()).toHaveClass(classe('bg-emerald-100'));
    await expect(celluleMarge(B.id).getByText(/du vendu$/)).toHaveText(exactement('0 % du vendu'));
    await expect(celluleMarge(B.id).getByText(/du vendu$/)).toHaveClass(classe('text-emerald-700'));
    await expect(celluleMarge(B.id).locator('[data-marge-estimee]')).toHaveText(exactement('Fin estimée : 0 € · 0 %'));
    // C, -0,30 € : « 0 % du vendu » et « Fin estimée : 0 € · 0 % ». Lecture écartée : « -0 % » des deux, le texte d'avant le lot
    // (toLocaleString('fr-FR', { maximumFractionDigits: 1 }) de -0,03).
    await expect(celluleMarge(C.id).locator('span').first()).toHaveText(exactement('0 €'));
    await expect(celluleMarge(C.id).getByText(/du vendu$/)).toHaveText(exactement('0 % du vendu'));
    await expect(celluleMarge(C.id).locator('[data-marge-estimee]')).toHaveText(exactement('Fin estimée : 0 € · 0 %'));
    await expect(ligne(C.id)).not.toContainText(/[-−]0\s?%/);

    // 5. Solde d'heures, injecté dans la liste réduite à A, B et C (affichage seul). Sans aucune marge communiquée (colonne
    // « Solde heures ») : +0,004 h et -0,004 h → « 0 h », en vert ; -0,006 h → « -0,01 h », en rouge (témoin : le signe et le
    // rouge reviennent dès que la valeur affichée n'est plus nulle). Lectures écartées : « +0 h » et « -0 h » en rouge, les
    // textes d'avant le lot (signe et couleur lus sur la valeur brute).
    let scenario: 'sans marge' | 'liste mixte' = 'sans marge';
    const soldes: Record<string, number> = { [A.id]: 0.004, [B.id]: -0.004, [C.id]: -0.006 };
    await remplacerReponse(page, '/api/chantiers', (liste: Fiche[]) => liste.filter((ch) => [A.id, B.id, C.id].includes(ch.id)).map((ch) => {
      const rentabiliteMasquee = scenario === 'sans marge' || ch.id !== A.id;
      return {
        ...ch,
        // Liste mixte : B sans référence d'affaire (témoin : A garde la sienne).
        numeroDevis: scenario === 'liste mixte' && ch.id === B.id ? null : ch.numeroDevis,
        metrics: { ...ch.metrics, diffHeures: soldes[ch.id], ...(rentabiliteMasquee ? { margeCommerciale: null, margePct: null, margeEstimee: null, margeEstimeePct: null } : {}) },
      };
    }));
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('columnheader', { name: 'Solde heures' })).toBeVisible();
    const solde = (id: string) => celluleMarge(id).locator('span').first();
    await expect(solde(A.id)).toHaveText(exactement('0 h'));
    await expect(solde(A.id)).toHaveClass(classe('bg-emerald-100'));
    await expect(solde(B.id)).toHaveText(exactement('0 h'));
    await expect(solde(B.id)).toHaveClass(classe('bg-emerald-100'));
    await expect(solde(C.id)).toHaveText(exactement('-0,01 h'));
    await expect(solde(C.id)).toHaveClass(classe('bg-red-100'));
    // Liste mixte (la marge de A seule communiquée) : « Solde : 0 h » en vert pour -0,004 h, « Solde : +0,01 h » pour 0,006 h.
    scenario = 'liste mixte';
    soldes[B.id] = -0.004;
    soldes[C.id] = 0.006;
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('columnheader', { name: 'Marge' })).toBeVisible();
    await expect(celluleMarge(A.id).locator('span').first()).toHaveText(exactement('+235 €'));
    const soldeMixte = (id: string) => celluleMarge(id).getByText(/^Solde :/);
    await expect(soldeMixte(B.id)).toHaveText(exactement('Solde : 0 h'));
    await expect(soldeMixte(B.id)).toHaveClass(classe('bg-emerald-100'));
    await expect(soldeMixte(C.id)).toHaveText(exactement('Solde : +0,01 h'));
    await expect(soldeMixte(C.id)).toHaveClass(classe('bg-emerald-100'));
    // Référence absente : rien, ni « Référence de l'affaire » ni « N/A » (témoin : A la garde).
    await expect(ligne(B.id).locator('td').first()).not.toContainText('Référence de l\'affaire');
    await expect(ligne(B.id)).not.toContainText('N/A');
    await expect(ligne(A.id).locator('td').first()).toContainText(`Référence de l'affaire : ${a.numeroDevis}`);
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // 6. Tableau de bord, liste réduite (affichage seul) : d'abord A et B, B sans référence d'affaire (noms), puis B seule
    // (marge nulle du portefeuille).
    let retenus = [A.id, B.id];
    await remplacerReponse(page, '/api/chantiers', (liste: Fiche[]) => liste.filter((ch) => retenus.includes(ch.id))
      .map((ch) => (ch.id === B.id && retenus.length > 1 ? { ...ch, numeroDevis: null } : ch)));
    await page.goto('/', { waitUntil: 'networkidle' });
    await navigateurEnAnglais(page);
    const enCours = page.locator('div.bg-white.rounded-2xl').filter({ has: page.getByRole('heading', { name: 'Chantiers en cours' }) });
    const ligneTableau = enCours.getByRole('button').filter({ hasText: A.nom });
    // « Référence de l'affaire : … » et « Resp. : … » (« Devis: … » et « Resp: … » avant le lot).
    await expect(ligneTableau).toContainText(`Référence de l'affaire : ${a.numeroDevis}`);
    await expect(ligneTableau).toContainText(`Resp. : ${conducteur.name}`);
    await expect(ligneTableau).not.toContainText('Devis:');
    await expect(ligneTableau).not.toContainText('Resp:');
    // Référence absente : rien, ni « Référence de l'affaire » ni « Devis: N/A » (témoin : la ligne de A, juste au-dessus).
    const ligneSansReference = enCours.getByRole('button').filter({ hasText: B.nom });
    await expect(ligneSansReference).toContainText(b.client);
    await expect(ligneSansReference).not.toContainText('Référence de l\'affaire');
    await expect(ligneSansReference).not.toContainText('N/A');
    const portefeuille = page.getByRole('region', { name: 'Rentabilité des chantiers en cours' });
    // Témoin du portefeuille (A et B) : marge estimée 97,06 + 0 = 97,06 € sur 2 234,56 € vendus, « 97 € » et 4,3436 % →
    // « 4,3 % du vendu », en vert.
    await expect(portefeuille.locator('[data-marge-portefeuille]')).toHaveText(exactement('97 €'));
    await expect(portefeuille.locator('[data-marge-portefeuille] + div')).toHaveText(exactement('4,3 % du vendu'));
    retenus = [B.id];
    await page.reload({ waitUntil: 'networkidle' });
    // Marge estimée nulle (B) : « 0 € » et « 0 % du vendu », en vert, comme sur la fiche et dans la liste.
    await expect(portefeuille.locator('[data-marge-portefeuille]')).toHaveText(exactement('0 €'));
    await expect(portefeuille.locator('[data-marge-portefeuille]')).toHaveClass(classe('text-emerald-600'));
    await expect(portefeuille.locator('[data-marge-portefeuille] + div')).toHaveText(exactement('0 % du vendu'));
    await expect(portefeuille.locator('[data-marge-portefeuille] + div')).toHaveClass(classe('text-emerald-700'));
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // 7. Heures, liste réduite à A : « 12,5 h réalisées », « 18,75 h vendues ».
    await remplacerReponse(page, '/api/chantiers', (liste: Fiche[]) => liste.filter((ch) => ch.id === A.id));
    await page.goto('/heures', { waitUntil: 'networkidle' });
    await navigateurEnAnglais(page);
    const carteHeures = page.locator('div.card').filter({ has: page.getByRole('heading', { name: A.nom }) });
    await expect(carteHeures.locator('span').filter({ hasText: 'réalisées' })).toHaveText(exactement('12,5 h réalisées'));
    await expect(carteHeures.locator('span').filter({ hasText: 'vendues' })).toHaveText(exactement('18,75 h vendues'));
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // 8. C clôturé : Administration > Chantiers lit « En cours » pour A et « Terminé » pour C, jamais le code ; le tableau de
    // bord écrit sa référence dans les archives.
    expect((await cloturer(C.id)).ok()).toBeTruthy();
    await page.goto('/admin', { waitUntil: 'networkidle' });
    await navigateurEnAnglais(page);
    await expect(page.getByRole('heading', { name: 'Base de données des Chantiers' })).toBeVisible();
    const carte = (nom: string) => page.locator('div.p-4.bg-white.border').filter({ has: page.getByRole('link', { name: nom, exact: true }) });
    await expect(carte(A.nom).locator('span.badge')).toHaveText(exactement('En cours'));
    await expect(carte(C.nom).locator('span.badge')).toHaveText(exactement('Terminé'));
    await expect(carte(A.nom)).not.toContainText('EN_COURS');
    await expect(carte(C.nom)).not.toContainText('TERMINE');
    // « Client : X | Référence de l'affaire : Y » (« Devis : » avant le lot) ; libellés et valeurs des cartes.
    await expect(carte(A.nom)).toContainText(`Client : ${a.client} | Référence de l'affaire : ${a.numeroDevis}`);
    await expect(carte(A.nom)).not.toContainText('Devis :');
    await expect(valeurSous(carte(A.nom), 'Montant vendu')).toHaveText(exactement(`1${FINE}235 €`));
    await expect(valeurSous(carte(A.nom), 'Heures vendues')).toHaveText(exactement('18,75 h'));
    await expect(valeurSous(carte(A.nom), 'Budget matériel')).toHaveText(exactement(`1${FINE}001 €`));
    await expect(valeurSous(carte(A.nom), 'Budget main-d’œuvre')).toHaveText(exactement('234 €'));
    for (const ancien of ['Global Vendu', 'Heures Vendues', 'Matériel', 'Main d\'Œuvre']) await expect(carte(A.nom).getByText(ancien, { exact: true }), ancien).toHaveCount(0);
    // Référence absente (B, injectée sans référence ; affichage seul) : « Client : X », sans « | Référence de l'affaire » ni
    // « Devis : Non spécifié » (témoin : la carte de A, juste au-dessus).
    await remplacerReponse(page, '/api/chantiers', (liste: Fiche[]) => liste.map((ch) => (ch.id === B.id ? { ...ch, numeroDevis: null } : ch)));
    await page.reload({ waitUntil: 'networkidle' });
    await expect(carte(B.nom).locator('h4 + span')).toHaveText(`Client : ${b.client}`);
    await expect(carte(B.nom)).not.toContainText('Non spécifié');
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    await remplacerReponse(page, '/api/chantiers', (liste: Fiche[]) => liste.filter((ch) => ch.id === C.id));
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Chantiers terminés \/ archivés/ }).click();
    const archive = page.getByRole('button').filter({ hasText: C.nom });
    await expect(archive).toContainText(`Référence de l'affaire : ${c.numeroDevis}`);
    await expect(archive).not.toContainText('Devis:');
    await expect(archive).not.toContainText('N/A');
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
    // Affaires clôturées à la fin : elles ne s'ajoutent pas aux chantiers en cours des autres parcours.
    for (const id of [A.id, B.id, C.id]) await cloturer(id).catch(() => undefined);
  }
});

test('lot V, navigateur en anglais : une affaire annulée affiche « Annulé » en gris, « annulé avec son devis le JJ-MM-AAAA : motif » au jour de la société, ni « terminé le », ni nombre de jours, ni « Devis: N/A » ; un chantier terminé garde « terminé le »', async ({ request, session, creerClient, connexion }) => {
  test.slow();
  // L'affaire s'annule et le chantier témoin se clôture le jour même : le parcours ne chevauche pas minuit (#366).
  await horsDuPassageDeMinuit();
  const { appel, affaire, fiche, cloturer } = outils(request, session.token);
  await verifierReglages(appel);
  const suffixe = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const client = await creerClient(`lot V annulée ${suffixe}`);
  const pose: Ligne[] = [{ designation: 'Pose', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 }];
  const annulee = await affaire(`TEST Lot V affaire annulée ${suffixe}`, client.id, pose);
  const terminee = (await affaire(`TEST Lot V chantier terminé ${suffixe}`, client.id, pose)).chantier;
  const jour = dateDuJour();
  const motif = `Motif E2E du lot V ${suffixe}`;
  // Date de fin saisie pendant que l'affaire était en cours (#392, N10 du contrôle de #483) : l'annulation ne l'efface pas.
  await appel('patch', `/chantiers/${annulee.chantier.id}`, { dateFin: jour });
  await appel('post', `/devis/${annulee.devis.id}/annulation`, { motif });
  expect((await cloturer(terminee.id)).ok()).toBeTruthy();
  const lue = await fiche(annulee.chantier.id);
  expect([lue.statut, lue.motifAnnulation, lue.dateFin?.slice(0, 10)]).toEqual(['ANNULE', motif, `${jour.slice(6)}-${jour.slice(3, 5)}-${jour.slice(0, 2)}`]);
  expect(lue.annuleLe, 'instant d’annulation enregistré').toBeTruthy();
  const temoin = await fiche(terminee.id);
  expect([temoin.statut, temoin.numeroDevis === null]).toEqual(['TERMINE', false]);

  // Session de l'administration, navigateur en anglais, au fuseau de New York (UTC-5) : le jour d'annulation se lit au fuseau
  // de la société (Europe/Paris), et non à celui du navigateur.
  const page = await connexion('SA', { timezoneId: 'America/New_York' });
  await page.goto(`/chantiers/${annulee.chantier.id}`, { waitUntil: 'networkidle' });
  await navigateurEnAnglais(page);
  const entete = enTete(page, lue.nom);
  const badge = entete.getByText('Annulé', { exact: true });
  // Badge « Annulé », gris (choix N4 de #490, gardé), sans pastille rouge ; jamais le code.
  await expect(badge).toBeVisible();
  await expect(badge).toHaveClass(classe('bg-gray-100'));
  await expect(badge).not.toHaveClass(ROUGE);
  await expect(entete).not.toContainText('ANNULE');
  // « Démarré le JJ-MM-AAAA — annulé avec son devis le JJ-MM-AAAA : motif ». Lectures écartées : « — terminé le … (0 j) », le
  // texte d'avant le lot pour une affaire annulée qui porte une date de fin ; « (il y a … j) » ; un motif omis.
  const dates = entete.locator('span', { hasText: 'Démarré le' });
  await expect(dates).toHaveText(`Démarré le ${jour} — annulé avec son devis le ${jour} : ${motif}`);
  await expect(dates).not.toHaveClass(ROUGE);
  await expect(entete).not.toContainText('terminé le');
  await expect(entete).not.toContainText(/\(\d+ j\)|il y a/);
  // Référence de l'affaire, et ni « Devis: » ni « N/A ».
  await expect(entete).toContainText(`Référence de l'affaire : ${lue.numeroDevis}`);
  await expect(entete).not.toContainText('Devis:');
  await expect(entete).not.toContainText('N/A');

  // Instant d'annulation proche de minuit (injecté dans la réponse, affichage seul) : 20-11-2026 à 23:30 UTC, soit le 21-11-2026
  // à 00:30 à Paris. Attendu « le 21-11-2026 ». Lecture écartée : « le 20-11-2026 », jour UTC ou jour du navigateur (18:30 à
  // New York). Sans motif enregistré, la phrase s'arrête à la date, sans « : ».
  let remplacement: Partial<Fiche> = { annuleLe: '2026-11-20T23:30:00.000Z' };
  await page.route((url) => url.pathname === `/api/chantiers/${annulee.chantier.id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const reponse = await route.fetch();
    await route.fulfill({ response: reponse, json: { ...(await reponse.json()), ...remplacement } });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(dates).toHaveText(`Démarré le ${jour} — annulé avec son devis le 21-11-2026 : ${motif}`);
  remplacement = { motifAnnulation: null };
  await page.reload({ waitUntil: 'networkidle' });
  await expect(dates).toHaveText(`Démarré le ${jour} — annulé avec son devis le ${jour}`);
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // Témoin : un chantier terminé garde « terminé le JJ-MM-AAAA (0 j) », son badge « Terminé » et sa référence.
  await page.goto(`/chantiers/${terminee.id}`, { waitUntil: 'networkidle' });
  const enteteTermine = enTete(page, temoin.nom);
  await expect(enteteTermine.getByText('Terminé', { exact: true })).toBeVisible();
  await expect(enteteTermine.locator('span', { hasText: 'Démarré le' })).toHaveText(`Démarré le ${jour} — terminé le ${jour} (0 j)`);
  await expect(enteteTermine).toContainText(`Référence de l'affaire : ${temoin.numeroDevis}`);
});
