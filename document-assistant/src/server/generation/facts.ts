/**
 * Builds the fact list a draft may rely on, with a source for every fact, and the deterministic
 * list of things that need attention (missing items, conflicts, unverified values).
 */
import { formatCurrency, parseAmount, runCalculations, type CalcResult } from "@/lib/calculations";
import { matterFieldLabel } from "@/lib/matter-fields";
import { isVisible, type SkillConfig, type SkillInput } from "@/lib/skill-config";
import type { Issue, Provenance, SessionData, SourceRef } from "@/lib/work-types";
import type { MatterDetail } from "../integrations/clio/types";
import { formatLongDate, normalizeDate, normalizeText, providersMatch } from "./checks";
import type { SessionDocumentRow } from "./context";

export interface Fact {
  id: string;
  key: string;
  label: string;
  value: string;
  source: SourceRef;
}

export function formatAnswer(input: SkillInput, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  switch (input.type) {
    case "currency": {
      const d = parseAmount(value);
      return d ? formatCurrency(d) : String(value);
    }
    case "date":
      return formatLongDate(String(value));
    case "yesno":
      return value === true || value === "yes" ? "Yes" : value === false || value === "no" ? "No" : String(value);
    case "checkboxes":
      return Array.isArray(value) ? value.join(", ") : String(value);
    default:
      return String(value);
  }
}

export function formatCell(type: string, value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  if (type === "currency") {
    const d = parseAmount(value);
    return d ? formatCurrency(d) : String(value);
  }
  if (type === "date") return formatLongDate(String(value));
  return String(value);
}

function sourceFrom(p: Provenance | null | undefined, base: { id: string; key: string; label: string; value: string }): SourceRef {
  if (p?.kind === "document")
    return { ...base, factKey: base.key, sourceType: "document", verification: p.verified ? "verified_in_document" : "unverified", docId: p.docId, fileName: p.fileName, page: p.page, excerpt: p.quote };
  if (p?.kind === "matter") return { ...base, factKey: base.key, sourceType: "matter_record", verification: "matter_record" };
  if (p?.kind === "edited") return { ...base, factKey: base.key, sourceType: "employee", verification: "employee_statement", fileName: p.fileName, page: p.page };
  return { ...base, factKey: base.key, sourceType: "employee", verification: "employee_statement" };
}

export function describeSource(s: SourceRef) {
  switch (s.verification) {
    case "verified_in_document":
      return `document (verified): ${s.fileName}, page ${s.page}`;
    case "unverified":
      return `document (NOT verified): ${s.fileName}, page ${s.page}`;
    case "matter_record":
      return "case file (Clio)";
    case "calculated":
      return "calculated by the system";
    default:
      return "employee statement";
  }
}

export interface FactBuild {
  facts: Fact[];
  calcs: CalcResult[];
  issues: Issue[];
  visibleInputs: SkillInput[];
  values: Record<string, string>;
}

export function buildFacts(cfg: SkillConfig, data: SessionData, matter: MatterDetail | null, docs: SessionDocumentRow[]): FactBuild {
  const facts: Fact[] = [];
  const issues: Issue[] = [];
  const values: Record<string, string> = {};
  let n = 0;
  const add = (key: string, label: string, value: string, p: Provenance | null | undefined, kind?: "calculated") => {
    const id = `F${++n}`;
    const base = { id, key, label, value };
    const source: SourceRef = kind === "calculated" ? { ...base, factKey: key, sourceType: "calculated", verification: "calculated" } : sourceFrom(p, base);
    facts.push({ id, key, label, value, source });
    return id;
  };

  const matterFields = (matter?.fields ?? {}) as Record<string, string>;
  for (const [k, v] of Object.entries(matterFields)) {
    if (!v) continue;
    const display = k.endsWith("limits") ? formatCurrency(parseAmount(v) ?? v) : k.endsWith("_date") ? formatLongDate(v) : v;
    values[k] = display;
    add(`matter.${k}`, matterFieldLabel(k), display, { kind: "matter", field: k });
  }

  const answers = data.answers;
  const visibleInputs = cfg.inputs.filter((i) => isVisible(i.showWhen, answers));
  for (const input of visibleInputs) {
    const raw = answers[input.id];
    const prov = data.provenance[input.id];
    if (input.type === "table") {
      const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
      const cols = input.columns ?? [];
      rows.forEach((row, i) => {
        const text = cols
          .map((c) => formatCell(c.type, row[c.id]))
          .filter(Boolean)
          .join(" — ");
        if (text) add(`input.${input.id}.row${i + 1}`, `${input.label} (row ${i + 1})`, text, data.rowProvenance[input.id]?.[i] ?? prov);
        for (const c of cols)
          if (c.required && !String(row[c.id] ?? "").trim())
            issues.push({ kind: "missing_input", severity: "attention", message: `${input.label}, row ${i + 1}: "${c.label}" is blank.`, ref: input.id });
      });
      values[input.id] = rows.length ? `${rows.length} entr${rows.length === 1 ? "y" : "ies"}` : "";
      if (input.required && rows.length === 0) issues.push({ kind: "missing_input", severity: "attention", message: `Missing: ${input.label}.`, ref: input.id });
      continue;
    }
    if (input.type === "file") continue;
    const display = formatAnswer(input, raw);
    values[input.id] = display;
    if (!display) {
      if (input.required) issues.push({ kind: "missing_input", severity: "attention", message: `Missing: ${input.label}.`, ref: input.id });
      continue;
    }
    add(`input.${input.id}`, input.label, display, prov);
    if (prov?.kind === "document" && !prov.verified)
      issues.push({ kind: "unverified", severity: "attention", message: `"${input.label}" came from ${prov.fileName} (page ${prov.page}) but couldn't be confirmed word-for-word on that page. Please check it.`, ref: input.id });
    if (prov?.kind === "edited")
      issues.push({
        kind: "conflict",
        severity: "attention",
        message: `"${input.label}" was changed by staff from what ${prov.from === "matter" ? "the case file (Clio)" : `${prov.fileName}${prov.page ? ` (page ${prov.page})` : ""}`} says. Make sure the new value is correct.`,
        ref: input.id,
      });
    if (input.requiresSource && (prov?.kind === "employee" || prov?.kind === "edited"))
      issues.push({ kind: "unsupported_assertion", severity: "attention", message: `"${input.label}" was entered by staff and isn't linked to a medical record. Confirm it is supported before sending.`, ref: input.id });
  }

  const calcs = runCalculations(cfg, answers, matterFields);
  for (const c of calcs) {
    if (c.value !== null) {
      values[c.id] = c.display;
      add(`calc.${c.id}`, c.label, c.display, null, "calculated");
    } else if (c.error) issues.push({ kind: "calculation", severity: "attention", message: c.error, ref: c.id });
    else issues.push({ kind: "calculation", severity: "attention", message: `"${c.label}" can't be calculated yet. Missing: ${c.missing.join(", ")}.`, ref: c.id });
  }

  // Required documents for the requirements that apply to this matter.
  for (const req of cfg.documents) {
    if (!isVisible(req.appliesWhen, answers)) continue;
    const has = docs.some((d) => d.selected && d.requirementId === req.id);
    if (!has && req.required) issues.push({ kind: "missing_document", severity: "attention", message: `Missing document: ${req.label}.`, ref: req.id });
  }

  issues.push(...crossChecks(cfg, data, matterFields));
  for (const note of cfg.notices) issues.push({ kind: "notice", severity: "info", message: note });
  for (const d of data.analysis?.documents ?? [])
    if (d.status === "no_text" || d.status === "failed") issues.push({ kind: "document_problem", severity: "attention", message: `${d.fileName}: ${d.note ?? "could not be read."}`, ref: d.docId });

  return { facts, calcs, issues, visibleInputs, values };
}

/** Compares the case file against the documents, and medical records against bills. */
export function crossChecks(cfg: SkillConfig, data: SessionData, matterFields: Record<string, string>): Issue[] {
  const issues: Issue[] = [];
  const ex = data.analysis?.extracted ?? {};

  const pairs: [string, string, "date" | "amount" | "text"][] = [
    ["incident_date", "incident.date", "date"],
    ["um_policy_number", "insurance.policy_number", "text"],
    ["um_limits", "insurance.limits", "amount"],
  ];
  const norm = (v: string, kind: string) => (kind === "date" ? normalizeDate(v) : kind === "amount" ? (parseAmount(v)?.toFixed(2) ?? v) : normalizeText(v).replace(/[^a-z0-9]/g, ""));
  const show = (v: string, kind: string) => (kind === "date" ? formatLongDate(v) : kind === "amount" ? formatCurrency(parseAmount(v) ?? v) : v);
  for (const [field, key, kind] of pairs) {
    const fromMatter = matterFields[field];
    for (const item of ex[key] ?? []) {
      if (typeof item.value !== "string") continue;
      if (fromMatter && norm(fromMatter, kind) !== norm(item.value, kind))
        issues.push({
          kind: "conflict",
          severity: "attention",
          message: `The case file (Clio) says the ${matterFieldLabel(field).toLowerCase()} is ${show(fromMatter, kind)}, but ${item.fileName} (page ${item.page}) says ${show(item.value, kind)}.`,
          ref: field,
        });
    }
  }
  for (const key of ["incident.date", "insurance.limits", "insurance.policy_number"]) {
    const items = (ex[key] ?? []).filter((i) => typeof i.value === "string");
    const distinct = new Map(items.map((i) => [norm(i.value as string, key.endsWith("date") ? "date" : key.endsWith("limits") ? "amount" : "text"), i]));
    if (distinct.size > 1)
      issues.push({ kind: "conflict", severity: "attention", message: `The documents disagree about ${key.replace(/^.*\./, "").replace(/_/g, " ")}: ${[...distinct.values()].map((i) => `${i.value} (${i.fileName}, p. ${i.page})`).join(" vs. ")}.` });
  }

  const rowsFor = (key: string) =>
    cfg.inputs
      .filter((i) => i.type === "table" && i.prefill?.source === "extracted" && i.prefill.key === key)
      .flatMap((i) => (Array.isArray(data.answers[i.id]) ? (data.answers[i.id] as Record<string, string>[]) : []));
  const treatmentRows = rowsFor("treatment");
  const billRows = rowsFor("bills");
  const treatmentProviders = [...new Set([...treatmentRows.map((r) => r.provider), ...(ex.treatment ?? []).map((i) => (i.value as Record<string, string>).provider)].filter(Boolean))];
  const billProviders = [...new Set([...billRows.map((r) => r.provider), ...(ex.bills ?? []).map((i) => (i.value as Record<string, string>).provider)].filter(Boolean))];
  if (treatmentProviders.length && (billProviders.length || ex.bills)) {
    for (const p of treatmentProviders)
      if (!billProviders.some((b) => providersMatch(p, b)))
        issues.push({ kind: "missing_evidence", severity: "attention", message: `Treatment by ${p} is documented, but no bill from ${p} was found. Request the bill or confirm there was no charge.` });
    for (const b of billProviders)
      if (!treatmentProviders.some((p) => providersMatch(p, b)))
        issues.push({ kind: "missing_evidence", severity: "info", message: `There is a bill from ${b} but no matching medical record was selected.` });
  }
  return issues;
}
