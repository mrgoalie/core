import { apiRoute } from "@/server/http";
import { searchMattersFor } from "@/server/services/work";

export const GET = apiRoute<{ id: string }>({ rate: { name: "matter-search", limit: 120 } }, async ({ db, actor, params, req }) => ({
  matters: await searchMattersFor(db, actor, params.id, req.nextUrl.searchParams.get("q") ?? ""),
}));
