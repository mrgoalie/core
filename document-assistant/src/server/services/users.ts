/** Employee administration. Suspension takes effect immediately on every protected request. */
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { audit, type RequestMeta } from "../audit";
import { assignableRoles, isFirmAdmin, ROLE_LABELS, type Actor } from "../auth/permissions";
import { destroyAllSessionsForUser } from "../auth/session";
import type { DB } from "../db/client";
import { auditLogs, clioConnections, ROLES, userRoles, userSkillPermissions, users, type Role } from "../db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";

export const NewEmployee = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid work email address.").max(200),
  displayName: z.string().trim().min(1, "Enter the person's name.").max(120),
  jobTitle: z.string().trim().max(120).optional(),
  roles: z.array(z.enum(ROLES)).default(["EMPLOYEE"]),
  skillIds: z.array(z.string().uuid()).default([]),
});

async function rolesOf(db: DB, userId: string) {
  return (await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId))).map((r) => r.role as Role);
}

async function activeFirmAdminCount(db: DB, excludeUserId?: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.role, "FIRM_ADMIN"), eq(users.status, "active"), excludeUserId ? ne(users.id, excludeUserId) : undefined));
  return n;
}

export async function listEmployees(db: DB) {
  const people = await db.select().from(users).orderBy(users.displayName);
  const roles = await db.select().from(userRoles);
  const perms = await db.select().from(userSkillPermissions);
  return people.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    jobTitle: u.jobTitle,
    status: u.status,
    lastLoginAt: u.lastLoginAt,
    roles: roles.filter((r) => r.userId === u.id).map((r) => r.role),
    skillIds: perms.filter((p) => p.userId === u.id).map((p) => p.skillId),
    entraLinked: Boolean(u.entraObjectId),
  }));
}

export async function employeeDetail(db: DB, userId: string) {
  const all = await listEmployees(db);
  const person = all.find((p) => p.id === userId);
  if (!person) throw new NotFoundError();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  const activity = await db
    .select()
    .from(auditLogs)
    .where(or(eq(auditLogs.actorId, userId), eq(auditLogs.targetId, userId)))
    .orderBy(desc(auditLogs.at))
    .limit(40);
  return { ...person, suspendedAt: u.suspendedAt, suspendedReason: u.suspendedReason, activity };
}

export async function createEmployee(db: DB, actor: Actor, input: unknown, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const data = NewEmployee.parse(input);
  const allowed = assignableRoles(actor);
  const roles = [...new Set<Role>(["EMPLOYEE", ...data.roles])];
  const bad = roles.filter((r) => !allowed.includes(r));
  if (bad.length) throw new ForbiddenError(`You can't give the ${bad.map((r) => ROLE_LABELS[r]).join(", ")} role.`);
  const [dupe] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${data.email}`);
  if (dupe) throw new ConflictError("Someone with that email address already exists.");
  const [u] = await db.insert(users).values({ email: data.email, displayName: data.displayName, jobTitle: data.jobTitle || null, createdBy: actor.id }).returning();
  await db.insert(userRoles).values(roles.map((role) => ({ userId: u.id, role, grantedBy: actor.id })));
  if (data.skillIds.length) await db.insert(userSkillPermissions).values(data.skillIds.map((skillId) => ({ userId: u.id, skillId, grantedBy: actor.id }))).onConflictDoNothing();
  await audit(db, { actor, action: "user.created", targetType: "user", targetId: u.id, details: { email: data.email, roles, skills: data.skillIds.length }, meta });
  return { userId: u.id };
}

export async function updateEmployee(db: DB, actor: Actor, userId: string, input: { displayName?: string; jobTitle?: string | null; roles?: Role[] }, meta?: RequestMeta) {
  if (!isFirmAdmin(actor) && !(input.roles && actor.roles.includes("SYSTEM_ADMIN"))) throw new ForbiddenError();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new NotFoundError();
  if (input.displayName !== undefined || input.jobTitle !== undefined) {
    if (!isFirmAdmin(actor)) throw new ForbiddenError();
    const displayName = input.displayName?.trim();
    if (displayName !== undefined && !displayName) throw new ValidationError("Enter the person's name.");
    await db.update(users).set({ displayName: displayName ?? u.displayName, jobTitle: input.jobTitle === undefined ? u.jobTitle : input.jobTitle?.trim() || null, updatedAt: new Date() }).where(eq(users.id, userId));
    await audit(db, { actor, action: "user.updated", targetType: "user", targetId: userId, meta });
  }
  if (input.roles) {
    const current = await rolesOf(db, userId);
    const wanted = new Set<Role>(["EMPLOYEE", ...input.roles]);
    const allowed = assignableRoles(actor);
    const toAdd = [...wanted].filter((r) => !current.includes(r));
    const toRemove = current.filter((r) => !wanted.has(r));
    const bad = [...toAdd, ...toRemove].filter((r) => !allowed.includes(r));
    if (bad.length) throw new ForbiddenError(`You can't change the ${bad.map((r) => ROLE_LABELS[r]).join(", ")} role.`);
    if (toRemove.includes("FIRM_ADMIN") && (await activeFirmAdminCount(db, userId)) === 0)
      throw new ConflictError("At least one active Firm Administrator is required. Add another administrator first.");
    if (toAdd.length) await db.insert(userRoles).values(toAdd.map((role) => ({ userId, role, grantedBy: actor.id })));
    if (toRemove.length) await db.delete(userRoles).where(and(eq(userRoles.userId, userId), inArray(userRoles.role, toRemove)));
    for (const r of toAdd) await audit(db, { actor, action: "role.granted", targetType: "user", targetId: userId, details: { role: r }, meta });
    for (const r of toRemove) await audit(db, { actor, action: "role.revoked", targetType: "user", targetId: userId, details: { role: r }, meta });
  }
}

export async function suspendEmployee(db: DB, actor: Actor, userId: string, reason: string, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  if (userId === actor.id) throw new ConflictError("You can't suspend your own access.");
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new NotFoundError();
  const roles = await rolesOf(db, userId);
  if (roles.includes("FIRM_ADMIN") && (await activeFirmAdminCount(db, userId)) === 0) throw new ConflictError("This is the only active Firm Administrator and can't be suspended.");
  await db.update(users).set({ status: "suspended", suspendedAt: new Date(), suspendedBy: actor.id, suspendedReason: reason?.slice(0, 500) || null, updatedAt: new Date() }).where(eq(users.id, userId));
  const ended = await destroyAllSessionsForUser(db, userId);
  await db.delete(clioConnections).where(eq(clioConnections.userId, userId));
  await audit(db, { actor, action: "user.suspended", targetType: "user", targetId: userId, details: { email: u.email, sessionsEnded: ended, reason: reason?.slice(0, 200) }, meta });
  return { sessionsEnded: ended };
}

export async function restoreEmployee(db: DB, actor: Actor, userId: string, meta?: RequestMeta) {
  if (!isFirmAdmin(actor)) throw new ForbiddenError();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new NotFoundError();
  await db.update(users).set({ status: "active", suspendedAt: null, suspendedBy: null, suspendedReason: null, updatedAt: new Date() }).where(eq(users.id, userId));
  await audit(db, { actor, action: "user.restored", targetType: "user", targetId: userId, details: { email: u.email }, meta });
}
