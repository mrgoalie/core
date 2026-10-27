import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { textPagesToPdf } from "@/server/documents/pdf-compose";
import { detectKind, sanitizeFileName, screenUpload } from "@/server/documents/intake";
import { buildDemonstrationTemplate } from "@/server/documents/templates";
import { decrypt, encrypt } from "@/server/storage";
import crypto from "node:crypto";

describe("upload screening", () => {
  it("accepts a normal PDF, Word file, text file and image by content, not by name", async () => {
    const pdf = Buffer.from(await textPagesToPdf(["hello"]));
    expect((await screenUpload(pdf, "record.pdf")).ok).toBe(true);
    expect(detectKind(pdf, "renamed.txt")).toBe("pdf");
    const docx = await buildDemonstrationTemplate();
    expect((await screenUpload(docx, "letter.docx")).ok).toBe(true);
    expect((await screenUpload(Buffer.from("plain notes"), "notes.txt")).ok).toBe(true);
  });

  it("rejects unsupported, empty, binary-as-text and oversized files", async () => {
    expect((await screenUpload(Buffer.from("MZ\x90\x00"), "tool.exe")).ok).toBe(false);
    expect((await screenUpload(Buffer.alloc(0), "empty.pdf")).ok).toBe(false);
    expect((await screenUpload(Buffer.from([0x41, 0x00, 0x42]), "bin.txt")).ok).toBe(false);
    const big = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(26 * 1024 * 1024)]);
    expect((await screenUpload(big, "big.pdf")).reason).toMatch(/larger than/);
  });

  it("rejects the antivirus test signature", async () => {
    const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    expect((await screenUpload(eicar, "eicar.txt")).ok).toBe(false);
  });

  it("rejects PDFs with scripts or password protection", async () => {
    const js = Buffer.from("%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF");
    expect((await screenUpload(js, "x.pdf")).reason).toMatch(/active content/);
    const enc = Buffer.from("%PDF-1.4\ntrailer << /Encrypt 5 0 R >>\n%%EOF");
    expect((await screenUpload(enc, "x.pdf")).reason).toMatch(/password/);
  });

  it("rejects Word documents with macros", async () => {
    const zip = new PizZip(await buildDemonstrationTemplate());
    zip.file("word/vbaProject.bin", "evil");
    const bytes = zip.generate({ type: "nodebuffer" });
    expect((await screenUpload(bytes, "macro.docx")).reason).toMatch(/macros/);
  });

  it("cleans file names", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName('bad<name>:"x".pdf')).toBe("badnamex.pdf");
  });
});

describe("encryption at rest", () => {
  it("round-trips and detects tampering", () => {
    const key = crypto.randomBytes(32);
    const blob = encrypt(Buffer.from("confidential"), key);
    expect(decrypt(blob, key).toString()).toBe("confidential");
    expect(blob.toString()).not.toContain("confidential");
    blob[blob.length - 1] ^= 1;
    expect(() => decrypt(blob, key)).toThrow();
    expect(() => decrypt(encrypt(Buffer.from("x"), key), crypto.randomBytes(32))).toThrow();
  });
});
