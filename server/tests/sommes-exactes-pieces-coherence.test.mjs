// Lot AF : sommes exactes des montants d'une pièce (#684, N1 de l'audit des montants de #681, lot AC ; cadrage v2 du 26-11-2026,
// contrôlé « prêt à coder » par le controleur-coherence en mode 1 : critère « Cas théorique » et section « Tests »). Ce fichier
// prouve, en base, ce que sommes-exactes-pieces.test.mjs prouve sur les fonctions pures : les totaux, la ventilation et les
// écritures que calculent totauxPiece, ventilationTvaDerivee et montantsDesEcritures pour le cas théorique sont admis par la
// cohérence des pièces émises (lot AC : fonction verifier_coherence_piece, déclencheur de contrainte différé
// facture_verification_coherence, au COMMIT), alors que les mêmes montants calculés comme avant (sommes en nombres à virgule,
// arrondies au centime) y sont refusés : c'est le défaut que corrige le lot (une facture refusée par la base, en 500, au lieu d'une
// facture juste).
//
// Fixture THÉORIQUE (règle 4 de la méthode : construite, aucune donnée réelle) : le cas ne s'atteint par aucun chemin de l'API (la
// limite de 100 Ko du corps borne une facture à environ 1 550 lignes, alors qu'une dérive en exige au moins 5 460, N1 du contrôle).
// La pièce est donc écrite en SQL, émise et scellée d'emblée, comme l'écrit coherence-pieces-emises.test.mjs : 20 001 lignes en une
// instruction (generate_series), par une connexion pg et une transaction SQL ordinaire, et non par une transaction interactive de
// Prisma, que son délai de 5 s aurait pu couper (#573). Les montants écrits sont ceux que rendent les fonctions du serveur compilé,
// appelées sur les mêmes lignes ; ils sont comparés d'abord au témoin en entiers (centimes), puis relus en base en numeric.
//
// Cas (la grande ligne en tête, ordre 0 : petites lignes d'abord, la somme en flottants tomberait juste, N2 du contrôle) :
//  - 8 589 934 592,00 € puis 20 000 prestations de 0,03 €, à 0 % : 8 589 935 192,00 € admis ; lecture écartée, le code d'avant,
//    8 589 935 192,01 € (totaux, ventilation et écritures), refusé au COMMIT au message des lignes ;
//  - 8 589 934 592,00 € puis 20 000 articles de 0,07 €, à 0 % : 8 589 935 992,00 € admis ; écarté, 8 589 935 991,99 €, refusé ;
//  - 4 294 967 296,03 € puis 20 000 prestations de 0,03 €, à 20 % : 4 294 967 896,03 € HT, 858 993 579,21 € de TVA, 5 153 961 475,24 €
//    TTC admis ; écarté, 4 294 967 896,02 € HT, 858 993 579,20 € de TVA, 5 153 961 475,22 € TTC, refusé.
// Le refus du code d'avant tombe sur la règle des lignes (R3) : ses totaux égalent sa ventilation et ses écritures s'équilibrent,
// mais la somme exacte des lignes, que la base calcule en numeric, s'écarte d'un centime de la ventilation. Message exact de la
// migration (taux écrit par PostgreSQL : « 0.00 », « 20.00 ») ; refus prouvé par l'empreinte de toute la base, inchangée.
//
// Montants (classés C : CLAUDE.md, « un test manquant qui touche un montant ») : attendus écrits en dur, en centimes, recalculés par
// le témoin en entiers ; lecture écartée (somme en flottants) calculée par le modèle du code d'avant, distincte de l'attendu.
//
// Comme coherence-pieces-emises.test.mjs, ce fichier crée sur le serveur de TEST_DATABASE_URL une base jetable qui n'appartient qu'à
// lui (« test » comme mot, suffixe tiré au hasard), la migre, la sert à l'application montée en mémoire (première émission par
// l'API, qui fige l'identité de l'émetteur), puis la supprime. Sans TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est
// pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { requeteEmpreinte, tablesChangees } from './matrice-droits/outils.mjs';

const TITRE = 'Sommes exactes des montants d’une pièce (lot AF, #684 N1), en base : les totaux, la ventilation et les écritures exacts du cas théorique de 20 001 lignes sont admis par la cohérence des pièces émises (lot AC) ; les mêmes en flottants, comme avant, sont refusés au COMMIT';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REFUS_LIGNES = (id, taux) => `Les lignes de la pièce ${id} ne suivent pas sa ventilation à la TVA de ${taux} %.`;
const COMPTES = { CLIENT: '411000', VENTE_PRESTATION: '706000', VENTE_ARTICLE: '707000' };

// --- Témoin en entiers (centimes), hors de l'application ---
const unites = (texte, decimales) => {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(texte));
  assert.ok(m && (m[2] ?? '').length <= decimales, `« ${texte} » : au plus ${decimales} décimales`);
  return BigInt(m[1]) * 10n ** BigInt(decimales) + BigInt((m[2] ?? '').padEnd(decimales, '0') || '0');
};
const tvaExacte = (base, taux) => (base * unites(taux, 3) + 50000n) / 100000n;
const euros = (centimes) => Number(centimes) / 100;
// Centimes → texte numeric écrit par PostgreSQL pour une colonne Decimal(12, 2).
const enNumeric = (centimes) => `${centimes / 100n}.${String(centimes % 100n).padStart(2, '0')}`;
// Résultat de l'application relu en centimes : au plus deux décimales.
const lu = (valeur, quoi) => {
  assert.equal(typeof valeur, 'number', `${quoi} : un nombre`);
  assert.match(String(valeur), /^\d+(\.\d{1,2})?$/, `${quoi} : au plus deux décimales (lu ${valeur})`);
  return unites(String(valeur), 2);
};

// --- Le code d'avant (sommes de main 9791f66) : lecture écartée ---
const centimesAvant = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const sommeAvant = (valeurs) => centimesAvant(valeurs.reduce((s, v) => s + Number(v), 0));
const avant = (lignes, taux) => {
  const totalHt = sommeAvant(lignes.map((l) => l.totalHt));
  const totalTva = euros(tvaExacte(lu(totalHt, 'base d’avant'), taux));
  const totalTtc = centimesAvant(totalHt + totalTva);
  const ventilation = [{ tauxTva: taux, totalHt, totalTva, totalTtc }];
  const ecritures = new Map([['CLIENT', { debit: totalTtc, credit: 0 }]]);
  for (const nature of ['PRESTATION', 'ARTICLE']) {
    const ht = sommeAvant(lignes.filter((l) => l.nature === nature).map((l) => l.totalHt));
    if (ht) ecritures.set(`VENTE_${nature}`, { debit: 0, credit: ht });
  }
  if (totalTva) ecritures.set(`TVA:${taux}`, { debit: 0, credit: totalTva, tauxTva: taux });
  return { totaux: { totalHt, totalTva, totalTtc }, ventilation, ecritures };
};

// --- Jeu de montants (centimes) ---
const NOMBRE = 20_000;
const CAS = [
  // 8 589 935 192,00 € ; écarté : 8 589 935 192,01 €.
  { nom: '0,03 € en prestations à 0 %', tete: 858993459200n, petite: 3n, taux: 0, nature: 'PRESTATION', tauxPg: '0.00',
    ht: 858993519200n, tva: 0n, ttc: 858993519200n, flottants: { ht: 858993519201n, tva: 0n, ttc: 858993519201n } },
  // 8 589 935 992,00 € ; écarté : 8 589 935 991,99 €.
  { nom: '0,07 € en articles à 0 %', tete: 858993459200n, petite: 7n, taux: 0, nature: 'ARTICLE', tauxPg: '0.00',
    ht: 858993599200n, tva: 0n, ttc: 858993599200n, flottants: { ht: 858993599199n, tva: 0n, ttc: 858993599199n } },
  // 4 294 967 896,03 € HT, TVA 858 993 579,206 € → 858 993 579,21 €, 5 153 961 475,24 € TTC ; écarté : …896,02 €, …579,20 €, …475,22 €.
  { nom: '0,03 € en prestations à 20 %', tete: 429496729603n, petite: 3n, taux: 20, nature: 'PRESTATION', tauxPg: '20.00',
    ht: 429496789603n, tva: 85899357921n, ttc: 515396147524n, flottants: { ht: 429496789602n, tva: 85899357920n, ttc: 515396147522n } },
];
const lignesDuCas = (c) => [
  { tauxTva: c.taux, totalHt: euros(c.tete), nature: c.nature },
  ...Array.from({ length: NOMBRE }, () => ({ tauxTva: c.taux, totalHt: euros(c.petite), nature: c.nature })),
];

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_sommes_exactes_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;
    const environnementAvant = {};
    const NOMS_ENVIRONNEMENT = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID'];

    let request; let app; let appPrisma; let db;
    let fonctions = null;
    let session = '';
    let client = null;
    let identite = null;
    let requeteDeLEmpreinte = null;
    let rang = 0;
    const suffixe = () => `${Date.now()}${(rang += 1)}`;

    const appeler = (methode, chemin, corps) => {
      const requete = request(app)[methode](`/api${chemin}`).set({ Authorization: `Bearer ${session}` });
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
      return `${v('day')}-${v('month')}-${v('year')}`;
    };
    // Empreinte de toute la base (chaque table du schéma public, contenu compris) : un refus ne doit rien y changer.
    const empreinte = async () => (await db.query(requeteDeLEmpreinte)).rows[0];

    // Pièce émise écrite en SQL, en une transaction : la facture, ses 20 001 lignes en une instruction, sa ventilation, ses
    // écritures, puis son scellement. Les montants sont donnés tels quels (texte numeric) ; la cohérence les juge au COMMIT.
    const ecrirePiece = async (id, c, { totaux, ventilation, ecritures }) => {
      await db.query('BEGIN');
      try {
        await db.query(`INSERT INTO "Facture" ("id","clientId","clientRaisonSociale","type","statut","dateEmission","dateEcheance","totalHt","totalTva","totalTtc","origine","motifHorsAffaire","identiteEmetteurId","updatedAt")
          VALUES ($1,$2,$3,'FACTURE','EMISE',current_date,current_date,$4::numeric,$5::numeric,$6::numeric,'HORS_AFFAIRE','TEST sommes exactes, fixture théorique',$7,now())`,
        [id, client.id, client.raisonSociale, String(totaux.totalHt), String(totaux.totalTva), String(totaux.totalTtc), identite]);
        await db.query(`INSERT INTO "FactureLigne" ("id","factureId","ordre","designation","nature","quantite","prixUnitaireHt","tauxTva","totalHt","totalTtc")
          SELECT gen_random_uuid()::text, $1, 0, 'TEST sommes exactes, grande ligne en tête', $2, 1, $3::numeric, $5::numeric, $3::numeric, $6::numeric
          UNION ALL
          SELECT gen_random_uuid()::text, $1, g, 'TEST sommes exactes, petite ligne', $2, 1, $4::numeric, $5::numeric, $4::numeric, $7::numeric FROM generate_series(1, $8::int) AS g`,
        [id, c.nature, enNumeric(c.tete), enNumeric(c.petite), String(c.taux), enNumeric(c.tete + tvaLigne(c.tete, c.taux)), enNumeric(c.petite + tvaLigne(c.petite, c.taux)), NOMBRE]);
        for (const v of ventilation) {
          await db.query(`INSERT INTO "FactureVentilationTva" ("id","factureId","tauxTva","totalHt","totalTva","totalTtc") VALUES (gen_random_uuid()::text,$1,$2::numeric,$3::numeric,$4::numeric,$5::numeric)`,
            [id, String(v.tauxTva), String(v.totalHt), String(v.totalTva), String(v.totalTtc)]);
        }
        let ordre = 0;
        for (const [cle, m] of ecritures) {
          await db.query(`INSERT INTO "EcritureFacture" ("id","factureId","ordre","cle","tauxTva","journalCode","compteNum","compteLib","debit","credit") VALUES (gen_random_uuid()::text,$1,$2,$3,$4::numeric,'VE',$5,$6,$7::numeric,$8::numeric)`,
            [id, ordre, cle, m.tauxTva === undefined ? null : String(m.tauxTva), COMPTES[cle] ?? '445710', `TEST ${cle}`, String(m.debit), String(m.credit)]);
          ordre += 1;
        }
        await db.query(`UPDATE "Facture" SET "ecrituresScellees" = true WHERE "id" = $1`, [id]);
        await db.query('COMMIT');
      } catch (erreur) {
        await db.query('ROLLBACK').catch(() => {});
        throw erreur;
      }
    };
    // TTC d'une ligne au taux de la pièce, arrondi au centime (centimesTtcLigne, inchangée ; non comparé par la cohérence).
    const tvaLigne = (ht, taux) => (ht * (100000n + unites(taux, 3)) + 50000n) / 100000n - ht;

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
      fonctions = {
        ...(await import('../dist/src/commun/montants.js')),
        ...(await import('../dist/src/domaines/factures/metier.js')),
        ...(await import('../dist/src/domaines/comptabilite/metier.js')),
      };
      db = new pg.Client({ connectionString: cible.toString() });
      await db.connect();
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      session = connexion.body.token;
      // Identité de la société, plan comptable, mentions légales publiées : une première facture (1 × 10,00 € à 0 %) émise par l'API
      // fige l'identité de l'émetteur, que portent ensuite les pièces écrites en SQL.
      await ok(appeler('put', '/company', { raisonSociale: 'TEST Émetteur sommes exactes', siret: '68468468400068', adresse: '68 rue des Centimes', codePostal: '14000', ville: 'Caen', fuseauHoraire: 'Europe/Paris' }));
      const compte = (code, libelle, nature) => ok(appeler('post', '/comptabilite/comptes', { code, libelle, nature }), 201);
      const clients = await compte('411000', 'TEST Clients sommes exactes', 'ACTIF');
      const prestations = await compte('706000', 'TEST Prestations sommes exactes', 'PRODUIT');
      const articles = await compte('707000', 'TEST Articles sommes exactes', 'PRODUIT');
      const motif = 'TEST paramétrage comptable du lot AF';
      for (const [cle, donnees] of [['CLIENT', { compteId: clients.id }], ['VENTE_PRESTATION', { compteId: prestations.id }], ['VENTE_ARTICLE', { compteId: articles.id }], ['JOURNAL_VENTES', { journal: 'VE' }]]) {
        await ok(appeler('put', `/comptabilite/regles/${cle}`, { ...donnees, motif }));
      }
      const version = await ok(appeler('post', '/mentions-legales', { mentions: 'TEST mentions sommes exactes', cgv: 'TEST CGV sommes exactes', penalites: 'TEST pénalités sommes exactes' }), 201);
      await ok(appeler('post', `/mentions-legales/${version.version}/publier`));
      for (let essai = 1; ; essai += 1) {
        const res = await appeler('post', '/clients', { raisonSociale: `TEST Client sommes exactes ${suffixe()}`, siren: String(randomInt(100_000_000, 1_000_000_000)) });
        if (res.status === 409 && essai < 5) continue;
        assert.equal(res.status, 201, JSON.stringify(res.body));
        client = res.body;
        break;
      }
      await ok(appeler('post', `/clients/${client.id}/sites`, { nom: 'TEST Facturation sommes exactes', adresse: '68 rue des Centimes', codePostal: '14000', ville: 'Caen', estSiteFacturation: true }), 201);
      const brouillon = await ok(appeler('post', '/factures', {
        clientId: client.id, dateEmission: jour(), dateEcheance: jour(), origine: 'HORS_AFFAIRE', motifHorsAffaire: `TEST sommes exactes, première émission ${suffixe()}`,
        lignes: [{ designation: 'TEST sommes exactes, première émission', nature: 'PRESTATION', quantite: 1, prixUnitaireHt: 10, tauxTva: 0 }],
      }), 201);
      await ok(appeler('post', `/factures/${brouillon.id}/emettre`));
      identite = (await db.query('SELECT "id" FROM "IdentiteEmetteur" LIMIT 1')).rows[0]?.id;
      assert.ok(identite, 'identité de l’émetteur figée par la première émission');
      const tables = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`)).rows.map((t) => t.table_name);
      assert.ok(['Facture', 'FactureLigne', 'FactureVentilationTva', 'EcritureFacture'].every((t) => tables.includes(t)) && tables.length > 40, `tables relevées : ${tables.join(', ')}`);
      requeteDeLEmpreinte = requeteEmpreinte(tables);
    });

    // #552 : la connexion administrative est fermée même si la suppression de la base échoue ; une connexion de l'application
    // rouverte pendant la suppression la fait échouer : elle est retentée deux fois, puis l'erreur est rapportée.
    after(async () => {
      await db?.end().catch(() => {});
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

    // Critère « Cas théorique » : « Après le lot, les totaux de la pièce, sa ventilation et ses écritures valent la somme exacte, et la
    // cohérence (lot AC) les accepte. »
    test('cas théorique écrit en base (fixture théorique, règle 4) : 8 589 934 592,00 € en tête puis 20 000 lignes de 0,03 € (prestations) ou de 0,07 € (articles) à 0 %, et 4 294 967 296,03 € puis 20 000 × 0,03 € à 20 % : totaux, ventilation et écritures des fonctions du lot admis au COMMIT et relus exacts ; les mêmes calculés en flottants, comme avant, refusés au message exact des lignes, rien d’écrit', async () => {
      for (const c of CAS) {
        // Témoin : la somme exacte, la TVA arrondie sur la base exacte ; le code d'avant s'en écarte d'un centime.
        assert.equal(c.tete + BigInt(NOMBRE) * c.petite, c.ht, `${c.nom} : HT exact`);
        assert.deepEqual([tvaExacte(c.ht, c.taux), c.ht + tvaExacte(c.ht, c.taux)], [c.tva, c.ttc], `${c.nom} : TVA et TTC exacts`);
        const lignes = lignesDuCas(c);
        assert.equal(lignes[0].totalHt, euros(c.tete), `${c.nom} : la grande ligne est en tête (ordre 0)`);
        const ancien = avant(lignes, c.taux);
        assert.deepEqual([lu(ancien.totaux.totalHt, 'HT d’avant'), lu(ancien.totaux.totalTva, 'TVA d’avant'), lu(ancien.totaux.totalTtc, 'TTC d’avant')], [c.flottants.ht, c.flottants.tva, c.flottants.ttc], `${c.nom} : code d’avant`);
        assert.notEqual(c.flottants.ht, c.ht, `${c.nom} : lecture écartée distincte`);

        // Montants des fonctions du lot, sur les mêmes lignes, comparés au témoin.
        const totaux = fonctions.totauxPiece(lignes);
        const ventilation = fonctions.ventilationTvaDerivee(lignes);
        const ecritures = fonctions.montantsDesEcritures({ totalTtc: totaux.totalTtc, lignes, ventilationTva: ventilation });
        assert.deepEqual([lu(totaux.totalHt, 'HT'), lu(totaux.totalTva, 'TVA'), lu(totaux.totalTtc, 'TTC')], [c.ht, c.tva, c.ttc], `${c.nom} : totauxPiece`);
        assert.deepEqual(ventilation.map((v) => [v.tauxTva, lu(v.totalHt, 'HT du taux'), lu(v.totalTva, 'TVA du taux'), lu(v.totalTtc, 'TTC du taux')]), [[c.taux, c.ht, c.tva, c.ttc]], `${c.nom} : ventilationTvaDerivee`);
        const cleVente = `VENTE_${c.nature}`;
        const ecrituresAttendues = [['CLIENT', c.ttc, 0n, null], [cleVente, 0n, c.ht, null], ...(c.tva ? [[`TVA:${c.taux}`, 0n, c.tva, c.taux]] : [])];
        assert.deepEqual([...ecritures.entries()].map(([cle, m]) => [cle, lu(m.debit, `${cle} au débit`), lu(m.credit, `${cle} au crédit`), m.tauxTva ?? null]), ecrituresAttendues, `${c.nom} : montantsDesEcritures`);

        // Admise au COMMIT, puis relue exacte en numeric : totaux, lignes (nombre et somme), ventilation, écritures.
        const id = randomUUID();
        await ecrirePiece(id, c, { totaux, ventilation, ecritures });
        const [piece] = (await db.query(`SELECT "statut", "ecrituresScellees", "totalHt"::text AS ht, "totalTva"::text AS tva, "totalTtc"::text AS ttc FROM "Facture" WHERE "id" = $1`, [id])).rows;
        assert.deepEqual(piece, { statut: 'EMISE', ecrituresScellees: true, ht: enNumeric(c.ht), tva: enNumeric(c.tva), ttc: enNumeric(c.ttc) }, `${c.nom} : facture admise, relue`);
        const [lignesEnBase] = (await db.query(`SELECT count(*)::int AS n, sum("totalHt")::text AS ht, (min("ordre") FILTER (WHERE "totalHt" = $2::numeric))::int AS ordre_tete FROM "FactureLigne" WHERE "factureId" = $1`, [id, enNumeric(c.tete)])).rows;
        assert.deepEqual(lignesEnBase, { n: NOMBRE + 1, ht: enNumeric(c.ht), ordre_tete: 0 }, `${c.nom} : 20 001 lignes, somme exacte, grande ligne à l’ordre 0`);
        const ventilationEnBase = (await db.query(`SELECT "tauxTva"::text AS taux, "totalHt"::text AS ht, "totalTva"::text AS tva, "totalTtc"::text AS ttc FROM "FactureVentilationTva" WHERE "factureId" = $1`, [id])).rows;
        assert.deepEqual(ventilationEnBase, [{ taux: c.tauxPg, ht: enNumeric(c.ht), tva: enNumeric(c.tva), ttc: enNumeric(c.ttc) }], `${c.nom} : ventilation relue`);
        const ecrituresEnBase = (await db.query(`SELECT "ordre", "cle", "debit"::text AS debit, "credit"::text AS credit FROM "EcritureFacture" WHERE "factureId" = $1 ORDER BY "ordre"`, [id])).rows;
        assert.deepEqual(ecrituresEnBase, ecrituresAttendues.map(([cle, debit, credit], ordre) => ({ ordre, cle, debit: enNumeric(debit), credit: enNumeric(credit) })), `${c.nom} : écritures relues`);
        // La fonction du lot AC, appelée directement, l'admet aussi.
        await db.query('SELECT verifier_coherence_piece($1)::text', [id]);

        // Lecture écartée : les mêmes montants calculés comme avant (en flottants), refusés au COMMIT au message des lignes, rien
        // d'écrit.
        const idAvant = randomUUID();
        const empreinteAvant = await empreinte();
        let erreur = null;
        try { await ecrirePiece(idAvant, c, ancien); } catch (e) { erreur = e; }
        assert.ok(erreur, `${c.nom} : la pièce du code d’avant devait être refusée`);
        assert.equal(erreur.message, REFUS_LIGNES(idAvant, c.tauxPg), `${c.nom} : refus au message exact`);
        assert.deepEqual(tablesChangees(empreinteAvant, await empreinte()), [], `${c.nom} : rien n’est écrit`);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM "Facture" WHERE "id" = $1', [idAvant])).rows[0].n, 0, `${c.nom} : la pièce refusée n’existe pas`);
      }
    });

    // Audit des montants du lot AF, C1 : plafond de la facture saisie ligne par ligne (PLAFOND_MONTANT, 9 999 999 999,99 € TTC,
    // factures/routes.ts), comparé au TTC que rend désormais totauxPiece. Le lot ne le change pas, mais aucun test ne l'éprouvait (seul
    // le plafond d'une ligne l'est, api.test.mjs). Témoin en centimes, à 0 % (TTC = HT), chaque ligne sous le plafond d'une ligne :
    //  - 5 000 000 000,00 € + 4 999 999 999,99 € = 9 999 999 999,99 €, le plafond exact : admis en brouillon, relu en base ; lecture
    //    écartée : plafond au sens large (« ≥ »), qui le refuserait ;
    //  - 5 000 000 000,00 € + 5 000 000 000,00 € = 10 000 000 000,00 € : refusé (400) au message exact, sans rien écrire ; lecture
    //    écartée : plafond retiré, le montant n'étant plus refusé qu'en 500 par la colonne Decimal(12, 2).
    test('plafond de la facture saisie ligne par ligne, au centime près : 9 999 999 999,99 € TTC admis en brouillon, 10 000 000 000,00 € refusé (400, message exact, rien d’écrit)', async () => {
      const PLAFOND = 999999999999n;
      const corps = (lignes) => ({
        clientId: client.id, dateEmission: jour(), dateEcheance: jour(), origine: 'HORS_AFFAIRE', motifHorsAffaire: `TEST sommes exactes, plafond ${suffixe()}`,
        lignes: lignes.map(([designation, centimes]) => ({ designation, nature: 'PRESTATION', quantite: 1, prixUnitaireHt: enNumeric(centimes), tauxTva: 0 })),
      });
      const admises = [['TEST sommes exactes, plafond, première part', 500000000000n], ['TEST sommes exactes, plafond, seconde part', 499999999999n]];
      const refusees = [['TEST sommes exactes, plafond, première part', 500000000000n], ['TEST sommes exactes, plafond, part de trop', 500000000000n]];
      const total = (lignes) => lignes.reduce((somme, [, centimes]) => somme + centimes, 0n);
      assert.deepEqual([total(admises), total(refusees)], [PLAFOND, PLAFOND + 1n], 'témoin : le plafond exact, puis un centime de plus');
      const admise = await ok(appeler('post', '/factures', corps(admises)), 201);
      assert.deepEqual([admise.statut, lu(admise.totalHt, 'HT'), lu(admise.totalTva, 'TVA'), lu(admise.totalTtc, 'TTC')], ['BROUILLON', PLAFOND, 0n, PLAFOND], 'plafond exact admis');
      const [relue] = (await db.query(`SELECT "totalHt"::text AS ht, "totalTva"::text AS tva, "totalTtc"::text AS ttc FROM "Facture" WHERE "id" = $1`, [admise.id])).rows;
      assert.deepEqual(relue, { ht: enNumeric(PLAFOND), tva: '0.00', ttc: enNumeric(PLAFOND) }, 'plafond exact relu en base');
      const avant = await empreinte();
      const refus = await appeler('post', '/factures', corps(refusees));
      assert.deepEqual([refus.status, refus.body], [400, { error: 'Montant de facture hors des limites acceptées.' }], 'un centime au-delà du plafond : refusé au message exact');
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], 'refus : rien n’est écrit');
    });
  });
}
