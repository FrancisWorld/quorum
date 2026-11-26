import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { useEnvironment } from "./backend/react";
import { HomePage } from "./pages/HomePage";
import { PresenterPage } from "./pages/PresenterPage";
import { RoomPage } from "./pages/RoomPage";

type Theme = "light" | "dark";

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem("quorum-theme");
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(storedTheme);
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  const toggle = () => {
    const current = theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next: Theme = current === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      window.localStorage.setItem("quorum-theme", next);
    } catch {
      // Storage can be unavailable (private mode); the theme still applies for this visit.
    }
  };
  return (
    <button type="button" className="btn btn-ghost" onClick={toggle} aria-label="Toggle light and dark theme">
      Theme
    </button>
  );
}

function NotFound() {
  return (
    <section className="card">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to start</Link>
      </p>
    </section>
  );
}

export function App() {
  const { auth, banner, signIn, accountMenu } = useEnvironment();

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {banner}
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            ✓
          </span>
          Quorum
        </Link>
        <div className="topbar-actions">
          <ThemeToggle />
          {accountMenu}
        </div>
      </header>
      <main id="main" className="shell">
        {auth.status === "loading" && <p role="status">Checking your session…</p>}
        {auth.status === "signedOut" && (
          <>
            <section className="hero">
              <h1>Questions and polls that keep up with the room.</h1>
              <p className="lede">
                Create a room, share the six-character code, and let your audience ask, upvote and vote while you
                moderate and present live.
              </p>
            </section>
            {signIn}
          </>
        )}
        {auth.status === "signedIn" && (
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/r/:roomId" element={<RoomPage />} />
            <Route path="/r/:roomId/present" element={<PresenterPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        )}
      </main>
    </>
  );
}
