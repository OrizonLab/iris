import { test, expect, dateDuJour, jetonPour } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot « marge d'un contrat de maintenance, heures valorisées au prix sous contrat » (cadrage v3, § 4 « Écran Contrats de
// maintenance » ; décisions de Nelson du 27-10-2026, « Oui prix du catalogue, continue », et du 15-11-2026 : « Celle de
// l'intervenant », « Figé à la saisie », « Par contrat », « Selon la politique », « Coût gardé, signalée », « Coût
// seul »). L'administration voit, sur l'écran des contrats, la marge d'un contrat depuis son début ; l'assistante
// technique, qui ouvre cet écran, ne voit pas le bouton (choix par défaut, à confirmer).

test('l’administration voit la marge d’un contrat au prix sous contrat, son détail et ses signalements ; l’assistante technique ne voit pas le bouton', async ({ session, request, creerClient, allerSurPageAdmin, connexion }) => {
  const envoyer = async (methode: 'post' | 'put' | 'patch', path: string, data?: object, auth = session.token) => {
    const response = await request[methode](`${api}${path}`, { headers: { Authorization: `Bearer ${auth}` }, data });
    expect(response.ok(), `${path} : ${await response.text()}`).toBeTruthy();
    return response.json();
  };
  const suffixe = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  // Prix hors contrat (52,30 €) et sous contrat (43,70 €) distincts : une inversion des deux tarifs se verrait.
  const mainOeuvre = await envoyer('post', '/catalogue/prestations', {
    estMainOeuvre: true, reference: `E2E-MC-${suffixe}`, nom: `Frigoriste E2E ${suffixe}`, tauxTva: '20',
    prixVenteHt: '52.30', prixJourHorsContratHt: '300', prixHeureSousContratHt: '43.70', prixJourSousContratHt: '280', heuresParJour: '7',
  }) as { id: string };
  const technicien = async (libelle: string, tauxHoraireCharge: number, rattache: boolean) => {
    const compte = await envoyer('post', '/users', { email: `marge-contrat-${libelle}.${suffixe}@iris.test`, name: `Technicien ${libelle} ${suffixe}`, role: 'TECHNICIEN' }) as { id: string };
    const fiche = await envoyer('post', '/intervenants', { nom: `Fiche ${libelle} ${suffixe}`, role: 'Technicien', tauxHoraireCharge }) as { id: string; nom: string };
    await envoyer('put', `/intervenants/${fiche.id}/compte`, { userId: compte.id });
    if (rattache) await envoyer('put', `/intervenants/${fiche.id}/main-oeuvre`, { mainOeuvreId: mainOeuvre.id });
    return { compte, fiche };
  };
  const avecMainOeuvre = await technicien('avec-mo', 25, true);
  const sansMainOeuvre = await technicien('sans-mo', 20, false);
  const client = await creerClient(`Marge contrat ${suffixe}`, false);
  const titre = `Contrat marge E2E ${suffixe}`;
  const contrat = await envoyer('post', '/contrats-maintenance', {
    clientId: client.id, titre, periodiciteMois: 12, dureePrevisionnelleMinutes: 90, dateDebut: '01-01-2026', politiqueMainOeuvre: 'HORS_FORFAIT', politiqueMateriel: 'INCLUS',
  }) as { id: string };
  const visite = await envoyer('post', `/contrats-maintenance/${contrat.id}/generer-intervention`) as { id: string };
  const jour = dateDuJour();
  const jourIso = jour.split('-').reverse().join('-');
  const planifier = (id: string, heureDebut: string, heureFin: string, intervenantIds: string[]) => envoyer('put', `/interventions/${id}/planning`, { dateDebut: jourIso, creneau: 'HEURES', heureDebut, heureFin, intervenantIds });
  await planifier(visite.id, '08:30', '11:30', [avecMainOeuvre.fiche.id, sansMainOeuvre.fiche.id]);
  await envoyer('post', `/interventions/${visite.id}/couts/heures`, { date: jour, nbrHeures: 3 }, jetonPour(avecMainOeuvre.compte.id));
  await envoyer('post', `/interventions/${visite.id}/couts/heures`, { date: jour, nbrHeures: 0.5 }, jetonPour(sansMainOeuvre.compte.id));
  const fournisseur = await envoyer('post', '/fournisseurs', { nom: `Fournisseur marge contrat ${suffixe}` }) as { id: string };
  await envoyer('post', `/interventions/${visite.id}/couts/achats`, { date: jour, description: 'Filtres déshydrateurs', montantHT: '12.50', fournisseurId: fournisseur.id });
  // Une suite de la visite, travaillée puis annulée : ses heures comptent au coût, sans être vendues.
  const suite = await envoyer('post', `/interventions/${visite.id}/suites`, {}) as { id: string };
  await planifier(suite.id, '14:00', '14:30', [avecMainOeuvre.fiche.id]);
  await envoyer('post', `/interventions/${suite.id}/couts/heures`, { date: jour, nbrHeures: 0.5 }, jetonPour(avecMainOeuvre.compte.id));
  await envoyer('patch', `/interventions/${suite.id}/statut`, { statut: 'ANNULEE', motif: 'Client injoignable, suite abandonnée' });

  const page = await allerSurPageAdmin('/contrats-maintenance');
  const carte = page.locator('article').filter({ has: page.getByRole('heading', { name: titre }) });
  await expect(carte).toContainText('Début : 01-01-2026');
  const lecture = page.waitForResponse((r) => r.url().endsWith(`/api/contrats-maintenance/${contrat.id}/marge`) && r.request().method() === 'GET');
  await carte.getByRole('button', { name: `Voir la marge du contrat ${titre}` }).click();
  expect((await lecture).status()).toBe(200);
  const detail = page.getByTestId(`marge-contrat-detail-${contrat.id}`);
  // Ventes : 3 h × 43,70 € = 131,10 € (au prix hors contrat, 156,90 €) ; coûts : 3 h × 25 € + 0,5 h × 20 € + 0,5 h × 25 €
  // (suite annulée) = 97,50 € ; matériel inclus 12,50 € ; marge 131,10 − 97,50 − 12,50 = 21,10 €.
  await expect(detail).toContainText(/Marge à l’heure : 21,10\s€ HT/);
  await expect(detail).toContainText(/Heures des 2 interventions du contrat, depuis son début, vendues 131,10\s€ HT au prix sous contrat des mains d’œuvre, moins leur coût de 97,50\s€ HT et le matériel inclus au contrat, à son coût de 12,50\s€ HT\./);
  const notes = detail.getByRole('note');
  await expect(notes).toHaveCount(2);
  await expect(notes.nth(0)).toHaveText(`Marge incomplète : 0,5 h sans prix de vente (${sansMainOeuvre.fiche.nom}). Une heure d’un intervenant sans main d’œuvre le jour de la saisie, ou saisie avant la valorisation sous contrat, n’est pas vendue ; son coût reste compté.`);
  await expect(notes.nth(1)).toHaveText('Les heures des interventions annulées (0,5 h) comptent dans le coût, sans être vendues.');
  // Aucun code de politique ni texte de facturation à l'écran de la marge.
  await expect(detail).not.toContainText(/HORS_FORFAIT|INCLUS\b|factur/);

  // L'assistante technique ouvre l'écran des contrats et voit la carte du contrat, sans le bouton ; la route lui répond 403.
  const assistante = await envoyer('post', '/users', { email: `marge-contrat-at.${suffixe}@iris.test`, name: `Assistante technique marge ${suffixe}`, role: 'ASSISTANTE_TECHNIQUE' }) as { id: string };
  const pageAssistante = await connexion(assistante);
  await pageAssistante.goto('/contrats-maintenance', { waitUntil: 'networkidle' });
  const carteAssistante = pageAssistante.locator('article').filter({ has: pageAssistante.getByRole('heading', { name: titre }) });
  await expect(carteAssistante).toBeVisible();
  await expect(pageAssistante.getByTestId(`pdf-contrat-${contrat.id}`)).toBeVisible();
  await expect(pageAssistante.getByTestId(`marge-contrat-${contrat.id}`)).toHaveCount(0);
  await expect(carteAssistante.getByRole('button', { name: /Voir la marge/ })).toHaveCount(0);
  await expect(carteAssistante).not.toContainText('Marge à l’heure');
  const refus = await request.get(`${api}/contrats-maintenance/${contrat.id}/marge`, { headers: { Authorization: `Bearer ${jetonPour(assistante.id)}` } });
  expect(refus.status()).toBe(403);
});
