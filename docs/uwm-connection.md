# UWM connection

Verified November 10, 2026: the OrbitLOS Public API stage credentials successfully authenticate, retrieve four disclosure groups, and produce 35 offers for a synthetic conventional purchase scenario. UWM accepts `client_credentials`; the portal reference's hyphenated grant returns HTTP 400.

Local stage credentials are in Git-ignored `.env.local`. Restart `npm run dev` to load them. Run `node --env-file=.env.local scripts/check-uwm.mjs` to check authentication/disclosures, or append `--quote` to create a synthetic stage pricing scenario. The script reports counts only. Stage pricing is UWM test data, not production pricing.

## Pipeline and conditions

The Public API credentials do not replace the separate broker-shop Insights credentials. Configure these server-only values to enable the connector for one authenticated brokerage:

- `UWM_BROKERAGE_ID`: exact Orbit brokerage UUID, never `orbit-demo` or a fictional pilot.
- `UWM_INSIGHTS_CLIENT_ID` and `UWM_INSIGHTS_CLIENT_SECRET`: the shop's Insights credentials.

Use **Integrations → Sync UWM** as a brokerage admin. The connector reads Insights loans and single-loan conditions, validates responses, limits condition requests to four at a time, and commits the complete sync atomically. Failed or empty reads do not replace data or advance the sync timestamp. Existing records are matched by UWM loan number. Mock records are not automatically deleted. Start with a clean real brokerage; review any preexisting sample records before cutover.

Insights is production-only in the available UWM reference and remains unverified against a credentialed shop. Obtain the shop credentials from UWM Insights onboarding, then validate the query fields and conditions schema against that shop before using the imported pipeline operationally. Status and condition reads do not import a full 1003, amounts, property details or officer assignments.

## Pricing and hosting

Set `ORBIT_PRICING_MODE=uwm-stage`, `UWM_CLIENT_ID`, and `UWM_CLIENT_SECRET` for stage pricing. Legacy `UWM_EQ_CLIENT_ID`/`UWM_EQ_CLIENT_SECRET` remain supported. Optional `UWM_EQ_BROKER_ALIAS` and `UWM_EQ_LO_EMAIL` select the shop context. Live DSCR and bank-statement requests fail explicitly until their contracts are implemented.

The hosted Worker passes server bindings to the command layer. This release enables stage pricing for the current demo and fictional pilots, including quotes using reviewed worksheet income. Credentials are stored as Cloudflare secrets, not `wrangler.jsonc` vars or browser variables. The administrator's **Integrations → Verify UWM connection** checks authentication and disclosures directly from the running app. Public production credentials remain in Gmail; they were not written to source or local config.

Deploy from the isolated `release/uwm-2026-11-10` branch based on the current deployed source, rather than the older dirty root checkout. Configure verified stage secrets with `node --env-file=<ignored-stage-env> scripts/configure-uwm-secrets.mjs`, build with `npm run build:cloudflare`, and use the existing `scripts/deploy-cloudflare.mjs` flow with the verified demo recipient. The secret setup script transmits values through stdin and reports names only.

For a later production pipeline connection, scope the Insights credentials with `UWM_BROKERAGE_ID`. Separate dev/stage/prod Workers, isolated data stores and credentials, and CI promotion/rollback gates are the next deployment infrastructure milestone; this release preserves the current hosting topology.

Real brokerages without a configured connection cannot import sample loans. A connected brokerage cannot run mock UWM submissions, condition deliveries/clearance or locks. Those write workflows still require UWM user authorization, confirmed request contracts and (for loan import) registered completion webhooks. The existing buttons return an explicit error instead of a simulated receipt in a connected workspace.

Sources: existing `UWM-API-Reference.md`, [Public authentication](https://developers.uwm.com/portal/auth/docs/107), [Insights authentication](https://developers.uwm.com/portal/insights/docs/153), [Insights endpoint](https://developers.uwm.com/portal/insights/docs/154), [conditions](https://developers.uwm.com/portal/condition/docs/160).
