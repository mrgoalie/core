import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getConfig } from "@/server/config";
import { authRequests } from "@/server/db/schema";
import { NotFoundError } from "@/server/errors";
import { safeReturnTo } from "@/server/auth/entra";
import { apiRoute } from "@/server/http";
import { getCaseAdapter } from "@/server/integrations/clio";
import { ClioAdapter } from "@/server/integrations/clio/live";

/** Starts the per-employee Clio connection (OAuth). Only used when CASE_MANAGEMENT=clio. */
export const GET = apiRoute({ rate: { name: "clio-connect", limit: 20 } }, async ({ db, actor, req }) => {
  const adapter = await getCaseAdapter();
  if (!(adapter instanceof ClioAdapter)) throw new NotFoundError();
  const state = crypto.randomBytes(24).toString("base64url");
  // Reuse the short-lived auth request table; codeVerifier holds the employee id this state belongs to.
  await db.insert(authRequests).values({ state, codeVerifier: `clio:${actor.id}`, nonce: "clio", returnTo: safeReturnTo(req.nextUrl.searchParams.get("returnTo")), expiresAt: new Date(Date.now() + 10 * 60_000) });
  return NextResponse.redirect(adapter.authorizeUrl(state));
});
