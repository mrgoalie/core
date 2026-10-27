/**
 * Skill catalog and lifecycle: Draft → Testing → Approved → Published → Archived.
 *
 * - Published versions never change; edits always go into a separate draft version.
 * - "Significant" changes (anything affecting drafting, questions, documents, calculations, output
 *   or templates) require a recorded test run on fictional data AND approval by an attorney reviewer.
 * - Cosmetic changes (name, description, instructions, icon, category) may be published directly.
 * - New skills are available to nobody until an administrator grants access.
 */
import { and, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { diffConfigs, detectUnsupportedRequests, SkillConfig, type SkillConfigInput } from "@/lib/skill-config";
import { audit, type RequestMeta } from "../audit";
import { isAttorney, isFirmAdmin, type Actor } from "../auth/permissions";
import type { DB } from "../db/client";
import { documentTemplates, skillVersions, skills, userSkillPermissions, users, workSessions } from "../db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";

export type SkillVersionRow = typeof skillVersions.$inferSelect;

export function parseConfig(input: unknown): SkillConfig {
  const r = SkillConfig.safeParse(input);
  if (!r.success) {
    const problems = r.error.issues.slice(0, 12).map((i) => ({ field: i.path.join("."), message: i.message }));
    throw new ValidationError("Please fix the highlighted items before saving.", problems);
  }
  return r.data;
}

async function versionsOf(db: DB, skillId: string) {
  return db.select().from(skillVersions).where(eq(skillVersions.skillId, skillId)).orderBy(desc(skillVersions.versionNumber));
}

async function getSkillOr404(db: DB, skillId: string) {
  const [s] = await db.select().from(skills).where(eq(skills.id, skillId));
  if (!s) throw new NotFoundError();
  return s;
}

async function getVersionOr404(db: DB, versionId: string) {
  const [v] = await db.select().from(skillVersions).where(eq(skillVersions.id, versionId));
  if (!v) throw new NotFoundError();
  return v;
}

async function assertTemplateUsable(db: DB, cfg: SkillConfig) {
  if (!cfg.output.templateId) return;
  const [t] = await db.select().from(documentTemplates).where(eq(documentTemplates.id, cfg.output.templateId));
  if (!t) throw new ValidationError("The selected Word template no longer exists. Choose another template.");
}

function slugFrom(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "skill"
  );
}

async function uniqueSlug(db: DB, base: string) {
  let slug = base;
  for (let n = 2; ; n++) {
    const [hit] = await db.select({ id: skills.id }).from(skills).where(eq(skills.slug, slug));
    if (!hit) return slug;
    slug = `${base}-${n}`;
  }
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

export async function listSkillsForAdmin(db: DB) {
  const all = await db.select().from(skills).orderBy(skills.createdAt);
  const versions = all.length ? await db.select().from(skillVersions).where(inArray(skillVersions.skillId, all.map((s) => s.id))) : [];
  const grants = await db.select({ skillId: userSkillPermissions.skillId, n: sql<number>`count(*)::int` }).from(userSkillPermissions).groupBy(userSkillPermissions.skillId);
  return all.map((s) => {
    const vs = versions.filter((v) => v.skillId === s.id).sort((a, b) => b.versionNumber - a.versionNumber);
    const published = vs.find((v) => v.id === s.publishedVersionId) ?? null;
    const draft = vs.find((v) => ["draft", "testing", "approved"].includes(v.status)) ?? null;
    const latest = draft ?? published ?? vs[0];
    const cfg = SkillConfig.safeParse(latest?.config);
    return {
      id: s.id,
      slug: s.slug,
      name: cfg.success ? cfg.data.name : s.slug,
      shortDescription: cfg.success ? cfg.data.shortDescription : "",
      icon: cfg.success ? cfg.data.icon : "file-text",
      category: cfg.success ? cfg.data.category : "",
      enabled: s.enabled,
      archived: Boolean(s.archivedAt),
      isBuiltIn: s.isBuiltIn,
      publishedVersion: published ? { id: published.id, number: published.versionNumber, publishedAt: published.publishedAt } : null,
      draftVersion: draft ? { id: draft.id, number: draft.versionNumber, status: draft.status, testStatus: draft.testStatus, significance: draft.significance } : null,
      grantedCount: grants.find((g) => g.skillId === s.id)?.n ?? 0,
    };
  });
}

export async function getSkillDetail(db: DB, skillId: string) {
  const skill = await getSkillOr404(db, skillId);
  const vs = await versionsOf(db, skillId);
  const people = await db.select({ id: users.id, name: users.displayName, email: users.email }).from(users);
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? "Unknown") : null);
  const grants = await db.select({ userId: userSkillPermissions.userId }).from(userSkillPermissions).where(eq(userSkillPermissions.skillId, skillId));
  const testRuns = await db
    .select({ versionId: workSessions.skillVersionId, id: workSessions.id, revision: workSessions.revision, updatedAt: workSessions.updatedAt })
    .from(workSessions)
    .where(and(eq(workSessions.skillId, skillId), eq(workSessions.isTest, true)))
    .orderBy(desc(workSessions.updatedAt));
  return {
    skill: { id: skill.id, slug: skill.slug, enabled: skill.enabled, archived: Boolean(skill.archivedAt), isBuiltIn: skill.isBuiltIn, publishedVersionId: skill.publishedVersionId },
    versions: vs.map((v) => ({
      id: v.id,
      number: v.versionNumber,
      status: v.status,
      significance: v.significance,
      changedFields: v.changedFields,
      changeSummary: v.changeSummary,
      author: nameOf(v.authorId),
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
      testStatus: v.testStatus,
      testNotes: v.testNotes,
      testedBy: nameOf(v.testedBy),
      testedAt: v.testedAt,
      approvedBy: nameOf(v.approvedBy),
      approvedAt: v.approvedAt,
      approvalNotes: v.approvalNotes,
      publishedBy: nameOf(v.publishedBy),
      publishedAt: v.publishedAt,
      restoredFrom: v.restoredFromVersionId ? (vs.find((x) => x.id === v.restoredFromVersionId)?.versionNumber ?? null) : null,
      testRuns: testRuns.filter((t) => t.versionId === v.id).map((t) => ({ id: t.id, generated: t.revision > 0, updatedAt: t.updatedAt })),
      config: v.config as SkillConfigInput,
    })),
    grantedUserIds: grants.map((g) => g.userId),
  };
}

/** Skills the signed-in person may use right now: published, switched on, not archived, and granted. */
export async function employeeSkills(db: DB, actor: Actor) {
  const rows = await db
    .select({ skill: skills, version: skillVersions })
    .from(userSkillPermissions)
    .innerJoin(skills, eq(skills.id, userSkillPermissions.skillId))
    .innerJoin(skillVersions, eq(skillVersions.id, skills.publishedVersionId))
    .where(and(eq(userSkillPermissions.userId, actor.id), eq(skills.enabled, true), isNull(skills.archivedAt), eq(skillVersions.status, "published")));
  return rows.map((r) => {
    const cfg = SkillConfig.parse(r.version.config);
    return { id: r.skill.id, slug: r.skill.slug, versionId: r.version.id, name: cfg.name, shortDescription: cfg.shortDescription, icon: cfg.icon, category: cfg.category };
  });
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

export async function createSkill(db: DB, actor: Actor, configInput: unknown, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const cfg = parseConfig(configInput);
  await assertTemplateUsable(db, cfg);
  const slug = await uniqueSlug(db, slugFrom(cfg.name));
  const [skill] = await db.insert(skills).values({ slug, createdBy: actor.id }).returning();
  const [version] = await db
    .insert(skillVersions)
    .values({ skillId: skill.id, versionNumber: 1, status: "draft", config: cfg, significance: "initial", changedFields: [], changeSummary: "First version", authorId: actor.id })
    .returning();
  await audit(db, { actor, action: "skill.created", targetType: "skill", targetId: skill.id, details: { name: cfg.name, slug }, meta });
  return { skillId: skill.id, versionId: version.id, warnings: detectUnsupportedRequests(`${cfg.purpose} ${cfg.drafting.sections.map((s) => s.instructions ?? "").join(" ")}`) };
}

export async function duplicateSkill(db: DB, actor: Actor, skillId: string, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const vs = await versionsOf(db, skillId);
  if (!vs.length) throw new NotFoundError();
  const cfg = SkillConfig.parse(vs[0].config);
  const copy = { ...cfg, name: `Copy of ${cfg.name}`.slice(0, 80) };
  const res = await createSkill(db, actor, copy, meta);
  await audit(db, { actor, action: "skill.duplicated", targetType: "skill", targetId: res.skillId, details: { from: skillId }, meta });
  return res;
}

/** Saves edits into the skill's draft version, creating a new draft version if none is open. */
export async function saveDraft(db: DB, actor: Actor, skillId: string, configInput: unknown, changeSummary: string | undefined, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const skill = await getSkillOr404(db, skillId);
  const cfg = parseConfig(configInput);
  await assertTemplateUsable(db, cfg);
  const vs = await versionsOf(db, skillId);
  const published = vs.find((v) => v.id === skill.publishedVersionId);
  const open = vs.find((v) => ["draft", "testing", "approved"].includes(v.status));
  const { changed, significance } = published ? diffConfigs(SkillConfig.parse(published.config), cfg) : { changed: [] as string[], significance: "initial" as const };
  if (published && changed.length === 0 && !open) throw new ValidationError("Nothing has changed compared with the published version.");

  let versionId: string;
  if (open) {
    await db
      .update(skillVersions)
      .set({
        config: cfg,
        status: "draft",
        significance: published ? significance : "initial",
        changedFields: changed,
        changeSummary: changeSummary?.trim() || open.changeSummary,
        authorId: actor.id,
        testStatus: "not_tested",
        testNotes: null,
        testedBy: null,
        testedAt: null,
        approvedBy: null,
        approvedAt: null,
        approvalNotes: null,
        updatedAt: new Date(),
      })
      .where(eq(skillVersions.id, open.id));
    versionId = open.id;
  } else {
    const [{ n }] = await db.select({ n: max(skillVersions.versionNumber) }).from(skillVersions).where(eq(skillVersions.skillId, skillId));
    const [v] = await db
      .insert(skillVersions)
      .values({ skillId, versionNumber: (n ?? 0) + 1, status: "draft", config: cfg, significance, changedFields: changed, changeSummary: changeSummary?.trim() || "Edited", authorId: actor.id })
      .returning();
    versionId = v.id;
  }
  await audit(db, { actor, action: "skill.draft_saved", targetType: "skill_version", targetId: versionId, details: { skillId, significance, changed }, meta });
  return { versionId, significance: published ? significance : "initial", changed, warnings: detectUnsupportedRequests(`${cfg.purpose} ${cfg.drafting.sections.map((s) => s.instructions ?? "").join(" ")}`) };
}

export async function discardDraft(db: DB, actor: Actor, versionId: string, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const v = await getVersionOr404(db, versionId);
  if (!["draft", "testing", "approved"].includes(v.status)) throw new ConflictError("Only an unpublished draft can be discarded.");
  const [inUse] = await db.select({ id: workSessions.id }).from(workSessions).where(and(eq(workSessions.skillVersionId, v.id), eq(workSessions.isTest, false))).limit(1);
  if (inUse) throw new ConflictError("This version is in use and can't be discarded.");
  await db.delete(workSessions).where(and(eq(workSessions.skillVersionId, v.id), eq(workSessions.isTest, true)));
  await db.update(skillVersions).set({ status: "archived", changeSummary: `${v.changeSummary ?? ""} (discarded)`.trim(), updatedAt: new Date() }).where(eq(skillVersions.id, v.id));
  await audit(db, { actor, action: "skill.draft_discarded", targetType: "skill_version", targetId: v.id, meta });
}

export async function recordTestResult(db: DB, actor: Actor, versionId: string, passed: boolean, notes: string, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const v = await getVersionOr404(db, versionId);
  if (!["draft", "testing"].includes(v.status)) throw new ConflictError("Only a draft version can be tested.");
  const [run] = await db
    .select({ id: workSessions.id })
    .from(workSessions)
    .where(and(eq(workSessions.skillVersionId, v.id), eq(workSessions.isTest, true), sql`${workSessions.revision} > 0`))
    .limit(1);
  if (!run) throw new ValidationError("Run a test with the fictional sample case first. Use “Test this version”, create the document, and look it over.");
  await db
    .update(skillVersions)
    .set({ testStatus: passed ? "passed" : "failed", testNotes: notes?.slice(0, 1000) || null, testedBy: actor.id, testedAt: new Date(), status: "testing", updatedAt: new Date() })
    .where(eq(skillVersions.id, v.id));
  await audit(db, { actor, action: "skill.test_recorded", targetType: "skill_version", targetId: v.id, details: { passed }, meta });
}

export async function approveVersion(db: DB, actor: Actor, versionId: string, notes: string, meta?: RequestMeta) {
  if (!isAttorney(actor)) throw new ForbiddenError("Only an attorney reviewer can approve a skill's legal drafting.");
  const v = await getVersionOr404(db, versionId);
  if (!["draft", "testing"].includes(v.status)) throw new ConflictError("This version can't be approved in its current state.");
  if (v.testStatus !== "passed") throw new ValidationError("This version must pass a test run before an attorney can approve it.");
  await db.update(skillVersions).set({ status: "approved", approvedBy: actor.id, approvedAt: new Date(), approvalNotes: notes?.slice(0, 1000) || null, updatedAt: new Date() }).where(eq(skillVersions.id, v.id));
  await audit(db, { actor, action: "skill.approved", targetType: "skill_version", targetId: v.id, meta });
}

export async function publishVersion(db: DB, actor: Actor, versionId: string, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const v = await getVersionOr404(db, versionId);
  if (!["draft", "testing", "approved"].includes(v.status)) throw new ConflictError("This version is not a draft and can't be published.");
  if (v.significance !== "cosmetic") {
    if (v.testStatus !== "passed") throw new ValidationError("This version changes how documents are drafted, so it must pass a test run first.");
    if (v.status !== "approved") throw new ValidationError("This version changes how documents are drafted, so an attorney reviewer must approve it before it is published.");
  }
  await publishInternal(db, actor, v);
  await audit(db, { actor, action: "skill.published", targetType: "skill_version", targetId: v.id, details: { skillId: v.skillId, version: v.versionNumber, significance: v.significance }, meta });
}

async function publishInternal(db: DB, actor: Actor, v: SkillVersionRow) {
  const skill = await getSkillOr404(db, v.skillId);
  if (skill.publishedVersionId && skill.publishedVersionId !== v.id)
    await db.update(skillVersions).set({ status: "archived", updatedAt: new Date() }).where(eq(skillVersions.id, skill.publishedVersionId));
  await db.update(skillVersions).set({ status: "published", publishedBy: actor.id, publishedAt: new Date(), updatedAt: new Date() }).where(eq(skillVersions.id, v.id));
  await db.update(skills).set({ publishedVersionId: v.id, updatedAt: new Date() }).where(eq(skills.id, v.skillId));
}

/** Rolls back by republishing the configuration of an earlier, previously approved version. */
export async function restoreVersion(db: DB, actor: Actor, versionId: string, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const target = await getVersionOr404(db, versionId);
  if (!target.publishedAt && !target.approvedAt && target.significance !== "cosmetic")
    throw new ValidationError("Only versions that were previously approved or published can be restored.");
  const skill = await getSkillOr404(db, target.skillId);
  if (skill.publishedVersionId === target.id) throw new ConflictError("That version is already the published version.");
  const current = skill.publishedVersionId ? await getVersionOr404(db, skill.publishedVersionId) : null;
  const cfg = SkillConfig.parse(target.config);
  const { changed } = current ? diffConfigs(SkillConfig.parse(current.config), cfg) : { changed: [] };
  const [{ n }] = await db.select({ n: max(skillVersions.versionNumber) }).from(skillVersions).where(eq(skillVersions.skillId, skill.id));
  const [restored] = await db
    .insert(skillVersions)
    .values({
      skillId: skill.id,
      versionNumber: (n ?? 0) + 1,
      status: "draft",
      config: cfg,
      significance: target.significance === "initial" ? "significant" : target.significance,
      changedFields: changed,
      changeSummary: `Restored version ${target.versionNumber}`,
      authorId: actor.id,
      testStatus: target.testStatus === "passed" ? "passed" : "not_tested",
      testedBy: target.testedBy,
      testedAt: target.testedAt,
      approvedBy: target.approvedBy,
      approvedAt: target.approvedAt,
      approvalNotes: `Restored from version ${target.versionNumber}${target.approvalNotes ? ` — ${target.approvalNotes}` : ""}`,
      restoredFromVersionId: target.id,
    })
    .returning();
  await publishInternal(db, actor, restored);
  await audit(db, { actor, action: "skill.restored", targetType: "skill_version", targetId: restored.id, details: { skillId: skill.id, restoredFrom: target.versionNumber }, meta });
  return { versionId: restored.id, versionNumber: restored.versionNumber };
}

export async function setSkillEnabled(db: DB, actor: Actor, skillId: string, enabled: boolean, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  await getSkillOr404(db, skillId);
  await db.update(skills).set({ enabled, updatedAt: new Date() }).where(eq(skills.id, skillId));
  await audit(db, { actor, action: enabled ? "skill.enabled" : "skill.disabled", targetType: "skill", targetId: skillId, meta });
}

export async function setSkillArchived(db: DB, actor: Actor, skillId: string, archived: boolean, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  await getSkillOr404(db, skillId);
  await db.update(skills).set({ archivedAt: archived ? new Date() : null, archivedBy: archived ? actor.id : null, updatedAt: new Date() }).where(eq(skills.id, skillId));
  await audit(db, { actor, action: archived ? "skill.archived" : "skill.unarchived", targetType: "skill", targetId: skillId, meta });
}

/** Grants or revokes one person's access to one skill. */
export async function setPermission(db: DB, actor: Actor, userId: string, skillId: string, granted: boolean, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId));
  if (!u) throw new NotFoundError();
  await getSkillOr404(db, skillId);
  if (granted) {
    await db.insert(userSkillPermissions).values({ userId, skillId, grantedBy: actor.id }).onConflictDoNothing();
  } else {
    await db.delete(userSkillPermissions).where(and(eq(userSkillPermissions.userId, userId), eq(userSkillPermissions.skillId, skillId)));
  }
  await audit(db, { actor, action: granted ? "permission.granted" : "permission.revoked", targetType: "user", targetId: userId, details: { skillId, userEmail: u.email }, meta });
}

export async function getPublishedConfig(db: DB, skillId: string) {
  const skill = await getSkillOr404(db, skillId);
  if (!skill.publishedVersionId) return null;
  const v = await getVersionOr404(db, skill.publishedVersionId);
  return { skill, version: v, config: SkillConfig.parse(v.config) };
}
