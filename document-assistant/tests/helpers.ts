import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { loadActor } from "@/server/auth/session";
import { createDatabase, setDbForTesting, type DB } from "@/server/db/client";
import { ensureBaseline } from "@/server/db/bootstrap";
import { jobs, skills, users } from "@/server/db/schema";
import { processAvailableJobs, getJob } from "@/server/jobs/queue";
import "@/server/jobs/handlers";
import { EncryptedStorage, MemoryBackend, setStorageForTesting } from "@/server/storage";
import { resetRateLimits } from "@/server/rate-limit";
import { setAiProviderForTesting } from "@/server/integrations/ai/service";

export const DEMO = {
  maria: "maria.lopez@demo.fabbrinilaw.test",
  daniel: "daniel.kim@demo.fabbrinilaw.test",
  rachel: "rachel.patel@demo.fabbrinilaw.test",
  jordan: "jordan.ellis@demo.fabbrinilaw.test",
  taylor: "taylor.brooks@demo.fabbrinilaw.test",
  chris: "chris.novak@demo.fabbrinilaw.test",
};

export async function freshDb() {
  const { db, close } = await createDatabase("pglite:memory", { migrate: true });
  setDbForTesting(db);
  setStorageForTesting(new EncryptedStorage(new MemoryBackend(), crypto.randomBytes(32)));
  setAiProviderForTesting(null);
  resetRateLimits();
  await ensureBaseline(db, { seedDemo: true });
  return { db, close: async () => { setDbForTesting(undefined); await close(); } };
}

export async function actor(db: DB, email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  const a = await loadActor(db, u.id);
  if (!a) throw new Error(`no active actor ${email}`);
  return a;
}

export async function skillId(db: DB, slug: string) {
  const [s] = await db.select().from(skills).where(eq(skills.slug, slug));
  return s.id;
}

/** Runs queued jobs to completion, fast-forwarding retry back-off delays. */
export async function runJobs(db: DB, jobId?: string) {
  for (let i = 0; i < 10; i++) {
    await processAvailableJobs(db, 50);
    const waiting = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.status, "queued"));
    if (!waiting.length) break;
    await db.update(jobs).set({ runAfter: new Date(0) }).where(eq(jobs.status, "queued"));
  }
  return jobId ? getJob(db, jobId) : null;
}
