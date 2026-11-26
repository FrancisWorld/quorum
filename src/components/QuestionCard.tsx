import { Failure } from "./Failure";
import { can, type Role } from "../../convex/lib/roles";
import type { ModerationAction, QuestionView } from "../backend/contract";
import { useMutation, useSubmit } from "../backend/react";

const STATUS_LABEL: Record<QuestionView["status"], string> = {
  pending: "Awaiting review",
  approved: "Open",
  answered: "Answered",
  rejected: "Rejected",
};

const ACTIONS_BY_STATUS: Record<QuestionView["status"], { action: ModerationAction; label: string }[]> = {
  pending: [
    { action: "approve", label: "Approve" },
    { action: "reject", label: "Reject" },
  ],
  approved: [
    { action: "answer", label: "Mark answered" },
    { action: "reject", label: "Reject" },
  ],
  answered: [
    { action: "reopen", label: "Reopen" },
    { action: "reject", label: "Reject" },
  ],
  rejected: [{ action: "approve", label: "Restore" }],
};

export function QuestionCard({
  question,
  roomId,
  role,
  roomOpen,
}: {
  question: QuestionView;
  roomId: string;
  role: Role;
  roomOpen: boolean;
}) {
  const setVote = useMutation("questions.setVote");
  const moderate = useMutation("questions.moderate");
  const setSpotlight = useMutation("rooms.setSpotlight");
  const vote = useSubmit(() => setVote({ questionId: question.id, voted: !question.votedByMe }));
  const act = useSubmit((action: ModerationAction) => moderate({ questionId: question.id, action }));
  const spot = useSubmit(() =>
    setSpotlight({ roomId, questionId: question.spotlight ? null : question.id }),
  );

  const canModerate = can(role, "moderate");
  const votable = question.status === "approved" && roomOpen;
  const failure = vote.failure ?? act.failure ?? spot.failure;

  return (
    <li className={`card question status-${question.status}${question.spotlight ? " spotlit" : ""}`}>
      <button
        type="button"
        className="vote"
        aria-pressed={question.votedByMe}
        aria-label={`${question.votedByMe ? "Remove your upvote from" : "Upvote"}: ${question.body}`}
        disabled={vote.pending || (!question.votedByMe && !votable)}
        onClick={() => void vote.run()}
      >
        <span aria-hidden="true">▲</span>
        <span className="vote-count">{question.votes}</span>
        <span className="visually-hidden"> upvotes</span>
      </button>
      <div className="question-body">
        <p className="question-text">{question.body}</p>
        <p className="muted meta">
          {question.authorName ?? "Anonymous"}
          {question.mine ? " (you)" : ""}
          {question.status !== "approved" && <span className={`pill pill-${question.status}`}>{STATUS_LABEL[question.status]}</span>}
          {question.spotlight && <span className="pill pill-spot">On screen</span>}
        </p>
        {canModerate && (
          <div className="actions" role="group" aria-label={`Moderate: ${question.body}`}>
            {ACTIONS_BY_STATUS[question.status].map(({ action, label }) => (
              <button
                key={action}
                type="button"
                className="btn btn-small btn-secondary"
                disabled={act.pending}
                onClick={() => void act.run(action)}
              >
                {label}
              </button>
            ))}
            {question.status === "approved" && (
              <button type="button" className="btn btn-small btn-secondary" disabled={spot.pending} onClick={() => void spot.run()}>
                {question.spotlight ? "Remove from screen" : "Show on screen"}
              </button>
            )}
          </div>
        )}
        <Failure failure={failure} />
      </div>
    </li>
  );
}
