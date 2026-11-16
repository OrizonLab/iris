-- Identifiant Microsoft immuable (#264, décision de Nelson du 16-11-2026, « Maintenant (Recommandé) ») : la
-- connexion Microsoft 365 est autorisée sur le couple `oid` + `tid` du jeton d'ID, enregistré à la première
-- connexion réussie du compte, et non plus sur l'adresse, qui peut changer ou être réattribuée.
-- Aucune reprise (règle 4 : aucune donnée réelle) : les comptes existants se lient à leur prochaine connexion.
ALTER TABLE "User" ADD COLUMN "microsoftOid" TEXT;
ALTER TABLE "User" ADD COLUMN "microsoftTid" TEXT;

-- Un compte est lié par les deux identifiants à la fois, jamais par un seul, ni par une valeur vide. Les IS NOT NULL
-- sont explicites : sans eux, char_length(NULL) rendrait la condition inconnue, qu'une contrainte CHECK accepte.
ALTER TABLE "User" ADD CONSTRAINT "User_identifiant_microsoft_check"
  CHECK (
    ("microsoftOid" IS NULL AND "microsoftTid" IS NULL)
    OR ("microsoftOid" IS NOT NULL AND "microsoftTid" IS NOT NULL AND char_length("microsoftOid") > 0 AND char_length("microsoftTid") > 0)
  );

-- Un couple n'appartient qu'à un compte. Les comptes non liés (deux valeurs NULL) ne se gênent pas : PostgreSQL
-- tient deux NULL pour distincts.
CREATE UNIQUE INDEX "User_microsoftOid_microsoftTid_key" ON "User"("microsoftOid", "microsoftTid");
