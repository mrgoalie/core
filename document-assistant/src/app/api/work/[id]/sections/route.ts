import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { saveSectionEdits } from "@/server/services/work";

export const PUT = apiRoute<{ id: string }>({ rate: { name: "autosave", limit: 240 } }, async ({ db, actor, params, req }) => {
  const { edits } = await readJson(req, z.object({ edits: z.record(z.string().max(40), z.string().max(20000).nullable()) }));
  return saveSectionEdits(db, actor, params.id, edits);
});
