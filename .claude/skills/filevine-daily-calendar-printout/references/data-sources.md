# Data Sources — Exact Pulls

## 1. Calendar (the docket + the stacking window)

The firm's court dates live on the **Filevine Sync calendar**, surfaced through Outlook, so
pull them with the **Microsoft 365 connector** — the same source `flg-command-brief` uses.

**Operational pull — the target day's events (full detail):**
- `mcp__Microsoft_365__outlook_calendar_search` scoped to the target date (America/Chicago).
- If the connector exposes the calendar as a resource, `mcp__Microsoft_365__read_resource`
  works too. Capture for each event: start time, subject/title, location (courthouse + room),
  and any body notes (Zoom info, matter #, CW/transport notes).

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
`lawpay-filevine-payment-sync` skill, which writes payments into each matter's payment
collection). Read them back through the **Zapier Filevine actions**:

1. `discover_zapier_actions({ app: "Filevine" })` — find a read action such as "Find Project"
   / "Get Project" / "Find Collection Items" (payments/fees). Names vary by the account's
   enabled Zaps; if none is enabled, that's a stated gap, not a guess.
2. `inspect_zapier_actions({ tool_name })` — resolve the parameter schema (project/matter
   lookup by internal # or client name; the fee/payment collection).
3. `execute_zapier_read_action(...)` — pull the flat fee and the sum of payments for the
   matter. Compute `balance = fee_total - amount_paid`.

Populate `fee_total`, `amount_paid`, and `balance` when you have them; `balance` alone is fine
if that's all Filevine returns. **If the balance can't be resolved** (no matching project,
ambiguous match, no fee field, Filevine/Zapier not reachable), leave the money fields absent
and add a line to `data_gaps`. The renderer then prints "Balance: unresolved — verify in
Filevine" in amber — which is the correct, honest output. Never invent a number: this figure
gates whether Jim stands for a plea, per the firm's fee-watch rule.

For **PI** matters, skip the lookup entirely — contingency fee, no flat-fee balance to show.

## 3. Matter identity

Display every matter as `#nnnn Client Name` (internal firm number + client name), never a
Filevine `ca/`/`r/p/` ID. If the calendar event carries only a Filevine ID, resolve the
internal # and client name via the same Filevine read action; if resolution fails, state it
in `data_gaps` rather than printing the raw ID.

## Rendering note

Once the docket JSON is assembled, `scripts/build_calendar_pdf.py` owns everything visual
(page size, fold line, two 4.25" columns, colors, note lines). It needs no network access —
it's a pure JSON → PDF/HTML transform — so it runs anywhere Chromium or WeasyPrint is present.
