/** Builds the shared block model (Word / PDF / preview) for a work product. */
import type { CalcResult } from "@/lib/calculations";
import { matterFieldLabel } from "@/lib/matter-fields";
import type { SkillConfig, SkillInput } from "@/lib/skill-config";
import type { Block, GenerationResult } from "@/lib/work-types";
import { formatCell, formatAnswer } from "./facts";

export function fillPlaceholders(text: string, values: Record<string, string>) {
  return text.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_, key: string) => values[key]?.trim() || `[MISSING: ${key.replace(/_/g, " ")}]`);
}

type Sections = GenerationResult["sections"];

function tableBlock(input: SkillInput, rows: Record<string, unknown>[], calcs: CalcResult[], cfg: SkillConfig): Block {
  const cols = input.columns ?? [];
  const fixed = cols.filter((c) => ["currency", "number", "date"].includes(c.type)).length;
  const flexible = Math.max(1, cols.length - fixed);
  const flexW = (1 - fixed * 0.2) / flexible;
  const totals = cfg.calculations.filter((c) => c.operation === "sum_column" && c.operands[0]?.kind === "input" && c.operands[0].inputId === input.id);
  const body = rows.map((r) => cols.map((c) => formatCell(c.type, r[c.id])));
  let boldLast = false;
  for (const t of totals) {
    const op = t.operands[0];
    const result = calcs.find((c) => c.id === t.id);
    if (op.kind !== "input" || !result) continue;
    const row = cols.map((c, i) => (c.id === op.column ? result.display || "[MISSING]" : i === 0 ? t.label : ""));
    body.push(row);
    boldLast = true;
  }
  return {
    type: "table",
    columns: cols.map((c) => ({ label: c.label, width: ["currency", "number", "date"].includes(c.type) ? 0.2 : flexW, align: c.type === "currency" || c.type === "number" ? "right" : "left" })),
    rows: body.length ? body : [cols.map((_, i) => (i === 0 ? "[MISSING: no entries]" : ""))],
    boldLastRow: boldLast,
  };
}

function calcBlock(calcs: CalcResult[]): Block | null {
  const shown = calcs.filter((c) => c.showInDocument);
  if (!shown.length) return null;
  return {
    type: "table",
    columns: [
      { label: "Item", width: 0.65 },
      { label: "Amount", width: 0.35, align: "right" },
    ],
    rows: shown.map((c) => [c.label, c.display || "[MISSING]"]),
    boldLastRow: shown.length > 1,
  };
}

export interface ModelInput {
  cfg: SkillConfig;
  values: Record<string, string>;
  answers: Record<string, unknown>;
  visibleInputs: SkillInput[];
  sections: Sections;
  calcs: CalcResult[];
  enclosures: string[];
  todayLong: string;
}

export function buildBlocks(m: ModelInput): Block[] {
  const { cfg, values } = m;
  const blocks: Block[] = [];
  const inputs = new Map(cfg.inputs.map((i) => [i.id, i]));

  if (cfg.output.style === "letter") {
    const letter = cfg.output.letter;
    blocks.push({ type: "paragraph", text: m.todayLong });
    const address = (letter?.recipientInputIds ?? [])
      .map((id) => {
        const inp = inputs.get(id);
        const v = inp ? formatAnswer(inp, m.answers[id]) : "";
        return v || `[MISSING: ${inp?.label ?? id}]`;
      })
      .join("\n");
    if (address) blocks.push({ type: "paragraph", text: address, align: "left" });
    const re = (letter?.reLines ?? []).map(
      (l) =>
        [
          `${l.label}:`,
          l.source.kind === "matter" ? values[l.source.field] || `[MISSING: ${matterFieldLabel(l.source.field)}]` : values[l.source.inputId] || `[MISSING: ${inputs.get(l.source.inputId)?.label ?? l.source.inputId}]`,
        ] as [string, string],
    );
    if (re.length) {
      blocks.push({ type: "paragraph", text: "RE:", bold: true });
      blocks.push({ type: "keyvalue", rows: re });
    }
    blocks.push({ type: "paragraph", text: fillPlaceholders(letter?.salutation ?? "", values) });
  } else {
    blocks.push({ type: "heading", text: cfg.output.documentTitle, level: 1, align: "center" });
    const rows = cfg.matter.showFields.map((f) => [matterFieldLabel(f), values[f] || "—"] as [string, string]);
    if (rows.length) blocks.push({ type: "keyvalue", rows });
  }

  let calcsShown = false;
  for (const s of m.sections) {
    const def = cfg.drafting.sections.find((d) => d.id === s.id);
    if (s.heading) blocks.push({ type: "heading", text: s.heading, level: 2 });
    for (const p of s.paragraphs) blocks.push({ type: "paragraph", text: p.text, refs: p.refs, edited: p.edited });
    for (const tableId of def?.attach?.tables ?? []) {
      const inp = inputs.get(tableId);
      if (!inp || !m.visibleInputs.some((v) => v.id === tableId)) continue;
      const rows = Array.isArray(m.answers[tableId]) ? (m.answers[tableId] as Record<string, unknown>[]) : [];
      blocks.push(tableBlock(inp, rows, m.calcs, cfg));
    }
    if (def?.attach?.calculations) {
      const b = calcBlock(m.calcs);
      if (b) blocks.push(b);
      calcsShown = true;
    }
  }
  if (!calcsShown) {
    const b = calcBlock(m.calcs);
    if (b) blocks.push({ type: "heading", text: "Calculations", level: 2 }, b);
  }

  if (cfg.output.style === "letter") {
    blocks.push({ type: "spacer", height: 6 });
    for (const line of cfg.output.letter?.signatureLines ?? []) {
      if (!line.trim()) blocks.push({ type: "spacer", height: 4 });
      else blocks.push({ type: "paragraph", text: fillPlaceholders(line, values), align: "left" });
    }
    if (cfg.output.letter?.listEnclosures && m.enclosures.length) {
      blocks.push({ type: "spacer", height: 8 }, { type: "paragraph", text: "Enclosures:", bold: true });
      m.enclosures.forEach((e, i) => blocks.push({ type: "paragraph", text: `${i + 1}. ${e}`, indent: 18 }));
    }
  }
  return blocks;
}
