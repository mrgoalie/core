import { sql } from "drizzle-orm";
import { publicRoute } from "@/server/http";

/** Liveness/readiness probe for Azure App Service health checks. Reveals no data. */
export const GET = publicRoute({ rate: { name: "health", limit: 120 } }, async ({ db }) => {
  await db.execute(sql`select 1`);
  return { ok: true };
});
