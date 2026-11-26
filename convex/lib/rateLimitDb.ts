import type { MutationCtx } from "../_generated/server";
import { appError } from "./errors";
import { RATE_LIMITS, consumeToken, type RateLimitKind } from "./rateLimit";

/** Consumes one token without throwing. A mutation that returns normally keeps the spend. */
export async function tryConsume(
  ctx: Pick<MutationCtx, "db">,
  kind: RateLimitKind,
  subject: string,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const key = `${kind}:${subject}`;
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const result = consumeToken(row ? { tokens: row.tokens, updatedAt: row.updatedAt } : null, Date.now(), RATE_LIMITS[kind]);
  if (row) await ctx.db.patch(row._id, result.state);
  else await ctx.db.insert("rateLimits", { key, ...result.state });
  return { allowed: result.allowed, retryAfterMs: result.retryAfterMs };
}

/** Whether a token is available, without spending it. */
export async function hasCapacity(
  ctx: Pick<MutationCtx, "db">,
  kind: RateLimitKind,
  subject: string,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", `${kind}:${subject}`))
    .unique();
  const { allowed, retryAfterMs } = consumeToken(
    row ? { tokens: row.tokens, updatedAt: row.updatedAt } : null,
    Date.now(),
    RATE_LIMITS[kind],
  );
  return { allowed, retryAfterMs };
}

/**
 * Throwing variant: the mutation aborts, so the token is refunded together with
 * everything else the mutation did. Use `tryConsume` when failed attempts must count.
 */
export async function enforceRateLimit(
  ctx: Pick<MutationCtx, "db">,
  kind: RateLimitKind,
  subject: string,
): Promise<void> {
  const { allowed, retryAfterMs } = await tryConsume(ctx, kind, subject);
  if (!allowed) {
    throw appError("RATE_LIMITED", "Too many requests. Slow down and retry shortly.", { retryAfterMs });
  }
}
