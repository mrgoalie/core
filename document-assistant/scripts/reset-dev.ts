/** Deletes the local development database and files, then recreates the demonstration data. */
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../src/server/config";

const config = getConfig();
if (config.isProduction || !config.DATABASE_URL.startsWith("pglite:")) {
  console.error("This command only resets the local development database.");
  process.exit(1);
}
fs.rmSync(path.resolve("data"), { recursive: true, force: true });
console.log("Local data removed. Run: npm run setup");
