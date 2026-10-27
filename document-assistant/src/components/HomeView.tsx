"use client";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { UiConfig } from "@/lib/ui-config";
import { SkillIcon } from "./SkillIcon";
import { StatusBadge, timeAgo } from "./ui";

export interface Tile {
  skillId: string;
  label: string;
  description: string;
  icon: string;
  featured: boolean;
  category: string;
}
export interface RecentItem {
  id: string;
  title: string;
  status: string;
  matter: string | null;
  updatedAt: string | Date;
}

function TileButton({ t, onStart, busy }: { t: Tile; onStart: (id: string) => void; busy: string | null }) {
  return (
    <button type="button" className="tile" onClick={() => onStart(t.skillId)} disabled={Boolean(busy)} aria-busy={busy === t.skillId || undefined}>
      <span className="tile-icon">
        <SkillIcon name={t.icon} />
      </span>
      <span className="tile-body">
        <span className="tile-title" style={{ display: "block" }}>
          {t.label}
        </span>
        <span className="tile-desc" style={{ display: "block", marginTop: 6 }}>
          {t.description}
        </span>
      </span>
      <span className="tile-go">
        {busy === t.skillId ? "Starting…" : "Start"} <ArrowRight size={18} aria-hidden="true" />
      </span>
    </button>
  );
}

export function HomeView({ ui, tiles, recent, onStart, busy, preview }: { ui: UiConfig; tiles: Tile[]; recent: RecentItem[]; onStart: (id: string) => void; busy: string | null; preview?: boolean }) {
  const featured = tiles.filter((t) => t.featured);
  const others = tiles.filter((t) => !t.featured);
  const layout = ui.home.layout;
  const byCategory = (list: Tile[]) => {
    const m = new Map<string, Tile[]>();
    for (const t of list) m.set(t.category, [...(m.get(t.category) ?? []), t]);
    return [...m.entries()];
  };

  return (
    <div className="page">
      <section className="home-hero" aria-labelledby="home-heading">
        <h1 id="home-heading">{ui.home.heading}</h1>
        {ui.home.intro ? <p>{ui.home.intro}</p> : null}
      </section>

      {tiles.length === 0 ? (
        <div className="empty">
          <p style={{ fontWeight: 650, color: "var(--text)" }}>No tasks have been set up for you yet.</p>
          <p style={{ margin: 0 }}>Please ask your administrator to give you access.</p>
        </div>
      ) : layout === "list" ? (
        <div className="tile-list">{tiles.map((t) => <TileButton key={t.skillId} t={t} onStart={onStart} busy={busy} />)}</div>
      ) : (
        <>
          {featured.length ? <div className="tiles">{featured.map((t) => <TileButton key={t.skillId} t={t} onStart={onStart} busy={busy} />)}</div> : null}
          {others.length ? (
            layout === "categories" ? (
              byCategory(others).map(([cat, list]) => (
                <section key={cat} className="category-block" aria-label={cat}>
                  <h2 className="section-title">{cat}</h2>
                  <div className="tile-list">{list.map((t) => <TileButton key={t.skillId} t={t} onStart={onStart} busy={busy} />)}</div>
                </section>
              ))
            ) : (
              <section aria-label="More tasks">
                <h2 className="section-title">More tasks</h2>
                <div className="tile-list">{others.map((t) => <TileButton key={t.skillId} t={t} onStart={onStart} busy={busy} />)}</div>
              </section>
            )
          ) : null}
        </>
      )}

      {ui.home.showRecentWork ? (
        <section aria-labelledby="recent-heading">
          <div className="row-between">
            <h2 id="recent-heading" className="section-title">
              {ui.home.recentWorkHeading}
            </h2>
            {recent.length ? (
              <Link href={preview ? "#" : "/work"} className="btn btn-quiet">
                See all
              </Link>
            ) : null}
          </div>
          {recent.length === 0 ? (
            <div className="empty">Nothing yet. When you start a task, it will appear here so you can come back to it.</div>
          ) : (
            <ul className="work-list">
              {recent.map((r) => (
                <li key={r.id}>
                  <div className="w-main">
                    <div className="w-title">{r.title}</div>
                    <div className="w-sub">
                      {r.matter ?? "No case chosen yet"} · Updated {timeAgo(r.updatedAt)}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                  <Link className="btn btn-secondary btn-sm" href={preview ? "#" : `/work/${r.id}`}>
                    {r.status === "approved" ? "Open" : "Continue"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {ui.home.showHelp ? (
        <section aria-labelledby="help-heading" className="panel" style={{ marginTop: 32 }}>
          <h2 id="help-heading" style={{ fontSize: "1.15rem" }}>
            {ui.home.helpHeading}
          </h2>
          <p style={{ margin: 0 }}>{ui.home.helpText}</p>
        </section>
      ) : null}
    </div>
  );
}
