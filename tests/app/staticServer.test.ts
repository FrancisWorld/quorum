import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStaticServer, resolveInside } from "../../server/static-server.mjs";

let root: string;
let server: Server;
let base: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "quorum-static-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>shell</title>");
  writeFileSync(join(root, "assets", "app-abc123.js"), "console.log(1)");
  writeFileSync(join(root, "robots.txt"), "User-agent: *");
  server = createStaticServer({ root });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
});

describe("static server", () => {
  it("serves the shell without caching and hashed assets as immutable", async () => {
    const shell = await fetch(`${base}/`);
    expect(shell.status).toBe(200);
    expect(shell.headers.get("cache-control")).toBe("no-cache");
    expect(shell.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await shell.text()).toContain("shell");

    const asset = await fetch(`${base}/assets/app-abc123.js`);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await fetch(`${base}/robots.txt`)).headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("falls back to the shell for client-side routes but not for missing files", async () => {
    const route = await fetch(`${base}/r/room_1/present`);
    expect(route.status).toBe(200);
    expect(await route.text()).toContain("shell");
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
  });

  it("answers HEAD without a body, rejects other methods and exposes a health check", async () => {
    const head = await fetch(`${base}/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const post = await fetch(`${base}/`, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    expect(await (await fetch(`${base}/healthz`)).text()).toBe("ok");
  });

  it("refuses path traversal and malformed encodings", async () => {
    // The client may normalise the dots away; either way nothing outside the root is served.
    expect(await (await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)).text()).not.toContain("root:");
    expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(400);
    // Dot segments are collapsed relative to the root, so they can never climb out of it.
    expect(resolveInside("/srv/app", "/../../secret")).toBe("/srv/app/secret");
    expect(resolveInside("/srv/app", "/a%00b")).toBeNull();
    expect(resolveInside("/srv/app", "/ok/file.js")).toBe("/srv/app/ok/file.js");
  });
});
