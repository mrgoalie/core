import { apiRoute, readJson } from "@/server/http";
import { z } from "zod";
import { assignableRoles } from "@/server/auth/permissions";
import { createEmployee, listEmployees } from "@/server/services/users";
import { listSkillsForAdmin } from "@/server/services/skills";

export const GET = apiRoute({ roles: ["FIRM_ADMIN", "SYSTEM_ADMIN"] }, async ({ db, actor }) => ({
  employees: await listEmployees(db),
  skills: (await listSkillsForAdmin(db)).filter((s) => !s.archived).map((s) => ({ id: s.id, name: s.name, published: Boolean(s.publishedVersion), enabled: s.enabled })),
  assignableRoles: assignableRoles(actor),
}));

export const POST = apiRoute({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, req, meta }) => createEmployee(db, actor, await readJson(req, z.unknown()), meta));
