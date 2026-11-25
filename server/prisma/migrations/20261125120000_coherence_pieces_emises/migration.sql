-- Cohérence interne de toute pièce émise, facture ou avoir (#243, lot AC), vérifiée à la validation de
-- la transaction, sur l'état d'alors. #235 l'imposait déjà aux totaux et à la ventilation des avoirs
-- (verifier_plafond_avoirs, inchangée) ; rien d'équivalent n'existait pour les factures, ni pour les
-- lignes et les écritures au regard de la ventilation. L'application ne produit aucune pièce qui manque
-- à ces règles : elles en sont les égalités de calcul (ventilationTvaDerivee, avoir partiel,
-- ecrituresPourPiece). Elles ferment la porte à une pièce écrite autrement (SQL direct, reprise).
--
-- Ventilation V = ventilation_tva_piece (enregistrée, sinon déduite des lignes). Pour toute pièce non
-- brouillon :
--   1. signes : totaux, ventilation et lignes (HT, TTC) positifs ou nuls ;
--   2. totaux : TTC = HT + TVA ; ventilation égale aux totaux ; TTC = HT + TVA à chaque taux ;
--   3. lignes : à chaque taux, somme des HT de ligne = HT de V ; aucune ligne à un taux absent de V ;
--   4. écritures : clés connues ; client = TTC ; vente, par nature, = somme des HT de ligne de cette
--      nature ; TVA, par taux, = TVA de V à ce taux. Sens inversé pour un avoir.
-- Ne sont pas comparés : le TTC de ligne, arrondi ligne par ligne, qui s'écarte légitimement de la
-- ventilation ; la TVA recalculée (HT × taux), qu'un avoir partiel différentiel ne suit pas au centime
-- (choix par défaut, à confirmer). Quand plusieurs taux ou plusieurs clés manquent à une règle, le message
-- cite le plus petit (tri), pour être toujours le même.
-- Une facture émise à 0 / 0 / 0 €, avec ou sans ligne, satisfait ces règles (décision de Nelson du
-- 19-10-2026 : « #243 on ne refuse pas une piece a emise a montant nul ») ; un avoir à 0,00 € reste
-- refusé par verifier_plafond_avoirs (#530, réponse de Nelson du 10-11-2026 : « si 0€ pas d'avoir, on
-- ne fais pas d'avoir a 0€ »).
--
-- Règle d'intégrité, gardée dans le code (règle permanente 1). Pas de SECURITY DEFINER : la fonction lit
-- les tables de la pièce avec les droits de l'appelant (liste fermée des fonctions SECURITY DEFINER,
-- tests de #636 et #643). Aucun verrou : le contenu d'une pièce émise est figé dès son scellement, qui
-- accompagne l'émission (facture_equilibre_ecritures, facture_ligne_figee). Une pièce émise avant cette
-- migration n'est contrôlée qu'à sa prochaine écriture sur sa ligne Facture ; aucune n'existe (règle 4).
CREATE FUNCTION verifier_coherence_piece(piece_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE piece RECORD; sens INTEGER; ventile RECORD; ecart RECORD;
BEGIN
  SELECT "type", "statut", "totalHt", "totalTva", "totalTtc" INTO piece FROM "Facture" WHERE "id" = piece_id;
  IF NOT FOUND OR piece."statut" = 'BROUILLON' THEN
    RETURN;
  END IF;
  -- 1. Signes.
  IF piece."totalHt" < 0 OR piece."totalTva" < 0 OR piece."totalTtc" < 0
     OR EXISTS (SELECT 1 FROM ventilation_tva_piece(piece_id) v WHERE v.ht < 0 OR v.tva < 0 OR v.ttc < 0)
     OR EXISTS (SELECT 1 FROM "FactureLigne" l WHERE l."factureId" = piece_id AND (l."totalHt" < 0 OR l."totalTtc" < 0)) THEN
    RAISE EXCEPTION 'La pièce % porte un montant négatif (totaux, ventilation de TVA ou lignes).', piece_id;
  END IF;
  -- 2. Totaux : TTC = HT + TVA ; ventilation égale aux totaux.
  SELECT COALESCE(SUM(v.ht), 0) AS ht, COALESCE(SUM(v.tva), 0) AS tva, COALESCE(bool_and(v.ttc = v.ht + v.tva), TRUE) AS ttc_juste
  INTO ventile FROM ventilation_tva_piece(piece_id) v;
  IF piece."totalTtc" <> piece."totalHt" + piece."totalTva" OR ventile.ht <> piece."totalHt" OR ventile.tva <> piece."totalTva" OR NOT ventile.ttc_juste THEN
    RAISE EXCEPTION 'La pièce % n''a pas des totaux égaux à sa ventilation de TVA (HT, TVA, TTC = HT + TVA).', piece_id;
  END IF;
  -- 3. Lignes : à chaque taux, somme des HT de ligne = HT de la ventilation.
  SELECT COALESCE(v.taux, l.taux) AS taux INTO ecart
  FROM (SELECT taux, ht FROM ventilation_tva_piece(piece_id)) v
  FULL JOIN (SELECT "tauxTva" AS taux, SUM("totalHt") AS ht FROM "FactureLigne" WHERE "factureId" = piece_id GROUP BY "tauxTva") l ON l.taux = v.taux
  WHERE v.taux IS NULL OR COALESCE(v.ht, 0) <> COALESCE(l.ht, 0)
  ORDER BY 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Les lignes de la pièce % ne suivent pas sa ventilation à la TVA de % %%.', piece_id, ecart.taux;
  END IF;
  -- 4. Écritures : clés connues ; client = TTC ; vente par nature = lignes ; TVA par taux = ventilation.
  sens := CASE WHEN piece."type" = 'AVOIR' THEN -1 ELSE 1 END;
  SELECT e."cle" AS cle INTO ecart FROM "EcritureFacture" e WHERE e."factureId" = piece_id AND NOT (
       (e."cle" IN ('CLIENT', 'VENTE_PRESTATION', 'VENTE_ARTICLE') AND e."tauxTva" IS NULL)
       OR (e."cle" LIKE 'TVA:%' AND e."tauxTva" IS NOT NULL))
  ORDER BY e."cle"
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'La pièce % porte une écriture comptable de clé inconnue (%).', piece_id, ecart.cle;
  END IF;
  IF (SELECT COALESCE(SUM(e."debit" - e."credit"), 0) * sens FROM "EcritureFacture" e WHERE e."factureId" = piece_id AND e."cle" = 'CLIENT') <> piece."totalTtc" THEN
    RAISE EXCEPTION 'L''écriture client de la pièce % ne vaut pas son TTC.', piece_id;
  END IF;
  SELECT COALESCE(e.cle, l.cle) AS cle INTO ecart
  FROM (SELECT "cle" AS cle, SUM("credit" - "debit") * sens AS montant FROM "EcritureFacture" WHERE "factureId" = piece_id AND "cle" LIKE 'VENTE\_%' GROUP BY "cle") e
  FULL JOIN (SELECT 'VENTE_' || "nature" AS cle, SUM("totalHt") AS montant FROM "FactureLigne" WHERE "factureId" = piece_id GROUP BY "nature") l ON l.cle = e.cle
  WHERE COALESCE(e.montant, 0) <> COALESCE(l.montant, 0)
  ORDER BY 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Les écritures de vente de la pièce % ne suivent pas ses lignes (%).', piece_id, ecart.cle;
  END IF;
  SELECT COALESCE(e.taux, v.taux) AS taux INTO ecart
  FROM (SELECT "tauxTva" AS taux, SUM("credit" - "debit") * sens AS montant FROM "EcritureFacture" WHERE "factureId" = piece_id AND "tauxTva" IS NOT NULL GROUP BY "tauxTva") e
  FULL JOIN (SELECT taux, tva FROM ventilation_tva_piece(piece_id)) v ON v.taux = e.taux
  WHERE v.taux IS NULL OR COALESCE(e.montant, 0) <> v.tva
  ORDER BY 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Les écritures de TVA de la pièce % ne suivent pas sa ventilation à la TVA de % %%.', piece_id, ecart.taux;
  END IF;
END $$;

CREATE FUNCTION declencher_coherence_piece() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM verifier_coherence_piece(NEW."id");
  RETURN NULL;
END $$;

-- Contrainte différée, au COMMIT. Le nom la place après les gardes différées du même événement (ordre
-- alphabétique des déclencheurs : facture_annulation_avec_avoir, facture_avoir_annulation_origine,
-- facture_equilibre_ecritures, facture_plafond_avoirs, facture_statut_reglement_differe,
-- facture_temps_passe_intervention) : les refus de l'équilibre des écritures, du cycle des statuts, de #235
-- et de #530 restent ceux que l'on voit.
CREATE CONSTRAINT TRIGGER facture_verification_coherence AFTER INSERT OR UPDATE ON "Facture"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW."statut" <> 'BROUILLON')
EXECUTE FUNCTION declencher_coherence_piece();
