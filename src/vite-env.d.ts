/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_MODE?: string;
  readonly VITE_CONVEX_URL?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}

/** Injected by vite.config.ts: false in every production build, so demo code is tree-shaken out. */
declare const __DEMO_ENABLED__: boolean;
