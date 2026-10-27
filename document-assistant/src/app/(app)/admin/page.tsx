import { Activity, FileText, LayoutDashboard, Palette, Settings, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmergencyControl } from "@/components/admin/EmergencyControl";
import { isAnyAdmin } from "@/server/auth/permissions";
import { requirePageActor } from "@/server/auth/page";
import { getDb } from "@/server/db/client";
import { getSetting } from "@/server/settings";

export default async function AdminHome() {
  const actor = await requirePageActor();
  if (!isAnyAdmin(actor)) redirect("/admin/skills");
  const gen = await getSetting(await getDb(), "generation");
  const cards = [
    { href: "/admin/employees", icon: Users, title: "Manage Employees", desc: "Add people, choose which skills each person can use, and suspend access." },
    { href: "/admin/skills", icon: LayoutDashboard, title: "Manage Skills", desc: "Create new skills, edit existing ones, test them, and publish new versions." },
    { href: "/admin/interface", icon: Palette, title: "Interface Editor", desc: "Change the home screen, labels, colours, logo and the order of skills." },
    { href: "/admin/templates", icon: FileText, title: "Document Templates", desc: "Upload the firm's approved Word templates and letterhead." },
    { href: "/admin/activity", icon: Activity, title: "Activity", desc: "See who did what and when — sign-ins, changes, downloads and denials." },
    { href: "/admin/settings", icon: Settings, title: "Settings", desc: "AI provider, integrations, retention, and the emergency stop." },
  ];
  return (
    <div className="stack-lg">
      <div>
        <h1>Administration</h1>
        <p className="muted">Everything here can be changed without a programmer. Changes are recorded in the activity log.</p>
      </div>
      <div className="admin-cards">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="admin-card">
            <span className="ac-title">
              <c.icon size={22} aria-hidden="true" /> {c.title}
            </span>
            <span className="ac-desc">{c.desc}</span>
          </Link>
        ))}
      </div>
      <EmergencyControl suspended={gen.suspended} reason={gen.reason} />
    </div>
  );
}
