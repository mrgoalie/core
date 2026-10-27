/**
 * Durable background jobs stored in the database. Long-running work (reading documents, drafting,
 * assembling packages) runs here so a slow AI call or a page refresh never loses work. Jobs that
 * were interrupted (for example by a restart) are detected and retried automatically.
 */
import crypto from "node:crypto";
import { and, asc, eq, lt, lte, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { jobs } from "../db/schema";
import { AppError } from "../errors";
import { AiError } from "../integrations/ai/types";

export type JobRow = typeof jobs.$inferSelect;
export type JobHandler = (db: DB, job: JobRow) => Promise<Record<string, unknown> | void>;

const handlers = new Map<string, JobHandler>();
export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

const STALE_MS = 10 * 60_000;
const workerId = `worker-${crypto.randomBytes(4).toString("hex")}`;

export async function enqueueJob(db: DB, type: string, payload: Record<string, unknown>, opts: { workSessionId?: string; createdBy?: string; maxAttempts?: number } = {}) {
  const [job] = await db
    .insert(jobs)
    .values({ type, payload, workSessionId: opts.workSessionId ?? null, createdBy: opts.createdBy ?? null, maxAttempts: opts.maxAttempts ?? 2 })
    .returning();
  return job;
}

export async function setJobProgress(db: DB, jobId: string, progress: string) {
  await db.update(jobs).set({ progress, updatedAt: new Date() }).where(eq(jobs.id, jobId));
}

async function claimNextJob(db: DB): Promise<JobRow | null> {
  for (let i = 0; i < 3; i++) {
    const [candidate] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.status, "queued"), lte(jobs.runAfter, new Date())))
      .orderBy(asc(jobs.createdAt))
      .limit(1);
    if (!candidate) return null;
    const [claimed] = await db
      .update(jobs)
      .set({ status: "running", lockedAt: new Date(), lockedBy: workerId, attempts: sql`${jobs.attempts} + 1`, updatedAt: new Date() })
      .where(and(eq(jobs.id, candidate.id), eq(jobs.status, "queued")))
      .returning();
    if (claimed) return claimed;
  }
  return null;
}

function friendly(err: unknown) {
  if (err instanceof AppError || err instanceof AiError) return err.message;
  return "Something went wrong while preparing this. Please try again. If it keeps happening, tell your administrator.";
}

function retryable(err: unknown) {
  if (err instanceof AiError) return err.retryable;
  if (err instanceof AppError) return err.status >= 500 && err.status !== 503;
  return true;
}

export async function runJob(db: DB, job: JobRow) {
  const handler = handlers.get(job.type);
  try {
    if (!handler) throw new Error(`no handler for ${job.type}`);
    const result = await handler(db, job);
    await db.update(jobs).set({ status: "succeeded", result: result ?? {}, progress: "Done", lockedAt: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
  } catch (err) {
    if (!(err instanceof AppError) && !(err instanceof AiError)) console.error(`[jobs] ${job.type} ${job.id} failed:`, (err as Error)?.stack ?? err);
    const again = retryable(err) && job.attempts < job.maxAttempts;
    await db
      .update(jobs)
      .set({
        status: again ? "queued" : "failed",
        lastError: friendly(err),
        runAfter: new Date(Date.now() + 3000 * job.attempts),
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));
  }
}

/** Requeues (or fails) jobs whose worker stopped mid-way, e.g. after a restart. */
export async function recoverStaleJobs(db: DB, olderThanMs = STALE_MS) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await db.select().from(jobs).where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, cutoff)));
  for (const j of stale) {
    const again = j.attempts < j.maxAttempts;
    await db
      .update(jobs)
      .set({ status: again ? "queued" : "failed", lockedAt: null, lastError: again ? "Resumed after an interruption." : "This was interrupted and could not finish. Please try again.", updatedAt: new Date() })
      .where(eq(jobs.id, j.id));
  }
  return stale.length;
}

/** Processes queued jobs until none are ready. Used by the worker loop and by tests. */
export async function processAvailableJobs(db: DB, max = 20) {
  let n = 0;
  while (n < max) {
    const job = await claimNextJob(db);
    if (!job) break;
    await runJob(db, job);
    n++;
  }
  return n;
}

export async function getJob(db: DB, id: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  return job ?? null;
}

const g = globalThis as unknown as { __fdaWorker?: NodeJS.Timeout; __fdaWorkerBusy?: boolean };

export function startWorker(getDb: () => Promise<DB>, intervalMs = 750, maintenance?: (db: DB) => Promise<unknown>) {
  if (g.__fdaWorker) return;
  let lastRecovery = 0;
  let lastMaintenance = Date.now() - 5.9 * 3600_000; // first run about a minute after start-up
  g.__fdaWorker = setInterval(async () => {
    if (g.__fdaWorkerBusy) return;
    g.__fdaWorkerBusy = true;
    try {
      const db = await getDb();
      if (Date.now() - lastRecovery > 60_000) {
        lastRecovery = Date.now();
        await recoverStaleJobs(db);
      }
      await processAvailableJobs(db, 5);
      if (maintenance && Date.now() - lastMaintenance > 6 * 3600_000) {
        lastMaintenance = Date.now();
        await maintenance(db).catch((err) => console.error("[jobs] maintenance failed:", (err as Error).message));
      }
    } catch (err) {
      console.error("[jobs] worker loop error:", (err as Error).message);
    } finally {
      g.__fdaWorkerBusy = false;
    }
  }, intervalMs);
  g.__fdaWorker.unref?.();
}
