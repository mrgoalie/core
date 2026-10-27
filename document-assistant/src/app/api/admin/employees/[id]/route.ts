import { z } from "zod";
import { assignableRoles } from "@/server/auth/permissions";
import { ROLES } from "@/server/db/schema";
import { apiRoute, readJson } from "@/server/http";
import { listSkillsForAdmin } from "@/server/services/skills";
import { employeeDetail, updateEmployee } from "@/server/services/users";

type P = { id: string };

export const GET = apiRoute<P>({ roles: ["FIRM_ADMIN", "SYSTEM_ADMIN"] }, async ({ db, actor, params }) => ({
  employee: await employeeDetail(db, params.id),
  skills: (await listSkillsForAdmin(db)).filter((s) => !s.archived).map((s) => ({ id: s.id, name: s.name, published: Boolean(s.publishedVersion), enabled: s.enabled })),
  assignableRoles: assignableRoles(actor),
  isSelf: actor.id === params.id,
}));

export const PATCH = apiRoute<P>({ roles: ["FIRM_ADMIN", "SYSTEM_ADMIN"] }, async ({ db, actor, params, req, meta }) => {
  const body = await readJson(req, z.object({ displayName: z.string().max(120).optional(), jobTitle: z.string().max(120).nullable().optional(), roles: z.array(z.enum(ROLES)).optional() }));
  await updateEmployee(db, actor, params.id, body, meta);
  return { ok: true };
});
