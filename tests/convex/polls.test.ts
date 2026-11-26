// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { ADA, BEN, CLEO, DEV, as, code, createBackend } from "../helpers/convex";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = createBackend();
  const { roomId, code: joinCode } = await as(t, ADA).mutation(api.rooms.create, { title: "Town hall", moderated: false });
  for (const who of [BEN, CLEO, DEV]) await as(t, who).mutation(api.rooms.join, { code: joinCode });
  await as(t, ADA).mutation(api.rooms.setRole, { roomId, userId: BEN.userId, role: "moderator" });
  return { t, roomId };
}

const OPTIONS = ["Tabs", "Spaces", "Both"];

describe("creating polls", () => {
  it("is limited to hosts and moderators and validates its input", async () => {
    const { t, roomId } = await setup();
    await expect(as(t, CLEO).mutation(api.polls.create, { roomId, prompt: "Tabs or spaces?", options: OPTIONS })).rejects.toMatchObject(code("FORBIDDEN"));
    await expect(as(t, BEN).mutation(api.polls.create, { roomId, prompt: "?", options: OPTIONS })).rejects.toMatchObject(code("VALIDATION"));
    await expect(as(t, BEN).mutation(api.polls.create, { roomId, prompt: "Tabs or spaces?", options: ["One"] })).rejects.toMatchObject(code("VALIDATION"));
    await expect(as(t, BEN).mutation(api.polls.create, { roomId, prompt: "Tabs or spaces?", options: ["Same", "same"] })).rejects.toMatchObject(code("VALIDATION"));
    await as(t, BEN).mutation(api.polls.create, { roomId, prompt: "Tabs or spaces?", options: OPTIONS });
  });

  it("closes the previously open poll so only one is live", async () => {
    const { t, roomId } = await setup();
    const first = await as(t, ADA).mutation(api.polls.create, { roomId, prompt: "First poll", options: OPTIONS });
    vi.setSystemTime(new Date("2026-03-01T10:05:00Z"));
    const second = await as(t, ADA).mutation(api.polls.create, { roomId, prompt: "Second poll", options: OPTIONS });
    const polls = await as(t, CLEO).query(api.polls.list, { roomId });
    expect(polls.map((p) => [p.id, p.status])).toEqual([[second.pollId, "open"], [first.pollId, "closed"]]);

    await as(t, ADA).mutation(api.polls.setStatus, { pollId: first.pollId, status: "open" });
    const reopened = await as(t, CLEO).query(api.polls.list, { roomId });
    expect(reopened.map((p) => p.status)).toEqual(["closed", "open"]);
  });

  it("cannot be created or reopened in a closed room", async () => {
    const { t, roomId } = await setup();
    const { pollId } = await as(t, ADA).mutation(api.polls.create, { roomId, prompt: "Before closing", options: OPTIONS });
    await as(t, ADA).mutation(api.rooms.update, { roomId, status: "closed" });
    await expect(as(t, ADA).mutation(api.polls.create, { roomId, prompt: "After closing", options: OPTIONS })).rejects.toMatchObject(code("ROOM_CLOSED"));
    await expect(as(t, ADA).mutation(api.polls.setStatus, { pollId, status: "open" })).rejects.toMatchObject(code("ROOM_CLOSED"));
    await as(t, ADA).mutation(api.polls.setStatus, { pollId, status: "closed" });
  });

  it("only managers can change a poll's status", async () => {
    const { t, roomId } = await setup();
    const { pollId } = await as(t, ADA).mutation(api.polls.create, { roomId, prompt: "Who closes me?", options: OPTIONS });
    await expect(as(t, CLEO).mutation(api.polls.setStatus, { pollId, status: "closed" })).rejects.toMatchObject(code("FORBIDDEN"));
    await as(t, BEN).mutation(api.polls.setStatus, { pollId, status: "closed" });
    await t.run((ctx) => ctx.db.delete(pollId));
    await expect(as(t, BEN).mutation(api.polls.setStatus, { pollId, status: "open" })).rejects.toMatchObject(code("NOT_FOUND"));
  });
});

describe("voting in polls", () => {
  it("counts one vote per person, final once cast, and safe to retry", async () => {
    const { t, roomId } = await setup();
    const { pollId } = await as(t, ADA).mutation(api.polls.create, { roomId, prompt: "Tabs or spaces?", options: OPTIONS });
    expect(await as(t, CLEO).mutation(api.polls.vote, { pollId, optionId: "opt2" })).toEqual({ optionId: "opt2" });
    expect(await as(t, CLEO).mutation(api.polls.vote, { pollId, optionId: "opt2" })).toEqual({ optionId: "opt2" });
    await expect(as(t, CLEO).mutation(api.polls.vote, { pollId, optionId: "opt1" })).rejects.toMatchObject(code("CONFLICT"));

    const [poll] = await as(t, CLEO).query(api.polls.list, { roomId });
    expect(poll).toMatchObject({ total: 1, myVote: "opt2" });
    expect(poll?.options.map((o) => o.votes)).toEqual([0, 1, 0]);
    expect((await as(t, DEV).query(api.polls.list, { roomId }))[0]?.myVote).toBeNull();
  });

  it("concurrent attempts from one person produce a single row", async () => {
    const { t, roomId } = await setup();
    const { pollId } = await as(t, ADA).mutation(api.polls.create, { roomId, prompt: "Race condition?", options: OPTIONS });
    const results = await Promise.allSettled(
      ["opt1", "opt2", "opt3", "opt1", "opt2"].map((optionId) => as(t, DEV).mutation(api.polls.vote, { pollId, optionId })),
    );
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const rows = await t.run((ctx) => ctx.db.query("pollVotes").withIndex("by_poll_voter", (q) => q.eq("pollId", pollId)).collect());
    expect(rows).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toMatchObject(code("CONFLICT"));
    }
  });

  it("tallies a crowd and keeps percentages summing to 100", async () => {
    const { t, roomId } = await setup();
    const { pollId } = await as(t, ADA).mutation(api.polls.create, { roomId, prompt: "Tabs or spaces?", options: OPTIONS });
    await Promise.all([BEN, CLEO, DEV].map((who, i) => as(t, who).mutation(api.polls.vote, { pollId, optionId: `opt${i + 1}` })));
    const [poll] = await as(t, ADA).query(api.polls.list, { roomId });
    expect(poll?.total).toBe(3);
    expect(poll?.options.reduce((sum, o) => sum + o.percent, 0)).toBe(100);
  });

  it("rejects unknown options, closed polls, closed rooms and outsiders", async () => {
    const { t, roomId } = await setup();
    const { pollId } = await as(t, ADA).mutation(api.polls.create, { roomId, prompt: "Edge cases?", options: OPTIONS });
    await expect(as(t, CLEO).mutation(api.polls.vote, { pollId, optionId: "opt9" })).rejects.toMatchObject(code("VALIDATION"));
    await expect(as(t, { userId: "user_out", name: "Out" }).mutation(api.polls.vote, { pollId, optionId: "opt1" })).rejects.toMatchObject(code("NOT_FOUND"));

    await as(t, CLEO).mutation(api.polls.vote, { pollId, optionId: "opt1" });
    await as(t, ADA).mutation(api.polls.setStatus, { pollId, status: "closed" });
    await expect(as(t, DEV).mutation(api.polls.vote, { pollId, optionId: "opt1" })).rejects.toMatchObject(code("CONFLICT"));
    // A closed poll still answers the retry of an already-cast vote.
    expect(await as(t, CLEO).mutation(api.polls.vote, { pollId, optionId: "opt1" })).toEqual({ optionId: "opt1" });

    await as(t, ADA).mutation(api.rooms.update, { roomId, status: "closed" });
    await expect(as(t, CLEO).mutation(api.polls.vote, { pollId, optionId: "opt1" })).rejects.toMatchObject(code("ROOM_CLOSED"));
  });

  it("fails cleanly for a poll that does not exist", async () => {
    const { t, roomId } = await setup();
    const { pollId } = await as(t, ADA).mutation(api.polls.create, { roomId, prompt: "Vanishing act", options: OPTIONS });
    await t.run((ctx) => ctx.db.delete(pollId));
    await expect(as(t, CLEO).mutation(api.polls.vote, { pollId, optionId: "opt1" })).rejects.toMatchObject(code("NOT_FOUND"));
  });
});
