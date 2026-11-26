-- Une affaire annulée n'est jamais encaissée (#451, N5 de l'audit des montants de #449). Les routes
-- l'assurent déjà sous verrou : l'annulation par le devis refuse une affaire encaissée
-- (domaines/devis/annulation.ts), l'encaissement refuse une affaire annulée (domaines/chantiers/saisies.ts).
-- La base l'impose désormais, pour toute écriture (SQL direct, reprise). `encaisse` est NOT NULL : la
-- contrainte n'a pas de cas inconnu. Aucune donnée réelle n'existe (règle 4) : aucune reprise ; si une
-- ligne la violait, la migration échouerait plutôt que de la corriger.
ALTER TABLE "Chantier" ADD CONSTRAINT "Chantier_annule_non_encaisse" CHECK (NOT ("statut" = 'ANNULE' AND "encaisse"));
