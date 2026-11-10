-- Pas d'avoir à 0,00 € (réponse de Nelson du 10-11-2026 : « si 0€ pas d'avoir, on ne fais pas d'avoir a 0€ » ;
-- annulation d'une facture à 0,00 € : « Refuser l'annulation (Recommandé) »). Principe de #235
-- (20261019180000_plafond_avoirs) : les règles que l'application applique en créant un avoir partiel ou en annulant
-- une facture sont garanties en base, pour un avoir écrit directement en SQL. La fonction est remplacée à l'identique,
-- avec un refus de plus : un avoir émis, partiel ou d'annulation, dont le TTC est 0,00 €. Avec le refus des montants
-- négatifs, un avoir émis a donc un TTC positif. La garde porte sur le total, et non sur les lignes : l'avoir total
-- recopie les lignes de la facture, qui peut porter une ligne offerte à 0,00 €. Un avoir resté brouillon n'est pas
-- vérifié (il l'est à son émission), comme avant. Règle d'intégrité (C-04) : un numéro d'avoir n'est consommé que par
-- un avoir qui crédite quelque chose.
-- Aucune reprise (règle 4 : aucune donnée réelle) : une facture qui porterait déjà un avoir émis à 0,00 € serait
-- refusée à sa prochaine écriture qui déclenche la vérification.
CREATE OR REPLACE FUNCTION verifier_plafond_avoirs(facture_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE facture RECORD; avoir RECORD; ventile RECORD; credite RECORD; depassement RECORD;
BEGIN
  -- Verrou de la facture créditée, pris avant toute lecture des avoirs, comme le garde différé des
  -- règlements : une transaction qui émet un avoir pendant qu'une autre a déjà validé les siens
  -- attend celle-ci, puis relit ses avoirs. L'API tient déjà ce verrou. Deux transactions qui ont
  -- chacune inséré un avoir avant de valider s'interbloquent (le contrôle de clé étrangère de chaque
  -- insertion tient la facture) : PostgreSQL en annule une, et le plafond n'est jamais dépassé.
  SELECT "type", "statut", "totalHt", "totalTva", "totalTtc" INTO facture FROM "Facture" WHERE "id" = facture_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF (facture."type" <> 'FACTURE' OR facture."statut" NOT IN ('EMISE', 'REGLEE')) AND EXISTS (
    SELECT 1 FROM "Facture" WHERE "factureOrigineId" = facture_id AND "type" = 'AVOIR' AND "statut" <> 'BROUILLON' AND NOT "estAvoirAnnulation"
  ) THEN
    RAISE EXCEPTION 'Un avoir partiel ne crédite qu''une facture émise ou réglée (pièce %, % %).', facture_id, facture."type", facture."statut";
  END IF;
  FOR avoir IN SELECT "id", "totalHt", "totalTva", "totalTtc" FROM "Facture"
    WHERE "factureOrigineId" = facture_id AND "type" = 'AVOIR' AND "statut" <> 'BROUILLON'
  LOOP
    IF avoir."totalHt" < 0 OR avoir."totalTva" < 0 OR avoir."totalTtc" < 0
       OR EXISTS (SELECT 1 FROM ventilation_tva_piece(avoir."id") v WHERE v.ht < 0 OR v.tva < 0 OR v.ttc < 0) THEN
      RAISE EXCEPTION 'L''avoir % de la facture % porte un montant négatif.', avoir."id", facture_id;
    END IF;
    IF avoir."totalTtc" = 0 THEN
      RAISE EXCEPTION 'L''avoir % de la facture % est à 0,00 € : Iris n''émet pas d''avoir à 0,00 €.', avoir."id", facture_id;
    END IF;
    SELECT COALESCE(SUM(v.ht), 0) AS ht, COALESCE(SUM(v.tva), 0) AS tva, COALESCE(bool_and(v.ttc = v.ht + v.tva), TRUE) AS ttc_juste
    INTO ventile FROM ventilation_tva_piece(avoir."id") v;
    IF avoir."totalTtc" <> avoir."totalHt" + avoir."totalTva" OR ventile.ht <> avoir."totalHt" OR ventile.tva <> avoir."totalTva" OR NOT ventile.ttc_juste THEN
      RAISE EXCEPTION 'L''avoir % de la facture % n''a pas des totaux égaux à sa ventilation de TVA (HT, TVA, TTC = HT + TVA).', avoir."id", facture_id;
    END IF;
  END LOOP;
  SELECT COALESCE(SUM("totalHt"), 0) AS ht, COALESCE(SUM("totalTva"), 0) AS tva, COALESCE(SUM("totalTtc"), 0) AS ttc INTO credite
  FROM "Facture" WHERE "factureOrigineId" = facture_id AND "type" = 'AVOIR' AND "statut" <> 'BROUILLON';
  IF credite.ht > facture."totalHt" OR credite.tva > facture."totalTva" OR credite.ttc > facture."totalTtc" THEN
    RAISE EXCEPTION 'Les avoirs de la facture % dépassent son montant total (HT, TVA ou TTC).', facture_id;
  END IF;
  SELECT a.taux, o.taux IS NULL AS absent INTO depassement
  FROM (
    SELECT v.taux, SUM(v.ht) AS ht, SUM(v.tva) AS tva
    FROM "Facture" av CROSS JOIN LATERAL ventilation_tva_piece(av."id") v
    WHERE av."factureOrigineId" = facture_id AND av."type" = 'AVOIR' AND av."statut" <> 'BROUILLON'
    GROUP BY v.taux
  ) a
  LEFT JOIN ventilation_tva_piece(facture_id) o ON o.taux = a.taux
  WHERE o.taux IS NULL OR a.ht > o.ht OR a.tva > o.tva OR a.ht + a.tva > o.ttc
  ORDER BY a.taux LIMIT 1;
  IF FOUND AND depassement.absent THEN
    RAISE EXCEPTION 'Un avoir de la facture % porte un taux de TVA (% %%) absent de la facture.', facture_id, depassement.taux;
  ELSIF FOUND THEN
    RAISE EXCEPTION 'Les avoirs de la facture % dépassent sa ventilation à la TVA de % %%.', facture_id, depassement.taux;
  END IF;
END $$;
