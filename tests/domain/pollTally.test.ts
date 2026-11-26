import { describe, expect, it } from "vitest";
import { tallyPoll } from "../../convex/lib/pollTally";

const options = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "c", label: "C" },
];

describe("tallyPoll", () => {
  it("reports zeros before anyone votes", () => {
    const result = tallyPoll(options, []);
    expect(result.total).toBe(0);
    expect(result.options.map((o) => o.percent)).toEqual([0, 0, 0]);
  });

  it("uses largest-remainder rounding so percentages sum to 100", () => {
    const result = tallyPoll(options, ["a", "b", "c"]);
    expect(result.options.map((o) => o.percent)).toEqual([34, 33, 33]);
    expect(result.options.reduce((sum, o) => sum + o.percent, 0)).toBe(100);
  });

  it("sums to 100 for awkward splits", () => {
    for (const votes of [
      ["a", "a", "b"],
      ["a", "b", "b", "c", "c", "c", "c"],
      Array.from({ length: 7 }, (_, i) => options[i % 3]!.id),
    ]) {
      const total = tallyPoll(options, votes).options.reduce((sum, o) => sum + o.percent, 0);
      expect(total).toBe(100);
    }
  });

  it("ignores votes for unknown options and keeps option order", () => {
    const result = tallyPoll(options, ["a", "zzz", "a"]);
    expect(result.total).toBe(2);
    expect(result.options.map((o) => [o.id, o.votes, o.percent])).toEqual([
      ["a", 2, 100],
      ["b", 0, 0],
      ["c", 0, 0],
    ]);
  });
});
