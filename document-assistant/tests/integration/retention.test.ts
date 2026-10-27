import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { uploadedFiles, workSessions } from "@/server/db/schema";
import { textPagesToPdf } from "@/server/documents/pdf-compose";
import { purgeExpired } from "@/server/services/retention";
import { getSkillDetail, saveDraft } from "@/server/services/skills";
import { selectMatter, startWork, uploadDocument } from "@/server/services/work";
import { getStorage } from "@/server/storage";
import { actor, DEMO, freshDb, skillId } from "../helpers";

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await freshDb()));
afterAll(async () => close());

describe("retention", () => {
  it("removes expired working uploads and old administrator test runs, and keeps current work", async () => {
    const maria = await actor(db, DEMO.maria);
    const jordan = await actor(db, DEMO.jordan);
    const demand = await skillId(db, "demand-letter");

    const { sessionId } = await startWork(db, maria, demand);
    await selectMatter(db, maria, sessionId, "m-1001");
    await uploadDocument(db, maria, sessionId, { name: "note.pdf", bytes: Buffer.from(await textPagesToPdf(["x"])) }, null);
    const [upload] = await db.select().from(uploadedFiles).where(eq(uploadedFiles.workSessionId, sessionId));

    const live = (await getSkillDetail(db, demand)).versions.find((v) => v.status === "published")!;
    const draft = await saveDraft(db, jordan, demand, { ...live.config, name: "Demand Letter (test)" }, "test");
    const { sessionId: testRun } = await startWork(db, jordan, demand, { testVersionId: draft.versionId });

    // Nothing has expired yet.
    expect(await purgeExpired(db)).toEqual({ uploads: 0, extractedText: 0, testRuns: 0 });

    // A year later: the working upload and the test run are gone; the employee's work record stays.
    const counts = await purgeExpired(db, new Date(Date.now() + 365 * 86400_000));
    expect(counts.uploads).toBe(1);
    expect(counts.testRuns).toBe(1);
    await expect(getStorage().get(upload.storageKey)).rejects.toThrow();
    expect((await db.select().from(uploadedFiles).where(eq(uploadedFiles.id, upload.id)))[0].deletedAt).not.toBeNull();
    expect(await db.select().from(workSessions).where(eq(workSessions.id, testRun))).toHaveLength(0);
    expect(await db.select().from(workSessions).where(eq(workSessions.id, sessionId))).toHaveLength(1);
  });
});
