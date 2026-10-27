import { apiRoute } from "@/server/http";
import { homeFor } from "@/server/services/ui";

export const GET = apiRoute({}, async ({ db, actor }) => homeFor(db, actor));
