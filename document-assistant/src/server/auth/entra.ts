/**
 * Microsoft Entra ID (Microsoft 365) sign-in using the OpenID Connect authorization-code flow
 * with PKCE, via Microsoft's MSAL library. Multifactor authentication is enforced by the firm's
 * Entra Conditional Access policy; optionally the app also requires an "mfa" authentication claim.
 *
 * Only people an administrator has added to the application can sign in. There is no separate
 * password system.
 *
 * STATUS: implemented; requires the firm's Entra app registration to test live (see docs/ENTRA-SETUP.md).
 */
import crypto from "node:crypto";
import { ConfidentialClientApplication, CryptoProvider, ResponseMode } from "@azure/msal-node";
import { eq, lt, sql } from "drizzle-orm";
import { audit, type RequestMeta } from "../audit";
import { getConfig } from "../config";
import type { DB } from "../db/client";
import { authRequests, users } from "../db/schema";
import { AppError } from "../errors";
import { createSession } from "./session";

const SCOPES = ["openid", "profile", "email"];

function client() {
  const c = getConfig();
  if (!c.ENTRA_TENANT_ID || !c.ENTRA_CLIENT_ID || !c.ENTRA_CLIENT_SECRET) throw new AppError(503, "entra_not_configured", "Microsoft sign-in has not been configured yet.");
  return new ConfidentialClientApplication({
    auth: { clientId: c.ENTRA_CLIENT_ID, authority: `https://login.microsoftonline.com/${c.ENTRA_TENANT_ID}`, clientSecret: c.ENTRA_CLIENT_SECRET },
    system: { loggerOptions: { piiLoggingEnabled: false } },
  });
}

const redirectUri = () => getConfig().ENTRA_REDIRECT_URI ?? `${getConfig().APP_BASE_URL}/api/auth/callback`;

export function safeReturnTo(v: string | null | undefined) {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/api/") ? v.slice(0, 300) : "/";
}

export async function beginEntraLogin(db: DB, returnTo: string | null) {
  const cca = client();
  const { verifier, challenge } = await new CryptoProvider().generatePkceCodes();
  const state = crypto.randomBytes(24).toString("base64url");
  const nonce = crypto.randomBytes(24).toString("base64url");
  await db.delete(authRequests).where(lt(authRequests.expiresAt, new Date()));
  await db.insert(authRequests).values({ state, codeVerifier: verifier, nonce, returnTo: safeReturnTo(returnTo), expiresAt: new Date(Date.now() + 10 * 60_000) });
  return cca.getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: redirectUri(),
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    state,
    nonce,
    responseMode: ResponseMode.QUERY,
    prompt: "select_account",
  });
}

export class SignInDenied extends AppError {
  constructor(message: string) {
    super(403, "sign_in_denied", message);
  }
}

export async function completeEntraLogin(db: DB, params: { code: string | null; state: string | null; error?: string | null }, meta: RequestMeta) {
  if (params.error || !params.code || !params.state) throw new SignInDenied("Sign-in was cancelled or did not complete. Please try again.");
  const [req] = await db.delete(authRequests).where(eq(authRequests.state, params.state)).returning();
  if (!req || req.expiresAt.getTime() < Date.now()) throw new SignInDenied("This sign-in link has expired. Please try again.");
  const c = getConfig();
  const result = await client().acquireTokenByCode({ code: params.code, scopes: SCOPES, redirectUri: redirectUri(), codeVerifier: req.codeVerifier });
  const claims = (result.idTokenClaims ?? {}) as Record<string, unknown>;
  const oid = String(claims.oid ?? "");
  const tid = String(claims.tid ?? "");
  const email = String(claims.preferred_username ?? claims.email ?? "").toLowerCase();
  if (tid !== c.ENTRA_TENANT_ID) {
    await audit(db, { action: "login.denied", outcome: "denied", details: { reason: "wrong_tenant", email }, meta });
    throw new SignInDenied("Please sign in with your Fabbrini Law Group work account.");
  }
  if (claims.nonce !== req.nonce) {
    await audit(db, { action: "login.denied", outcome: "denied", details: { reason: "nonce_mismatch" }, meta });
    throw new SignInDenied("Sign-in could not be verified. Please try again.");
  }
  if (c.ENTRA_REQUIRE_MFA_CLAIM) {
    const amr = Array.isArray(claims.amr) ? (claims.amr as string[]) : [];
    if (!amr.includes("mfa")) {
      await audit(db, { action: "login.denied", outcome: "denied", details: { reason: "mfa_missing", email }, meta });
      throw new SignInDenied("Multifactor sign-in is required. Please sign in again and complete the verification step.");
    }
  }
  let [user] = await db.select().from(users).where(eq(users.entraObjectId, oid));
  if (!user && email) [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  if (!user) {
    await audit(db, { action: "login.denied", outcome: "denied", details: { reason: "not_added", email }, meta });
    throw new SignInDenied("Your account hasn't been given access to the Document Assistant yet. Please ask your administrator to add you.");
  }
  if (user.status !== "active") {
    await audit(db, { actor: user, action: "login.denied", outcome: "denied", details: { reason: "suspended" }, meta });
    throw new SignInDenied("Your access to the Document Assistant is currently suspended. Please contact your administrator.");
  }
  if (!user.entraObjectId) await db.update(users).set({ entraObjectId: oid, updatedAt: new Date() }).where(eq(users.id, user.id));
  else if (user.entraObjectId !== oid) {
    await audit(db, { actor: user, action: "login.denied", outcome: "denied", details: { reason: "account_mismatch" }, meta });
    throw new SignInDenied("This email is linked to a different Microsoft account. Please contact your administrator.");
  }
  const session = await createSession(db, user.id, "entra", meta);
  await audit(db, { actor: user, action: "login.success", details: { method: "entra" }, meta });
  return { ...session, returnTo: req.returnTo ?? "/" };
}
