// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ADA, BEN, CLEO, DEV, as, code, createBackend, type Backend, type Persona } from "../helpers/convex";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

/** Ada hosts, Ben moderates, Cleo and Dev are participants. */
async function setup(moderated: boolean) {
  const t = createBackend();
  const { roomId, code: joinCode } = await as(t, ADA).mutation(api.rooms.create, { title: "Town hall", moderated });
  for (const who of [BEN, CLEO, DEV]) await as(t, who).mutation(api.rooms.join, { code: joinCode });
  await as(t, ADA).mutation(api.rooms.setRole, { roomId, userId: BEN.userId, role: "moderator" });
  return { t, roomId };
}

const ask = (t: Backend, who: Persona, roomId: Id<"rooms">, body: string, anonymous = false) =>
  as(t, who).mutation(api.questions.submit, { roomId, body, anonymous });

async function invariantVotesMatchRows(t: Backend, questionId: Id<"questions">) {
  return t.run(async (ctx) => {
    const question = await ctx.db.get(questionId);
    const rows = await ctx.db.query("upvotes").withIndex("by_question_voter", (q) => q.eq("questionId", questionId)).collect();
    return { counter: question?.votes, rows: rows.length };
  });
}

describe("submitting", () => {
  it("posts immediately in open rooms and holds questions in moderated ones", async () => {
    const open = await setup(false);
    expect((await ask(open.t, CLEO, open.roomId, "Is this live?")).status).toBe("approved");
    const moderated = await setup(true);
    expect((await ask(moderated.t, CLEO, moderated.roomId, "Is this held?")).status).toBe("pending");
  });

  it("validates and normalises the body", async () => {
    const { t, roomId } = await setup(false);
    await expect(ask(t, CLEO, roomId, "  ")).rejects.toMatchObject(code("VALIDATION"));
    await expect(ask(t, CLEO, roomId, "x".repeat(501))).rejects.toMatchObject(code("VALIDATION"));
    await ask(t, CLEO, roomId, "  Spaced    out   question ");
    expect((await as(t, DEV).query(api.questions.list, { roomId }))[0]?.body).toBe("Spaced out question");
  });

  it("rejects duplicates from the same author but allows the same text from someone else", async () => {
    const { t, roomId } = await setup(false);
    await ask(t, CLEO, roomId, "Will there be slides?");
    await expect(ask(t, CLEO, roomId, "  will there be SLIDES? ")).rejects.toMatchObject(code("CONFLICT"));
    await ask(t, DEV, roomId, "Will there be slides?");
  });

  it("is refused in a closed room", async () => {
    const { t, roomId } = await setup(false);
    await as(t, ADA).mutation(api.rooms.update, { roomId, status: "closed" });
    await expect(ask(t, CLEO, roomId, "Too late?")).rejects.toMatchObject(code("ROOM_CLOSED"));
  });

  it("rate limits bursts, refills over time, and refunds attempts that fail validation", async () => {
    const { t, roomId } = await setup(false);
    await ask(t, CLEO, roomId, "Question number one");
    // Failed attempts roll back, so they must not eat the budget.
    for (let i = 0; i < 6; i++) await expect(ask(t, CLEO, roomId, "Question number one")).rejects.toMatchObject(code("CONFLICT"));
    await ask(t, CLEO, roomId, "Question number two");
    await ask(t, CLEO, roomId, "Question number three");
    const blocked = await ask(t, CLEO, roomId, "Question number four").catch((error: unknown) => error);
    expect(blocked).toMatchObject(code("RATE_LIMITED"));
    expect((blocked as { data: { retryAfterMs: number } }).data.retryAfterMs).toBeGreaterThan(0);

    // Budgets are per user per room.
    await ask(t, DEV, roomId, "Dev has own budget");
    vi.setSystemTime(new Date("2026-03-01T10:00:16Z"));
    await ask(t, CLEO, roomId, "Question number four");
  });
});

describe("visibility", () => {
  it("shows held and rejected questions only to their author and to moderators", async () => {
    const { t, roomId } = await setup(true);
    const { questionId } = await ask(t, CLEO, roomId, "Held for review");

    expect((await as(t, DEV).query(api.questions.list, { roomId })).map((q) => q.body)).toEqual([]);
    expect((await as(t, CLEO).query(api.questions.list, { roomId }))[0]).toMatchObject({ status: "pending", mine: true });
    expect((await as(t, BEN).query(api.questions.list, { roomId }))[0]).toMatchObject({ status: "pending", mine: false });
    expect(await as(t, ADA).query(api.rooms.get, { roomId })).toMatchObject({ pendingCount: 1 });
    expect(await as(t, CLEO).query(api.rooms.get, { roomId })).toMatchObject({ pendingCount: 0 });

    await as(t, BEN).mutation(api.questions.moderate, { questionId, action: "reject" });
    expect((await as(t, DEV).query(api.questions.list, { roomId })).length).toBe(0);
    expect((await as(t, CLEO).query(api.questions.list, { roomId }))[0]?.status).toBe("rejected");
    expect(await as(t, ADA).query(api.rooms.get, { roomId })).toMatchObject({ pendingCount: 0 });
  });

  it("keeps anonymous authors hidden from everyone but themselves, moderators included", async () => {
    const { t, roomId } = await setup(false);
    await ask(t, CLEO, roomId, "Who asked this?", true);
    expect((await as(t, DEV).query(api.questions.list, { roomId }))[0]).toMatchObject({ authorName: null, mine: false });
    expect((await as(t, BEN).query(api.questions.list, { roomId }))[0]?.authorName).toBeNull();
    expect((await as(t, CLEO).query(api.questions.list, { roomId }))[0]).toMatchObject({ authorName: "Cleo", mine: true });
  });

  it("ranks by votes and reports my own votes", async () => {
    const { t, roomId } = await setup(false);
    const a = await ask(t, CLEO, roomId, "Quiet question");
    vi.setSystemTime(new Date("2026-03-01T10:01:00Z"));
    const b = await ask(t, CLEO, roomId, "Popular question");
    await as(t, DEV).mutation(api.questions.setVote, { questionId: b.questionId, voted: true });
    await as(t, BEN).mutation(api.questions.setVote, { questionId: b.questionId, voted: true });
    const asDev = await as(t, DEV).query(api.questions.list, { roomId });
    expect(asDev.map((q) => [q.body, q.votes, q.votedByMe])).toEqual([
      ["Popular question", 2, true],
      ["Quiet question", 0, false],
    ]);
    expect(a.questionId).toBeDefined();
  });
});

describe("voting", () => {
  it("is idempotent in both directions", async () => {
    const { t, roomId } = await setup(false);
    const { questionId } = await ask(t, CLEO, roomId, "Idempotent please");
    const dev = as(t, DEV);
    expect(await dev.mutation(api.questions.setVote, { questionId, voted: true })).toEqual({ votes: 1, votedByMe: true });
    expect(await dev.mutation(api.questions.setVote, { questionId, voted: true })).toEqual({ votes: 1, votedByMe: true });
    expect(await dev.mutation(api.questions.setVote, { questionId, voted: false })).toEqual({ votes: 0, votedByMe: false });
    expect(await dev.mutation(api.questions.setVote, { questionId, voted: false })).toEqual({ votes: 0, votedByMe: false });
    expect(await invariantVotesMatchRows(t, questionId)).toEqual({ counter: 0, rows: 0 });
  });

  it("one person racing against themselves yields exactly one vote", async () => {
    const { t, roomId } = await setup(false);
    const { questionId } = await ask(t, CLEO, roomId, "Race me");
    await Promise.all(Array.from({ length: 8 }, () => as(t, DEV).mutation(api.questions.setVote, { questionId, voted: true })));
    expect(await invariantVotesMatchRows(t, questionId)).toEqual({ counter: 1, rows: 1 });
  });

  it("many people voting at once all count", async () => {
    const t = createBackend();
    const { roomId, code: joinCode } = await as(t, ADA).mutation(api.rooms.create, { title: "Crowd", moderated: false });
    const crowd = Array.from({ length: 12 }, (_, i) => ({ userId: `user_c${i}`, name: `Crowd ${i}` }));
    for (const person of crowd) await as(t, person).mutation(api.rooms.join, { code: joinCode });
    const { questionId } = await ask(t, ADA, roomId, "Everyone agrees?");
    await Promise.all(crowd.map((person) => as(t, person).mutation(api.questions.setVote, { questionId, voted: true })));
    expect(await invariantVotesMatchRows(t, questionId)).toEqual({ counter: 12, rows: 12 });
    await Promise.all(crowd.slice(0, 5).map((person) => as(t, person).mutation(api.questions.setVote, { questionId, voted: false })));
    expect(await invariantVotesMatchRows(t, questionId)).toEqual({ counter: 7, rows: 7 });
  });

  it("only open questions take new votes, but an existing vote can always be withdrawn", async () => {
    const { t, roomId } = await setup(true);
    const { questionId } = await ask(t, CLEO, roomId, "Not yet approved");
    await expect(as(t, CLEO).mutation(api.questions.setVote, { questionId, voted: true })).rejects.toMatchObject(code("CONFLICT"));
    await as(t, BEN).mutation(api.questions.moderate, { questionId, action: "approve" });
    await as(t, DEV).mutation(api.questions.setVote, { questionId, voted: true });
    await as(t, BEN).mutation(api.questions.moderate, { questionId, action: "answer" });
    await expect(as(t, CLEO).mutation(api.questions.setVote, { questionId, voted: true })).rejects.toMatchObject(code("CONFLICT"));
    expect(await as(t, DEV).mutation(api.questions.setVote, { questionId, voted: false })).toEqual({ votes: 0, votedByMe: false });
  });

  it("is blocked for outsiders and in closed rooms", async () => {
    const { t, roomId } = await setup(false);
    const { questionId } = await ask(t, CLEO, roomId, "Guarded question");
    const outsider = { userId: "user_out", name: "Out" };
    await expect(as(t, outsider).mutation(api.questions.setVote, { questionId, voted: true })).rejects.toMatchObject(code("NOT_FOUND"));
    await as(t, ADA).mutation(api.rooms.update, { roomId, status: "closed" });
    await expect(as(t, DEV).mutation(api.questions.setVote, { questionId, voted: true })).rejects.toMatchObject(code("ROOM_CLOSED"));
  });

  it("rate limits vote spam", async () => {
    const { t, roomId } = await setup(false);
    const { questionId } = await ask(t, CLEO, roomId, "Click me a lot");
    const dev = as(t, DEV);
    let denied = false;
    for (let i = 0; i < 25 && !denied; i++) {
      denied = await dev.mutation(api.questions.setVote, { questionId, voted: i % 2 === 0 }).then(
        () => false,
        (error: unknown) => (error as { data?: { code?: string } }).data?.code === "RATE_LIMITED",
      );
    }
    expect(denied).toBe(true);
  });

  it("fails cleanly for a question that does not exist", async () => {
    const { t, roomId } = await setup(false);
    const { questionId } = await ask(t, CLEO, roomId, "Soon deleted");
    await t.run((ctx) => ctx.db.delete(questionId));
    await expect(as(t, DEV).mutation(api.questions.setVote, { questionId, voted: true })).rejects.toMatchObject(code("NOT_FOUND"));
    await expect(as(t, BEN).mutation(api.questions.moderate, { questionId, action: "approve" })).rejects.toMatchObject(code("NOT_FOUND"));
  });
});

describe("moderation", () => {
  it("walks the allowed transitions and rejects the rest", async () => {
    const { t, roomId } = await setup(true);
    const { questionId } = await ask(t, CLEO, roomId, "Walk me through it");
    const ben = as(t, BEN);
    await expect(ben.mutation(api.questions.moderate, { questionId, action: "answer" })).rejects.toMatchObject(code("CONFLICT"));
    expect(await ben.mutation(api.questions.moderate, { questionId, action: "approve" })).toEqual({ status: "approved" });
    await expect(ben.mutation(api.questions.moderate, { questionId, action: "approve" })).rejects.toMatchObject(code("CONFLICT"));
    expect(await ben.mutation(api.questions.moderate, { questionId, action: "answer" })).toEqual({ status: "answered" });
    expect(await ben.mutation(api.questions.moderate, { questionId, action: "reopen" })).toEqual({ status: "approved" });
    expect(await ben.mutation(api.questions.moderate, { questionId, action: "reject" })).toEqual({ status: "rejected" });
    expect(await ben.mutation(api.questions.moderate, { questionId, action: "approve" })).toEqual({ status: "approved" });
  });

  it("is limited to moderators and the host", async () => {
    const { t, roomId } = await setup(true);
    const { questionId } = await ask(t, CLEO, roomId, "Who may approve me?");
    await expect(as(t, CLEO).mutation(api.questions.moderate, { questionId, action: "approve" })).rejects.toMatchObject(code("FORBIDDEN"));
    await expect(as(t, DEV).mutation(api.questions.moderate, { questionId, action: "approve" })).rejects.toMatchObject(code("FORBIDDEN"));
    await as(t, ADA).mutation(api.questions.moderate, { questionId, action: "approve" });
  });

  it("a moderator of another room has no power here", async () => {
    const { t, roomId } = await setup(true);
    const { questionId } = await ask(t, CLEO, roomId, "Cross-room attempt");
    const rival = { userId: "user_rival", name: "Rival" };
    await as(t, rival).mutation(api.rooms.create, { title: "Rival room", moderated: false });
    await expect(as(t, rival).mutation(api.questions.moderate, { questionId, action: "approve" })).rejects.toMatchObject(code("NOT_FOUND"));
  });

  it("demoting a moderator takes the power away immediately", async () => {
    const { t, roomId } = await setup(true);
    const { questionId } = await ask(t, CLEO, roomId, "Demotion test");
    await as(t, ADA).mutation(api.rooms.setRole, { roomId, userId: BEN.userId, role: "participant" });
    await expect(as(t, BEN).mutation(api.questions.moderate, { questionId, action: "approve" })).rejects.toMatchObject(code("FORBIDDEN"));
  });
});

describe("presenter spotlight", () => {
  it("puts an open question on screen and clears it when the question leaves the open state", async () => {
    const { t, roomId } = await setup(false);
    const { questionId } = await ask(t, CLEO, roomId, "Show me");
    const other = await ask(t, DEV, roomId, "Another one");
    await as(t, BEN).mutation(api.rooms.setSpotlight, { roomId, questionId });
    expect((await as(t, DEV).query(api.questions.list, { roomId })).find((q) => q.spotlight)?.id).toBe(questionId);

    await as(t, BEN).mutation(api.rooms.setSpotlight, { roomId, questionId: other.questionId });
    expect((await as(t, DEV).query(api.questions.list, { roomId })).filter((q) => q.spotlight).map((q) => q.id)).toEqual([other.questionId]);

    await as(t, BEN).mutation(api.questions.moderate, { questionId: other.questionId, action: "answer" });
    expect((await as(t, DEV).query(api.questions.list, { roomId })).some((q) => q.spotlight)).toBe(false);

    await as(t, BEN).mutation(api.rooms.setSpotlight, { roomId, questionId });
    await as(t, BEN).mutation(api.rooms.setSpotlight, { roomId, questionId: null });
    expect((await as(t, DEV).query(api.questions.list, { roomId })).some((q) => q.spotlight)).toBe(false);
  });

  it("refuses closed questions, foreign questions and non-presenters", async () => {
    const { t, roomId } = await setup(true);
    const { questionId } = await ask(t, CLEO, roomId, "Still pending");
    await expect(as(t, BEN).mutation(api.rooms.setSpotlight, { roomId, questionId })).rejects.toMatchObject(code("CONFLICT"));
    await expect(as(t, CLEO).mutation(api.rooms.setSpotlight, { roomId, questionId })).rejects.toMatchObject(code("FORBIDDEN"));

    const rival = { userId: "user_rival", name: "Rival" };
    const foreign = await as(t, rival).mutation(api.rooms.create, { title: "Rival room", moderated: false });
    const foreignQuestion = await ask(t, rival, foreign.roomId, "Elsewhere entirely");
    await expect(as(t, BEN).mutation(api.rooms.setSpotlight, { roomId, questionId: foreignQuestion.questionId })).rejects.toMatchObject(code("NOT_FOUND"));
  });
});
