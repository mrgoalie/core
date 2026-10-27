import { apiRoute } from "@/server/http";
import { requestAnalysis } from "@/server/services/work";

export const POST = apiRoute<{ id: string }>({ rate: { name: "analyze", limit: 20 } }, async ({ db, actor, params, meta }) => requestAnalysis(db, actor, params.id, meta));
