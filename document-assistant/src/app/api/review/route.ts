import { apiRoute } from "@/server/http";
import { reviewQueue } from "@/server/services/review";

export const GET = apiRoute({ roles: ["ATTORNEY_REVIEWER"] }, async ({ db, actor }) => ({ items: await reviewQueue(db, actor) }));
