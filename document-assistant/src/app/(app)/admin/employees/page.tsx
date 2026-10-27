"use client";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/components/useApi";
import { Alert, Badge, Button, ErrorAlert, Modal, PageTitle, Spinner, formatDateTime } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";

type Emp = { id: string; email: string; displayName: string; jobTitle: string | null; status: string; lastLoginAt: string | null; roles: string[]; skillIds: string[] };
type Data = { employees: Emp[]; skills: { id: string; name: string; published: boolean; enabled: boolean }[]; assignableRoles: string[] };
const ROLE_LABELS: Record<string, string> = { EMPLOYEE: "Employee", ATTORNEY_REVIEWER: "Attorney Reviewer", FIRM_ADMIN: "Firm Administrator", SYSTEM_ADMIN: "System Administrator" };

export default function EmployeesPage() {
  const { data, error, reload } = useApi<Data>("/api/admin/employees");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ displayName: "", email: "", jobTitle: "", roles: [] as string[], skillIds: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [q, setQ] = useState("");
  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!data) return <Spinner />;
  const skillName = new Map(data.skills.map((s) => [s.id, s.name]));
  const list = data.employees.filter((e) => !q || `${e.displayName} ${e.email} ${e.jobTitle ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/admin/employees", { body: { ...form, jobTitle: form.jobTitle || undefined, roles: ["EMPLOYEE", ...form.roles] } });
      setOpen(false);
      setForm({ displayName: "", email: "", jobTitle: "", roles: [], skillIds: [] });
      await reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageTitle
        title="Manage Employees"
        subtitle="People sign in with their Microsoft 365 work account. Add them here first, then choose which skills they can use."
        actions={data.assignableRoles.includes("FIRM_ADMIN") ? (
          <Button onClick={() => setOpen(true)}>
            <Plus size={18} aria-hidden="true" /> Add employee
          </Button>
        ) : null}
      />
      <div className="field" style={{ maxWidth: 420, marginBottom: 16 }}>
        <label htmlFor="emp-q">Find someone</label>
        <input id="emp-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Employees</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col">Access</th>
              <th scope="col">Allowed skills</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td>
                  <strong>{e.displayName}</strong>
                  <div className="small muted">{e.email}</div>
                  <div className="small muted">{e.jobTitle ?? ""}</div>
                </td>
                <td>{e.roles.filter((r) => r !== "EMPLOYEE").map((r) => ROLE_LABELS[r]).join(", ") || "Employee"}</td>
                <td>
                  {e.status === "active" ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Suspended</Badge>}
                  <div className="small muted">Last sign-in: {formatDateTime(e.lastLoginAt)}</div>
                </td>
                <td>{e.skillIds.length ? e.skillIds.map((id) => skillName.get(id)).filter(Boolean).join(", ") : <span className="muted">None</span>}</td>
                <td>
                  <Link className="btn btn-secondary btn-sm" href={`/admin/employees/${e.id}`}>
                    Manage<span className="sr-only"> {e.displayName}</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add an employee"
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button busy={busy} onClick={create}>Add employee</Button>
          </>
        }
      >
        <div className="stack">
          <div className="field">
            <label htmlFor="ne-name">Full name</label>
            <input id="ne-name" type="text" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ne-email">Work email (Microsoft 365)</label>
            <input id="ne-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ne-title">Job title <span className="opt">(optional)</span></label>
            <input id="ne-title" type="text" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          </div>
          <fieldset className="field">
            <legend>Extra roles</legend>
            {data.assignableRoles.filter((r) => r !== "EMPLOYEE").map((r) => (
              <label key={r} className="check">
                <input type="checkbox" checked={form.roles.includes(r)} onChange={(e) => setForm({ ...form, roles: e.target.checked ? [...form.roles, r] : form.roles.filter((x) => x !== r) })} />
                <span>{ROLE_LABELS[r]}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="field">
            <legend>Skills they can use</legend>
            {data.skills.map((s) => (
              <label key={s.id} className="check">
                <input type="checkbox" checked={form.skillIds.includes(s.id)} onChange={(e) => setForm({ ...form, skillIds: e.target.checked ? [...form.skillIds, s.id] : form.skillIds.filter((x) => x !== s.id) })} />
                <span>{s.name}{!s.published ? " (not published yet)" : ""}</span>
              </label>
            ))}
          </fieldset>
          <ErrorAlert error={err} />
        </div>
      </Modal>
    </div>
  );
}
