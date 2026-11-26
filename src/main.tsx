import { StrictMode, lazy, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ConfigError } from "./components/ConfigError";
import { liveConfigIssues, resolveAppMode } from "./config";
import "./styles.css";

// Both are code-split: the demo chunk only exists in non-production builds
// (`__DEMO_ENABLED__` is statically false otherwise), and the live chunk pulls
// in Clerk and the Convex client only when real keys are configured.
const DemoProvider = __DEMO_ENABLED__
  ? lazy(() => import("./auth/demoAuth").then((m) => ({ default: m.DemoProvider })))
  : null;
const LiveProvider = lazy(() => import("./auth/clerkAuth").then((m) => ({ default: m.LiveProvider })));

function Providers({ children }: { children: ReactNode }) {
  const mode = resolveAppMode({ PROD: import.meta.env.PROD, VITE_APP_MODE: import.meta.env.VITE_APP_MODE });
  if (mode === "demo" && DemoProvider) return <DemoProvider>{children}</DemoProvider>;

  const issues = liveConfigIssues(import.meta.env);
  const convexUrl = import.meta.env.VITE_CONVEX_URL;
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (issues.length > 0 || !convexUrl || !publishableKey) return <ConfigError missing={issues} />;
  return (
    <LiveProvider convexUrl={convexUrl} publishableKey={publishableKey}>
      {children}
    </LiveProvider>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<p className="boot">Loading…</p>}>
        <Providers>
          <App />
        </Providers>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
