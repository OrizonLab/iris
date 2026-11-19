# Iris — Microsoft 365, comptabilité et facturation électronique française

## Décision produit

Iris reste le système de référence des clients, devis, interventions, contrats, factures et paiements. Microsoft 365, le cabinet comptable, la banque et la plateforme de facturation électronique sont des **connecteurs**, jamais la source de vérité métier.

## Microsoft 365 via Microsoft Graph

### Identité

Tous les utilisateurs continuent de se connecter à Iris avec Microsoft Entra ID. Les autorisations Graph sont demandées séparément, avec consentement et moindre privilège.

### Calendrier Outlook — première intégration

Iris crée ou met à jour uniquement les événements qu'il gère : interventions, rendez-vous client et maintenances planifiées.

- permission déléguée : `Calendars.ReadWrite` ;
- événement créé dans le calendrier de l'utilisateur concerné ;
- Iris conserve l'identifiant Graph de l'événement pour modifier ou annuler le bon rendez-vous ;
- date, heure, durée prévisionnelle, client, site, intervenant et lien vers la fiche Iris sont synchronisés ;
- Iris ne synchronise pas tout le calendrier Outlook au départ : moins de bruit, moins de risques de conflit et meilleure confidentialité.

### E-mail et historique client — première intégration

Iris envoie les devis, factures, rappels et comptes rendus via le compte Microsoft de l'utilisateur.

- permission déléguée minimale : `Mail.Send` ;
- le message est sauvegardé dans les éléments envoyés Outlook de l'utilisateur ;
- Iris enregistre un journal de communication lié au client, contact, site et document concerné : date, expéditeur, destinataire, objet, identifiant Graph et statut d'envoi. **État au 19-11-2026** (lot 6, implémenté, non validé pour mise en service) : le journal des envois est lié au document envoyé et garde canal, destinataire, objet, auteur et date ; pour Microsoft 365, aussi l'expéditeur, le texte envoyé et l'empreinte SHA-256 du PDF joint ; l'identifiant Graph du message n'est pas conservé, l'envoi ne le rendant pas (l'en-tête `x-iris-envoi` en tient lieu) ;
- une copie PDF du devis ou de la facture est attachée ou référencée dans l'historique Iris. **État au 19-11-2026** : Iris ne garde pas de copie du PDF envoyé ; un envoi par Microsoft 365 n'en garde que l'empreinte, un envoi préparé par la messagerie rien (choix par défaut, à confirmer, en attendant la réponse à la question de la [passation](ROADMAP-PASSATION.md), section 3, bloc « Lot 6b ») ;
- le contenu d'une boîte de réception ne sera **pas aspiré** par défaut ;
- **facture B2B entre assujettis établis en France** : dès la date d'obligation d'émission de la société, la facture part par la plateforme agréée, et le courriel n'est plus qu'une copie d'information (cadrage de Nelson du 19-11-2026, mot pour mot : « B2B domestique : la facture part par la PA. Dès la date d'obligation de la société, l'e-mail n'est plus qu'une copie d'information. » ; **prévu**, lot FE-5 de la [proposition](FACTURATION-ELECTRONIQUE-CIBLE.md)).

Pour les e-mails entrants, la première version proposera l'action explicite **« Ajouter à l'historique Iris »**. Une synchronisation automatisée ou une boîte support partagée est une évolution optionnelle, nécessitant une décision RGPD, une politique de rétention et des autorisations dédiées (`Mail.Read`).

## Comptabilité externe

Iris ne tente pas de remplacer le logiciel de l'expert-comptable au lancement. Il produit des données comptables propres et paramétrables.

### Paramétrage par installation

- plan de comptes de vente par famille d'articles/prestations ;
- comptes TVA par taux et règles fiscales ;
- compte client collectif et règles de ventilation ;
- journaux de ventes, règlements et banque ;
- codes analytiques éventuels ;
- format/export sélectionné pour le cabinet : CSV structuré d'abord, adaptateurs Sage/Cegid/EBP ensuite selon besoin réel.

Une facture émise est immuable : une correction passe par avoir ou document correctif, jamais par réécriture silencieuse. Ses lignes, montants, mentions et identités sont figés en base ; son PDF, lui, est recalculé à chaque demande avec la situation de paiement du moment (#534). La pièce transmise à la plateforme agréée sera produite une fois et conservée (**prévu**, [proposition](FACTURATION-ELECTRONIQUE-CIBLE.md), section 6). Journaliser chaque export avec période, écritures et statut est **prévu** : l'export actuel n'est ni journalisé ni découpé par période.

## Facturation électronique française

La cible détaillée, la matrice de conformité, le découpage en lots et les questions ouvertes sont dans la proposition [`FACTURATION-ELECTRONIQUE-CIBLE.md`](FACTURATION-ELECTRONIQUE-CIBLE.md), en revue. Ce qui suit en est le résumé ; tout y est **prévu**, sauf mention contraire.

### Rôle de la plateforme agréée

Iris est une **solution compatible**, et non une plateforme agréée (PA) : il produit, valide, reçoit et suit les factures. La PA choisie par la société, une par installation :
- transmet ses factures et avoirs à la PA du client ;
- reçoit ses factures fournisseurs ;
- transmet à l'administration les données de facture, les statuts obligatoires et l'e-reporting ;
- inscrit ses adresses de réception à l'annuaire.

Iris lui parle par son API (norme XP Z12-013), sans agrément ni immatriculation (décision de Nelson du 19-11-2026).

### Calendrier (lecture au 19-11-2026, textes légaux non vérifiés)

- **01-09-2026** : réception par une plateforme agréée obligatoire pour toutes les entreprises assujetties établies en France, **en vigueur** ; émission et e-reporting obligatoires pour les grandes entreprises et les ETI.
- **01-09-2027** : émission et e-reporting obligatoires pour les PME et les micro-entreprises.
- L'e-reporting couvre les ventes aux particuliers, les opérations B2B internationales et les données de paiement.

Les règles exactes dépendent du statut fiscal et doivent être validées avec le cabinet comptable de chaque client au déploiement. Sources et niveau de vérification : [proposition](FACTURATION-ELECTRONIQUE-CIBLE.md), sections 2 et 3.

### Architecture Iris à prévoir dès le module Facturation

État au 19-11-2026 : le point 1 est **partiel** (numérotation continue, figement en base et avoirs implémentés ; pièce transmise non conservée, piste d'audit fiable non documentée) ; les points 2 à 8 sont **prévus**.

1. Numérotation continue et contrôlée, documents figés après émission, avoirs et piste d'audit.
2. Données structurées complètes : SIREN/SIRET, TVA, adresses facturation, lignes, taxes, conditions de paiement, références documentaires (liste complète : [proposition](FACTURATION-ELECTRONIQUE-CIBLE.md), section 5).
3. Génération interne d'un modèle canonique de facture, indépendant du PDF et de tout prestataire.
4. Exports **Factur-X**, **UBL** et **CII** selon les profils requis par la réforme, validés avant l'attribution du numéro.
5. Adaptateur `ElectronicInvoicingProvider` : une plateforme agréée (PA, anciennement PDP) par installation, connectée par l'API normalisée XP Z12-013 et activée par `SUPERADMIN` dans l'écran Connecteurs ; Iris ne se lie pas au code d'un seul prestataire.
6. Journal des statuts de cycle de vie, dans les deux sens, avec la preuve de la PA et l'horodatage : les quatre statuts obligatoires **Déposée**, **Rejetée**, **Refusée** et **Encaissée**, et les statuts facultatifs utiles (Mise à disposition, Prise en charge, Approuvée, En litige…). Une facture rejetée ou refusée affiche une alerte avec son motif.
7. E-reporting (ventes aux particuliers, opérations B2B internationales, paiements) et consultation de l'annuaire, par l'adaptateur de plateforme.
8. Réception : la réception légale est assurée par la PA de la société ; Iris récupère les factures fournisseurs par son API, les conserve et pose les statuts acheteur (Prise en charge, Approuvée, En litige, Refusée avec un motif de la liste officielle). Le périmètre (boîte de réception minimale ou module achats) est une question pour Nelson.

## Garde-fous de simplicité

- D'abord envoyer un devis, planifier une intervention et facturer clairement.
- Une seule fiche chronologique client, alimentée par des événements liés, pas par une copie complète de la boîte Outlook.
- Un écran « Connecteurs » par installation : Microsoft 365, banque, cabinet comptable, plateforme agréée (**prévu** : aucun écran n'existe au 19-11-2026).
- Chaque connecteur est facultatif, activable par `SUPERADMIN`, et son absence ne bloque pas le travail quotidien. Pour la plateforme agréée, émettre une facture B2B sans connecteur actif après la date d'obligation est une question ouverte ([proposition](FACTURATION-ELECTRONIQUE-CIBLE.md), N-14).
- Les permissions Microsoft sont minimales et demandées progressivement, au moment où la fonction est activée.
