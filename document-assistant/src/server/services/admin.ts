/** Templates, activity log, system settings and the emergency stop. */
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { audit, type RequestMeta } from "../audit";
import { isAnyAdmin, isFirmAdmin, isSystemAdmin, type Actor } from "../auth/permissions";
import { getConfig } from "../config";
import type { DB } from "../db/client";
import { aiExecutions, auditLogs, documentTemplates, skillVersions, users } from "../db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { libreOfficeAvailable } from "../documents/convert";
import { screenUpload, sanitizeFileName } from "../documents/intake";
import { inspectTemplate } from "../documents/templates";
import { getCaseAdapter } from "../integrations/clio";
import { describeProvider } from "../integrations/ai/service";
import { getSetting, setSetting, SETTING_SCHEMAS } from "../settings";
import { getStorage, newStorageKey, sha256 } from "../storage";

// ---------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------

export async function listTemplates(db: DB) {
  const rows = await db.select({ t: documentTemplates, by: users.displayName }).from(documentTemplates).leftJoin(users, eq(users.id, documentTemplates.uploadedBy)).orderBy(desc(documentTemplates.createdAt));
  const versions = await db.select({ config: skillVersions.config, status: skillVersions.status }).from(skillVersions);
  return rows.map(({ t, by }) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    purpose: t.purpose,
    isDemonstration: t.isDemonstration,
    fileName: t.fileName,
    sizeBytes: t.sizeBytes,
    placeholders: t.placeholders,
    hasBody: t.placeholders.includes("@body"),
    status: t.status,
    uploadedBy: by,
    createdAt: t.createdAt,
    usedBy: versions.filter((v) => (v.config as { output?: { templateId?: string } }).output?.templateId === t.id && v.status !== "archived").length,
  }));
}

export async function uploadTemplate(db: DB, actor: Actor, file: { name: string; bytes: Buffer }, info: { name: string; description?: string; replacesTemplateId?: string | null }, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const fileName = sanitizeFileName(file.name);
  if (!fileName.toLowerCase().endsWith(".docx")) throw new ValidationError("Templates must be Word documents (.docx).");
  const scan = await screenUpload(file.bytes, fileName);
  if (!scan.ok || scan.kind !== "docx") throw new ValidationError(scan.reason ?? "This template could not be accepted.");
  const inspection = inspectTemplate(file.bytes);
  const name = info.name.trim() || fileName.replace(/\.docx$/i, "");
  const key = newStorageKey("templates", "docx");
  await getStorage().put(key, file.bytes);
  const [row] = await db
    .insert(documentTemplates)
    .values({
      name: name.slice(0, 120),
      description: info.description?.slice(0, 500) || null,
      purpose: "general",
      isDemonstration: false,
      storageKey: key,
      fileName,
      sizeBytes: file.bytes.length,
      sha256: sha256(file.bytes),
      placeholders: inspection.placeholders,
      replacesTemplateId: info.replacesTemplateId ?? null,
      uploadedBy: actor.id,
    })
    .returning();
  await audit(db, { actor, action: "template.uploaded", targetType: "template", targetId: row.id, details: { name, placeholders: inspection.placeholders.length, hasBody: inspection.hasBody }, meta });
  return { templateId: row.id, ...inspection };
}

export async function setTemplateArchived(db: DB, actor: Actor, templateId: string, archived: boolean, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const [t] = await db.select().from(documentTemplates).where(eq(documentTemplates.id, templateId));
  if (!t) throw new NotFoundError();
  await db.update(documentTemplates).set({ status: archived ? "archived" : "active" }).where(eq(documentTemplates.id, templateId));
  await audit(db, { actor, action: archived ? "template.archived" : "template.restored", targetType: "template", targetId: templateId, meta });
}

export async function downloadTemplate(db: DB, actor: Actor, templateId: string) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const [t] = await db.select().from(documentTemplates).where(eq(documentTemplates.id, templateId));
  if (!t) throw new NotFoundError();
  return { bytes: await getStorage().get(t.storageKey), fileName: t.fileName };
}

// ---------------------------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------------------------

export const ActivityFilter = z.object({
  q: z.string().max(100).optional(),
  actorId: z.string().uuid().optional(),
  outcome: z.enum(["success", "denied", "failure"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export async function listActivity(db: DB, actor: Actor, filter: z.infer<typeof ActivityFilter>) {
  if (!isAnyAdmin(actor)) throw new ForbiddenError();
  const conds = [];
  if (filter.q) conds.push(or(ilike(auditLogs.action, `%${filter.q}%`), ilike(auditLogs.actorEmail, `%${filter.q}%`), ilike(auditLogs.targetId, `%${filter.q}%`)));
  if (filter.actorId) conds.push(eq(auditLogs.actorId, filter.actorId));
  if (filter.outcome) conds.push(eq(auditLogs.outcome, filter.outcome));
  if (filter.from) conds.push(gte(auditLogs.at, new Date(filter.from)));
  if (filter.to) conds.push(lte(auditLogs.at, new Date(`${filter.to}T23:59:59`)));
  const pageSize = 50;
  const rows = await db
    .select()
    .from(auditLogs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogs.at))
    .limit(pageSize + 1)
    .offset((filter.page - 1) * pageSize);
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize, page: filter.page };
}

export async function aiUsageSummary(db: DB) {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [m] = await db
    .select({
      runs: sql<number>`count(*)::int`,
      failures: sql<number>`count(*) filter (where ${aiExecutions.status} <> 'success')::int`,
      inputTokens: sql<number>`coalesce(sum(${aiExecutions.inputTokens}),0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiExecutions.outputTokens}),0)::int`,
      cost: sql<number>`coalesce(sum(${aiExecutions.costMicroUsd}),0)::bigint`,
    })
    .from(aiExecutions)
    .where(gte(aiExecutions.createdAt, monthStart));
  return { ...m, costUsd: Number(m.cost) / 1_000_000 };
}

// ---------------------------------------------------------------------------------------------
// Settings and emergency stop
// ---------------------------------------------------------------------------------------------

export async function settingsOverview(db: DB, actor: Actor) {
  if (!isAnyAdmin(actor)) throw new ForbiddenError();
  const c = getConfig();
  const adapter = await getCaseAdapter();
  return {
    generation: await getSetting(db, "generation"),
    ai: await getSetting(db, "ai"),
    aiStatus: await describeProvider(db),
    aiUsage: await aiUsageSummary(db),
    review: await getSetting(db, "review"),
    retention: await getSetting(db, "retention"),
    clio: await getSetting(db, "clio"),
    environment: {
      appEnv: c.APP_ENV,
      authMode: c.AUTH_MODE,
      entraConfigured: Boolean(c.ENTRA_TENANT_ID && c.ENTRA_CLIENT_ID && c.ENTRA_CLIENT_SECRET),
      caseManagement: adapter.label,
      caseManagementVerified: adapter.verified,
      clioConfigured: Boolean(c.CLIO_CLIENT_ID && c.CLIO_CLIENT_SECRET),
      storage: c.STORAGE_DRIVER === "azure-blob" ? "Azure Blob Storage (encrypted)" : "Local disk (encrypted)",
      database: c.DATABASE_URL.startsWith("pglite:") ? "Embedded PostgreSQL (development)" : "PostgreSQL",
      scanner: c.MALWARE_SCANNER === "clamav" ? "ClamAV + built-in checks" : "Built-in checks (file type, active content, test signature)",
      pdfConverter: (await libreOfficeAvailable()) ? "LibreOffice (faithful to Word template)" : "Built-in PDF renderer (approximate)",
      ocr: "Not enabled — images and scanned PDFs are flagged for manual review",
    },
    canEditSystem: isSystemAdmin(actor),
  };
}

export async function setGenerationSuspended(db: DB, actor: Actor, suspended: boolean, reason: string, meta?: RequestMeta) {
  if (!isFirmAdmin(actor) && !isSystemAdmin(actor)) throw new ForbiddenError();
  if (suspended && !reason.trim()) throw new ValidationError("Please give a short reason. Employees will see it.");
  await setSetting(db, "generation", { suspended, reason: suspended ? reason.trim().slice(0, 500) : "", changedBy: actor.email, changedAt: new Date().toISOString() }, actor.id);
  await audit(db, { actor, action: suspended ? "generation.suspended" : "generation.resumed", targetType: "system", details: { reason: reason.slice(0, 200) }, meta });
}

const SystemSettingsInput = z.object({
  ai: SETTING_SCHEMAS.ai.unwrap().omit({ governance: true }).partial().optional(),
  review: SETTING_SCHEMAS.review.unwrap().partial().optional(),
  retention: SETTING_SCHEMAS.retention.unwrap().partial().optional(),
  clio: SETTING_SCHEMAS.clio.unwrap().partial().optional(),
});

export async function updateSystemSettings(db: DB, actor: Actor, input: unknown, meta?: RequestMeta) {
  if (!isSystemAdmin(actor)) throw new ForbiddenError("Only a System Administrator can change technical settings.");
  const patch = SystemSettingsInput.parse(input);
  if (patch.ai) {
    const current = await getSetting(db, "ai");
    const next = { ...current, ...patch.ai };
    if (next.provider !== "demo" && !getConfig().ANTHROPIC_API_KEY) throw new ConflictError("Add the provider's API key to the server configuration (Key Vault) before selecting it.");
    if (next.provider !== current.provider) next.governance = null; // a new provider needs its own review
    await setSetting(db, "ai", next, actor.id);
  }
  if (patch.review) await setSetting(db, "review", { ...(await getSetting(db, "review")), ...patch.review }, actor.id);
  if (patch.retention) await setSetting(db, "retention", { ...(await getSetting(db, "retention")), ...patch.retention }, actor.id);
  if (patch.clio) await setSetting(db, "clio", { ...(await getSetting(db, "clio")), ...patch.clio }, actor.id);
  await audit(db, { actor, action: "settings.updated", targetType: "system", details: { sections: Object.keys(patch) }, meta });
}

export const GovernanceInput = z.object({
  dataRetention: z.literal(true, { message: "Confirm the data-retention terms were reviewed." }),
  noTrainingOnData: z.literal(true, { message: "Confirm the provider does not train on firm data." }),
  contractInPlace: z.literal(true, { message: "Confirm the contract / data-processing terms are in place." }),
  securityReviewed: z.literal(true, { message: "Confirm the security controls were reviewed." }),
  notes: z.string().max(1000).optional(),
});

/** Records the data-governance review required before a real AI provider may receive client data. */
export async function acknowledgeGovernance(db: DB, actor: Actor, input: unknown, meta?: RequestMeta) {
  if (!isSystemAdmin(actor)) throw new ForbiddenError();
  const g = GovernanceInput.parse(input);
  const current = await getSetting(db, "ai");
  if (current.provider === "demo") throw new ConflictError("Select the AI provider first.");
  await setSetting(db, "ai", { ...current, governance: { ...g, acknowledgedBy: actor.email, acknowledgedAt: new Date().toISOString() } }, actor.id);
  await audit(db, { actor, action: "ai.governance_acknowledged", targetType: "system", details: { provider: current.provider, model: current.model }, meta });
}
