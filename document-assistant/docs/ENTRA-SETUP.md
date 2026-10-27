# Microsoft 365 sign-in (Microsoft Entra ID)

Employees sign in with their normal Microsoft 365 work account. There are no separate passwords.
This needs to be done once, by whoever administers the firm's Microsoft 365 (about 20 minutes).

**Status:** the sign-in code is complete and the redirect to Microsoft was checked, but a full live
sign-in has **not** been tested because the app registration below doesn't exist yet. Do the
[live test checklist](#live-test-checklist) before relying on it.

> Microsoft occasionally renames menus in the Entra admin center. If a name below doesn't match
> exactly, look for the closest equivalent.

## How it works

- The app uses Microsoft's standard sign-in (OpenID Connect authorization code flow with PKCE,
  through Microsoft's own MSAL library). The app never sees anyone's password.
- Only accounts from the firm's own Microsoft 365 tenant are accepted.
- **Being in Microsoft 365 is not enough:** a person must also have been added in
  **Administration → Manage Employees**. Anyone else is turned away, and the attempt is logged.
- Suspending someone in the app signs them out immediately, independent of Microsoft 365.
- **MFA is enforced by Microsoft** using a Conditional Access policy (step 4). The app can
  optionally double-check it (step 6).

## 1. Register the application

1. Sign in to the **Microsoft Entra admin center** (<https://entra.microsoft.com>) as an
   administrator who can create app registrations.
2. Go to **Applications → App registrations → New registration**.
3. **Name:** `Fabbrini Document Assistant`.
4. **Supported account types:** *Accounts in this organizational directory only (single tenant)*.
5. **Redirect URI:** platform **Web**, address
   `https://ai.windycitylawfirm.com/api/auth/callback`
   (use the real address of the app; for a staging copy add its address too).
6. Click **Register**.
7. On the overview page, copy:
   - **Application (client) ID** → setting `ENTRA_CLIENT_ID`
   - **Directory (tenant) ID** → setting `ENTRA_TENANT_ID`

## 2. Create a client secret

1. In the app registration, open **Certificates & secrets → Client secrets → New client secret**.
2. Description `document-assistant`, expiry as your policy allows (for example 12 months).
   **Put a reminder in the calendar** to replace it before it expires — sign-in stops working the
   day it expires.
3. Copy the secret **Value** immediately (it is shown once) and store it **only** in Azure Key
   Vault as the secret `entra-client-secret` (see [DEPLOYMENT-AZURE.md](DEPLOYMENT-AZURE.md)).
   Do not email it or save it in a document.

## 3. Permissions

The app asks only for `openid`, `profile` and `email` — enough to know who is signing in. No
access to mail, files or Teams is requested. Under **API permissions** the default
**Microsoft Graph → User.Read** is fine to leave; nothing else is needed. If your tenant requires
it, click **Grant admin consent**.

## 4. Require MFA (Conditional Access)

Recommended: a Conditional Access policy (needs Microsoft Entra ID P1, included in Microsoft 365
Business Premium and E3/E5).

1. **Protection → Conditional Access → Create new policy.**
2. **Users:** all users (or a group containing everyone who will use the app). Exclude your
   emergency "break-glass" admin account as Microsoft recommends.
3. **Target resources:** select the *Fabbrini Document Assistant* app.
4. **Grant:** *Require multifactor authentication* (or a phishing-resistant authentication strength).
5. Optionally also require a compliant or Entra-joined device.
6. Start in **Report-only**, check the sign-in logs, then switch the policy **On**.

If the firm doesn't have Entra ID P1, Microsoft's **Security defaults** also require MFA for every
account.

## 5. Limit who can even reach the app (recommended)

In **Enterprise applications → Fabbrini Document Assistant → Properties**, set
**Assignment required?** to **Yes**, then under **Users and groups** add the people (or a group)
who use the app. This adds a second gate in Microsoft in front of the app's own employee list.

## 6. Configure the application

Set these (see [ENVIRONMENT.md](ENVIRONMENT.md)):

```
AUTH_MODE=entra
ENTRA_TENANT_ID=<Directory (tenant) ID>
ENTRA_CLIENT_ID=<Application (client) ID>
ENTRA_CLIENT_SECRET=<Key Vault reference to entra-client-secret>
APP_BASE_URL=https://ai.windycitylawfirm.com
BOOTSTRAP_ADMIN_EMAILS=<the owner's work email>
```

`BOOTSTRAP_ADMIN_EMAILS` creates the first administrator so they can sign in and add everyone else.

Optional: `ENTRA_REQUIRE_MFA_CLAIM=true` makes the app itself refuse sign-ins whose Microsoft token
does not include `mfa` in its authentication-methods (`amr`) claim. **Test this with one account
first** — whether the claim is included depends on the tenant and token version, and if it is
missing, everyone would be refused. Conditional Access (step 4) is the main control either way.

## Adding employees

1. In the app: **Administration → Manage Employees → Add employee**, using the person's Microsoft
   365 sign-in name (usually their work email).
2. If you turned on *Assignment required* (step 5), also add them to the app in Entra.

The first time they sign in, the app links their Microsoft account to their employee record. If a
different Microsoft account later tries to use the same email, it is refused.

## Live test checklist

Do this in a **staging** copy with fictional data before real use, and record the results:

- [ ] An added employee can sign in and lands on their home screen.
- [ ] They were asked for MFA by Microsoft.
- [ ] A Microsoft 365 user who was **not** added sees "hasn't been given access" (and it appears in **Activity** as `login.denied`).
- [ ] An account from a different Microsoft tenant (or a personal Microsoft account) is refused.
- [ ] A **suspended** employee is signed out immediately and cannot sign back in.
- [ ] Sign-out returns to the sign-in page and the back button does not reopen the app.
- [ ] After `SESSION_IDLE_MINUTES` without activity, the employee must sign in again.
- [ ] (If used) `ENTRA_REQUIRE_MFA_CLAIM=true` still lets an MFA sign-in through.
- [ ] The development sign-in page is not available (`/api/auth/dev-login` returns "not found").
