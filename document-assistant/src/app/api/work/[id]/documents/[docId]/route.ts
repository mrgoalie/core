import { z } from "zod";
import { apiRoute, fileResponse, readJson } from "@/server/http";
import { removeUpload, updateDocument, viewSourceDocument } from "@/server/services/work";

type P = { id: string; docId: string };

export const GET = apiRoute<P>({}, async ({ db, actor, params, meta }) => {
  const f = await viewSourceDocument(db, actor, params.id, params.docId, meta);
  return fileResponse(f.bytes, f.fileName, f.mimeType, true);
});

export const PATCH = apiRoute<P>({}, async ({ db, actor, params, req }) => {
  const body = await readJson(req, z.object({ selected: z.boolean().optional(), requirementId: z.string().max(40).nullable().optional() }));
  await updateDocument(db, actor, params.id, params.docId, body);
  return { ok: true };
});

export const DELETE = apiRoute<P>({}, async ({ db, actor, params, meta }) => {
  await removeUpload(db, actor, params.id, params.docId, meta);
  return { ok: true };
});
