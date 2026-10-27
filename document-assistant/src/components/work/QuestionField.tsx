"use client";
import { Plus, Trash2 } from "lucide-react";
import { formatCurrency, parseAmount } from "@/lib/calculations";
import { matterFieldLabel } from "@/lib/matter-fields";
import type { SkillInput } from "@/lib/skill-config";
import type { Provenance } from "@/lib/work-types";

export function ProvenanceTag({ p }: { p: Provenance | null | undefined }) {
  if (!p) return null;
  switch (p.kind) {
    case "document":
      return (
        <span className={`source-tag ${p.verified ? "verified" : "unverified"}`} title={p.quote}>
          From {p.fileName.replace(/\.[a-z0-9]+$/i, "")}, p. {p.page}
          {p.verified ? " ✓" : " — please check"}
        </span>
      );
    case "matter":
      return <span className="source-tag case-file">From the case file (Clio)</span>;
    case "edited":
      return <span className="source-tag edited">Changed by you{p.fileName ? ` (was from ${p.fileName.replace(/\.[a-z0-9]+$/i, "")})` : " (was from the case file)"}</span>;
    case "employee":
      return <span className="source-tag">Entered by you</span>;
    case "default":
      return <span className="source-tag">Suggested default</span>;
  }
}

interface Props {
  input: SkillInput;
  value: unknown;
  provenance?: Provenance | null;
  rowProvenance?: (Provenance | null)[];
  onChange: (v: unknown) => void;
  disabled?: boolean;
  matterValue?: string;
  missing?: boolean;
}

export function QuestionField({ input, value, provenance, rowProvenance, onChange, disabled, matterValue, missing }: Props) {
  const id = `q-${input.id}`;
  const hintId = input.helpText ? `${id}-hint` : undefined;
  const str = value === undefined || value === null ? "" : String(value);
  const label = (
    <span className="row" style={{ gap: 10 }}>
      <span>
        {input.label}
        {input.required ? (
          <span className="req" aria-label="required">
            *
          </span>
        ) : (
          <span className="opt">(optional)</span>
        )}
      </span>
      <ProvenanceTag p={provenance} />
    </span>
  );
  const common = { id, disabled, "aria-describedby": hintId, "aria-invalid": missing || undefined, "aria-required": input.required || undefined } as const;

  if (input.type === "matter_field") {
    return (
      <div className="field">
        <span className="field-label">{label}</span>
        <div className="panel" style={{ padding: "10px 14px" }}>
          {matterValue || str || <span className="muted">Not recorded in the case file</span>}
        </div>
        <div className="hint">This comes from the case file ({matterFieldLabel(input.matterField ?? "")}). If it&apos;s wrong, correct it in Clio.</div>
      </div>
    );
  }

  if (input.type === "yesno" || input.type === "select" || input.type === "checkboxes") {
    const options = input.type === "yesno" ? ["Yes", "No"] : (input.options ?? []);
    const multi = input.type === "checkboxes";
    const selected = multi ? (Array.isArray(value) ? (value as string[]) : []) : str;
    if (input.type === "select" && options.length > 5) {
      return (
        <div className="field">
          <label htmlFor={id}>{label}</label>
          {input.helpText ? <div className="hint" id={hintId}>{input.helpText}</div> : null}
          <select {...common} value={str} onChange={(e) => onChange(e.target.value)}>
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
      );
    }
    return (
      <fieldset className="field" aria-describedby={hintId}>
        <legend>{label}</legend>
        {input.helpText ? <div className="hint" id={hintId}>{input.helpText}</div> : null}
        <div className={input.type === "yesno" ? "yesno" : "choice-cards"}>
          {options.map((o) => {
            const checked = multi ? (selected as string[]).includes(o) : selected === o;
            return (
              <label key={o} className={input.type === "yesno" ? undefined : "choice-card"}>
                <input
                  type={multi ? "checkbox" : "radio"}
                  name={id}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => {
                    if (!multi) onChange(o);
                    else onChange(checked ? (selected as string[]).filter((x) => x !== o) : [...(selected as string[]), o]);
                  }}
                />
                <span>{o}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (input.type === "table") {
    const rows = Array.isArray(value) ? (value as Record<string, string>[]) : [];
    const cols = input.columns ?? [];
    const setCell = (ri: number, col: string, v: string) => onChange(rows.map((r, i) => (i === ri ? { ...r, [col]: v } : r)));
    return (
      <fieldset className="field">
        <legend>{label}</legend>
        {input.helpText ? <div className="hint">{input.helpText}</div> : null}
        {rows.length === 0 ? <div className="empty" style={{ padding: 18 }}>No entries yet.{input.required ? " At least one is needed." : ""}</div> : null}
        {rows.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="edit-table">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.id} scope="col">
                      {c.label}
                      {c.required ? <span className="req" aria-hidden="true">*</span> : null}
                    </th>
                  ))}
                  <th scope="col">
                    <span className="sr-only">Source and actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    {cols.map((c) => (
                      <td key={c.id} data-label={c.label} style={{ minWidth: c.type === "longtext" ? 220 : c.type === "currency" ? 130 : 160 }}>
                        {c.type === "longtext" ? (
                          <textarea aria-label={`${c.label}, row ${ri + 1}`} value={r[c.id] ?? ""} disabled={disabled} rows={2} onChange={(e) => setCell(ri, c.id, e.target.value)} />
                        ) : (
                          <input
                            type={c.type === "date" ? "date" : "text"}
                            inputMode={c.type === "currency" || c.type === "number" ? "decimal" : undefined}
                            aria-label={`${c.label}, row ${ri + 1}`}
                            value={r[c.id] ?? ""}
                            disabled={disabled}
                            onChange={(e) => setCell(ri, c.id, e.target.value)}
                          />
                        )}
                      </td>
                    ))}
                    <td data-label="Source" style={{ minWidth: 160 }}>
                      <div className="stack" style={{ gap: 6 }}>
                        <ProvenanceTag p={rowProvenance?.[ri] ?? null} />
                        <button type="button" className="btn btn-quiet btn-sm" disabled={disabled} onClick={() => onChange(rows.filter((_, i) => i !== ri))}>
                          <Trash2 size={16} aria-hidden="true" /> Remove<span className="sr-only"> row {ri + 1}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div>
          <button type="button" className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => onChange([...rows, Object.fromEntries(cols.map((c) => [c.id, ""]))])}>
            <Plus size={16} aria-hidden="true" /> Add a row<span className="sr-only"> to {input.label}</span>
          </button>
        </div>
      </fieldset>
    );
  }

  const isMoney = input.type === "currency";
  const parsed = isMoney ? parseAmount(str) : null;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {input.helpText ? (
        <div className="hint" id={hintId}>
          {input.helpText}
        </div>
      ) : null}
      {input.type === "longtext" ? (
        <textarea {...common} value={str} rows={5} onChange={(e) => onChange(e.target.value)} />
      ) : input.type === "date" ? (
        <input {...common} type="date" value={str} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 260 }} />
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
          {isMoney ? <span aria-hidden="true" style={{ fontWeight: 700 }}>$</span> : null}
          <input
            {...common}
            type="text"
            inputMode={isMoney || input.type === "number" ? "decimal" : undefined}
            value={str}
            onChange={(e) => onChange(e.target.value)}
            style={isMoney || input.type === "number" ? { maxWidth: 260 } : undefined}
          />
        </div>
      )}
      {isMoney && str && !parsed ? <div className="error">Please enter a dollar amount, like 1250 or 1,250.00.</div> : null}
      {isMoney && parsed ? <div className="hint">= {formatCurrency(parsed)}</div> : null}
    </div>
  );
}
