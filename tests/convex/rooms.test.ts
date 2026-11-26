// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { ADA, BEN, CLEO, DEV, as, code, createBackend } from "../helpers/convex";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function newRoom(t = createBackend(), moderated = false) {
  const created = await as(t, ADA).mutation(api.rooms.create, { title: "Town hall", moderated });
  return { t, ...created };
}

describe("authentication", () => {
  it("rejects anonymous callers everywhere", async () => {
    const { t, roomId } = await newRoom();
    await expect(t.mutation(api.rooms.create, { title: "Nope nope", moderated: false })).rejects.toMatchObject(code("UNAUTHENTICATED"));
    await expect(t.mutation(api.rooms.join, { code: "ABCDEF" })).rejects.toMatchObject(code("UNAUTHENTICATED"));
    await expect(t.query(api.rooms.get, { roomId })).rejects.toMatchObject(code("UNAUTHENTICATED"));
    await expect(t.query(api.questions.list, { roomId })).rejects.toMatchObject(code("UNAUTHENTICATED"));
    await expect(t.mutation(api.presence.heartbeat, { roomId })).rejects.toMatchObject(code("UNAUTHENTICATED"));
  });
});

describe("creating rooms", () => {
  it("creates a room with a valid code and makes the creator host", async () => {
    const { t, roomId, code: joinCode } = await newRoom();
    expect(joinCode).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    const room = await as(t, ADA).query(api.rooms.get, { roomId });
    expect(room).toMatchObject({ title: "Town hall", role: "host", status: "open", moderated: false, pendingCount: 0 });
  });

  it("validates the title and normalises whitespace", async () => {
    const t = createBackend();
    await expect(as(t, ADA).mutation(api.rooms.create, { title: "  ", moderated: false })).rejects.toMatchObject(code("VALIDATION"));
    const created = await as(t, ADA).mutation(api.rooms.create, { title: "  Big   day  ", moderated: false });
    expect((await as(t, ADA).query(api.rooms.get, { roomId: created.roomId })).title).toBe("Big day");
  });

  it("allocates distinct codes even when the random source collides", async () => {
    const t = createBackend();
    const random = vi.spyOn(Math, "random");
    // First room draws "AAAAAA". The next room's first attempt draws it again (collision), the retry draws fresh.
    random.mockReturnValue(0);
    const first = await as(t, ADA).mutation(api.rooms.create, { title: "First room", moderated: false });
    random.mockReturnValue(0.5);
    for (let i = 0; i < 6; i++) random.mockReturnValueOnce(0);
    const second = await as(t, BEN).mutation(api.rooms.create, { title: "Second room", moderated: false });
    random.mockRestore();
    expect(first.code).toBe("AAAAAA");
    expect(second.code).not.toBe(first.code);
  });

  it("gives up with CONFLICT when no free code can be found", async () => {
    const t = createBackend();
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    await as(t, ADA).mutation(api.rooms.create, { title: "First room", moderated: false });
    await expect(as(t, BEN).mutation(api.rooms.create, { title: "Second room", moderated: false })).rejects.toMatchObject(code("CONFLICT"));
    random.mockRestore();
  });

  it("rate limits room creation per user", async () => {
    const t = createBackend();
    for (let i = 0; i < 3; i++) await as(t, ADA).mutation(api.rooms.create, { title: `Room ${i}`, moderated: false });
    await expect(as(t, ADA).mutation(api.rooms.create, { title: "Room 4", moderated: false })).rejects.toMatchObject(code("RATE_LIMITED"));
    await as(t, BEN).mutation(api.rooms.create, { title: "Ben room", moderated: false });
  });
});

describe("joining", () => {
  it("joins by code in any case, is idempotent, and never downgrades the host", async () => {
    const { t, roomId, code: joinCode } = await newRoom();
    const lower = joinCode.toLowerCase();
    expect(await as(t, CLEO).mutation(api.rooms.join, { code: lower })).toEqual({ status: "joined", roomId });
    expect(await as(t, CLEO).mutation(api.rooms.join, { code: `${joinCode.slice(0, 3)}-${joinCode.slice(3)}` })).toEqual({ status: "joined", roomId });
    expect(await as(t, ADA).mutation(api.rooms.join, { code: joinCode })).toEqual({ status: "joined", roomId });

    expect((await as(t, CLEO).query(api.rooms.get, { roomId })).role).toBe("participant");
    expect((await as(t, ADA).query(api.rooms.get, { roomId })).role).toBe("host");
    const members = await as(t, ADA).query(api.rooms.members, { roomId });
    expect(members.map((m) => m.name).sort()).toEqual(["Ada", "Cleo"]);
  });

  it("refreshes a changed display name on re-join", async () => {
    const { t, roomId, code: joinCode } = await newRoom();
    await as(t, CLEO).mutation(api.rooms.join, { code: joinCode });
    await as(t, { ...CLEO, name: "Cleo D." }).mutation(api.rooms.join, { code: joinCode });
    const members = await as(t, ADA).query(api.rooms.members, { roomId });
    expect(members.find((m) => m.userId === CLEO.userId)?.name).toBe("Cleo D.");
  });

  it("returns not_found for unknown or malformed codes", async () => {
    const { t } = await newRoom();
    expect(await as(t, CLEO).mutation(api.rooms.join, { code: "ZZZZZZ" })).toEqual({ status: "not_found" });
    expect(await as(t, CLEO).mutation(api.rooms.join, { code: "nope" })).toEqual({ status: "not_found" });
  });

  it("counts failed guesses against the rate limit instead of rolling them back", async () => {
    const { t, code: joinCode } = await newRoom();
    for (let i = 0; i < 5; i++) {
      expect(await as(t, DEV).mutation(api.rooms.join, { code: "ZZZZZZ" })).toEqual({ status: "not_found" });
    }
    const blocked = await as(t, DEV).mutation(api.rooms.join, { code: joinCode });
    expect(blocked).toMatchObject({ status: "rate_limited" });
    // The bucket refills with time (1 token per 12 s).
    vi.setSystemTime(new Date("2026-03-01T10:00:13Z"));
    expect(await as(t, DEV).mutation(api.rooms.join, { code: joinCode })).toMatchObject({ status: "joined" });
  });

  it("lists my rooms, newest first", async () => {
    const t = createBackend();
    const a = await as(t, ADA).mutation(api.rooms.create, { title: "Room A", moderated: false });
    const b = await as(t, BEN).mutation(api.rooms.create, { title: "Room B", moderated: false });
    await as(t, ADA).mutation(api.rooms.join, { code: b.code });
    const mine = await as(t, ADA).query(api.rooms.mine, {});
    expect(mine.map((r) => [r.title, r.role])).toEqual([["Room B", "participant"], ["Room A", "host"]]);
    expect(a.roomId).toBeDefined();
    expect(await as(t, CLEO).query(api.rooms.mine, {})).toEqual([]);
  });
});

describe("room isolation and permissions", () => {
  it("hides rooms from non-members with the same error as a missing room", async () => {
    const { t, roomId } = await newRoom();
    const other = await as(t, BEN).mutation(api.rooms.create, { title: "Other room", moderated: false });
    await expect(as(t, CLEO).query(api.rooms.get, { roomId })).rejects.toMatchObject(code("NOT_FOUND"));
    await expect(as(t, BEN).query(api.rooms.get, { roomId })).rejects.toMatchObject(code("NOT_FOUND"));
    await expect(as(t, CLEO).query(api.questions.list, { roomId })).rejects.toMatchObject(code("NOT_FOUND"));
    await expect(as(t, CLEO).query(api.polls.list, { roomId })).rejects.toMatchObject(code("NOT_FOUND"));
    await expect(as(t, CLEO).mutation(api.questions.submit, { roomId, body: "Can I sneak in?", anonymous: false })).rejects.toMatchObject(code("NOT_FOUND"));
    expect(other.roomId).not.toBe(roomId);
  });

  it("only the host manages the room and its people", async () => {
    const { t, roomId, code: joinCode } = await newRoom();
    await as(t, BEN).mutation(api.rooms.join, { code: joinCode });
    await as(t, CLEO).mutation(api.rooms.join, { code: joinCode });
    await as(t, ADA).mutation(api.rooms.setRole, { roomId, userId: BEN.userId, role: "moderator" });

    await expect(as(t, CLEO).mutation(api.rooms.update, { roomId, status: "closed" })).rejects.toMatchObject(code("FORBIDDEN"));
    await expect(as(t, BEN).mutation(api.rooms.update, { roomId, moderated: true })).rejects.toMatchObject(code("FORBIDDEN"));
    await expect(as(t, BEN).query(api.rooms.members, { roomId })).rejects.toMatchObject(code("FORBIDDEN"));
    await expect(as(t, BEN).mutation(api.rooms.setRole, { roomId, userId: CLEO.userId, role: "moderator" })).rejects.toMatchObject(code("FORBIDDEN"));
    await expect(as(t, ADA).mutation(api.rooms.setRole, { roomId, userId: ADA.userId, role: "participant" })).rejects.toMatchObject(code("FORBIDDEN"));
    await expect(as(t, ADA).mutation(api.rooms.setRole, { roomId, userId: DEV.userId, role: "moderator" })).rejects.toMatchObject(code("NOT_FOUND"));

    await as(t, ADA).mutation(api.rooms.update, { roomId, moderated: true, status: "closed" });
    expect(await as(t, CLEO).query(api.rooms.get, { roomId })).toMatchObject({ moderated: true, status: "closed" });
    await as(t, ADA).mutation(api.rooms.setRole, { roomId, userId: BEN.userId, role: "participant" });
    expect((await as(t, BEN).query(api.rooms.get, { roomId })).role).toBe("participant");
  });
});
