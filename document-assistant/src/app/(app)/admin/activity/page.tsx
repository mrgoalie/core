"use client";
import { useState } from "react";
import { useApi } from "@/components/useApi";
import { Alert, Badge, Button, PageTitle, Spinner, formatDateTime } from "@/components/ui";

type Row = { id: number; at: string; actorEmail: string | null; action: string; outcome: string; targetType: string | null; targetId: string | null; details: Record<string, unknown> | null; ipAddress: string | null };
type Data = { rows: Row[]; hasMore: boolean; page: number; people: { id: string; displayName: string }[] };

export default function ActivityPage() {
  const [q, setQ] = useState("");
  const [actorId, setActorId] = useState("");
  const [outcome, setOutcome] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set("q", q);
  if (actorId) params.set("actorId", actorId);
  if (outcome) params.set("outcome", outcome);
  const { data, error } = useApi<Data>(`/api/admin/activity?${params}`);
  return (
    <div>
      <PageTitle title="Activity" subtitle="A permanent record of sign-ins, administrative changes, document creation, downloads and refused requests. Case contents are never stored here." />
      <div className="row" style={{ marginBottom: 16, alignItems: "flex-end" }}>
        <div className="field" style={{ flex: 2, minWidth: 220 }}>
          <label htmlFor="ac-q">Search</label>
          <input id="ac-q" type="search" value={q} placeholder="For example: suspended, published, denied" onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="ac-p">Person</label>
          <select id="ac-p" value={actorId} onChange={(e) => { setActorId(e.target.value); setPage(1); }}>
            <option value="">Everyone</option>
            {data?.people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="ac-o">Result</label>
          <select id="ac-o" value={outcome} onChange={(e) => { setOutcome(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="success">Succeeded</option>
            <option value="denied">Refused</option>
            <option value="failure">Failed</option>
          </select>
        </div>
      </div>
      {error ? <Alert tone="danger">{error.message}</Alert> : null}
      {!data ? <Spinner /> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Activity log</caption>
              <thead>
                <tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Details</th><th scope="col">Result</th></tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">{formatDateTime(r.at)}</td>
                    <td>{r.actorEmail ?? "—"}</td>
                    <td><span className="mono">{r.action}</span></td>
                    <td className="small">{r.details ? Object.entries(r.details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ") : ""}</td>
                    <td>{r.outcome === "success" ? <Badge tone="success">OK</Badge> : r.outcome === "denied" ? <Badge tone="danger">Refused</Badge> : <Badge tone="warning">Failed</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
            <span className="small muted">Page {page}</span>
            <Button variant="secondary" size="sm" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>Older</Button>
          </div>
        </>
      )}
    </div>
  );
}
