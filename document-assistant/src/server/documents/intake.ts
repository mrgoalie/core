/**
 * Upload validation and screening. Every uploaded file is treated as untrusted:
 * - the real file type is determined from its contents (not its name),
 * - active content (PDF JavaScript/launch actions/embedded files, Word macros, external links) is rejected,
 * - the EICAR anti-virus test signature is detected,
 * - optionally the file is streamed to a ClamAV daemon (MALWARE_SCANNER=clamav).
 *
 * In Azure, enable Microsoft Defender for Storage malware scanning on the storage account as an
 * additional, independently maintained layer (see docs/SECURITY-CHECKLIST.md).
 */
import net from "node:net";
import PizZip from "pizzip";
import { getConfig } from "../config";

export const FILE_TYPES = {
  pdf: { mime: "application/pdf", label: "PDF" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word document" },
  txt: { mime: "text/plain", label: "Text file" },
  png: { mime: "image/png", label: "PNG image" },
  jpg: { mime: "image/jpeg", label: "JPEG image" },
} as const;
export type FileKind = keyof typeof FILE_TYPES;

export const ACCEPT_ATTRIBUTE = ".pdf,.docx,.txt,.png,.jpg,.jpeg";

export function kindFromMime(mime: string): FileKind | null {
  for (const [k, v] of Object.entries(FILE_TYPES)) if (v.mime === mime) return k as FileKind;
  return null;
}

export function sanitizeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || "document").slice(0, 150);
}

function isUtf8Text(bytes: Buffer) {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function detectKind(bytes: Buffer, fileName: string): FileKind | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && ext === "docx") return "docx";
  if (ext === "txt" && isUtf8Text(bytes)) return "txt";
  return null;
}

export interface ScanResult {
  ok: boolean;
  kind?: FileKind;
  reason?: string;
  engine: string;
}

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export async function screenUpload(bytes: Buffer, fileName: string): Promise<ScanResult> {
  const config = getConfig();
  const engine = config.MALWARE_SCANNER === "clamav" ? "clamav+basic" : "basic";
  if (bytes.length === 0) return { ok: false, reason: "The file is empty.", engine };
  if (bytes.length > config.MAX_UPLOAD_MB * 1024 * 1024)
    return { ok: false, reason: `The file is larger than ${config.MAX_UPLOAD_MB} MB. Please split it or reduce its size.`, engine };
  if (bytes.includes(Buffer.from(EICAR))) return { ok: false, reason: "The file failed the security scan and was not accepted.", engine };

  const kind = detectKind(bytes, fileName);
  if (!kind) return { ok: false, reason: "That file type isn't supported. Please upload a PDF, Word (.docx), text, PNG or JPEG file.", engine };

  if (kind === "pdf") {
    const head = bytes.toString("latin1");
    if (/\/Encrypt\b/.test(head)) return { ok: false, kind, reason: "This PDF is password-protected. Please upload an unprotected copy.", engine };
    if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b/.test(head))
      return { ok: false, kind, reason: "This PDF contains active content (scripts or embedded files) and can't be accepted. Use “Print to PDF” to make a clean copy and upload that.", engine };
  }
  if (kind === "docx") {
    try {
      const zip = new PizZip(bytes);
      const names = Object.keys(zip.files);
      if (!names.includes("word/document.xml") || !names.includes("[Content_Types].xml"))
        return { ok: false, kind, reason: "This doesn't appear to be a valid Word document.", engine };
      if (names.some((n) => /vbaProject\.bin|activeX|\.bin$/i.test(n)) || /macroEnabled/i.test(zip.file("[Content_Types].xml")?.asText() ?? ""))
        return { ok: false, kind, reason: "This Word document contains macros or embedded programs and can't be accepted. Save it as a regular .docx and try again.", engine };
      const rels = names.filter((n) => n.endsWith(".rels")).map((n) => zip.file(n)?.asText() ?? "");
      if (rels.some((r) => /TargetMode="External"[^>]*Type="[^"]*(attachedTemplate|oleObject|subDocument|frame)/i.test(r) || /Type="[^"]*(attachedTemplate|oleObject|subDocument|frame)"[^>]*TargetMode="External"/i.test(r)))
        return { ok: false, kind, reason: "This Word document links to outside files and can't be accepted.", engine };
    } catch {
      return { ok: false, kind, reason: "This Word document could not be opened. It may be damaged.", engine };
    }
  }

  if (config.MALWARE_SCANNER === "clamav") {
    const verdict = await clamavScan(bytes, config.CLAMAV_HOST ?? "127.0.0.1", config.CLAMAV_PORT);
    if (verdict !== "clean") return { ok: false, kind, reason: verdict === "infected" ? "The file failed the security scan and was not accepted." : "The security scanner is unavailable right now. Please try again later.", engine };
  }
  return { ok: true, kind, engine };
}

/** ClamAV INSTREAM protocol. Fails closed: if the scanner can't be reached the upload is refused. */
export function clamavScan(bytes: Buffer, host: string, port: number): Promise<"clean" | "infected" | "error"> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let reply = "";
    socket.setTimeout(30_000, () => {
      socket.destroy();
      resolve("error");
    });
    socket.on("error", () => resolve("error"));
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let i = 0; i < bytes.length; i += 64 * 1024) {
        const chunk = bytes.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        socket.write(len);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (d) => (reply += d.toString()));
    socket.on("end", () => resolve(/OK/.test(reply) && !/FOUND/.test(reply) ? "clean" : /FOUND/.test(reply) ? "infected" : "error"));
  });
}
