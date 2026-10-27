import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractText } from "@/server/documents/extract";
import { getWorkView, downloadGenerated, requestAnalysis, requestGeneration, saveAnswers, searchMattersFor, selectMatter, startWork, submitForReview } from "@/server/services/work";
import { actor, DEMO, freshDb, runJobs, skillId } from "../helpers";
import type { DB } from "@/server/db/client";

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await freshDb()));
afterAll(async () => close());

describe("demand letter end-to-end (fictional matter)", () => {
  let sessionId: string;

  it("lets an employee start the skill and only see matters she may access", async () => {
    const maria = await actor(db, DEMO.maria);
    ({ sessionId } = await startWork(db, maria, await skillId(db, "demand-letter")));
    const matters = await searchMattersFor(db, maria, sessionId, "");
    expect(matters.map((m) => m.displayNumber).sort()).toEqual(["2024-0388", "2025-0142", "2025-0217"]);
    expect(matters.some((m) => m.description.includes("Hartley"))).toBe(false);
  });

  it("pre-fills from the case file and pre-selects matching documents", async () => {
    const maria = await actor(db, DEMO.maria);
    await selectMatter(db, maria, sessionId, "m-1001");
    const view = await getWorkView(db, maria, sessionId);
    expect(view.data.answers.recipient_name).toBe("Mark Delaney");
    expect(view.data.provenance.recipient_name).toEqual({ kind: "matter", field: "adjuster_name" });
    expect(view.documents.filter((d) => d.selected).length).toBe(8);
  });

  it("reads documents, verifies extracted values against the page text, and fills questions", async () => {
    const maria = await actor(db, DEMO.maria);
    const { jobId } = await requestAnalysis(db, maria, sessionId);
    const job = await runJobs(db, jobId);
    expect(job?.status).toBe("succeeded");
    const view = await getWorkView(db, maria, sessionId);
    expect(view.data.answers.loss_date).toBe("2025-03-14");
    const prov = view.data.provenance.loss_date;
    expect(prov.kind === "document" && prov.verified && prov.page === 1).toBe(true);
    const bills = view.data.answers.medical_bills as { amount: string }[];
    expect(bills.map((b) => b.amount).sort()).toEqual(["1275.00", "4960.00", "6842.00"]);
    expect(view.data.answers.lost_wages).toBe("2772.00");
  });

  it("generates Word and PDF drafts, calculates exactly, and flags missing evidence and conflicts", async () => {
    const maria = await actor(db, DEMO.maria);
    await saveAnswers(db, maria, sessionId, {
      liability_summary: "The other driver was cited for failure to reduce speed and admitted looking at his navigation device.",
      non_economic: "Ms. Thompson reports ongoing neck stiffness that interrupts her sleep and limits her ability to work full shifts.",
    });
    const { jobId } = await requestGeneration(db, maria, sessionId);
    const job = await runJobs(db, jobId);
    expect(job?.status, job?.lastError ?? "").toBe("succeeded");
    const view = await getWorkView(db, maria, sessionId);
    const gen = view.data.generation!;
    const messages = gen.issues.map((i) => i.message).join("\n");
    expect(messages).toMatch(/Missing: Demand amount/);
    expect(messages).toMatch(/Midwest Orthopedic Partners/); // treatment without a bill
    expect(messages).toMatch(/case file \(Clio\) says the date of incident is March 15, 2025/);
    const calc = gen.blocks.find((b) => b.type === "table" && b.rows.some((r) => r[0] === "Total economic damages"));
    expect(calc && calc.type === "table" && calc.rows.find((r) => r[0] === "Total economic damages")?.[1]).toBe("$15,849.00");
    const docx = gen.files.find((f) => f.format === "docx")!;
    const pdf = gen.files.find((f) => f.format === "pdf")!;
    expect(docx && pdf).toBeTruthy();
    const file = await downloadGenerated(db, maria, sessionId, pdf.id);
    const text = (await extractText(file.bytes, "pdf")).pages.join("\n");
    expect(text).toContain("DRAFT");
    expect(text).toContain("Mark Delaney");
    expect(text).toContain("$13,077.00");
    expect(gen.sources.some((s) => s.verification === "verified_in_document" && s.page === 1)).toBe(true);
  });

  it("submits the draft for attorney review", async () => {
    const maria = await actor(db, DEMO.maria);
    const rachel = await actor(db, DEMO.rachel);
    await submitForReview(db, maria, sessionId, { reviewerId: rachel.id, note: "Demand amount still needed from Jordan." });
    const view = await getWorkView(db, maria, sessionId);
    expect(view.session.status).toBe("submitted");
  });
});
