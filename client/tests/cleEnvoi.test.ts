import assert from 'node:assert/strict';
import test from 'node:test';
import { nouvelleCleEnvoi } from '../src/lib/cleEnvoi.ts';
import { cleEnvoiValide } from '../../server/src/commun/validation.ts';

// Lot X, clé d'envoi de la création d'un avoir partiel (#247 ; cadrage v2 du 23-11-2026, § 3 et « Tests à écrire » : « unitaire
// (nouvelleCleEnvoi() rend un UUID accepté par cleEnvoiValide, y compris par le repli) »). Le formulaire tire la clé à son
// ouverture (avoir partiel, compte rendu d'intervention du lot 3b-3) ; le serveur la refuse en 400 si elle n'est pas un UUID
// (cleEnvoiValide, server/src/commun/validation.ts, importée ici telle quelle : un écart entre le générateur et la règle du serveur
// est vu par ce test). Hors contexte sécurisé (page servie en HTTP sur le réseau local), `crypto.randomUUID` est absent : le repli
// tire seize octets de `getRandomValues` et pose les bits de version (4) et de variante (10xx).

// Remplace une méthode de `crypto` le temps d'un appel : une propriété propre masque celle du prototype, puis est retirée.
function avecCrypto<T>(remplacements: Record<string, unknown>, travail: () => T): T {
  const noms = Object.keys(remplacements);
  for (const nom of noms) assert.equal(Object.prototype.hasOwnProperty.call(globalThis.crypto, nom), false, `${nom} : aucune propriété propre avant le test`);
  for (const nom of noms) Object.defineProperty(globalThis.crypto, nom, { value: remplacements[nom], configurable: true, writable: true });
  try {
    return travail();
  } finally {
    for (const nom of noms) delete (globalThis.crypto as unknown as Record<string, unknown>)[nom];
  }
}
// Octets fixés à la place du hasard : chaque octet du tableau demandé reçoit `octet(index)`.
const octetsFixes = (octet: (index: number) => number) => (tableau: Uint8Array) => {
  for (let index = 0; index < tableau.length; index += 1) tableau[index] = octet(index);
  return tableau;
};
const FORME_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('nouvelleCleEnvoi : avec crypto.randomUUID, rend l’UUID qu’il tire, accepté tel quel par cleEnvoiValide du serveur ; deux cents tirages tous distincts', () => {
  const fixe = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  assert.equal(avecCrypto({ randomUUID: () => fixe }, () => nouvelleCleEnvoi()), fixe, 'la clé est celle de crypto.randomUUID');
  const tirages = Array.from({ length: 200 }, () => nouvelleCleEnvoi());
  for (const cle of tirages) {
    assert.match(cle, FORME_V4);
    // Accepté et inchangé : le serveur n'enregistre pas une autre clé que celle que le formulaire renvoie.
    assert.equal(cleEnvoiValide(cle), cle, cle);
  }
  assert.equal(new Set(tirages).size, tirages.length, 'aucune clé tirée deux fois');
});

// Repli. Lectures écartées : octets lus sans masque de version (0x00 donne « 0 » en version, refusé par le serveur) ou de variante
// (0xff donne « f », refusé) ; octets dans le désordre (le tableau 0…15 donne une seule chaîne) ; hasard tiré d'ailleurs que de
// getRandomValues (Math.random : les octets fixés ne se retrouveraient pas dans la clé).
test('nouvelleCleEnvoi, repli sans crypto.randomUUID : seize octets de getRandomValues, version 4 et variante posées, dans l’ordre ; clé acceptée par cleEnvoiValide (octets nuls, octets à 0xff, octets 0 à 15) ; deux cents tirages réels tous distincts et acceptés', () => {
  const sansRandomUUID = { randomUUID: undefined };
  const cas: Array<[string, (index: number) => number, string]> = [
    ['octets nuls', () => 0x00, '00000000-0000-4000-8000-000000000000'],
    ['octets à 0xff', () => 0xff, 'ffffffff-ffff-4fff-bfff-ffffffffffff'],
    ['octets 0 à 15', (index) => index, '00010203-0405-4607-8809-0a0b0c0d0e0f'],
  ];
  for (const [quoi, octet, attendue] of cas) {
    let demandes = 0;
    const cle = avecCrypto({ ...sansRandomUUID, getRandomValues: (tableau: Uint8Array) => { demandes += 1; assert.equal(tableau.length, 16, 'seize octets'); return octetsFixes(octet)(tableau); } }, () => nouvelleCleEnvoi());
    assert.equal(demandes, 1, `${quoi} : un appel à getRandomValues`);
    assert.equal(cle, attendue, quoi);
    assert.equal(cleEnvoiValide(cle), cle, `${quoi} : acceptée par le serveur`);
  }
  const tirages = avecCrypto(sansRandomUUID, () => Array.from({ length: 200 }, () => nouvelleCleEnvoi()));
  for (const cle of tirages) {
    assert.match(cle, FORME_V4);
    assert.equal(cleEnvoiValide(cle), cle, cle);
  }
  assert.equal(new Set(tirages).size, tirages.length, 'aucune clé tirée deux fois par le repli');
});

// Règle du serveur, relue côté client : ce que le formulaire ne doit jamais envoyer est refusé (400 « Clé d’envoi de l’avoir
// invalide : rouvrez le formulaire. »), et une clé en majuscules est ramenée en minuscules (le rejeu la retrouve).
test('cleEnvoiValide : UUID en majuscules ramené en minuscules ; chaîne vide, texte, nombre, null, UUID sans tirets, entre accolades, entouré d’espaces, nul ou de variante hors 8 à b refusés', () => {
  const cle = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  assert.equal(cleEnvoiValide(cle.toUpperCase()), cle);
  for (const invalide of ['', 'pas-une-cle', 42, null, undefined, {}, [cle], cle.replaceAll('-', ''), `{${cle}}`, ` ${cle} `, '00000000-0000-0000-0000-000000000000', '3f2504e0-4f89-41d3-ca0c-0305e82c3301']) {
    assert.equal(cleEnvoiValide(invalide), null, JSON.stringify(invalide));
  }
});
