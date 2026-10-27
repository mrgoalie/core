"use client";
import { OctagonX, Power } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { Alert, Button, ErrorAlert, Modal } from "../ui";

export function EmergencyControl({ suspended, reason }: { suspended: boolean; reason: string }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  async function apply(next: boolean) {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/admin/emergency", { body: { suspended: next, reason: why } });
      window.location.reload();
    } catch (e) {
      setErr(e as ApiError);
      setBusy(false);
    }
  }
  return (
    <section className="card" aria-labelledby="em-h" style={{ borderColor: suspended ? "var(--danger)" : undefined, borderWidth: suspended ? 2 : 1 }}>
      <h2 id="em-h" className="row">
        <OctagonX size={24} aria-hidden="true" color="var(--danger)" /> Emergency stop
      </h2>
      {suspended ? (
        <>
          <Alert tone="danger" title="Document creation is paused for everyone">
            Reason shown to employees: {reason || "—"}
          </Alert>
          <div style={{ marginTop: 14 }}>
            <Button onClick={() => apply(false)} busy={busy}>
              <Power size={18} aria-hidden="true" /> Resume document creation
            </Button>
          </div>
        </>
      ) : (
        <>
          <p>Immediately stops all reading of documents and drafting for everyone. Saved work is kept. To turn off one skill only, use Manage Skills.</p>
          <Button variant="danger" onClick={() => setOpen(true)}>
            <OctagonX size={18} aria-hidden="true" /> Pause all document creation
          </Button>
        </>
      )}
      <ErrorAlert error={err} />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Pause all document creation?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" busy={busy} disabled={!why.trim()} onClick={() => apply(true)}>
              Pause now
            </Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="em-reason">Reason (employees will see this)</label>
          <textarea id="em-reason" rows={3} value={why} onChange={(e) => setWhy(e.target.value)} />
        </div>
      </Modal>
    </section>
  );
}
