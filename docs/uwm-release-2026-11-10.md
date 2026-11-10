# UWM hosted connection release — November 10, 2026

Deployed to https://orbitlos.com on Worker version `e596597e-9c0e-4083-8547-3c1f62151f9f`, application source `f005578` on `release/uwm-2026-11-10`. The release starts from previously deployed source `a6225e8`, preserving the newer app features absent from the dirty root checkout.

## Verified on the running app

- Signed-in administrator opened Integrations and verified UWM stage authentication plus four disclosure groups from the hosted Worker.
- Opened the fictional Tessa Ito demo file, loaded the sample conventional purchase scenario, and ran pricing through the normal UI.
- The app displayed 35 offers, labeled **UWM stage**, with EQ scenario reference `976236581`.
- No quote was selected, rate locked, application sent, or real borrower submitted during verification.
- Stage client credentials are Cloudflare secrets. Production credentials remain unused.

## Validation

The 383-test regression suite passed. Eight focused UWM tests pass, including a subsequently added test that verifies a pilot command uses server credentials and persists stage offers. Typecheck, lint, Cloudflare builds, deployment dry run, and the scripted working-day rehearsal passed. Local marketing rendering and hosted signed-in integration/pricing UI were checked in a browser.

Hosted verification caught a runtime difference: Workers does not implement `redirect: "error"`. Both auth and pricing now use `redirect: "manual"` and reject non-success responses, without forwarding credentials to redirect targets.

## Remaining external requirements

This is a real connection to UWM's **stage environment**, not production loan data. Pipeline and single-loan conditions need separate broker-shop Insights credentials and an Orbit brokerage mapping. The connector is implemented but not live-validated without those credentials. Submission, supporting-document delivery, AUS and rate locks remain simulated; they need their respective user authorization, contracts and webhook onboarding before replacement.

Dev/stage/production hosting and CI promotion are a future milestone. Isolate Worker names, storage and secrets, then add build/test, staged smoke, promotion and rollback gates. This release retains the existing current-app topology.

## Stage pricing response update

Worker `c4e178d4-84ee-4127-bf02-6e5aa9108398` serves source `f9d2b48`. The parser checks documented UWM rejection messages before validating quote items. An accepted response with no displayable offers has its own message. Malformed responses are rejected and the diagnostic records the step, status, or schema paths and issue codes. It excludes response bodies and scenario inputs.

All 385 tests passed, including fixture coverage for missing or null items on a rejection, an accepted empty result, malformed offer fields, and redirects. Lint, typecheck, and the Cloudflare build passed. All 46 staged assets matched twice and the public landing, Product, Demo, and login routes returned HTTP 200 after promotion. A fresh signed-in fictional conventional purchase returned 35 stage offers. A separate fictional purchase that UWM declined displayed the rejection message and preserved the preceding quote. The original reported response was not reproduced.

## Manual pricing and UWM onboarding boundaries

Worker `4d8f076f-e165-4308-863f-60bbcf1ad7e9` serves source `87acb66`. Operational workspaces use a manual pricing run with an explicit source reference and current 1003 revision. Tests verified that the first offer can be saved and chosen without a prior EQ run, sample offer, or provider request. Fictional workspaces retain sample actions and stage pricing. Insights sync remains contingent on broker-shop credentials and an exact workspace mapping. Mock writes are rejected in operational workspaces, while local document review remains available. Insights records retain snapshot provenance and an older response cannot replace a newer saved snapshot.

All 389 tests, lint, typecheck, the Cloudflare build, and working-day, concurrency, and recovery rehearsals passed. On the built Worker, a fictional operational owner saw the unavailable Insights connection and the assigned LO entered and chose a manual quote. The browser flow fit at 1440 × 900, 900 × 1200, and 390 × 844. Impeccable reported no contrast findings on the updated live Product and Demo pages at 390 px. After all 46 staged assets matched twice, the public routes and the signed-in fictional workspace were verified on OrbitLOS.com. UWM stage authentication verified four disclosure groups and a fictional manual quote saved with its reference.
