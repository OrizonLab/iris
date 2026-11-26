// Lot « une facture émise à 0,00 € ne bloque plus la facture au temps passé » (#529 ; cadrage v2, contrôlé « prêt à coder » :
// sections « Critères métier observables », « Construction des cas de test » (N3 du contrôle) et « Tests » ; garde en base, R1 du
// contrôle ; montants classés C).
//
// Décision appliquée : réponse de Nelson du 16-11-2026, mot pour mot, à la question « Facture émise à 0,00 € (issue #529) : depuis
// ta décision du 10-11, elle ne s'annule plus et ne reçoit pas d'avoir. Elle compte pourtant comme « déjà facturée » et bloque à
// jamais la facture au temps passé de son intervention. Que faire ? » : « Ne bloque pas (Recommandé) ». Description de l'option
// (texte de Claude Code ; seul le choix est de Nelson) : « Une facture émise à 0,00 € ne compte ni comme « déjà facturée » ni comme
// obstacle à la facture au temps passé : elle reste visible et figée, mais n'empêche plus de facturer les heures. »
//
// Règle éprouvée (cadrage, § 1 et 1 bis) : FACTURE_VIVANTE (factures/repere.ts) et le prédicat de l'index unique partiel
// « Facture_temps_passe_unique » (migration 20261116200000_facture_zero_temps_passe) excluent, en plus des factures annulées, les
// factures de statut EMISE ou REGLEE dont le TTC vaut exactement 0 (égalité en décimal, comme le refus de l'annulation). Un brouillon
// à 0,00 € compte toujours ; une facture à 0,01 € aussi. Choix par défaut, à confirmer (cadrage) : « émise » couvre aussi REGLEE.
//
// Contrat éprouvé (messages inchangés par le lot, comparés au texte exact : sans cela, le 409 de l'index masquerait les mutants
// « brouillon exclu » et « ≤ 0,01 », qui laissent passer l'API puis butent sur l'index) :
//  - administration (super administrateur, administrateur, directeur) : « Cette intervention ou l’une de ses suites a déjà une
//    facture (<numéros ou « brouillon »>) : la facture au temps passé est unique. … » ; la facture à 0,00 € n'y est plus citée ;
//  - assistante technique : le texte fixe d'AT-4, sans numéro ;
//  - index (création concurrente) : « Cette intervention a déjà une facture au temps passé. » ; il ne doit jamais être servi ici.
//
// Construction des cas (cadrage, N3 du contrôle) :
//  - cas réels, par l'API : main d'œuvre du catalogue à 0 € de l'heure (admise), ou à 0,01 € de l'heure avec le minimum de
//    15 minutes figé sur le devis (0,25 h × 0,01 € = 0,0025 €, arrondi à 0,00 €) ; devis au temps passé signé et converti ; heures
//    saisies par le technicien affecté (POST …/couts/heures) ; intervention terminée par l'API (compte rendu, motif sans signature) ;
//    facture au temps passé (totalHtAttendu 0 admis) puis émission à 0,00 € ; facture émise à 0,01 € : 1 h à 0,01 €/h ; nouvelle
//    facture positive : heures ajoutées sur l'intervention terminée (admis) ;
//  - facture à 0,00 € sur une suite : impossible par l'API (une facture saisie ligne par ligne y est refusée, une suite ne reçoit
//    pas de facture au temps passé). Elle est construite par une FIXTURE ÉCRITE EN BASE, déclarée THÉORIQUE (règle 4 : aucune donnée
//    réelle ne la porte) : un brouillon `tempsPasse = false` écrit comme le ferait POST /api/factures, puis émis par l'API
//    (POST /api/factures/:id/emettre) ;
//  - gardes en SQL de l'index, dans des transactions annulées (rien n'est écrit) ;
//  - une facture REGLEE à 0,00 € ne se construit pas (refus « déjà soldée » de l'API, gardes `verifier_affectation_reglement` et
//    `verifier_statut_facture_reglements`, prouvés ici) : le mutant « REGLEE non exclue » est équivalent (cadrage, N2 du contrôle).
//
// Mutants que ce fichier doit tuer (cadrage, « Tests ») : exclusion retirée du filtre ; brouillon exclu (toute facture à 0,00 €) ;
// égalité devenue « ≤ 0,01 » ; exclusion retirée de l'index seul (migration). Chaque refus est prouvé sans écriture (empreinte de
// toute la base) ; la facture à 0,00 € est relue à l'identique (ligne, lignes, ventilation, écritures, journal, PDF, liste).
//
// Montants (classés C : CLAUDE.md, « un test manquant qui touche un montant ») : chaque attendu est écrit en dur, recalculé par le
// témoin en décimal exact (BigInt, hors de l'application) dans le premier test, et chaque lecture plausible écartée y est calculée
// et vérifiée distincte de l'attendu ; la lecture écartée est aussi écrite en commentaire à côté de chaque attendu.
//
// Lot Z (réponse de Nelson du 23-11-2026, mot pour mot : « les heures sur une intervention Passe au quart d'heure » ; cadrage v2 du
// lot Z, « Tests », « À adapter, montants ») : les heures saisies par le technicien se saisissent au quart d'heure, et les saisies
// d'avant (0,20 h, 2,10 h, 1,60 h, 0,60 h) sont refusées. Elles deviennent 0,25 h, 1,75 h et 1,25 h. Avec un pas de 15 minutes, des
// saisies au quart d'heure tombent toujours sur le pas : l'arrondi au pas au-delà du minimum n'y joue plus. Les trois scénarios qui
// l'éprouvent (nouvelle facture, suite, minimum réappliqué) figent donc un pas de 45 minutes sur leur devis, le seul des pas où
// l'arrondi au pas joue encore (30, 45 ou 60 minutes) qui, au-delà du minimum de 15 minutes et à 0,01 € l'heure, tombe sur un
// demi-centime (2,5 h → 0,025 €), si bien que l'arrondi commercial reste départagé de l'arrondi au pair et de la troncature (le pas
// de 15 minutes en donne aussi, 0,5 h → 0,005 €, mais l'arrondi au pas n'y joue plus : #676, N2 de l'audit des montants de #675).
// Chaque scénario garde ce qu'il éprouve : facture à 0,00 € au minimum (0,25 h, le minimum atteint) ; nouvelle facture arrondie au
// pas, au-delà du minimum, au prix, au minimum et au pas figés ; heures de la suite comptées ; minimum figé réappliqué sur la seconde
// facture, au pas et à la TVA figés.
//
// Relèvement au minimum (#676, N1 de l'audit des montants de #675 ; cadrage du lot AF, § 2, N6 de son contrôle de mode 1) : depuis le
// lot Z, la facture à 0,00 € saisit 0,25 h, le minimum exact, et n'éprouve plus le relèvement d'une saisie inférieure au minimum. Un
// cas dédié le rétablit sans toucher H_ZERO, qui sert aux autres scénarios : 0 h saisie avec motif, sur une nouvelle intervention,
// facturée au minimum de 15 minutes (0,25 h, 0,00 €). Il vérifie la quantité facturée, et non le seul montant (à 0,01 € l'heure, 0 et
// 15 minutes donnent tous deux 0,00 €) : le mutant T4 (minimum non appliqué sous le seuil, 0 h facturée) est tué par ce fichier aussi,
// et plus seulement par le bloc « Facture au temps passé » d'api.test.mjs.
//
// Comme les fichiers récents (taux-horaire-et-cloture.test.mjs), ce fichier crée sur le serveur de TEST_DATABASE_URL une base
// jetable qui n'appartient qu'à lui (« test » comme mot, suffixe tiré au hasard), la migre (`prisma migrate deploy`), la sert à
// l'application montée en mémoire, puis la supprime (#552 : suppression retentée, connexion administrative toujours fermée dans un
// `finally`). Sans TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { PDFParse } from 'pdf-parse';
import { empreinteBase, tablesChangees, tablesDeLaBase } from './matrice-droits/outils.mjs';

const TITRE = 'Facture émise à 0,00 € : elle ne compte plus comme « déjà facturée » ni comme obstacle à la facture au temps passé ; un brouillon à 0,00 € et une facture à 0,01 € comptent toujours (#529)';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROLE_AT = 'ASSISTANTE_TECHNIQUE';
const ADMINISTRATION = ['SA', 'AD', 'DIR'];
const AUTRES_TYPES = [
  ['CT', 'CONDUCTEUR_TRAVAUX'], ['RESP', 'RESPONSABLE'], ['TECH', 'TECHNICIEN'], ['COM', 'COMMERCIAL'],
  ['DC', 'DIRECTEUR_COMMERCIAL'], ['AC', 'ASSISTANTE_COMMERCIALE'], ['CPT', 'COMPTABLE'],
];

// Messages exacts de l'API (apostrophes typographiques), inchangés par le lot.
const REFUS = {
  tempsPasseAdministration: (numeros) => `Cette intervention ou l’une de ses suites a déjà une facture (${numeros}) : la facture au temps passé est unique. Pour la refaire, annulez d’abord la facture émise par son avoir total (un brouillon s’émet d’abord) ; une facture qui a reçu un avoir partiel, ou un règlement qui n’est pas contre-passé, ne s’annule plus en totalité et se corrige par des avoirs partiels.`,
  tempsPasseAt: 'Cette intervention ou l’une de ses suites a déjà une facture : la facture au temps passé est unique. Un brouillon s’émet d’abord. Pour refaire une facture émise de votre poste, annulez-la d’abord par son avoir total ; une facture qui a reçu un avoir partiel, ou un règlement qui n’est pas contre-passé, ne s’annule plus en totalité et se corrige par des avoirs partiels. Si la facture n’apparaît pas dans votre liste, adressez-vous à l’administration.',
  index: 'Cette intervention a déjà une facture au temps passé.',
  gestion: 'Accès réservé à l’administration et à l’assistante technique.',
  annulationZero: 'Une facture à 0,00 € ne s’annule pas : Iris n’émet pas d’avoir à 0,00 €. Elle reste émise, sans rien à payer.',
  dejaSoldee: (numero) => `La facture ${numero} est déjà soldée (reste dû 0,00 €) : elle ne reçoit plus de règlement.`,
};
// Messages exacts des gardes en base (statut « réglée »), qui rendent le mutant « REGLEE non exclue » équivalent.
const GARDE = {
  regleeCreee: 'Une facture n’est jamais créée « réglée » : elle le devient par ses règlements ou ses avoirs partiels.',
  regleeNonSoldee: 'Une facture ne passe à « réglée » que soldée par ses règlements ou ses avoirs partiels.',
  affectationSoldee: (id) => `Seule une facture émise non soldée reçoit un règlement : la facture ${id} est soldée.`,
};

// --- Témoin en décimal exact, hors de l'application ---
// Règle de la facture au temps passé (factures/tempsPasse.ts, inchangée par le lot) : heures non archivées de l'intervention et de
// ses suites non annulées, additionnées ; au moins le plancher figé du devis, puis toute tranche du pas commencée ; quantité en
// heures au millième (moitié vers le haut) ; HT de ligne au centime, moitié vers le haut (arrondiCommercialLigneHt) ; TVA sur la
// base HT cumulée du taux, moitié vers le haut ; TTC de ligne arrondi au centime.
const exact = {
  unites: (valeur, decimales) => {
    const [entier, fraction = ''] = String(valeur).split('.');
    return BigInt(entier) * 10n ** BigInt(decimales) + BigInt((fraction + '0'.repeat(decimales)).slice(0, decimales) || '0');
  },
  // Heures en centièmes → minutes facturées (entières ici : plancher et pas en minutes entières).
  minutesFacturees: (centiemesHeure, plancher, pas) => {
    const centiMinutes = centiemesHeure * 60n;
    const p = BigInt(plancher) * 100n; const s = BigInt(pas) * 100n;
    if (centiMinutes <= p) return BigInt(plancher);
    return BigInt(plancher) + ((centiMinutes - p + s - 1n) / s) * BigInt(pas);
  },
  // Lecture écartée : tranches du pas arrondies au plus proche (et non commencées) au-delà du plancher.
  minutesAuPlusProche: (centiemesHeure, plancher, pas) => {
    const centiMinutes = centiemesHeure * 60n;
    const p = BigInt(plancher) * 100n; const s = BigInt(pas) * 100n;
    if (centiMinutes <= p) return BigInt(plancher);
    return BigInt(plancher) + ((2n * (centiMinutes - p) + s) / (2n * s)) * BigInt(pas);
  },
  milliemesHeure: (minutes) => (minutes * 2000n + 60n) / 120n,
  // Produit quantité (millièmes d'heure) × prix (centimes) : millièmes de centime. Lectures de l'arrondi au centime.
  arrondi: (p) => (p + 500n) / 1000n,
  tronque: (p) => p / 1000n,
  superieur: (p) => (p + 999n) / 1000n,
  auPair: (p) => { const base = p / 1000n; const reste = p % 1000n; return reste > 500n || (reste === 500n && base % 2n === 1n) ? base + 1n : base; },
  tva: (htCentimes, taux) => (htCentimes * BigInt(taux) + 50n) / 100n,
  tvaTronquee: (htCentimes, taux) => (htCentimes * BigInt(taux)) / 100n,
  ttcLigne: (htCentimes, taux) => (htCentimes * (100n + BigInt(taux)) + 50n) / 100n,
};
// Facture d'un devis à une seule ligne au temps passé : `heures` saisies (texte décimal), grille et prix figés du devis.
const factureTempsPasse = (heures, { plancher = 15, pas = 15, prix = '0.01', taux = 20, arrondi = exact.arrondi } = {}) => {
  const centiemes = heures.reduce((somme, h) => somme + exact.unites(h, 2), 0n);
  const minutes = exact.minutesFacturees(centiemes, plancher, pas);
  const milliemes = exact.milliemesHeure(minutes);
  const ht = arrondi(milliemes * exact.unites(prix, 2));
  const tva = exact.tva(ht, taux);
  return { centiemes, minutes, milliemes, ht, tva, ttc: ht + tva, ligneTtc: exact.ttcLigne(ht, taux) };
};
const euros = (centimes) => Number(centimes) / 100;

// --- Jeu de montants (plancher et pas figés sur chaque devis du fichier : 15 minutes, réglages posés avant les devis ; pas de
// 45 minutes sur les devis de la nouvelle facture, de la suite et du minimum réappliqué, lot Z) ---
const PLANCHER = 15; const PAS = 15; const PAS_45 = 45;
// Scénario « 0,01 €/h » (critère « nouvelle facture positive »), devis au pas de 45 min : 0,25 h saisies, facturées 0,25 h
// (minimum atteint), 0,0025 € → 0,00 € ; puis 1,75 h ajoutées sur l'intervention terminée : 2 h = 120 min, au-delà du minimum de
// 105 min, trois tranches de 45 min commencées, facturées 150 min = 2,5 h, 0,025 € → 0,03 € HT, TVA 0,006 € → 0,01 €, TTC 0,04 €.
const H_ZERO = '0.25';
const H_AJOUT = '1.75';
const ATTENDU_ZERO = { quantite: 0.25, ht: 0, tva: 0, ttc: 0 };
const ATTENDU_NOUVELLE = { quantite: 2.5, ht: 0.03, tva: 0.01, ttc: 0.04, ligneTtc: 0.04 };
// Facture émise à 0,01 € (critère « refusée avec une facture émise à 0,01 € ») : 1 h à 0,01 €/h, HT 0,01 €, TVA 0,002 € → 0,00 €,
// TTC 0,01 €.
const H_CENTIME = '1';
const ATTENDU_CENTIME = { quantite: 1, ht: 0.01, tva: 0, ttc: 0.01 };
// Relèvement au minimum (#676, N1), devis au pas de 15 min : 0 h saisie avec motif → 0 min, sous le minimum → 15 min facturées =
// 0,25 h ; 0,25 h × 0,01 € = 0,0025 € → 0,00 € HT, TVA 0,00 €, TTC 0,00 €. Lectures écartées : minimum non appliqué sous le seuil
// (mutant T4 : 0 min, 0 h facturée ; même montant, 0,00 €, d'où la quantité vérifiée) ; zéro heure qui ne compte pas comme une saisie
// (facture refusée faute d'heure) ; arrondi au centime supérieur (0,01 € HT, la facture ne serait pas à 0,00 €).
const H_ZERO_SAISIE = '0';
const MOTIF_ZERO_HEURE = 'TEST zéro TP : déplacement sans travaux, client absent';
const ATTENDU_ZERO_SAISIE = { minutes: 15, quantite: 0.25, ht: 0, tva: 0, ttc: 0 };
// Suite (fixture théorique), devis au pas de 45 min : 0,75 h sur l'intervention, 1,25 h sur sa suite, 2 h = 120 min, facturées
// 15 + 3 × 45 = 150 min = 2,5 h.
const H_SUITE = { intervention: '0.75', suite: '1.25' };
const ATTENDU_SUITE = { quantite: 2.5, ht: 0.03, tva: 0.01, ttc: 0.04, ligneTtc: 0.04 };
// Réglages de la société et prix du catalogue changés après la signature (copie figée), lectures écartées : minimum de 8 h et
// main d'œuvre à 45,50 €/h.
const MINIMUM_APRES_COUP = 480;
const PRIX_APRES_COUP = '45.50';
// Lignes des factures saisies ligne par ligne (repère) : 1 × 0,00 € et 1 × 0,01 € HT à 20 %.
const ligne = (designation, prixUnitaireHt) => ({ designation: `TEST zéro ${designation}`, nature: 'PRESTATION', quantite: 1, prixUnitaireHt, tauxTva: 20 });
const LIGNES_ZERO = [ligne('visite offerte', 0)];
const LIGNES_CENTIME = [ligne('petite fourniture', 0.01)];

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_facture_zero_tp_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;
    const environnementAvant = {};
    const NOMS_ENVIRONNEMENT = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID'];

    let request; let app; let prisma; let appPrisma; let jwt;
    let session = '';
    let secours = null;
    const comptes = {};
    let technicien = null;
    let client = null;
    let mainOeuvreGratuite = null;
    let mainOeuvreCentime = null;
    let cle = null;
    let tables = [];
    let rang = 0;
    const suffixe = () => `${Date.now()}${(rang += 1)}`;

    // --- Appels ---
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const par = (code) => (code === 'SA' ? entete(session) : entete(jwt.sign({ id: comptes[code].id }, process.env.JWT_SECRET)));
    const appeler = (methode, chemin, corps, auth = par('SA')) => {
      const requete = request(app)[methode](`/api${chemin}`);
      const avecAuth = auth ? requete.set(auth) : requete;
      return methode === 'get' ? avecAuth : avecAuth.send(corps ?? {});
    };
    const ok = async (reponse, statut = 200) => {
      const res = await reponse;
      assert.equal(res.status, statut, `${res.req?.method} ${res.req?.path} : ${res.status} ${JSON.stringify(res.body)}`);
      return res.body;
    };
    const jour = () => {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date());
      const v = (type) => parts.find((p) => p.type === type).value;
      return { fr: `${v('day')}-${v('month')}-${v('year')}`, iso: `${v('year')}-${v('month')}-${v('day')}` };
    };
    const nombres = (liste) => liste.map((valeur) => (valeur === null || valeur === undefined ? valeur : Number(valeur)));
    const texteDuPdf = async (reponse) => { const lecteur = new PDFParse({ data: reponse.body }); const contenu = await lecteur.getText(); await lecteur.destroy(); return contenu.text; };

    // --- État de la base ---
    // Empreinte de toute la base (chaque table du schéma public, contenu compris), table des clés (« ApiAccessKey ») comprise : une
    // clé présentée à une route de session est refusée (401) par requireAuth, avant toute lecture ou écriture de sa dernière utilisation.
    const empreinte = () => empreinteBase(prisma, tables);
    const refuse = async (appel, statut, message, quoi) => {
      const avant = await empreinte();
      const res = await appel();
      assert.deepEqual([res.status, res.body?.error], [statut, message], `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.notEqual(res.body?.error, REFUS.index, `${quoi} : le refus de l’index ne doit pas être servi`);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      return res;
    };
    // Photographie d'une pièce et de tout ce qui lui est rattaché, contenu compris (`updatedAt` aussi) : une pièce figée se relit
    // à l'identique.
    const photo = async (id) => {
      const lire = (table, colonne) => prisma.$queryRawUnsafe(`SELECT row_to_json(t)::text AS j FROM "${table}" t WHERE "${colonne}" = $1 ORDER BY 1`, id);
      return {
        facture: await lire('Facture', 'id'),
        lignes: await lire('FactureLigne', 'factureId'),
        ventilation: await lire('FactureVentilationTva', 'factureId'),
        ecritures: await lire('EcritureFacture', 'factureId'),
        journal: await lire('JournalFacture', 'factureId'),
        affectations: await lire('AffectationReglement', 'factureId'),
        envois: await lire('EnvoiDocument', 'factureId'),
        avoirs: await lire('Facture', 'factureOrigineId'),
      };
    };
    const enBase = (id) => prisma.facture.findUniqueOrThrow({ where: { id }, include: {
      lignes: { orderBy: { ordre: 'asc' } }, ventilationTva: { orderBy: { tauxTva: 'asc' } }, ecrituresComptables: { orderBy: { ordre: 'asc' } }, journal: { orderBy: { createdAt: 'asc' } },
    } });
    const montantsEnBase = (piece) => ({
      totaux: nombres([piece.totalHt, piece.totalTva, piece.totalTtc]),
      lignes: piece.lignes.map((l) => [l.ordre, l.nature, ...nombres([l.quantite, l.prixUnitaireHt, l.tauxTva, l.totalHt, l.totalTtc])]),
      ventilation: piece.ventilationTva.map((v) => nombres([v.tauxTva, v.totalHt, v.totalTva, v.totalTtc])),
    });

    // --- Données ---
    const creerCompte = async (code, role) => {
      const s = suffixe();
      comptes[code] = await prisma.user.create({ data: { email: `zero-tp.${code.toLowerCase()}.${s}@iris.test`, name: `TEST zéro TP ${code} ${s}`, role } });
      return comptes[code];
    };
    const mainOeuvre = (prix, nom) => ok(appeler('post', '/catalogue/prestations', {
      estMainOeuvre: true, reference: `TEST-ZERO-TP-${suffixe()}`, nom: `TEST zéro TP ${nom} ${suffixe()}`, tauxTva: '20',
      prixVenteHt: prix, prixJourHorsContratHt: '0', prixHeureSousContratHt: '0', prixJourSousContratHt: '0', heuresParJour: '7',
    }), 201);
    // Devis au temps passé d'une seule ligne (au plancher figé de 15 min), signé et converti en intervention.
    const devisConverti = async (mo, objet, grille = { plancher: PLANCHER, pas: PAS }) => {
      const devis = await ok(appeler('post', '/devis', { clientId: client.id, objet: `TEST zéro TP ${objet} ${suffixe()}`, auTempsPasse: true, lignes: [
        { tempsPasse: true, designation: `TEST zéro TP main d’œuvre ${objet}`, quantite: 0.25, tarifTempsPasse: 'HORS_CONTRAT', catalogueFamille: 'prestations', catalogueId: mo.id },
      ] }), 201);
      const fige = await prisma.devis.findUniqueOrThrow({ where: { id: devis.id }, select: { tempsMinimumMinutes: true, pasTempsPasseMinutes: true, lignes: { select: { prixUnitaireHt: true } } } });
      assert.deepEqual([fige.tempsMinimumMinutes, fige.pasTempsPasseMinutes, fige.lignes.map((l) => l.prixUnitaireHt.toString())], [grille.plancher, grille.pas, [mo.prixVenteHt.toString()]], `${objet} : plancher, pas et prix figés`);
      await ok(appeler('post', `/devis/${devis.id}/signature`, { signataire: `TEST signataire ${objet}`, confirme: true }), 201);
      const intervention = await ok(appeler('post', `/devis/${devis.id}/convertir`, { cible: 'INTERVENTION' }), 201);
      assert.equal(intervention.auTempsPasse, true);
      return { devis, intervention };
    };
    // Le technicien saisit ses heures (affectation posée en base : le planning n'est pas l'objet du lot).
    const affecter = (interventionId) => prisma.interventionAffectation.create({ data: { interventionId, intervenantId: technicien.intervenantId } });
    const saisirHeures = (interventionId, nbrHeures) => ok(appeler('post', `/interventions/${interventionId}/couts/heures`, { date: jour().fr, nbrHeures: Number(nbrHeures) }, technicien.auth), 201);
    // Intervention terminée par l'API : planifiée, commencée, compte rendu, terminée sans signature du client.
    const terminer = async (interventionId) => {
      await ok(appeler('patch', `/interventions/${interventionId}/statut`, { statut: 'PLANIFIEE' }));
      await ok(appeler('patch', `/interventions/${interventionId}/statut`, { statut: 'EN_COURS' }));
      await ok(appeler('post', `/interventions/${interventionId}/rapports`, { contenu: 'TEST compte rendu zéro TP', cleEnvoi: randomUUID() }), 201);
      const fin = await ok(appeler('patch', `/interventions/${interventionId}/statut`, { statut: 'TERMINEE', motifSansSignature: 'CLIENT_ABSENT' }));
      assert.equal(fin.statut, 'TERMINEE');
    };
    const chaine = async (mo, objet, heures, grille) => {
      const { devis, intervention } = await devisConverti(mo, objet, grille);
      await affecter(intervention.id);
      for (const h of heures) await saisirHeures(intervention.id, h);
      await terminer(intervention.id);
      return { devis, intervention };
    };
    const apercu = (id, auth) => appeler('get', `/interventions/${id}/facture-temps-passe`, null, auth);
    const creer = (id, auth, totalHtAttendu) => appeler('post', `/interventions/${id}/facture-temps-passe`, { dateEmission: jour().fr, dateEcheance: jour().fr, totalHtAttendu }, auth);
    // Création admise : l'aperçu lu par son auteur, puis la création au total HT de cet aperçu.
    const creee = async (id, auth) => { const lu = await ok(apercu(id, auth)); return ok(creer(id, auth, lu.totalHt), 201); };
    const emettre = (id, auth) => ok(appeler('post', `/factures/${id}/emettre`, {}, auth));
    const brouillonManuel = (auth, origine, lignes) => ok(appeler('post', '/factures', { clientId: client.id, dateEmission: jour().fr, dateEcheance: jour().fr, lignes, ...origine }, auth), 201);
    const repere = (origine, id, auth) => appeler('get', `/factures/deja-facturee?origine=${origine}&id=${id}`, null, auth);
    // Le repère lu par chaque compte qui y accède : la même réponse, réduite à la clé, sans écriture.
    const repereVaut = async (origine, id, attendu, quoi) => {
      const avant = await empreinte();
      for (const code of [...ADMINISTRATION, 'AT']) {
        const res = await repere(origine, id, par(code));
        assert.equal(res.status, 200, `${quoi}, par ${code} : ${JSON.stringify(res.body)}`);
        assert.deepEqual(res.body, { dejaFacturee: attendu }, `${quoi}, par ${code}`);
      }
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : le repère n’écrit rien`);
    };
    // Refus de la facture au temps passé (création, puis aperçu) : le message de l'administration, qui cite les pièces qui comptent,
    // et le texte fixe de l'assistante technique ; aucune écriture. La création d'abord : c'est elle que l'index garde aussi, et seul
    // le texte exact y distingue le refus de l'API de celui de l'index (mutants « brouillon exclu » et « ≤ 0,01 »). Elle est envoyée
    // au total HT que rendrait l'aperçu (`totalHt`, du témoin) : seule l'unicité peut alors la refuser.
    const refusTempsPasse = async (interventionId, numeros, quoi, totalHt = 0) => {
      for (const code of [...ADMINISTRATION, 'AT']) {
        const message = code === 'AT' ? REFUS.tempsPasseAt : REFUS.tempsPasseAdministration(numeros);
        await refuse(() => creer(interventionId, par(code), totalHt), 409, message, `${quoi} : création par ${code}`);
        await refuse(() => apercu(interventionId, par(code)), 409, message, `${quoi} : aperçu par ${code}`);
      }
    };
    const transactionVerifiee = (rappel) => prisma.$transaction(async (tx) => { const r = await rappel(tx); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return r; });
    const rangDe = (numero) => Number(numero.slice(numero.lastIndexOf('-') + 1));

    before(async () => {
      assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname), 'seul un PostgreSQL local est autorisé');
      assert.notEqual(source.pathname.slice(1), nomBase);
      await administrationPg.connect();
      await administrationPg.query(`CREATE DATABASE "${nomBase}"`);
      baseCreee = true;
      execFileSync(resolve(dossierServeur, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', resolve(dossierServeur, 'prisma/schema.prisma')], {
        env: { ...process.env, DATABASE_URL: cible.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
      });
      for (const nom of NOMS_ENVIRONNEMENT) environnementAvant[nom] = process.env[nom];
      delete process.env.AZURE_TENANT_ID;
      delete process.env.AZURE_CLIENT_ID;
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
      const { PrismaClient } = await import('@prisma/client');
      prisma = new PrismaClient({ datasources: { db: { url: cible.toString() } } });
      jwt = (await import('jsonwebtoken')).default;
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      session = connexion.body.token;
      secours = await prisma.user.findUniqueOrThrow({ where: { email: 'secours@iris.test' }, select: { id: true, role: true } });
      assert.equal(secours.role, 'SUPERADMIN');
      // Identité de la société (signature d'un devis, émission), plan comptable, mentions légales publiées.
      await ok(appeler('put', '/company', { raisonSociale: 'TEST Émetteur zéro TP', siret: '52952952900052', adresse: '9 rue des Heures', codePostal: '14000', ville: 'Caen', fuseauHoraire: 'Europe/Paris' }));
      const compte = (code, libelle, nature) => ok(appeler('post', '/comptabilite/comptes', { code, libelle, nature }), 201);
      const clients = await compte('411000', 'TEST Clients zéro TP', 'ACTIF');
      const prestations = await compte('706000', 'TEST Prestations zéro TP', 'PRODUIT');
      const articles = await compte('707000', 'TEST Articles zéro TP', 'PRODUIT');
      const tva20 = await compte('445710', 'TEST TVA 20 zéro TP', 'TVA');
      const motif = 'TEST paramétrage comptable du lot zéro TP';
      for (const [regle, donnees] of [['CLIENT', { compteId: clients.id }], ['VENTE_PRESTATION', { compteId: prestations.id }], ['VENTE_ARTICLE', { compteId: articles.id }], ['JOURNAL_VENTES', { journal: 'VE' }]]) {
        await ok(appeler('put', `/comptabilite/regles/${regle}`, { ...donnees, motif }));
      }
      await ok(appeler('put', '/comptabilite/tva/20', { compteId: tva20.id, motif }));
      const version = await ok(appeler('post', '/mentions-legales', { mentions: 'TEST mentions zéro TP', cgv: 'TEST CGV zéro TP', penalites: 'TEST pénalités zéro TP' }), 201);
      await ok(appeler('post', `/mentions-legales/${version.version}/publier`));
      // Temps passé : pas et minimum de 15 minutes, figés ensuite sur chaque devis.
      await ok(appeler('put', '/parametres', { pasTempsPasseMinutes: PAS, tempsMinimumMinutes: PLANCHER }));
      mainOeuvreGratuite = await mainOeuvre('0', 'gratuite');
      mainOeuvreCentime = await mainOeuvre('0.01', 'à un centime');
      for (const [code, role] of [['AD', 'ADMIN'], ['DIR', 'DIRECTEUR'], ['AT', ROLE_AT], ...AUTRES_TYPES]) await creerCompte(code, role);
      const compteTechnicien = await creerCompte('TECH-SAISIE', 'TECHNICIEN');
      const intervenant = await prisma.intervenant.create({ data: { nom: `TEST zéro TP technicien ${suffixe()}`, role: 'Technicien', tauxHoraireCharge: 40, userId: compteTechnicien.id } });
      technicien = { auth: par('TECH-SAISIE'), intervenantId: intervenant.id };
      for (let essai = 1; ; essai += 1) {
        const res = await appeler('post', '/clients', { raisonSociale: `TEST Client zéro TP ${suffixe()}`, siren: String(randomInt(100_000_000, 1_000_000_000)) });
        if (res.status === 409 && essai < 5) continue;
        assert.equal(res.status, 201, JSON.stringify(res.body));
        client = res.body;
        break;
      }
      await ok(appeler('post', `/clients/${client.id}/sites`, { nom: 'TEST Facturation zéro TP', adresse: '9 rue des Heures', codePostal: '14000', ville: 'Caen', estSiteFacturation: true }), 201);
      cle = await ok(appeler('post', '/admin/api-keys', { nom: `TEST zéro TP clé ${suffixe()}`, scopes: ['finances:read', 'clients:read'] }), 201);
      tables = await tablesDeLaBase(prisma);
      assert.ok(['Facture', 'FactureLigne', 'JournalFacture', 'EcritureFacture', 'SequenceFacture', 'CoutInterventionHeure'].every((t) => tables.includes(t)) && tables.length > 40, `tables relevées : ${tables.join(', ')}`);
    });

    // #552 : la connexion administrative est fermée même si la suppression de la base échoue ; une connexion de l'application
    // rouverte pendant la suppression la fait échouer : elle est retentée deux fois, puis l'erreur est rapportée.
    after(async () => {
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      for (const nom of NOMS_ENVIRONNEMENT) { if (environnementAvant[nom] === undefined) delete process.env[nom]; else process.env[nom] = environnementAvant[nom]; }
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

    // Règle du rédacteur des tests (montants) : chaque attendu recalculé en décimal exact, hors de l'application, et chaque lecture
    // écartée calculée et distincte de l'attendu.
    test('témoin des montants : factures au temps passé recalculées en décimal exact (0,25 h à 0,01 €/h → 0,00 € ; 0,25 h + 1,75 h au pas de 45 min → 0,03 € HT, 0,01 € de TVA, 0,04 € TTC ; 1 h → 0,01 € TTC ; 0,75 h + 1,25 h de la suite au pas de 45 min → 0,04 € TTC), chaque lecture écartée distincte de l’attendu', () => {
      // Facture à 0,00 € par l'arrondi : 0,25 h (15 min) → minimum de 15 min atteint → 0,25 h × 0,01 € = 0,0025 € → 0,00 €, au pas
      // de 15 min comme au pas de 45 min (le pas ne joue qu'au-delà du minimum).
      const zero = factureTempsPasse([H_ZERO]);
      assert.deepEqual([zero.minutes, zero.milliemes, zero.ht, zero.tva, zero.ttc], [15n, 250n, 0n, 0n, 0n]);
      assert.deepEqual([Number(zero.milliemes) / 1000, euros(zero.ht), euros(zero.tva), euros(zero.ttc)], [ATTENDU_ZERO.quantite, ATTENDU_ZERO.ht, ATTENDU_ZERO.tva, ATTENDU_ZERO.ttc]);
      assert.deepEqual(factureTempsPasse([H_ZERO], { pas: PAS_45 }), zero, 'facture à 0,00 € identique au pas de 45 min');
      // Lecture écartée : arrondi au centime supérieur (0,01 €, la facture ne serait pas à 0,00 €).
      assert.equal(factureTempsPasse([H_ZERO], { arrondi: exact.superieur }).ht, 1n, 'lecture écartée : arrondi au supérieur');

      // Nouvelle facture, devis au pas de 45 min : toutes les heures de l'intervention, celles de la facture à 0,00 € comprises
      // (elle ne compte plus) : 0,25 h + 1,75 h = 2 h = 120 min → 15 min + 3 × 45 min = 150 min = 2,5 h → 0,025 € → 0,03 € HT.
      const nouvelle = factureTempsPasse([H_ZERO, H_AJOUT], { pas: PAS_45 });
      assert.deepEqual([nouvelle.centiemes, nouvelle.minutes, nouvelle.milliemes, nouvelle.ht, nouvelle.tva, nouvelle.ttc, nouvelle.ligneTtc], [200n, 150n, 2500n, 3n, 1n, 4n, 4n]);
      assert.deepEqual([Number(nouvelle.milliemes) / 1000, euros(nouvelle.ht), euros(nouvelle.tva), euros(nouvelle.ttc), euros(nouvelle.ligneTtc)], [ATTENDU_NOUVELLE.quantite, ATTENDU_NOUVELLE.ht, ATTENDU_NOUVELLE.tva, ATTENDU_NOUVELLE.ttc, ATTENDU_NOUVELLE.ligneTtc]);
      const ecartees = {
        // Seules les heures ajoutées après la facture à 0,00 € : 1,75 h = 105 min → 15 + 2 × 45 = 105 min → 0,0175 € → 0,02 €.
        'heures ajoutées seules': factureTempsPasse([H_AJOUT], { pas: PAS_45 }).ht,
        // Quantité de la facture à 0,00 € déduite : 2,5 h − 0,25 h = 2,25 h → 0,0225 € → 0,02 €.
        'facture à 0,00 € déduite': exact.arrondi((nouvelle.milliemes - zero.milliemes) * exact.unites('0.01', 2)),
        // Heures brutes, sans minimum ni pas : 2 h → 0,02 €.
        'heures brutes': exact.arrondi(exact.unites('2', 3) * 1n),
        // Pas le plus proche au lieu du pas commencé : 105 min au-delà du minimum, 2,33 tranches → 2 → 105 min → 0,02 €.
        'pas le plus proche': exact.arrondi(exact.milliemesHeure(exact.minutesAuPlusProche(nouvelle.centiemes, PLANCHER, PAS_45)) * 1n),
        // Minimum ignoré : tranches de 45 min dès la première minute, 120 min → 135 min = 2,25 h → 0,02 €.
        'minimum ignoré': factureTempsPasse([H_ZERO, H_AJOUT], { plancher: 0, pas: PAS_45 }).ht,
        // Arrondi du HT : troncature et arrondi au pair (0,025 € → 0,02 €).
        troncature: factureTempsPasse([H_ZERO, H_AJOUT], { pas: PAS_45, arrondi: exact.tronque }).ht,
        'arrondi au pair': factureTempsPasse([H_ZERO, H_AJOUT], { pas: PAS_45, arrondi: exact.auPair }).ht,
        // Minimum de la société changé après la signature (8 h) au lieu du minimum figé du devis : 8 h → 0,08 €.
        'minimum du jour': factureTempsPasse([H_ZERO, H_AJOUT], { plancher: MINIMUM_APRES_COUP, pas: PAS_45 }).ht,
        // Pas de la société revenu à 15 min après la signature au lieu du pas figé de 45 min : 120 min → 2 h → 0,02 €.
        'pas du jour': factureTempsPasse([H_ZERO, H_AJOUT], { pas: PAS }).ht,
        // Prix du catalogue changé après la signature (45,50 €/h) au lieu du prix figé : 2,5 × 45,50 € = 113,75 €.
        'prix du catalogue du jour': factureTempsPasse([H_ZERO, H_AJOUT], { pas: PAS_45, prix: PRIX_APRES_COUP }).ht,
      };
      assert.deepEqual(ecartees, {
        'heures ajoutées seules': 2n, 'facture à 0,00 € déduite': 2n, 'heures brutes': 2n, 'pas le plus proche': 2n, 'minimum ignoré': 2n, troncature: 2n, 'arrondi au pair': 2n,
        'minimum du jour': 8n, 'pas du jour': 2n, 'prix du catalogue du jour': 11375n,
      });
      for (const [lecture, ht] of Object.entries(ecartees)) assert.notEqual(ht, nouvelle.ht, `lecture écartée « ${lecture} » distincte de l’attendu`);
      // TVA tronquée (0,006 € → 0,00 €, TTC 0,03 €) : écartée.
      assert.equal(exact.tvaTronquee(nouvelle.ht, 20), 0n);
      assert.notEqual(exact.tvaTronquee(nouvelle.ht, 20), nouvelle.tva);

      // Facture émise à 0,01 € : 1 h = 60 min → 1 h → 0,01 € HT, TVA 0,002 € → 0,00 €, TTC 0,01 €. Lectures écartées : TTC ≤ 0,01 €
      // pris pour 0,00 € ; « sans TVA » pris pour une facture nulle ; HT seul comparé (identique ici, 0,01 €, donc non nul).
      const centime = factureTempsPasse([H_CENTIME]);
      assert.deepEqual([centime.milliemes, centime.ht, centime.tva, centime.ttc], [1000n, 1n, 0n, 1n]);
      assert.deepEqual([Number(centime.milliemes) / 1000, euros(centime.ht), euros(centime.tva), euros(centime.ttc)], [ATTENDU_CENTIME.quantite, ATTENDU_CENTIME.ht, ATTENDU_CENTIME.tva, ATTENDU_CENTIME.ttc]);
      assert.notEqual(centime.ttc, 0n, 'une facture à 0,01 € n’est pas à 0,00 €');

      // Suite, devis au pas de 45 min : 0,75 h + 1,25 h = 2 h = 120 min → 150 min = 2,5 h → 0,03 € HT, 0,01 € de TVA, 0,04 € TTC.
      // Lectures écartées : heures de la suite oubliées (0,75 h = 45 min → 15 + 45 = 60 min → 0,01 €) ; heures de l'intervention
      // oubliées (1,25 h = 75 min → 15 + 2 × 45 = 105 min → 0,0175 € → 0,02 €) ; heures brutes (2 h → 0,02 €) ; pas le plus proche
      // (105 min → 0,02 €) ; troncature (0,02 €).
      const suite = factureTempsPasse([H_SUITE.intervention, H_SUITE.suite], { pas: PAS_45 });
      assert.deepEqual([suite.minutes, suite.milliemes, suite.ht, suite.tva, suite.ttc, suite.ligneTtc], [150n, 2500n, 3n, 1n, 4n, 4n]);
      assert.deepEqual([Number(suite.milliemes) / 1000, euros(suite.ht), euros(suite.tva), euros(suite.ttc), euros(suite.ligneTtc)], [ATTENDU_SUITE.quantite, ATTENDU_SUITE.ht, ATTENDU_SUITE.tva, ATTENDU_SUITE.ttc, ATTENDU_SUITE.ligneTtc]);
      const ecarteesSuite = [
        factureTempsPasse([H_SUITE.intervention], { pas: PAS_45 }).ht,
        factureTempsPasse([H_SUITE.suite], { pas: PAS_45 }).ht,
        exact.arrondi(exact.unites('2', 3)),
        exact.arrondi(exact.milliemesHeure(exact.minutesAuPlusProche(suite.centiemes, PLANCHER, PAS_45)) * 1n),
        factureTempsPasse([H_SUITE.intervention, H_SUITE.suite], { pas: PAS_45, arrondi: exact.tronque }).ht,
      ];
      assert.deepEqual(ecarteesSuite, [1n, 2n, 2n, 2n, 2n]);
      for (const ht of ecarteesSuite) assert.notEqual(ht, suite.ht);
    });

    // Critères « Facture au temps passé » et « La facture à 0,00 € n'est ni modifiée ni annulée par la création », sur le cas réel à
    // 0 € de l'heure (main d'œuvre gratuite admise). Lectures écartées : la règle d'avant (toute facture non annulée bloque : création
    // refusée) ; une facture à 0,00 € quel que soit son statut (le brouillon à 0,00 € ne bloquerait plus : création admise, ou refus
    // de l'index au lieu du message de l'API).
    test('main d’œuvre à 0 €/h : brouillon à 0,00 € de l’assistante technique bloquant (messages exacts, pour l’administration et pour elle), émis à 0,00 €, puis nouvelle facture admise ; la facture à 0,00 € relue à l’identique (base, PDF, liste), toujours non annulable ; suite de factures numérotées à 0,00 € (N5)', async () => {
      const { devis, intervention } = await chaine(mainOeuvreGratuite, '0 €/h', ['2']);
      // Aperçu : 2 h saisies, facturées 2 h (plancher 15 min, tranches de 15 min), 0,00 €.
      const lu = await ok(apercu(intervention.id, par('AT')));
      assert.deepEqual([lu.heures.saisies, lu.heures.facturees, lu.totalHt, lu.totalTva, lu.totalTtc], [2, 2, 0, 0, 0]);
      assert.deepEqual(await ok(apercu(intervention.id, par('AD'))), lu, 'même aperçu pour l’administration');
      const premiere = await creee(intervention.id, par('AT'));
      assert.deepEqual([premiere.statut, premiere.tempsPasse, premiere.creeParType, ...nombres([premiere.totalHt, premiere.totalTva, premiere.totalTtc])], ['BROUILLON', true, ROLE_AT, 0, 0, 0]);
      // Brouillon à 0,00 € : il compte (il n'est pas émis). Lecture écartée : « toute facture à 0,00 € » (brouillon exclu).
      await refusTempsPasse(intervention.id, 'brouillon', 'brouillon à 0,00 €');
      await repereVaut('INTERVENTION', intervention.id, true, 'brouillon à 0,00 €');

      const f1 = await emettre(premiere.id, par('AT'));
      assert.deepEqual([f1.statut, ...nombres([f1.totalHt, f1.totalTva, f1.totalTtc])], ['EMISE', 0, 0, 0]);
      // Émise à 0,00 € : elle ne compte plus. Lecture écartée : la règle d'avant (AT-4, « toute facture non annulée »).
      await repereVaut('INTERVENTION', intervention.id, false, 'facture émise à 0,00 € seule');
      // Toujours non annulable (décision du 10-11-2026), sans écriture : la décision du 16-11-2026 ne change rien pour elle.
      await refuse(() => appeler('post', `/factures/${f1.id}/annuler`, {}, par('AT')), 409, REFUS.annulationZero, 'annulation de la facture à 0,00 €');
      const photoAvant = await photo(f1.id);
      const pdfAvant = await texteDuPdf(await appeler('get', `/factures/${f1.id}/document.pdf`, null, par('AT')));
      assert.ok(pdfAvant.includes(f1.numero), 'le PDF porte le numéro');

      // Aperçu admis pour l'assistante et pour l'administration ; nouvelle facture créée par l'administration (0,00 € à 0 €/h).
      for (const code of [...ADMINISTRATION, 'AT']) assert.deepEqual(await ok(apercu(intervention.id, par(code))), lu, `aperçu admis par ${code}`);
      const seconde = await creee(intervention.id, par('AD'));
      assert.deepEqual([seconde.statut, seconde.numero, seconde.tempsPasse, seconde.interventionId, seconde.creeParType], ['BROUILLON', null, true, intervention.id, 'ADMIN']);
      const secondeEnBase = await enBase(seconde.id);
      assert.deepEqual(montantsEnBase(secondeEnBase), { totaux: [0, 0, 0], lignes: [[0, 'PRESTATION', 2, 0, 20, 0, 0]], ventilation: [[20, 0, 0, 0]] });
      assert.deepEqual(secondeEnBase.journal.map((j) => [j.action, j.detail]), [['CREATION_BROUILLON', `Origine INTERVENTION, au temps passé : 2 h saisies sur l’intervention et 0 suite facturable, 2 h facturées (minimum 15 min, puis tranches de 15 min) ; devis ${devis.numero} v${devis.version}`]]);

      // La facture à 0,00 € n'est ni modifiée ni annulée : ligne, lignes, ventilation, écritures, journal, PDF et liste à l'identique.
      assert.deepEqual(await photo(f1.id), photoAvant, 'facture à 0,00 € relue à l’identique en base');
      assert.equal(await texteDuPdf(await appeler('get', `/factures/${f1.id}/document.pdf`, null, par('AT'))), pdfAvant, 'PDF inchangé');
      for (const code of ['AD', 'AT']) {
        const listee = (await ok(appeler('get', '/factures', null, par(code)))).find((f) => f.id === f1.id);
        assert.deepEqual([listee?.statut, listee?.numero, listee?.totalTtc], ['EMISE', f1.numero, 0], `liste de ${code}`);
      }

      // Le nouveau brouillon (0,00 €) bloque à son tour ; le message de l'administration ne cite plus la facture émise à 0,00 €.
      await refusTempsPasse(intervention.id, 'brouillon', 'second brouillon à 0,00 €, à côté de la facture émise à 0,00 €');
      // N5 (effet direct de la décision, signalé dans la PR) : émis à 0,00 €, il ne compte plus ; une troisième facture s'ouvre, et
      // les factures à 0,00 € se suivent dans la numérotation.
      const f2 = await emettre(seconde.id, par('AD'));
      assert.equal(rangDe(f2.numero), rangDe(f1.numero) + 1, 'numéros consécutifs');
      await repereVaut('INTERVENTION', intervention.id, false, 'deux factures émises à 0,00 €');
      const troisieme = await creee(intervention.id, par('AT'));
      assert.deepEqual([troisieme.statut, ...nombres([troisieme.totalTtc])], ['BROUILLON', 0]);
      assert.deepEqual(await photo(f1.id), photoAvant, 'facture à 0,00 € toujours identique');
      assert.equal(await prisma.facture.count({ where: { interventionId: intervention.id } }), 3);
    });

    // Critères « créée malgré une facture émise à 0,00 € sur l'intervention » et « montants de la nouvelle facture relus en base et
    // comparés à un témoin en décimal exact » ; copie figée (prix du catalogue, minimum et pas de la société changés après la
    // signature). Devis au pas de 45 min (lot Z : au pas de 15 min, des saisies au quart d'heure ne s'arrondissent plus au pas).
    // Lectures écartées (témoin des montants) : heures ajoutées seules (0,02 €), facture à 0,00 € déduite (0,02 €), heures brutes
    // (0,02 €), pas le plus proche (0,02 €), minimum ignoré (0,02 €), troncature ou arrondi au pair (0,02 €), minimum du jour
    // (0,08 €), pas du jour (0,02 €), prix du catalogue du jour (113,75 €), TVA tronquée (TTC 0,03 €).
    test('main d’œuvre à 0,01 €/h : 0,25 h facturées 0,25 h (minimum) arrondies à 0,00 €, émise ; 1,75 h ajoutées sur l’intervention terminée ; nouvelle facture créée par l’assistante technique : 2 h saisies, 2,5 h facturées au pas figé de 45 min, 0,03 € HT, 0,01 € de TVA, 0,04 € TTC, relus en base (lignes, ventilation, journal, écritures) au prix, au minimum et au pas figés du devis ; émise, elle bloque à son tour (messages exacts, sans le numéro de la facture à 0,00 €)', async () => {
      const reglages = await prisma.parametres.findUniqueOrThrow({ where: { id: 'singleton' }, select: { pasTempsPasseMinutes: true, tempsMinimumMinutes: true } });
      try {
        // Pas de 45 min, figé ensuite sur le devis avec le minimum de 15 min.
        await ok(appeler('put', '/parametres', { pasTempsPasseMinutes: PAS_45 }));
        const mo = await mainOeuvre('0.01', 'à un centime, prix changé après coup');
        const { devis, intervention } = await chaine(mo, '0,01 €/h nouvelle facture', [H_ZERO], { plancher: PLANCHER, pas: PAS_45 });
        const zero = await creee(intervention.id, par('AD'));
        assert.deepEqual(nombres([zero.totalHt, zero.totalTva, zero.totalTtc]), [ATTENDU_ZERO.ht, ATTENDU_ZERO.tva, ATTENDU_ZERO.ttc]);
        assert.deepEqual(montantsEnBase(await enBase(zero.id)).lignes, [[0, 'PRESTATION', ATTENDU_ZERO.quantite, 0.01, 20, 0, 0]]);
        const fZero = await emettre(zero.id, par('AD'));
        assert.deepEqual([fZero.statut, Number(fZero.totalTtc)], ['EMISE', 0]);
        const photoZero = await photo(fZero.id);
        // Copie figée : la main d'œuvre passe à 45,50 €/h, le minimum de la société à 8 h et son pas à 15 min, après la signature.
        await ok(appeler('put', `/catalogue/prestations/${mo.id}`, { estMainOeuvre: true, reference: mo.reference, nom: mo.nom, tauxTva: '20', prixVenteHt: PRIX_APRES_COUP, prixJourHorsContratHt: '0', prixHeureSousContratHt: '0', prixJourSousContratHt: '0', heuresParJour: '7' }));
        await ok(appeler('put', '/parametres', { tempsMinimumMinutes: MINIMUM_APRES_COUP, pasTempsPasseMinutes: PAS }));
        // Heures ajoutées sur l'intervention terminée (admis).
        await saisirHeures(intervention.id, H_AJOUT);
        const lu = await ok(apercu(intervention.id, par('AT')));
        assert.deepEqual(await ok(apercu(intervention.id, par('AD'))), lu, 'même aperçu pour l’administration');
        assert.deepEqual([lu.heures.saisies, lu.heures.minutesFacturees, lu.heures.facturees, lu.heures.plancherMinutes, lu.heures.pasMinutes], [2, 150, ATTENDU_NOUVELLE.quantite, PLANCHER, PAS_45]);
        assert.deepEqual([lu.totalHt, lu.totalTva, lu.totalTtc], [ATTENDU_NOUVELLE.ht, ATTENDU_NOUVELLE.tva, ATTENDU_NOUVELLE.ttc]);
        const nouvelle = await ok(creer(intervention.id, par('AT'), lu.totalHt), 201);
        assert.deepEqual([nouvelle.statut, nouvelle.tempsPasse, nouvelle.creeParType, ...nombres([nouvelle.totalHt, nouvelle.totalTva, nouvelle.totalTtc])], ['BROUILLON', true, ROLE_AT, ATTENDU_NOUVELLE.ht, ATTENDU_NOUVELLE.tva, ATTENDU_NOUVELLE.ttc]);
        const enBaseNouvelle = await enBase(nouvelle.id);
        // Montants relus en base, comparés au témoin (ATTENDU_NOUVELLE, recalculé en décimal exact par le premier test).
        assert.deepEqual(montantsEnBase(enBaseNouvelle), {
          totaux: [ATTENDU_NOUVELLE.ht, ATTENDU_NOUVELLE.tva, ATTENDU_NOUVELLE.ttc],
          lignes: [[0, 'PRESTATION', ATTENDU_NOUVELLE.quantite, 0.01, 20, ATTENDU_NOUVELLE.ht, ATTENDU_NOUVELLE.ligneTtc]],
          ventilation: [[20, ATTENDU_NOUVELLE.ht, ATTENDU_NOUVELLE.tva, ATTENDU_NOUVELLE.ttc]],
        });
        assert.deepEqual([enBaseNouvelle.totalHt.toString(), enBaseNouvelle.totalTva.toString(), enBaseNouvelle.totalTtc.toString()], ['0.03', '0.01', '0.04'], 'valeurs décimales exactes en base');
        assert.deepEqual(enBaseNouvelle.journal.map((j) => [j.action, j.detail]), [['CREATION_BROUILLON', `Origine INTERVENTION, au temps passé : 2 h saisies sur l’intervention et 0 suite facturable, 2,5 h facturées (minimum 15 min, puis tranches de 45 min) ; devis ${devis.numero} v${devis.version}`]]);
        assert.deepEqual(await photo(fZero.id), photoZero, 'facture à 0,00 € inchangée par la création');

        // Émise par elle : écritures relues en base (client au débit, vente et TVA au crédit).
        const emise = await emettre(nouvelle.id, par('AT'));
        const ecritures = (await enBase(emise.id)).ecrituresComptables.map((e) => [e.cle, e.compteNum, ...nombres([e.debit, e.credit])]).sort((a, b) => a[0].localeCompare(b[0]));
        assert.deepEqual(ecritures, [['CLIENT', '411000', ATTENDU_NOUVELLE.ttc, 0], ['TVA:20', '445710', 0, ATTENDU_NOUVELLE.tva], ['VENTE_PRESTATION', '706000', 0, ATTENDU_NOUVELLE.ht]]);
        // Elle bloque à son tour : l'administration lit son seul numéro, et non celui de la facture à 0,00 €.
        await refusTempsPasse(intervention.id, emise.numero, 'facture émise à 0,04 € à côté de la facture à 0,00 €', ATTENDU_NOUVELLE.ht);
        await repereVaut('INTERVENTION', intervention.id, true, 'facture émise à 0,04 € à côté de la facture à 0,00 €');
        assert.deepEqual(await photo(fZero.id), photoZero, 'facture à 0,00 € toujours identique');
      } finally {
        await ok(appeler('put', '/parametres', { pasTempsPasseMinutes: reglages.pasTempsPasseMinutes, tempsMinimumMinutes: reglages.tempsMinimumMinutes }));
      }
      assert.deepEqual(await prisma.parametres.findUniqueOrThrow({ where: { id: 'singleton' }, select: { pasTempsPasseMinutes: true, tempsMinimumMinutes: true } }), { pasTempsPasseMinutes: PAS, tempsMinimumMinutes: PLANCHER });
    });

    // Critère « refusée avec une facture émise à 0,01 € ». Lecture écartée : égalité devenue « ≤ 0,01 € » (ou TVA nulle prise pour une
    // facture nulle) : la création passerait l'API puis buterait sur l'index, et le repère répondrait faux.
    test('facture émise à 0,01 € (1 h à 0,01 €/h, TVA 0,00 €) : elle compte ; facture au temps passé refusée (messages exacts, pour l’administration et pour l’assistante technique, sans écriture), repère vrai', async () => {
      const { intervention } = await chaine(mainOeuvreCentime, '0,01 € émise', [H_CENTIME]);
      const brouillon = await creee(intervention.id, par('AD'));
      const centime = await emettre(brouillon.id, par('AD'));
      assert.deepEqual([centime.statut, ...nombres([centime.totalHt, centime.totalTva, centime.totalTtc])], ['EMISE', ATTENDU_CENTIME.ht, ATTENDU_CENTIME.tva, ATTENDU_CENTIME.ttc]);
      assert.deepEqual(montantsEnBase(await enBase(centime.id)), { totaux: [0.01, 0, 0.01], lignes: [[0, 'PRESTATION', ATTENDU_CENTIME.quantite, 0.01, 20, 0.01, 0.01]], ventilation: [[20, 0.01, 0, 0.01]] });
      await refusTempsPasse(intervention.id, centime.numero, 'facture émise à 0,01 €', ATTENDU_CENTIME.ht);
      await repereVaut('INTERVENTION', intervention.id, true, 'facture émise à 0,01 €');
    });

    // #676, N1 de l'audit des montants de #675 (cadrage du lot AF, § 2 ; N6 de son contrôle de mode 1) : relèvement au minimum d'une
    // saisie inférieure au minimum, par un cas dédié (H_ZERO, le minimum exact, n'est pas modifié). Cas réel par l'API : 0 h saisie par
    // le technicien affecté, avec son motif obligatoire, sur une nouvelle intervention au pas et au minimum de 15 min figés. Lectures
    // écartées : minimum non appliqué sous le seuil (mutant T4 : 0 min et 0 h facturées, au même montant, 0,00 €) ; zéro heure qui ne
    // compte pas comme une saisie (refus « Aucune heure n'est saisie… ») ; arrondi au centime supérieur (0,01 € HT).
    test('0 h saisie avec motif sur une nouvelle intervention (pas et minimum de 15 min figés) : 15 min facturées, soit 0,25 h, à 0,00 € ; quantité relue dans l’aperçu, la facture créée par l’assistante technique, sa ligne en base et son journal ; zéro heure sans motif refusée sans écriture', async () => {
      // Témoin en décimal exact : 0 h = 0 min → minimum de 15 min → 0,25 h × 0,01 € = 0,0025 € → 0,00 €.
      const attendu = factureTempsPasse([H_ZERO_SAISIE]);
      assert.deepEqual([attendu.centiemes, attendu.minutes, attendu.milliemes, attendu.ht, attendu.tva, attendu.ttc, attendu.ligneTtc], [0n, 15n, 250n, 0n, 0n, 0n, 0n]);
      assert.deepEqual([Number(attendu.minutes), Number(attendu.milliemes) / 1000, euros(attendu.ht), euros(attendu.tva), euros(attendu.ttc)], [ATTENDU_ZERO_SAISIE.minutes, ATTENDU_ZERO_SAISIE.quantite, ATTENDU_ZERO_SAISIE.ht, ATTENDU_ZERO_SAISIE.tva, ATTENDU_ZERO_SAISIE.ttc]);
      // Lecture écartée T4 (minimum non appliqué sous le seuil) : 0 min, 0 h facturée, distincte de l'attendu par la quantité ; son
      // montant, 0,00 €, ne la distingue pas (d'où la quantité vérifiée partout ci-dessous).
      const t4 = { minutes: 0n, milliemes: exact.milliemesHeure(0n) };
      assert.deepEqual([t4.milliemes, exact.arrondi(t4.milliemes * exact.unites('0.01', 2))], [0n, 0n]);
      assert.notEqual(t4.minutes, attendu.minutes, 'lecture écartée « minimum non appliqué sous le seuil » : minutes');
      assert.notEqual(t4.milliemes, attendu.milliemes, 'lecture écartée « minimum non appliqué sous le seuil » : quantité');
      assert.equal(exact.arrondi(t4.milliemes * 1n), attendu.ht, 'le montant seul ne départage pas T4');
      // Lecture écartée : arrondi au centime supérieur (0,01 €).
      assert.notEqual(exact.superieur(attendu.milliemes * 1n), attendu.ht, 'lecture écartée « arrondi au supérieur »');

      const { devis, intervention } = await devisConverti(mainOeuvreCentime, '0 h avec motif');
      await affecter(intervention.id);
      // Zéro heure sans motif : refusée, au message exact, sans écriture.
      await refuse(() => appeler('post', `/interventions/${intervention.id}/couts/heures`, { date: jour().fr, nbrHeures: 0 }, technicien.auth), 400, 'Un motif de 3 à 500 caractères est obligatoire pour zéro heure.', 'zéro heure sans motif');
      // Zéro heure avec motif : admise, enregistrée à 0 h.
      await ok(appeler('post', `/interventions/${intervention.id}/couts/heures`, { date: jour().fr, nbrHeures: Number(H_ZERO_SAISIE), motif: MOTIF_ZERO_HEURE }, technicien.auth), 201);
      const saisies = await prisma.coutInterventionHeure.findMany({ where: { interventionId: intervention.id }, select: { nbrHeures: true, archivedAt: true } });
      assert.deepEqual(saisies.map((h) => [h.nbrHeures.toString(), h.archivedAt]), [['0', null]], 'une seule saisie, à 0 h, non archivée');
      await terminer(intervention.id);

      // Aperçu : 0 h saisie, 0 min, minimum figé de 15 min atteint par relèvement → 15 min facturées, 0,25 h, 0,00 €.
      const lu = await ok(apercu(intervention.id, par('AT')));
      assert.deepEqual(await ok(apercu(intervention.id, par('AD'))), lu, 'même aperçu pour l’administration');
      assert.deepEqual([lu.heures.saisies, lu.heures.minutesSaisies, lu.heures.minimumFige, lu.heures.plancherMinutes, lu.heures.pasMinutes, lu.heures.minutesFacturees, lu.heures.facturees],
        [0, 0, true, PLANCHER, PAS, ATTENDU_ZERO_SAISIE.minutes, ATTENDU_ZERO_SAISIE.quantite], 'heures de l’aperçu : 15 min facturées pour 0 h saisie');
      assert.deepEqual([lu.totalHt, lu.totalTva, lu.totalTtc], [ATTENDU_ZERO_SAISIE.ht, ATTENDU_ZERO_SAISIE.tva, ATTENDU_ZERO_SAISIE.ttc]);

      // Facture créée par l'assistante technique : ligne au temps passé à 0,25 h, relue en base, et journal du calcul.
      const facture = await ok(creer(intervention.id, par('AT'), lu.totalHt), 201);
      assert.deepEqual([facture.statut, facture.tempsPasse, facture.creeParType, ...nombres([facture.totalHt, facture.totalTva, facture.totalTtc])], ['BROUILLON', true, ROLE_AT, 0, 0, 0]);
      const relue = await enBase(facture.id);
      assert.deepEqual(montantsEnBase(relue), {
        totaux: [ATTENDU_ZERO_SAISIE.ht, ATTENDU_ZERO_SAISIE.tva, ATTENDU_ZERO_SAISIE.ttc],
        lignes: [[0, 'PRESTATION', ATTENDU_ZERO_SAISIE.quantite, 0.01, 20, 0, 0]],
        ventilation: [[20, 0, 0, 0]],
      });
      assert.equal(relue.lignes[0].quantite.toString(), '0.25', 'quantité facturée exacte en base : 0,25 h');
      assert.deepEqual(relue.journal.map((j) => [j.action, j.detail]), [['CREATION_BROUILLON', `Origine INTERVENTION, au temps passé : 0 h saisies sur l’intervention et 0 suite facturable, 0,25 h facturées (minimum 15 min, puis tranches de 15 min) ; devis ${devis.numero} v${devis.version}`]]);
    });

    // Critère « créée malgré une facture émise à 0,00 € sur une suite ». Cas THÉORIQUE (règle 4), construit par une fixture écrite en
    // base : une facture à 0,00 € sur une suite ne s'obtient pas par l'API (la saisie ligne par ligne y est refusée, une suite ne
    // reçoit pas de facture au temps passé). Le brouillon est écrit comme le ferait POST /api/factures (lignes, ventilation, journal,
    // type du créateur), puis émis par l'API. Lectures écartées : brouillon de la suite ignoré (création admise) ; facture à 0,00 € de
    // la suite qui compte (création refusée) ; heures de la suite oubliées (0,01 € au lieu de 0,03 €) ; heures de l'intervention
    // oubliées, heures brutes ou pas le plus proche (0,02 €). Devis au pas de 45 min (lot Z : au pas de 15 min, des saisies au quart
    // d'heure ne s'arrondissent plus au pas).
    test('suite (fixture théorique écrite en base) : brouillon à 0,00 € de la suite bloquant (messages exacts), émis par l’API à 0,00 €, puis facture au temps passé de l’intervention admise au pas figé de 45 min : 0,75 h de l’intervention et 1,25 h de sa suite, 2,5 h facturées, 0,04 € TTC relus en base ; la facture de la suite inchangée', async () => {
      const reglages = await prisma.parametres.findUniqueOrThrow({ where: { id: 'singleton' }, select: { pasTempsPasseMinutes: true, tempsMinimumMinutes: true } });
      try {
        // Pas de 45 min, figé ensuite sur le devis avec le minimum de 15 min (lot Z).
        await ok(appeler('put', '/parametres', { pasTempsPasseMinutes: PAS_45 }));
        const { devis, intervention } = await devisConverti(mainOeuvreCentime, 'suite', { plancher: PLANCHER, pas: PAS_45 });
        await affecter(intervention.id);
        await saisirHeures(intervention.id, H_SUITE.intervention);
        await terminer(intervention.id);
        const suite = await ok(appeler('post', `/interventions/${intervention.id}/suites`, {}), 201);
        await affecter(suite.id);
        await saisirHeures(suite.id, H_SUITE.suite);
        await terminer(suite.id);
        // La saisie ligne par ligne sur la suite est refusée par l'API (d'où la fixture).
        await refuse(() => appeler('post', '/factures', { clientId: client.id, dateEmission: jour().fr, dateEcheance: jour().fr, origine: 'INTERVENTION', interventionId: suite.id, lignes: LIGNES_ZERO }), 409,
          `L’intervention ${intervention.reference} est au temps passé : sa facture, et celle de ses suites, reprend les heures saisies. Créez-la par « Facture au temps passé ».`, 'facture saisie ligne par ligne sur la suite');
        const jourIso = new Date(`${jour().iso}T00:00:00.000Z`);
        const fixture = await transactionVerifiee((tx) => tx.facture.create({ data: {
          clientId: client.id, clientRaisonSociale: client.raisonSociale, origine: 'INTERVENTION', interventionId: suite.id, tempsPasse: false,
          dateEmission: jourIso, dateEcheance: jourIso, totalHt: 0, totalTva: 0, totalTtc: 0, createdById: comptes.AD.id, creeParType: 'ADMIN',
          lignes: { create: [{ ordre: 0, designation: 'TEST zéro fixture théorique de la suite', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 0, tauxTva: 20, totalHt: 0, totalTtc: 0 }] },
          ventilationTva: { create: [{ tauxTva: 20, totalHt: 0, totalTva: 0, totalTtc: 0 }] },
          journal: { create: [{ acteurId: comptes.AD.id, action: 'CREATION_BROUILLON', detail: 'Origine INTERVENTION' }] },
        } }));
        // Brouillon à 0,00 € sur la suite : il compte. Lecture écartée : « toute facture à 0,00 € » (brouillon exclu : la création
        // passerait, l'index ne retenant que les factures marquées « au temps passé »).
        await refusTempsPasse(intervention.id, 'brouillon', 'brouillon à 0,00 € sur la suite', ATTENDU_SUITE.ht);
        await repereVaut('INTERVENTION', suite.id, true, 'suite, brouillon à 0,00 €');
        const emiseSuite = await emettre(fixture.id, par('AD'));
        assert.deepEqual([emiseSuite.statut, emiseSuite.interventionId, emiseSuite.tempsPasse, Number(emiseSuite.totalTtc)], ['EMISE', suite.id, false, 0]);
        const photoSuite = await photo(fixture.id);
        await repereVaut('INTERVENTION', suite.id, false, 'suite, facture émise à 0,00 € seule');
        await repereVaut('INTERVENTION', intervention.id, false, 'intervention sans facture, sa suite facturée à 0,00 €');

        const lu = await ok(apercu(intervention.id, par('AD')));
        assert.deepEqual(await ok(apercu(intervention.id, par('AT'))), lu, 'même aperçu pour l’assistante technique');
        assert.deepEqual([lu.heures.intervention, lu.heures.suites.map((s) => [s.id, s.heures]), lu.heures.saisies, lu.heures.facturees], [0.75, [[suite.id, 1.25]], 2, ATTENDU_SUITE.quantite]);
        const facture = await ok(creer(intervention.id, par('AD'), lu.totalHt), 201);
        const relue = await enBase(facture.id);
        assert.deepEqual(montantsEnBase(relue), {
          totaux: [ATTENDU_SUITE.ht, ATTENDU_SUITE.tva, ATTENDU_SUITE.ttc],
          lignes: [[0, 'PRESTATION', ATTENDU_SUITE.quantite, 0.01, 20, ATTENDU_SUITE.ht, ATTENDU_SUITE.ligneTtc]],
          ventilation: [[20, ATTENDU_SUITE.ht, ATTENDU_SUITE.tva, ATTENDU_SUITE.ttc]],
        });
        assert.deepEqual(relue.journal.map((j) => [j.action, j.detail]), [['CREATION_BROUILLON', `Origine INTERVENTION, au temps passé : 2 h saisies sur l’intervention et 1 suite facturable, 2,5 h facturées (minimum 15 min, puis tranches de 45 min) ; devis ${devis.numero} v${devis.version}`]]);
        assert.deepEqual(await photo(fixture.id), photoSuite, 'facture à 0,00 € de la suite inchangée');
        // Le brouillon créé compte : refus suivants au message qui ne cite que lui.
        await refusTempsPasse(intervention.id, 'brouillon', 'brouillon au temps passé à côté de la facture à 0,00 € de la suite', ATTENDU_SUITE.ht);
      } finally {
        await ok(appeler('put', '/parametres', { pasTempsPasseMinutes: reglages.pasTempsPasseMinutes, tempsMinimumMinutes: reglages.tempsMinimumMinutes }));
      }
      assert.deepEqual(await prisma.parametres.findUniqueOrThrow({ where: { id: 'singleton' }, select: { pasTempsPasseMinutes: true, tempsMinimumMinutes: true } }), { pasTempsPasseMinutes: PAS, tempsMinimumMinutes: PLANCHER });
    });

    // Critères « Repère » : émise à 0,00 € seule → faux ; brouillon à 0,00 € → vrai ; émise à 0,01 € → vrai ; annulée → faux
    // (inchangé). Sur les trois origines du repère, par des factures saisies ligne par ligne, de l'administration et de l'assistante.
    test('repère « déjà facturée » sur les trois origines : faux pour une facture émise à 0,00 € seule (affaire, contrat, intervention), et à côté d’une facture annulée ; vrai pour un brouillon à 0,00 €, une facture émise à 0,01 €, et une facture à 0,01 € à côté d’une facture à 0,00 € ; même réponse pour l’administration et pour l’assistante technique', async () => {
      const chantier = (nom) => prisma.chantier.create({ data: { nom: `TEST zéro TP repère ${nom} ${suffixe()}`, client: client.raisonSociale, clientId: client.id, dateDebut: new Date('2026-10-01T00:00:00Z'), budgetGlobalVendu: 1000 } });
      const contrat = (titre) => ok(appeler('post', '/contrats-maintenance', { clientId: client.id, titre: `TEST zéro TP repère ${titre} ${suffixe()}`, periodiciteMois: 12, dureePrevisionnelleMinutes: 60, dateDebut: '01-09-2026' }), 201);
      const intervention = (titre) => ok(appeler('post', '/interventions', { clientId: client.id, titre: `TEST zéro TP repère ${titre} ${suffixe()}` }), 201);
      const origineDe = (origine, champ, id) => ({ origine, [champ]: id });

      // Affaire : brouillon à 0,00 € (vrai ; lecture écartée « toute facture à 0,00 € » : faux), puis émis (faux ; lecture écartée
      // « toute facture non annulée » : vrai).
      const c1 = await chantier('brouillon puis émise');
      const b1 = await brouillonManuel(par('AD'), origineDe('CHANTIER', 'chantierId', c1.id), LIGNES_ZERO);
      await repereVaut('CHANTIER', c1.id, true, 'affaire, brouillon à 0,00 €');
      await emettre(b1.id, par('AD'));
      await repereVaut('CHANTIER', c1.id, false, 'affaire, facture émise à 0,00 € seule');
      // Contrat : facture émise à 0,00 € de l'assistante seule (faux).
      const k1 = await contrat('émise à 0,00 €');
      await emettre((await brouillonManuel(par('AT'), origineDe('CONTRAT', 'contratMaintenanceId', k1.id), LIGNES_ZERO)).id, par('AT'));
      await repereVaut('CONTRAT', k1.id, false, 'contrat, facture émise à 0,00 € seule');
      // Intervention ordinaire : facture émise à 0,00 € seule (faux), puis brouillon à 0,00 € de l'assistante à côté (vrai).
      const i1 = await intervention('émise à 0,00 € puis brouillon');
      await emettre((await brouillonManuel(par('AD'), origineDe('INTERVENTION', 'interventionId', i1.id), LIGNES_ZERO)).id, par('AD'));
      await repereVaut('INTERVENTION', i1.id, false, 'intervention, facture émise à 0,00 € seule');
      await brouillonManuel(par('AT'), origineDe('INTERVENTION', 'interventionId', i1.id), LIGNES_ZERO);
      await repereVaut('INTERVENTION', i1.id, true, 'intervention, brouillon à 0,00 € à côté d’une facture émise à 0,00 €');
      // Intervention ordinaire : facture émise à 0,01 € (vrai ; lecture écartée « ≤ 0,01 € » : faux).
      const i2 = await intervention('émise à 0,01 €');
      await emettre((await brouillonManuel(par('AT'), origineDe('INTERVENTION', 'interventionId', i2.id), LIGNES_CENTIME)).id, par('AT'));
      await repereVaut('INTERVENTION', i2.id, true, 'intervention, facture émise à 0,01 €');
      // Affaire : facture à 0,01 € annulée par son avoir total, et facture émise à 0,00 € (faux : ni l'une ni l'autre ne compte).
      const c2 = await chantier('annulée et 0,00 €');
      const annulable = await emettre((await brouillonManuel(par('AD'), origineDe('CHANTIER', 'chantierId', c2.id), LIGNES_CENTIME)).id, par('AD'));
      assert.equal((await ok(appeler('post', `/factures/${annulable.id}/annuler`, {}, par('AD')))).statut, 'ANNULEE');
      await emettre((await brouillonManuel(par('AT'), origineDe('CHANTIER', 'chantierId', c2.id), LIGNES_ZERO)).id, par('AT'));
      await repereVaut('CHANTIER', c2.id, false, 'affaire, facture annulée et facture émise à 0,00 €');
      // Contrat : facture émise à 0,00 € et facture émise à 0,01 € (vrai : la seconde compte).
      const k2 = await contrat('0,00 € et 0,01 €');
      await emettre((await brouillonManuel(par('AD'), origineDe('CONTRAT', 'contratMaintenanceId', k2.id), LIGNES_ZERO)).id, par('AD'));
      await emettre((await brouillonManuel(par('AD'), origineDe('CONTRAT', 'contratMaintenanceId', k2.id), LIGNES_CENTIME)).id, par('AD'));
      await repereVaut('CONTRAT', k2.id, true, 'contrat, factures émises à 0,00 € et à 0,01 €');
    });

    // Concurrence (cadrage, « À vérifier par le contrôleur ») : la création se fait sous le verrou de l'intervention et de ses suites ;
    // une fois la facture à 0,00 € écartée, deux créations simultanées ne font qu'une facture, l'autre refusée par l'API (son message,
    // et non celui de l'index).
    test('concurrence : après une facture émise à 0,00 €, deux créations simultanées (administration et assistante technique) font une seule facture ; l’autre est refusée sous verrou au message de son compte, sans le refus de l’index', async () => {
      const { intervention } = await chaine(mainOeuvreCentime, 'concurrence', [H_ZERO]);
      const fZero = await emettre((await creee(intervention.id, par('AD'))).id, par('AD'));
      const photoZero = await photo(fZero.id);
      const reponses = await Promise.all([creer(intervention.id, par('AD'), 0), creer(intervention.id, par('AT'), 0)]);
      assert.deepEqual(reponses.map((r) => r.status).sort(), [201, 409], JSON.stringify(reponses.map((r) => r.body)));
      const [ad, at] = reponses;
      const refus = ad.status === 409 ? [ad.body.error, REFUS.tempsPasseAdministration('brouillon')] : [at.body.error, REFUS.tempsPasseAt];
      assert.equal(refus[0], refus[1], 'refus de l’API, au message du compte refusé');
      assert.equal(await prisma.facture.count({ where: { interventionId: intervention.id, statut: 'BROUILLON' } }), 1);
      assert.deepEqual(await photo(fZero.id), photoZero);
    });

    // Droits (inchangés par le lot) : la facture à 0,00 € écartée ne rouvre la route à aucun autre compte ; clé d'intégration et
    // absence de session refusées (route de session seulement).
    test('droits : après une facture émise à 0,00 €, aperçu, création et repère refusés aux sept autres types (403 au message exact), sans session et par une clé d’intégration (401), sans écriture', async () => {
      const { intervention } = await chaine(mainOeuvreGratuite, 'droits', ['1']);
      await emettre((await creee(intervention.id, par('AD'))).id, par('AD'));
      const routes = [
        ['get', `/interventions/${intervention.id}/facture-temps-passe`],
        ['post', `/interventions/${intervention.id}/facture-temps-passe`, { dateEmission: jour().fr, dateEcheance: jour().fr, totalHtAttendu: 0 }],
        ['get', `/factures/deja-facturee?origine=INTERVENTION&id=${intervention.id}`],
      ];
      const avant = await empreinte();
      for (const [code] of AUTRES_TYPES) {
        for (const [methode, chemin, corps] of routes) {
          const res = await appeler(methode, chemin, corps, par(code));
          assert.deepEqual([res.status, res.body?.error], [403, REFUS.gestion], `${code} : ${methode} ${chemin}`);
        }
      }
      for (const [methode, chemin, corps] of routes) {
        assert.equal((await appeler(methode, chemin, corps, null)).status, 401, `sans session : ${chemin}`);
        assert.equal((await appeler(methode, chemin, corps, entete(cle.apiKey))).status, 401, `clé d’intégration : ${chemin}`);
      }
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], 'aucun refus n’écrit, table des clés comprise');
      // Témoin : l'administration y entre.
      assert.equal((await creer(intervention.id, par('DIR'), 0)).status, 201);
    });

    // Garde en base (cadrage, § 1 bis, R1 du contrôle ; « Construction des cas de test », « Garde en SQL ») : l'index unique partiel
    // porte la même règle que l'API. Chaque cas dans une transaction annulée : rien n'est écrit. Lectures écartées : index d'avant
    // (seconde facture refusée à côté d'une facture émise à 0,00 €) ; brouillon à 0,00 € exclu (admis) ; « ≤ 0,01 € » (admis).
    test('garde en base : définition exacte de l’index ; seconde facture au temps passé admise à côté d’une facture émise à 0,00 € (et d’une seconde émise à 0,00 €, et d’une annulée) ; refusée à côté d’un brouillon qui compte (même à 0,00 €), d’une facture émise à 0,01 € ; rien n’est écrit', async () => {
      const [{ definition }] = await prisma.$queryRaw`SELECT pg_get_indexdef('"Facture_temps_passe_unique"'::regclass) AS definition`;
      assert.equal(definition, `CREATE UNIQUE INDEX "Facture_temps_passe_unique" ON public."Facture" USING btree ("interventionId") WHERE ("tempsPasse" AND (statut <> 'ANNULEE'::text) AND (NOT ((statut = ANY (ARRAY['EMISE'::text, 'REGLEE'::text])) AND ("totalTtc" = (0)::numeric))))`);
      const identite = await prisma.identiteEmetteur.findFirstOrThrow({ select: { id: true } });
      const sql = new pg.Client({ connectionString: cible.toString() });
      await sql.connect();
      const avant = await empreinte();
      try {
        let numero = 0;
        const facture = async (interventionId, statut, ttc) => {
          const id = randomUUID();
          const numerotee = statut !== 'BROUILLON';
          await sql.query(`INSERT INTO "Facture" ("id","clientId","clientRaisonSociale","origine","interventionId","tempsPasse","type","statut","numero","annee","dateEmission","dateEcheance","totalHt","totalTva","totalTtc","updatedAt","identiteEmetteurId")
            VALUES ($1,$2,$3,'INTERVENTION',$4,true,'FACTURE',$5,$6,$7,current_date,current_date,$8,0,$8,now(),$9)`,
          [id, client.id, client.raisonSociale, interventionId, statut, numerotee ? `ZTP-${(numero += 1)}-${suffixe()}` : null, numerotee ? 2026 : null, ttc, numerotee ? identite.id : null]);
          return id;
        };
        // Une intervention au temps passé écrite dans la transaction (le cas le plus simple que l'index voit).
        const intervention = async () => {
          const id = randomUUID();
          await sql.query(`INSERT INTO "Intervention" ("id","reference","clientId","titre","updatedAt","auTempsPasse") VALUES ($1,$2,$3,'TEST zéro TP garde',now(),true)`, [id, `TEST-ZTP-${suffixe()}`, client.id]);
          return id;
        };
        const refusIndex = async (ecriture, quoi) => {
          await sql.query('SAVEPOINT cas');
          let erreur = null;
          try { await ecriture(); } catch (e) { erreur = e; }
          await sql.query('ROLLBACK TO SAVEPOINT cas');
          assert.ok(erreur, `${quoi} : l’écriture devait être refusée`);
          assert.deepEqual([erreur.code, erreur.constraint], ['23505', 'Facture_temps_passe_unique'], `${quoi} : ${erreur.message}`);
        };
        await sql.query('BEGIN');
        // Admission à côté d'une facture émise à 0,00 €, puis d'une seconde émise à 0,00 € (N5) ; refus d'un brouillon à 0,00 € et
        // d'une facture positive à côté du brouillon qui compte.
        const i1 = await intervention();
        await facture(i1, 'EMISE', 0);
        await facture(i1, 'EMISE', 0);
        await facture(i1, 'BROUILLON', 144);
        await refusIndex(() => facture(i1, 'BROUILLON', 0), 'brouillon à 0,00 € à côté d’une facture qui compte');
        await refusIndex(() => facture(i1, 'BROUILLON', 144), 'seconde facture qui compte');
        await refusIndex(() => facture(i1, 'EMISE', 0.01), 'facture à 0,01 € à côté d’une facture qui compte');
        // Facture émise à 0,01 € : elle compte (lecture écartée « ≤ 0,01 € »).
        const i2 = await intervention();
        await facture(i2, 'EMISE', 0.01);
        await refusIndex(() => facture(i2, 'BROUILLON', 0), 'brouillon à côté d’une facture émise à 0,01 €');
        // Brouillon à 0,00 € seul : il compte (lecture écartée « toute facture à 0,00 € »).
        const i3 = await intervention();
        await facture(i3, 'BROUILLON', 0);
        await refusIndex(() => facture(i3, 'BROUILLON', 144), 'facture à côté d’un brouillon à 0,00 €');
        // Facture annulée (inchangé) : elle ne compte pas. Une pièce ne naît pas annulée (garde du cycle des pièces) : émise, puis
        // passée « annulée » dans la transaction.
        const i4 = await intervention();
        const annulee = await facture(i4, 'EMISE', 120);
        await sql.query(`UPDATE "Facture" SET "statut" = 'ANNULEE' WHERE "id" = $1`, [annulee]);
        await facture(i4, 'BROUILLON', 144);
        // Témoin : les sept écritures admises sont bien dans la transaction (trois, une, une et deux par intervention).
        const [{ n }] = (await sql.query(`SELECT count(*)::int AS n FROM "Facture" WHERE "interventionId" = ANY($1) AND "tempsPasse"`, [[i1, i2, i3, i4]])).rows;
        assert.equal(n, 7, 'sept factures admises dans la transaction');
      } finally {
        await sql.query('ROLLBACK').catch(() => {});
        await sql.end().catch(() => {});
      }
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], 'transactions annulées : rien n’est écrit');
    });

    // Choix par défaut, à confirmer (cadrage) : « émise » couvre aussi REGLEE ; une facture REGLEE à 0,00 € ne se construit pas (N2 du
    // contrôle). Preuve : refus « déjà soldée » de l'API, et gardes en base au message exact, à la création comme au passage à
    // « réglée ». Le mutant « REGLEE non exclue » est donc équivalent : aucun test ne peut le tuer.
    test('« réglée » à 0,00 € impossible : règlement refusé par l’API (409 « déjà soldée »), passage à « réglée » et facture créée « réglée » refusés par les gardes en base, au message exact ; rien n’est écrit', async () => {
      const { intervention } = await chaine(mainOeuvreGratuite, 'réglée impossible', ['1']);
      const fZero = await emettre((await creee(intervention.id, par('AD'))).id, par('AD'));
      await refuse(() => appeler('post', '/reglements', { clientId: client.id, dateReglement: jour().fr, montant: 0.01, moyen: 'VIREMENT', affectations: [{ factureId: fZero.id, montant: 0.01 }] }), 409, REFUS.dejaSoldee(fZero.numero), 'règlement de la facture à 0,00 €');
      const sql = new pg.Client({ connectionString: cible.toString() });
      await sql.connect();
      const avant = await empreinte();
      const refusEnBase = async (requete, valeurs, message, quoi) => {
        await sql.query('BEGIN');
        let erreur = null;
        try { await sql.query(requete, valeurs); await sql.query('SET CONSTRAINTS ALL IMMEDIATE'); } catch (e) { erreur = e; }
        await sql.query('ROLLBACK');
        assert.ok(erreur, `${quoi} : l’écriture devait être refusée`);
        assert.equal(erreur.message, message, quoi);
      };
      try {
        await refusEnBase(`UPDATE "Facture" SET "statut" = 'REGLEE' WHERE "id" = $1`, [fZero.id], GARDE.regleeNonSoldee, 'passage à « réglée »');
        const identite = await prisma.identiteEmetteur.findFirstOrThrow({ select: { id: true } });
        await refusEnBase(`INSERT INTO "Facture" ("id","clientId","clientRaisonSociale","origine","interventionId","tempsPasse","type","statut","numero","annee","dateEmission","dateEcheance","totalHt","totalTva","totalTtc","updatedAt","identiteEmetteurId")
          VALUES ($1,$2,$3,'INTERVENTION',$4,true,'FACTURE','REGLEE',$5,2026,current_date,current_date,0,0,0,now(),$6)`,
        [randomUUID(), client.id, client.raisonSociale, intervention.id, `ZTP-R-${suffixe()}`, identite.id], GARDE.regleeCreee, 'facture créée « réglée » à 0,00 €');
        const reglement = randomUUID();
        await refusEnBase(`WITH r AS (INSERT INTO "Reglement" ("id","clientId","dateReglement","montant","moyen","createdById") VALUES ($1,$2,current_date,0.01,'VIREMENT',$3) RETURNING "id")
          INSERT INTO "AffectationReglement" ("id","reglementId","factureId","montant") SELECT $4, r."id", $5, 0.01 FROM r`,
        [reglement, client.id, secours.id, randomUUID(), fZero.id], GARDE.affectationSoldee(fZero.id), 'règlement affecté en base');
      } finally {
        await sql.end().catch(() => {});
      }
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], 'rien n’est écrit');
      assert.equal((await prisma.facture.findUniqueOrThrow({ where: { id: fZero.id } })).statut, 'EMISE');
    });

    // Audit des montants de la PR #568 (C1, test manquant qui touche un montant). Pour la première fois, deux factures au temps passé
    // non annulées portent la même intervention. Lecture écartée : « Une fois au total » (décision de Nelson du 28-10-2026 : le
    // minimum figé et l'arrondi au pas appliqués une fois au total des heures) lu comme « le minimum ne se réapplique pas sur une
    // seconde facture, la facture à 0,00 € l'ayant déjà porté » : au-delà de 15 min, le temps facturé serait alors arrondi au pas dès
    // la première minute. Avec un plancher égal au pas (15 min, tests précédents), cette lecture donne le même temps facturé : le devis
    // porte ici un pas de 45 min au-delà d'un plancher de 15 min. Croisés avec les réglages et le catalogue changés après la facture à
    // 0,00 € : pas de la société (60 min) et TVA de la main d'œuvre (10 %), au lieu du pas figé du devis et de la TVA figée de sa ligne.
    // Lot Z : les heures se saisissent au quart d'heure ; 0,20 h puis 0,60 h deviennent 0,25 h puis 1,75 h, choisies pour que le pas
    // joue au-delà du minimum (105 min, 2,33 tranches de 45 min) et que chaque lecture écartée change le HT ou la TVA.
    test('minimum figé réappliqué sur la nouvelle facture, au pas figé du devis (45 min) et à la TVA figée de sa ligne : 0,25 h (facture à 0,00 €) puis 1,75 h ajoutées → 2,5 h facturées, 0,03 € HT, 0,01 € de TVA, 0,04 € TTC, malgré le pas de la société (60 min) et la TVA du catalogue (10 %) changés après la facture à 0,00 €', async () => {
      const PAS_APRES_COUP = 60; const H_AJOUT_45 = '1.75';
      // Témoin en décimal exact : 0,25 h = 15 min → minimum de 15 min → 0,25 h × 0,01 € = 0,0025 € → 0,00 € ; 2 h = 120 min →
      // 15 min + trois tranches de 45 min commencées = 150 min = 2,5 h → 0,025 € → 0,03 € HT, TVA 0,006 € → 0,01 €, TTC 0,04 €.
      const zeroAttendu = factureTempsPasse([H_ZERO], { pas: PAS_45 });
      assert.deepEqual([zeroAttendu.minutes, zeroAttendu.ht, zeroAttendu.ttc], [15n, 0n, 0n]);
      const attendu = factureTempsPasse([H_ZERO, H_AJOUT_45], { pas: PAS_45 });
      assert.deepEqual([attendu.centiemes, attendu.minutes, attendu.milliemes, attendu.ht, attendu.tva, attendu.ttc, attendu.ligneTtc], [200n, 150n, 2500n, 3n, 1n, 4n, 4n]);
      // Lectures écartées, distinctes de l'attendu : minimum non réappliqué (120 min → trois tranches de 45 min = 135 min = 2,25 h →
      // 0,0225 € → 0,02 € HT) ; pas de la société du jour (15 min + deux tranches de 60 min = 135 min = 2,25 h → 0,02 € HT) ; TVA du
      // catalogue du jour (10 % de 0,03 € = 0,003 € → 0,00 €, TTC 0,03 €) ; heures brutes (2 h → 0,02 €) ; pas le plus proche (105 min
      // au-delà du minimum, 2,33 tranches → 2 → 105 min = 1,75 h → 0,0175 € → 0,02 €).
      const sansMinimum = exact.milliemesHeure(exact.minutesFacturees(attendu.centiemes, 0, PAS_45));
      assert.deepEqual([sansMinimum, exact.arrondi(sansMinimum * 1n)], [2250n, 2n]);
      assert.notEqual(exact.arrondi(sansMinimum * 1n), attendu.ht, 'lecture écartée « minimum non réappliqué » distincte de l’attendu');
      const pasDuJour = exact.milliemesHeure(exact.minutesFacturees(attendu.centiemes, PLANCHER, PAS_APRES_COUP));
      assert.deepEqual([pasDuJour, exact.arrondi(pasDuJour * 1n)], [2250n, 2n]);
      assert.notEqual(pasDuJour, attendu.milliemes, 'lecture écartée « pas de la société du jour » distincte de l’attendu (quantité)');
      assert.notEqual(exact.arrondi(pasDuJour * 1n), attendu.ht, 'lecture écartée « pas de la société du jour » distincte de l’attendu (HT)');
      const tvaDuJour = factureTempsPasse([H_ZERO, H_AJOUT_45], { pas: PAS_45, taux: 10 });
      assert.deepEqual([tvaDuJour.tva, tvaDuJour.ttc], [0n, 3n]);
      assert.notEqual(tvaDuJour.ttc, attendu.ttc, 'lecture écartée « TVA du catalogue du jour » distincte de l’attendu');
      assert.notEqual(exact.arrondi(exact.unites('2', 3)), attendu.ht, 'lecture écartée « heures brutes » distincte de l’attendu');
      assert.notEqual(exact.arrondi(exact.milliemesHeure(exact.minutesAuPlusProche(attendu.centiemes, PLANCHER, PAS_45)) * 1n), attendu.ht, 'lecture écartée « pas le plus proche » distincte de l’attendu');

      const reglages = await prisma.parametres.findUniqueOrThrow({ where: { id: 'singleton' }, select: { pasTempsPasseMinutes: true, tempsMinimumMinutes: true } });
      try {
        await ok(appeler('put', '/parametres', { pasTempsPasseMinutes: PAS_45, tempsMinimumMinutes: PLANCHER }));
        const mo = await mainOeuvre('0.01', 'à un centime, pas de 45 min');
        const { devis, intervention } = await chaine(mo, 'minimum réappliqué', [H_ZERO], { plancher: PLANCHER, pas: PAS_45 });
        const zero = await creee(intervention.id, par('AD'));
        assert.deepEqual([...nombres([zero.totalHt, zero.totalTva, zero.totalTtc])], [0, 0, 0]);
        const fZero = await emettre(zero.id, par('AD'));
        assert.deepEqual([fZero.statut, Number(fZero.totalTtc)], ['EMISE', 0]);
        const photoZero = await photo(fZero.id);
        // Après la facture à 0,00 € : pas de la société à 60 min, TVA et prix de la main d'œuvre changés au catalogue.
        await ok(appeler('put', '/parametres', { pasTempsPasseMinutes: PAS_APRES_COUP }));
        await ok(appeler('put', `/catalogue/prestations/${mo.id}`, { estMainOeuvre: true, reference: mo.reference, nom: mo.nom, tauxTva: '10', prixVenteHt: PRIX_APRES_COUP, prixJourHorsContratHt: '0', prixHeureSousContratHt: '0', prixJourSousContratHt: '0', heuresParJour: '7' }));
        await saisirHeures(intervention.id, H_AJOUT_45);
        const lu = await ok(apercu(intervention.id, par('AT')));
        assert.deepEqual(await ok(apercu(intervention.id, par('AD'))), lu, 'même aperçu pour l’administration');
        assert.deepEqual([lu.heures.saisies, lu.heures.minutesSaisies, lu.heures.plancherMinutes, lu.heures.pasMinutes, lu.heures.minutesFacturees, lu.heures.facturees], [2, 120, PLANCHER, PAS_45, Number(attendu.minutes), Number(attendu.milliemes) / 1000]);
        assert.deepEqual([lu.totalHt, lu.totalTva, lu.totalTtc], [euros(attendu.ht), euros(attendu.tva), euros(attendu.ttc)]);
        const nouvelle = await ok(creer(intervention.id, par('AD'), lu.totalHt), 201);
        const relue = await enBase(nouvelle.id);
        assert.deepEqual(montantsEnBase(relue), {
          totaux: [euros(attendu.ht), euros(attendu.tva), euros(attendu.ttc)],
          lignes: [[0, 'PRESTATION', Number(attendu.milliemes) / 1000, 0.01, 20, euros(attendu.ht), euros(attendu.ligneTtc)]],
          ventilation: [[20, euros(attendu.ht), euros(attendu.tva), euros(attendu.ttc)]],
        });
        assert.deepEqual([relue.totalHt.toString(), relue.totalTva.toString(), relue.totalTtc.toString()], ['0.03', '0.01', '0.04'], 'valeurs décimales exactes en base');
        assert.deepEqual(relue.journal.map((j) => [j.action, j.detail]), [['CREATION_BROUILLON', `Origine INTERVENTION, au temps passé : 2 h saisies sur l’intervention et 0 suite facturable, 2,5 h facturées (minimum 15 min, puis tranches de 45 min) ; devis ${devis.numero} v${devis.version}`]]);
        assert.deepEqual(await photo(fZero.id), photoZero, 'facture à 0,00 € inchangée par la création');
      } finally {
        await ok(appeler('put', '/parametres', { pasTempsPasseMinutes: reglages.pasTempsPasseMinutes, tempsMinimumMinutes: reglages.tempsMinimumMinutes }));
      }
      assert.deepEqual(await prisma.parametres.findUniqueOrThrow({ where: { id: 'singleton' }, select: { pasTempsPasseMinutes: true, tempsMinimumMinutes: true } }), { pasTempsPasseMinutes: PAS, tempsMinimumMinutes: PLANCHER });
    });
  });
}
