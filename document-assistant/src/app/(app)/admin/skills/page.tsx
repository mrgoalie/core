"use client";
import { Plus } from "lucide-react";
import Link from "next/link";
import { SkillIcon } from "@/components/SkillIcon";
import { useApi } from "@/components/useApi";
import { Alert, Badge, LinkButton, PageTitle, Spinner } from "@/components/ui";

type Row = {
  id: string;
  name: string;
  shortDescription: string;
  icon: string;
  category: string;
  enabled: boolean;
  archived: boolean;
  isBuiltIn: boolean;
  publishedVersion: { number: number } | null;
  draftVersion: { number: number; status: string; testStatus: string; significance: string } | null;
  grantedCount: number;
};

const STATUS: Record<string, string> = { draft: "Draft", testing: "Testing", approved: "Approved — ready to publish" };

export default function SkillsAdminPage() {
  const { data, error } = useApi<{ skills: Row[] }>("/api/admin/skills");
  const active = data?.skills.filter((s) => !s.archived) ?? [];
  const archived = data?.skills.filter((s) => s.archived) ?? [];
  return (
    <div>
      <PageTitle
        title="Manage Skills"
        subtitle="Each skill is a guided task employees can use. Edits create a new draft version; employees keep using the published version until you publish the new one."
        actions={
          <LinkButton href="/admin/skills/new">
            <Plus size={18} aria-hidden="true" /> Create New Skill
          </LinkButton>
        }
      />
      {error ? <Alert tone="danger">{error.message}</Alert> : null}
      {!data && !error ? <Spinner /> : null}
      {active.length ? (
        <ul className="work-list">
          {active.map((s) => (
            <li key={s.id}>
              <span className="tile-icon" style={{ width: 48, height: 48 }}>
                <SkillIcon name={s.icon} size={24} />
              </span>
              <div className="w-main">
                <div className="w-title">{s.name}</div>
                <div className="w-sub">{s.shortDescription}</div>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  {s.publishedVersion ? <Badge tone="success">Published v{s.publishedVersion.number}</Badge> : <Badge tone="neutral">Not published</Badge>}
                  {s.draftVersion ? <Badge tone="warning">{STATUS[s.draftVersion.status] ?? s.draftVersion.status} v{s.draftVersion.number}</Badge> : null}
                  {!s.enabled ? <Badge tone="danger">Turned off</Badge> : null}
                  <Badge tone="neutral">{s.grantedCount} {s.grantedCount === 1 ? "person" : "people"} can use it</Badge>
                </div>
              </div>
              <Link className="btn btn-secondary btn-sm" href={`/admin/skills/${s.id}`}>
                Open
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {archived.length ? (
        <details style={{ marginTop: 28 }}>
          <summary style={{ cursor: "pointer", fontWeight: 650 }}>Archived skills ({archived.length})</summary>
          <ul className="work-list" style={{ marginTop: 12 }}>
            {archived.map((s) => (
              <li key={s.id}>
                <div className="w-main">
                  <div className="w-title">{s.name}</div>
                </div>
                <Link className="btn btn-secondary btn-sm" href={`/admin/skills/${s.id}`}>
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
