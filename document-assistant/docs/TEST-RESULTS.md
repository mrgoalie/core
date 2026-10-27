# Test results

These are the results of tests that were **actually run**, on 27 October 2026, on the final code in
this repository. All data used was fictional.

**Environment:** Linux container, Node.js 22.22.0, Chromium (Playwright 1.63.0), LibreOffice
installed, PostgreSQL 16.15 for the real-database run. Not tested here: anything needing the firm's
Microsoft 365, Clio, AI provider or Azure accounts (see [STATUS.md](STATUS.md)).

## Summary

| Check | Command | Result |
| --- | --- | --- |
| TypeScript type check | `npm run typecheck` | ✅ 0 errors |
| Unit and integration tests (built-in database) | `npm test` | ✅ **86 passed**, 0 failed (16 files) |
| Integration tests on a real PostgreSQL 16 server | `TEST_DATABASE_URL=… npx vitest run tests/integration` | ✅ **51 passed**, 0 failed (8 files) |
| Workflow tests with the built-in PDF renderer instead of LibreOffice | `PDF_CONVERTER=direct npx vitest run tests/integration/demand-letter.test.ts tests/integration/arbitration.test.ts` | ✅ 7 passed |
| Production build | `next build` (part of `npm run test:e2e`) | ✅ succeeded, 0 warnings |
| Browser acceptance tests on the production build | `npm run test:e2e` | ✅ **8 passed**, 0 failed (1.4 minutes) |

The browser tests had also passed in two complete earlier runs during development; tests that
failed during development exposed real problems, which were fixed (see "Problems found by testing").

## The three acceptance demonstrations (browser, real application)

Each runs in a real Chromium browser against the production build with a brand-new database.

### Employee demonstration — ✅ passed (9.0 s)

`tests/e2e/01-employee-demand-letter.spec.ts`

1. Maria Lopez signs in (development sign-in) and sees exactly the two skills assigned to Maria.
2. Selects **Write a Demand Letter**; the restricted Hartley matter is not listed; opens the
   fictional Thompson matter.
3. Has the documents read; the incident date is filled in with its source ("Traffic Crash Report,
   p. 1 ✓").
4. Creates the draft and downloads an actual **Word document** (opened and checked: addressee,
   "Total economic damages", DRAFT header) and a PDF (valid PDF file).
5. The draft flags the **missing demand amount**, the **missing orthopedic bill** and the
   **accident-date conflict** (Clio: 15 March 2025; police report: 14 March 2025). Economic damages
   shown: **$15,849.00** (medical $13,077.00 + lost wages $2,772.00, calculated by the software).
6. Sends the draft for attorney review; My Work shows "Waiting for attorney review".

Also: **Daniel Kim sees only the one skill assigned to Daniel**, and is refused (403) when calling an
administrator function directly — ✅ passed.


### Arbitration demonstration — ✅ passed (7.2 s)

`tests/e2e/02-arbitration.spec.ts`

1. Maria selects **Create an Arbitration Package** and opens the fictional Rivera UM matter.
2. Supporting exhibits are pre-selected; Maria moves the crash report to the top of the order.
3. Generates an actual **PDF package** (downloaded: one PDF of more than 15 pages) with the exhibit
   index in the chosen order.
4. The missing requirement (notice-of-claim correspondence) is flagged, and the exhibit
   requirements are labeled DEMONSTRATION settings.
5. Sends it for approval; Rachel Patel (attorney) approves it; the final package file is marked
   FINAL. (The cover sheet, the exhibit-index page, Bates numbers such as FLG-000001 and the PDF
   bookmarks are checked inside the file by the arbitration integration test.)

### Administrator demonstration — ✅ passed (20.2 s)

`tests/e2e/03-administrator.spec.ts` — Jordan Ellis (Firm Administrator and Attorney Reviewer):

1. **Creates a new skill without programming** — *Prepare Settlement Disbursement*, with two
   questions and two calculations, using only the guided form.
2. **Tests it** with the fictional sample matter: $100,000 at 33.33% → net to client **$66,670.00**.
3. Records the test, gives attorney approval and **publishes** version 1.
4. **Grants it to Daniel Kim**; Daniel's home screen then shows two skills.
5. **Edits** the instructions, re-tests ($90,000 → **$60,003.00**), approves and **republishes** (v2).
6. **Restores version 1** (published as v3, "Restored version 1").
7. **Changes the home screen**: renames *Write a Demand Letter* to *Prepare Insurance Demand*,
   changes its icon, moves the new skill to the top, changes the welcome heading, previews it as
   Daniel — and confirms Daniel does **not** see the change before publishing.
8. **Publishes** the interface; Daniel's home screen updates.
9. **Suspends Daniel**.
10. Confirms Daniel can no longer reach protected functions: Daniel's API calls return 401, pages go
    to sign-in, Daniel's sign-in button is disabled, and `user.suspended` appears in the activity log.

Finally the original layout is restored from the version list and Maria sees it.

## Accessibility and security (browser)

| Test | Result |
| --- | --- |
| Automated WCAG 2.2 AA scan (axe-core) of 16 screens: sign-in, home, the three steps of a work item, My Work, Review Queue, and every administration screen | ✅ 0 serious or critical issues (minor/moderate findings are not counted as failures) — 33.5 s |
| Complete the main employee task using the keyboard only | ✅ passed — 2.2 s |
| Phone (390 px) and tablet (820 px) layouts have no sideways scrolling | ✅ passed — 5.1 s |
| Security headers on pages and API responses (CSP with a fresh nonce per page and no `unsafe-eval`, X-Frame-Options, nosniff, Referrer-Policy, HSTS, no `X-Powered-By`) | ✅ passed |

Automated scans do not find every accessibility problem; a manual review with a screen reader is
still recommended.

## Unit and integration tests (86)

All passed. Integration tests run the real services against a real (embedded or server) PostgreSQL
database, the real document pipeline and fictional data.

| File | Tests | What it covers |
| --- | --- | --- |
| `tests/integration/demand-letter.test.ts` | 5 | Matter access, pre-fill, reading documents with page-checked facts, Word/PDF generation, exact totals, missing-evidence and conflict flags, submission |
| `tests/integration/arbitration.test.ts` | 2 | Paginated, bookmarked, Bates-numbered package; missing requirements; approval; final unwatermarked files |
| `tests/integration/skill-lifecycle.test.ts` | 9 | Create → test (sample matter only) → attorney approval → publish → grant one employee → edit → restore; work in progress keeps its version; switch off; audit trail; cosmetic vs significant changes |
| `tests/integration/access-control.test.ts` | 13 | No session → 401; employee on admin endpoint → 403 and logged; CSRF; **rate limiting (429)**; others' work → 404; suspension ends sessions immediately; last-admin and self-suspension protection; only System Admin grants System Admin; restricted matter by ID; skill revocation; reviewer matter access; emergency stop |
| `tests/integration/interface.test.ts` | 5 | Draft vs published layout; never shows unpermitted skills; unreadable colours refused; admin-only; restore |
| `tests/integration/robustness.test.ts` | 11 | AI temporary failure retries then plain-English error; refusals not retried and work kept; malformed AI output rejected; invented amounts/dates/citations flagged; interrupted job recovered; autosave and "edited" marking; hand edits without re-running AI; clean upload read and used; unsafe upload rejected and logged; **partial settings update keeps other values; effort settings reach the provider** |
| `tests/integration/clio-adapter.test.ts` | 5 | Mocked Clio API: per-employee encrypted tokens; custom-field mapping; cross-matter download refused; three-step upload; token refresh and revoked access |
| `tests/integration/retention.test.ts` | 1 | Expired uploads and old test runs removed; current work kept |
| `tests/unit/calculations.test.ts` | 5 | Money parsing, no floating-point error, half-up rounding, settlement maths, missing values reported not guessed, division by zero |
| `tests/unit/checks.test.ts` | 5 | Date formats, quote-on-page, exact amount/date support, unsupplied legal citations, provider matching |
| `tests/unit/skill-config.test.ts` | 6 | Built-in skills valid; invalid configurations rejected; attorney review can't be turned off; change classification; unsupported-capability warnings; safe identifiers |
| `tests/unit/ui-config.test.ts` | 4 | Contrast maths; unreadable colours; required navigation; no setting can hide legal warnings or review |
| `tests/unit/intake.test.ts` | 7 | File type by content; size/empty/binary rejection; antivirus test file; PDF scripts/encryption; Word macros; file-name cleaning; encryption round-trip and tamper detection |
| `tests/unit/anthropic-adapter.test.ts` | 4 | Mocked HTTP: structured-output request with model and refusal fallbacks; refusal not retried; authentication failure message; malformed output retryable |
| `tests/unit/prompts.test.ts` | 3 | Safety rules separate from administrator text; breaking out of data sections neutralised; demonstration extractor keeps page and quote |
| `tests/unit/rate-limit.test.ts` | 1 | Limit, per-person separation, window reset |

## Production-mode checks (run by hand during development)

With `APP_ENV=production` against the production build: only Microsoft sign-in is offered; the
development sign-in returns 404; only the bootstrap administrator is created (no fictional data);
the redirect to Microsoft is correctly formed (firm tenant, authorization code, PKCE S256, state,
nonce); and an unsafe configuration refuses to start, listing every problem. The container start-up
steps (migrate, then start) were simulated without Docker and worked.

## Not tested (needs the firm's accounts or Azure)

Live Microsoft sign-in and MFA · live Clio · live AI provider · Azure deployment (Bicep template not
validated) · Docker image build · Azure Blob Storage and Key Vault via managed identity · ClamAV ·
OCR (not built). See [STATUS.md](STATUS.md).

## Problems found by testing (and fixed)

- Ticking several checkboxes quickly could lose a tick (answers saved out of order) — fixed.
- Reordering exhibits quickly could save an old order — fixed.
- A declined (refused) AI request was being retried — fixed, now reported at once.
- The demonstration reader joined unrelated lines (a location absorbed the next label) — fixed.
- Accessibility: a link name that didn't match its visible text, invalid ARIA on toggle buttons, a
  scrollable area not reachable by keyboard — fixed.
- Saving one AI setting could reset settings that weren't sent; the "effort" settings were stored
  but not used — fixed, with tests.
- The "Connect Clio" button that the not-connected message refers to was missing — added.
