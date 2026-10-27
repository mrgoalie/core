import { apiRoute } from "@/server/http";
import { getCaseAdapter } from "@/server/integrations/clio";

export const GET = apiRoute({}, async ({ actor }) => {
  const adapter = await getCaseAdapter();
  return { mode: adapter.mode, label: adapter.label, verified: adapter.verified, connected: await adapter.isConnected(actor) };
});
