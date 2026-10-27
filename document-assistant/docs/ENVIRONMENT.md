# Configuration settings

The application reads these settings when it starts. On a computer they go in a file named
`.env.local` (copy [.env.example](../.env.example)). In Azure they are the App Service
**Application settings**; anything secret is a **Key Vault reference**, never typed in as plain
text (the Azure template sets this up — see [DEPLOYMENT-AZURE.md](DEPLOYMENT-AZURE.md)).

Most day-to-day choices (AI provider, limits, retention, Clio field mapping, branding, skills) are
**not** here — they are changed in **Administration** without restarting anything.

When `APP_ENV` is `staging` or `production`, the app **refuses to start** if a setting would be
unsafe, and lists every problem. It checks that: `AUTH_MODE` is `entra`; the three Entra settings
are filled in; `STORAGE_ENCRYPTION_KEY` is set; `APP_BASE_URL` starts with `https://`; and
`DATABASE_URL` is a real PostgreSQL server (not the built-in development database).

## General

| Setting | Default | Secret? | What it does |
| --- | --- | --- | --- |
| `APP_ENV` | `development` | | `development`, `test`, `staging` or `production`. Staging and production turn on the safety checks above and turn off the fictional sign-in. |
| `APP_BASE_URL` | `http://localhost:3000` | | The address people type, e.g. `https://ai.windycitylawfirm.com`. Used for sign-in return addresses and security checks. Cookies are marked secure when this starts with `https://`. |
| `PORT` | `8080` in the container | | Port the web server listens on (used by `npm run start:production`). |
| `TRUST_PROXY_HEADERS` | `false` | | Set `true` behind Azure App Service / Front Door so the client's real IP address is recorded in the activity log and used to rate-limit requests made before sign-in. |
| `JOB_WORKER` | `true` | | Runs the background worker (reading documents, drafting, building packages, nightly clean-up) inside the web app. Leave on. |
| `SEED_DEMO_DATA` | `true` (but **off** when `APP_ENV=production` unless set) | | Creates the fictional employees and cases. Must be `false` for real use. |

## Database

| Setting | Default | Secret? | What it does |
| --- | --- | --- | --- |
| `DATABASE_URL` | `pglite:./data/pglite` | **Yes** (contains a password) | `pglite:<folder>` = built-in database for development and tests only. Production: `postgres://USER:PASSWORD@SERVER.postgres.database.azure.com:5432/docassist?sslmode=require`. Database changes (migrations) are applied automatically at start-up by `npm run start:production`. |

## Sign-in (Microsoft Entra ID)

See [ENTRA-SETUP.md](ENTRA-SETUP.md).

| Setting | Default | Secret? | What it does |
| --- | --- | --- | --- |
| `AUTH_MODE` | `development` | | `development` = pick a fictional employee (refused in staging/production). `entra` = Microsoft 365 sign-in. |
| `ENTRA_TENANT_ID` | — | | The firm's Microsoft 365 tenant (directory) ID. Only accounts in this tenant can sign in. |
| `ENTRA_CLIENT_ID` | — | | Application (client) ID of the app registration. |
| `ENTRA_CLIENT_SECRET` | — | **Yes** | Client secret of the app registration. |
| `ENTRA_REDIRECT_URI` | `${APP_BASE_URL}/api/auth/callback` | | Only set if the redirect address differs from the default. |
| `ENTRA_REQUIRE_MFA_CLAIM` | `false` | | When `true`, also refuses sign-ins whose Microsoft token does not say MFA was used. MFA itself should be enforced by a Conditional Access policy; this is an extra check. |
| `SESSION_IDLE_MINUTES` | `480` | | Signs a person out after this many minutes without activity (5–1440). |
| `SESSION_ABSOLUTE_HOURS` | `12` | | Signs a person out this many hours after sign-in, regardless of activity (1–72). |
| `BOOTSTRAP_ADMIN_EMAILS` | — | | Comma-separated work emails created with **all** roles on first start, so the owner can sign in and add everyone else. People who already exist are not changed. |

## File storage

| Setting | Default | Secret? | What it does |
| --- | --- | --- | --- |
| `STORAGE_DRIVER` | `local` | | `local` = encrypted files in a folder. `azure-blob` = Azure Storage, using the app's managed identity (no storage password). |
| `STORAGE_LOCAL_DIR` | `./data/storage` | | Folder for `local` storage. |
| `AZURE_STORAGE_ACCOUNT_URL` | — | | e.g. `https://fdadocs.blob.core.windows.net`. |
| `AZURE_STORAGE_CONTAINER` | `documents` | | Blob container name. |
| `STORAGE_ENCRYPTION_KEY` | — (in development a random key is created in `data/dev-encryption-key`; required in staging/production) | **Yes** | 32 random bytes, base64. Every stored file is encrypted with it (AES-256-GCM) in addition to Azure's own encryption. Create one with `npm run generate-key`. **Keep a secure backup — files cannot be read without it.** |
| `MAX_UPLOAD_MB` | `25` | | Largest file an employee can upload (1–200). |

## Case management (Clio)

See [CLIO-SETUP.md](CLIO-SETUP.md).

| Setting | Default | Secret? | What it does |
| --- | --- | --- | --- |
| `CASE_MANAGEMENT` | `mock` | | `mock` = fictional demonstration cases. `clio` = live Clio Manage (each employee connects their own Clio login). |
| `CLIO_BASE_URL` | `https://app.clio.com` | | The firm's Clio region (for example `https://eu.app.clio.com` or `https://ca.app.clio.com` outside the US). Confirm in Clio's developer documentation. |
| `CLIO_CLIENT_ID` | — | | App key of the firm's Clio developer application. |
| `CLIO_CLIENT_SECRET` | — | **Yes** | App secret of the Clio developer application. |
| `CLIO_REDIRECT_URI` | `${APP_BASE_URL}/api/clio/callback` | | Only set if different from the default. |

## AI provider

See [AI-PROVIDER-SETUP.md](AI-PROVIDER-SETUP.md). The provider itself is chosen in
**Administration → Settings**; these settings only hold credentials.

| Setting | Default | Secret? | What it does |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | **Yes** | API key for Anthropic Claude. Only ever used on the server. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | | Default model; can be changed in Settings. |
| `ANTHROPIC_FALLBACKS` | `true` | | Lets the provider retry a declined request on another Claude model on its side (Anthropic's server-side fallback feature). Set `false` to turn this off. |

## Upload screening and PDF creation

| Setting | Default | Secret? | What it does |
| --- | --- | --- | --- |
| `MALWARE_SCANNER` | `basic` | | `basic` = built-in checks (file type matches contents, test virus signature, PDF scripts/encryption, Word macros and outside links). `clamav` = also scan every file with a ClamAV antivirus server. |
| `CLAMAV_HOST` / `CLAMAV_PORT` | — / `3310` | | Address of the ClamAV server. |
| `PDF_CONVERTER` | `auto` | | `auto` = LibreOffice if installed, otherwise the built-in renderer. `libreoffice` or `direct` force one. The container image includes LibreOffice. |
| `SOFFICE_PATH` | `soffice` | | Path to LibreOffice. |

## Test-only

| Setting | Used by | What it does |
| --- | --- | --- |
| `TEST_DATABASE_URL` | `npm test` | When set to a PostgreSQL address, integration tests create and drop a throw-away database there instead of using the built-in one. |
