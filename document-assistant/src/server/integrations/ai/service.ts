import { and, eq, gte, sql } from "drizzle-orm";
import { getConfig } from "../../config";
import type { DB } from "../../db/client";
import { aiExecutions } from "../../db/schema";
import { AppError } from "../../errors";
import { getSetting } from "../../settings";
import { AnthropicProvider } from "./anthropic";
import { DemoProvider } from "./demo";
import { AiError, estimateCostMicroUsd, type AiProvider, type AiRequest } from "./types";

const demo = new DemoProvider();
let override: AiProvider | null = null;

/** Test hook: substitute a provider (for example one that fails) without touching configuration. */
export function setAiProviderForTesting(p: AiProvider | null) {
  override = p;
}

export async function resolveProvider(db: DB): Promise<AiProvider> {
  if (override) return override;
  const settings = await getSetting(db, "ai");
  if (settings.provider === "demo") return demo;
  const config = getConfig();
  if (!config.ANTHROPIC_API_KEY) throw new AiError("not_configured", "The AI provider has not been configured yet. A system administrator needs to add the API key.");
  if (!settings.governance)
    throw new AiError("blocked", "The AI provider has not been approved for client information yet. A system administrator must complete the data-governance review in Settings.");
  return new AnthropicProvider(config.ANTHROPIC_API_KEY, settings.model || config.ANTHROPIC_MODEL, config.ANTHROPIC_FALLBACKS);
}

export async function describeProvider(db: DB) {
  const settings = await getSetting(db, "ai");
  const config = getConfig();
  return {
    selected: settings.provider,
    model: settings.provider === "demo" ? "demonstration-rules-v1" : settings.model,
    isDemonstration: settings.provider === "demo",
    anthropicKeyPresent: Boolean(config.ANTHROPIC_API_KEY),
    governanceComplete: Boolean(settings.governance),
  };
}

interface RunContext {
  userId: string | null;
  workSessionId?: string | null;
  skillVersionId?: string | null;
}

const MAX_ATTEMPTS = 2;

/**
 * Runs one AI task: enforces usage limits, calls the provider, validates the output against its
 * schema, retries a limited number of times, and records metadata (never content) for each attempt.
 */
export async function runAiTask<T>(db: DB, req: AiRequest<T>, ctx: RunContext): Promise<{ data: T; provider: AiProvider; model: string }> {
  const provider = await resolveProvider(db);
  const settings = await getSetting(db, "ai");

  if (!provider.isDemonstration && ctx.userId) {
    const since = new Date(Date.now() - 24 * 3600_000);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiExecutions)
      .where(and(eq(aiExecutions.userId, ctx.userId), gte(aiExecutions.createdAt, since)));
    if (count >= settings.maxRunsPerUserPerDay)
      throw new AppError(429, "ai_daily_limit", "You've reached today's limit for AI drafting. Please try again tomorrow or ask an administrator.");
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [{ spend }] = await db
      .select({ spend: sql<number>`coalesce(sum(${aiExecutions.costMicroUsd}), 0)::bigint` })
      .from(aiExecutions)
      .where(gte(aiExecutions.createdAt, monthStart));
    if (Number(spend) / 1_000_000 >= settings.monthlyBudgetUsd)
      throw new AppError(429, "ai_budget", "The firm's monthly AI budget has been reached. A system administrator can raise it in Settings.");
  }

  let lastError: AiError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    try {
      const res = await provider.generate(req);
      const data = req.schema.parse(res.data);
      await db.insert(aiExecutions).values({
        workSessionId: ctx.workSessionId ?? null,
        userId: ctx.userId,
        skillVersionId: ctx.skillVersionId ?? null,
        provider: provider.id,
        model: res.model,
        task: req.task,
        promptVersion: req.promptVersion,
        status: "success",
        attempt,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        costMicroUsd: estimateCostMicroUsd(res.model, res.inputTokens, res.outputTokens),
        durationMs: Date.now() - started,
      });
      return { data, provider, model: res.model };
    } catch (err) {
      lastError = err instanceof AiError ? err : new AiError("invalid_output", "The AI response was not in the expected format.", true);
      await db.insert(aiExecutions).values({
        workSessionId: ctx.workSessionId ?? null,
        userId: ctx.userId,
        skillVersionId: ctx.skillVersionId ?? null,
        provider: provider.id,
        model: settings.model,
        task: req.task,
        promptVersion: req.promptVersion,
        status: lastError.code === "invalid_output" ? "invalid_output" : lastError.code === "blocked" ? "blocked" : "error",
        errorCode: lastError.code,
        attempt,
        durationMs: Date.now() - started,
      });
      if (!lastError.retryable) break;
    }
  }
  throw lastError ?? new AiError("unavailable", "The AI service is unavailable.");
}
