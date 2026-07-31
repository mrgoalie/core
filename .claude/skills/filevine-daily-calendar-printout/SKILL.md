---
name: filevine-daily-calendar-printout
description: Build Jim's printable daily court calendar from the Filevine Sync calendar — a single 8.5x11 sheet designed to be folded in half lengthwise and carried to court. Use this skill whenever the user asks for a "calendar printout," "daily court sheet," "print my calendar," "docket to take to court," "fold-in-half court sheet," "printable schedule," or any physical/paper version of the day's court calendar. Each event shows the next date/time back in that exact courtroom, the next date/time back in that courthouse, the money still owed on flat-fee cases (criminal / DUI / traffic / license), and ruled lines for handwritten notes. Trigger even when the user doesn't say "Filevine" — a request to print or fold the day's court schedule is this skill. Not for the emailed Command Brief (that's flg-command-brief) — this one produces a paper printout.
---

# Filevine Daily Calendar Printout

Produces a **print-ready PDF** of one day's court docket, laid out so it stays fully
readable after the sheet is **folded in half lengthwise** (a "hot-dog" fold: the crease
runs down the 11" side, leaving a 4.25"-wide panel Jim can hold in one hand at counsel
table or slip in a jacket pocket). Every event carries the four things Jim asked for:

1. **↻ Next in room** — the next date/time he is back in that *exact courtroom*.
2. **⌂ Next at courthouse** — the next date/time he is back in that *building* (any room).
3. **$ Balance owed** — money still out on the case, **only** for flat-fee case types
   (criminal, DUI, traffic, license), with the **last payment date**. PI is contingency, so
   it shows no balance.
4. **Ruled note lines** under each event on the left, plus a full **Notes panel on the entire
   right half** of the fold — reserved for handwriting only, so the whole page is usable.

It also carries, per event, the **note text from the Filevine calendar** and, for remote
appearances, the **Zoom credentials shown as prominently as the IN PERSON tag** (a filled
green chip) so Jim can dial in without digging.

This is the *paper* counterpart to `flg-command-brief` (which emails an HTML brief). Same
firm, same courthouse/room rules — different deliverable. Reuse the ruleset; don't reinvent it.

## When to use

- "Print my calendar for tomorrow," "make me a court sheet for Thursday," "the fold-in-half
  docket," "daily calendar I can take to court," "printable schedule with note lines."
- Any request for a *physical/printable* version of the day's court schedule.
- Do **not** use for the emailed brief, SOL banners, or the paralegal routing — that's
  `flg-command-brief`. If the user wants both, run each skill for its own deliverable.

## The one hard layout constraint

The sheet folds down the center, giving two 4.25" panels. The renderer assigns them by rule:

- **LEFT panel = the entire docket.** Every event, the header, data gaps, and footer live
  here and *only* here. Events never cross the fold. If a day has more events than fit, the
  left panel paginates onto a **second sheet's left half** — it never spills rightward.
- **RIGHT panel = ruled note lines only.** No events, ever. It's Jim's writing surface, and
  it repeats on every page.

Body type stays ≥ 10.5pt and nothing spans the crease. Do not fight the layout by hand-writing
HTML — feed the renderer a JSON docket and let it place everything.

## Workflow

### 1. Pick the day
Default to **today** in America/Chicago. Honor an explicit day ("tomorrow," "Thursday,"
"July 30"). One day per printout.

### 2. Pull the calendar
Read `references/data-sources.md` first — it has the exact connector calls. In brief:

- **Source: the firm's Filevine calendar, which syncs into Google Calendar.** Use the Google
  Calendar connector (`mcp__Google_Calendar__*`): `list_calendars` → find the Filevine-synced
  calendar → read events from *that* calendar id. Capture each event's **description/notes** and
  any **Zoom dial-in** — put the note text in `notes` (verbatim) and the dial-in in `zoom`
  (it often hides in the location string or the description, so read both).
- **Forward pull (today → +120 days), courthouse + room only:** powers *↻ Next in room* and
  *⌂ Next at courthouse*. 120 days, not 30 — continuance/trial-setting targets routinely land
  6–16 weeks out (RS-9 in the command-brief ruleset).
- **Sync lag:** the Google feed mirrors Filevine on a delay, so a just-entered date can be
  missing. If the day looks empty or a matter is absent, say so — don't present an empty docket
  as truth. The most current source is pulling court dates straight from Filevine via Zapier;
  see `references/data-sources.md` → "Calendar." Skip **CANCELLED / STRICKEN** events; screen
  for Illinois court holidays before trusting any date.

### 3. Classify each event
Read `references/firm-rules.md` (courthouse codes, appearance types, in-person vs. Zoom,
case-type detection). That file defers to `flg-command-brief`'s ruleset **RS-12** as the
authoritative source when it's installed — check it and use the higher version if the two
ever differ, so the two skills never drift apart.

### 4. Compute the stacking fields
For each event, from the 120-day forward pull:
- **next_in_room** = earliest future event at the **same courthouse AND same room**
  (room identity is courthouse-scoped — "107" at Bridgeview ≠ "107" at Skokie).
- **next_at_courthouse** = earliest future event at the **same courthouse**, any room.
- Leave a field `null` when there's no future date; the renderer prints "none in 120-day
  window" and suppresses the ★ same-room star. A stated empty is fine; a silent omission is not.

### 5. Resolve the balance (flat-fee case types only)
For **criminal / DUI / traffic / license** matters, resolve what's still owed from Filevine.
**This firm is configured for the Zapier route** — it reuses the existing Filevine↔Zapier
connection (the one `lawpay-filevine-payment-sync` already runs on), so there are no Filevine
API keys, no environment secrets, and no network allowlist to manage. At skill-execution time,
read each flat-fee matter's fee + payments through the Zapier Filevine actions and fill
`fee_total`, `amount_paid`, `balance`, and `last_payment_date`. Look matters up by
`filevine_project_id` (the `r/p/NNNNNNN` ref grabbed from the event's Filevine deep link during
the calendar pull). The full procedure — including reusing the LawPay-sync skill's Zapier
instructions to get the exact payment collection/field keys — is in `references/data-sources.md`
→ "Balance lookup, Route A."

`scripts/resolve_balances.py` (Route B) is the Filevine-API alternative, kept only for a
possible future fully-unattended scheduled run; it's not needed for the interactive workflow.

If a balance can't be resolved (no project id, Filevine unreachable, matter not found), leave
the money fields absent and add a line to `data_gaps` — the renderer prints "Balance:
unresolved — verify in Filevine" rather than inventing a number. **Never guess a balance.**
For PI matters, omit the money fields entirely (contingency — there is no flat-fee balance).

### 6. Build the docket JSON and render
Write a JSON file in the exact shape below, then run the bundled renderer:

```bash
python scripts/build_calendar_pdf.py DOCKET.json --out /path/daily-calendar-YYYY-MM-DD.pdf
```

It writes the PDF and a same-named `.html` (browser-print fallback). It renders via WeasyPrint
if present, otherwise Chromium headless (both honor the exact 8.5×11 page). Then deliver the
PDF to the user (SendUserFile if available), and mention the fold: "print single-sided, fold
in half the long way."

### Docket JSON shape

```json
{
  "firm": "Fabbrini Law Group",
  "attorney": "Jim Fabbrini",
  "date_label": "Tuesday, July 28",
  "generated": "2026-07-28 06:00 CT",
  "events": [
    {
      "time": "9:00",
      "courthouse": "Daley Center",
      "room": "404",
      "appearance_type": "App / Resolve",
      "matter": "#5811 Reyes, Marco",
      "mode": "in_person",                 // "in_person" | "zoom" | omit if unknown
      "zoom": "Mtg 963 6581 2444 · PC 092295", // Zoom creds from the event; shown as a green chip
      "notes": "State offered supervision — confirm client accepts.", // verbatim Filevine calendar note
      "case_type": "dui",                  // criminal|dui|traffic|license -> balance shown; pi/other -> hidden
      "filevine_project_id": "10293847",   // from the event's Filevine deep link; lets resolve_balances.py auto-fill the money
      "fee_total": 3500,                    // optional
      "amount_paid": 2000,                  // optional
      "balance": 1500,                      // owed; 0 => "Paid in full"; absent => "unresolved"
      "last_payment_date": "Jul 3",        // optional; shown in the balance line
      "next_in_room": "Aug 3, 9:00 AM",    // null => none in window
      "next_at_courthouse": "Jul 30, 9:30 AM",
      "flags": ["CW watch"],               // optional small pills (e.g. "CW watch", "transport writ")
      "note_lines": 2                       // optional per-event ruled lines on the left; default 2
    }
  ],
  "data_gaps": ["#6051 balance unresolved in Filevine — verify before the call."]
}
```

- **`zoom`** — set this whenever the appearance is remote and the calendar carries dial-in
  info (often buried in the location/room or the event body). The renderer shows it as a
  filled green chip and auto-marks the event ZOOM even if `mode` is unset. A hard-in-person
  room (Daley 22xx / Rm 2005, CMCs) keeps `mode: "in_person"` and the chip is suppressed —
  those phantom Zoom IDs don't apply (see `firm-rules.md`).
- **`notes`** — the Filevine calendar event's note text, verbatim. Don't paraphrase or drop it;
  it's often where the offer, the CW status, or a transport instruction lives.
- **`last_payment_date`** — most recent payment date for the matter, shown alongside the balance.
- **`note_lines`** — optional per-event ruled lines on the *left* (default 2), for jotting the
  disposition next to the case. The whole *right* half is a separate ruled Notes panel that the
  renderer always draws and repeats on every page — no configuration needed.

`assets/sample-events.json` is a complete, working example — render it to see the exact output.

## Display rules (match the firm's other skills)

- **Matter label = `#nnnn Client Name`** (e.g. `#6034 Chowdhury, Tabassum`). Never show
  Filevine `ca/` or `r/p/` IDs as a visible label. If an event carries only a Filevine ID,
  resolve the internal # and client name from Filevine; if that fails, put the gap in
  `data_gaps` rather than printing the raw ID.
- **Balance color:** red when money is owed, green when paid in full, amber when unresolved.
- **In-person vs. Zoom** follows the ruleset (e.g. Daley 22xx / Rm 2005 and CMCs are hard
  in-person regardless of any Zoom ID). Mark `mode` accordingly.

## Data-integrity rule

If a data point is missing — matter #, custody status, or a flat-fee balance — **state the gap
in `data_gaps`; do not guess and do not silently omit.** A printout that says "balance
unresolved" is trustworthy; one that prints a made-up number is dangerous at a plea.

## Reference files

- `references/calendar-events-report.md` — the configured firm-wide calendar source: how to
  build the Filevine "Calendar Events" report and run it through Zapier (no sync lag, no
  credentials), with the column→docket-field mapping and the fallback order.
- `references/firm-rules.md` — courthouse codes, appearance types, in-person/Zoom rules,
  case-type detection, and the room/courthouse stacking definitions. Defers to
  `flg-command-brief` RS-12 as the source of truth.
- `references/data-sources.md` — exact connector calls: M365 calendar pull (operational +
  120-day forward), and the Filevine balance lookup — **Route A (Zapier, the firm's configured
  route)** and Route B (Filevine API script, for unattended runs) — with the gap fallback.
- `scripts/resolve_balances.py` — Route B only: auto-fills flat-fee `balance` / `fee_total` /
  `amount_paid` / `last_payment_date` from the Filevine API by `filevine_project_id`, for a
  future fully-unattended scheduled run. Not used by the default interactive (Zapier) workflow.
  `--whoami` / `--discover` / `--selftest` help set it up; credentials come from the environment.
- `references/filevine-setup.md` — one-time Filevine API setup for Route B only (API key/PAT,
  org/user IDs, network allowlist, fee/payment selectors). Not needed for the Zapier default.
- `scripts/build_calendar_pdf.py` — the renderer. Feed it the docket JSON; it owns the
  fold layout (events left, note lines right), colors, and note lines.
- `assets/sample-events.json` — a ready-to-render example docket.
