// Lot AC : cohérence en base des factures et avoirs émis (#243 ; cadrage v2 du 25-11-2026, après le contrôle de cohérence de mode 1
// sur 0e95db2, qui fait foi : sections « Règles imposées », « Mise en œuvre », « Refus métier de l'annulation » et « Tests »).
//
// Décisions appliquées :
//  - décision de Nelson du 19-10-2026 (commentaire de #243), mot pour mot : « #243 on ne refuse pas une piece a emise a montant
//    nul » ;
//  - réponse de Nelson du 10-11-2026, point 5, mot pour mot : « si 0€ pas d'avoir, on ne fais pas d'avoir a 0€ » (garde de #530,
//    inchangée). Lecture retenue par le cadrage, à corriger par Nelson si besoin : une facture émise à 0 / 0 / 0 €, avec ou sans
//    ligne, est admise ; un avoir émis à 0,00 € TTC reste refusé, au message de #530.
//
// Contrat éprouvé (migration 20261125120000_coherence_pieces_emises : fonction verifier_coherence_piece, déclencheur de contrainte
// différé facture_verification_coherence sur « Facture », pour toute pièce non brouillon, à la validation de la transaction) :
//  - R1, signes : totaux, ventilation (HT, TVA, TTC) et lignes (HT, TTC) positifs ou nuls ;
//  - R2, totaux : TTC = HT + TVA ; ventilation égale aux totaux ; TTC = HT + TVA à chaque taux ;
//  - R3, lignes : à chaque taux, somme des HT de ligne = HT de la ventilation ; aucune ligne à un taux absent de la ventilation (un
//    taux de la ventilation sans ligne n'est admis qu'à HT nul) ;
//  - R4, écritures : clés connues (CLIENT, VENTE_PRESTATION, VENTE_ARTICLE sans taux ; TVA:… avec taux) ; client = TTC ; vente,
//    par nature, = somme des HT de ligne de cette nature ; TVA, par taux, = TVA de la ventilation, aucune à un taux absent ; sens
//    inversé pour un avoir ;
//  - non comparés (choix par défaut, à confirmer) : le TTC des lignes, arrondi ligne par ligne, et la TVA recalculée (HT × taux) ;
//  - ordre : le déclencheur passe après les gardes différées du même événement (équilibre des écritures, cycle des statuts, #235,
//    #530, statut d'une facture soldée par ses avoirs), dont les refus restent ceux que l'on voit ;
//  - point 4 du cadrage (choix par défaut, à confirmer) : aucun refus ajouté à l'API ; la facture du cas (g), dont l'annulation par
//    l'API répondait 500, ne s'écrit plus (test plus bas) ; une pièce antérieure est éprouvée par
//    coherence-pieces-emises-migration.test.mjs.
// Messages exacts : ceux de la migration (apostrophes droites, celles de PostgreSQL), le taux écrit par PostgreSQL (« 20.00 »,
// « 5.50 »). Chaque refus est prouvé par l'empreinte de toute la base, inchangée. Aucune route ni aucun droit ne change : les voies
// de l'application sont rejouées par le super administrateur, l'administrateur, le directeur et l'assistante technique ; les routes
// des pièces ne sont pas ouvertes aux clés d'intégration (/api/v1).
//
// Montants (classés C : CLAUDE.md, « un test manquant qui touche un montant ») : le lot ne change aucun calcul. Les valeurs sont
// choisies pour qu'une autre lecture de la règle donne un autre résultat (lecture écartée écrite en commentaire, recalculée par le
// témoin des montants en décimal exact) : TTC des lignes comparé à la ventilation (800 lignes de 0,03 € : 24,00 € de lignes, facture
// de 25,86 €) ; TVA recalculée comparée (avoir différentiel de 0,03 € à 20 % et 0,00 € de TVA) ; tolérance d'un centime (chaque
// égalité éprouvée par un écart d'exactement 0,01 €, dont le refus change de message ou disparaît sous la tolérance).
//
// Comme avoir-non-nul.test.mjs, ce fichier crée sur le serveur de TEST_DATABASE_URL une base jetable qui n'appartient qu'à lui
// (« test » comme mot, suffixe tiré au hasard), la migre, la sert à l'application montée en mémoire, puis la supprime. Sans
// TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';

const TITRE = 'Cohérence en base des pièces émises (lot AC, #243) : signes, totaux, lignes et écritures de toute facture ou tout avoir émis vérifiés au COMMIT ; voies de l’application admises ; facture à 0,00 € admise, avoir à 0,00 € refusé par #530';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Messages exacts de la migration du lot (apostrophes droites, celles de PostgreSQL).
const COHERENCE = {
  negatif: (id) => `La pièce ${id} porte un montant négatif (totaux, ventilation de TVA ou lignes).`,
  totaux: (id) => `La pièce ${id} n'a pas des totaux égaux à sa ventilation de TVA (HT, TVA, TTC = HT + TVA).`,
  lignes: (id, taux) => `Les lignes de la pièce ${id} ne suivent pas sa ventilation à la TVA de ${taux} %.`,
  cleInconnue: (id, cle) => `La pièce ${id} porte une écriture comptable de clé inconnue (${cle}).`,
  client: (id) => `L'écriture client de la pièce ${id} ne vaut pas son TTC.`,
  vente: (id, cle) => `Les écritures de vente de la pièce ${id} ne suivent pas ses lignes (${cle}).`,
  tva: (id, taux) => `Les écritures de TVA de la pièce ${id} ne suivent pas sa ventilation à la TVA de ${taux} %.`,
};
// Messages exacts des gardes existantes, dont l'ordre ne change pas.
const GARDE = {
  desequilibre: (id) => `Écritures comptables non scellées, absentes ou déséquilibrées pour la pièce ${id}`,
  avoirAnnulationOrigine: 'Un avoir d\'annulation est émis et n\'existe qu\'avec sa facture annulée, aux mêmes montants.',
  avoirNegatif: (avoirId, factureId) => `L'avoir ${avoirId} de la facture ${factureId} porte un montant négatif.`,
  avoirIncoherent: (avoirId, factureId) => `L'avoir ${avoirId} de la facture ${factureId} n'a pas des totaux égaux à sa ventilation de TVA (HT, TVA, TTC = HT + TVA).`,
  avoirZero: (avoirId, factureId) => `L'avoir ${avoirId} de la facture ${factureId} est à 0,00 € : Iris n'émet pas d'avoir à 0,00 €.`,
  statutDiffere: (id) => `Facture ${id} : statut EMISE incohérent avec ses règlements et ses avoirs (réglée si le reste dû est nul ou négatif, avec un montant positif réglé ou crédité par des avoirs partiels).`,
};

// --- Calcul exact, hors de l'application (témoin des montants) : centimes entiers, taux en millièmes de pour cent ---
const exact = {
  unites: (valeur, decimales) => {
    const [entier, fraction = ''] = String(valeur).split('.');
    return BigInt(entier) * 10n ** BigInt(decimales) + BigInt((fraction + '0'.repeat(decimales)).slice(0, decimales) || '0');
  },
  // Arrondi au centime, moitié vers le haut (règle d'Iris : arrondiCommercialLigneHt, centimesTtcLigne, tvaDuTaux).
  tva: (baseCentimes, taux) => (baseCentimes * exact.unites(taux, 3) + 50000n) / 100000n,
  ttcLigne: (htCentimes, taux) => (htCentimes * (100000n + exact.unites(taux, 3)) + 50000n) / 100000n,
  // Lectures écartées.
  tvaTronquee: (baseCentimes, taux) => (baseCentimes * exact.unites(taux, 3)) / 100000n,
  tvaAuPair: (baseCentimes, taux) => {
    const produit = baseCentimes * exact.unites(taux, 3); const quotient = produit / 100000n; const reste = produit % 100000n;
    return reste > 50000n || (reste === 50000n && quotient % 2n === 1n) ? quotient + 1n : quotient;
  },
};

// --- Jeu de montants ---
// Facture de 800 petites lignes (cadrage v2, « Tests », voies de l'application ; sonde du contrôle) : 400 × 0,03 € à 5,5 % (nature
// article) et 400 × 0,03 € à 10 % (nature prestation). TTC de chaque ligne : 0,03165 → 0,03 € et 0,033 → 0,03 € ; somme des TTC de
// ligne 24,00 €. Ventilation : 12,00 € à 5,5 % (TVA 0,66 €, TTC 12,66 €) et 12,00 € à 10 % (TVA 1,20 €, TTC 13,20 €) ; facture
// 24,00 € HT, 1,86 € de TVA, 25,86 € TTC. Lecture écartée (mutant « TTC des lignes comparé ») : le TTC des lignes de chaque taux
// (12,00 €) comparé à celui de la ventilation (12,66 €, 13,20 €) refuserait la facture que l'application émet.
const N_PETITES = 400;
const PETITES = [
  ...Array.from({ length: N_PETITES }, () => ({ designation: 'f', nature: 'ARTICLE', quantite: 1, prixUnitaireHt: 0.03, tauxTva: 5.5 })),
  ...Array.from({ length: N_PETITES }, () => ({ designation: 'p', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 0.03, tauxTva: 10 })),
];
// Avoir partiel de 100 + 100 de ces lignes : 3,00 € à 5,5 % (TVA 0,165 → 0,17 € ; lectures écartées : troncature et arrondi au pair,
// 0,16 €) et 3,00 € à 10 % (TVA 0,30 €) : 6,00 € HT, 0,47 € de TVA, 6,47 € TTC, 6,00 € de TTC de lignes.
const AVOIR_PETITES = [...PETITES.slice(0, 100), ...PETITES.slice(N_PETITES, N_PETITES + 100)];
// Avoir partiel différentiel (cadrage v2, « Arrondis de l'application » : TVA de l'avoir = différence des arrondis des bases
// cumulées) : facture de 1 × 1,00 € à 20 % ; A1 = 1 × 0,03 € (base cumulée 0,03 €, TVA 0,006 → 0,01 €) ; A2 = 1 × 0,03 € (base
// cumulée 0,06 €, TVA 0,012 → 0,01 €, moins 0,01 € : 0,00 €). Lecture écartée (mutant « TVA recalculée comparée ») : TVA de A2 =
// 0,03 × 20 % = 0,006 → 0,01 €, qui refuserait l'avoir que l'application émet.
const LIGNE_UN_EURO = [{ designation: 'TEST cohérence un euro', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 1, tauxTva: 20 }];
const LIGNE_TROIS_CENTIMES = [{ designation: 'TEST cohérence trois centimes', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 0.03, tauxTva: 20 }];
const LIGNE_CENT = [{ designation: 'TEST cohérence maintenance', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 100, tauxTva: 20 }];
const LIGNE_OFFERTE = [{ designation: 'TEST cohérence visite offerte', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 0, tauxTva: 20 }];

// Écritures d'une pièce écrite en SQL : [clé, taux ou null, débit, crédit], au débit (D) ou au crédit (C).
const D = (cle, montant, taux = null) => [cle, taux, montant, '0'];
const C = (cle, montant, taux = null) => [cle, taux, '0', montant];
// Facture témoin, cohérente, comme l'application l'écrit : 1 × 10,00 € à 20 %, TVA 2,00 €, TTC 12,00 € ; client au débit, vente et
// TVA au crédit. Chaque cas de refus ne s'en écarte que par ce qu'il éprouve.
const F10 = () => ({
  type: 'FACTURE', totaux: ['10', '2', '12'], lignes: [[20, '10', '12']], ventilation: [[20, '10', '2', '12']],
  ecritures: [D('CLIENT', '12'), C('VENTE_PRESTATION', '10'), C('TVA:20', '2', 20)],
});
// Avoir témoin de 5,00 € HT à 20 % (TVA 1,00 €, TTC 6,00 €), sens inversé : client au crédit, vente et TVA au débit.
const A5 = (factureOrigineId) => ({
  type: 'AVOIR', factureOrigineId, totaux: ['5', '1', '6'], lignes: [[20, '5', '6']], ventilation: [[20, '5', '1', '6']],
  ecritures: [C('CLIENT', '6'), D('VENTE_PRESTATION', '5'), D('TVA:20', '1', 20)],
});

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_coherence_pieces_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;
    const environnementAvant = {};
    const NOMS_ENVIRONNEMENT = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID'];

    let request; let app; let prisma; let appPrisma; let jwt; let db;
    let session = '';
    const comptes = {};
    let rang = 0;
    const suffixe = () => `${Date.now()}${(rang += 1)}`;
    let client = null;
    let identite = null;

    // --- Appels ---
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const par = (cle) => (cle === 'SA' ? entete(session) : entete(jwt.sign({ id: comptes[cle].id }, process.env.JWT_SECRET)));
    const appeler = (methode, chemin, corps, auth = par('SA')) => {
      const requete = request(app)[methode](`/api${chemin}`);
      if (auth) requete.set(auth);
      return methode === 'get' ? requete : requete.send(corps ?? {});
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
    const brouillon = (auth, motif, lignes) => ok(appeler('post', '/factures', {
      clientId: client.id, dateEmission: jour().fr, dateEcheance: jour().fr, lignes, origine: 'HORS_AFFAIRE', motifHorsAffaire: `TEST cohérence ${motif} ${suffixe()}`,
    }, auth), 201);
    const factureEmise = async (auth, motif, lignes) => ok(appeler('post', `/factures/${(await brouillon(auth, motif, lignes)).id}/emettre`, {}, auth));
    const avoirCree = (id, lignes, auth) => ok(appeler('post', `/factures/${id}/avoirs`, { lignes }, auth), 201);

    // --- État de la base ---
    // Empreinte de toute la base (modèle : avoir-non-nul.test.mjs) : chaque table du schéma public, hors historique des migrations,
    // nombre de lignes et empreinte du contenu. Un refus ne doit rien y changer.
    const sqlEmpreinte = (table) => `SELECT '${table}' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${table}" x`;
    let requeteEmpreinte = null;
    const empreinte = async () => {
      if (!requeteEmpreinte) {
        const tables = (await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`).map((t) => t.tablename);
        assert.ok(['Facture', 'FactureLigne', 'FactureVentilationTva', 'EcritureFacture', 'JournalFacture', 'SequenceAvoir'].every((t) => tables.includes(t)), `tables relevées : ${tables.join(', ')}`);
        assert.ok(tables.every((table) => /^[A-Za-z_]+$/.test(table)), 'noms de tables sans guillemet');
        requeteEmpreinte = tables.map(sqlEmpreinte).join(' UNION ALL ');
      }
      return Object.fromEntries((await prisma.$queryRawUnsafe(requeteEmpreinte)).map(({ t, n, h }) => [t, `${n}:${h}`]));
    };
    const tablesChangees = (avant, apres) => Object.keys({ ...avant, ...apres }).filter((t) => avant[t] !== apres[t]);
    // Un refus en base : le message attendu exactement, empreinte de toute la base inchangée. Quand plusieurs taux ou plusieurs clés
    // manquent à une règle, la migration cite le plus petit (tri) : le message est toujours le même.
    const refuseEnBase = async (ecriture, message, quoi) => {
      const avant = await empreinte();
      let erreur = null;
      try { await ecriture(); } catch (e) { erreur = e; }
      assert.ok(erreur, `${quoi} : l’écriture devait être refusée`);
      assert.ok(String(erreur.message).includes(message), `${quoi} : message attendu « ${message} », obtenu ${erreur.message}`);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      return erreur;
    };
    // Transaction vérifiée avant sa fin : Prisma résout une transaction interactive dont le COMMIT échoue.
    const transaction = (operations) => prisma.$transaction(async (tx) => {
      const resultat = await operations(tx);
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return resultat;
    });
    const enBase = (id) => prisma.facture.findUniqueOrThrow({ where: { id }, include: { lignes: { orderBy: { ordre: 'asc' } }, ventilationTva: { orderBy: { tauxTva: 'asc' } }, ecrituresComptables: { orderBy: { ordre: 'asc' } } } });
    const nombres = (liste) => liste.map((valeur) => (valeur === null || valeur === undefined ? valeur : Number(valeur)));
    const totaux = (piece) => nombres([piece.totalHt, piece.totalTva, piece.totalTtc]);
    const ventilation = (piece) => piece.ventilationTva.map((v) => nombres([v.tauxTva, v.totalHt, v.totalTva, v.totalTtc]));
    const ecritures = (piece) => piece.ecrituresComptables.map((e) => [e.cle, e.tauxTva === null ? null : Number(e.tauxTva), Number(e.debit), Number(e.credit)]);
    const sommeCentimes = (valeurs) => valeurs.reduce((s, v) => s + Math.round(Number(v) * 100), 0);
    // La fonction du lot, appelée directement sur une pièce relue : elle l'admet (aucune exception).
    const admiseParLaFonction = async (id) => {
      await prisma.$queryRaw`SELECT verifier_coherence_piece(${id})::text AS r`;
      return true;
    };

    // Pièce écrite directement en base, contenu donné tel quel (aucune valeur déduite) : totaux [HT, TVA, TTC] ; lignes [[taux, HT,
    // TTC, nature]] ; ventilation [[taux, HT, TVA, TTC]] (ou aucune) ; écritures [[clé, taux, débit, crédit]]. Montants en texte
    // décimal, exacts. Émise (par défaut), elle est scellée après ses écritures, dans la même transaction.
    const COMPTES = { CLIENT: '411000', VENTE_PRESTATION: '706000', VENTE_ARTICLE: '707000' };
    const ecrirePiece = async (tx, { id = randomUUID(), type, statut = 'EMISE', factureOrigineId = null, estAvoirAnnulation = false, totaux: [totalHt, totalTva, totalTtc], lignes = [], ventilation: v = [], ecritures: e = [] }) => {
      const date = new Date(`${jour().iso}T00:00:00.000Z`);
      const piece = await tx.facture.create({ data: {
        id, clientId: client.id, clientRaisonSociale: client.raisonSociale, type, statut, factureOrigineId, estAvoirAnnulation,
        dateEmission: date, dateEcheance: date, totalHt, totalTva, totalTtc, origine: 'HORS_AFFAIRE', motifHorsAffaire: 'TEST cohérence écrit en base', identiteEmetteurId: identite,
      } });
      if (lignes.length) {
        await tx.factureLigne.createMany({ data: lignes.map(([taux, ht, ttc, nature = 'PRESTATION'], ordre) => ({
          factureId: id, ordre, designation: `TEST cohérence en base ${taux} %`, nature, quantite: 1, prixUnitaireHt: String(ht).replace('-', ''), tauxTva: taux, totalHt: ht, totalTtc: ttc,
        })) });
      }
      if (v.length) await tx.factureVentilationTva.createMany({ data: v.map(([taux, ht, tva, ttc]) => ({ factureId: id, tauxTva: taux, totalHt: ht, totalTva: tva, totalTtc: ttc })) });
      if (e.length) {
        await tx.ecritureFacture.createMany({ data: e.map(([cle, tauxTva, debit, credit], ordre) => ({
          factureId: id, ordre, cle, tauxTva, journalCode: 'VE', compteNum: COMPTES[cle] ?? '445710', compteLib: `TEST ${cle}`, debit, credit,
        })) });
      }
      if (statut !== 'BROUILLON') await tx.facture.update({ where: { id }, data: { ecrituresScellees: true } });
      return piece;
    };
    const pieceAdmise = (spec) => transaction((tx) => ecrirePiece(tx, spec));
    // Refus d'une pièce écrite en SQL : l'identifiant est posé d'avance pour lire le message exact, qui le cite.
    const pieceRefusee = async (quoi, spec, message) => {
      const id = randomUUID();
      await refuseEnBase(() => transaction((tx) => ecrirePiece(tx, { ...spec, id })), message(id), quoi);
      assert.equal(await prisma.facture.count({ where: { id } }), 0, `${quoi} : la pièce n’existe pas`);
    };

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
      db = new pg.Client({ connectionString: cible.toString() });
      await db.connect();
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      session = connexion.body.token;
      // Identité de la société, plan comptable aux trois taux joués, mentions légales publiées.
      await ok(appeler('put', '/company', { raisonSociale: 'TEST Émetteur cohérence', siret: '24324324300024', adresse: '24 rue des Pièces', codePostal: '14000', ville: 'Caen', fuseauHoraire: 'Europe/Paris' }));
      const compte = (code, libelle, nature) => ok(appeler('post', '/comptabilite/comptes', { code, libelle, nature }), 201);
      const clients = await compte('411000', 'TEST Clients cohérence', 'ACTIF');
      const prestations = await compte('706000', 'TEST Prestations cohérence', 'PRODUIT');
      const articles = await compte('707000', 'TEST Articles cohérence', 'PRODUIT');
      const motif = 'TEST paramétrage comptable du lot AC';
      for (const [cle, donnees] of [['CLIENT', { compteId: clients.id }], ['VENTE_PRESTATION', { compteId: prestations.id }], ['VENTE_ARTICLE', { compteId: articles.id }], ['JOURNAL_VENTES', { journal: 'VE' }]]) {
        await ok(appeler('put', `/comptabilite/regles/${cle}`, { ...donnees, motif }));
      }
      for (const [taux, code] of [[20, '445710'], [5.5, '445711'], [10, '445712']]) {
        const tva = await compte(code, `TEST TVA ${taux} cohérence`, 'TVA');
        await ok(appeler('put', `/comptabilite/tva/${taux}`, { compteId: tva.id, motif }));
      }
      const version = await ok(appeler('post', '/mentions-legales', { mentions: 'TEST mentions cohérence', cgv: 'TEST CGV cohérence', penalites: 'TEST pénalités cohérence' }), 201);
      await ok(appeler('post', `/mentions-legales/${version.version}/publier`));
      for (const [cle, role] of [['AD', 'ADMIN'], ['DIR', 'DIRECTEUR'], ['AT', 'ASSISTANTE_TECHNIQUE']]) {
        const s = suffixe();
        comptes[cle] = await prisma.user.create({ data: { email: `coherence.${cle.toLowerCase()}.${s}@iris.test`, name: `TEST cohérence ${cle} ${s}`, role } });
      }
      for (let essai = 1; ; essai += 1) {
        const res = await appeler('post', '/clients', { raisonSociale: `TEST Client cohérence ${suffixe()}`, siren: String(randomInt(100_000_000, 1_000_000_000)) });
        if (res.status === 409 && essai < 5) continue;
        assert.equal(res.status, 201, JSON.stringify(res.body));
        client = res.body;
        break;
      }
      await ok(appeler('post', `/clients/${client.id}/sites`, { nom: 'TEST Facturation cohérence', adresse: '24 rue des Pièces', codePostal: '14000', ville: 'Caen', estSiteFacturation: true }), 201);
      // L'identité de l'émetteur, figée à la première émission, sert aux pièces écrites en SQL.
      await factureEmise(par('AD'), 'première émission', LIGNE_CENT);
      identite = (await prisma.identiteEmetteur.findFirstOrThrow({ select: { id: true } })).id;
    });

    after(async () => {
      await db?.end().catch(() => {});
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      for (const nom of NOMS_ENVIRONNEMENT) { if (environnementAvant[nom] === undefined) delete process.env[nom]; else process.env[nom] = environnementAvant[nom]; }
      if (baseCreee) await administrationPg.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`).catch(() => {});
      await administrationPg.end().catch(() => {});
    });

    // Règle du rédacteur des tests (montants) : chaque attendu recalculé en décimal exact, hors de l'application, et chaque lecture
    // écartée calculée et distincte de l'attendu.
    test('témoin des montants : 800 lignes de 0,03 € à 5,5 % et 10 % (24,00 € de TTC de lignes, facture de 25,86 €), leur avoir partiel (6,47 €, 6,00 € de TTC de lignes), avoir différentiel de 0,03 € à 20 % (TVA 0,00 €, recalculée 0,01 €) ; chaque lecture écartée distincte', () => {
      // TTC de chaque ligne : 0,03 × 1,055 = 0,03165 → 0,03 ; 0,03 × 1,10 = 0,033 → 0,03.
      assert.deepEqual([exact.ttcLigne(3n, 5.5), exact.ttcLigne(3n, 10)], [3n, 3n]);
      const base = BigInt(N_PETITES) * 3n;
      assert.equal(base, 1200n);
      const [tva55, tva10] = [exact.tva(base, 5.5), exact.tva(base, 10)];
      assert.deepEqual([tva55, tva10], [66n, 120n]);
      const ttcFacture = 2n * base + tva55 + tva10;
      const ttcLignes = 2n * BigInt(N_PETITES) * 3n;
      assert.deepEqual([ttcFacture, ttcLignes], [2586n, 2400n]);
      // Lecture écartée : TTC des lignes de chaque taux comparé à la ventilation (12,00 € contre 12,66 € et 13,20 €).
      assert.notEqual(BigInt(N_PETITES) * exact.ttcLigne(3n, 5.5), base + tva55);
      assert.notEqual(BigInt(N_PETITES) * exact.ttcLigne(3n, 10), base + tva10);
      // Lecture écartée : TVA arrondie ligne par ligne (0,00165 → 0,00 ; 0,003 → 0,00), qui ferait une facture de 24,00 €.
      assert.deepEqual([exact.tva(3n, 5.5), exact.tva(3n, 10)], [0n, 0n]);
      // Avoir partiel : 3,00 € à 5,5 % (0,165 → 0,17 ; troncature et arrondi au pair : 0,16) et 3,00 € à 10 % (0,30).
      assert.deepEqual([exact.tva(300n, 5.5), exact.tvaTronquee(300n, 5.5), exact.tvaAuPair(300n, 5.5), exact.tva(300n, 10)], [17n, 16n, 16n, 30n]);
      assert.equal(600n + 17n + 30n, 647n);
      // Avoir différentiel : A1 = 0,01 € de TVA (0,006 → 0,01) ; A2 = arrondi(0,06 × 20 %) − arrondi(0,03 × 20 %) = 0,01 − 0,01 = 0,00.
      const a1 = exact.tva(3n, 20);
      const a2 = exact.tva(6n, 20) - exact.tva(3n, 20);
      assert.deepEqual([a1, a2], [1n, 0n]);
      // Lecture écartée : TVA de A2 recalculée sur sa base (0,03 × 20 % = 0,006 → 0,01).
      assert.notEqual(exact.tva(3n, 20), a2);
      // Facture de 1,00 € à 20 % : TVA 0,20 €.
      assert.equal(exact.tva(100n, 20), 20n);
    });

    // Cadrage v2, « Preuve qu'aucune pièce produite par l'application n'est refusée » : facture à lignes nombreuses de petits montants,
    // aux taux 5,5 % et 10 % et aux deux natures, émise, créditée en partie puis réglée pour le reste ; la même, émise puis annulée.
    // Copie figée : la règle de TVA à 10 % est remappée sur un autre compte entre l'émission et l'avoir, qui reprend les comptes figés
    // de sa facture. Toutes ces pièces sont admises, et la fonction du lot, appelée sur chacune, les admet. Lectures écartées : TTC des
    // lignes comparé (24,00 € de lignes pour 25,86 €) ; écritures de vente comparées au seul total (et non par nature).
    test('voies de l’application : facture de 800 lignes de 0,03 € à 5,5 % et 10 % (24,00 € de TTC de lignes, 25,86 € TTC) émise par l’administrateur, créditée de 6,47 € par le directeur après le remappage de la TVA à 10 %, réglée pour 19,39 € ; la même annulée par le super administrateur ; toutes admises, et admises par la fonction du lot', async () => {
      const f1 = await factureEmise(par('AD'), 'petites lignes créditée', PETITES);
      assert.deepEqual([...totaux(f1), ...ventilation(f1)], [24, 1.86, 25.86, [5.5, 12, 0.66, 12.66], [10, 12, 1.2, 13.2]]);
      const relue = await enBase(f1.id);
      assert.equal(relue.lignes.length, 2 * N_PETITES);
      assert.equal(sommeCentimes(relue.lignes.map((l) => l.totalTtc)), 2400, 'TTC des lignes : 24,00 €, et non 25,86 €');
      assert.deepEqual(ecritures(relue), [['CLIENT', null, 25.86, 0], ['VENTE_PRESTATION', null, 0, 12], ['VENTE_ARTICLE', null, 0, 12], ['TVA:5.5', 5.5, 0, 0.66], ['TVA:10', 10, 0, 1.2]]);
      // Paramètre modifié après coup : la TVA à 10 % passe sur un autre compte.
      const nouveau = await ok(appeler('post', '/comptabilite/comptes', { code: '445713', libelle: 'TEST TVA 10 remappée', nature: 'TVA' }), 201);
      const regle = (await ok(appeler('get', '/comptabilite'))).reglesTva.find((r) => r.taux === 10);
      await ok(appeler('put', '/comptabilite/tva/10', { compteId: nouveau.id, expectedCompteId: regle.compteId, expectedUpdatedAt: regle.updatedAt, motif: 'TEST remappage après émission' }));
      const avoir = await avoirCree(f1.id, AVOIR_PETITES, par('DIR'));
      assert.deepEqual([...totaux(avoir), ...ventilation(avoir)], [6, 0.47, 6.47, [5.5, 3, 0.17, 3.17], [10, 3, 0.3, 3.3]]);
      const avoirRelu = await enBase(avoir.id);
      assert.equal(sommeCentimes(avoirRelu.lignes.map((l) => l.totalTtc)), 600, 'TTC des lignes de l’avoir : 6,00 €, et non 6,47 €');
      assert.deepEqual(ecritures(avoirRelu), [['CLIENT', null, 0, 6.47], ['VENTE_PRESTATION', null, 3, 0], ['VENTE_ARTICLE', null, 3, 0], ['TVA:5.5', 5.5, 0.17, 0], ['TVA:10', 10, 0.3, 0]]);
      assert.equal(avoirRelu.ecrituresComptables.find((e) => e.cle === 'TVA:10').compteNum, '445712', 'compte figé de la facture d’origine');
      // Règlement du reste dû (25,86 − 6,47 = 19,39 €) : la facture passe « réglée » (écriture sur sa ligne, contrôlée).
      await ok(appeler('post', '/reglements', { clientId: client.id, dateReglement: jour().fr, montant: 19.39, moyen: 'VIREMENT', affectations: [{ factureId: f1.id, montant: 19.39 }] }, par('AD')), 201);
      assert.equal((await enBase(f1.id)).statut, 'REGLEE');
      // La même facture, émise puis annulée : son avoir d'annulation recopie les 800 lignes, la ventilation et les totaux.
      const f2 = await factureEmise(par('AD'), 'petites lignes annulée', PETITES);
      const annulee = await ok(appeler('post', `/factures/${f2.id}/annuler`, {}, par('SA')));
      const avoirTotal = await enBase(annulee.avoir.id);
      assert.deepEqual([annulee.statut, avoirTotal.estAvoirAnnulation, avoirTotal.lignes.length, ...totaux(avoirTotal), ...ventilation(avoirTotal)], ['ANNULEE', true, 2 * N_PETITES, 24, 1.86, 25.86, [5.5, 12, 0.66, 12.66], [10, 12, 1.2, 13.2]]);
      assert.equal(sommeCentimes(avoirTotal.lignes.map((l) => l.totalTtc)), 2400);
      for (const id of [f1.id, avoir.id, f2.id, avoirTotal.id]) assert.equal(await admiseParLaFonction(id), true);
    });

    // Avoir partiel différentiel (cadrage v2 : la TVA d'un avoir partiel suit la différence des arrondis des bases cumulées, et non
    // HT × taux ; « Non imposé » : TVA recalculée). Assistante technique sur sa facture. Lecture écartée (mutant « TVA recalculée
    // comparée ») : l'avoir A2 (0,03 € HT, TVA 0,00 €) refusé, sa TVA recalculée valant 0,01 €.
    test('avoir partiel différentiel admis : l’assistante technique crédite sa facture de 1,00 € à 20 % de 0,03 € (TVA 0,01 €), puis de 0,03 € (TVA 0,00 €, et non 0,01 €) ; écritures sans TVA, admises par la fonction du lot', async () => {
      const facture = await factureEmise(par('AT'), 'différentiel', LIGNE_UN_EURO);
      assert.deepEqual(totaux(facture), [1, 0.2, 1.2]);
      const a1 = await avoirCree(facture.id, LIGNE_TROIS_CENTIMES, par('AT'));
      assert.deepEqual([...totaux(a1), ...ventilation(a1)], [0.03, 0.01, 0.04, [20, 0.03, 0.01, 0.04]]);
      const a2 = await avoirCree(facture.id, LIGNE_TROIS_CENTIMES, par('AT'));
      assert.deepEqual([...totaux(a2), ...ventilation(a2)], [0.03, 0, 0.03, [20, 0.03, 0, 0.03]]);
      assert.deepEqual(ecritures(await enBase(a2.id)), [['CLIENT', null, 0, 0.03], ['VENTE_PRESTATION', null, 0.03, 0]]);
      for (const id of [facture.id, a1.id, a2.id]) assert.equal(await admiseParLaFonction(id), true);
    });

    // Décision du 19-10-2026 (« on ne refuse pas une piece a emise a montant nul ») et réponse du 10-11-2026 (« on ne fais pas d'avoir
    // a 0€ ») : lecture retenue par le cadrage v2. Lectures écartées : facture à 0,00 € refusée (pièce « sans contenu ») ; avoir à
    // 0,00 € admis, ou refusé par la cohérence (autre message que celui de #530).
    test('pièce à 0,00 € : facture émise par l’API avec une ligne offerte admise ; facture à 0 / 0 / 0 € écrite en SQL sans ligne, émise d’emblée ou brouillon puis émise, admise ; avoir à 0,00 € écrit en SQL refusé au COMMIT au message de #530, rien d’écrit', async () => {
      const offerte = await factureEmise(par('AD'), 'ligne offerte', LIGNE_OFFERTE);
      const relue = await enBase(offerte.id);
      assert.deepEqual([relue.statut, ...totaux(relue), ...ventilation(relue), ...ecritures(relue)], ['EMISE', 0, 0, 0, [20, 0, 0, 0], ['CLIENT', null, 0, 0]]);
      assert.equal(await admiseParLaFonction(offerte.id), true);
      const zero = { type: 'FACTURE', totaux: ['0', '0', '0'], ecritures: [D('CLIENT', '0')] };
      const sansLigne = await pieceAdmise(zero);
      assert.deepEqual([(await enBase(sansLigne.id)).statut, (await enBase(sansLigne.id)).lignes.length], ['EMISE', 0]);
      const brouillonZero = await pieceAdmise({ ...zero, statut: 'BROUILLON', ecritures: [] });
      await transaction(async (tx) => {
        await tx.ecritureFacture.create({ data: { factureId: brouillonZero.id, ordre: 0, cle: 'CLIENT', journalCode: 'VE', compteNum: '411000', compteLib: 'TEST CLIENT', debit: 0, credit: 0 } });
        await tx.facture.update({ where: { id: brouillonZero.id }, data: { statut: 'EMISE', ecrituresScellees: true } });
      });
      assert.equal((await enBase(brouillonZero.id)).statut, 'EMISE');
      // Avoir à 0,00 € (cohérent par ailleurs) sur une facture de 120,00 € : refusé par la garde de #530, inchangée.
      const cent = await factureEmise(par('AD'), 'origine avoir à 0,00 €', LIGNE_CENT);
      const id = randomUUID();
      await refuseEnBase(() => transaction((tx) => ecrirePiece(tx, { id, type: 'AVOIR', factureOrigineId: cent.id, totaux: ['0', '0', '0'], lignes: [[20, '0', '0']], ventilation: [[20, '0', '0', '0']], ecritures: [C('CLIENT', '0')] })), GARDE.avoirZero(id, cent.id), 'avoir à 0,00 €');
    });

    // Règle R1 (signes), facture et avoir. Chaque cas n'est refusé que par R1, ou n'a que R1 pour message : lectures écartées (mutants
    // qui retirent une clause de R1) : pièce admise, ou refusée par une autre règle, à un autre message.
    test('R1, signes : facture 15 / −3 / 12 € (cas b2 du cadrage), facture sans contenu à TVA négative, facture à ligne négative, à ligne de TTC négatif, à ventilation de TVA négative, avoir à ligne négative : refusés au COMMIT au message exact, rien d’écrit ; facture et avoir témoins admis', async () => {
      await pieceAdmise(F10());
      const origine = await factureEmise(par('AD'), 'R1 origine', LIGNE_CENT);
      await pieceAdmise(A5(origine.id));
      // (b2) : HT, TVA, ventilation et ligne négatifs ou incohérents, écritures client 12 € et vente 12 € (équilibrées, débit = TTC).
      await pieceRefusee('cas b2, facture 15 / −3 / 12 €', { type: 'FACTURE', totaux: ['15', '-3', '12'], lignes: [[20, '15', '18']], ventilation: [[20, '15', '-3', '12']], ecritures: [D('CLIENT', '12'), C('VENTE_PRESTATION', '12')] }, COHERENCE.negatif);
      // Totaux seuls négatifs (ni ligne ni ventilation). Lecture écartée (clause des totaux retirée) : refus de R2, autre message.
      await pieceRefusee('facture sans contenu à TVA négative', { type: 'FACTURE', totaux: ['15', '-3', '12'], ecritures: [D('CLIENT', '12'), C('VENTE_PRESTATION', '12')] }, COHERENCE.negatif);
      // Ligne négative (+15,00 € et −5,00 € à 20 %), totaux, ventilation et écritures cohérents. Lecture écartée : pièce admise.
      await pieceRefusee('facture à ligne négative', { ...F10(), lignes: [[20, '15', '18'], [20, '-5', '-6']] }, COHERENCE.negatif);
      // Ligne de HT nul et de TTC négatif (−0,01 €), seul écart (le TTC des lignes n'est comparé à rien). Lecture écartée : admise.
      await pieceRefusee('facture à ligne de TTC négatif', { ...F10(), lignes: [[20, '10', '12'], [20, '0', '-0.01']] }, COHERENCE.negatif);
      // Ventilation de TVA négative à 10 % (5,00 € HT, −0,50 € de TVA, 4,50 € TTC), totaux 15 / 1,50 / 16,50 € égaux à la ventilation,
      // lignes égales, écritures équilibrées (client 16,00 € et TVA 10 % au débit pour 0,50 € ; vente 14,50 € et TVA 20 % 2,00 €
      // au crédit). Lecture écartée (clause de la ventilation retirée) : refus de l'écriture client, autre message.
      await pieceRefusee('facture à ventilation de TVA négative', {
        type: 'FACTURE', totaux: ['15', '1.5', '16.5'], lignes: [[20, '10', '12'], [10, '5', '5.5']], ventilation: [[20, '10', '2', '12'], [10, '5', '-0.5', '4.5']],
        ecritures: [D('CLIENT', '16'), C('VENTE_PRESTATION', '14.5'), C('TVA:20', '2', 20), D('TVA:10', '0.5', 10)],
      }, COHERENCE.negatif);
      // Avoir de 10 / 2 / 12 € à lignes +15,00 € et −5,00 € : la garde des avoirs (#235) ne lit pas les lignes.
      await pieceRefusee('avoir à ligne négative', { type: 'AVOIR', factureOrigineId: origine.id, totaux: ['10', '2', '12'], lignes: [[20, '15', '18'], [20, '-5', '-6']], ventilation: [[20, '10', '2', '12']], ecritures: [C('CLIENT', '12'), D('VENTE_PRESTATION', '10'), D('TVA:20', '2', 20)] }, COHERENCE.negatif);
    });

    // Règle R2 (totaux). Chaque écart est d'exactement 0,01 € : lecture écartée (tolérance d'un centime sur l'égalité), la pièce
    // passerait R2 et serait admise, ou refusée par une autre règle, à un autre message.
    test('R2, totaux : TTC ≠ HT + TVA (10 / 2 / 11,99 €, cas a du cadrage), HT ou TVA de la ventilation ≠ totaux d’un centime, TTC d’un taux ≠ HT + TVA d’un centime, ventilation enregistrée 8 / 2 / 10 € sous une ligne de 10,00 € (cas g), facture sans contenu de 12,00 € : refusés au COMMIT au message exact, rien d’écrit', async () => {
      // (a) : écritures équilibrées sur 11,99 € (client 11,99, vente 9,99, TVA 2,00). Tolérance : refus de la vente (9,99 ≠ 10,00).
      await pieceRefusee('cas a, facture 10 / 2 / 11,99 €', { ...F10(), totaux: ['10', '2', '11.99'], ecritures: [D('CLIENT', '11.99'), C('VENTE_PRESTATION', '9.99'), C('TVA:20', '2', 20)] }, COHERENCE.totaux);
      // HT 10,01 € pour une ventilation de 10,00 € (vente 10,01 €). Tolérance : refus de la vente (10,01 ≠ 10,00 de lignes).
      await pieceRefusee('HT de la ventilation ≠ HT de la facture', { ...F10(), totaux: ['10.01', '2', '12.01'], ecritures: [D('CLIENT', '12.01'), C('VENTE_PRESTATION', '10.01'), C('TVA:20', '2', 20)] }, COHERENCE.totaux);
      // TVA 2,01 € pour une ventilation de 2,00 € (écriture de TVA 2,01 €). Tolérance : refus de la TVA (2,01 ≠ 2,00).
      await pieceRefusee('TVA de la ventilation ≠ TVA de la facture', { ...F10(), totaux: ['10', '2.01', '12.01'], ecritures: [D('CLIENT', '12.01'), C('VENTE_PRESTATION', '10'), C('TVA:20', '2.01', 20)] }, COHERENCE.totaux);
      // TTC du taux 12,01 € pour 10,00 + 2,00 €, seul écart. Tolérance : pièce admise.
      await pieceRefusee('TTC d’un taux ≠ HT + TVA', { ...F10(), ventilation: [[20, '10', '2', '12.01']] }, COHERENCE.totaux);
      // (g) : ligne de 10,00 € à 20 %, ventilation enregistrée 8 / 2 / 10 €, écritures 12 = 10 + 2. Sur main, admise, puis son
      // annulation par l'API répondait 500 : elle ne s'écrit plus (point 4 du cadrage : aucun refus ajouté à l'API).
      await pieceRefusee('cas g, ventilation enregistrée 8 / 2 / 10 € sous une ligne de 10,00 €', { ...F10(), ventilation: [[20, '8', '2', '10']] }, COHERENCE.totaux);
      // Ni ligne ni ventilation, totaux 10 / 2 / 12 €.
      await pieceRefusee('facture sans contenu de 12,00 €', { ...F10(), lignes: [], ventilation: [] }, COHERENCE.totaux);
    });

    // Règle R3 (lignes). Taux cité par PostgreSQL (numeric(5,2)). Quand deux taux sont fautifs (cas d), la fonction cite le plus petit
    // (tri numérique). Lectures écartées : pièce admise (règle ou clause retirée, tolérance d'un centime), ou refusée par une autre
    // règle ; taux cité sans tri, ou trié comme du texte (« 20.00 » avant « 5.50 »).
    test('R3, lignes : avoir de 5 / 1 / 6 € ventilé à 20 % dont la ligne est à 5,5 % (cas d), ligne offerte à un taux absent de la ventilation, lignes de 10,01 € pour une ventilation de 10,00 €, taux de ventilation sans ligne à 5,00 € HT : refusés au COMMIT au message exact, rien d’écrit ; taux de ventilation sans ligne à 0,00 € HT admis', async () => {
      const origine = await factureEmise(par('AD'), 'R3 origine', LIGNE_CENT);
      // (d) : ligne de 5,00 € à 5,5 % (TTC 5,28 €) sous une ventilation à 20 % : les taux de 5,5 % et de 20 % sont fautifs, le plus
      // petit est cité (lectures écartées : 20.00, celui d'un tri absent ou textuel).
      await pieceRefusee('cas d, avoir à ligne à 5,5 % ventilé à 20 %', { ...A5(origine.id), lignes: [[5.5, '5', '5.28']] }, (id) => COHERENCE.lignes(id, '5.50'));
      // Ligne offerte (0,00 €) à 5,5 %, taux absent de la ventilation, seul écart. Lecture écartée (clause « aucune ligne à un taux
      // absent » retirée, ou montants seuls comparés) : admise.
      await pieceRefusee('ligne offerte à un taux absent de la ventilation', { ...F10(), lignes: [[20, '10', '12'], [5.5, '0', '0']] }, (id) => COHERENCE.lignes(id, '5.50'));
      // Lignes de 10,01 € pour une ventilation de 10,00 € (vente 10,00 €). Tolérance : refus de la vente (10,00 ≠ 10,01 de lignes).
      await pieceRefusee('lignes de 10,01 € pour une ventilation de 10,00 €', { ...F10(), lignes: [[20, '10.01', '12.01']] }, (id) => COHERENCE.lignes(id, '20.00'));
      // Taux de 10 % dans la ventilation (5,00 € HT), sans ligne à ce taux ; totaux égaux à la ventilation, écritures équilibrées.
      await pieceRefusee('taux de ventilation sans ligne, à 5,00 € HT', {
        type: 'FACTURE', totaux: ['15', '2.5', '17.5'], lignes: [[20, '10', '12']], ventilation: [[20, '10', '2', '12'], [10, '5', '0.5', '5.5']],
        ecritures: [D('CLIENT', '17.5'), C('VENTE_PRESTATION', '15'), C('TVA:20', '2', 20), C('TVA:10', '0.5', 10)],
      }, (id) => COHERENCE.lignes(id, '10.00'));
      // Témoin : un taux de la ventilation sans ligne, à 0,00 € HT, est admis (cadrage v2, R3).
      const temoin = await pieceAdmise({ ...F10(), ventilation: [[5.5, '0', '0', '0'], [20, '10', '2', '12']] });
      assert.deepEqual(ventilation(await enBase(temoin.id)), [[5.5, 0, 0, 0], [20, 10, 2, 12]]);
    });

    // Règle R4 (écritures). Lectures écartées : clé inconnue admise (contrôle par motif, `VENTE_%`, ou clé `TVA` sans taux) ; écriture
    // client lue sans son sens (valeur absolue) ; vente comparée au seul total, sans la nature ; TVA comparée au total, sans le taux ;
    // tolérance d'un centime.
    test('R4, écritures : clés inconnues (TVA sans taux, TVA:20 sans taux, TVA avec taux, CLIENT avec taux, REMISE, VENTE_SERVICE ; deux à la fois, la plus petite citée), facture écrite au sens d’un avoir et avoir au sens d’une facture, client d’un centime de moins, avoir sans écriture de vente (cas c), vente sur la mauvaise nature, vente d’un centime de moins, TVA à un taux absent, TVA de deux taux décalée d’un centime, TVA de deux taux portée au seul taux de 20 %, centime de TVA porté à un taux absent : refusés au COMMIT au message exact, rien d’écrit', async () => {
      const origine = await factureEmise(par('AD'), 'R4 origine', LIGNE_CENT);
      const [ecritureClient, vente, tva] = F10().ecritures;
      // Clés inconnues, chacune seule écart ; écritures équilibrées.
      await pieceRefusee('écriture TVA sans taux', { ...F10(), ecritures: [ecritureClient, vente, C('TVA', '2')] }, (id) => COHERENCE.cleInconnue(id, 'TVA'));
      await pieceRefusee('écriture TVA:20 sans taux', { ...F10(), ecritures: [ecritureClient, vente, C('TVA:20', '2')] }, (id) => COHERENCE.cleInconnue(id, 'TVA:20'));
      // Clé `TVA` sans « : », qui porte un taux, montant égal à la ventilation. Lecture écartée (clé de TVA reconnue au motif `TVA%`) :
      // admise.
      await pieceRefusee('écriture TVA avec un taux, sans « : »', { ...F10(), ecritures: [ecritureClient, vente, C('TVA', '2', 20)] }, (id) => COHERENCE.cleInconnue(id, 'TVA'));
      await pieceRefusee('écriture CLIENT avec un taux', { ...F10(), ecritures: [D('CLIENT', '12', 20), vente, tva] }, (id) => COHERENCE.cleInconnue(id, 'CLIENT'));
      await pieceRefusee('écriture REMISE', { ...F10(), ecritures: [ecritureClient, vente, tva, D('REMISE', '0')] }, (id) => COHERENCE.cleInconnue(id, 'REMISE'));
      await pieceRefusee('écriture VENTE_SERVICE', { ...F10(), ecritures: [ecritureClient, C('VENTE_SERVICE', '10'), tva] }, (id) => COHERENCE.cleInconnue(id, 'VENTE_SERVICE'));
      await pieceRefusee('avoir à écriture TVA sans taux', { ...A5(origine.id), ecritures: [C('CLIENT', '6'), D('VENTE_PRESTATION', '5'), D('TVA', '1')] }, (id) => COHERENCE.cleInconnue(id, 'TVA'));
      // Deux clés inconnues, `TVA` écrite avant `REMISE` : la plus petite est citée (lecture écartée, sans tri : la première écrite).
      await pieceRefusee('deux clés inconnues', { ...F10(), ecritures: [ecritureClient, vente, C('TVA', '2'), D('REMISE', '0')] }, (id) => COHERENCE.cleInconnue(id, 'REMISE'));
      // Sens inversé : la garde d'équilibre ne lit que les sommes (débit = crédit ; débits d'une facture, crédits d'un avoir = TTC).
      await pieceRefusee('facture écrite au sens d’un avoir', { ...F10(), ecritures: [C('CLIENT', '12'), D('VENTE_PRESTATION', '10'), D('TVA:20', '2', 20)] }, COHERENCE.client);
      await pieceRefusee('avoir écrit au sens d’une facture', { ...A5(origine.id), ecritures: [D('CLIENT', '6'), C('VENTE_PRESTATION', '5'), C('TVA:20', '1', 20)] }, COHERENCE.client);
      // Client de 11,99 € et 0,01 € de vente au débit. Tolérance : refus de la vente (9,99 ≠ 10,00).
      await pieceRefusee('écriture client d’un centime de moins', { ...F10(), ecritures: [D('CLIENT', '11.99'), C('VENTE_PRESTATION', '10'), D('VENTE_PRESTATION', '0.01'), tva] }, COHERENCE.client);
      // (c) : avoir de 5 / 1 / 6 €, aucune écriture de vente et 6,00 € de TVA.
      await pieceRefusee('cas c, avoir sans écriture de vente et 6,00 € de TVA', { ...A5(origine.id), ecritures: [C('CLIENT', '6'), D('TVA:20', '6', 20)] }, (id) => COHERENCE.vente(id, 'VENTE_PRESTATION'));
      // Vente d'une ligne de prestation écrite sur la nature article : deux clés fautives, la plus petite citée (lecture écartée :
      // VENTE_PRESTATION).
      await pieceRefusee('vente sur la mauvaise nature', { ...F10(), ecritures: [ecritureClient, C('VENTE_ARTICLE', '10'), tva] }, (id) => COHERENCE.vente(id, 'VENTE_ARTICLE'));
      // Vente de 9,99 € et TVA de 2,01 €. Tolérance : refus de la TVA (2,01 ≠ 2,00).
      await pieceRefusee('vente d’un centime de moins', { ...F10(), ecritures: [ecritureClient, C('VENTE_PRESTATION', '9.99'), C('TVA:20', '2.01', 20)] }, (id) => COHERENCE.vente(id, 'VENTE_PRESTATION'));
      // Écriture de TVA à 5,5 % (0,00 €), taux absent de la ventilation, seul écart.
      await pieceRefusee('TVA à un taux absent de la ventilation', { ...F10(), ecritures: [ecritureClient, vente, tva, C('TVA:5.5', '0', 5.5)] }, (id) => COHERENCE.tva(id, '5.50'));
      // Deux taux : TVA de 2,01 € à 20 % et de 0,99 € à 10 % pour une ventilation de 2,00 € et 1,00 € (total juste). Le plus petit
      // taux est cité. Lectures écartées : TVA comparée au seul total ; tolérance d'un centime (admise) ; 20.00 cité (tri décroissant).
      await pieceRefusee('TVA de deux taux décalée d’un centime', {
        type: 'FACTURE', totaux: ['20', '3', '23'], lignes: [[20, '10', '12'], [10, '10', '11']], ventilation: [[10, '10', '1', '11'], [20, '10', '2', '12']],
        ecritures: [D('CLIENT', '23'), C('VENTE_PRESTATION', '20'), C('TVA:20', '2.01', 20), C('TVA:10', '0.99', 10)],
      }, (id) => COHERENCE.tva(id, '10.00'));
      // TVA des deux taux portée au seul taux de 20 % (3,00 €), aucune écriture à 10 % : les deux taux sont fautifs, le plus petit est
      // cité. Lecture écartée (écriture absente non comptée pour 0,00 € : `e.montant` sans COALESCE) : 20.00, seul taux écrit.
      await pieceRefusee('TVA de deux taux portée au seul taux de 20 %', {
        type: 'FACTURE', totaux: ['20', '3', '23'], lignes: [[20, '10', '12'], [10, '10', '11']], ventilation: [[10, '10', '1', '11'], [20, '10', '2', '12']],
        ecritures: [D('CLIENT', '23'), C('VENTE_PRESTATION', '20'), C('TVA:20', '3', 20)],
      }, (id) => COHERENCE.tva(id, '10.00'));
      // TVA de 1,99 € à 20 % et 0,01 € portés à 5,5 %, taux absent de la ventilation : les deux taux sont fautifs, le plus petit est
      // cité. Lecture écartée (tri absent) : 20.00, que cite le plan sans tri sur ce cas (le cas précédent cite 10.00 avec ou sans tri).
      await pieceRefusee('TVA d’un centime portée à un taux absent', { ...F10(), ecritures: [ecritureClient, vente, C('TVA:20', '1.99', 20), C('TVA:5.5', '0.01', 5.5)] }, (id) => COHERENCE.tva(id, '5.50'));
      // Témoin à deux taux et deux natures, écrit comme l'application l'écrit : admis.
      await pieceAdmise({
        type: 'FACTURE', totaux: ['20', '3', '23'], lignes: [[20, '10', '12'], [10, '6', '6.6', 'ARTICLE'], [10, '4', '4.4']], ventilation: [[10, '10', '1', '11'], [20, '10', '2', '12']],
        ecritures: [D('CLIENT', '23'), C('VENTE_PRESTATION', '14'), C('VENTE_ARTICLE', '6'), C('TVA:10', '1', 10), C('TVA:20', '2', 20)],
      });
    });

    // Contrôle différé, à la validation de la transaction, sur l'état d'alors (cadrage v2, « Mise en œuvre »). Lecture écartée
    // (mutant « déclencheur non différé ») : une pièce insérée émise avant son contenu serait refusée dès son insertion.
    test('contrôle au COMMIT : facture insérée émise avant ses lignes, sa ventilation et ses écritures, admise ; facture du cas a insérée brouillon (admise) puis émise par mise à jour, refusée au COMMIT, restée brouillon ; en SQL direct, chaque instruction passe et le COMMIT est refusé au message exact', async () => {
      // Émise d'abord, contenu ensuite, dans la même transaction.
      const id = randomUUID();
      await transaction(async (tx) => {
        const date = new Date(`${jour().iso}T00:00:00.000Z`);
        await tx.facture.create({ data: { id, clientId: client.id, clientRaisonSociale: client.raisonSociale, type: 'FACTURE', statut: 'EMISE', dateEmission: date, dateEcheance: date, totalHt: 10, totalTva: 2, totalTtc: 12, origine: 'HORS_AFFAIRE', motifHorsAffaire: 'TEST cohérence émise d’abord', identiteEmetteurId: identite } });
        await tx.factureLigne.create({ data: { factureId: id, ordre: 0, designation: 'TEST cohérence émise d’abord', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 10, tauxTva: 20, totalHt: 10, totalTtc: 12 } });
        await tx.factureVentilationTva.create({ data: { factureId: id, tauxTva: 20, totalHt: 10, totalTva: 2, totalTtc: 12 } });
        await tx.ecritureFacture.createMany({ data: F10().ecritures.map(([cle, tauxTva, debit, credit], ordre) => ({ factureId: id, ordre, cle, tauxTva, journalCode: 'VE', compteNum: COMPTES[cle] ?? '445710', compteLib: `TEST ${cle}`, debit, credit })) });
        await tx.facture.update({ where: { id }, data: { ecrituresScellees: true } });
      });
      assert.equal((await enBase(id)).statut, 'EMISE');
      // Cas a, brouillon : un brouillon n'est pas contrôlé.
      const cas = { ...F10(), totaux: ['10', '2', '11.99'] };
      const brouillonA = await pieceAdmise({ ...cas, statut: 'BROUILLON', ecritures: [] });
      await refuseEnBase(() => transaction(async (tx) => {
        await tx.ecritureFacture.createMany({ data: [D('CLIENT', '11.99'), C('VENTE_PRESTATION', '9.99'), C('TVA:20', '2', 20)].map(([cle, tauxTva, debit, credit], ordre) => ({ factureId: brouillonA.id, ordre, cle, tauxTva, journalCode: 'VE', compteNum: COMPTES[cle] ?? '445710', compteLib: `TEST ${cle}`, debit, credit })) });
        await tx.facture.update({ where: { id: brouillonA.id }, data: { statut: 'EMISE', ecrituresScellees: true } });
      }), COHERENCE.totaux(brouillonA.id), 'émission du brouillon du cas a');
      const relu = await enBase(brouillonA.id);
      assert.deepEqual([relu.statut, relu.ecrituresScellees, relu.ecrituresComptables.length], ['BROUILLON', false, 0]);
      // SQL direct (sans SET CONSTRAINTS) : chaque instruction passe, le COMMIT est refusé.
      const idSql = randomUUID();
      const avant = await empreinte();
      await db.query('BEGIN');
      let refus = null;
      try {
        await db.query(`INSERT INTO "Facture" ("id", "clientId", "clientRaisonSociale", "statut", "type", "dateEmission", "dateEcheance", "totalHt", "totalTva", "totalTtc", "origine", "motifHorsAffaire", "identiteEmetteurId", "updatedAt")
          VALUES ($1, $2, $3, 'EMISE', 'FACTURE', $4, $4, 10, 2, 11.99, 'HORS_AFFAIRE', 'TEST cohérence SQL direct', $5, now())`, [idSql, client.id, client.raisonSociale, jour().iso, identite]);
        await db.query(`INSERT INTO "FactureLigne" ("id", "factureId", "ordre", "designation", "nature", "quantite", "prixUnitaireHt", "tauxTva", "totalHt", "totalTtc") VALUES ($1, $2, 0, 'TEST cohérence', 'PRESTATION', 1, 10, 20, 10, 12)`, [randomUUID(), idSql]);
        await db.query(`INSERT INTO "FactureVentilationTva" ("id", "factureId", "tauxTva", "totalHt", "totalTva", "totalTtc") VALUES ($1, $2, 20, 10, 2, 12)`, [randomUUID(), idSql]);
        for (const [ordre, [cle, taux, debit, credit]] of [D('CLIENT', '11.99'), C('VENTE_PRESTATION', '9.99'), C('TVA:20', '2', 20)].entries()) {
          await db.query(`INSERT INTO "EcritureFacture" ("id", "factureId", "ordre", "cle", "tauxTva", "journalCode", "compteNum", "compteLib", "debit", "credit") VALUES ($1, $2, $3, $4, $5, 'VE', '411000', 'TEST', $6, $7)`, [randomUUID(), idSql, ordre, cle, taux, debit, credit]);
        }
        await db.query(`UPDATE "Facture" SET "ecrituresScellees" = true WHERE "id" = $1`, [idSql]);
      } catch (erreur) {
        await db.query('ROLLBACK');
        throw erreur;
      }
      await db.query('COMMIT').catch((erreur) => { refus = erreur; });
      assert.equal(refus?.message, COHERENCE.totaux(idSql), 'refus au COMMIT, au message exact');
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], 'rien n’est écrit');
    });

    // Ordre des refus (cadrage v2 : « nommé pour passer après les gardes différés existants du même événement ») : sur une même pièce
    // fautive pour une garde existante et pour la cohérence, la garde existante garde son message. Lectures écartées (mutants
    // « déclencheur nommé avant » la garde) : message de la cohérence.
    test('ordre des refus : équilibre des écritures, cycle des statuts (avoir d’annulation d’une facture émise), garde des avoirs (#235 : montant négatif, totaux incohérents), avoir à 0,00 € (#530) et statut d’une facture soldée par un avoir gardent leur message exact sur une pièce qui manque aussi à la cohérence', async () => {
      const origine = await factureEmise(par('AD'), 'ordre origine', LIGNE_CENT);
      // Équilibre : facture du cas a (R2) dont les débits (12,00 €) ne valent pas le TTC (11,99 €).
      const desequilibree = randomUUID();
      const erreur = await refuseEnBase(() => transaction((tx) => ecrirePiece(tx, { ...F10(), id: desequilibree, totaux: ['10', '2', '11.99'] })), GARDE.desequilibre(desequilibree), 'équilibre avant cohérence');
      assert.ok(!String(erreur.message).includes(COHERENCE.totaux(desequilibree)));
      // Cycle : avoir d'annulation (12,00 €, écriture `TVA` sans taux, R4) d'une facture restée émise.
      const cycle = await factureEmise(par('AD'), 'ordre cycle', [{ designation: 'TEST cohérence cycle', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 10, tauxTva: 20 }]);
      await refuseEnBase(() => transaction((tx) => ecrirePiece(tx, { ...A5(cycle.id), estAvoirAnnulation: true, totaux: ['10', '2', '12'], lignes: [[20, '10', '12']], ventilation: [[20, '10', '2', '12']], ecritures: [C('CLIENT', '12'), D('VENTE_PRESTATION', '10'), D('TVA', '2')] })), GARDE.avoirAnnulationOrigine, 'cycle avant cohérence');
      // #235, montant négatif : avoir de 5 / −1 / 4 € (R1), écritures équilibrées sur 4,00 €.
      const negatif = randomUUID();
      await refuseEnBase(() => transaction((tx) => ecrirePiece(tx, { id: negatif, type: 'AVOIR', factureOrigineId: origine.id, totaux: ['5', '-1', '4'], lignes: [[20, '5', '6']], ventilation: [[20, '5', '-1', '4']], ecritures: [C('CLIENT', '4'), D('VENTE_PRESTATION', '4')] })), GARDE.avoirNegatif(negatif, origine.id), '#235, montant négatif avant cohérence');
      // #235, totaux incohérents : avoir de 5 / 1 / 6 € ventilé 4 / 1 / 5 € (R2).
      const incoherent = randomUUID();
      await refuseEnBase(() => transaction((tx) => ecrirePiece(tx, { ...A5(origine.id), id: incoherent, lignes: [[20, '4', '4.8']], ventilation: [[20, '4', '1', '5']] })), GARDE.avoirIncoherent(incoherent, origine.id), '#235, totaux incohérents avant cohérence');
      // #530 : avoir à 0,00 € dont la ligne offerte est à 5,5 % sous une ventilation à 20 % (R3).
      const zero = randomUUID();
      await refuseEnBase(() => transaction((tx) => ecrirePiece(tx, { id: zero, type: 'AVOIR', factureOrigineId: origine.id, totaux: ['0', '0', '0'], lignes: [[5.5, '0', '0']], ventilation: [[20, '0', '0', '0']], ecritures: [C('CLIENT', '0')] })), GARDE.avoirZero(zero, origine.id), '#530 avant cohérence');
      assert.deepEqual([(await enBase(origine.id)).statut, await prisma.facture.count({ where: { factureOrigineId: origine.id } })], ['EMISE', 0]);
      // Vérification différée du statut (lot « Statut d'une facture couverte par des avoirs ») : avoir de 120,00 € (écriture `TVA`
      // sans taux, R4) qui solde une facture restée « émise ».
      const soldee = await factureEmise(par('AD'), 'ordre statut', LIGNE_CENT);
      await refuseEnBase(() => transaction((tx) => ecrirePiece(tx, { type: 'AVOIR', factureOrigineId: soldee.id, totaux: ['100', '20', '120'], lignes: [[20, '100', '120']], ventilation: [[20, '100', '20', '120']], ecritures: [C('CLIENT', '120'), D('VENTE_PRESTATION', '100'), D('TVA', '20')] })), GARDE.statutDiffere(soldee.id), 'statut d’une facture soldée avant cohérence');
      assert.equal((await enBase(soldee.id)).statut, 'EMISE');
    });

    // Cadrage v2, « Éprouvé » : « la fonction de contrôle admet toutes les pièces relues ». Toutes les pièces émises de ce fichier, par
    // l'application ou admises en SQL, relues par la fonction du lot.
    test('la fonction du lot admet chaque pièce émise de la base (application et témoins écrits en SQL), relue après tous les tests', async () => {
      const pieces = await prisma.facture.findMany({ where: { statut: { not: 'BROUILLON' } }, select: { id: true } });
      assert.ok(pieces.length >= 15, `${pieces.length} pièces émises`);
      for (const { id } of pieces) assert.equal(await admiseParLaFonction(id), true, id);
    });
  });
}
