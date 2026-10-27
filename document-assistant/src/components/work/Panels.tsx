"use client";
import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { Issue, SourceRef } from "@/lib/work-types";

const KIND_LABEL: Record<string, string> = {
  missing_input: "Missing information",
  missing_document: "Missing document",
  missing_evidence: "Missing evidence",
  conflict: "Conflicting information",
  unverified: "Not confirmed",
  unsupported_assertion: "Unsupported statement",
  legal_authority: "Legal authority",
  calculation: "Calculation",
  document_problem: "Document problem",
  drafting_gap: "Draft gap",
  notice: "Notice",
};

export function IssuePanel({ issues }: { issues: Issue[] }) {
  const attention = issues.filter((i) => i.severity === "attention");
  const info = issues.filter((i) => i.severity === "info");
  return (
    <section className="card card-flat" aria-labelledby="issues-h">
      <h2 id="issues-h" style={{ fontSize: "1.15rem" }}>
        {attention.length ? `${attention.length} item${attention.length === 1 ? "" : "s"} need attention` : "Nothing flagged"}
      </h2>
      {attention.length === 0 ? (
        <p className="row" style={{ color: "var(--success)", fontWeight: 600 }}>
          <CircleCheck size={20} aria-hidden="true" /> No missing or conflicting information was found.
        </p>
      ) : (
        <ul className="issue-list">
          {attention.map((i, n) => (
            <li key={n} className="issue attention">
              <TriangleAlert size={18} aria-hidden="true" color="var(--warning)" />
              <span>
                <strong>{KIND_LABEL[i.kind] ?? "Check"}:</strong> {i.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {info.length ? (
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Other notes ({info.length})</summary>
          <ul className="issue-list" style={{ marginTop: 10 }}>
            {info.map((i, n) => (
              <li key={n} className="issue info">
                <Info size={18} aria-hidden="true" />
                <span>{i.message}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function sourceTag(s: SourceRef) {
  switch (s.verification) {
    case "verified_in_document":
      return <span className="source-tag verified">Confirmed in document</span>;
    case "unverified":
      return <span className="source-tag unverified">Not confirmed in document</span>;
    case "matter_record":
      return <span className="source-tag case-file">Case file</span>;
    case "calculated":
      return <span className="source-tag">Calculated</span>;
    default:
      return <span className="source-tag edited">Staff statement</span>;
  }
}

export function SourcePanel({ sources, highlight, docUrl, docIdByName }: { sources: SourceRef[]; highlight?: string | null; docUrl: (docId: string) => string; docIdByName?: Map<string, string> }) {
  const counts = {
    verified: sources.filter((s) => s.verification === "verified_in_document").length,
    staff: sources.filter((s) => s.verification === "employee_statement").length,
    unverified: sources.filter((s) => s.verification === "unverified").length,
  };
  return (
    <section className="card card-flat" aria-labelledby="sources-h">
      <h2 id="sources-h" style={{ fontSize: "1.15rem" }}>
        Where the facts came from
      </h2>
      <p className="small muted">
        {counts.verified} confirmed in documents · {counts.staff} from staff · {counts.unverified} not confirmed
      </p>
      <details open={Boolean(highlight)}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Show all {sources.length} sources</summary>
        <ul className="source-list" style={{ marginTop: 8 }}>
          {sources.map((s) => {
            const docId = s.docId ?? (s.fileName ? docIdByName?.get(s.fileName) : undefined);
            return (
              <li key={s.id} id={`src-${s.id}`} className={highlight === s.id ? "flash" : undefined}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge badge-neutral">{s.id}</span>
                  <strong>{s.label}</strong>
                  {sourceTag(s)}
                </div>
                <div style={{ marginTop: 4 }}>{s.value.length > 220 ? `${s.value.slice(0, 220)}…` : s.value}</div>
                {s.fileName ? (
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {docId ? (
                      <a href={docUrl(docId)} target="_blank" rel="noopener">
                        {s.fileName}
                      </a>
                    ) : (
                      s.fileName
                    )}
                    {s.page ? `, page ${s.page}` : ""}
                  </div>
                ) : null}
                {s.excerpt ? <q className="quote">{s.excerpt}</q> : null}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
