import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBELLES_STATUT_CHANTIER, libelleStatutChantier } from '../src/lib/statutsChantier.ts';

// Lot V, fiche et liste des chantiers (#390 et #392 ; cadrage v2, « Administration > Chantiers » et périmètre : une
// bibliothèque de libellés de statut d'un chantier, partagée par ChantierEnTete.tsx et Admin.tsx). Libellés : choix
// d'affichage par défaut, à confirmer (règle 5) : « En cours », « Terminé », « Annulé », ceux que la fiche affichait déjà
// depuis #449. Un écran n'affiche plus jamais le code brut (« EN_COURS » dans Administration > Chantiers, #390, N2) ; un code
// inconnu reste affiché tel quel, pour ne rien masquer (consigne de Claude Code, comme libellesFacture.ts).

// Clés que tout objet JavaScript hérite : un code de ce nom n'est pas un code connu. Lecture écartée : une table lue par
// `libelles[code] ?? code`, qui rendrait une fonction (`toString`, `constructor`…) ou `Object.prototype` (`__proto__`) au
// lieu du code (même garde que libellesFacture.test.ts).
const CLES_HERITEES = ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'];

test('statut d’un chantier : « En cours », « Terminé », « Annulé », et non le code (« EN_COURS », « TERMINE », « ANNULE »)', () => {
  // Lecture écartée : le code brut d'Administration > Chantiers avant le lot (Admin.tsx, `{c.statut}`).
  assert.equal(libelleStatutChantier('EN_COURS'), 'En cours');
  assert.equal(libelleStatutChantier('TERMINE'), 'Terminé');
  assert.equal(libelleStatutChantier('ANNULE'), 'Annulé');
  // Une seule table, partagée : elle porte les trois statuts d'un chantier et eux seuls (EN_COURS et TERMINE, seuls admis par
  // PATCH /api/chantiers/:id/statut ; ANNULE, posé par l'annulation du devis ; STATUT_CHANTIER de chantiers/document.ts).
  assert.deepEqual(LIBELLES_STATUT_CHANTIER, { EN_COURS: 'En cours', TERMINE: 'Terminé', ANNULE: 'Annulé' });
});

test('statut inconnu affiché tel quel, y compris une clé héritée de l’objet ; ni masqué, ni remplacé par un libellé voisin', () => {
  // Lectures écartées : un code inconnu masqué (chaîne vide, tiret), remplacé par « En cours » (repli sur le premier statut),
  // ou lu sans tenir compte de la casse (« annule » n'est pas « ANNULE »).
  for (const code of ['SUSPENDU', 'annule', 'En cours', '', ...CLES_HERITEES]) {
    assert.equal(libelleStatutChantier(code), code, `code ${JSON.stringify(code)}`);
    assert.equal(typeof libelleStatutChantier(code), 'string', `code ${JSON.stringify(code)} : une chaîne, et non une fonction ou un objet`);
  }
});

// Une seule table de libellés (cadrage v2, périmètre) : la fiche (ChantierEnTete.tsx) et Administration > Chantiers
// (Admin.tsx) l'emploient, et aucune des deux ne garde sa propre table ni n'affiche le code brut. Garde sur les sources,
// comme celles de formats.test.ts ; l'E2E chantiers-formats-anglais.spec.ts montre les libellés à l'écran.
const racineClient = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relatif: string) => readFileSync(path.join(racineClient, 'src', relatif), 'utf8');

test('la fiche et Administration > Chantiers emploient la table partagée, sans table locale ni code brut affiché', () => {
  // Témoins, recopiés de 8f2a133 : la table locale de la fiche (ChantierEnTete.tsx:8) et le badge brut de l'administration
  // (Admin.tsx:633).
  const TABLE_LOCALE = /\b(?:const|let|var)\s+STATUT_LABELS\b|\{\s*EN_COURS\s*:\s*'En cours'/;
  const STATUT_BRUT = /\{\s*c\.statut\s*\}/;
  assert.match("const STATUT_LABELS: Record<string, string> = { EN_COURS: 'En cours', TERMINE: 'Terminé', ANNULE: 'Annulé' };", TABLE_LOCALE);
  assert.match('                    {c.statut}', STATUT_BRUT);
  assert.doesNotMatch('{libelleStatutChantier(c.statut)}', STATUT_BRUT);
  for (const fichier of ['components/ChantierEnTete.tsx', 'pages/Admin.tsx']) {
    const texte = source(fichier);
    assert.match(texte, /from '\.\.\/lib\/statutsChantier'/, `${fichier} : la table partagée est importée`);
    assert.match(texte, /\blibelleStatutChantier\(/, `${fichier} : le libellé passe par libelleStatutChantier`);
    assert.doesNotMatch(texte, TABLE_LOCALE, `${fichier} : table de libellés locale`);
    assert.doesNotMatch(texte, STATUT_BRUT, `${fichier} : statut brut affiché`);
  }
});
