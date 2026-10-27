import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "./db/client";
import { systemSettings } from "./db/schema";
import { MATTER_FIELD_KEYS } from "@/lib/matter-fields";

const GovernanceAck = z.object({
  dataRetention: z.literal(true),
  noTrainingOnData: z.literal(true),
  contractInPlace: z.literal(true),
  securityReviewed: z.literal(true),
  notes: z.string().max(1000).optional(),
  acknowledgedBy: z.string(),
  acknowledgedAt: z.string(),
});

export const SETTING_SCHEMAS = {
  generation: z
    .object({
      suspended: z.boolean().default(false),
      reason: z.string().max(500).default(""),
      changedBy: z.string().nullable().default(null),
      changedAt: z.string().nullable().default(null),
    })
    .default({ suspended: false, reason: "", changedBy: null, changedAt: null }),
  ai: z
    .object({
      provider: z.enum(["demo", "anthropic"]).default("demo"),
      model: z.string().max(100).default("claude-opus-5-5"),
      extractionEffort: z.enum(["low", "medium", "high"]).default("low"),
      draftingEffort: z.enum(["low", "medium", "high", "xhigh"]).default("medium"),
      maxRunsPerUserPerDay: z.number().int().min(1).max(10000).default(60),
      monthlyBudgetUsd: z.number().min(0).max(100000).default(250),
      governance: GovernanceAck.nullable().default(null),
    })
    .default({ provider: "demo", model: "claude-opus-5-5", extractionEffort: "low", draftingEffort: "medium", maxRunsPerUserPerDay: 60, monthlyBudgetUsd: 250, governance: null }),
  review: z.object({ allowSelfApproval: z.boolean().default(false) }).default({ allowSelfApproval: false }),
  retention: z
    .object({
      workingFileDays: z.number().int().min(1).max(3650).default(45),
      testRunDays: z.number().int().min(1).max(90).default(7),
    })
    .default({ workingFileDays: 45, testRunDays: 7 }),
  clio: z
    .object({
      /** Canonical field key -> name of the Clio custom field that holds it. */
      fieldMap: z.partialRecord(z.enum(MATTER_FIELD_KEYS), z.string().max(120)).default({}),
    })
    .default({ fieldMap: {} }),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

export async function getSetting<K extends SettingKey>(db: DB, key: K): Promise<SettingValue<K>> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
  const schema = SETTING_SCHEMAS[key];
  const parsed = schema.safeParse(row?.value ?? undefined);
  return (parsed.success ? parsed.data : schema.parse(undefined)) as SettingValue<K>;
}

export async function setSetting<K extends SettingKey>(db: DB, key: K, value: SettingValue<K>, actorId: string | null) {
  const v = SETTING_SCHEMAS[key].parse(value);
  await db
    .insert(systemSettings)
    .values({ key, value: v, updatedBy: actorId })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: v, updatedBy: actorId, updatedAt: new Date() } });
  return v as SettingValue<K>;
}
