import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { requestGeneration, requestRerender } from "@/server/services/work";

export const POST = apiRoute<{ id: string }>({ rate: { name: "generate", limit: 20 } }, async ({ db, actor, params, req, meta }) => {
  const { mode } = await readJson(req, z.object({ mode: z.enum(["draft", "rerender"]).default("draft") }));
  return mode === "rerender" ? requestRerender(db, actor, params.id, meta) : requestGeneration(db, actor, params.id, meta);
});
