/**
 * Retention: removes working copies the firm no longer needs. Approved work-product records and their
 * approval history are kept; the case file of record remains Clio.
 */
import { and, eq, inArray, isNotNull, isNull, lt, ne } from "drizzle-orm";
import { audit } from "../audit";
import { purgeExpiredSessions } from "../auth/session";
import type { DB } from "../db/client";
import { authRequests, generatedDocuments, sessionDocuments, uploadedFiles, workSessions } from "../db/schema";
import { getSetting } from "../settings";
import { getStorage } from "../storage";

export async function purgeExpired(db: DB, now = new Date()) {
  const storage = getStorage();
  const retention = await getSetting(db, "retention");
  const counts = { uploads: 0, extractedText: 0, testRuns: 0 };

  // 1. Uploaded working files past their retention date (never while waiting for review).
  const uploads = await db
    .select({ u: uploadedFiles, status: workSessions.status })
    .from(uploadedFiles)
    .leftJoin(workSessions, eq(workSessions.id, uploadedFiles.workSessionId))
    .where(and(isNull(uploadedFiles.deletedAt), lt(uploadedFiles.expiresAt, now)));
  for (const { u, status } of uploads) {
    if (status === "submitted") continue;
    await storage.delete(u.storageKey).catch(() => undefined);
    await db.update(uploadedFiles).set({ deletedAt: now }).where(eq(uploadedFiles.id, u.id));
    counts.uploads++;
  }

  // 2. Extracted document text for expired work (re-created on demand if the work continues).
  const expired = await db
    .select({ id: workSessions.id })
    .from(workSessions)
    .where(and(lt(workSessions.expiresAt, now), ne(workSessions.status, "submitted")));
  if (expired.length) {
    const docs = await db
      .select()
      .from(sessionDocuments)
      .where(and(inArray(sessionDocuments.workSessionId, expired.map((e) => e.id)), isNotNull(sessionDocuments.extractTextKey)));
    for (const d of docs) {
      await storage.delete(d.extractTextKey!).catch(() => undefined);
      await db.update(sessionDocuments).set({ extractTextKey: null, extractStatus: "pending" }).where(eq(sessionDocuments.id, d.id));
      counts.extractedText++;
    }
  }

  // 3. Administrator test runs (fictional data) after the test-run retention period.
  const cutoff = new Date(now.getTime() - retention.testRunDays * 86400_000);
  const tests = await db.select({ id: workSessions.id }).from(workSessions).where(and(eq(workSessions.isTest, true), lt(workSessions.updatedAt, cutoff)));
  for (const t of tests) {
    const files = await db.select({ key: generatedDocuments.storageKey }).from(generatedDocuments).where(eq(generatedDocuments.workSessionId, t.id));
    for (const f of files) await storage.delete(f.key).catch(() => undefined);
    const docs = await db.select({ key: sessionDocuments.extractTextKey }).from(sessionDocuments).where(eq(sessionDocuments.workSessionId, t.id));
    for (const d of docs) if (d.key) await storage.delete(d.key).catch(() => undefined);
    await db.update(uploadedFiles).set({ workSessionId: null }).where(eq(uploadedFiles.workSessionId, t.id));
    await db.delete(workSessions).where(eq(workSessions.id, t.id));
    counts.testRuns++;
  }

  // 4. Expired sign-in records.
  await purgeExpiredSessions(db);
  await db.delete(authRequests).where(lt(authRequests.expiresAt, now));

  if (counts.uploads || counts.extractedText || counts.testRuns) await audit(db, { action: "retention.purged", targetType: "system", details: counts });
  return counts;
}
