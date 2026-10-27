# Architecture (for developers)

A single TypeScript web application (a "modular monolith"): one Next.js app serves the pages, the
JSON API and a background job worker, backed by PostgreSQL and encrypted file storage. Outside
services (Entra ID, Clio, the AI provider) sit behind small adapters.

```
 Browser (React pages, no secrets)
    │  HTTPS, session cookie, Origin / X-Requested-With check
    ▼
 Next.js app ─────────────────────────────────────────────────────────────┐
 │ src/proxy.ts        CSP nonce per request                               │
 │ src/app/**/page.tsx Server-rendered pages; requirePageActor() per page   │
 │ src/app/api/**      Route handlers → apiRoute(): session, role, CSRF,   │
 │                     rate limit, error → plain-English JSON             │
 │ src/server/services Business rules (work, skills, review, users, ui…)  │
 │ src/server/generation  Skill engine: prefill → analyze → facts →       │
 │                     calculations → draft → checks → render             │
 │ src/server/documents   Intake screening, text extraction, OOXML,       │
 │                     templates, PDF (LibreOffice / pdf-lib), packages   │
 │ src/server/jobs     Durable DB job queue + in-process worker           │
 │ src/server/integrations/  ai/ (demo, anthropic)  clio/ (mock, live)    │
 │ src/server/auth     Entra (MSAL), sessions, permissions                │
 └───────┬──────────────────────┬─────────────────────┬───────────────────┘
         ▼                      ▼                     ▼
   PostgreSQL (Drizzle)   Encrypted storage       Entra ID · Clio · AI provider
   PGlite in dev/tests    local FS / Azure Blob   (server-side only)
```

## Technology

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript 6 |
| Validation | Zod 4 — every API input, skill configuration, UI configuration and AI output |
| Database | PostgreSQL via Drizzle ORM; PGlite (embedded PostgreSQL) for development and tests; migrations in `drizzle/` |
| Sign-in | `@azure/msal-node` (auth code + PKCE) |
| Word | `docxtemplater` + `pizzip` (fill the firm's template), generated OOXML for the body; `docx` for the demonstration template; `mammoth` to read .docx |
| PDF | LibreOffice headless (exact template rendering) or a built-in `pdf-lib` composer; `unpdf` for text extraction |
| Money | `decimal.js` — no floating-point arithmetic on amounts |
| Storage | AES-256-GCM in the app over local files or Azure Blob (`@azure/storage-blob`, `@azure/identity`) |
| AI | `@anthropic-ai/sdk` with structured outputs (Zod) |
| Tests | Vitest (unit + integration), Playwright + axe-core (browser, accessibility) |

## Request handling

- **Pages** (`src/app/(app)/…`) call `requirePageActor()`; unauthenticated users go to `/login`.
  Administrative pages also check roles on the server.
- **API routes** are wrapped in `apiRoute(options, handler)` (`src/server/http.ts`), which:
  resolves the session from the cookie (sha-256 hash lookup), enforces idle/absolute expiry,
  checks roles, rejects cross-site writes, applies the rate limit, parses input with Zod, and turns
  `AppError`s into `{ error: { code, message } }` with friendly messages. Denials are audited.
- **Services** (`src/server/services/*`) re-check permissions themselves (defence in depth), so
  they are safe to call from tests, jobs or scripts.
- Someone else's work, an unassigned skill or an inaccessible matter answers **404**, never 403,
  so existence isn't revealed.

## Data model (22 tables)

| Area | Tables |
| --- | --- |
| People and access | `users`, `user_roles`, `auth_sessions`, `auth_requests`, `user_skill_permissions`, `clio_connections` |
| Skills | `skills`, `skill_versions` (full configuration as JSON + status + test/approval records), `document_templates` |
| Interface | `ui_config_versions` (draft/published/archived), `branding_assets` |
| Work | `matter_refs` (reference only — Clio is the record), `work_sessions` (answers, provenance, generation result), `uploaded_files`, `session_documents`, `generated_documents`, `source_references`, `approval_records` |
| Operations | `audit_logs`, `ai_executions` (metadata only), `jobs`, `system_settings` |

Skill version statuses: `draft → testing → approved → published → archived`. Work statuses:
`in_progress → ready → submitted → (changes_requested | approved) → archived`.

## Skills are configuration, not code

A skill version's configuration (`SkillConfig` in `src/lib/skill-config.ts`) describes:

- **inputs** — questions (text, number, currency, date, yes/no, select, checkboxes, table, file,
  matter field), each optionally **prefilled** from a matter field or an extracted fact, with
  `showWhen` conditions;
- **documents** — required/optional document types, each with an **analyzer** (incident report,
  medical records, medical bills, wage loss, insurance, summary, or none) and `appliesWhen`;
- **calculations** — sum a table column, add, subtract, percent-of, multiply, divide, min, max,
  over inputs, other calculations, matter fields or constants (`src/lib/calculations.ts`);
- **drafting sections** — `ai` (drafted from verified facts) or `fixed` (the firm's own wording with
  `{{placeholders}}`), optionally attaching tables or calculations;
- **output** — letter or report style, formats (docx, pdf, pdf_package, screen_report), template,
  exhibit-package options;
- **notices** shown to employees, and **approval** (always `ATTORNEY_REVIEWER`; the type system and
  the server both refuse anything else).

`diffConfigs()` classifies a change as *cosmetic* (name, short description, employee
instructions, icon, category) or *significant*. Significant changes require a passing test run
**and** attorney approval before `publishVersion()` will accept them. Restoring copies an old
configuration into a new version. The two built-in skills are in `src/server/skills/builtin.ts`.

## The generation pipeline

All long steps run as **jobs** (`src/server/jobs/queue.ts`): rows in `jobs`, claimed atomically,
retried with back-off, recovered after a restart (`recoverStaleJobs`), polled by the page.

1. **Prefill** (`generation/prefill.ts`) — matter fields and earlier answers, each with provenance
   (`matter`, `document`, `edited`, `default`).
2. **Analyze** (`generation/analyze.ts`) — for each document: screen, extract text per page
   (`documents/extract.ts`), call the AI task `extract_document` with the page text fenced as
   untrusted data; output must match `ExtractionOutput`. Every fact carries a page and a quote.
3. **Facts and checks** (`generation/facts.ts`, `checks.ts`) — the quote must appear on that page
   (`verified` / `not_found`), the value must be supported by the quote, providers in records vs
   bills are matched (missing bill → flag), Clio vs document conflicts are flagged.
4. **Calculations** — deterministic, `decimal.js`, half-up rounding to cents.
5. **Draft** (`generation/generate.ts`) — `ai` sections via the AI task `draft_sections`
   (`DraftOutput`), `fixed` sections by placeholder substitution. Every drafted amount, date and
   legal citation is checked against the case information; unknown ones are flagged.
6. **Render** (`generation/model.ts` → block model) — the same blocks become OOXML injected at
   `{{@body}}` in the Word template, a PDF (LibreOffice or pdf-lib) with a DRAFT watermark, and the
   on-screen preview. Arbitration packages (`documents/package.ts`) add a cover sheet, index, slip
   sheets, exhibit labels, Bates and page numbers, and bookmarks.
7. **Final** — after approval, the identical content is rendered without draft markings.

Employee edits to section wording are kept on re-render and marked as edited.

## AI layer

`src/server/integrations/ai/`: `AiProvider` interface (`types.ts`), `DemoProvider` (fixed rules,
offline), `AnthropicProvider` (structured outputs via `betaZodOutputFormat`, effort setting,
optional server-side fallbacks; refusals and truncation become typed `AiError`s). `runAiTask()`
(`service.ts`) resolves the provider from settings, enforces the governance gate, per-user daily
limit and monthly budget, validates output, retries retryable errors once, and records
`ai_executions` metadata. Prompts and their versions are in `prompts.ts`.

## Clio layer

`src/server/integrations/clio/`: `CaseManagementAdapter` (`types.ts`); `MockCaseAdapter` with
fictional matters/documents (`mock-data.ts`); `ClioAdapter` (live, **unverified**) using each
employee's own OAuth token, encrypted in `clio_connections`. Administrator test runs always use a
sample-only adapter (`getCaseAdapter({ testMode: true })`).

## Storage

`src/server/storage/index.ts`: `EncryptedStorage` wraps a backend (`LocalBackend`,
`AzureBlobBackend`, `MemoryBackend` for tests). Files are written as `FDA1 | iv | tag | ciphertext`
(AES-256-GCM). Keys are random paths; names and metadata live in the database.

## Configuration and settings

- Environment (`src/server/config.ts`): validated at start-up; unsafe production configurations
  refuse to start. See [ENVIRONMENT.md](ENVIRONMENT.md).
- Runtime settings (`src/server/settings.ts`): stored in `system_settings`, validated by Zod,
  changed in Administration without a restart.
- Interface (`src/lib/ui-config.ts`): versioned JSON; the accent colour must reach WCAG contrast 4.5:1 against white text or it is refused;
  applied as CSS variables.

## Start-up

`npm run start:production` → `scripts/migrate.ts` (migrations + baseline: built-in skills,
demonstration template, default interface, bootstrap administrators) → `next start`.
`src/instrumentation.ts` → `src/server/boot.ts` recovers interrupted jobs and starts the worker
(with retention clean-up every 6 hours). Outside production, `getDb()` migrates automatically.

## Tests

| Suite | Where | What |
| --- | --- | --- |
| Unit | `tests/unit` | calculations, skill configuration and diffing, interface guardrails, deterministic checks, upload screening and encryption, prompt fencing, Anthropic adapter against mocked HTTP, rate limiter |
| Integration | `tests/integration` | full demand-letter and arbitration workflows, skill lifecycle, access control (services and route handlers), interface publishing, robustness (failures, retries, restarts, uploads, settings), Clio adapter against mocked HTTP, retention |
| Browser | `tests/e2e` | the three acceptance demonstrations, accessibility (axe, keyboard, small screens), security headers — against a production build with a fresh database |

Integration tests use a fresh PGlite database per file; set `TEST_DATABASE_URL` to run them on a
real PostgreSQL server.

## Extending

- **New question type / analyzer / calculation** — add it to the Zod schema in
  `src/lib/skill-config.ts` (and `src/lib/matter-fields.ts` for analyzers), implement it in
  `src/server/generation/`, expose it in `src/components/admin/SkillEditor.tsx`, add tests.
- **New AI provider** — see [AI-PROVIDER-SETUP.md](AI-PROVIDER-SETUP.md#adding-another-provider-later).
- **Database change** — edit `src/server/db/schema.ts`, run `npm run db:generate`, commit the new
  migration in `drizzle/`.
- Keep the rules: authorization on the server, deterministic arithmetic, no document content in
  logs, attorney approval not configurable away, fictional data only in development.
