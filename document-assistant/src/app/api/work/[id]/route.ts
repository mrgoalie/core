import { z } from "zod";
import { apiRoute, readJson } from "@/server/http";
import { archiveWork, getWorkView, saveAnswers, setStep } from "@/server/services/work";

type P = { id: string };

export const GET = apiRoute<P>({}, async ({ db, actor, params }) => getWorkView(db, actor, params.id));

export const PATCH = apiRoute<P>({ rate: { name: "autosave", limit: 240 } }, async ({ db, actor, params, req }) => {
  const body = await readJson(req, z.object({ answers: z.record(z.string(), z.unknown()).optional(), step: z.number().int().min(1).max(3).optional() }));
  if (body.answers && Object.keys(body.answers).length) return saveAnswers(db, actor, params.id, body.answers, body.step);
  if (body.step) await setStep(db, actor, params.id, body.step);
  return { savedAt: new Date().toISOString() };
});

export const DELETE = apiRoute<P>({}, async ({ db, actor, params, meta }) => {
  await archiveWork(db, actor, params.id, meta);
  return { ok: true };
});
