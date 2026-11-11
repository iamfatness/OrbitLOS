# Configure UWM user access

User login uses `UWM_USER_CLIENT_ID`, `UWM_USER_CLIENT_SECRET` and `UWM_USER_ENVIRONMENT`. These are separate from the existing `UWM_CLIENT_*`/`UWM_EQ_*` pricing settings. A partial user credential pair is rejected; the application never fills it from pricing credentials.

First enable Google staff sign-in on stage and create a dedicated, non-pilot brokerage using synthetic data. Confirm UWM has enabled the intended user's stage broker/branch. The same person can have accounts in multiple environments; their loan workspaces and credentials remain isolated.

Load the UWM-issued client ID, secret and explicit `UWM_ENVIRONMENT=stage` from an existing Git-ignored environment file, then prepare the target configuration:

```powershell
node --env-file=<private-stage-env-file> scripts/prepare-uwm-user-access.mjs stage <existing-stage-brokerage-uuid>
```

The command writes `.orbit/uwm-user-access.stage.json`, generates a new encryption key, and prints no credentials. It does not deploy anything or verify that the brokerage exists. It refuses to overwrite the file. Reuse the prepared file for installation; do not generate a replacement encryption key for routine redeploys.

After verifying the brokerage and Google sign-in, install on stage:

```powershell
Get-Content -Raw .orbit/uwm-user-access.stage.json | node node_modules/wrangler/bin/wrangler.js secret bulk --config wrangler.jsonc --env stage
```

Use target `dev` with `UWM_ENVIRONMENT=int` and `--env dev` for INT. Production requires a production source credential file, target `production`, a production brokerage UUID, and the top-level Wrangler configuration (omit `--env`). Do not install the stage JSON on production. `UWM_BROKERAGE_ID` also scopes Insights: preserve its existing mapping if already configured.

In Orbit Integrations, connect the UWM account and run **Verify UWM broker access**. Passwords are sent only for the token exchange and are not persisted by Orbit. User access and refresh tokens are encrypted per brokerage and user. A successful read-only association request does not validate loan submission or rate-lock contracts.

The inbound `UWM_WEBHOOK_CONFIG` remains separate. Follow [webhook onboarding](uwm-webhook-handoff.md) to register and test it. Neither user credentials nor pricing credentials belong in webhook headers.


## Stage acceptance recorded November 10, 2026

Google sign-in and the dedicated UWM client configuration are installed on stage. The non-pilot UWM Integration Test workspace is `b73d9e19-4366-4ece-9467-675c00587a5e`. The user's UWM sign-in succeeded, encrypted authorization was retained, and the broker-association request was accepted. No password was recorded in release notes. Branch/contact selection, approved storage origins, real synthetic import/document/lock acceptance, Insights credentials and production enablement remain separate gates.


## Personal access expansion — November 11, 2026

On a configured deployment, every authenticated workspace member may connect their own UWM account regardless of email domain. The former single-workspace personal-login restriction is removed. `UWM_BROKERAGE_ID` remains the preferred operational landing workspace and the strict scope of the separately supplied shop-wide Insights credentials; it is no longer a personal-user access allowlist. Grants stay encrypted per workspace/user/environment. Fictional/demo workspaces allow connection and branch verification, while retaining sample file workflows. Operational workspaces expose the authenticated file API controls. Stage and production retain separate client credentials and encryption keys.
