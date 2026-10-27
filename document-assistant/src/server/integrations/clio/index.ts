import { getConfig } from "../../config";
import { getDb } from "../../db/client";
import { getEncryptionKey } from "../../storage";
import { ClioAdapter } from "./live";
import { MockCaseAdapter } from "./mock";
import type { CaseManagementAdapter } from "./types";

const demoAdapter = new MockCaseAdapter();
const sampleOnlyAdapter = new MockCaseAdapter(true);

/**
 * Returns the case-management adapter. Administrator test runs ALWAYS use the fictional sample
 * matter, even when the live Clio integration is enabled, so real client files are never used for testing.
 */
export async function getCaseAdapter(opts: { testMode?: boolean } = {}): Promise<CaseManagementAdapter> {
  if (opts.testMode) return sampleOnlyAdapter;
  if (getConfig().CASE_MANAGEMENT === "clio") return new ClioAdapter(await getDb(), getEncryptionKey());
  return demoAdapter;
}

export type { CaseManagementAdapter } from "./types";
