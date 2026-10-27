"use client";
import { ArrowLeft, Ban, CircleCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/components/useApi";
import { Alert, Badge, Button, ErrorAlert, Modal, Spinner, Switch, formatDateTime } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";

const ROLE_LABELS: Record<string, string> = { EMPLOYEE: "Employee", ATTORNEY_REVIEWER: "Attorney Reviewer", FIRM_ADMIN: "Firm Administrator", SYSTEM_ADMIN: "System Administrator" };
const ROLE_HELP: Record<string, string> = {
  ATTORNEY_REVIEWER: "Can review and approve work, and approve changes to skills.",
  FIRM_ADMIN: "Can manage employees, skills, templates and the interface.",
  SYSTEM_ADMIN: "Can change technical settings, integrations and the AI provider.",
};

type Data = {
  employee: {
    id: string;
    email: string;
    displayName: string;
    jobTitle: string | null;
    status: string;
    roles: string[];
    skillIds: string[];
    lastLoginAt: string | null;
    suspendedAt: string | null;
    suspendedReason: string | null;
    entraLinked: boolean;
    activity: { id: number; at: string; action: string; outcome: string; actorEmail: string | null; details: Record<string, unknown> | null }[];
  };
  skills: { id: string; name: string; published: boolean; enabled: boolean }[];
  assignableRoles: string[];
  isSelf: boolean;
};

export function EmployeeDetail({ id }: { id: string }) {
  const { data, error, reload } = useApi<Data>(`/api/admin/employees/${id}`);
  const [err, setErr] = useState<ApiError | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!data) return <Spinner />;
  const e = data.employee;

  async function call(fn: () => Promise<unknown>, msg?: string) {
    setErr(null);
    setBusy(true);
    try {
      await fn();
      if (msg) setFlash(msg);
      await reload();
    } catch (x) {
      setErr(x as ApiError);
    } finally {
      setBusy(false);
    }
  }
  const setSkill = (skillId: string, granted: boolean) => call(() => api(`/api/admin/employees/${id}/skills/${skillId}`, { method: "PUT", body: { granted } }));
  const setRole = (role: string, on: boolean) => call(() => api(`/api/admin/employees/${id}`, { method: "PATCH", body: { roles: on ? [...e.roles, role] : e.roles.filter((r) => r !== role) } }));

  return (
    <div className="stack-lg">
      <div>
        <Link href="/admin/employees" className="btn btn-quiet" style={{ paddingLeft: 0 }}>
          <ArrowLeft size={18} aria-hidden="true" /> All employees
        </Link>
        <div className="row-between">
          <div>
            <h1 style={{ marginBottom: 4 }}>{e.displayName}</h1>
            <div className="muted">{e.email}{e.jobTitle ? ` · ${e.jobTitle}` : ""}</div>
          </div>
          {e.status === "active" ? <Badge tone="success">Access active</Badge> : <Badge tone="danger">Access suspended</Badge>}
        </div>
      </div>
      {flash ? <Alert tone="success" role="status">{flash}</Alert> : null}
      <ErrorAlert error={err} />

      <section className="card" aria-labelledby="sk-h">
        <h2 id="sk-h">Skills this person can use</h2>
        <p className="muted">Changes take effect immediately.</p>
        <ul className="work-list">
          {data.skills.map((s) => (
            <li key={s.id}>
              <div className="w-main">
                <div className="w-title">{s.name}</div>
                <div className="w-sub">{!s.published ? "Not published yet" : !s.enabled ? "Turned off for everyone" : ""}</div>
              </div>
              <Switch label={e.skillIds.includes(s.id) ? "Allowed" : "Not allowed"} checked={e.skillIds.includes(s.id)} disabled={busy || !data.assignableRoles.includes("FIRM_ADMIN")} onChange={(v) => setSkill(s.id, v)} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="rl-h">
        <h2 id="rl-h">Roles</h2>
        <p className="muted">Everyone is an Employee. Add roles only for people who need them.</p>
        <ul className="work-list">
          {(["ATTORNEY_REVIEWER", "FIRM_ADMIN", "SYSTEM_ADMIN"] as const).map((r) => (
            <li key={r}>
              <div className="w-main">
                <div className="w-title">{ROLE_LABELS[r]}</div>
                <div className="w-sub">{ROLE_HELP[r]}</div>
              </div>
              <Switch label={e.roles.includes(r) ? "Yes" : "No"} checked={e.roles.includes(r)} disabled={busy || !data.assignableRoles.includes(r)} onChange={(v) => setRole(r, v)} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="ac-h" style={{ borderColor: e.status === "active" ? undefined : "var(--danger)" }}>
        <h2 id="ac-h">Access to the application</h2>
        {e.status === "active" ? (
          <>
            <p>Suspending access signs this person out everywhere immediately and blocks every request they make to the application.</p>
            <p className="small muted">This does not delete files they already downloaded, and it does not sign them out of Clio or Microsoft 365 — do that in those systems as well.</p>
            <Button variant="danger" disabled={data.isSelf || !data.assignableRoles.includes("FIRM_ADMIN")} onClick={() => setSuspendOpen(true)}>
              <Ban size={18} aria-hidden="true" /> Suspend access
            </Button>
            {data.isSelf ? <p className="small muted">You can&apos;t suspend yourself.</p> : null}
          </>
        ) : (
          <>
            <Alert tone="danger" title={`Suspended ${formatDateTime(e.suspendedAt)}`}>{e.suspendedReason ?? "No reason given."}</Alert>
            <div style={{ marginTop: 12 }}>
              <Button onClick={() => call(() => api(`/api/admin/employees/${id}/restore`, { method: "POST" }), "Access restored.")}>
                <CircleCheck size={18} aria-hidden="true" /> Restore access
              </Button>
            </div>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="act-h">
        <h2 id="act-h">Recent activity</h2>
        {e.activity.length === 0 ? <p className="muted">No activity yet.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">When</th><th scope="col">What</th><th scope="col">By</th><th scope="col">Result</th></tr>
              </thead>
              <tbody>
                {e.activity.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{formatDateTime(a.at)}</td>
                    <td><span className="mono">{a.action}</span></td>
                    <td>{a.actorEmail ?? "—"}</td>
                    <td>{a.outcome === "success" ? "OK" : <Badge tone="danger">{a.outcome}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        title={`Suspend ${e.displayName}?`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setSuspendOpen(false)}>Cancel</Button>
            <Button variant="danger" busy={busy} onClick={async () => { setSuspendOpen(false); await call(async () => { const r = await api<{ sessionsEnded: number }>(`/api/admin/employees/${id}/suspend`, { body: { reason } }); setFlash(`Access suspended. ${r.sessionsEnded} active sign-in${r.sessionsEnded === 1 ? " was" : "s were"} ended.`); }); }}>
              Suspend now
            </Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="sus-reason">Reason (kept in the activity log)</label>
          <textarea id="sus-reason" rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
