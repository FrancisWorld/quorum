import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  requireCaller,
  requireMembership,
  requirePermission,
} from "./lib/access";
import { appError } from "./lib/errors";
import { generateJoinCode, normalizeJoinCode } from "./lib/joinCode";
import { canSpotlight } from "./lib/moderation";
import { enforceRateLimit, hasCapacity, tryConsume } from "./lib/rateLimitDb";
import { validateRoomTitle } from "./lib/validation";
import type { JoinResult, MemberView, RoomSummary, RoomView } from "./lib/views";

const CODE_ATTEMPTS = 10;
const PENDING_COUNT_CAP = 99;

export const create = mutation({
  args: { title: v.string(), moderated: v.boolean() },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx);
    const title = validateRoomTitle(args.title);
    await enforceRateLimit(ctx, "createRoom", caller.userId);

    let code: string | null = null;
    for (let attempt = 0; attempt < CODE_ATTEMPTS && code === null; attempt++) {
      const candidate = generateJoinCode();
      const taken = await ctx.db
        .query("rooms")
        .withIndex("by_code", (q) => q.eq("code", candidate))
        .unique();
      if (!taken) code = candidate;
    }
    if (code === null) throw appError("CONFLICT", "Could not allocate a join code. Try again.");

    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code,
      title,
      hostId: caller.userId,
      status: "open",
      moderated: args.moderated,
      createdAt: now,
    });
    await ctx.db.insert("members", {
      roomId,
      userId: caller.userId,
      name: caller.name,
      role: "host",
      joinedAt: now,
    });
    return { roomId, code };
  },
});

const GLOBAL = "global";

/**
 * Guessing defences, in order:
 * 1. a per-user bucket spent by every attempt;
 * 2. a deployment-wide bucket spent only by misses. While it is empty, joins are
 *    refused for everyone, valid codes included (otherwise a valid answer would
 *    still reveal a hit). The price is that a sustained flood of bad guesses can
 *    pause new joins; existing members are unaffected.
 * Failure is a normal result, not a thrown error: a throw would roll back the
 * tokens, and code guessing is exactly what the limits are for.
 */
export const join = mutation({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<JoinResult> => {
    const caller = await requireCaller(ctx);
    const limit = await tryConsume(ctx, "join", caller.userId);
    if (!limit.allowed) return { status: "rate_limited", retryAfterMs: limit.retryAfterMs };
    const global = await hasCapacity(ctx, "joinFailure", GLOBAL);
    if (!global.allowed) return { status: "rate_limited", retryAfterMs: global.retryAfterMs };

    const code = normalizeJoinCode(args.code);
    const room = code
      ? await ctx.db
          .query("rooms")
          .withIndex("by_code", (q) => q.eq("code", code))
          .unique()
      : null;
    if (!room) {
      await tryConsume(ctx, "joinFailure", GLOBAL);
      return { status: "not_found" };
    }

    const existing = await ctx.db
      .query("members")
      .withIndex("by_room_user", (q) => q.eq("roomId", room._id).eq("userId", caller.userId))
      .unique();
    if (!existing) {
      await ctx.db.insert("members", {
        roomId: room._id,
        userId: caller.userId,
        name: caller.name,
        role: "participant",
        joinedAt: Date.now(),
      });
    } else if (existing.name !== caller.name) {
      await ctx.db.patch(existing._id, { name: caller.name });
    }
    return { status: "joined", roomId: room._id };
  },
});

export const get = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args): Promise<RoomView> => {
    const { room, member } = await requireMembership(ctx, args.roomId);
    let pendingCount = 0;
    if (member.role !== "participant") {
      const pending = await ctx.db
        .query("questions")
        .withIndex("by_room_status_votes", (q) => q.eq("roomId", room._id).eq("status", "pending"))
        .take(PENDING_COUNT_CAP);
      pendingCount = pending.length;
    }
    return {
      id: room._id,
      code: room.code,
      title: room.title,
      status: room.status,
      moderated: room.moderated,
      role: member.role,
      pendingCount,
    };
  },
});

export const mine = query({
  args: {},
  handler: async (ctx): Promise<RoomSummary[]> => {
    const caller = await requireCaller(ctx);
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", caller.userId))
      .order("desc")
      .take(50);
    const summaries: RoomSummary[] = [];
    for (const membership of memberships) {
      const room = await ctx.db.get(membership.roomId);
      if (room) {
        summaries.push({ id: room._id, code: room.code, title: room.title, status: room.status, role: membership.role });
      }
    }
    return summaries;
  },
});

export const update = mutation({
  args: {
    roomId: v.id("rooms"),
    moderated: v.optional(v.boolean()),
    status: v.optional(v.union(v.literal("open"), v.literal("closed"))),
  },
  handler: async (ctx, args) => {
    const access = await requireMembership(ctx, args.roomId);
    requirePermission(access, "manageRoom");
    const patch: { moderated?: boolean; status?: "open" | "closed" } = {};
    if (args.moderated !== undefined) patch.moderated = args.moderated;
    if (args.status !== undefined) patch.status = args.status;
    await ctx.db.patch(access.room._id, patch);
  },
});

export const setSpotlight = mutation({
  args: { roomId: v.id("rooms"), questionId: v.union(v.id("questions"), v.null()) },
  handler: async (ctx, args) => {
    const access = await requireMembership(ctx, args.roomId);
    requirePermission(access, "present");
    if (args.questionId === null) {
      await ctx.db.patch(access.room._id, { spotlightQuestionId: undefined });
      return;
    }
    const question = await ctx.db.get(args.questionId);
    if (!question || question.roomId !== access.room._id) throw appError("NOT_FOUND", "Question not found.");
    if (!canSpotlight(question.status)) {
      throw appError("CONFLICT", "Only open questions can be put on the presenter screen.");
    }
    await ctx.db.patch(access.room._id, { spotlightQuestionId: question._id });
  },
});

export const members = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args): Promise<MemberView[]> => {
    const access = await requireMembership(ctx, args.roomId);
    requirePermission(access, "manageRoom");
    const rows = await ctx.db
      .query("members")
      .withIndex("by_room_user", (q) => q.eq("roomId", args.roomId))
      .take(200);
    return rows.map((row) => ({ userId: row.userId, name: row.name, role: row.role }));
  },
});

export const setRole = mutation({
  args: {
    roomId: v.id("rooms"),
    userId: v.string(),
    role: v.union(v.literal("moderator"), v.literal("participant")),
  },
  handler: async (ctx, args) => {
    const access = await requireMembership(ctx, args.roomId);
    requirePermission(access, "manageRoom");
    const target = await ctx.db
      .query("members")
      .withIndex("by_room_user", (q) => q.eq("roomId", args.roomId).eq("userId", args.userId))
      .unique();
    if (!target) throw appError("NOT_FOUND", "That person has not joined this room.");
    if (target.role === "host") throw appError("FORBIDDEN", "The host role cannot be changed.");
    await ctx.db.patch(target._id, { role: args.role });
  },
});
