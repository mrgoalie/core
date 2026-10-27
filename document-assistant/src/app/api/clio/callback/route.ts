import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { audit } from "@/server/audit";
import { getConfig } from "@/server/config";
import { authRequests } from "@/server/db/schema";
import { apiRoute } from "@/server/http";
import { getCaseAdapter } from "@/server/integrations/clio";
import { ClioAdapter } from "@/server/integrations/clio/live";

export const GET = apiRoute({ rate: { name: "clio-connect", limit: 20 } }, async ({ db, actor, req, meta }) => {
  const base = getConfig().APP_BASE_URL;
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const code = req.nextUrl.searchParams.get("code");
  const [row] = await db.delete(authRequests).where(eq(authRequests.state, state)).returning();
  const adapter = await getCaseAdapter();
  if (!row || row.codeVerifier !== `clio:${actor.id}` || row.expiresAt < new Date() || !code || !(adapter instanceof ClioAdapter)) {
    return NextResponse.redirect(new URL("/?clio=failed", base));
  }
  await adapter.exchangeCode(actor.id, code);
  await audit(db, { actor, action: "clio.connected", meta });
  return NextResponse.redirect(new URL(row.returnTo || "/", base));
});
