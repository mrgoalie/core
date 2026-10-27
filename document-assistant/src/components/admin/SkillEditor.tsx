"use client";
import { ArrowDown, ArrowUp, ChevronRight, Lock, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { APPROVED_ICONS } from "@/lib/icons";
import { ANALYZERS, DOCUMENT_CATEGORIES, EXTRACTED_KEYS, MATTER_FIELDS } from "@/lib/matter-fields";
import {
  CALC_OPERATIONS,
  INPUT_TYPES,
  OUTPUT_FORMATS,
  SYSTEM_TAGS,
  detectUnsupportedRequests,
  slugify,
  type SkillConfigInput,
} from "@/lib/skill-config";
import { SkillIcon } from "../SkillIcon";
import { Alert, Button, ErrorAlert, Switch } from "../ui";

type Cfg = SkillConfigInput & {
  inputs: NonNullable<SkillConfigInput["inputs"]>;
  documents: NonNullable<SkillConfigInput["documents"]>;
  calculations: NonNullable<SkillConfigInput["calculations"]>;
};
type Input = Cfg["inputs"][number];
type Doc = Cfg["documents"][number];
type Calc = Cfg["calculations"][number];
type Section = NonNullable<Cfg["drafting"]["sections"]>[number];
type Operand = Calc["operands"][number];
export interface TemplateOption {
  id: string;
  name: string;
  isDemonstration: boolean;
  hasBody: boolean;
}

function normalize(c: SkillConfigInput): Cfg {
  return {
    ...c,
    inputs: c.inputs ?? [],
    documents: c.documents ?? [],
    calculations: c.calculations ?? [],
    notices: c.notices ?? [],
    drafting: { tone: c.drafting?.tone ?? "", sections: c.drafting?.sections ?? [] },
  } as Cfg;
}

const move = <T,>(arr: T[], i: number, d: -1 | 1) => {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const a = [...arr];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
};

function ItemShell({ title, sub, open, onToggle, onUp, onDown, onDelete, children, readOnly, label }: { title: ReactNode; sub?: ReactNode; open: boolean; onToggle: () => void; onUp: () => void; onDown: () => void; onDelete: () => void; children: ReactNode; readOnly?: boolean; label: string }) {
  return (
    <div className="item-editor">
      <div className="item-head">
        <button type="button" className="icon-btn" aria-expanded={open} onClick={onToggle} aria-label={`${open ? "Close" : "Edit"} ${label}`}>
          <ChevronRight size={18} aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : undefined }} />
        </button>
        <div className="ih-title">
          {title}
          {sub ? <div className="small muted" style={{ fontWeight: 400 }}>{sub}</div> : null}
        </div>
        {!readOnly ? (
          <div className="item-actions">
            <button type="button" className="icon-btn" onClick={onUp} aria-label={`Move ${label} up`}>
              <ArrowUp size={16} aria-hidden="true" />
            </button>
            <button type="button" className="icon-btn" onClick={onDown} aria-label={`Move ${label} down`}>
              <ArrowDown size={16} aria-hidden="true" />
            </button>
            <button type="button" className="icon-btn" onClick={onDelete} aria-label={`Delete ${label}`}>
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
      {open ? <div className="item-body">{children}</div> : null}
    </div>
  );
}

function Txt({ id, label, value, onChange, hint, multiline, rows, disabled, required }: { id: string; label: string; value: string | undefined; onChange: (v: string) => void; hint?: string; multiline?: boolean; rows?: number; disabled?: boolean; required?: boolean }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span className="req" aria-hidden="true">*</span> : null}
      </label>
      {hint ? <div className="hint" id={`${id}-h`}>{hint}</div> : null}
      {multiline ? (
        <textarea id={id} rows={rows ?? 4} value={value ?? ""} disabled={disabled} aria-describedby={hint ? `${id}-h` : undefined} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} type="text" value={value ?? ""} disabled={disabled} aria-describedby={hint ? `${id}-h` : undefined} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function Sel({ id, label, value, onChange, options, disabled, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean; hint?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? <div className="hint">{hint}</div> : null}
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Check({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function ShowWhenEditor({ idp, value, onChange, inputs, disabled, noun }: { idp: string; value: { inputId: string; equals: string[] } | undefined; onChange: (v: { inputId: string; equals: string[] } | undefined) => void; inputs: Input[]; disabled?: boolean; noun: string }) {
  const choices = inputs.filter((i) => ["select", "yesno", "checkboxes"].includes(i.type));
  if (!choices.length) return null;
  const src = choices.find((i) => i.id === value?.inputId);
  const opts = src ? (src.type === "yesno" ? ["Yes", "No"] : (src.options ?? [])) : [];
  return (
    <fieldset className="field">
      <legend>Only when…</legend>
      <div className="hint">Leave as “Always” unless this {noun} depends on an earlier answer.</div>
      <select aria-label={`Condition for this ${noun}`} id={`${idp}-sw`} value={value?.inputId ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value ? { inputId: e.target.value, equals: [] } : undefined)}>
        <option value="">Always</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            When “{c.label}” is…
          </option>
        ))}
      </select>
      {src ? (
        <div style={{ marginTop: 8 }}>
          {opts.map((o) => (
            <Check key={o} label={o} disabled={disabled} checked={value!.equals.includes(o)} onChange={(v) => onChange({ inputId: src.id, equals: v ? [...value!.equals, o] : value!.equals.filter((x) => x !== o) })} />
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

const BLOCKS = [
  { key: "matter", label: "Select an authorized Clio matter", locked: true },
  { key: "matterInfo", label: "Retrieve permitted matter information" },
  { key: "docs", label: "Select supporting documents" },
  { key: "uploads", label: "Upload additional documents" },
  { key: "extract", label: "Extract document text" },
  { key: "summarize", label: "Summarize records" },
  { key: "questions", label: "Ask employee questions" },
  { key: "calcs", label: "Deterministic calculations" },
  { key: "ai", label: "Draft text with the approved AI provider" },
  { key: "word", label: "Generate Word document" },
  { key: "pdf", label: "Generate PDF" },
  { key: "package", label: "Assemble PDF package" },
  { key: "sources", label: "Show source references", locked: true },
  { key: "missing", label: "Identify missing information", locked: true },
  { key: "approval", label: "Request attorney approval", locked: true },
  { key: "history", label: "Save work history", locked: true },
];

export function SkillEditor({
  initial,
  templates,
  readOnly,
  onSave,
  saving,
  error,
  saveLabel,
  showSummary,
}: {
  initial: SkillConfigInput;
  templates: TemplateOption[];
  readOnly?: boolean;
  onSave: (cfg: SkillConfigInput, summary: string) => Promise<boolean>;
  saving: boolean;
  error: { message: string; details?: { field: string; message: string }[] } | null;
  saveLabel: string;
  showSummary?: boolean;
}) {
  const [cfg, setCfg] = useState<Cfg>(() => normalize(structuredClone(initial)));
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const edit = (fn: (d: Cfg) => void) => {
    setCfg((prev) => {
      const d = structuredClone(prev);
      fn(d);
      return d;
    });
    setDirty(true);
  };
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const ro = readOnly;
  const warnings = useMemo(() => detectUnsupportedRequests(`${cfg.purpose} ${(cfg.drafting.sections ?? []).map((s) => s.instructions ?? "").join(" ")}`), [cfg.purpose, cfg.drafting.sections]);
  const ids = () => [...cfg.inputs.map((i) => i.id), ...cfg.calculations.map((c) => c.id)];
  const tableInputs = cfg.inputs.filter((i) => i.type === "table");
  const numericSources = [
    ...cfg.inputs.filter((i) => i.type === "currency" || i.type === "number").map((i) => ({ value: `input:${i.id}:`, label: i.label })),
    ...tableInputs.flatMap((t) => (t.columns ?? []).filter((c) => c.type === "currency" || c.type === "number").map((c) => ({ value: `input:${t.id}:${c.id}`, label: `${t.label} → ${c.label}` }))),
  ];
  const formats = new Set(cfg.output.formats ?? []);
  const blockOn: Record<string, boolean> = {
    matterInfo: (cfg.matter?.showFields?.length ?? 0) > 0 || cfg.inputs.some((i) => i.prefill?.source === "matter" || i.type === "matter_field"),
    docs: cfg.documents.length > 0,
    uploads: cfg.allowUploads !== false,
    extract: cfg.documents.some((d) => (d.analyzer ?? "none") !== "none"),
    summarize: cfg.documents.some((d) => d.analyzer === "summary"),
    questions: cfg.inputs.length > 0,
    calcs: cfg.calculations.length > 0,
    ai: (cfg.drafting.sections ?? []).some((s) => s.mode === "ai"),
    word: formats.has("docx"),
    pdf: formats.has("pdf"),
    package: formats.has("pdf_package"),
  };

  async function save() {
    const ok = await onSave(cfg, summary);
    if (ok) {
      setDirty(false);
      setSummary("");
    }
  }

  const section = (id: string, title: string, intro: ReactNode, body: ReactNode) => (
    <section className="card" id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {intro ? <p className="muted">{intro}</p> : null}
      {body}
    </section>
  );

  const letter = cfg.output.letter ?? { recipientInputIds: [], reLines: [], salutation: "To whom it may concern:", signatureLines: [], listEnclosures: true };

  return (
    <div className="editor-layout">
      <div className="stack-lg">
        {ro ? <Alert tone="info">You can review this skill. Only a Firm Administrator can change it.</Alert> : null}
        <section className="card card-flat" aria-labelledby="blocks-h">
          <h2 id="blocks-h" style={{ fontSize: "1.15rem" }}>
            Building blocks this skill uses
          </h2>
          <p className="small muted">Skills are assembled from tested building blocks. Locked blocks are required by firm policy for every skill.</p>
          <ul className="block-list">
            {BLOCKS.map((b) => (
              <li key={b.key} className={b.locked ? "locked" : blockOn[b.key] ? "on" : undefined}>
                {b.locked ? <Lock size={16} aria-hidden="true" /> : <span aria-hidden="true">{blockOn[b.key] ? "✓" : "○"}</span>}
                <span>
                  {b.label}
                  <span className="sr-only">{b.locked ? " (always on)" : blockOn[b.key] ? " (in use)" : " (not used)"}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
            Need something these blocks can&apos;t do — for example sending email, filing with a court, or updating another system? That requires development work and an approved integration; it can&apos;t be added by editing a skill.
          </p>
        </section>

        {section(
          "basics",
          "1. Name and description",
          "What employees see on the home screen.",
          <div className="stack">
            <Txt id="sk-name" label="Skill name" required value={cfg.name} disabled={ro} onChange={(v) => edit((d) => void (d.name = v))} hint="Example: Prepare Settlement Disbursement" />
            <Txt id="sk-desc" label="Short description" required multiline rows={2} value={cfg.shortDescription} disabled={ro} onChange={(v) => edit((d) => void (d.shortDescription = v))} />
            <Txt id="sk-instr" label="Employee instructions" multiline rows={3} value={cfg.employeeInstructions} disabled={ro} onChange={(v) => edit((d) => void (d.employeeInstructions = v))} hint="A short explanation shown to employees while they use the skill." />
            <Txt id="sk-cat" label="Category" value={cfg.category} disabled={ro} onChange={(v) => edit((d) => void (d.category = v))} />
            <fieldset className="field">
              <legend>Icon</legend>
              <div className="swatches">
                {APPROVED_ICONS.map((ic) => (
                  <button key={ic.key} type="button" className="icon-btn" style={{ width: 52, height: 52, borderWidth: cfg.icon === ic.key ? 3 : 1.5, borderColor: cfg.icon === ic.key ? "var(--accent)" : undefined }} aria-pressed={cfg.icon === ic.key} aria-label={ic.label} disabled={ro} onClick={() => edit((d) => void (d.icon = ic.key))}>
                    <SkillIcon name={ic.key} size={24} />
                  </button>
                ))}
              </div>
            </fieldset>
          </div>,
        )}

        {section(
          "purpose",
          "2. What should this skill do?",
          "Describe the document in plain English, as you would to a new paralegal. This becomes the drafting brief. It cannot override firm safety rules.",
          <div className="stack">
            <Txt id="sk-purpose" label="Instructions" required multiline rows={7} value={cfg.purpose} disabled={ro} onChange={(v) => edit((d) => void (d.purpose = v))} />
            {warnings.map((w, i) => (
              <Alert key={i} tone="warning">
                {w}
              </Alert>
            ))}
            <Txt id="sk-tone" label="Tone of writing" value={cfg.drafting.tone} disabled={ro} onChange={(v) => edit((d) => void (d.drafting.tone = v))} />
            <Txt
              id="sk-notices"
              label="Notices shown to employees (one per line)"
              multiline
              rows={2}
              value={(cfg.notices ?? []).join("\n")}
              disabled={ro}
              onChange={(v) => edit((d) => void (d.notices = v.split("\n").map((x) => x.trim()).filter(Boolean)))}
            />
          </div>,
        )}

        {section(
          "case",
          "3. Case information",
          "Every skill starts with choosing a case the employee is allowed to see. Choose which case details are shown.",
          <div className="grid-2">
            {MATTER_FIELDS.map((f) => (
              <Check
                key={f.key}
                label={f.label}
                disabled={ro}
                checked={(cfg.matter?.showFields ?? []).includes(f.key)}
                onChange={(v) => edit((d) => void (d.matter = { showFields: v ? [...(d.matter?.showFields ?? []), f.key] : (d.matter?.showFields ?? []).filter((x) => x !== f.key) }))}
              />
            ))}
          </div>,
        )}

        {section(
          "questions",
          "4. Questions for employees",
          "Add the information employees should provide or confirm. Answers can be filled in automatically from the case file or from documents.",
          <div>
            {cfg.inputs.length === 0 ? <div className="empty">No questions yet.</div> : null}
            {cfg.inputs.map((inp, i) => (
              <ItemShell
                key={inp.id}
                label={`question ${inp.label}`}
                readOnly={ro}
                title={
                  <>
                    {inp.label} {inp.required ? <span className="badge badge-warning">Required</span> : <span className="badge badge-neutral">Optional</span>}
                  </>
                }
                sub={`${INPUT_TYPES.find((t) => t.key === inp.type)?.label} · placeholder {{${inp.id}}}`}
                open={open === `in-${inp.id}`}
                onToggle={() => setOpen(open === `in-${inp.id}` ? null : `in-${inp.id}`)}
                onUp={() => edit((d) => void (d.inputs = move(d.inputs, i, -1)))}
                onDown={() => edit((d) => void (d.inputs = move(d.inputs, i, 1)))}
                onDelete={() => edit((d) => void d.inputs.splice(i, 1))}
              >
                <div className="stack">
                  <Txt id={`in-${i}-label`} label="Question" value={inp.label} disabled={ro} onChange={(v) => edit((d) => void (d.inputs[i].label = v))} />
                  <Sel id={`in-${i}-type`} label="Type of answer" value={inp.type} disabled={ro} options={INPUT_TYPES.map((t) => ({ value: t.key, label: t.label }))} onChange={(v) => edit((d) => {
                    d.inputs[i].type = v as Input["type"];
                    if (v === "table" && !d.inputs[i].columns?.length) d.inputs[i].columns = [{ id: "description", label: "Description", type: "text", required: true }, { id: "amount", label: "Amount", type: "currency", required: true }];
                    if ((v === "select" || v === "checkboxes") && !d.inputs[i].options?.length) d.inputs[i].options = ["Option 1", "Option 2"];
                    if (v === "matter_field" && !d.inputs[i].matterField) d.inputs[i].matterField = "client_name";
                  })} />
                  <Check label="Required" checked={Boolean(inp.required)} disabled={ro} onChange={(v) => edit((d) => void (d.inputs[i].required = v))} />
                  <Txt id={`in-${i}-help`} label="Help text" value={inp.helpText} disabled={ro} onChange={(v) => edit((d) => void (d.inputs[i].helpText = v || undefined))} />
                  <Txt id={`in-${i}-group`} label="Heading to group it under" value={inp.group} disabled={ro} onChange={(v) => edit((d) => void (d.inputs[i].group = v || undefined))} hint="Questions with the same heading are shown together." />
                  {inp.type === "select" || inp.type === "checkboxes" ? (
                    <Txt id={`in-${i}-opts`} label="Choices (one per line)" multiline rows={4} value={(inp.options ?? []).join("\n")} disabled={ro} onChange={(v) => edit((d) => void (d.inputs[i].options = v.split("\n").map((x) => x.trim()).filter(Boolean)))} />
                  ) : null}
                  {inp.type === "matter_field" ? (
                    <Sel id={`in-${i}-mf`} label="Case-file field" value={inp.matterField ?? "client_name"} disabled={ro} options={MATTER_FIELDS.map((f) => ({ value: f.key, label: f.label }))} onChange={(v) => edit((d) => void (d.inputs[i].matterField = v as Input["matterField"]))} />
                  ) : null}
                  {inp.type === "table" ? (
                    <fieldset className="field">
                      <legend>Columns</legend>
                      {(inp.columns ?? []).map((c, ci) => (
                        <div key={ci} className="row" style={{ alignItems: "flex-end", marginBottom: 8 }}>
                          <div style={{ flex: 2, minWidth: 160 }}>
                            <Txt id={`in-${i}-c${ci}`} label="Column name" value={c.label} disabled={ro} onChange={(v) => edit((d) => {
                              const col = d.inputs[i].columns![ci];
                              col.label = v;
                              if (!col.id || col.id.startsWith("col")) col.id = slugify(v, d.inputs[i].columns!.filter((_, k) => k !== ci).map((x) => x.id));
                            })} />
                          </div>
                          <div style={{ flex: 1, minWidth: 140 }}>
                            <Sel id={`in-${i}-ct${ci}`} label="Type" value={c.type} disabled={ro} options={[{ value: "text", label: "Short text" }, { value: "longtext", label: "Paragraph" }, { value: "currency", label: "Dollar amount" }, { value: "number", label: "Number" }, { value: "date", label: "Date" }]} onChange={(v) => edit((d) => void (d.inputs[i].columns![ci].type = v as never))} />
                          </div>
                          <Check label="Required" checked={Boolean(c.required)} disabled={ro} onChange={(v) => edit((d) => void (d.inputs[i].columns![ci].required = v))} />
                          {!ro ? (
                            <button type="button" className="icon-btn" aria-label={`Remove column ${c.label}`} onClick={() => edit((d) => void d.inputs[i].columns!.splice(ci, 1))}>
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      ))}
                      {!ro ? (
                        <Button size="sm" variant="secondary" onClick={() => edit((d) => void (d.inputs[i].columns = [...(d.inputs[i].columns ?? []), { id: `col${(d.inputs[i].columns?.length ?? 0) + 1}`, label: "New column", type: "text", required: false }]))}>
                          <Plus size={16} aria-hidden="true" /> Add column
                        </Button>
                      ) : null}
                    </fieldset>
                  ) : null}
                  {inp.type !== "matter_field" && inp.type !== "file" ? (
                    <Sel
                      id={`in-${i}-pf`}
                      label="Fill in automatically from"
                      value={inp.prefill ? (inp.prefill.source === "matter" ? `m:${inp.prefill.field}` : `x:${inp.prefill.key}`) : ""}
                      disabled={ro}
                      options={[{ value: "", label: "Nothing — the employee answers it" }, ...MATTER_FIELDS.map((f) => ({ value: `m:${f.key}`, label: `Case file: ${f.label}` })), ...EXTRACTED_KEYS.map((k) => ({ value: `x:${k.key}`, label: `Documents: ${k.label}` }))]}
                      onChange={(v) => edit((d) => void (d.inputs[i].prefill = !v ? undefined : v.startsWith("m:") ? { source: "matter", field: v.slice(2) as never } : { source: "extracted", key: v.slice(2) as never }))}
                    />
                  ) : null}
                  <Txt id={`in-${i}-def`} label="Default answer" value={inp.defaultValue} disabled={ro} onChange={(v) => edit((d) => void (d.inputs[i].defaultValue = v || undefined))} />
                  <Check label="Must be supported by a record (flag it if staff type it in)" checked={Boolean(inp.requiresSource)} disabled={ro} onChange={(v) => edit((d) => void (d.inputs[i].requiresSource = v))} />
                  <ShowWhenEditor idp={`in-${i}`} noun="question" value={inp.showWhen} inputs={cfg.inputs.filter((x) => x.id !== inp.id)} disabled={ro} onChange={(v) => edit((d) => void (d.inputs[i].showWhen = v))} />
                </div>
              </ItemShell>
            ))}
            {!ro ? (
              <div style={{ marginTop: 14 }}>
                <Button variant="secondary" onClick={() => {
                  const id = slugify("new question", ids());
                  edit((d) => void d.inputs.push({ id, label: "New question", type: "text", required: false }));
                  setOpen(`in-${id}`);
                }}>
                  <Plus size={18} aria-hidden="true" /> Add a question
                </Button>
              </div>
            ) : null}
          </div>,
        )}

        {section(
          "documents",
          "5. Required documents",
          "The checklist employees see. Matching documents in the case file are found automatically by type.",
          <div>
            {cfg.documents.length === 0 ? <div className="empty">No documents required.</div> : null}
            {cfg.documents.map((doc, i) => (
              <ItemShell
                key={doc.id}
                label={`document ${doc.label}`}
                readOnly={ro}
                title={
                  <>
                    {doc.label} {doc.required !== false ? <span className="badge badge-warning">Required</span> : <span className="badge badge-neutral">Optional</span>}
                  </>
                }
                sub={ANALYZERS.find((a) => a.key === (doc.analyzer ?? "none"))?.label}
                open={open === `doc-${doc.id}`}
                onToggle={() => setOpen(open === `doc-${doc.id}` ? null : `doc-${doc.id}`)}
                onUp={() => edit((d) => void (d.documents = move(d.documents, i, -1)))}
                onDown={() => edit((d) => void (d.documents = move(d.documents, i, 1)))}
                onDelete={() => edit((d) => void d.documents.splice(i, 1))}
              >
                <div className="stack">
                  <Txt id={`doc-${i}-l`} label="Name on the checklist" value={doc.label} disabled={ro} onChange={(v) => edit((d) => void (d.documents[i].label = v))} />
                  <Txt id={`doc-${i}-d`} label="Description" value={doc.description} disabled={ro} onChange={(v) => edit((d) => void (d.documents[i].description = v || undefined))} />
                  <fieldset className="field">
                    <legend>Which kinds of documents count</legend>
                    <div className="grid-2">
                      {DOCUMENT_CATEGORIES.map((c) => (
                        <Check key={c.key} label={c.label} disabled={ro} checked={doc.categories.includes(c.key)} onChange={(v) => edit((d) => void (d.documents[i].categories = v ? [...d.documents[i].categories, c.key] : d.documents[i].categories.filter((x) => x !== c.key)))} />
                      ))}
                    </div>
                  </fieldset>
                  <Check label="Required" checked={doc.required !== false} disabled={ro} onChange={(v) => edit((d) => void (d.documents[i].required = v))} />
                  <Check label="More than one allowed" checked={doc.multiple !== false} disabled={ro} onChange={(v) => edit((d) => void (d.documents[i].multiple = v))} />
                  <Sel id={`doc-${i}-a`} label="What to do with its contents" value={doc.analyzer ?? "none"} disabled={ro} options={ANALYZERS.map((a) => ({ value: a.key, label: a.label }))} onChange={(v) => edit((d) => void (d.documents[i].analyzer = v as Doc["analyzer"]))} />
                  <ShowWhenEditor idp={`doc-${i}`} noun="document" value={doc.appliesWhen} inputs={cfg.inputs} disabled={ro} onChange={(v) => edit((d) => void (d.documents[i].appliesWhen = v))} />
                </div>
              </ItemShell>
            ))}
            {!ro ? (
              <div style={{ marginTop: 14 }} className="row">
                <Button variant="secondary" onClick={() => {
                  const id = slugify("document", cfg.documents.map((d) => d.id));
                  edit((d) => void d.documents.push({ id, label: "New document", categories: ["other"], required: true, multiple: true, analyzer: "none" }));
                  setOpen(`doc-${id}`);
                }}>
                  <Plus size={18} aria-hidden="true" /> Add a document
                </Button>
                <Switch label="Employees may upload documents" checked={cfg.allowUploads !== false} onChange={(v) => edit((d) => void (d.allowUploads = v))} />
              </div>
            ) : null}
          </div>,
        )}

        {section(
          "calculations",
          "6. Calculations",
          "Exact arithmetic done by the system — never by AI. Use these for totals, fees, and net amounts.",
          <div>
            {cfg.calculations.length === 0 ? <div className="empty">No calculations.</div> : null}
            {cfg.calculations.map((c, i) => (
              <ItemShell
                key={c.id}
                label={`calculation ${c.label}`}
                readOnly={ro}
                title={c.label}
                sub={`${CALC_OPERATIONS.find((o) => o.key === c.operation)?.label} · placeholder {{${c.id}}}`}
                open={open === `calc-${c.id}`}
                onToggle={() => setOpen(open === `calc-${c.id}` ? null : `calc-${c.id}`)}
                onUp={() => edit((d) => void (d.calculations = move(d.calculations, i, -1)))}
                onDown={() => edit((d) => void (d.calculations = move(d.calculations, i, 1)))}
                onDelete={() => edit((d) => void d.calculations.splice(i, 1))}
              >
                <div className="stack">
                  <Txt id={`c-${i}-l`} label="Name" value={c.label} disabled={ro} onChange={(v) => edit((d) => void (d.calculations[i].label = v))} />
                  <Sel id={`c-${i}-op`} label="What to do" value={c.operation} disabled={ro} options={CALC_OPERATIONS.map((o) => ({ value: o.key, label: `${o.label} — uses ${o.operands}` }))} onChange={(v) => edit((d) => void (d.calculations[i].operation = v as Calc["operation"]))} />
                  <fieldset className="field">
                    <legend>Values, in order</legend>
                    {c.operands.map((o, oi) => (
                      <OperandRow
                        key={oi}
                        idp={`c-${i}-o${oi}`}
                        operand={o}
                        disabled={ro}
                        numericSources={numericSources}
                        priorCalcs={cfg.calculations.slice(0, i)}
                        onChange={(v) => edit((d) => void (d.calculations[i].operands[oi] = v))}
                        onRemove={() => edit((d) => void d.calculations[i].operands.splice(oi, 1))}
                      />
                    ))}
                    {!ro ? (
                      <Button size="sm" variant="secondary" onClick={() => edit((d) => void d.calculations[i].operands.push({ kind: "constant", value: "0" }))}>
                        <Plus size={16} aria-hidden="true" /> Add a value
                      </Button>
                    ) : null}
                  </fieldset>
                  <Sel id={`c-${i}-f`} label="Show the result as" value={c.format ?? "currency"} disabled={ro} options={[{ value: "currency", label: "Dollars" }, { value: "number", label: "Number" }, { value: "percent", label: "Percent" }]} onChange={(v) => edit((d) => void (d.calculations[i].format = v as Calc["format"]))} />
                  <Check label="Show in the document" checked={c.showInDocument !== false} disabled={ro} onChange={(v) => edit((d) => void (d.calculations[i].showInDocument = v))} />
                </div>
              </ItemShell>
            ))}
            {!ro ? (
              <div style={{ marginTop: 14 }}>
                <Button variant="secondary" onClick={() => {
                  const id = slugify("total", ids());
                  edit((d) => void d.calculations.push({ id, label: "New total", operation: "add", operands: [], format: "currency", showInDocument: true }));
                  setOpen(`calc-${id}`);
                }}>
                  <Plus size={18} aria-hidden="true" /> Add a calculation
                </Button>
              </div>
            ) : null}
          </div>,
        )}

        {section(
          "sections",
          "7. Sections of the document",
          "Each section is either written by the AI from the facts (following your instructions) or fixed text you write. Use {{placeholders}} in fixed text.",
          <div>
            {(cfg.drafting.sections ?? []).map((s, i) => (
              <ItemShell
                key={s.id}
                label={`section ${s.heading || s.id}`}
                readOnly={ro}
                title={s.heading || <span className="muted">(no heading)</span>}
                sub={s.mode === "ai" ? "Written by AI from the facts" : "Fixed text"}
                open={open === `sec-${s.id}`}
                onToggle={() => setOpen(open === `sec-${s.id}` ? null : `sec-${s.id}`)}
                onUp={() => edit((d) => void (d.drafting.sections = move(d.drafting.sections!, i, -1)))}
                onDown={() => edit((d) => void (d.drafting.sections = move(d.drafting.sections!, i, 1)))}
                onDelete={() => edit((d) => void d.drafting.sections!.splice(i, 1))}
              >
                <SectionBody s={s} i={i} ro={ro} edit={edit} tableInputs={tableInputs} inputs={cfg.inputs} />
              </ItemShell>
            ))}
            {!ro ? (
              <div style={{ marginTop: 14 }}>
                <Button variant="secondary" onClick={() => {
                  const id = slugify("section", (cfg.drafting.sections ?? []).map((s) => s.id));
                  edit((d) => void d.drafting.sections!.push({ id, heading: "New section", mode: "ai", instructions: "Describe what this section should say." }));
                  setOpen(`sec-${id}`);
                }}>
                  <Plus size={18} aria-hidden="true" /> Add a section
                </Button>
              </div>
            ) : null}
          </div>,
        )}

        {section(
          "output",
          "8. What it produces",
          null,
          <div className="stack">
            <fieldset className="field">
              <legend>Outputs</legend>
              {OUTPUT_FORMATS.map((f) => (
                <Check key={f.key} label={f.label} disabled={ro} checked={formats.has(f.key)} onChange={(v) => edit((d) => {
                  const set = new Set(d.output.formats ?? []);
                  if (v) set.add(f.key);
                  else set.delete(f.key);
                  d.output.formats = [...set];
                  if (f.key === "pdf_package" && v && !d.output.package) d.output.package = { title: d.output.documentTitle ?? "Exhibit Package", includeCoverSheet: true, includeExhibitIndex: true, slipSheets: true, batesPrefix: "FLG", batesStart: 1, pageNumbers: true, bookmarks: true };
                })} />
              ))}
            </fieldset>
            <Txt id="out-title" label="Document title" value={cfg.output.documentTitle} disabled={ro} onChange={(v) => edit((d) => void (d.output.documentTitle = v))} />
            <Sel id="out-style" label="Layout" value={cfg.output.style ?? "report"} disabled={ro} options={[{ value: "report", label: "Report (title and case summary at the top)" }, { value: "letter", label: "Letter (date, address, re: lines, signature)" }]} onChange={(v) => edit((d) => {
              d.output.style = v as "letter" | "report";
              if (v === "letter" && !d.output.letter) d.output.letter = { recipientInputIds: [], reLines: [{ label: "Our Client", source: { kind: "matter", field: "client_name" } }], salutation: "To whom it may concern:", signatureLines: ["Very truly yours,", "", "{{firm_name}}", "", "", "______________________________", "{{responsible_attorney}}"], listEnclosures: true };
            })} />
            {cfg.output.style === "letter" ? (
              <fieldset className="panel stack">
                <legend style={{ fontWeight: 700 }}>Letter details</legend>
                <div className="field">
                  <span className="field-label">Address block uses these answers</span>
                  {cfg.inputs.filter((i) => ["text", "longtext"].includes(i.type)).map((inp) => (
                    <Check key={inp.id} label={inp.label} disabled={ro} checked={(letter.recipientInputIds ?? []).includes(inp.id)} onChange={(v) => edit((d) => {
                      const l = d.output.letter!;
                      l.recipientInputIds = v ? [...(l.recipientInputIds ?? []), inp.id] : (l.recipientInputIds ?? []).filter((x) => x !== inp.id);
                    })} />
                  ))}
                </div>
                <div className="field">
                  <span className="field-label">“RE:” lines</span>
                  {(letter.reLines ?? []).map((l, li) => (
                    <div key={li} className="row" style={{ alignItems: "flex-end" }}>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <Txt id={`re-${li}-l`} label="Label" value={l.label} disabled={ro} onChange={(v) => edit((d) => void (d.output.letter!.reLines![li].label = v))} />
                      </div>
                      <div style={{ flex: 2, minWidth: 200 }}>
                        <Sel id={`re-${li}-s`} label="Value" value={l.source.kind === "matter" ? `m:${l.source.field}` : `i:${l.source.inputId}`} disabled={ro}
                          options={[...MATTER_FIELDS.map((f) => ({ value: `m:${f.key}`, label: `Case file: ${f.label}` })), ...cfg.inputs.map((inp) => ({ value: `i:${inp.id}`, label: `Answer: ${inp.label}` }))]}
                          onChange={(v) => edit((d) => void (d.output.letter!.reLines![li].source = v.startsWith("m:") ? { kind: "matter", field: v.slice(2) as never } : { kind: "input", inputId: v.slice(2) }))} />
                      </div>
                      {!ro ? (
                        <button type="button" className="icon-btn" aria-label={`Remove line ${l.label}`} onClick={() => edit((d) => void d.output.letter!.reLines!.splice(li, 1))}>
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {!ro ? (
                    <div>
                      <Button size="sm" variant="secondary" onClick={() => edit((d) => void (d.output.letter!.reLines = [...(d.output.letter!.reLines ?? []), { label: "Matter", source: { kind: "matter", field: "matter_number" } }]))}>
                        <Plus size={16} aria-hidden="true" /> Add a line
                      </Button>
                    </div>
                  ) : null}
                </div>
                <Txt id="out-sal" label="Greeting" value={letter.salutation} disabled={ro} onChange={(v) => edit((d) => void (d.output.letter!.salutation = v))} />
                <Txt id="out-sig" label="Signature block (one line per row)" multiline rows={5} value={(letter.signatureLines ?? []).join("\n")} disabled={ro} onChange={(v) => edit((d) => void (d.output.letter!.signatureLines = v.split("\n")))} />
                <Check label="List the selected documents as enclosures" checked={letter.listEnclosures !== false} disabled={ro} onChange={(v) => edit((d) => void (d.output.letter!.listEnclosures = v))} />
              </fieldset>
            ) : null}
            <Sel
              id="out-tpl"
              label="Word template"
              value={cfg.output.templateId ?? ""}
              disabled={ro}
              hint="Upload the firm's templates under Templates. The drafted content is placed where the template has {{@body}}."
              options={[{ value: "", label: "Demonstration firm template (default)" }, ...templates.map((t) => ({ value: t.id, label: `${t.name}${t.isDemonstration ? " (demonstration)" : ""}${t.hasBody ? "" : " — missing {{@body}}"}` }))]}
              onChange={(v) => edit((d) => void (d.output.templateId = v || null))}
            />
            {formats.has("pdf_package") && cfg.output.package ? (
              <fieldset className="panel stack">
                <legend style={{ fontWeight: 700 }}>Package settings</legend>
                <Txt id="pk-title" label="Package title" value={cfg.output.package.title} disabled={ro} onChange={(v) => edit((d) => void (d.output.package!.title = v))} />
                <Txt id="pk-bates" label="Bates prefix" value={cfg.output.package.batesPrefix} disabled={ro} onChange={(v) => edit((d) => void (d.output.package!.batesPrefix = v.toUpperCase()))} hint="Up to 10 capital letters, numbers or dashes. Example: FLG" />
                {(["includeCoverSheet", "includeExhibitIndex", "slipSheets", "pageNumbers", "bookmarks"] as const).map((k) => (
                  <Check key={k} label={{ includeCoverSheet: "Cover sheet", includeExhibitIndex: "Exhibit index", slipSheets: "Exhibit slip sheets", pageNumbers: "Page numbers", bookmarks: "PDF bookmarks" }[k]} disabled={ro} checked={cfg.output.package![k] !== false} onChange={(v) => edit((d) => void (d.output.package![k] = v))} />
                ))}
              </fieldset>
            ) : null}
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Placeholders available for templates and fixed text</summary>
              <ul className="small" style={{ columns: 2 }}>
                {SYSTEM_TAGS.map((t) => (
                  <li key={t.tag}>
                    <code>{`{{${t.tag === "body" ? "@body" : t.tag}}}`}</code> — {t.label}
                  </li>
                ))}
                {MATTER_FIELDS.map((f) => (
                  <li key={f.key}>
                    <code>{`{{${f.key}}}`}</code> — {f.label}
                  </li>
                ))}
                {[...cfg.inputs, ...cfg.calculations].map((x) => (
                  <li key={x.id}>
                    <code>{`{{${x.id}}}`}</code> — {x.label}
                  </li>
                ))}
              </ul>
            </details>
          </div>,
        )}

        {section(
          "approval",
          "9. Attorney review",
          null,
          <div className="stack">
            <Alert tone="info" title="Required by firm policy">
              Every document this skill creates is a draft until an attorney reviewer approves it. This can&apos;t be switched off for any skill.
            </Alert>
            <Txt id="ap-guid" label="Guidance for the reviewing attorney" multiline rows={3} value={cfg.approval?.reviewerGuidance} disabled={ro} onChange={(v) => edit((d) => void (d.approval = { reviewerRole: "ATTORNEY_REVIEWER", reviewerGuidance: v || undefined }))} />
          </div>,
        )}

        {!ro ? (
          <section className="card" style={{ position: "sticky", bottom: 12, borderWidth: 2, borderColor: dirty ? "var(--accent)" : undefined, zIndex: 5 }} aria-label="Save">
            <ErrorAlert error={error} />
            <div className="row" style={{ marginTop: error ? 12 : 0 }}>
              {showSummary ? (
                <div style={{ flex: 1, minWidth: 240 }}>
                  <label htmlFor="sk-summary" className="sr-only">
                    Describe what you changed
                  </label>
                  <input id="sk-summary" type="text" placeholder="Describe what you changed (optional)" value={summary} onChange={(e) => setSummary(e.target.value)} />
                </div>
              ) : (
                <span className="spacer" />
              )}
              <span className="small muted">{dirty ? "Unsaved changes" : "No unsaved changes"}</span>
              <Button size="lg" busy={saving} onClick={save}>
                {saveLabel}
              </Button>
            </div>
          </section>
        ) : null}
      </div>
      <nav className="toc" aria-label="Skill sections">
        {[
          ["basics", "Name and description"],
          ["purpose", "What it should do"],
          ["case", "Case information"],
          ["questions", "Questions"],
          ["documents", "Required documents"],
          ["calculations", "Calculations"],
          ["sections", "Document sections"],
          ["output", "What it produces"],
          ["approval", "Attorney review"],
        ].map(([id, l]) => (
          <a key={id} href={`#${id}`}>
            {l}
          </a>
        ))}
      </nav>
    </div>
  );
}

function OperandRow({ idp, operand, onChange, onRemove, numericSources, priorCalcs, disabled }: { idp: string; operand: Operand; onChange: (o: Operand) => void; onRemove: () => void; numericSources: { value: string; label: string }[]; priorCalcs: Calc[]; disabled?: boolean }) {
  const value = operand.kind === "input" ? `input:${operand.inputId}:${operand.column ?? ""}` : operand.kind === "calc" ? `calc:${operand.calcId}` : operand.kind === "matter" ? `matter:${operand.field}` : "constant";
  return (
    <div className="row" style={{ alignItems: "flex-end", marginBottom: 8 }}>
      <div style={{ flex: 2, minWidth: 220 }}>
        <Sel
          id={`${idp}-k`}
          label="Value"
          value={value}
          disabled={disabled}
          options={[
            ...numericSources.map((s) => ({ value: s.value, label: `Answer: ${s.label}` })),
            ...priorCalcs.map((c) => ({ value: `calc:${c.id}`, label: `Calculation: ${c.label}` })),
            { value: "matter:policy_limits", label: "Case file: Liability policy limits" },
            { value: "matter:um_limits", label: "Case file: UM/UIM policy limits" },
            { value: "constant", label: "A fixed number" },
          ]}
          onChange={(v) => {
            if (v === "constant") onChange({ kind: "constant", value: "0" });
            else if (v.startsWith("calc:")) onChange({ kind: "calc", calcId: v.slice(5) });
            else if (v.startsWith("matter:")) onChange({ kind: "matter", field: v.slice(7) as never });
            else {
              const [, inputId, column] = v.split(":");
              onChange({ kind: "input", inputId, column: column || undefined, blankAsZero: operand.kind === "input" ? operand.blankAsZero : undefined });
            }
          }}
        />
      </div>
      {operand.kind === "constant" ? (
        <div style={{ flex: 1, minWidth: 120 }}>
          <Txt id={`${idp}-c`} label="Number" value={operand.value} disabled={disabled} onChange={(v) => onChange({ kind: "constant", value: v.replace(/[^0-9.-]/g, "") })} />
        </div>
      ) : null}
      {operand.kind === "input" ? <Check label="Blank counts as 0" checked={Boolean(operand.blankAsZero)} disabled={disabled} onChange={(v) => onChange({ ...operand, blankAsZero: v || undefined })} /> : null}
      {!disabled ? (
        <button type="button" className="icon-btn" aria-label="Remove this value" onClick={onRemove}>
          <Trash2 size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function SectionBody({ s, i, ro, edit, tableInputs, inputs }: { s: Section; i: number; ro?: boolean; edit: (fn: (d: Cfg) => void) => void; tableInputs: Input[]; inputs: Input[] }) {
  const attach = s.attach ?? { tables: [], calculations: false };
  return (
    <div className="stack">
      <Txt id={`s-${i}-h`} label="Heading" value={s.heading} disabled={ro} onChange={(v) => edit((d) => void (d.drafting.sections![i].heading = v))} hint="Leave blank for an opening or closing paragraph." />
      <fieldset className="field">
        <legend>Who writes this section</legend>
        <div className="yesno">
          <label>
            <input type="radio" name={`s-${i}-mode`} checked={s.mode === "ai"} disabled={ro} onChange={() => edit((d) => void (d.drafting.sections![i].mode = "ai"))} /> AI, from the facts
          </label>
          <label>
            <input type="radio" name={`s-${i}-mode`} checked={s.mode === "fixed"} disabled={ro} onChange={() => edit((d) => void (d.drafting.sections![i].mode = "fixed"))} /> Fixed text
          </label>
        </div>
      </fieldset>
      {s.mode === "ai" ? (
        <Txt id={`s-${i}-in`} label="What this section should say" multiline rows={4} value={s.instructions} disabled={ro} onChange={(v) => edit((d) => void (d.drafting.sections![i].instructions = v))} />
      ) : (
        <Txt id={`s-${i}-tx`} label="Text" multiline rows={5} value={s.text} disabled={ro} onChange={(v) => edit((d) => void (d.drafting.sections![i].text = v))} hint="Use {{placeholders}} such as {{client_name}}. Leave a blank line between paragraphs." />
      )}
      {tableInputs.length ? (
        <fieldset className="field">
          <legend>Show these lists as tables after this section</legend>
          {tableInputs.map((t) => (
            <Check key={t.id} label={t.label} disabled={ro} checked={(attach.tables ?? []).includes(t.id)} onChange={(v) => edit((d) => void (d.drafting.sections![i].attach = { ...attach, tables: v ? [...(attach.tables ?? []), t.id] : (attach.tables ?? []).filter((x) => x !== t.id) }))} />
          ))}
        </fieldset>
      ) : null}
      <Check label="Show the calculation results after this section" checked={Boolean(attach.calculations)} disabled={ro} onChange={(v) => edit((d) => void (d.drafting.sections![i].attach = { ...attach, calculations: v }))} />
      <ShowWhenEditor idp={`s-${i}`} noun="section" value={s.showWhen} inputs={inputs} disabled={ro} onChange={(v) => edit((d) => void (d.drafting.sections![i].showWhen = v))} />
    </div>
  );
}
