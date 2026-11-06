# Orbit

Orbit is a mortgage CRM prototype. It starts with fictional borrowers, realtor partners, and loans.

## Run locally

Install Node.js 24 or later and run the following commands.

```sh
npm ci
npm run dev
```

Open [Orbit on localhost](http://127.0.0.1:3000). The app binds to localhost and saves records in `.orbit/orbit.sqlite`. Set `ORBIT_DB_PATH` before starting the app to use a different database file, such as one for a clean test workspace.

## Try the pipeline

1. Use **New loan** to enter a borrower name or select an existing borrower. You can assign an officer and realtor and pick a pipeline stage.
2. Switch between the board and list views. Drag a card to another stage or use the **CRM stage** field in the loan details. Use **Contacts** to manage borrower and realtor details.
3. Click **Sync UWM**. The first sync refreshes Charlotte Kim and Amelia Davis and imports Benjamin Cole. Open Charlotte's loan to see the lender status, two outstanding conditions, and one cleared condition.
4. Sync again to refresh the same lender records. UWM status and CRM stage are separate fields, so a sync preserves broker-managed stages.

## How it fits together

- `src/components` contains the Next.js workspace UI. Typed server actions in `src/app/actions.ts` validate and save changes.
- `src/lib/store.ts` defines the shared SQLite schema. Contacts, loans, lender submissions, and activity have separate records. Lender references are unique per lender within this workspace.
- `src/lib/uwm.ts` holds the mock connector, maps UWM's Insights and conditions response shapes, and saves a complete sync in one transaction. A live UWM adapter can implement the same connector. Other lenders can map their own payloads to Orbit's submission model. Syncing may re-import a loan removed locally if it is still present in the mock feed.
- The [UWM Developer Portal](https://developers.uwm.com/) documents the live integration contracts. The prototype uses sample data and manual sync. Individual user accounts, tenant isolation, live credential storage, webhooks, and MISMO submission are outside this first implementation.

## Hosted demo

The demo address is [orbitlos.com](https://orbitlos.com/). The Cloudflare Worker uses a shared demo password. Its SQLite database lives in a Durable Object and is separate from the local workspace. Use sample data for the demo.

Use `npm run build:cloudflare` for a hosted build. To preview it locally, set a disposable `DEMO_PASSWORD` in `dist/server/.dev.vars` after the build, then run `npm run preview:cloudflare`. The preview uses local storage and signs in with the username `orbit`.

The deployment command is `npm run deploy:cloudflare`. The first deployment requires a Cloudflare Worker secret named `DEMO_PASSWORD`, which can be supplied with `--secrets-file`. The Worker rejects access until a password is configured.

Run `npm run lint`, `npm run typecheck`, and `npm run build` to check the scaffold.
