import { describe, expect, it } from "vitest";
import { RATE_LIMITS, consumeToken } from "../../convex/lib/rateLimit";

const config = { capacity: 3, refillPerSecond: 1 };

describe("token bucket", () => {
  it("starts full and drains one token per call", () => {
    let state = null as ReturnType<typeof consumeToken>["state"] | null;
    const results = [0, 0, 0, 0].map(() => {
      const result = consumeToken(state, 1_000, config);
      state = result.state;
      return result.allowed;
    });
    expect(results).toEqual([true, true, true, false]);
  });

  it("reports how long until the next token is available", () => {
    const denied = consumeToken({ tokens: 0.25, updatedAt: 0 }, 0, config);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(750);
  });

  it("refills with time but never beyond capacity", () => {
    expect(consumeToken({ tokens: 0, updatedAt: 0 }, 2_000, config).state.tokens).toBeCloseTo(1);
    expect(consumeToken({ tokens: 0, updatedAt: 0 }, 3_600_000, config).state.tokens).toBe(2);
  });

  it("tolerates a clock that moves backwards", () => {
    const result = consumeToken({ tokens: 1, updatedAt: 10_000 }, 5_000, config);
    expect(result.allowed).toBe(true);
    expect(result.state.tokens).toBe(0);
  });

  it("ships budgets that allow a normal burst but stop floods", () => {
    expect(RATE_LIMITS.question.capacity).toBeLessThanOrEqual(5);
    expect(RATE_LIMITS.join.capacity).toBeLessThanOrEqual(5);
  });
});
