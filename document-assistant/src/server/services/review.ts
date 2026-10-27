/** Attorney review. Approval is a firm-wide safeguard and cannot be configured away by a skill. */
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { audit, type RequestMeta } from "../audit";
import { isAttorney, type Actor } from "../auth/permissions";
import type { DB } from "../db/client";
import { approvalRecords, generatedDocuments, matterRefs, users, workSessions } from "../db/schema";
import { ConflictError, ForbiddenError, ValidationError } from "../errors";
import { generateWorkProduct } from "../generation/generate";
import { loadWorkContext } from "../generation/context";
import { getCaseAdapter } from "../integrations/clio";
import { getSetting } from "../settings";
import { loadForActor } from "./work";

export async function reviewQueue(db: DB, actor: Actor) {
  if (!isAttorney(actor)) throw new ForbiddenError();
  const allowSelf = (await getSetting(db, "review")).allowSelfApproval;
  const rows = await db
    .select({ s: workSessions, m: matterRefs, owner: users.displayName })
    .from(workSessions)
    .leftJoin(matterRefs, eq(matterRefs.id, workSessions.matterRefId))
    .leftJoin(users, eq(users.id, workSessions.userId))
    .where(
      and(
        eq(workSessions.isTest, false),
        or(
          and(eq(workSessions.status, "submitted"), or(isNull(workSessions.reviewerId), eq(workSessions.reviewerId, actor.id))),
          and(inArray(workSessions.status, ["approved", "changes_requested"]), eq(workSessions.reviewerId, actor.id)),
          and(inArray(workSessions.status, ["approved", "changes_requested"]), eq(workSessions.approvedBy, actor.id)),
        ),
      ),
    )
    .orderBy(desc(workSessions.submittedAt))
    .limit(100);
  const adapter = await getCaseAdapter();
  const out = [];
  for (const { s, m, owner } of rows) {
    if (!allowSelf && s.userId === actor.id) continue;
    // Only list work on matters this attorney can see in the case-management system.
    if (!m || !(await adapter.getMatter(actor, m.externalId))) continue;
    const gen = (s.data as { generation?: { issues?: { severity: string }[] } }).generation;
    out.push({
      id: s.id,
      title: s.title,
      status: s.status,
      matter: `${m.displayNumber} · ${m.description}`,
      preparedBy: owner ?? "",
      submittedAt: s.submittedAt,
      assignedToMe: s.reviewerId === actor.id,
      openIssues: gen?.issues?.filter((i) => i.severity === "attention").length ?? 0,
    });
  }
  return out;
}

export async function decide(db: DB, actor: Actor, sessionId: string, input: { decision: "approve" | "request_changes"; comments?: string }, meta?: RequestMeta) {
  if (!isAttorney(actor)) throw new ForbiddenError("Only an attorney reviewer can approve work.");
  const { ctx, role } = await loadForActor(db, actor, sessionId, "owner_or_reviewer");
  if (role !== "reviewer") throw new ForbiddenError("You can't approve your own work. Another attorney must review it.");
  if (ctx.session.status !== "submitted") throw new ConflictError("This work isn't waiting for review.");

  if (input.decision === "request_changes") {
    if (!input.comments?.trim()) throw new ValidationError("Please explain what needs to change.");
    await db.update(workSessions).set({ status: "changes_requested", reviewerId: actor.id, updatedAt: new Date() }).where(eq(workSessions.id, ctx.session.id));
    await db.insert(approvalRecords).values({ workSessionId: ctx.session.id, revision: ctx.session.revision, action: "changes_requested", actorId: actor.id, comments: input.comments.slice(0, 4000) });
    await audit(db, { actor, action: "review.changes_requested", targetType: "work_session", targetId: ctx.session.id, details: { revision: ctx.session.revision }, meta });
    return { status: "changes_requested" };
  }

  // Create the final (unwatermarked) files from exactly the content that was reviewed.
  await generateWorkProduct(db, ctx.session.id, "final", { approverId: actor.id });
  const fresh = await loadWorkContext(db, ctx.session.id);
  const finals = await db
    .select({ fileName: generatedDocuments.fileName, sha256: generatedDocuments.sha256 })
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.workSessionId, ctx.session.id), eq(generatedDocuments.revision, fresh.session.revision), eq(generatedDocuments.isFinal, true)));
  await db.update(workSessions).set({ status: "approved", approvedAt: new Date(), approvedBy: actor.id, reviewerId: actor.id, updatedAt: new Date() }).where(eq(workSessions.id, ctx.session.id));
  await db.insert(approvalRecords).values({
    workSessionId: ctx.session.id,
    revision: fresh.session.revision,
    action: "approved",
    actorId: actor.id,
    comments: input.comments?.slice(0, 4000) || null,
    documentHashes: Object.fromEntries(finals.map((f) => [f.fileName, f.sha256])),
  });
  await audit(db, { actor, action: "review.approved", targetType: "work_session", targetId: ctx.session.id, details: { revision: fresh.session.revision, finalFiles: finals.length }, meta });
  return { status: "approved" };
}
