import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { suspendEmployee } from "@/server/services/users";

export const POST = apiRoute<{ id: string }>({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, params, req, meta }) => {
  const { reason } = await readJson(req, z.object({ reason: z.string().max(500).default("") }));
  return suspendEmployee(db, actor, params.id, reason, meta);
});
