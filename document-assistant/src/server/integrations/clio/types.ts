import type { DocumentCategory, MatterFieldKey } from "@/lib/matter-fields";

export interface AdapterUser {
  id: string;
  email: string;
  displayName: string;
}

export interface MatterSummary {
  id: string;
  displayNumber: string;
  description: string;
  clientName: string;
  practiceArea: string;
  status: string;
  responsibleAttorney: string;
  openDate: string;
}

export interface MatterDetail extends MatterSummary {
  fields: Partial<Record<MatterFieldKey, string>>;
}

export interface MatterDocument {
  id: string;
  name: string;
  category: DocumentCategory;
  contentType: string;
  sizeBytes?: number;
  updatedAt?: string;
}

export interface DownloadedDocument {
  bytes: Buffer;
  contentType: string;
  name: string;
}

export interface AccessOptions {
  /** Administrator test runs only ever see the built-in fictional sample matters. */
  testMode?: boolean;
}

/**
 * Case-management integration boundary. Every call is made on behalf of a specific employee and
 * MUST return only what that employee is permitted to see in the case-management system.
 * "Not found" and "not permitted" are deliberately indistinguishable (both return null / throw NotFound).
 */
export interface CaseManagementAdapter {
  readonly mode: "mock" | "clio";
  readonly label: string;
  /** False until the integration has been tested against the live service with real credentials. */
  readonly verified: boolean;
  isConnected(user: AdapterUser): Promise<boolean>;
  searchMatters(user: AdapterUser, query: string, opts?: AccessOptions): Promise<MatterSummary[]>;
  getMatter(user: AdapterUser, matterId: string, opts?: AccessOptions): Promise<MatterDetail | null>;
  listDocuments(user: AdapterUser, matterId: string, opts?: AccessOptions): Promise<MatterDocument[]>;
  downloadDocument(user: AdapterUser, matterId: string, documentId: string, opts?: AccessOptions): Promise<DownloadedDocument>;
  /** Optional: save an approved document back to the matter. */
  saveDocument?(user: AdapterUser, matterId: string, file: { name: string; bytes: Buffer; contentType: string }): Promise<{ id: string }>;
}

/** Best-effort mapping from a document's category / name to our checklist categories. */
export function guessCategory(name: string, clioCategory?: string | null): DocumentCategory {
  const s = `${clioCategory ?? ""} ${name}`.toLowerCase();
  if (/police|crash|accident report|incident report/.test(s)) return "police_report";
  if (/bill|ledger|invoice|statement of charges|itemi[sz]ed/.test(s)) return "medical_bills";
  if (/record|chart|visit|evaluation|consult|er |emergency|therapy|chiropractic|radiology|mri/.test(s)) return "medical_records";
  if (/wage|payroll|employer|lost time/.test(s)) return "wage_loss";
  if (/declaration|policy|dec page|coverage/.test(s)) return "insurance_policy";
  if (/photo|\.jpe?g$|\.png$|image/.test(s)) return "photographs";
  if (/arbitration|demand for arb/.test(s)) return "arbitration_filing";
  if (/witness/.test(s)) return "witness_statement";
  if (/narrative|expert|ime report/.test(s)) return "expert_report";
  if (/lien/.test(s)) return "lien_notice";
  if (/settlement|release|tender/.test(s)) return "settlement_documents";
  if (/letter|correspondence|email/.test(s)) return "correspondence";
  return "other";
}
