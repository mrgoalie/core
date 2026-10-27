import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { settingsOverview, updateSystemSettings } from "@/server/services/admin";

export const GET = apiRoute({ roles: ["FIRM_ADMIN", "SYSTEM_ADMIN"] }, async ({ db, actor }) => settingsOverview(db, actor));

export const PUT = apiRoute({ roles: ["SYSTEM_ADMIN"] }, async ({ db, actor, req, meta }) => {
  await updateSystemSettings(db, actor, await readJson(req, z.unknown()), meta);
  return { ok: true };
});
