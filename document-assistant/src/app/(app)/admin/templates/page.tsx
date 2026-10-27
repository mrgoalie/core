"use client";
import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { useApi } from "@/components/useApi";
import { Alert, Badge, Button, ErrorAlert, PageTitle, Spinner, formatDate } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";

type T = { id: string; name: string; description: string | null; isDemonstration: boolean; fileName: string; sizeBytes: number; placeholders: string[]; hasBody: boolean; status: string; uploadedBy: string | null; createdAt: string; usedBy: number };

export default function TemplatesPage() {
  const { data, error, reload } = useApi<{ templates: T[] }>("/api/admin/templates");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{ placeholders: string[]; hasBody: boolean } | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    const form = new FormData();
    form.set("file", file);
    form.set("name", name);
    form.set("description", desc);
    try {
      const r = await api<{ placeholders: string[]; hasBody: boolean }>("/api/admin/templates", { method: "POST", form });
      setResult(r);
      setName("");
      setDesc("");
      setFile(null);
      await reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <PageTitle title="Document Templates" subtitle="Upload the firm's approved Word templates (for example, letterhead). Then choose the template on a skill's “What it produces” section." />
      <section className="card stack" aria-labelledby="up-h">
        <h2 id="up-h">Upload a Word template</h2>
        <Alert tone="info" title="How to prepare a template">
          <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            <li>Open your letterhead in Word.</li>
            <li>Where the letter&apos;s content should go, type <code>{"{{@body}}"}</code> on its own line.</li>
            <li>Optionally add placeholders such as <code>{"{{today}}"}</code>, <code>{"{{client_name}}"}</code> or <code>{"{{draft_banner}}"}</code> (in the header, so drafts are clearly marked).</li>
            <li>Save as .docx and upload it here.</li>
          </ol>
        </Alert>
        <div className="field">
          <label htmlFor="tp-name">Template name</label>
          <input id="tp-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Firm letterhead 2026" />
        </div>
        <div className="field">
          <label htmlFor="tp-desc">Description <span className="opt">(optional)</span></label>
          <input id="tp-desc" type="text" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tp-file">Word file (.docx)</label>
          <input id="tp-file" type="file" accept=".docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <ErrorAlert error={err} />
        {result ? (
          <Alert tone={result.hasBody ? "success" : "warning"} title={result.hasBody ? "Template uploaded" : "Uploaded — but {{@body}} is missing"}>
            Placeholders found: {result.placeholders.length ? result.placeholders.join(", ") : "none"}.
          </Alert>
        ) : null}
        <div>
          <Button onClick={upload} disabled={!file} busy={busy}>
            <Upload size={18} aria-hidden="true" /> Upload template
          </Button>
        </div>
      </section>
      <section aria-labelledby="list-h">
        <h2 id="list-h">Templates</h2>
        {error ? <Alert tone="danger">{error.message}</Alert> : null}
        {!data ? <Spinner /> : (
          <ul className="work-list">
            {data.templates.map((t) => (
              <li key={t.id}>
                <div className="w-main">
                  <div className="w-title">{t.name} {t.isDemonstration ? <Badge tone="warning">Demonstration</Badge> : null} {t.status === "archived" ? <Badge tone="neutral">Archived</Badge> : null}</div>
                  <div className="w-sub">
                    {t.fileName} · uploaded {formatDate(t.createdAt)}{t.uploadedBy ? ` by ${t.uploadedBy}` : ""} · used by {t.usedBy} skill version{t.usedBy === 1 ? "" : "s"}
                  </div>
                  <div className="w-sub">{t.hasBody ? "Has {{@body}}" : "Missing {{@body}}"} · placeholders: {t.placeholders.join(", ") || "none"}</div>
                </div>
                <a className="btn btn-quiet btn-sm" href={`/api/admin/templates/${t.id}`}>
                  <Download size={16} aria-hidden="true" /> Download<span className="sr-only"> {t.name}</span>
                </a>
                {!t.isDemonstration ? (
                  <Button size="sm" variant="secondary" onClick={async () => { await api(`/api/admin/templates/${t.id}`, { method: "PATCH", body: { archived: t.status !== "archived" } }); await reload(); }}>
                    {t.status === "archived" ? "Restore" : "Archive"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
