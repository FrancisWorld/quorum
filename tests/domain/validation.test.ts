import { describe, expect, it } from "vitest";
import { errorDataOf } from "../../convex/lib/errors";
import {
  displayName,
  duplicateKey,
  normalizeText,
  validatePollOptions,
  validatePollPrompt,
  validateQuestion,
  validateRoomTitle,
} from "../../convex/lib/validation";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return errorDataOf(error)?.code;
  }
  return undefined;
}

describe("text normalisation", () => {
  it("collapses whitespace and strips control characters", () => {
    expect(normalizeText("  hello \n\t world\u0000!  ")).toBe("hello world !");
  });

  it("treats case-insensitive re-posts as duplicates", () => {
    expect(duplicateKey("  Why   NOT? ")).toBe(duplicateKey("why not?"));
  });
});

describe("validators", () => {
  it("trims and accepts valid input", () => {
    expect(validateRoomTitle("  Town hall ")).toBe("Town hall");
    expect(validateQuestion("What is next?")).toBe("What is next?");
    expect(validatePollPrompt("Pick one")).toBe("Pick one");
  });

  it("enforces length bounds after normalisation", () => {
    expect(codeOf(() => validateQuestion("  a  "))).toBe("VALIDATION");
    expect(codeOf(() => validateQuestion("x".repeat(501)))).toBe("VALIDATION");
    expect(codeOf(() => validateQuestion("x".repeat(500)))).toBeUndefined();
    expect(codeOf(() => validateRoomTitle("ab"))).toBe("VALIDATION");
    expect(codeOf(() => validatePollPrompt("y".repeat(201)))).toBe("VALIDATION");
  });

  it("requires 2 to 8 distinct poll options", () => {
    expect(validatePollOptions(["Yes", " No "])).toEqual(["Yes", "No"]);
    expect(codeOf(() => validatePollOptions(["Only"]))).toBe("VALIDATION");
    expect(codeOf(() => validatePollOptions(Array.from({ length: 9 }, (_, i) => `o${i}`)))).toBe("VALIDATION");
    expect(codeOf(() => validatePollOptions(["Yes", "yes"]))).toBe("VALIDATION");
    expect(codeOf(() => validatePollOptions(["Yes", "   "]))).toBe("VALIDATION");
    expect(codeOf(() => validatePollOptions(["Yes", "n".repeat(81)]))).toBe("VALIDATION");
  });

  it("falls back to Guest and clamps display names", () => {
    expect(displayName(undefined)).toBe("Guest");
    expect(displayName("   ")).toBe("Guest");
    expect(displayName("Ada")).toBe("Ada");
    expect(displayName("n".repeat(200))).toHaveLength(60);
  });
});
