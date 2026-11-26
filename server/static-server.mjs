import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

/** @type {Record<string, string>} */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

/**
 * Resolves a request path to a file inside `root`, or null when it would
 * escape it. Decoding happens first so `%2e%2e` cannot sneak past the check.
 * @param {string} root absolute directory being served
 * @param {string} urlPath path component of the request URL
 * @returns {string | null}
 */
export function resolveInside(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const target = resolve(join(root, normalize(decoded)));
  return target === root || target.startsWith(root + sep) ? target : null;
}

/** @param {string} path */
async function fileIfExists(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

/**
 * Minimal static file server for the built SPA: GET/HEAD only, SPA fallback to
 * index.html for extension-less paths, long-lived caching for hashed assets.
 * @param {{ root: string }} options
 */
export function createStaticServer({ root }) {
  const base = resolve(root);

  return createServer(async (req, res) => {
    /**
     * @param {number} status
     * @param {Record<string, string>} headers
     * @param {string} body
     */
    const send = (status, headers, body) => {
      res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
      res.end(req.method === "HEAD" ? undefined : body);
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      send(405, { allow: "GET, HEAD", "content-type": "text/plain" }, "Method Not Allowed");
      return;
    }

    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname === "/healthz") {
      send(200, { "content-type": "text/plain", "cache-control": "no-store" }, "ok");
      return;
    }

    const requested = resolveInside(base, pathname);
    if (requested === null) {
      send(400, { "content-type": "text/plain" }, "Bad Request");
      return;
    }

    let file = await fileIfExists(requested);
    let path = requested;
    if (!file && extname(pathname) === "") {
      path = join(base, "index.html");
      file = await fileIfExists(path);
    }
    if (!file) {
      send(404, { "content-type": "text/plain" }, "Not Found");
      return;
    }

    const isShell = path === join(base, "index.html");
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      "content-length": String(file.size),
      "cache-control": isShell ? "no-cache" : pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(path).on("error", () => res.destroy()).pipe(res);
  });
}

/**
 * Starts listening and shuts down gracefully on SIGTERM/SIGINT.
 * @param {{ root: string, port: number }} options
 */
export function start({ root, port }) {
  const server = createStaticServer({ root });
  server.listen(port, "0.0.0.0", () => {
    console.warn(`quorum static server listening on :${port}`);
  });
  const stop = () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  return server;
}
