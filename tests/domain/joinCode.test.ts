import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_BITS,
  JOIN_CODE_LENGTH,
  formatJoinCode,
  generateJoinCode,
  normalizeJoinCode,
  secureRandomIndex,
} from "../../convex/lib/joinCode";

afterEach(() => vi.restoreAllMocks());

describe("join codes", () => {
  it("never uses ambiguous characters", () => {
    for (const ambiguous of ["I", "L", "O", "0", "1"]) expect(JOIN_CODE_ALPHABET).not.toContain(ambiguous);
  });

  it("carries about 40 bits", () => {
    expect(JOIN_CODE_LENGTH).toBeGreaterThanOrEqual(8);
    expect(JOIN_CODE_BITS).toBeGreaterThan(39);
    expect(JOIN_CODE_BITS).toBeLessThan(40);
  });

  it("maps the first and last index of every position, and stays within length and alphabet", () => {
    expect(generateJoinCode(() => 0)).toBe("AAAAAAAA");
    expect(generateJoinCode((max) => max - 1)).toBe("99999999");
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      expect(code).toHaveLength(JOIN_CODE_LENGTH);
      expect([...code].every((char) => JOIN_CODE_ALPHABET.includes(char))).toBe(true);
    }
  });

  it("normalises case, spaces and dashes", () => {
    expect(normalizeJoinCode("keyn4m7t")).toBe("KEYN4M7T");
    expect(normalizeJoinCode(" keyn-4m7t ")).toBe("KEYN4M7T");
    expect(normalizeJoinCode("KEYN 4M7T")).toBe("KEYN4M7T");
  });

  it("rejects codes of the wrong length or with characters outside the alphabet", () => {
    expect(normalizeJoinCode("")).toBeNull();
    expect(normalizeJoinCode("ABC")).toBeNull();
    expect(normalizeJoinCode("ABCDEF")).toBeNull();
    expect(normalizeJoinCode("ABCDEFGHJ")).toBeNull();
    expect(normalizeJoinCode("ABCDEFG0")).toBeNull();
    expect(normalizeJoinCode("ABCDEFGI")).toBeNull();
  });

  it("formats as two groups of four for reading aloud", () => {
    expect(formatJoinCode("KEYNT4M7")).toBe("KEYN-T4M7");
  });
});

describe("secureRandomIndex", () => {
  it("is uniform enough over a small range", () => {
    const counts = new Array<number>(5).fill(0);
    for (let i = 0; i < 20_000; i++) counts[secureRandomIndex(5)]!++;
    for (const count of counts) expect(Math.abs(count - 4_000)).toBeLessThan(400);
  });

  it("rejects draws from the biased tail instead of folding them with a modulo", () => {
    // max=3 leaves a 1-value tail at the top of the 32-bit range (2^32 mod 3 = 1).
    const draws = [0xffffffff, 4];
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation(((array: Uint32Array) => {
      array[0] = draws.shift() as number;
      return array;
    }) as typeof crypto.getRandomValues);
    expect(secureRandomIndex(3)).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("validates its argument", () => {
    expect(() => secureRandomIndex(0)).toThrow(RangeError);
    expect(() => secureRandomIndex(1.5)).toThrow(RangeError);
  });
});
