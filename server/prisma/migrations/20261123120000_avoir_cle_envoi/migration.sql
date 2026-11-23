-- Clé d'envoi de la demande de création d'un avoir partiel (lot X, #247 ; décision déléguée par Nelson le 22-11-2026).
--
-- Un avoir émis est une pièce figée : deux envois de la même demande (réponse perdue puis nouvelle tentative,
-- transaction validée qui répond en erreur) ne doivent pas en émettre deux. Le formulaire tire une clé à son
-- ouverture, comme celui du compte rendu d'intervention (`InterventionRapport.cleEnvoi`, lot 3b-3, #268) ; le serveur
-- rend l'avoir qui la porte déjà au lieu d'en émettre un second. Deux formulaires ouverts, dans deux onglets par
-- exemple, tirent chacun leur clé : ce sont deux demandes. Sans rapport avec les envois de documents
-- (`EnvoiDocument`) ni avec l'identifiant de dépôt de la facturation électronique (FE-5).
--
-- Aucune reprise de données (règle 4) : les factures, les avoirs existants et les avoirs d'annulation restent sans clé.

ALTER TABLE "Facture" ADD COLUMN "cleEnvoi" UUID;

CREATE UNIQUE INDEX "Facture_cleEnvoi_key" ON "Facture"("cleEnvoi");

-- Seul un avoir partiel porte une clé (choix par défaut, à confirmer) : une facture et un avoir d'annulation n'en ont pas.
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_cleEnvoi_avoir_partiel"
  CHECK ("cleEnvoi" IS NULL OR ("type" = 'AVOIR' AND NOT "estAvoirAnnulation"));

-- Posée à la création, puis figée : elle ne se change pas, ne se vide pas et ne se pose pas sur une pièce existante
-- (même forme que le type du compte créateur, migration 20261109120000_facture_cree_par_type).
CREATE FUNCTION figer_cle_envoi_facture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La clé d’envoi d’une pièce ne se modifie pas.' USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER facture_cle_envoi_figee BEFORE UPDATE ON "Facture"
FOR EACH ROW
WHEN (OLD."cleEnvoi" IS DISTINCT FROM NEW."cleEnvoi")
EXECUTE FUNCTION figer_cle_envoi_facture();
