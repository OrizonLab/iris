// Lot « Détail des avoirs comme règlements, à l'écran et sur le PDF » (cadrage v2, section « Tests » et critères métier
// observables 1 à 11 ; rapport du contrôle de cohérence de mode 1 : C1 à C5, T1, T2, N8 à N10, N13).
//
// Décisions appliquées. Réponses de Nelson du 10-11-2026 (consignées par #532, historique, « Décisions du 10-11-2026 sur les
// avoirs »), mot pour mot :
//  - point 2 : « Il faudrait que sur l'a facture cela soit bien marqué que c'est payé avec un ou des avoirs, et avoir le details
//    des avoirs. » ;
//  - point 4 : « oui c'est bien ca, avec le detail des avoir en tant que reglement. »
// Puis les trois questions du même jour (options choisies par Nelson ; textes des options de Claude Code) :
//  1. mention du PDF d'une facture payée uniquement par avoirs → « « Facture réglée par avoir(s) » (Recommandé) » ;
//  2. quand lister les avoirs sur le PDF → « Dès qu'un avoir existe (Recommandé) » ;
//  3. paiements reçus aussi sur le PDF → « Oui, paiements et avoirs ».
// Lectures retenues et choix par défaut du cadrage, à confirmer, éprouvés tels qu'écrits :
//  - accord au nombre : « Facture réglée par avoir. » (un avoir partiel émis), « Facture réglée par avoirs. » (plusieurs), pour une
//    facture « réglée » sans aucune part de règlement non contre-passée (montantRegle = 0) ; « Facture réglée. » dès qu'un
//    paiement la couvre ; la mention reste en tête, à la place de « Facture réglée. » ;
//  - bloc « Règlements et avoirs » après les totaux, pour une facture émise ou réglée qui porte au moins une part de règlement
//    non contre-passée ou un avoir partiel émis (un bloc aussi sans avoir : lecture retenue des réponses 2 et 3) ; une ligne par
//    paiement « Paiement du JJ-MM-AAAA (moyen) : X € » (part affectée, moyen en minuscules, ni total du règlement ni référence),
//    une par avoir « Avoir <numéro> du JJ-MM-AAAA : X € » (TTC), puis « Reste à payer : X € » (reste positif), « Trop-perçu : X € »
//    (négatif), rien s'il est nul ;
//  - ordre, sur le PDF comme dans la réponse de la route : date civile, puis instant de saisie (Reglement.createdAt, emisLe de
//    l'avoir), puis identifiant (C5) ; ce n'est pas l'ordre du journal ;
//  - nouvel invariant (C1) : le texte du PDF, privé de la mention et du bloc, est identique à celui de la facture émise avant tout
//    règlement ou avoir (il remplace « le PDF d'une pièce émise ne bouge pas quand un avoir partiel la crédite », test P2 de
//    production-pdf.test.mjs) ;
//  - invariant de montants (N13, critère 11) : la somme des lignes du bloc plus le reste dû égale le TTC (trop-perçu = reste
//    négatif), sur le PDF comme dans la réponse de la route ;
//  - envoi : la pièce jointe d'un envoi par Microsoft 365 est le PDF de la route, bloc compris ; un règlement saisi pendant
//    l'envoi attend la fin de la lecture du PDF (T2, C4 : verrou FOR SHARE de preparerEnvoiFacture, puis lecture).
//
// Contrat éprouvé (donné par Claude Code) :
//  - GET /api/factures/:id/reglements → { parts, avoirs, solde } ; parts : forme d'avant le lot (id, montant, reglement { id,
//    dateReglement, moyen, reference, statut, contrepasseLe, motifContrepassation }) plus reglement.createdAt (précision du
//    contrat du 10-11-2026), triées par date du règlement, instant de saisie, id ; avoirs : avoirs partiels émis de la facture
//    (type AVOIR, estAvoirAnnulation false, statut autre que BROUILLON), { id, numero, dateEmission, emisLe, totalTtc }, triés
//    par dateEmission, emisLe, id ; solde : { montantRegle, montantAvoirs, resteDu } de soldesFactures, null pour un brouillon,
//    une facture annulée ou un avoir. Droits inchangés : requireGestionFactures, pièce relue dans le périmètre du lecteur, 404
//    sinon ; route de session seulement (aucune route /api/v1 : le passage par une clé d'intégration est sans objet ici, et
//    éprouvé à 401 par la matrice matrice-droits/cles.txt).
//  - GET /api/factures/:id/document.pdf et pièce jointe de l'envoi : mention et bloc ci-dessus ; le PDF d'un avoir et le refus
//    du PDF d'un brouillon ne changent pas.
//
// Montants (classés C : CLAUDE.md, « un test manquant qui touche un montant ») : chaque valeur est choisie pour qu'une autre
// lecture plausible donne un autre texte ; chaque attendu est écrit en dur, la lecture écartée en commentaire, et le test
// « témoin des montants » recalcule chaque attendu en décimal exact, hors de l'application, et vérifie que chaque lecture
// écartée en diffère.
//
// Comme statut-facture-avoirs.test.mjs, ce fichier crée sur le serveur de TEST_DATABASE_URL une base jetable qui n'appartient
// qu'à lui (« test » comme mot, suffixe tiré au hasard), la migre, la sert à l'application montée en mémoire, puis la supprime ;
// Microsoft Graph y est simulé par un petit serveur HTTP local (modèle : envoi-microsoft-365.test.mjs), désigné par
// MICROSOFT_GRAPH_URL. Sans TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { PDFParse } from 'pdf-parse';

const TITRE = 'Détail des avoirs comme règlements : réponse de la route des règlements de la facture, mention et bloc « Règlements et avoirs » du PDF, pièce jointe de l’envoi';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROLE_AT = 'ASSISTANTE_TECHNIQUE';

// Textes exacts du PDF (contrat du code ; cadrage v2, § 2).
const TITRE_BLOC = 'Règlements et avoirs';
const MENTION = {
  reglee: 'Facture réglée.',
  parAvoir: 'Facture réglée par avoir.',
  parAvoirs: 'Facture réglée par avoirs.',
  annulee: 'FACTURE ANNULÉE — ce document ne vaut pas justificatif de créance.',
};
// Refus exacts (inchangés par le lot).
const REFUS = {
  introuvable: 'Facture introuvable.',
  gestion: 'Accès réservé à l’administration et à l’assistante technique.',
  sansSession: 'Authentification requise',
  nonEmise: 'Le document est disponible uniquement pour une facture émise.',
};
// Clés exactes de la réponse de la route (contrat du code).
const CLES = {
  reponse: ['avoirs', 'parts', 'solde'],
  part: ['id', 'montant', 'reglement'],
  reglement: ['contrepasseLe', 'createdAt', 'dateReglement', 'id', 'motifContrepassation', 'moyen', 'reference', 'statut'],
  avoir: ['dateEmission', 'emisLe', 'id', 'numero', 'totalTtc'],
  solde: ['montantAvoirs', 'montantRegle', 'resteDu'],
};

// --- Calcul exact, hors de l'application (témoins des montants) ---
// Centimes entiers (BigInt) ; arrondi au centime, moitié vers le haut (règle de l'application) ; lectures écartées : arrondi au
// pair, troncature.
const exact = {
  unites: (valeur, decimales) => {
    const [entier, fraction = ''] = String(valeur).split('.');
    return BigInt(entier) * 10n ** BigInt(decimales) + BigInt((fraction + '0'.repeat(decimales)).slice(0, decimales) || '0');
  },
  ligneHt: (quantite, prix) => (exact.unites(quantite, 3) * exact.unites(prix, 2) + 500n) / 1000n,
  ligneHtTronquee: (quantite, prix) => (exact.unites(quantite, 3) * exact.unites(prix, 2)) / 1000n,
  tva: (base, taux) => (base * exact.unites(taux, 3) + 50000n) / 100000n,
  // Texte d'un montant sur le PDF : formatMontantFacture (recopiée et non importée), dont l'espace fine des milliers (U+202F)
  // est imprimée en espace ordinaire (documents/gabarit.ts, texteWinAnsi) et lue comme telle.
  texte: (centimes) => `${(Number(centimes) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`.replace(/\s/g, ' '),
};
// Montant lu sur le PDF (« 1 236,64 € ») en centimes.
const centimesDuTexte = (texte) => {
  const m = /^(\d{1,3}(?: \d{3})*),(\d{2}) €$/.exec(texte);
  assert.ok(m, `montant illisible : « ${texte} »`);
  return BigInt(m[1].replace(/ /g, '')) * 100n + BigInt(m[2]);
};
const centimesDe = (nombre) => BigInt(Math.round(Number(nombre) * 100));

// --- Jeu de montants (TTC sauf mention contraire) ---
const ligne = (designation, quantite, prixUnitaireHt, tauxTva = 20) => ({ designation: `TEST détail ${designation}`, nature: 'PRESTATION', quantite, prixUnitaireHt, tauxTva });
// Facture de 120,00 € : 1 × 100,00 € HT à 20 %.
const F120 = [ligne('maintenance annuelle', 1, 100)];
// Avoirs (TVA différentielle par taux, qui donne ici le même résultat que la TVA de l'avoir seul) :
//  - A120 : 1 × 100,00 € HT, TTC 120,00 € (lecture écartée : avoir imprimé hors taxes, 100,00 €) ;
//  - A70 : 1 × 58,33 € HT, TVA 11,666 → 11,67 €, TTC 70,00 € (lecture écartée : hors taxes, 58,33 €) ;
//  - A50, après A70 : 1 × 41,67 € HT, TVA 20,00 − 11,67 = 8,33 €, TTC 50,00 € (lecture écartée : hors taxes, 41,67 €) ;
//  - A20 : 1 × 16,67 € HT, TVA 3,334 → 3,33 €, TTC 20,00 € ; reste dû 100,00 € (lecture écartée : avoir déduit hors taxes,
//    103,33 €).
const A120 = [ligne('reprise totale', 1, 100)];
const A70 = [ligne('reprise partielle', 1, 58.33)];
const A50 = [ligne('solde de la reprise', 1, 41.67)];
const A20 = [ligne('geste commercial', 1, 16.67)];
// Trop-perçu : facture 1 × 123,45 € HT (TVA 24,69 €, TTC 148,14 €), réglée de 150,00 € (surplus 1,86 €), puis avoir
// 1 × 10,01 € HT (TVA 2,002 → 2,00 €, TTC 12,01 €) : trop-perçu 13,87 €. Lectures écartées : trop-perçu de l'avoir seul
// (12,01 €), du seul surplus du paiement (1,86 €), écrit en reste négatif (« Reste à payer : -13,87 € »).
const F_TROP = [ligne('dépannage', 1, 123.45)];
const A_TROP = [ligne('remise après règlement', 1, 10.01)];
// Facture d'ordre, émise trois jours avant le jour de la société (premier numéro de la base, chronologie respectée) :
// 1 × 250,00 € HT, TTC 300,00 €. Avoirs B1 1 × 50,00 € HT (TTC 60,00 €) et B2 1 × 30,00 € HT (TVA 16,00 − 10,00 = 6,00 €,
// TTC 36,00 €). Paiements 40,00 + 25,00 + 15,00 + 10,00 + 7,77 = 97,77 € ; avoirs 96,00 € ; reste dû 106,23 € (lecture
// écartée : avoirs hors taxes, 122,23 €).
const F_ORDRE = [ligne('contrat de maintenance', 1, 250)];
const B1 = [ligne('reprise du premier trimestre', 1, 50)];
const B2 = [ligne('reprise du second trimestre', 1, 30)];
// Assistante technique (critère 9) :
//  - sa facture : 2,5 × 412,21 = 1 030,525 → 1 030,53 € HT (au pair ou tronqué : 1 030,52 €), TVA 206,106 → 206,11 €, TTC
//    1 236,64 € (lecture écartée : 1 236,62 €) ;
//  - facture de l'administration au même client : 1 × 64,81 € HT, TVA 12,962 → 12,96 €, TTC 77,77 € ;
//  - avoir de l'administration sur sa facture : 1 × 100,00 € HT, TTC 120,00 € ; puis règlement de 577,77 € (virement) : 500,00 €
//    sur sa facture, 77,77 € sur celle de l'administration ; puis son avoir : 1 × 12,50 € HT (TVA 22,50 − 20,00 = 2,50 €), TTC
//    15,00 € ;
//  - reste dû 1 236,64 − 120,00 − 500,00 − 15,00 = 601,64 €. Lectures écartées : avoirs hors taxes (624,14 €) ; total du
//    règlement à la place de sa part (523,87 €, et une ligne de 577,77 €) ; avoir de l'administration omis pour elle (721,64 €).
const F_AT = [ligne('pose de la centrale', 2.5, 412.21)];
const F_ADMIN = [ligne('contrôle par l’administration', 1, 64.81)];
const A_AT_ADMIN = [ligne('reprise par l’administration', 1, 100)];
const A_AT = [ligne('reprise par l’assistante', 1, 12.5)];

// --- Lecture du texte d'un PDF ---
// Lignes du texte extrait par pdf-parse, espaces regroupées, sans les séparateurs de page.
const lignesDuPdf = async (octets) => {
  const lecteur = new PDFParse({ data: new Uint8Array(octets) });
  try {
    const { text } = await lecteur.getText();
    return text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l && !/^-- \d+ of \d+ --$/.test(l));
  } finally { await lecteur.destroy(); }
};
// Le bloc « Règlements et avoirs » : les lignes qui suivent son titre (paiements, avoirs, reste), ou null sans titre.
const blocDuPdf = (lignes) => {
  const debut = lignes.indexOf(TITRE_BLOC);
  if (debut < 0) return null;
  assert.equal(lignes.indexOf(TITRE_BLOC, debut + 1), -1, 'un seul bloc « Règlements et avoirs »');
  const suite = [];
  for (const l of lignes.slice(debut + 1)) {
    if (!/^(Paiement du |Avoir |Reste à payer : |Trop-perçu : )/.test(l)) break;
    suite.push(l);
  }
  return suite;
};
const mentionsDuPdf = (lignes) => lignes.filter((l) => /^Facture réglée|^FACTURE ANNULÉE/u.test(l));
// Le texte privé de la mention et du bloc (nouvel invariant, C1) : la mention attendue, une fois, et le bloc attendu, en un seul
// morceau à la suite de son titre, sont retirés ; le reste doit être, ligne pour ligne, celui de la facture émise.
const sansSituation = (lignes, { mention = null, bloc = null }) => {
  const reste = [...lignes];
  if (mention) {
    const i = reste.indexOf(mention);
    assert.ok(i >= 0, `mention « ${mention} » absente`);
    reste.splice(i, 1);
  }
  if (bloc) {
    const i = reste.indexOf(TITRE_BLOC);
    assert.ok(i >= 0, 'bloc absent');
    assert.deepEqual(reste.slice(i + 1, i + 1 + bloc.length), bloc, 'bloc attendu, d’un seul tenant');
    reste.splice(i, bloc.length + 1);
  }
  return reste;
};
// Somme des lignes du bloc, reste compris (trop-perçu compté en négatif) : elle doit égaler le TTC (critère 11).
const sommeDuBloc = (bloc) => bloc.reduce((somme, l) => {
  const montant = centimesDuTexte(l.slice(l.lastIndexOf(' : ') + 3));
  return l.startsWith('Trop-perçu : ') ? somme - montant : somme + montant;
}, 0n);
// Copie de normaliser de production-pdf.test.mjs : CreationDate et /ID remplacés par une valeur fixe de même longueur.
function normaliser(octets) {
  let texte = Buffer.from(octets).toString('latin1');
  let dates = 0; let ids = 0;
  texte = texte.replace(/\(D:\d{14}Z\)/g, () => { dates += 1; return '(D:00000000000000Z)'; });
  texte = texte.replace(/\/ID \[<[0-9a-f]{32}> <[0-9a-f]{32}>\]/g, () => { ids += 1; return `/ID [<${'0'.repeat(32)}> <${'0'.repeat(32)}>]`; });
  assert.equal(dates, 1, 'une date de création, et une seule, dans le PDF');
  assert.equal(ids, 1, 'un identifiant de fichier, et un seul, dans le PDF');
  return texte;
}
const sha256 = (octets) => createHash('sha256').update(octets).digest('hex');

// --- Microsoft Graph simulé (modèle réduit de creerGraph, envoi-microsoft-365.test.mjs) ---
// GET /v1.0/me rend la boîte associée au jeton (401 pour un jeton inconnu) ; POST /v1.0/me/sendMail répond 202 et garde le corps.
function creerGraph() {
  const requetes = [];
  const boites = new Map();
  const serveur = http.createServer((req, res) => {
    const morceaux = [];
    req.on('data', (m) => morceaux.push(m));
    req.on('end', () => {
      const url = new URL(req.url, 'http://simulateur.invalid');
      const texte = Buffer.concat(morceaux).toString('utf8');
      let json;
      try { json = texte ? JSON.parse(texte) : undefined; } catch { json = undefined; }
      const nature = req.method === 'GET' && url.pathname === '/v1.0/me' ? 'me' : req.method === 'POST' && url.pathname === '/v1.0/me/sendMail' ? 'envoi' : 'autre';
      requetes.push({ nature, json, autorisation: req.headers.authorization });
      if (nature === 'envoi') { res.writeHead(202); res.end(); return; }
      if (nature === 'me') {
        const boite = boites.get(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
        if (!boite) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'InvalidAuthenticationToken' } })); return; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ mail: boite, userPrincipalName: boite }));
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  return {
    boites,
    demarrer: () => new Promise((fin) => serveur.listen(0, '127.0.0.1', () => fin(serveur.address().port))),
    arreter: () => new Promise((fin) => { serveur.closeAllConnections(); serveur.close(() => fin()); }),
    reinitialiser: () => { requetes.length = 0; },
    requetes: (nature) => requetes.filter((r) => r.nature === nature),
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
    const nomBase = `iris_test_detail_avoirs_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;
    const environnementAvant = {};
    const NOMS_ENVIRONNEMENT = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'MICROSOFT_GRAPH_URL'];
    const graph = creerGraph();

    let request; let app; let prisma; let appPrisma; let jwt; let envoiFacture;
    let session = '';
    let secours = null;
    const comptes = {};
    let rang = 0;
    const suffixe = () => `${Date.now()}${(rang += 1)}`;
    let client = null;
    // Facture d'ordre, émise à J−3 dans before() : [facture, lignes de son PDF à l'émission].
    let ordre = null;

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
    const binaire = (reponse, fin) => { const morceaux = []; reponse.on('data', (m) => morceaux.push(m)); reponse.on('end', () => fin(null, Buffer.concat(morceaux))); };
    const pdfBrut = (id, auth = sa()) => request(app).get(`/api/factures/${id}/document.pdf`).set(auth).buffer(true).parse(binaire);
    const pdfDe = async (id, auth = sa()) => {
      const res = await pdfBrut(id, auth);
      assert.equal(res.status, 200, `PDF ${id} : ${res.status} ${res.body?.toString?.('utf8').slice(0, 300)}`);
      assert.equal(res.headers['content-type'], 'application/pdf');
      return res.body;
    };
    const lignesPdf = async (id, auth = sa()) => lignesDuPdf(await pdfDe(id, auth));
    const reglementsDe = (id, auth = sa()) => ok(appeler('get', `/factures/${id}/reglements`, null, auth));

    // --- Jours civils de la société (Europe/Paris) ---
    const jourParis = () => {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date());
      const v = (type) => Number(parts.find((p) => p.type === type).value);
      return { a: v('year'), m: v('month'), j: v('day') };
    };
    // Jour civil décalé de `ecart` jours : texte JJ-MM-AAAA et date ISO stockée (minuit UTC).
    const jour = (ecart = 0) => {
      const { a, m, j } = jourParis();
      const d = new Date(Date.UTC(a, m - 1, j + ecart));
      const deux = (n) => String(n).padStart(2, '0');
      return { fr: `${deux(d.getUTCDate())}-${deux(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`, iso: d.toISOString() };
    };

    // --- État de la base (modèle : statut-facture-avoirs.test.mjs) ---
    const sqlEmpreinte = (table) => `SELECT '${table}' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${table}" x`;
    let requeteEmpreinte = null;
    const empreinte = async () => {
      if (!requeteEmpreinte) {
        const tables = (await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`).map((t) => t.tablename);
        assert.ok(['Facture', 'JournalFacture', 'Reglement', 'AffectationReglement', 'EnvoiDocument'].every((t) => tables.includes(t)), `tables relevées : ${tables.join(', ')}`);
        assert.ok(tables.every((table) => /^[A-Za-z_]+$/.test(table)), 'noms de tables sans guillemet');
        requeteEmpreinte = tables.map(sqlEmpreinte).join(' UNION ALL ');
      }
      return Object.fromEntries((await prisma.$queryRawUnsafe(requeteEmpreinte)).map(({ t, n, h }) => [t, `${n}:${h}`]));
    };
    const tablesChangees = (avant, apres) => Object.keys({ ...avant, ...apres }).filter((t) => avant[t] !== apres[t]);
    // Un refus : statut et message exacts, empreinte de toute la base inchangée.
    const refuse = async (appel, statut, message, quoi) => {
      const avant = await empreinte();
      const res = await appel();
      assert.deepEqual([res.status, res.body?.error], [statut, message], `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], `${quoi} : rien ne doit être écrit`);
      return res;
    };

    // --- Données ---
    const creerCompte = async (cle, role) => {
      const s = suffixe();
      comptes[cle] = await prisma.user.create({ data: { email: `detail.${cle.toLowerCase()}.${s}@iris.test`, name: `TEST détail ${cle} ${s}`, role } });
    };
    const brouillon = (auth, motif, lignes, date = jour().fr) => ok(appeler('post', '/factures', {
      clientId: client.id, dateEmission: date, dateEcheance: date, lignes, origine: 'HORS_AFFAIRE', motifHorsAffaire: `TEST détail ${motif} ${suffixe()}`,
    }, auth), 201);
    // Facture émise et les lignes de son PDF à l'émission, avant tout règlement ou avoir (référence de l'invariant C1).
    const emise = async (motif, lignes, { auth = par('AD'), date } = {}) => {
      const facture = await ok(appeler('post', `/factures/${(await brouillon(auth, motif, lignes, date)).id}/emettre`, {}, auth));
      assert.equal(facture.statut, 'EMISE');
      const lignesEmise = await lignesPdf(facture.id);
      assert.equal(blocDuPdf(lignesEmise), null, `${motif} : aucun bloc à l’émission`);
      assert.deepEqual(mentionsDuPdf(lignesEmise), [], `${motif} : aucune mention à l’émission`);
      return { facture, lignesEmise };
    };
    const avoir = (id, lignes, auth = par('AD')) => ok(appeler('post', `/factures/${id}/avoirs`, { lignes }, auth), 201);
    const MOYENS = { virement: 'VIREMENT', chèque: 'CHEQUE', carte: 'CARTE', prélèvement: 'PRELEVEMENT', espèces: 'ESPECES' };
    // Règlement saisi par l'administration : [[factureId, part]], moyen par son libellé imprimé, date JJ-MM-AAAA.
    const regler = (affectations, { moyen = 'virement', date = jour().fr, reference = `TEST-DETAIL-${suffixe()}` } = {}) => {
      const montant = Number((affectations.reduce((s, [, part]) => s + centimesDe(part), 0n))) / 100;
      return ok(appeler('post', '/reglements', { clientId: client.id, dateReglement: date, montant, moyen: MOYENS[moyen], reference, affectations: affectations.map(([factureId, part]) => ({ factureId, montant: part })) }, par('AD')), 201);
    };
    const contrepasser = (id) => ok(appeler('post', `/reglements/${id}/contrepasser`, { motif: 'TEST détail saisie à retirer' }, par('AD')));
    const statutEnBase = async (id) => (await prisma.facture.findUniqueOrThrow({ where: { id }, select: { statut: true } })).statut;
    // Lignes attendues du bloc.
    const lPaiement = (date, moyen, centimes) => `Paiement du ${date} (${moyen}) : ${exact.texte(centimes)}`;
    const lAvoir = (piece, centimes) => `Avoir ${piece.numero} du ${jour().fr} : ${exact.texte(centimes)}`;
    const lReste = (centimes) => `Reste à payer : ${exact.texte(centimes)}`;
    const lTrop = (centimes) => `Trop-perçu : ${exact.texte(centimes)}`;

    // Le PDF d'une facture après ses règlements et avoirs : mention et bloc exacts, à leur place, et le reste identique à la
    // facture émise (C1) ; somme des lignes plus reste égale au TTC (critère 11).
    const verifierPdf = (lignes, { lignesEmise, mention = null, bloc = null, ttc }, quoi) => {
      assert.deepEqual(mentionsDuPdf(lignes), mention ? [mention] : [], `${quoi} : mention\n${lignes.join('\n')}`);
      if (mention) {
        const emiseLe = lignes.findIndex((l) => l.startsWith('Émise le '));
        assert.equal(lignes[emiseLe + 1], mention, `${quoi} : la mention suit la ligne « Émise le … », en tête`);
      }
      if (bloc) {
        assert.deepEqual(blocDuPdf(lignes), bloc, `${quoi} : bloc\n${lignes.join('\n')}`);
        const titre = lignes.indexOf(TITRE_BLOC);
        assert.ok(titre > lignes.findIndex((l) => l.startsWith('Total TTC : ')), `${quoi} : le bloc suit les totaux`);
        assert.ok(titre < lignes.findIndex((l) => l.startsWith('Mentions légales et CGV — version')), `${quoi} : le bloc précède les mentions légales`);
        assert.equal(sommeDuBloc(bloc), ttc, `${quoi} : somme des lignes et du reste égale au TTC (critère 11)`);
      } else {
        assert.equal(blocDuPdf(lignes), null, `${quoi} : aucun bloc\n${lignes.join('\n')}`);
        assert.ok(!lignes.some((l) => /^(Paiement du |Reste à payer|Trop-perçu)/.test(l)), `${quoi} : ni paiement ni reste hors du bloc`);
      }
      assert.deepEqual(sansSituation(lignes, { mention, bloc }), lignesEmise, `${quoi} : hors mention et bloc, le texte de la facture émise (C1)`);
    };
    // La réponse de la route : clés exactes ; parts, avoirs et solde attendus ; invariant parts non contre-passées + avoirs +
    // reste = TTC, et montants du solde égaux à ses lignes (critère 11).
    const verifierReponse = (corps, { parts, avoirs, solde, ttc }, quoi) => {
      assert.deepEqual(Object.keys(corps).sort(), CLES.reponse, `${quoi} : clés de la réponse`);
      for (const p of corps.parts) {
        assert.deepEqual(Object.keys(p).sort(), CLES.part, `${quoi} : clés d’une part`);
        assert.deepEqual(Object.keys(p.reglement).sort(), CLES.reglement, `${quoi} : clés du règlement d’une part`);
      }
      for (const a of corps.avoirs) assert.deepEqual(Object.keys(a).sort(), CLES.avoir, `${quoi} : clés d’un avoir`);
      if (corps.solde !== null) assert.deepEqual(Object.keys(corps.solde).sort(), CLES.solde, `${quoi} : clés du solde`);
      assert.deepEqual(corps.parts.map((p) => [p.reglement.id, p.montant, p.reglement.statut]), parts, `${quoi} : parts, dans l’ordre`);
      assert.deepEqual(corps.avoirs.map((a) => [a.id, a.numero, a.totalTtc]), avoirs, `${quoi} : avoirs, dans l’ordre`);
      assert.deepEqual(corps.solde && [corps.solde.montantRegle, corps.solde.montantAvoirs, corps.solde.resteDu], solde, `${quoi} : solde`);
      if (corps.solde) {
        const regle = corps.parts.filter((p) => p.reglement.statut === 'ENREGISTRE').reduce((s, p) => s + centimesDe(p.montant), 0n);
        const credits = corps.avoirs.reduce((s, a) => s + centimesDe(a.totalTtc), 0n);
        assert.deepEqual([centimesDe(corps.solde.montantRegle), centimesDe(corps.solde.montantAvoirs)], [regle, credits], `${quoi} : solde égal à ses lignes`);
        assert.equal(regle + credits + centimesDe(corps.solde.resteDu), ttc, `${quoi} : lignes et reste égaux au TTC (critère 11)`);
      }
    };
    // Avoir lu dans la réponse : dates égales à celles de la base.
    const verifierDatesAvoir = async (corps, quoi) => {
      for (const a of corps.avoirs) {
        const enBase = await prisma.facture.findUniqueOrThrow({ where: { id: a.id }, select: { dateEmission: true, emisLe: true } });
        assert.deepEqual([a.dateEmission, a.emisLe], [enBase.dateEmission.toISOString(), enBase.emisLe.toISOString()], `${quoi} : dates de l’avoir ${a.numero}`);
        assert.equal(a.dateEmission, jour().iso, `${quoi} : un avoir est daté du jour de sa création`);
      }
    };

    // Pièce écrite directement en base (modèle : pieceSql de statut-facture-avoirs.test.mjs), pour l'avoir brouillon, qu'aucune
    // route ne crée (N8).
    const pieceSql = async (tx, { type = 'AVOIR', statut = 'BROUILLON', factureOrigineId, taux }) => {
      const centimes = (montant) => Math.round(montant * 100) / 100;
      const totalHt = centimes(taux.reduce((s, [, ht]) => s + ht, 0));
      const totalTva = centimes(taux.reduce((s, [, , tva]) => s + tva, 0));
      const totalTtc = centimes(totalHt + totalTva);
      const identite = await prisma.identiteEmetteur.findFirstOrThrow({ select: { id: true } });
      const piece = await tx.facture.create({ data: {
        clientId: client.id, clientRaisonSociale: client.raisonSociale, type, statut, factureOrigineId, estAvoirAnnulation: false,
        dateEmission: new Date(jour().iso), dateEcheance: new Date(jour().iso), totalHt, totalTva, totalTtc, origine: 'HORS_AFFAIRE',
        motifHorsAffaire: 'TEST détail écrit en base', identiteEmetteurId: identite.id,
      } });
      await tx.factureLigne.createMany({ data: taux.map(([t, ht, tva], ordreLigne) => ({ factureId: piece.id, ordre: ordreLigne, designation: `TEST détail en base ${t} %`, nature: 'PRESTATION', quantite: 1, prixUnitaireHt: ht, tauxTva: t, totalHt: ht, totalTtc: centimes(ht + tva) })) });
      await tx.factureVentilationTva.createMany({ data: taux.map(([t, ht, tva]) => ({ factureId: piece.id, tauxTva: t, totalHt: ht, totalTva: tva, totalTtc: centimes(ht + tva) })) });
      return piece;
    };
    const transaction = (operations) => prisma.$transaction(async (tx) => {
      const resultat = await operations(tx);
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return resultat;
    });

    // Envoi par Microsoft 365, accepté : la pièce jointe reçue par Graph, son empreinte au journal.
    const jetonMicrosoft = (boite) => {
      const jeton = `eyJ0eXAiOiJKV1QiTESTdetail.${randomBytes(16).toString('hex')}`;
      graph.boites.set(jeton, boite);
      return jeton;
    };
    const envoyerParMicrosoft365 = async (id, auth, boite, quoi) => {
      graph.reinitialiser();
      const res = await request(app).post(`/api/factures/${id}/envois`).set(auth).set('X-Jeton-Microsoft', jetonMicrosoft(boite)).send({ destinataire: 'compta@client-detail.test', canal: 'MICROSOFT_365' });
      assert.equal(res.status, 201, `${quoi} : ${res.status} ${JSON.stringify(res.body)}`);
      const envois = graph.requetes('envoi');
      assert.equal(envois.length, 1, `${quoi} : un appel à sendMail`);
      const pieces = envois[0].json?.message?.attachments ?? [];
      assert.equal(pieces.length, 1, `${quoi} : une pièce jointe`);
      const pdfRecu = Buffer.from(pieces[0].contentBytes, 'base64');
      const ligneJournal = (await prisma.$queryRaw`SELECT "empreintePdf" FROM "EnvoiDocument" WHERE "id" = ${res.body.envoi.id}`)[0];
      assert.equal(ligneJournal?.empreintePdf, sha256(pdfRecu), `${quoi} : empreinte du PDF envoyé au journal`);
      return pdfRecu;
    };

    before(async () => {
      assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname), 'seul un PostgreSQL local est autorisé');
      assert.notEqual(source.pathname.slice(1), nomBase);
      const portGraph = await graph.demarrer();
      await administrationPg.connect();
      await administrationPg.query(`CREATE DATABASE "${nomBase}"`);
      baseCreee = true;
      execFileSync(resolve(dossierServeur, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', resolve(dossierServeur, 'prisma/schema.prisma')], {
        env: { ...process.env, DATABASE_URL: cible.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
      });
      for (const nom of NOMS_ENVIRONNEMENT) environnementAvant[nom] = process.env[nom];
      // Connexion Microsoft absente à l'import (la connexion par l'accès de secours reste la seule ouverte), posée ensuite : l'envoi
      // la lit à chaque appel (modèle : envoi-microsoft-365.test.mjs).
      delete process.env.AZURE_TENANT_ID;
      delete process.env.AZURE_CLIENT_ID;
      process.env.MICROSOFT_GRAPH_URL = `http://127.0.0.1:${portGraph}/v1.0`;
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
      ({ envoiFacture } = await import('../dist/src/domaines/factures/envois.js'));
      const { PrismaClient } = await import('@prisma/client');
      prisma = new PrismaClient({ datasources: { db: { url: cible.toString() } } });
      jwt = (await import('jsonwebtoken')).default;
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      process.env.AZURE_TENANT_ID = '00000000-0000-4000-8000-00000000de01';
      process.env.AZURE_CLIENT_ID = '00000000-0000-4000-8000-00000000de02';
      const connexion = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(connexion.status, 200, JSON.stringify(connexion.body));
      session = connexion.body.token;
      secours = await prisma.user.findFirstOrThrow({ where: { email: 'secours@iris.test' } });
      await ok(appeler('put', '/company', { raisonSociale: 'TEST Émetteur détail', siret: '56565656500056', adresse: '6 rue des Règlements', codePostal: '14000', ville: 'Caen', fuseauHoraire: 'Europe/Paris' }));
      const compte = (code, libelle, nature) => ok(appeler('post', '/comptabilite/comptes', { code, libelle, nature }), 201);
      const clients = await compte('411000', 'TEST Clients détail', 'ACTIF');
      const prestations = await compte('706000', 'TEST Prestations détail', 'PRODUIT');
      const articles = await compte('707000', 'TEST Articles détail', 'PRODUIT');
      const tva20 = await compte('445710', 'TEST TVA 20 détail', 'TVA');
      const motif = 'TEST paramétrage comptable du lot détail';
      for (const [cle, donnees] of [['CLIENT', { compteId: clients.id }], ['VENTE_PRESTATION', { compteId: prestations.id }], ['VENTE_ARTICLE', { compteId: articles.id }], ['JOURNAL_VENTES', { journal: 'VE' }]]) {
        await ok(appeler('put', `/comptabilite/regles/${cle}`, { ...donnees, motif }));
      }
      await ok(appeler('put', '/comptabilite/tva/20', { compteId: tva20.id, motif }));
      const version = await ok(appeler('post', '/mentions-legales', { mentions: 'TEST mentions détail', cgv: 'TEST CGV détail', penalites: 'TEST pénalités détail' }), 201);
      await ok(appeler('post', `/mentions-legales/${version.version}/publier`));
      for (const [cle, role] of [['AT', ROLE_AT], ['AD', 'ADMIN'], ['DIR', 'DIRECTEUR'], ['CPT', 'COMPTABLE']]) await creerCompte(cle, role);
      for (let essai = 1; ; essai += 1) {
        const res = await appeler('post', '/clients', { raisonSociale: `TEST Client détail ${suffixe()}`, siren: String(randomInt(100_000_000, 1_000_000_000)) });
        if (res.status === 409 && essai < 5) continue;
        assert.equal(res.status, 201, JSON.stringify(res.body));
        client = res.body;
        break;
      }
      await ok(appeler('post', `/clients/${client.id}/sites`, { nom: 'TEST Facturation détail', adresse: '6 rue des Règlements', codePostal: '14000', ville: 'Caen', estSiteFacturation: true }), 201);
      // Première pièce numérotée de la base, émise trois jours avant le jour de la société : les règlements peuvent alors être
      // datés d'avant les avoirs, qui sont toujours du jour (test de l'ordre).
      ordre = await emise('facture d’ordre', F_ORDRE, { date: jour(-3).fr });
    });

    after(async () => {
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      await graph.arreter().catch(() => {});
      for (const nom of NOMS_ENVIRONNEMENT) { if (environnementAvant[nom] === undefined) delete process.env[nom]; else process.env[nom] = environnementAvant[nom]; }
      if (baseCreee) await administrationPg.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`).catch(() => {});
      await administrationPg.end().catch(() => {});
    });

    // Règle du rédacteur des tests (montants) : chaque attendu recalculé en décimal exact, hors de l'application, et chaque lecture
    // écartée calculée et distincte de l'attendu.
    test('témoin des montants : attendus du bloc recalculés en décimal exact (lignes TTC, reste, trop-perçu), chaque lecture écartée distincte', () => {
      const ht = (lignes) => lignes.reduce((s, l) => s + exact.ligneHt(l.quantite, l.prixUnitaireHt), 0n);
      const totaux = (lignes) => { const h = ht(lignes); const t = exact.tva(h, 20); return [h, t, h + t]; };
      // TVA différentielle d'un avoir après d'autres (taux unique, 20 %).
      const avoirApres = (lignes, precedents = []) => {
        const avant = precedents.reduce((s, p) => s + ht(p), 0n);
        const h = ht(lignes);
        const t = exact.tva(avant + h, 20) - exact.tva(avant, 20);
        return [h, t, h + t];
      };
      // F120 et ses avoirs.
      assert.deepEqual(totaux(F120), [10000n, 2000n, 12000n]);
      assert.deepEqual(avoirApres(A120), [10000n, 2000n, 12000n]);
      assert.notEqual(exact.texte(10000n), exact.texte(12000n), 'lecture écartée : avoir imprimé hors taxes');
      assert.deepEqual(avoirApres(A70), [5833n, 1167n, 7000n]);
      assert.deepEqual(avoirApres(A50, [A70]), [4167n, 833n, 5000n]);
      assert.equal(7000n + 5000n, 12000n, 'critère 2 : deux avoirs qui soldent');
      assert.deepEqual(avoirApres(A20), [1667n, 333n, 2000n]);
      assert.equal(12000n - 2000n, 10000n, 'critère 4 : reste 100,00 €');
      assert.equal(12000n - 1667n, 10333n, 'lecture écartée : avoir déduit hors taxes, 103,33 €');
      assert.equal(exact.texte(10000n), '100,00 €');
      // Critères 3 et 5 : 50,00 + 70,00 = 120,00 ; reste 70,00 après le seul paiement.
      assert.equal(12000n - 5000n - 7000n, 0n);
      assert.equal(12000n - 5000n, 7000n);
      // Règlement de 80,00 € réparti 50,00 € et 30,00 € : la part, et non le total, sur chaque PDF.
      assert.notEqual(exact.texte(8000n), exact.texte(5000n));
      // Critère 6 : 30,00 € contre-passé, 45,00 € et avoir de 20,00 € : reste 55,00 € (lecture écartée : contre-passé compté, 25,00 €).
      assert.equal(12000n - 4500n - 2000n, 5500n);
      assert.equal(12000n - 3000n - 4500n - 2000n, 2500n);
      // Critère 7 : trop-perçu.
      assert.deepEqual(totaux(F_TROP), [12345n, 2469n, 14814n]);
      assert.deepEqual(avoirApres(A_TROP), [1001n, 200n, 1201n]);
      assert.equal(14814n - 15000n - 1201n, -1387n, 'trop-perçu 13,87 €');
      assert.ok(![1201n, 186n].includes(1387n), 'lectures écartées : avoir seul (12,01 €), surplus du paiement seul (1,86 €)');
      assert.equal(12000n - 12550n, -550n, 'paiement de 125,50 € : trop-perçu 5,50 €');
      // Critère 8 : avoir brouillon de 30,00 € non compté : reste 50,00 € après A70 (lecture écartée : 20,00 €).
      assert.equal(12000n - 7000n, 5000n);
      assert.equal(12000n - 7000n - 3000n, 2000n);
      // Ordre : facture de 300,00 €, avoirs 60,00 € et 36,00 € (TVA différentielle 16,00 − 10,00).
      assert.deepEqual(totaux(F_ORDRE), [25000n, 5000n, 30000n]);
      assert.deepEqual(avoirApres(B1), [5000n, 1000n, 6000n]);
      assert.deepEqual(avoirApres(B2, [B1]), [3000n, 600n, 3600n]);
      const paiementsOrdre = 4000n + 2500n + 1500n + 1000n + 777n;
      assert.equal(paiementsOrdre, 9777n);
      assert.equal(30000n - paiementsOrdre - 6000n - 3600n, 10623n, 'reste 106,23 €');
      assert.equal(30000n - paiementsOrdre - 5000n - 3000n, 12223n, 'lecture écartée : avoirs hors taxes, 122,23 €');
      // Assistante technique : demi-centime, milliers, part et non total.
      assert.equal(exact.ligneHt(2.5, 412.21), 103053n);
      assert.equal(exact.ligneHtTronquee(2.5, 412.21), 103052n, 'lecture écartée : ligne tronquée (ou au pair)');
      assert.deepEqual(totaux(F_AT), [103053n, 20611n, 123664n]);
      assert.equal(exact.texte(123664n), '1 236,64 €');
      const tronquee = 103052n + exact.tva(103052n, 20);
      assert.equal(tronquee, 123662n, 'lecture écartée : TTC 1 236,62 €');
      assert.deepEqual(totaux(F_ADMIN), [6481n, 1296n, 7777n]);
      assert.deepEqual(avoirApres(A_AT_ADMIN), [10000n, 2000n, 12000n]);
      assert.deepEqual(avoirApres(A_AT, [A_AT_ADMIN]), [1250n, 250n, 1500n]);
      assert.equal(123664n - 12000n - 50000n - 1500n, 60164n, 'reste 601,64 €');
      assert.equal(123664n - 10000n - 50000n - 1250n, 62414n, 'lecture écartée : avoirs hors taxes');
      assert.equal(123664n - 12000n - 57777n - 1500n, 52387n, 'lecture écartée : total du règlement');
      assert.equal(123664n - 50000n - 1500n, 72164n, 'lecture écartée : avoir de l’administration omis pour elle');
      assert.equal(exact.texte(60164n), '601,64 €');
      // Lecture du texte des montants : le même que l'application, espace ordinaire.
      assert.equal(centimesDuTexte('1 236,64 €'), 123664n);
      assert.equal(sommeDuBloc(['Paiement du 01-01-2026 (virement) : 150,00 €', 'Avoir A du 01-01-2026 : 12,01 €', 'Trop-perçu : 13,87 €']), 14814n);
    });

    // Critère 1, par l'administrateur et par le directeur (aligné sur elle) ; critère 10 avant l'avoir.
    test('critères 1 et 10 : facture de 120,00 € sans règlement ni avoir : PDF inchangé (aucun bloc), réponse sans part ni avoir, reste 120,00 € ; soldée par un avoir de 120,00 € : « Facture réglée par avoir. », bloc « Avoir … du JJ-MM-AAAA : 120,00 € » sans reste à payer, réponse avec l’avoir, lue de même par l’administrateur et le directeur', async () => {
      for (const auteur of ['AD', 'DIR']) {
        const { facture, lignesEmise } = await emise(`critère 1 ${auteur}`, F120);
        // Critère 10 : ni règlement ni avoir.
        verifierReponse(await reglementsDe(facture.id, par(auteur)), { parts: [], avoirs: [], solde: [0, 0, 120], ttc: 12000n }, `${auteur} critère 10`);
        verifierPdf(await lignesPdf(facture.id, par(auteur)), { lignesEmise, ttc: 12000n }, `${auteur} critère 10`);
        const a1 = await avoir(facture.id, A120, par(auteur));
        assert.equal(await statutEnBase(facture.id), 'REGLEE');
        for (const lecteur of ['AD', 'DIR']) {
          const corps = await reglementsDe(facture.id, par(lecteur));
          // Lecture écartée : avoir hors taxes (100) ; solde absent pour une facture réglée.
          verifierReponse(corps, { parts: [], avoirs: [[a1.id, a1.numero, 120]], solde: [0, 120, 0], ttc: 12000n }, `${auteur}, lu par ${lecteur}`);
          await verifierDatesAvoir(corps, `${auteur}, lu par ${lecteur}`);
          // Lectures écartées : « Facture réglée. » (avant le lot) ; « Reste à payer : 0,00 € » ; avoir hors taxes (« 100,00 € »).
          verifierPdf(await lignesPdf(facture.id, par(lecteur)), { lignesEmise, mention: MENTION.parAvoir, bloc: [lAvoir(a1, 12000n)], ttc: 12000n }, `${auteur}, lu par ${lecteur}`);
        }
      }
    });

    test('critère 2 : facture de 120,00 € soldée par deux avoirs de 70,00 € et 50,00 € : « Facture réglée par avoirs. » (pluriel), deux lignes dans l’ordre de leur émission, sans reste ; réponse avec les deux avoirs', async () => {
      const { facture, lignesEmise } = await emise('critère 2', F120);
      const a70 = await avoir(facture.id, A70);
      const a50 = await avoir(facture.id, A50, par('DIR'));
      assert.deepEqual([a70.totalTtc, a50.totalTtc], [70, 50]);
      assert.equal(await statutEnBase(facture.id), 'REGLEE');
      const corps = await reglementsDe(facture.id);
      verifierReponse(corps, { parts: [], avoirs: [[a70.id, a70.numero, 70], [a50.id, a50.numero, 50]], solde: [0, 120, 0], ttc: 12000n }, 'critère 2');
      await verifierDatesAvoir(corps, 'critère 2');
      // Lectures écartées : singulier ; une seule ligne (dernier avoir) ; une ligne de 120,00 € (somme des avoirs).
      verifierPdf(await lignesPdf(facture.id), { lignesEmise, mention: MENTION.parAvoirs, bloc: [lAvoir(a70, 7000n), lAvoir(a50, 5000n)], ttc: 12000n }, 'critère 2');
    });

    test('critère 3 : paiement de 50,00 € (virement) puis avoir de 70,00 € le même jour : « Facture réglée. », le paiement avant l’avoir (instant de saisie) ; dans l’ordre inverse, l’avoir avant le paiement, toujours « Facture réglée. » ; ni la référence ni « réglée par avoir »', async () => {
      // Paiement puis avoir.
      const premiere = await emise('critère 3, paiement d’abord', F120);
      const reference = `TEST-DETAIL-REF-${suffixe()}`;
      const r = await regler([[premiere.facture.id, 50]], { reference });
      const a = await avoir(premiere.facture.id, A70);
      assert.equal(await statutEnBase(premiere.facture.id), 'REGLEE');
      const corps = await reglementsDe(premiere.facture.id);
      verifierReponse(corps, { parts: [[r.id, 50, 'ENREGISTRE']], avoirs: [[a.id, a.numero, 70]], solde: [50, 70, 0], ttc: 12000n }, 'critère 3');
      const enBase = await prisma.reglement.findUniqueOrThrow({ where: { id: r.id } });
      assert.deepEqual([corps.parts[0].reglement.createdAt, corps.parts[0].reglement.dateReglement, corps.parts[0].reglement.reference], [enBase.createdAt.toISOString(), jour().iso, reference], 'part : instant de saisie, date et référence (le panneau l’affiche)');
      const lignes = await lignesPdf(premiere.facture.id);
      // Lectures écartées : « Facture réglée par avoir. » alors qu'un paiement la couvre ; avoirs avant paiements ; moyen
      // « Virement » ou « VIREMENT ».
      verifierPdf(lignes, { lignesEmise: premiere.lignesEmise, mention: MENTION.reglee, bloc: [lPaiement(jour().fr, 'virement', 5000n), lAvoir(a, 7000n)], ttc: 12000n }, 'critère 3');
      assert.ok(!lignes.some((l) => l.includes(reference)), 'la référence du règlement n’est pas imprimée');

      // Avoir puis paiement, le même jour : l'avoir d'abord (lecture écartée : paiements toujours avant les avoirs).
      const seconde = await emise('critère 3, avoir d’abord', F120);
      const a2 = await avoir(seconde.facture.id, A70);
      assert.equal(await statutEnBase(seconde.facture.id), 'EMISE');
      const r2 = await regler([[seconde.facture.id, 50]]);
      assert.equal(await statutEnBase(seconde.facture.id), 'REGLEE');
      verifierReponse(await reglementsDe(seconde.facture.id), { parts: [[r2.id, 50, 'ENREGISTRE']], avoirs: [[a2.id, a2.numero, 70]], solde: [50, 70, 0], ttc: 12000n }, 'critère 3 inverse');
      verifierPdf(await lignesPdf(seconde.facture.id), { lignesEmise: seconde.lignesEmise, mention: MENTION.reglee, bloc: [lAvoir(a2, 7000n), lPaiement(jour().fr, 'virement', 5000n)], ttc: 12000n }, 'critère 3 inverse');
    });

    test('critère 4 : facture de 120,00 € avec un avoir de 20,00 € seulement : « émise », aucune mention, bloc avec l’avoir et « Reste à payer : 100,00 € »', async () => {
      const { facture, lignesEmise } = await emise('critère 4', F120);
      const a = await avoir(facture.id, A20);
      assert.equal(await statutEnBase(facture.id), 'EMISE');
      verifierReponse(await reglementsDe(facture.id), { parts: [], avoirs: [[a.id, a.numero, 20]], solde: [0, 20, 100], ttc: 12000n }, 'critère 4');
      // Lectures écartées : avoir déduit hors taxes (103,33 €) ; mention « réglée » ou « réglée par avoir » sur une facture émise.
      verifierPdf(await lignesPdf(facture.id), { lignesEmise, bloc: [lAvoir(a, 2000n), lReste(10000n)], ttc: 12000n }, 'critère 4');
    });

    test('critère 5 : facture de 120,00 € avec un paiement de 50,00 € : bloc avec le paiement et « Reste à payer : 70,00 € » ; un règlement de 80,00 € (chèque) réparti sur deux factures n’imprime que sa part sur chacune, sans son total ni l’autre facture', async () => {
      const { facture, lignesEmise } = await emise('critère 5', F120);
      const r = await regler([[facture.id, 50]]);
      assert.equal(await statutEnBase(facture.id), 'EMISE');
      verifierReponse(await reglementsDe(facture.id), { parts: [[r.id, 50, 'ENREGISTRE']], avoirs: [], solde: [50, 0, 70], ttc: 12000n }, 'critère 5');
      verifierPdf(await lignesPdf(facture.id), { lignesEmise, bloc: [lPaiement(jour().fr, 'virement', 5000n), lReste(7000n)], ttc: 12000n }, 'critère 5');

      // Un règlement de 80,00 € : 50,00 € sur F, 30,00 € sur G. Lecture écartée : le total du règlement imprimé (80,00 €).
      const f = await emise('critère 5, première facture du règlement', F120);
      const g = await emise('critère 5, seconde facture du règlement', F120);
      const reference = `TEST-DETAIL-CHQ-${suffixe()}`;
      const partage = await regler([[f.facture.id, 50], [g.facture.id, 30]], { moyen: 'chèque', reference });
      assert.equal(partage.montant, 80);
      for (const [piece, autre, part, reste] of [[f, g, 5000n, 7000n], [g, f, 3000n, 9000n]]) {
        const quoi = `règlement partagé, facture ${piece.facture.numero}`;
        verifierReponse(await reglementsDe(piece.facture.id), { parts: [[partage.id, Number(part) / 100, 'ENREGISTRE']], avoirs: [], solde: [Number(part) / 100, 0, Number(reste) / 100], ttc: 12000n }, quoi);
        const lignes = await lignesPdf(piece.facture.id);
        verifierPdf(lignes, { lignesEmise: piece.lignesEmise, bloc: [lPaiement(jour().fr, 'chèque', part), lReste(reste)], ttc: 12000n }, quoi);
        const plat = lignes.join('\n');
        for (const absent of ['80,00 €', reference, autre.facture.numero]) assert.ok(!plat.includes(absent), `${quoi} : absent du PDF « ${absent} »`);
      }
    });

    test('critère 6 : paiement contre-passé absent du PDF (et de son reste), présent dans la réponse avec son statut ; une facture dont le seul paiement est contre-passé n’a plus de bloc ; réglée de 120,00 €, créditée de 120,00 €, puis paiement contre-passé : « Facture réglée par avoir. »', async () => {
      // 30,00 € (carte) contre-passé, 45,00 € (espèces), avoir de 20,00 € : reste 55,00 €. Lectures écartées : ligne de 30,00 € ;
      // reste 25,00 € (contre-passé compté).
      const { facture, lignesEmise } = await emise('critère 6', F120);
      const r30 = await regler([[facture.id, 30]], { moyen: 'carte' });
      const r45 = await regler([[facture.id, 45]], { moyen: 'espèces' });
      const a = await avoir(facture.id, A20);
      await contrepasser(r30.id);
      verifierReponse(await reglementsDe(facture.id), { parts: [[r30.id, 30, 'CONTREPASSE'], [r45.id, 45, 'ENREGISTRE']], avoirs: [[a.id, a.numero, 20]], solde: [45, 20, 55], ttc: 12000n }, 'critère 6');
      verifierPdf(await lignesPdf(facture.id), { lignesEmise, bloc: [lPaiement(jour().fr, 'espèces', 4500n), lAvoir(a, 2000n), lReste(5500n)], ttc: 12000n }, 'critère 6');

      // Seul paiement contre-passé, sans avoir : plus de bloc (lecture écartée : bloc avec « Reste à payer : 120,00 € »).
      const seul = await emise('critère 6, seul paiement contre-passé', F120);
      const r = await regler([[seul.facture.id, 50]]);
      await contrepasser(r.id);
      verifierReponse(await reglementsDe(seul.facture.id), { parts: [[r.id, 50, 'CONTREPASSE']], avoirs: [], solde: [0, 0, 120], ttc: 12000n }, 'critère 6, seul contre-passé');
      verifierPdf(await lignesPdf(seul.facture.id), { lignesEmise: seul.lignesEmise, ttc: 12000n }, 'critère 6, seul contre-passé');

      // Réglée de 120,00 €, créditée de 120,00 €, puis paiement contre-passé : reste « réglée », soldée par son seul avoir. Lecture
      // écartée : la mention suit le nombre de parts (une part, contre-passée) et non le montant réglé (0,00 €) : « Facture réglée. ».
      const soldee = await emise('critère 6, réglée puis créditée', F120);
      const r120 = await regler([[soldee.facture.id, 120]], { moyen: 'prélèvement' });
      const a120 = await avoir(soldee.facture.id, A120);
      // Avant la contre-passation : trop-perçu de 120,00 €.
      verifierPdf(await lignesPdf(soldee.facture.id), { lignesEmise: soldee.lignesEmise, mention: MENTION.reglee, bloc: [lPaiement(jour().fr, 'prélèvement', 12000n), lAvoir(a120, 12000n), lTrop(12000n)], ttc: 12000n }, 'critère 6, trop-perçu avant la contre-passation');
      await contrepasser(r120.id);
      assert.equal(await statutEnBase(soldee.facture.id), 'REGLEE');
      verifierReponse(await reglementsDe(soldee.facture.id), { parts: [[r120.id, 120, 'CONTREPASSE']], avoirs: [[a120.id, a120.numero, 120]], solde: [0, 120, 0], ttc: 12000n }, 'critère 6, réglée par avoir après contre-passation');
      verifierPdf(await lignesPdf(soldee.facture.id), { lignesEmise: soldee.lignesEmise, mention: MENTION.parAvoir, bloc: [lAvoir(a120, 12000n)], ttc: 12000n }, 'critère 6, réglée par avoir après contre-passation');
    });

    test('critère 7 : trop-perçu : facture de 148,14 € réglée de 150,00 € (prélèvement) puis avoir de 12,01 € : « Facture réglée. », « Trop-perçu : 13,87 € » ; facture de 120,00 € réglée de 125,50 € : « Trop-perçu : 5,50 € »', async () => {
      const { facture, lignesEmise } = await emise('critère 7', F_TROP);
      assert.equal(facture.totalTtc, 148.14);
      const r = await regler([[facture.id, 150]], { moyen: 'prélèvement' });
      const a = await avoir(facture.id, A_TROP);
      assert.equal(a.totalTtc, 12.01);
      verifierReponse(await reglementsDe(facture.id), { parts: [[r.id, 150, 'ENREGISTRE']], avoirs: [[a.id, a.numero, 12.01]], solde: [150, 12.01, -13.87], ttc: 14814n }, 'critère 7');
      // Lectures écartées : « Reste à payer : -13,87 € » ; « Reste à payer : 0,00 € » ; trop-perçu 12,01 € ou 1,86 €.
      verifierPdf(await lignesPdf(facture.id), { lignesEmise, mention: MENTION.reglee, bloc: [lPaiement(jour().fr, 'prélèvement', 15000n), lAvoir(a, 1201n), lTrop(1387n)], ttc: 14814n }, 'critère 7');

      const surplus = await emise('critère 7, surplus du paiement', F120);
      const r2 = await regler([[surplus.facture.id, 125.5]], { moyen: 'chèque' });
      verifierReponse(await reglementsDe(surplus.facture.id), { parts: [[r2.id, 125.5, 'ENREGISTRE']], avoirs: [], solde: [125.5, 0, -5.5], ttc: 12000n }, 'critère 7, surplus');
      verifierPdf(await lignesPdf(surplus.facture.id), { lignesEmise: surplus.lignesEmise, mention: MENTION.reglee, bloc: [lPaiement(jour().fr, 'chèque', 12550n), lTrop(550n)], ttc: 12000n }, 'critère 7, surplus');
    });

    // N8 : un avoir naît émis par l'API ; l'avoir brouillon est écrit en base.
    test('critère 8 : avoir brouillon (écrit en base) et avoir d’annulation absents de la réponse et du PDF ; la facture annulée garde sa seule mention, sans bloc ni solde ; un avoir et un brouillon de facture répondent sans part, sans avoir et sans solde ; le PDF d’un avoir n’a ni bloc ni mention, celui d’un brouillon reste refusé', async () => {
      // Facture émise, avoir de 70,00 € et avoir brouillon de 30,00 € : reste 50,00 € (lecture écartée : brouillon compté, 20,00 €
      // et une ligne sans numéro).
      const { facture, lignesEmise } = await emise('critère 8, brouillon', F120);
      const a70 = await avoir(facture.id, A70);
      const brouillonAvoir = await transaction((tx) => pieceSql(tx, { factureOrigineId: facture.id, taux: [[20, 25, 5]] }));
      assert.deepEqual([brouillonAvoir.statut, brouillonAvoir.numero, Number(brouillonAvoir.totalTtc)], ['BROUILLON', null, 30]);
      verifierReponse(await reglementsDe(facture.id), { parts: [], avoirs: [[a70.id, a70.numero, 70]], solde: [0, 70, 50], ttc: 12000n }, 'critère 8, brouillon');
      verifierPdf(await lignesPdf(facture.id), { lignesEmise, bloc: [lAvoir(a70, 7000n), lReste(5000n)], ttc: 12000n }, 'critère 8, brouillon');

      // Facture soldée par un avoir, et un avoir brouillon de plus : singulier (lecture écartée : brouillon compté, « avoirs »).
      const soldee = await emise('critère 8, soldée et brouillon', F120);
      const a120 = await avoir(soldee.facture.id, A120);
      await transaction((tx) => pieceSql(tx, { factureOrigineId: soldee.facture.id, taux: [[20, 1, 0.2]] }));
      verifierReponse(await reglementsDe(soldee.facture.id), { parts: [], avoirs: [[a120.id, a120.numero, 120]], solde: [0, 120, 0], ttc: 12000n }, 'critère 8, soldée et brouillon');
      verifierPdf(await lignesPdf(soldee.facture.id), { lignesEmise: soldee.lignesEmise, mention: MENTION.parAvoir, bloc: [lAvoir(a120, 12000n)], ttc: 12000n }, 'critère 8, soldée et brouillon');

      // Facture annulée par son avoir d'annulation : ni part, ni avoir, ni solde ; PDF : la mention d'annulation seule.
      const annulee = await emise('critère 8, annulée', F120);
      const annulation = await ok(appeler('post', `/factures/${annulee.facture.id}/annuler`, {}, par('AD')));
      assert.deepEqual([annulation.statut, annulation.avoir.estAvoirAnnulation], ['ANNULEE', true]);
      verifierReponse(await reglementsDe(annulee.facture.id), { parts: [], avoirs: [], solde: null, ttc: 12000n }, 'critère 8, annulée');
      verifierPdf(await lignesPdf(annulee.facture.id), { lignesEmise: annulee.lignesEmise, mention: MENTION.annulee, ttc: 12000n }, 'critère 8, annulée');
      // Les avoirs eux-mêmes (d'annulation, partiel) : réponse vide, sans solde ; PDF sans bloc ni mention de règlement.
      for (const [piece, quoi] of [[annulation.avoir, 'avoir d’annulation'], [a70, 'avoir partiel']]) {
        verifierReponse(await reglementsDe(piece.id), { parts: [], avoirs: [], solde: null, ttc: 0n }, quoi);
        const lignes = await lignesPdf(piece.id);
        assert.ok(lignes.includes(`AVOIR ${piece.numero}`), `${quoi} : titre de l’avoir`);
        assert.equal(blocDuPdf(lignes), null, `${quoi} : aucun bloc`);
        assert.deepEqual(mentionsDuPdf(lignes), [], `${quoi} : aucune mention`);
      }
      // Brouillon de facture : réponse vide, sans solde ; PDF refusé (409 inchangé), sans écriture.
      const sien = await brouillon(par('AD'), 'critère 8, brouillon de facture', F120);
      verifierReponse(await reglementsDe(sien.id), { parts: [], avoirs: [], solde: null, ttc: 0n }, 'brouillon de facture');
      await refuse(() => appeler('get', `/factures/${sien.id}/document.pdf`, null, par('AD')), 409, REFUS.nonEmise, 'PDF d’un brouillon');
    });

    // C5 : ordre par date civile, puis instant de saisie, puis identifiant ; ce n'est pas l'ordre du journal (instant de saisie
    // seul). Les cinq moyens, en minuscules (LIBELLES_MOYEN_REGLEMENT).
    test('ordre (C5) : paiements datés d’avant les avoirs mais saisis après eux viennent avant ; à date égale, l’instant de saisie départage paiements et avoirs ; cinq moyens en minuscules ; reste 106,23 €', async () => {
      const { facture, lignesEmise } = ordre;
      assert.deepEqual([facture.totalTtc, facture.dateEmission], [300, jour(-3).iso]);
      // Saisies, dans cet ordre : R1 (J−1, chèque), B1 (avoir, J), R2 (J−2, carte), R3 (J, espèces), B2 (avoir, J), R4 (J,
      // prélèvement), R5 (J−1, virement).
      const r1 = await regler([[facture.id, 40]], { moyen: 'chèque', date: jour(-1).fr });
      const b1 = await avoir(facture.id, B1);
      const r2 = await regler([[facture.id, 25]], { moyen: 'carte', date: jour(-2).fr });
      const r3 = await regler([[facture.id, 15]], { moyen: 'espèces' });
      const b2 = await avoir(facture.id, B2, par('DIR'));
      const r4 = await regler([[facture.id, 10]], { moyen: 'prélèvement' });
      const r5 = await regler([[facture.id, 7.77]], { moyen: 'virement', date: jour(-1).fr });
      assert.deepEqual([b1.totalTtc, b2.totalTtc], [60, 36]);
      const corps = await reglementsDe(facture.id);
      // Parts : date, puis instant de saisie (R2, R1, R5, R3, R4) ; avoirs : B1, B2.
      verifierReponse(corps, {
        parts: [[r2.id, 25, 'ENREGISTRE'], [r1.id, 40, 'ENREGISTRE'], [r5.id, 7.77, 'ENREGISTRE'], [r3.id, 15, 'ENREGISTRE'], [r4.id, 10, 'ENREGISTRE']],
        avoirs: [[b1.id, b1.numero, 60], [b2.id, b2.numero, 36]], solde: [97.77, 96, 106.23], ttc: 30000n,
      }, 'ordre');
      await verifierDatesAvoir(corps, 'ordre');
      assert.deepEqual(corps.parts.map((p) => p.reglement.dateReglement), [jour(-2).iso, jour(-1).iso, jour(-1).iso, jour().iso, jour().iso]);
      // Chaque instant de saisie de la réponse est celui de la base, et ils croissent dans l'ordre des saisies.
      const instants = new Map((await prisma.reglement.findMany({ where: { id: { in: [r1.id, r2.id, r3.id, r4.id, r5.id] } }, select: { id: true, createdAt: true } })).map((r) => [r.id, r.createdAt.toISOString()]));
      for (const p of corps.parts) assert.equal(p.reglement.createdAt, instants.get(p.reglement.id));
      // PDF : R2 (J−2), R1 (J−1), R5 (J−1, saisi après R1), puis à J : B1, R3, B2, R4 (instant de saisie). Lectures écartées : ordre
      // du journal (R1, B1, R2, R3, B2, R4, R5) ; paiements puis avoirs ; avoirs puis paiements ; date seule, sans départage.
      verifierPdf(await lignesPdf(facture.id), {
        lignesEmise, ttc: 30000n,
        bloc: [
          lPaiement(jour(-2).fr, 'carte', 2500n), lPaiement(jour(-1).fr, 'chèque', 4000n), lPaiement(jour(-1).fr, 'virement', 777n),
          lAvoir(b1, 6000n), lPaiement(jour().fr, 'espèces', 1500n), lAvoir(b2, 3600n), lPaiement(jour().fr, 'prélèvement', 1000n),
          lReste(10623n),
        ],
      }, 'ordre');
    });

    // Critère 9 : l'assistante technique (AT-3, point 33 ; AT-4). Réponse 1 du 09-11-2026 : ses règlements en lecture.
    test('critère 9 : l’assistante technique lit la réponse et le PDF de sa facture (1 236,64 €) comme l’administration : l’avoir de l’administration et le sien, sa seule part du règlement (500,00 € sur 577,77 €), « Reste à payer : 601,64 € » ; la facture de l’administration lui répond 404 (réponse et PDF), sans écriture', async () => {
      const sienne = await emise('critère 9, sa facture', F_AT, { auth: par('AT') });
      assert.deepEqual([sienne.facture.creeParType, sienne.facture.totalHt, sienne.facture.totalTva, sienne.facture.totalTtc], [ROLE_AT, 1030.53, 206.11, 1236.64]);
      const administration = await emise('critère 9, facture de l’administration', F_ADMIN);
      assert.equal(administration.facture.totalTtc, 77.77);
      const aAdmin = await avoir(sienne.facture.id, A_AT_ADMIN, par('AD'));
      const r = await regler([[sienne.facture.id, 500], [administration.facture.id, 77.77]]);
      assert.equal(r.montant, 577.77);
      const aSien = await avoir(sienne.facture.id, A_AT, par('AT'));
      assert.deepEqual([aAdmin.creeParType, aAdmin.totalTtc, aSien.creeParType, aSien.totalTtc], ['ADMIN', 120, ROLE_AT, 15]);
      const attendu = { parts: [[r.id, 500, 'ENREGISTRE']], avoirs: [[aAdmin.id, aAdmin.numero, 120], [aSien.id, aSien.numero, 15]], solde: [500, 135, 601.64], ttc: 123664n };
      const parElle = await reglementsDe(sienne.facture.id, par('AT'));
      verifierReponse(parElle, attendu, 'lu par elle');
      assert.deepEqual(parElle, await reglementsDe(sienne.facture.id, par('AD')), 'même réponse pour elle et pour l’administration');
      const brut = JSON.stringify(parElle);
      for (const absent of [administration.facture.id, administration.facture.numero, '577.77', '77.77']) assert.ok(!brut.includes(absent), `absent de sa réponse : ${absent}`);
      // PDF : lectures écartées : avoirs hors taxes (624,14 €) ; total du règlement (577,77 €, reste 523,87 €) ; avoir de
      // l'administration omis pour elle (721,64 €) ; montant sans séparateur des milliers.
      const bloc = [lAvoir(aAdmin, 12000n), lPaiement(jour().fr, 'virement', 50000n), lAvoir(aSien, 1500n), lReste(60164n)];
      const lignesElle = await lignesPdf(sienne.facture.id, par('AT'));
      verifierPdf(lignesElle, { lignesEmise: sienne.lignesEmise, bloc, ttc: 123664n }, 'PDF lu par elle');
      assert.ok(lignesElle.includes('Total TTC : 1 236,64 €'));
      assert.deepEqual(lignesElle, await lignesPdf(sienne.facture.id, par('AD')), 'même PDF pour elle et pour l’administration');
      for (const absent of ['577,77 €', administration.facture.numero]) assert.ok(!lignesElle.join('\n').includes(absent), `absent de son PDF : ${absent}`);
      // Hors de son poste : 404, réponse comme PDF, sans écriture.
      await refuse(() => appeler('get', `/factures/${administration.facture.id}/reglements`, null, par('AT')), 404, REFUS.introuvable, 'réponse de la facture de l’administration, par elle');
      await refuse(() => appeler('get', `/factures/${administration.facture.id}/document.pdf`, null, par('AT')), 404, REFUS.introuvable, 'PDF de la facture de l’administration, par elle');
      // La facture de l'administration, lue par l'administration : sa part de 77,77 €, soldée, « Facture réglée. ».
      verifierPdf(await lignesPdf(administration.facture.id), { lignesEmise: administration.lignesEmise, mention: MENTION.reglee, bloc: [lPaiement(jour().fr, 'virement', 7777n)], ttc: 7777n }, 'facture de l’administration');
    });

    test('droits inchangés : un comptable reçoit 403 (réponse et PDF), une requête sans session 401, une facture inconnue 404 ; la lecture de la réponse et du PDF n’écrit rien', async () => {
      const { facture } = await emise('droits', F120);
      await regler([[facture.id, 50]]);
      await avoir(facture.id, A20);
      for (const chemin of ['reglements', 'document.pdf']) {
        await refuse(() => appeler('get', `/factures/${facture.id}/${chemin}`, null, par('CPT')), 403, REFUS.gestion, `${chemin}, comptable`);
        await refuse(() => appeler('get', `/factures/${facture.id}/${chemin}`, null, null), 401, REFUS.sansSession, `${chemin}, sans session`);
        await refuse(() => appeler('get', `/factures/${randomUUID()}/${chemin}`, null, par('AD')), 404, REFUS.introuvable, `${chemin}, facture inconnue`);
      }
      const avant = await empreinte();
      await reglementsDe(facture.id);
      await pdfDe(facture.id);
      await reglementsDe(facture.id, par('DIR'));
      assert.deepEqual(tablesChangees(avant, await empreinte()), [], 'lectures sans écriture');
    });

    // Envoi par Microsoft 365 : « un envoi joint le PDF du moment » (cadrage v2, § 2, « Effet sur les envois »).
    test('envoi par Microsoft 365 : la pièce jointe est le PDF de la route, mention et bloc compris, par l’administration et par l’assistante technique (sa facture) ; un règlement reçu entre deux envois change la pièce jointe du second, et son empreinte au journal', async () => {
      // Par l'administration : facture réglée en partie, avoir de 20,00 €.
      const { facture } = await emise('envoi, administration', F120);
      await regler([[facture.id, 50]]);
      const a = await avoir(facture.id, A20);
      const pdfRoute = await pdfDe(facture.id);
      const recu = await envoyerParMicrosoft365(facture.id, sa(), secours.email, 'envoi par l’administration');
      assert.equal(normaliser(recu), normaliser(pdfRoute), 'pièce jointe identique au PDF de la route, hors CreationDate et /ID');
      assert.deepEqual(blocDuPdf(await lignesDuPdf(recu)), [lPaiement(jour().fr, 'virement', 5000n), lAvoir(a, 2000n), lReste(5000n)]);
      // Un second paiement de 50,00 €, puis un second envoi : la pièce jointe porte la facture réglée (lecture écartée : PDF figé
      // au premier envoi).
      await regler([[facture.id, 50]], { moyen: 'chèque' });
      const second = await envoyerParMicrosoft365(facture.id, sa(), secours.email, 'second envoi');
      assert.notEqual(sha256(second), sha256(recu));
      assert.equal(normaliser(second), normaliser(await pdfDe(facture.id)));
      const lignesSecond = await lignesDuPdf(second);
      assert.deepEqual(mentionsDuPdf(lignesSecond), [MENTION.reglee]);
      assert.deepEqual(blocDuPdf(lignesSecond), [lPaiement(jour().fr, 'virement', 5000n), lAvoir(a, 2000n), lPaiement(jour().fr, 'chèque', 5000n)]);

      // Par l'assistante technique, sa facture soldée par deux avoirs (l'un de l'administration).
      const sienne = await emise('envoi, assistante', F120, { auth: par('AT') });
      const a70 = await avoir(sienne.facture.id, A70, par('AD'));
      const a50 = await avoir(sienne.facture.id, A50, par('AT'));
      const pdfElle = await pdfDe(sienne.facture.id, par('AT'));
      const recuElle = await envoyerParMicrosoft365(sienne.facture.id, par('AT'), comptes.AT.email, 'envoi par l’assistante technique');
      assert.equal(normaliser(recuElle), normaliser(pdfElle));
      verifierPdf(await lignesDuPdf(recuElle), { lignesEmise: sienne.lignesEmise, mention: MENTION.parAvoirs, bloc: [lAvoir(a70, 7000n), lAvoir(a50, 5000n)], ttc: 12000n }, 'pièce jointe envoyée par elle');
    });

    // T2 du contrôle de mode 1 (C4) : l'envoi lit le PDF en READ COMMITTED, après le verrou FOR SHARE de preparerEnvoiFacture ; un
    // règlement prend FOR UPDATE sur la facture et attend. Le PDF lu porte l'état d'avant le règlement.
    test('T2 : un règlement saisi pendant un envoi attend la fin de la lecture du PDF, qui porte l’état d’avant ; une fois l’envoi terminé, le règlement est enregistré et le PDF suivant le porte', async () => {
      const { facture } = await emise('T2', F120);
      await regler([[facture.id, 50]]);
      const document = envoiFacture(facture.id, 'ADMIN');
      let reglementFini = false;
      let enCours = null;
      const lu = await prisma.$transaction(async (tx) => {
        const prepare = await document.preparer(tx);
        assert.ok(prepare && !('statut' in prepare && 'error' in prepare), `préparation refusée : ${JSON.stringify(prepare)}`);
        enCours = appeler('post', '/reglements', { clientId: client.id, dateReglement: jour().fr, montant: 20, moyen: 'CHEQUE', affectations: [{ factureId: facture.id, montant: 20 }] }, par('AD'))
          .then((res) => { reglementFini = true; return res; });
        // Le règlement attend un verrou (pg_stat_activity), et n'a pas répondu.
        let attente = 0;
        for (let essai = 0; essai < 60 && !attente; essai += 1) {
          await new Promise((fin) => setTimeout(fin, 50));
          attente = (await administrationPg.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = 'Lock'", [nomBase])).rows[0].n;
        }
        assert.ok(attente >= 1, 'le règlement attend le verrou de la facture');
        assert.equal(reglementFini, false, 'le règlement n’a pas répondu pendant l’envoi');
        const lecture = await document.lirePdf(tx, prepare);
        assert.ok(lecture && !('error' in lecture), `lecture refusée : ${JSON.stringify(lecture)}`);
        assert.equal(reglementFini, false, 'le règlement attend encore après la lecture du PDF');
        return lecture;
      }, { isolationLevel: 'ReadCommitted', timeout: 15_000 });
      const { pdf } = await document.rendrePdf(lu);
      // État d'avant : un seul paiement, reste 70,00 € (lecture écartée : paiement de 20,00 € lu, reste 50,00 €).
      assert.deepEqual(blocDuPdf(await lignesDuPdf(pdf)), [lPaiement(jour().fr, 'virement', 5000n), lReste(7000n)]);
      const res = await enCours;
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.deepEqual(blocDuPdf(await lignesPdf(facture.id)), [lPaiement(jour().fr, 'virement', 5000n), lPaiement(jour().fr, 'chèque', 2000n), lReste(5000n)]);
    });

    // T2, par la route d'envoi : un règlement en cours d'écriture (verrou FOR UPDATE de la facture, comme POST /api/reglements) fait
    // attendre l'envoi par Microsoft 365, qui lit ensuite le PDF : la pièce jointe porte ce règlement. Lecture écartée : PDF lu avant
    // le verrou de preparerEnvoiFacture (la pièce jointe n'aurait que le premier paiement, reste 70,00 €).
    test('T2, par la route d’envoi : un envoi par Microsoft 365 commencé pendant l’écriture d’un règlement attend sa validation, puis joint le PDF qui le porte (reste 50,00 €)', async () => {
      const { facture } = await emise('T2, envoi', F120);
      await regler([[facture.id, 50]]);
      graph.reinitialiser();
      let envoiFini = false;
      let envoi = null;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "Facture" WHERE "id" = ${facture.id} FOR UPDATE`;
        await tx.reglement.create({ data: { clientId: client.id, dateReglement: new Date(jour().iso), montant: 20, moyen: 'CHEQUE', createdById: comptes.AD.id, affectations: { create: [{ factureId: facture.id, montant: 20 }] } } });
        envoi = request(app).post(`/api/factures/${facture.id}/envois`).set(sa()).set('X-Jeton-Microsoft', jetonMicrosoft(secours.email))
          .send({ destinataire: 'compta@client-detail.test', canal: 'MICROSOFT_365' }).then((res) => { envoiFini = true; return res; });
        let attente = 0;
        for (let essai = 0; essai < 60 && !attente; essai += 1) {
          await new Promise((fin) => setTimeout(fin, 50));
          attente = (await administrationPg.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = 'Lock'", [nomBase])).rows[0].n;
        }
        assert.ok(attente >= 1, 'l’envoi attend le verrou de la facture');
        assert.equal(envoiFini, false, 'l’envoi n’a pas répondu pendant l’écriture du règlement');
        assert.equal(graph.requetes('envoi').length, 0, 'rien n’est parti pendant l’écriture du règlement');
      }, { timeout: 15_000 });
      const res = await envoi;
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const envois = graph.requetes('envoi');
      assert.equal(envois.length, 1);
      const recu = Buffer.from(envois[0].json.message.attachments[0].contentBytes, 'base64');
      assert.deepEqual(blocDuPdf(await lignesDuPdf(recu)), [lPaiement(jour().fr, 'virement', 5000n), lPaiement(jour().fr, 'chèque', 2000n), lReste(5000n)]);
      assert.equal(normaliser(recu), normaliser(await pdfDe(facture.id)), 'pièce jointe identique au PDF de la route');
    });
  });
}

// Audit des montants de #534 (T1 et N3), sans base : la mise en forme du bloc, sur des données fixes.
//  - T1 : la date imprimée d'un avoir est sa date d'émission (jour civil de la société, stocké à minuit UTC), et non le jour UTC
//    de son instant d'émission : un avoir émis à 00:30 à Paris le 10-11-2026 (emisLe 09-11-2026 23:30 UTC) est « du 10-11-2026 »
//    (lecture écartée : « du 09-11-2026 », emisLe lu en UTC) ;
//  - N3 : à date et instant égaux, l'identifiant départage une part et un avoir, comme dans le panneau de l'écran (lecture
//    écartée : paiements d'abord, ou ordre reçu).
test('bloc « Règlements et avoirs », sans base : date d’un avoir émis peu après minuit (date d’émission et non instant UTC) ; départage par identifiant à date et instant égaux', async () => {
  const { lignesReglementsImprimes } = await import('../dist/src/domaines/factures/pdf.js');
  const avoirNuit = { id: 'a-nuit', numero: 'A2026-0901', dateEmission: new Date('2026-11-10T00:00:00.000Z'), emisLe: new Date('2026-11-09T23:30:00.000Z'), totalTtc: 12 };
  assert.deepEqual(lignesReglementsImprimes({ parts: [], avoirs: [avoirNuit], solde: { montantRegle: 0, montantAvoirs: 12, resteDu: 108 } }), [
    'Avoir A2026-0901 du 10-11-2026 : 12,00 €', 'Reste à payer : 108,00 €',
  ]);
  const jour = new Date('2026-11-10T00:00:00.000Z');
  const instant = new Date('2026-11-10T10:00:00.000Z');
  const part = (id) => ({ id, montant: 50, reglement: { dateReglement: jour, createdAt: instant, moyen: 'VIREMENT', statut: 'ENREGISTRE' } });
  const avoir = (id) => ({ id, numero: `A-${id}`, dateEmission: jour, emisLe: instant, totalTtc: 70 });
  const solde = { montantRegle: 50, montantAvoirs: 70, resteDu: 0 };
  assert.deepEqual(lignesReglementsImprimes({ parts: [part('f-part')], avoirs: [avoir('0-avoir')], solde }), [
    'Avoir A-0-avoir du 10-11-2026 : 70,00 €', 'Paiement du 10-11-2026 (virement) : 50,00 €',
  ]);
  assert.deepEqual(lignesReglementsImprimes({ parts: [part('0-part')], avoirs: [avoir('f-avoir')], solde }), [
    'Paiement du 10-11-2026 (virement) : 50,00 €', 'Avoir A-f-avoir du 10-11-2026 : 70,00 €',
  ]);
});
