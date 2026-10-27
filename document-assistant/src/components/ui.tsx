"use client";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { WORK_STATUS_LABELS } from "@/lib/work-types";

type BtnVariant = "primary" | "secondary" | "quiet" | "danger" | "danger-outline";
const cls = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({
  variant = "primary",
  size,
  block,
  className,
  busy,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "lg"; block?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={cls("btn", variant !== "primary" && `btn-${variant}`, size && `btn-${size}`, block && "btn-block", className)}
    >
      {busy ? <span className="spinner" style={{ width: 18, height: 18, borderWidth: 3 }} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", size, children, className, ...rest }: { href: string; variant?: BtnVariant; size?: "sm" | "lg"; children: ReactNode; className?: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <Link href={href} className={cls("btn", variant !== "primary" && `btn-${variant}`, size && `btn-${size}`, className)} {...rest}>
      {children}
    </Link>
  );
}

export function Alert({ tone = "info", title, children, role }: { tone?: "info" | "warning" | "danger" | "success"; title?: ReactNode; children?: ReactNode; role?: "alert" | "status" }) {
  const Icon = tone === "success" ? CircleCheck : tone === "danger" ? CircleAlert : tone === "warning" ? TriangleAlert : Info;
  return (
    <div className={`alert alert-${tone}`} role={role ?? (tone === "danger" ? "alert" : undefined)}>
      <Icon size={22} aria-hidden="true" />
      <div className="alert-body">
        {title ? <div className="alert-title">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}

export function ErrorAlert({ error }: { error: { message: string; details?: { field: string; message: string }[] } | null | undefined }) {
  if (!error) return null;
  return (
    <Alert tone="danger" title={error.message}>
      {error.details?.length ? (
        <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
          {error.details.map((d, i) => (
            <li key={i}>{d.message}</li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  optional,
  children,
  id,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  optional?: boolean;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? (
          <span className="req" aria-hidden="true">
            *
          </span>
        ) : null}
        {optional ? <span className="opt">(optional)</span> : null}
      </label>
      {hint ? (
        <div className="hint" id={`${id}-hint`}>
          {hint}
        </div>
      ) : null}
      {children}
      {error ? (
        <div className="error" id={`${id}-error`} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function useFieldId(prefix = "f") {
  return `${prefix}-${useId().replace(/:/g, "")}`;
}

export function Switch({ checked, onChange, label, disabled, describedBy }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; describedBy?: string }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-describedby={describedBy} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="row" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "approved" ? "success" : status === "submitted" ? "accent" : status === "changes_requested" ? "warning" : status === "ready" ? "accent" : "neutral";
  return <span className={`badge badge-${tone}`}>{WORK_STATUS_LABELS[status] ?? status}</span>;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "success" | "warning" | "danger"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Modal({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      {open ? (
        <>
          <div className="modal-body">
            <h2 id={titleId}>{title}</h2>
            {children}
          </div>
          <div className="modal-actions">{actions}</div>
        </>
      ) : null}
    </dialog>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="row-between" style={{ marginBottom: 22 }}>
      <div>
        <h1 style={{ marginBottom: subtitle ? 6 : 0 }}>{title}</h1>
        {subtitle ? <p className="muted" style={{ margin: 0 }}>{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function formatDateTime(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDate(v: string | Date | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function timeAgo(v: string | Date) {
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return formatDate(v);
}
