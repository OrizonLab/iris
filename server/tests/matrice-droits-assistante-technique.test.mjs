// Lot « Assistante technique », PR AT-1 (cadrage version 2.1, section « PR AT-1 », « Tests » : « clé AT ajoutée à la matrice
// des droits (comptes.mjs, 11 types, 16 comptes), références régénérées, et un test fermé « AT = encadrement SAV » sur le
// modèle de matrice-droits-directeur.test.mjs »).
//
// Décisions appliquées : décisions de Nelson du 24-10-2026, points 15, 16, 18 et 28 (« Les droit de toute la partie
// technique », planning compris ; crée l'intervention de suivi liée), section « lots prévus », point 2 (toute la société) ;
// réponses de Nelson du 06-11-2026 : 2 (« Décochée (Recommandé) » : ni vendu, ni marge, ni estimation), 4 (« Prix d'achat
// oui, coûts non » : ni taux horaire ni coût de main-d'œuvre) et 7 (« Oui, comme le conducteur (Recommandé) » : matériel
// SAV saisi, corrigé et archivé comme le conducteur). Fermetures d'AT-1 (cadrage, « Fermé à AT-1 ») : écritures des
// chantiers, devis, contrats, saisies Travaux, factures ; Statistiques, Performances et Mes commerciaux (choix par défaut,
// à confirmer) ; refus du nouveau middleware sur la fiche, le statut et le commercial d'une affaire.
//
// Chaque référence versionnée de la matrice des droits (lot D1a, server/tests/matrice-droits/*.txt) est comparée au
// caractère près au comportement réel par son propre fichier de test. Ce fichier-ci vérifie, dans ces références, que la
// colonne AT est celle d'un compte de l'encadrement SAV, ligne par ligne, selon une règle FERMÉE par route :
//  - par défaut, AT a la ligne du conducteur (CT) : planning, référentiels des achats, lectures et refus communs ;
//  - sur les routes de « toute la société » (ROUTES_COMME_AD : SAV entier et affaires en lecture), AT a la ligne de
//    l'administration (AD), ses montants réduits à ceux du conducteur : une liste fermée de montants et de clés que AD lit
//    et que AT ne lit pas (rentabilité, coût prévu, taux et coût de main-d'œuvre, marges du SAV), chacun nul ou absent
//    pour AT, tous les autres montants dans l'état d'AD ;
//  - sur une suite rattachée à une affaire clôturée, AT a la ligne de CT (verifierAffaireDeLaSuite : seule
//    l'administration y écrit encore) ; avec un droit individuel sur les saisies Travaux, celle de l'assistante
//    commerciale (AC), sans affaire à elle (assertChantierWritable reste une liste fermée) ;
//  - une liste fermée de refus nommés (REFUS) : message exact, aucune écriture.
// Les entrées de journal sont nommées par leur auteur : « par AD » ou « par CT » est lu « par AT » avant la comparaison.
//
// PR AT-2a « Devis, clients et contrats » (cadrage AT-2, version 1, section « AT-2a », et version 2, C1 à C4, T1 à T3 et
// N10 ; réponses de Nelson du 06-11-2026, 3, 4, 5, 8 et 9, docs/HISTORIQUE-DECISIONS.md#décisions-du-06-11-2026-sur-lassistante-technique).
// La règle fermée s'étend, route par route, sans règle nouvelle :
//  - « comme AD » (ROUTES_COMME_AD_AT2A) : les devis (droit devis par son type, prix d'achat prévu lu et écrit), les
//    écritures des clients et la lecture du parc (gereLesClients), la gestion des contrats, passage manuel de la
//    génération compris (gereLesContrats) ; dans les réponses d'écriture des références échantillonnées, les montants de
//    MONTANTS_MASQUES_AT y restent nuls ou absents pour AT (coût prévu de la réponse de conversion : piège P1, il suit sa
//    rentabilité, fermée jusqu'à AT-2b) ;
//  - refus nommés au message exact (« Accès réservé aux administrateurs », sans écriture) : acompte et annulation d'un
//    devis, création d'un contrat hors devis, couverture, réglages (anticipation), écriture du parc, routes du catalogue ;
//  - droits individuels : ceux qu'elle porte désormais par son type (devis) ne lui ajoutent rien, comme à l'administration.
//
// PR AT-2b « Chantiers, saisies Travaux et rentabilité » (cadrage AT-2, versions 1 et 3, et version 4, qui fait foi : R1, C1,
// C5 et N4 ; réponses de Nelson du 06-11-2026, 1, 2, 5 et 10, et du 07-11-2026, 1 à 3,
// docs/HISTORIQUE-DECISIONS.md#décisions-du-07-11-2026-sur-at-2b). La règle fermée s'étend, route par route :
//  - « comme AD sur une affaire en cours, comme CT sur une affaire clôturée » (ROUTES_EN_COURS_AT2B : fiche, commercial et
//    saisies Travaux d'une affaire en cours de toute la société, client du chantier compris, gereLesChantiersEnCours) ; sur
//    un chantier clôturé, AT a la ligne de CT, son titulaire (refus du conducteur : seule l'administration y écrit) ; une
//    affaire annulée reste refusée comme à AD (409) ;
//  - exceptions nommées : le statut envoyé à la fiche est ignoré en silence (R1 : « 200 inchangé », là où AD reçoit 400
//    depuis le correctif « saisie des montants refusée plutôt que faussée », #289) ; le
//    vendu ne s'écrit que sous son réglage (C5 (a) : refus « Le montant vendu n’est modifiable… » hors du contexte
//    RENTABILITE_AT) ;
//  - refus nommé reformulé sur …/statut, même titulaire (piège P2) ; l'encaissement et l'archivage (chantiers:archive non donné,
//    choix par défaut, à confirmer) gardent la ligne de CT ;
//  - contexte RENTABILITE_AT (réglage rentabiliteAssistantesTechniques coché, N4) : la rentabilité et le coût prévu ne lui sont
//    plus masqués (RENTABILITE_ASSISTANTES_TECHNIQUES.ouvre), la facturation de la fiche (R1 de la v3, permanente depuis AT-3) et le coût
//    de main-d'œuvre, ses taux et les hypothèses de coût de l'estimation le restent (C5 (c)) ;
//  - droits individuels : chantiers:write, porté par son type, ne lui ajoute rien ; chantiers:archive, donné individuellement,
//    lui ouvre l'archivage et la restauration comme à AD sur une affaire en cours, et lui laisse le refus de CT sur une affaire
//    clôturée.
//
// PR AT-3 « Factures » (cadrage AT-3, version 2 ; T6 du contrôle de cohérence de mode 1 ; décisions de Nelson du 24-10-2026,
// points 27, 30, 33, 34 et 36, réponse 6 du 06-11-2026, réponses 1 et 2 du 09-11-2026). Le jeu de données porte désormais des
// pièces de son poste (facture-at-brouillon, facture-at-emise, avoir-facture-at ; facture-brouillon-deux-taux-at dans
// factures.txt). La règle fermée s'étend, route par route :
//  - routes ouvertes (ROUTES_FACTURES_AT3, requireGestionFactures) : sur une pièce de son poste, sans pièce désignée (liste,
//    chronologie, création) ou sur une intervention (facture au temps passé), la ligne d'AD (« par AD » lu « par AT ») ; sur une
//    pièce de l'administration ou absente, « 404 « Facture introuvable. » », sans écriture, avant tout 409 (T4), sauf le 400 d'un
//    corps vide, contrôlé avant la pièce comme pour AD ; l'envoi d'un avoir de son poste, « 403 « L’envoi d’un avoir est réservé
//    à l’administration. » » là où AD envoie ;
//  - liste des factures (donnees.txt, « éléments ») : la ligne d'AD réduite à ses pièces et à leurs avoirs ;
//  - routes restées à l'administration (points 30 et 36 ; cadrage v1 « Restent à l'administration ») : refus nommés, « 403
//    « Accès réservé aux administrateurs » », sans écriture.
//
// PR AT-4 « Avoirs et repère « déjà facturée » » (cadrage AT-4, version 2 ; N11 du contrôle de cohérence de mode 1 ; message de
// Nelson du 09-11-2026, « Oui il faut un repere deja facturer, elle peut egalement faire un avoir, », et réponses 1 à 4 du même
// jour). La règle fermée s'étend, route par route :
//  - l'avoir partiel et l'annulation (POST /api/factures/:id/avoirs et /annuler, requireGestionFactures) rejoignent les routes
//    ouvertes : la ligne d'AD sur une pièce de son poste ; sur une pièce de l'administration ou absente, « 404 « Facture
//    introuvable. » », sans écriture, avant tout refus propre à la pièce (C2), sauf le 400 du corps vide d'entrees.txt, lu avant
//    la pièce ; dans factures.txt, où le corps est valide, un 400 de l'administration (taux absent de la facture) est propre à
//    la pièce, et elle reçoit le 404 ;
//  - le repère « déjà facturée » (GET /api/factures/deja-facturee, requireGestionFactures) : la ligne d'AD ;
//  - l'envoi d'un avoir de son poste n'est plus refusé (choix par défaut 5 d'AT-3 remplacé) : la ligne d'AD ;
//  - les sept autres types reçoivent le refus de requireGestionFactures sur ces trois routes.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RENTABILITE_ASSISTANTES_TECHNIQUES } from './matrice-droits/montants-masques.mjs';

const DOSSIER = join(dirname(fileURLToPath(import.meta.url)), 'matrice-droits');
const SEPARATEUR = ' | ';
// Nombre de champs de la clé d'une ligne (compte compris), comme le fichier de test de chaque référence (champsCle).
const CHAMPS_CLE = { 'donnees.txt': 5, 'individuels.txt': 6, 'individuels-sans-gain.txt': 6 };
const INDIVIDUELS = ['individuels.txt', 'individuels-sans-gain.txt'];
// Références où les lectures (GET) nomment l'entrée de journal lue (« … par X ← X route … ») : la lecture d'une entrée
// par AT est comparée à celle d'AD, qui lit toutes les entrées.
const LECTURES_DES_JOURNAUX = ['journaux.txt', 'factures.txt', 'montants.txt'];
// Références où un compte refusé à l'entrée d'une route n'est pas rejoué (cadrage de D1a-5b et suivants) : AT n'y a pas de
// ligne sur une route de REFUS, là où CT en a.
const SANS_REFUS_REJOUES = ['ecritures-modifications.txt', 'montants.txt', 'journaux.txt', 'factures.txt'];
// Références échantillonnées : chaque cas y est joué par une liste de comptes qui lui est propre (SA, AD et un compte hors
// administration qui écrit le couple, cadrage de D1a-5c §2.1 ; comptes admis des 8 groupes, D1a-5d-2). AT n'y est jouée que
// sur ses cas (SAV, droits devis individuels) : chacune de ses lignes est comparée à celle d'AD sur le même cas, ou de SA si
// seul SA le joue parmi l'administration (restauration du matériel archivé par AD), ou de CT hors des routes de toute la
// société ; un cas joué par d'autres et non par elle n'est pas un écart.
const ECHANTILLONS = ['journaux.txt', 'montants.txt'];
const REFERENCES = ['cles-montants.txt', 'cles.txt', 'donnees.txt', 'ecritures-actions.txt', 'ecritures-modifications.txt', 'entrees.txt', 'factures.txt', 'individuels-sans-gain.txt', 'individuels.txt', 'journaux.txt', 'montants.txt'];

// --- Règle fermée par route ---

// « Toute la société » : SAV entier (voitToutLeSav, estEncadrementCoutIntervention, estEncadrementSuivi) et affaires en
// lecture (litToutesLesAffaires : liste, fiche, journal des saisies, historique client, journaux des achats et des heures).
const ROUTES_COMME_AD = new Set([
  'GET /api/chantiers', 'GET /api/chantiers/:id', 'GET /api/chantiers/:id/journal-saisies', 'GET /api/clients/:id/chantiers', 'GET /api/achats', 'GET /api/heures',
  'GET /api/interventions', 'GET /api/interventions/journee', 'GET /api/interventions/:id', 'GET /api/interventions/:id/couts', 'GET /api/interventions/:id/envois',
  'GET /api/interventions/:id/journal-saisies', 'GET /api/interventions/:id/document.pdf', 'GET /api/planning/events', 'GET /api/planning/interventions-a-planifier',
  'POST /api/interventions', 'PATCH /api/interventions/:id/statut', 'POST /api/interventions/:id/rapports', 'POST /api/interventions/rapports/:rapportId/signature',
  'POST /api/interventions/:id/envois', 'POST /api/interventions/:id/remise-a-planifier', 'POST /api/interventions/:id/suites', 'PUT /api/interventions/:id/a-suivre',
  'PUT /api/interventions/:id/planning', 'POST /api/interventions/:id/couts/achats', 'POST /api/interventions/:id/couts/heures', 'PATCH /api/interventions/:id/couts/:type/:coutId',
  'POST /api/interventions/:id/couts/:type/:coutId/:action',
]);
// AT-2a : devis (réponse 3 : « Tous, contrats compris » ; aucun périmètre sur les devis), écritures des clients (décision du
// 24-10-2026, point 24 : « gerer les client ») et parc en lecture (réponse 8 ; requireGestionClients), contrats et
// génération des visites (réponses 3 et 9 ; requireGestionContrats).
const ROUTES_COMME_AD_AT2A = [
  'GET /api/devis', 'POST /api/devis', 'PATCH /api/devis/:id', 'POST /api/devis/:id/revisions', 'POST /api/devis/:id/signature', 'GET /api/devis/:id/document.pdf',
  'GET /api/devis/:id/envois', 'POST /api/devis/:id/envois', 'PUT /api/devis/:id/statut', 'POST /api/devis/:id/convertir', 'GET /api/devis/a-convertir',
  'POST /api/devis/:id/duplication', 'GET /api/devis/catalogue',
  'POST /api/clients', 'PUT /api/clients/:id', 'DELETE /api/clients/:id', 'POST /api/clients/:clientId/contacts', 'PUT /api/clients/:clientId/contacts/:id',
  'POST /api/clients/:clientId/sites', 'PUT /api/clients/:clientId/sites/:id', 'GET /api/clients/:clientId/equipements',
  'GET /api/contrats-maintenance', 'GET /api/contrats-maintenance/generation-visites', 'POST /api/contrats-maintenance/generation-visites',
  'GET /api/contrats-maintenance/:id/journal-saisies', 'GET /api/contrats-maintenance/:id/document.pdf', 'GET /api/contrats-maintenance/:id/envois',
  'POST /api/contrats-maintenance/:id/envois', 'PATCH /api/contrats-maintenance/:id/statut', 'POST /api/contrats-maintenance/:id/avancer-echeance',
  'POST /api/contrats-maintenance/:id/generer-intervention',
];
for (const route of ROUTES_COMME_AD_AT2A) ROUTES_COMME_AD.add(route);
// AT-2b (cadrage v1, « Chantiers » et « Saisies Travaux » ; v3, réponse 3 du 07-11-2026 ; v4, C1) : fiche (client compris),
// titulaire, commercial et saisies Travaux des affaires en cours de toute la société (gereLesChantiersEnCours).
const ROUTES_EN_COURS_AT2B = ['PATCH /api/chantiers/:id', 'PATCH /api/chantiers/:id/commercial', 'POST /api/achats', 'POST /api/heures', 'PATCH /api/achats/:id', 'PATCH /api/heures/:id'];
for (const route of ROUTES_EN_COURS_AT2B) ROUTES_COMME_AD.add(route);
// Cibles portées par une affaire clôturée (chantier terminé, encaissé ou non ; ses achats et ses heures) : la ligne de CT, son
// titulaire, refusé hors administration.
const CIBLE_CLOTUREE = /(^|[=-])chantier-termine(-encaisse)?$/;
const CIBLE_ANNULEE = /(^|[=-])chantier-annule$/;
// Contexte de la matrice où le réglage de rentabilité des assistantes techniques est coché (N4 du contrôle d'AT-2b).
const RENTABILITE_AT = RENTABILITE_ASSISTANTES_TECHNIQUES.contexte;
const sousReglageAt = (contexte) => (contexte ?? '').startsWith(RENTABILITE_AT);
// Droits individuels qu'elle porte par son type depuis AT-2a (DEFAULT_USER_PERMISSIONS) : ils ne lui ajoutent rien, comme à
// l'administration ; ses lignes « type + droit » sont donc celles d'AD (aucune, sauf écart).
const DROITS_PORTES_AT2A = ['droit devis', 'devis:read', 'devis:write'];

// Refus d'AT-1 sur la fiche, le statut et le commercial, retiré par AT-2b : il ne doit plus figurer dans aucune référence.
const REFUS_AFFAIRE = 'Un compte assistante technique n’est pas autorisé à modifier une affaire.';
// AT-2b (cadrage v1, « Chantiers » ; piège P2) : la clôture et la réouverture lui restent refusées, même titulaire.
const REFUS_STATUT = 'Un compte assistante technique n’est pas autorisé à clôturer ni à rouvrir une affaire.';
// Vendu écrit sans le réglage (chantiers/routes.ts, PATCH /api/chantiers/:id ; cadrage v4, C5 (a)).
const REFUS_VENDU = 'Le montant vendu n’est modifiable que par qui suit la rentabilité de ce chantier.';
const REFUS_CLOTURE_SAISIES = 'Ce chantier est clôturé : impossible d\'y ajouter une dépense ou des heures.';
const REFUS_TRAVAUX = 'Accès réservé au suivi Travaux.';
const REFUS_ECRITURE_TRAVAUX = 'Permission requise : chantiers:write';
const REFUS_ADMINISTRATION = 'Accès réservé aux administrateurs';
// Refus de la gestion des clients et des contrats (requireGestionClients, requireGestionContrats ; message exact du cadrage
// AT-2a), reçu par chaque autre compte hors administration.
const REFUS_GESTION = 'Accès réservé à l’administration et à l’assistante technique.';
// Refus nommés, route par route (message exact) : la ligne d'AT est ce refus, sans écriture, quel que soit le contexte par
// défaut (les contextes « droit chantiers:… » suivent la règle d'AC, plus bas).
// AT-2b retire la fiche, le commercial et les saisies Travaux de cette liste (ROUTES_EN_COURS_AT2B) et reformule le refus du
// statut.
const REFUS = {
  // AT-3 : routes des factures restées à l'administration (requireAdmin ; points 30 et 36, cadrage v1 « Restent à
  // l'administration », choix par défaut à confirmer pour « à régler » et « Prêt à facturer »). AT-4 en retire l'annulation et
  // les avoirs partiels (ROUTES_FACTURES_AT4) ; « réglée » à la main et les règlements restent ici (réponse 1 du 09-11-2026,
  // « Les règlements lui restent fermés »).
  'GET /api/factures/a-regler': REFUS_ADMINISTRATION,
  'GET /api/facturation/prete-a-facturer': REFUS_ADMINISTRATION,
  'GET /api/factures/export-comptable.csv': REFUS_ADMINISTRATION,
  'GET /api/mentions-legales': REFUS_ADMINISTRATION,
  'POST /api/mentions-legales': REFUS_ADMINISTRATION,
  'POST /api/mentions-legales/:version/publier': REFUS_ADMINISTRATION,
  'POST /api/factures/:id/regler': REFUS_ADMINISTRATION,
  'GET /api/reglements': REFUS_ADMINISTRATION,
  'POST /api/reglements': REFUS_ADMINISTRATION,
  'POST /api/reglements/:id/contrepasser': REFUS_ADMINISTRATION,
  'PATCH /api/chantiers/:id/statut': REFUS_STATUT,
  'GET /api/stats/conducteurs': REFUS_TRAVAUX,
  'GET /api/stats/conducteurs/assiduite': REFUS_TRAVAUX,
  'GET /api/stats/fournisseurs': REFUS_TRAVAUX,
  'GET /api/stats/intervenants': REFUS_TRAVAUX,
  'GET /api/stats/types-chantiers': REFUS_TRAVAUX,
  // AT-2a, restés à l'administration (requireAdmin) : acompte et annulation d'un devis (cadrage, « Devis ») ; création hors
  // devis et couverture d'un contrat, réglage de l'anticipation (C1, choix par défaut, à confirmer) ; écriture du parc et
  // routes du catalogue (C2, choix par défaut, à confirmer).
  'POST /api/devis/:id/acompte': REFUS_ADMINISTRATION,
  'POST /api/devis/:id/annulation': REFUS_ADMINISTRATION,
  'POST /api/contrats-maintenance': REFUS_ADMINISTRATION,
  'PATCH /api/contrats-maintenance/:id': REFUS_ADMINISTRATION,
  'PUT /api/parametres': REFUS_ADMINISTRATION,
  'POST /api/clients/:clientId/equipements': REFUS_ADMINISTRATION,
  'POST /api/clients/:clientId/equipements/:id/archiver': REFUS_ADMINISTRATION,
  'GET /api/catalogue/:family': REFUS_ADMINISTRATION,
  'POST /api/catalogue/:family': REFUS_ADMINISTRATION,
  'PUT /api/catalogue/:family/:id': REFUS_ADMINISTRATION,
  'DELETE /api/catalogue/:family/:id': REFUS_ADMINISTRATION,
};
// AT-3 : routes des factures ouvertes à l'assistante technique (requireGestionFactures), et pièces de son poste dans le jeu de
// données (donnees.mjs) et dans les cibles propres de factures.txt.
const ROUTES_FACTURES_AT3 = new Set([
  'GET /api/factures', 'GET /api/factures/chronologie', 'GET /api/factures/:id/document.pdf', 'GET /api/factures/:id/envois', 'POST /api/factures/:id/envois',
  'GET /api/factures/:id/journal', 'GET /api/factures/:id/reglements', 'GET /api/factures/:id/tracabilite', 'POST /api/factures', 'POST /api/factures/:id/emettre',
  'GET /api/interventions/:id/facture-temps-passe', 'POST /api/interventions/:id/facture-temps-passe',
]);
// AT-4 (cadrage v2, § 1 et 2) : avoir partiel, annulation et repère « déjà facturée », ouverts comme les routes d'AT-3.
const ROUTES_FACTURES_AT4 = ['POST /api/factures/:id/annuler', 'POST /api/factures/:id/avoirs', 'GET /api/factures/deja-facturee'];
for (const route of ROUTES_FACTURES_AT4) ROUTES_FACTURES_AT3.add(route);
const PIECES_AT = ['facture-at-brouillon', 'facture-at-emise', 'avoir-facture-at', 'facture-brouillon-deux-taux-at'];
// Routes des pièces (paramètre :id de la famille « facture ») : sur une pièce hors de son poste, 404 avant tout refus du document.
const ROUTES_PIECE_AT3 = [...ROUTES_FACTURES_AT3].filter((route) => route.includes('/api/factures/:id/'));
const INTROUVABLE = '404 « Facture introuvable. »';
// Refus de l'envoi d'un avoir d'AT-3 (choix par défaut 5), retiré par AT-4 : il ne doit plus figurer dans aucune référence.
const REFUS_ENVOI_AVOIR_AT3 = 'L’envoi d’un avoir est réservé à l’administration.';
// Liste des factures lue par AT (donnees.txt, lignes « éléments ») : les éléments d'AD qui sont des pièces de son poste, leurs
// avoirs, leurs lignes et leur ventilation, nommés par leur cible ou par un libellé de l'assistante. « (sans libellé) » nomme la
// ventilation d'une pièce sans cible : AD en lit deux (facture-avoir et facture-at-avoir, « ×2 »), AT une seule, celle de
// facture-at-avoir (jeu de données fermé, donnees.mjs).
const elementsDeSonPoste = (ligneAd) => ligneAd.split(', ')
  .map((element) => (/^\(sans libellé\)( ×\d+)?$/.test(element) ? '(sans libellé)' : element))
  .filter((element) => /assistante|facture-at-|avoir-facture-at/.test(element) || ['(sans libellé)', '(aucun)'].includes(element))
  .join(', ') || '(aucun)';
// Suites d'une affaire clôturée : AT reçoit le refus de CT (verifierAffaireDeLaSuite), et non l'écriture d'AD.
const CIBLES_AFFAIRE_CLOSE = ['suite-affaire-close', 'materiel-suite-affaire-close', 'heures-suite-affaire-close'];
// Droit devis par son type depuis AT-2a (réponse 3 du 06-11-2026), saisies Travaux (chantiers:write) depuis AT-2b (réponse 10) ;
// jamais chantiers:archive (choix par défaut, à confirmer).
const VALEURS_ME = 'role=ASSISTANTE_TECHNIQUE ; accesFinance=non ; permissions=chantiers:read+chantiers:write+clients:read+devis:read+devis:write';

// --- Montants et clés que AD lit et que AT ne lit pas (liste fermée), sur les routes de ROUTES_COMME_AD ---
// Rentabilité (voitRentabilite : vendu, marges, estimation, facturation), coût prévu (voitCoutPrevuParPrixAchat), taux et coût
// de main-d'œuvre (voitCoutMainOeuvre), marge du devis et d'un SAV hors contrat (administration seule).
const MONTANTS_MASQUES_AT = [
  'budgetGlobalVendu', 'coutMaterielPrevu', 'facturation',
  'metrics.margeBrute', 'metrics.margeCommerciale', 'metrics.margePct', 'metrics.margeEstimee', 'metrics.margeEstimeePct', 'metrics.estimation',
  'metrics.moReel', 'metrics.totalDepenses', 'metrics.pctMainOeuvre', 'metrics.coutsSuites.coutMainOeuvre', 'metrics.coutsInterventionDevis.coutMainOeuvre',
  'pointages[].tauxHoraireApplique', 'pointages[].intervenant.tauxHoraireCharge', 'tauxHoraireApplique', 'intervenant.tauxHoraireCharge',
  'avant.tauxHoraireApplique', 'apres.tauxHoraireApplique', 'avant.prixVenteHoraireApplique', 'apres.prixVenteHoraireApplique',
  'heures[].tauxHoraireApplique', 'heures[].prixVenteHoraireApplique', 'totalMainOeuvreHT', 'totalCoutsHT', 'margeDevis', 'margeSav',
];
// Un champ sous un objet masqué l'est avec lui (l'estimation entière, et ses coûts).
const sousObjetMasque = (champ) => champ.startsWith('metrics.estimation.');
// AT-2b, contexte RENTABILITE_AT : la rentabilité et le coût prévu lui sont ouverts ; restent masqués la facturation, le coût de
// main-d'œuvre, ses taux et les hypothèses de coût de l'estimation (présente), soit RENTABILITE_ASSISTANTES_TECHNIQUES.masque
// avec les autres montants de la liste d'AT-1 (marges du SAV, totaux des coûts d'une intervention).
const MONTANTS_MASQUES_AT_REGLAGE = [...MONTANTS_MASQUES_AT.filter((c) => !RENTABILITE_ASSISTANTES_TECHNIQUES.ouvre.includes(c)), ...RENTABILITE_ASSISTANTES_TECHNIQUES.masque.filter((c) => !MONTANTS_MASQUES_AT.includes(c))];
const masqueAt = (contexte, champ) => (sousReglageAt(contexte) ? MONTANTS_MASQUES_AT_REGLAGE.includes(champ) : MONTANTS_MASQUES_AT.includes(champ) || sousObjetMasque(champ));
// Montants que AT lit comme AD et CT (budgets par poste, matériel, achats, matériel SAV) : jamais masqués pour elle. Leur
// présence chez AT, là où AD les a, est vérifiée par la comparaison ; cette liste sert au témoin et au résumé.
const MONTANTS_LUS_AT = ['budgetMaterielVendu', 'budgetMainOeuvreVendu', 'metrics.materielReel', 'metrics.pctMateriel', 'metrics.coutsSuites.materiel', 'metrics.coutsInterventionDevis.materiel', 'achats[].montantHT', 'montantHT', 'avant.montantHT', 'apres.montantHT', 'achats', 'totalMaterielHT'];
const CLES_MASQUEES_AT = ['facturation', 'tauxHoraireApplique', 'tauxHoraireApplique?', 'tauxHoraireCharge', 'prixVenteHoraireApplique', 'prixVenteHoraireApplique?', 'margeDevis', 'margeSav'];
const OBJETS_MASQUES_AT = ['.facturation', '[].metrics.estimation', '.metrics.estimation', '.margeSav', '.margeDevis', '.margeDevis.devis'];
// Sous le réglage coché (AT-2b), l'estimation lui est ouverte : seuls ses coûts de main-d'œuvre restent masqués (champs).
const OBJETS_MASQUES_AT_REGLAGE = OBJETS_MASQUES_AT.filter((o) => !o.endsWith('.metrics.estimation'));

function lire(fichier) {
  return readFileSync(join(DOSSIER, fichier), 'utf8').split('\n').filter(Boolean);
}

// Lignes d'un compte : clé (sans le compte) → reste de la ligne.
function lignesDe(fichier, compte) {
  const n = CHAMPS_CLE[fichier] ?? 4;
  const lignes = new Map();
  for (const ligne of lire(fichier)) {
    const champs = ligne.split(SEPARATEUR);
    if (champs[0] !== compte) continue;
    const cle = champs.slice(1, n).join(SEPARATEUR);
    assert.ok(!lignes.has(cle), `${fichier} : deux lignes de ${compte} pour ${cle}`);
    lignes.set(cle, champs.slice(n).join(SEPARATEUR));
  }
  return lignes;
}

// Réponses à l'entrée d'AD et d'AT (entrees.txt), pour la règle nommée de chantiers:archive donné individuellement (AT-2b).
const ENTREES = { AD: lignesDe('entrees.txt', 'AD'), AT: lignesDe('entrees.txt', 'AT') };

// « par AD » ou « par CT » (et non « par AD-COM », « par CT-N1 ») lu « par AT ».
const commeAt = (valeur, auteur) => valeur?.replace(new RegExp(`\\bpar ${auteur}(?![\\w-])`, 'g'), 'par AT');
// « champ=état, champ=état, … » → Map.
const etats = (valeur) => new Map(valeur.split(', ').map((morceau) => { const i = morceau.indexOf('='); return [morceau.slice(0, i), morceau.slice(i + 1)]; }));
const MASQUE = ['null', 'absent'];

// Ligne attendue d'AT à partir de celle d'AD, sur une route de toute la société, pour donnees.txt : rend { attendu } (ligne
// exacte, ou undefined pour une ligne absente) ou { verifier } (fonction qui rend la liste des défauts).
function attenduDonneesCommeAd(objet, ad, contexte = 'défaut') {
  if (ad === undefined) return { attendu: undefined };
  if (objet.startsWith('clés ')) {
    const chemin = objet.slice('clés '.length);
    if ((sousReglageAt(contexte) ? OBJETS_MASQUES_AT_REGLAGE : OBJETS_MASQUES_AT).includes(chemin)) return { attendu: undefined };
    return { attendu: ad.split(', ').filter((cle) => !CLES_MASQUEES_AT.includes(cle)).join(', ') };
  }
  if (objet.startsWith('montants')) {
    return {
      verifier: (at) => {
        if (at === undefined) return ['ligne absente pour AT'];
        const a = etats(ad); const t = etats(at);
        const defauts = [];
        for (const champ of new Set([...a.keys(), ...t.keys()])) {
          const ea = a.get(champ) ?? 'absent'; const et = t.get(champ) ?? 'absent';
          if (masqueAt(contexte, champ)) {
            if (!MASQUE.includes(et)) defauts.push(`${champ} devrait être masqué pour AT (${et})`);
          } else if (ea !== et) defauts.push(`${champ} différent hors des montants masqués (AD ${ea}, AT ${et})`);
        }
        return defauts;
      },
    };
  }
  return { attendu: ad };
}

// Références échantillonnées (journaux, montants), routes de toute la société : la ligne d'AD, sauf dans la partie
// « réponse : champ état, … » des écritures, où chaque montant de MONTANTS_MASQUES_AT présent pour AD est nul ou absent pour
// AT (AT-2a : coût prévu de la réponse de conversion, piège P1) ; tout le reste au caractère près. Rend une fonction qui
// liste les défauts. Une ligne d'AD absente : la ligne d'AT doit l'être aussi.
function verifierReponseCommeAd(ad, contexte = 'défaut') {
  const parties = (ligne) => {
    const m = /^(.*? ; réponse : )(.*?)( ; .*)?$/.exec(ligne);
    return m ? { avant: m[1], champs: new Map(m[2].split(', ').map((x) => { const i = x.lastIndexOf(' '); return [x.slice(0, i), x.slice(i + 1)]; })), apres: m[3] ?? '' } : null;
  };
  return (at) => {
    if (ad === undefined && at === undefined) return [];
    if (ad === undefined || at === undefined) return [`ligne d’AD ${ad ?? '(absente)'} ; ligne d’AT ${at ?? '(absente)'}`];
    const pa = parties(ad); const pt = parties(at);
    // Sans montant de réponse relevé : au caractère près. Même ligne qu'AD : les montants masqués y sont encore vérifiés.
    if (!pa && !pt) return at === ad ? [] : [`ligne différente de celle d’AD\n  AD ${ad}\n  AT ${at}`];
    if (!pa || !pt || pa.avant !== pt.avant || pa.apres !== pt.apres) return [`ligne différente de celle d’AD hors des montants de la réponse\n  AD ${ad}\n  AT ${at}`];
    const defauts = [];
    for (const champ of new Set([...pa.champs.keys(), ...pt.champs.keys()])) {
      const ea = pa.champs.get(champ) ?? 'absent'; const et = pt.champs.get(champ) ?? 'absent';
      if (masqueAt(contexte, champ)) { if (!MASQUE.includes(et)) defauts.push(`${champ} devrait être masqué pour AT dans la réponse (${et})`); } else if (ea !== et) defauts.push(`${champ} différent dans la réponse (AD ${ea}, AT ${et})`);
    }
    return defauts;
  };
}

// Règle d'une ligne d'AT : rend { modele, attendu?, verifier?, absentAdmis? } pour la clé donnée.
function regle(fichier, cle, lignes) {
  const champs = cle.split(SEPARATEUR);
  const individuel = INDIVIDUELS.includes(fichier);
  const droit = individuel ? champs[0] : null;
  const route = individuel ? champs[1] : champs[0];
  const cible = individuel ? champs[2] : champs[1];
  const contexte = individuel ? champs[3] : champs[2];
  const objet = fichier === 'donnees.txt' ? champs[3] : null;
  // Droits individuels : AT a les gains de CT ; depuis AT-2a, le droit devis, qu'elle porte par son type, ne lui ajoute rien,
  // comme au commercial, qui le porte aussi par son type sans lire les comptes (aucune ligne). AT-2b : chantiers:write, porté par
  // son type (réponse 10 du 06-11-2026), ne lui ajoute rien (aucune ligne, règle nommée) ; chantiers:archive, non
  // donné par son type, lui ouvre, donné individuellement, l'archivage et la restauration sur les affaires en cours de toute la
  // société (réponse d'AD à l'entrée), et la laisse refusée sur une affaire clôturée (refus de CT, titulaire) : règle nommée.
  if (individuel) {
    if (DROITS_PORTES_AT2A.includes(droit)) return { modele: 'COM', attendu: lignes.COM.get(cle) };
    if (droit === 'chantiers:write') return { modele: 'nommé', attendu: undefined };
    if (droit === 'chantiers:archive' && champs[4] === 'entrée') {
      const cleEntree = [route, cible, contexte].join(SEPARATEUR);
      const avant = ENTREES.AT.get(cleEntree);
      const apres = CIBLE_CLOTUREE.test(cible) ? `403 « ${REFUS_CLOTURE_SAISIES} »` : ENTREES.AD.get(cleEntree);
      // La ligne est dans individuels.txt (gain) ou individuels-sans-gain.txt (changement sans gain) : sa présence dans l'un
      // des deux est vérifiée par le test « droits individuels d'AT-2b ».
      return { modele: 'nommé', verifier: (at) => (at === undefined || at === `${avant} → ${apres}` ? [] : [`attendu « ${avant} → ${apres} » (AT « ${at} »)`]) };
    }
    return { modele: 'CT', attendu: lignes.CT.get(cle) };
  }
  // Contextes « droit chantiers:archive » des écritures (droits individuels sans gain rejoués) : depuis AT-2b, la réponse d'AD au
  // même corps (contexte « défaut ») sur une affaire en cours, celle de CT sur une affaire clôturée. « droit chantiers:write »
  // n'a plus de ligne pour elle (droit porté par son type) : une ligne est un écart.
  if (/^droit chantiers:archive/.test(contexte ?? '') && !(LECTURES_DES_JOURNAUX.includes(fichier) && route.startsWith('GET '))) {
    if (CIBLE_CLOTUREE.test(cible)) return { modele: 'CT', attendu: commeAt(lignes.CT.get(cle), 'CT') };
    const ad = commeAt(lignes.AD.get(cle.replace(/\| droit chantiers:archive,/, '| défaut,')), 'AD');
    if (ECHANTILLONS.includes(fichier)) return { modele: 'AD', verifier: verifierReponseCommeAd(ad), absentAdmis: true };
    return { modele: 'AD', attendu: ad };
  }
  if (/^droit chantiers:write/.test(contexte ?? '') && !route.startsWith('GET ')) return { modele: 'nommé', attendu: undefined };
  // Lectures des entrées de journal : comme AD, qui lit toutes les entrées.
  if (LECTURES_DES_JOURNAUX.includes(fichier) && route.startsWith('GET ')) {
    return { modele: 'AD', attendu: lignes.AD.get(cle), absentAdmis: true };
  }
  if (fichier === 'donnees.txt' && route === 'GET /api/me' && objet === 'valeurs') return { modele: 'nommé', attendu: VALEURS_ME };
  // AT-3 : routes des factures ouvertes (voir l'en-tête).
  if (ROUTES_FACTURES_AT3.has(route)) {
    const ad = commeAt(lignes.AD.get(cle), 'AD');
    if (ROUTES_PIECE_AT3.includes(route) && !PIECES_AT.includes(cible)) {
      // Hors de son poste : aucune donnée ; 404 à l'entrée et aux écritures, sauf le 400 du corps vide (contrôlé avant la pièce).
      // factures.txt joue des corps valides : un 400 de l'administration y est propre à la pièce (taux absent de la facture,
      // AT-4), et le 404 le précède (C2 du contrôle de mode 1 d'AT-4).
      if (fichier === 'donnees.txt') return { modele: 'nommé', attendu: undefined };
      if (ad?.startsWith('400') && fichier !== 'factures.txt') return { modele: 'AD', attendu: ad };
      // Références échantillonnées (journaux, montants) : AT n'y joue pas ces cas ; une ligne d'elle, s'il y en a, est ce 404.
      return { modele: 'nommé', verifier: (at) => ((at === undefined && ECHANTILLONS.includes(fichier)) || at === INTROUVABLE || at?.startsWith(`${INTROUVABLE} inchangé`) ? [] : [`404 « Facture introuvable. » attendu (AT « ${at} »)`]) };
    }
    // AT-4 : l'envoi d'un avoir de son poste suit la ligne d'AD (le refus d'AT-3 est retiré ; règle commune ci-dessous).
    if (fichier === 'donnees.txt' && route === 'GET /api/factures' && objet.startsWith('éléments ')) return { modele: 'nommé', attendu: ad === undefined ? undefined : elementsDeSonPoste(ad) };
    if (fichier === 'donnees.txt') return { modele: 'AD', ...attenduDonneesCommeAd(objet, ad, contexte) };
    // journaux.txt : elle émet le brouillon de son poste (facture-at-brouillon), là où l'administration émet le sien
    // (facture-brouillon) : la ligne d'AD sur celui-ci, « par AD » lu « par AT ».
    if (ECHANTILLONS.includes(fichier) && ad === undefined && route === 'POST /api/factures/:id/emettre' && cible === 'facture-at-brouillon') {
      return { modele: 'AD', verifier: verifierReponseCommeAd(commeAt(lignes.AD.get([route, 'facture-brouillon', contexte].join(SEPARATEUR)), 'AD'), contexte) };
    }
    if (ECHANTILLONS.includes(fichier)) return { modele: 'AD', verifier: verifierReponseCommeAd(ad, contexte), absentAdmis: true };
    return { modele: 'AD', attendu: ad, absentAdmis: fichier === 'factures.txt' };
  }
  if (REFUS[route]) {
    const message = `403 « ${REFUS[route]} »`;
    return {
      modele: 'refus',
      verifier: (at) => {
        if (at === undefined) {
          // Lecture refusée : aucune donnée ; écriture refusée à l'entrée : non rejouée dans ces références.
          if (fichier === 'donnees.txt' || SANS_REFUS_REJOUES.includes(fichier)) return [];
          return ['ligne absente pour AT'];
        }
        if (at === message || at === `${message} inchangé` || at.startsWith(`${message} inchangé ;`)) return [];
        return [`refus attendu ${message} (AT « ${at} »)`];
      },
    };
  }
  if (ROUTES_COMME_AD.has(route)) {
    if (CIBLES_AFFAIRE_CLOSE.includes(cible)) return { modele: 'CT', attendu: commeAt(lignes.CT.get(cle), 'CT') };
    // AT-2b : sur une affaire clôturée, la ligne de CT, son titulaire (seule l'administration y écrit encore).
    if (ROUTES_EN_COURS_AT2B.includes(route) && CIBLE_CLOTUREE.test(cible)) return { modele: 'CT', attendu: commeAt(lignes.CT.get(cle), 'CT') };
    // R1 du cadrage v4 : le statut envoyé à la fiche d'une affaire en cours est ignoré en silence (AD, lui, reçoit 400 depuis
    // le correctif « saisie des montants refusée plutôt que faussée », #289).
    if (route === 'PATCH /api/chantiers/:id' && /corps statut=TERMINE seul$/.test(contexte) && !CIBLE_ANNULEE.test(cible)) return { modele: 'nommé', attendu: '200 inchangé' };
    // C5 (a) du cadrage v4 : le vendu ne s'écrit que sous son réglage ; hors du contexte RENTABILITE_AT, refusé sans écriture.
    if (route === 'PATCH /api/chantiers/:id' && /corps montant vendu$/.test(contexte) && !sousReglageAt(contexte) && !CIBLE_ANNULEE.test(cible)) {
      return { modele: 'nommé', verifier: (at) => (at?.startsWith(`403 « ${REFUS_VENDU} » inchangé ;`) ? [] : [`refus du vendu attendu (AT « ${at} »)`]) };
    }
    // Contexte RENTABILITE_AT (N4) : lignes « clés » et « éléments » écrites seulement si elles diffèrent de celles du contexte par
    // défaut du même compte ; celle d'AT est celle d'AD dans ce contexte (ou, à défaut, par défaut), réduite par les masques du
    // réglage, et absente si elle est celle d'AT par défaut.
    if (fichier === 'donnees.txt' && sousReglageAt(contexte) && /^(clés|éléments) /.test(objet)) {
      const cleDefaut = [route, cible, 'défaut', objet].join(SEPARATEUR);
      const { attendu } = attenduDonneesCommeAd(objet, commeAt(lignes.AD.get(cle) ?? lignes.AD.get(cleDefaut), 'AD'), contexte);
      return { modele: 'AD', attendu: attendu === lignes.AT.get(cleDefaut) ? undefined : attendu };
    }
    // Contexte RENTABILITE_AT des références échantillonnées, joué par AT seule (réponse de conversion, heures) : la ligne d'AD au
    // même corps, contexte « défaut ».
    if (ECHANTILLONS.includes(fichier) && sousReglageAt(contexte) && !lignes.AD.has(cle)) {
      return { modele: 'AD', verifier: verifierReponseCommeAd(commeAt(lignes.AD.get(cle.replace(`${RENTABILITE_AT},`, 'défaut,')), 'AD'), contexte), absentAdmis: true };
    }
    if (ECHANTILLONS.includes(fichier) && !lignes.AD.has(cle)) return { modele: 'SA', attendu: commeAt(lignes.SA.get(cle), 'SA'), absentAdmis: true };
    const ad = commeAt(lignes.AD.get(cle), 'AD');
    // factures.txt rejoue chaque corps de l'administration par les seuls comptes refusés à l'entrée : depuis AT-2a, elle
    // écrit les clients (écriture indirecte « client renommé ») et n'y est plus jouée ; une ligne d'AT, s'il y en a, est celle
    // d'AD.
    if (fichier === 'factures.txt' && ROUTES_COMME_AD_AT2A.includes(route)) return { modele: 'AD', attendu: ad, absentAdmis: true };
    if (ECHANTILLONS.includes(fichier)) return { modele: 'AD', verifier: verifierReponseCommeAd(ad, contexte), absentAdmis: true };
    if (fichier === 'donnees.txt') return { modele: 'AD', ...attenduDonneesCommeAd(objet, ad, contexte) };
    return { modele: 'AD', attendu: ad };
  }
  return { modele: 'CT', attendu: commeAt(lignes.CT.get(cle), 'CT') };
}

function comparer(fichier) {
  const lignes = { AT: lignesDe(fichier, 'AT'), AD: lignesDe(fichier, 'AD'), CT: lignesDe(fichier, 'CT'), AC: lignesDe(fichier, 'AC'), SA: lignesDe(fichier, 'SA'), COM: lignesDe(fichier, 'COM') };
  const defauts = [];
  const parModele = {};
  const cles = new Set([...lignes.AT.keys()]);
  // Clés des modèles sur les routes qu'AT ne peut ignorer : une ligne de CT (par défaut) ou d'AD (toute la société) sans
  // ligne d'AT est un écart, sauf refus non rejoué ou lecture de journal.
  for (const modele of ['AD', 'CT']) for (const cle of lignes[modele].keys()) cles.add(cle);
  for (const cle of cles) {
    const r = regle(fichier, cle, lignes);
    const at = lignes.AT.get(cle);
    // Une clé d'un autre modèle que celui de la règle ne concerne pas AT (ex. : ligne d'AD sur une route où AT suit CT).
    if (at === undefined && r.modele !== 'refus' && !['nommé'].includes(r.modele)) {
      const source = lignes[r.modele]?.get(cle);
      if (source === undefined) continue;
      if (r.absentAdmis) continue;
      // Références échantillonnées : un cas de CT que AT ne joue pas n'est pas un écart.
      if (ECHANTILLONS.includes(fichier)) continue;
    }
    parModele[r.modele] = (parModele[r.modele] ?? 0) + (at === undefined ? 0 : 1);
    if (r.verifier) {
      for (const d of r.verifier(at)) defauts.push(`${fichier} : ${cle} (${r.modele}) : ${d}`);
    } else if (r.attendu !== at) {
      defauts.push(`${fichier} : ${cle} (règle ${r.modele})\n  attendu ${r.attendu}\n  AT      ${at}`);
    }
  }
  return { defauts, parModele, nombre: lignes.AT.size };
}

describe('Assistante technique (AT-1, AT-2a, AT-2b, AT-3, AT-4) : la colonne AT de chaque référence de la matrice des droits est celle de l’encadrement SAV, route par route, puis celle de l’administration sur les devis, les clients et les contrats, sur les affaires en cours (fiche, commercial, saisies Travaux) et sur les factures de son poste, avoirs et annulation compris, sa rentabilité selon son réglage', () => {
  test('références de la matrice : celles attendues, ni plus ni moins (une nouvelle référence doit être classée ici)', () => {
    assert.deepEqual(readdirSync(DOSSIER).filter((f) => f.endsWith('.txt')).sort(), [...REFERENCES].sort());
  });

  for (const fichier of REFERENCES) {
    test(`${fichier} : chaque ligne d’AT suit sa règle (CT par défaut, AD sur toute la société sans rentabilité, coût prévu ni main-d’œuvre, refus nommés)`, (t) => {
      const { defauts, parModele, nombre } = comparer(fichier);
      assert.deepEqual(defauts, [], `${fichier} : colonne AT hors de la règle fermée`);
      t.diagnostic(`${fichier} : ${nombre} ligne(s) d’AT ; par règle : ${Object.entries(parModele).map(([m, n]) => `${m} ${n}`).join(', ') || 'aucune'}`);
    });
  }

  // La règle n'est pas vide : AT est jouée là où les autres comptes le sont, et chaque famille de la règle s'applique.
  test('AT est jouée dans chaque référence où CT l’est, et chaque famille de la règle (AD, CT, AC, refus) s’applique au moins une fois', () => {
    const familles = new Set();
    for (const fichier of REFERENCES) {
      const at = lignesDe(fichier, 'AT'); const ct = lignesDe(fichier, 'CT');
      // individuels.txt (gains) : depuis AT-2a, le droit devis est porté par son type ; depuis AT-2b, chantiers:write aussi. Seul
      // chantiers:archive, donné individuellement, lui ajoute un gain (archivage et restauration sur une affaire en cours de toute
      // la société) ; l'assistante commerciale, sans affaire, n'y a toujours pas de ligne.
      if (fichier === 'individuels.txt') {
        assert.ok(at.size > 0 && [...at.keys()].every((cle) => cle.startsWith('chantiers:archive | ')), `${fichier} : un gain d’AT est à classer (${[...at.keys()].join(' ; ')})`);
        assert.equal(lignesDe(fichier, 'AC').size, 0, `${fichier} : témoin, l’assistante commerciale n’y a pas de ligne`);
        continue;
      }
      if (ct.size) assert.ok(at.size > 0, `${fichier} : CT y est joué, AT non`);
      for (const [m, n] of Object.entries(comparer(fichier).parModele)) if (n) familles.add(m);
    }
    // AT-2b : la règle d'AC (droits chantiers:write et chantiers:archive sans affaire à elle) ne s'applique plus ; ses saisies
    // Travaux suivent AD ou CT selon l'affaire.
    assert.deepEqual([...familles].sort(), ['AD', 'CT', 'SA', 'nommé', 'refus']);
    // Les onze types et les cinq variantes : seize comptes joués (cadrage, « 11 types, 16 comptes »).
    // PUBLIC : le lien public du planning, joué sans session.
    const comptes = new Set(lire('entrees.txt').map((ligne) => ligne.split(SEPARATEUR)[0]).filter((c) => !['ANONYME', 'JETON-INVALIDE', 'DESACTIVE', 'SYSTEME', 'SUPPRIME', 'PUBLIC'].includes(c)));
    assert.equal(comptes.size, 16, [...comptes].sort().join(', '));
    assert.ok(comptes.has('AT'));
  });

  // Ouvertures du cadrage (T3 du contrôle), lues dans la référence des entrées : planning (lecture, créneaux, types, file),
  // référentiels des achats (POST, PUT, DELETE), SAV de toute la société, affaires en lecture ; et les refus du cadrage (T1).
  test('entrees.txt : ouvertures et refus du cadrage AT-1, lus ligne à ligne', () => {
    const at = lignesDe('entrees.txt', 'AT');
    const ligne = (route, cible = '—', contexte = 'défaut') => at.get([route, cible, contexte].join(SEPARATEUR));
    // Ouvertures : admises à l'entrée (2xx, ou 400/404/500 après la garde, jamais 401 ni 403).
    for (const [route, cible] of [
      ['POST /api/fournisseurs'], ['PUT /api/fournisseurs/:id', 'fournisseur'], ['DELETE /api/fournisseurs/:id', 'inexistant'],
      ['POST /api/categories'], ['PUT /api/categories/:id', 'categorie'], ['DELETE /api/categories/:id', 'inexistant'],
      ['GET /api/planning/events'], ['POST /api/planning/events'], ['PATCH /api/planning/events/:id', 'inexistant'], ['DELETE /api/planning/events/:id', 'inexistant'],
      ['GET /api/planning/types'], ['POST /api/planning/types'], ['PUT /api/planning/types/:id', 'type-planning'], ['DELETE /api/planning/types/:id', 'inexistant'],
      ['GET /api/planning/interventions-a-planifier'], ['GET /api/chantiers'], ['GET /api/chantiers/:id', 'chantier-autre'], ['GET /api/chantiers/:id/journal-saisies', 'chantier-autre'],
      ['GET /api/stats/global'], ['GET /api/interventions/:id', 'intervention-autre'], ['POST /api/interventions'],
    ]) {
      const valeur = ligne(route, cible);
      assert.ok(valeur !== undefined, `${route} ${cible ?? ''} : ligne absente`);
      assert.doesNotMatch(valeur, /^40[13]/, `${route} ${cible ?? ''} : ${valeur}`);
    }
    // Refus du cadrage, message exact. Ceux d'AT-1 sur la fiche et les saisies Travaux sont levés par AT-2b (réponses 5 et 10 du
    // 06-11-2026) : la fiche d'une affaire en cours lui est ouverte (200), le 404 d'un chantier inexistant n'est plus précédé
    // d'un refus de type, et la saisie d'un achat passe la garde des droits (400 du corps vide). Le statut garde son refus,
    // reformulé (piège P2).
    assert.equal(ligne('GET /api/stats/conducteurs'), `403 « ${REFUS_TRAVAUX} »`);
    assert.equal(ligne('PATCH /api/chantiers/:id', 'chantier-ct'), '200');
    assert.equal(ligne('PATCH /api/chantiers/:id', 'inexistant'), '404 « Chantier introuvable »', 'plus de refus de type avant le 404');
    assert.equal(ligne('PATCH /api/chantiers/:id/statut', 'chantier-ct'), `403 « ${REFUS_STATUT} »`);
    assert.equal(ligne('POST /api/achats'), '400 validation-avant-droit');
    assert.equal(ligne('GET /api/chantiers/:id/document.pdf', 'chantier-ct'), '403 « Accès réservé aux administrateurs »');
    assert.match(ligne('POST /api/planning/share'), /^403 « Accès réservé aux administrateurs »/);
    assert.match(ligne('PATCH /api/users/:id/est-commercial', 'inexistant'), /^403 « Accès réservé aux administrateurs »/);
    // Factures : fermées en AT-1, ouvertes par AT-3 pour les pièces de son poste (test « AT-3 » plus bas) : la liste lui répond
    // 200 et la création passe la garde (400 du corps vide). La liste des contrats et les devis, fermés en AT-1, s'ouvrent avec
    // AT-2a (test suivant) ; la création d'un contrat hors devis reste à l'administration.
    assert.equal(ligne('GET /api/factures'), '200');
    assert.equal(ligne('POST /api/factures'), '400');
    assert.match(ligne('POST /api/contrats-maintenance'), /^403 « Accès réservé aux administrateurs »/);
    // Module Planning coupé : fermé à AT comme aux autres comptes.
    assert.match(ligne('GET /api/planning/events', '—', 'planningActif=non'), /^403 PLANNING_DESACTIVE/);
  });

  // PR AT-2a (cadrage v1, « AT-2a », et v2, C1 et C2 ; réponses 3, 4, 5, 8 et 9 du 06-11-2026) : ouvertures et refus lus dans la
  // référence des entrées ; le refus des gardes de la gestion des clients et des contrats, au message exact, pour chaque autre
  // compte hors administration, et l'administration et le directeur admis comme elle.
  test('entrees.txt : ouvertures et refus du cadrage AT-2a (devis, clients et parc en lecture, contrats et génération ; acompte, annulation, contrat hors devis, couverture, anticipation, écriture du parc et catalogue à l’administration), lus ligne à ligne', () => {
    const at = lignesDe('entrees.txt', 'AT');
    const ligne = (route, cible = '—', contexte = 'défaut', lignes = at) => lignes.get([route, cible, contexte].join(SEPARATEUR));
    // Ouvertures : admises à l'entrée (2xx, ou 400/404/409 après la garde, jamais 401 ni 403).
    const OUVERTURES = [
      ['GET /api/devis'], ['POST /api/devis'], ['PATCH /api/devis/:id', 'devis-brouillon'], ['PUT /api/devis/:id/statut', 'devis-brouillon'], ['POST /api/devis/:id/signature', 'devis-brouillon'],
      ['POST /api/devis/:id/convertir', 'devis-signe'], ['GET /api/devis/catalogue'], ['GET /api/devis/a-convertir'], ['GET /api/devis/:id/document.pdf', 'devis-signe'],
      ['POST /api/clients'], ['PUT /api/clients/:id', 'client-actif'], ['DELETE /api/clients/:id', 'inexistant'], ['POST /api/clients/:clientId/contacts', 'client-actif'],
      ['PUT /api/clients/:clientId/contacts/:id', 'contact-client-actif'], ['POST /api/clients/:clientId/sites', 'client-actif'], ['PUT /api/clients/:clientId/sites/:id', 'site-client-actif'],
      ['GET /api/clients/:clientId/equipements', 'client-actif'],
      ['GET /api/contrats-maintenance'], ['GET /api/contrats-maintenance/generation-visites'], ['POST /api/contrats-maintenance/generation-visites'],
      ['GET /api/contrats-maintenance/:id/journal-saisies', 'contrat-actif'], ['GET /api/contrats-maintenance/:id/document.pdf', 'contrat-actif'], ['GET /api/contrats-maintenance/:id/envois', 'contrat-actif'],
      ['POST /api/contrats-maintenance/:id/envois', 'contrat-actif'], ['PATCH /api/contrats-maintenance/:id/statut', 'contrat-actif'], ['POST /api/contrats-maintenance/:id/avancer-echeance', 'contrat-actif'],
      ['POST /api/contrats-maintenance/:id/generer-intervention', 'inexistant'],
    ];
    for (const [route, cible] of OUVERTURES) {
      const valeur = ligne(route, cible);
      assert.ok(valeur !== undefined, `${route} ${cible ?? ''} : ligne absente`);
      assert.doesNotMatch(valeur, /^40[13]/, `${route} ${cible ?? ''} : ${valeur}`);
    }
    assert.equal(ligne('GET /api/contrats-maintenance/:id/document.pdf', 'contrat-actif'), '200');
    assert.equal(ligne('GET /api/clients/:clientId/equipements', 'client-actif'), '200');
    assert.match(ligne('POST /api/contrats-maintenance/generation-visites'), /^409 « La génération automatique des visites est désactivée/, 'passage manuel admis, réglage vide');
    // Refus restés à l'administration, message exact (choix par défaut, à confirmer, sauf l'acompte et l'annulation).
    for (const [route, cible] of [
      ['POST /api/devis/:id/acompte', 'devis-signe'], ['POST /api/devis/:id/annulation', 'devis-signe'], ['POST /api/contrats-maintenance'], ['PATCH /api/contrats-maintenance/:id', 'contrat-actif'],
      ['PUT /api/parametres'], ['POST /api/clients/:clientId/equipements', 'client-actif'], ['POST /api/clients/:clientId/equipements/:id/archiver', 'inexistant'],
      ['GET /api/catalogue/:family', 'family=prestations'], ['POST /api/catalogue/:family', 'family=prestations'], ['PUT /api/catalogue/:family/:id', 'prestation-catalogue'], ['DELETE /api/catalogue/:family/:id', 'inexistant'],
    ]) assert.equal(ligne(route, cible), `403 « ${REFUS_ADMINISTRATION} »`, `${route} ${cible ?? ''}`);
    // Gardes de la gestion des clients et des contrats : chaque autre compte hors administration reçoit leur refus, au message
    // exact, sur chacune des dix-huit routes ; l'administration, le directeur et AT y entrent.
    const ROUTES_GARDEES = ROUTES_COMME_AD_AT2A.filter((r) => /\/api\/(clients|contrats-maintenance)/.test(r));
    assert.equal(ROUTES_GARDEES.length, 18, ROUTES_GARDEES.join(', '));
    const cles = lire('entrees.txt').map((l) => l.split(SEPARATEUR));
    const vues = new Set();
    for (const [compte, route, , contexte, reponse] of cles) {
      if (!ROUTES_GARDEES.includes(route) || contexte !== 'défaut') continue;
      vues.add(`${compte} ${route}`);
      if (['SA', 'AD', 'AD-COM', 'DIR', 'AT'].includes(compte)) assert.doesNotMatch(reponse, /^40[13]/, `${compte} ${route} : ${reponse}`);
      else if (['CT', 'CT-N1', 'RESP', 'RESP-SANS-BRANCHE', 'TECH', 'TECH-SANS-FICHE', 'COM', 'DC', 'AC', 'CPT', 'CPT-FINANCE'].includes(compte)) assert.match(reponse, new RegExp(`^403 « ${REFUS_GESTION} »( inchangé)?$`), `${compte} ${route}`);
    }
    for (const compte of ['CT', 'COM', 'AC', 'AT', 'AD']) for (const route of ROUTES_GARDEES) assert.ok(vues.has(`${compte} ${route}`), `${compte} ${route} : jouée`);
  });

  // PR AT-2b (cadrage v1, « Chantiers » et « Saisies Travaux » ; v3, réponse 3 du 07-11-2026 ; v4, R1 et C1) : ouvertures et refus
  // lus dans la référence des entrées et dans celle des écritures.
  test('entrees.txt et ecritures-*.txt : fiche, client, titulaire, commercial et saisies Travaux d’une affaire en cours de toute la société ouverts à AT ; statut refusé au message reformulé, même titulaire ; affaire clôturée et archivage refusés ; affaire annulée refusée (409) ; statut de la fiche ignoré', () => {
    const at = lignesDe('entrees.txt', 'AT');
    const ligne = (route, cible = '—', contexte = 'défaut') => at.get([route, cible, contexte].join(SEPARATEUR));
    // Ouvertures sur des affaires dont elle n'est pas titulaire (conducteur, responsable, directeur, commercial titulaire).
    for (const cible of ['chantier-ct', 'chantier-autre', 'chantier-resp', 'chantier-dir', 'chantier-com-titulaire']) {
      assert.equal(ligne('PATCH /api/chantiers/:id', cible), '200', `fiche de ${cible}`);
      assert.equal(ligne('PATCH /api/chantiers/:id/commercial', cible), '400', `commercial de ${cible} : garde passée, corps vide refusé`);
    }
    for (const cible of ['achat-chantier-ct', 'achat-chantier-autre']) assert.equal(ligne('PATCH /api/achats/:id', cible), '400', cible);
    for (const cible of ['heure-chantier-ct', 'heure-chantier-autre']) assert.equal(ligne('PATCH /api/heures/:id', cible), '400', cible);
    for (const route of ['POST /api/achats', 'POST /api/heures']) assert.equal(ligne(route), '400 validation-avant-droit', route);
    // Refus : statut (piège P2), même sur l'affaire d'un autre, avant le 404 ; affaire clôturée ; encaissement ; archivage.
    for (const cible of ['chantier-ct', 'chantier-termine', 'inexistant']) assert.equal(ligne('PATCH /api/chantiers/:id/statut', cible), `403 « ${REFUS_STATUT} »`, cible);
    assert.equal(ligne('PATCH /api/chantiers/:id', 'chantier-termine'), '403 « Ce chantier est clôturé : seul un administrateur peut encore le modifier. »');
    assert.equal(ligne('PATCH /api/chantiers/:id', 'chantier-annule'), '409 « Cette affaire est annulée : elle n’est plus modifiable. »');
    assert.equal(ligne('PATCH /api/achats/:id', 'achat-chantier-termine'), `403 « ${REFUS_CLOTURE_SAISIES} »`);
    assert.equal(ligne('PATCH /api/heures/:id', 'heure-chantier-termine'), `403 « ${REFUS_CLOTURE_SAISIES} »`);
    assert.equal(ligne('PATCH /api/chantiers/:id/encaisse', 'chantier-ct'), `403 « ${REFUS_ADMINISTRATION} »`);
    for (const [route, cible] of [['DELETE /api/achats/:id', 'achat-chantier-ct'], ['DELETE /api/heures/:id', 'heure-chantier-ct'], ['POST /api/achats/:id/restaurer', 'achat-archive-chantier-ct'], ['POST /api/heures/:id/restaurer', 'heure-archivee-chantier-ct']]) {
      assert.equal(ligne(route, cible), '403 « Permission requise : chantiers:archive »', `${route} ${cible} : chantiers:archive non donné`);
    }
    // Écritures réelles : saisies sur l'affaire d'autrui, refusées après clôture (403) ou sur une affaire annulée (409).
    const actions = lignesDe('ecritures-actions.txt', 'AT');
    const action = (route, cible, contexte) => actions.get([route, cible, contexte].join(SEPARATEUR));
    for (const [route, corps, tables] of [['POST /api/achats', 'achat', 'AchatReel,JournalSaisieChantier'], ['POST /api/heures', 'heures', 'JournalSaisieChantier,PointageHeure']]) {
      assert.equal(action(route, 'chantierId=chantier-ct', `défaut, corps ${corps}`), `200 écrit (${tables})`, route);
      assert.equal(action(route, 'chantierId=chantier-termine', `défaut, corps ${corps}`), `403 « ${REFUS_CLOTURE_SAISIES} » inchangé`, route);
      assert.equal(action(route, 'chantierId=chantier-annule', `défaut, corps ${corps}`), '409 « Cette affaire est annulée : plus aucune saisie n’y est possible. » inchangé', route);
    }
    assert.equal(action('PATCH /api/chantiers/:id/statut', 'chantier-ct', 'défaut, corps statut=TERMINE'), `403 « ${REFUS_STATUT} » inchangé`);
    // Modifications : client changé (C1), statut ignoré (R1), commercial ; refus sur affaire clôturée ou annulée.
    const modifs = lignesDe('ecritures-modifications.txt', 'AT');
    const modif = (route, cible, contexte) => modifs.get([route, cible, contexte].join(SEPARATEUR));
    assert.equal(modif('PATCH /api/chantiers/:id', 'chantier-autre', 'défaut, corps clientId=client-second seul'), '200 écrit (Chantier,JournalSaisieChantier)');
    assert.equal(modif('PATCH /api/chantiers/:id', 'chantier-autre', 'défaut, corps statut=TERMINE seul'), '200 inchangé');
    assert.equal(modif('PATCH /api/chantiers/:id', 'chantier-termine', 'défaut, corps nom, budgets par poste et heures vendues'), '403 « Ce chantier est clôturé : seul un administrateur peut encore le modifier. » inchangé');
    assert.equal(modif('PATCH /api/chantiers/:id', 'chantier-annule', 'défaut, corps clientId=client-second seul'), '409 « Cette affaire est annulée : elle n’est plus modifiable. » inchangé');
    assert.equal(modif('PATCH /api/chantiers/:id/commercial', 'chantier-autre', 'défaut, corps commercialId=COM'), '200 écrit (Chantier,JournalSaisieChantier)');
    assert.equal(modif('PATCH /api/chantiers/:id/commercial', 'chantier-termine', 'défaut, corps commercialId=COM'), '403 « Ce chantier est clôturé : seul un administrateur peut encore en changer le commercial. » inchangé');
    assert.equal(modif('PATCH /api/chantiers/:id/commercial', 'chantier-annule', 'défaut, corps commercialId=COM'), '409 « Cette affaire est annulée : son commercial ne change plus. » inchangé');
    // Le refus d'AT-1 ne figure plus dans aucune référence.
    for (const fichier of REFERENCES) assert.ok(!lire(fichier).some((l) => l.includes(REFUS_AFFAIRE)), `${fichier} : refus d’AT-1 encore présent`);
  });

  // PR AT-2b : chantiers:archive donné individuellement, dans les deux références des droits individuels : chaque route
  // d'archivage et de restauration, sur chaque cible d'AD à l'entrée, a sa ligne dans l'une des deux, conforme à la règle nommée
  // (réponse d'AD sur une affaire en cours, refus de CT sur une affaire clôturée).
  test('droits individuels d’AT-2b : chantiers:archive ouvre l’archivage et la restauration sur une affaire en cours de toute la société, comme AD, et la laisse refusée sur une affaire clôturée ; chantiers:write, porté par son type, n’a aucune ligne', () => {
    const lignesArchive = new Map();
    for (const fichier of INDIVIDUELS) for (const [cle, valeur] of lignesDe(fichier, 'AT')) {
      assert.ok(!cle.startsWith('chantiers:write | '), `${fichier} : ${cle} (chantiers:write porté par son type)`);
      if (cle.startsWith('chantiers:archive | ') && cle.endsWith(' | entrée')) lignesArchive.set(cle, valeur);
    }
    const ROUTES_ARCHIVE = ['DELETE /api/achats/:id', 'DELETE /api/heures/:id', 'POST /api/achats/:id/restaurer', 'POST /api/heures/:id/restaurer'];
    let ouvertes = 0;
    for (const [cleEntree, reponseAd] of ENTREES.AD) {
      const [route, cible, contexte] = cleEntree.split(SEPARATEUR);
      if (!ROUTES_ARCHIVE.includes(route) || contexte !== 'défaut') continue;
      const cle = ['chantiers:archive', route, cible, contexte, 'entrée'].join(SEPARATEUR);
      const valeur = lignesArchive.get(cle);
      assert.ok(valeur !== undefined, `${cle} : absente des deux références`);
      const attendu = CIBLE_CLOTUREE.test(cible) ? `403 « ${REFUS_CLOTURE_SAISIES} »` : reponseAd;
      assert.equal(valeur, `403 « Permission requise : chantiers:archive » → ${attendu}`, cle);
      if (!CIBLE_CLOTUREE.test(cible) && /^(2|400)/.test(reponseAd)) ouvertes += 1;
    }
    assert.ok(ouvertes >= 6, `archivages et restaurations ouverts : ${ouvertes}`);
  });

  // PR AT-3 (cadrage AT-3 v2 ; T4 et T6 du contrôle de cohérence ; points 27, 30, 33 et 36 du 24-10-2026, réponse 6 du 06-11-2026,
  // réponses 1 et 2 du 09-11-2026) : ouvertures et refus lus dans les références des entrées et des écritures ; le refus de la garde
  // requireGestionFactures, au message exact, pour chaque autre compte hors administration.
  test('entrees.txt, ecritures-actions.txt et factures.txt : factures de son poste ouvertes à AT (lecture, PDF, envois, journal, règlements, origine, émission, création, temps passé), 404 sur les pièces de l’administration, routes des règlements, de l’export, des mentions et de la comptabilité refusées (avoirs et annulation ouverts par AT-4, test suivant) ; refus de la garde pour les autres comptes', () => {
    const at = lignesDe('entrees.txt', 'AT');
    const ligne = (route, cible = '—', contexte = 'défaut') => at.get([route, cible, contexte].join(SEPARATEUR));
    // Ouvertures sur ses pièces : 200 (ou le refus du document sur un brouillon, 409, celui de l'administration).
    for (const route of ['GET /api/factures/:id/document.pdf', 'GET /api/factures/:id/envois']) {
      assert.equal(ligne(route, 'facture-at-emise'), '200', route);
      assert.equal(ligne(route, 'avoir-facture-at'), '200', `${route}, avoir de son poste`);
      assert.equal(ligne(route, 'facture-at-brouillon'), '409 « Le document est disponible uniquement pour une facture émise. »', route);
    }
    for (const route of ['GET /api/factures/:id/journal', 'GET /api/factures/:id/reglements', 'GET /api/factures/:id/tracabilite']) {
      for (const cible of ['facture-at-brouillon', 'facture-at-emise', 'avoir-facture-at']) assert.equal(ligne(route, cible), '200', `${route} ${cible}`);
    }
    assert.equal(ligne('GET /api/factures'), '200');
    assert.equal(ligne('GET /api/factures/chronologie'), '200');
    assert.equal(ligne('POST /api/factures'), '400', 'création : garde passée, corps vide refusé');
    assert.equal(ligne('GET /api/interventions/:id/facture-temps-passe', 'intervention-autre'), '409 « Cette intervention n’est pas au temps passé : sa facture se saisit ligne par ligne. »');
    // Pièces de l'administration et pièce absente : 404 avant tout refus du document (T4), sur chaque route des pièces.
    for (const route of ['GET /api/factures/:id/document.pdf', 'GET /api/factures/:id/envois', 'GET /api/factures/:id/journal', 'GET /api/factures/:id/reglements', 'GET /api/factures/:id/tracabilite']) {
      for (const cible of ['facture-brouillon', 'facture-emise', 'avoir-emis', 'inexistant']) assert.equal(ligne(route, cible), INTROUVABLE, `${route} ${cible}`);
    }
    assert.equal(ligne('POST /api/factures/:id/emettre', 'inexistant'), INTROUVABLE);
    // Émission jouée sur chaque cible réelle (ecritures-actions.txt) : la sienne émise, celles de l'administration 404, une pièce
    // déjà émise de son poste 409.
    const actions = lignesDe('ecritures-actions.txt', 'AT');
    const action = (cible) => actions.get(['POST /api/factures/:id/emettre', cible, 'défaut'].join(SEPARATEUR));
    assert.equal(action('facture-at-brouillon'), '200 écrit (EcritureFacture,Facture,JournalFacture,SequenceFacture)');
    for (const cible of ['facture-brouillon', 'facture-emise', 'avoir-emis']) assert.equal(action(cible), `${INTROUVABLE} inchangé`, cible);
    for (const cible of ['facture-at-emise', 'avoir-facture-at']) assert.equal(action(cible), '409 « Seul un brouillon peut être émis. » inchangé', cible);
    // Routes restées à l'administration, sur ses propres pièces : 403, message exact (AT-4 en retire l'annulation et les avoirs).
    for (const [route, cible] of [
      ['GET /api/factures/a-regler'], ['GET /api/facturation/prete-a-facturer'], ['GET /api/factures/export-comptable.csv'], ['GET /api/mentions-legales'], ['POST /api/mentions-legales'],
      ['POST /api/factures/:id/regler', 'facture-at-emise'],
      ['GET /api/reglements'], ['POST /api/reglements'], ['GET /api/comptabilite'],
    ]) assert.equal(ligne(route, cible), `403 « ${REFUS_ADMINISTRATION} »`, `${route} ${cible ?? ''}`);
    // factures.txt : elle crée, émet son brouillon et la facture au temps passé, montants relus conformes ; ses écritures sur les
    // pièces de l'administration (émission, envois) 404 ; règlements, contre-passation et « réglée » à la main 403 (avoirs et
    // annulation : test suivant).
    const factures = lignesDe('factures.txt', 'AT');
    const cas = (route, cible, contexte) => factures.get([route, cible, contexte].join(SEPARATEUR));
    assert.match(cas('POST /api/factures', 'clientId=client-actif', 'défaut, corps trois lignes à deux taux'), /^201 écrit \(.*\) ; entrées : JournalFacture nouvelle facture CREATION_BROUILLON par AT ; pièces émises figées ; montants de la pièce créée relus en base conformes$/);
    assert.match(cas('POST /api/factures/:id/emettre', 'facture-brouillon-deux-taux-at', 'défaut'), /^200 écrit .* ; écritures et montants de la pièce relus en base conformes$/);
    assert.equal(cas('POST /api/factures/:id/emettre', 'facture-brouillon-deux-taux', 'défaut'), `${INTROUVABLE} inchangé ; aucune entrée ; pièces émises figées ; montants inchangés en base`);
    assert.match(cas('POST /api/interventions/:id/facture-temps-passe', 'intervention-temps-passe', 'défaut, corps dates et total de l’aperçu'), /^201 écrit .* par AT ; pièces émises figées ; montants de la pièce créée relus en base conformes$/);
    for (const route of ['POST /api/reglements', 'POST /api/reglements/:id/contrepasser', 'POST /api/factures/:id/regler']) {
      const lignesRoute = [...factures].filter(([cle]) => cle.startsWith(`${route}${SEPARATEUR}`));
      assert.ok(lignesRoute.length > 0, `${route} : jouée`);
      for (const [cle, valeur] of lignesRoute) assert.ok(valeur.startsWith(`403 « ${REFUS_ADMINISTRATION} » inchangé ; aucune entrée ;`), `${cle} : ${valeur}`);
    }
    // Les autres comptes hors administration : refus de la garde requireGestionFactures sur chaque route ouverte, au message exact ;
    // l'administration et le directeur y entrent.
    const vues = new Set();
    for (const [compte, route, , contexte, reponse] of lire('entrees.txt').map((l) => l.split(SEPARATEUR))) {
      if (!ROUTES_FACTURES_AT3.has(route) || contexte !== 'défaut') continue;
      vues.add(`${compte} ${route}`);
      if (['SA', 'AD', 'AD-COM', 'DIR', 'AT'].includes(compte)) assert.doesNotMatch(reponse, /^40[13]/, `${compte} ${route} : ${reponse}`);
      else if (['CT', 'CT-N1', 'RESP', 'RESP-SANS-BRANCHE', 'TECH', 'TECH-SANS-FICHE', 'COM', 'DC', 'AC', 'CPT', 'CPT-FINANCE'].includes(compte)) assert.equal(reponse, `403 « ${REFUS_GESTION} »`, `${compte} ${route}`);
    }
    for (const compte of ['CT', 'CPT', 'CPT-FINANCE', 'AT', 'AD', 'DIR']) for (const route of ROUTES_FACTURES_AT3) assert.ok(vues.has(`${compte} ${route}`), `${compte} ${route} : jouée`);
  });

  // PR AT-4 (cadrage AT-4 v2, § 1 et 2 ; C2, T1 et N11 du contrôle de cohérence de mode 1 ; réponse 1 du 09-11-2026, « Partiels et
  // annulation (Recommandé) ») : avoir partiel, annulation et repère lus dans les références des entrées et des factures.
  test('entrees.txt et factures.txt (AT-4) : avoir partiel et annulation ouverts à AT sur les pièces de son poste (refus de la pièce, ceux d’AD), 404 sur celles de l’administration et une pièce absente, 400 du corps vide avant la pièce ; repère « déjà facturée » admis ; refus de requireGestionFactures pour les autres comptes ; l’ancien refus de l’envoi d’un avoir et « Accès réservé aux administrateurs » sur ces routes n’apparaissent plus', () => {
    const entrees = { AT: lignesDe('entrees.txt', 'AT'), AD: lignesDe('entrees.txt', 'AD') };
    const ligne = (compte, route, cible = '—', contexte = 'défaut') => entrees[compte].get([route, cible, contexte].join(SEPARATEUR));
    const ANNULER = 'POST /api/factures/:id/annuler'; const AVOIRS = 'POST /api/factures/:id/avoirs'; const REPERE = 'GET /api/factures/deja-facturee';
    // Ses pièces : les refus propres à la pièce, ceux d'AD (règlement reçu sur facture-at-emise, avoir, brouillon).
    for (const cible of ['facture-at-emise', 'avoir-facture-at', 'facture-at-brouillon']) assert.equal(ligne('AT', ANNULER, cible), ligne('AD', ANNULER, cible), `${ANNULER} ${cible}`);
    assert.equal(ligne('AT', ANNULER, 'facture-at-emise'), '409 « Cette facture a reçu un règlement : elle ne peut plus être annulée en totalité. Émettez un avoir partiel, ou contre-passez d’abord un règlement saisi par erreur. »');
    for (const cible of ['avoir-facture-at', 'facture-at-brouillon']) assert.equal(ligne('AT', ANNULER, cible), '409 « Seule une facture émise peut être annulée. »', cible);
    // Pièces de l'administration et pièce absente : 404, là où AD reçoit le refus de la pièce.
    for (const cible of ['facture-brouillon', 'facture-emise', 'avoir-emis', 'inexistant']) assert.equal(ligne('AT', ANNULER, cible), INTROUVABLE, `${ANNULER} ${cible}`);
    assert.match(ligne('AD', ANNULER, 'facture-emise'), /^409 /, 'témoin : AD reçoit le refus de la pièce');
    // Avoir partiel à corps vide : 400, lu avant la pièce, pour AT comme pour AD, sur toute cible.
    for (const cible of ['facture-at-emise', 'avoir-facture-at', 'facture-at-brouillon', 'facture-brouillon', 'facture-emise', 'avoir-emis', 'inexistant']) {
      for (const compte of ['AT', 'AD']) assert.equal(ligne(compte, AVOIRS, cible), '400', `${compte} ${AVOIRS} ${cible}`);
    }
    // Repère : la garde passée, 400 sans paramètre (assistante-technique-avoirs.test.mjs en éprouve les réponses).
    for (const compte of ['AT', 'AD']) assert.equal(ligne(compte, REPERE), '400', `${compte} ${REPERE}`);
    // Les autres comptes : le refus de requireGestionFactures sur chaque cible des trois routes ; l'administration et le directeur
    // y entrent.
    const autres = ['CT', 'CT-N1', 'RESP', 'RESP-SANS-BRANCHE', 'TECH', 'TECH-SANS-FICHE', 'COM', 'DC', 'AC', 'CPT', 'CPT-FINANCE'];
    const vues = new Map();
    for (const [compte, route, cible, contexte, reponse] of lire('entrees.txt').map((l) => l.split(SEPARATEUR))) {
      if (![ANNULER, AVOIRS, REPERE].includes(route) || contexte !== 'défaut') continue;
      vues.set(`${compte} ${route}`, (vues.get(`${compte} ${route}`) ?? 0) + 1);
      if (autres.includes(compte)) assert.equal(reponse, `403 « ${REFUS_GESTION} »`, `${compte} ${route} ${cible}`);
      if (['SA', 'AD', 'AD-COM', 'DIR', 'AT'].includes(compte)) assert.doesNotMatch(reponse, /^40[13]/, `${compte} ${route} ${cible} : ${reponse}`);
    }
    for (const compte of [...autres, 'SA', 'AD', 'AD-COM', 'DIR', 'AT']) {
      for (const route of [ANNULER, AVOIRS]) assert.equal(vues.get(`${compte} ${route}`), 7, `${compte} ${route} : sept cibles jouées`);
      assert.equal(vues.get(`${compte} ${REPERE}`), 1, `${compte} ${REPERE} : jouée`);
    }
    // factures.txt : elle rejoue chaque cas de SA ; sur les pièces de l'administration, 404 sans écriture, avant le 400 du taux
    // absent et les 409 que l'administration reçoit (C2) ; les autres comptes, le refus de la garde.
    const factures = lignesDe('factures.txt', 'AT');
    for (const route of [ANNULER, AVOIRS]) {
      const lignesRoute = [...factures].filter(([cle]) => cle.startsWith(`${route}${SEPARATEUR}`));
      assert.ok(lignesRoute.length >= 7, `${route} : jouée par AT (${lignesRoute.length})`);
      for (const [cle, valeur] of lignesRoute) assert.ok(valeur.startsWith(`${INTROUVABLE} inchangé ; aucune entrée ;`), `AT ${cle} : ${valeur}`);
      for (const compte of ['CT', 'COM', 'CPT', 'AC', 'TECH', 'RESP', 'DC']) {
        const refus = [...lignesDe('factures.txt', compte)].filter(([cle]) => cle.startsWith(`${route}${SEPARATEUR}`));
        assert.equal(refus.length, lignesRoute.length, `${compte} ${route} : les cas de SA rejoués`);
        for (const [cle, valeur] of refus) assert.ok(valeur.startsWith(`403 « ${REFUS_GESTION} » inchangé ; aucune entrée ;`), `${compte} ${cle} : ${valeur}`);
      }
    }
    const tauxAbsent = [AVOIRS, 'facture-emise', 'défaut, corps taux absent de la facture'].join(SEPARATEUR);
    assert.match(lignesDe('factures.txt', 'AD').get(tauxAbsent) ?? '', /^400 /, 'témoin : AD reçoit le 400 du taux absent');
    assert.ok(factures.get(tauxAbsent)?.startsWith(`${INTROUVABLE} inchangé`), `AT : le 404 avant le 400 du taux absent (${factures.get(tauxAbsent)})`);
    // Plus aucune trace des refus retirés : l'envoi d'un avoir refusé à AT (AT-3), et le refus de l'administration sur l'avoir
    // partiel et l'annulation, pour quelque compte que ce soit.
    for (const fichier of REFERENCES) {
      for (const l of lire(fichier)) {
        assert.ok(!l.includes(REFUS_ENVOI_AVOIR_AT3), `${fichier} : refus de l’envoi d’un avoir encore présent : ${l}`);
        const champs = l.split(SEPARATEUR);
        const route = INDIVIDUELS.includes(fichier) ? champs[2] : champs[1];
        if ([ANNULER, AVOIRS].includes(route)) assert.ok(!l.includes(`403 « ${REFUS_ADMINISTRATION} »`), `${fichier} : refus de l’administration sur ${route} : ${l}`);
      }
    }
  });

  test('témoins de la règle : un montant de rentabilité, de coût prévu ou de main-d’œuvre lu par AT, un budget par poste masqué, un refus changé ou une entrée à un autre nom sont des écarts', () => {
    const ad = 'budgetGlobalVendu=présent, budgetMaterielVendu=présent, coutMaterielPrevu=présent, metrics.moReel=présent, metrics.materielReel=présent, achats[].montantHT=présent';
    const at = 'budgetGlobalVendu=null, budgetMaterielVendu=présent, coutMaterielPrevu=null, metrics.moReel=null, metrics.materielReel=présent, achats[].montantHT=présent';
    const { verifier } = attenduDonneesCommeAd('montants', ad);
    assert.deepEqual(verifier(at), []);
    // Lecture écartée : « Rentabilité selon un réglage » ouverte par défaut (réponse 2 de Nelson, « Décochée ») : le vendu lu.
    assert.equal(verifier(at.replace('budgetGlobalVendu=null', 'budgetGlobalVendu=présent')).length, 1);
    // Lecture écartée : coût prévu lu (voitCoutPrevuParPrixAchat élargi).
    assert.equal(verifier(at.replace('coutMaterielPrevu=null', 'coutMaterielPrevu=présent')).length, 1);
    // Lecture écartée : coût de main-d'œuvre lu (réponse 4, « coûts non »).
    assert.equal(verifier(at.replace('metrics.moReel=null', 'metrics.moReel=présent')).length, 1);
    // Lecture écartée : « Toute la vue financière » masquée (budgets par poste et matériel ôtés).
    assert.equal(verifier(at.replace('budgetMaterielVendu=présent', 'budgetMaterielVendu=null')).length, 1);
    assert.equal(verifier(at.replace('metrics.materielReel=présent', 'metrics.materielReel=absent')).length, 1);
    for (const champ of MONTANTS_LUS_AT) assert.ok(!MONTANTS_MASQUES_AT.includes(champ), `${champ} : lu et masqué à la fois`);
    // Clés : la facturation et les taux ôtés, le reste gardé.
    assert.deepEqual(attenduDonneesCommeAd('clés .', 'achats, facturation, id, metrics').attendu, 'achats, id, metrics');
    assert.equal(attenduDonneesCommeAd('clés .margeSav', 'coutsHT, margeHT').attendu, undefined);
    // Refus : message exact, sans écriture (AT-2b : le statut, au message reformulé ; l'ancien message d'AT-1 est un écart).
    const lignes = { AT: new Map(), AD: new Map(), CT: new Map(), AC: new Map(), SA: new Map() };
    const refus = regle('entrees.txt', 'PATCH /api/chantiers/:id/statut | chantier-ct | défaut', lignes);
    assert.deepEqual(refus.verifier(`403 « ${REFUS_STATUT} »`), []);
    assert.equal(refus.verifier(`403 « ${REFUS_AFFAIRE} »`).length, 1, 'message d’AT-1');
    assert.equal(refus.verifier('404 « Chantier introuvable »').length, 1);
    assert.equal(refus.verifier(`403 « ${REFUS_STATUT} » écrit (Chantier)`).length, 1);
    assert.equal(refus.verifier(undefined).length, 1, 'entrees.txt rejoue chaque compte');
    assert.equal(commeAt('entrées : JournalSaisieChantier COUT_INTERVENTION_ACHAT CREATION par CT', 'CT'), 'entrées : JournalSaisieChantier COUT_INTERVENTION_ACHAT CREATION par AT');
    assert.equal(commeAt('entrées : JournalSaisieChantier CHANTIER CHANGEMENT par CT-N1', 'CT'), 'entrées : JournalSaisieChantier CHANTIER CHANGEMENT par CT-N1', 'CT-N1 n’est pas CT');
    // AT-2a : la réponse de conversion d'AT donne le coût prévu (piège P1) : écart ; masqué : conforme ; le prix d'achat prévu
    // d'une ligne de devis, lu par AT comme par AD, masqué pour elle : écart.
    const conversionAd = '201 écrit (Chantier,DevisConversion) ; aucune entrée ; réponse : coutMaterielPrevu présent ; montants du chantier ouvert relus en base conformes';
    const verifierConversion = verifierReponseCommeAd(conversionAd);
    assert.deepEqual(verifierConversion(conversionAd.replace('coutMaterielPrevu présent', 'coutMaterielPrevu null')), []);
    assert.equal(verifierConversion(conversionAd).length, 1, 'coût prévu lu par AT');
    assert.equal(verifierConversion(conversionAd.replace('relus en base conformes', 'relus en base différents')).length, 1, 'constat des montants changé');
    const devisAd = '201 écrit (Devis,DevisLigne,SequenceAffaire) ; aucune entrée ; réponse : lignes[].prixAchatUnitaireHt présent ; montants du devis relus en base conformes';
    assert.deepEqual(verifierReponseCommeAd(devisAd)(devisAd), []);
    assert.equal(verifierReponseCommeAd(devisAd)(devisAd.replace('prixAchatUnitaireHt présent', 'prixAchatUnitaireHt absent')).length, 1, 'prix d’achat masqué pour AT');
    // Refus d'AT-2a : l'acompte écrit, ou refusé sous un autre message, est un écart.
    const acompte = regle('ecritures-actions.txt', 'POST /api/devis/:id/acompte | devis-signe | défaut', lignes);
    assert.deepEqual(acompte.verifier(`403 « ${REFUS_ADMINISTRATION} » inchangé`), []);
    assert.equal(acompte.verifier('200 écrit (Devis)').length, 1);
    assert.equal(acompte.verifier(`403 « ${REFUS_GESTION} » inchangé`).length, 1);
    // Droit devis donné à AT : aucune ligne, comme le commercial ; une ligne serait un écart.
    const droitDevis = regle('individuels.txt', 'droit devis | GET /api/devis | — | défaut | entrée', { ...lignes, COM: new Map() });
    assert.equal(droitDevis.modele, 'COM');
    assert.equal(droitDevis.attendu, undefined);

    // AT-2b. R1 : le statut écrit par la fiche (mutant « allowed lu par gereLesChantiersEnCours ») est un écart.
    const statutSeul = regle('ecritures-modifications.txt', 'PATCH /api/chantiers/:id | chantier-ct | défaut, corps statut=TERMINE seul', { ...lignes, AD: new Map([['PATCH /api/chantiers/:id | chantier-ct | défaut, corps statut=TERMINE seul', '200 écrit (Chantier)']]) });
    assert.equal(statutSeul.attendu, '200 inchangé');
    assert.notEqual(statutSeul.attendu, '200 écrit (Chantier)');
    // Affaire clôturée : la ligne de CT (refus), et non celle d'AD (écriture).
    const cloture = regle('ecritures-modifications.txt', 'PATCH /api/chantiers/:id | chantier-termine | défaut, corps nom, budgets par poste et heures vendues', {
      ...lignes, AD: new Map([['PATCH /api/chantiers/:id | chantier-termine | défaut, corps nom, budgets par poste et heures vendues', '200 écrit (Chantier)']]),
      CT: new Map([['PATCH /api/chantiers/:id | chantier-termine | défaut, corps nom, budgets par poste et heures vendues', '403 « Ce chantier est clôturé : seul un administrateur peut encore le modifier. » inchangé']]),
    });
    assert.deepEqual([cloture.modele, cloture.attendu], ['CT', '403 « Ce chantier est clôturé : seul un administrateur peut encore le modifier. » inchangé']);
    // C5 (a) : le vendu écrit sans son réglage est un écart ; refusé, conforme.
    const vendu = regle('montants.txt', 'PATCH /api/chantiers/:id | chantier-ct | défaut, corps montant vendu', lignes);
    assert.deepEqual(vendu.verifier(`403 « ${REFUS_VENDU} » inchangé ; aucune entrée ; montants inchangés en base`), []);
    assert.equal(vendu.verifier('200 écrit (Chantier) ; aucune entrée ; réponse : budgetGlobalVendu présent ; montant vendu écrit relu en base').length, 1);
    // Réglage coché (N4) : le vendu et le coût prévu lus, conformes ; la facturation ou le coût de main-d'œuvre lus, écarts
    // (R1 de la v3 et C5 (c) : mutants « facturation sans exclusion d'AT » et « voitCoutMainOeuvre ouvert à qui voit la
    // rentabilité »).
    const adCoche = 'budgetGlobalVendu=présent, coutMaterielPrevu=présent, metrics.margeBrute=présent, facturation=présent, metrics.moReel=présent, metrics.estimation.coutEstime=présent';
    const atCoche = 'budgetGlobalVendu=présent, coutMaterielPrevu=présent, metrics.margeBrute=présent, facturation=absent, metrics.moReel=null, metrics.estimation.coutEstime=null';
    const { verifier: verifierCoche } = attenduDonneesCommeAd('montants', adCoche, RENTABILITE_AT);
    assert.deepEqual(verifierCoche(atCoche), []);
    assert.equal(verifierCoche(atCoche.replace('facturation=absent', 'facturation=présent')).length, 1, 'facturation lue réglage coché');
    assert.equal(verifierCoche(atCoche.replace('metrics.moReel=null', 'metrics.moReel=présent')).length, 1, 'coût de main-d’œuvre lu réglage coché');
    assert.equal(verifierCoche(atCoche.replace('metrics.estimation.coutEstime=null', 'metrics.estimation.coutEstime=présent')).length, 1, 'hypothèse de coût de l’estimation lue');
    assert.equal(verifierCoche(atCoche.replace('budgetGlobalVendu=présent', 'budgetGlobalVendu=null')).length, 1, 'réglage sans effet : vendu toujours masqué');
    // Réglage décoché, mêmes lignes : le vendu lu est un écart.
    const { verifier: verifierDecoche } = attenduDonneesCommeAd('montants', adCoche, 'défaut');
    assert.equal(verifierDecoche(atCoche).length, 3, 'vendu, coût prévu et marge lus réglage décoché');
    // Réponse de conversion sous le réglage (C5 (b)) : coût prévu présent conforme, masqué écart ; décoché, l'inverse.
    const conversionAdDefaut = '201 écrit (Chantier,DevisConversion) ; aucune entrée ; réponse : coutMaterielPrevu présent ; montants du chantier ouvert relus en base conformes';
    assert.deepEqual(verifierReponseCommeAd(conversionAdDefaut, `${RENTABILITE_AT}, corps cible=CHANTIER`)(conversionAdDefaut), []);
    assert.equal(verifierReponseCommeAd(conversionAdDefaut, `${RENTABILITE_AT}, corps cible=CHANTIER`)(conversionAdDefaut.replace('présent', 'null')).length, 1);
    assert.equal(verifierReponseCommeAd(conversionAdDefaut, 'défaut, corps cible=CHANTIER')(conversionAdDefaut).length, 1);
    // chantiers:archive individuel : une écriture sur une affaire clôturée est un écart.
    const cleArchive = 'chantiers:archive | DELETE /api/achats/:id | achat-chantier-termine | défaut | entrée';
    const archive = regle('individuels.txt', cleArchive, lignes);
    assert.deepEqual(archive.verifier(`403 « Permission requise : chantiers:archive » → 403 « ${REFUS_CLOTURE_SAISIES} »`), []);
    assert.equal(archive.verifier('403 « Permission requise : chantiers:archive » → 400').length, 1);

    // AT-3. Pièce de l'administration lue ou émise par elle (mutants « facturesVisibles sans filtre » et « émission sans
    // périmètre ») : écarts ; 404, conforme ; le 409 de l'administration (périmètre après le document) : écart.
    const lignesAt3 = { ...lignes, AD: new Map([
      ['GET /api/factures/:id/document.pdf | facture-emise | défaut', '200'],
      ['GET /api/factures/:id/document.pdf | facture-brouillon | défaut', '409 « Le document est disponible uniquement pour une facture émise. »'],
      ['POST /api/factures/:id/emettre | facture-brouillon | défaut', '200 écrit (EcritureFacture,Facture,JournalFacture,SequenceFacture)'],
      ['POST /api/factures/:id/envois | avoir-facture-at | défaut, corps destinataire', '201 écrit (EnvoiDocument)'],
      ['POST /api/factures/:id/envois | facture-emise | défaut', '400'],
    ]) };
    const pdfAdmin = regle('entrees.txt', 'GET /api/factures/:id/document.pdf | facture-emise | défaut', lignesAt3);
    assert.deepEqual(pdfAdmin.verifier(INTROUVABLE), []);
    assert.equal(pdfAdmin.verifier('200').length, 1, 'pièce de l’administration lue par elle');
    const brouillonAdmin = regle('entrees.txt', 'GET /api/factures/:id/document.pdf | facture-brouillon | défaut', lignesAt3);
    assert.equal(brouillonAdmin.verifier('409 « Le document est disponible uniquement pour une facture émise. »').length, 1, 'refus du document avant le périmètre');
    const emissionAdmin = regle('ecritures-actions.txt', 'POST /api/factures/:id/emettre | facture-brouillon | défaut', lignesAt3);
    assert.deepEqual(emissionAdmin.verifier(`${INTROUVABLE} inchangé`), []);
    assert.equal(emissionAdmin.verifier('200 écrit (EcritureFacture,Facture,JournalFacture,SequenceFacture)').length, 1, 'brouillon de l’administration émis par elle');
    // AT-4 : l'envoi d'un avoir de son poste suit la ligne d'AD (201) ; le refus d'AT-3 rétabli serait un écart (mutant
    // « envoiAvoirRefuse rétabli »).
    const envoiAvoir = regle('factures.txt', 'POST /api/factures/:id/envois | avoir-facture-at | défaut, corps destinataire', lignesAt3);
    assert.deepEqual([envoiAvoir.modele, envoiAvoir.attendu], ['AD', '201 écrit (EnvoiDocument)']);
    assert.notEqual(envoiAvoir.attendu, `403 « ${REFUS_ENVOI_AVOIR_AT3} » inchangé ; aucune entrée`);
    // Le 400 d'un corps vide, contrôlé avant la pièce, reste celui d'AD.
    assert.deepEqual(regle('entrees.txt', 'POST /api/factures/:id/envois | facture-emise | défaut', lignesAt3).attendu, '400');
    // Liste : ses éléments seulement ; une pièce de l'administration dans sa liste est un écart.
    assert.equal(elementsDeSonPoste('avoir-emis, avoir-facture-at, facture-at-emise, facture-emise, « TEST facture avoir de l’assistante matrice », « TEST facture avoir matrice »'),
      'avoir-facture-at, facture-at-emise, « TEST facture avoir de l’assistante matrice »');
    assert.equal(elementsDeSonPoste('(sans libellé) ×2, facture avoir-emis, facture facture-at-emise'), '(sans libellé), facture facture-at-emise');
    assert.equal(elementsDeSonPoste('avoir-emis, facture-emise'), '(aucun)');
    // AT-4. Avoir partiel et annulation ouverts : sur sa pièce, la ligne d'AD (le refus de l'administration rétabli serait un
    // écart) ; sur une pièce de l'administration, 404 (mutants « avoirs ou annulation sans périmètre » et « périmètre relu après
    // le statut ») ; le 400 du corps vide, lu avant la pièce, celui d'AD (mutant « lignes lues après la pièce ») ; dans
    // factures.txt, le 404 avant le 400 du taux absent (mutant « périmètre relu après le taux »).
    const tauxAbsent = 'POST /api/factures/:id/avoirs | facture-emise | défaut, corps taux absent de la facture';
    const lignesAt4 = { ...lignes, AD: new Map([
      ['POST /api/factures/:id/avoirs | facture-at-emise | défaut', '400'],
      ['POST /api/factures/:id/avoirs | facture-emise | défaut', '400'],
      ['POST /api/factures/:id/annuler | facture-emise | défaut', '409 « Cette facture a reçu un règlement : elle ne peut plus être annulée en totalité. »'],
      [tauxAbsent, '400 « Le taux de TVA d’une ligne d’avoir doit être présent sur la facture d’origine. » inchangé ; aucune entrée ; pièces émises figées ; montants inchangés en base'],
    ]) };
    const avoirsAt = regle('entrees.txt', 'POST /api/factures/:id/avoirs | facture-at-emise | défaut', lignesAt4);
    assert.deepEqual([avoirsAt.modele, avoirsAt.attendu], ['AD', '400'], 'route des avoirs ouverte sur sa pièce');
    assert.notEqual(avoirsAt.attendu, `403 « ${REFUS_ADMINISTRATION} »`);
    assert.equal(regle('entrees.txt', 'POST /api/factures/:id/avoirs | facture-emise | défaut', lignesAt4).attendu, '400', 'corps vide : 400 avant la pièce');
    const annulationAdmin = regle('entrees.txt', 'POST /api/factures/:id/annuler | facture-emise | défaut', lignesAt4);
    assert.deepEqual(annulationAdmin.verifier(INTROUVABLE), []);
    assert.equal(annulationAdmin.verifier(lignesAt4.AD.get('POST /api/factures/:id/annuler | facture-emise | défaut')).length, 1, 'refus de la pièce avant le périmètre');
    assert.equal(annulationAdmin.verifier(`403 « ${REFUS_ADMINISTRATION} »`).length, 1, 'refus de l’administration rétabli');
    const tauxAbsentAdmin = regle('factures.txt', tauxAbsent, lignesAt4);
    assert.deepEqual(tauxAbsentAdmin.verifier(`${INTROUVABLE} inchangé ; aucune entrée ; pièces émises figées ; montants inchangés en base`), []);
    assert.equal(tauxAbsentAdmin.verifier(lignesAt4.AD.get(tauxAbsent)).length, 1, 'le 400 du taux absent avant le périmètre');
  });
});
