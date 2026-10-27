import crypto from "node:crypto";
import { and, eq, lt, or } from "drizzle-orm";
import { getConfig } from "../config";
import type { DB } from "../db/client";
import { authSessions, userRoles, users, type Role } from "../db/schema";
import type { Actor } from "./permissions";

export function sessionCookieName() {
  return getConfig().secureCookies ? "__Host-fda_session" : "fda_session";
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: DB,
  userId: string,
  method: "entra" | "development",
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const config = getConfig();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.SESSION_ABSOLUTE_HOURS * 3600_000);
  const [row] = await db
    .insert(authSessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      authMethod: method,
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      expiresAt,
    })
    .returning({ id: authSessions.id });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  return { token, sessionId: row.id, expiresAt };
}

/**
 * Resolves a session token to an Actor. Every protected request calls this, so suspending an
 * employee (which deletes their sessions and flips their status) takes effect immediately.
 */
export async function resolveSession(db: DB, token: string | undefined | null): Promise<Actor | null> {
  if (!token || token.length > 200) return null;
  const config = getConfig();
  const rows = await db
    .select({ session: authSessions, user: users })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(eq(authSessions.tokenHash, hashToken(token)))
    .limit(1);
  const hit = rows[0];
  if (!hit) return null;
  const now = Date.now();
  const idleLimit = hit.session.lastSeenAt.getTime() + config.SESSION_IDLE_MINUTES * 60_000;
  if (hit.session.expiresAt.getTime() < now || idleLimit < now || hit.user.status !== "active") {
    await db.delete(authSessions).where(eq(authSessions.id, hit.session.id));
    return null;
  }
  if (now - hit.session.lastSeenAt.getTime() > 60_000) {
    await db.update(authSessions).set({ lastSeenAt: new Date(now) }).where(eq(authSessions.id, hit.session.id));
  }
  const roles = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, hit.user.id));
  return {
    id: hit.user.id,
    email: hit.user.email,
    displayName: hit.user.displayName,
    roles: roles.map((r) => r.role as Role),
    sessionId: hit.session.id,
  };
}

export async function destroySession(db: DB, token: string) {
  await db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(token)));
}

export async function destroyAllSessionsForUser(db: DB, userId: string) {
  const deleted = await db.delete(authSessions).where(eq(authSessions.userId, userId)).returning({ id: authSessions.id });
  return deleted.length;
}

export async function purgeExpiredSessions(db: DB) {
  const config = getConfig();
  const idleCutoff = new Date(Date.now() - config.SESSION_IDLE_MINUTES * 60_000);
  await db.delete(authSessions).where(or(lt(authSessions.expiresAt, new Date()), lt(authSessions.lastSeenAt, idleCutoff)));
}

export async function loadActor(db: DB, userId: string): Promise<Actor | null> {
  const [u] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.status, "active")));
  if (!u) return null;
  const roles = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, u.id));
  return { id: u.id, email: u.email, displayName: u.displayName, roles: roles.map((r) => r.role as Role) };
}
