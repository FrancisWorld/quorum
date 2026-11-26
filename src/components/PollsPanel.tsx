import { useState, type FormEvent } from "react";
import { Failure } from "./Failure";
import { can } from "../../convex/lib/roles";
import { LIMITS } from "../../convex/lib/validation";
import type { PollView, RoomView } from "../backend/contract";
import { useLiveQuery, useMutation, useSubmit } from "../backend/react";

export function PollResults({ poll, large = false }: { poll: PollView; large?: boolean }) {
  return (
    <ul className={`results${large ? " results-large" : ""}`}>
      {poll.options.map((option) => (
        <li key={option.id} className={poll.myVote === option.id ? "mine" : undefined}>
          <div className="result-head">
            <span>
              {option.label}
              {poll.myVote === option.id && <span className="visually-hidden"> (your vote)</span>}
            </span>
            <span>
              {option.votes} · {option.percent}%
            </span>
          </div>
          <div className="bar" aria-hidden="true">
            <div className="bar-fill" style={{ width: `${option.percent}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function PollCard({ poll, room }: { poll: PollView; room: RoomView }) {
  const vote = useMutation("polls.vote");
  const setStatus = useMutation("polls.setStatus");
  const [choice, setChoice] = useState("");
  const cast = useSubmit(() => vote({ pollId: poll.id, optionId: choice }));
  const toggle = useSubmit(() => setStatus({ pollId: poll.id, status: poll.status === "open" ? "closed" : "open" }));
  const canVote = poll.status === "open" && poll.myVote === null && room.status === "open";

  return (
    <li className="card poll">
      <h3>{poll.prompt}</h3>
      <p className="muted">
        {poll.status === "open" ? "Open" : "Closed"} · {poll.total} {poll.total === 1 ? "vote" : "votes"}
      </p>
      {canVote ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void cast.run();
          }}
        >
          <fieldset>
            <legend className="visually-hidden">{poll.prompt}</legend>
            {poll.options.map((option) => (
              <label key={option.id} className="check">
                <input
                  type="radio"
                  name={`poll-${poll.id}`}
                  value={option.id}
                  checked={choice === option.id}
                  onChange={() => setChoice(option.id)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <button type="submit" className="btn" disabled={!choice || cast.pending}>
            Cast vote
          </button>
        </form>
      ) : (
        <PollResults poll={poll} />
      )}
      {can(room.role, "managePolls") && room.status === "open" && (
        <button type="button" className="btn btn-small btn-secondary" disabled={toggle.pending} onClick={() => void toggle.run()}>
          {poll.status === "open" ? "Close poll" : "Reopen poll"}
        </button>
      )}
      <Failure failure={cast.failure ?? toggle.failure} />
    </li>
  );
}

function PollForm({ roomId }: { roomId: string }) {
  const create = useMutation("polls.create");
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const submit = useSubmit(async () => {
    await create({ roomId, prompt, options });
    setPrompt("");
    setOptions(["", ""]);
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit.run();
  };
  const setOption = (index: number, value: string) =>
    setOptions((current) => current.map((option, i) => (i === index ? value : option)));

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="poll-form-heading">
      <h2 id="poll-form-heading">Start a poll</h2>
      <p className="muted">Starting a poll closes the one that is currently open.</p>
      <label htmlFor="poll-prompt">Question</label>
      <input
        id="poll-prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        maxLength={LIMITS.pollPrompt.max}
        required
      />
      {options.map((option, index) => (
        <div key={index} className="option-row">
          <label htmlFor={`poll-option-${index}`}>Option {index + 1}</label>
          <input
            id={`poll-option-${index}`}
            value={option}
            onChange={(event) => setOption(index, event.target.value)}
            maxLength={LIMITS.pollOption.max}
            required
          />
          {options.length > LIMITS.pollOptions.min && (
            <button
              type="button"
              className="btn btn-small btn-ghost"
              aria-label={`Remove option ${index + 1}`}
              onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {options.length < LIMITS.pollOptions.max && (
        <button type="button" className="btn btn-small btn-secondary" onClick={() => setOptions((current) => [...current, ""])}>
          Add option
        </button>
      )}
      <Failure failure={submit.failure} />
      <button type="submit" className="btn" disabled={submit.pending}>
        Start poll
      </button>
    </form>
  );
}

export function PollsPanel({ room }: { room: RoomView }) {
  const { data, error, loading } = useLiveQuery("polls.list", { roomId: room.id });
  return (
    <div className="stack">
      {can(room.role, "managePolls") && room.status === "open" && <PollForm roomId={room.id} />}
      <Failure failure={error} />
      {loading && <p role="status">Loading polls…</p>}
      {data && data.length === 0 && <p className="muted">No polls yet.</p>}
      <ul className="poll-list">
        {data?.map((poll) => <PollCard key={poll.id} poll={poll} room={room} />)}
      </ul>
    </div>
  );
}
