import { z } from "zod";

const bool = (dflt: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? dflt : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const EnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("pglite:./data/pglite"),

  AUTH_MODE: z.enum(["development", "entra"]).default("development"),
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),
  ENTRA_REDIRECT_URI: z.string().url().optional(),
  ENTRA_REQUIRE_MFA_CLAIM: bool(false),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(480),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  BOOTSTRAP_ADMIN_EMAILS: z.string().optional(),

  STORAGE_DRIVER: z.enum(["local", "azure-blob"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./data/storage"),
  AZURE_STORAGE_ACCOUNT_URL: z.string().optional(),
  AZURE_STORAGE_CONTAINER: z.string().default("documents"),
  STORAGE_ENCRYPTION_KEY: z.string().optional(),

  CASE_MANAGEMENT: z.enum(["mock", "clio"]).default("mock"),
  CLIO_BASE_URL: z.string().url().default("https://app.clio.com"),
  CLIO_CLIENT_ID: z.string().optional(),
  CLIO_CLIENT_SECRET: z.string().optional(),
  CLIO_REDIRECT_URI: z.string().url().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  ANTHROPIC_FALLBACKS: bool(true),

  MALWARE_SCANNER: z.enum(["basic", "clamav"]).default("basic"),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().default(3310),

  PDF_CONVERTER: z.enum(["auto", "libreoffice", "direct"]).default("auto"),
  SOFFICE_PATH: z.string().default("soffice"),

  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(200).default(25),
  SEED_DEMO_DATA: bool(true),
  JOB_WORKER: bool(true),
  TRUST_PROXY_HEADERS: bool(false),
});

export type AppConfig = z.infer<typeof EnvSchema> & { isProduction: boolean; secureCookies: boolean };

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  const env = parsed.data;
  const isProduction = env.APP_ENV === "production" || env.APP_ENV === "staging";
  const config: AppConfig = {
    ...env,
    isProduction,
    secureCookies: env.APP_BASE_URL.startsWith("https://"),
  };
  assertSafeConfig(config);
  cached = config;
  return config;
}

/** Refuse to start with configurations that would be unsafe for real client data. */
export function assertSafeConfig(c: AppConfig) {
  if (!c.isProduction) return;
  const problems: string[] = [];
  if (c.AUTH_MODE !== "entra") problems.push("AUTH_MODE must be 'entra' outside development");
  if (!c.ENTRA_TENANT_ID || !c.ENTRA_CLIENT_ID || !c.ENTRA_CLIENT_SECRET) problems.push("Entra ID settings are incomplete");
  if (!c.STORAGE_ENCRYPTION_KEY) problems.push("STORAGE_ENCRYPTION_KEY is required");
  if (!c.APP_BASE_URL.startsWith("https://")) problems.push("APP_BASE_URL must use https");
  if (c.DATABASE_URL.startsWith("pglite:")) problems.push("Use a managed PostgreSQL DATABASE_URL in production");
  if (problems.length) throw new Error(`Unsafe production configuration: ${problems.join("; ")}`);
}

export function resetConfigForTests() {
  cached = null;
}
