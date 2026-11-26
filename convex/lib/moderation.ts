export type QuestionStatus = "pending" | "approved" | "answered" | "rejected";
export type ModerationAction = "approve" | "reject" | "answer" | "reopen";

const TRANSITIONS: Record<QuestionStatus, Partial<Record<ModerationAction, QuestionStatus>>> = {
  pending: { approve: "approved", reject: "rejected" },
  approved: { answer: "answered", reject: "rejected" },
  answered: { reopen: "approved", reject: "rejected" },
  rejected: { approve: "approved" },
};

/** The status after `action`, or null when the transition is not allowed. */
export function nextStatus(status: QuestionStatus, action: ModerationAction): QuestionStatus | null {
  return TRANSITIONS[status][action] ?? null;
}

/** Rooms with moderation on hold new questions until a moderator approves them. */
export function initialStatus(moderated: boolean): QuestionStatus {
  return moderated ? "pending" : "approved";
}

export interface Viewer {
  userId: string;
  canModerate: boolean;
}

/**
 * Moderators see everything. Everyone else sees approved and answered questions
 * plus their own pending or rejected ones, so a rejection is never silent.
 */
export function isVisibleTo(question: { status: QuestionStatus; authorId: string }, viewer: Viewer): boolean {
  if (viewer.canModerate) return true;
  if (question.status === "approved" || question.status === "answered") return true;
  return question.authorId === viewer.userId;
}

/** Only open (approved) questions collect upvotes. */
export const isVotable = (status: QuestionStatus): boolean => status === "approved";

/** A question can be on the presenter screen only while it is open. */
export const canSpotlight = (status: QuestionStatus): boolean => status === "approved";

export function rankQuestions<T extends { votes: number; createdAt: number }>(questions: readonly T[]): T[] {
  return [...questions].sort((a, b) => b.votes - a.votes || a.createdAt - b.createdAt);
}
