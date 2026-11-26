import { Failure } from "./Failure";
import type { RoomView } from "../backend/contract";
import { useLiveQuery, useMutation, useSubmit } from "../backend/react";

/** Host-only controls. */
export function SettingsPanel({ room }: { room: RoomView }) {
  const update = useMutation("rooms.update");
  const setRole = useMutation("rooms.setRole");
  const { data: members, error } = useLiveQuery("rooms.members", { roomId: room.id });
  const toggleModeration = useSubmit(() => update({ roomId: room.id, moderated: !room.moderated }));
  const toggleRoom = useSubmit(() => update({ roomId: room.id, status: room.status === "open" ? "closed" : "open" }));
  const changeRole = useSubmit((userId: string, role: "moderator" | "participant") =>
    setRole({ roomId: room.id, userId, role }),
  );

  return (
    <div className="stack">
      <section className="card" aria-labelledby="room-settings">
        <h2 id="room-settings">Room</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={room.moderated}
            disabled={toggleModeration.pending}
            onChange={() => void toggleModeration.run()}
          />
          Review questions before the audience sees them
        </label>
        <button type="button" className="btn btn-secondary" disabled={toggleRoom.pending} onClick={() => void toggleRoom.run()}>
          {room.status === "open" ? "Close room" : "Reopen room"}
        </button>
        <Failure failure={toggleModeration.failure ?? toggleRoom.failure} />
      </section>

      <section className="card" aria-labelledby="people-heading">
        <h2 id="people-heading">People</h2>
        <Failure failure={error ?? changeRole.failure} />
        <ul className="people">
          {members?.map((member) => (
            <li key={member.userId}>
              <span>{member.name}</span>
              {member.role === "host" ? (
                <span className="pill">Host</span>
              ) : (
                <>
                  <label className="visually-hidden" htmlFor={`role-${member.userId}`}>
                    Role for {member.name}
                  </label>
                  <select
                    id={`role-${member.userId}`}
                    value={member.role}
                    onChange={(event) => void changeRole.run(member.userId, event.target.value as "moderator" | "participant")}
                  >
                    <option value="participant">Participant</option>
                    <option value="moderator">Moderator</option>
                  </select>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
