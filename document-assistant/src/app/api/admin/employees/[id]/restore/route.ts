import { apiRoute } from "@/server/http";
import { restoreEmployee } from "@/server/services/users";

export const POST = apiRoute<{ id: string }>({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, params, meta }) => {
  await restoreEmployee(db, actor, params.id, meta);
  return { ok: true };
});
