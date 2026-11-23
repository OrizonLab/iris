// Clé d'envoi tirée à l'ouverture d'un formulaire qui enregistre une pièce figée (compte rendu d'intervention, lot 3b-3 ;
// avoir partiel, lot X, #247) : un nouvel envoi après une réponse perdue retrouve la pièce déjà enregistrée au lieu d'en
// figer une seconde. Un UUID v4 ; hors contexte sécurisé (`crypto.randomUUID` absent), il est tiré de `getRandomValues`.
export function nouvelleCleEnvoi(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const octets = crypto.getRandomValues(new Uint8Array(16));
  octets[6] = (octets[6] & 0x0f) | 0x40;
  octets[8] = (octets[8] & 0x3f) | 0x80;
  const hex = Array.from(octets, (octet) => octet.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
