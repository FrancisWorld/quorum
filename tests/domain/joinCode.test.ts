import { describe, expect, it } from "vitest";
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  formatJoinCode,
  generateJoinCode,
  normalizeJoinCode,
} from "../../convex/lib/joinCode";

describe("join codes", () => {
  it("never uses ambiguous characters", () => {
    for (const ambiguous of ["I", "L", "O", "0", "1"]) expect(JOIN_CODE_ALPHABET).not.toContain(ambiguous);
  });

  it("generates codes of the right length from the alphabet, covering both ends of the random range", () => {
    expect(generateJoinCode(() => 0)).toBe("AAAAAA");
    expect(generateJoinCode(() => 0.999999)).toBe("999999");
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode(Math.random);
      expect(code).toHaveLength(JOIN_CODE_LENGTH);
      expect([...code].every((char) => JOIN_CODE_ALPHABET.includes(char))).toBe(true);
    }
  });

  it("normalises case, spaces and dashes", () => {
    expect(normalizeJoinCode("event7")).toBe("EVENT7");
    expect(normalizeJoinCode(" eve-nt7 ")).toBe("EVENT7");
    expect(normalizeJoinCode("EVE NT7")).toBe("EVENT7");
  });

  it("rejects codes of the wrong length or with characters outside the alphabet", () => {
    expect(normalizeJoinCode("")).toBeNull();
    expect(normalizeJoinCode("ABC")).toBeNull();
    expect(normalizeJoinCode("ABCDEFG")).toBeNull();
    expect(normalizeJoinCode("ABCDE0")).toBeNull();
    expect(normalizeJoinCode("ABCDEI")).toBeNull();
  });

  it("formats with a dash for reading aloud", () => {
    expect(formatJoinCode("EVENT7")).toBe("EVE-NT7");
  });
});
