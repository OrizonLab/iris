-- Journaux comptables (« JournalCompteComptable » et « JournalRegleComptable ») horodatés par la base (#615),
-- comme les autres journaux d'audit horodatés par un déclencheur (journal des paramètres et des droits, journal des
-- factures, comptes rendus et attestations, envois de documents, journal des chantiers, interventions et contrats).
-- Règle d'intégrité gardée dans le code (C-15 de PARAMETRAGE-CIBLE.md, « Journaux en ajout seul ») : ces deux
-- journaux ne se modifient ni ne se suppriment, mais une écriture pouvait encore y être insérée avec un horodatage
-- choisi (antidatée ou postdatée) par une requête SQL ordinaire. L'horodatage est désormais celui de l'insertion
-- elle-même (clock_timestamp, et non le début de la transaction : un instant par écriture, à la milliseconde, comme
-- le faisait Prisma), en UTC comme les autres dates écrites par Prisma (colonnes TIMESTAMP(3) sans fuseau), quel que
-- soit le fuseau de la session PostgreSQL. Aucun chemin de l'application n'envoyait de valeur choisie : Prisma
-- calculait l'instant de chaque écriture, que la base remplace désormais par le sien (l'horloge source passe de l'API
-- à PostgreSQL). Déclencheurs ordinaires, comme les autres gardes des journaux (inactifs en mode réplica). Aucune
-- écriture existante n'est modifiée (règle 4).
CREATE FUNCTION "horodater_journal_compte_comptable"() RETURNS trigger AS $$
BEGIN
  NEW."createdAt" := clock_timestamp() AT TIME ZONE 'UTC';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "journal_compte_comptable_horodatage" BEFORE INSERT ON "JournalCompteComptable"
FOR EACH ROW EXECUTE FUNCTION "horodater_journal_compte_comptable"();

CREATE FUNCTION "horodater_journal_regle_comptable"() RETURNS trigger AS $$
BEGIN
  NEW."createdAt" := clock_timestamp() AT TIME ZONE 'UTC';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "journal_regle_comptable_horodatage" BEFORE INSERT ON "JournalRegleComptable"
FOR EACH ROW EXECUTE FUNCTION "horodater_journal_regle_comptable"();
