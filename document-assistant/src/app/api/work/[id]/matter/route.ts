import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { selectMatter } from "@/server/services/work";

export const POST = apiRoute<{ id: string }>({}, async ({ db, actor, params, req, meta }) => {
  const { matterId } = await readJson(req, z.object({ matterId: z.string().min(1).max(100) }));
  return selectMatter(db, actor, params.id, matterId, meta);
});
