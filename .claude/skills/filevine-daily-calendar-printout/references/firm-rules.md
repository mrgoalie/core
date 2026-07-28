# Firm Rules — Quick Reference for the Printout

**Source of truth:** the `flg-command-brief` skill's `references/ruleset.md` (currently
**RS-12**). If that skill is installed, read it and prefer it wherever it is more current than
this file — this file is a compact restatement of only the parts the printout needs, kept here
so the printout can run even if the command brief isn't present. If you change a shared rule,
change it in the command-brief ruleset first (and bump its RS number), then mirror it here.

## Courthouse codes

M1 = Daley Center · M2 = Skokie · M3 = Rolling Meadows · M4 = Maywood · M5 = Bridgeview ·
M6 = Markham · DUP = DuPage County · LK = Lake County · Will = Will County ·
555 = 555 W Harrison · 26th = Leighton · BR = Cook County branch court.

Print the readable name plus the code when known, e.g. `Bridgeview (M5)`.

## Appearance-type codes (print as-is, short)

SC = Status Call · CMC = Case Management Conference · PC = Progressive Call (Rm 1501) ·
JOA = Judgment on Award · ADC = All Discovery Closed · ADES = evaluation required ·
HRG = Hearing · PreLim = Preliminary hearing · ARRAIN = Arraignment · Trial = trial setting.

## In-person vs. Zoom (set the `mode` field)

- Most courthouses have Zoom **except**: Daley Center 22nd floor (rooms formatted `22xx`)
  **and Rm 2005** = hard in-person, no exceptions, regardless of any Zoom ID listed.
- **CMC = always in person, everywhere.** Pleas, trials, evidentiary hearings = in person.
- Daley **Rm 1501 = all Zoom** (exception); also hosts PC matters.
- DuPage traffic rooms 1000/1002/1003 are never remote.
- When a Zoom option genuinely exists, set `mode: "zoom"`; otherwise `mode: "in_person"`.
  If truly unknown, omit `mode` (no pill) and note it in `data_gaps`.

### Zoom credentials get shown, prominently

When an event carries actual dial-in info (meeting ID, passcode, or a Zoom link — often
tucked into the location/room string or the event body), put it in the event's `zoom` field.
The renderer prints it as a **filled green chip**, the same visual weight as the IN PERSON tag,
so Jim can join without hunting. **Exception:** for hard-in-person rooms (Daley 22xx / Rm 2005,
CMCs, pleas/trials) keep `mode: "in_person"` — the renderer suppresses the chip because any
Zoom ID listed there is a phantom that doesn't apply. Cook County room Zoom IDs are stable and
live in the firm's saved directory / Filevine; county rooms (Will/DuPage/Lake) rotate weekly,
so pull those fresh rather than caching.

## Case-type detection (decides whether a balance line prints)

The Filevine case-type field isn't always in the calendar data. Infer from signals:

- **Flat-fee (show balance): criminal / DUI / traffic / license.** Signals: ADES, plea, PTR,
  arraignment, term/speedy-trial demand, diversion, CW, branch-court settings, license /
  Secretary-of-State / statutory-summary-suspension language, DUI, traffic citation numbers.
- **PI (no balance — contingency).** Signals: SOL, demand/adjuster, liens, ADC, written
  discovery, depositions, CMC, arbitration, PC/service, Rule 26(a)(1), settlement.
- When ambiguous, resolve the case type in Filevine. If unresolved, omit the balance line and
  add a `data_gaps` note — do **not** guess a case type just to show or hide money.

Map the resolved type to `case_type`: `criminal` | `dui` | `traffic` | `license` (→ balance
shown) or `pi` | `other` (→ balance hidden).

## Room / courthouse stacking (the ↻ and ⌂ fields)

Computed from the **120-day forward** pull (RS-9 widened this from 30 days because
continuances and trial settings land 6–16 weeks out):

- **next_in_room** — earliest future event at the **same courthouse AND same room**. Room
  identity is courthouse-scoped: "107" at Bridgeview is a different room from "107" at Skokie,
  so always compare the (courthouse, room) pair. A real value here is the highest-value
  consolidation target — the renderer stars it (★ same room), because the same judge/call can
  usually absorb a consolidated setting.
- **next_at_courthouse** — earliest future event at the **same courthouse**, any room. Tells
  Jim when he'll next make the trip to that building.
- Daley 22xx / Rm 2005 dates are the most valuable to consolidate (hard in-person downtown
  trips); if you want to emphasize one, add a `flags` pill like `"22xx trip"`.
- No future date → leave the field `null`. The renderer prints "none in 120-day window".

## Event hygiene

- Skip CANCELLED / STRICKEN events; note a reschedule if the description names a new date.
- Illinois court-holiday check before trusting any date — flag phantom dates in `data_gaps`.
- In-custody defendant with a transport order → consider a `"transport writ"` flag pill.
