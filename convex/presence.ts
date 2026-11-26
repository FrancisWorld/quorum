import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMembership } from "./lib/access";
import { tryConsume } from "./lib/rateLimitDb";
import { PRESENCE_NAME_LIMIT, PRESENCE_TTL_MS, type PresenceView } from "./lib/views";

const ROW_CAP = 1000;

/**
 * Upserts the caller's presence row. Clients ping every ~15 s. Over-eager
 * clients are throttled quietly (`recorded: false`) instead of erroring.
 */
export const heartbeat = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args): Promise<{ recorded: boolean }> => {
    const { caller, room } = await requireMembership(ctx, args.roomId);
    const limit = await tryConsume(ctx, "heartbeat", `${room._id}:${caller.userId}`);
    if (!limit.allowed) return { recorded: false };

    const row = await ctx.db
      .query("presence")
      .withIndex("by_room_user", (q) => q.eq("roomId", room._id).eq("userId", caller.userId))
      .unique();
    const seenAt = Date.now();
    if (row) await ctx.db.patch(row._id, { seenAt, name: caller.name });
    else await ctx.db.insert("presence", { roomId: room._id, userId: caller.userId, name: caller.name, seenAt });
    return { recorded: true };
  },
});

export const leave = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const { caller, room } = await requireMembership(ctx, args.roomId);
    const row = await ctx.db
      .query("presence")
      .withIndex("by_room_user", (q) => q.eq("roomId", room._id).eq("userId", caller.userId))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

/**
 * Who is here now. A query only re-runs when data changes, so the client also
 * filters by `seenAt`; the periodic heartbeats keep results fresh in practice.
 */
export const list = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args): Promise<PresenceView> => {
    const { room } = await requireMembership(ctx, args.roomId);
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_room_seen", (q) => q.eq("roomId", room._id).gt("seenAt", cutoff))
      .take(ROW_CAP);
    return { count: rows.length, names: rows.slice(0, PRESENCE_NAME_LIMIT).map((row) => row.name) };
  },
});
