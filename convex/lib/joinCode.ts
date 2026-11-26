/** No I, L, O, 0 or 1: codes are read aloud and typed from a projector. */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 8;
const GROUP = 4;

/** Entropy of one code in bits, assuming a uniform draw: 8 * log2(31), about 39.6. */
export const JOIN_CODE_BITS = JOIN_CODE_LENGTH * Math.log2(JOIN_CODE_ALPHABET.length);

/** Returns an integer in [0, max). */
export type RandomIndex = (max: number) => number;

/**
 * Uniform integer in [0, max) from `crypto.getRandomValues`. Draws that fall in
 * the uneven tail of the 32-bit range are rejected instead of folded in with
 * a modulo, so no symbol is more likely than another.
 */
export const secureRandomIndex: RandomIndex = (max) => {
  if (!Number.isInteger(max) || max < 1 || max > 2 ** 32) throw new RangeError("max must be an integer in [1, 2^32]");
  const limit = Math.floor(2 ** 32 / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] as number;
    if (value < limit) return value % max;
  }
};

export function generateJoinCode(randomIndex: RandomIndex = secureRandomIndex): string {
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) code += JOIN_CODE_ALPHABET.charAt(randomIndex(JOIN_CODE_ALPHABET.length));
  return code;
}

/** Forgiving about case, spaces and dashes ("abcd efgh" or "ABCD-EFGH"). Null when it cannot be a code. */
export function normalizeJoinCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]+/g, "");
  if (code.length !== JOIN_CODE_LENGTH) return null;
  for (const char of code) if (!JOIN_CODE_ALPHABET.includes(char)) return null;
  return code;
}

/** `ABCDEFGH` becomes `ABCD-EFGH`. */
export function formatJoinCode(code: string): string {
  return `${code.slice(0, GROUP)}-${code.slice(GROUP)}`;
}
