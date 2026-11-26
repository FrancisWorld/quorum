import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { resolveAppMode } from "./src/config.ts";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  // Every `vite build` is a production build whatever its --mode (staging, preview,
  // anything custom), so keying on the command rather than the mode name leaves no
  // build that can bundle demo code. This throws before any bundle exists. `__DEMO_ENABLED__` then lets the bundler drop the
  // demo backend entirely from production output.
  const appMode = resolveAppMode({ PROD: command === "build", VITE_APP_MODE: env.VITE_APP_MODE });

  return {
    plugins: [react()],
    define: { __DEMO_ENABLED__: JSON.stringify(appMode === "demo") },
    build: { target: "es2022", sourcemap: false },
    test: {
      include: ["tests/**/*.test.{ts,tsx}"],
      environment: "node",
      setupFiles: ["tests/helpers/setup.ts"],
      server: { deps: { inline: ["convex-test"] } },
      coverage: {
        provider: "v8",
        include: ["convex/**/*.ts", "src/**/*.{ts,tsx}"],
        exclude: [
          "convex/_generated/**",
          "src/main.tsx",
          "src/vite-env.d.ts",
          "src/auth/clerkAuth.tsx",
          "src/backend/convexBackend.ts",
        ],
      },
    },
  };
});
