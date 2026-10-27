"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/components/useApi";
import { Alert, PageTitle, Spinner, StatusBadge, timeAgo } from "@/components/ui";

type Item = { id: string; title: string; status: string; matter: string | null; updatedAt: string };
const FILTERS = [
  { key: "all", label: "All", match: () => true },
  { key: "progress", label: "In progress", match: (s: string) => s === "in_progress" || s === "ready" },
  { key: "review", label: "Waiting for review", match: (s: string) => s === "submitted" },
  { key: "changes", label: "Changes requested", match: (s: string) => s === "changes_requested" },
  { key: "approved", label: "Approved", match: (s: string) => s === "approved" },
];

export default function MyWorkPage() {
  const { data, error } = useApi<{ items: Item[] }>("/api/work");
  const [filter, setFilter] = useState("all");
  const f = FILTERS.find((x) => x.key === filter)!;
  const items = data?.items.filter((i) => f.match(i.status)) ?? [];
  return (
    <div className="page">
      <PageTitle title="My Work" subtitle="Everything you've started. Your work is saved automatically." />
      <div className="seg" role="group" aria-label="Show" style={{ marginBottom: 20, flexWrap: "wrap" }}>
        {FILTERS.map((x) => (
          <button key={x.key} type="button" aria-pressed={filter === x.key} onClick={() => setFilter(x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      {error ? <Alert tone="danger">{error.message}</Alert> : null}
      {!data && !error ? <Spinner /> : null}
      {data && items.length === 0 ? <div className="empty">Nothing here yet.</div> : null}
      {items.length ? (
        <ul className="work-list">
          {items.map((r) => (
            <li key={r.id}>
              <div className="w-main">
                <div className="w-title">{r.title}</div>
                <div className="w-sub">
                  {r.matter ?? "No case chosen yet"} · Updated {timeAgo(r.updatedAt)}
                </div>
              </div>
              <StatusBadge status={r.status} />
              <Link className="btn btn-secondary btn-sm" href={`/work/${r.id}`}>
                Open
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
