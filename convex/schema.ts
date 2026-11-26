import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const questionStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("answered"),
  v.literal("rejected"),
);

export const memberRole = v.union(v.literal("host"), v.literal("moderator"), v.literal("participant"));

export default defineSchema({
  rooms: defineTable({
    code: v.string(),
    title: v.string(),
    hostId: v.string(),
    status: v.union(v.literal("open"), v.literal("closed")),
    moderated: v.boolean(),
    spotlightQuestionId: v.optional(v.id("questions")),
    createdAt: v.number(),
  })
    .index("by_code", ["code"]),

  members: defineTable({
    roomId: v.id("rooms"),
    userId: v.string(),
    name: v.string(),
    role: memberRole,
    joinedAt: v.number(),
  })
    .index("by_room_user", ["roomId", "userId"])
    .index("by_user", ["userId"]),

  questions: defineTable({
    roomId: v.id("rooms"),
    authorId: v.string(),
    authorName: v.string(),
    anonymous: v.boolean(),
    body: v.string(),
    status: questionStatus,
    /** Denormalised count of `upvotes` rows; maintained in the same transaction. */
    votes: v.number(),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_status_votes", ["roomId", "status", "votes"])
    .index("by_room_author", ["roomId", "authorId"]),

  upvotes: defineTable({
    questionId: v.id("questions"),
    roomId: v.id("rooms"),
    voterId: v.string(),
  })
    .index("by_question_voter", ["questionId", "voterId"])
    .index("by_room_voter", ["roomId", "voterId"]),

  polls: defineTable({
    roomId: v.id("rooms"),
    prompt: v.string(),
    options: v.array(v.object({ id: v.string(), label: v.string() })),
    status: v.union(v.literal("open"), v.literal("closed")),
    createdAt: v.number(),
  }).index("by_room", ["roomId"]),

  pollVotes: defineTable({
    pollId: v.id("polls"),
    voterId: v.string(),
    optionId: v.string(),
  })
    .index("by_poll_voter", ["pollId", "voterId"]),

  presence: defineTable({
    roomId: v.id("rooms"),
    userId: v.string(),
    name: v.string(),
    seenAt: v.number(),
  })
    .index("by_room_user", ["roomId", "userId"])
    .index("by_room_seen", ["roomId", "seenAt"])
    .index("by_seen", ["seenAt"]),

  rateLimits: defineTable({
    key: v.string(),
    tokens: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_updated", ["updatedAt"]),
});
