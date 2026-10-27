/**
 * "Check documents": reads the selected documents, extracts facts with page references, verifies
 * every extracted value against the page text, and pre-fills questions.
 */
import { eq } from "drizzle-orm";
import type { AnalysisResult, DocumentNote, ExtractedItem } from "@/lib/work-types";
import type { DB } from "../db/client";
import { sessionDocuments } from "../db/schema";
import { detectKind, kindFromMime } from "../documents/intake";
import { extractText } from "../documents/extract";
import { EXTRACTION_PROMPT_VERSION, ExtractionOutput, extractionPrompt, extractionSystemPrompt } from "../integrations/ai/prompts";
import { runAiTask } from "../integrations/ai/service";
import { setJobProgress } from "../jobs/queue";
import { getStorage, newStorageKey } from "../storage";
import { quoteOnPage, valueSupportedByQuote } from "./checks";
import { fetchDocumentBytes, loadMatterForOwner, loadWorkContext, saveSessionData, type SessionDocumentRow, type WorkContext } from "./context";
import { applyPrefill } from "./prefill";
import { assertWorkCanRun } from "./guards";

export async function readDocumentPages(db: DB, ctx: WorkContext, doc: SessionDocumentRow): Promise<{ pages: string[]; note?: string; bytes?: Buffer }> {
  if (doc.extractTextKey && doc.extractStatus === "done") {
    return { pages: JSON.parse(await getStorage().getText(doc.extractTextKey)) as string[] };
  }
  const bytes = await fetchDocumentBytes(db, ctx, doc);
  const kind = detectKind(bytes, doc.fileName) ?? kindFromMime(doc.mimeType);
  if (!kind) {
    await db.update(sessionDocuments).set({ extractStatus: "failed", extractError: "Unsupported file type" }).where(eq(sessionDocuments.id, doc.id));
    return { pages: [], note: "This file type can't be read.", bytes };
  }
  const result = await extractText(bytes, kind);
  const key = newStorageKey(`sessions/${ctx.session.id}/text`, "json");
  await getStorage().put(key, JSON.stringify(result.pages));
  await db
    .update(sessionDocuments)
    .set({ extractStatus: result.method === "none" ? "no_text" : "done", extractTextKey: key, pageCount: result.pageCount, extractError: result.note ?? null })
    .where(eq(sessionDocuments.id, doc.id));
  return { pages: result.pages, note: result.note, bytes };
}

export async function analyzeSession(db: DB, sessionId: string, jobId?: string) {
  const ctx = await loadWorkContext(db, sessionId);
  await assertWorkCanRun(db, ctx);
  const matter = await loadMatterForOwner(ctx);
  const reqs = new Map(ctx.config.documents.map((r) => [r.id, r]));
  const selected = ctx.docs.filter((d) => d.selected);

  const extracted: Record<string, ExtractedItem[]> = {};
  const notes: DocumentNote[] = [];
  const summaries: AnalysisResult["summaries"] = [];
  let providerLabel = "";
  let isDemonstration = true;

  for (const [i, doc] of selected.entries()) {
    if (jobId) await setJobProgress(db, jobId, `Reading ${doc.fileName} (${i + 1} of ${selected.length})`);
    const analyzer = reqs.get(doc.requirementId ?? "")?.analyzer ?? "none";
    let pages: string[];
    let note: string | undefined;
    try {
      ({ pages, note } = await readDocumentPages(db, ctx, doc));
    } catch {
      notes.push({ docId: doc.id, fileName: doc.fileName, status: "failed", note: "This document could not be opened." });
      continue;
    }
    if (!pages.some((p) => p.trim())) {
      notes.push({ docId: doc.id, fileName: doc.fileName, status: "no_text", note: note ?? "No readable text was found. Please review this document yourself." });
      continue;
    }
    if (analyzer === "none") {
      notes.push({ docId: doc.id, fileName: doc.fileName, status: "skipped", note: "Included as-is (contents are not read for this skill)." });
      continue;
    }

    const input = { analyzer, fileName: doc.fileName, pages: pages.map((text, n) => ({ page: n + 1, text })) };
    const { data, provider } = await runAiTask(
      db,
      {
        task: "extract_document",
        promptVersion: EXTRACTION_PROMPT_VERSION,
        system: extractionSystemPrompt(),
        prompt: extractionPrompt(input),
        input,
        schema: ExtractionOutput,
        maxTokens: 8000,
        effort: "low",
      },
      { userId: ctx.session.userId, workSessionId: ctx.session.id, skillVersionId: ctx.session.skillVersionId },
    );
    providerLabel = provider.label;
    isDemonstration = provider.isDemonstration;

    const verified = (page: number, quote: string, value: string) => quoteOnPage(pages, page, quote) && valueSupportedByQuote(value, quote);
    const push = (key: string, item: ExtractedItem) => (extracted[key] ??= []).push(item);
    for (const f of data.facts) {
      push(f.key, { value: f.value, docId: doc.id, fileName: doc.fileName, page: f.page, quote: f.quote, verified: verified(f.page, f.quote, f.value) });
    }
    for (const t of data.treatment) {
      push("treatment", {
        value: { provider: t.provider, dates: t.dates, treatment: [t.treatment, t.diagnosis ? `Diagnosis: ${t.diagnosis}` : ""].filter(Boolean).join(" ") },
        docId: doc.id,
        fileName: doc.fileName,
        page: t.page,
        quote: t.quote,
        verified: verified(t.page, t.quote, t.dates),
      });
    }
    for (const b of data.bills) {
      push("bills", { value: { provider: b.provider, dates: b.dates, amount: b.amount }, docId: doc.id, fileName: doc.fileName, page: b.page, quote: b.quote, verified: verified(b.page, b.quote, b.amount) });
    }
    if (data.summary) summaries.push({ docId: doc.id, fileName: doc.fileName, summary: data.summary });
    notes.push({ docId: doc.id, fileName: doc.fileName, status: "read" });
  }

  const analysis: AnalysisResult = {
    ranAt: new Date().toISOString(),
    providerLabel: providerLabel || "No documents needed reading",
    isDemonstration,
    extracted,
    documents: notes,
    summaries,
  };
  const fresh = await loadWorkContext(db, sessionId);
  const data = applyPrefill(fresh.config, { ...fresh.data, analysis }, (matter?.fields ?? {}) as Record<string, string>, extracted);
  if (data.generation) data.generation = { ...data.generation, stale: true };
  await saveSessionData(db, sessionId, data);
  return { documentsRead: notes.filter((n) => n.status === "read").length, needsReview: notes.filter((n) => n.status === "no_text" || n.status === "failed").length };
}
