import { NextResponse } from "next/server";
import { setSessionCookie } from "@/server/auth/cookies";
import { completeEntraLogin } from "@/server/auth/entra";
import { getConfig } from "@/server/config";
import { AppError } from "@/server/errors";
import { publicRoute } from "@/server/http";

export const GET = publicRoute({ rate: { name: "login", limit: 30 } }, async ({ req, db, meta }) => {
  const base = getConfig().APP_BASE_URL;
  const p = req.nextUrl.searchParams;
  try {
    const s = await completeEntraLogin(db, { code: p.get("code"), state: p.get("state"), error: p.get("error") }, meta);
    const res = NextResponse.redirect(new URL(s.returnTo, base));
    setSessionCookie(res, s.token, s.expiresAt);
    return res;
  } catch (err) {
    const message = err instanceof AppError ? err.message : "Sign-in could not be completed. Please try again.";
    if (!(err instanceof AppError)) console.error("[auth] callback failed:", (err as Error).message);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, base));
  }
});
