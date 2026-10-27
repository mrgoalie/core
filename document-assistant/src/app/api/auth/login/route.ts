import { NextResponse } from "next/server";
import { beginEntraLogin, safeReturnTo } from "@/server/auth/entra";
import { getConfig } from "@/server/config";
import { publicRoute } from "@/server/http";

export const GET = publicRoute({ rate: { name: "login", limit: 30 } }, async ({ req, db }) => {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  if (getConfig().AUTH_MODE !== "entra") return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(returnTo)}`, getConfig().APP_BASE_URL));
  return NextResponse.redirect(await beginEntraLogin(db, returnTo));
});
