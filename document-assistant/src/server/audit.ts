import type { DB } from "./db/client";
import { auditLogs } from "./db/schema";
import type { Actor } from "./auth/permissions";

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry {
  actor?: Pick<Actor, "id" | "email"> | null;
  action: string;
  outcome?: "success" | "denied" | "failure";
  targetType?: string;
  targetId?: string | null;
  /** Metadata only: identifiers, counts, labels. Never document text or case facts. */
  details?: Record<string, unknown>;
  meta?: RequestMeta;
}

const SENSITIVE_KEYS = /token|secret|password|content|text|body|answer|excerpt|prompt/i;

function scrub(details?: Record<string, unknown>) {
  if (!details) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (SENSITIVE_KEYS.test(k)) continue;
    out[k] = typeof v === "string" && v.length > 300 ? `${v.slice(0, 300)}…` : v;
  }
  return out;
}

export async function audit(db: DB, entry: AuditEntry) {
  try {
    await db.insert(auditLogs).values({
      actorId: entry.actor?.id ?? null,
      actorEmail: entry.actor?.email ?? null,
      action: entry.action,
      outcome: entry.outcome ?? "success",
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      details: scrub(entry.details) ?? null,
      ipAddress: entry.meta?.ip ?? null,
      userAgent: entry.meta?.userAgent?.slice(0, 300) ?? null,
    });
  } catch (err) {
    // Audit failures must never be silent; surface to the operational log without case data.
    console.error("[audit] failed to record", entry.action, (err as Error).message);
  }
}
