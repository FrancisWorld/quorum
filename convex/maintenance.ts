import { internalMutation } from "./_generated/server";

const PRESENCE_RETENTION_MS = 5 * 60_000;
const IDLE_BUCKET_RETENTION_MS = 60 * 60_000;
const BATCH = 200;

/**
 * Housekeeping for rows that are only meaningful while fresh. A rate-limit
 * bucket idle for an hour has fully refilled, so deleting it changes nothing.
 */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stalePresence = await ctx.db
      .query("presence")
      .withIndex("by_seen", (q) => q.lt("seenAt", now - PRESENCE_RETENTION_MS))
      .take(BATCH);
    for (const row of stalePresence) await ctx.db.delete(row._id);

    const idleBuckets = await ctx.db
      .query("rateLimits")
      .withIndex("by_updated", (q) => q.lt("updatedAt", now - IDLE_BUCKET_RETENTION_MS))
      .take(BATCH);
    for (const row of idleBuckets) await ctx.db.delete(row._id);

    return { presence: stalePresence.length, rateLimits: idleBuckets.length };
  },
});
