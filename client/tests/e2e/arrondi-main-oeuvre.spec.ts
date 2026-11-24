import type { APIRequestContext } from '@playwright/test';
import { test, expect, dateDuJour, horsDuPassageDeMinuit, jetonPour } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// Lot AB : coût de la main-d'œuvre arrondi au centime ligne par ligne, partout (réponse de Nelson du 24-11-2026 à 14:24:51 UTC,
// point 2, mot pour mot : « Arrindir chaque ligne » ; lecture retenue : la réponse 1, « Arrondir chaque ligne au centime, puis
// additionner (132,47 €) »). Cadrage v2 du lot AB, « Tests » : « E2E : fiche d'un chantier avec une suite à 3,25 h et 0,25 h à
// 37,85 €/h, détail « main-d’œuvre 132,47 € » (aujourd'hui « 132,48 € ») ». Règle 2 de la méthode : le lot change des montants
// (classé C).
//
// L'écran ne calcule rien : il affiche au centime (fmtEuroCentime) le coût que le serveur envoie dans metrics.coutsSuites et
// metrics.coutsInterventionDevis. Avant le lot, le serveur envoyait la somme exacte, 132,475 €, que l'écran arrondissait à
// l'affichage : « 132,48 € ». Le parcours prouve, dans un vrai navigateur, que le détail de la fiche dit désormais la somme des
// lignes arrondies, et qu'il est égal à la main-d'œuvre cumulée affichée sur la suite elle-même (lecture L2 du cadrage : la
// main-d'œuvre cumulée d'une suite est égale à sa part dans la marge du chantier).

const entete = (token: string) => ({ Authorization: `Bearer ${token}` });
async function envoyer(request: APIRequestContext, token: string, methode: 'post' | 'put' | 'patch', chemin: string, data?: object) {
  const reponse = await request[methode](`${api}${chemin}`, { headers: entete(token), data });
  expect(reponse.ok(), `${chemin} : ${await reponse.text()}`).toBeTruthy();
  return reponse.json();
}

// Montants attendus, au format français (espace insécable avant « € ») : 3,25 h × 37,85 € = 123,0125 € → 123,01 € ;
// 0,25 h × 37,85 € = 9,4625 € → 9,46 € ; total 132,47 €. Lectures écartées : « 132,48 € » (somme exacte 132,475 € arrondie à
// l'affichage, avant le lot) ; « 132,49 € » (arrondi par excès de chaque ligne : 123,02 + 9,47).
test('fiche chantier : la suite à 3,25 h et 0,25 h à 37,85 € affiche « main-d’œuvre 132,47 € », comme sa main-d’œuvre cumulée ; l’intervention issue du devis, aux mêmes heures, aussi', async ({ session, request, creerClient, allerSurPageAdmin }) => {
  await horsDuPassageDeMinuit();
  const suffixe = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const token = session.token;
  // Technicien relié à sa fiche, au taux chargé de 37,85 € : le taux est copié sur chaque heure qu'il saisit.
  const technicien = await envoyer(request, token, 'post', '/users', { email: `arrondi-ab.${suffixe}@iris.test`, name: `Technicien lot AB ${suffixe}`, role: 'TECHNICIEN' }) as { id: string };
  const fiche = await envoyer(request, token, 'post', '/intervenants', { nom: `Fiche lot AB ${suffixe}`, role: 'Technicien', tauxHoraireCharge: 37.85 }) as { id: string };
  await envoyer(request, token, 'put', `/intervenants/${fiche.id}/compte`, { userId: technicien.id });
  const client = await creerClient(`arrondi-main-oeuvre ${suffixe}`);
  // Devis signé, converti en chantier puis en intervention : l'intervention naît rattachée au chantier et compte comme son
  // travail (décision du 27-10-2026) ; sa suite compte comme une suite.
  const devis = await envoyer(request, token, 'post', '/devis', { clientId: client.id, objet: `Affaire lot AB ${suffixe}`, lignes: [
    { designation: 'Pose', nature: 'MAIN_OEUVRE', quantite: 10, prixUnitaireHt: 100, tauxTva: 20 },
  ] }) as { id: string };
  await envoyer(request, token, 'put', `/devis/${devis.id}/statut`, { statut: 'ENVOYE' });
  await envoyer(request, token, 'post', `/devis/${devis.id}/signature`, { signataire: 'Client E2E', confirme: true });
  const chantier = await envoyer(request, token, 'post', `/devis/${devis.id}/convertir`, { cible: 'CHANTIER' }) as { id: string };
  const intervention = await envoyer(request, token, 'post', `/devis/${devis.id}/convertir`, { cible: 'INTERVENTION' }) as { id: string; chantierId: string | null };
  expect(intervention.chantierId).toBe(chantier.id);
  const suite = await envoyer(request, token, 'post', `/interventions/${intervention.id}/suites`, {}) as { id: string; reference: string };
  // Chacune placée avec le technicien, qui y déclare 3,25 h puis 0,25 h.
  const jour = dateDuJour();
  const jourIso = jour.split('-').reverse().join('-');
  for (const id of [intervention.id, suite.id]) {
    await envoyer(request, token, 'put', `/interventions/${id}/planning`, { dateDebut: jourIso, creneau: 'HEURES', heureDebut: '08:30', heureFin: '09:30', intervenantIds: [fiche.id] });
    for (const nbrHeures of ['3,25', '0,25']) await envoyer(request, jetonPour(technicien.id), 'post', `/interventions/${id}/couts/heures`, { date: jour, nbrHeures });
  }

  const page = await allerSurPageAdmin(`/chantiers/${chantier.id}`);
  await expect(page.locator('[data-couts-intervention-devis]')).toHaveText(/^Dont l’intervention issue du devis du chantier, comptée comme son travail : 3,5 h dans les heures réalisées · main-d’œuvre 132,47\s€\.$/);
  await expect(page.locator('[data-couts-suites]')).toHaveText(/^Dont suites SAV de l’affaire, comptées dans le réel : matériel 0,00\s€ · main-d’œuvre 132,47\s€\. Heures des suites SAV de l’affaire, hors des heures réalisées : 3,5 h\.$/);
  await expect(page.getByText(/132,48\s€/)).toHaveCount(0);

  // La suite elle-même : sa main-d'œuvre cumulée, arrondie ligne par ligne depuis toujours, dit le même montant.
  await page.goto(`/interventions/${suite.id}`, { waitUntil: 'networkidle' });
  const carteSuite = page.locator('article', { hasText: suite.reference });
  await expect(carteSuite.getByText(/^Main-d’œuvre cumulée : 132,47\s€ HT$/)).toBeVisible();
});
