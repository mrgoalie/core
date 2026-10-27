import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db/client";
import type { Role } from "../db/schema";
import type { Actor } from "./permissions";
import { resolveSession, sessionCookieName } from "./session";

/** Session lookup for server-rendered pages. */
export async function getPageActor(): Promise<Actor | null> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;
  return resolveSession(await getDb(), token);
}

export async function requirePageActor(roles?: Role[]): Promise<Actor> {
  const actor = await getPageActor();
  if (!actor) {
    const path = (await headers()).get("x-pathname") ?? "/";
    redirect(`/login?returnTo=${encodeURIComponent(path)}`);
  }
  if (roles && !roles.some((r) => actor.roles.includes(r))) redirect("/?denied=1");
  return actor;
}
