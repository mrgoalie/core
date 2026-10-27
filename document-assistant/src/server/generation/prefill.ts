/**
 * Fills questions from authorized case-file fields and from verified document extraction, so
 * employees are not asked for information the firm already has. Anything an employee has typed or
 * changed is never overwritten.
 */
import { parseAmount } from "@/lib/calculations";
import type { SkillConfig, SkillInput } from "@/lib/skill-config";
import type { ExtractedItem, Provenance, SessionData } from "@/lib/work-types";
import { normalizeDate } from "./checks";

const ownedByEmployee = (p?: Provenance | null) => p?.kind === "employee" || p?.kind === "edited";

function coerce(input: SkillInput, raw: string): string {
  if (input.type === "date") return normalizeDate(raw) ?? raw;
  if (input.type === "currency") return parseAmount(raw)?.toFixed(2) ?? raw;
  if (input.type === "number") return parseAmount(raw)?.toString() ?? raw;
  return raw;
}

function docProvenance(item: ExtractedItem): Provenance {
  return { kind: "document", docId: item.docId, fileName: item.fileName, page: item.page, quote: item.quote, verified: item.verified };
}

export function applyPrefill(
  cfg: SkillConfig,
  data: SessionData,
  matterFields: Record<string, string | undefined>,
  extracted: Record<string, ExtractedItem[]> = {},
): SessionData {
  const next: SessionData = { ...data, answers: { ...data.answers }, provenance: { ...data.provenance }, rowProvenance: { ...data.rowProvenance } };
  for (const input of cfg.inputs) {
    if (ownedByEmployee(next.provenance[input.id])) continue;

    if (input.type === "matter_field" && input.matterField) {
      const v = matterFields[input.matterField];
      if (v) {
        next.answers[input.id] = v;
        next.provenance[input.id] = { kind: "matter", field: input.matterField };
      }
      continue;
    }

    const p = input.prefill;
    if (p?.source === "matter") {
      const v = matterFields[p.field];
      if (v) {
        next.answers[input.id] = coerce(input, v);
        next.provenance[input.id] = { kind: "matter", field: p.field };
        continue;
      }
    }
    if (p?.source === "extracted") {
      const items = extracted[p.key] ?? [];
      if (items.length && input.type === "table") {
        const cols = input.columns ?? [];
        next.answers[input.id] = items.map((it) => {
          const rec = typeof it.value === "string" ? { value: it.value } : it.value;
          const row: Record<string, string> = {};
          for (const c of cols) {
            const raw = rec[c.id] ?? "";
            row[c.id] = c.type === "currency" ? (parseAmount(raw)?.toFixed(2) ?? raw) : raw;
          }
          return row;
        });
        next.rowProvenance[input.id] = items.map(docProvenance);
        next.provenance[input.id] = docProvenance(items[0]);
        continue;
      }
      if (items.length) {
        const values = items.map((i) => (typeof i.value === "string" ? i.value : Object.values(i.value).join(" ")));
        const joined = input.type === "longtext" ? [...new Set(values)].join("\n") : values[0];
        next.answers[input.id] = coerce(input, joined);
        next.provenance[input.id] = docProvenance(items[0]);
        continue;
      }
    }
    const current = next.answers[input.id];
    if ((current === undefined || current === "") && input.defaultValue !== undefined) {
      next.answers[input.id] = input.defaultValue;
      next.provenance[input.id] = { kind: "default" };
    }
  }
  return next;
}

/**
 * Applies an employee's edits. Values that came from a record become "edited" (so the change is
 * visible to the reviewing attorney); new values become employee statements.
 */
export function applyEmployeeAnswers(cfg: SkillConfig, data: SessionData, updates: Record<string, unknown>): SessionData {
  const next: SessionData = { ...data, answers: { ...data.answers }, provenance: { ...data.provenance }, rowProvenance: { ...data.rowProvenance } };
  const inputs = new Map(cfg.inputs.map((i) => [i.id, i]));
  for (const [id, value] of Object.entries(updates)) {
    const input = inputs.get(id);
    if (!input || input.type === "matter_field" || input.type === "file") continue;
    const before = JSON.stringify(next.answers[id] ?? null);
    if (before === JSON.stringify(value ?? null)) continue;
    next.answers[id] = value;
    const prev = next.provenance[id];
    if (input.type === "table") {
      const oldRows = Array.isArray(data.answers[id]) ? (data.answers[id] as unknown[]) : [];
      const newRows = Array.isArray(value) ? (value as unknown[]) : [];
      const oldProv = data.rowProvenance[id] ?? [];
      next.rowProvenance[id] = newRows.map((row, i) => {
        const p = oldProv[i];
        if (!p) return { kind: "employee" } as Provenance;
        if (JSON.stringify(row) === JSON.stringify(oldRows[i])) return p;
        return p.kind === "document" ? { kind: "edited", from: "document", fileName: p.fileName, page: p.page } : p.kind === "matter" ? { kind: "edited", from: "matter" } : { kind: "employee" };
      });
      next.provenance[id] = { kind: "employee" };
      continue;
    }
    if (prev?.kind === "document") next.provenance[id] = { kind: "edited", from: "document", fileName: prev.fileName, page: prev.page };
    else if (prev?.kind === "matter") next.provenance[id] = { kind: "edited", from: "matter" };
    else if (prev?.kind === "edited") next.provenance[id] = prev;
    else next.provenance[id] = { kind: "employee" };
  }
  if (next.generation) next.generation = { ...next.generation, stale: true };
  return next;
}
