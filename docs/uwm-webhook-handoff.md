# UWM webhook onboarding — OrbitLOS

Prepared November 10, 2026. Receivers are implemented for the three isolated hosts. UWM secrets and brokerage mappings are not configured. **UWM registration and authenticated delivery validation remain pending.** Activate only after the operator checklist below passes. See [release scope and activation](uwm-release.md) for the account flows and remaining live-operation work.

Validation: the initial publication passed its regression tests, TypeScript and ESLint. Builds and hosted checks are recorded in [release validation](uwm-release-validation.md). No authenticated UWM delivery has been verified.

## Message to share with UWM

To: apionboarding@uwm.com (loan imports), apisupport@uwm.com (status, conditions and ULAD exports)

Subject: OrbitLOS — webhook registration and end-to-end validation

Hello UWM team,

We are implementing the OrbitLOS integration and would like to register and validate these HTTPS POST receivers. Please start with stage and synthetic loan data; we will coordinate production enablement separately.

| Subscription | Stage receiver | Production receiver |
| --- | --- | --- |
| Loan import completion and failure | `https://stage.orbitlos.com/api/webhooks/uwm/stage/import` | `https://orbitlos.com/api/webhooks/uwm/production/import` |
| Important dates and loan status | `https://stage.orbitlos.com/api/webhooks/uwm/stage/status` | `https://orbitlos.com/api/webhooks/uwm/production/status` |
| Condition changes | `https://stage.orbitlos.com/api/webhooks/uwm/stage/conditions` | `https://orbitlos.com/api/webhooks/uwm/production/conditions` |
| Full loan ULAD XML exports | `https://stage.orbitlos.com/api/webhooks/uwm/stage/ulad` | `https://orbitlos.com/api/webhooks/uwm/production/ulad` |

INT receivers use `https://dev.orbitlos.com/api/webhooks/uwm/int/{import|status|conditions|ulad}`. Each deployment accepts only its assigned UWM environment. Please confirm which environments each subscription supports before activation.

Authentication: `X-API-Key: <environment-specific webhook key>` (confirmed by Sanjay Patel on November 10, 2026). We will supply each token through an agreed secure channel after configuration. This is a dedicated inbound webhook credential, separate from our UWM OAuth client secret. Do not put credentials in the URL.

Content type: `application/json` for imports, dates/status and conditions; `application/xml` or `text/xml` for ULAD. Use UTF-8, uncompressed request bodies, one event/file per request. Our body limit is 1 MiB. Thank you for confirming this is sufficient; we will validate it against Phil’s export samples.

We acknowledge durable receipt with HTTP `200 OK`, including exact retries. Acknowledgement does not indicate that the event has changed an Orbit loan. `503` means receipt was not confirmed and delivery should be retried. Invalid authorization returns `401`; invalid payloads `400`; unsupported formats `415`; oversized bodies `413`.

Please confirm:

1. Please confirm subscription registration in INT, stage and production. We understand the broker entities/branches are determined by the authenticated UWM user, and user-authorized API access requires both the supplied client credentials and that user’s credentials. Incoming webhooks will use our dedicated X-API-Key.
2. We verified document 91: import outcomes use `Completed` and `NotCompleted`, with nullable `LoanNumber` and `LoanStatus`. Please confirm whether the same transaction can produce multiple outcome notifications and send stage success/failure deliveries.
3. Thank you for confirming dates/status payloads include the loan number. Please supply a complete synthetic event so we can verify its exact field path/type and broker context. Is `id` stable on redelivery, and what is the occurrence timestamp?
4. Your email says condition fields are non-null, but document 119 explicitly shows `conditionSatisfactionDate: null` for outstanding conditions. Our receiver preserves either form. Please confirm the current contract and the timestamp/version used to order clearance and reopening events.
5. ULAD: please supply a complete synthetic XML file, the exact UWM loan-number path and identifier type (including namespaces), export status triggers, maximum file size, and any event ID/version/timestamp headers. Orbit currently archives these exports for reconciliation; it does not overwrite the borrower application from XML.
6. The import response-code page does not establish the webhook delivery policy. Please confirm retry schedule, timeout, retention/replay window, delivery ordering, duplicates, concurrent deliveries, how to request replay, and whether registration sends a challenge.

For validation, please send an import success and failure, an exact duplicate delivery, two updates to the same condition (including a reopen), a status/date event, and a sample ULAD file. We will verify saved receipts and correlation before enabling automatic loan updates.

Thank you.

## Orbit operator checklist

1. Select a distinct existing, non-pilot Orbit brokerage UUID for each enabled environment. Use a dedicated test workspace for INT/stage. The receiver refuses `orbit-demo`, unknown/pilot brokerages, shared environment workspaces and shared tokens. Do not route real borrower payloads into a fictional demo.
2. Generate the config with `node scripts/prepare-uwm-webhooks.mjs --stage <test-brokerage-uuid> --production <production-brokerage-uuid>` (omit environments not being enabled; `--int` is also supported). This creates separate `.orbit/uwm-webhook-config.<environment>.json` and `.orbit/uwm-webhook-credentials.<environment>.txt` files, all Git-ignored. It refuses to overwrite existing credentials. Share only the applicable token from the credentials file with UWM through the agreed secure channel.
3. Install the JSON as the Cloudflare Worker secret `UWM_WEBHOOK_CONFIG`. In PowerShell: `Get-Content -Raw .orbit/uwm-webhook-config.stage.json | node node_modules/wrangler/bin/wrangler.js secret put UWM_WEBHOOK_CONFIG --config wrangler.jsonc --env stage`. That example installs stage only. For INT use the `.int.json` file and `--env dev`; for production use `.production.json` and omit `--env`. Never install another environment’s config. Keep this JSON out of `wrangler.jsonc`, tickets and emails. For local Wrangler testing, supply the same secret through `.dev.vars`; these routes belong to the Worker and are not available through standalone `next dev`.
4. For stage use `npm run build:cloudflare:stage` then `npm run deploy:cloudflare:stage`; substitute `dev` for development. Production retains `npm run build:cloudflare` and `npm run deploy:cloudflare`. The release guard rejects a build for a different target. See [environment setup](environments.md). The release script requires the verified `ORBIT_DEMO_INBOX` from the existing release configuration. Deployment publishes the current working tree, including unrelated changes; review that release before publishing.
5. Verify an unauthenticated POST returns `401` for a configured environment. Send a synthetic authenticated event; confirm `200`, then repeat it and confirm `receipt.duplicate: true`. Confirm the saved receipt in the selected brokerage. Do not register URLs as ready until these hosted checks pass.
6. Sign in as the target brokerage's admin and open `/api/uwm-webhook-receipts?brokerage=<uuid>`. The response lists up to 50 receipts without raw payloads. Page with `&before=<last-id>`. Retrieve one original payload with `&receipt=<id>`. These endpoints require admin access to that workspace and use no-store responses. Treat retrieved payloads as private borrower data.
7. Agree the UWM contracts above and validate actual deliveries before wiring automatic downstream changes. Receipts remain **Awaiting reconciliation**. Import outcomes can correlate to a previously recorded outbound operation by exact environment and transaction ID, but no live outbound operation is currently exposed. Receipts do not mutate applications, submissions, conditions or rate locks, or parse ULAD into a 1003. The existing Insights sync remains the supported source for pipeline/condition refreshes.

## Delivery and storage behavior

- Each environment maps to its configured brokerage, never a workspace selected by the caller or payload.
- Receipts are written transactionally in that brokerage's private Durable Object SQLite storage before `200`. Exact body retries reuse the saved receipt. Different payloads sharing a status event ID are both retained for investigation. Condition IDs are never treated as unique delivery IDs because they recur across updates.
- Imports retain the transaction ID separately from the permanent loan number, including failures with no loan number. Unknown/unmatched events are preserved; no loan is guessed or created from an unsolicited callback.
- Original JSON and opaque ULAD bodies are retained. The XML receiver rejects DTD/entity declarations and does not resolve external references. XML schema validation and mapping remain pending UWM samples. Request bodies and API-key headers are not explicitly logged by this implementation.
- Receipts are retained until an agreed retention policy is implemented; there is no automatic purge or replay/apply action. Monitor volume and reconcile before enabling high-volume production exports.
- For token rotation, set a new `token` and retain the old value temporarily as `previousToken` in that environment's secret entry. After UWM switches and a test succeeds, remove `previousToken`. Never reuse a token across environments. Removing an environment entry disables it with `503` and does not delete receipts.

Contract sources: [Import setup](https://developers.uwm.com/portal/loan-origination/docs/108), [import result](https://developers.uwm.com/portal/loan-origination/docs/91), [dates/status](https://developers.uwm.com/portal/export-date-status/docs/121), [conditions](https://developers.uwm.com/portal/condition/docs/119), [ULAD](https://developers.uwm.com/portal/export-loan/docs/125). Implementation uses the saved reference plus Sanjay Patel’s November 10, 2026 email clarification. The portal remained inaccessible through the web tool, so complete sample-payload validation remains required. See [confirmed answers and remaining gaps](uwm-onboarding-answers.md).
