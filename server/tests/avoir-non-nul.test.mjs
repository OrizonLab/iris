// Lot « Pas d'avoir à 0,00 € » (cadrage v2, après le contrôle de cohérence de mode 1 : C4, C5, C6, T1, T2 et N8 reportées ;
// section « Critères métier observables », 1 à 7, dont 3 bis ; section « Tests », montants classés C).
//
// Décisions appliquées :
//  - réponse de Nelson du 10-11-2026, point 5, mot pour mot : « si 0€ pas d'avoir, on ne fais pas d'avoir a 0€ ». Question posée,
//    mot pour mot : « Faut-il refuser une ligne d'avoir dont le total s'arrondit à 0,00 € ? Aujourd'hui, Iris l'accepte et lui
//    attribue un numéro. » Lecture retenue par le cadrage, à corriger par Nelson si besoin : une ligne d'avoir partiel dont le HT
//    arrondi au centime est 0,00 € fait refuser tout l'avoir, même si ses autres lignes sont positives ;
//  - réponse de Nelson du 10-11-2026 à la question de l'annulation d'une facture à 0,00 € : « Refuser l'annulation (Recommandé) ».
//    Description de l'option (texte de Claude Code ; seul le choix est de Nelson) : « La facture à 0,00 € reste émise, sans rien à
//    payer ; aucun avoir n'est créé. » ;
//  - garde en base (cadrage v2, § 3, choix par défaut, à confirmer ; principe de #235, « les règles que l'application applique en
//    créant un avoir partiel ou en annulant une facture sont garanties en base, pour un avoir écrit directement en SQL ») : la
//    migration 20261110120000_avoir_non_nul refuse au COMMIT tout avoir émis, partiel ou d'annulation, dont le TTC est 0,00 €.
//
// Contrat éprouvé (messages exacts donnés par Claude Code) :
//  - POST /api/factures/:id/avoirs : une ligne dont le HT arrondi est 0,00 € → 400 « Une ligne d’avoir à 0,00 € n’est pas admise :
//    Iris n’émet pas d’avoir à 0,00 €. », lu avant la transaction et sans regarder la pièce (avant le 404 de l'assistante technique,
//    le 409 du statut de la pièce, le refus du taux absent, le plafond et l'identité), après le refus d'une ligne mal formée ;
//  - POST /api/factures/:id/annuler : une facture émise dont le TTC est exactement 0,00 € → 409 « Une facture à 0,00 € ne s’annule
//    pas : Iris n’émet pas d’avoir à 0,00 €. Elle reste émise, sans rien à payer. », après le 404 (périmètre) et le statut, avant
//    l'identité figée et la séquence ;
//  - verifier_plafond_avoirs (base) : « L'avoir <avoir> de la facture <facture> est à 0,00 € : Iris n'émet pas d'avoir à 0,00 €. »,
//    juste après le refus des montants négatifs ; un avoir brouillon n'est vérifié qu'à son émission.
// Chaque refus est prouvé par l'empreinte de toute la base (journal, séquence, écritures compris) et par la séquence des avoirs
// relue inchangée. Les routes en cause ne sont pas ouvertes aux clés d'intégration (/api/v1) : une clé y reçoit 401.
// La migration jouée sur une base qui porte déjà un avoir à 0,00 € est éprouvée par avoir-non-nul-migration.test.mjs.
//
// Montants (classés C : CLAUDE.md, « un test manquant qui touche un montant ») : chaque valeur est choisie pour qu'une autre lecture
// plausible de la règle donne un autre résultat ; la lecture écartée est écrite en commentaire, et le test « témoin des montants »
// recalcule chaque attendu en décimal exact, hors de l'application, et vérifie que chaque lecture écartée en diffère.
//
// Comme statut-facture-avoirs.test.mjs, ce fichier crée sur le serveur de TEST_DATABASE_URL une base jetable qui n'appartient qu'à
// lui (« test » comme mot, suffixe tiré au hasard), la migre, la sert à l'application montée en mémoire, puis la supprime. Sans
// TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';

const TITRE = 'Pas d’avoir à 0,00 € : ligne d’avoir partiel arrondie à 0,00 € refusée, facture à 0,00 € non annulable, avoir émis à 0,00 € refusé en base';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROLE_AT = 'ASSISTANTE_TECHNIQUE';
const AUTRES_TYPES = [
  ['CT', 'CONDUCTEUR_TRAVAUX'], ['RESP', 'RESPONSABLE'], ['TECH', 'TECHNICIEN'], ['COM', 'COMMERCIAL'],
  ['DC', 'DIRECTEUR_COMMERCIAL'], ['AC', 'ASSISTANTE_COMMERCIALE'], ['CPT', 'COMPTABLE'],
];

// Messages exacts de l'API (apostrophes typographiques).
const REFUS = {
  ligneZero: 'Une ligne d’avoir à 0,00 € n’est pas admise : Iris n’émet pas d’avoir à 0,00 €.',
  annulationZero: 'Une facture à 0,00 € ne s’annule pas : Iris n’émet pas d’avoir à 0,00 €. Elle reste émise, sans rien à payer.',
  ligneInvalide: 'Ligne d’avoir partiel invalide.',
  nonAnnulable: 'Seule une facture émise peut être annulée.',
  nonCreditable: 'Seule une facture émise ou réglée peut recevoir un avoir partiel.',
  tauxAbsent: 'Le taux de TVA d’une ligne d’avoir doit être présent sur la facture d’origine.',
  plafondTotal: 'Cet avoir dépasse le montant total restant à créditer sur la facture d’origine.',
  introuvable: 'Facture introuvable.',
  gestion: 'Accès réservé à l’administration et à l’assistante technique.',
  identite: 'Identité de la société incomplète : renseignez SIRET dans l’écran Société avant d’émettre.',
  dejaSoldee: (numero) => `La facture ${numero} est déjà soldée (reste dû 0,00 €) : elle ne reçoit plus de règlement.`,
};
// Messages exacts des gardes en base (apostrophes droites, celles de PostgreSQL).
const GARDE = {
  avoirZero: (avoirId, factureId) => `L'avoir ${avoirId} de la facture ${factureId} est à 0,00 € : Iris n'émet pas d'avoir à 0,00 €.`,
  montantNegatif: (avoirId, factureId) => `L'avoir ${avoirId} de la facture ${factureId} porte un montant négatif.`,
  incoherent: (avoirId, factureId) => `L'avoir ${avoirId} de la facture ${factureId} n'a pas des totaux égaux à sa ventilation de TVA (HT, TVA, TTC = HT + TVA).`,
  desequilibre: (pieceId) => `Écritures comptables non scellées, absentes ou déséquilibrées pour la pièce ${pieceId}`,
};

// --- Calcul exact, hors de l'application (témoins des montants) ---
// Produit d'une ligne en millièmes de centime (quantité au millième × prix au centime), puis lectures de l'arrondi au centime : moitié
// vers le haut (règle d'Iris, arrondiCommercialLigneHt), troncature, arrondi au pair, arrondi au supérieur.
const exact = {
  unites: (valeur, decimales) => {
    const [entier, fraction = ''] = String(valeur).split('.');
    return BigInt(entier) * 10n ** BigInt(decimales) + BigInt((fraction + '0'.repeat(decimales)).slice(0, decimales) || '0');
  },
  produit: (quantite, prix) => exact.unites(quantite, 3) * exact.unites(prix, 2),
  ligneHt: (quantite, prix) => (exact.produit(quantite, prix) + 500n) / 1000n,
  ligneHtTronquee: (quantite, prix) => exact.produit(quantite, prix) / 1000n,
  ligneHtSuperieure: (quantite, prix) => (exact.produit(quantite, prix) + 999n) / 1000n,
  ligneHtAuPair: (quantite, prix) => {
    const p = exact.produit(quantite, prix); const base = p / 1000n; const reste = p % 1000n;
    return reste > 500n || (reste === 500n && base % 2n === 1n) ? base + 1n : base;
  },
  tva: (baseCentimes, taux) => (baseCentimes * exact.unites(taux, 3) + 50000n) / 100000n,
};

// --- Jeu de montants ---
const ligne = (designation, quantite, prixUnitaireHt, tauxTva = 20, nature = 'PRESTATION') => ({ designation: `TEST zéro ${designation}`, nature, quantite, prixUnitaireHt, tauxTva });
// Facture de 120,00 € : 1 × 100,00 € HT à 20 % (TVA 20,00 €).
const LIGNES_CENT = [ligne('maintenance annuelle', 1, 100)];
// Facture à 0,00 € : prix unitaire nul (admis à la saisie d'une facture), HT, TVA et TTC 0,00 €.
const LIGNES_ZERO = [ligne('visite offerte', 1, 0)];
// Facture de 0,01 € : 1 × 0,01 € HT à 20 %, TVA 0,002 → 0,00 €, TTC 0,01 €. Lecture écartée : « facture sans TVA » prise pour une
// facture à 0,00 € (elle s'annule, par un avoir total de 0,01 €).
const LIGNES_CENTIME = [ligne('petite fourniture', 1, 0.01)];
// Critère 1 : 0,001 × 0,01 € = 0,00001 €, HT arrondi 0,00 €. Lectures écartées : produit brut comparé à zéro (positif, admis) ;
// arrondi au supérieur (0,01 €, admis).
const ZERO_MILLIEME = () => ligne('arrondie à zéro', 0.001, 0.01);
// Critère 3 bis : 0,5 × 0,01 € = 0,005 €, arrondi commercial 0,01 € HT, admis. Lectures écartées : produit brut comparé à 0,01 €
// (0,005 < 0,01, refusé) ; troncature (0,00 €, refusé) ; arrondi au pair (0,00 €, refusé).
const DEMI_CENTIME = () => ligne('demi-centime', 0.5, 0.01);
// Critère 3 bis : 0,499 × 0,01 € = 0,00499 €, arrondi 0,00 €, refusé. Lectures écartées : produit brut comparé à zéro (admis) ; arrondi
// au supérieur (0,01 €, admis).
const SOUS_DEMI_CENTIME = () => ligne('sous le demi-centime', 0.499, 0.01);
// Critère 3 : 1 × 0,01 € HT, TVA 0,002 → 0,00 €, TTC 0,01 €, admis. Lectures écartées : seuil « au moins 0,01 € » appliqué en strict
// (refusé) ; avoir sans TVA pris pour un avoir nul (refusé).
const CENTIME = () => ligne('un centime', 1, 0.01);
// Critère 2 : 1 × 10,00 € HT (TVA 2,00 €, TTC 12,00 €) avec une ligne arrondie à 0,00 €. Lectures écartées : refus sur le seul total
// de l'avoir (12,00 €, admis) ; ligne à 0,00 € ignorée (avoir d'une ligne de 10,00 €) ou gardée (avoir de deux lignes, 10,00 €).
const DIX = () => ligne('dix euros', 1, 10);

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_avoir_non_nul_${randomBytes(6).toString('hex')}`;
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
    const comptes = {};
    let rang = 0;
    const suffixe = () => `${Date.now()}${(rang += 1)}`;
    let client = null;

    // --- Appels ---
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const sa = () => entete(session);
    const par = (cle) => (cle === 'SA' ? sa() : entete(jwt.sign({ id: comptes[cle].id }, process.env.JWT_SECRET)));
    const appeler = (methode, chemin, corps, auth = sa()) => {
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
      return { fr: `${v('day')}-${v('month')}-${v('year')}`, annee: Number(v('year')) };
    };

    // --- État de la base ---
    // Empreinte de toute la base (modèle : statut-facture-avoirs.test.mjs) : chaque table du schéma public, hors historique des
    // migrations, nombre de lignes et empreinte du contenu. Un refus ne doit rien y changer, ni `updatedAt`, ni journal, ni séquence.
    const sqlEmpreinte = (table) => `SELECT '${table}' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${table}" x`;
    let requeteEmpreinte = null;
    const empreinte = async () => {
      if (!requeteEmpreinte) {
        const tables = (await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`).map((t) => t.tablename);
        assert.ok(['Facture', 'FactureLigne', 'SequenceAvoir', 'JournalFacture', 'EcritureFacture'].every((t) => tables.includes(t)), `tables relevées : ${tables.join(', ')}`);
        assert.ok(tables.every((table) => /^[A-Za-z_]+$/.test(table)), 'noms de tables sans guillemet');
        requeteEmpreinte = tables.map(sqlEmpreinte).join(' UNION ALL ');
      }
      return Object.fromEntries((await prisma.$queryRawUnsafe(requeteEmpreinte)).map(({ t, n, h }) => [t, `${n}:${h}`]));
    };
    const tablesChangees = (avant, apres) => Object.keys({ ...avant, ...apres }).filter((t) => avant[t] !== apres[t]);
    const sequence = async () => (await prisma.sequenceAvoir.findUnique({ where: { annee: jour().annee } }))?.dernierNumero ?? 0;
    // Un refus de l'API : statut et message exacts, empreinte de toute la base et séquence des avoirs inchangées.
    const refuse = async (appel, statut, message, quoi) => {
      const [avant, sequenceAvant] = [await empreinte(), await sequence()];
      const res = await appel();
      assert.deepEqual([res.status, res.body?.error], [statut, message], `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      assert.equal(await sequence(), sequenceAvant, `${quoi} : aucun numéro d’avoir consommé`);
      return res;
    };
    // Un refus d'une garde en base : le message exact de PostgreSQL, empreinte de toute la base inchangée.
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
    const enBase = (id) => prisma.facture.findUniqueOrThrow({ where: { id }, include: { journal: { orderBy: { createdAt: 'asc' } }, avoirs: true, lignes: { orderBy: { ordre: 'asc' } }, ventilationTva: true, ecrituresComptables: { orderBy: { ordre: 'asc' } } } });
    const nombres = (liste) => liste.map((valeur) => (valeur === null || valeur === undefined ? valeur : Number(valeur)));

    // --- Données ---
    const creerCompte = async (cle, role) => {
      const s = suffixe();
      comptes[cle] = await prisma.user.create({ data: { email: `zero.${cle.toLowerCase()}.${s}@iris.test`, name: `TEST zéro ${cle} ${s}`, role } });
    };
    const brouillon = (auth, motif, lignes) => ok(appeler('post', '/factures', {
      clientId: client.id, dateEmission: jour().fr, dateEcheance: jour().fr, lignes, origine: 'HORS_AFFAIRE', motifHorsAffaire: `TEST zéro ${motif} ${suffixe()}`,
    }, auth), 201);
    const factureEmise = async (auth, motif, lignes) => ok(appeler('post', `/factures/${(await brouillon(auth, motif, lignes)).id}/emettre`, {}, auth));
    const avoir = (id, lignes, auth) => appeler('post', `/factures/${id}/avoirs`, { lignes }, auth);
    const avoirCree = (id, lignes, auth) => ok(avoir(id, lignes, auth), 201);
    const annuler = (id, auth) => appeler('post', `/factures/${id}/annuler`, {}, auth);
    // Soldes d'une pièce dans la liste non paginée d'un lecteur : [statut, montantAvoirs, montantRegle, resteDu].
    const soldes = async (id, auth = par('AD')) => {
      const f = (await ok(appeler('get', '/factures', null, auth))).find((x) => x.id === id);
      return f ? [f.statut, f.montantAvoirs, f.montantRegle, f.resteDu] : null;
    };
    const numeroAvoir = (n) => `A${jour().annee}-${String(n).padStart(4, '0')}`;

    // Pièce écrite directement en base, comme une création valide (modèle : statut-facture-avoirs.test.mjs) : lignes et ventilation
    // égales aux totaux, écritures équilibrées sur le TTC, scellée. `taux` : [[taux, HT, TVA]] ; `montants` remplace les totaux ;
    // `id` est posé d'avance pour lire le message exact de la garde, qui le cite.
    const pieceSql = async (tx, { id = randomUUID(), type = 'AVOIR', statut = 'EMISE', factureOrigineId = null, estAvoirAnnulation = false, taux, montants = null }) => {
      const centimes = (montant) => Math.round(montant * 100) / 100;
      const totalHt = montants?.totalHt ?? centimes(taux.reduce((s, [, ht]) => s + ht, 0));
      const totalTva = montants?.totalTva ?? centimes(taux.reduce((s, [, , tva]) => s + tva, 0));
      const totalTtc = montants?.totalTtc ?? centimes(totalHt + totalTva);
      const identite = await prisma.identiteEmetteur.findFirstOrThrow({ select: { id: true } });
      const piece = await tx.facture.create({ data: {
        id, clientId: client.id, clientRaisonSociale: client.raisonSociale, type, statut, factureOrigineId, estAvoirAnnulation,
        dateEmission: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`), dateEcheance: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
        totalHt, totalTva, totalTtc, origine: 'HORS_AFFAIRE', motifHorsAffaire: 'TEST zéro écrit en base', identiteEmetteurId: identite.id,
      } });
      await tx.factureLigne.createMany({ data: taux.map(([t, ht, tva], ordre) => ({ factureId: piece.id, ordre, designation: `TEST zéro en base ${t} %`, nature: 'PRESTATION', quantite: 1, prixUnitaireHt: Math.abs(ht), tauxTva: t, totalHt: ht, totalTtc: centimes(ht + tva) })) });
      await tx.factureVentilationTva.createMany({ data: taux.map(([t, ht, tva]) => ({ factureId: piece.id, tauxTva: t, totalHt: ht, totalTva: tva, totalTtc: centimes(ht + tva) })) });
      if (statut !== 'BROUILLON') await sceller(tx, piece);
      return piece;
    };
    // Écritures équilibrées sur le TTC de la pièce, puis scellement.
    const sceller = async (tx, piece) => {
      const [ttc, tva] = [Number(piece.totalTtc), Number(piece.totalTva)];
      const sens = (montant, debit) => (debit === (piece.type === 'FACTURE') ? { debit: montant, credit: 0 } : { debit: 0, credit: montant });
      await tx.ecritureFacture.createMany({ data: [
        { factureId: piece.id, ordre: 0, cle: 'CLIENT', journalCode: 'VE', compteNum: '411000', compteLib: 'TEST Clients', ...sens(Math.max(ttc, 0), true) },
        { factureId: piece.id, ordre: 1, cle: 'VENTE_PRESTATION', journalCode: 'VE', compteNum: '706000', compteLib: 'TEST Ventes', ...sens(Math.max(Math.round((ttc - tva) * 100) / 100, 0), false) },
        { factureId: piece.id, ordre: 2, cle: 'TVA', journalCode: 'VE', compteNum: '445710', compteLib: 'TEST TVA', ...sens(Math.max(tva, 0), false) },
      ] });
      await tx.facture.update({ where: { id: piece.id }, data: { ecrituresScellees: true } });
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
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      session = connexion.body.token;
      // Identité de la société, plan comptable à deux taux, mentions légales publiées.
      await ok(appeler('put', '/company', { raisonSociale: 'TEST Émetteur zéro', siret: '66666666600066', adresse: '6 rue des Avoirs', codePostal: '14000', ville: 'Caen', fuseauHoraire: 'Europe/Paris' }));
      const compte = (code, libelle, nature) => ok(appeler('post', '/comptabilite/comptes', { code, libelle, nature }), 201);
      const clients = await compte('411000', 'TEST Clients zéro', 'ACTIF');
      const prestations = await compte('706000', 'TEST Prestations zéro', 'PRODUIT');
      const articles = await compte('707000', 'TEST Articles zéro', 'PRODUIT');
      const tva20 = await compte('445710', 'TEST TVA 20 zéro', 'TVA');
      const tva55 = await compte('445711', 'TEST TVA 5,5 zéro', 'TVA');
      const motif = 'TEST paramétrage comptable du lot zéro';
      for (const [cle, donnees] of [['CLIENT', { compteId: clients.id }], ['VENTE_PRESTATION', { compteId: prestations.id }], ['VENTE_ARTICLE', { compteId: articles.id }], ['JOURNAL_VENTES', { journal: 'VE' }]]) {
        await ok(appeler('put', `/comptabilite/regles/${cle}`, { ...donnees, motif }));
      }
      await ok(appeler('put', '/comptabilite/tva/20', { compteId: tva20.id, motif }));
      await ok(appeler('put', '/comptabilite/tva/5.5', { compteId: tva55.id, motif }));
      const version = await ok(appeler('post', '/mentions-legales', { mentions: 'TEST mentions zéro', cgv: 'TEST CGV zéro', penalites: 'TEST pénalités zéro' }), 201);
      await ok(appeler('post', `/mentions-legales/${version.version}/publier`));
      for (const [cle, role] of [['AT', ROLE_AT], ['AD', 'ADMIN'], ['DIR', 'DIRECTEUR'], ...AUTRES_TYPES]) await creerCompte(cle, role);
      for (let essai = 1; ; essai += 1) {
        const res = await appeler('post', '/clients', { raisonSociale: `TEST Client zéro ${suffixe()}`, siren: String(randomInt(100_000_000, 1_000_000_000)) });
        if (res.status === 409 && essai < 5) continue;
        assert.equal(res.status, 201, JSON.stringify(res.body));
        client = res.body;
        break;
      }
      await ok(appeler('post', `/clients/${client.id}/sites`, { nom: 'TEST Facturation zéro', adresse: '6 rue des Avoirs', codePostal: '14000', ville: 'Caen', estSiteFacturation: true }), 201);
    });

    after(async () => {
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      for (const nom of NOMS_ENVIRONNEMENT) { if (environnementAvant[nom] === undefined) delete process.env[nom]; else process.env[nom] = environnementAvant[nom]; }
      if (baseCreee) await administrationPg.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`).catch(() => {});
      await administrationPg.end().catch(() => {});
    });

    // Règle du rédacteur des tests (montants) : chaque attendu recalculé en décimal exact, hors de l'application, et chaque lecture
    // écartée calculée et distincte de l'attendu.
    test('témoin des montants : HT arrondi de chaque ligne recalculé en décimal exact (0,001 × 0,01 €, 0,499 × 0,01 €, 0,5 × 0,01 €, 1 × 0,01 €), TVA et TTC des pièces de 0,01 €, chaque lecture écartée distincte de l’attendu', () => {
      // Critère 1 : 0,00001 € → 0,00 €. Lectures écartées : produit brut positif ; arrondi au supérieur.
      assert.equal(exact.produit(0.001, 0.01), 1n, '1 millième de centime');
      assert.equal(exact.ligneHt(0.001, 0.01), 0n);
      assert.ok(exact.produit(0.001, 0.01) > 0n, 'lecture écartée : produit brut comparé à zéro (admis)');
      assert.equal(exact.ligneHtSuperieure(0.001, 0.01), 1n, 'lecture écartée : arrondi au supérieur (admis)');
      // Critère 3 bis, limite admise : 0,005 € → 0,01 €. Lectures écartées : produit brut sous 0,01 € ; troncature ; arrondi au pair.
      assert.equal(exact.produit(0.5, 0.01), 500n);
      assert.equal(exact.ligneHt(0.5, 0.01), 1n);
      assert.ok(exact.produit(0.5, 0.01) < 1000n, 'lecture écartée : produit brut comparé à 0,01 € (refusé)');
      assert.equal(exact.ligneHtTronquee(0.5, 0.01), 0n, 'lecture écartée : troncature (refusé)');
      assert.equal(exact.ligneHtAuPair(0.5, 0.01), 0n, 'lecture écartée : arrondi au pair (refusé)');
      // Critère 3 bis, limite refusée : 0,00499 € → 0,00 €. Lectures écartées : produit brut positif ; arrondi au supérieur.
      assert.equal(exact.produit(0.499, 0.01), 499n);
      assert.equal(exact.ligneHt(0.499, 0.01), 0n);
      assert.ok(exact.produit(0.499, 0.01) > 0n, 'lecture écartée : produit brut comparé à zéro (admis)');
      assert.equal(exact.ligneHtSuperieure(0.499, 0.01), 1n, 'lecture écartée : arrondi au supérieur (admis)');
      // Critère 3 : 0,01 € HT, TVA 0,002 → 0,00 €, TTC 0,01 € (lecture écartée : TVA nulle prise pour un avoir nul).
      assert.equal(exact.ligneHt(1, 0.01), 1n);
      assert.equal(exact.tva(1n, 20), 0n);
      // Deux avoirs de 0,01 € sur la même facture (critère 3 puis 3 bis) : TVA différentielle de la base cumulée 0,02 € : 0,004 → 0,00 €,
      // moins 0,00 € : 0,00 €. Le second avoir vaut donc aussi 0,01 € TTC.
      assert.equal(exact.tva(2n, 20) - exact.tva(1n, 20), 0n);
      // Critère 2 : HT 10,00 € + 0,00 €, TTC 12,00 € : un refus sur le seul total ne verrait rien (lecture écartée).
      const htDeuxLignes = exact.ligneHt(1, 10) + exact.ligneHt(0.001, 0.01);
      assert.deepEqual([htDeuxLignes, htDeuxLignes + exact.tva(htDeuxLignes, 20)], [1000n, 1200n]);
      // Facture de 0,01 € : TVA 0,00 €, TTC 0,01 € ; facture à 0,00 € : tout à zéro.
      assert.deepEqual([exact.ligneHt(1, 0.01), exact.tva(exact.ligneHt(1, 0.01), 20)], [1n, 0n]);
      assert.deepEqual([exact.ligneHt(1, 0), exact.tva(0n, 20)], [0n, 0n]);
      // Facture de 120,00 € : reste dû après deux avoirs de 0,01 € : 119,98 €.
      assert.equal(exact.ligneHt(1, 100) + exact.tva(exact.ligneHt(1, 100), 20) - 2n, 11998n);
    });

    // Critère 1, par chaque compte de l'administration (super administrateur, administrateur, directeur aligné sur elle) sur une
    // facture de l'administration, et par l'assistante technique sur la sienne. Sans la règle, l'API créait un avoir de 0,00 € et lui
    // attribuait un numéro (#526, N5) : 201 (lecture écartée). Le premier avoir admis ensuite prend le numéro qui suit le dernier.
    test('critère 1 : avoir partiel d’une ligne de 0,001 × 0,01 € (HT arrondi 0,00 €) refusé (400 au message exact) par le super administrateur, l’administrateur, le directeur et l’assistante technique (sa facture), sans numéro ni écriture ; la facture reste émise, reste dû 120,00 € ; le premier avoir admis ensuite prend le numéro suivant', async () => {
      const administration = await factureEmise(par('AD'), 'critère 1 administration', LIGNES_CENT);
      const sienne = await factureEmise(par('AT'), 'critère 1 assistante', LIGNES_CENT);
      assert.deepEqual([sienne.creeParType, ...nombres([sienne.totalHt, sienne.totalTva, sienne.totalTtc])], [ROLE_AT, 100, 20, 120]);
      const sequenceAvant = await sequence();
      for (const auteur of ['SA', 'AD', 'DIR']) {
        await refuse(() => avoir(administration.id, [ZERO_MILLIEME()], par(auteur)), 400, REFUS.ligneZero, `ligne à 0,00 € par ${auteur}`);
      }
      await refuse(() => avoir(sienne.id, [ZERO_MILLIEME()], par('AT')), 400, REFUS.ligneZero, 'ligne à 0,00 € par l’assistante technique');
      // L'administration sur la facture de l'assistante : même refus.
      await refuse(() => avoir(sienne.id, [ZERO_MILLIEME()], par('AD')), 400, REFUS.ligneZero, 'ligne à 0,00 € par l’administration sur la facture de l’assistante');
      for (const [f, lecteur] of [[administration, 'AD'], [sienne, 'AT'], [sienne, 'AD']]) {
        assert.deepEqual(await soldes(f.id, par(lecteur)), ['EMISE', 0, 0, 120], `lu par ${lecteur}`);
        const relue = await enBase(f.id);
        assert.deepEqual([relue.statut, relue.avoirs.length], ['EMISE', 0]);
      }
      // Numérotation continue : aucun numéro n'a été pris par les refus.
      const admis = await avoirCree(administration.id, [CENTIME()], par('AD'));
      assert.equal(await sequence(), sequenceAvant + 1);
      assert.equal(admis.numero, numeroAvoir(sequenceAvant + 1), 'le numéro qui suit le dernier avoir');
    });

    // Critère 2 : la ligne à 0,00 € fait refuser tout l'avoir, quelle que soit sa place.
    test('critère 2 : avoir partiel de deux lignes, 1 × 10,00 € HT et 0,001 × 0,01 € (0,00 € arrondi), dans les deux ordres : 400 au message exact, ni avoir de 12,00 €, ni ligne de 10,00 €, sans numéro ni écriture ; par l’administration et l’assistante technique', async () => {
      const administration = await factureEmise(par('AD'), 'critère 2 administration', LIGNES_CENT);
      const sienne = await factureEmise(par('AT'), 'critère 2 assistante', LIGNES_CENT);
      for (const [f, auteur] of [[administration, 'AD'], [administration, 'DIR'], [sienne, 'AT']]) {
        await refuse(() => avoir(f.id, [DIX(), ZERO_MILLIEME()], par(auteur)), 400, REFUS.ligneZero, `${auteur} : 10,00 € puis 0,00 €`);
        await refuse(() => avoir(f.id, [ZERO_MILLIEME(), DIX()], par(auteur)), 400, REFUS.ligneZero, `${auteur} : 0,00 € puis 10,00 €`);
        assert.deepEqual(await soldes(f.id), ['EMISE', 0, 0, 120], auteur);
      }
      // Témoin : la ligne de 10,00 € seule est admise (12,00 € TTC).
      const seul = await avoirCree(administration.id, [DIX()], par('AD'));
      assert.deepEqual(nombres([seul.totalHt, seul.totalTva, seul.totalTtc]), [10, 2, 12]);
    });

    // Critères 3 et 3 bis : la limite de l'arrondi (C6 du contrôle de mode 1). Deux avoirs admis par facture : 1 × 0,01 €, puis
    // 0,5 × 0,01 € (TVA différentielle nulle, voir le témoin) ; 0,499 × 0,01 € refusé entre les deux.
    test('critères 3 et 3 bis : 1 × 0,01 € admis (201 : 0,01 € HT, 0,00 € de TVA, 0,01 € TTC), 0,5 × 0,01 € (0,005 €, arrondi à 0,01 €) admis, 0,499 × 0,01 € (0,00499 €, arrondi à 0,00 €) refusé (400 au message exact) sans numéro ni écriture ; lignes, ventilation et écritures relues en base ; numéros consécutifs ; par l’administration et l’assistante technique', async () => {
      for (const auteur of ['AD', 'AT']) {
        const facture = await factureEmise(par(auteur), `critère 3 ${auteur}`, LIGNES_CENT);
        const sequenceAvant = await sequence();
        // Critère 3. Lecture écartée : avoir sans TVA pris pour un avoir nul (refusé).
        const centime = await avoirCree(facture.id, [CENTIME()], par(auteur));
        assert.deepEqual([centime.type, centime.statut, centime.estAvoirAnnulation, ...nombres([centime.totalHt, centime.totalTva, centime.totalTtc])], ['AVOIR', 'EMISE', false, 0.01, 0, 0.01], auteur);
        // Critère 3 bis, limite refusée. Lectures écartées : produit brut comparé à zéro ; arrondi au supérieur.
        await refuse(() => avoir(facture.id, [SOUS_DEMI_CENTIME()], par(auteur)), 400, REFUS.ligneZero, `${auteur} : 0,499 × 0,01 €`);
        // Critère 3 bis, limite admise. Lectures écartées : produit brut comparé à 0,01 € ; troncature ; arrondi au pair.
        const demi = await avoirCree(facture.id, [DEMI_CENTIME()], par(auteur));
        assert.deepEqual(nombres([demi.totalHt, demi.totalTva, demi.totalTtc]), [0.01, 0, 0.01], auteur);
        for (const a of [centime, demi]) {
          const relu = await enBase(a.id);
          assert.deepEqual(nombres([relu.totalHt, relu.totalTva, relu.totalTtc]), [0.01, 0, 0.01]);
          assert.deepEqual(relu.lignes.map((l) => nombres([l.quantite, l.prixUnitaireHt, l.tauxTva, l.totalHt, l.totalTtc])), [[a.id === demi.id ? 0.5 : 1, 0.01, 20, 0.01, 0.01]]);
          assert.deepEqual(relu.ventilationTva.map((v) => nombres([v.tauxTva, v.totalHt, v.totalTva, v.totalTtc])), [[20, 0.01, 0, 0.01]]);
          const debit = relu.ecrituresComptables.reduce((s, e) => s + Number(e.debit), 0);
          const credit = relu.ecrituresComptables.reduce((s, e) => s + Number(e.credit), 0);
          assert.deepEqual([Math.round(debit * 100), Math.round(credit * 100), relu.ecrituresScellees], [1, 1, true], 'écritures équilibrées sur 0,01 €');
          assert.equal(relu.creeParType, auteur === 'AT' ? ROLE_AT : 'ADMIN');
        }
        // Numéros consécutifs : le refus n'en a pris aucun.
        assert.deepEqual([centime.numero, demi.numero, await sequence()], [numeroAvoir(sequenceAvant + 1), numeroAvoir(sequenceAvant + 2), sequenceAvant + 2], auteur);
        assert.deepEqual(await soldes(facture.id, par(auteur)), ['EMISE', 0.02, 0, 119.98], auteur);
      }
    });

    // Critère 4. Sans la règle, l'annulation créait un avoir total de 0,00 € numéroté et passait la facture « annulée » (lecture
    // écartée) ; l'option écartée « Annuler sans avoir » l'aurait passée « annulée » sans avoir : l'empreinte écarte les deux.
    test('critère 4 : annulation d’une facture émise à 0,00 € refusée (409 au message exact) par le super administrateur, l’administrateur, le directeur et l’assistante technique (sa facture) : la facture reste émise, sans avoir, sans numéro ni écriture ; aucun avoir partiel non plus (ligne à 0,00 € : 400 ; ligne positive : plafond, 409) ; le règlement reste refusé « déjà soldée »', async () => {
      const administration = await factureEmise(par('AD'), 'critère 4 administration', LIGNES_ZERO);
      const sienne = await factureEmise(par('AT'), 'critère 4 assistante', LIGNES_ZERO);
      for (const f of [administration, sienne]) assert.deepEqual([f.statut, ...nombres([f.totalHt, f.totalTva, f.totalTtc])], ['EMISE', 0, 0, 0]);
      for (const auteur of ['SA', 'AD', 'DIR']) await refuse(() => annuler(administration.id, par(auteur)), 409, REFUS.annulationZero, `annulation par ${auteur}`);
      await refuse(() => annuler(sienne.id, par('AT')), 409, REFUS.annulationZero, 'annulation par l’assistante technique, sa facture');
      await refuse(() => annuler(sienne.id, par('AD')), 409, REFUS.annulationZero, 'annulation par l’administration, facture de l’assistante');
      for (const [f, auteur] of [[administration, 'AD'], [sienne, 'AT']]) {
        await refuse(() => avoir(f.id, [ZERO_MILLIEME()], par(auteur)), 400, REFUS.ligneZero, `${auteur} : ligne à 0,00 € sur une facture à 0,00 €`);
        await refuse(() => avoir(f.id, [CENTIME()], par(auteur)), 409, REFUS.plafondTotal, `${auteur} : ligne de 0,01 € sur une facture à 0,00 €`);
        const relue = await enBase(f.id);
        assert.deepEqual([relue.statut, relue.avoirs.length, relue.journal.map((j) => j.action)], ['EMISE', 0, ['CREATION_BROUILLON', 'EMISSION']], auteur);
        assert.deepEqual(await soldes(f.id, par(auteur)), ['EMISE', 0, 0, 0], auteur);
      }
      await refuse(() => appeler('post', '/reglements', { clientId: client.id, dateReglement: jour().fr, montant: 10, moyen: 'VIREMENT', affectations: [{ factureId: administration.id, montant: 10 }] }, par('AD')), 409, REFUS.dejaSoldee(administration.numero), 'règlement sur une facture à 0,00 €');
    });

    // Critère 4, égalité exacte sur le TTC (cadrage v2, § 2 ; N5 du contrôle de mode 1). Une facture de 0,01 € HT à 20 % porte une TVA
    // de 0,00 € : elle s'annule. Lecture écartée : refus fondé sur la TVA nulle (409). Son avoir total de 0,01 € TTC, à TVA nulle, est
    // admis par la garde en base.
    test('critère 4, égalité exacte sur le TTC : une facture de 0,01 € (TVA 0,00 €) s’annule par son avoir total de 0,01 € HT, 0,00 € de TVA, 0,01 € TTC, numéroté, par l’administration et l’assistante technique ; la garde en base l’admet', async () => {
      for (const auteur of ['AD', 'AT']) {
        const facture = await factureEmise(par(auteur), `centime ${auteur}`, LIGNES_CENTIME);
        assert.deepEqual(nombres([facture.totalHt, facture.totalTva, facture.totalTtc]), [0.01, 0, 0.01]);
        const sequenceAvant = await sequence();
        const annulee = await ok(annuler(facture.id, par(auteur)));
        assert.deepEqual([annulee.statut, annulee.avoir.estAvoirAnnulation, annulee.avoir.numero, ...nombres([annulee.avoir.totalHt, annulee.avoir.totalTva, annulee.avoir.totalTtc])], ['ANNULEE', true, numeroAvoir(sequenceAvant + 1), 0.01, 0, 0.01], auteur);
        const relu = await enBase(annulee.avoir.id);
        assert.deepEqual([relu.statut, ...nombres([relu.totalHt, relu.totalTva, relu.totalTtc])], ['EMISE', 0.01, 0, 0.01]);
        assert.equal((await enBase(facture.id)).statut, 'ANNULEE');
      }
    });

    // Critère 5 (et T1 du contrôle de mode 1) : l'assistante technique sur les pièces de l'administration. La ligne à 0,00 € est lue
    // avant la pièce : 400, comme une ligne mal formée, et non le 404 (lecture écartée : refus lu dans la transaction). L'annulation
    // d'une facture à 0,00 € hors de son poste : 404, et non le 409 que reçoit l'administration (lecture écartée : refus de la pièce
    // avant le périmètre).
    test('critère 5 : l’assistante technique, sur les pièces de l’administration : ligne à 0,00 € refusée 400 au message exact, lue avant la pièce (facture émise, brouillon, à 0,00 €, pièce absente) ; annulation d’une facture à 0,00 € ou d’un brouillon à 0,00 € de l’administration : 404 « Facture introuvable. », et non le 409 de l’administration ; sans écriture', async () => {
      const emise = await factureEmise(par('AD'), 'critère 5 émise', LIGNES_CENT);
      const brouillonZero = await brouillon(par('AD'), 'critère 5 brouillon à 0,00 €', LIGNES_ZERO);
      const zero = await factureEmise(par('AD'), 'critère 5 à 0,00 €', LIGNES_ZERO);
      for (const id of [emise.id, brouillonZero.id, zero.id, randomUUID()]) {
        await refuse(() => avoir(id, [ZERO_MILLIEME()], par('AT')), 400, REFUS.ligneZero, `ligne à 0,00 € par elle sur ${id}`);
        await refuse(() => avoir(id, [DIX(), ZERO_MILLIEME()], par('AT')), 400, REFUS.ligneZero, `deux lignes par elle sur ${id}`);
      }
      // Témoin : une ligne positive sur la même pièce de l'administration lui répond 404.
      await refuse(() => avoir(emise.id, [CENTIME()], par('AT')), 404, REFUS.introuvable, 'ligne de 0,01 € par elle, pièce de l’administration');
      await refuse(() => annuler(zero.id, par('AT')), 404, REFUS.introuvable, 'annulation par elle d’une facture à 0,00 € de l’administration');
      await refuse(() => annuler(zero.id, par('AD')), 409, REFUS.annulationZero, 'témoin : l’administration reçoit le refus de la facture à 0,00 €');
      await refuse(() => annuler(brouillonZero.id, par('AT')), 404, REFUS.introuvable, 'annulation par elle d’un brouillon à 0,00 € de l’administration');
      await refuse(() => annuler(randomUUID(), par('AT')), 404, REFUS.introuvable, 'annulation par elle d’une pièce absente');
      assert.equal(await soldes(zero.id, par('AT')), null, 'la facture de l’administration ne figure pas dans sa liste');
    });

    // Critère 6 et T1 du contrôle de mode 1 : ordre des refus de l'avoir partiel. La ligne mal formée garde son refus ; la ligne à
    // 0,00 € passe avant tout ce que la transaction lit (statut de la pièce, taux absent, plafond, identité).
    test('critère 6, ordre des refus de l’avoir partiel : ligne au prix nul ou à quantité nulle → « Ligne d’avoir partiel invalide. » ; ligne à 0,00 € à un taux absent de la facture → nouveau message, et non le refus du taux ; sur une facture brouillon, annulée ou entièrement créditée → nouveau message (400), avant le 409 de la pièce ; identité de la société incomplète → nouveau message, avant le 409 de l’identité ; sans écriture', async () => {
      const facture = await factureEmise(par('AD'), 'critère 6 ordre', LIGNES_CENT);
      const sienne = await factureEmise(par('AT'), 'critère 6 ordre assistante', LIGNES_CENT);
      for (const [f, auteur] of [[facture, 'AD'], [sienne, 'AT']]) {
        // Lecture écartée : nouveau message pour une ligne mal formée (son HT est aussi nul).
        await refuse(() => avoir(f.id, [ligne('prix nul', 1, 0)], par(auteur)), 400, REFUS.ligneInvalide, `${auteur} : prix nul`);
        await refuse(() => avoir(f.id, [ligne('quantité nulle', 0, 10)], par(auteur)), 400, REFUS.ligneInvalide, `${auteur} : quantité nulle`);
        // Lecture écartée : refus du taux, lu dans la transaction, avant la ligne à 0,00 €.
        await refuse(() => avoir(f.id, [ligne('zéro à 5,5 %', 0.001, 0.01, 5.5)], par(auteur)), 400, REFUS.ligneZero, `${auteur} : ligne à 0,00 € à 5,5 %`);
        await refuse(() => avoir(f.id, [ligne('centime à 5,5 %', 1, 0.01, 5.5)], par(auteur)), 400, REFUS.tauxAbsent, `${auteur} : témoin, ligne de 0,01 € à 5,5 %`);
      }
      // Pièce qui ne reçoit pas d'avoir : brouillon, facture annulée, facture entièrement créditée. Lecture écartée : 409 de la pièce.
      const brouillonCent = await brouillon(par('AD'), 'critère 6 brouillon', LIGNES_CENT);
      const annulee = await factureEmise(par('AD'), 'critère 6 annulée', LIGNES_CENT);
      await ok(annuler(annulee.id, par('AD')));
      const creditee = await factureEmise(par('AD'), 'critère 6 créditée', LIGNES_CENT);
      await avoirCree(creditee.id, LIGNES_CENT, par('AD'));
      for (const [f, refusPiece, quoi] of [[brouillonCent, [409, REFUS.nonCreditable], 'brouillon'], [annulee, [409, REFUS.nonCreditable], 'annulée'], [creditee, [409, REFUS.plafondTotal], 'entièrement créditée']]) {
        await refuse(() => avoir(f.id, [ZERO_MILLIEME()], par('AD')), 400, REFUS.ligneZero, `ligne à 0,00 € sur une facture ${quoi}`);
        await refuse(() => avoir(f.id, [CENTIME()], par('AD')), ...refusPiece, `témoin : ligne de 0,01 € sur une facture ${quoi}`);
      }
      // Identité de la société incomplète : la ligne à 0,00 € passe avant (lecture écartée : refus de l'identité, 409).
      const identite = await prisma.companySettings.findUniqueOrThrow({ where: { id: 'singleton' }, select: { siret: true } });
      await prisma.companySettings.update({ where: { id: 'singleton' }, data: { siret: '' } });
      try {
        for (const [f, auteur] of [[facture, 'AD'], [sienne, 'AT']]) {
          await refuse(() => avoir(f.id, [ZERO_MILLIEME()], par(auteur)), 400, REFUS.ligneZero, `${auteur} : ligne à 0,00 €, identité incomplète`);
          await refuse(() => avoir(f.id, [CENTIME()], par(auteur)), 409, REFUS.identite, `${auteur} : témoin, ligne de 0,01 €, identité incomplète`);
        }
      } finally {
        await prisma.companySettings.update({ where: { id: 'singleton' }, data: { siret: identite.siret } });
      }
    });

    // Critère 6 et T1 : ordre des refus de l'annulation. Le statut passe avant la facture à 0,00 € ; la facture à 0,00 € passe avant
    // l'identité figée (et avant la séquence : aucun numéro).
    test('critère 6, ordre des refus de l’annulation : facture brouillon à 0,00 € → « Seule une facture émise peut être annulée. » (administration, assistante sur la sienne) ; facture émise à 0,00 € avec l’identité de la société incomplète → refus de la facture à 0,00 €, et non celui de l’identité ; sans écriture ni numéro', async () => {
      const brouillonAdmin = await brouillon(par('AD'), 'critère 6 brouillon à 0,00 €', LIGNES_ZERO);
      const brouillonSien = await brouillon(par('AT'), 'critère 6 brouillon à 0,00 € assistante', LIGNES_ZERO);
      // Lecture écartée : le refus de la facture à 0,00 € avant le statut.
      for (const auteur of ['SA', 'AD', 'DIR']) await refuse(() => annuler(brouillonAdmin.id, par(auteur)), 409, REFUS.nonAnnulable, `brouillon à 0,00 € par ${auteur}`);
      await refuse(() => annuler(brouillonSien.id, par('AT')), 409, REFUS.nonAnnulable, 'son brouillon à 0,00 €');
      const zeroAdmin = await factureEmise(par('AD'), 'critère 6 identité', LIGNES_ZERO);
      const zeroSienne = await factureEmise(par('AT'), 'critère 6 identité assistante', LIGNES_ZERO);
      const positive = await factureEmise(par('AD'), 'critère 6 identité témoin', LIGNES_CENT);
      const identite = await prisma.companySettings.findUniqueOrThrow({ where: { id: 'singleton' }, select: { siret: true } });
      await prisma.companySettings.update({ where: { id: 'singleton' }, data: { siret: '' } });
      try {
        await refuse(() => annuler(zeroAdmin.id, par('AD')), 409, REFUS.annulationZero, 'facture à 0,00 €, identité incomplète, administration');
        await refuse(() => annuler(zeroSienne.id, par('AT')), 409, REFUS.annulationZero, 'facture à 0,00 €, identité incomplète, assistante');
        await refuse(() => annuler(positive.id, par('AD')), 409, REFUS.identite, 'témoin : facture de 120,00 €, identité incomplète');
      } finally {
        await prisma.companySettings.update({ where: { id: 'singleton' }, data: { siret: identite.siret } });
      }
    });

    // Audit des montants de #530, T1 : ordre de l'annulation, la facture à 0,00 € après les avoirs qu'elle porte (cadrage v2, § 2 :
    // « après le 404 (périmètre), le statut, les avoirs partiels et le règlement reçu »). Un avoir resté brouillon sur une facture à
    // 0,00 € s'écrit en SQL (la garde ne vérifie pas un brouillon) : l'annulation reçoit le refus des avoirs, et non celui de la facture
    // à 0,00 €. Lecture écartée : refus de la facture à 0,00 € placé avant celui des avoirs partiels.
    test('ordre des refus de l’annulation : une facture à 0,00 € qui porte un avoir brouillon (écrit en SQL) reçoit le refus des avoirs partiels, avant celui de la facture à 0,00 € ; sans écriture ni numéro', async () => {
      const zero = await factureEmise(par('AD'), 'ordre avoirs partiels', LIGNES_ZERO);
      await transaction((tx) => pieceSql(tx, { factureOrigineId: zero.id, statut: 'BROUILLON', taux: [[20, 1, 0.2]] }));
      await refuse(() => annuler(zero.id, par('AD')), 409, 'Cette facture porte déjà un ou plusieurs avoirs partiels : elle ne peut plus être annulée en totalité.', 'facture à 0,00 € qui porte un avoir brouillon');
    });

    // Types de compte : la garde des factures (requireGestionFactures) passe avant les nouveaux refus ; les routes ne sont pas ouvertes
    // aux clés d'intégration.
    test('droits : ligne à 0,00 € et annulation d’une facture à 0,00 € refusées aux sept autres types (403 « Accès réservé à l’administration et à l’assistante technique. »), avant les refus du lot ; 401 sans session et par une clé d’intégration ; sans écriture', async () => {
      const facture = await factureEmise(par('AD'), 'droits', LIGNES_CENT);
      const zero = await factureEmise(par('AT'), 'droits à 0,00 €', LIGNES_ZERO);
      const cle = await ok(appeler('post', '/admin/api-keys', { nom: `TEST zéro clé ${suffixe()}`, scopes: ['finances:read', 'clients:read'] }), 201);
      const appels = [
        ['ligne à 0,00 €', (auth) => avoir(facture.id, [ZERO_MILLIEME()], auth)],
        ['annulation d’une facture à 0,00 €', (auth) => annuler(zero.id, auth)],
      ];
      for (const [quoi, appel] of appels) {
        for (const [code] of AUTRES_TYPES) await refuse(() => appel(par(code)), 403, REFUS.gestion, `${quoi} par ${code}`);
        const [avant, sequenceAvant] = [await empreinte(), await sequence()];
        assert.equal((await appel(null)).status, 401, `${quoi} sans session`);
        assert.equal((await appel(entete(cle.apiKey))).status, 401, `${quoi} par une clé d’intégration`);
        assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
        assert.equal(await sequence(), sequenceAvant);
      }
    });

    // Critère 7 : garde en base (migration 20261110120000_avoir_non_nul). Lectures écartées : avant le lot, les deux avoirs à 0,00 €
    // étaient admis au COMMIT (le second est exactement ce que l'API créait en annulant une facture à 0,00 €) ; une garde portée par
    // les lignes refuserait l'avoir total d'une facture qui porte une ligne offerte (voir le test suivant).
    test('critère 7, garde en base : avoir partiel émis à 0,00 € écrit en SQL refusé au COMMIT au message exact (sur une facture de 120,00 € et sur une facture à 0,00 €) ; facture à 0,00 € annulée en SQL avec son avoir d’annulation à 0,00 € refusée au COMMIT au message exact ; avoir de 0,01 € (TVA 0,00 €) admis ; rien d’écrit par les refus', async () => {
      const cent = await factureEmise(par('AD'), 'critère 7 cent', LIGNES_CENT);
      const zero = await factureEmise(par('AD'), 'critère 7 zéro', LIGNES_ZERO);
      for (const f of [cent, zero]) {
        const id = randomUUID();
        await refuseEnBase(() => transaction((tx) => pieceSql(tx, { id, factureOrigineId: f.id, taux: [[20, 0, 0]] })), GARDE.avoirZero(id, f.id), `avoir partiel à 0,00 € sur ${f.numero}`);
        assert.deepEqual([(await enBase(f.id)).statut, (await enBase(f.id)).avoirs.length], ['EMISE', 0]);
      }
      // Avoir d'annulation à 0,00 €, écrit comme l'API l'écrivait avant le lot : facture passée « annulée », puis son avoir total.
      const idAnnulation = randomUUID();
      await refuseEnBase(() => transaction(async (tx) => {
        await tx.facture.update({ where: { id: zero.id }, data: { statut: 'ANNULEE' } });
        return pieceSql(tx, { id: idAnnulation, factureOrigineId: zero.id, estAvoirAnnulation: true, taux: [[20, 0, 0]] });
      }), GARDE.avoirZero(idAnnulation, zero.id), 'avoir d’annulation à 0,00 €');
      assert.equal((await enBase(zero.id)).statut, 'EMISE');
      // Un avoir de 0,01 € HT, TVA 0,00 €, TTC 0,01 € est admis (lectures écartées : TVA nulle refusée ; seuil strict à 0,01 €).
      const centime = await transaction((tx) => pieceSql(tx, { factureOrigineId: cent.id, taux: [[20, 0.01, 0]] }));
      assert.deepEqual(nombres([centime.totalHt, centime.totalTva, centime.totalTtc]), [0.01, 0, 0.01]);
      assert.deepEqual(await soldes(cent.id), ['EMISE', 0.01, 0, 119.99]);
    });

    // Critère 7, suite : la garde porte sur le total, et non sur les lignes (cadrage v2, § 3) : l'avoir total d'une facture positive qui
    // porte une ligne offerte recopie cette ligne et reste admis (N4 du contrôle de mode 1 : le refus par ligne ne vaut que pour
    // l'avoir partiel, qui est saisi). Lecture écartée : garde portée par les lignes (refus au COMMIT, 500).
    test('critère 7, garde portée par le total : la facture de 120,00 € qui porte une ligne offerte à 0,00 € s’annule par son avoir total, qui recopie la ligne offerte (lignes à 100,00 € et 0,00 €), admis en base', async () => {
      const facture = await factureEmise(par('AD'), 'ligne offerte', [...LIGNES_CENT, ligne('déplacement offert', 1, 0)]);
      assert.deepEqual(nombres([facture.totalHt, facture.totalTva, facture.totalTtc]), [100, 20, 120]);
      const annulee = await ok(annuler(facture.id, par('AD')));
      const avoirTotal = await enBase(annulee.avoir.id);
      assert.deepEqual([avoirTotal.statut, avoirTotal.estAvoirAnnulation, ...nombres([avoirTotal.totalHt, avoirTotal.totalTva, avoirTotal.totalTtc])], ['EMISE', true, 100, 20, 120]);
      assert.deepEqual(avoirTotal.lignes.map((l) => nombres([l.prixUnitaireHt, l.totalHt])), [[100, 100], [0, 0]]);
    });

    // Audit des montants de #530, C1 : la garde porte sur le total de l'avoir, et non sur sa ventilation par taux (cadrage v2, § 3).
    // Une ligne offerte à un taux qui lui est propre donne à la facture une ventilation à 0,00 € à ce taux (ventilationTvaDerivee), que
    // son avoir total recopie. Lectures écartées : refus d'un avoir dont une ventilation est à 0,00 € (même forme que le refus des
    // montants négatifs, qui lit aussi la ventilation : refus au COMMIT, 500) ; refus de l'annulation d'une facture dont un taux est à
    // 0,00 € (409). Le test précédent, ligne offerte au même taux que la ligne payante, ne les sépare pas : sa ventilation n'a qu'un taux.
    test('critère 7, garde portée par le total, ligne offerte à un taux propre : la facture de 120,00 € (1 × 100,00 € HT à 20 %) qui porte une ligne offerte à 5,5 % (ventilation à 5,5 % : 0,00 € HT, 0,00 € de TVA) s’annule par son avoir total, qui recopie cette ventilation à 0,00 €, numéroté à la suite, admis en base', async () => {
      const facture = await factureEmise(par('AD'), 'ligne offerte à 5,5 %', [...LIGNES_CENT, ligne('fourniture offerte', 1, 0, 5.5)]);
      assert.deepEqual(nombres([facture.totalHt, facture.totalTva, facture.totalTtc]), [100, 20, 120]);
      const ventilation = (piece) => [...piece.ventilationTva].sort((a, b) => Number(a.tauxTva) - Number(b.tauxTva)).map((v) => nombres([v.tauxTva, v.totalHt, v.totalTva, v.totalTtc]));
      assert.deepEqual(ventilation(await enBase(facture.id)), [[5.5, 0, 0, 0], [20, 100, 20, 120]], 'témoin : la facture porte une ventilation à 0,00 € à 5,5 %');
      const sequenceAvant = await sequence();
      const annulee = await ok(annuler(facture.id, par('AD')));
      assert.deepEqual([annulee.statut, annulee.avoir.estAvoirAnnulation, annulee.avoir.numero], ['ANNULEE', true, numeroAvoir(sequenceAvant + 1)]);
      const avoirTotal = await enBase(annulee.avoir.id);
      assert.deepEqual([avoirTotal.statut, ...nombres([avoirTotal.totalHt, avoirTotal.totalTva, avoirTotal.totalTtc])], ['EMISE', 100, 20, 120]);
      assert.deepEqual(ventilation(avoirTotal), [[5.5, 0, 0, 0], [20, 100, 20, 120]]);
      assert.equal(await sequence(), sequenceAvant + 1);
      assert.equal((await enBase(facture.id)).statut, 'ANNULEE');
    });

    // Audit des montants de #530, C2 : « 0,00 € » se lit sur le TTC, à l'annulation comme dans la garde (cadrage v2, § 2 et § 3 ;
    // corps de la PR : « dont le TTC est exactement 0,00 € », « dont le TTC est 0,00 € »). Une pièce de TVA seule (0,00 € HT, 0,01 €
    // de TVA, 0,01 € TTC) ne se crée pas par l'API, mais s'écrit en SQL : la cohérence de la TVA avec sa base n'est pas gardée en base
    // (#243), et la garde des avoirs la tient pour cohérente (TTC = HT + TVA, ventilation égale aux totaux). Elle crédite ou doit
    // 0,01 € : ni « avoir à 0,00 € », ni « facture à 0,00 € ». Lectures écartées : HT nul, ou lignes toutes à 0,00 € HT (« une facture
    // dont toutes les lignes sont gratuites », texte de la question posée à Nelson) : avoir refusé au COMMIT, annulation refusée (409).
    // Même preuve par l'écriture SQL que le mutant « ≤ 0 », mais en sens inverse : ici, les deux lectures diffèrent. Si #243 garde un
    // jour la TVA par sa base, ces pièces seront refusées à leur écriture, pour une autre raison que l'avoir à 0,00 € : le test changera.
    test('« 0,00 € » se lit sur le TTC : un avoir de TVA seule écrit en SQL (0,00 € HT, 0,01 € de TVA, 0,01 € TTC) est admis par la garde de l’avoir à 0,00 € ; une facture de TVA seule écrite en SQL s’annule par son avoir total de 0,01 € TTC, numéroté à la suite', async () => {
      const facture = await factureEmise(par('AD'), 'avoir de TVA seule', LIGNES_CENT);
      const tvaSeule = await transaction((tx) => pieceSql(tx, { factureOrigineId: facture.id, taux: [[20, 0, 0.01]] }));
      assert.deepEqual([tvaSeule.statut, ...nombres([tvaSeule.totalHt, tvaSeule.totalTva, tvaSeule.totalTtc])], ['EMISE', 0, 0.01, 0.01]);
      assert.deepEqual(await soldes(facture.id), ['EMISE', 0.01, 0, 119.99]);
      // Facture de TVA seule, écrite comme l'application écrit ses écritures (clé `TVA:20`, que l'avoir total reprend), puis émise.
      const factureTvaSeule = await transaction(async (tx) => {
        const piece = await pieceSql(tx, { type: 'FACTURE', statut: 'BROUILLON', taux: [[20, 0, 0.01]] });
        await tx.ecritureFacture.createMany({ data: [
          { factureId: piece.id, ordre: 0, cle: 'CLIENT', journalCode: 'VE', compteNum: '411000', compteLib: 'TEST Clients', debit: 0.01, credit: 0 },
          { factureId: piece.id, ordre: 1, cle: 'TVA:20', tauxTva: 20, journalCode: 'VE', compteNum: '445710', compteLib: 'TEST TVA', debit: 0, credit: 0.01 },
        ] });
        return tx.facture.update({ where: { id: piece.id }, data: { ecrituresScellees: true, statut: 'EMISE' } });
      });
      assert.deepEqual([factureTvaSeule.type, factureTvaSeule.statut, ...nombres([factureTvaSeule.totalHt, factureTvaSeule.totalTva, factureTvaSeule.totalTtc])], ['FACTURE', 'EMISE', 0, 0.01, 0.01]);
      const sequenceAvant = await sequence();
      const annulee = await ok(annuler(factureTvaSeule.id, par('AD')));
      assert.deepEqual([annulee.statut, annulee.avoir.numero, ...nombres([annulee.avoir.totalHt, annulee.avoir.totalTva, annulee.avoir.totalTtc])], ['ANNULEE', numeroAvoir(sequenceAvant + 1), 0, 0.01, 0.01]);
      assert.equal(await sequence(), sequenceAvant + 1);
    });

    // Critère 7 : « un avoir brouillon à 0,00 € n'est pas vérifié tant qu'il n'est pas émis ». Lecture écartée : garde appliquée au
    // brouillon (refus dès son écriture).
    test('critère 7, avoir brouillon à 0,00 € : écrit en base sans refus (un brouillon n’est pas vérifié), puis son émission en SQL est refusée au COMMIT au message exact ; il reste brouillon', async () => {
      const facture = await factureEmise(par('AD'), 'critère 7 brouillon', LIGNES_CENT);
      const brouillonZero = await transaction((tx) => pieceSql(tx, { factureOrigineId: facture.id, statut: 'BROUILLON', taux: [[20, 0, 0]] }));
      assert.deepEqual([brouillonZero.statut, Number(brouillonZero.totalTtc)], ['BROUILLON', 0]);
      await refuseEnBase(() => transaction(async (tx) => {
        await sceller(tx, brouillonZero);
        await tx.facture.update({ where: { id: brouillonZero.id }, data: { statut: 'EMISE' } });
      }), GARDE.avoirZero(brouillonZero.id, facture.id), 'émission de l’avoir brouillon à 0,00 €');
      const relu = await enBase(brouillonZero.id);
      assert.deepEqual([relu.statut, relu.ecrituresScellees, relu.ecrituresComptables.length], ['BROUILLON', false, 0]);
      // La facture reçoit toujours un avoir (le brouillon ne compte pas).
      assert.equal((await avoirCree(facture.id, [CENTIME()], par('AD'))).totalTtc, 0.01);
    });

    // Place du nouveau refus dans la garde (« juste après le refus des montants négatifs ») et égalité exacte de l'annulation (N5 du
    // contrôle de mode 1). Un avoir négatif de TTC nul garde le refus des montants négatifs ; un avoir à 0,00 € mal ventilé reçoit le
    // nouveau refus, avant celui de la cohérence. Une facture émise à TTC négatif ne s'écrit pas en base (écritures au débit positif
    // ou nul, égales au TTC) : à l'annulation, « TTC = 0 » et « TTC ≤ 0 » ne se distinguent donc par aucune facture émise ; le mutant
    // `<= 0` est équivalent (preuve ci-dessous).
    test('garde en base, ordre : avoir de TTC 0,00 € à HT négatif → refus des montants négatifs ; avoir à 0,00 € mal ventilé → refus de l’avoir à 0,00 €, avant celui de la cohérence ; une facture émise à TTC négatif est refusée par l’équilibre des écritures (mutant « ≤ 0 » de l’annulation équivalent)', async () => {
      const facture = await factureEmise(par('AD'), 'ordre de la garde', LIGNES_CENT);
      const negatif = randomUUID();
      await refuseEnBase(() => transaction((tx) => pieceSql(tx, { id: negatif, factureOrigineId: facture.id, taux: [[20, -5, 0]], montants: { totalHt: -5, totalTva: 0, totalTtc: 0 } })), GARDE.montantNegatif(negatif, facture.id), 'avoir à HT négatif et TTC nul');
      const malVentile = randomUUID();
      await refuseEnBase(() => transaction((tx) => pieceSql(tx, { id: malVentile, factureOrigineId: facture.id, taux: [[20, 1, 0.2]], montants: { totalHt: 0, totalTva: 0, totalTtc: 0 } })), GARDE.avoirZero(malVentile, facture.id), 'avoir à 0,00 € mal ventilé');
      // Témoin : le même défaut de ventilation (1,00 € HT ventilé) sur un avoir de 2,40 € reçoit le refus de cohérence.
      const incoherent = randomUUID();
      await refuseEnBase(() => transaction((tx) => pieceSql(tx, { id: incoherent, factureOrigineId: facture.id, taux: [[20, 1, 0.2]], montants: { totalHt: 2, totalTva: 0.4, totalTtc: 2.4 } })), GARDE.incoherent(incoherent, facture.id), 'témoin : avoir de 2,40 € mal ventilé');
      // Facture émise à TTC négatif écrite en SQL : refusée au COMMIT par l'équilibre des écritures (débit client positif ou nul).
      const factureNegative = randomUUID();
      await refuseEnBase(() => transaction((tx) => pieceSql(tx, { id: factureNegative, type: 'FACTURE', taux: [[20, -10, -2]] })), GARDE.desequilibre(factureNegative), 'facture émise à −12,00 €');
    });
  });
}
