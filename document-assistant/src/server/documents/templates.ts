/**
 * Word templates.
 *
 * A firm template is an ordinary .docx (for example the firm letterhead) containing placeholders
 * in double curly braces. The drafted content is inserted wherever {{@body}} appears on its own line.
 * Other placeholders ({{today}}, {{client_name}}, {{draft_banner}}, any question id…) are filled in.
 */
import Docxtemplater from "docxtemplater";
import { AlignmentType, BorderStyle, Document, Footer, Header, Packer, PageNumber, Paragraph, TextRun } from "docx";
import PizZip from "pizzip";
import { ValidationError } from "../errors";

const DELIMS = { start: "{{", end: "}}" };

export async function buildDemonstrationTemplate(): Promise<Buffer> {
  const doc = new Document({
    creator: "Fabbrini Law Group Document Assistant",
    title: "Demonstration Firm Template",
    styles: { default: { document: { run: { font: "Times New Roman", size: 24 } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 } } },
        headers: {
          default: new Header({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "{{draft_banner}}", bold: true, color: "B42318", size: 18 })] })],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "{{firm_name}}  ·  Page ", size: 16, color: "555555" }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "555555" })],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "{{firm_name}}", bold: true, size: 32, font: "Georgia" })] }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "Chicago, Illinois  ·  Personal Injury & Criminal Defense", size: 18, color: "444444" })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1F3A5F", space: 4 } },
            spacing: { after: 240 },
            children: [new TextRun({ text: "DEMONSTRATION TEMPLATE — replace with the firm's approved letterhead", italics: true, size: 16, color: "8A5300" })],
          }),
          new Paragraph({ children: [new TextRun("{{@body}}")] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export interface TemplateInspection {
  placeholders: string[];
  hasBody: boolean;
}

/** Reads a template's placeholders and confirms it can be filled. Throws a friendly error if not. */
export function inspectTemplate(bytes: Buffer): TemplateInspection {
  let doc: Docxtemplater;
  try {
    doc = new Docxtemplater(new PizZip(bytes), { delimiters: DELIMS, paragraphLoop: true, linebreaks: true });
  } catch (err) {
    const e = err as { properties?: { errors?: { properties?: { explanation?: string } }[] } };
    const first = e.properties?.errors?.[0]?.properties?.explanation;
    throw new ValidationError(`This template has a placeholder problem${first ? `: ${first}` : ""}. Check that every {{ has a matching }}.`);
  }
  // Read every document part (body, headers, footers); stripping XML joins text split across runs.
  const zip = doc.getZip();
  const text = Object.keys(zip.files)
    .filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))
    .map((n) => (zip.file(n)?.asText() ?? "").replace(/<[^>]+>/g, ""))
    .join("\n");
  const tags = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([@#/^]?)\s*([A-Za-z0-9_.]+)\s*\}\}/g)) tags.add(`${m[1]}${m[2]}`);
  return { placeholders: [...tags].sort(), hasBody: tags.has("@body") };
}

export function fillTemplate(templateBytes: Buffer, values: Record<string, string>, bodyXml: string): Buffer {
  const doc = new Docxtemplater(new PizZip(templateBytes), {
    delimiters: DELIMS,
    paragraphLoop: true,
    linebreaks: true,
    nullGetter(part) {
      if (part.module === "rawxml") return "";
      return `[MISSING: ${String(part.value).replace(/_/g, " ")}]`;
    },
  });
  doc.render({ ...values, body: bodyXml });
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}
