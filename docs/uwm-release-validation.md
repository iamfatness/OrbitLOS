# UWM publication validation — November 10, 2026

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
