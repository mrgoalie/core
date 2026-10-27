import { z } from "zod";
import { apiRoute, fileResponse, readJson } from "@/server/http";
import { downloadTemplate, setTemplateArchived } from "@/server/services/admin";

type P = { id: string };

export const GET = apiRoute<P>({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, params }) => {
  const t = await downloadTemplate(db, actor, params.id);
  return fileResponse(t.bytes, t.fileName, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
});

export const PATCH = apiRoute<P>({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, params, req, meta }) => {
  const { archived } = await readJson(req, z.object({ archived: z.boolean() }));
  await setTemplateArchived(db, actor, params.id, archived, meta);
  return { ok: true };
});
