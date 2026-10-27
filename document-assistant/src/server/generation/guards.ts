import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { userSkillPermissions } from "../db/schema";
import { ConflictError, ForbiddenError, SuspendedError } from "../errors";
import { getSetting } from "../settings";
import type { WorkContext } from "./context";

export const EDITABLE_STATUSES = new Set(["in_progress", "ready", "changes_requested"]);

export async function userHasSkill(db: DB, userId: string, skillId: string) {
  const [row] = await db
    .select({ u: userSkillPermissions.userId })
    .from(userSkillPermissions)
    .where(and(eq(userSkillPermissions.userId, userId), eq(userSkillPermissions.skillId, skillId)));
  return Boolean(row);
}

export async function assertGenerationAllowed(db: DB) {
  const gen = await getSetting(db, "generation");
  if (gen.suspended)
    throw new SuspendedError(`Document generation is paused by the firm right now${gen.reason ? `: ${gen.reason}` : "."} Your work is saved. Please try again later.`);
}

/** Re-checked inside background jobs too: access may have changed after the job was queued. */
export async function assertWorkCanRun(db: DB, ctx: WorkContext, opts: { requireEditable?: boolean } = { requireEditable: true }) {
  await assertGenerationAllowed(db);
  if (!ctx.owner) throw new ForbiddenError("This employee's access has been suspended.");
  if (!ctx.skill.enabled || ctx.skill.archivedAt) throw new ForbiddenError("This skill has been turned off by an administrator.");
  if (ctx.session.isTest) {
    if (!ctx.owner.roles.includes("FIRM_ADMIN")) throw new ForbiddenError();
  } else if (!(await userHasSkill(db, ctx.owner.id, ctx.skill.id))) {
    throw new ForbiddenError("You no longer have access to this skill. Contact your administrator.");
  }
  if (opts.requireEditable && !EDITABLE_STATUSES.has(ctx.session.status))
    throw new ConflictError("This work has been sent for attorney review and can't be changed right now.");
}
