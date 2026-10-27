"use client";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CircleCheck, Download, Eye, FileText, Search, Send, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { categoryLabel } from "@/lib/matter-fields";
import { isVisible, type SkillConfig } from "@/lib/skill-config";
import type { getWorkView } from "@/server/services/work";
import { Alert, Button, ErrorAlert, Modal, Spinner, StatusBadge, formatDateTime } from "../ui";
import { DocumentPreview } from "./DocumentPreview";
import { IssuePanel, SourcePanel } from "./Panels";
import { QuestionField } from "./QuestionField";

export type View = Awaited<ReturnType<typeof getWorkView>>;
type Job = { id: string; status: string; progress: string | null; error: string | null };
type Matter = { id: string; displayNumber: string; description: string; clientName: string; practiceArea: string; status: string; responsibleAttorney: string; openDate: string };

const STEPS = [
  { n: 1, short: "Case", long: "Select the case" },
  { n: 2, short: "Information", long: "Review information" },
  { n: 3, short: "Draft", long: "Create and review" },
];

function useJobPoller(sessionId: string, onFinished: (job: Job) => void) {
  const [job, setJob] = useState<Job | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watch = useCallback(
    (jobId: string) => {
      const tick = async () => {
        try {
          const j = await api<Job>(`/api/work/${sessionId}/jobs/${jobId}`);
          setJob(j);
          if (j.status === "succeeded" || j.status === "failed") {
            setJob(j.status === "failed" ? j : null);
            onFinished(j);
            return;
          }
        } catch {
          /* keep polling */
        }
        timer.current = setTimeout(tick, 1200);
      };
      setJob({ id: jobId, status: "queued", progress: "Starting", error: null });
      void tick();
    },
    [sessionId, onFinished],
  );
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return { job, watch, clear: () => setJob(null) };
}

export function WorkView({ sessionId, firmName }: { sessionId: string; firmName: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [step, setStepState] = useState<number>(1);
  const load = useCallback(async () => {
    try {
      const v = await api<View>(`/api/work/${sessionId}`);
      setView(v);
      setError(null);
      return v;
    } catch (e) {
      setError(e as ApiError);
      return null;
    }
  }, [sessionId]);

  useEffect(() => {
    load().then((v) => {
      if (!v) return;
      const locked = !v.flags.canEdit;
      setStepState(locked || v.data.generation ? 3 : Math.max(1, Math.min(3, v.matterRef ? v.session.currentStep : 1)));
    });
  }, [load]);

  const goStep = useCallback(
    (n: number) => {
      setStepState(n);
      window.scrollTo({ top: 0 });
      if (view?.flags.canEdit) void api(`/api/work/${sessionId}`, { method: "PATCH", body: { step: n } }).catch(() => undefined);
      setTimeout(() => document.getElementById("step-heading")?.focus(), 50);
    },
    [sessionId, view?.flags.canEdit],
  );

  if (error) {
    return (
      <div className="page page-narrow stack">
        <Alert tone="danger" title="This work couldn't be opened">
          {error.message}
        </Alert>
        <Link href="/" className="btn btn-secondary">
          <ArrowLeft size={18} aria-hidden="true" /> Back to home
        </Link>
      </div>
    );
  }
  if (!view) return <div className="page"><Spinner label="Opening your work" /></div>;

  const cfg = view.skill.config as SkillConfig;
  const reviewer = view.role === "reviewer";
  return (
    <div className="page">
      {view.session.isTest ? (
        <Alert tone="warning" title={`Test run of version ${view.session.versionNumber}`}>
          This uses the fictional sample case only. It cannot be sent for review. Go back to the skill in Administration to record whether the test passed.
        </Alert>
      ) : null}
      <div className="row-between" style={{ margin: "8px 0 18px" }}>
        <div>
          <Link href={reviewer ? "/review" : view.session.isTest ? `/admin/skills/${view.skill.id}` : "/"} className="btn btn-quiet" style={{ paddingLeft: 0 }}>
            <ArrowLeft size={18} aria-hidden="true" /> {reviewer ? "Back to review queue" : view.session.isTest ? "Back to the skill" : "Home"}
          </Link>
          <h1 style={{ margin: "4px 0 4px" }}>{cfg.name}</h1>
          <div className="muted">
            {view.matterRef ? `${view.matterRef.displayNumber} · ${view.matterRef.description}` : "No case selected yet"}
            {reviewer ? ` · Prepared by ${view.session.ownerName}` : ""}
          </div>
        </div>
        <StatusBadge status={view.session.status} />
      </div>

      <p className="legal-notice">Everything created here is a draft for attorney review. Nothing is sent, filed or emailed by this system.</p>
      {cfg.employeeInstructions && view.flags.canEdit ? <p className="muted" style={{ marginTop: 14 }}>{cfg.employeeInstructions}</p> : null}
      {cfg.notices.map((n, i) => (
        <div key={i} style={{ marginTop: 12 }}>
          <Alert tone="warning">{n}</Alert>
        </div>
      ))}
      {!view.flags.permitted && view.role === "owner" ? <div style={{ marginTop: 12 }}><Alert tone="danger">You no longer have access to this skill. You can still view this work, but it can&apos;t be changed.</Alert></div> : null}
      {view.flags.generationSuspended ? <div style={{ marginTop: 12 }}><Alert tone="danger" title="Document creation is paused">{view.flags.suspensionReason || "The firm has paused document creation."} Your work is saved.</Alert></div> : null}

      <ol className="stepper" aria-label="Progress" style={{ marginTop: 24 }}>
        {STEPS.map((s) => (
          <li key={s.n} aria-current={step === s.n ? "step" : undefined} className={step > s.n ? "done" : undefined}>
            <span className="num">{step > s.n ? <Check size={18} aria-hidden="true" /> : s.n}</span>
            <span>
              <span className="sr-only">Step {s.n}: </span>
              <span className="label-long">{s.long}</span>
              <span className="sr-only">{step > s.n ? " (done)" : step === s.n ? " (current)" : ""}</span>
            </span>
          </li>
        ))}
      </ol>

      {step === 1 ? <StepCase view={view} reload={load} next={() => goStep(2)} /> : null}
      {step === 2 ? <StepInformation view={view} setView={setView} reload={load} back={() => goStep(1)} next={() => goStep(3)} /> : null}
      {step === 3 ? <StepDraft view={view} reload={load} back={() => goStep(2)} firmName={firmName} /> : null}
    </div>
  );
}

// =============================================================================================
// Step 1 — case
// =============================================================================================

function StepCase({ view, reload, next }: { view: View; reload: () => Promise<View | null>; next: () => void }) {
  const [q, setQ] = useState("");
  const [matters, setMatters] = useState<Matter[] | null>(null);
  const [picked, setPicked] = useState<string | null>(view.matter?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const sid = view.session.id;

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ matters: Matter[] }>(`/api/work/${sid}/matters?q=${encodeURIComponent(q)}`)
        .then((r) => setMatters(r.matters))
        .catch((e) => setErr(e));
    }, 250);
    return () => clearTimeout(t);
  }, [q, sid]);

  async function cont() {
    if (!picked) return;
    if (picked === view.matter?.id) return next();
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/work/${sid}/matter`, { body: { matterId: picked } });
      await reload();
      next();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const editable = view.flags.canEdit;
  return (
    <section className="card" aria-labelledby="step-heading">
      <h2 id="step-heading" tabIndex={-1}>
        Which case is this for?
      </h2>
      <p className="muted">Search by client name or matter number. You&apos;ll only see cases you have access to.</p>
      <div className="field">
        <label htmlFor="matter-search" className="sr-only">
          Search cases
        </label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <Search size={22} aria-hidden="true" />
          <input id="matter-search" type="search" placeholder="For example: Thompson or 2025-0142" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={editable} disabled={!editable} />
        </div>
      </div>
      <div style={{ marginTop: 18 }}>
        {matters === null ? <Spinner label="Looking up cases" /> : null}
        {matters?.length === 0 ? <div className="empty">No cases match “{q}”.</div> : null}
        {matters?.length ? (
          <fieldset>
            <legend className="sr-only">Cases</legend>
            <div className="choice-cards">
              {matters.map((m) => (
                <label key={m.id} className="choice-card">
                  <input type="radio" name="matter" value={m.id} checked={picked === m.id} onChange={() => setPicked(m.id)} disabled={!editable} />
                  <span className="matter-option">
                    <span>
                      <span className="m-title" style={{ display: "block" }}>
                        {m.description}
                      </span>
                      <span className="m-meta" style={{ display: "block" }}>
                        Matter {m.displayNumber} · Client: {m.clientName} · {m.practiceArea}
                      </span>
                      <span className="m-meta" style={{ display: "block" }}>
                        Attorney: {m.responsibleAttorney || "—"} · Opened {m.openDate || "—"} · {m.status}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>
      {picked && view.matter && picked !== view.matter.id ? (
        <div style={{ marginTop: 16 }}>
          <Alert tone="warning">Choosing a different case will clear the documents and case information already filled in.</Alert>
        </div>
      ) : null}
      <ErrorAlert error={err} />
      <div className="step-actions">
        <span />
        <Button size="lg" onClick={cont} disabled={!picked} busy={busy}>
          Continue <ArrowRight size={20} aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}

// =============================================================================================
// Step 2 — documents and information
// =============================================================================================

function StepInformation({ view, setView, reload, back, next }: { view: View; setView: (v: View) => void; reload: () => Promise<View | null>; back: () => void; next: () => void }) {
  const cfg = view.skill.config as SkillConfig;
  const sid = view.session.id;
  const editable = view.flags.canEdit;
  const [answers, setAnswers] = useState<Record<string, unknown>>(view.data.answers);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  // Ticking a document responds immediately; the server confirms (or the tick is undone on error).
  const [localSel, setLocalSel] = useState<Record<string, boolean>>({});
  const selSeq = useRef<Record<string, number>>({});
  const onFinished = useCallback(
    async (j: Job) => {
      const v = await reload();
      if (v) setAnswers(v.data.answers);
      if (j.status === "failed") setErr(new ApiError(0, j.error ?? "The documents couldn't be checked."));
    },
    [reload],
  );
  const poller = useJobPoller(sid, onFinished);
  useEffect(() => {
    if (view.activeJob?.type === "analyze") poller.watch(view.activeJob.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = useCallback(async () => {
    const body = pending.current;
    pending.current = {};
    if (!Object.keys(body).length) return;
    setSaveState("saving");
    try {
      await api(`/api/work/${sid}`, { method: "PATCH", body: { answers: body } });
      setSaveState("saved");
      const v = await api<View>(`/api/work/${sid}`);
      setView({ ...v, data: { ...v.data, answers: { ...v.data.answers, ...pending.current } } });
    } catch (e) {
      setSaveState("error");
      setErr(e as ApiError);
      pending.current = { ...body, ...pending.current };
    }
  }, [sid, setView]);

  const change = (id: string, v: unknown) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    pending.current[id] = v;
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  };
  useEffect(() => () => void flush(), [flush]);

  async function docChange(docId: string, body: { selected?: boolean; requirementId?: string }) {
    setErr(null);
    const n = (selSeq.current[docId] ?? 0) + 1;
    selSeq.current[docId] = n;
    if (body.selected !== undefined) setLocalSel((m) => ({ ...m, [docId]: body.selected! }));
    try {
      await api(`/api/work/${sid}/documents/${docId}`, { method: "PATCH", body });
      await reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      // Only the most recent change for this document may clear the on-screen state.
      if (selSeq.current[docId] === n)
        setLocalSel((m) => {
          const { [docId]: _, ...rest } = m;
          return rest;
        });
    }
  }
  async function removeDoc(docId: string) {
    try {
      await api(`/api/work/${sid}/documents/${docId}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  async function upload(requirementId: string | null, file: File) {
    setErr(null);
    setUploading(requirementId ?? "other");
    const form = new FormData();
    form.set("file", file);
    if (requirementId) form.set("requirementId", requirementId);
    try {
      await api(`/api/work/${sid}/uploads`, { form, method: "POST" });
      await reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setUploading(null);
    }
  }
  async function analyze() {
    setErr(null);
    await flush();
    try {
      const r = await api<{ jobId: string }>(`/api/work/${sid}/analyze`, { method: "POST" });
      poller.watch(r.jobId);
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  async function move(docId: string, dir: -1 | 1, order: string[]) {
    const i = order.indexOf(docId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    try {
      await api(`/api/work/${sid}/exhibits`, { method: "PUT", body: { order: next } });
      await reload();
      setTimeout(() => document.getElementById(`move-${docId}-${dir === -1 ? "up" : "down"}`)?.focus(), 30);
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  const applicable = cfg.documents.filter((r) => isVisible(r.appliesWhen, answers));
  const docsFor = (rid: string) => view.documents.filter((d) => d.requirementId === rid);
  const unassigned = view.documents.filter((d) => !d.requirementId || !applicable.some((r) => r.id === d.requirementId));
  const isPackage = cfg.output.formats.includes("pdf_package");
  const selectedDocs = view.documents.filter((d) => d.selected);
  const order = useMemo(() => {
    const saved = (view.data.exhibitOrder ?? []).filter((id) => selectedDocs.some((d) => d.id === id));
    const rest = selectedDocs
      .filter((d) => !saved.includes(d.id))
      .sort((a, b) => cfg.documents.findIndex((r) => r.id === a.requirementId) - cfg.documents.findIndex((r) => r.id === b.requirementId));
    return [...saved, ...rest.map((d) => d.id)];
  }, [view.data.exhibitOrder, selectedDocs, cfg.documents]);
  const visibleInputs = cfg.inputs.filter((i) => isVisible(i.showWhen, answers) && i.type !== "file");
  const groups = [...new Set(visibleInputs.map((i) => i.group ?? ""))];
  const analysis = view.data.analysis;
  const missingRequired = visibleInputs.filter((i) => i.required && (answers[i.id] === undefined || answers[i.id] === "" || (Array.isArray(answers[i.id]) && (answers[i.id] as unknown[]).length === 0)));
  const analyzerNeeded = applicable.some((r) => r.analyzer !== "none");
  const docUrl = (id: string) => `/api/work/${sid}/documents/${id}`;

  const fileInput = (rid: string | null, label: string) =>
    editable && view.flags.uploadsAllowed ? (
      <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
        <Upload size={16} aria-hidden="true" /> {uploading === (rid ?? "other") ? "Uploading…" : "Upload"}
        <span className="sr-only"> a document for {label}</span>
        <input
          type="file"
          className="sr-only"
          accept=".pdf,.docx,.txt,.png,.jpg,.jpeg"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(rid, f);
          }}
        />
      </label>
    ) : null;

  return (
    <div className="stack-lg">
      {cfg.inputs.some((i) => i.type === "select" && cfg.documents.some((d) => d.appliesWhen?.inputId === i.id)) ? (
        <section className="card" aria-labelledby="first-q">
          <h2 id="first-q">First, a quick question</h2>
          {cfg.inputs
            .filter((i) => cfg.documents.some((d) => d.appliesWhen?.inputId === i.id))
            .map((i) => (
              <QuestionField key={i.id} input={i} value={answers[i.id]} provenance={view.data.provenance[i.id]} onChange={(v) => change(i.id, v)} disabled={!editable} />
            ))}
        </section>
      ) : null}

      <section className="card" aria-labelledby="step-heading">
        <h2 id="step-heading" tabIndex={-1}>
          Documents
        </h2>
        <p className="muted">
          We looked in the case file for these documents. Tick the ones to use{view.flags.uploadsAllowed ? ", and upload anything that's missing" : ""}. Only the documents you tick are opened.
        </p>
        <ul className="checklist">
          {applicable.map((r) => {
            const docs = docsFor(r.id);
            const has = docs.some((d) => d.selected);
            return (
              <li key={r.id} className="req-item">
                <div className="req-head">
                  <span className={`status-dot ${has ? "status-ok" : r.required ? "status-missing" : "status-optional"}`} aria-hidden="true">
                    {has ? <Check size={18} /> : r.required ? <X size={18} /> : "–"}
                  </span>
                  <span className="req-label">
                    {r.label}
                    <span className="sr-only">{has ? " — selected" : r.required ? " — missing" : " — optional, none selected"}</span>
                  </span>
                  <span className={`badge ${r.required ? "badge-warning" : "badge-neutral"}`}>{r.required ? "Required" : "Optional"}</span>
                  {fileInput(r.id, r.label)}
                </div>
                {r.description ? <p className="small muted" style={{ margin: "0 16px 10px" }}>{r.description}</p> : null}
                {docs.length ? (
                  <div className="req-docs">
                    {docs.map((d) => (
                      <div key={d.id} className="doc-row">
                        <label className="check" style={{ flex: 1, minWidth: 220 }}>
                          <input type="checkbox" checked={localSel[d.id] ?? d.selected} disabled={!editable} onChange={(e) => docChange(d.id, { selected: e.target.checked })} />
                          <span>
                            {d.fileName}
                            <span className="small muted" style={{ display: "block" }}>
                              {d.origin === "upload" ? "Uploaded by you" : "From the case file"}
                              {d.pageCount ? ` · ${d.pageCount} page${d.pageCount === 1 ? "" : "s"}` : ""}
                              {d.extractStatus === "no_text" ? " · No readable text — please review it yourself" : ""}
                            </span>
                          </span>
                        </label>
                        <a className="btn btn-quiet btn-sm" href={docUrl(d.id)} target="_blank" rel="noopener">
                          <Eye size={16} aria-hidden="true" /> View<span className="sr-only"> {d.fileName}</span>
                        </a>
                        {d.origin === "upload" && editable ? (
                          <button type="button" className="btn btn-quiet btn-sm" onClick={() => removeDoc(d.id)}>
                            <Trash2 size={16} aria-hidden="true" /> Remove<span className="sr-only"> {d.fileName}</span>
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="req-docs small muted" style={{ paddingTop: 10 }}>
                    {r.required ? "Not found in the case file." : "None found."}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {unassigned.length ? (
          <details style={{ marginTop: 18 }}>
            <summary style={{ cursor: "pointer", fontWeight: 650 }}>Other documents in this case ({unassigned.length})</summary>
            <div className="req-docs" style={{ border: "1px solid var(--border)", borderRadius: 10, marginTop: 10 }}>
              {unassigned.map((d) => (
                <div key={d.id} className="doc-row">
                  <span style={{ flex: 1, minWidth: 200 }}>
                    {d.fileName}
                    <span className="small muted" style={{ display: "block" }}>
                      {categoryLabel(d.category)}
                    </span>
                  </span>
                  <label className="small" htmlFor={`use-${d.id}`}>
                    Use as
                  </label>
                  <select id={`use-${d.id}`} style={{ maxWidth: 280, minHeight: 44 }} disabled={!editable} value="" onChange={(e) => e.target.value && docChange(d.id, { requirementId: e.target.value, selected: true })}>
                    <option value="">Not used</option>
                    {applicable.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {isPackage && order.length ? (
          <div style={{ marginTop: 24 }}>
            <h3>Exhibit order</h3>
            <p className="small muted">Exhibits are numbered in this order. Use the arrows to move one up or down.</p>
            <ol className="work-list" style={{ listStyle: "none" }}>
              {order.map((id, i) => {
                const d = view.documents.find((x) => x.id === id)!;
                return (
                  <li key={id}>
                    <span className="badge badge-accent">Exhibit {i + 1}</span>
                    <span className="w-main">{d.fileName}</span>
                    <button id={`move-${id}-up`} type="button" className="icon-btn" disabled={!editable || i === 0} onClick={() => move(id, -1, order)} aria-label={`Move ${d.fileName} up`}>
                      <ArrowUp size={18} aria-hidden="true" />
                    </button>
                    <button id={`move-${id}-down`} type="button" className="icon-btn" disabled={!editable || i === order.length - 1} onClick={() => move(id, 1, order)} aria-label={`Move ${d.fileName} down`}>
                      <ArrowDown size={18} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        {analyzerNeeded ? (
          <div style={{ marginTop: 24 }}>
            {poller.job && poller.job.status !== "failed" ? (
              <div className="progress-box" role="status" aria-live="polite">
                <span className="spinner" aria-hidden="true" />
                <div>
                  <strong>Reading the documents…</strong>
                  <div className="muted">{poller.job.progress ?? "Starting"}</div>
                </div>
              </div>
            ) : (
              <div className="panel row-between">
                <div>
                  <strong>{analysis ? "Documents were read" : "Let us read the documents for you"}</strong>
                  <div className="small muted">
                    {analysis
                      ? `${analysis.documents.filter((d) => d.status === "read").length} read on ${formatDateTime(analysis.ranAt)} by ${analysis.providerLabel}. The questions below were filled in from them.`
                      : "We'll fill in the questions below from the documents you ticked, and show where each answer came from."}
                  </div>
                </div>
                <Button variant={analysis ? "secondary" : "primary"} onClick={analyze} disabled={!editable || selectedDocs.length === 0}>
                  <FileText size={18} aria-hidden="true" /> {analysis ? "Read them again" : "Read the documents"}
                </Button>
              </div>
            )}
            {analysis?.documents.filter((d) => d.status === "no_text" || d.status === "failed").map((d) => (
              <div key={d.docId} style={{ marginTop: 10 }}>
                <Alert tone="warning">
                  <strong>{d.fileName}:</strong> {d.note}
                </Alert>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {visibleInputs.length ? (
        <section className="card" aria-labelledby="info-h">
          <div className="row-between">
            <h2 id="info-h" style={{ marginBottom: 0 }}>
              Information for the document
            </h2>
            <span className="save-state" role="status" aria-live="polite">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? (<><CircleCheck size={16} aria-hidden="true" /> All changes saved</>) : saveState === "error" ? "Not saved — check your connection" : ""}
            </span>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            Check each answer. Tags show where it came from. If something is wrong, just change it — the attorney will see that you changed it.
          </p>
          {groups.map((g) => (
            <div key={g || "general"}>
              {g ? <h3 className="group-title">{g}</h3> : null}
              {visibleInputs
                .filter((i) => (i.group ?? "") === g && !cfg.documents.some((d) => d.appliesWhen?.inputId === i.id))
                .map((i) => (
                  <div key={i.id} style={{ marginTop: 18 }}>
                    <QuestionField
                      input={i}
                      value={answers[i.id]}
                      provenance={view.data.provenance[i.id]}
                      rowProvenance={view.data.rowProvenance[i.id]}
                      onChange={(v) => change(i.id, v)}
                      disabled={!editable}
                      matterValue={i.matterField ? (view.matter?.fields as Record<string, string> | undefined)?.[i.matterField] : undefined}
                    />
                  </div>
                ))}
            </div>
          ))}
        </section>
      ) : null}

      <ErrorAlert error={err} />
      <div className="step-actions">
        <Button variant="secondary" onClick={back}>
          <ArrowLeft size={20} aria-hidden="true" /> Back
        </Button>
        <div className="row">
          {missingRequired.length ? <span className="small muted">{missingRequired.length} required answer{missingRequired.length === 1 ? "" : "s"} still blank — the draft will flag {missingRequired.length === 1 ? "it" : "them"}.</span> : null}
          <Button size="lg" onClick={async () => { await flush(); next(); }}>
            Continue <ArrowRight size={20} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================================
// Step 3 — create, review, submit (and attorney decision)
// =============================================================================================

function StepDraft({ view, reload, back, firmName }: { view: View; reload: () => Promise<View | null>; back: () => void; firmName: string }) {
  const sid = view.session.id;
  const cfg = view.skill.config as SkillConfig;
  const gen = view.data.generation;
  const [err, setErr] = useState<ApiError | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const onFinished = useCallback(
    async (j: Job) => {
      await reload();
      if (j.status === "failed") setErr(new ApiError(0, j.error ?? "The draft couldn't be created."));
    },
    [reload],
  );
  const poller = useJobPoller(sid, onFinished);
  useEffect(() => {
    if (view.activeJob && view.activeJob.type !== "analyze") poller.watch(view.activeJob.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(mode: "draft" | "rerender") {
    setErr(null);
    try {
      const r = await api<{ jobId: string }>(`/api/work/${sid}/generate`, { body: { mode } });
      poller.watch(r.jobId);
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  const showRef = (id: string) => {
    setHighlight(id);
    setTimeout(() => document.getElementById(`src-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };
  const docIdByName = new Map(view.documents.map((d) => [d.fileName, d.id]));
  const banner = view.session.status === "approved" ? undefined : `DRAFT — ATTORNEY REVIEW REQUIRED — DO NOT SEND${gen?.isDemonstrationEngine ? " — DEMONSTRATION DRAFTING ENGINE (NO AI)" : ""}`;
  const working = poller.job && poller.job.status !== "failed";
  const changesComment = view.history.find((h) => h.action === "changes_requested");

  if (working) {
    return (
      <section className="card" aria-labelledby="step-heading">
        <h2 id="step-heading" tabIndex={-1}>
          Creating your draft
        </h2>
        <div className="progress-box" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>{poller.job?.progress ?? "Starting"}…</strong>
            <div className="muted">This usually takes less than a minute. You can leave this page — the work continues and is saved.</div>
          </div>
        </div>
      </section>
    );
  }

  if (!gen) {
    return (
      <section className="card" aria-labelledby="step-heading">
        <h2 id="step-heading" tabIndex={-1}>
          Create the draft
        </h2>
        <p>When you click the button, we&apos;ll prepare the {cfg.output.documentTitle.toLowerCase()} using only the information and documents you reviewed. Anything missing will be clearly marked — nothing is guessed.</p>
        <ErrorAlert error={err} />
        <div className="step-actions">
          <Button variant="secondary" onClick={back}>
            <ArrowLeft size={20} aria-hidden="true" /> Back
          </Button>
          <Button size="lg" onClick={() => create("draft")} disabled={!view.flags.canEdit || view.flags.generationSuspended}>
            <FileText size={20} aria-hidden="true" /> Create the draft
          </Button>
        </div>
      </section>
    );
  }

  const finals = gen.finalFiles ?? [];
  const files = view.session.status === "approved" && finals.length ? finals : gen.files;
  return (
    <div className="stack-lg">
      <h2 id="step-heading" tabIndex={-1} className="sr-only">
        Review the draft
      </h2>
      {view.session.status === "approved" ? (
        <Alert tone="success" title="Approved by an attorney">
          The final files below no longer carry the DRAFT marking. Approved {formatDateTime(view.session.approvedAt)}.
        </Alert>
      ) : null}
      {view.session.status === "submitted" && view.role === "owner" ? (
        <Alert tone="info" title="Waiting for attorney review">
          Sent {formatDateTime(view.session.submittedAt)}. You&apos;ll see the decision here.
        </Alert>
      ) : null}
      {view.session.status === "changes_requested" && changesComment ? (
        <Alert tone="warning" title={`${changesComment.by ?? "The attorney"} asked for changes`}>
          <p style={{ whiteSpace: "pre-line" }}>{changesComment.comments}</p>
        </Alert>
      ) : null}
      {gen.stale && view.flags.canEdit ? (
        <Alert tone="warning" title="Something changed since this draft was created">
          <p>Update the draft so it matches your latest information before sending it.</p>
          <div className="row">
            <Button onClick={() => create("draft")}>Create a new draft</Button>
            <Button variant="secondary" onClick={() => create("rerender")}>
              Keep the current wording and update the files
            </Button>
          </div>
        </Alert>
      ) : null}
      {gen.isDemonstrationEngine ? (
        <Alert tone="info" title="Demonstration drafting engine">
          This draft was assembled by fixed rules from your information — no AI model was used. A real AI provider can be switched on by the system administrator.
        </Alert>
      ) : null}
      <ErrorAlert error={err} />

      <div className="review-layout">
        <div className="stack">
          <DocumentPreview blocks={gen.blocks} banner={banner} firmName={firmName} onRef={showRef} />
          {view.flags.canEdit ? <SectionEditor view={view} reload={reload} onRerender={() => create("rerender")} /> : null}
        </div>
        <aside className="side-sticky" aria-label="Review tools">
          <IssuePanel issues={gen.issues} />
          <section className="card card-flat" aria-labelledby="dl-h">
            <h2 id="dl-h" style={{ fontSize: "1.15rem" }}>
              {view.session.status === "approved" ? "Final files" : "Draft files"}
            </h2>
            {gen.exhibitIndex?.length ? (
              <p className="small muted">
                {gen.exhibitIndex.length} exhibits, Bates {gen.exhibitIndex[0].batesFirst} – {gen.exhibitIndex[gen.exhibitIndex.length - 1].batesLast}
              </p>
            ) : null}
            <div className="stack" style={{ gap: 10 }}>
              {files.map((f) => (
                <a key={f.id} className="btn btn-secondary btn-block" href={`/api/work/${sid}/files/${f.id}`} style={{ justifyContent: "flex-start" }}>
                  <Download size={18} aria-hidden="true" />
                  <span style={{ textAlign: "left" }}>
                    {f.kind === "package" ? "Exhibit package (PDF)" : f.format === "docx" ? "Word document (editable)" : "PDF"}
                    {f.pageCount ? <span className="small" style={{ display: "block", fontWeight: 500 }}>{f.pageCount} pages</span> : null}
                  </span>
                </a>
              ))}
            </div>
            {view.session.status !== "approved" ? <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>Draft files are marked DRAFT and must not be sent.</p> : null}
          </section>
          {gen.exhibitIndex?.length ? (
            <section className="card card-flat" aria-labelledby="ix-h">
              <h2 id="ix-h" style={{ fontSize: "1.15rem" }}>Exhibit index</h2>
              <ol style={{ paddingLeft: 20, margin: 0 }} className="small">
                {gen.exhibitIndex.map((x) => (
                  <li key={x.number} style={{ marginBottom: 6 }}>
                    {x.description} <span className="muted">({x.batesFirst}–{x.batesLast}, {x.pages} p.)</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <SourcePanel sources={gen.sources} highlight={highlight} docUrl={(id) => `/api/work/${sid}/documents/${id}`} docIdByName={docIdByName} />
          {view.role === "owner" ? <SubmitCard view={view} reload={reload} /> : null}
          {view.flags.canReview ? <DecisionCard view={view} reload={reload} /> : null}
          {view.history.length ? (
            <section className="card card-flat" aria-labelledby="hist-h">
              <h2 id="hist-h" style={{ fontSize: "1.15rem" }}>History</h2>
              <ul className="source-list">
                {view.history.map((h, i) => (
                  <li key={i}>
                    <strong>{{ submitted: "Sent for review", withdrawn: "Withdrawn", approved: "Approved", changes_requested: "Changes requested" }[h.action] ?? h.action}</strong> by {h.by ?? "—"} · {formatDateTime(h.at)}
                    {h.comments ? <q className="quote">{h.comments}</q> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
      {view.flags.canEdit ? (
        <div className="step-actions">
          <Button variant="secondary" onClick={back}>
            <ArrowLeft size={20} aria-hidden="true" /> Back to the information
          </Button>
          <Button variant="secondary" onClick={() => create("draft")}>
            Create a new draft
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SectionEditor({ view, reload, onRerender }: { view: View; reload: () => Promise<View | null>; onRerender: () => void }) {
  const gen = view.data.generation!;
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const sid = view.session.id;
  const edits = view.data.sectionEdits ?? {};
  async function save(id: string, value: string | null) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/work/${sid}/sections`, { method: "PUT", body: { edits: { [id]: value } } });
      await reload();
      setOpen(null);
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card card-flat" aria-labelledby="edit-h">
      <h2 id="edit-h" style={{ fontSize: "1.15rem" }}>
        Change the wording
      </h2>
      <p className="small muted">Open a section to edit its text. Your edits are shown to the attorney as edited by staff.</p>
      <ul className="work-list">
        {gen.sections.map((s) => (
          <li key={s.id} style={{ display: "block" }}>
            <div className="row-between">
              <strong>{s.heading || (s.id === "intro" ? "Opening" : s.id === "closing" ? "Closing" : s.id)}</strong>
              <div className="row">
                {edits[s.id] !== undefined ? <span className="badge badge-warning">Edited</span> : null}
                <Button
                  variant="quiet"
                  size="sm"
                  aria-expanded={open === s.id}
                  onClick={() => {
                    setOpen(open === s.id ? null : s.id);
                    setText(edits[s.id] ?? s.paragraphs.map((p) => p.text).join("\n\n"));
                  }}
                >
                  {open === s.id ? "Close" : "Edit"}
                  <span className="sr-only"> {s.heading || s.id}</span>
                </Button>
              </div>
            </div>
            {open === s.id ? (
              <div className="stack" style={{ marginTop: 10 }}>
                <label htmlFor={`edit-${s.id}`} className="sr-only">
                  Text for {s.heading || s.id}
                </label>
                <textarea id={`edit-${s.id}`} rows={8} value={text} onChange={(e) => setText(e.target.value)} />
                <div className="row">
                  <Button size="sm" busy={busy} onClick={() => save(s.id, text)}>
                    Save wording
                  </Button>
                  {edits[s.id] !== undefined ? (
                    <Button size="sm" variant="secondary" onClick={() => save(s.id, null)}>
                      Undo my edits
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <ErrorAlert error={err} />
      {gen.stale ? (
        <div style={{ marginTop: 12 }}>
          <Button onClick={onRerender}>Update the files with my wording</Button>
        </div>
      ) : null}
    </section>
  );
}

function SubmitCard({ view, reload }: { view: View; reload: () => Promise<View | null> }) {
  const [reviewer, setReviewer] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const sid = view.session.id;
  const attention = view.data.generation?.issues.filter((i) => i.severity === "attention").length ?? 0;
  if (view.session.isTest) return null;
  if (view.flags.canWithdraw) {
    return (
      <section className="card card-flat">
        <h2 style={{ fontSize: "1.15rem" }}>Sent for review</h2>
        <p className="small">Need to change something? Withdraw it, make your changes, and send it again.</p>
        <Button variant="secondary" busy={busy} onClick={async () => { setBusy(true); try { await api(`/api/work/${sid}/withdraw`, { method: "POST" }); await reload(); } catch (e) { setErr(e as ApiError); } finally { setBusy(false); } }}>
          Withdraw from review
        </Button>
        <ErrorAlert error={err} />
      </section>
    );
  }
  if (!["ready", "changes_requested"].includes(view.session.status)) return null;
  return (
    <section className="card" aria-labelledby="send-h" style={{ borderColor: "var(--accent)", borderWidth: 2 }}>
      <h2 id="send-h" style={{ fontSize: "1.2rem" }}>
        Send to an attorney
      </h2>
      {attention ? <p className="small">{attention} item{attention === 1 ? "" : "s"} still need attention. You can send it anyway — the attorney will see the same list.</p> : null}
      <div className="field">
        <label htmlFor="reviewer">Attorney</label>
        <select id="reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
          <option value="">Any attorney reviewer</option>
          {view.reviewers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="note">
          Note for the attorney <span className="opt">(optional)</span>
        </label>
        <textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <ErrorAlert error={err} />
      <div style={{ marginTop: 14 }}>
        <Button
          size="lg"
          block
          busy={busy}
          disabled={!view.flags.canSubmit}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await api(`/api/work/${sid}/submit`, { body: { reviewerId: reviewer || null, note } });
              await reload();
            } catch (e) {
              setErr(e as ApiError);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Send size={20} aria-hidden="true" /> Send for attorney review
        </Button>
        {!view.flags.canSubmit && view.data.generation?.stale ? <p className="small muted" style={{ marginTop: 8 }}>Update the draft first (see the message above).</p> : null}
      </div>
    </section>
  );
}

function DecisionCard({ view, reload }: { view: View; reload: () => Promise<View | null> }) {
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [confirm, setConfirm] = useState(false);
  const sid = view.session.id;
  const cfg = view.skill.config as SkillConfig;
  async function decide(decision: "approve" | "request_changes") {
    setBusy(decision);
    setErr(null);
    try {
      await api(`/api/review/${sid}`, { body: { decision, comments } });
      setConfirm(false);
      await reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="card" aria-labelledby="decide-h" style={{ borderColor: "var(--accent)", borderWidth: 2 }}>
      <h2 id="decide-h" style={{ fontSize: "1.2rem" }}>
        Your decision
      </h2>
      {cfg.approval.reviewerGuidance ? <p className="small">{cfg.approval.reviewerGuidance}</p> : null}
      <div className="field">
        <label htmlFor="comments">Comments</label>
        <textarea id="comments" rows={4} value={comments} onChange={(e) => setComments(e.target.value)} />
      </div>
      <ErrorAlert error={err} />
      <div className="stack" style={{ marginTop: 14 }}>
        <Button size="lg" block onClick={() => setConfirm(true)} disabled={Boolean(busy)}>
          <CircleCheck size={20} aria-hidden="true" /> Approve
        </Button>
        <Button variant="secondary" block busy={busy === "request_changes"} onClick={() => decide("request_changes")}>
          Request changes
        </Button>
      </div>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Approve this work?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button busy={busy === "approve"} onClick={() => decide("approve")}>
              Yes, approve
            </Button>
          </>
        }
      >
        <p>Final copies without the DRAFT marking will be created from exactly what you reviewed. Approval does not send anything — the documents still need to be sent by the firm.</p>
      </Modal>
    </section>
  );
}
