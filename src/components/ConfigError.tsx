export function ConfigError({ missing }: { missing: string[] }) {
  return (
    <main className="shell narrow">
      <h1>Quorum is not configured</h1>
      <p>
        Live mode needs a Convex deployment and a Clerk application. Missing: <code>{missing.join(", ")}</code>.
      </p>
      <p>
        Copy <code>.env.example</code> to <code>.env.local</code> and fill it in (see <code>docs/SETUP.md</code>), or
        run the offline demo with <code>npm run dev:demo</code>.
      </p>
    </main>
  );
}
