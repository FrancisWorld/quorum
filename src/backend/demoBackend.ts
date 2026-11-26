import { appError } from "../../convex/lib/errors";
import { generateJoinCode, normalizeJoinCode, type RandomIndex } from "../../convex/lib/joinCode";
import {
  canSpotlight,
  initialStatus,
  isVisibleTo,
  isVotable,
  nextStatus,
  rankQuestions,
  type QuestionStatus,
} from "../../convex/lib/moderation";
import { tallyPoll, type PollOption } from "../../convex/lib/pollTally";
import { RATE_LIMITS, consumeToken, type BucketState, type RateLimitKind } from "../../convex/lib/rateLimit";
import { can, type Role } from "../../convex/lib/roles";
import {
  displayName,
  duplicateKey,
  validatePollOptions,
  validatePollPrompt,
  validateQuestion,
  validateRoomTitle,
} from "../../convex/lib/validation";
import {
  PRESENCE_NAME_LIMIT,
  PRESENCE_TTL_MS,
  toQuestionView,
  type MemberView,
  type PollView,
  type PresenceView,
  type QuestionView,
  type RoomSummary,
  type RoomView,
} from "../../convex/lib/views";
import type {
  Backend,
  MutationContract,
  MutationName,
  QueryContract,
  QueryName,
  Unsubscribe,
} from "./contract";

export interface DemoUser {
  id: string;
  name: string;
  blurb: string;
}

export const DEMO_USERS: readonly DemoUser[] = [
  { id: "demo_ada", name: "Ada Okafor", blurb: "Host of the seeded room" },
  { id: "demo_ben", name: "Ben Larsen", blurb: "Moderator in the seeded room" },
  { id: "demo_cleo", name: "Cleo Duarte", blurb: "Participant" },
  { id: "demo_dev", name: "Dev Rao", blurb: "Participant" },
];

export const DEMO_ROOM_CODE = "KEYNT4M7";

interface RoomRow {
  id: string;
  code: string;
  title: string;
  hostId: string;
  status: "open" | "closed";
  moderated: boolean;
  spotlightQuestionId: string | undefined;
}
interface MemberRow {
  roomId: string;
  userId: string;
  name: string;
  role: Role;
}
interface QuestionRow {
  _id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  anonymous: boolean;
  body: string;
  status: QuestionStatus;
  votes: number;
  createdAt: number;
}
interface PollRow {
  id: string;
  roomId: string;
  prompt: string;
  options: PollOption[];
  status: "open" | "closed";
  createdAt: number;
}
interface State {
  counter: number;
  rooms: RoomRow[];
  members: MemberRow[];
  questions: QuestionRow[];
  upvotes: { questionId: string; roomId: string; voterId: string }[];
  polls: PollRow[];
  pollVotes: { pollId: string; voterId: string; optionId: string }[];
  presence: { roomId: string; userId: string; name: string; seenAt: number }[];
  buckets: Record<string, BucketState>;
}

export interface DemoOptions {
  now?: () => number;
  /** Integer in [0, max); defaults to the same CSPRNG-backed sampler the Convex functions use. */
  randomIndex?: RandomIndex;
  /** Seed the sample room. Conformance tests start from an empty world. */
  seed?: boolean;
}

type Handlers = { [K in MutationName]: (args: MutationContract[K]["args"]) => MutationContract[K]["result"] };
type Queries = { [K in QueryName]: (args: QueryContract[K]["args"]) => QueryContract[K]["result"] };

interface Subscription {
  run: () => void;
}

/**
 * In-memory implementation of the backend contract for offline demo mode.
 * It reuses the pure domain modules from convex/lib (validation, moderation
 * rules, rate limiter, poll tally) and mirrors the Convex functions' control
 * flow. Each mutation runs on a snapshot and rolls back when it throws, which
 * matches Convex's transactional behaviour (e.g. a refused request refunds its
 * rate-limit token). tests/app/conformance.test.ts holds both to one spec.
 */
export class DemoBackend implements Backend {
  /** Marker the production-bundle check looks for: this class must never ship in a prod build. */
  readonly kind = "quorum-demo-backend";

  private state: State = emptyState();
  private user: DemoUser | null = null;
  private readonly subscriptions = new Set<Subscription>();
  private readonly identityListeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly randomIndex: RandomIndex | undefined;

  constructor(options: DemoOptions = {}) {
    this.now = options.now ?? Date.now;
    this.randomIndex = options.randomIndex;
    if (options.seed ?? true) this.seed();
  }

  /** Signs in as a persona, or out with `null`. Live queries re-evaluate for the new identity. */
  signInAs(user: DemoUser | null): void {
    this.user = user;
    for (const listener of [...this.identityListeners]) listener();
    this.notify();
  }

  /** For `useSyncExternalStore`: fires whenever the signed-in persona changes. */
  onIdentityChange = (listener: () => void): Unsubscribe => {
    this.identityListeners.add(listener);
    return () => {
      this.identityListeners.delete(listener);
    };
  };

  currentUser = (): DemoUser | null => this.user;

  async query<K extends QueryName>(name: K, args: QueryContract[K]["args"]): Promise<QueryContract[K]["result"]> {
    return this.queries[name](args);
  }

  subscribe<K extends QueryName>(
    name: K,
    args: QueryContract[K]["args"],
    onData: (data: QueryContract[K]["result"]) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    let last: string | undefined;
    const subscription: Subscription = {
      run: () => {
        try {
          const data = this.queries[name](args);
          const serialised = JSON.stringify(data) ?? "";
          if (serialised !== last) {
            last = serialised;
            onData(data);
          }
        } catch (error) {
          last = undefined;
          onError(error);
        }
      },
    };
    this.subscriptions.add(subscription);
    queueMicrotask(() => {
      if (this.subscriptions.has(subscription)) subscription.run();
    });
    return () => {
      this.subscriptions.delete(subscription);
    };
  }

  async mutate<K extends MutationName>(
    name: K,
    args: MutationContract[K]["args"],
  ): Promise<MutationContract[K]["result"]> {
    const snapshot = structuredClone(this.state);
    try {
      const result = this.handlers[name](args);
      this.notify();
      return result;
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }

  private notify(): void {
    for (const subscription of [...this.subscriptions]) subscription.run();
  }

  // ---- helpers mirroring convex/lib/access.ts ----

  private caller() {
    if (!this.user) throw appError("UNAUTHENTICATED", "Sign in to continue.");
    return { userId: this.user.id, name: displayName(this.user.name) };
  }

  private membership(roomId: string) {
    const caller = this.caller();
    const room = this.state.rooms.find((r) => r.id === roomId);
    const member = room && this.state.members.find((m) => m.roomId === roomId && m.userId === caller.userId);
    if (!room || !member) throw appError("NOT_FOUND", "Room not found.");
    return { caller, room, member };
  }

  private permission(role: Role, permission: Parameters<typeof can>[1]): void {
    if (!can(role, permission)) throw appError("FORBIDDEN", "You do not have permission to do that in this room.");
  }

  private openRoom(room: RoomRow): void {
    if (room.status === "closed") throw appError("ROOM_CLOSED", "This room is closed.");
  }

  private consume(kind: RateLimitKind, subject: string): { allowed: boolean; retryAfterMs: number } {
    const key = `${kind}:${subject}`;
    const result = consumeToken(this.state.buckets[key] ?? null, this.now(), RATE_LIMITS[kind]);
    this.state.buckets[key] = result.state;
    return { allowed: result.allowed, retryAfterMs: result.retryAfterMs };
  }

  private hasCapacity(kind: RateLimitKind, subject: string): { allowed: boolean; retryAfterMs: number } {
    const { allowed, retryAfterMs } = consumeToken(this.state.buckets[`${kind}:${subject}`] ?? null, this.now(), RATE_LIMITS[kind]);
    return { allowed, retryAfterMs };
  }

  private enforce(kind: RateLimitKind, subject: string): void {
    const { allowed, retryAfterMs } = this.consume(kind, subject);
    if (!allowed) throw appError("RATE_LIMITED", "Too many requests. Slow down and retry shortly.", { retryAfterMs });
  }

  private nextId(prefix: string): string {
    this.state.counter += 1;
    return `${prefix}_${this.state.counter}`;
  }

  private findQuestion(questionId: string): QuestionRow {
    const question = this.state.questions.find((q) => q._id === questionId);
    if (!question) throw appError("NOT_FOUND", "Question not found.");
    return question;
  }

  private findPoll(pollId: string): PollRow {
    const poll = this.state.polls.find((p) => p.id === pollId);
    if (!poll) throw appError("NOT_FOUND", "Poll not found.");
    return poll;
  }

  private closeOpenPolls(roomId: string): void {
    for (const poll of this.state.polls) if (poll.roomId === roomId) poll.status = "closed";
  }

  // ---- queries ----

  private readonly queries: Queries = {
    "rooms.get": ({ roomId }): RoomView => {
      const { room, member } = this.membership(roomId);
      const pendingCount =
        member.role === "participant"
          ? 0
          : Math.min(99, this.state.questions.filter((q) => q.roomId === roomId && q.status === "pending").length);
      return {
        id: room.id,
        code: room.code,
        title: room.title,
        status: room.status,
        moderated: room.moderated,
        role: member.role,
        pendingCount,
      };
    },

    "rooms.mine": (): RoomSummary[] => {
      const caller = this.caller();
      return this.state.members
        .filter((m) => m.userId === caller.userId)
        .reverse()
        .flatMap((m) => {
          const room = this.state.rooms.find((r) => r.id === m.roomId);
          return room ? [{ id: room.id, code: room.code, title: room.title, status: room.status, role: m.role }] : [];
        });
    },

    "rooms.members": ({ roomId }): MemberView[] => {
      const { member } = this.membership(roomId);
      this.permission(member.role, "manageRoom");
      return this.state.members
        .filter((m) => m.roomId === roomId)
        .map((m) => ({ userId: m.userId, name: m.name, role: m.role }));
    },

    "questions.list": ({ roomId }): QuestionView[] => {
      const { caller, room, member } = this.membership(roomId);
      const viewer = { userId: caller.userId, canModerate: can(member.role, "moderate") };
      const voted = new Set(
        this.state.upvotes.filter((u) => u.roomId === roomId && u.voterId === caller.userId).map((u) => u.questionId),
      );
      const visible = this.state.questions.filter((q) => q.roomId === roomId && isVisibleTo(q, viewer));
      return rankQuestions(visible).map((q) => toQuestionView(q, caller.userId, voted, room.spotlightQuestionId));
    },

    "polls.list": ({ roomId }): PollView[] => {
      const { caller } = this.membership(roomId);
      return this.state.polls
        .filter((p) => p.roomId === roomId)
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id, undefined, { numeric: true }))
        .map((poll) => {
          const votes = this.state.pollVotes.filter((v) => v.pollId === poll.id);
          const result = tallyPoll(poll.options, votes.map((v) => v.optionId));
          return {
            id: poll.id,
            prompt: poll.prompt,
            status: poll.status,
            total: result.total,
            options: result.options,
            myVote: votes.find((v) => v.voterId === caller.userId)?.optionId ?? null,
            createdAt: poll.createdAt,
          };
        });
    },

    "presence.list": ({ roomId }): PresenceView => {
      this.membership(roomId);
      const cutoff = this.now() - PRESENCE_TTL_MS;
      const here = this.state.presence.filter((p) => p.roomId === roomId && p.seenAt > cutoff);
      return { count: here.length, names: here.slice(0, PRESENCE_NAME_LIMIT).map((p) => p.name) };
    },
  };

  // ---- mutations ----

  private readonly handlers: Handlers = {
    "rooms.create": ({ title, moderated }) => {
      const caller = this.caller();
      const cleanTitle = validateRoomTitle(title);
      this.enforce("createRoom", caller.userId);
      let code: string | null = null;
      for (let attempt = 0; attempt < 10 && code === null; attempt++) {
        const candidate = generateJoinCode(this.randomIndex);
        if (!this.state.rooms.some((r) => r.code === candidate)) code = candidate;
      }
      if (code === null) throw appError("CONFLICT", "Could not allocate a join code. Try again.");
      const roomId = this.nextId("room");
      this.state.rooms.push({
        id: roomId,
        code,
        title: cleanTitle,
        hostId: caller.userId,
        status: "open",
        moderated,
        spotlightQuestionId: undefined,
      });
      this.state.members.push({ roomId, userId: caller.userId, name: caller.name, role: "host" });
      return { roomId, code };
    },

    "rooms.join": ({ code }) => {
      const caller = this.caller();
      const limit = this.consume("join", caller.userId);
      if (!limit.allowed) return { status: "rate_limited", retryAfterMs: limit.retryAfterMs };
      const global = this.hasCapacity("joinFailure", "global");
      if (!global.allowed) return { status: "rate_limited", retryAfterMs: global.retryAfterMs };
      const normalized = normalizeJoinCode(code);
      const room = normalized ? this.state.rooms.find((r) => r.code === normalized) : undefined;
      if (!room) {
        this.consume("joinFailure", "global");
        return { status: "not_found" };
      }
      const existing = this.state.members.find((m) => m.roomId === room.id && m.userId === caller.userId);
      if (!existing) {
        this.state.members.push({ roomId: room.id, userId: caller.userId, name: caller.name, role: "participant" });
      } else {
        existing.name = caller.name;
      }
      return { status: "joined", roomId: room.id };
    },

    "rooms.update": ({ roomId, moderated, status }) => {
      const { room, member } = this.membership(roomId);
      this.permission(member.role, "manageRoom");
      if (moderated !== undefined) room.moderated = moderated;
      if (status !== undefined) room.status = status;
    },

    "rooms.setSpotlight": ({ roomId, questionId }) => {
      const { room, member } = this.membership(roomId);
      this.permission(member.role, "present");
      if (questionId === null) {
        room.spotlightQuestionId = undefined;
        return;
      }
      const question = this.state.questions.find((q) => q._id === questionId);
      if (!question || question.roomId !== roomId) throw appError("NOT_FOUND", "Question not found.");
      if (!canSpotlight(question.status)) {
        throw appError("CONFLICT", "Only open questions can be put on the presenter screen.");
      }
      room.spotlightQuestionId = question._id;
    },

    "rooms.setRole": ({ roomId, userId, role }) => {
      const { member } = this.membership(roomId);
      this.permission(member.role, "manageRoom");
      const target = this.state.members.find((m) => m.roomId === roomId && m.userId === userId);
      if (!target) throw appError("NOT_FOUND", "That person has not joined this room.");
      if (target.role === "host") throw appError("FORBIDDEN", "The host role cannot be changed.");
      target.role = role;
    },

    "questions.submit": ({ roomId, body, anonymous }) => {
      const { caller, room } = this.membership(roomId);
      this.openRoom(room);
      const text = validateQuestion(body);
      this.enforce("question", `${roomId}:${caller.userId}`);
      const key = duplicateKey(text);
      const own = this.state.questions.filter((q) => q.roomId === roomId && q.authorId === caller.userId);
      if (own.some((q) => duplicateKey(q.body) === key)) throw appError("CONFLICT", "You already asked that question.");
      const status = initialStatus(room.moderated);
      const questionId = this.nextId("question");
      this.state.questions.push({
        _id: questionId,
        roomId,
        authorId: caller.userId,
        authorName: caller.name,
        anonymous,
        body: text,
        status,
        votes: 0,
        createdAt: this.now(),
      });
      return { questionId, status };
    },

    "questions.setVote": ({ questionId, voted }) => {
      const question = this.findQuestion(questionId);
      const { caller, room } = this.membership(question.roomId);
      this.openRoom(room);
      this.enforce("vote", caller.userId);
      const index = this.state.upvotes.findIndex((u) => u.questionId === questionId && u.voterId === caller.userId);
      if (voted && index < 0) {
        if (!isVotable(question.status)) throw appError("CONFLICT", "This question is not open for voting.");
        this.state.upvotes.push({ questionId, roomId: room.id, voterId: caller.userId });
        question.votes += 1;
        return { votes: question.votes, votedByMe: true };
      }
      if (!voted && index >= 0) {
        this.state.upvotes.splice(index, 1);
        question.votes = Math.max(0, question.votes - 1);
        return { votes: question.votes, votedByMe: false };
      }
      return { votes: question.votes, votedByMe: index >= 0 };
    },

    "questions.moderate": ({ questionId, action }) => {
      const question = this.findQuestion(questionId);
      const { room, member } = this.membership(question.roomId);
      this.permission(member.role, "moderate");
      const status = nextStatus(question.status, action);
      if (status === null) throw appError("CONFLICT", `Cannot ${action} a question that is ${question.status}.`);
      question.status = status;
      if (status !== "approved" && room.spotlightQuestionId === question._id) room.spotlightQuestionId = undefined;
      return { status };
    },

    "polls.create": ({ roomId, prompt, options }) => {
      const { room, member } = this.membership(roomId);
      this.permission(member.role, "managePolls");
      this.openRoom(room);
      const cleanPrompt = validatePollPrompt(prompt);
      const labels = validatePollOptions(options);
      this.closeOpenPolls(roomId);
      const id = this.nextId("poll");
      this.state.polls.push({
        id,
        roomId,
        prompt: cleanPrompt,
        options: labels.map((label, index) => ({ id: `opt${index + 1}`, label })),
        status: "open",
        createdAt: this.now(),
      });
      return { pollId: id };
    },

    "polls.setStatus": ({ pollId, status }) => {
      const poll = this.findPoll(pollId);
      const { room, member } = this.membership(poll.roomId);
      this.permission(member.role, "managePolls");
      if (status === "open") {
        this.openRoom(room);
        this.closeOpenPolls(poll.roomId);
      }
      poll.status = status;
    },

    "polls.vote": ({ pollId, optionId }) => {
      const poll = this.findPoll(pollId);
      const { caller, room } = this.membership(poll.roomId);
      this.openRoom(room);
      if (!poll.options.some((o) => o.id === optionId)) {
        throw appError("VALIDATION", "That option does not exist in this poll.");
      }
      this.enforce("pollVote", caller.userId);
      const existing = this.state.pollVotes.find((v) => v.pollId === pollId && v.voterId === caller.userId);
      if (existing) {
        if (existing.optionId === optionId) return { optionId };
        throw appError("CONFLICT", "You already voted in this poll.");
      }
      if (poll.status !== "open") throw appError("CONFLICT", "This poll is closed.");
      this.state.pollVotes.push({ pollId, voterId: caller.userId, optionId });
      return { optionId };
    },

    "presence.heartbeat": ({ roomId }) => {
      const { caller } = this.membership(roomId);
      if (!this.consume("heartbeat", `${roomId}:${caller.userId}`).allowed) return { recorded: false };
      const row = this.state.presence.find((p) => p.roomId === roomId && p.userId === caller.userId);
      const seenAt = this.now();
      if (row) {
        row.seenAt = seenAt;
        row.name = caller.name;
      } else {
        this.state.presence.push({ roomId, userId: caller.userId, name: caller.name, seenAt });
      }
      return { recorded: true };
    },

    "presence.leave": ({ roomId }) => {
      const { caller } = this.membership(roomId);
      this.state.presence = this.state.presence.filter((p) => !(p.roomId === roomId && p.userId === caller.userId));
    },
  };

  // ---- seed data ----

  private seed(): void {
    const [ada, ben, cleo, dev] = DEMO_USERS as [DemoUser, DemoUser, DemoUser, DemoUser];
    const now = this.now();
    const roomId = this.nextId("room");
    this.state.rooms.push({
      id: roomId,
      code: DEMO_ROOM_CODE,
      title: "Platform Summit: closing keynote",
      hostId: ada.id,
      status: "open",
      moderated: true,
      spotlightQuestionId: undefined,
    });
    this.state.members.push(
      { roomId, userId: ada.id, name: ada.name, role: "host" },
      { roomId, userId: ben.id, name: ben.name, role: "moderator" },
      { roomId, userId: cleo.id, name: cleo.name, role: "participant" },
      { roomId, userId: dev.id, name: dev.name, role: "participant" },
    );

    const ask = (author: DemoUser, body: string, status: QuestionStatus, voters: DemoUser[], anonymous = false) => {
      const id = this.nextId("question");
      this.state.questions.push({
        _id: id,
        roomId,
        authorId: author.id,
        authorName: author.name,
        anonymous,
        body,
        status,
        votes: voters.length,
        createdAt: now - 60_000 * (10 - this.state.questions.length),
      });
      for (const voter of voters) this.state.upvotes.push({ questionId: id, roomId, voterId: voter.id });
      return id;
    };
    const spotlight = ask(cleo, "How do you decide what NOT to build when the roadmap is full?", "approved", [dev, ben]);
    ask(dev, "Will the migration guide cover teams that cannot freeze deploys?", "approved", [cleo]);
    ask(cleo, "Is the new scheduler going to be open sourced?", "answered", [dev, ben, ada]);
    ask(dev, "Can we get the slides afterwards?", "pending", [], true);
    ask(cleo, "Are you hiring in the platform team?", "pending", []);
    const room = this.state.rooms[0];
    if (room) room.spotlightQuestionId = spotlight;

    const pollId = this.nextId("poll");
    this.state.polls.push({
      id: pollId,
      roomId,
      prompt: "Which topic should the next workshop cover?",
      options: ["Observability", "Cost control", "Incident reviews", "Developer experience"].map((label, i) => ({
        id: `opt${i + 1}`,
        label,
      })),
      status: "open",
      createdAt: now - 30_000,
    });
    this.state.pollVotes.push(
      { pollId, voterId: cleo.id, optionId: "opt1" },
      { pollId, voterId: dev.id, optionId: "opt3" },
    );
  }
}

function emptyState(): State {
  return {
    counter: 0,
    rooms: [],
    members: [],
    questions: [],
    upvotes: [],
    polls: [],
    pollVotes: [],
    presence: [],
    buckets: {},
  };
}
