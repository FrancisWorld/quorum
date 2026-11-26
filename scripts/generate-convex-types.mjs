/**
 * Regenerates convex/_generated without a Convex deployment.
 *
 * `npx convex codegen` needs a configured project (and therefore an account).
 * This script reuses the templates that ship inside the `convex` package, so a
 * fresh clone can typecheck offline and CI can verify the output is current.
 * Running `npx convex dev` later overwrites these files with its own output.
 */
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const convexDir = join(root, "convex");
const outDir = join(convexDir, "_generated");
const templates = join(dirname(require.resolve("convex/package.json")), "dist/cjs/cli/codegen_templates");

const { apiCodegen } = require(join(templates, "api.js"));
const { serverCodegen } = require(join(templates, "server.js"));
const { header } = require(join(templates, "common.js"));

// The data model template lives in a CLI module with extra dependencies, so the
// schema-driven variant is reproduced here.
const dataModel = `${header("Generated data model types.")}
import type { DocumentByName, TableNamesInDataModel, SystemTableNames, DataModelFromSchemaDefinition } from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema.js";

/** The names of all of your Convex tables. */
export type TableNames = TableNamesInDataModel<DataModel>;

/** The type of a document stored in Convex. */
export type Doc<TableName extends TableNames> = DocumentByName<DataModel, TableName>;

/** An identifier for a document in Convex. */
export type Id<TableName extends TableNames | SystemTableNames> = GenericId<TableName>;

/** A type describing your Convex data model. */
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
`;

const RESERVED = new Set(["schema.ts", "auth.config.ts"]);

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listModules(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "_generated" ? [] : listModules(full);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) return [];
    return RESERVED.has(relative(convexDir, full)) ? [] : [relative(convexDir, full)];
  });
}

const modules = listModules(convexDir).sort();
const api = apiCodegen(modules, { useTypeScript: false });
const server = serverCodegen({ useTypeScript: false });

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "api.js"), api.JS);
writeFileSync(join(outDir, "api.d.ts"), api.DTS);
writeFileSync(join(outDir, "server.js"), server.JS);
writeFileSync(join(outDir, "server.d.ts"), server.DTS);
writeFileSync(join(outDir, "dataModel.d.ts"), dataModel);
console.warn(`Generated convex/_generated for ${modules.length} modules`);
