# Security checklist

This lists each security requirement, what the application does about it, whether that was
tested, and what the firm (or its IT provider) still has to do. **It is not a certification.**
The application has not had an independent security review or penetration test, and it should not
be described as compliant with any standard (for example SOC 2, HIPAA or ISO 27001) or as
"production-ready" until it has, and until the items marked **Firm** are done.

"Tested" means an automated test that was actually run checks it (see [TEST-RESULTS.md](TEST-RESULTS.md)).

## What the application does

| Requirement | What the application does | Tested? | Firm still needs to |
| --- | --- | --- | --- |
| Sign-in with Entra ID | Microsoft sign-in (OpenID Connect + PKCE, MSAL); only the firm's tenant; only people added in the app; Microsoft account linked on first sign-in; state and nonce checked. The fictional sign-in is impossible when `APP_ENV` is staging/production. | Redirect checked; refusal paths tested; **live sign-in not tested** | Create the app registration; run the live checklist in [ENTRA-SETUP.md](ENTRA-SETUP.md). |
| MFA | Relies on Entra Conditional Access; optional extra check of the `mfa` claim. | No (needs Entra) | Create the Conditional Access policy. |
| Server-side authorization | Every API request checks the session, the role and (for work) ownership on the server. Hiding a button is never the only protection. Someone else's work answers "not found", so its existence isn't revealed. | Yes — including calling the API directly, bypassing the screens | — |
| Individual skill permissions | A skill is usable only if published, turned on, and granted to that person. | Yes | — |
| Matter-level permissions | With Clio, every request uses the employee's own Clio login, so Clio enforces access. Reviewers can open submitted work only if they can see the matter themselves. Documents must belong to the opened matter. | Yes with fictional cases (restricted Hartley matter); **live Clio not tested** | Live Clio test ([CLIO-SETUP.md](CLIO-SETUP.md)). |
| Session invalidation | Sessions are stored in the database (only a hash of the token); idle and absolute time-outs; sign-out; suspension deletes all of a person's sessions and Clio connections immediately. | Yes | Choose time-outs (`SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`). |
| Cookies | `HttpOnly`, `SameSite=Lax`, `Secure` and the `__Host-` prefix when served over HTTPS. | Yes (production mode checked) | — |
| Cross-site request forgery | Every change request must come from the app's own address (Origin check) or carry the app's own request header. | Yes | — |
| Browser protections | Content-Security-Policy with a per-request nonce; frame-ancestors self; HSTS; X-Content-Type-Options; Referrer-Policy; Permissions-Policy; X-Frame-Options. | Yes (browser test against the production build) | — |
| TLS | Azure template: HTTPS only, TLS 1.2 minimum, database requires TLS. | **No** (template not deployed) | Custom domain with managed certificate. |
| Encryption at rest | Every stored file is encrypted by the app (AES-256-GCM) before it reaches storage, plus Azure's own storage and database encryption. | App encryption: yes. Azure: not deployed | Back up the file-encryption key offline. |
| Secrets | Secrets only in Key Vault, read by the app's managed identity; never in browser code, logs or the repository. The app refuses to start in production without required secrets. | Startup refusal: yes. Key Vault: not deployed | Keep secrets out of email/documents; rotate the Entra secret before it expires. |
| Audit log | Sign-ins, refusals, access denials, uploads (accepted and rejected), drafts, submissions, approvals, skill/interface/settings changes, suspensions, emergency stop. Records never contain document text, answers, prompts, tokens or passwords (filtered automatically). | Yes | Decide how long to keep it; review it regularly. |
| No confidential files in logs | The app never writes document contents to server logs; unexpected errors are logged with their technical message. AI usage records hold metadata only. | Audit filtering: yes | Keep App Service logging at the default level. |
| Rate limiting | Per person (or per address before sign-in), per action, in the app. Per-person daily AI limit and a firm-wide monthly AI budget. | Yes (limiter, a real route returning 429, and the AI daily limit) | With more than one app instance, add Front Door WAF rate limiting. |
| Upload validation | Allowed types only (PDF, DOCX, TXT, PNG, JPEG) checked by the file's actual contents, size limit, safe file names; rejects PDFs with scripts or encryption, Word files with macros or outside links, and the standard antivirus test file. Rejections are logged. | Yes | — |
| Malware protection | Built-in checks above. Optional full scan with ClamAV before encryption. | Built-in: yes. **ClamAV: not tested** | Run a ClamAV server and set `MALWARE_SCANNER=clamav` (see [DEPLOYMENT-AZURE.md](DEPLOYMENT-AZURE.md#hardening-recommended-before-real-client-data)). |
| Retention limits | Uploaded working files and extracted text are deleted after the retention period (default 45 days, never while waiting for review); test runs after 7 days; expired sessions removed. Runs every 6 hours. | Yes | Approve retention periods. |
| Secure backups | Template: database backups 35 days, blob soft delete + versioning, Key Vault soft delete + purge protection. | **No** (not deployed) | Test a restore once a year. |
| Access monitoring | Activity log in the app; template sends App Service logs to Log Analytics. | Activity log: yes | Set up availability test and alerts; review Entra sign-in logs. |
| Separation between employees | Employees see only their own work. Attorneys see submitted work only for matters they can access, and not their own work unless allowed. Administrator test runs are visible only to administrators. | Yes | — |
| AI provider governance | A real AI provider is blocked until a System Administrator records the four-part data-governance review; switching provider clears the review. Credentials only on the server. | Yes | Complete the review honestly ([AI-PROVIDER-SETUP.md](AI-PROVIDER-SETUP.md)). |
| Prompt injection | Uploaded text is treated as data, fenced off from instructions; the AI is told to ignore instructions inside documents; answers must match a fixed structure; quotes are checked against the page; amounts, dates and legal citations in drafts are checked against the case information; numbers are calculated by software. | Yes (with the demonstration engine and pretend AI responses) | Live test with a planted instruction ([AI-PROVIDER-SETUP.md](AI-PROVIDER-SETUP.md#live-test-with-fictional-documents)). |
| Legal safeguards | Attorney approval is built into the system and cannot be removed by editing a skill; drafts are watermarked; the system has no function to send, file or email anything. | Yes | — |
| Secure administrative actions | Role checks on every admin action; only a System Administrator can create one; last Firm Administrator can't be removed; you can't suspend yourself; significant skill changes need attorney approval; all changes logged. | Yes | Keep the number of administrators small. |
| Accessibility (WCAG 2.2 AA) | Automated scan of 16 screens (no serious or critical issues allowed), keyboard-only use, phone and tablet layouts. | Yes (automated) | A manual review with assistive technology is still recommended. |
| Dependencies | Exact versions locked in `package-lock.json`. | — | Run `npm audit` and update dependencies regularly. |

## Before the first real client document

- [ ] Independent security review / penetration test of a staging deployment.
- [ ] Entra live test checklist completed ([ENTRA-SETUP.md](ENTRA-SETUP.md#live-test-checklist)); Conditional Access MFA policy **On**.
- [ ] `APP_ENV=production`, `SEED_DEMO_DATA=false`; the demonstration banner is gone; the fictional sign-in returns "not found".
- [ ] File-encryption key backed up offline; restore tested.
- [ ] Private networking and antivirus decisions made and recorded ([DEPLOYMENT-AZURE.md](DEPLOYMENT-AZURE.md#hardening-recommended-before-real-client-data)).
- [ ] Monitoring alerts set and going to a person who reads them.
- [ ] Clio live test completed, or Clio left in demonstration mode and documents uploaded manually.
- [ ] AI provider reviewed and the governance review recorded, or the demonstration engine kept.
- [ ] The firm's approved letter templates and arbitration requirements replace the demonstration ones, with attorney approval.
- [ ] Retention periods approved.
- [ ] Administrators and attorney reviewers reviewed; everyone else is an Employee only.
- [ ] Staff told: drafts are drafts; nothing leaves the firm without attorney approval; don't upload anything not related to the matter.

## If something goes wrong

1. **Pause all document creation** (Administration → Overview) — stops all reading and drafting.
2. **Suspend** any affected account (Administration → Manage Employees), and disable it in Microsoft 365.
3. If a secret may have leaked: create a new one (Entra client secret, AI key, Clio secret,
   database password) in Key Vault and restart the app. Restarting does **not** sign people out
   (sign-ins are kept in the database): suspend and restore the affected accounts, or have a
   technical administrator clear all sign-ins with `DELETE FROM auth_sessions;`.
4. Export the relevant **Activity** entries and the App Service logs for the period.
5. Follow the firm's incident-response and client-notification obligations.
