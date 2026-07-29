#!/usr/bin/env python3
"""Resolve flat-fee balances from Filevine and write them into a docket JSON.

"file API" == the **Filevine API v2**. This resolver auto-fills, for each
criminal / DUI / traffic / license event that doesn't already have a balance:
`fee_total`, `amount_paid`, `balance`, and `last_payment_date` — so the printout
stops saying "unresolved" and shows a real number. PI events are skipped
(contingency, no flat-fee balance).

It looks matters up by **Filevine project id**, which the calendar pull already
has: Filevine Sync events carry the project in their deep link (the
`r/p/NNNNNNN` / `ca/NNNNNNN` refs). Put that id on each event as
`filevine_project_id` and this script needs no fuzzy name matching. Events
without a project id are left untouched (the renderer then states the gap — we
never guess a balance a client might be about to plead on).

--------------------------------------------------------------------------------
Credentials — set as environment variables, never commit them:
  FILEVINE_PAT            personal access token (Filevine → your profile → API)
  FILEVINE_CLIENT_ID      API key    (org API credentials)
  FILEVINE_CLIENT_SECRET  API secret (org API credentials)
  FILEVINE_ORG_ID         numeric org id
  FILEVINE_USER_ID        numeric user id (the PAT's user)

Firm-specific selectors — where the flat fee and the payment ledger live in
*this* firm's Filevine. Discover them once (see --discover) and set:
  FV_FEE_SELECTOR         project fee field. "field" (top-level project field)
                          or "section/field" (a form section). e.g. "flatFee"
                          or "intake/quotedFee".
  FV_PAYMENTS_COLLECTION  collection selector holding one row per payment — the
                          same collection lawpay-filevine-payment-sync writes to.
  FV_PAYMENT_AMOUNT_FIELD amount field on a payment row  (default "amount")
  FV_PAYMENT_DATE_FIELD   date field on a payment row    (default "date")

These selectors are firm-specific by nature — Filevine has no universal
"balance" field; every firm tracks fees/payments in its own section/collection.
That's why the one-time --discover step exists instead of a hardcoded endpoint.
--------------------------------------------------------------------------------

Usage:
  # one-time: dump a known project's sections/collections to find the selectors
  python resolve_balances.py --discover --project 12345678

  # resolve balances into a docket (in place, or to a new file)
  python resolve_balances.py --in docket.json --out docket.json

  # verify the fee/paid/balance/last-payment math with no network
  python resolve_balances.py --selftest

Exit codes: 0 ok · 2 missing credentials · 3 network/API error · 4 selftest fail.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

IDENTITY_URL = os.environ.get("FILEVINE_IDENTITY_URL", "https://identity.filevine.io/connect/token")
API_BASE = os.environ.get("FILEVINE_API_BASE", "https://api.filevine.io/fv-app/v2").rstrip("/")
SCOPE = os.environ.get("FILEVINE_SCOPE", "fv.api.gateway.access tenant")

FLAT_FEE_TYPES = {"criminal", "dui", "traffic", "license"}

# Date formats seen on Filevine date fields; parsed then re-emitted as "Mon D".
_DATE_INPUTS = ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d", "%m/%d/%Y")


# --------------------------------------------------------------------------- #
# HTTP helpers (stdlib only — no `requests` dependency)
# --------------------------------------------------------------------------- #
def die(code: int, msg: str):
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def _request(method: str, url: str, headers: dict, body: bytes | None = None) -> dict:
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        if e.code in (401, 403):
            die(3, f"{method} {url} -> HTTP {e.code}: {detail}\n"
                   "  Auth rejected. Most common cause: the Filevine PAT expired or was "
                   "revoked — regenerate it (Filevine → profile → API) and update "
                   "FILEVINE_PAT. Also verify FILEVINE_ORG_ID / FILEVINE_USER_ID.")
        die(3, f"{method} {url} -> HTTP {e.code}: {detail}")
    except urllib.error.URLError as e:
        die(3, f"{method} {url} -> {e.reason}")
    return json.loads(raw) if raw.strip() else {}


def get_token() -> str:
    pat = os.environ.get("FILEVINE_PAT")
    cid = os.environ.get("FILEVINE_CLIENT_ID")
    secret = os.environ.get("FILEVINE_CLIENT_SECRET")  # optional
    if not (pat and cid):
        die(2, "Missing FILEVINE_PAT / FILEVINE_CLIENT_ID")
    fields = {
        "grant_type": "personal_access_token",
        "token": pat,
        "scope": SCOPE,
        "client_id": cid,
    }
    if secret:  # include only if the org's PAT flow requires a client secret
        fields["client_secret"] = secret
    form = urllib.parse.urlencode(fields).encode()
    data = _request("POST", IDENTITY_URL,
                    {"Content-Type": "application/x-www-form-urlencoded"}, form)
    tok = data.get("access_token")
    if not tok:
        die(3, f"Token endpoint returned no access_token: {data}")
    return tok


def _auth_headers(token: str) -> dict:
    org = os.environ.get("FILEVINE_ORG_ID")
    user = os.environ.get("FILEVINE_USER_ID")
    if not (org and user):
        die(2, "Missing FILEVINE_ORG_ID / FILEVINE_USER_ID")
    return {
        "Authorization": f"Bearer {token}",
        "x-fv-orgid": str(org),
        "x-fv-userid": str(user),
        "Accept": "application/json",
    }


def api_get(path: str, token: str, params: dict | None = None) -> dict:
    url = f"{API_BASE}/{path.lstrip('/')}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    return _request("GET", url, _auth_headers(token))


def whoami(token: str) -> dict:
    """Return {userId, orgs:[...]} using the org-agnostic utils endpoint —
    needs only the bearer token, not the org/user ids we're trying to find."""
    url = f"{API_BASE}/utils/GetUserOrgsWithToken"
    hdr = {"Authorization": f"Bearer {token}",
           "Content-Type": "application/json", "Accept": "application/json"}
    return _request("POST", url, hdr, b"{}")


# --------------------------------------------------------------------------- #
# Field extraction
# --------------------------------------------------------------------------- #
def _num(v) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    # Filevine currency fields sometimes arrive as {"amount": 1500} or "$1,500".
    if isinstance(v, dict):
        for k in ("amount", "value", "native"):
            if k in v:
                return _num(v[k])
        return None
    s = str(v).replace("$", "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _fmt_date(v) -> str | None:
    if not v:
        return None
    s = str(v)
    for fmt in _DATE_INPUTS:
        try:
            return datetime.strptime(s[: len(datetime.now().strftime(fmt)) + 2], fmt).strftime("%b %-d")
        except ValueError:
            continue
    # Last resort: take the date part of an ISO string.
    try:
        return datetime.fromisoformat(s.replace("Z", "")).strftime("%b %-d")
    except ValueError:
        return None


def get_fee(project_id: str, token: str) -> float | None:
    selector = os.environ.get("FV_FEE_SELECTOR", "flatFee")
    if "/" in selector:
        section, field = selector.split("/", 1)
        data = api_get(f"core/projects/{project_id}/Forms/{section}", token)
        return _num((data.get("data") or data).get(field))
    data = api_get(f"core/projects/{project_id}", token)
    return _num((data.get("data") or data).get(selector))


def get_payments(project_id: str, token: str) -> list[dict]:
    coll = os.environ.get("FV_PAYMENTS_COLLECTION")
    if not coll:
        die(2, "Set FV_PAYMENTS_COLLECTION (run --discover to find it)")
    amt_f = os.environ.get("FV_PAYMENT_AMOUNT_FIELD", "amount")
    date_f = os.environ.get("FV_PAYMENT_DATE_FIELD", "date")
    data = api_get(f"core/projects/{project_id}/Collections/{coll}", token,
                   {"requestedFields": f"{amt_f},{date_f}"})
    items = data.get("items", data if isinstance(data, list) else [])
    rows = []
    for it in items:
        f = it.get("data", it)
        rows.append({"amount": _num(f.get(amt_f)), "date": f.get(date_f)})
    return rows


def resolve_financials(project_id: str, token: str) -> dict:
    """-> {fee_total, amount_paid, balance, last_payment_date} (any may be None)."""
    fee = get_fee(project_id, token)
    payments = get_payments(project_id, token)
    amounts = [p["amount"] for p in payments if p["amount"] is not None]
    paid = round(sum(amounts), 2) if amounts else (0.0 if payments == [] else None)
    dates = [p["date"] for p in payments if p.get("date")]
    last = None
    if dates:
        # Sort by best-effort parse; keep the latest.
        def _key(d):
            for fmt in _DATE_INPUTS:
                try:
                    return datetime.strptime(str(d)[:19], fmt)
                except ValueError:
                    continue
            return datetime.min
        last = _fmt_date(max(dates, key=_key))
    balance = round(fee - paid, 2) if (fee is not None and paid is not None) else None
    return {"fee_total": fee, "amount_paid": paid, "balance": balance,
            "last_payment_date": last}


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #
def cmd_whoami() -> int:
    """Fetch the Org ID and User ID for the FILEVINE_* credentials in the env,
    so you don't have to hunt them down in the Filevine UI."""
    token = get_token()  # needs only PAT + client id/secret
    data = whoami(token)
    print(json.dumps(data, indent=2)[:4000])
    user = data.get("user", data)
    uid = user.get("userId") or user.get("UserId") or user.get("id")
    orgs = data.get("orgs") or data.get("Orgs") or []
    print("\n# Set these:")
    if uid:
        print(f"export FILEVINE_USER_ID={uid}")
    for o in orgs:
        oid = o.get("orgId") or o.get("OrgId") or o.get("id")
        name = o.get("name") or o.get("Name") or ""
        print(f"export FILEVINE_ORG_ID={oid}   # {name}")
    if not uid and not orgs:
        print("# (Couldn't parse ids from the response above — read them off the raw JSON.)")
    return 0


def cmd_discover(project_id: str) -> int:
    token = get_token()
    print(f"# Project {project_id} — core fields:")
    proj = api_get(f"core/projects/{project_id}", token)
    print(json.dumps(proj.get("data", proj), indent=2)[:4000])
    print("\n# Collections/sections metadata (use these selectors for FV_* env vars):")
    for path in (f"core/projects/{project_id}/Collections",
                 f"core/projects/{project_id}/Forms"):
        try:
            print(f"\n## {path}")
            print(json.dumps(api_get(path, token), indent=2)[:3000])
        except SystemExit as e:
            print(f"   (skipped: {e})")
    return 0


def cmd_resolve(in_path: str, out_path: str) -> int:
    with open(in_path, encoding="utf-8") as fh:
        docket = json.load(fh)
    token = None
    resolved = skipped = 0
    for ev in docket.get("events", []):
        if str(ev.get("case_type", "")).lower() not in FLAT_FEE_TYPES:
            continue
        if _num(ev.get("balance")) is not None:
            continue  # already has a balance
        pid = ev.get("filevine_project_id")
        if not pid:
            skipped += 1
            continue
        token = token or get_token()
        fin = resolve_financials(str(pid), token)
        for k, v in fin.items():
            if v is not None:
                ev[k] = v
        if fin.get("balance") is not None:
            resolved += 1
        else:
            skipped += 1
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(docket, fh, indent=2, ensure_ascii=False)
    print(f"Resolved {resolved} balance(s); {skipped} left for the renderer to flag. -> {out_path}")
    return 0


def cmd_selftest() -> int:
    # Pure-compute check: fee 3500, two payments 1500 + 500, latest 2026-07-03.
    global get_fee, get_payments
    get_fee = lambda pid, tok: 3500.0                      # noqa: E731
    get_payments = lambda pid, tok: [                       # noqa: E731
        {"amount": 1500.0, "date": "2026-06-19T00:00:00"},
        {"amount": 500.0, "date": "2026-07-03T00:00:00"},
    ]
    fin = resolve_financials("x", "tok")
    ok = (fin["fee_total"] == 3500.0 and fin["amount_paid"] == 2000.0
          and fin["balance"] == 1500.0 and fin["last_payment_date"] == "Jul 3")
    print("selftest:", "PASS" if ok else f"FAIL {fin}")
    return 0 if ok else 4


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--whoami", action="store_true",
                    help="Print your Filevine Org ID and User ID from PAT + keys")
    ap.add_argument("--discover", action="store_true", help="Dump a project's sections/collections")
    ap.add_argument("--project", help="Filevine project id (with --discover)")
    ap.add_argument("--in", dest="in_path", help="Input docket JSON")
    ap.add_argument("--out", dest="out_path", help="Output docket JSON (default: in place)")
    ap.add_argument("--selftest", action="store_true", help="Offline math check, no network")
    args = ap.parse_args()

    if args.selftest:
        return cmd_selftest()
    if args.whoami:
        return cmd_whoami()
    if args.discover:
        if not args.project:
            ap.error("--discover requires --project")
        return cmd_discover(args.project)
    if args.in_path:
        return cmd_resolve(args.in_path, args.out_path or args.in_path)
    ap.error("nothing to do — pass --in, --discover, or --selftest")


if __name__ == "__main__":
    raise SystemExit(main())
