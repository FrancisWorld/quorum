import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireMembership, requireOpenRoom, requirePermission } from "./lib/access";
import { appError } from "./lib/errors";
import {
  initialStatus,
  isVisibleTo,
  isVotable,
  nextStatus,
  rankQuestions,
  type QuestionStatus,
} from "./lib/moderation";
import { enforceRateLimit } from "./lib/rateLimitDb";
import { can } from "./lib/roles";
import { duplicateKey, validateQuestion } from "./lib/validation";
import { toQuestionView, type QuestionView } from "./lib/views";

const LIST_CAP = 500;
const OWN_CAP = 200;

export const list = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args): Promise<QuestionView[]> => {
    const { caller, room, member } = await requireMembership(ctx, args.roomId);
    const viewer = { userId: caller.userId, canModerate: can(member.role, "moderate") };

    // Index-backed reads: everything under the room prefix for moderators,
    // otherwise the two public statuses plus the viewer's own questions.
    let candidates: Doc<"questions">[];
    if (viewer.canModerate) {
      candidates = await ctx.db
        .query("questions")
        .withIndex("by_room", (q) => q.eq("roomId", room._id))
        .order("desc")
        .take(LIST_CAP);
    } else {
      const [approved, answered, own] = await Promise.all([
        ctx.db
          .query("questions")
          .withIndex("by_room_status_votes", (q) => q.eq("roomId", room._id).eq("status", "approved"))
          .order("desc")
          .take(LIST_CAP),
        ctx.db
          .query("questions")
          .withIndex("by_room_status_votes", (q) => q.eq("roomId", room._id).eq("status", "answered"))
          .order("desc")
          .take(LIST_CAP),
        ctx.db
          .query("questions")
          .withIndex("by_room_author", (q) => q.eq("roomId", room._id).eq("authorId", caller.userId))
          .order("desc")
          .take(OWN_CAP),
      ]);
      const byId = new Map([...approved, ...answered, ...own].map((doc) => [doc._id, doc]));
      candidates = [...byId.values()];
    }

    const myVotes = await ctx.db
      .query("upvotes")
      .withIndex("by_room_voter", (q) => q.eq("roomId", room._id).eq("voterId", caller.userId))
      .take(LIST_CAP);
    const votedIds = new Set<string>(myVotes.map((vote) => vote.questionId));

    return rankQuestions(candidates.filter((question) => isVisibleTo(question, viewer))).map((question) =>
      toQuestionView(question, caller.userId, votedIds, room.spotlightQuestionId),
    );
  },
});

export const submit = mutation({
  args: { roomId: v.id("rooms"), body: v.string(), anonymous: v.boolean() },
  handler: async (ctx, args): Promise<{ questionId: Id<"questions">; status: QuestionStatus }> => {
    const { caller, room } = await requireMembership(ctx, args.roomId);
    requireOpenRoom(room);
    const body = validateQuestion(args.body);
    await enforceRateLimit(ctx, "question", `${room._id}:${caller.userId}`);

    const ownQuestions = await ctx.db
      .query("questions")
      .withIndex("by_room_author", (q) => q.eq("roomId", room._id).eq("authorId", caller.userId))
      .take(OWN_CAP);
    const key = duplicateKey(body);
    if (ownQuestions.some((question) => duplicateKey(question.body) === key)) {
      throw appError("CONFLICT", "You already asked that question.");
    }

    const status = initialStatus(room.moderated);
    const questionId = await ctx.db.insert("questions", {
      roomId: room._id,
      authorId: caller.userId,
      authorName: caller.name,
      anonymous: args.anonymous,
      body,
      status,
      votes: 0,
      createdAt: Date.now(),
    });
    return { questionId, status };
  },
});

/**
 * Declarative (`voted: true|false`) rather than a toggle, so retries and double
 * clicks are idempotent. The unique-row check and the counter update happen in
 * one transaction; Convex serialises conflicting transactions, so two racing
 * calls from the same person can never both insert.
 */
export const setVote = mutation({
  args: { questionId: v.id("questions"), voted: v.boolean() },
  handler: async (ctx, args): Promise<{ votes: number; votedByMe: boolean }> => {
    const question = await ctx.db.get(args.questionId);
    if (!question) throw appError("NOT_FOUND", "Question not found.");
    const { caller, room } = await requireMembership(ctx, question.roomId);
    requireOpenRoom(room);
    await enforceRateLimit(ctx, "vote", caller.userId);

    const existing = await ctx.db
      .query("upvotes")
      .withIndex("by_question_voter", (q) => q.eq("questionId", question._id).eq("voterId", caller.userId))
      .unique();

    if (args.voted && !existing) {
      if (!isVotable(question.status)) throw appError("CONFLICT", "This question is not open for voting.");
      await ctx.db.insert("upvotes", { questionId: question._id, roomId: room._id, voterId: caller.userId });
      await ctx.db.patch(question._id, { votes: question.votes + 1 });
      return { votes: question.votes + 1, votedByMe: true };
    }
    if (!args.voted && existing) {
      await ctx.db.delete(existing._id);
      await ctx.db.patch(question._id, { votes: Math.max(0, question.votes - 1) });
      return { votes: Math.max(0, question.votes - 1), votedByMe: false };
    }
    return { votes: question.votes, votedByMe: existing !== null };
  },
});

export const moderate = mutation({
  args: {
    questionId: v.id("questions"),
    action: v.union(v.literal("approve"), v.literal("reject"), v.literal("answer"), v.literal("reopen")),
  },
  handler: async (ctx, args): Promise<{ status: QuestionStatus }> => {
    const question = await ctx.db.get(args.questionId);
    if (!question) throw appError("NOT_FOUND", "Question not found.");
    const access = await requireMembership(ctx, question.roomId);
    requirePermission(access, "moderate");

    const status = nextStatus(question.status, args.action);
    if (status === null) {
      throw appError("CONFLICT", `Cannot ${args.action} a question that is ${question.status}.`);
    }
    await ctx.db.patch(question._id, { status });
    if (status !== "approved" && access.room.spotlightQuestionId === question._id) {
      await ctx.db.patch(access.room._id, { spotlightQuestionId: undefined });
    }
    return { status };
  },
});
