import { randomInt } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, choisirClient, dateDuJour, horsDuPassageDeMinuit } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot « Assistante technique », PR AT-4 : repère « déjà facturée » du formulaire « Nouveau brouillon » (cadrage AT-4, version 2,
// § 2, section « Tests », puce « E2E » : « l'avertissement s'affiche sur une affaire déjà facturée par l'administration, et pas
// sur une affaire dont la seule facture est annulée » ; critère 5 ; N4 du contrôle de mode 1 : un texte qui nomme l'origine).
// Décisions de Nelson du 09-11-2026, mot pour mot : « Oui il faut un repere deja facturer, » ; réponse 2, « Toute facture non
// annulée (Recommandé) » : « Brouillon, émise ou réglée : le repère s'affiche dès qu'une facture vivante existe sur l'origine. Une
// facture annulée par son avoir total ne compte plus. Le repère s'affiche aussi pour l'administration. » ; réponse 3, « Même
// origine seulement (Recommandé) ».
//
// Parcours dans Chromium, libellés français :
//  1. l'administration facture l'affaire A, une intervention et un contrat du client ; elle facture l'affaire B puis annule cette
//     facture par son avoir total ; l'affaire C n'a pas de facture ;
//  2. l'assistante technique ouvre « Nouveau brouillon », choisit le client, puis l'affaire A : l'avertissement « Cette affaire a
//     déjà une facture non annulée : vérifiez avant d’en créer une autre. » s'affiche, sans numéro ni montant ; l'affaire B et
//     l'affaire C : rien ; l'intervention et le contrat facturés : le texte qui les nomme ;
//  3. l'avertissement ne bloque rien : elle crée le brouillon de l'affaire A ;
//  4. l'administration voit le même avertissement sur l'affaire A, et rien sur l'affaire B.

const TEXTES = {
  CHANTIER: 'Cette affaire a déjà une facture non annulée : vérifiez avant d’en créer une autre.',
  INTERVENTION: 'Cette intervention a déjà une facture non annulée : vérifiez avant d’en créer une autre.',
  CONTRAT: 'Ce contrat a déjà une facture non annulée : vérifiez avant d’en créer une autre.',
};
const CHAMPS = { CHANTIER: 'chantierId', INTERVENTION: 'interventionId', CONTRAT: 'contratMaintenanceId' } as const;
type Origine = keyof typeof CHAMPS;

// Choisit une origine dans le formulaire et attend la réponse du repère pour elle : un avertissement absent n'est constaté
// qu'après cette réponse.
async function choisirOrigine(page: Page, origine: Origine, id: string) {
  await page.locator('select[name="origine"]').selectOption(origine);
  const rattachement = page.locator(`select[name="${CHAMPS[origine]}"]`);
  await expect(rattachement.locator(`option[value="${id}"]`)).toHaveCount(1);
  const reponse = page.waitForResponse((r) => {
    const url = new URL(r.url());
    return url.pathname === '/api/factures/deja-facturee' && url.searchParams.get('origine') === origine && url.searchParams.get('id') === id;
  });
  await rattachement.selectOption(id);
  const lue = await reponse;
  expect(lue.status(), `repère ${origine} ${id}`).toBe(200);
  return (await lue.json()) as { dejaFacturee: boolean };
}
const repere = (page: Page) => page.getByRole('status', { name: 'Origine déjà facturée' });

test('repère « déjà facturée » : avertissement, sans numéro ni montant, pour l’assistante technique sur une affaire, une intervention et un contrat facturés par l’administration ; rien sur une affaire dont la seule facture est annulée ni sur une affaire sans facture ; la création reste possible ; le même avertissement pour l’administration', async ({ connexion, allerSurPageAdmin, request, session, creerClient }) => {
  test.slow();
  await horsDuPassageDeMinuit();
  const headers = { Authorization: `Bearer ${session.token}` };
  const envoyer = async <T>(path: string, data: object = {}) => {
    const reponse = await request.post(`${api}${path}`, { headers, data });
    expect(reponse.ok(), `${path} : ${await reponse.text()}`).toBeTruthy();
    return reponse.json() as Promise<T>;
  };
  const suffixe = `${Date.now()}-${randomInt(1_000_000)}`;
  const client = await creerClient(`repère déjà facturée ${suffixe}`);
  const affaire = async (objet: string) => {
    const devis = await envoyer<{ id: string }>('/devis', { clientId: client.id, objet: `${objet} ${suffixe}`, lignes: [{ designation: 'Pose', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 }] });
    await envoyer(`/devis/${devis.id}/signature`, { signataire: 'Client E2E', confirme: true });
    return envoyer<{ id: string }>(`/devis/${devis.id}/convertir`, { cible: 'CHANTIER' });
  };
  const facturer = async (origine: Origine, id: string) => {
    const brouillon = await envoyer<{ id: string }>('/factures', { clientId: client.id, origine, [CHAMPS[origine]]: id, dateEmission: dateDuJour(), dateEcheance: dateDuJour(), lignes: [{ designation: `Facture ${origine} ${suffixe}`, quantite: 1, prixUnitaireHt: 432.1, tauxTva: 20 }] });
    return envoyer<{ id: string; numero: string }>(`/factures/${brouillon.id}/emettre`);
  };
  const affaireA = await affaire('Affaire facturée');
  const affaireB = await affaire('Affaire dont la facture est annulée');
  const affaireC = await affaire('Affaire sans facture');
  const factureA = await facturer('CHANTIER', affaireA.id);
  const factureB = await facturer('CHANTIER', affaireB.id);
  await envoyer(`/factures/${factureB.id}/annuler`);
  const intervention = await envoyer<{ id: string }>('/interventions', { clientId: client.id, titre: `Intervention facturée ${suffixe}` });
  await facturer('INTERVENTION', intervention.id);
  const contrat = await envoyer<{ id: string }>('/contrats-maintenance', { clientId: client.id, titre: `Contrat facturé ${suffixe}`, periodiciteMois: 12, dureePrevisionnelleMinutes: 60, dateDebut: '01-01-2026' });
  await facturer('CONTRAT', contrat.id);
  const assistante = await envoyer<{ id: string; name: string }>('/users', { email: `at4.repere.${suffixe}@iris.test`, name: `Assistante technique repère ${suffixe}`, role: 'ASSISTANTE_TECHNIQUE' });

  // 2. L'assistante technique.
  const page = await connexion(assistante);
  const erreursPage: string[] = [];
  page.on('pageerror', (erreur) => erreursPage.push(erreur.message));
  await page.goto('/factures', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Nouvelle facture/ }).click();
  await expect(page.getByRole('heading', { name: 'Nouveau brouillon' })).toBeVisible();
  await choisirClient(page, client);
  expect(await choisirOrigine(page, 'CHANTIER', affaireA.id)).toEqual({ dejaFacturee: true });
  await expect(repere(page)).toHaveText(TEXTES.CHANTIER);
  await expect(repere(page)).not.toContainText(factureA.numero);
  await expect(repere(page)).not.toContainText('€');
  // Affaire dont la seule facture est annulée, puis affaire sans facture : rien.
  expect(await choisirOrigine(page, 'CHANTIER', affaireB.id)).toEqual({ dejaFacturee: false });
  await expect(repere(page)).toHaveCount(0);
  expect(await choisirOrigine(page, 'CHANTIER', affaireC.id)).toEqual({ dejaFacturee: false });
  await expect(repere(page)).toHaveCount(0);
  // L'intervention et le contrat facturés : le texte nomme l'origine.
  expect(await choisirOrigine(page, 'INTERVENTION', intervention.id)).toEqual({ dejaFacturee: true });
  await expect(repere(page)).toHaveText(TEXTES.INTERVENTION);
  expect(await choisirOrigine(page, 'CONTRAT', contrat.id)).toEqual({ dejaFacturee: true });
  await expect(repere(page)).toHaveText(TEXTES.CONTRAT);
  // Hors affaire : aucune origine, aucun avertissement.
  await page.locator('select[name="origine"]').selectOption('HORS_AFFAIRE');
  await expect(repere(page)).toHaveCount(0);

  // 3. Non bloquant : elle crée le brouillon de l'affaire A, l'avertissement affiché.
  expect(await choisirOrigine(page, 'CHANTIER', affaireA.id)).toEqual({ dejaFacturee: true });
  await expect(repere(page)).toHaveText(TEXTES.CHANTIER);
  await page.getByRole('textbox', { name: 'Désignation ligne 1' }).fill('Situation complémentaire');
  await page.getByRole('textbox', { name: 'Prix unitaire HT ligne 1' }).fill('150');
  const creation = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/factures' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
  const reponseCreation = await creation;
  expect(reponseCreation.status()).toBe(201);
  const brouillon = await reponseCreation.json() as { origine: string; chantierId: string; creeParType: string; statut: string };
  expect([brouillon.origine, brouillon.chantierId, brouillon.creeParType, brouillon.statut]).toEqual(['CHANTIER', affaireA.id, 'ASSISTANTE_TECHNIQUE', 'BROUILLON']);
  await expect(page.getByText(/Brouillon créé/)).toBeVisible();
  expect(erreursPage, 'aucune erreur de la page').toEqual([]);

  // 4. L'administration : le même avertissement sur l'affaire A, rien sur l'affaire B.
  const pageAdmin = await allerSurPageAdmin('/factures');
  await pageAdmin.getByRole('button', { name: /Nouvelle facture/ }).click();
  await choisirClient(pageAdmin, client);
  expect(await choisirOrigine(pageAdmin, 'CHANTIER', affaireA.id)).toEqual({ dejaFacturee: true });
  await expect(repere(pageAdmin)).toHaveText(TEXTES.CHANTIER);
  expect(await choisirOrigine(pageAdmin, 'CHANTIER', affaireB.id)).toEqual({ dejaFacturee: false });
  await expect(repere(pageAdmin)).toHaveCount(0);
});
