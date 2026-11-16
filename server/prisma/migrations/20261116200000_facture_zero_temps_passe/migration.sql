-- Une facture émise à 0,00 € TTC ne compte plus comme obstacle à la facture au temps passé (décision de
-- Nelson du 16-11-2026, option « Ne bloque pas (Recommandé) », #529) : l'index unique partiel de la
-- migration 20261028180000_facture_temps_passe l'écarte, comme le filtre de l'API (factures/repere.ts).
-- Un brouillon à 0,00 € compte toujours. « REGLEE » est écarté par prudence : une facture à 0,00 € ne
-- devient jamais réglée (gardes verifier_affectation_reglement et verifier_statut_facture_reglements).
-- Aucune reprise de données (règle 4) : le nouveau prédicat retient moins de lignes que l'ancien, la
-- construction de l'index ne peut donc pas échouer sur une base existante.
DROP INDEX "Facture_temps_passe_unique";
CREATE UNIQUE INDEX "Facture_temps_passe_unique" ON "Facture" ("interventionId")
  WHERE "tempsPasse" AND "statut" <> 'ANNULEE' AND NOT ("statut" IN ('EMISE', 'REGLEE') AND "totalTtc" = 0);

-- Filtre Prisma correspondant (factures/repere.ts), à garder identique au prédicat ci-dessus :
--   { type: 'FACTURE', statut: { not: 'ANNULEE' }, NOT: { statut: { in: ['EMISE', 'REGLEE'] }, totalTtc: 0 } }
