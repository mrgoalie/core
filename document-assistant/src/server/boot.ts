import { getConfig } from "./config";
import { getDb } from "./db/client";
import "./jobs/handlers";
import { recoverStaleJobs, startWorker } from "./jobs/queue";
import { purgeExpired } from "./services/retention";

/** Called once when the Node.js server starts (see src/instrumentation.ts). */
export async function bootServer() {
  const config = getConfig(); // validates configuration; throws on unsafe production settings
  const db = await getDb();
  // Any job still marked "running" at start-up was interrupted by the previous process.
  await recoverStaleJobs(db, 0);
  if (config.JOB_WORKER) startWorker(getDb, 750, purgeExpired);
  console.log(`[boot] Document Assistant ready (env=${config.APP_ENV}, auth=${config.AUTH_MODE}, cases=${config.CASE_MANAGEMENT})`);
}
