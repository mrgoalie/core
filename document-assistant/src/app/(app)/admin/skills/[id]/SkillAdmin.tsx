"use client";
import { Copy, FlaskConical, History, RotateCcw, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { SkillEditor, type TemplateOption } from "@/components/admin/SkillEditor";
import { useApi } from "@/components/useApi";
import { Alert, Badge, Button, ErrorAlert, Modal, Spinner, Switch, formatDateTime } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { FIELD_LABELS, type SkillConfigInput } from "@/lib/skill-config";

type Version = {
  id: string;
  number: number;
  status: "draft" | "testing" | "approved" | "published" | "archived";
  significance: "initial" | "cosmetic" | "significant";
  changedFields: string[];
  changeSummary: string | null;
  author: string | null;
  createdAt: string;
  testStatus: "not_tested" | "passed" | "failed";
  testNotes: string | null;
  testedBy: string | null;
  testedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalNotes: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  restoredFrom: number | null;
  testRuns: { id: string; generated: boolean; updatedAt: string }[];
  config: SkillConfigInput;
};
type Detail = {
  skill: { id: string; slug: string; enabled: boolean; archived: boolean; isBuiltIn: boolean; publishedVersionId: string | null };
  versions: Version[];
  grantedUserIds: string[];
  templates: TemplateOption[];
  employees: { id: string; displayName: string; jobTitle: string | null }[];
};
type Me = { roles: string[] };

const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = { draft: "warning", testing: "accent", approved: "accent", published: "success", archived: "neutral" };
const STATUS_LABEL: Record<string, string> = { draft: "Draft", testing: "Testing", approved: "Approved", published: "Published", archived: "Archived" };

export function SkillAdmin({ skillId }: { skillId: string }) {
  const { data, error, reload } = useApi<Detail>(`/api/admin/skills/${skillId}`);
  const { data: me } = useApi<Me>("/api/me");
  const sp = useSearchParams();
  const [tab, setTab] = useState<"edit" | "versions" | "access">(sp.get("tab") === "versions" ? "versions" : sp.get("tab") === "access" ? "access" : "edit");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(sp.get("created") ? "Skill created as a draft. Next: test it with the fictional sample case (Versions tab)." : null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  const router = useRouter();
  const isAdmin = Boolean(me?.roles.includes("FIRM_ADMIN"));
  const isAttorney = Boolean(me?.roles.includes("ATTORNEY_REVIEWER"));

  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!data || !me) return <Spinner />;

  const open = data.versions.find((v) => ["draft", "testing", "approved"].includes(v.status));
  const published = data.versions.find((v) => v.id === data.skill.publishedVersionId);
  const editing = open ?? published ?? data.versions[0];
  const name = editing.config.name;

  async function saveDraft(cfg: SkillConfigInput, summary: string) {
    setSaving(true);
    setSaveErr(null);
    try {
      const r = await api<{ significance: string; warnings: string[] }>(`/api/admin/skills/${skillId}`, { method: "PUT", body: { config: cfg, changeSummary: summary } });
      setWarnings(r.warnings);
      setNotice(
        r.significance === "cosmetic"
          ? "Saved as a draft. These are display changes only, so you can publish right away from the Versions tab."
          : "Saved as a draft. Because this changes how documents are drafted, it needs a test run and attorney approval before publishing (Versions tab).",
      );
      await reload();
      return true;
    } catch (e) {
      setSaveErr(e as ApiError);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function patch(body: Record<string, boolean>) {
    try {
      await api(`/api/admin/skills/${skillId}`, { method: "PATCH", body });
      await reload();
    } catch (e) {
      setSaveErr(e as ApiError);
    }
  }

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h1 style={{ marginBottom: 6 }}>{name}</h1>
          <div className="row" style={{ gap: 6 }}>
            {published ? <Badge tone="success">Published v{published.number}</Badge> : <Badge tone="neutral">Not published yet</Badge>}
            {open ? <Badge tone={STATUS_TONE[open.status]}>{STATUS_LABEL[open.status]} v{open.number}</Badge> : null}
            {data.skill.archived ? <Badge tone="neutral">Archived</Badge> : null}
            {data.skill.isBuiltIn ? <Badge tone="neutral">Built-in demonstration skill</Badge> : null}
          </div>
        </div>
        {isAdmin ? (
          <div className="row">
            <Switch label={data.skill.enabled ? "Turned on" : "Turned off"} checked={data.skill.enabled} onChange={(v) => patch({ enabled: v })} />
            <Button variant="secondary" size="sm" onClick={async () => { const r = await api<{ skillId: string }>(`/api/admin/skills/${skillId}/duplicate`, { method: "POST" }); router.push(`/admin/skills/${r.skillId}?created=1`); }}>
              <Copy size={16} aria-hidden="true" /> Duplicate
            </Button>
            <Button variant="secondary" size="sm" onClick={() => patch({ archived: !data.skill.archived })}>
              {data.skill.archived ? "Restore from archive" : "Archive"}
            </Button>
          </div>
        ) : null}
      </div>
      {!data.skill.enabled ? <Alert tone="warning">This skill is turned off. Nobody can use it until it is turned back on.</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {warnings.map((w, i) => (
        <Alert key={i} tone="warning">
          {w}
        </Alert>
      ))}

      <div className="seg" role="tablist" aria-label="Skill sections" style={{ alignSelf: "flex-start" }}>
        <button type="button" role="tab" aria-selected={tab === "edit"} aria-pressed={tab === "edit"} onClick={() => setTab("edit")}>
          {isAdmin ? "Edit" : "Review settings"}
        </button>
        <button type="button" role="tab" aria-selected={tab === "versions"} aria-pressed={tab === "versions"} onClick={() => setTab("versions")}>
          <History size={16} aria-hidden="true" style={{ verticalAlign: "-3px" }} /> Versions &amp; publishing
        </button>
        {isAdmin ? (
          <button type="button" role="tab" aria-selected={tab === "access"} aria-pressed={tab === "access"} onClick={() => setTab("access")}>
            <Users size={16} aria-hidden="true" style={{ verticalAlign: "-3px" }} /> Who can use it
          </button>
        ) : null}
      </div>

      {tab === "edit" ? (
        <>
          {open ? <Alert tone="info">You are editing draft version {open.number}. Employees keep using {published ? `published version ${published.number}` : "nothing"} until you publish.</Alert> : published ? <Alert tone="info">Saving will create a new draft version. Published version {published.number} stays in use until you publish the new one.</Alert> : null}
          <SkillEditor key={`${editing.id}-${editorKey}`} initial={editing.config} templates={data.templates} readOnly={!isAdmin} onSave={saveDraft} saving={saving} error={saveErr} saveLabel="Save draft" showSummary />
        </>
      ) : null}
      {tab === "versions" ? <Versions data={data} reload={async () => { await reload(); setEditorKey((k) => k + 1); }} isAdmin={isAdmin} isAttorney={isAttorney} /> : null}
      {tab === "access" && isAdmin ? <Access data={data} reload={reload} published={Boolean(published)} /> : null}
    </div>
  );
}

function Versions({ data, reload, isAdmin, isAttorney }: { data: Detail; reload: () => Promise<void>; isAdmin: boolean; isAttorney: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [testNotes, setTestNotes] = useState("");
  const [approveNotes, setApproveNotes] = useState("");
  const [restore, setRestore] = useState<Version | null>(null);
  const router = useRouter();
  const sid = data.skill.id;
  async function act(v: Version, body: Record<string, unknown>) {
    setBusy(`${v.id}-${body.action}`);
    setErr(null);
    try {
      const r = await api<{ sessionId?: string }>(`/api/admin/skills/${sid}/versions/${v.id}`, { body });
      if (r.sessionId) {
        router.push(`/work/${r.sessionId}`);
        return;
      }
      setRestore(null);
      await reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="card" aria-labelledby="ver-h">
      <h2 id="ver-h">Versions</h2>
      <p className="muted">
        The path to publishing: <strong>Draft → Test with fictional data → Attorney approval → Publish</strong>. Changes that only affect names, descriptions, instructions or icons can be published without a test or approval.
      </p>
      <ErrorAlert error={err} />
      <ul className="version-list">
        {data.versions.map((v) => {
          const isOpen = ["draft", "testing", "approved"].includes(v.status);
          const needsGate = v.significance !== "cosmetic";
          const generatedRun = v.testRuns.some((t) => t.generated);
          const canPublish = !needsGate || (v.testStatus === "passed" && v.status === "approved");
          const restorable = !isOpen && v.status !== "published" && (v.publishedAt || v.approvedAt);
          return (
            <li key={v.id}>
              <div className="row-between">
                <div className="row" style={{ gap: 8 }}>
                  <strong>Version {v.number}</strong>
                  <Badge tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Badge>
                  {v.significance === "cosmetic" ? <Badge tone="neutral">Display changes only</Badge> : v.significance === "significant" ? <Badge tone="warning">Changes drafting</Badge> : null}
                  {v.testStatus === "passed" ? <Badge tone="success">Test passed</Badge> : v.testStatus === "failed" ? <Badge tone="danger">Test failed</Badge> : null}
                  {v.approvedAt ? <Badge tone="success">Attorney approved</Badge> : null}
                </div>
                <span className="small muted">Created {formatDateTime(v.createdAt)}{v.author ? ` by ${v.author}` : ""}</span>
              </div>
              <div className="small" style={{ marginTop: 6 }}>
                {v.changeSummary ? <div>{v.changeSummary}{v.restoredFrom ? ` (restored from version ${v.restoredFrom})` : ""}</div> : null}
                {v.changedFields.length ? <div className="muted">Changed: {v.changedFields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}</div> : null}
                {v.testedAt ? <div className="muted">Tested by {v.testedBy} on {formatDateTime(v.testedAt)}{v.testNotes ? ` — “${v.testNotes}”` : ""}</div> : null}
                {v.approvedAt ? <div className="muted">Approved by {v.approvedBy ?? "—"} on {formatDateTime(v.approvedAt)}{v.approvalNotes ? ` — “${v.approvalNotes}”` : ""}</div> : v.approvalNotes ? <div className="muted">{v.approvalNotes}</div> : null}
                {v.publishedAt ? <div className="muted">Published {formatDateTime(v.publishedAt)}{v.publishedBy ? ` by ${v.publishedBy}` : ""}</div> : null}
              </div>

              {isOpen ? (
                <div className="panel stack" style={{ marginTop: 12 }}>
                  {needsGate ? (
                    <>
                      <div>
                        <strong>Step 1 — Test with the fictional sample case.</strong>
                        <div className="small muted">Opens the skill exactly as employees will see it, using only fictional data. Create the document and check it.</div>
                        <div className="row" style={{ marginTop: 8 }}>
                          {isAdmin ? (
                            <Button size="sm" busy={busy === `${v.id}-start_test`} onClick={() => act(v, { action: "start_test" })}>
                              <FlaskConical size={16} aria-hidden="true" /> Test this version
                            </Button>
                          ) : null}
                          {v.testRuns.map((t, n) => (
                            <a key={t.id} className="btn btn-quiet btn-sm" href={`/work/${t.id}`}>
                              Test run {n + 1} {t.generated ? "(document created)" : "(not finished)"}
                            </a>
                          ))}
                        </div>
                      </div>
                      {isAdmin ? (
                        <div>
                          <strong>Step 2 — Record the result.</strong>
                          <div className="field" style={{ marginTop: 6 }}>
                            <label htmlFor={`tn-${v.id}`} className="small">Notes (optional)</label>
                            <input id={`tn-${v.id}`} type="text" value={testNotes} onChange={(e) => setTestNotes(e.target.value)} />
                          </div>
                          <div className="row" style={{ marginTop: 8 }}>
                            <Button size="sm" disabled={!generatedRun} busy={busy === `${v.id}-record_test`} onClick={() => act(v, { action: "record_test", passed: true, notes: testNotes })}>
                              Test passed
                            </Button>
                            <Button size="sm" variant="danger-outline" disabled={!generatedRun} onClick={() => act(v, { action: "record_test", passed: false, notes: testNotes })}>
                              Test failed
                            </Button>
                            {!generatedRun ? <span className="small muted">Create a document in a test run first.</span> : null}
                          </div>
                        </div>
                      ) : null}
                      <div>
                        <strong>Step 3 — Attorney approval.</strong>
                        {isAttorney ? (
                          <>
                            <div className="field" style={{ marginTop: 6 }}>
                              <label htmlFor={`an-${v.id}`} className="small">Approval notes (optional)</label>
                              <input id={`an-${v.id}`} type="text" value={approveNotes} onChange={(e) => setApproveNotes(e.target.value)} />
                            </div>
                            <div className="row" style={{ marginTop: 8 }}>
                              <Button size="sm" disabled={v.testStatus !== "passed" || v.status === "approved"} busy={busy === `${v.id}-approve`} onClick={() => act(v, { action: "approve", notes: approveNotes })}>
                                {v.status === "approved" ? "Approved" : "Approve as attorney"}
                              </Button>
                              {v.testStatus !== "passed" ? <span className="small muted">Available after a passed test.</span> : null}
                            </div>
                          </>
                        ) : (
                          <div className="small muted">{v.status === "approved" ? "Approved." : "An attorney reviewer must approve this version (they can open this page from Manage Skills)."}</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="small">Only names, descriptions, instructions, icons or categories changed, so no test or attorney approval is needed.</div>
                  )}
                  {isAdmin ? (
                    <div className="row">
                      <Button disabled={!canPublish} busy={busy === `${v.id}-publish`} onClick={() => act(v, { action: "publish" })}>
                        Publish version {v.number}
                      </Button>
                      <Button variant="quiet" onClick={() => act(v, { action: "discard" })}>
                        Discard this draft
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {restorable && isAdmin ? (
                <div style={{ marginTop: 10 }}>
                  <Button size="sm" variant="secondary" onClick={() => setRestore(v)}>
                    <RotateCcw size={16} aria-hidden="true" /> Restore this version
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Modal
        open={Boolean(restore)}
        onClose={() => setRestore(null)}
        title={`Restore version ${restore?.number}?`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRestore(null)}>
              Cancel
            </Button>
            <Button busy={Boolean(restore && busy === `${restore.id}-restore`)} onClick={() => restore && act(restore, { action: "restore" })}>
              Restore and publish
            </Button>
          </>
        }
      >
        <p>This publishes a copy of version {restore?.number}, which was previously approved. Work already in progress keeps the version it started with.</p>
      </Modal>
    </section>
  );
}

function Access({ data, reload, published }: { data: Detail; reload: () => Promise<void>; published: boolean }) {
  const [err, setErr] = useState<ApiError | null>(null);
  const granted = new Set(data.grantedUserIds);
  async function toggle(userId: string, v: boolean) {
    setErr(null);
    try {
      await api(`/api/admin/skills/${data.skill.id}/permissions`, { method: "PUT", body: { userId, granted: v } });
      await reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  return (
    <section className="card" aria-labelledby="acc-h">
      <h2 id="acc-h">Who can use this skill</h2>
      <p className="muted">New skills are available to nobody until you switch people on here. {published ? "" : "People you switch on will see it once a version is published."}</p>
      <ErrorAlert error={err} />
      <ul className="work-list">
        {data.employees.map((e) => (
          <li key={e.id}>
            <div className="w-main">
              <div className="w-title">{e.displayName}</div>
              <div className="w-sub">{e.jobTitle ?? "Employee"}</div>
            </div>
            <Switch label={granted.has(e.id) ? "Can use" : "No access"} checked={granted.has(e.id)} onChange={(v) => toggle(e.id, v)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
