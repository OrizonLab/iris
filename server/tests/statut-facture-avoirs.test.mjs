// Lot « Statut d'une facture couverte par des avoirs » (cadrage v3, section « Tests », critères métier observables 1 à 8 ;
// rapport du contrôle de cohérence de mode 1 : C1, C2, C4, N1 à N3 ; passage de vérification : C7, C8).
//
// Décision appliquée, réponse libre de Nelson du 09-11-2026, mot pour mot : « La facture n’est pas annulé si payer par sob
// avoir, soit elle est regle entierement dans ce cas la facture est regler ou si seul une partie est couverte pas un ou
// plusieurs avoir, elle sera partiellement reglé. Soit egalement logique dans les regles de la comptabilité d’entreprise. Il
// faut que cela reste toujours coherent avec ce qui se fait en entreprise ».
// Lecture retenue par le cadrage, à corriger par Nelson si besoin : une facture (type FACTURE) émise ou réglée est « réglée »
// (statut stocké) quand son reste dû est nul ou négatif ET que ce qui est enregistré sur elle est positif (parts de règlements
// non contre-passés et TTC des avoirs partiels émis, `montantRegle + montantAvoirs > 0`, en base comme dans l'API, C8) ; sinon
// elle est « émise ». Elle remplace la règle validée le 17-10-2026 (« une facture soldée par ses seuls
// avoirs reste émise ») et étend la cause des transitions EMISE ↔ REGLEE du cycle du 19-10-2026 (#221). Inchangés : reste dû =
// TTC − avoirs émis − règlements non contre-passés ; trop-perçu ; annulation refusée après un règlement ; statut « annulée ».
// Choix par défaut du cadrage, à confirmer, testés tels qu'écrits : le détail du journal d'une transition ajoute « , avoirs X € »
// seulement si la facture porte des avoirs (N2) ; le PDF d'une facture réglée par ses avoirs portait « Facture réglée. », sans
// autre mention (C5) : depuis le lot « Détail des avoirs comme règlements » (cadrage v2, § 2 ; réponse 1 de Nelson du 10-11-2026,
// « Facture réglée par avoir(s) », lecture retenue : accord au nombre), il porte « Facture réglée par avoir. » (un avoir) ;
// l'entrée REGLEMENT désigne le passage à « réglée », au nom de l'auteur de l'événement (N2).
//
// Contrat éprouvé :
//  - synchroniserStatutReglement (reglements/metier.ts), appelée après un règlement, une contre-passation ou un avoir partiel :
//    cible REGLEE si resteDu ≤ 0 et (montantRegle > 0 ou montantAvoirs > 0), sommes jamais négatives ; entrée REGLEMENT ou RETOUR_EMISE au nom de
//    l'auteur, détail « Transition A → B (cause) : réglé X €[, avoirs Y €], reste dû Z € » (ou « trop-perçu Z € ») ; depuis le lot
//    « Pas d'avoir à 0,00 € », la seconde condition n'est plus atteinte par aucun chemin de l'API (mutant équivalent : voir le test
//    « avoir partiel de 0,00 € par l’API ») ;
//  - refus de la saisie d'un règlement sur une facture réglée par ses avoirs : 409 « Seule une facture émise non soldée reçoit
//    un règlement : la facture <numéro> ne le peut pas. » ; le refus « déjà soldée » n'est plus atteint que par une facture émise
//    à 0,00 € TTC ;
//  - annulation d'une facture réglée par ses avoirs : 409 « Seule une facture émise peut être annulée. » ;
//  - gardes en base (migration 20261110090000_reglee_par_avoirs) : messages exacts, avoir d'annulation et avoir brouillon qui ne
//    soldent rien, facture à 0,00 € sans règlement ni avoir émis jamais « réglée », refus au COMMIT d'un avoir écrit directement qui
//    solde une facture « émise », sauf si la même transaction la passe « réglée » après lui. Un avoir émis à 0,00 € n'existe plus
//    depuis le lot « Pas d'avoir à 0,00 € » (réponse de Nelson du 10-11-2026) : refusé par l'API, et au COMMIT par la garde de la
//    migration 20261110120000_avoir_non_nul (éprouvée en entier par avoir-non-nul.test.mjs et avoir-non-nul-migration.test.mjs).
//    La migration 20261110090000 jouée sur une facture déjà soldée par ses avoirs est éprouvée par
//    reglee-par-avoirs-migration.test.mjs.
// Aucune route de ce lot n'est ouverte aux clés d'intégration (/api/v1) : sans objet ici.
//
// Montants (classés C : CLAUDE.md, « un test manquant qui touche un montant ») : chaque valeur est choisie pour qu'une autre
// lecture plausible donne un autre résultat ; chaque attendu est écrit en dur, la lecture écartée en commentaire, et le test
// « témoin des montants » les recalcule en décimal exact, hors de l'application, et vérifie que chaque lecture écartée en
// diffère.
//
// Comme assistante-technique-avoirs.test.mjs, ce fichier crée sur le serveur de TEST_DATABASE_URL une base jetable qui n'appartient
// qu'à lui (« test » comme mot, suffixe tiré au hasard), la migre, la sert à l'application montée en mémoire, puis la supprime :
// chaque refus y est prouvé par l'empreinte de toute la base, sans les écritures des autres fichiers que `node --test` exécute en
// parallèle. Sans TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { PDFParse } from 'pdf-parse';

const TITRE = 'Statut d’une facture couverte par des avoirs : « réglée » quand ses avoirs partiels la soldent, « émise » couverte en partie, journal, refus et gardes en base';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROLE_AT = 'ASSISTANTE_TECHNIQUE';

// Messages exacts (contrat du code ; cadrage v3).
const REFUS = {
  reglementStatut: (numero) => `Seule une facture émise non soldée reçoit un règlement : la facture ${numero} ne le peut pas.`,
  dejaSoldee: (numero) => `La facture ${numero} est déjà soldée (reste dû 0,00 €) : elle ne reçoit plus de règlement.`,
  nonAnnulable: 'Seule une facture émise peut être annulée.',
  // Ancien refus d'une facture créditée (lecture écartée par le critère 8).
  avoirsPartiels: 'Cette facture porte déjà un ou plusieurs avoirs partiels : elle ne peut plus être annulée en totalité.',
  plafondTotal: 'Cet avoir dépasse le montant total restant à créditer sur la facture d’origine.',
  administration: 'Accès réservé aux administrateurs',
  // Lot « Pas d'avoir à 0,00 € » (message exact donné par Claude Code).
  ligneZero: 'Une ligne d’avoir à 0,00 € n’est pas admise : Iris n’émet pas d’avoir à 0,00 €.',
};
// Gardes en base (migration 20261110090000_reglee_par_avoirs), mot pour mot.
const GARDE = {
  creeeReglee: 'Une facture n’est jamais créée « réglée » : elle le devient par ses règlements ou ses avoirs partiels.',
  passeReglee: 'Une facture ne passe à « réglée » que soldée par ses règlements ou ses avoirs partiels.',
  resteReglee: 'Une facture soldée par ses règlements ou ses avoirs partiels reste « réglée ».',
  annuleeAvecReglement: 'Une facture qui a reçu un règlement ne peut pas être annulée.',
  differee: (id, statut) => `Facture ${id} : statut ${statut} incohérent avec ses règlements et ses avoirs (réglée si le reste dû est nul ou négatif, avec un montant positif réglé ou crédité par des avoirs partiels).`,
  // Garde des affectations (inchangée) : premier contrôle (statut), puis facture soldée.
  affectationStatut: 'Seule une facture émise non soldée reçoit un règlement.',
  affectationSoldee: (id) => `Seule une facture émise non soldée reçoit un règlement : la facture ${id} est soldée.`,
  // Garde du cycle (#227) : une annulation sans avoir d'annulation.
  sansAvoirAnnulation: 'Une facture ne s\'annule qu\'avec son avoir d\'annulation, émis aux mêmes montants dans la même transaction.',
  // Garde de l'avoir à 0,00 € (migration 20261110120000_avoir_non_nul, lot « Pas d'avoir à 0,00 € »), mot pour mot.
  avoirZero: (avoirId, factureId) => `L'avoir ${avoirId} de la facture ${factureId} est à 0,00 € : Iris n'émet pas d'avoir à 0,00 €.`,
};

// --- Calcul exact, hors de l'application (témoins des montants) ---
// Centimes entiers (BigInt) ; arrondi au centime, moitié vers le haut. Lectures écartées : arrondi au pair, troncature, TVA de
// l'avoir seul (non différentielle), avoir déduit hors taxes.
const exact = {
  unites: (valeur, decimales) => {
    const [entier, fraction = ''] = String(valeur).split('.');
    return BigInt(entier) * 10n ** BigInt(decimales) + BigInt((fraction + '0'.repeat(decimales)).slice(0, decimales) || '0');
  },
  ligneHt: (quantite, prix) => (exact.unites(quantite, 3) * exact.unites(prix, 2) + 500n) / 1000n,
  ligneHtTronquee: (quantite, prix) => (exact.unites(quantite, 3) * exact.unites(prix, 2)) / 1000n,
  tva: (baseCentimes, taux) => (baseCentimes * exact.unites(taux, 3) + 50000n) / 100000n,
  tvaTronquee: (baseCentimes, taux) => (baseCentimes * exact.unites(taux, 3)) / 100000n,
  euros: (centimes) => Number(centimes) / 100,
  // Montant écrit comme l'application l'écrit dans un journal (formatMontantFacture), recopié et non importé.
  texte: (centimes) => `${(Number(centimes) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`,
};

// --- Jeu de montants (TTC sauf mention contraire ; cadrage v3, N6) ---
const ligne = (designation, quantite, prixUnitaireHt, tauxTva, nature = 'PRESTATION') => ({ designation: `TEST statut ${designation}`, nature, quantite, prixUnitaireHt, tauxTva });
// Critère 1 : facture 1 × 100,00 € HT à 20 % (TVA 20,00 €, TTC 120,00 €) ; avoir partiel 1 × 100,00 € HT (TTC 120,00 €). Réglée,
// reste dû 0,00 €, détail « réglé 0,00 €, avoirs 120,00 €, reste dû 0,00 € ». Lectures écartées : ancienne règle (« émise », sans
// entrée) ; avoirs écrits hors taxes au journal (100,00 €) ; détail sans les avoirs.
const LIGNES_CENT = [ligne('maintenance annuelle', 1, 100, 20)];
const AVOIR_TOTAL_CENT = [ligne('reprise totale', 1, 100, 20)];
// Critère 1 par l'assistante technique : 2,5 × 40,21 = 100,525, arrondi à 100,53 € HT (au pair ou tronqué : 100,52) ; TVA 20,106
// → 20,11 € ; TTC 120,64 €. Son avoir des mêmes lignes : 100,53 € HT, TVA 20,11 €, TTC 120,64 €. Détail « avoirs 120,64 € »
// (lecture écartée : hors taxes, 100,53 €).
const LIGNES_AT = [ligne('pose de la centrale', 2.5, 40.21, 20)];
// Critère 2 : avoir 1 × 16,67 € HT, TVA 3,334 → 3,33 €, TTC 20,00 € ; reste dû 100,00 € (lecture écartée : avoir déduit hors
// taxes, 103,33 €). « Émise », aucune entrée de transition.
const AVOIR_VINGT = [ligne('geste commercial', 1, 16.67, 20)];
// Critères 3 et 4 : règlement 50,00 €, puis avoir 1 × 58,33 € HT, TVA 11,666 → 11,67 €, TTC 70,00 € (lecture écartée : TVA
// tronquée, 11,66 €, TTC 69,99 €, reste dû 0,01 € : la facture resterait « émise »). Réglée : « réglé 50,00 €, avoirs 70,00 €,
// reste dû 0,00 € ». Contre-passation : « émise », « réglé 0,00 €, avoirs 70,00 €, reste dû 50,00 € ».
const AVOIR_SOIXANTE_DIX = [ligne('reprise partielle', 1, 58.33, 20)];
// Avoir à deux taux, deux avoirs qui soldent ensemble la facture de l'assistante :
//  - facture : 2,5 × 40,21 = 100,525 → 100,53 € HT à 20 % ; 1,5 × 66,67 = 100,005 → 100,01 € HT à 5,5 % (article) ; TVA 20 % :
//    20,106 → 20,11 € ; 5,5 % : 5,50055 → 5,50 € ; HT 200,54 €, TVA 25,61 €, TTC 226,15 € ;
//  - B1 : 0,5 × 24,01 = 12,005 → 12,01 € à 20 % ; 0,5 × 40,01 = 20,005 → 20,01 € à 5,5 % ; TVA 2,402 → 2,40 € et 1,10055 → 1,10 € ;
//    HT 32,02 €, TVA 3,50 €, TTC 35,52 € ; reste dû 190,63 €, « émise » ;
//  - B2 : 1 × 88,52 € à 20 %, 1 × 80,00 € à 5,5 % (le reste exact à chaque taux) ; TVA différentielle : 20 % : 20,11 − 2,40 =
//    17,71 € ; 5,5 % : 5,50 − 1,10 = 4,40 € ; HT 168,52 €, TVA 22,11 €, TTC 190,63 €. Avoirs 226,15 €, reste dû 0,00 €, « réglée »,
//    entrée au nom de l'auteur de B2 : « réglé 0,00 €, avoirs 226,15 €, reste dû 0,00 € ». Lectures écartées : TVA de B2 seul
//    (88,52 × 20 % = 17,704 → 17,70 €), TTC 190,62 €, reste dû 0,01 €, « émise » ; montant du dernier avoir seul au journal
//    (190,63 €).
const LIGNES_DEUX_TAUX = [ligne('pose de la centrale', 2.5, 40.21, 20), ligne('fourniture des détecteurs', 1.5, 66.67, 5.5, 'ARTICLE')];
const B1 = [ligne('reprise de la pose', 0.5, 24.01, 20), ligne('reprise des détecteurs', 0.5, 40.01, 5.5, 'ARTICLE')];
const B2 = [ligne('solde de la pose', 1, 88.52, 20), ligne('solde des détecteurs', 1, 80, 5.5, 'ARTICLE')];
// Trop-perçu après un avoir sur une facture réglée : facture 1 × 123,45 € (TVA 24,69 €, TTC 148,14 €), réglée de 148,14 € ;
// avoir 1 × 10,01 € (TVA 2,002 → 2,00 €, TTC 12,01 €) : reste dû −12,01 €, « réglée » inchangée, aucune entrée (lectures écartées :
// reste ramené à 0,00 € ; TVA arrondie au supérieur, TTC 12,02 €). Contre-passation : reste dû 136,13 €, « émise », « réglé 0,00 €,
// avoirs 12,01 €, reste dû 136,13 € ».
const LIGNES_TROP_PERCU = [ligne('dépannage', 1, 123.45, 20)];
const AVOIR_TROP_PERCU = [ligne('remise après règlement', 1, 10.01, 20)];
// Facture à 0,00 € (prix unitaire nul, admis à la saisie) : émise, reste dû 0,00 €, ni règlement ni avoir : reste « émise »
// (N3), et reçoit le refus « déjà soldée ».
const LIGNES_ZERO = [ligne('visite offerte', 1, 0, 20)];

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_statut_avoirs_${randomBytes(6).toString('hex')}`;
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
    const par = (cle) => entete(jwt.sign({ id: comptes[cle].id }, process.env.JWT_SECRET));
    const appeler = (methode, chemin, corps, auth = sa()) => {
      const requete = request(app)[methode](`/api${chemin}`).set(auth);
      return methode === 'get' ? requete : requete.send(corps ?? {});
    };
    const ok = async (reponse, statut = 200) => {
      const res = await reponse;
      assert.equal(res.status, statut, `${res.req?.method} ${res.req?.path} : ${res.status} ${JSON.stringify(res.body)}`);
      return res.body;
    };
    const texteDuPdf = async (reponse) => { const lecteur = new PDFParse({ data: reponse.body }); const contenu = await lecteur.getText(); await lecteur.destroy(); return contenu.text; };
    const jour = () => {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date());
      const v = (type) => parts.find((p) => p.type === type).value;
      return { fr: `${v('day')}-${v('month')}-${v('year')}`, annee: Number(v('year')) };
    };

    // --- État de la base ---
    // Empreinte de toute la base (modèle : assistante-technique-avoirs.test.mjs) : chaque table du schéma public, hors historique
    // des migrations, nombre de lignes et empreinte du contenu. Un refus ne doit rien y changer, ni `updatedAt`, ni journal, ni
    // séquence des avoirs.
    const sqlEmpreinte = (table) => `SELECT '${table}' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${table}" x`;
    let requeteEmpreinte = null;
    const empreinte = async () => {
      if (!requeteEmpreinte) {
        const tables = (await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`).map((t) => t.tablename);
        assert.ok(['Facture', 'SequenceAvoir', 'JournalFacture', 'Reglement', 'AffectationReglement'].every((t) => tables.includes(t)), `tables relevées : ${tables.join(', ')}`);
        assert.ok(tables.every((table) => /^[A-Za-z_]+$/.test(table)), 'noms de tables sans guillemet');
        requeteEmpreinte = tables.map(sqlEmpreinte).join(' UNION ALL ');
      }
      return Object.fromEntries((await prisma.$queryRawUnsafe(requeteEmpreinte)).map(({ t, n, h }) => [t, `${n}:${h}`]));
    };
    const tablesChangees = (avant, apres) => Object.keys({ ...avant, ...apres }).filter((t) => avant[t] !== apres[t]);
    // Un refus de l'API : statut et message exacts, empreinte de toute la base inchangée.
    const refuse = async (appel, statut, message, quoi) => {
      const avant = await empreinte();
      const res = await appel();
      assert.deepEqual([res.status, res.body?.error], [statut, message], `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
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
    const enBase = (id) => prisma.facture.findUniqueOrThrow({ where: { id }, include: { journal: { orderBy: { createdAt: 'asc' } } } });
    const nombres = (liste) => liste.map((valeur) => (valeur === null || valeur === undefined ? valeur : Number(valeur)));

    // --- Données ---
    const creerCompte = async (cle, role) => {
      const s = suffixe();
      comptes[cle] = await prisma.user.create({ data: { email: `statut.${cle.toLowerCase()}.${s}@iris.test`, name: `TEST statut ${cle} ${s}`, role } });
    };
    const brouillon = (auth, motif, lignes) => ok(appeler('post', '/factures', {
      clientId: client.id, dateEmission: jour().fr, dateEcheance: jour().fr, lignes, origine: 'HORS_AFFAIRE', motifHorsAffaire: `TEST statut ${motif} ${suffixe()}`,
    }, auth), 201);
    const factureEmise = async (auth, motif, lignes) => ok(appeler('post', `/factures/${(await brouillon(auth, motif, lignes)).id}/emettre`, {}, auth));
    const avoir = (id, lignes, auth) => appeler('post', `/factures/${id}/avoirs`, { lignes }, auth);
    const avoirCree = (id, lignes, auth) => ok(avoir(id, lignes, auth), 201);
    const reglement = (factureId, montant) => appeler('post', '/reglements', { clientId: client.id, dateReglement: jour().fr, montant, moyen: 'VIREMENT', reference: `TEST-STATUT-${suffixe()}`, affectations: [{ factureId, montant }] }, par('AD'));
    const regler = (factureId, montant) => ok(reglement(factureId, montant), 201);
    const contrepasser = (id, motif) => ok(appeler('post', `/reglements/${id}/contrepasser`, { motif }, par('AD')));
    // Soldes d'une pièce dans la liste non paginée d'un lecteur : [statut, montantAvoirs, montantRegle, resteDu].
    const soldes = async (id, auth = par('AD')) => {
      const f = (await ok(appeler('get', '/factures', null, auth))).find((x) => x.id === id);
      return f ? [f.statut, f.montantAvoirs, f.montantRegle, f.resteDu] : null;
    };
    const aRegler = async () => (await ok(appeler('get', '/factures/a-regler', null, par('AD')))).factures.map((f) => [f.id, f.resteDu]);
    const transitions = async (id) => (await enBase(id)).journal.filter((j) => ['REGLEMENT', 'RETOUR_EMISE'].includes(j.action)).map((j) => [j.action, j.acteurId, j.detail]);
    const dateFr = (iso) => String(iso).slice(0, 10).split('-').reverse().join('-');

    // Pièce écrite directement en base, comme une création valide (modèle : le test #230 d'api.test.mjs) : lignes et ventilation
    // égales aux totaux, écritures équilibrées sur le TTC, scellée. `taux` : [[taux, HT, TVA]]. Une écriture de TVA par taux, à la clé
    // et au taux que l'application écrit (`TVA:<taux>`, tauxTva), égale à la ventilation : depuis le lot AC (#243, cadrage v2,
    // règle R4), la base refuse une écriture `TVA` sans taux.
    // `id` est posé d'avance quand le message d'une garde le cite (lot « Pas d'avoir à 0,00 € »).
    const pieceSql = async (tx, { id = randomUUID(), type = 'AVOIR', statut = 'EMISE', factureOrigineId = null, estAvoirAnnulation = false, taux }) => {
      const centimes = (montant) => Math.round(montant * 100) / 100;
      const totalHt = centimes(taux.reduce((s, [, ht]) => s + ht, 0));
      const totalTva = centimes(taux.reduce((s, [, , tva]) => s + tva, 0));
      const totalTtc = centimes(totalHt + totalTva);
      const identite = await prisma.identiteEmetteur.findFirstOrThrow({ select: { id: true } });
      const piece = await tx.facture.create({ data: {
        id, clientId: client.id, clientRaisonSociale: client.raisonSociale, type, statut, factureOrigineId, estAvoirAnnulation,
        dateEmission: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`), dateEcheance: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
        totalHt, totalTva, totalTtc, origine: 'HORS_AFFAIRE', motifHorsAffaire: 'TEST statut écrit en base', identiteEmetteurId: identite.id,
      } });
      await tx.factureLigne.createMany({ data: taux.map(([t, ht, tva], ordre) => ({ factureId: piece.id, ordre, designation: `TEST statut en base ${t} %`, nature: 'PRESTATION', quantite: 1, prixUnitaireHt: ht, tauxTva: t, totalHt: ht, totalTtc: centimes(ht + tva) })) });
      await tx.factureVentilationTva.createMany({ data: taux.map(([t, ht, tva]) => ({ factureId: piece.id, tauxTva: t, totalHt: ht, totalTva: tva, totalTtc: centimes(ht + tva) })) });
      if (statut !== 'BROUILLON') {
        const sens = (montant, debit) => (debit === (type === 'FACTURE') ? { debit: montant, credit: 0 } : { debit: 0, credit: montant });
        await tx.ecritureFacture.createMany({ data: [
          { factureId: piece.id, ordre: 0, cle: 'CLIENT', journalCode: 'VE', compteNum: '411000', compteLib: 'TEST Clients', ...sens(totalTtc, true) },
          { factureId: piece.id, ordre: 1, cle: 'VENTE_PRESTATION', journalCode: 'VE', compteNum: '706000', compteLib: 'TEST Ventes', ...sens(totalHt, false) },
          ...taux.map(([t, , tva], rang) => ({ factureId: piece.id, ordre: 2 + rang, cle: `TVA:${t}`, tauxTva: t, journalCode: 'VE', compteNum: '445710', compteLib: 'TEST TVA', ...sens(tva, false) })),
        ] });
        await tx.facture.update({ where: { id: piece.id }, data: { ecrituresScellees: true } });
      }
      return piece;
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
      await ok(appeler('put', '/company', { raisonSociale: 'TEST Émetteur statut', siret: '55555555500055', adresse: '5 rue des Avoirs', codePostal: '14000', ville: 'Caen', fuseauHoraire: 'Europe/Paris' }));
      const compte = (code, libelle, nature) => ok(appeler('post', '/comptabilite/comptes', { code, libelle, nature }), 201);
      const clients = await compte('411000', 'TEST Clients statut', 'ACTIF');
      const prestations = await compte('706000', 'TEST Prestations statut', 'PRODUIT');
      const articles = await compte('707000', 'TEST Articles statut', 'PRODUIT');
      const tva20 = await compte('445710', 'TEST TVA 20 statut', 'TVA');
      const tva55 = await compte('445711', 'TEST TVA 5,5 statut', 'TVA');
      const motif = 'TEST paramétrage comptable du lot statut';
      for (const [cle, donnees] of [['CLIENT', { compteId: clients.id }], ['VENTE_PRESTATION', { compteId: prestations.id }], ['VENTE_ARTICLE', { compteId: articles.id }], ['JOURNAL_VENTES', { journal: 'VE' }]]) {
        await ok(appeler('put', `/comptabilite/regles/${cle}`, { ...donnees, motif }));
      }
      await ok(appeler('put', '/comptabilite/tva/20', { compteId: tva20.id, motif }));
      await ok(appeler('put', '/comptabilite/tva/5.5', { compteId: tva55.id, motif }));
      const version = await ok(appeler('post', '/mentions-legales', { mentions: 'TEST mentions statut', cgv: 'TEST CGV statut', penalites: 'TEST pénalités statut' }), 201);
      await ok(appeler('post', `/mentions-legales/${version.version}/publier`));
      for (const [cle, role] of [['AT', ROLE_AT], ['AD', 'ADMIN'], ['DIR', 'DIRECTEUR']]) await creerCompte(cle, role);
      for (let essai = 1; ; essai += 1) {
        const res = await appeler('post', '/clients', { raisonSociale: `TEST Client statut ${suffixe()}`, siren: String(randomInt(100_000_000, 1_000_000_000)) });
        if (res.status === 409 && essai < 5) continue;
        assert.equal(res.status, 201, JSON.stringify(res.body));
        client = res.body;
        break;
      }
      await ok(appeler('post', `/clients/${client.id}/sites`, { nom: 'TEST Facturation statut', adresse: '5 rue des Avoirs', codePostal: '14000', ville: 'Caen', estSiteFacturation: true }), 201);
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
    test('témoin des montants : attendus recalculés en décimal exact (lignes, TVA différentielle à deux taux, reste dû, montants du journal), chaque lecture écartée distincte', () => {
      const ht = (l) => exact.ligneHt(l.quantite, l.prixUnitaireHt);
      const tauxDe = (lignes) => [...new Set(lignes.map((l) => l.tauxTva))];
      const baseDuTaux = (lignes, taux) => lignes.filter((l) => l.tauxTva === taux).reduce((s, l) => s + ht(l), 0n);
      // Totaux d'une facture : TVA de la base cumulée de chaque taux.
      const totaux = (lignes) => {
        const htTotal = lignes.reduce((s, l) => s + ht(l), 0n);
        const tvaTotal = tauxDe(lignes).reduce((s, t) => s + exact.tva(baseDuTaux(lignes, t), t), 0n);
        return [htTotal, tvaTotal, htTotal + tvaTotal];
      };
      // Totaux d'un avoir après des avoirs précédents : TVA différentielle par taux.
      const totauxAvoir = (lignes, precedents = []) => {
        const htTotal = lignes.reduce((s, l) => s + ht(l), 0n);
        const tvaTotal = tauxDe(lignes).reduce((s, t) => {
          const avant = precedents.reduce((x, p) => x + baseDuTaux(p, t), 0n);
          return s + exact.tva(avant + baseDuTaux(lignes, t), t) - exact.tva(avant, t);
        }, 0n);
        return [htTotal, tvaTotal, htTotal + tvaTotal];
      };
      // Critère 1.
      const [, , ttcCent] = totaux(LIGNES_CENT);
      const [htAvoirCent, , ttcAvoirCent] = totauxAvoir(AVOIR_TOTAL_CENT);
      assert.deepEqual([ttcCent, ttcAvoirCent, ttcCent - ttcAvoirCent], [12000n, 12000n, 0n]);
      assert.equal(exact.texte(ttcAvoirCent), '120,00 €');
      assert.notEqual(exact.texte(htAvoirCent), exact.texte(ttcAvoirCent), 'lecture écartée : avoirs hors taxes au journal');
      // Critère 1, assistante : demi-centime.
      assert.deepEqual(totaux(LIGNES_AT), [10053n, 2011n, 12064n]);
      assert.deepEqual(totauxAvoir(LIGNES_AT), [10053n, 2011n, 12064n]);
      assert.equal(exact.ligneHtTronquee(2.5, 40.21), 10052n, 'lecture écartée : ligne tronquée');
      assert.equal(exact.texte(12064n), '120,64 €');
      // Critère 2.
      const [htVingt, tvaVingt, ttcVingt] = totauxAvoir(AVOIR_VINGT);
      assert.deepEqual([htVingt, tvaVingt, ttcVingt], [1667n, 333n, 2000n]);
      assert.equal(ttcCent - ttcVingt, 10000n);
      assert.notEqual(ttcCent - htVingt, 10000n, 'lecture écartée : avoir déduit hors taxes (103,33 €)');
      // Critères 3 et 4.
      const [htSoixanteDix, tvaSoixanteDix, ttcSoixanteDix] = totauxAvoir(AVOIR_SOIXANTE_DIX);
      assert.deepEqual([htSoixanteDix, tvaSoixanteDix, ttcSoixanteDix], [5833n, 1167n, 7000n]);
      assert.equal(ttcCent - 5000n - ttcSoixanteDix, 0n, 'critère 3 : reste dû nul');
      assert.equal(htSoixanteDix + exact.tvaTronquee(htSoixanteDix, 20), 6999n, 'lecture écartée : TVA tronquée, reste dû 0,01 €');
      assert.equal(ttcCent - ttcSoixanteDix, 5000n, 'critère 4 : reste dû 50,00 € après la contre-passation');
      // Deux taux, deux avoirs.
      assert.deepEqual(totaux(LIGNES_DEUX_TAUX), [20054n, 2561n, 22615n]);
      const [, , ttcB1] = totauxAvoir(B1);
      assert.deepEqual(totauxAvoir(B1), [3202n, 350n, 3552n]);
      const [, tvaB2, ttcB2] = totauxAvoir(B2, [B1]);
      assert.deepEqual(totauxAvoir(B2, [B1]), [16852n, 2211n, 19063n]);
      assert.equal(22615n - ttcB1, 19063n, 'reste dû après B1');
      assert.equal(22615n - ttcB1 - ttcB2, 0n, 'B2 solde la facture');
      const [, tvaB2Seul, ttcB2Seul] = totauxAvoir(B2);
      assert.deepEqual([tvaB2Seul, ttcB2Seul], [2210n, 19062n], 'lecture écartée : TVA de B2 seul');
      assert.notEqual(tvaB2Seul, tvaB2);
      assert.equal(22615n - ttcB1 - ttcB2Seul, 1n, 'lecture écartée : reste dû 0,01 €, la facture resterait « émise »');
      assert.equal(exact.texte(ttcB1 + ttcB2), '226,15 €');
      assert.notEqual(exact.texte(ttcB2), exact.texte(ttcB1 + ttcB2), 'lecture écartée : dernier avoir seul au journal');
      // Trop-perçu.
      const [, , ttcTrop] = totaux(LIGNES_TROP_PERCU);
      const [, tvaAvoirTrop, ttcAvoirTrop] = totauxAvoir(AVOIR_TROP_PERCU);
      assert.deepEqual([ttcTrop, tvaAvoirTrop, ttcAvoirTrop], [14814n, 200n, 1201n]);
      assert.equal(ttcTrop - ttcTrop - ttcAvoirTrop, -1201n);
      assert.equal(ttcTrop - ttcAvoirTrop, 13613n);
      assert.equal(exact.texte(13613n), '136,13 €');
      // Facture à 0,00 €.
      assert.deepEqual(totaux(LIGNES_ZERO), [0n, 0n, 0n]);
    });

    // Critère 1, par l'administration (ADMIN et directeur, aligné sur elle) : la facture passe « réglée », reste dû 0,00 €, entrée
    // REGLEMENT au nom de l'auteur de l'avoir, avec « avoirs 120,00 € » ; PDF « Facture réglée par avoir. » (lot « Détail des avoirs
    // comme règlements ») ; sortie de la liste « à régler ».
    test('critère 1 : facture de 120,00 € soldée par un avoir partiel de 120,00 € sans règlement : « réglée », reste dû 0,00 €, entrée REGLEMENT au nom de l’auteur de l’avoir (administrateur, directeur) avec « avoirs 120,00 € », PDF « Facture réglée par avoir. », hors de la liste « à régler »', async () => {
      for (const auteur of ['AD', 'DIR']) {
        const facture = await factureEmise(par('AD'), `critère 1 ${auteur}`, LIGNES_CENT);
        assert.deepEqual(nombres([facture.totalHt, facture.totalTva, facture.totalTtc]), [100, 20, 120]);
        assert.ok((await aRegler()).some(([id, reste]) => id === facture.id && reste === 120), `${auteur} : due avant l’avoir`);
        const a1 = await avoirCree(facture.id, AVOIR_TOTAL_CENT, par(auteur));
        assert.deepEqual(nombres([a1.totalHt, a1.totalTva, a1.totalTtc]), [100, 20, 120]);
        // Lecture écartée : ancienne règle, « émise » sans entrée.
        assert.deepEqual(await soldes(facture.id), ['REGLEE', 120, 0, 0], auteur);
        const relue = await enBase(facture.id);
        assert.equal(relue.statut, 'REGLEE');
        assert.deepEqual(relue.journal.map((j) => [j.action, j.acteurId]), [['CREATION_BROUILLON', comptes.AD.id], ['EMISSION', comptes.AD.id], ['REGLEMENT', comptes[auteur].id]], auteur);
        // Lectures écartées : détail sans les avoirs ; avoirs hors taxes (100,00 €).
        assert.equal(relue.journal[2].detail, `Transition EMISE → REGLEE (avoir partiel ${a1.numero}) : réglé 0,00 €, avoirs 120,00 €, reste dû 0,00 €`, auteur);
        // Le journal lu par l'API : l'entrée telle quelle.
        const lu = await ok(appeler('get', `/factures/${facture.id}/journal`, null, par('AD')));
        assert.deepEqual(lu.filter((j) => j.action === 'REGLEMENT').map((j) => [j.acteurId, j.detail]), [[comptes[auteur].id, relue.journal[2].detail]]);
        // L'avoir porte sa seule entrée de création.
        assert.deepEqual((await enBase(a1.id)).journal.map((j) => [j.action, j.acteurId]), [['CREATION_AVOIR_PARTIEL', comptes[auteur].id]]);
        assert.ok(!(await aRegler()).some(([id]) => id === facture.id), `${auteur} : sortie de la liste « à régler »`);
        // PDF : « Facture réglée par avoir. » depuis le lot « Détail des avoirs comme règlements » (réponse 1 de Nelson du
        // 10-11-2026), et non plus « Facture réglée. » (C5 de ce lot-ci) ; toujours sans la précision « Soldée par avoir » de
        // l'écran (« soldée » et « réglée par avoir » : deux mots différents, par choix de Nelson). Le bloc « Règlements et avoirs »
        // est éprouvé par detail-avoirs-reglements.test.mjs.
        const pdf = await appeler('get', `/factures/${facture.id}/document.pdf`, null, par('AD'));
        assert.equal(pdf.status, 200, pdf.text);
        const texte = await texteDuPdf(pdf);
        assert.ok(texte.includes('Facture réglée par avoir.'), `${auteur} : PDF « Facture réglée par avoir. »`);
        assert.ok(!texte.includes('Facture réglée.'), `${auteur} : lecture écartée, « Facture réglée. » d’avant le lot du détail des avoirs`);
        assert.ok(!texte.includes('Soldée par avoir'), `${auteur} : aucune autre mention sur le PDF`);
        assert.ok(texte.includes('Total TTC : 120,00 €'));
      }
    });

    // Critère 1 par l'assistante technique (son avoir, sur une facture de son poste) ; critère 2 par elle aussi.
    test('critères 1 et 2, par l’assistante technique : sa facture de 120,64 € (2,5 × 40,21 €) soldée par son avoir de 120,64 € passe « réglée », entrée REGLEMENT à son nom avec « avoirs 120,64 € » ; sa facture de 120,00 € couverte par son avoir de 20,00 € reste « émise », reste dû 100,00 €, sans entrée', async () => {
      const facture = await factureEmise(par('AT'), 'critère 1 assistante', LIGNES_AT);
      assert.deepEqual([facture.creeParType, ...nombres([facture.totalHt, facture.totalTva, facture.totalTtc])], [ROLE_AT, 100.53, 20.11, 120.64]);
      const avoirAt = await avoirCree(facture.id, LIGNES_AT, par('AT'));
      assert.deepEqual([avoirAt.creeParType, ...nombres([avoirAt.totalHt, avoirAt.totalTva, avoirAt.totalTtc])], [ROLE_AT, 100.53, 20.11, 120.64]);
      for (const lecteur of ['AT', 'AD']) assert.deepEqual(await soldes(facture.id, par(lecteur)), ['REGLEE', 120.64, 0, 0], `lu par ${lecteur}`);
      // Lectures écartées : avoirs hors taxes (100,53 €) ; entrée au nom d'un autre compte.
      assert.deepEqual(await transitions(facture.id), [['REGLEMENT', comptes.AT.id, `Transition EMISE → REGLEE (avoir partiel ${avoirAt.numero}) : réglé 0,00 €, avoirs 120,64 €, reste dû 0,00 €`]]);
      const lu = await ok(appeler('get', `/factures/${facture.id}/journal`, null, par('AT')));
      assert.deepEqual(lu.filter((j) => j.action === 'REGLEMENT').map((j) => j.acteurId), [comptes.AT.id], 'son journal, lu par elle');
      // Lot « Détail des avoirs comme règlements » : « Facture réglée par avoir. » (et non plus « Facture réglée. »).
      assert.ok((await texteDuPdf(await appeler('get', `/factures/${facture.id}/document.pdf`, null, par('AT')))).includes('Facture réglée par avoir.'));

      // Critère 2, par elle.
      const partielle = await factureEmise(par('AT'), 'critère 2 assistante', LIGNES_CENT);
      const avoirVingt = await avoirCree(partielle.id, AVOIR_VINGT, par('AT'));
      assert.deepEqual(nombres([avoirVingt.totalHt, avoirVingt.totalTva, avoirVingt.totalTtc]), [16.67, 3.33, 20]);
      // Lecture écartée : avoir déduit hors taxes (103,33 €).
      for (const lecteur of ['AT', 'AD']) assert.deepEqual(await soldes(partielle.id, par(lecteur)), ['EMISE', 20, 0, 100], `lu par ${lecteur}`);
      assert.deepEqual(await transitions(partielle.id), [], 'aucune entrée de transition');
      assert.ok((await aRegler()).some(([id, reste]) => id === partielle.id && reste === 100), 'reste dans la liste « à régler »');
      assert.ok(!(await texteDuPdf(await appeler('get', `/factures/${partielle.id}/document.pdf`, null, par('AT')))).includes('Facture réglée.'));
    });

    // Critère 2, par l'administration.
    test('critère 2 : facture de 120,00 € couverte par un avoir de 16,67 € HT et 3,33 € de TVA (20,00 € TTC) : « émise », reste dû 100,00 €, aucune entrée de transition, toujours dans la liste « à régler »', async () => {
      const facture = await factureEmise(par('AD'), 'critère 2', LIGNES_CENT);
      const a = await avoirCree(facture.id, AVOIR_VINGT, par('AD'));
      assert.deepEqual(nombres([a.totalHt, a.totalTva, a.totalTtc]), [16.67, 3.33, 20]);
      assert.deepEqual(await soldes(facture.id), ['EMISE', 20, 0, 100]);
      assert.equal((await enBase(facture.id)).statut, 'EMISE');
      assert.deepEqual(await transitions(facture.id), []);
      assert.ok((await aRegler()).some(([id, reste]) => id === facture.id && reste === 100));
    });

    // Critères 3 et 4 : un règlement de 50,00 €, puis un avoir de 70,00 € qui solde ; puis contre-passation du règlement.
    test('critères 3 et 4 : réglée de 50,00 € puis avoir de 70,00 € : « réglée » (« réglé 50,00 €, avoirs 70,00 €, reste dû 0,00 € ») ; règlement contre-passé : retour à « émise », reste dû 50,00 €, entrée RETOUR_EMISE au nom de l’auteur de la contre-passation avec « avoirs 70,00 € »', async () => {
      const facture = await factureEmise(par('AD'), 'critères 3 et 4', LIGNES_CENT);
      const r = await regler(facture.id, 50);
      assert.deepEqual(await soldes(facture.id), ['EMISE', 0, 50, 70]);
      // Sans avoir, aucune transition (le règlement partiel ne la solde pas).
      assert.deepEqual(await transitions(facture.id), []);
      const a = await avoirCree(facture.id, AVOIR_SOIXANTE_DIX, par('DIR'));
      assert.deepEqual(nombres([a.totalHt, a.totalTva, a.totalTtc]), [58.33, 11.67, 70]);
      // Critère 3 : « réglée » (inchangé), le détail cite désormais les avoirs. Lectures écartées : détail sans les avoirs ;
      // avoirs hors taxes (58,33 €) ; entrée au nom de l'auteur du règlement.
      assert.deepEqual(await soldes(facture.id), ['REGLEE', 70, 50, 0]);
      assert.deepEqual(await transitions(facture.id), [['REGLEMENT', comptes.DIR.id, `Transition EMISE → REGLEE (avoir partiel ${a.numero}) : réglé 50,00 €, avoirs 70,00 €, reste dû 0,00 €`]]);
      // Critère 4 : contre-passation par l'administration.
      const motif = 'TEST chèque revenu impayé';
      await contrepasser(r.id, motif);
      assert.deepEqual(await soldes(facture.id), ['EMISE', 70, 0, 50]);
      const journal = (await enBase(facture.id)).journal;
      assert.deepEqual(journal.slice(-2).map((j) => [j.action, j.acteurId, j.detail]), [
        ['REGLEMENT_CONTREPASSE', comptes.AD.id, `Contre-passation du règlement ${r.id} du ${jour().fr} de 50,00 € : « ${motif} » ; 50,00 € retirés ; reste dû 50,00 €`],
        // Lecture écartée : avoirs omis au retour (seule la transition vers « réglée » les citerait).
        ['RETOUR_EMISE', comptes.AD.id, `Transition REGLEE → EMISE (contre-passation du règlement ${r.id}) : réglé 0,00 €, avoirs 70,00 €, reste dû 50,00 €`],
      ]);
      assert.ok((await aRegler()).some(([id, reste]) => id === facture.id && reste === 50), 'de nouveau dans la liste « à régler »');
      assert.equal(dateFr(r.dateReglement), jour().fr);
    });

    // Critère 5 : la saisie d'un règlement sur une facture réglée par ses avoirs est refusée par le contrôle de statut.
    // Critère 8 : son annulation répond 409 « Seule une facture émise peut être annulée. », sans écriture ni numéro d'avoir.
    test('critères 5 et 8 : sur une facture réglée par ses avoirs, règlement refusé (409 « Seule une facture émise non soldée reçoit un règlement : la facture … ne le peut pas. ») et annulation refusée (409 « Seule une facture émise peut être annulée. »), par l’administration et par l’assistante technique, sans écriture ni numéro consommé', async () => {
      const facture = await factureEmise(par('AD'), 'critères 5 et 8', LIGNES_CENT);
      await avoirCree(facture.id, AVOIR_TOTAL_CENT, par('AD'));
      const sienne = await factureEmise(par('AT'), 'critères 5 et 8 assistante', LIGNES_CENT);
      await avoirCree(sienne.id, AVOIR_TOTAL_CENT, par('AT'));
      for (const f of [facture, sienne]) assert.equal((await enBase(f.id)).statut, 'REGLEE');
      const sequence = async () => (await prisma.sequenceAvoir.findUnique({ where: { annee: jour().annee } }))?.dernierNumero ?? 0;
      const avant = await sequence();
      // Critère 5 : lecture écartée, le refus « déjà soldée » d'avant le lot.
      await refuse(() => reglement(facture.id, 10), 409, REFUS.reglementStatut(facture.numero), 'règlement sur une facture réglée par ses avoirs');
      await refuse(() => reglement(sienne.id, 10), 409, REFUS.reglementStatut(sienne.numero), 'règlement sur sa facture réglée par ses avoirs');
      // Critère 8 : lecture écartée, l'ancien refus des avoirs partiels.
      await refuse(() => appeler('post', `/factures/${facture.id}/annuler`, {}, par('AD')), 409, REFUS.nonAnnulable, 'annulation par l’administration');
      await refuse(() => appeler('post', `/factures/${facture.id}/annuler`, {}, par('DIR')), 409, REFUS.nonAnnulable, 'annulation par le directeur');
      await refuse(() => appeler('post', `/factures/${sienne.id}/annuler`, {}, par('AT')), 409, REFUS.nonAnnulable, 'annulation par l’assistante technique');
      assert.equal(await sequence(), avant, 'aucun numéro d’avoir consommé');
      // Elle ne saisit pas de règlement pour autant (inchangé).
      await refuse(() => appeler('post', '/reglements', { clientId: client.id, dateReglement: jour().fr, montant: 10, moyen: 'VIREMENT', affectations: [{ factureId: sienne.id, montant: 10 }] }, par('AT')), 403, REFUS.administration, 'règlement par l’assistante technique');
      // Un avoir de plus reste refusé par le plafond, comme pour toute facture entièrement créditée.
      await refuse(() => avoir(facture.id, [ligne('un centime de trop', 1, 0.01, 20)], par('AD')), 409, REFUS.plafondTotal, 'avoir au-delà du TTC');
      for (const f of [facture, sienne]) assert.deepEqual(await soldes(f.id), ['REGLEE', 120, 0, 0]);
    });

    // Critère 7 : réglée en entier, créditée en entier (trop-perçu 120,00 €), puis règlement contre-passé : reste « réglée ».
    test('critère 7 : facture de 120,00 € réglée de 120,00 € (détail sans avoirs), puis avoir de 120,00 € (trop-perçu 120,00 €, sans entrée), puis règlement contre-passé : reste « réglée », reste dû 0,00 €, avoirs 120,00 €, sans entrée RETOUR_EMISE', async () => {
      const facture = await factureEmise(par('AD'), 'critère 7', LIGNES_CENT);
      const r = await regler(facture.id, 120);
      // Sans avoir, le détail est celui d'avant le lot (lecture écartée : « , avoirs 0,00 € » ajouté).
      assert.deepEqual(await transitions(facture.id), [['REGLEMENT', comptes.AD.id, `Transition EMISE → REGLEE (règlement ${r.id}) : réglé 120,00 €, reste dû 0,00 €`]]);
      const entreesAvantAvoir = (await enBase(facture.id)).journal.length;
      await avoirCree(facture.id, AVOIR_TOTAL_CENT, par('AD'));
      assert.deepEqual(await soldes(facture.id), ['REGLEE', 120, 120, -120]);
      assert.equal((await enBase(facture.id)).journal.length, entreesAvantAvoir, 'statut inchangé : aucune entrée');
      const motif = 'TEST virement rejeté';
      await contrepasser(r.id, motif);
      // Lecture écartée (avant le lot) : retour à « émise », entrée RETOUR_EMISE.
      assert.deepEqual(await soldes(facture.id), ['REGLEE', 120, 0, 0]);
      const journal = (await enBase(facture.id)).journal;
      assert.equal(journal.length, entreesAvantAvoir + 1, 'seule la contre-passation est écrite');
      assert.deepEqual(journal.at(-1) && [journal.at(-1).action, journal.at(-1).acteurId, journal.at(-1).detail], ['REGLEMENT_CONTREPASSE', comptes.AD.id, `Contre-passation du règlement ${r.id} du ${jour().fr} de 120,00 € : « ${motif} » ; 120,00 € retirés ; reste dû 0,00 €`]);
      assert.ok(!journal.some((j) => j.action === 'RETOUR_EMISE'));
      assert.equal((await enBase(facture.id)).statut, 'REGLEE');
      assert.ok(!(await aRegler()).some(([id]) => id === facture.id));
      // Elle se lit désormais « réglée » sans règlement : un nouveau règlement est refusé par son statut.
      await refuse(() => reglement(facture.id, 10), 409, REFUS.reglementStatut(facture.numero), 'règlement après la contre-passation');
    });

    // Avoir à deux taux ; plusieurs avoirs partiels qui soldent ensemble la facture ; entrée au nom de l'auteur du dernier avoir,
    // dans les deux ordres (administration puis assistante, assistante puis administration).
    test('deux avoirs à deux taux (35,52 € puis 190,63 €, TVA différentielle) soldent ensemble une facture de 226,15 € : « émise » après le premier (reste dû 190,63 €), « réglée » après le second, entrée REGLEMENT au nom de l’auteur du second avec « avoirs 226,15 € », administration et assistante technique dans les deux ordres', async () => {
      for (const [premier, second] of [['AD', 'AT'], ['AT', 'AD']]) {
        const quoi = `${premier} puis ${second}`;
        const facture = await factureEmise(par('AT'), `deux taux ${quoi}`, LIGNES_DEUX_TAUX);
        assert.deepEqual(nombres([facture.totalHt, facture.totalTva, facture.totalTtc]), [200.54, 25.61, 226.15], quoi);
        const b1 = await avoirCree(facture.id, B1, par(premier));
        assert.deepEqual(nombres([b1.totalHt, b1.totalTva, b1.totalTtc]), [32.02, 3.5, 35.52], quoi);
        assert.deepEqual(await soldes(facture.id), ['EMISE', 35.52, 0, 190.63], quoi);
        assert.deepEqual(await transitions(facture.id), [], `${quoi} : aucune entrée après le premier avoir`);
        const b2 = await avoirCree(facture.id, B2, par(second));
        // Lecture écartée : TVA de B2 seul (22,10 €, TTC 190,62 €), qui laisserait 0,01 € dû et la facture « émise ».
        assert.deepEqual(nombres([b2.totalHt, b2.totalTva, b2.totalTtc]), [168.52, 22.11, 190.63], quoi);
        assert.deepEqual((await enBase(b2.id)).journal.map((j) => j.action), ['CREATION_AVOIR_PARTIEL']);
        assert.deepEqual(await soldes(facture.id), ['REGLEE', 226.15, 0, 0], quoi);
        // Lectures écartées : dernier avoir seul au journal (190,63 €) ; entrée au nom du premier auteur ou de la créatrice.
        assert.deepEqual(await transitions(facture.id), [['REGLEMENT', comptes[second].id, `Transition EMISE → REGLEE (avoir partiel ${b2.numero}) : réglé 0,00 €, avoirs 226,15 €, reste dû 0,00 €`]], quoi);
      }
    });

    // Trop-perçu après un avoir sur une facture réglée (inchangé), puis retour à « émise » par la contre-passation.
    test('trop-perçu : facture de 148,14 € réglée de 148,14 €, puis avoir de 12,01 € : « réglée », reste dû −12,01 €, sans entrée ; règlement contre-passé : « émise », reste dû 136,13 €, entrée RETOUR_EMISE avec « avoirs 12,01 € »', async () => {
      const facture = await factureEmise(par('AD'), 'trop-perçu', LIGNES_TROP_PERCU);
      assert.deepEqual(nombres([facture.totalHt, facture.totalTva, facture.totalTtc]), [123.45, 24.69, 148.14]);
      const r = await regler(facture.id, 148.14);
      const entrees = (await enBase(facture.id)).journal.length;
      const a = await avoirCree(facture.id, AVOIR_TROP_PERCU, par('AD'));
      // Lecture écartée : TVA arrondie au supérieur (2,01 €, TTC 12,02 €).
      assert.deepEqual(nombres([a.totalHt, a.totalTva, a.totalTtc]), [10.01, 2, 12.01]);
      // Lecture écartée : reste ramené à 0,00 €.
      assert.deepEqual(await soldes(facture.id), ['REGLEE', 12.01, 148.14, -12.01]);
      assert.equal((await enBase(facture.id)).journal.length, entrees, 'aucune entrée : statut inchangé');
      await contrepasser(r.id, 'TEST règlement saisi par erreur');
      assert.deepEqual(await soldes(facture.id), ['EMISE', 12.01, 0, 136.13]);
      assert.deepEqual((await transitions(facture.id)).at(-1), ['RETOUR_EMISE', comptes.AD.id, `Transition REGLEE → EMISE (contre-passation du règlement ${r.id}) : réglé 0,00 €, avoirs 12,01 €, reste dû 136,13 €`]);
    });

    // Facture émise à 0,00 € TTC (N3) : reste « émise », sans précision, et reçoit le refus « déjà soldée », seul cas où il est
    // encore atteint (cadrage v3, C2 et N14), par l'API comme par la garde des affectations.
    test('facture à 0,00 € : s’émet, reste « émise » (reste dû 0,00 €, ni règlement ni avoir), règlement refusé par « déjà soldée » (409) sans écriture, affectation écrite en base refusée parce qu’elle est soldée', async () => {
      const facture = await factureEmise(par('AD'), 'facture offerte', LIGNES_ZERO);
      assert.deepEqual([facture.statut, ...nombres([facture.totalHt, facture.totalTva, facture.totalTtc])], ['EMISE', 0, 0, 0]);
      assert.deepEqual(await soldes(facture.id), ['EMISE', 0, 0, 0]);
      // Lecture écartée (refus de statut, celui d'une facture réglée) : le refus « déjà soldée ».
      await refuse(() => reglement(facture.id, 10), 409, REFUS.dejaSoldee(facture.numero), 'règlement sur une facture à 0,00 €');
      assert.ok(!(await aRegler()).some(([id]) => id === facture.id));
      const auteur = comptes.AD.id;
      await refuseEnBase(() => prisma.reglement.create({ data: { clientId: client.id, dateReglement: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`), montant: 5, moyen: 'VIREMENT', createdById: auteur, affectations: { create: [{ factureId: facture.id, montant: 5 }] } } }), GARDE.affectationSoldee(facture.id), 'affectation écrite en base');
      assert.deepEqual([(await enBase(facture.id)).statut, await transitions(facture.id)], ['EMISE', []]);
    });

    // Cadrage v3, C8 : « soldée » se lit sur une somme positive (parts de règlements non contre-passés et TTC des avoirs partiels
    // émis), en base comme dans l'API. Depuis le lot « Pas d'avoir à 0,00 € » (réponse de Nelson du 10-11-2026 : « si 0€ pas d'avoir,
    // on ne fais pas d'avoir a 0€ » ; cadrage v2, § 3, et section « Tests », « Tests existants à adapter »), un avoir émis à 0,00 €
    // n'existe plus : l'API refuse une ligne au prix nul (« Ligne d’avoir partiel invalide. ») comme une ligne dont le total s'arrondit
    // à 0,00 € (test suivant), et, écrit directement en base sur une facture à 0,00 €, il est refusé au COMMIT par la garde de la
    // migration 20261110120000_avoir_non_nul, au message exact. L'écriture simple d'avant le lot (sur l'avoir de 0,00 € déjà émis)
    // n'a plus d'objet ici ; sur une base qui portait un tel avoir avant la migration, elle est éprouvée par
    // avoir-non-nul-migration.test.mjs. La facture reste « émise » et garde le refus « déjà soldée ». Lecture écartée (avant le lot) :
    // avoir de 0,00 € émis en base sans refus au COMMIT. La seconde condition des gardes en base (somme positive) reste éprouvée par
    // le test « gardes en base : l’avoir d’annulation ne compte pas… » (facture à 0,00 € sans règlement ni avoir émis, passée
    // « réglée » : refusée ; avoir brouillon non compté).
    test('avoir partiel de 0,00 € sur une facture à 0,00 € : refusé par l’API (400, ligne au prix nul) et refusé au COMMIT s’il est écrit en base (garde de l’avoir à 0,00 €, message exact), sans écriture ; la facture reste « émise », ne passe pas « réglée », et garde le refus « déjà soldée »', async () => {
      const facture = await factureEmise(par('AD'), 'avoir à zéro', LIGNES_ZERO);
      assert.deepEqual([facture.statut, Number(facture.totalTtc)], ['EMISE', 0]);
      await refuse(() => avoir(facture.id, [ligne('avoir à zéro', 1, 0, 20)], par('AD')), 400, 'Ligne d’avoir partiel invalide.', 'avoir de 0,00 € par l’API');
      const id = randomUUID();
      await refuseEnBase(() => transaction((tx) => pieceSql(tx, { id, factureOrigineId: facture.id, taux: [[20, 0, 0]] })), GARDE.avoirZero(id, facture.id), 'avoir de 0,00 € écrit en base');
      const relue = await prisma.facture.findUniqueOrThrow({ where: { id: facture.id }, include: { avoirs: true } });
      assert.deepEqual([relue.statut, relue.avoirs.length], ['EMISE', 0]);
      assert.deepEqual(await soldes(facture.id), ['EMISE', 0, 0, 0]);
      await refuseEnBase(() => prisma.facture.update({ where: { id: facture.id }, data: { statut: 'REGLEE' } }), GARDE.passeReglee, 'facture à 0,00 €, sans avoir, passée réglée');
      await refuse(() => reglement(facture.id, 10), 409, REFUS.dejaSoldee(facture.numero), 'règlement sur une facture à 0,00 €');
      assert.deepEqual(await transitions(facture.id), []);
    });

    // C1 de l'audit des montants de #524, côté API : un avoir partiel de 0,00 € se créait d'une ligne dont le total s'arrondit à
    // 0,00 € HT (0,001 × 0,01 € = 0,00001 €). Depuis le lot « Pas d'avoir à 0,00 € » (cadrage v2, section « Tests », « Conséquence
    // déclarée »), cette ligne est refusée (400 au message exact), sans numéro ni écriture, et la facture à 0,00 € reste « émise ».
    // Lecture écartée (avant le lot) : 201, avoir de 0,00 € numéroté.
    // Conséquence déclarée : la seconde condition de synchroniserStatutReglement (reglements/metier.ts : montantRegle > 0 ou
    // montantAvoirs > 0) n'est plus atteinte par aucun chemin de l'API. Elle reste dans le code comme défense, alignée sur les gardes
    // en base facture_statut_reglements et facture_statut_reglement_differe, dont la seconde condition reste éprouvée en base (test
    // « gardes en base : l’avoir d’annulation ne compte pas… »). Le mutant qui la retire côté API est donc équivalent, et non un test
    // manquant : seule une facture à 0,00 € a un reste dû nul sans rien de réglé ni de crédité, et aucun des quatre cas suivants,
    // répartis sur les trois appels de synchroniserStatutReglement (avoir partiel, règlement, contre-passation), ne l'atteint plus :
    //  - un règlement : refusé « déjà soldée » (409) avant la synchronisation (test « facture à 0,00 € » plus haut, et ce test) ;
    //  - un avoir partiel positif : refusé par le plafond (409 ; avoir-non-nul.test.mjs, critère 4) ;
    //  - un avoir partiel d'une ligne à 0,00 € : refusé (400, ce test) ;
    //  - une contre-passation : elle suppose un règlement, que la facture ne reçoit pas.
    test('avoir partiel de 0,00 € par l’API (0,001 × 0,01 €, arrondi à 0,00 € HT) sur une facture à 0,00 € : refusé (400 « Une ligne d’avoir à 0,00 € n’est pas admise : Iris n’émet pas d’avoir à 0,00 €. ») par l’administration, le directeur et l’assistante technique (sa facture), sans numéro ni écriture ; la facture reste « émise » (avoirs 0,00 €, reste dû 0,00 €), sans entrée de transition, et garde le refus « déjà soldée »', async () => {
      assert.equal(exact.ligneHt(0.001, 0.01), 0n, 'témoin : 0,00001 € arrondi au centime');
      const facture = await factureEmise(par('AD'), 'avoir à zéro par l’API', LIGNES_ZERO);
      const sienne = await factureEmise(par('AT'), 'avoir à zéro par l’API, assistante', LIGNES_ZERO);
      const sequence = async () => (await prisma.sequenceAvoir.findUnique({ where: { annee: jour().annee } }))?.dernierNumero ?? 0;
      const avant = await sequence();
      for (const [f, auteur] of [[facture, 'AD'], [facture, 'DIR'], [sienne, 'AT']]) {
        await refuse(() => avoir(f.id, [ligne('avoir arrondi à zéro', 0.001, 0.01, 20)], par(auteur)), 400, REFUS.ligneZero, `avoir de 0,00 € par l’API, ${auteur}`);
      }
      assert.equal(await sequence(), avant, 'aucun numéro d’avoir consommé');
      for (const f of [facture, sienne]) {
        assert.equal((await enBase(f.id)).statut, 'EMISE');
        assert.deepEqual(await soldes(f.id), ['EMISE', 0, 0, 0]);
        assert.deepEqual(await transitions(f.id), []);
        await refuse(() => reglement(f.id, 10), 409, REFUS.dejaSoldee(f.numero), 'règlement sur une facture à 0,00 €');
      }
    });

    // Critère 6 et gardes SQL du cadrage : écritures directes refusées, messages exacts ; avoir d'annulation et avoir brouillon non
    // comptés ; annulation refusée après un règlement, et seulement après un règlement.
    test('critère 6, gardes en base : « réglée » d’une facture non soldée refusée, « émise » d’une facture soldée par ses avoirs refusée, avoir écrit en base qui solde une facture « émise » refusé au COMMIT sauf si la même transaction la passe « réglée » après lui ; facture née « réglée » refusée ; messages exacts, rien d’écrit', async () => {
      // « Réglée » d'une facture non soldée : sans avoir, puis couverte en partie par un avoir de 20,00 €.
      const libre = await factureEmise(par('AD'), 'garde libre', LIGNES_CENT);
      const partielle = await factureEmise(par('AD'), 'garde partielle', LIGNES_CENT);
      await avoirCree(partielle.id, AVOIR_VINGT, par('AD'));
      for (const [f, quoi] of [[libre, 'sans avoir'], [partielle, 'couverte en partie par un avoir']]) {
        await refuseEnBase(() => prisma.facture.update({ where: { id: f.id }, data: { statut: 'REGLEE' } }), GARDE.passeReglee, `« réglée » ${quoi}`);
        assert.equal((await enBase(f.id)).statut, 'EMISE');
      }
      // « Émise » d'une facture soldée par ses avoirs (lecture écartée : la garde d'avant le lot, qui l'exigeait).
      const soldee = await factureEmise(par('AD'), 'garde soldée par avoir', LIGNES_CENT);
      await avoirCree(soldee.id, AVOIR_TOTAL_CENT, par('AD'));
      await refuseEnBase(() => prisma.facture.update({ where: { id: soldee.id }, data: { statut: 'EMISE' } }), GARDE.resteReglee, '« émise » d’une facture soldée par ses avoirs');
      assert.equal((await enBase(soldee.id)).statut, 'REGLEE');

      // Avoir écrit directement en base qui solde une facture « émise » (120,00 € sur 120,00 €).
      const cible = await factureEmise(par('AD'), 'garde avoir écrit en base', LIGNES_CENT);
      const avoirSql = (tx) => pieceSql(tx, { factureOrigineId: cible.id, taux: [[20, 100, 20]] });
      // Seul : refusé au COMMIT par la vérification différée.
      await refuseEnBase(() => transaction((tx) => avoirSql(tx)), GARDE.differee(cible.id, 'EMISE'), 'avoir seul qui solde');
      // Passée « réglée » avant l'avoir : refusée par la garde immédiate (elle n'est pas encore soldée).
      await refuseEnBase(() => transaction(async (tx) => {
        await tx.facture.update({ where: { id: cible.id }, data: { statut: 'REGLEE' } });
        return avoirSql(tx);
      }), GARDE.passeReglee, 'réglée avant l’avoir');
      assert.equal((await enBase(cible.id)).statut, 'EMISE');
      // Passée « réglée » après l'avoir, dans la même transaction : admise.
      const admis = await transaction(async (tx) => {
        const a = await avoirSql(tx);
        await tx.facture.update({ where: { id: cible.id }, data: { statut: 'REGLEE' } });
        return a;
      });
      assert.equal((await enBase(cible.id)).statut, 'REGLEE');
      assert.deepEqual(await soldes(cible.id), ['REGLEE', 120, 0, 0]);
      assert.equal((await enBase(admis.id)).factureOrigineId, cible.id);

      // Une facture ne naît jamais « réglée ».
      const identite = await prisma.identiteEmetteur.findFirstOrThrow({ select: { id: true } });
      await refuseEnBase(() => prisma.facture.create({ data: {
        clientId: client.id, clientRaisonSociale: client.raisonSociale, type: 'FACTURE', statut: 'REGLEE', numero: `TEST-NEE-REGLEE-${suffixe()}`,
        dateEmission: new Date('2026-09-11T00:00:00.000Z'), dateEcheance: new Date('2026-09-11T00:00:00.000Z'), totalHt: 10, totalTva: 2, totalTtc: 12,
        origine: 'HORS_AFFAIRE', motifHorsAffaire: 'TEST statut née réglée', identiteEmetteurId: identite.id,
      } }), GARDE.creeeReglee, 'facture née réglée');
    });

    test('gardes en base : l’avoir d’annulation ne compte pas comme avoir partiel (annulée → réglée refusée par la garde des règlements), l’avoir brouillon non plus (facture à 0,00 €), et le refus d’annuler reste fondé sur les seuls règlements', async () => {
      // Facture annulée par son avoir total (avoir d'annulation de 120,00 €, qui couvre tout son TTC). Lecture écartée : avoir
      // d'annulation compté, la facture serait « soldée » et seule la garde du cycle la refuserait, avec son message.
      const annulee = await factureEmise(par('AD'), 'garde annulée', LIGNES_CENT);
      const annulation = await ok(appeler('post', `/factures/${annulee.id}/annuler`, {}, par('AD')));
      assert.deepEqual([annulation.statut, annulation.avoir.estAvoirAnnulation, Number(annulation.avoir.totalTtc)], ['ANNULEE', true, 120]);
      await refuseEnBase(() => prisma.facture.update({ where: { id: annulee.id }, data: { statut: 'REGLEE' } }), GARDE.passeReglee, 'annulée → réglée');
      assert.equal((await enBase(annulee.id)).statut, 'ANNULEE');

      // Facture à 0,00 € (reste dû nul) et un avoir partiel resté brouillon, écrit en base : admis, elle reste « émise ». Lecture
      // écartée : avoir brouillon compté (la vérification différée la dirait soldée et refuserait l'avoir au COMMIT).
      const offerte = await factureEmise(par('AD'), 'garde brouillon', LIGNES_ZERO);
      const brouillonAvoir = await transaction((tx) => pieceSql(tx, { factureOrigineId: offerte.id, statut: 'BROUILLON', taux: [[20, 1, 0.2]] }));
      assert.equal(brouillonAvoir.statut, 'BROUILLON');
      assert.equal((await enBase(offerte.id)).statut, 'EMISE');
      // Ni règlement ni avoir partiel émis : la facture à 0,00 € ne passe pas « réglée » (seconde condition, N3).
      await refuseEnBase(() => prisma.facture.update({ where: { id: offerte.id }, data: { statut: 'REGLEE' } }), GARDE.passeReglee, 'facture à 0,00 € passée réglée');

      // Annulation après un règlement : refus inchangé, au message exact.
      const payee = await factureEmise(par('AD'), 'garde annulation après règlement', LIGNES_CENT);
      await regler(payee.id, 30);
      await refuseEnBase(() => prisma.facture.update({ where: { id: payee.id }, data: { statut: 'ANNULEE' } }), GARDE.annuleeAvecReglement, 'annulée après un règlement');
      // Avoir partiel seul, sans règlement : ce refus ne s'applique pas (lecture écartée : avoir compté comme un règlement) ; la
      // garde du cycle refuse l'annulation faute d'avoir d'annulation.
      const creditee = await factureEmise(par('AD'), 'garde annulation après avoir', LIGNES_CENT);
      await avoirCree(creditee.id, AVOIR_VINGT, par('AD'));
      const erreur = await refuseEnBase(() => transaction((tx) => tx.facture.update({ where: { id: creditee.id }, data: { statut: 'ANNULEE' } })), GARDE.sansAvoirAnnulation, 'annulée avec un avoir partiel');
      assert.ok(!String(erreur.message).includes(GARDE.annuleeAvecReglement), 'pas le refus des règlements');
      assert.equal((await enBase(creditee.id)).statut, 'EMISE');
    });
  });
}
