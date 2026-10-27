import { apiRoute } from "@/server/http";
import { ActivityFilter, listActivity } from "@/server/services/admin";
import { listEmployees } from "@/server/services/users";

export const GET = apiRoute({ roles: ["FIRM_ADMIN", "SYSTEM_ADMIN"] }, async ({ db, actor, req }) => {
  const filter = ActivityFilter.parse(Object.fromEntries(req.nextUrl.searchParams));
  return { ...(await listActivity(db, actor, filter)), people: (await listEmployees(db)).map((e) => ({ id: e.id, displayName: e.displayName })) };
});
