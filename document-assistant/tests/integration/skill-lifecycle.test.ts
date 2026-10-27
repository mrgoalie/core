import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { auditLogs, workSessions } from "@/server/db/schema";
import { approveVersion, createSkill, employeeSkills, getSkillDetail, publishVersion, recordTestResult, restoreVersion, saveDraft, setPermission, setSkillEnabled } from "@/server/services/skills";
import { getWorkView, requestGeneration, saveAnswers, searchMattersFor, selectMatter, startWork } from "@/server/services/work";
import type { SkillConfigInput } from "@/lib/skill-config";
import { actor, DEMO, freshDb, runJobs } from "../helpers";

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await freshDb()));
afterAll(async () => close());

export const SETTLEMENT_SKILL: SkillConfigInput = {
  name: "Prepare Settlement Disbursement",
  shortDescription: "Prepare a settlement breakdown showing fees, costs, liens, and client proceeds.",
  employeeInstructions: "Enter the settlement figures exactly as approved by the attorney.",
  purpose:
    "Use the settlement amount, contractual attorney fee, approved case expenses, and verified liens to prepare a settlement disbursement statement. Calculate the client's net proceeds and flag missing information.",
  icon: "calculator",
  category: "Personal Injury",
  matter: { showFields: ["client_name", "matter_number", "insurance_carrier"] },
  inputs: [
    { id: "settlement_amount", label: "Settlement amount", type: "currency", required: true },
    { id: "fee_percent", label: "Attorney fee (percent)", type: "number", required: true, defaultValue: "33.33" },
    { id: "case_expenses", label: "Case expenses", type: "table", required: false, columns: [{ id: "description", label: "Description", type: "text", required: true }, { id: "amount", label: "Amount", type: "currency", required: true }] },
    { id: "liens", label: "Liens", type: "table", required: false, columns: [{ id: "holder", label: "Lienholder", type: "text", required: true }, { id: "amount", label: "Amount", type: "currency", required: true }] },
  ],
  documents: [],
  calculations: [
    { id: "attorney_fee", label: "Attorney fee", operation: "percent_of", operands: [{ kind: "input", inputId: "settlement_amount" }, { kind: "input", inputId: "fee_percent" }], format: "currency", showInDocument: true },
    { id: "expenses_total", label: "Case expenses", operation: "sum_column", operands: [{ kind: "input", inputId: "case_expenses", column: "amount", blankAsZero: true }], format: "currency", showInDocument: true },
    { id: "liens_total", label: "Liens", operation: "sum_column", operands: [{ kind: "input", inputId: "liens", column: "amount", blankAsZero: true }], format: "currency", showInDocument: true },
    {
      id: "net_to_client",
      label: "Net to client",
      operation: "subtract",
      operands: [{ kind: "input", inputId: "settlement_amount" }, { kind: "calc", calcId: "attorney_fee" }, { kind: "calc", calcId: "expenses_total" }, { kind: "calc", calcId: "liens_total" }],
      format: "currency",
      showInDocument: true,
    },
  ],
  drafting: {
    tone: "Clear and factual.",
    sections: [{ id: "summary", heading: "Summary", mode: "ai", instructions: "Summarize the disbursement using the calculated figures.", attach: { tables: ["case_expenses", "liens"], calculations: true } }],
  },
  output: { style: "report", formats: ["docx", "pdf"], documentTitle: "Settlement Disbursement Statement", templateId: null },
  approval: { reviewerRole: "ATTORNEY_REVIEWER" },
};

describe("Skill Builder lifecycle: create → test → approve → publish → grant → edit → restore", () => {
  let skillId: string;
  let v1: string;

  it("only firm administrators can create skills, and new skills are available to nobody", async () => {
    const daniel = await actor(db, DEMO.daniel);
    await expect(createSkill(db, daniel, SETTLEMENT_SKILL)).rejects.toThrow();
    const jordan = await actor(db, DEMO.jordan);
    const r = await createSkill(db, jordan, SETTLEMENT_SKILL);
    skillId = r.skillId;
    v1 = r.versionId;
    expect((await employeeSkills(db, daniel)).some((s) => s.id === skillId)).toBe(false);
    expect((await employeeSkills(db, jordan)).some((s) => s.id === skillId)).toBe(false);
  });

  it("will not publish a drafting change until it has been tested and approved by an attorney", async () => {
    const jordan = await actor(db, DEMO.jordan);
    await expect(publishVersion(db, jordan, v1)).rejects.toThrow(/test run/);
    await expect(recordTestResult(db, jordan, v1, true, "")).rejects.toThrow(/Run a test/);
  });

  it("test runs only ever see the fictional sample matter and produce a correct document", async () => {
    const jordan = await actor(db, DEMO.jordan);
    const { sessionId } = await startWork(db, jordan, skillId, { testVersionId: v1 });
    const matters = await searchMattersFor(db, jordan, sessionId, "");
    expect(matters.map((m) => m.displayNumber)).toEqual(["TEST-0001"]);
    await expect(selectMatter(db, jordan, sessionId, "m-1001")).rejects.toThrow(/wasn't found/);
    await selectMatter(db, jordan, sessionId, "m-9001");
    await saveAnswers(db, jordan, sessionId, {
      settlement_amount: "100000",
      case_expenses: [{ description: "Filing fee", amount: "349.50" }, { description: "Records", amount: "1,250.50" }],
      liens: [{ holder: "Example Health Plan", amount: "12000" }],
    });
    const job = await runJobs(db, (await requestGeneration(db, jordan, sessionId)).jobId);
    expect(job?.status, job?.lastError ?? "").toBe("succeeded");
    const view = await getWorkView(db, jordan, sessionId);
    const calc = view.data.generation!.blocks.find((b) => b.type === "table" && b.rows.some((r) => r[0] === "Net to client"));
    expect(calc && calc.type === "table" ? calc.rows : []).toEqual([
      ["Attorney fee", "$33,330.00"],
      ["Case expenses", "$1,600.00"],
      ["Liens", "$12,000.00"],
      ["Net to client", "$53,070.00"],
    ]);
    expect(view.data.generation!.files.map((f) => f.format).sort()).toEqual(["docx", "pdf"]);
  });

  it("records the test, requires an attorney to approve, then publishes", async () => {
    const jordan = await actor(db, DEMO.jordan);
    const maria = await actor(db, DEMO.maria);
    const taylor = await actor(db, DEMO.taylor);
    await recordTestResult(db, jordan, v1, true, "Figures verified by hand.");
    await expect(approveVersion(db, maria, v1, "")).rejects.toThrow(/attorney/);
    await expect(approveVersion(db, taylor, v1, "")).rejects.toThrow();
    await approveVersion(db, jordan, v1, "Reviewed the language and math.");
    await publishVersion(db, jordan, v1);
    const detail = await getSkillDetail(db, skillId);
    expect(detail.versions[0].status).toBe("published");
  });

  it("grants access to one employee only", async () => {
    const jordan = await actor(db, DEMO.jordan);
    const daniel = await actor(db, DEMO.daniel);
    const chris = await actor(db, DEMO.chris);
    await setPermission(db, jordan, daniel.id, skillId, true);
    expect((await employeeSkills(db, daniel)).map((s) => s.name)).toContain("Prepare Settlement Disbursement");
    expect((await employeeSkills(db, chris)).map((s) => s.name)).not.toContain("Prepare Settlement Disbursement");
    await expect(startWork(db, chris, skillId)).rejects.toThrow(/isn't available/);
  });

  let danielSession: string;
  it("keeps existing work on the version it started with while a new version is drafted and published", async () => {
    const jordan = await actor(db, DEMO.jordan);
    const daniel = await actor(db, DEMO.daniel);
    ({ sessionId: danielSession } = await startWork(db, daniel, skillId));
    const edited = structuredClone(SETTLEMENT_SKILL);
    edited.purpose += " Also list each lien separately.";
    const r = await saveDraft(db, jordan, skillId, edited, "Clarified lien wording");
    expect(r.significance).toBe("significant");
    // Published v1 is still what employees get.
    expect((await employeeSkills(db, daniel)).find((s) => s.id === skillId)?.versionId).toBe(v1);
    await expect(publishVersion(db, jordan, r.versionId)).rejects.toThrow();
    const { sessionId } = await startWork(db, jordan, skillId, { testVersionId: r.versionId });
    await selectMatter(db, jordan, sessionId, "m-9001");
    await saveAnswers(db, jordan, sessionId, { settlement_amount: "50000" });
    expect((await runJobs(db, (await requestGeneration(db, jordan, sessionId)).jobId))?.status).toBe("succeeded");
    await recordTestResult(db, jordan, r.versionId, true, "");
    await approveVersion(db, jordan, r.versionId, "");
    await publishVersion(db, jordan, r.versionId);
    expect((await employeeSkills(db, daniel)).find((s) => s.id === skillId)?.versionId).toBe(r.versionId);
    const [pinned] = await db.select().from(workSessions).where(eq(workSessions.id, danielSession));
    expect(pinned.skillVersionId).toBe(v1);
  });

  it("publishes cosmetic changes without a new test, and restores an earlier version", async () => {
    const jordan = await actor(db, DEMO.jordan);
    const detail = await getSkillDetail(db, skillId);
    const current = detail.versions.find((v) => v.status === "published")!;
    const renamed = { ...current.config, name: "Settlement Disbursement Statement" };
    const r = await saveDraft(db, jordan, skillId, renamed, "Renamed");
    expect(r.significance).toBe("cosmetic");
    await publishVersion(db, jordan, r.versionId);
    const restored = await restoreVersion(db, jordan, v1);
    const after = await getSkillDetail(db, skillId);
    const live = after.versions.find((v) => v.status === "published")!;
    expect(live.number).toBe(restored.versionNumber);
    expect(live.config.purpose).toBe(SETTLEMENT_SKILL.purpose);
    expect(live.restoredFrom).toBe(1);
  });

  it("can switch a single skill off immediately", async () => {
    const jordan = await actor(db, DEMO.jordan);
    const daniel = await actor(db, DEMO.daniel);
    await setSkillEnabled(db, jordan, skillId, false);
    expect((await employeeSkills(db, daniel)).some((s) => s.id === skillId)).toBe(false);
    await expect(requestGeneration(db, daniel, danielSession)).rejects.toThrow(/turned off/);
    await setSkillEnabled(db, jordan, skillId, true);
  });

  it("records every step in the activity log", async () => {
    const actions = (await db.select({ a: auditLogs.action }).from(auditLogs)).map((r) => r.a);
    for (const a of ["skill.created", "skill.test_started", "skill.test_recorded", "skill.approved", "skill.published", "permission.granted", "skill.draft_saved", "skill.restored", "skill.disabled", "skill.access_denied"])
      expect(actions, a).toContain(a);
  });
});
