/**
 * Fails when a production bundle contains offline-demo code. Run after `vite build`.
 * The demo backend carries a marker string that must never ship.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const FORBIDDEN = ["quorum-demo-backend", "Choose a demo identity", "Demo mode."];

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

let files;
try {
  files = walk(dist);
} catch {
  console.error("dist/ not found: run `npm run build` first.");
  process.exit(1);
}

const offenders = [];
for (const file of files.filter((f) => /\.(js|html|css)$/.test(f))) {
  const text = readFileSync(file, "utf8");
  for (const marker of FORBIDDEN) if (text.includes(marker)) offenders.push(`${file}: ${marker}`);
}
if (offenders.length > 0) {
  console.error(`Demo code found in the production bundle:\n${offenders.join("\n")}`);
  process.exit(1);
}
console.warn("Production bundle is free of demo code.");
