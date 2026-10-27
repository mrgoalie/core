/**
 * Relational data model for the Document Assistant.
 *
 * Skill inputs, document requirements and workflow configuration are stored as
 * validated, immutable JSON snapshots inside `skill_versions.config` (see
 * src/server/skills/config-schema.ts). Each version is a complete, self-contained
 * definition so that work already in progress keeps the exact version it began with.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// People, roles and sign-in sessions
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    jobTitle: text("job_title"),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    entraObjectId: text("entra_object_id"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedBy: uuid("suspended_by"),
    suspendedReason: text("suspended_reason"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(sql`lower(${t.email})`),
    uniqueIndex("users_entra_oid_unique").on(t.entraObjectId),
  ],
);

export const ROLES = ["EMPLOYEE", "ATTORNEY_REVIEWER", "FIRM_ADMIN", "SYSTEM_ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull(),
    grantedBy: uuid("granted_by"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    authMethod: text("auth_method", { enum: ["entra", "development"] }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("auth_sessions_token_unique").on(t.tokenHash), index("auth_sessions_user_idx").on(t.userId)],
);

/** Short-lived OpenID Connect request state (PKCE verifier, nonce) for Entra sign-in. */
export const authRequests = pgTable("auth_requests", {
  state: text("state").primaryKey(),
  codeVerifier: text("code_verifier").notNull(),
  nonce: text("nonce").notNull(),
  returnTo: text("return_to"),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------------------
// Skills, versions and permissions
// ---------------------------------------------------------------------------

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    /** Emergency per-skill switch. A disabled skill is hidden and blocked for everyone. */
    enabled: boolean("enabled").notNull().default(true),
    publishedVersionId: uuid("published_version_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by"),
    isBuiltIn: boolean("is_built_in").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("skills_slug_unique").on(t.slug)],
);

export const SKILL_VERSION_STATUSES = ["draft", "testing", "approved", "published", "archived"] as const;
export type SkillVersionStatus = (typeof SKILL_VERSION_STATUSES)[number];

export const skillVersions = pgTable(
  "skill_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    status: text("status", { enum: SKILL_VERSION_STATUSES }).notNull().default("draft"),
    config: jsonb("config").notNull(),
    changeSummary: text("change_summary"),
    /** "significant" changes affect legal drafting and require testing plus attorney approval. */
    significance: text("significance", { enum: ["initial", "cosmetic", "significant"] }).notNull(),
    changedFields: jsonb("changed_fields").$type<string[]>().notNull().default([]),
    authorId: uuid("author_id"),
    testStatus: text("test_status", { enum: ["not_tested", "passed", "failed"] }).notNull().default("not_tested"),
    testNotes: text("test_notes"),
    testedBy: uuid("tested_by"),
    testedAt: timestamp("tested_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNotes: text("approval_notes"),
    publishedBy: uuid("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    restoredFromVersionId: uuid("restored_from_version_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("skill_versions_number_unique").on(t.skillId, t.versionNumber)],
);

export const userSkillPermissions = pgTable(
  "user_skill_permissions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.skillId] })],
);

// ---------------------------------------------------------------------------
// Templates and interface configuration
// ---------------------------------------------------------------------------

export const documentTemplates = pgTable("document_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  purpose: text("purpose", { enum: ["letter", "general", "package_cover"] }).notNull(),
  isDemonstration: boolean("is_demonstration").notNull().default(false),
  storageKey: text("storage_key").notNull(),
  fileName: text("file_name").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  placeholders: jsonb("placeholders").$type<string[]>().notNull().default([]),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  replacesTemplateId: uuid("replaces_template_id"),
  uploadedBy: uuid("uploaded_by"),
  createdAt: createdAt(),
});

export const uiConfigVersions = pgTable(
  "ui_config_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionNumber: integer("version_number").notNull(),
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull(),
    config: jsonb("config").notNull(),
    note: text("note"),
    createdBy: uuid("created_by"),
    publishedBy: uuid("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    restoredFromVersionId: uuid("restored_from_version_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("ui_config_version_unique").on(t.versionNumber)],
);

export const brandingAssets = pgTable("branding_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: ["logo"] }).notNull(),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  uploadedBy: uuid("uploaded_by"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Matters, work sessions, documents and review
// ---------------------------------------------------------------------------

/** A minimal pointer to a matter in the case-management system. No case facts are copied here. */
export const matterRefs = pgTable(
  "matter_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider", { enum: ["mock", "clio"] }).notNull(),
    externalId: text("external_id").notNull(),
    displayNumber: text("display_number").notNull(),
    description: text("description").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("matter_refs_external_unique").on(t.provider, t.externalId)],
);

export const WORK_STATUSES = [
  "in_progress",
  "ready",
  "submitted",
  "changes_requested",
  "approved",
  "archived",
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const workSessions = pgTable(
  "work_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id),
    /** Pinned skill version. Work keeps this version unless explicitly migrated. */
    skillVersionId: uuid("skill_version_id")
      .notNull()
      .references(() => skillVersions.id),
    matterRefId: uuid("matter_ref_id").references(() => matterRefs.id),
    status: text("status", { enum: WORK_STATUSES }).notNull().default("in_progress"),
    isTest: boolean("is_test").notNull().default(false),
    title: text("title").notNull(),
    currentStep: integer("current_step").notNull().default(1),
    data: jsonb("data").notNull().default({}),
    revision: integer("revision").notNull().default(0),
    reviewerId: uuid("reviewer_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("work_sessions_user_idx").on(t.userId, t.updatedAt), index("work_sessions_status_idx").on(t.status)],
);

export const uploadedFiles = pgTable("uploaded_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  workSessionId: uuid("work_session_id").references(() => workSessions.id, { onDelete: "set null" }),
  storageKey: text("storage_key").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  scanStatus: text("scan_status", { enum: ["clean", "rejected"] }).notNull(),
  scanDetail: text("scan_detail"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessionDocuments = pgTable(
  "session_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workSessionId: uuid("work_session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "cascade" }),
    origin: text("origin", { enum: ["matter", "upload"] }).notNull(),
    externalId: text("external_id"),
    uploadId: uuid("upload_id").references(() => uploadedFiles.id),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes"),
    category: text("category"),
    requirementId: text("requirement_id"),
    selected: boolean("selected").notNull().default(false),
    exhibitOrder: integer("exhibit_order"),
    pageCount: integer("page_count"),
    extractStatus: text("extract_status", { enum: ["pending", "done", "failed", "no_text"] })
      .notNull()
      .default("pending"),
    extractTextKey: text("extract_text_key"),
    extractError: text("extract_error"),
    addedBy: uuid("added_by"),
    createdAt: createdAt(),
  },
  (t) => [index("session_documents_session_idx").on(t.workSessionId)],
);

export const generatedDocuments = pgTable(
  "generated_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workSessionId: uuid("work_session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    kind: text("kind", { enum: ["work_product", "package", "exhibit_index", "cover_letter"] }).notNull(),
    format: text("format", { enum: ["docx", "pdf"] }).notNull(),
    isFinal: boolean("is_final").notNull().default(false),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    pageCount: integer("page_count"),
    renderMethod: text("render_method"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("generated_documents_session_idx").on(t.workSessionId, t.revision)],
);

export const sourceReferences = pgTable(
  "source_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workSessionId: uuid("work_session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    factKey: text("fact_key").notNull(),
    label: text("label").notNull(),
    value: text("value"),
    sourceType: text("source_type", {
      enum: ["document", "matter_record", "employee", "calculated", "ai_interpretation"],
    }).notNull(),
    verification: text("verification", {
      enum: ["verified_in_document", "unverified", "employee_statement", "matter_record", "calculated"],
    }).notNull(),
    sessionDocumentId: uuid("session_document_id"),
    fileName: text("file_name"),
    page: integer("page"),
    excerpt: text("excerpt"),
    createdAt: createdAt(),
  },
  (t) => [index("source_refs_session_idx").on(t.workSessionId, t.revision)],
);

export const approvalRecords = pgTable(
  "approval_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workSessionId: uuid("work_session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    action: text("action", { enum: ["submitted", "withdrawn", "approved", "changes_requested"] }).notNull(),
    actorId: uuid("actor_id").notNull(),
    comments: text("comments"),
    documentHashes: jsonb("document_hashes").$type<Record<string, string>>(),
    createdAt: createdAt(),
  },
  (t) => [index("approval_records_session_idx").on(t.workSessionId)],
);

// ---------------------------------------------------------------------------
// Operations: audit, AI usage, background jobs, settings, integrations
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid("actor_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    outcome: text("outcome", { enum: ["success", "denied", "failure"] }).notNull().default("success"),
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** Metadata only. Never store document contents or case facts here. */
    details: jsonb("details").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [index("audit_logs_at_idx").on(t.at), index("audit_logs_actor_idx").on(t.actorId, t.at)],
);

export const aiExecutions = pgTable(
  "ai_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workSessionId: uuid("work_session_id"),
    userId: uuid("user_id"),
    skillVersionId: uuid("skill_version_id"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    task: text("task").notNull(),
    promptVersion: text("prompt_version").notNull(),
    status: text("status", { enum: ["success", "error", "invalid_output", "blocked"] }).notNull(),
    errorCode: text("error_code"),
    attempt: integer("attempt").notNull().default(1),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("ai_executions_at_idx").on(t.createdAt), index("ai_executions_user_idx").on(t.userId, t.createdAt)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed"] }).notNull().default("queued"),
    progress: text("progress"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(2),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    workSessionId: uuid("work_session_id"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_queue_idx").on(t.status, t.runAfter), index("jobs_session_idx").on(t.workSessionId)],
);

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: updatedAt(),
});

/** Per-employee Clio OAuth tokens (encrypted). Each employee's own Clio permissions apply. */
export const clioConnections = pgTable("clio_connections", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  clioUserId: text("clio_user_id"),
  connectedAt: createdAt(),
});
