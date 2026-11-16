// Lot #522 : avoir partiel, cumuls et plafonds calculés en décimal exact (cadrage v2, contrôlé « prêt à coder » ; sections
// « Périmètre », 1 à 4, « Critères métier observables » et « Tests »).
//
// Origine et décisions appliquées :
//  - note N3 de l'audit des montants de #520 (AT-4), versée à l'issue #522 (`suivi-audit`) : « Passer les cumuls et les contrôles
//    de plafond de `/avoirs` en `Prisma.Decimal`, comme `soldesFactures`. » ;
//  - message de Nelson du 16-11-2026, mot pour mot : « continu avec les issu. » (lecture retenue : historique, « Décisions du
//    16-11-2026 », point 2) ;
//  - décision du 10-11-2026 sur les avoirs (pas d'avoir à 0,00 €, avoirs comptés comme règlements) et AT-4 (message de Nelson du
//    09-11-2026 : « elle peut egalement faire un avoir, ») : les plafonds valent quel que soit l'auteur, administration ou
//    assistante technique sur les factures de son poste.
//
// Ce que le lot est (N1 du contrôle) : un renforcement sans changement observable. Le contrôleur a montré qu'il faudrait au moins
// 5 243 avoirs sur une même facture, pour plus de 8,6 milliards d'euros crédités, pour que l'ancien calcul en nombres s'écarte d'un
// centime. Les tests ci-dessous sont donc des tests de non-régression aux limites, qui passent aussi sur `main` ; le mutant
// « retour au calcul en nombres » n'est pas constructible par l'API (corps JSON limité à 100 Ko, bornes des montants), et il est
// déclaré tel quel, sans test.
//
// Contrat éprouvé (POST /api/factures/:id/avoirs ; messages et ordre des refus inchangés) :
//  - la TVA de chaque taux de l'avoir est la différence des arrondis des bases HT cumulées, avant et après lui, avoirs précédents de
//    tout auteur compris, y compris un avoir sans ventilation enregistrée (repli sur ses lignes, N6) ;
//  - plafonds globaux (HT, TVA, TTC) lus d'abord : 409 « Cet avoir dépasse le montant total restant à créditer sur la facture
//    d’origine. » ; puis plafonds par taux, dans l'ordre croissant des taux : 409 « Cet avoir dépasse le plafond restant pour la TVA
//    à <taux> % de la facture d’origine. » ; un plafond atteint exactement est admis ;
//  - chaque refus : rien d'écrit (empreinte de toute la base, journal et séquence compris), aucun numéro d'avoir consommé.
//
// Mutants (cadrage, « Mutants à tuer » et N2) : voir le rapport du rédacteur des tests. Le retrait du plafond TTC global, et celui de
// chacun des trois plafonds d'un taux pris seul, ne se voient sur aucune facture que l'API crée (la TVA cumulée d'un taux est
// l'arrondi de sa base cumulée, fonction croissante de la base : un dépassement du HT du taux dépasse son TTC, et inversement ; le TTC
// global est la somme du HT et de la TVA) : ils sont tués par des factures écrites en SQL, déclarées théoriques (#243). Le retrait
// du plafond de TVA global, lui, se voit par l'API, sur une facture cohérente : le refus passe alors au plafond du taux (autre
// message).
//
// Montants (classés C : CLAUDE.md, « un test manquant qui touche un montant ») : chaque valeur est choisie pour qu'une autre lecture
// plausible de la règle donne un autre résultat ; la lecture écartée est écrite en commentaire, et le test « témoin des montants »
// recalcule chaque attendu en décimal exact, hors de l'application, et vérifie que chaque lecture écartée en diffère : TVA arrondie
// par avoir au lieu de la différence des cumuls, troncature, arrondi au pair, calcul flottant.
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

const TITRE = 'Avoir partiel (#522) : cumuls et plafonds en décimal exact, longue série de petits avoirs à 20 %, 10 % et 5,5 % jusqu’au plafond exact, dépassement d’un centime refusé en 409';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROLE = { SA: 'SUPERADMIN', AD: 'ADMIN', DIR: 'DIRECTEUR', AT: 'ASSISTANTE_TECHNIQUE' };
const AUTRES_TYPES = [
  ['CT', 'CONDUCTEUR_TRAVAUX'], ['RESP', 'RESPONSABLE'], ['TECH', 'TECHNICIEN'], ['COM', 'COMMERCIAL'],
  ['DC', 'DIRECTEUR_COMMERCIAL'], ['AC', 'ASSISTANTE_COMMERCIALE'], ['CPT', 'COMPTABLE'],
];

// Messages exacts de l'API (apostrophes typographiques). Le taux est écrit comme l'API l'écrit (5.5, et non 5,5).
const REFUS = {
  plafondTotal: 'Cet avoir dépasse le montant total restant à créditer sur la facture d’origine.',
  plafondTaux: (taux) => `Cet avoir dépasse le plafond restant pour la TVA à ${taux} % de la facture d’origine.`,
  introuvable: 'Facture introuvable.',
  gestion: 'Accès réservé à l’administration et à l’assistante technique.',
};

// --- Calcul exact, hors de l'application (témoins des montants) ---
// Montants en centimes entiers, taux en millièmes de pour cent ; arrondi au centime, moitié vers le haut (règle d'Iris, tvaDuTaux).
const exact = {
  unites: (valeur, decimales) => {
    const [entier, fraction = ''] = String(valeur).split('.');
    return BigInt(entier) * 10n ** BigInt(decimales) + BigInt((fraction + '0'.repeat(decimales)).slice(0, decimales) || '0');
  },
  tva: (baseCentimes, taux) => (baseCentimes * exact.unites(taux, 3) + 50000n) / 100000n,
  // Lectures écartées.
  tvaTronquee: (baseCentimes, taux) => (baseCentimes * exact.unites(taux, 3)) / 100000n,
  tvaAuPair: (baseCentimes, taux) => {
    const produit = baseCentimes * exact.unites(taux, 3); const quotient = produit / 100000n; const reste = produit % 100000n;
    return reste > 50000n || (reste === 50000n && quotient % 2n === 1n) ? quotient + 1n : quotient;
  },
  // Lecture flottante (a) : base cumulée additionnée en nombres sans être ramenée au centime, TVA = Math.round(base × taux) centimes.
  tvaFlottanteCumul: (baseEuros, taux) => BigInt(Math.round(baseEuros * taux)),
  // Lecture flottante (b) : TVA = (base × taux / 100).toFixed(2), base exacte en euros.
  tvaFlottanteToFixed: (baseCentimes, taux) => BigInt(Math.round(Number(((Number(baseCentimes) / 100) * taux / 100).toFixed(2)) * 100)),
  euros: (centimes) => Number(centimes) / 100,
};

// --- Jeu de montants ---
const NATURE = { 20: 'PRESTATION', 10: 'PRESTATION', 5.5: 'ARTICLE' };
const ligne = (designation, quantite, prixUnitaireHt, tauxTva, nature = NATURE[tauxTva] ?? 'PRESTATION') => ({ designation: `TEST décimal ${designation}`, nature, quantite, prixUnitaireHt, tauxTva });
// Une ligne d'avoir de 1 × <centimes> au taux donné.
const L = (taux, centimes, quoi = 'reprise') => ligne(`${quoi} à ${taux} %`, 1, exact.euros(centimes), taux);

// Série (cadrage, critère 1 : « 0,10 € HT répétés, sur des taux de 20 %, 10 % et 5,5 % ») : facture F de trois lignes, une par taux,
// et 49 avoirs successifs, chacun d'une ligne de 0,07 € à 20 %, 0,07 € à 10 % et 0,10 € à 5,5 % tant que le taux a de la place :
//  - 5,5 % : base 3,00 € (30 × 0,10), TVA 0,165 → 0,17 (troncature et arrondi au pair : 0,16 ; toFixed : 0,17), atteinte au 30e avoir ;
//  - 10 % : base 2,45 € (35 × 0,07), TVA 0,245 → 0,25 (troncature, au pair, toFixed : 0,24), atteinte au 35e avoir ;
//  - 20 % : base 3,43 € (49 × 0,07), TVA 0,686 → 0,69 (troncature : 0,68), atteinte au 49e avoir.
// F : HT 8,88 €, TVA 1,11 € (lectures écartées : troncature 1,08 ; au pair 1,09 ; toFixed 1,10), TTC 9,99 €. Avoirs 1 à 30 de trois
// lignes (0,24 € HT), 31 à 35 de deux (0,14 €), 36 à 49 d'une (0,07 €) : 7,20 + 0,70 + 0,98 = 8,88 €, le plafond exact.
// TVA différentielle de chaque avoir, par taux (centimes ; calculée indépendamment par le script du rédacteur, et recalculée par le
// témoin) : 0,07 € à 20 % fait 1,4 centime par pas, à 10 % 0,7 centime, et 0,10 € à 5,5 % 0,55 centime ; arrondir la TVA de chaque
// avoir seul donnerait 1 centime à chaque pas (lecture écartée), soit 0,49 €, 0,35 € et 0,30 € au lieu de 0,69 €, 0,25 € et 0,17 €.
const SERIE = [
  { taux: 5.5, base: 300n, pas: 10n, tva: '1,0,1,0,1,0,1,0,1,1,0,1,0,1,0,1,0,1,0,1,1,0,1,0,1,0,1,0,1,1' },
  { taux: 10, base: 245n, pas: 7n, tva: '1,0,1,1,1,0,1,1,0,1,1,0,1,1,1,0,1,1,0,1,1,0,1,1,1,0,1,1,0,1,1,0,1,1,1' },
  { taux: 20, base: 343n, pas: 7n, tva: '1,2,1,2,1,1,2,1,2,1,1,2,1,2,1,1,2,1,2,1,1,2,1,2,1,1,2,1,2,1,1,2,1,2,1,1,2,1,2,1,1,2,1,2,1,1,2,1,2' },
].map((s) => ({ ...s, n: Number(s.base / s.pas) }));
const N_AVOIRS = 49;
const LIGNES_SERIE = [ligne('pose de la centrale', 1, 3.43, 20), ligne('main-d’œuvre de mise en service', 1, 2.45, 10), ligne('fourniture des détecteurs', 1, 3, 5.5)];
const F_SERIE = { totaux: [8.88, 1.11, 9.99], ventilation: [[5.5, 3, 0.17, 3.17], [10, 2.45, 0.25, 2.7], [20, 3.43, 0.69, 4.12]] };
const lignesAvoir = (k) => SERIE.filter((s) => k <= s.n).map((s) => L(s.taux, s.pas, `reprise n° ${k}`));

// Témoin de la série : pour chaque avoir, ventilation [taux, HT, TVA, TTC] (centimes, taux croissants), totaux, et TVA par taux sous
// chaque lecture écartée.
const temoinSerie = () => {
  const cumul = new Map(SERIE.map((s) => [s.taux, 0n]));
  const cumulFlottant = new Map(SERIE.map((s) => [s.taux, 0]));
  const avoirs = [];
  for (let k = 1; k <= N_AVOIRS; k += 1) {
    const ventilation = []; const lectures = { parAvoir: [], tronquee: [], auPair: [], flottanteCumul: [], flottanteToFixed: [] };
    for (const s of SERIE.filter((x) => k <= x.n)) {
      const avant = cumul.get(s.taux); const apres = avant + s.pas;
      const tva = exact.tva(apres, s.taux) - exact.tva(avant, s.taux);
      ventilation.push([s.taux, s.pas, tva, s.pas + tva]);
      lectures.parAvoir.push(exact.tva(s.pas, s.taux));
      lectures.tronquee.push(exact.tvaTronquee(apres, s.taux) - exact.tvaTronquee(avant, s.taux));
      lectures.auPair.push(exact.tvaAuPair(apres, s.taux) - exact.tvaAuPair(avant, s.taux));
      const fAvant = cumulFlottant.get(s.taux); const fApres = fAvant + Number(s.pas) / 100;
      lectures.flottanteCumul.push(exact.tvaFlottanteCumul(fApres, s.taux) - exact.tvaFlottanteCumul(fAvant, s.taux));
      lectures.flottanteToFixed.push(exact.tvaFlottanteToFixed(apres, s.taux) - exact.tvaFlottanteToFixed(avant, s.taux));
      cumul.set(s.taux, apres); cumulFlottant.set(s.taux, fApres);
    }
    const ht = ventilation.reduce((somme, v) => somme + v[1], 0n); const tva = ventilation.reduce((somme, v) => somme + v[2], 0n);
    avoirs.push({ k, ventilation, totaux: [ht, tva, ht + tva], lectures });
  }
  return avoirs;
};
const versEuros = (liste) => liste.map((valeur) => (typeof valeur === 'bigint' ? exact.euros(valeur) : valeur));

// Plafond de TVA global seul franchi (facture cohérente, créée par l'API) : facture G, 1 × 3,47 € à 20 % (TVA 0,694 → 0,69) et
// 1 × 2,49 € à 10 % (TVA 0,249 → 0,25) ; HT 5,96 €, TVA 0,94 €, TTC 6,90 €.
//  - G1 : 2,45 € à 10 % : TVA 0,245 → 0,25 ; la TVA du taux est atteinte (0,25 €) alors que sa base a encore 0,04 € de place ;
//  - refus : 0,05 € de plus à 10 % : base 2,50 € > 2,49 €, 409 du taux 10 % (lecture écartée : TVA du taux atteinte prise pour un taux
//    épuisé, qui refuserait aussi G4) ;
//  - refus : 3,48 € à 20 % : TVA 0,696 → 0,70. Total : HT 5,93 € ≤ 5,96 €, TVA 0,95 € > 0,94 €, TTC 6,88 € ≤ 6,90 € : seul le plafond de
//    TVA global est franchi, 409 du total (lecture écartée, plafond de TVA global absent : 409 du taux 20 %, 3,48 € > 3,47 €) ;
//  - G3 : 3,47 € à 20 %, TVA 0,69 € : TVA globale 0,94 €, plafond exact admis (lecture écartée : comparaison large, qui refuserait) ;
//  - G4 : 0,04 € à 10 % : base 2,49 €, TVA 0,25 − 0,25 = 0,00 €, TTC 0,04 € ; HT 5,96 € et TTC 6,90 € exacts : facture créditée en
//    entier, « réglée ».
const LIGNES_G = [ligne('pose', 1, 3.47, 20), ligne('main-d’œuvre', 1, 2.49, 10)];

// Repli sur les lignes d'un avoir sans ventilation enregistrée (cadrage, § 1, N6) : facture H, 1 × 10,00 € à 10 % et 1 × 10,00 € à
// 20 % (HT 20,00 €, TVA 3,00 €, TTC 23,00 €), qui porte un avoir écrit en SQL sans ventilation (document historique, théorique) :
// 1 × 0,05 € à 10 %, TVA déduite de ses lignes 0,005 → 0,01 €, TTC 0,06 €.
//  - refus : 9,96 € à 10 % : base cumulée 10,01 € > 10,00 €, 409 du taux 10 % (lecture écartée, avoir sans ventilation oublié :
//    9,96 € ≤ 10,00 €, admis par l'API puis refusé par la base, 500) ;
//  - H1 : 0,05 € à 10 % : TVA de 0,10 € (0,01) moins celle de 0,05 € (0,01) = 0,00 € (lecture écartée, avoir oublié : 0,01 €) ;
//  - H2 : 9,90 € à 10 % : base 10,00 €, TVA 1,00 − 0,01 = 0,99 €, TTC 10,89 € ; le taux est épuisé exactement.
const LIGNES_H = [ligne('maintenance à 10 %', 1, 10, 10), ligne('maintenance à 20 %', 1, 10, 20)];

// Factures écrites en SQL, théoriques (#243 : une facture écrite en SQL peut porter un TTC différent de HT + TVA, ou une ventilation
// qui ne suit pas ses totaux ; l'API n'en crée aucune). Chacune isole un plafond, que l'avoir de 1 × <avoir> € à 20 % est seul à
// franchir. Le plafond retiré, l'API admettrait l'avoir, que la garde en base (verifier_plafond_avoirs) refuserait au COMMIT : 500.
// Avoir de 100,00 € à 20 % : TVA 20,00 €, TTC 120,00 € ; avoir de 100,01 € : TVA 20,002 → 20,00 €, TTC 120,01 €.
const THEORIQUES = [
  { plafond: 'TTC global', totaux: [100, 20, 119.99], ventilation: [100, 20, 120], avoir: 10000n, refus: REFUS.plafondTotal },
  { plafond: 'HT du taux', totaux: [100.01, 20, 120.01], ventilation: [100, 20, 120.01], avoir: 10001n, refus: REFUS.plafondTaux(20) },
  { plafond: 'TVA du taux', totaux: [100, 20, 120], ventilation: [100, 19.99, 120], avoir: 10000n, refus: REFUS.plafondTaux(20) },
  { plafond: 'TTC du taux', totaux: [100, 20, 120], ventilation: [100, 20, 119.99], avoir: 10000n, refus: REFUS.plafondTaux(20) },
];

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    // « test » comme mot (règle de client/scripts/base-jetable.mjs) et un suffixe tiré au hasard.
    const nomBase = `iris_test_avoir_decimal_${randomBytes(6).toString('hex')}`;
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
    let rang = 0;
    const suffixe = () => `${Date.now()}${(rang += 1)}`;
    let client = null;

    // --- Appels ---
    const entete = (jeton) => ({ Authorization: `Bearer ${jeton}` });
    const par = (cle) => (cle === 'SA' ? entete(session) : entete(jwt.sign({ id: comptes[cle].id }, process.env.JWT_SECRET)));
    const idDe = (cle) => (cle === 'SA' ? secours.id : comptes[cle].id);
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
      return { fr: `${v('day')}-${v('month')}-${v('year')}`, annee: Number(v('year')) };
    };

    // --- État de la base ---
    // Empreinte de toute la base (modèle : avoir-non-nul.test.mjs) : chaque table du schéma public, hors historique des migrations,
    // nombre de lignes et empreinte du contenu. Un refus ne doit rien y changer, ni `updatedAt`, ni journal, ni séquence.
    const sqlEmpreinte = (table) => `SELECT '${table}' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${table}" x`;
    let requeteEmpreinte = null;
    const empreinte = async () => {
      if (!requeteEmpreinte) {
        const tables = (await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`).map((t) => t.tablename);
        assert.ok(['Facture', 'FactureLigne', 'FactureVentilationTva', 'SequenceAvoir', 'JournalFacture', 'EcritureFacture'].every((t) => tables.includes(t)), `tables relevées : ${tables.join(', ')}`);
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
    // Transaction vérifiée avant sa fin : Prisma résout une transaction interactive dont le COMMIT échoue.
    const transaction = (operations) => prisma.$transaction(async (tx) => {
      const resultat = await operations(tx);
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return resultat;
    });
    const enBase = (id) => prisma.facture.findUniqueOrThrow({ where: { id }, include: { journal: { orderBy: { createdAt: 'asc' } }, lignes: { orderBy: { ordre: 'asc' } }, ventilationTva: true, ecrituresComptables: { orderBy: { ordre: 'asc' } } } });
    const nombres = (liste) => liste.map((valeur) => (valeur === null || valeur === undefined ? valeur : Number(valeur)));
    const ventilation = (piece) => [...piece.ventilationTva].sort((a, b) => Number(a.tauxTva) - Number(b.tauxTva)).map((v) => nombres([v.tauxTva, v.totalHt, v.totalTva, v.totalTtc]));
    const centimesDe = (valeur) => Math.round(Number(valeur) * 100);

    // --- Données ---
    const creerCompte = async (cle, role) => {
      const s = suffixe();
      comptes[cle] = await prisma.user.create({ data: { email: `decimal.${cle.toLowerCase()}.${s}@iris.test`, name: `TEST décimal ${cle} ${s}`, role } });
    };
    const brouillon = (auth, motif, lignes) => ok(appeler('post', '/factures', {
      clientId: client.id, dateEmission: jour().fr, dateEcheance: jour().fr, lignes, origine: 'HORS_AFFAIRE', motifHorsAffaire: `TEST décimal ${motif} ${suffixe()}`,
    }, auth), 201);
    const factureEmise = async (auth, motif, lignes) => ok(appeler('post', `/factures/${(await brouillon(auth, motif, lignes)).id}/emettre`, {}, auth));
    const avoir = (id, lignes, auth) => appeler('post', `/factures/${id}/avoirs`, { lignes }, auth);
    const avoirCree = (id, lignes, auth) => ok(avoir(id, lignes, auth), 201);
    // Soldes d'une pièce dans la liste non paginée d'un lecteur : [statut, montantAvoirs, montantRegle, resteDu].
    const soldes = async (id, auth = par('AD')) => {
      const f = (await ok(appeler('get', '/factures', null, auth))).find((x) => x.id === id);
      return f ? [f.statut, f.montantAvoirs, f.montantRegle, f.resteDu] : null;
    };
    const numeroAvoir = (n) => `A${jour().annee}-${String(n).padStart(4, '0')}`;
    const totaux = (piece) => nombres([piece.totalHt, piece.totalTva, piece.totalTtc]);

    // Pièce écrite directement en base (modèle : avoir-non-nul.test.mjs), à un seul taux : une ligne, la ventilation donnée (ou
    // aucune), les totaux donnés, et des écritures équilibrées sur le TTC aux clés que l'application écrit (CLIENT, VENTE_PRESTATION,
    // TVA:<taux>), que l'avoir reprend ; scellée et émise.
    const pieceSql = async (tx, { type, factureOrigineId = null, taux, ligneHt, totaux: [totalHt, totalTva, totalTtc], ventilation: v = null }) => {
      const identite = await prisma.identiteEmetteur.findFirstOrThrow({ select: { id: true } });
      const date = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
      const piece = await tx.facture.create({ data: {
        id: randomUUID(), clientId: client.id, clientRaisonSociale: client.raisonSociale, type, statut: 'EMISE', factureOrigineId, estAvoirAnnulation: false,
        dateEmission: date, dateEcheance: date, totalHt, totalTva, totalTtc, origine: 'HORS_AFFAIRE', motifHorsAffaire: 'TEST décimal écrit en base', identiteEmetteurId: identite.id,
      } });
      await tx.factureLigne.create({ data: { factureId: piece.id, ordre: 0, designation: `TEST décimal en base ${taux} %`, nature: 'PRESTATION', quantite: 1, prixUnitaireHt: ligneHt, tauxTva: taux, totalHt: ligneHt, totalTtc: Math.round(ligneHt * (100 + taux)) / 100 } });
      if (v) await tx.factureVentilationTva.create({ data: { factureId: piece.id, tauxTva: taux, totalHt: v[0], totalTva: v[1], totalTtc: v[2] } });
      const facture = type === 'FACTURE';
      const sens = (montant, debiteur) => (debiteur === facture ? { debit: montant, credit: 0 } : { debit: 0, credit: montant });
      await tx.ecritureFacture.createMany({ data: [
        { factureId: piece.id, ordre: 0, cle: 'CLIENT', journalCode: 'VE', compteNum: '411000', compteLib: 'TEST Clients', ...sens(totalTtc, true) },
        { factureId: piece.id, ordre: 1, cle: 'VENTE_PRESTATION', journalCode: 'VE', compteNum: '706000', compteLib: 'TEST Ventes', ...sens(Math.round((totalTtc - totalTva) * 100) / 100, false) },
        { factureId: piece.id, ordre: 2, cle: `TVA:${taux}`, tauxTva: taux, journalCode: 'VE', compteNum: taux === 10 ? '445712' : '445710', compteLib: 'TEST TVA', ...sens(totalTva, false) },
      ] });
      return tx.facture.update({ where: { id: piece.id }, data: { ecrituresScellees: true } });
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
      secours = await prisma.user.findUniqueOrThrow({ where: { email: 'secours@iris.test' }, select: { id: true, role: true } });
      assert.equal(secours.role, ROLE.SA);
      // Identité de la société, plan comptable à trois taux (20 %, 10 %, 5,5 %), mentions légales publiées.
      await ok(appeler('put', '/company', { raisonSociale: 'TEST Émetteur décimal', siret: '52252252200052', adresse: '5 rue des Centimes', codePostal: '14000', ville: 'Caen', fuseauHoraire: 'Europe/Paris' }));
      const compte = (code, libelle, nature) => ok(appeler('post', '/comptabilite/comptes', { code, libelle, nature }), 201);
      const clients = await compte('411000', 'TEST Clients décimal', 'ACTIF');
      const prestations = await compte('706000', 'TEST Prestations décimal', 'PRODUIT');
      const articles = await compte('707000', 'TEST Articles décimal', 'PRODUIT');
      const tva20 = await compte('445710', 'TEST TVA 20 décimal', 'TVA');
      const tva55 = await compte('445711', 'TEST TVA 5,5 décimal', 'TVA');
      const tva10 = await compte('445712', 'TEST TVA 10 décimal', 'TVA');
      const motif = 'TEST paramétrage comptable du lot décimal';
      for (const [cle, donnees] of [['CLIENT', { compteId: clients.id }], ['VENTE_PRESTATION', { compteId: prestations.id }], ['VENTE_ARTICLE', { compteId: articles.id }], ['JOURNAL_VENTES', { journal: 'VE' }]]) {
        await ok(appeler('put', `/comptabilite/regles/${cle}`, { ...donnees, motif }));
      }
      await ok(appeler('put', '/comptabilite/tva/20', { compteId: tva20.id, motif }));
      await ok(appeler('put', '/comptabilite/tva/10', { compteId: tva10.id, motif }));
      await ok(appeler('put', '/comptabilite/tva/5.5', { compteId: tva55.id, motif }));
      const version = await ok(appeler('post', '/mentions-legales', { mentions: 'TEST mentions décimal', cgv: 'TEST CGV décimal', penalites: 'TEST pénalités décimal' }), 201);
      await ok(appeler('post', `/mentions-legales/${version.version}/publier`));
      for (const [cle, role] of [['AT', ROLE.AT], ['AD', ROLE.AD], ['DIR', ROLE.DIR], ...AUTRES_TYPES]) await creerCompte(cle, role);
      for (let essai = 1; ; essai += 1) {
        const res = await appeler('post', '/clients', { raisonSociale: `TEST Client décimal ${suffixe()}`, siren: String(randomInt(100_000_000, 1_000_000_000)) });
        if (res.status === 409 && essai < 5) continue;
        assert.equal(res.status, 201, JSON.stringify(res.body));
        client = res.body;
        break;
      }
      await ok(appeler('post', `/clients/${client.id}/sites`, { nom: 'TEST Facturation décimal', adresse: '5 rue des Centimes', codePostal: '14000', ville: 'Caen', estSiteFacturation: true }), 201);
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
    test('témoin des montants : série à 20 %, 10 % et 5,5 % (TVA différentielle de chaque avoir, sommes égales aux plafonds exacts), plafond de TVA global seul franchi, repli sur les lignes, factures théoriques ; chaque lecture écartée (TVA par avoir, troncature, arrondi au pair, flottant) distincte de l’attendu', () => {
      // Facture F : TVA par taux (5,5 %, 10 %, 20 %) et totaux. Lectures écartées : troncature (1,08), au pair (1,09), toFixed (1,10).
      const tvaF = SERIE.map((s) => exact.tva(s.base, s.taux));
      assert.deepEqual(tvaF, [17n, 25n, 69n]);
      assert.deepEqual(SERIE.map((s) => exact.tvaTronquee(s.base, s.taux)), [16n, 24n, 68n], 'lecture écartée : troncature');
      assert.deepEqual(SERIE.map((s) => exact.tvaAuPair(s.base, s.taux)), [16n, 24n, 69n], 'lecture écartée : arrondi au pair');
      assert.deepEqual(SERIE.map((s) => exact.tvaFlottanteToFixed(s.base, s.taux)), [17n, 24n, 69n], 'lecture écartée : toFixed');
      const htF = SERIE.reduce((somme, s) => somme + s.base, 0n); const tvaTotaleF = tvaF.reduce((a, b) => a + b, 0n);
      assert.deepEqual(versEuros([htF, tvaTotaleF, htF + tvaTotaleF]), F_SERIE.totaux);
      assert.deepEqual(SERIE.map((s, i) => versEuros([s.taux, s.base, tvaF[i], s.base + tvaF[i]])), F_SERIE.ventilation);
      assert.deepEqual(SERIE.map((s) => s.n), [30, 35, 49]);
      // Série : TVA différentielle de chaque avoir, par taux, égale à celle calculée indépendamment (écrite en dur dans SERIE).
      const temoin = temoinSerie();
      assert.equal(temoin.length, N_AVOIRS);
      for (const [i, s] of SERIE.entries()) {
        const parAvoir = temoin.filter((a) => a.k <= s.n).map((a) => a.ventilation.find((v) => v[0] === s.taux)[2]);
        assert.equal(parAvoir.join(','), s.tva, `TVA différentielle à ${s.taux} %`);
        // Sommes : la base et la TVA de la facture, exactement (plafond du taux atteint, et non dépassé).
        assert.equal(parAvoir.reduce((a, b) => a + b, 0n), tvaF[i], `TVA cumulée à ${s.taux} %`);
        assert.equal(temoin.filter((a) => a.k <= s.n).reduce((somme, a) => somme + a.ventilation.find((v) => v[0] === s.taux)[1], 0n), s.base);
        // Lecture écartée : TVA arrondie par avoir, 1 centime à chaque pas (0,30 € ; 0,35 € ; 0,49 €).
        const tvaParAvoir = temoin.filter((a) => a.k <= s.n).map((a) => a.lectures.parAvoir[a.ventilation.findIndex((v) => v[0] === s.taux)]);
        assert.ok(tvaParAvoir.every((t) => t === 1n));
        assert.notEqual(tvaParAvoir.reduce((a, b) => a + b, 0n), tvaF[i], `lecture écartée : TVA par avoir à ${s.taux} %`);
        // Lecture écartée : troncature des cumuls (0,16 € ; 0,24 € ; 0,68 €).
        const tvaTronquee = temoin.filter((a) => a.k <= s.n).reduce((somme, a) => somme + a.lectures.tronquee[a.ventilation.findIndex((v) => v[0] === s.taux)], 0n);
        assert.equal(tvaTronquee, tvaF[i] - 1n, `lecture écartée : troncature à ${s.taux} %`);
      }
      // Totaux de la série : 8,88 €, 1,11 €, 9,99 €, les plafonds exacts de F.
      assert.deepEqual(versEuros(temoin.reduce((t, a) => t.map((x, j) => x + a.totaux[j]), [0n, 0n, 0n])), F_SERIE.totaux);
      // Premiers avoirs : 1er, 0,24 € HT, TVA 1 + 1 + 1 = 0,03 €, TTC 0,27 € (troncature : 0 + 0 + 1 = 0,01 €) ; 2e, TVA 0 + 0 + 2 =
      // 0,02 € (par avoir : 0,03 € ; troncature : 1 + 1 + 1 = 0,03 €).
      assert.deepEqual(temoin[0].totaux, [24n, 3n, 27n]);
      assert.deepEqual(temoin[0].lectures.tronquee, [0n, 0n, 1n]);
      assert.deepEqual(temoin[1].ventilation.map((v) => v[2]), [0n, 0n, 2n]);
      assert.deepEqual([temoin[1].lectures.parAvoir, temoin[1].lectures.tronquee], [[1n, 1n, 1n], [1n, 1n, 1n]]);
      assert.deepEqual([temoin[29].totaux, temoin[34].totaux, temoin[48].totaux], [[24n, 3n, 27n], [14n, 2n, 16n], [7n, 2n, 9n]]);
      // Lecture écartée, TVA par avoir : le 18e avoir franchirait la TVA du taux 5,5 % (18 centimes > 17), le 26e celle du 10 %.
      assert.ok(18n > tvaF[0] && 26n > tvaF[1]);
      // Lecture écartée, flottant (a) : la base à 5,5 % du 10e avoir, 10 × 0,1 additionnés en nombres, vaut 0,9999999999999999 ; sa TVA
      // (5,4999… centimes) s'arrondit à 0,05 € au lieu de 0,06 € : le 10e avoir porterait 0,00 € de TVA à 5,5 % au lieu de 0,01 €, et le
      // 11e 0,01 € au lieu de 0,00 €.
      // TVA d'un avoir à un taux, exacte ou sous une lecture écartée (les taux épuisés sortent de l'avoir : on cherche le taux).
      const tvaDe = (avoirTemoin, taux, lecture = null) => {
        const i = avoirTemoin.ventilation.findIndex((v) => v[0] === taux);
        assert.ok(i >= 0, `taux ${taux} présent dans l’avoir n° ${avoirTemoin.k}`);
        return lecture ? avoirTemoin.lectures[lecture][i] : avoirTemoin.ventilation[i][2];
      };
      assert.deepEqual([tvaDe(temoin[9], 5.5), tvaDe(temoin[9], 5.5, 'flottanteCumul')], [1n, 0n]);
      assert.deepEqual([tvaDe(temoin[10], 5.5), tvaDe(temoin[10], 5.5, 'flottanteCumul')], [0n, 1n]);
      // Lecture écartée, flottant (b), toFixed : à 10 %, la base 2,45 € donne (0,245).toFixed(2) = 0,24 € : le 35e avoir porterait
      // 0,00 € de TVA à 10 % au lieu de 0,01 €.
      assert.deepEqual([tvaDe(temoin[34], 10), tvaDe(temoin[34], 10, 'flottanteToFixed')], [1n, 0n]);
      // Lecture écartée, arrondi au pair : le 35e avoir porterait 0,00 € de TVA à 10 % (24,5 centimes → 24).
      assert.equal(tvaDe(temoin[34], 10, 'auPair'), 0n);
      assert.deepEqual(temoin[34].ventilation.map((v) => v[0]), [10, 20], 'le 35e avoir ne porte plus de ligne à 5,5 %');
      // Refus de la série (état avant l'avoir n° k ; centimes) :
      //  - avant le 30e : 7 € à 20 %, 7 à 10 %, 11 à 5,5 % : 5,5 % 290 + 11 = 301 > 300, total 696 + 25 = 721 ≤ 888 (seul le taux) ;
      //  - avant le 35e : 7 à 20 %, 8 à 10 % : 10 % 238 + 8 = 246 > 245 (seul le taux) ;
      //  - avant le 49e (cumul 881 HT, 109 de TVA, 990 TTC) : 8 à 5,5 % : TVA du taux 300 → 308, 17 − 17 = 0 ; total HT 889 > 888,
      //    TVA 109 ≤ 111, TTC 998 ≤ 999 : seul le plafond HT global est franchi (lecture écartée, plafond HT global absent : 409 du taux
      //    5,5 %, base 308 > 300) ; 8 à 20 % : TVA 69 − 67 = 2, TTC 1000 > 999 (HT et TTC franchis).
      const cumulAvant = (k) => temoin.filter((a) => a.k < k).reduce((t, a) => t.map((x, j) => x + a.totaux[j]), [0n, 0n, 0n]);
      assert.deepEqual(cumulAvant(30)[0] + 25n, 721n);
      assert.deepEqual(cumulAvant(49), [881n, 109n, 990n]);
      assert.equal(exact.tva(308n, 5.5) - exact.tva(300n, 5.5), 0n);
      assert.ok(881n + 8n > htF && 109n + 0n <= tvaTotaleF && 881n + 8n + 109n <= htF + tvaTotaleF);
      assert.equal(exact.tva(344n, 20) - exact.tva(336n, 20), 2n);
      // Facture G : TVA 69 + 25 = 94 ; G1 : TVA de 2,45 € à 10 % = 25 (TVA du taux atteinte) ; refus de 3,48 € à 20 % : TVA 70, total
      // HT 593 ≤ 596, TVA 95 > 94, TTC 688 ≤ 690 (seul le plafond de TVA global) ; G3 : 3,47 €, TVA 69, total TVA 94 ; G4 : 0,04 € à 10 %,
      // TVA de 2,49 € (25) moins 25 = 0.
      assert.deepEqual([exact.tva(347n, 20), exact.tva(249n, 10), exact.tva(245n, 10), exact.tva(348n, 20)], [69n, 25n, 25n, 70n]);
      assert.ok(245n + 348n <= 596n && 25n + 70n > 94n && 245n + 348n + 25n + 70n <= 690n);
      assert.equal(exact.tva(250n, 10) - exact.tva(245n, 10), 0n, 'refus de 0,05 € à 10 % : la base seule franchit le plafond du taux');
      assert.equal(exact.tva(249n, 10) - exact.tva(245n, 10), 0n);
      // Facture H : TVA de l'avoir écrit en SQL, déduite de ses lignes (5 centimes à 10 % : 0,5 → 1) ; H1 : TVA de 10 moins TVA de 5 = 0
      // (lecture écartée, avoir oublié : TVA de 5 = 1) ; H2 : TVA de 1000 (100) moins TVA de 10 (1) = 99.
      assert.deepEqual([exact.tva(5n, 10), exact.tva(10n, 10) - exact.tva(5n, 10), exact.tva(1000n, 10) - exact.tva(10n, 10)], [1n, 0n, 99n]);
      assert.equal(exact.tva(5n, 10), 1n, 'lecture écartée : avoir sans ventilation oublié, TVA de H1 0,01 €');
      // Factures théoriques : TVA de l'avoir de 100,00 € (2000) et de 100,01 € (2000,2 → 2000).
      assert.deepEqual([exact.tva(10000n, 20), exact.tva(10001n, 20)], [2000n, 2000n]);
      // Preuve de l'équivalence par l'API (N2) sur la série : à chaque avoir, la TVA cumulée d'un taux est l'arrondi de sa base cumulée.
      for (const s of SERIE) {
        let base = 0n; let tva = 0n;
        for (const a of temoin.filter((x) => x.k <= s.n)) {
          const v = a.ventilation.find((x) => x[0] === s.taux); base += v[1]; tva += v[2];
          assert.equal(tva, exact.tva(base, s.taux));
        }
      }
    });

    // Série (cadrage, critères métier 1 et 2 ; apports du lot : taux de 10 %, longue série sur trois taux, 409 d'un taux qui laisse de
    // la place aux autres). Chaque avoir est comparé au témoin à sa création ; chaque refus est prouvé par l'empreinte de la base et la
    // séquence ; puis tout est relu en base. Lectures écartées : voir le jeu de montants et le témoin.
    const serie = async ({ auteurFacture, auteurs, refusPar, motif }) => {
      const facture = await factureEmise(par(auteurFacture), motif, LIGNES_SERIE);
      assert.deepEqual([facture.creeParType, ...totaux(facture)], [ROLE[auteurFacture], ...F_SERIE.totaux], 'facture F');
      assert.deepEqual(ventilation(facture), F_SERIE.ventilation, 'facture F : ventilation');
      const temoin = temoinSerie();
      const sequenceAvant = await sequence();
      const auteurDe = (k) => auteurs[(k - 1) % auteurs.length];
      let r = 0;
      const refuser = (lignes, message, quoi) => {
        const auteur = refusPar[r % refusPar.length]; r += 1;
        return refuse(() => avoir(facture.id, lignes, par(auteur)), 409, message, `${motif} : ${quoi} (${auteur})`);
      };
      const crees = [];
      for (let k = 1; k <= N_AVOIRS; k += 1) {
        // Dépassement d'un centime du taux 5,5 %, les taux 20 % et 10 % ayant de la place (lecture écartée : plafond global seul).
        if (k === 30) await refuser([L(20, 7n), L(10, 7n), L(5.5, 11n)], REFUS.plafondTaux(5.5), '30e avoir, 0,11 € à 5,5 %');
        // Dépassement d'un centime du taux 10 %, le taux 20 % ayant de la place.
        if (k === 35) await refuser([L(20, 7n), L(10, 8n)], REFUS.plafondTaux(10), '35e avoir, 0,08 € à 10 %');
        if (k === 49) {
          // Seul le plafond HT global est franchi (TVA 1,09 €, TTC 9,98 €) : 409 du total, et non celui du taux 5,5 %.
          await refuser([L(5.5, 8n)], REFUS.plafondTotal, 'dernier avoir, 0,08 € à 5,5 % (HT global seul)');
          // Dépassement d'un centime du dernier avoir.
          await refuser([L(20, 8n)], REFUS.plafondTotal, 'dernier avoir, 0,08 € à 20 %');
          assert.deepEqual(await soldes(facture.id), ['EMISE', 9.9, 0, 0.09], 'avant le dernier avoir : 9,90 € crédités, reste 0,09 €');
        }
        const auteur = auteurDe(k);
        const cree = await avoirCree(facture.id, lignesAvoir(k), par(auteur));
        const attendu = temoin[k - 1];
        assert.deepEqual(
          [cree.numero, cree.type, cree.statut, cree.estAvoirAnnulation, cree.creeParType, ...totaux(cree)],
          [numeroAvoir(sequenceAvant + k), 'AVOIR', 'EMISE', false, ROLE[auteur], ...versEuros(attendu.totaux)],
          `${motif} : avoir n° ${k} (${auteur})`,
        );
        assert.deepEqual(ventilation(cree), attendu.ventilation.map(versEuros), `${motif} : ventilation de l’avoir n° ${k}`);
        crees.push({ k, auteur, id: cree.id, numero: cree.numero });
        if (k === 30) {
          // Taux 5,5 % épuisé (3,00 € et 0,17 € de TVA) : un centime de plus, seul ou avec des lignes à 20 % et 10 % qui ont de la place,
          // est refusé en entier (lecture écartée : avoir admis pour ses autres lignes).
          await refuser([L(5.5, 1n)], REFUS.plafondTaux(5.5), '0,01 € à 5,5 % après le 30e');
          await refuser([L(20, 7n), L(10, 7n), L(5.5, 10n)], REFUS.plafondTaux(5.5), 'trois lignes après le 30e');
        }
        if (k === 35) {
          await refuser([L(10, 1n)], REFUS.plafondTaux(10), '0,01 € à 10 % après le 35e');
          await refuser([L(20, 7n), L(10, 7n)], REFUS.plafondTaux(10), 'deux lignes après le 35e');
        }
      }
      // Facture créditée en entier : un centime de plus, à chacun de ses taux, est refusé (plafond global lu d'abord).
      for (const taux of [20, 10, 5.5]) await refuser([L(taux, 1n)], REFUS.plafondTotal, `0,01 € à ${taux} % après le dernier`);
      assert.equal(await sequence(), sequenceAvant + N_AVOIRS, 'numéros consécutifs, aucun pris par un refus');

      // Relu en base : chaque avoir (totaux, ventilation, type du créateur, écritures équilibrées sur son TTC, TVA aux écritures égale
      // à sa ventilation, les taux à 0,00 € de TVA sans écriture de TVA).
      const relus = await prisma.facture.findMany({ where: { factureOrigineId: facture.id }, include: { ventilationTva: true, ecrituresComptables: true }, orderBy: { numero: 'asc' } });
      assert.deepEqual(relus.map((a) => a.numero), crees.map((c) => c.numero));
      for (const [i, relu] of relus.entries()) {
        const attendu = temoin[i];
        assert.deepEqual([relu.type, relu.statut, relu.estAvoirAnnulation, relu.creeParType, relu.ecrituresScellees, ...totaux(relu)], ['AVOIR', 'EMISE', false, ROLE[crees[i].auteur], true, ...versEuros(attendu.totaux)], `${motif} : avoir n° ${i + 1} relu`);
        assert.deepEqual(ventilation(relu), attendu.ventilation.map(versEuros), `${motif} : ventilation relue de l’avoir n° ${i + 1}`);
        const debit = relu.ecrituresComptables.reduce((s, e) => s + centimesDe(e.debit), 0);
        const credit = relu.ecrituresComptables.reduce((s, e) => s + centimesDe(e.credit), 0);
        assert.deepEqual([debit, credit], [Number(attendu.totaux[2]), Number(attendu.totaux[2])], `${motif} : écritures de l’avoir n° ${i + 1}`);
        const tvaEcrite = relu.ecrituresComptables.filter((e) => e.cle.startsWith('TVA:')).map((e) => [Number(e.cle.slice(4)), centimesDe(e.debit)]).sort((a, b) => a[0] - b[0]);
        assert.deepEqual(tvaEcrite, attendu.ventilation.filter((v) => v[2] > 0n).map((v) => [v[0], Number(v[2])]), `${motif} : TVA aux écritures de l’avoir n° ${i + 1}`);
      }
      // Sommes relues en base, en numeric : 8,88 €, 1,11 €, 9,99 €, et par taux la ventilation de F (lectures écartées : TVA par avoir,
      // 1,14 € ; troncature, 1,08 €).
      const [sommes] = await prisma.$queryRaw`SELECT count(*)::int AS n, SUM("totalHt")::text AS ht, SUM("totalTva")::text AS tva, SUM("totalTtc")::text AS ttc FROM "Facture" WHERE "factureOrigineId" = ${facture.id}`;
      assert.deepEqual(sommes, { n: N_AVOIRS, ht: '8.88', tva: '1.11', ttc: '9.99' });
      const parTaux = await prisma.$queryRaw`SELECT v."tauxTva"::text AS taux, SUM(v."totalHt")::text AS ht, SUM(v."totalTva")::text AS tva, SUM(v."totalTtc")::text AS ttc FROM "FactureVentilationTva" v JOIN "Facture" a ON a."id" = v."factureId" WHERE a."factureOrigineId" = ${facture.id} GROUP BY v."tauxTva" ORDER BY v."tauxTva"`;
      assert.deepEqual(parTaux, [{ taux: '5.50', ht: '3.00', tva: '0.17', ttc: '3.17' }, { taux: '10.00', ht: '2.45', tva: '0.25', ttc: '2.70' }, { taux: '20.00', ht: '3.43', tva: '0.69', ttc: '4.12' }]);
      // Créditée en entier par ses avoirs : « réglée », reste dû 0,00 €, entrée REGLEMENT au nom de l'auteur du dernier avoir.
      assert.deepEqual(await soldes(facture.id), ['REGLEE', 9.99, 0, 0]);
      const dernier = crees.at(-1);
      const journal = (await enBase(facture.id)).journal;
      assert.deepEqual(journal.map((j) => [j.action, j.acteurId]), [['CREATION_BROUILLON', idDe(auteurFacture)], ['EMISSION', idDe(auteurFacture)], ['REGLEMENT', idDe(dernier.auteur)]]);
      assert.equal(journal[2].detail, `Transition EMISE → REGLEE (avoir partiel ${dernier.numero}) : réglé 0,00 €, avoirs 9,99 €, reste dû 0,00 €`);
      return facture;
    };

    test('série de 49 avoirs de l’administration (super administrateur, administrateur, directeur) sur sa facture à 20 %, 10 % et 5,5 % (8,88 € HT, 1,11 € de TVA) : TVA différentielle de chaque avoir égale au témoin, plafonds exacts atteints à chaque taux puis au total ; dépassement d’un centime du taux 5,5 % puis 10 % refusé (409 du taux) alors que les autres taux ont de la place, puis du total (409), sans écriture ni numéro ; sommes relues en base ; facture « réglée »', async () => {
      const facture = await serie({ auteurFacture: 'AD', auteurs: ['AD', 'SA', 'DIR'], refusPar: ['AD', 'DIR', 'SA'], motif: 'série administration' });
      // L'assistante technique, hors de son périmètre : 404, et non le 409 du plafond (AT-4).
      await refuse(() => avoir(facture.id, [L(20, 1n)], par('AT')), 404, REFUS.introuvable, 'assistante technique sur la facture de l’administration');
    });

    // AT-4 : les plafonds valent pour l'assistante technique, sur les factures de son poste, avoirs de l'administration compris.
    test('série de 49 avoirs sur la facture de l’assistante technique, alternés entre elle et l’administration : mêmes montants, mêmes plafonds exacts à 20 %, 10 % et 5,5 % puis au total, mêmes refus d’un centime (409 du taux, puis du total) pour elle et pour l’administration, sans écriture ni numéro ; facture « réglée » à son nom', async () => {
      await serie({ auteurFacture: 'AT', auteurs: ['AT', 'AD'], refusPar: ['AT', 'AD'], motif: 'série assistante technique' });
    });

    // Plafond de TVA global (N2 du contrôle, précisé) : sur une facture cohérente, ce plafond peut être seul franchi ; il fixe alors le
    // message du refus (409 du total et non du taux). Sur la même facture, la TVA du taux 10 % est atteinte avant sa base.
    test('plafond de TVA global seul franchi, facture cohérente à 20 % et 10 % (5,96 € HT, 0,94 € de TVA) : 3,48 € à 20 % refusé au total (409), et non au taux ; la TVA du taux 10 % atteinte (0,25 €) laisse 0,04 € de base, admis à 0,00 € de TVA ; plafonds exacts admis ; par l’administration et l’assistante technique', async () => {
      for (const [auteurFacture, a, b] of [['AD', 'AD', 'DIR'], ['AT', 'AT', 'AD']]) {
        const facture = await factureEmise(par(auteurFacture), `plafond de TVA global ${auteurFacture}`, LIGNES_G);
        assert.deepEqual([...totaux(facture), ...ventilation(facture)], [5.96, 0.94, 6.9, [10, 2.49, 0.25, 2.74], [20, 3.47, 0.69, 4.16]]);
        const g1 = await avoirCree(facture.id, [L(10, 245n)], par(a));
        assert.deepEqual([...totaux(g1), ...ventilation(g1)], [2.45, 0.25, 2.7, [10, 2.45, 0.25, 2.7]], 'G1');
        // Base du taux 10 % franchie d'un centime (2,50 € > 2,49 €), sans TVA de plus.
        await refuse(() => avoir(facture.id, [L(10, 5n)], par(b)), 409, REFUS.plafondTaux(10), `${auteurFacture} : 0,05 € à 10 %`);
        // Seul le plafond de TVA global : lecture écartée, 409 du taux 20 %.
        await refuse(() => avoir(facture.id, [L(20, 348n)], par(b)), 409, REFUS.plafondTotal, `${auteurFacture} : 3,48 € à 20 %`);
        await refuse(() => avoir(facture.id, [L(20, 348n)], par(a)), 409, REFUS.plafondTotal, `${auteurFacture} : 3,48 € à 20 %, autre auteur`);
        const g3 = await avoirCree(facture.id, [L(20, 347n)], par(b));
        assert.deepEqual([...totaux(g3), ...ventilation(g3)], [3.47, 0.69, 4.16, [20, 3.47, 0.69, 4.16]], 'G3 : TVA globale 0,94 €, plafond exact');
        const g4 = await avoirCree(facture.id, [L(10, 4n)], par(a));
        assert.deepEqual([...totaux(g4), ...ventilation(g4)], [0.04, 0, 0.04, [10, 0.04, 0, 0.04]], 'G4 : TVA 0,00 €');
        assert.deepEqual(await soldes(facture.id), ['REGLEE', 6.9, 0, 0]);
        await refuse(() => avoir(facture.id, [L(10, 1n)], par(b)), 409, REFUS.plafondTotal, `${auteurFacture} : 0,01 € après le dernier`);
        const [sommes] = await prisma.$queryRaw`SELECT SUM("totalHt")::text AS ht, SUM("totalTva")::text AS tva, SUM("totalTtc")::text AS ttc FROM "Facture" WHERE "factureOrigineId" = ${facture.id}`;
        assert.deepEqual(sommes, { ht: '5.96', tva: '0.94', ttc: '6.90' });
      }
    });

    // Cadrage, § 1 (N6) : les cumuls par taux passent par ventilationFacture(avoir), qui garde le repli sur les lignes d'un avoir sans
    // ventilation enregistrée, et non par avoir.ventilationTva lu seul. Un tel avoir n'existe que par une écriture SQL (documents
    // historiques ; aucune donnée réelle, règle 4) : la fixture est théorique.
    test('repli sur les lignes d’un avoir sans ventilation enregistrée (écrit en SQL, théorique) : sa base compte dans le plafond du taux (9,96 € à 10 % refusé, 409 du taux) et dans la TVA différentielle de l’avoir suivant (0,05 € à 10 % : 0,00 € de TVA, et non 0,01 €) ; taux épuisé exactement ensuite', async () => {
      const facture = await factureEmise(par('AD'), 'repli sur les lignes', LIGNES_H);
      assert.deepEqual(totaux(facture), [20, 3, 23]);
      const historique = await transaction((tx) => pieceSql(tx, { type: 'AVOIR', factureOrigineId: facture.id, taux: 10, ligneHt: 0.05, totaux: [0.05, 0.01, 0.06] }));
      const relu = await enBase(historique.id);
      assert.deepEqual([relu.ventilationTva.length, ...totaux(relu)], [0, 0.05, 0.01, 0.06], 'avoir sans ventilation enregistrée');
      await refuse(() => avoir(facture.id, [L(10, 996n)], par('AD')), 409, REFUS.plafondTaux(10), '9,96 € à 10 % après l’avoir sans ventilation');
      const h1 = await avoirCree(facture.id, [L(10, 5n)], par('AD'));
      assert.deepEqual([...totaux(h1), ...ventilation(h1)], [0.05, 0, 0.05, [10, 0.05, 0, 0.05]], 'H1 : TVA 0,00 €');
      const h2 = await avoirCree(facture.id, [L(10, 990n)], par('AD'));
      assert.deepEqual([...totaux(h2), ...ventilation(h2)], [9.9, 0.99, 10.89, [10, 9.9, 0.99, 10.89]], 'H2 : taux épuisé exactement');
      await refuse(() => avoir(facture.id, [L(10, 1n)], par('AD')), 409, REFUS.plafondTaux(10), '0,01 € à 10 % après H2');
      assert.deepEqual(await soldes(facture.id), ['EMISE', 11, 0, 12]);
    });

    // N2 du cadrage : mutants équivalents par l'API, tués par une fixture déclarée théorique (#243). Si #243 garde un jour en base la
    // cohérence des factures, ces factures ne s'écriront plus, et les quatre mutants seront équivalents sans exception : ce test changera.
    test('plafonds isolés sur des factures écrites en SQL, théoriques (#243) : TTC global, HT du taux, TVA du taux et TTC du taux, chacun seul franchi par un avoir de 100,00 € ou 100,01 € à 20 % : 409 au message exact du plafond, sans écriture ni numéro', async () => {
      for (const cas of THEORIQUES) {
        const facture = await transaction((tx) => pieceSql(tx, { type: 'FACTURE', taux: 20, ligneHt: cas.ventilation[0], totaux: cas.totaux, ventilation: cas.ventilation }));
        const relue = await enBase(facture.id);
        assert.deepEqual([relue.type, relue.statut, ...totaux(relue), ...ventilation(relue)], ['FACTURE', 'EMISE', ...cas.totaux, [20, ...cas.ventilation]], cas.plafond);
        for (const auteur of ['AD', 'DIR']) await refuse(() => avoir(facture.id, [L(20, cas.avoir)], par(auteur)), 409, cas.refus, `plafond ${cas.plafond} (${auteur})`);
      }
    });

    // Droits : la garde des factures passe avant le plafond ; la route n'est pas ouverte aux clés d'intégration.
    test('droits : sur une facture créditée en entier, avoir d’un centime refusé aux sept autres types (403), à l’assistante technique sur la facture de l’administration (404), sans session et par une clé d’intégration (401), et en 409 au super administrateur, à l’administrateur et au directeur ; sans écriture ni numéro', async () => {
      const facture = await factureEmise(par('AD'), 'droits', [ligne('visite', 1, 1, 10)]);
      const solde = await avoirCree(facture.id, [L(10, 100n)], par('AD'));
      assert.deepEqual(totaux(solde), [1, 0.1, 1.1]);
      const cle = await ok(appeler('post', '/admin/api-keys', { nom: `TEST décimal clé ${suffixe()}`, scopes: ['finances:read', 'clients:read'] }), 201);
      const centime = (auth) => avoir(facture.id, [L(10, 1n)], auth);
      for (const [code] of AUTRES_TYPES) await refuse(() => centime(par(code)), 403, REFUS.gestion, `par ${code}`);
      await refuse(() => centime(par('AT')), 404, REFUS.introuvable, 'par l’assistante technique');
      for (const auteur of ['SA', 'AD', 'DIR']) await refuse(() => centime(par(auteur)), 409, REFUS.plafondTotal, `par ${auteur}`);
      const [avant, sequenceAvant] = [await empreinte(), await sequence()];
      assert.equal((await centime(null)).status, 401, 'sans session');
      assert.equal((await centime(entete(cle.apiKey))).status, 401, 'par une clé d’intégration');
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], 'rien ne doit être écrit');
      assert.equal(await sequence(), sequenceAvant);
    });
  });
}
