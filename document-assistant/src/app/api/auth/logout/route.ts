import { NextResponse } from "next/server";
import { audit } from "@/server/audit";
import { clearSessionCookie } from "@/server/auth/cookies";
import { destroySession, sessionCookieName } from "@/server/auth/session";
import { publicRoute } from "@/server/http";

export const POST = publicRoute({}, async ({ req, db, actor, meta }) => {
  const token = req.cookies.get(sessionCookieName())?.value;
  if (token) await destroySession(db, token);
  if (actor) await audit(db, { actor, action: "logout", meta });
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
});
