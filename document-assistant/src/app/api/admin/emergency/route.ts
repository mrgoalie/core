import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { setGenerationSuspended } from "@/server/services/admin";

export const POST = apiRoute({ roles: ["FIRM_ADMIN", "SYSTEM_ADMIN"] }, async ({ db, actor, req, meta }) => {
  const { suspended, reason } = await readJson(req, z.object({ suspended: z.boolean(), reason: z.string().max(500).default("") }));
  await setGenerationSuspended(db, actor, suspended, reason, meta);
  return { ok: true };
});
