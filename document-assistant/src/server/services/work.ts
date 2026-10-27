/**
 * Work sessions: one employee preparing one work product for one matter.
 * Every function re-checks authorization on the server; the browser is never trusted.
 */
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { isVisible, SkillConfig } from "@/lib/skill-config";
import { emptySessionData, type SessionData } from "@/lib/work-types";
import { audit, type RequestMeta } from "../audit";
import { isAttorney, isFirmAdmin, type Actor } from "../auth/permissions";
import { getConfig } from "../config";
import type { DB } from "../db/client";
import { approvalRecords, generatedDocuments, jobs, matterRefs, sessionDocuments, skillVersions, skills, uploadedFiles, userRoles, users, workSessions } from "../db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { screenUpload, sanitizeFileName, FILE_TYPES } from "../documents/intake";
import { loadWorkContext, saveSessionData, fetchDocumentBytes, type WorkContext } from "../generation/context";
import { assertGenerationAllowed, assertWorkCanRun, EDITABLE_STATUSES, userHasSkill } from "../generation/guards";
import { applyEmployeeAnswers, applyPrefill } from "../generation/prefill";
import { getCaseAdapter } from "../integrations/clio";
import { enqueueJob } from "../jobs/queue";
import { getSetting } from "../settings";
import { getStorage, newStorageKey, sha256 } from "../storage";
import { employeeSkills } from "./skills";

// ---------------------------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------------------------

/** Reviewers may open submitted work only if they can also see the matter themselves. */
export async function reviewerCanAccess(db: DB, actor: Actor, ctx: WorkContext) {
  if (!isAttorney(actor) || ctx.session.isTest) return false;
  if (!["submitted", "approved", "changes_requested"].includes(ctx.session.status)) return false;
  if (ctx.session.reviewerId && ctx.session.reviewerId !== actor.id && ctx.session.status === "submitted") return false;
  if (ctx.session.userId === actor.id && !(await getSetting(db, "review")).allowSelfApproval) return false;
  if (!ctx.matterRef) return false;
  const adapter = await getCaseAdapter();
  return Boolean(await adapter.getMatter(actor, ctx.matterRef.externalId));
}

export async function loadForActor(db: DB, actor: Actor, sessionId: string, mode: "owner" | "owner_or_reviewer" = "owner") {
  const ctx = await loadWorkContext(db, sessionId).catch(() => null);
  if (!ctx) throw new NotFoundError();
  if (ctx.session.userId === actor.id) {
    if (ctx.session.isTest && !isFirmAdmin(actor)) throw new NotFoundError();
    return { ctx, role: "owner" as const };
  }
  if (mode === "owner_or_reviewer" && (await reviewerCanAccess(db, actor, ctx))) return { ctx, role: "reviewer" as const };
  // Never reveal that someone else's work exists.
  throw new NotFoundError();
}

function assertEditable(ctx: WorkContext) {
  if (!EDITABLE_STATUSES.has(ctx.session.status)) throw new ConflictError("This work has been sent for review and can't be changed. Withdraw it first if you need to make changes.");
}

// ---------------------------------------------------------------------------------------------
// Starting and listing work
// ---------------------------------------------------------------------------------------------

export async function startWork(db: DB, actor: Actor, skillId: string, opts: { testVersionId?: string } = {}, meta?: RequestMeta) {
  const retention = await getSetting(db, "retention");
  let versionId: string;
  let name: string;
  if (opts.testVersionId) {
    if (!isFirmAdmin(actor)) throw new ForbiddenError();
    const [v] = await db.select().from(skillVersions).where(and(eq(skillVersions.id, opts.testVersionId), eq(skillVersions.skillId, skillId)));
    if (!v) throw new NotFoundError();
    if (!["draft", "testing", "approved"].includes(v.status)) throw new ConflictError("Only an unpublished draft version can be test-run.");
    versionId = v.id;
    name = SkillConfig.parse(v.config).name;
  } else {
    const available = await employeeSkills(db, actor);
    const s = available.find((x) => x.id === skillId);
    if (!s) {
      await audit(db, { actor, action: "skill.access_denied", outcome: "denied", targetType: "skill", targetId: skillId, meta });
      throw new ForbiddenError("That skill isn't available to you. Ask your administrator if you need it.");
    }
    versionId = s.versionId;
    name = s.name;
  }
  const days = opts.testVersionId ? retention.testRunDays : retention.workingFileDays;
  const [row] = await db
    .insert(workSessions)
    .values({
      userId: actor.id,
      skillId,
      skillVersionId: versionId,
      isTest: Boolean(opts.testVersionId),
      title: opts.testVersionId ? `TEST — ${name}` : name,
      data: emptySessionData(),
      expiresAt: new Date(Date.now() + days * 86400_000),
    })
    .returning();
  await audit(db, { actor, action: opts.testVersionId ? "skill.test_started" : "work.started", targetType: "work_session", targetId: row.id, details: { skillId, versionId }, meta });
  return { sessionId: row.id };
}

export async function listMyWork(db: DB, actor: Actor, opts: { limit?: number; includeArchived?: boolean } = {}) {
  const rows = await db
    .select({ s: workSessions, m: matterRefs })
    .from(workSessions)
    .leftJoin(matterRefs, eq(matterRefs.id, workSessions.matterRefId))
    .where(and(eq(workSessions.userId, actor.id), eq(workSessions.isTest, false), opts.includeArchived ? undefined : ne(workSessions.status, "archived")))
    .orderBy(desc(workSessions.updatedAt))
    .limit(opts.limit ?? 50);
  return rows.map(({ s, m }) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    matter: m ? `${m.displayNumber} · ${m.description}` : null,
    updatedAt: s.updatedAt,
    skillId: s.skillId,
  }));
}

// ---------------------------------------------------------------------------------------------
// The work view
// ---------------------------------------------------------------------------------------------

export async function getWorkView(db: DB, actor: Actor, sessionId: string) {
  const { ctx, role } = await loadForActor(db, actor, sessionId, "owner_or_reviewer");
  const viewer = role === "owner" ? actor : actor;
  const adapter = await getCaseAdapter({ testMode: ctx.session.isTest });
  const matter = ctx.matterRef ? await adapter.getMatter(viewer, ctx.matterRef.externalId, { testMode: ctx.session.isTest }) : null;
  const gen = await getSetting(db, "generation");
  const permitted = ctx.session.isTest ? isFirmAdmin(actor) : await userHasSkill(db, ctx.session.userId, ctx.session.skillId);
  const reviewers =
    role === "owner"
      ? await db
          .select({ id: users.id, name: users.displayName })
          .from(users)
          .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.role, "ATTORNEY_REVIEWER")))
          .where(eq(users.status, "active"))
      : [];
  const allowSelf = (await getSetting(db, "review")).allowSelfApproval;
  const history = await db
    .select({ action: approvalRecords.action, comments: approvalRecords.comments, at: approvalRecords.createdAt, revision: approvalRecords.revision, by: users.displayName })
    .from(approvalRecords)
    .leftJoin(users, eq(users.id, approvalRecords.actorId))
    .where(eq(approvalRecords.workSessionId, ctx.session.id))
    .orderBy(desc(approvalRecords.createdAt));
  const [activeJob] = await db
    .select({ id: jobs.id, type: jobs.type, status: jobs.status, progress: jobs.progress })
    .from(jobs)
    .where(and(eq(jobs.workSessionId, ctx.session.id), inArray(jobs.status, ["queued", "running"])))
    .limit(1);
  const [owner] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, ctx.session.userId));

  const applicableReqs = ctx.config.documents.filter((r) => isVisible(r.appliesWhen, ctx.data.answers));
  return {
    role,
    session: {
      id: ctx.session.id,
      title: ctx.session.title,
      status: ctx.session.status,
      isTest: ctx.session.isTest,
      currentStep: ctx.session.currentStep,
      revision: ctx.session.revision,
      reviewerId: ctx.session.reviewerId,
      submittedAt: ctx.session.submittedAt,
      approvedAt: ctx.session.approvedAt,
      updatedAt: ctx.session.updatedAt,
      ownerName: owner?.name ?? "",
      versionNumber: ctx.version.versionNumber,
    },
    skill: { id: ctx.skill.id, config: ctx.config, enabled: ctx.skill.enabled && !ctx.skill.archivedAt },
    matter,
    matterRef: ctx.matterRef ? { displayNumber: ctx.matterRef.displayNumber, description: ctx.matterRef.description } : null,
    documents: ctx.docs.map((d) => ({
      id: d.id,
      origin: d.origin,
      fileName: d.fileName,
      category: d.category,
      requirementId: d.requirementId,
      selected: d.selected,
      pageCount: d.pageCount,
      extractStatus: d.extractStatus,
      extractError: d.extractError,
    })),
    applicableRequirementIds: applicableReqs.map((r) => r.id),
    data: ctx.data,
    activeJob: activeJob ?? null,
    flags: {
      canEdit: role === "owner" && EDITABLE_STATUSES.has(ctx.session.status) && permitted && ctx.skill.enabled && !ctx.skill.archivedAt,
      canSubmit: role === "owner" && !ctx.session.isTest && ["ready", "changes_requested"].includes(ctx.session.status) && Boolean(ctx.data.generation) && !ctx.data.generation?.stale,
      canWithdraw: role === "owner" && ctx.session.status === "submitted",
      canReview: role === "reviewer" && ctx.session.status === "submitted",
      generationSuspended: gen.suspended,
      suspensionReason: gen.reason,
      permitted,
      uploadsAllowed: ctx.config.allowUploads,
      maxUploadMb: getConfig().MAX_UPLOAD_MB,
      acceptedTypes: Object.values(FILE_TYPES).map((t) => t.label),
    },
    reviewers: reviewers.filter((r) => allowSelf || r.id !== actor.id),
    history,
  };
}

// ---------------------------------------------------------------------------------------------
// Step 1: matter
// ---------------------------------------------------------------------------------------------

export async function searchMattersFor(db: DB, actor: Actor, sessionId: string, query: string) {
  const { ctx } = await loadForActor(db, actor, sessionId);
  const adapter = await getCaseAdapter({ testMode: ctx.session.isTest });
  return adapter.searchMatters(actor, query.slice(0, 100), { testMode: ctx.session.isTest });
}

export async function selectMatter(db: DB, actor: Actor, sessionId: string, matterId: string, meta?: RequestMeta) {
  const { ctx } = await loadForActor(db, actor, sessionId);
  assertEditable(ctx);
  const adapter = await getCaseAdapter({ testMode: ctx.session.isTest });
  const matter = await adapter.getMatter(actor, matterId, { testMode: ctx.session.isTest });
  if (!matter) {
    await audit(db, { actor, action: "matter.access_denied", outcome: "denied", targetType: "matter", targetId: matterId, meta });
    throw new NotFoundError("That case wasn't found, or you don't have access to it in Clio.");
  }
  const provider = adapter.mode;
  await db
    .insert(matterRefs)
    .values({ provider, externalId: matter.id, displayNumber: matter.displayNumber, description: matter.description })
    .onConflictDoUpdate({ target: [matterRefs.provider, matterRefs.externalId], set: { displayNumber: matter.displayNumber, description: matter.description } });
  const [ref] = await db.select().from(matterRefs).where(and(eq(matterRefs.provider, provider), eq(matterRefs.externalId, matter.id)));

  // Changing the case resets case documents and anything filled in from the previous case.
  await db.delete(sessionDocuments).where(and(eq(sessionDocuments.workSessionId, ctx.session.id), eq(sessionDocuments.origin, "matter")));
  const docs = await adapter.listDocuments(actor, matter.id, { testMode: ctx.session.isTest });
  const taken = new Set<string>();
  const rows = docs.map((d) => {
    const req = ctx.config.documents.find((r) => r.categories.includes(d.category) && (r.multiple || !taken.has(r.id)));
    const appliesNow = req ? isVisible(req.appliesWhen, ctx.data.answers) : false;
    if (req) taken.add(req.id);
    return {
      workSessionId: ctx.session.id,
      origin: "matter" as const,
      externalId: d.id,
      fileName: d.name,
      mimeType: d.contentType,
      sizeBytes: d.sizeBytes ?? null,
      category: d.category,
      requirementId: req?.id ?? ctx.config.documents.find((r) => r.categories.includes(d.category))?.id ?? null,
      selected: Boolean(req && appliesNow),
      addedBy: actor.id,
    };
  });
  if (rows.length) await db.insert(sessionDocuments).values(rows);

  const cleared: SessionData = { ...ctx.data, answers: { ...ctx.data.answers }, provenance: { ...ctx.data.provenance }, rowProvenance: { ...ctx.data.rowProvenance }, analysis: undefined, generation: undefined, exhibitOrder: [] };
  for (const [id, p] of Object.entries(cleared.provenance)) {
    if (p.kind === "matter" || p.kind === "document") {
      delete cleared.answers[id];
      delete cleared.provenance[id];
      delete cleared.rowProvenance[id];
    }
  }
  const data = applyPrefill(ctx.config, cleared, matter.fields as Record<string, string>, {});
  await saveSessionData(db, ctx.session.id, data, {
    matterRefId: ref.id,
    currentStep: 2,
    title: `${ctx.session.isTest ? "TEST — " : ""}${ctx.config.name} — ${matter.description}`.slice(0, 200),
  });
  await audit(db, { actor, action: "work.matter_selected", targetType: "work_session", targetId: ctx.session.id, details: { matter: matter.displayNumber, documentsListed: docs.length }, meta });
  return { documents: rows.length };
}

// ---------------------------------------------------------------------------------------------
// Step 2: documents and answers
// ---------------------------------------------------------------------------------------------

export async function saveAnswers(db: DB, actor: Actor, sessionId: string, updates: Record<string, unknown>, step?: number) {
  const { ctx } = await loadForActor(db, actor, sessionId);
  assertEditable(ctx);
  for (const [k, v] of Object.entries(updates)) {
    if (JSON.stringify(v ?? null).length > 50_000) throw new ValidationError(`The answer for "${k}" is too long.`);
  }
  const data = applyEmployeeAnswers(ctx.config, ctx.data, updates);
  await saveSessionData(db, ctx.session.id, data, step ? { currentStep: Math.min(3, Math.max(1, step)) } : {});
  return { savedAt: new Date().toISOString() };
}

export async function setStep(db: DB, actor: Actor, sessionId: string, step: number) {
  const { ctx } = await loadForActor(db, actor, sessionId);
  await db.update(workSessions).set({ currentStep: Math.min(3, Math.max(1, step)), updatedAt: new Date() }).where(eq(workSessions.id, ctx.session.id));
}

export async function updateDocument(db: DB, actor: Actor, sessionId: string, docId: string, change: { selected?: boolean; requirementId?: string | null }) {
  const { ctx } = await loadForActor(db, actor, sessionId);
  assertEditable(ctx);
  const doc = ctx.docs.find((d) => d.id === docId);
  if (!doc) throw new NotFoundError();
  if (change.requirementId && !ctx.config.documents.some((r) => r.id === change.requirementId)) throw new ValidationError("Unknown document type.");
  await db
    .update(sessionDocuments)
    .set({ selected: change.selected ?? doc.selected, requirementId: change.requirementId === undefined ? doc.requirementId : change.requirementId })
    .where(eq(sessionDocuments.id, doc.id));
  if (ctx.data.generation) await saveSessionData(db, ctx.session.id, { ...ctx.data, generation: { ...ctx.data.generation, stale: true } });
}

export async function reorderExhibits(db: DB, actor: Actor, sessionId: string, order: string[]) {
  const { ctx } = await loadForActor(db, actor, sessionId);
  assertEditable(ctx);
  const ids = new Set(ctx.docs.map((d) => d.id));
  const clean = order.filter((id) => ids.has(id));
  await saveSessionData(db, ctx.session.id, { ...ctx.data, exhibitOrder: clean, generation: ctx.data.generation ? { ...ctx.data.generation, stale: true } : undefined });
}

export async function uploadDocument(db: DB, actor: Actor, sessionId: string, file: { name: string; bytes: Buffer }, requirementId: string | null, meta?: RequestMeta) {
  const { ctx } = await loadForActor(db, actor, sessionId);
  assertEditable(ctx);
  if (!ctx.config.allowUploads) throw new ForbiddenError("This skill doesn't accept uploaded documents.");
  const req = requirementId ? ctx.config.documents.find((r) => r.id === requirementId) : undefined;
  if (requirementId && !req) throw new ValidationError("Unknown document type.");
  const fileName = sanitizeFileName(file.name);
  const scan = await screenUpload(file.bytes, fileName);
  if (!scan.ok || !scan.kind) {
    await audit(db, { actor, action: "upload.rejected", outcome: "denied", targetType: "work_session", targetId: ctx.session.id, details: { fileName, reason: scan.reason, engine: scan.engine, size: file.bytes.length }, meta });
    throw new ValidationError(scan.reason ?? "This file could not be accepted.");
  }
  const key = newStorageKey(`uploads/${actor.id}`, scan.kind);
  await getStorage().put(key, file.bytes);
  const retention = await getSetting(db, "retention");
  const [upload] = await db
    .insert(uploadedFiles)
    .values({
      ownerId: actor.id,
      workSessionId: ctx.session.id,
      storageKey: key,
      fileName,
      mimeType: FILE_TYPES[scan.kind].mime,
      sizeBytes: file.bytes.length,
      sha256: sha256(file.bytes),
      scanStatus: "clean",
      scanDetail: scan.engine,
      expiresAt: new Date(Date.now() + retention.workingFileDays * 86400_000),
    })
    .returning();
  const [doc] = await db
    .insert(sessionDocuments)
    .values({
      workSessionId: ctx.session.id,
      origin: "upload",
      uploadId: upload.id,
      fileName,
      mimeType: FILE_TYPES[scan.kind].mime,
      sizeBytes: file.bytes.length,
      category: req?.categories[0] ?? "other",
      requirementId: req?.id ?? null,
      selected: true,
      addedBy: actor.id,
    })
    .returning();
  await audit(db, { actor, action: "upload.accepted", targetType: "work_session", targetId: ctx.session.id, details: { fileName, size: file.bytes.length, type: scan.kind, engine: scan.engine }, meta });
  return { documentId: doc.id, fileName };
}

export async function removeUpload(db: DB, actor: Actor, sessionId: string, docId: string, meta?: RequestMeta) {
  const { ctx } = await loadForActor(db, actor, sessionId);
  assertEditable(ctx);
  const doc = ctx.docs.find((d) => d.id === docId && d.origin === "upload");
  if (!doc) throw new NotFoundError();
  await db.delete(sessionDocuments).where(eq(sessionDocuments.id, doc.id));
  if (doc.uploadId) {
    const [u] = await db.select().from(uploadedFiles).where(eq(uploadedFiles.id, doc.uploadId));
    if (u) {
      await getStorage().delete(u.storageKey);
      await db.update(uploadedFiles).set({ deletedAt: new Date() }).where(eq(uploadedFiles.id, u.id));
    }
  }
  await audit(db, { actor, action: "upload.removed", targetType: "work_session", targetId: ctx.session.id, details: { fileName: doc.fileName }, meta });
}

// ---------------------------------------------------------------------------------------------
// Background work
// ---------------------------------------------------------------------------------------------

async function queueFor(db: DB, actor: Actor, sessionId: string, type: "analyze" | "generate" | "rerender", meta?: RequestMeta) {
  const { ctx } = await loadForActor(db, actor, sessionId);
  await assertWorkCanRun(db, ctx);
  if (type !== "analyze" && !ctx.matterRef) throw new ValidationError("Choose a case first.");
  const [existing] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.workSessionId, ctx.session.id), inArray(jobs.status, ["queued", "running"])))
    .limit(1);
  if (existing) return { jobId: existing.id };
  const job = await enqueueJob(db, type, { sessionId: ctx.session.id }, { workSessionId: ctx.session.id, createdBy: actor.id });
  await audit(db, { actor, action: `work.${type}_requested`, targetType: "work_session", targetId: ctx.session.id, details: { jobId: job.id }, meta });
  return { jobId: job.id };
}

export const requestAnalysis = (db: DB, a: Actor, id: string, m?: RequestMeta) => queueFor(db, a, id, "analyze", m);
export const requestGeneration = (db: DB, a: Actor, id: string, m?: RequestMeta) => queueFor(db, a, id, "generate", m);
export const requestRerender = (db: DB, a: Actor, id: string, m?: RequestMeta) => queueFor(db, a, id, "rerender", m);

export async function getJobFor(db: DB, actor: Actor, sessionId: string, jobId: string) {
  const { ctx } = await loadForActor(db, actor, sessionId);
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.workSessionId, ctx.session.id)));
  if (!job) throw new NotFoundError();
  return { id: job.id, type: job.type, status: job.status, progress: job.progress, error: job.status === "failed" ? job.lastError : null, attempts: job.attempts };
}

export async function saveSectionEdits(db: DB, actor: Actor, sessionId: string, edits: Record<string, string | null>) {
  const { ctx } = await loadForActor(db, actor, sessionId);
  assertEditable(ctx);
  if (!ctx.data.generation) throw new ValidationError("Create the draft first.");
  const next = { ...(ctx.data.sectionEdits ?? {}) };
  for (const [id, text] of Object.entries(edits)) {
    if (!ctx.data.generation.sections.some((s) => s.id === id)) continue;
    if (text === null) delete next[id];
    else next[id] = text.slice(0, 20_000);
  }
  await saveSessionData(db, ctx.session.id, { ...ctx.data, sectionEdits: next, generation: { ...ctx.data.generation, stale: true } });
  return { savedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------------------------
// Review hand-off
// ---------------------------------------------------------------------------------------------

async function currentHashes(db: DB, sessionId: string, revision: number, final: boolean) {
  const docs = await db
    .select({ fileName: generatedDocuments.fileName, sha256: generatedDocuments.sha256 })
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.workSessionId, sessionId), eq(generatedDocuments.revision, revision), eq(generatedDocuments.isFinal, final)));
  return Object.fromEntries(docs.map((d) => [d.fileName, d.sha256]));
}

export async function submitForReview(db: DB, actor: Actor, sessionId: string, input: { reviewerId?: string | null; note?: string }, meta?: RequestMeta) {
  const { ctx } = await loadForActor(db, actor, sessionId);
  if (ctx.session.isTest) throw new ValidationError("Test runs use fictional data and can't be sent for attorney review.");
  if (!["ready", "changes_requested"].includes(ctx.session.status)) throw new ConflictError("Create the draft before sending it for review.");
  if (!ctx.data.generation || ctx.data.generation.stale) throw new ValidationError("Something changed since the draft was created. Click “Update the draft” first so the attorney sees the latest version.");
  if (!(await userHasSkill(db, actor.id, ctx.skill.id))) throw new ForbiddenError("You no longer have access to this skill.");
  const allowSelf = (await getSetting(db, "review")).allowSelfApproval;
  if (input.reviewerId) {
    const [r] = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.role, "ATTORNEY_REVIEWER")))
      .where(and(eq(users.id, input.reviewerId), eq(users.status, "active")));
    if (!r) throw new ValidationError("Please choose an attorney reviewer from the list.");
    if (r.id === actor.id && !allowSelf) throw new ValidationError("You can't approve your own work. Choose another attorney.");
  }
  await db.update(workSessions).set({ status: "submitted", submittedAt: new Date(), reviewerId: input.reviewerId ?? null, updatedAt: new Date() }).where(eq(workSessions.id, ctx.session.id));
  await db.insert(approvalRecords).values({
    workSessionId: ctx.session.id,
    revision: ctx.session.revision,
    action: "submitted",
    actorId: actor.id,
    comments: input.note?.slice(0, 2000) || null,
    documentHashes: await currentHashes(db, ctx.session.id, ctx.session.revision, false),
  });
  await audit(db, { actor, action: "work.submitted", targetType: "work_session", targetId: ctx.session.id, details: { revision: ctx.session.revision, reviewerId: input.reviewerId ?? null, openIssues: ctx.data.generation.issues.filter((i) => i.severity === "attention").length }, meta });
}

export async function withdrawSubmission(db: DB, actor: Actor, sessionId: string, meta?: RequestMeta) {
  const { ctx } = await loadForActor(db, actor, sessionId);
  if (ctx.session.status !== "submitted") throw new ConflictError("This work isn't waiting for review.");
  await db.update(workSessions).set({ status: "ready", updatedAt: new Date() }).where(eq(workSessions.id, ctx.session.id));
  await db.insert(approvalRecords).values({ workSessionId: ctx.session.id, revision: ctx.session.revision, action: "withdrawn", actorId: actor.id });
  await audit(db, { actor, action: "work.withdrawn", targetType: "work_session", targetId: ctx.session.id, meta });
}

export async function archiveWork(db: DB, actor: Actor, sessionId: string, meta?: RequestMeta) {
  const { ctx } = await loadForActor(db, actor, sessionId);
  if (ctx.session.status === "submitted") throw new ConflictError("Withdraw this work from review before removing it.");
  await db.update(workSessions).set({ status: "archived", updatedAt: new Date() }).where(eq(workSessions.id, ctx.session.id));
  await audit(db, { actor, action: "work.archived", targetType: "work_session", targetId: ctx.session.id, meta });
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

export async function downloadGenerated(db: DB, actor: Actor, sessionId: string, fileId: string, meta?: RequestMeta) {
  const { ctx, role } = await loadForActor(db, actor, sessionId, "owner_or_reviewer");
  const [doc] = await db.select().from(generatedDocuments).where(and(eq(generatedDocuments.id, fileId), eq(generatedDocuments.workSessionId, ctx.session.id)));
  if (!doc) throw new NotFoundError();
  if (doc.isFinal && ctx.session.status !== "approved") throw new NotFoundError();
  const bytes = await getStorage().get(doc.storageKey);
  await audit(db, { actor, action: "document.downloaded", targetType: "generated_document", targetId: doc.id, details: { sessionId: ctx.session.id, final: doc.isFinal, format: doc.format, as: role }, meta });
  return { bytes, fileName: doc.fileName, mimeType: doc.mimeType };
}

export async function viewSourceDocument(db: DB, actor: Actor, sessionId: string, docId: string, meta?: RequestMeta) {
  const { ctx, role } = await loadForActor(db, actor, sessionId, "owner_or_reviewer");
  const doc = ctx.docs.find((d) => d.id === docId);
  if (!doc) throw new NotFoundError();
  if (role === "reviewer") {
    // Reviewers fetch case documents with their own case-management access.
    if (doc.origin === "matter" && ctx.matterRef && doc.externalId) {
      const adapter = await getCaseAdapter();
      const file = await adapter.downloadDocument(actor, ctx.matterRef.externalId, doc.externalId);
      await audit(db, { actor, action: "source.viewed", targetType: "session_document", targetId: doc.id, details: { as: role }, meta });
      return { bytes: file.bytes, fileName: doc.fileName, mimeType: doc.mimeType };
    }
  }
  const bytes = await fetchDocumentBytes(db, ctx, doc);
  await audit(db, { actor, action: "source.viewed", targetType: "session_document", targetId: doc.id, details: { as: role }, meta });
  return { bytes, fileName: doc.fileName, mimeType: doc.mimeType };
}

export async function skillsForWorkList(db: DB, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ id: skills.id, v: skillVersions.config }).from(skills).leftJoin(skillVersions, eq(skillVersions.id, skills.publishedVersionId)).where(inArray(skills.id, ids));
  return new Map(rows.map((r) => [r.id, SkillConfig.safeParse(r.v).success ? SkillConfig.parse(r.v).name : ""]));
}

export { assertGenerationAllowed };
