import { describe, expect, it } from "vitest";
import { amountsIn, datesIn, normalizeDate, providersMatch, quoteOnPage, unsupportedCitations, valueSupportedByQuote } from "@/server/generation/checks";

describe("deterministic verification checks", () => {
  it("normalises dates in common formats", () => {
    expect(normalizeDate("03/14/2025")).toBe("2025-03-14");
    expect(normalizeDate("March 14, 2025")).toBe("2025-03-14");
    expect(normalizeDate("2025-03-14")).toBe("2025-03-14");
    expect(datesIn("Seen 3/4/2025 and again on April 1, 2025")).toEqual(["2025-03-04", "2025-04-01"]);
  });

  it("confirms a quote appears on the cited page (whitespace-insensitive)", () => {
    const pages = ["Line one\nTOTAL CHARGES:   $6,842.00", "second page"];
    expect(quoteOnPage(pages, 1, "TOTAL CHARGES: $6,842.00")).toBe(true);
    expect(quoteOnPage(pages, 2, "TOTAL CHARGES: $6,842.00")).toBe(false);
    expect(quoteOnPage(pages, 3, "x")).toBe(false);
  });

  it("requires amounts and dates to match the quoted text exactly", () => {
    expect(valueSupportedByQuote("$6,842.00", "TOTAL CHARGES: $6,842.00")).toBe(true);
    expect(valueSupportedByQuote("$6,843.00", "TOTAL CHARGES: $6,842.00")).toBe(false);
    expect(valueSupportedByQuote("03/14/2025", "Date of Crash: 03/14/2025")).toBe(true);
    expect(valueSupportedByQuote("03/15/2025", "Date of Crash: 03/14/2025")).toBe(false);
    expect(amountsIn("paid $1,000 and $25.5")).toEqual(["1000.00", "25.50"]);
  });

  it("flags legal citations that no attorney supplied", () => {
    const text = "Under Smith v. Jones, 123 Ill. App. 3d 456, and 735 ILCS 5/2-1117, the insured is liable.";
    const found = unsupportedCitations(text, "");
    expect(found.join(" | ")).toMatch(/Smith v. Jones/);
    expect(found.join(" | ")).toMatch(/735 ILCS 5\/2-1117/);
    expect(unsupportedCitations("Re: Thompson v. Ridgeway Logistics LLC", "Matter: Thompson v. Ridgeway Logistics LLC")).toEqual([]);
  });

  it("matches provider names loosely", () => {
    expect(providersMatch("Lakeshore General Hospital", "LAKESHORE GENERAL HOSPITAL (FICTIONAL)")).toBe(true);
    expect(providersMatch("Midwest Orthopedic Partners", "Northside Physical Therapy")).toBe(false);
  });
});
