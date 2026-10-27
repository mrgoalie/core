import { apiRoute } from "@/server/http";
import { duplicateSkill } from "@/server/services/skills";

export const POST = apiRoute<{ id: string }>({ roles: ["FIRM_ADMIN"] }, async ({ db, actor, params, meta }) => duplicateSkill(db, actor, params.id, meta));
