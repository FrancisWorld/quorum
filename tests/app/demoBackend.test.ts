import { describe, expect, it, vi } from "vitest";
import { DEMO_ROOM_CODE, DEMO_USERS, DemoBackend } from "../../src/backend/demoBackend";
import { toFailure } from "../../src/lib/errors";

const [ada, , cleo] = DEMO_USERS as [(typeof DEMO_USERS)[number], (typeof DEMO_USERS)[number], (typeof DEMO_USERS)[number]];

describe("DemoBackend", () => {
  it("seeds a moderated room with questions in every state and an open poll", async () => {
    const demo = new DemoBackend();
    demo.signInAs(ada);
    const [summary] = await demo.query("rooms.mine", {});
    expect(summary).toMatchObject({ code: DEMO_ROOM_CODE, role: "host" });
    const questions = await demo.query("questions.list", { roomId: summary!.id });
    expect(new Set(questions.map((q) => q.status))).toEqual(new Set(["pending", "approved", "answered"]));
    expect(questions.some((q) => q.spotlight)).toBe(true);
    const polls = await demo.query("polls.list", { roomId: summary!.id });
    expect(polls[0]).toMatchObject({ status: "open", total: 2 });
  });

  it("starts from an empty world when not seeded", async () => {
    const demo = new DemoBackend({ seed: false });
    demo.signInAs(ada);
    expect(await demo.query("rooms.mine", {})).toEqual([]);
  });

  it("pushes updates to subscribers only when the result changes, and stops after unsubscribe", async () => {
    const demo = new DemoBackend({ seed: false });
    demo.signInAs(ada);
    const { roomId } = await demo.mutate("rooms.create", { title: "Live room", moderated: false });
    const seen: number[] = [];
    const stop = demo.subscribe("questions.list", { roomId }, (data) => seen.push(data.length), () => undefined);
    await vi.waitFor(() => expect(seen).toEqual([0]));

    await demo.mutate("questions.submit", { roomId, body: "First live question", anonymous: false });
    expect(seen).toEqual([0, 1]);
    await demo.mutate("presence.heartbeat", { roomId });
    expect(seen).toEqual([0, 1]);
    stop();
    await demo.mutate("questions.submit", { roomId, body: "Second live question", anonymous: false });
    expect(seen).toEqual([0, 1]);
  });

  it("reports query errors to subscribers and recovers when the identity changes", async () => {
    const demo = new DemoBackend();
    const results: string[] = [];
    demo.subscribe(
      "rooms.mine",
      {},
      (data) => results.push(`data:${data.length}`),
      (error) => results.push(`error:${toFailure(error).code}`),
    );
    await vi.waitFor(() => expect(results).toEqual(["error:UNAUTHENTICATED"]));
    demo.signInAs(cleo);
    expect(results.at(-1)).toBe("data:1");
  });

  it("notifies identity listeners", () => {
    const demo = new DemoBackend({ seed: false });
    const listener = vi.fn();
    const stop = demo.onIdentityChange(listener);
    demo.signInAs(ada);
    expect(demo.currentUser()).toBe(ada);
    stop();
    demo.signInAs(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("rolls back every change of a mutation that throws", async () => {
    const demo = new DemoBackend({ seed: false });
    demo.signInAs(ada);
    const { roomId } = await demo.mutate("rooms.create", { title: "Rollback", moderated: false });
    await demo.mutate("questions.submit", { roomId, body: "Only once please", anonymous: false });
    await expect(demo.mutate("questions.submit", { roomId, body: "Only once please", anonymous: false })).rejects.toThrow();
    expect(await demo.query("questions.list", { roomId })).toHaveLength(1);
  });
});
