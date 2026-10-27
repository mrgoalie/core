import { and, eq, isNull, or, sql } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { isAnyAdmin, isAttorney } from "@/server/auth/permissions";
import { requirePageActor } from "@/server/auth/page";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { workSessions } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { getPublishedUi } from "@/server/services/ui";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor();
  const db = await getDb();
  const ui = await getPublishedUi(db);
  const gen = await getSetting(db, "generation");
  let reviewCount = 0;
  if (isAttorney(actor)) {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(workSessions)
      .where(and(eq(workSessions.status, "submitted"), eq(workSessions.isTest, false), or(isNull(workSessions.reviewerId), eq(workSessions.reviewerId, actor.id))));
    reviewCount = r?.n ?? 0;
  }
  const c = getConfig();
  return (
    <AppShell
      user={{ name: actor.displayName, isAttorney: isAttorney(actor), isAdmin: isAnyAdmin(actor) }}
      branding={ui.branding}
      navigation={ui.navigation}
      reviewCount={reviewCount}
      demoMode={c.AUTH_MODE === "development" || c.CASE_MANAGEMENT === "mock"}
      generation={{ suspended: gen.suspended, reason: gen.reason }}
    >
      {children}
    </AppShell>
  );
}
