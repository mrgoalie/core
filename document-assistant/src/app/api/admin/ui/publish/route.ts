import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { publishUi } from "@/server/services/ui";

export const POST = apiRoute({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, req, meta }) => {
  const { note } = await readJson(req, z.object({ note: z.string().max(300).optional() }));
  return publishUi(db, actor, note, meta);
});
