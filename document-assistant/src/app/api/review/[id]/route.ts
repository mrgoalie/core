import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { decide } from "@/server/services/review";

export const POST = apiRoute<{ id: string }>({ roles: ["ATTORNEY_REVIEWER"] }, async ({ db, actor, params, req, meta }) => {
  const body = await readJson(req, z.object({ decision: z.enum(["approve", "request_changes"]), comments: z.string().max(4000).optional() }));
  return decide(db, actor, params.id, body, meta);
});
