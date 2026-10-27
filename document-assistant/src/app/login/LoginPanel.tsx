"use client";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";

type DemoUser = { email: string; displayName: string; jobTitle: string | null; status: string };

export function LoginPanel({ entra, devLogin, returnTo, error, expired }: { entra: boolean; devLogin: boolean; returnTo: string; error: string | null; expired: boolean }) {
  const [users, setUsers] = useState<DemoUser[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(error);

  useEffect(() => {
    if (devLogin) api<{ users: DemoUser[] }>("/api/auth/dev-login").then((r) => setUsers(r.users)).catch(() => setUsers([]));
  }, [devLogin]);

  async function signInAs(email: string) {
    setBusy(email);
    setErr(null);
    try {
      await api("/api/auth/dev-login", { body: { email } });
      window.location.href = returnTo;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Sign-in failed.");
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      {expired ? <Alert tone="info">Your session ended. Please sign in again.</Alert> : null}
      {err ? <Alert tone="danger">{err}</Alert> : null}
      {entra ? (
        <a className="btn btn-lg btn-block" href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>
          Sign in with your Microsoft 365 work account
        </a>
      ) : null}
      {devLogin ? (
        <div className="stack">
          <Alert tone="warning" title="Demonstration sign-in">
            Microsoft sign-in isn&apos;t connected yet. Choose a fictional test employee to try the application. This option is
            automatically disabled in production.
          </Alert>
          <div className="demo-users" aria-label="Fictional test employees">
            {users === null ? <p className="muted">Loading test employees…</p> : null}
            {users?.map((u) => (
              <button key={u.email} type="button" className="demo-user" disabled={Boolean(busy) || u.status !== "active"} onClick={() => signInAs(u.email)}>
                <span>
                  <strong>{u.displayName}</strong>
                  <br />
                  <span className="small muted">{u.jobTitle ?? "Employee"}</span>
                </span>
                <span className="small muted">{u.status !== "active" ? "Suspended" : busy === u.email ? "Signing in…" : "Sign in"}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {!entra && !devLogin ? <Alert tone="danger">Sign-in is not configured. Please contact your system administrator.</Alert> : null}
    </div>
  );
}
