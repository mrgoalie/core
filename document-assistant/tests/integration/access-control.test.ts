import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession, resolveSession, sessionCookieName } from "@/server/auth/session";
import type { DB } from "@/server/db/client";
import { auditLogs, users } from "@/server/db/schema";
import { setGenerationSuspended } from "@/server/services/admin";
import { setPermission } from "@/server/services/skills";
import { createEmployee, suspendEmployee, restoreEmployee, updateEmployee } from "@/server/services/users";
import { getWorkView, requestAnalysis, requestGeneration, selectMatter, startWork } from "@/server/services/work";
import { reviewQueue } from "@/server/services/review";
import { GET as homeGET } from "@/app/api/home/route";
import { GET as employeesGET } from "@/app/api/admin/employees/route";
import { POST as workPOST } from "@/app/api/work/route";
import { GET as workGET } from "@/app/api/work/[id]/route";
import { actor, DEMO, freshDb, runJobs, skillId } from "../helpers";

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await freshDb()));
afterAll(async () => close());

async function login(email: string) {
  const a = await actor(db, email);
  return (await createSession(db, a.id, "development")).token;
}
function req(path: string, token?: string, init: { method?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000" };
  if (token) headers.cookie = `${sessionCookieName()}=${token}`;
  if (init.origin) headers.origin = init.origin;
  if (init.body) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? "GET", headers, body: init.body ? JSON.stringify(init.body) : undefined });
}
const noParams = { params: Promise.resolve({}) };

describe("HTTP authorization boundaries (route handlers)", () => {
  it("rejects requests without a session", async () => {
    expect((await homeGET(req("/api/home"), noParams)).status).toBe(401);
  });

  it("rejects an employee calling an administrator endpoint, and records the denial", async () => {
    const res = await employeesGET(req("/api/admin/employees", await login(DEMO.maria)), noParams);
    expect(res.status).toBe(403);
    const denied = await db.select().from(auditLogs).where(eq(auditLogs.action, "access.denied"));
    expect(denied.some((d) => d.actorEmail === DEMO.maria)).toBe(true);
  });

  it("blocks cross-site form posts (CSRF)", async () => {
    const token = await login(DEMO.maria);
    const body = { skillId: await skillId(db, "demand-letter") };
    expect((await workPOST(req("/api/work", token, { method: "POST", body, origin: "https://evil.example" }), noParams)).status).toBe(403);
    expect((await workPOST(req("/api/work", token, { method: "POST", body }), noParams)).status).toBe(403);
    expect((await workPOST(req("/api/work", token, { method: "POST", body, origin: "http://localhost:3000" }), noParams)).status).toBe(200);
  });

  it("does not reveal another employee's work", async () => {
    const maria = await actor(db, DEMO.maria);
    const { sessionId } = await startWork(db, maria, await skillId(db, "demand-letter"));
    const res = await workGET(req(`/api/work/${sessionId}`, await login(DEMO.daniel)), { params: Promise.resolve({ id: sessionId }) });
    expect(res.status).toBe(404);
  });
});

describe("employee access termination (administrator task D)", () => {
  it("suspending an employee ends their sessions immediately and rejects further requests", async () => {
    const jordan = await actor(db, DEMO.jordan);
    const daniel = await actor(db, DEMO.daniel);
    const token = await login(DEMO.daniel);
    const { sessionId } = await startWork(db, daniel, await skillId(db, "demand-letter"));
    await selectMatter(db, daniel, sessionId, "m-1001");
    const { jobId } = await requestAnalysis(db, daniel, sessionId);
    expect(await resolveSession(db, token)).not.toBeNull();

    const r = await suspendEmployee(db, jordan, daniel.id, "Left the firm");
    expect(r.sessionsEnded).toBeGreaterThanOrEqual(1);
    expect(await resolveSession(db, token)).toBeNull();
    expect((await homeGET(req("/api/home", token), noParams)).status).toBe(401);
    // Work queued before the suspension is refused when it runs.
    const job = await runJobs(db, jobId);
    expect(job?.status).toBe("failed");
    // A brand-new session for a suspended person is also refused.
    const fresh = await createSession(db, daniel.id, "development");
    expect(await resolveSession(db, fresh.token)).toBeNull();
    const log = await db.select().from(auditLogs).where(eq(auditLogs.action, "user.suspended"));
    expect(log[0].targetId).toBe(daniel.id);
    await restoreEmployee(db, jordan, daniel.id);
  });

  it("protects against locking the firm out", async () => {
    const jordan = await actor(db, DEMO.jordan);
    await expect(suspendEmployee(db, jordan, jordan.id, "")).rejects.toThrow(/your own/);
    await expect(updateEmployee(db, jordan, jordan.id, { roles: ["EMPLOYEE", "ATTORNEY_REVIEWER"] })).rejects.toThrow(/At least one active Firm Administrator/);
  });

  it("only a System Administrator can grant the System Administrator role", async () => {
    const jordan = await actor(db, DEMO.jordan);
    await expect(createEmployee(db, jordan, { email: "new.person@demo.fabbrinilaw.test", displayName: "New Person", roles: ["SYSTEM_ADMIN"] })).rejects.toThrow(/can't give/);
    const created = await createEmployee(db, jordan, { email: "new.person@demo.fabbrinilaw.test", displayName: "New Person", roles: ["ATTORNEY_REVIEWER"] });
    const [u] = await db.select().from(users).where(eq(users.id, created.userId));
    expect(u.status).toBe("active");
  });
});

describe("matter-level and skill-level authorization", () => {
  it("an employee cannot open a matter she is not permitted to see, even by id", async () => {
    const maria = await actor(db, DEMO.maria);
    const { sessionId } = await startWork(db, maria, await skillId(db, "demand-letter"));
    await expect(selectMatter(db, maria, sessionId, "m-1004")).rejects.toThrow(/wasn't found/);
    const denied = await db.select().from(auditLogs).where(eq(auditLogs.action, "matter.access_denied"));
    expect(denied.length).toBeGreaterThan(0);
  });

  it("employees without a skill cannot start it", async () => {
    const daniel = await actor(db, DEMO.daniel);
    await expect(startWork(db, daniel, await skillId(db, "arbitration-package"))).rejects.toThrow(/isn't available/);
  });

  it("revoking a skill stops further generation on existing work", async () => {
    const jordan = await actor(db, DEMO.jordan);
    const maria = await actor(db, DEMO.maria);
    const demand = await skillId(db, "demand-letter");
    const { sessionId } = await startWork(db, maria, demand);
    await selectMatter(db, maria, sessionId, "m-1003");
    await setPermission(db, jordan, maria.id, demand, false);
    await expect(requestGeneration(db, maria, sessionId)).rejects.toThrow(/no longer have access/);
    await setPermission(db, jordan, maria.id, demand, true);
  });

  it("reviewers only see submitted work for matters they can access", async () => {
    const rachel = await actor(db, DEMO.rachel);
    const items = await reviewQueue(db, rachel);
    expect(items.every((i) => i.status !== "in_progress")).toBe(true);
  });

  it("the emergency stop blocks document creation for everyone until resumed", async () => {
    const jordan = await actor(db, DEMO.jordan);
    const maria = await actor(db, DEMO.maria);
    const { sessionId } = await startWork(db, maria, await skillId(db, "demand-letter"));
    await selectMatter(db, maria, sessionId, "m-1001");
    await expect(setGenerationSuspended(db, maria, true, "x")).rejects.toThrow();
    await setGenerationSuspended(db, jordan, true, "Security review in progress");
    await expect(requestAnalysis(db, maria, sessionId)).rejects.toThrow(/paused/);
    await expect(requestGeneration(db, maria, sessionId)).rejects.toThrow(/Security review in progress/);
    expect((await getWorkView(db, maria, sessionId)).flags.generationSuspended).toBe(true);
    await setGenerationSuspended(db, jordan, false, "");
    expect((await requestAnalysis(db, maria, sessionId)).jobId).toBeTruthy();
  });
});
