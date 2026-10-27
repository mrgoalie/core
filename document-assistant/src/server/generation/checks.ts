/**
 * Deterministic safety checks. None of these rely on an AI model checking its own work.
 */
import { parseAmount } from "@/lib/calculations";

export const normalizeText = (s: string) =>
  s
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** Confirms a quoted excerpt really appears on the cited page. */
export function quoteOnPage(pages: string[], page: number, quote: string) {
  if (!quote.trim() || page < 1 || page > pages.length) return false;
  return normalizeText(pages[page - 1]).includes(normalizeText(quote));
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Normalises "03/14/2025", "2025-03-14" or "March 14, 2025" to "2025-03-14". */
export function normalizeDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = /^([A-Za-z]+)\.? (\d{1,2}),? (\d{4})$/.exec(t);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m![1].toLowerCase().slice(0, 3)));
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

export function formatLongDate(iso: string) {
  const d = normalizeDate(iso);
  if (!d) return iso;
  const [y, mo, da] = d.split("-").map(Number);
  return `${MONTHS[mo - 1][0].toUpperCase()}${MONTHS[mo - 1].slice(1)} ${da}, ${y}`;
}

const DATE_PATTERNS = [/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, /\b\d{4}-\d{2}-\d{2}\b/g, /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? \d{4}\b/g];
export function datesIn(text: string): string[] {
  const out = new Set<string>();
  for (const re of DATE_PATTERNS) for (const m of text.matchAll(re)) {
    const d = normalizeDate(m[0]);
    if (d) out.add(d);
  }
  return [...out];
}

export function amountsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g)) {
    const v = parseAmount(m[0]);
    if (v) out.add(v.toFixed(2));
  }
  return [...out];
}

/** True when the extracted value is literally supported by its quote (amounts and dates must match). */
export function valueSupportedByQuote(value: string, quote: string) {
  const amounts = amountsIn(value);
  if (amounts.length) {
    const inQuote = new Set(amountsIn(quote));
    return amounts.every((a) => inQuote.has(a));
  }
  const date = normalizeDate(value);
  if (date) return datesIn(quote).includes(date);
  return true;
}

const CITATION_PATTERNS: RegExp[] = [
  /\b\d+\s+(?:Ill\.(?:\s?App\.)?(?:\s?\dd)?|Ill\.\s?2d|N\.E\.(?:\s?\dd)?|F\.(?:\s?\dd|\s?Supp\.)?|S\.\s?Ct\.|U\.S\.|L\.\s?Ed\.)\s*\d+/g,
  /\b\d+\s+ILCS\s+[\d/.-]+/g,
  /\b(?:Ill\.\s*S\.\s*Ct\.\s*R\.|Supreme Court Rule|Rule)\s+\d+(?:\([a-z0-9]+\))?/g,
  /§+\s*\d[\w.-]*/g,
  /\b[A-Z][A-Za-z'.&-]+(?:\s[A-Z][A-Za-z'.&-]+){0,3}\s+v\.\s+[A-Z][A-Za-z'.&-]+(?:\s[A-Z][A-Za-z'.&-]+){0,4}/g,
];

/** Finds text that looks like legal authority and was NOT supplied in the facts. */
export function unsupportedCitations(text: string, suppliedText: string) {
  const supplied = normalizeText(suppliedText);
  const found = new Set<string>();
  for (const re of CITATION_PATTERNS) for (const m of text.matchAll(re)) if (!supplied.includes(normalizeText(m[0]))) found.add(m[0].trim());
  return [...found];
}

export const providerKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(fictional\)/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(inc|llc|the|of|services?|group|partners?|center|centre)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function providersMatch(a: string, b: string) {
  const ka = providerKey(a);
  const kb = providerKey(b);
  if (!ka || !kb) return false;
  return ka === kb || ka.includes(kb) || kb.includes(ka);
}
