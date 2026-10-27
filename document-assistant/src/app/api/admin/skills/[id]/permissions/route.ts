import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { setPermission } from "@/server/services/skills";

export const PUT = apiRoute<{ id: string }>({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, params, req, meta }) => {
  const { userId, granted } = await readJson(req, z.object({ userId: z.string().uuid(), granted: z.boolean() }));
  await setPermission(db, actor, userId, params.id, granted, meta);
  return { ok: true };
});
