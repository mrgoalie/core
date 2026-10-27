import { NotFoundError } from "../../errors";
import { placeholderPng, textPagesToPdf } from "../../documents/pdf-compose";
import { DEMO_DOMAIN, MOCK_MATTERS, type MockMatter } from "./mock-data";
import type { AccessOptions, AdapterUser, CaseManagementAdapter, MatterDetail, MatterDocument, MatterSummary } from "./types";

const contentTypes = { pdf: "application/pdf", png: "image/png", txt: "text/plain" } as const;
const docCache = new Map<string, Buffer>();

/**
 * Demonstration adapter backed by fictional data. It enforces matter-level access the way Clio
 * would: demo employees see only matters they are listed on; restricted matters are visible only to
 * their named team; administrator test runs see only the fictional sample matter.
 */
export class MockCaseAdapter implements CaseManagementAdapter {
  readonly mode = "mock" as const;
  readonly label = "Demonstration case data (fictional — not connected to Clio)";
  readonly verified = true;

  constructor(private readonly onlySamples = false) {}

  private canAccess(user: AdapterUser, m: MockMatter, opts?: AccessOptions) {
    if (opts?.testMode || this.onlySamples) return Boolean(m.sampleForTesting);
    if (m.sampleForTesting) return false;
    const email = user.email.toLowerCase();
    if (m.accessEmails.includes(email)) return true;
    // People added by the firm (outside the demo roster) can try the unrestricted fictional matters.
    return !m.restricted && !email.endsWith(`@${DEMO_DOMAIN}`);
  }

  private find(user: AdapterUser, matterId: string, opts?: AccessOptions) {
    const m = MOCK_MATTERS.find((x) => x.id === matterId);
    return m && this.canAccess(user, m, opts) ? m : null;
  }

  async isConnected() {
    return true;
  }

  async searchMatters(user: AdapterUser, query: string, opts?: AccessOptions): Promise<MatterSummary[]> {
    const q = query.trim().toLowerCase();
    return MOCK_MATTERS.filter((m) => this.canAccess(user, m, opts))
      .filter((m) => !q || [m.displayNumber, m.description, m.clientName, m.practiceArea].some((s) => s.toLowerCase().includes(q)))
      .slice(0, 25)
      .map(summary);
  }

  async getMatter(user: AdapterUser, matterId: string, opts?: AccessOptions): Promise<MatterDetail | null> {
    const m = this.find(user, matterId, opts);
    return m ? { ...summary(m), fields: { ...m.fields } } : null;
  }

  async listDocuments(user: AdapterUser, matterId: string, opts?: AccessOptions): Promise<MatterDocument[]> {
    const m = this.find(user, matterId, opts);
    if (!m) throw new NotFoundError();
    return m.documents.map((d) => ({ id: d.id, name: d.name, category: d.category, contentType: contentTypes[d.kind], updatedAt: m.openDate }));
  }

  async downloadDocument(user: AdapterUser, matterId: string, documentId: string, opts?: AccessOptions) {
    const m = this.find(user, matterId, opts);
    const d = m?.documents.find((x) => x.id === documentId);
    if (!m || !d) throw new NotFoundError();
    let bytes = docCache.get(d.id);
    if (!bytes) {
      if (d.kind === "pdf") bytes = Buffer.from(await textPagesToPdf(d.pages, { title: d.name }));
      else if (d.kind === "png") bytes = placeholderPng();
      else bytes = Buffer.from(d.pages.join("\n\n"), "utf8");
      docCache.set(d.id, bytes);
    }
    return { bytes, contentType: contentTypes[d.kind], name: d.name };
  }
}

function summary(m: MockMatter): MatterSummary {
  return {
    id: m.id,
    displayNumber: m.displayNumber,
    description: m.description,
    clientName: m.clientName,
    practiceArea: m.practiceArea,
    status: m.status,
    responsibleAttorney: m.responsibleAttorney,
    openDate: m.openDate,
  };
}
