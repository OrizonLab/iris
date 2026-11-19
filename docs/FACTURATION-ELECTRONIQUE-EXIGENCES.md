# Facturation électronique : exigences pour une solution compatible (lot 0, partie réglementaire)

> Annexe de la proposition [`FACTURATION-ELECTRONIQUE-CIBLE.md`](FACTURATION-ELECTRONIQUE-CIBLE.md). Photographie du 19-11-2026, et non documentation tenue à jour : la proposition condense ces exigences dans sa matrice (section 5) et en suit les questions (section 11). Elle garde ici le détail des sources et des extraits lus, pour le cabinet et pour les lots de code. Les dates d'application, les versions et le niveau de vérification sont ceux du 19-11-2026.

- Rédigé le 19-11-2026 pour l'audit de conformité « facturation électronique » d'Iris.
- Hypothèse de départ : Iris n'est pas plateforme agréée (PA). C'est une **solution compatible** (« OD/SC » dans les normes AFNOR) : elle produit, valide, reçoit et suit les factures. La PA de la société les transmet.
- Ce document ne vaut pas avis juridique ou comptable. Chaque exigence qui touche la fiscalité doit être validée par le cabinet.

## 0. Mode d'emploi

### 0.1 Niveau de vérification

Chaque exigence porte une mention de vérification.

- **Vérifiée** : la section citée du document a été lue lors de l'audit du 19-11-2026. Ces documents viennent tous du dépôt public du FNFE-MPE ou du dépôt ConnectingEurope (section 1).
- **Non vérifiée** : le document officiel est identifié (URL donnée), mais son texte n'a pas été lu. Ce que l'on en dit vient d'extraits de moteur de recherche ou de sources secondaires. Ces exigences ne sont pas acquises ; elles sont à confirmer en lisant le texte.

**Limite technique de cette recherche.** Depuis l'environnement de travail de l'audit, les sites suivants étaient inaccessibles en lecture directe : `www.impots.gouv.fr` (et donc `bofip.impots.gouv.fr`, non essayé), `www.legifrance.gouv.fr`, `www.economie.gouv.fr` et `fnfe-mpe.org`. Les essais se sont arrêtés là, comme le demandait l'outil. Les textes de loi, la FAQ, le guide pratique et la liste des PA n'ont donc pas pu être lus.

En revanche, le dépôt GitHub du FNFE-MPE (S1) publie sous licence Apache 2.0 les annexes des normes AFNOR, à jour en version 1.4 du 30-06-2026. L'annexe A de la XP Z12-012 reproduit aussi des annexes des spécifications DGFiP v3.2 :
- les règles de gestion de l'annexe 7 ;
- le flux 10 (e-reporting) ;
- le cycle de vie (CDV) ;
- l'annuaire (flux 11).

L'essentiel du socle technique est donc **vérifié**, et le socle légal ne l'est pas.

### 0.2 Classement

- **Obligatoire** : imposé par un texte (CGI, décret, arrêté) ou par la norme rendue applicable par l'arrêté du 27-07-2026, ou condition sans laquelle la PA rejette la facture. L'obligation pèse juridiquement sur la société ou sur sa PA ; elle devient une exigence pour Iris dès qu'Iris produit ou traite la donnée.
- **Recommandé** : bonne pratique explicite des normes ou de la DGFiP, ou moyen de ne pas faire rejeter des factures.
- **Confort** : fonctionnalité optionnelle, utile selon l'activité.

### 0.3 Vocabulaire

| Terme | Sens |
|---|---|
| PA-E | PA d'émission |
| PA-R | PA de réception |
| PPF | Portail public de facturation, recentré sur l'annuaire et le concentrateur de données (CdD) |
| Flux 1 | Données de facture transmises à l'administration (« données réglementaires ») |
| Flux 2 | La facture elle-même |
| Flux 6 / CDV | Message de cycle de vie, au format CDAR |
| Flux 10 | E-reporting |
| BT / BG | Données et groupes du modèle sémantique EN16931 |
| EXT-FR-FE-xx | Données ajoutées par le profil EXTENDED-CTC-FR |

## 1. Registre des sources

| Id | Document | Version et date effectivement consultées | URL | Vérification |
|---|---|---|---|---|
| S1 | Dépôt FNFE-MPE « France_RFE » : schematrons, XSD et annexes des normes | Commit `97ba0f3` du 05-09-2026, paquet schematrons 1.4.0.04 | https://github.com/fnfempe/France_RFE | Vérifiée (clone complet) |
| S2 | XP Z12-012, **Annexe A** (formats, profils, règles BR-FR, CDV, motifs, flux 10, flux 11, copie des règles DGFiP 3.2) | **V1.4 du 30-06-2026** (fichier `XP_Z12-012_Annexe_A_2026_V1.4_VF.xlsx`) | https://github.com/fnfempe/France_RFE/tree/main/FNFE_RFE_INVOICE/Z.notes_%26_docs/XP_Z12_012_Annex | Vérifiée |
| S3 | XP Z12-014, **Annexe A** (normative) : cas d'usage | **V1.4 du 30-06-2026**, 194 pages | https://github.com/fnfempe/France_RFE/tree/main/FNFE_RFE_INVOICE/Z.notes_%26_docs/XP_Z12_014_Annex | Vérifiée |
| S4 | XP Z12-013, **Annexe A** (« AFNOR Flow Service ») et **Annexe B** (« AFNOR Directory Service »), au format OpenAPI 3.0.3 | **1.3.0** (fichiers du dépôt S1, date non indiquée dans les fichiers) | https://github.com/fnfempe/France_RFE/tree/main/FNFE_RFE_INVOICE/Z.notes_%26_docs/XP_Z12_013_Annex | Vérifiée |
| S5 | Note explicative FNFE-MPE, « Schematrons en application des règles de gestion de la norme XP Z12-012 » | **V1.4.0 du 30-06-2026** | même dossier que S2 (`FNFE_NOTE_EXPLICATIVE_V1.4.0_FR.pdf`) | Vérifiée |
| S6 | Artefacts de validation EN16931 (CEN/TC 434, ConnectingEurope) | **validation-1.3.17**, commit `6e35e0a` du 12-10-2026, publication du 12-10-2026. La version précédente, 1.3.16 du 13-04 (année 2026 déduite de la séquence des versions), correspond à celle que S5 déclare « applicable au 15 mai 2026 ». | https://github.com/ConnectingEurope/eInvoicing-EN16931/releases | Vérifiée (étiquette et page de publication) |
| S7 | DGFiP, spécifications externes de la facturation électronique | **v3.2 du 30-04-2026**. La page est indiquée « modifiée le 02-07-2026 ». Aucune version plus récente n'a été trouvée. Depuis la v3.2, le dossier ne décrit plus que l'annuaire et le concentrateur ; les formats relèvent des normes AFNOR. | https://www.impots.gouv.fr/specifications-externes-b2b | **Non vérifiée** (site inaccessible). Les annexes 2, 6 et 7 v3.2 sont lues dans leur reproduction par S2. |
| S8 | DGFiP, « Facturation électronique : guide pratique de démarrage au 1er septembre 2026 » | Juillet 2026 selon une source secondaire (35 pages, 29 questions) ; date exacte non lue | https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/guide_pratique_facturation_electronique.pdf | **Non vérifiée** |
| S9 | DGFiP, FAQ « J'approfondis la facturation électronique » | Dernière version repérée : V2 du 23-09-2025, peut-être mise à jour depuis | https://www.impots.gouv.fr/foire-aux-questions-japprofondis-la-facturation-electronique | **Non vérifiée** |
| S10 | DGFiP, liste des plateformes agréées | Page indiquée « modifiée le 29-10-2026 ». Elle contient deux listes : PA immatriculées, et PA immatriculées sous réserve des tests d'interopérabilité. 101 PA étaient immatriculées au 16-01-2026. | https://www.impots.gouv.fr/je-consulte-la-liste-des-plateformes-agreees | **Non vérifiée** |
| S11 | AFNOR, corps des normes XP Z12-012, XP Z12-013 et XP Z12-014 | Éditions de juin 2026 : fiches boutique FA301169, FA301170 et FA301171. Corps des normes non consulté ; seules les annexes publiées par le FNFE (S2 à S4) l'ont été. | Z12-012 : https://www.boutique.afnor.org/fr-fr/norme/xp-z12012/formats-et-profils-des-messages-factures-et-statuts-de-cycle-de-vie-constit/fa301169/601641 · Z12-013 : https://www.boutique.afnor.org/fr-fr/norme/xp-z12013/api-pour-interfacer-les-systemes-dinformations-des-entreprises-avec-les-pla/fa301170/601639 · Z12-014 : https://www.boutique.afnor.org/fr-fr/norme/xp-z12014/-cas-dusage-b2b-applicables-dans-le-cadre-la-reforme-facture-electronique-e/fa301171/601640 | **Non vérifiée**. Gratuité annoncée par des sources secondaires, mais la fiche boutique décrit un achat : à confirmer. Le PDF AFNOR s'oppose à la fouille de texte et de données (signalé par une source secondaire). |
| S12 | Factur-X (FNFE-MPE et FeRD) | **1.09 du 10-06-2026** (date confirmée par S5) ; correctif **1.09.2** publié début août 2026 (04-08-2026 selon des sources secondaires), intégré au paquet S1 en 1.4.0.03 | https://fnfe-mpe.org/factur-x/ | **Partiellement vérifiée** : versions confirmées par S5 et S1 ; spécification Factur-X non lue (site inaccessible) |
| S13 | CGI, annexe II, art. 242 nonies A (mentions obligatoires) | Version issue du décret 2022-1299, éventuellement retouchée par le décret 2026-677 : non lue | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050811276 | **Non vérifiée** |
| S14 | CGI, art. 289, 289 bis, 290, 290 A, 1737 (et 289 E cité par la DGFiP) | Versions issues de la loi de finances 2024 (art. 91) et de la loi n° 2026-103 du 19-02-2026 de finances pour 2026 : non lues | art. 289 bis (ancienne version indexée) : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046195635 · loi 2026-103 : https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000053508878 | **Non vérifiée** |
| S15 | **Décret n° 2026-677 du 27-07-2026** relatif à la généralisation de la facturation électronique (NOR CPPE2610307D) | JO du 28-07-2026 (une source dit 29-07) ; entrée en vigueur 29-07-2026 selon Légifrance (art. 242 nonies O) | https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000054499510 | **Existence établie** par plusieurs sources concordantes, dont des pages Légifrance indexées et une copie du JO. **Texte non lu.** |
| S16 | **Arrêté du 27-07-2026** relatif à la généralisation de la facturation électronique (NOR CPPE2610309A) | JO du 28-07-2026 ; modifie les art. 41 septies A à 41 septies P de l'annexe IV | https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054499535 (art. 1 : https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000054499545) | **Existence établie**, **texte non lu** |
| S17 | CGI, annexe II, art. 242 nonies E bis, E ter et E quater (changement de PA, créés par S15), 242 nonies O et P (e-reporting) | Versions de juillet 2026 indexées : non lues | E bis : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054543964 · E ter : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054543966 · O : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054552567 · P : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054552572 | **Non vérifiée** |
| S18 | BOFiP : BOI-TVA-DECLA-20-30-50-20, -50-30 et -60 (données de transaction et de paiement) | Versions du 30-09-2026 indexées : non lues | https://bofip.impots.gouv.fr/bofip/13901-PGP.html/identifiant=BOI-TVA-DECLA-20-30-60-20260930 | **Non vérifiée** |
| S19 | LPF art. L102 B ; Code de commerce art. L123-22 ; BOI-CF-COM-10-10-30-10 (conservation) | Non lues | https://bofip.impots.gouv.fr/bofip/8877-PGP.html | **Non vérifiée** |
| S20 | DGFiP, « J'approfondis : données de facture à transmettre à l'administration, correspondance des flux » | Non lue (date d'application de chaque donnée : 01-09-2026 ou 01-09-2027) | https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/japprof_donnees-de-facture-a-transmettre-a-ladministration-correspondance-flux_vf.pdf | **Non vérifiée** |

### 1.1 Décret 2026-677 et arrêté du 27-07-2026 : ce qui est établi

- **Existence : oui.**
  - Plusieurs sources indépendantes les citent : PwC Avocats, Comptaverse, e-invoice.app, legifiscal.fr.
  - Elles concordent sur la date (27-07-2026) et sur les NOR (CPPE2610307D et CPPE2610309A).
  - Des URL Légifrance sont indexées pour le décret, pour l'arrêté et pour les articles 242 nonies E bis, E ter et O, modifiés « par Décret n°2026-677 ».
  - Le texte lui-même n'a pas été lu.
- **Objet du décret** (sources secondaires, non vérifié) :
  - aligner l'annexe II du CGI sur la loi de finances pour 2026 ;
  - remplacer « plateforme de dématérialisation partenaire » par « plateforme agréée » ;
  - recentrer le PPF sur l'annuaire ;
  - renforcer le contrôle des PA (rapport d'audit de surveillance) ;
  - créer les art. 242 nonies E bis à E quater sur le changement de PA (EX-49).
- **Objet de l'arrêté** (sources secondaires, non vérifié) :
  - réécrire l'art. 41 septies C de l'annexe IV : formats **et profils** EN16931 et EXTENDED-CTC-FR, conformes à XP Z12-012, en syntaxe CII, UBL ou format mixte PDF/A-3 + CII ;
  - renvoyer à XP Z12-013 (API, pour les PA qui choisissent de l'offrir) et à XP Z12-014 (cas d'usage) ;
  - supprimer le dépôt direct sur le PPF ;
  - fixer au 01-09-2026 les données dites « Démarrage » de l'art. 41 septies D, I.

## 2. Calendrier

| Date | Ce qui s'applique | Source | Vérification |
|---|---|---|---|
| 01-09-2026 | **Réception** obligatoire via une PA pour tous les assujettis établis en France | S14, S8 ; S3 §1.4.2 | Non vérifiée pour le texte légal ; cohérent avec S3 |
| 01-09-2026 | **Émission** et e-reporting pour les grandes entreprises et les ETI | S14, S8 | Non vérifiée |
| 01-09-2026 | Données de flux 1 de la trajectoire « Démarrage » (règle DGFiP G6.11) | S2, feuille « Règles de gestion 3.2 », G6.11 | Vérifiée (reproduction de l'annexe 7 v3.2) |
| 01-09-2026 | Schematrons « FATAL » (bloquants) appliqués par les PA en émission. En réception : dès le 01-09-2026, au plus tard le 01-10-2026 (version « WARNING » tolérée jusqu'au 30-09-2026). | S5, chapitre « Application » | Vérifiée |
| 01-09-2027 | **Émission** et e-reporting pour les PME et les micro-entreprises | S14, S8 | Non vérifiée |
| 01-09-2027 | Données de la trajectoire « Cible » (G6.12) et adresse de livraison (BR-FR-14) | S2, G6.12 et BR-FR-14 | Vérifiée |
| 2026 | Le ministère a annoncé qu'aucune sanction ne serait appliquée en 2026. Cela ne suspend pas l'obligation. | Sources secondaires | Non vérifiée |

> Question préalable pour Iris : la catégorie d'entreprise de la société pilote (GE, ETI, PME, micro) et son régime de TVA déterminent sa date d'émission et la périodicité de son e-reporting (Q-09).

## 3. Exigences

### A. Rôle d'Iris et périmètre

#### EX-01 : Passer par la PA de la société pour tout échange réglementé

- **Énoncé.**
  - Les factures B2B domestiques entre assujettis établis en France (e-invoicing) sont émises, transmises et reçues **uniquement par une PA**.
  - Seules les PA transmettent au concentrateur du PPF :
    - le flux 1 ;
    - les flux 10 (e-reporting) ;
    - les statuts obligatoires.
  - Une solution compatible n'a aucun lien direct avec le PPF.
- **Sources.**
  - S3, XP Z12-014 Annexe A V1.4 du 30-06-2026, §1.1 : « Les Plateformes Agréées sont les seules habilitées (et immatriculées pour cela) à échanger les factures relevant du périmètre "e-invoicing" […] et à transmettre les flux 1, les flux 10 (e-reporting) et les statuts dits "obligatoires" au Concentrateur de Données du PPF. »
  - S14, CGI art. 289 bis I, dans sa version de la loi 2026-103.
  - S16 : suppression du dépôt direct sur le PPF.
- **Vérification.** Vérifiée pour S3. Non vérifiée pour S14 et S16.
- **Classement.** Obligatoire. Réception au 01-09-2026 ; émission au 01-09-2026 ou au 01-09-2027 selon la taille.
- **À valider.** Rien sur le principe.

#### EX-02 : Déterminer pour chaque facture le circuit applicable (type de client)

- **Énoncé.** Iris doit classer chaque document de vente dans l'une des catégories suivantes :

  | Catégorie | Client | Circuit |
  |---|---|---|
  | B2B France | Assujetti établi en France et présent dans l'annuaire | E-invoicing (flux 2, flux 1 extrait par la PA) |
  | B2B international | Client étranger (vente) ; fournisseur étranger (acquisition) | E-reporting de transaction 10.1, et de paiement 10.2 si la TVA est due à l'encaissement |
  | B2C | Non assujetti | E-reporting agrégé 10.3, et 10.4 pour les paiements |
  | B2G | Entité publique | Chorus Pro ou PA (EX-04) |
  | Hors champ | — | — |

  Un client assujetti **absent de l'annuaire** peut être traité comme non assujetti, donc en e-reporting B2C (EX-45).
- **Sources.**
  - S3 §1.1 et §1.4.3 ; S3 cas n°43 (§3.2.42).
  - S2, feuille « E-REPORTING - Flux 10 » (sous-flux 10.1 à 10.4).
  - S14, CGI art. 289 bis et 290.
- **Vérification.** Vérifiée pour S2 et S3. Non vérifiée pour S14.
- **Classement.** Obligatoire, selon le calendrier de la section 2.
- **À valider.**
  - Critère « établi en France » pour un client étranger immatriculé à la TVA en France.
  - Traitement d'un client à SIREN non assujetti, par exemple une association.

#### EX-03 : Signaler le traitement attendu dans la facture et dans l'API

- **Énoncé.**
  - Une note de facture de code sujet `BAR` (BT-21) peut porter le traitement attendu (BT-22) : `B2B`, `B2BINT`, `B2C`, `B2CINT`, `OUTOFSCOPE` ou `ARCHIVEONLY`.
  - `ARCHIVEONLY` désigne un avoir interne qui annule une facture rejetée ou refusée : il n'est ni transmis ni déclaré.
  - Une seule de ces valeurs est admise par facture (BR-FR-31).
  - Dans l'API AFNOR, le champ `processingRule` porte la même information : `B2B`, `B2BInt`, `B2C`, `B2G`, `B2GInt`, `OutOfScope`, `B2GOutOfScope`, `ArchiveOnly`.
- **Sources.**
  - S2, feuille « BR-France CTC », règles BR-FR-20, BR-FR-31, BR-FR-07.
  - S4, Flow Service 1.3.0, schéma `ProcessingRule`.
- **Vérification.** Vérifiée.
- **Classement.** Recommandé (la note est facultative : « Il est possible d'utiliser une Note »). Le marquage `ARCHIVEONLY` est fortement recommandé pour les avoirs internes (EX-26).
- **À valider.** Les PA peuvent exiger la note ou `processingRule` : à vérifier avec la PA retenue.

#### EX-04 : Factures au secteur public (B2G)

- **Énoncé.**
  - Chorus Pro reste la plateforme de réception des entités publiques.
  - Un émetteur privé peut passer par sa PA.
  - Des règles propres au B2G s'ajoutent (BR-FR-CPRO-01 à BR-FR-CPRO-50) : numéro d'engagement juridique et code service, quand l'annuaire les exige.
  - Les motifs de refus B2G sont propres à Chorus Pro.
- **Sources.**
  - S3 §1.1 et §2.5.
  - S2, feuilles « BR-France-CTC-CPRO » et « Flux F11 - Annuaire » (DT-4-13-x, DT-5-13).
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire si la société facture des entités publiques. L'obligation B2G existait avant la réforme.
- **À valider.** Les clients publics de la société pilote, en maintenance de bâtiments publics par exemple.

### B. Émission : formats, profils et validation

#### EX-05 : Formats et profils admis

- **Énoncé.**
  - **Syntaxes admises :**
    - UBL 2.1, avec un message Invoice et un message CreditNote ;
    - UN/CEFACT CII D22B ;
    - Factur-X, c'est-à-dire un PDF/A-3 qui embarque le XML CII.
  - **Profils admis :**
    - EN16931, avec les règles françaises en sus ;
    - EXTENDED-CTC-FR.
  - **Factur-X :**
    - les profils utilisables sont EN16931 et EXTENDED (EXTENDED-CTC-FR en est un sous-ensemble), plus BASIC WL de façon temporaire ;
    - MINIMUM et BASIC ne figurent pas dans le socle.
  - Le PDF seul n'est pas une facture électronique.
- **Sources.**
  - S16, arrêté du 27-07-2026, art. 1, qui réécrit l'art. 41 septies C de l'annexe IV.
  - S3 §1.1 : « un profil temporaire implémenté dans le format mixte Factur-x (BASIC WL) ».
  - S5, §1 et §2.1 : « 3 profils à utiliser (BASIC WL juste la première année, EN16931 et EXTENDED) ».
  - S2, feuille « A LIRE ».
- **Vérification.** Vérifiée pour S2, S3 et S5. Non vérifiée pour S16 : selon les sources secondaires, l'arrêté ne nomme pas Factur-X mais un « format mixte PDF/A-3 + CII », et ne cite pas BASIC WL.
- **Classement.** Obligatoire au 01-09-2026.
- **À valider.**
  - Date de fin exacte de BASIC WL : « la première année », soit jusqu'au 31-08-2027 ?
  - Statut juridique de BASIC WL au regard de la liste limitative de l'arrêté (Q-13).
  - Recommandation : ne pas émettre en BASIC WL, qui ne porte pas les lignes.

#### EX-06 : Version Factur-X

- **Énoncé.**
  - Utiliser Factur-X 1.09 du 10-06-2026 et son correctif 1.09.2, publié début août 2026, rétrocompatible.
  - Utiliser les XSD propres à chaque profil.
  - Le XML embarqué doit passer les mêmes contrôles qu'une facture CII.
- **Sources.**
  - S5, §1 : XSD BASIC WL, EN16931 et EXTENDED « en version 1.09 et 1.09.2Beta […] (anticipation d'un correctif 1.09.2 de la version 1.09 du 10 juin 2026) ».
  - S1, journal des modifications 1.4.0.03 : « update Factur-x with 1.09.2 version ».
  - S12.
- **Vérification.** Partiellement vérifiée (versions confirmées ; spécification Factur-X non lue).
- **Classement.** Obligatoire si Iris émet en Factur-X. Version la plus récente recommandée.
- **À valider.** Lire la spécification Factur-X 1.09.2 sur le site du FNFE-MPE.

#### EX-07 : Contrôles avant émission (règle officielle et pré-validation)

- **Énoncé.**
  - **Règle officielle.**
    - La **PA-E DOIT** faire les contrôles réglementaires avant toute transmission.
    - Si un contrôle échoue, elle rejette la facture (statut 213) avec un motif.
    - Si les contrôles passent, elle pose « Déposée » (200).
  - **Contrôles que la PA-E applique,** dans l'ordre :

    | Étape | Contrôle | Issue en cas d'échec |
    |---|---|---|
    | 1 | Contrôles techniques : antivirus, fichier vide, enveloppe | Statut Irrecevable (501) |
    | 2 | Structure du fichier (XSD) | Statut Irrecevable (501) |
    | 3a | Schematron du profil : EN16931 (artefacts S6) ou EXTENDED-CTC-FR | Statut Rejetée (213) |
    | 3b | Schematron des règles françaises BR-FR, version 1.4.0, en mode FATAL | Statut Rejetée (213) |
    | 3c | Doublon, adresse et « atteignabilité » du destinataire | Statut Rejetée (213) |

  - **Pour Iris (solution compatible).**
    - Aucun texte lu n'impose à la solution compatible de valider elle-même.
    - S5 distingue l'application des contrôles par les PA et par les « solutions compatibles ».
    - S5 présente les schematrons comme des composants « qui ont vocation à servir de référence, voire à être utilisés par le plus grand nombre ».
    - Une pré-validation par Iris avec les mêmes artefacts évite les rejets, qui sont coûteux (EX-26).
- **Sources.**
  - S3 §2.1, §2.2 et §2.4.
  - S5, chapitre « Application », §1 et §2.1.
  - S6.
  - S1 : artefacts publiés, dont `BR-FR-Flux2-Schematron-CII.sch`, `BR-FR-Flux2-Schematron-UBL.sch` et `BR-FR-CDV-Schematron-CDAR.sch`, sous licence Apache 2.0.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire pour la PA ; **recommandé (fortement)** pour Iris, dès le 01-09-2026.
- **À valider.**
  - Versions des artefacts : EN16931 validation-1.3.17 publiée le 12-10-2026, et 1.3.16 citée comme applicable au 15-05-2026 par S5. Suivre les mises à jour semestrielles de la Commission européenne.
  - Les règles B2G (BR-FR-CPRO) ne sont pas encore couvertes par les schematrons.

#### EX-08 : Représentation lisible jointe et taille maximale

- **Énoncé.**
  - Si une représentation lisible est jointe (BG-24, BT-123 = `LISIBLE`), elle doit contenir **toutes** les informations du fichier structuré.
  - Une facture ne peut porter qu'un seul `LISIBLE` (BR-FR-18).
  - En Factur-X, le PDF tient lieu de lisible.
  - Les codes de pièces jointes sont listés par BR-FR-17 : `RIB`, `LISIBLE`, `BON_COMMANDE`, `BON_LIVRAISON`, `ETAT_ACOMPTE`, etc.
  - Une facture de moins de 100 Mo, pièces jointes comprises, doit pouvoir être traitée. Au-delà, le statut Irrecevable est permis (BR-FR-19).
  - L'API AFNOR limite un fichier à 100 Mo.
- **Sources.**
  - S2, BR-FR-17, BR-FR-18, BR-FR-19.
  - S5, chapitre « Application » : « la fourniture d'un lisible doit contenir toutes les informations du fichier structuré ».
  - S3 §3.3.2.3.
  - S4, `FlowPostRequest` (« Max size = 100 MB »).
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire si un lisible est joint ; respecter la taille maximale. Joindre un lisible : recommandé.
- **À valider.** Rien.

### C. Émission : données de la facture

#### EX-09 : Numéro de facture, unicité et date

- **Énoncé.**
  - **Format du numéro (BT-1).**
    - 35 caractères au plus (BR-FR-01).
    - Caractères permis : `A-Z a-z 0-9 - + _ /` (BR-FR-02).
  - **Unicité.**
    - Identifiant unique = numéro (BT-1) + année de la date d'émission (BT-2) + SIREN du vendeur (BT-30).
    - Une facture identique sur ces trois données à une facture déjà envoyée **est rejetée**. Le contrôle est « systématiquement bloquant » (BR-FR-CO-02).
    - La numérotation doit respecter le BOI-TVA-DECLA-30-20-20-10 du 18-10-2023, section A.
    - Sous mandat de facturation, le numéro porte une racine propre au mandataire.
  - **Date.**
    - La date de facture ne peut pas être postérieure à la date du contrôle (BR-FR-CO-01, pas d'antidatage dans l'avenir).
    - Toute année est comprise entre 2000 et 2099 (BR-FR-03).
- **Sources.**
  - S2, feuille « BR-France CTC », règles BR-FR-01, BR-FR-02, BR-FR-03, BR-FR-CO-01, BR-FR-CO-02.
  - S2, feuille « Règles de gestion 3.2 », G1.05 et G1.07.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2026.
- **À valider.**
  - G1.05 (règles DGFiP 3.2) admet l'espace sous conditions. BR-FR-02 a supprimé ce texte en V1.1. Choix le plus sûr : aucun espace.
  - Pour l'unicité, la DGFiP raisonne par année civile de BT-2. La numérotation continue d'Iris doit rester compatible avec ce contrôle.

#### EX-10 : Types de documents autorisés (BT-3)

- **Énoncé.** Seuls les types suivants sont admis. Les autres codes UNTDID 1001 sont interdits.

  | Famille | Codes |
  |---|---|
  | Factures | 380 commerciale ; 389 auto-facturée ; 393 affacturée ; 501 auto-facturée affacturée |
  | Factures d'acompte | 386 ; 500 auto-facturée |
  | Factures rectificatives | 384 ; 471 ; 472 ; 473 |
  | Avoirs | 381 ; 261 auto-facturé ; 262 remise globale ; 396 affacturé ; 502 ; 503 avoir de facture d'acompte |

- **Sources.** S2, BR-FR-04 et G1.01.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2026.
- **À valider.** Certains codes (501, 500, 471 à 473, 502, 503) sont signalés « en attente de l'intégration des codes par la maintenance EN16931 » (feuille « BR-FR-CDV pour factures »). Iris n'en a besoin que pour 380, 381, 384, 386 et 503.

#### EX-11 : Cadre de facturation (BT-23), qui porte la catégorie d'opération

- **Énoncé.**
  - BT-23 est **obligatoire** depuis la V1.4.
  - Son premier caractère donne la **catégorie d'opération**, exigée par l'art. 242 nonies A :
    - `B` : livraison de biens ;
    - `S` : prestation de services ;
    - `M` : facture « double », avec des biens et des services indépendants, aucun n'étant l'accessoire de l'autre.
  - Le chiffre qui suit précise la situation :

    | Chiffre | Situation |
    |---|---|
    | 1 | Dépôt simple |
    | 2 | Déjà payée |
    | 3 | S3 : sous-traitance avec paiement direct, B2G seulement |
    | 4 | Facture définitive après acompte |
    | 5 | S5 : facture d'un sous-traitant |
    | 6 | S6 : facture d'un cotraitant |
    | 7 | Opération ayant déjà fait l'objet d'un e-reporting (TVA déjà collectée) |
    | 8 | Facture multi-vendeurs |
    | 9 | Facture bidirectionnelle |

  - Pour une opération mixte avec un élément accessoire, c'est la catégorie de l'opération **principale** qui s'applique (CGI art. 257 ter II, cité par S3).
- **Sources.**
  - S2, BR-FR-08 : V1.4 du 30-06-2026, qui rend BT-23 obligatoire.
  - S3, cas n°31 (§3.2.30).
  - S2, G1.02.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2026.
- **À valider.**
  - Catégorie à retenir pour les interventions SAV ou maintenance qui comprennent pièces et main-d'œuvre (Q-05).
  - Catégorie des travaux immobiliers.

#### EX-12 : Mentions obligatoires (art. 242 nonies A), dont les quatre nouvelles

- **Énoncé.**
  - Les mentions classiques restent dues. Quatre mentions s'y ajoutent (décret 2022-1299) :

    | Nouvelle mention | Donnée de la facture |
    |---|---|
    | SIREN du client | BT-47 |
    | Catégorie de l'opération : biens, services ou mixte | BT-23, premier caractère |
    | Option pour le paiement de la TVA d'après les débits, le cas échéant | BT-8 (EX-15) |
    | Adresse de livraison si elle diffère de l'adresse de facturation | BG-15 (EX-16) |

  - Les règles BR-FR traduisent aussi d'autres mentions : notes de pénalités (EX-17), date de livraison (BR-FR-CO-17, qui cite « art. 242 nonies A 10° »), franchise (BR-FR-CO-16).
- **Sources.**
  - S13, CGI ann. II art. 242 nonies A. Légifrance indique, selon un extrait indexé, une application « aux factures émises à compter du 1er septembre 2026 » pour les opérations relevant des art. 289 bis, 290 et 290 A.
  - Correspondance avec les données : S2, BR-FR-11, BR-FR-08, BR-FR-MAP-03, BR-FR-14, BR-FR-CO-17.
- **Vérification.**
  - Correspondance des données : vérifiée.
  - Texte de l'article et date d'application : **non vérifiés**.
- **Classement.** Obligatoire. Date : 01-09-2026 selon Légifrance, mais BR-FR-14 reporte l'adresse de livraison au 01-09-2027 (EX-16). À trancher (Q-04).
- **À valider.**
  - Date d'application pour une PME qui n'émet qu'au 01-09-2027.
  - Libellés exacts sur la représentation lisible (Q-14).
  - Liste complète des mentions classiques à relire dans l'article.

#### EX-13 : SIREN et SIRET des parties

- **Énoncé.**
  - SIREN du **vendeur** (BT-30) : obligatoire, présent et actif dans l'annuaire (BR-FR-10).
  - SIREN de l'**acheteur** (BT-47) : obligatoire pour l'e-invoicing, présent et actif dans l'annuaire (BR-FR-11).
  - Un SIREN compte 9 chiffres (schemeID `0002`, ou `0231` pour un assujetti unique) (BR-FR-32).
  - Un SIRET compte 14 chiffres, et ses 9 premiers chiffres égalent le SIREN (BR-FR-09).
  - Pas deux identifiants privés de même schéma (BR-FR-CO-10).
- **Sources.** S2, règles BR-FR-09, BR-FR-10, BR-FR-11, BR-FR-32, BR-FR-CO-10, BR-FR-CO-11.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2026.
- **À valider.** Rien.

#### EX-14 : Adresses électroniques de facturation

- **Énoncé.**
  - L'adresse électronique de l'**acheteur** (BT-49) est obligatoire dès que la facture est transmise et attend des statuts (BR-FR-12). Hors auto-facturation, en e-invoicing :
    - elle commence par le SIREN de l'acheteur ;
    - elle s'écrit `SIREN` ou `SIREN_xxx`, avec le schemeID `0225` (BR-FR-21) ;
    - ses caractères sont `A-Z a-z 0-9 - _ .` (BR-FR-23) ;
    - elle compte 125 caractères au plus (BR-FR-25).
  - L'adresse électronique du **vendeur** (BT-34) est obligatoire (BR-FR-13). C'est l'adresse où il reçoit ses statuts. Elle n'a pas à figurer dans l'annuaire, sauf en auto-facturation.
- **Sources.**
  - S2, règles BR-FR-12, BR-FR-13, BR-FR-21 à BR-FR-25.
  - S3 §1.4.2 : « il est important de bien distinguer le SIREN des clients, identifiant légal, de l'adresse de facturation électronique du client ».
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2026.
- **À valider.** Rien.

#### EX-15 : Option pour le paiement de la TVA d'après les débits

- **Énoncé.**
  - Si le vendeur a opté pour les débits, BT-8 (code de date d'exigibilité) est **obligatoire sur les factures de services** :
    - valeur `5` en CII ;
    - valeur `3` en UBL.
  - Le PPF n'attend que ces valeurs. Un code « date de livraison » (29 en CII, 35 en UBL) est ramené à 5 ou 3 dans le flux 1.
  - L'option est générale : elle vaut pour toutes les factures émises.
- **Sources.**
  - S2, BR-FR-MAP-03 et BR-FR-MAP-29.
  - S2, règles DGFiP G1.43, P1.11 et G6.11 (trajectoire Démarrage).
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire (si l'option est exercée) au 01-09-2026.
- **À valider.** Faut-il aussi un libellé en clair sur le lisible (Q-14) ?

#### EX-16 : Adresse de livraison

- **Énoncé.**
  - Si l'adresse de livraison diffère de celle de l'acheteur (BG-8), certaines données de BG-15 deviennent obligatoires **à partir du 01-09-2027** :
    - BT-75, ligne 1 ;
    - BT-77, localité ;
    - BT-78, code postal ;
    - BT-80, pays.
  - Elles peuvent aussi être données à la ligne (EXT-FR-FE-BG-10).
  - « Ces données ne sont pas à transmettre pour les prestations de service. »
  - La règle n'est pas contrôlable automatiquement.
- **Sources.** S2, BR-FR-14 ; trajectoire « Cible » G6.12.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2027. Recommandé dès maintenant pour les livraisons de biens.
- **À valider.**
  - Contradiction possible avec une application de l'art. 242 nonies A au 01-09-2026 (Q-04).
  - Sens de « pas pour les prestations de service » pour l'adresse d'un chantier ou d'un site d'intervention.

#### EX-17 : Notes obligatoires et date de livraison

- **Énoncé.**
  - **Notes.** Toute facture porte au moins trois notes (BG-1). Chaque code n'est présent qu'une fois (BR-FR-06).
    - `PMT` : indemnité forfaitaire de recouvrement de 40 € ;
    - `PMD` : pénalités de retard ;
    - `AAB` : escompte, ou absence d'escompte.
  - Codes réservés pour d'autres mentions (BR-FR-07) :
    - `ABL` : mentions légales (RCS, répertoire des métiers) ;
    - `AAI` : informations générales ;
    - `SUR` : remarques du vendeur ;
    - `BLU` : éco-participation ;
    - `CUS` : information douanière ;
    - `ACC` : clause de subrogation (affacturage) ;
    - `ADN` : facture B2G ;
    - `BAR` : traitement attendu (EX-03).
  - `TXD` sert au membre d'un assujetti unique (BR-FR-CO-14) et ne peut figurer qu'une fois (BR-FR-06).
  - **Date de livraison.**
    - La date de livraison ou de fin d'exécution (BT-72), ou à défaut la période de facturation (BG-14), est due si elle est déterminée et diffère de la date d'émission.
    - Elle peut être donnée à la ligne en cas de livraisons multiples (BR-FR-CO-17).
- **Sources.** S2, BR-FR-05, BR-FR-06, BR-FR-07, BR-FR-CO-17 ; G1.38 et G1.39.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2026.
- **À valider.**
  - Le montant de l'escompte et les taux de pénalités relèvent de la politique de la société.
  - Iris ne doit **inventer aucune valeur** : ce sont des paramètres sans valeur par défaut métier.

#### EX-18 : TVA (catégories, taux, motifs, décimales, devise)

- **Énoncé.**
  - **Catégories admises** (BR-FR-15) : `S`, `E`, `AE` (autoliquidation), `K` (livraison intracommunautaire), `G` (export), `O` (hors champ), `Z` (taux zéro).
  - **Taux admis** (BR-FR-16) : 0, 10, 13, 20, 8.5, 19.6, 2.1, 5.5, 7, 20.6, 1.05, 0.9, 1.75, 9.2, 9.6.
  - **Motif d'exonération** (BT-120 ou BT-121) pour les catégories autres que `S` et `Z`.
  - **Franchise en base** (BR-FR-CO-16) : catégorie `E` et motif `VATEX-FR-FRANCHISE`.
  - En EXTENDED-CTC-FR, les motifs d'exonération deviennent aussi obligatoires **à la ligne et sur les remises et charges de document**, « à compter de juillet 2026 ».
  - **Décimales** (BR-FR-DEC-01 à 04) :

    | Donnée | Format |
    |---|---|
    | Montants | 19 positions, 2 décimales au plus |
    | Quantités | 4 décimales au plus |
    | Prix unitaires | 6 décimales au plus, sans signe (sauf facture bidirectionnelle) |
    | Taux | 4 positions, 2 décimales au plus |

  - **Devise autre que l'euro** (BR-FR-CO-12) : devise de comptabilité BT-6 = EUR, et TVA en euros dans BT-111.
- **Sources.**
  - S2, règles BR-FR-15, BR-FR-16, BR-FR-CO-12, BR-FR-CO-16, BR-FR-DEC-01 à BR-FR-DEC-04.
  - S5, « Préambule ».
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2026.
- **À valider.**
  - Autoliquidation de la sous-traitance du BTP (catégorie `AE`, mention et motif) : Q-06.
  - Arrondis : contrôles de l'EN16931 et tolérance EXTENDED-CTC-FR de 0,01 par ligne (feuille « BR EN16931 + EXT FR et FX »). À croiser avec les règles de calcul d'Iris.

#### EX-19 : Socle de données EN16931 (profil EN16931, CIUS FR) et données transmises à l'administration (« 26 puis 34 données »)

- **Énoncé.** La facture doit contenir au minimum les données obligatoires de la CIUS française. Le tableau ci-dessous les reprend de S2 (colonne « Cardinalité sémantique EN16931 CIUS FR » = 1).

  | Bloc | Données obligatoires |
  |---|---|
  | En-tête | BT-1 numéro ; BT-2 date d'émission ; BT-3 type ; BT-5 devise ; BG-2 et BT-24 profil ; BT-23 cadre (règle française) |
  | Notes | BG-1 avec `PMT`, `PMD` et `AAB` (règle française) |
  | Vendeur | BG-4 ; BT-27 raison sociale ; BT-30 SIREN (règle française) ; BT-31 numéro de TVA (exigé selon la catégorie de TVA, règles EN16931) ; BT-34 adresse électronique (règle française) ; BG-5 et BT-40 pays |
  | Acheteur | BG-7 ; BT-44 raison sociale ; BT-47 SIREN (B2B) ; BT-49 adresse électronique ; BG-8 et BT-55 pays |
  | Représentant fiscal, s'il y en a un | BT-62 ; BT-63 ; BG-12 et BT-69 |
  | Paiement, si le bloc est présent | BT-81 moyen de paiement ; BT-84 IBAN pour un virement |
  | Totaux (BG-22) | BT-106 somme des lignes ; BT-109 total HT ; BT-110 total de TVA (si TVA) ; BT-112 total TTC ; BT-115 net à payer |
  | Ventilation de TVA (BG-23, une ou plusieurs) | BT-116 base ; BT-117 montant ; BT-118 catégorie ; BT-119 taux (selon la catégorie) ; BT-120 ou BT-121 motif (selon la catégorie) |
  | Lignes (BG-25, une ou plusieurs) | BT-126 identifiant ; BT-129 quantité ; BT-130 unité ; BT-131 montant net ; BG-29 et BT-146 prix net ; BG-30 et BT-151 catégorie de TVA ; BG-31 et BT-153 désignation |
  | Remises et charges de document, si présentes | BT-92 et BT-95 ; BT-99 et BT-102 |
  | Facture antérieure (avoir, rectificative) | BG-3 ; BT-25 ; BT-26 (EX-21) |

  Sur cette facture, la PA extrait le **flux 1** pour l'administration, en deux temps :
  - **Démarrage** (G6.11), au 01-09-2026 :
    - en-tête, identifiants et TVA des parties ;
    - BT-8 ;
    - date de livraison ou période ;
    - totaux et ventilation de TVA ;
    - motifs d'exonération.
  - **Cible** (G6.12), au 01-09-2027 :
    - BT-26 ;
    - remises et charges de document (BG-20, BG-21) ;
    - lignes : quantité, unité, prix net et brut, rabais, remises et charges de ligne, désignation, période de ligne ;
    - adresse et date de livraison à la ligne ;
    - facture antérieure à la ligne.
- **« 34 données cibles 2027 ».**
  - La FAQ DGFiP mentionne « 26 données obligatoires en 2026 puis 34 données dès 2027 », et la liste figurerait à l'art. 41 septies D de l'annexe IV.
  - Cette liste exacte n'a **pas pu être lue** (S9, S20, S16).
  - L'équivalent vérifié le plus proche est la répartition « Démarrage » et « Cible » de S2 (feuilles « FE EN16931 + EXTENDED », colonne « DEMARRAGE / CIBLE », et « Règles de gestion 3.2 », G6.11 et G6.12). Elle compte les sous-éléments, d'où des totaux différents de 26 et 34.
- **Sources.**
  - S2, feuille « FE EN16931 + EXTENDED », V1.4 du 30-06-2026.
  - S2, feuille « Règles de gestion 3.2 » : reproduction de l'annexe 7 des spécifications DGFiP v3.2.
  - S9, S16 et S20 pour les « 26 puis 34 ».
- **Vérification.** Vérifiée pour S2. **Non vérifiée** pour la liste « 26 puis 34 ».
- **Classement.** Obligatoire. Les données de facture sont dues au 01-09-2026. L'extraction « Cible » par la PA commence au 01-09-2027.
- **À valider.** Obtenir le PDF DGFiP S20 et l'art. 41 septies D modifié par l'arrêté du 27-07-2026, puis rapprocher les deux listes.

#### EX-20 : Facture d'acompte et facture définitive

- **Énoncé.**
  - **Obligation de facturer l'acompte** : « Tout assujetti est tenu de délivrer une facture pour les acomptes qui lui sont versés (article 289-I.1.c du CGI) avant que l'une des opérations visées aux a et b du 1 du I du même article ne soit effectuée (sauf exception expressément prévue). » (S3 §3.2.19, qui cite le CGI : texte du CGI non lu, S14.)
  - **Facture d'acompte.**
    - Type 386 ; avoir d'acompte : type 503.
    - Cadre B1, S1 ou M1 ; B2, S2 ou M2 si l'acompte est déjà payé.
    - Une ligne d'acompte par taux de TVA, au prorata.
    - BT-9 = date de versement, si elle est connue et diffère de la date d'émission (BR-FR-CO-06).
  - **Facture définitive.**
    - Type 380, cadre B4, S4 ou M4.
    - Elle référence la ou les factures d'acompte : BG-3, avec BT-25 et BT-26.
    - Elle ne peut pas être de type acompte (BR-FR-CO-08).
    - Deux méthodes de déduction de l'acompte sont admises :
      - par une ligne de reprise de quantité −1 : TVA juste, pré-remplissage juste ;
      - par le montant déjà payé (BT-113) : le pré-remplissage de TVA est alors « erroné », selon la norme.
  - **TVA.**
    - Elle est exigible à l'encaissement de l'acompte, pour les biens comme pour les services, même avec l'option pour les débits.
    - Le statut « Encaissée » est donc dû (EX-30).
- **Sources.** S3, cas n°20 et 21 (§3.2.19) ; S2, règles BR-FR-04, BR-FR-CO-06 à BR-FR-CO-08.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2026.
- **À valider.**
  - Méthode de reprise d'acompte à retenir : la ligne négative est recommandée par la norme pour le pré-remplissage.
  - « Encaissée » sur les acomptes de **biens** (Q-07).

#### EX-21 : Avoir et facture rectificative

- **Énoncé.**
  - **Avoir** (381, 261, 396, 502, 503) : il référence au moins une facture antérieure (BT-25 et BT-26), ou une facture antérieure sur chaque ligne de détail (BR-FR-CO-05).
  - **Avoir de remise globale** (262) : il exige le numéro de contrat (BT-12) et la période (BG-14) (BR-FR-CO-03).
  - **Facture rectificative** (384) :
    - elle référence **une et une seule** facture antérieure, avec sa date (BR-FR-CO-04) ;
    - elle « annule et remplace » la facture référencée, qui doit être annulée en comptabilité ;
    - un statut « Annulée » (220) peut clore le cycle de vie de la facture initiale.
  - L'avoir et la facture rectificative suivent le circuit d'une facture : flux 1, statut « Déposée », statuts de traitement.
- **Sources.**
  - S2, règles BR-FR-CO-03, BR-FR-CO-04, BR-FR-CO-05.
  - S3 §1.3, §2.6 (litige suivi d'un avoir) et §2.7 (litige suivi d'une facture rectificative).
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2026.
- **À valider.** La facture rectificative (384) n'est pas un avoir. Iris, qui fige les factures émises, doit savoir annuler la facture initiale **sans la modifier** : écriture d'annulation et statut 220.

#### EX-22 : Facture déjà payée

- **Énoncé.** Avec un cadre B2, S2 ou M2 :
  - montant déjà payé (BT-113) = total TTC (BT-112) ;
  - net à payer (BT-115) = 0 ;
  - BT-9 = date du paiement.

  Si la TVA est due à l'encaissement, le statut « Encaissée » reste dû.
- **Sources.** S2, BR-FR-CO-07 et BR-FR-CO-09 ; S3, cas n°2 (§3.2.3).
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire, si la société a ce cas.
- **À valider.** Rien.

#### EX-23 : Sous-traitance et cotraitance

- **Énoncé.**
  - Les cadres S5 (facture d'un sous-traitant) et S6 (facture d'un cotraitant) existent.
  - La sous-traitance avec paiement direct (S3) est réservée au B2G.
  - Des statuts complémentaires existent, comme « Demande de paiement direct » (224).
  - Les cas d'usage n°13 et 14 décrivent la cinématique.
- **Sources.** S2, BR-FR-08 et feuille « Acteurs CDV » ; S3, cas n°13 et 14.
- **Vérification.** Vérifiée (cadres et statuts). Cas 13 et 14 non relus en détail.
- **Classement.** Confort, selon l'activité de la société.
- **À valider.** Autoliquidation du BTP et retenue de garantie (Q-06).

### D. Cycle de vie

#### EX-24 : Connaître et suivre tous les statuts, avec leurs codes officiels

- **Énoncé.** Iris doit stocker et afficher le statut de chaque facture émise ou reçue, avec son code, son émetteur, sa date et son motif. Liste officielle :

  | Code | Libellé | Phase | Qui le pose | Destinataire | Transmis au PPF | UNTDID 1373 |
  |---|---|---|---|---|---|---|
  | 200 | Déposée | Transmission | PA-E | Émetteur ; PPF | **Oui** | 10 |
  | 201 | Émise par la plateforme | Transmission | PA-E | Émetteur | Non | 51 |
  | 202 | Reçue de la plateforme | Transmission | PA-R | Émetteur (via la PA-E) ; destinataire | Non | 43 |
  | 203 | Mise à disposition | Transmission | PA-R | Émetteur ; destinataire | Non | 48 |
  | 204 | Prise en charge | Traitement | Acheteur ou son agent | Vendeur (via la PA-R puis la PA-E) | Non | 45 |
  | 205 | Approuvée | Traitement | Acheteur | Vendeur | Non | 1 |
  | 206 | Approuvée partiellement | Traitement | Acheteur | Vendeur | Non | 49 |
  | 207 | En litige | Traitement | Acheteur | Vendeur | Non | 46 |
  | 208 | Suspendue | Traitement | Acheteur | Vendeur | Non | 39 |
  | 209 | Complétée | Traitement | Vendeur (émetteur) | Acheteur | Non | 37 |
  | 210 | Refusée | Traitement | Acheteur | Vendeur ; PPF | **Oui** | 50 |
  | 211 | Paiement transmis | Traitement | Acheteur (le vendeur s'il s'agit d'une auto-facture) | Vendeur | Non | 47 |
  | 212 | Encaissée | Traitement | Vendeur (ou un tiers pour son compte) | Acheteur ; PPF | **Oui**, si la TVA est due à l'encaissement | 47 |
  | 213 | Rejetée | Transmission | PA-E (à l'émission) ou PA-R (en réception) | Émetteur ; PPF ; en réception, aussi la PA-E et, pour information, l'acheteur | **Oui** | 8 |
  | 214 | Visée | Traitement | Agent du vendeur ou de l'acheteur | Les deux | Non | 5 |
  | 220 | Annulée | Traitement | Vendeur ou acheteur, après une facture rectificative | La contrepartie | Non | 5 |
  | 221 | Erreur de routage | Transmission | PA-R | PA-E | Non | 5 |
  | 224 | Demande de paiement direct | Traitement | Vendeur sous-traitant | Acheteur final | Non | 5 |
  | 225 | Affacturée | Traitement | Vendeur | Acheteur ; affactureur | Non | 5 |
  | 226 | Affacturée confidentiel | Traitement | Vendeur | Affactureur | Non | 5 |
  | 227 | Changement de compte à payer | Traitement | Vendeur | Acheteur | Non | 5 |
  | 228 | Non affacturée | Traitement | Vendeur | Affactureur ; acheteur | Non | 5 |
  | 500 | Recevable (lot) | Technique | PA | Émetteur | Non | — |
  | 501 | Irrecevable | Technique | PA-R (ou PA-E) | Émetteur | Non | 5 |

- **Règles.**
  - Les statuts de transmission se suivent dans cet ordre. Les statuts de traitement « peuvent être posés de façon indépendante » (S3 §2.1).
  - « Déposée » n'est plus transmis à la PA-R (S3, V1.1).
  - Les PA transmettent à la PA contrepartie les statuts de transmission, sauf « Émise », « Déposée » et « Rejetée à l'émission ».
- **Sources.**
  - S2, feuille « Acteurs CDV » : tableau des codes MDT-105 et UNTDID 1373, mis à jour en mai 2026.
  - S2, feuille « BR-FR-CDV pour factures », règle BR-FR-CDV-CL-05.
  - S3 §2.1 (figure 1) et §3.2.1.3.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2026, pour suivre et restituer les statuts reçus de la PA.
- **À valider.** La liste reste ouverte : BR-FR-CDV-CL-06 est laissée en « warning » « pour permettre d'autres codes à venir ». Iris doit accepter un code inconnu sans planter.

#### EX-25 : Les quatre statuts obligatoires et leur caractère définitif

- **Énoncé.**
  - Quatre statuts sont obligatoirement transmis au concentrateur du PPF :

    | Statut | Code | Qui le pose |
    |---|---|---|
    | Déposée | 200 | PA-E |
    | Rejetée | 213 | PA-E ou PA-R |
    | Refusée | 210 | Acheteur, via la PA-R |
    | Encaissée | 212 | Vendeur, via la PA-E, **seulement si la TVA est due à l'encaissement** |

  - Pour le PPF, « tout statut "Rejetée" ou "Refusée" posé sur une facture ne peut pas être suivi d'un autre statut » obligatoire pour cette facture.
- **Sources.**
  - S3 §2.1 : « parmi ces statuts, 4 sont dits "obligatoires" […] "Déposée", "Rejetée", "Refusée" et "Encaissée" ».
  - S3 §2.5.
  - S2, règle DGFiP G7.44 : « Liste des statuts obligatoires : 200, 210, 212, 213 ».
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2026.
- **À valider.** Rien sur le principe.

#### EX-26 : Rejet et refus (numérotation, avoir, nouvelle facture)

Cette exigence est critique pour les invariants d'Iris : numérotation continue et factures émises figées.

- **Énoncé : le rejet (213).**
  - Il est posé **par une PA** quand un contrôle réglementaire échoue : format, règles, doublon, adresse.
    - À l'émission, la facture ne part pas : le statut va au PPF et au vendeur, **pas** au destinataire.
    - En réception, la facture n'est pas délivrée à l'acheteur, sauf s'il la demande. Le statut va au PPF, à la PA-E et à l'acheteur pour information.
  - **Obligation du vendeur** : « Le VENDEUR DOIT annuler la comptabilisation d'une facture sur laquelle un statut "Rejetée" a été posé […], par exemple au travers de la création d'un AVOIR INTERNE non transmis à la PA-E, sur la base du statut de cycle de vie "Rejetée", ou transmis à sa PA-E uniquement pour archivage et non transmission. »
  - Si la PA-E reçoit un avoir qui référence une facture rejetée, elle ne le transmet pas et ne produit pas de flux 1. Ce traitement est présenté comme une fonctionnalité optionnelle de la PA-E (S3 §2.2), et repris par la note `ARCHIVEONLY` (EX-03).
- **Énoncé : le refus (210).**
  - Il est posé **par l'acheteur**, après réception, avec un motif obligatoire pris dans une liste stricte (EX-27).
  - Le flux 1 de la facture est alors ignoré pour le pré-remplissage de TVA. L'effet n'est annulé que si le refus arrive dans la période de pré-remplissage concernée.
  - « En théorie, ceci impose au VENDEUR d'annuler la facture "Refusée" dans ses comptes, par exemple par la création d'un AVOIR INTERNE non transmis à l'ACHETEUR et sans flux 1 transmis au CdD PPF, et à la création d'une nouvelle facture si nécessaire. »
  - L'acheteur n'attend aucun avoir : le statut « Refusée » lui sert de pièce justificative.
  - Le vendeur peut contester le refus, hors cycle de vie. Il ne crée alors pas d'avoir, et accepte un écart avec le pré-remplissage de TVA.
- **Énoncé : le numéro.**
  - Le contrôle d'unicité, « systématiquement bloquant », rejette toute facture qui reprend le numéro, l'année et le SIREN d'une facture « précédemment envoyée » (BR-FR-CO-02, EX-09).
  - **Une facture de remplacement doit donc porter un nouveau numéro.**
  - Selon des extraits indexés du guide pratique DGFiP (S8, non lu), « la nouvelle facture doit porter un nouveau numéro » pour éviter toute confusion et un rejet pour réutilisation du numéro.
- **« Réputée non émise ? ».**
  - Cette formule n'apparaît dans **aucune source officielle lue**. Seuls des sites secondaires l'emploient, et ils divergent sur la réutilisation du numéro.
  - Les sources vérifiées (S3) imposent au contraire une **annulation comptable** de la facture rejetée. Cela suppose qu'elle existe dans les comptes et que son numéro est consommé.
- **Sources.**
  - S3, XP Z12-014 Annexe A V1.4 du 30-06-2026 :
    - §2.2 (rejet à l'émission), « Obligations du VENDEUR » ;
    - §2.4 (rejet en réception) ;
    - §2.5 (refus), dont la NOTE sur la contestation.
  - S2, règles BR-FR-CO-02 et BR-FR-20 (`ARCHIVEONLY` : « AVOIR interne créé pour annuler une facture REJETÉE ou REFUSÉE »).
  - S8, pour le nouveau numéro (non vérifiée).
- **Vérification.** Vérifiée pour S2 et S3. Non vérifiée pour S8 et pour la qualification juridique (« facture émise » au sens de l'art. 289 du CGI).
- **Classement.** Obligatoire au 01-09-2026.
- **Ce que cela implique pour Iris.** La lecture suivante est compatible avec les invariants d'Iris, sous réserve du cabinet :
  - la facture rejetée ou refusée reste figée, avec son numéro et son statut ;
  - un avoir interne `ARCHIVEONLY`, numéroté dans la série des avoirs, l'annule en comptabilité ;
  - la nouvelle facture prend le numéro suivant.
- **À valider.** Q-01, Q-02, Q-03.

#### EX-27 : Motifs de statut, obligatoires et listés

- **Énoncé.** Un motif (MDT-113) est **obligatoire** pour six statuts (BR-FR-CDV-15) : Rejetée (213), Refusée (210), En litige (207), Approuvée partiellement (206), Suspendue (208) et Irrecevable (501). Le motif doit appartenir à la liste prévue **pour ce statut** (BR-FR-CDV-CL-09). Liste officielle :

  | Statut | Motifs admis |
  |---|---|
  | **Rejetée à l'émission** | MONTANTTOTAL_ERR, CALCUL_ERR, DOUBLON, DEST_INC, ADR_ERR, REJ_SEMAN, REJ_UNI, REJ_COH, REJ_ADR, REJ_CONT_B2G, REJ_REF_PJ, REJ_ASS_PJ |
  | **Rejetée en réception** | MONTANTTOTAL_ERR, CALCUL_ERR, DOUBLON, ADR_ERR, REJ_SEMAN, REJ_UNI, REJ_COH, REJ_ADR, REJ_CONT_B2G, REJ_REF_PJ, REJ_ASS_PJ |
  | **Refusée (B2B)** | TX_TVA_ERR, MONTANTTOTAL_ERR, CALCUL_ERR, NON_CONFORME (mention légale manquante), DOUBLON, DEST_ERR, TRANSAC_INC, EMMET_INC, CONTRAT_TERM, DOUBLE_FACT, CMD_ERR (seulement si le numéro de commande a été fourni avant la facturation), ADR_ERR, REF_CT_ABSENT |
  | **En litige** | Tous les motifs du refus B2B, plus COORD_BANC_ERR, SIRET_ERR, CODE_ROUTAGE_ERR, REF_ERR, PU_ERR, REM_ERR, QTE_ERR, ART_ERR, MODPAI_ERR, QUALITE_ERR, LIVR_INCOMP et AUTRE |
  | **Approuvée partiellement** | CMD_ERR, SIRET_ERR, CODE_ROUTAGE_ERR, REF_CT_ABSENT, REF_ERR, PU_ERR, REM_ERR, QTE_ERR, ART_ERR, MODPAI_ERR, QUALITE_ERR, LIVR_INCOMP, AUTRE |
  | **Suspendue** | JUSTIF_ABS, COORD_BANC_ERR, CMD_ERR, SIRET_ERR, CODE_ROUTAGE_ERR, REF_CT_ABSENT, REF_ERR |
  | **Erreur de routage** | ROUTAGE_ERR |
  | **Déposée** | NON_TRANSMISE (destinataire sans PA active) |
  | **Irrecevable** | IRR_VIDE_F, IRR_TYPE_F, IRR_SYNTAX, IRR_TAILLE_PJ, IRR_NOM_PJ, IRR_VID_PJ, IRR_EXT_DOC, IRR_TAILLE_F, IRR_ANTIVIRUS, IRR_NOM_F |
  | **Refusée (B2G, Chorus Pro seulement)** | Tous les motifs du refus B2B, plus RETRAIT_MAN_SERV, ST_CT_NON_DECLAR, SUPPR_COMP_AVOIR, TRANSF_PMNT_REGIE, CONTACT_ACHTR, AUTRE, COORD_BANC_ERR et LIVR_INCOMP. Ils ne sont acceptés que si le refus vient d'un acheteur public sur Chorus Pro (matricule 9999). |

  Des codes d'**action attendue** (MDT-121) peuvent accompagner le statut : `NOA` (aucune), `PIN` (information complémentaire), `NIN` (facture rectificative), `CNF` (avoir total), `CNP` (avoir partiel), `CNA` (remboursement), `OTH` (autre).
- **Sources.**
  - S2, feuille « Tableau des motifs de STATUTS » (corrections de 06-2026).
  - S2, feuille « Codes Action ».
  - S2, feuille « BR-FR-CDV pour factures », règles BR-FR-CDV-15 et BR-FR-CDV-CL-09.
- **Vérification.** Vérifiée. Les rattachements ligne par ligne du tableau source sont à recopier tels quels lors de l'implémentation.
- **Classement.** Obligatoire au 01-09-2026.
- **À valider.** Rien. La liste peut évoluer avec les versions de la norme.

#### EX-28 : Refuser une facture reçue : conditions d'usage

- **Énoncé.**
  - Le refus est réservé à trois cas :
    1. une non-conformité réglementaire que la PA-R n'a pas testée ;
    2. une transaction inconnue ;
    3. une référence contractuelle manquante, que le vendeur connaissait au moment de facturer.
  - Le refus **ne doit pas** servir pour un litige ou un désaccord sur le contenu : on utilise alors « En litige ».
  - Bonne pratique : refuser « dans les jours qui suivent la réception », puis passer au litige.
  - Un acheteur sans PA ne peut pas poser de refus.
- **Sources.** S3 §2.5 et §2.3.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire (forme et motifs) au 01-09-2026, côté réception.
- **À valider.** Le délai n'est pas chiffré : « période de pré-remplissage TVA ».

#### EX-29 : Irrecevable, erreur de routage, et destinataire sans PA

- **Énoncé.**
  - **Irrecevable (501)** : défaut technique ou de structure. Le fichier n'est pas reconnu comme facture. L'émetteur « peut alors corriger et transmettre à nouveau ».
  - **Erreur de routage (221)** : la PA-R n'est pas celle de l'adresse visée. Ce n'est pas un rejet. La PA-E rejoue la transmission après mise à jour de l'annuaire, et la facture n'est pas annulée.
  - **Déposée avec le motif NON_TRANSMISE** : le destinataire est dans l'annuaire mais n'a aucune adresse active.
    - Le vendeur **doit** quand même émettre par sa PA-E.
    - Il peut envoyer un duplicata, par exemple le lisible.
    - Il n'est pas tenu d'annuler ni de réémettre.
    - Il doit poser « Encaissée » si la TVA est due à l'encaissement.
    - La PA-E peut proposer de rejouer la transmission plus tard.
- **Sources.** S3 §2.1, §2.3 et §1.4.4 ; S2, feuille « Tableau des motifs de STATUTS ».
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire (savoir les traiter) au 01-09-2026.
- **À valider.** Un fichier irrecevable peut-il être renvoyé corrigé sous le **même numéro** (Q-02) ?

#### EX-30 : Statut « Encaissée » : quand et avec quelles données

- **Énoncé.**
  - **Quand.** Le vendeur crée, ou fait créer, un statut « Encaissée » **à chaque encaissement partiel ou total**, dès que la TVA est due à l'encaissement :
    - prestations de services sans option pour les débits ;
    - acomptes, même avec l'option pour les débits.
  - **Données.** Au moins un bloc MDG-43 portant :
    - MDT-207 = `MEN` (montant encaissé TTC) ;
    - MDT-215, le montant ;
    - MDT-224, le taux de TVA ;
    - **un bloc par taux de TVA** (BR-FR-CDV-14). Sinon, le PPF rejette avec `REJ_ENCAISSEMENT` (règle G7.45) ;
    - MDT-216, la devise (règle P1.15) ;
    - MDT-219, la date de l'encaissement ;
    - un bloc `RAP` (reste à payer) en cas de paiement partiel, et un bloc `ESC` pour un escompte : facultatifs (P1.16).
  - **Annulation d'un encaissement.** Un statut « Encaissée » de montant **négatif**, avec un motif en commentaire (P1.17 ; cas n°34).
  - **Délai.** Le statut « DOIT être adressé dans la période de e-reporting des données de paiement ». La phrase est écrite pour les acomptes (S3 §3.2.19) ; l'étendre à tout encaissement est une lecture, à confirmer.
  - **Hors encaissement.** Si la TVA n'est pas due à l'encaissement, le vendeur peut transmettre « Encaissée » à l'acheteur seulement, pas au PPF.
  - **Exemple de la norme.** Une facture de 1 160 € TTC donne deux blocs : 720 € à 20 % et 440 € à 10 %.
- **Sources.**
  - S3 §2.1 (obligations des entreprises), §3.2.19 et §3.2.33 (cas n°34).
  - S2, feuille « CDV FE - CDAR » (MDT-207, 215, 216, 219, 224 ; règles G7.45, P1.15 à P1.18).
  - S2, règle BR-FR-CDV-14.
  - S17, CGI ann. II art. 242 nonies P (non vérifiée).
- **Vérification.** Vérifiée pour S2 et S3. Non vérifiée pour le texte légal.
- **Classement.** Obligatoire, pour les services sans option et pour les acomptes. Date de l'émission selon la taille (01-09-2026 ou 01-09-2027).
- **À valider.**
  - Montant TTC (`MEN`) ou « montant net » (P1.15) : Q-08.
  - Acomptes sur livraisons de biens (Q-07).
  - Retenues de garantie, paiements groupés, travaux immobiliers (Q-06).

#### EX-31 : Statut « Paiement transmis »

- **Énoncé.**
  - L'acheteur **peut** transmettre « Paiement transmis » (211) : MDT-207 = `MPA`, le montant TTC payé, et en option le détail par taux.
  - Côté vendeur, Iris le reçoit et peut s'en servir pour le rapprochement.
- **Sources.** S3 §2.1 (étapes 5a à 5c, « recommandé »).
- **Vérification.** Vérifiée.
- **Classement.** Recommandé.
- **À valider.** Rien.

#### EX-32 : Statuts de traitement facultatifs (côté acheteur et côté vendeur)

- **Énoncé.**
  - Côté acheteur : Prise en charge (204), Approuvée (205), Approuvée partiellement (206, avec motif et montants `MAP`, `MNA`), En litige (207, avec motif et action attendue), Suspendue (208, motif `JUSTIF_ABS` par exemple).
  - Côté vendeur : Complétée (209), en réponse à « Suspendue » avec les pièces manquantes.
  - Annulée (220), après une facture rectificative.
  - Iris doit les recevoir (ventes) et pouvoir les poser (achats).
- **Sources.** S3 §2.1, §2.6 et §2.7 ; S2, feuilles « Acteurs CDV » et « CDV FE - CDAR » (BR-FR-CDV-CL-11).
- **Vérification.** Vérifiée.
- **Classement.** Recommandé.
- **À valider.** Rien.

#### EX-33 : Statuts complémentaires (affacturage, paiement direct)

- **Énoncé.** Statuts 224 à 228 : Demande de paiement direct, Affacturée, Affacturée confidentiel, Changement de compte à payer, Non affacturée.
- **Sources.** S3 §3.2.1.3 et cas n°8 à 10 ; S2, feuille « Acteurs CDV ».
- **Vérification.** Vérifiée.
- **Classement.** Confort.
- **À valider.** Rien.

#### EX-34 : Produire soi-même un message de cycle de vie (CDAR)

- **Énoncé.** Si Iris envoie elle-même des statuts à la PA (par exemple par l'API, avec `flowSyntax` = `CDAR`), le message doit respecter :
  - la syntaxe CDAR D22B, contrôlée par le XSD « uncoupled » ;
  - le schematron BR-FR-CDV ;
  - MDT-3 = `urn.cpro.gouv.fr:1p0:CDV:invoice` (BR-FR-CDV-02) ;
  - MDT-77 = `23` (traitement) ou `305` (transmission) (BR-FR-CDV-09) ;
  - MDT-105, le code statut, obligatoire ;
  - MDT-129 = le SIREN du vendeur de la facture (BR-FR-CDV-13) ;
  - les rôles de UNCL 3035 : `SE`, `BY`, `WK`, etc. ;
  - un numéro incrémental de détail (MDT-124-2) (BR-FR-CDV-16).

  Une PA peut aussi offrir une saisie de statut dans son interface ou dans son propre format.
- **Sources.**
  - S2, feuilles « CDV FE - CDAR » et « BR-FR-CDV pour factures ».
  - S5, §1 (contrôle du CDAR en deux étapes).
  - S1, `BR-FR-CDV-Schematron-CDAR.sch`.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire si Iris produit le message ; sinon sans objet.
- **À valider.** Ce que la PA retenue accepte.

### E. Réception

#### EX-35 : Être en mesure de recevoir, via une PA inscrite à l'annuaire

- **Énoncé.**
  - Depuis le 01-09-2026, tout assujetti doit accepter les factures électroniques par une PA.
  - Les destinataires « DOIVENT définir une ou plusieurs adresses de facturation électroniques de réception sous SchemeId 0225 et les faire enregistrer dans l'Annuaire PPF par la PA-R qu'ils ont désignée ».
  - Un assujetti non équipé reçoit des factures « Déposée NON_TRANSMISE » et ne peut pas exiger de papier.
- **Sources.**
  - S3 §1.4.2 et §1.4.4.
  - S14 (CGI art. 289 bis).
  - S14, loi 2026-103 : sanction pour défaut d'équipement en réception, annoncée par S3 §2.3 « sous réserve de son adoption ».
- **Vérification.** Vérifiée pour S3. Non vérifiée pour S14.
- **Classement.** Obligatoire au 01-09-2026.
- **À valider.** Montant et régime de la sanction du défaut de réception (Q-17).

#### EX-36 : Traiter tous les formats et profils du socle

- **Énoncé.**
  - Le vendeur comme l'acheteur doivent « savoir traiter les formats et profils du socle minimum, et notamment le profil EXTENDED-CTC-FR » :
    - UBL ;
    - CII ;
    - Factur-X ;
    - les profils EN16931, EXTENDED-CTC-FR et, la première année, BASIC WL.
  - Les données facultatives ajoutées par la V1.4 peuvent être ignorées. Elles restent visibles dans le lisible.
  - L'API AFNOR permet de télécharger l'original (`Original`), une conversion (`Converted`) ou une vue lisible (`ReadableView`).
- **Sources.**
  - S3, cas n°1 (§3.2.2), « Obligations du VENDEUR et de l'ACHETEUR ».
  - S5, chapitre « Application ».
  - S4, `GET /v1/flows/{flowId}`, paramètre `docType`.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2026 (réception).
- **À valider.**
  - Portée exacte de l'obligation pour une entreprise. La PA peut fournir un lisible ou une conversion : Iris doit-il intégrer toutes les syntaxes, ou seulement celle que la PA lui livre ?

#### EX-37 : Factures d'achat reçues hors du circuit électronique

- **Énoncé.**
  - Selon le guide pratique, une facture reçue par un autre canal ne fait pas perdre automatiquement le droit à déduction (CGI art. 271).
  - Il faut garder la trace de l'échec de l'émission électronique et des démarches engagées.
- **Sources.** S8 (non lu ; extraits secondaires).
- **Vérification.** **Non vérifiée.**
- **Classement.** Recommandé.
- **À valider.** Q-15.

### F. E-reporting

#### EX-38 : Périmètre de l'e-reporting

- **Énoncé.** Doivent être transmises, par la PA :
  - les **données de transaction** :
    - ventes à des non-assujettis (B2C) ;
    - ventes B2B internationales ;
    - acquisitions B2B internationales ;
  - les **données de paiement** :
    - pour les opérations de services dont la TVA est due à l'encaissement, hors e-invoicing ;
    - pour l'e-invoicing, l'encaissement passe par le statut « Encaissée ».

  Une vente qui a fait l'objet d'un e-reporting B2C puis d'une facture a posteriori prend le cadre B7 ou S7 (TVA déjà collectée).
- **Sources.**
  - S2, feuille « E-REPORTING - Flux 10 » (sous-flux 10.1 transactions unitaires, 10.2 paiements unitaires, 10.3 transactions B2C agrégées, 10.4 paiements B2C agrégés).
  - S4, `FlowType` (par exemple `AggregatedCustomerTransactionReport`).
  - S3, cas n°30 et 43 ; S3 §1.4.3.
  - S14 (CGI art. 290 et 290 A).
- **Vérification.** Vérifiée pour S2, S3 et S4. Non vérifiée pour S14.
- **Classement.** Obligatoire, selon la taille (01-09-2026 ou 01-09-2027).
- **À valider.** Pas de flux à zéro à transmettre en l'absence d'opération (PwC, non vérifiée).

#### EX-39 : Données de transaction exigées

- **Énoncé.**
  - **10.1, unitaire** (B2B international, et B2C transmis à l'unité) : les données d'une facture, proches du flux 1 :
    - numéro, date, type, devise ;
    - cadre ;
    - vendeur et acheteur, avec identifiants et pays ;
    - totaux ;
    - ventilation de TVA ;
    - lignes, pour la cible.
  - **10.3, agrégé B2C**, par jour :
    - date (TT-77) ;
    - devise (TT-78) ;
    - **catégorie** (TT-81) : `TLB1` (livraisons de biens soumises), `TPS1` (prestations soumises), `TNT1` (non soumises en France), `TMA1` (régime de la marge) ;
    - total HT (TT-82) ;
    - total de TVA (TT-83) ;
    - répartition par taux (TT-86 à TT-88).
  - **En-tête de transmission :**
    - identifiant unique par période et par déclarant (TT-1, règle G8.05) ;
    - type `IN` (initiale) ou `RE` (rectificative), plus `CO` et `MO` entre l'assujetti et sa PA seulement ;
    - période (TT-17 et TT-18) ;
    - déclarant.
- **Sources.**
  - S2, feuille « E-REPORTING - Flux 10 » (TT-1 à TT-99 ; règles G1.68, G8.01, G8.02, G8.05).
  - S1, `Flux10/` : XSD et schematron du FNFE.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire, selon la taille.
- **À valider.** Rien.

#### EX-40 : Données de paiement exigées

- **Énoncé.**
  - **10.2, unitaire**, par facture : numéro (TT-91), date de facture (TT-102), date de paiement (TT-92), taux (TT-93), montant encaissé (TT-95).
  - **10.4, agrégé B2C** : date de paiement (TT-96), taux (TT-97), montant encaissé (TT-99).
  - Ces données ne sont dues que pour les prestations de services dont la TVA est exigible à l'encaissement.
  - En cas de facture mixte, la catégorie de l'opération principale s'applique.
- **Sources.**
  - S2, feuille « E-REPORTING - Flux 10 ».
  - S3, cas n°31.
  - S17 (art. 242 nonies P) et S18 (non vérifiées).
- **Vérification.** Vérifiée pour S2 et S3. Non vérifiée pour le texte légal.
- **Classement.** Obligatoire, selon la taille.
- **À valider.** Rien sur le principe.

#### EX-41 : Périodicité et délais selon le régime de TVA

- **Énoncé**, selon des sources secondaires **non vérifiées**.

  | Régime de TVA | Données de transaction | Données de paiement |
  |---|---|---|
  | Réel normal mensuel | Par **décade** (du 1 au 10, du 11 au 20, du 21 à la fin du mois) | Mensuel |
  | Réel normal trimestriel | Mensuel | Mensuel |
  | Simplifié | Mensuel | Mensuel |
  | Franchise en base | Bimestriel | Bimestriel |

  - Délai : dans les **10 jours** qui suivent la fin de la période.
  - S3 confirme seulement que le flux 10 est transmis « par décade, par mois, par bimestre », « sous 10 jours de la fin de période pour les entreprises au régime normal ».
- **Sources.**
  - S17 (art. 242 nonies O et P) et S18 (BOFiP du 30-09-2026) : **non vérifiées**.
  - S3 §3.2.42.1 : vérifiée, mais partielle.
- **Vérification.** **Non vérifiée** dans le détail.
- **Classement.** Obligatoire, selon la taille (01-09-2026 ou 01-09-2027).
- **À valider.**
  - Fréquence des paiements.
  - Délai propre au régime simplifié (« entre le 25 et le 30 » selon une source).
  - Suppression annoncée du régime simplifié au 01-01-2027 (une seule source).
  - Voir Q-10.

#### EX-42 : Rattrapages et encaissements non lettrés

- **Énoncé.**
  - Un flux 10 peut contenir des factures antérieures à la période.
  - Une facture ne peut pas être datée après la date de remise.
  - Un encaissement qui ne peut pas être rattaché à une facture avant l'échéance est déclaré en paiement B2C (10.4) au taux le plus probable. Une fois le rattachement fait, il est annulé par un 10.4 négatif, puis redéclaré correctement.
- **Sources.** S3 §3.2.42.1 et cas n°34.
- **Vérification.** Vérifiée.
- **Classement.** Recommandé.
- **À valider.** Rien.

### G. Annuaire

#### EX-43 : Consulter l'annuaire et adresser correctement le destinataire

- **Énoncé.**
  - L'annuaire central contient **toutes** les adresses de réception sous le schemeID `0225` des assujettis et des entités publiques.
  - Les formes d'adresse admises sont :
    - `SIREN` ;
    - `SIREN_SIRET` ;
    - `SIREN_SIRET_CODEROUTAGE` (avec un code de routage préalablement déclaré et actif) ;
    - `SIREN_SUFFIXE` (suffixe libre, recommandé pour des adresses durables).
  - **Une adresse n'est rattachée qu'à une seule PA-R.**
  - Statut d'une ligne : `PA_ACTIVE`, `PA_ATTENTE` ou `PA_ABSENTE`.
  - Consultation : par la PA (API Directory, flux 11) ou sur le portail public (portail.chorus-pro.gouv.fr).
  - L'adresse électronique est une donnée client à gérer à part. Elle est distincte du SIREN, même quand elle a la même valeur.
- **Sources.** S3 §1.4.1 à §1.4.5 ; S2, feuille « Flux F11 - Annuaire » (DT-7-5-1 et DT-7-6-1) ; S4, Directory Service 1.3.0.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2026.
- **À valider.** Rien.

#### EX-44 : Inscrire les adresses de réception de la société

- **Énoncé.**
  - La société définit une ou plusieurs adresses de réception.
  - Sa PA-R les inscrit dans l'annuaire.
  - Une adresse dédiée aux auto-factures est possible.
  - L'adresse de réception des statuts (BT-34) n'a pas à figurer dans l'annuaire.
- **Sources.** S3 §1.4.2 et §1.4.5.
- **Vérification.** Vérifiée.
- **Classement.** Obligatoire au 01-09-2026. L'inscription est faite par la PA.
- **À valider.** Rien.

#### EX-45 : Client assujetti absent de l'annuaire

- **Énoncé.**
  - Un assujetti absent de l'annuaire « peut être considéré comme non assujetti » par ses fournisseurs. Ceux-ci basculent alors en e-reporting B2C (10.3, et 10.4 si la TVA est due à l'encaissement), sans sanction.
  - Différence avec un client présent dans l'annuaire mais sans PA : celui-là relève de « Déposée NON_TRANSMISE » (EX-29).
- **Sources.** S3 §1.4.3 ; S8 (non lu).
- **Vérification.** Vérifiée pour S3.
- **Classement.** Obligatoire (règle de bascule) au 01-09-2026.
- **À valider.** Portée de la tolérance et preuve de la consultation de l'annuaire (Q-15).

### H. Conservation et archivage

#### EX-46 : Durées de conservation et format d'origine

- **Énoncé**, selon des sources **non vérifiées**.
  - Conservation des factures pendant **6 ans** au titre fiscal (LPF art. L102 B) et **10 ans** au titre comptable (Code de commerce art. L123-22).
  - La durée la plus longue s'impose en pratique.
  - Les factures électroniques sont conservées **dans le format où elles ont été émises ou reçues** : le fichier structuré d'origine, et le PDF/A-3 pour un Factur-X.
  - **Pièces justificatives** à conserver aussi, selon les sources vérifiées :
    - les statuts « Refusée » et « Rejetée », qui justifient l'annulation (S3 §2.4 et §2.5) ;
    - l'accord formel de changement de PA, 3 ans après la fin de ses effets (EX-49).
  - L'API AFNOR distingue l'original, la conversion et la vue lisible (S4).
- **Sources.**
  - S19 (LPF L102 B ; C. com. L123-22 ; BOI-CF-COM-10-10-30-10) et S14 (CGI art. 289) : **non vérifiées**.
  - S3 et S4 pour les pièces : vérifiées.
- **Vérification.** **Non vérifiée** pour les durées et le format légal.
- **Classement.** Obligatoire, dès aujourd'hui.
- **À valider.** Q-11 :
  - point de départ des délais ;
  - qui conserve, la PA ou la société (Iris) ;
  - garantie d'intégrité.

#### EX-47 : Intégrité, authenticité et lisibilité

- **Énoncé.**
  - L'authenticité de l'origine, l'intégrité du contenu et la lisibilité de la facture doivent être assurées de l'émission à la fin de la conservation (CGI art. 289 ; piste d'audit fiable).
  - L'API AFNOR fournit une empreinte `sha256` de chaque flux.
- **Sources.** S14 (CGI art. 289) : non vérifiée ; S4, Flow Service 1.0.2 (« Add sha256 fingerprint to allow integrity check ») : vérifiée.
- **Vérification.** **Non vérifiée** pour l'obligation légale.
- **Classement.** Obligatoire (non vérifiée) dès aujourd'hui.
- **À valider.** La piste d'audit fiable reste-t-elle exigée de la société pour des factures transmises par une PA ? Moyen de preuve à retenir (Q-12).

### I. Une ou plusieurs PA, changement de PA

#### EX-48 : Plusieurs PA possibles, une seule par adresse

- **Énoncé.**
  - La société peut confier des adresses de réception différentes, par exemple des `SIREN_SUFFIXE`, à des PA différentes. Une adresse n'a qu'une PA-R.
  - Pour l'émission, rien dans les sources lues n'interdit plusieurs PA-E. Les statuts de traitement reviennent vers la PA qui gère l'adresse de l'émetteur (BT-34).
- **Sources.** S3 §1.4.2 (« parce qu'elle a choisi plusieurs Plateformes Agréées (sachant qu'une adresse de facturation électronique ne peut être associée qu'à une seule Plateforme Agréée de réception) ») et §1.4.5.2.
- **Vérification.** Vérifiée.
- **Classement.** Confort (choix d'organisation). Une installation Iris sert une seule société : une PA suffit au pilote.
- **À valider.** Rien.

#### EX-49 : Changement de PA

- **Énoncé.**
  - **Accord formel**, daté et signé par l'assujetti ou son mandataire. La PA d'arrivée le détient, le numérote et le conserve 3 ans après la fin de ses effets (art. 242 nonies E bis).
  - **Délais :**
    - 2 jours ouvrés pour transmettre le numéro d'accord à la PA de départ ;
    - 5 jours ouvrés pour qu'elle s'oppose ;
    - au moins 3 jours ouvrés de synchronisation avant la date d'effet dans l'annuaire (art. 242 nonies E ter).
  - Chaque PA fournit gratuitement une documentation de mobilité.
  - Après le changement :
    - les factures émises vers la société arrivent sur la nouvelle PA-R ;
    - les statuts des factures émises auparavant arrivent sur la PA qui détient l'adresse de l'émetteur ;
    - un « service minimal » est maintenu 12 mois par l'ancienne PA, « tel que décrit dans la réglementation ».
- **Sources.**
  - S17 (art. 242 nonies E bis et E ter, créés par S15) : **non vérifiés**. Contenu connu par des extraits de Légifrance indexés.
  - S3 §1.4.5.1 et §1.4.5.2 (service minimal de 12 mois) : vérifiée.
- **Vérification.** Vérifiée pour S3. Non vérifiée pour S17.
- **Classement.** Recommandé pour Iris : garder pour chaque facture la PA et l'adresse utilisées, et accepter des statuts venus d'une autre PA. L'obligation légale pèse sur la société et sur les PA.
- **À valider.** Base légale des 12 mois (art. 242 nonies E quater ?) : Q-16.

### J. API XP Z12-013

#### EX-50 : API « Flow Service » (factures, statuts, e-reporting)

- **Énoncé.** Ce qui est public : l'annexe A de la XP Z12-013, au format OpenAPI 3.0.3, version 1.3.0.
  - **Opérations :**

    | Opération | Rôle |
    |---|---|
    | `POST /v1/flows` | Dépôt d'un flux, en `multipart/form-data` : `flowInfo` en JSON et `file` en XML ou PDF, 100 Mo au plus |
    | `POST /v1/flows/search` | Recherche, par exemple avec `updatedAfter` pour une interrogation périodique |
    | `GET /v1/flows/{flowId}` | Téléchargement ; `docType` = `Metadata`, `Original`, `Converted` ou `ReadableView` |
    | `GET`, `POST` et `DELETE /v1/webhooks` | Gestion des abonnements |
    | `GET /v1/healthcheck` | État du service |

  - **Un flux** = une seule facture, ou un CDAR, ou un fichier d'e-reporting.
    - `flowSyntax` : `CII`, `UBL`, `Factur-X`, `CDAR` ou `FRR`.
    - `flowProfile` : `Basic`, `CIUS` ou `Extended-CTC-FR`.
    - `processingRule` : voir EX-03.
    - `trackingId` : identifiant libre de l'émetteur, utile pour l'idempotence.
    - `ackStatus` : `Pending`, `Ok` ou `Error`.
    - `FlowType` : `CustomerInvoice`, `SupplierInvoice`, `CustomerInvoiceLC`, `SupplierInvoiceLC`, et les rapports d'e-reporting.
    - Direction : `In` (de la PA vers la solution) ou `Out`.
  - **Ce qu'Iris doit implémenter côté client :**
    - authentification ;
    - dépôt des factures et des avoirs ;
    - dépôt des statuts qu'elle pose (EX-34) ;
    - récupération des statuts et des factures reçues, par webhook ou par interrogation périodique ;
    - téléchargement de l'original pour l'archivage ;
    - gestion de `trackingId` et contrôle `sha256`.
- **Sources.**
  - S4, Annexe A « AFNOR Flow Service » 1.3.0 (historique des versions 1.0.0 à 1.3.0 compris).
  - S16, arrêté du 27-07-2026 : une PA qui choisit d'offrir une API standardisée doit respecter la XP Z12-013 (non vérifiée).
- **Vérification.** Vérifiée pour S4. Non vérifiée pour S16.
- **Classement.** Recommandé : rester indépendant de la PA choisie. L'API n'est pas obligatoire pour les PA.
- **À valider.**
  - Vérifier que la PA retenue offre cette API, dans quelle version, et à quelle URL de base (le modèle de serveur est paramétrable).
  - Le corps de la norme XP Z12-013 (règles communes, codes d'erreur) n'a pas été lu (S11).

#### EX-51 : API « Directory Service » (annuaire)

- **Énoncé.** Lecture seule, version 1.3.0 :
  - `POST /v1/siren/search` et `GET /v1/siren/code-insee:{siren}` ;
  - `POST /v1/siret/search` et `GET /v1/siret/code-insee:{siret}` ;
  - `POST /v1/routing-code/search` et `GET /v1/routing-code/siret:{siret}/code:{routing-identifier}` ;
  - `POST /v1/directory-line/search` et `GET /v1/directory-line/code:{addressing-identifier}`.

  Ces opérations permettent de vérifier le SIREN et l'adresse d'un client avant d'émettre.
- **Sources.** S4, Annexe B « AFNOR Directory Service » 1.3.0.
- **Vérification.** Vérifiée.
- **Classement.** Recommandé.
- **À valider.** Rien.

#### EX-52 : Sécurité des échanges API

- **Énoncé.**
  - Authentification par jeton Bearer (JWT) ou OAuth2 en mode « client credentials » (identifiant et secret client).
  - En-tête `Organization-Id` pour la délégation multi-entités, et `Request-Id` pour la corrélation.
  - Rappels webhook (callback) en POST :
    - en-tête `Afnor-Signature` (HMAC-SHA-256 en Base64, **facultatif** dans la spécification) ;
    - en-tête `Afnor-Signature-Timestamp` (obligatoire).
- **Sources.** S4, Flow Service 1.3.0 (`securitySchemes`, `components/callbacks/WebhookCallback`, paramètres d'en-tête).
- **Vérification.** Vérifiée.
- **Classement.** Recommandé.
- **À valider.**
  - La signature des webhooks étant facultative, Iris doit l'exiger de la PA, ou à défaut préférer l'interrogation périodique.
  - Le secret OAuth2 est une variable d'environnement à documenter (règle permanente 3 d'Iris).

## 4. Décompte des exigences

| Classement | Nombre | Exigences |
|---|---|---|
| Obligatoire | 39 | EX-01, 02, 04, 05, 06, 08 à 22, 24 à 30, 34 à 36, 38 à 41, 43 à 47 |
| Recommandé | 10 | EX-03, 07, 31, 32, 37, 42, 49, 50, 51, 52 |
| Confort | 3 | EX-23, 33, 48 |
| **Total** | **52** | |

Précisions :
- Quatre exigences obligatoires ne s'appliquent que dans un cas précis : EX-04 (clients publics), EX-06 (émission en Factur-X), EX-22 (facture déjà payée) et EX-34 (statuts produits par Iris).
- Exigences marquées « non vérifiée » : EX-37 et EX-41 ; EX-46 pour ses durées et son format légal ; EX-47 pour son obligation légale.
- Exigences vérifiées sur les normes, mais non vérifiées pour une autre de leurs sources (texte légal, liste des 34 données, spécification Factur-X ou guide DGFiP) : EX-01, 02, 05, 06, 12, 19, 26, 30, 35, 38, 40, 45, 49 et 50.

## 5. Questions pour le cabinet

Chaque question renvoie à sa source. Elles sont à poser au cabinet comptable ou juridique, et non à trancher par Iris.

- **Q-01 : Facture rejetée par une PA (statut 213).**
  - Est-elle une facture « émise » au sens de l'art. 289 du CGI, dont le numéro est consommé ?
  - Faut-il l'annuler par un avoir interne numéroté (marqué `ARCHIVEONLY`), puis émettre une nouvelle facture sous un **nouveau** numéro ?
  - Les sources vérifiées imposent l'annulation comptable : S3 §2.2 et §2.4 ; S2 BR-FR-20 et BR-FR-CO-02.
  - La formule « réputée non émise » ne vient que de sites secondaires. Le guide DGFiP (S8, non lu) exigerait un nouveau numéro.
- **Q-02 : Fichier « Irrecevable » (501).** Le fichier n'a pas été reconnu comme facture (S3 §2.1). Peut-on le renvoyer corrigé sous le même numéro, ou le numéro est-il consommé ?
- **Q-03 : Refus contesté.**
  - Iris doit-il permettre de maintenir une facture refusée, sans avoir, avec un écart de TVA par rapport au pré-remplissage ?
  - Sinon, faut-il imposer l'avoir interne et une facture identique à une nouvelle date ? (S3 §2.5, NOTE.)
- **Q-04 : Date d'application des quatre nouvelles mentions** (SIREN du client, catégorie, option débits, adresse de livraison) pour une PME qui n'émet électroniquement qu'au 01-09-2027.
  - Légifrance, selon un extrait indexé, indique le 01-09-2026 (S13).
  - BR-FR-14 reporte l'adresse de livraison au 01-09-2027 (S2).
- **Q-05 : Catégorie d'opération des interventions SAV et maintenance** (pièces et main-d'œuvre, contrat forfaitaire, dépannage) et des travaux immobiliers.
  - B, S ou M ?
  - Quelle opération est principale, et laquelle accessoire (CGI art. 257 ter II) ?
  - Sources : S3, cas n°31 ; S2, BR-FR-08.
- **Q-06 : Travaux immobiliers et sous-traitance du BTP.**
  - TVA exigible à l'encaissement, donc statut « Encaissée » à chaque règlement, y compris les acomptes de situation et la libération de la retenue de garantie ?
  - L'option pour les débits est-elle prise ?
  - Autoliquidation par le sous-traitant (catégorie `AE`, mention, cadre S5) ?
  - Sources : S3 §2.1 et cas n°13, 14 et 34 ; S2, BR-FR-08 et BR-FR-15.
- **Q-07 : Acomptes sur livraisons de biens.** Le statut « Encaissée » est-il obligatoire ?
  - S3 §2.1 dit oui (« qu'elles soient de biens ou de services »).
  - S3 §3.2.19 dit que « l'administration ne peut imposer » ces données « en l'état des textes ».
  - Une source secondaire cite une tolérance (BOI-TVA-DECLA-20-30-60 §30, non lu, S18).
- **Q-08 : Montant du statut « Encaissée ».**
  - TTC encaissé (`MEN` : « Montant encaissé (TTC) ») ou « montant net » (règle P1.15) ?
  - Comment traiter l'escompte et les frais bancaires ?
  - Sources : S2, feuille « CDV FE - CDAR » ; S3 §2.1.
- **Q-09 : Catégorie d'entreprise et régime de TVA de la société pilote.** Ils fixent la date d'émission (01-09-2026 ou 01-09-2027) et la périodicité de l'e-reporting. Sources : S14, S17.
- **Q-10 : Périodicité et délais de l'e-reporting par régime.**
  - Fréquence des données de paiement.
  - Délai propre au régime simplifié.
  - Suppression éventuelle du régime simplifié en 2027.
  - Sources : S17 (art. 242 nonies O et P), S18 (BOFiP du 30-09-2026), tous deux non lus.
- **Q-11 : Conservation.**
  - Durée à retenir et point de départ (fin de l'exercice ? date de la facture ?).
  - Qui conserve : la PA ou la société (Iris) ?
  - Format exigé : XML d'origine, PDF/A-3, statuts.
  - Moyen de garantir l'intégrité.
  - Sources : S19, S14 (art. 289).
- **Q-12 : Piste d'audit fiable.** Reste-t-elle à la charge de la société quand les factures passent par une PA ? Ou la transmission structurée par la PA suffit-elle ? (S14, art. 289.)
- **Q-13 : Factur-X BASIC WL.**
  - Est-il admis par l'arrêté du 27-07-2026, qui ne citerait que EN16931 et EXTENDED-CTC-FR ?
  - Jusqu'à quelle date ?
  - Sources : S16, S5, S3 §1.1.
- **Q-14 : Libellés sur le lisible.**
  - Faut-il la mention en clair « Option pour le paiement de la taxe d'après les débits », ou le code BT-8 suffit-il ?
  - Même question pour la catégorie d'opération.
  - Sources : S13 ; S2, BR-FR-MAP-03.
- **Q-15 : Client assujetti absent de l'annuaire.**
  - Comment justifier la bascule en e-reporting B2C ?
  - Quel risque si le client s'inscrit ensuite ?
  - Et pour une facture fournisseur reçue hors du circuit (déduction de la TVA, art. 271) ?
  - Sources : S3 §1.4.3 ; S8, non lu.
- **Q-16 : Changement de PA.** Base légale et contenu du « service minimal » de 12 mois, et contenu de l'art. 242 nonies E quater. Sources : S3 §1.4.5.1 ; S17.
- **Q-17 : Sanctions.**
  - Montants applicables : par facture non électronique, par e-reporting manquant, défaut d'équipement en réception (régime trimestriel annoncé par la loi de finances pour 2026).
  - Portée de la tolérance annoncée pour 2026.
  - Sources : S14 (art. 1737, loi 2026-103), non lues ; les sources secondaires divergent sur les montants.
- **Q-18 : Normes AFNOR.**
  - Obtenir le corps des normes XP Z12-012, 013 et 014, éditions de juin 2026, et vérifier leur gratuité.
  - Respecter l'opposition de l'AFNOR à la fouille de texte par IA.
  - Source : S11.
- **Q-19 : Liste des « 34 données » de 2027.** Confirmer la liste de l'art. 41 septies D de l'annexe IV, dans sa rédaction issue de l'arrêté du 27-07-2026, et sa correspondance avec les données d'Iris. Sources : S16, S20, S9.
