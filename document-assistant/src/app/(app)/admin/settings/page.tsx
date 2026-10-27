"use client";
import { useState } from "react";
import { EmergencyControl } from "@/components/admin/EmergencyControl";
import { useApi } from "@/components/useApi";
import { Alert, Badge, Button, ErrorAlert, PageTitle, Spinner, Switch, formatDateTime } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { MATTER_FIELDS } from "@/lib/matter-fields";

type Data = {
  generation: { suspended: boolean; reason: string; changedBy: string | null; changedAt: string | null };
  ai: { provider: "demo" | "anthropic"; model: string; extractionEffort: string; draftingEffort: string; maxRunsPerUserPerDay: number; monthlyBudgetUsd: number; governance: { acknowledgedBy: string; acknowledgedAt: string; notes?: string } | null };
  aiStatus: { selected: string; model: string; isDemonstration: boolean; anthropicKeyPresent: boolean; governanceComplete: boolean };
  aiUsage: { runs: number; failures: number; inputTokens: number; outputTokens: number; costUsd: number };
  review: { allowSelfApproval: boolean };
  retention: { workingFileDays: number; testRunDays: number };
  clio: { fieldMap: Record<string, string> };
  environment: Record<string, string | boolean>;
  canEditSystem: boolean;
};

const ENV_LABELS: Record<string, string> = {
  appEnv: "Environment",
  authMode: "Sign-in",
  entraConfigured: "Microsoft Entra ID configured",
  caseManagement: "Case management",
  caseManagementVerified: "Case management verified live",
  clioConfigured: "Clio credentials present",
  storage: "File storage",
  database: "Database",
  scanner: "Upload screening",
  pdfConverter: "PDF creation",
  ocr: "Text recognition (OCR)",
};

export default function SettingsPage() {
  const { data, error, reload } = useApi<Data>("/api/admin/settings");
  const [err, setErr] = useState<ApiError | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [ai, setAi] = useState<Data["ai"] | null>(null);
  const [gov, setGov] = useState({ dataRetention: false, noTrainingOnData: false, contractInPlace: false, securityReviewed: false, notes: "" });
  const [retention, setRetention] = useState<Data["retention"] | null>(null);
  const [fieldMap, setFieldMap] = useState<Record<string, string> | null>(null);

  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!data) return <Spinner />;
  const a = ai ?? data.ai;
  const r = retention ?? data.retention;
  const fm = fieldMap ?? data.clio.fieldMap;
  const ro = !data.canEditSystem;

  async function put(body: unknown, msg: string) {
    setErr(null);
    try {
      await api("/api/admin/settings", { method: "PUT", body });
      setFlash(msg);
      setAi(null);
      setRetention(null);
      setFieldMap(null);
      await reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  return (
    <div className="stack-lg">
      <PageTitle title="Settings" subtitle={ro ? "Technical settings can only be changed by a System Administrator." : "Technical settings for System Administrators."} />
      {flash ? <Alert tone="success" role="status">{flash}</Alert> : null}
      <ErrorAlert error={err} />
      <EmergencyControl suspended={data.generation.suspended} reason={data.generation.reason} />

      <section className="card" aria-labelledby="st-h">
        <h2 id="st-h">System status</h2>
        <dl className="kv">
          {Object.entries(data.environment).map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{ENV_LABELS[k] ?? k}</dt>
              <dd>{typeof v === "boolean" ? (v ? <Badge tone="success">Yes</Badge> : <Badge tone="warning">No</Badge>) : String(v)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card stack" aria-labelledby="ai-h">
        <h2 id="ai-h">AI provider</h2>
        <p className="muted" style={{ margin: 0 }}>
          Employees never choose or see the AI provider. The demonstration engine uses fixed rules and sends nothing outside the application.
        </p>
        <div className="row">
          <Badge tone={data.aiStatus.isDemonstration ? "warning" : "success"}>{data.aiStatus.isDemonstration ? "Demonstration engine (no AI)" : `Anthropic Claude — ${data.aiStatus.model}`}</Badge>
          <Badge tone={data.aiStatus.anthropicKeyPresent ? "success" : "neutral"}>API key {data.aiStatus.anthropicKeyPresent ? "present" : "not configured"}</Badge>
          {!data.aiStatus.isDemonstration ? <Badge tone={data.aiStatus.governanceComplete ? "success" : "danger"}>Data-governance review {data.aiStatus.governanceComplete ? "complete" : "required"}</Badge> : null}
        </div>
        <p className="small">This month: {data.aiUsage.runs} AI runs ({data.aiUsage.failures} not successful), {data.aiUsage.inputTokens.toLocaleString()} input / {data.aiUsage.outputTokens.toLocaleString()} output tokens, about ${data.aiUsage.costUsd.toFixed(2)}.</p>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="ai-p">Provider</label>
            <select id="ai-p" disabled={ro} value={a.provider} onChange={(e) => setAi({ ...a, provider: e.target.value as "demo" | "anthropic" })}>
              <option value="demo">Demonstration engine (no AI)</option>
              <option value="anthropic">Anthropic Claude</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="ai-m">Model</label>
            <input id="ai-m" type="text" disabled={ro} value={a.model} onChange={(e) => setAi({ ...a, model: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ai-lim">Most AI runs per person per day</label>
            <input id="ai-lim" type="number" disabled={ro} value={a.maxRunsPerUserPerDay} onChange={(e) => setAi({ ...a, maxRunsPerUserPerDay: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="ai-bud">Monthly budget (USD)</label>
            <input id="ai-bud" type="number" disabled={ro} value={a.monthlyBudgetUsd} onChange={(e) => setAi({ ...a, monthlyBudgetUsd: Number(e.target.value) })} />
          </div>
        </div>
        {!ro ? (
          <div>
            <Button onClick={() => put({ ai: { provider: a.provider, model: a.model, maxRunsPerUserPerDay: a.maxRunsPerUserPerDay, monthlyBudgetUsd: a.monthlyBudgetUsd } }, "AI settings saved.")}>Save AI settings</Button>
          </div>
        ) : null}
        {data.ai.provider !== "demo" ? (
          <div className="panel stack">
            <h3 style={{ margin: 0 }}>Data-governance review (required before client information is sent)</h3>
            {data.ai.governance ? (
              <Alert tone="success">Completed by {data.ai.governance.acknowledgedBy} on {formatDateTime(data.ai.governance.acknowledgedAt)}.</Alert>
            ) : (
              <>
                {(
                  [
                    ["dataRetention", "I reviewed how long the provider keeps the firm's data (for example, zero-data-retention terms)."],
                    ["noTrainingOnData", "The provider's commercial terms say it will not train models on the firm's data."],
                    ["contractInPlace", "The firm has a signed agreement / data-processing terms with the provider."],
                    ["securityReviewed", "I reviewed the provider's security controls and the firm is comfortable sending confidential client information."],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="check">
                    <input type="checkbox" disabled={ro} checked={gov[k]} onChange={(e) => setGov({ ...gov, [k]: e.target.checked })} />
                    <span>{label}</span>
                  </label>
                ))}
                <div className="field">
                  <label htmlFor="gov-n">Notes (optional)</label>
                  <input id="gov-n" type="text" disabled={ro} value={gov.notes} onChange={(e) => setGov({ ...gov, notes: e.target.value })} />
                </div>
                {!ro ? (
                  <div>
                    <Button
                      disabled={!(gov.dataRetention && gov.noTrainingOnData && gov.contractInPlace && gov.securityReviewed)}
                      onClick={async () => {
                        setErr(null);
                        try {
                          await api("/api/admin/settings/governance", { body: gov });
                          setFlash("Governance review recorded. The AI provider can now be used.");
                          await reload();
                        } catch (e) {
                          setErr(e as ApiError);
                        }
                      }}
                    >
                      Record the review
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </section>

      <section className="card stack" aria-labelledby="rv-h">
        <h2 id="rv-h">Attorney review</h2>
        <Switch
          label="Allow attorneys to approve their own work (for very small teams)"
          checked={data.review.allowSelfApproval}
          disabled={ro}
          onChange={(v) => put({ review: { allowSelfApproval: v } }, "Review setting saved.")}
        />
        <p className="small muted" style={{ margin: 0 }}>Off by default. Approval by an attorney is always required; this only controls whether that attorney may be the same person who prepared the work.</p>
      </section>

      <section className="card stack" aria-labelledby="rt-h">
        <h2 id="rt-h">Retention</h2>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="rt-w">Keep uploaded working files for (days)</label>
            <input id="rt-w" type="number" disabled={ro} value={r.workingFileDays} onChange={(e) => setRetention({ ...r, workingFileDays: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="rt-t">Keep administrator test runs for (days)</label>
            <input id="rt-t" type="number" disabled={ro} value={r.testRunDays} onChange={(e) => setRetention({ ...r, testRunDays: Number(e.target.value) })} />
          </div>
        </div>
        {!ro ? <div><Button onClick={() => put({ retention: r }, "Retention saved.")}>Save retention</Button></div> : null}
      </section>

      <section className="card stack" aria-labelledby="cl-h">
        <h2 id="cl-h">Clio custom fields</h2>
        <p className="muted" style={{ margin: 0 }}>If your Clio matters keep information in custom fields, type each custom field&apos;s exact name here so it can be filled in automatically.</p>
        <div className="grid-2">
          {MATTER_FIELDS.filter((f) => !["client_name", "matter_number", "matter_description", "practice_area", "responsible_attorney"].includes(f.key)).map((f) => (
            <div key={f.key} className="field">
              <label htmlFor={`fm-${f.key}`}>{f.label}</label>
              <input id={`fm-${f.key}`} type="text" disabled={ro} value={fm[f.key] ?? ""} onChange={(e) => setFieldMap({ ...fm, [f.key]: e.target.value })} />
            </div>
          ))}
        </div>
        {!ro ? <div><Button onClick={() => put({ clio: { fieldMap: Object.fromEntries(Object.entries(fm).filter(([, v]) => v.trim())) } }, "Clio field mapping saved.")}>Save field mapping</Button></div> : null}
      </section>
    </div>
  );
}
