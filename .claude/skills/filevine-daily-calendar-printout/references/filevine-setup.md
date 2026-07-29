# Filevine Setup — Wiring Automatic Balance Resolution

One-time setup so `scripts/resolve_balances.py` (Route A, the stable default) can pull each
flat-fee matter's balance and last-payment date from the Filevine API. When you're done you'll
have **5 credential secrets** and **2–4 "selector" values** set as environment variables.

You need a Filevine user with API access. If any screen below is missing, an **Org Owner/Admin**
has to enable API access first (or Filevine support can: support@filevine.com).

---

## Step 1 — Get the API Key & Secret (the app's client credentials)

These identify the *integration*, not you.

1. Sign in to the **Filevine Developer Portal**: https://developer.filevine.io (use your
   Filevine SSO login).
2. Open **Keys / API Keys** and create a key (name it e.g. `Daily Calendar Printout`).
3. Copy the **Client ID / API Key** and the **Client Secret / API Secret**. The secret is shown
   once — store it now.

> If your org provisions keys through Filevine onboarding/support instead of the portal, ask
> your admin for the **API Key** and **API Secret** — that's the same pair.

These become `FILEVINE_CLIENT_ID` and `FILEVINE_CLIENT_SECRET`.

## Step 2 — Generate a Personal Access Token (PAT)

The PAT ties API calls to *your* Filevine user and permissions.

1. In the Filevine **web app**, click your **avatar (top-right)**.
2. Open **Personal Access Tokens** (may sit under *Settings* / *My Profile* depending on your
   build).
3. Click **New / Generate**, name it (`Daily Calendar Printout`), and **copy the token now** —
   it's shown only once.

This becomes `FILEVINE_PAT`. Note the date; PATs expire (see Maintenance).

## Step 3 — Get your Org ID and User ID (automatic)

You do **not** have to hunt these down in the UI. With Steps 1–2 exported, run:

```bash
export FILEVINE_PAT=...            # from Step 2
export FILEVINE_CLIENT_ID=...      # from Step 1
export FILEVINE_CLIENT_SECRET=...  # from Step 1
python scripts/resolve_balances.py --whoami
```

It prints your `FILEVINE_USER_ID` and one `FILEVINE_ORG_ID` per org, ready to copy. (If your
login has multiple orgs, pick the firm's.) Export the two it gives you.

## Step 4 — Find where the fee and payments live (the selectors)

Filevine has no universal "balance" field — every firm stores the flat fee and the payment
ledger in its own section/collection. Pin them once:

1. In Filevine, open a **known criminal/DUI matter**. Its URL ends in the project id
   (`…/project/NNNNNNN`) — the same `r/p/NNNNNNN` that rides on the calendar deep link. Note
   that number.
2. Note **where the flat fee is recorded** (which section + field label) and **where payments
   are logged** — this is the collection the `lawpay-filevine-payment-sync` skill writes into.
3. Dump that project's machine selectors:

   ```bash
   python scripts/resolve_balances.py --discover --project NNNNNNN
   ```

4. From the output, set:
   - `FV_FEE_SELECTOR` — the fee field. Use `fieldName` if it's a top-level project field, or
     `sectionSelector/fieldName` if it lives in a form section (e.g. `intake/quotedFee`).
   - `FV_PAYMENTS_COLLECTION` — the collection selector holding one row per payment.
   - `FV_PAYMENT_AMOUNT_FIELD` / `FV_PAYMENT_DATE_FIELD` — only if the payment rows don't use
     the defaults `amount` / `date`.

> Tip: the `--discover` output lists section and collection **selectors** (the API keys) next to
> their display names — match the display name you saw in the UI to grab the right selector.

## Step 4.5 — Allow Filevine through the environment's network (REQUIRED)

Claude Code cloud environments default to **Trusted** network access, which permits package
registries only — **Filevine is blocked**, so the resolver silently fails to connect until you
change this. In the environment settings dialog (same place as the variables — see Step 5),
set **Network access** to **Custom** and add these to **Allowed domains** (one per line), then
keep "Also include default list of common package managers" checked:

```
identity.filevine.com
*.filevine.com
api.filevine.io
*.filevine.io
```

(`identity.filevine.com` is the token host; the API gateway is `api.filevine.io`. The
wildcards cover region/subdomain variants. If you'd rather not maintain a list, **Full** access
also works.)

## Step 5 — Set the environment and run

**In Claude Code on the web** (the usual case), these go in the environment's
**Environment variables** box, not a shell — at claude.ai/code, click the cloud/environment
name above the message box → gear icon on your environment → paste them (one `KEY=value` per
line) → save → start a **new** session so they load. Note: this box is not a secret vault
(values are visible to anyone who uses the environment), so use the rotatable PAT and don't
share sessions that used it. Values:

```bash
FILEVINE_PAT=...            FILEVINE_CLIENT_ID=...      FILEVINE_CLIENT_SECRET=...
FILEVINE_ORG_ID=...         FILEVINE_USER_ID=...
FV_FEE_SELECTOR=flatFee     FV_PAYMENTS_COLLECTION=payments
# FV_PAYMENT_AMOUNT_FIELD=amount   FV_PAYMENT_DATE_FIELD=date   # only if non-default
```

If instead you run the script in a plain shell/cron, `export` the same values (still
**never commit them**):

```bash
export FILEVINE_PAT=...            FILEVINE_CLIENT_ID=...      FILEVINE_CLIENT_SECRET=...
export FILEVINE_ORG_ID=...         FILEVINE_USER_ID=...
export FV_FEE_SELECTOR=flatFee     FV_PAYMENTS_COLLECTION=payments
# export FV_PAYMENT_AMOUNT_FIELD=amount   FV_PAYMENT_DATE_FIELD=date   # only if non-default
```

Then the daily pipeline is two commands:

```bash
python scripts/resolve_balances.py --in DOCKET.json --out DOCKET.json
python scripts/build_calendar_pdf.py DOCKET.json --out daily-calendar.pdf
```

## Step 6 — Verify end-to-end

- `python scripts/resolve_balances.py --selftest` → prints `selftest: PASS` (offline math check).
- Run the resolver on a docket that has one flat-fee event with a real `filevine_project_id` and
  no `balance`. It should report `Resolved 1 balance(s)` and the rendered card should show a real
  `$ Balance owed` with the fee/paid/last-pmt detail instead of "unresolved."

## Maintenance / stability

- **PAT rotation is the only recurring task.** If a run fails with HTTP 401/403, the script tells
  you the PAT likely expired — regenerate it (Step 2) and update `FILEVINE_PAT`. Prefer the
  longest-lived PAT your org allows and calendar its rotation date.
- Credentials live only in the environment variables, never in the repo or the docket JSON.
  (Cloud environments have no dedicated secrets vault — the values are readable by anyone who
  uses the environment, so keep the PAT rotatable and don't share sessions that used it.)
- Endpoint defaults are `identity.filevine.com` (token) and `api.filevine.io/fv-app/v2` (API),
  overridable via `FILEVINE_IDENTITY_URL` / `FILEVINE_API_BASE` / `FILEVINE_SCOPE` if your
  Filevine region/tenant differs. The first live run confirms them.
