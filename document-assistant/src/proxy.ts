import { NextResponse, type NextRequest } from "next/server";

/**
 * Adds a per-request Content-Security-Policy nonce for pages and passes the path to layouts.
 * Authentication is NOT done here: every page and API route checks the session on the server.
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-src 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://login.microsoftonline.com",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [{ source: "/((?!api/|_next/static|_next/image|favicon.ico).*)" }],
};
