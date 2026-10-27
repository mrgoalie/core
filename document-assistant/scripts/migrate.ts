/**
 * Applies database migrations and baseline data. Safe to run repeatedly.
 * In Azure this runs automatically before the app starts (see Dockerfile).
 */
import { getConfig } from "../src/server/config";
import { createDatabase } from "../src/server/db/client";
import { ensureBaseline } from "../src/server/db/bootstrap";

const config = getConfig();
const { db, close } = await createDatabase(config.DATABASE_URL, { migrate: true });
await ensureBaseline(db);
await close();
console.log("Database is up to date.");
