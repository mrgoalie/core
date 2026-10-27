import { redirect } from "next/navigation";
import { devLoginAllowed } from "@/server/auth/cookies";
import { safeReturnTo } from "@/server/auth/entra";
import { getPageActor } from "@/server/auth/page";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getPublishedUi } from "@/server/services/ui";
import { LoginPanel } from "./LoginPanel";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const returnTo = safeReturnTo(sp.returnTo);
  if (await getPageActor()) redirect(returnTo);
  const ui = await getPublishedUi(await getDb());
  const c = getConfig();
  return (
    <main className="login-wrap" id="main">
      <div className="login-card card stack">
        <div className="brand" style={{ justifyContent: "center", flexDirection: "column", textAlign: "center" }}>
          {ui.branding.logoAssetId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/branding/logo/${ui.branding.logoAssetId}`} alt={`${ui.branding.firmName} logo`} />
          ) : (
            <span className="brand-mark" aria-hidden="true">FLG</span>
          )}
          <span className="brand-text">
            <span className="brand-firm">{ui.branding.firmName}</span>
            <span className="brand-app">{ui.branding.appName}</span>
          </span>
        </div>
        <h1 style={{ textAlign: "center", fontSize: "1.6rem" }}>Sign in</h1>
        <LoginPanel
          entra={c.AUTH_MODE === "entra"}
          devLogin={devLoginAllowed()}
          returnTo={returnTo}
          error={sp.error ?? null}
          expired={sp.expired === "1"}
        />
        <p className="small muted" style={{ textAlign: "center" }}>
          For Fabbrini Law Group staff only. Activity is recorded for security.
        </p>
      </div>
    </main>
  );
}
