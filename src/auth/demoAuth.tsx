import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { DemoBackend, DEMO_USERS, DEMO_ROOM_CODE, type DemoUser } from "../backend/demoBackend";
import { EnvironmentProvider, type AppEnvironment } from "../backend/react";

function PersonaPicker({ onPick }: { onPick: (user: DemoUser) => void }) {
  return (
    <section className="card" aria-labelledby="demo-signin">
      <h2 id="demo-signin">Choose a demo identity</h2>
      <p className="muted">
        Demo mode has no accounts. Pick a persona to explore the seeded room with code{" "}
        <strong>{DEMO_ROOM_CODE}</strong>; switch personas at any time from the header to see each role&apos;s view.
      </p>
      <ul className="persona-list">
        {DEMO_USERS.map((user) => (
          <li key={user.id}>
            <button type="button" className="btn btn-secondary persona" onClick={() => onPick(user)}>
              <span>{user.name}</span>
              <span className="muted">{user.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PersonaSwitcher({ backend, user }: { backend: DemoBackend; user: DemoUser | null }) {
  if (!user) return null;
  return (
    <div className="account">
      <label className="visually-hidden" htmlFor="demo-user">
        Demo user
      </label>
      <select
        id="demo-user"
        value={user.id}
        onChange={(event) => backend.signInAs(DEMO_USERS.find((u) => u.id === event.target.value) ?? null)}
      >
        {DEMO_USERS.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn-ghost" onClick={() => backend.signInAs(null)}>
        Sign out
      </button>
    </div>
  );
}

/** Offline mode: in-memory backend plus a persona picker standing in for Clerk. */
export function DemoProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(() => new DemoBackend(), []);
  const user = useSyncExternalStore(backend.onIdentityChange, backend.currentUser);

  const value = useMemo<AppEnvironment>(
    () => ({
      mode: "demo",
      backend,
      auth: user
        ? { status: "signedIn", user: { id: user.id, name: user.name } }
        : { status: "signedOut", user: null },
      banner: (
        <p className="demo-banner" role="note">
          <strong>Demo mode.</strong> Data lives in this tab only and there are no real accounts.
        </p>
      ),
      signIn: <PersonaPicker onPick={(picked) => backend.signInAs(picked)} />,
      accountMenu: <PersonaSwitcher backend={backend} user={user} />,
    }),
    [backend, user],
  );
  return <EnvironmentProvider value={value}>{children}</EnvironmentProvider>;
}
