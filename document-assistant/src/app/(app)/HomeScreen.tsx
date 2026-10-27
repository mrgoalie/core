"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { HomeView, type RecentItem, type Tile } from "@/components/HomeView";
import { useApi } from "@/components/useApi";
import { Alert, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import type { UiConfig } from "@/lib/ui-config";

export function HomeScreen() {
  const { data, error } = useApi<{ ui: UiConfig; tiles: Tile[]; recent: RecentItem[] }>("/api/home");
  const [busy, setBusy] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const router = useRouter();
  const sp = useSearchParams();

  async function start(skillId: string) {
    setBusy(skillId);
    setStartError(null);
    try {
      const r = await api<{ sessionId: string }>("/api/work", { body: { skillId } });
      router.push(`/work/${r.sessionId}`);
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : "That couldn't be started.");
      setBusy(null);
    }
  }

  if (error) return <div className="page"><Alert tone="danger">{error.message}</Alert></div>;
  if (!data) return <div className="page"><Spinner /></div>;
  return (
    <>
      {sp.get("denied") ? <div className="page" style={{ paddingBottom: 0 }}><Alert tone="warning">That page is only available to administrators.</Alert></div> : null}
      {startError ? <div className="page" style={{ paddingBottom: 0 }}><Alert tone="danger">{startError}</Alert></div> : null}
      <HomeView ui={data.ui} tiles={data.tiles} recent={data.recent} onStart={start} busy={busy} />
    </>
  );
}
