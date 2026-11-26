import { test, expect } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '3001'}/api`;

// #181 (lot D0) : la réattribution du titulaire et du commercial, et la case « Encaissé », se lisent
// au journal d'audit de la fiche chantier, avec l'auteur, l'avant et l'après.
// Lot AG-b (décision de Nelson du 26-11-2026, « 1. A ») : la clôture et la réouverture aussi, titre « Statut — changement »,
// statut en toutes lettres et date de fin au format JJ-MM-AAAA (« Terminé, date de fin 26-11-2026 », « En cours »).
test('titulaire, commercial, encaissement et statut (clôture, réouverture) changés se lisent au journal de la fiche', async ({ allerSurPageAdmin, creerClient, request, session, page: pageAdmin }) => {
  test.slow();
  const headers = { Authorization: `Bearer ${session.token}` };
  const envoyer = async (methode: 'post' | 'put' | 'patch', path: string, data: object) => {
    const reponse = await request[methode](`${api}${path}`, { headers, data });
    expect(reponse.ok(), `${path} : ${await reponse.text()}`).toBeTruthy();
    return reponse.json();
  };
  const suffixe = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const client = await creerClient('journal-181');
  const devis = await envoyer('post', '/devis', { clientId: client.id, objet: `Journal 181 ${suffixe.replace('.', ' ')}`, lignes: [
    { designation: 'Pose', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 },
  ] }) as { id: string };
  await envoyer('put', `/devis/${devis.id}/statut`, { statut: 'ENVOYE' });
  await envoyer('post', `/devis/${devis.id}/signature`, { signataire: 'Client E2E', confirme: true });
  const chantier = await envoyer('post', `/devis/${devis.id}/convertir`, { cible: 'CHANTIER' }) as { id: string; nom: string };
  const compte = async (cle: string, nom: string, role: string) => envoyer('post', '/users', { email: `j181.${cle}.${suffixe}@iris.test`, name: `${nom} ${suffixe}`, role }) as Promise<{ id: string; name: string }>;
  const premier = await compte('premier', 'Conducteur premier 181', 'CONDUCTEUR_TRAVAUX');
  const second = await compte('second', 'Conducteur second 181', 'CONDUCTEUR_TRAVAUX');
  const commercial = await compte('commercial', 'Commercial 181', 'COMMERCIAL');
  await envoyer('patch', `/chantiers/${chantier.id}`, { responsableId: premier.id });
  await envoyer('patch', `/chantiers/${chantier.id}/commercial`, { commercialId: commercial.id });

  const fenetres: string[] = [];
  pageAdmin.on('dialog', (dialogue) => { fenetres.push(`${dialogue.type()} : ${dialogue.message()}`); void dialogue.dismiss(); });
  const page = await allerSurPageAdmin(`/chantiers/${chantier.id}`);
  const journal = page.getByRole('region', { name: 'Journal d’audit des saisies' });
  const auteur = (session.user as { name: string }).name;
  const titulaires = journal.locator('div.px-6.py-4', { has: page.getByText('Titulaire — réattribution', { exact: true }) });
  await expect(titulaires).toHaveCount(1);
  await expect(titulaires.first()).toContainText('Avant : aucun titulaire');
  await expect(titulaires.first()).toContainText(`Après : ${premier.name}`);
  await expect(titulaires.first()).toContainText(` · ${auteur}`);
  const commerciaux = journal.locator('div.px-6.py-4', { has: page.getByText('Commercial — réattribution', { exact: true }) });
  await expect(commerciaux).toHaveCount(1);
  await expect(commerciaux.first()).toContainText('Avant : aucun commercial');
  await expect(commerciaux.first()).toContainText(`Après : ${commercial.name}`);
  await expect(commerciaux.first()).toContainText(` · ${auteur}`);

  // Réattribution depuis la fiche : une nouvelle entrée, la plus récente en tête.
  await page.getByRole('button', { name: 'Modifier', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Modifier le chantier' })).toBeVisible();
  await page.locator('select[name="responsableId"]').selectOption(second.id);
  const enregistrement = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith(`/api/chantiers/${chantier.id}`));
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  expect((await enregistrement).status()).toBe(200);
  await expect(titulaires).toHaveCount(2);
  await expect(titulaires.first()).toContainText(`Avant : ${premier.name}`);
  await expect(titulaires.first()).toContainText(`Après : ${second.name}`);

  // Lot AG-b (décision de Nelson du 26-11-2026, « 1. A ») : la clôture s'inscrit au journal de la fiche, titre « Statut —
  // changement », chaque côté lisible en français, la date de fin au format JJ-MM-AAAA (cadrage, critères). Aucune entrée
  // de statut avant la clôture.
  const statuts = journal.locator('div.px-6.py-4', { has: page.getByText('Statut — changement', { exact: true }) });
  await expect(statuts).toHaveCount(0);
  await expect(journal.getByText('Historique immuable des créations, corrections et archivages du chantier, de sa clôture et de sa réouverture, et des changements de son client, de son titulaire, de son commercial et de son encaissement.', { exact: true })).toBeVisible();

  // Encaissement d'un chantier terminé : coché puis décoché, deux entrées.
  const clos = await envoyer('patch', `/chantiers/${chantier.id}/statut`, { statut: 'TERMINE' }) as { statut: string; dateFin: string };
  expect(clos.statut).toBe('TERMINE');
  // Date de fin posée par la clôture (date-seule, minuit UTC), lue comme l'écran doit l'écrire : JJ-MM-AAAA, jamais l'ISO.
  const [annee, mois, jour] = clos.dateFin.slice(0, 10).split('-');
  const dateFin = `${jour}-${mois}-${annee}`;
  await page.reload({ waitUntil: 'networkidle' });
  await expect(statuts).toHaveCount(1);
  await expect(statuts.first().getByText('Avant : En cours', { exact: true })).toBeVisible();
  await expect(statuts.first().getByText(`Après : Terminé, date de fin ${dateFin}`, { exact: true })).toBeVisible();
  await expect(statuts.first()).toContainText(` · ${auteur}`);
  await expect(statuts.first()).not.toContainText(clos.dateFin.slice(0, 10));
  await expect(statuts.first()).not.toContainText('TERMINE');
  const encaissements = journal.locator('div.px-6.py-4', { has: page.getByText('Encaissement — changement', { exact: true }) });
  await expect(encaissements).toHaveCount(0);
  await page.getByRole('button', { name: 'Non encaissé', exact: true }).click();
  await expect(page.getByRole('button', { name: '✓ Encaissé', exact: true })).toBeVisible();
  await expect(encaissements).toHaveCount(1);
  await expect(encaissements.first()).toContainText('Avant : Non encaissé');
  await expect(encaissements.first()).toContainText('Après : Encaissé');
  await expect(encaissements.first()).toContainText(` · ${auteur}`);
  await page.getByRole('button', { name: '✓ Encaissé', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Non encaissé', exact: true })).toBeVisible();
  await expect(encaissements).toHaveCount(2);
  await expect(encaissements.first()).toContainText('Avant : Encaissé');

  // Lot AG-b : la réouverture par l'administration s'inscrit aussi, la plus récente en tête ; la date de fin, gardée par la
  // réouverture, se lit des deux côtés.
  const rouvert = await envoyer('patch', `/chantiers/${chantier.id}/statut`, { statut: 'EN_COURS' }) as { statut: string; dateFin: string };
  expect([rouvert.statut, rouvert.dateFin]).toEqual(['EN_COURS', clos.dateFin]);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(statuts).toHaveCount(2);
  await expect(statuts.first().getByText(`Avant : Terminé, date de fin ${dateFin}`, { exact: true })).toBeVisible();
  await expect(statuts.first().getByText(`Après : En cours, date de fin ${dateFin}`, { exact: true })).toBeVisible();
  await expect(statuts.first()).toContainText(` · ${auteur}`);
  await expect(statuts.nth(1).getByText(`Après : Terminé, date de fin ${dateFin}`, { exact: true })).toBeVisible();
  expect(fenetres).toEqual([]);
});
