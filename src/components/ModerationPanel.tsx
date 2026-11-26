import { Failure } from "./Failure";
import { QuestionCard } from "./QuestionCard";
import type { RoomView } from "../backend/contract";
import { useLiveQuery } from "../backend/react";

/** Queue of questions awaiting review, plus rejected ones so a decision can be undone. */
export function ModerationPanel({ room }: { room: RoomView }) {
  const { data, error, loading } = useLiveQuery("questions.list", { roomId: room.id });
  const pending = data?.filter((q) => q.status === "pending") ?? [];
  const rejected = data?.filter((q) => q.status === "rejected") ?? [];

  const render = (items: typeof pending) => (
    <ul className="question-list">
      {items.map((question) => (
        <QuestionCard key={question.id} question={question} roomId={room.id} role={room.role} roomOpen={room.status === "open"} />
      ))}
    </ul>
  );

  return (
    <div className="stack">
      {!room.moderated && (
        <p className="notice">Review is off for this room: new questions go live immediately. Turn it on under Settings.</p>
      )}
      <Failure failure={error} />
      {loading && <p role="status">Loading queue…</p>}
      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading">Awaiting review ({pending.length})</h2>
        {pending.length === 0 ? <p className="muted">The queue is empty.</p> : render(pending)}
      </section>
      {rejected.length > 0 && (
        <section aria-labelledby="rejected-heading">
          <h2 id="rejected-heading">Rejected ({rejected.length})</h2>
          {render(rejected)}
        </section>
      )}
    </div>
  );
}
