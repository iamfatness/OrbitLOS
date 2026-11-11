# UWM outbound API release — November 11, 2026

- Published source `8187613` to stage version `e920eff0-5350-468e-a48a-a57b91ad4cec` and production version `8b5945ac-d846-473c-8874-eaf3da03f483`, both at 100%. Includes production CRM source `a0a6b3277b57`.
- Authenticated `/api/uwm-file` and `/api/uwm-file/read` implement reviewed import/create/upload/scan/amend/commit, held documents/attachments/submission, lightweight product search, float/lock/relock/extension/cancellation, activity and explicit staff reconciliation. See [workflow contracts and limitations](uwm-api-workflows.md).
- Final regression suite: **440 passed, 0 failed**. TypeScript, full lint plus final targeted lint, stage build and production build passed.
- Preview assets: two clean 61/61 passes. Live assets: initial propagation 404s, then two clean 61/61 passes. Existing production sign-in, legacy pricing secrets, dedicated user settings and webhook settings were preserved. Both file API routes and all four webhook receivers reject unauthenticated requests on stage and production.
- Stage retained a previously connected user grant, but its renewal now returned HTTP 400. Verified the new behavior in the hosted UI: the rejected grant is retired, the badge changes to Not connected, and the user is asked to reconnect. No new lender submission or financial commitment was made. Production personal login is user-deferred until they return to the desktop.
- **Outstanding acceptance:** approved XML/document storage origins are not installed; actual UWM webhook registration/deliveries and synthetic end-to-end lender writes remain unverified. Existing loan-screen controls still use manual/simulated flows; this release implements backend APIs, not replacement live controls. Status/date/ULAD receipts are retained without automatically changing borrower files.

Earlier sections below are historical.

# Production UWM activation — November 10, 2026

- Created a clean non-pilot **OrbitLOS Production** workspace, `ec2cceac-edb2-4513-bf32-9d6beb24caf4`, owned by the existing signed-in administrator. Existing demo records were not moved.
- Located production credentials in Sanjay Patel's original email. Installed dedicated UWM_USER_* production settings, encryption key and independent production webhook key. Existing stage/demo pricing settings were preserved.
- Published configuration version `436271c0-bd77-4164-a56a-1b24cc6e7d5c`, then corrected the misleading setup empty state in source `0fd2a5f`, version `1d61ac69-6e2c-410c-a73f-75637c265cd7`. The unconfigured card no longer suggests an in-app enable switch.
- Production client-credentials authentication and four disclosure groups succeeded against api.uwm.com. All four production webhook types passed unauthenticated 401, authenticated durable receipt 200, exact duplicate 200 and cross-environment 404 checks. These are Orbit-generated synthetic checks, not actual UWM deliveries.
- Production sign-in form verified in the new workspace. Personal production user login is awaiting the user; stage tokens are not reused. UWM subscription registration and real event delivery remain pending. Live pricing, pipeline sync, submissions, document delivery and locks are not enabled by this account configuration alone.
- Typecheck, targeted ESLint and production build passed. Asset preview reached two clean 90/90 passes; live checks follow the deployment log.

Earlier sections below are historical; production credential and receiver status is superseded by this section.

# Integrations UI and onboarding release — November 10, 2026

- Published source `38f8861` to production version `6b20cec9-7b37-4cb5-85da-5bbd689371fe` at 100%. Includes the Integrations redesign and onboarding recovery through `4a9378a`.
- Account connection is the primary card; configured environment and connection status are separate. Connected accounts show verification/disconnect controls and collapsed reconnect fields. Service readiness has its own card. Delivery activity is collapsed by default and labels event types in plain language.
- Final stage version: `bdb1ab76-1383-475e-856f-ef827103a06e`, source `38f8861`. Post-deploy Google redirects and webhook environment guards passed.
- Stage UI reviewed at desktop and 390px mobile width without horizontal overflow. Expanded receipts and refresh worked. The user's stage UWM sign-in succeeded; a read-only broker-association request was accepted. No live loan submission, document delivery or lock was performed.
- 429 merged tests passed; TypeScript, ESLint and Cloudflare builds passed. Version-override and ordinary-routing assets each reached two clean passes (91/91). Production signed UI and preserved stage pricing/disclosures were verified.
- Production user-write credentials and production webhook registration remain disabled. Stage callbacks passed Orbit-generated synthetic tests; actual UWM-originated delivery is still pending.

# Combined release and stage activation — November 10, 2026

- Source `3f4ee6d` includes CRM manager fixes through `5c86442`, acceptance notes `a585ea2`, dedicated UWM user credentials and authenticated portal contract corrections.
- 428 tests passed, TypeScript and ESLint passed, production and stage Cloudflare builds passed.
- Production published at 100% as `36788277-ef0b-4039-9afc-112d7ec1a77b`; two clean version-override and two clean ordinary-traffic asset passes (92/92). Landing 200, unconfigured production receivers 503, cross-environment 404 and GET 405 verified. Existing pricing configuration retained.
- Stage code published as `231f5f15-2342-4924-80bc-54d098fc12e4`, followed by secret-only activation versions. Separate Google client created with explicit user approval, login verified, temporary Basic password removed.
- Created stage-only non-pilot workspace UWM Integration Test, `b73d9e19-4366-4ece-9467-675c00587a5e`; installed stage user-access and webhook credentials.
- All four stage receivers rejected unauthenticated requests with 401, saved authenticated synthetic requests with 200 and deduplicated their exact retries. Four receipts verified in the signed-in administrator UI. No actual UWM-originated delivery or loan mutation has been verified.
- Other Orbit coding chat was notified of exact source/version and asked to merge this release before future publishing.

Prior release history follows; its earlier missing-stage-configuration statements are superseded above.

# UWM publication validation — November 10, 2026

## Continuation status

Stage now runs source `ff0131a` as version `b58a7456-c8ca-4796-8851-4ae00b01f2c5`. User credentials are isolated from pricing under `UWM_USER_*`, with a preparation command that rejects mismatched environments and refuses to overwrite encryption keys. The full pre-merge suite passed 423 tests; the merged CRM readiness test, TypeScript and ESLint also passed. Stage public, authenticated demo, staff-API rejection and webhook isolation checks passed.

**The production release recorded below was superseded by another active CRM release.** Latest observed production is `bb28be52-5e94-4f9b-b332-7596d4736b12`, source `30c3739`, which does not include this UWM release. That source has been merged into this branch. Another CRM candidate is being verified at 0%; coordinate with that task before promoting the combined source to avoid overwriting either set of changes. The current continuation has not republished production or dev.

The Developer Portal still requires user sign-in; no newer UWM email supplied the missing payload contracts or samples. Stage Google credentials, test brokerage and UWM user access remain prerequisites. The credential separation does not activate live loan actions.

## Earlier publication record

Published application source: `4acce3281077e78c49491ab60876da713aa33a8e` on `release/uwm-live-2026-11-10`. Includes CRM source `ec142e9`; the older root working tree was not published. Later documentation commits do not change the deployed application.

| Host | Cloudflare version | Result |
| --- | --- | --- |
| orbitlos.com | `33812e0a-4437-42e7-81e9-94b3fdce5f75` | Promoted to 100%; public and signed-in smoke passed |
| stage.orbitlos.com | `0b170d28-0cc7-4fe3-8c6d-8821a4fb11f4` | Public, Basic-auth workspace and route/access checks passed |
| dev.orbitlos.com | `9d14b23b-f87c-4427-9c86-cae0646236f9` | Public, Basic-auth workspace and route/access checks passed |

- Final full suite: **421 passed, 0 failed**. TypeScript and ESLint passed after the production CRM merge.
- Dev, stage and production artifact guards passed, confirming their respective Worker, host, R2 bucket, local Durable Object binding and deployment marker.
- Verified the prior live build's 230 assets, retained 199 additional fingerprinted assets, then verified all 245 resulting production assets in two candidate passes and two ordinary-traffic passes.
- Public landing page returns 200. Each deployment's four unconfigured webhook receivers returns 503; cross-environment POST returns 404 and GET returns 405. These are rejection checks, not proof of successful receipt storage on the hosted service.
- Dev and stage workspaces require authentication. Valid Basic auth can open the demo but cannot use staff account or receipt APIs (403).
- Signed-in production pilot admin: Integrations loads the account configuration status, empty receipt list and Refresh latest. Pilot UWM user access remains disabled as intended.
- Existing production UWM stage verification succeeded: authentication and **4 disclosure groups** verified from the deployed application. This checks existing client access, not the new user-password grant or live origination.

Previous production version for rollback: `0c726fcb-f9c8-411a-8046-3cb16353a430`. New SQLite tables are additive. Preserve a copy of the release build if preparing a later rollback with retained assets.

## Not validated or activated

No UWM user-password grant, live loan submission, document delivery, rate-lock action or authenticated webhook delivery has been exercised. The Developer Portal remains at sign-in. Stage Google authentication, a distinct test brokerage, per-environment user-access secrets and webhook configuration are still required. See [activation work](uwm-release.md) and the [UWM message](uwm-webhook-handoff.md).


## Loan-screen API controls — November 11, 2026

Configured non-pilot loans now expose separate reviewed import, document delivery and rate-request controls. Every write has a visible confirmation, explicit environment and preserved intent ID after an uncertain response. Uploaded files remain separate from underwriting delivery. The existing pilot behavior is preserved.

Local acceptance used the actual React component with synthetic local API responses only: branch/contact selection, reviewed XML, scan correction, separate commit, held-document attachment and underwriting submission, product search, float and full lock terms, confirmation back-navigation preserving entered values. A 390-pixel viewport had no horizontal overflow. No real borrower file or financial request was sent. Screenshots are in the ignored release `.orbit/uwm-loan-confirmation.png` and `.orbit/uwm-loan-mobile.png`.

460 automated tests passed, plus typecheck and full lint. Includes rate-body tests for explicit choices, decimal rates, correct numeric/string types, and full relock/extension fields. UWM-approved storage origins and actual lender end-to-end acceptance remain outstanding. Personal login status must be verified independently; an Orbit Google session does not establish a UWM grant.


Published source `ef4a99b0c16a76f6f2eb3268b3cb83ccd746987b` to production Worker `f5085d5b-2a68-4738-910a-030346811b93` at 100%; predecessor `f6ffd915-a3bc-477c-a147-bbe03dde9f05` remains at 0%. Includes the other release through `28fae8e`, including maintenance fingerprint fix `4817b85`. All 23 configuration bindings exactly matched the predecessor. Retained predecessor browser assets; staged and ordinary routing each passed two clean 344/344 asset checks. Unauthenticated file, file-read and import-webhook POSTs each returned 401.

Signed-in production acceptance confirmed updated Integrations service guidance and Loan controls ready labels. Production personal UWM account still displays Not connected; no production lender request was made. Saved screenshot: `.orbit/uwm-production-published.png`. Approved upload origins, actual UWM webhook delivery and end-to-end stage lender acceptance remain external dependencies. This publication updates production; stage remains on its earlier backend release.


## Workspace entry and organization — November 11, 2026

Unqualified workspace entry now prefers the accessible, unpaused configured UWM workspace, then another operational workspace. Explicit requested workspaces and guide entry remain authoritative; no membership is granted. Untargeted Google sign-in returns through that default selection. Generated demo links now explicitly select `orbit-demo`, preventing the default production redirect from stealing demo navigation.

Team > Workspaces shows operational workspaces separately and collapses fictional demo/pilot workspaces into a searchable section with short references for duplicate names. No workspace records, staff access or loan data are deleted or changed. Pipeline/conditions service guidance now identifies the missing brokerage Insights access and distinguishes it from personal login. The forwarded Public APIs email contains no separate Insights grant.

461 tests, typecheck and lint passed before final callback adjustment; focused auth tests and build verify the final candidate. Actual component browser acceptance checked collapsed defaults, filtering, explicit demo links and 390px width without horizontal overflow.
