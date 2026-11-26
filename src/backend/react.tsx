import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppMode } from "../config";
import { toFailure } from "../lib/errors";
import type {
  AppFailure,
  Backend,
  MutationContract,
  MutationName,
  QueryContract,
  QueryName,
} from "./contract";

export interface AuthUser {
  id: string;
  name: string;
}

export interface AuthState {
  status: "loading" | "signedOut" | "signedIn";
  user: AuthUser | null;
}

/** Everything the UI needs from the outside world. Each mode (live, demo) builds one of these. */
export interface AppEnvironment {
  mode: AppMode;
  backend: Backend;
  auth: AuthState;
  /** Shown to signed-out visitors: Clerk's sign-in widget, or the persona picker in demo mode. */
  signIn: ReactNode;
  /** Persistent notice above the header (the demo-mode banner); null in live mode. */
  banner: ReactNode;
  /** Account button, sign-out, and in demo mode the persona switcher. */
  accountMenu: ReactNode;
}

const EnvironmentContext = createContext<AppEnvironment | null>(null);

export function EnvironmentProvider({ value, children }: { value: AppEnvironment; children: ReactNode }) {
  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>;
}

export function useEnvironment(): AppEnvironment {
  const env = useContext(EnvironmentContext);
  if (!env) throw new Error("useEnvironment must be used inside <EnvironmentProvider>");
  return env;
}

export function useBackend(): Backend {
  return useEnvironment().backend;
}

export interface QueryState<T> {
  data: T | undefined;
  error: AppFailure | null;
  loading: boolean;
}

/** Live query: re-renders whenever the backend pushes a new result. Pass `null` args to skip. */
export function useLiveQuery<K extends QueryName>(
  name: K,
  args: QueryContract[K]["args"] | null,
): QueryState<QueryContract[K]["result"]> {
  const backend = useBackend();
  const argsKey = JSON.stringify(args);
  const key = `${name}:${argsKey}`;
  const [state, setState] = useState<{ key: string; data?: QueryContract[K]["result"]; error?: AppFailure }>({
    key: "",
  });

  useEffect(() => {
    if (argsKey === "null") return undefined;
    return backend.subscribe(
      name,
      JSON.parse(argsKey) as QueryContract[K]["args"],
      (data) => setState({ key, data }),
      (error) => setState({ key, error: toFailure(error) }),
    );
  }, [backend, name, argsKey, key]);

  const current = state.key === key ? state : { key };
  return {
    data: current.data,
    error: current.error ?? null,
    loading: argsKey !== "null" && current.data === undefined && !current.error,
  };
}

export function useMutation<K extends MutationName>(name: K) {
  const backend = useBackend();
  return useCallback((args: MutationContract[K]["args"]) => backend.mutate(name, args), [backend, name]);
}

/** Runs an async handler and keeps `pending` and `failure` state for the UI. */
export function useSubmit<A extends unknown[]>(handler: (...args: A) => Promise<unknown>) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<AppFailure | null>(null);
  const run = useCallback(
    async (...args: A): Promise<boolean> => {
      setPending(true);
      setFailure(null);
      try {
        await handler(...args);
        return true;
      } catch (error) {
        setFailure(toFailure(error));
        return false;
      } finally {
        setPending(false);
      }
    },
    [handler],
  );
  return useMemo(() => ({ run, pending, failure, clear: () => setFailure(null) }), [run, pending, failure]);
}

export const HEARTBEAT_INTERVAL_MS = 15_000;

/** Announces that the signed-in user is in the room, and withdraws on unmount. */
export function usePresence(roomId: string): void {
  const heartbeat = useMutation("presence.heartbeat");
  const leave = useMutation("presence.leave");
  useEffect(() => {
    const ping = () => void heartbeat({ roomId }).catch(() => undefined);
    ping();
    const timer = window.setInterval(ping, HEARTBEAT_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      void leave({ roomId }).catch(() => undefined);
    };
  }, [heartbeat, leave, roomId]);
}
