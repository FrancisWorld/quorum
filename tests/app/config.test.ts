import { describe, expect, it } from "vitest";
import {
  DemoModeInProductionError,
  InvalidAppModeError,
  liveConfigIssues,
  resolveAppMode,
} from "../../src/config";

describe("resolveAppMode", () => {
  it("defaults to live", () => {
    expect(resolveAppMode({ PROD: false })).toBe("live");
    expect(resolveAppMode({ PROD: true })).toBe("live");
    expect(resolveAppMode({ PROD: true, VITE_APP_MODE: "" })).toBe("live");
    expect(resolveAppMode({ PROD: true, VITE_APP_MODE: "live" })).toBe("live");
  });

  it("allows demo outside production", () => {
    expect(resolveAppMode({ PROD: false, VITE_APP_MODE: "demo" })).toBe("demo");
  });

  it("refuses demo in production, whatever else is set", () => {
    expect(() => resolveAppMode({ PROD: true, VITE_APP_MODE: "demo" })).toThrow(DemoModeInProductionError);
  });

  it("rejects typos instead of silently falling back", () => {
    expect(() => resolveAppMode({ PROD: false, VITE_APP_MODE: "Demo" })).toThrow(InvalidAppModeError);
    expect(() => resolveAppMode({ PROD: true, VITE_APP_MODE: "true" })).toThrow(InvalidAppModeError);
  });
});

describe("liveConfigIssues", () => {
  it("lists missing and placeholder variables", () => {
    expect(liveConfigIssues({})).toEqual(["VITE_CONVEX_URL", "VITE_CLERK_PUBLISHABLE_KEY"]);
    expect(
      liveConfigIssues({ VITE_CONVEX_URL: "https://replace-me.convex.cloud", VITE_CLERK_PUBLISHABLE_KEY: "local-test-key" }),
    ).toEqual(["VITE_CONVEX_URL"]);
    expect(liveConfigIssues({ VITE_CONVEX_URL: "https://x.convex.cloud", VITE_CLERK_PUBLISHABLE_KEY: "local-test-key" })).toEqual([]);
  });
});
