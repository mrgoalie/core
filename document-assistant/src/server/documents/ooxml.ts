/**
 * Converts the shared block model into WordprocessingML for insertion into a Word template at the
 * {{@body}} placeholder. Formatting is applied directly so the firm's template fonts and margins
 * still govern the overall look.
 */
import type { Block } from "./pdf-compose";

const CONTENT_TWIPS = 9360; // 6.5 inches

export function xmlEscape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Strip characters that are illegal in XML 1.0.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "");
}

function runs(text: string, rPr: string) {
  return text
    .split("\n")
    .map((line, i) => `${i > 0 ? `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:br/></w:r>` : ""}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r>`)
    .join("");
}

function para(text: string, o: { bold?: boolean; italic?: boolean; sizeHalfPts?: number; align?: string; indentTwips?: number; after?: number; keepNext?: boolean } = {}) {
  const pPr = [
    o.keepNext ? "<w:keepNext/>" : "",
    `<w:spacing w:before="0" w:after="${o.after ?? 160}"/>`,
    o.indentTwips ? `<w:ind w:left="${o.indentTwips}"/>` : "",
    o.align ? `<w:jc w:val="${o.align}"/>` : "",
  ].join("");
  const rPr = [o.bold ? "<w:b/>" : "", o.italic ? "<w:i/>" : "", o.sizeHalfPts ? `<w:sz w:val="${o.sizeHalfPts}"/><w:szCs w:val="${o.sizeHalfPts}"/>` : ""].join("");
  return `<w:p><w:pPr>${pPr}</w:pPr>${runs(text, rPr)}</w:p>`;
}

function cell(text: string, widthTwips: number, o: { bold?: boolean; shade?: boolean; right?: boolean }) {
  const tcPr = `<w:tcPr><w:tcW w:w="${widthTwips}" w:type="dxa"/>${o.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EBF0"/>' : ""}</w:tcPr>`;
  return `<w:tc>${tcPr}${para(text || " ", { bold: o.bold, after: 40, align: o.right ? "right" : undefined })}</w:tc>`;
}

export function blocksToOoxml(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        out.push(para(b.text, { bold: true, sizeHalfPts: b.level === 1 ? 28 : 24, align: b.align === "center" ? "center" : undefined, keepNext: true, after: 120 }));
        break;
      case "paragraph":
        out.push(
          para(b.text, {
            bold: b.bold,
            italic: b.italic,
            sizeHalfPts: b.size ? Math.round(b.size * 2) : undefined,
            align: b.align === "center" ? "center" : b.align === "left" ? "left" : "both",
            indentTwips: b.indent ? Math.round(b.indent * 20) : undefined,
          }),
        );
        break;
      case "keyvalue":
        for (const [k, v] of b.rows) out.push(`<w:p><w:pPr><w:spacing w:after="40"/><w:ind w:left="2880" w:hanging="2880"/><w:tabs><w:tab w:val="left" w:pos="2880"/></w:tabs></w:pPr>${runs(k, "<w:b/>")}<w:r><w:tab/></w:r>${runs(v || "—", "")}</w:p>`);
        out.push(para("", { after: 80 }));
        break;
      case "table": {
        const widths = b.columns.map((c) => Math.round(c.width * CONTENT_TWIPS));
        const border = '<w:top w:val="single" w:sz="4" w:color="8A9099"/><w:left w:val="single" w:sz="4" w:color="8A9099"/><w:bottom w:val="single" w:sz="4" w:color="8A9099"/><w:right w:val="single" w:sz="4" w:color="8A9099"/><w:insideH w:val="single" w:sz="4" w:color="8A9099"/><w:insideV w:val="single" w:sz="4" w:color="8A9099"/>';
        const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.columns.map((c, i) => cell(c.label, widths[i], { bold: true, shade: true, right: c.align === "right" })).join("")}</w:tr>`;
        const rows = b.rows
          .map((r, ri) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((v, i) => cell(v, widths[i], { bold: b.boldLastRow && ri === b.rows.length - 1, right: b.columns[i]?.align === "right" })).join("")}</w:tr>`)
          .join("");
        out.push(
          `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_TWIPS}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${header}${rows}</w:tbl>`,
        );
        out.push(para("", { after: 120 }));
        break;
      }
      case "spacer":
        out.push(para("", { after: Math.round(b.height * 10) }));
        break;
      case "rule":
        out.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="8A9099"/></w:pBdr><w:spacing w:after="160"/></w:pPr></w:p>');
        break;
      case "pagebreak":
        out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        break;
    }
  }
  return out.join("");
}
