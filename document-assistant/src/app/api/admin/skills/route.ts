import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { createSkill, listSkillsForAdmin } from "@/server/services/skills";

export const GET = apiRoute({ roles: ["FIRM_ADMIN", "ATTORNEY_REVIEWER"] }, async ({ db }) => ({ skills: await listSkillsForAdmin(db) }));

export const POST = apiRoute({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, req, meta }) => {
  const { config } = await readJson(req, z.object({ config: z.unknown() }), 2_000_000);
  return createSkill(db, actor, config, meta);
});
