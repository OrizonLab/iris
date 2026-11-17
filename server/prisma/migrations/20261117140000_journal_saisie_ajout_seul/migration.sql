-- Journal des chantiers, interventions et contrats (« JournalSaisieChantier ») en ajout seul (#304), comme les
-- autres journaux d'audit : journaux comptables, journal des factures, comptes rendus et attestations,
-- envois de documents. Règle d'intégrité gardée dans le code (C-15 de PARAMETRAGE-CIBLE.md, « Journaux en
-- ajout seul ») ; l'écran l'annonce déjà (« Historique immuable »). Choix par défaut, à confirmer par Nelson.
-- Aucun chemin de l'application ne modifie ni ne supprime une écriture : seules des créations ; les clés
-- chantierId, interventionId et contratMaintenanceId n'ont pas de clé étrangère (aucune cascade), et la
-- suppression d'un compte auteur reste refusée avant ce déclencheur par la clé auteurId (ON DELETE RESTRICT).
-- Effet nouveau : le changement d'identifiant d'un compte auteur (ON UPDATE CASCADE) est refusé ; aucun code
-- ne change l'identifiant d'un compte. Aucune écriture existante n'est modifiée (règle 4).
CREATE FUNCTION refuser_mutation_journal_saisie() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Le journal des chantiers, interventions et contrats est en ajout seul : une écriture ne se modifie ni ne se supprime.';
END $$;
CREATE TRIGGER journal_saisie_chantier_ajout_seul BEFORE UPDATE OR DELETE ON "JournalSaisieChantier"
  FOR EACH ROW EXECUTE FUNCTION refuser_mutation_journal_saisie();
CREATE TRIGGER journal_saisie_chantier_sans_vidage BEFORE TRUNCATE ON "JournalSaisieChantier"
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_vidage_sans_suppression();
