# Project status

Last updated: 27 October 2026.

This page says plainly what is **finished and tested**, what is **simulated** (working, but with
fictional stand-ins for outside services), what is **written but not yet verified** against the real
outside service, and what is **not built yet**. Nothing here has been deployed to Azure, and no
real client information has ever been used.

**Bottom line:** the application works end-to-end on a computer with fictional data. Before the
firm uses it with real clients, the outside connections (Microsoft sign-in, Clio, the AI provider,
Azure) must be set up with the firm's own accounts, tested live, and given a security review.
This software has **not** been certified as compliant with any standard, and it is not yet
"production-ready" in a security sense — those claims require live testing and an independent review.

## How to read the labels

| Label | Meaning |
| --- | --- |
| ✅ **Tested** | Built and checked by automated tests that were actually run (see [TEST-RESULTS.md](TEST-RESULTS.md)). |
| 🟡 **Simulated** | Works today using a clearly labeled fictional stand-in (demonstration cases, demonstration AI). |
| 🟠 **Unverified** | The code is written and tested against *pretend* responses, but has never talked to the real service. |
| ⬜ **Not built** | Not in this release. |

## Employee portal

| Feature | Status | Notes |
| --- | --- | --- |
| Sign in | ✅ Tested (development sign-in) · 🟠 Unverified (Microsoft 365) | Microsoft sign-in code is complete and the redirect to Microsoft was checked, but a real Microsoft sign-in has not been completed because the firm's Entra app registration does not exist yet. |
| See only assigned skills | ✅ Tested | Checked in the browser (Daniel sees one skill, Maria sees two) and on the server (unassigned skills are refused even if typed into the address bar). |
| Pick a case (matter) | ✅ Tested · 🟡 Simulated cases | Uses five fictional matters. Restricted matter (Hartley) is hidden from employees not on it. |
| Guided questions, pre-filled from the case and documents | ✅ Tested | Each value shows where it came from (case file, a document page, or "entered by employee"). |
| Upload extra documents | ✅ Tested | PDF, Word (.docx), text, PNG and JPEG. Files are checked and encrypted before storage. |
| Draft Word document | ✅ Tested | A real .docx built from the firm's Word template. |
| Draft PDF | ✅ Tested | Uses LibreOffice when installed (exact match to the Word template), otherwise a built-in renderer. |
| Flags for missing, conflicting and unsupported items | ✅ Tested | E.g. the Thompson case flags the missing orthopedic bill and the accident-date conflict (Clio says 15 March, police report says 14 March). |
| Source references ("where did this come from?") | ✅ Tested | Each fact links to the document and page it came from. |
| Edit sections and re-generate | ✅ Tested | |
| Submit for attorney review / withdraw | ✅ Tested | |
| Download approved documents | ✅ Tested | Drafts carry a DRAFT watermark; approved final files do not. |

## The two starting skills

| Skill | Status | Notes |
| --- | --- | --- |
| Write a Demand Letter | ✅ Tested · 🟡 Demonstration template | Medical specials and lost wages are added up by the software, never by AI (Thompson: $13,077.00 + $2,772.00 = $15,849.00). The letter template is a **demonstration** template and must be replaced with the firm's approved letterhead template. |
| Create an Arbitration Package | ✅ Tested · 🟡 Demonstration requirements | Builds one organized PDF: cover sheet, exhibit index, slip sheets, exhibit labels, Bates numbers, page numbers and bookmarks. The list of required exhibits is a **demonstration** list, clearly labeled in the app — it has **not** been checked against AAA rules and must be replaced by the firm. |

## Attorney review

| Feature | Status | Notes |
| --- | --- | --- |
| Review queue, approve or request changes, with comments | ✅ Tested | |
| Mandatory review cannot be turned off by editing a skill | ✅ Tested | Built into the system, not into skill settings. |
| An attorney cannot approve their own work | ✅ Tested | Default setting; a System Administrator can change it. |
| Approval history kept | ✅ Tested | |
| Nothing is ever sent, filed or emailed by the system | ✅ By design | There is no send/file/email function in the code. |

## Administrator portal

| Feature | Status | Notes |
| --- | --- | --- |
| Add employees, assign roles, enable/disable skills per employee | ✅ Tested | Only a System Administrator can create another System Administrator. The last Firm Administrator cannot be removed. |
| Suspend an employee (signs them out everywhere immediately) | ✅ Tested | Confirmed that a suspended employee's existing session stops working at once. |
| Skill Builder: create a new skill with a guided form | ✅ Tested | Questions, documents, calculations, letter sections, output format, instructions. |
| Skill versions: Draft → Testing → Approved → Published → Archived | ✅ Tested | Significant changes require attorney approval; cosmetic changes (name, description, icon, category) do not. |
| Test a skill with fictional data before publishing | ✅ Tested | Tests can only use the fictional sample case. |
| Restore an earlier skill version | ✅ Tested | |
| Word template upload and check | ✅ Tested | The file is screened (macros, outside links) and its placeholders are listed. If the `{{@body}}` placeholder (where the drafted text goes) is missing, the app warns you and shows it in the template list. |
| Interface Editor: branding, home screen, skill cards, navigation | ✅ Tested | Colors that are too hard to read (below WCAG contrast 4.5:1) are refused. |
| Preview as phone/tablet/desktop and as a particular employee | ✅ Tested | |
| Publish and roll back the interface | ✅ Tested | |
| Activity log (who did what, when) | ✅ Tested | Document contents and secrets are never written to the log. |
| Emergency switch to stop all drafting | ✅ Tested | |
| Settings: AI provider, limits, retention, Clio field mapping | ✅ Tested | Only System Administrators can change these. |

## Outside services

| Service | Status | What's needed to finish |
| --- | --- | --- |
| Microsoft 365 sign-in (Entra ID) with MFA | 🟠 Unverified | Firm creates an app registration and turns on MFA with Conditional Access. See [ENTRA-SETUP.md](ENTRA-SETUP.md). |
| Clio Manage | 🟡 Simulated (fictional matters) · 🟠 Unverified (live adapter) | Firm creates a Clio developer application; then a live test with a test matter. The app shows "not yet verified" until then. See [CLIO-SETUP.md](CLIO-SETUP.md). Clio's official documentation could not be reached from the build environment, so the live adapter follows Clio's published v4 conventions as found in secondary sources and must be checked against Clio's current documentation. |
| Save approved documents back to Clio | 🟠 Written, not switched on | The adapter has the upload function, but there is no button for it yet. It should only be switched on after live Clio testing. |
| AI provider (Anthropic Claude) | 🟡 Simulated (demonstration AI) · 🟠 Unverified (live) | The demonstration AI is a fixed rule-based reader that needs no account. The real Claude connection is written and tested against pretend responses; it needs the firm's API key, a contract/data-handling review, and a live test. See [AI-PROVIDER-SETUP.md](AI-PROVIDER-SETUP.md). |
| Azure hosting | 🟠 Unverified | The Azure template ([infra/main.bicep](../infra/main.bicep)) has **not** been run or validated (the Azure tools could not be downloaded in the build environment). Nothing has been deployed and no costs have been incurred. See [DEPLOYMENT-AZURE.md](DEPLOYMENT-AZURE.md). |
| Azure Blob Storage, Key Vault, managed identity | 🟠 Unverified | Code is written; only the local encrypted-file storage was tested. |
| Container image (Dockerfile) | 🟠 Unverified | Docker could not run in the build environment. The same start-up steps were simulated without Docker and worked. |
| Antivirus (ClamAV) | 🟠 Unverified | Built-in checks (file type, test virus signature, PDF scripts, Word macros) are tested. A full antivirus scan needs a ClamAV server (`MALWARE_SCANNER=clamav`); the connection code is written but untested. Azure's own storage malware scanning cannot help here, because the app encrypts files before they reach storage. |
| OCR (reading scanned pages) | ⬜ Not built | Images and scanned PDFs are accepted but flagged "please review this file yourself". |

## Security items

See [SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md) for the full list, including what must be done
in Azure and Microsoft 365 by the firm.

## Remaining outside prerequisites (things only the firm can provide)

1. **Authorization to spend on Azure** and an Azure subscription owned by the firm.
2. **Proof of control of `windycitylawfirm.com`** (DNS access) to use `ai.windycitylawfirm.com`.
3. **Microsoft Entra app registration** (an IT administrator for the firm's Microsoft 365) and a
   Conditional Access policy requiring MFA.
4. **Clio developer application** (client ID and secret) and a test matter for live testing.
5. **AI provider agreement and API key**, after the firm reviews data retention, training use,
   contract terms and security (the app will not use a real AI provider until a System Administrator
   records this review).
6. **The firm's approved Word letterhead template(s)** to replace the demonstration template.
7. **Approved arbitration exhibit requirements** (AAA UM/UIM and any local rules) to replace the
   demonstration list.
8. **Retention periods** approved by the firm (defaults: working files 45 days, test runs 7 days).
9. **An independent security review / penetration test** before real client data is used.

## Continuing development

Everything needed to continue is in this repository. A developer should:

1. Read [ARCHITECTURE.md](ARCHITECTURE.md).
2. Run `npm install`, `npm run setup`, `npm run dev` (see the [README](../README.md)).
3. Run `npm run typecheck`, `npm test` and `npm run test:e2e` before and after any change.
4. Next suggested work, in order:
   1. Live Entra test in a staging environment (see [ENTRA-SETUP.md](ENTRA-SETUP.md) checklist).
   2. Validate and deploy the Azure template to a **staging** resource group (after cost approval).
   3. Live Clio test and correction of the adapter against Clio's current documentation, then remove the "unverified" label (`verified` flag in `src/server/integrations/clio/live.ts`).
   4. Live AI provider test with fictional documents only; compare results with the demonstration AI.
   5. Optional: "Save to Clio" button for approved documents; OCR for scanned records.

### Progress record

| Phase | Result |
| --- | --- |
| 1 — Foundation (database, sign-in, permissions, both portals) | Done, tested |
| 2 — Demand letter and arbitration package with real Word/PDF output | Done, tested |
| 3 — Skill Builder with versions, testing, approval, publishing, restore | Done, tested |
| 4 — Interface Editor with preview, publish, rollback | Done, tested |
| 5 — Security and testing | Done for everything that can run locally; see SECURITY-CHECKLIST for items that need Azure/Microsoft 365 |
| 6 — Outside services | Adapters written; Clio and AI tested with pretend responses; live tests pending credentials |
| 7 — Deployment readiness | Azure template, Dockerfile, migrations, environment documentation, backup and monitoring guidance written; not validated or deployed |
