// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { ADA, BEN, CLEO, as, code, createBackend } from "../helpers/convex";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = createBackend();
  const { roomId, code: joinCode } = await as(t, ADA).mutation(api.rooms.create, { title: "Town hall", moderated: false });
  for (const who of [BEN, CLEO]) await as(t, who).mutation(api.rooms.join, { code: joinCode });
  return { t, roomId };
}

describe("presence", () => {
  it("counts people with a fresh heartbeat and drops them after the TTL", async () => {
    const { t, roomId } = await setup();
    await as(t, ADA).mutation(api.presence.heartbeat, { roomId });
    await as(t, BEN).mutation(api.presence.heartbeat, { roomId });
    expect(await as(t, CLEO).query(api.presence.list, { roomId })).toEqual({ count: 2, names: ["Ada", "Ben"] });

    vi.setSystemTime(new Date("2026-03-01T10:00:30Z"));
    await as(t, ADA).mutation(api.presence.heartbeat, { roomId });
    vi.setSystemTime(new Date("2026-03-01T10:01:00Z"));
    expect(await as(t, CLEO).query(api.presence.list, { roomId })).toEqual({ count: 1, names: ["Ada"] });
  });

  it("keeps one row per person however many tabs ping", async () => {
    const { t, roomId } = await setup();
    await as(t, ADA).mutation(api.presence.heartbeat, { roomId });
    vi.setSystemTime(new Date("2026-03-01T10:00:06Z"));
    await Promise.all([1, 2, 3].map(() => as(t, ADA).mutation(api.presence.heartbeat, { roomId })));
    expect((await as(t, ADA).query(api.presence.list, { roomId })).count).toBe(1);
    expect(await t.run((ctx) => ctx.db.query("presence").collect())).toHaveLength(1);
  });

  it("throttles over-eager clients quietly", async () => {
    const { t, roomId } = await setup();
    const results = [];
    for (let i = 0; i < 8; i++) results.push((await as(t, ADA).mutation(api.presence.heartbeat, { roomId })).recorded);
    expect(results.slice(0, 6).every(Boolean)).toBe(true);
    expect(results.slice(6)).toEqual([false, false]);
  });

  it("removes the caller on leave and is scoped to members", async () => {
    const { t, roomId } = await setup();
    await as(t, ADA).mutation(api.presence.heartbeat, { roomId });
    await as(t, BEN).mutation(api.presence.heartbeat, { roomId });
    await as(t, ADA).mutation(api.presence.leave, { roomId });
    await as(t, ADA).mutation(api.presence.leave, { roomId });
    expect((await as(t, BEN).query(api.presence.list, { roomId })).names).toEqual(["Ben"]);
    await expect(as(t, { userId: "user_out", name: "Out" }).query(api.presence.list, { roomId })).rejects.toMatchObject(code("NOT_FOUND"));
  });
});

describe("maintenance", () => {
  it("prunes stale presence and idle rate-limit buckets but keeps fresh rows", async () => {
    const { t, roomId } = await setup();
    await as(t, ADA).mutation(api.presence.heartbeat, { roomId });
    vi.setSystemTime(new Date("2026-03-01T11:30:00Z"));
    await as(t, BEN).mutation(api.presence.heartbeat, { roomId });

    const pruned = await t.mutation(internal.maintenance.prune, {});
    expect(pruned.presence).toBe(1);
    expect(pruned.rateLimits).toBeGreaterThan(0);
    const remaining = await t.run((ctx) => ctx.db.query("presence").collect());
    expect(remaining.map((row) => row.name)).toEqual(["Ben"]);
    const buckets = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(buckets.every((row) => row.updatedAt >= Date.parse("2026-03-01T10:30:00Z"))).toBe(true);
  });
});
