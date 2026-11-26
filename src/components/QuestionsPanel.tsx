import { useState, type FormEvent } from "react";
import { Failure } from "./Failure";
import { QuestionCard } from "./QuestionCard";
import { LIMITS } from "../../convex/lib/validation";
import type { QuestionView, RoomView } from "../backend/contract";
import { useLiveQuery, useMutation, useSubmit } from "../backend/react";

function AskForm({ room }: { room: RoomView }) {
  const submitQuestion = useMutation("questions.submit");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const submit = useSubmit(async () => {
    const { status } = await submitQuestion({ roomId: room.id, body, anonymous });
    setBody("");
    setConfirmation(status === "pending" ? "Sent. A moderator will review it before it appears." : "Posted.");
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setConfirmation("");
    void submit.run();
  };

  if (room.status === "closed") {
    return <p className="notice">This room is closed. Questions and votes are frozen.</p>;
  }
  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="ask-heading">
      <h2 id="ask-heading">Ask a question</h2>
      <label htmlFor="question-body">Your question</label>
      <textarea
        id="question-body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={LIMITS.question.max}
        rows={3}
        required
      />
      <p className="muted counter" aria-hidden="true">
        {body.length}/{LIMITS.question.max}
      </p>
      <label className="check">
        <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} />
        Hide my name from the audience
      </label>
      <Failure failure={submit.failure} />
      <p role="status" className="notice notice-ok" hidden={!confirmation}>
        {confirmation}
      </p>
      <button type="submit" className="btn" disabled={submit.pending || body.trim().length === 0}>
        Send question
      </button>
    </form>
  );
}

export function QuestionsPanel({ room }: { room: RoomView }) {
  const { data, error, loading } = useLiveQuery("questions.list", { roomId: room.id });
  const open = data?.filter((q: QuestionView) => q.status !== "answered") ?? [];
  const answered = data?.filter((q: QuestionView) => q.status === "answered") ?? [];

  const renderList = (items: QuestionView[]) => (
    <ul className="question-list">
      {items.map((question) => (
        <QuestionCard
          key={question.id}
          question={question}
          roomId={room.id}
          role={room.role}
          roomOpen={room.status === "open"}
        />
      ))}
    </ul>
  );

  return (
    <div className="stack">
      <AskForm room={room} />
      <Failure failure={error} />
      {loading && <p role="status">Loading questions…</p>}
      {data && (
        <>
          <section aria-labelledby="open-heading">
            <h2 id="open-heading">Questions ({open.length})</h2>
            {open.length === 0 ? <p className="muted">Nothing here yet. Be the first to ask.</p> : renderList(open)}
          </section>
          {answered.length > 0 && (
            <section aria-labelledby="answered-heading">
              <h2 id="answered-heading">Answered ({answered.length})</h2>
              {renderList(answered)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
