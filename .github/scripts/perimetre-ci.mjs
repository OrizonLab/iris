#!/usr/bin/env node
// Périmètre des changements et synthèse de la CI (dépôt privé, 2 000 minutes GitHub Actions par mois ; décision de
// Nelson du 14-11-2026 : « Réduis sa consommation sans affaiblir les contrôles »). Sans dépendance.
//
//   node .github/scripts/perimetre-ci.mjs perimetre   → sorties du travail « Périmètre des changements »
//   node .github/scripts/perimetre-ci.mjs synthese    → verdict du travail « CI — synthèse » (code 0 ou 1)
//
// Les décisions sont des fonctions pures, testées par perimetre-ci.test.mjs en tête du travail de périmètre ; les
// entrées et sorties (git, API GitHub, fichiers du runner) restent dans `perimetre()` et `synthese()`.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TRAVAUX_LOURDS = ['compose', 'backend', 'tests', 'frontend', 'parcours'];
export const WORKFLOW = '.github/workflows/ci.yml';
const SHA_NULLE = /^0+$/;

// Documentation : tout fichier sous docs/, tout fichier Markdown, la licence, hors des dossiers que Vite livre
// (client/src, client/public : un `.md` peut y être importé) et hors de server/prisma : Prisma tient tout dossier de
// migrations/ pour une migration, et un dossier qui ne porte qu'un README.md fait échouer `prisma migrate deploy`
// (P3015), dans les travaux « Backend — tests » et « Frontend — parcours utilisateur » comme au déploiement. Les seuls
// tests de la CI qui lisent ces fichiers (server/tests/environnement.test.mjs, tests unitaires du client dont
// identite.test.ts) tournent dans le travail de périmètre quand la série ne porte que de la documentation.
export function estDocumentation(chemin) {
  if (['client/src/', 'client/public/', 'server/prisma/'].some((dossier) => chemin.startsWith(dossier))) return false;
  return chemin.startsWith('docs/') || chemin.endsWith('.md') || chemin === 'LICENSE';
}

// Sortie de `git diff --name-only -z` : chemins séparés par NUL, sans échappement des espaces ni des guillemets.
export function cheminsDeDiff(sortie) {
  return sortie.split('\0').filter((chemin) => chemin.length > 0);
}

// Vrai seulement pour une liste non vide de documentation : une liste vide (diff impossible, premier push) donne une
// série complète.
export function documentationSeule(fichiers) {
  return fichiers.length > 0 && fichiers.every(estDocumentation);
}

export const toucheLeWorkflow = (fichiers) => fichiers.some((chemin) => chemin.startsWith('.github/'));

// Un arbre est attesté par un artefact `serie-validee-<arbre>` : non expiré, déposé par une série réussie de ce
// workflow, de ce dépôt, dont la tête est l'une des têtes admises. `series` associe l'identifiant d'une série à sa
// description par l'API (event, conclusion, path, head_sha, head_branch, repository.id). `exigences` : champs que la
// série doit porter en plus (pour l'arbre de before : une série de push sur main, et non une PR empilée dont la tête
// serait ce commit et dont la base porterait un autre workflow ; audit droits et sécurité de #546, N2).
export function arbreAtteste({ artefacts, series, depotId, tetesAdmises, exigences = {} }) {
  return artefacts.some((artefact) => {
    if (artefact.expired) return false;
    const serie = series.get(artefact.workflow_run?.id);
    if (!serie) return false;
    return serie.conclusion === 'success'
      && serie.path === WORKFLOW
      && serie.repository?.id === depotId
      && artefact.workflow_run.repository_id === depotId
      && tetesAdmises.includes(serie.head_sha)
      && serie.head_sha === artefact.workflow_run.head_sha
      && Object.entries(exigences).every(([cle, valeur]) => serie[cle] === valeur);
  });
}

// Décision du périmètre, à partir de faits déjà établis :
// - pull request : `fichiers` = base..commit de fusion testé ; `baseRef` = branche de base ;
// - push sur main : `fichiers` = before..HEAD ; `avantAtteste` = l'arbre de before est attesté par la série de main de
//   before ; `teteAttestee` = l'arbre de HEAD est attesté (tête de la PR fusionnée ou HEAD).
export function decider({ evenement, baseRef, fichiers, avantAtteste = false, teteAttestee = false }) {
  // Un autre événement que ceux du workflow : série complète.
  if (evenement !== 'pull_request' && evenement !== 'push') return { documentation_seule: false, deja_validee: false, lourds: true };
  let documentation = documentationSeule(fichiers);
  if (evenement === 'pull_request' && baseRef !== 'main') documentation = false; // PR empilée : série complète
  if (evenement === 'push' && !avantAtteste) documentation = false; // arbre parent jamais validé : série complète
  let deja = evenement === 'push' && teteAttestee && fichiers.length > 0 && !toucheLeWorkflow(fichiers);
  if (deja) documentation = false; // l'attestation de l'arbre exact prime
  if (evenement !== 'push') deja = false;
  return { documentation_seule: documentation, deja_validee: deja, lourds: !(documentation || deja) };
}

// Les sorties du périmètre ne sont admises que si chacune vaut « true » ou « false » et si `lourds` est la négation
// exacte de « documentation seule ou déjà validée ».
export function sortiesCoherentes(sorties) {
  const valeurs = ['documentation_seule', 'deja_validee', 'lourds'].map((cle) => sorties?.[cle]);
  if (!valeurs.every((valeur) => valeur === 'true' || valeur === 'false')) return false;
  const [documentation, deja, lourds] = valeurs.map((valeur) => valeur === 'true');
  if (documentation && deja) return false;
  return lourds === !(documentation || deja);
}

// Verdict de la synthèse, fermé par défaut : vert seulement si le périmètre a réussi avec des sorties cohérentes, si
// aucun travail n'a échoué ni été annulé, et si exactement un des trois chemins est rempli.
export function verdictSynthese(besoins, evenement) {
  const raisons = [];
  const perimetre = besoins?.perimetre;
  if (!perimetre || perimetre.result !== 'success') raisons.push(`périmètre : ${perimetre?.result ?? 'absent'}`);
  for (const [nom, besoin] of Object.entries(besoins ?? {})) {
    if (besoin?.result === 'failure' || besoin?.result === 'cancelled') raisons.push(`${nom} : ${besoin.result}`);
  }
  const sorties = perimetre?.outputs ?? {};
  if (!sortiesCoherentes(sorties)) raisons.push(`périmètre : sorties incohérentes ${JSON.stringify(sorties)}`);
  const resultats = TRAVAUX_LOURDS.map((nom) => besoins?.[nom]?.result ?? 'absent');
  const tousReussis = resultats.every((resultat) => resultat === 'success');
  const tousSautes = resultats.every((resultat) => resultat === 'skipped');
  const chemins = [
    sorties.lourds === 'true' && tousReussis,
    sorties.lourds === 'false' && sorties.documentation_seule === 'true' && sorties.deja_validee === 'false' && tousSautes,
    sorties.lourds === 'false' && sorties.deja_validee === 'true' && sorties.documentation_seule === 'false' && evenement === 'push' && tousSautes,
  ].filter(Boolean).length;
  if (chemins !== 1) raisons.push(`aucun chemin vert exact (travaux lourds : ${TRAVAUX_LOURDS.map((nom, i) => `${nom}=${resultats[i]}`).join(', ')})`);
  return { vert: raisons.length === 0, raisons: [...new Set(raisons)] };
}

// L'arbre d'une série verte est attesté si elle l'a testé (série complète) ou l'a dérivé d'un arbre attesté (série
// légère ou dédoublonnée de main). Une série légère de pull request n'atteste rien.
export function doitAttester({ evenement, sorties }) {
  if (sorties.lourds === 'true') return true;
  return evenement === 'push';
}

// --- Entrées et sorties ---------------------------------------------------------------------------------------------

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function fichiersChanges(depuis, jusqua) {
  try {
    return cheminsDeDiff(git('diff', '--name-only', '--no-renames', '-z', depuis, jusqua));
  } catch {
    return [];
  }
}

async function api(chemin) {
  const reponse = await fetch(`https://api.github.com/${chemin}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!reponse.ok) throw new Error(`API ${chemin} : ${reponse.status}`);
  return reponse.json();
}

// Tous les artefacts du nom, page par page, puis la série de chacun.
async function attestation(depot, depotId, arbre, tetesAdmises, exigences = {}) {
  const artefacts = [];
  for (let page = 1; ; page += 1) {
    const { artifacts } = await api(`repos/${depot}/actions/artifacts?name=serie-validee-${arbre}&per_page=100&page=${page}`);
    artefacts.push(...artifacts);
    if (artifacts.length < 100) break;
  }
  const series = new Map();
  for (const id of new Set(artefacts.map((artefact) => artefact.workflow_run?.id).filter(Boolean))) {
    series.set(id, await api(`repos/${depot}/actions/runs/${id}`));
  }
  return arbreAtteste({ artefacts, series, depotId, tetesAdmises, exigences });
}

async function perimetre() {
  const evenement = process.env.EVENEMENT;
  const depot = process.env.DEPOT;
  const depotId = Number(process.env.DEPOT_ID);
  const arbre = git('rev-parse', 'HEAD^{tree}').trim();
  const faits = { evenement, baseRef: process.env.BASE_REF, fichiers: [] };
  if (evenement === 'pull_request') {
    faits.fichiers = fichiersChanges('HEAD^1', 'HEAD');
  } else if (evenement === 'push') {
    const avant = process.env.AVANT ?? '';
    const tete = git('rev-parse', 'HEAD').trim();
    if (avant && !SHA_NULLE.test(avant)) {
      try {
        git('fetch', '--no-tags', '--depth=1', 'origin', avant);
        faits.fichiers = fichiersChanges(avant, 'HEAD');
        const arbreAvant = git('rev-parse', `${avant}^{tree}`).trim();
        faits.avantAtteste = await attestation(depot, depotId, arbreAvant, [avant], { event: 'push', head_branch: 'main' });
      } catch (erreur) {
        console.log(`::warning::arbre précédent illisible (${erreur.message}) : série complète`);
        faits.fichiers = [];
      }
    }
    let secondParent = null;
    try { secondParent = git('rev-parse', 'HEAD^2').trim(); } catch { /* pas un commit de fusion */ }
    if (faits.fichiers.length > 0 && !toucheLeWorkflow(faits.fichiers)) {
      // Une panne de l'API mène à la série complète, comme tout échec du calcul.
      try {
        faits.teteAttestee = await attestation(depot, depotId, arbre, [tete, secondParent].filter(Boolean));
      } catch (erreur) {
        console.log(`::warning::attestation de l'arbre illisible (${erreur.message}) : série complète`);
        faits.teteAttestee = false;
      }
    }
  }
  const decision = decider(faits);
  const sorties = Object.fromEntries(Object.entries(decision).map(([cle, valeur]) => [cle, String(valeur)]));
  if (!sortiesCoherentes(sorties)) throw new Error(`sorties incohérentes : ${JSON.stringify(sorties)}`);
  const lignes = [`arbre=${arbre}`, ...Object.entries(sorties).map(([cle, valeur]) => `${cle}=${valeur}`)];
  appendFileSync(process.env.GITHUB_OUTPUT, `${lignes.join('\n')}\n`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '### Périmètre de la série',
    `- fichiers changés : ${faits.fichiers.length}`,
    `- documentation seule : ${sorties.documentation_seule}`,
    `- arbre déjà validé : ${sorties.deja_validee}`,
    `- travaux lourds : ${sorties.lourds}`,
    '',
  ].join('\n'));
  console.log(faits.fichiers.join('\n'));
  console.log(JSON.stringify(sorties));
}

function synthese() {
  const evenement = process.env.EVENEMENT;
  const besoins = JSON.parse(process.env.RESULTATS ?? '{}');
  const { vert, raisons } = verdictSynthese(besoins, evenement);
  for (const raison of raisons) console.log(`::error::${raison}`);
  const attester = vert && doitAttester({ evenement, sorties: besoins.perimetre.outputs });
  appendFileSync(process.env.GITHUB_OUTPUT, `attester=${attester}\n`);
  console.log(vert ? 'Série verte.' : 'Série rouge.');
  return vert ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const commande = process.argv[2];
  if (commande === 'perimetre') perimetre().catch((erreur) => { console.error(erreur); process.exitCode = 1; });
  else if (commande === 'synthese') process.exitCode = synthese();
  else { console.error('Usage : perimetre-ci.mjs perimetre | synthese'); process.exitCode = 2; }
}
