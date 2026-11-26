import { fileURLToPath } from "node:url";
import { start } from "./static-server.mjs";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid PORT "${process.env.PORT}"`);
  process.exit(1);
}
start({ root: fileURLToPath(new URL("../dist", import.meta.url)), port });
