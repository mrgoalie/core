import { describe, expect, it } from "vitest";
import { formatCurrency, parseAmount, runCalculations } from "@/lib/calculations";
import { SkillConfig } from "@/lib/skill-config";
import { DEMAND_LETTER } from "@/server/skills/builtin";

const base = (calcs: unknown[], inputs: unknown[]) =>
  SkillConfig.parse({
    name: "T",
    shortDescription: "t",
    purpose: "t",
    matter: {},
    drafting: { sections: [] },
    inputs,
    calculations: calcs,
    output: { formats: ["docx"] },
    approval: {},
  });

describe("deterministic calculations", () => {
  it("parses money safely", () => {
    expect(parseAmount("$1,234.56")?.toFixed(2)).toBe("1234.56");
    expect(parseAmount("(250.00)")?.toFixed(2)).toBe("-250.00");
    expect(parseAmount("12abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(formatCurrency("1234567.5")).toBe("$1,234,567.50");
  });

  it("avoids floating point error and rounds half-up to the cent", () => {
    const cfg = base(
      [{ id: "total", label: "Total", operation: "add", operands: [{ kind: "input", inputId: "a" }, { kind: "input", inputId: "b" }] }],
      [{ id: "a", label: "A", type: "currency" }, { id: "b", label: "B", type: "currency" }],
    );
    expect(runCalculations(cfg, { a: "0.10", b: "0.20" })[0].value).toBe("0.30");
    const pct = base(
      [{ id: "fee", label: "Fee", operation: "percent_of", operands: [{ kind: "input", inputId: "a" }, { kind: "constant", value: "100" }] }],
      [{ id: "a", label: "A", type: "currency" }],
    );
    // 1.005 is exactly half a cent above 1.00 → 1.01. Floating point stores 1.00499999… and rounds down.
    expect((1.005).toFixed(2)).toBe("1.00");
    expect(runCalculations(pct, { a: "1.005" })[0].value).toBe("1.01");
  });

  it("computes a settlement disbursement exactly", () => {
    const cfg = base(
      [
        { id: "fee", label: "Attorney fee", operation: "percent_of", operands: [{ kind: "input", inputId: "gross" }, { kind: "input", inputId: "pct" }] },
        { id: "exp", label: "Expenses", operation: "sum_column", operands: [{ kind: "input", inputId: "expenses", column: "amount", blankAsZero: true }] },
        { id: "net", label: "Net", operation: "subtract", operands: [{ kind: "input", inputId: "gross" }, { kind: "calc", calcId: "fee" }, { kind: "calc", calcId: "exp" }] },
      ],
      [
        { id: "gross", label: "Gross", type: "currency" },
        { id: "pct", label: "Pct", type: "number" },
        { id: "expenses", label: "Expenses", type: "table", columns: [{ id: "amount", label: "Amount", type: "currency" }] },
      ],
    );
    const r = runCalculations(cfg, { gross: "100000", pct: "33.33", expenses: [{ amount: "1,250.50" }, { amount: "349.50" }] });
    expect(r.map((x) => x.display)).toEqual(["$33,330.00", "$1,600.00", "$65,070.00"]);
    const empty = runCalculations(cfg, { gross: "100000", pct: "33.33", expenses: [] });
    expect(empty[1].value).toBe("0.00");
  });

  it("reports what is missing instead of guessing", () => {
    const cfg = SkillConfig.parse(DEMAND_LETTER);
    const r = runCalculations(cfg, {});
    expect(r.find((c) => c.id === "medical_specials")?.value).toBeNull();
    expect(r.find((c) => c.id === "medical_specials")?.missing).toEqual(["Medical bills"]);
    expect(r.find((c) => c.id === "lost_wages_total")?.value).toBe("0.00"); // optional, blank counts as zero
  });

  it("flags unreadable entries and division by zero", () => {
    const cfg = base(
      [
        { id: "t", label: "T", operation: "sum_column", operands: [{ kind: "input", inputId: "rows", column: "amount" }] },
        { id: "d", label: "D", operation: "divide", operands: [{ kind: "constant", value: "10" }, { kind: "constant", value: "0" }] },
      ],
      [{ id: "rows", label: "Rows", type: "table", columns: [{ id: "amount", label: "Amount", type: "currency" }] }],
    );
    const r = runCalculations(cfg, { rows: [{ amount: "ten dollars" }] });
    expect(r[0].error).toMatch(/could not be read/);
    expect(r[1].error).toMatch(/divide by zero/);
  });
});
