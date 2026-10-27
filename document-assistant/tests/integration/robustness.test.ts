import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { aiExecutions, auditLogs, jobs } from "@/server/db/schema";
import { textPagesToPdf } from "@/server/documents/pdf-compose";
import { setAiProviderForTesting } from "@/server/integrations/ai/service";
import { AiError, type AiProvider } from "@/server/integrations/ai/types";
import { recoverStaleJobs } from "@/server/jobs/queue";
import { getWorkView, requestAnalysis, requestGeneration, saveAnswers, saveSectionEdits, selectMatter, startWork, submitForReview, uploadDocument, requestRerender } from "@/server/services/work";
import { actor, DEMO, freshDb, runJobs, skillId } from "../helpers";

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await freshDb()));
afterAll(async () => close());
afterEach(() => setAiProviderForTesting(null));

async function preparedSession() {
  const maria = await actor(db, DEMO.maria);
  const { sessionId } = await startWork(db, maria, await skillId(db, "demand-letter"));
  await selectMatter(db, maria, sessionId, "m-1001");
  return { maria, sessionId };
}

describe("AI errors", () => {
  it("retries a temporary failure a limited number of times, then reports a plain-English error", async () => {
    let calls = 0;
    const flaky: AiProvider = {
      id: "anthropic",
      label: "Test provider",
      isDemonstration: false,
      async generate() {
        calls++;
        throw new AiError("unavailable", "The AI service could not be reached.", true);
      },
    };
    setAiProviderForTesting(flaky);
    const { maria, sessionId } = await preparedSession();
    const job = await runJobs(db, (await requestAnalysis(db, maria, sessionId)).jobId);
    expect(job?.status).toBe("failed");
    expect(job?.lastError).toBe("The AI service could not be reached.");
    expect(calls).toBe(4); // 2 attempts inside the AI service × 2 job attempts
    const logged = await db.select().from(aiExecutions).where(eq(aiExecutions.workSessionId, sessionId));
    expect(logged.every((l) => l.status === "error" && l.errorCode === "unavailable")).toBe(true);
  });

  it("does not retry a refusal, and keeps the employee's work intact", async () => {
    let calls = 0;
    setAiProviderForTesting({ id: "anthropic", label: "x", isDemonstration: false, async generate() { calls++; throw new AiError("refused", "The AI service declined this request."); } });
    const { maria, sessionId } = await preparedSession();
    await saveAnswers(db, maria, sessionId, { liability_summary: "Rear-ended while stopped." });
    const job = await runJobs(db, (await requestGeneration(db, maria, sessionId)).jobId);
    expect(job?.status).toBe("failed");
    expect(calls).toBe(1);
    const view = await getWorkView(db, maria, sessionId);
    expect(view.data.answers.liability_summary).toBe("Rear-ended while stopped.");
    expect(view.session.status).toBe("in_progress");
  });

  it("rejects AI output that doesn't match the expected structure", async () => {
    setAiProviderForTesting({ id: "anthropic", label: "x", isDemonstration: false, async generate() { return { data: { nonsense: true } as never, model: "m", inputTokens: 1, outputTokens: 1 }; } });
    const { maria, sessionId } = await preparedSession();
    const job = await runJobs(db, (await requestAnalysis(db, maria, sessionId)).jobId);
    expect(job?.status).toBe("failed");
    const logged = await db.select().from(aiExecutions).where(eq(aiExecutions.workSessionId, sessionId));
    expect(logged.some((l) => l.status === "invalid_output")).toBe(true);
  });

  it("flags invented amounts, dates and legal citations in AI-drafted text", async () => {
    const { maria, sessionId } = await preparedSession();
    expect((await runJobs(db, (await requestAnalysis(db, maria, sessionId)).jobId))?.status).toBe("succeeded");
    setAiProviderForTesting({
      id: "anthropic",
      label: "Test provider",
      isDemonstration: false,
      async generate(req) {
        const input = req.input as { sections: { id: string }[] };
        return {
          data: {
            sections: input.sections.map((s) => ({ id: s.id, paragraphs: [{ text: s.id === "damages" ? "Damages exceed $250,000.00 under Smith v. Jones, 123 Ill. App. 3d 456, as of June 1, 2025." : "Text.", factIds: ["F1", "F999"] }] })),
            gaps: [],
          } as never,
          model: "test",
          inputTokens: 10,
          outputTokens: 10,
        };
      },
    });
    const job = await runJobs(db, (await requestGeneration(db, maria, sessionId)).jobId);
    expect(job?.status, job?.lastError ?? "").toBe("succeeded");
    const issues = (await getWorkView(db, maria, sessionId)).data.generation!.issues.map((i) => `${i.kind}: ${i.message}`).join("\n");
    expect(issues).toMatch(/unsupported_assertion: .*\$250,000\.00/);
    expect(issues).toMatch(/unsupported_assertion: .*June 1, 2025/);
    expect(issues).toMatch(/legal_authority: .*Smith v\. Jones/);
  });
});

describe("interrupted work and autosave", () => {
  it("recovers a job that was interrupted mid-way", async () => {
    const { maria, sessionId } = await preparedSession();
    const { jobId } = await requestAnalysis(db, maria, sessionId);
    await db.update(jobs).set({ status: "running", lockedAt: new Date(Date.now() - 60 * 60_000), attempts: 1 }).where(eq(jobs.id, jobId));
    expect(await recoverStaleJobs(db)).toBe(1);
    const job = await runJobs(db, jobId);
    expect(job?.status).toBe("succeeded");
  });

  it("autosaves answers, and marks values changed from a record so the attorney can see it", async () => {
    const { maria, sessionId } = await preparedSession();
    await runJobs(db, (await requestAnalysis(db, maria, sessionId)).jobId);
    await saveAnswers(db, maria, sessionId, { loss_date: "2025-03-13", non_economic: "Trouble sleeping." });
    const view = await getWorkView(db, maria, sessionId);
    expect(view.data.provenance.loss_date).toMatchObject({ kind: "edited", from: "document", page: 1 });
    expect(view.data.provenance.non_economic).toEqual({ kind: "employee" });
    await runJobs(db, (await requestGeneration(db, maria, sessionId)).jobId);
    const issues = (await getWorkView(db, maria, sessionId)).data.generation!.issues.map((i) => i.message).join("\n");
    expect(issues).toMatch(/"Date of the incident" was changed by staff/);
  });

  it("lets staff edit wording without re-running AI, and requires an update before submitting", async () => {
    const { maria, sessionId } = await preparedSession();
    await runJobs(db, (await requestGeneration(db, maria, sessionId)).jobId);
    await saveSectionEdits(db, maria, sessionId, { closing: "Thank you. Please call us." });
    await expect(submitForReview(db, maria, sessionId, {})).rejects.toThrow(/Update the draft/);
    expect((await runJobs(db, (await requestRerender(db, maria, sessionId)).jobId))?.status).toBe("succeeded");
    const gen = (await getWorkView(db, maria, sessionId)).data.generation!;
    expect(gen.blocks.some((b) => b.type === "paragraph" && b.text === "Thank you. Please call us." && b.edited)).toBe(true);
    await submitForReview(db, maria, sessionId, {});
  });
});

describe("uploads", () => {
  it("accepts a clean PDF, reads it, and uses it", async () => {
    const { maria, sessionId } = await preparedSession();
    const pdf = Buffer.from(await textPagesToPdf(["Provider: Midwest Orthopedic Partners\nDates of Service: 06/02/2025\nTOTAL CHARGES: $1,980.00"]));
    await uploadDocument(db, maria, sessionId, { name: "Ortho bill.pdf", bytes: pdf }, "medical_bills");
    await runJobs(db, (await requestAnalysis(db, maria, sessionId)).jobId);
    const view = await getWorkView(db, maria, sessionId);
    const bills = view.data.answers.medical_bills as { provider: string; amount: string }[];
    expect(bills.find((b) => b.provider === "Midwest Orthopedic Partners")?.amount).toBe("1980.00");
    await runJobs(db, (await requestGeneration(db, maria, sessionId)).jobId);
    const issues = (await getWorkView(db, maria, sessionId)).data.generation!.issues.map((i) => i.message).join("\n");
    expect(issues).not.toMatch(/no bill from Midwest Orthopedic/);
  });

  it("rejects an unsafe file and records the rejection", async () => {
    const { maria, sessionId } = await preparedSession();
    const bad = Buffer.from("%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (x) >> >>\n%%EOF");
    await expect(uploadDocument(db, maria, sessionId, { name: "invoice.pdf", bytes: bad }, null)).rejects.toThrow(/active content/);
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "upload.rejected"));
    expect(rows.length).toBe(1);
  });
});
