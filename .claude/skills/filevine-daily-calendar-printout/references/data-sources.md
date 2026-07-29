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
collection). Either route below fills `fee_total`, `amount_paid`, `balance`, and
`last_payment_date`.

### Route A — Zapier Filevine actions (DEFAULT for this firm — no new credentials)

**Use this route.** It reuses the firm's **existing Filevine↔Zapier connection** (the
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
2. `discover_zapier_actions({ app: "Filevine" })` → the Filevine app (`FilevineCLIAPI`;
   1 read / 9 search / 10 write actions).
3. `inspect_zapier_actions({ selected_api: "FilevineCLIAPI" })` → choose the action that reads a
   project's fee and its payment collection. Prefer a Filevine **"API Request"** action if one is
   enabled (it can GET `core/projects/{id}` and `.../Collections/{payments}` directly through the
   Zapier connection); otherwise use **"Find Project"** + a collection-item **search** action.
   `enable_zapier_action` it if needed, then resolve the parameter schema.
4. Look the matter up by **`filevine_project_id`** (the `r/p/NNNNNNN` ref captured in the
   calendar pull) — no fuzzy name matching.
5. `execute_zapier_read_action(...)` → pull the flat fee, the payment rows, and the latest
   payment date. Compute `balance = fee_total − Σ payments` and `last_payment_date = max(date)`,
   then write the four money fields onto the event.

Once the exact action + field keys are confirmed on the first live run, record them here so
future runs skip the discovery step.

### Route B — Filevine API v2 script (for unattended automation): `scripts/resolve_balances.py`

Only needed if this ever runs **fully headless on a schedule** with nobody to approve the MCP
prompt. It's a self-contained script (no middleman, deterministic, `--selftest`) but requires
minting Filevine API credentials — see `references/filevine-setup.md`. Not required for the
default interactive workflow above.

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
