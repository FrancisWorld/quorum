// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toFailure } from "../../src/lib/errors";
import { ADA, BEN, CLEO, DEV, convexWorld, demoWorld, type Person, type World } from "../helpers/world";

/**
 * One specification, two implementations. Everything the UI relies on is asserted
 * against the real Convex functions and against the in-memory demo backend, so the
 * offline demo cannot quietly drift from production behaviour.
 */
const START = new Date("2026-03-01T10:00:00Z");

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return toFailure(error).code;
  }
  return "OK";
}

describe.each([
  ["convex functions", convexWorld],
  ["demo backend", demoWorld],
])("backend conformance: %s", (_label, makeWorld) => {
  let world: World;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START);
    world = makeWorld();
  });
  afterEach(() => vi.useRealTimers());

  const me = (person: Person | null) => world.as(person);

  async function room(moderated: boolean) {
    const { roomId, code } = await me(ADA).mutate("rooms.create", { title: "Town hall", moderated });
    for (const who of [BEN, CLEO, DEV]) await me(who).mutate("rooms.join", { code });
    await me(ADA).mutate("rooms.setRole", { roomId, userId: BEN.id, role: "moderator" });
    return { roomId, code };
  }

  it("requires sign-in", async () => {
    expect(await failureOf(me(null).query("rooms.mine", {}))).toBe("UNAUTHENTICATED");
    expect(await failureOf(me(null).mutate("rooms.create", { title: "Anonymous", moderated: false }))).toBe("UNAUTHENTICATED");
  });

  it("creates rooms, joins by forgiving code, and reports roles", async () => {
    const { roomId, code } = await me(ADA).mutate("rooms.create", { title: "  Town   hall ", moderated: true });
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(await me(CLEO).mutate("rooms.join", { code: `${code.slice(0, 3)}-${code.slice(3)}`.toLowerCase() })).toEqual({ status: "joined", roomId });
    expect(await me(CLEO).mutate("rooms.join", { code })).toEqual({ status: "joined", roomId });
    expect(await me(ADA).query("rooms.get", { roomId })).toMatchObject({ title: "Town hall", role: "host", moderated: true });
    expect((await me(CLEO).query("rooms.get", { roomId })).role).toBe("participant");
    expect((await me(CLEO).query("rooms.mine", {})).map((r) => r.title)).toEqual(["Town hall"]);
    expect(await me(DEV).mutate("rooms.join", { code: "ZZZZZZ" })).toEqual({ status: "not_found" });
  });

  it("hides rooms from outsiders", async () => {
    const { roomId } = await room(false);
    const outsider = { id: "p_out", name: "Out" };
    expect(await failureOf(me(outsider).query("rooms.get", { roomId }))).toBe("NOT_FOUND");
    expect(await failureOf(me(outsider).query("questions.list", { roomId }))).toBe("NOT_FOUND");
    expect(await failureOf(me(outsider).mutate("questions.submit", { roomId, body: "Let me in", anonymous: false }))).toBe("NOT_FOUND");
  });

  it("counts failed join guesses against the limit and recovers with time", async () => {
    const { code } = await room(false);
    for (let i = 0; i < 5; i++) {
      expect(await me({ id: "p_guess", name: "Guesser" }).mutate("rooms.join", { code: "ZZZZZZ" })).toEqual({ status: "not_found" });
    }
    expect(await me({ id: "p_guess", name: "Guesser" }).mutate("rooms.join", { code })).toMatchObject({ status: "rate_limited" });
    vi.setSystemTime(new Date(START.getTime() + 13_000));
    expect(await me({ id: "p_guess", name: "Guesser" }).mutate("rooms.join", { code })).toMatchObject({ status: "joined" });
  });

  it("holds, shows and moderates questions according to role", async () => {
    const { roomId } = await room(true);
    const { questionId, status } = await me(CLEO).mutate("questions.submit", { roomId, body: "Held question?", anonymous: true });
    expect(status).toBe("pending");
    expect(await me(DEV).query("questions.list", { roomId })).toEqual([]);
    expect((await me(CLEO).query("questions.list", { roomId }))[0]).toMatchObject({ status: "pending", mine: true, authorName: "Cleo" });
    expect((await me(BEN).query("questions.list", { roomId }))[0]).toMatchObject({ status: "pending", authorName: null });
    expect((await me(ADA).query("rooms.get", { roomId })).pendingCount).toBe(1);

    expect(await failureOf(me(CLEO).mutate("questions.moderate", { questionId, action: "approve" }))).toBe("FORBIDDEN");
    expect(await failureOf(me(BEN).mutate("questions.moderate", { questionId, action: "answer" }))).toBe("CONFLICT");
    expect(await me(BEN).mutate("questions.moderate", { questionId, action: "approve" })).toEqual({ status: "approved" });
    expect((await me(DEV).query("questions.list", { roomId })).map((q) => q.body)).toEqual(["Held question?"]);
    expect((await me(ADA).query("rooms.get", { roomId })).pendingCount).toBe(0);
  });

  it("applies the question validators, duplicate guard and closed-room rule", async () => {
    const { roomId } = await room(false);
    expect(await failureOf(me(CLEO).mutate("questions.submit", { roomId, body: "  ", anonymous: false }))).toBe("VALIDATION");
    await me(CLEO).mutate("questions.submit", { roomId, body: "Same question here", anonymous: false });
    expect(await failureOf(me(CLEO).mutate("questions.submit", { roomId, body: " same QUESTION here ", anonymous: false }))).toBe("CONFLICT");
    await me(ADA).mutate("rooms.update", { roomId, status: "closed" });
    expect(await failureOf(me(DEV).mutate("questions.submit", { roomId, body: "Anyone home?", anonymous: false }))).toBe("ROOM_CLOSED");
  });

  it("rate limits questions, refunds failed attempts and refills with time", async () => {
    const { roomId } = await room(false);
    const submit = (body: string) => me(CLEO).mutate("questions.submit", { roomId, body, anonymous: false });
    await submit("Question number one");
    for (let i = 0; i < 5; i++) expect(await failureOf(submit("Question number one"))).toBe("CONFLICT");
    await submit("Question number two");
    await submit("Question number three");
    expect(await failureOf(submit("Question number four"))).toBe("RATE_LIMITED");
    vi.setSystemTime(new Date(START.getTime() + 16_000));
    await submit("Question number four");
  });

  it("makes votes idempotent and keeps the counter equal to the number of voters under concurrency", async () => {
    const { roomId } = await room(false);
    const { questionId } = await me(CLEO).mutate("questions.submit", { roomId, body: "Popular question", anonymous: false });
    expect(await me(DEV).mutate("questions.setVote", { questionId, voted: true })).toEqual({ votes: 1, votedByMe: true });
    expect(await me(DEV).mutate("questions.setVote", { questionId, voted: true })).toEqual({ votes: 1, votedByMe: true });
    await Promise.all([BEN, CLEO, ADA, ADA, ADA].map((who) => me(who).mutate("questions.setVote", { questionId, voted: true })));
    const [question] = await me(DEV).query("questions.list", { roomId });
    expect(question).toMatchObject({ votes: 4, votedByMe: true });
    expect(await me(DEV).mutate("questions.setVote", { questionId, voted: false })).toEqual({ votes: 3, votedByMe: false });
    expect(await me(DEV).mutate("questions.setVote", { questionId, voted: false })).toEqual({ votes: 3, votedByMe: false });
  });

  it("only accepts votes on open questions and ranks by votes", async () => {
    const { roomId } = await room(true);
    const a = await me(CLEO).mutate("questions.submit", { roomId, body: "Quiet question", anonymous: false });
    expect(await failureOf(me(DEV).mutate("questions.setVote", { questionId: a.questionId, voted: true }))).toBe("CONFLICT");
    await me(BEN).mutate("questions.moderate", { questionId: a.questionId, action: "approve" });
    vi.setSystemTime(new Date(START.getTime() + 1_000));
    const b = await me(CLEO).mutate("questions.submit", { roomId, body: "Loud question", anonymous: false });
    await me(BEN).mutate("questions.moderate", { questionId: b.questionId, action: "approve" });
    await me(DEV).mutate("questions.setVote", { questionId: b.questionId, voted: true });
    expect((await me(DEV).query("questions.list", { roomId })).map((q) => q.body)).toEqual(["Loud question", "Quiet question"]);
  });

  it("manages the spotlight and clears it when the question stops being open", async () => {
    const { roomId } = await room(false);
    const { questionId } = await me(CLEO).mutate("questions.submit", { roomId, body: "Show this one", anonymous: false });
    expect(await failureOf(me(CLEO).mutate("rooms.setSpotlight", { roomId, questionId }))).toBe("FORBIDDEN");
    await me(BEN).mutate("rooms.setSpotlight", { roomId, questionId });
    expect((await me(DEV).query("questions.list", { roomId }))[0]?.spotlight).toBe(true);
    await me(BEN).mutate("questions.moderate", { questionId, action: "answer" });
    expect((await me(DEV).query("questions.list", { roomId }))[0]?.spotlight).toBe(false);
    expect(await failureOf(me(BEN).mutate("rooms.setSpotlight", { roomId, questionId }))).toBe("CONFLICT");
  });

  it("restricts room management to the host", async () => {
    const { roomId } = await room(false);
    expect(await failureOf(me(BEN).mutate("rooms.update", { roomId, moderated: true }))).toBe("FORBIDDEN");
    expect(await failureOf(me(BEN).query("rooms.members", { roomId }))).toBe("FORBIDDEN");
    expect(await failureOf(me(ADA).mutate("rooms.setRole", { roomId, userId: ADA.id, role: "participant" }))).toBe("FORBIDDEN");
    expect(await failureOf(me(ADA).mutate("rooms.setRole", { roomId, userId: "p_nobody", role: "moderator" }))).toBe("NOT_FOUND");
    expect((await me(ADA).query("rooms.members", { roomId })).map((m) => [m.name, m.role])).toEqual([
      ["Ada", "host"],
      ["Ben", "moderator"],
      ["Cleo", "participant"],
      ["Dev", "participant"],
    ]);
  });

  it("runs polls: one open at a time, one final vote each, percentages sum to 100", async () => {
    const { roomId } = await room(false);
    expect(await failureOf(me(CLEO).mutate("polls.create", { roomId, prompt: "Not allowed", options: ["a", "b"] }))).toBe("FORBIDDEN");
    expect(await failureOf(me(BEN).mutate("polls.create", { roomId, prompt: "Dup options", options: ["a", "A"] }))).toBe("VALIDATION");
    const first = await me(BEN).mutate("polls.create", { roomId, prompt: "First poll", options: ["Tabs", "Spaces", "Both"] });
    vi.setSystemTime(new Date(START.getTime() + 5_000));
    const second = await me(BEN).mutate("polls.create", { roomId, prompt: "Second poll", options: ["Yes", "No"] });
    expect((await me(DEV).query("polls.list", { roomId })).map((p) => [p.id, p.status])).toEqual([
      [second.pollId, "open"],
      [first.pollId, "closed"],
    ]);

    expect(await failureOf(me(DEV).mutate("polls.vote", { pollId: first.pollId, optionId: "opt1" }))).toBe("CONFLICT");
    await me(ADA).mutate("polls.setStatus", { pollId: first.pollId, status: "open" });
    await me(DEV).mutate("polls.vote", { pollId: first.pollId, optionId: "opt1" });
    expect(await me(DEV).mutate("polls.vote", { pollId: first.pollId, optionId: "opt1" })).toEqual({ optionId: "opt1" });
    expect(await failureOf(me(DEV).mutate("polls.vote", { pollId: first.pollId, optionId: "opt2" }))).toBe("CONFLICT");
    expect(await failureOf(me(DEV).mutate("polls.vote", { pollId: first.pollId, optionId: "opt9" }))).toBe("VALIDATION");
    await me(CLEO).mutate("polls.vote", { pollId: first.pollId, optionId: "opt2" });
    await me(BEN).mutate("polls.vote", { pollId: first.pollId, optionId: "opt3" });

    const polls = await me(DEV).query("polls.list", { roomId });
    const tallied = polls.find((p) => p.id === first.pollId);
    expect(tallied).toMatchObject({ total: 3, myVote: "opt1" });
    expect(tallied?.options.map((o) => o.percent)).toEqual([34, 33, 33]);
  });

  it("tracks presence with a TTL and quiet throttling", async () => {
    const { roomId } = await room(false);
    expect(await me(ADA).mutate("presence.heartbeat", { roomId })).toEqual({ recorded: true });
    await me(BEN).mutate("presence.heartbeat", { roomId });
    expect(await me(CLEO).query("presence.list", { roomId })).toEqual({ count: 2, names: ["Ada", "Ben"] });
    await me(BEN).mutate("presence.leave", { roomId });
    expect((await me(CLEO).query("presence.list", { roomId })).count).toBe(1);
    vi.setSystemTime(new Date(START.getTime() + 60_000));
    expect((await me(CLEO).query("presence.list", { roomId })).count).toBe(0);
    const burst = [];
    for (let i = 0; i < 8; i++) burst.push((await me(ADA).mutate("presence.heartbeat", { roomId })).recorded);
    expect(burst.filter(Boolean)).toHaveLength(6);
  });
});
