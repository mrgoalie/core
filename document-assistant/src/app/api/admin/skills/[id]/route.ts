import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { listTemplates } from "@/server/services/admin";
import { getSkillDetail, saveDraft, setSkillArchived, setSkillEnabled } from "@/server/services/skills";
import { listEmployees } from "@/server/services/users";

type P = { id: string };

export const GET = apiRoute<P>({ roles: ["FIRM_ADMIN", "ATTORNEY_REVIEWER"] }, async ({ db, params }) => ({
  ...(await getSkillDetail(db, params.id)),
  templates: (await listTemplates(db)).filter((t) => t.status === "active"),
  employees: (await listEmployees(db)).filter((e) => e.status === "active").map((e) => ({ id: e.id, displayName: e.displayName, jobTitle: e.jobTitle })),
}));

export const PUT = apiRoute<P>({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, params, req, meta }) => {
  const body = await readJson(req, z.object({ config: z.unknown(), changeSummary: z.string().max(500).optional() }), 2_000_000);
  return saveDraft(db, actor, params.id, body.config, body.changeSummary, meta);
});

export const PATCH = apiRoute<P>({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, params, req, meta }) => {
  const body = await readJson(req, z.object({ enabled: z.boolean().optional(), archived: z.boolean().optional() }));
  if (body.enabled !== undefined) await setSkillEnabled(db, actor, params.id, body.enabled, meta);
  if (body.archived !== undefined) await setSkillArchived(db, actor, params.id, body.archived, meta);
  return { ok: true };
});
