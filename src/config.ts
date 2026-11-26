export type AppMode = "demo" | "live";

export interface ModeEnv {
  /** `import.meta.env.PROD`: true for production builds and the preview server. */
  PROD: boolean;
  VITE_APP_MODE?: string | undefined;
}

export class DemoModeInProductionError extends Error {
  constructor() {
    super(
      "VITE_APP_MODE=demo is not allowed in a production build. " +
        "Demo mode replaces sign-in with a fake persona picker and must never be deployed.",
    );
    this.name = "DemoModeInProductionError";
  }
}

export class InvalidAppModeError extends Error {
  constructor(value: string) {
    super(`VITE_APP_MODE must be "demo" or "live" (got "${value}").`);
    this.name = "InvalidAppModeError";
  }
}

/**
 * Decides which backend the app runs against. Demo mode is a hard failure in
 * production: vite.config.ts calls this before bundling (so the build fails) and
 * main.tsx calls it again at runtime (so a tampered bundle still refuses to start).
 */
export function resolveAppMode(env: ModeEnv): AppMode {
  const requested = env.VITE_APP_MODE;
  if (requested === undefined || requested === "" || requested === "live") return "live";
  if (requested === "demo") {
    if (env.PROD) throw new DemoModeInProductionError();
    return "demo";
  }
  throw new InvalidAppModeError(requested);
}

export interface LiveEnv {
  VITE_CONVEX_URL?: string | undefined;
  VITE_CLERK_PUBLISHABLE_KEY?: string | undefined;
}

/** Names of the variables live mode needs but cannot find. */
export function liveConfigIssues(env: LiveEnv): string[] {
  const required: (keyof LiveEnv)[] = ["VITE_CONVEX_URL", "VITE_CLERK_PUBLISHABLE_KEY"];
  return required.filter((name) => !env[name] || env[name]?.includes("replace-me"));
}
