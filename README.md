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

1. Use **New Lead** to enter a borrower name and optional contact details, or select an existing borrower. Choose **Save lead** to return to the pipeline or **Save and open 1003** to start the prefilled application.
2. Switch between the board and list views. Drag a card to another stage or use the **Pipeline stage** field in the loan details. Use **Contacts** to manage borrower and realtor details.
3. Click **Sync UWM**. The first sync refreshes Charlotte Kim and Amelia Davis and imports Benjamin Cole. Open Charlotte's loan to see the lender status, two outstanding conditions, and one cleared condition.
4. Sync again to refresh the same lender records. UWM status and pipeline stage are separate fields, so a sync preserves broker-managed stages.

### Try UWM alerts

After the first mock sync, assign Charlotte Kim’s loan to your account from **Edit loan** or **Team**. In **Integrations**, choose **Simulate UWM changes**. This one-time update for the workspace changes her UWM status, adds an insurance condition, and reopens the property condition.

Open **Tasks → My Tasks → UWM alerts**. **Open lender status** jumps to the UWM submission. **Open condition** jumps to the specific condition on that submission. **Mark reviewed** moves the alert to the **Completed** view. Regular syncs compare the saved lender status and conditions with the refreshed snapshot, so refreshing the same data leaves the alert count unchanged.

## Try the demo 1003

1. Open a loan without a UWM submission, such as Olivia Parker, and choose **Start 1003**. Open the borrower view or copy its scoped link. It expires after seven days.
2. Choose **Load sample answers** or enter fictional answers. Use **Save draft**, then reopen the same link to resume. **Continue** also saves progress. Review and submit to open the borrower status page and document checklist.
3. On the original loan, choose **Refresh application**, review the submitted answers, and select **Mark reviewed**.
4. Choose **Send to UWM (mock)**. The lender card shows a demo reference, an approved-with-conditions status, two outstanding conditions, and one cleared condition. **Sync UWM** refreshes the same lender record.

On the loan, open **Document checklist** and choose **Request document** to add a sample document type with optional borrower instructions. The borrower reopens the same 1003 link, selects **Refresh status** as needed, and previews and attaches a built-in fictional sample. Back on the loan, select **Refresh checklist** to see what's waiting on the borrower, ready to review, or accepted. Open a received sample to preview or download it, then accept it or request a replacement with a message. The existing seven-day borrower link can be renewed on the loan.

Under **Lender submissions**, open **Request borrower document** on an outstanding mock UWM condition. Confirm the document type and edit the instructions before adding the request. The condition shows the checklist status and links to the review controls. Each condition has its own request, and **Sync UWM** preserves the link. UWM clearance remains a separate lender status.

Under **Tasks → My Tasks**, the **Loan work queue** shows new 1003s, samples ready to review, and requests waiting on the borrower. **Open item** jumps to the relevant section. From **Document checklist**, use **Preview document follow-up** to copy one email or text for the outstanding requests, with the borrower’s link and any replacement instructions.

In **Closing workbench**, save a target date and add checklist items with owners and due dates. **My Tasks** flags loans assigned to you that are due to close within seven days or past their target date and still have outstanding items. Open the flagged loan from the queue to work its checklist. Record the actual closing date to preview a closing update for the borrower and any linked realtor. The same actual date supplies the anniversary reminder once the loan is funded or closed.

After accepting a sample linked to a condition, record mock delivery to get a receipt. Choose **Check UWM clearance (mock)** from the checklist to refresh that submission. The checklist keeps the acceptance and receipt, and the lender card shows the clearance separately. The brokerage-wide **Sync UWM** also applies mock clearances.

Each submitted 1003 creates one follow-up task due in 24 hours. Find it on the loan or under **Tasks**. It follows the loan officer assigned to the loan. **My Tasks** uses your signed-in account for matching. New loans start assigned to you. For existing loans, open **Edit loan** and select **Assign to my account** to connect the assignment to your login.

When a 1003 is submitted or a loan changes pipeline stage, Orbit creates a draft for the borrower and any linked realtor. Open **Communications** to see the queue or open a loan to see its draft history. Preview email or text and copy it to use in your messaging app. The history records when each channel was first copied. Realtor drafts contain only a milestone update. Drafts from earlier stages remain in the history.

Open **Realtors**, select a partner and the receiving loan officer, then choose **Create referral link**. The private link expires after seven days. From **Open realtor view**, submit a fictional prospect with an email or phone number and permission to share it. The portal shows **Referral received** and later shows the loan’s milestone.

The receiving officer opens **Tasks → My Tasks** and reviews **Incoming referrals**. A first-contact follow-up is due in 24 hours. Orbit flags existing borrower or co-borrower contacts with matching email or phone. The LO can use a match they have access to or choose a separate contact. A brokerage admin can review matches outside the LO’s assigned loans. Referrals from older links with no assigned officer appear in the brokerage admin queue.

Choose **Create loan and prefill 1003** to open the new loan’s application panel. Share its borrower link using **Copy link**. The draft starts with the contact’s saved name, email and phone and the referred loan purpose. The borrower can edit those fields and save and resume as usual. Email and document scanning are simulated in the original demo.

In **Realtors → Partner conversion**, select a count to list its records and click a borrower name to open the loan. **Referrals** includes realtor-linked loans and intake records without a linked loan. A converted lead counts once. **Submitted 1003s** uses the actual submission timestamp. **Funded / closed** uses the current pipeline stage.

**Past Clients** lists funded and closed loans. Choose **Edit follow-up** to record the actual closing date. Orbit schedules an annual task for the assigned loan officer and adds the next year's reminder when the workspace is opened after the anniversary. February 29 closings use February 28 in non-leap years. To enable the rate watchlist, record the current note rate and a lower target. Enter an observed rate to compare against that target. When it meets the target, Orbit adds a follow-up task.

## Try mock credit and automated underwriting

Open any sample loan and find **Credit & AUS** in its details. Select **Confirm mock credit authorization** and **Run mock credit** to generate a fictional score and report reference. With that report available, run **Desktop Underwriter (DU)** or **Loan Product Advisor (LPA)** and review the sample findings.

Choose **Temporary failure** for credit, DU, or LPA to simulate a timeout. The corresponding **Retry** action creates a new attempt and preserves the failure in **Previous mock requests** and the loan’s activity. **Review required** returns findings for the LO to evaluate. Running AUS again after a new credit report links the new findings to that report.

## Work a loan and price a scenario

Open **Tasks** to filter by loan officer, due time, or completion. In the local demo without Google sign-in, **My Tasks** shows the sample officer Alex Morgan. From a loan, add a follow-up and log notes, calls, email, or texts on its activity timeline.

Open a loan and select **Price loan**, then **Load sample scenario** and **Run pricing**. Compare conventional fixed-rate examples, save an option, and use **Preview borrower quote**. The preview identifies sample pricing and explains what the principal-and-interest payment covers. A new pricing run preserves the last saved quote until the LO selects another.

Choose **DSCR** to enter rental income, property taxes, insurance, HOA dues, and reserves. Each mock offer shows housing cost and estimated rent coverage. Choose **Bank statement** to enter 12 or 24 months of personal or business statements, average eligible deposits, and other monthly debts. The business option also uses an expense factor and ownership percentage to estimate income and DTI. Both scenarios support sample rate-and-term and cash-out refinances. These are Orbit demo inputs. The live Easy Qualifier request fields and product rules need validation in UWM stage. [UWM program overview](https://www.uwm.com/real-estate-agent) · [UWM bank statement products](https://www.uwm.com/loan-products?bank-statement=bank-statement-fixed-blue&bank-statement=bank-statement-fixed-yellow)

After a 1003 is submitted, **Publish sample quote** in the quote preview shares the saved quote on the borrower status page. The LO can replace or remove the shared quote. Saving a different quote keeps the existing published terms visible until the LO publishes the replacement.

To demo a rate lock, open a loan with a synced UWM file, such as Charlotte Kim after **Sync UWM**. Save a sample quote and choose **Float rate (mock)** under **UWM rate lock**. Select a sample lock period and choose **Request lock (mock)**. Orbit records the float and lock confirmations, the selected terms, and the lock expiration in the loan record. A reviewed demo 1003 sent with **Send to UWM (mock)** also supplies a UWM file for this flow.

An active mock lock can be extended by 7 or 15 days from its current expiration, or cancelled with confirmation. Orbit keeps the original lock confirmation and records the change in the activity timeline. **Tasks → My Tasks** lists assigned active locks expiring within seven days, soonest first. **Open item** opens the lock panel on the loan.

The server-side pricing provider defaults to sample pricing. The initial UWM Easy Qualifier adapter supports conventional purchase and rate-and-term refinance in UWM stage. To test locally with UWM-issued EQ credentials, set `ORBIT_PRICING_MODE=uwm-stage`, `UWM_EQ_CLIENT_ID`, and `UWM_EQ_CLIENT_SECRET` in the server environment. Optionally set `UWM_EQ_BROKER_ALIAS` and `UWM_EQ_LO_EMAIL` for the broker shop. Use synthetic scenarios and confirm access with UWM. The adapter uses the EQ quote and disclosure endpoints and keeps credentials server-side. Future providers implement the same pricing interface. [UWM pricing documentation](https://developers.uwm.com/portal/instant-price-quote/docs/151)

The demo follows the [Uniform Residential Loan Application](https://singlefamily.fanniemae.com/delivering/uniform-mortgage-data-program/uniform-residential-loan-application) sections for personal information, employment and income, assets and debts, real estate, loan and property, declarations, acknowledgments, military service, and demographics. Add joint borrowers and repeatable records for jobs, accounts, debts, and properties. Staff can review answers and save the lender and originator supplement separately. The borrower link grants access only to its assigned application. Use fictional data, test tax IDs in the `000-00-####` format, and sample account references. Typed names demonstrate signing and are not a production e-signature integration. Live MISMO delivery is outside the demo.

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

Orbit follows Pal Panel's verified-email sign-in pattern. Each approved staff member gets an individual eight-hour session. **Sign out** revokes that session. Orbit checks brokerage membership on every staff request. Removing an address from the configured demo allowlist removes its bootstrap demo access.

1. Create an Orbit-specific **Web application** OAuth client in Google Cloud. Add `https://orbitlos.com/auth/google/callback` as an authorized redirect URI. For a Google app in testing, add the approved staff as Google test users.
2. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ORBIT_STAFF_EMAILS` to the Orbit Worker using Cloudflare secrets. Set `ORBIT_STAFF_EMAILS` to a comma-separated list of approved Gmail or Google Workspace addresses.
   The optional `ORBIT_STAFF_EMAILS_EXTRA` adds approved addresses without replacing the primary list.
3. Set the Worker binding `ORBIT_AUTH_MODE` to `google` after the other values are in place. Open the site in a private window to verify an approved account can sign in and an unapproved account is denied. The Google sign-in mode uses Google sessions for staff. The demo mode uses the shared password.

Use **Team** to create an empty brokerage, switch workspaces, and manage staff access. Existing configured Google accounts start as admins in the original demo workspace. Admins can invite staff by Google email, update roles, revoke access, and reassign loans to active members. An invite becomes active after that Google account signs in. Share the sign-in link with the invitee. Google applies the OAuth app's configured audience and any Workspace sign-in policies.

Brokerage admins can see all loans in their workspace. LOs see and work the loans assigned to their Google account and their related contacts. Admins manage the contact directory, realtor links, and lender sync. Open tasks follow the assigned loan. **Access history** records staff changes, loan handoffs, and portal link issuance and revocation.

Each brokerage has its own data store. Borrower and realtor links are scoped to their issuing workspace and record. In **1003 application**, an LO or admin can revoke a borrower link and issue a replacement while retaining the application. New workspaces use fictional data and mock UWM pricing. Use the original demo for the existing sample pipeline.

### Run a fictional pilot

In **Team → Create brokerage**, select **Create as a fictional pilot workspace**. In the new workspace, invite staff by their Google account and share the workspace link. The invitation activates when the invited account signs in. When the LO is active, select them and choose **Load fictional scenario**. The LO gets Riley Pilot Referral in **My Tasks** and Morgan Pilot Borrower in the pipeline. The admin can open or copy Taylor Pilot Realtor’s link in **Realtors**.

The pilot walkthrough under **Team** covers referral intake, a prefilled 1003, sample pricing, and mock UWM conditions. The pilot supports on-screen verification codes and built-in clean and blocked PDFs when document upload mode is set to `mock`. Staff can submit feedback by workflow step. Admins can review the feedback and activity from **Team**.

**Reset fictional scenario** replaces the scenario’s seed records and loans converted from its referrals. It revokes the old scenario links and queues the sample files for cleanup. Staff access, feedback, activity history, and unrelated loans remain available.

### Private PDF upload preview

In the original demo or a fictional pilot, submit a fictional 1003 and request a document on the loan. In the borrower checklist, choose **Get demo code** and enter the code shown on the page. **Demo PDF** includes clean and blocked fixtures for showing both mock scan outcomes. A clean sample reaches the LO’s review checklist and can be downloaded as a demo PDF. The demo accepts only the built-in PDF choices and also offers the original text samples.

In a configured live brokerage preview, an admin adds an email to the borrower contact before sharing the 1003 link. After submission, the borrower requests a one-time code sent to that email and can upload a PDF of up to 5 MB against an open request. A file becomes downloadable after scanning and a second check of the borrower link and email session. Only a brokerage admin or the assigned LO can download it. A clean replacement becomes the current PDF. Private storage cleanup removes superseded files and files from deleted loans.

The hosted Worker binds the private `orbitlos-private-documents` bucket as `DOCUMENTS`. Keep public access disabled for the bucket. Before enabling uploads, onboard the sender domain for Cloudflare Email Sending and add a `send_email` binding named `DOCUMENT_EMAIL`. Use fictional PDFs and a test mailbox in the preview.

Run `node services/document-scanner.mjs` beside a private ClamAV daemon and place the bridge behind HTTPS. The bridge binds to loopback and reads `ORBIT_DOCUMENT_SCANNER_SECRET`. Set `ORBIT_CLAMD_SOCKET` for a private Unix socket or use local TCP port 3310. Keep ClamAV signatures current and configure the daemon to alert on encrypted documents and scan limits (`AlertEncrypted yes`, `AlertExceedsMax yes`). The Worker sends raw PDF bytes to `/scan`. Only an authenticated clean response carrying the matching SHA-256 digest releases the PDF for review.

Set `ORBIT_DOCUMENT_FROM` and `ORBIT_DOCUMENT_SCANNER_URL` on the Worker. Store `ORBIT_DOCUMENT_VERIFICATION_SECRET` and `ORBIT_DOCUMENT_SCANNER_SECRET` as two distinct secrets of at least 32 characters. Set `ORBIT_DOCUMENT_UPLOADS=enabled` once the bindings and scanner are ready. The hosted Worker currently uses `ORBIT_DOCUMENT_UPLOADS=mock` for the original demo and fictional pilot workspaces. Mock verification sessions are separate from live PDF upload sessions.

Run `npm run lint`, `npm run typecheck`, and `npm run build` to check the scaffold.
