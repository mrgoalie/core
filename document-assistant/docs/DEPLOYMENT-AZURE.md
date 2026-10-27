# Putting the Document Assistant on Azure

> **Nothing has been deployed, and no Azure costs have been incurred.** Deploying creates paid
> resources in the firm's Azure subscription. Get the owner's approval of the estimated monthly
> cost **before** step 4. The template ([infra/main.bicep](../infra/main.bicep)) has **not** yet
> been validated in Azure — the Azure tools could not be downloaded in the build environment —
> so step 3 (the "what-if" preview) is essential the first time.

This is written for the firm's IT administrator or a consultant. It takes about an hour the first
time. Do it first in a **staging** resource group with fictional data, then repeat for production.

## What gets created

One resource group containing:

| Resource | Purpose | Starting size |
| --- | --- | --- |
| App Service (Linux, container) | Runs the application | Plan `P0v3` (change with `appServiceSku`; `B2` is cheaper for a pilot) |
| Azure Database for PostgreSQL – Flexible Server | All records (employees, skills, work, approvals, activity log) | Burstable `B1ms`, 32 GB, backups kept 35 days |
| Storage account (Blob, zone-redundant) | Uploaded and generated documents (encrypted by the app, and again by Azure) | Soft delete 14 days, versioning on, no public access, no shared keys |
| Key Vault | Secrets: database address, Entra client secret, file-encryption key, AI key | Soft delete + purge protection |
| Container Registry | Holds the application image | Basic |
| Log Analytics + Application Insights | Logs and monitoring | Pay per GB ingested |

The web app uses its **managed identity** to read Key Vault, write to Storage and pull its image,
so no storage or registry passwords exist anywhere.

**Cost:** use the [Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/)
with the sizes above, region Central US. The App Service plan and the database are the largest
items. Deleting the resource group (see the end) stops all charges.

## Before you start

- [ ] Owner's approval of the estimated monthly cost.
- [ ] An Azure subscription **owned by the firm**, and an account with *Owner* (or *Contributor* +
      *User Access Administrator*) on it.
- [ ] The Microsoft Entra app registration from [ENTRA-SETUP.md](ENTRA-SETUP.md) (tenant ID,
      client ID, client secret).
- [ ] Access to the DNS for `windycitylawfirm.com` (to create `ai.windycitylawfirm.com`).
- [ ] On your computer: [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli),
      then `az bicep install`; Node.js 22 (to create the encryption key).

## 1. Sign in and create the resource group

```bash
az login
az account set --subscription "<firm subscription name or id>"
az group create --name rg-flg-docassist --location centralus
```

## 2. Prepare the settings

```bash
cd document-assistant
cp infra/main.parameters.example.json infra/main.parameters.json
```

Edit `infra/main.parameters.json`: tenant ID, client ID, the owner's work email
(`bootstrapAdminEmails`), and `appBaseUrl` = `https://ai.windycitylawfirm.com`. This file holds no
secrets and is excluded from Git.

Create the two new secrets (keep the terminal private; don't save them in files):

```bash
npm run generate-key        # file-encryption key (32 bytes, base64)
openssl rand -base64 30     # a strong PostgreSQL administrator password
```

**Back up the file-encryption key** somewhere safe and offline (for example the firm's password
manager, owner-only). Documents cannot be decrypted without it.

## 3. Preview (what-if) — no cost

```bash
az deployment group what-if \
  --resource-group rg-flg-docassist \
  --template-file infra/main.bicep \
  --parameters @infra/main.parameters.json
```

The CLI asks for the secret parameters it needs (`entraClientSecret`, `storageEncryptionKey`,
`postgresAdminPassword`; `anthropicApiKey` may be left empty). Read the list of resources it would
create. Fix any errors before continuing.

## 4. Deploy (creates paid resources)

```bash
az deployment group create \
  --resource-group rg-flg-docassist \
  --template-file infra/main.bicep \
  --parameters @infra/main.parameters.json
```

Note the outputs: `webAppName`, `defaultHostName`, `registryName`, `keyVaultName`.
The web app can't start yet — its image doesn't exist until the next step.

## 5. Build the application image

From the `document-assistant` folder (the build runs in Azure; Docker is not needed locally):

```bash
az acr build --registry <registryName> --image document-assistant:1.0.0 .
az webapp restart --resource-group rg-flg-docassist --name <webAppName>
```

The image tag must match `imageTag` in the parameters file. On start-up the container applies the
database migrations automatically, then starts the web server. Check:

```bash
curl https://<defaultHostName>/api/health     # → {"ok":true}
```

If it doesn't answer within a few minutes, read the logs:
`az webapp log tail --resource-group rg-flg-docassist --name <webAppName>`. A message beginning
`Unsafe production configuration:` lists exactly which setting is wrong.

## 6. Custom domain and HTTPS certificate

Treat `ai.windycitylawfirm.com` as proposed until the firm confirms it controls the DNS.

1. Azure portal → the web app → **Custom domains → Add custom domain**.
2. Domain provider: *All other domain services*; TLS/SSL: **App Service Managed Certificate**;
   domain `ai.windycitylawfirm.com`.
3. The portal shows two DNS records to create at the firm's DNS host: a **CNAME** `ai` → the
   default host name, and a **TXT** `asuid.ai` with a verification code. Create them, wait for DNS
   to update, then click **Validate** and **Add**.
4. Open `https://ai.windycitylawfirm.com/api/health`.

Make sure the Entra redirect URI is exactly `https://ai.windycitylawfirm.com/api/auth/callback`.

## 7. First sign-in

1. The owner (the `bootstrapAdminEmails` address) opens `https://ai.windycitylawfirm.com` and
   signs in with Microsoft 365.
2. **Administration → Manage Employees** — add staff and their skills.
3. **Administration → Templates** — upload the firm's approved letterhead template.
4. Work through the [ENTRA-SETUP.md live test checklist](ENTRA-SETUP.md#live-test-checklist) and
   [SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md) **before** any real client document is uploaded.

The deployment starts with `caseManagement = mock` (fictional cases) and the demonstration AI
engine, so nothing is connected to Clio or an AI provider until you choose to
([CLIO-SETUP.md](CLIO-SETUP.md), [AI-PROVIDER-SETUP.md](AI-PROVIDER-SETUP.md)).

## Updating to a new version

```bash
az acr build --registry <registryName> --image document-assistant:1.0.1 .
```

Then set `imageTag` to `document-assistant:1.0.1` in the parameters file and re-run step 4
(the deployment only changes what differs). Database migrations run automatically on start-up.
Skills, templates, the interface, employees and settings are stored in the database, so ordinary
administrator changes never need a new version.

To go back, deploy the previous tag the same way.

## Adding secrets later

To add or replace a secret (for example the AI key or a renewed Entra client secret):

```bash
az keyvault secret set --vault-name <keyVaultName> --name anthropic-api-key --value "<key>"
az webapp restart --resource-group rg-flg-docassist --name <webAppName>
```

Your own account needs the **Key Vault Secrets Officer** role on the vault to do this. For the AI
key the first time, re-run step 4 with `anthropicApiKey` instead, so the app setting that points to
the secret is created too. Secret names: `database-url`, `entra-client-secret`,
`storage-encryption-key`, `anthropic-api-key`.

## Backups and recovery

| What | How it's protected | How to recover |
| --- | --- | --- |
| Database | Automatic backups, point-in-time restore for 35 days | Portal → PostgreSQL server → **Restore** to a new server, then update the `database-url` secret. |
| Documents | Blob soft delete (14 days) and versioning | Portal → Storage → container → show deleted / previous versions. |
| Secrets | Key Vault soft delete and purge protection (90 days) | Portal → Key Vault → **Manage deleted secrets**. |
| File-encryption key | Key Vault **and** the offline backup you made in step 2 | Without it, stored documents can't be read. |
| Source code | This Git repository | Rebuild the image from any tagged commit. |

Geo-redundant database backup is off (it costs more). Turn it on if the firm wants recovery from a
regional Azure outage. **Test a restore** into a staging resource group at least once a year.

## Monitoring

- **App Service logs** (console, HTTP, platform) go to the Log Analytics workspace. The app never
  writes document contents or secrets to its logs.
- **User activity** (sign-ins, refusals, approvals, changes) is in **Administration → Activity**.
- Application Insights is created and its connection string is set, but the app does not yet send
  its own telemetry to it. Recommended:
  - an **availability test** on `https://ai.windycitylawfirm.com/api/health`;
  - **alerts** (email the IT contact) for: availability test failures, HTTP 5xx errors, App
    Service health-check failures, database CPU/storage above 80%;
  - Microsoft Entra **sign-in logs** for the app, and Key Vault diagnostic logs.

## Hardening (recommended before real client data)

The template keeps networking simple. Before real client data, consider (and record the decision):

1. **Private networking:** App Service VNet integration; PostgreSQL with private access; private
   endpoints for Storage and Key Vault; then disable their public network access.
2. **Antivirus:** run a ClamAV server the app can reach (for example an App Service sidecar
   container) and set `MALWARE_SCANNER=clamav`, `CLAMAV_HOST`. The app scans each file **before**
   encrypting it. (Azure's storage malware scanning can't read files the app has already encrypted.)
3. **Turn off basic-auth publishing credentials** (FTP/SCM) on the web app.
4. **Microsoft Defender for Cloud:** enable and work through its recommendations for App Service,
   databases, Key Vault and Storage.
5. **Front Door with WAF** if the app is scaled to more than one instance: the app's own rate
   limiting is per instance.
6. Restrict who has *Owner/Contributor* on the resource group; use Privileged Identity Management
   for administrators if available.

## Removing everything

```bash
az group delete --name rg-flg-docassist
```

This deletes all data and stops all charges. Because of purge protection the Key Vault name stays
reserved for 90 days.

## Continuous integration (optional)

[deploy/github-actions-ci.yml](../deploy/github-actions-ci.yml) runs the type check, unit and
integration tests and browser tests on every change. To use it, copy it to
`.github/workflows/document-assistant-ci.yml`. It does not deploy anything.
