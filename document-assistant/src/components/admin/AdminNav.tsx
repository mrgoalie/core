"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminNav({ firmAdmin, systemAdmin }: { firmAdmin: boolean; systemAdmin: boolean }) {
  const path = usePathname() ?? "";
  const items = [
    { href: "/admin", label: "Overview", show: firmAdmin || systemAdmin, exact: true },
    { href: "/admin/employees", label: "Manage Employees", show: firmAdmin || systemAdmin },
    { href: "/admin/skills", label: "Manage Skills", show: true },
    { href: "/admin/templates", label: "Templates", show: firmAdmin },
    { href: "/admin/interface", label: "Interface Editor", show: firmAdmin },
    { href: "/admin/activity", label: "Activity", show: firmAdmin || systemAdmin },
    { href: "/admin/settings", label: "Settings", show: firmAdmin || systemAdmin },
  ].filter((i) => i.show);
  return (
    <nav className="subnav" aria-label="Administration">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={(i.exact ? path === i.href : path.startsWith(i.href)) ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
