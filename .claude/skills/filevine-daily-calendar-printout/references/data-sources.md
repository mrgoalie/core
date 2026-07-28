# Data Sources — Exact Pulls

## 1. Calendar (the docket + the stacking window)

The firm's court dates live on the **Filevine Sync calendar**, surfaced through Outlook, so
pull them with the **Microsoft 365 connector** — the same source `flg-command-brief` uses.

**Operational pull — the target day's events (full detail):**
- `mcp__Microsoft_365__outlook_calendar_search` scoped to the target date (America/Chicago).
- If the connector exposes the calendar as a resource, `mcp__Microsoft_365__read_resource`
  works too. Capture for each event: start time, subject/title, location (courthouse + room),
  and **the full body/notes**.
  - **`notes`** ← the event body text, verbatim (the offer, CW status, transport instruction,
    etc. usually live here). Don't summarize it away.
  - **`zoom`** ← any dial-in in the body *or* the location/room string (meeting ID + passcode,
    or a `zoom.us/j/...` link). Suppress it only for hard-in-person rooms (see `firm-rules.md`).

**Forward pull — today → +120 days, courthouse + room only:**
- Same tool, wider window. You don't need full bodies here — just enough to know, for every
  future event, its date, time, courthouse, and room. This feeds `next_in_room` and
  `next_at_courthouse`. Do the 120 days in one search if the connector allows a range;
  otherwise page through it.

If the Microsoft 365 connector isn't connected, say so and ask the user to connect it (or
provide the day's events another way) — don't fabricate a docket. Google Calendar
(`mcp__Google_Calendar__*`) is an acceptable substitute **only** if that's where the user's
court dates actually live; confirm before relying on it.

### Parsing courthouse + room out of an event

Locations arrive in many shapes ("Daley Center 404", "M5 Rm 107", "Bridgeview - Room 107",
"Zoom — Rolling Meadows 108"). Normalize to a `courthouse` name (+ code from
`firm-rules.md`) and a bare `room` token. When the room can't be parsed, set `room` to null
and add a `data_gaps` note — the stacking match needs a clean (courthouse, room) pair.

## 2. Balance lookup (flat-fee case types only)

"How much money is still out" = the flat fee agreed minus payments received, for **criminal /
DUI / traffic / license** matters. Payments are logged into Filevine (see the
`lawpay-filevine-payment-sync` skill, which writes each payment into the matter's payment
collection). There are two ways to read them back; either fills `fee_total`, `amount_paid`,
`balance`, and `last_payment_date`.

### Route A — Filevine API v2 (DEFAULT — most stable): `scripts/resolve_balances.py`

**Use this route.** For a scheduled daily printout it's the stable choice: it's a self-contained
script with no interactive approval gate, no third-party middleman (Zapier connection re-auths,
task quotas, action-schema drift), and it's deterministic and offline-testable (`--selftest`).
The one thing to keep current is the **Filevine PAT** — it can expire; regenerate it and update
`FILEVINE_PAT` if a run reports an HTTP 401/403 (the script says exactly that). Prefer a
long-lived PAT and note its rotation date.

The resolver looks matters up by **`filevine_project_id`** (from the event's Filevine deep
link — the `r/p/NNNNNNN` ref you captured in the calendar pull), so no fuzzy name matching.

```bash
python scripts/resolve_balances.py --in DOCKET.json --out DOCKET.json
```

**One-time setup.** Set credentials as environment secrets (never commit them):
`FILEVINE_PAT`, `FILEVINE_CLIENT_ID`, `FILEVINE_CLIENT_SECRET`, `FILEVINE_ORG_ID`,
`FILEVINE_USER_ID`. Then tell it where this firm keeps the flat fee and the payment ledger —
Filevine has no universal "balance" field, so these are firm-specific. Discover them once:

```bash
python scripts/resolve_balances.py --discover --project <a-known-project-id>
```

That prints the project's fields, sections (Forms), and collections. From the output, set:
`FV_FEE_SELECTOR` (e.g. `flatFee` or `intake/quotedFee`), `FV_PAYMENTS_COLLECTION` (the
collection the LawPay sync writes to), and — if the payment rows don't use the defaults —
`FV_PAYMENT_AMOUNT_FIELD` / `FV_PAYMENT_DATE_FIELD`. The resolver then computes
`balance = fee − Σ payments` and `last_payment_date = max(payment date)`. `--selftest` checks
the math offline. Auth uses the standard v2 flow (PAT grant → bearer, with `x-fv-orgid` /
`x-fv-userid` headers); confirm the endpoint constants at the top of the script against your
Filevine region/instance on first run.

### Route B — Zapier Filevine actions (fallback only — no new credentials)

Use this only if you can't mint Filevine API keys. It reuses the firm's existing Filevine
connection but is less stable for automation: the Zapier MCP tools need an interactive approval
(which a scheduled/headless run can't grant), and it adds a middleman that can re-auth, rate-
limit, or change action schemas. Run it at skill-execution time (the script can't call MCP):

1. `discover_zapier_actions({ app: "Filevine" })` → the Filevine app (`FilevineCLIAPI`).
2. `inspect_zapier_actions({ selected_api: "FilevineCLIAPI" })` → pick the read/search action
   that returns a project and its fee/payment collection; resolve its parameter schema. Enable
   it with `enable_zapier_action` if it isn't already.
3. `execute_zapier_read_action(...)` → pull the flat fee, the payments, and the latest payment
   date for the project. Compute `balance = fee_total − amount_paid` and write the four money
   fields onto the event.

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
