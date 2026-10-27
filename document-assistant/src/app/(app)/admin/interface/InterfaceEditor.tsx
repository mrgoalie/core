"use client";
import { ArrowDown, ArrowUp, Check, Monitor, Plus, RotateCcw, Smartphone, Tablet, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SkillIcon } from "@/components/SkillIcon";
import { useApi } from "@/components/useApi";
import { Alert, Badge, Button, ErrorAlert, Modal, Spinner, formatDateTime } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { APPROVED_ICONS } from "@/lib/icons";
import { ACCENT_PRESETS, BACKGROUNDS, contrastRatio, LAYOUTS, MIN_CONTRAST, TYPOGRAPHY_PRESETS, type UiConfig } from "@/lib/ui-config";

type SkillRow = { id: string; name: string; shortDescription: string; icon: string; category: string; enabled: boolean };
type Data = {
  draft: { versionId: string | null; versionNumber: number | null; config: UiConfig; isNew: boolean };
  published: UiConfig;
  versions: { id: string; number: number; status: string; publishedAt: string | null; publishedBy: string | null; note: string | null }[];
  skills: SkillRow[];
  employees: { id: string; displayName: string; skillIds: string[] }[];
};

const DEVICES = [
  { key: "desktop", label: "Desktop", width: 1280, icon: Monitor },
  { key: "tablet", label: "Tablet", width: 820, icon: Tablet },
  { key: "mobile", label: "Phone", width: 390, icon: Smartphone },
] as const;

export function InterfaceEditor() {
  const { data, error, reload } = useApi<Data>("/api/admin/ui");
  const [cfg, setCfg] = useState<UiConfig | null>(null);
  const [tab, setTab] = useState<"branding" | "home" | "skills" | "navigation">("branding");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<ApiError | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [device, setDevice] = useState<(typeof DEVICES)[number]["key"]>("desktop");
  const [asUser, setAsUser] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (data && !cfg) {
      setCfg(withAllSkills(data.draft.config, data.skills));
      setHasDraft(!data.draft.isNew);
    }
  }, [data, cfg]);

  const save = useCallback(async (next: UiConfig) => {
    setSaveState("saving");
    try {
      await api("/api/admin/ui", { method: "PUT", body: { config: next } });
      setSaveState("saved");
      setErr(null);
      setHasDraft(true);
      setPreviewKey((k) => k + 1);
    } catch (e) {
      setSaveState("error");
      setErr(e as ApiError);
    }
  }, []);

  const edit = (fn: (d: UiConfig) => void) => {
    setCfg((prev) => {
      const d = structuredClone(prev!);
      fn(d);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(d), 600);
      return d;
    });
    setSaveState("saving");
  };

  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!data || !cfg) return <Spinner />;

  async function publish() {
    setBusy("publish");
    try {
      if (timer.current) {
        clearTimeout(timer.current);
        await save(cfg!);
      }
      const r = await api<{ versionNumber: number }>("/api/admin/ui/publish", { body: { note } });
      setPublishOpen(false);
      setNote("");
      setFlash(`Published as version ${r.versionNumber}. Employees now see the new layout.`);
      setHasDraft(false);
      await reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(null);
    }
  }
  async function discard() {
    setBusy("discard");
    try {
      await api("/api/admin/ui", { method: "DELETE" });
      const d = await api<Data>("/api/admin/ui");
      setCfg(withAllSkills(d.draft.config, d.skills));
      setHasDraft(false);
      setPreviewKey((k) => k + 1);
      setFlash("Unpublished changes were discarded.");
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(null);
    }
  }
  async function restore(versionId: string) {
    setBusy(versionId);
    try {
      const r = await api<{ versionNumber: number }>("/api/admin/ui/restore", { body: { versionId } });
      const d = await api<Data>("/api/admin/ui");
      setCfg(withAllSkills(d.draft.config, d.skills));
      setHasDraft(false);
      setPreviewKey((k) => k + 1);
      setFlash(`Restored and published as version ${r.versionNumber}.`);
      await reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(null);
    }
  }
  async function uploadLogo(file: File) {
    const form = new FormData();
    form.set("file", file);
    try {
      const r = await api<{ assetId: string }>("/api/admin/ui/logo", { method: "POST", form });
      edit((d) => void (d.branding.logoAssetId = r.assetId));
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  const accentOk = contrastRatio(cfg.branding.accentColor, "#FFFFFF") >= MIN_CONTRAST;
  const dev = DEVICES.find((d) => d.key === device)!;
  const skillById = new Map(data.skills.map((s) => [s.id, s]));

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h1 style={{ marginBottom: 6 }}>Interface Editor</h1>
          <p className="muted" style={{ margin: 0 }}>Change what employees see. Changes are saved as a draft and only appear after you publish.</p>
        </div>
        <div className="row">
          <span className="save-state" role="status" aria-live="polite">
            {saveState === "saving" ? "Saving draft…" : saveState === "saved" ? (<><Check size={16} aria-hidden="true" /> Draft saved</>) : saveState === "error" ? "Not saved" : hasDraft ? "Unpublished changes" : "No unpublished changes"}
          </span>
          <Button variant="secondary" disabled={!hasDraft} busy={busy === "discard"} onClick={discard}>
            Discard changes
          </Button>
          <Button disabled={!hasDraft || saveState === "error"} onClick={() => setPublishOpen(true)}>
            Publish
          </Button>
        </div>
      </div>
      {flash ? <Alert tone="success" role="status">{flash}</Alert> : null}
      <ErrorAlert error={err} />
      <Alert tone="info">
        Some things can&apos;t be changed here, by design: legal warnings, attorney review, sign-in and security, and which skills each person may use (set that under Manage Employees or on each skill).
      </Alert>

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)", alignItems: "start" }}>
        <div className="stack">
          <div className="seg" role="group" aria-label="Editor sections" style={{ flexWrap: "wrap" }}>
            {(["branding", "home", "skills", "navigation"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
                {{ branding: "Branding", home: "Home screen", skills: "Skills on home screen", navigation: "Navigation" }[t]}
              </button>
            ))}
          </div>

          {tab === "branding" ? (
            <section className="card stack" aria-label="Branding">
              <div className="field">
                <label htmlFor="ui-firm">Firm name</label>
                <input id="ui-firm" type="text" value={cfg.branding.firmName} onChange={(e) => edit((d) => void (d.branding.firmName = e.target.value))} />
              </div>
              <div className="field">
                <label htmlFor="ui-app">Application name</label>
                <input id="ui-app" type="text" value={cfg.branding.appName} onChange={(e) => edit((d) => void (d.branding.appName = e.target.value))} />
              </div>
              <div className="field">
                <span className="field-label">Logo</span>
                <div className="row">
                  {cfg.branding.logoAssetId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/branding/logo/${cfg.branding.logoAssetId}`} alt="Current logo" style={{ maxHeight: 48, maxWidth: 160 }} />
                  ) : (
                    <span className="muted">No logo — the firm&apos;s initials are shown.</span>
                  )}
                  <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
                    <Upload size={16} aria-hidden="true" /> Upload logo
                    <input type="file" className="sr-only" accept="image/png,image/jpeg" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadLogo(f); }} />
                  </label>
                  {cfg.branding.logoAssetId ? (
                    <Button size="sm" variant="quiet" onClick={() => edit((d) => void (d.branding.logoAssetId = null))}>
                      Remove logo
                    </Button>
                  ) : null}
                </div>
                <div className="hint">PNG or JPEG, under 1 MB.</div>
              </div>
              <fieldset className="field">
                <legend>Accent colour</legend>
                <div className="swatches">
                  {ACCENT_PRESETS.map((p) => (
                    <button key={p.key} type="button" className="swatch" style={{ background: p.hex }} aria-pressed={cfg.branding.accentColor.toLowerCase() === p.hex.toLowerCase()} aria-label={p.label} onClick={() => edit((d) => void (d.branding.accentColor = p.hex))}>
                      {cfg.branding.accentColor.toLowerCase() === p.hex.toLowerCase() ? <Check size={22} aria-hidden="true" /> : null}
                    </button>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <label htmlFor="ui-color">Or choose any colour</label>
                  <input id="ui-color" type="color" value={cfg.branding.accentColor} onChange={(e) => edit((d) => void (d.branding.accentColor = e.target.value.toUpperCase()))} style={{ width: 64, minHeight: 44, padding: 2 }} />
                  <span className={`badge ${accentOk ? "badge-success" : "badge-danger"}`}>
                    Contrast {contrastRatio(cfg.branding.accentColor, "#FFFFFF").toFixed(1)}:1 {accentOk ? "— readable" : "— too light"}
                  </span>
                </div>
                {!accentOk ? <div className="error">This colour is too light for white button text. It won&apos;t be saved — choose a darker colour.</div> : null}
              </fieldset>
              <fieldset className="field">
                <legend>Text size</legend>
                <div className="yesno" style={{ flexWrap: "wrap" }}>
                  {TYPOGRAPHY_PRESETS.map((t) => (
                    <label key={t.key}>
                      <input type="radio" name="ui-type" checked={cfg.branding.typography === t.key} onChange={() => edit((d) => void (d.branding.typography = t.key))} /> {t.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="field">
                <legend>Heading style</legend>
                <div className="yesno">
                  <label>
                    <input type="radio" name="ui-head" checked={cfg.branding.headingStyle === "serif"} onChange={() => edit((d) => void (d.branding.headingStyle = "serif"))} /> Classic (serif)
                  </label>
                  <label>
                    <input type="radio" name="ui-head" checked={cfg.branding.headingStyle === "sans"} onChange={() => edit((d) => void (d.branding.headingStyle = "sans"))} /> Modern (sans-serif)
                  </label>
                </div>
              </fieldset>
              <fieldset className="field">
                <legend>Background</legend>
                <div className="yesno" style={{ flexWrap: "wrap" }}>
                  {BACKGROUNDS.map((b) => (
                    <label key={b.key}>
                      <input type="radio" name="ui-bg" checked={cfg.branding.background === b.key} onChange={() => edit((d) => void (d.branding.background = b.key))} />
                      <span style={{ width: 18, height: 18, borderRadius: 4, background: b.hex, border: "1px solid var(--border)", display: "inline-block" }} aria-hidden="true" /> {b.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <Button variant="secondary" onClick={async () => { await api("/api/admin/ui", { method: "PUT", body: { resetBranding: true } }); const d = await api<Data>("/api/admin/ui"); setCfg(withAllSkills(d.draft.config, d.skills)); setHasDraft(true); setPreviewKey((k) => k + 1); }}>
                  <RotateCcw size={16} aria-hidden="true" /> Restore original branding
                </Button>
              </div>
            </section>
          ) : null}

          {tab === "home" ? (
            <section className="card stack" aria-label="Home screen">
              <div className="field">
                <label htmlFor="ui-heading">Welcome heading</label>
                <input id="ui-heading" type="text" value={cfg.home.heading} onChange={(e) => edit((d) => void (d.home.heading = e.target.value))} />
              </div>
              <div className="field">
                <label htmlFor="ui-intro">Introductory text</label>
                <textarea id="ui-intro" rows={3} value={cfg.home.intro} onChange={(e) => edit((d) => void (d.home.intro = e.target.value))} />
              </div>
              <fieldset className="field">
                <legend>Layout</legend>
                <div className="choice-cards">
                  {LAYOUTS.map((l) => (
                    <label key={l.key} className="choice-card">
                      <input type="radio" name="ui-layout" checked={cfg.home.layout === l.key} onChange={() => edit((d) => void (d.home.layout = l.key))} />
                      <span>
                        <strong>{l.label}</strong>
                        <span className="small muted" style={{ display: "block" }}>{l.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="check">
                <input type="checkbox" checked={cfg.home.showRecentWork} onChange={(e) => edit((d) => void (d.home.showRecentWork = e.target.checked))} />
                <span>Show recent work on the home screen</span>
              </label>
              {cfg.home.showRecentWork ? (
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="ui-rw">Recent work heading</label>
                    <input id="ui-rw" type="text" value={cfg.home.recentWorkHeading} onChange={(e) => edit((d) => void (d.home.recentWorkHeading = e.target.value))} />
                  </div>
                  <div className="field">
                    <label htmlFor="ui-rwc">How many to show</label>
                    <select id="ui-rwc" value={cfg.home.recentWorkCount} onChange={(e) => edit((d) => void (d.home.recentWorkCount = Number(e.target.value)))}>
                      {[3, 4, 5, 6, 8, 10].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : null}
              <label className="check">
                <input type="checkbox" checked={cfg.home.showHelp} onChange={(e) => edit((d) => void (d.home.showHelp = e.target.checked))} />
                <span>Show a help box</span>
              </label>
              {cfg.home.showHelp ? (
                <>
                  <div className="field">
                    <label htmlFor="ui-hh">Help heading</label>
                    <input id="ui-hh" type="text" value={cfg.home.helpHeading} onChange={(e) => edit((d) => void (d.home.helpHeading = e.target.value))} />
                  </div>
                  <div className="field">
                    <label htmlFor="ui-ht">Help text</label>
                    <textarea id="ui-ht" rows={3} value={cfg.home.helpText} onChange={(e) => edit((d) => void (d.home.helpText = e.target.value))} />
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          {tab === "skills" ? (
            <section className="card stack" aria-label="Skills on the home screen">
              <p className="muted" style={{ margin: 0 }}>
                Rename skills for employees, choose icons, and set the order. Featured skills appear as large buttons; the others appear in a shorter list. Each person still only sees the skills they are allowed to use.
              </p>
              <ul className="checklist">
                {cfg.skills.map((s, i) => {
                  const skill = skillById.get(s.skillId);
                  if (!skill) return null;
                  return (
                    <li key={s.skillId} className="req-item" style={{ padding: 14 }}>
                      <div className="row-between">
                        <div className="row">
                          <span className="tile-icon" style={{ width: 44, height: 44 }}>
                            <SkillIcon name={s.icon ?? skill.icon} size={22} />
                          </span>
                          <strong>{s.label || skill.name}</strong>
                          {!skill.enabled ? <Badge tone="danger">Turned off</Badge> : null}
                        </div>
                        <div className="item-actions">
                          <button type="button" className="icon-btn" aria-label={`Move ${s.label || skill.name} up`} disabled={i === 0} onClick={() => edit((d) => { [d.skills[i - 1], d.skills[i]] = [d.skills[i], d.skills[i - 1]]; })}>
                            <ArrowUp size={16} aria-hidden="true" />
                          </button>
                          <button type="button" className="icon-btn" aria-label={`Move ${s.label || skill.name} down`} disabled={i === cfg.skills.length - 1} onClick={() => edit((d) => { [d.skills[i + 1], d.skills[i]] = [d.skills[i], d.skills[i + 1]]; })}>
                            <ArrowDown size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <div className="stack" style={{ marginTop: 12 }}>
                        <div className="field">
                          <label htmlFor={`sl-${i}`}>Name shown to employees</label>
                          <input id={`sl-${i}`} type="text" placeholder={skill.name} value={s.label ?? ""} onChange={(e) => edit((d) => void (d.skills[i].label = e.target.value || undefined))} />
                        </div>
                        <div className="field">
                          <label htmlFor={`sd-${i}`}>Description shown to employees</label>
                          <textarea id={`sd-${i}`} rows={2} placeholder={skill.shortDescription} value={s.description ?? ""} onChange={(e) => edit((d) => void (d.skills[i].description = e.target.value || undefined))} />
                        </div>
                        <div className="grid-2">
                          <div className="field">
                            <label htmlFor={`si-${i}`}>Icon</label>
                            <select id={`si-${i}`} value={s.icon ?? ""} onChange={(e) => edit((d) => void (d.skills[i].icon = (e.target.value || undefined) as never))}>
                              <option value="">Skill&apos;s own icon</option>
                              {APPROVED_ICONS.map((ic) => (
                                <option key={ic.key} value={ic.key}>
                                  {ic.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field">
                            <label htmlFor={`sc-${i}`}>Category</label>
                            <select id={`sc-${i}`} value={s.categoryId ?? ""} onChange={(e) => edit((d) => void (d.skills[i].categoryId = e.target.value || undefined))}>
                              <option value="">Skill&apos;s own category ({skill.category})</option>
                              {cfg.categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <label className="check">
                          <input type="checkbox" checked={s.featured} onChange={(e) => edit((d) => void (d.skills[i].featured = e.target.checked))} />
                          <span>Featured (large button)</span>
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <fieldset className="field">
                <legend>Categories</legend>
                {cfg.categories.map((c, i) => (
                  <div key={c.id} className="row" style={{ marginBottom: 8 }}>
                    <label htmlFor={`cat-${i}`} className="sr-only">Category name</label>
                    <input id={`cat-${i}`} type="text" value={c.name} onChange={(e) => edit((d) => void (d.categories[i].name = e.target.value))} style={{ flex: 1 }} />
                    <button type="button" className="icon-btn" aria-label={`Delete category ${c.name}`} onClick={() => edit((d) => { d.categories.splice(i, 1); d.skills.forEach((s) => { if (s.categoryId === c.id) s.categoryId = undefined; }); })}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <div>
                  <Button size="sm" variant="secondary" onClick={() => edit((d) => void d.categories.push({ id: `cat-${Date.now().toString(36)}`, name: "New category" }))}>
                    <Plus size={16} aria-hidden="true" /> Add a category
                  </Button>
                </div>
              </fieldset>
            </section>
          ) : null}

          {tab === "navigation" ? (
            <section className="card stack" aria-label="Navigation">
              <Alert tone="info">Home and My Work are always shown so employees can never get lost. You can rename them.</Alert>
              {(["homeLabel", "myWorkLabel", "reviewLabel"] as const).map((k) => (
                <div className="field" key={k}>
                  <label htmlFor={`nav-${k}`}>{{ homeLabel: "Home link", myWorkLabel: "My Work link", reviewLabel: "Review Queue link (attorneys only)" }[k]}</label>
                  <input id={`nav-${k}`} type="text" value={cfg.navigation[k]} onChange={(e) => edit((d) => void (d.navigation[k] = e.target.value))} />
                </div>
              ))}
              <label className="check">
                <input type="checkbox" checked={cfg.navigation.showHelpLink} onChange={(e) => edit((d) => void (d.navigation.showHelpLink = e.target.checked))} />
                <span>Show a Help link</span>
              </label>
              {cfg.navigation.showHelpLink ? (
                <div className="field">
                  <label htmlFor="nav-help">Help link label</label>
                  <input id="nav-help" type="text" value={cfg.navigation.helpLabel} onChange={(e) => edit((d) => void (d.navigation.helpLabel = e.target.value))} />
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="card" aria-labelledby="hist-h">
            <h2 id="hist-h" style={{ fontSize: "1.15rem" }}>Published versions</h2>
            <ul className="version-list">
              {data.versions.filter((v) => v.status !== "draft").map((v) => (
                <li key={v.id} className="row-between">
                  <span>
                    <strong>Version {v.number}</strong> {v.status === "published" ? <Badge tone="success">Live now</Badge> : null}
                    <span className="small muted" style={{ display: "block" }}>
                      {formatDateTime(v.publishedAt)}{v.publishedBy ? ` by ${v.publishedBy}` : ""}{v.note ? ` — ${v.note}` : ""}
                    </span>
                  </span>
                  {v.status !== "published" ? (
                    <Button size="sm" variant="secondary" busy={busy === v.id} onClick={() => restore(v.id)}>
                      <RotateCcw size={16} aria-hidden="true" /> Restore
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="stack" aria-label="Preview">
          <div className="row-between">
            <h2 style={{ margin: 0, fontSize: "1.2rem" }}>Preview (unpublished draft)</h2>
            <div className="seg" role="group" aria-label="Device">
              {DEVICES.map((d) => (
                <button key={d.key} type="button" aria-pressed={device === d.key} onClick={() => setDevice(d.key)}>
                  <d.icon size={16} aria-hidden="true" style={{ verticalAlign: "-3px" }} /> {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="pv-as">Preview as</label>
            <select id="pv-as" value={asUser} onChange={(e) => setAsUser(e.target.value)}>
              <option value="">Yourself</option>
              {data.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.displayName} ({e.skillIds.length} skill{e.skillIds.length === 1 ? "" : "s"})
                </option>
              ))}
            </select>
          </div>
          <PreviewFrame width={dev.width} label={dev.label} src={`/preview/home?as=${encodeURIComponent(asUser)}&v=${previewKey}`} frameKey={`${previewKey}-${asUser}`} />
        </section>
      </div>

      <Modal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title="Publish these changes?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button busy={busy === "publish"} onClick={publish}>
              Publish now
            </Button>
          </>
        }
      >
        <p>Employees will see the new layout the next time a page loads. You can restore an earlier version at any time.</p>
        <div className="field">
          <label htmlFor="pub-note">Short note (optional)</label>
          <input id="pub-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: renamed the demand letter skill" />
        </div>
      </Modal>
    </div>
  );
}

const FRAME_HEIGHT = 900;

/** Shows the preview at the real device width, scaled down to fit the space available. */
function PreviewFrame({ width, label, src, frameKey }: { width: number; label: string; src: string; frameKey: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(600);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth - 36));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(1, avail / width);
  return (
    <div className="preview-frame-wrap" ref={wrap}>
      <div style={{ width: width * scale, height: FRAME_HEIGHT * scale, margin: "0 auto", position: "relative", overflow: "hidden" }}>
        <iframe
          key={frameKey}
          title={`Preview of the employee home screen on ${label}`}
          className="preview-frame"
          src={src}
          style={{ width, height: FRAME_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left", position: "absolute", top: 0, left: 0 }}
        />
      </div>
      <p className="small muted" style={{ textAlign: "center", margin: "10px 0 0" }}>
        {label}: {width}px wide{scale < 1 ? ` (shown at ${Math.round(scale * 100)}%)` : ""}
      </p>
    </div>
  );
}

/** Make sure every published skill has a presentation entry so it can be ordered and renamed. */
function withAllSkills(cfg: UiConfig, skills: SkillRow[]): UiConfig {
  const known = new Set(cfg.skills.map((s) => s.skillId));
  const extra = skills.filter((s) => !known.has(s.id)).map((s) => ({ skillId: s.id, featured: true }));
  return { ...cfg, skills: [...cfg.skills.filter((s) => skills.some((k) => k.id === s.skillId)), ...extra] };
}
