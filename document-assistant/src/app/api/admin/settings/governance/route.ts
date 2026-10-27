import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { acknowledgeGovernance } from "@/server/services/admin";

export const POST = apiRoute({ roles: ["SYSTEM_ADMIN"] }, async ({ db, actor, req, meta }) => {
  await acknowledgeGovernance(db, actor, await readJson(req, z.unknown()), meta);
  return { ok: true };
});
