# OrbitLOS

OrbitLOS is a mortgage broker workspace. The demo starts with fictional borrowers, realtor partners, and loans.

## Run locally

Install Node.js 24 or later and run the following commands.

```sh
npm ci
npm run dev
```

Open [Orbit on localhost](http://127.0.0.1:3000) and choose **Log in** to open the local workspace. The app binds to localhost and saves records in `.orbit/orbit.sqlite`. Set `ORBIT_DB_PATH` before starting the app to use a different database file, such as one for a clean test workspace.

## Try the pipeline

1. Use **New loan** to enter a borrower name or select an existing borrower. You can assign an officer and realtor and pick a pipeline stage.
2. Switch between the board and list views. Drag a card to another stage or use the **Pipeline stage** field in the loan details. Use **Contacts** to manage borrower and realtor details.
3. Click **Sync UWM**. The first sync refreshes Charlotte Kim and Amelia Davis and imports Benjamin Cole. Open Charlotte's loan to see the lender status, two outstanding conditions, and one cleared condition.
4. Sync again to refresh the same lender records. UWM status and pipeline stage are separate fields, so a sync preserves broker-managed stages.

## Try the demo 1003

1. Open a loan without a UWM submission, such as Olivia Parker, and choose **Start 1003**. Open the borrower view or copy its scoped link. It expires after seven days.
2. Choose **Load sample answers** or enter fictional answers. Use **Save draft**, then reopen the same link to resume. **Continue** also saves progress. Review and submit to see the borrower receipt.
3. On the original loan, choose **Refresh application**, review the submitted answers, and select **Mark reviewed**.
4. Choose **Send to UWM (mock)**. The lender card shows a demo reference, an approved-with-conditions status, two outstanding conditions, and one cleared condition. **Sync UWM** refreshes the same lender record.

Each submitted 1003 creates one follow-up task due in 24 hours. Find it on the loan or under **Tasks**. It follows the loan officer assigned to the loan. For a loan with a linked realtor, **Preview realtor update** shows the current pipeline stage in a draft email. The preview is display-only and contains no application or underwriting details.

## Work a loan and price a scenario

Open **Tasks** to filter by loan officer, due time, or completion. Use **My tasks** for the demo officer Alex Morgan. From a loan, add a follow-up and log notes, calls, email, or texts on its activity timeline.

Open a loan and select **Price loan**, then **Load sample scenario** and **Run pricing**. Compare conventional fixed-rate examples, save an option, and use **Preview borrower quote**. The preview identifies sample pricing and explains what the principal-and-interest payment covers. A new pricing run preserves the last saved quote until the LO selects another.

The server-side pricing provider defaults to sample pricing. The initial UWM Easy Qualifier adapter supports conventional purchase and rate-and-term refinance in UWM stage. To test locally with UWM-issued EQ credentials, set `ORBIT_PRICING_MODE=uwm-stage`, `UWM_EQ_CLIENT_ID`, and `UWM_EQ_CLIENT_SECRET` in the server environment. Optionally set `UWM_EQ_BROKER_ALIAS` and `UWM_EQ_LO_EMAIL` for the broker shop. Use synthetic scenarios and confirm access with UWM. The adapter uses the EQ quote and disclosure endpoints and keeps credentials server-side. Future providers implement the same pricing interface. [UWM pricing documentation](https://developers.uwm.com/portal/instant-price-quote/docs/151)

The demo follows the [Uniform Residential Loan Application](https://singlefamily.fanniemae.com/delivering/uniform-mortgage-data-program/uniform-residential-loan-application) sections for personal information, employment and income, assets and debts, real estate, loan and property, declarations, acknowledgments, military service, and demographics. Add joint borrowers and repeatable records for jobs, accounts, debts, and properties. Staff can review answers and save the lender and originator supplement separately. The borrower link grants access only to its assigned application. Use fictional data, test tax IDs in the `000-00-####` format, and sample account references. Typed names demonstrate signing and are not a production e-signature integration. Document upload and live MISMO delivery are outside the demo.

Address fields support manual entry. Enter a U.S. ZIP to suggest an editable city and state. Without Places configured, type **100 Sample** to try a fictional street suggestion. The ZIP index in `src/data/us-zip-cities.json` contains ZIP, locality, and state columns extracted from the November 6, 2026 [GeoNames US postal code download](https://download.geonames.org/export/zip/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

### Google Places street lookup

Link a billing account to the OrbitLOS Google Cloud project and enable [Places API (New)](https://developers.google.com/maps/documentation/places/web-service/cloud-setup). Create a separate server-side API key restricted to Places API (New), configure conservative API quotas, and store the key as `GOOGLE_PLACES_API_KEY` in the Orbit Worker. For local Next.js use, provide the same setting in the server environment. The key never goes to the browser. The **Search with Google Maps** button sends only the typed street and ZIP through the server. The endpoint checks the active borrower link and limits lookups to 35 requests per loan per 15-minute window. Only the address the borrower picks and saves is stored. The disclosure is available at `/address-lookup`.

## How it fits together

- `src/components` contains the Next.js workspace UI. Typed server actions in `src/app/actions.ts` validate and save changes.
- `src/lib/store.ts` defines the shared SQLite schema. Contacts, loans, lender submissions, and activity have separate records. Lender references are unique per lender within this workspace.
- `src/lib/uwm.ts` holds the mock connector, maps UWM's Insights and conditions response shapes, and saves a complete sync in one transaction. A live UWM adapter can implement the same connector. Other lenders can map their own payloads to Orbit's submission model. Syncing may re-import a loan removed locally if it is still present in the mock feed.
- The [UWM Developer Portal](https://developers.uwm.com/) documents the live integration contracts. The prototype uses sample data and manual sync. Individual user accounts, tenant isolation, live credential storage, webhooks, and MISMO submission are outside this first implementation.

## Hosted demo

The public site is [orbitlos.com](https://orbitlos.com/). Choose **Log in** to open the protected staff workspace at `/workspace`. The Cloudflare Worker uses a shared demo password until Google sign-in is enabled. Its SQLite database lives in a Durable Object and is separate from the local workspace. Use sample data for the demo.

Use `npm run build:cloudflare` for a hosted build. To preview it locally, set a disposable `DEMO_PASSWORD` in `dist/server/.dev.vars` after the build, then run `npm run preview:cloudflare`. The preview uses local storage and signs in with the username `orbit`.

The deployment command is `npm run deploy:cloudflare`. The first deployment requires a Cloudflare Worker secret named `DEMO_PASSWORD`, which can be supplied with `--secrets-file`. The staff workspace requires configured sign-in.

### Google sign-in for staff

Orbit follows Pal Panel's verified-email and approved-account pattern. Each approved staff member gets an individual eight-hour session in the shared demo workspace. **Sign out** revokes that session. Removing an address from the approved list also blocks its active sessions.

1. Create an Orbit-specific **Web application** OAuth client in Google Cloud. Add `https://orbitlos.com/auth/google/callback` as an authorized redirect URI. For a Google app in testing, add the approved staff as Google test users.
2. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ORBIT_STAFF_EMAILS` to the Orbit Worker using Cloudflare secrets. Set `ORBIT_STAFF_EMAILS` to a comma-separated list of approved Gmail or Google Workspace addresses.
3. Set the Worker binding `ORBIT_AUTH_MODE` to `google` after the other values are in place. Open the site in a private window to verify an approved account can sign in and an unapproved account is denied. The Google sign-in mode uses Google sessions for staff. The demo mode uses the shared password.

Borrower application links continue to use their own scoped access. Google sign-in identifies staff in the demo workspace. Brokerage isolation and per-user loan permissions are separate pilot work.

Run `npm run lint`, `npm run typecheck`, and `npm run build` to check the scaffold.
