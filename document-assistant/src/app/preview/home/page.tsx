import { requirePageActor } from "@/server/auth/page";
import { PreviewHome } from "./PreviewHome";

/** Rendered inside the Interface Editor's preview frame. Administrators only. */
export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  await requirePageActor(["FIRM_ADMIN"]);
  const sp = await searchParams;
  return <PreviewHome asUserId={sp.as ?? ""} />;
}
