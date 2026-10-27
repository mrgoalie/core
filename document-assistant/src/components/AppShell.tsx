"use client";
import { CircleHelp, House, Inbox, LayoutDashboard, LogOut, ScrollText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UiConfig } from "@/lib/ui-config";
import { api } from "@/lib/api-client";

interface Props {
  user: { name: string; isAttorney: boolean; isAdmin: boolean };
  branding: UiConfig["branding"];
  navigation: UiConfig["navigation"];
  reviewCount: number;
  demoMode: boolean;
  generation: { suspended: boolean; reason: string };
  children: React.ReactNode;
  preview?: boolean;
}

export function BrandBlock({ branding }: { branding: UiConfig["branding"] }) {
  return (
    <>
      {branding.logoAssetId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/branding/logo/${branding.logoAssetId}`} alt="" />
      ) : (
        <span className="brand-mark" aria-hidden="true">
          {branding.firmName
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 3)
            .map((w) => w[0])
            .join("")}
        </span>
      )}
      <span className="brand-text">
        <span className="brand-firm">{branding.firmName}</span>
        <span className="brand-app">{branding.appName}</span>
      </span>
    </>
  );
}

export function AppShell({ user, branding, navigation, reviewCount, demoMode, generation, children, preview }: Props) {
  const path = usePathname() ?? "/";
  const is = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const link = (href: string, label: string, icon: React.ReactNode, extra?: React.ReactNode) => (
    <Link href={preview ? "#" : href} aria-current={!preview && is(href) ? "page" : undefined} onClick={preview ? (e) => e.preventDefault() : undefined}>
      {icon}
      <span>{label}</span>
      {extra}
    </Link>
  );
  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  }
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      {demoMode ? <div className="banner banner-dev">Demonstration mode — all case data is fictional. Do not enter real client information.</div> : null}
      {generation.suspended ? (
        <div className="banner banner-stop" role="alert">
          Document creation is paused by the firm{generation.reason ? `: ${generation.reason}` : "."} Your saved work is safe.
        </div>
      ) : null}
      <header className="site-header">
        <div className="inner">
          <Link href={preview ? "#" : "/"} className="brand">
            <BrandBlock branding={branding} />
            <span className="sr-only"> — home</span>
          </Link>
          <nav className="main-nav" aria-label="Main">
            {link("/", navigation.homeLabel, <House size={20} aria-hidden="true" />)}
            {link("/work", navigation.myWorkLabel, <ScrollText size={20} aria-hidden="true" />)}
            {user.isAttorney
              ? link(
                  "/review",
                  navigation.reviewLabel,
                  <Inbox size={20} aria-hidden="true" />,
                  reviewCount ? (
                    <span className="nav-count" aria-label={`${reviewCount} waiting`}>
                      {reviewCount}
                    </span>
                  ) : null,
                )
              : null}
            {navigation.showHelpLink ? link("/help", navigation.helpLabel, <CircleHelp size={20} aria-hidden="true" />) : null}
            {user.isAdmin ? link("/admin", "Administration", <LayoutDashboard size={20} aria-hidden="true" />) : null}
            <span className="user-chip">{user.name}</span>
            <button type="button" className="nav-btn" onClick={preview ? undefined : signOut}>
              <LogOut size={20} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
