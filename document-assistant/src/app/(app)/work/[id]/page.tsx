import { WorkView } from "@/components/work/WorkView";
import { getDb } from "@/server/db/client";
import { getPublishedUi } from "@/server/services/ui";

export default async function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ui = await getPublishedUi(await getDb());
  return <WorkView sessionId={id} firmName={ui.branding.firmName} />;
}
