import { AdminNav } from "@/components/admin/AdminNav";
import { isFirmAdmin, isSystemAdmin } from "@/server/auth/permissions";
import { requirePageActor } from "@/server/auth/page";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor(["FIRM_ADMIN", "SYSTEM_ADMIN", "ATTORNEY_REVIEWER"]);
  return (
    <div className="page">
      <AdminNav firmAdmin={isFirmAdmin(actor)} systemAdmin={isSystemAdmin(actor)} />
      {children}
    </div>
  );
}
