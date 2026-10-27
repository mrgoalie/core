import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { listSkillsForAdmin } from "@/server/services/skills";
import { discardDraftUi, getDraftUi, getPublishedUi, listUiVersions, resetBranding, saveDraftUi } from "@/server/services/ui";
import { listEmployees } from "@/server/services/users";

export const GET = apiRoute({ roles: ["FIRM_ADMIN"] }, async ({ db, actor }) => ({
  draft: await getDraftUi(db, actor),
  published: await getPublishedUi(db),
  versions: await listUiVersions(db),
  skills: (await listSkillsForAdmin(db)).filter((s) => s.publishedVersion && !s.archived).map((s) => ({ id: s.id, name: s.name, shortDescription: s.shortDescription, icon: s.icon, category: s.category, enabled: s.enabled })),
  employees: (await listEmployees(db)).filter((e) => e.status === "active").map((e) => ({ id: e.id, displayName: e.displayName, skillIds: e.skillIds })),
}));

export const PUT = apiRoute({ roles: ["FIRM_ADMIN"], rate: { name: "autosave", limit: 240 } }, async ({ db, actor, req, meta }) => {
  const body = await readJson(req, z.object({ config: z.unknown().optional(), resetBranding: z.boolean().optional() }));
  if (body.resetBranding) return resetBranding(db, actor, meta);
  return saveDraftUi(db, actor, body.config, meta);
});

export const DELETE = apiRoute({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, meta }) => {
  await discardDraftUi(db, actor, meta);
  return { ok: true };
});
