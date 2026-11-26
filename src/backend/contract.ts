import type {
  JoinResult,
  MemberView,
  PollView,
  PresenceView,
  QuestionView,
  RoomSummary,
  RoomView,
} from "../../convex/lib/views";
import type { ErrorCode } from "../../convex/lib/errors";
import type { ModerationAction, QuestionStatus } from "../../convex/lib/moderation";

export type {
  JoinResult,
  MemberView,
  PollView,
  PresenceView,
  QuestionView,
  RoomSummary,
  RoomView,
  ModerationAction,
  QuestionStatus,
};

/**
 * The surface the UI talks to. Two adapters implement it: Convex (live) and an
 * in-memory backend (demo). convexBackend.ts checks every entry against the real
 * function types at compile time, and tests/app/conformance.test.ts runs the same
 * scenarios against both implementations, so they cannot drift silently.
 */
export interface QueryContract {
  "rooms.get": { args: { roomId: string }; result: RoomView };
  "rooms.mine": { args: Record<string, never>; result: RoomSummary[] };
  "rooms.members": { args: { roomId: string }; result: MemberView[] };
  "questions.list": { args: { roomId: string }; result: QuestionView[] };
  "polls.list": { args: { roomId: string }; result: PollView[] };
  "presence.list": { args: { roomId: string }; result: PresenceView };
}

export interface MutationContract {
  "rooms.create": { args: { title: string; moderated: boolean }; result: { roomId: string; code: string } };
  "rooms.join": { args: { code: string }; result: JoinResult };
  "rooms.update": { args: { roomId: string; moderated?: boolean; status?: "open" | "closed" }; result: void };
  "rooms.setSpotlight": { args: { roomId: string; questionId: string | null }; result: void };
  "rooms.setRole": {
    args: { roomId: string; userId: string; role: "moderator" | "participant" };
    result: void;
  };
  "questions.submit": {
    args: { roomId: string; body: string; anonymous: boolean };
    result: { questionId: string; status: QuestionStatus };
  };
  "questions.setVote": {
    args: { questionId: string; voted: boolean };
    result: { votes: number; votedByMe: boolean };
  };
  "questions.moderate": { args: { questionId: string; action: ModerationAction }; result: { status: QuestionStatus } };
  "polls.create": { args: { roomId: string; prompt: string; options: string[] }; result: { pollId: string } };
  "polls.setStatus": { args: { pollId: string; status: "open" | "closed" }; result: void };
  "polls.vote": { args: { pollId: string; optionId: string }; result: { optionId: string } };
  "presence.heartbeat": { args: { roomId: string }; result: { recorded: boolean } };
  "presence.leave": { args: { roomId: string }; result: void };
}

export type QueryName = keyof QueryContract;
export type MutationName = keyof MutationContract;
export type Unsubscribe = () => void;

export interface Backend {
  query<K extends QueryName>(name: K, args: QueryContract[K]["args"]): Promise<QueryContract[K]["result"]>;
  /** Pushes a fresh result whenever the underlying data changes. */
  subscribe<K extends QueryName>(
    name: K,
    args: QueryContract[K]["args"],
    onData: (data: QueryContract[K]["result"]) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe;
  mutate<K extends MutationName>(name: K, args: MutationContract[K]["args"]): Promise<MutationContract[K]["result"]>;
}

export interface AppFailure {
  code: ErrorCode | "UNKNOWN";
  message: string;
  retryAfterMs?: number;
}
