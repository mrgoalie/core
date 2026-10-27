import type { z } from "zod";

export type AiTaskName = "extract_document" | "draft_sections";
export type Effort = "low" | "medium" | "high" | "xhigh";

export interface AiRequest<T> {
  task: AiTaskName;
  promptVersion: string;
  system: string;
  prompt: string;
  /** The structured input the prompt was built from (used by the demonstration provider). */
  input: unknown;
  schema: z.ZodType<T>;
  maxTokens: number;
  effort: Effort;
}

export interface AiResponse<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  readonly id: "demo" | "anthropic";
  readonly label: string;
  /** True for the offline demonstration engine, which uses fixed rules rather than a language model. */
  readonly isDemonstration: boolean;
  generate<T>(req: AiRequest<T>): Promise<AiResponse<T>>;
}

export class AiError extends Error {
  constructor(
    public readonly code: "not_configured" | "refused" | "truncated" | "invalid_output" | "rate_limited" | "unavailable" | "bad_request" | "auth" | "blocked",
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

/** USD per million tokens [input, output]. Used for estimated cost tracking only. */
export const MODEL_PRICING: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-fable-5-1": [10, 50],
};

export function estimateCostMicroUsd(model: string, inputTokens: number, outputTokens: number) {
  const [i, o] = MODEL_PRICING[model] ?? [4, 20];
  return Math.round(inputTokens * i + outputTokens * o);
}
