"use client";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { HomeView, type RecentItem, type Tile } from "@/components/HomeView";
import { useApi } from "@/components/useApi";
import { Alert, Spinner } from "@/components/ui";
import { themeVars, type UiConfig } from "@/lib/ui-config";

export function PreviewHome({ asUserId }: { asUserId: string }) {
  const { data, error } = useApi<{ ui: UiConfig; tiles: Tile[]; recent: RecentItem[]; viewerName: string }>(`/api/admin/ui/preview?source=draft&as=${encodeURIComponent(asUserId)}`);
  useEffect(() => {
    if (!data) return;
    // Apply the draft theme to the whole preview document so sizes and colours match exactly.
    for (const [k, v] of Object.entries(themeVars(data.ui))) {
      document.documentElement.style.setProperty(k, v);
      document.body.style.setProperty(k, v);
    }
  }, [data]);
  if (error) return <div className="page"><Alert tone="danger">{error.message}</Alert></div>;
  if (!data) return <div className="page"><Spinner label="Loading preview" /></div>;
  return (
    <div style={{ ...(themeVars(data.ui) as React.CSSProperties), background: "var(--page-bg)", minHeight: "100vh", fontSize: "var(--font-base)" }}>
      <div className="banner banner-test">Preview — showing what {data.viewerName} would see. Buttons are disabled.</div>
      <AppShell preview user={{ name: data.viewerName, isAttorney: false, isAdmin: false }} branding={data.ui.branding} navigation={data.ui.navigation} reviewCount={0} demoMode={false} generation={{ suspended: false, reason: "" }}>
        <HomeView ui={data.ui} tiles={data.tiles} recent={data.recent} onStart={() => undefined} busy={null} preview />
      </AppShell>
    </div>
  );
}
