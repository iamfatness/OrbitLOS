# UWM webhook onboarding — OrbitLOS

Updated November 10, 2026. Receivers are implemented on all three isolated hosts. **Stage and production are configured and passed authenticated synthetic delivery and duplicate tests for all four receivers. UWM registration and delivery from UWM remain pending.** INT is not configured. See [release scope and activation](uwm-release.md) for the account flows and remaining live-operation work.

Validation: the initial publication passed its regression tests, TypeScript and ESLint. Builds and hosted checks are recorded in [release validation](uwm-release-validation.md). No delivery originating from UWM has been verified. Orbit-generated stage tests are saved as receipts 1–4 in the UWM Integration Test workspace.

## Message to share with UWM

To: apionboarding@uwm.com (loan imports), apisupport@uwm.com (status, conditions and ULAD exports)

Subject: OrbitLOS — webhook registration and end-to-end validation

Hello UWM team,

Our stage and production receivers are configured and have passed authenticated synthetic delivery and duplicate tests. Please register the subscriptions for both environments and coordinate synthetic end-to-end deliveries before sending real loan events.

| Subscription | Stage receiver | Production receiver |
| --- | --- | --- |
| Loan import completion and failure | `https://stage.orbitlos.com/api/webhooks/uwm/stage/import` | `https://orbitlos.com/api/webhooks/uwm/production/import` |
| Important dates and loan status | `https://stage.orbitlos.com/api/webhooks/uwm/stage/status` | `https://orbitlos.com/api/webhooks/uwm/production/status` |
| Condition changes | `https://stage.orbitlos.com/api/webhooks/uwm/stage/conditions` | `https://orbitlos.com/api/webhooks/uwm/production/conditions` |
| Full loan ULAD XML exports | `https://stage.orbitlos.com/api/webhooks/uwm/stage/ulad` | `https://orbitlos.com/api/webhooks/uwm/production/ulad` |

INT receivers use `https://dev.orbitlos.com/api/webhooks/uwm/int/{import|status|conditions|ulad}`. Each deployment accepts only its assigned UWM environment. Please confirm which environments each subscription supports before activation.

Authentication: `X-API-Key: <environment-specific webhook key>` (confirmed by Sanjay Patel on November 10, 2026). Separate stage and production keys are ready to share through an agreed secure channel. INT is not yet enabled. This is a dedicated inbound webhook credential, separate from our UWM OAuth client secret. Do not put credentials in the URL.

Content type: `application/json` for imports, dates/status and conditions; `application/xml` or `text/xml` for ULAD. Use UTF-8, uncompressed request bodies, one event/file per request. Our body limit is 1 MiB. Thank you for confirming this is sufficient; we will validate it against Phil’s export samples.

We acknowledge durable receipt with HTTP `200 OK`, including exact retries. Acknowledgement does not indicate that the event has changed an Orbit loan. `503` means receipt was not confirmed and delivery should be retried. Invalid authorization returns `401`; invalid payloads `400`; unsupported formats `415`; oversized bodies `413`.

Please confirm:

1. Please confirm subscription registration in INT, stage and production. We understand the broker entities/branches are determined by the authenticated UWM user, and user-authorized API access requires both the supplied client credentials and that user’s credentials. Incoming webhooks will use our dedicated X-API-Key.
2. We verified document 91: import outcomes use `Completed` and `NotCompleted`, with nullable `LoanNumber` and `LoanStatus`. Please confirm whether the same transaction can produce multiple outcome notifications and send stage success/failure deliveries.
3. Thank you for confirming dates/status payloads include the loan number. Please supply a complete synthetic event so we can verify its exact field path/type and broker context. Is `id` stable on redelivery, and what is the occurrence timestamp?
4. Your email says condition fields are non-null, but document 119 explicitly shows `conditionSatisfactionDate: null` for outstanding conditions. Our receiver preserves either form. Please confirm the current contract and the timestamp/version used to order clearance and reopening events.
5. ULAD: thank you for the November 11 example. We verified its MISMO 3.4 LenderLoan identifier path and retained the original XML. Please confirm this identifier contract for all exports, export status triggers, maximum file size, and any event ID/version/timestamp headers. Orbit currently archives these exports for reconciliation; it does not overwrite the borrower application from XML.
6. Please provide the approved stage and production Azure storage origins for XML transaction uploads and condition-document uploads. Our uploader uses an explicit origin allowlist and does not forward OAuth credentials to storage. Please also confirm the document upload method (portal document 75 specifies POST binary, while XML document 41 specifies PUT BlockBlob) and supply an approved synthetic MISMO file for acceptance testing.
7. The import response-code page does not establish the webhook delivery policy. Please confirm retry schedule, timeout, retention/replay window, delivery ordering, duplicates, concurrent deliveries, how to request replay, and whether registration sends a challenge.

For validation, please send an import success and failure, an exact duplicate delivery, two updates to the same condition (including a reopen), a status/date event, and a sample ULAD file. We will verify saved receipts and correlation before enabling automatic loan updates.

Thank you.

## Production setup

- Workspace: **OrbitLOS Production**, `ec2cceac-edb2-4513-bf32-9d6beb24caf4`, on orbitlos.com. No demo loans were copied into it.
- Installed the production-specific Public API client credentials from Sanjay’s original November 10 email, separate token encryption key and production-only webhook mapping. Existing demo pricing credentials remain unchanged.
- Production client authentication and four disclosure groups were verified against api.uwm.com. Personal production sign-in is separate from stage.
- All four production receivers passed authenticated synthetic receipt and exact-duplicate tests. No actual UWM-originated delivery or production loan mutation has been verified.
- Production key is in `.orbit/uwm-webhook-credentials.production.txt` inside the release worktree. Share only through the agreed secure channel.

## Current stage setup

- Workspace: **UWM Integration Test**, `b73d9e19-4366-4ece-9467-675c00587a5e`. Normal non-pilot workspace on stage only, containing synthetic receiver tests.
- Google login is configured and verified. Stage user-authorized UWM client credentials and encryption key are installed; the personal UWM login succeeded and UWM accepted the read-only broker-association request. Actual branch/contact mapping and lender writes still require validation.
- Stage credential file: `.orbit/uwm-webhook-credentials.stage.txt` inside the release worktree. Contains the inbound key; share it only through the agreed secure channel, not in a ticket or repository.
- Each receiver returned 401 without the key, 200 after durable authenticated receipt, and 200 with duplicate=true for the identical retry. Wrong-environment path returned 404. All four receipts were visible to the signed-in stage administrator.

## Orbit operator checklist

1. Select a distinct existing, non-pilot Orbit brokerage UUID for each enabled environment. Use a dedicated test workspace for INT/stage. The receiver refuses `orbit-demo`, unknown/pilot brokerages, shared environment workspaces and shared tokens. Do not route real borrower payloads into a fictional demo.
2. Generate the config with `node scripts/prepare-uwm-webhooks.mjs --stage <test-brokerage-uuid> --production <production-brokerage-uuid>` (omit environments not being enabled; `--int` is also supported). This creates separate `.orbit/uwm-webhook-config.<environment>.json` and `.orbit/uwm-webhook-credentials.<environment>.txt` files, all Git-ignored. It refuses to overwrite existing credentials. Share only the applicable token from the credentials file with UWM through the agreed secure channel.
3. Install the JSON as the Cloudflare Worker secret `UWM_WEBHOOK_CONFIG`. In PowerShell: `Get-Content -Raw .orbit/uwm-webhook-config.stage.json | node node_modules/wrangler/bin/wrangler.js secret put UWM_WEBHOOK_CONFIG --config wrangler.jsonc --env stage`. That example installs stage only. For INT use the `.int.json` file and `--env dev`; for production use `.production.json` and omit `--env`. Never install another environment’s config. Keep this JSON out of `wrangler.jsonc`, tickets and emails. For local Wrangler testing, supply the same secret through `.dev.vars`; these routes belong to the Worker and are not available through standalone `next dev`.
4. For stage use `npm run build:cloudflare:stage` then `npm run deploy:cloudflare:stage`; substitute `dev` for development. Production retains `npm run build:cloudflare` and `npm run deploy:cloudflare`. The release guard rejects a build for a different target. See [environment setup](environments.md). The release script requires the verified `ORBIT_DEMO_INBOX` from the existing release configuration. Deployment publishes the current working tree, including unrelated changes; review that release before publishing.
5. Verify an unauthenticated POST returns `401` for a configured environment. Send a synthetic authenticated event; confirm `200`, then repeat it and confirm `receipt.duplicate: true`. Confirm the saved receipt in the selected brokerage. Do not register URLs as ready until these hosted checks pass.
6. Sign in as the target brokerage's admin and open `/api/uwm-webhook-receipts?brokerage=<uuid>`. The response lists up to 50 receipts without raw payloads. Page with `&before=<last-id>`. Retrieve one original payload with `&receipt=<id>`. These endpoints require admin access to that workspace and use no-store responses. Treat retrieved payloads as private borrower data.
7. Agree the UWM contracts above and validate actual deliveries before wiring automatic downstream changes. Receipts remain **Awaiting reconciliation**. Import outcomes can correlate to a previously recorded outbound operation by exact environment and transaction ID, and authenticated outbound workflows are now exposed through the [file API](uwm-api-workflows.md). Actual UWM acceptance remains pending. Receipts do not mutate applications, submissions, conditions or rate locks, or parse ULAD into a 1003. Recognized ULAD lender identifiers now route exports to an already verified workspace mapping. The existing Insights sync remains the supported source for pipeline/condition refreshes.

## Delivery and storage behavior

- Each environment has a configured reconciliation inbox. A registered import receipt goes to the originating workspace. The workspace must confirm the exact transaction was committed before Orbit reserves a lender loan number. A receipt first received before commit stays held on retry. Changes to JSON formatting or the message do not clear the hold when the transaction, loan number, status, and lender timestamp match. Later condition and ULAD receipts require the exact completed import and its canonical receipt. An unverified reservation, including one from an earlier release, sends those events to the reconciliation inbox. No event is broadcast or assigned to an arbitrary caller-selected workspace.
- A saved receipt can be retried if the directory or workspace stops before completion. A reservation cannot route condition or ULAD traffic during that gap. The first eligible loan number stays reserved on an interruption. Conflicting legacy rows need operator review and remain unverified for downstream routing. An exact retry of a confirmed mapping preserves its original receipt.
- Receipts are written transactionally in that brokerage's private Durable Object SQLite storage before `200`. Exact body retries reuse the saved receipt. Different payloads sharing a status event ID are both retained for investigation. Condition IDs are never treated as unique delivery IDs because they recur across updates.
- Imports retain the transaction ID separately from the permanent loan number, including failures with no loan number. Unknown/unmatched events are preserved; no loan is guessed or created from an unsolicited callback.
- Original JSON and opaque ULAD bodies are retained. The XML receiver rejects DTD/entity declarations and does not resolve external references. The supplied ULAD example now supports strict lender-identifier extraction and workspace routing; full XML schema validation and borrower-field application remain unimplemented. See [sample validation](uwm-xml-examples.md). Request bodies and API-key headers are not explicitly logged by this implementation.
- Receipts are retained until an agreed retention policy is implemented. In the reconciliation inbox, an active admin of both workspaces can use **Match to verified loan** for a saved condition or ULAD receipt after the exact import and lender loan number are verified. Matching preserves the inbox entry and saves one copy in the destination Delivery activity. A retry reuses that copy. Matching is manual and does not apply the payload to the loan. Monitor volume and reconcile before enabling high-volume production exports.
- For token rotation, set a new `token` and retain the old value temporarily as `previousToken` in that environment's secret entry. After UWM switches and a test succeeds, remove `previousToken`. Never reuse a token across environments. Removing an environment entry disables it with `503` and does not delete receipts.

Contract sources: [Import setup](https://developers.uwm.com/portal/loan-origination/docs/108), [import result](https://developers.uwm.com/portal/loan-origination/docs/91), [dates/status](https://developers.uwm.com/portal/export-date-status/docs/121), [conditions](https://developers.uwm.com/portal/condition/docs/119), [ULAD](https://developers.uwm.com/portal/export-loan/docs/125). Implementation uses the saved reference plus Sanjay Patel’s November 10, 2026 email clarification. The portal remained inaccessible through the web tool, so complete sample-payload validation remains required. See [confirmed answers and remaining gaps](uwm-onboarding-answers.md).

## Check a matched copy after a restore

An admin of both workspaces can use **Check saved copy** on the matched row in the reconciliation inbox. Orbit checks the original lender route and committed import evidence, then locates the exact body or saves it again when missing. An inbox receipt retains its original match time. If recovery produces a new destination receipt ID, Orbit updates the reference and records a reconciliation entry. When the directory or import evidence is unavailable, the check cannot confirm the match. Matching continues to archive receipts for review.

The isolated Cloudflare rehearsal restored the destination to the point before the copy existed, confirmed that a different delivery reused the old numeric ID, and recovered one exact copy. It also restored an older directory, refused matching without its route, and confirmed recovery after returning to the verified directory point. This used synthetic callbacks and did not contact UWM. [Hosted recovery evidence](evidence/hosted-uwm-match-recovery-2026-11-11.json)
