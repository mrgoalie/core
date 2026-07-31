# Firm-Wide Calendar via a Filevine "Calendar Events" Report

The Filevine appointments API is **per-project** — there's no org-wide "today's docket" call, and
the Google Calendar sync lags (subscribed-ICS refresh is 8–24h). A saved **Calendar Events
report**, run through the Reports API, is the real hands-free source: one call returns every
matter's upcoming court dates, in real time, through the existing Zapier connection (no
credentials). This file is the setup + how the skill consumes it.

## Part 1 — Build the report in Filevine (one time)

In Filevine → **Reports / Report Builder** → **New Report**:

1. **Report type:** choose the **Calendar Events** (a.k.a. Appointments / Calendar) report type —
   the one that lists calendar events across projects.
2. **Columns** (add each — these map directly to the printout; see the mapping table below):
   - Project / Client name  *(the `#nnnn Client Name` label)*
   - Project number / internal matter #
   - Project ID  *(needed to look up the balance — keep it even if hidden on screen)*
   - Project Type  *(drives criminal / DUI / traffic / license vs. PI case-type detection)*
   - Event date & time (start)  *(honor the org's timezone; convert from UTC as needed)*
   - Event type  *(the appearance type: Status, CMC, Prelim, ADES, Trial…)*
   - Title / subject
   - Location  *(courthouse + room)*
   - Description / notes  *(the offer, CW status, transport instruction — printed verbatim)*
   - Attendees  *(to confirm it's JF's setting, if the firm has multiple attorneys)*
3. **Filter / criteria:** Event date **from today through +120 days**. One 120-day window powers
   both the day's docket *and* the "next in room / next at courthouse" stacking, so no second
   pull is needed. (If multiple attorneys, also filter Attendee = Jim Fabbrini.)
4. **Save** the report. Note its **Report ID** (in the report's URL or its settings/detail).

## Part 2 — Get the Reports API "run report" endpoint

The appointments endpoint is known (`GET /fv-app/v2/projects/{projectId}/appointments`), but the
**run-a-saved-report** endpoint isn't confirmed here. On **developer.filevine.io** (logged in),
open the **Reports** section, or ask Filevine support this exact question:

> "What is the Filevine v2 API endpoint to run a saved report by its report ID and retrieve the
> result rows? Is it synchronous, or do I create a report run and then fetch results? Please give
> the full path(s) and any required parameters."

Filevine Reports APIs are often two-step (create a run → poll for results). Capture whatever they
give: the path(s), method(s), and how rows come back.

## Part 3 — Send back to finish wiring

Reply with: (a) the **Report ID**, and (b) the **run-report endpoint(s)** from Part 2. Then the
skill's calendar step becomes: `Make API GET/POST Request` (Zapier) → run the report → receive
rows → filter to the target day for the docket, keep the rest for stacking. No sync, no
credentials. Record the confirmed Report ID + endpoint below once wired.

- Report ID: `TBD`
- Run endpoint: `TBD`

## Column → docket-field mapping

| Report column            | Docket JSON field        | Notes |
|--------------------------|--------------------------|-------|
| Event date & time        | `time` (+ the day)       | Convert from UTC to America/Chicago |
| Location                 | `courthouse` + `room`    | Parse into name (+ code) and bare room token |
| Event type               | `appearance_type`        | |
| Project/Client + number  | `matter`                 | Format `#nnnn Client Name`; never a raw Filevine ID |
| Project ID               | `filevine_project_id`    | Feeds the balance lookup (§2 of data-sources.md) |
| Project Type             | `case_type`              | Map to criminal/dui/traffic/license → balance shown; pi/other → hidden |
| Description / notes      | `notes`                  | Verbatim; also scan for Zoom dial-in → `zoom` |
| (computed)               | `next_in_room` / `next_at_courthouse` | From the same 120-day report rows |

## Fallbacks (keep, in order)

1. Calendar Events report (this file) — the configured firm-wide source once Parts 1–3 are done.
2. Google Calendar sync — still fine for days the sync has caught up on.
3. Per-project `appointments` endpoint — to enrich a single known matter's exact time/room.
4. User-stated docket — when the user names the day's matters directly.
