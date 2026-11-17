// Lot devis (cadrage v3 du 16-11-2026, contrôlé « prêt à coder », section « Tests » ; règle 2 : le lot touche des
// montants, taux d'acompte et lignes de devis) : #252 (taux d'acompte explicite invalide refusé ; 0 % envoyé avec un
// acompte exigé refusé ; devis inconnu en 404), #250/#240 (taux par défaut lu avant la transaction de la modification,
// rafale au-delà du pool de connexions) et #426 pour le devis.
//
// Décisions et lectures appliquées :
//  - décision de Nelson du 16-11-2026 sur #252. Question, texte de Claude Code, mot pour mot : « Devis (issue #252) : un
//    taux d'acompte saisi invalide (« abc », -5, 1000…) est aujourd'hui remplacé en silence par le taux par défaut (30 %).
//    Il sera refusé (400). Et un taux de 0 % avec « acompte exigé » coché : refusé ou admis ? » ; option choisie par Nelson
//    (libellé, texte de Claude Code) : « Refuser 0 % (Recommandé) » ;
//  - décision de Nelson du 16-11-2026 sur #250, option choisie (libellé, texte de Claude Code) : « L'intégrer au lot devis
//    (Recommandé) » (lecture du taux par défaut avant la transaction, test de rafale) ;
//  - lectures retenues du cadrage (à confirmer) : un taux envoyé non vide est contrôlé même sans acompte exigé ; le refus
//    de 0 % vise le 0 % envoyé, et non le taux par défaut (Q1, répondue par Nelson le 17-11-2026, ci-dessous) ; toutes
//    les routes du domaine répondent 404 pour un devis inconnu (choix par défaut, règle 5).
//
// Lot « acompte des devis » (cadrage v3.1 du 17-11-2026, contrôlé « prêt à coder », sections 1, 2 et 4, critères métier
// observables et section « Tests » ; règle 2 : montants et conversion des devis, parcours du pilote). Décisions de Nelson du
// 17-11-2026 :
//  - réponse à Q1, message de Nelson, mot pour mot : « 1. si l'accompte est reglé a 0% du coup rien n'est exiger en
//    accompte et donc ne figure pas sur la facture ni le devis, par defaut, le reglage doit etre a 40% d'accompte, qui sera
//    modifiable dans les parametre de société justement » ;
//  - case de l'écran, option choisie par Nelson dans l'outil de questions (libellé, texte de Claude Code) : « Cochée
//    d'office (Recommandé) » (prouvé par les tests de l'écran) ;
//  - conversion, option choisie par Nelson (libellé, texte de Claude Code) : « L'acompte ne bloque que le chantier » ;
//    description de l'option, texte de Claude Code : « Case cochée d'office, mais l'acompte exigé ne bloque que
//    l'ouverture d'un chantier ; une intervention SAV ou un contrat se créent sans attendre l'acompte (changement de la
//    règle de conversion). ».
// Lectures retenues du cadrage v3.1, à confirmer, prouvées telles quelles : une valeur vide (`null`, chaîne vide) prend le
// taux par défaut, la clé absente garde celui d'un devis déjà exigé ; à la création, une clé `acompteExige` absente reste
// « non exigé » (contrat de l'API inchangé) ; `EN_ATTENTE_ACOMPTE` ne retient plus que le chantier.
//
// Règles du cadrage prouvées ici, chacune par HTTP réel et relecture de la base :
//  - forme du taux (section 1) : nombre décimal de 0 à 100, au plus 3 chiffres avant la virgule et 2 après, virgule
//    admise ; refus 400 au message exact, sans aucune écriture ni numéro consommé, en session (chaque compte qui porte
//    devis:write) et par clé ; ordre : à la création avant « Client introuvable. », avant le 409 du pas non réglé et avant
//    la numérotation ; à la modification avant le 404 et les 409 ;
//  - valeur vide (`null`, chaîne vide après retrait des blancs) : taux par défaut ; clé absente : taux précédent si
//    l'acompte était exigé (modification), taux par défaut sinon ;
//  - 0 % envoyé avec un acompte exigé : 400 dans la transaction, après le 404, les 409, « Client introuvable. » et les
//    refus du temps passé ; 0 sans acompte exigé : admis, taux non enregistré ; taux par défaut réglé à 0 : aucun acompte
//    exigé (lot acompte, plus bas), le 0 envoyé restant refusé ;
//  - acompte encaissé : conditions reprises telles quelles (0 et 50 ignorés), forme invalide refusée ;
//  - devis inconnu (section 2) : 404 « Devis introuvable. » sur la modification, la révision, la signature, la
//    conversion et l'annulation en session, et par clé sur la modification, la révision et la conversion ; la forme du
//    corps passe d'abord ; les droits passent avant l'existence ;
//  - rafale (section 3) : des modifications simultanées au-delà du pool aboutissent toutes, au taux par défaut relu en
//    base (37,5 %, distinct de la valeur du schéma) ; ce test échoue sur `main` (lecture du taux par le client global
//    pendant la transaction) ;
//  - plafond de 100 % et taux par défaut à 37,5 % (tests de 78896b7, absents de `main`, repris) ;
//  - copie figée : révision, duplication, taux par défaut changé après coup ;
//  - lignes saisies à la virgule (section 4, « Ces valeurs sont envoyées brutes, puisque le serveur lit la virgule ») :
//    quantité « 1,5 », PU « 18,75 », TVA « 5,5 » enregistrées exactement ;
//  - lot acompte, section 1 : nouvelle installation à 40 % (base neuve de ce fichier), devis exigé à 40 % et son PDF ;
//  - lot acompte, section 2 : réglage à 0 %, en session (chaque compte qui écrit les devis) et par clé, montants relus en
//    base : création sans acompte ni taux, cas (a) à (e) des critères, duplication, inchangés (0 % envoyé refusé, taux
//    explicite enregistré), PDF sans acompte ;
//  - lot acompte, section 4 : conversion par cible, depuis `ACCEPTE` et depuis `EN_ATTENTE_ACOMPTE`, par chaque compte qui
//    convertit et par clé, avec les transitions de statut, la constatation et la liste « à convertir ».
// Chaque test qui règle le taux par défaut remet, dans un `finally`, la valeur lue au départ dans la base neuve (et non
// une valeur supposée du schéma).
//
// #570 (`suivi-audit`, note N5 du contrôle du cadrage du lot devis) : cadrage v2 du lot « case « acompte exigé » lue en
// booléen strict (#570) et taux à la virgule dans le refus du plafond d'un avoir (#572) », contrôlé ; règle 2 : la case
// décide si un devis porte un montant d'acompte. Lue par `!!body.acompteExige` avant le lot, la chaîne « false » exigeait
// un acompte au taux par défaut, et `null` décochait la case d'un devis exigé. Prouvé ici (dernière section) :
//  - clé présente : `true` ou `false` seuls admis, règles actuelles inchangées ; toute autre valeur (chaîne, nombre, `null`,
//    objet, tableau) répond 400 « « acompteExige » doit valoir true ou false. » (message proposé, règle 5, choix par défaut,
//    à confirmer), sans rien écrire ni consommer de numéro, en session par chaque compte qui écrit les devis et par clé ;
//  - `null` refusé (lecture retenue du cadrage, à confirmer), et non lu comme « absent » comme `auTempsPasse` ;
//  - clé absente : comportement actuel (création : non exigé ; modification : état du devis) ;
//  - ordre : après le 403 des droits, les refus de `devisPayload` (corps incomplet, ligne, `auTempsPasse`) et le taux
//    malformé ; avant « Client introuvable. », le 409 du pas non réglé, la numérotation, le 404 du devis inconnu, les 409
//    (signé, converti, statut) et le refus du 0 % ;
//  - acompte constaté (brouillon constaté, révision d'un devis signé constaté) : « false » refusé, `true` et `false` gardent
//    les conditions ;
//  - les routes qui ne lisent pas la case (révision, duplication, statut, constatation, conversion) l'ignorent.
//
// Fichier propre au lot, avec sa base jetable (#552 : suppression dans un `finally`, retentée, connexion administrative
// toujours fermée) : `node --test` exécute les fichiers en parallèle, api.test.mjs purge les données « TEST » de
// TEST_DATABASE_URL, et ce fichier change le taux d'acompte par défaut. TEST_DATABASE_URL ne sert ici que de connexion
// administrative : une base neuve est créée, migrée, servie à l'application montée en mémoire, puis supprimée. Sans
// TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { PDFParse } from 'pdf-parse';
import { empreinteBase, tablesChangees, tablesDeLaBase } from './matrice-droits/outils.mjs';

const TITRE = 'Lots devis et acompte : taux d’acompte refusé plutôt que remplacé, 0 % exigé refusé, devis inconnu en 404, taux par défaut lu avant la transaction (#252, #250/#240, #426) ; taux par défaut à 40 %, réglage à 0 % sans acompte, l’acompte ne retient que le chantier (décisions du 17-11-2026)';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// Refus du lot, mot pour mot (cadrage v3 et interfaces données par Claude Code), et refus existants qu'il range.
const REFUS = {
  taux: 'Le taux d’acompte doit être un pourcentage de 0 à 100, avec au plus deux décimales (par exemple 30 ou 37,5).',
  zero: 'Un acompte exigé ne peut pas être de 0 % : indiquez un taux, ou décochez « Exiger un acompte ».',
  introuvable: 'Devis introuvable.',
  client: 'Client introuvable.',
  corps: 'Client, objet et au moins une ligne sont requis.',
  signe: 'Ce devis est signé : créez une nouvelle révision brouillon pour le modifier.',
  nonModifiable: 'Seuls les devis brouillon ou envoyés, non signés, peuvent être modifiés.',
  pasNonRegle: 'Réglez d’abord le pas du temps passé dans l’administration (Administration > Marges & Commissions) : un devis au temps passé est refusé tant qu’il n’est pas fixé.',
  signataire: 'Le signataire et sa confirmation explicite sont obligatoires.',
  cible: 'Cible de conversion non disponible.',
  motif: 'Un motif d’annulation est obligatoire.',
  permission: 'Permission requise : devis:write',
  scope: 'Scope requis : devis:write',
  administration: 'Accès réservé aux administrateurs',
  cleRequise: 'Clé API Iris requise',
  session: 'Session expirée ou invalide',
  // Message du plafond avant le lot : il disparaît, la borne de 100 étant dans le contrôle de forme (cadrage, section 1).
  ancienPlafond: 'Le taux d’acompte ne peut pas dépasser 100 %.',
  // Conversion (lot acompte, section 4) : messages actuels du code, gardés pour le chantier (« Chantier : les étapes 3, 4
  // et 7 restent inchangées »), et refus inchangés de l'intervention et du contrat.
  chantierAcompteNonConstate: 'L’acompte exigé par ce devis n’a pas été constaté : le chantier ne peut pas être ouvert.',
  chantierAttendAcompte: 'Ce devis attend son acompte : le chantier ne peut pas encore être ouvert.',
  // Anciens refus de l'intervention et du contrat, que la décision 5 retire (lecture écartée par chaque test de conversion).
  interventionAcompteNonConstate: 'L’acompte exigé par ce devis n’a pas été constaté : l’intervention ne peut pas être créée.',
  contratAcompteNonConstate: 'L’acompte exigé par ce devis n’a pas été constaté : le contrat ne peut pas être créé.',
  interventionAttendAcompte: 'Ce devis attend son acompte : l’intervention ne peut pas encore être créée.',
  contratAttendAcompte: 'Ce devis attend son acompte : le contrat ne peut pas encore être créé.',
  statutFige: 'Ce devis est déjà converti : son statut ne change plus.',
  chantierOuvert: 'Le chantier de ce devis est déjà ouvert : seule une annulation peut revenir dessus.',
  // Route de statut : refus de #578 (correctif du contrôle avant fusion de #576) et refus existants qui le précèdent ou
  // l'encadrent.
  acompteDejaConstate: 'L’acompte de ce devis a déjà été constaté.',
  acompteNonConstate: 'L’acompte de ce devis n’a pas encore été constaté.',
  nExigePas: 'Ce devis n’exige pas d’acompte.',
  transitionBrouillonAttente: 'Transition BROUILLON → EN_ATTENTE_ACOMPTE interdite.',
  nonAccepte: 'Seul un devis accepté peut être converti.',
  nonSigne: 'Seul un devis signé en interne peut être converti.',
  versionPlusRecente: 'Seule la dernière version non annulée du dossier peut être convertie.',
  annuleIntervention: 'Ce devis est annulé : il ne peut plus créer d’intervention.',
  annuleContrat: 'Ce devis est annulé : il ne peut plus créer de contrat.',
  encadrementSav: 'Création réservée à l’encadrement SAV.',
  gestionContrats: 'La création d’un contrat de maintenance est réservée à l’administration et à l’assistante technique.',
  sessionSeule: 'Une intervention ou un contrat ne se crée depuis un devis que dans une session de l’application.',
  // Contrat (rang 1) puis intervention (rang 2) : les conversions sont nommées dans leur ordre.
  deuxConversions: 'Ce devis a déjà créé son contrat et son intervention : une affaire se convertit au plus deux fois.',
  // #570 : refus de la case, mot pour mot (cadrage v2, périmètre 1, « Message proposé »), et refus existants qui
  // l'encadrent dans l'ordre des contrôles.
  acompteExige: '« acompteExige » doit valoir true ou false.',
  auTempsPasse: '« auTempsPasse » doit valoir true ou false.',
  ligne: 'Ligne de devis invalide.',
  converti: 'Ce devis est déjà converti : il ne peut plus être modifié.',
};

// #570 : valeurs non booléennes de la case, refusées (400) quand la clé est présente (cadrage v2, périmètre 1 : « toute
// autre valeur répond 400, sans rien écrire : chaîne, nombre, `null`, objet ou tableau »). Chaque commentaire dit ce que
// `!!body.acompteExige` en faisait avant le lot (sonde du cadrage sur `289dc67`) et la lecture que le refus écarte.
const CASES_REFUSEES = [
  ['« false » (chaîne)', 'false'], // avant : exigé au taux par défaut, le défaut même de #570 ; écarte `!!` rétabli.
  ['« true » (chaîne)', 'true'], // avant : exigé ; écarte une chaîne « true » admise comme vrai.
  ['0 (nombre)', 0], // avant : non exigé ; écarte une lecture des nombres 0 et 1 comme booléens.
  ['1 (nombre)', 1], // avant : exigé.
  ['null', null], // avant : non exigé, et case décochée en modification ; écarte `null` lu comme faux, et `null` lu comme
  // absent (comme `auTempsPasse` du même corps), qui garderait en silence un acompte exigé.
  ['{} (objet)', {}], // avant : exigé.
  ['[] (tableau)', []], // avant : exigé.
  ['« 0 » (chaîne)', '0'], // constat du cadrage : exigé avant.
  ['« non » (chaîne)', 'non'], // constat du cadrage : exigé avant.
  ['« » (chaîne vide)', ''], // avant : non exigé ; écarte une chaîne vide lue comme absente, à la manière du taux vide.
  ['[true] (tableau)', [true]], // écarte une lecture du premier élément.
];
// Valeurs jouées par chacun des autres comptes : la chaîne « false » (défaut de #570) et `null` (changement observable).
const CASES_REFUSEES_COURTES = CASES_REFUSEES.filter(([quoi]) => ['« false » (chaîne)', 'null'].includes(quoi));

// Formes admises (cadrage, section 1 et critères « « 37,5 » et 100 sont admis et relus en base, en décimal exact »).
// [libellé, valeur envoyée, attendu en base (toString du Decimal(5,2)), attendu dans la réponse]. `{ brut }` : écrit tel
// quel dans le texte JSON (le nombre JSON 1e2). Chaque commentaire dit la lecture écartée ; le taux par défaut vaut 40 dans
// la base neuve (décision du 17-11-2026 ; 30 avant elle, 37,5 dans les tests qui le règlent), distinct de chaque attendu :
// un retour au taux par défaut se voit toujours.
const FORMES_ADMISES = [
  ['« 37,5 » (virgule)', '37,5', '37.5', 37.5], // critère du cadrage ; écarte `parseFloat` (37), une virgule lue en séparateur de milliers (375, hors bornes), un arrondi à l'unité (38) et le taux par défaut (30).
  ['« 37.5 » (point)', '37.5', '37.5', 37.5], // le point reste admis.
  ['37.5 (nombre)', 37.5, '37.5', 37.5], // nombre JSON, jugé sur son écriture décimale.
  ['« 12,25 »', '12,25', '12.25', 12.25], // au centième : écarte un arrondi au dixième (12,3 au demi supérieur, 12,2 au pair) et une troncature (12,2).
  ['« 0,01 »', '0,01', '0.01', 0.01], // plus petit taux non nul : écarte un arrondi à l'unité (0, alors refusé comme 0 %) et un refus de tout taux inférieur à 1.
  ['« 99,99 »', '99,99', '99.99', 99.99], // écarte un arrondi à l'unité (100) et un plafond strict mal placé (≤ 99).
  ['100 (nombre)', 100, '100', 100], // critère du cadrage ; borne incluse : écarte un plafond strict (< 100).
  ['« 100,00 »', '100,00', '100', 100], // borne écrite au centième : écarte une comparaison de texte (« 100,00 » > « 100 »).
  ['1e2 (nombre JSON en notation scientifique)', { brut: '1e2' }, '100', 100], // cadrage : « le nombre JSON `1e2` vaut 100 et reste admis » ; écarte un refus du nombre selon son écriture dans le texte JSON.
  ['« 37,5 » entouré de blancs', ' 37,5 ', '37.5', 37.5], // blancs retirés avant la lecture, comme pour tous les montants.
  ['« 7 »', '7', '7', 7], // un seul chiffre.
];

// Formes refusées (cadrage, section 1 : « abc », -5, « 12,345 », 1000, 100,01, la chaîne « 1e2 », un booléen ou un objet),
// qu'un acompte soit exigé ou non : 400 au message exact, sans aucune écriture. Avant le lot, toutes sauf 100,01 donnaient
// en silence le taux par défaut (30) ; 100,01 était refusé par l'ancien message du plafond.
const FORMES_REFUSEES = [
  ['« abc »', 'abc'], // cité par la question de Nelson ; avant : 30 en silence.
  ['-5 (nombre)', -5], // cité par la question ; écarte aussi une valeur absolue (5).
  ['« -5 »', '-5'], // idem, en chaîne.
  ['« 12,345 »', '12,345'], // trois décimales : écarte un arrondi (12,35) et une troncature (12,34).
  ['1000 (nombre)', 1000], // cité par la question ; quatre chiffres : écarte un plafonnement à 100 au lieu du refus.
  ['« 100,01 »', '100,01'], // un centième au-delà de 100 : écarte un plafond retiré ou arrondi à l'unité (100).
  ['100.01 (nombre)', 100.01], // idem, en nombre JSON.
  ['« 101 »', '101'], // trois chiffres admis par la forme, au-delà de la borne : écarte un contrôle de forme sans la borne de 100.
  ['« 1e2 » (chaîne)', '1e2'], // cadrage : la chaîne « 1e2 » est refusée ; écarte `Number('1e2')` (100).
  ['true', true], // booléen : écarte une lecture booléen = 1.
  ['false', false], // booléen : écarte une lecture de `false` comme valeur vide (taux par défaut).
  ['{} (objet)', {}], // objet.
  ['["30"] (tableau)', ['30']], // écarte une lecture du premier élément (30).
  ['« 37,5 % »', '37,5 %'], // le signe % n'est pas lu.
  ['« 0100 » (quatre chiffres)', '0100'], // au plus trois chiffres avant la virgule (cadrage, section 1), zéros de tête compris : écarte un contrôle
  // de la seule valeur (≤ 100) ou une forme à quatre chiffres et plus (audit des montants de #571, mutant S06).
  ['« 0037,5 » (zéros de tête)', '0037,5'], // idem.
];

// Le 0 sous ses écritures (cadrage : « Le refus vise un taux **envoyé** égal à 0 »).
const FORMES_ZERO = [
  ['0 (nombre)', 0],
  ['« 0 »', '0'],
  ['« 0,00 »', '0,00'],
  ['« 0.0 »', '0.0'],
  ['« 000 »', '000'],
  ['« 0 » entouré de blancs', ' 0 '],
];

// Valeurs vides (cadrage : « `tauxAcompte` est « vide » s'il vaut `null` ou une chaîne vide après `trim` »).
const FORMES_VIDES = [['null', null], ['« » (chaîne vide)', ''], ['chaîne de blancs', '   ']];

// Identité de la société, nécessaire à la signature d'un devis (lot 6a-2) ; mêmes valeurs que la matrice des droits.
const SOCIETE = {
  raisonSociale: 'TEST Société lot devis', nomCommercial: '', siret: '73282932000074', tvaIntra: '',
  adresse: '1 rue des Devis', codePostal: '14000', ville: 'Caen', pays: 'France', telephone: '02 31 00 00 02',
  email: 'societe-lot-devis@iris.test', siteWeb: '', piedFacture: 'TEST Pied lot devis', couleurPrimaire: '#0f766e', fuseauHoraire: 'Europe/Paris',
};

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_devis_acompte_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;
    // Nombre de requêtes de la rafale (formule de 78896b7, N1 de l'audit de #250) : au-delà du pool de Prisma, qui ouvre
    // au plus 2 × cœurs physiques + 1 connexions, ou le connection_limit de l'adresse de l'application quand elle le fixe.
    const auDelaDuPool = Math.max(2 * cpus().length + 2, (Number(cible.searchParams.get('connection_limit')) || 0) + 1);

    let request; let app; let prisma; let appPrisma; let jwt; let jourCivilEntreprise;
    let tables = [];
    let rang = 0;
    const suffixe = () => `${Date.now()}-${(rang += 1)}`;
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const comptes = {};
    const cles = {};
    let client = null;
    let mainOeuvre = null;
    // Taux d'acompte par défaut lu dans la base neuve avant tout test (lot acompte : 40, valeur du schéma depuis la
    // migration 20261117120000) ; chaque test qui règle le taux le remet à cette valeur.
    let tauxDeDepart = null;

    // --- Comptes ---
    const creerCompte = async (role, cle, extra = {}) => {
      const s = suffixe();
      const compte = await prisma.user.create({ data: { email: `devis-acompte.${cle.toLowerCase().replace(/[^a-z0-9]/g, '-')}.${s}@iris.test`, name: `TEST ${cle} ${s}`, role, ...extra } });
      return { ...compte, auth: entete(jwt.sign({ id: compte.id }, process.env.JWT_SECRET)) };
    };
    // Comptes qui portent devis:write (matrice entrees.txt : SA, AD, AD-COM, DIR, AT, COM, DC, AC, CPT, CPT-FINANCE), et un
    // conducteur de travaux à qui le droit individuel devis:write est donné : la règle du taux vaut pour chacun.
    const ECRIVENT = () => ['SA', 'AD', 'AD-COM', 'DIR', 'AT', 'COM', 'DC', 'AC', 'CPT', 'CT+devis:write'].map((cle) => [cle, comptes[cle].auth]);
    // Comptes sans devis:write : refusés (403) avant toute lecture du corps.
    const SANS_DROIT = () => ['CT', 'RESP', 'TECH'].map((cle) => [cle, comptes[cle].auth]);
    const SA = () => comptes.SA.auth;

    // --- Appels ---
    // Session : /api/devis ; clé : /api/v1/devis (routes mixtes, portée devis:write). Le corps est calculé avant la requête.
    const appeler = (methode, chemin, corps, auth = SA()) => request(app)[methode](chemin).set(auth).send(corps ?? {});
    // Corps JSON écrit à la main, pour un nombre en notation scientifique (`{ brut: '1e2' }`) que JSON.stringify réécrirait.
    const appelerBrut = (methode, chemin, texte, auth) => request(app)[methode](chemin).set(auth).set('Content-Type', 'application/json').send(texte);
    const PORTES = { session: '/api/devis', cle: '/api/v1/devis' };
    const ligneLibre = (extra = {}) => ({ designation: 'TEST Pose du lot devis', nature: 'MAIN_OEUVRE', quantite: 2, prixUnitaireHt: 100, tauxTva: 20, ...extra });
    const corpsDevis = (extra = {}) => ({ clientId: client.id, objet: `TEST Devis acompte ${suffixe()}`, lignes: [ligneLibre()], ...extra });
    // Corps avec un taux : `{ brut }` donne un texte JSON où le taux est écrit tel quel.
    const envoyerTaux = (methode, chemin, corps, taux, auth) => {
      if (taux && typeof taux === 'object' && 'brut' in taux) {
        const texte = JSON.stringify({ ...corps, tauxAcompte: '__TAUX__' }).replace('"__TAUX__"', taux.brut);
        return appelerBrut(methode, chemin, texte, auth);
      }
      return appeler(methode, chemin, { ...corps, tauxAcompte: taux }, auth);
    };
    const creer = (corps, auth = SA(), porte = PORTES.session) => appeler('post', porte, corps, auth);
    const modifier = (id, corps, auth = SA(), porte = PORTES.session) => appeler('patch', `${porte}/${id}`, corps, auth);
    const ok = async (reponse, statut = 200) => {
      const res = await reponse;
      assert.equal(res.status, statut, `${res.req?.method} ${res.req?.path} : ${JSON.stringify(res.body)}`);
      return res.body;
    };
    const creerOk = async (extra = {}, auth = SA()) => ok(creer(corpsDevis(extra), auth), 201);

    // --- État de la base ---
    // Toute la base, contenu compris ; la dernière utilisation d'une clé, notée sans attente par la porte /api/v1, est
    // retirée de l'empreinte (comme la matrice des clés, D1a-2) : elle n'est pas une écriture du devis.
    const empreinte = () => empreinteBase(prisma, tables, { colonnesIgnorees: { ApiAccessKey: ['dernierUsageLe'] } });
    // Un refus : statut, message exact, et l'empreinte de toute la base inchangée (devis, lignes, numérotation, journaux…).
    const refuse = async (appel, statut, message, quoi) => {
      const avant = await empreinte();
      const res = await appel();
      assert.equal(res.status, statut, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, message, quoi);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      return res;
    };
    const conditions = async (id) => {
      const d = await prisma.devis.findUniqueOrThrow({ where: { id } });
      return { acompteExige: d.acompteExige, tauxAcompte: d.tauxAcompte === null ? null : d.tauxAcompte.toString() };
    };
    const reglerTauxParDefaut = async (taux) => {
      const res = await appeler('put', '/api/parametres', { tauxAcompteDefaut: taux });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal((await prisma.parametres.findUniqueOrThrow({ where: { id: 'singleton' } })).tauxAcompteDefaut.toString(), String(taux).replace(',', '.'));
    };
    // Le taux par défaut revient à la valeur lue au départ, même si une assertion échoue (N4 de l'audit de #250 ; lot
    // acompte, section « Tests » : « remettent désormais la valeur lue au départ, sans supposer celle du schéma »).
    const avecTauxParDefaut = async (taux, corps) => {
      try {
        await reglerTauxParDefaut(taux);
        await corps();
      } finally {
        await reglerTauxParDefaut(tauxDeDepart);
      }
    };
    // PDF d'un devis (GET /api/devis/:id/document.pdf, session), en texte.
    const textePdf = async (id, auth = SA()) => {
      const res = await request(app).get(`/api/devis/${id}/document.pdf`).set(auth).buffer(true)
        .parse((reponse, fin) => { const morceaux = []; reponse.on('data', (m) => morceaux.push(m)); reponse.on('end', () => fin(null, Buffer.concat(morceaux))); });
      assert.equal(res.status, 200, String(res.body));
      assert.equal(res.headers['content-type'], 'application/pdf');
      const lecteur = new PDFParse({ data: res.body });
      try { return (await lecteur.getText()).text; } finally { await lecteur.destroy(); }
    };
    const aujourdhui = async () => {
      const societe = await prisma.companySettings.findUnique({ where: { id: 'singleton' } });
      return jourCivilEntreprise(new Date(), societe?.fuseauHoraire || 'Europe/Paris').split('-').reverse().join('-');
    };
    const signer = (id, auth = SA()) => ok(appeler('post', `/api/devis/${id}/signature`, { signataire: 'TEST Signataire lot devis', confirme: true }, auth), 201);
    const refuser = async (id) => {
      await ok(appeler('put', `/api/devis/${id}/statut`, { statut: 'ENVOYE' }));
      await ok(appeler('put', `/api/devis/${id}/statut`, { statut: 'REFUSE' }));
    };

    before(async () => {
      assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname), 'seul un PostgreSQL local est autorisé');
      assert.notEqual(source.pathname.slice(1), nomBase);
      await administrationPg.connect();
      await administrationPg.query(`CREATE DATABASE "${nomBase}"`);
      baseCreee = true;
      const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');
      execFileSync(resolve(dossierServeur, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', resolve(dossierServeur, 'prisma/schema.prisma')], {
        env: { ...process.env, DATABASE_URL: cible.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
      });
      process.env.DATABASE_URL = cible.toString();
      process.env.NODE_ENV = 'test';
      process.env.JWT_SECRET = 'secret-de-test-uniquement';
      process.env.BREAK_GLASS_EMAIL = 'secours@iris.test';
      process.env.BREAK_GLASS_TOKEN = 'jeton-de-secours-de-test-au-moins-32-caracteres';
      process.env.SUPERADMIN_EMAILS = 'secours@iris.test';
      request = (await import('supertest')).default;
      const serveur = await import('../dist/index.js');
      app = serveur.app;
      appPrisma = serveur.prisma;
      jourCivilEntreprise = serveur.jourCivilEntreprise;
      const { PrismaClient } = await import('@prisma/client');
      prisma = new PrismaClient({ datasources: { db: { url: cible.toString() } } });
      jwt = (await import('jsonwebtoken')).default;
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      const secours = await prisma.user.findUniqueOrThrow({ where: { email: 'secours@iris.test' } });
      comptes.SA = { ...secours, auth: entete(connexion.body.token) };
      assert.equal(secours.role, 'SUPERADMIN', 'le compte de secours est super administrateur');
      comptes.AD = await creerCompte('ADMIN', 'AD');
      comptes['AD-COM'] = await creerCompte('ADMIN', 'AD-COM', { estCommercial: true });
      for (const [cle, role] of [
        ['DIR', 'DIRECTEUR'], ['AT', 'ASSISTANTE_TECHNIQUE'], ['COM', 'COMMERCIAL'], ['DC', 'DIRECTEUR_COMMERCIAL'], ['AC', 'ASSISTANTE_COMMERCIALE'],
        ['CPT', 'COMPTABLE'], ['CT', 'CONDUCTEUR_TRAVAUX'], ['RESP', 'RESPONSABLE'], ['TECH', 'TECHNICIEN'],
      ]) comptes[cle] = await creerCompte(role, cle);
      comptes['CT+devis:write'] = await creerCompte('CONDUCTEUR_TRAVAUX', 'CT-DEVIS', { permissions: ['devis:write'] });
      // Clés d'intégration : la portée des routes du devis, et une autre portée, refusée.
      for (const [nom, scopes] of [['devis', ['devis:write']], ['autre', ['devis:read']]]) {
        const cle = await ok(appeler('post', '/api/admin/api-keys', { nom: `TEST Clé lot devis ${nom}`, scopes }), 201);
        cles[nom] = entete(cle.apiKey);
      }
      // Identité de la société et du client : la signature d'un devis les exige (lots 6a-2 et 6a-2 bis).
      await ok(appeler('put', '/api/company', SOCIETE));
      client = await ok(appeler('post', '/api/clients', { raisonSociale: `TEST Client lot devis ${suffixe()}`, siren: String(randomInt(100_000_000, 1_000_000_000)) }), 201);
      await ok(appeler('post', `/api/clients/${client.id}/sites`, { nom: 'TEST Facturation lot devis', adresse: '3 rue de l’Acompte', codePostal: '14000', ville: 'Caen', estSiteFacturation: true }), 201);
      // Main d'œuvre pour une ligne au temps passé (refus du pas non réglé : base neuve, pas vide).
      mainOeuvre = await ok(appeler('post', '/api/catalogue/prestations', {
        estMainOeuvre: true, reference: `TEST-LOT-DEVIS-MO-${suffixe()}`, nom: 'TEST Main d’œuvre du lot devis', tauxTva: '20',
        prixVenteHt: '45.50', prixJourHorsContratHt: '320', prixHeureSousContratHt: '40', prixJourSousContratHt: '280.25', heuresParJour: '7.5',
      }), 201);
      const parametres = await prisma.parametres.findUniqueOrThrow({ where: { id: 'singleton' } });
      // Valeur lue, éprouvée par le test « nouvelle installation » (40 %) ; les tests qui règlent le taux y reviennent.
      tauxDeDepart = parametres.tauxAcompteDefaut.toString();
      assert.equal(parametres.pasTempsPasseMinutes, null, 'pas du temps passé vide dans une base neuve');
      tables = await tablesDeLaBase(prisma);
      assert.ok(tables.includes('Devis') && tables.includes('DevisLigne') && tables.includes('SequenceAffaire') && tables.length > 40, `tables relevées : ${tables.join(', ')}`);
    });

    // #552 : la connexion administrative est fermée même si la suppression de la base échoue ; la suppression est retentée.
    after(async () => {
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      try {
        for (let essai = 1; baseCreee; essai += 1) {
          try {
            await administrationPg.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`);
            baseCreee = false;
          } catch (erreur) {
            if (essai >= 3) throw erreur;
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      } finally {
        await administrationPg.end().catch(() => {});
      }
    });

    // ==================================================================================================================
    // Section 1 : forme du taux d'acompte envoyé (#252 N2).
    // ==================================================================================================================

    // Cadrage, critère « Taux valides : « 37,5 » et 100 sont admis et relus en base, en décimal exact », en session par
    // chaque compte qui porte devis:write et par clé. Les lectures écartées sont dans FORMES_ADMISES.
    test('création : chaque forme admise du taux (virgule, point, nombre, 1e2, bornes 0,01 et 100) est enregistrée exactement, en session par chaque compte qui écrit les devis et par clé', async () => {
      for (const [compte, auth, porte] of [...ECRIVENT().map(([c, a]) => [c, a, PORTES.session]), ['clé devis:write', cles.devis, PORTES.cle]]) {
        for (const [quoi, valeur, enBase, enReponse] of FORMES_ADMISES) {
          const res = await envoyerTaux('post', porte, corpsDevis({ acompteExige: true }), valeur, auth);
          assert.equal(res.status, 201, `${compte}, ${quoi} : ${JSON.stringify(res.body)}`);
          assert.equal(res.body.tauxAcompte, enReponse, `${compte}, ${quoi} : réponse`);
          assert.deepEqual(await conditions(res.body.id), { acompteExige: true, tauxAcompte: enBase }, `${compte}, ${quoi} : en base`);
        }
      }
    });

    // Cadrage, section 1 : « Sinon : 400, rien n'est écrit, et à la création aucun numéro n'est consommé » ; critère « Taux
    // invalide (…) en session comme par clé. La base ne change pas : nombre de devis, numérotation, taux, lignes » ;
    // « contrôlée qu'un acompte soit exigé ou non ». Toutes les formes pour SA et la clé ; deux formes (« abc », 101) pour
    // chaque autre compte. L'empreinte couvre toute la base, SequenceAffaire comprise.
    test('création : taux invalide refusé (400, message exact), acompte exigé ou non, sans écriture ni numéro consommé, en session par chaque compte et par clé', async () => {
      const joueurs = [
        ['SA', SA(), PORTES.session, FORMES_REFUSEES],
        ['clé devis:write', cles.devis, PORTES.cle, FORMES_REFUSEES],
        ...ECRIVENT().filter(([c]) => c !== 'SA').map(([c, a]) => [c, a, PORTES.session, FORMES_REFUSEES.filter(([q]) => ['« abc »', '« 101 »'].includes(q))]),
      ];
      const sequenceAvant = await prisma.sequenceAffaire.findMany();
      for (const [compte, auth, porte, formes] of joueurs) {
        for (const exige of [true, false]) {
          for (const [quoi, valeur] of formes) {
            await refuse(() => appeler('post', porte, { ...corpsDevis({ acompteExige: exige }), tauxAcompte: valeur }, auth), 400, REFUS.taux, `${compte}, acompte ${exige ? 'exigé' : 'non exigé'}, ${quoi}`);
          }
        }
      }
      assert.deepEqual(await prisma.sequenceAffaire.findMany(), sequenceAvant, 'aucun numéro d’affaire consommé');
    });

    // Cadrage, section 1, « Ordre des refus », création : « le contrôle de forme a lieu juste après `devisPayload`, avant
    // « Client introuvable », avant le 409 « pas non réglé » (`routes.ts:76`) et avant la numérotation (`:81`) ». Écarte un
    // contrôle placé dans l'appel d'origine (après le client et le temps passé). Un corps sans ligne reste refusé d'abord.
    test('création : la forme du taux est contrôlée avant « Client introuvable. », avant le 409 du pas non réglé et avant la numérotation ; un corps incomplet reste refusé d’abord', async () => {
      const ligneTp = { tempsPasse: true, designation: 'TEST Main d’œuvre au temps passé', quantite: 1, tarifTempsPasse: 'HORS_CONTRAT', catalogueFamille: 'prestations', catalogueId: mainOeuvre.id };
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        await refuse(() => appeler('post', porte, { ...corpsDevis({ acompteExige: true, tauxAcompte: 'abc' }), clientId: randomUUID() }, auth), 400, REFUS.taux, `${qui} : client inconnu et « abc »`);
        // Témoin : sans le taux invalide, le client inconnu est bien refusé.
        await refuse(() => appeler('post', porte, { ...corpsDevis({ acompteExige: true, tauxAcompte: '30' }), clientId: randomUUID() }, auth), 400, REFUS.client, `${qui} : client inconnu, taux valide`);
        await refuse(() => appeler('post', porte, corpsDevis({ auTempsPasse: true, lignes: [ligneTp], acompteExige: true, tauxAcompte: '1000' }), auth), 400, REFUS.taux, `${qui} : pas non réglé et 1000`);
        // Témoin : sans le taux invalide, le pas non réglé est bien refusé (409).
        await refuse(() => appeler('post', porte, corpsDevis({ auTempsPasse: true, lignes: [ligneTp], acompteExige: true, tauxAcompte: '30' }), auth), 409, REFUS.pasNonRegle, `${qui} : pas non réglé, taux valide`);
        await refuse(() => appeler('post', porte, { clientId: client.id, objet: 'TEST Sans ligne', lignes: [], acompteExige: true, tauxAcompte: 'abc' }, auth), 400, REFUS.corps, `${qui} : corps sans ligne et « abc »`);
      }
    });

    // Cadrage, section 1 : mêmes formes admises à la modification (un devis exigé à 35 %, chaque forme écrite puis relue ;
    // la valeur précédente change à chaque fois, la relecture prouve l'écriture), en session et par clé.
    test('modification : chaque forme admise du taux est enregistrée exactement, en session par chaque compte qui écrit les devis et par clé', async () => {
      for (const [compte, auth, porte] of [...ECRIVENT().map(([c, a]) => [c, a, PORTES.session]), ['clé devis:write', cles.devis, PORTES.cle]]) {
        const devis = await creerOk({ acompteExige: true, tauxAcompte: 35 });
        for (const [quoi, valeur, enBase, enReponse] of FORMES_ADMISES) {
          await prisma.devis.update({ where: { id: devis.id }, data: { tauxAcompte: '35' } });
          const res = await envoyerTaux('patch', `${porte}/${devis.id}`, corpsDevis({ objet: devis.objet }), valeur, auth);
          assert.equal(res.status, 200, `${compte}, ${quoi} : ${JSON.stringify(res.body)}`);
          assert.equal(res.body.tauxAcompte, enReponse, `${compte}, ${quoi} : réponse`);
          assert.deepEqual(await conditions(devis.id), { acompteExige: true, tauxAcompte: enBase }, `${compte}, ${quoi} : en base`);
        }
      }
    });

    // Cadrage, section 1 : à la modification, refus 400 sans écriture, acompte exigé ou non (devis exigé à 35 %, devis non
    // exigé) ; requête mêlée (objet et lignes changés) : rien n'est écrit, pas même l'objet. Toutes les formes pour SA et la
    // clé ; « abc » et 101 pour chaque autre compte.
    test('modification : taux invalide refusé (400, message exact), acompte exigé ou non, sans écriture, en session par chaque compte et par clé', async () => {
      const exigeA35 = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      const nonExige = await creerOk({ acompteExige: false });
      const joueurs = [
        ['SA', SA(), PORTES.session, FORMES_REFUSEES],
        ['clé devis:write', cles.devis, PORTES.cle, FORMES_REFUSEES],
        ...ECRIVENT().filter(([c]) => c !== 'SA').map(([c, a]) => [c, a, PORTES.session, FORMES_REFUSEES.filter(([q]) => ['« abc »', '« 101 »'].includes(q))]),
      ];
      for (const [compte, auth, porte, formes] of joueurs) {
        for (const [quoi, valeur] of formes) {
          for (const [devis, corps, cas] of [
            [exigeA35, { acompteExige: true }, 'devis exigé à 35 %, acompte exigé'],
            [exigeA35, {}, 'devis exigé à 35 %, sans la case'],
            [nonExige, { acompteExige: false }, 'devis non exigé'],
            [nonExige, { acompteExige: true }, 'devis non exigé, acompte exigé'],
          ]) {
            const envoye = { ...corpsDevis({ objet: `TEST Objet changé ${suffixe()}`, lignes: [ligneLibre({ quantite: 3 })] }), ...corps, tauxAcompte: valeur };
            await refuse(() => appeler('patch', `${porte}/${devis.id}`, envoye, auth), 400, REFUS.taux, `${compte}, ${cas}, ${quoi}`);
          }
        }
      }
      assert.deepEqual(await conditions(exigeA35.id), { acompteExige: true, tauxAcompte: '35' });
      assert.deepEqual(await conditions(nonExige.id), { acompteExige: false, tauxAcompte: null });
    });

    // Cadrage, section 1, « Ordre des refus », modification : « il a lieu avant la transaction, comme celui des lignes. Une
    // valeur mal formée répond donc 400 avant le 404 et les 409 » (la forme avant l'existence ; #393 ne s'applique pas
    // ici). Devis inconnu, devis signé, devis refusé ; chacun avec son témoin (taux valide : 404 ou 409).
    test('modification : la forme du taux est contrôlée avant le 404 du devis inconnu et les 409 du devis signé ou refusé, en session et par clé', async () => {
      const signe = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      await signer(signe.id);
      const refuse409 = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      await refuser(refuse409.id);
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        for (const [id, temoinStatut, temoinMessage, cas] of [
          [randomUUID(), 404, REFUS.introuvable, 'devis inconnu'],
          [signe.id, 409, REFUS.signe, 'devis signé'],
          [refuse409.id, 409, REFUS.nonModifiable, 'devis refusé'],
        ]) {
          await refuse(() => modifier(id, corpsDevis({ acompteExige: true, tauxAcompte: 'abc' }), auth, porte), 400, REFUS.taux, `${qui}, ${cas}, « abc »`);
          await refuse(() => modifier(id, corpsDevis({ acompteExige: false, tauxAcompte: '100,01' }), auth, porte), 400, REFUS.taux, `${qui}, ${cas}, « 100,01 » sans acompte exigé`);
          await refuse(() => modifier(id, corpsDevis({ acompteExige: true, tauxAcompte: '30' }), auth, porte), temoinStatut, temoinMessage, `${qui}, ${cas}, témoin au taux valide`);
        }
      }
    });

    // Tests de 78896b7 (#250, C2 de son audit), repris : création à 100,01 refusée, à 100 admise ; modification à 150
    // refusée sans rien écrire. Le message est désormais celui du contrôle de forme, et l'ancien message du plafond n'est plus
    // servi (cadrage : « Le message du plafond (`metier.ts:319`) devient inatteignable : il est retiré »).
    test('plafond : le taux d’acompte d’un devis ne dépasse jamais 100 %, à la création comme à la modification, avec le message du contrôle de forme', async () => {
      const lignes = [ligneLibre({ quantite: 1 })];
      const creation = await refuse(() => creer({ clientId: client.id, objet: 'TEST Acompte plafonné', acompteExige: true, tauxAcompte: 100.01, lignes }), 400, REFUS.taux, 'création à 100,01');
      assert.notEqual(creation.body.error, REFUS.ancienPlafond);
      const cree = await ok(creer({ clientId: client.id, objet: 'TEST Acompte plafonné', acompteExige: true, tauxAcompte: 100, lignes }), 201);
      assert.equal(cree.tauxAcompte, 100);
      const modification = await refuse(() => modifier(cree.id, { clientId: client.id, objet: 'TEST Acompte plafonné modifié', tauxAcompte: 150, lignes }), 400, REFUS.taux, 'modification à 150');
      assert.notEqual(modification.body.error, REFUS.ancienPlafond);
      const relu = await prisma.devis.findUniqueOrThrow({ where: { id: cree.id } });
      assert.deepEqual([relu.tauxAcompte.toString(), relu.objet], ['100', 'TEST Acompte plafonné'], 'le refus ne modifie ni le taux ni le devis');
    });

    // ==================================================================================================================
    // Valeur vide ou clé absente : comportement actuel conservé (cadrage, section 1, « Valeur vide »).
    // ==================================================================================================================

    // Cadrage, test nommé : « `null` et `""` en modification d'un devis exigé à 35 %, avec un taux par défaut à 30 %,
    // donnent 30 % ; la clé absente garde 35 % ». Rejoué avec un taux par défaut à 37,5 % : écarte une constante 30 dans le
    // code. Lectures écartées : vide traité comme absent (35 au lieu du défaut) ; absent traité comme vide (défaut au lieu
    // de 35) ; vide refusé comme une forme invalide (400).
    test('modification : un taux vide (null, chaîne vide, blancs) prend le taux par défaut (30 %, puis 37,5 %), la clé absente garde 35 %, en session et par clé', async () => {
      for (const [defaut, attendu] of [[30, '30'], ['37,5', '37.5']]) {
        await avecTauxParDefaut(defaut, async () => {
          for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
            for (const [quoi, valeur] of FORMES_VIDES) {
              for (const corps of [{ acompteExige: true }, {}]) {
                const devis = await creerOk({ acompteExige: true, tauxAcompte: 35 });
                const res = await ok(modifier(devis.id, corpsDevis({ objet: devis.objet, ...corps, tauxAcompte: valeur }), auth, porte));
                assert.equal(res.tauxAcompte, Number(attendu), `${qui}, défaut ${defaut}, ${quoi}, ${JSON.stringify(corps)} : réponse`);
                assert.deepEqual(await conditions(devis.id), { acompteExige: true, tauxAcompte: attendu }, `${qui}, défaut ${defaut}, ${quoi}, ${JSON.stringify(corps)}`);
              }
            }
            for (const corps of [{ acompteExige: true }, {}]) {
              const devis = await creerOk({ acompteExige: true, tauxAcompte: 35 });
              const res = await ok(modifier(devis.id, corpsDevis({ objet: `TEST Objet changé ${suffixe()}`, ...corps }), auth, porte));
              assert.equal(res.tauxAcompte, 35, `${qui}, défaut ${defaut}, clé absente, ${JSON.stringify(corps)} : réponse`);
              assert.deepEqual(await conditions(devis.id), { acompteExige: true, tauxAcompte: '35' }, `${qui}, défaut ${defaut}, clé absente, ${JSON.stringify(corps)} : le taux négocié est gardé`);
            }
          }
        });
      }
    });

    // Cadrage, section 1 : « un taux absent (…) garde le taux précédent en modification si l'acompte était déjà exigé, sinon
    // il prend le taux par défaut ; à la création, il prend le taux par défaut » ; un taux vide aussi. Taux par défaut à
    // 37,5 %. Écarte une lecture qui garderait un taux précédent nul (devis non exigé) ou qui renverrait null.
    test('création et passage à l’acompte exigé : un taux absent ou vide prend le taux par défaut (37,5 %) ; sans acompte exigé, aucun taux n’est enregistré', async () => {
      await avecTauxParDefaut('37,5', async () => {
        for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
          for (const [quoi, extra] of [['clé absente', {}], ...FORMES_VIDES.map(([q, v]) => [q, { tauxAcompte: v }])]) {
            const cree = await ok(creer(corpsDevis({ acompteExige: true, ...extra }), auth, porte), 201);
            assert.equal(cree.tauxAcompte, 37.5, `${qui}, création, ${quoi}`);
            assert.deepEqual(await conditions(cree.id), { acompteExige: true, tauxAcompte: '37.5' }, `${qui}, création, ${quoi}`);
            const sansAcompte = await ok(creer(corpsDevis({ acompteExige: false, ...extra }), auth, porte), 201);
            assert.deepEqual(await conditions(sansAcompte.id), { acompteExige: false, tauxAcompte: null }, `${qui}, création sans acompte, ${quoi}`);
            const nonExige = await creerOk({ acompteExige: false });
            await ok(modifier(nonExige.id, corpsDevis({ objet: nonExige.objet, acompteExige: true, ...extra }), auth, porte));
            assert.deepEqual(await conditions(nonExige.id), { acompteExige: true, tauxAcompte: '37.5' }, `${qui}, passage à l’acompte exigé, ${quoi}`);
          }
        }
      });
    });

    // ==================================================================================================================
    // 0 % envoyé avec un acompte exigé (décision de Nelson du 16-11-2026, « Refuser 0 % (Recommandé) »).
    // ==================================================================================================================

    // Cadrage : « Le refus vise un taux **envoyé** égal à 0, quand l'acompte effectivement exigé (celui du corps, ou celui du
    // devis précédent si la clé est absente) est vrai » ; « À la création, le refus a lieu (…) avant la numérotation (`:81`),
    // sans consommer de numéro ». Chaque écriture du 0, en session par chaque compte (0 seul pour les autres) et par clé.
    // Lecture écartée : 0 % admis avec un acompte exigé (comportement « Admettre 0 % », écarté par Nelson ; avant le lot, 0
    // devenait le taux par défaut).
    test('création : 0 % envoyé avec un acompte exigé est refusé (400, message exact), sous chacune de ses écritures, sans écriture ni numéro consommé, en session par chaque compte et par clé', async () => {
      const joueurs = [
        ['SA', SA(), PORTES.session, FORMES_ZERO],
        ['clé devis:write', cles.devis, PORTES.cle, FORMES_ZERO],
        ...ECRIVENT().filter(([c]) => c !== 'SA').map(([c, a]) => [c, a, PORTES.session, FORMES_ZERO.slice(0, 1)]),
      ];
      for (const [compte, auth, porte, formes] of joueurs) {
        for (const [quoi, valeur] of formes) {
          await refuse(() => appeler('post', porte, { ...corpsDevis({ acompteExige: true }), tauxAcompte: valeur }, auth), 400, REFUS.zero, `${compte}, ${quoi}`);
        }
      }
    });

    // Cadrage : à la modification, le 0 % est refusé avec la case cochée, ou sans la case quand le devis exigeait déjà un
    // acompte ; le devis garde ses conditions (35 %), son objet et ses lignes.
    test('modification : 0 % envoyé est refusé quand l’acompte est exigé, par la case ou par le devis précédent, sans écriture, en session et par clé', async () => {
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        const exigeA35 = await creerOk({ acompteExige: true, tauxAcompte: 35 });
        const nonExige = await creerOk({ acompteExige: false });
        for (const [quoi, valeur] of FORMES_ZERO) {
          await refuse(() => modifier(exigeA35.id, corpsDevis({ acompteExige: true, tauxAcompte: valeur }), auth, porte), 400, REFUS.zero, `${qui}, devis exigé, case cochée, ${quoi}`);
          await refuse(() => modifier(exigeA35.id, corpsDevis({ tauxAcompte: valeur }), auth, porte), 400, REFUS.zero, `${qui}, devis exigé, case absente, ${quoi}`);
          await refuse(() => modifier(nonExige.id, corpsDevis({ acompteExige: true, tauxAcompte: valeur }), auth, porte), 400, REFUS.zero, `${qui}, devis non exigé passé à l’acompte exigé, ${quoi}`);
        }
        assert.deepEqual(await conditions(exigeA35.id), { acompteExige: true, tauxAcompte: '35' });
        assert.deepEqual(await conditions(nonExige.id), { acompteExige: false, tauxAcompte: null });
      }
    });

    // Cadrage : « 0 envoyé avec `acompteExige: false` est admis : le taux n'est pas enregistré, comme aujourd'hui » ; et,
    // sans la case, sur un devis qui n'exigeait pas d'acompte. Écarte un refus du 0 quel que soit l'acompte exigé, et un 0
    // enregistré sur un devis sans acompte.
    test('0 sans acompte exigé : admis à la création et à la modification, le taux n’est pas enregistré (null), en session et par clé', async () => {
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        for (const [quoi, valeur] of FORMES_ZERO) {
          const cree = await ok(creer(corpsDevis({ acompteExige: false, tauxAcompte: valeur }), auth, porte), 201);
          assert.equal(cree.tauxAcompte, null, `${qui}, création, ${quoi}`);
          assert.deepEqual(await conditions(cree.id), { acompteExige: false, tauxAcompte: null }, `${qui}, création, ${quoi}`);
          const exigeA35 = await creerOk({ acompteExige: true, tauxAcompte: 35 });
          await ok(modifier(exigeA35.id, corpsDevis({ acompteExige: false, tauxAcompte: valeur }), auth, porte));
          assert.deepEqual(await conditions(exigeA35.id), { acompteExige: false, tauxAcompte: null }, `${qui}, case décochée, ${quoi}`);
          const nonExige = await creerOk({ acompteExige: false });
          await ok(modifier(nonExige.id, corpsDevis({ tauxAcompte: valeur }), auth, porte));
          assert.deepEqual(await conditions(nonExige.id), { acompteExige: false, tauxAcompte: null }, `${qui}, devis non exigé, case absente, ${quoi}`);
        }
      }
    });

    // Cadrage, section 1 : « Valeur non vide, contrôlée qu'un acompte soit exigé ou non » ; sans acompte exigé, un taux bien
    // formé est admis et, comme le 0, n'est pas enregistré (« le taux n'est pas enregistré, comme aujourd'hui » ;
    // acompteDevisPayload : `if (!acompteExige) return { acompteExige, tauxAcompte: null }`). Lecture écartée (audit des montants
    // de #571, mutant S20) : un taux valide non nul gardé sur un devis sans acompte, servi par l'API et entré dans le contenu
    // signé. La case cochée ensuite, sans taux, prend le taux par défaut (la valeur lue au départ, 40 depuis le lot acompte ;
    // 30 avant lui), et non le taux envoyé plus tôt (50, 37,5 ou 100, chacun distinct de 40).
    test('sans acompte exigé : un taux valide non nul (50, « 37,5 », 100) est admis sans être enregistré, à la création et à la modification, en session et par clé ; la case cochée ensuite sans taux prend le taux par défaut', async () => {
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        for (const valeur of [50, '37,5', 100]) {
          const cree = await ok(creer(corpsDevis({ acompteExige: false, tauxAcompte: valeur }), auth, porte), 201);
          assert.equal(cree.tauxAcompte, null, `${qui}, création, ${valeur} : réponse`);
          assert.deepEqual(await conditions(cree.id), { acompteExige: false, tauxAcompte: null }, `${qui}, création, ${valeur}`);
          const exigeA35 = await creerOk({ acompteExige: true, tauxAcompte: 35 });
          const decoche = await ok(modifier(exigeA35.id, corpsDevis({ objet: exigeA35.objet, acompteExige: false, tauxAcompte: valeur }), auth, porte));
          assert.equal(decoche.tauxAcompte, null, `${qui}, case décochée, ${valeur} : réponse`);
          assert.deepEqual(await conditions(exigeA35.id), { acompteExige: false, tauxAcompte: null }, `${qui}, case décochée, ${valeur}`);
          const nonExige = await creerOk({ acompteExige: false });
          await ok(modifier(nonExige.id, corpsDevis({ objet: nonExige.objet, tauxAcompte: valeur }), auth, porte));
          assert.deepEqual(await conditions(nonExige.id), { acompteExige: false, tauxAcompte: null }, `${qui}, devis non exigé, case absente, ${valeur}`);
          await ok(modifier(cree.id, corpsDevis({ objet: cree.objet, acompteExige: true }), auth, porte));
          assert.deepEqual(await conditions(cree.id), { acompteExige: true, tauxAcompte: tauxDeDepart }, `${qui}, case cochée ensuite sans taux, ${valeur}`);
        }
      }
    });

    // Cadrage : « Le cas se joue dans la transaction, à l'endroit actuel de l'appel (`routes.ts:106`). Il passe donc après
    // le 404, les 409, « Client introuvable » et les refus du temps passé » ; à la création, après « Client introuvable » et
    // le 409 du pas non réglé. Écarte un refus du 0 avancé dans le contrôle de forme.
    test('0 % exigé : refusé après le 404, les 409, « Client introuvable. » et le 409 du pas non réglé, en session et par clé', async () => {
      const signe = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      await signer(signe.id);
      const refuse409 = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      await refuser(refuse409.id);
      const brouillon = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      const ligneTp = { tempsPasse: true, designation: 'TEST Main d’œuvre au temps passé', quantite: 1, tarifTempsPasse: 'HORS_CONTRAT', catalogueFamille: 'prestations', catalogueId: mainOeuvre.id };
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        const zero = { acompteExige: true, tauxAcompte: 0 };
        await refuse(() => modifier(randomUUID(), corpsDevis(zero), auth, porte), 404, REFUS.introuvable, `${qui}, devis inconnu`);
        await refuse(() => modifier(signe.id, corpsDevis(zero), auth, porte), 409, REFUS.signe, `${qui}, devis signé`);
        await refuse(() => modifier(refuse409.id, corpsDevis(zero), auth, porte), 409, REFUS.nonModifiable, `${qui}, devis refusé`);
        await refuse(() => modifier(brouillon.id, { ...corpsDevis(zero), clientId: randomUUID() }, auth, porte), 400, REFUS.client, `${qui}, modification, client inconnu`);
        await refuse(() => modifier(brouillon.id, corpsDevis({ ...zero, auTempsPasse: true, lignes: [ligneTp] }), auth, porte), 409, REFUS.pasNonRegle, `${qui}, modification, passage au temps passé, pas non réglé`);
        await refuse(() => creer({ ...corpsDevis(zero), clientId: randomUUID() }, auth, porte), 400, REFUS.client, `${qui}, création, client inconnu`);
        await refuse(() => creer(corpsDevis({ ...zero, auTempsPasse: true, lignes: [ligneTp] }), auth, porte), 409, REFUS.pasNonRegle, `${qui}, création, pas non réglé`);
      }
    });

    // Q1, répondue par Nelson le 17-11-2026 (« si l'accompte est reglé a 0% du coup rien n'est exiger en accompte et donc ne
    // figure pas sur la facture ni le devis ») ; cadrage v3.1 du lot acompte, section 2 : « quand le taux retenu est le taux
    // par défaut et qu'il vaut 0, le devis est enregistré sans acompte exigé (`acompteExige: false`, `tauxAcompte: null`),
    // même si le corps en demande un » ; la duplication d'un devis exigé « s'il vaut 0, le duplicata naît sans acompte » ;
    // « un 0 % envoyé avec un acompte exigé reste refusé (400) ». Test réécrit : avant la réponse, il gardait l'état d'alors
    // (devis exigé à 0 %, duplication recopiant 0). Lectures écartées : devis exigé à 0 % (état d'avant, taux '0') ; refus
    // 400 du réglage à 0 % (refus du taux calculé, qui refuserait aussi la clé absente) ; 0 % envoyé admis ; duplicata exigé
    // au taux de sa source (35).
    test('Q1 répondue : taux par défaut réglé à 0 %, un acompte exigé sans taux (clé absente, null, chaîne vide) donne un devis sans acompte ni taux, la duplication d’un devis exigé aussi ; seul le 0 envoyé est refusé', async () => {
      const source = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      await avecTauxParDefaut(0, async () => {
        for (const [quoi, extra] of [['clé absente', {}], ['null', { tauxAcompte: null }], ['chaîne vide', { tauxAcompte: '' }]]) {
          const cree = await ok(creer(corpsDevis({ acompteExige: true, ...extra })), 201);
          assert.deepEqual([cree.acompteExige, cree.tauxAcompte], [false, null], `${quoi} : réponse`);
          assert.deepEqual(await conditions(cree.id), { acompteExige: false, tauxAcompte: null }, quoi);
        }
        const duplicata = await ok(appeler('post', `/api/devis/${source.id}/duplication`, {}), 201);
        assert.deepEqual([duplicata.acompteExige, duplicata.tauxAcompte], [false, null], 'duplication : réponse');
        assert.deepEqual(await conditions(duplicata.id), { acompteExige: false, tauxAcompte: null }, 'duplication : taux par défaut du jour à 0 %');
        await refuse(() => creer(corpsDevis({ acompteExige: true, tauxAcompte: 0 })), 400, REFUS.zero, '0 envoyé');
      });
      assert.deepEqual(await conditions(source.id), { acompteExige: true, tauxAcompte: '35' }, 'la source garde ses conditions');
    });

    // ==================================================================================================================
    // Acompte déjà encaissé (cadrage, section 1).
    // ==================================================================================================================

    // Test nommé du cadrage : « un brouillon exigé à 30 %, l'acompte constaté, puis `PATCH` avec 0, puis 50, puis « abc ».
    // Attendu : 200 avec les conditions inchangées, 200 inchangé, puis 400. La base reste inchangée » (conditions et acompte
    // constaté ; le refus n'écrit rien du tout). Écarte un refus du 0 placé avant la reprise des conditions encaissées, et un
    // taux encaissé renégocié (50). Lu aussi par clé, et sur un devis envoyé.
    test('acompte encaissé : un PATCH avec 0 puis 50 garde les conditions (200), « abc » est refusé (400) sans écriture, en session et par clé, brouillon ou envoyé', async () => {
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        for (const envoye of [false, true]) {
          const devis = await creerOk({ acompteExige: true, tauxAcompte: 30 });
          if (envoye) await ok(appeler('put', `/api/devis/${devis.id}/statut`, { statut: 'ENVOYE' }));
          const recuLe = await aujourdhui();
          await ok(appeler('post', `/api/devis/${devis.id}/acompte`, { recuLe, montant: '72,00', reference: `TEST-ACOMPTE-${suffixe()}` }));
          const encaisse = async () => {
            const d = await prisma.devis.findUniqueOrThrow({ where: { id: devis.id } });
            return [d.acompteExige, d.tauxAcompte?.toString(), d.acompteRecuLe?.toISOString(), d.acompteMontant?.toString(), d.acompteReference, d.acompteConstateParId, d.statut];
          };
          const avant = await encaisse();
          assert.deepEqual(avant.slice(0, 2), [true, '30']);
          assert.equal(avant[3], '72');
          const cas = `${qui}, devis ${envoye ? 'envoyé' : 'brouillon'}`;
          for (const valeur of [0, 50]) {
            const res = await ok(modifier(devis.id, corpsDevis({ objet: devis.objet, acompteExige: true, tauxAcompte: valeur }), auth, porte));
            assert.deepEqual([res.acompteExige, res.tauxAcompte], [true, 30], `${cas}, ${valeur} : réponse`);
            assert.deepEqual(await encaisse(), avant, `${cas}, ${valeur} : conditions et acompte constaté inchangés`);
          }
          await ok(modifier(devis.id, corpsDevis({ objet: devis.objet, acompteExige: false, tauxAcompte: 0 }), auth, porte));
          assert.deepEqual(await encaisse(), avant, `${cas}, case décochée : conditions inchangées`);
          await refuse(() => modifier(devis.id, corpsDevis({ objet: devis.objet, acompteExige: true, tauxAcompte: 'abc' }), auth, porte), 400, REFUS.taux, `${cas}, « abc »`);
          assert.deepEqual(await encaisse(), avant, `${cas} : base inchangée`);
        }
      }
    });

    // ==================================================================================================================
    // Section 2 : devis inconnu, 404 et non 400 (#252 N3, #426 pour le devis).
    // ==================================================================================================================

    // Cadrage, section 2 : « Toutes les routes du domaine qui répondent 400 « Devis introuvable. » passent à 404 », en
    // session sur la modification, la révision, la signature, la conversion et l'annulation, et par clé sur la
    // modification, la révision et la conversion ; « L'ordre est inchangé : la forme du corps (400) passe avant
    // l'existence du devis ». Chaque compte qui écrit les devis (l'annulation : l'administration seule, requireAdmin).
    // Lecture écartée : 400 « Devis introuvable. » (avant le lot).
    test('devis inconnu : 404 « Devis introuvable. » sur la modification, la révision, la signature, la conversion et l’annulation en session, par chaque compte qui y a droit, sans écriture', async () => {
      const id = randomUUID();
      const ROUTES = [
        ['modification', 'patch', `/api/devis/${id}`, () => corpsDevis({ acompteExige: true, tauxAcompte: '30' }), false],
        ['révision', 'post', `/api/devis/${id}/revisions`, () => ({}), false],
        ['signature', 'post', `/api/devis/${id}/signature`, () => ({ signataire: 'TEST Signataire inconnu', confirme: true }), false],
        ['conversion en chantier', 'post', `/api/devis/${id}/convertir`, () => ({ cible: 'CHANTIER' }), false],
        ['annulation', 'post', `/api/devis/${id}/annulation`, () => ({ motif: 'TEST Annulation d’un devis inconnu' }), true],
      ];
      for (const [compte, auth] of ECRIVENT()) {
        const administration = ['SA', 'AD', 'AD-COM', 'DIR'].includes(compte);
        for (const [route, methode, chemin, corps, reserveeAdministration] of ROUTES) {
          if (reserveeAdministration && !administration) {
            await refuse(() => appeler(methode, chemin, corps(), auth), 403, REFUS.administration, `${compte}, ${route} : réservée à l’administration`);
            continue;
          }
          await refuse(() => appeler(methode, chemin, corps(), auth), 404, REFUS.introuvable, `${compte}, ${route}`);
        }
      }
      // Conversion en intervention ou en contrat d'un devis inconnu, par l'administration : le devis manque d'abord.
      for (const cible of ['INTERVENTION', 'CONTRAT']) {
        await refuse(() => appeler('post', `/api/devis/${id}/convertir`, { cible }), 404, REFUS.introuvable, `SA, conversion en ${cible.toLowerCase()}`);
      }
    });

    test('devis inconnu par clé d’intégration : 404 « Devis introuvable. » sur la modification, la révision et la conversion ; la signature et l’annulation n’ont pas de route /api/v1', async () => {
      const id = randomUUID();
      await refuse(() => modifier(id, corpsDevis(), cles.devis, PORTES.cle), 404, REFUS.introuvable, 'clé, modification');
      await refuse(() => appeler('post', `/api/v1/devis/${id}/revisions`, {}, cles.devis), 404, REFUS.introuvable, 'clé, révision');
      await refuse(() => appeler('post', `/api/v1/devis/${id}/convertir`, { cible: 'CHANTIER' }, cles.devis), 404, REFUS.introuvable, 'clé, conversion');
      for (const [route, corps] of [['signature', { signataire: 'TEST Signataire', confirme: true }], ['annulation', { motif: 'TEST motif' }]]) {
        const res = await appeler('post', `/api/v1/devis/${id}/${route}`, corps, cles.devis);
        assert.equal(res.status, 404, `clé, ${route} : aucune route /api/v1 (${res.status} ${JSON.stringify(res.body)})`);
        assert.notEqual(res.body?.error, REFUS.introuvable, `clé, ${route} : la route n’existe pas, ce n’est pas le devis qui manque`);
      }
    });

    // Cadrage, section 2 : « la forme du corps (400) passe avant l'existence du devis, lue sous verrou ». Corps incomplet sur
    // un devis inconnu : 400 du corps, comme avant le lot (matrice entrees.txt : modification, signature, conversion et
    // annulation y restent en 400).
    test('devis inconnu : un corps mal formé reste refusé (400) avant le 404, en session et par clé', async () => {
      const id = randomUUID();
      await refuse(() => appeler('patch', `/api/devis/${id}`, {}), 400, REFUS.corps, 'session, modification, corps vide');
      await refuse(() => appeler('patch', `/api/v1/devis/${id}`, {}, cles.devis), 400, REFUS.corps, 'clé, modification, corps vide');
      await refuse(() => appeler('post', `/api/devis/${id}/signature`, {}), 400, REFUS.signataire, 'session, signature sans signataire');
      await refuse(() => appeler('post', `/api/devis/${id}/convertir`, {}), 400, REFUS.cible, 'session, conversion sans cible');
      await refuse(() => appeler('post', `/api/v1/devis/${id}/convertir`, {}, cles.devis), 400, REFUS.cible, 'clé, conversion sans cible');
      await refuse(() => appeler('post', `/api/devis/${id}/annulation`, {}), 400, REFUS.motif, 'session, annulation sans motif');
    });

    // Droits avant l'existence et avant la forme du taux : un compte sans devis:write reçoit 403, que le devis existe ou non
    // et que le taux soit valide ou non (il n'apprend ni l'existence d'un devis ni la règle du taux) ; une clé d'une autre
    // portée, 403 ; une session sur /api/v1, 401 ; une clé sur une route de session, 401. Sans écriture.
    test('droits : sans devis:write, 403 avant le 404 et avant le contrôle du taux ; clé d’une autre portée 403 ; session sur /api/v1 et clé sur une route de session 401', async () => {
      const existant = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      for (const [compte, auth] of SANS_DROIT()) {
        for (const taux of ['abc', '30', 0]) {
          await refuse(() => creer(corpsDevis({ acompteExige: true, tauxAcompte: taux }), auth), 403, REFUS.permission, `${compte}, création, ${taux}`);
          for (const id of [existant.id, randomUUID()]) {
            await refuse(() => modifier(id, corpsDevis({ acompteExige: true, tauxAcompte: taux }), auth), 403, REFUS.permission, `${compte}, modification, ${taux}`);
          }
        }
        for (const [route, corps] of [['revisions', {}], ['signature', { signataire: 'TEST Signataire', confirme: true }], ['convertir', { cible: 'CHANTIER' }]]) {
          await refuse(() => appeler('post', `/api/devis/${randomUUID()}/${route}`, corps, auth), 403, REFUS.permission, `${compte}, ${route} d’un devis inconnu`);
        }
        await refuse(() => appeler('post', `/api/devis/${randomUUID()}/annulation`, { motif: 'TEST motif' }, auth), 403, REFUS.administration, `${compte}, annulation d’un devis inconnu`);
      }
      for (const taux of ['abc', 0]) {
        await refuse(() => creer(corpsDevis({ acompteExige: true, tauxAcompte: taux }), cles.autre, PORTES.cle), 403, REFUS.scope, `clé devis:read, création, ${taux}`);
        await refuse(() => modifier(randomUUID(), corpsDevis({ acompteExige: true, tauxAcompte: taux }), cles.autre, PORTES.cle), 403, REFUS.scope, `clé devis:read, modification, ${taux}`);
        await refuse(() => creer(corpsDevis({ acompteExige: true, tauxAcompte: taux }), SA(), PORTES.cle), 401, REFUS.cleRequise, `session sur /api/v1, ${taux}`);
        await refuse(() => creer(corpsDevis({ acompteExige: true, tauxAcompte: taux }), cles.devis, PORTES.session), 401, REFUS.session, `clé sur /api/devis, ${taux}`);
      }
      assert.deepEqual(await conditions(existant.id), { acompteExige: true, tauxAcompte: '35' });
    });

    // ==================================================================================================================
    // Section 3 : taux par défaut lu avant la transaction (#250, #240).
    // ==================================================================================================================

    // Cadrage, section 3 : « des modifications simultanées au-delà du pool, `auDelaDuPool = max(2 × cpus + 2,
    // connection_limit + 1)` » ; « Toutes aboutissent, avec le taux par défaut relu en base » ; « Le test échoue sur `main` »
    // (la modification lisait le taux par le client global pendant sa transaction : chaque modification gardait sa connexion
    // et le verrou du devis, et en réclamait une seconde ; au-delà du pool, elles expiraient en 500). Taux par défaut à
    // 37,5 %, distinct de la valeur du schéma (C1 de l'audit de #250) : écarte une constante dans le code.
    test(`rafale : ${auDelaDuPool} modifications simultanées d’un même devis, au-delà du pool de connexions, aboutissent toutes (200), au taux par défaut de 37,5 % relu en base`, async () => {
      const cree = await creerOk({ objet: 'TEST Affaire modifiée en rafale', lignes: [ligneLibre({ quantite: 1 })] });
      await avecTauxParDefaut('37,5', async () => {
        const objets = Array.from({ length: auDelaDuPool }, (_, n) => `TEST Affaire modifiée en rafale ${n}`);
        // Acompte exigé sans taux : chaque modification lit le taux par défaut (la moitié avec un taux vide).
        const corps = objets.map((objet, n) => ({ clientId: client.id, objet, acompteExige: true, ...(n % 2 ? { tauxAcompte: '' } : {}), lignes: [ligneLibre({ quantite: 2 })] }));
        const reponses = await Promise.all(corps.map((c) => request(app).patch(`/api/devis/${cree.id}`).set(SA()).send(c)));
        assert.deepEqual(reponses.map((r) => r.status), Array(auDelaDuPool).fill(200), JSON.stringify(reponses.map((r) => r.body.error).filter(Boolean)));
        const relu = await prisma.devis.findUniqueOrThrow({ where: { id: cree.id }, include: { lignes: true } });
        assert.ok(objets.includes(relu.objet), relu.objet);
        assert.deepEqual([relu.acompteExige, relu.tauxAcompte.toString(), relu.totalHt.toString()], [true, '37.5', '200'], 'le taux par défaut lu avant la transaction');
        assert.equal(relu.lignes.length, 1, 'chaque modification remplace les lignes, sans doublon');
      });
    });

    // ==================================================================================================================
    // Copie figée : révision, duplication, paramètre changé après coup.
    // ==================================================================================================================

    // Le taux saisi « 12,25 » est figé sur le devis : le taux par défaut changé ensuite ne le touche pas ; la révision du
    // devis signé le recopie exactement ; la duplication relit le taux par défaut du jour (comportement inchangé). Écarte
    // une révision qui relirait le défaut (37,5), une duplication qui recopierait le taux source (12,25), et un arrondi au
    // dixième (12,3 ou 12,2).
    test('copie figée : un taux saisi « 12,25 » reste 12,25 quand le taux par défaut change, la révision le recopie exactement, la duplication relit le taux par défaut du jour (37,5 %)', async () => {
      const devis = await creerOk({ acompteExige: true, tauxAcompte: '12,25' });
      await signer(devis.id);
      await avecTauxParDefaut('37,5', async () => {
        assert.deepEqual(await conditions(devis.id), { acompteExige: true, tauxAcompte: '12.25' }, 'devis émis inchangé');
        const revision = await ok(appeler('post', `/api/devis/${devis.id}/revisions`, {}), 201);
        assert.equal(revision.tauxAcompte, 12.25);
        assert.deepEqual(await conditions(revision.id), { acompteExige: true, tauxAcompte: '12.25' }, 'révision');
        const duplicata = await ok(appeler('post', `/api/devis/${devis.id}/duplication`, {}), 201);
        assert.deepEqual(await conditions(duplicata.id), { acompteExige: true, tauxAcompte: '37.5' }, 'duplication');
        // La révision brouillon se modifie : la clé absente garde 12,25 ; « abc » est refusé sans écriture.
        await ok(modifier(revision.id, corpsDevis({ objet: revision.objet })));
        assert.deepEqual(await conditions(revision.id), { acompteExige: true, tauxAcompte: '12.25' }, 'révision modifiée sans taux');
        await refuse(() => modifier(revision.id, corpsDevis({ objet: revision.objet, tauxAcompte: 'abc' })), 400, REFUS.taux, 'révision, « abc »');
      });
    });

    // ==================================================================================================================
    // Section 4, côté serveur : lignes saisies à la virgule, envoyées brutes par l'écran (#394 pour le devis).
    // ==================================================================================================================

    // Cadrage, section 4 : « `updateLine` (…) garde en chaîne la quantité, le PU et la TVA (…). Ces valeurs sont envoyées
    // brutes, puisque le serveur lit la virgule » ; critère « quantité « 1,5 », PU « 18,75 », TVA « 5,5 » ». Montant : 1,5 ×
    // 18,75 = 28,125, arrondi commercial à 28,13 (au pair ou tronqué : 28,12) ; TVA 5,5 % de 28,13 = 1,54715, soit 1,55 ;
    // TTC 29,68 (témoin en centimes entiers ci-dessous). Lectures écartées : « 1,5 » lu 15 par un champ numérique d'un
    // navigateur anglais (15 × 18,75 = 281,25) ; « 18,75 » lu 1 875 (2 812,50) ; « 5,5 » lu 55 (refusé, TVA non française) ;
    // `parseFloat` (1 × 18 = 18). Même montant en session et par clé, à la création et à la modification.
    test('lignes à la virgule : quantité « 1,5 », PU « 18,75 », TVA « 5,5 » enregistrées exactement (28,13 € HT, 1,55 € de TVA, 29,68 € TTC), à la création et à la modification, en session et par clé', async () => {
      // Témoin en décimal exact : quantité en millièmes (1 500), prix en centimes (1 875) ; le produit est en millièmes de
      // centime, ramené au centime le plus proche, demi vers le haut. TVA : 5,5 % = 55 ‰, au centime, demi vers le haut.
      const ht = (1_500n * 1_875n + 500n) / 1_000n;
      const tva = (ht * 55n + 500n) / 1_000n;
      assert.deepEqual([ht, tva, ht + tva], [2813n, 155n, 2968n]);
      const ligne = { designation: 'TEST Fourniture à la virgule', nature: 'FOURNITURE', quantite: '1,5', prixUnitaireHt: '18,75', tauxTva: '5,5' };
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        const cree = await ok(creer(corpsDevis({ lignes: [ligne] }), auth, porte), 201);
        const autre = await creerOk({ lignes: [ligneLibre()] });
        await ok(modifier(autre.id, corpsDevis({ objet: autre.objet, lignes: [ligne] }), auth, porte));
        for (const [cas, id] of [['création', cree.id], ['modification', autre.id]]) {
          const d = await prisma.devis.findUniqueOrThrow({ where: { id }, include: { lignes: true } });
          assert.deepEqual(d.lignes.map((l) => [l.quantite.toString(), l.prixUnitaireHt.toString(), l.tauxTva.toString(), l.totalHt.toString(), l.totalTtc.toString()]), [['1.5', '18.75', '5.5', '28.13', '29.68']], `${qui}, ${cas} : ligne`);
          assert.deepEqual([d.totalHt.toString(), d.totalTva.toString(), d.totalTtc.toString()], ['28.13', '1.55', '29.68'], `${qui}, ${cas} : totaux`);
        }
      }
    });

    // ==================================================================================================================
    // Lot acompte, section 1 : taux par défaut à 40 % (décision 1 de Nelson du 17-11-2026 : « par defaut, le reglage doit
    // etre a 40% d'accompte, qui sera modifiable dans les parametre de société justement »).
    // ==================================================================================================================

    // Critère « Nouvelle installation : le taux par défaut vaut 40 %. Un nouveau devis, case cochée d'office, est enregistré
    // exigé à 40 %. Son PDF porte « Acompte demandé : 40 % » ». La base de ce fichier est neuve, migrée jusqu'à la dernière
    // migration ; la ligne des réglages y est créée à la demande avec les valeurs par défaut de la base (cadrage, section 1).
    // La case cochée de l'écran envoie `acompteExige: true` sans clé de taux (tests de l'écran) : c'est le corps joué ici.
    // Lectures écartées : défaut resté à 30 (« Acompte demandé : 30 % », taux '30') ; aucun acompte (taux null).
    test('nouvelle installation : le taux d’acompte par défaut vaut 40 % ; un devis créé avec l’acompte exigé, sans taux, est exigé à 40 % en session et par clé, et son PDF porte « Acompte demandé : 40 % »', async () => {
      assert.equal(tauxDeDepart, '40', 'taux par défaut de la base neuve, lu avant tout test');
      const lus = await ok(request(app).get('/api/parametres').set(SA()));
      assert.equal(lus.tauxAcompteDefaut, 40, 'réglage servi à l’administration');
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        const cree = await ok(creer(corpsDevis({ acompteExige: true }), auth, porte), 201);
        assert.deepEqual([cree.acompteExige, cree.tauxAcompte], [true, 40], `${qui} : réponse`);
        assert.deepEqual(await conditions(cree.id), { acompteExige: true, tauxAcompte: '40' }, `${qui} : en base`);
        const texte = await textePdf(cree.id);
        assert.ok(texte.includes('Acompte demandé : 40 %'), `${qui} : PDF\n${texte}`);
      }
    });

    // Cadrage v3.1, section 3, « Clé d'intégration : à la création, une clé `acompteExige` absente reste « non exigé »
    // (`!!body.acompteExige`), sans changement » (lecture retenue, à confirmer : la case cochée d'office est un choix de
    // l'écran, non le défaut de l'API). Taux par défaut réglé à 40 %, non nul : écarte un défaut de l'API passé à « exigé »
    // (le devis naîtrait exigé à 40 %).
    test('création sans la clé acompteExige, taux par défaut à 40 % : le devis reste sans acompte ni taux (contrat de l’API inchangé), en session et par clé', async () => {
      await avecTauxParDefaut(40, async () => {
        for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
          for (const [quoi, extra] of [['sans taux', {}], ['taux vide', { tauxAcompte: '' }], ['taux null', { tauxAcompte: null }]]) {
            const cree = await ok(creer(corpsDevis(extra), auth, porte), 201);
            assert.deepEqual([cree.acompteExige, cree.tauxAcompte], [false, null], `${qui}, ${quoi} : réponse`);
            assert.deepEqual(await conditions(cree.id), { acompteExige: false, tauxAcompte: null }, `${qui}, ${quoi} : en base`);
          }
        }
      });
    });

    // ==================================================================================================================
    // Lot acompte, section 2 : réglage à 0 %, aucun acompte exigé (réponse de Nelson à Q1, 17-11-2026).
    // ==================================================================================================================

    // Critère « Réglage à 0 %, en session et par clé, montants relus en base : création avec acompte exigé sans taux :
    // enregistré sans acompte ni taux ; (…) PDF et historique sans acompte » ; section 2 : « à la création, valeur vide ou
    // clé absente ». Chaque compte qui porte devis:write (droit individuel compris) et la clé. Lectures écartées : devis
    // exigé à 0 % (état d'avant la réponse à Q1 : taux '0', PDF « Acompte demandé : 0 % ») ; refus 400 (réglage à 0 % lu
    // comme un 0 % envoyé) ; taux de la base neuve (40) ou de l'ancien schéma (30) appliqué. Témoin du PDF : un devis exigé
    // à 25 %, taux explicite enregistré malgré le réglage, imprime bien son acompte.
    test('réglage à 0 %, création : l’acompte exigé sans taux (clé absente, null, chaîne vide, blancs) donne un devis sans acompte ni taux, en session par chaque compte qui écrit les devis et par clé ; son PDF n’imprime aucun acompte', async () => {
      await avecTauxParDefaut(0, async () => {
        const joueurs = [...ECRIVENT().map(([c, a]) => [c, a, PORTES.session]), ['clé devis:write', cles.devis, PORTES.cle]];
        const crees = [];
        for (const [compte, auth, porte] of joueurs) {
          for (const [quoi, extra] of [['clé absente', {}], ...FORMES_VIDES.map(([q, v]) => [q, { tauxAcompte: v }])]) {
            const res = await creer(corpsDevis({ acompteExige: true, ...extra }), auth, porte);
            assert.equal(res.status, 201, `${compte}, ${quoi} : ${JSON.stringify(res.body)}`);
            assert.deepEqual([res.body.acompteExige, res.body.tauxAcompte], [false, null], `${compte}, ${quoi} : réponse`);
            assert.deepEqual(await conditions(res.body.id), { acompteExige: false, tauxAcompte: null }, `${compte}, ${quoi} : en base`);
            crees.push(res.body.id);
          }
        }
        for (const id of [crees[0], crees[crees.length - 1]]) {
          const texte = await textePdf(id);
          assert.ok(!texte.includes('Acompte demandé'), `PDF d’un devis enregistré sans acompte :\n${texte}`);
          assert.match(texte, /Total TTC : 240,00 €/, 'le PDF lu est bien celui du devis (2 × 100,00 € HT, TVA 20 %)');
        }
        const temoin = await creerOk({ acompteExige: true, tauxAcompte: 25 });
        assert.deepEqual(await conditions(temoin.id), { acompteExige: true, tauxAcompte: '25' }, 'témoin : taux explicite enregistré');
        assert.ok((await textePdf(temoin.id)).includes('Acompte demandé : 25 %'), 'témoin : le PDF d’un devis exigé imprime son acompte');
      });
    });

    // Critères (a) et (b) du réglage à 0 % : « (a) modification d'un devis exigé à 40 %, clé du taux absente : 40 % gardé ;
    // (b) même devis, `tauxAcompte` à `null` ou `""` : enregistré sans acompte » ; lecture retenue, à confirmer : « La
    // valeur vide prend le taux par défaut ; la clé absente le garde ». Devis exigés à 40 % (taux de la base neuve) et à 35 %
    // (négocié, distinct du défaut d'hier et d'aujourd'hui), créés avant le passage à 0 % ; case cochée envoyée ou absente.
    // Lectures écartées : (a) taux renégocié au réglage (devis sans acompte, ou exigé à 0 %), ou constante 40 au lieu du taux
    // du devis (35) ; (b) vide traité comme absent (40 % gardé), ou devis exigé à 0 %.
    test('réglage à 0 % : (a) un devis exigé à 40 % ou à 35 % modifié sans la clé du taux garde son taux ; (b) avec un taux vide (null, chaîne vide, blancs), il est enregistré sans acompte ; en session et par clé', async () => {
      const casA = []; const casB = [];
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        for (const corps of [{ acompteExige: true }, {}]) {
          for (const [extra, attendu] of [[{}, '40'], [{ tauxAcompte: 35 }, '35']]) {
            const devis = await creerOk({ acompteExige: true, ...extra });
            assert.deepEqual(await conditions(devis.id), { acompteExige: true, tauxAcompte: attendu }, 'devis préparé avant le réglage à 0 %');
            casA.push({ devis, porte, auth, cas: `${qui}, ${JSON.stringify(corps)}, devis à ${attendu} %`, corps, attendu });
          }
          for (const [quoi, valeur] of FORMES_VIDES) {
            casB.push({ devis: await creerOk({ acompteExige: true }), porte, auth, cas: `${qui}, ${JSON.stringify(corps)}, ${quoi}`, corps, valeur });
          }
        }
      }
      await avecTauxParDefaut(0, async () => {
        for (const { devis, porte, auth, cas, corps, attendu } of casA) {
          const res = await ok(modifier(devis.id, corpsDevis({ objet: `TEST Objet changé ${suffixe()}`, ...corps }), auth, porte));
          assert.deepEqual([res.acompteExige, res.tauxAcompte], [true, Number(attendu)], `(a) ${cas} : réponse`);
          assert.deepEqual(await conditions(devis.id), { acompteExige: true, tauxAcompte: attendu }, `(a) ${cas} : taux gardé`);
        }
        for (const { devis, porte, auth, cas, corps, valeur } of casB) {
          const res = await ok(modifier(devis.id, corpsDevis({ objet: devis.objet, ...corps, tauxAcompte: valeur }), auth, porte));
          assert.deepEqual([res.acompteExige, res.tauxAcompte], [false, null], `(b) ${cas} : réponse`);
          assert.deepEqual(await conditions(devis.id), { acompteExige: false, tauxAcompte: null }, `(b) ${cas} : sans acompte`);
        }
      });
    });

    // Critère (c) : « révision d'un devis signé exigé à 40 % : 40 % gardé, y compris quand on enregistre depuis l'écran la
    // révision ouverte en modification » ; section 2, « la révision recopie les conditions ». L'écran envoie à la
    // modification son formulaire sans clé de taux (Devis.tsx, `{ ...form, lignes }` : client, objet, case, temps passé,
    // lignes en texte) : ce corps est rejoué tel quel, en session ; par clé, la révision et sa modification sans taux. Les PDF
    // du devis signé et de sa révision portent toujours « Acompte demandé : 40 % » (copie figée). Lectures écartées : révision
    // qui relit le réglage (sans acompte, ou à 0 %) ; modification qui renégocie au réglage ; document relu au réglage du jour.
    test('réglage à 0 % : (c) la révision d’un devis signé exigé à 40 % garde 40 %, y compris enregistrée ensuite avec le corps de l’écran (case cochée, sans clé de taux), en session et par clé', async () => {
      const sources = [];
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        const source = await creerOk({ acompteExige: true });
        await signer(source.id);
        sources.push({ source, porte, auth, qui });
      }
      await avecTauxParDefaut(0, async () => {
        for (const { source, porte, auth, qui } of sources) {
          const revision = await ok(appeler('post', `${porte}/${source.id}/revisions`, {}, auth), 201);
          assert.deepEqual([revision.acompteExige, revision.tauxAcompte], [true, 40], `${qui}, révision : réponse`);
          assert.deepEqual(await conditions(revision.id), { acompteExige: true, tauxAcompte: '40' }, `${qui}, révision : conditions recopiées`);
          const corpsEcran = {
            clientId: client.id, objet: `${revision.objet} modifiée`, acompteExige: true, auTempsPasse: false,
            lignes: [{ designation: 'TEST Pose du lot devis', nature: 'MAIN_OEUVRE', quantite: '3', prixUnitaireHt: '100', tauxTva: '20' }],
          };
          const modifiee = await ok(modifier(revision.id, corpsEcran, auth, porte));
          assert.deepEqual([modifiee.acompteExige, modifiee.tauxAcompte], [true, 40], `${qui}, révision enregistrée comme l’écran : réponse`);
          assert.deepEqual(await conditions(revision.id), { acompteExige: true, tauxAcompte: '40' }, `${qui}, révision enregistrée comme l’écran : 40 % gardé`);
          assert.deepEqual(await conditions(source.id), { acompteExige: true, tauxAcompte: '40' }, `${qui} : le devis signé est inchangé`);
          // Copie figée : le réglage passé à 0 % ne retire pas l'acompte du document du devis signé, ni de sa révision.
          for (const [id, quoi] of [[source.id, 'devis signé'], [revision.id, 'révision']]) {
            assert.ok((await textePdf(id)).includes('Acompte demandé : 40 %'), `${qui}, ${quoi} : PDF à 40 % malgré le réglage à 0 %`);
          }
        }
      });
    });

    // Critère (d) : « acompte constaté, puis modification : conditions inchangées » ; section 2, « un acompte encaissé fige
    // les conditions ». Réglage à 0 % : case cochée sans taux, taux null, taux vide sans la case, corps sans case ni taux,
    // case décochée, 0 envoyé. Écarte un réglage à 0 % appliqué avant la reprise des conditions encaissées (le devis
    // perdrait l'acompte qu'il a reçu) et un 0 envoyé refusé avant cette reprise.
    test('réglage à 0 % : (d) un devis exigé à 40 % dont l’acompte est constaté garde ses conditions et son acompte à chaque modification, en session et par clé', async () => {
      const devis = await creerOk({ acompteExige: true });
      await ok(appeler('post', `/api/devis/${devis.id}/acompte`, { recuLe: await aujourdhui(), montant: '96,00', reference: `TEST-ACOMPTE-${suffixe()}` }));
      const encaisse = async () => {
        const d = await prisma.devis.findUniqueOrThrow({ where: { id: devis.id } });
        return [d.acompteExige, d.tauxAcompte?.toString(), d.acompteRecuLe?.toISOString(), d.acompteMontant?.toString(), d.acompteReference, d.acompteConstateParId, d.statut];
      };
      const avant = await encaisse();
      assert.deepEqual([avant[0], avant[1], avant[3]], [true, '40', '96']);
      await avecTauxParDefaut(0, async () => {
        for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
          for (const corps of [{ acompteExige: true }, { acompteExige: true, tauxAcompte: null }, { tauxAcompte: '' }, {}, { acompteExige: false }, { acompteExige: true, tauxAcompte: 0 }]) {
            const res = await ok(modifier(devis.id, corpsDevis({ objet: devis.objet, ...corps }), auth, porte));
            assert.deepEqual([res.acompteExige, res.tauxAcompte], [true, 40], `${qui}, ${JSON.stringify(corps)} : réponse`);
            assert.deepEqual(await encaisse(), avant, `${qui}, ${JSON.stringify(corps)} : conditions et acompte constaté inchangés`);
          }
        }
      });
    });

    // Critère (e) : « devis non exigé dont on coche la case en modification : enregistré sans acompte » ; section 2, « à la
    // modification, (…) case cochée sur un devis qui n'exigeait pas d'acompte ». Clé du taux absente, null, chaîne vide.
    // Témoin : un taux explicite (25) y est enregistré (« un taux explicite (…) est enregistré quel que soit le réglage »).
    // Lectures écartées : devis passé exigé à 0 % ; refus 400 ; taux de la base neuve (40) appliqué.
    test('réglage à 0 % : (e) un devis sans acompte dont on coche la case en modification reste sans acompte (clé du taux absente, null, chaîne vide) ; un taux explicite de 25 % y est enregistré ; en session et par clé', async () => {
      await avecTauxParDefaut(0, async () => {
        for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
          for (const [quoi, extra] of [['clé absente', {}], ['null', { tauxAcompte: null }], ['chaîne vide', { tauxAcompte: '' }]]) {
            const devis = await creerOk({ acompteExige: false });
            const res = await ok(modifier(devis.id, corpsDevis({ objet: devis.objet, acompteExige: true, ...extra }), auth, porte));
            assert.deepEqual([res.acompteExige, res.tauxAcompte], [false, null], `${qui}, ${quoi} : réponse`);
            assert.deepEqual(await conditions(devis.id), { acompteExige: false, tauxAcompte: null }, `${qui}, ${quoi} : sans acompte`);
          }
          const temoin = await creerOk({ acompteExige: false });
          await ok(modifier(temoin.id, corpsDevis({ objet: temoin.objet, acompteExige: true, tauxAcompte: '25' }), auth, porte));
          assert.deepEqual(await conditions(temoin.id), { acompteExige: true, tauxAcompte: '25' }, `${qui}, témoin : taux explicite enregistré`);
        }
      });
    });

    // Critère « duplication d'un devis exigé : duplicata sans acompte » ; section 2 : « le duplicata d'un devis exigé prend
    // le taux par défaut du jour. S'il vaut 0, le duplicata naît sans acompte ». Sources exigées à 40 % et à 25 % (taux
    // distinct du réglage), et une source sans acompte ; par l'administration et par l'assistante technique (devis:write).
    // Le réglage revenu à la valeur de départ (40), la même source exigée donne un duplicata exigé à 40 %. Lectures
    // écartées : duplicata exigé à 0 % (état d'avant) ; taux de la source recopié (25) ; duplicata exigé sans taux.
    test('réglage à 0 % : la duplication d’un devis exigé (à 40 % ou à 25 %) donne un duplicata sans acompte ni taux ; revenue à 40 %, la même source donne un duplicata exigé à 40 %', async () => {
      const exigeA40 = await creerOk({ acompteExige: true });
      const exigeA25 = await creerOk({ acompteExige: true, tauxAcompte: 25 });
      const sansAcompte = await creerOk({ acompteExige: false });
      const dupliquer = (id, auth) => ok(appeler('post', `/api/devis/${id}/duplication`, {}, auth), 201);
      await avecTauxParDefaut(0, async () => {
        for (const compte of ['SA', 'AT']) {
          for (const [source, quoi] of [[exigeA40, 'source exigée à 40 %'], [exigeA25, 'source exigée à 25 %'], [sansAcompte, 'source sans acompte']]) {
            const duplicata = await dupliquer(source.id, comptes[compte].auth);
            assert.deepEqual([duplicata.acompteExige, duplicata.tauxAcompte], [false, null], `${compte}, ${quoi} : réponse`);
            assert.deepEqual(await conditions(duplicata.id), { acompteExige: false, tauxAcompte: null }, `${compte}, ${quoi} : duplicata sans acompte`);
          }
        }
      });
      const duplicata = await dupliquer(exigeA25.id, SA());
      assert.deepEqual(await conditions(duplicata.id), { acompteExige: true, tauxAcompte: tauxDeDepart }, 'réglage revenu à 40 % : duplicata exigé au taux du jour');
      assert.deepEqual(await conditions(exigeA25.id), { acompteExige: true, tauxAcompte: '25' }, 'la source garde ses conditions');
    });

    // Critère « Inchangés : un 0 % envoyé avec un acompte exigé est refusé (400) ; un taux explicite est enregistré quel que
    // soit le réglage » (section 2 : « la réponse 1 porte sur le réglage, et Q1 distinguait les deux cas »). Réglage à 0 % :
    // le 0 envoyé est refusé à la création, à la modification d'un devis exigé (case cochée ou absente) et d'un devis non
    // exigé dont on coche la case, sans aucune écriture ni numéro ; « 25 », « 12,25 » et 100 sont enregistrés exactement à la
    // création et à la modification. Lectures écartées : 0 envoyé admis quand le réglage vaut 0 (devis sans acompte en
    // silence) ; taux explicite remplacé par le réglage (devis sans acompte) ; arrondi de « 12,25 » (12,3 ou 12,2).
    test('réglage à 0 %, inchangés : le 0 % envoyé avec un acompte exigé reste refusé (400) sans écriture ; un taux explicite (25, « 12,25 », 100) est enregistré exactement ; en session et par clé', async () => {
      const exigeA35 = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      const nonExige = await creerOk({ acompteExige: false });
      await avecTauxParDefaut(0, async () => {
        for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
          for (const [quoi, valeur] of FORMES_ZERO.slice(0, 3)) {
            await refuse(() => creer(corpsDevis({ acompteExige: true, tauxAcompte: valeur }), auth, porte), 400, REFUS.zero, `${qui}, création, ${quoi}`);
            await refuse(() => modifier(exigeA35.id, corpsDevis({ acompteExige: true, tauxAcompte: valeur }), auth, porte), 400, REFUS.zero, `${qui}, devis exigé, case cochée, ${quoi}`);
            await refuse(() => modifier(exigeA35.id, corpsDevis({ tauxAcompte: valeur }), auth, porte), 400, REFUS.zero, `${qui}, devis exigé, case absente, ${quoi}`);
            await refuse(() => modifier(nonExige.id, corpsDevis({ acompteExige: true, tauxAcompte: valeur }), auth, porte), 400, REFUS.zero, `${qui}, devis non exigé, case cochée, ${quoi}`);
          }
          for (const [valeur, enBase, enReponse] of [['25', '25', 25], ['12,25', '12.25', 12.25], [100, '100', 100]]) {
            const cree = await ok(creer(corpsDevis({ acompteExige: true, tauxAcompte: valeur }), auth, porte), 201);
            assert.deepEqual([cree.acompteExige, cree.tauxAcompte], [true, enReponse], `${qui}, création à ${valeur} : réponse`);
            assert.deepEqual(await conditions(cree.id), { acompteExige: true, tauxAcompte: enBase }, `${qui}, création à ${valeur}`);
            const devis = await creerOk({ acompteExige: false });
            await ok(modifier(devis.id, corpsDevis({ objet: devis.objet, acompteExige: true, tauxAcompte: valeur }), auth, porte));
            assert.deepEqual(await conditions(devis.id), { acompteExige: true, tauxAcompte: enBase }, `${qui}, modification à ${valeur}`);
          }
        }
        assert.deepEqual(await conditions(exigeA35.id), { acompteExige: true, tauxAcompte: '35' });
        assert.deepEqual(await conditions(nonExige.id), { acompteExige: false, tauxAcompte: null });
      });
    });

    // ==================================================================================================================
    // Lot acompte, section 4 : l'acompte ne bloque que le chantier (décision 5 de Nelson du 17-11-2026, « L'acompte ne
    // bloque que le chantier »). Elle remplace, pour l'intervention et le contrat, la règle du lot 4 (« chaque conversion
    // garde ses règles (acompte constaté… »).
    // ==================================================================================================================

    const corpsConversion = async (cible) => (cible === 'CONTRAT'
      ? { cible, periodiciteMois: 12, dureePrevisionnelleMinutes: 60, dateDebut: await aujourdhui() }
      : { cible });
    const convertir = async (id, cible, auth = SA(), porte = PORTES.session) => appeler('post', `${porte}/${id}/convertir`, await corpsConversion(cible), auth);
    // Devis accepté et signé (la signature le passe « accepté »), acompte exigé au taux de la base neuve (40 %), non constaté.
    const devisSigneAvecAcompte = async (extra = {}) => {
      const devis = await creerOk({ acompteExige: true, ...extra });
      await signer(devis.id);
      return devis;
    };
    const etatDevis = async (id) => {
      const d = await prisma.devis.findUniqueOrThrow({ where: { id }, include: { conversions: { orderBy: { rang: 'asc' } } } });
      return { statut: d.statut, acompteExige: d.acompteExige, tauxAcompte: d.tauxAcompte === null ? null : d.tauxAcompte.toString(), acompteConstate: d.acompteRecuLe !== null, conversions: d.conversions.map((c) => [c.cibleType, c.rang]) };
    };
    const aConvertir = async (auth = SA()) => (await ok(request(app).get('/api/devis/a-convertir').set(auth))).map((d) => d.id);
    const changerStatut = (id, statut, auth = SA()) => appeler('put', `/api/devis/${id}/statut`, { statut }, auth);
    const constater = async (id, auth = SA()) => appeler('post', `/api/devis/${id}/acompte`, { recuLe: await aujourdhui(), montant: '96,00', reference: `TEST-ACOMPTE-CONVERSION-${suffixe()}` }, auth);
    // Conversion admise : 201, la conversion enregistrée au rang attendu, la cible créée pour le client du devis.
    const converti = async (devis, cible, auth, rang, quoi) => {
      const res = await convertir(devis.id, cible, auth);
      assert.equal(res.status, 201, `${quoi} : ${JSON.stringify(res.body)}`);
      const conversion = await prisma.devisConversion.findFirstOrThrow({ where: { devisId: devis.id, cibleType: cible } });
      assert.deepEqual([conversion.cibleId, conversion.rang], [res.body.id, rang], `${quoi} : conversion enregistrée`);
      const modele = { INTERVENTION: prisma.intervention, CONTRAT: prisma.contratMaintenance, CHANTIER: prisma.chantier }[cible];
      assert.equal((await modele.findUniqueOrThrow({ where: { id: res.body.id } })).clientId, client.id, `${quoi} : créé pour le client du devis`);
      return res.body;
    };

    // Critères « Conversion, devis accepté et signé, acompte exigé non constaté : en intervention : admise ; en contrat :
    // admise ; en chantier : refusée (message actuel) » et « depuis `ACCEPTE`, une fois le devis converti, « Attendre
    // l'acompte » n'est plus proposé et la route le refuse ». Par chaque compte qui crée l'intervention et le contrat
    // (administration et assistante technique, cf. gereLesContrats et estEncadrementCoutIntervention), chacun sur son devis :
    // chantier refusé avant toute conversion, intervention, chantier encore refusé (une seule conversion : l'étape du verrou
    // d'acompte est atteinte), contrat ; le devis reste « accepté », exigé à 40 %, sans acompte constaté. Lectures écartées :
    // verrou d'acompte appliqué à l'intervention ou au contrat (400 « L’acompte exigé par ce devis n’a pas été constaté :
    // l’intervention ne peut pas être créée. ») ; verrou retiré pour le chantier (201) ; statut changé par la conversion.
    test('conversion d’un devis accepté et signé, acompte exigé non constaté : l’intervention et le contrat sont créés (201) par l’administration et l’assistante technique, le chantier est refusé (400, message actuel) sans écriture ; le devis reste accepté et la route de statut refuse ensuite « Attendre l’acompte »', async () => {
      for (const compte of ['SA', 'AD', 'AD-COM', 'DIR', 'AT']) {
        const auth = comptes[compte].auth;
        const devis = await devisSigneAvecAcompte();
        assert.deepEqual(await etatDevis(devis.id), { statut: 'ACCEPTE', acompteExige: true, tauxAcompte: '40', acompteConstate: false, conversions: [] }, `${compte} : devis préparé`);
        await refuse(() => convertir(devis.id, 'CHANTIER', auth), 400, REFUS.chantierAcompteNonConstate, `${compte}, chantier avant toute conversion`);
        await converti(devis, 'INTERVENTION', auth, 1, `${compte}, intervention`);
        await refuse(() => convertir(devis.id, 'CHANTIER', auth), 400, REFUS.chantierAcompteNonConstate, `${compte}, chantier après l’intervention`);
        await converti(devis, 'CONTRAT', auth, 2, `${compte}, contrat`);
        assert.deepEqual(await etatDevis(devis.id), { statut: 'ACCEPTE', acompteExige: true, tauxAcompte: '40', acompteConstate: false, conversions: [['INTERVENTION', 1], ['CONTRAT', 2]] }, `${compte} : devis après ses deux conversions`);
        await refuse(() => changerStatut(devis.id, 'EN_ATTENTE_ACOMPTE', auth), 400, REFUS.statutFige, `${compte}, « Attendre l’acompte » après la conversion`);
      }
      // Conducteur de travaux à qui le droit devis:write est donné : il crée l'intervention (encadrement SAV), jamais le
      // contrat ; le chantier lui est refusé par le verrou d'acompte.
      const parConducteur = await devisSigneAvecAcompte();
      const conducteur = comptes['CT+devis:write'].auth;
      await refuse(() => convertir(parConducteur.id, 'CHANTIER', conducteur), 400, REFUS.chantierAcompteNonConstate, 'CT+devis:write, chantier');
      await refuse(() => convertir(parConducteur.id, 'CONTRAT', conducteur), 403, REFUS.gestionContrats, 'CT+devis:write, contrat');
      await converti(parConducteur, 'INTERVENTION', conducteur, 1, 'CT+devis:write, intervention');
    });

    // Droits inchangés (cadrage, section 4 ; N2 du contrôle) : la décision 5 ne change que le verrou d'acompte. Sur un devis
    // à l'acompte attendu, accepté puis en attente d'acompte : les porteurs de devis:write hors encadrement SAV et hors
    // gestion des contrats (commercial, directeur commercial, assistante commerciale, comptable) restent refusés (403) pour
    // l'intervention et le contrat, et le chantier leur est refusé par l'acompte ; la clé d'intégration ne crée ni
    // intervention ni contrat (403) ; les comptes sans devis:write sont refusés (403). Aucune écriture.
    test('conversion d’un devis à l’acompte attendu, droits inchangés : commercial, directeur commercial, assistante commerciale et comptable refusés (403) pour l’intervention et le contrat, clé d’intégration refusée (403), comptes sans devis:write refusés, sans écriture', async () => {
      const devis = await devisSigneAvecAcompte();
      for (const statut of ['ACCEPTE', 'EN_ATTENTE_ACOMPTE']) {
        if (statut === 'EN_ATTENTE_ACOMPTE') await ok(changerStatut(devis.id, statut));
        const attenteChantier = statut === 'ACCEPTE' ? REFUS.chantierAcompteNonConstate : REFUS.chantierAttendAcompte;
        for (const compte of ['COM', 'DC', 'AC', 'CPT']) {
          const auth = comptes[compte].auth;
          await refuse(() => convertir(devis.id, 'INTERVENTION', auth), 403, REFUS.encadrementSav, `${compte}, ${statut}, intervention`);
          await refuse(() => convertir(devis.id, 'CONTRAT', auth), 403, REFUS.gestionContrats, `${compte}, ${statut}, contrat`);
          await refuse(() => convertir(devis.id, 'CHANTIER', auth), 400, attenteChantier, `${compte}, ${statut}, chantier`);
        }
        for (const cible of ['INTERVENTION', 'CONTRAT']) await refuse(() => convertir(devis.id, cible, cles.devis, PORTES.cle), 403, REFUS.sessionSeule, `clé, ${statut}, ${cible}`);
        await refuse(() => convertir(devis.id, 'CHANTIER', cles.devis, PORTES.cle), 400, attenteChantier, `clé, ${statut}, chantier`);
        for (const [compte, auth] of SANS_DROIT()) {
          for (const cible of ['INTERVENTION', 'CONTRAT', 'CHANTIER']) await refuse(() => convertir(devis.id, cible, auth), 403, REFUS.permission, `${compte}, ${statut}, ${cible}`);
        }
      }
      assert.deepEqual(await etatDevis(devis.id), { statut: 'EN_ATTENTE_ACOMPTE', acompteExige: true, tauxAcompte: '40', acompteConstate: false, conversions: [] });
    });

    // Critères « depuis `EN_ATTENTE_ACOMPTE` : l'intervention répond 201 et le devis reste en attente d'acompte ; la route
    // de statut refuse ensuite tout changement (« Ce devis est déjà converti : son statut ne change plus. ») ; le chantier est
    // refusé (« Ce devis attend son acompte : le chantier ne peut pas encore être ouvert. ») ; le devis est absent de la
    // liste « à convertir » ; après la constatation, il repasse `ACCEPTE`, entre dans la liste, et le chantier s'ouvre en
    // seconde conversion ». Joué par l'assistante technique (statut, intervention, liste), la constatation restant à
    // l'administration (403 pour elle, inchangé). Lectures écartées : `EN_ATTENTE_ACOMPTE` qui retient encore l'intervention
    // (400 « Ce devis attend son acompte : l’intervention ne peut pas encore être créée. ») ; statut admis resté `ACCEPTE`
    // seul (400 « Seul un devis accepté peut être converti. ») ; conversion qui repasse le devis « accepté » ; constatation
    // qui ne repasse plus « accepté » un devis converti (le chantier resterait refusé).
    test('conversion depuis « en attente d’acompte » : l’intervention est créée (201) et le devis reste en attente, son statut ne change plus, le chantier est refusé et le devis absent de la liste « à convertir » ; constaté, il repasse accepté, entre dans la liste et ouvre son chantier en seconde conversion', async () => {
      const at = comptes.AT.auth;
      const devis = await devisSigneAvecAcompte();
      const attente = await ok(changerStatut(devis.id, 'EN_ATTENTE_ACOMPTE', at));
      assert.equal(attente.statut, 'EN_ATTENTE_ACOMPTE');
      await refuse(() => convertir(devis.id, 'CHANTIER', at), 400, REFUS.chantierAttendAcompte, 'chantier avant l’intervention');
      assert.ok(!(await aConvertir(at)).includes(devis.id), 'en attente d’acompte : absent de la liste « à convertir »');
      await converti(devis, 'INTERVENTION', at, 1, 'AT, intervention depuis l’attente d’acompte');
      assert.deepEqual(await etatDevis(devis.id), { statut: 'EN_ATTENTE_ACOMPTE', acompteExige: true, tauxAcompte: '40', acompteConstate: false, conversions: [['INTERVENTION', 1]] }, 'le devis reste en attente d’acompte');
      for (const statut of ['ACCEPTE', 'EN_ATTENTE_ACOMPTE', 'REFUSE', 'BROUILLON']) {
        await refuse(() => changerStatut(devis.id, statut, at), 400, REFUS.statutFige, `statut ${statut} après la conversion (AT)`);
      }
      await refuse(() => changerStatut(devis.id, 'ACCEPTE'), 400, REFUS.statutFige, 'statut ACCEPTE après la conversion (SA)');
      await refuse(() => convertir(devis.id, 'CHANTIER', at), 400, REFUS.chantierAttendAcompte, 'chantier après l’intervention, acompte non constaté');
      assert.ok(!(await aConvertir(at)).includes(devis.id), 'converti en intervention, acompte attendu : toujours absent de la liste');
      await refuse(() => constater(devis.id, at), 403, REFUS.administration, 'constatation par l’assistante technique');
      const constate = await ok(constater(devis.id));
      assert.equal(constate.statut, 'ACCEPTE', 'la constatation repasse le devis converti « accepté »');
      assert.deepEqual(await etatDevis(devis.id), { statut: 'ACCEPTE', acompteExige: true, tauxAcompte: '40', acompteConstate: true, conversions: [['INTERVENTION', 1]] });
      assert.ok((await aConvertir(at)).includes(devis.id), 'acompte constaté : le devis entre dans la liste « à convertir »');
      const chantier = await converti(devis, 'CHANTIER', at, 2, 'AT, chantier en seconde conversion');
      assert.deepEqual((await etatDevis(devis.id)).conversions, [['INTERVENTION', 1], ['CHANTIER', 2]]);
      const interventionId = (await prisma.devisConversion.findFirstOrThrow({ where: { devisId: devis.id, cibleType: 'INTERVENTION' } })).cibleId;
      assert.equal((await prisma.intervention.findUniqueOrThrow({ where: { id: interventionId } })).chantierId, chantier.id, 'l’intervention du devis est rattachée au chantier ouvert ensuite');
      assert.ok(!(await aConvertir(at)).includes(devis.id), 'chantier ouvert : le devis sort de la liste');
    });

    // Même règle pour le contrat (décision 5 ; description de l'option, texte de Claude Code : « une intervention SAV ou un
    // contrat se créent sans attendre l'acompte »), par le directeur puis l'administrateur, deux conversions depuis
    // l'attente d'acompte ; puis l'ordre des refus du chantier, inchangé (cadrage, section 4, C1 du contrôle) : « attend son
    // acompte » (étape 3) passe avant « déjà converti » (étape 6) ; une fois l'acompte constaté, la troisième conversion est
    // refusée (409). Et la même suite depuis `ACCEPTE` : intervention créée, devis absent de la liste tant que l'acompte
    // n'est pas constaté, présent après, chantier ouvert.
    test('conversion depuis « en attente d’acompte » en contrat puis en intervention (201, devis toujours en attente) ; le chantier y est refusé « attend son acompte » avant « déjà converti », puis, constaté, par la limite de deux conversions (409) ; depuis « accepté », la liste « à convertir » attend la constatation', async () => {
      const devis = await devisSigneAvecAcompte();
      await ok(changerStatut(devis.id, 'EN_ATTENTE_ACOMPTE', comptes.DIR.auth));
      await converti(devis, 'CONTRAT', comptes.DIR.auth, 1, 'DIR, contrat depuis l’attente d’acompte');
      await converti(devis, 'INTERVENTION', comptes.AD.auth, 2, 'AD, intervention depuis l’attente d’acompte');
      assert.deepEqual(await etatDevis(devis.id), { statut: 'EN_ATTENTE_ACOMPTE', acompteExige: true, tauxAcompte: '40', acompteConstate: false, conversions: [['CONTRAT', 1], ['INTERVENTION', 2]] });
      await refuse(() => convertir(devis.id, 'CHANTIER'), 400, REFUS.chantierAttendAcompte, 'chantier, deux conversions, en attente d’acompte');
      assert.equal((await ok(constater(devis.id))).statut, 'ACCEPTE');
      await refuse(() => convertir(devis.id, 'CHANTIER'), 409, REFUS.deuxConversions, 'chantier, acompte constaté, troisième conversion');

      const accepte = await devisSigneAvecAcompte();
      await converti(accepte, 'INTERVENTION', comptes.AT.auth, 1, 'AT, intervention depuis « accepté »');
      assert.ok(!(await aConvertir()).includes(accepte.id), 'acompte non constaté : absent de la liste « à convertir »');
      const constate = await ok(constater(accepte.id));
      assert.equal(constate.statut, 'ACCEPTE', 'la constatation laisse « accepté » un devis accepté');
      assert.ok((await aConvertir()).includes(accepte.id), 'acompte constaté : présent dans la liste');
      await converti(accepte, 'CHANTIER', SA(), 2, 'SA, chantier en seconde conversion');
    });

    // #578 (R1 du contrôle avant fusion de #576, relevé aussi par l'audit des montants ; correctif dans la route de statut) :
    // « Attendre l’acompte » reste admis sans acompte constaté (200), et le retour à « accepté » reste refusé tant qu'il ne
    // l'est pas ; une fois l'acompte constaté (le devis repasse « accepté »), le retour en attente est refusé (400 « L’acompte
    // de ce devis a déjà été constaté. »), sans aucune écriture : en session (SA, AT) et par clé sur chacun son devis, puis
    // par chaque compte qui écrit les devis. Avant le correctif, il y repassait ; converti ensuite en intervention ou en
    // contrat depuis l'attente (décision 5), il gardait un statut figé, sa constatation déjà faite, et son chantier ne
    // s'ouvrait plus jamais. La suite du parcours de R1 est rejouée : resté accepté, le devis crée son intervention, reste
    // dans la liste « à convertir » et ouvre son chantier en seconde conversion. Lectures écartées : le retour en attente
    // admis après la constatation (l'impasse redevient atteignable) ; le refus appliqué à tout devis exigé, constaté ou non,
    // qui retirerait « Attendre l’acompte ».
    test('#578 : « Attendre l’acompte » reste admis sans acompte constaté (200) ; constaté, le devis repasse accepté et n’y retourne plus (400, sans écriture), en session par chaque compte qui écrit les devis et par clé ; resté accepté, il crée son intervention et ouvre son chantier', async () => {
      let devis = null;
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session SA'], [PORTES.session, comptes.AT.auth, 'session AT'], [PORTES.cle, cles.devis, 'clé']]) {
        devis = await devisSigneAvecAcompte();
        const statut = (valeur) => appeler('put', `${porte}/${devis.id}/statut`, { statut: valeur }, auth);
        assert.equal((await ok(statut('EN_ATTENTE_ACOMPTE'))).statut, 'EN_ATTENTE_ACOMPTE', `${qui} : « Attendre l’acompte » sans acompte constaté`);
        assert.deepEqual(await etatDevis(devis.id), { statut: 'EN_ATTENTE_ACOMPTE', acompteExige: true, tauxAcompte: '40', acompteConstate: false, conversions: [] }, `${qui} : en base`);
        await refuse(() => statut('ACCEPTE'), 400, REFUS.acompteNonConstate, `${qui} : retour à « accepté » sans acompte constaté`);
        assert.equal((await ok(constater(devis.id))).statut, 'ACCEPTE', `${qui} : la constatation repasse le devis accepté`);
        await refuse(() => statut('EN_ATTENTE_ACOMPTE'), 400, REFUS.acompteDejaConstate, `${qui} : retour en attente après la constatation`);
      }
      for (const [compte, auth] of ECRIVENT()) {
        await refuse(() => changerStatut(devis.id, 'EN_ATTENTE_ACOMPTE', auth), 400, REFUS.acompteDejaConstate, `${compte}, retour en attente après la constatation`);
      }
      assert.deepEqual(await etatDevis(devis.id), { statut: 'ACCEPTE', acompteExige: true, tauxAcompte: '40', acompteConstate: true, conversions: [] }, 'statut inchangé');
      await converti(devis, 'INTERVENTION', comptes.AT.auth, 1, 'AT, intervention du devis à l’acompte constaté');
      assert.equal((await etatDevis(devis.id)).statut, 'ACCEPTE', 'converti en intervention, le devis reste accepté');
      assert.ok((await aConvertir()).includes(devis.id), 'il reste dans la liste « à convertir »');
      await converti(devis, 'CHANTIER', SA(), 2, 'SA, chantier en seconde conversion');
    });

    // #578, ordre des refus de la route de statut (correctif : le contrôle vient après le statut figé, la transition et
    // « Ce devis n’exige pas d’acompte. ») : devis constaté puis converti en chantier ou en intervention, refus du statut
    // figé ; brouillon à l'acompte constaté (la constatation est admise sur un brouillon), refus de la transition ; devis
    // « accepté » sans acompte exigé mais à l'acompte constaté, « Ce devis n’exige pas d’acompte. » : état inatteignable par
    // les routes (la constatation exige un acompte, et un devis signé fige son acompte), posé en base sur un devis non signé
    // (fixture théorique). En session et par clé, sans écriture. Lecture écartée : le nouveau refus placé avant les autres.
    test('#578 : le refus « acompte déjà constaté » vient après le statut figé, la transition et « Ce devis n’exige pas d’acompte. », en session et par clé, sans écriture', async () => {
      const chantierOuvert = await devisSigneAvecAcompte();
      await ok(constater(chantierOuvert.id));
      await converti(chantierOuvert, 'CHANTIER', SA(), 1, 'chantier du devis constaté');
      const interventionCreee = await devisSigneAvecAcompte();
      await ok(constater(interventionCreee.id));
      await converti(interventionCreee, 'INTERVENTION', SA(), 1, 'intervention du devis constaté');
      const brouillon = await creerOk({ acompteExige: true });
      await ok(constater(brouillon.id));
      const theorique = await creerOk({ acompteExige: false });
      await prisma.devis.update({ where: { id: theorique.id }, data: { statut: 'ACCEPTE', acompteRecuLe: new Date(), acompteMontant: '96', acompteReference: `TEST-THEORIQUE-${suffixe()}` } });
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        const attendre = (id) => appeler('put', `${porte}/${id}/statut`, { statut: 'EN_ATTENTE_ACOMPTE' }, auth);
        await refuse(() => attendre(chantierOuvert.id), 400, REFUS.chantierOuvert, `${qui}, chantier ouvert`);
        await refuse(() => attendre(interventionCreee.id), 400, REFUS.statutFige, `${qui}, intervention créée`);
        await refuse(() => attendre(brouillon.id), 400, REFUS.transitionBrouillonAttente, `${qui}, brouillon constaté`);
        await refuse(() => attendre(theorique.id), 400, REFUS.nExigePas, `${qui}, accepté sans acompte exigé, constaté (fixture théorique)`);
      }
    });

    // Proposé par l'audit des droits de #576 (T1, mutant M11 survivant), adapté après #578 : un devis « en attente
    // d'acompte » dont l'acompte est constaté n'est plus atteignable par les routes (la constatation depuis l'attente repasse
    // le devis « accepté », et le retour en attente d'un devis constaté est refusé). Le test le vérifie d'abord par les
    // routes, puis garde, sur cet état posé en base (fixture théorique, défense en profondeur), ce qui reste vérifiable : la
    // liste « à convertir » et la conversion en chantier disent la même chose (absent de la liste ; chantier refusé « attend
    // son acompte », sans écriture). Il ne juge plus normale la suite de cet état (intervention créée, devis figé en attente,
    // chantier jamais ouvert) : c'est l'état bloquant que #578 ferme. Lecture écartée : la liste élargie au statut
    // EN_ATTENTE_ACOMPTE, qui proposerait un chantier aussitôt refusé.
    test('audit des droits de #576, après #578 : « en attente d’acompte, acompte constaté » n’est plus atteignable par les routes ; posé en base, le devis reste absent de la liste « à convertir » et le chantier lui est refusé sans écriture', async () => {
      const devis = await devisSigneAvecAcompte();
      await ok(changerStatut(devis.id, 'EN_ATTENTE_ACOMPTE'));
      assert.equal((await ok(constater(devis.id))).statut, 'ACCEPTE', 'constaté depuis l’attente : le devis repasse accepté');
      await refuse(() => changerStatut(devis.id, 'EN_ATTENTE_ACOMPTE', comptes.AT.auth), 400, REFUS.acompteDejaConstate, 'retour en attente du devis constaté');
      assert.deepEqual(await etatDevis(devis.id), { statut: 'ACCEPTE', acompteExige: true, tauxAcompte: '40', acompteConstate: true, conversions: [] }, 'l’état « en attente, constaté » n’est pas atteint');
      await prisma.devis.update({ where: { id: devis.id }, data: { statut: 'EN_ATTENTE_ACOMPTE' } });
      assert.ok(!(await aConvertir()).includes(devis.id), 'fixture théorique : absent de la liste « à convertir »');
      await refuse(() => convertir(devis.id, 'CHANTIER'), 400, REFUS.chantierAttendAcompte, 'fixture théorique : chantier refusé');
    });

    // Refus inchangés de l'intervention et du contrat (cadrage, section 4 : seul le statut `EN_ATTENTE_ACOMPTE` s'ajoute à
    // `ACCEPTE` ; « l'ordre des refus ne change pas ») : brouillon, envoyé et refusé (« Seul un devis accepté peut être
    // converti. »), annulé (« Ce devis est annulé : … »), en attente d'acompte sans signature (statut posé en base, « le
    // statut peut être manipulé ») et ancienne version en attente d'acompte (409, avant tout). Aucune écriture. Lecture
    // écartée : le statut admis élargi à tout statut pour l'intervention et le contrat, ou la signature et la dernière
    // version non contrôlées depuis l'attente d'acompte.
    test('conversion en intervention ou en contrat, refus inchangés : brouillon, envoyé et refusé (« Seul un devis accepté peut être converti. »), annulé, en attente d’acompte sans signature, ancienne version en attente d’acompte (409), sans écriture', async () => {
      const brouillon = await creerOk({ acompteExige: true });
      const envoye = await creerOk({ acompteExige: true });
      await ok(changerStatut(envoye.id, 'ENVOYE'));
      const refuseDevis = await creerOk({ acompteExige: true });
      await refuser(refuseDevis.id);
      const annule = await devisSigneAvecAcompte();
      await ok(appeler('post', `/api/devis/${annule.id}/annulation`, { motif: 'TEST Annulation du devis à l’acompte attendu' }));
      const sansSignature = await creerOk({ acompteExige: true });
      await prisma.devis.update({ where: { id: sansSignature.id }, data: { statut: 'EN_ATTENTE_ACOMPTE' } });
      const ancienne = await devisSigneAvecAcompte();
      await ok(changerStatut(ancienne.id, 'EN_ATTENTE_ACOMPTE'));
      await ok(appeler('post', `/api/devis/${ancienne.id}/revisions`, {}), 201);
      for (const [devis, cas, intervention, contrat, statut] of [
        [brouillon, 'brouillon', REFUS.nonAccepte, REFUS.nonAccepte, 400],
        [envoye, 'envoyé', REFUS.nonAccepte, REFUS.nonAccepte, 400],
        [refuseDevis, 'refusé', REFUS.nonAccepte, REFUS.nonAccepte, 400],
        [annule, 'annulé', REFUS.annuleIntervention, REFUS.annuleContrat, 400],
        [sansSignature, 'en attente d’acompte sans signature', REFUS.nonSigne, REFUS.nonSigne, 400],
        [ancienne, 'ancienne version en attente d’acompte', REFUS.versionPlusRecente, REFUS.versionPlusRecente, 409],
      ]) {
        for (const auth of [SA(), comptes.AT.auth]) {
          await refuse(() => convertir(devis.id, 'INTERVENTION', auth), statut, intervention, `${cas}, intervention`);
          await refuse(() => convertir(devis.id, 'CONTRAT', auth), statut, contrat, `${cas}, contrat`);
        }
      }
    });

    // Copie figée (section 2, « Inchangés » ; schema.prisma : « Le devis fige SA valeur à l'émission ») croisée avec la
    // conversion (section 4) : un devis exigé à 40 % avant le passage du réglage à 0 % garde son acompte exigé, et son
    // chantier attend toujours la constatation, qu'il soit accepté ou en attente d'acompte ; l'intervention se crée sans
    // attendre, comme sans le réglage. Lecture écartée (audit des montants de #576, mutant C12) : le réglage du jour à 0 %
    // lu à la conversion, qui ouvrirait le chantier d'un devis exigé sans acompte constaté (« rien n'est exigé » appliqué aux
    // devis déjà émis) ; de même, la liste « à convertir » qui le proposerait.
    test('réglage passé à 0 % après l’émission : le devis exigé à 40 % garde son acompte ; son chantier reste refusé, accepté ou en attente d’acompte, et absent de la liste « à convertir » jusqu’à la constatation ; l’intervention se crée sans attendre', async () => {
      const accepte = await devisSigneAvecAcompte();
      const attente = await devisSigneAvecAcompte();
      await ok(changerStatut(attente.id, 'EN_ATTENTE_ACOMPTE'));
      await avecTauxParDefaut(0, async () => {
        await refuse(() => convertir(accepte.id, 'CHANTIER'), 400, REFUS.chantierAcompteNonConstate, 'accepté, chantier, réglage à 0 %');
        await refuse(() => convertir(attente.id, 'CHANTIER'), 400, REFUS.chantierAttendAcompte, 'en attente d’acompte, chantier, réglage à 0 %');
        const liste = await aConvertir();
        assert.ok(!liste.includes(accepte.id) && !liste.includes(attente.id), 'réglage à 0 % : ni l’un ni l’autre dans la liste « à convertir »');
        await converti(accepte, 'INTERVENTION', SA(), 1, 'accepté, intervention, réglage à 0 %');
        assert.deepEqual(await etatDevis(accepte.id), { statut: 'ACCEPTE', acompteExige: true, tauxAcompte: '40', acompteConstate: false, conversions: [['INTERVENTION', 1]] }, 'le devis garde son acompte exigé à 40 %');
        await refuse(() => convertir(accepte.id, 'CHANTIER'), 400, REFUS.chantierAcompteNonConstate, 'accepté, chantier après l’intervention, réglage à 0 %');
        assert.equal((await ok(constater(attente.id))).statut, 'ACCEPTE', 'constaté : le devis repasse accepté');
        assert.ok((await aConvertir()).includes(attente.id), 'constaté : dans la liste « à convertir »');
        await converti(attente, 'CHANTIER', SA(), 1, 'constaté, chantier, réglage à 0 %');
      });
    });

    // ==================================================================================================================
    // #570 : case « acompte exigé » lue en booléen strict (cadrage v2 du lot, périmètre 1 et critères observables).
    // ==================================================================================================================

    const ligneTempsPasse = () => ({ tempsPasse: true, designation: 'TEST Main d’œuvre au temps passé', quantite: 1, tarifTempsPasse: 'HORS_CONTRAT', catalogueFamille: 'prestations', catalogueId: mainOeuvre.id });
    // Rang d'un numéro d'affaire (« A26-0042 » : 42), pour prouver qu'aucun numéro n'est consommé entre deux créations.
    const rangNumero = (numero) => {
      assert.match(numero, /^A\d{2}-\d{4,}$/, `numéro d’affaire ${numero}`);
      return Number(numero.split('-')[1]);
    };
    // Conditions d'acompte et constatation d'un devis, relues en base.
    const acompteEnBase = async (id) => {
      const d = await prisma.devis.findUniqueOrThrow({ where: { id } });
      return [d.acompteExige, d.tauxAcompte?.toString() ?? null, d.acompteRecuLe?.toISOString() ?? null, d.acompteMontant?.toString() ?? null, d.acompteReference, d.acompteConstateParId, d.statut, d.objet];
    };
    // Joueurs d'un refus : toutes les valeurs pour le super administrateur et la clé, les deux valeurs courtes pour chacun
    // des autres comptes qui écrivent les devis (droit individuel compris).
    const joueursCase = () => [
      ['SA', SA(), PORTES.session, CASES_REFUSEES],
      ['clé devis:write', cles.devis, PORTES.cle, CASES_REFUSEES],
      ...ECRIVENT().filter(([c]) => c !== 'SA').map(([c, a]) => [c, a, PORTES.session, CASES_REFUSEES_COURTES]),
    ];

    // Critère « `POST /devis` (…), en session et par clé, avec `acompteExige` valant "false", "true", 0, 1, null, {} ou [] :
    // 400 au message exact, sans écriture (empreinte de la base, numérotation des devis inchangée) ». Chaque valeur avec et
    // sans taux (un taux valide ne fait pas passer la case). La numérotation est prouvée deux fois : empreinte de toute la
    // base (SequenceAffaire comprise) à chaque refus, et le devis créé après tous les refus porte le numéro qui suit celui
    // du devis créé avant eux. Lectures écartées : voir CASES_REFUSEES.
    test('#570, création : une case « acompteExige » non booléenne (« false », « true », 0, 1, null, {}, [] …) est refusée (400, message exact), avec ou sans taux, sans écriture ni numéro consommé, en session par chaque compte qui écrit les devis et par clé', async () => {
      const avant = await creerOk({ acompteExige: false });
      const sequenceAvant = await prisma.sequenceAffaire.findMany();
      for (const [compte, auth, porte, valeurs] of joueursCase()) {
        for (const [quoi, valeur] of valeurs) {
          for (const [avecTaux, extra] of [['sans taux', {}], ['taux 35', { tauxAcompte: 35 }], ['taux vide', { tauxAcompte: '' }]]) {
            await refuse(() => creer(corpsDevis({ ...extra, acompteExige: valeur }), auth, porte), 400, REFUS.acompteExige, `${compte}, création, ${quoi}, ${avecTaux}`);
          }
        }
      }
      assert.deepEqual(await prisma.sequenceAffaire.findMany(), sequenceAvant, 'aucun numéro d’affaire consommé');
      const apres = await creerOk({ acompteExige: false });
      assert.equal(rangNumero(apres.numero), rangNumero(avant.numero) + 1, `numérotation continue : ${avant.numero} puis ${apres.numero}`);
    });

    // Critère « `PATCH /devis/:id`, en session et par clé, avec `acompteExige` valant (…) : 400 au message exact, sans
    // écriture » ; « Changement observable : en modification, `null` décochait la case ; il est désormais refusé ». Devis
    // exigé à 35 % et devis non exigé, requête mêlée (objet et lignes changés, avec ou sans taux) : rien n'est écrit, pas
    // même l'objet. Lectures écartées : `null` lu comme faux (case décochée, taux retiré : l'état d'avant le lot) ; `null` lu
    // comme absent (200, 35 % gardé) ; « false » lu par `!!` (200, case gardée cochée).
    test('#570, modification : une case non booléenne est refusée (400, message exact) sur un devis exigé à 35 % et sur un devis non exigé, requête mêlée, sans écriture, en session par chaque compte et par clé ; null ne décoche plus la case', async () => {
      const exigeA35 = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      const nonExige = await creerOk({ acompteExige: false });
      const etatsAvant = [await acompteEnBase(exigeA35.id), await acompteEnBase(nonExige.id)];
      assert.deepEqual(etatsAvant.map((e) => e.slice(0, 2)), [[true, '35'], [false, null]]);
      for (const [compte, auth, porte, valeurs] of joueursCase()) {
        for (const [quoi, valeur] of valeurs) {
          for (const [devis, extra, cas] of [
            [exigeA35, {}, 'devis exigé à 35 %'],
            [exigeA35, { tauxAcompte: 50 }, 'devis exigé à 35 %, taux 50'],
            [nonExige, {}, 'devis non exigé'],
            [nonExige, { tauxAcompte: '25' }, 'devis non exigé, taux 25'],
          ]) {
            const envoye = { ...corpsDevis({ objet: `TEST Objet changé ${suffixe()}`, lignes: [ligneLibre({ quantite: 3 })] }), ...extra, acompteExige: valeur };
            await refuse(() => modifier(devis.id, envoye, auth, porte), 400, REFUS.acompteExige, `${compte}, ${cas}, ${quoi}`);
          }
        }
      }
      assert.deepEqual([await acompteEnBase(exigeA35.id), await acompteEnBase(nonExige.id)], etatsAvant, 'conditions, statut et objet inchangés');
    });

    // Cadrage, périmètre 1, « Ordre des contrôles », création : le lecteur est appelé juste après `lireTauxAcompteSaisi`
    // (`routes.ts:81`) ; « il passe donc après le 403 des droits et après les refus de `devisPayload` (corps incomplet, lignes,
    // `auTempsPasse`), et après celui du taux (un taux et une case tous deux malformés : message du taux) ; il passe avant
    // « Client introuvable. », le 409 du pas non réglé et la numérotation (création), (…) et avant le refus du 0 % ("false" avec
    // `tauxAcompte: 0` : message de la case, et non celui du 0 %) ». Chaque refus qui suit la case a son témoin (case booléenne :
    // le refus suivant est bien atteint). Lectures écartées : contrôle placé seulement dans `acompteDevisPayload` (après le
    // client, le temps passé et la résolution des lignes : « Client introuvable. » ou 409) ; contrôle avant `devisPayload` ou
    // avant le taux ; refus du 0 % avant la case.
    test('#570, création, ordre des refus : la case est contrôlée après les droits (403, 401), le corps incomplet, la ligne invalide, « auTempsPasse » et le taux malformé ; avant « Client introuvable. », le 409 du pas non réglé, le refus du 0 % et la numérotation ; en session et par clé, sans écriture', async () => {
      const sequenceAvant = await prisma.sequenceAffaire.findMany();
      for (const [compte, auth] of SANS_DROIT()) {
        await refuse(() => creer(corpsDevis({ acompteExige: 'false' }), auth), 403, REFUS.permission, `${compte}, « false »`);
        await refuse(() => creer(corpsDevis({ acompteExige: null, tauxAcompte: 'abc' }), auth), 403, REFUS.permission, `${compte}, null et « abc »`);
      }
      await refuse(() => creer(corpsDevis({ acompteExige: 'false' }), cles.autre, PORTES.cle), 403, REFUS.scope, 'clé devis:read, « false »');
      await refuse(() => creer(corpsDevis({ acompteExige: 'false' }), SA(), PORTES.cle), 401, REFUS.cleRequise, 'session sur /api/v1, « false »');
      await refuse(() => creer(corpsDevis({ acompteExige: 'false' }), cles.devis, PORTES.session), 401, REFUS.session, 'clé sur /api/devis, « false »');
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        // Avant la case.
        await refuse(() => creer({ clientId: client.id, objet: 'TEST Sans ligne', lignes: [], acompteExige: 'false' }, auth, porte), 400, REFUS.corps, `${qui} : corps sans ligne et « false »`);
        await refuse(() => creer(corpsDevis({ lignes: [ligneLibre({ quantite: 'abc' })], acompteExige: 'false' }), auth, porte), 400, REFUS.ligne, `${qui} : ligne invalide et « false »`);
        await refuse(() => creer(corpsDevis({ auTempsPasse: 'oui', acompteExige: 'false' }), auth, porte), 400, REFUS.auTempsPasse, `${qui} : « auTempsPasse » et « acompteExige » non booléens`);
        for (const [taux, valeur] of [['abc', 'false'], ['1000', null], [true, 1]]) {
          await refuse(() => creer(corpsDevis({ tauxAcompte: taux, acompteExige: valeur }), auth, porte), 400, REFUS.taux, `${qui} : taux ${JSON.stringify(taux)} et case ${JSON.stringify(valeur)} malformés : message du taux`);
        }
        // Après la case : client inconnu, pas non réglé, 0 %.
        for (const valeur of ['false', null]) {
          await refuse(() => creer({ ...corpsDevis({ acompteExige: valeur }), clientId: randomUUID() }, auth, porte), 400, REFUS.acompteExige, `${qui} : client inconnu et case ${JSON.stringify(valeur)}`);
          await refuse(() => creer(corpsDevis({ auTempsPasse: true, lignes: [ligneTempsPasse()], acompteExige: valeur }), auth, porte), 400, REFUS.acompteExige, `${qui} : pas non réglé et case ${JSON.stringify(valeur)}`);
          await refuse(() => creer(corpsDevis({ acompteExige: valeur, tauxAcompte: 0 }), auth, porte), 400, REFUS.acompteExige, `${qui} : 0 % et case ${JSON.stringify(valeur)} : message de la case`);
        }
        // Témoins : la case booléenne laisse chaque refus suivant se produire.
        await refuse(() => creer({ ...corpsDevis({ acompteExige: false }), clientId: randomUUID() }, auth, porte), 400, REFUS.client, `${qui} : témoin, client inconnu`);
        await refuse(() => creer(corpsDevis({ auTempsPasse: true, lignes: [ligneTempsPasse()], acompteExige: false }), auth, porte), 409, REFUS.pasNonRegle, `${qui} : témoin, pas non réglé`);
        await refuse(() => creer(corpsDevis({ acompteExige: true, tauxAcompte: 0 }), auth, porte), 400, REFUS.zero, `${qui} : témoin, 0 % exigé`);
      }
      assert.deepEqual(await prisma.sequenceAffaire.findMany(), sequenceAvant, 'aucun numéro d’affaire consommé');
    });

    // Même ordre à la modification (cadrage, périmètre 1 : « avant le 404 du devis inconnu et les 409 du devis signé,
    // converti ou d'un statut non modifiable (modification) », contrôle de forme avant la transaction, comme le taux).
    // Le 409 du devis converti n'est atteint par les routes que sur un devis non signé, ce qu'aucune conversion ne laisse
    // (la conversion exige la signature, contrôlée avant) : il est éprouvé sur un brouillon auquel une conversion est
    // ajoutée en base (fixture théorique ; cible CHANTIER, sans clé étrangère). Chaque refus suivant a son témoin.
    // Lectures écartées : contrôle placé sous le verrou, dans `acompteDevisPayload` (404, 409, « Client introuvable. » ou
    // 409 du pas d'abord) ; refus du 0 % avant la case (devis exigé, « false » et 0 : message du 0 %).
    test('#570, modification, ordre des refus : la case est contrôlée après les droits, le corps incomplet et le taux malformé ; avant le 404 du devis inconnu, les 409 du devis signé, converti (fixture théorique) ou refusé, « Client introuvable. », le 409 du pas non réglé et le refus du 0 % ; en session et par clé, sans écriture', async () => {
      const brouillon = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      const signe = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      await signer(signe.id);
      const refuseDevis = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      await refuser(refuseDevis.id);
      const converti = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      const { dossierId } = await prisma.devis.findUniqueOrThrow({ where: { id: converti.id }, select: { dossierId: true } });
      await prisma.devisConversion.create({ data: { devisId: converti.id, dossierId, cibleType: 'CHANTIER', cibleId: randomUUID(), rang: 1 } });
      const etatsAvant = await Promise.all([brouillon, signe, refuseDevis, converti].map((d) => acompteEnBase(d.id)));
      for (const [compte, auth] of SANS_DROIT()) {
        for (const id of [brouillon.id, randomUUID()]) {
          await refuse(() => modifier(id, corpsDevis({ acompteExige: 'false' }), auth), 403, REFUS.permission, `${compte}, modification, « false »`);
        }
      }
      await refuse(() => modifier(brouillon.id, corpsDevis({ acompteExige: 'false' }), cles.autre, PORTES.cle), 403, REFUS.scope, 'clé devis:read, « false »');
      await refuse(() => modifier(brouillon.id, corpsDevis({ acompteExige: 'false' }), SA(), PORTES.cle), 401, REFUS.cleRequise, 'session sur /api/v1, « false »');
      await refuse(() => modifier(brouillon.id, corpsDevis({ acompteExige: 'false' }), cles.devis, PORTES.session), 401, REFUS.session, 'clé sur /api/devis, « false »');
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        // Avant la case.
        await refuse(() => modifier(brouillon.id, { clientId: client.id, objet: 'TEST Sans ligne', lignes: [], acompteExige: 'false' }, auth, porte), 400, REFUS.corps, `${qui} : corps sans ligne et « false »`);
        await refuse(() => modifier(randomUUID(), { clientId: client.id, objet: 'TEST Sans ligne', lignes: [], acompteExige: null }, auth, porte), 400, REFUS.corps, `${qui} : devis inconnu, corps sans ligne et null`);
        await refuse(() => modifier(brouillon.id, corpsDevis({ tauxAcompte: 'abc', acompteExige: 'false' }), auth, porte), 400, REFUS.taux, `${qui} : taux et case malformés : message du taux`);
        // Après la case : 404, 409, chacun avec son témoin.
        for (const [id, statut, message, cas] of [
          [randomUUID(), 404, REFUS.introuvable, 'devis inconnu'],
          [signe.id, 409, REFUS.signe, 'devis signé'],
          [converti.id, 409, REFUS.converti, 'devis converti (fixture théorique)'],
          [refuseDevis.id, 409, REFUS.nonModifiable, 'devis refusé'],
        ]) {
          for (const valeur of ['false', null, 1]) {
            await refuse(() => modifier(id, corpsDevis({ acompteExige: valeur }), auth, porte), 400, REFUS.acompteExige, `${qui}, ${cas}, case ${JSON.stringify(valeur)}`);
          }
          await refuse(() => modifier(id, corpsDevis({ acompteExige: false }), auth, porte), statut, message, `${qui}, ${cas}, témoin à la case booléenne`);
        }
        // Après la case : client inconnu, passage au temps passé sans pas réglé, 0 % sur un devis exigé.
        for (const valeur of ['false', null]) {
          await refuse(() => modifier(brouillon.id, { ...corpsDevis({ acompteExige: valeur }), clientId: randomUUID() }, auth, porte), 400, REFUS.acompteExige, `${qui} : client inconnu et case ${JSON.stringify(valeur)}`);
          await refuse(() => modifier(brouillon.id, corpsDevis({ auTempsPasse: true, lignes: [ligneTempsPasse()], acompteExige: valeur }), auth, porte), 400, REFUS.acompteExige, `${qui} : pas non réglé et case ${JSON.stringify(valeur)}`);
          await refuse(() => modifier(brouillon.id, corpsDevis({ acompteExige: valeur, tauxAcompte: 0 }), auth, porte), 400, REFUS.acompteExige, `${qui} : devis exigé, 0 % et case ${JSON.stringify(valeur)} : message de la case`);
        }
        await refuse(() => modifier(brouillon.id, { ...corpsDevis({ acompteExige: true }), clientId: randomUUID() }, auth, porte), 400, REFUS.client, `${qui} : témoin, client inconnu`);
        await refuse(() => modifier(brouillon.id, corpsDevis({ auTempsPasse: true, lignes: [ligneTempsPasse()], acompteExige: true }), auth, porte), 409, REFUS.pasNonRegle, `${qui} : témoin, pas non réglé`);
        await refuse(() => modifier(brouillon.id, corpsDevis({ acompteExige: true, tauxAcompte: 0 }), auth, porte), 400, REFUS.zero, `${qui} : témoin, 0 % exigé par la case`);
        await refuse(() => modifier(brouillon.id, corpsDevis({ tauxAcompte: 0 }), auth, porte), 400, REFUS.zero, `${qui} : témoin, 0 % exigé par le devis, clé absente`);
      }
      assert.deepEqual(await Promise.all([brouillon, signe, refuseDevis, converti].map((d) => acompteEnBase(d.id))), etatsAvant, 'devis inchangés');
    });

    // Critère « Acompte constaté (révision d'un devis signé dont l'acompte est constaté, puis `PATCH`) : "false" refusé
    // (400), `true` et `false` gardent les conditions (200) » ; cadrage, périmètre 1 : dans `acompteDevisPayload`, le lecteur
    // passe « juste après la lecture du taux, avant la reprise des conditions d'un acompte constaté ». Brouillon exigé à
    // 30 %, acompte constaté (72,00 € : 30 % de 240,00 € TTC) ; et révision d'un devis signé exigé à 30 % dont l'acompte est
    // constaté, qui recopie la constatation. Lectures écartées : contrôle placé après la reprise des conditions encaissées
    // (« false » admis en 200, conditions gardées) ; case décochée qui retirerait un acompte encaissé.
    test('#570, acompte constaté : sur un brouillon constaté et sur la révision d’un devis signé dont l’acompte est constaté, « false », null et 0 sont refusés (400) sans écriture ; true et false gardent les conditions et l’acompte (200), en session et par clé', async () => {
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        const brouillon = await creerOk({ acompteExige: true, tauxAcompte: 30 });
        await ok(appeler('post', `/api/devis/${brouillon.id}/acompte`, { recuLe: await aujourdhui(), montant: '72,00', reference: `TEST-ACOMPTE-570-${suffixe()}` }));
        const source = await creerOk({ acompteExige: true, tauxAcompte: 30 });
        await signer(source.id);
        await ok(appeler('post', `/api/devis/${source.id}/acompte`, { recuLe: await aujourdhui(), montant: '72,00', reference: `TEST-ACOMPTE-570-${suffixe()}` }));
        const revision = await ok(appeler('post', `${porte}/${source.id}/revisions`, {}, auth), 201);
        const sourceEnBase = await acompteEnBase(source.id);
        const revisionAvant = await acompteEnBase(revision.id);
        assert.deepEqual([revisionAvant.slice(0, 6), revisionAvant[6]], [sourceEnBase.slice(0, 6), 'BROUILLON'], `${qui} : la révision recopie les conditions et la constatation`);
        for (const [devis, cas] of [[brouillon, 'brouillon constaté'], [revision, 'révision d’un devis signé constaté']]) {
          const avant = await acompteEnBase(devis.id);
          assert.deepEqual([avant[0], avant[1], avant[3]], [true, '30', '72'], `${qui}, ${cas} : préparé`);
          assert.ok(avant[2], `${qui}, ${cas} : acompte constaté`);
          for (const [quoi, valeur] of [['« false »', 'false'], ['null', null], ['0', 0]]) {
            await refuse(() => modifier(devis.id, corpsDevis({ objet: `TEST Objet changé ${suffixe()}`, acompteExige: valeur }), auth, porte), 400, REFUS.acompteExige, `${qui}, ${cas}, ${quoi}`);
          }
          for (const valeur of [true, false]) {
            const res = await ok(modifier(devis.id, corpsDevis({ objet: devis.objet, acompteExige: valeur }), auth, porte));
            assert.deepEqual([res.acompteExige, res.tauxAcompte], [true, 30], `${qui}, ${cas}, ${valeur} : réponse`);
            assert.deepEqual(await acompteEnBase(devis.id), avant, `${qui}, ${cas}, ${valeur} : conditions et acompte constaté inchangés`);
          }
        }
        assert.deepEqual(await acompteEnBase(source.id), sourceEnBase, `${qui} : le devis signé est inchangé`);
      }
    });

    // Critère « `true` et `false` : comportement inchangé (taux par défaut, taux saisi, refus du 0 %, réglage à 0 % sans
    // acompte, clé absente) » ; cadrage, « Clé absente : comportement actuel (création : non exigé ; modification : valeur du
    // devis gardée) ». Taux par défaut de la base neuve (40 %), distinct du taux saisi (35 %) et du taux de l'autre réglage
    // (0 %) : chaque attendu écarte un autre. Lectures écartées : `false` refusé ou lu comme vrai ; clé absente refusée, ou lue
    // comme fausse en modification (35 % perdu), ou comme vraie à la création (exigé à 40 %).
    test('#570, booléens inchangés : true exige un acompte (40 % par défaut, 35 % saisi), false n’en exige pas (taux non enregistré), la clé absente garde le comportement actuel (création non exigée, modification à l’état du devis), true avec 0 % refusé, réglage à 0 % sans acompte ; en session par chaque compte qui écrit les devis et par clé', async () => {
      assert.equal(tauxDeDepart, '40', 'taux par défaut de la base neuve');
      const etat = async (id) => (await acompteEnBase(id)).slice(0, 2);
      for (const [compte, auth, porte] of [...ECRIVENT().map(([c, a]) => [c, a, PORTES.session]), ['clé devis:write', cles.devis, PORTES.cle]]) {
        for (const [quoi, extra, attendu] of [
          ['true sans taux', { acompteExige: true }, [true, '40']],
          ['true à 35 %', { acompteExige: true, tauxAcompte: 35 }, [true, '35']],
          ['false sans taux', { acompteExige: false }, [false, null]],
          ['false à 35 %', { acompteExige: false, tauxAcompte: 35 }, [false, null]],
          ['clé absente', {}, [false, null]],
        ]) {
          const cree = await ok(creer(corpsDevis(extra), auth, porte), 201);
          assert.deepEqual([cree.acompteExige, cree.tauxAcompte], [attendu[0], attendu[1] === null ? null : Number(attendu[1])], `${compte}, création, ${quoi} : réponse`);
          assert.deepEqual(await etat(cree.id), attendu, `${compte}, création, ${quoi} : en base`);
        }
        for (const [quoi, initial, extra, attendu] of [
          ['exigé à 35 %, false', { acompteExige: true, tauxAcompte: 35 }, { acompteExige: false }, [false, null]],
          ['exigé à 35 %, true', { acompteExige: true, tauxAcompte: 35 }, { acompteExige: true }, [true, '35']],
          ['exigé à 35 %, clé absente', { acompteExige: true, tauxAcompte: 35 }, {}, [true, '35']],
          ['non exigé, true', { acompteExige: false }, { acompteExige: true }, [true, '40']],
          ['non exigé, clé absente', { acompteExige: false }, {}, [false, null]],
          ['non exigé, false', { acompteExige: false }, { acompteExige: false }, [false, null]],
        ]) {
          const devis = await creerOk(initial);
          await ok(modifier(devis.id, corpsDevis({ objet: devis.objet, ...extra }), auth, porte));
          assert.deepEqual(await etat(devis.id), attendu, `${compte}, modification, ${quoi}`);
        }
        await refuse(() => creer(corpsDevis({ acompteExige: true, tauxAcompte: 0 }), auth, porte), 400, REFUS.zero, `${compte}, true à 0 %`);
      }
      await avecTauxParDefaut(0, async () => {
        for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
          const cree = await ok(creer(corpsDevis({ acompteExige: true }), auth, porte), 201);
          assert.deepEqual(await etat(cree.id), [false, null], `${qui}, réglage à 0 %, true sans taux : sans acompte`);
          const saisi = await ok(creer(corpsDevis({ acompteExige: true, tauxAcompte: 35 }), auth, porte), 201);
          assert.deepEqual(await etat(saisi.id), [true, '35'], `${qui}, réglage à 0 %, true à 35 %`);
        }
      });
    });

    // Cadrage, constat : « Ne la lisent pas : la révision (reprend le devis signé), la duplication (relit le taux du jour),
    // la conversion, le changement de statut et la constatation de l'acompte ». Une case non booléenne envoyée à ces routes
    // est ignorée (copie figée : la révision recopie 35 %, la duplication relit le taux par défaut du jour, 40 %). Lecture
    // écartée : le contrôle appliqué hors des deux routes du cadrage (un refus 400 de la révision ou de la conversion, ou une
    // révision qui relirait la case).
    test('#570, copie figée : la révision, la duplication, le statut, la constatation et la conversion ignorent une case non booléenne envoyée ; la révision recopie 35 %, la duplication relit le taux par défaut (40 %)', async () => {
      const source = await creerOk({ acompteExige: true, tauxAcompte: 35 });
      await signer(source.id);
      for (const [porte, auth, qui] of [[PORTES.session, SA(), 'session'], [PORTES.cle, cles.devis, 'clé']]) {
        const avecCase = (corps) => ({ ...corps, acompteExige: 'false' });
        const sourceSignee = qui === 'session' ? source : await creerOk({ acompteExige: true, tauxAcompte: 35 });
        if (qui === 'clé') await signer(sourceSignee.id);
        const revision = await ok(appeler('post', `${porte}/${sourceSignee.id}/revisions`, avecCase({}), auth), 201);
        assert.deepEqual((await acompteEnBase(revision.id)).slice(0, 2), [true, '35'], `${qui}, révision`);
        if (qui === 'session') {
          const duplicata = await ok(appeler('post', `/api/devis/${source.id}/duplication`, avecCase({})), 201);
          assert.deepEqual((await acompteEnBase(duplicata.id)).slice(0, 2), [true, '40'], 'duplication : taux par défaut du jour');
          const brouillon = await creerOk({ acompteExige: true, tauxAcompte: 35 });
          assert.equal((await ok(appeler('put', `/api/devis/${brouillon.id}/statut`, avecCase({ statut: 'ENVOYE' })))).statut, 'ENVOYE', 'statut');
          await ok(appeler('post', `/api/devis/${brouillon.id}/acompte`, avecCase({ recuLe: await aujourdhui(), montant: '84,00', reference: `TEST-ACOMPTE-570-${suffixe()}` })));
          assert.deepEqual((await acompteEnBase(brouillon.id)).slice(0, 4).map((v, i) => (i === 2 ? v !== null : v)), [true, '35', true, '84'], 'constatation');
        }
        const aConvertirDevis = await creerOk({ acompteExige: false });
        await signer(aConvertirDevis.id);
        const conversion = await appeler('post', `${porte}/${aConvertirDevis.id}/convertir`, avecCase({ cible: 'CHANTIER' }), auth);
        assert.equal(conversion.status, 201, `${qui}, conversion : ${JSON.stringify(conversion.body)}`);
        assert.deepEqual((await acompteEnBase(aConvertirDevis.id)).slice(0, 2), [false, null], `${qui}, conversion : conditions inchangées`);
      }
    });
  });
}
