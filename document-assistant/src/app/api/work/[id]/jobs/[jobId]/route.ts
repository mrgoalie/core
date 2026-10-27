import { apiRoute } from "@/server/http";
import { getJobFor } from "@/server/services/work";

export const GET = apiRoute<{ id: string; jobId: string }>({ rate: { name: "poll", limit: 600 } }, async ({ db, actor, params }) => getJobFor(db, actor, params.id, params.jobId));
