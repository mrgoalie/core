CREATE TABLE "ai_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_session_id" uuid,
	"user_id" uuid,
	"skill_version_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"task" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_session_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"comments" text,
	"document_hashes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"outcome" text DEFAULT 'success' NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "auth_requests" (
	"state" text PRIMARY KEY NOT NULL,
	"code_verifier" text NOT NULL,
	"nonce" text NOT NULL,
	"return_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"auth_method" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branding_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clio_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"clio_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"purpose" text NOT NULL,
	"is_demonstration" boolean DEFAULT false NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"placeholders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"replaces_template_id" uuid,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_session_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"format" text NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"page_count" integer,
	"render_method" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 2 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"result" jsonb,
	"work_session_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matter_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"display_number" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_session_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"external_id" text,
	"upload_id" uuid,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer,
	"category" text,
	"requirement_id" text,
	"selected" boolean DEFAULT false NOT NULL,
	"exhibit_order" integer,
	"page_count" integer,
	"extract_status" text DEFAULT 'pending' NOT NULL,
	"extract_text_key" text,
	"extract_error" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"config" jsonb NOT NULL,
	"change_summary" text,
	"significance" text NOT NULL,
	"changed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author_id" uuid,
	"test_status" text DEFAULT 'not_tested' NOT NULL,
	"test_notes" text,
	"tested_by" uuid,
	"tested_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_notes" text,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"restored_from_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"published_version_id" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_session_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"fact_key" text NOT NULL,
	"label" text NOT NULL,
	"value" text,
	"source_type" text NOT NULL,
	"verification" text NOT NULL,
	"session_document_id" uuid,
	"file_name" text,
	"page" integer,
	"excerpt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ui_config_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_number" integer NOT NULL,
	"status" text NOT NULL,
	"config" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"restored_from_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploaded_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"work_session_id" uuid,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"scan_status" text NOT NULL,
	"scan_detail" text,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "user_skill_permissions" (
	"user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_skill_permissions_user_id_skill_id_pk" PRIMARY KEY("user_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"job_title" text,
	"status" text DEFAULT 'active' NOT NULL,
	"entra_object_id" text,
	"last_login_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"suspended_by" uuid,
	"suspended_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"matter_ref_id" uuid,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"title" text NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"reviewer_id" uuid,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clio_connections" ADD CONSTRAINT "clio_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_documents" ADD CONSTRAINT "session_documents_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_documents" ADD CONSTRAINT "session_documents_upload_id_uploaded_files_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploaded_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_files_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skill_permissions" ADD CONSTRAINT "user_skill_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skill_permissions" ADD CONSTRAINT "user_skill_permissions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_skill_version_id_skill_versions_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_matter_ref_id_matter_refs_id_fk" FOREIGN KEY ("matter_ref_id") REFERENCES "public"."matter_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_executions_at_idx" ON "ai_executions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_executions_user_idx" ON "ai_executions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_records_session_idx" ON "approval_records" USING btree ("work_session_id");--> statement-breakpoint
CREATE INDEX "audit_logs_at_idx" ON "audit_logs" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_unique" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "generated_documents_session_idx" ON "generated_documents" USING btree ("work_session_id","revision");--> statement-breakpoint
CREATE INDEX "jobs_queue_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_session_idx" ON "jobs" USING btree ("work_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matter_refs_external_unique" ON "matter_refs" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "session_documents_session_idx" ON "session_documents" USING btree ("work_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_number_unique" ON "skill_versions" USING btree ("skill_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_slug_unique" ON "skills" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "source_refs_session_idx" ON "source_references" USING btree ("work_session_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "ui_config_version_unique" ON "ui_config_versions" USING btree ("version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_entra_oid_unique" ON "users" USING btree ("entra_object_id");--> statement-breakpoint
CREATE INDEX "work_sessions_user_idx" ON "work_sessions" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "work_sessions_status_idx" ON "work_sessions" USING btree ("status");