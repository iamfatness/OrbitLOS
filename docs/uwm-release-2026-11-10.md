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
