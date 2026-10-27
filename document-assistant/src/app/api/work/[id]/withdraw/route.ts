import { apiRoute } from "@/server/http";
import { withdrawSubmission } from "@/server/services/work";

export const POST = apiRoute<{ id: string }>({}, async ({ db, actor, params, meta }) => {
  await withdrawSubmission(db, actor, params.id, meta);
  return { ok: true };
});
