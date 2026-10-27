"use client";
import Link from "next/link";
import { useApi } from "@/components/useApi";
import { Alert, Badge, PageTitle, Spinner, StatusBadge, formatDateTime } from "@/components/ui";

type Item = { id: string; title: string; status: string; matter: string; preparedBy: string; submittedAt: string | null; assignedToMe: boolean; openIssues: number };

export default function ReviewQueuePage() {
  const { data, error } = useApi<{ items: Item[] }>("/api/review");
  const waiting = data?.items.filter((i) => i.status === "submitted") ?? [];
  const done = data?.items.filter((i) => i.status !== "submitted") ?? [];
  const list = (items: Item[]) => (
    <ul className="work-list">
      {items.map((r) => (
        <li key={r.id}>
          <div className="w-main">
            <div className="w-title">{r.title}</div>
            <div className="w-sub">
              {r.matter} · Prepared by {r.preparedBy} · Sent {formatDateTime(r.submittedAt)}
            </div>
          </div>
          {r.assignedToMe ? <Badge tone="accent">Assigned to you</Badge> : null}
          {r.openIssues ? <Badge tone="warning">{r.openIssues} flagged</Badge> : null}
          <StatusBadge status={r.status} />
          <Link className="btn btn-sm" href={`/work/${r.id}`}>
            Review
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="page">
      <PageTitle title="Review Queue" subtitle="Work waiting for an attorney's approval. You only see cases you have access to." />
      {error ? <Alert tone="danger">{error.message}</Alert> : null}
      {!data && !error ? <Spinner /> : null}
      {data ? (
        <div className="stack-lg">
          <section>
            <h2>Waiting for review ({waiting.length})</h2>
            {waiting.length ? list(waiting) : <div className="empty">Nothing is waiting for you.</div>}
          </section>
          {done.length ? (
            <section>
              <h2>Recently decided</h2>
              {list(done)}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
