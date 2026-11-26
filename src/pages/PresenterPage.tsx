import { Link, useParams } from "react-router-dom";
import { Failure } from "../components/Failure";
import { PollResults } from "../components/PollsPanel";
import { formatJoinCode } from "../../convex/lib/joinCode";
import { can } from "../../convex/lib/roles";
import { useLiveQuery } from "../backend/react";

const QUEUE_SIZE = 5;

/** Read-only, high-contrast screen for a projector: spotlit question, top of the queue, live poll. */
export function PresenterPage() {
  const { roomId = "" } = useParams();
  const room = useLiveQuery("rooms.get", { roomId });
  const questions = useLiveQuery("questions.list", { roomId });
  const polls = useLiveQuery("polls.list", { roomId });
  const presence = useLiveQuery("presence.list", { roomId });

  if (room.loading) return <p role="status">Loading…</p>;
  if (room.error || !room.data) return <Failure failure={room.error} />;
  if (!can(room.data.role, "present")) {
    return (
      <section className="card">
        <h1>Presenter view is for hosts and moderators</h1>
        <Link to={`/r/${roomId}`}>Back to the room</Link>
      </section>
    );
  }

  const open = (questions.data ?? []).filter((q) => q.status === "approved");
  const spotlight = open.find((q) => q.spotlight);
  const queue = open.filter((q) => !q.spotlight).slice(0, QUEUE_SIZE);
  const activePoll = (polls.data ?? []).find((p) => p.status === "open");

  return (
    <div className="presenter">
      <header className="presenter-head">
        <div>
          <h1>{room.data.title}</h1>
          <p className="presenter-code">
            Join with code <strong>{formatJoinCode(room.data.code)}</strong>
          </p>
        </div>
        <div className="presenter-meta">
          <p>{presence.data?.count ?? 0} here now</p>
          <Link className="btn btn-secondary" to={`/r/${roomId}`}>
            Exit presenter view
          </Link>
        </div>
      </header>

      <section aria-labelledby="on-screen" className="presenter-stage" aria-live="polite">
        <h2 id="on-screen" className="visually-hidden">
          On screen
        </h2>
        {spotlight ? (
          <blockquote className="spotlight">
            <p>{spotlight.body}</p>
            <footer>
              {spotlight.authorName ?? "Anonymous"} · {spotlight.votes} {spotlight.votes === 1 ? "upvote" : "upvotes"}
            </footer>
          </blockquote>
        ) : (
          <p className="muted presenter-empty">No question is on screen. Choose one from the Moderation tab.</p>
        )}
      </section>

      <div className="presenter-columns">
        <section aria-labelledby="top-questions">
          <h2 id="top-questions">Top questions</h2>
          {queue.length === 0 ? (
            <p className="muted">No other open questions.</p>
          ) : (
            <ol className="top-list">
              {queue.map((question) => (
                <li key={question.id}>
                  <span className="top-votes">{question.votes}</span> {question.body}
                </li>
              ))}
            </ol>
          )}
        </section>
        <section aria-labelledby="live-poll">
          <h2 id="live-poll">Live poll</h2>
          {activePoll ? (
            <>
              <p className="poll-prompt">{activePoll.prompt}</p>
              <PollResults poll={activePoll} large />
            </>
          ) : (
            <p className="muted">No poll is open.</p>
          )}
        </section>
      </div>
    </div>
  );
}
