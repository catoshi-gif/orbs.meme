const encoder = new TextEncoder();

// Anchor discriminators are fixed at build time; these are the audited values for
// the two client-inspected instructions. Keeping this tiny helper browser-safe
// avoids importing node:crypto into wallet-facing code.
const KNOWN: Record<string, Uint8Array> = {
  "global:fund_orb": Uint8Array.from([7, 100, 100, 66, 241, 55, 73, 250]),
  "global:claim_prize": Uint8Array.from([157, 233, 139, 121, 246, 62, 234, 235]),
};

export function createHash(value: string) {
  const known = KNOWN[value];
  if (!known) throw new Error(`Unknown audited discriminator ${value}`);
  return known;
}

export const utf8 = (value: string) => encoder.encode(value);
