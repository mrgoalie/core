/**
 * Text extraction with page-level structure so facts can be traced to a page.
 * Image OCR is not enabled in this release: images and scanned PDFs without a text layer are flagged
 * for manual review instead of being guessed at.
 */
import mammoth from "mammoth";
import { PDFDocument } from "pdf-lib";
import type { FileKind } from "./intake";

export interface ExtractedText {
  pages: string[];
  method: "pdf-text" | "docx" | "txt" | "none";
  pageCount: number;
  note?: string;
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

export async function extractText(bytes: Buffer, kind: FileKind): Promise<ExtractedText> {
  if (kind === "txt") {
    const text = bytes.toString("utf8");
    return { pages: [text], method: "txt", pageCount: 1 };
  }
  if (kind === "docx") {
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    return { pages: [value], method: "docx", pageCount: 1 };
  }
  if (kind === "pdf") {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
        if (typeof item.str !== "string") continue;
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
      pages.push(text.replace(/[ \t]+\n/g, "\n").trim());
    }
    const total = pages.join("").trim().length;
    return {
      pages,
      method: total > 0 ? "pdf-text" : "none",
      pageCount: pdf.numPages,
      note: total > 0 ? undefined : "This PDF appears to be a scan without readable text. Please review it yourself.",
    };
  }
  return { pages: [], method: "none", pageCount: 1, note: "Text can't be read from images automatically. Please review this file yourself." };
}
