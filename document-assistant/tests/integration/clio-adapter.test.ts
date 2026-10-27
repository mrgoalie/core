import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { clioConnections } from "@/server/db/schema";
import { ClioAdapter, ClioNotConnectedError } from "@/server/integrations/clio/live";
import { setSetting } from "@/server/settings";
import { actor, DEMO, freshDb } from "../helpers";

/**
 * The live Clio adapter exercised against mocked Clio HTTP responses. This verifies our request
 * construction and response handling; it does NOT prove compatibility with the live Clio service.
 */
let db: DB;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await freshDb()));
afterAll(async () => close());

type Handler = (url: URL, init: RequestInit) => { status: number; json?: unknown; body?: string };
function fakeClio(handler: Handler) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(r.body ?? JSON.stringify(r.json ?? {}), { status: r.status, headers: { "content-type": r.body ? "application/pdf" : "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

const key = crypto.randomBytes(32);

describe("Clio adapter (mocked Clio API)", () => {
  it("stores per-employee OAuth tokens encrypted, and uses the employee's own token", async () => {
    const maria = await actor(db, DEMO.maria);
    const { f, calls } = fakeClio((url) => {
      if (url.pathname === "/oauth/token") return { status: 200, json: { access_token: "acc-maria", refresh_token: "ref-maria", expires_in: 3600 } };
      if (url.pathname === "/api/v4/matters.json")
        return { status: 200, json: { data: [{ id: 42, display_number: "2025-0042", description: "Doe v. Roe", status: "Open", open_date: "2025-01-01", client: { name: "Jane Doe" }, practice_area: { name: "PI" }, responsible_attorney: { name: "A. Lawyer" } }] } };
      return { status: 404 };
    });
    const clio = new ClioAdapter(db, key, f);
    expect(await clio.isConnected(maria)).toBe(false);
    await expect(clio.searchMatters(maria, "doe")).rejects.toBeInstanceOf(ClioNotConnectedError);
    await clio.exchangeCode(maria.id, "code-123");
    const [row] = await db.select().from(clioConnections).where(eq(clioConnections.userId, maria.id));
    expect(row.accessTokenEnc).not.toContain("acc-maria");
    const matters = await clio.searchMatters(maria, "doe");
    expect(matters[0]).toMatchObject({ id: "42", displayNumber: "2025-0042", clientName: "Jane Doe" });
    const search = calls.find((c) => c.url.pathname === "/api/v4/matters.json")!;
    expect(new Headers(search.init.headers).get("authorization")).toBe("Bearer acc-maria");
    expect(search.url.searchParams.get("query")).toBe("doe");
    expect(search.url.searchParams.get("fields")).toContain("display_number");
  });

  it("maps Clio custom fields onto case-file fields using the administrator's mapping", async () => {
    const maria = await actor(db, DEMO.maria);
    await setSetting(db, "clio", { fieldMap: { incident_date: "Date of Loss", claim_number: "Claim #" } }, null);
    const { f } = fakeClio((url) => {
      if (url.pathname === "/api/v4/matters/42.json")
        return {
          status: 200,
          json: { data: { id: 42, display_number: "2025-0042", description: "Doe v. Roe", client: { name: "Jane Doe" }, custom_field_values: [{ value: "2025-02-03", custom_field: { name: "Date of Loss" } }, { value: "CL-9", custom_field: { name: "claim #" } }] } },
        };
      if (url.pathname === "/api/v4/matters/43.json") return { status: 403 };
      return { status: 404 };
    });
    const clio = new ClioAdapter(db, key, f);
    const m = await clio.getMatter(maria, "42");
    expect(m?.fields).toMatchObject({ client_name: "Jane Doe", incident_date: "2025-02-03", claim_number: "CL-9" });
    // A matter the employee isn't permitted to see in Clio is simply "not found".
    expect(await clio.getMatter(maria, "43")).toBeNull();
  });

  it("refuses to download a document that belongs to a different matter", async () => {
    const maria = await actor(db, DEMO.maria);
    const { f } = fakeClio((url) => {
      if (url.pathname === "/api/v4/documents/7.json") return { status: 200, json: { data: { id: 7, name: "x.pdf", content_type: "application/pdf", matter: { id: 99 } } } };
      if (url.pathname === "/api/v4/documents/8.json") return { status: 200, json: { data: { id: 8, name: "bill.pdf", content_type: "application/pdf", matter: { id: 42 } } } };
      if (url.pathname === "/api/v4/documents/8/download") return { status: 200, body: "%PDF-1.4 fake" };
      if (url.pathname === "/api/v4/documents.json") return { status: 200, json: { data: [{ id: 8, name: "Lakeshore Itemized Bill.pdf", content_type: "application/pdf", document_category: { name: "Medical" } }] } };
      return { status: 404 };
    });
    const clio = new ClioAdapter(db, key, f);
    await expect(clio.downloadDocument(maria, "42", "7")).rejects.toThrow();
    const ok = await clio.downloadDocument(maria, "42", "8");
    expect(ok.bytes.toString()).toBe("%PDF-1.4 fake");
    const docs = await clio.listDocuments(maria, "42");
    expect(docs[0].category).toBe("medical_bills");
  });

  it("uploads an approved document with the three-step Clio flow", async () => {
    const maria = await actor(db, DEMO.maria);
    const { f, calls } = fakeClio((url, init) => {
      if (url.pathname === "/api/v4/documents.json" && init.method === "POST")
        return { status: 201, json: { data: { id: 500, latest_document_version: { uuid: "u-1", put_url: "https://upload.example/put", put_headers: [{ name: "x-amz-test", value: "1" }] } } } };
      if (url.host === "upload.example") return { status: 200, json: {} };
      if (url.pathname === "/api/v4/documents/500.json" && init.method === "PATCH") return { status: 200, json: { data: { id: 500 } } };
      return { status: 404 };
    });
    const clio = new ClioAdapter(db, key, f);
    expect(await clio.saveDocument(maria, "42", { name: "Final.pdf", bytes: Buffer.from("%PDF"), contentType: "application/pdf" })).toEqual({ id: "500" });
    const create = JSON.parse(String(calls[0].init.body));
    expect(create.data.parent).toEqual({ id: 42, type: "Matter" });
    expect(new Headers(calls[1].init.headers).get("x-amz-test")).toBe("1");
    expect(JSON.parse(String(calls[2].init.body)).data).toEqual({ uuid: "u-1", fully_uploaded: true });
  });

  it("refreshes an expired token, and disconnects on revoked access", async () => {
    const maria = await actor(db, DEMO.maria);
    await db.update(clioConnections).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(clioConnections.userId, maria.id));
    let refreshed = false;
    const { f } = fakeClio((url, init) => {
      if (url.pathname === "/oauth/token") {
        refreshed = String(init.body).includes("grant_type=refresh_token");
        return { status: 200, json: { access_token: "acc-2", expires_in: 3600 } };
      }
      if (url.pathname === "/api/v4/matters.json") return { status: 401 };
      return { status: 404 };
    });
    const clio = new ClioAdapter(db, key, f);
    await expect(clio.searchMatters(maria, "")).rejects.toBeInstanceOf(ClioNotConnectedError);
    expect(refreshed).toBe(true);
    expect(await clio.isConnected(maria)).toBe(false);
  });
});
