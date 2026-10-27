import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "@/server/integrations/ai/anthropic";
import { ExtractionOutput, EXTRACTION_PROMPT_VERSION } from "@/server/integrations/ai/prompts";
import { AiError } from "@/server/integrations/ai/types";

/** These tests exercise the real Anthropic SDK against mocked HTTP responses (no network, no key). */
function mockFetch(respond: (body: Record<string, unknown>, headers: Headers) => { status: number; json: unknown }) {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const headers = new Headers(init?.headers as HeadersInit);
    calls.push({ url: String(url), body, headers });
    const r = respond(body, headers);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json", "request-id": "req_test" } });
  }) as typeof fetch;
  return { f, calls };
}

const message = (text: string, stop = "end_turn") => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text }],
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 80 },
});

const req = {
  task: "extract_document" as const,
  promptVersion: EXTRACTION_PROMPT_VERSION,
  system: "system",
  prompt: "prompt",
  input: {},
  schema: ExtractionOutput,
  maxTokens: 4000,
  effort: "low" as const,
};

describe("Anthropic provider adapter (mocked HTTP)", () => {
  it("sends a structured-output request with the configured model and refusal fallbacks, and parses the result", async () => {
    const out = { facts: [{ key: "incident.date", value: "03/14/2025", page: 1, quote: "Date of Crash: 03/14/2025" }], treatment: [], bills: [], summary: "" };
    const { f, calls } = mockFetch(() => ({ status: 200, json: message(JSON.stringify(out)) }));
    const p = new AnthropicProvider("sk-test", "claude-opus-5-5", true, f);
    const res = await p.generate(req);
    expect(res.data).toEqual(out);
    expect(res.inputTokens).toBe(1200);
    const call = calls[0];
    expect(call.url).toMatch(/\/v1\/messages/);
    expect(call.body.model).toBe("claude-opus-5-5");
    expect(call.body.fallbacks).toBe("default");
    expect(call.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect((call.body.output_config as { format: { type: string }; effort: string }).format.type).toBe("json_schema");
    expect((call.body.output_config as { effort: string }).effort).toBe("low");
    expect(call.body.system).toBe("system");
  });

  it("reports a refusal without retrying", async () => {
    const { f, calls } = mockFetch(() => ({ status: 200, json: message("", "refusal") }));
    const err = await new AnthropicProvider("sk-test", "claude-opus-5-5", false, f).generate(req).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe("refused");
    expect(calls).toHaveLength(1);
    expect(calls[0].body.fallbacks).toBeUndefined();
  });

  it("maps authentication failures to a plain-English administrator message", async () => {
    const { f } = mockFetch(() => ({ status: 401, json: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }));
    const err = await new AnthropicProvider("bad", "claude-opus-5-5", true, f).generate(req).catch((e) => e);
    expect(err.code).toBe("auth");
    expect(err.message).toMatch(/system administrator/);
  });

  it("treats malformed output as retryable invalid output", async () => {
    const { f } = mockFetch(() => ({ status: 200, json: message("not json at all") }));
    const err = await new AnthropicProvider("sk-test", "claude-opus-5-5", true, f).generate(req).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe("invalid_output");
    expect(err.retryable).toBe(true);
  });
});
