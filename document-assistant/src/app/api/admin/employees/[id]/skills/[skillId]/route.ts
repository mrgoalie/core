import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { setPermission } from "@/server/services/skills";

export const PUT = apiRoute<{ id: string; skillId: string }>({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, params, req, meta }) => {
  const { granted } = await readJson(req, z.object({ granted: z.boolean() }));
  await setPermission(db, actor, params.id, params.skillId, granted, meta);
  return { ok: true };
});
