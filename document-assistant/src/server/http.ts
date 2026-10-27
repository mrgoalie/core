import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { audit, type RequestMeta } from "./audit";
import type { Actor } from "./auth/permissions";
import { resolveSession, sessionCookieName } from "./auth/session";
import { getConfig } from "./config";
import { getDb, type DB } from "./db/client";
import type { Role } from "./db/schema";
import { AppError, ForbiddenError, NotSignedInError, ValidationError } from "./errors";
import { checkRateLimit } from "./rate-limit";

export interface ApiContext<P> {
  req: NextRequest;
  actor: Actor;
  params: P;
  db: DB;
  meta: RequestMeta;
}

export interface PublicApiContext<P> extends Omit<ApiContext<P>, "actor"> {
  actor: Actor | null;
}

interface RateRule {
  name: string;
  limit: number;
  windowMs?: number;
}

interface Options {
  roles?: Role[];
  rate?: RateRule;
}

export function requestMeta(req: NextRequest): RequestMeta {
  const trust = getConfig().TRUST_PROXY_HEADERS;
  const fwd = trust ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  return { ip: fwd || req.headers.get("x-real-ip") || null, userAgent: req.headers.get("user-agent") };
}

/**
 * Cross-site request forgery defence for state-changing requests: the browser's Origin must be
 * this application, or (for non-browser clients) a custom header that cross-site pages cannot set
 * without a CORS pre-flight, which this application never grants.
 */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) {
    if (req.headers.get("x-requested-with") === "fda") return;
    throw new ForbiddenError("This request was blocked for your security. Please reload the page and try again.");
  }
  const allowed = new Set<string>([new URL(getConfig().APP_BASE_URL).origin]);
  const host = req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
    allowed.add(`${proto}://${host}`);
  }
  if (!allowed.has(origin)) {
    throw new ForbiddenError("This request was blocked for your security. Please reload the page and try again.");
  }
}

function formatZod(err: ZodError) {
  return err.issues.slice(0, 8).map((i) => ({ field: i.path.join("."), message: i.message }));
}

export function errorResponse(err: unknown) {
  if (err instanceof AppError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "invalid", message: "Some information is missing or not in the expected format.", details: formatZod(err) } },
      { status: 400 },
    );
  }
  const errorId = crypto.randomBytes(4).toString("hex");
  console.error(`[api] unexpected error ${errorId}:`, (err as Error)?.stack ?? err);
  return NextResponse.json(
    { error: { code: "server_error", message: `Something went wrong on our side. Please try again. (Reference ${errorId})` } },
    { status: 500 },
  );
}

async function runGuards(req: NextRequest, db: DB, opts: Options, requireActor: boolean) {
  const meta = requestMeta(req);
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) assertSameOrigin(req);
  const token = req.cookies.get(sessionCookieName())?.value;
  const actor = await resolveSession(db, token);
  if (requireActor && !actor) throw new NotSignedInError();
  if (actor && opts.roles && !opts.roles.some((r) => actor.roles.includes(r))) {
    await audit(db, {
      actor,
      action: "access.denied",
      outcome: "denied",
      targetType: "route",
      targetId: req.nextUrl.pathname,
      details: { method: req.method, requiredRoles: opts.roles },
      meta,
    });
    throw new ForbiddenError();
  }
  const rate = opts.rate ?? { name: "api", limit: 300, windowMs: 60_000 };
  checkRateLimit(`${rate.name}:${actor?.id ?? meta.ip ?? "anon"}`, rate.limit, rate.windowMs ?? 60_000);
  return { actor, meta };
}

type Handler<P, C> = (ctx: C) => Promise<unknown>;
type NextCtx<P> = { params: Promise<P> };

/** Wraps an authenticated JSON API route with sign-in, role, origin and rate-limit checks. */
export function apiRoute<P = Record<string, string>>(opts: Options, handler: Handler<P, ApiContext<P>>) {
  return async (req: NextRequest, ctx: NextCtx<P>) => {
    try {
      const db = await getDb();
      const { actor, meta } = await runGuards(req, db, opts, true);
      const params = ((await ctx?.params) ?? {}) as P;
      const result = await handler({ req, actor: actor!, params, db, meta });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Routes reachable before sign-in (sign-in itself, health checks). Still origin- and rate-limited. */
export function publicRoute<P = Record<string, string>>(opts: Options, handler: Handler<P, PublicApiContext<P>>) {
  return async (req: NextRequest, ctx: NextCtx<P>) => {
    try {
      const db = await getDb();
      const { actor, meta } = await runGuards(req, db, opts, false);
      const params = ((await ctx?.params) ?? {}) as P;
      const result = await handler({ req, actor, params, db, meta });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson<T extends z.ZodType>(req: NextRequest, schema: T, maxBytes = 1_000_000): Promise<z.infer<T>> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new ValidationError("That request is too large.");
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > maxBytes) throw new ValidationError("That request is too large.");
    raw = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new ValidationError("The request could not be read.");
  }
  return schema.parse(raw);
}

export function fileResponse(bytes: Uint8Array, fileName: string, mimeType: string, inline = false) {
  const safe = fileName.replace(/[^\w.\- ()]/g, "_");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safe}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
