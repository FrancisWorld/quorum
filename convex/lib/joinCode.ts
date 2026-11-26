/** No I, L, O, 0 or 1: codes are read aloud and typed from a projector. */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 6;

/** `random` returns a float in [0, 1); injected so tests are deterministic. */
export function generateJoinCode(random: () => number): string {
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET.charAt(Math.floor(random() * JOIN_CODE_ALPHABET.length));
  }
  return code;
}

/** Forgiving about case, spaces and dashes ("ab3 k9x" or "AB3-K9X"). Null when it cannot be a code. */
export function normalizeJoinCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]+/g, "");
  if (code.length !== JOIN_CODE_LENGTH) return null;
  for (const char of code) if (!JOIN_CODE_ALPHABET.includes(char)) return null;
  return code;
}

export function formatJoinCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
