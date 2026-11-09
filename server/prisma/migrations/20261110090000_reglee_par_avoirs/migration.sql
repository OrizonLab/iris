-- Statut d'une facture couverte par des avoirs (réponse de Nelson du 09-11-2026, après le contrôle de mode 1
-- d'AT-4, lecture retenue, à corriger par Nelson si besoin) : une facture couverte en totalité par des avoirs
-- partiels est « réglée », comme une facture soldée par ses règlements. Elle remplace la règle validée le
-- 17-10-2026, « une facture soldée par ses seuls avoirs reste émise », et étend la cause des transitions
-- EMISE ↔ REGLEE du cycle accepté le 19-10-2026 (#221) ; la garde des transitions
-- (facture_statut_transitions) ne change pas.
-- « Soldée » : reste dû nul ou négatif, et une somme positive des parts de règlements non contre-passés et des
-- TTC des avoirs partiels émis. Elle équivaut à la règle de l'API (montantRegle > 0 || montantAvoirs > 0,
-- reglements/metier.ts), pour trois raisons : une part est toujours positive (AffectationReglement_montant_check) ;
-- au COMMIT, un avoir émis n'est jamais négatif (verifier_plafond_avoirs) ; un avoir d'annulation n'existe qu'avec
-- sa facture annulée (verifier_origine_avoir_annulation). Un avoir à 0,00 € ne solde rien.
-- Le refus d'annuler une facture qui a reçu un règlement reste fondé sur les seuls règlements. Les fragments des
-- messages que lisent les tests existants sont conservés.
-- Aucune reprise (règle 4 : aucune donnée réelle) : une facture émise déjà soldée par ses seuls avoirs n'est pas
-- resynchronisée ; elle reste « émise », et une écriture directe sur sa ligne ou ses avoirs serait refusée au
-- COMMIT par la vérification différée, sauf celle qui la passe « réglée ».
CREATE OR REPLACE FUNCTION verifier_statut_facture_reglements() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE regle BOOLEAN; enregistre NUMERIC; soldee BOOLEAN;
BEGIN
  IF NEW."type" <> 'FACTURE' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."statut" = 'REGLEE' THEN
      RAISE EXCEPTION 'Une facture n’est jamais créée « réglée » : elle le devient par ses règlements ou ses avoirs partiels.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."statut" IS NOT DISTINCT FROM OLD."statut" THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (SELECT 1 FROM "AffectationReglement" p JOIN "Reglement" r ON r."id" = p."reglementId" WHERE p."factureId" = NEW."id" AND r."statut" = 'ENREGISTRE') INTO regle;
  SELECT COALESCE((SELECT SUM(p."montant") FROM "AffectationReglement" p JOIN "Reglement" r ON r."id" = p."reglementId" WHERE p."factureId" = NEW."id" AND r."statut" = 'ENREGISTRE'), 0)
       + COALESCE((SELECT SUM(a."totalTtc") FROM "Facture" a WHERE a."factureOrigineId" = NEW."id" AND a."type" = 'AVOIR' AND a."statut" <> 'BROUILLON' AND NOT a."estAvoirAnnulation"), 0)
    INTO enregistre;
  soldee := enregistre > 0 AND reste_du_facture(NEW."id") <= 0;
  IF NEW."statut" = 'REGLEE' AND NOT soldee THEN
    RAISE EXCEPTION 'Une facture ne passe à « réglée » que soldée par ses règlements ou ses avoirs partiels.';
  END IF;
  IF OLD."statut" = 'REGLEE' AND NEW."statut" = 'EMISE' AND soldee THEN
    RAISE EXCEPTION 'Une facture soldée par ses règlements ou ses avoirs partiels reste « réglée ».';
  END IF;
  IF NEW."statut" = 'ANNULEE' AND regle THEN
    RAISE EXCEPTION 'Une facture qui a reçu un règlement ne peut pas être annulée.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION verifier_statut_reglement_facture(facture_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE facture RECORD; enregistre NUMERIC; soldee BOOLEAN;
BEGIN
  -- Verrou de la facture : deux écritures directes concurrentes se sérialisent (inchangé).
  SELECT "type", "statut" INTO facture FROM "Facture" WHERE "id" = facture_id FOR UPDATE;
  IF NOT FOUND OR facture."type" <> 'FACTURE' OR facture."statut" NOT IN ('EMISE', 'REGLEE') THEN
    RETURN;
  END IF;
  SELECT COALESCE((SELECT SUM(p."montant") FROM "AffectationReglement" p JOIN "Reglement" r ON r."id" = p."reglementId" WHERE p."factureId" = facture_id AND r."statut" = 'ENREGISTRE'), 0)
       + COALESCE((SELECT SUM(a."totalTtc") FROM "Facture" a WHERE a."factureOrigineId" = facture_id AND a."type" = 'AVOIR' AND a."statut" <> 'BROUILLON' AND NOT a."estAvoirAnnulation"), 0)
    INTO enregistre;
  soldee := enregistre > 0 AND reste_du_facture(facture_id) <= 0;
  IF (facture."statut" = 'REGLEE') <> soldee THEN
    RAISE EXCEPTION 'Facture % : statut % incohérent avec ses règlements et ses avoirs (réglée si le reste dû est nul ou négatif, avec un montant positif réglé ou crédité par des avoirs partiels).', facture_id, facture."statut";
  END IF;
END $$;
