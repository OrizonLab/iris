// Tests du périmètre et de la synthèse de la CI (.github/scripts/perimetre-ci.mjs).
//
// Lot « consommation de la CI ». Décision de Nelson du 14-11-2026, mot pour mot : « Réduis sa consommation sans
// affaiblir les contrôles. Ne lance pas les travaux lourds quand une PR ne touche que de la documentation, en gardant
// un statut vert pour la fusion. » Les repères (R1, R1', R2, R3, C2, C3, N1, N3, N4, N5, N10, N14, N16, T1) renvoient
// au cadrage du lot, version 2, accepté par le contrôle de cohérence.
//
// Lancé en tête du travail « Périmètre des changements » (`node --test .github/scripts/perimetre-ci.test.mjs`), sous
// Node 20, sans dépendance. Trois niveaux :
//   - les fonctions pures exportées par le script ;
//   - le workflow, lu en texte (sans analyseur YAML) ;
//   - le script lui-même, lancé dans des dépôts git temporaires avec une fausse API GitHub chargée avant lui
//     (`--import`) : aucun appel réseau, et un environnement reconstruit à neuf, pour ne jamais écrire dans les sorties
//     du vrai travail de la CI.
// git est requis (il l'est déjà par actions/checkout) : son absence fait échouer ces tests, elle ne les saute pas.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  TRAVAUX_LOURDS,
  WORKFLOW,
  arbreAtteste,
  cheminsDeDiff,
  decider,
  documentationSeule,
  doitAttester,
  estDocumentation,
  sortiesCoherentes,
  toucheLeWorkflow,
  verdictSynthese,
} from './perimetre-ci.mjs';

const SCRIPT = fileURLToPath(new URL('./perimetre-ci.mjs', import.meta.url));
const CI_YML = fileURLToPath(new URL('../workflows/ci.yml', import.meta.url));
// Écrits en dur, et non repris du script : un travail oublié dans TRAVAUX_LOURDS ou un chemin de workflow modifié doit
// faire échouer ces tests.
const LOURDS = ['compose', 'backend', 'tests', 'frontend', 'parcours'];
const CHEMIN_WORKFLOW = '.github/workflows/ci.yml';

describe('CI — constantes du périmètre', () => {
  it('les cinq travaux lourds sont compose, backend, tests, frontend et parcours, et seul ci.yml atteste un arbre', () => {
    assert.deepEqual(TRAVAUX_LOURDS, LOURDS);
    assert.equal(WORKFLOW, CHEMIN_WORKFLOW);
  });
});

// Cadrage, périmètre point 1 : « chaque fichier changé est sous docs/, ou un fichier *.md, ou LICENSE, hors
// client/src/ et client/public/ (fichiers livrés par Vite, N3) ».
describe('CI — ce qui compte comme documentation', () => {
  const documentation = [
    'docs/x.md',
    'docs/sous/x.pdf',
    'README.md',
    'server/src/README.md',
    '.claude/agents/x.md',
    'LICENSE',
  ];
  const pasDocumentation = [
    // Prisma tient tout dossier de migrations/ pour une migration : un dossier qui ne porte qu'un README.md fait
    // échouer `prisma migrate deploy` (P3015). Audit droits et sécurité de #546, R1.
    'server/prisma/migrations/x/README.md',
    'server/prisma/migrations/20261120000000_note_seule/README.md',
    'server/prisma/README.md',
    'client/src/x.md',
    'client/src/sous/dossier/x.md',
    'client/public/x.md',
    'client/public/docs/x.md',
    'server/index.ts',
    '.github/workflows/ci.yml',
    'LICENSE.txt',
    'docs',
  ];
  for (const chemin of documentation) {
    it(`« ${chemin} » est de la documentation`, () => {
      assert.equal(estDocumentation(chemin), true);
      assert.equal(documentationSeule([chemin]), true);
    });
  }
  for (const chemin of pasDocumentation) {
    it(`« ${chemin} » n'est pas de la documentation`, () => {
      assert.equal(estDocumentation(chemin), false);
      assert.equal(documentationSeule([chemin]), false);
    });
  }
  it('une liste vide n\'est jamais « documentation seule » (diff impossible : série complète)', () => {
    assert.equal(documentationSeule([]), false);
  });
  it('une liste qui mêle documentation et code n\'est pas « documentation seule »', () => {
    assert.equal(documentationSeule(['docs/x.md', 'server/index.ts']), false);
    assert.equal(documentationSeule(['README.md', 'client/src/x.md']), false);
    assert.equal(documentationSeule(['server/index.ts', 'docs/x.md']), false);
  });
  it('une liste entièrement documentaire est « documentation seule »', () => {
    assert.equal(documentationSeule(documentation), true);
  });
  // R3 : `--no-renames` liste l'ancien et le nouveau chemin d'un renommage.
  it('un fichier de code renommé en .md compte pour ses deux chemins : ce n\'est pas de la documentation seule', () => {
    assert.equal(documentationSeule(['server/code.ts', 'docs/code.md']), false);
  });
});

// C2 : le dédoublonnage est refusé dès que before..HEAD touche .github/**.
describe('CI — fichiers du workflow touchés', () => {
  it('tout fichier sous .github/ touche le workflow', () => {
    assert.equal(toucheLeWorkflow(['.github/workflows/ci.yml']), true);
    assert.equal(toucheLeWorkflow(['docs/x.md', '.github/scripts/perimetre-ci.mjs']), true);
  });
  it('un chemin qui ne commence pas par .github/ ne touche pas le workflow', () => {
    assert.equal(toucheLeWorkflow([]), false);
    assert.equal(toucheLeWorkflow(['docs/.github/x.md', '.githubx/y.yml', 'server/index.ts']), false);
  });
});

// Cadrage, périmètre point 1 : fichiers changés par `git diff --no-renames --name-only -z`.
describe('CI — lecture de la sortie -z de git diff', () => {
  it('sépare les chemins sur NUL sans toucher aux espaces, guillemets ni accents, NUL final compris', () => {
    const sortie = 'docs/a b.md\0docs/"cité".md\0docs/accentué é/x.md\0';
    assert.deepEqual(cheminsDeDiff(sortie), ['docs/a b.md', 'docs/"cité".md', 'docs/accentué é/x.md']);
  });
  it('lit aussi une sortie sans NUL final, et ne coupe pas un chemin qui contient un saut de ligne', () => {
    assert.deepEqual(cheminsDeDiff('docs/a.md\0server/b.ts'), ['docs/a.md', 'server/b.ts']);
    assert.deepEqual(cheminsDeDiff('docs/ligne\nsuite.md\0'), ['docs/ligne\nsuite.md']);
  });
  it('une sortie vide donne une liste vide', () => {
    assert.deepEqual(cheminsDeDiff(''), []);
    assert.deepEqual(cheminsDeDiff('\0'), []);
  });
});

const LEGERE = { documentation_seule: true, deja_validee: false, lourds: false };
const COMPLETE = { documentation_seule: false, deja_validee: false, lourds: true };
const DEDOUBLONNEE = { documentation_seule: false, deja_validee: true, lourds: false };
const DOC = ['docs/guide.md', 'README.md'];
const CODE = ['server/index.ts', 'docs/guide.md'];
const versTexte = (decision) => Object.fromEntries(Object.entries(decision).map(([cle, valeur]) => [cle, String(valeur)]));

function verifierDecision(faits, attendu) {
  const decision = decider(faits);
  assert.deepEqual(decision, attendu);
  // Les sorties écrites par le script, une fois converties en texte, passent toujours le contrôle R1.
  assert.equal(sortiesCoherentes(versTexte(decision)), true);
}

// Cadrage, périmètre point 1 (documentation seule, N5, R2, deja_validee, C2, N10, lourds).
describe('CI — décision du périmètre', () => {
  it('pull request vers main de documentation seule : série légère', () => {
    verifierDecision({ evenement: 'pull_request', baseRef: 'main', fichiers: DOC }, LEGERE);
  });
  it('pull request de code : série complète', () => {
    verifierDecision({ evenement: 'pull_request', baseRef: 'main', fichiers: CODE }, COMPLETE);
  });
  it('PR empilée (base autre que main) de documentation seule : série complète (N5)', () => {
    verifierDecision({ evenement: 'pull_request', baseRef: 'claude/lot-precedent', fichiers: DOC }, COMPLETE);
    verifierDecision({ evenement: 'pull_request', baseRef: undefined, fichiers: DOC }, COMPLETE);
    verifierDecision({ evenement: 'pull_request', baseRef: '', fichiers: DOC }, COMPLETE);
  });
  it('push de documentation dont l\'arbre précédent est attesté : série légère', () => {
    verifierDecision({ evenement: 'push', fichiers: DOC, avantAtteste: true }, LEGERE);
  });
  it('push de documentation sans arbre précédent attesté : série complète (R2)', () => {
    verifierDecision({ evenement: 'push', fichiers: DOC, avantAtteste: false }, COMPLETE);
    verifierDecision({ evenement: 'push', fichiers: DOC }, COMPLETE);
  });
  it('push dont l\'arbre de tête est attesté : série dédoublonnée', () => {
    verifierDecision({ evenement: 'push', fichiers: CODE, teteAttestee: true }, DEDOUBLONNEE);
    verifierDecision({ evenement: 'push', fichiers: CODE, avantAtteste: true, teteAttestee: true }, DEDOUBLONNEE);
  });
  it('push dont l\'arbre est attesté mais qui touche .github/** : série complète (C2)', () => {
    verifierDecision({ evenement: 'push', fichiers: [...CODE, '.github/workflows/ci.yml'], teteAttestee: true }, COMPLETE);
    verifierDecision({ evenement: 'push', fichiers: ['.github/scripts/perimetre-ci.mjs'], avantAtteste: true, teteAttestee: true }, COMPLETE);
  });
  it('liste de fichiers vide (SHA nulle, before introuvable, diff impossible) : série complète, même avec des arbres attestés', () => {
    verifierDecision({ evenement: 'pull_request', baseRef: 'main', fichiers: [] }, COMPLETE);
    verifierDecision({ evenement: 'push', fichiers: [], avantAtteste: true, teteAttestee: true }, COMPLETE);
  });
  it('documentation seule et arbre attesté ensemble : « déjà validée » prime et « documentation seule » vaut faux (N10)', () => {
    verifierDecision({ evenement: 'push', fichiers: DOC, avantAtteste: true, teteAttestee: true }, DEDOUBLONNEE);
  });
  it('« déjà validée » est toujours faux hors d\'un push', () => {
    verifierDecision({ evenement: 'pull_request', baseRef: 'main', fichiers: CODE, avantAtteste: true, teteAttestee: true }, COMPLETE);
    verifierDecision({ evenement: 'pull_request', baseRef: 'main', fichiers: DOC, avantAtteste: true, teteAttestee: true }, LEGERE);
    verifierDecision({ evenement: 'pull_request', baseRef: 'claude/lot-precedent', fichiers: DOC, teteAttestee: true }, COMPLETE);
  });
  // Le workflow ne se déclenche que sur pull_request et push : tout autre événement mène à la série complète, même avec
  // une liste de documentation et des arbres attestés.
  it('un événement autre que pull_request ou push donne toujours la série complète', () => {
    for (const evenement of ['workflow_dispatch', 'schedule', undefined, '', 'pull_request_target', 'merge_group', 'PUSH']) {
      verifierDecision({ evenement, baseRef: 'main', fichiers: DOC }, COMPLETE);
      verifierDecision({ evenement, baseRef: 'main', fichiers: DOC, avantAtteste: true, teteAttestee: true }, COMPLETE);
      verifierDecision({ evenement, fichiers: CODE, avantAtteste: true, teteAttestee: true }, COMPLETE);
    }
  });
});

// Attestation d'un arbre (C2, R1', N14, N16) : artefact non expiré, série réussie de ce workflow, de ce dépôt, dont la
// tête est admise et identique à celle que porte l'artefact.
describe('CI — attestation d\'un arbre par un artefact', () => {
  const DEPOT = 4242;
  const AUTRE_DEPOT = 777;
  const AVANT = '1'.repeat(40);
  const AVANT_P2 = '2'.repeat(40); // before^2 : tête de la PR fusionnée par before
  const TETE = '3'.repeat(40); // HEAD
  const TETE_P2 = '4'.repeat(40); // HEAD^2 : tête de la PR fusionnée par HEAD
  const serie = (surcharges = {}) => ({
    id: 101, event: 'pull_request', conclusion: 'success', path: CHEMIN_WORKFLOW, head_sha: TETE_P2, repository: { id: DEPOT }, ...surcharges,
  });
  const artefact = (surcharges = {}, execution = {}) => ({
    name: 'serie-validee-arbre', expired: false, workflow_run: { id: 101, repository_id: DEPOT, head_sha: TETE_P2, ...execution }, ...surcharges,
  });
  const atteste = ({ artefacts, series, tetesAdmises = [TETE, TETE_P2] }) => arbreAtteste({
    artefacts, series: new Map(series.map((s) => [s.id, s])), depotId: DEPOT, tetesAdmises,
  });

  it('accepte un artefact valide déposé par la série de la PR fusionnée (head_sha = HEAD^2)', () => {
    assert.equal(atteste({ artefacts: [artefact()], series: [serie()] }), true);
  });
  it('accepte un artefact valide déposé par la série de main du commit lui-même (head_sha = HEAD)', () => {
    assert.equal(atteste({ artefacts: [artefact({}, { head_sha: TETE })], series: [serie({ event: 'push', head_sha: TETE })] }), true);
  });
  it('accepte pour l\'arbre de before l\'artefact de la série de main de before (head_sha = before)', () => {
    assert.equal(atteste({
      artefacts: [artefact({}, { head_sha: AVANT })], series: [serie({ event: 'push', head_sha: AVANT })], tetesAdmises: [AVANT],
    }), true);
  });
  it('refuse un artefact expiré', () => {
    assert.equal(atteste({ artefacts: [artefact({ expired: true })], series: [serie()] }), false);
  });
  it('refuse un artefact dont la série est inconnue ou absente', () => {
    assert.equal(atteste({ artefacts: [artefact({}, { id: 999 })], series: [serie()] }), false);
    assert.equal(atteste({ artefacts: [{ name: 'serie-validee-arbre', expired: false }], series: [serie()] }), false);
  });
  it('refuse un artefact d\'une série qui n\'a pas réussi', () => {
    for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', null, undefined]) {
      assert.equal(atteste({ artefacts: [artefact()], series: [serie({ conclusion })] }), false, `conclusion ${conclusion}`);
    }
  });
  it('refuse un artefact déposé par un autre workflow', () => {
    for (const path of ['.github/workflows/autre.yml', 'dynamic/pages/pages-build-deployment', '', undefined]) {
      assert.equal(atteste({ artefacts: [artefact()], series: [serie({ path })] }), false, `workflow ${path}`);
    }
  });
  it('refuse une série d\'un autre dépôt, ou sans dépôt', () => {
    assert.equal(atteste({ artefacts: [artefact()], series: [serie({ repository: { id: AUTRE_DEPOT } })] }), false);
    assert.equal(atteste({ artefacts: [artefact()], series: [serie({ repository: undefined })] }), false);
  });
  it('refuse un artefact rattaché à un autre dépôt', () => {
    assert.equal(atteste({ artefacts: [artefact({}, { repository_id: AUTRE_DEPOT })], series: [serie()] }), false);
  });
  it('refuse une série dont la tête n\'est pas admise', () => {
    const autre = 'f'.repeat(40);
    assert.equal(atteste({ artefacts: [artefact({}, { head_sha: autre })], series: [serie({ head_sha: autre })] }), false);
  });
  it('refuse un artefact dont le head_sha diffère de celui de sa série', () => {
    assert.equal(atteste({ artefacts: [artefact({}, { head_sha: 'f'.repeat(40) })], series: [serie()] }), false);
    assert.equal(atteste({ artefacts: [artefact({}, { head_sha: TETE })], series: [serie()] }), false);
  });
  // N16 / R1' du deuxième passage : un lien par before^2 contournait le refus de .github/** (retour en arrière).
  it('refuse pour l\'arbre de before un artefact de head_sha égal à before^2 quand seule before est admise', () => {
    assert.equal(atteste({
      artefacts: [artefact({}, { head_sha: AVANT_P2 })], series: [serie({ head_sha: AVANT_P2 })], tetesAdmises: [AVANT],
    }), false);
  });
  it('refuse une série qui ne porte pas les champs exigés (N2 : série de push sur main pour l\'arbre de before)', () => {
    const exigences = { event: 'push', head_branch: 'main' };
    const avant = (s) => arbreAtteste({ artefacts: [artefact({}, { head_sha: AVANT })], series: new Map([[101, serie({ head_sha: AVANT, ...s })]]), depotId: DEPOT, tetesAdmises: [AVANT], exigences });
    assert.equal(avant({ event: 'push', head_branch: 'main' }), true);
    assert.equal(avant({ event: 'pull_request', head_branch: 'main' }), false);
    assert.equal(avant({ event: 'push', head_branch: 'autre' }), false);
    assert.equal(avant({ event: 'push', head_branch: undefined }), false);
  });
  it('refuse une liste d\'artefacts vide', () => {
    assert.equal(atteste({ artefacts: [], series: [serie()] }), false);
  });
  // N14 : tous les artefacts du même nom sont lus ; l'attestation tient si l'un d'eux remplit les conditions.
  it('plusieurs artefacts du même nom dont un seul valide : l\'arbre est attesté ; aucun valide : il ne l\'est pas', () => {
    const invalides = [
      artefact({ expired: true }),
      artefact({}, { id: 102 }),
      artefact({}, { id: 103 }),
      artefact({}, { repository_id: AUTRE_DEPOT }),
    ];
    const series = [serie(), serie({ id: 102, conclusion: 'failure' }), serie({ id: 103, path: '.github/workflows/autre.yml' })];
    assert.equal(atteste({ artefacts: invalides, series }), false);
    assert.equal(atteste({ artefacts: [...invalides, artefact({}, { id: 104 })], series: [...series, serie({ id: 104 })] }), true);
  });
});

// R1 : chaque sortie vaut « true » ou « false », et `lourds` est la négation exacte de « documentation seule ou déjà
// validée » ; N10 : jamais les deux ensemble.
describe('CI — cohérence des sorties du périmètre', () => {
  const sorties = (documentation_seule, deja_validee, lourds) => ({ documentation_seule, deja_validee, lourds });
  it('seules trois combinaisons sur huit sont cohérentes', () => {
    const valides = new Set(['true,false,false', 'false,true,false', 'false,false,true']);
    for (const documentation of ['true', 'false']) {
      for (const deja of ['true', 'false']) {
        for (const lourds of ['true', 'false']) {
          const cle = `${documentation},${deja},${lourds}`;
          assert.equal(sortiesCoherentes(sorties(documentation, deja, lourds)), valides.has(cle), cle);
        }
      }
    }
  });
  it('une clé supplémentaire (arbre) ne change rien', () => {
    assert.equal(sortiesCoherentes({ arbre: 'abc', ...sorties('false', 'false', 'true') }), true);
  });
  it('refuse des sorties vides, absentes ou mal écrites', () => {
    for (const cas of [
      undefined,
      null,
      {},
      sorties('', '', ''),
      sorties('', '', 'true'),
      sorties('false', '', 'true'),
      { documentation_seule: 'false', lourds: 'true' },
      sorties('false', 'false', 'TRUE'),
      sorties('TRUE', 'false', 'true'),
      sorties('False', 'false', 'true'),
      sorties(false, false, true),
      sorties('0', '0', '1'),
      sorties(' true', 'false', 'false'),
    ]) {
      assert.equal(sortiesCoherentes(cas), false, JSON.stringify(cas));
    }
  });
  it('refuse lourds incohérent et documentation seule avec déjà validée', () => {
    assert.equal(sortiesCoherentes(sorties('true', 'false', 'true')), false);
    assert.equal(sortiesCoherentes(sorties('false', 'true', 'true')), false);
    assert.equal(sortiesCoherentes(sorties('false', 'false', 'false')), false);
    assert.equal(sortiesCoherentes(sorties('true', 'true', 'false')), false);
    assert.equal(sortiesCoherentes(sorties('true', 'true', 'true')), false);
  });
});

const SORTIES = {
  complete: { arbre: 'a1b2c3', documentation_seule: 'false', deja_validee: 'false', lourds: 'true' },
  documentation: { arbre: 'a1b2c3', documentation_seule: 'true', deja_validee: 'false', lourds: 'false' },
  dedoublonnee: { arbre: 'a1b2c3', documentation_seule: 'false', deja_validee: 'true', lourds: 'false' },
};

// Forme de `toJSON(needs)` : { travail: { result, outputs } }. `lourds` est soit un résultat commun aux cinq travaux,
// soit un résultat par travail ; un travail sans résultat est absent des needs. `perimetre` : résultat du périmètre
// (`undefined` : résultat absent ; `null` : périmètre absent des needs).
function besoins(sorties, lourds, options = {}) {
  const perimetre = 'perimetre' in options ? options.perimetre : 'success';
  const autres = options.autres ?? {};
  const resultat = (nom) => (typeof lourds === 'string' ? lourds : lourds[nom]);
  const tous = perimetre === null ? {} : { perimetre: { result: perimetre, outputs: sorties } };
  for (const nom of LOURDS) if (resultat(nom) !== undefined) tous[nom] = { result: resultat(nom), outputs: {} };
  return { ...tous, ...autres };
}
const tousSauf = (commun, nom, resultat) => Object.fromEntries(LOURDS.map((n) => [n, n === nom ? resultat : commun]));

function attendreVert(entree, evenement) {
  const verdict = verdictSynthese(entree, evenement);
  assert.equal(verdict.vert, true, verdict.raisons.join(' ; '));
  assert.deepEqual(verdict.raisons, []);
}
function attendreRouge(entree, evenement, contexte = '') {
  const verdict = verdictSynthese(entree, evenement);
  assert.equal(verdict.vert, false, `attendu rouge : ${contexte}`);
  assert.ok(verdict.raisons.length > 0, `un verdict rouge donne sa raison : ${contexte}`);
}

// Cadrage, périmètre point 3 : synthèse fermée par défaut (R1), verte seulement par exactement un des trois chemins.
describe('CI — verdict de la synthèse', () => {
  it('chemin 1 : travaux lourds demandés et tous réussis, vert sur pull request comme sur push', () => {
    attendreVert(besoins(SORTIES.complete, 'success'), 'pull_request');
    attendreVert(besoins(SORTIES.complete, 'success'), 'push');
  });
  it('chemin 2 : documentation seule et les cinq travaux lourds sautés, vert', () => {
    attendreVert(besoins(SORTIES.documentation, 'skipped'), 'pull_request');
    attendreVert(besoins(SORTIES.documentation, 'skipped'), 'push');
  });
  it('chemin 3 : push sur main d\'un arbre attesté et les cinq travaux lourds sautés, vert', () => {
    attendreVert(besoins(SORTIES.dedoublonnee, 'skipped'), 'push');
  });
  it('rouge si le périmètre a échoué, a été annulé, sauté ou est absent', () => {
    for (const perimetre of ['failure', 'cancelled', 'skipped', undefined]) {
      attendreRouge(besoins(SORTIES.complete, 'success', { perimetre }), 'pull_request', `périmètre ${perimetre}`);
      attendreRouge(besoins(SORTIES.documentation, 'skipped', { perimetre }), 'pull_request', `périmètre ${perimetre}`);
    }
    attendreRouge(besoins(SORTIES.complete, 'success', { perimetre: null }), 'pull_request', 'périmètre absent');
    attendreRouge(besoins(SORTIES.documentation, 'skipped', { perimetre: null }), 'pull_request', 'périmètre absent');
  });
  it('rouge si les sorties du périmètre sont vides ou absentes', () => {
    const vides = { arbre: '', documentation_seule: '', deja_validee: '', lourds: '' };
    for (const sorties of [{}, undefined, vides, { ...vides, lourds: 'true' }, { ...vides, lourds: 'false', documentation_seule: 'true' }]) {
      attendreRouge(besoins(sorties, 'success'), 'pull_request', JSON.stringify(sorties));
      attendreRouge(besoins(sorties, 'skipped'), 'pull_request', JSON.stringify(sorties));
      attendreRouge(besoins(sorties, 'skipped'), 'push', JSON.stringify(sorties));
    }
  });
  it('rouge si les sorties du périmètre sont incohérentes, même quand un chemin semble rempli', () => {
    attendreRouge(besoins({ ...SORTIES.complete, documentation_seule: 'true' }, 'success'), 'pull_request', 'documentation et lourds');
    attendreRouge(besoins({ ...SORTIES.complete, deja_validee: 'true' }, 'success'), 'push', 'déjà validée et lourds');
    attendreRouge(besoins({ ...SORTIES.documentation, deja_validee: 'true' }, 'skipped'), 'push', 'documentation et déjà validée');
    attendreRouge(besoins({ ...SORTIES.documentation, documentation_seule: 'false' }, 'skipped'), 'pull_request', 'rien et lourds=false');
  });
  it('rouge si une sortie est écrite TRUE ou autrement que true/false', () => {
    attendreRouge(besoins({ ...SORTIES.complete, lourds: 'TRUE' }, 'success'), 'pull_request', 'lourds TRUE');
    attendreRouge(besoins({ ...SORTIES.complete, documentation_seule: 'FALSE' }, 'success'), 'pull_request', 'documentation FALSE');
    attendreRouge(besoins({ ...SORTIES.documentation, documentation_seule: 'TRUE' }, 'skipped'), 'pull_request', 'documentation TRUE');
    attendreRouge(besoins({ ...SORTIES.dedoublonnee, deja_validee: 'True' }, 'skipped'), 'push', 'déjà validée True');
    attendreRouge(besoins({ ...SORTIES.complete, lourds: true }, 'success'), 'pull_request', 'lourds booléen');
  });
  it('rouge si un travail lourd a échoué, a été annulé, a été sauté ou manque alors que lourds=true', () => {
    for (const nom of LOURDS) {
      for (const resultat of ['failure', 'cancelled', 'skipped', undefined]) {
        attendreRouge(besoins(SORTIES.complete, tousSauf('success', nom, resultat)), 'pull_request', `${nom} ${resultat}`);
        attendreRouge(besoins(SORTIES.complete, tousSauf('success', nom, resultat)), 'push', `${nom} ${resultat}`);
      }
    }
    attendreRouge(besoins(SORTIES.complete, 'skipped'), 'pull_request', 'tous sautés');
  });
  it('rouge si un travail lourd a réussi alors que lourds=false', () => {
    for (const nom of LOURDS) {
      attendreRouge(besoins(SORTIES.documentation, tousSauf('skipped', nom, 'success')), 'pull_request', `documentation, ${nom} réussi`);
      attendreRouge(besoins(SORTIES.dedoublonnee, tousSauf('skipped', nom, 'success')), 'push', `dédoublonnée, ${nom} réussi`);
    }
    attendreRouge(besoins(SORTIES.documentation, 'success'), 'pull_request', 'documentation, tous réussis');
    attendreRouge(besoins(SORTIES.dedoublonnee, 'success'), 'push', 'dédoublonnée, tous réussis');
  });
  it('rouge pour le chemin 3 hors d\'un push sur main (pull request ou événement absent)', () => {
    attendreRouge(besoins(SORTIES.dedoublonnee, 'skipped'), 'pull_request', 'pull request');
    attendreRouge(besoins(SORTIES.dedoublonnee, 'skipped'), undefined, 'événement absent');
  });
  it('rouge pour le chemin 2 dès qu\'un travail lourd n\'est pas sauté (échoué, annulé ou absent)', () => {
    for (const nom of LOURDS) {
      for (const resultat of ['failure', 'cancelled', undefined]) {
        attendreRouge(besoins(SORTIES.documentation, tousSauf('skipped', nom, resultat)), 'pull_request', `${nom} ${resultat}`);
        attendreRouge(besoins(SORTIES.dedoublonnee, tousSauf('skipped', nom, resultat)), 'push', `${nom} ${resultat}`);
      }
    }
  });
  it('rouge si un autre travail des needs a échoué ou a été annulé, même sur un chemin vert', () => {
    for (const result of ['failure', 'cancelled']) {
      attendreRouge(besoins(SORTIES.complete, 'success', { autres: { autre: { result, outputs: {} } } }), 'pull_request', result);
      attendreRouge(besoins(SORTIES.documentation, 'skipped', { autres: { autre: { result, outputs: {} } } }), 'pull_request', result);
    }
  });
  it('rouge si les needs sont vides, nuls ou indéfinis', () => {
    attendreRouge({}, 'pull_request', 'needs vide');
    attendreRouge(undefined, 'pull_request', 'needs undefined');
    attendreRouge(null, 'push', 'needs null');
  });
});

// Cadrage, périmètre point 3 : après une série verte qui a testé ou attesté l'arbre, l'artefact est déposé ; une série
// légère de pull request ne dépose rien.
describe('CI — dépôt de l\'attestation après une série verte', () => {
  it('une série complète de pull request atteste son arbre', () => {
    assert.equal(doitAttester({ evenement: 'pull_request', sorties: SORTIES.complete }), true);
  });
  it('une série complète de main atteste son arbre', () => {
    assert.equal(doitAttester({ evenement: 'push', sorties: SORTIES.complete }), true);
  });
  it('une série légère de main (arbre parent attesté) atteste son arbre', () => {
    assert.equal(doitAttester({ evenement: 'push', sorties: SORTIES.documentation }), true);
  });
  it('une série dédoublonnée de main atteste son arbre', () => {
    assert.equal(doitAttester({ evenement: 'push', sorties: SORTIES.dedoublonnee }), true);
  });
  it('une série légère de pull request n\'atteste rien', () => {
    assert.equal(doitAttester({ evenement: 'pull_request', sorties: SORTIES.documentation }), false);
  });
});

// --- Le workflow, lu en texte -----------------------------------------------------------------------------------------

const TEXTE_CI = readFileSync(CI_YML, 'utf8');
const LIGNES_CI = TEXTE_CI.split('\n');

// Travaux sous `jobs:` : un en-tête à deux espaces d'indentation, jusqu'à la clé de premier niveau suivante.
function travauxDuWorkflow() {
  const debut = LIGNES_CI.indexOf('jobs:');
  assert.notEqual(debut, -1, 'clé « jobs: » introuvable dans ci.yml');
  const travaux = new Map();
  let courant = null;
  for (const ligne of LIGNES_CI.slice(debut + 1)) {
    if (/^\S/.test(ligne)) break;
    const entete = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(ligne);
    if (entete) {
      courant = entete[1];
      travaux.set(courant, []);
    } else if (courant) {
      travaux.get(courant).push(ligne);
    }
  }
  return travaux;
}
// Valeurs d'une clé au niveau du travail (quatre espaces exactement), à l'exclusion des clés des étapes.
const cleDuTravail = (lignes, nom) => lignes.filter((l) => l.startsWith(`    ${nom}:`)).map((l) => l.slice(nom.length + 5).trim());
// Étapes d'un travail : chacune commence par « - » à six espaces ; ses clés sont à huit espaces ou plus.
function etapesDuTravail(lignes) {
  const etapes = [];
  for (const ligne of lignes) {
    if (/^ {6}- /.test(ligne)) etapes.push([ligne]);
    else if (etapes.length > 0 && /^ {8}/.test(ligne)) etapes[etapes.length - 1].push(ligne);
  }
  return etapes.map((etape) => etape.join('\n'));
}

describe('CI — le workflow ci.yml', () => {
  const travaux = travauxDuWorkflow();
  const travail = (nom) => {
    assert.ok(travaux.has(nom), `travail « ${nom} » introuvable dans ci.yml`);
    return travaux.get(nom);
  };

  it('compte exactement le périmètre, les cinq travaux lourds et la synthèse', () => {
    assert.deepEqual([...travaux.keys()].sort(), ['perimetre', ...LOURDS, 'synthese'].sort());
  });
  // Périmètre point 2 : une sortie vide ou invalide lance les travaux lourds (R1).
  it('chaque travail lourd dépend du périmètre et ne saute que sur lourds explicitement « false »', () => {
    for (const nom of LOURDS) {
      assert.deepEqual(cleDuTravail(travail(nom), 'needs'), ['perimetre'], `${nom} : needs`);
      assert.deepEqual(cleDuTravail(travail(nom), 'if'), ["needs.perimetre.outputs.lourds != 'false'"], `${nom} : if`);
    }
  });
  // T1 : tests du script en tête du travail ; le périmètre est toujours lancé, en premier.
  it('le périmètre tourne toujours, lance les tests du script avant de calculer, et expose ses quatre sorties', () => {
    const lignes = travail('perimetre');
    assert.deepEqual(cleDuTravail(lignes, 'needs'), []);
    assert.deepEqual(cleDuTravail(lignes, 'if'), []);
    const etapes = etapesDuTravail(lignes);
    const tests = etapes.findIndex((e) => /run: node --test \.github\/scripts\/perimetre-ci\.test\.mjs\s*$/m.test(e));
    const calcul = etapes.findIndex((e) => /run: node \.github\/scripts\/perimetre-ci\.mjs perimetre\s*$/m.test(e));
    assert.notEqual(tests, -1, 'étape des tests du script introuvable');
    assert.notEqual(calcul, -1, 'étape du calcul du périmètre introuvable');
    assert.ok(tests < calcul, 'les tests du script tournent avant le calcul du périmètre');
    assert.match(etapes[calcul], /^ {8}id: perimetre\s*$/m);
    for (const sortie of ['arbre', 'documentation_seule', 'deja_validee', 'lourds']) {
      assert.ok(lignes.includes(`      ${sortie}: \${{ steps.perimetre.outputs.${sortie} }}`), `sortie ${sortie}`);
    }
  });
  it('le calcul du périmètre reçoit l\'événement, la base, l\'ancienne tête, le dépôt et le jeton de la série', () => {
    const calcul = etapesDuTravail(travail('perimetre')).find((e) => /perimetre-ci\.mjs perimetre/.test(e));
    for (const [variable, valeur] of [
      ['EVENEMENT', 'github.event_name'],
      ['BASE_REF', 'github.base_ref'],
      ['AVANT', 'github.event.before'],
      ['DEPOT', 'github.repository'],
      ['DEPOT_ID', 'github.repository_id'],
      ['GH_TOKEN', 'github.token'],
    ]) {
      assert.ok(calcul.split('\n').includes(`          ${variable}: \${{ ${valeur} }}`), `${variable} = ${valeur}`);
    }
  });
  // Périmètre point 3 et N1 : la synthèse tourne après un échec, pas pour une série annulée.
  it('la synthèse tourne sauf annulation et dépend du périmètre et des cinq travaux lourds', () => {
    const lignes = travail('synthese');
    assert.deepEqual(cleDuTravail(lignes, 'if'), ['${{ !cancelled() }}']);
    const besoinsDeclares = cleDuTravail(lignes, 'needs');
    assert.equal(besoinsDeclares.length, 1);
    const liste = /^\[(.*)\]$/.exec(besoinsDeclares[0]);
    assert.ok(liste, `needs de la synthèse en liste entre crochets : ${besoinsDeclares[0]}`);
    assert.deepEqual(liste[1].split(',').map((n) => n.trim()).sort(), ['perimetre', ...LOURDS].sort());
  });
  it('la synthèse juge la série sur toJSON(needs) et ne dépose l\'attestation de l\'arbre que sur son verdict', () => {
    const etapes = etapesDuTravail(travail('synthese'));
    const verdict = etapes.find((e) => /perimetre-ci\.mjs synthese\s*$/m.test(e));
    assert.ok(verdict, 'étape du verdict introuvable');
    assert.match(verdict, /^ {8}id: verdict\s*$/m);
    assert.match(verdict, /^ {10}RESULTATS: \$\{\{ toJSON\(needs\) \}\}\s*$/m);
    assert.match(verdict, /^ {10}EVENEMENT: \$\{\{ github\.event_name \}\}\s*$/m);
    const depot = etapes.find((e) => /uses: actions\/upload-artifact@/.test(e));
    assert.ok(depot, 'étape de dépôt de l\'attestation introuvable');
    assert.match(depot, /^ {8}if: steps\.verdict\.outputs\.attester == 'true'\s*$/m);
    assert.match(depot, /^ {10}name: serie-validee-\$\{\{ needs\.perimetre\.outputs\.arbre \}\}\s*$/m);
    assert.match(depot, /^ {10}overwrite: true\s*$/m); // N4
    assert.match(depot, /^ {10}retention-days: 14\s*$/m);
  });
  // Périmètre point 4 (C3) : un groupe par commit sur main, annulation réservée aux pull requests.
  it('les séries de main ne sont jamais annulées : groupe par commit, annulation réservée aux pull requests', () => {
    const debut = LIGNES_CI.indexOf('concurrency:');
    assert.notEqual(debut, -1, 'bloc « concurrency: » de premier niveau introuvable');
    const bloc = [];
    for (const ligne of LIGNES_CI.slice(debut + 1)) {
      if (!/^ {2}\S/.test(ligne)) break;
      bloc.push(ligne.trim());
    }
    const groupe = bloc.filter((l) => l.startsWith('group:'));
    assert.equal(groupe.length, 1);
    assert.ok(groupe[0].endsWith('github.event.pull_request.number || github.sha }}'), groupe[0]);
    assert.deepEqual(bloc.filter((l) => l.startsWith('cancel-in-progress:')), ["cancel-in-progress: ${{ github.event_name == 'pull_request' }}"]);
    for (const [nom, lignes] of travaux) {
      assert.deepEqual(cleDuTravail(lignes, 'concurrency'), [], `${nom} : pas de concurrence propre au travail`);
    }
  });
  // Audit droits et sécurité de #546, T1 : le jeton du workflow n'a que contents: read et actions: read, et aucun travail
  // ne redéfinit ses droits.
  it('le jeton du workflow n\'a que contents: read et actions: read, sans droits propres à un travail', () => {
    const debut = LIGNES_CI.indexOf('permissions:');
    assert.notEqual(debut, -1, 'bloc « permissions: » de premier niveau introuvable');
    const bloc = [];
    for (const ligne of LIGNES_CI.slice(debut + 1)) {
      if (!/^ {2}\S/.test(ligne)) break;
      bloc.push(ligne.trim());
    }
    assert.deepEqual(bloc.sort(), ['actions: read', 'contents: read']);
    assert.equal(LIGNES_CI.filter((l) => /^\s*permissions:/.test(l)).length, 1, 'un seul bloc permissions');
    for (const [nom, lignes] of travaux) assert.deepEqual(cleDuTravail(lignes, 'permissions'), [], `${nom} : pas de droits propres`);
  });
  // Audit droits et sécurité de #546, T2 : en documentation seule, le périmètre lance les deux seuls tests de la CI qui
  // lisent la documentation, après le calcul et sous la seule condition documentation_seule == 'true'.
  it('en documentation seule, le périmètre lance environnement.test.mjs et les tests unitaires du client', () => {
    const etapes = etapesDuTravail(travail('perimetre'));
    const calcul = etapes.findIndex((e) => /run: node \.github\/scripts\/perimetre-ci\.mjs perimetre\s*$/m.test(e));
    const condition = /^ {8}if: steps\.perimetre\.outputs\.documentation_seule == 'true'\s*$/m;
    const environnement = etapes.findIndex((e) => /^ {8}run: node --test server\/tests\/environnement\.test\.mjs\s*$/m.test(e));
    const unitaires = etapes.findIndex((e) => /^ {10}npm run test:unit\s*$/m.test(e));
    assert.notEqual(environnement, -1, 'étape environnement.test.mjs introuvable');
    assert.notEqual(unitaires, -1, 'étape des tests unitaires du client introuvable');
    for (const [nom, index] of [['environnement', environnement], ['unitaires', unitaires]]) {
      assert.ok(index > calcul, `${nom} : après le calcul du périmètre`);
      assert.match(etapes[index], condition, `${nom} : condition documentation_seule == 'true'`);
      assert.doesNotMatch(etapes[index], /continue-on-error/, `${nom} : un échec fait échouer le périmètre`);
    }
    assert.match(etapes[unitaires], /^ {8}working-directory: client\s*$/m);
    assert.match(etapes[unitaires], /^ {10}npm ci\s*$/m);
  });
  // Cadrage, point 6 (N6) : le jeton de saut ne s'écrit pas en clair. La chaîne est construite ici, jamais écrite.
  it('ne contient aucun jeton de saut de CI entre crochets', () => {
    const jetons = [['skip', 'ci'], ['ci', 'skip'], ['no', 'ci'], ['skip', 'actions'], ['actions', 'skip']];
    const motif = new RegExp(`\\[\\s*(?:${jetons.map(([a, b]) => `${a}\\s+${b}`).join('|')})\\s*\\]`, 'i');
    assert.equal(motif.test(`message ${'['}${'skip'} ${'ci'}${']'}`), true, 'le motif reconnaît le jeton');
    assert.equal(motif.test(TEXTE_CI), false, `jeton trouvé dans ci.yml : ${TEXTE_CI.match(motif)?.[0]}`);
  });
});

// --- Le script lancé dans de vrais dépôts git --------------------------------------------------------------------------

function environnementGit(racine) {
  return {
    PATH: process.env.PATH,
    HOME: racine,
    LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'TEST CI',
    GIT_AUTHOR_EMAIL: 'test-ci@example.invalid',
    GIT_COMMITTER_NAME: 'TEST CI',
    GIT_COMMITTER_EMAIL: 'test-ci@example.invalid',
  };
}
function lancerGit(racine, cwd, args, { entree, env = {} } = {}) {
  try {
    return execFileSync('git', args, { cwd, env: { ...environnementGit(racine), ...env }, input: entree ?? '', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (erreur) {
    throw new Error(`git ${args.join(' ')} : ${erreur.code === 'ENOENT' ? 'git introuvable (requis par ces tests)' : erreur.stderr || erreur.message}`);
  }
}

// Arguments que le script passe à `git diff`, lus dans sa source : l'essai git ci-dessous les rejoue tels quels.
function argumentsDuDiffDuScript() {
  const source = readFileSync(SCRIPT, 'utf8');
  const appels = [...source.matchAll(/git\(\s*'diff'((?:\s*,\s*'[^']*')*)/g)];
  assert.equal(appels.length, 1, 'un seul appel git diff dans perimetre-ci.mjs');
  return ['diff', ...[...appels[0][1].matchAll(/'([^']*)'/g)].map((m) => m[1])];
}

// R3 : un renommage compte pour ses deux chemins ; la sortie -z garde les chemins tels quels.
describe('CI — fichiers changés lus par un vrai git', () => {
  let racine;
  let depot;
  before(() => {
    racine = mkdtempSync(join(tmpdir(), 'perimetre-ci-test-'));
    depot = join(racine, 'depot');
    mkdirSync(join(depot, 'server'), { recursive: true });
    lancerGit(racine, racine, ['-c', 'init.defaultBranch=main', 'init', '-q', depot]);
    writeFileSync(join(depot, 'server', 'code.ts'), 'export const valeur = 1;\n');
    writeFileSync(join(depot, 'README.md'), '# Dépôt de test\n');
    lancerGit(racine, depot, ['add', '-A']);
    lancerGit(racine, depot, ['commit', '-q', '-m', 'initial']);
    mkdirSync(join(depot, 'docs'));
    lancerGit(racine, depot, ['mv', 'server/code.ts', 'docs/code.md']);
    lancerGit(racine, depot, ['commit', '-q', '-m', 'renommage']);
    mkdirSync(join(depot, 'docs', 'accentué é'));
    writeFileSync(join(depot, 'docs', 'a b.md'), 'a\n');
    writeFileSync(join(depot, 'docs', '"cité".md'), 'b\n');
    writeFileSync(join(depot, 'docs', 'accentué é', 'x.md'), 'c\n');
    lancerGit(racine, depot, ['add', '-A']);
    lancerGit(racine, depot, ['commit', '-q', '-m', 'chemins particuliers']);
  });
  after(() => {
    if (racine) rmSync(racine, { recursive: true, force: true });
  });

  it('le script appelle git diff avec --name-only, --no-renames et -z', () => {
    const args = argumentsDuDiffDuScript();
    for (const option of ['--name-only', '--no-renames', '-z']) assert.ok(args.includes(option), `${option} dans ${args.join(' ')}`);
  });
  it('un git mv d\'un fichier de code vers un .md liste l\'ancien et le nouveau chemin : série complète', () => {
    const sortie = lancerGit(racine, depot, [...argumentsDuDiffDuScript(), 'HEAD~2', 'HEAD~1']);
    const fichiers = cheminsDeDiff(sortie);
    assert.deepEqual([...fichiers].sort(), ['docs/code.md', 'server/code.ts']);
    assert.equal(documentationSeule(fichiers), false);
    assert.deepEqual(decider({ evenement: 'pull_request', baseRef: 'main', fichiers }), COMPLETE);
    // Témoin : sans --no-renames, git détecte le renommage et ne donne que le nouveau chemin, qui passerait pour de la
    // documentation seule. C'est ce que l'option empêche.
    const sansOption = cheminsDeDiff(lancerGit(racine, depot, ['diff', '--name-only', '-z', 'HEAD~2', 'HEAD~1']));
    assert.deepEqual(sansOption, ['docs/code.md']);
    assert.equal(documentationSeule(sansOption), true);
  });
  it('des chemins avec espaces, guillemets et accents sont relus tels quels', () => {
    const fichiers = cheminsDeDiff(lancerGit(racine, depot, [...argumentsDuDiffDuScript(), 'HEAD~1', 'HEAD']));
    assert.deepEqual([...fichiers].sort(), ['docs/"cité".md', 'docs/a b.md', 'docs/accentué é/x.md'].sort());
    assert.equal(documentationSeule(fichiers), true);
  });
});

// Fausse API GitHub, chargée avant le script : répond aux seules routes qu'il lit (artefacts d'un nom, page par page ;
// série par identifiant) à partir d'un fichier de données, note chaque URL appelée, et peut tomber en panne pour un nom
// d'artefact (`panne`) ou pour une série (`panneSeries`).
const FAUSSE_API = `import { appendFileSync, readFileSync } from 'node:fs';
const donnees = JSON.parse(readFileSync(process.env.FAUSSE_API, 'utf8'));
globalThis.fetch = async (url) => {
  appendFileSync(process.env.APPELS_API, String(url) + '\\n');
  const reponse = (status, corps) => ({ ok: status >= 200 && status < 300, status, json: async () => corps });
  const adresse = new URL(String(url));
  const prefixe = '/repos/' + donnees.depot + '/actions/';
  if (adresse.origin !== 'https://api.github.com' || !adresse.pathname.startsWith(prefixe)) return reponse(404, {});
  const reste = adresse.pathname.slice(prefixe.length);
  if (reste === 'artifacts') {
    const nom = adresse.searchParams.get('name');
    if (donnees.panne && donnees.panne.includes(nom)) return reponse(500, {});
    const page = Number(adresse.searchParams.get('page') || 1);
    const parPage = Number(adresse.searchParams.get('per_page') || 30);
    const tous = donnees.artefacts[nom] || [];
    return reponse(200, { total_count: tous.length, artifacts: tous.slice((page - 1) * parPage, page * parPage) });
  }
  const serie = /^runs\\/(\\d+)$/.exec(reste);
  if (serie && donnees.panneSeries && donnees.panneSeries.includes(Number(serie[1]))) return reponse(500, {});
  if (serie && donnees.series[serie[1]]) return reponse(200, donnees.series[serie[1]]);
  return reponse(404, {});
};
`;

function lireSorties(fichier) {
  const sorties = {};
  for (const ligne of readFileSync(fichier, 'utf8').split('\n')) {
    const egal = ligne.indexOf('=');
    if (egal > 0) sorties[ligne.slice(0, egal)] = ligne.slice(egal + 1);
  }
  return sorties;
}

// Cadrage, périmètre point 1, de bout en bout : le script tel que la CI le lance (`perimetre`, puis `synthese`).
describe('CI — le script de périmètre de bout en bout', () => {
  const DEPOT = 'organisation-test/depot-test';
  const DEPOT_ID = 4242;
  let racine;
  let origine;
  let chargeur;
  const h = {}; // SHA et arbres de l'historique
  const sousGit = (args, options) => lancerGit(racine, origine, args, options).trim();

  before(() => {
    racine = mkdtempSync(join(tmpdir(), 'perimetre-ci-test-'));
    origine = join(racine, 'origine.git');
    chargeur = join(racine, 'fausse-api.mjs');
    writeFileSync(chargeur, FAUSSE_API);
    lancerGit(racine, racine, ['-c', 'init.defaultBranch=main', 'init', '-q', '--bare', origine]);
    // La CI récupère `before` par sa SHA (`git fetch origin <before>`), comme GitHub le permet.
    lancerGit(racine, origine, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
    let numero = 0;
    const arbre = (fichiers) => {
      const index = join(racine, `index-${(numero += 1)}`);
      for (const [chemin, contenu] of Object.entries(fichiers)) {
        const blob = sousGit(['hash-object', '-w', '--stdin'], { entree: contenu });
        sousGit(['update-index', '--add', '--cacheinfo', `100644,${blob},${chemin}`], { env: { GIT_INDEX_FILE: index } });
      }
      return sousGit(['write-tree'], { env: { GIT_INDEX_FILE: index } });
    };
    const commit = (arbreSha, parents, message) => sousGit(['commit-tree', arbreSha, ...parents.flatMap((p) => ['-p', p]), '-m', message]);
    const base = {
      'README.md': '# Dépôt de test\n',
      'docs/guide.md': 'Guide\n',
      'server/code.ts': 'export const valeur = 1;\n',
      '.github/workflows/ci.yml': 'name: CI\n',
    };
    const etatAvant = { ...base, 'docs/guide.md': 'Guide revu\n' };
    // a0, puis la PR q fusionnée par commit de fusion : before = c0, before^2 = q1.
    h.a0 = commit(arbre(base), [], 'a0');
    h.q1 = commit(arbre(etatAvant), [h.a0], 'q1');
    h.arbreAvant = arbre(etatAvant);
    h.c0 = commit(h.arbreAvant, [h.a0, h.q1], 'fusion de q');
    const { 'server/code.ts': codeInitial, ...sansCode } = etatAvant;
    const scenarios = {
      documentation: { ...etatAvant, 'docs/guide.md': 'Guide complété\n', 'docs/note "citée" é.md': 'Note\n', 'README.md': '# Revu\n' },
      code: { ...etatAvant, 'server/code.ts': 'export const valeur = 2;\n' },
      workflow: { ...etatAvant, '.github/workflows/ci.yml': 'name: CI revue\n' },
      renommage: { ...sansCode, 'docs/code.md': codeInitial },
      vide: etatAvant,
      migration: { ...etatAvant, 'server/prisma/migrations/20261120000000_note_seule/README.md': '# Note\n' },
    };
    // Chaque PR p-<nom> part de c0 ; sa fusion (premier parent c0, second parent la tête de la PR) est à la fois le
    // commit de fusion testé d'une pull request (refs/pull/N/merge) et le commit de main après la fusion.
    for (const [nom, etat] of Object.entries(scenarios)) {
      const arbreSha = arbre(etat);
      const tete = commit(arbreSha, [h.c0], `p-${nom}`);
      const fusion = commit(arbreSha, [h.c0, tete], `fusion de p-${nom}`);
      sousGit(['update-ref', `refs/heads/fusion-${nom}`, fusion]);
      h[nom] = { tete, fusion, arbre: arbreSha };
    }
  });
  after(() => {
    if (racine) rmSync(racine, { recursive: true, force: true });
  });

  const serie = (id, head_sha, surcharges = {}) => ({
    id, event: 'push', conclusion: 'success', path: CHEMIN_WORKFLOW, head_sha, head_branch: 'main', repository: { id: DEPOT_ID }, ...surcharges,
  });
  const artefact = (arbreSha, id, head_sha, surcharges = {}) => ({
    name: `serie-validee-${arbreSha}`, expired: false, workflow_run: { id, repository_id: DEPOT_ID, head_sha }, ...surcharges,
  });
  // Données de la fausse API à partir d'une liste d'artefacts et de séries.
  const api = (artefacts = [], series = [], panne = [], panneSeries = []) => {
    const parNom = {};
    for (const a of artefacts) (parNom[a.name] ||= []).push(a);
    return { artefacts: parNom, series: Object.fromEntries(series.map((s) => [String(s.id), s])), panne, panneSeries };
  };

  // Clone à profondeur 2 de la branche, comme actions/checkout (fetch-depth: 2), puis `perimetre-ci.mjs perimetre`.
  function lancerPerimetre({ branche, evenement, baseRef, avant, donnees = api() }) {
    const dossier = mkdtempSync(join(racine, 'serie-'));
    const copie = join(dossier, 'copie');
    lancerGit(racine, dossier, ['clone', '-q', '--depth=2', '--branch', branche, pathToFileURL(origine).href, copie]);
    const fichiers = { donnees: join(dossier, 'api.json'), appels: join(dossier, 'appels.txt'), sorties: join(dossier, 'sorties.txt'), resume: join(dossier, 'resume.md') };
    writeFileSync(fichiers.donnees, JSON.stringify({ depot: DEPOT, ...donnees }));
    for (const fichier of [fichiers.appels, fichiers.sorties, fichiers.resume]) writeFileSync(fichier, '');
    const env = {
      ...environnementGit(racine),
      EVENEMENT: evenement,
      DEPOT,
      DEPOT_ID: String(DEPOT_ID),
      GH_TOKEN: 'jeton-factice',
      GITHUB_OUTPUT: fichiers.sorties,
      GITHUB_STEP_SUMMARY: fichiers.resume,
      FAUSSE_API: fichiers.donnees,
      APPELS_API: fichiers.appels,
    };
    if (evenement === undefined) delete env.EVENEMENT;
    if (baseRef !== undefined) env.BASE_REF = baseRef;
    if (avant !== undefined) env.AVANT = avant;
    const execution = spawnSync(process.execPath, ['--import', pathToFileURL(chargeur).href, SCRIPT, 'perimetre'], { cwd: copie, env, encoding: 'utf8' });
    return {
      code: execution.status,
      journal: `${execution.stdout}\n${execution.stderr}`,
      sorties: lireSorties(fichiers.sorties),
      appels: readFileSync(fichiers.appels, 'utf8').split('\n').filter(Boolean),
    };
  }
  function attendreSorties(resultat, attendu, arbreSha) {
    assert.equal(resultat.code, 0, resultat.journal);
    assert.deepEqual(resultat.sorties, { arbre: arbreSha, ...versTexte(attendu) }, resultat.journal);
  }

  it('pull request vers main de documentation seule : série légère, arbre du commit de fusion testé', () => {
    attendreSorties(lancerPerimetre({ branche: 'fusion-documentation', evenement: 'pull_request', baseRef: 'main' }), LEGERE, h.documentation.arbre);
  });
  it('pull request de code : série complète', () => {
    attendreSorties(lancerPerimetre({ branche: 'fusion-code', evenement: 'pull_request', baseRef: 'main' }), COMPLETE, h.code.arbre);
  });
  it('PR empilée de documentation seule : série complète', () => {
    attendreSorties(lancerPerimetre({ branche: 'fusion-documentation', evenement: 'pull_request', baseRef: 'claude/lot-precedent' }), COMPLETE, h.documentation.arbre);
    attendreSorties(lancerPerimetre({ branche: 'fusion-documentation', evenement: 'pull_request' }), COMPLETE, h.documentation.arbre);
  });
  it('pull request qui renomme un fichier de code en .md : ses deux chemins sont listés, série complète', () => {
    const resultat = lancerPerimetre({ branche: 'fusion-renommage', evenement: 'pull_request', baseRef: 'main' });
    attendreSorties(resultat, COMPLETE, h.renommage.arbre);
    assert.match(resultat.journal, /^server\/code\.ts$/m);
    assert.match(resultat.journal, /^docs\/code\.md$/m);
  });
  // Audit droits et sécurité de #546, R1 : `prisma migrate deploy` refuse un dossier de migration sans migration.sql
  // (P3015) ; les travaux qui le lancent ne sont donc pas sautés.
  it('pull request qui n\'ajoute qu\'un README.md dans un nouveau dossier de migration : série complète', () => {
    attendreSorties(lancerPerimetre({ branche: 'fusion-migration', evenement: 'pull_request', baseRef: 'main' }), COMPLETE, h.migration.arbre);
  });
  it('push qui n\'ajoute qu\'un README.md dans un nouveau dossier de migration, arbre précédent attesté : série complète', () => {
    const donnees = api([artefact(h.arbreAvant, 13, h.c0)], [serie(13, h.c0)]);
    attendreSorties(lancerPerimetre({ branche: 'fusion-migration', evenement: 'push', avant: h.c0, donnees }), COMPLETE, h.migration.arbre);
  });
  it('pull request sans aucun fichier changé : série complète', () => {
    attendreSorties(lancerPerimetre({ branche: 'fusion-vide', evenement: 'pull_request', baseRef: 'main' }), COMPLETE, h.vide.arbre);
  });
  it('push de documentation dont l\'arbre précédent est attesté par la série de main de before : série légère', () => {
    const donnees = api([artefact(h.arbreAvant, 11, h.c0)], [serie(11, h.c0)]);
    attendreSorties(lancerPerimetre({ branche: 'fusion-documentation', evenement: 'push', avant: h.c0, donnees }), LEGERE, h.documentation.arbre);
  });
  // N16 / R1' : l'arbre de before n'est attesté que par la série de main de before, jamais par celle de before^2.
  it('push de documentation dont l\'arbre précédent n\'est attesté que par la série de before^2 : série complète', () => {
    const donnees = api([artefact(h.arbreAvant, 12, h.q1)], [serie(12, h.q1, { event: 'pull_request' })]);
    const resultat = lancerPerimetre({ branche: 'fusion-documentation', evenement: 'push', avant: h.c0, donnees });
    attendreSorties(resultat, COMPLETE, h.documentation.arbre);
    assert.ok(resultat.appels.some((url) => url.includes(`name=serie-validee-${h.arbreAvant}&`)), `artefact de l'arbre de before demandé : ${resultat.appels.join(' ')}`);
  });
  // Audit droits et sécurité de #546, N2 : une PR empilée dont la tête est before (et dont la base porterait un autre
  // workflow) n'atteste pas l'arbre de before.
  it('push de documentation dont l\'arbre précédent n\'est attesté que par une PR de tête before : série complète', () => {
    for (const surcharges of [{ event: 'pull_request', head_branch: 'branche-empilee' }, { head_branch: 'autre' }, { event: 'pull_request' }]) {
      const donnees = api([artefact(h.arbreAvant, 14, h.c0)], [serie(14, h.c0, surcharges)]);
      attendreSorties(lancerPerimetre({ branche: 'fusion-documentation', evenement: 'push', avant: h.c0, donnees }), COMPLETE, h.documentation.arbre);
    }
  });
  it('push de documentation sans attestation de l\'arbre précédent : série complète', () => {
    attendreSorties(lancerPerimetre({ branche: 'fusion-documentation', evenement: 'push', avant: h.c0 }), COMPLETE, h.documentation.arbre);
  });
  it('push dont l\'arbre de tête est attesté par la série de la PR fusionnée (HEAD^2) : série dédoublonnée', () => {
    const donnees = api([artefact(h.code.arbre, 21, h.code.tete)], [serie(21, h.code.tete, { event: 'pull_request' })]);
    attendreSorties(lancerPerimetre({ branche: 'fusion-code', evenement: 'push', avant: h.c0, donnees }), DEDOUBLONNEE, h.code.arbre);
  });
  it('push dont l\'arbre de tête est attesté par la série de main du commit lui-même (HEAD) : série dédoublonnée', () => {
    const donnees = api([artefact(h.code.arbre, 22, h.code.fusion)], [serie(22, h.code.fusion)]);
    attendreSorties(lancerPerimetre({ branche: 'fusion-code', evenement: 'push', avant: h.c0, donnees }), DEDOUBLONNEE, h.code.arbre);
  });
  it('push dont l\'arbre de tête n\'est attesté que par une série de HEAD^1 : série complète', () => {
    const donnees = api([artefact(h.code.arbre, 23, h.c0)], [serie(23, h.c0)]);
    attendreSorties(lancerPerimetre({ branche: 'fusion-code', evenement: 'push', avant: h.c0, donnees }), COMPLETE, h.code.arbre);
  });
  it('push qui touche .github/** : série complète, même avec l\'arbre de tête attesté', () => {
    const donnees = api(
      [artefact(h.workflow.arbre, 24, h.workflow.tete), artefact(h.arbreAvant, 25, h.c0)],
      [serie(24, h.workflow.tete, { event: 'pull_request' }), serie(25, h.c0)],
    );
    attendreSorties(lancerPerimetre({ branche: 'fusion-workflow', evenement: 'push', avant: h.c0, donnees }), COMPLETE, h.workflow.arbre);
  });
  it('push de documentation dont l\'arbre précédent et l\'arbre de tête sont attestés : « déjà validée » prime', () => {
    const donnees = api(
      [artefact(h.arbreAvant, 31, h.c0), artefact(h.documentation.arbre, 32, h.documentation.tete)],
      [serie(31, h.c0), serie(32, h.documentation.tete, { event: 'pull_request' })],
    );
    attendreSorties(lancerPerimetre({ branche: 'fusion-documentation', evenement: 'push', avant: h.c0, donnees }), DEDOUBLONNEE, h.documentation.arbre);
  });
  // N14 : tous les artefacts du même nom sont lus, page par page (100 par page).
  it('l\'artefact valide en deuxième page, après cent artefacts expirés, atteste l\'arbre de tête', () => {
    const expires = Array.from({ length: 100 }, () => artefact(h.code.arbre, 41, h.code.tete, { expired: true }));
    const donnees = api([...expires, artefact(h.code.arbre, 42, h.code.tete)], [serie(41, h.code.tete), serie(42, h.code.tete)]);
    const resultat = lancerPerimetre({ branche: 'fusion-code', evenement: 'push', avant: h.c0, donnees });
    attendreSorties(resultat, DEDOUBLONNEE, h.code.arbre);
    assert.ok(resultat.appels.some((url) => url.includes(`name=serie-validee-${h.code.arbre}&`) && url.includes('page=2')), resultat.appels.join(' '));
  });
  it('push dont before est la SHA nulle, vide ou introuvable : série complète, sans s\'appuyer sur une attestation', () => {
    const donnees = api(
      [artefact(h.arbreAvant, 51, h.c0), artefact(h.documentation.arbre, 52, h.documentation.tete)],
      [serie(51, h.c0), serie(52, h.documentation.tete, { event: 'pull_request' })],
    );
    for (const avant of ['0'.repeat(40), '', undefined, 'b'.repeat(40)]) {
      attendreSorties(lancerPerimetre({ branche: 'fusion-documentation', evenement: 'push', avant, donnees }), COMPLETE, h.documentation.arbre);
    }
  });
  // Panne de l'API (règle précisée par Claude Code le 14-11-2026, d'après le cadrage : « Tout échec […] mène à la série
  // complète ») : le script ne finit jamais en échec pour une panne (code 0, sorties cohérentes, avertissement) ; une
  // panne ne rend jamais la série dédoublonnée ; une panne sur l'attestation de before donne toujours la série
  // complète ; la série n'est légère que si l'attestation de before a réussi et que le diff n'est que de la
  // documentation (la panne de l'attestation de la tête ne touche que le dédoublonnage).
  describe('panne de l\'API pendant une attestation', () => {
    // Toutes les attestations seraient valides sans la panne : arbre de before (61), arbre de tête de la PR de code
    // (62) et de la PR de documentation (63).
    const artefactsValides = () => [artefact(h.arbreAvant, 61, h.c0), artefact(h.code.arbre, 62, h.code.tete), artefact(h.documentation.arbre, 63, h.documentation.tete)];
    const seriesValides = () => [serie(61, h.c0), serie(62, h.code.tete, { event: 'pull_request' }), serie(63, h.documentation.tete, { event: 'pull_request' })];
    function attendrePanne({ branche, panne = [], panneSeries = [], sansAvant = false }, attendu, arbreSha) {
      const artefacts = artefactsValides().filter((a) => !(sansAvant && a.workflow_run.id === 61));
      const resultat = lancerPerimetre({ branche, evenement: 'push', avant: h.c0, donnees: api(artefacts, seriesValides(), panne, panneSeries) });
      attendreSorties(resultat, attendu, arbreSha);
      assert.equal(sortiesCoherentes(resultat.sorties), true);
      assert.match(resultat.journal, /^::warning::/m, 'la panne est signalée par un avertissement');
    }

    it('panne sur l\'artefact de l\'arbre de before, push de documentation dont la tête serait attestée : série complète', () => {
      attendrePanne({ branche: 'fusion-documentation', panne: [`serie-validee-${h.arbreAvant}`] }, COMPLETE, h.documentation.arbre);
    });
    it('panne sur la série qui atteste l\'arbre de before, push de documentation : série complète', () => {
      attendrePanne({ branche: 'fusion-documentation', panneSeries: [61] }, COMPLETE, h.documentation.arbre);
    });
    it('panne sur l\'attestation de before, push de code dont la tête serait attestée : série complète, jamais dédoublonnée', () => {
      attendrePanne({ branche: 'fusion-code', panne: [`serie-validee-${h.arbreAvant}`] }, COMPLETE, h.code.arbre);
    });
    it('panne sur l\'artefact de l\'arbre de tête, push de code : série complète, jamais dédoublonnée', () => {
      attendrePanne({ branche: 'fusion-code', panne: [`serie-validee-${h.code.arbre}`] }, COMPLETE, h.code.arbre);
    });
    it('panne sur la série qui atteste l\'arbre de tête, push de code : série complète, jamais dédoublonnée', () => {
      attendrePanne({ branche: 'fusion-code', panneSeries: [62] }, COMPLETE, h.code.arbre);
    });
    it('panne sur l\'attestation de la tête, push de documentation dont before est attesté : série légère, jamais dédoublonnée', () => {
      attendrePanne({ branche: 'fusion-documentation', panne: [`serie-validee-${h.documentation.arbre}`] }, LEGERE, h.documentation.arbre);
      attendrePanne({ branche: 'fusion-documentation', panneSeries: [63] }, LEGERE, h.documentation.arbre);
    });
    it('panne sur l\'attestation de la tête, push de documentation dont before n\'est pas attesté : série complète', () => {
      attendrePanne({ branche: 'fusion-documentation', panne: [`serie-validee-${h.documentation.arbre}`], sansAvant: true }, COMPLETE, h.documentation.arbre);
    });
    it('panne sur les deux attestations, push de documentation : série complète', () => {
      attendrePanne({ branche: 'fusion-documentation', panne: [`serie-validee-${h.arbreAvant}`, `serie-validee-${h.documentation.arbre}`] }, COMPLETE, h.documentation.arbre);
    });
  });
  it('un événement autre que pull_request ou push : série complète, même pour de la documentation', () => {
    for (const evenement of ['workflow_dispatch', undefined]) {
      attendreSorties(lancerPerimetre({ branche: 'fusion-documentation', evenement, baseRef: 'main', avant: h.c0 }), COMPLETE, h.documentation.arbre);
    }
  });
});

// Cadrage, périmètre point 3, de bout en bout : code de sortie de la synthèse et sortie `attester`.
describe('CI — le script de synthèse de bout en bout', () => {
  let racine;
  before(() => {
    racine = mkdtempSync(join(tmpdir(), 'perimetre-ci-test-'));
  });
  after(() => {
    if (racine) rmSync(racine, { recursive: true, force: true });
  });
  function lancerSynthese({ evenement, resultats }) {
    const dossier = mkdtempSync(join(racine, 'synthese-'));
    const sorties = join(dossier, 'sorties.txt');
    writeFileSync(sorties, '');
    const env = { PATH: process.env.PATH, HOME: dossier, GITHUB_OUTPUT: sorties };
    if (evenement !== undefined) env.EVENEMENT = evenement;
    if (resultats !== undefined) env.RESULTATS = typeof resultats === 'string' ? resultats : JSON.stringify(resultats);
    const execution = spawnSync(process.execPath, [SCRIPT, 'synthese'], { cwd: dirname(sorties), env, encoding: 'utf8' });
    return { code: execution.status, sorties: lireSorties(sorties), journal: `${execution.stdout}\n${execution.stderr}` };
  }

  it('série complète verte de pull request : code 0 et attestation', () => {
    const r = lancerSynthese({ evenement: 'pull_request', resultats: besoins(SORTIES.complete, 'success') });
    assert.equal(r.code, 0, r.journal);
    assert.deepEqual(r.sorties, { attester: 'true' });
  });
  it('série légère verte de pull request : code 0, sans attestation', () => {
    const r = lancerSynthese({ evenement: 'pull_request', resultats: besoins(SORTIES.documentation, 'skipped') });
    assert.equal(r.code, 0, r.journal);
    assert.deepEqual(r.sorties, { attester: 'false' });
  });
  it('séries légère et dédoublonnée vertes de main : code 0 et attestation', () => {
    for (const resultats of [besoins(SORTIES.documentation, 'skipped'), besoins(SORTIES.dedoublonnee, 'skipped')]) {
      const r = lancerSynthese({ evenement: 'push', resultats });
      assert.equal(r.code, 0, r.journal);
      assert.deepEqual(r.sorties, { attester: 'true' });
    }
  });
  it('série rouge (parcours en échec) : code 1, sans attestation', () => {
    const r = lancerSynthese({ evenement: 'push', resultats: besoins(SORTIES.complete, tousSauf('success', 'parcours', 'failure')) });
    assert.equal(r.code, 1, r.journal);
    assert.deepEqual(r.sorties, { attester: 'false' });
    assert.match(r.journal, /::error::parcours : failure/);
  });
  it('résultats absents ou nuls : code 1, sans attestation', () => {
    for (const resultats of [undefined, 'null', '{}']) {
      const r = lancerSynthese({ evenement: 'push', resultats });
      assert.equal(r.code, 1, `${resultats} : ${r.journal}`);
      assert.deepEqual(r.sorties, { attester: 'false' });
    }
  });
  it('résultats illisibles : la synthèse échoue sans attester', () => {
    const r = lancerSynthese({ evenement: 'push', resultats: '{pas du JSON' });
    assert.notEqual(r.code, 0, r.journal);
    assert.notEqual(r.sorties.attester, 'true');
  });
});
