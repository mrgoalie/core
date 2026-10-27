import { z } from "zod";
import { ValidationError } from "@/server/errors";
import { apiRoute, readJson } from "@/server/http";
import { approveVersion, discardDraft, publishVersion, recordTestResult, restoreVersion } from "@/server/services/skills";
import { startWork } from "@/server/services/work";

const Body = z.object({
  action: z.enum(["start_test", "record_test", "approve", "publish", "restore", "discard"]),
  passed: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

export const POST = apiRoute<{ id: string; vid: string }>({ roles: ["FIRM_ADMIN", "ATTORNEY_REVIEWER"] }, async ({ db, actor, params, req, meta }) => {
  const b = await readJson(req, Body);
  switch (b.action) {
    case "start_test":
      return startWork(db, actor, params.id, { testVersionId: params.vid }, meta);
    case "record_test":
      if (b.passed === undefined) throw new ValidationError("Choose whether the test passed.");
      await recordTestResult(db, actor, params.vid, b.passed, b.notes ?? "", meta);
      return { ok: true };
    case "approve":
      await approveVersion(db, actor, params.vid, b.notes ?? "", meta);
      return { ok: true };
    case "publish":
      await publishVersion(db, actor, params.vid, meta);
      return { ok: true };
    case "restore":
      return restoreVersion(db, actor, params.vid, meta);
    case "discard":
      await discardDraft(db, actor, params.vid, meta);
      return { ok: true };
  }
});
