/**
 * Exhibit package assembly: cover sheet, exhibit index, slip sheets, exhibits, page numbers,
 * Bates numbers and PDF bookmarks — all deterministic (no AI involved).
 */
import mammoth from "mammoth";
import { PDFDocument, PDFHexString, PDFName, PDFRef, StandardFonts, degrees, rgb, type PDFPage } from "pdf-lib";
import { composePdf, textPagesToPdf, winAnsiSafe, type Block } from "./pdf-compose";
import { docxToPdf, libreOfficeAvailable } from "./convert";
import type { FileKind } from "./intake";

export interface ExhibitSource {
  description: string;
  fileName: string;
  kind: FileKind;
  bytes: Buffer;
}

export interface PackageSettings {
  title: string;
  includeCoverSheet: boolean;
  includeExhibitIndex: boolean;
  slipSheets: boolean;
  batesPrefix: string;
  batesStart: number;
  pageNumbers: boolean;
  bookmarks: boolean;
}

export interface IndexRow {
  number: number;
  description: string;
  fileName: string;
  pages: number;
  firstPage: number;
  lastPage: number;
  batesFirst: string;
  batesLast: string;
  note?: string;
}

export interface PackageResult {
  pdf: Uint8Array;
  pageCount: number;
  index: IndexRow[];
  problems: string[];
}

const LETTER: [number, number] = [612, 792];

async function exhibitToPdf(src: ExhibitSource): Promise<{ doc: PDFDocument; note?: string }> {
  if (src.kind === "pdf") return { doc: await PDFDocument.load(src.bytes, { updateMetadata: false }) };
  if (src.kind === "png" || src.kind === "jpg") {
    const doc = await PDFDocument.create();
    const img = src.kind === "png" ? await doc.embedPng(src.bytes) : await doc.embedJpg(src.bytes);
    const page = doc.addPage(LETTER);
    const maxW = LETTER[0] - 108;
    const maxH = LETTER[1] - 144;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1.5);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: (LETTER[0] - w) / 2, y: (LETTER[1] - h) / 2, width: w, height: h });
    return { doc };
  }
  if (src.kind === "docx") {
    if (await libreOfficeAvailable()) return { doc: await PDFDocument.load(await docxToPdf(src.bytes)) };
    const { value } = await mammoth.extractRawText({ buffer: src.bytes });
    return { doc: await PDFDocument.load(await textPagesToPdf([value])), note: "Text-only rendition of a Word file" };
  }
  return { doc: await PDFDocument.load(await textPagesToPdf([src.bytes.toString("utf8")])) };
}

const bates = (prefix: string, n: number) => `${prefix}${prefix ? "-" : ""}${String(n).padStart(6, "0")}`;

function indexBlocks(rows: IndexRow[]): Block[] {
  return [
    { type: "heading", text: "EXHIBIT INDEX", level: 1, align: "center" },
    { type: "spacer", height: 6 },
    {
      type: "table",
      columns: [
        { label: "Exhibit", width: 0.11 },
        { label: "Description", width: 0.45 },
        { label: "Bates range", width: 0.3 },
        { label: "Pages", width: 0.14, align: "right" },
      ],
      rows: rows.map((r) => [String(r.number), r.note ? `${r.description} (${r.note})` : r.description, `${r.batesFirst} – ${r.batesLast}`, String(r.pages)]),
    },
  ];
}

export async function assemblePackage(
  exhibits: ExhibitSource[],
  settings: PackageSettings,
  cover: { rows: [string, string][]; draftNotice?: string },
  draft: boolean,
): Promise<PackageResult> {
  const problems: string[] = [];
  const loaded: { src: ExhibitSource; doc: PDFDocument; note?: string }[] = [];
  for (const src of exhibits) {
    try {
      const r = await exhibitToPdf(src);
      loaded.push({ src, ...r });
    } catch {
      problems.push(`“${src.fileName}” could not be added to the package (the file could not be opened). Please replace it with a clean PDF.`);
    }
  }

  // Lay out page numbers. The index's own length depends only on the number of rows.
  const placeholderRows: IndexRow[] = loaded.map((l, i) => ({ number: i + 1, description: l.src.description, fileName: l.src.fileName, pages: 0, firstPage: 0, lastPage: 0, batesFirst: "X", batesLast: "X", note: l.note }));
  const coverPages = settings.includeCoverSheet ? 1 : 0;
  const indexPages = settings.includeExhibitIndex ? (await PDFDocument.load(await composePdf(indexBlocks(placeholderRows)))).getPageCount() : 0;

  const rows: IndexRow[] = [];
  let page = coverPages + indexPages + 1;
  let batesNo = settings.batesStart;
  for (const [i, l] of loaded.entries()) {
    if (settings.slipSheets) {
      page += 1;
      batesNo += 1;
    }
    const n = l.doc.getPageCount();
    rows.push({ number: i + 1, description: l.src.description, fileName: l.src.fileName, pages: n, firstPage: page, lastPage: page + n - 1, batesFirst: bates(settings.batesPrefix, batesNo), batesLast: bates(settings.batesPrefix, batesNo + n - 1), note: l.note });
    page += n;
    batesNo += n;
  }

  const out = await PDFDocument.create();
  out.setTitle(winAnsiSafe(settings.title));
  out.setProducer("Fabbrini Law Group Document Assistant");
  const marks: { title: string; page: PDFPage }[] = [];
  const append = async (bytes: Uint8Array) => {
    const src = await PDFDocument.load(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    return pages[0];
  };

  if (settings.includeCoverSheet) {
    const blocks: Block[] = [
      { type: "spacer", height: 120 },
      { type: "heading", text: settings.title.toUpperCase(), level: 1, align: "center" },
      { type: "spacer", height: 24 },
      { type: "keyvalue", rows: cover.rows },
    ];
    if (cover.draftNotice) blocks.push({ type: "spacer", height: 24 }, { type: "paragraph", text: cover.draftNotice, bold: true, align: "center", color: [0.7, 0.1, 0.1] });
    marks.push({ title: "Cover sheet", page: await append(await composePdf(blocks)) });
  }
  if (settings.includeExhibitIndex) marks.push({ title: "Exhibit index", page: await append(await composePdf(indexBlocks(rows))) });

  const exhibitPageRanges: { from: number; to: number; label: string }[] = [];
  for (const [i, l] of loaded.entries()) {
    const label = `Exhibit ${i + 1}`;
    let first: PDFPage | undefined;
    if (settings.slipSheets) {
      first = await append(
        await composePdf([
          { type: "spacer", height: 230 },
          { type: "heading", text: label.toUpperCase(), level: 1, align: "center" },
          { type: "paragraph", text: l.src.description, align: "center", size: 14 },
        ]),
      );
    }
    const start = out.getPageCount();
    const copied = await out.copyPages(l.doc, l.doc.getPageIndices());
    copied.forEach((p) => out.addPage(p));
    exhibitPageRanges.push({ from: start, to: out.getPageCount() - 1, label });
    marks.push({ title: `${label} — ${l.src.description}`, page: first ?? copied[0] });
  }

  // Stamp page numbers, Bates numbers, exhibit labels and draft watermark.
  const font = await out.embedFont(StandardFonts.Helvetica);
  const boldFont = await out.embedFont(StandardFonts.HelveticaBold);
  const total = out.getPageCount();
  const firstBatesPage = coverPages + indexPages;
  out.getPages().forEach((p, idx) => {
    const { width, height } = p.getSize();
    if (settings.pageNumbers) {
      const t = `Page ${idx + 1} of ${total}`;
      p.drawText(t, { x: (width - font.widthOfTextAtSize(t, 8)) / 2, y: 18, size: 8, font, color: rgb(0.2, 0.2, 0.25) });
    }
    if (idx >= firstBatesPage && settings.batesPrefix !== undefined) {
      const t = bates(settings.batesPrefix, settings.batesStart + (idx - firstBatesPage));
      p.drawText(t, { x: width - 36 - boldFont.widthOfTextAtSize(t, 9), y: 18, size: 9, font: boldFont });
    }
    const range = exhibitPageRanges.find((r) => idx >= r.from && idx <= r.to);
    if (range) p.drawText(range.label, { x: width - 36 - boldFont.widthOfTextAtSize(range.label, 9), y: height - 24, size: 9, font: boldFont });
    if (draft) p.drawText("DRAFT", { x: width * 0.22, y: height * 0.32, size: 96, font: boldFont, color: rgb(0.75, 0.2, 0.2), opacity: 0.1, rotate: degrees(40) });
  });

  if (settings.bookmarks && marks.length) addOutline(out, marks);
  return { pdf: await out.save(), pageCount: total, index: rows, problems };
}

function addOutline(doc: PDFDocument, marks: { title: string; page: PDFPage }[]) {
  const ctx = doc.context;
  const outlinesRef = ctx.nextRef();
  const refs: PDFRef[] = marks.map(() => ctx.nextRef());
  marks.forEach((m, i) => {
    const entries: Record<string, unknown> = {
      Title: PDFHexString.fromText(m.title),
      Parent: outlinesRef,
      Dest: ctx.obj([m.page.ref, PDFName.of("Fit")]),
    };
    if (i > 0) entries.Prev = refs[i - 1];
    if (i < refs.length - 1) entries.Next = refs[i + 1];
    ctx.assign(refs[i], ctx.obj(entries as never));
  });
  ctx.assign(outlinesRef, ctx.obj({ Type: "Outlines", First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
}
