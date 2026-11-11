# UWM release scope and activation

November 10, 2026. Release branch: `release/uwm-live-2026-11-10`, based on deployed production source `abf1863`. This release preserves existing CRM and stage pricing behavior. It is not certification of a live UWM origination integration.

## Included

- Isolated dev, stage and production build/deploy targets and webhook receivers using UWM's confirmed `X-API-Key` authentication.
- Durable receipts, duplicate detection, size limits and an admin receipt viewer in Integrations. Original payloads remain available through the admin-only receipt API.
- Per-user UWM connection, disconnect and read-only broker-access verification in Integrations. Passwords are not persisted; access and refresh tokens use AES-256-GCM encryption bound to brokerage, user and environment. Token refresh preserves the existing refresh token when UWM does not rotate it.
- Backend public API transport and durable operation records with no automatic retry after an uncertain outcome. Import callbacks correlate only by an exact recorded transaction and environment, without overwriting a borrower application.

Live submission, condition-document delivery and rate-lock commands are **not exposed**. Their operation-specific payload mapping and actual stage validation remain unfinished. Generic transport methods do not establish compatibility with UWM's business contracts.

## Activation still required

1. Enable stage Google sign-in and create a separate non-pilot brokerage containing synthetic files; see [environments](environments.md). Production remains the current company workspace. A company UWM login may be used for testing only after UWM confirms that account's stage broker/branch access.
2. Configure `UWM_BROKERAGE_ID`, `UWM_ENVIRONMENT`, `UWM_CLIENT_ID`, `UWM_CLIENT_SECRET`, and an independently generated 32-byte hexadecimal `UWM_TOKEN_ENCRYPTION_KEY` on each intended Worker. Stage requires `UWM_ENVIRONMENT=stage`; production user access requires `production`. The pre-existing production stage-pricing credentials are not sufficient to activate production user access. Never replace them casually: validate pricing configuration separately before switching credentials.
3. Sign in to UWM through Orbit Integrations on stage and run **Verify UWM broker access**. This is a read-only association request; it does not certify the selected branch or submit a file. No UWM user credentials have been supplied or tested during this release.
4. Follow the [webhook handoff](uwm-webhook-handoff.md): select brokerage mappings, generate/install separate inbound keys, run a hosted synthetic delivery and duplicate, and securely supply the relevant key to UWM. Until this is done, the matching receiver returns `503`; it must not be represented to UWM as activated.
5. Use authenticated Developer Portal contracts and UWM's synthetic samples to finish the live request mappings and UI dispatch flows. Validate create/upload/scan/commit, callback correlation, condition attachments/submission, and float/lock/change/cancel independently in stage. `UWM_STORAGE_ORIGIN` must be verified for signed XML uploads. Validate status/condition/XML application before enabling automatic updates.

Account tokens never appear in API responses. The admin receipt detail endpoint contains private payloads; do not copy it into logs or support tickets. Disconnect removes stored authorization for that user and brokerage; it does not revoke the upstream UWM grant.

## Verification and publication

The complete regression suite passed 420 tests, including user-token encryption, disconnect races, refresh, outbound uncertainty, import correlation, webhook dedupe and deployment isolation. TypeScript and ESLint checks passed. Hosted release versions and checks are recorded in `uwm-release-validation.md` after publication. No live lender write or authenticated UWM webhook has been tested.
