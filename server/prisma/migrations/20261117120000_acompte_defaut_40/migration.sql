-- Taux d'acompte proposé par défaut : 40 % au lieu de 30 % (décision de Nelson du 17-11-2026 : « par defaut, le
-- reglage doit etre a 40% d'accompte, qui sera modifiable dans les parametre de société justement »). La ligne
-- singleton des paramètres est créée à la demande avec les valeurs par défaut de la base : une nouvelle installation
-- prend 40. Une ligne déjà créée garde sa valeur, modifiable dans Administration > Marges & Commissions : aucune
-- reprise de données (règle 4).
ALTER TABLE "Parametres" ALTER COLUMN "tauxAcompteDefaut" SET DEFAULT 40;
