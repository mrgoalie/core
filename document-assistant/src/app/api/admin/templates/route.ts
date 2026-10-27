import { ValidationError } from "@/server/errors";
import { apiRoute } from "@/server/http";
import { listTemplates, uploadTemplate } from "@/server/services/admin";

export const GET = apiRoute({ roles: ["FIRM_ADMIN"] }, async ({ db }) => ({ templates: await listTemplates(db) }));

export const POST = apiRoute({ roles: ["FIRM_ADMIN"], rate: { name: "upload", limit: 20 } }, async ({ db, actor, req, meta }) => {
  if (Number(req.headers.get("content-length") ?? 0) > 11 * 1024 * 1024) throw new ValidationError("Templates must be smaller than 10 MB.");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("Choose a Word (.docx) file.");
  return uploadTemplate(db, actor, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, {
    name: String(form.get("name") ?? ""),
    description: String(form.get("description") ?? ""),
    replacesTemplateId: (form.get("replacesTemplateId") as string | null) || null,
  }, meta);
});
