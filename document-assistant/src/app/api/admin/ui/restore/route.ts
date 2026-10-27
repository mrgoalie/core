import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { restoreUi } from "@/server/services/ui";

export const POST = apiRoute({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, req, meta }) => {
  const { versionId } = await readJson(req, z.object({ versionId: z.string().uuid() }));
  return restoreUi(db, actor, versionId, meta);
});
