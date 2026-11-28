import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changementAffaire, clientLisible, titreEntreeJournal } from '../src/lib/journalChantier.ts';

test('titre des entrées : saisies Travaux et changement de client', () => {
  assert.equal(titreEntreeJournal({ cible: 'ACHAT', action: 'CORRECTION' }), 'Achat — correction');
  assert.equal(titreEntreeJournal({ cible: 'HEURE', action: 'ARCHIVAGE' }), 'Heures — archivage');
  assert.equal(titreEntreeJournal({ cible: 'CHANTIER', action: 'CHANGEMENT_CLIENT' }), 'Client de l’affaire — changement');
  assert.notEqual(changementAffaire({ cible: 'CHANTIER', action: 'CHANGEMENT_CLIENT' }), null);
  assert.equal(changementAffaire({ cible: 'ACHAT', action: 'CHANGEMENT_CLIENT' }), null);
  assert.equal(changementAffaire({ cible: 'CHANTIER', action: 'CORRECTION' }), null);
});

test('un côté du changement : la fiche, et le libellé de l’affaire s’il en diffère', () => {
  assert.equal(clientLisible({ clientId: 'a', raisonSociale: 'Société A', libelle: 'Société A' }), 'Société A');
  assert.equal(clientLisible({ clientId: 'a', raisonSociale: 'Société A', libelle: 'Ancien nom' }), 'Société A (libellé de l’affaire : « Ancien nom »)');
  assert.equal(clientLisible({ clientId: null, raisonSociale: null, libelle: 'Libellé libre' }), 'aucune fiche client liée (libellé de l’affaire : « Libellé libre »)');
  assert.equal(clientLisible(null), 'aucune fiche client liée');
});

// #181 : réattributions du titulaire et du commercial, et case « Encaissé », au journal de la fiche.
test('les changements de titulaire, de commercial et d’encaissement se lisent des deux côtés', () => {
  assert.equal(titreEntreeJournal({ cible: 'CHANTIER', action: 'CHANGEMENT_TITULAIRE' }), 'Titulaire — réattribution');
  assert.equal(titreEntreeJournal({ cible: 'CHANTIER', action: 'CHANGEMENT_COMMERCIAL' }), 'Commercial — réattribution');
  assert.equal(titreEntreeJournal({ cible: 'CHANTIER', action: 'CHANGEMENT_ENCAISSEMENT' }), 'Encaissement — changement');
  assert.deepEqual(changementAffaire({ cible: 'CHANTIER', action: 'CHANGEMENT_TITULAIRE', avant: { responsableId: 'a', nom: 'Alice' }, apres: { responsableId: 'b', nom: 'Bruno' } }), { avant: 'Alice', apres: 'Bruno' });
  assert.deepEqual(changementAffaire({ cible: 'CHANTIER', action: 'CHANGEMENT_COMMERCIAL', avant: { commercialId: null, nom: null }, apres: { commercialId: 'c', nom: null } }), { avant: 'aucun commercial', apres: 'compte supprimé' });
  assert.deepEqual(changementAffaire({ cible: 'CHANTIER', action: 'CHANGEMENT_ENCAISSEMENT', avant: { encaisse: false, dateEncaissement: null }, apres: { encaisse: true, dateEncaissement: '2026-10-21T08:00:00.000Z' } }), { avant: 'Non encaissé', apres: 'Encaissé' });
  assert.deepEqual(changementAffaire({ cible: 'CHANTIER', action: 'CHANGEMENT_CLIENT', avant: { raisonSociale: 'A', libelle: 'A' }, apres: { raisonSociale: 'B', libelle: 'B' } }), { avant: 'A', apres: 'B' });
  // Une saisie Travaux n'est pas un changement de l'affaire, même avec un nom d'action voisin.
  assert.equal(changementAffaire({ cible: 'ACHAT', action: 'CORRECTION' }), null);
  assert.equal(changementAffaire({ cible: 'ACHAT', action: 'CHANGEMENT_TITULAIRE' }), null);
  assert.equal(titreEntreeJournal({ cible: 'HEURE', action: 'CHANGEMENT_TITULAIRE' }), 'Heures — changement_titulaire');
});

// Lot AG-b (décision de Nelson du 26-11-2026, « 1. A ») : la clôture et la réouverture s'inscrivent au journal de la fiche
// (entrée CHANTIER CHANGEMENT_STATUT, avant et après { statut, dateFin }, dateFin en ISO ou null). Cadrage, périmètre 2 :
// titre « Statut — changement », chaque côté « <libellé du statut> » ou « <libellé>, date de fin JJ-MM-AAAA » (« Terminé,
// date de fin 26-11-2026 », « En cours »). Les tests unitaires tournent sous TZ=Pacific/Gambier (UTC−9) : une date de fin
// convertie dans le fuseau local (minuit UTC → la veille au soir) ou affichée en ISO se voit.
test('le changement de statut se lit des deux côtés : libellé du statut en français, date de fin en JJ-MM-AAAA', () => {
  const statut = (avant: unknown, apres: unknown) => changementAffaire({ cible: 'CHANTIER', action: 'CHANGEMENT_STATUT', avant, apres });
  assert.equal(titreEntreeJournal({ cible: 'CHANTIER', action: 'CHANGEMENT_STATUT' }), 'Statut — changement');
  // Clôture d'un chantier en cours sans date de fin : la date posée se lit après. Écarte le code brut (« TERMINE »), la
  // date ISO (« 2026-11-26 ») et une date sans le statut.
  assert.deepEqual(statut({ statut: 'EN_COURS', dateFin: null }, { statut: 'TERMINE', dateFin: '2026-11-26T00:00:00.000Z' }), { avant: 'En cours', apres: 'Terminé, date de fin 26-11-2026' });
  // Réouverture : la date de fin, gardée, se lit des deux côtés.
  assert.deepEqual(statut({ statut: 'TERMINE', dateFin: '2026-10-15T00:00:00.000Z' }, { statut: 'EN_COURS', dateFin: '2026-10-15T00:00:00.000Z' }), { avant: 'Terminé, date de fin 15-10-2026', apres: 'En cours, date de fin 15-10-2026' });
  // Reclôture par l'administration d'un chantier terminé sans date de fin (C4 du contrôle de mode 1) : même statut, la date
  // seule change.
  assert.deepEqual(statut({ statut: 'TERMINE', dateFin: null }, { statut: 'TERMINE', dateFin: '2025-12-15T00:00:00.000Z' }), { avant: 'Terminé', apres: 'Terminé, date de fin 15-12-2025' });
  // Date-seule à minuit UTC, un 1er janvier : lue sur ses dix premiers caractères, elle reste le 01-01-2026 ; une
  // conversion dans le fuseau local (UTC−9) donnerait le 31-12-2025.
  assert.deepEqual(statut({ statut: 'EN_COURS', dateFin: '2026-01-01T00:00:00.000Z' }, { statut: 'TERMINE', dateFin: '2026-01-01T00:00:00.000Z' }), { avant: 'En cours, date de fin 01-01-2026', apres: 'Terminé, date de fin 01-01-2026' });
  // Dernier jour d'un mois de 31 jours, fin d'année : ni décalage, ni inversion du jour et du mois.
  assert.equal(statut({ statut: 'EN_COURS', dateFin: null }, { statut: 'TERMINE', dateFin: '2026-12-31T00:00:00.000Z' })?.apres, 'Terminé, date de fin 31-12-2026');
  // Libellé partagé avec la fiche et Administration > Chantiers (statutsChantier.ts) : « Annulé ».
  assert.equal(statut({ statut: 'ANNULE', dateFin: null }, { statut: 'ANNULE', dateFin: null })?.avant, 'Annulé');
});

// Statut inconnu de la liste des libellés : rendu tel quel, plutôt que masqué (règle de libelleStatutChantier, lot V,
// #390, #392), avec sa date de fin. Instantané sans statut, ou absent : une phrase lisible, jamais « undefined » ni « null »
// (le texte de repli n'est pas fixé par le cadrage). Une entrée CHANGEMENT_STATUT d'une autre cible (le journal des
// interventions emploie la même action) n'est pas un changement de l'affaire.
test('statut inconnu, instantané incomplet, autre cible : le changement de statut reste lisible et réservé à la cible CHANTIER', () => {
  const statut = (avant: unknown, apres: unknown) => changementAffaire({ cible: 'CHANTIER', action: 'CHANGEMENT_STATUT', avant, apres });
  assert.deepEqual(statut({ statut: 'SUSPENDU', dateFin: null }, { statut: 'SUSPENDU', dateFin: '2026-02-01T00:00:00.000Z' }), { avant: 'SUSPENDU', apres: 'SUSPENDU, date de fin 01-02-2026' });
  // Clé héritée d'un objet : rendue telle quelle, et non une fonction convertie en texte.
  assert.equal(statut({ statut: 'toString', dateFin: null }, null)?.avant, 'toString');
  for (const incomplet of [null, undefined, {}, { dateFin: null }, { statut: null, dateFin: null }, 'TERMINE']) {
    const lu = statut(incomplet, incomplet);
    assert.ok(lu, `instantané ${JSON.stringify(incomplet)} : un changement lisible`);
    for (const cote of [lu.avant, lu.apres]) {
      assert.ok(cote.trim().length > 0, `instantané ${JSON.stringify(incomplet)} : côté non vide`);
      assert.doesNotMatch(cote, /undefined|null|NaN|\[object/, `instantané ${JSON.stringify(incomplet)} : ${cote}`);
    }
  }
  assert.equal(changementAffaire({ cible: 'INTERVENTION', action: 'CHANGEMENT_STATUT', avant: { statut: 'PLANIFIEE' }, apres: { statut: 'EN_COURS' } }), null);
  assert.equal(changementAffaire({ cible: 'CONTRAT', action: 'CHANGEMENT_STATUT', avant: { statut: 'TERMINE', dateFin: null }, apres: { statut: 'EN_COURS', dateFin: null } }), null);
  assert.notEqual(titreEntreeJournal({ cible: 'INTERVENTION', action: 'CHANGEMENT_STATUT' }), 'Statut — changement');
});

// Lot AG-c (décision de Nelson du 28-11-2026, « 1. Oui ») : l'annulation d'une affaire par son devis s'inscrit au journal de
// la fiche (entrée CHANTIER CHANGEMENT_STATUT, avant { statut, dateFin } lu sous le verrou, après { statut: 'ANNULE', dateFin }
// inchangée). Cadrage AG-c v2, choix par défaut, à confirmer (N3) : titre « Statut — changement » inchangé ; le côté
// « après » se lit « Annulé » ou « Annulé, date de fin JJ-MM-AAAA ». Écarte le code brut (« ANNULE »), la date ISO, et une
// date convertie dans le fuseau local (UTC−9 : minuit UTC d'un 1er janvier deviendrait le 31-12).
test('l’annulation par le devis se lit des deux côtés : « En cours » ou « Terminé, date de fin JJ-MM-AAAA » avant, « Annulé » à la même date après', () => {
  const annulation = (avant: unknown, apres: unknown) => ({ cible: 'CHANTIER', action: 'CHANGEMENT_STATUT', avant, apres });
  assert.equal(titreEntreeJournal(annulation({ statut: 'EN_COURS', dateFin: null }, { statut: 'ANNULE', dateFin: null })), 'Statut — changement');
  // Chantier en cours, sans date de fin.
  assert.deepEqual(changementAffaire(annulation({ statut: 'EN_COURS', dateFin: null }, { statut: 'ANNULE', dateFin: null })), { avant: 'En cours', apres: 'Annulé' });
  // Chantier en cours avec une date de fin saisie : gardée, lue des deux côtés.
  assert.deepEqual(changementAffaire(annulation({ statut: 'EN_COURS', dateFin: '2025-12-15T00:00:00.000Z' }, { statut: 'ANNULE', dateFin: '2025-12-15T00:00:00.000Z' })), { avant: 'En cours, date de fin 15-12-2025', apres: 'Annulé, date de fin 15-12-2025' });
  // Chantier terminé (cadrage v2, T1) : « Terminé, date de fin X » → « Annulé, date de fin X ».
  assert.deepEqual(changementAffaire(annulation({ statut: 'TERMINE', dateFin: '2026-10-15T00:00:00.000Z' }, { statut: 'ANNULE', dateFin: '2026-10-15T00:00:00.000Z' })), { avant: 'Terminé, date de fin 15-10-2026', apres: 'Annulé, date de fin 15-10-2026' });
  // Terminé sans date de fin : sans date des deux côtés.
  assert.deepEqual(changementAffaire(annulation({ statut: 'TERMINE', dateFin: null }, { statut: 'ANNULE', dateFin: null })), { avant: 'Terminé', apres: 'Annulé' });
  // Un 1er janvier à minuit UTC reste le 01-01-2026 sous UTC−9.
  assert.equal(changementAffaire(annulation({ statut: 'TERMINE', dateFin: '2026-01-01T00:00:00.000Z' }, { statut: 'ANNULE', dateFin: '2026-01-01T00:00:00.000Z' }))?.apres, 'Annulé, date de fin 01-01-2026');
});
