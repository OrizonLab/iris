// Lot « Assistante technique », PR AT-4 : avoirs de l'assistante technique et repère « déjà facturée » (cadrage AT-4,
// version 2, section « Tests », et critères métier observables 1 à 6 ; rapport du contrôle de cohérence de mode 1 : C2, C4,
// T1, T2 et N11).
//
// Décisions appliquées, mot pour mot :
//  - message de Nelson du 09-11-2026 : « Oui il faut un repere deja facturer, elle peut egalement faire un avoir, » ;
//  - réponse 1 du 09-11-2026, « Partiels et annulation (Recommandé) » : « Elle crée des avoirs partiels et peut aussi annuler
//    une facture émise par son avoir total, comme l'administration. Elle envoie ces avoirs. Les règlements lui restent
//    fermés. » ;
//  - réponse 2, « Toute facture non annulée (Recommandé) » : « Brouillon, émise ou réglée : le repère s'affiche dès qu'une
//    facture vivante existe sur l'origine. Une facture annulée par son avoir total ne compte plus. Le repère s'affiche aussi
//    pour l'administration. » ;
//  - réponse 3, « Même origine seulement (Recommandé) » : « Le repère ne regarde que les factures de l'origine choisie : une
//    facture du chantier ne s'affiche pas sur ses interventions, ni celle d'un contrat sur ses visites. » ;
//  - réponse 4 (lecture retenue pour le repère) : une facture couverte, en tout ou en partie, par des avoirs partiels n'est pas
//    annulée ; elle compte. AT-4 ne changeait aucun statut ni aucune règle de règlement. Depuis le lot « Statut d'une facture
//    couverte par des avoirs » (cadrage v3, lecture retenue de la même réponse, à corriger par Nelson si besoin ; voir #521), une
//    facture couverte en totalité par ses avoirs partiels est « réglée », avec l'entrée REGLEMENT au nom de l'auteur de l'avoir
//    qui la solde, et le détail de la transition cite le montant des avoirs (« avoirs X € », choix par défaut, à confirmer) : la
//    règle du 17-10-2026 (« une facture soldée par ses seuls avoirs reste émise ») est remplacée, et les attendus ci-dessous
//    suivent la nouvelle règle (statut-facture-avoirs.test.mjs la prouve).
// Choix par défaut du cadrage, à confirmer, testés tels qu'écrits : envoi des avoirs que l'administration porte sur les
// factures de son poste ; nouveau texte du refus d'une seconde facture au temps passé.
//
// Contrat éprouvé (cadrage v2, § 1 et 2) : POST /api/factures/:id/avoirs et /annuler sous requireGestionFactures ; la facture
// source relue dans le périmètre du lecteur (pieceVisible) après le verrou ; hors périmètre, 404 « Facture introuvable. » avant
// tout refus propre à la pièce (statut, avoir sur un avoir, avoirs partiels déjà émis, règlement reçu, taux absent (400),
// plafond (409), imputation ou identité incomplètes (409)), sans écriture ni numéro consommé ; seul le 400 des lignes absentes
// ou mal formées, lu avant la transaction, le précède. Envoi de tout avoir de son poste. GET /api/factures/deja-facturee :
// { dejaFacturee } seul, facture vivante (type FACTURE, statut autre qu'ANNULEE) de même origine, de tout auteur ; 400
// « Origine invalide. », 404 « Origine introuvable. ».
//
// Montants (classés C : CLAUDE.md, « un test manquant qui touche un montant ») : aucun calcul ne change, seul l'auteur change.
// Chaque valeur est choisie pour qu'une autre lecture plausible de la règle donne un autre résultat ; chaque attendu est écrit en
// dur, la lecture écartée en commentaire, et le test « témoin des montants » les recalcule en décimal exact, hors de
// l'application, et vérifie que chaque lecture écartée en diffère.
//
// Comme chantier-annule-termine.test.mjs, ce fichier crée sur le serveur de TEST_DATABASE_URL une base jetable qui
// n'appartient qu'à lui (« test » comme mot, suffixe tiré au hasard), la migre, la sert à l'application montée en mémoire,
// puis la supprime : la numérotation des avoirs et l'export comptable y sont lus sans les pièces des autres fichiers, que
// `node --test` exécute en parallèle. Microsoft Graph est simulé par un petit serveur HTTP local, désigné par
// MICROSOFT_GRAPH_URL, comme dans envoi-microsoft-365.test.mjs. Sans TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP
// n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { PDFParse } from 'pdf-parse';

const TITRE = 'Assistante technique (AT-4) : avoirs partiels et annulation des factures de son poste, envoi de ses avoirs, repère « déjà facturée »';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ROLE_AT = 'ASSISTANTE_TECHNIQUE';
// Messages exacts (cadrage v2 ; contrat de Claude Code).
const REFUS = {
  gestion: 'Accès réservé à l’administration et à l’assistante technique.',
  administration: 'Accès réservé aux administrateurs',
  introuvable: 'Facture introuvable.',
  lignesAbsentes: 'Un avoir partiel doit contenir au moins une ligne.',
  ligneInvalide: 'Ligne d’avoir partiel invalide.',
  tauxAbsent: 'Le taux de TVA d’une ligne d’avoir doit être présent sur la facture d’origine.',
  plafondTotal: 'Cet avoir dépasse le montant total restant à créditer sur la facture d’origine.',
  plafondTaux55: 'Cet avoir dépasse le plafond restant pour la TVA à 5.5 % de la facture d’origine.',
  plafondTaux20: 'Cet avoir dépasse le plafond restant pour la TVA à 20 % de la facture d’origine.',
  nonCreditable: 'Seule une facture émise ou réglée peut recevoir un avoir partiel.',
  nonAnnulable: 'Seule une facture émise peut être annulée.',
  avoirsPartiels: 'Cette facture porte déjà un ou plusieurs avoirs partiels : elle ne peut plus être annulée en totalité.',
  reglementRecu: 'Cette facture a reçu un règlement : elle ne peut plus être annulée en totalité. Émettez un avoir partiel, ou contre-passez d’abord un règlement saisi par erreur.',
  natureAbsente: 'L’avoir crédite une nature ou un taux absent de la facture d’origine (VENTE_ARTICLE).',
  // Refus de l'identité de la société (documents/identite.ts), commun à l'émission et aux avoirs ; il la renvoie à un écran
  // qu'elle n'a pas (#518, N7 du contrôle de mode 1).
  identite: 'Identité de la société incomplète : renseignez SIRET dans l’écran Société avant d’émettre.',
  origineInvalide: 'Origine invalide.',
  origineIntrouvable: 'Origine introuvable.',
  // Choix par défaut 7 d'AT-3, modifié par AT-4 (cadrage v2, § 1, « Refus d'une seconde facture au temps passé ») : texte du
  // cadrage, mot pour mot.
  tempsPasseAt: 'Cette intervention ou l’une de ses suites a déjà une facture : la facture au temps passé est unique. Un brouillon s’émet d’abord. Pour refaire une facture émise de votre poste, annulez-la d’abord par son avoir total ; une facture qui a reçu un avoir partiel, ou un règlement qui n’est pas contre-passé, ne s’annule plus en totalité et se corrige par des avoirs partiels. Si la facture n’apparaît pas dans votre liste, adressez-vous à l’administration.',
  // Texte d'AT-3, remplacé : il ne doit plus être servi.
  tempsPasseAt3: 'Cette intervention ou l’une de ses suites a déjà une facture : la facture au temps passé est unique. Un brouillon s’émet d’abord ; pour refaire une facture émise, adressez-vous à l’administration, qui l’annule par son avoir total ou la corrige par des avoirs partiels.',
  envoiAvoirAt3: 'L’envoi d’un avoir est réservé à l’administration.',
};
// Les sept autres types de compte (cadrage v2, § 1, N5).
const AUTRES_TYPES = [
  ['CT', 'CONDUCTEUR_TRAVAUX'], ['RESP', 'RESPONSABLE'], ['TECH', 'TECHNICIEN'], ['COM', 'COMMERCIAL'],
  ['DC', 'DIRECTEUR_COMMERCIAL'], ['AC', 'ASSISTANTE_COMMERCIALE'], ['CPT', 'COMPTABLE'],
];

// --- Calcul exact, hors de l'application (témoins des montants) ---
// Décimal en unités entières (centimes, millièmes) ; arrondi au centime, moitié vers le haut ; TVA d'une base à un taux ; TTC
// d'une ligne. Les lectures écartées : arrondi au pair, troncature, TVA de l'avoir seul, avoirs précédents d'un seul auteur.
const exact = {
  unites: (valeur, decimales) => {
    const [entier, fraction = ''] = String(valeur).split('.');
    return BigInt(entier) * 10n ** BigInt(decimales) + BigInt((fraction + '0'.repeat(decimales)).slice(0, decimales) || '0');
  },
  // Ligne HT en centimes : millièmes × centimes, puis moitié vers le haut.
  ligneHt: (quantite, prix) => (exact.unites(quantite, 3) * exact.unites(prix, 2) + 500n) / 1000n,
  ligneHtAuPair: (quantite, prix) => {
    const produit = exact.unites(quantite, 3) * exact.unites(prix, 2);
    const quotient = produit / 1000n; const reste = produit % 1000n;
    return reste > 500n || (reste === 500n && quotient % 2n === 1n) ? quotient + 1n : quotient;
  },
  ligneHtTronquee: (quantite, prix) => (exact.unites(quantite, 3) * exact.unites(prix, 2)) / 1000n,
  tva: (baseCentimes, taux) => (baseCentimes * exact.unites(taux, 3) + 50000n) / 100000n,
  ttcLigne: (htCentimes, taux) => (htCentimes * (100000n + exact.unites(taux, 3)) + 50000n) / 100000n,
  euros: (centimes) => Number(centimes) / 100,
};

// --- Jeu de montants ---
const ligne = (designation, quantite, prixUnitaireHt, tauxTva, nature = 'PRESTATION') => ({ designation: `TEST AT-4 ${designation}`, nature, quantite, prixUnitaireHt, tauxTva });
// Facture F, créée et émise par elle, à trois lignes et deux taux :
//  - 2,5 × 40,21 = 100,525, arrondi à 100,53 (au pair ou tronqué : 100,52) ; TTC de ligne 120,636, arrondi à 120,64 ;
//  - 1,5 × 66,67 = 100,005, arrondi à 100,01 (au pair ou tronqué : 100,00), article à 5,5 % ; TTC de ligne 105,51055 → 105,51 ;
//  - 0,5 × 36,97 = 18,485, arrondi à 18,49 (au pair ou tronqué : 18,48) ; TTC de ligne 22,188 → 22,19.
// Ventilation : 20 % sur la base cumulée 119,02, TVA 23,804 → 23,80 (ligne par ligne : 20,11 + 3,70 = 23,81) ; 5,5 % sur 100,01,
// TVA 5,50055 → 5,50. Totaux : HT 219,03, TVA 29,30, TTC 248,33.
const LIGNES_F = [ligne('pose de la centrale', 2.5, 40.21, 20), ligne('fourniture des détecteurs', 1.5, 66.67, 5.5, 'ARTICLE'), ligne('mise en service', 0.5, 36.97, 20)];
const F = { totaux: [219.03, 29.3, 248.33], lignes: [[100.53, 120.64], [100.01, 105.51], [18.49, 22.19]], ventilation: [[5.5, 100.01, 5.5, 105.51], [20, 119.02, 23.8, 142.82]] };
// Écritures de F à l'émission (tri par clé) : 411 débit du TTC ; 706 crédit des prestations (100,53 + 18,49) ; 707 crédit des
// articles ; TVA par taux. L'avoir total les inverse (lecture écartée : recopiées sans inversion).
const ECRITURES_F = [['CLIENT', '411000', 248.33, 0], ['TVA:20', '445710', 0, 23.8], ['TVA:5.5', '445711', 0, 5.5], ['VENTE_ARTICLE', '707000', 0, 100.01], ['VENTE_PRESTATION', '706000', 0, 119.02]];
// Avoirs partiels sur F, chacun à deux taux (une prestation à 20 %, un article à 5,5 %), lignes à moitié de centime :
//  - A1, par l'administration : 0,5 × 24,01 = 12,005 → 12,01 ; 0,5 × 40,01 = 20,005 → 20,01. TVA 20 % de 12,01 : 2,402 → 2,40 ;
//    5,5 % de 20,01 : 1,10055 → 1,10. HT 32,02, TVA 3,50, TTC 35,52 ;
//  - A2, par elle, après A1 : 0,5 × 24,13 = 12,065 → 12,07 (au pair 12,06) ; 0,5 × 40,17 = 20,085 → 20,09 (au pair 20,08).
//    TVA différentielle : 20 %, TVA de 24,08 (4,816 → 4,82) moins celle de 12,01 (2,40) = 2,42 ; 5,5 %, TVA de 40,10 (2,2055 →
//    2,21) moins celle de 20,01 (1,10) = 1,11. HT 32,16, TVA 3,53, TTC 35,69. Lectures écartées : TVA de l'avoir seul, ou sans
//    l'avoir de l'administration (A1) : 2,41 + 1,10 = 3,51, TTC 35,67 ;
//  - A3, par l'administration, après le sien : 0,5 × 24,25 = 12,125 → 12,13 ; 0,5 × 40,57 = 20,285 → 20,29. TVA différentielle :
//    20 %, TVA de 36,21 (7,242 → 7,24) moins 4,82 = 2,42 ; 5,5 %, TVA de 60,39 (3,32145 → 3,32) moins 2,21 = 1,11. HT 32,42,
//    TVA 3,53, TTC 35,95. Lectures écartées : sans l'avoir de l'assistante (A2), 20 % : 4,83 − 2,40 = 2,43 et 5,5 % : 2,22 − 1,10
//    = 1,12, TVA 3,55, TTC 35,97 ; avoir seul : 2,43 + 1,12 = 3,55.
const A1 = { lignes: [ligne('reprise de la pose (administration)', 0.5, 24.01, 20), ligne('reprise des détecteurs (administration)', 0.5, 40.01, 5.5, 'ARTICLE')],
  totaux: [32.02, 3.5, 35.52], lignesAttendues: [[12.01, 14.41], [20.01, 21.11]], ventilation: [[5.5, 20.01, 1.1, 21.11], [20, 12.01, 2.4, 14.41]] };
const A2 = { lignes: [ligne('reprise de la pose (assistante)', 0.5, 24.13, 20), ligne('reprise des détecteurs (assistante)', 0.5, 40.17, 5.5, 'ARTICLE')],
  totaux: [32.16, 3.53, 35.69], lignesAttendues: [[12.07, 14.48], [20.09, 21.19]], ventilation: [[5.5, 20.09, 1.11, 21.2], [20, 12.07, 2.42, 14.49]],
  ecritures: [['CLIENT', '411000', 0, 35.69], ['TVA:20', '445710', 2.42, 0], ['TVA:5.5', '445711', 1.11, 0], ['VENTE_ARTICLE', '707000', 20.09, 0], ['VENTE_PRESTATION', '706000', 12.07, 0]] };
const A3 = { lignes: [ligne('reprise de la pose (administration, après l’assistante)', 0.5, 24.25, 20), ligne('reprise des détecteurs (administration, après l’assistante)', 0.5, 40.57, 5.5, 'ARTICLE')],
  totaux: [32.42, 3.53, 35.95], lignesAttendues: [[12.13, 14.56], [20.29, 21.41]], ventilation: [[5.5, 20.29, 1.11, 21.4], [20, 12.13, 2.42, 14.55]] };
// Plafonds cumulés entre auteurs, sur F après A1, A2 et A3 (crédité à 5,5 % : 60,39 HT ; à 20 % : 36,21 HT ; en tout 96,60 HT,
// 10,56 de TVA, 107,16 TTC) :
//  - P1, par elle : 1 × 39,63 à 5,5 % ; total HT 136,23 ≤ 219,03, TVA 12,74 ≤ 29,30, TTC 148,97 ≤ 248,33, mais 60,39 + 39,63 =
//    100,02 > 100,01 à 5,5 % : 409, plafond du taux. Lecture écartée : seuls ses avoirs comptés (20,09 + 39,63 = 59,72), admis ;
//  - A4, par elle : 1 × 39,62 à 5,5 %, le reste exact (100,01) : admis, le plafond est atteint et non dépassé (lecture écartée :
//    une comparaison stricte, qui refuserait). TVA de 100,01 (5,50) moins 3,32 = 2,18 ; TTC 41,80 ;
//  - P3, par elle : 1 × 82,82 à 20 % ; total HT 96,60 + 39,62 + 82,82 = 219,04 > 219,03 : 409, plafond total (lu avant celui
//    du taux). Lecture écartée : seuls ses avoirs comptés (32,16 + 39,62 + 82,82 = 154,60), admis ;
//  - A5, par elle : 1 × 82,81 à 20 %, le reste exact : TVA de 119,02 (23,80) moins 7,24 = 16,56 ; TTC 99,37. F est alors créditée
//    en entier (248,33) : reste dû 0,00 et statut « réglée », avec l'entrée REGLEMENT à son nom (lot « Statut d'une facture
//    couverte par des avoirs », qui remplace la règle du 17-10-2026 ; lecture écartée, l'ancienne règle : « émise »).
const P1 = [ligne('dépassement du plafond à 5,5 %', 1, 39.63, 5.5, 'ARTICLE')];
const A4 = { lignes: [ligne('solde à 5,5 %', 1, 39.62, 5.5, 'ARTICLE')], totaux: [39.62, 2.18, 41.8], ventilation: [[5.5, 39.62, 2.18, 41.8]] };
const P3 = [ligne('dépassement du total', 1, 82.82, 20)];
const A5 = { lignes: [ligne('solde à 20 %', 1, 82.81, 20)], totaux: [82.81, 16.56, 99.37], ventilation: [[20, 82.81, 16.56, 99.37]] };
// Reste dû et statut (critère 1) : facture 1 × 123,45 à 20 %, TVA 24,69, TTC 148,14 ; son avoir 1 × 40,12 à 20 %, TVA 8,024 →
// 8,02, TTC 48,14.
//  (a) sans règlement : reste dû 148,14 − 48,14 = 100,00, « émise » (lectures écartées : avoir non déduit, 148,14 ; avoir déduit
//      hors taxes, 108,02) ;
//  (b) réglée de 100,00 par l'administration : son avoir la solde, reste dû 0,00, « émise » → « réglée », entrée REGLEMENT à son
//      nom (lecture écartée : avoir déduit hors taxes, reste 8,02, qui la laisserait « émise ») ;
//  (c) réglée de 148,14 : son avoir 1 × 10,00 à 20 % (TTC 12,00) donne un trop-perçu, reste dû −12,00, statut « réglée »
//      inchangé, sans entrée (lectures écartées : reste ramené à 0,00 ; retour à « émise »).
const LIGNES_SOLDE = [ligne('maintenance curative', 1, 123.45, 20)];
const AVOIR_SOLDE = [ligne('geste commercial', 1, 40.12, 20)];
const AVOIR_TROP_PERCU = [ligne('remise après règlement', 1, 10, 20)];

// --- Microsoft Graph simulé (comme envoi-microsoft-365.test.mjs, réduit à /me et sendMail) ---
function creerGraph() {
  const requetes = [];
  const boites = new Map();
  const serveur = http.createServer((req, res) => {
    const morceaux = [];
    req.on('data', (morceau) => morceaux.push(morceau));
    req.on('end', () => {
      const url = new URL(req.url, 'http://simulateur.invalid');
      const jeton = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      const texte = Buffer.concat(morceaux).toString('utf8');
      if (req.method === 'GET' && url.pathname === '/v1.0/me') {
        requetes.push({ nature: 'me', jeton });
        const boite = boites.get(jeton);
        if (!boite) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'InvalidAuthenticationToken', message: 'TEST jeton inconnu' } })); return; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ mail: boite, userPrincipalName: boite }));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/v1.0/me/sendMail') {
        let json = null;
        try { json = JSON.parse(texte); } catch { json = null; }
        requetes.push({ nature: 'envoi', jeton, json });
        res.writeHead(202);
        res.end();
        return;
      }
      requetes.push({ nature: 'autre', chemin: url.pathname });
      res.writeHead(404);
      res.end();
    });
  });
  return {
    boites,
    requetes: (nature) => requetes.filter((r) => r.nature === nature),
    vider: () => { requetes.length = 0; },
    demarrer: () => new Promise((fin) => serveur.listen(0, '127.0.0.1', () => fin(serveur.address().port))),
    arreter: () => new Promise((fin) => { serveur.closeAllConnections(); serveur.close(() => fin()); }),
  };
}

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_at4_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;
    const graph = creerGraph();
    const environnementAvant = {};
    const NOMS_ENVIRONNEMENT = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'MICROSOFT_GRAPH_URL'];

    let request; let app; let prisma; let appPrisma; let jwt;
    let session = '';
    let secours = { id: '', name: '' };
    const comptes = {};
    let rang = 0;
    const suffixe = () => `${Date.now()}${(rang += 1)}`;
    let clientPrincipal = null;

    // --- Appels ---
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const sa = () => entete(session);
    const par = (cle) => entete(jwt.sign({ id: comptes[cle].id }, process.env.JWT_SECRET));
    const appeler = (methode, chemin, corps, auth = sa()) => {
      const requete = request(app)[methode](`/api${chemin}`);
      const avecAuth = auth ? requete.set(auth) : requete;
      return methode === 'get' ? avecAuth : avecAuth.send(corps ?? {});
    };
    const ok = async (reponse, statut = 200) => {
      const res = await reponse;
      assert.equal(res.status, statut, `${res.req?.method} ${res.req?.path} : ${res.status} ${JSON.stringify(res.body)}`);
      return res.body;
    };
    const texteDuPdf = async (reponse) => { const lecteur = new PDFParse({ data: reponse.body }); const contenu = await lecteur.getText(); await lecteur.destroy(); return contenu.text; };
    const nombres = (liste) => liste.map((valeur) => (valeur === null || valeur === undefined ? valeur : Number(valeur)));

    // --- Jour de la société (Europe/Paris, posé dans l'identité) ---
    const jour = () => {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date());
      const v = (type) => parts.find((p) => p.type === type).value;
      return { fr: `${v('day')}-${v('month')}-${v('year')}`, compact: `${v('year')}${v('month')}${v('day')}`, annee: Number(v('year')) };
    };

    // --- État de la base ---
    // Empreinte de toute la base : chaque table du schéma public (hors historique des migrations), nombre de lignes et
    // empreinte de leur contenu (modèle : chantier-annule-termine.test.mjs). Un refus ne doit rien y changer, pas même un
    // `updatedAt`, une entrée de journal ou la séquence des avoirs.
    const sqlEmpreinte = (table) => `SELECT '${table}' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${table}" x`;
    let requeteEmpreinte = null;
    const empreinte = async () => {
      if (!requeteEmpreinte) {
        const tables = (await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`).map((t) => t.tablename);
        assert.ok(tables.includes('Facture') && tables.includes('SequenceAvoir') && tables.includes('JournalFacture') && tables.includes('EnvoiDocument'), `tables relevées : ${tables.join(', ')}`);
        assert.ok(tables.every((table) => /^[A-Za-z_]+$/.test(table)), 'noms de tables sans guillemet');
        requeteEmpreinte = tables.map(sqlEmpreinte).join(' UNION ALL ');
      }
      return Object.fromEntries((await prisma.$queryRawUnsafe(requeteEmpreinte)).map(({ t, n, h }) => [t, `${n}:${h}`]));
    };
    const tablesChangees = (avant, apres) => Object.keys({ ...avant, ...apres }).filter((t) => avant[t] !== apres[t]);
    const sequenceAvoirs = async () => (await prisma.sequenceAvoir.findUnique({ where: { annee: jour().annee } }))?.dernierNumero ?? 0;
    // Un refus : statut et message attendus, empreinte de toute la base inchangée (aucune pièce, aucune entrée, aucun numéro).
    const refuse = async (appel, statut, message, quoi) => {
      const avant = await empreinte();
      const res = await appel();
      assert.deepEqual([res.status, res.body?.error], [statut, message], `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      return res;
    };
    const enBase = (id) => prisma.facture.findUniqueOrThrow({ where: { id }, include: {
      lignes: { orderBy: { ordre: 'asc' } }, ventilationTva: { orderBy: { tauxTva: 'asc' } }, ecrituresComptables: { orderBy: { ordre: 'asc' } }, journal: { orderBy: { createdAt: 'asc' } },
    } });
    // Montants d'une pièce relue en base, sans identifiant : lignes (désignation comprise), ventilation, écritures.
    const montantsDe = (piece) => ({
      totaux: nombres([piece.totalHt, piece.totalTva, piece.totalTtc]),
      lignes: piece.lignes.map((l) => [l.ordre, l.designation, l.nature, ...nombres([l.quantite, l.prixUnitaireHt, l.tauxTva, l.totalHt, l.totalTtc])]),
      ventilation: piece.ventilationTva.map((v) => nombres([v.tauxTva, v.totalHt, v.totalTva, v.totalTtc])),
      ecritures: piece.ecrituresComptables.map((e) => [e.ordre, e.cle, e.journalCode, e.compteNum, e.compteLib, ...nombres([e.debit, e.credit])]),
    });
    const ecrituresTriees = (piece) => piece.ecrituresComptables.map((e) => [e.cle, e.compteNum, ...nombres([e.debit, e.credit])]).sort((a, b) => a[0].localeCompare(b[0]));
    const rangDe = (numero) => Number(numero.slice(numero.lastIndexOf('-') + 1));
    const prefixeDe = (numero) => numero.slice(0, numero.lastIndexOf('-'));

    // --- Données ---
    const creerCompte = async (cle, role) => {
      const s = suffixe();
      comptes[cle] = await prisma.user.create({ data: { email: `at4.${cle.toLowerCase()}.${s}@iris.test`, name: `TEST AT-4 ${cle} ${s}`, role } });
      return comptes[cle];
    };
    const creerClient = async (libelle) => {
      let client;
      for (let essai = 1; ; essai += 1) {
        const res = await appeler('post', '/clients', { raisonSociale: `TEST Client AT-4 ${libelle} ${suffixe()}`, siren: String(randomInt(100_000_000, 1_000_000_000)) });
        if (res.status === 409 && essai < 5) continue;
        assert.equal(res.status, 201, JSON.stringify(res.body));
        client = res.body;
        break;
      }
      await ok(appeler('post', `/clients/${client.id}/sites`, { nom: 'TEST Facturation AT-4', adresse: '4 rue des Avoirs', codePostal: '14000', ville: 'Caen', estSiteFacturation: true }), 201);
      return client;
    };
    // Brouillon d'un compte : hors affaire par défaut, ou de l'origine donnée.
    const brouillon = (auth, motif, lignes, { clientId = clientPrincipal.id, origine = null } = {}) => ok(appeler('post', '/factures', {
      clientId, dateEmission: jour().fr, dateEcheance: jour().fr, lignes,
      ...(origine ?? { origine: 'HORS_AFFAIRE', motifHorsAffaire: `TEST AT-4 ${motif} ${suffixe()}` }),
    }, auth), 201);
    const emettre = (id, auth) => ok(appeler('post', `/factures/${id}/emettre`, {}, auth));
    const factureEmise = async (authCreation, motif, lignes, { authEmission = authCreation, ...options } = {}) => emettre((await brouillon(authCreation, motif, lignes, options)).id, authEmission);
    const avoir = (id, lignes, auth) => appeler('post', `/factures/${id}/avoirs`, { lignes }, auth);
    const avoirCree = (id, lignes, auth) => ok(avoir(id, lignes, auth), 201);
    const annuler = (id, auth) => appeler('post', `/factures/${id}/annuler`, {}, auth);
    const regler = (factureId, montant, clientId = clientPrincipal.id) => ok(appeler('post', '/reglements', { clientId, dateReglement: jour().fr, montant, moyen: 'VIREMENT', reference: `TEST-AT4-${suffixe()}`, affectations: [{ factureId, montant }] }), 201);
    // Soldes d'une pièce dans la liste non paginée d'un lecteur.
    const soldes = async (id, auth) => {
      const f = (await ok(appeler('get', '/factures', null, auth))).find((x) => x.id === id);
      return f ? [f.statut, f.montantAvoirs, f.montantRegle, f.resteDu] : null;
    };
    const chantier = (nom, extra = {}) => prisma.chantier.create({ data: {
      nom: `TEST AT-4 ${nom} ${suffixe()}`, client: clientPrincipal.raisonSociale, clientId: clientPrincipal.id, dateDebut: new Date('2026-10-01T00:00:00Z'), budgetGlobalVendu: 1000, ...extra,
    } });
    const intervention = async (titre, extra = {}) => ok(appeler('post', '/interventions', { clientId: clientPrincipal.id, titre: `TEST AT-4 ${titre} ${suffixe()}`, ...extra }), 201);
    const contrat = async (titre) => ok(appeler('post', '/contrats-maintenance', { clientId: clientPrincipal.id, titre: `TEST AT-4 ${titre} ${suffixe()}`, periodiciteMois: 12, dureePrevisionnelleMinutes: 60, dateDebut: '01-09-2026' }), 201);
    const repere = (origine, id, auth) => appeler('get', `/factures/deja-facturee?origine=${origine}&id=${id}`, null, auth);

    // Scénario des avoirs entre auteurs (montants ci-dessus) : F créée et émise par `auteurF`, A1 par l'administration, A2 par
    // `auteurA2`, A3 par l'administration.
    const scenarioEntreAuteurs = async (auteurF, auteurA2, motif) => {
      const facture = await factureEmise(auteurF, motif, LIGNES_F);
      const a1 = await avoirCree(facture.id, A1.lignes, par('AD'));
      const a2 = await avoirCree(facture.id, A2.lignes, auteurA2);
      const a3 = await avoirCree(facture.id, A3.lignes, par('AD'));
      return { facture, a1, a2, a3 };
    };

    before(async () => {
      assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname), 'seul un PostgreSQL local est autorisé');
      assert.notEqual(source.pathname.slice(1), nomBase);
      const port = await graph.demarrer();
      await administrationPg.connect();
      await administrationPg.query(`CREATE DATABASE "${nomBase}"`);
      baseCreee = true;
      execFileSync(resolve(dossierServeur, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', resolve(dossierServeur, 'prisma/schema.prisma')], {
        env: { ...process.env, DATABASE_URL: cible.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
      });
      for (const nom of NOMS_ENVIRONNEMENT) environnementAvant[nom] = process.env[nom];
      // Connexion Microsoft absente à l'import (la connexion de secours reste la seule ouverte), posée ensuite : l'envoi la lit
      // à chaque appel (N5 du lot 6b-1b).
      delete process.env.AZURE_TENANT_ID;
      delete process.env.AZURE_CLIENT_ID;
      process.env.MICROSOFT_GRAPH_URL = `http://127.0.0.1:${port}/v1.0`;
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
      process.env.AZURE_TENANT_ID = '00000000-0000-4000-8000-0000000000a4';
      process.env.AZURE_CLIENT_ID = '00000000-0000-4000-8000-0000000000a5';
      const { PrismaClient } = await import('@prisma/client');
      prisma = new PrismaClient({ datasources: { db: { url: cible.toString() } } });
      jwt = (await import('jsonwebtoken')).default;
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      session = connexion.body.token;
      secours = await prisma.user.findUniqueOrThrow({ where: { email: 'secours@iris.test' }, select: { id: true, name: true, role: true } });
      assert.equal(secours.role, 'SUPERADMIN');
      // Identité de la société (émission, signature d'un devis), plan comptable à deux taux, mentions légales publiées.
      await ok(appeler('put', '/company', { raisonSociale: 'TEST Émetteur AT-4', siret: '44444444400044', adresse: '4 rue de l’Émetteur', codePostal: '14000', ville: 'Caen', fuseauHoraire: 'Europe/Paris' }));
      const compte = (code, libelle, nature) => ok(appeler('post', '/comptabilite/comptes', { code, libelle, nature }), 201);
      const clients = await compte('411000', 'TEST Clients AT-4', 'ACTIF');
      const prestations = await compte('706000', 'TEST Prestations AT-4', 'PRODUIT');
      const articles = await compte('707000', 'TEST Articles AT-4', 'PRODUIT');
      const tva20 = await compte('445710', 'TEST TVA 20 AT-4', 'TVA');
      const tva55 = await compte('445711', 'TEST TVA 5,5 AT-4', 'TVA');
      const motif = 'TEST paramétrage comptable AT-4';
      for (const [cle, donnees] of [['CLIENT', { compteId: clients.id }], ['VENTE_PRESTATION', { compteId: prestations.id }], ['VENTE_ARTICLE', { compteId: articles.id }], ['JOURNAL_VENTES', { journal: 'VE' }]]) {
        await ok(appeler('put', `/comptabilite/regles/${cle}`, { ...donnees, motif }));
      }
      await ok(appeler('put', '/comptabilite/tva/20', { compteId: tva20.id, motif }));
      await ok(appeler('put', '/comptabilite/tva/5.5', { compteId: tva55.id, motif }));
      const version = await ok(appeler('post', '/mentions-legales', { mentions: 'TEST mentions AT-4', cgv: 'TEST CGV AT-4', penalites: 'TEST pénalités AT-4' }), 201);
      await ok(appeler('post', `/mentions-legales/${version.version}/publier`));
      for (const [cle, role] of [['AT', ROLE_AT], ['AT2', ROLE_AT], ['AD', 'ADMIN'], ['DIR', 'DIRECTEUR'], ...AUTRES_TYPES]) await creerCompte(cle, role);
      clientPrincipal = await creerClient('principal');
    });

    after(async () => {
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      await graph.arreter().catch(() => {});
      for (const nom of NOMS_ENVIRONNEMENT) { if (environnementAvant[nom] === undefined) delete process.env[nom]; else process.env[nom] = environnementAvant[nom]; }
      if (baseCreee) await administrationPg.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`).catch(() => {});
      await administrationPg.end().catch(() => {});
    });

    // Cadrage v2, « Montants (classés C) » ; règle des montants du rédacteur des tests : chaque attendu recalculé en décimal
    // exact, hors de l'application, et chaque lecture écartée calculée et distincte de l'attendu.
    test('témoin des montants : attendus recalculés en décimal exact (lignes, ventilation, TVA différentielle entre auteurs, plafonds, reste dû), chaque lecture écartée distincte', () => {
      const euros = exact.euros;
      const ht = (l) => exact.ligneHt(l.quantite, l.prixUnitaireHt);
      const parTaux = (lignes) => { const m = new Map(); for (const l of lignes) m.set(l.tauxTva, (m.get(l.tauxTva) ?? 0n) + ht(l)); return m; };
      // F : lignes, ventilation sur la base cumulée, totaux.
      const htF = LIGNES_F.map(ht);
      assert.deepEqual(F.lignes, LIGNES_F.map((l, i) => [euros(htF[i]), euros(exact.ttcLigne(htF[i], l.tauxTva))]), 'F : lignes');
      const baseF = parTaux(LIGNES_F);
      const tvaF = new Map([...baseF].map(([taux, base]) => [taux, exact.tva(base, taux)]));
      assert.deepEqual(F.ventilation, [5.5, 20].map((taux) => [taux, euros(baseF.get(taux)), euros(tvaF.get(taux)), euros(baseF.get(taux) + tvaF.get(taux))]), 'F : ventilation');
      const htTotalF = htF.reduce((s, v) => s + v, 0n); const tvaTotaleF = tvaF.get(5.5) + tvaF.get(20);
      assert.deepEqual(F.totaux, [euros(htTotalF), euros(tvaTotaleF), euros(htTotalF + tvaTotaleF)], 'F : totaux');
      for (const [i, l] of LIGNES_F.entries()) {
        assert.notEqual(euros(exact.ligneHtAuPair(l.quantite, l.prixUnitaireHt)), F.lignes[i][0], `F ligne ${i + 1} : arrondi au pair écarté`);
        assert.notEqual(euros(exact.ligneHtTronquee(l.quantite, l.prixUnitaireHt)), F.lignes[i][0], `F ligne ${i + 1} : troncature écartée`);
      }
      assert.notEqual(euros(exact.tva(htF[0], 20) + exact.tva(htF[2], 20)), F.ventilation[1][2], 'F : TVA ligne par ligne écartée');
      assert.deepEqual(ECRITURES_F, [['CLIENT', '411000', F.totaux[2], 0], ['TVA:20', '445710', 0, F.ventilation[1][2]], ['TVA:5.5', '445711', 0, F.ventilation[0][2]], ['VENTE_ARTICLE', '707000', 0, euros(htF[1])], ['VENTE_PRESTATION', '706000', 0, euros(htF[0] + htF[2])]], 'F : écritures');
      // Avoirs successifs : TVA différentielle par taux, sur les avoirs précédents de tout auteur.
      const cumul = new Map([[5.5, 0n], [20, 0n]]);
      const avoirAttendu = (lignes) => {
        const base = parTaux(lignes);
        const ventilation = [...base.keys()].sort((a, b) => a - b).map((taux) => {
          const avant = cumul.get(taux); const tva = exact.tva(avant + base.get(taux), taux) - exact.tva(avant, taux);
          return [taux, base.get(taux), tva];
        });
        for (const [taux, b] of base) cumul.set(taux, cumul.get(taux) + b);
        const totalHt = ventilation.reduce((s, v) => s + v[1], 0n); const totalTva = ventilation.reduce((s, v) => s + v[2], 0n);
        return { totaux: [euros(totalHt), euros(totalTva), euros(totalHt + totalTva)], ventilation: ventilation.map(([t, b, v]) => [t, euros(b), euros(v), euros(b + v)]), lignes: lignes.map((l) => [euros(ht(l)), euros(exact.ttcLigne(ht(l), l.tauxTva))]) };
      };
      for (const [nom, attendu] of [['A1', A1], ['A2', A2], ['A3', A3]]) {
        const calcule = avoirAttendu(attendu.lignes);
        assert.deepEqual([calcule.totaux, calcule.ventilation, calcule.lignes], [attendu.totaux, attendu.ventilation, attendu.lignesAttendues], nom);
        for (const [i, l] of attendu.lignes.entries()) assert.notEqual(euros(exact.ligneHtAuPair(l.quantite, l.prixUnitaireHt)), attendu.lignesAttendues[i][0], `${nom} ligne ${i + 1} : arrondi au pair écarté`);
      }
      // Lectures écartées de la TVA de A2 (avoir seul ; avoirs précédents de l'assistante seule, aucun) et de A3 (sans A2 ; seul).
      const tvaSeule = (lignes) => [...parTaux(lignes)].reduce((s, [taux, b]) => s + exact.tva(b, taux), 0n);
      assert.notEqual(euros(tvaSeule(A2.lignes)), A2.totaux[1], 'A2 : TVA de l’avoir seul (ou sans l’avoir de l’administration) écartée');
      assert.equal(euros(tvaSeule(A2.lignes)), 3.51);
      const sansA2 = [5.5, 20].reduce((s, taux) => {
        const a1 = parTaux(A1.lignes).get(taux); const a3 = parTaux(A3.lignes).get(taux);
        return s + exact.tva(a1 + a3, taux) - exact.tva(a1, taux);
      }, 0n);
      assert.equal(euros(sansA2), 3.55, 'A3 sans l’avoir de l’assistante');
      assert.notEqual(euros(sansA2), A3.totaux[1], 'A3 : avoirs précédents de l’administration seule écartés');
      assert.notEqual(euros(tvaSeule(A3.lignes)), A3.totaux[1], 'A3 : TVA de l’avoir seul écartée');
      assert.deepEqual(A2.ecritures, [['CLIENT', '411000', 0, A2.totaux[2]], ['TVA:20', '445710', A2.ventilation[1][2], 0], ['TVA:5.5', '445711', A2.ventilation[0][2], 0], ['VENTE_ARTICLE', '707000', A2.lignesAttendues[1][0], 0], ['VENTE_PRESTATION', '706000', A2.lignesAttendues[0][0], 0]], 'A2 : écritures inversées');
      // Plafonds : P1 et P3 dépassent d'un centime le reste à créditer de tous les auteurs, et non celui de l'assistante seule.
      const credite = (taux) => cumul.get(taux);
      assert.equal(credite(5.5) + ht(P1[0]), baseF.get(5.5) + 1n, 'P1 : un centime au-delà du plafond à 5,5 %');
      assert.ok(parTaux(A2.lignes).get(5.5) + ht(P1[0]) <= baseF.get(5.5), 'P1 : admis si seuls ses avoirs comptaient');
      const tvaP1 = exact.tva(credite(5.5) + ht(P1[0]), 5.5) - exact.tva(credite(5.5), 5.5);
      const creditTotal = (a) => [A1, A2, A3].reduce((s, x) => s + exact.unites(x.totaux[a], 2), 0n);
      assert.ok(creditTotal(0) + ht(P1[0]) <= htTotalF && creditTotal(1) + tvaP1 <= tvaTotaleF && creditTotal(2) + ht(P1[0]) + tvaP1 <= htTotalF + tvaTotaleF, 'P1 : sous le plafond total (refus du taux, et non du total)');
      const a4 = avoirAttendu(A4.lignes);
      assert.deepEqual([a4.totaux, a4.ventilation], [A4.totaux, A4.ventilation], 'A4 : le reste exact à 5,5 %');
      assert.equal(credite(5.5), baseF.get(5.5), 'A4 : plafond à 5,5 % atteint, non dépassé');
      const totalCredite = creditTotal(0) + exact.unites(A4.totaux[0], 2);
      assert.equal(totalCredite + ht(P3[0]), htTotalF + 1n, 'P3 : un centime au-delà du total HT');
      assert.ok(exact.unites(A2.totaux[0], 2) + exact.unites(A4.totaux[0], 2) + ht(P3[0]) <= htTotalF, 'P3 : admis si seuls ses avoirs comptaient');
      const a5 = avoirAttendu(A5.lignes);
      assert.deepEqual([a5.totaux, a5.ventilation], [A5.totaux, A5.ventilation], 'A5 : le reste exact à 20 %');
      const ttcCredite = [A1, A2, A3, A4, A5].reduce((s, x) => s + exact.unites(x.totaux[2], 2), 0n);
      assert.equal(euros(ttcCredite), F.totaux[2], 'F créditée en entier');
      // Reste dû et statut.
      const htSolde = ht(LIGNES_SOLDE[0]); const ttcSolde = htSolde + exact.tva(htSolde, 20);
      const htAvoir = ht(AVOIR_SOLDE[0]); const ttcAvoir = htAvoir + exact.tva(htAvoir, 20);
      assert.deepEqual([euros(ttcSolde), euros(ttcAvoir), euros(ttcSolde - ttcAvoir)], [148.14, 48.14, 100]);
      assert.notEqual(euros(ttcSolde - htAvoir), 100, '(a) avoir déduit hors taxes écarté');
      assert.equal(euros(ttcSolde - 10000n - ttcAvoir), 0, '(b) solde exact après un règlement de 100,00');
      assert.ok(ttcSolde - 10000n - htAvoir > 0n, '(b) avoir déduit hors taxes : la facture resterait émise');
      const htTrop = ht(AVOIR_TROP_PERCU[0]);
      assert.equal(euros(htTrop + exact.tva(htTrop, 20)), 12, '(c) avoir de 12,00 TTC après un règlement de 148,14');
    });

    // Cadrage v2, « Montants », première puce (C4) ; critère 1 ; réponse 1 du 09-11-2026. Montants : voir A1, A2 et A3 plus haut.
    // L'avoir qu'elle crée est relu en base (totaux, lignes, ventilation, écritures), au PDF (lu par elle et par l'administration)
    // et au journal ; il est égal, centime pour centime, à celui que crée l'administration dans la même suite d'avoirs (F',
    // jumelle de F, tous ses avoirs par l'administration).
    test('montants : avoir partiel créé par elle à deux taux après celui de l’administration (TVA différentielle 3,53 € et non 3,51 €), puis avoir de l’administration après le sien (3,53 € et non 3,55 €) : totaux, lignes, ventilation et écritures relus en base, PDF, journal à son nom, type figé ; identiques, centime pour centime, à ceux d’une suite d’avoirs toute de l’administration', async () => {
      const { facture, a1, a2, a3 } = await scenarioEntreAuteurs(par('AT'), par('AT'), 'avoirs entre auteurs');
      assert.deepEqual(nombres([facture.totalHt, facture.totalTva, facture.totalTtc]), F.totaux);
      assert.equal(facture.creeParType, ROLE_AT);
      // Réponses de création : type, auteur, montants.
      for (const [piece, attendu, type, auteur] of [[a1, A1, 'ADMIN', comptes.AD.id], [a2, A2, ROLE_AT, comptes.AT.id], [a3, A3, 'ADMIN', comptes.AD.id]]) {
        assert.deepEqual([piece.type, piece.statut, piece.estAvoirAnnulation, piece.factureOrigineId, piece.creeParType, piece.createdById], ['AVOIR', 'EMISE', false, facture.id, type, auteur]);
        assert.deepEqual(nombres([piece.totalHt, piece.totalTva, piece.totalTtc]), attendu.totaux, `${type} : totaux de la réponse`);
      }
      // A2 relu en base.
      const relu = await enBase(a2.id);
      assert.deepEqual(nombres([relu.totalHt, relu.totalTva, relu.totalTtc]), A2.totaux);
      assert.deepEqual(relu.lignes.map((l) => [l.designation, l.nature, ...nombres([l.quantite, l.prixUnitaireHt, l.tauxTva, l.totalHt, l.totalTtc])]),
        A2.lignes.map((l, i) => [l.designation, l.nature, l.quantite, l.prixUnitaireHt, l.tauxTva, ...A2.lignesAttendues[i]]));
      assert.deepEqual(relu.ventilationTva.map((v) => nombres([v.tauxTva, v.totalHt, v.totalTva, v.totalTtc])), A2.ventilation);
      assert.deepEqual(ecrituresTriees(relu), A2.ecritures, 'écritures de l’avoir : inversées, aux comptes de la facture');
      assert.deepEqual([relu.ecrituresScellees, relu.creeParType, relu.createdById, relu.numero.startsWith('A'), relu.clientRaisonSociale, relu.clientAdresse !== null], [true, ROLE_AT, comptes.AT.id, true, facture.clientRaisonSociale, true]);
      assert.deepEqual(relu.journal.map((j) => [j.action, j.acteurId, j.detail]), [['CREATION_AVOIR_PARTIEL', comptes.AT.id, `Avoir partiel de la facture ${facture.numero}`]]);
      for (const [piece, attendu] of [[a1, A1], [a3, A3]]) {
        const p = await enBase(piece.id);
        assert.deepEqual([nombres([p.totalHt, p.totalTva, p.totalTtc]), p.ventilationTva.map((v) => nombres([v.tauxTva, v.totalHt, v.totalTva, v.totalTtc])), p.lignes.map((l) => nombres([l.totalHt, l.totalTtc]))], [attendu.totaux, attendu.ventilation, attendu.lignesAttendues]);
      }
      // La facture d'origine : montants figés, reste dû 248,33 − (35,52 + 35,69 + 35,95) = 141,17, statut émise, journal sans
      // entrée de règlement ; lus de même par elle et par l'administration.
      const f = await enBase(facture.id);
      assert.deepEqual([...nombres([f.totalHt, f.totalTva, f.totalTtc]), f.statut], [...F.totaux, 'EMISE']);
      assert.deepEqual(f.journal.map((j) => [j.action, j.acteurId]), [['CREATION_BROUILLON', comptes.AT.id], ['EMISSION', comptes.AT.id]]);
      assert.deepEqual(await soldes(facture.id, par('AT')), ['EMISE', 107.16, 0, 141.17]);
      assert.deepEqual(await soldes(facture.id, par('AD')), ['EMISE', 107.16, 0, 141.17]);
      // Les trois avoirs de sa facture, de tout auteur, sont dans sa liste.
      const liste = (await ok(appeler('get', '/factures', null, par('AT')))).map((x) => x.id);
      for (const id of [facture.id, a1.id, a2.id, a3.id]) assert.ok(liste.includes(id), id);

      // PDF de son avoir : lu par elle, et le même pour l'administration.
      const pdf = await appeler('get', `/factures/${a2.id}/document.pdf`, null, par('AT'));
      assert.equal(pdf.status, 200, pdf.text);
      const texte = await texteDuPdf(pdf);
      for (const attendu of [`AVOIR ${a2.numero}`, `Facture d’origine : ${facture.numero}`, 'Total HT : 32,16 €', 'TVA 5.5 % sur 20,09 € : 1,11 €', 'TVA 20 % sur 12,07 € : 2,42 €', 'TVA totale : 3,53 €', 'Total TTC : 35,69 €', '24,13 €', '40,17 €']) {
        assert.ok(texte.includes(attendu), `PDF : ${attendu}`);
      }
      for (const ecarte of ['TVA totale : 3,51 €', 'Total TTC : 35,67 €', 'TVA 20 % sur 12,07 € : 2,41 €', 'TVA 5.5 % sur 20,09 € : 1,10 €', '12,06 €', '20,08 €']) assert.ok(!texte.includes(ecarte), `PDF : lecture écartée ${ecarte}`);
      assert.equal(await texteDuPdf(await appeler('get', `/factures/${a2.id}/document.pdf`, null, par('AD'))), texte, 'le même document pour l’administration');

      // F' : la même suite d'avoirs, toute de l'administration ; A2' et A3' égaux à A2 et A3, centime pour centime (lignes,
      // ventilation, écritures, désignations comprises).
      const jumelle = await scenarioEntreAuteurs(par('AD'), par('AD'), 'avoirs de l’administration seule');
      assert.equal(jumelle.a2.creeParType, 'ADMIN');
      assert.deepEqual(montantsDe(await enBase(a2.id)), montantsDe(await enBase(jumelle.a2.id)), 'son avoir égal à celui de l’administration');
      assert.deepEqual(montantsDe(await enBase(a3.id)), montantsDe(await enBase(jumelle.a3.id)), 'l’avoir de l’administration qui suit le sien égal à celui qui suit un avoir de l’administration');
      assert.ok(!(await ok(appeler('get', '/factures', null, par('AT')))).some((x) => [jumelle.facture.id, jumelle.a2.id].includes(x.id)), 'la suite de l’administration lui reste fermée');
    });

    // Cadrage v2, « Montants », deuxième et quatrième puces (C4 : plafonds HT, TVA, TTC et par taux cumulés quel que soit
    // l'auteur ; refus 409 sans écriture ni numéro consommé ; numérotation continue). Montants : voir P1, A4, P3 et A5 plus haut.
    test('montants : plafonds cumulés entre auteurs : dépassement d’un centime à 5,5 % (409 du taux) et du total (409 du total) refusés à elle, sans écriture ni numéro ; le reste exact admis à chaque taux ; facture créditée en entier, reste dû 0,00 €, « réglée » par ses avoirs avec l’entrée du journal à son nom ; numéros consécutifs', async () => {
      const avant = await sequenceAvoirs();
      const { facture, a1, a2, a3 } = await scenarioEntreAuteurs(par('AT'), par('AT'), 'plafonds entre auteurs');
      assert.deepEqual([a1, a2, a3].map((a) => rangDe(a.numero)), [avant + 1, avant + 2, avant + 3]);
      await refuse(() => avoir(facture.id, P1, par('AT')), 409, REFUS.plafondTaux55, 'P1 : plafond à 5,5 %, avoirs de l’administration compris');
      assert.equal(await sequenceAvoirs(), avant + 3, 'P1 : aucun numéro consommé');
      const a4 = await avoirCree(facture.id, A4.lignes, par('AT'));
      assert.deepEqual([rangDe(a4.numero), ...nombres([a4.totalHt, a4.totalTva, a4.totalTtc])], [avant + 4, ...A4.totaux], 'A4 : numéro suivant, reste exact à 5,5 %');
      assert.deepEqual((await enBase(a4.id)).ventilationTva.map((v) => nombres([v.tauxTva, v.totalHt, v.totalTva, v.totalTtc])), A4.ventilation);
      await refuse(() => avoir(facture.id, P3, par('AT')), 409, REFUS.plafondTotal, 'P3 : plafond total, avoirs de l’administration compris');
      // Le même dépassement par l'administration : le même refus (témoin, sans écriture).
      await refuse(() => avoir(facture.id, P3, par('AD')), 409, REFUS.plafondTotal, 'P3 par l’administration');
      await refuse(() => avoir(facture.id, P1, par('AD')), 409, REFUS.plafondTaux55, 'P1 par l’administration (plafond à 5,5 % atteint)');
      assert.equal(await sequenceAvoirs(), avant + 4, 'P3 : aucun numéro consommé');
      const a5 = await avoirCree(facture.id, A5.lignes, par('AT'));
      assert.deepEqual([rangDe(a5.numero), ...nombres([a5.totalHt, a5.totalTva, a5.totalTtc])], [avant + 5, ...A5.totaux], 'A5 : numéro suivant, reste exact à 20 %');
      assert.equal(await sequenceAvoirs(), avant + 5);
      assert.deepEqual([a1, a2, a3, a4, a5].map((a) => prefixeDe(a.numero)), Array(5).fill(`A${jour().annee}`));
      // Créditée en entier par ses avoirs, sans règlement : reste dû nul, statut « réglée » (lot « Statut d'une facture couverte
      // par des avoirs », critère 1), entrée REGLEMENT à son nom, auteur de A5 qui la solde, avec les avoirs cumulés de tous les
      // auteurs (35,52 + 35,69 + 35,95 + 41,80 + 99,37 = 248,33 €). Lectures écartées : l'ancienne règle (« émise », sans
      // entrée) ; l'avoir A5 seul dans le détail (99,37 €).
      assert.deepEqual(await soldes(facture.id, par('AT')), ['REGLEE', 248.33, 0, 0]);
      const journalF = (await enBase(facture.id)).journal;
      assert.deepEqual(journalF.map((j) => [j.action, j.acteurId]), [['CREATION_BROUILLON', comptes.AT.id], ['EMISSION', comptes.AT.id], ['REGLEMENT', comptes.AT.id]]);
      assert.equal(journalF[2].detail, `Transition EMISE → REGLEE (avoir partiel ${a5.numero}) : réglé 0,00 €, avoirs 248,33 €, reste dû 0,00 €`);
      // Un centime de plus, à n'importe quel taux de la facture : refusé.
      await refuse(() => avoir(facture.id, [ligne('un centime de trop', 1, 0.01, 20)], par('AT')), 409, REFUS.plafondTotal, 'facture créditée en entier');
    });

    // Cadrage v2, « Montants », sixième puce (C4) : ses avoirs dans l'export comptable de l'administration, lignes identiques à
    // celles d'un avoir de l'administration (montants : A2 et A2').
    test('montants : export comptable de l’administration : les lignes de son avoir (35,69 € au crédit du 411, 12,07 € et 20,09 € au débit des ventes, 2,42 € et 1,11 € de TVA) identiques, au numéro près, à celles du même avoir créé par l’administration ; l’export lui reste refusé', async () => {
      const sienne = await scenarioEntreAuteurs(par('AT'), par('AT'), 'export, assistante');
      const jumelle = await scenarioEntreAuteurs(par('AT'), par('AD'), 'export, administration');
      const export_ = await appeler('get', '/factures/export-comptable.csv', null, par('AD'));
      assert.equal(export_.status, 200, export_.text);
      const lignes = export_.text.replace(/^﻿/, '').trim().split('\n').slice(1).map((l) => l.slice(1, -1).split('";"').map((c) => c.replace(/""/g, '"')));
      const dePiece = (numero) => lignes.filter((c) => c[2] === numero).map((c) => c.map((champ) => champ.replaceAll(numero, '<numéro>')));
      const lignesAvoir = dePiece(sienne.a2.numero);
      assert.deepEqual(lignesAvoir.map((c) => [c[0], c[1], c[3], c[6], c[7]]), [
        ['VE', jour().compact, '411000', '0.00', '35.69'], ['VE', jour().compact, '706000', '12.07', '0.00'], ['VE', jour().compact, '707000', '20.09', '0.00'],
        ['VE', jour().compact, '445711', '1.11', '0.00'], ['VE', jour().compact, '445710', '2.42', '0.00'],
      ]);
      assert.ok(lignesAvoir.every((c) => c[5] === `Avoir <numéro> — ${clientPrincipal.raisonSociale}`), JSON.stringify(lignesAvoir));
      assert.deepEqual(lignesAvoir, dePiece(jumelle.a2.numero), 'son avoir et celui de l’administration : mêmes lignes');
      // La facture d'origine garde ses écritures, non contre-passées (avoirs partiels).
      assert.deepEqual(dePiece(sienne.facture.numero).map((c) => [c[3], c[6], c[7]]), [['411000', '248.33', '0.00'], ['706000', '0.00', '119.02'], ['707000', '0.00', '100.01'], ['445711', '0.00', '5.50'], ['445710', '0.00', '23.80']]);
      await refuse(() => appeler('get', '/factures/export-comptable.csv', null, par('AT')), 403, REFUS.administration, 'export refusé à elle');
    });

    // Cadrage v2, « Montants », troisième puce (C4) ; critère 2 ; T1 (« annulation par elle sur une facture de son poste émise par
    // l'administration : admis »). Facture F (LIGNES_F) : l'avoir total la reprend telle quelle, ventilation sur la base cumulée
    // comprise (23,80 € et non 23,81 €, la TVA ligne par ligne), écritures inversées (lecture écartée : recopiées sans inversion).
    test('montants : annulation par elle de sa facture, puis d’une facture de son poste émise par l’administration : avoir total aux montants de la facture (248,33 €, ventilation 23,80 € et 5,50 €), écritures inversées relues en base, PDF ; facture annulée, journal à son nom, numéros consécutifs', async () => {
      for (const [cas, emetteur] of [['émise par elle', par('AT')], ['émise par l’administration', par('AD')]]) {
        const facture = await factureEmise(par('AT'), `annulation, ${cas}`, LIGNES_F, { authEmission: emetteur });
        assert.equal(facture.creeParType, ROLE_AT, cas);
        const avant = await sequenceAvoirs();
        const res = await annuler(facture.id, par('AT'));
        assert.equal(res.status, 200, `${cas} : ${JSON.stringify(res.body)}`);
        const avoirTotal = res.body.avoir;
        assert.deepEqual([res.body.statut, avoirTotal.type, avoirTotal.estAvoirAnnulation, avoirTotal.creeParType, avoirTotal.createdById, rangDe(avoirTotal.numero)], ['ANNULEE', 'AVOIR', true, ROLE_AT, comptes.AT.id, avant + 1], cas);
        const relu = await enBase(avoirTotal.id);
        const origine = await enBase(facture.id);
        assert.deepEqual(nombres([relu.totalHt, relu.totalTva, relu.totalTtc]), F.totaux, cas);
        assert.deepEqual(relu.lignes.map((l) => [l.designation, l.nature, ...nombres([l.quantite, l.prixUnitaireHt, l.tauxTva, l.totalHt, l.totalTtc])]),
          LIGNES_F.map((l, i) => [l.designation, l.nature, l.quantite, l.prixUnitaireHt, l.tauxTva, ...F.lignes[i]]), `${cas} : lignes`);
        assert.deepEqual(relu.ventilationTva.map((v) => nombres([v.tauxTva, v.totalHt, v.totalTva, v.totalTtc])), F.ventilation, `${cas} : ventilation`);
        assert.deepEqual(ecrituresTriees(origine), ECRITURES_F, `${cas} : écritures de la facture`);
        assert.deepEqual(ecrituresTriees(relu), ECRITURES_F.map(([cle, compte, debit, credit]) => [cle, compte, credit, debit]), `${cas} : écritures inversées`);
        assert.notDeepEqual(ecrituresTriees(relu), ECRITURES_F, `${cas} : lecture écartée, sans inversion`);
        assert.deepEqual([origine.statut, nombres([origine.totalHt, origine.totalTva, origine.totalTtc])], ['ANNULEE', F.totaux], `${cas} : facture annulée, montants figés`);
        assert.deepEqual(origine.journal.slice(-1).map((j) => [j.action, j.acteurId, j.detail]), [['ANNULATION', comptes.AT.id, `Transition EMISE → ANNULEE ; avoir total ${avoirTotal.numero}`]], cas);
        assert.deepEqual(relu.journal.map((j) => [j.action, j.acteurId, j.detail]), [['CREATION_AVOIR', comptes.AT.id, `Avoir total de la facture ${facture.numero}`]], cas);
        // Soldes : une facture annulée n'en a plus (comportement existant) ; lu de même par elle et par l'administration.
        assert.deepEqual(await soldes(facture.id, par('AT')), ['ANNULEE', null, null, null], cas);
        assert.deepEqual(await soldes(facture.id, par('AD')), ['ANNULEE', null, null, null], cas);
        // PDF de l'avoir total, lu par elle.
        const texte = await texteDuPdf(await appeler('get', `/factures/${avoirTotal.id}/document.pdf`, null, par('AT')));
        for (const attendu of [`AVOIR ${avoirTotal.numero}`, `Facture d’origine : ${facture.numero}`, 'Total HT : 219,03 €', 'TVA 5.5 % sur 100,01 € : 5,50 €', 'TVA 20 % sur 119,02 € : 23,80 €', 'TVA totale : 29,30 €', 'Total TTC : 248,33 €']) {
          assert.ok(texte.includes(attendu), `${cas}, PDF : ${attendu}`);
        }
        assert.ok(!texte.includes('23,81 €'), `${cas}, PDF : TVA ligne par ligne écartée`);
        assert.ok((await texteDuPdf(await appeler('get', `/factures/${facture.id}/document.pdf`, null, par('AT')))).includes('FACTURE ANNULÉE'), `${cas} : la facture se lit annulée`);
        // Une seconde annulation : refusée, sans écriture.
        await refuse(() => annuler(facture.id, par('AT')), 409, REFUS.nonAnnulable, `${cas} : déjà annulée`);
      }
    });

    // Cadrage v2, « Montants », cinquième puce (C4) ; critère 1 ; N6 (entrée du journal à son nom quand son avoir solde une facture
    // réglée en partie). Montants : LIGNES_SOLDE, AVOIR_SOLDE et AVOIR_TROP_PERCU plus haut.
    test('montants : reste dû et statut après son avoir partiel : facture non réglée, reste 100,00 € et « émise » ; réglée de 100,00 €, soldée par son avoir de 48,14 €, « réglée » avec l’entrée du journal à son nom ; réglée en entier, trop-perçu de 12,00 € (reste −12,00 €), statut inchangé, sans entrée', async () => {
      // (a) non réglée.
      const fa = await factureEmise(par('AT'), 'reste dû, non réglée', LIGNES_SOLDE);
      assert.deepEqual(nombres([fa.totalHt, fa.totalTva, fa.totalTtc]), [123.45, 24.69, 148.14]);
      const avoirA = await avoirCree(fa.id, AVOIR_SOLDE, par('AT'));
      assert.deepEqual(nombres([avoirA.totalHt, avoirA.totalTva, avoirA.totalTtc]), [40.12, 8.02, 48.14]);
      for (const cle of ['AT', 'AD']) assert.deepEqual(await soldes(fa.id, par(cle)), ['EMISE', 48.14, 0, 100], `(a) lu par ${cle}`);
      assert.deepEqual((await enBase(fa.id)).journal.map((j) => j.action), ['CREATION_BROUILLON', 'EMISSION'], '(a) aucune entrée de règlement');

      // (b) réglée en partie par l'administration, soldée par son avoir. Audit des montants de #520 (T1) : la facture est créée
      // par l'autre assistante, pour que l'entrée REGLEMENT désigne l'auteur de l'avoir, et non le créateur de la facture.
      const fb = await factureEmise(par('AT2'), 'reste dû, réglée en partie', LIGNES_SOLDE);
      await regler(fb.id, 100);
      assert.deepEqual(await soldes(fb.id, par('AT')), ['EMISE', 0, 100, 48.14]);
      const avoirB = await avoirCree(fb.id, AVOIR_SOLDE, par('AT'));
      for (const cle of ['AT', 'AD']) assert.deepEqual(await soldes(fb.id, par(cle)), ['REGLEE', 48.14, 100, 0], `(b) lu par ${cle}`);
      const journalB = (await enBase(fb.id)).journal.filter((j) => ['REGLEMENT', 'RETOUR_EMISE'].includes(j.action));
      // Lot « Statut d'une facture couverte par des avoirs » : le détail cite les avoirs de la facture (choix par défaut, à
      // confirmer ; lecture écartée : détail sans les avoirs).
      assert.deepEqual(journalB.map((j) => [j.action, j.acteurId, j.detail]), [['REGLEMENT', comptes.AT.id, `Transition EMISE → REGLEE (avoir partiel ${avoirB.numero}) : réglé 100,00 €, avoirs 48,14 €, reste dû 0,00 €`]]);
      // Le journal de la facture, lu par elle : l'entrée à son nom, telle quelle.
      const lu = await ok(appeler('get', `/factures/${fb.id}/journal`, null, par('AT')));
      assert.deepEqual(lu.filter((j) => j.action === 'REGLEMENT').map((j) => [j.acteurId, j.detail]), [[comptes.AT.id, journalB[0].detail]]);
      // Elle ne saisit pas de règlement pour autant.
      await refuse(() => appeler('post', '/reglements', { clientId: clientPrincipal.id, dateReglement: jour().fr, montant: 1, moyen: 'VIREMENT', affectations: [{ factureId: fa.id, montant: 1 }] }, par('AT')), 403, REFUS.administration, 'saisie d’un règlement');

      // (c) réglée en entier, puis son avoir : trop-perçu.
      const fc = await factureEmise(par('AT'), 'reste dû, réglée en entier', LIGNES_SOLDE);
      await regler(fc.id, 148.14);
      assert.deepEqual(await soldes(fc.id, par('AT')), ['REGLEE', 0, 148.14, 0]);
      const entreesAvant = (await enBase(fc.id)).journal.length;
      const avoirC = await avoirCree(fc.id, AVOIR_TROP_PERCU, par('AT'));
      assert.deepEqual(nombres([avoirC.totalHt, avoirC.totalTva, avoirC.totalTtc]), [10, 2, 12]);
      for (const cle of ['AT', 'AD']) assert.deepEqual(await soldes(fc.id, par(cle)), ['REGLEE', 12, 148.14, -12], `(c) lu par ${cle}`);
      const fcRelue = await enBase(fc.id);
      assert.equal(fcRelue.journal.length, entreesAvant, '(c) aucune entrée sur la facture : statut inchangé');
      assert.deepEqual(nombres([fcRelue.totalHt, fcRelue.totalTva, fcRelue.totalTtc]), [123.45, 24.69, 148.14]);
    });

    // Cadrage v2, « Montants », quatrième puce (« numérotation des avoirs continue entre elle et l'administration ») ; T1 (« après
    // un 404, séquence des avoirs inchangée »). Lectures écartées : une séquence propre à l'assistante technique ; un numéro
    // consommé par un refus.
    test('numérotation des avoirs continue : avoir partiel de l’administration, annulation par elle, annulation par l’administration, avoir partiel de la seconde assistante, refus (404 et 409) sans numéro, avoir partiel d’elle : numéros consécutifs d’une même séquence, type et journal de chaque auteur', async () => {
      const f1 = await factureEmise(par('AT'), 'numérotation 1', LIGNES_SOLDE);
      const f2 = await factureEmise(par('AT'), 'numérotation 2', LIGNES_SOLDE);
      const f3 = await factureEmise(par('AD'), 'numérotation 3', LIGNES_SOLDE);
      const f4 = await factureEmise(par('AT'), 'numérotation 4', LIGNES_SOLDE, { authEmission: par('AD') });
      const f5 = await factureEmise(par('AD'), 'numérotation 5', LIGNES_SOLDE);
      const avant = await sequenceAvoirs();
      const pieces = [];
      pieces.push([await avoirCree(f1.id, AVOIR_TROP_PERCU, par('AD')), 'ADMIN', comptes.AD.id]);
      pieces.push([(await ok(annuler(f2.id, par('AT')))).avoir, ROLE_AT, comptes.AT.id]);
      pieces.push([(await ok(annuler(f3.id, par('AD')))).avoir, 'ADMIN', comptes.AD.id]);
      pieces.push([await avoirCree(f4.id, AVOIR_TROP_PERCU, par('AT2')), ROLE_AT, comptes.AT2.id]);
      await refuse(() => avoir(f5.id, AVOIR_TROP_PERCU, par('AT')), 404, REFUS.introuvable, 'avoir sur une facture de l’administration');
      await refuse(() => annuler(f5.id, par('AT')), 404, REFUS.introuvable, 'annulation d’une facture de l’administration');
      await refuse(() => annuler(f2.id, par('AT')), 409, REFUS.nonAnnulable, 'facture déjà annulée');
      pieces.push([await avoirCree(f1.id, AVOIR_TROP_PERCU, par('AT')), ROLE_AT, comptes.AT.id]);
      const numeros = pieces.map(([p]) => p.numero);
      assert.deepEqual(numeros.map(rangDe), [1, 2, 3, 4, 5].map((i) => avant + i), `numéros consécutifs : ${numeros.join(', ')}`);
      assert.deepEqual(numeros.map(prefixeDe), Array(5).fill(`A${jour().annee}`), 'même préfixe, même année');
      assert.equal(await sequenceAvoirs(), avant + 5, 'la séquence s’arrête au dernier numéro attribué');
      for (const [piece, type, acteur] of pieces) {
        const relu = await enBase(piece.id);
        assert.deepEqual([relu.creeParType, relu.createdById, relu.journal.map((j) => j.acteurId)], [type, acteur, [acteur]], piece.numero);
      }
    });

    // Audit des droits d'AT-4, T1 : le poste n'est pas nominatif (point 33, « non nomminative ») ; une assistante technique annule
    // ou solde par son avoir une facture créée par une autre. Chaque entrée du journal est au nom de qui agit, et non de la
    // créatrice de la facture (mutants « journal de l'annulation, de l'avoir total ou du passage à « réglée » au nom du créateur »,
    // qui survivaient : toutes les annulations par elle portaient sur ses propres factures). Montants repris de LIGNES_SOLDE et
    // AVOIR_SOLDE (148,14 € TTC, réglée de 100,00 €, avoir de 48,14 € : reste dû 0,00 €), déjà vérifiés plus haut.
    test('journal : la seconde assistante annule une facture créée par la première, puis solde par son avoir une facture de la première réglée en partie : ANNULATION, CREATION_AVOIR, CREATION_AVOIR_PARTIEL et REGLEMENT à son nom, et non à celui de la créatrice', async () => {
      const annulee = await factureEmise(par('AT'), 'journal, annulée par la seconde assistante', LIGNES_SOLDE);
      const annulation = await ok(annuler(annulee.id, par('AT2')));
      const facture = await enBase(annulee.id);
      assert.deepEqual([facture.createdById, facture.statut], [comptes.AT.id, 'ANNULEE']);
      assert.deepEqual(facture.journal.filter((j) => j.action === 'ANNULATION').map((j) => [j.acteurId, j.detail]), [[comptes.AT2.id, `Transition EMISE → ANNULEE ; avoir total ${annulation.avoir.numero}`]]);
      const avoirTotal = await enBase(annulation.avoir.id);
      assert.deepEqual([avoirTotal.creeParType, avoirTotal.createdById], [ROLE_AT, comptes.AT2.id]);
      assert.deepEqual(avoirTotal.journal.map((j) => [j.action, j.acteurId]), [['CREATION_AVOIR', comptes.AT2.id]]);

      const soldee = await factureEmise(par('AT'), 'journal, soldée par la seconde assistante', LIGNES_SOLDE);
      await regler(soldee.id, 100);
      const avoirSolde = await avoirCree(soldee.id, AVOIR_SOLDE, par('AT2'));
      assert.deepEqual((await enBase(avoirSolde.id)).journal.map((j) => [j.action, j.acteurId]), [['CREATION_AVOIR_PARTIEL', comptes.AT2.id]]);
      const relue = await enBase(soldee.id);
      assert.deepEqual([relue.createdById, relue.statut], [comptes.AT.id, 'REGLEE']);
      assert.deepEqual(relue.journal.filter((j) => j.action === 'REGLEMENT').map((j) => [j.acteurId, j.detail]),
        [[comptes.AT2.id, `Transition EMISE → REGLEE (avoir partiel ${avoirSolde.numero}) : réglé 100,00 €, avoirs 48,14 €, reste dû 0,00 €`]]);
    });

    // C2 et T1 du contrôle de mode 1 ; cadrage v2, § 1 (« Ce 404 passe avant tout refus propre à la pièce … Seul le 400 de lignes
    // d'avoir absentes ou mal formées … le précède ») ; critère 3. Chaque pièce de l'administration est choisie pour qu'un refus
    // propre à la pièce s'y applique : l'administration, témoin, le reçoit sur la même pièce (sans écriture), elle reçoit le 404.
    test('droits : sur les pièces de l’administration, 404 « Facture introuvable. » à elle avant tout refus propre à la pièce (statut, avoir sur un avoir, avoirs partiels, règlement, taux absent, plafond, imputation, identité) que l’administration reçoit sur la même pièce ; 400 des lignes absentes ou mal formées avant ce 404 ; aucune écriture, séquence des avoirs inchangée', async () => {
      const at = par('AT'); const ad = par('AD');
      const brouillonAdmin = await brouillon(ad, 'administration, brouillon', LIGNES_SOLDE);
      const emiseAdmin = await factureEmise(ad, 'administration, émise', LIGNES_SOLDE);
      const avecAvoir = await factureEmise(ad, 'administration, avec avoir', LIGNES_SOLDE);
      const avoirAdmin = await avoirCree(avecAvoir.id, AVOIR_TROP_PERCU, ad);
      const regleeAdmin = await factureEmise(ad, 'administration, réglée en partie', LIGNES_SOLDE);
      await regler(regleeAdmin.id, 10);
      const annuleeAdmin = await factureEmise(ad, 'administration, annulée', LIGNES_SOLDE);
      await ok(annuler(annuleeAdmin.id, ad));
      const sequenceAvant = await sequenceAvoirs();
      const dejaAvoirs = [ligne('avoir correct', 1, 1, 20)];
      // [pièce, route, corps, refus de l'administration sur cette pièce (null : elle l'écrirait, non jouée)].
      const cas = [
        ['brouillon', brouillonAdmin, 'avoirs', dejaAvoirs, [409, REFUS.nonCreditable]],
        ['brouillon', brouillonAdmin, 'annuler', {}, [409, REFUS.nonAnnulable]],
        ['avoir', avoirAdmin, 'avoirs', dejaAvoirs, [409, REFUS.nonCreditable]],
        ['avoir', avoirAdmin, 'annuler', {}, [409, REFUS.nonAnnulable]],
        ['facture avec avoir partiel', avecAvoir, 'annuler', {}, [409, REFUS.avoirsPartiels]],
        ['facture réglée en partie', regleeAdmin, 'annuler', {}, [409, REFUS.reglementRecu]],
        ['facture annulée', annuleeAdmin, 'avoirs', dejaAvoirs, [409, REFUS.nonCreditable]],
        ['facture annulée', annuleeAdmin, 'annuler', {}, [409, REFUS.nonAnnulable]],
        ['taux absent', emiseAdmin, 'avoirs', [ligne('taux absent', 1, 1, 5.5)], [400, REFUS.tauxAbsent]],
        ['plafond', emiseAdmin, 'avoirs', [ligne('au-delà du plafond', 1, 1000, 20)], [409, REFUS.plafondTotal]],
        ['nature absente', emiseAdmin, 'avoirs', [ligne('nature absente', 1, 1, 20, 'ARTICLE')], [409, REFUS.natureAbsente]],
        ['facture émise, avoir admis pour l’administration', emiseAdmin, 'avoirs', dejaAvoirs, null],
        ['facture émise, annulation admise pour l’administration', emiseAdmin, 'annuler', {}, null],
      ];
      for (const [quoi, piece, route, corps, refusAdministration] of cas) {
        const chemin = `/factures/${piece.id}/${route}`;
        const appel = (auth) => appeler('post', chemin, route === 'avoirs' ? { lignes: corps } : corps, auth);
        await refuse(() => appel(at), 404, REFUS.introuvable, `${quoi} : ${route} par elle`);
        if (refusAdministration) await refuse(() => appel(ad), ...refusAdministration, `${quoi} : ${route} par l’administration (témoin)`);
      }
      // Pièce absente : 404 pour les deux.
      for (const auth of [at, ad]) {
        await refuse(() => avoir(randomUUID(), dejaAvoirs, auth), 404, REFUS.introuvable, 'avoir sur une pièce absente');
        await refuse(() => annuler(randomUUID(), auth), 404, REFUS.introuvable, 'annulation d’une pièce absente');
      }
      // Identité de la société incomplète : 409 pour l'administration, 404 pour elle sur la pièce de l'administration, et sur sa
      // propre facture le même 409 que l'administration.
      const sienne = await factureEmise(at, 'identité incomplète', LIGNES_SOLDE);
      const identite = await prisma.companySettings.findUniqueOrThrow({ where: { id: 'singleton' }, select: { siret: true } });
      await prisma.companySettings.update({ where: { id: 'singleton' }, data: { siret: '' } });
      try {
        for (const [route, corps] of [['annuler', {}], ['avoirs', { lignes: dejaAvoirs }]]) {
          await refuse(() => appeler('post', `/factures/${emiseAdmin.id}/${route}`, corps, ad), 409, REFUS.identite, `identité incomplète : ${route} par l’administration`);
          await refuse(() => appeler('post', `/factures/${emiseAdmin.id}/${route}`, corps, at), 404, REFUS.introuvable, `identité incomplète : ${route} par elle, pièce de l’administration`);
          await refuse(() => appeler('post', `/factures/${sienne.id}/${route}`, corps, at), 409, REFUS.identite, `identité incomplète : ${route} par elle, sa facture`);
        }
      } finally {
        await prisma.companySettings.update({ where: { id: 'singleton' }, data: { siret: identite.siret } });
      }
      // Lignes absentes ou mal formées : 400, lu avant la pièce, pour elle comme pour l'administration, sur la pièce de
      // l'administration comme sur une pièce absente.
      for (const id of [emiseAdmin.id, brouillonAdmin.id, randomUUID()]) {
        for (const auth of [at, ad]) {
          await refuse(() => appeler('post', `/factures/${id}/avoirs`, {}, auth), 400, REFUS.lignesAbsentes, `corps vide sur ${id}`);
          await refuse(() => avoir(id, [], auth), 400, REFUS.lignesAbsentes, `aucune ligne sur ${id}`);
          await refuse(() => avoir(id, [ligne('quantité nulle', 0, 10, 20)], auth), 400, REFUS.ligneInvalide, `ligne mal formée sur ${id}`);
        }
      }
      assert.equal(await sequenceAvoirs(), sequenceAvant, 'aucun numéro d’avoir consommé');
      // Témoin : l'administration crée l'avoir et annule les pièces que les refus ont laissées intactes.
      assert.equal((await avoir(emiseAdmin.id, dejaAvoirs, ad)).status, 201);
    });

    // T1 du contrôle de mode 1 (« sur une pièce d'avant AT-3 (creeParType nul) : 404 ») ; points 33 et 34 du 24-10-2026 : une pièce
    // sans type de créateur (aucune reprise, règle 4) reste à la seule administration. Le brouillon est écrit en base sans type,
    // comme avant AT-3, puis émis par l'administration : la colonne reste nulle.
    test('droits : pièce d’avant AT-3, sans type de créateur, brouillon puis émise par l’administration : avoir et annulation refusés à elle (404), sans écriture ; l’administration y entre', async () => {
      const jourDate = new Date(`${jour().compact.slice(0, 4)}-${jour().compact.slice(4, 6)}-${jour().compact.slice(6)}T00:00:00Z`);
      const ancienne = await prisma.facture.create({ data: {
        clientId: clientPrincipal.id, clientRaisonSociale: clientPrincipal.raisonSociale, origine: 'HORS_AFFAIRE', motifHorsAffaire: `TEST AT-4 pièce sans type ${suffixe()}`,
        dateEmission: jourDate, dateEcheance: jourDate, totalHt: 123.45, totalTva: 24.69, totalTtc: 148.14,
        lignes: { create: [{ ordre: 0, designation: 'TEST AT-4 pièce sans type', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 123.45, tauxTva: 20, totalHt: 123.45, totalTtc: 148.14 }] },
        ventilationTva: { create: [{ tauxTva: 20, totalHt: 123.45, totalTva: 24.69, totalTtc: 148.14 }] },
      } });
      assert.equal(ancienne.creeParType, null);
      await refuse(() => annuler(ancienne.id, par('AT')), 404, REFUS.introuvable, 'brouillon sans type : annulation');
      await refuse(() => avoir(ancienne.id, AVOIR_TROP_PERCU, par('AT')), 404, REFUS.introuvable, 'brouillon sans type : avoir');
      await refuse(() => annuler(ancienne.id, par('AD')), 409, REFUS.nonAnnulable, 'témoin : l’administration reçoit le refus du statut');
      const emise = await emettre(ancienne.id, par('AD'));
      assert.deepEqual([emise.statut, (await prisma.facture.findUniqueOrThrow({ where: { id: ancienne.id } })).creeParType], ['EMISE', null]);
      await refuse(() => annuler(ancienne.id, par('AT')), 404, REFUS.introuvable, 'émise sans type : annulation');
      await refuse(() => avoir(ancienne.id, AVOIR_TROP_PERCU, par('AT')), 404, REFUS.introuvable, 'émise sans type : avoir');
      await refuse(() => avoir(ancienne.id, [ligne('taux absent', 1, 1, 5.5)], par('AD')), 400, REFUS.tauxAbsent, 'témoin : l’administration reçoit le refus du taux');
      assert.equal((await avoir(ancienne.id, AVOIR_TROP_PERCU, par('AD'))).status, 201, 'témoin : l’administration crée l’avoir');
    });

    // T1 du contrôle de mode 1 (« sur un avoir de son poste : 409 … ; refus existants (avoir partiel déjà émis, règlement reçu)
    // identiques pour elle ») ; cadrage v2, § 1 (« refus existants … communs aux deux types de compte »). Chaque refus est relu,
    // au même message, pour l'administration sur la même pièce (témoin).
    test('droits : refus propres à la pièce, identiques pour elle et pour l’administration, sans écriture : avoir de son poste (avoir partiel et annulation), brouillon, facture annulée, avoir partiel déjà émis, règlement reçu, taux absent, nature absente', async () => {
      const at = par('AT'); const ad = par('AD');
      const sienBrouillon = await brouillon(at, 'refus, brouillon', LIGNES_SOLDE);
      const avecAvoir = await factureEmise(at, 'refus, avec avoir', LIGNES_SOLDE);
      const sonAvoir = await avoirCree(avecAvoir.id, AVOIR_TROP_PERCU, at);
      const avoirAdminSurSienne = await avoirCree(avecAvoir.id, [ligne('avoir de l’administration', 1, 2, 20)], ad);
      const reglee = await factureEmise(at, 'refus, réglée en partie', LIGNES_SOLDE);
      await regler(reglee.id, 10);
      const annulee = await factureEmise(at, 'refus, annulée', LIGNES_SOLDE);
      const avoirTotal = (await ok(annuler(annulee.id, at))).avoir;
      const emise = await factureEmise(at, 'refus, émise', LIGNES_SOLDE);
      const cas = [
        ['son avoir partiel', sonAvoir, 'avoirs', AVOIR_TROP_PERCU, 409, REFUS.nonCreditable],
        ['son avoir partiel', sonAvoir, 'annuler', {}, 409, REFUS.nonAnnulable],
        ['avoir de l’administration sur sa facture', avoirAdminSurSienne, 'avoirs', AVOIR_TROP_PERCU, 409, REFUS.nonCreditable],
        ['avoir de l’administration sur sa facture', avoirAdminSurSienne, 'annuler', {}, 409, REFUS.nonAnnulable],
        ['son avoir total', avoirTotal, 'avoirs', AVOIR_TROP_PERCU, 409, REFUS.nonCreditable],
        ['son avoir total', avoirTotal, 'annuler', {}, 409, REFUS.nonAnnulable],
        ['son brouillon', sienBrouillon, 'avoirs', AVOIR_TROP_PERCU, 409, REFUS.nonCreditable],
        ['son brouillon', sienBrouillon, 'annuler', {}, 409, REFUS.nonAnnulable],
        ['sa facture annulée', annulee, 'avoirs', AVOIR_TROP_PERCU, 409, REFUS.nonCreditable],
        ['sa facture avec avoir partiel', avecAvoir, 'annuler', {}, 409, REFUS.avoirsPartiels],
        ['sa facture réglée en partie', reglee, 'annuler', {}, 409, REFUS.reglementRecu],
        ['taux absent', emise, 'avoirs', [ligne('taux absent', 1, 1, 5.5)], 400, REFUS.tauxAbsent],
        ['nature absente', emise, 'avoirs', [ligne('nature absente', 1, 1, 20, 'ARTICLE')], 409, REFUS.natureAbsente],
      ];
      for (const [quoi, piece, route, corps, statut, message] of cas) {
        for (const [qui, auth] of [['elle', at], ['l’administration', ad]]) {
          await refuse(() => appeler('post', `/factures/${piece.id}/${route}`, route === 'avoirs' ? { lignes: corps } : corps, auth), statut, message, `${quoi} : ${route} par ${qui}`);
        }
      }
      // Sur une facture réglée en partie, l'avoir partiel lui reste ouvert (le refus ne vaut que pour l'annulation).
      assert.equal((await avoir(reglee.id, AVOIR_TROP_PERCU, at)).status, 201);
    });

    // Audit des montants de #520 (C1) : la règle « une facture qui porte un avoir partiel ne s'annule plus en totalité » vaut quel
    // que soit l'auteur de l'avoir partiel, comme les plafonds et la TVA différentielle (cadrage v2, § 1 : « refus existants (avoirs
    // partiels déjà émis, règlement reçu, statut) : inchangés, communs aux deux types de compte » ; « Les plafonds et la TVA
    // différentielle se calculent sur tous les avoirs émis de la facture, quel qu'en soit l'auteur »). Chaque facture ne porte que
    // l'avoir partiel d'un autre auteur que celui qui l'annule. Montants : facture 1 × 123,45 € à 20 % (TTC 148,14 €), avoir partiel
    // 1 × 10,00 € à 20 % (TTC 12,00 €) ; après le refus, avoirs 12,00 €, reste dû 136,14 €, « émise ». Lectures écartées : seuls les
    // avoirs partiels du même type d'auteur, ou du même compte, comptés ; l'annulation passerait alors le contrôle de l'application
    // et créerait un avoir total de 148,14 € (160,14 € crédités pour 148,14 € facturés), arrêté par le seul garde de la base, sans
    // le refus attendu.
    test('montants : annulation refusée (409, avoirs partiels déjà émis) sur une facture de son poste qui ne porte que l’avoir partiel d’un autre auteur (l’administration, l’autre assistante), et à l’administration sur une facture qui ne porte que le sien ; sans écriture ni numéro ; avoirs 12,00 €, reste dû 136,14 €, toujours émise', async () => {
      const at = par('AT'); const at2 = par('AT2'); const ad = par('AD');
      const cas = [
        ['avoir partiel de l’administration, annulation par elle', ad, at],
        ['avoir partiel de l’autre assistante, annulation par elle', at2, at],
        ['avoir partiel d’elle, annulation par l’administration', at, ad],
      ];
      for (const [quoi, auteurAvoir, auteurAnnulation] of cas) {
        const facture = await factureEmise(at, `annulation après l’avoir d’un autre auteur, ${quoi}`, LIGNES_SOLDE);
        assert.deepEqual(nombres([facture.totalHt, facture.totalTva, facture.totalTtc]), [123.45, 24.69, 148.14], quoi);
        const avoirPartiel = await avoirCree(facture.id, AVOIR_TROP_PERCU, auteurAvoir);
        assert.deepEqual(nombres([avoirPartiel.totalHt, avoirPartiel.totalTva, avoirPartiel.totalTtc]), [10, 2, 12], quoi);
        const sequenceAvant = await sequenceAvoirs();
        await refuse(() => annuler(facture.id, auteurAnnulation), 409, REFUS.avoirsPartiels, quoi);
        assert.equal(await sequenceAvoirs(), sequenceAvant, `${quoi} : aucun numéro consommé`);
        assert.deepEqual(await soldes(facture.id, ad), ['EMISE', 12, 0, 136.14], `${quoi} : avoirs 12,00 €, reste dû 136,14 €`);
        const relue = await enBase(facture.id);
        assert.deepEqual([relue.statut, relue.journal.map((j) => j.action)], ['EMISE', ['CREATION_BROUILLON', 'EMISSION']], quoi);
      }
    });

    // T1 du contrôle de mode 1 (« pour chacun des sept autres types, refus de /avoirs et /annuler au message de
    // requireGestionFactures ») ; cadrage v2, § 1 (N5) et § 2 (refus de la route du repère) ; contrat livré : 401 sans session et
    // pour une clé d'intégration. Les pièces visées sont de son poste et de l'administration ; rien n'est écrit.
    test('droits : avoir, annulation et repère refusés aux sept autres types (403 « Accès réservé à l’administration et à l’assistante technique. »), sans session et par une clé d’intégration (401), sans écriture ; le directeur y entre comme l’administration', async () => {
      const sienne = await factureEmise(par('AT'), 'autres types, sienne', LIGNES_SOLDE);
      const administration = await factureEmise(par('AD'), 'autres types, administration', LIGNES_SOLDE);
      const affaire = await chantier('autres types');
      const routes = (id) => [
        ['post', `/factures/${id}/avoirs`, { lignes: AVOIR_TROP_PERCU }], ['post', `/factures/${id}/avoirs`, {}], ['post', `/factures/${id}/annuler`, {}],
      ];
      const lectures = [['get', `/factures/deja-facturee?origine=CHANTIER&id=${affaire.id}`], ['get', '/factures/deja-facturee']];
      const cle = await ok(appeler('post', '/admin/api-keys', { nom: `TEST AT-4 clé ${suffixe()}`, scopes: ['finances:read', 'clients:read'] }), 201);
      const avant = await empreinte();
      for (const [code] of AUTRES_TYPES) {
        for (const [methode, chemin, corps] of [...routes(sienne.id), ...routes(administration.id), ...lectures]) {
          const res = await appeler(methode, chemin, corps, par(code));
          assert.deepEqual([res.status, res.body?.error], [403, REFUS.gestion], `${code} : ${methode} ${chemin}`);
        }
      }
      for (const [methode, chemin, corps] of [...routes(sienne.id), ...lectures]) {
        assert.equal((await appeler(methode, chemin, corps, null)).status, 401, `sans session : ${chemin}`);
        assert.equal((await appeler(methode, chemin, corps, entete(cle.apiKey))).status, 401, `clé d’intégration : ${chemin}`);
      }
      assert.deepEqual(tablesChangees(avant, await empreinte()).filter((t) => t !== 'ApiKey'), [], 'aucun refus n’écrit');
      // Le directeur (administration, point 14 du 24-10-2026) : avoir et annulation admis.
      assert.equal((await avoir(sienne.id, AVOIR_TROP_PERCU, par('DIR'))).status, 201);
      assert.equal((await annuler(administration.id, par('DIR'))).status, 200);
      assert.equal((await repere('CHANTIER', affaire.id, par('DIR'))).status, 200);
    });

    // Critère 4 ; cadrage v2, § 1, « Envoi d'un avoir » (réponse 1 du 09-11-2026, « Elle envoie ces avoirs. », et choix par
    // défaut, à confirmer, pour les avoirs de l'administration sur les factures de son poste) ; T1 (« envoi d'un avoir ouvert
    // (messagerie et Microsoft 365), le sien et celui de l'administration sur une facture de son poste »). Microsoft Graph
    // simulé : la boîte du jeton est son adresse.
    test('envoi d’un avoir par elle : le sien (partiel et total) et celui de l’administration sur sa facture, par la messagerie et par Microsoft 365 (PDF joint), notés à son nom et lus par l’administration ; l’ancien refus d’AT-3 n’est plus servi ; l’avoir d’une facture de l’administration reste introuvable (404) sans écriture ni appel à Graph', async () => {
      const at = par('AT');
      const facture = await factureEmise(at, 'envoi des avoirs', LIGNES_SOLDE);
      const sonAvoir = await avoirCree(facture.id, AVOIR_TROP_PERCU, at);
      const avoirAdmin = await avoirCree(facture.id, [ligne('avoir de l’administration à envoyer', 1, 3, 20)], par('AD'));
      const annulee = await factureEmise(at, 'envoi de l’avoir total', LIGNES_SOLDE);
      const avoirTotal = (await ok(annuler(annulee.id, at))).avoir;
      const jetonMicrosoft = `TEST-AT4-${randomBytes(12).toString('hex')}`;
      graph.boites.set(jetonMicrosoft, comptes.AT.email);
      graph.vider();
      for (const [quoi, piece] of [['son avoir partiel', sonAvoir], ['l’avoir de l’administration', avoirAdmin], ['son avoir total', avoirTotal]]) {
        const lu = await ok(appeler('get', `/factures/${piece.id}/envois`, null, at));
        assert.equal(lu.proposition.microsoft365, true, `${quoi} : Microsoft 365 proposé`);
        const destinataire = `compta.${randomBytes(3).toString('hex')}@client-at4.test`;
        const parMessagerie = await appeler('post', `/factures/${piece.id}/envois`, { destinataire, canal: 'MESSAGERIE' }, at);
        assert.equal(parMessagerie.status, 201, `${quoi}, messagerie : ${JSON.stringify(parMessagerie.body)}`);
        assert.notEqual(parMessagerie.body?.error, REFUS.envoiAvoirAt3);
        const parMicrosoft = await request(app).post(`/api/factures/${piece.id}/envois`).set(at).set('X-Jeton-Microsoft', jetonMicrosoft).send({ destinataire, canal: 'MICROSOFT_365' });
        assert.equal(parMicrosoft.status, 201, `${quoi}, Microsoft 365 : ${JSON.stringify(parMicrosoft.body)}`);
        const notes = await prisma.envoiDocument.findMany({ where: { factureId: piece.id }, orderBy: { createdAt: 'asc' } });
        assert.deepEqual(notes.map((e) => [e.canal, e.destinataire, e.auteurId, e.auteurNom]), [['MESSAGERIE', destinataire, comptes.AT.id, comptes.AT.name], ['MICROSOFT_365', destinataire, comptes.AT.id, comptes.AT.name]], quoi);
        assert.equal(notes[1].expediteur, comptes.AT.email, `${quoi} : expéditeur, sa boîte`);
        const envoi = graph.requetes('envoi').at(-1);
        assert.deepEqual([envoi.jeton, envoi.json.message.toRecipients[0].emailAddress.address, envoi.json.message.attachments[0].name, envoi.json.message.attachments[0].contentType], [jetonMicrosoft, destinataire, `${piece.numero}.pdf`, 'application/pdf'], quoi);
        assert.equal(Buffer.from(envoi.json.message.attachments[0].contentBytes, 'base64').subarray(0, 5).toString('latin1'), '%PDF-', `${quoi} : PDF joint`);
        const luParAdministration = await ok(appeler('get', `/factures/${piece.id}/envois`, null, par('AD')));
        assert.deepEqual(luParAdministration.envois.map((e) => e.auteurNom), [comptes.AT.name, comptes.AT.name], `${quoi} : lu par l’administration`);
      }
      // L'avoir d'une facture de l'administration : 404 par les deux canaux, sans écriture ni appel à Graph.
      const administration = await factureEmise(par('AD'), 'envoi, administration', LIGNES_SOLDE);
      const avoirHorsPoste = await avoirCree(administration.id, AVOIR_TROP_PERCU, par('AD'));
      const envoisAvant = graph.requetes('envoi').length;
      await refuse(() => appeler('post', `/factures/${avoirHorsPoste.id}/envois`, { destinataire: 'client@at4.test', canal: 'MESSAGERIE' }, at), 404, REFUS.introuvable, 'avoir hors de son poste, messagerie');
      await refuse(() => request(app).post(`/api/factures/${avoirHorsPoste.id}/envois`).set(at).set('X-Jeton-Microsoft', jetonMicrosoft).send({ destinataire: 'client@at4.test', canal: 'MICROSOFT_365' }), 404, REFUS.introuvable, 'avoir hors de son poste, Microsoft 365');
      assert.equal(graph.requetes('envoi').length, envoisAvant, 'aucun courriel parti');
    });

    // Cadrage v2, § 1, « Refus d'une seconde facture au temps passé » (choix par défaut 7 d'AT-3, modifié, à confirmer) ; T1
    // (« nouveau texte, sans numéro ») ; C3 du contrôle de mode 1. Le refus lui dit d'annuler elle-même une facture émise de son
    // poste : elle l'annule, puis refait la facture au temps passé ; une facture de l'administration, absente de sa liste, lui
    // répond 404. L'administration garde le message qui cite les numéros.
    test('facture au temps passé : seconde facture refusée à elle au nouveau texte, sans numéro (brouillon, émise, facture de l’administration) ; elle annule sa facture émise par l’avoir total et la refait ; celle de l’administration lui reste introuvable (404) ; l’administration lit les numéros', async () => {
      const reglages = await prisma.parametres.findUnique({ where: { id: 'singleton' }, select: { pasTempsPasseMinutes: true, tempsMinimumMinutes: true } });
      await ok(appeler('put', '/parametres', { pasTempsPasseMinutes: 15, tempsMinimumMinutes: 60 }));
      const mainOeuvre = await ok(appeler('post', '/catalogue/prestations', { estMainOeuvre: true, reference: `TEST-AT4-MO-${suffixe()}`, nom: `TEST Main d’œuvre AT-4 ${suffixe()}`, tauxTva: '20', prixVenteHt: '50', prixJourHorsContratHt: '320', prixHeureSousContratHt: '40', prixJourSousContratHt: '280', heuresParJour: '7' }), 201);
      const fiche = await prisma.intervenant.create({ data: { nom: `TEST AT-4 technicien ${suffixe()}`, role: 'Technicien', tauxHoraireCharge: 40 } });
      const chaine = async (objet) => {
        const devis = await ok(appeler('post', '/devis', { clientId: clientPrincipal.id, objet: `TEST AT-4 temps passé ${objet} ${suffixe()}`, auTempsPasse: true, lignes: [
          { tempsPasse: true, designation: 'TEST AT-4 main d’œuvre au temps passé', quantite: 1, tarifTempsPasse: 'HORS_CONTRAT', catalogueFamille: 'prestations', catalogueId: mainOeuvre.id },
        ] }), 201);
        await ok(appeler('post', `/devis/${devis.id}/signature`, { signataire: `TEST AT-4 signataire ${objet}`, confirme: true }), 201);
        const conversion = await ok(appeler('post', `/devis/${devis.id}/convertir`, { cible: 'INTERVENTION' }), 201);
        await prisma.intervention.update({ where: { id: conversion.id }, data: { statut: 'TERMINEE' } });
        await prisma.coutInterventionHeure.create({ data: { interventionId: conversion.id, intervenantId: fiche.id, date: new Date('2026-10-01T00:00:00Z'), nbrHeures: 1, tauxHoraireApplique: 40, createdById: secours.id } });
        return conversion.id;
      };
      const creerTempsPasse = async (interventionId, auth) => {
        const apercu = await ok(appeler('get', `/interventions/${interventionId}/facture-temps-passe`, null, auth));
        return ok(appeler('post', `/interventions/${interventionId}/facture-temps-passe`, { dateEmission: jour().fr, dateEcheance: jour().fr, totalHtAttendu: apercu.totalHt }, auth), 201);
      };
      const refusTempsPasse = async (interventionId, quoi, numerosAbsents = []) => {
        const apercu = await refuse(() => appeler('get', `/interventions/${interventionId}/facture-temps-passe`, null, par('AT')), 409, REFUS.tempsPasseAt, `${quoi} : aperçu`);
        const creation = await refuse(() => appeler('post', `/interventions/${interventionId}/facture-temps-passe`, { dateEmission: jour().fr, dateEcheance: jour().fr, totalHtAttendu: 50 }, par('AT')), 409, REFUS.tempsPasseAt, `${quoi} : création`);
        for (const numero of numerosAbsents) for (const res of [apercu, creation]) assert.ok(!res.body.error.includes(numero), `${quoi} : sans le numéro ${numero}`);
      };
      try {
        const sienne = await chaine('sienne');
        const premiere = await creerTempsPasse(sienne, par('AT'));
        assert.deepEqual([premiere.creeParType, premiere.tempsPasse, premiere.statut], [ROLE_AT, true, 'BROUILLON']);
        await refusTempsPasse(sienne, 'brouillon');
        const emise = await emettre(premiere.id, par('AT'));
        await refusTempsPasse(sienne, 'émise', [emise.numero]);
        assert.notEqual(REFUS.tempsPasseAt, REFUS.tempsPasseAt3, 'le texte d’AT-3 est remplacé');
        // Elle suit le refus : annulation par l'avoir total, puis la facture au temps passé se refait.
        const annulation = await ok(annuler(premiere.id, par('AT')));
        assert.equal(annulation.statut, 'ANNULEE');
        const refaite = await creerTempsPasse(sienne, par('AT'));
        assert.deepEqual([refaite.creeParType, refaite.statut, nombres([refaite.totalHt])[0]], [ROLE_AT, 'BROUILLON', Number(premiere.totalHt)]);
        // Refaite et émise, puis corrigée par un avoir partiel : elle ne s'annule plus en totalité, comme le dit le refus.
        const refaiteEmise = await emettre(refaite.id, par('AT'));
        await avoirCree(refaite.id, [ligne('correction de la facture au temps passé', 1, 5, 20)], par('AT'));
        await refuse(() => annuler(refaite.id, par('AT')), 409, REFUS.avoirsPartiels, 'refaite, avec un avoir partiel');
        await refusTempsPasse(sienne, 'refaite, avec un avoir partiel', [refaiteEmise.numero]);
        // Facture de l'administration sur une autre chaîne : même refus, sans son numéro ; elle ne la trouve pas.
        const autre = await chaine('de l’administration');
        const administration = await creerTempsPasse(autre, par('AD'));
        const administrationEmise = await emettre(administration.id, par('AD'));
        await refusTempsPasse(autre, 'facture de l’administration', [administrationEmise.numero]);
        await refuse(() => annuler(administration.id, par('AT')), 404, REFUS.introuvable, 'facture de l’administration : annulation');
        await refuse(() => avoir(administration.id, [ligne('correction', 1, 5, 20)], par('AT')), 404, REFUS.introuvable, 'facture de l’administration : avoir');
        // L'administration garde le message qui cite les numéros.
        const parAdministration = await appeler('get', `/interventions/${autre}/facture-temps-passe`, null, par('AD'));
        assert.equal(parAdministration.status, 409);
        assert.ok(parAdministration.body.error.includes(`(${administrationEmise.numero})`), parAdministration.body.error);
      } finally {
        await ok(appeler('put', '/parametres', { pasTempsPasseMinutes: reglages?.pasTempsPasseMinutes ?? '', tempsMinimumMinutes: reglages?.tempsMinimumMinutes ?? '' }));
      }
    });

    // T2 du contrôle de mode 1 ; cadrage v2, § 2 ; réponses 2, 3 et 4 du 09-11-2026 ; critère 5. Chaque origine porte une seule
    // situation. La réponse est lue par elle et par l'administration : la même, réduite à la seule clé.
    test('repère « déjà facturée » vrai : brouillon de l’administration, de l’autre assistante, facture émise par elle, réglée, de contrat, facture créditée en entier par des avoirs partiels, origine annulée après sa facture ; même réponse pour elle et pour l’administration, réduite à { dejaFacturee: true }', async () => {
      const at = par('AT'); const ad = par('AD'); const at2 = par('AT2');
      const facturer = (auth, motif, champ, id, origine) => brouillon(auth, motif, LIGNES_SOLDE, { origine: { origine, [champ]: id } });
      const cas = [];
      // Affaire : brouillon de l'administration (réponse 2 : « Brouillon, émise ou réglée »).
      const c1 = await chantier('repère, brouillon de l’administration');
      await facturer(ad, 'brouillon admin', 'chantierId', c1.id, 'CHANTIER');
      cas.push(['affaire, brouillon de l’administration', 'CHANTIER', c1.id]);
      // Affaire : facture émise par elle.
      const c2 = await chantier('repère, émise par elle');
      await emettre((await facturer(at, 'émise elle', 'chantierId', c2.id, 'CHANTIER')).id, at);
      cas.push(['affaire, émise par elle', 'CHANTIER', c2.id]);
      // Affaire : facture de l'autre assistante, réglée par l'administration.
      const c3 = await chantier('repère, réglée');
      const reglee = await emettre((await facturer(at2, 'réglée', 'chantierId', c3.id, 'CHANTIER')).id, at2);
      await regler(reglee.id, 148.14);
      assert.equal((await prisma.facture.findUniqueOrThrow({ where: { id: reglee.id } })).statut, 'REGLEE');
      cas.push(['affaire, réglée, de l’autre assistante', 'CHANTIER', c3.id]);
      // Intervention : brouillon de l'autre assistante.
      const i1 = await intervention('repère, brouillon de l’autre assistante');
      await facturer(at2, 'brouillon autre', 'interventionId', i1.id, 'INTERVENTION');
      cas.push(['intervention, brouillon de l’autre assistante', 'INTERVENTION', i1.id]);
      // Contrat : facture émise par l'administration.
      const k1 = await contrat('repère, contrat facturé');
      await emettre((await facturer(ad, 'contrat', 'contratMaintenanceId', k1.id, 'CONTRAT')).id, ad);
      cas.push(['contrat, émise par l’administration', 'CONTRAT', k1.id]);
      // Intervention : facture créditée en entier par ses avoirs partiels (décision 4, lecture retenue) : « réglée » depuis le lot
      // « Statut d'une facture couverte par des avoirs » ; elle compte toujours pour le repère.
      const i2 = await intervention('repère, créditée en entier');
      const creditee = await emettre((await facturer(at, 'créditée', 'interventionId', i2.id, 'INTERVENTION')).id, at);
      await avoirCree(creditee.id, AVOIR_SOLDE, at);
      await avoirCree(creditee.id, [ligne('solde par avoir', 1, 83.33, 20)], par('AD'));
      assert.deepEqual(await soldes(creditee.id, ad), ['REGLEE', 148.14, 0, 0], 'créditée en entier, réglée par ses avoirs');
      cas.push(['intervention, créditée en entier par des avoirs partiels', 'INTERVENTION', i2.id]);
      // Affaire annulée après sa facture : sa facture vivante compte.
      const c4 = await chantier('repère, annulée après sa facture');
      await emettre((await facturer(ad, 'avant annulation', 'chantierId', c4.id, 'CHANTIER')).id, ad);
      await prisma.chantier.update({ where: { id: c4.id }, data: { statut: 'ANNULE', annuleLe: new Date(), annuleParId: secours.id, motifAnnulation: 'TEST AT-4 annulée après sa facture' } });
      cas.push(['affaire annulée après sa facture', 'CHANTIER', c4.id]);
      const avant = await empreinte();
      for (const [quoi, origine, id] of cas) {
        for (const [qui, auth] of [['elle', at], ['l’administration', ad]]) {
          const res = await repere(origine, id, auth);
          assert.equal(res.status, 200, `${quoi}, par ${qui} : ${JSON.stringify(res.body)}`);
          assert.deepEqual(res.body, { dejaFacturee: true }, `${quoi}, par ${qui}`);
          assert.deepEqual(Object.keys(res.body), ['dejaFacturee'], `${quoi} : ni montant, ni numéro, ni nombre`);
        }
      }
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], 'le repère n’écrit rien');
    });

    test('repère « déjà facturée » faux : affaire dont la seule facture est annulée (avoir total seul vivant), origine sans facture, affaire annulée sans facture, intervention rattachée à une affaire facturée, visite d’un contrat facturé, affaire d’une intervention facturée, contrat d’une visite facturée : { dejaFacturee: false } ; l’affaire facturée demandée comme intervention ou contrat, introuvable (404)', async () => {
      const at = par('AT'); const ad = par('AD');
      const facturer = (auth, motif, champ, id, origine) => brouillon(auth, motif, LIGNES_SOLDE, { origine: { origine, [champ]: id } });
      const cas = [];
      // Affaire dont la seule facture est annulée par son avoir total (réponse 2 : « Une facture annulée par son avoir total ne
      // compte plus ») : l'avoir total, de même origine, est la seule pièce vivante, et un avoir ne compte pas (type AVOIR).
      const c5 = await chantier('repère, facture annulée');
      const annulee = await emettre((await facturer(ad, 'annulée', 'chantierId', c5.id, 'CHANTIER')).id, ad);
      const avoirTotal = (await ok(annuler(annulee.id, ad))).avoir;
      assert.deepEqual([avoirTotal.origine, avoirTotal.chantierId, avoirTotal.statut], ['CHANTIER', c5.id, 'EMISE'], 'l’avoir total porte l’origine');
      cas.push(['affaire dont la seule facture est annulée', 'CHANTIER', c5.id]);
      // Origine sans facture.
      const c6 = await chantier('repère, sans facture');
      cas.push(['affaire sans facture', 'CHANTIER', c6.id]);
      const i3 = await intervention('repère, sans facture');
      cas.push(['intervention sans facture', 'INTERVENTION', i3.id]);
      const k2 = await contrat('repère, sans facture');
      cas.push(['contrat sans facture', 'CONTRAT', k2.id]);
      const c7 = await chantier('repère, annulée sans facture', { statut: 'ANNULE', annuleLe: new Date(), annuleParId: secours.id, motifAnnulation: 'TEST AT-4 annulée sans facture' });
      cas.push(['affaire annulée sans facture', 'CHANTIER', c7.id]);
      // Même origine seulement (réponse 3) : la facture de l'affaire ne marque pas son intervention rattachée…
      const c8 = await chantier('repère, affaire facturée');
      await emettre((await facturer(at, 'affaire', 'chantierId', c8.id, 'CHANTIER')).id, at);
      const rattachee = await intervention('repère, rattachée à l’affaire facturée', { chantierId: c8.id });
      assert.equal(rattachee.chantierId, c8.id);
      cas.push(['intervention rattachée à une affaire facturée', 'INTERVENTION', rattachee.id]);
      // … ni la facture d'une intervention rattachée son affaire ;
      const c9 = await chantier('repère, affaire d’une intervention facturée');
      const facturee = await intervention('repère, intervention facturée de l’affaire', { chantierId: c9.id });
      await emettre((await facturer(at, 'intervention de l’affaire', 'interventionId', facturee.id, 'INTERVENTION')).id, at);
      cas.push(['affaire d’une intervention facturée', 'CHANTIER', c9.id]);
      // … ni la facture d'un contrat ses visites, ni celle d'une visite son contrat.
      const k3 = await contrat('repère, contrat facturé');
      await emettre((await facturer(ad, 'contrat', 'contratMaintenanceId', k3.id, 'CONTRAT')).id, ad);
      const visite = await ok(appeler('post', `/contrats-maintenance/${k3.id}/generer-intervention`), 201);
      assert.equal(visite.contratMaintenanceId, k3.id);
      cas.push(['visite d’un contrat facturé', 'INTERVENTION', visite.id]);
      const k4 = await contrat('repère, contrat d’une visite facturée');
      const visiteFacturee = await ok(appeler('post', `/contrats-maintenance/${k4.id}/generer-intervention`), 201);
      await emettre((await facturer(at, 'visite', 'interventionId', visiteFacturee.id, 'INTERVENTION')).id, at);
      cas.push(['contrat d’une visite facturée', 'CONTRAT', k4.id]);
      const avant = await empreinte();
      for (const [quoi, origine, id] of cas) {
        for (const [qui, auth] of [['elle', at], ['l’administration', ad]]) {
          const res = await repere(origine, id, auth);
          assert.equal(res.status, 200, `${quoi}, par ${qui} : ${JSON.stringify(res.body)}`);
          assert.deepEqual(res.body, { dejaFacturee: false }, `${quoi}, par ${qui}`);
        }
      }
      // Témoins : les origines facturées de ces cas répondent vrai.
      for (const [origine, id] of [['CHANTIER', c8.id], ['INTERVENTION', facturee.id], ['CONTRAT', k3.id], ['INTERVENTION', visiteFacturee.id]]) {
        assert.deepEqual((await repere(origine, id, at)).body, { dejaFacturee: true }, `témoin ${origine} ${id}`);
      }
      // Une facture vivante de l'affaire, désignée comme intervention ou comme contrat : ce n'est pas la même origine (404 :
      // aucune intervention ni aucun contrat de cet identifiant).
      for (const origine of ['INTERVENTION', 'CONTRAT']) assert.deepEqual([(await repere(origine, c8.id, at)).status, (await repere(origine, c8.id, at)).body.error], [404, REFUS.origineIntrouvable]);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], 'le repère n’écrit rien');
    });

    // Cadrage v2, § 2 (« Refus : origine absente, HORS_AFFAIRE ou autre valeur, id absent : 400 « Origine invalide. » ; origine
    // inconnue : 404 « Origine introuvable. » »), pour elle et pour l'administration, sans écriture.
    test('repère « déjà facturée », refus : 400 « Origine invalide. » (origine absente, HORS_AFFAIRE, inconnue, en minuscules ; identifiant absent ou vide), 404 « Origine introuvable. » (affaire, intervention ou contrat inconnus), pour elle comme pour l’administration, sans écriture', async () => {
      const affaire = await chantier('repère, refus');
      const avant = await empreinte();
      const invalides = [
        '', `?id=${affaire.id}`, `?origine=HORS_AFFAIRE&id=${affaire.id}`, `?origine=DEVIS&id=${affaire.id}`, `?origine=chantier&id=${affaire.id}`,
        '?origine=CHANTIER', '?origine=CHANTIER&id=', '?origine=INTERVENTION', '?origine=CONTRAT&id=',
      ];
      const introuvables = [`?origine=CHANTIER&id=${randomUUID()}`, `?origine=INTERVENTION&id=${randomUUID()}`, `?origine=CONTRAT&id=${randomUUID()}`];
      for (const auth of [par('AT'), par('AD')]) {
        for (const requete of invalides) {
          const res = await appeler('get', `/factures/deja-facturee${requete}`, null, auth);
          assert.deepEqual([res.status, res.body?.error], [400, REFUS.origineInvalide], requete || '(sans paramètre)');
          assert.equal('dejaFacturee' in res.body, false, requete);
        }
        for (const requete of introuvables) {
          const res = await appeler('get', `/factures/deja-facturee${requete}`, null, auth);
          assert.deepEqual([res.status, res.body?.error], [404, REFUS.origineIntrouvable], requete);
        }
      }
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], 'aucun refus n’écrit');
      // Témoin : l'origine connue, sans facture, répond.
      assert.deepEqual((await repere('CHANTIER', affaire.id, par('AT'))).body, { dejaFacturee: false });
    });
  });
}
