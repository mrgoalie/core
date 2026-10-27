import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { submitForReview } from "@/server/services/work";

export const POST = apiRoute<{ id: string }>({}, async ({ db, actor, params, req, meta }) => {
  const body = await readJson(req, z.object({ reviewerId: z.string().uuid().nullable().optional(), note: z.string().max(2000).optional() }));
  await submitForReview(db, actor, params.id, body, meta);
  return { ok: true };
});
