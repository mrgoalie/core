import { asc, eq } from "drizzle-orm";
import { SkillConfig } from "@/lib/skill-config";
import { emptySessionData, type SessionData } from "@/lib/work-types";
import { loadActor } from "../auth/session";
import type { DB } from "../db/client";
import { matterRefs, sessionDocuments, skillVersions, skills, uploadedFiles, workSessions } from "../db/schema";
import { NotFoundError } from "../errors";
import { getCaseAdapter } from "../integrations/clio";
import type { MatterDetail } from "../integrations/clio/types";
import { getStorage } from "../storage";

export type WorkSessionRow = typeof workSessions.$inferSelect;
export type SessionDocumentRow = typeof sessionDocuments.$inferSelect;

export async function loadWorkContext(db: DB, sessionId: string) {
  const [session] = await db.select().from(workSessions).where(eq(workSessions.id, sessionId));
  if (!session) throw new NotFoundError();
  const [version] = await db.select().from(skillVersions).where(eq(skillVersions.id, session.skillVersionId));
  const [skill] = await db.select().from(skills).where(eq(skills.id, session.skillId));
  const config = SkillConfig.parse(version.config);
  const owner = await loadActor(db, session.userId);
  const [matterRef] = session.matterRefId ? await db.select().from(matterRefs).where(eq(matterRefs.id, session.matterRefId)) : [];
  const docs = await db.select().from(sessionDocuments).where(eq(sessionDocuments.workSessionId, session.id)).orderBy(asc(sessionDocuments.createdAt));
  const data: SessionData = { ...emptySessionData(), ...((session.data as SessionData) ?? {}) };
  return { session, version, skill, config, owner, matterRef: matterRef ?? null, docs, data };
}

export type WorkContext = Awaited<ReturnType<typeof loadWorkContext>>;

/** Loads the matter on behalf of the session's owner, so Clio permissions are always the owner's own. */
export async function loadMatterForOwner(ctx: WorkContext): Promise<MatterDetail | null> {
  if (!ctx.matterRef || !ctx.owner) return null;
  const adapter = await getCaseAdapter({ testMode: ctx.session.isTest });
  return adapter.getMatter(ctx.owner, ctx.matterRef.externalId, { testMode: ctx.session.isTest });
}

export async function fetchDocumentBytes(db: DB, ctx: WorkContext, doc: SessionDocumentRow): Promise<Buffer> {
  if (doc.origin === "upload" && doc.uploadId) {
    const [u] = await db.select().from(uploadedFiles).where(eq(uploadedFiles.id, doc.uploadId));
    if (!u || u.deletedAt || u.scanStatus !== "clean") throw new NotFoundError("An uploaded file is no longer available. Please upload it again.");
    return getStorage().get(u.storageKey);
  }
  if (!ctx.owner || !ctx.matterRef || !doc.externalId) throw new NotFoundError();
  const adapter = await getCaseAdapter({ testMode: ctx.session.isTest });
  const file = await adapter.downloadDocument(ctx.owner, ctx.matterRef.externalId, doc.externalId, { testMode: ctx.session.isTest });
  return file.bytes;
}

export async function saveSessionData(db: DB, sessionId: string, data: SessionData, extra: Partial<WorkSessionRow> = {}) {
  await db
    .update(workSessions)
    .set({ data, updatedAt: new Date(), ...extra })
    .where(eq(workSessions.id, sessionId));
}
