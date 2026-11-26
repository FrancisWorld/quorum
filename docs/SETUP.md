# Running Quorum against real Convex and Clerk

Everything in this repository builds and tests without accounts. This guide is
for running the live stack. **It has not been exercised end to end by the
author**: no Convex deployment or Clerk application was created while building
the project, so treat these steps as a checklist to verify, not a verified recipe.

## 1. Convex

```bash
npm install
npx convex dev        # creates a dev deployment, pushes convex/, regenerates convex/_generated
```

`convex dev` writes `VITE_CONVEX_URL` (or the equivalent) into `.env.local`.
It also overwrites `convex/_generated/*` with the CLI's own output, which is
equivalent to what `npm run codegen` produces offline.

## 2. Clerk

1. Create a Clerk application and copy its publishable key into
   `VITE_CLERK_PUBLISHABLE_KEY` in `.env.local`.
2. Activate Clerk's Convex integration (Clerk dashboard, "Integrations", "Convex").
   Quorum reads the user's `subject` (stable id) and `name` from the token.
3. Tell Convex which issuer to trust:

   ```bash
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-instance>.clerk.accounts.dev
   ```

   `convex/auth.config.ts` reads this variable.

## 3. Run

```bash
npm run dev           # live mode
npm run dev:demo      # offline demo, no keys
```

## Production builds

`npm run build` produces `dist/`. Production builds always run in live mode:

- `VITE_APP_MODE=demo npm run build` fails before bundling.
- The demo backend is excluded from the bundle; `npm run check:bundle` asserts it.
- `main.tsx` re-checks the mode at runtime and refuses to start in demo mode when
  `import.meta.env.PROD` is true.

`VITE_*` values are public by design: the Convex URL and Clerk publishable key
are meant to ship to browsers. Never put a Clerk secret key in a `VITE_` variable.

## Docker

```bash
VITE_CONVEX_URL=... VITE_CLERK_PUBLISHABLE_KEY=... docker compose up --build
```

The image serves `dist/` with a small static server (SPA fallback, immutable
asset caching, `/healthz`) as a non-root user.
