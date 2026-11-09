# Hosted presenter rehearsal log

## Run A on November 8, 2026

Codex operated and narrated the walkthrough in Windows Chrome on hosted deployment `470d21d8-56a8-48be-8be3-ddb30645ab0d`. The clean starting fixture was Presenter Rehearsal A, with desktop viewport 1419 × 1243 and borrower and realtor viewport 390 × 844. The owner signed in as the owner. A second account signed in first as the LO and then as the assigned processor after the documented reassignment and role change. The browser account switches, observations, and control retries are included in elapsed time.

| Milestone | Elapsed | Observed result |
| --- | ---: | --- |
| Owner dashboards | 0:13 | Quinn opened from the $340,000 projection. The current and previous funding figures were $310,000 and $290,000. Taylor's funded referral opened Avery. |
| LO intake through mock submission | 2:24 | Riley's overdue campaign referral retained the Connected outcome and realtor. The prefilled borrower draft saved and resumed at phone width. The LO reviewed revision 2, priced with a fictional score of 742 and ZIP 48067, published a 6.125% sample quote, and sent the file to mock UWM. The Income alert focused the exact condition. |
| Processor accepted and returned | 5:41 | Processor saw Riley in their assigned queue and accepted the handoff. The scan rejected a blocked sample. The processor requested a replacement after a clean receipt, and the borrower submitted the replacement. Both accepted documents showed mock receipts while their conditions were still open. The batch clearance moved the count from two outstanding to zero. Processor returned the loan with a private note. |
| Closing and funding | 7:05 | The owner opened the return note from Today, completed the handoff and signing item, then recorded closing and funding separately. Funding moved from one loan at $310,000 to two at $670,000. Quinn's $340,000 projection stayed in place. |
| Realtor and repeat business | 8:15 | Realtor portal showed Riley Funded and omitted the private note and quote. Borrower portal omitted the private note. The failed follow-up run retried successfully. The owner recorded a requested callback and opened the separate refinance. Casey's sample rate moved the watchlist to Target met. |
| Calendar, Search, finance, exceptions, and migration | 10:54 | Calendar opened Riley's callback and Search listed the funded purchase and separate refinance. The owner ledger showed $7,200 expected, $6,000 received, and $1,200 outstanding, with commission and margin unknown. A new homeowners insurance request opened from Quinn's exception row. CRM preview reconciled four fictional rows and the reviewed MISMO mapping created a Riley Example draft. |

The full rehearsal exceeded the 5–7 minute demo target. The two-account role switch and verification steps added time. The starting fixture had no evidence exception. Codex created the request through the loan checklist during the run, then added it to the next seed and corrected the script so recovery happens before the funding check-in. This is a measured rehearsal on the earlier release. The two sign-off rehearsals still need to run on a single release with the corrected fixture.

## Migration acceptance on November 8, 2026

On `470d21d8-56a8-48be-8be3-ddb30645ab0d`, Chrome uploaded a four-row CRM file matching the existing Casey contact. The initial preview blocked the four linked rows for review. Selecting the existing contact and previewing again created one lead, one note, and one task and reused one contact. The downloaded CSV contained 12 records, including one Casey contact and one Casey lead.

The sample MISMO purchase at 102 Fictional Avenue and the uploaded refinance at 202 Fictional Avenue both linked to Riley Example. Re-uploading the same refinance opened the matching 1003 instead of creating a third draft. A second CRM receipt linked the existing Riley contact to the source. The refinance recorded one lender reconciliation decision and the purchase remained at zero. The cutover view explicitly assigns manual checks for borrower documents, lender status and conditions, and closing and funding history. On `5b8c8ba4-36d6-4576-89d0-4459c0202524`, the two linked drafts and separate review counts persisted.

## Revised fixture on November 8, 2026

On `5b8c8ba4-36d6-4576-89d0-4459c0202524`, Presenter Rehearsal B reset with the new seed. The owner opened the automatically created homeowners insurance exception from Playbooks, and the loan focused the correct request. The public product page describes the seeded exception. Presenter Rehearsal A retains the first run and migration evidence.

## Same-release sign-off rehearsals on November 8, 2026

Codex ran and narrated both rehearsals in Windows Chrome on `5b8c8ba4-36d6-4576-89d0-4459c0202524`. B started from the reset fixture and C started from a newly created fictional brokerage. The owner signed in as the owner. A second account signed in as the invited LO and then as the assigned processor. Both used the documented role switch. The desktop viewport was 1419 × 1243, and both borrower and realtor flows fit at 390 × 844. Timings include role changes and interaction checks.

| Milestone | B elapsed | C elapsed | Result in both |
| --- | ---: | ---: | --- |
| Owner reports | 0:18 | 0:08 | $340,000 projected, $310,000 funded this month, and $290,000 prior. Quinn and Avery opened from contributing report rows. |
| Lead, 1003, pricing, alert | 1:54 | 0:44 | The LO logged first contact, borrower saved and resumed the draft, and LO published the 6.125% sample quote. The mock Income alert focused its condition. |
| Processing and return | 3:44 | 1:34 | The assigned processor accepted. A blocked scan was visible, replacement was requested and received, two mock deliveries showed receipts before clearance, and the private return note reached the owner. |
| Closing and funding | 4:17 | 1:54 | Owner completed one closing item and recorded closing and funding separately. Two loans funded for $670,000, with Quinn's $340,000 projection intact. |
| Partner and retention | 4:58 | 2:17 | Partner saw Funded. Both portals omitted the internal note, and partner view omitted pricing. Owner recovered a simulated failed follow-up, recorded a callback, showed Casey's rate watch, and opened a separate refinance. |
| Owner operations and migration | 5:34 | 2:38 | Calendar opened the callback, Search showed both loans, Quinn's seeded exception opened the request, and the ledger reconciled $7,200 expected, $6,000 received and $1,200 outstanding with unknown costs. CRM preview and the sample MISMO draft completed. |

B's browser reload discarded the temporary document verification. The demo resend interval applied and was included in the elapsed time. In C, using the portal's Refresh status control kept verification active and picked up the replacement. The script records that path. Browser error logs for both staff tabs and borrower tabs and the C realtor tab contained no errors. The portrait pipeline exposed its stage selector above the fold at 900 × 1400. Local screenshots include `orbit-rehearsal-c-funding.png`, `orbit-held-file-audit.png`, and `orbit-portrait-pipeline-funded.png`.

## Additional acceptance on the sign-off release

- **Access and ownership.** In B, holding Quinn removed its projection. The owner reassigned and reopened the file and got exactly one title task in their queue on the original date. The audit preserved hold, reassignment, and reopening. The signed-in processor returned the handoff, accepted it again after resend, and approved an assigned internal review. Their search for Morgan returned no records. The owner transferred four loan assignments, unassigned both processor files, and redirected future realtor leads. Revocation denied a direct request for B while C remained accessible to the tester. The local authenticated Worker action test covered wrong brokerage, mismatched action scope, wrong owner, anonymous access and revocation.
- **Intake.** In C, Chrome uploaded a three-row campaign CSV. The first two leads went to Opus and John, and the third stayed shared at their configured caps. Replaying the CSV produced zero importable records. A new submission from the actual realtor portal appeared in the invited LO's queue with its partner and deadline. Jordan's campaign conversion kept the logged call and source and opened a prefilled 1003. New Lead also opened a separate direct 1003 with its own borrower. The regression suite covers the original routing deadline and duplicate checks.
- **Concurrent saves.** Two hosted owner tabs submitted competing changes on Quinn. The stale tab displayed its alert 61 px from the top while the dialog was scrolled 577 px. Refresh loan loaded the winning version and the original title was restored. In the current-build Workerd run, distinct LO and processor sessions had one winning conflicting write and one rejection. The retry retained the revision and independent closing and document edits both persisted. The heavy LO response was 2,364 bytes, and the conflict response was 108 bytes. The local evidence folder contains the authenticated read and write logs.
- **Dashboards.** C restored named owner funding, realtor sales, and processing workload views after reload. The team funding and realtor targets persisted. The invited LO's report retained its $900,000 target, showed $310,000 current and $290,000 previous, and opened Avery. The team processing view restored Unassigned and Next 7 days and opened Quinn's title item. A separate LO sign-in added a $285,000 projection. The already-open owner report refreshed from $615,000 to $900,000 and opened the new loan's closing workbench.
- **Collaboration and boundaries.** C simulated a reply with two Riley loans as matches. A source replay kept one receipt and only one simulated email appeared in the chosen refinance conversation. Manual outreach used the Manual log label. Its dated follow-up appeared in Today and Calendar, and opening it preserved the week and filter on return. B's processor approved the separate internal review. Current-release mock DU and LPA returned findings, including a failed LPA attempt and retry. Staff, borrower, and partner labels distinguished the sample pricing, mock lender, verification and scans, and simulated reply from staff-entered records.

## Design rehearsal D on November 8, 2026

The fresh Presenter Design Rehearsal D brokerage `e7ee6848-6bff-4083-ab1d-3435e2d45d9a` used separate owner and invited LO accounts, then assigned processor. The tool-driven rehearsal began at 9:41:01 p.m. ET on `8e1854ba-20c8-4cf1-beaf-8fa887b11812` and ended at 9:50:01 p.m. ET. The total of 9:00 includes account switches, a scan retry, control discovery, and one page reset. Borrower and realtor views used a 390 × 844 viewport.

| Milestone | Elapsed | Observed result |
| --- | ---: | --- |
| Owner dashboards | 0:48 | $340,000 projected, $310,000 funded, and $290,000 prior. Open loan revealed Quinn's inline record, which linked to the closing workbench. Taylor had one funded referral in each period. |
| LO intake, 1003, quote and alert | 2:16 | Riley's overdue campaign task opened the call. Connected was saved. The borrower resumed the saved draft and submitted revision 2. The LO reviewed it, priced with ZIP 48067 and a mock score of 742, published the 6.125% quote, and opened the exact Income condition from My Tasks. |
| Processing and return | 4:59 | After Riley was reassigned to the owner and the invited account switched to Processor, it accepted the handoff. The borrower saw a blocked scan, sent clean samples, and retained verification when the processor requested a pay-stub replacement. The processor sent both accepted samples to mock UWM, cleared both together, and returned the file with a private note. |
| Closing and funding | 6:22 | Today opened the returned handoff. Completing it surfaced Review closing readiness and the guarded Clear to Close action. The owner completed the signing item and recorded closing and funding separately. Funding rose to two loans and $670,000. Quinn's projection remained $340,000. |
| Recovery, realtor, and repeat business | 8:08 | Retrying the simulated funding failure created the check-in. The realtor showed Riley Funded without the internal note or pricing. The borrower view also omitted the note. The owner saved a dated callback, opened a separate prefilled refinance 1003 from Past Clients, and triggered the seeded rate-watch follow-up. Search returned both loans and the existing contact. |
| Owner operations and migration | 9:00 | Calendar showed Riley's November 9 callback. Quinn's exception opened the exact insurance request. CRM preview reconciled four fictional records and the reviewed sample MISMO mapping created a Riley Example draft. Financials showed Riley and preserved unknown compensation and margin as Unknown. |

At 9:48:04 p.m. ET the website publication switched the hosted release to `8eabfb39-2c13-4e57-a944-4c358f94ffc2`. The app source came from the archived `8e1854ba` candidate and only marketing files changed. The workspace returned to the pipeline during the contact-history step. The owner reopened the contact and continued. This run provides functional evidence across the release boundary. The 9:00 elapsed time exceeded the 5–7 minute target and the run does not count toward the two same-candidate sign-off rehearsals. The `design-pass/roles` evidence directory holds the mock scan error and funding captures.

On `8eabfb39`, two owner tabs edited Riley's completed signing item from the same revision. The winning edit persisted. The stale tab retained its unsaved input and showed “This closing item changed. Refresh the loan before saving.” The alert sat 61 px from the top beside the loan refresh control. Refresh loaded the winning title, and the owner restored the original fictional title. The evidence directory includes `rehearsal-d-stale-edit.png`.

## Final same-release rehearsals E and F on November 8, 2026

Both fresh hosted brokerages ran on `2d3265d0-ec1e-486b-b0eb-8f5661b38e23`. Presenter Final E is `00de6e14-b802-4b8e-a0c9-6d0bc73d5614`; Presenter Final F is `493b3305-536e-463e-9870-c58cdf5cc4bd`. The owner operated the staff workspace. A second account signed in as the invited LO, then as the assigned processor after the documented role switch and Riley's reassignment. Setup took 20 and 16 seconds respectively once the Create brokerage form was ready. E started at 10:05:29 p.m. ET and F at 10:09:58 p.m. ET. These are elapsed browser rehearsal times including tool pauses and retries. A speaker's narration time was not measured.

| Milestone | E elapsed | F elapsed | Observed result in both |
| --- | ---: | ---: | --- |
| Owner reports | 0:09 | about 0:10 | $340,000 projected, $310,000 funded, $290,000 prior. Quinn's closing workbench and Taylor's funded referral opened from the contributing records. |
| Outreach, 1003, quote, and alert | 0:46 | 0:49 | Riley's overdue task opened the campaign. Connected was recorded. The prefilled 1003 saved, reopened, and submitted. The LO reviewed it, priced at ZIP 48067 with a mock score of 742, published the 6.125% quote, and opened the exact Income condition. |
| Processor and clearance | 1:45 | 2:52 | The processor accepted the handoff. The blocked mock scan surfaced before the clean files. Borrower verification persisted through the replacement request. The lender refresh worked with one request outstanding. Both received samples showed accepted mock deliveries before one batch clearance cleared the two conditions. A private note accompanied the return. |
| Guarded closing and funding | 2:14 | 3:17 | Today opened the return and the owner completed it. Review closing readiness led to Mark Clear to Close. The signing item was completed. Separate closing and funding dates produced two funded loans totaling $670,000 and left Quinn's $340,000 projection intact. |
| Recovery, partner, and retention | 2:43 | 5:30 | The original failed follow-up retried. Realtor and borrower views omitted the staff note. The realtor saw Funded and no pricing. Save & start repeat 1003 kept the callback and opened the prefilled refinance. Casey's 6.000% sample observation opened the rate-watch follow-up. |
| Owner operations and migration | 4:04 | 5:55 | Search distinguished both loans and Calendar showed the dated callback. Quinn's exact insurance request opened. The owner ledger showed $7,200 expected, $6,000 received, and $1,200 outstanding with unknown margin. CRM preview reconciled four fictional rows. The reviewed MISMO mapping opened a separate Riley Example draft. |

E's first attempt to open Search left the rate-watch drawer active. Closing the drawer restored Search. F's browser driver initially targeted the previous borrower tab to refresh status. It then selected F's actual tab and continued through the visible demo code flow. These interruptions are included in the elapsed time. All changes were made using the hosted UI. Deployment history confirmed no release change during either run. Post-run browser logs contained no app errors in the sampled owner, processor, borrower, or realtor tabs.

The `design-pass/roles` evidence directory contains `rehearsal-f-funded.png`, `rehearsal-f-borrower-390.png`, `rehearsal-f-realtor-390.png`, and `owner-closing-200-percent.png`. The presenter should load a fresh fictional brokerage before presenting and use the [presenter script](demo-presenter-script.md) to keep the sample boundaries and two-account role switch explicit.

## Timed CSV-to-repeat browser run on November 9, 2026

The fresh Timed CSV to Repeat Pilot brokerage `b8fb1174-43d2-42df-a5c1-edb0f1b6bf39` ran on `dd019ed3-abeb-4568-bd7a-fa1b8367194a`. Preparing the fictional pilot and campaign took 15 seconds. The timed run started when the owner opened the campaign import and ended when the separate refinance borrower view showed the original borrower’s name. One signed-in owner ran the seven-step campaign guide with built-in text samples. The timer included browser actions and tool pauses. Narration, role switches, and PDF scanning were outside this run.

| Checkpoint | Elapsed | Evidence |
| --- | ---: | --- |
| CSV imported | 0:04 | Jordan assigned to the owner with the first-contact deadline. Casey stayed shared. |
| Connected and initial 1003 opened | 0:18 | Start 1003 stayed in Ready to call after logging Connected. |
| Borrower submitted | 0:21 | The prefilled fictional borrower submitted from the separate borrower view. |
| Staff review | 0:29 | Refresh loan loaded the submission and the owner marked its revision reviewed. |
| Mock credit and saved quote | 0:49 | The mock score fed pricing and the owner saved a quote. |
| Mock lender receipt and borrower samples | 1:10 | The saved quote opened the mock lender checklist at 1:05. The borrower refreshed status and attached two text samples. |
| Both conditions cleared | 1:24 | Refresh checklist loaded both samples. The owner accepted both and cleared them with one mock check. |
| Closing and funding | 1:44 | The owner marked Clear to Close and recorded closing and funding separately. |
| Separate refinance 1003 | 1:48 | Closing opened the check-in, the owner scheduled the callback, and the staff record opened the distinct repeat borrower link. |

The presenter switched between staff and borrower views for submission and documents, then opened the repeat borrower view at the end. The manual refresh points were Refresh loan after submission, Refresh status after document requests, and Refresh checklist after sample attachment. The guide marked all seven steps complete. After timing stopped, the companion rate-watch example produced a follow-up at the sample 6.000% observation, and the borrower callback opened at November 10 at noon Eastern.

The public demo copy shipped on `8402d730-a8cf-4f63-a578-378f2d99720c`. The finished guide still showed 7 / 7 at 375 px on that release. Build, lint, typecheck, all 223 tests, the local working-day rehearsal, and the recovery rehearsal passed. The `design-pass/roles` evidence directory contains `hosted-timed-csv-to-repeat-mobile.png`.

## Automatic staff refresh on November 9, 2026

On `3fcc66aa-83a1-4600-b785-d39fbe286b58`, the fictional Cameron Return Example loan updated from Draft to Needs review in its open staff 1003 section after the borrower submitted in another Chrome tab. The staff Conditions section picked up the sample pay stub without a manual refresh. After an unsaved request draft was typed, a second attachment paused automatic refresh and kept the draft text. After discarding the draft, the owner refreshed the checklist, accepted both samples, and cleared both conditions in one mock check. The public demo page describes the handoff. The `design-pass/roles` evidence directory contains `hosted-tab-return-draft.png`.

The hosted run verified the same-browser signal. Automated tests cover visibility and focus return, duplicate events, and stale responses after leaving again. The browser run still used Refresh status to fetch the staff requests on the borrower side. Lint, typecheck, build, all 226 automated tests, and both local rehearsals passed.

## CSV-to-repeat rerun without refreshes on November 9, 2026

The fresh fictional brokerage `97d9f314-7c54-43e1-92ae-25d3a0760f36` ran the seven-step guide on `83c9f080-8409-40ca-8559-0b0b6f44fa03`. One signed-in owner used separate staff and borrower tabs. The browser run took 2:08 from opening the CSV import to verifying the original borrower’s name on a distinct refinance link. It used zero manual refreshes, compared with three in the earlier 1:48 run. Elapsed time includes selector retries and tool pauses. Narration and role changes were outside the timed run.

| Checkpoint | Elapsed | Observed result |
| --- | --- | --- |
| Assigned lead and original 1003 | 0:37 | Two fictional rows imported, with Jordan assigned and Casey held in the shared inbox. Jordan’s Connected call opened the prefilled draft. |
| Borrower submission and review | 0:48 | The submitted revision reached the staff loan automatically and the owner selected Mark reviewed. |
| Mock pricing and lender receipt | 1:14 | ZIP 48304 and mock score 742 carried into the saved quote. The lender receipt opened both conditions. |
| Requests and evidence | 1:17 | A single staff action produced both requests in the open borrower tab. Both text attachments appeared in the open staff checklist. |
| Condition clearance and funding | 1:36 | Two mock deliveries cleared in one check at 1:26. The owner marked Clear to Close and recorded closing and funding separately. |
| Separate repeat application | 2:08 | The owner saved the callback and opened a distinct, prefilled refinance. The guide showed 7 / 7. |

On a separate fictional file, a built-in PDF appeared in the staff checklist after the mock scan. The borrower saw a staff replacement request automatically, used the same verification session, and submitted the replacement. A subsequent unrelated request appeared without resetting the selected PDF fixture on an existing request. No application errors appeared in the five sampled tabs. Public demo copy, all 227 tests, lint, typecheck, the production build, and both local rehearsals passed. The `design-pass/roles` evidence directory contains `hosted-no-refresh-guide.png`.

## Chrome file selection and mock clearance on November 9, 2026

On `bbeed7ac-0c1b-40e9-a432-2baac8097a8f`, the Chrome file chooser selected a local fictional MISMO XML. Migration displayed the mapped borrower and the $360,000 loan amount. The hosted check stopped at preview. The signed-in local rehearsal created and reopened the draft.

In the separate fictional referral guide, the borrower checklist showed that the demo pay stub and bank statement had passed the mock scan. The staff condition alert opened the same loan with two documents ready for review. Accepting and mock-sending each document produced a delivery receipt. Checking clearance left two accepted documents, three cleared conditions, and zero outstanding. The guide then offered the move to Clear to Close and the realtor milestone step.

## Timed uploaded CSV and PDF rehearsal on November 9, 2026

The fresh fictional brokerage `67623162-0af4-4138-a87c-e6c25f682680` ran on `bbeed7ac-0c1b-40e9-a432-2baac8097a8f`. One signed-in staff account opened the campaign importer, selected the local rehearsal CSV through Chrome’s file picker, and ran the guide with separate original and repeat borrower tabs. The timer stopped when the distinct repeat link displayed the original borrower’s prefilled name.

| Checkpoint | Elapsed | Observed result |
| --- | --- | --- |
| Uploaded CSV committed | 0:12 | Jordan received the LO assignment. Casey stayed in the shared inbox at capacity. Both received a November 10, 7:15 a.m. Eastern first-contact deadline. |
| Original application reviewed | 0:43 | The Connected call opened a prefilled 1003. The staff tab picked up the borrower’s submission automatically. |
| Quote and lender handoff | 1:14 | Mock credit score 742 and ZIP 48304 carried into pricing. The saved quote opened the mock UWM checklist with two conditions. |
| PDFs and clearance | 1:49 | Both staff requests appeared in the open borrower checklist. Demo verification enabled the two clean PDFs. Staff received both automatically, recorded two mock delivery receipts, and cleared both conditions together. |
| Closing and funding | 2:09 | Clear to Close opened the closing and funding actions. The funded file showed a post-funding check-in, and the campaign promoted Casey into the freed call slot. |
| Separate repeat 1003 | 2:51 | The check-in scheduled a callback. Choosing Refinance opened a distinct borrower link with the original identity. The guide showed 7 / 7. |

The timed run used zero manual refreshes and included the browser driver’s selector retries and pauses. It excluded workspace setup, narration, and staff role changes. No browser errors appeared in the three sampled tabs.

The public demo page published the result on `6ef0e44b-6dbb-48be-9c4d-3def3bd3385d`. The marketing-only change passed lint, typecheck, all 262 tests, and the Cloudflare build. The deployed Demo and Product pages returned HTTP 200 with the expected copy. A fresh signed-in browser tab still showed 7 / 7 and the repeat application action after deployment.

## Separate browser handoffs on November 9, 2026

On `41d51f26-eb70-4a0a-9587-46ba0e56f75b`, a signed-in Chrome admin opened Avery Cross-Session Example’s 1003. The fictional borrower used the independent ChatGPT in-app browser on the same computer. Both browser documents reported visible. The open staff 1003 showed **Mark reviewed** 6.5 seconds after the borrower submitted. The open borrower checklist showed the new pay-stub request in 13.6 seconds. Staff saw the mock-scanned PDF ready for review in 15.3 seconds. Timings include browser actions and observation. Neither side used a manual refresh.

The replacement request reached the borrower with the demo verification still active and the replacement fixture selected. Staff entered an unsaved request for a different document. The view kept that text through a check interval. Leaving the draft allowed the updated pay stub to reach the open checklist and be accepted. A subsequent correction request opened the saved borrower application and showed the correction note automatically. Neither browser logged an app error.

The signed-in local Worker run verified that an unchanged check returns `{ "unchanged": true }`, a submission and attachment refresh the exact loan, and another officer or brokerage is denied. The attached processor could read the received document. The public demo copy was verified after deployment. All 264 tests, lint, typecheck, the production build, and both local rehearsals passed.

## Incoming borrower work with the loan drawer closed

On `9f31d336-7ab2-4f9f-b7cc-4d5fd82d5929`, an owner in the fictional Presenter Final F brokerage kept **Today → My Tasks → Due today** open in Chrome. The separate in-app borrower browser submitted Morgan Incoming Queue Example’s fictional application. The review card appeared in 10.4 seconds without a manual refresh. It focused `loan-application`, and marking the application reviewed removed the item on return to Today.

The owner requested a standalone pay stub, assigned the loan to the existing fictional processor, and left **Processing → Assigned files** open. The sample PDF passed the mock scan in the borrower browser. The team Processing card appeared in 1.0 seconds with the loan drawer closed. It focused the exact pay-stub request. Accepting the PDF and closing the drawer removed the card. Timings include the browser driver and depend on when the foreground check runs. Neither browser logged an app error.

The hosted run used the admin’s Today and team Processing views. The signed-in local Worker verified the owner’s 1003 and document, the assigned processor’s linked document, and denial for an unrelated officer. SQLite checks also cover tenant scope, page ties, closed review items, and held files. Lint, typecheck, all 265 tests, the Cloudflare build, and the working-day and recovery rehearsals passed.

## Live processing handoff and return

On `c15223ba-9334-4579-957a-6f40eed1905c`, two open staff tabs in the same hosted admin session rehearsed Morgan Incoming Queue Example in Presenter Final F. The Ready to accept queue showed the new handoff in 2.6 seconds. **Processing → Assigned files → Incoming loan work** showed the staff send note. Its action focused `processing-handoff` and the staff tab accepted the file.

With the first tab on **Today → My Tasks** and the loan drawer closed, the other tab returned the file. Today displayed the return note in 15.1 seconds. Its action focused the exact handoff and showed the same note. Completing the handoff cleared the item. Neither staff tab used a manual refresh. The separate borrower browser showed neither staff note. The three tabs reported no app errors.

The signed-in local Worker used distinct LO and assigned processor sessions on the same implementation. It verified the approved handoff, the two condition clearances, the exact return note and revision, and removal after completion. An unrelated officer could not read the item. Neither the borrower nor the realtor response included the note. All 265 tests, lint, typecheck, the Cloudflare build, and both local rehearsals passed.

## Live reply arrival and promised callback

On `706d9314-a27f-44a3-ad23-da616239b438`, the fictional Casey Campaign Reserve lead had a requested callback for November 10, 2026 at noon Eastern. One Chrome tab queued a simulated inbound email in Reply review while another tab in the same admin session stayed on **Today → Due today**. The pending receipt did not appear in Today. Attaching it to the matching lead produced the reply card in 3.4 seconds without a manual refresh. The card and the opened conversation showed the same time, and **Open promised callback** focused Casey’s campaign card with the deadline intact. Neither tab logged an app error.

The signed-in local Worker verified separate admin and assigned LO sessions, denial for an unrelated LO and processor, and refusal to open a callback with an outdated timestamp. The public Demo page showed the updated reply walkthrough. All 265 tests, lint, typecheck, the Cloudflare build, and both local rehearsals passed.

## Live conversation and callback after conversion

On `c0473a1b-403e-4846-a7f2-db0ad2aa6894`, the fictional Casey Campaign Reserve reply opened its linked lead. **Create loan and prefill 1003** opened the new draft. The separate borrower browser showed Casey’s prefilled name. Today in another staff tab in the same admin session switched from the lead thread to the loan thread in 9.5 seconds without manual refresh. The original simulated message and November 10 noon Eastern callback remained visible.

**Open promised callback** focused the exact loan task and showed that it was still due at the original time. All three browser tabs reported zero app errors. The SQLite regression verified the same conversation and task IDs, a repeated conversion with one task, and disappearance of the callback context after task completion. All 265 tests, lint, typecheck, the production build, and the local working-day and recovery rehearsals passed. The public Demo page carried the updated conversion copy.

## Live callback outcome after conversion

On `f6938400-5392-4057-9ea8-addafa8a5b0d`, the signed-in pilot admin opened the originating campaign and saw Casey Campaign Reserve's callback as **Upcoming** with the November 10 noon Eastern deadline. From **Today → Replies needing attention**, the admin opened the loan conversation and used **Open promised callback** to focus the exact loan task. Saving **Connected** completed the task and recorded the same fictional note in loan activity and the campaign report. The report showed **On time** against the original deadline and showed the original request and new attempt under **View call history**.

Chrome's file chooser also accepted a one-row fictional CSV and Orbit displayed its parsed lead in the import preview. The public Demo page showed the callback workflow and fictional brokerage examples. The SQLite regression covered the assigned LO, rejected other officers and processors, preserved a missed deadline across a late reschedule, and recorded only one attempt on retry. All 269 tests, lint, typecheck, the Cloudflare build, and both local rehearsals passed.

## Live manager and invited LO callback handoff

On `0a07d5c0-adde-4462-9d68-3a2fc608496d`, the manager uploaded a one-row fictional CSV into a dedicated campaign in Presenter Rehearsal C and assigned it to the invited LO. The LO signed in with their own account, logged a promised 8:19 a.m. Eastern callback and created the prefilled 1003. After the deadline the manager's **Overdue callbacks** showed the same owner and time on the converted loan. **Open loan callback** focused the exact task. The manager reassigned the fictional file and restored it to the original LO. The owner in the queue changed each time and the deadline stayed fixed.

The invited LO signed in again, opened the exact task from Today and logged Connected. Today and the manager exception queue cleared the task. The manager's campaign report recorded **Late** against 8:19 a.m. and showed the LO's timestamp and note. The original manager session was restored. The hosted run used sequential sign-ins in Chrome. The built Worker verified independent local manager, LO and processor sessions, denied the former owner and processor, and recorded one attempt across a retry. All 270 tests, lint, typecheck, production build and both local rehearsals passed. The public Demo page described the workflow.

## Live longer-dated callback after conversion

The manager uploaded a fictional Riley Long Callback QA row in Presenter Rehearsal C and assigned it to the invited LO. The LO scheduled November 24, 2026 at noon Eastern and opened the prefilled 1003. The previous release kept the task on the loan but omitted it from **My campaign callbacks → Upcoming**. On `2d0f7c34-ee38-4669-b827-cb4aac8ab66b`, Upcoming showed the same loan, campaign and time. **Open loan callback** focused the exact loan task with the outcome control. The callback lay outside Today's seven-day window and was left open for a future rescheduling rehearsal. The original admin session was restored, and the public Demo page described the updated queue.

SQLite tests cover tied dates across lead and loan tasks, paging, reassignment, exact due boundaries, holds and opt-outs. The built Worker verified separate signed-in roles, the long-dated callback moving to the new owner and removal after a recorded attempt. SQLite query plans used the existing lead and loan owner indexes. All 271 tests, lint, typecheck, the Cloudflare build and both local rehearsals passed.

## Live rescheduling of a callback on the loan

On `fb2da7bc-6841-4d63-9c50-036275387f3a`, the invited LO opened Riley's original loan task from **My campaign callbacks → Upcoming**. They moved it from November 24 at noon Eastern to November 9 at 8:32 a.m. The same task appeared in Today and the loan activity showed the reason. After 8:32 a.m. the LO rescheduled the callback to November 25 at noon. Today cleared the task and Upcoming displayed the new time. The manager's overdue queue and campaign report both retained 8:32 a.m. as the missed deadline and displayed November 25 as the scheduled time. The campaign report also retained November 24 as the original promise. The original admin session was restored and the public Demo page showed the new workflow.

The built Worker exercised a reschedule after reassignment, denied the former LO and processor, replayed one update without a duplicate activity entry, and reported the eventual call against the missed deadline. The SQLite regression exercised a second change back to the original scheduled time and rejected a stale save. All 271 tests, lint, typecheck, Cloudflare build, and both local rehearsals passed.

## Current-release timed executive demo

The [fresh hosted run](executive-rehearsal.md#current-release-executive-rehearsal) took 3:27 from opening the CSV importer to the rate-watch task and completed all seven guide steps with a separate prefilled refinance. The timed run used the mock verification and PDF route. A follow-up release clarified the credit authorization and PDF instructions and verified the new closing and funding date shortcuts on a second fictional loan. The public Demo page reflects the current measurement.

## Live checklist entry after attachments

In fictional brokerage `76178791-746f-4d26-927a-f8a2eacc838f`, the borrower submitted two sample PDFs while the staff checklist was closed. On `650fe6f6-1477-4411-a861-95fcfdd3953d`, the first staff render showed both requests as waiting. The scheduled foreground check later updated the checklist. On `1995bf42-7012-42d3-9e04-0871aaa2ea0a`, the staff guide was open before the two replacement PDFs arrived and still showed the borrower instructions. Clicking its checklist opened both documents as ready for review on the first render in about 0.3 seconds in this browser run. No manual refresh was used.

After one clearance, the guide focused the exact remaining condition, which was ready for review. Mock UWM cleared the second condition. No app errors appeared in the sampled staff tab, and the public Demo page reflected the change. The built Worker verified matching current document revisions for the assigned LO and processor and denied the unrelated officer. All 271 tests, lint, typecheck, the Cloudflare build, and both local rehearsals passed.

## Paired processor rehearsal from the tagged demo

On Worker `12943747-dea9-412d-8596-36583e6aceef` from source `85b539d7bb374b80d62cbc8fbb511f8abc67c702`, a fresh campaign lead in Presenter Final F moved through a reviewed 1003, mock pricing, and a mock UWM receipt. The brokerage admin owned and originated the file. The assigned Processor signed in separately, opened the exact file and private send note in **Processing**, accepted it, and requested the two lender documents. The processor reviewed the two mock-scanned PDFs, cleared the mock conditions, and returned the file with a note. The owner opened that exact return from **Today**, completed the handoff, recorded closing and funding, and opened a separate prefilled refinance. The guide reached **7 / 7**. The borrower did not see either internal note. No app errors appeared in the sampled tabs.

| Hosted action | Elapsed |
| --- | ---: |
| Owner sends to processing and sees the acknowledged state | 1.22 s |
| Processor opens the exact handoff from the queue | 0.29 s |
| Processor accepts and sees the updated state | 0.99 s |
| Processor returns and sees the acknowledged state | 1.26 s |
| Owner opens the exact return from Today | 1.14 s |

Chrome used separate accounts in sequence within one browser profile. These single observations measure browser actions and acknowledgment or open times. They exclude account switching and do not measure the delay between simultaneously open hosted queues.

The local timing harness ran against the tagged build in three isolated fixtures with independent LO and processor sessions and zero role changes. LO sends took 6 ms in each run. Processor returns took 7, 7, and 6 ms. The recipient's first queue read after acknowledgment returned the exact loan and note in 3 ms in each direction and run. These are local Worker timings with an immediate request. Browser polling and network latency are separate.

## Hosted repeat refinance with a manual lender

On Worker `b47826dd-a667-44ac-aa96-7e65289d6e0c` from source `c8d2c060d441`, Casey’s fictional refinance went through borrower submission, staff review, and a browser-downloaded MISMO 3.4 XML. The downloaded file parsed and contained the refinance purpose, borrower name, and property ZIP. The staff user recorded the fictional lender’s acknowledgment in the export panel and opened the exact condition checklist by lender reference.

The borrower submitted a built-in PDF after mock verification. The staff user accepted it, recorded distinct delivery and clearance references, then followed **Review closing readiness** to **Mark Clear to Close**. Closing and funding saved separately. **Reports → Returning clients** showed the refinance as Funded with links to both loans. No app errors appeared in the sampled staff tab.

The built Worker also checked rejection before export, loan access, duplicate acknowledgment, the open-condition closing guard, and the unchanged campaign attribution. All 273 tests, lint, typecheck, the Cloudflare build, and both local rehearsals passed. The public Demo page describes this fictional flow. Lender-specific import acceptance still needs validation against the receiving lender’s profile.

## Hosted manual lender return and corrected export

On Worker `61bf8d5a-05b9-4923-8f44-9e007a3adfe1` from source `1a7431e1ee90`, the fictional lender returned a reviewed refinance that had reached Clear to Close. Orbit moved it back to Underwriting. The same borrower link opened the staff instructions and saved a corrected $359,500 request. The original downloaded MISMO revision 3 parsed at $360,000 and the corrected revision 7 parsed at $359,500.

The revised acknowledgment prefilled reference `FICT-REVISION-01` and reopened its only checklist. It still showed the original accepted sample, delivery revision, and clearance reference. The loan showed **Review closing readiness** again. The first borrower navigation after reload needed a second click. The sampled staff tab reported zero browser errors.

The local built Worker also verified denied cross-officer access, exact return replay, mismatched lender references, rejection before a fresh export, revision-specific second review, and the unchanged condition and document IDs after re-acknowledgment. All 273 tests, lint, typecheck, build, and both local rehearsals passed. The public Demo page describes the return path.

## Hosted lender returns in staff queues

On Worker `06720fb4-d024-4839-8fd0-a15bd41bac39` from source `a4bc3a902b4f`, an existing fictional lender return appeared in Today and **Playbooks → File exceptions → Manual lender returns**. The manager view showed the owner and original reference. The borrower’s corrected submission changed both views to **Corrected 1003 ready for review**. Today opened the application, and the manager exception opened the revised export after staff review.

Today then focused the acknowledgment form directly. Recording acknowledgment cleared the owner’s row, and a refresh confirmed the separate manager tab was empty. Neither sampled staff tab logged an app error. The local working-day rehearsal checked the required second-review phase, fresh status lookup, officer and manager scope, and clearing both rows after acknowledgment. All 274 tests, lint, typecheck, the build, and both local rehearsals passed.

## Hosted lender-return reassignment

On Worker `a8f298be-928b-466f-baed-d1f1aac95496` from source `09b209e8f80d`, the fictional brokerage admin reassigned Casey’s return from File exceptions to an invited LO. The manager queue updated the owner while preserving the return timestamp, current 1003 revision, and lender reference. The prior owner’s Today row cleared. The invited LO signed in separately, opened the same return from Today, and found the original borrower link, delivery, and clearance records. The test used sequential sign-ins in Chrome and restored the original admin session.

The built Worker verified that a non-admin, an ineligible processor, a stale owner, and a resolved or different return cannot change the assignment through this action. It verified a replay and let the new officer finish the revised handoff and record fictional funding. All 274 tests, lint, typecheck, the Cloudflare build, and both local rehearsals passed. The public Demo page reflects the reassignment.

## Hosted lender-return deadlines

On Worker `cf83a580-1b8f-4703-89f0-53c25cef7480` from source `8b064605c2bd`, the fictional brokerage showed a 24-hour deadline on its existing return. The manager's **Overdue lender returns** filter excluded that still-current row. Saving a six-hour playbook policy left the earlier deadline in place.

The borrower resubmitted the 1003 from the same link. Staff reviewed the corrected application, downloaded its revised MISMO XML, and recorded acknowledgment under the original fictional lender reference. A subsequent return at 10:16 a.m. Eastern showed a 4:16 p.m. deadline. Reassigning that return preserved the deadline in **File exceptions** and **Today**.

The deterministic SQLite test checked the exact boundary and one millisecond after it. The built Worker checked that a stored deadline survives a later policy edit, workflow transitions, and reassignment. All 275 tests, lint, typecheck, the Cloudflare build, and both local rehearsals passed. The public Demo page describes the overdue queue. The hosted rehearsal used a separate fictional workspace from the executive demo.

## Hosted lender-return follow-up log

On Worker `52ab0e3f-ee61-47ba-a83b-764e92f18b3b` from source `9ff0a85e9053`, the owner logged a fictional borrower call directly in **Today → Incoming loan work**. Today showed the outcome, actor, and time beside the original deadline. **Playbooks → File exceptions → Manual lender returns** showed the same entry. Reassigning the loan changed the owner and preserved both the follow-up and deadline. The public Demo page showed the new workflow. The hosted rehearsal used a separate fictional workspace.

The built Worker used independent staff sessions to verify the new owner's access, denial for the former owner, replay without duplicate history, and private follow-up through revised acknowledgment. The borrower response exposed only the correction instructions. SQLite also verified that logging an attempt removes the row from **Overdue lender returns without follow-up**, while the open return stays in **Overdue lender returns**, and that a later return on the same lender file starts its own history. The hosted borrower tab was unavailable to this browser session, so borrower privacy and the past-due case were verified locally. All 276 tests, lint, typecheck, the Cloudflare build, and both local rehearsals passed.

## Hosted scenario-to-quote rehearsal

On Worker `dd7a8702-bf71-4b62-880e-da53e6108dcc` from source `f0ae23d3f57e`, a fresh fictional lead went through borrower 1003 submission and staff review. Staff compared the 6.125% par offer and 5.875% points offer from the same mock run. The latter showed a 48-month cost break-even. Staff saved that recommendation for a 60-month plan and opened the exact $360,000 source quote in Pricing. The quote was saved and published as a separate action.

The borrower saw the sample 5.875% rate and $2,129.54 monthly principal and interest. The internal recommendation stayed private. Sending the reviewed 1003 from the saved quote opened the two mock UWM conditions. The public Demo page showed the new comparison workflow. A separate hosted check saved and reloaded a three-option sample for Olivia Parker in the shared fictional demo.

The combined Worker rehearsal also kept the referenced unselected offer through a subsequent pricing run, rejected an invalid source and edited linked terms, and rejected a handoff referencing a different offer. All 282 tests, lint, typecheck, Cloudflare build, and the working-day, recovery, and scenario API rehearsals passed. A local Next.js SQLite smoke check opened the editable comparison endpoint.

## Hosted fictional preapproval letters

On Worker `93ccecfd-30ed-4c68-b7d1-5c8bdebaa727` from source `4e1e602c6e5b`, staff issued a $360,000 subject-property sample for a reviewed fictional purchase and downloaded version 1. A $350,000 property-search sample became current, and version 1 remained available as superseded. The downloaded version 2 rendered with the amount, December 9 expiry, issuer, and visible fictional-use label. The public Demo page showed the release copy after the hosted rollout reached the custom domain.

The built Worker verified required second approval, an issue retry with one audit entry, denial for the assigned processor and unrelated LO, and unchanged bytes on an archived download. SQLite tests exercised Eastern-date expiry, later 1003 revisions, pagination, and reassignment. All 285 tests, lint, typecheck, build, and both local rehearsals passed. In local Next.js, `3eb906958aac` normalized SQLite rows before they crossed the React boundary. The local browser then opened the new loan in Pipeline, reviewed its 1003, issued two sample versions, and downloaded the first PDF.

## Hosted private sample letter sharing

On Worker `13580dd3-7e56-46b8-aef5-53509be22af9` from source `edd2a79f747a`, neither portal showed the issued fictional letter before publication. Staff published to the borrower first and confirmed the linked realtor still had no PDF. After separate realtor publication, both portals downloaded the exact archived PDF and staff saw both first-request timestamps.

The realtor's already-open download was rejected after staff withdrew that grant. The borrower card stayed available until staff issued a new version. The replacement started private to both audiences and the borrower portal removed the earlier card. Both browser downloads matched the archived staff PDF by SHA-256. The public Demo page showed the new workflow.

The built Worker checked both portal endpoints, unrelated officer and wrong-token denial, independent withdrawal, unchanged archived bytes, and denial after replacement. SQLite also covered expiry at Eastern midnight, stale recipient confirmations, changed application revisions, rotated portal links, and realtor removal followed by reassignment to the same contact. All 288 tests, lint, typecheck, build, and both local rehearsals passed.

## Hosted configurable website quote intake

On Worker `068fd6bf-17ec-4063-920f-4cbf8ac866c9` from source `bddd7998f554`, an admin in the separate Guided Demo workspace previewed the Evergreen form with a required ZIP, timeline and short question, then published version 1. The same borrower link opened the published form. Two fictional phone requests went to different active staff members with one open slot each. The third stayed in the shared queue. An email-only request reached the shared inbox. All four retained the website source and ZIP. Converting the second lead routed the waiting campaign lead to the newly open slot. The borrower 1003 showed the prefilled name and ZIP, and loan Activity showed the website source, form version, timeline and original answer.

The final Worker `af9722ce-6727-48cd-b7eb-a1b43028a1b5` from source `3981c1ebd1da` uses full-width fields on narrow phones. At a 390-pixel viewport the form had one column, the selected timeline fit, and there was no horizontal overflow. The public Demo and Product pages both showed the update. The executive demo workspace was reserved for the presenter.

All 291 tests, lint, typecheck, the Cloudflare build and the working-day and recovery rehearsals passed on the final source. The built Worker covered brokerage and role denial, stale versions, replay, email-only routing, exact source through conversion and automatic capacity refill. SQLite covered retained answers, opt-out, unavailable roster and changed campaign rules.

## Hosted brokerage document checklist templates

On Worker `2c73f834-1d10-4132-9297-318eee1d1dfc` from source `10a4d30c0e13`, the Guided Demo admin published a purchase template with a same-day bank statement and a photo ID due in two days. The fictional loan already had a photo ID with its own date and instructions. The loan preview showed one new request and one existing request. Applying it added the bank statement and kept the existing photo ID.

The submitted borrower 1003 exposed both requests with their dates and instructions. File Exceptions showed the missing bank statement, the current loan officer, and its same-day deadline. Its action focused the original request. A borrower tab submitted the clean sample PDF through mock verification and scanning, and the staff tab accepted it. The borrower status updated to Accepted. The admin then published version two with new instructions and a seven-day deadline. The original request retained its instructions, accepted status and version-one provenance. The editor fit a 390-pixel viewport without horizontal overflow. The updated public Demo and Product pages returned HTTP 200.

All 294 tests, lint, typecheck, the Cloudflare build and the working-day and recovery rehearsals passed. The built Worker checked assignment to a processor, denial for an unrelated officer and unassigned processor, exact borrower fields, repeat application, stale-version rejection and the manager queue. SQLite verified atomic rollback during batch insertion, Eastern date offsets, archive and restore, and that a template revision leaves active requests intact.

## Hosted separate joint borrower links

On Worker `0997183a-ff59-44b8-9724-75eb096cfca5` from source `80e85c9d2067`, a fresh fictional Guided Demo loan kept its primary borrower link and issued a different co-borrower link. The co-borrower saved at the review step and resumed at a 390-pixel viewport without horizontal overflow. Submitting the co-borrower first showed one of two portions on the staff file. The primary portal did not show the co-borrower’s name, and the staff review action appeared after the primary borrower also submitted.

Staff reviewed the combined application, then requested a co-borrower-only correction. The primary borrower saw the waiting status. The co-borrower saw the note. Staff revoked the co-borrower link and verified the old page was denied. A replacement opened the same correction while the primary URL stayed the same. Resubmission restored borrower status and showed version 2 as Submitted and version 1 as Reviewed. The executive demo workspace was reserved for the presenter. The updated public Demo and Product pages and the co-borrower portal returned HTTP 200.

All 296 tests, lint, typecheck, the Cloudflare build and both local rehearsals passed. The built Worker exercised primary-first submission, token substitution denial, one follow-up task, a reviewed MISMO export with both applicants, isolated corrections, and revocation and reset protection after snapshot recovery. SQLite also verified both submission orders and rollback if final version creation fails. The isolation test exposed shared in-memory defaults in the sample questionnaire builder. Fresh defaults now keep each person's sample answers independent.

## Hosted borrower-specific document requests

On Worker `06e46eac-5617-4c72-bc48-50f85e86c6ca` from source `438a061db04d`, staff added one bank-statement request per borrower on the fictional joint loan. Applying the purchase template to the co-borrower added the photo ID and skipped their existing statement. The two follow-up previews each showed the selected borrower’s instructions and link. The borrower portals showed their own items, and the co-borrower checklist fit a 390-pixel viewport without horizontal overflow.

Both participants verified their mock upload sessions. The co-borrower submitted a clean sample PDF while the primary request stayed Requested. Staff asked the co-borrower for a replacement. The primary portal kept its upload session and did not show the co-borrower note. Staff accepted the co-borrower replacement while the primary request stayed Received. File Exceptions opened the exact outstanding co-borrower photo ID. Both public marketing pages returned HTTP 200 with the updated copy.

All 298 tests, lint, typecheck, the Cloudflare build and both local rehearsals passed. The built Worker rejected cross-borrower request IDs and swapped sessions, then accepted each participant’s sample PDF. SQLite verified active primary upload sessions through migration, co-borrower reminder eligibility tied to the co-borrower link, and denial when a revoked link tried to finish an in-flight upload.

## Hosted paired mock underwriting

On Worker `90719be6-547e-417a-955b-1a9fdc1b159d` from source `7c820e2b1ea5`, a Guided Demo staff member authorized sample credit on a submitted fictional joint loan. Both mock services linked to revision 4 and the same credit reference. DU flagged an employment history gap and LPA simulated a timeout. Retrying LPA produced a new reference and findings. The DU result and reference stayed identical. The failed LPA attempt remained in history. The public Demo and Product pages both returned HTTP 200 with the paired workflow.

All 300 tests, lint, typecheck, the Cloudflare build, and the working-day and recovery rehearsals passed. The built Worker verified exact replay and independent retry. SQLite verified role checks, refusal to reuse credit after a corrected submission, and atomic rollback of both orders and activity if the second write fails.

## Hosted brokerage fee templates

On Worker `9e369cfb-01ac-4b6d-8106-b22af513b74a`, a Guided Demo admin published a fictional fee template and loaded it into a purchase quote. The staff worksheet preserved a zero-dollar credit report fee and flagged the remaining unknown categories. Staff changed the appraisal from $650 to $675 and published the sample quote. After the template moved to version 2 at $700, the final Worker `7b74ef07-518d-4acf-95e9-8d1ea4850fdd` from `99af4a8c1bcf` opened the template list directly from Team and reopened the exact version 1 quote with the $675 override and its original source. The public Demo and Product pages returned HTTP 200 with the updated copy.

All 301 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. The built Worker rejected unauthorized access and verified that the borrower quote retained its fee amounts without the staff-only source. SQLite reconciled a $9,145 cash-to-close fixture, filtered by purpose and ZIP, preserved explicit zero estimates, and checked stale edits and archived templates.

## Hosted manual lender package

Guided Demo staff reviewed the fictional joint application, accepted a freshly mock-scanned co-borrower PDF, and issued a one-hour package. In a separate browser, a wrong code revealed zero files. The issued code exposed two downloads, the reviewed MISMO 3.4 XML and the selected co-borrower PDF. The loan recorded one download per file. Revoking the link blocked a subsequent PDF request and kept both receipts. The executive workspace was reserved for the presenter.

On the first release, submitting a dummy code before initialization used the browser’s default GET form behavior. Final Worker `681a1188-04e0-4851-96a0-049e17c4abc2` from `87ccf0d99c94` uses a disabled server-rendered form and submits the code through the POST body. The wrong-code and issued-code checks both left the URL query empty. The public Demo and Product pages showed the feature, and the lender page returned a no-store response with no referrer.

All 302 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. The built Worker denied an unapproved package, verified second review, rejected an unaccepted file, matched the selected PDF byte-for-byte, and blocked the package after a 1003 correction. SQLite checked expiry at the boundary, live and unclassified PDF exclusion, object replacement, and reset retirement of the link hash.

## Hosted reviewed income worksheet

On final Worker `41466ef9-3e61-437d-a2bb-d3215f3e6b97` from `81decc378c74`, Guided Demo staff reopened a fictional joint 1003. The final browser form saved the June 1–30 source period after the first build dropped the selected dates. The co-borrower worksheet linked an accepted bank statement revision, recorded $5,140 in sample receipts and a $140 adjustment, and saved $5,000 monthly. Staff sent the worksheet for review and approved version 4 with a rationale. Pricing opened with $5,000 already entered, returned four mock options, and preserved the worksheet revision on the saved quote. Both public pages showed the feature.

All 304 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. The built Worker verified assigned processor preparation, LO approval, and withdrawal of the old borrower quote after a newer draft. SQLite reconciled the wage and documented-period calculations, blocked a missing source period and stale approval, and denied reuse of a quote after an evidence revision changed.

## Hosted lead document conversion

On Worker `0033172d-2583-4513-a405-61fff50ea9ff` from `fb5f00bee2af`, Guided Demo staff requested a pay stub from an assigned fictional website lead. A separate browser opened the one-hour lead checklist using its code. A blocked mock scan left the request open. A clean built-in PDF reached the lead, and staff accepted it before conversion. Duplicate review kept the fictional lead separate from the unrelated sample contact. Conversion opened the prefilled 1003, kept the exact PDF download and Accepted status on the loan checklist, and carried the original request and review events into loan activity. The old lead link denied the next refresh. The public Demo and Product pages both showed the update.

All 305 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. The built Worker verified byte equality on both sides of conversion, due-date and revision continuity, the accepted item in borrower status after submission, and directory retirement of the old link. SQLite verified that conversion rolls back while an upload lease is open and that the transferred object avoids cleanup.

## Hosted lead document tasks

On Worker `bab073cb-62cc-404f-8a9c-9784f40c7a5d` from `7b0a09a2bd1f`, My Tasks showed the assigned fictional lead's overdue pay stub. A separate borrower browser sent the clean sample PDF. The foreground staff page picked up the review item and removed its overdue entry without a manual refresh. Opening the review item expanded the lead checklist and focused that pay stub. After staff accepted it, the review item disappeared.

Staff left an overdue bank statement task open in one tab and converted the lead in another. The old lead task opened and focused the bank statement request on the converted loan. The public Demo and Product pages showed the new flow. All 305 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. The SQLite test also checked that unrelated staff could not see the request or resolve its location.

## Hosted lead document calendar

The fictional request and borrower link existed before Worker `b86e973e-77d8-434a-8c70-5b00af3cc837` from `f90e5ae2532a`. The admin opened the assigned officer's bank statement request from November 10 in the Brokerage calendar. Moving it to November 12 removed the original calendar entry. Refreshing the same borrower link showed the new date. Clearing the date removed the item from the agenda and left the bank statement request open for the borrower. The public Product and Demo pages showed the updated workflow.

All 305 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. SQLite verified permission boundaries, the same-date retry, stale-write rejection, upload continuity during a date change, and preservation of the deadline revision and history during conversion.

## Hosted lead document ownership recovery

On Worker `6486b48f-51a2-4b30-9d67-131bd4734203` from `72f8b0c8cbce`, the Guided Demo admin opened Playbooks → Ownership and deadlines → Lead documents. A fictional campaign lead in the shared inbox showed one borrower upload outstanding, one received upload ready for review, and the November 8 deadline. Open lead took the admin to the current ownership field in Lead Inbox. Assign lead cleared the exception and the receiving owner's Today showed both the received pay stub and the overdue bank statement. The same borrower link still showed the received status and original due date. The public Product and Demo pages showed the reassignment flow.

All 305 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. SQLite also covered an unavailable owner, source and campaign filters, the admin permission check, a held lead, a stale assignment, and an idempotent retry with one recovery audit event.

## Timed executive rehearsal and callback note

The [full hosted run](executive-rehearsal.md#november-9-full-rehearsal) took 3:32 from creating the fictional pilot to opening the rate-watch refinance. It ended with all seven guide steps ready. On Worker `91061111-89bd-4316-b458-89fdf6d68d36`, reopening the original callback in the same pilot showed the saved check-in note and unchanged Eastern deadline. The public Product and Demo pages reflected the update.

## Processing handoff instructions

On Worker `91061111-89bd-4316-b458-89fdf6d68d36`, the hosted fictional file appeared in the receiving tab's Processing queue with its send note and focused the exact handoff. Accepting with a blank note removed the instructions from the workbench, although Activity still held the original note.

On Worker `53c57dda-bad8-4196-9b04-6fee4e84ec51` from `166295da4520`, reopening the already-accepted file showed the original instructions under Recent handoff history. Returning the file surfaced the exact new note in Today without a manual refresh. The button focused the handoff, and completing it with a blank note removed the queue item while keeping both notes visible on the loan. Both public pages reflected the update. The hosted tabs shared one admin identity.

The built Worker used separate LO and processor sessions. It verified scoped acceptance and completion responses, the original send and return notes, both mock condition clearances, and no disclosure of the return note to the borrower or realtor. The two handoff writes each took 7 ms, with the first recipient queue reads at 3 ms and 7 ms on loopback. All 305 tests, lint, typecheck, the Cloudflare build, and both local rehearsals passed.

## Reopened mock condition at closing

In the fictional hosted handoff file, the admin reopened a cleared income condition after completing the returned handoff. On Worker `af192fca-2a1f-474f-a7a0-d0b9b7976f3e`, a second tab still showed the ready form. The server rejected both its Clear to Close and first Record closing actions. The refreshed closing workbench named the reopened condition and its link focused the exact income request.

On final Worker `46c06d18-c309-4cb3-8859-9992e549c52c` from `c669beadb478`, the **Reopened** alert in Tasks distinguished the event from the original income alert and focused the same request. The stage picker disabled closing stages and Record closing was disabled while the condition was open. The borrower uploaded a replacement sample and staff cleared it, then marked Clear to Close and recorded closing. A second reopening left the actual closing date recorded and blocked first funding. After the replacement bank statement cleared, the fictional file funded. Both public pages reflected the safeguard.

All 305 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. The authenticated Worker checked the stage-move bypasses, first closing and funding writes, the exact lender alert, and recovery through the replacement and clearance. The hosted run used one admin identity and a separate borrower browser.
