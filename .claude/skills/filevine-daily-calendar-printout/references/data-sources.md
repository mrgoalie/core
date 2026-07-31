# Data Sources — Exact Pulls

## 1. Calendar (the docket + the stacking window)

**This firm's Filevine calendar syncs into Google Calendar** (a Filevine→Google sync feed), so
that's the source — use the **Google Calendar connector** (`mcp__Google_Calendar__*`). First
`list_calendars` to find the Filevine-synced calendar by name (it's usually named "Filevine"
or similar), then read events from *that* calendar id — not the user's primary.

**Operational pull — the target day's events (full detail):**
- `mcp__Google_Calendar__list_events` (or `search_events`) on the Filevine calendar id, scoped
  to the target date (America/Chicago). Capture for each event: start time, summary/title,
  location (courthouse + room), and **the full description/notes**.
  - **`notes`** ← the event description text, verbatim (the offer, CW status, transport
    instruction, etc. usually live here). Don't summarize it away.
  - **`zoom`** ← any dial-in in the description *or* the location string (meeting ID + passcode,
    or a `zoom.us/j/...` link). Suppress it only for hard-in-person rooms (see `firm-rules.md`).

**Forward pull — today → +120 days, courthouse + room only:**
- Same calendar, wider window. You don't need full descriptions here — just each future event's
  date, time, courthouse, and room. This feeds `next_in_room` and `next_at_courthouse`.

**Sync-lag caveat (important).** The Google feed is a *sync* of Filevine, not Filevine itself,
so a freshly-entered court date can be missing for a sync cycle. **If the Filevine calendar is a
subscribed ICS feed in Google, Google refreshes it on its own slow schedule (often 8–24h), not
in real time** — so a hearing entered this week may not appear for the coming Monday even though
it's in Filevine. If the day looks empty or an expected matter is absent, say so plainly — don't
present an empty docket as authoritative. Remedies, in order:

1. **Confirm it's not just a genuinely light day** — ask the user (or check Filevine directly)
   whether court is actually set that day before assuming the pull failed.
2. **Manual fallback (fastest path to a real printout):** if the user knows the day's
   matter(s), have them name each one (time, courthouse, room, matter #/client) and build the
   docket from that. Still resolve balances and the room/courthouse stacking through Zapier/
   Filevine. A correct printout from user-stated events beats waiting on a laggy sync.
3. Trigger/await the next Filevine→Google sync and re-pull.
4. **Pull court dates from Filevine directly via Zapier's `Make API GET Request`** (same
   connection as §2 — no credentials). Confirmed Filevine v2 endpoints:
   - **Per matter (calendar events = "appointments"):**
     `GET /fv-app/v2/projects/{projectId}/appointments`
     (base `https://api.filevine.io` US, or the org gateway `https://api.filevineapp.com`;
     each appointment has `startUtc`, `endUtc`, `title`, `calendarEventType`, `attendees`,
     `projectId`). Supports `offset` / `limit` / `requestedFields`; filter by date
     client-side. Inspect the `Make API GET Request` action first to see whether it wants a
     full URL or just the path, then pass this path.
   - **⚠️ There is NO org-wide "all appointments" endpoint** — the list is per-project. So
     "everything on Monday" the API way means: list projects (`GET .../projects`, paginated)
     → call appointments for each → merge/filter by date. That's impractical at firm scale
     (hundreds of projects = hundreds of calls). Use per-project appointments only to enrich a
     **known** matter (exact time/room), not to discover the whole day.
   - **Firm-wide the right way: a Filevine "Calendar Events" report.** Build a saved report in
     Filevine Report Builder (Calendar Events report type, filtered to the date range /
     upcoming; columns: project, event date, type, location, attendees), then run it through
     the Reports API via `Make API GET Request`. This is the real hands-free source for the
     full daily docket without the sync lag. One-time report setup required.

If neither the Google Calendar connector nor Zapier is connected, say so and ask the user to
connect one (or provide the day's events another way) — never fabricate a docket. If the firm's
setup ever moves the Filevine calendar to Outlook, the Microsoft 365 connector
(`mcp__Microsoft_365__outlook_calendar_search`) is the equivalent pull — confirm before using.

### Parsing courthouse + room out of an event

Locations arrive in many shapes ("Daley Center 404", "M5 Rm 107", "Bridgeview - Room 107",
"Zoom — Rolling Meadows 108"). Normalize to a `courthouse` name (+ code from
`firm-rules.md`) and a bare `room` token. When the room can't be parsed, set `room` to null
and add a `data_gaps` note — the stacking match needs a clean (courthouse, room) pair.

## 2. Balance lookup (flat-fee case types only)

"How much money is still out" = the flat fee agreed minus payments received, for **criminal /
DUI / traffic / license** matters. Payments are logged into Filevine (see the
`lawpay-filevine-payment-sync` skill, which writes each payment into the matter's payment
collection). Either route below fills `fee_total`, `amount_paid`, `balance`, and
`last_payment_date`.

> **This firm is configured for Route A (Zapier).** Balances resolve through the existing
> Filevine↔Zapier connection — no Filevine API keys, no environment secrets, no network
> allowlist. Route B (the Filevine API script) stays documented for a possible future
> fully-unattended scheduled run, but is not used by the normal interactive workflow.

### Route A — Zapier Filevine actions (the firm's configured route — no credentials)

Reuses the firm's **existing Filevine↔Zapier connection** (the
`zapier@filevine-cpi-service-accounts` account already used by `lawpay-filevine-payment-sync`),
so there is nothing new to create on the Filevine side — no PAT, no Client ID/Secret, no
org/user id. For how Jim actually uses this skill (asking Claude interactively), the one
tradeoff — an MCP approval prompt — is a non-issue: he's present to approve. Run it at
skill-execution time (a plain script can't call MCP):

1. **The payment collection is already known.** `lawpay-filevine-payment-sync` writes every
   payment into a specific Filevine payment collection/section. Load that skill's Zapier
   instructions first — `get_zapier_skill("log lawpay payment to filevine")` — to read the exact
   **project/collection/section identifiers and the amount + date field keys** it uses. Reading
   balances is the mirror image of that write, against the same collection.
2. `discover_zapier_actions({ app: "Filevine" })` → the Filevine app (`FilevineCLIAPI`).
3. **Confirmed available actions on this firm's connection** (from a live check): `Find Project`,
   `Find Collection Item`, `Find Form` / `Find Form by Selector`, `Find Contact`, `Find User`,
   `Find Phase`, and two raw actions **`Make API GET Request`** / `Make Mutating API Request`.
   There is **no** dedicated calendar/hearing/deadline query action. For balances:
   - Preferred: **`Find Collection Item`** against the payment collection named in step 1
     (it's a generic collection search — you supply the collection name/mode), plus
     **`Find Project`** for the fee field.
   - Flexible fallback: **`Make API GET Request`** to hit `core/projects/{id}` and
     `core/projects/{id}/Collections/{payments}` directly through the Zapier connection.
   Resolve the chosen action's schema with `inspect_zapier_actions({ tool_name })`;
   `enable_zapier_action` it if it isn't active.
4. Look the matter up by **`filevine_project_id`** (the `r/p/NNNNNNN` ref captured in the
   calendar pull) — no fuzzy name matching.
5. `execute_zapier_read_action(...)` → pull the flat fee, the payment rows, and the latest
   payment date. Compute `balance = fee_total − Σ payments` and `last_payment_date = max(date)`,
   then write the four money fields onto the event.

Once the exact action + field keys are confirmed on the first live run, record them here so
future runs skip the discovery step.

### Route B — Filevine API v2 script (alternative, for unattended runs): `scripts/resolve_balances.py`

Self-contained, deterministic, no middleman, offline-testable (`--selftest`). Only worth the
setup cost if this ever runs fully headless on a schedule with nobody to approve the Zapier
prompt — it requires Filevine API credentials plus a network allowlist (see
`references/filevine-setup.md`). Not needed for the interactive Zapier workflow above. Reads
Filevine with the firm's API credentials from the environment and looks matters up by
`filevine_project_id`:

```bash
python scripts/resolve_balances.py --in DOCKET.json --out DOCKET.json
```

Needs these env secrets: `FILEVINE_PAT`, `FILEVINE_CLIENT_ID`, `FILEVINE_CLIENT_SECRET`,
`FILEVINE_ORG_ID`, `FILEVINE_USER_ID`, plus `FV_FEE_SELECTOR` / `FV_PAYMENTS_COLLECTION`
(`--whoami` fetches the two IDs; `--discover` finds the two selectors). If a run reports HTTP
401/403 the PAT has expired — regenerate it and update `FILEVINE_PAT`.

### Either way

`balance` alone is fine if that's all Filevine returns; `last_payment_date` lets Jim see at a
glance whether the client has paid recently or gone cold. **If the balance can't be resolved**
(no project id, no matching project, no fee field, Filevine unreachable), leave the money
fields absent and add a line to `data_gaps`. The renderer prints "Balance: unresolved — verify
in Filevine" in amber — the correct, honest output. Never invent a number: this figure gates
whether Jim stands for a plea, per the firm's fee-watch rule.

For **PI** matters, skip the lookup entirely — contingency fee, no flat-fee balance to show.

## 3. Matter identity

Display every matter as `#nnnn Client Name` (internal firm number + client name), never a
Filevine `ca/`/`r/p/` ID. If the calendar event carries only a Filevine ID, resolve the
internal # and client name via the same Filevine read action; if resolution fails, state it
in `data_gaps` rather than printing the raw ID.

## Rendering note

Once the docket JSON is assembled (and balances resolved), `scripts/build_calendar_pdf.py`
owns everything visual (page size, fold line, events on the left half, ruled note lines on the
right half, colors). It needs no network access — a pure JSON → PDF/HTML transform — so it runs
anywhere Chromium or WeasyPrint is present.
