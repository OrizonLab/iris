// Tests unitaires des règles de saisie et des calculs : ils APPELLENT les fonctions
// exportées par le serveur compilé (dist/index.js) et vérifient ce qu'elles renvoient.
// Aucune base de données n'est nécessaire.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { describe } from 'node:test';
import { Readable } from 'node:stream';
import util from 'node:util';
import express from 'express';
import request from 'supertest';

const {
  app,
  clientPayload, contactPayload, sitePayload, companySettingsPayload,
  fuseauHoraireEntrepriseValide, jourCivilEntreprise, aujourdHuiEntreprise,
  anneeEntreprise, dateEmissionEstFuture, dateDemandeCurative, dateHeuresIntervention,
  periodBounds, weekBoundsFrom,
  cataloguePayload, catalogueExtraPayload, catalogueFamily,
  commissionBaremeProgressif, computeChantierMetrics, voitRentabilite, peutVoirFinance,
  parseBareme, serialiseBareme, validerBareme,
  arrondiCommercialLigneHt, centimesTtcLigne, devisPayload,
  libelleComptableValide, alerteGenerationVisites,
} = await import('../dist/index.js');
// Garde des journaux du gestionnaire final d'Express (lot des failles des dépendances) : module compilé, que
// dist/index.js n'exporte pas.
const { erreurReduite, transmettreErreurReduite } = await import('../dist/src/http/erreurReduite.js');

test('date demandée : défaut selon le jour civil entreprise à minuit et format français strict', () => {
  // Wallis voit déjà le 1er mars tandis que le serveur UTC voit encore février.
  const now = new Date('2026-02-28T23:30:00.000Z');
  assert.equal(dateDemandeCurative(undefined, 'Pacific/Wallis', now), '2026-03-01T00:00:00.000Z');
  assert.equal(dateDemandeCurative('28-02-2026', 'Pacific/Wallis', now), '2026-02-28T00:00:00.000Z');
  // À 13 h UTC Wallis est déjà au 1er mars, Paris et UTC sont encore au 28 février :
  // un repli silencieux sur Paris/UTC doit refuser à tort la date de Wallis.
  const instantDiscriminant = new Date('2026-02-28T13:00:00.000Z');
  assert.equal(dateDemandeCurative('01-03-2026', 'Pacific/Wallis', instantDiscriminant), '2026-03-01T00:00:00.000Z');
  assert.equal(dateDemandeCurative('01-03-2026', 'Europe/Paris', instantDiscriminant), null);
  for (const value of ['2026-02-28', '2026-02-28T00:00:00Z', '29-02-2026', ' 28-02-2026', '', null]) {
    assert.equal(dateDemandeCurative(value, 'Pacific/Wallis', now), null);
  }
});

test('date des heures SAV : jour civil de la société admis, lendemain refusé, quel que soit le fuseau du serveur', () => {
  // À 13 h UTC, Wallis est déjà au 1er mars ; Paris et UTC sont encore au 28 février.
  const instant = new Date('2026-02-28T13:00:00.000Z');
  assert.equal(dateHeuresIntervention('01-03-2026', 'Pacific/Wallis', instant), '2026-03-01T00:00:00.000Z');
  assert.equal(dateHeuresIntervention('01-03-2026', 'Europe/Paris', instant), null);
  // À 5 h UTC, Tahiti est encore au 27 février : le 28, déjà commencé en UTC, y reste futur.
  const matin = new Date('2026-02-28T05:00:00.000Z');
  assert.equal(dateHeuresIntervention('28-02-2026', 'Pacific/Tahiti', matin), null);
  assert.equal(dateHeuresIntervention('27-02-2026', 'Pacific/Tahiti', matin), '2026-02-27T00:00:00.000Z');
  for (const value of ['31-02-2026', '', null, 12]) assert.equal(dateHeuresIntervention(value, 'Europe/Paris', instant), null);
});

test('le libellé comptable refuse les contrôles CR, LF, TAB, NUL et DEL sans rejeter les accents', () => {
  assert.equal(libelleComptableValide('Ventes, pose; et entretien'), true);
  assert.equal(libelleComptableValide('Libellé d’entretien'), true);
  for (const controle of ['\r', '\n', '\t', '\u0000', '\u001f', '\u007f']) {
    assert.equal(libelleComptableValide(`Avant${controle}Après`), false);
    assert.equal(libelleComptableValide(`Avant${controle}`), false);
  }
});

test('limite les corps JSON à 5 Mo avec erreur 413 JSON même sans connexion à la base', async () => {
  const reponse = await request(app).post('/api/comptabilite/importer').set('Content-Type', 'application/json')
    .send(JSON.stringify({ lignes: [{ code: '899990', libelle: 'X'.repeat(5 * 1024 * 1024), nature: 'ACTIF' }] }));
  assert.equal(reponse.status, 413);
  assert.match(reponse.headers['content-type'], /application\/json/);
  assert.match(reponse.body.error, /volumineux|taille/i);
});

// Garde des journaux du gestionnaire final d'Express (cadrage du lot des failles des dépendances, 14-11-2026, point 3 du
// périmètre ; N7, puis C2 et N2 du contrôle du cadrage). Express 5.3 journalise l'erreur entière (`console.error(err)`),
// là où Express 5.2 n'en journalisait que la pile. Le dernier gestionnaire d'erreurs d'Iris lui transmet une copie
// réduite : la même pile, et seulement ce que `finalhandler` lit pour fixer la réponse (`status`, `statusCode`,
// `headers`), en propriétés non énumérables. La réponse ne change pas ; le journal redevient la pile seule, sans le corps
// brut d'un JSON mal formé (`body`), les détails Prisma (`meta`), une `cause` ni aucune autre propriété. Pour un JSON mal
// formé, la tête de pile et le message, où JSON.parse cite le corps ou un extrait, sont remplacés par un texte fixe (audit
// interne de #544, N1).
const tourDeBoucle = () => new Promise((resolve) => setImmediate(resolve));

test('un JSON mal formé reçoit toujours 400, et le gestionnaire final d’Express n’en journalise que la pile, sans le corps brut', async () => {
  const temoin = `TEMOIN-${randomUUID()}`;
  // Le témoin est placé loin de la position fautive (le « x ») : le message de JSON.parse ne cite qu'un extrait autour
  // d'elle (ou le corps entier s'il est court), et le témoin ne peut donc atteindre le journal que par le corps brut.
  const corps = `{"a": x, "remplissage":"${'r'.repeat(200)}", "jeton":"${temoin}"}`;
  const messageNatif = (() => { try { JSON.parse(corps); return null; } catch (erreur) { return erreur.message; } })();
  assert.ok(messageNatif && !messageNatif.includes(temoin), `précondition : l’extrait cité par JSON.parse ne contient pas le témoin (${messageNatif})`);

  const journal = [];
  const consoleError = console.error;
  const environnement = app.get('env');
  let reponse;
  // Express ne journalise pas quand l'environnement de l'application vaut `test` : production le temps du test.
  app.set('env', 'production');
  console.error = (...args) => { journal.push(args); };
  try {
    reponse = await request(app).post('/api/clients').set('Content-Type', 'application/json').send(corps);
    // `finalhandler` journalise par `setImmediate`, souvent après l'arrivée de la réponse : on attend l'entrée (dix tours
    // au plus), puis un tour de plus, pour qu'une entrée tardive n'échappe pas au test ni ne tombe dans le suivant.
    for (let tour = 0; tour < 10 && journal.length === 0; tour += 1) await tourDeBoucle();
    await tourDeBoucle();
  } finally {
    console.error = consoleError;
    app.set('env', environnement);
  }

  // Réponse inchangée : 400, page d'erreur de `finalhandler` en production, ni pile ni corps.
  assert.equal(reponse.status, 400);
  assert.match(reponse.headers['content-type'], /^text\/html/);
  assert.equal(reponse.headers['content-security-policy'], "default-src 'none'");
  assert.equal(reponse.headers['x-content-type-options'], 'nosniff');
  assert.match(reponse.text, /<pre>Bad Request<\/pre>/);
  assert.ok(!reponse.text.includes(temoin), 'le témoin ne doit pas revenir dans la réponse');

  // Journal : une entrée (un journal vide ferait passer le test à tort), l'erreur réduite, imprimée comme sa seule pile.
  assert.equal(journal.length, 1, `une entrée attendue au journal du gestionnaire final, reçu : ${journal.length}`);
  assert.equal(journal[0].length, 1, 'une seule valeur journalisée');
  const [journalisee] = journal[0];
  assert.match(journalisee.stack, /^SyntaxError: JSON mal formé \(extrait du corps non journalisé\)\n\s+at /);
  const texte = util.format(...journal[0]);
  assert.equal(texte, journalisee.stack, 'le journal est la pile seule, sans propriété imprimée à sa suite');
  assert.ok(!texte.includes(temoin), 'le corps brut de la requête ne doit pas être journalisé');
  assert.ok(!texte.includes('body:'), 'aucune propriété `body` journalisée');
  // Ce que reçoit console.error, et non seulement ce qu'il imprime : ni propriété `body`, même cachée, ni témoin dans les
  // propriétés non énumérables (qu'un autre journal que la console pourrait sérialiser).
  assert.equal('body' in journalisee, false, 'la valeur journalisée ne porte pas de propriété `body`');
  assert.ok(!util.inspect(journalisee, { showHidden: true, depth: Infinity }).includes(temoin), 'témoin absent des propriétés cachées de la valeur journalisée');
});

// Audit interne de la PR #544 (auditeur-droits-securite, T1) : l'erreur d'un JSON mal formé naît dans body-parser, avant
// toutes les routes ; elle ne prouve donc pas la place de la garde après les routes (N2 du contrôle du cadrage). Une erreur
// née en essayant les routes, ici le décodage du paramètre de GET /api/clients/:id (avant requireAuth, sans base), ne passe
// par la garde que si celle-ci est montée après elles : sinon Express 5.3 imprime `status: 400` à la suite de la pile.
test('une erreur née en essayant les routes (paramètre mal encodé) passe aussi par la garde : 400, journal réduit à la pile', async () => {
  const journal = [];
  const consoleError = console.error;
  const environnement = app.get('env');
  let reponse;
  app.set('env', 'production');
  console.error = (...args) => { journal.push(args); };
  try {
    reponse = await request(app).get('/api/clients/%E0%A4%A');
    for (let tour = 0; tour < 10 && journal.length === 0; tour += 1) await tourDeBoucle();
    await tourDeBoucle();
  } finally {
    console.error = consoleError;
    app.set('env', environnement);
  }

  assert.equal(reponse.status, 400);
  assert.match(reponse.text, /<pre>Bad Request<\/pre>/);
  assert.equal(journal.length, 1, `une entrée attendue au journal du gestionnaire final, reçu : ${journal.length}`);
  assert.equal(journal[0].length, 1, 'une seule valeur journalisée');
  const [journalisee] = journal[0];
  assert.match(journalisee.stack, /^URIError: Failed to decode param/);
  assert.equal(util.format(...journal[0]), journalisee.stack, 'le journal est la pile seule, sans `status` imprimé à sa suite');
});

// Message que body-parser (express.json(), sans Iris) donne au corps : précondition des cas ci-dessous, pour qu'un test
// ne passe pas à vide si le message natif cessait de citer le corps.
const messageDuParseurJson = (corps) => new Promise((resolve) => {
  const requete = Readable.from([Buffer.from(corps)]);
  requete.method = 'POST';
  requete.headers = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(corps)) };
  express.json()(requete, {}, (erreur) => resolve(erreur ? { type: erreur.type, message: erreur.message } : null));
});

// Audit interne de la PR #544 (auditeur-droits-securite, N1, traité dans le code) : JSON.parse cite en entier un corps de
// moins de 21 caractères, et un extrait d'une dizaine de caractères autour de la faute dans un corps plus long ; le mode
// strict de body-parser (corps qui ne commence ni par « { » ni par « [ ») cite de même un extrait. La garde remplace ce
// message par un texte fixe : ni le jeton ni son extrait n'atteignent le journal.
test('un JSON mal formé ne laisse au journal ni le corps court entier ni l’extrait cité autour de la faute, mode strict compris', async () => {
  const cas = [
    { corps: '{"token":TEMOIN-1}', citeLeCorpsEntier: true },
    { corps: '{"email":"secours@iris.test","token":TEMOIN-LONG-jeton-de-secours-au-moins-32-caracteres}', citeLeCorpsEntier: false },
    { corps: '"TEMOIN-STRICT-jeton-de-secours"', citeLeCorpsEntier: false },
  ];
  const consoleError = console.error;
  const environnement = app.get('env');
  for (const { corps, citeLeCorpsEntier } of cas) {
    const natif = await messageDuParseurJson(corps);
    assert.equal(natif?.type, 'entity.parse.failed', `précondition : ${corps} refusé par body-parser`);
    assert.ok(natif.message.includes('TEMOIN'), `précondition : le message de body-parser cite le jeton (${natif.message})`);
    assert.equal(natif.message.includes(corps), citeLeCorpsEntier, `précondition : corps ${citeLeCorpsEntier ? 'cité en entier' : 'cité par extrait'} (${natif.message})`);
    const journal = [];
    let reponse;
    app.set('env', 'production');
    console.error = (...args) => { journal.push(args); };
    try {
      reponse = await request(app).post('/api/auth/break-glass').set('Content-Type', 'application/json').send(corps);
      for (let tour = 0; tour < 10 && journal.length === 0; tour += 1) await tourDeBoucle();
      await tourDeBoucle();
    } finally {
      console.error = consoleError;
      app.set('env', environnement);
    }
    assert.equal(reponse.status, 400, corps);
    assert.equal(journal.length, 1, corps);
    const texte = util.format(...journal[0]);
    assert.match(texte, /^SyntaxError: JSON mal formé \(extrait du corps non journalisé\)\n\s+at /);
    assert.equal(texte, journal[0][0].stack, 'le journal est la pile seule');
    assert.ok(!texte.includes('TEMOIN'), `ni corps ni extrait au journal : ${texte.split('\n')[0]}`);
  }
});

describe('Garde des journaux : copie réduite de l’erreur transmise au gestionnaire final d’Express', () => {
  // Une propriété ajoutée à la copie (même non énumérable : `[cause]` est imprimé par Node) ou imprimée à la suite de la
  // pile ferait apparaître le témoin ou différer l'impression de la pile.
  const sansTemoin = (copie, temoin) => {
    for (const options of [{}, { showHidden: true, depth: Infinity }]) {
      assert.ok(!util.inspect(copie, options).includes(temoin), `témoin absent de util.inspect(copie, ${JSON.stringify(options)})`);
    }
  };

  test('une erreur ne garde ni corps, ni détails Prisma, ni cause, ni autre propriété : même pile, même message, aucune trace du témoin', () => {
    const temoin = `TEMOIN-${randomUUID()}`;
    const erreur = new Error('Requête refusée', { cause: new Error(`${temoin}-cause`) });
    Object.assign(erreur, { body: `{"jeton":"${temoin}-body"}`, meta: { cible: `${temoin}-meta` }, autre: `${temoin}-autre` });
    const pile = erreur.stack;
    const copie = erreurReduite(erreur);
    assert.notEqual(copie, erreur, 'une copie, et non l’erreur elle-même');
    for (const cle of ['body', 'meta', 'cause', 'autre']) assert.equal(cle in copie, false, `${cle} absent de la copie`);
    assert.equal(copie.stack, pile);
    assert.equal(copie.message, 'Requête refusée');
    assert.equal(Object.prototype.propertyIsEnumerable.call(copie, 'message'), false, 'message non énumérable');
    assert.deepEqual(Object.keys(copie), []);
    sansTemoin(copie, temoin);
    assert.equal(util.inspect(copie), pile, 'imprimée, la copie n’est que sa pile');
    // Copie, et non réduction en place : l'erreur d'origine reste entière pour qui la tient encore.
    assert.equal(erreur.body, `{"jeton":"${temoin}-body"}`);
    assert.equal(erreur.cause.message, `${temoin}-cause`);
  });

  test('statut, code et en-têtes de la réponse conservés et lisibles, mais non énumérables', () => {
    const temoin = `TEMOIN-${randomUUID()}`;
    // `status` et `statusCode` distincts : une copie qui prendrait l'un pour l'autre échoue ici.
    const erreur = Object.assign(new Error('Trop de requêtes'), { status: 429, statusCode: 503, headers: { 'Retry-After': '120' }, body: temoin });
    const copie = erreurReduite(erreur);
    assert.equal(copie.status, 429);
    assert.equal(copie.statusCode, 503);
    assert.deepEqual(copie.headers, { 'Retry-After': '120' });
    assert.deepEqual(Object.keys(copie), [], 'aucune propriété énumérable, que console.error imprimerait');
    for (const cle of ['status', 'statusCode', 'headers']) {
      assert.equal(Object.getOwnPropertyDescriptor(copie, cle)?.enumerable, false, `${cle} non énumérable`);
    }
    assert.equal('body' in copie, false);
    sansTemoin(copie, temoin);
    assert.equal(util.inspect(copie), erreur.stack, 'ni statut ni en-têtes imprimés à la suite de la pile');
  });

  test('une SyntaxError de body-parser garde les cadres de sa pile et son statut 400, sans le corps, ni le type, ni l’extrait de son message', () => {
    const temoin = `TEMOIN-${randomUUID()}`;
    const corps = `{"a": x, "remplissage":"${'r'.repeat(200)}", "jeton":"${temoin}"}`;
    let erreur;
    try { JSON.parse(corps); } catch (e) { erreur = e; }
    // Propriétés que body-parser (`lib/read.js`) et http-errors posent sur l'erreur d'un JSON mal formé.
    Object.assign(erreur, { expose: true, statusCode: 400, status: 400, body: corps, type: 'entity.parse.failed' });
    const copie = erreurReduite(erreur);
    assert.match(erreur.stack.split('\n')[0], /^SyntaxError: Unexpected token 'x'/);
    assert.equal(copie.stack.split('\n')[0], 'SyntaxError: JSON mal formé (extrait du corps non journalisé)');
    assert.equal(copie.message, 'JSON mal formé (extrait du corps non journalisé)');
    assert.deepEqual(copie.stack.split('\n').slice(1), erreur.stack.split('\n').slice(1), 'mêmes cadres de pile');
    assert.equal(copie.status, 400);
    assert.equal(copie.statusCode, 400);
    for (const cle of ['body', 'type', 'expose']) assert.equal(cle in copie, false, `${cle} absent de la copie`);
    assert.deepEqual(Object.keys(copie), []);
    sansTemoin(copie, temoin);
  });

  test('un objet sans pile reçoit String(objet) pour pile, et garde son statut', () => {
    const temoin = `TEMOIN-${randomUUID()}`;
    const objet = { status: 404, body: temoin };
    const copie = erreurReduite(objet);
    assert.equal(copie.stack, '[object Object]');
    assert.equal(copie.status, 404);
    assert.equal('body' in copie, false);
    assert.deepEqual(Object.keys(copie), []);
    sansTemoin(copie, temoin);
    // Un `toString` propre à l'objet : la pile vient bien de String(objet), et non d'un texte fixe.
    const nomme = { statusCode: 410, detail: temoin, toString() { return 'Ressource retirée (TEST)'; } };
    const copieNommee = erreurReduite(nomme);
    assert.equal(copieNommee.stack, 'Ressource retirée (TEST)');
    assert.equal(copieNommee.statusCode, 410);
    assert.equal('detail' in copieNommee, false);
    assert.deepEqual(Object.keys(copieNommee), []);
    sansTemoin(copieNommee, temoin);
  });

  test('null, undefined, une chaîne et un nombre passent tels quels', () => {
    assert.equal(erreurReduite(null), null);
    assert.equal(erreurReduite(undefined), undefined);
    assert.equal(erreurReduite('Refus en texte (TEST)'), 'Refus en texte (TEST)');
    assert.equal(erreurReduite(42), 42);
  });

  // N1 du rapport du redacteur-tests, traité dans le code : `String(objet)` lève une exception pour un objet sans prototype
  // (ou dont le `toString` échoue). Levée dans la garde, elle remplacerait l'erreur transmise et changerait le statut de
  // la réponse (500 au lieu du statut d'origine) : la garde ne doit jamais lever.
  test('un objet sans prototype, ou dont le toString échoue, est réduit sans exception : pile « [object Object] », statut conservé', () => {
    const temoin = `TEMOIN-${randomUUID()}`;
    const sansPrototype = Object.assign(Object.create(null), { status: 404, body: temoin });
    let copie;
    assert.doesNotThrow(() => { copie = erreurReduite(sansPrototype); });
    assert.equal(copie.stack, '[object Object]');
    assert.equal(copie.status, 404);
    assert.equal('body' in copie, false);
    assert.deepEqual(Object.keys(copie), []);
    sansTemoin(copie, temoin);
    const toStringEnEchec = { statusCode: 409, body: temoin, toString() { throw new Error('toString en échec (TEST)'); } };
    let copieEnEchec;
    assert.doesNotThrow(() => { copieEnEchec = erreurReduite(toStringEnEchec); });
    assert.equal(copieEnEchec.stack, '[object Object]');
    assert.equal(copieEnEchec.statusCode, 409);
    assert.equal('body' in copieEnEchec, false);
    sansTemoin(copieEnEchec, temoin);
  });

  // N2 du rapport du redacteur-tests, traité dans le code : une fonction porte des propriétés comme un objet ; passée telle
  // quelle, `console.error` les imprimerait (`[Function] { body: … }`). Elle est réduite comme un objet.
  test('une fonction transmise comme erreur est réduite comme un objet : copie Error, statut conservé, sans ses propriétés', () => {
    const temoin = `TEMOIN-${randomUUID()}`;
    const fonction = Object.assign(function refusDeTest() {}, { status: 418, body: temoin });
    const copie = erreurReduite(fonction);
    assert.notEqual(copie, fonction);
    assert.ok(copie instanceof Error, 'la copie est une Error');
    assert.equal(copie.status, 418);
    assert.equal('body' in copie, false);
    assert.deepEqual(Object.keys(copie), []);
    sansTemoin(copie, temoin);
  });

  test('le dernier gestionnaire a quatre paramètres, comme tout gestionnaire d’erreurs d’Express, et transmet la copie réduite', () => {
    // Express ne passe une erreur qu'aux gestionnaires déclarés avec quatre paramètres ; à trois, il serait sauté.
    assert.equal(transmettreErreurReduite.length, 4);
    const temoin = `TEMOIN-${randomUUID()}`;
    const erreur = Object.assign(new Error('Refus (TEST)'), { status: 400, statusCode: 400, body: temoin });
    const transmis = [];
    transmettreErreurReduite(erreur, {}, {}, (...args) => { transmis.push(args); });
    assert.equal(transmis.length, 1, 'next appelé une fois');
    assert.equal(transmis[0].length, 1, 'next appelé avec la seule erreur réduite');
    const [copie] = transmis[0];
    assert.notEqual(copie, erreur);
    assert.equal(copie.stack, erreur.stack);
    assert.equal(copie.status, 400);
    assert.equal('body' in copie, false);
    sansTemoin(copie, temoin);
  });
});

describe('Fiche client', () => {
  test('la raison sociale est obligatoire à la création', () => {
    assert.throws(() => clientPayload({}, true), /raison sociale est obligatoire/);
    assert.deepEqual(clientPayload({ raisonSociale: '  Société Test  ' }, true).raisonSociale, 'Société Test');
  });

  test('le SIREN doit faire exactement neuf chiffres', () => {
    assert.equal(clientPayload({ raisonSociale: 'X', siren: '123456789' }, true).siren, '123456789');
    assert.throws(() => clientPayload({ raisonSociale: 'X', siren: '1234' }, true), /SIREN/);
    assert.throws(() => clientPayload({ raisonSociale: 'X', siren: 'ABCDEFGHI' }, true), /SIREN/);
  });

  test('un SIREN saisi avec des espaces reste accepté', () => {
    // Format usuel sur un extrait Kbis : « 123 456 789 ».
    assert.equal(clientPayload({ raisonSociale: 'X', siren: '123 456 789' }, true).siren, '123456789');
  });

  test("l'e-mail est normalisé et validé", () => {
    assert.equal(clientPayload({ raisonSociale: 'X', email: '  Contact@Exemple.FR ' }, true).email, 'contact@exemple.fr');
    assert.throws(() => clientPayload({ raisonSociale: 'X', email: 'pas-un-email' }, true), /email/);
  });

  test('une modification ne touche que les champs envoyés', () => {
    const data = clientPayload({ telephone: '0102030405' });
    assert.deepEqual(Object.keys(data), ['telephone']);
  });

  // Lot 6a-2 bis : case « pas de SIRET » d'un particulier.
  test('la case « pas de SIRET » est un booléen strict, incompatible avec un SIREN à la création', () => {
    assert.equal(clientPayload({ raisonSociale: 'X', sansSiret: true }, true).sansSiret, true);
    assert.equal(clientPayload({ raisonSociale: 'X', sansSiret: false, siren: '123456789' }, true).sansSiret, false);
    assert.equal('sansSiret' in clientPayload({ raisonSociale: 'X' }, true), false);
    for (const valeur of ['oui', 'true', 1, 0, null, {}]) {
      assert.throws(() => clientPayload({ raisonSociale: 'X', sansSiret: valeur }, true), /^Error: Champ client invalide : sansSiret$/);
      assert.throws(() => clientPayload({ sansSiret: valeur }), /^Error: Champ client invalide : sansSiret$/);
    }
    assert.throws(() => clientPayload({ raisonSociale: 'X', sansSiret: true, siren: '123 456 789' }, true), /^Error: Un client sans SIRET ne peut pas avoir de SIREN : videz le SIREN ou décochez la case\.$/);
    assert.equal(clientPayload({ raisonSociale: 'X', sansSiret: true, siren: '' }, true).siren, null);
    assert.throws(() => clientPayload({ sansSiret: true }, true), /nom complet est obligatoire/);
    // À la modification, la contradiction se juge sur la fiche entière, sous verrou, par la route.
    assert.deepEqual(clientPayload({ sansSiret: true }), { sansSiret: true });
  });
});

describe('Contacts et sites', () => {
  test('le nom du contact est obligatoire à la création', () => {
    assert.throws(() => contactPayload({}, true), /nom du contact est obligatoire/);
  });

  test('les rôles du contact doivent être des booléens', () => {
    assert.equal(contactPayload({ nom: 'Durand', estSignataire: true }, true).estSignataire, true);
    assert.throws(() => contactPayload({ nom: 'Durand', estSignataire: 'oui' }, true), /estSignataire/);
  });

  test("l'adresse d'un site est obligatoire à la création", () => {
    assert.throws(() => sitePayload({ nom: 'Siège' }, true), /adresse est obligatoire/);
    const site = sitePayload({ nom: 'Siège', adresse: '1 rue A', codePostal: '14000', ville: 'Caen' }, true);
    assert.equal(site.ville, 'Caen');
  });
});

describe('Identité de la société', () => {
  test('les couleurs doivent être des hexadécimaux à six chiffres', () => {
    assert.equal(companySettingsPayload({ couleurPrimaire: '#1E3A8A' }).couleurPrimaire, '#1e3a8a');
    assert.throws(() => companySettingsPayload({ couleurPrimaire: 'bleu' }), /Couleur invalide/);
    assert.throws(() => companySettingsPayload({ couleurPrimaire: '#fff' }), /Couleur invalide/);
  });

  test('un champ texte vide est enregistré comme absent, pas comme chaîne vide', () => {
    assert.equal(companySettingsPayload({ siret: '   ' }).siret, null);
  });

  test('n’accepte que les fuseaux des territoires français', () => {
    assert.equal(fuseauHoraireEntrepriseValide('Pacific/Noumea'), true);
    assert.equal(fuseauHoraireEntrepriseValide('America/Martinique'), true);
    assert.equal(fuseauHoraireEntrepriseValide('Europe/London'), false);
    assert.throws(() => companySettingsPayload({ fuseauHoraire: 'Europe/London' }), /Fuseau horaire invalide/);
  });
});

describe('Jours civils de l’entreprise', () => {
  test('calcule le jour dans le fuseau configuré, pas en UTC', () => {
    const instant = new Date('2026-09-11T14:32:32.863Z');
    assert.equal(jourCivilEntreprise(instant, 'Pacific/Noumea'), '2026-09-12');
    assert.equal(jourCivilEntreprise(instant, 'America/Martinique'), '2026-09-11');
  });

  test('permet de fixer l’instant de référence pour aujourd’hui', () => {
    const instant = new Date('2027-01-01T00:30:00.000Z');
    assert.equal(aujourdHuiEntreprise('America/Martinique', instant), '2026-12-31');
  });

  test('dérive l’année des références intervention et devis dans le fuseau de l’entreprise au nouvel an', () => {
    // Le même instant appartient déjà à 2027 à Nouméa, mais encore à 2026 en Martinique.
    // Les deux séquences annuelles (IYY et AYY) doivent donc choisir ces exercices, pas UTC.
    const instant = new Date('2026-12-31T13:30:00.000Z');
    assert.equal(anneeEntreprise(instant, 'Pacific/Noumea'), 2027, 'références I27 / A27 à Nouméa');
    assert.equal(anneeEntreprise(instant, 'America/Martinique'), 2026, 'références I26 / A26 en Martinique');
  });

  test('le refus de date future se règle sur le jour civil de l’entreprise, pas sur UTC', () => {
    // 11 septembre 21h37 UTC : il est déjà le 12 à Nouméa (UTC+11) et encore le 11 à Paris.
    // L'instant est injecté pour que ce test soit vrai à toute heure — sinon il ne serait
    // rouge que pendant la fenêtre de décalage, donc inutilisable.
    const instant = new Date('2026-09-11T21:37:00.000Z');
    const douze = '2026-09-12T00:00:00.000Z';
    assert.equal(dateEmissionEstFuture(douze, 'Pacific/Noumea', instant), false, 'le 12 est le jour même à Nouméa');
    assert.equal(dateEmissionEstFuture(douze, 'Europe/Paris', instant), true, 'le 12 est encore demain à Paris');
    // Et à l'ouest : le 11 est toujours le jour même en Martinique (UTC−4), jamais du futur.
    const onze = '2026-09-11T00:00:00.000Z';
    assert.equal(dateEmissionEstFuture(onze, 'America/Martinique', instant), false);
    assert.equal(dateEmissionEstFuture(douze, 'America/Martinique', instant), true);
  });
});

describe('Périodes et assiduité dans le fuseau de l’entreprise', () => {
  test('borne le mois du jour civil Wallis d’un instant injectable, pas du mois UTC', () => {
    // 28 février UTC au soir est déjà le 1er mars à Wallis (UTC+12).
    const instant = new Date('2026-02-28T23:30:00.000Z');
    const { start, endExclusive } = periodBounds('month', undefined, 'Pacific/Wallis', instant);
    assert.equal(start.toISOString(), '2026-03-01T00:00:00.000Z');
    assert.equal(endExclusive.toISOString(), '2026-04-01T00:00:00.000Z');
  });

  test('conserve une référence date-seule, même à l’ouest de UTC', () => {
    // Une date-seule est un jour métier, jamais un instant à relire dans le fuseau.
    // Gambier est à l'ouest : minuit UTC y est encore la veille, donc sans le
    // garde-fou d'une date-seule le mois basculerait sur février.
    const { start, endExclusive } = periodBounds('month', '2026-03-01', 'Pacific/Gambier', new Date('2026-02-28T23:30:00.000Z'));
    assert.equal(start.toISOString(), '2026-03-01T00:00:00.000Z');
    assert.equal(endExclusive.toISOString(), '2026-04-01T00:00:00.000Z');
  });

  test('calcule la semaine d’assiduité depuis le lundi Wallis d’un instant injectable', () => {
    // Dimanche UTC est déjà lundi 2 mars à Wallis : UTC choisirait la semaine précédente.
    const { monday, friday } = weekBoundsFrom(undefined, 'Pacific/Wallis', new Date('2026-03-01T12:30:00.000Z'));
    assert.equal(jourCivilEntreprise(monday, 'Pacific/Wallis'), '2026-03-02');
    assert.equal(jourCivilEntreprise(friday, 'Pacific/Wallis'), '2026-03-06');
  });
});

describe('Catalogue', () => {
  test('seules les trois familles connues sont acceptées', () => {
    assert.equal(catalogueFamily('articles'), 'articles');
    assert.equal(catalogueFamily('categories'), null);
    assert.equal(catalogueFamily('../users'), null);
  });

  test('référence et désignation sont obligatoires', () => {
    assert.throws(() => cataloguePayload({ nom: 'Sans référence' }), /obligatoires/);
  });

  test('un prix négatif ou non numérique est refusé', () => {
    assert.throws(() => cataloguePayload({ reference: 'A', nom: 'B', prixVenteHt: -1 }), /Prix de vente/);
    assert.throws(() => cataloguePayload({ reference: 'A', nom: 'B', prixVenteHt: 'gratuit' }), /Prix de vente/);
    assert.equal(cataloguePayload({ reference: 'A', nom: 'B', prixVenteHt: '149.90' }).prixVenteHt, 149.9);
  });

  test('la TVA vaut 20 % par défaut', () => {
    assert.equal(cataloguePayload({ reference: 'A', nom: 'B' }).tauxTva, 20);
  });

  test('chaque famille ajoute ses propres champs', () => {
    assert.ok('dureeIndicativeMin' in catalogueExtraPayload('prestations', {}));
    assert.ok('stockSuivi' in catalogueExtraPayload('articles', {}));
    assert.deepEqual(catalogueExtraPayload('equipements', { fabricant: ' Hikvision ' }), { fabricant: 'Hikvision', prixAchatHt: null });
  });

  // Un prix d'achat laissé vide reste absent : `Number('')` vaudrait un achat gratuit, que la
  // ligne de devis reprendrait comme prix d'achat prévu (lot pilote 2).
  test('le prix d’achat est facultatif dans les trois familles, et un champ vide reste absent', () => {
    for (const famille of ['prestations', 'articles', 'equipements']) {
      assert.equal(catalogueExtraPayload(famille, {}).prixAchatHt, null, famille);
      assert.equal(catalogueExtraPayload(famille, { prixAchatHt: '' }).prixAchatHt, null, famille);
      assert.equal(catalogueExtraPayload(famille, { prixAchatHt: '  ' }).prixAchatHt, null, famille);
      assert.equal(catalogueExtraPayload(famille, { prixAchatHt: '12.5' }).prixAchatHt, 12.5, famille);
      assert.equal(catalogueExtraPayload(famille, { prixAchatHt: 0 }).prixAchatHt, 0, famille);
      assert.throws(() => catalogueExtraPayload(famille, { prixAchatHt: '-1' }), /Prix d'achat invalide/, famille);
    }
  });
});

describe('Rémunération commerciale', () => {
  const bareme = [{ plafond: 10000, taux: 10 }, { plafond: 20000, taux: 15 }];

  test('une marge nulle ou négative ne donne aucune commission', () => {
    assert.equal(commissionBaremeProgressif(0, bareme), 0);
    assert.equal(commissionBaremeProgressif(-5000, bareme), 0);
  });

  test('le barème est progressif, tranche par tranche', () => {
    // 10 000 à 10 % = 1 000 ; les 5 000 suivants à 15 % = 750.
    assert.equal(commissionBaremeProgressif(10000, bareme), 1000);
    assert.equal(commissionBaremeProgressif(15000, bareme), 1750);
  });

  test('franchir une tranche ne requalifie pas toute la marge', () => {
    // Le piège d'un barème mal écrit : 10 001 € ne doit pas passer d'un coup à 15 %.
    const juste = commissionBaremeProgressif(10001, bareme);
    assert.ok(juste > 1000 && juste < 1002, `commission inattendue : ${juste}`);
  });
});

describe('Métriques de chantier', () => {
  const chantier = {
    budgetGlobalVendu: 10000, budgetMaterielVendu: 4000, budgetMainOeuvreVendu: 6000, heuresVendues: 100,
    achats: [{ montantHT: 3000 }],
    pointages: [{ nbrHeures: 50, tauxHoraireApplique: 40 }],
  };

  test('la marge est masquée à qui n’a pas le droit de la voir', () => {
    const vue = computeChantierMetrics(chantier, { margeCommercialeActive: true, planningActif: true }, false);
    assert.equal(vue.margeCommerciale, null);
    assert.equal(vue.margeBrute, null);
    // Les dépenses, elles, restent visibles : ce n'est pas une donnée réservée.
    assert.equal(vue.totalDepenses, 5000);
  });

  test('la marge est calculée pour un profil autorisé', () => {
    const vue = computeChantierMetrics(chantier, { margeCommercialeActive: true, planningActif: true }, true);
    assert.equal(vue.margeCommerciale, 5000); // 10 000 vendus − (3 000 achats + 2 000 main d'œuvre)
    assert.equal(vue.margePct, 50);
  });

  test('la marge désactivée dans les paramètres masque le calcul même pour un admin', () => {
    const vue = computeChantierMetrics(chantier, { margeCommercialeActive: false, planningActif: true }, true);
    assert.equal(vue.margeCommerciale, null);
  });

  // #198 : en nombres à virgule, 0,1 + 0,2 + 0,3 vaut 0,6000000000000001, mais 0,3 + 0,2 + 0,1
  // vaut 0,6. Un budget exactement consommé déclenchait ou non une alerte de dépassement
  // selon l'ordre des lignes.
  test('totaux au centime près, quel que soit l’ordre des lignes (#198)', () => {
    const params = { margeCommercialeActive: true, planningActif: true };
    for (const valeurs of [[0.1, 0.2, 0.3], [0.3, 0.2, 0.1], [0.2, 0.1, 0.3]]) {
      const vue = computeChantierMetrics({
        budgetGlobalVendu: 10, budgetMaterielVendu: 0.6, budgetMainOeuvreVendu: 0.6, heuresVendues: 0.6,
        achats: valeurs.map((montantHT) => ({ montantHT })),
        pointages: valeurs.map((nbrHeures) => ({ nbrHeures, tauxHoraireApplique: 1 })),
      }, params, true);
      assert.deepEqual(
        [vue.materielReel, vue.heuresRealisees, vue.moReel, vue.totalDepenses, vue.diffHeures, vue.margeCommerciale],
        [0.6, 0.6, 0.6, 1.2, 0, 8.8],
        `ordre ${valeurs.join(', ')}`,
      );
      for (const alerte of ['MATERIEL_DEPASSE', 'HEURES_DEPASSEES', 'MAIN_OEUVRE_DEPASSEE']) {
        assert.ok(!vue.alertes.includes(alerte), `${alerte} à budget exactement consommé (ordre ${valeurs.join(', ')})`);
      }
    }
    // Heures × taux : 1,1 h × 1,10 € = 1,21 € exactement (1,2100000000000002 en flottant).
    const produit = computeChantierMetrics({
      budgetGlobalVendu: 0, budgetMaterielVendu: 0, budgetMainOeuvreVendu: 1.21, heuresVendues: 1.1,
      achats: [], pointages: [{ nbrHeures: 1.1, tauxHoraireApplique: 1.1 }],
    }, params, true);
    assert.equal(produit.moReel, 1.21);
    assert.ok(!produit.alertes.includes('MAIN_OEUVRE_DEPASSEE'));
  });
});

describe('Destinataires de la rentabilité d’un chantier', () => {
  // Organisation : Régional → Secteur → Conducteur ; le chantier est confié au conducteur.
  const chantier = { responsableId: 'conducteur' };
  const tous = { rentabiliteConducteur: true, rentabiliteHierarchie: true, rentabiliteDirecteurs: true };
  const session = (id, role, equipeIds = []) => ({ user: { id, role, equipeIds } });
  const comptes = {
    administrateur: session('admin', 'ADMIN'),
    superadministrateur: session('super', 'SUPERADMIN'),
    directeur: session('dir', 'DIRECTEUR'),
    conducteur: session('conducteur', 'CONDUCTEUR_TRAVAUX'),
    secteur: session('secteur', 'RESPONSABLE', ['conducteur']),
    regional: session('regional', 'RESPONSABLE', ['secteur', 'conducteur']),
    'responsable d’une autre branche': session('autre', 'RESPONSABLE', ['autre.conducteur']),
    'autre conducteur': session('autre.conducteur', 'CONDUCTEUR_TRAVAUX'),
    commercial: session('commercial', 'COMMERCIAL'),
    // Un rattachement ne donne rien à un rôle sans périmètre hiérarchique, et un technicien
    // ne voit jamais de montant, même désigné par erreur sur le chantier.
    'directeur commercial supérieur': session('dc', 'DIRECTEUR_COMMERCIAL', ['conducteur']),
    'technicien désigné': session('conducteur', 'TECHNICIEN'),
  };
  const voient = (params, cible = chantier) => Object.entries(comptes).filter(([, req]) => voitRentabilite(req, cible, params)).map(([nom]) => nom);

  test('par défaut : administrateurs, directeur, conducteur du chantier et toute sa chaîne', () => {
    assert.deepEqual(voient(tous), ['administrateur', 'superadministrateur', 'directeur', 'conducteur', 'secteur', 'regional']);
  });

  test('chaque catégorie se retire seule ; les administrateurs restent toujours destinataires', () => {
    assert.deepEqual(voient({ ...tous, rentabiliteConducteur: false }), ['administrateur', 'superadministrateur', 'directeur', 'secteur', 'regional']);
    assert.deepEqual(voient({ ...tous, rentabiliteHierarchie: false }), ['administrateur', 'superadministrateur', 'directeur', 'conducteur']);
    assert.deepEqual(voient({ ...tous, rentabiliteDirecteurs: false }), ['administrateur', 'superadministrateur', 'conducteur', 'secteur', 'regional']);
    assert.deepEqual(voient({ rentabiliteConducteur: false, rentabiliteHierarchie: false, rentabiliteDirecteurs: false }), ['administrateur', 'superadministrateur']);
  });

  test('un responsable chargé lui-même du chantier relève de la catégorie conducteur', () => {
    const sien = { responsableId: 'secteur' };
    assert.equal(voitRentabilite(comptes.secteur, sien, tous), true);
    assert.equal(voitRentabilite(comptes.secteur, sien, { ...tous, rentabiliteConducteur: false }), false);
    assert.equal(voitRentabilite(comptes.regional, sien, { ...tous, rentabiliteConducteur: false }), true, 'son propre responsable le voit toujours au titre de la chaîne');
  });

  test('un chantier sans conducteur n’a de destinataires que l’administration et la direction', () => {
    assert.deepEqual(voient(tous, { responsableId: null }), ['administrateur', 'superadministrateur', 'directeur']);
  });

  test('une clé d’intégration suit son scope finances:read, quels que soient les réglages', () => {
    const aucun = { rentabiliteConducteur: false, rentabiliteHierarchie: false, rentabiliteDirecteurs: false };
    assert.equal(voitRentabilite({ apiKey: { scopes: ['chantiers:read', 'finances:read'] } }, chantier, aucun), true);
    assert.equal(voitRentabilite({ apiKey: { scopes: ['chantiers:read'] } }, chantier, tous), false);
    assert.equal(voitRentabilite({}, chantier, tous), false, 'sans porteur identifié');
  });
});

describe('Marge estimée en fin de chantier et alertes de suivi', () => {
  const params = { margeCommercialeActive: true, planningActif: true, tauxAcompteDefaut: 30, seuilMargeFaible: 15, joursSansSaisie: 14 };
  const contexte = (surcharge = {}) => ({ aujourdhui: '2026-10-13', fuseauHoraire: 'Europe/Paris', coutHoraireSociete: 45, ratioMaterielHistorique: 0.7, ...surcharge });
  // Vendu 10 000 € : 4 000 € de matériel, 6 000 € de main-d'œuvre pour 100 h.
  const chantier = (surcharge = {}) => ({
    statut: 'EN_COURS', dateDebut: '2026-10-01T08:00:00.000Z',
    budgetGlobalVendu: 10000, budgetMaterielVendu: 4000, budgetMainOeuvreVendu: 6000, heuresVendues: 100,
    achats: [{ montantHT: 1000, date: '2026-10-10T00:00:00.000Z' }],
    pointages: [{ nbrHeures: 20, tauxHoraireApplique: 40, date: '2026-10-12T00:00:00.000Z' }],
    ...surcharge,
  });

  test('main-d’œuvre au coût horaire du chantier, matériel au ratio des chantiers terminés', () => {
    const vue = computeChantierMetrics(chantier(), params, true, contexte());
    // 100 h × 40 € = 4 000 € ; 4 000 € × 0,7 = 2 800 € ; 10 000 − 6 800 = 3 200 €.
    assert.equal(vue.estimation.coutMainOeuvreAttendu, 4000);
    assert.equal(vue.estimation.coutMaterielAttendu, 2800);
    assert.equal(vue.estimation.sourceCoutHoraire, 'CHANTIER');
    assert.equal(vue.estimation.sourceMateriel, 'HISTORIQUE');
    assert.equal(vue.margeEstimee, 3200);
    assert.equal(vue.margeEstimeePct, 32);
    assert.ok(!vue.alertes.includes('MARGE_FAIBLE'));
  });

  test('sans heure saisie : coût horaire moyen de la société, puis budget main-d’œuvre vendu', () => {
    const societe = computeChantierMetrics(chantier({ pointages: [] }), params, true, contexte());
    assert.equal(societe.estimation.sourceCoutHoraire, 'SOCIETE');
    assert.equal(societe.estimation.coutMainOeuvreAttendu, 4500);
    assert.equal(societe.margeEstimee, 10000 - 4500 - 2800);
    const vendu = computeChantierMetrics(chantier({ pointages: [] }), params, true, contexte({ coutHoraireSociete: null }));
    assert.equal(vendu.estimation.sourceCoutHoraire, 'VENDU');
    assert.equal(vendu.estimation.coutMainOeuvreAttendu, 6000);
    // 10 000 − 6 000 − 2 800 = 1 200 €, soit 12 % : sous le seuil de 15 %.
    assert.equal(vendu.margeEstimeePct, 12);
    assert.ok(vendu.alertes.includes('MARGE_FAIBLE'));
  });

  test('sans chantier terminé, le matériel restant est compté à son prix de vente', () => {
    const vue = computeChantierMetrics(chantier(), params, true, contexte({ ratioMaterielHistorique: null }));
    assert.equal(vue.estimation.sourceMateriel, 'VENDU');
    assert.equal(vue.estimation.ratioMateriel, 1);
    assert.equal(vue.estimation.coutMaterielAttendu, 4000);
    assert.equal(vue.margeEstimee, 2000);
  });

  test('le coût attendu d’un poste ne descend jamais sous le réel déjà engagé', () => {
    const vue = computeChantierMetrics(chantier({
      achats: [{ montantHT: 5000, date: '2026-10-10T00:00:00.000Z' }],
      pointages: [{ nbrHeures: 120, tauxHoraireApplique: 40, date: '2026-10-12T00:00:00.000Z' }],
    }), params, true, contexte());
    assert.equal(vue.estimation.coutMaterielAttendu, 5000);
    assert.equal(vue.estimation.coutMainOeuvreAttendu, 4800);
    assert.equal(vue.margeEstimee, 200);
  });

  test('seuil de marge faible : réglable, retirable (la marge estimée négative reste signalée), et sans doublon avec la perte avérée', () => {
    const tendu = chantier({ pointages: [] });
    const sansSeuil = { ...params, seuilMargeFaible: null };
    assert.ok(!computeChantierMetrics(tendu, sansSeuil, true, contexte({ coutHoraireSociete: null })).alertes.includes('MARGE_FAIBLE'));
    assert.ok(!computeChantierMetrics(tendu, { ...params, seuilMargeFaible: 10 }, true, contexte({ coutHoraireSociete: null })).alertes.includes('MARGE_FAIBLE'));
    // Même sans seuil, une marge estimée négative reste signalée.
    const negatif = computeChantierMetrics(tendu, sansSeuil, true, contexte({ coutHoraireSociete: 80 }));
    assert.ok(negatif.margeEstimee < 0);
    assert.ok(negatif.alertes.includes('MARGE_FAIBLE'));
    // Déjà en perte : seule l'alerte la plus forte est portée.
    const perte = computeChantierMetrics(chantier({ achats: [{ montantHT: 9500, date: '2026-10-10T00:00:00.000Z' }] }), params, true, contexte());
    assert.ok(perte.alertes.includes('EN_PERTE'));
    assert.ok(!perte.alertes.includes('MARGE_FAIBLE'));
  });

  // #198 : 21 × (362,57 / 21) vaut 362,57000000000005 en flottant ; la marge estimée d'un chantier
  // vendu exactement à son coût attendu tombait à -5e-14, avec une alerte de marge faible.
  test('heures vendues faites au coût réel : marge estimée exactement nulle, sans alerte', () => {
    const vue = computeChantierMetrics(chantier({
      budgetGlobalVendu: 362.57, budgetMaterielVendu: 0, budgetMainOeuvreVendu: 362.57, heuresVendues: 21, achats: [],
      pointages: [{ nbrHeures: 20, tauxHoraireApplique: 17.26, date: '2026-10-12T00:00:00.000Z' }, { nbrHeures: 1, tauxHoraireApplique: 17.37, date: '2026-10-12T00:00:00.000Z' }],
    }), { ...params, seuilMargeFaible: null }, true, contexte());
    assert.equal(vue.estimation.coutMainOeuvreAttendu, 362.57);
    assert.ok(Object.is(vue.margeEstimee, 0), `marge estimée ${vue.margeEstimee}`);
    assert.ok(!vue.alertes.includes('MARGE_FAIBLE'));
  });

  test('un chantier terminé n’a plus de reste à faire ni de délai sans saisie', () => {
    const vue = computeChantierMetrics(chantier({ statut: 'TERMINE', achats: [{ montantHT: 1000, date: '2026-01-05T00:00:00.000Z' }] }), params, true, contexte());
    assert.equal(vue.margeEstimee, vue.margeCommerciale);
    assert.equal(vue.estimation.sourceMateriel, 'REEL');
    assert.equal(vue.joursSansSaisie, null);
    assert.ok(!vue.alertes.includes('SANS_SAISIE'));
  });

  test('délai sans saisie : dernière date métier active, à défaut le jour civil du début', () => {
    const a15jours = computeChantierMetrics(chantier({ achats: [{ montantHT: 10, date: '2026-09-28T00:00:00.000Z' }], pointages: [] }), params, false, contexte());
    assert.equal(a15jours.derniereSaisie, '2026-09-28');
    assert.equal(a15jours.joursSansSaisie, 15);
    assert.ok(a15jours.alertes.includes('SANS_SAISIE'));
    const a13jours = computeChantierMetrics(chantier({ achats: [{ montantHT: 10, date: '2026-09-30T00:00:00.000Z' }], pointages: [] }), params, false, contexte());
    assert.ok(!a13jours.alertes.includes('SANS_SAISIE'));
    // Une saisie archivée ne remet pas le compteur à zéro.
    const archive = computeChantierMetrics(chantier({ achats: [{ montantHT: 10, date: '2026-09-28T00:00:00.000Z' }, { montantHT: 10, date: '2026-10-12T00:00:00.000Z', archivedAt: '2026-10-12T10:00:00.000Z' }], pointages: [] }), params, false, contexte());
    assert.equal(archive.joursSansSaisie, 15);
    // Sans aucune saisie : un début converti le 28/09 à 23 h 30 UTC est le 29/09 à Paris.
    const instant = computeChantierMetrics(chantier({ achats: [], pointages: [], dateDebut: '2026-09-28T23:30:00.000Z' }), params, false, contexte());
    assert.equal(instant.derniereSaisie, null);
    assert.equal(instant.joursSansSaisie, 14);
    assert.ok(instant.alertes.includes('SANS_SAISIE'));
    // Une date-seule corrigée à la main n'est pas relue dans un fuseau.
    const dateSeule = computeChantierMetrics(chantier({ achats: [], pointages: [], dateDebut: '2026-09-30T00:00:00.000Z' }), params, false, contexte({ fuseauHoraire: 'America/Guadeloupe' }));
    assert.equal(dateSeule.joursSansSaisie, 13);
    // Alerte désactivée : le délai reste lisible, sans alerte.
    const desactive = computeChantierMetrics(chantier({ achats: [{ montantHT: 10, date: '2026-09-01T00:00:00.000Z' }], pointages: [] }), { ...params, joursSansSaisie: null }, false, contexte());
    assert.equal(desactive.joursSansSaisie, 42);
    assert.ok(!desactive.alertes.includes('SANS_SAISIE'));
  });

  test('l’estimation et la marge faible restent masquées à qui ne voit pas la marge', () => {
    const vue = computeChantierMetrics(chantier({ pointages: [] }), params, false, contexte({ coutHoraireSociete: null }));
    assert.equal(vue.margeEstimee, null);
    assert.equal(vue.margeEstimeePct, null);
    assert.equal(vue.estimation, null);
    assert.ok(!vue.alertes.includes('MARGE_FAIBLE'));
  });
});

describe('Barèmes de rémunération configurables', () => {
  test('un plafond null devient la tranche non plafonnée', () => {
    // JSON ne représente pas Infinity : la dernière tranche est stockée avec plafond null.
    const bareme = parseBareme([{ plafond: 20000, taux: 16 }, { plafond: null, taux: 25 }]);
    assert.equal(bareme[1].plafond, Infinity);
    assert.deepEqual(serialiseBareme(bareme), [{ plafond: 20000, taux: 16 }, { plafond: null, taux: 25 }]);
  });

  test('les tranches sont remises dans l’ordre des plafonds', () => {
    // Le calcul progressif suppose des plafonds croissants : un barème saisi dans le
    // désordre donnerait des commissions fausses sans lever d’erreur.
    const bareme = parseBareme([{ plafond: 30000, taux: 20 }, { plafond: 10000, taux: 10 }]);
    assert.deepEqual(bareme.map((t) => t.plafond), [10000, 30000]);
  });

  test('une tranche illisible est ignorée plutôt que de fausser le calcul', () => {
    assert.deepEqual(parseBareme([{ plafond: 100, taux: 'beaucoup' }, { plafond: 200, taux: 10 }]).length, 1);
    assert.deepEqual(parseBareme('pas un tableau'), []);
  });

  test('un barème vide ne produit aucune commission', () => {
    assert.equal(commissionBaremeProgressif(50000, []), 0);
  });

  test('la validation refuse ce qui donnerait des montants faux', () => {
    assert.throws(() => validerBareme([{ plafond: 100, taux: 150 }], 'Barème'), /taux/);
    assert.throws(() => validerBareme([{ plafond: 100, taux: -1 }], 'Barème'), /taux/);
    assert.throws(() => validerBareme([{ plafond: 30000, taux: 10 }, { plafond: 20000, taux: 20 }], 'Barème'), /croissants/);
    assert.throws(() => validerBareme([{ plafond: null, taux: 10 }, { plafond: null, taux: 20 }], 'Barème'), /une seule tranche/);
    assert.throws(() => validerBareme('rien', 'Barème'), /tableau/);
  });

  test('la validation accepte un barème vide et un barème valide', () => {
    assert.deepEqual(validerBareme([], 'Barème'), []);
    const ok = validerBareme([{ plafond: 20000, taux: 16 }, { plafond: '', taux: 25 }], 'Barème');
    assert.equal(ok.length, 2);
    assert.equal(ok[1].plafond, Infinity);
  });
});

describe('Arrondi commercial des lignes de facture', () => {
  test('arrondit exactement une demi-unité de centime vers le haut sans flottant', () => {
    assert.equal(arrondiCommercialLigneHt('0.5', '4.27'), 2.14);
    assert.equal(arrondiCommercialLigneHt('0.125', '4.12'), 0.52);
    assert.equal(centimesTtcLigne(9, '5.5'), 9.5);
    assert.equal(centimesTtcLigne(17.15, '10'), 18.87);
  });
});

describe('Arrondi commercial des devis', () => {
  test('arrondit 0,5 × 4,27 au centime et conserve HT + TVA = TTC au taux réduit', () => {
    const devis = devisPayload({
      clientId: 'client-test', objet: 'TEST Arrondi commercial',
      lignes: [{ designation: 'Demi-centime', nature: 'MAIN_OEUVRE', quantite: '0.5', prixUnitaireHt: '4.27', tauxTva: '5.5' }],
    });
    assert.equal(devis.lignesCalculees[0].totalHt, 2.14);
    assert.equal(devis.totalHt, 2.14);
    assert.equal(devis.totalTva, 0.12);
    assert.equal(devis.totalTtc, 2.26);
    assert.equal(Math.round((devis.totalHt + devis.totalTva) * 100) / 100, devis.totalTtc);
    assert.throws(() => devisPayload({ clientId: 'client-test', objet: 'TEST Invalide', lignes: [{ designation: 'Invalide', quantite: 0, prixUnitaireHt: 4.27, tauxTva: 5.5 }] }), /Ligne de devis invalide/);
  });

  test('refuse clairement les précisions incompatibles avec le calcul exact', () => {
    for (const ligne of [
      { designation: 'Quantité trop précise', quantite: '0.3333', prixUnitaireHt: '4.27', tauxTva: '5.5' },
      { designation: 'Prix trop précis', quantite: '1', prixUnitaireHt: '4.275', tauxTva: '5.5' },
      { designation: 'Taux trop précis', quantite: '1', prixUnitaireHt: '4.27', tauxTva: '5.5255' },
    ]) assert.throws(() => devisPayload({ clientId: 'client-test', objet: 'TEST Précision invalide', lignes: [ligne] }), /Ligne de devis invalide/);
  });

  test('arrondit le TTC de ligne du devis sur une demi-tranche', () => {
    const devis = devisPayload({ clientId: 'client-test', objet: 'TEST TTC de ligne', lignes: [{ designation: 'Demi-tranche TTC', nature: 'MAIN_OEUVRE', quantite: '1', prixUnitaireHt: '9.00', tauxTva: '5.5' }] });
    assert.equal(devis.lignesCalculees[0].totalTtc, 9.5);
  });

  test('calcule la TVA du devis sur la base cumulée du taux, pas en sommant les lignes', () => {
    const devis = devisPayload({ clientId: 'client-test', objet: 'TEST TVA agrégée', lignes: [
      { designation: 'Ligne A', nature: 'MAIN_OEUVRE', quantite: '1', prixUnitaireHt: '0.05', tauxTva: '10' },
      { designation: 'Ligne B', nature: 'MAIN_OEUVRE', quantite: '1', prixUnitaireHt: '0.05', tauxTva: '10' },
    ] });
    assert.equal(devis.totalHt, 0.1);
    assert.equal(devis.totalTva, 0.01);
    assert.equal(devis.totalTtc, 0.11);
  });

  // Lot pilote 2 : une ligne reprise du catalogue porte sa fiche, son unité et, en option, un
  // prix d'achat prévu. La validation reste pure ; la fiche est résolue en base par l'API.
  test('lignes reprises du catalogue : fiche, unité et prix d’achat prévu validés', () => {
    const base = { designation: 'Caméra dôme', nature: 'FOURNITURE', quantite: '2', prixUnitaireHt: '120', tauxTva: '20' };
    const devis = devisPayload({ clientId: 'client-test', objet: 'TEST Catalogue', lignes: [
      { ...base, unite: ' pièce ', catalogueFamille: 'equipements', catalogueId: 'fiche-1', prixAchatUnitaireHt: '80,50' },
      { ...base, ligneId: 'ligne-1' },
      { ...base, prixAchatUnitaireHt: null },
    ] });
    assert.equal(devis.lignesCalculees[0].unite, 'pièce');
    assert.deepEqual(devis.references, [
      { ligneId: null, catalogue: { famille: 'equipements', id: 'fiche-1' }, prixAchatUnitaireHt: 80.5 },
      { ligneId: 'ligne-1', catalogue: null, prixAchatUnitaireHt: undefined },
      { ligneId: null, catalogue: null, prixAchatUnitaireHt: null },
    ]);
    for (const [ligne, message] of [
      [{ ...base, catalogueFamille: 'inconnue', catalogueId: 'x' }, /Fiche catalogue de la ligne invalide/],
      [{ ...base, catalogueFamille: 'articles' }, /Fiche catalogue de la ligne invalide/],
      [{ ...base, prixAchatUnitaireHt: '-3' }, /Prix d’achat prévu invalide/],
      [{ ...base, prixAchatUnitaireHt: '1.234' }, /Prix d’achat prévu invalide/],
      [{ ...base, unite: 'u'.repeat(41) }, /Ligne de devis invalide/],
      [{ ...base, designation: 'd'.repeat(501) }, /Ligne de devis invalide/],
      [{ ...base, quantite: '999999999', prixUnitaireHt: '9999999999' }, /hors des limites/],
    ]) assert.throws(() => devisPayload({ clientId: 'client-test', objet: 'TEST Catalogue invalide', lignes: [ligne] }), message);
  });
});

// Lot « devis au temps passé » : la ligne au temps passé est validée sans prix ; son prix, sa TVA et ses
// totaux sont fixés par le serveur depuis la main d'œuvre, à la résolution en base (tests HTTP).
describe('Devis au temps passé : saisie de la ligne', () => {
  const ligne = { tempsPasse: true, designation: 'Main d’œuvre au temps passé', quantite: '1', tarifTempsPasse: 'HORS_CONTRAT', catalogueFamille: 'prestations', catalogueId: 'mo-1' };
  test('la ligne au temps passé attend son prix du serveur ; ses totaux et ceux du devis aussi', () => {
    const devis = devisPayload({ clientId: 'client-test', objet: 'TEST Temps passé', auTempsPasse: true, lignes: [ligne, { designation: 'Câble', nature: 'FOURNITURE', quantite: '2', prixUnitaireHt: '3', tauxTva: '20' }] });
    assert.equal(devis.auTempsPasse, true);
    assert.deepEqual(devis.lignesCalculees[0], { ordre: 0, designation: 'Main d’œuvre au temps passé', nature: 'MAIN_OEUVRE', quantite: 1, prixUnitaireHt: null, tauxTva: null, totalHt: null, totalTtc: null, unite: null });
    assert.deepEqual(devis.references[0], { ligneId: null, catalogue: { famille: 'prestations', id: 'mo-1' }, prixAchatUnitaireHt: undefined, tempsPasse: { tarif: 'HORS_CONTRAT', prixUnitaireHt: null, tauxTva: null } });
    assert.deepEqual([devis.totalHt, devis.totalTva, devis.totalTtc], [null, null, null]);
    // Le prix et la TVA envoyés sont gardés pour être comparés à ceux de la main d'œuvre.
    const avecPrix = devisPayload({ clientId: 'client-test', objet: 'TEST Temps passé', auTempsPasse: true, lignes: [{ ...ligne, prixUnitaireHt: '45,50', tauxTva: '20' }] });
    assert.deepEqual(avecPrix.references[0].tempsPasse, { tarif: 'HORS_CONTRAT', prixUnitaireHt: 45.5, tauxTva: 20 });
    // Une ligne existante peut omettre son tarif et sa fiche : elle garde les siens.
    const existante = devisPayload({ clientId: 'client-test', objet: 'TEST Temps passé', lignes: [{ tempsPasse: true, ligneId: 'l-1', designation: 'Ligne gardée', quantite: '2.5' }] });
    assert.deepEqual([existante.auTempsPasse, existante.references[0].tempsPasse, existante.lignesCalculees[0].quantite], [undefined, { tarif: null, prixUnitaireHt: null, tauxTva: null }, 2.5]);
    // Prix, TVA, unité ou nature laissés blancs, prix d'achat nul ou vide : comme absents.
    for (const extra of [{ prixUnitaireHt: '  ', tauxTva: ' ', unite: ' ', nature: ' ' }, { prixAchatUnitaireHt: null }, { prixAchatUnitaireHt: '' }]) {
      const vide = devisPayload({ clientId: 'client-test', objet: 'TEST Temps passé', auTempsPasse: true, lignes: [{ ...ligne, ...extra }] });
      assert.deepEqual(vide.references[0].tempsPasse, { tarif: 'HORS_CONTRAT', prixUnitaireHt: null, tauxTva: null }, JSON.stringify(extra));
    }
    // Une ligne dont le drapeau vaut false ou null est une ligne ordinaire, chiffrée comme les autres.
    for (const drapeau of [false, null]) {
      const ordinaire = devisPayload({ clientId: 'client-test', objet: 'TEST Ordinaire', lignes: [{ tempsPasse: drapeau, designation: 'Câble', nature: 'FOURNITURE', quantite: '2', prixUnitaireHt: '3', tauxTva: '20' }] });
      assert.deepEqual([ordinaire.lignesCalculees[0].totalHt, ordinaire.references[0].tempsPasse, ordinaire.totalTtc], [6, undefined, 7.2], String(drapeau));
    }
  });

  test('une quantité positive au millième, l’heure, à l’heure hors contrat ou sous contrat, d’une prestation du catalogue', () => {
    // Le minimum et le pas du devis bornent ensuite la quantité (exigerQuantiteTempsPasse, plus bas).
    assert.equal(devisPayload({ clientId: 'client-test', objet: 'TEST', auTempsPasse: true, lignes: [{ ...ligne, quantite: '0.25' }] }).lignesCalculees[0].quantite, 0.25);
    for (const [extra, message] of [
      [{ quantite: '0' }, /Ligne de devis invalide/],
      [{ quantite: '1.0001' }, /Ligne de devis invalide/],
      [{ tarifTempsPasse: 'JOUR_HORS_CONTRAT' }, /forfait jour n’est pas proposé/],
      [{ tarifTempsPasse: undefined }, /forfait jour n’est pas proposé/],
      [{ unite: 'h' }, /comptée à l’heure/],
      [{ nature: 'FOURNITURE' }, /comptée à l’heure/],
      [{ catalogueFamille: 'articles' }, /reprend une main d’œuvre du catalogue/],
      [{ catalogueFamille: undefined, catalogueId: undefined }, /reprend une main d’œuvre du catalogue/],
      [{ prixUnitaireHt: '-1' }, /Ligne de devis invalide/],
      [{ tauxTva: '100.01' }, /Ligne de devis invalide/],
      [{ prixAchatUnitaireHt: '5' }, /pas de prix d’achat prévu/],
      // Prix d'achat envoyé : lu sur dix chiffres entiers, comme sur une ligne saisie, puis refusé ; au-delà, illisible.
      [{ prixAchatUnitaireHt: '9999999999.99' }, /pas de prix d’achat prévu/],
      [{ prixAchatUnitaireHt: '10000000000' }, /Prix d’achat prévu invalide/],
      // Blancs autour retirés : le prix d'achat est lu, puis refusé ; fait de blancs seuls, il n'est pas vide : illisible.
      [{ prixAchatUnitaireHt: ' 5 ' }, /pas de prix d’achat prévu/],
      [{ prixAchatUnitaireHt: '   ' }, /Prix d’achat prévu invalide/],
      [{ tempsPasse: 1 }, /« tempsPasse » doit valoir true ou false/],
    ]) assert.throws(() => devisPayload({ clientId: 'client-test', objet: 'TEST Temps passé invalide', auTempsPasse: true, lignes: [{ ...ligne, ...extra }] }), message, JSON.stringify(extra));
    assert.throws(() => devisPayload({ clientId: 'client-test', objet: 'TEST', auTempsPasse: 'oui', lignes: [ligne] }), /« auTempsPasse » doit valoir true ou false/);
    assert.equal(devisPayload({ clientId: 'client-test', objet: 'TEST', auTempsPasse: true, lignes: [{ ...ligne, quantite: '1', prixUnitaireHt: '', tauxTva: null, unite: ' heure ', nature: 'MAIN_OEUVRE' }] }).lignesCalculees[0].quantite, 1);
  });
});

describe('Temps passé : temps minimum facturé, pas, quantité de la ligne et mention (lot « facture au temps passé »)', async () => {
  const tp = await import('../dist/src/domaines/devis/tempsPasse.js');

  test('réglages : pas de 15, 30, 45 ou 60 minutes ou vide ; minimum multiple de 15 de 15 minutes à 8 heures, vide revenant à une heure', () => {
    for (const [brut, attendu] of [[null, null], ['', null], [15, 15], ['30', 30], [' 45 ', 45], ['060', 60]]) assert.equal(tp.lireReglagePasTempsPasse(brut), attendu, String(brut));
    for (const brut of [0, 1, 10, 14, 16, 59, 61, 90, '1e1', 'abc', '   ', 1.5, true]) assert.throws(() => tp.lireReglagePasTempsPasse(brut), /15, 30, 45 ou 60 minutes/, String(brut));
    for (const [brut, attendu] of [[null, 60], ['', 60], [15, 15], [480, 480], ['0090', 90], [' 120 ', 120]]) assert.equal(tp.lireReglageTempsMinimum(brut), attendu, String(brut));
    for (const brut of [0, 10, 14, 16, 50, 481, 495, -15, 1.5, 'abc', '   ', true]) assert.throws(() => tp.lireReglageTempsMinimum(brut), /multiple de 15, de 15 minutes à 8 heures/, String(brut));
  });

  test('réglages du jour figés par un devis : pas vide ou non admis refusé, minimum repris', () => {
    assert.throws(() => tp.reglagesTempsPasseDeLaSociete(null), /Réglez d’abord le pas du temps passé/);
    assert.throws(() => tp.reglagesTempsPasseDeLaSociete({ pasTempsPasseMinutes: null, tempsMinimumMinutes: 60 }), /Réglez d’abord le pas du temps passé/);
    assert.throws(() => tp.reglagesTempsPasseDeLaSociete({ pasTempsPasseMinutes: 10, tempsMinimumMinutes: 60 }), /Le pas du temps passé réglé \(10 minutes\) n’est plus admis/);
    assert.throws(() => tp.reglagesTempsPasseDeLaSociete({ pasTempsPasseMinutes: 1, tempsMinimumMinutes: 60 }), /\(1 minute\) n’est plus admis/);
    assert.deepEqual(tp.reglagesTempsPasseDeLaSociete({ pasTempsPasseMinutes: 45, tempsMinimumMinutes: 30 }), { pasTempsPasseMinutes: 45, tempsMinimumMinutes: 30 });
  });

  test('quantité de la ligne : le minimum figé puis des multiples du pas ; une heure au moins sans minimum (devis antérieur)', () => {
    const r = { tempsMinimumMinutes: 60, pasTempsPasseMinutes: 15 };
    for (const q of [1, 1.25, 1.5, 1.75, 2, 10]) assert.doesNotThrow(() => tp.exigerQuantiteTempsPasse(q, r), String(q));
    for (const q of [0.25, 0.75, 0.999, 1.001, 1.1, 1.3, 1.333]) assert.throws(() => tp.exigerQuantiteTempsPasse(q, r), /\(1 h\), puis des tranches de 15 minutes : en heures, 1 ; 1,25 ; 1,5…/, String(q));
    const r2 = { tempsMinimumMinutes: 30, pasTempsPasseMinutes: 45 };
    for (const q of [0.5, 1.25, 2, 2.75]) assert.doesNotThrow(() => tp.exigerQuantiteTempsPasse(q, r2), String(q));
    for (const q of [1, 0.75, 1.5]) assert.throws(() => tp.exigerQuantiteTempsPasse(q, r2), /\(30 min\), puis des tranches de 45 minutes : en heures, 0,5 ; 1,25 ; 2…/, String(q));
    const ancien = { tempsMinimumMinutes: null, pasTempsPasseMinutes: 10 };
    for (const q of [1, 1.001, 1.333, 10.125]) assert.doesNotThrow(() => tp.exigerQuantiteTempsPasse(q, ancien), String(q));
    assert.throws(() => tp.exigerQuantiteTempsPasse(0.999, ancien), /au moins une heure/);
  });

  test('durée et mention : minimum et pas, total minimum ou estimé ; texte d’alors sans minimum', () => {
    for (const [minutes, texte] of [[15, '15 min'], [30, '30 min'], [60, '1 h'], [75, '1 h 15 min'], [90, '1 h 30 min'], [480, '8 h']]) assert.equal(tp.dureeTempsPasse(minutes), texte);
    const devis = (quantite, extra = {}) => ({ auTempsPasse: true, pasTempsPasseMinutes: 15, tempsMinimumMinutes: 60, lignes: [{ tempsPasse: false, tarifTempsPasse: null, prixUnitaireHt: 3, quantite: 2 }, { tempsPasse: true, tarifTempsPasse: 'HORS_CONTRAT', prixUnitaireHt: 45.5, quantite }], ...extra });
    const regle = (pas = 15, minimum = '1 h', tarif = 'hors contrat', prix = '45,50 €') => `Devis au temps passé : au prix de ${prix} HT de l’heure (tarif à l’heure ${tarif}), hors matériel, le temps passé se facture avec un minimum de ${minimum}, puis par tranches de ${pas} minutes au-delà, toute tranche commencée étant due.`;
    assert.equal(tp.mentionTempsPasse(devis(1)), `${regle()} Le total de ce devis est un minimum.`);
    assert.equal(tp.mentionTempsPasse(devis(1.5)), `${regle()} Ce devis prévoit 1 h 30 min : son total est une estimation, la facture reprenant le temps réellement passé, avec au moins le minimum.`);
    assert.equal(tp.mentionTempsPasse(devis(0.5, { tempsMinimumMinutes: 30, pasTempsPasseMinutes: 45 })), `${regle(45, '30 min')} Le total de ce devis est un minimum.`);
    assert.equal(tp.mentionTempsPasse(devis(8, { tempsMinimumMinutes: 480, pasTempsPasseMinutes: 60 })), `${regle(60, '8 h')} Le total de ce devis est un minimum.`);
    assert.equal(tp.mentionTempsPasse(devis(1, { tempsMinimumMinutes: null, pasTempsPasseMinutes: 10 })), 'Devis au temps passé : une heure minimum facturée au prix de 45,50 € HT de l’heure (tarif à l’heure hors contrat), hors matériel ; au-delà de la première heure, le temps passé se facture par tranches de 10 minutes, toute tranche commencée étant due. Le total de ce devis est un minimum.');
    assert.equal(tp.mentionTempsPasse(devis(1, { tempsMinimumMinutes: undefined, pasTempsPasseMinutes: 1 })).includes('par tranches de 1 minute,'), true);
    assert.equal(tp.mentionTempsPasse(devis(1, { auTempsPasse: false })), null);
    assert.equal(tp.mentionTempsPasse(devis(1, { pasTempsPasseMinutes: null })), null);
  });
});

test('peutVoirFinance : jamais pour un technicien, même avec un accès financier enregistré', () => {
  assert.equal(peutVoirFinance({ role: 'TECHNICIEN', accesFinance: true }), false);
  assert.equal(peutVoirFinance({ role: 'CONDUCTEUR_TRAVAUX', accesFinance: true }), true);
  assert.equal(peutVoirFinance({ role: 'CONDUCTEUR_TRAVAUX', accesFinance: false }), false);
  assert.equal(peutVoirFinance({ role: 'SUPERADMIN', accesFinance: false }), true);
});

// Ajout du second audit interne de #293 : l'auteur du journal SAV.
describe('Facture au temps passé : heures facturées (lot « facture au temps passé », seconde PR)', async () => {
  const { grilleTempsPasse, minutesFacturees, heuresDesMinutes } = await import('../dist/src/domaines/factures/tempsPasse.js');
  const facturees = (minutesSaisies, devis, quantiteLigne = 1) => {
    const minutes = minutesFacturees(minutesSaisies, grilleTempsPasse(devis, quantiteLigne));
    return [minutes.toString(), heuresDesMinutes(minutes).toString()];
  };

  test('devis fait depuis le temps minimum : au moins le minimum, puis toute tranche du pas commencée au-delà', () => {
    const devis = { tempsMinimumMinutes: 60, pasTempsPasseMinutes: 15 };
    // Décision « Une fois au total » : 40 min puis 30 min font 1 h 10, soit 1 h 15 facturée.
    assert.deepEqual(facturees(70, devis), ['75', '1.25']);
    for (const [saisies, attendu] of [[0, ['60', '1']], [10, ['60', '1']], [60, ['60', '1']], [60.6, ['75', '1.25']], [75, ['75', '1.25']], [75.6, ['90', '1.5']], [480, ['480', '8']]]) {
      assert.deepEqual(facturees(saisies, devis), attendu, `${saisies} min`);
    }
    // Minimum de 30 min et pas de 45 min : l'ancre est le minimum, et non la première heure.
    const court = { tempsMinimumMinutes: 30, pasTempsPasseMinutes: 45 };
    for (const [saisies, attendu] of [[20, ['30', '0.5']], [31.2, ['75', '1.25']], [75, ['75', '1.25']], [76.2, ['120', '2']]]) {
      assert.deepEqual(facturees(saisies, court), attendu, `${saisies} min`);
    }
    // Les heures de la ligne du devis ne sont qu'une prévision : elles ne changent rien au plancher.
    assert.deepEqual(facturees(10, devis, 2), ['60', '1']);
  });

  test('devis antérieur au temps minimum : les heures de sa ligne pour plancher, puis le pas au-delà', () => {
    // Décision « Les heures de la ligne » : la mention annonçait 2 heures minimum facturées.
    const ancien = { tempsMinimumMinutes: null, pasTempsPasseMinutes: 45 };
    for (const [saisies, attendu] of [[30, ['120', '2']], [120, ['120', '2']], [120.6, ['165', '2.75']], [165, ['165', '2.75']], [166.2, ['210', '3.5']]]) {
      assert.deepEqual(facturees(saisies, ancien, 2), attendu, `${saisies} min`);
    }
    // Une ligne d'une heure : la règle d'alors (une heure au moins, puis le pas).
    assert.deepEqual(facturees(61.2, { tempsMinimumMinutes: null, pasTempsPasseMinutes: 7 }, 1), ['67', '1.117']);
    // Ligne au millième (1,333 h, soit 79,98 min) et pas de 20 minutes, qui divise l'heure mais ne vaut pas un
    // nombre entier de millièmes d'heure : la quantité s'arrondit au millième le plus proche.
    const vingt = { tempsMinimumMinutes: null, pasTempsPasseMinutes: 20 };
    assert.deepEqual(facturees(60, vingt, '1.333'), ['79.98', '1.333']);
    assert.deepEqual(facturees(81, vingt, '1.333'), ['99.98', '1.666']);
    assert.deepEqual(facturees(100.2, vingt, '1.333'), ['119.98', '2']);
    // L'arrondi vient du pas, et non de la ligne : sur une ligne d'une heure, une tranche de 20 minutes
    // s'arrondit (1 h 20, soit 1,333 h), une tranche de 9 minutes, qui ne divise pas l'heure, est exacte
    // (1 h 09, soit 1,15 h). La quantité n'est exacte que pour un pas multiple de 3 minutes.
    assert.deepEqual(facturees(66, vingt, 1), ['80', '1.333']);
    assert.deepEqual(facturees(61, { tempsMinimumMinutes: null, pasTempsPasseMinutes: 9 }, 1), ['69', '1.15']);
  });
});

describe('Lot pilote 5 : auteur du journal SAV', () => {
  // Décision de Nelson du 22-10-2026 : la génération automatique écrit au nom du compte système.
  test('la génération automatique écrit au nom du compte système ; une requête sans compte est refusée', async () => {
    const { auteurJournalSav } = await import('../dist/src/domaines/interventions/metier.js');
    const { COMPTE_SYSTEME_ID, NOM_COMPTE_SYSTEME } = await import('../dist/src/droits/roles.js');
    assert.deepEqual(auteurJournalSav(null), { auteurId: '00000000-0000-4000-8000-000000000001', auteurNom: 'Iris (automatique)' });
    assert.deepEqual([COMPTE_SYSTEME_ID, NOM_COMPTE_SYSTEME], ['00000000-0000-4000-8000-000000000001', 'Iris (automatique)']);
    assert.deepEqual(auteurJournalSav({ user: { id: 'compte', name: 'Nom' } }), { auteurId: 'compte', auteurNom: 'Nom' });
    assert.throws(() => auteurJournalSav({}), /sans compte auteur/);
  });
});

// Lot pilote 5 : alerte de la génération automatique des visites, montrée aux administrateurs.
describe('Alerte de la génération automatique des visites', () => {
  const instant = new Date('2026-06-15T10:00:00.000Z');
  const jour = (iso) => new Date(`${iso}T00:00:00.000Z`);
  const etat = (modifs) => ({ anticipation: 30, minuteurActif: true, jour: '2026-06-15', instant, derniere: null, derniereAutomatique: null, ...modifs });
  const passage = (modifs) => ({ jour: jour('2026-06-15'), statut: 'REUSSIE', debut: new Date('2026-06-15T00:05:00.000Z'), erreurs: [], ...modifs });

  test('un passage réussi d’hier ou d’aujourd’hui, ou aucun passage encore, ne déclenche rien', () => {
    assert.equal(alerteGenerationVisites(etat({})), null);
    assert.equal(alerteGenerationVisites(etat({ derniere: passage({}), derniereAutomatique: passage({}) })), null);
    const hier = passage({ jour: jour('2026-06-14') });
    assert.equal(alerteGenerationVisites(etat({ derniere: hier, derniereAutomatique: hier })), null);
  });

  test('un dernier passage en échec est signalé, avec son jour et son nombre d’erreurs', () => {
    const echec = passage({ statut: 'ECHEC', erreurs: [{ contratId: 'a' }, { contratId: 'b' }] });
    assert.match(alerteGenerationVisites(etat({ derniere: echec, derniereAutomatique: echec })), /du 15-06-2026 est en échec \(2 erreurs\)/);
    const uneErreur = passage({ statut: 'ECHEC', erreurs: [{ contratId: 'a' }] });
    assert.match(alerteGenerationVisites(etat({ derniere: uneErreur })), /\(1 erreur\)/);
  });

  test('un passage resté en cours plus d’une heure est signalé interrompu ; en cours depuis moins, rien', () => {
    const recent = passage({ statut: 'EN_COURS', debut: new Date('2026-06-15T09:01:00.000Z') });
    assert.equal(alerteGenerationVisites(etat({ derniere: recent, derniereAutomatique: recent })), null);
    const ancien = passage({ statut: 'EN_COURS', debut: new Date('2026-06-15T08:59:00.000Z') });
    assert.match(alerteGenerationVisites(etat({ derniere: ancien, derniereAutomatique: ancien })), /du 15-06-2026 s’est interrompue/);
  });

  test('sans passage automatique depuis avant-hier, alerte si le minuteur tourne, et seulement alors', () => {
    const avantHier = passage({ jour: jour('2026-06-13') });
    assert.match(alerteGenerationVisites(etat({ derniere: avantHier, derniereAutomatique: avantHier })), /n’a pas tourné depuis le 13-06-2026/);
    assert.equal(alerteGenerationVisites(etat({ derniere: avantHier, derniereAutomatique: avantHier, minuteurActif: false })), null);
    // Un passage manuel réussi ne remplace pas le passage automatique manquant.
    assert.match(alerteGenerationVisites(etat({ derniere: passage({}), derniereAutomatique: avantHier })), /n’a pas tourné depuis le 13-06-2026/);
  });

  test('une génération désactivée (anticipation vide) ne signale rien, même après un échec', () => {
    const echec = passage({ statut: 'ECHEC', erreurs: [{ contratId: 'a' }] });
    assert.equal(alerteGenerationVisites(etat({ anticipation: null, derniere: echec, derniereAutomatique: passage({ jour: jour('2026-01-01') }) })), null);
  });
});

// Lot 6a-2, troisième audit (N3) : les tableaux à chasse fixe des documents (devis, factures) se
// calent sur le texte tel qu'il s'imprime ; un accent à recomposer ou un caractère invisible ne
// décale pas les colonnes.
describe('Lot 6a-2 : colonnes à chasse fixe des documents', () => {
  test('chaque cellule est mesurée telle qu’elle s’imprime ; une valeur trop large garde un séparateur', async () => {
    const { ligneColonnes } = await import('../dist/src/domaines/documents/gabarit.js');
    const largeurs = [10, 8, 6];
    assert.equal(ligneColonnes(['Café', '2 pièce', '1 234'], largeurs), 'Café       2 pièce 1 234');
    assert.equal(ligneColonnes(['Café', '2 pièce', '1 234'], largeurs), 'Café       2 pièce 1 234');
    // Une valeur aussi large que sa colonne garde elle aussi son séparateur.
    assert.equal(ligneColonnes(['A', '12345678', 'x'], largeurs), 'A          12345678     x');
    // Audit n° 4 : une cellule reste sur sa ligne, même avec un saut de ligne saisi (\n, \r, U+2028).
    for (const unite of ['m\nl', 'm\rl', 'm\r\nl', 'm\u2028l']) assert.equal(ligneColonnes(['A', unite, 'x'], largeurs), 'A              m l     x');
  });

  test('le repli d’une désignation se mesure sur le texte imprimé', async () => {
    const { replierTexte } = await import('../dist/src/domaines/documents/gabarit.js');
    // L'espace sans chasse et la marque d'ordre des octets, invisibles, ne coupent pas un mot.
    assert.deepEqual(replierTexte('Café x﻿y co­op', 6), ['Café', 'xy', 'coop']);
    assert.deepEqual(replierTexte('Café noir', 9), ['Café noir']);
    // Audit n° 4 : un retour chariot seul sépare deux mots, comme une fin de ligne Windows.
    assert.deepEqual(replierTexte('10\r20 m', 9), ['10 20 m']);
    assert.deepEqual(replierTexte('10\r\n20 m', 9), ['10 20 m']);
  });

  // Audit n° 18 : toutes les fins de ligne d'un texte sont converties, et non la première seule ;
  // une cellule reste sur sa ligne, quel que soit le nombre de sauts de ligne saisis.
  test('chaque fin de ligne d’un texte est convertie, et non la première seule', async () => {
    const { ligneColonnes, replierTexte, texteWinAnsi } = await import('../dist/src/domaines/documents/gabarit.js');
    assert.equal(texteWinAnsi('10\r20\r30'), '10\n20\n30');
    assert.equal(texteWinAnsi('10\r\n20\r\n30'), '10\n20\n30');
    assert.deepEqual(replierTexte('10\r20\r30 m', 12), ['10 20 30 m']);
    for (const unite of ['m\nl\nk', 'm\r\nl\rk']) assert.equal(ligneColonnes(['A', unite, 'x'], [10, 8, 6]), 'A            m l k     x');
  });

  // Audit n° 5 : chaque équivalent et chaque invisible de la table, un par un, entre deux lettres.
  test('chaque équivalent de même sens et chaque invisible documentés', async () => {
    const { texteWinAnsi } = await import('../dist/src/domaines/documents/gabarit.js');
    const entre = (code) => texteWinAnsi(`a${String.fromCodePoint(code)}b`);
    const espaces = [0x09, ...Array.from({ length: 11 }, (_, rang) => 0x2000 + rang), 0x202f, 0x205f, 0x3000];
    for (const code of espaces) assert.equal(entre(code), 'a b', `U+${code.toString(16)}`);
    for (const code of [0x2010, 0x2011, 0x2012, 0x2212]) assert.equal(entre(code), 'a-b', `U+${code.toString(16)}`);
    assert.equal(entre(0x2264), 'a<=b');
    assert.equal(entre(0x2265), 'a>=b');
    // Même glyphe, même sens (audit n° 5, N2) : 10 μF s'imprime 10 µF, l'apostrophe modificative ’.
    assert.equal(entre(0x03bc), 'a\u00b5b');
    assert.equal(entre(0x02bc), 'a\u2019b');
    // Séparateurs de ligne et de paragraphe, fins de ligne Windows et anciennes : un saut de ligne.
    for (const code of [0x0a, 0x0d, 0x2028, 0x2029]) assert.equal(entre(code), 'a\nb', `U+${code.toString(16)}`);
    assert.equal(texteWinAnsi('a\r\nb'), 'a\nb');
    // Audit n° 6 : le gluon de graphèmes (U+034F), invisible, est le septième caractère retiré.
    for (const code of [0xad, 0x034f, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]) assert.equal(entre(code), 'ab', `U+${code.toString(16)}`);
    // Les autres caractères de mise en forme invisibles deviennent « ? », comme le dit la passation.
    for (const code of [0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2062, 0xfe0f]) assert.equal(entre(code), 'a?b', `U+${code.toString(16)}`);
    assert.equal(texteWinAnsi('©\ufe0f'), '©?');
  });

  // Audit n° 7 : le jeu des polices standard (WinAnsi : ASCII imprimable, Latin-1 et les 27 caractères
  // de la page de code 1252 de 0x80 à 0x9F) s'imprime tel quel, et lui seul. Un caractère retiré du
  // jeu par erreur (–, •, Ÿ, ~, ÿ…) changerait le PDF des factures déjà émises ; un caractère ajouté
  // à tort brouillerait la ligne. Le trait d'union conditionnel (U+00AD) est retiré, comme documenté.
  test('les caractères du jeu WinAnsi s’impriment tels quels, et eux seuls', async () => {
    const { texteWinAnsi } = await import('../dist/src/domaines/documents/gabarit.js');
    const page1252 = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
    const attendus = [0x0a, ...Array.from({ length: 0x5f }, (_, rang) => 0x20 + rang),
      ...Array.from({ length: 0x60 }, (_, rang) => 0xa0 + rang).filter((code) => code !== 0xad),
      ...[...page1252].map((caractere) => caractere.codePointAt(0))].sort((a, b) => a - b);
    assert.equal(new Set(attendus).size, 1 + 95 + 95 + 27);
    const inchanges = [];
    for (let code = 0; code <= 0xffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const caractere = String.fromCodePoint(code);
      if (texteWinAnsi(`a${caractere}b`) === `a${caractere}b`) inchanges.push(code);
    }
    assert.deepEqual(inchanges, attendus);
  });
});

// Audit n° 8 : bornes de la table des remplacements. Une ligature ou une forme pleine chasse aux
// extrémités de leur plage garde ses lettres ; un accent aux extrémités des plages retirées
// s'efface (lettre de base) ; les surimpressions et les barres au-dessus, gardées, deviennent « ? ».
describe('Lot 6a-2 : bornes des remplacements hors WinAnsi', () => {
  test('ligatures, pleine chasse et accents aux bornes de leurs plages', async () => {
    const { texteWinAnsi } = await import('../dist/src/domaines/documents/gabarit.js');
    for (const [saisi, imprime] of [['ﬀ', 'ff'], ['ﬆ', 'st'], ['！', '!'], ['～', '~'], ['｟', '?']]) {
      assert.equal(texteWinAnsi(saisi), imprime, `U+${saisi.codePointAt(0).toString(16)}`);
    }
    // Accent retiré, en forme composée (ā, ă) comme isolée après une lettre sans forme composée.
    assert.equal(texteWinAnsi('āă'), 'aa');
    for (const code of [0x0300, 0x0304, 0x0306, 0x0333, 0x0339, 0x033e, 0x0340, 0x036f]) {
      assert.equal(texteWinAnsi(`x${String.fromCodePoint(code)}`), 'x', `U+${code.toString(16)}`);
    }
    for (const code of [0x0305, 0x0334, 0x0338, 0x033f, 0x0370]) {
      assert.equal(texteWinAnsi(`x${String.fromCodePoint(code)}`), 'x?', `U+${code.toString(16)}`);
    }
  });
});

// Lot #587, volet droits et sécurité (cadrage v2, périmètre 1 et « Tests » : « Tests unitaires de booleenStrict : corps
// undefined, null, tableau ; valeurs chaînes, nombres, objets, null ; clé absente, champ obligatoire puis facultatif »).
// Le lecteur est appelé directement : seuls true et false sont admis ; toute autre valeur présente, null compris
// (lecture de #570), est refusée au message « « <clé> » doit valoir true ou false. » ; la présence est testée par
// Object.hasOwn ; un corps qui n'est pas un objet (Express 5 laisse req.body à undefined sans corps JSON) est lu comme
// vide, sans TypeError ; la clé absente est admise (undefined) pour un champ facultatif et refusée pour un champ
// obligatoire.
const { booleenStrict } = await import('../dist/src/commun/validation.js');
describe('Lot #587 : drapeau d’un corps d’API lu en booléen strict (booleenStrict)', () => {
  const refus = (cle) => ({ ok: false, erreur: `« ${cle} » doit valoir true ou false.` });
  const OPTIONS = [{ obligatoire: true }, { obligatoire: false }];

  test('true et false sont admis tels quels, que le champ soit obligatoire ou facultatif', () => {
    for (const options of OPTIONS) {
      assert.deepEqual(booleenStrict({ actif: true }, 'actif', options), { ok: true, valeur: true });
      assert.deepEqual(booleenStrict({ actif: false }, 'actif', options), { ok: true, valeur: false });
      // Les autres clés du corps n'y changent rien.
      assert.deepEqual(booleenStrict({ actif: false, active: 'x', estCommercial: null }, 'actif', options), { ok: true, valeur: false });
    }
  });

  test('toute autre valeur présente est refusée, null compris, au message qui nomme la clé : chaînes, nombres, objets, tableaux, booléen emballé', () => {
    const valeurs = ['false', 'true', '0', '1', '', 'oui', 0, 1, -1, Number.NaN, null, {}, { valeur: true }, [], [true], [false], new Boolean(false), new Boolean(true), undefined];
    for (const options of OPTIONS) {
      for (const valeur of valeurs) {
        for (const cle of ['actif', 'accesFinance', 'estCommercial', 'active']) {
          assert.deepEqual(booleenStrict({ [cle]: valeur }, cle, options), refus(cle), `${cle} = ${String(valeur)} (${typeof valeur}), ${JSON.stringify(options)}`);
        }
      }
    }
  });

  test('clé absente : refusée pour un champ obligatoire, admise sans valeur (undefined) pour un champ facultatif ; une clé voisine ou héritée ne compte pas', () => {
    const absents = [{}, { active: true }, { Actif: true }, Object.create({ actif: true }), JSON.parse('{"__proto__": {"actif": true}}')];
    for (const corps of absents) {
      assert.deepEqual(booleenStrict(corps, 'actif', { obligatoire: true }), refus('actif'), `obligatoire, ${JSON.stringify(corps)}`);
      assert.deepEqual(booleenStrict(corps, 'actif', { obligatoire: false }), { ok: true, valeur: undefined }, `facultatif, ${JSON.stringify(corps)}`);
    }
  });

  test('corps absent, null, tableau ou scalaire : lu comme un corps vide, sans erreur levée', () => {
    const corpsNonObjets = [undefined, null, [], [true], [{ actif: true }], 'actif', 'true', true, false, 0, 1];
    for (const corps of corpsNonObjets) {
      assert.doesNotThrow(() => booleenStrict(corps, 'actif', { obligatoire: true }), `corps ${JSON.stringify(corps)}`);
      assert.deepEqual(booleenStrict(corps, 'actif', { obligatoire: true }), refus('actif'), `obligatoire, corps ${JSON.stringify(corps)}`);
      assert.deepEqual(booleenStrict(corps, 'actif', { obligatoire: false }), { ok: true, valeur: undefined }, `facultatif, corps ${JSON.stringify(corps)}`);
    }
  });
});

// Lot Z : heures d'une intervention au quart d'heure, zéro compris (réponse de Nelson du 23-11-2026, mot pour mot : « les
// heures sur une intervention Passe au quart d'heure »). Cadrage v2 du lot Z, point 2 et « Tests » (« Unitaire serveur :
// heuresAuQuartDHeure avec et sans zéro (validation.test.mjs, par dist/src/commun/validation.js) ») : la règle du lot W passe dans
// commun/validation.ts avec un second paramètre `zeroAutorise = false`, comme nombreDecimalNonNegatif. Sans lui (heures d'un
// chantier, lot W), zéro reste refusé ; avec lui (heures d'une intervention), zéro est admis ; dans les deux cas, une saisie
// hors du quart d'heure est refusée, jamais arrondie, et la valeur admise est rendue telle que lue. La fonction compilée est
// comparée à la même règle écrite en centièmes entiers (BigInt), sans flottant, sur les saisies à 0, 1 ou 2 décimales, à la
// virgule, au point et en nombre, de 0 à 300 h, autour de 16 384 h (2^14) et de 99 999 900 à 99 999 999 h. Mutants tués
// (cadrage, « Tests ») : contrôle retiré (« 1,1 » admis), zéro refusé avec `zeroAutorise` ou admis sans lui, pas de 0,50 (« 1,25 »
// refusé), arrondi au lieu du refus (« 1,1 » rendu 1), trois décimales admises (« 3,250 »).
describe('Heures au quart d’heure, avec et sans zéro (lots W et Z) : heuresAuQuartDHeure de commun/validation', () => {
  test('témoins : zéro refusé par défaut et admis avec zeroAutorise ; « 1,25 », « 0,75 », « 2,5 » admis tels quels ; « 1,1 », « 0,2 », « 0,05 », « 3,250 », « 123456789 », « -0,25 » refusés, jamais arrondis', async () => {
    const module = await import('../dist/src/commun/validation.js');
    const heuresAuQuartDHeure = module.heuresAuQuartDHeure ?? module.default?.heuresAuQuartDHeure;
    assert.equal(typeof heuresAuQuartDHeure, 'function', 'heuresAuQuartDHeure exportée par commun/validation');
    const zeros = ['0', '0,00', '0.0', '00', 0];
    // Sans zéro (défaut et false explicite) : lecture écartée, zéro admis sur un chantier.
    assert.deepEqual(zeros.map((v) => heuresAuQuartDHeure(v)), zeros.map(() => null), 'zéro refusé par défaut');
    assert.deepEqual(zeros.map((v) => heuresAuQuartDHeure(v, false)), zeros.map(() => null), 'zéro refusé sans zeroAutorise');
    // Avec zéro : lecture écartée, zéro refusé sur une intervention (règle du lot W reprise telle quelle).
    assert.deepEqual(zeros.map((v) => heuresAuQuartDHeure(v, true)), zeros.map(() => 0), 'zéro admis avec zeroAutorise');
    // Quarts admis, rendus tels que lus (lecture écartée : un arrondi qui rendrait une autre valeur), avec ou sans zéro.
    const admises = [['1,25', 1.25], ['0,75', 0.75], ['0,25', 0.25], ['2', 2], ['2,5', 2.5], ['2,50', 2.5], ['3,00', 3], ['1.25', 1.25], [1.25, 1.25], ['99999999,75', 99999999.75], [' 1,25 ', 1.25]];
    for (const zeroAutorise of [false, true]) {
      assert.deepEqual(admises.map(([v]) => heuresAuQuartDHeure(v, zeroAutorise)), admises.map(([, attendu]) => attendu), `quarts admis (zeroAutorise ${zeroAutorise})`);
    }
    // Refusés, avec ou sans zéro : centième et dixième (lecture écartée : arrondi au quart, « 1,1 » rendu 1 ou 1,25 ; « 0,05 »
    // rendu 0 avec zeroAutorise), trois décimales (« 3,250 », « 0,000 »), neuf chiffres, signe, vide, notation scientifique.
    const refusees = ['1,1', '0,2', '1,10', '0,05', '0,01', '0,1', '1,26', '1,24', '2,01', '2,24', '3,250', '0,000', '1,125', '123456789', '-0,25', '', '   ', null, undefined, '1e2', 'abc', 1.1, 0.05, -0.25, Number.NaN];
    for (const zeroAutorise of [false, true]) {
      assert.deepEqual(refusees.map((v) => heuresAuQuartDHeure(v, zeroAutorise)), refusees.map(() => null), `hors du quart d’heure (zeroAutorise ${zeroAutorise})`);
    }
  });

  test('règle exacte sur tout le domaine, avec et sans zéro : heuresAuQuartDHeure comparée à la règle en centièmes entiers, à la virgule, au point et en nombre ; la valeur admise est celle lue', async () => {
    const module = await import('../dist/src/commun/validation.js');
    const heuresAuQuartDHeure = module.heuresAuQuartDHeure ?? module.default?.heuresAuQuartDHeure;
    assert.equal(typeof heuresAuQuartDHeure, 'function');
    const exacte = (texte, zeroAutorise) => {
      const lu = /^(\d{1,8})(?:[,.](\d{1,2}))?$/.exec(texte);
      if (!lu) return false;
      const centiemes = BigInt(lu[1]) * 100n + BigInt((lu[2] ?? '').padEnd(2, '0'));
      return (centiemes > 0n || zeroAutorise) && centiemes % 25n === 0n;
    };
    const ecarts = [];
    let saisies = 0;
    const comparer = (valeur, texte) => {
      for (const zeroAutorise of [false, true]) {
        saisies += 1;
        const rendu = heuresAuQuartDHeure(valeur, zeroAutorise);
        const attendu = exacte(texte, zeroAutorise) ? Number(texte.replace(',', '.')) : null;
        if (rendu !== attendu && ecarts.length < 10) ecarts.push(`${typeof valeur === 'number' ? `${texte} en nombre` : `« ${texte} »`} (zeroAutorise ${zeroAutorise}) : ${rendu} au lieu de ${attendu}`);
      }
    };
    const fractions = [...Array.from({ length: 10 }, (_, i) => String(i)), ...Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'))];
    const entiers = [
      ...Array.from({ length: 301 }, (_, i) => i),
      ...Array.from({ length: 21 }, (_, i) => 16_374 + i),
      ...Array.from({ length: 100 }, (_, i) => 99_999_900 + i),
    ];
    for (const entier of entiers) {
      comparer(String(entier), String(entier));
      for (const fraction of fractions) {
        for (const separateur of [',', '.']) comparer(`${entier}${separateur}${fraction}`, `${entier}${separateur}${fraction}`);
        const nombre = Number(`${entier}.${fraction}`);
        comparer(nombre, String(nombre));
      }
    }
    assert.deepEqual(ecarts, [], `écarts entre le serveur et la règle exacte (${saisies} saisies)`);
  });
});

// Lot AB : coût de la main-d'œuvre arrondi au centime ligne par ligne, partout (réponse de Nelson du 24-11-2026, point 2, mot
// pour mot : « Arrindir chaque ligne » ; cadrage v2 du lot AB, points 1 et 2, lectures L1 et L2 ; « Tests » : « Aucun test
// unitaire ne sépare aujourd'hui les deux conventions : en ajouter un »). La fonction commune de commun/montants.ts, compilée,
// est appelée directement, puis computeChantierMetrics sur ses trois boucles et totalHeuresInterventionAuCentime, qui la reprend
// sans changer ses résultats. Montants, classés C : chaque attendu écrit la lecture qu'il écarte. Les requêtes HTTP du lot sont
// jouées dans arrondi-main-oeuvre.test.mjs.
const { coutLigneHeuresAuCentime, coutLigneHeures } = await import('../dist/src/commun/montants.js');
const { totalHeuresInterventionAuCentime } = await import('../dist/src/domaines/interventions/metier.js');
const { Prisma: PrismaLotAB } = await import('@prisma/client');

describe('Lot AB : coût d’une ligne de main-d’œuvre arrondi au centime, moitié vers le haut, avant toute somme', () => {
  // Jeu du cadrage v2 : 3,25 h et 0,25 h à 37,85 €/h, puis trois fois 0,25 h à 10,02 €/h. Attendu 140,00 € (123,01 + 9,46 +
  // 3 × 2,51). Lectures écartées : somme exacte, arrondie ou tronquée, 139,99 € ; arrondi au pair, troncature ou moitié vers le
  // bas par ligne, 139,97 € ; arrondi par excès par ligne, 140,02 €.
  const JEU = [[3.25, 37.85], [0.25, 37.85], [0.25, 10.02], [0.25, 10.02], [0.25, 10.02]];
  const lignes = (ordre) => ordre.map(([nbrHeures, tauxHoraireApplique]) => ({ nbrHeures, tauxHoraireApplique }));

  test('coût d’une ligne : heures × taux en décimal exact, arrondi au centime moitié vers le haut (lecture L1), en nombre comme en décimal', () => {
    const CAS = [
      // [heures, taux, attendu] ; lecture écartée en commentaire.
      [3.25, 37.85, 123.01], // produit exact 123,0125 (avant le lot) ; arrondi par excès 123,02
      [0.25, 37.85, 9.46], // produit exact 9,4625 ; arrondi par excès 9,47
      [0.25, 10.02, 2.51], // produit exact 2,505 ; au pair, troncature ou moitié vers le bas 2,50 ; toFixed(2) 2,50
      [0.5, 0.01, 0.01], // lecture L1, « 0,005 € donne 0,01 € » ; au pair ou troncature 0,00
      [2.5, 0.41, 1.03], // produit exact 1,025 ; Math.round(h × t × 100) / 100 en flottant 1,02 (1,025 vaut 1,02499… en binaire) ; au pair 1,02
      [0.75, 30.9, 23.18], // produit exact 23,175 ; en flottant 23,174999…, que donnent 23,17 aussi bien Math.round(h × t × 100) / 100 que centimes(h × t) (Number.EPSILON n'y suffit pas) ou un décimal construit sur le produit flottant ; au pair 23,18
      [99999999.25, 0.02, 1999999.99], // borne des heures (Decimal(10, 2)) : produit exact 1 999 999,985 ; au pair ou troncature 1 999 999,98
      [1.1, 1.1, 1.21], // produit flottant 1,2100000000000002
      [0.75, 40, 30], // sans reste : aucun arrondi
      [0, 37.85, 0], // zéro heure, admis avec son motif sur une intervention (lot Z)
    ];
    for (const [heures, taux, attendu] of CAS) {
      assert.equal(coutLigneHeures(heures, taux), attendu, `${heures} h × ${taux} € en nombres`);
      const enDecimal = coutLigneHeuresAuCentime(new PrismaLotAB.Decimal(String(heures)), new PrismaLotAB.Decimal(String(taux)));
      assert.ok(PrismaLotAB.Decimal.isDecimal(enDecimal), 'rend un décimal');
      assert.equal(enDecimal.toString(), String(attendu), `${heures} h × ${taux} € en décimaux`);
      assert.equal(coutLigneHeuresAuCentime(String(heures), String(taux)).toString(), String(attendu), `${heures} h × ${taux} € en chaînes`);
    }
    // Les durées ne sont jamais arrondies (#253, point 2) : seul le produit l'est. Lecture écartée : 0,25 h arrondie à l'heure
    // (0 €) ou à la demi-heure (5,01 €).
    assert.deepEqual(JEU.map(([heures, taux]) => coutLigneHeures(heures, taux)), [123.01, 9.46, 2.51, 2.51, 2.51]);
  });

  test('computeChantierMetrics : le jeu du cadrage coûte 140,00 € dans chacune des trois boucles, pointages, intervention issue du devis et suites, quel que soit l’ordre des lignes (#198)', () => {
    const params = { margeCommercialeActive: true, planningActif: true };
    const base = { budgetGlobalVendu: 1000, budgetMaterielVendu: 0, budgetMainOeuvreVendu: 140, heuresVendues: 10, achats: [] };
    for (const ordre of [JEU, [...JEU].reverse(), [JEU[2], JEU[0], JEU[3], JEU[1], JEU[4]]]) {
      const quoi = ordre.map(([h, t]) => `${h} h à ${t} €`).join(', ');
      // Pointages : main-d'œuvre, dépenses et coût horaire du chantier sur 140,00 € ; budget de main-d'œuvre de 140 € consommé à
      // 100 %, non dépassé (lecture écartée : l'arrondi par excès, 140,02 €, le dépasserait) ; marge 860,00 € (lectures écartées :
      // 860,01 €, 860,03 €, 859,98 €).
      const pointages = computeChantierMetrics({ ...base, pointages: lignes(ordre) }, params, true);
      assert.deepEqual([pointages.heuresRealisees, pointages.moReel, pointages.totalDepenses, pointages.margeCommerciale, pointages.pctMainOeuvre], [4.25, 140, 140, 860, 100], `pointages : ${quoi}`);
      assert.equal(pointages.alertes.includes('MAIN_OEUVRE_DEPASSEE'), false, `pointages : ${quoi}`);
      // Intervention issue du devis : compte comme le travail du chantier (heures réalisées comprises).
      const devis = computeChantierMetrics({ ...base, pointages: [], coutsInterventionDevis: { heures: lignes(ordre), achats: [] } }, params, true);
      assert.deepEqual([devis.heuresRealisees, devis.moReel, devis.margeCommerciale, devis.coutsInterventionDevis], [4.25, 140, 860, { heures: 4.25, coutMainOeuvre: 140, materiel: 0 }], `intervention du devis : ${quoi}`);
      // Suites : leurs heures restent hors des heures réalisées (décision du 27-10-2026).
      const suites = computeChantierMetrics({ ...base, pointages: [], coutsSuites: { heures: lignes(ordre), achats: [] } }, params, true);
      assert.deepEqual([suites.heuresRealisees, suites.moReel, suites.margeCommerciale, suites.coutsSuites], [0, 140, 860, { heures: 4.25, coutMainOeuvre: 140, materiel: 0 }], `suites : ${quoi}`);
    }
    // Les trois boucles ensemble : 420,00 €, marge 580,00 €. Lectures écartées : 419,97 € (somme exacte, avant le lot) ; 419,98 €
    // ou 419,99 € (une ou deux boucles seulement arrondies par ligne) ; 419,91 € (au pair, troncature) ; 420,06 € (excès).
    const ensemble = computeChantierMetrics({ ...base, pointages: lignes(JEU), coutsInterventionDevis: { heures: lignes(JEU), achats: [] }, coutsSuites: { heures: lignes(JEU), achats: [] } }, params, true);
    assert.deepEqual([ensemble.heuresRealisees, ensemble.moReel, ensemble.margeCommerciale, ensemble.coutsInterventionDevis.coutMainOeuvre, ensemble.coutsSuites.coutMainOeuvre], [8.5, 420, 580, 140, 140]);
    // Budget de main-d'œuvre de 139,99 € : dépassé par 140,00 €. Lecture écartée : la somme exacte, 139,99 €, ne le dépasse pas.
    const depasse = computeChantierMetrics({ ...base, budgetMainOeuvreVendu: 139.99, pointages: lignes(JEU) }, params, true);
    assert.equal(depasse.alertes.includes('MAIN_OEUVRE_DEPASSEE'), true);
    // Exemple de Nelson, 3,25 h et 0,25 h à 37,85 € : 132,47 € (lecture écartée : 132,475 €, puis 132,48 € à l'affichage), et
    // pour un vendu de 132,47 €, marge 0 sans EN_PERTE (lecture écartée : -0,005 € et EN_PERTE).
    const nelson = computeChantierMetrics({ ...base, budgetGlobalVendu: 132.47, pointages: lignes(JEU.slice(0, 2)) }, params, true);
    assert.deepEqual([nelson.moReel, nelson.margeCommerciale, nelson.alertes.includes('EN_PERTE')], [132.47, 0, false]);
  });

  test('totalHeuresInterventionAuCentime reprend la fonction commune sans changer ses résultats : main-d’œuvre cumulée égale à la somme des lignes arrondies', () => {
    const D = PrismaLotAB.Decimal;
    const enDecimaux = (jeu) => jeu.map(([h, t]) => ({ nbrHeures: new D(String(h)), tauxHoraireApplique: new D(String(t)) }));
    // Jeu du cadrage : 140,00 € (lectures écartées : 139,99 €, 139,97 €, 140,02 €), égal à la somme des coûts de ligne.
    assert.equal(totalHeuresInterventionAuCentime(enDecimaux(JEU)).toString(), '140');
    assert.equal(JEU.reduce((total, [h, t]) => total.plus(coutLigneHeuresAuCentime(h, t)), new D(0)).toString(), '140');
    // Valeurs du lot Z, inchangées : 1,25 h, 2,25 h et 0 h à 37,85 € font 132,47 € ; 1,1 h à 37,85 € fait 41,64 € (41,635 €).
    assert.equal(totalHeuresInterventionAuCentime(enDecimaux([[1.25, 37.85], [2.25, 37.85], [0, 37.85]])).toString(), '132.47');
    assert.equal(totalHeuresInterventionAuCentime(enDecimaux([[1.1, 37.85]])).toString(), '41.64');
    assert.equal(totalHeuresInterventionAuCentime([]).toString(), '0');
  });
});
