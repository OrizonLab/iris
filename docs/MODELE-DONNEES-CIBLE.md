# Modèle de données cible : contrats récurrents, règlements, banque, commissions

> **Proposition à valider par Nelson (16-10-2026). Rien n'est implémenté.** *Précision du 22-11-2026 sur cette phrase du 16-10-2026 ([#627](https://github.com/OrizonLab/iris/issues/627), reliquat de N6) : la partie « Règlements » est **en partie** implémentée, par #155 (17-10-2026) puis étendue par #524 (10-11-2026) : règlements, affectations, reste dû et statut « réglée » ; ni l'une ni l'autre n'est validée pour mise en service, et #524 n'est pas validée comptablement ([passation](ROADMAP-PASSATION.md#2-pilote), lot 1). Ne sont pas implémentés : la liste paramétrable des moyens de paiement, aujourd'hui fermée (B-45, lot P3 du [paramétrage cible](PARAMETRAGE-CIBLE.md#5-lots-proposés) ; écart relevé en [section 5 de l'inventaire](PARAMETRAGE-INVENTAIRE.md#5-écarts-entre-la-documentation-et-le-code)), ni les écritures d'encaissement (seules existent celles des factures et avoirs, `EcritureFacture`). L'état des autres parties (contrats récurrents, banque, commissions) n'est pas relu ici : il est dans la passation.* Ce squelette vérifie que la facturation et les commissions n'auront pas à être refaites quand viendront les abonnements, les locations, les paiements et la banque. Il ne fixe aucune règle de prix, de commission ou de conformité : les champs dont la règle n'est pas décidée restent sans valeur par défaut métier.

## Principes

- La `Facture` actuelle reste le **seul document facturé**, avec ses montants figés, sa numérotation et ses avoirs. Règlements, banque et contrats s'y raccordent par des liens ; ils ne la réécrivent jamais.
- Toute écriture d'argent est **immuable** : une erreur se corrige par une contre-écriture motivée et journalisée, jamais par une modification.
- Une génération récurrente (échéances, visites) est **idempotente** : une clé unique empêche les doublons.
- Les montants qui ouvrent une commission sont **figés au fait générateur**, avec la version du plan appliqué.

## Contrats récurrents (lot (k), décisions A4)

| Entité | Rôle | Champs principaux |
|---|---|---|
| `Contrat` | engagement commercial récurrent | client, site de facturation, type (`MAINTENANCE`, `ABONNEMENT`, `LOCATION`), statut, commercial, date de signature, date de début, durée d'engagement (12 à 60 mois), périodicité de facturation, terme (`ECHU` ou `A_ECHOIR`, au choix), reconduction (tacite ou non, au choix), financeur (pour une location) |
| `ContratLigne` | ce qui est facturé | désignation, référence au catalogue, quantité, prix unitaire HT, TVA, dates d'effet. Un changement de prix crée une nouvelle ligne datée ; l'ancienne reste. |
| `RevisionContrat` | augmentation automatique, désactivable | mode (`AUCUNE`, ou le calcul par défaut à préciser), paramètres du calcul, date anniversaire, et l'historique de chaque révision appliquée (avant, après, auteur). Modifiable contrat par contrat. |
| `EcheanceContrat` | échéancier | contrat, période (unique par contrat), date de facturation prévue, montant figé, statut (`A_FACTURER`, `FACTUREE`, `ANNULEE`), facture produite |
| `ContratMaintenance` (existant) | visites de maintenance | gagne un lien facultatif vers `Contrat` : le moteur de visites et la file à planifier ne changent pas |

`Facture` gagne deux origines facultatives, `contratId` et `echeanceId`. Une échéance ne produit qu'une facture.

*Note du 26-11-2026 : proposition de cadrage du lot (k), [Abonnements et locations cible](ABONNEMENTS-LOCATIONS-CIBLE.md) (fusionnée par #688, lot **prévu**, rien d'implémenté).* Elle reprend ce modèle comme **option A**, non validée, à côté de deux autres options soumises à Nelson ([section 6](ABONNEMENTS-LOCATIONS-CIBLE.md#6-modèle-cible--options-soumises-à-nelson-nk-01), question NK-01). Elle pose en principe 6 (section 5) qu'une période d'un abonnement ne produit qu'**une facture vivante** (une clé unique en base l'empêche), ce qui est plus précis que la phrase « Une échéance ne produit qu'une facture » ci-dessus ; la phrase n'est pas réécrite, et l'écart (note N7 de [#689](https://github.com/OrizonLab/iris/issues/689)) se règle au cadrage de K-1a, avec NK-01 et NK-08 (une facture par échéance, ou par client et par période).

*Champ déjà implémenté, hors de cette proposition (#663, lot X, 23-11-2026 ; [historique](HISTORIQUE-DECISIONS.md#lot-du-23-11-2026-663))* : `Facture.cleEnvoi`, la clé d'envoi (clé d'idempotence) de la création d'un avoir partiel : `uuid`, facultatif, unique, posé seulement sur un avoir partiel (contrainte en base) et figé par un déclencheur ; même mécanisme que `InterventionRapport.cleEnvoi`. Elle est distincte des `envois` (`EnvoiDocument`) et du `trackingId` de la facturation électronique (FE-5).

**Location et financeurs** : `Financeur` porte l'identité de l'organisme (par exemple Grenke). Une location passe par un financeur ; un abonnement est facturé par l'entreprise à son client (A4). Ce que produit l'échéancier d'un contrat `LOCATION` reste ouvert (plus bas). Les simulations passeront par l'API du financeur ; elles ne créent rien dans Iris tant qu'elles ne sont pas acceptées (`SimulationFinancement` : contrat ou devis, financeur, paramètres envoyés, réponse reçue, date).

## Règlements (lot pilote 1, décision A3)

| Entité | Rôle | Champs principaux |
|---|---|---|
| `Reglement` | un encaissement reçu | payeur (client), date civile, montant, moyen de paiement (liste paramétrable), référence, auteur, statut (`ENREGISTRE` ou `CONTREPASSE`, avec motif) |
| `AffectationReglement` | répartition sur les factures | règlement, facture, montant. Elle permet les règlements partiels et les règlements de plusieurs factures. |

- Le **reste dû** d'une facture se calcule : TTC moins ses avoirs, moins ses affectations. Le statut « réglée » s'en déduit, et non plus d'une transition manuelle (« Marquer comme réglée », remplacée par la PR #155, 17-10-2026) : une facture émise est « réglée » quand son reste dû est nul ou négatif et que les parts de règlements non contre-passés et les avoirs partiels émis (depuis #524, 10-11-2026 ; non validé comptablement ni pour mise en service) totalisent un montant positif (`server/src/domaines/reglements/metier.ts`, `cible`). « Partiellement réglée » n'est qu'un libellé affiché, jamais un statut stocké (`client/src/lib/reglements.ts`). *Phrase réécrite le 19-11-2026 par #626 (point 10 de la [section 12 de la proposition](FACTURATION-ELECTRONIQUE-CIBLE.md#12-points-documentaires)), datée le 22-11-2026 par la PR documentaire des compléments (#622, #627).* Sources : [passation](ROADMAP-PASSATION.md#2-pilote), lot 1, et [section 4](ROADMAP-PASSATION.md#4-choix-par-défaut-à-confirmer), blocs « Règlements » et « Statut « réglée » depuis #524 » ; [historique](HISTORIQUE-DECISIONS.md#décisions-du-09-11-2026-sur-at-4). Le statut « réglée » d'Iris n'est pas un statut de la facturation électronique ([proposition](FACTURATION-ELECTRONIQUE-CIBLE.md#6-choix-existants-qui-posent-un-problème-réglementaire), ligne 4).
- L'**encaissé** qui ouvre une commission se déduit des règlements, et non plus de la case `Chantier.encaisse`.
- Les écritures d'encaissement sont scellées comme celles des factures. Les comptes (banque, clients) se paramètrent par les règles comptables existantes, sans compte imposé.

## Banque et rapprochement (après le pilote)

| Entité | Rôle | Champs principaux |
|---|---|---|
| `CompteBancaire` | compte de l'entreprise | libellé, IBAN masqué, compte comptable |
| `ImportReleve` | relevé importé | compte, format (CSV, OFX ou CAMT.053), empreinte du fichier (pas d'import en double), période, auteur |
| `MouvementBancaire` | une ligne du relevé | date d'opération, date de valeur, montant signé, libellé, référence, empreinte unique, statut |
| `RapprochementLigne` | lien mouvement ↔ règlement | mouvement, règlement, montant. Le lien va dans les deux sens, ce qui couvre une remise de plusieurs chèques. |

Rapprocher ne modifie jamais une facture. Le prélèvement SEPA demanderait un `MandatSepa` (données sensibles) : seulement sur décision.

## Commissions (lot (i), décisions A5)

| Entité | Rôle | Champs principaux |
|---|---|---|
| paramètre général | fait générateur | commande, fin des travaux ou réception du paiement complet (A5 ; lecture retenue, à confirmer : remplace le réglage par plan du 14-10-2026) |
| `PlanCommercial` | un plan et son barème | nom, barème propre, versions datées |
| `AttributionPlan` | plan d'un commercial | commercial, plan, date d'effet. Un changement prend effet à cette date, sans rétroactivité. Un commercial sans attribution n'a pas de commission. |
| `CommissionCalculee` | commission figée | commercial, source (affaire, contrat ou échéance), montant de base, plan et version appliqués, fait générateur, mois de rattachement |

Les données dont les commissions ont besoin existent dans le squelette :
- le commercial du contrat et de l'affaire ;
- la date de signature ;
- les montants figés par échéance ;
- les encaissements par facture.

Une commission « en développé » se calcule sur la somme des échéances prévues, une commission « à la prise de commande » sur les lignes du contrat. Aucune des deux ne demande de refaire la facturation.

## Points encore ouverts

*Note du 26-11-2026 : la [proposition du lot (k)](ABONNEMENTS-LOCATIONS-CIBLE.md#10-questions) reprend ceux de ces points qui concernent les contrats récurrents, sans les trancher : le calcul d'augmentation par défaut (NK-16), le périmètre de l'intégration Grenke (NK-22), le regroupement d'échéances sur une facture (NK-08), l'articulation avec `Facture.contratMaintenanceId` (NK-01), la date d'application de la révision (NK-16), l'échéancier d'une location (NK-19) et les commissions sur abonnements et locations (NK-23). Aucune n'a de réponse de Nelson.*

- Le calcul d'augmentation proposé par défaut (indice de révision, et lequel, ou pourcentage fixe).
- Le périmètre de l'intégration Grenke : simulations seules, ou aussi les dossiers.
- Le moment où le commercial doit être connu : dès le devis, si le fait générateur est la commande.
- La date qui compte pour un changement de plan non rétroactif : celle de la commande ou celle du fait générateur.
- Le jour de coupure du mois de rattachement : réglage général ou par plan, et rattachement d'un fait générateur survenu le jour même.
- L'acompte constaté sur le devis (`Devis.acompteMontant`, `acompteRecuLe`), rattaché à aucune facture : comment il entre dans le reste dû, et à quel moment une affaire devient « encaissée » pour la commission.
- Un seul `echeanceId` par facture empêche de regrouper plusieurs échéances d'un client sur une même facture ; l'articulation avec `Facture.contratMaintenanceId`, qui existe déjà, est à préciser.
- La « date anniversaire » de `RevisionContrat` suppose une date d'application de la révision, qui n'est pas décidée.
- Location : l'échéancier d'un contrat `LOCATION` produit-il des factures Iris, ou ne sert-il qu'au suivi, le financeur facturant le client ?
- Commissions sur abonnements et locations (décision du 14-10-2026 : activables, « en développé » ou à la prise de commande, en nombre de mois ou en pourcentage du montant mensuel) : leur réglage va-t-il dans le plan ou dans les paramètres généraux ?
- Structure du barème d'un plan : objectifs, primes, barème réduit, paliers et hiérarchie.
