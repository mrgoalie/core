/**
 * DEMONSTRATION ENGINE — NOT AN AI MODEL.
 *
 * Deterministic, offline stand-in for an AI provider so the complete workflow can be developed,
 * demonstrated and tested without sending data anywhere. Extraction uses fixed text patterns
 * ("Date of Service: …", "TOTAL CHARGES: …"); drafting assembles sentences from supplied facts.
 * Everything it produces is labelled as demonstration output.
 */
import type { DraftInput, DraftOutput, ExtractionInput, ExtractionOutput } from "./prompts";
import type { AiProvider, AiRequest, AiResponse } from "./types";

const LABEL_LINE = /^[A-Z][A-Za-z0-9 /()&-]{1,40}:\s/;
/** PDF text wraps long lines at roughly 75–95 characters; only such lines continue onto the next line. */
const WRAP_WIDTH = 70;

function field(text: string, labels: string[]): { value: string; quote: string } | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const label of labels) {
      const re = new RegExp(`^${label}:\\s*(.+)$`, "i");
      const m = re.exec(lines[i].trim());
      if (!m) continue;
      let value = m[1].trim();
      // Wrapped lines continue the value until the next "Label:" line.
      for (let j = i + 1; j < lines.length && lines[j - 1].trim().length >= WRAP_WIDTH && lines[j].trim() && !LABEL_LINE.test(lines[j].trim()); j++) value += ` ${lines[j].trim()}`;
      return { value, quote: lines[i].trim().slice(0, 200) };
    }
  }
  return null;
}

const DATE = /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/;
const AMOUNT = /\$\s?[\d,]+(?:\.\d{2})?/;

export function demoExtract(input: ExtractionInput): ExtractionOutput {
  const out: ExtractionOutput = { facts: [], treatment: [], bills: [], summary: "" };
  for (const { page, text } of input.pages) {
    const add = (key: ExtractionOutput["facts"][number]["key"], labels: string[], transform?: (v: string) => string | null) => {
      const f = field(text, labels);
      if (!f) return;
      const value = transform ? transform(f.value) : f.value;
      if (value) out.facts.push({ key, value, page, quote: f.quote });
    };
    switch (input.analyzer) {
      case "incident_report":
        add("incident.date", ["Date of Crash", "Date of Incident", "Date of Accident", "Date of Loss"], (v) => DATE.exec(v)?.[1] ?? null);
        add("incident.location", ["Location"]);
        add("incident.narrative", ["Narrative"]);
        add("incident.citations", ["Citations", "Citation"]);
        add("incident.report_number", ["Report Number", "Report No"]);
        break;
      case "medical_records": {
        const provider = field(text, ["Provider"])?.value ?? "";
        const dos = field(text, ["Date of Service", "Date of Visit"]);
        const dx = field(text, ["Diagnosis", "Diagnoses", "Assessment"]);
        const tx = field(text, ["Treatment", "Procedure"]);
        if (dos) out.treatment.push({ provider, dates: dos.value, treatment: tx?.value ?? "", diagnosis: dx?.value ?? "", page, quote: dos.quote });
        if (dx) out.facts.push({ key: "injuries", value: provider ? `${provider}: ${dx.value}` : dx.value, page, quote: dx.quote });
        const rec = field(text, ["Recommendation", "Recommendations", "Future Care"]);
        if (rec) out.facts.push({ key: "future_treatment", value: provider ? `${provider}: ${rec.value}` : rec.value, page, quote: rec.quote });
        break;
      }
      case "medical_bills": {
        const total = field(text, ["TOTAL CHARGES", "Total Charges", "Amount Billed", "Total Billed"]);
        const amount = total ? AMOUNT.exec(total.value)?.[0] : undefined;
        if (total && amount)
          out.bills.push({
            provider: field(text, ["Provider"])?.value ?? "",
            dates: field(text, ["Dates of Service", "Date of Service"])?.value ?? "",
            amount: amount.replace(/\s/g, ""),
            page,
            quote: total.quote,
          });
        break;
      }
      case "wage_loss":
        add("wages.amount", ["Total Lost Wages", "Lost Wages"], (v) => AMOUNT.exec(v)?.[0] ?? null);
        add("wages.employer", ["Employer"]);
        break;
      case "insurance":
        add("insurance.carrier", ["Insurance Company", "Insurer", "Carrier"]);
        add("insurance.policy_number", ["Policy Number", "Policy No"]);
        add("insurance.limits", ["Uninsured Motorist Bodily Injury Limits", "Underinsured Motorist Bodily Injury Limits", "Bodily Injury Limits", "Limits"], (v) => AMOUNT.exec(v)?.[0] ?? null);
        break;
      case "summary": {
        const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !/FICTIONAL TEST DOCUMENT/.test(l));
        if (!out.summary && lines.length) out.summary = `Demonstration summary: ${lines.slice(0, 3).join(" ")}`.slice(0, 600);
        break;
      }
    }
  }
  return out;
}

// --- drafting -----------------------------------------------------------------

type Para = { text: string; factIds: string[] };

function composer(input: DraftInput) {
  const byKey = new Map(input.facts.map((f) => [f.key, f]));
  const gaps: DraftOutput["gaps"] = [];
  const get = (key: string) => byKey.get(key);
  const all = (prefix: string) => input.facts.filter((f) => f.key.startsWith(prefix));
  /** Fills {key} placeholders from facts; missing ones become [MISSING: label]. */
  const fill = (sectionId: string, template: string, labels: Record<string, string> = {}): Para => {
    const ids: string[] = [];
    const text = template.replace(/\{([^}]+)\}/g, (_, key: string) => {
      const f = get(key);
      if (f && f.value.trim()) {
        if (!ids.includes(f.id)) ids.push(f.id);
        return f.value.trim();
      }
      const label = labels[key] ?? key.split(".").pop()!.replace(/_/g, " ");
      gaps.push({ sectionId, description: `Missing: ${label}` });
      return `[MISSING: ${label}]`;
    });
    return { text, factIds: ids };
  };
  return { get, all, fill, gaps };
}

const client = "{matter.client_name}";

export function demoDraft(input: DraftInput): DraftOutput {
  const { get, all, fill, gaps } = composer(input);
  const sections: DraftOutput["sections"] = [];
  for (const s of input.sections) {
    const p: Para[] = [];
    switch (s.id) {
      case "intro":
        p.push(fill(s.id, `This firm represents ${client} regarding injuries sustained in an incident on {input.loss_date} at {input.loss_location}. We write to present ${client}'s claim and to demand settlement. Please direct all further communication about this claim to this office.`, { "input.loss_date": "date of incident", "input.loss_location": "incident location" }));
        break;
      case "incident":
        p.push(fill(s.id, "{input.incident_description}", { "input.incident_description": "description of what happened" }));
        break;
      case "liability":
        p.push(fill(s.id, "{input.liability_summary}", { "input.liability_summary": "liability summary" }));
        break;
      case "injuries": {
        const injuries = get("input.injuries_description");
        if (injuries) p.push({ text: `${injuries.value}`, factIds: [injuries.id] });
        else p.push(fill(s.id, "{input.injuries_description}", { "input.injuries_description": "documented injuries" }));
        const rows = all("input.treatment.row");
        if (rows.length) {
          p.push({ text: `${get("matter.client_name")?.value ?? "Our client"} received the following treatment, as documented in the medical records:`, factIds: [] });
          for (const r of rows) p.push({ text: r.value, factIds: [r.id] });
        } else {
          gaps.push({ sectionId: s.id, description: "No treatment entries were provided." });
          p.push({ text: "[MISSING: treatment chronology]", factIds: [] });
        }
        break;
      }
      case "future_care": {
        const f = get("input.future_treatment");
        if (f?.value.trim()) p.push({ text: `The medical records reflect the following recommendation for future care: ${f.value.trim()}`, factIds: [f.id] });
        else p.push({ text: "No future treatment is claimed at this time.", factIds: [] });
        break;
      }
      case "damages": {
        const parts: Para[] = [];
        const med = get("calc.medical_specials");
        const wages = get("calc.lost_wages_total") ?? get("input.lost_wages");
        const total = get("calc.total_specials");
        if (med) parts.push({ text: `Medical expenses incurred to date total ${med.value}, as itemized in the table of damages.`, factIds: [med.id] });
        else parts.push(fill(s.id, "Medical expenses: {calc.medical_specials}.", { "calc.medical_specials": "medical expense total" }));
        if (wages) parts.push({ text: `Lost wages total ${wages.value}.`, factIds: [wages.id] });
        if (total) parts.push({ text: `Total economic damages documented to date are ${total.value}.`, factIds: [total.id] });
        p.push(...parts);
        break;
      }
      case "non_economic":
        p.push(fill(s.id, "{input.non_economic}", { "input.non_economic": "description of non-economic damages" }));
        break;
      case "demand": {
        const amount = get("calc.demand_total") ?? get("input.demand_amount");
        const days = get("input.response_days");
        const ids = [amount?.id, days?.id].filter(Boolean) as string[];
        if (!amount) gaps.push({ sectionId: s.id, description: "Missing: demand amount (to be provided or approved by the attorney)" });
        p.push({
          text: `${get("matter.client_name")?.value ?? "Our client"} demands ${amount?.value ?? "[MISSING: demand amount — attorney to provide]"} in full settlement of this claim. Please respond in writing within ${days?.value ?? "30"} days of the date of this letter.`,
          factIds: ids,
        });
        break;
      }
      case "closing":
        p.push({ text: "Thank you for your prompt attention to this matter. Please contact our office with any questions.", factIds: [] });
        break;
      default: {
        p.push({ text: `[Demonstration draft of “${s.heading || s.id}”. With an AI provider enabled, this section would be written from the instructions: “${s.instructions.slice(0, 300)}”]`, factIds: [] });
        const provided = input.facts.filter((f) => f.key.startsWith("input.") || f.key.startsWith("calc."));
        if (provided.length) p.push({ text: `Information provided: ${provided.map((f) => `${f.label}: ${f.value}`).join("; ")}.`, factIds: provided.map((f) => f.id) });
      }
    }
    sections.push({ id: s.id, paragraphs: p });
  }
  return { sections, gaps };
}

export class DemoProvider implements AiProvider {
  readonly id = "demo" as const;
  readonly label = "Demonstration engine (no AI — fixed rules, offline)";
  readonly isDemonstration = true;

  async generate<T>(req: AiRequest<T>): Promise<AiResponse<T>> {
    const data = req.task === "extract_document" ? demoExtract(req.input as ExtractionInput) : demoDraft(req.input as DraftInput);
    return { data: req.schema.parse(data), model: "demonstration-rules-v1", inputTokens: 0, outputTokens: 0 };
  }
}
