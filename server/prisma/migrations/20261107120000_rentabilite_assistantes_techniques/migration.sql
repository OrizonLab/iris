-- Lot « Assistante technique », troisième PR (AT-2b) : les assistantes techniques deviennent un quatrième
-- destinataire réglable du suivi de rentabilité des chantiers (réponses de Nelson du 06-11-2026, 1 et 2),
-- décoché par défaut (réponse 2). Sans la facturation de la fiche, jusqu'à AT-3 (choix par défaut, à
-- confirmer). La ligne existante prend la valeur par défaut, sans réécriture de la table (valeur
-- par défaut constante).
ALTER TABLE "Parametres" ADD COLUMN "rentabiliteAssistantesTechniques" BOOLEAN NOT NULL DEFAULT false;
