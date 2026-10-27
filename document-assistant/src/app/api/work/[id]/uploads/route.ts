import { getConfig } from "@/server/config";
import { ValidationError } from "@/server/errors";
import { apiRoute } from "@/server/http";
import { uploadDocument } from "@/server/services/work";

export const POST = apiRoute<{ id: string }>({ rate: { name: "upload", limit: 40 } }, async ({ db, actor, params, req, meta }) => {
  const max = getConfig().MAX_UPLOAD_MB * 1024 * 1024;
  if (Number(req.headers.get("content-length") ?? 0) > max + 1024 * 1024) throw new ValidationError(`The file is larger than ${getConfig().MAX_UPLOAD_MB} MB.`);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("Choose a file to upload.");
  const requirementId = (form.get("requirementId") as string | null) || null;
  const bytes = Buffer.from(await file.arrayBuffer());
  return uploadDocument(db, actor, params.id, { name: file.name, bytes }, requirementId, meta);
});
