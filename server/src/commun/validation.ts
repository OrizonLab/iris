export function nombreDecimalNonNegatif(value: unknown, maxIntegerDigits: number, zeroAutorise = false, maxDecimales = 2): number | null {
  // Ne jamais laisser PostgreSQL arrondir silencieusement une valeur métier ; notation scientifique refusée.
  const texte = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const expression = new RegExp(`^\\d{1,${maxIntegerDigits}}(?:[,.]\\d{1,${maxDecimales}})?$`);
  if (!expression.test(texte)) return null;
  const nombre = Number(texte.replace(',', '.'));
  return Number.isFinite(nombre) && (nombre > 0 || (zeroAutorise && nombre === 0)) ? nombre : null;
}

export function motifCorrectionValide(value: unknown): string | null {
  const motif = typeof value === 'string' ? value.trim() : '';
  // Même métrique Unicode que PostgreSQL : un emoji est un caractère métier, pas deux unités UTF-16.
  return [...motif].length >= 3 && [...motif].length <= 500 ? motif : null;
}

export function motifRestaurationValide(value: unknown): string | null {
  const motif = typeof value === 'string' ? value.trim() : '';
  return [...motif].length >= 3 && [...motif].length <= 500 ? motif : null;
}

// Drapeau d'un corps d'API lu en booléen strict (#587). Lu par `!!`, la chaîne « false » valait vrai et une clé
// absente valait faux : un corps vide désactivait un compte, par exemple. Seuls `true` et `false` sont admis ; toute
// autre valeur présente, `null` compris (comme pour la case « acompte exigé », #570), est refusée. Un corps qui n'est
// pas un objet (absent, scalaire, tableau : Express 5 laisse alors `req.body` à `undefined`) est lu comme vide, donc
// « clé absente », sans erreur. La clé absente est admise (`undefined`) pour un champ facultatif et refusée pour un
// champ obligatoire, celui d'une route qui n'existe que pour le poser. Le refus est rendu, non levé : l'appelant le
// renvoie en 400 avant toute lecture ou écriture en base.
export type LectureBooleen = { ok: true; valeur: boolean | undefined } | { ok: false; erreur: string };
export function booleenStrict(corps: unknown, cle: string, options: { obligatoire: boolean }): LectureBooleen {
  const objet = corps !== null && typeof corps === 'object' && !Array.isArray(corps) ? corps as Record<string, unknown> : {};
  const refus: LectureBooleen = { ok: false, erreur: `« ${cle} » doit valoir true ou false.` };
  if (!Object.hasOwn(objet, cle)) return options.obligatoire ? refus : { ok: true, valeur: undefined };
  const valeur = objet[cle];
  return typeof valeur === 'boolean' ? { ok: true, valeur } : refus;
}
