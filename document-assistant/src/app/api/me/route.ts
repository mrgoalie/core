import { apiRoute } from "@/server/http";

export const GET = apiRoute({}, async ({ actor }) => ({ id: actor.id, email: actor.email, displayName: actor.displayName, roles: actor.roles }));
