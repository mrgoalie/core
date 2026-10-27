import { apiRoute } from "@/server/http";
import { previewHome } from "@/server/services/ui";

export const GET = apiRoute({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, req }) => {
  const p = req.nextUrl.searchParams;
  return previewHome(db, actor, { asUserId: p.get("as") || undefined, source: p.get("source") === "published" ? "published" : "draft" });
});
