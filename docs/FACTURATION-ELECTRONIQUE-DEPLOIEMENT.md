# Facturation électronique : liste de contrôle du déploiement

> **Première version de la liste de contrôle par installation**, PR a du lot FE-DOC, rédigée le 19-11-2026 sur `main` à `f1d3ef3`, après la fusion de la [proposition](FACTURATION-ELECTRONIQUE-CIBLE.md) (#620, lot FE-0). Elle suit la [fiche FE-DOC](FACTURATION-ELECTRONIQUE-CIBLE.md#fe-doc--connexion-à-une-pa-et-déploiement) et le cadrage de Nelson du 19-11-2026 ([historique](HISTORIQUE-DECISIONS.md#décision-du-19-11-2026-sur-la-facturation-électronique)), mot pour mot : « docs/FACTURATION-ELECTRONIQUE-DEPLOIEMENT.md : liste de contrôle par installation : ». Ses douze points sont repris en section 3.
>
> **Statut.**
> - Presque rien de ce que la liste désigne dans Iris n'existe encore. Chaque point dit ce qui est implémenté et ce qui est prévu, avec son lot.
> - La PR b de FE-DOC complétera la liste avec FE-4 et FE-5 : écrans, variables et commandes réels (section 5).
> - **Cette liste ne vaut pas feu vert.** Son dernier point est la « validation du cabinet et mon feu vert » (Nelson). Une liste entièrement cochée n'autorise pas la mise en production : seul Nelson la décide.
>
> Ce document ne vaut pas avis juridique ou comptable. Les identifiants S1 à S20, EX-01 à EX-52, N-01 à N-17 et Q-01 à Q-25 sont ceux de la proposition ; Q-PA-1 à Q-PA-3 et N-PA-1 sont ceux du [document de connexion](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md#6-questions-nouvelles).

## 1. Avant même Iris

- **La réception est déjà obligatoire.** Selon la proposition ([section 3](FACTURATION-ELECTRONIQUE-CIBLE.md#3-calendrier-et-conséquences-pour-la-société-pilote)), tout assujetti établi en France doit recevoir ses factures par une PA depuis le 01-09-2026. Le texte légal (S14, S8) n'a **pas été vérifié** ; S3 §1.4.2, vérifié, est cohérent.
- S3 §1.4.2 : les destinataires « DOIVENT définir une ou plusieurs adresses de facturation électroniques de réception sous SchemeId 0225 et les faire enregistrer dans l'Annuaire PPF par la PA-R qu'ils ont désignée » (EX-35).
- Un assujetti sans PA reçoit des factures « Déposée NON_TRANSMISE » et ne peut pas exiger de papier (EX-35 ; S3 §1.4.4).
- **Conséquence : la société pilote doit disposer d'une PA de réception dès maintenant, qu'elle utilise Iris ou non** (N-01). Iris ne la remplace pas : il récupérera ses factures par l'API de cette PA (FE-9). Cadrage de Nelson : « La réception légale est assurée par la PA de la société. Iris récupère les factures par l'API de la PA, sans agrément. »
- **Si elle est une grande entreprise ou une ETI**, l'émission et l'e-reporting sont déjà obligatoires (non vérifié). Iris ne transmet rien avant FE-5 : elle devrait émettre par sa PA en attendant (proposition, section 3).

À faire tout de suite :

| Action | Qui | Question liée |
|---|---|---|
| Dire si la société pilote a déjà une PA de réception, et donner sa catégorie, son régime de TVA et son option pour les débits | Nelson, avec la société | N-01 |
| Sans PA, en choisir une avec les [critères de choix](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md#2-critères-de-choix), pour qu'elle serve aussi Iris : une installation n'a qu'une PA | Nelson | N-02 |
| Avec une PA, l'évaluer la première avec la [grille](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md#3-grille-dévaluation) (choix par défaut, à confirmer) | Nelson | N-02 |
| Vérifier l'inscription des adresses de réception de la société à l'annuaire (section 4.3) | PA ; administrateur de l'installation | N-01 |
| Confirmer la catégorie et la date d'obligation de la société, et la sanction d'un défaut de réception | Cabinet | Q-09, Q-17 |

## 2. Lecture de la liste

- **Ordre et texte.** Les douze points sont ceux du cadrage de Nelson, dans son ordre. Le texte de chaque point est repris mot pour mot.
- **Qui.** Nelson ; le cabinet ; l'administrateur de l'installation, qui tient le serveur et `server/.env` et détient un compte `SUPERADMIN` ; la PA.
- **Où dans Iris.** L'écran ou la variable concernés. « Implémenté » pour ce qui existe au 19-11-2026, « prévu » avec le lot pour le reste.
- **Preuve.** Ce qui atteste le point. Elle est conservée avec la liste remplie, hors du dépôt : aucune donnée personnelle ni aucun secret n'entre dans le dépôt (choix par défaut, à confirmer).
- **État.** « À faire » : action hors d'Iris, possible dès maintenant. « Prévu dans Iris (lot FE-x) » : le point attend ce lot.

## 3. Vue d'ensemble

| # | Point (cadrage de Nelson, mot pour mot) | État | Fait le (JJ-MM-AAAA) |
|---|---|---|---|
| 1 | identité fiscale de la société (SIREN, TVA, option débits, catégorie et date d'obligation) | À faire ; prévu dans Iris (lot FE-1) | |
| 2 | PA choisie et contrat signé | À faire | |
| 3 | inscription à l'annuaire vérifiée | À faire ; prévu dans Iris (lots FE-1, FE-4) | |
| 4 | identifiants configurés | Prévu dans Iris (lot FE-4) | |
| 5 | SIREN et type de chaque client professionnel | À faire ; prévu dans Iris (lots FE-1, FE-4) | |
| 6 | catégorie d'opération par article, validée par le cabinet | À faire ; prévu dans Iris (lot FE-2) | |
| 7 | contrôle de compatibilité au vert | Prévu dans Iris (lots FE-4, FE-5, FE-7, FE-8, FE-9) | |
| 8 | première facture réelle suivie jusqu'au statut attendu | Prévu dans Iris (lot FE-5) | |
| 9 | e-reporting paramétré | À faire ; prévu dans Iris (lots FE-1, FE-7, FE-8) | |
| 10 | conservation des factures (durée et lieu, à valider par le cabinet) | À faire ; prévu dans Iris (lots FE-5, FE-9, FE-10) | |
| 11 | personnes chargées des rejets et des refus | À faire ; prévu dans Iris (lots FE-5, FE-6, FE-9) | |
| 12 | validation du cabinet et mon feu vert | À faire | |

## 4. Les douze points

### 4.1 Identité fiscale de la société

> « identité fiscale de la société (SIREN, TVA, option débits, catégorie et date d'obligation) »

- **Activité connue** (réponse de Nelson du 20-11-2026, [historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-20-11-2026-sur-la-facturation-électronique)) : sûreté électronique et revente d'accès internet et télécom (lecture retenue, à corriger par Nelson si besoin). Les autres faits restent à fournir : catégorie d'entreprise, régime de TVA, option pour les débits, PA de réception.
- **Qui.** Nelson donne les faits de la société pilote (N-01, répondue en partie). Le cabinet confirme la catégorie, le régime de TVA et l'option pour les débits (Q-09). L'administrateur de l'installation saisit.
- **Où dans Iris.**
  - Écran Société : raison sociale, SIRET et TVA intracommunautaire : **implémentés** ; SIRET et TVA sans contrôle de format. Préremplissage depuis le registre national des entreprises (raison sociale, SIRET du siège, adresse ; le SIREN lu n'est pas conservé) : **implémenté**.
  - SIREN distinct, SIRET et TVA contrôlés, option pour les débits, catégorie d'entreprise, date d'obligation, régime de TVA, adresses électroniques de réception, IBAN : **prévus** (FE-1), sans valeur par défaut.
  - Écran « Prêt à facturer » : **implémenté** ; le signalement de ces nouvelles données manquantes est **prévu** (FE-1).
- **Preuve.** Réponse écrite du cabinet à Q-09 ; écran Société complet, sans manque signalé par « Prêt à facturer » ; journal des changements (FE-1).
- **Questions liées.** N-01, Q-09, Q-10 ; Q-06 pour l'option pour les débits dans les travaux.
- **État.** À faire (faits et réponse du cabinet) ; saisie prévue dans Iris (lot FE-1).

### 4.2 PA choisie et contrat signé

> « PA choisie et contrat signé »

- **Qui.** Nelson choisit (N-02, ouverte : aucune PA n'est choisie au 20-11-2026), avec la société. La PA fournit le contrat et l'accès au bac à sable. Le cabinet répond aux points juridiques. **Qui signe : la société** (N-PA-1, réponse de Nelson du 20-11-2026, [historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-20-11-2026-sur-la-facturation-électronique) ; lecture retenue, à corriger par Nelson si besoin ; le point juridique reste non vérifié, EX-49).
- **Où dans Iris.** Hors d'Iris. Critères, grille, questionnaire et points contractuels : [document de connexion](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md).
- **Preuve.** Copie datée de la liste officielle (S10) ; grille remplie et datée ; réponses écrites de la PA au questionnaire ; contrat signé ; date d'accès au bac à sable.
- **Questions liées.** N-01, N-02, N-PA-1 ; Q-16, Q-PA-1 à Q-PA-3.
- **Échéance.** Le contrat précède la recette, demandée avant le 01-06-2027 ; l'accès au bac à sable, la fin de FE-4 (proposition, [section 8.4](FACTURATION-ELECTRONIQUE-CIBLE.md#84-ordre-et-faisabilité-de-la-recette)).
- **État.** À faire.

### 4.3 Inscription à l'annuaire vérifiée

> « inscription à l'annuaire vérifiée »

- **Qui.** La PA inscrit les adresses de réception de la société (EX-44). L'administrateur de l'installation vérifie.
- **Où dans Iris.**
  - Aujourd'hui, hors d'Iris : portail public de l'annuaire, cité par l'annexe (EX-43 : portail.chorus-pro.gouv.fr).
  - Adresses électroniques de réception dans l'écran Société : **prévues** (FE-1).
  - Consultation de l'annuaire par le connecteur, résultat conservé avec sa date : **prévue** (FE-4).
- **Preuve.** Pour chaque adresse de réception de la société : sa ligne d'annuaire, au statut `PA_ACTIVE`, rattachée à la PA choisie, avec la date de consultation.
- **Questions liées.** N-01.
- **État.** À faire ; prévu dans Iris (lots FE-1, FE-4).

### 4.4 Identifiants configurés

> « identifiants configurés »

- **Qui.** La PA fournit les identifiants. L'administrateur de l'installation les renseigne dans `server/.env`, puis active le connecteur avec un compte `SUPERADMIN`.
- **Où dans Iris.**
  - Variables `EFACTURE_PA_*`, **noms proposés** par la proposition, à documenter par FE-4 ([document de connexion](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md#73-variables-denvironnement), section 7.3) : **prévues** (FE-4).
  - Écran Connecteurs, réservé au `SUPERADMIN` : **prévu** (FE-4).
  - Adresse du service de validation, selon N-15 (nom proposé : `EFACTURE_VALIDATEUR_URL`) : **prévue** (FE-3).
- **Preuve.** L'écran Connecteurs montre le connecteur actif et l'environnement ; le journal porte l'activation ; aucun secret n'apparaît à l'écran, dans un journal ou une réponse (critère de FE-4).
- **Questions liées.** N-02, N-15.
- **État.** Prévu dans Iris (lot FE-4).

### 4.5 SIREN et type de chaque client professionnel

> « SIREN et type de chaque client professionnel »

- **Qui.** L'administrateur de l'installation, avec les comptes qui gèrent les clients. Le type des cas ambigus suit la réponse de Nelson à N-09.
- **Où dans Iris.**
  - Fiche client : SIREN de 9 chiffres, exigé pour émettre une facture sauf si la case « Pas de SIRET (particulier) » est cochée : **implémenté**.
  - Type de client (selon N-09), SIRET facultatif, TVA contrôlée, code pays, adresse électronique de facturation : **prévus** (FE-1).
  - Vérification du client dans l'annuaire avant le dépôt : **prévue** (FE-4).
- **Preuve.** Aucun client professionnel sans SIREN ni type ; consultation de l'annuaire conservée pour chacun (FE-4).
- **Questions liées.** N-09 ; Q-15 pour un client absent de l'annuaire.
- **État.** À faire ; prévu dans Iris (lots FE-1, FE-4).

### 4.6 Catégorie d'opération par article

> « catégorie d'opération par article, validée par le cabinet »

- **Qui.** Le cabinet fixe la catégorie (bien, service ou mixte) de chaque type d'opération (Q-05). L'administrateur de l'installation vérifie la nature des lignes facturées.
- **Où dans Iris.**
  - Écran Factures : nature de chaque ligne, `PRESTATION` ou `ARTICLE` (`PRESTATION` par défaut), utilisée par la comptabilité : **implémentée**.
  - Catégorie d'opération (BT-23) déduite de cette nature, `PRESTATION` vers service et `ARTICLE` vers bien : **prévue** (FE-2), à valider par le cabinet.
  - **Question pour Nelson, à poser au cadrage de FE-2.** Le cadrage dit « par article » ; la proposition déduit la catégorie de la nature des lignes. Une catégorie portée par chaque fiche du catalogue n'est pas prévue. L'ajouter changerait le modèle de données : la décision revient à Nelson (règle 5 de la méthode), après la réponse du cabinet à Q-05.
- **Preuve.** Réponse écrite du cabinet à Q-05, pour le SAV, la maintenance, le dépannage, le forfait, les pièces et la main-d'œuvre, les travaux ; une facture de chaque cas contrôlée sur le bac à sable.
- **Questions liées.** Q-05, Q-06, Q-14.
- **État.** À faire (réponse du cabinet) ; prévu dans Iris (lot FE-2).

### 4.7 Contrôle de compatibilité au vert

> « contrôle de compatibilité au vert »

- **Qui.** L'administrateur de l'installation le lance. La PA fournit le bac à sable.
- **Où dans Iris.** Commande `npm run efacture:verifier` et bouton « Tester la connexion » de l'écran Connecteurs : **prévus** (FE-4). Ils vérifient l'authentification et l'annuaire (FE-4), le dépôt jusqu'au statut Déposée (FE-5), la réception d'une facture test (FE-9), l'envoi de statuts (FE-7, FE-9) et un e-reporting test (FE-8).
- **Preuve.** Rapport daté qui dit « conforme » sur le bac à sable, sans secret ni donnée personnelle. En production, le contrôle se limite aux lectures (authentification, état des services, annuaire) : il ne dépose ni facture, ni statut, ni e-reporting ([document de connexion](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md#75-contrôle-de-compatibilité), section 7.5).
- **Questions liées.** N-02.
- **État.** Prévu dans Iris (lots FE-4, FE-5, FE-7, FE-8, FE-9).

### 4.8 Première facture réelle suivie jusqu'au statut attendu

> « première facture réelle suivie jusqu'au statut attendu »

- **Qui.** Un compte qui émet les factures ; l'administrateur de l'installation suit le statut. La PA renvoie les statuts.
- **Où dans Iris.** Journal des statuts de la facture, statut Iris et statut de la PA affichés séparément, alerte sur un rejet ou un refus : **prévus** (FE-5).
- **Statut attendu** (choix par défaut, à confirmer) : au moins Déposée (200), ni Rejetée ni Refusée ; la suite dépend des statuts que renvoie la PA ([critère 3](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md#23-critère-3--flux-couverts)) et, après le règlement d'une facture dont la TVA est due à l'encaissement, d'Encaissée (FE-7).
- **Preuve.** Numéro de la facture ; identifiant du flux ; statut Déposée avec la preuve de la PA ; fichier transmis retéléchargé à l'identique (critère de FE-5).
- **Questions liées.** N-14 (canal avant la date d'obligation), N-08.
- **État.** Prévu dans Iris (lot FE-5).

### 4.9 E-reporting paramétré

> « e-reporting paramétré »

- **Qui.** Le cabinet confirme le régime de TVA et la périodicité (Q-09, Q-10). L'administrateur de l'installation saisit le régime. La PA reçoit les dépôts.
- **Où dans Iris.**
  - Régime de TVA dans l'écran Société : **prévu** (FE-1).
  - Données de paiement : **prévues** (FE-7) ; e-reporting des transactions et des paiements : **prévu** (FE-8).
  - La périodicité de chaque régime reste dans le code, avec sa source, après Q-10 (fiche FE-8).
- **Preuve.** Réponse écrite du cabinet à Q-10 ; e-reporting test accepté par le bac à sable (critère de FE-8) ; première période réelle transmise.
- **Questions liées.** Q-09, Q-10, Q-15 ; N-13 pour les prélèvements des contrats. Les périodicités connues (EX-41) ne sont pas vérifiées.
- **État.** À faire (réponse du cabinet) ; prévu dans Iris (lots FE-1, FE-7, FE-8).

### 4.10 Conservation des factures

> « conservation des factures (durée et lieu, à valider par le cabinet) »

- **Qui.** Le cabinet fixe la durée, le point de départ et le détenteur (Q-11), et dit si la piste d'audit fiable reste due (Q-12). Nelson décide du lieu (N-16). La PA conserve selon son contrat ([critère 7](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md#27-critère-7--archivage)). L'administrateur de l'installation tient les sauvegardes.
- **Où dans Iris.**
  - Aujourd'hui : données des factures émises figées en base, **implémenté** ; aucun fichier émis conservé, le PDF étant recalculé à chaque demande (proposition, section 6, choix 3).
  - Pièce transmise et son empreinte : **prévues** (FE-5) ; fichiers reçus : **prévus** (FE-9).
  - Durée, lieu, vérification périodique des empreintes, restitution : **prévus** (FE-10). D'ici la réponse du cabinet, rien n'est supprimé.
  - Variables du stockage, selon N-16 : **prévues** (FE-10).
- **Preuve.** Réponses écrites du cabinet à Q-11 et Q-12 ; décision de Nelson sur N-16 ; essai de restitution et contrôle des empreintes (FE-10).
- **Questions liées.** Q-11, Q-12, N-16. Les durées de 6 et 10 ans (EX-46) ne sont pas vérifiées.
- **État.** À faire (réponses) ; prévu dans Iris (lots FE-5, FE-9, FE-10).

### 4.11 Personnes chargées des rejets et des refus

> « personnes chargées des rejets et des refus »

- **Qui.** Nelson décide du cycle de correction (N-03 à N-07). L'administrateur de l'installation désigne les comptes et leur donne les droits.
- **Où dans Iris.**
  - Alerte visible sur toute facture rejetée ou refusée, avec son motif : **prévue** (FE-5).
  - Correction après un rejet ou un refus : **prévue** (FE-6), après les réponses.
  - Droits par défaut de la proposition (section 13, choix 8, à confirmer) : la transmission suit l'émission (`factures.emettre`), la lecture des statuts suit la consultation (`factures.consulter`). Selon FE-9, l'approbation et le refus d'une facture reçue sont réservés à l'administration (choix par défaut, à confirmer).
  - Aujourd'hui, l'accès aux factures tient au type de compte : l'administration (`SUPERADMIN`, `ADMIN`, `DIRECTEUR`) et l'assistante technique pour les factures de son poste ; le comptable est refusé (403). Les permissions `factures.*` sont celles du [modèle de droits cible](MODELE-DROITS-CIBLE.md), prévues par les lots D1 à D3 : d'ici là, les comptes se désignent par leur type.
- **Preuve.** Comptes désignés, avec les droits voulus ; parcours de rejet et de refus éprouvés sur le bac à sable (critère de FE-5).
- **Questions liées.** N-03 à N-07 ; Q-01 à Q-03 ; EX-28 pour les trois cas où une facture reçue peut être refusée.
- **État.** À faire (désignation) ; prévu dans Iris (lots FE-5, FE-6, FE-9).

### 4.12 Validation du cabinet et feu vert de Nelson

> « validation du cabinet et mon feu vert »

- **Qui.** Le cabinet, puis Nelson.
- **Où dans Iris.** Hors d'Iris.
- **Preuve.** Avis écrit du cabinet sur les questions utiles à la société (section 11.2 de la proposition) et validation des montants ([passation](ROADMAP-PASSATION.md#5-préalables-à-la-mise-en-service-et-contrat-dune-pr), section 5) ; décision de Nelson consignée dans l'historique.
- **Rappel.** Seul Nelson décide de la mise en production. Ni une CI verte, ni la fusion d'un lot, ni une liste cochée ne la décident.
- **État.** À faire.

## 5. Ce que la PR b ajoutera

- Les écrans, variables et commandes réels de FE-4 et FE-5, et le pas à pas de l'activation ([document de connexion](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md#7-connexion-pas-à-pas), section 7).
- Le passage du bac à sable à la production.
- Les points complétés après les réponses, notamment N-01, N-02, N-09, N-14 à N-16, Q-05 et Q-09 à Q-12.
- La fiche FE-DOC fixe le critère de la liste complète : « un administrateur suit la liste sans autre document ; chaque point renvoie à l'écran ou à la variable concernés ». Cette première version ne le remplit pas encore : les écrans et les variables n'existent pas.

## 6. Choix par défaut de ce document, à confirmer

1. Preuves et liste remplie conservées hors du dépôt (section 2).
2. Statut attendu de la première facture réelle : au moins Déposée, ni Rejetée ni Refusée (section 4.8).
3. PA de réception déjà en place, évaluée la première (section 1).
4. Contrôle de compatibilité limité aux lectures en production (section 4.7).
