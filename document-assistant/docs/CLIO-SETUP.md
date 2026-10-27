# Connecting Clio Manage

**Status: not yet verified.** Until a live test succeeds, the app uses **fictional demonstration
cases** (`CASE_MANAGEMENT=mock`). The live Clio connection is written and tested against pretend
Clio responses, but has never talked to the real Clio. While it is switched on but unverified,
the app labels it "Clio Manage (live connection — not yet verified)" in **Administration →
Settings**.

Clio's official developer documentation (docs.developers.clio.com) could not be reached from the
build environment, so the connection follows Clio's published API v4 conventions as described in
secondary sources. **A developer must compare it with Clio's current documentation during the
live test** (see the checklist at the end) and correct anything that differs.

## How it protects matter-level access

- **Each employee connects their own Clio login.** Every request to Clio uses that employee's own
  Clio permission, so Clio itself decides which matters and documents they can see. The app never
  uses a firm-wide Clio credential to look at matters.
- Before downloading a document, the app checks it belongs to the matter the employee opened.
- Clio access tokens are stored encrypted. If Clio rejects a token, it is deleted and the employee
  is asked to connect again. Suspending an employee in the app deletes their Clio connection.
- The app keeps only what it needs for the work in progress (the matter reference and the facts
  used in the draft). Clio remains the file of record.
- The app reads from Clio. Saving approved documents back to Clio is written in the adapter but
  **not switched on** (there is no button for it); it should only be enabled after live testing.

## What the connection does

| Function | Clio API (v4) used | Status |
| --- | --- | --- |
| Employee connects their Clio account | OAuth 2.0: `/oauth/authorize`, `/oauth/token` (with refresh) | Unverified |
| Search matters the employee can see | `GET /api/v4/matters.json` (`query`, `fields`) | Unverified |
| Read a matter, including custom fields | `GET /api/v4/matters/{id}.json` with `custom_field_values` | Unverified |
| List the matter's documents | `GET /api/v4/documents.json?matter_id=…` | Unverified |
| Download a document | `GET /api/v4/documents/{id}.json`, then `/documents/{id}/download` | Unverified |
| Save an approved document to the matter | `POST /api/v4/documents.json` → upload to the returned `put_url` → `PATCH` with `fully_uploaded` | Written, not switched on |

The code is in [src/server/integrations/clio/live.ts](../src/server/integrations/clio/live.ts); the
fictional data is in [mock-data.ts](../src/server/integrations/clio/mock-data.ts).

## 1. Create a Clio developer application

A Clio administrator for the firm does this in Clio's developer portal (linked from Clio's
developer documentation).

1. Create a new application, name `Fabbrini Document Assistant`.
2. **Redirect URI:** `https://ai.windycitylawfirm.com/api/clio/callback` (and the staging address
   for testing).
3. **Permissions (scopes):** read access to **Matters**, **Contacts** (for the client name),
   **Documents** and **Custom Fields**. Add write access to Documents only when saving back to Clio is
   switched on. Request nothing else.
4. Copy the **App Key** → `CLIO_CLIENT_ID` and **App Secret** → `CLIO_CLIENT_SECRET` (store the
   secret only in Key Vault as `clio-client-secret` — see "Settings" below).

## 2. Find the firm's Clio region

`CLIO_BASE_URL` must match the region where the firm's Clio account is hosted. US accounts use
`https://app.clio.com` (the default). Other regions use a different address (for example
`https://ca.app.clio.com`, `https://eu.app.clio.com`, `https://au.app.clio.com`) — **confirm
the address in Clio's documentation**.

## 3. Settings

```
CASE_MANAGEMENT=clio
CLIO_BASE_URL=https://app.clio.com
CLIO_CLIENT_ID=<App Key>
CLIO_CLIENT_SECRET=<Key Vault reference>
```

In Azure, add the secret to Key Vault and the app settings, then restart:

```bash
az keyvault secret set --vault-name <keyVaultName> --name clio-client-secret --value "<App Secret>"
az webapp config appsettings set -g rg-flg-docassist -n <webAppName> --settings \
  CASE_MANAGEMENT=clio CLIO_CLIENT_ID=<App Key> \
  "CLIO_CLIENT_SECRET=@Microsoft.KeyVault(VaultName=<keyVaultName>;SecretName=clio-client-secret)"
az webapp restart -g rg-flg-docassist -n <webAppName>
```

(Re-deploying the Azure template resets app settings to the template's list, so after a live
test succeeds, add these three settings to [infra/main.bicep](../infra/main.bicep) as well.)

## 4. Map the firm's Clio custom fields

Standard Clio fields (client, matter number, description, practice area, responsible attorney)
are read automatically. Personal-injury details usually live in **custom fields**, whose names
differ from firm to firm.

In **Administration → Settings → Clio custom fields**, type the exact Clio custom-field name next
to each item, for example:

| App item | Example Clio custom field name |
| --- | --- |
| Date of incident | `Date of Loss` |
| Incident location | `Accident Location` |
| Type of incident | `Incident Type` |
| Liability insurance company | `Liability Carrier` |
| Claim number | `Claim Number` |
| Adjuster name / mailing address | `Adjuster` / `Adjuster Address` |
| Insured (at-fault party) | `Defendant / Insured` |
| Liability policy limits | `BI Limits` |
| Client's UM/UIM insurance company, policy number, limits | `UM Carrier`, `UM Policy #`, `UM Limits` |
| Court or arbitration case number | `Case Number` |
| Opposing counsel | `Opposing Counsel` |

Matching ignores capital letters. Items left blank are simply asked of the employee.

## 5. Each employee connects once

The first time an employee picks a case, the app asks them to connect Clio and shows a
**Connect Clio** button. They sign in to Clio and approve access, and are brought back to where
they were. This repeats only if Clio ends the connection.

## Live test checklist

Use a **test matter with fictional information** in Clio. A developer should be present to fix
any differences from Clio's current documentation.

- [ ] Confirm every endpoint, field name and the OAuth steps in the table above against Clio's current documentation; correct the adapter where needed.
- [ ] An employee connects Clio and returns to the case-selection step.
- [ ] Searching shows only matters that employee can see in Clio. A second employee **without** access to the test matter cannot find it or open it by its ID.
- [ ] Standard fields and each mapped custom field fill in correctly.
- [ ] The matter's documents are listed; a PDF and a Word file download and are read correctly.
- [ ] A document from a **different** matter cannot be opened through the first matter.
- [ ] After revoking the app in Clio, the employee is asked to connect again.
- [ ] Suspending the employee in the app removes their Clio connection.
- [ ] Rate limiting (HTTP 429 from Clio) shows "Clio is busy" rather than an error page.
- [ ] Only then: set `verified = true` in `live.ts`, update the label, and record the date of the test in [STATUS.md](STATUS.md).

## Manual uploads

During the move from Filevine, employees can always upload documents directly on the information
step (PDF, Word, text, PNG, JPEG). Uploaded files are screened, encrypted, and deleted
automatically after the retention period.
