import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireMembership, requireOpenRoom, requirePermission } from "./lib/access";
import { appError } from "./lib/errors";
import { tallyPoll } from "./lib/pollTally";
import { enforceRateLimit } from "./lib/rateLimitDb";
import { validatePollOptions, validatePollPrompt } from "./lib/validation";
import type { PollView } from "./lib/views";

const POLL_CAP = 50;
const VOTE_CAP = 5000;

async function closeOpenPolls(ctx: MutationCtx, roomId: Id<"rooms">): Promise<void> {
  const open = await ctx.db
    .query("polls")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .filter((q) => q.eq(q.field("status"), "open"))
    .take(POLL_CAP);
  for (const poll of open) await ctx.db.patch(poll._id, { status: "closed" });
}

export const list = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args): Promise<PollView[]> => {
    const { caller, room } = await requireMembership(ctx, args.roomId);
    const polls = await ctx.db
      .query("polls")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .order("desc")
      .take(POLL_CAP);

    const views: PollView[] = [];
    for (const poll of polls) {
      const votes = await ctx.db
        .query("pollVotes")
        .withIndex("by_poll_voter", (q) => q.eq("pollId", poll._id))
        .take(VOTE_CAP);
      const result = tallyPoll(
        poll.options,
        votes.map((vote) => vote.optionId),
      );
      views.push({
        id: poll._id,
        prompt: poll.prompt,
        status: poll.status,
        total: result.total,
        options: result.options,
        myVote: votes.find((vote) => vote.voterId === caller.userId)?.optionId ?? null,
        createdAt: poll.createdAt,
      });
    }
    return views;
  },
});

/** Creating a poll closes the room's currently open one: the presenter screen shows a single poll. */
export const create = mutation({
  args: { roomId: v.id("rooms"), prompt: v.string(), options: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ pollId: Id<"polls"> }> => {
    const access = await requireMembership(ctx, args.roomId);
    requirePermission(access, "managePolls");
    requireOpenRoom(access.room);
    const prompt = validatePollPrompt(args.prompt);
    const labels = validatePollOptions(args.options);

    await closeOpenPolls(ctx, access.room._id);
    const pollId = await ctx.db.insert("polls", {
      roomId: access.room._id,
      prompt,
      options: labels.map((label, index) => ({ id: `opt${index + 1}`, label })),
      status: "open",
      createdAt: Date.now(),
    });
    return { pollId };
  },
});

export const setStatus = mutation({
  args: { pollId: v.id("polls"), status: v.union(v.literal("open"), v.literal("closed")) },
  handler: async (ctx, args) => {
    const poll = await ctx.db.get(args.pollId);
    if (!poll) throw appError("NOT_FOUND", "Poll not found.");
    const access = await requireMembership(ctx, poll.roomId);
    requirePermission(access, "managePolls");
    if (args.status === "open") {
      requireOpenRoom(access.room);
      await closeOpenPolls(ctx, poll.roomId);
    }
    await ctx.db.patch(poll._id, { status: args.status });
  },
});

/**
 * One vote per person per poll, final once cast. Repeating the same choice is a
 * no-op (safe to retry); a different choice is a CONFLICT. The unique lookup and
 * the insert share a transaction, so concurrent attempts cannot both succeed.
 */
export const vote = mutation({
  args: { pollId: v.id("polls"), optionId: v.string() },
  handler: async (ctx, args): Promise<{ optionId: string }> => {
    const poll = await ctx.db.get(args.pollId);
    if (!poll) throw appError("NOT_FOUND", "Poll not found.");
    const { caller, room } = await requireMembership(ctx, poll.roomId);
    requireOpenRoom(room);
    if (!poll.options.some((option) => option.id === args.optionId)) {
      throw appError("VALIDATION", "That option does not exist in this poll.");
    }
    await enforceRateLimit(ctx, "pollVote", caller.userId);

    const existing = await ctx.db
      .query("pollVotes")
      .withIndex("by_poll_voter", (q) => q.eq("pollId", poll._id).eq("voterId", caller.userId))
      .unique();
    if (existing) {
      if (existing.optionId === args.optionId) return { optionId: existing.optionId };
      throw appError("CONFLICT", "You already voted in this poll.");
    }
    if (poll.status !== "open") throw appError("CONFLICT", "This poll is closed.");
    await ctx.db.insert("pollVotes", { pollId: poll._id, voterId: caller.userId, optionId: args.optionId });
    return { optionId: args.optionId };
  },
});
