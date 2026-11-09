# OrbitLOS executive walkthrough

Open the [campaign guide](https://orbitlos.com/workspace?guide=campaign) with a signed-in admin. Create a fresh fictional pilot, set up the campaign, and load the realtor and rate-watch examples. Download the rehearsal CSV if you want to show the actual upload. Keep the staff and borrower tabs open together. Credit, pricing, lender delivery, and document handling use demo results.

## Presenter run sheet

| Target time | Show | What to say |
| --- | --- | --- |
| 0:00–0:55 | Upload the two-row CSV. Choose **Preview 2 leads**, then **Import into campaign**. Open Jordan’s campaign lead and log **Connected**. | “The brokerage can put purchased or referral leads straight into a call queue. Routing gives available officers work up to their caps. Any overflow stays in the shared inbox.” |
| 0:55–1:55 | Choose **Start 1003** and open the borrower view. **Load sample and review**, confirm, and submit. In the staff file choose **Refresh application** and **Mark reviewed**. Back in **Demo Guide**, choose **Link sample realtor**. | “The call, contact, and property ZIP carry into the file. The borrower submits through their own link. The officer reviews the answers on the same record they priced from.” |
| 1:55–2:55 | Check **Confirm mock credit authorization**, run mock credit, then choose **Price with mock score**. Run pricing, save a quote, and **Send reviewed 1003 to mock UWM**. | “The pricing inputs follow the reviewed application. The saved quote travels with the lender handoff, and Orbit opens the condition checklist from the receipt.” |
| 2:55–4:15 | Request the two suggested documents. In the borrower tab, get and verify the on-screen demo code once. Submit both **Clean sample PDF** files. Review each staff request, choose **Accept & send to UWM (mock)** for each, and check clearance for both. Preview the realtor milestone, move the loan to **Clear to Close**, and open the realtor view. | “A lender condition becomes a specific borrower request. The officer can see the document, delivery, and clearance in one place. The realtor sees the milestone without borrower documents.” |
| 4:15–5:05 | Choose **Use today for closing** and **Record closing**. The funding form opens. Choose **Use today for funding** and **Record funding**. Open **Record borrower check-in**, select **Requested callback**, and enter a future date. Open the new task. | “Funding creates follow-up work for the loan owner. The requested callback carries its due date and the reason for the call.” |
| 5:05–6:15 | Start a separate returning-client refinance 1003. Return to **Demo Guide**, record sample **6.000%**, and open Casey’s rate-watch task. Choose **Start refinance 1003** and confirm the original property address. If time allows, open both records from **Reports → Returning clients → Returning-client 1003s**. | “The original campaign keeps credit for the funded loan. A rate-watch follow-up can turn into a separate refinance with the client’s contact details and confirmed property address.” |

The solo route has one available officer. Jordan is assigned to the admin and Casey waits in the shared inbox after the one-lead cap. For a two-officer routing demonstration, prepare a fictional pilot with a second active member and verify both assignments before the meeting.

The live two-officer check used three fictional CSV rows and a one-lead cap per officer. Each officer received one lead and the third stayed shared. In **Call Campaigns → Unassigned**, show both caps and **0 open slots**, then use **Assign this lead**. The receiving officer can open that exact lead from **Today → Next 7 days** with the original deadline.

## Live interaction baseline

Measured on hosted version `e5c302f9-74c0-45dd-b9e1-cafc5631d02c` from **Create guided pilot** in an existing admin session. The stopwatch includes browser actions, observations, and navigation. The presenter targets above include spoken transitions. Sign-in and spoken delivery were outside the measured run.

| Checkpoint | Elapsed |
| --- | ---: |
| Pilot and relationship examples ready | 0:04 |
| CSV imported | 0:32 |
| Connected call converted to 1003 | 0:50 |
| Borrower submitted and staff reviewed | 1:36 |
| Mock quote saved and UWM file received | 2:20 |
| Both conditions cleared and realtor draft ready | 3:00 |
| Realtor portal showed Clear to Close | 3:11 |
| Closing and funding recorded | 3:27 |
| Borrower callback appeared in Tasks | 3:50 |
| Separate prefilled refinance 1003 opened | 4:08 |
| Rate-watch task opened | 4:10 |

The guide showed **7 / 7 ready**. ZIP 48304 carried from the CSV through the reviewed 1003 into pricing, alongside the fictional 742 score. The rate-watch task showed 6.000% observed, 6.125% target, and 6.750% current.

The baseline required opening the loan editor, selecting the realtor, and saving. Hosted version `6dfb9844-d8fb-44b5-b2b7-8feaaff08777` replaces that sequence with **Link sample realtor** in the guide. A second fresh live run completed all seven steps and verified that the condition instructions followed the current request, review, delivery, and clearance state. The public demo page describes the same workflow.

## Current-release executive rehearsal

The fictional brokerage `296b9767-3f5c-4b73-978e-6eb76ff70bf4` ran on `fb2da7bc-6841-4d63-9c50-036275387f3a` with one signed-in staff account and separate borrower, realtor, and repeat-application tabs. The browser run from opening CSV import to the rate-watch task took **3:27**. Timing includes the browser driver and selector retries. Setup and spoken narration were outside the timer.

| Checkpoint | Elapsed |
| --- | ---: |
| Uploaded CSV routed one lead and left one in the shared queue | 0:04 |
| Connected call opened the prefilled 1003 | 0:11 |
| Borrower submitted and staff reviewed the application | 0:23 |
| Mock score and ZIP carried into pricing, saved quote, and mock UWM receipt | 1:00 |
| Both sample PDFs cleared with mock delivery receipts | 1:47 |
| Realtor portal showed Clear to Close | 2:08 |
| Closing and funding were recorded separately | 2:33 |
| The owned borrower callback opened from Tasks | 2:53 |
| A distinct prefilled refinance application opened | 3:09 |
| Rate-watch follow-up showed observed 6.000%, target 6.125%, current 6.750% | 3:27 |

The 1003 submission and PDF handoffs arrived without manual refreshes. The guide showed **7 / 7 ready**. The realtor portal showed Funded when reopened after funding. No application errors appeared in the four sampled tabs. The walkthrough exposed missing guide cues for mock credit authorization, the PDF route, and actual closing and funding dates.

On follow-up release `650fe6f6-1477-4411-a861-95fcfdd3953d`, the guide named the authorization checkbox and explained the simulated verification and PDF route. A second fictional file verified both date shortcuts. The guide opened and focused the actual closing form. Saving it opened and focused the funding form. Both shortcuts filled November 9 Eastern, and separate saves produced the funded file and borrower check-in. The public Demo page published the 3:27 result from the first run. All 271 tests, lint, typecheck, the Cloudflare build, and the working-day and recovery rehearsals passed.

In the second run, reopening the checklist from the guide after the borrower had already attached both samples initially showed them as outstanding. The foreground update brought in both received documents. On `1995bf42-7012-42d3-9e04-0871aaa2ea0a`, the guide fetched the current loan before opening. Both replacement PDFs appeared as ready for review on the first render, and opening the final remaining condition focused the exact task. [Hosted comparison](demo-rehearsal-log.md#live-checklist-entry-after-attachments).
