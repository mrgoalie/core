import type { Role } from "../db/schema";
import { ForbiddenError } from "../errors";

export interface Actor {
  id: string;
  email: string;
  displayName: string;
  roles: Role[];
  sessionId?: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  EMPLOYEE: "Employee",
  ATTORNEY_REVIEWER: "Attorney Reviewer",
  FIRM_ADMIN: "Firm Administrator",
  SYSTEM_ADMIN: "System Administrator",
};

export const hasRole = (actor: Actor, role: Role) => actor.roles.includes(role);
export const isAttorney = (a: Actor) => hasRole(a, "ATTORNEY_REVIEWER");
export const isFirmAdmin = (a: Actor) => hasRole(a, "FIRM_ADMIN");
export const isSystemAdmin = (a: Actor) => hasRole(a, "SYSTEM_ADMIN");
export const isAnyAdmin = (a: Actor) => isFirmAdmin(a) || isSystemAdmin(a);

export function requireRole(actor: Actor, ...roles: Role[]) {
  if (!roles.some((r) => actor.roles.includes(r))) throw new ForbiddenError();
}

/**
 * Which roles an actor may grant or remove. Firm administrators manage everyday access;
 * only a System Administrator can grant System Administrator.
 */
export function assignableRoles(actor: Actor): Role[] {
  const out: Role[] = [];
  if (isFirmAdmin(actor)) out.push("EMPLOYEE", "ATTORNEY_REVIEWER", "FIRM_ADMIN");
  if (isSystemAdmin(actor)) out.push("SYSTEM_ADMIN");
  return out;
}
