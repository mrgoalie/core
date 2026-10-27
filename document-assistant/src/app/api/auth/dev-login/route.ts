import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import { devLoginAllowed, setSessionCookie } from "@/server/auth/cookies";
import { createSession } from "@/server/auth/session";
import { users } from "@/server/db/schema";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { publicRoute, readJson } from "@/server/http";

/** Development-only sign-in for fictional test employees. Disabled whenever Entra is configured or in production. */
export const POST = publicRoute({ rate: { name: "login", limit: 30 } }, async ({ req, db, meta }) => {
  if (!devLoginAllowed()) throw new NotFoundError();
  const { email } = await readJson(req, z.object({ email: z.string().email() }));
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  if (!user) throw new NotFoundError("No employee with that email.");
  if (user.status !== "active") {
    await audit(db, { actor: user, action: "login.denied", outcome: "denied", details: { reason: "suspended", method: "development" }, meta });
    throw new ForbiddenError("This employee's access is suspended.");
  }
  const s = await createSession(db, user.id, "development", meta);
  await audit(db, { actor: user, action: "login.success", details: { method: "development" }, meta });
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, s.token, s.expiresAt);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return res;
});

export const GET = publicRoute({}, async ({ db }) => {
  if (!devLoginAllowed()) throw new NotFoundError();
  const rows = await db.select({ email: users.email, displayName: users.displayName, jobTitle: users.jobTitle, status: users.status }).from(users).orderBy(users.displayName);
  return { users: rows };
});
