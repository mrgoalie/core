/**
 * Clio Manage adapter (API v4, per-employee OAuth 2.0).
 *
 * STATUS: UNVERIFIED. Written against Clio's published v4 conventions (JSON:API-style `data`
 * envelopes, `fields=` selection, OAuth at /oauth/authorize and /oauth/token, three-step document
 * upload: create → PUT to put_url → PATCH fully_uploaded). It has only been exercised against mocked
 * HTTP responses. Live testing with the firm's Clio developer application is required before use.
 *
 * Security model: every call uses the signed-in employee's OWN Clio access token, so Clio itself
 * enforces matter-level permissions. The application never uses a firm-wide credential to read matters.
 */
import { eq } from "drizzle-orm";
import { getConfig } from "../../config";
import type { DB } from "../../db/client";
import { clioConnections } from "../../db/schema";
import { AppError, NotFoundError, RateLimitedError } from "../../errors";
import { decrypt, encrypt } from "../../storage";
import { getSetting } from "../../settings";
import { MATTER_FIELD_KEYS, type MatterFieldKey } from "@/lib/matter-fields";
import { guessCategory, type AdapterUser, type CaseManagementAdapter, type MatterDetail, type MatterDocument, type MatterSummary } from "./types";

export class ClioNotConnectedError extends AppError {
  constructor() {
    super(409, "clio_not_connected", "Please connect your Clio account first. Click “Connect Clio” and sign in with your Clio login.");
  }
}

const MATTER_FIELDS =
  "id,display_number,description,status,open_date,client{name},practice_area{name},responsible_attorney{name}";

type FetchLike = typeof fetch;

interface ClioMatter {
  id: number | string;
  display_number?: string;
  description?: string;
  status?: string;
  open_date?: string;
  client?: { name?: string } | null;
  practice_area?: { name?: string } | null;
  responsible_attorney?: { name?: string } | null;
  custom_field_values?: { value?: unknown; custom_field?: { name?: string } }[];
}

export class ClioAdapter implements CaseManagementAdapter {
  readonly mode = "clio" as const;
  readonly label = "Clio Manage (live connection — not yet verified)";
  readonly verified = false;

  constructor(
    private readonly db: DB,
    private readonly key: Buffer,
    private readonly http: FetchLike = fetch,
  ) {}

  private get base() {
    return getConfig().CLIO_BASE_URL.replace(/\/$/, "");
  }

  authorizeUrl(state: string) {
    const c = getConfig();
    const u = new URL(`${this.base}/oauth/authorize`);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", c.CLIO_CLIENT_ID ?? "");
    u.searchParams.set("redirect_uri", c.CLIO_REDIRECT_URI ?? `${c.APP_BASE_URL}/api/clio/callback`);
    u.searchParams.set("state", state);
    return u.toString();
  }

  async exchangeCode(userId: string, code: string) {
    const c = getConfig();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: c.CLIO_CLIENT_ID ?? "",
      client_secret: c.CLIO_CLIENT_SECRET ?? "",
      redirect_uri: c.CLIO_REDIRECT_URI ?? `${c.APP_BASE_URL}/api/clio/callback`,
    });
    const res = await this.http(`${this.base}/oauth/token`, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    if (!res.ok) throw new AppError(502, "clio_oauth_failed", "Clio sign-in did not complete. Please try connecting again.");
    await this.storeTokens(userId, (await res.json()) as TokenResponse);
  }

  private async storeTokens(userId: string, t: TokenResponse) {
    const values = {
      userId,
      accessTokenEnc: encrypt(Buffer.from(t.access_token), this.key).toString("base64"),
      refreshTokenEnc: encrypt(Buffer.from(t.refresh_token ?? ""), this.key).toString("base64"),
      expiresAt: new Date(Date.now() + Math.max(60, (t.expires_in ?? 3600) - 60) * 1000),
    };
    await this.db.insert(clioConnections).values(values).onConflictDoUpdate({ target: clioConnections.userId, set: values });
  }

  async disconnect(userId: string) {
    await this.db.delete(clioConnections).where(eq(clioConnections.userId, userId));
  }

  async isConnected(user: AdapterUser) {
    const [row] = await this.db.select({ userId: clioConnections.userId }).from(clioConnections).where(eq(clioConnections.userId, user.id));
    return Boolean(row);
  }

  private async accessToken(user: AdapterUser): Promise<string> {
    const [row] = await this.db.select().from(clioConnections).where(eq(clioConnections.userId, user.id));
    if (!row) throw new ClioNotConnectedError();
    if (row.expiresAt.getTime() > Date.now()) return decrypt(Buffer.from(row.accessTokenEnc, "base64"), this.key).toString();
    const c = getConfig();
    const refresh = decrypt(Buffer.from(row.refreshTokenEnc, "base64"), this.key).toString();
    const res = await this.http(`${this.base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: c.CLIO_CLIENT_ID ?? "", client_secret: c.CLIO_CLIENT_SECRET ?? "" }),
    });
    if (!res.ok) {
      await this.disconnect(user.id);
      throw new ClioNotConnectedError();
    }
    const t = (await res.json()) as TokenResponse;
    await this.storeTokens(user.id, { ...t, refresh_token: t.refresh_token ?? refresh });
    return t.access_token;
  }

  private async request(user: AdapterUser, path: string, init: RequestInit & { params?: Record<string, string> } = {}) {
    const token = await this.accessToken(user);
    const url = new URL(`${this.base}/api/v4/${path}`);
    for (const [k, v] of Object.entries(init.params ?? {})) url.searchParams.set(k, v);
    const res = await this.http(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (res.status === 401) {
      await this.disconnect(user.id);
      throw new ClioNotConnectedError();
    }
    if (res.status === 403 || res.status === 404) throw new NotFoundError();
    if (res.status === 429) throw new RateLimitedError("Clio is busy right now. Please wait a minute and try again.");
    if (!res.ok) throw new AppError(502, "clio_error", "Clio did not respond as expected. Please try again shortly.");
    return res;
  }

  async searchMatters(user: AdapterUser, query: string): Promise<MatterSummary[]> {
    const params: Record<string, string> = { fields: MATTER_FIELDS, limit: "25", order: "display_number(desc)" };
    if (query.trim()) params.query = query.trim();
    const res = await this.request(user, "matters.json", { params });
    const json = (await res.json()) as { data?: ClioMatter[] };
    return (json.data ?? []).map(toSummary);
  }

  async getMatter(user: AdapterUser, matterId: string): Promise<MatterDetail | null> {
    try {
      const res = await this.request(user, `matters/${encodeURIComponent(matterId)}.json`, {
        params: { fields: `${MATTER_FIELDS},custom_field_values{value,custom_field{name}}` },
      });
      const m = ((await res.json()) as { data: ClioMatter }).data;
      const s = toSummary(m);
      const fieldMap = (await getSetting(this.db, "clio")).fieldMap;
      const fields: Partial<Record<MatterFieldKey, string>> = {
        client_name: s.clientName,
        matter_number: s.displayNumber,
        matter_description: s.description,
        practice_area: s.practiceArea,
        responsible_attorney: s.responsibleAttorney,
      };
      for (const key of MATTER_FIELD_KEYS) {
        const clioName = fieldMap[key];
        if (!clioName) continue;
        const cf = m.custom_field_values?.find((v) => v.custom_field?.name?.toLowerCase() === clioName.toLowerCase());
        if (cf?.value !== undefined && cf.value !== null && cf.value !== "") fields[key] = String(cf.value);
      }
      return { ...s, fields };
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  }

  async listDocuments(user: AdapterUser, matterId: string): Promise<MatterDocument[]> {
    const res = await this.request(user, "documents.json", {
      params: { matter_id: matterId, fields: "id,name,content_type,size,updated_at,document_category{name}", limit: "200" },
    });
    const json = (await res.json()) as { data?: { id: number; name: string; content_type?: string; size?: number; updated_at?: string; document_category?: { name?: string } | null }[] };
    return (json.data ?? []).map((d) => ({
      id: String(d.id),
      name: d.name,
      contentType: d.content_type ?? "application/octet-stream",
      sizeBytes: d.size,
      updatedAt: d.updated_at,
      category: guessCategory(d.name, d.document_category?.name),
    }));
  }

  async downloadDocument(user: AdapterUser, matterId: string, documentId: string) {
    // Confirm the document belongs to the matter the employee opened before downloading it.
    const metaRes = await this.request(user, `documents/${encodeURIComponent(documentId)}.json`, { params: { fields: "id,name,content_type,matter{id}" } });
    const meta = ((await metaRes.json()) as { data: { name: string; content_type?: string; matter?: { id?: number | string } | null } }).data;
    if (String(meta.matter?.id ?? "") !== String(matterId)) throw new NotFoundError();
    const res = await this.request(user, `documents/${encodeURIComponent(documentId)}/download`);
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: meta.content_type ?? res.headers.get("content-type") ?? "application/octet-stream", name: meta.name };
  }

  async saveDocument(user: AdapterUser, matterId: string, file: { name: string; bytes: Buffer; contentType: string }) {
    const create = await this.request(user, "documents.json", {
      method: "POST",
      params: { fields: "id,latest_document_version{uuid,put_url,put_headers}" },
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { name: file.name, parent: { id: Number(matterId), type: "Matter" } } }),
    });
    const doc = ((await create.json()) as { data: { id: number; latest_document_version: { uuid: string; put_url: string; put_headers?: { name: string; value: string }[] } } }).data;
    const headers: Record<string, string> = {};
    for (const h of doc.latest_document_version.put_headers ?? []) headers[h.name] = h.value;
    const put = await this.http(doc.latest_document_version.put_url, { method: "PUT", headers, body: new Uint8Array(file.bytes) });
    if (!put.ok) throw new AppError(502, "clio_upload_failed", "The document could not be uploaded to Clio.");
    await this.request(user, `documents/${doc.id}.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { uuid: doc.latest_document_version.uuid, fully_uploaded: true } }),
    });
    return { id: String(doc.id) };
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

function toSummary(m: ClioMatter): MatterSummary {
  return {
    id: String(m.id),
    displayNumber: m.display_number ?? String(m.id),
    description: m.description ?? "",
    clientName: m.client?.name ?? "",
    practiceArea: m.practice_area?.name ?? "",
    status: m.status ?? "",
    responsibleAttorney: m.responsible_attorney?.name ?? "",
    openDate: m.open_date ?? "",
  };
}
