import type { QuestionStatus } from "./moderation";
import type { OptionResult } from "./pollTally";
import type { Role } from "./roles";

/** Shapes returned to clients. Both the Convex functions and the demo backend produce these. */
export interface QuestionView {
  id: string;
  body: string;
  status: QuestionStatus;
  votes: number;
  /** Null when the author asked to stay anonymous (and the viewer is not the author). */
  authorName: string | null;
  mine: boolean;
  votedByMe: boolean;
  spotlight: boolean;
  createdAt: number;
}

export interface RoomView {
  id: string;
  code: string;
  title: string;
  status: "open" | "closed";
  moderated: boolean;
  role: Role;
  /** Questions waiting for review. Only moderators see a non-zero number. */
  pendingCount: number;
}

export interface RoomSummary {
  id: string;
  code: string;
  title: string;
  status: "open" | "closed";
  role: Role;
}

export interface MemberView {
  userId: string;
  name: string;
  role: Role;
}

export interface PollView {
  id: string;
  prompt: string;
  status: "open" | "closed";
  total: number;
  options: OptionResult[];
  myVote: string | null;
  createdAt: number;
}

export interface PresenceView {
  count: number;
  names: string[];
}

export type JoinResult =
  | { status: "joined"; roomId: string }
  | { status: "not_found" }
  | { status: "rate_limited"; retryAfterMs: number };

export const PRESENCE_TTL_MS = 45_000;
export const PRESENCE_NAME_LIMIT = 20;

export function toQuestionView(
  question: {
    _id: string;
    body: string;
    status: QuestionStatus;
    votes: number;
    authorId: string;
    authorName: string;
    anonymous: boolean;
    createdAt: number;
  },
  viewerId: string,
  votedIds: ReadonlySet<string>,
  spotlightId: string | undefined,
): QuestionView {
  const mine = question.authorId === viewerId;
  return {
    id: question._id,
    body: question.body,
    status: question.status,
    votes: question.votes,
    authorName: question.anonymous && !mine ? null : question.authorName,
    mine,
    votedByMe: votedIds.has(question._id),
    spotlight: spotlightId === question._id,
    createdAt: question.createdAt,
  };
}
