import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { extractText } from "@/server/documents/extract";
import { decide, reviewQueue } from "@/server/services/review";
import { downloadGenerated, getWorkView, reorderExhibits, requestAnalysis, requestGeneration, saveAnswers, selectMatter, startWork, submitForReview } from "@/server/services/work";
import { actor, DEMO, freshDb, runJobs, skillId } from "../helpers";
import type { DB } from "@/server/db/client";

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await freshDb()));
afterAll(async () => close());

describe("arbitration package end-to-end (fictional UM matter)", () => {
  let sessionId: string;

  it("assembles an organized, paginated, bookmarked PDF package and reports missing requirements", async () => {
    const maria = await actor(db, DEMO.maria);
    ({ sessionId } = await startWork(db, maria, await skillId(db, "arbitration-package")));
    await saveAnswers(db, maria, sessionId, { arbitration_type: "AAA — Uninsured Motorist (UM)" });
    await selectMatter(db, maria, sessionId, "m-1002");
    let view = await getWorkView(db, maria, sessionId);
    expect(view.applicableRequirementIds).toContain("insurer_notice");
    expect(view.applicableRequirementIds).not.toContain("underlying_settlement");
    // Put the crash report first.
    const crash = view.documents.find((d) => d.fileName.startsWith("Traffic Crash Report"))!;
    await reorderExhibits(db, maria, sessionId, [crash.id, ...view.documents.filter((d) => d.id !== crash.id).map((d) => d.id)]);
    expect((await runJobs(db, (await requestAnalysis(db, maria, sessionId)).jobId))?.status).toBe("succeeded");
    const gen1 = await runJobs(db, (await requestGeneration(db, maria, sessionId)).jobId);
    expect(gen1?.status, gen1?.lastError ?? "").toBe("succeeded");
    view = await getWorkView(db, maria, sessionId);
    const g = view.data.generation!;
    expect(g.exhibitIndex?.[0].description).toMatch(/Traffic Crash Report/);
    expect(g.exhibitIndex?.length).toBe(9);
    const messages = g.issues.map((i) => i.message).join("\n");
    expect(messages).toMatch(/Missing document: Correspondence giving notice/);
    expect(messages).toMatch(/DEMONSTRATION settings/);
    const pkgFile = g.files.find((f) => f.kind === "package")!;
    const pkg = await downloadGenerated(db, maria, sessionId, pkgFile.id);
    const pdf = await PDFDocument.load(pkg.bytes);
    expect(pdf.getPageCount()).toBe(pkgFile.pageCount);
    expect(pdf.catalog.get(PDFName.of("Outlines"))).toBeTruthy();
    const text = (await extractText(pkg.bytes, "pdf")).pages;
    expect(text[1]).toMatch(/EXHIBIT INDEX/);
    expect(text.join("\n")).toMatch(/FLG-000001/);
    const cover = g.files.find((f) => f.kind === "work_product" && f.format === "docx");
    expect(cover).toBeTruthy();
    expect(g.blocks.some((b) => b.type === "paragraph" && /contains 9 exhibits/.test(b.text))).toBe(true);
    expect(g.blocks.some((b) => b.type === "table" && b.rows.some((r) => r[1] === "$8,895.00"))).toBe(true);
  });

  it("goes through attorney approval and produces final, unwatermarked files", async () => {
    const maria = await actor(db, DEMO.maria);
    const rachel = await actor(db, DEMO.rachel);
    const daniel = await actor(db, DEMO.daniel);
    await submitForReview(db, maria, sessionId, {});
    expect((await reviewQueue(db, rachel)).some((q) => q.id === sessionId)).toBe(true);
    await expect(decide(db, maria, sessionId, { decision: "approve" })).rejects.toThrow();
    await expect(getWorkView(db, daniel, sessionId)).rejects.toThrow(); // not his work, not a reviewer
    await decide(db, rachel, sessionId, { decision: "approve", comments: "Approved for the demonstration." });
    const view = await getWorkView(db, maria, sessionId);
    expect(view.session.status).toBe("approved");
    const finals = view.data.generation!.finalFiles!;
    expect(finals.length).toBeGreaterThan(0);
    const pkg = await downloadGenerated(db, maria, sessionId, finals.find((f) => f.kind === "package")!.id);
    const text = (await extractText(pkg.bytes, "pdf")).pages.join("\n");
    expect(text).not.toMatch(/DRAFT/);
    expect(view.history.map((h) => h.action)).toEqual(["approved", "submitted"]);
  });
});
