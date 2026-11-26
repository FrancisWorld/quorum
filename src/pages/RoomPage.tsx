import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Failure } from "../components/Failure";
import { ModerationPanel } from "../components/ModerationPanel";
import { PollsPanel } from "../components/PollsPanel";
import { QuestionsPanel } from "../components/QuestionsPanel";
import { SettingsPanel } from "../components/SettingsPanel";
import { Tabs, type TabSpec } from "../components/Tabs";
import { formatJoinCode } from "../../convex/lib/joinCode";
import { can } from "../../convex/lib/roles";
import type { RoomView } from "../backend/contract";
import { useLiveQuery, usePresence } from "../backend/react";

function PresenceCount({ roomId }: { roomId: string }) {
  const { data } = useLiveQuery("presence.list", { roomId });
  if (!data) return null;
  return (
    <p className="muted" title={data.names.join(", ")}>
      <span aria-hidden="true">● </span>
      {data.count} here now
    </p>
  );
}

function RoomScreen({ room }: { room: RoomView }) {
  usePresence(room.id);
  const [tab, setTab] = useState("questions");

  const tabs: TabSpec[] = [{ id: "questions", label: "Questions", panel: <QuestionsPanel room={room} /> }];
  tabs.push({ id: "polls", label: "Polls", panel: <PollsPanel room={room} /> });
  if (can(room.role, "moderate")) {
    tabs.push({
      id: "moderation",
      label: "Moderation",
      badge: room.pendingCount,
      panel: <ModerationPanel room={room} />,
    });
  }
  if (can(room.role, "manageRoom")) {
    tabs.push({ id: "settings", label: "Settings", panel: <SettingsPanel room={room} /> });
  }

  return (
    <>
      <div className="room-head">
        <div>
          <h1>{room.title}</h1>
          <p className="muted">
            Join code <strong className="code">{formatJoinCode(room.code)}</strong> · you are{" "}
            {room.role === "host" ? "the host" : `a ${room.role}`}
            {room.status === "closed" ? " · room closed" : ""}
          </p>
          <PresenceCount roomId={room.id} />
        </div>
        {can(room.role, "present") && (
          <Link className="btn btn-secondary" to={`/r/${room.id}/present`}>
            Presenter view
          </Link>
        )}
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
    </>
  );
}

export function RoomPage() {
  const { roomId = "" } = useParams();
  const { data, error, loading } = useLiveQuery("rooms.get", { roomId });
  if (loading) return <p role="status">Loading room…</p>;
  if (error) {
    return (
      <>
        <Failure failure={error} />
        <p>
          <Link to="/">Back to start</Link>
        </p>
      </>
    );
  }
  return data ? <RoomScreen room={data} /> : null;
}
