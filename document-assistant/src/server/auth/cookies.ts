import type { NextResponse } from "next/server";
import { getConfig } from "../config";
import { sessionCookieName } from "./session";

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: getConfig().secureCookies,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(sessionCookieName(), "", { httpOnly: true, secure: getConfig().secureCookies, sameSite: "lax", path: "/", maxAge: 0 });
}

export const devLoginAllowed = () => getConfig().AUTH_MODE === "development" && !getConfig().isProduction;
