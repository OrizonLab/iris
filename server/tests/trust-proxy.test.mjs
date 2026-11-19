// Correctif « sécurité de la connexion », #261 : proxys de confiance (cadrage v2, section « 1. #261 — proxys de
// confiance » et « Tests (redacteur-tests) » ; décision de Nelson du 16-11-2026, « Maintenant (Recommandé) »).
//
// Derrière Nginx Proxy Manager puis le nginx du frontend, Express ne réglait jamais `trust proxy` : `req.ip` valait
// l'adresse du nginx du frontend pour tous les clients, si bien que cinq essais manqués de l'accès de secours, venus
// de n'importe qui, le bloquaient pour tout le monde pendant quinze minutes. TRUST_PROXY, lue dans server/.env après
// dotenv, donne le nombre entier de proxys de confiance, de 0 à 5 ; absente ou vide, elle vaut 0 (aucun proxy,
// comportement d'avant ; choix par défaut, à confirmer). Toute autre valeur (texte, négatif, décimal, liste
// d'adresses, `true`) refuse le démarrage, avant toute écoute et toute base (« Configuration refusée », code 1,
// sans recopier la valeur), comme MICROSOFT_GRAPH_URL.
//
// Aucun de ces tests n'a besoin de base : le refus de configuration arrive avant l'écoute, et un jeton de secours
// faux est refusé (401) ou bloqué (429) avant toute lecture en base (domaines/authentification/routes.ts). Chaque
// valeur est jouée dans son propre processus, la variable étant lue une fois au chargement : par `spawnSync` du
// serveur compilé pour le démarrage, par un processus qui charge l'application (`require`) et l'écoute sur un port
// libre pour la limite par client. Chaque processus tourne dans un dossier vide : un server/.env du poste, lu par
// dotenv dans le dossier courant, ne fausse pas la valeur jouée.
//
// Deux proxys simulés : la requête arrive au backend depuis 127.0.0.1, qui tient le rôle du nginx du frontend, avec
// l'en-tête X-Forwarded-For qu'aurait reçu le backend en production : `<en-tête du client>, <client>, <proxy 1>`.
// Nginx Proxy Manager (proxy 1) ajoute l'adresse du client à l'en-tête que le client a lui-même envoyé, puis le
// nginx du frontend ajoute celle de Nginx Proxy Manager (`$proxy_add_x_forwarded_for`). Avec TRUST_PROXY=2, Express
// fait confiance à la connexion (nginx du frontend) et à la dernière entrée (Nginx Proxy Manager) : l'adresse
// retenue est l'avant-dernière, celle que Nginx Proxy Manager a vue. Ce que le client écrit devant ne compte pas.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const INDEX = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const BASE_INJOIGNABLE = 'postgresql://iris:iris@127.0.0.1:1/iris_injoignable?schema=public&connect_timeout=5';
const JETON_SECOURS = 'jeton-de-secours-de-test-trust-proxy-au-moins-32-caracteres';

// Dossiers courants des processus lancés : un vide, et un qui ne porte qu'un .env avec TRUST_PROXY=2.
const dossierVide = mkdtempSync(join(tmpdir(), 'iris-trust-proxy-vide-'));
const dossierAvecEnv = mkdtempSync(join(tmpdir(), 'iris-trust-proxy-env-'));
writeFileSync(join(dossierAvecEnv, '.env'), 'TRUST_PROXY=2\n');
after(() => {
  rmSync(dossierVide, { recursive: true, force: true });
  rmSync(dossierAvecEnv, { recursive: true, force: true });
});

// Environnement d'un processus lancé : celui du test, sans TRUST_PROXY ni réglage qui interférerait (une adresse
// Microsoft Graph refusée serait signalée avant TRUST_PROXY, la connexion Microsoft ne sert pas ici), base
// injoignable, aucun compte de départ. `trustProxy` undefined : variable absente.
function environnement(trustProxy, extra = {}) {
  const env = { ...process.env };
  for (const nom of ['TRUST_PROXY', 'MICROSOFT_GRAPH_URL', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'BREAK_GLASS_EMAIL', 'BREAK_GLASS_TOKEN']) delete env[nom];
  Object.assign(env, {
    PORT: '0', SUPERADMIN_EMAILS: '', DATABASE_URL: BASE_INJOIGNABLE, NODE_ENV: 'test', JWT_SECRET: 'secret-de-test-trust-proxy',
    GENERATION_VISITES_AUTOMATIQUE: '0', ...extra,
  });
  if (trustProxy !== undefined) env.TRUST_PROXY = trustProxy;
  return env;
}

// Lance le serveur compilé comme en production (`node dist/index.js`) et rend sa sortie.
function demarrer(trustProxy) {
  const sortie = spawnSync(process.execPath, [INDEX], { env: environnement(trustProxy), cwd: dossierVide, encoding: 'utf8', timeout: 60_000 });
  assert.equal(sortie.error, undefined, `processus non lancé ou hors délai : ${sortie.error}`);
  return sortie;
}

const echapper = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// --- Démarrage ---

describe('#261 : TRUST_PROXY au démarrage', { timeout: 300_000 }, () => {
  // Cadrage : « Toute autre valeur (texte, négatif, décimal, liste d'adresses, `true`) refuse le démarrage
  // (« Configuration refusée », code 1, sans recopier la valeur) » ; « rendu par verifierConfigurationDemarrage avant
  // toute écoute et toute base ». `loopback`, `false`, la liste et `true` sont des valeurs qu'Express accepterait
  // telles quelles : elles écartent un code qui passerait la variable à `app.set` sans la contrôler. `6` écarte une
  // borne haute absente ou fixée au-delà de 5 ; `-1` un contrôle « nombre » sans signe ; `1.5` une lecture par
  // `parseInt` (qui donnerait 1).
  const REFUSEES = [
    ['texte (préréglage d’Express)', 'loopback'],
    ['texte « false »', 'false'],
    ['négatif', '-1'],
    ['décimal', '1.5'],
    ['au-delà de 5', '6'],
    ['liste d’adresses', '10.0.0.1,10.0.0.2'],
    ['true', 'true'],
  ];
  for (const [quoi, valeur] of REFUSEES) {
    test(`TRUST_PROXY ${quoi} (« ${valeur} ») : démarrage refusé, code 1, avant toute écoute et toute base, sans recopier la valeur`, () => {
      const sortie = demarrer(valeur);
      assert.equal(sortie.status, 1, `sortie : ${sortie.status} ${sortie.signal}\n${sortie.stderr}`);
      assert.match(sortie.stderr, /\[DÉMARRAGE\] Configuration refusée/, sortie.stderr);
      assert.match(sortie.stderr, /TRUST_PROXY/, 'le message nomme la variable à corriger');
      // Avant toute écoute et toute base : l'initialisation (qui suit l'écoute et lit la base, ici injoignable) n'a
      // pas commencé.
      assert.doesNotMatch(sortie.stderr, /Initialisation impossible/, sortie.stderr);
      assert.doesNotMatch(sortie.stdout, /Server running/);
      // Sans recopier la valeur refusée, ni dans la sortie d'erreur, ni dans la sortie standard. La ligne que dotenv
      // écrit à son chargement (« injected env … // tip: … ») est écartée : son conseil, tiré au hasard, peut
      // contenir `true` sans rien devoir à la valeur jouée.
      const recopie = new RegExp(`(^|[^0-9A-Za-z.])${echapper(valeur)}($|[^0-9A-Za-z.])`);
      const sansDotenv = (texte) => texte.split('\n').filter((ligne) => !/inject(ed|ing) env/.test(ligne)).join('\n');
      assert.doesNotMatch(sansDotenv(sortie.stderr), recopie, 'la valeur refusée n’est pas recopiée');
      assert.doesNotMatch(sansDotenv(sortie.stdout), recopie, 'la valeur refusée n’est pas recopiée');
    });
  }

  // Cadrage : « Absente ou vide : 0 » ; valeurs admises « de 0 à 5 ». Le serveur passe le contrôle de configuration,
  // écoute, puis s'arrête sur la base injoignable (« Initialisation impossible », #231) : c'est la preuve qu'il a
  // dépassé le contrôle. La valeur vide écarte un code qui la refuserait (mutant « valeur vide refusée ») ; 5 écarte
  // une borne haute trop basse.
  const ADMISES = [
    ['absente', undefined],
    ['vide', ''],
    ['0', '0'],
    ['1', '1'],
    ['2 (chaîne de production de #261)', '2'],
    ['5 (borne haute)', '5'],
  ];
  for (const [quoi, valeur] of ADMISES) {
    test(`TRUST_PROXY ${quoi} : configuration admise, le serveur va jusqu’à l’initialisation de la base`, () => {
      const sortie = demarrer(valeur);
      assert.doesNotMatch(sortie.stderr, /Configuration refusée/, sortie.stderr);
      assert.match(sortie.stderr, /\[DÉMARRAGE\] Initialisation impossible/, `le serveur a écouté puis lu la base, injoignable ici :\n${sortie.stderr}`);
      assert.equal(sortie.status, 1);
    });
  }
});

// --- Limite de l'accès de secours par client ---

const PROXY_1 = '172.18.0.2'; // Nginx Proxy Manager, tel que le voit le nginx du frontend (réseau Docker).
const CLIENT_A = '198.51.100.10';
const CLIENT_B = '198.51.100.20';
const FORGEE = (i) => `203.0.113.${i}`; // adresses écrites par le client lui-même dans X-Forwarded-For.

// Les essais, dans l'ordre, avec l'en-tête X-Forwarded-For que reçoit le backend derrière les deux proxys.
const ESSAIS = [
  // 1 à 5 : le client A manque cinq fois le jeton, en forgeant chaque fois une autre adresse devant la sienne.
  ...[1, 2, 3, 4, 5].map((i) => ({ quoi: `A, essai ${i}, en-tête forgé ${FORGEE(i)}`, xff: `${FORGEE(i)}, ${CLIENT_A}, ${PROXY_1}` })),
  // 6 : sixième essai de A, avec une adresse forgée encore jamais vue.
  { quoi: 'A, essai 6, nouvelle adresse forgée', xff: `${FORGEE(6)}, ${CLIENT_A}, ${PROXY_1}` },
  // 7 : A sans rien forger.
  { quoi: 'A, essai 7, sans en-tête forgé', xff: `${CLIENT_A}, ${PROXY_1}` },
  // 8 : le client B, sans rien forger.
  { quoi: 'B, essai 1', xff: `${CLIENT_B}, ${PROXY_1}` },
  // 9 : B forge l'adresse de A devant la sienne.
  { quoi: 'B, essai 2, adresse de A forgée', xff: `${CLIENT_A}, ${CLIENT_B}, ${PROXY_1}` },
];

// Script du processus : charge l'application (sans le lancer comme programme principal, comme les tests HTTP),
// l'écoute sur un port libre, joue les essais un à un et écrit leurs statuts sur une ligne repérée. Les en-têtes
// des essais y sont écrits en constante, et non passés par une variable d'environnement que
// environnement.test.mjs exigerait de documenter.
const SCRIPT = `
const http = require('node:http');
const { app } = require(${JSON.stringify(INDEX)});
const essais = ${JSON.stringify(ESSAIS.map((e) => e.xff))};
const serveur = app.listen(0, '127.0.0.1', async () => {
  const port = serveur.address().port;
  const statuts = [];
  for (const xff of essais) {
    statuts.push(await new Promise((resolve, reject) => {
      const requete = http.request({ host: '127.0.0.1', port, path: '/api/auth/secours', method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': xff } }, (reponse) => {
        reponse.resume();
        reponse.on('end', () => resolve(reponse.statusCode));
      });
      requete.on('error', reject);
      requete.end(JSON.stringify({ token: 'jeton-de-secours-faux' }));
    }));
  }
  console.log('STATUTS_SECOURS ' + JSON.stringify(statuts));
  process.exit(0);
});`;

function jouerEssais({ trustProxy, cwd = dossierVide }) {
  const sortie = spawnSync(process.execPath, ['-e', SCRIPT], {
    env: environnement(trustProxy, { BREAK_GLASS_EMAIL: 'secours-trust-proxy@iris.test', BREAK_GLASS_TOKEN: JETON_SECOURS }),
    cwd, encoding: 'utf8', timeout: 60_000,
  });
  assert.equal(sortie.error, undefined, `processus non lancé ou hors délai : ${sortie.error}`);
  assert.equal(sortie.status, 0, `sortie : ${sortie.status}\n${sortie.stderr}`);
  const ligne = sortie.stdout.split('\n').find((l) => l.startsWith('STATUTS_SECOURS '));
  assert.ok(ligne, sortie.stdout);
  const statuts = JSON.parse(ligne.slice('STATUTS_SECOURS '.length));
  // Adresses écrites dans les journaux du conteneur, dans l'ordre : refus du jeton, puis blocages. Depuis #589 (cadrage
  // v2, C1), seul le premier essai bloqué d'une adresse dans sa fenêtre écrit la ligne de blocage : une ligne par adresse
  // et par fenêtre (choix par défaut, à confirmer). Les assertions sur `bloquees` en sont la preuve HTTP, en processus
  // séparé.
  const refusees = [...sortie.stderr.matchAll(/\[SECOURS\] Tentative d'accès de secours REFUSÉE depuis (\S+)\.\n/g)].map((m) => m[1]);
  const bloquees = [...sortie.stderr.matchAll(/\[SECOURS\] Trop de tentatives depuis (\S+) — blocage temporaire\./g)].map((m) => m[1]);
  return { statuts, refusees, bloquees, stderr: sortie.stderr };
}

const parEssai = (statuts) => ESSAIS.map((e, i) => `${e.quoi} : ${statuts[i]}`);

describe('#261 : limite de l’accès de secours par client derrière deux proxys', { timeout: 120_000 }, () => {
  // Critère observable : « Avec TRUST_PROXY=2 et deux proxys simulés, cinq essais de secours manqués d'un client ne
  // bloquent pas un autre client, et un X-Forwarded-For forgé par le client ne change pas l'adresse retenue. »
  // Lectures écartées : `true` (mutant), qui retiendrait l'adresse forgée de gauche (l'essai 6, nouvelle adresse,
  // répondrait 401) ; 3 ou plus, qui retiendrait aussi l'adresse forgée (essai 6 à 401, et B, qui forge A, serait
  // bloqué à l'essai 9) ; 1, qui retiendrait Nginx Proxy Manager pour tous (B bloqué à l'essai 8) ; 0, qui retiendrait
  // la connexion pour tous (B bloqué).
  test('TRUST_PROXY=2 : le client A est bloqué au sixième essai quelle que soit l’adresse qu’il forge, le client B ne l’est pas, même en forgeant l’adresse de A, et les journaux portent l’adresse de chaque client', () => {
    const { statuts, refusees, bloquees, stderr } = jouerEssais({ trustProxy: '2' });
    assert.deepEqual(parEssai(statuts), parEssai([401, 401, 401, 401, 401, 429, 429, 401, 401]));
    // Cadrage : « Les journaux [SECOURS] … depuis <ip> portent alors l'adresse du client. » #589 : les essais 6 et 7 de A
    // sont bloqués (429), mais seul le premier, l'essai 6, est tracé (lecture écartée : une ligne par essai bloqué,
    // comportement d'avant #589).
    assert.deepEqual(refusees, [CLIENT_A, CLIENT_A, CLIENT_A, CLIENT_A, CLIENT_A, CLIENT_B, CLIENT_B]);
    assert.deepEqual(bloquees, [CLIENT_A]);
    assert.doesNotMatch(stderr, /depuis 203\.0\.113\./, 'aucune adresse forgée n’est retenue');
    assert.doesNotMatch(stderr, new RegExp(`depuis ${echapper(PROXY_1)}`), 'l’adresse du premier proxy n’est pas retenue');
    assert.doesNotMatch(stderr, /depuis (::ffff:)?127\.0\.0\.1/, 'l’adresse du nginx du frontend n’est pas retenue');
  });

  // Cadrage : « Absente ou vide : 0 (aucun proxy, comportement actuel, sûr) » ; « TRUST_PROXY absent, vide ou 0 garde
  // le comportement actuel ». Tous les essais comptent pour l'adresse de la connexion (127.0.0.1, le nginx du
  // frontend), quel que soit X-Forwarded-For : B est bloqué par les essais de A. Ce test écarte un défaut à 2 (mutant
  // « défaut à 2 »), sous lequel B passerait, et une valeur vide lue comme autre chose que 0.
  for (const [quoi, trustProxy] of [['absente', undefined], ['vide', ''], ['0', '0']]) {
    test(`TRUST_PROXY ${quoi} : comportement d’avant, tous les essais comptent pour l’adresse de la connexion et B est bloqué par les essais de A`, () => {
      const { statuts, refusees, bloquees } = jouerEssais({ trustProxy });
      assert.deepEqual(parEssai(statuts), parEssai([401, 401, 401, 401, 401, 429, 429, 429, 429]));
      assert.equal(refusees.length, 5);
      // #589 : quatre essais bloqués (6 à 9) pour la même adresse, dans la même fenêtre : une seule ligne de blocage
      // (lecture écartée : quatre lignes, comportement d'avant #589).
      assert.equal(bloquees.length, 1);
      for (const adresse of [...refusees, ...bloquees]) assert.match(adresse, /^(::ffff:)?127\.0\.0\.1$/, `adresse retenue : ${adresse}`);
    });
  }

  // Cadrage : « Nouvelle variable d'environnement TRUST_PROXY, lue par le backend depuis une seule source :
  // server/.env » ; « app.set('trust proxy', n) lu une fois au chargement, après dotenv ». La variable n'est pas dans
  // l'environnement du processus, seulement dans le .env de son dossier courant, que dotenv lit au chargement. Une
  // lecture faite avant dotenv (mutant) la verrait absente, donc 0 : B serait bloqué.
  test('TRUST_PROXY=2 écrite seulement dans le .env du dossier courant : lue après dotenv, elle règle la limite par client', () => {
    const { statuts, refusees, bloquees } = jouerEssais({ trustProxy: undefined, cwd: dossierAvecEnv });
    assert.deepEqual(parEssai(statuts), parEssai([401, 401, 401, 401, 401, 429, 429, 401, 401]));
    assert.deepEqual(refusees, [CLIENT_A, CLIENT_A, CLIENT_A, CLIENT_A, CLIENT_A, CLIENT_B, CLIENT_B]);
    assert.deepEqual(bloquees, [CLIENT_A], '#589 : une seule ligne de blocage pour A dans sa fenêtre');
  });
});
