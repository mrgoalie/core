/**
 * Anthropic (Claude) provider adapter.
 *
 * - Structured outputs: responses are constrained to and validated against a Zod schema.
 * - Server-side refusal fallbacks ("default") are enabled unless ANTHROPIC_FALLBACKS=false.
 * - The SDK retries 408/409/429/5xx and connection errors (maxRetries: 2).
 * - Credentials come only from server environment variables (Key Vault in Azure); never the browser.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AiError, type AiProvider, type AiRequest, type AiResponse } from "./types";

export class AnthropicProvider implements AiProvider {
  readonly id = "anthropic" as const;
  readonly label = "Anthropic Claude";
  readonly isDemonstration = false;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly fallbacks: boolean,
    /** Injectable for tests; production uses the platform fetch. */
    fetchImpl?: typeof fetch,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 180_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  }

  async generate<T>(req: AiRequest<T>): Promise<AiResponse<T>> {
    try {
      // The structured-output format is passed to create() and parsed here, so the stop reason is
      // always checked first (a refusal has no JSON to parse and must not be retried).
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        output_config: { format: betaZodOutputFormat(req.schema as never), effort: req.effort },
        ...(this.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      if (response.stop_reason === "refusal") throw new AiError("refused", "The AI service declined this request.");
      if (response.stop_reason === "max_tokens") throw new AiError("truncated", "The AI response was cut off before it finished.", true);
      const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AiError("invalid_output", "The AI response was not in the expected format.", true);
      }
      const parsed = req.schema.safeParse(json);
      if (!parsed.success) throw new AiError("invalid_output", "The AI response was not in the expected format.", true);
      return { data: parsed.data, model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    } catch (err) {
      if (err instanceof AiError) throw err;
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
        throw new AiError("auth", "The AI service rejected the firm's credentials. A system administrator needs to check the API key.");
      if (err instanceof Anthropic.RateLimitError) throw new AiError("rate_limited", "The AI service is busy. Please try again in a few minutes.", true);
      if (err instanceof Anthropic.BadRequestError) throw new AiError("bad_request", "The AI service could not process this request.");
      if (err instanceof Anthropic.APIConnectionError) throw new AiError("unavailable", "The AI service could not be reached.", true);
      if (err instanceof Anthropic.APIError) throw new AiError("unavailable", "The AI service had a problem. Please try again.", (err.status ?? 500) >= 500);
      throw new AiError("invalid_output", "The AI response could not be read.", true);
    }
  }
}
