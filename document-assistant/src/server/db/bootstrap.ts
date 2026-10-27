/**
 * Idempotent baseline data: demonstration template, built-in skills, default interface,
 * bootstrap administrators and (development only) fictional demonstration employees.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { defaultUiConfig, UiConfig } from "@/lib/ui-config";
import { SkillConfig } from "@/lib/skill-config";
import { getConfig } from "../config";
import { buildDemonstrationTemplate, inspectTemplate } from "../documents/templates";
import { DEMO_USERS } from "../integrations/clio/mock-data";
import { BUILTIN_SKILLS } from "../skills/builtin";
import { getStorage, newStorageKey, sha256 } from "../storage";
import type { DB } from "./client";
import { documentTemplates, ROLES, skillVersions, skills, uiConfigVersions, userRoles, userSkillPermissions, users, type Role } from "./schema";

export async function ensureBaseline(db: DB, opts: { seedDemo?: boolean } = {}) {
  const config = getConfig();
  const seedDemo = opts.seedDemo ?? (process.env.SEED_DEMO_DATA !== undefined ? config.SEED_DEMO_DATA : !config.isProduction);

  // Demonstration Word template.
  const [tpl] = await db.select({ id: documentTemplates.id }).from(documentTemplates).where(eq(documentTemplates.isDemonstration, true)).limit(1);
  if (!tpl) {
    const bytes = await buildDemonstrationTemplate();
    const key = newStorageKey("templates", "docx");
    await getStorage().put(key, bytes);
    await db.insert(documentTemplates).values({
      name: "Demonstration Firm Template",
      description: "Clearly marked demonstration letterhead. Replace it with the firm's approved template.",
      purpose: "general",
      isDemonstration: true,
      storageKey: key,
      fileName: "demonstration-firm-template.docx",
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      placeholders: inspectTemplate(bytes).placeholders,
    });
  }

  // Built-in skills (published version 1).
  for (const b of BUILTIN_SKILLS) {
    const [existing] = await db.select({ id: skills.id }).from(skills).where(eq(skills.slug, b.slug));
    if (existing) continue;
    const cfg = SkillConfig.parse(b.config);
    const [s] = await db.insert(skills).values({ slug: b.slug, isBuiltIn: true }).returning();
    const [v] = await db
      .insert(skillVersions)
      .values({
        skillId: s.id,
        versionNumber: 1,
        status: "published",
        config: cfg,
        significance: "initial",
        changeSummary: "Initial demonstration skill shipped with the application",
        testStatus: "passed",
        testNotes: "Covered by the automated test suite using fictional matters.",
        approvalNotes: "Demonstration skill. The firm's attorneys should review and approve their own version before real use.",
        publishedAt: new Date(),
      })
      .returning();
    await db.update(skills).set({ publishedVersionId: v.id }).where(eq(skills.id, s.id));
  }

  // Default interface (version 1, published).
  const [ui] = await db.select({ id: uiConfigVersions.id }).from(uiConfigVersions).limit(1);
  if (!ui) {
    const all = await db.select({ id: skills.id, slug: skills.slug }).from(skills);
    const cfg: UiConfig = defaultUiConfig();
    cfg.categories = [
      { id: "personal-injury", name: "Personal Injury" },
      { id: "arbitration", name: "Arbitration" },
    ];
    cfg.skills = BUILTIN_SKILLS.map((b) => all.find((s) => s.slug === b.slug))
      .filter((s): s is { id: string; slug: string } => Boolean(s))
      .map((s) => ({ skillId: s.id, featured: true, categoryId: s.slug === "demand-letter" ? "personal-injury" : "arbitration" }));
    await db.insert(uiConfigVersions).values({ versionNumber: 1, status: "published", config: UiConfig.parse(cfg), publishedAt: new Date(), note: "Default layout" });
  }

  // Bootstrap administrators (the firm owner) from configuration.
  const admins = (config.BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  for (const email of admins) await ensureUser(db, { email, displayName: email.split("@")[0], jobTitle: "Administrator", roles: [...ROLES] });

  if (seedDemo) {
    const all = await db.select({ id: skills.id, slug: skills.slug }).from(skills);
    for (const u of DEMO_USERS) {
      const id = await ensureUser(db, { email: u.email, displayName: u.displayName, jobTitle: u.jobTitle, roles: [...u.roles] as Role[] });
      if (id.created) {
        const ids = all.filter((s) => (u.skills as readonly string[]).includes(s.slug)).map((s) => s.id);
        if (ids.length) await db.insert(userSkillPermissions).values(ids.map((skillId) => ({ userId: id.id, skillId }))).onConflictDoNothing();
      }
    }
  }
}

async function ensureUser(db: DB, u: { email: string; displayName: string; jobTitle: string; roles: Role[] }) {
  const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${u.email.toLowerCase()}`);
  if (existing) return { id: existing.id, created: false };
  const [row] = await db.insert(users).values({ email: u.email.toLowerCase(), displayName: u.displayName, jobTitle: u.jobTitle }).returning();
  const roles = [...new Set<Role>(["EMPLOYEE", ...u.roles])];
  await db.insert(userRoles).values(roles.map((role) => ({ userId: row.id, role }))).onConflictDoNothing();
  return { id: row.id, created: true };
}

export async function demoUserIds(db: DB) {
  const rows = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, DEMO_USERS.map((u) => u.email)));
  return Object.fromEntries(rows.map((r) => [r.email, r.id]));
}

