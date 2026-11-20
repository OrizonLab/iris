# Facturation électronique : connexion à une plateforme agréée

> **PR a du lot FE-DOC**, rédigée le 19-11-2026 sur `main` à `f1d3ef3`, après la fusion de la [proposition](FACTURATION-ELECTRONIQUE-CIBLE.md) (#620, lot FE-0). Elle suit la [fiche FE-DOC](FACTURATION-ELECTRONIQUE-CIBLE.md#fe-doc--connexion-à-une-pa-et-déploiement) de la proposition et le cadrage de Nelson du 19-11-2026 ([historique](HISTORIQUE-DECISIONS.md#décision-du-19-11-2026-sur-la-facturation-électronique)), mot pour mot : « docs/FACTURATION-ELECTRONIQUE-CONNEXION-PA.md : critères de choix d'une PA (inscrite sur la liste officielle DGFiP, version de XP Z12-013, flux couverts, formats, bac à sable, notifications, archivage, réversibilité), puis la connexion pas à pas. »
>
> **Statut.**
> - **Sections 1 à 6 : utilisables dès maintenant.** Le contrat avec une PA doit précéder la recette, que Nelson demande ainsi : « une recette sur le bac à sable d'une PA avant le 01-06-2027 » ([proposition](FACTURATION-ELECTRONIQUE-CIBLE.md#84-ordre-et-faisabilité-de-la-recette), section 8.4).
> - **Section 7, connexion pas à pas : prévue** (PR b de FE-DOC, avec FE-4 et FE-5). Rien n'existe encore dans Iris : ni connecteur, ni écran Connecteurs, ni variable, ni `npm run efacture:verifier`, ni bouton « Tester la connexion ».
> - **Le choix de la PA revient à Nelson** (N-02). Ce document ne nomme ni ne recommande aucune PA : la liste officielle (S10) n'a pas pu être lue.
>
> Ce document ne vaut pas avis juridique. Les points juridiques sont posés au cabinet en questions (section 6) ; aucune règle nouvelle n'est créée.

Les identifiants S1 à S20 (sources), EX-01 à EX-52 (exigences), N-01 à N-17 et Q-01 à Q-25 (questions) sont ceux de la proposition : [registre des sources](FACTURATION-ELECTRONIQUE-CIBLE.md#21-registre), [questions pour Nelson](FACTURATION-ELECTRONIQUE-CIBLE.md#111-pour-nelson), [questions pour le cabinet](FACTURATION-ELECTRONIQUE-CIBLE.md#112-pour-le-cabinet). Le détail des exigences et leurs extraits sont dans l'[annexe](FACTURATION-ELECTRONIQUE-EXIGENCES.md).

## 1. Rôle de la PA et rôle d'Iris

- Cadrage de Nelson : « Iris reste une solution compatible : il produit, valide, reçoit et suit les factures ; la plateforme agréée (PA) de chaque installation les transmet. Aucune immatriculation pour nous. »
- La PA de la société transmet ses factures et avoirs, reçoit ses factures fournisseurs, transmet à l'administration le flux 1, les statuts obligatoires et l'e-reporting, et inscrit ses adresses de réception à l'annuaire (EX-01, EX-44).
- Iris lui parlera par l'API XP Z12-013 (S4), au moyen de l'adaptateur `ElectronicInvoicingProvider` (prévu, FE-4). Nelson : « Un adaptateur propriétaire seulement si la PA retenue n'implémente pas la norme, et sur ma décision. »
- Nelson : « Une PA par installation, activée par SUPERADMIN dans l'écran Connecteurs. »
- La réception par une PA est déjà obligatoire (texte légal non vérifié) : voir [« Avant même Iris »](FACTURATION-ELECTRONIQUE-DEPLOIEMENT.md#1-avant-même-iris) dans la liste de contrôle du déploiement.
- **Chaque installation choisit sa PA** (réponse de Nelson du 20-11-2026, [historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-20-11-2026-sur-la-facturation-électronique) ; lecture retenue, à corriger par Nelson si besoin) : aucune PA n'est choisie à cette date, Iris n'en impose aucune et se connecte, comme les produits compatibles, à la plateforme agréée de l'installation. Cela confirme le principe ci-dessus (adaptateur XP Z12-013 ; adaptateur propriétaire sur décision de Nelson).
- **PA déjà en place** (choix par défaut, à confirmer) : si la société a déjà une PA de réception (N-01), cette PA est évaluée la première avec la grille de la section 3. Une installation n'a qu'une PA : écarter celle-ci imposerait un changement de PA (critère 8).

## 2. Critères de choix

Chaque critère donne ce qu'il faut vérifier, pourquoi Iris en a besoin, comment le vérifier, puis ce qui est éliminatoire et ce qui est souhaitable. **Le classement éliminatoire ou souhaitable est un choix par défaut, à confirmer par Nelson** (N-02) ; il s'appuie sur le classement des exigences de la proposition (obligatoire, recommandé) et sur ce dont les lots FE-4 à FE-10 et la recette ont besoin ; il peut donc être plus strict qu'une exigence recommandée (critères 5, 6 et 8).

### 2.1 Critère 1 : inscription sur la liste officielle de la DGFiP

- **À vérifier.** La PA figure sur la liste des plateformes agréées publiée par la DGFiP (S10, page indiquée modifiée le 29-10-2026). **Non vérifié** : le site était inaccessible lors de l'audit. Selon l'annexe, la page contient deux listes :
  - les PA immatriculées ;
  - les PA immatriculées sous réserve des tests d'interopérabilité.
- **Pourquoi.** Seule une PA échange les factures B2B domestiques et transmet au PPF le flux 1, l'e-reporting et les statuts obligatoires (EX-01). S3 §1.1, vérifié : « Les Plateformes Agréées sont les seules habilitées (et immatriculées pour cela) à échanger les factures relevant du périmètre "e-invoicing" […] et à transmettre les flux 1, les flux 10 (e-reporting) et les statuts dits "obligatoires" au Concentrateur de Données du PPF. »
- **Comment.** Lire la page S10 le jour du choix, puis de nouveau avant la mise en production, et en garder une copie datée. Demander à la PA le justificatif de son immatriculation et la liste où elle figure.
- **Éliminatoire.** Absente des deux listes.
- **Seconde liste** (choix par défaut, à confirmer). Admise pour le contrat et le bac à sable. Avant la production, la PA doit figurer sur la première liste, sauf réponse contraire du cabinet (Q-PA-1).
- **Souhaitable.** L'engagement écrit de prévenir la société de toute suspension ou perte de l'immatriculation (section 5).

### 2.2 Critère 2 : version de XP Z12-013

- **À vérifier.**
  - Les services AFNOR « Flow Service » 1.3.0 et « Directory Service » 1.3.0 (S4, OpenAPI 3.0.3, vérifiés).
  - L'authentification : OAuth2 « client credentials » (identifiant et secret client) ou jeton Bearer (JWT), seuls schémas de la spécification.
  - Les en-têtes `Request-Id` (corrélation des journaux) et `Organization-Id` (délégation entre plusieurs entités), facultatifs dans la spécification.
  - `trackingId`, identifiant libre de l'émetteur (64 caractères au plus en 1.3.0), gardé par la PA et utilisable comme filtre de recherche.
  - `sha256`, empreinte du fichier : si Iris la fournit au dépôt, la PA devrait la contrôler ; sinon, elle peut la calculer et la renvoyer (« should » et « may » dans la spécification).
- **Pourquoi.** L'adaptateur de FE-4 vise cette version (EX-50 à EX-52). `trackingId` sert l'idempotence des dépôts (FE-5). `sha256` sert l'intégrité de la pièce conservée (EX-47, FE-5, FE-10). L'API n'est pas obligatoire pour une PA (EX-50) ; l'arrêté du 27-07-2026 imposerait la norme à celle qui en offre une (S16, non vérifié).
- **Comment.** Demander l'OpenAPI publiée par la PA, sa version, ses écarts déclarés à la norme, et les URL de base des deux services : le modèle d'URL de la norme est paramétrable. Sur le bac à sable : obtenir un jeton ; appeler `GET /v1/healthcheck` sur chaque service ; déposer un flux avec `trackingId` et `sha256`, puis le retrouver par `POST /v1/flows/search`.
- **Éliminatoire.** Rien d'office. Sans API XP Z12-013, il faudrait un adaptateur propriétaire, sur décision de Nelson : la PA lui est soumise avant toute suite.
- **Souhaitable.** Les deux services en 1.3.0 ; OAuth2 « client credentials », retenu par FE-4 ; un délai annoncé pour adopter les versions suivantes. Une version antérieure à 1.3.0 ou un jeton fixe seul sont des écarts à lister avant FE-4 (N-02).

### 2.3 Critère 3 : flux couverts

- **À vérifier.** Chaque flux est offert par la PA et accessible par son API.

  | Flux | Ce que la PA doit permettre | Exigences | Lot |
  |---|---|---|---|
  | Émission | Dépôt des factures et des avoirs (`CustomerInvoice`) ; `processingRule`, dont `ArchiveOnly` pour un avoir interne | EX-01, EX-03 | FE-5 |
  | Réception | Livraison des factures fournisseurs (`SupplierInvoice`, direction `In`), avec l'original et une vue lisible | EX-35, EX-36 | FE-9 |
  | Statuts reçus | Cycle de vie des ventes (`CustomerInvoiceLC`) : Déposée, Rejetée, Refusée, Irrecevable, Erreur de routage, Mise à disposition… | EX-24, EX-25, EX-29 | FE-5 |
  | Statuts envoyés | Encaissée sur les ventes ; Prise en charge, Approuvée, En litige, Refusée sur les achats ; par l'API en CDAR, ou dans un format de la PA | EX-27, EX-30, EX-32, EX-34 | FE-7, FE-9 |
  | E-reporting | Transactions (10.1, 10.3) et paiements (10.2, 10.4) | EX-38 à EX-40 | FE-8 |
  | Annuaire | Consultation (Directory Service) ; inscription des adresses de réception de la société | EX-43, EX-44, EX-51 | FE-1, FE-4 |
  | Clients publics | Chorus Pro, si N-10 le demande | EX-04 | FE-11 |

- **Pourquoi.** Cadrage de Nelson : « Adaptateur ElectronicInvoicingProvider sur l'API XP Z12-013 (factures, statuts, e-reporting, annuaire). »
- **Comment.** Demander la liste des types de flux (`FlowType`) acceptés en dépôt et livrés en lecture. Sur le bac à sable, faire passer un flux de chaque type de bout en bout (section 7.5).
- **Éliminatoire.** L'un de ces flux absent de l'offre de la PA : émission, réception, statuts obligatoires (Déposée 200, Rejetée 213, Refusée 210, Encaissée 212), e-reporting, consultation et inscription à l'annuaire.
- **À arbitrer.** Un flux offert dans l'interface de la PA mais pas par son API : Iris ne peut pas l'automatiser. Nelson tranche (N-02).
- **Souhaitable.** Les statuts facultatifs utiles (202, 203, 204, 205, 207, 211) ; Chorus Pro, si N-10 le demande. Qui construit l'e-reporting, Iris ou la PA, est à préciser par le questionnaire (section 4).

### 2.4 Critère 4 : formats

- **À vérifier.**
  - En émission : Factur-X profil EN16931 (PDF/A-3 qui embarque le CII), UBL 2.1 (Invoice et CreditNote), CII D22B. EXTENDED-CTC-FR « seulement si un cas d'usage l'exige » (cadrage). Factur-X est le format transmis par défaut (proposition, section 13, choix 5, à confirmer).
  - En réception : tous les formats et profils du socle, EXTENDED-CTC-FR et BASIC WL compris (EX-36), avec l'original et une vue lisible (`docType` `Original` et `ReadableView`).
  - Validation par la PA : XSD, schematron EN16931, schematron BR-FR en mode FATAL (EX-07), et les versions de ces artefacts.
  - Retour des rejets : `ackStatus` `Error` avec son détail (`item`, `reasonCode`, `reasonMessage`) ; statut Irrecevable (501) ou Rejetée (213) avec un motif de la liste officielle (EX-27).
- **Pourquoi.** FE-3 valide chaque pièce avec les artefacts officiels (S1, S6) avant de lui donner un numéro. Des versions différentes chez la PA produiraient des rejets imprévus. Un rejet sans motif ne peut être ni affiché (FE-5) ni corrigé (FE-6).
- **Comment.** Demander les versions des artefacts appliqués et le délai de leur mise à jour. Sur le bac à sable, déposer :
  - une pièce valide : Déposée attendue ;
  - une pièce au XML mal formé : Irrecevable attendue ;
  - une pièce qui viole une règle BR-FR : Rejetée attendue, avec la règle citée.
- **Éliminatoire.** Aucune des trois syntaxes acceptée en profil EN16931 ; des factures reçues livrées dans un format qu'Iris ne peut pas traiter ; des rejets sans motif.
- **Souhaitable.** Les trois syntaxes ; des versions d'artefacts publiées ; l'identifiant de la règle en échec dans chaque rejet.

### 2.5 Critère 5 : bac à sable

- **À vérifier.**
  - Un environnement de test distinct de la production, à la même version de l'API, avec ses propres identifiants.
  - Les six vérifications du contrôle de compatibilité ([proposition](FACTURATION-ELECTRONIQUE-CIBLE.md#43-composants), section 4.3) : authentification, annuaire, dépôt jusqu'au statut Déposée, réception d'une facture test, envoi de statuts, e-reporting test.
  - La simulation des statuts posés par un client (Refusée, En litige) et des rejets, pour les parcours de FE-5 et FE-6.
  - La date d'ouverture de l'accès, sa durée et son coût.
- **Pourquoi.** La recette se fait sur ce bac à sable (proposition, section 8.4). Les critères de FE-4, FE-8 et FE-9 s'y vérifient. La variable proposée `EFACTURE_PA_ENVIRONNEMENT` distingue `bac-a-sable` et `production` (section 7.3).
- **Comment.** Demander la documentation du bac à sable et une date d'accès. Premier essai : un jeton, puis `GET /v1/healthcheck`.
- **Éliminatoire.** Pas de bac à sable ; un accès impossible avant la fin de FE-4 (proposition, section 8.4) ; l'une des six vérifications impossible, sauf pour un flux que la PA n'offre que dans son interface, soumis à Nelson (critère 3, « À arbitrer »).
- **Souhaitable.** Une facture fournisseur de test déposable à la demande ; des statuts acheteur simulables ; un accès maintenu après la recette, pour les tests de non-régression.

### 2.6 Critère 6 : notifications

- **À vérifier.**
  - **Interrogation périodique** : `POST /v1/flows/search` avec le filtre `updatedAfter`, la pagination par curseur de la version 1.3.0 (`cursor`, `nextCursor`), et les limites d'appel de la PA.
  - **Webhook** : abonnement par `POST /v1/webhooks`, dont la réponse porte une clé de signature (`signingKey`, de 256 ou 512 bits selon la description de l'opération). Chaque rappel en POST porte l'en-tête `Afnor-Signature` (HMAC-SHA-256 en Base64, facultatif dans la spécification) et l'en-tête `Afnor-Signature-Timestamp` (obligatoire).
- **Pourquoi.** Iris suit les statuts (FE-5) et les factures reçues (FE-9). Cadrage : « Un webhook éventuel est authentifié, filtré et testé ; sinon, interrogation périodique. » L'interrogation périodique est le mode par défaut (proposition, section 13, choix 6, à confirmer). Un webhook ouvre dans Iris une route joignable depuis Internet, sans session ; l'interrogation périodique n'en ouvre aucune.
- **Comment.** Demander les limites d'appel, si la PA renvoie la clé et signe chaque rappel, comment la renouveler, et la politique de nouvel essai des rappels. Sur le bac à sable : interroger avec `updatedAfter` après un dépôt ; pour un webhook, vérifier un rappel signé, puis le refus d'un rappel mal signé, non signé, ou rejoué avec un horodatage trop ancien : la signature porte sur la charge utile et sur l'horodatage `Afnor-Signature-Timestamp`.
- **Pour FE-4, si un webhook est retenu** (choix par défaut, à confirmer) : signature exigée, vérifiée en temps constant sur le corps brut ; horodatage hors d'une fenêtre courte refusé ; rappel traité comme un simple avis, l'état du flux étant relu par `GET /v1/flows/{flowId}` avec le jeton d'Iris ; traitement idempotent ; corps borné ; refus sans détail ; route inscrite dans la référence des routes avec sa garde.
- **Éliminatoire.** Ni recherche par `updatedAfter`, ni webhook signé.
- **Souhaitable.** Un webhook signé, à la clé renouvelable ; des limites d'appel publiées.

### 2.7 Critère 7 : archivage

- **À vérifier.** Ce que la PA conserve (fichiers émis et reçus : original, conversion, vue lisible ; statuts ; preuves), pendant combien de temps, dans quel format, avec quelle preuve d'intégrité. Combien de temps l'original reste téléchargeable par l'API (`GET /v1/flows/{flowId}`, `docType` `Original`). Quel export complet est possible.
- **Pourquoi.**
  - Conservation dans le format d'origine, statuts Rejetée et Refusée compris (EX-46) ; intégrité et lisibilité (EX-47).
  - Qui conserve, combien de temps, et si la piste d'audit fiable reste due : questions au cabinet (Q-11, Q-12). Le lieu : question à Nelson (N-16).
  - Iris conservera de son côté la pièce transmise et son empreinte (FE-5), les fichiers reçus (FE-9), puis les restituera (FE-10).
- **Comment.** Demander les conditions d'archivage écrites. Sur le bac à sable : retélécharger l'original d'un flux et comparer son empreinte.
- **Éliminatoire** (choix par défaut, à confirmer). Pas de téléchargement par l'API de l'original de chaque flux émis ou reçu, ni de ses statuts : Iris en a besoin pour sa propre conservation.
- **Non éliminatoire.** L'absence de service d'archivage chez la PA, tant que Q-11 n'est pas tranchée : Iris conserve.
- **Souhaitable.** Une durée de conservation au moins égale à celle que retiendra le cabinet (6 ou 10 ans selon des sources non vérifiées, EX-46) ; un export complet en fin de contrat.

### 2.8 Critère 8 : réversibilité et changement de PA

- **À vérifier.**
  - La documentation de mobilité, que chaque PA fournirait gratuitement (EX-49 ; S17, non vérifié).
  - La procédure de changement : accord formel daté et signé ; délais de 2, 5 et 3 jours ouvrés (S17, non vérifiés).
  - Le « service minimal » de 12 mois maintenu par l'ancienne PA (S3 §1.4.5.1, vérifié ; base légale et contenu : Q-16).
  - L'export de toutes les données en fin de contrat : fichiers, statuts, preuves.
- **Pourquoi.** Iris garde, pour chaque transmission, la PA et l'adresse utilisées, et accepte les statuts venus d'une autre PA (EX-49, FE-4, FE-5). Iris reste sa propre source de vérité : un changement de PA ne doit rien lui faire perdre.
- **Comment.** Demander la documentation de mobilité et les clauses de sortie. Pas d'essai sur le bac à sable.
- **Éliminatoire.** Pas d'export des données en fin de contrat ; la documentation de mobilité refusée.
- **Souhaitable.** Pas de frais de sortie ; un export dans les formats de la norme ; la livraison documentée des statuts arrivés après le départ.

## 3. Grille d'évaluation

- Une colonne par PA candidate, désignée par une lettre. Aucune PA n'est nommée ici.
- Une case reçoit « oui », « non », « partiel » ou « inconnu », avec le renvoi à sa preuve.
- La grille remplie et datée est conservée avec ses preuves hors du dépôt, et jointe à la décision de Nelson (N-02) (choix par défaut, à confirmer).

| # | Point | Classement | PA A | PA B | PA C | Preuve |
|---|---|---|---|---|---|---|
| 1.1 | Sur la liste des PA immatriculées (S10) | Éliminatoire, sauf 1.2 | | | | Copie datée de S10 |
| 1.2 | Sinon, sur la liste sous réserve des tests d'interopérabilité | Contrat et bac à sable seulement (Q-PA-1) | | | | Copie datée de S10 |
| 2.1 | Flow Service 1.3.0 | Souhaitable ; sans API : décision de Nelson | | | | OpenAPI de la PA |
| 2.2 | Directory Service 1.3.0 | Souhaitable ; sans API : décision de Nelson | | | | OpenAPI de la PA |
| 2.3 | OAuth2 « client credentials » | Souhaitable | | | | Documentation |
| 2.4 | `trackingId` et `sha256` gardés et renvoyés | Souhaitable | | | | Essai sur bac à sable |
| 3.1 | Émission par l'API | Éliminatoire si absent de l'offre ; interface seule : décision de Nelson | | | | |
| 3.2 | Réception par l'API | Éliminatoire si absent de l'offre ; interface seule : décision de Nelson | | | | |
| 3.3 | Statuts obligatoires dans les deux sens | Éliminatoire si absent de l'offre ; interface seule : décision de Nelson | | | | |
| 3.4 | Statuts facultatifs utiles | Souhaitable | | | | |
| 3.5 | E-reporting des transactions et des paiements | Éliminatoire si absent de l'offre ; interface seule : décision de Nelson | | | | |
| 3.6 | Annuaire : consultation et inscription | Éliminatoire si absent de l'offre ; interface seule : décision de Nelson | | | | |
| 3.7 | Chorus Pro | Selon N-10 | | | | |
| 4.1 | Factur-X EN16931, UBL 2.1 ou CII D22B en émission | Éliminatoire si aucun | | | | |
| 4.2 | Tous les formats du socle en réception | Éliminatoire | | | | |
| 4.3 | Versions des artefacts de validation publiées | Souhaitable | | | | |
| 4.4 | Rejet avec motif officiel et règle en échec | Éliminatoire sans motif | | | | Essai sur bac à sable |
| 5.1 | Bac à sable ouvert avant la fin de FE-4 | Éliminatoire | | | | Date d'accès écrite |
| 5.2 | Six vérifications du contrôle possibles | Éliminatoire, sauf flux soumis à Nelson (critère 3) | | | | Essai sur bac à sable |
| 5.3 | Statuts acheteur et rejets simulables | Souhaitable | | | | |
| 6.1 | Recherche par `updatedAfter` | Éliminatoire s'il n'y a pas de webhook signé | | | | |
| 6.2 | Webhook signé, clé renouvelable | Souhaitable | | | | |
| 7.1 | Original et statuts téléchargeables par l'API | Éliminatoire | | | | |
| 7.2 | Archivage chez la PA, durée | Selon Q-11 | | | | Conditions écrites |
| 8.1 | Documentation de mobilité fournie | Éliminatoire si refusée | | | | |
| 8.2 | Export complet en fin de contrat | Éliminatoire | | | | Clause du contrat |
| 8.3 | Pas de frais de sortie | Souhaitable | | | | |
| 9 | Points contractuels (section 5) | Décision de Nelson | | | | Projet de contrat |
| 10 | Sécurité (questions 35 à 39) | Décision de Nelson ; Q-PA-2 | | | | Réponses écrites |

## 4. Questionnaire aux PA candidates

À envoyer tel quel. Les réponses écrites sont des preuves de la grille.

**Inscription**
1. Sur quelle liste de la DGFiP figurez-vous, et depuis quelle date ? Pouvez-vous en fournir le justificatif ?
2. Si vous êtes immatriculée sous réserve des tests d'interopérabilité, quand ces tests s'achèvent-ils ?
3. Vous engagez-vous à prévenir vos clients de toute suspension ou perte de votre immatriculation ?

**API XP Z12-013**
4. Offrez-vous l'API XP Z12-013 ? En quelle version pour le Flow Service et pour le Directory Service ? Pouvez-vous fournir votre OpenAPI ?
5. Quels écarts à la norme déclarez-vous ? Sous quel délai adoptez-vous une nouvelle version ?
6. Quelle authentification proposez-vous : OAuth2 « client credentials », jeton fixe ? Quelle durée de vie pour le jeton ? Comment renouvelle-t-on le secret ?
7. Utilisez-vous l'en-tête `Organization-Id` ? Quelle valeur pour une société seule ?
8. Que faites-vous d'un second dépôt qui porte le même `trackingId` ?
9. Contrôlez-vous l'empreinte `sha256` fournie au dépôt ? La renvoyez-vous ?

**Flux**
10. Quels types de flux (`FlowType`) acceptez-vous en dépôt ? Lesquels livrez-vous en lecture ?
11. Extrayez-vous vous-même le flux 1 de chaque facture déposée ?
12. Comment recevez-vous les statuts que nous posons : en CDAR par l'API, dans votre propre format, ou seulement dans votre interface ?
13. Exigez-vous la note `BAR` ou le champ `processingRule` ? Honorez-vous `ArchiveOnly` pour un avoir interne ?
14. Quels statuts facultatifs nous transmettez-vous (202, 203, 204, 205, 207, 211) ?
15. Pour l'e-reporting, déposons-nous un fichier complet (syntaxe `FRR`), ou le calculez-vous à partir des factures et des paiements ? Quels sous-flux couvrez-vous (10.1 à 10.4) ?
16. Inscrivez-vous les adresses de réception de la société dans l'annuaire ? Sous quelles formes (`SIREN`, `SIREN_SUFFIXE`…) et sous quel délai ?
17. Que devient une facture adressée à un client présent dans l'annuaire sans PA active (Déposée `NON_TRANSMISE`) ?
18. Transmettez-vous les factures aux entités publiques (Chorus Pro) ?

**Formats et validation**
19. Quels formats et profils acceptez-vous en émission ? Sous quelles formes livrez-vous les factures reçues (original, conversion, vue lisible) ?
20. Quelles versions des artefacts appliquez-vous (XSD, schematrons EN16931 et BR-FR) ? Sous quel délai les mettez-vous à jour ?
21. Comment un rejet nous est-il rendu : statut, motif, règle en échec, message ?

**Bac à sable**
22. Avez-vous un bac à sable à la même version que la production ? Date d'accès, durée, coût ?
23. Peut-on y simuler une facture fournisseur reçue, un refus, un litige, un rejet ?
24. Y a-t-il un annuaire de test ? Avec quels identifiants d'entreprise ?

**Notifications**
25. Quelles limites d'appel s'appliquent à `POST /v1/flows/search` ?
26. Renvoyez-vous la clé `signingKey` à l'abonnement, et signez-vous chaque rappel de webhook (`Afnor-Signature`) ? Comment renouvelle-t-on la clé ? Quelle politique de nouvel essai appliquez-vous ? Depuis quelles adresses vos rappels partent-ils ?

**Archivage**
27. Que conservez-vous, combien de temps, dans quel format, avec quelle preuve d'intégrité ?
28. Combien de temps l'original d'un flux reste-t-il téléchargeable par l'API ?

**Réversibilité**
29. Pouvez-vous fournir votre documentation de mobilité, vos clauses de sortie et leurs frais ?
30. Quel export complet fournissez-vous en fin de contrat, sous quel délai et dans quels formats ?
31. Comment assurez-vous le service minimal après le départ d'un client (XP Z12-014, annexe A, §1.4.5.1) ?

**Contrat**
32. Quels sont vos tarifs : abonnement, facture émise ou reçue, flux d'e-reporting, bac à sable, mise en service, sortie ?
33. Quel engagement de service prenez-vous : disponibilité, support, délais en cas d'incident, maintenances annoncées ?
34. Quels sont vos sous-traitants et vos hébergeurs ? Où sont stockées les données et leurs sauvegardes ?

**Sécurité**
35. Quelle version minimale de TLS imposez-vous sur l'API ? Proposez-vous une authentification mutuelle ou un filtrage des adresses d'appel ?
36. Un identifiant client peut-il être limité à une seule société et à certaines opérations ? Comment révoque-t-on un identifiant compromis, et sous quel délai ?
37. L'accès à votre interface web exige-t-il une double authentification ? Qui, chez vous, peut lire nos factures ? Ces accès sont-ils journalisés et consultables par nous ?
38. Comment et sous quel délai nous prévenez-vous d'un incident de sécurité ou d'une violation de données personnelles ?
39. Les données sont-elles chiffrées au repos ? Disposez-vous d'une certification de sécurité, et sur quel périmètre ?

## 5. Points contractuels

Aucun montant ni seuil n'est fixé ici. Le coût et l'arbitrage entre les offres reviennent à Nelson (N-02).

| Point | À obtenir par écrit | Question liée |
|---|---|---|
| Coût | Abonnement ; prix par facture émise ou reçue, par flux d'e-reporting, par statut ; bac à sable ; mise en service ; sortie ; révision des prix | N-02 |
| Engagement de service | Disponibilité ; délai de traitement d'un dépôt ; support (horaires, délais) ; annonce des incidents et des maintenances ; délai d'adoption des nouvelles versions des normes et des artefacts ; ce qui s'applique en cas de manquement | Q-PA-3 |
| Sous-traitance | Liste des sous-traitants (hébergeur, autre PA) ; information préalable de tout changement | Q-PA-2 |
| Localisation des données | Pays où sont stockées les données et leurs sauvegardes ; transferts hors de l'Union européenne | Q-PA-2 |
| Fin de contrat | Export complet (fichiers, statuts, preuves) ; délai de restitution ; durée d'accès après la fin ; suppression et sa preuve ; archives que la PA garde ; service minimal | Q-11, Q-16 |
| Immatriculation | Information de la société en cas de suspension ou de perte ; ce qui se passe alors | Q-PA-1, Q-PA-3 |
| Signataire | Qui conclut le contrat, et au nom de qui | N-PA-1 (répondue le 20-11-2026 : la société, section 6) |

## 6. Questions nouvelles

Numérotées à part, pour ne pas heurter la numérotation de la proposition. Elles sont reportées dans sa [section 11](FACTURATION-ELECTRONIQUE-CIBLE.md#11-questions), avec leurs identifiants, par la PR documentaire qui a suivi la fusion de #624 (choix par défaut, à confirmer).

**Pour le cabinet.**

| Q | Question | Source | Enjeu |
|---|---|---|---|
| Q-PA-1 | Une PA immatriculée sous réserve des tests d'interopérabilité (seconde liste de S10) peut-elle transmettre en production pour la société ? Que doit faire la société si cette réserve n'est pas levée ? | S10 (non vérifiée) | Critère 1 |
| Q-PA-2 | La PA reçoit des données personnelles, notamment celles des clients particuliers. Quel est son rôle au regard du RGPD ? Faut-il un accord écrit sur ces données ? Des exigences de localisation et de sous-traitance ? | Aucune source du registre | Points contractuels |
| Q-PA-3 | Si la PA est indisponible, perd son immatriculation ou se trompe (rejet à tort, statut non transmis), quelles clauses exiger ? Quelles obligations pèsent sur la société dans l'intervalle ? | S3 §1.4.5 ; Q-17 | Engagement de service ; continuité |

**Pour Nelson.**

| N | Question | Source | Enjeu |
|---|---|---|---|
| N-PA-1 | Qui conclut le contrat avec la PA : la société de l'installation, en son nom, ou vous, pour son compte ? Pour le pilote, qui le signe ? **Répondue le 20-11-2026** : « la société normalement » (réponse de Nelson, citée dans l'[historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-20-11-2026-sur-la-facturation-électronique)). Lecture retenue, à corriger par Nelson si besoin : la société signe le contrat avec sa PA, c'est l'usage, l'obligation pesant sur l'assujetti ; le point juridique reste au cabinet (Q-PA-3). | Cadrage (« PA choisie et contrat signé ») ; EX-49 (accord formel signé par l'assujetti ou son mandataire, non vérifié) | Contrat ; changement de PA |

## 7. Connexion pas à pas

> **Prévu (PR b de FE-DOC, avec FE-4 et FE-5).** Ce plan fixe l'ordre des étapes. Les écrans, commandes et variables seront décrits quand ils existeront.

### 7.1 Prérequis

- PA choisie, contrat signé, accès au bac à sable (sections 2 à 5 ; [liste de contrôle](FACTURATION-ELECTRONIQUE-DEPLOIEMENT.md#42-pa-choisie-et-contrat-signé), point 2).
- Identité fiscale de la société saisie (FE-1). Critère de FE-1 : « une société sans SIREN ne peut pas activer le connecteur ».
- Un compte `SUPERADMIN`, seul à activer le connecteur.

### 7.2 Identifiants fournis par la PA

Pour le bac à sable, puis pour la production : URL du Flow Service, URL du Directory Service, URL du jeton, identifiant client, secret client, et `Organization-Id` si la PA l'exige.

### 7.3 Variables d'environnement

- **Noms proposés** par la proposition (fiches FE-3 et FE-4 ; section 13, choix 9). Aucune n'est lue par le code au 19-11-2026.
- Le lot qui les lira les documente dans la même PR, selon la règle permanente 3 : dans `server/.env.example`, dans la liste de rappel en tête de `.env.example` et dans [`CONFIGURATION-ENVIRONNEMENT.md`](CONFIGURATION-ENVIRONNEMENT.md). `server/tests/environnement.test.mjs` le vérifie alors en CI.
- Cette PR n'ajoute ni ne modifie aucune variable.
- Réponse de Nelson du 20-11-2026 ([historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-20-11-2026-sur-la-facturation-électronique)) : chaque installation choisit sa PA. Lecture retenue, à corriger par Nelson si besoin : le nom et les adresses de la PA pourraient devenir des réglages de l'écran Connecteurs, journalisés, plutôt que des variables `EFACTURE_PA_URL_*` ; les identifiants secrets restent en variables. Les noms du tableau ci-dessous sont donc la proposition d'origine, à trancher au cadrage de FE-4 ; le choix par défaut 11 (section 8) n'est pas modifié ici.

| Variable proposée | Rôle | Remarque | Lot |
|---|---|---|---|
| `EFACTURE_PA_URL_FLOW` | URL du Flow Service | | FE-4 |
| `EFACTURE_PA_URL_ANNUAIRE` | URL du Directory Service | | FE-4 |
| `EFACTURE_PA_URL_JETON` | URL d'obtention du jeton OAuth2 | | FE-4 |
| `EFACTURE_PA_CLIENT_ID` | Identifiant client OAuth2 | | FE-4 |
| `EFACTURE_PA_CLIENT_SECRET` | Secret client OAuth2 | Secret | FE-4 |
| `EFACTURE_PA_ORGANIZATION_ID` | En-tête `Organization-Id` | Facultative | FE-4 |
| `EFACTURE_PA_ENVIRONNEMENT` | `bac-a-sable` ou `production` | | FE-4 |
| `EFACTURE_WEBHOOK_SECRET` | Vérification de la signature des rappels | Secret ; seulement avec un webhook | FE-4 |
| `EFACTURE_VALIDATEUR_URL` | Adresse du service de validation | Selon N-15 | FE-3 |

Avec la norme, la clé de signature d'un webhook est renvoyée à l'abonnement (`signingKey`, critère 6), et le schéma `Webhook` de la liste des abonnements (`GET /v1/webhooks`) la reprend : FE-4 dira si `EFACTURE_WEBHOOK_SECRET` reste utile. Dans tous les cas, la clé suit le cadrage (« Secrets en variables d'environnement documentées ») : jamais écrite en base, dans un journal ni dans le dépôt ; sans variable, elle serait relue au démarrage et gardée en mémoire seule (choix par défaut, à confirmer). Le stockage des fichiers conservés pourra demander d'autres variables, selon N-16 (FE-10). Critère de FE-4 : « sans variables, le connecteur ne s'active pas et Iris fonctionne comme avant ».

Pour FE-4 (choix par défaut, à confirmer) :
- Les adresses `EFACTURE_PA_URL_*` reçoivent le secret client et le jeton : `https` seulement, sans identifiants dans l'adresse, redirections refusées, adresse locale admise pour le faux serveur des tests, valeur refusée au démarrage, comme `MICROSOFT_GRAPH_URL` ([configuration](CONFIGURATION-ENVIRONNEMENT.md#envoi-des-documents-par-microsoft-365)).
- `EFACTURE_PA_ENVIRONNEMENT` n'a pas de valeur par défaut : absente, ou autre que `bac-a-sable` ou `production`, le connecteur ne s'active pas. Chaque transmission et chaque statut gardent l'environnement où ils ont eu lieu.
- Le secret client se reçoit de la PA par un canal sûr et se garde dans `server/.env` et dans un gestionnaire de mots de passe, comme le jeton de secours. Il se renouvelle selon la procédure de la PA (question 6) ; après une fuite, il est révoqué chez la PA, puis remplacé, et le conteneur du backend recréé.

### 7.4 Activation dans l'écran Connecteurs

Prévu (FE-4) : le `SUPERADMIN` active le connecteur ; l'écran affiche l'environnement ; le changement est journalisé ; aucun secret n'apparaît dans un journal, une réponse ou l'écran (critère de FE-4). Aucune clé d'intégration n'active le connecteur, ne lit sa configuration ni ne lance le contrôle (choix par défaut, à confirmer).

### 7.5 Contrôle de compatibilité

Prévu (FE-4) : la commande `npm run efacture:verifier` et le bouton « Tester la connexion ». Sur le bac à sable, ils vérifient :

| Vérification | Lot |
|---|---|
| Authentification | FE-4 |
| Annuaire | FE-4 |
| Dépôt jusqu'au statut Déposée | FE-5 |
| Réception d'une facture test | FE-9 |
| Envoi de statuts | FE-7, FE-9 |
| E-reporting test | FE-8 |

Le rapport dit « conforme » ou liste précisément les manques (cadrage). Il ne contient ni secret, ni jeton, ni clé de signature, ni donnée personnelle.

Garde-fous à reprendre par FE-4 (choix par défaut, à confirmer, le plus restrictif) :
- Les vérifications qui écrivent chez la PA (dépôt, envoi de statuts, e-reporting test, abonnement à un webhook) ne s'exécutent que si `EFACTURE_PA_ENVIRONNEMENT` vaut `bac-a-sable`, avec les identifiants d'entreprise de test fournis par la PA (question 24). En production, elles sont refusées : un dépôt, un statut ou un e-reporting y seraient de vraies transmissions, jusqu'à l'administration.
- Le document de test n'est pas une facture d'Iris : il ne prend aucun numéro de la séquence, n'est pas enregistré comme facture et n'entre pas dans le journal des statuts des factures réelles.
- En production, le contrôle se limite aux lectures : authentification, `GET /v1/healthcheck` de chaque service, consultation de l'annuaire. Toute autre vérification en production est à décider par FE-4, sans écriture chez la PA.

### 7.6 Passage en production

- Remplacer les identifiants du bac à sable par ceux de la production, et donner à `EFACTURE_PA_ENVIRONNEMENT` la valeur `production`.
- Sur un serveur Docker, recréer le conteneur du backend, car `docker compose restart` ne relit pas `server/.env` ([configuration](CONFIGURATION-ENVIRONNEMENT.md#fichiers-à-créer)).
- Relancer le contrôle, réduit en production aux lectures (section 7.5), puis suivre la première facture réelle ([liste de contrôle](FACTURATION-ELECTRONIQUE-DEPLOIEMENT.md#48-première-facture-réelle-suivie-jusquau-statut-attendu), point 8).

### 7.7 Changement de PA

Selon le critère 8 et la documentation de mobilité de la PA. Iris garde la PA et l'adresse de chaque transmission antérieure, et accepte les statuts venus d'une autre PA (EX-49).

### 7.8 Dépannage

À écrire avec FE-4. Le corps de la norme XP Z12-013, qui fixe ses règles communes et ses codes d'erreur, n'a pas été lu (S11, Q-18).

## 8. Choix par défaut de ce document, à confirmer

1. Le classement éliminatoire ou souhaitable de chaque critère (section 2).
2. Une PA de la seconde liste S10 admise pour le contrat et le bac à sable, et revérifiée sur la première liste avant la production (critère 1).
3. L'absence d'API XP Z12-013 soumise à Nelson, et non éliminatoire d'office (critère 2).
4. Le téléchargement par l'API de l'original et des statuts, éliminatoire (critère 7).
5. La PA de réception déjà en place, évaluée la première (section 1).
6. La grille remplie et ses preuves conservées hors du dépôt (section 3).
7. Les questions nouvelles numérotées à part (section 6).
8. Le contrôle de compatibilité sans écriture chez la PA en production, et sans facture d'Iris pour son document de test (section 7.5).
9. Les garde-fous d'un webhook, s'il est retenu par FE-4 (critère 6).
10. Aucune clé d'intégration n'active le connecteur, ne lit sa configuration ni ne lance le contrôle (section 7.4).
11. Les garde-fous des variables proposées : adresses en `https` seul, `EFACTURE_PA_ENVIRONNEMENT` sans valeur par défaut et gardé avec chaque transmission et chaque statut (modèle de données de FE-5, à confirmer par Nelson à son cadrage), vie du secret client et de la clé de signature (section 7.3).
