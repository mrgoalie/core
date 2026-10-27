import { requirePageActor } from "@/server/auth/page";
import { InterfaceEditor } from "./InterfaceEditor";

export default async function InterfacePage() {
  await requirePageActor(["FIRM_ADMIN"]);
  return <InterfaceEditor />;
}
