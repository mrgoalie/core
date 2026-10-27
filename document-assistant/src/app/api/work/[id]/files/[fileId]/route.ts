import { apiRoute, fileResponse } from "@/server/http";
import { downloadGenerated } from "@/server/services/work";

export const GET = apiRoute<{ id: string; fileId: string }>({ rate: { name: "download", limit: 120 } }, async ({ db, actor, params, req, meta }) => {
  const f = await downloadGenerated(db, actor, params.id, params.fileId, meta);
  return fileResponse(f.bytes, f.fileName, f.mimeType, req.nextUrl.searchParams.get("inline") === "1" && f.mimeType === "application/pdf");
});
