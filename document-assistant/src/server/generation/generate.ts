/**
 * Creates the work product for a work session.
 *
 *   draft    — runs AI drafting for AI sections (fixed sections are filled deterministically),
 *              validates the draft, and renders watermarked DRAFT files.
 *   rerender — re-renders from the stored sections plus the employee's wording edits (no AI).
 *   final    — after attorney approval, renders the identical content without draft markings.
 */
import { and, eq } from "drizzle-orm";
import { isVisible } from "@/lib/skill-config";
import { defaultUiConfig, UiConfig } from "@/lib/ui-config";
import type { GeneratedFile, GenerationResult, Issue } from "@/lib/work-types";
import { loadActor } from "../auth/session";
import type { DB } from "../db/client";
import { documentTemplates, generatedDocuments, sourceReferences, uiConfigVersions, workSessions } from "../db/schema";
import { ForbiddenError, ValidationError } from "../errors";
import { docxToPdf, libreOfficeAvailable, stampDraft } from "../documents/convert";
import { detectKind, kindFromMime } from "../documents/intake";
import { blocksToOoxml } from "../documents/ooxml";
import { assemblePackage, type ExhibitSource, type PackageResult } from "../documents/package";
import { composePdf } from "../documents/pdf-compose";
import { buildDemonstrationTemplate, fillTemplate } from "../documents/templates";
import { pdfPageCount } from "../documents/extract";
import { DRAFT_PROMPT_VERSION, DraftOutput, draftPrompt, draftSystemPrompt, type DraftInput } from "../integrations/ai/prompts";
import { runAiTask } from "../integrations/ai/service";
import { setJobProgress } from "../jobs/queue";
import { getStorage, newStorageKey, sha256 } from "../storage";
import { amountsIn, datesIn, formatLongDate, unsupportedCitations } from "./checks";
import { fetchDocumentBytes, loadMatterForOwner, loadWorkContext, saveSessionData, type WorkContext } from "./context";
import { buildFacts, describeSource } from "./facts";
import { assertGenerationAllowed, assertWorkCanRun } from "./guards";
import { buildBlocks, fillPlaceholders } from "./model";

type Mode = "draft" | "rerender" | "final";

async function firmName(db: DB) {
  const [row] = await db.select().from(uiConfigVersions).where(eq(uiConfigVersions.status, "published"));
  const parsed = UiConfig.safeParse(row?.config);
  return (parsed.success ? parsed.data : defaultUiConfig()).branding.firmName;
}

async function templateBytes(db: DB, templateId: string | null): Promise<{ bytes: Buffer; name: string }> {
  const [row] = templateId
    ? await db.select().from(documentTemplates).where(eq(documentTemplates.id, templateId))
    : await db.select().from(documentTemplates).where(and(eq(documentTemplates.isDemonstration, true), eq(documentTemplates.status, "active"))).limit(1);
  if (!row) return { bytes: await buildDemonstrationTemplate(), name: "Built-in demonstration template" };
  return { bytes: await getStorage().get(row.storageKey), name: row.name };
}

function orderedExhibits(ctx: WorkContext) {
  const selected = ctx.docs.filter((d) => d.selected);
  const order = ctx.data.exhibitOrder ?? [];
  const reqOrder = ctx.config.documents.map((r) => r.id);
  return [...selected].sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e6 : ia) - (ib === -1 ? 1e6 : ib);
    return reqOrder.indexOf(a.requirementId ?? "") - reqOrder.indexOf(b.requirementId ?? "") || a.createdAt.getTime() - b.createdAt.getTime();
  });
}

const stripExt = (f: string) => f.replace(/\.[A-Za-z0-9]{2,5}$/, "");
const safeName = (s: string) => s.replace(/[^\w .,()&-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 120);

export async function generateWorkProduct(db: DB, sessionId: string, mode: Mode, opts: { jobId?: string; approverId?: string } = {}) {
  const ctx = await loadWorkContext(db, sessionId);
  if (mode === "final") {
    await assertGenerationAllowed(db);
    if (ctx.session.status !== "submitted") throw new ValidationError("Only submitted work can be finalized.");
  } else {
    await assertWorkCanRun(db, ctx);
  }
  const progress = (t: string) => (opts.jobId ? setJobProgress(db, opts.jobId, t) : Promise.resolve());
  const { config: cfg, data } = ctx;

  const matter = await loadMatterForOwner(ctx);
  if (ctx.matterRef && !matter) throw new ForbiddenError("You no longer have access to this matter in the case-management system.");

  await progress("Gathering case information");
  const fb = buildFacts(cfg, data, matter, ctx.docs);
  const issues: Issue[] = [...fb.issues];
  const allFactText = fb.facts.map((f) => `${f.label}: ${f.value}`).join("\n");

  // ---- Sections -------------------------------------------------------------------------------
  const visibleSections = cfg.drafting.sections.filter((s) => isVisible(s.showWhen, data.answers));
  let sections: GenerationResult["sections"];
  let draftingEngine = data.generation?.draftingEngine ?? "Not used";
  let isDemoEngine = data.generation?.isDemonstrationEngine ?? false;

  if (mode === "draft" || !data.generation) {
    const aiSections = visibleSections.filter((s) => s.mode === "ai");
    let drafted: DraftOutput | null = null;
    if (aiSections.length) {
      await progress("Drafting the document");
      const input: DraftInput = {
        skillName: cfg.name,
        documentTitle: cfg.output.documentTitle,
        purpose: cfg.purpose,
        tone: cfg.drafting.tone,
        sections: aiSections.map((s) => ({ id: s.id, heading: s.heading, instructions: s.instructions ?? "" })),
        facts: fb.facts.map((f) => ({ id: f.id, key: f.key, label: f.label, value: f.value, source: describeSource(f.source) })),
      };
      const res = await runAiTask(
        db,
        { task: "draft_sections", promptVersion: DRAFT_PROMPT_VERSION, system: draftSystemPrompt(), prompt: draftPrompt(input), input, schema: DraftOutput, maxTokens: 16000, effort: "medium" },
        { userId: ctx.session.userId, workSessionId: ctx.session.id, skillVersionId: ctx.session.skillVersionId },
      );
      drafted = res.data;
      draftingEngine = res.provider.label;
      isDemoEngine = res.provider.isDemonstration;
    }
    const factIds = new Set(fb.facts.map((f) => f.id));
    sections = visibleSections.map((s) => {
      if (s.mode === "fixed") {
        return { id: s.id, heading: s.heading, paragraphs: fillPlaceholders(s.text ?? "", fb.values).split(/\n\s*\n/).map((t) => ({ text: t.trim(), refs: [] })) };
      }
      const out = drafted?.sections.find((d) => d.id === s.id);
      if (!out || out.paragraphs.length === 0) {
        issues.push({ kind: "drafting_gap", severity: "attention", message: `The section "${s.heading || s.id}" was not drafted.` });
        return { id: s.id, heading: s.heading, paragraphs: [{ text: `[MISSING: ${s.heading || s.id}]`, refs: [] }] };
      }
      return { id: s.id, heading: s.heading, paragraphs: out.paragraphs.map((p) => ({ text: p.text.trim(), refs: [...new Set(p.factIds.filter((id) => factIds.has(id)))] })) };
    });
    for (const g of drafted?.gaps ?? []) {
      const sec = visibleSections.find((s) => s.id === g.sectionId);
      issues.push({ kind: "drafting_gap", severity: "attention", message: `${sec?.heading || "Draft"}: ${g.description}` });
    }
    data.sectionEdits = {};
  } else {
    // Re-render from what was drafted, applying any wording the employee edited by hand.
    const prior = data.generation.sections;
    sections = visibleSections
      .map((s) => prior.find((p) => p.id === s.id) ?? { id: s.id, heading: s.heading, paragraphs: [{ text: `[MISSING: ${s.heading || s.id}]`, refs: [] }] })
      .map((s) => {
        const edit = data.sectionEdits?.[s.id];
        if (edit === undefined) return s;
        return { ...s, paragraphs: edit.split(/\n\s*\n/).map((t) => ({ text: t.trim(), refs: [], edited: true })).filter((p) => p.text) };
      });
    // Fixed sections always reflect the latest answers.
    sections = sections.map((s) => {
      const def = visibleSections.find((d) => d.id === s.id);
      if (def?.mode === "fixed" && data.sectionEdits?.[s.id] === undefined)
        return { ...s, paragraphs: fillPlaceholders(def.text ?? "", fb.values).split(/\n\s*\n/).map((t) => ({ text: t.trim(), refs: [] })) };
      return s;
    });
  }

  // ---- Deterministic checks of drafted wording -----------------------------------------------
  const knownAmounts = new Set([...amountsIn(allFactText), ...fb.calcs.filter((c) => c.value).map((c) => Number(c.value).toFixed(2))]);
  const knownDates = new Set(datesIn(allFactText));
  for (const s of sections) {
    const def = visibleSections.find((d) => d.id === s.id);
    for (const p of s.paragraphs) {
      for (const a of amountsIn(p.text))
        if (!knownAmounts.has(a)) issues.push({ kind: "unsupported_assertion", severity: "attention", message: `"${s.heading || "Opening"}" mentions $${Number(a).toLocaleString("en-US", { minimumFractionDigits: 2 })}, which doesn't match any amount in the case information.` });
      for (const d of datesIn(p.text))
        if (!knownDates.has(d)) issues.push({ kind: "unsupported_assertion", severity: "attention", message: `"${s.heading || "Opening"}" mentions ${formatLongDate(d)}, which doesn't match any date in the case information.` });
      for (const c of unsupportedCitations(p.text, allFactText))
        issues.push({ kind: "legal_authority", severity: "attention", message: `"${s.heading || "Opening"}" contains what looks like legal authority ("${c}") that no attorney supplied. An attorney must verify or remove it.` });
      if (def?.mode === "ai" && !p.edited && p.refs.length === 0 && !p.text.includes("[MISSING"))
        issues.push({ kind: "unsupported_assertion", severity: "info", message: `A paragraph in "${s.heading || "Opening"}" isn't linked to any source: “${p.text.slice(0, 80)}${p.text.length > 80 ? "…" : ""}”` });
    }
  }

  // ---- Package (assembled first so the cover letter can state counts) ------------------------
  const draft = mode !== "final";
  const revision = mode === "final" ? ctx.session.revision : ctx.session.revision + 1;
  const exhibits = orderedExhibits(ctx);
  let pkg: PackageResult | null = null;
  const formats = new Set(cfg.output.formats);
  if (formats.has("pdf_package")) {
    await progress(`Assembling ${exhibits.length} exhibits`);
    const sources: ExhibitSource[] = [];
    for (const d of exhibits) {
      try {
        const bytes = await fetchDocumentBytes(db, ctx, d);
        const kind = detectKind(bytes, d.fileName) ?? kindFromMime(d.mimeType);
        if (!kind) throw new Error("unsupported");
        sources.push({ description: stripExt(d.fileName), fileName: d.fileName, kind, bytes });
      } catch {
        issues.push({ kind: "document_problem", severity: "attention", message: `${d.fileName} could not be added to the package.` });
      }
    }
    const p = cfg.output.package ?? { title: cfg.output.documentTitle, includeCoverSheet: true, includeExhibitIndex: true, slipSheets: true, batesPrefix: "FLG", batesStart: 1, pageNumbers: true, bookmarks: true };
    const coverRows: [string, string][] = [
      ["Client / claimant", fb.values.client_name || "—"],
      ["Matter", `${ctx.matterRef?.displayNumber ?? ""} ${ctx.matterRef?.description ?? ""}`.trim() || "—"],
      ...fb.visibleInputs.filter((i) => ["text", "date", "select"].includes(i.type) && fb.values[i.id]).slice(0, 6).map((i) => [i.label, fb.values[i.id]] as [string, string]),
      ["Prepared by", `${await firmName(db)}`],
      ["Date prepared", formatLongDate(new Date().toISOString().slice(0, 10))],
    ];
    pkg = await assemblePackage(sources, p, { rows: coverRows, draftNotice: draft ? "DRAFT — FOR ATTORNEY REVIEW — NOT FOR FILING OR TRANSMISSION" : undefined }, draft);
    for (const prob of pkg.problems) issues.push({ kind: "document_problem", severity: "attention", message: prob });
    fb.values.exhibit_count = String(pkg.index.length);
    fb.values.package_pages = String(pkg.pageCount);
    // Fixed sections may reference package counts: refill them now that counts are known.
    sections = sections.map((s) => {
      const def = visibleSections.find((d) => d.id === s.id);
      if (def?.mode !== "fixed" || data.sectionEdits?.[s.id] !== undefined) return s;
      return { ...s, paragraphs: fillPlaceholders(def.text ?? "", fb.values).split(/\n\s*\n/).map((t) => ({ text: t.trim(), refs: [] })) };
    });
  }

  // ---- Render the main document ---------------------------------------------------------------
  await progress("Creating the Word and PDF files");
  const owner = ctx.owner ?? (await loadActor(db, ctx.session.userId));
  const approver = opts.approverId ? await loadActor(db, opts.approverId) : null;
  const firm = await firmName(db);
  const today = new Date().toISOString().slice(0, 10);
  const banner = draft
    ? ["DRAFT — ATTORNEY REVIEW REQUIRED — DO NOT SEND", isDemoEngine ? "DEMONSTRATION DRAFTING ENGINE (NO AI)" : "", ctx.session.isTest ? "TEST RUN — FICTIONAL DATA" : ""].filter(Boolean).join(" — ")
    : "";
  const values: Record<string, string> = {
    ...fb.values,
    firm_name: firm,
    today: formatLongDate(today),
    document_title: cfg.output.documentTitle,
    draft_banner: banner,
    prepared_by: owner?.displayName ?? "",
    reviewing_attorney: approver?.displayName ?? "",
  };
  const blocks = buildBlocks({
    cfg,
    values,
    answers: data.answers,
    visibleInputs: fb.visibleInputs,
    sections,
    calcs: fb.calcs,
    enclosures: formats.has("pdf_package") ? [] : exhibits.map((d) => stripExt(d.fileName)),
    todayLong: formatLongDate(today),
  });

  const files: GeneratedFile[] = [];
  const store = async (kind: GeneratedFile["kind"], format: "docx" | "pdf", bytes: Uint8Array, fileName: string, pageCount: number | null, renderMethod: string) => {
    const key = newStorageKey(`sessions/${ctx.session.id}/out`, format);
    await getStorage().put(key, bytes);
    const [row] = await db
      .insert(generatedDocuments)
      .values({
        workSessionId: ctx.session.id,
        revision,
        kind,
        format,
        isFinal: !draft,
        storageKey: key,
        fileName,
        mimeType: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
        pageCount,
        renderMethod,
        createdBy: opts.approverId ?? ctx.session.userId,
      })
      .returning();
    files.push({ id: row.id, kind, format, fileName, sizeBytes: bytes.byteLength, pageCount, renderMethod, isFinal: !draft });
  };

  const suffix = draft ? `DRAFT r${revision}` : "FINAL";
  const baseName = safeName(`${cfg.output.documentTitle} - ${values.client_name || ctx.matterRef?.displayNumber || "Matter"} - ${suffix}`);
  const needsDoc = formats.has("docx") || formats.has("pdf");
  if (needsDoc) {
    const tpl = await templateBytes(db, cfg.output.templateId);
    const docx = fillTemplate(tpl.bytes, values, blocksToOoxml(blocks));
    if (formats.has("docx")) await store("work_product", "docx", docx, `${baseName}.docx`, null, `template: ${tpl.name}`);
    if (formats.has("pdf")) {
      let pdf: Uint8Array;
      let method: string;
      if (await libreOfficeAvailable()) {
        pdf = await docxToPdf(docx);
        method = "libreoffice";
      } else {
        pdf = await composePdf([{ type: "heading", text: firm, level: 1, align: "center" }, { type: "rule" }, ...blocks], {
          header: banner || undefined,
          footer: (n, t) => `${firm} · Page ${n} of ${t}`,
          title: cfg.output.documentTitle,
        });
        method = "direct";
      }
      if (draft) pdf = await stampDraft(pdf);
      await store("work_product", "pdf", pdf, `${baseName}.pdf`, await pdfPageCount(pdf), method);
    }
  }
  if (pkg) await store("package", "pdf", pkg.pdf, safeName(`${cfg.output.package?.title ?? "Exhibit Package"} - ${values.client_name || "Matter"} - ${suffix}`) + ".pdf", pkg.pageCount, "assembled");

  // ---- Persist ----------------------------------------------------------------------------------
  const sources = fb.facts.map((f) => f.source);
  if (draft) {
    if (sources.length)
      await db.insert(sourceReferences).values(
        sources.map((s) => ({
          workSessionId: ctx.session.id,
          revision,
          factKey: s.factKey,
          label: s.label.slice(0, 300),
          value: s.value.slice(0, 2000),
          sourceType: s.sourceType,
          verification: s.verification,
          sessionDocumentId: s.docId ?? null,
          fileName: s.fileName ?? null,
          page: s.page ?? null,
          excerpt: s.excerpt?.slice(0, 300) ?? null,
        })),
      );
    const result: GenerationResult = {
      revision,
      generatedAt: new Date().toISOString(),
      blocks,
      issues: dedupe(issues),
      sources,
      files,
      draftingEngine,
      isDemonstrationEngine: isDemoEngine,
      sections,
      exhibitIndex: pkg?.index.map((r) => ({ number: r.number, description: r.description, batesFirst: r.batesFirst, batesLast: r.batesLast, pages: r.pages, note: r.note })),
      stale: false,
    };
    const fresh = await loadWorkContext(db, sessionId);
    await saveSessionData(db, sessionId, { ...fresh.data, sectionEdits: data.sectionEdits, generation: result }, {
      revision,
      status: fresh.session.status === "submitted" || fresh.session.status === "approved" ? fresh.session.status : "ready",
    });
    return { revision, files: files.length, issues: result.issues.filter((i) => i.severity === "attention").length };
  }

  const fresh = await loadWorkContext(db, sessionId);
  if (fresh.data.generation) await saveSessionData(db, sessionId, { ...fresh.data, generation: { ...fresh.data.generation, finalFiles: files } });
  await db.update(workSessions).set({ updatedAt: new Date() }).where(eq(workSessions.id, sessionId));
  return { revision, files: files.length, final: true, hashes: Object.fromEntries(files.map((f) => [f.fileName, f.id])) };
}

function dedupe(issues: Issue[]) {
  const seen = new Set<string>();
  return issues
    .filter((i) => {
      const k = `${i.kind}|${i.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "attention" ? -1 : 1));
}
