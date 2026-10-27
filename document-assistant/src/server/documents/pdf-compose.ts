/**
 * Small, dependency-light PDF layout engine on top of pdf-lib: headings, wrapped paragraphs,
 * key/value lists and simple tables on US Letter pages. Used for exhibit indexes, cover sheets,
 * slip sheets, text renditions, demonstration fixtures, and as the fallback PDF renderer.
 */
import zlib from "node:zlib";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";

const CP1252_EXTRAS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/** Standard PDF fonts only support Windows-1252 characters; replace anything else safely. */
export function winAnsiSafe(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    if (ch === "\t") out += "    ";
    else if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRAS.includes(ch)) out += ch;
    else if (ch === "−") out += "-";
    else if (ch === " ") out += " ";
    else if (c >= 0x2000 && c <= 0x200b) out += " ";
    else out += "?";
  }
  return out;
}

export type { Block } from "@/lib/blocks";
import type { Block } from "@/lib/blocks";

export interface ComposeOptions {
  serif?: boolean;
  baseSize?: number;
  header?: string;
  watermark?: string;
  footer?: (pageNumber: number, pageCount: number) => string;
  title?: string;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
const CONTENT_W = PAGE_W - MARGIN * 2;

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of winAnsiSafe(text).split("\n")) {
    const words = para.split(/ +/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // Break very long words (e.g. long file names) across lines.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > maxWidth && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--;
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      line = w;
    }
    lines.push(line);
  }
  return lines;
}

export async function composePdf(blocks: Block[], opts: ComposeOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  if (opts.title) doc.setTitle(winAnsiSafe(opts.title));
  doc.setProducer("Fabbrini Law Group Document Assistant");
  doc.setCreator("Fabbrini Law Group Document Assistant");
  const regular = await doc.embedFont(opts.serif === false ? StandardFonts.Helvetica : StandardFonts.TimesRoman);
  const bold = await doc.embedFont(opts.serif === false ? StandardFonts.HelveticaBold : StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(opts.serif === false ? StandardFonts.HelveticaOblique : StandardFonts.TimesRomanItalic);
  const base = opts.baseSize ?? 11.5;

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN - (opts.header ? 18 : 0);
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN - (opts.header ? 18 : 0);
  };
  const ensure = (h: number) => {
    if (y - h < MARGIN + 20) newPage();
  };
  const drawLine = (text: string, font: PDFFont, size: number, x: number, align: "left" | "center" | "right" = "left", width = CONTENT_W, color = rgb(0.08, 0.08, 0.1)) => {
    const w = font.widthOfTextAtSize(text, size);
    const dx = align === "center" ? (width - w) / 2 : align === "right" ? width - w : 0;
    page.drawText(text, { x: x + dx, y, size, font, color });
  };

  for (const b of blocks) {
    if (b.type === "pagebreak") {
      newPage();
      continue;
    }
    if (b.type === "spacer") {
      y -= b.height;
      continue;
    }
    if (b.type === "rule") {
      ensure(12);
      page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: PAGE_W - MARGIN, y: y + 4 }, thickness: 0.75, color: rgb(0.5, 0.5, 0.55) });
      y -= 10;
      continue;
    }
    if (b.type === "heading") {
      const size = b.level === 1 ? base + 6 : b.level === 3 ? base + 0.5 : base + 2.5;
      const lines = wrapText(b.text, bold, size, CONTENT_W);
      ensure(lines.length * size * 1.3 + 8);
      y -= 4;
      for (const l of lines) {
        y -= size * 1.15;
        drawLine(l, bold, size, MARGIN, b.align ?? "left");
      }
      y -= size * 0.5;
      continue;
    }
    if (b.type === "paragraph") {
      const size = b.size ?? base;
      const font = b.bold ? bold : b.italic ? italic : regular;
      const indent = b.indent ?? 0;
      const lines = wrapText(b.text, font, size, CONTENT_W - indent);
      const color = b.color ? rgb(...b.color) : undefined;
      for (const l of lines) {
        ensure(size * 1.4);
        y -= size * 1.35;
        drawLine(l, font, size, MARGIN + indent, b.align ?? "left", CONTENT_W - indent, color);
      }
      y -= size * 0.6;
      continue;
    }
    if (b.type === "keyvalue") {
      const labelW = 170;
      for (const [k, v] of b.rows) {
        const lines = wrapText(v || "—", regular, base, CONTENT_W - labelW);
        ensure(lines.length * base * 1.35 + 4);
        y -= base * 1.35;
        page.drawText(winAnsiSafe(k), { x: MARGIN, y, size: base, font: bold });
        lines.forEach((l, i) => {
          if (i > 0) y -= base * 1.35;
          page.drawText(l, { x: MARGIN + labelW, y, size: base, font: regular });
        });
        y -= 3;
      }
      y -= base * 0.5;
      continue;
    }
    if (b.type === "table") {
      const size = base - 1;
      const widths = b.columns.map((c) => c.width * CONTENT_W);
      const drawRow = (cells: string[], font: PDFFont, shade: boolean) => {
        const wrapped = cells.map((c, i) => wrapText(c ?? "", font, size, widths[i] - 8));
        const h = Math.max(...wrapped.map((w) => w.length)) * size * 1.3 + 6;
        ensure(h + 2);
        if (shade) page.drawRectangle({ x: MARGIN, y: y - h, width: CONTENT_W, height: h, color: rgb(0.93, 0.94, 0.96) });
        let x = MARGIN;
        wrapped.forEach((lines, i) => {
          let ly = y - size - 2;
          for (const l of lines) {
            const w = font.widthOfTextAtSize(l, size);
            const dx = b.columns[i].align === "right" ? widths[i] - 4 - w : 4;
            page.drawText(l, { x: x + dx, y: ly, size, font });
            ly -= size * 1.3;
          }
          x += widths[i];
        });
        y -= h;
        page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.4, color: rgb(0.7, 0.7, 0.75) });
      };
      drawRow(b.columns.map((c) => c.label), bold, true);
      b.rows.forEach((r, i) => drawRow(r, b.boldLastRow && i === b.rows.length - 1 ? bold : regular, false));
      y -= base;
      continue;
    }
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    if (opts.header) {
      p.drawText(winAnsiSafe(opts.header), { x: MARGIN, y: PAGE_H - MARGIN + 18, size: 8.5, font: bold, color: rgb(0.55, 0.1, 0.1) });
    }
    if (opts.watermark) {
      p.drawText(winAnsiSafe(opts.watermark), {
        x: 120,
        y: 260,
        size: 64,
        font: bold,
        color: rgb(0.85, 0.85, 0.88),
        opacity: 0.35,
        rotate: degrees(35),
      });
    }
    if (opts.footer) {
      const t = winAnsiSafe(opts.footer(i + 1, pages.length));
      const w = regular.widthOfTextAtSize(t, 8.5);
      p.drawText(t, { x: (PAGE_W - w) / 2, y: MARGIN / 2, size: 8.5, font: regular, color: rgb(0.35, 0.35, 0.4) });
    }
  });
  return doc.save();
}

/** Renders plain text pages (one string per page) as a simple PDF. */
export async function textPagesToPdf(pages: string[], opts: ComposeOptions = {}) {
  const blocks: Block[] = [];
  pages.forEach((p, i) => {
    if (i > 0) blocks.push({ type: "pagebreak" });
    for (const line of p.split("\n")) blocks.push({ type: "paragraph", text: line || " ", size: 11 });
  });
  return composePdf(blocks, { serif: false, ...opts });
}

/** A tiny solid-colour PNG used as a stand-in photograph in demonstration data. */
export function placeholderPng(width = 320, height = 200): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let yy = 0; yy < height; yy++) {
    raw[yy * (width * 3 + 1)] = 0;
    for (let xx = 0; xx < width; xx++) {
      const o = yy * (width * 3 + 1) + 1 + xx * 3;
      const inner = xx > 40 && xx < width - 40 && yy > 40 && yy < height - 40;
      const v = inner ? 120 : 190;
      raw[o] = v;
      raw[o + 1] = v + 8;
      raw[o + 2] = v + 18;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
