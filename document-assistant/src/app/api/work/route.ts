import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { listMyWork, startWork } from "@/server/services/work";

export const GET = apiRoute({}, async ({ db, actor, req }) => ({ items: await listMyWork(db, actor, { limit: 200, includeArchived: req.nextUrl.searchParams.get("archived") === "1" }) }));

export const POST = apiRoute({ rate: { name: "work-start", limit: 30 } }, async ({ db, actor, req, meta }) => {
  const body = await readJson(req, z.object({ skillId: z.string().uuid(), testVersionId: z.string().uuid().optional() }));
  return startWork(db, actor, body.skillId, { testVersionId: body.testVersionId }, meta);
});
