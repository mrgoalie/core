#!/usr/bin/env python3
"""Render a folded-in-half daily court calendar printout for Fabbrini Law Group.

Input is a small JSON file describing one day's docket (see
``assets/sample-events.json`` for the exact shape). Output is a print-ready
PDF plus the source HTML.

Why the layout is the way it is
-------------------------------
Jim carries this to the courthouse folded in half *lengthwise* (a "hot-dog"
fold): an 8.5x11 sheet folded so the crease runs down the 11" side, leaving a
4.25"-wide readable panel. So the one hard constraint is that every scrap of
information has to stay readable inside a ~4" column. We honor that by flowing
the docket into TWO 4"-ish columns with the fold line drawn down the middle:
read the left column top-to-bottom (that's the panel facing up when folded),
then the right column. Nothing ever spans the crease, and body type stays >=
10.5pt so it reads at arm's length on counsel table.

Each event carries the three things Jim asked to see at a glance plus room to
write:
  * NEXT IN ROOM      -> next time he is back in that exact courtroom
  * NEXT AT COURTHOUSE -> next time he is back in that building (any room)
  * BALANCE            -> money still owed, on flat-fee case types only
                          (criminal / DUI / traffic / license). PI is
                          contingency, so it shows no balance.
  * ruled note lines   -> for handwriting during the call

Rendering: Chromium headless honors ``@page { size }`` exactly, so we render
the HTML to PDF with it. WeasyPrint is used if present. Either way the HTML is
always written next to the PDF so it can be printed straight from a browser as
a last resort.

Usage:
    python build_calendar_pdf.py EVENTS.json [--out OUT.pdf] [--open-note-lines N]
"""

from __future__ import annotations

import argparse
import glob
import html
import json
import os
import shutil
import subprocess
import sys
import tempfile

RED = "#E30613"          # firm red
INK = "#111111"
MUTE = "#6E6E73"
LINE = "#C9C9CE"         # note-line gray, dark enough to write against
AMBER = "#B25000"        # data-gap / warning
GREEN = "#248A3D"

FLAT_FEE_TYPES = {"criminal", "dui", "traffic", "license"}


def esc(value) -> str:
    return html.escape("" if value is None else str(value))


# --------------------------------------------------------------------------- #
# HTML building
# --------------------------------------------------------------------------- #
def note_lines(n: int) -> str:
    """n ruled lines sized so a pen fits between them."""
    row = f'<div style="height:0.30in;border-bottom:1px solid {LINE};"></div>'
    return f'<div style="margin-top:6px;">{row * max(0, n)}</div>'


def money(v) -> str:
    """Format a number as $1,500. Pass through strings untouched."""
    if v is None or v == "":
        return ""
    if isinstance(v, (int, float)):
        return f"${v:,.0f}" if float(v).is_integer() else f"${v:,.2f}"
    return str(v)


def balance_block(ev: dict) -> str:
    """The money-still-out line. Only flat-fee case types get one."""
    case_type = str(ev.get("case_type", "")).strip().lower()
    if case_type not in FLAT_FEE_TYPES:
        return ""  # PI / other -> no balance line by design

    bal = ev.get("balance", ev.get("balance_outstanding"))
    fee = ev.get("fee_total")
    paid = ev.get("amount_paid")

    # Unresolved balance is stated, never guessed (firm data-integrity rule).
    if bal in (None, "") and fee in (None, "") and paid in (None, ""):
        return (
            f'<div style="margin-top:5px;font-size:10pt;color:{AMBER};font-weight:700;">'
            f'$ Balance: unresolved — verify in Filevine</div>'
        )

    try:
        bal_num = float(bal) if bal not in (None, "") else None
    except (TypeError, ValueError):
        bal_num = None

    detail = ""
    if fee not in (None, "") or paid not in (None, ""):
        parts = []
        if fee not in (None, ""):
            parts.append(f"fee {money(fee)}")
        if paid not in (None, ""):
            parts.append(f"paid {money(paid)}")
        detail = f' <span style="color:{MUTE};font-weight:400;">({" · ".join(parts)})</span>'

    owed = money(bal) if bal not in (None, "") else "—"
    # Red when money is actually outstanding; muted when paid in full.
    color = RED if (bal_num is None or bal_num > 0) else GREEN
    label = "Balance owed" if (bal_num is None or bal_num > 0) else "Paid in full"
    return (
        f'<div style="margin-top:5px;font-size:10.5pt;color:{color};font-weight:800;">'
        f'$ {label}: {owed}{detail}</div>'
    )


NONE_SENTINELS = {"", "none", "n/a", "na", "none in 120-day window", "no future dates"}


def has_value(value) -> bool:
    """True only when the field holds a real date, not an empty/none sentinel."""
    return value is not None and str(value).strip().lower() not in NONE_SENTINELS


def stack_line(symbol: str, label: str, value, star: bool = False) -> str:
    if not has_value(value):
        value = "none in 120-day window"
        color = MUTE
        star = False  # nothing to consolidate onto
    else:
        color = INK
    star_txt = ' <span style="color:%s;font-weight:700;">★ same room</span>' % RED if star else ""
    return (
        f'<div style="margin-top:3px;font-size:9.5pt;color:{color};line-height:1.35;">'
        f'<span style="color:{MUTE};">{esc(symbol)} {esc(label)}:</span> '
        f'<span style="font-weight:600;">{esc(value)}</span>{star_txt}</div>'
    )


def flag_pill(text: str, color: str) -> str:
    return (
        f'<span style="font-size:7.5pt;font-weight:800;letter-spacing:.4px;'
        f'text-transform:uppercase;color:#fff;background:{color};'
        f'border-radius:4px;padding:1px 5px;margin-left:5px;white-space:nowrap;">'
        f'{esc(text)}</span>'
    )


def event_card(ev: dict, default_note_lines: int) -> str:
    time = esc(ev.get("time", ""))
    place = esc(ev.get("courthouse", ""))
    room = ev.get("room")
    room_txt = f" · Rm {esc(room)}" if room not in (None, "") else ""
    appearance = esc(ev.get("appearance_type", ""))
    matter = esc(ev.get("matter", ""))

    # in-person vs Zoom pill
    mode = str(ev.get("mode", "")).strip().lower()
    pill = ""
    if mode in ("in_person", "in-person", "inperson"):
        pill = flag_pill("in person", RED)
    elif mode == "zoom":
        pill = flag_pill("zoom", GREEN)

    extra_pills = "".join(
        flag_pill(str(p), AMBER) for p in ev.get("flags", []) if p
    )

    header_bits = " · ".join(b for b in [appearance, matter] if b)

    return f"""
    <div style="break-inside:avoid;page-break-inside:avoid;margin-bottom:12px;
                padding-bottom:8px;border-bottom:2px solid {INK};">
      <div style="display:flex;align-items:baseline;">
        <div style="font-size:13pt;font-weight:800;color:{RED};min-width:0.75in;">{time}</div>
        <div style="font-size:11.5pt;font-weight:700;color:{INK};line-height:1.25;">
          {place}{room_txt}{pill}{extra_pills}
        </div>
      </div>
      <div style="font-size:10pt;color:{INK};margin-top:2px;font-weight:600;">{header_bits}</div>
      {stack_line("↻", "Next in room", ev.get("next_in_room"), star=has_value(ev.get("next_in_room")))}
      {stack_line("⌂", "Next at courthouse", ev.get("next_at_courthouse"))}
      {balance_block(ev)}
      {note_lines(ev.get("note_lines", default_note_lines))}
    </div>
    """


def build_html(data: dict, default_note_lines: int) -> str:
    firm = esc(data.get("firm", "Fabbrini Law Group"))
    who = esc(data.get("attorney", "Jim Fabbrini"))
    date_label = esc(data.get("date_label", data.get("date", "")))
    events = data.get("events", [])

    if events:
        cards = "".join(event_card(ev, default_note_lines) for ev in events)
    else:
        cards = (
            f'<div style="font-size:12pt;color:{MUTE};margin-top:12px;">'
            f'No court events on the calendar for this day.</div>'
        )

    gaps = data.get("data_gaps", [])
    gaps_html = ""
    if gaps:
        items = "".join(f"<li>{esc(g)}</li>" for g in gaps)
        gaps_html = f"""
        <div style="break-inside:avoid;margin-top:10px;padding:8px 10px;
                    background:#FFF8E6;border:1px solid #F0DFAF;border-radius:8px;">
          <div style="font-size:8pt;font-weight:800;letter-spacing:.5px;
                      text-transform:uppercase;color:{AMBER};">Data gaps — stated, not invented</div>
          <ul style="margin:5px 0 0;padding-left:16px;font-size:9pt;color:{INK};line-height:1.4;">{items}</ul>
        </div>"""

    generated = esc(data.get("generated", ""))

    return f"""<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @page {{ size: 8.5in 11in; margin: 0.35in 0.3in; }}
  * {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  html, body {{ margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, Helvetica, Arial, sans-serif; color: {INK};
          font-size: 10.5pt; }}

  /* Fold line down the exact center of the sheet (4.25in from each edge). */
  .fold {{ position: fixed; top: 0; bottom: 0; left: 50%;
           border-left: 1px dashed #BBB; }}
  .fold::after {{ content: "fold"; position: absolute; top: 0.15in; left: 3px;
                  font-size: 6.5pt; letter-spacing: 1px; text-transform: uppercase;
                  color: #BBB; }}

  .head {{ border-bottom: 3px solid {RED}; padding-bottom: 6px; margin-bottom: 10px; }}
  .firm {{ font-size: 8pt; font-weight: 800; letter-spacing: 1.4px;
           text-transform: uppercase; color: {RED}; }}
  .date {{ font-size: 19pt; font-weight: 800; letter-spacing: -0.4px; color: {INK};
           margin-top: 2px; }}
  .sub {{ font-size: 9pt; color: {MUTE}; margin-top: 1px; }}

  /* Two 4"-ish columns so each folded panel is self-contained and readable. */
  .docket {{ column-count: 2; column-gap: 0.5in; column-fill: auto; }}

  .foot {{ font-size: 7.5pt; color: {MUTE}; line-height: 1.5;
           margin-top: 10px; border-top: 1px solid #DDD; padding-top: 5px;
           break-inside: avoid; }}
</style></head>
<body>
  <div class="fold"></div>
  <div class="head">
    <div class="firm">{firm} · Daily Court Calendar · {who}</div>
    <div class="date">{date_label}</div>
    <div class="sub">Print &amp; fold in half lengthwise · ↻ next in room · ⌂ next at courthouse · $ balance owed</div>
  </div>
  <div class="docket">
    {cards}
    {gaps_html}
    <div class="foot">
      Source: Filevine Sync + M365 calendar (live pull) · balances from Filevine.
      Flags follow the firm ruleset (flg-command-brief). Not authoritative for
      speedy-trial/SOL math — verify in Filevine. Generated {generated}.
    </div>
  </div>
</body></html>"""


# --------------------------------------------------------------------------- #
# PDF conversion
# --------------------------------------------------------------------------- #
def find_chrome() -> str | None:
    candidates = []
    base = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
    candidates += sorted(glob.glob(os.path.join(base, "chromium-*/chrome-linux/chrome")))
    candidates += sorted(glob.glob(os.path.join(base, "chromium-*/chrome-linux/headless_shell")))
    candidates.append(os.path.join(base, "chromium"))
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        found = shutil.which(name)
        if found:
            candidates.append(found)
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return None


def html_to_pdf(html_path: str, pdf_path: str) -> bool:
    """Return True on success. Try WeasyPrint, then Chromium headless."""
    try:
        from weasyprint import HTML  # type: ignore

        HTML(filename=html_path).write_pdf(pdf_path)
        return True
    except Exception:
        pass

    chrome = find_chrome()
    if not chrome:
        return False
    with tempfile.TemporaryDirectory() as profile:
        cmd = [
            chrome, "--headless", "--no-sandbox", "--disable-gpu",
            "--disable-dev-shm-usage", "--no-pdf-header-footer",
            "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=3000",
            f"--user-data-dir={profile}",
            f"--print-to-pdf={pdf_path}",
            f"file://{os.path.abspath(html_path)}",
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        return os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 0


# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("events", help="Path to the events JSON file")
    ap.add_argument("--out", help="Output PDF path (default: alongside the JSON)")
    ap.add_argument("--open-note-lines", type=int, default=3,
                    help="Default ruled note lines per event (default 3)")
    args = ap.parse_args()

    with open(args.events, encoding="utf-8") as fh:
        data = json.load(fh)

    out_pdf = args.out or os.path.splitext(os.path.abspath(args.events))[0] + ".pdf"
    out_html = os.path.splitext(out_pdf)[0] + ".html"

    html_str = build_html(data, args.open_note_lines)
    with open(out_html, "w", encoding="utf-8") as fh:
        fh.write(html_str)

    ok = html_to_pdf(out_html, out_pdf)
    if ok:
        print(f"PDF:  {out_pdf}")
        print(f"HTML: {out_html}")
    else:
        print(f"HTML: {out_html}")
        print("PDF renderer unavailable (no WeasyPrint, no Chromium). "
              "Open the HTML in a browser and Print → Save as PDF (Letter, no margins).",
              file=sys.stderr)
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
