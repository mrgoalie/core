/**
 * Word → PDF conversion.
 *
 * Preferred: LibreOffice in headless mode, which renders the firm's actual Word template faithfully.
 * Fallback: the built-in PDF composer renders the same content blocks directly (template letterhead
 * styling is approximated). The method used is recorded on every generated document.
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { getConfig } from "../config";

let available: boolean | null = null;
let queue: Promise<unknown> = Promise.resolve();

export async function libreOfficeAvailable(): Promise<boolean> {
  const mode = getConfig().PDF_CONVERTER;
  if (mode === "direct") return false;
  if (available !== null) return available;
  available = await new Promise<boolean>((resolve) => {
    execFile(getConfig().SOFFICE_PATH, ["--version"], { timeout: 20_000 }, (err) => resolve(!err));
  });
  return available;
}

/** Converts a .docx to PDF with LibreOffice. Conversions run one at a time to keep memory predictable. */
export function docxToPdf(docx: Buffer): Promise<Buffer> {
  const run = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fda-convert-"));
    const profile = path.join(dir, "profile");
    const input = path.join(dir, `${crypto.randomUUID()}.docx`);
    try {
      await fs.writeFile(input, docx, { mode: 0o600 });
      await new Promise<void>((resolve, reject) => {
        execFile(
          getConfig().SOFFICE_PATH,
          [`-env:UserInstallation=file://${profile}`, "--headless", "--norestore", "--nolockcheck", "--convert-to", "pdf", "--outdir", dir, input],
          { timeout: 120_000 },
          (err) => (err ? reject(err) : resolve()),
        );
      });
      return await fs.readFile(input.replace(/\.docx$/, ".pdf"));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

/** Stamps a diagonal DRAFT watermark on every page of a PDF. */
export async function stampDraft(pdf: Uint8Array, label = "DRAFT"): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    page.drawText(label, { x: width * 0.18, y: height * 0.3, size: 96, font, color: rgb(0.75, 0.2, 0.2), opacity: 0.12, rotate: degrees(40) });
  }
  return doc.save();
}
