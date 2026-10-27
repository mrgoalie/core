import { describe, expect, it } from "vitest";
import { blankSkillConfig, detectUnsupportedRequests, diffConfigs, SkillConfig, slugify } from "@/lib/skill-config";
import { ARBITRATION_PACKAGE, DEMAND_LETTER } from "@/server/skills/builtin";

describe("skill configuration", () => {
  it("accepts the built-in skills and a blank skill", () => {
    expect(SkillConfig.safeParse(DEMAND_LETTER).success).toBe(true);
    expect(SkillConfig.safeParse(ARBITRATION_PACKAGE).success).toBe(true);
    expect(SkillConfig.safeParse(blankSkillConfig("X")).success).toBe(true);
  });

  it("rejects reserved names, duplicate ids, empty dropdowns and broken calculation references", () => {
    const cfg = blankSkillConfig("X");
    const bad = {
      ...cfg,
      inputs: [
        { id: "client_name", label: "Client", type: "text" },
        { id: "a", label: "A", type: "select", options: [] },
        { id: "a", label: "A again", type: "text" },
      ],
      calculations: [{ id: "t", label: "Total", operation: "add", operands: [{ kind: "input", inputId: "missing" }] }],
    };
    const r = SkillConfig.safeParse(bad);
    expect(r.success).toBe(false);
    const msgs = r.error!.issues.map((i) => i.message).join("\n");
    expect(msgs).toMatch(/reserved name/);
    expect(msgs).toMatch(/at least one choice/);
    expect(msgs).toMatch(/used twice/);
    expect(msgs).toMatch(/doesn't exist/);
  });

  it("cannot express turning off attorney review", () => {
    const r = SkillConfig.safeParse({ ...blankSkillConfig("X"), approval: { reviewerRole: "EMPLOYEE" } });
    expect(r.success).toBe(false);
    const parsed = SkillConfig.parse({ ...blankSkillConfig("X"), approval: { required: false } });
    expect(parsed.approval.reviewerRole).toBe("ATTORNEY_REVIEWER");
    expect("required" in parsed.approval).toBe(false);
  });

  it("classifies changes: names and descriptions are cosmetic, drafting changes are significant", () => {
    const a = SkillConfig.parse(DEMAND_LETTER);
    expect(diffConfigs(a, { ...a, name: "Prepare Insurance Demand", icon: "gavel" }).significance).toBe("cosmetic");
    const b = structuredClone(a);
    b.purpose += " Also mention the weather.";
    expect(diffConfigs(a, b)).toEqual({ changed: ["purpose"], significance: "significant" });
    const c = structuredClone(a);
    c.calculations = [];
    expect(diffConfigs(a, c).significance).toBe("significant");
  });

  it("warns when instructions ask for capabilities the system does not have", () => {
    expect(detectUnsupportedRequests("Email the letter to the adjuster when done")).toHaveLength(1);
    expect(detectUnsupportedRequests("Skip attorney review for small claims").join(" ")).toMatch(/cannot be skipped/);
    expect(detectUnsupportedRequests("File it with the clerk of the court")).toHaveLength(1);
    expect(detectUnsupportedRequests("Summarize the treatment chronologically.")).toHaveLength(0);
  });

  it("creates safe unique identifiers from labels", () => {
    expect(slugify("Settlement Amount ($)")).toBe("settlement_amount");
    expect(slugify("Client name")).toBe("client_name_2");
    expect(slugify("1st lien", ["f_1st_lien"])).toBe("f_1st_lien_2");
  });
});
