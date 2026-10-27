import { ValidationError } from "@/server/errors";
import { apiRoute } from "@/server/http";
import { uploadLogo } from "@/server/services/ui";

export const POST = apiRoute({ roles: ["FIRM_ADMIN"], rate: { name: "upload", limit: 20 } }, async ({ db, actor, req, meta }) => {
  if (Number(req.headers.get("content-length") ?? 0) > 2 * 1024 * 1024) throw new ValidationError("Please use a logo smaller than 1 MB.");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("Choose an image file.");
  return uploadLogo(db, actor, Buffer.from(await file.arrayBuffer()), meta);
});
