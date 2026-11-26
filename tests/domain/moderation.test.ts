import { describe, expect, it } from "vitest";
import {
  canSpotlight,
  initialStatus,
  isVisibleTo,
  isVotable,
  nextStatus,
  rankQuestions,
  type ModerationAction,
  type QuestionStatus,
} from "../../convex/lib/moderation";
import { can, type Permission, type Role } from "../../convex/lib/roles";

const STATUSES: QuestionStatus[] = ["pending", "approved", "answered", "rejected"];
const ACTIONS: ModerationAction[] = ["approve", "reject", "answer", "reopen"];

describe("moderation state machine", () => {
  it("allows exactly the documented transitions", () => {
    const allowed: Record<string, QuestionStatus> = {
      "pending:approve": "approved",
      "pending:reject": "rejected",
      "approved:answer": "answered",
      "approved:reject": "rejected",
      "answered:reopen": "approved",
      "answered:reject": "rejected",
      "rejected:approve": "approved",
    };
    for (const status of STATUSES) {
      for (const action of ACTIONS) {
        expect(nextStatus(status, action)).toBe(allowed[`${status}:${action}`] ?? null);
      }
    }
  });

  it("holds new questions only in moderated rooms", () => {
    expect(initialStatus(true)).toBe("pending");
    expect(initialStatus(false)).toBe("approved");
  });

  it("only open questions can be voted on or spotlit", () => {
    for (const status of STATUSES) {
      expect(isVotable(status)).toBe(status === "approved");
      expect(canSpotlight(status)).toBe(status === "approved");
    }
  });
});

describe("visibility", () => {
  const audience = { userId: "viewer", canModerate: false };
  it("shows the audience public statuses and their own held questions", () => {
    expect(isVisibleTo({ status: "approved", authorId: "x" }, audience)).toBe(true);
    expect(isVisibleTo({ status: "answered", authorId: "x" }, audience)).toBe(true);
    expect(isVisibleTo({ status: "pending", authorId: "x" }, audience)).toBe(false);
    expect(isVisibleTo({ status: "rejected", authorId: "x" }, audience)).toBe(false);
    expect(isVisibleTo({ status: "pending", authorId: "viewer" }, audience)).toBe(true);
    expect(isVisibleTo({ status: "rejected", authorId: "viewer" }, audience)).toBe(true);
  });

  it("shows moderators everything", () => {
    for (const status of STATUSES) {
      expect(isVisibleTo({ status, authorId: "x" }, { userId: "mod", canModerate: true })).toBe(true);
    }
  });
});

describe("ranking", () => {
  it("sorts by votes descending, then oldest first, without mutating the input", () => {
    const input = [
      { id: "a", votes: 1, createdAt: 3 },
      { id: "b", votes: 5, createdAt: 9 },
      { id: "c", votes: 1, createdAt: 1 },
    ];
    expect(rankQuestions(input).map((q) => q.id)).toEqual(["b", "c", "a"]);
    expect(input.map((q) => q.id)).toEqual(["a", "b", "c"]);
  });
});

describe("roles", () => {
  it("grants permissions by role", () => {
    const expected: Record<Role, Permission[]> = {
      host: ["moderate", "managePolls", "manageRoom", "present"],
      moderator: ["moderate", "managePolls", "present"],
      participant: [],
    };
    for (const role of Object.keys(expected) as Role[]) {
      for (const permission of ["moderate", "managePolls", "manageRoom", "present"] as Permission[]) {
        expect(can(role, permission)).toBe(expected[role].includes(permission));
      }
    }
  });
});
