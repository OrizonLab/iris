-- Factures de l'assistante technique (lot « Assistante technique », AT-3 ; décisions de Nelson du 24-10-2026,
-- points 27, 30, 33 et 34, réponse 6 du 06-11-2026 et réponse 1 du 09-11-2026).
--
-- Le type du compte qui crée une pièce (brouillon de facture, ou avoir) est enregistré sur elle à sa
-- création, puis figé : une facture créée par un compte assistante technique reste aux assistantes
-- techniques, quel que soit le compte qui l'émet ensuite et même si le compte créateur change de type
-- ou est désactivé (point 34, « oui c’est lier au poste d’assiste technique »). Un avoir suit sa facture
-- d'origine. Les pièces créées avant ce lot n'ont pas de type : aucune reprise de données (règle 4) ;
-- elles ne sont visibles que de l'administration.

ALTER TABLE "Facture" ADD COLUMN "creeParType" TEXT;

-- Posé à la création, puis figé, brouillon compris (comme la marque « au temps passé »).
CREATE FUNCTION figer_type_createur_facture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Le type du compte qui a créé une facture est figé.' USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER facture_cree_par_type_fige BEFORE UPDATE ON "Facture"
FOR EACH ROW
WHEN (OLD."creeParType" IS DISTINCT FROM NEW."creeParType")
EXECUTE FUNCTION figer_type_createur_facture();
