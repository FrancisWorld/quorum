import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { resolveAppMode } from "./src/config.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  // Throws for a production build with VITE_APP_MODE=demo, so the build fails
  // before any bundle exists. `__DEMO_ENABLED__` then lets the bundler drop the
  // demo backend entirely from production output.
  const appMode = resolveAppMode({ PROD: mode === "production", VITE_APP_MODE: env.VITE_APP_MODE });

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
