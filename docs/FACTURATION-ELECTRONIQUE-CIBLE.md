# Facturation électronique cible : proposition

> **Proposition du 19-11-2026, lot 0 de la facturation électronique** (audit de conformité, avant tout code), demandée par la décision de Nelson du 19-11-2026 ([historique](HISTORIQUE-DECISIONS.md#décision-du-19-11-2026-sur-la-facturation-électronique)). Établie sur `main` à `1803612`, à partir de trois inventaires du 19-11-2026 (exigences réglementaires, code, documentation), dont elle reprend l'essentiel. L'inventaire des exigences est versé en annexe : [`FACTURATION-ELECTRONIQUE-EXIGENCES.md`](FACTURATION-ELECTRONIQUE-EXIGENCES.md), avec le détail des sources et des extraits lus. Les inventaires du code et de la documentation ne le sont pas : la matrice (section 5) et les sections 6 et 12 en reprennent les constats, relus sur `1803612`.
>
> **Statut : proposition, fusionnée par #620 le 19-11-2026 comme base de travail** (portée de la fusion ci-dessous). Tout ce qu'elle décrit est **prévu**. Rien n'est implémenté, rien n'est validé pour mise en service.
>
> **Portée de sa fusion** (choix par défaut, à confirmer) :
> - fusionner la proposition valide la matrice de conformité (section 5) et le découpage en lots (section 8) comme base de travail ;
> - les questions (sections 7 et 11) restent ouvertes jusqu'à leur réponse ;
> - aucune règle fiscale n'est validée sans le cabinet ;
> - seul Nelson décide de la mise en production.
>
> **Suite du 26-11-2026 (réponses de Nelson à N-01, N-02 et N-09 ; [historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-26-11-2026-facturation-électronique-lot-k)).** Les textes datés ci-dessous ne sont pas réécrits ; cette note et celles des sections 3, 8.4 et 11.1 les complètent. Lectures retenues par Claude Code, à corriger par Nelson si besoin : (1) N-01 : rien de propre à la société pilote n'est écrit en dur ; la catégorie d'entreprise, le régime de TVA et l'option pour les débits sont des **réglages de la société**, renseignés par chaque installation (FE-1), sans valeur par défaut inventée ; N-01 ne bloque plus aucun lot de code ; (2) N-09 répondue en partie : un **type de client** à cinq valeurs (B2B France, B2B UE, B2B hors UE, particulier, entité publique) remplace la case « Pas de SIRET (particulier) » (FE-1) ; (3) N-02 : la PA se choisit et se connecte dans l'écran Connecteurs (FE-4), par un connecteur conforme à XP Z12-013, sans PA en dur. Restent ouverts : le type d'une association à SIREN non assujettie ; la PA de recette et son contrat, avec l'existence d'une PA de réception de la société pilote. Tout reste **prévu**.
>
> **Rôle d'Iris : solution compatible, et non plateforme agréée (PA).** Iris produit, valide, reçoit et suit les factures. La PA de chaque installation les transmet, reçoit celles des fournisseurs et transmet à l'administration ce qui doit l'être. Aucune immatriculation n'est demandée pour Iris.
>
> Ce document ne vaut pas avis juridique ou comptable.

## 1. Le besoin

Nelson, le 19-11-2026 : « Iris doit être entièrement conforme à la facturation électronique : émission, réception, statuts et e-reporting, sans que nous soyons plateforme agréée. Si un choix existant (choix par défaut, simplification, cas ignoré comme le statut Refusée) pose un vrai problème réglementaire, il doit être corrigé. Documente la connexion à une plateforme agréée et tout ce qu'il faut faire au déploiement pour qu'Iris soit prêt à l'emploi. »

Deux principes de son cadrage gouvernent ce document :
- « La conformité réglementaire prime sur tout choix antérieur. Une exigence obligatoire non respectée est une remarque bloquante (R), jamais une issue suivi-audit reportée. »
- « Chaque exigence cite sa source officielle (document, section, version). En cas d'ambiguïté, pose-moi la question : je la porte au cabinet. »

Ce que montre l'audit :
- **Iris émet des PDF, envoyés par courriel.** Il n'a ni format structuré, ni PA, ni statut de cycle de vie, ni réception, ni e-reporting.
- **Plusieurs données obligatoires manquent** : SIREN du client sur la facture, catégorie d'opération, catégorie et motif de TVA, unité, adresse structurée avec code pays, adresses électroniques, option pour les débits.
- **Le PDF d'une facture émise n'est ni figé ni conservé.** Il est recalculé à chaque demande.
- **Le socle est solide** : numérotation continue attribuée à l'émission, facture émise figée en base, correction par avoir, règlements immuables. La cible s'appuie dessus.

## 2. Sources

### 2.1 Registre

« V » : la section citée a été lue lors de l'audit du 19-11-2026. « P » : partiellement vérifiée. « NV » : non vérifiée, document identifié mais texte non lu.

| Id | Document | Version consultée | Vérif. |
|---|---|---|---|
| S1 | Dépôt FNFE-MPE « France_RFE » : schematrons, XSD, annexes des normes ([github.com/fnfempe/France_RFE](https://github.com/fnfempe/France_RFE)) | Étiquette `v1.4.0.04`, commit `97ba0f3` du 05-09-2026, paquet de schematrons 1.4.0.04 | V |
| S2 | XP Z12-012, **annexe A** : formats, profils, règles BR-FR, cycle de vie, motifs, flux 10, flux 11, copie des règles DGFiP 3.2 | V1.4 du 30-06-2026 (`XP_Z12-012_Annexe_A_2026_V1.4_VF.xlsx`, dans S1) | V |
| S3 | XP Z12-014, **annexe A** (normative) : cas d'usage | V1.4 du 30-06-2026, 194 pages (dans S1) | V |
| S4 | XP Z12-013, **annexe A** « AFNOR Flow Service » et **annexe B** « AFNOR Directory Service », OpenAPI 3.0.3 | 1.3.0 (dans S1 ; date absente des fichiers) | V |
| S5 | FNFE-MPE, note explicative « Schematrons en application des règles de gestion de la norme XP Z12-012 » | V1.4.0 du 30-06-2026 (dans S1) | V |
| S6 | Artefacts de validation EN16931 (CEN/TC 434, dépôt ConnectingEurope/eInvoicing-EN16931) | Étiquette `validation-1.3.17`, commit `6e35e0a` du 12-10-2026 ; les schematrons EN16931 joints dans S1 sont en version 1.3.16 ; S5 déclare la version jointe « applicable au 15 mai 2026 » | V |
| S7 | DGFiP, spécifications externes de la facturation électronique | v3.2 du 30-04-2026 ; annexes 2, 6 et 7 lues dans leur reproduction par S2 | NV |
| S8 | DGFiP, « Facturation électronique : guide pratique de démarrage au 1er septembre 2026 » | Juillet 2026 selon une source secondaire | NV |
| S9 | DGFiP, FAQ « J'approfondis la facturation électronique » | V2 du 23-09-2025 repérée | NV |
| S10 | DGFiP, liste des plateformes agréées | Page indiquée modifiée le 29-10-2026 | NV |
| S11 | AFNOR, corps des normes XP Z12-012, XP Z12-013, XP Z12-014 | Éditions de juin 2026 (fiches FA301169, FA301170, FA301171) | NV |
| S12 | Factur-X (FNFE-MPE et FeRD) | 1.09 du 10-06-2026, correctif 1.09.2 (versions confirmées par S5 et S1) | P |
| S13 | CGI, annexe II, art. 242 nonies A (mentions obligatoires) | Version issue du décret 2022-1299, peut-être retouchée par S15 | NV |
| S14 | CGI, art. 289, 289 bis, 290, 290 A, 1737 ; loi n° 2026-103 du 19-02-2026 de finances pour 2026 | Versions en vigueur non lues | NV |
| S15 | Décret n° 2026-677 du 27-07-2026 (NOR CPPE2610307D) | JO du 28-07-2026 ; existence établie par plusieurs sources | NV |
| S16 | Arrêté du 27-07-2026 (NOR CPPE2610309A), art. 41 septies A à P de l'annexe IV | JO du 28-07-2026 ; existence établie | NV |
| S17 | CGI, annexe II, art. 242 nonies E bis à E quater (changement de PA), O et P (e-reporting) | Versions de juillet 2026, non lues | NV |
| S18 | BOFiP : BOI-TVA-DECLA-20-30-50-20, -50-30 et -60 (données de transaction et de paiement) | Versions du 30-09-2026, non lues | NV |
| S19 | LPF art. L102 B ; Code de commerce art. L123-22 ; BOI-CF-COM-10-10-30-10 (conservation) | Non lues | NV |
| S20 | DGFiP, « données de facture à transmettre à l'administration, correspondance des flux » | Non lue | NV |

S2 à S5 sont dans le dépôt S1, dossier `FNFE_RFE_INVOICE/Z.notes_&_docs`. S6 est sur [github.com/ConnectingEurope/eInvoicing-EN16931](https://github.com/ConnectingEurope/eInvoicing-EN16931). Les adresses des textes à lire sont en 2.3.

### 2.2 Limite réseau de l'audit du 19-11-2026

Les sites `www.impots.gouv.fr`, `www.legifrance.gouv.fr`, `www.economie.gouv.fr` et `fnfe-mpe.org` étaient bloqués par la politique réseau de l'environnement de travail de l'audit ; `bofip.impots.gouv.fr`, du même domaine, n'a pas été essayé. Les textes de loi, le guide pratique, la FAQ, la liste des PA et la spécification Factur-X n'ont donc pas été lus.

Le socle technique est vérifié sur les annexes AFNOR V1.4 et l'OpenAPI XP Z12-013 1.3.0 publiées par le FNFE-MPE (S1). Le socle légal (CGI, décret 2026-677, arrêté du 27-07-2026, documents DGFiP) n'est **pas vérifié**.

L'API GitHub n'était pas ouverte, dans cet environnement, pour les dépôts tiers. Les étiquettes de S1 et S6 ont été lues le 19-11-2026 par `git ls-remote` et par un `git fetch --depth 1` de l'étiquette, en lecture seule. Le contenu de S1 (annexes, schematrons, XSD) a été lu dans un clone complet du dépôt, comme le dit l'annexe (« Vérifiée (clone complet) ») : ce sont deux lectures distinctes, l'une des étiquettes (`git ls-remote`, `git fetch --depth 1`), l'autre du contenu (clone complet). Aucune étiquette plus récente que `v1.4.0.04` (S1) et `validation-1.3.17` (S6) n'existe à cette date ; `v1.4.0.04` est la tête du dépôt S1.

### 2.3 Textes à lire dès que l'accès sera ouvert

| Texte | Où le lire | Ce qu'il doit confirmer | Renvois |
|---|---|---|---|
| S16, arrêté du 27-07-2026 | legifrance.gouv.fr, JORFTEXT000054499535 | Art. 41 septies C : formats et profils admis, place de Factur-X et de BASIC WL. Art. 41 septies D : données « Démarrage » et « Cible », liste des « 34 données » | EX-05, EX-19 ; Q-13, Q-19 |
| S15, décret 2026-677 | legifrance.gouv.fr, JORFARTI000054499510 | Texte exact ; articles créés sur le changement de PA | EX-49 ; Q-16 |
| S13, art. 242 nonies A | legifrance.gouv.fr, LEGIARTI000050811276 | Liste des mentions ; date d'application des quatre nouvelles ; libellés | EX-12 ; Q-04, Q-14 |
| S14, CGI 289, 289 bis, 290, 290 A, 1737 ; loi 2026-103 | legifrance.gouv.fr | Calendrier par catégorie, obligation de réception, sanctions | EX-01, EX-35 ; Q-09, Q-17 |
| S17, art. 242 nonies E bis à E quater, O, P | legifrance.gouv.fr | Changement de PA ; périodicité et délais de l'e-reporting ; données de paiement | EX-41, EX-49 ; Q-10, Q-16 |
| S7, spécifications externes DGFiP | impots.gouv.fr, page « spécifications externes B2B » | Version en vigueur (v3.2 ou plus récente) ; annuaire ; statuts transmis | EX-24, EX-43 |
| S8, guide pratique DGFiP | impots.gouv.fr (PDF du guide) | Nouveau numéro après un rejet ; facture reçue hors circuit ; client absent de l'annuaire | EX-26, EX-37, EX-45 ; Q-01, Q-15 |
| S9 et S20, FAQ et correspondance des flux | impots.gouv.fr | « 26 puis 34 données », date d'application de chaque donnée | EX-19 ; Q-19 |
| S10, liste des PA | impots.gouv.fr, page des plateformes agréées | Inscription de la PA candidate | FE-DOC |
| S12, Factur-X 1.09.2 | fnfe-mpe.org | Profils ; exigences PDF/A-3 (polices incorporées, métadonnées) | EX-06 |
| S18, BOFiP DECLA-20-30-50 et -60 | bofip.impots.gouv.fr | Données de paiement ; acomptes de biens ; périodicité | EX-30, EX-40, EX-41 ; Q-07, Q-10 |
| BOI-TVA-DECLA-30-20-20-10 (cité par S2, règle G1.05) | bofip.impots.gouv.fr | Séries de numérotation admises | EX-09 ; Q-20 |
| S19, conservation | legifrance.gouv.fr, bofip.impots.gouv.fr | Durées, point de départ, format, intégrité | EX-46, EX-47 ; Q-11, Q-12 |
| S11, corps des normes AFNOR | boutique.afnor.org | Règles communes de l'API, codes d'erreur ; gratuité ; opposition à la fouille de texte | EX-50 ; Q-18 |

## 3. Calendrier et conséquences pour la société pilote

| Date | Ce qui s'applique | Source | Vérif. |
|---|---|---|---|
| 01-09-2026 | **Réception** obligatoire par une PA pour tous les assujettis établis en France | S14, S8 ; S3 §1.4.2 | NV pour le texte légal ; cohérent avec S3 |
| 01-09-2026 | **Émission** et e-reporting pour les grandes entreprises (GE) et les ETI | S14, S8 | NV |
| 01-09-2026 | Données de flux 1 de la trajectoire « Démarrage » | S2, « Règles de gestion 3.2 », G6.11 | V |
| 01-09-2026 | Schematrons « FATAL » appliqués par les PA en émission ; en réception au plus tard le 01-10-2026 | S5, chapitre « Application » | V |
| 01-09-2027 | **Émission** et e-reporting pour les PME et les micro-entreprises | S14, S8 | NV |
| 01-09-2027 | Données de la trajectoire « Cible » ; adresse de livraison | S2, G6.12 et BR-FR-14 | V |
| 2026 | Aucune sanction annoncée pour 2026, sans suspension de l'obligation | Sources secondaires | NV |

**Conséquences pour la société pilote.**
- **Activité (réponse du 20-11-2026, citée dans l'[historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-20-11-2026-sur-la-facturation-électronique)).** Lecture retenue, à corriger par Nelson si besoin : l'activité de la société pilote est la sûreté électronique et la revente d'accès internet et télécom. Elle vend des biens (matériel) et des services (installation, maintenance, abonnements) : la catégorie d'opération de ses factures sera donc souvent mixte (M), à confirmer par le cabinet avec Q-05. Ses ventes à des particuliers, abonnements compris, relèvent de l'e-reporting (EX-38, flux 10), sous réserve du texte légal non lu.
- **Sa catégorie d'entreprise et son régime de TVA restent inconnus.** Ils fixent sa date d'émission et la périodicité de son e-reporting. C'est une question (N-01, ouverte pour ces faits ; Q-09 pour le cabinet). Restent aussi ouverts son option pour les débits et l'existence d'une PA de réception.
- **Point d'attention pour Nelson : la réception.** Depuis le 01-09-2026, tout assujetti doit pouvoir recevoir ses factures par une PA. Le texte légal n'est pas vérifié, mais c'est cohérent avec S3 §1.4.2. La société pilote a donc besoin d'une PA de réception **dès maintenant, qu'elle utilise Iris ou non**. Iris ne la remplace pas : il récupérera ses factures par l'API de cette PA (lot FE-9).
- **Si elle est une GE ou une ETI**, l'émission et l'e-reporting sont déjà obligatoires (non vérifié). Iris ne peut pas transmettre ses factures B2B avant le lot FE-5 : elle devrait émettre par sa PA en attendant.
- **Si elle est une PME ou une micro-entreprise**, l'émission commence le 01-09-2027 (non vérifié).
- **Recette.** Nelson demande « une recette sur le bac à sable d'une PA avant le 01-06-2027 ». Elle suppose une PA choisie et un accès à son bac à sable (section 8.4). Réponse du 20-11-2026 : aucune PA n'est encore choisie (N-02).
- **Note du 26-11-2026 (réponses de Nelson, [historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-26-11-2026-facturation-électronique-lot-k)).** Les puces « Sa catégorie d'entreprise et son régime de TVA restent inconnus » et « Recette », ci-dessus, restent exactes comme calendrier. Lecture retenue, à corriger par Nelson si besoin : ces faits servent au calendrier (date d'émission obligatoire pour la société pilote) et à la recette, non au code ; ils deviennent des réglages de la société, renseignés par chaque installation (FE-1), sans valeur par défaut inventée, et se saisiront à la configuration de la société pilote ; N-01 ne bloque plus aucun lot de code.

## 4. Architecture cible

### 4.1 Principes

1. **Iris reste la source de vérité.** La PA est un connecteur ([intégrations](INTEGRATIONS-M365-COMPTABILITE-FACTURATION-FR.md)).
2. **Un modèle canonique EN16931**, construit depuis les données figées de la facture. Il ne dépend ni du PDF ni de la PA.
3. **Validation complète avant le numéro.** Données obligatoires et schematrons sont contrôlés avant l'attribution du numéro et le figement.
4. **Une pièce transmise est produite une fois**, conservée avec son empreinte, jamais recalculée.
5. **Le journal des statuts est en ajout seul**, horodaté par la base, avec la preuve de la PA.
6. **Règle permanente 1.** Une règle légale reste dans le code avec sa source. Ce qui varie d'une société à l'autre devient un paramètre, sans valeur métier inventée.
7. **Rien ne change sans réglage.** Tant que le connecteur de PA n'est pas activé, Iris se comporte comme aujourd'hui. Le comportement après la date d'obligation est une question (N-14).

### 4.2 Schéma

```text
Brouillon de facture, ou demande d'avoir
  │ 1. Contrôle des données obligatoires                                   (FE-2)
  ▼
Modèle canonique EN16931, numéro candidat pris dans la transaction d'émission
  │ 2. Sorties : Factur-X EN16931 (PDF/A-3 + CII), CII D22B, UBL 2.1       (FE-3)
  │ 3. Validation : XSD, schematron EN16931, schematron BR-FR               (FE-3)
  │    échec → refus, transaction annulée, aucun numéro consommé
  ▼
Pièce émise et figée : données, fichier transmis, empreinte SHA-256        (FE-5)
  │ 4. Dépôt par l'adaptateur ElectronicInvoicingProvider (XP Z12-013)     (FE-4)
  ▼
PA de la société ──► PA du client ──► client
  │           └──► concentrateur du PPF : flux 1, statuts obligatoires, e-reporting
  │ 5. Statuts : interrogation périodique, ou webhook signé
  ▼
Journal des statuts, ajout seul, avec la preuve de la PA                   (FE-5)
  ├─ Rejetée ou Refusée → alerte avec motif → correction                    (FE-6)
  ├─ Règlements → Encaissée                                                 (FE-7)
  └─ Ventes B2C et B2B international, paiements → e-reporting               (FE-8)

PA de la société ──► factures fournisseurs ──► boîte de réception Iris     (FE-9)
                                                └─ statuts acheteur → PA
Annuaire (Directory Service) ◄── vérification du client avant le dépôt     (FE-4)
Conservation des fichiers émis et reçus, statuts et preuves                (FE-10)
```

### 4.3 Composants

- **Modèle canonique.** Un type TypeScript qui reprend les groupes et données de l'EN16931 (BG, BT), produit par une fonction pure depuis la facture figée. Les sorties ne lisent que lui.
- **Sorties.** Factur-X profil EN16931, UBL 2.1 et CII D22B. EXTENDED-CTC-FR « seulement si un cas d'usage l'exige » (cadrage). Le format transmis à la PA est un réglage du connecteur, Factur-X par défaut (choix par défaut, à confirmer), car il porte la représentation lisible.
- **Validation.** XSD, schematron EN16931 (S6) et schematron BR-FR (S1), dans la transaction d'émission. Un échec annule la transaction : aucun numéro n'est consommé, comme pour les refus actuels (`server/src/domaines/factures/routes.ts:396-404`). Où tournent les validateurs hors CI est une question (N-15).
- **Adaptateur `ElectronicInvoicingProvider`.** Une interface, une implémentation sur l'API XP Z12-013 1.3.0 (Flow Service et Directory Service, S4). Une PA par installation, activée par le `SUPERADMIN` dans l'écran Connecteurs. Secrets en variables d'environnement. Un adaptateur propriétaire « seulement si la PA retenue n'implémente pas la norme, et sur ma décision » (Nelson).
- **Journal des statuts.** Une ligne par statut reçu ou émis : code, libellé, émetteur, date, motif, action attendue, identifiant du flux, preuve de la PA. Distinct du statut propre à Iris (`BROUILLON`, `EMISE`, `REGLEE`, `ANNULEE`). Un code inconnu est gardé sans erreur (EX-24).
- **Réception.** Récupération des factures fournisseurs par l'API de la PA, dédoublonnage, conservation de l'original et du lisible, rattachement au fournisseur par SIREN, statuts acheteur (section 10).
- **E-reporting.** Transactions B2C et B2B internationales, paiements, à la périodicité du régime de TVA de la société, déposés par la PA.
- **Annuaire.** Vérification du SIREN et de l'adresse électronique du client avant le dépôt, résultat conservé comme preuve.
- **Conservation.** Fichiers émis et reçus, statuts et preuves, en ajout seul, avec empreinte. Durée et lieu selon Q-11 et N-16.
- **Contrôle de compatibilité.** Une commande `npm run efacture:verifier` et un bouton « Tester la connexion ». Sur le bac à sable de la PA, ils vérifient : l'authentification, l'annuaire, le dépôt jusqu'au statut Déposée, la réception d'une facture test, l'envoi de statuts et un e-reporting test. Le rapport dit « conforme » ou liste précisément les manques.

### 4.4 Code ou paramètre

| Règle | Où | Raison |
|---|---|---|
| Listes officielles : statuts, motifs, actions attendues, types BT-3, catégories et taux de TVA admis, codes d'exonération | Code, avec la version de S2 citée | Règle légale ou normative |
| Format et unicité du numéro (BR-FR-01, 02, CO-02) ; date non future | Code | Règle légale ; continuité et chronologie restent dans le code |
| Versions des artefacts de validation (S1, S6) | Code et CI | Règle normative, suivie à chaque version |
| Identité fiscale de la société, option pour les débits, catégorie, date d'obligation, régime de TVA, IBAN | Paramètres, sans valeur par défaut | Propres à la société |
| Activation du connecteur, format transmis | Paramètres du `SUPERADMIN`, journalisés | Propres à l'installation |
| Qui transmet, statue, approuve ou refuse | Droits ([droits cible](MODELE-DROITS-CIBLE.md)) | « Qui fait quoi » relève des droits |
| Durée de conservation | Selon Q-11 : règle légale ou paramètre | À trancher par le cabinet |

## 5. Matrice de conformité

**Lecture.**
- Une ligne par exigence, EX-01 à EX-52, dans la numérotation de l'[inventaire réglementaire](FACTURATION-ELECTRONIQUE-EXIGENCES.md), où chacune est détaillée avec ses extraits. L'énoncé y est condensé.
- **Source** : identifiant du registre (section 2.1), qui donne le document et la version, puis la section ou la règle.
- **Vérif.** : V, P ou NV (section 2.1).
- **État actuel** : chemins relatifs à `server/src/domaines/`, sauf `schema.prisma` (`server/prisma/schema.prisma`), `commun/…` (`server/src/commun/…`) et `mig <dossier>` (`server/prisma/migrations/<dossier>/migration.sql`). Lignes relues sur `1803612`. Les références `schema.prisma:…` sont à relire au cadrage de chaque lot : le fichier a changé depuis sur `main` : 2 lignes ajoutées après la ligne 252 par #617 (#582), puis 2 après la ligne 1031 et 2 après la ligne 1063 par #628 (#615), soit, en numérotation de `1803612`, un décalage de 2 à 6 lignes sur `0266db1` (22-11-2026), sans que ces références soient recalées ici (remarque de l'audit des montants de #620, [#622](https://github.com/OrizonLab/iris/issues/622)).
- **Test existant** : dans `server/tests/` (`.mjs`) ou `client/tests/e2e/` (`.spec.ts`). Il prouve l'état actuel, pas la conformité.
- **Écart** : total, partiel, aucun ou sans objet.
- **Classement** : Obl. (obligatoire), Rec. (recommandé), Conf. (confort). Une exigence obligatoire non respectée par le lot qui la couvre est une remarque R de son audit.

### 5.1 A. Rôle d'Iris et périmètre

| EX | Exigence | Source | Vérif. | État actuel dans Iris | Test existant | Écart | Classement | Lot |
|---|---|---|---|---|---|---|---|---|
| EX-01 | Factures B2B domestiques et données réglementaires échangées par la PA seule | S3 §1.1 ; S14 art. 289 bis ; S16 | P | Courriel seul : Microsoft 365 (`documents/microsoftGraph.ts:117-130`) ou messagerie (`documents/envois.ts:10-15`) | `envoi-microsoft-365.test.mjs`, `envoi-documents.spec.ts` | Total | Obl. | FE-4, FE-5, FE-9 |
| EX-02 | Circuit selon le type de client : B2B France, B2B international, B2C, B2G, hors champ | S3 §1.1, §1.4.3 ; S2 « E-REPORTING - Flux 10 » ; S14 | P | Professionnel ou particulier seulement (`Client.sansSiret`, `schema.prisma:516`) | `api.test.mjs:17762` | Partiel | Obl. | FE-1, FE-5, FE-8 |
| EX-03 | Traitement attendu : note `BAR` (BT-22) ou `processingRule` ; `ARCHIVEONLY` pour un avoir interne | S2 BR-FR-20, BR-FR-31 ; S4 `ProcessingRule` | V | Absent | aucun | Total | Rec. | FE-5, FE-6 |
| EX-04 | Secteur public : Chorus Pro ou PA ; règles BR-FR-CPRO | S3 §1.1, §2.5 ; S2 « BR-France-CTC-CPRO » | V | Absent ; aucun document ne parle de Chorus Pro | aucun | Total, si clients publics | Obl. (cas précis) | FE-11, selon N-10 |

### 5.2 B. Émission : formats, profils, validation

| EX | Exigence | Source | Vérif. | État actuel dans Iris | Test existant | Écart | Classement | Lot |
|---|---|---|---|---|---|---|---|---|
| EX-05 | UBL 2.1, CII D22B ou Factur-X ; profil EN16931 ou EXTENDED-CTC-FR ; un PDF seul n'est pas une facture électronique | S16 art. 1 ; S3 §1.1 ; S5 §1, §2.1 | P | PDF seul, par `pdfkit` (`documents/gabarit.ts:1`) ; aucune bibliothèque XML | `production-pdf.test.mjs` | Total | Obl. | FE-3 |
| EX-06 | Factur-X 1.09 et correctif 1.09.2, XSD du profil | S5 §1 ; S1 (1.4.0.03) ; S12 | P | Absent ; polices non incorporées, texte ramené à WinAnsi (`documents/gabarit.ts:66-82`) | aucun | Total | Obl. | FE-3 |
| EX-07 | Pré-validation avec les artefacts officiels : XSD, EN16931, BR-FR en mode FATAL | S3 §2.1, §2.2, §2.4 ; S5 « Application » ; S6 | V | Avant le numéro : origine non annulée, chronologie, mentions, identités et écritures (`factures/routes.ts:390-403`), sans aucun contrôle de format | aucun | Total | Rec. (fort) | FE-3 |
| EX-08 | Lisible complet, un seul `LISIBLE`, 100 Mo au plus | S2 BR-FR-17 à 19 ; S5 ; S4 `FlowPostRequest` | V | PDF incomplet (`factures/pdf.ts:54-109`) et recalculé à chaque demande (`factures/pdf.ts:47-53, 96-101`) | `production-pdf.test.mjs` | Total | Obl. | FE-3, FE-5 |

### 5.3 C. Émission : données de la facture

| EX | Exigence | Source | Vérif. | État actuel dans Iris | Test existant | Écart | Classement | Lot |
|---|---|---|---|---|---|---|---|---|
| EX-09 | Numéro de 35 caractères au plus, en `A-Z a-z 0-9 - + _ /` ; unique par numéro, année et SIREN ; date non future ; année de 2000 à 2099 | S2 BR-FR-01 à 03, CO-01, CO-02 ; G1.05, G1.07 | V | `<préfixe><année>-<NNNN>`, préfixe ramené à `A-Z0-9-` (`factures/routes.ts:404-407`) mais de longueur libre (`administration/metier.ts:16`) ; index unique (`mig 20260908160000_add_factures:45`) ; date non future au brouillon (`factures/routes.ts:212`) ; préfixes de facture et d'avoir identiques admis | `api.test.mjs:13496`, `:12723`, `:29587` | Partiel | Obl. | FE-1, FE-3 |
| EX-10 | Types BT-3 admis : 380, 381, 384, 386, 503… | S2 BR-FR-04, G1.01 | V | `FACTURE` ou `AVOIR` (`schema.prisma:723`) | aucun | Partiel | Obl. | FE-2 ; 386 et 503 avec FE-12 |
| EX-11 | Cadre BT-23 obligatoire ; premier caractère = catégorie B, S ou M | S2 BR-FR-08 (V1.4), G1.02 ; S3 cas n°31 | V | Nature par ligne, `PRESTATION` ou `ARTICLE` (`schema.prisma:915`), pour la comptabilité ; rien au niveau de la facture | aucun | Total | Obl. | FE-2 (Q-05) |
| EX-12 | Mentions de l'art. 242 nonies A, dont SIREN du client, catégorie, option débits, adresse de livraison | S13 ; S2 BR-FR-11, 08, MAP-03, 14, CO-17 | P | SIREN du client exigé pour émettre (`documents/identiteClient.ts:28`), ni copié ni imprimé ; trois mentions absentes ; mentions en texte libre (`schema.prisma:938-949`) | `api.test.mjs:17585` (bloc « Lot 6a-2 bis »), `identite-client.spec.ts` | Partiel | Obl. | FE-1, FE-2, FE-3 (Q-04, Q-14) |
| EX-13 | SIREN du vendeur et de l'acheteur actifs dans l'annuaire ; SIREN 9 chiffres, SIRET 14 chiffres cohérent | S2 BR-FR-09 à 11, 32, CO-10, CO-11 | V | Société : SIRET seul, sans contrôle (`schema.prisma:481` ; `administration/metier.ts:5-20`). Client : SIREN de 9 chiffres (`clients/metier.ts:35`), aucun SIRET | `api.test.mjs:17585` (SIREN exigé), `:17729` | Partiel | Obl. | FE-1, FE-4 |
| EX-14 | Adresse électronique de l'acheteur (BT-49, schéma `0225`) et du vendeur (BT-34) | S2 BR-FR-12, 13, 21 à 25 ; S3 §1.4.2 | V | Absentes ; `Client.email` (`schema.prisma:519`) est une boîte de courriel | aucun | Total | Obl. | FE-1, FE-4 |
| EX-15 | Option pour les débits : BT-8 sur les factures de services | S2 BR-FR-MAP-03, MAP-29 ; G1.43, P1.11 | V | Ni champ ni paramètre | aucun | Total | Obl. (si option) | FE-1, FE-2 |
| EX-16 | Adresse de livraison (BG-15) si elle diffère, au 01-09-2027 | S2 BR-FR-14 ; G6.12 | V | Absente de la facture ; les sites d'intervention existent (`schema.prisma:1325`) | aucun | Total | Obl. | FE-2 (Q-04, Q-24) |
| EX-17 | Notes `PMT`, `PMD`, `AAB`, une fois chacune ; date de livraison ou période | S2 BR-FR-05 à 07, CO-17 ; G1.38, G1.39 | V | Pénalités obligatoires et escompte facultatif, en texte libre (`schema.prisma:938-949` ; `factures/pdf.ts:106-107`) ; ni indemnité forfaitaire, ni date de livraison | aucun | Partiel | Obl. | FE-2 (Q-23) |
| EX-18 | TVA : catégories BR-FR-15, taux BR-FR-16, motif hors `S` et `Z`, décimales, devise | S2 BR-FR-15, 16, CO-12, CO-16, DEC-01 à 04 | V | Taux 0, 5,5, 10, 20 % (`commun/tva.ts:8`), tous admis ; 0 % sans catégorie ni motif (`commun/tva.ts:1-7`) ; décimales compatibles (`schema.prisma:916-918`) ; euro implicite | `tva-francaise.spec.ts` ; `api.test.mjs` | Partiel | Obl. | FE-2 (Q-06, Q-22) |
| EX-19 | Socle EN16931 et règles françaises ; données « Démarrage » puis « Cible » ; « 26 puis 34 données » | S2 « FE EN16931 + EXTENDED », G6.11, G6.12 ; S9, S16, S20 | P | Manquent notamment l'unité (`FactureLigne`, `schema.prisma:909-923`), les pays codés (BT-40, BT-55), l'adresse structurée (`schema.prisma:720`) | aucun | Partiel | Obl. | FE-1, FE-2 (Q-19) |
| EX-20 | Facture d'acompte 386, avoir d'acompte 503, facture définitive de cadre 4 | S3 cas n°20, 21 (§3.2.19) ; S2 BR-FR-04, CO-06 à 08 | V | Acompte constaté sur le devis, sans facture (`schema.prisma:561-566`), exigé par défaut à 40 % (décisions du 17-11-2026) ; la facture définitive ne le déduit pas | aucun | Total | Obl. | FE-12, selon Q-21 (place : N-12) |
| EX-21 | Avoir qui référence sa facture (BT-25, BT-26) ; rectificative 384 | S2 BR-FR-CO-03 à 05 ; S3 §1.3, §2.6, §2.7 | V | Avoir lié à sa facture (`schema.prisma:726`), référence imprimée (`factures/pdf.ts:66`) ; pas de rectificative | `api.test.mjs:12847`, `avoir-partiel-decimal.test.mjs` | Partiel | Obl. | FE-2, FE-6 |
| EX-22 | Facture déjà payée : cadre 2, BT-113 = BT-112 | S2 BR-FR-CO-07, CO-09 ; S3 cas n°2 | V | Aucun règlement ne précède l'émission (`reglements/routes.ts:91`), mais l'acompte constaté sur le devis, d'un montant libre (`devis/routes.ts:578`), est un paiement reçu avant la facture, qui ne le déduit pas (aucun BT-113) | aucun | Total, si un acompte est constaté | Obl. (cas précis) | FE-12 (Q-21) |
| EX-23 | Sous-traitance et cotraitance : cadres S5, S6 ; statut 224 | S2 BR-FR-08 ; S3 cas n°13, 14 | V | Absent | aucun | Total | Conf. | sans lot (Q-06) |

### 5.4 D. Cycle de vie

| EX | Exigence | Source | Vérif. | État actuel dans Iris | Test existant | Écart | Classement | Lot |
|---|---|---|---|---|---|---|---|---|
| EX-24 | Tous les statuts (200 à 228, 500, 501), avec code, émetteur, date, motif ; code inconnu accepté | S2 « Acteurs CDV », BR-FR-CDV-CL-05, CL-06 ; S3 §2.1 | V | Statuts propres à Iris seulement (`mig 20261018120000_factures_emises_figees:71`) | aucun | Total | Obl. | FE-5, FE-9 |
| EX-25 | Statuts obligatoires : Déposée 200, Rejetée 213, Refusée 210, Encaissée 212 ; Rejetée et Refusée définitifs | S3 §2.1, §2.5 ; S2 G7.44 | V | Absents ; « Refusée » omis par la [documentation d'intégration](INTEGRATIONS-M365-COMPTABILITE-FACTURATION-FR.md) jusqu'à cette PR | aucun | Total | Obl. | FE-5, FE-7, FE-9 |
| EX-26 | Rejet et refus : annulation comptable par avoir interne ; nouvelle facture sous un nouveau numéro | S3 §2.2, §2.4, §2.5 ; S2 BR-FR-CO-02, BR-FR-20 ; S8 | P | Aucun traitement ; avoir total seulement sans règlement, sans avoir partiel et hors 0,00 € (`factures/routes.ts:449-458`) | aucun | Total ; conflits (section 7) | Obl. | FE-6 (N-03 à N-07) |
| EX-27 | Motif obligatoire pour six statuts, pris dans la liste du statut ; actions attendues | S2 « Tableau des motifs de STATUTS », « Codes Action », BR-FR-CDV-15, CL-09 | V | Absent | aucun | Total | Obl. | FE-5, FE-9 |
| EX-28 | Refus réservé à trois cas ; sinon « En litige » | S3 §2.3, §2.5 | V | Absent | aucun | Total | Obl. | FE-9 |
| EX-29 | Irrecevable 501, erreur de routage 221, Déposée `NON_TRANSMISE` | S3 §1.4.4, §2.1, §2.3 | V | Absent | aucun | Total | Obl. | FE-5, FE-6 (Q-02) |
| EX-30 | « Encaissée » à chaque encaissement si la TVA est due à l'encaissement ; un bloc par taux ; négatif pour annuler | S3 §2.1, §2.6, §3.2.19, cas n°34 ; S2 « CDV FE - CDAR », G7.45, P1.15 à 18, BR-FR-CDV-14 ; S17 | P | Règlements manuels : date, montant, moyen (`schema.prisma:795-798`) ; contre-passation (`reglements/routes.ts:131-163`) ; « réglée » possible par avoirs seuls (`reglements/metier.ts:64`) | `detail-avoirs-reglements.test.mjs`, `statut-facture-avoirs.test.mjs` | Total | Obl. | FE-7 (Q-06 à Q-08) |
| EX-31 | Recevoir « Paiement transmis » (211) | S3 §2.1 | V | Absent | aucun | Total | Rec. | FE-7 |
| EX-32 | Statuts facultatifs : les recevoir (ventes), les poser (achats) | S3 §2.1, §2.6, §2.7 ; S2 BR-FR-CDV-CL-11 | V | Absent | aucun | Total | Rec. | FE-5, FE-9 |
| EX-33 | Statuts 224 à 228 : affacturage, paiement direct | S3 §3.2.1.3 ; S2 « Acteurs CDV » | V | Absent | aucun | Total | Conf. | sans lot |
| EX-34 | Message CDAR produit par Iris : syntaxe D22B, schematron BR-FR-CDV | S2 « CDV FE - CDAR » ; S5 §1 ; S1 | V | Absent | aucun | Total, si Iris produit le CDAR | Obl. (cas précis) | FE-5, FE-7, FE-9, selon la PA (N-02) |

### 5.5 E. Réception

| EX | Exigence | Source | Vérif. | État actuel dans Iris | Test existant | Écart | Classement | Lot |
|---|---|---|---|---|---|---|---|---|
| EX-35 | Recevoir par une PA inscrite à l'annuaire, adresse `0225` | S3 §1.4.2, §1.4.4 ; S14 | P | Aucune réception ; achats saisis comme coûts hors taxe (`AchatReel`, `schema.prisma:198-230`) | aucun | Total | Obl. | FE-9 ; PA de la société (FE-DOC) |
| EX-36 | Traiter UBL, CII, Factur-X ; EN16931, EXTENDED-CTC-FR, BASIC WL | S3 cas n°1 ; S5 ; S4 `GET /v1/flows/{flowId}` | V | Absent | aucun | Total | Obl. | FE-9 |
| EX-37 | Facture reçue hors circuit : garder la trace | S8 | NV | Absent | aucun | Total | Rec. | FE-9 (Q-15) |

### 5.6 F. E-reporting

| EX | Exigence | Source | Vérif. | État actuel dans Iris | Test existant | Écart | Classement | Lot |
|---|---|---|---|---|---|---|---|---|
| EX-38 | Transactions B2C et B2B internationales ; paiements des services à TVA sur encaissements | S2 « Flux 10 » ; S4 `FlowType` ; S3 cas n°30, 43, §1.4.3 ; S14 | P | Absent ; Iris facture des particuliers (décision du 23-10-2026) | aucun | Total | Obl. | FE-8 |
| EX-39 | Données de transaction 10.1 et 10.3 ; en-tête de transmission | S2 « Flux 10 », G1.68, G8.01, G8.02, G8.05 ; S1 `Flux10/` | V | Absent | aucun | Total | Obl. | FE-8 |
| EX-40 | Données de paiement 10.2 et 10.4 | S2 « Flux 10 » ; S3 cas n°31 ; S17, S18 | P | Absent ; règlements disponibles (`schema.prisma:795-798`) | aucun | Total | Obl. | FE-7, FE-8 |
| EX-41 | Périodicité et délai selon le régime de TVA | S17, S18 ; S3 §3.2.42.1 | NV | Aucun paramètre de régime | aucun | Total | Obl. | FE-1, FE-8 (Q-10) |
| EX-42 | Rattrapages ; encaissements non lettrés | S3 §3.2.42.1, cas n°34 | V | Absent | aucun | Total | Rec. | FE-8 |

### 5.7 G. Annuaire

| EX | Exigence | Source | Vérif. | État actuel dans Iris | Test existant | Écart | Classement | Lot |
|---|---|---|---|---|---|---|---|---|
| EX-43 | Consulter l'annuaire ; une adresse `0225` n'a qu'une PA de réception | S3 §1.4.1 à §1.4.5 ; S2 « Flux F11 » ; S4 Directory 1.3.0 | V | Absent | aucun | Total | Obl. | FE-4, FE-5 |
| EX-44 | Adresses de réception de la société inscrites par sa PA | S3 §1.4.2, §1.4.5 | V | Hors Iris ; Iris ne connaît pas ces adresses | aucun | Total | Obl. | FE-1 ; société (FE-DOC) |
| EX-45 | Client assujetti absent de l'annuaire : bascule en e-reporting B2C | S3 §1.4.3 ; S8 | P | Absent | aucun | Total | Obl. | FE-4, FE-8 (Q-15) |

### 5.8 H. Conservation

| EX | Exigence | Source | Vérif. | État actuel dans Iris | Test existant | Écart | Classement | Lot |
|---|---|---|---|---|---|---|---|---|
| EX-46 | Conservation de 6 ou 10 ans dans le format d'origine ; statuts Rejetée et Refusée conservés | S19, S14 ; S3 §2.4, §2.5 ; S4 | NV (durées) | Aucun fichier conservé ; seule l'empreinte d'un envoi Microsoft 365 (`mig 20261101120000_envoi_microsoft_365:30-32`) ; le PDF change après l'émission (`factures/pdf.ts:47-53`) | `envoi-microsoft-365.test.mjs` | Total | Obl. | FE-5, FE-9, FE-10 (Q-11) |
| EX-47 | Intégrité, authenticité, lisibilité jusqu'à la fin de la conservation ; empreinte `sha256` | S14 ; S4 Flow 1.0.2 | NV (obligation) | Données figées en base (`mig 20261018120000_factures_emises_figees:13-39` ; `mig 20261016120000_reglements:186-206`) ; fichier non conservé | `api.test.mjs:11955` | Partiel | Obl. | FE-5, FE-10 (Q-12) |

### 5.9 I. Une ou plusieurs PA

| EX | Exigence | Source | Vérif. | État actuel dans Iris | Test existant | Écart | Classement | Lot |
|---|---|---|---|---|---|---|---|---|
| EX-48 | Plusieurs PA possibles, une seule par adresse | S3 §1.4.2, §1.4.5.2 | V | Une PA par installation (cadrage du 19-11-2026) | aucun | Aucun | Conf. | — |
| EX-49 | Changement de PA : garder la PA et l'adresse de chaque transmission ; accepter les statuts d'une autre PA | S17 ; S3 §1.4.5.1, §1.4.5.2 | P | Absent | aucun | Total | Rec. | FE-4, FE-5 ; FE-DOC (Q-16) |

### 5.10 J. API XP Z12-013

| EX | Exigence | Source | Vérif. | État actuel dans Iris | Test existant | Écart | Classement | Lot |
|---|---|---|---|---|---|---|---|---|
| EX-50 | Flow Service 1.3.0 : dépôt, recherche, téléchargement, webhooks ; `trackingId`, `sha256` | S4 annexe A 1.3.0 ; S16 | P | Absent | aucun | Total | Rec. | FE-4 |
| EX-51 | Directory Service 1.3.0 | S4 annexe B 1.3.0 | V | Absent | aucun | Total | Rec. | FE-4 |
| EX-52 | OAuth2 ou jeton, `Organization-Id`, `Request-Id` ; signature des webhooks facultative | S4 `securitySchemes`, `WebhookCallback` | V | Absent | aucun | Total | Rec. | FE-4 |

### 5.11 Décompte

| Classement | Exigences | Écart total | Partiel | Aucun ou sans objet |
|---|---|---|---|---|
| Obligatoire | 39 | 29 (dont EX-04, EX-22 et EX-34, selon le cas) | 10 : EX-02, 09, 10, 12, 13, 17, 18, 19, 21, 47 | 0 |
| Recommandé | 10 | 10 | 0 | 0 |
| Confort | 3 | 2 : EX-23, 33 | 0 | 1 : EX-48 |
| **Total** | **52** | **41** | **10** | **1** |

Exigences non vérifiées (NV) : EX-37 et EX-41 ; EX-46 pour ses durées ; EX-47 pour son obligation. Exigences partiellement vérifiées (P), dont une source, le plus souvent le texte légal, n'a pas été lue : EX-01, 02, 05, 06, 12, 19, 26, 30, 35, 38, 40, 45, 49 et 50.

## 6. Choix existants qui posent un problème réglementaire

Ces choix par défaut, simplifications ou cas ignorés heurtent une exigence obligatoire. Selon le cadrage de Nelson, chacun sera corrigé par le lot indiqué ; un lot qui le laisse en l'état reçoit une remarque R.

| # | Choix actuel | Constat | Source | Correction |
|---|---|---|---|---|
| 1 | Statuts de la cible : « déposée, transmise, reçue, rejetée, encaissée » | « Refusée » manque ; « transmise » n'est pas un libellé officiel (le statut 201 est « Emise par la plateforme ») ; « reçue » est le statut facultatif 202, « Reçue de la plateforme » (S2), « Reçue » dans S3 §2.1 | EX-24, EX-25 (S3 §2.1 ; S2 « Acteurs CDV ») | Cette PR (documentation d'intégration) ; FE-5 |
| 2 | Courriel comme seul canal des factures, B2B compris (lot 6) | Une facture B2B domestique part par la PA ; « Dès la date d'obligation de la société, l'e-mail n'est plus qu'une copie d'information » (Nelson) | EX-01 (S3 §1.1) | FE-5 (N-14) |
| 3 | PDF d'une facture émise recalculé : mention de statut, bloc « Règlements et avoirs » (#534) ; aucun fichier conservé | La pièce transmise doit rester celle de l'émission et être conservée dans son format | EX-08, EX-46, EX-47 | FE-5 ; affichage de la situation : N-08 |
| 4 | Facture « réglée » par ses seuls avoirs (#524, `reglements/metier.ts:64`), selon la réponse de Nelson du 09-11-2026, lecture retenue ([historique](HISTORIQUE-DECISIONS.md#décisions-du-09-11-2026-sur-at-4)) : « La facture n’est pas annulé si payer par sob avoir, soit elle est regle entierement dans ce cas la facture est regler ou si seul une partie est couverte pas un ou plusieurs avoir, elle sera partiellement reglé. » | Le statut Iris « réglée » n'est pas un statut de la réforme. Le problème serait d'en déduire le statut 212 « Encaissée » : un avoir n'est pas un encaissement et ne crée, à lui seul, aucun montant encaissé. Après un avoir partiel, S3 §2.6 recommande « Encaissée » sur la facture pour sa totalité et sur l'avoir en négatif (« Fortement Recommandé »), et admet un « Encaissée » partiel de la facture seule : la forme est une question (N-17, Q-08) | EX-30, EX-40 | FE-7 : « Encaissée » posé à chaque règlement, jamais déduit du statut Iris, qui ne change pas ; montant et forme après un avoir partiel selon N-17 et Q-08 ; tout autre changement serait une question à Nelson |
| 5 | 0 % sans catégorie, sans motif, sans mention (décision du 29-10-2026, « Pas de mention pour l'instant (Recommandé) » ; `commun/tva.ts:1-7`) | Une ligne à 0 % exige une catégorie (`AE`, `E`, `K`, `G`, `O`, `Z`) et, hors `Z`, un motif | EX-18 (S2 BR-FR-15) | FE-2 (Q-06, Q-22) |
| 6 | SIREN du client exigé mais ni copié ni imprimé ; TVA du client libre, ni copiée ni imprimée | Mention obligatoire et donnée BT-47 | EX-12, EX-13 | FE-1, FE-2 |
| 7 | Case « Pas de SIRET (particulier) » | Confond particulier et client sans SIREN ; ni étranger ni public | EX-02 | FE-1 (N-09, répondue en partie le 26-11-2026 : type de client à cinq valeurs, lecture retenue) |
| 8 | Adresse du client en un seul texte, pays omis pour la France (`factures/metier.ts:13-15`) | Pays codé obligatoire (BT-40, BT-55) ; adresse structurée | EX-19 | FE-1, FE-2 |
| 9 | Ni catégorie d'opération, ni option pour les débits, ni adresse ni date de livraison | Données et mentions obligatoires | EX-11, 15, 16, 17 | FE-1, FE-2 |
| 10 | Unités absentes de la facture, perdues au temps passé (`factures/tempsPasse.ts:221-222`) | BT-130 obligatoire par ligne | EX-19 | FE-2 |
| 11 | Escompte facultatif, indemnité forfaitaire absente (`schema.prisma:938-949`) | Notes `PMT` et `AAB` obligatoires | EX-17 | FE-2 (Q-23) |
| 12 | Préfixe de longueur libre ; préfixes de facture et d'avoir identiques admis ; garde-fou de la décision 1 du [paramétrage cible](PARAMETRAGE-CIBLE.md) non implémenté | Numéro de 35 caractères au plus, unique | EX-09 | FE-1 |
| 13 | Identité de la société : SIRET sans contrôle, pas de SIREN distinct, TVA libre | SIREN du vendeur obligatoire et actif | EX-13 | FE-1 |
| 14 | Pas d'avoir à 0,00 € (réponse du 10-11-2026) ; facture à 0,00 € ni annulable ni créditable | Une facture rejetée ou refusée s'annule en comptabilité | EX-26 | N-05, puis FE-6 |
| 15 | Annulation totale refusée après un règlement ou un avoir partiel (`factures/routes.ts:449-455`) | Même exigence d'annulation | EX-26 | N-06, puis FE-6 |
| 16 | Acompte constaté sur le devis, sans facture ni déduction sur la facture définitive ; exigé par défaut à 40 % (décisions du 17-11-2026) | « Tout assujetti est tenu de délivrer une facture pour les acomptes qui lui sont versés (article 289-I.1.c du CGI) » ; TVA exigible à l’encaissement de l’acompte, « même avec option sur les débits » ; facture définitive de cadre 4 qui reprend l'acompte | EX-20, EX-22, EX-30 (S3 §3.2.19) | Q-21, puis FE-12 (place : N-12) |
| 17 | Statut Iris « Annulée » (par l'avoir total) | Ne pas le confondre avec le statut 220 « Annulée », posé après une rectificative | EX-21, EX-24 | FE-5 : libellés distincts |
| 18 | Factures fournisseurs : numéro libre, hors taxe seul ; fournisseur sans SIREN | Réception, rattachement par SIREN | EX-35, EX-36 | FE-9 (N-11) |
| 19 | Polices non incorporées, texte WinAnsi (`documents/gabarit.ts:66-82`) | Un PDF/A-3 incorpore ses polices (S12, non lue) | EX-06 | FE-3 |

**Issues liées** (toutes `suivi-audit`, sauf #35, qui n'a pas l'étiquette).

| Issue | Objet | Lot |
|---|---|---|
| #35 | Export comptable sans période ni journal ; journal des factures sans avant ni après (issue ouverte, **sans l'étiquette `suivi-audit`** : fiche de reste à faire et de dette relevée avant la mise en service) | FE-10 pour la piste d'audit ; l'export reste à #35 |
| #243 | Cohérence interne des pièces émises non garantie en base | Préalable utile à FE-2 : le modèle canonique suppose des totaux cohérents. *Suite, 25-11-2026 : #243 fermée par #681 (lot AC, 25-11-2026) ; la cohérence interne de toute pièce émise est garantie en base ; la TVA recalculée (HT × taux) et le TTC de ligne n'y sont pas comparés, à voir avec FE-2 et le cabinet ([passation, section 3](ROADMAP-PASSATION.md#3-questions-ouvertes-pour-nelson)) ; FE-12 devra revoir la règle des signes, qui veut des lignes positives ou nulles, pour la ligne de reprise d'acompte ([historique](HISTORIQUE-DECISIONS.md#lot-du-25-11-2026-681)).* |
| #247 | Double clic sur « Créer l'avoir partiel » : deux avoirs émis et numérotés | Correctif propre à Iris, au plus tard avec FE-5 : garde du formulaire et clé d'idempotence côté serveur (correctif proposé par l'issue). **Issue fermée par #663 (lot X, 23-11-2026)** : la clé d'envoi de la création d'un avoir partiel (`Facture.cleEnvoi`) est **implémentée** ([historique](HISTORIQUE-DECISIONS.md#lot-du-23-11-2026-663)). Le `trackingId` de FE-5 reste distinct : il ne dédoublonne qu'un même dépôt, et deux avoirs distincts seraient déposés tous deux |
| #352 | Brouillon bloqué par la chronologie | FE-6 (date de la nouvelle facture) |
| #536 | N3 : preuve d'envoi non reproductible | FE-5 |
| #540 | N7 : devis `A26-0001` et avoir `A2026-0001` | FE-1 (préfixes ; Q-20) |
| #305 | Gabarit PDF : coupures sur espaces insécables, caractères de mise en forme, attente des tests de verrou | FE-3 : le PDF/A-3 embarque le PDF du gabarit commun (ligne 19 de la section 6) ; à relire à son cadrage |
| #308 | PDF : tester l'en-tête et le pied de page avec des caractères hors WinAnsi | FE-3 : texte WinAnsi et polices (ligne 19 de la section 6) ; à relire à son cadrage |
| #411 | Envoi par Microsoft 365 (6b-1b) : tests et notes non bloquants des audits de #410 | FE-3 : à relire à son cadrage pour celles de ses notes qui touchent le PDF envoyé ; le reste suit son issue |
| #588 | Messages du serveur : taux de TVA écrits au point et clés techniques brutes (« 5.5 % », « TVA:5.5, VENTE_ARTICLE ») | FE-3 : écriture des taux (« 5.5 % » au point, selon l'issue ; BR-FR-16 accepte « 5.5 » et « 5.50 » dans le fichier structuré, EX-18) ; à relire à son cadrage |
| #526 | Suivi d'audit de #524 : verrou de la garde différée, test de migration fragile, avoir de 0,00 € | FE-6 : sa remarque sur l'avoir de 0,00 € touche N-05 et Q-25 ; le reste suit son issue |
| #531 | Suivi d'audit de #530 (pas d'avoir à 0,00 €) : notes non bloquantes | FE-6 : **fermée** par #636 (20-11-2026) ; le lot en relit ce qui touche l'avoir à 0,00 € (N-05, Q-25) |
| #154 | Double saisie probable d'un règlement | FE-7 : un doublon fausserait « Encaissée » |
| #156 | Règle du surplus (trop-perçu) connue du formulaire | FE-7 : montant d'Encaissée d'un trop-perçu (N-17, Q-08) |

## 7. Rejet et refus

**Rien n'est tranché ici.** La section expose la règle officielle, la confronte aux invariants d'Iris et pose les questions. Le lot FE-6 attend les réponses.

### 7.1 Règle officielle

| Cas | Posé par | Effet | Numéro | Avoir | Nouvelle facture | Source |
|---|---|---|---|---|---|---|
| Rejetée à l'émission (213) | PA de l'émetteur, contrôle réglementaire en échec | Non transmise au client ; statut au PPF et au vendeur | Le contrôle d'unicité (numéro, année, SIREN) est « systématiquement bloquant » : une nouvelle facture ne reprend pas le numéro | « Le VENDEUR DOIT annuler la comptabilisation » d'une facture rejetée, « par exemple » par un « AVOIR INTERNE » non transmis, ou transmis « uniquement pour archivage » | Oui, sous un nouveau numéro | S3 §2.2 ; S2 BR-FR-CO-02, BR-FR-20 ; S8 (NV) |
| Rejetée en réception (213) | PA du client | Non délivrée à l'acheteur, sauf demande ; statut au PPF, à la PA de l'émetteur, à l'acheteur pour information | Idem | Idem | Idem | S3 §2.4 |
| Refusée (210) | Acheteur, motif de la liste (EX-27), dans trois cas (EX-28) | Statut définitif ; flux 1 ignoré pour le pré-remplissage s'il arrive dans la période | Idem | « En théorie », avoir interne non transmis à l'acheteur, sans flux 1 ; l'acheteur n'attend aucun avoir | « si nécessaire » | S3 §2.5 ; S2 BR-FR-20 |
| Refus contesté | Vendeur, hors cycle de vie | Facture maintenue ; écart accepté avec le pré-remplissage | Inchangé | Aucun | Non | S3 §2.5, NOTE |
| Irrecevable (501) | PA | Fichier non reconnu comme facture ; l'émetteur « peut alors corriger et transmettre à nouveau » | Non dit (Q-02) | — | — | S3 §2.1 |
| Erreur de routage (221) | PA du client | Pas un rejet ; la PA de l'émetteur rejoue après mise à jour de l'annuaire | Inchangé | Aucun | Non | S3 §2.1, §2.3 |
| Déposée `NON_TRANSMISE` | PA de l'émetteur | Client sans PA active ; la facture est émise | Inchangé | Aucun | Non | S3 §1.4.4 |

La formule « réputée non émise » ne figure dans aucune source officielle lue. Les sources vérifiées exigent une **annulation comptable**, ce qui suppose une facture existante dont le numéro est consommé.

### 7.2 Confrontation avec les invariants d'Iris

Invariants : continuité et chronologie de la numérotation, immutabilité des documents émis, correction par avoir (`CLAUDE.md`, règle permanente 1 ; [paramétrage cible](PARAMETRAGE-CIBLE.md), section 3.3). S'y ajoutent deux décisions : pas d'avoir à 0,00 € (10-11-2026) et pas d'annulation totale après un règlement (17-10-2026).

| Point | Règle officielle | Iris aujourd'hui | Compatibilité |
|---|---|---|---|
| 1. Numéro de la facture rejetée | Annulation comptable : la pièce existe ; nouvelle facture sous un nouveau numéro | Numéro attribué à l'émission, avant toute transmission (`factures/routes.ts:404-408`) | Compatible si la facture rejetée garde son numéro. Incompatible si le cabinet la dit « non émise » et demande de réutiliser le numéro (Q-01, N-03) |
| 2. Facture rejetée ou refusée | Statut définitif ; pièce justificative conservée | Figée en base | Compatible : le statut vit dans le journal des statuts, pas dans la facture |
| 3. Avoir interne | Non transmis au client, ou transmis pour archivage seul (`ARCHIVEONLY`) | Avoir total numéroté dans la série des avoirs ; rien ne distingue un avoir interne | Compatible si l'avoir est marqué interne et non transmis ; la série est à confirmer (Q-20) |
| 4. Facture à 0,00 € rejetée ou refusée | Annulation comptable | Aucun avoir à 0,00 € (`mig 20261110120000_avoir_non_nul:36-38`) | **Conflit** (N-05, Q-25) |
| 5. Facture refusée après un règlement ou un avoir partiel | Annulation comptable | Annulation totale refusée (`factures/routes.ts:449-455`) ; un avoir partiel du reste la rendrait « réglée » (#524) | **Conflit** (N-06) |
| 6. Refus contesté | Facture maintenue, sans avoir | Rien à faire | Compatible ; qui décide est une question (N-04) |
| 7. Irrecevable | Correction et nouvel envoi | Pièce figée, numéro consommé | Compatible si le même fichier est renvoyé ; **conflit** si la correction change le contenu (N-07, Q-02) |
| 8. Date de la nouvelle facture | Non précisée par les sources lues | Date au moins égale à celle de la dernière facture numérotée (`factures/routes.ts:392-393`) | Compatible avec la date du jour ; une reprise de la date d'origine serait refusée (Q-03) |
| 9. Reste dû | Facture rejetée ou refusée sans créance | Reste dû compté jusqu'à l'avoir | Compatible après l'avoir interne ; alerte d'ici là (FE-5) |
| 10. Facture au temps passé rejetée ou refusée | Nouvelle facture sous un nouveau numéro | Une seule facture au temps passé vivante par intervention (`factures/repere.ts:20-24` ; index `Facture_temps_passe_unique`, `mig 20261116200000_facture_zero_temps_passe:8-10`) : la nouvelle facture attend l'avoir total, refusé après un règlement ou un avoir partiel (`factures/routes.ts:449-455`) | **Conflit** si la facture porte un règlement ou un avoir partiel : ses heures ne se refacturent pas (N-06) |
| 11. Règlement reçu sur une facture rejetée ou refusée | Aucun statut obligatoire, donc aucune Encaissée, ne suit « Rejetée » ou « Refusée » (S3 §2.5) | Parts de règlement immuables, retirées par contre-passation seule (`reglements/routes.ts:131-163`) ; un règlement ne précède pas l'émission de la facture qu'il règle (`reglements/routes.ts:91`) | **Conflit** : l'encaissement ne se reporte pas sur la nouvelle facture à sa date réelle, et le contre-passer pour permettre l'annulation fausserait l'encaissé (N-06, Q-08) |
| 12. Avoirs partiels déjà transmis d'une facture ensuite refusée | Flux 1 de la facture refusée ignoré pour le pré-remplissage (S3 §2.5) | Avoirs partiels émis et figés, chacun déposé avec son flux 1 (FE-5) | **Question** : leur flux 1 compte-t-il encore pour le pré-remplissage de TVA ? (N-06, Q-03) |

**Export comptable** (note de l'audit des montants de #620, [#622](https://github.com/OrizonLab/iris/issues/622), N5) : compatible. Un avoir interne entre au journal des ventes comme tout avoir émis, qui reprend les comptes et le journal de sa facture d'origine (`comptabilite/metier.ts:23`) ; cela ne vaut plus si le cabinet répond « non émise » à Q-01 (voir le point 1).

Questions posées : N-03 à N-07 pour Nelson ; Q-01 à Q-03, Q-08, Q-20 et Q-25 pour le cabinet.

## 8. Découpage en lots

### 8.1 Vue d'ensemble

| Lot | Objet | Dépend de | Auditeurs |
|---|---|---|---|
| FE-0 | Cette proposition | — | `controleur-coherence`, `auditeur-montants` |
| FE-DOC | Connexion à une PA et déploiement (deux PR) | FE-0 ; FE-4 et FE-5 pour la seconde | `controleur-coherence` |
| FE-1 | Identité fiscale de la société et des clients | FE-0 ; N-01 répondue le 26-11-2026 (lecture retenue, à corriger par Nelson si besoin ; ne bloque plus) ; N-09 répondue en partie le 26-11-2026 (lecture retenue ; reste le type d'une association à SIREN non assujettie, N-09, suite) | `auditeur-montants` (préfixes et numérotation), `auditeur-droits-securite` |
| FE-2 | Données de la facture et modèle canonique | FE-1 ; Q-05, Q-22, Q-23 | `auditeur-montants`, `auditeur-droits-securite` |
| FE-3 | Formats, validation et job de CI | FE-2 ; N-15 | `auditeur-montants`, `auditeur-droits-securite` |
| FE-4 | Connecteur PA, annuaire, contrôle de compatibilité | FE-1 ; N-02 (PA de recette et contrat ouverts) | `auditeur-droits-securite` |
| FE-5 | Transmission et journal des statuts (ventes) | FE-3, FE-4 ; N-08, N-14 | `auditeur-montants`, `auditeur-droits-securite` |
| FE-6 | Correction après rejet ou refus | FE-5 ; N-03 à N-07 ; Q-01 à Q-03 | `auditeur-montants`, `auditeur-droits-securite` |
| FE-7 | Encaissée et données de paiement | FE-5 ; N-06, N-13, N-17 ; Q-05 à Q-08 | `auditeur-montants`, `auditeur-droits-securite` |
| FE-8 | E-reporting | FE-7 ; Q-05, Q-09, Q-10 | `auditeur-montants`, `auditeur-droits-securite` |
| FE-9 | Boîte de réception et statuts acheteur | FE-1, FE-4 ; N-11 | `auditeur-droits-securite` ; `auditeur-montants` (montants reçus, choix par défaut, à confirmer) |
| FE-10 | Conservation et restitution | FE-5, FE-9 ; Q-11, Q-12 ; N-16 | `auditeur-montants` (factures et avoirs figés), `auditeur-droits-securite` |
| FE-11 | Clients publics, si N-10 le demande | FE-5 | `auditeur-droits-securite` ; `auditeur-montants` (données des factures publiques, choix par défaut, à confirmer) |
| FE-12 | Facture d'acompte et facture définitive après acompte, obligatoire si Q-21 le confirme | FE-7 ; Q-07, Q-21 ; N-12 | `auditeur-montants`, `auditeur-droits-securite` |

Le `controleur-coherence` passe avant chaque lot et avant chaque fusion, selon le circuit de `CLAUDE.md`.

### 8.2 Exigences transverses (cadrage de Nelson)

- **Schematrons.** « chaque facture et chaque avoir générés passent les schematrons » : chaque test qui émet une pièce valide aussi son fichier.
- **Parcours testés.** « Les parcours rejet, refus, encaissement et réception sont testés sur PostgreSQL et dans le navigateur » : tests d'API sur base jetable et Playwright. La PA est simulée par un faux serveur XP Z12-013 lancé par les tests, sur le modèle de `MICROSOFT_GRAPH_URL`.
- **Job de CI dédié.** « Job CI dédié, lancé seulement quand la facturation change » : le script de périmètre (`.github/scripts/perimetre-ci.mjs`) le déclenche sur les chemins de la facturation. La « CI — synthèse » en tient compte.
- **Validateurs officiels.** « Pour les schematrons, validateurs officiels dans un conteneur de CI plutôt que saxon-js » : une image de conteneur porte les artefacts aux versions de S1 et S6.
- **Audits.** « auditeur-montants et auditeur-droits-securite sur chaque lot concerné » (section 8.1).
- **Dernières versions.** « vérifie la dernière version avant de coder » (cadrage, rubrique « RÉFÉRENCES ») : chaque lot de code vérifie, avant de coder, la dernière version des sources qu'il applique (section 2.1) et cite dans sa PR la version retenue.
- **Règles du circuit pour les montants** (rappel de `CLAUDE.md` et de `.claude/agents/auditeur-montants.md`, remarque de l'audit des montants de #620, [#622](https://github.com/OrizonLab/iris/issues/622), N3) : les tests de montants sont éprouvés par mutants ; une fusion ne vaut pas validation comptable ; la validation du cabinet et de Nelson précède la mise en service. L'`auditeur-montants` est prévu pour FE-1 depuis #620 (section 8.1).
- **Règle R.** Une exigence obligatoire de la matrice que le lot devait couvrir et laisse non respectée est une remarque R.
- **Règle 4 de la méthode.** Aucune donnée réelle n'existe : aucun lot ne migre de données existantes. Les colonnes nouvelles sont vides ou prennent la valeur du comportement actuel.

### 8.3 Fiches des lots

#### FE-0 : proposition (cette PR)

- **Périmètre** : cette proposition ; corrections de la [documentation d'intégration](INTEGRATIONS-M365-COMPTABILITE-FACTURATION-FR.md) ; renvoi dans la passation.
- **Hors périmètre** : tout code ; les deux documents de FE-DOC ; l'historique, mis à jour après la fusion.
- **Critères** : chaque exigence a sa source, son état, son lot ; chaque conflit avec un invariant est une question.

#### FE-DOC : connexion à une PA et déploiement

- **Périmètre.**
  - **PR a, juste après FE-0**, car le contrat avec une PA doit précéder la recette : `docs/FACTURATION-ELECTRONIQUE-CONNEXION-PA.md`, partie « critères de choix d'une PA » (inscrite sur la liste officielle de la DGFiP, S10 ; version de XP Z12-013 ; flux couverts ; formats ; bac à sable ; notifications ; archivage ; réversibilité) ; `docs/FACTURATION-ELECTRONIQUE-DEPLOIEMENT.md`, première version de la liste de contrôle.
  - **PR b, avec FE-4 et FE-5, avant la recette** : la connexion pas à pas (identifiants, variables, activation, `npm run efacture:verifier`, bouton « Tester la connexion ») et la liste de contrôle complète.
- **Liste de contrôle** (cadrage de Nelson, mot pour mot) : « identité fiscale de la société (SIREN, TVA, option débits, catégorie et date d'obligation) ; PA choisie et contrat signé ; inscription à l'annuaire vérifiée ; identifiants configurés ; SIREN et type de chaque client professionnel ; catégorie d'opération par article, validée par le cabinet ; contrôle de compatibilité au vert ; première facture réelle suivie jusqu'au statut attendu ; e-reporting paramétré ; conservation des factures (durée et lieu, à valider par le cabinet) ; personnes chargées des rejets et des refus ; validation du cabinet et mon feu vert ».
- **Hors périmètre** : le choix de la PA, qui revient à Nelson (N-02). **Note du 26-11-2026** : Nelson veut « qu'on puisse la choisir et pouvoir la connecter » ; lecture retenue, à corriger par Nelson si besoin : FE-4 livre le choix et la connexion dans l'écran Connecteurs, par un connecteur conforme à XP Z12-013 paramétré par installation, sans PA en dur ; le choix de la PA de recette reste à Nelson.
- **Critères** : un administrateur suit la liste sans autre document ; chaque point renvoie à l'écran ou à la variable concernés.
- **Documents de la PR a** : [connexion à une PA](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md) (critères de choix ; connexion pas à pas prévue) et [liste de contrôle du déploiement](FACTURATION-ELECTRONIQUE-DEPLOIEMENT.md) (première version).

#### FE-1 : identité fiscale de la société et des clients

- **Périmètre.**
  - Société (catégorie d'entreprise, régime de TVA et option pour les débits : réglages de chaque installation, sans valeur par défaut inventée, note du 26-11-2026) : SIREN distinct, SIRET contrôlé (14 chiffres, SIREN en tête, BR-FR-09), TVA intracommunautaire contrôlée, option pour les débits, catégorie d'entreprise et date d'obligation, régime de TVA, adresse électronique de réception des statuts (BT-34) et de réception des factures, IBAN et BIC, moyen de paiement attendu.
  - Préfixes : longueur bornée pour un numéro de 35 caractères au plus ; préfixes de facture et d'avoir différents ; garde-fou de la décision 1 du [paramétrage cible](PARAMETRAGE-CIBLE.md).
  - Clients : type de client (N-09, répondue en partie le 26-11-2026 : B2B France, B2B UE, B2B hors UE, particulier, entité publique ; lecture retenue, à corriger par Nelson si besoin ; le type d'une association à SIREN non assujettie reste ouvert), SIRET facultatif, TVA contrôlée, code pays ISO 3166-1 des sites, adresse électronique de facturation (BT-49).
  - « Prêt à facturer » signale les données manquantes.
- **Hors périmètre** : la copie de ces données sur la facture (FE-2) ; l'annuaire (FE-4).
- **Exigences** : EX-02, 09, 12, 13, 14, 15, 19, 41, 44.
- **Paramètres** :
  - SIREN, option pour les débits, catégorie, date d'obligation, régime de TVA, adresses électroniques, IBAN, BIC, moyen de paiement attendu : aucune valeur par défaut, saisie obligatoire avant l'activation du connecteur (FE-4) ;
  - code pays d'un site : `FR` par défaut, ce qui reprend la valeur actuelle « France » ;
  - type de client : `B2B France` pour un client avec SIREN, particulier pour un client « Pas de SIRET », ce qui reprend le comportement actuel.
- **Variables d'environnement** : aucune.
- **Critères** : une société sans SIREN ne peut pas activer le connecteur ; un préfixe trop long ou identique pour les factures et les avoirs est refusé avec un message clair ; chaque changement est journalisé.
- **Tests** : API sur PostgreSQL (formats, refus, journal, droits du `SUPERADMIN`) ; Playwright sur les écrans Société et Client.
- **Auditeurs** : `auditeur-montants` (préfixes et numérotation, EX-09), `auditeur-droits-securite` (IBAN, données de la société).

#### FE-2 : données de la facture et modèle canonique

- **Périmètre.**
  - Copies figées à l'émission : SIREN, SIRET, TVA et type du client ; adresse structurée avec code pays ; adresse de livraison ; option pour les débits.
  - Saisies du brouillon : date de livraison ou période, préremplie depuis l'intervention ou l'échéance du contrat (choix par défaut, à confirmer) ; référence d'achat du client, facultative.
  - Lignes : unité codée (UN/ECE Rec. 20), catégorie de TVA et motif d'exonération à 0 %.
  - Catégorie d'opération (BT-23) depuis la nature des lignes : `PRESTATION` vers service, `ARTICLE` vers bien (correspondance du [paramétrage cible](PARAMETRAGE-CIBLE.md), B-48), à valider par le cabinet (Q-05).
  - Notes `PMT`, `PMD`, `AAB` depuis les mentions légales versionnées, l'escompte devenant obligatoire.
  - Type BT-3 (380, 381) ; référence de la facture d'origine (BG-3).
  - Modèle canonique EN16931 par une fonction pure ; contrôle des données obligatoires avant le numéro.
- **Hors périmètre** : les fichiers XML et PDF (FE-3) ; la facture d'acompte (FE-12).
- **Exigences** : EX-10, 11, 12, 15, 16, 17, 18, 19, 21.
- **Paramètres** : contenu des notes `PMT`, `PMD`, `AAB` : aucune valeur par défaut, saisie obligatoire (Q-23) ; une unité sans correspondance bloque l'émission électronique.
  - **Correspondance des unités** (note du contrôle de cohérence de #620, [#622](https://github.com/OrizonLab/iris/issues/622), N10) : le code UN/ECE Rec. 20 est une règle du format, mais la liste des unités ne peut pas être figée « dans le code » : aujourd'hui libres (B-50 de l'[inventaire du paramétrage](PARAMETRAGE-INVENTAIRE.md)), elles seront tenues par la société dès le lot P3 ([paramétrage cible](PARAMETRAGE-CIBLE.md), section 5). La correspondance entre une unité de la société et son code ne peut donc pas être une table écrite dans le code ; où elle se tient reste à trancher au cadrage de FE-2, selon la règle permanente 1 (un paramètre plutôt qu'une constante).
  - **Catégorie d'opération « par article »** : la liste de contrôle de FE-DOC la dit « par article » ; la proposition la déduit de la nature de chaque ligne (`PRESTATION` ou `ARTICLE`, B-48 du paramétrage cible, tenue par la société dès le lot P3) et non d'une fiche du catalogue. Une catégorie portée par chaque fiche changerait le modèle de données : question pour Nelson posée au cadrage de FE-2 ([liste de contrôle du déploiement, section 4.6](FACTURATION-ELECTRONIQUE-DEPLOIEMENT.md#46-catégorie-dopération-par-article)).
- **Variables d'environnement** : aucune.
- **Ventilation de la TVA** (note de l'audit des montants de #620, #622, N2) : la ventilation de TVA d'une facture est aujourd'hui unique par taux (`FactureVentilationTva`, `@@unique([factureId, tauxTva])` dans `schema.prisma`). Si la réponse à Q-22 donne deux catégories à 0 % sur une même facture, chaque ventilation (BG-23) doit porter une catégorie et un taux : l'unicité par taux ne suffirait plus. Le lot le tranche à son cadrage ; aucune solution n'est choisie ici.
- **Critères** : une facture émise porte toutes les données obligatoires de la CIUS française ; une ligne à 0 % sans catégorie est refusée avant le numéro ; aucun montant ne change.
- **Tests** : API sur PostgreSQL (copies figées, refus avant numéro, montants inchangés) ; tests unitaires du modèle canonique ; Playwright du brouillon.
- **Auditeurs** : `auditeur-montants`, `auditeur-droits-securite`.

#### FE-3 : formats, validation et job de CI

- **Périmètre.**
  - Sérialisation CII D22B et UBL 2.1 (Invoice, CreditNote) ; Factur-X EN16931 : PDF/A-3 qui embarque le CII, polices incorporées.
  - Le PDF lisible porte toutes les données du fichier structuré.
  - Validation XSD et schematrons dans la transaction d'émission ; un échec annule tout, sans consommer de numéro.
  - Comparaison chiffrée entre `@e-invoice-eu/core` et un générateur maison (section 9).
  - Job de CI dédié, validateurs officiels en conteneur.
- **Hors périmètre** : la transmission (FE-5).
- **Exigences** : EX-05, 06, 07, 08, 09 (contrôle), 19.
- **Paramètres** : format transmis, Factur-X par défaut (choix par défaut, à confirmer).
- **Variables d'environnement** : selon N-15, l'adresse du service de validation (nom proposé : `EFACTURE_VALIDATEUR_URL`), à documenter dans ce lot.
- **Critères** : chaque facture et chaque avoir des tests passent les validateurs officiels ; une pièce invalide n'est pas émise et ne consomme pas de numéro.
- **Tests** : job de CI dédié ; API sur PostgreSQL (refus avant numéro, rollback de la séquence) ; tests de non-régression du PDF ; test de la TVA différentielle d'un avoir partiel (#522), qui s'écarte d'au plus 1 centime de `round(base × taux)`, dans la tolérance de BR-CO-17 et BR-S-09 (annexe, EX-18, « À valider »).
- **Auditeurs** : `auditeur-montants` (montants du fichier), `auditeur-droits-securite` (dépendances).

#### FE-4 : connecteur PA, annuaire et contrôle de compatibilité

- **Périmètre.**
  - Interface `ElectronicInvoicingProvider` ; implémentation XP Z12-013 1.3.0 (Flow et Directory).
  - Authentification OAuth2 « client credentials » ; en-têtes `Request-Id` et, si besoin, `Organization-Id`.
  - Interrogation périodique par `POST /v1/flows/search` (`updatedAfter`) par défaut. Un webhook seulement si la PA signe ses rappels, authentifié, filtré et testé (EX-52).
  - Écran Connecteurs, réservé au `SUPERADMIN` : activation, environnement affiché, journal.
  - Commande `npm run efacture:verifier` et bouton « Tester la connexion » (section 4.3).
  - Consultation de l'annuaire, résultat conservé avec sa date.
- **Hors périmètre** : le dépôt des factures (FE-5) ; un adaptateur propriétaire, sur décision de Nelson.
- **Exigences** : EX-13, 14, 43, 45, 49, 50, 51, 52.
- **Paramètres** : connecteur actif, inactif par défaut (comportement actuel) ; changement journalisé.
- **Variables d'environnement** (noms proposés, à documenter dans ce lot dans `server/.env.example`, dans la liste de rappel en tête de `.env.example` et dans [la configuration](CONFIGURATION-ENVIRONNEMENT.md), selon la règle permanente 3) : `EFACTURE_PA_URL_FLOW`, `EFACTURE_PA_URL_ANNUAIRE`, `EFACTURE_PA_URL_JETON`, `EFACTURE_PA_CLIENT_ID`, `EFACTURE_PA_CLIENT_SECRET` (secret), `EFACTURE_PA_ORGANIZATION_ID` (facultative), `EFACTURE_PA_ENVIRONNEMENT` (`bac-a-sable` ou `production`), `EFACTURE_WEBHOOK_SECRET` (seulement avec un webhook).
- **Lecture retenue sur le choix de la PA (réponse du 20-11-2026, [historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-20-11-2026-sur-la-facturation-électronique) ; à corriger par Nelson si besoin).** Aucune PA n'est choisie et Iris n'en impose aucune : chaque installation choisit sa PA. Elle se choisit dans l'écran Connecteurs, par son nom et ses adresses, qui ne sont pas secrets et dont le changement est journalisé ; ses identifiants secrets restent en variables d'environnement (cadrage du 19-11-2026). Les noms `EFACTURE_PA_URL_*` ci-dessus deviendraient alors des réglages de l'écran plutôt que des variables : à trancher au cadrage de FE-4, en restant cohérent avec la règle permanente 3 et avec le choix par défaut 11 du [document de connexion](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md#8-choix-par-défaut-de-ce-document-à-confirmer). Le lot reste **prévu** ; la liste des variables ci-dessus reste la proposition d'origine jusqu'à ce cadrage.
- **Critères** : sans variables, le connecteur ne s'active pas et Iris fonctionne comme avant ; le contrôle dit « conforme » ou liste les manques ; aucun secret n'apparaît dans un journal, une réponse ou l'écran.
- **Tests** : faux serveur XP Z12-013 ; API sur PostgreSQL (droits, journal, secrets absents des réponses) ; Playwright de l'écran Connecteurs.
- **Auditeur** : `auditeur-droits-securite`.

#### FE-5 : transmission et journal des statuts (ventes)

- **Périmètre.**
  - Dépôt de chaque facture et avoir à transmettre, avec `trackingId` pour l'idempotence et `processingRule`.
  - Conservation du fichier transmis et de son empreinte, en ajout seul.
  - Journal des statuts : ajout seul, horodatage de la base, preuve de la PA (identifiant du flux, `ackStatus`, empreinte).
  - Statuts reçus : Déposée, Rejetée, Refusée, Irrecevable, Erreur de routage, Mise à disposition, Prise en charge, Approuvée, En litige… ; code inconnu gardé.
  - Alerte visible sur toute facture rejetée ou refusée, avec son motif.
  - Canal : la PA pour le B2B France selon N-14 ; le courriel devient une copie d'information.
  - Libellés distincts du statut Iris et du statut de la PA.
- **Hors périmètre** : la correction (FE-6) ; Encaissée (FE-7).
- **Exigences** : EX-01, 03, 08, 24, 25, 27, 29, 32, 34, 43, 46, 47, 49.
- **Paramètres** : aucun nouveau ; qui transmet suit `factures.emettre`, qui voit les statuts suit `factures.consulter` ([droits cible](MODELE-DROITS-CIBLE.md)), comme aujourd'hui (choix par défaut, à confirmer).
- **Variables d'environnement** : celles de FE-4.
- **Critères** : une facture émise vers un client B2B France arrive au statut Déposée sur le faux serveur ; un rejet et un refus s'affichent avec leur motif ; le fichier transmis se retélécharge à l'identique.
- **Tests** : API sur PostgreSQL et Playwright des parcours rejet et refus (détection et alerte) ; immutabilité du journal en base.
- **Contrôle de compatibilité** : étend `npm run efacture:verifier` (section 8.4, [#622](https://github.com/OrizonLab/iris/issues/622), N4) : le dépôt jusqu'au statut Déposée.
- **Modèle de données** (note de #624, [#622](https://github.com/OrizonLab/iris/issues/622), N-v3-1) : l'environnement (bac à sable ou production) où a eu lieu chaque transmission et chaque statut est gardé avec eux ; **modèle de données de FE-5, à confirmer par Nelson** au cadrage du lot (le point 11 de la [section 8 du document de connexion](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md#8-choix-par-défaut-de-ce-document-à-confirmer) le précise aussi). Rien n'est tranché ici.
- **Auditeurs** : `auditeur-montants`, `auditeur-droits-securite`.

#### FE-6 : correction après rejet ou refus

- **Périmètre** : selon les réponses à N-03 à N-07 et à Q-01 à Q-03 : avoir interne `ARCHIVEONLY`, nouvelle facture, contestation, renvoi d'un fichier irrecevable.
- **Contrôles d'un avoir interne** (note de l'audit des montants de #620, [#622](https://github.com/OrizonLab/iris/issues/622), N6) : un avoir interne `ARCHIVEONLY` passe les schematrons ; ni la consultation de l'annuaire ni le routage vers le client ne doivent conditionner son émission, sinon une facture rejetée pour son adresse électronique ne pourrait pas s'annuler. Son sort à la PA reste à trancher avec le cycle décidé (N-03, Q-01) : gardé par Iris sans dépôt, ou déposé « uniquement pour archivage » (`processingRule` `ARCHIVEONLY`, EX-03 ; section 7.1) ; rien n'est décidé ici.
- **Hors périmètre** : la facture rectificative 384, sauf réponse contraire.
- **Exigences** : EX-03, 21, 26, 29.
- **Paramètres** : aucun sans décision.
- **Critères** : une facture rejetée ou refusée sort du reste dû par le cycle décidé, sans jamais être modifiée.
- **Tests** : parcours rejet et refus complets sur PostgreSQL et dans le navigateur.
- **Auditeurs** : `auditeur-montants`, `auditeur-droits-securite`.

#### FE-7 : Encaissée et données de paiement

- **Périmètre.**
  - Statut Encaissée à chaque règlement d'une facture dont la TVA est due à l'encaissement ; un bloc par taux (N-17) ; montant négatif à la contre-passation.
  - Un avoir n'est jamais un encaissement : il ne crée, à lui seul, aucun montant encaissé. Après un avoir partiel, la forme suit N-17 et Q-08 : « Encaissée » sur la facture pour sa totalité et sur l'avoir en négatif (S3 §2.6, « Fortement Recommandé »), ou sur la facture seule, limité aux règlements.
  - Réception de « Paiement transmis ».
  - Prélèvements des contrats selon N-13.
- **Hors périmètre** : la banque et le rapprochement.
- **Exigences** : EX-25, 30, 31, 34, 40.
- **Paramètres** : aucun ; la règle d'exigibilité reste dans le code, avec sa source (Q-06 à Q-08).
- **Critères** : un règlement partiel puis total produisent les statuts attendus ; une contre-passation produit un statut négatif ; une facture soldée par avoirs, sans règlement, ne produit aucun montant encaissé ; trop-perçu, avoir après règlement, facture de cadre M et règlement d'une facture refusée suivent les réponses à N-06, N-17 et Q-08, sans règle inventée.
- **Tests** : parcours encaissement sur PostgreSQL et dans le navigateur.
- **Contrôle de compatibilité** : étend `npm run efacture:verifier` (section 8.4, [#622](https://github.com/OrizonLab/iris/issues/622), N4) : l'envoi du statut « Encaissée » (statuts envoyés).
- **Auditeurs** : `auditeur-montants`, `auditeur-droits-securite`.

#### FE-8 : e-reporting

- **Périmètre** : transactions B2C agrégées par jour (10.3) et B2B internationales (10.1) ; paiements (10.2, 10.4) ; transmissions initiales et rectificatives ; périodicité selon le régime de TVA ; bascule d'un client absent de l'annuaire.
- **Hors périmètre** : les acquisitions B2B internationales, qui supposent la réception (FE-9), sauf réponse contraire.
- **Exigences** : EX-02, 38, 39, 40, 41, 42, 45.
- **Paramètres** : régime de TVA (FE-1) ; la périodicité de chaque régime reste dans le code, avec sa source, après Q-10.
- **Critères** : un e-reporting test est accepté par le bac à sable ; une correction produit une transmission rectificative.
- **Tests** : API sur PostgreSQL ; validation XSD et schematron du flux 10 (S1, `Flux10/`).
- **Contrôle de compatibilité** : étend `npm run efacture:verifier` (section 8.4, [#622](https://github.com/OrizonLab/iris/issues/622), N4) : l'e-reporting test.
- **Question ouverte, sans identifiant, au cadrage de FE-8** (note de l'audit des montants de #620, [#622](https://github.com/OrizonLab/iris/issues/622), N7) : quel signe porte, dans le flux 10.3 (agrégé B2C), un avoir d'un client particulier ? Iris n'a aucun montant négatif : ses avoirs sont positifs, avec leur type 381. Les documents du dépôt ne le disent pas : l'annexe liste les données de 10.3 (TT-77 à TT-88, EX-39) sans règle de signe, et ne cite un montant négatif que pour « Encaissée » (EX-30), pour une annulation en 10.4 (EX-42) et pour la ligne de reprise d'un acompte (EX-20). La source à lire est la feuille « E-REPORTING - Flux 10 » de S2 (et le schematron de `Flux10/`, S1), à relire au cadrage ; **aucune réponse n'est présumée**. Si la source ne la tranche pas, la question serait portée au cabinet par Nelson (section 11.2).
- **Auditeurs** : `auditeur-montants`, `auditeur-droits-securite`.

#### FE-9 : boîte de réception et statuts acheteur

- **Périmètre** : section 10, selon N-11.
- **Exigences** : EX-01, 24, 25, 27, 28, 32, 35, 36, 37, 46.
- **Paramètres** : qui approuve ou refuse : droits nouveaux, réservés à l'administration par défaut (choix par défaut, à confirmer ; règle 5 de la méthode).
- **Variables d'environnement** : celles de FE-4.
- **Critères** : une facture test déposée sur le bac à sable apparaît une fois dans Iris, avec son original et son lisible ; un refus exige un motif de la liste officielle ; chaque statut acheteur posé (Prise en charge, Approuvée, En litige, Refusée) est inscrit dans un journal horodaté et immuable (cadrage de Nelson du 19-11-2026 : « Journal horodaté et immuable, avec la preuve renvoyée par la PA. », [historique](HISTORIQUE-DECISIONS.md#décision-du-19-11-2026-sur-la-facturation-électronique) ; note du contrôle de cohérence de #620, [#622](https://github.com/OrizonLab/iris/issues/622), N12).
- **Tests** : parcours réception sur PostgreSQL et dans le navigateur ; dédoublonnage ; droits ; journal des statuts acheteur en ajout seul, horodaté par la base.
- **Contrôle de compatibilité** : étend `npm run efacture:verifier` (section 8.4, [#622](https://github.com/OrizonLab/iris/issues/622), N4) : la facture test reçue et les statuts envoyés.
- **Auditeurs** : `auditeur-droits-securite` ; `auditeur-montants` pour les montants des factures reçues (note #622, N14 ; choix par défaut, à confirmer).

#### FE-10 : conservation et restitution

- **Périmètre** : durée et lieu selon Q-11 et N-16 ; vérification périodique des empreintes ; restitution des fichiers et statuts pour un contrôle ; aucune suppression avant le terme.
- **Exigences** : EX-46, 47.
- **Paramètres** : durée : aucune valeur par défaut ; d'ici la réponse du cabinet, rien n'est supprimé (comportement actuel).
- **Variables d'environnement** : selon N-16 (stockage des fichiers), à documenter dans ce lot.
- **Tests** : API sur PostgreSQL (suppression refusée, empreinte contrôlée).
- **Auditeurs** : `auditeur-montants` (factures et avoirs figés), `auditeur-droits-securite`.

#### FE-11 et FE-12 : lots conditionnels

- **FE-11, clients publics** (si N-10) : Chorus Pro ou PA, règles BR-FR-CPRO, engagement juridique et code service (EX-04). Auditeurs : `auditeur-droits-securite` ; `auditeur-montants` pour les données des factures publiques (note #622, N14 ; choix par défaut, à confirmer).
- **FE-12, facture d'acompte** (obligatoire si le cabinet confirme qu'une facture d'acompte est due, Q-21 ; sa place relève de N-12) : types 386 et 503, facture définitive de cadre 4 qui reprend l'acompte (ligne de reprise ou montant déjà payé BT-113, selon N-12), Encaissée de l'acompte, due « même avec option sur les débits » (S3 §3.2.19) (EX-20, EX-22, EX-30 ; Q-07, Q-21).

### 8.4 Ordre et faisabilité de la recette

- **Ordre proposé.** FE-0, puis tout de suite la PR a de FE-DOC. Les lots de code viennent après les lots pilotes en cours (cadrage de Nelson). Réponse de Nelson du 20-11-2026 à la question de l'ordre : « fait les correctif d'issu d'abord » ([historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-20-11-2026-sur-la-facturation-électronique)). Lecture retenue, à corriger par Nelson si besoin : les correctifs d'issues passent avant les lots de code FE-1 et suivants, qui restent **prévus** ; la FE-DOC PR b reste liée à FE-4 et FE-5 :
  - chemin critique : FE-1, FE-2, FE-3, FE-5, FE-7, FE-8 ;
  - en parallèle, domaines indépendants : FE-4 après FE-1 ; FE-9 après FE-4 ; la PR b de FE-DOC avec FE-4 et FE-5 ;
  - après les réponses : FE-6 ; FE-10 ; FE-11 si N-10 le demande ; FE-12 si Q-21 le confirme, à la place fixée par N-12.
- **Recette sur le bac à sable.** Elle couvre ce que vérifie le contrôle de compatibilité : authentification et annuaire (FE-4), dépôt jusqu'à Déposée (FE-5), facture test reçue (FE-9), statuts envoyés (FE-7, FE-9), e-reporting test (FE-8).
- **Faisabilité avant le 01-06-2027.** Elle tient à trois conditions, sans date promise ici :
  - la place libérée par les lots pilotes en cours ;
  - le choix d'une PA et l'accès à son bac à sable (N-02, ouverte pour la PA de recette et son contrat : aucune PA n'est choisie au 26-11-2026 ; Nelson veut pouvoir choisir et connecter la PA dans Iris, note de la section 11.1), avant la fin de FE-4 ;
  - les réponses du cabinet utiles à FE-2 (Q-05, Q-22, Q-23) avant son début.
- **Point de contrôle proposé** : à la fusion de FE-3, comparer le reste à faire au temps restant et alerter Nelson si la recette est menacée.

## 9. Paquets

Nelson a cité quatre paquets, vérifiés le 19-11-2026. Revérification du 19-11-2026, à 13:58 UTC, par `npm view` (version, date, licence, dépréciation, étiquettes) :

| Paquet | Dernière version | Publiée le | Licence | Dépréciation | Étiquettes |
|---|---|---|---|---|---|
| `@e-invoice-eu/core` | 3.4.4 | 16-11-2026 | WTFPL | aucune | `latest` 3.4.4 |
| `@cantoo/pdf-lib` | 2.11.1 | 15-09-2026 | MIT | aucune | `latest` 2.11.1 ; `next` 2.2.3-0, plus ancienne |
| `fast-xml-parser` | 5.12.1 | 13-11-2026 | MIT | aucune | `latest` 5.12.1 ; `legacy` 4.5.7 |
| `xmllint-wasm` | 5.3.0 | 05-08-2026 | MIT | aucune | `latest` 5.3.0 ; `next` 6.0.0-rc.2 du 14-11-2026, préversion |
| `pdf-lib`, pour mémoire | 1.17.1 | 06-11-2021 | MIT | non marquée | `latest` 1.17.1 ; aucune version depuis ; écarté par Nelson (« pas pdf-lib, abandonné ») |

**Failles.** `npm audit` sur un `package.json` qui ne déclare que les quatre paquets, dans un dossier temporaire hors du dépôt (`npm install --package-lock-only --ignore-scripts`) : **0 vulnérabilité** (38 dépendances comptées par `npm audit`). Le fichier de verrouillage produit n'est pas versé au dépôt.

**Notes pour le lot qui installera.**
- `@e-invoice-eu/core` dépend de `@cantoo/pdf-lib` ^2.11.1, `xmlbuilder2`, `ajv` et `@e965/xlsx` (Apache-2.0). Sa licence WTFPL et celle de ses dépendances sont à confirmer avec la licence propriétaire d'Iris.
- `pdfkit` 0.20.2, déjà installé (`server/package.json:22`), sait produire un PDF/A et joindre un fichier avec `AFRelationship`. C'est une piste pour Factur-X à comparer dans FE-3.
- La décision d'installation revient au lot concerné, après une nouvelle vérification.

**Artefacts de validation** (section 2.2) : EN16931 `validation-1.3.17` (12-10-2026) ; FNFE-MPE `v1.4.0.04` (`97ba0f3`, 05-09-2026). Ce sont les dernières étiquettes au 19-11-2026.

## 10. Réception

**Ce qu'Iris a aujourd'hui** : aucun module de factures reçues.
- `AchatReel` (`schema.prisma:198-230`) est un coût saisi pour la marge d'un chantier : numéro de facture libre et facultatif, montant hors taxe seul. `CoutInterventionAchat` (`schema.prisma:344`) fait de même pour une intervention, sans numéro de facture.
- `Fournisseur` (`schema.prisma:89-99`) n'a qu'un nom et un contact, sans SIREN.
- Rien n'est importé ni stocké, et ces coûts ne passent pas en comptabilité.

**Proposition : une boîte de réception minimale** (FE-9).
- Récupération des factures fournisseurs par l'API de la PA (flux entrants), par interrogation périodique.
- Dédoublonnage : identifiant du flux, empreinte, et triplet numéro, année, SIREN du vendeur.
- Conservation de l'original et de la représentation lisible fournie par la PA (`Original`, `ReadableView`).
- Liste lisible : vendeur, numéro, date, montants, statut, alerte.
- Rattachement au fournisseur par SIREN, ce qui ajoute un SIREN facultatif au fournisseur ; sans correspondance, la facture reste à rattacher.
- Statuts acheteur : Prise en charge, Approuvée, En litige, Refusée, avec un motif de la liste officielle. Le refus rappelle ses trois cas permis (EX-28).
- Hors périmètre : comptabilisation des achats, lien avec les coûts des chantiers, circuit d'approbation à plusieurs niveaux.

**Question du périmètre à Nelson** : N-11.

## 11. Questions

### 11.1 Pour Nelson

Métier, périmètre, modèle de données et montants. Chaque question cite sa source et son enjeu. **Réponses du 20-11-2026** ([historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-20-11-2026-sur-la-facturation-électronique)) : N-01 (en partie), N-02 (en partie) et N-PA-1 sont répondues ; **réponses du 26-11-2026** ([historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-26-11-2026-facturation-électronique-lot-k)) : N-01 (lecture retenue : sans valeur propre à la société pilote écrite en dur), N-09 (en partie : type de client à cinq valeurs) et N-02 (précisée : la PA se choisit et se connecte) ; ce qui reste ouvert est écrit dans chaque ligne ; ce sont des réponses de Nelson et des lectures retenues par Claude Code (à corriger par Nelson si besoin), et non des décisions de lot : tout reste **prévu**. N-PA-1, née de FE-DOC (PR a, #624), est reportée à la suite de N-17 avec son identifiant, numéroté à part ; une question de plus pour Nelson, sans identifiant, attend le cadrage de FE-2 : une catégorie d'opération portée par chaque fiche du catalogue changerait le modèle de données ([liste de contrôle du déploiement, section 4.6](FACTURATION-ELECTRONIQUE-DEPLOIEMENT.md#46-catégorie-dopération-par-article)).

| N | Question | Source | Enjeu |
|---|---|---|---|
| N-01 | Faits de la société pilote : catégorie (GE, ETI, PME, micro), régime de TVA, option pour les débits. A-t-elle déjà une PA de réception ? **Réponse du 20-11-2026 (en partie)** : l'activité est connue (sûreté électronique, revente d'accès internet et télécom ; lecture retenue en section 3, à corriger par Nelson si besoin). **Reste ouvert** : catégorie d'entreprise, régime de TVA, option pour les débits, PA de réception. ([historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-20-11-2026-sur-la-facturation-électronique)) **Réponse du 26-11-2026** : « pourquoi avoir besoin de connaitre la societe pilote ? La societz pilote ne sera pas coder dans le dur ». Lecture retenue, à corriger par Nelson si besoin : catégorie, régime de TVA et option pour les débits sont des réglages de la société (FE-1), renseignés par chaque installation, sans valeur par défaut inventée ; leurs valeurs pour la société pilote ne servent qu'au calendrier et à la recette et se saisiront à la configuration ; **N-01 ne bloque plus aucun lot de code** ; la PA de réception relève de N-02. ([historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-26-11-2026-facturation-électronique-lot-k)) | Section 3 ; S3 §1.4.2 ; EX-35, EX-41 | Dates d'émission et d'e-reporting ; la réception est déjà obligatoire |
| N-02 | Quelle PA, et quand le contrat de bac à sable ? Offre-t-elle XP Z12-013 1.3.0 (Flow et Directory) ? Accepte-t-elle les statuts par son API ou en CDAR ? **Réponse du 20-11-2026 (en partie)** : aucune PA n'est encore choisie ni accessible ; Nelson veut pouvoir choisir la PA de connexion (lecture retenue pour FE-4 : choix dans l'écran Connecteurs, voir la fiche, à corriger par Nelson si besoin). **Reste ouvert** : la PA, le contrat de bac à sable, la version de la norme offerte, les statuts. ([historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-20-11-2026-sur-la-facturation-électronique)) **Réponse du 26-11-2026** : « pour la plateforme agree je voudrais qu'on puisse la choisir et pouvoir la connecter ». Lecture retenue, à corriger par Nelson si besoin : la PA se choisit et se connecte dans l'écran Connecteurs (FE-4), par un connecteur conforme à XP Z12-013, paramétré par installation ; aucune PA n'est écrite en dur ; un adaptateur propre à une PA reste réservé au cas du cadrage de Nelson (« seulement si la PA retenue n'implémente pas la norme, et sur ma décision », section 4.3). **Reste ouvert** : la PA de recette sur bac à sable et son contrat (chemin critique avant le 01-06-2027), avec l'existence d'une PA de réception de la société pilote, reprise de N-01 ; la version de la norme offerte et les statuts, qui dépendent de la PA retenue. ([historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-26-11-2026-facturation-électronique-lot-k)) | Cadrage ; EX-34, EX-50 | Chemin critique de la recette ; adaptateur propriétaire sur décision |
| N-03 | Facture rejetée : la lecture des sources vérifiées (numéro gardé, avoir interne `ARCHIVEONLY` dans la série des avoirs, nouvelle facture au numéro suivant) vous convient-elle, sous réserve du cabinet ? L'avoir interne est-il proposé à l'utilisateur ou créé automatiquement ? | S3 §2.2, §2.4 ; S2 BR-FR-CO-02, BR-FR-20 ; section 7 | Numérotation et immutabilité |
| N-04 | Facture refusée : même question. Iris doit-il permettre de contester le refus (facture maintenue, sans avoir) ? Qui en décide ? | S3 §2.5 et NOTE ; Q-03 | Cycle de correction ; droits |
| N-05 | Facture à 0,00 € rejetée ou refusée : Iris n'émet pas d'avoir à 0,00 € (« 5. si 0€ pas d'avoir, on ne fais pas d'avoir a 0€ », 10-11-2026, réponse à une question sur une ligne d'avoir) et refuse d'annuler une facture à 0,00 €, option choisie par Nelson le 10-11-2026 : « Refuser l'annulation (Recommandé) », décrite par Claude Code : « La facture à 0,00 € reste émise, sans rien à payer ; aucun avoir n'est créé. Le plus simple et le plus prudent. » Faut-il une exception pour l'avoir interne, ou le statut suffit-il ? | S3 §2.2, §2.5 ; [historique](HISTORIQUE-DECISIONS.md#décisions-du-10-11-2026-sur-les-avoirs) ; Q-25 | Montants ; deux décisions antérieures |
| N-06 | Facture rejetée ou refusée après un règlement ou un avoir partiel : avoir interne du reste, ou exception à la garde d'annulation totale ? La garde applique une règle de montants validée par Nelson le 17-10-2026 : « une facture qui a reçu un règlement ne s'annule plus en totalité ». Avec #524 (réponse de Nelson du 09-11-2026, citée en section 6, choix 4), un avoir du reste la rendrait « réglée ». Que devient le règlement reçu, qui ne peut plus donner d'Encaissée sur cette facture (S3 §2.5) et ne se reporte pas sur la nouvelle facture à sa date réelle (`reglements/routes.ts:91`) ? Et une facture au temps passé, dont la nouvelle facture attend l'avoir total (`factures/repere.ts:20-24`) ? Les avoirs partiels déjà transmis comptent-ils encore pour le pré-remplissage de TVA ? | S3 §2.5 ; `factures/routes.ts:449-455` ; section 7.2, points 5 et 10 à 12 ; [historique](HISTORIQUE-DECISIONS.md#lots-pilotes-livrés-état-dorigine) ; [historique](HISTORIQUE-DECISIONS.md#décisions-du-09-11-2026-sur-at-4) | Montants ; statut affiché ; décisions antérieures |
| N-07 | Fichier irrecevable : renvoyer le même fichier sous le même numéro si le défaut est technique ? Et si le défaut touche le contenu ? | S3 §2.1 ; Q-02 | Immutabilité |
| N-08 | La pièce transmise est figée. Le bloc « Règlements et avoirs » et la mention « Facture réglée par avoir(s) » (#534), comme la mention « FACTURE ANNULÉE », antérieure, ne peuvent plus modifier ce fichier. Le bloc et la mention de #534 appliquent les options choisies par Nelson le 10-11-2026 : « « Facture réglée par avoir(s) » (Recommandé) », « Dès qu'un avoir existe (Recommandé) » et « Oui, paiements et avoirs », décrite par Claude Code : « Le PDF liste tout ce qui a réglé la facture : paiements (date, moyen, montant) et avoirs. » Où les afficher : document de situation distinct, ou écran seul ? | EX-08, EX-46, EX-47 ; passation, section 4, bloc #534 ; [historique](HISTORIQUE-DECISIONS.md#décisions-du-10-11-2026-sur-le-détail-des-avoirs) | Montants affichés ; décisions du 10-11-2026 |
| N-09 | Type de client : remplacer la case « Pas de SIRET (particulier) » par une liste (B2B France, B2B UE, B2B hors UE, particulier, entité publique) ? Quel type pour une association à SIREN non assujettie ? **Réponse du 26-11-2026 (en partie)** : « remplace pas de siret par un type de client (B2B France, UE, hors UE, particulier, public) ». Lecture retenue, à corriger par Nelson si besoin : type de client à cinq valeurs, à appliquer par FE-1 (prévu). **Reste ouvert** : le type d'une association à SIREN non assujettie (posée à Nelson le 26-11-2026). ([historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-26-11-2026-facturation-électronique-lot-k)) | EX-02 ; S3 §1.1, §1.4.3 | Modèle de données ; circuit e-invoicing ou e-reporting |
| N-10 | La société facture-t-elle des entités publiques (Chorus Pro) ? | EX-04 ; S3 §1.1 | Lot FE-11 |
| N-11 | Réception : la boîte minimale de la section 10 suffit-elle ? Faut-il un lien avec les coûts des chantiers, une comptabilisation, un circuit d'approbation ? | Cadrage (« pose-moi la question du périmètre ») ; EX-35 | Périmètre de FE-9 |
| N-12 | L'acompte d'un devis est constaté sans facture (`schema.prisma:561-566`), exigé par défaut à 40 % (décisions du 17-11-2026), et n'est pas déduit de la facture définitive (passation, section 3, « Acompte et encaissé »). Selon S3 §3.2.19, « Tout assujetti est tenu de délivrer une facture pour les acomptes qui lui sont versés (article 289-I.1.c du CGI) », obligation antérieure à la réforme. Si le cabinet le confirme (Q-21), FE-12 est obligatoire : à quelle place le mener, avant ou après la recette ? La facture définitive reprend-elle l'acompte par une ligne de reprise ou par le montant déjà payé (BT-113), qui fausse le pré-remplissage de TVA selon S3 ? | EX-20, EX-22, EX-30 ; S3 §3.2.19, cas n°20, 21 ; Q-07, Q-21 | Montants ; place de FE-12 |
| N-13 | « prélèvements des contrats compris » : Iris n'a ni mandat, ni échéancier de facturation : un contrat ne porte « aucun prix, taux ou mécanisme de facturation » (`schema.prisma:1135`) ; une facture peut seulement lui être rattachée (origine contrat). Lot à créer, ou prélèvement saisi comme règlement (moyen `PRELEVEMENT`, `reglements/metier.ts:7`) ? | Cadrage ; EX-30 | Périmètre de FE-7 |
| N-14 | Canal B2B France : la PA dès l'activation du connecteur, ou le courriel jusqu'à la date d'obligation ? Après cette date, refuser d'émettre une facture B2B France sans connecteur actif ? | Cadrage ; EX-01 | Conformité de l'émission ; blocage possible |
| N-15 | Validation hors CI : un service de validation en conteneur, déployé avec Iris (choix proposé), saxon-js dans le processus, ou autre ? Iris refuse-t-il d'émettre si le service ne répond pas ? | Cadrage (« plutôt que saxon-js ») ; EX-07 | Architecture du déploiement |
| N-16 | Lieu de conservation des fichiers : base, stockage de l'instance, PA ? Sauvegarde ? | Cadrage (« durée et lieu ») ; EX-46 | Architecture ; FE-10 |
| N-17 | Montant et répartition par taux d'Encaissée, aucune règle n'étant inventée (à valider avec le cabinet, Q-08) : règlement partiel d'une facture à plusieurs taux, ou qui porte des avoirs partiels (S3 §2.6 : « Encaissée » sur la facture pour sa totalité et sur l'avoir en négatif, « Fortement Recommandé », ou « Encaissée » partiel de la facture seule ; même alternative pour l'e-reporting des encaissements des ventes B2B internationales, S3 cas n°43, §3.2.42.4) ; part d'un règlement au-delà du reste dû, qui devient un trop-perçu (règles de montants du 17-10-2026 ; #156) ; avoir émis après un règlement, qui crée un trop-perçu ; facture de cadre M, les données de paiement ne visant que les prestations de services (S3 cas n°31 ; Q-05). | S2 BR-FR-CDV-14, G7.45 ; S3 §2.1, §2.6, cas n°31, 43 (§3.2.42.4, relevé par le contrôle de cohérence de #620 dans [#622](https://github.com/OrizonLab/iris/issues/622) ; non relu dans S3 par la PR documentaire des compléments, #622 et #627) | Montants |
| N-PA-1 | Qui conclut le contrat avec la PA : la société de l'installation, en son nom, ou vous, pour son compte ? Pour le pilote, qui le signe ? **Répondue le 20-11-2026** : « la societé normalement » (lecture retenue : la société signe, c'est l'usage (non vérifié) ; le point juridique reste non vérifié, EX-49 ; à corriger par Nelson si besoin ; [historique](HISTORIQUE-DECISIONS.md#réponses-de-nelson-du-20-11-2026-sur-la-facturation-électronique)). | Cadrage (« PA choisie et contrat signé ») ; EX-49 (accord formel signé par l'assujetti ou son mandataire, non vérifié) ; [connexion à une PA, section 6](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md#6-questions-nouvelles) (née de #624) | Contrat ; changement de PA |

### 11.2 Pour le cabinet

Ces questions passent par Nelson, qui les porte au cabinet : « En cas d'ambiguïté, pose-moi la question : je la porte au cabinet » (cadrage du 19-11-2026, cité en section 1).

Q-01 à Q-19 reprennent l'inventaire réglementaire. Q-20 à Q-25 ajoutent les questions de cabinet restées dans le [paramétrage cible](PARAMETRAGE-CIBLE.md) (section 3.4) et celles nées de l'audit. Les doublons sont fusionnés : les mentions de la facturation électronique relèvent de Q-04 et Q-14, la conservation et la piste d'audit de Q-11 et Q-12. Q-PA-1 à Q-PA-3, nées de FE-DOC (PR a, #624), sont reportées à la suite de Q-25 avec leur identifiant, numéroté à part.

| Q | Question | Source | Enjeu |
|---|---|---|---|
| Q-01 | Une facture rejetée par une PA est-elle « émise », son numéro consommé ? Faut-il l'annuler par un avoir interne numéroté (`ARCHIVEONLY`), puis émettre une facture sous un nouveau numéro ? | S3 §2.2, §2.4 ; S2 BR-FR-20, CO-02 ; S8 | Numérotation |
| Q-02 | Un fichier irrecevable peut-il être renvoyé corrigé sous le même numéro ? | S3 §2.1 | Numérotation |
| Q-03 | Refus contesté : maintenir la facture sans avoir, avec un écart de TVA ? Sinon, avoir interne et facture identique à une nouvelle date ? | S3 §2.5, NOTE | Cycle de correction |
| Q-04 | Date d'application des quatre nouvelles mentions pour une PME qui n'émet qu'au 01-09-2027 | S13 ; S2 BR-FR-14 | Calendrier de FE-2 |
| Q-05 | Catégorie d'opération (B, S, M) des interventions SAV et de maintenance (pièces et main-d'œuvre, forfait, dépannage) et des travaux immobiliers ; opération principale et accessoire | S3 cas n°31 ; S2 BR-FR-08 | BT-23 ; FE-2 |
| Q-06 | Travaux immobiliers et sous-traitance du BTP : TVA à l'encaissement, Encaissée à chaque règlement, retenue de garantie ; option pour les débits ; autoliquidation (`AE`, mention, cadre S5) | S3 §2.1, cas n°13, 14, 34 ; S2 BR-FR-08, 15 | FE-2, FE-7 |
| Q-07 | Acomptes sur livraisons de biens : statut Encaissée obligatoire ? | S3 §2.1 et §3.2.19 ; S18 | FE-7, FE-12 |
| Q-08 | Montant d'Encaissée : TTC (`MEN`) ou net (P1.15) ? Escompte, frais bancaires, répartition par taux, forme après un avoir partiel (S3 §2.6 : l'alternative vaut-elle pour tout avoir partiel, et, pour l'e-reporting des encaissements des ventes B2B internationales, S3 cas n°43, §3.2.42.4 ?), trop-perçu, avoir après règlement, facture de cadre M, règlement d'une facture ensuite refusée (N-06, N-17) | S2 « CDV FE - CDAR » ; S3 §2.1, §2.5, §2.6, cas n°31, 43 | Montants ; FE-7 |
| Q-09 | Catégorie et régime de TVA de la société pilote : date d'émission et périodicité de l'e-reporting | S14, S17 | Calendrier |
| Q-10 | Périodicité et délais de l'e-reporting par régime ; données de paiement ; régime simplifié | S17, S18 | FE-8 |
| Q-11 | Conservation : durée, point de départ, détenteur (PA ou société), format, intégrité | S19, S14 | FE-10 |
| Q-12 | Piste d'audit fiable : reste-t-elle due quand les factures passent par une PA ? | S14 art. 289 | FE-10 |
| Q-13 | Factur-X BASIC WL : admis par l'arrêté ? jusqu'à quand ? | S16, S5, S3 §1.1 | Réception (FE-9) |
| Q-14 | Libellés en clair sur le lisible : option pour les débits, catégorie d'opération | S13 ; S2 BR-FR-MAP-03 | FE-3 |
| Q-15 | Client absent de l'annuaire : preuve de la bascule en B2C, risque s'il s'inscrit ; facture reçue hors circuit et déduction | S3 §1.4.3 ; S8 | FE-8, FE-9 |
| Q-16 | Changement de PA : base légale et contenu du service minimal de 12 mois | S3 §1.4.5.1 ; S17 | FE-DOC |
| Q-17 | Sanctions applicables ; portée de la tolérance de 2026 | S14 | Priorités |
| Q-18 | Corps des normes AFNOR : obtention, gratuité, opposition à la fouille de texte | S11 | Vérification des lots |
| Q-19 | Liste des « 34 données » de 2027 et correspondance avec les données d'Iris | S16, S20, S9 | FE-2 |
| Q-20 | Séries : série autonome des avoirs (préfixe « A »), avoir interne dans cette série, garde-fou des préfixes, remise à zéro annuelle, chronologie des avoirs non contrôlée (`factures/metier.ts:106-107`) | S2 G1.05 (BOI-TVA-DECLA-30-20-20-10, non lu), BR-FR-CO-02 ; [paramétrage cible](PARAMETRAGE-CIBLE.md), section 3.3 | Numérotation |
| Q-21 | Une facture d'acompte est-elle due pour chaque acompte reçu sur un devis ? | S14 art. 289 ; S3 cas n°20, 21 ; [paramétrage cible](PARAMETRAGE-CIBLE.md), section 3.4 | FE-12 |
| Q-22 | Pour chaque cas de 0 % de la société (autoliquidation, exonération, intracommunautaire, export, hors champ) : catégorie, motif d'exonération, mention | S2 BR-FR-15, CO-16 ; décision du 29-10-2026 ([historique](HISTORIQUE-DECISIONS.md#décisions-du-29-10-2026-nuit-sur-la-tva-française)) | FE-2 |
| Q-23 | Contenu des notes `PMT` (indemnité forfaitaire), `PMD` (pénalités), `AAB` (escompte ou son absence) | S2 BR-FR-05, 06 ; [paramétrage cible](PARAMETRAGE-CIBLE.md), section 3.4 | FE-2 |
| Q-24 | Le site d'une prestation est-il une « adresse de livraison » ? (« Ces données ne sont pas à transmettre pour les prestations de service ») | S2 BR-FR-14 | FE-2 |
| Q-25 | Une facture émise à 0,00 € se transmet-elle par la PA ? Faut-il l'annuler si elle est refusée ? | S3 §2.5 ; décision du 16-11-2026 (#568) | FE-5, FE-6 ; N-05 |
| Q-PA-1 | Une PA immatriculée sous réserve des tests d'interopérabilité (seconde liste de S10) peut-elle transmettre en production pour la société ? Que doit faire la société si cette réserve n'est pas levée ? | S10 (non vérifiée) ; [connexion à une PA, section 6](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md#6-questions-nouvelles) | Critère 1 du choix d'une PA |
| Q-PA-2 | La PA reçoit des données personnelles, notamment celles des clients particuliers. Quel est son rôle au regard du RGPD ? Faut-il un accord écrit sur ces données ? Des exigences de localisation et de sous-traitance ? | Aucune source du registre ; [connexion à une PA, section 6](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md#6-questions-nouvelles) | Points contractuels |
| Q-PA-3 | Si la PA est indisponible, perd son immatriculation ou se trompe (rejet à tort, statut non transmis), quelles clauses exiger ? Quelles obligations pèsent sur la société dans l'intervalle ? | S3 §1.4.5 ; Q-17 ; [connexion à une PA, section 6](FACTURATION-ELECTRONIQUE-CONNEXION-PA.md#6-questions-nouvelles) | Engagement de service ; continuité |

## 12. Points documentaires

Les 27 points de l'inventaire documentaire du lot 0, et leur traitement. Les points 5, 6, 8, 10, 20 et 24 sont faits par #626, la PR documentaire des points du lot 0 (19-11-2026, [historique](HISTORIQUE-DECISIONS.md#points-documentaires-du-lot-0-19-11-2026)) ; ailleurs, « cette PR » désigne la PR du lot 0 (#620). Les points 9, 15, 18 et 19 sont complétés le 22-11-2026 par la PR documentaire des compléments (#622, #627 ; [#627](https://github.com/OrizonLab/iris/issues/627), N1). Tout ce que ces points décrivent de la facturation électronique reste **prévu**.

| # | Point | Traitement |
|---|---|---|
| 1 | Documentation d'intégration : ajouter « Refusée », libellés officiels, obligatoires et facultatifs | Cette PR |
| 2 | Documentation d'intégration : calendrier daté, réception en vigueur, e-reporting | Cette PR |
| 3 | Nuancer « facture émise immuable » (intégration, principe 6 du paramétrage cible, `ADMINISTRATION-DOCUMENTS-EMAILS.md`, `CLAUDE.md`) | Intégration : cette PR. Autres documents : FE-5, après la réponse à N-08 |
| 4 | Intégration : « Chaque export est journalisé avec période » est faux | Cette PR (marqué prévu) |
| 5 | Intégration et vision : le courriel ne vaut plus transmission B2B ; ce qui est gardé | Intégration : #620. Vision : **fait** (#626) |
| 6 | Paramétrage cible et inventaire : relier A2 à la décision du 19-11-2026 | **Fait** (#626) : note datée dans chacun des deux documents |
| 7 | Vision : « échue », « partiellement réglée », « réglée » et « encaissée » | FE-7 |
| 8 | Paramétrage cible et inventaire : constats périmés depuis #217 et #300 | **Fait** (#626) : note datée dans chacun des deux documents (hors facturation électronique) |
| 9 | README, phase 8 | **Porteur : Claude Code** (note de #627, N1) : `README.md` est hors de `docs/`, et la PR documentaire du `documentaliste` n'écrit que dans `docs/` ; #625 et #626 l'excluaient. La ligne de la phase 8, avec #520, #524, #530, #534, #568 et #573 et leur statut, est écrite par Claude Code dans la PR documentaire des compléments (#622, #627) |
| 10 | `MODELE-DONNEES-CIBLE.md` : « transition manuelle actuelle « Réglée » » | **Fait** (#626) : phrase corrigée, avec ses sources |
| 11 | Issues #526 et #35 à mettre à jour | Commentaires d'état par Claude Code, hors de cette PR |
| 12 | Intégration : données structurées incomplètes | Cette PR, par renvoi à la section 5 |
| 13 | Intégration : état de chaque point de l'architecture | Cette PR |
| 14 | Réception à décrire ; PA de réception de la société pilote | Cette PR (intégration, sections 3 et 10 ; N-01) |
| 15 | E-reporting dans l'intégration et la passation | Intégration : cette PR. Passation : **fait**, dans la [passation](ROADMAP-PASSATION.md#1-état-actuel-par-domaine) (section 1, ligne « Absent : facturation électronique ») et dans la [section 2](ROADMAP-PASSATION.md#2-pilote) (bloc « Facturation électronique (A2) ») ; relevé le 22-11-2026 (#627, N1) |
| 16 | Clients publics absents des documents | Cette PR (N-10) |
| 17 | Facture d'acompte | Cette PR (N-12, Q-21) |
| 18 | Passation, section 3 : questions de cabinet | Cette PR (section 11.2). Passation : **fait**, la [section 3](ROADMAP-PASSATION.md#3-questions-ouvertes-pour-nelson) renvoie aux questions de cabinet (Q-01 à Q-25, que Nelson porte) sans les recopier ; relevé le 22-11-2026 (#627, N1) |
| 19 | Passation, section 3 : rejet et refus ; facture à 0,00 € refusée | Cette PR (section 7). Passation : **fait**, la [section 3](ROADMAP-PASSATION.md#3-questions-ouvertes-pour-nelson) renvoie à la section 7 de la proposition (N-03 à N-07) et la section 4 porte le bloc « Pas d'avoir à 0,00 € (#530) » (N-05) ; relevé le 22-11-2026 (#627, N1) |
| 20 | Passation, section 4 : compatibilité des choix « forts » | Section 6 : #620. Passation : **fait** (#626), une ligne « Facturation électronique » par bloc concerné |
| 21 | Paramétrage cible, décision 1 : état et lot | FE-1 |
| 22 | Droits cible : permissions du connecteur et de la réception | FE-4, FE-9, avec les lots de droits |
| 23 | Configuration : variables du connecteur | FE-4 (règle permanente 3) ; noms proposés en 8.3 |
| 24 | Historique : sources de l'ancien A2 (#153) et des règles du 17-10-2026 (#155) | **Fait** (#626) : sources citées dans l'historique |
| 25 | Liens `Noxia-Groupe/iris` au lieu de `OrizonLab/iris` | Hors facturation électronique : passage hebdomadaire du `controleur-coherence` |
| 26 | Documents à créer | Cette PR pour la proposition ; FE-DOC pour les deux autres |
| 27 | Sources officielles absentes des documents | Cette PR (section 2) |

## 13. Choix par défaut de cette proposition, à confirmer

1. Portée de la fusion (en-tête). Note du 26-11-2026 : lectures retenues sur N-01, N-02 et N-09 (en-tête et section 11.1), à corriger par Nelson si besoin.
2. Noms des lots, FE-0 à FE-12, et ordre de la section 8.4.
3. Données nouvelles exigées seulement à l'activation du connecteur : jusque-là, Iris se comporte comme aujourd'hui.
4. Validation dans la transaction d'émission, sur un numéro candidat : un échec ne consomme aucun numéro.
5. Factur-X comme format transmis par défaut.
6. Interrogation périodique par défaut ; webhook seulement s'il est signé.
7. Statut Iris et statut de la PA affichés séparément.
8. Droits : transmission et lecture des statuts comme l'émission et la consultation actuelles ; réception réservée à l'administration.
9. Noms des variables d'environnement proposés en 8.3, documentés par le lot qui les lit.
10. FE-DOC en deux PR, la première juste après FE-0.
11. `auditeur-montants` prévu pour FE-9 (montants des factures reçues) et FE-11 (données des factures publiques), en plus de l'`auditeur-droits-securite` (section 8.1 ; #622, N14).
12. Les compléments des fiches versés le 22-11-2026 par la PR documentaire des compléments (#622, #627) sont des mentions, des rappels et des questions : aucun ne crée une exigence ni ne tranche une question ouverte.
