/**
 * Interface Editor back end: draft → preview → publish, with version history and restore.
 * The home screen is always assembled on the server from the published configuration AND the
 * viewer's own permissions, so configuration can never expose a skill someone may not use.
 */
import { desc, eq, inArray, max } from "drizzle-orm";
import { defaultUiConfig, UiConfig, type SkillPresentation } from "@/lib/ui-config";
import { audit, type RequestMeta } from "../audit";
import { isFirmAdmin, type Actor } from "../auth/permissions";
import type { DB } from "../db/client";
import { brandingAssets, skills, uiConfigVersions, users } from "../db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { getStorage, newStorageKey, sha256 } from "../storage";
import { employeeSkills } from "./skills";
import { listMyWork } from "./work";

export function parseUi(input: unknown): UiConfig {
  const r = UiConfig.safeParse(input);
  if (!r.success) {
    throw new ValidationError(
      "Some settings need attention before they can be saved.",
      r.error.issues.slice(0, 10).map((i) => ({ field: i.path.join("."), message: i.message })),
    );
  }
  return r.data;
}

export async function getPublishedUi(db: DB): Promise<UiConfig> {
  const [row] = await db.select().from(uiConfigVersions).where(eq(uiConfigVersions.status, "published")).limit(1);
  const parsed = UiConfig.safeParse(row?.config);
  return parsed.success ? parsed.data : defaultUiConfig();
}

async function nextNumber(db: DB) {
  const [{ n }] = await db.select({ n: max(uiConfigVersions.versionNumber) }).from(uiConfigVersions);
  return (n ?? 0) + 1;
}

export async function getDraftUi(db: DB, actor: Actor) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const [draft] = await db.select().from(uiConfigVersions).where(eq(uiConfigVersions.status, "draft")).limit(1);
  if (draft) return { versionId: draft.id, versionNumber: draft.versionNumber, config: parseUi(draft.config), updatedAt: draft.updatedAt, isNew: false };
  const published = await getPublishedUi(db);
  return { versionId: null, versionNumber: null, config: published, updatedAt: null, isNew: true };
}

async function validateSkillRefs(db: DB, cfg: UiConfig) {
  const ids = cfg.skills.map((s) => s.skillId);
  if (!ids.length) return;
  const found = await db.select({ id: skills.id }).from(skills).where(inArray(skills.id, ids));
  const known = new Set(found.map((f) => f.id));
  cfg.skills = cfg.skills.filter((s) => known.has(s.skillId));
  const catIds = new Set(cfg.categories.map((c) => c.id));
  for (const s of cfg.skills) if (s.categoryId && !catIds.has(s.categoryId)) s.categoryId = undefined;
  if (cfg.branding.logoAssetId) {
    const [logo] = await db.select({ id: brandingAssets.id }).from(brandingAssets).where(eq(brandingAssets.id, cfg.branding.logoAssetId));
    if (!logo) throw new ValidationError("The uploaded logo could not be found. Please upload it again.");
  }
}

export async function saveDraftUi(db: DB, actor: Actor, input: unknown, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const cfg = parseUi(input);
  await validateSkillRefs(db, cfg);
  const [draft] = await db.select().from(uiConfigVersions).where(eq(uiConfigVersions.status, "draft")).limit(1);
  let id: string;
  if (draft) {
    await db.update(uiConfigVersions).set({ config: cfg, createdBy: actor.id, updatedAt: new Date() }).where(eq(uiConfigVersions.id, draft.id));
    id = draft.id;
  } else {
    const [row] = await db.insert(uiConfigVersions).values({ versionNumber: await nextNumber(db), status: "draft", config: cfg, createdBy: actor.id }).returning();
    id = row.id;
    await audit(db, { actor, action: "ui.draft_started", targetType: "ui_config", targetId: id, meta });
  }
  return { versionId: id, savedAt: new Date().toISOString() };
}

export async function publishUi(db: DB, actor: Actor, note: string | undefined, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const [draft] = await db.select().from(uiConfigVersions).where(eq(uiConfigVersions.status, "draft")).limit(1);
  if (!draft) throw new ConflictError("There are no unpublished changes.");
  const cfg = parseUi(draft.config);
  await validateSkillRefs(db, cfg);
  await db.update(uiConfigVersions).set({ status: "archived", updatedAt: new Date() }).where(eq(uiConfigVersions.status, "published"));
  await db
    .update(uiConfigVersions)
    .set({ status: "published", config: cfg, publishedBy: actor.id, publishedAt: new Date(), note: note?.slice(0, 300) || null, updatedAt: new Date() })
    .where(eq(uiConfigVersions.id, draft.id));
  await audit(db, { actor, action: "ui.published", targetType: "ui_config", targetId: draft.id, details: { version: draft.versionNumber }, meta });
  return { versionNumber: draft.versionNumber };
}

export async function discardDraftUi(db: DB, actor: Actor, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  await db.delete(uiConfigVersions).where(eq(uiConfigVersions.status, "draft"));
  await audit(db, { actor, action: "ui.draft_discarded", targetType: "ui_config", meta });
}

export async function listUiVersions(db: DB) {
  const rows = await db
    .select({ v: uiConfigVersions, by: users.displayName })
    .from(uiConfigVersions)
    .leftJoin(users, eq(users.id, uiConfigVersions.publishedBy))
    .orderBy(desc(uiConfigVersions.versionNumber));
  return rows.map(({ v, by }) => ({ id: v.id, number: v.versionNumber, status: v.status, publishedAt: v.publishedAt, publishedBy: by, note: v.note, restoredFrom: v.restoredFromVersionId }));
}

/** Restores an earlier published layout by publishing a copy of it as a new version. */
export async function restoreUi(db: DB, actor: Actor, versionId: string, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const [target] = await db.select().from(uiConfigVersions).where(eq(uiConfigVersions.id, versionId));
  if (!target || target.status === "draft" || !target.publishedAt) throw new NotFoundError();
  const cfg = parseUi(target.config);
  await validateSkillRefs(db, cfg);
  await db.delete(uiConfigVersions).where(eq(uiConfigVersions.status, "draft"));
  await db.update(uiConfigVersions).set({ status: "archived", updatedAt: new Date() }).where(eq(uiConfigVersions.status, "published"));
  const [row] = await db
    .insert(uiConfigVersions)
    .values({ versionNumber: await nextNumber(db), status: "published", config: cfg, createdBy: actor.id, publishedBy: actor.id, publishedAt: new Date(), note: `Restored version ${target.versionNumber}`, restoredFromVersionId: target.id })
    .returning();
  await audit(db, { actor, action: "ui.restored", targetType: "ui_config", targetId: row.id, details: { from: target.versionNumber }, meta });
  return { versionNumber: row.versionNumber };
}

export async function resetBranding(db: DB, actor: Actor, meta?: RequestMeta) {
  const { config } = await getDraftUi(db, actor);
  const next = { ...config, branding: defaultUiConfig().branding };
  return saveDraftUi(db, actor, next, meta);
}

// ---------------------------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------------------------

export async function uploadLogo(db: DB, actor: Actor, bytes: Buffer, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  if (bytes.length > 1024 * 1024) throw new ValidationError("Please use a logo smaller than 1 MB.");
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpg) throw new ValidationError("Please upload the logo as a PNG or JPEG image.");
  const key = newStorageKey("branding", png ? "png" : "jpg");
  await getStorage().put(key, bytes);
  const [row] = await db.insert(brandingAssets).values({ kind: "logo", storageKey: key, mimeType: png ? "image/png" : "image/jpeg", sizeBytes: bytes.length, sha256: sha256(bytes), uploadedBy: actor.id }).returning();
  await audit(db, { actor, action: "ui.logo_uploaded", targetType: "branding_asset", targetId: row.id, meta });
  return { assetId: row.id };
}

export async function getLogo(db: DB, assetId: string) {
  const [row] = await db.select().from(brandingAssets).where(eq(brandingAssets.id, assetId));
  if (!row) throw new NotFoundError();
  return { bytes: await getStorage().get(row.storageKey), mimeType: row.mimeType };
}

// ---------------------------------------------------------------------------------------------
// Home screen assembly
// ---------------------------------------------------------------------------------------------

export interface HomeTile {
  skillId: string;
  label: string;
  description: string;
  icon: string;
  featured: boolean;
  category: string;
}

export function arrangeTiles(cfg: UiConfig, available: Awaited<ReturnType<typeof employeeSkills>>): HomeTile[] {
  const byId = new Map<string, SkillPresentation>(cfg.skills.map((s) => [s.skillId, s]));
  const order = new Map(cfg.skills.map((s, i) => [s.skillId, i]));
  return [...available]
    .sort((a, b) => (order.get(a.id) ?? 1000) - (order.get(b.id) ?? 1000) || a.name.localeCompare(b.name))
    .map((s) => {
      const p = byId.get(s.id);
      const cat = cfg.categories.find((c) => c.id === p?.categoryId)?.name ?? s.category ?? "Other";
      return { skillId: s.id, label: p?.label?.trim() || s.name, description: p?.description?.trim() || s.shortDescription, icon: p?.icon ?? s.icon, featured: p?.featured ?? true, category: cat };
    });
}

export async function homeFor(db: DB, actor: Actor) {
  const cfg = await getPublishedUi(db);
  const tiles = arrangeTiles(cfg, await employeeSkills(db, actor));
  const recent = cfg.home.showRecentWork ? await listMyWork(db, actor, { limit: cfg.home.recentWorkCount }) : [];
  return { ui: cfg, tiles, recent };
}

/** Admin preview: draft (or published) layout as seen by a chosen employee, with sample recent work. */
export async function previewHome(db: DB, actor: Actor, opts: { asUserId?: string; source: "draft" | "published" }) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const cfg = opts.source === "draft" ? (await getDraftUi(db, actor)).config : await getPublishedUi(db);
  let viewer: Actor = actor;
  if (opts.asUserId) {
    const [u] = await db.select().from(users).where(eq(users.id, opts.asUserId));
    if (!u) throw new NotFoundError();
    viewer = { id: u.id, email: u.email, displayName: u.displayName, roles: [] };
  }
  const tiles = arrangeTiles(cfg, await employeeSkills(db, viewer));
  const recent = cfg.home.showRecentWork
    ? [
        { id: "sample-1", title: "Example: Write a Demand Letter — Sample v. Example", status: "ready", matter: "Sample matter (preview only)", updatedAt: new Date(), skillId: "" },
        { id: "sample-2", title: "Example: Create an Arbitration Package — Sample claim", status: "submitted", matter: "Sample matter (preview only)", updatedAt: new Date(), skillId: "" },
      ].slice(0, cfg.home.recentWorkCount)
    : [];
  return { ui: cfg, tiles, recent, viewerName: viewer.displayName };
}
