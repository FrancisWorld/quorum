import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Failure } from "../components/Failure";
import { formatJoinCode } from "../../convex/lib/joinCode";
import { LIMITS } from "../../convex/lib/validation";
import { useEnvironment, useLiveQuery, useMutation, useSubmit } from "../backend/react";

function JoinForm() {
  const navigate = useNavigate();
  const join = useMutation("rooms.join");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const submit = useSubmit(async () => {
    const result = await join({ code });
    if (result.status === "joined") {
      navigate(`/r/${result.roomId}`);
    } else if (result.status === "rate_limited") {
      setMessage(`Too many attempts. Try again in ${Math.ceil(result.retryAfterMs / 1000)}s.`);
    } else {
      setMessage("No room has that code. Check it and try again.");
    }
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    void submit.run();
  };

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="join-heading">
      <h2 id="join-heading">Join a room</h2>
      <label htmlFor="join-code">Room code</label>
      <input
        id="join-code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="ABC-DEF"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={12}
        required
        className="code-input"
      />
      {message && (
        <p className="notice notice-danger" role="alert">
          {message}
        </p>
      )}
      <Failure failure={submit.failure} />
      <button type="submit" className="btn" disabled={submit.pending}>
        Join
      </button>
    </form>
  );
}

function CreateRoomForm() {
  const navigate = useNavigate();
  const create = useMutation("rooms.create");
  const [title, setTitle] = useState("");
  const [moderated, setModerated] = useState(true);
  const submit = useSubmit(async () => {
    const { roomId } = await create({ title, moderated });
    navigate(`/r/${roomId}`);
  });

  return (
    <form
      className="card"
      aria-labelledby="create-heading"
      onSubmit={(event) => {
        event.preventDefault();
        void submit.run();
      }}
    >
      <h2 id="create-heading">Host a room</h2>
      <label htmlFor="room-title">Event title</label>
      <input
        id="room-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={LIMITS.roomTitle.max}
        required
      />
      <label className="check">
        <input type="checkbox" checked={moderated} onChange={(event) => setModerated(event.target.checked)} />
        Review questions before the audience sees them
      </label>
      <Failure failure={submit.failure} />
      <button type="submit" className="btn" disabled={submit.pending}>
        Create room
      </button>
    </form>
  );
}

function MyRooms() {
  const { data, error, loading } = useLiveQuery("rooms.mine", {});
  return (
    <section aria-labelledby="mine-heading">
      <h2 id="mine-heading">Your rooms</h2>
      {loading && <p role="status">Loading…</p>}
      <Failure failure={error} />
      {data && data.length === 0 && <p className="muted">You have not joined any room yet.</p>}
      <ul className="room-list">
        {data?.map((room) => (
          <li key={room.id} className="card room-row">
            <div>
              <Link to={`/r/${room.id}`} className="room-link">
                {room.title}
              </Link>
              <p className="muted">
                Code {formatJoinCode(room.code)} · {room.role}
                {room.status === "closed" ? " · closed" : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HomePage() {
  const { auth } = useEnvironment();
  return (
    <>
      <h1>Welcome{auth.user ? `, ${auth.user.name}` : ""}</h1>
      <div className="grid-2">
        <JoinForm />
        <CreateRoomForm />
      </div>
      <MyRooms />
    </>
  );
}
