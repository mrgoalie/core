import type { Metadata, Viewport } from "next";
import { defaultUiConfig, themeVars } from "@/lib/ui-config";
import { getDb } from "@/server/db/client";
import { getPublishedUi } from "@/server/services/ui";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Fabbrini Law Group — Document Assistant",
  description: "Private document assistant for Fabbrini Law Group staff.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let ui = defaultUiConfig();
  try {
    ui = await getPublishedUi(await getDb());
  } catch {
    // Fall back to the default look if the database isn't reachable; pages show their own errors.
  }
  return (
    <html lang="en">
      <body style={themeVars(ui) as React.CSSProperties}>{children}</body>
    </html>
  );
}
