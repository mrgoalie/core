import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { reorderExhibits } from "@/server/services/work";

export const PUT = apiRoute<{ id: string }>({}, async ({ db, actor, params, req }) => {
  const { order } = await readJson(req, z.object({ order: z.array(z.string().uuid()).max(500) }));
  await reorderExhibits(db, actor, params.id, order);
  return { ok: true };
});
