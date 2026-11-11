# Orbit environments

Dev and stage were provisioned November 10, 2026. All three hosts subsequently received the UWM account and webhook receipt release; see [publication validation](uwm-release-validation.md). Production retains its existing data and namespace.

| Target | Host | Worker | Private document bucket | UWM event environment |
| --- | --- | --- | --- | --- |
| Development | `dev.orbitlos.com` | `orbitlos-dev` | `orbitlos-dev-private-documents` | `int` |
| Stage | `stage.orbitlos.com` | `orbitlos-stage` | `orbitlos-stage-private-documents` | `stage` |
| Production | `orbitlos.com` | `orbit-crm-demo` | `orbitlos-private-documents` | `production` |

Each Worker owns its own `OrbitWorkspace` Durable Object namespace, including brokerage directory, staff sessions, loan data and webhook receipts. Bindings never refer to another Worker's namespace. Buckets, rate-limit namespaces and secrets are separate. Production's historical Worker name is intentionally retained to preserve its namespace and existing data.

## Access and remaining setup

Dev still uses temporary Basic authentication for the demo workspace. Username is `orbit`; its password is in Git-ignored `.orbit/access.dev.json`. Stage now uses its own Google OAuth client, verified with the initial administrator; its temporary DEMO_PASSWORD secret was removed. Public marketing pages remain public, as on production. Use synthetic data only. Pricing, documents, submissions and locks remain mock until explicitly configured.

To enable brokerage administration and UWM receipt review, configure Google sign-in separately on each Worker. Register these Google OAuth redirect URLs:

- `https://dev.orbitlos.com/auth/google/callback`
- `https://stage.orbitlos.com/auth/google/callback`

Install `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ORBIT_STAFF_EMAILS`, and `ORBIT_AUTH_MODE=google` on the corresponding Worker. Prefer separate OAuth clients. The staff list must explicitly include the initial administrator. Existing production secrets cannot be read back through Wrangler and were not copied. Once Google login is verified, remove the temporary `DEMO_PASSWORD` secret.

Create an integration test brokerage in stage (a normal, non-pilot workspace holding synthetic data) and select the production brokerage independently. Follow [UWM webhook onboarding](uwm-webhook-handoff.md) to generate dedicated environment tokens and register receivers. Stage now has a `UWM_WEBHOOK_CONFIG` secret mapped to UWM Integration Test (`b73d9e19-4366-4ece-9467-675c00587a5e`) and passed authenticated synthetic deliveries for all four receivers. Production is now mapped to OrbitLOS Production (`ec2cceac-edb2-4513-bf32-9d6beb24caf4`) with separate credentials and has passed the same synthetic receipt checks. Dev remains unconfigured and returns `503`. Wrong-environment webhook paths return `404` even if a mismatched config is installed. UWM OAuth credentials and incoming webhook tokens are separate.

## Build and deploy

| Target | Build | Deploy |
| --- | --- | --- |
| Dev | `npm run build:cloudflare:dev` | `npm run deploy:cloudflare:dev` |
| Stage | `npm run build:cloudflare:stage` | `npm run deploy:cloudflare:stage` |
| Production | `npm run build:cloudflare` | `npm run deploy:cloudflare` |

The Vite plugin chooses the Cloudflare environment at **build time**, using `CLOUDFLARE_ENV`. All builds share `dist/`, so run the matching build immediately before deployment; do not run environment builds concurrently. The wrapper validates the flattened artifact's Worker name, deployment marker, custom domain, private bucket and local Durable Object binding. The deploy script repeats that validation and rejects target-overriding CLI flags. Default build/deploy commands preserve the existing production target.

Release inbox configuration lives in Git-ignored `.orbit/release.dev.env`, `.orbit/release.stage.env`, and `.orbit/release.env` respectively. Dev and stage currently use the existing verified operator inbox for demo requests. No test emails were sent during setup. Build wrappers disable dotenv loading into Cloudflare dev bindings; hosted secrets are installed separately and must not be bundled in artifacts.

For environment secrets use `node node_modules/wrangler/bin/wrangler.js secret put <NAME> --config wrangler.jsonc --env stage` (or `--env dev`). Omit `--env` for the existing production Worker. Do not use `--env production`: production is the top-level configuration, preserving the historical deployment.

## Verification

For workspace continuity, run `node scripts/workspace-working-day.mjs` against the production build. The scenario saves a fictional account's workspace, starts another session without the browser preference cookie, follows a scoped link, and confirms explicit recovery after revocation. During promotion, open the same signed-in generic workspace URL before and after the traffic change when browser access is available. Confirm it resolves to the same brokerage and record whether the authenticated production check ran.

The stage and dev builds passed artifact-target checks. Sixteen environment/UWM tests, TypeScript and targeted lint passed. Hosted checks verify public page availability, unauthenticated workspace denial, authenticated workspace access, unconfigured webhook rejection and cross-environment rejection. No production data was copied, and no UWM delivery has yet been accepted on either new host.

Reference: [Cloudflare Vite environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/).
