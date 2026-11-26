# Abonnements et locations cible : proposition

> **Proposition du 26-11-2026, lot (k) « Abonnements et locations »** (cadrage, avant tout code), demandée par Nelson le 26-11-2026 (message de la session de travail, 11:06:54 UTC, mot pour mot) : « Ensuite tu peux cadrer un lot hors pilote, comme les abonnements et locations ». Lecture retenue, à corriger par Nelson si besoin, comme dans l'[historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-26-11-2026-facturation-électronique-lot-k) (lecture 4) et au point de reprise de la passation : le lot (k), qu'il cite en exemple ; la demande porte sur le cadrage seul. Établie à partir du contrôle de cohérence de mode 1 du même jour, sur `main` à `8027b2b` ; les numéros de ligne de la passation et de la proposition de facturation électronique sont recalés sur `main` à `ff0a10f` (après #686, qui ne touche que la documentation) ; les références au code sont inchangées.
>
> **Statut : proposition à valider.** Tout ce qu'elle décrit est **prévu**. Rien n'est implémenté, rien n'est validé comptablement ni pour mise en service. Le lot (k) reste **hors pilote** ([passation](ROADMAP-PASSATION.md#2-pilote), section 2, « Hors pilote ») : la demande du 26-11-2026 porte sur le cadrage, et non sur le code (lecture retenue, ci-dessus) ; le placement du premier sous-lot de code est une question pour Nelson (NK-10).
>
> **Portée de sa fusion** (choix par défaut, à confirmer) :
> - fusionner la proposition valide l'inventaire (sections 3 et 4) et le découpage en sous-lots (section 9) comme base de travail ;
> - les questions (section 10) restent ouvertes jusqu'à leur réponse ; aucune n'est présumée ;
> - aucune règle de prix, de prorata, de TVA, de révision, de résiliation, d'indemnité ni de commission n'est validée, et aucune n'est proposée par défaut ;
> - aucun sous-lot de code ne commence sans que Nelson l'ait placé (NK-10) ;
> - seul Nelson décide de la mise en production.
>
> Ce document ne vaut pas avis juridique ou comptable. Les règles légales évoquées le sont **selon notre lecture, à confirmer par le cabinet**.

## 1. Le besoin

Nelson, le 26-11-2026 : « Ensuite tu peux cadrer un lot hors pilote, comme les abonnements et locations ».

Le même message dit, à propos de la question N-01 de la facturation électronique : « pourquoi avoir besoin de connaitre la societe pilote ? La societz pilote ne sera pas coder dans le dur ». Cette proposition en tire un principe (section 5, principe 1) : le lot (k) est générique. L'activité de la société pilote (sûreté électronique, revente d'accès internet et télécom, [facturation électronique](FACTURATION-ELECTRONIQUE-CIBLE.md#3-calendrier-et-conséquences-pour-la-société-pilote), section 3, lecture retenue) n'est qu'un exemple de besoin ; rien de propre à la télécom n'est écrit dans le code.

*Note : les réponses de Nelson du 26-11-2026 sur la facturation électronique (N-01, N-09, N-02) sont consignées dans l'[historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-26-11-2026-facturation-électronique-lot-k) (#686). La sous-question de N-09 sur le type d'une association à SIREN non assujettie reste ouverte.*

## 2. Ce qui est décidé, et ce qui ne l'est pas

### 2.1 Décisions

| Date | Décision | Source | Ce qu'elle fixe |
|---|---|---|---|
| 16-10-2026 (A4) | Lot (k) hors pilote, « pour une flexibilité maximale » : abonnements facturés au client ; location par des financeurs, « tels que Grenke », avec une API de simulation dans Iris ; terme échu ou à échoir, au choix ; engagement de 12 à 60 mois ; reconduction tacite ou non, au choix ; augmentation automatique possible, « selon le calcul habituel par défaut, mais toujours modifiable ou désactivable » | [Passation](ROADMAP-PASSATION.md#lots-décidés-hors-pilote), section 2, lot (k) (l. 443-448). **Texte de la passation**, écrit par la PR #153 (corps de la PR : « Nouveau lot (k), abonnements et locations (A4) »), et non message de Nelson cité mot pour mot : le message d'origine n'est consigné nulle part dans le dépôt (l'historique n'a aucune entrée sur A4 ; ses sections datées commencent aux 18 et 19-10-2026) | Le cadre du lot. Le sens précis de « au choix », de « 12 à 60 mois » et du « calcul habituel » reste à préciser (NK-04, NK-07, NK-16) |
| 16-10-2026 | Hors pilote : « banque et rapprochement, abonnements et locations (lot (k)), télécom, financeurs, plan commercial (lot (i)) » (extrait) | [Passation](ROADMAP-PASSATION.md#2-pilote), section 2, l. 362 (texte de la passation) | (k) n'est pas dans le périmètre gelé de la bêta |
| 14-10-2026 | Commissions sur abonnements et locations activables, « en développé » (sur le total des paiements prévus) ou à la prise de commande (un nombre de mois, ou un pourcentage du montant mensuel) | [Passation](ROADMAP-PASSATION.md#lots-décidés-hors-pilote), lot (i), l. 411-413 (texte de la passation) | Données que (k) devra fournir au plan commercial (lot (i)) ; aucun calcul dans (k) |
| 23-10-2026 (nuit) | Conversions d'un devis : « intervention + abonnement (recurrence), contrat se maintenance + sav, abonnement + contrat de maintenance » (extrait du message de Nelson, mot pour mot) ; Claude Code a renvoyé les combinaisons avec un abonnement au lot qui créera les abonnements | [Historique](HISTORIQUE-DECISIONS.md#décisions-du-23-10-2026-nuit-sur-le-lot-4), l. 411 et point 1 de la lecture retenue | Deux combinaisons nommées par Nelson ; prévues avec (k) ([passation](ROADMAP-PASSATION.md#2-pilote), l. 341) |
| 23-10-2026 (soir) | « Oui la possibilité de convertir un devis en 2 chose » (extrait, mot pour mot) | [Historique](HISTORIQUE-DECISIONS.md#décision-du-23-10-2026-soir-sur-le-lot-4), l. 390 | Limite de deux conversions par affaire, gardée dans le code et bornée en base (`server/src/domaines/devis/routes.ts:289`, `CONVERSIONS_PAR_AFFAIRE = 2`) |
| 19-11-2026 | Cadrage de la facturation électronique : « Statut Encaissée et données de paiement alimentés par les règlements, prélèvements des contrats compris. » (extrait, mot pour mot) | [Historique](HISTORIQUE-DECISIONS.md#décision-du-19-11-2026-sur-la-facturation-électronique), l. 5912 | Question N-13 de la [proposition FE](FACTURATION-ELECTRONIQUE-CIBLE.md#111-pour-nelson) : lot à créer, ou prélèvement saisi comme règlement (NK-24) |
| 26-11-2026 | « La societz pilote ne sera pas coder dans le dur » (extrait, mot pour mot) | Message de la session, 11:06:54 UTC ; [historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-26-11-2026-facturation-électronique-lot-k) (#686) | Lot générique (section 5, principe 1) |

### 2.2 Questions déjà ouvertes dans la passation

- **Augmentation automatique** ([passation](ROADMAP-PASSATION.md#3-questions-ouvertes-pour-nelson), section 3, l. 522) : « quel calcul « habituel » proposer par défaut (indice de révision, et lequel, ou pourcentage fixe) ? Il touche les montants : Iris n'en invente pas. » Reprise en NK-16.
- **API des financeurs** (l. 524) : « périmètre de l'intégration Grenke (simulations seules, ou aussi les dossiers), à préciser quand le lot démarre. » Reprise en NK-22.
- **Commissions récurrentes** (l. 519) : réglage dans le plan ou dans les paramètres généraux. Reprise en NK-23, avec le lot (i).
- **Points ouverts du modèle de données** ([`MODELE-DONNEES-CIBLE.md`](MODELE-DONNEES-CIBLE.md#points-encore-ouverts), l. 75-77) : regroupement d'échéances sur une facture, articulation avec `Facture.contratMaintenanceId`, date d'application de la révision, effet de l'échéancier d'une location. Reprises en NK-08, NK-01, NK-16 et NK-19.
- **Issue [#635](https://github.com/OrizonLab/iris/issues/635)** (ouverte), N7 : « La facturation électronique d'Iris doit-elle couvrir le lot (k) ? » Section 8.1.

## 3. Existant

### 3.1 Ce qui n'existe pas

Aucune entité, route ni écran ne porte un abonnement, une location ou un financeur : aucun modèle dans `server/prisma/schema.prisma`, aucune route dans `server/scripts/routes-reference.txt`, aucun écran dans `client/src`. Seul un commentaire les annonce : les combinaisons avec un abonnement viendront avec le lot qui créera les abonnements (`server/src/domaines/devis/routes.ts:274-275`). Le domaine « Paiements, banque, télécom, financeurs » est **absent** ([passation](ROADMAP-PASSATION.md#1-état-actuel-par-domaine), section 1, l. 214).

### 3.2 Ce qui existe et doit être repris, sans doublon

| Existant | Où | Ce que (k) en reprend | Doublon à éviter |
|---|---|---|---|
| Contrat de maintenance : client, site, titre, statut (`ACTIF`, `SUSPENDU`, `TERMINE`, `ANNULE` ; `BROUILLON` jamais produit, B-52), périodicité en mois (1 à 60), date de début, prochaine échéance, couverture | `schema.prisma:1134-1167` ; `server/src/domaines/contrats/` ; écran `client/src/pages/ContratsMaintenance.tsx` ; menu « Contrats de maintenance » (`client/src/lib/menu.ts:58`) | Statuts, motif obligatoire (3 à 500 caractères), verrou du contrat, journal, PDF récapitulatif, envoi | Un second jeu de statuts, de journal, de PDF et d'envoi pour un objet de même nature. Le contrat de maintenance ne porte « aucun prix, taux ou mécanisme de facturation » (`schema.prisma:1146`) : le lui ajouter, ou créer une entité voisine, est la question NK-01 |
| Calcul des échéances : le jour contractuel est conservé (le 31 revient dès que le mois le permet) | `server/src/domaines/contrats/metier.ts` (`ajouterMoisUTC`) ; règle C-20 du [paramétrage](PARAMETRAGE-INVENTAIRE.md) | Le même calcul pour les périodes de facturation, si NK-05 retient des périodes anniversaires | Un second calcul de dates |
| Génération quotidienne des visites, idempotente, au nom d'un compte système | `server/src/domaines/contrats/generation.ts` ; `ExecutionGenerationVisites` (`schema.prisma:1111`) ; migration `20261022210000_compte_systeme_generation` | Le modèle de passage quotidien, d'alerte et de passage manuel, pour K-2 | Un second ordonnanceur. **Limite** : le compte système signe la génération des visites (visites créées, passage du jour) ; au journal SAV, la base ne le laisse écrire que la création de la visite d'un contrat et l'avancement de son échéance ([passation](ROADMAP-PASSATION.md#4-choix-par-défaut-à-confirmer), section 4, l. 840 ; migration `20261022210000_compte_systeme_generation`) ; aucune facture n'est écrite à son nom, et l'étendre aux factures est une question (NK-11) |
| Conversion d'un devis : cibles `CHANTIER`, `INTERVENTION`, `CONTRAT` ; au plus deux par affaire, de types différents | `schema.prisma:693-709` (`DevisConversion`) ; `server/src/domaines/devis/routes.ts:261-290` | La conversion en abonnement (K-5) | Une conversion parallèle. Une troisième conversion contredirait la limite décidée (section 2.1) |
| Facture : origine obligatoire (`CHANTIER`, `INTERVENTION`, `CONTRAT`, `HORS_AFFAIRE`), numéro à l'émission, pièce émise figée, avoirs, cohérence en base (#681) | `schema.prisma:713-791` ; `server/src/domaines/factures/routes.ts:215-222` ; libellés `client/src/lib/libellesFacture.ts` (`CONTRAT` : « Contrat de maintenance ») | Le seul document facturé ([modèle de données](MODELE-DONNEES-CIBLE.md#principes)) ; toute facture d'un abonnement est une `Facture` ordinaire | Un second document facturé. Réutiliser l'origine `CONTRAT` afficherait « Contrat de maintenance » pour un abonnement |
| Refus de facturer une origine annulée (#361) ; repère « déjà facturée » (AT-4) | `server/src/domaines/factures/routes.ts` ; `server/src/domaines/factures/repere.ts` | Étendus à l'origine nouvelle | — |
| Écran « Prêt à facturer » | `client/src/pages/PreteAFacturer.tsx` ; `GET /api/facturation/prete-a-facturer` | Rien : c'est la liste de contrôle des prérequis de configuration (« Vérifiez les prérequis avant la première émission. ») | Le nom : une liste des échéances à facturer ne doit pas s'appeler ainsi |
| Règlements saisis à la main, moyen `PRELEVEMENT` compris | `server/src/domaines/reglements/metier.ts:7` | L'encaissement d'une facture d'abonnement | Un mandat SEPA, seulement sur décision ([modèle de données](MODELE-DONNEES-CIBLE.md#banque-et-rapprochement-après-le-pilote), l. 48 ; NK-24) |
| Catalogue (prestations, articles, équipements), taux de TVA français seulement (#364) | `schema.prisma:1428-1529` | Les lignes d'un abonnement, copiées du catalogue comme celles d'un devis (A8), ou saisies | Une table d'*offres* à part, sauf décision |
| Parc installé (numéro de série, IMEI, adresse MAC) | `EquipementInstalle` (`schema.prisma:1532`) | Le lien éventuel entre un abonnement ou une location et un équipement (NK-21) | — |
| Journal des chantiers, interventions et contrats, en ajout seul (#583) ; journal des paramètres et des droits ; journal des factures ; journal des envois | `JournalSaisieChantier` (cible `CONTRAT`) ; `JournalAdministration` ; `JournalFacture` ; `EnvoiDocument` | Toutes les traces de (k) | Un journal de plus |
| Marge d'un contrat de maintenance (#550) | `GET /api/contrats-maintenance/:id/marge` | Rien dans K-1 | — |
| Matrice de non-régression des droits (D1a) : couverture de toutes les routes | `server/tests/matrice-droits/` | Chaque route nouvelle y entre | — |

### 3.3 Documents

| Document | Ce qu'il dit du lot | Statut |
|---|---|---|
| [Vision](PRODUCT-VISION-ERP-TECHNIQUE.md) | « Contrats et abonnements » dans le référentiel (l. 19) ; une facture « peut provenir d'un devis, d'un chantier, d'une intervention, d'un contrat ou d'un abonnement » (l. 46) ; « Abonnements télécom et financeurs, sur le même moteur de contrats/facturation » (l. 112, ordre de construction, point 8) | Parcours cible |
| [README](../README.md) | Modules prévus : « Abonnements télécom », « 4G, fibre, box : cycle de facturation, suspension, résiliation » (l. 31) ; « Financeurs », « Grenke, LPB : suivi des financements liés aux équipements/interventions » (l. 32) ; « Contrats & Maintenance récurrente », « échéances automatiques, prorata, renouvellement » (l. 30) ; feuille de route, phase 9 « future comme chaîne automatisée » (l. 285) | Modules prévus |
| [Modèle de données cible](MODELE-DONNEES-CIBLE.md) | `Contrat` (types `MAINTENANCE`, `ABONNEMENT`, `LOCATION`), `ContratLigne`, `RevisionContrat`, `EcheanceContrat`, lien facultatif de `ContratMaintenance` vers `Contrat`, `Financeur`, `SimulationFinancement` ; `Facture` gagne `contratId` et `echeanceId` | Proposition à valider, rien d'implémenté |
| [Droits cibles](MODELE-DROITS-CIBLE.md) | `contrats.consulter`, `contrats.gerer` (section 3.1) ; aucune permission pour les abonnements, les locations ou les financeurs | Proposition validée par sa fusion (#182) ; moteur D1 et suivants prévus |
| [Paramétrage cible](PARAMETRAGE-CIBLE.md) et [inventaire](PARAMETRAGE-INVENTAIRE.md) | Abonnements et locations, « (terme échu ou à échoir, engagement de 12 à 60 mois, reconduction, révision) : lot (k). » (inventaire, l. 350, parmi les règles absentes) ; modules non activables (B-75) | Validée par sa fusion (#183) |
| [Facturation électronique](FACTURATION-ELECTRONIQUE-CIBLE.md) | Ventes à des particuliers, « abonnements compris », dans l'e-reporting (section 3, lecture retenue) ; FE-2 : « date de livraison ou période, préremplie depuis l'intervention ou l'échéance du contrat (choix par défaut, à confirmer) » (l. 463) ; N-13, prélèvements des contrats (l. 669) | Proposition fusionnée comme base de travail (#620) ; tout est prévu |

## 4. Écarts entre les documents

| # | Écart | Où | Traitement proposé |
|---|---|---|---|
| E1 | « Abonnements télécom » (« 4G, fibre, box ») et « Abonnements télécom et financeurs » nomment une activité ; A4 et le lot (k) parlent d'abonnements en général, et Nelson ne veut pas de société codée en dur (26-11-2026) | README l. 31 ; vision l. 112 ; passation l. 217 | La télécom reste un exemple ; vocabulaire générique dans le code et les écrans (section 5, principe 1) ; point documentaire 3 |
| E2 | « Grenke, LPB : suivi des financements liés aux équipements/interventions » ; A4 dit « tels que Grenke » et parle de simulations par API ; LPB n'apparaît dans aucune décision | README l. 32 ; passation l. 444 | NK-21 et NK-22 |
| E3 | Le hors pilote énumère « abonnements et locations (lot (k)), télécom, financeurs » comme trois sujets, alors que A4 range les financeurs dans (k) ; « télécom » n'est défini nulle part | Passation l. 362 et l. 443-444 ; section 1, l. 214 | NK-25 |
| E4 | « échéances automatiques, prorata, renouvellement » pour les contrats de maintenance : ni le prorata ni le renouvellement ne sont décidés, et le contrat de maintenance ne porte aucun prix | README l. 30 ; `schema.prisma:1146` | NK-02 et NK-06 |
| E5 | Numérotation des étapes : point 8 de l'ordre de construction de la vision ; phase 9 du README (la phase 8 y est la facturation) ; « ventes récurrentes, phase 9 » dans la passation | Vision l. 112 ; README l. 284-285 ; passation l. 421 | Aucune contradiction : deux numérotations. Citer la vision (ordre de construction, point 8) et le README (phase 9) |
| E6 | Le modèle de données cible fait de `Contrat` un type commun (`MAINTENANCE` compris) ; le code a un `ContratMaintenance` seul, cible de conversion `CONTRAT` et origine de facture `CONTRAT` libellée « Contrat de maintenance » | `MODELE-DONNEES-CIBLE.md` l. 16-22 ; `schema.prisma:698`, `:738` ; `libellesFacture.ts` | NK-01 ; origine de facture nouvelle (section 13, choix 5) |
| E7 | Commission « à la prise de commande » en « pourcentage du montant mensuel » : un montant mensuel suppose une périodicité mensuelle, ou un équivalent mensuel d'un abonnement trimestriel ou annuel, non défini | Passation l. 413 | NK-23 |
| E8 | « prélèvements des contrats compris » (cadrage FE) ; « Le prélèvement SEPA demanderait un `MandatSepa` (données sensibles) : seulement sur décision » | Historique l. 5912 ; `MODELE-DONNEES-CIBLE.md` l. 48 ; FE N-13 | NK-24 |
| E9 | Le mot « location » désigne déjà une catégorie d'achats (« location d'engins », dépense de la société) ; le mot « abonnement » désigne, dans les documents de la facturation électronique, l'abonnement à un webhook ou le tarif d'une plateforme | `client/src/components/AdminReferentiels.tsx:196` ; `FACTURATION-ELECTRONIQUE-CONNEXION-PA.md` l. 103, 224 | Écrire *contrat de location* ou *location financée*, et *abonnement d'un client*, dans les écrans et les documents de (k) (termes proposés) |

## 5. Principes de la cible

1. **Générique.** Rien de propre à la société pilote dans le code (Nelson, 26-11-2026 : « La societz pilote ne sera pas coder dans le dur ») ; aucune activité ni aucun opérateur écrits en dur, aucun financeur imposé ni écrit en dur comme valeur ; un adaptateur propre à un financeur, sur décision de Nelson (NK-22), sur le modèle de la plateforme agréée (lecture retenue de ce principe, à corriger par Nelson si besoin). Les exemples (télécom, télésurveillance, Grenke) restent dans la documentation.
2. **La `Facture` reste le seul document facturé** ([modèle de données](MODELE-DONNEES-CIBLE.md#principes)). Un abonnement produit des factures ordinaires : numéro attribué à l'émission, pièce émise figée, correction par avoir, règlements, PDF, envoi, et, le moment venu, facturation électronique.
3. **Un seul moteur de contrats et de facturation** (vision, l. 112) : pas de second jeu de statuts, de journal, de PDF, d'envoi ni de calcul de dates (section 3.2).
4. **Rien d'inventé.** Aucune règle de prix, de prorata, de TVA, de révision, de résiliation, d'indemnité, de commission ni de financement par défaut (CLAUDE.md, mode de livraison ; [paramétrage](PARAMETRAGE-CIBLE.md#2-principes), principe 2). Un point non décidé est une question (section 10).
5. **Un paramètre plutôt qu'une constante** (règle permanente 1) : ce qui varie d'une société à l'autre est un paramètre journalisé ; la valeur par défaut est celle que Nelson décide, sinon aucune (section 7).
6. **Idempotence** : une période d'un abonnement ne produit qu'une facture vivante ; une clé unique l'empêche en base.
7. **Figement** : le montant d'une échéance est figé quand sa facture est créée ; une ligne d'abonnement déjà facturée n'est jamais réécrite ; le client et la date de début d'un abonnement sont figés, comme ceux d'un contrat de maintenance (C-18).
8. **Droits API avant l'écran**, refus métier testés sur PostgreSQL et dans le navigateur (règle 2 de la méthode : montants, factures, droits, journaux).
9. **Rien d'historique** (règle 4) : aucune reprise des contrats de maintenance existants, aucune donnée réelle n'existant.

## 6. Modèle cible : options soumises à Nelson (NK-01)

| Option | Description | Ce qu'elle réutilise | Ce qu'elle change |
|---|---|---|---|
| **A** (déjà proposée, non validée) | Un `Contrat` commun (types `MAINTENANCE`, `ABONNEMENT`, `LOCATION`) porte l'engagement commercial et ses lignes facturées ; le `ContratMaintenance` existant garde les visites et gagne un lien facultatif vers `Contrat` ([modèle de données](MODELE-DONNEES-CIBLE.md#contrats-récurrents-lot-k-décisions-a4)) | Moteur de visites inchangé ; un seul échéancier pour tous les types | Deux niveaux pour un contrat de maintenance facturé ; conversion `CONTRAT` et origine de facture à redéfinir |
| **B** | Une entité « abonnement » à part, qui reprend les statuts, le journal et le calcul de dates du contrat de maintenance | Rien de l'existant n'est touché | Risque de doublon (section 3.2) ; deux moteurs, contraire à la vision (l. 112) |
| **C** | Le `ContratMaintenance` étendu : prix, engagement, facturation ; un contrat sans visite est un abonnement | Un seul objet | Le contrat de maintenance du pilote change ; son principe « aucun prix, taux ou mécanisme de facturation » tombe |

Quelle que soit l'option : une table d'échéances (période unique par contrat, montant figé, facture produite) ; une origine de facture nouvelle ; un lien de la facture vers l'échéance. Le choix entre A, B et C est une question de modèle de données : il revient à Nelson (règle 5 de la méthode).

## 7. Règles permanentes appliquées au lot

### 7.1 Paramètres (règle permanente 1)

| Paramètre | Valeur par défaut | Source de la valeur | Journal |
|---|---|---|---|
| Bornes de la durée d'engagement | 12 à 60 mois | A4 (texte de la passation) ; sens à préciser (NK-07) | `JournalAdministration` |
| Périodicités de facturation proposées | Aucune avant la réponse à NK-03 | — | idem |
| Terme proposé à la création | Aucun : choisi à chaque abonnement (choix par défaut, à confirmer ; NK-04) | A4 : « au choix » | idem |
| Reconduction proposée à la création | Aucune : choisie à chaque abonnement (choix par défaut, à confirmer) | A4 : « au choix » | idem |
| Révision : calcul proposé | Aucun avant la réponse à NK-16 ; « toujours modifiable ou désactivable » (A4), abonnement par abonnement comme le propose le [modèle de données](MODELE-DONNEES-CIBLE.md#contrats-récurrents-lot-k-décisions-a4) (« Modifiable contrat par contrat », proposition non validée ; choix par défaut, à confirmer) | Section 3 de la passation, l. 522 | idem, et historique de chaque révision appliquée |
| Anticipation de la facturation automatique (K-2) | Vide à l'installation : désactivée jusqu'au réglage (choix par défaut, à confirmer, sur le modèle de la génération des visites, décision du 22-10-2026) | NK-11 | idem |
| Module « Abonnements et locations » activable (B-75) | NK-26 | — | idem |
| Délai d'échéance de paiement | Celui de toute facture (B-34, aucun délai par défaut) | Inchangé | — |
| Comptes comptables | Règles comptables existantes, aucun compte imposé | CLAUDE.md, mode de livraison | Journaux comptables existants |

### 7.2 Ce qui reste dans le code, avec sa raison

- Numérotation continue et chronologique des factures et des avoirs (`SequenceFacture`, `SequenceAvoir`) : obligation légale. Une facturation par lots attribue les numéros dans l'ordre des émissions.
- Facture émise figée, correction par avoir, cohérence en base (#681) : obligation légale et intégrité.
- Une période, une facture vivante (clé unique en base) : intégrité.
- Taux de TVA français seulement (#364) : règle fiscale gardée.
- Client et date de début figés ; lignes facturées jamais réécrites ; journal en ajout seul : intégrité et traçabilité.
- Calcul des dates au jour civil de la société, dates saisies et affichées en `JJ-MM-AAAA` (C-13).
- Statuts : squelette du cycle de vie (C-17) ; les étapes facultatives éventuelles relèvent de B-53 à B-57.

### 7.3 Droits

- **Avant le moteur des droits (D1)**, les routes de K-1 suivent les gardes actuelles. Choix par défaut, à confirmer (règle 5, l'option la plus restrictive) : **administration seule** (`requireAdmin` : super administrateur, administrateur, directeur), en session seulement, **aucune clé d'intégration** ; l'assistante technique, qui gère les contrats de maintenance, n'y a pas accès tant que Nelson ne l'a pas décidé ; le technicien jamais (il ne reçoit aucun montant, invariant de [MODELE-DROITS-CIBLE.md](MODELE-DROITS-CIBLE.md#81-invariants)).
- **Dans la cible**, permissions à ajouter au catalogue de la section 3.1 de [MODELE-DROITS-CIBLE.md](MODELE-DROITS-CIBLE.md#31-permissions-élémentaires), noms proposés, qui dépendent de NK-01 (avec l'option A, `contrats.consulter` et `contrats.gerer` existent déjà) : `abonnements.consulter`, `abonnements.gerer` (créer, modifier, changer le statut) ; la préparation d'une facture d'échéance exige `factures.preparer` **et** `abonnements.gerer` (choix par défaut, le plus restrictif, à confirmer) : l'assistante technique, qui gère aussi les factures (AT-3, `gereLesFactures`), ne doit gagner aucun accès aux abonnements au passage au moteur (invariant « Migration sans gain d'effet », [MODELE-DROITS-CIBLE.md](MODELE-DROITS-CIBLE.md#81-invariants), section 8.1) ; pour K-6 et K-7, `financements.simuler` et `financeurs.gerer`. Aucun type de compte nouveau.
- Chaque route nouvelle entre dans la matrice de non-régression des droits (D1a), dont le test de couverture l'exige.

### 7.4 Journaux

- Abonnement : création, modification, changement de statut, motif obligatoire, dans le journal des chantiers, interventions et contrats, en ajout seul (`JournalSaisieChantier`), avec une cible propre. Le nom de ce journal est déjà discuté ([#585](https://github.com/OrizonLab/iris/issues/585)).
- Paramètres : `JournalAdministration`.
- Facture d'une échéance : `JournalFacture` (création du brouillon avec son origine), comme toute facture.
- Simulation d'un financeur (K-7) : conservée telle que reçue, en ajout seul, sans secret.

### 7.5 Documents figés

- La facture d'une échéance suit les règles de toute facture : identité de l'émetteur, adresse du client, lignes, ventilation et mentions copiées et figées à l'émission ([paramétrage](PARAMETRAGE-CIBLE.md#2-principes), principe 6).
- Un document récapitulatif de l'abonnement, s'il est prévu, suit celui du contrat de maintenance (lot 6a-4b) ; un contrat à signer, avec conditions générales, n'est pas prévu sans décision.

## 8. Dépendances

### 8.1 Facturation électronique

- Les factures de (k) sont des `Facture` ordinaires : elles passent par les lots FE comme les autres, sans chemin propre. La question N7 de #635 (« La facturation électronique d'Iris doit-elle couvrir le lot (k) ? ») trouve là sa réponse de principe, sous réserve de Nelson.
- **Période facturée** : FE-2 prévoit la « date de livraison ou période, préremplie depuis l'intervention ou l'échéance du contrat ». Un seul endroit doit porter la période : si K-1b précède FE-2, la période est écrite dans la désignation de la ligne et gardée sur l'échéance ; FE-2 crée le champ structuré et le préremplit depuis l'échéance (choix par défaut, à confirmer ; QK-01).
- **Ventes à des particuliers** : e-reporting (FE-8) ; le type de client (réponse N-09 du 26-11-2026, [historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-26-11-2026-facturation-électronique-lot-k) ; la sous-question de l'association reste ouverte) en dépend.
- **Prélèvements** : N-13 de la proposition FE (NK-24).
- **Ordre** : les lots FE ont une échéance fixée par Nelson, une recette sur le bac à sable d'une plateforme agréée avant le 01-06-2027 (cadrage du 19-11-2026 ; le calendrier légal, en partie non vérifié, est en [section 3 de la proposition FE](FACTURATION-ELECTRONIQUE-CIBLE.md#3-calendrier-et-conséquences-pour-la-société-pilote)). Le placement de (k) est NK-10.

### 8.2 Plan commercial (lot (i))

(k) conserve ce dont le plan aura besoin (montant de chaque échéance, durée d'engagement, date de signature), sans calculer aucune commission. Le commercial d'un abonnement est ajouté avec le lot (i), dont les questions sont ouvertes (section 3 de la passation).

### 8.3 Paramétrage

Les paramètres de la section 7.1 vont dans la table `Parametres`, comme ceux des lots 5 et 6, sans attendre le socle P1 ; le module activable suit P2 (B-75).

### 8.4 Droits

Section 7.3. Le passage au moteur (D1, D2) reprendra les routes de (k) comme les autres.

## 9. Découpage en sous-lots

Ordre proposé, à confirmer par Nelson. Chaque sous-lot est une PR, avec le passage du `controleur-coherence` avant le code et avant la fusion.

| Sous-lot | Objet | Dépend de | Questions préalables | Auditeurs |
|---|---|---|---|---|
| K-0 | Cette proposition | — | — | `controleur-coherence` |
| **K-1a** | **Registre des abonnements** : modèle retenu (NK-01), saisie (client, site de facturation, lignes du catalogue ou saisies, quantité, prix HT, taux de TVA, périodicité, terme, durée d'engagement, reconduction choisie, date de signature, date de début), statuts minimaux (actif ; terminé par clôture motivée ; annulé seulement sans facture vivante), échéancier prévisionnel calculé jusqu'à la fin de l'engagement, journal, droits, écran à part (`Factures.tsx` compte déjà 740 lignes, règle permanente 2), matrice des droits | K-0 ; placement (NK-10) | NK-01 à NK-07 | `auditeur-montants`, `auditeur-droits-securite` |
| **K-1b** | **Facture d'une échéance, à la demande** : brouillon prérempli (lignes de l'abonnement, période), origine nouvelle, émission et envoi par le circuit existant ; une période, une facture vivante ; refus pour un abonnement annulé | K-1a | NK-08 ; QK-01 | `auditeur-montants`, `auditeur-droits-securite` |
| K-2 | Facturation périodique automatique : passage quotidien, brouillons ou émission selon NK-11, alerte, passage manuel | K-1b | NK-11 | idem |
| K-3 | Cycle de vie : fin d'engagement, reconduction, préavis, suspension, résiliation | K-1a | NK-12 à NK-15 ; QK-03 | idem |
| K-4 | Révision des prix | K-1b | NK-16 | `auditeur-montants` ; `auditeur-droits-securite` (qui applique) |
| K-5 | Conversion d'un devis en abonnement | K-1a ; lot 4 | NK-17, NK-18 | idem K-1 |
| K-6 | Location et financeurs : modèle, suivi | K-1a | NK-19 à NK-21 | idem K-1 |
| K-7 | API d'un financeur : simulations (variables d'environnement documentées, règle permanente 3) | K-6 | NK-22 | `auditeur-droits-securite` ; `auditeur-montants` (loyers affichés) |
| K-8 | Données des commissions, avec le lot (i) | lot (i) | NK-23 | `auditeur-montants` |
| K-9 | Prélèvement (mandat, fichier), seulement sur décision | FE-7 | NK-24 | idem K-1 |

**Premier sous-lot utile : K-1 (K-1a puis K-1b).** Il réalise le cœur de A4, « les abonnements sont facturés au client », sans automatisme ni règle non décidée : périodes entières ou prorata selon la réponse à NK-06, bloquante (aucun n'est proposé par défaut), pas de révision, pas de résiliation anticipée, pas de conversion depuis un devis, pas de location.

## 10. Questions

### 10.1 Pour Nelson, bloquantes pour K-1

| N | Question | Source | Enjeu |
|---|---|---|---|
| NK-01 | Modèle : option A, B ou C de la section 6 ? Un abonnement et un contrat de maintenance peuvent-ils être un même contrat (abonnement avec visites) ? | `MODELE-DONNEES-CIBLE.md` l. 16-22 ; vision l. 112 ; section 3.2 | Modèle de données ; doublon |
| NK-02 | Le moteur de facturation périodique vaut-il aussi pour un contrat de maintenance facturé au forfait (README : « échéances automatiques, prorata, renouvellement »), ou seulement pour les abonnements et les locations ? | README l. 30 ; `schema.prisma:1146` | Touche les contrats de maintenance du pilote |
| NK-03 | Quelles périodicités de facturation (mensuelle, trimestrielle, semestrielle, annuelle, autre) ? | — | Montants, paramètre |
| NK-04 | « terme échu ou à échoir, au choix » et « reconduction au choix : tacite ou non » : au choix pour chaque abonnement, ou réglés pour la société ? Pour chaque terme, à quelle date la facture d'une période est-elle établie ? | A4 | Dates des factures |
| NK-05 | Les périodes partent-elles de la date de début (périodes anniversaires) ou du calendrier (mois, trimestre civils) ? | — | Échéancier |
| NK-06 | Première ou dernière période incomplète, changement de quantité en cours de période : prorata, et sur quelle base, ou périodes entières seulement ? | README l. 30 | Montants |
| NK-07 | « durées d'engagement de 12 à 60 mois » : toute durée en mois entre 12 et 60, ou une liste de durées ? Un abonnement sans engagement est-il possible ? L'engagement court-il de la signature, du début de la facturation ou d'une mise en service ? | A4 | Paramètre ; échéancier |
| NK-08 | Une facture par échéance d'un abonnement, ou une facture par client et par période regroupant ses abonnements ? | `MODELE-DONNEES-CIBLE.md` l. 75 | Lien facture-échéance ; montants |
| NK-10 | Le cadrage étant fait, quand coder K-1 : avant, pendant ou après les lots FE-1 à FE-12, et après quels correctifs d'issues ? | Demande du 26-11-2026 (« cadrer ») ; ordre du 20-11-2026 ; section 2 de la passation, « Hors pilote » | Lot entier hors pilote |

### 10.2 Pour Nelson, plus tard (avant le sous-lot indiqué)

| N | Question | Sous-lot |
|---|---|---|
| NK-09 | Modifier les lignes d'un abonnement en cours, hors révision (avenant) : permis, et comment ? D'ici la réponse, une ligne déjà facturée ne se modifie pas (choix le plus restrictif, à confirmer) | K-1a, sans bloquer |
| NK-11 | Facturation automatique : brouillons à émettre, ou émission directe ? Au nom de qui (le compte système ne signe aujourd'hui que la génération des visites ; les gardes en base de ses écritures portent sur le journal SAV et les passages, aucune sur les factures) ? Envoi automatique ? Anticipation ? | K-2 |
| NK-12 | Reconduction tacite : pour quelle durée ? Sans reconduction : la facturation s'arrête-t-elle au terme ? | K-3 |
| NK-13 | Préavis de résiliation : délai, et qui le saisit ? | K-3 |
| NK-14 | Suspension : arrête-t-elle la facturation ? Prolonge-t-elle l'engagement ? | K-3 |
| NK-15 | Résiliation avant le terme : que facture-t-on ? Iris ne propose aucune indemnité | K-3 |
| NK-16 | Révision : quel calcul « habituel » proposer par défaut (passation, section 3, l. 522) ; à quelle date ; quel arrondi ; quelle information du client ? | K-4 |
| NK-17 | Conversions avec un abonnement : « intervention + abonnement » et « abonnement + contrat de maintenance » (23-10-2026) ; aussi chantier et abonnement ? Une troisième conversion par affaire (installation, maintenance et abonnement), au-delà de la limite de deux décidée le 23-10-2026 ? | K-5 |
| NK-18 | Comment un devis porte-t-il un prix récurrent : dans son total, dans l'acompte (40 % par défaut), sur son PDF et à sa signature ? | K-5 |
| NK-19 | Location par un financeur : qui facture le client ? Iris facture-t-il le financeur pour le matériel ? L'échéancier sert-il seulement au suivi ? | K-6 |
| NK-20 | Une location sans financeur (en propre) existe-t-elle ? | K-6 |
| NK-21 | Quels financeurs (A4 : « tels que Grenke » ; README : « Grenke, LPB ») ? Plusieurs par installation, choisis comme la plateforme agréée ? Lien avec le parc d'équipements ? | K-6 |
| NK-22 | API : simulations seules, ou aussi les dossiers (passation, section 3, l. 524) ? Accès partenaire, bac à sable, données du client transmises ? | K-7 |
| NK-23 | Commissions récurrentes (lot (i)) : réglage dans le plan ou dans les paramètres ; « montant mensuel » d'un abonnement non mensuel | K-8 |
| NK-24 | Prélèvement : mandat et fichier dans Iris, ou prélèvement saisi comme règlement (FE, N-13) ? | K-9 |
| NK-25 | Que recouvre « télécom », cité à part de (k) dans le hors pilote (facturation à la consommation, opérateurs, cartes SIM), ou rien de plus que l'abonnement ? | Avant tout sous-lot télécom |
| NK-26 | Module « Abonnements et locations » activable : actif ou non à l'installation ? | K-1a ou P2 |

### 10.3 Pour le cabinet (Nelson les porte)

| Q | Question | Sous-lot |
|---|---|---|
| QK-01 | Mentions de la facture d'une échéance : période couverte, date de la prestation ; exigibilité de la TVA selon le terme et l'option pour les débits (FE, N-01) | K-1b (bloquante) |
| QK-02 | Règles de TVA particulières à certains abonnements ou locations (taux, lieu de taxation) | K-1a, sans bloquer (les taux restent ceux du catalogue et des lignes) |
| QK-03 | Abonnements souscrits par un particulier : information avant reconduction, rétractation, résiliation (code de la consommation, selon notre lecture) | K-3 |
| QK-04 | Comptabilisation : comptes de produits, facture à échoir à cheval sur deux exercices | K-1b, sans bloquer (comptes paramétrables, aucun imposé) |
| QK-05 | E-reporting des abonnements et des loyers facturés à des particuliers | FE-8 |

## 11. Hors périmètre

Tout code avant la réponse aux questions bloquantes et le placement par Nelson (NK-10) ; le plan commercial (lot (i)), sauf les données notées en 8.2 ; la banque et le rapprochement ; toute reprise de données (règle 4).

## 12. Points documentaires

À traiter après la fusion de cette proposition, dans la PR documentaire du `documentaliste`, sans trancher aucune question :

| # | Point | Où |
|---|---|---|
| 1 | Renvoi vers cette proposition depuis la section « Contrats récurrents » et les points ouverts du modèle de données | `MODELE-DONNEES-CIBLE.md` |
| 2 | Renvoi depuis le lot (k) (section 2) et résumé des questions NK-01 à NK-26 et QK-01 à QK-05 (section 3), sans les recopier | `ROADMAP-PASSATION.md` |
| 3 | Modules 3 à 5 : télécom et LPB présentés comme exemples, prorata et renouvellement comme non décidés (E1, E2, E4) | `README.md` |
| 4 | Le texte de A4 est celui de la passation, écrit par #153 ; aucun message d'origine n'est consigné (section 2.1) | `HISTORIQUE-DECISIONS.md` |
| 5 | Commentaire d'état sur [#635](https://github.com/OrizonLab/iris/issues/635) : réponse de principe à sa N7 (section 8.1), sous réserve de Nelson | Issue #635 |

## 13. Choix par défaut de cette proposition, à confirmer

1. Portée de la fusion (en-tête).
2. Noms des sous-lots, K-0 à K-9, et ordre de la section 9 ; noms des questions, NK et QK.
3. Premier sous-lot : K-1, en deux PR (K-1a, K-1b).
4. Droits de K-1 : administration seule, en session, aucune clé d'intégration (section 7.3).
5. Origine de facture nouvelle (libellé proposé : *Abonnement*), plutôt que l'origine `CONTRAT`, affichée « Contrat de maintenance ».
6. Terme et reconduction : aucune valeur proposée à la création ; choisis à chaque abonnement.
7. Échéancier prévisionnel calculé jusqu'à la fin de l'engagement, avant K-3.
8. Facturation automatique désactivée à l'installation (K-2).
9. Période d'une facture d'échéance écrite dans la désignation de la ligne jusqu'à FE-2.
10. Journal des chantiers, interventions et contrats réutilisé, avec une cible propre.
11. Vocabulaire proposé : *abonnement*, *contrat de location*, *financeur* ; *Échéances à facturer* pour la liste des périodes dues, distincte de l'écran existant « Prêt à facturer ».
