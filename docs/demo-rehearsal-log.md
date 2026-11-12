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

## Closing holds in borrower and realtor views

On Worker `4f0c2c2d-8871-4055-91fa-69f447318010` from `99d5f87ffea1`, the admin used a fresh fictional pilot with both portals at Clear to Close. Staff copied the original realtor email draft, left its text preview open in another tab, and reopened the income condition. Both portals showed Closing on hold after refresh. The realtor row showed the neutral status and update time without the evidence request. The already-open preview refused the copy and identified the draft as out of date.

Clearing the replacement restored Clear to Close in both portals. Activity kept the old copied draft in superseded history and showed fresh borrower and realtor drafts. The new realtor draft accepted a copy. After staff recorded closing and reopened a bank statement, both portals showed Funding on hold and the closing-complete draft stayed available. Both portals showed Funded after the second replacement cleared and funding was recorded. The public Demo and Product pages reflected the workflow.

All 305 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. The focused SQLite case also verified older unretired drafts are superseded on upgrade, the earlier copy receipt is retained, and a replay does not regenerate an already-restored draft.

## Replacing a manual lender package after a 1003 correction

On Worker `5ea9f3db-f895-46db-959d-62a35fe13e78` from `7424518c8f3e`, a fictional lender downloaded the original reviewed MISMO package. Staff acknowledged it, then recorded a lender return. The lender's already-open download button denied access as soon as staff reopened the application. The borrower used the original borrower link to correct and resubmit the 1003.

After review, **Replace lender link** prefilled the recipient and issued a new link and code. The old link remained unavailable and the old code did not unlock the replacement. Both downloaded files parsed as MISMO XML. Revision 1 contained a $360,000 requested loan and revision 5 contained $349,500. The loan displayed one download on each revision and reused the original lender reference for acknowledgment. This hosted run used an XML-only package and a separate fictional pilot. The public Demo and Product pages reflected the change.

All 305 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. The working-day rehearsal matched each package download byte for byte with its corresponding reviewed export, retained the old download receipt, denied a previous owner, and checked that retrying the replacement returned the same receipt. The focused SQLite test checked that a current link could not be replaced and that failed link protection left the staff record unchanged.

## Versioned XML and PDF in the corrected lender package

On Worker `4ea64189-425d-4421-8a3a-9f143e31843f` from `1427962c999aa`, the fictional lender downloaded a reviewed MISMO XML and one accepted pay stub. Requesting a replacement pay stub immediately blocked the already-open PDF download before the 1003 changed. The borrower submitted a replacement through the mock scan and corrected the 1003 through the original borrower link. Staff reviewed both revisions, issued the replacement package and confirmed that the old link still failed.

The original and replacement filenames matched the 1003 revision and package reference shown in staff history and the lender portal. The original XML held $349,500 and the new XML held $349,000. The downloaded PDFs matched the clean and replacement mock fixtures byte for byte. Staff history showed one XML and one PDF download on each package. Staff acknowledged the revised package under the original lender reference, recorded delivery for the updated document revision, and cleared the original condition. This used a separate fictional pilot. Both public pages reflected the update.

The guided loan entry showed the simulated campaign acknowledgment and hid the return action for the already-linked manual lender file. Staff reopened the same loan from Pipeline to record the return. All 305 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. The built Worker matched manifest filenames to download headers and the SQLite test rejected a stale evidence revision when replacing a package.

## Lender return and re-acknowledgment from the Demo Guide

On Worker `116f6285-10c2-4dbd-8013-3d08cf2950bd` from `d73de6050b25`, staff used the native simulated acknowledgment in a fresh fictional campaign pilot. The guide opened the fictional lender checklist, where staff added one income condition. **Open lender acknowledgment** then opened the return action directly. Recording the return blocked the original downloaded package and showed Returned for changes in the guide. The borrower used the same link to correct the loan from $360,000 to $358,500.

Staff reviewed the correction through **Open campaign 1003** and issued the replacement link through **Open revised MISMO handoff**. The downloaded replacement XML contained $358,500, and the original link remained blocked. Recording receipt reused the original lender reference and reopened the checklist with its one original condition. A separate previously acknowledged manual file also exposed the return action from the guide. The live retest used the XML-only package and no real lender.

All 305 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. SQLite verified that an older simulated acknowledgment with a missing checklist ID was repaired on initialization, remained idempotent, and supported a return and re-acknowledgment on that same checklist. The live Demo and Product pages reflected the update.

## Required second review for manual lender handoff

On Worker `af48db39-13ff-463c-9f0e-91dab152a5b7` from `2280b5efa8c9`, the isolated fictional pilot required a second review after a lender return. The borrower submitted the $358,000 correction. Staff completed the first review and saved a fresh mock quote. Both the Demo Guide and pricing opened Team Reviews on that loan, which showed that the current revision needed an eligible reviewer. The XML could be prepared for review, but the manual export panel did not offer a replacement link and the acknowledgment button stayed disabled. The hosted pilot had one staff identity, so the distinct reviewer approval was verified in the local Worker.

The local Worker denied initial and corrected sharing and acknowledgment until a separate admin approved each exact revision. It also denied a manual delivery entry before approval and retained the original lender checklist through re-acknowledgment. The SQLite rehearsal rejected a simulated acknowledgment despite a current quote and prepared XML, and accepted an exact replay of an acknowledgment already recorded before the policy was enabled. All 305 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. Both public pages reflected the policy.

## Already acknowledged revisions and the approval queue

In a separate fictional pilot, staff enabled required second review after the manual lender acknowledged revision 9 and cleared its condition. On the prior release, both Pipeline and the manager's Required 1003 approvals filter incorrectly asked for a reviewer. On Worker `a79c82b8-7064-4e99-94d5-5e9b858190bd` from `1ae1364608fc`, the queue became empty and Pipeline opened closing readiness. Orbit accepted Mark Clear to Close on the acknowledged revision.

Staff then recorded a lender return on the same file. It moved back to Underwriting. The borrower corrected the requested amount to $348,500, and after first review Pipeline requested a second review. The manager queue identified revision 13 and opened Team Reviews for that loan. The pilot used one staff identity and left that revision awaiting a second reviewer. Both public pages reflected the revision rule.

All 306 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. SQLite verified that the loan record, Pipeline and stalled-file work agreed, a current receipt suppressed the obsolete assignment prompt, and pending processor send or acceptance still required approval. The live Pipeline still showed its stored $360,000 loan amount alongside the different corrected request in the 1003.

## Recorded loan amount and the corrected 1003 request

On Worker `c9ffcd3a-b286-4cd6-a12c-d0277c494927` from `35e2bfd45767`, the isolated fictional pilot showed a $360,000 recorded amount and a $348,500 1003 request in Pipeline. The request opened the exact comparison on the loan. Pricing explained both sources while showing its separate $347,500 saved mock quote.

Staff used the reviewed 1003 amount. Pipeline and the loan record showed $348,500 without a manual refresh, and the audit recorded one change from $360,000 to $348,500. The same $347,500 saved quote and pricing timestamp remained in pricing. The correction was still awaiting its second reviewer for lender handoff. The public Demo and Product pages reflected the reconciliation.

All 306 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. The built Worker rejected an unreviewed or stale revision, a stale recorded amount, a former owner, and a post-closing edit. It also checked that a replay did not duplicate the audit, the second tab received the update, and the exact cents stayed in the reviewed application and MISMO when the recorded amount used whole dollars.

## Match the saved quote before mock UWM handoff

In a new fictional campaign pilot, staff saved a $355,000 mock quote on a reviewed $360,000 1003. The previous release showed a mock send action. On Worker `465e2cc5-c16f-4d5f-be38-088ec4f66fe9` from `83459df564ca`, the guide and 1003 panel opened pricing to review the two amounts. **Use 1003 amount in pricing** loaded $360,000. Send became available after staff priced and saved the matching quote. The handoff produced a mock receipt for revision 1 and opened the lender checklist with two conditions. Both public pages reflected the change.

The built Worker blocked a mismatched quote from both the quote-linked and direct submission commands before writing a receipt. SQLite also checked a one-cent difference, successfully sent the matching revision, and preserved the earlier receipt when a later quote selection differed. All 306 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed.

## Match the 1003 amount before a mock rate float or lock

In the isolated campaign pilot, the previous release let staff float the $355,000 alternative on a mock UWM file with a $360,000 1003. On Worker `1daa03de-c922-4ced-a49d-e4733cd64287` from `8a55b1a92647`, the pending float showed both amounts and the lock action was unavailable. Choosing the $360,000 quote allowed a new float and a 30-day mock lock.

Staff selected the $355,000 alternative again, extended the same lock by seven days, and cancelled it using the original confirmation. The rate panel showed the cancellation and again required a matching quote for a new float. Both public pages reflected the change. All 306 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. SQLite rejected both a new mismatched float and a first lock on an existing mismatched float, including a one-cent difference, and verified management of an existing lock after the application was reopened.

## Require the current mock UWM receipt before a new rate action

In the fictional campaign pilot, the borrower corrected the $360,000 request to $357,500. The previous release floated the matching quote and offered a lock while the linked mock UWM file still showed revision 1. On Worker `2151a208-d01c-4c34-92fd-a86891caeb50` from `ad9e0845ae0a`, the existing float was visible but the lock action was unavailable until revision 5 reached the linked file.

**Open 1003 handoff** focused the original file. Staff resent revision 5, verified the same lender reference and a new revision receipt, and returned to pricing. The pending matching float could now lock for 30 days. Both public pages reflected the revision requirement. All 306 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. SQLite also denied a new float and a first lock before the revised receipt, rejected a different synced file, and exercised the imported mock-file path without an Orbit application link.

## Keep confirmed mock rate terms visible after repricing

On Worker `328f038d-c81a-4b03-9497-e6d375fd78f5` from `ec48f142e1a4`, the fictional pilot showed the existing $357,500 lock for 1003 revision 5 beside a new $354,500 saved quote in both loan details and pricing. Cancellation preserved the prior lock terms in the rate panel. Staff sent revision 9 to the existing mock UWM file, floated the $354,500 quote, and confirmed a new 30-day mock lock. Activity showed the same confirmation reference, amount, and revision as the pricing panel.

All 306 tests, lint, typecheck, the Cloudflare build, and both local Worker rehearsals passed. Both public pages returned 200 and described the change. Local tests checked that the terms survived lock retry, extension, and cancellation, and that an imported mock file displayed its quote amount without an Orbit 1003 revision. Activity entries written before this release still show their original text.

## Fresh hosted campaign through funding and repeat business

On Worker `38570c2c-dae1-414d-8633-f6a426793068` from `5eeab7c4bd9c`, a fresh fictional brokerage imported two CSV leads. One routed to the available officer and the other moved from Shared queue after conversion. **Next call** opened Jordan. Staff logged Connected and recorded a mock text. The borrower saved, reopened, and submitted the sample 1003 with ZIP 48304. Loan Activity showed the original call and simulated text. A matching $360,000 mock quote accompanied 1003 revision 2 to UWM.

Two clean sample PDFs went from borrower upload through staff acceptance, mock delivery, and clearance. The realtor saw Clear to Close, closing and funding were recorded separately, and the post-funding callback showed its original note in Tasks. The guide reached **7 / 7 ready**. Casey’s 6.000% sample observation reached the 6.125% target and opened a separate refinance with the confirmed property. Funding took 4:27 and the rate-watch refinance opened at 6:01 from **Create guided pilot**, using an existing staff session and without narration. The browser download completed and its file matched the local fictional fixture used on the first pass.

The post-funding refinance path offered contact prefill but omitted property confirmation. On Worker `ac0d778e-73a7-4400-958f-bfb1a0cf72ba` from `054e59d79546`, a second fictional purchase was imported using the downloaded CSV, submitted, priced, cleared, and funded. This pass used **Refresh status** to bring the two requested documents into the separate borrower view. After deployment, staff saved a funding check-in, chose Refinance, and confirmed the source property. The separate borrower 1003 showed 400 Demo Way, Bloomfield Hills, MI 48304 in its individual fields. The Purchase choice did not offer property reuse. All 309 tests, lint, typecheck, the production build, and both local Worker rehearsals passed. Both public pages returned 200 with the updated copy.

## Document handoff between separate browser sessions

On Worker `05a3183c-da3a-4341-ab68-2e7bef2493d4` from `9ecdbc4eaacc`, staff used a signed-in Chrome tab and the borrower used a separate in-app browser session on the same fictional refinance. Both pages reported visible. A bank statement request appeared for the borrower in 5.1 seconds. The sample upload appeared for staff in 4.2 seconds. Staff requested a replacement, and the borrower saw its instructions and submitted the replacement using the existing verification. The replacement reached staff in 2.9 seconds and acceptance reached the borrower in 3.6 seconds. No manual refresh was used between these changes. The borrower’s PDF choice on the unrelated pay stub stayed selected.

These are individual click-to-observation times. One request on the previous release appeared in 3.2 seconds, depending on where it landed in the existing 15-second interval. The new foreground checks run every five seconds for mock handoffs and remain paused when hidden. The targeted test verifies the mock and regular intervals, immediate return, and rejection of stale responses. All 310 tests, lint, typecheck, the production build, and both local Worker rehearsals passed. Both public pages returned 200 with the updated copy.

## First click after loading the hosted guide

Earlier hosted rehearsals sometimes required a second click while the browser was still attaching click handlers. Worker `570dc64d-d797-4441-944d-6131a3daa53f` from `6e98d40897ba` shows a loading message in the guide and enables its actions and workspace navigation when those handlers are ready. The local Worker rehearsal verified the disabled controls in the initial signed-in HTML.

In a separate hosted fictional pilot, the first click after reload opened the submitted repeat refinance 1003. A separate reload verified the first click into Call Campaigns. Opening Demo Guide from Pipeline also loaded the walkthrough. All 310 tests, lint, typecheck, the production build, and both local Worker rehearsals passed. The public Product and Demo pages returned 200 with the updated walkthrough copy.

## Open staff handoff and manager exceptions

The previous hosted release left the loan drawer on Ready for processing after acceptance in another tab. It also kept the Unassigned exception after a processor was assigned. On Worker `4e1f27f8-bae5-4d74-b6ce-47e66dbb3834` from `ef6b877be9ba`, two open tabs on the fictional Quinn loan showed the return status and its private note without a reload. The original drawer showed the return 1.1 seconds after the return click in that observation. The open manager Unassigned view gained and then cleared Quinn's exception as another tab removed and restored the processor.

The assigned processor signed in separately in Chrome, opened Quinn from Processing, accepted the file with its original instructions, and returned it with an internal note. The owner signed back in, opened Quinn from Today, and completed the handoff. Today cleared the return. The hosted sign-ins were sequential. The built Worker used independent owner, invited LO, processor, and unrelated-officer sessions. It checked the original LO's exact file after acceptance and return, processed two mock conditions, and verified the private note was absent from both portals.

The open handoff checks the scoped revision while visible and retains unsaved edits. The manager queue refreshes when staff return to its first page. Unassigned and Stalled handoffs also refresh while visible. Manually loaded extra rows stay in place until explicit refresh. SQLite tests verify that Stalled handoffs excludes a file awaiting required second approval and still includes a return to the LO. All 310 tests, lint, typecheck, the production build, and both local Worker rehearsals passed. Both public pages returned 200 with the updated copy.

## Shared campaign claim and callback to the 1003

Two fictional CSV rows entered the same shared campaign in OrbitLOS Role Handoff QA. On the previous hosted release the assigned LO won the first claim. The admin's stale tab correctly received an ownership error but kept the claim button and old shared count. On Worker `c56a24f8-2cdc-4ddb-a076-383541ed2fbd` from `ecb0938bb658`, the invited LO claimed the second lead with its first-contact deadline intact. The admin attempted the same claim from the still-open tab. The ownership message stayed visible, the unavailable claim disappeared, and Shared queue stayed selected with the corrected count.

The invited LO logged Requested callback from Ready to call and saw Start 1003 on the resulting card. The draft showed the fictional borrower's name and subject property ZIP. My campaign callbacks showed Nov 12 at 11:20 a.m. Eastern before and after conversion. Its action changed from Open callback to Open loan callback and focused the task on the new loan. Hosted sign-ins were sequential. Two independent invited LO sessions raced the exact same claim in the built Worker. The winning LO retained the callback task ID, deadline, and loan ownership. The losing LO's refreshed campaign, inbox, and callback reads excluded the assigned work, and the loan read was denied.

All 310 tests, lint, typecheck, the production build, and both local Worker rehearsals passed. The public Product and Demo pages returned 200 with the updated copy.

## Open a callback from before 1003 conversion

On the previous hosted release, the invited LO opened Upcoming before converting a fictional lead in a second tab. The original Open callback button returned a stale queue error after conversion. On Worker `2334cebd-d07c-44f1-a115-ccc48659efc8` from `0da37a09e615`, the LO opened both Upcoming and the lead's conversation before conversion. After conversion, the original Open callback and Open promised callback actions each opened the exact loan task, focused it, and showed the unchanged Nov 16 at 10:35 a.m. Eastern deadline. Neither tab was reloaded between conversion and opening the task.

Start 1003 created the loan in the conversion tab, but that tab returned to Today during this rehearsal. Reopening the campaign confirmed the converted card. The conversation initially also returned to Today after creation and opened successfully from its lead card on the next visit. These navigation observations are separate from the successful old-link checks.

The scoped read matches the original lead, task, current scheduled time, and current loan owner. The Worker verified the same callback ID before and after conversion and denied other staff. SQLite checks rejected a different task or deadline, another brokerage, a prior owner, an inactive loan, an opted-out lead, and a completed or recorded task. All 310 tests, lint, typecheck, the production build, and both local Worker rehearsals passed. The public Product and Demo pages returned 200 with the updated copy.

## Open the saved draft directly from a campaign

Worker `b60313a7-cda5-4f85-ba07-889bcbe33576` from `93492140f8bf` uses an authenticated JSON request for staff lead conversion. The response includes the exact loan and the affected campaign. The built Worker received that response with a simulated previous-client compatibility header. It verified sign-in, brokerage, ownership, role and origin restrictions, the open-slot refill, and a retry that returned the same loan and borrower link.

On the live release, the invited LO opened Finley's draft from a scheduled callback and Emery's draft from a connected call. Both stayed in Call Campaigns. Finley's callback stayed due Nov 17 at 11:15 a.m. Eastern. Finley's campaign card retained Start 1003 until a retry opened the same borrower link and advanced the card. Emery's card advanced on the first conversion. A tab opened before deployment also converted Cedar and opened the draft. The earlier return to Today did not recur in these samples, and its original cause remains unconfirmed.

All 310 tests, lint, typecheck, the production build, and both local Worker rehearsals passed. The public Product and Demo pages returned 200 with the updated copy.

## First-save campaign cards and the filtered call queue

The previous release advanced Kit's card on the first conversion in Enrolled. Finley's intermittent stale card did not recur in that baseline run. Worker `4af2525c-7898-4983-84e0-774b6401ed7f` from `e2d9f67af777` links the exact lead to its loan from the conversion receipt. The client applies that link even if the broader campaign snapshot is missing. A separate Just converted card shows the file in the current filtered view when the normal list excludes it.

The invited LO converted Ari from Upcoming callbacks. The first click opened the draft, and closing it showed one 1003 started card with Open loan while Upcoming callbacks stayed selected. Open loan reopened the same borrower link. The callback stayed due Nov 19 at 10:45 a.m. Eastern. The next shared lead, Sam, took the available slot with the original first-contact deadline. The LO recorded Connected for Sam and converted from Enrolled. The first click opened the draft and advanced the only Sam card.

The built Worker checked the connected and scheduled first responses, the exact card from a workspace with no cached loans, and the same result with the campaign snapshot omitted. All 310 tests, lint, typecheck, the production build, and both local Worker rehearsals passed. Both public pages returned 200 with the updated copy.

## First-click conversation opening and replay

The prior hosted release opened Noel's conversation on the first click. The earlier return to Today did not recur in that baseline, and its cause remains unconfirmed. Worker `4e4e7b58-d629-4229-b712-b37531e9081c` from `c48eb03d523a` returns the authorized thread, first history page and filtered queue after Start conversation. The workspace uses those results to display the thread without waiting for a second detail request.

Two hosted tabs loaded Drew's unstarted conversation. The invited LO started it from the Active view, then used the still-visible Start conversation button in the other tab. Both stayed in Communications and showed the call note and Nov 20 at 10:25 a.m. Eastern callback. Active showed one row. The second tab retained Closed and its list omitted the open thread. After the LO saved a staff note and converted the lead, the second tab refreshed to the linked loan and retained the call note, staff note and callback.

Two concurrent starts in the built Worker returned the same thread ID and one list row. A replay after conversion returned the same ID with the current loan and original history. The unauthenticated request, another officer, and the processor on the open lead were denied. All 310 tests, lint, typecheck, the production build, and both local Worker rehearsals passed. Both public pages returned 200 with the updated copy.

## Start the first conversation after another tab converts the lead

On the previous hosted release, Lee's original Start conversation prompt showed an unavailable error after the invited LO converted the lead in another tab. The LO then created an ordinary borrower thread from the loan and saved a fictional staff note. On Worker `5487c7cc-1406-4750-ab9b-aa71bee90361` from `0e41f5d5a25e`, the original prompt reopened that existing thread with the note and Lee's original campaign call. The Active queue showed one row.

The invited LO left Rae's first-conversation prompt open and converted the lead in another tab. The first click on the original prompt opened the borrower conversation on the loan. It showed Rae's original call and one conversation row. Open promised callback focused the carried loan task at Nov 23, 11:20 a.m. Eastern.

The built Worker raced two starts after conversion and verified one thread ID, the exact borrower and callback, the original call history, and denial for another officer. SQLite covered a reassigned owner, conflicting source links, an existing thread with a note, an inactive loan, a revoked application link, and a legacy file missing its application. First source attachment uses the current loan's 1003 and borrower. Existing carried threads retain their role-scoped access. All 311 tests, lint, typecheck, the production build, and both local Worker rehearsals passed. Both public pages returned 200 with the updated copy.

## Fresh hosted executive walkthrough and draft property status

On Worker `5487c7cc-1406-4750-ab9b-aa71bee90361`, a fresh fictional pilot completed all seven campaign guide steps and opened Casey's rate-watch refinance in 3:58. From Create guided pilot, CSV import completed at 0:33, Jordan converted at 0:55, staff reviewed the submitted 1003 at 1:17, mock UWM received the file at 1:47, both conditions cleared at 2:30, and funding was recorded at 2:51. Timing includes browser actions, observations, and control retries. It excludes Google sign-in and spoken narration. One signed-in admin acted as the officer. Borrower and realtor views ran separately. Two built-in clean PDFs passed mock scanning, and the realtor saw Clear to Close. No external message was sent.

Jordan's post-funding callback showed its owner, note, and due time. Both Jordan's repeat 1003 and Casey's refinance opened with borrower links distinct from the original purchase. Casey's observed sample rate of 6.000% met the 6.125% target. The prefilled street and locality were present in the borrower view, but the loan summary said Address pending. The change exposes only whether the draft has a property street. Staff can see the draft status while the address value and other unsubmitted answers remain in the borrower view.

On Worker `ce5e5ffc-4746-4f9d-8b4c-35ebb8ac4522` from `d659ea285d55`, a new Casey refinance showed Address entered in 1003 draft immediately and after a fresh page load. The separate borrower view showed the saved street, city, and ZIP. After submission the staff record showed the actual address and Needs review. The earlier Casey rehearsal draft still used the general Awaiting 1003 submission status after refresh, with the original address present in the borrower view. All 311 tests, lint, typecheck, the Worker build, and both local rehearsals passed. The public Demo and Product pages included the rehearsal and draft workflow updates.

## Separate processor recovery after a mock UWM reopening

On Worker `ce5e5ffc-4746-4f9d-8b4c-35ebb8ac4522`, the fictional Morgan Handoff Reopen Example was originated by the brokerage admin in Presenter Final F. A different signed-in Processor accepted it, requested the two documents, accepted the sample PDFs, cleared both conditions, and returned it with a private note. The originator opened that return from Today, completed it, and marked Clear to Close. The staff sessions were sequential. Borrower and realtor views ran separately.

Mock UWM reopened Income while another staff tab still had a closing date entered. The server rejected the first closing, but the tab still showed zero outstanding conditions. The borrower saw the pay-stub replacement request and Closing on hold. The realtor saw the neutral hold. The originator handed the file back to the processor. The processor accepted the replacement and cleared the exact condition, then returned the file. The originator recorded closing and funding, and the realtor showed Funded. Neither portal exposed the internal instructions or return notes.

### Hosted read budget

During the follow-up check, Cloudflare returned `Exceeded allowed rows read in Durable Objects free tier`. Previously working releases produced the same staff sign-in error after rollback. The public pages and login page still responded. Rehearsal tabs were closed and local measurements continued while the daily allowance reset. See [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

The instrumented local Worker read 110,934 SQLite rows across the scripted working day, including 15,557 directory rows. In that fixture a full workspace read used 1,894 rows and an incoming Today check used 62. These are local measurements, and the incident logs identify the account limit without attributing its consumption to individual endpoints.

On a separate 5,000-contact local Durable Objects fixture, the outreach opt-out alias query dropped from 120,003 to 21 row reads and returned the same six keys. Today and Processing use the existing Received-document index for sparse backlogs, with a bounded probe and the existing owner-first path for larger backlogs. The 10,000-loan plan comparison and paging test preserved staff scope. The first minute of visible polling keeps the existing cadence, then checks once a minute while idle. Tab-return checks and manual refresh are available. No paid resources were added.

### Tuesday executive demo check after hosting recovery

On November 9, 2026, Cloudflare confirmed Workers Paid and a fresh QA Google sign-in opened the staff workspace. On Worker `aae0f7a6-b93b-407a-bd46-ff615d3158b0` from `722a7ae0a09c`, a fresh fictional brokerage reached 7 / 7 and opened Casey's rate-watch refinance in 3:40. Timing includes browser actions, observations, and automation retries. Sign-in and narration were outside the stopwatch. One QA admin acted as the officer, with separate borrower and realtor views. The actual fictional CSV routed Jordan to the available officer and left Casey in the shared queue. The run verified simulated outreach, reviewed 1003, mock credit and pricing, mock UWM receipt, two mock-scanned PDFs, zero outstanding conditions, realtor draft and Funded milestone, post-funding callback, and three distinct links for the purchase and two refinance drafts.

In a separate existing fictional file, stale closing and funding forms both refreshed after rejection, named the exact reopened condition, and retained the date entered. Open reopened condition focused Income. The funding hold preserved the recorded closing date, and the borrower saw the replacement bank statement request. The file funded with zero outstanding conditions after the replacement cleared. The executive workspace was reserved for the presenter. The work-account sign-in remains for the presenter to verify on their own device and network.

## Configurable CSV campaign follow-up sequences

On November 9, 2026, Worker `8579817c-e5da-41b8-b2bd-13d889ace1fb` from `6089c1d8e979` was verified in the fictional Role Handoff QA brokerage. An admin attached version 1 with Call, Text, and Email and set zero delays for the rehearsal. A four-row CSV created four leads and routed all four to the invited LO, who saw their first steps in Today.

The LO recorded a call and mock text, then logged an incoming reply from Communications. The pending email disappeared from Today. Simulate sample reply is a preview. Log reply records an inbound activity and stops the sequence. Starting the 1003 for a second lead and recording an opt-out for a third removed their remaining steps. The fourth lead completed all three steps. Both mock messages appeared in the lead's conversation as Simulated.

SQLite coverage verified admin permissions, version pinning, weekday scheduling, duplicate import handling, stale actions, and all three stop conditions. All 313 tests, lint, typecheck, the production build, and both local Worker rehearsals passed. The public Demo and Product pages returned 200 with the updated copy.

## Campaign manager outcome drilldowns

On November 9, 2026, Worker `77029422-0206-42a4-b996-98c2cd4de0e5` from `45f0c54c5064` was verified in the fictional Role Handoff QA brokerage. One new CSV lead produced an overdue New Lead call. The selected campaign showed one overdue lead, one logged reply, one conversion, and one opt-out. Each count opened its expected record, including the converted lead's loan drawer. A second campaign showed its own totals. The invited LO could still open Call Campaigns while the report remained available to the pilot admin.

The first hosted import exposed a duplicate panel caused by a shared React key. The corrected release showed one report after refreshing the campaign queue. SQLite tests covered access, shared and held leads, tied deadlines, multiple overdue items on one lead, opt-out aliases, and paging. All 315 tests, lint, typecheck, and the production Worker build passed. The local working-day and write-concurrency rehearsals passed. The public Demo and Product pages returned 200 with the updated copy.

## Individual campaign sequence pause and resume

On November 9, 2026, Worker `d79811b2-d72c-493b-8dc7-91177cb4e2ad` from `1f08aeac7afc` was verified in the fictional Role Handoff QA brokerage. A pilot admin paused Aster at step 2 after the first call. The row left Overdue follow-ups and appeared under Paused sequences with its scheduled time. In a separate sign-in the assigned LO saw the paused status on the campaign card, had no resume control, and had no sequence action in Today. The admin resumed it and the stored deadline matched exactly. The LO recorded the resumed text as a mock and saw step 3, Email, appear in Today. The admin sign-in was restored.

The original deadline remains on the enrollment during a pause. SQLite coverage verified that duplicate first-call reminders stay hidden, stale actions are rejected while paused, separate callbacks stay visible, and a logged reply, conversion, opt-out, or archive ends a paused sequence. All 315 tests, lint, typecheck, the production Worker build, and both local Worker rehearsals passed. The public Demo and Product pages returned 200 with the updated copy.

## Campaign sequence performance by step

On November 9, 2026, Worker `b397e7ec-f9ef-410c-925c-71b2a0923bd7` from `237e21c3bd0c` was verified in the fictional Role Handoff QA brokerage. Version 1 showed an overdue first call for Linden, and the Stalled count opened that lead. The invited LO recorded Aster's step 3 mock email and logged a fictional incoming reply. The admin report credited one touch and one reply to step 3, and both drilldowns listed Aster. The reply count opened Aster's lead record. Fern's older logged reply remained in the separate unattributed list. The drilldown received focus after the count was selected.

SQLite coverage verified version isolation, paginated lead lists, role and brokerage scope, paused and held exclusions, missing-recipient skips, sample reply previews, and attribution to the last tracked touch at or before the reply. All 316 tests, lint, typecheck, the production Worker build, and the local working-day and write-concurrency rehearsals passed. The public Demo and Product pages returned 200 with the updated copy.

## Reusable reactivation and past-client sequences

On November 9, 2026, Worker `15e50e17-6812-4b5c-88a7-ab8959b7f7f1` from `675c480dbe77` was verified in the fictional Role Handoff QA brokerage. The existing New Lead v1 attachment survived the hosted upgrade. A pilot admin attached Cold Lead Reactivation v2 and imported one fictional CSV lead. A separate campaign used Past Client Outreach v3. A saved Past clients segment previewed four fictional funded borrowers and routed all four to the invited LO when enrolled. The LO saw both first-step types in Today, recorded a mock reactivation email, and logged a fictional past-client call. Today’s seven-day view showed the next scheduled call and email. The admin session was restored.

The first hosted campaign switch exposed duplicate Routing panels when Import was also open. The corrected release showed one panel of each kind after switching. SQLite coverage verified per-family version reuse, version pinning, stale enrollment previews, quiet leads retaining their owner, past-client opt-out exclusion, CSV enrollment, routing, and Today step progression. All 317 tests, lint, typecheck, the production Worker build, and the local working-day and write-concurrency rehearsals passed. The public Demo and Product pages returned 200 with the updated copy.

## Selected-only CRM segment enrollment

On November 9, 2026, Worker `42b9f6fe-4819-4903-903c-e9a3f979fbb0` from `3e5ce0fe0b63` was verified in the fictional Role Handoff QA brokerage. The saved Quiet leads segment showed two eligible leads and no selections. An admin selected both through the page control, cleared the selection, then checked Wren only. The enrollment receipt showed one created campaign membership and one routed lead. Wren appeared in the campaign and in the assigned LO's Today queue with a mock email preview. Lark stayed out of the campaign and remained eligible in a fresh preview. The QA admin session was restored.

SQLite coverage verified selections across two preview pages, selected-only past-client enrollment, invalid and duplicate IDs, ineligible borrowers, stale and replayed requests, and admin authorization. All 318 tests, lint, typecheck, the production Worker build, and the local working-day and write-concurrency rehearsals passed. The public Demo and Product pages returned 200 with the updated copy.

## Borrower contact preferences

On November 9, 2026, the fictional Role Handoff QA admin blocked email and text for Wren in Lead Inbox. Cold Lead Reactivation recorded the skipped email in lead activity. The admin blocked calls for Casey in Contact History, and the linked Past Client Outreach sequence skipped its call. The invited LO's seven-day Today queue showed Wren's next call and Casey's next mock email. The QA admin session was restored. The final Worker `2248971b-aaf0-4633-bbba-0aeebb7456c3` from `fb2ab31a6024` kept the saved preferences and activity after reload and displayed each checkbox beside its label.

SQLite coverage verified channel skips, no touches for skipped steps, stale mock rejection, ownership, pause and resume, and carrying restrictions through 1003 conversion. All 319 tests, lint, typecheck, the production Worker build, and the local working-day and write-concurrency rehearsals passed. The public Demo and Product pages returned 200 with the updated copy. Email and texting remained mocked.

## Borrower portal contact preferences

On November 9, 2026, Worker `838be709-d6f7-4393-9885-67bd60962b19` from `7180b62` was verified in the fictional Role Handoff QA brokerage. Casey opened a returning-client 1003 and used the borrower portal to allow calls and block email. The choices survived 1003 submission and a fresh portal load. Contact History and the originating loan's Activity each showed the changed channels and the Eastern timestamp. The linked Past Client Outreach sequence logged the skipped email. The invited LO saw no Casey email in Today, and the campaign row showed the next mock text scheduled for November 16 at 9 AM ET, beyond Today's displayed November 15 cutoff. The QA admin session was restored.

Local browser QA saved choices before and after submission. Automated coverage verified link expiry and revocation, same-origin requests, record isolation, stale saves, retry behavior, the brokerage-wide opt-out, and no outreach touch for a skipped step. All 320 tests, lint, typecheck, the production Worker build, and both local workspace rehearsals passed. The public Demo and Product pages returned 200 with the new copy. Email and texting remained mocked.

## Preferred contact hours

On November 9, 2026, Worker `031a96fa-3982-4c71-be8b-b5b6b1c60859` from `75fb060` was verified in the fictional Role Handoff QA brokerage. Harper set 9 AM to 5 PM Pacific Time from the borrower portal. The overdue Past Client Outreach call moved to November 10 at noon Eastern, which is 9 AM Pacific. Contact History showed the configured window and a timestamped change. The invited LO saw the new deadline in Today and the call action was disabled before it opened. The QA admin session was restored.

Local browser QA verified persistence across reload and clearing the window. Automated coverage verified daylight saving gaps and repeated hours, a half-hour zone, enrollment and rescheduling, blocked early calls and after-hours mock email or text, and restoration of the original schedule when hours are cleared. All 322 tests, lint, typecheck, the production Worker build, and both local workspace rehearsals passed. The public Demo and Product pages returned 200 with the new copy. Email and texting remained mocked.

## Weekday and weekend contact hours

On November 9, 2026, Worker `d758cf08-249d-4968-a361-d74d0293d0e2` from `ed09395` was verified in the fictional Role Handoff QA brokerage. Harper's saved 9 AM to 5 PM Pacific window appeared in both sets of fields after the upgrade. The borrower saved noon to 5 PM on weekdays and 10 AM to 2 PM on weekends, then reloaded and saw both values. Contact History showed the new windows and recorded the change. The assigned LO saw the Tuesday call move from noon to 3 PM Eastern, with the call action disabled before the new opening. The QA admin session was restored.

Local browser QA verified both windows persist. Automated tests covered the borrower's local Friday after UTC rolled to Saturday, Friday-to-Saturday deferral, the Sunday closing boundary, Monday resumption, and the spring daylight saving transition. All 323 tests, lint, typecheck, the production Worker build, and both local workspace rehearsals passed. The public Demo and Product pages returned 200 with the new copy. Email and texting remained mocked.

## Sample disclosure packages and critical dates

On November 9, 2026, Worker `6123301b-de84-49ab-b898-8305eb98374f` from `f4259e7` was verified in the fictional Role Handoff QA brokerage. An invited LO reviewed a new fictional 1003, saved a sample quote, loaded its fee worksheet in Disclosures, assembled and issued version one, and recorded a mock signature. The LO changed title and settlement fees from $1,400 to $1,650. Today showed one review task that opened the exact loan and workbench, where the previous receipt and both fee amounts appeared. Preparing version two cleared the task and kept version one's signed result in history. The QA admin session was restored.

Automated coverage included both joint signers, stale changes, unrelated offer fees, repeated saves, role restrictions, and signing reminder completion. All 324 tests, lint, typecheck, the production Worker build, and both local workspace rehearsals passed. A local browser run exercised the same fee-review loop. The public Demo and Product pages returned 200 with the new copy. Signing remained mocked.

## Borrower portal sample signing

On November 9, 2026, Worker `9391b9db-ef61-47a8-881f-6c8083abb1e7` from `0c92083` was verified in the fictional Role Handoff QA brokerage. The open borrower portal showed that a revision was being prepared while version two was a draft. Staff issued version two, and the open portal showed the $1,650 title and settlement amount without a manual refresh. The borrower reviewed the sample and recorded a mock signature. The open staff workbench showed completion and the same receipt, attributed to the borrower portal, without a manual refresh.

The joint-loan test verifies independent borrower and co-borrower responses, receipt privacy, stable receipts on retries, rejection of stale or revoked links, and a simulated decline. All 324 tests, lint, typecheck, the production Worker build, and both local workspace rehearsals passed. Local and hosted browsers exercised the signer handoff. The public Product and Demo pages returned 200 with the new copy. Signing remained mocked.

## Missing mock UWM receipt recovery

On November 9, 2026, Worker `d467c878-4749-480e-bb74-a06cef5e3834` from `7ae8669` was verified in the fictional Role Handoff QA brokerage. The invited LO simulated a missing acknowledgment for a reviewed 1003. The loan displayed receipt pending and removed the send action. The LO opened the exact loan from Today and retrieved the original mock receipt. The Income and Assets conditions appeared on the same loan and the task cleared. The QA admin session was restored.

The SQLite test verifies the original provider reference, receipt and attempted time, blocked resends, repeat checks, and reuse of the same lender file and conditions after an updated 1003. All 324 tests, lint, typecheck, the production Worker build, both local workspace rehearsals, and local browser QA passed. The public Product and Demo pages returned 200 with the updated copy. Lender activity remained mocked.

## Declined sample disclosure follow-up

On November 9, 2026, Worker `38e4d312-8ab8-4619-9d70-ea15883f4f7e` from `b5202c5` was verified in the fictional Role Handoff QA brokerage. The invited LO issued version three and the open borrower portal received it. A mock decline produced the same receipt in both tabs. Reopening Today showed the exact follow-up. The LO recorded a private note from Disclosures, the task cleared, and the borrower portal continued to show its receipt without the note. The QA admin session was restored.

The SQLite checks cover borrower retries, exact task routing, unauthorized access, an upgrade from a declined package written by the prior release, private and immutable follow-up evidence, and closing the task by replacing the package. All 324 tests, lint, typecheck, the production Worker build, both local workspace rehearsals, and local browser QA passed. The public Product and Demo pages returned 200 with the updated copy. Signing remained mocked.

## Sample disclosure change review

On November 9, 2026, Worker `1a3c39fb-5a9e-491e-b716-7d44824b5cf2` from `b8f04f6` was verified in the fictional Role Handoff QA brokerage. The invited LO mock-signed version four, changed the title and settlement fee from $1,650 to $1,750, and saw estimated cash to close change from $99,155 to $99,255. Today opened the exact review task. Preparing version five recorded the internal note, reviewer, timestamp, and prior version. It cleared the task and retained the earlier signature receipt in history. The QA admin session was restored.

All 324 tests, lint, typecheck, the production Worker build, both local workspace rehearsals, and local browser QA passed. The joint-application test covers required review evidence, stale edits, and portal privacy. The public Product and Demo pages returned 200 with the updated copy. Signing remained mocked.

## Sample disclosure evidence in Closing

On November 9, 2026, Worker `e65487b7-cba2-462c-96d0-7d608e291586` from `287b0cb` was verified in the fictional Role Handoff QA brokerage. An invited LO issued and mock-signed version five. Closing displayed its 1003 revision, fee worksheet revision, signature receipt, and the original fee review. The LO confirmed that evidence, then changed the fees again. Closing moved the confirmation to prior evidence and required an updated sample package before another confirmation. The LO prepared, mock-signed, and confirmed version six. Version five and its receipt remained visible in the closing history.

The SQLite role test verifies that the assigned processor can confirm two signed borrower receipts, an unassigned processor and another LO cannot, a retry keeps one record, and a fee change invalidates only the current confirmation. It also verifies that staff review evidence stays out of the borrower portal. All 324 tests, lint, typecheck, the production Worker build, both local workspace rehearsals, and local browser QA passed. Public Product and Demo returned 200 with the new copy. Signing remained mocked.

## Downloadable sample closing packet

On November 9, 2026, Worker `7703bf05-a599-4220-8f8a-784940811aab` from `da77ce7` was used by the invited LO to prepare two fictional closing packets from confirmed disclosure version six. The LO completed the closing package checklist item between the two snapshots. Chrome blocked direct attachment navigation in the rehearsal. Worker `bffad948-a6dc-480b-925c-63ea6723038f` from `6ed1e52` uses the existing in-app download pattern. The QA admin downloaded both actual files on that release.

Both PDFs rendered as one page. Each included the same confirmed disclosure and mock signer receipt. Version one showed the item open and version two showed it completed. A signed-out request for the exact packet redirected to login. The signed local Worker returned the exact stored attachment bytes. Automated tests covered the assigned processor, unrelated LO, brokerage mismatch, retry, superseded disclosure, and preservation of the earlier PDF. The 80-item layout fixture paginated without omitting its last item. All 324 tests, lint, typecheck, the production Worker build, and both local workspace rehearsals passed. The public Product and Demo pages returned 200 with the updated copy.

## Sample settlement reconciliation

On November 9, 2026, Worker `42304fee-174e-4c33-b470-3776101517b7` from `9772fb6` was verified in the fictional Role Handoff QA brokerage. The owner recorded $350,000 gross proceeds, $1,250 fees, and a negative $50 adjustment. Against expected net proceeds of $348,700, the $348,200 first receipt flagged a $500 shortfall. The owner recorded a difference review, added a $500 receipt, and confirmed the match. The earlier review note and both receipt references stayed visible.

Reversing the fictional funding archived cycle one and preserved its reconciled status. The invited LO had no Financials entry, and the QA admin session was restored. SQLite checks cover the separate compensation ledger, duplicate reference normalization, exact retries, stale actions, corrected advice, receipt reversals, and an empty next funding cycle. All 325 tests, lint, typecheck, the production Worker build, both local workspace rehearsals, and the local browser run passed. Public Product and Demo returned 200 with the updated copy. All amounts and evidence were fictional.

## Sample settlement exception queue

On November 9, 2026, Worker `2a0d8486-470f-44d3-a5f9-3a95f874fb33` from `bb92b6f` was verified in the fictional Role Handoff QA brokerage. The owner recorded a $348,200 receipt against $348,700 expected on cycle two. Reports → Financials → Settlement exceptions showed the $500 shortfall and opened cycle two directly. Recording a review moved it from Differences to Reviewed differences. The owner separately opened the reconciled, reversed cycle one from the archive.

SQLite checks cover upgrade of existing settlement evidence, matching receipts, missing evidence, pagination across tied timestamps, date correction, reversal, and owner and brokerage access. All 326 tests, lint, typecheck, the production Worker build, both local Worker rehearsals, and local browser QA passed. Public Product and Demo returned 200 with the updated copy.

## Mock UWM delivery timeline and condition replay

On November 9, 2026, Worker `647d070a-3ea4-47ff-80ca-bd692e9c0f73` from `565df1a` was verified in the fictional Role Handoff QA brokerage. On a completed purchase, **Conditions → Mock UWM delivery timeline** showed submitted 1003 revision one and the original bank statement and pay stub delivery receipts. Replaying an older Income update and the duplicate clearance twice left one stale event and two recorded deliveries of the duplicate clearance. **Open condition** focused the same Income condition, which stayed cleared. The file still showed zero outstanding and three cleared.

The first hosted read hit the previous Durable Object version while the public Worker served the new release. Retrying the same workspace after the [deferred code update](https://developers.cloudflare.com/changelog/product/durable-objects/) succeeded. SQLite checks cover missing and recovered acknowledgments, current and archived receipts, stale updates, duplicate event IDs with conflicting content, valid newer reopening, paging, role and brokerage scope, and preserved alerts, tasks, document requests, and drafts. All 326 tests, lint, typecheck, the production Worker build, both local Worker rehearsals, and the local browser run passed. Public Product and Demo returned 200 with the updated copy. Lender activity and signing remained mocked.

## Borrower next actions

On November 9, 2026, Worker `aee3d1ba-0777-40a4-95f1-987f95f0a64e` from `a7f40d7` was verified on a fictional borrower link. **Your next actions** showed the November 10 bank statement, November 12 sample signing target, and undated tax form in that order. The document action focused the exact checklist item and its PDF verification shortcut focused the verifier. Attaching a text sample removed the bank statement from the list and left it in review. Recording the mock signature removed the signing action and retained the receipt. The undated tax form remained.

The local browser check opened a correction from **Continue corrections** without changing the private link, confirmed the saved ZIP, and resubmitted the 1003. Worker `77fac905-0fcd-4ea9-b89c-c828f3510563` from `0542546` moved active actions above the status receipt. The hosted 390 px check measured the remaining action panel at 305–487 px and the receipt heading at 571 px, with no horizontal overflow. The tax form shortcut focused its exact row.

SQLite checks cover deadline order, processing and received uploads, pending and superseded packages, and isolation of co-borrower document requests and signer responses. All 327 tests, lint, typecheck, the production Worker build, both local Worker rehearsals, and local browser QA passed. The working-day script passed on retry after its local response body became unavailable during a separate MISMO assertion. Public Product and Demo returned 200 with the updated copy. Uploads and signing remained mocked.

## Conditional borrower document rules

On November 9, 2026, Worker `d9c6ef4c-4a84-4ec2-beac-29f652fa800b` from `648baa8` was verified in the fictional Role Handoff QA brokerage. The admin published a purchase checklist requiring Photo ID for a primary residence with current wage employment and homeowners insurance for an investment property. On the reviewed sample loan, the preview showed Photo ID due in two days and marked the insurance rule as unmatched. Adding the one matching request displayed template version one and reviewed 1003 revision one on the staff card. The borrower saw Photo ID in **Your next actions** with its deadline. The unmatched request and internal rule evidence were absent from the borrower view.

The local browser verified that conditional items remained withheld before review and that reviewing the same application made the correct item eligible. SQLite checks cover distinct primary and co-borrower employment answers, missing answers, stale previews, a corrected revision, preserved original requests, and legacy editors trying to overwrite a rule. All 328 tests, lint, typecheck, the production Worker build, both local Worker rehearsals, and local browser QA passed. Public Product and Demo returned 200 with the updated copy.

## Borrower question review

On November 10, 2026, Worker `7b90120d-7559-46fc-a9e4-61151ab85a6a` from `8ae5cf4` was verified in the fictional Role Handoff QA brokerage. The owner asked a due-today yes-or-no question on a reviewed 1003. The open borrower portal showed the exact question in **Your next actions**. Submitting Yes removed the action and added **Review borrower answer** to **Incoming loan work**. Opening the queue item focused the exact question. A clarification returned the original question and answer to the same borrower.

Worker `b210aef7-b1df-4049-ac45-159684dfff80` from `bd4aadb` hides the question controls when a workspace is still returning a pre-feature payload during a rollout. On that release, the same borrower submitted No and the owner marked it reviewed from the queue. The loan retained Yes under **Earlier answers**, the borrower saw **Reviewed** with zero to do, and the queue entry cleared. The first hosted attempt before the workspace adopted the feature was rejected and created no question.

SQLite checks cover separate primary and co-borrower links, assigned processor and unrelated staff access, repeat submissions, invalid answers, clarification, current revision checks, and staff-only answer history. All 329 tests, lint, typecheck, the production Worker build, both local Worker rehearsals, and the local browser check passed. The public Product and Demo pages returned 200 with the updated copy.

## Five-year costs in a shared borrower comparison

On November 10, 2026, Worker `7def5fee-6aed-47e2-bbf3-75bbcac97e37` from `1517ca1` showed a fictional $360,000 purchase at 6.125% par and 5.875% with points. The published preview and borrower portal agreed on $110,132.86 and $109,226.09 of estimated five-year borrowing cost. The higher-upfront offer broke even in month 48. After staff raised the alternative's appraisal from $650 to $700, the preview increased its modeled cost by $50 and offered to replace the shared quote. The borrower still saw the earlier costs and the original month 48 after reloading the private link.

The hosted 390 px check stacked both cost cards without page or card overflow. All 332 tests, lint, typecheck, the production Worker build, both local Worker rehearsals, and the local browser publication passed. The public Product and Demo pages returned 200 with the updated copy. All pricing in this rehearsal was mocked.

## Expiration and review of a shared sample quote

On November 10, 2026, Worker `f37d7e30-bc47-4a38-9e60-9ba7b88ee504` from `0eb1f38` shared a fictional comparison through November 12 Eastern. After staff changed the alternative’s appraisal from $700 to $740, Today opened the exact review with both values. The borrower still saw the $109,276.09 cost and month 49 break-even after reloading. The owner recorded an internal note and published a replacement. The borrower then saw $109,316.09 and month 50. Today cleared the task, and shared history retained $109,276.09 and the original expiry.

The local browser used **Keep shared version** to close the task without replacing the comparison. Tests exercised the Eastern midnight cutoff in standard and daylight time, the borrower expiry notice with the terms removed, stale review rejection, denial for an unrelated officer, and an exact publication retry. All 333 tests, lint, typecheck, the production Worker build, and both local Worker rehearsals passed. The hosted borrower view fit at 390 px. Product and Demo returned 200 with updated copy. Pricing remained mocked.

## Mock appraisal and title orders

On November 10, 2026, Worker `c30dfe34-ee49-497c-8552-e8eab40fcb7c` from `c85abcd` recorded a fictional appraisal due November 9 and a title order due November 13 in Role Handoff QA. **Processing → Service orders → Overdue** showed the appraisal alone and opened its exact order. Simulating the return added the appraisal to **Ready to review**. Chrome downloaded the sample PDF, and the file contained the same return reference displayed in the loan. Staff accepted the appraisal and title with separate internal notes. Both stayed on the loan with their PDF and review history, and the Open queue was empty. The hosted title card fit at 390 px without horizontal overflow.

The local browser opened the overdue appraisal from Today, requested a replacement, and kept both PDF versions after accepting the revised sample. SQLite checks verified assignment from LO to processor, rejection for an unrelated processor, rescheduling, cancellation, exact retries, and queue pagination. All 335 tests, lint, typecheck, the production Worker build, and both local Worker rehearsals passed. The public Product and Demo pages returned 200 with the service-order copy. The requests and returned documents were simulated.

## Accepted service evidence in the closing packet

On November 10, 2026, Worker `663245fc-91d7-4570-bfaa-ce917dc95b0e` from `2b958ed` recorded mock homeowners insurance, flood, and mortgage insurance orders on Fictional Disclosure Pilot QA. **Processing → Service orders → Ready to review** showed all three. Staff accepted the returns and linked each to **Confirm conditions and closing package**. The checklist kept its completed status, and **Open service order** focused the exact mortgage insurance return. The linked card fit at 390 px.

After confirming the existing mock-signed disclosure v7, the owner prepared packet v3. The downloaded PDF contained all three exact return references. The re-downloaded v2 excluded those references and matched the SHA-256 of the original v2 download. Local browser QA preserved the original appraisal on upgrade and linked and unlinked a new flood return while its checklist item remained open. SQLite verified the old catalog migration, scoped linking, accepted-only evidence, retries, and prior packet preservation. All 336 tests, lint, typecheck, the production Worker build, and both local Worker rehearsals passed. The public Product and Demo pages returned 200 with the updated copy. Services and signing remained mocked.

## Payer and payee details in confirmed sample fees

On November 10, 2026, Worker `361870f2-7723-4164-9719-0ce1554e4a7f` from `58cd779` opened disclosure review when staff recorded Fictional Title Desk as the payee on the unchanged $1,825 title and settlement fee. Adding $350 paid by the seller and $100 paid by the lender left $1,375 for the borrower. The review showed estimated cash to close moving from $99,330 to $98,880. The owner recorded a review note and issued sample disclosure v8. The borrower portal showed the gross fee, split, and payee, and recorded the mock signature. Staff confirmed that evidence in Closing.

The downloaded sample closing packet v4 included the exact split, company, and $98,880 cash to close. A fresh download of v3 matched the original SHA-256. The borrower summary fit at 390 px. The local browser rejected a split larger than its gross fee and published a separate four-payer appraisal example whose borrower comparison reflected only the borrower share. All 337 tests, lint, typecheck, the production Worker build, and both local Worker rehearsals passed. The public Product and Demo pages returned 200 with the updated copy. Pricing, fees, and signing remained simulated.

## Itemized settlement fee comparison

On November 10, 2026, Worker `d80657d7-f433-4019-af4a-f0aecd9238c8` from `e0fcbe3` opened Finance on the fictional funded disclosure file. The first sample statement pinned confirmed disclosure v8 and fee worksheet v6. The title fee stayed $1,825 gross, while the borrower share moved from $1,375 to $1,475 and the payee changed from Fictional Title Desk to Fictional Settlement Desk. **Fee differences** opened and focused that cycle. Recording a review moved it to **Reviewed fee differences**. A corrected statement matched the confirmed figures, and the original statement and review note stayed available.

The hosted difference card fit at 390 px. The local browser verified a $100 gross and borrower fee increase and the exact queue link. SQLite verified offsetting line differences, pinned baseline after a worksheet edit, stale requests, retries, fee and proceeds separation, funding date correction, and archival after reversal. All 338 tests, lint, typecheck, the production Worker build, and both local Worker rehearsals passed. Public Product and Demo returned 200 with the updated copy. Settlement and signing evidence remained fictional.

## Brokerage Owner Scorecard

On November 10, 2026, Worker `df310937-b414-477a-a2b0-205088084b18` from `81340a2` completed the fresh hosted CSV campaign walkthrough in **3:09**, from Create guided pilot through **7 / 7** and opening the scorecard. The run used an existing signed-in QA admin, included the actual two-row CSV upload, and excluded narration. The fresh pilot stayed separate from the executive workspace. The borrower submitted a fictional 1003, mock credit and pricing used ZIP 48304, and two clean sample PDFs cleared mock UWM. The realtor saw Clear to Close. Staff recorded closing, $360,000 in sample funding, a requested callback, and a separate repeat refinance. Casey's 6.000% sample rate reached the 6.125% target and opened another refinance with a confirmed property address.

Before clearance, one loan with two open conditions appeared in Needs attention. **Open condition** focused the exact Income condition. After clearance, the count returned to zero. The walkthrough campaign showed **2 leads, 1 submitted 1003, and 1 funded loan**. The funded drilldown opened Jordan's exact funding section. The companion campaign contributed one other lead to the all-campaigns total. An owner-specific view persisted after a reload. In a second fictional QA workspace, the $275,000 projected loan opened Closing and an overdue first contact opened the matching Lead Inbox record. At 390 px the scorecard stacked in one column and its content width matched the card width.

The initial upload exceeded the hosted SQLite compound-select limit on this report. The prior release was restored, the query was split, and the built Worker rehearsal now exercises scorecard access, tenant and role rejection, and saved views through the deployed action. All 340 tests, lint, typecheck, the production Worker build, and both local Worker rehearsals passed on the corrected release. All workflow integrations used simulated results.

## Fictional lender profile checks for MISMO export

On November 10, 2026, Worker `ac272e1b-e91d-46e4-bcf4-22042115e185` from `915dbb1` verified the wholesale profile on Casey's separate fictional refinance. After borrower submission and staff review, a single export panel remained visible. The profile listed ten blockers, including refinance type. **Open field** focused the originator name and the refinance type directly. Saving fictional IDs and terms cleared the checks and enabled the XML download.

The direct staff download and the code-protected recipient download matched byte for byte. The parsed XML contained the refinance purpose, NoCashOut, 6.250% note rate and 360-month term. A sample acknowledgment opened `QA-REFI-PROFILE-V1`. Recording a lender return blocked the older package. After a borrower property correction and staff review, the profile remained selected, the revised XML contained the corrected address, and staff reacknowledged the same lender reference.

The first hosted attempt exposed duplicate panels when a draft and the lender detail form shared a component key. The corrected release verified the transition on a separate draft. At 390 px the readiness panel fit its contents. All 341 tests, lint, typecheck, the production Worker build, and the working-day and concurrency rehearsals passed. Public Product and Demo returned 200 with the new copy. The profile uses fictional rules and no lender was contacted.

## Versioned purchase and refinance intake

On November 10, 2026, Worker `ab6b9303-d213-4cca-9026-b7ed9e2f3c0b` from `83e8464` published Purchase v1 and Refinance v2 in an isolated fictional pilot. Both links kept the same token. The purchase request required a property ZIP and a purchase question. It joined the configured campaign and stayed shared because the assignment cap was full. The refinance required email, hid the ZIP, and routed directly to the selected owner. Switching from purchase to refinance preserved the borrower name and email.

Refinance v3 changed the question while a borrower tab had v2 open. The stale submission loaded the current question, preserved contact details, and cleared the earlier answer and consent. The original accepted lead still showed the v2 question and answer. Staff converted the v3 inquiry, confirmed the borrower details in the prefilled refinance 1003, and saw the v3 question and answer in loan Activity. At 390 px the borrower form fit its contents.

SQLite and the built Worker verified stale and cross-profile submission rejection, retired profiles falling back to General, authorization, and offboarding a profile owner. All 343 tests, lint, typecheck, the production Worker build, and the working-day and concurrency rehearsals passed. Public Product and Demo returned 200 with the updated copy. The executive workspace was left available for the separate walkthrough.

## Conditional quote intake and reviewed 1003 prefill

On November 10, 2026, Worker `0d06b6e1-53ba-4099-a106-093e0409ae31` from `bf12a73` published Refinance v4 in the isolated fictional QA brokerage. A yes-or-no rental question revealed required occupancy and requested loan amount fields only after Yes. The local Chrome run also confirmed that hiding the follow-ups cleared their previous answers. At a 390 px override, the live borrower form had no horizontal overflow.

Staff saw the accepted profile version and answers in Lead Inbox. They selected occupancy and created the 1003. The live borrower draft showed Investment property and left the requested amount empty. Loan Activity showed the original sample amount, the accepted profile version, and the staff member's prefill decision.

All 344 tests, lint, typecheck, the production Worker build, and the working-day and concurrency rehearsals passed. The built Worker rejected an unassigned officer's conversion and preserved the accepted receipt after profile retirement. Public Product and Demo returned 200 with the new copy. The executive brokerage was outside this rehearsal, and provider actions remained mocked.

## Current release CTO walkthrough with a reopened condition

The [November 10 current release rehearsal](executive-rehearsal.md#november-10-current-release-rehearsal) exercised the current hosted Worker `0d06b6e1-53ba-4099-a106-093e0409ae31` from a fresh fictional pilot. The two-row CSV, 1003 review, mock pricing, both sample PDFs, closing, funding, and the repeat refinance reached **7 / 7**. The scorecard opened at **3:58** and Casey's new borrower draft showed the confirmed property at **5:01**, including browser observations and excluding narration and sign-in.

On the same file, reopening Income blocked Record closing and gave the borrower a replacement request. The realtor's **Refresh referrals** showed Closing on hold without the document details. The same refresh showed Clear to Close after the replacement cleared. The funded campaign drilldown opened Jordan's closing workbench. The owner scorecard and the rate-watch refinance used separate records, and all provider activity remained fictional. The public landing, Product, and Demo routes returned HTTP 200.

## File preflight candidate and hosted rollback

The candidate from `ce69340` adds an internal preflight for the reviewed 1003, loan amount, saved sample fees, confirmed mock signatures, lender receipt, conditions, and document evidence. In local Chrome, the initial issue opened the current 1003. A missing appraisal fee opened the worksheet and focused its empty Appraisal field. Saving it changed the fee check to Ready on worksheet revision 2.

The built Worker rehearsal assigned the review to the fictional processor, rejected a premature approval, and used the exact 1003 amount comparison to reconcile a corrected application. A fee change invalidated the pending review. After the sample package was signed and confirmed, staff resubmitted and the processor approved the current snapshot. The original evidence stayed in decision history. All 345 tests, lint, typecheck, the production build, and both local Worker rehearsals passed.

Cloudflare candidate `fffd999d-11b0-44ed-8ee6-cab9c01048aa` served the updated public pages, and all 38 client chunks matched the build in direct HTTP checks. A fresh signed-in Chrome tab failed to load the hosted workspace module. The exact bundle hydrated and navigated in a loopback Worker with a fictional signed-in session. Reactivating the candidate produced the same hosted Chrome failure, so the verified CTO release `0d06b6e1-53ba-4099-a106-093e0409ae31` was restored. A signed-in Chrome tab then opened the completed **7 / 7** guide. File preflight and its marketing copy remain in the candidate. The executive workspace was outside the test.

## File preflight staged and verified on OrbitLOS.com

On November 10, 2026, the rebuilt candidate `8c9fb9a2-2403-417b-89cc-73cab66722a3` from `2fffc77` was staged at 0% while the CTO build served normal traffic. The staged pages were reachable while three new client scripts returned HTTP 404. The scripts became reachable on later checks. The release gate then matched all **43 JavaScript and CSS assets** byte for byte twice before promotion. Loading loan dialogs on demand reduced the main workspace chunk from 991,087 to 730,768 bytes. A loopback Chrome rehearsal opened and closed the separately loaded New Lead dialog.

At 100% traffic, a fresh signed-in Chrome tab opened Pipeline, Search, and the fictional funded purchase from the QA campaign. File preflight opened the current fee worksheet, focused a deliberately blank Appraisal field, and displayed the corrected worksheet v2 as Ready. The lender acknowledgment opened the exact mock file with three cleared conditions. The existing campaign guide showed **7 / 7**. Chrome still logged an App Router route-manifest warning also observed on the previous build. The tested staff navigation and actions completed.

In the same isolated QA brokerage, Riley's sample 1003 was submitted, reviewed, and priced. Staff assembled and issued disclosure v1 with a signing target. The borrower recorded a mock signature and the staff tab showed the signed receipt. Changing Appraisal from **$650 to $725** created a fee-change task in Today. It opened the affected package and showed the **$75** cash-to-close difference. Staff recorded the review and prepared v2. The new signer was pending, v1's signed receipt stayed in history, and the fee-change task cleared. The local Worker rehearsal verified the separate assigned processor's preflight approval and preservation of the earlier evidence. The executive workspace was outside the test.

All 345 tests, lint, typecheck, production build, and both local Worker rehearsals passed. Public landing, Product, and Demo returned HTTP 200. Product and Demo described file preflight, and provider actions stayed mocked.

## Quarterly call report reconciliation

On November 10, 2026, Worker `a4c56707-78f8-45ff-b779-18115d0e050f` from `5ed4ddf` served the quarterly review. In a fresh signed-in Chrome tab in Fictional Quarter Review QA, a Q3 review saved the ending pipeline of one Michigan loan at **$350,000**. The initial Q4 opening matched. Changing the same loan to Ohio and **$355,000** showed a state and amount difference. The difference opened the exact reporting facts, and the saved Q4 v1 and v2 CSVs downloaded with their respective states and amounts. A readiness blocker opened the exact missing received date before the first save.

All 347 tests, lint, typecheck, the production build, and both local Worker rehearsals passed. The built Worker rejected a stale save and reproduced the old CSV byte for byte after correction. The first 0% upload came from an older bundle in the verification worktree despite having the new Git tag. Staged Product and Demo copy checks caught the mismatch. Rebuilding inside the detached worktree, checking for the feature in the generated server and browser bundles, and checking both public pages under the staged override verified the replacement. All 43 JS and CSS assets matched twice before promotion. Always rebuild inside the upload worktree after switching commits. Production stayed on the prior verified version until the new candidate passed.

Public landing, Product, and Demo returned HTTP 200 after promotion, and the existing hosted fictional campaign guide opened at **7 / 7** and navigated to the Owner Scorecard. The executive workspace was outside the rehearsal. Quarterly review is an internal CSV workflow based on confirmed intake amounts. Provider activity stayed mocked.

## Website branch routing and assignment history

On November 10, 2026, Worker `ec08088e-ec52-4e64-b3cf-b5e43b6688cb` from `583a986` served the branch defaults and routing preview. In an isolated fictional brokerage, staff previewed ZIP **48304** against the draft Purchase profile. The **483** branch default selected the configured owner. After publishing Purchase v1, a separate borrower tab submitted a sample inquiry. Lead Inbox showed the same initial assignment and version. Staff moved the lead to the shared inbox, where its routing receipt still showed the original owner. The receipt’s event then appeared in Activity on the converted loan.

Local tests verified exact ZIP precedence, campaign routing and overflow, unavailable officer fallback, offboarding, stale previews, and retention after reassignment and republication. The built Worker verified that two active officers received eligible campaign leads up to their caps and an email-only lead used the branch default. It rejected unauthorized previews and omitted routing configuration from the borrower form. All 348 tests, lint, typecheck, the production build, and both local Worker rehearsals passed.

Both staged public pages showed the new branch routing copy, and all 43 browser assets matched twice before promotion. After promotion, public landing, Product, and Demo returned HTTP 200, and the existing fictional campaign guide opened the Owner Scorecard. No executive workspace or external integration was used.

## Shared custom reports

On November 10, 2026, Worker `29170f1a-27a3-4faa-b10e-29faaaf7f8ea` from `207ba25` served saved custom reports. A fresh signed-in Chrome tab in the fictional QA brokerage created an intake report grouped by campaign and shared with LOs. The CSV campaign group showed three inquiries, one submitted 1003, and one funded loan. The inquiry count opened all three records, and staff opened Casey’s exact lead and Jordan’s **$360,000** funded loan. A separate production report grouped by current stage with a selected loan amount field reopened after a browser reload. Its funding count showed Jordan’s recorded date and amount. At a 390 px viewport, the drilldown fit inside the page without horizontal overflow.

The built Worker used separate fictional Admin, LO, and Processor sessions. It rejected an LO’s edit, rejected cross-brokerage access, counted only the LO’s own records, and denied the old drilldown after the admin removed LO sharing. A processor’s production totals matched the assigned files that opened from the drilldown. The local tests covered report dates, sharing changes, grouping, funding reversal, exact ownership, and paging.

All 350 tests, lint, typecheck, the production build, and both local Worker rehearsals passed. Both staged marketing pages displayed the new copy, and all 44 browser assets matched twice before promotion. Public landing, Product, and Demo returned HTTP 200 after promotion. The existing fictional campaign guide opened the Owner Scorecard. Provider workflows remained mocked.

## Disclosure deadline calendar

On November 10, 2026, the first calendar candidate `46bc91ca-13bb-40c1-bec5-eb24fb82a4f8` served the new browser code but received an older loan payload during the hosted smoke. Opening Disclosures caused a rendering error. The prior Worker `29170f1a-27a3-4faa-b10e-29faaaf7f8ea` was restored and the same fictional loan’s disclosure panel opened. The replacement handles a missing suggestion with a manual date and refresh control. Promotion requested immediate Durable Object updates. [Cloudflare Durable Objects code updates](https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/)

Worker `1beb832d-3d87-417a-8c73-c144021ab1fd` from `35e3172` passed the staged marketing checks and matched all 44 browser assets twice. In a fresh signed-in Chrome tab, Morgan’s reviewed and priced fictional loan used calendar v0 for a November 12 signing target. The admin previewed a November 12 closure, opened the exact draft, and published v1 with a reason. The draft displayed the November 13 target and required a revision. Staff prepared and issued package v2 under calendar v1.

A second policy preview moved a new target to November 17 and marked the issued package to keep its existing date. After publishing calendar v2, the borrower portal still showed November 13 and recorded a simulated signature. The staff panel showed the receipt, November 13, and calendar v1. The built Worker also verified that the reminder retained its original due time. All 352 tests, lint, typecheck, production build, and both local Worker rehearsals passed. Public landing, Product, and Demo returned HTTP 200, and the fictional campaign guide opened the Owner Scorecard.

## Brokerage CRM fields and filters

On November 10, 2026, Worker `be19d44a-f01f-4716-af95-a0644ce1d38a` from `780b0bf` served brokerage CRM fields. In the signed-in fictional QA brokerage, an admin added the choice field **QA outreach tier** and saved **Priority** on Casey Campaign Reserve. An intake report filtered to Priority counted one inquiry and opened Casey's exact lead. A saved quiet-lead segment retained the field and value and showed zero matches because the fixture did not meet the quiet period. The existing campaign guide still showed **7 / 7 ready** and opened the Owner Scorecard with one recorded sample funding for **$360,000**.

The built Worker verified field creation and scoped edits, carryover through conversion, a filtered drilldown to the converted loan, zero matches for the other LO, and access revocation before counts or drilldowns. SQLite tests also covered processor read scope, opt-out exclusion, stale selection, an archived filter, preservation of an existing borrower value, and merge undo. All 354 tests, lint, typecheck, production build, and both local Worker rehearsals passed.

Both staged marketing pages showed the new copy, and all 44 browser assets matched twice before promotion. Public landing, Product, and Demo returned HTTP 200 after promotion. Provider workflows remained mocked. QA used the fictional brokerage. The report filter matches one typed value, and report exports and loan-level fields are separate work.

## Scoped custom report CSVs

On November 10, 2026, Worker `2ac3ad8e-aeb5-4b53-b82e-464059f80199` from `a38899c` served CSV downloads for saved custom reports and their count drilldowns. In the fictional QA brokerage, Chrome saved the full Priority outreach report and the Imported CRM inquiries count. Both files contained the same header and one event for Casey Campaign Reserve. Jordan's lead was absent. The completed guide still opened the Owner Scorecard with mock UWM enabled.

The built Worker verified that the assigned LO downloaded the exact converted loan, the other LO received a header-only file, and cross-brokerage, revoked field sharing, and archived filters rejected export. SQLite tests checked multi-page parity, saved columns, date and revision checks, formula-safe escaping, audit attribution, and the 2,000-row limit. All 356 tests, lint, typecheck, the production build, and both Worker rehearsals passed.

Both staged public pages displayed the updated CSV copy and all 44 assets matched twice. Public landing, Product, and Demo returned HTTP 200 after promotion. Provider workflows stayed mocked.

## Loan fields and production reporting

On November 10, 2026, Worker `fd09b134-5918-45e3-afe2-46e2428b6dfc` from `080ce11` served custom fields on individual loan files. In the live fictional brokerage, an admin created **QA closing priority**, set **Rush** on Jordan's funded purchase, and confirmed the value was blank on Jordan's separate refinance. The filtered production report showed one file, one submitted 1003, and one funding. The Files created drilldown opened the purchase, and its downloaded CSV contained exactly that purchase. The existing campaign guide still opened the Owner Scorecard.

The built Worker allowed the assigned processor to edit the field, showed it as read-only to the LO, and omitted it from the borrower response. A competing LO received zero matching rows. Revoking processor view access removed both the field and export access. SQLite tests covered legacy field definitions, per-file separation, field permissions, the production and segment filter boundaries, and value cleanup on deletion. Loan-field settings and values use separate tables so the preceding release cannot edit their definitions. All 357 tests, lint, typecheck, the production build, and both Worker rehearsals passed.

Both staged public pages displayed the loan field copy and all 44 assets matched twice. Public landing, Product, and Demo returned HTTP 200 after promotion. All provider workflows remained mocked.

## Loan stage edit controls

On November 10, 2026, Worker `e1405124-6318-4221-889b-ad545c12b684` from `3711925` served the stage edit policy. In the live fictional branch-routing workspace, an admin locked quote and fee edits at Application. Morgan's signed sample disclosure showed the disabled $650 appraisal field. The admin entered an internal reason and changed the fee to $675. Orbit cleared the override input, retained the sample signature receipt, and created **Review disclosure package · Fees changed** in Today. The loan audit retained the actor, Application stage, policy v1, and reason. The QA workspace policy was restored in v2.

The built Worker denied a normal LO edit and a forged override and opened the fee review after an authorized save. SQLite tests also exercised stale policy and stage checks, repeat saves, assigned processor restrictions, a mock borrower signature and 1003 resubmission under the lock, and preservation of the ordinary review path. The local Chrome rehearsal recorded a separate lender-details override. All 358 tests, lint, typecheck, production build, and both Worker rehearsals passed.

Both staged public pages displayed the stage controls and all 44 assets matched twice. Public landing, Product, and Demo returned HTTP 200 after promotion. The completed campaign guide opened the Owner Scorecard, and provider workflows remained mocked.

## Reusable sample disclosure templates

On November 10, 2026, Worker `e991b284-a501-4dc4-ab4b-22f2f29af827` from `c788e0c` served disclosure templates. In the live fictional branch-routing workspace, an admin published a Michigan purchase template with sample loan terms and borrower acknowledgment. Morgan's reviewed Purchase 1003 matched it. Staff resolved the open appraisal fee review and prepared sample package v3 with template v1.

The admin then published template v2 with the fee summary in place of the acknowledgment. Package v3 kept template v1 and its original two documents. Staff issued and mock-signed v3. Its new mock receipt and the earlier borrower portal receipt on v2 remained visible. The completed campaign guide opened the Owner Scorecard.

The Worker rehearsal rejected stale versions and unauthorized template management, retained the prior template in package history, and kept internal template metadata out of borrower status. SQLite tests covered matching precedence, ties, mismatches, manual selection, archiving, and borrower signing and fee-review continuity. All 359 tests, lint, typecheck, production build, and both Worker rehearsals passed. Both staged marketing pages showed the new template copy, all 44 assets matched twice, and the public landing, Product, and Demo returned HTTP 200 after promotion.

## Hosted reusable borrower question sets

On November 10, 2026, the fictional branch-routing admin published a three-prompt Processing set, added two selected questions to Morgan's submitted file, and reviewed the borrower's reply. The staff record retained set v1. The initial hosted release `243ad1c2-66a6-4855-b7b6-ea00dd99bca2` kept the default for one browser-edited date. The follow-up `242083ce-bf3d-4d28-a647-7033d8caab4e` from `bc2bbbe` reads the current date from the form at submission. The previously skipped prompt then appeared in the borrower portal with the newly selected November 14 deadline.

The built Worker rehearsal issued two selected questions to separate joint-borrower portals, confirmed their distinct deadlines, and replayed the batch without duplication. The SQLite regression test covered stale applications and templates, a revoked link, a wrong-recipient answer, an atomic failure, and the assigned processor's review queue. All 360 tests, lint, typecheck, the production build, and both Worker rehearsals passed. The staged Product and Demo pages displayed the new copy and all 44 assets matched twice. The public landing, Product, and Demo returned HTTP 200 after promotion.

A fresh fictional QA pilot on the corrected Worker imported the two-row CSV and completed the 1003, mock pricing and lender handoff, document replacement, closing, funding, and a returning-client application. Reopening Income disabled Record closing and showed Closing on hold to the realtor. The replacement cleared the condition and restored Clear to Close. The campaign opened the owner scorecard in 4:38, showing two leads, one submitted 1003, one funded loan, and $360,000 in recorded funding. The funded drilldown opened Jordan's loan. At 5:22 Casey's separate rate-watch borrower draft showed Refinance and ZIP 48084. Times include setup and browser checks and exclude sign-in and narration. This used the signed-in QA admin and separate fictional borrower and realtor tabs. Provider workflows remained mocked.

## Hosted closing and funding checks

On November 10, 2026, Worker `2a475849-9c78-4d07-9105-9de309f63788` from `aea744e` served independent brokerage rules for closing and funding. In the isolated fictional QA workspace, an admin required a completed checklist before closing and a reviewed 1003 before funding. File Exceptions opened the empty checklist first. After staff added Check sample escrow figures with a due date, the manager link focused that exact item and Record closing remained disabled. Completing the item enabled closing and the recorded date exposed the separate 1003 hold before funding.

The QA admin entered a reason and recorded sample funding. The hold left the manager queue. Loan Audit showed the override reason and policy version 1. The QA policy was restored to its previous selections as v2. A separate signed-in QA tab opened the completed 7 / 7 guide and its owner scorecard. The CTO's presentation workspace was outside this rehearsal.

The working-day Worker rehearsal checked the exact links, authorization, and override replay. SQLite coverage included an absent checklist, revised evidence, loan scope, and the independent reopened UWM hold. All 361 tests, lint, typecheck, the production build, and both Worker rehearsals passed. Product and Demo showed the new copy, all 44 staged assets matched twice, and the public landing, Product, and Demo returned HTTP 200 after promotion. Provider activity remained mocked.

## Hosted manual lender quote comparison

On November 10, 2026, staff in the fictional branch-routing workspace entered a Harbor Wholesale 20-year fixed offer for Morgan's existing $360,000 scenario and compared it with the 30-year mock UWM offer. Harbor showed a 5.625% note rate, 5.701% APR, $2,501.88 monthly principal and interest, and a $900 lender credit. Staff selected Harbor and opened the exact manual export. The downloaded fictional MISMO 3.4 XML contained `NoteRatePercent` 5.625 and a 240-month amortization term. The fictional acknowledgment kept quote `HARBOR-DEMO-201` with the lender's file reference and opened Harbor's condition checklist. Selecting Harbor also opened a disclosure review on the previously signed sample package.

The first live comparison required horizontal scrolling inside the drawer. Worker `ccc47ccd-df69-4fdb-b5d5-9c0481904ce8` from `ea424db` replaced the table with cards and reopened the existing acknowledgment from the selected card. A signed-in desktop check showed two columns with no horizontal overflow. At 390 px the cards stacked and the handoff control stayed visible. The browser viewport was restored. A separate signed-in QA tab on the first release opened the existing completed guide and owner scorecard. The executive workspace was outside the rehearsal.

The built Worker verified the required second review before manual acknowledgment and the exact export terms. SQLite coverage included duplicate submissions, wrong-lender rejection, UWM handoff and mock lock isolation, borrower expiration, and invalidation of a share link after a quote switch. All 362 tests, lint, typecheck, production build, and both Worker rehearsals passed. Both staged marketing pages showed the new copy, all 44 assets matched twice, and the public landing, Product, and Demo returned HTTP 200 after promotion. All lender activity remained fictional.

## Hosted selective bulk document work

On November 10, 2026, staff in the fictional branch-routing workspace sent Rowan’s reviewed 1003 to mock UWM. The borrower supplied both sample PDFs. In Conditions, staff selected the pay stub and bank statement, confirmed review, and accepted and sent both in one action. Checking just the pay-stub receipt cleared Income and left Assets outstanding. Checking the bank statement cleared the other condition. Both PDFs showed Accepted in the borrower portal. The existing signed-in 7 / 7 guide opened the owner scorecard in a separate QA tab.

The final Worker `b748e3bd-93b9-45ad-afdc-711b7121654c` from `019089a` compacted the batch selector and put each checkbox beside its evidence label. The open panel had no horizontal overflow at 390 px. The fictional borrower attached replacements after both conditions were reopened, and staff accepted and mock-sent both and cleared both selected receipts on the final release.

The built Worker exercised an assigned processor, a competing LO denial, a stale batch rollback, an exact replay, selective clearance, and the return to the original LO. SQLite tests exercised all four batch actions, including retry, duplicate rejection, and matching borrower signals. All 363 tests, lint, typecheck, the production build, and both Worker rehearsals passed. The updated Product and Demo pages returned HTTP 200, and all 44 staged assets matched twice. Provider activity remained mocked.

## Hosted accepted evidence reuse

On November 10, 2026, Worker `70721418-d349-40e5-ae24-273112a6c513` from `984f063` served accepted evidence reuse. In the isolated fictional branch-routing workspace, staff used Rowan's accepted pay stub revision 5 to fulfill an untouched request for a manual lender's Income confirmation condition. The existing request became Accepted at revision 1. The original was accepted before structured reviewer tracking, so the receipt displayed Previously accepted. Staff downloaded the linked PDF and recorded the fictional delivery and clearance separately. The cleared condition retained the original source revision and both references. A separate signed-in tab opened the completed 7 / 7 guide and its owner scorecard. The presentation workspace was outside this rehearsal.

The built Worker rehearsal added a separate manual condition, linked an accepted sample, replayed the same link, checked the borrower's scoped checklist, and recorded delivery and clearance. SQLite coverage checked processor assignment, stale selections, mock UWM delivery and clearance, staff-only provenance, and retention of the exact PDF object after both current file pointers changed. It also verified that deleting the final reference queued the object once. All 364 tests, lint, typecheck, production build, and both Worker rehearsals passed. The staged public Product and Demo pages showed the new copy and all 44 assets matched twice. Public landing, Product, and Demo returned HTTP 200 after promotion. Provider activity remained mocked.

## Hosted borrower verification service orders

On November 10, 2026, Worker `b6124b6d-849d-46d7-add4-8f6636789d3f` from `193f004` added fictional employment, income, and asset verification orders. In the isolated branch-routing QA workspace, staff linked a sample appraisal to the closing checklist before the release. The link remained on the same item after the catalog upgrade.

On that fictional joint loan, staff created one income order per borrower. The overdue filter showed the primary borrower’s order. The Ready to review filter opened the co-borrower’s exact returned order. Its downloaded PDF contained the co-borrower label and the same return reference as the loan. Staff accepted and linked it to the closing checklist beside the original appraisal. The primary borrower’s order stayed open. A separate signed-in QA tab showed 7 / 7 and opened the owner scorecard. The CTO presentation workspace was outside the rehearsal.

The built Worker exercised an assigned processor, cross-owner denial, exact retry, queue removal, and privacy in both borrower portals. SQLite covered three new order types, separate recipients, duplicate rejection, identical PDF content from the order and linked closing evidence, and preservation of an existing appraisal link during the database upgrade. All 365 tests, lint, typecheck, production build, and both Worker rehearsals passed. The staged pages contained the new copy and all 44 assets matched twice. Public landing, Product, and Demo returned HTTP 200 after promotion. Services remained simulated.

## Hosted income verification behind a mock quote

On November 10, 2026, Worker `b60ee1f2-4a01-4f26-b5d2-cfd28b3c1190` from `71d599c` let staff cite accepted employment and income verification returns in the income worksheet. In the fictional branch-routing QA workspace, staff cited Rowan's accepted income verification for the primary borrower, entered $6,250 monthly and the sample October source period, and approved worksheet v3. The mock quote carried that amount and opened v3 from its saved card. After staff saved a new draft v4, the quote flagged the need to reprice. It still opened the approved v3 and the exact return receipt. Chrome downloaded a PDF containing the original return reference and primary borrower label. A separate signed-in QA tab opened the completed 7 / 7 guide and its owner scorecard. The CTO workspace was outside the rehearsal.

The built Worker exercised an assigned processor, LO approval, quote creation, stale quote protection, and restricted historical access. SQLite covered same-loan and borrower scope, wrong receipt, exclusion of unaccepted and asset returns, and retained history when the original verification was no longer available. All 366 tests, lint, typecheck, production build, and both Worker rehearsals passed. Product and Demo showed the new copy and all 44 staged assets matched twice. Public landing, Product, and Demo returned HTTP 200 after promotion. Verification and pricing remained simulated.

## Current CTO walkthrough and disclosure backup

On November 10, 2026, production Worker `b60ee1f2-4a01-4f26-b5d2-cfd28b3c1190` completed a fresh signed-in fictional run. The two-row CSV, mock follow-up text, prefilled and reviewed 1003, mock credit and pricing, mock UWM, two sample PDFs, reopened Income and replacement, realtor hold and recovery, closing, funding, and the original borrower's separate refinance reached 7 / 7. The owner scorecard opened at 4:25 and Casey's refinance property was verified at 5:43. The times include browser control retries and exclude sign-in and narration. The [presenter run sheet](executive-rehearsal.md#november-10-fresh-pilot-rehearsal-on-the-quote-evidence-release) lists the exact checkpoints.

In a separate fictional workspace, Morgan's sample disclosure v4 used the November 17 internal signing target and an appraisal fee of $650. Staff issued it and the borrower portal recorded the mock signature. Changing the fee to $725 created a fee-change review in Today. Its action opened Morgan's Disclosures and showed the $75 cash-to-close difference. Preparing v5 cleared that task, kept the original signed receipt with v4, and showed a pending signer on the new draft. All provider and signing activity stayed simulated. Neither rehearsal used the presenter account or workspace.

## Hosted sidebar action counts

On November 10, 2026, Worker `7daa61a3-3702-445c-a9d0-b96bcb508a14` opened the first-contact filter from a badge of two in a fictional owner workspace. The list included the assigned buyer and the unassigned reserve. Logging the buyer's first call dropped the badge to one. Starting the borrower's application then exposed a bug where the badges disappeared in a lightweight workspace view.

Worker `b913dcdd-4e51-4fcb-b192-f17da805db58` from `fd3bb3d` removed the full workspace loading dependency. After the fictional borrower submitted, the owner saw Today 1 and Lead Inbox 1. Today opened the incoming 1003. Marking it reviewed removed the Today badge without changing Lead Inbox. At a 390 px viewport, the collapsed menu indicated waiting work and the expanded menu showed both badges without horizontal overflow. The presenter workspace was outside the test.

The authenticated Worker rehearsal verified owner, LO, and processor scope, mismatch denial, and count changes through assignment and first contact. SQLite covered held, contacted, opted-out, and converted leads, a submitted 1003 counted once, and the 99+ cap. All 367 tests, lint, typecheck, the production build, and both Worker rehearsals passed. All 44 staged assets matched twice. The public landing, Product, and Demo returned HTTP 200 after promotion.

## Hosted owner Exceptions

On November 10, 2026, Worker `2e9ad659-0d62-45b2-87fb-0092bbaa6e2c` from `095ddc5` opened Exceptions directly from the owner sidebar. The signed-in fictional Branch Routing QA workspace showed a count of two, with two unassigned handoffs in the queue. Selecting the handoff for the fictional Rowan file focused Processing handoff. Escape returned to the Unassigned handoffs filter and restored focus to Rowan's action. The hosted check used the owner view and read the fictional records.

The built Worker rehearsal exercised separate owner, LO, and processor sessions. It verified the badge decrement after processor assignment, the increase after a mock lender reopening or a changed sample fee, and removal after mock clearance or preparing a revised disclosure. LO and processor reads and a mismatched brokerage were denied. The local Chrome check covered 1440 × 1000, 900 × 1200, and 390 × 844, keyboard focus, the filtered empty state, and independent role navigation. [Design evidence](brand-ux-review.md#owner-exceptions)

All 368 tests, lint, typecheck, the production build, and both Worker rehearsals passed. All 44 staged assets matched twice. The public landing, Product, and Demo returned HTTP 200 after promotion, and Product and Demo showed the new Exceptions copy. Provider activity remained simulated. The UWM stage adapter rejects DSCR and bank statement requests before calling the provider. Explicit demo mode still returns sample results for both programs.

## Staff handoff draft recovery

On November 10, 2026, Worker `64ac294e-e727-4c16-974c-cf5f16e9f5c1` from `94afafb` showed **Next with · Brokerage admin** when the fictional owner opened Rowan from Exceptions. The hosted check opened the exact handoff, focused it, and displayed the reviewed 1003 and accepted documents. The public landing, Product, and Demo returned HTTP 200, and Product and Demo described the release. All 44 staged assets matched the build twice.

In three independent local Chrome sessions, the owner sent Avery's file while the LO had a draft open. The drawer showed the new state and retained the draft. The processor accepted without a new note, saw the sender's instruction, and returned the file with a note. The LO saw the return, reviewed the current handoff, and resent with the original draft. Desktop, portrait, and touch phone views fit, and the draft review button returned keyboard focus to the note. [Design evidence](brand-ux-review.md#staff-handoff)

The built Worker denied saves against a stale 1003 and a stale handoff, preserved an independent closing checklist edit, and returned the exact mock condition when it placed funding on hold. The local writes each took 7 ms, and the first queue reads after acknowledgment took 3 ms for LO to processor and 4 ms for the return. Those times are local requests with immediate reads. Browser polling and hosted network latency are separate. All 368 tests, source lint, typecheck, the production build, and the working-day and concurrency rehearsals passed. Provider activity remained simulated.

## Processing attention and working-day acceptance

On November 10, 2026, Worker `3da9248a-264f-4449-a9cd-6c0539a5205a` from `6653545` shipped the Processing sidebar badge. The signed-in fictional owner on OrbitLOS.com opened the updated team Processing queue, which correctly showed an empty incoming list and no badge. Today still showed one item and Exceptions showed two. The hosted check read the fictional workspace. The landing, Product, and Demo returned HTTP 200, both public feature descriptions matched, and all 44 staged assets matched twice.

Separate local Chrome sessions tested the owner at 1440 × 1000, the LO at 900 × 1200, and the processor at 390 × 844 with touch input. The owner's badge returned from Ready to accept to the incoming queue. On the phone, the menu indicated waiting work, the badge opened the exact handoff, and the count cleared after acceptance and return. The LO then opened the return and its note from Today. The Processing heading fit on one line on the phone after moving the timestamp below it. [Design evidence](brand-ux-review.md#processing-attention)

The local built Worker took the same fictional file from imported lead and submitted 1003 through review, mock pricing, original-receipt recovery, two-way staff handoff, mock conditions, closing, funding and post-funding follow-up. It blocked a second submission during uncertainty, denied an unrelated LO's recovery attempt, and reconciled repeated recovery to the same receipt and one lender file. The send and return writes took 9 ms and 7 ms, with the first queue read taking 4 ms in each direction. These are immediate local requests, separate from browser polling and network latency.

All 369 tests, source lint, typecheck, production build, and working-day and concurrency rehearsals passed. The EQ tests used synthetic responses. Hosted provider activity remained simulated. [Lender sandbox acceptance](lender-sandbox-acceptance.md)

## Manual lender terms through closing

On November 10, 2026, Worker `ed579dbd-b5b4-418a-a4af-4605c8685ebe` from `c0d6440` showed the existing fictional Harbor acknowledgment as Ready in the live file preflight. The evidence named file `HARBOR-QA-FILE-201`, quote `HARBOR-DEMO-201` and its 5.625% note rate. The hosted check read the isolated fictional workspace. The public landing, Product, and Demo returned HTTP 200, both feature descriptions matched, and all 44 staged assets matched the build twice.

The built Worker completed a conventional purchase and a no-cash-out refinance through the fictional registration profile, reviewed 1003, selected quote, manual acknowledgment, evidence delivery, clearance, closing and funding. The XML matched the loan purpose and rate and included the refinance cash-out determination for the refinance. Changing the selection before closing required the revised export and acknowledgment. Changing the selection after closing blocked funding until the current terms were acknowledged. Re-acknowledgment reused the original lender file and retained the conditions.

Playwright checked the owner's desktop and the LO's portrait and phone views. The LO opened the required export from Closing, downloaded the revised XML with a 6.125% purchase rate, recorded the acknowledgment and saw Clear to Close become available. The phone check led to a scroll offset that keeps the export heading visible below the sticky drawer header. [Design evidence](brand-ux-review.md#manual-lender-closing)

All 369 tests, source lint, typecheck, the production build, and the working-day and concurrency rehearsals passed. The MISMO checks used fictional lender requirements and synthetic files. Hosted provider activity remained simulated.

## Manual lender rejection and mock refinance

On November 10, 2026, Worker `dad1bf20-4e03-4b5d-bd1b-595525d1b266` from `f765c5d` took 100% of traffic. The landing, Product and Demo pages returned HTTP 200 with the updated workflow copy on Product and Demo. All 44 staged assets matched the build twice. In the hosted fictional workspaces, the LO could open Incoming loan work and the owner could select **Manual lender responses** and see its empty state. The rejection and funding walkthroughs used the local built Worker.

The built Worker recorded a rejection against the current prepared MISMO export, denied a stale export and another LO, and replayed the same event without a duplicate. The borrower used the existing link, saw their correction instructions, and submitted the update. The LO's Today and owner Exceptions tracked the response until staff resubmitted the earlier review with the corrected evidence, an owner approved it, and the revised file was acknowledged. Closing stayed blocked during recovery. The first linked lender file appeared at acknowledgment.

A separate fictional conventional no-cash-out refinance used a mock quote, second review, original receipt recovery, and two borrower documents. Mock UWM cleared the conditions, then the LO marked Clear to Close, recorded closing and recorded funding.

Playwright checked the rejection on a 900 × 1200 portrait desktop and a 390 × 844 phone, including focus on a missing field. A separate phone context checked borrower privacy. The 1440 × 1000 owner session opened the exact correction and restored focus and the filter after closing the loan. The LO found the case in Today. Impeccable's source scan covered the three changed workflow components. Typecheck, source lint, all 369 tests, the 32-stage working-day rehearsal, concurrency and the production build passed. [Design evidence](brand-ux-review.md#manual-lender-rejection)

## Joint borrower lender responses

On November 10, 2026, Worker `410db320-dd40-4817-bd68-f9eb91637ef9` from `00e4243` took 100% of traffic. The landing, Product and Demo returned HTTP 200, both public pages carried the new joint copy, and 45 staged assets matched twice.

The hosted Role Handoff QA rehearsal created one fictional joint loan. The two private links submitted separate portions. Staff prepared the joint export and recorded a fictional rejection for the co-borrower. The primary stayed submitted, and the co-borrower alone received correction instructions. The owner opened the exact joint portion from Exceptions. After the co-borrower resubmitted, staff used **Refresh loan**, reviewed the current file, prepared the revised export and recorded the fictional acknowledgment. The exception cleared. The XML contents and the later post-acknowledgment return to the primary borrower were verified locally.

The built Worker exercised a conventional joint purchase. The primary and co-borrower submitted independently, and an unacknowledged fictional lender rejection reopened only the co-borrower's portion. The original link was revoked and replaced in the test, the corrected phone appeared on the new 1003, and the primary answers stayed intact. Staff reviewed the combined application, the owner approved the revised evidence, and a fictional lender package carried the current MISMO and one approved sample PDF.

After initial lender acknowledgment, a return reopened only the primary borrower. It invalidated the earlier package, retained the co-borrower's answers and lender condition, and required another reviewed export. The revised XML included both corrected phone numbers. Acknowledgment reused the lender file and cleared the response queue. Retries preserved one response event, and a changed recipient on the same event was rejected. A locked Clear to Close application required the admin override before reopening and changing stage.

Playwright exercised keyboard use in the 1440 × 1000 owner and 900 × 1200 LO views and touched the 390 × 844 borrower forms. The browser verified explicit recipient selection, private correction instructions, save and resume, the corrected 1003's return to Today, and focus and filter restoration in Exceptions. Impeccable scanned four changed components. All 370 tests, lint, typecheck, the production build, and working-day and concurrency rehearsals passed. [Design evidence](brand-ux-review.md#joint-borrower-corrections)

## Non-QM pricing fallback

On November 10, 2026, Worker `4b23cd6e-876a-4950-beb1-0cb3a3bd3c54` from `544dc2a` took 100% of traffic. The landing, Product and Demo returned HTTP 200, the updated Product and Demo copy matched, and all 45 staged assets matched the build twice.

The hosted Role Handoff QA rehearsal submitted and reviewed one fictional investment-property refinance. The workspace saved unsupported outcomes for DSCR and bank statement, compared the bank statement estimate with a selected manual DSCR quote, and chose the DSCR quote again from the comparison. Staff prepared the sample MISMO and recorded a fictional lender acknowledgment. Owner Activity showed the unsupported check. Provider activity remained simulated.

The local Worker preserved the exact DSCR and bank statement inputs and the simulated unsupported outcome. It refused a mock submission from an unsupported scenario or a selected Non-QM estimate. A manual offer added to the saved DSCR inputs produced a sample MISMO export at the chosen rate. A what-if occupancy could be saved for comparison, and the handoff refused that quote against the reviewed file. After the borrower corrected the requested amount, staff could see earlier terms but could only hand off a fresh manual offer on the current revision. The revised bank statement offer exported a $340,000 note at 7.500%, received a fictional manual acknowledgment, and left the unsupported result in owner-visible activity.

The stage fixture saved an unsupported result and a manual offer with zero provider requests. The MISMO sample carries the standard loan and quote terms. Non-QM income calculations and assumptions stay on the pricing scenario until receiving-lender field mapping is verified.

Playwright checked the LO at 900 × 1200 and 390 × 844 and the owner at 1440 × 1000. It reopened the prior DSCR coverage check after bank statement pricing, entered a manual offer, compared the chosen scenarios, and opened the matching export. Keyboard scrolling stayed inside the comparison and the wider lender inputs fit on the phone. All 371 tests, lint, typecheck, the production build, and the working-day and concurrency rehearsals passed. [Design evidence](brand-ux-review.md#non-qm-manual-pricing)

## Shared inbound review and missed calls

On November 10, 2026, Worker `1e2d88b8-3311-46b9-9f98-0ad2a84015cb` from `8c28037` took 100% of traffic after all 45 staged assets matched twice. The live Product and Demo pages returned 200 with the new copy. In the hosted fictional Role Handoff QA workspace, the admin matched a simulated missed call to the existing QA campaign lead. Today showed **Missed call** for that assigned lead and opened the original entry in its conversation.

The local Worker exercised separate admin, assigned LO, unrelated LO and processor sessions. A missed call kept the original thread and promised callback through reassignment and conversion. An attached email reply stopped automated outreach and kept the promised callback. SQLite coverage verified legacy receipts, repeat source events, role scope, and opt-out enforcement when logging outreach. Phone, email and text remained simulated.

The Impeccable source scan and Playwright checks covered the changed screens. At 1440 × 900, 900 × 1200, and 390 × 844, the owner and LO could reach the primary action without horizontal scrolling. The mobile actions measured 44 px, and keyboard activation and focus return passed. All 372 tests, lint, typecheck, the production build, and the working-day and concurrency rehearsals passed. [Design evidence](brand-ux-review.md#inbound-review-and-today)

## Referral and past-client source acceptance

On November 10, 2026, Worker `05db9909-ccbd-4582-99b6-0642e4ac9053` from `8239802` took 100% of traffic after all 45 staged assets matched twice. The live Product and Demo pages returned 200 with the updated copy. In the fictional Role Handoff QA workspace, the owner enrolled one borrower in a dedicated QA campaign, saw **Campaign lead in progress** on the original loan, then converted the claimed lead into a refinance draft. Returning clients displayed the campaign and actions for both loans. The funded realtor count opened an existing fictional purchase.

The local built Worker covered the full lifecycle. A realtor submitted a referral and saw its funded purchase in the partner portal. The assigned LO logged outreach, converted the lead, and worked the application through simulated UWM funding. The owner enrolled that borrower in a past-client campaign and linked a simulated email reply. The LO took the first step from Today, saw the reply, converted the campaign lead and funded the refinance. The owner could reconcile the purchase, refinance, campaign and original realtor through their respective reports. The second loan reused the existing borrower contact and left the original referral's funding credit intact. The exact original loan is saved at enrollment, so prior enrollments without a source link retain their existing history.

All 372 tests, lint, typecheck, the production build, the 34-stage working-day rehearsal and the concurrency rehearsal passed. Playwright verified the owner drilldowns at 1440 × 900, 900 × 1200 and 390 × 844, and the invited LO reopened the existing refinance from Past Clients. The smallest layout kept horizontal scrolling inside the tables and the two file actions measured 44 px. [Design evidence](brand-ux-review.md#referral-and-returning-client-reporting)

Follow-up Worker `20f87d46-186b-43eb-9733-cce8245b22d0` from `369a9a7` clarified the linked-contact label seen during the hosted rehearsal. All 45 staged assets matched twice. The live asset served the revised wording and the public Product and Demo pages retained the release copy.

## CRM migration and channel restrictions

On November 10, 2026, Worker `00dd1060-4bb2-45c7-9840-4a974932920a` from `487f284` took 100% of traffic after all 45 staged assets matched twice. In the live fictional Role Handoff QA workspace, the owner mapped Do Not Call and Email Opt Out, saw both blocks in preview, imported one sample contact and reopened the receipt. The exact contact showed calls and email blocked and texts allowed. The live Product and Demo pages returned 200 with the updated migration copy.

The working-day rehearsal transferred a representative Salesforce-style CRM set through Orbit's normalized CSV and numbered snapshot across two separate fictional brokerages. It retained the borrower and realtor relationship, mapped the former LO to the invited destination LO, preserved an open task and its deadline, and preserved both individual channel restrictions and a separate brokerage-wide opt-out. The receiving owner attached reviewed MISMO 3.4 mappings for two fictional loan files to the imported borrower contacts. The purchase and refinance remained drafts awaiting cutover review. Salesforce object CSV and the documented individual MISMO export flows informed the fixtures. [Salesforce data export](https://help.salesforce.com/s/articleView?id=exporting_data.htm&language=en_US&type=5) · [Salesforce contact fields](https://help.salesforce.com/s/articleView?id=sf.om_contact_fields.htm&language=en_US&type=5) · [ARIVE loan file export](https://support.arive.com/support/solutions/articles/61000318233-common-new-user-questions) · [LendingPad loan file export](https://kb.lendingpad.com/how-to-export-a-file)

SQLite tests verified that an import preserves existing blocks, rejects stale previews, carries blocks through lead conversion, and shows later preference changes against the original receipt. Import undo keeps records with active contact restrictions. All 373 tests, lint, typecheck, the production build, the 35-stage working-day rehearsal and the concurrency rehearsal passed. Playwright checked preview focus, the live-style receipt, and 1440 × 900, 900 × 1200 and 390 × 844 layouts. [Design evidence](brand-ux-review.md#crm-migration-preferences)

## Processing work cutover

On November 10, 2026, Worker `f8a16d3f-e51b-490d-b572-46077c591ec2` from `0ad43ce` took 100% of traffic after 45 staged assets matched twice. The owner used the hosted fictional Role Handoff QA workspace to import a contact, attach its MISMO draft, record its source inventory, and assign the existing QA loan officer. The live restore created one pending document request and one manual lender condition. **Open restored work** opened the exact lender file. The separate processor session was exercised in the local rehearsal.

The built Worker rehearsal restored a pending Photo ID request and an open income condition on one linked fictional MISMO draft. Orbit retained the manual lender reference, status and document due date. Prior accepted documents, delivery history and UWM inventory stayed in the comparison for review. The restore kept the 1003 in draft and the pipeline stage intact. The assigned LO set the stage to Processing after reviewing the file. The assigned processor opened the exact condition from Processing, requested a pay stub and saw the queue change to borrower follow-up.

The preview rejected a change in assignment and two simultaneous submissions produced one audited restore. The other fictional brokerage and the non-admin account were denied access to the restore. All 373 tests, lint, typecheck, the production build, and the working-day and concurrency rehearsals passed. [Design evidence](brand-ux-review.md#processing-work-cutover)

Follow-up Worker `bcb90a92-fc8c-4bc5-9049-cca4290d3d39` from `64b930c` corrected the singular restore receipt shown during the hosted check. Playwright verified the exact wording and keyboard focus, then opened the exact lender condition from a separate processor session. All 45 staged assets matched twice and the live Product and Demo pages returned 200 with the release copy.

## Cutover revision and receipt history

On November 10, 2026, Worker `4b2072d2-37d2-42af-8a31-9738c0bd262f` from `3dcee1f` took 100% of traffic after 45 staged assets matched twice. The live Product and Demo pages returned 200 with the updated text. In the fictional Role Handoff QA workspace, the owner saved a sample inventory against the existing linked draft. The document comparison showed source revision 2 and Orbit revision 0. The lender comparison showed an unavailable prior receipt while both condition statuses were open. **Reconciled** was disabled for that file review.

In the built Worker rehearsal, the assigned processor accepted and delivered a fictional pay stub, requested a replacement, delivered the new accepted revision and recorded manual clearance. The owner compared both accepted checklist revisions and the lender's prior and current receipts. An unavailable prior receipt blocked reconciliation. After replacing the source inventory with the verified references, the old fingerprint was rejected and the current document and lender comparisons could be signed off. The other brokerage and non-admin users remained scoped to their own access.

The comparison accepts optional metadata alongside the earlier inventory fields. Reviewers can inspect the exact current and accepted revisions, current and prior receipts and clearance references. No files are transferred in this inventory. Tests covered legacy snapshots, equivalent clearance times with different offsets, and a mock receipt that becomes prior when its document is replaced. All 375 tests, lint, typecheck, the production build, and the working-day, concurrency and local recovery rehearsals passed. [Design evidence](brand-ux-review.md#cutover-revision-and-receipt-history)

## Cutover recovery and handoff reference

On November 10, 2026, Worker `15612f7d-b942-49be-a710-65446dfcaf53` from `a6225e8` took 100% of traffic after all 45 staged assets matched twice. The live Product and Demo pages returned 200 with the updated copy. The owner downloaded the report from the fictional Role Handoff QA workspace. The downloaded HTML included the review reference and excluded the raw lender receipt and borrower email. The restore itself ran locally against the built Worker.

The two-brokerage local restore recovered the linked MISMO draft, two accepted revisions, prior and current lender receipts, clearance and both original sign-offs. The downloaded handoff matched the original review reference. The drill preserved the second brokerage's later change and the directory's link and staff revocations. It checked the later journaled sign-off against current evidence and recorded it as a new review. A repeat after restart kept the same new review. Reopening the condition made the sign-off stale and blocked reuse of the former evidence. [Recovery procedure and boundary](workspace-recovery.md)

The handoff identifies the source coverage and recorded reviews with a stable reference while keeping review notes and the file evidence in Orbit. All 376 tests, lint, typecheck, the production build, and the working-day, concurrency and extended recovery rehearsals passed. [Design evidence](brand-ux-review.md#cutover-handoff-review-reference)

## Managed branches and intake routing candidate

In the local built Worker, the owner created a branch, assigned an active and an invited LO, and reused the branch in General and Purchase ZIP rules. After the invite activated, the owner changed the branch default. New leads used the current branch revision while older leads retained their original receipts. A revoked and reinvited owner fell back until the owner confirmed a current branch assignment. Archive, reactivate, stale writes, and separate brokerage and LO scope were exercised. An in-flight intake with an outdated branch revision was rejected before lead creation.

All 377 tests, lint, typecheck, the production build, and the 36-stage working-day, concurrency and recovery rehearsals passed. The branch candidate is separate from the UWM deployment. Branch membership controls intake routing and existing loan assignments continue to determine file access. The candidate includes updated public Product and Demo copy for its release. [Design evidence](brand-ux-review.md#managed-branches-and-intake-routing)

On November 10, the combined source `59c01dd` was promoted to Worker `ac12efec-9000-4df1-9ed6-6575e43f8ebe` after merging the verified UWM stage release. All 385 tests, lint, typecheck, build, the working-day run, concurrency and recovery passed. The pricing test now expects the deployed manual redirect mode and checks that a redirect response fails. All 46 staged assets matched twice. After promotion, the public landing, Product, Demo and login pages returned HTTP 200 and the branch copy appeared on Product and Demo. The signed-in fictional admin opened Team → Branches and verified UWM stage authentication with four disclosure groups. Insights access and lender writes remain separate onboarding work. The release also improves pipeline search contrast at phone, portrait and desktop widths. [Design evidence](brand-ux-review.md#managed-branches-and-intake-routing)

## Operator cutover and workspace discovery

The owner browser rehearsal transferred three CRM records from a fictional source to a second brokerage, mapped the source LO to the destination owner, and compared the re-export for the retained call restriction and open task. The source fixture included an orphan task already reviewed and skipped. The owner downloaded the original MISMO XML and the new file inventory, created a destination draft on the imported borrower contact, saved the inventory, and opened the restored condition and document request from the receipt. The browser used the actual files throughout. The inventory carries checklist, lender and funding metadata. PDFs are transferred separately.

The 44-stage working-day run verified both accepted document revisions, current and prior lender receipts and clearance, as well as LO, processor and cross-brokerage download denial. All 505 tests, typecheck, lint and the production build passed.

The signed-in operational brokerage now points owners to Workspaces for the fictional Compliance pilot. The Conversations view explains how to start when the active queue is empty. Hosted Role Handoff QA showed Compliance research, loan retention, a populated conversation outcome form, and a version 1 JSON downloaded from a fictional loan. Provider configuration was unchanged. [Design evidence](brand-ux-review.md#conversation-and-compliance-discoverability-and-cutover-inventory)

Worker `14a6cd34-a8dc-4f5b-98eb-8b5cd39cd8da` from `89b9094` serves 100 percent of traffic. All 1,244 assets matched on two staged passes and two ordinary live passes after propagation.

## Loan details and workspace continuity

Source `783e5ee` passed 505 tests, lint, typecheck, the production build and the 45-stage working-day rehearsal. Playwright verified the LO review and processor handoff, direct document navigation, sample acceptance and both directions of workspace switching in a built fictional fixture. The operational fallback is still used on the first generic visit. An intentional, authenticated workspace navigation remembers the selected brokerage for that account in the same browser. Explicitly scoped URLs, access checks and separate brokerage records continue to apply. [Design evidence](brand-ux-review.md#loan-details-and-workspace-continuity)

Worker `bae97d27-51c6-46d9-aa4f-3c911d8f9520` serves 100 percent of traffic. All 1,295 browser assets matched on two consecutive staged and live passes. Signed-in production entry resolved to the operational brokerage and stayed there on reload. In Role Handoff QA, opening a fictional loan from its conversation focused the exact Communications section below the visible borrower, stage and next action. Cross-workspace switching and the full LO and processor walkthrough were verified in the built local fixture.

## Staff onboarding and branch routing

In the built Worker, the owner created a fictional pilot through Team → Workspaces, saved LO and Processor invitations, and copied the scoped link. The invited LO reached sign-in for the requested brokerage. After the fixture activated the two identities, the owner refreshed staff inside the open branch editor, kept the branch name and staff selections, and picked the newly active LO as default. A canceled pending invitation returned the access-unavailable page to that account.

The owner opened website routing from the branch screen, previewed and published a ZIP prefix. The borrower submitted the published quote form from a separate unauthenticated context. The assigned LO found the request in Today → Next 7 days and opened the prefilled 1003. The owner assigned the loan to the processor, whose separate session opened Processing and showed the assigned file. The directory fixture stood in for Google OAuth. No email or provider action was sent. All 505 tests, typecheck, lint, production build, and the 45-stage working-day rehearsal passed. [Design evidence](brand-ux-review.md#staff-onboarding-and-branch-routing)

Worker `5bdbb587-e074-42ee-bb36-14d135911b2a` serves 100 percent of traffic. All 1,346 browser assets matched on two consecutive staged and live passes. The hosted pilot verified Staff access refresh and a branch draft that kept its name through roster refresh and focused the receipt. The draft was canceled. Workspace creation, invitation activation, ZIP publication, and first-day staff actions were exercised in the isolated built Worker.

## Workspace continuity across releases

Orbit saves the default brokerage to the staff account. Team → Workspaces records a deliberate switch or sets the current brokerage as the default. Shared links and guided demos open their scoped workspace without replacing that choice. Existing browser preferences remain readable. If a remembered brokerage loses access, Orbit shows the denial and offers a deliberate return to an available brokerage.

Before a production promotion, open the generic workspace URL in a signed-in browser and record the brokerage shown. After promotion, revisit the same generic URL in that session and confirm the brokerage matches. Open a separate fictional workspace by scoped URL, return to generic entry, and confirm the same result. In the built fixture, also verify that a keyboard switch persists through reload and a new tab, and that another account in the same browser retains its own preference.

Source `7eeca78` saves the first workspace selected by normal generic entry to the staff account. A fresh authenticated session without the workspace cookie returns there. The fictional rehearsal verifies the first entry with cross-site sign-in redirect headers, a new session, unchanged explicit choices, and no preference writes from prefetches, named links, or guides. All 509 tests and 45 rehearsal stages passed along with lint, typecheck, and the production build.

The existing signed-in Chrome session resolved the same Orbit demo brokerage before and after promotion to Worker `53666ca8-f086-48b3-902f-75013a9c8f04`. All 23 bindings matched the previous release. The production check used the existing session and the fresh-session case used the fictional fixture.

Source `52ef808` passed 505 tests, typecheck, lint, the production build and all 45 working-day stages. The browser checks covered the populated switcher at 1440, 900 and 390 px. The working-day rehearsal also checked legacy preference compatibility, account isolation, prefetch behavior and revocation. Production Worker `f203b811-1ce3-4e0c-8d48-67aa4c84a830` preserved all 23 bindings. Signed-in generic entry returned to OrbitLOS Production before and after promotion and after opening a fictional workspace’s maintenance page. [Design evidence](brand-ux-review.md#workspace-switcher-and-recovery-resume)

## Save pilot comparisons one run at a time

Source `367ad5a` adds a first-run save, a matching-run action, a confirmed discard, and a place to record external steps and blockers. A blocked result retains its notes and measured values. The comparison withholds differences if either workflow did not reach the agreed finish. Existing pairs remain readable, and additive storage keeps new records separate from legacy release readers.

The built Worker passed all 505 tests, typecheck, lint, and the 45-stage working-day rehearsal. The populated browser fixture included a legacy pair, a saved first run, a completed comparison, and a blocked case. It exercised an interrupted response, safe retry, reload, discard, keyboard focus, an invited LO, and an independent brokerage. The recorded values are fictional. [Design and browser evidence](brand-ux-review.md#paired-pilot-comparisons)

Production Worker `579fd02d-e36a-4aff-b08d-c3ec2a4a96e2` serves all traffic. All 23 bindings match the prior release. The updated public Demo copy, Login and Product pages, sign-in redirect, and unauthenticated Team write denial were checked against staged and live routing. Work settings did not allow use of the signed-in browser for this release. Role-based functional acceptance used the isolated built Worker. Provider settings stayed as configured, and the rehearsal used simulated actions.
`1,407` browser assets matched the build on both staged and both live passes.

## Redacted pilot support report

Source `d39a8a2` adds a report in Team and Workspace maintenance for active pilot admins. The owner can preview saved processing handoffs, lender requests and operations, and maintenance state while the pilot is open or paused. The versioned JSON includes only the summary and its audit reference. A changed preview requires a refresh. Separate request and operation classifications keep a completed acknowledgement from inflating the count awaiting a lender outcome.

The built Worker passed 506 tests, lint, typecheck, and the 45-stage working-day rehearsal. The isolated browser fixture checked three widths, a paused download after an open preview became stale, and the exact access history entry. It denied LO, cross-origin, and cross-brokerage requests. The downloaded bytes matched the refreshed summary and contained no fixture names, lender references, or payloads. [Design and acceptance evidence](brand-ux-review.md#pilot-support-report)

Worker `0a71b965-d872-40a1-998f-b3f516d6d558` was promoted at 100 percent with all 23 bindings preserved. The signed-out smoke covered the updated Demo copy, login and product routes, the sign-in redirect for the report preview, and denial of unauthenticated exports. Work settings prevented signed-in production browser acceptance. The fictional fixture used stored synthetic outcomes and no provider calls.
All 1,413 browser assets matched on both staged and both live passes.

## Account workspace preference and support report work

Source `bac372f` saves each staff account's explicit workspace selection in the shared directory. Existing browser preferences are carried forward on an intentional daily entry. Plain brokerage and guide links leave the account default intact. Access is still checked against current membership, with an explicit recovery screen if access is lost. The preceding source `832d619` links support counts to exact processing, lender, and recovery work while keeping the export redacted.

The exact build passed 506 tests, lint, typecheck, the 45-stage working-day rehearsal and the populated fictional browser scenarios. These covered a new authenticated session without a preference cookie, cross-account isolation, refresh, named workspace links, revoked access, and support report drilldown and return. [Design and acceptance evidence](brand-ux-review.md#account-workspace-preference-and-support-report-work)

Production Worker `0e6d1bcd-c9f1-4faf-9c6d-1ecbbb33895e` serves 100 percent of traffic with all 23 bindings preserved. Staged and live public and signed-out checks passed, including the Demo update and access denial for unauthenticated support work. Work settings prevented the signed-in production continuity check. No production workspace preferences were modified by verification.

All 1,420 browser assets matched on both staged and both live passes.

## Verify workspace choices after directory recovery

Source `2b75fc4` detects a restored default that points to a different brokerage even when the account count is unchanged. Version 3 evidence retains a digest and count. Earlier captures remain readable and do not verify workspace choices. The isolated Cloudflare drill found the discrepancy in an actual older restore, kept it visible after access repair, recovered the newer point and verified a fresh session routed to the intended workspace. It preserved both tenant databases and then removed the fixture Worker and bucket. [Hosted evidence](evidence/hosted-workspace-preference-recovery-2026-11-11.json)

The production build passed 507 tests, lint, typecheck and the 45-stage working day. Worker `7f40132d-057c-4c70-a0a5-b80a2bcaa81d` serves all traffic with the same 23 bindings. Eight staged and live checks covered the public update, sign-in routing, and unauthenticated operator and support endpoint denial. The Demo note was checked at three widths. Production was not paused or restored. Provider settings were preserved, and hosted recovery used fictional provider state.

All 1,420 browser assets matched on both staged and both live passes.

## Confirm an interrupted processor assignment

Application `6d62bf6` added a receipt that commits with the processor assignment and audit entry. An admin in the assignment editor can check the original request after a lost response. Checking reads the exact receipt and refreshes the current assignment. A newer processing revision remains in place. The API denies an LO or processor and limits receipt lookup to the original admin, loan, and brokerage.

The fictional browser run exercised a committed response loss, reload, failed read and retry, a request that never committed, and a later assignment. The built-Worker working day verified receipt matching, an exact repeat, role denial and independent brokerage scope. The full test suite has 508 passing tests. Lint, typecheck and production build passed. [Design and browser evidence](brand-ux-review.md#processor-assignment-receipt)

Worker `001fd528-7446-41ee-9e56-717081c08297` serves all traffic with the same 23 bindings. Nine staged and ordinary public and signed-out checks passed. The first ordinary Demo request immediately after promotion still returned earlier copy. It passed on retry. No signed-in production assignment was attempted. Provider settings stayed as configured, and the fictional flow used simulated lender operations.

All 1,425 browser assets matched on both staged and both live passes. The ordinary production browser also rendered the updated Demo copy.

## Confirm processor assignments from queues

Source `c533b35` extends the read-only assignment receipt to Processing → Unassigned and Playbooks → Ownership and deadlines. A single unresolved shortcut reference per workspace remains in the current browser tab. The original row can leave the list while the receipt stays available. The owner can check again or open the exact current assignment.

The built fictional browser walkthrough verified committed and missing responses, a failed receipt read, reload, cross-queue return, focus and a newer assignment. The receipt checks sent no additional assignment request. The 45-stage working day, 508 tests, lint, typecheck and production build passed. [Design and browser evidence](brand-ux-review.md#processor-assignment-checks-from-queues)

Worker `5db6bfa1-edb3-4808-8c2b-02e5860bccf4` serves all traffic with the same 23 bindings. Nine staged and ordinary public and signed-out checks passed. The public Demo note was verified at three widths. Signed-in assignment was verified in the local fictional fixture. No provider configuration or production loan data changed.

All 1,429 browser assets matched on both staged and both live passes. The ordinary production browser also rendered the queue recovery update.

## Protect processor access during checkpoint restore

Source `f31a825` compares processor grants and exact assignment receipts before allowing a checkpoint restore. The isolated hosted rehearsal rejected both unsafe variants and restored a routine handoff edit from a checkpoint that preserved access. After reviewed reopening, the assigned processor still saw the loan, the backup processor could not see it, and the original receipt remained saved. The second brokerage was unaffected. The test Worker, bucket and fixture credential were removed. [Hosted evidence](evidence/hosted-processor-restore-2026-11-11.json)

509 tests, lint, typecheck, the production build, and the 45-stage working day passed. The fictional browser preview showed both blockers and withheld the reserve action, then offered the review form for an eligible checkpoint. The Demo update was verified at 1440, 900 and 390 px. [Design evidence](brand-ux-review.md#processor-access-during-checkpoint-restore)

Worker `98234ec4-fd72-48e6-aa76-212e492112a9` serves all traffic with the same 23 bindings. Nine staged and live public and signed-out checks passed. The production workspace was not paused or restored, and provider configuration did not change.

All 1,431 browser assets matched on both staged and both live passes. The ordinary production browser rendered the updated Demo copy.

## Returning-client refinance across brokerage roles

Source `d103cf1` passed the 45-stage fictional working day, 509 tests, lint, typecheck and the production build. The returning-client case starts from a campaign reply and exercises a reviewed 1003, mock UWM submission, processor assignment, borrower document requests and mock clearance, private return to the LO and funding. A competing LO and unassigned processor were denied. The borrower links rejected requests against each other's documents, and both populated realtor portals kept their own referrals. [Workflow and pilot readiness audit](working-day-rehearsal.md#broker-pilot-readiness-audit)

Worker `2a362ca3-bedb-4c33-a3b4-6c14a07158a9` serves all traffic with all 23 bindings preserved. Nine public and signed-out smoke checks passed against staged and live routing. The public Demo walkthrough item was inspected at 1440, 900 and 390 px in staging and appeared through ordinary production routing. Signed-in workspace entry kept the same brokerage across promotion. Role acceptance used fictional data and simulated provider outcomes in the built Worker. [Design evidence](brand-ux-review.md#returning-client-refinance-walkthrough-item)

## Mock underwriting authorization and result recovery

Source `97b9dc9` passed 510 tests, lint, typecheck, the production build, and the 45-stage working-day rehearsal. A primary-only credit report did not qualify the joint file for AUS. The LO authorized all borrowers on the submitted 1003 and confirmed a missing mock credit response under its original reference. A missing DU result also recovered in place. A repeated check created no extra order, and a corrected 1003 required current credit while older results remained readable. The original and co-borrower portals omitted staff order evidence. The assigned processor could read results and could not place or confirm orders.

Worker `d24f5c48-bdc5-4a05-b376-3f3f09d9ef79` serves all traffic with the same 23 bindings. The release preserves the database schema and stores order evidence in existing records. Provider behavior was simulated in the fictional acceptance Worker. Public Demo and signed-out smoke checks passed in staging and production. A signed-in Chrome session kept its workspace across promotion. [Design and browser evidence](brand-ux-review.md#joint-mock-underwriting-and-original-result)

## Unconfirmed mock underwriting in Today

Source `bb7ddad` derives pending work from the original order. In the 45-stage fictional rehearsal, only the assigned LO's Today showed the order. An inconclusive lookup left the item pending. Acceptance and confirmed rejection cleared their own items. The automated fixture also checked assignment transfer, cursor paging, count reconciliation, and a new attempt only after confirmed failure. All 511 tests passed, with lint, typecheck, and the production build. [Sandbox evidence cases](lender-sandbox-acceptance.md#credit-and-aus-order-lookup)

Worker `ca0831e7-5d8f-4963-a9d4-a960493ddc13` serves all traffic with all 23 bindings preserved. The browser checked the built fictional flow at 1440, 900, and 390 px. Nine staged and live public and signed-out smoke checks passed. The public Demo update was inspected at those widths on staging and verified through ordinary production routing. Signed-in workspace entry kept the same brokerage across promotion. All underwriting outcomes exercised were simulated. [Design and browser evidence](brand-ux-review.md#unconfirmed-underwriting-orders-in-today)

## Mismatched mock underwriting response review

Source `c0f5515` passed 513 tests, lint, typecheck, the production build, and the 45-stage fictional working day. A reference conflict opened an admin exception and left the LO's original order pending. The classifier rejected mismatched brokerage, loan, order, service, revision, borrower count, and known reference fixtures. The rehearsal denied a non-admin review, recorded an authorized dismissal, and verified the LO could confirm the original reference in a separate lookup. Borrower portals omitted staff-only evidence. [Sandbox contract](lender-sandbox-acceptance.md#credit-and-aus-order-lookup)

Worker `598733ee-58a3-4658-b2bc-c7a209d58ca8` serves all traffic with the same 23 bindings. The signed-in Chrome session kept its workspace. Nine staged and live public and signed-out checks passed. The public Demo note was inspected at 1440, 900, and 390 px and confirmed through ordinary production routing. Role acceptance used the fictional Worker and no real provider lookups. [Design evidence](brand-ux-review.md#admin-review-of-a-mismatched-mock-underwriting-response)

## Mock underwriting lookup replay after restart

Release source `7b54f97` passed 513 tests, lint, typecheck, the production build, and the 45-stage fictional working day. The built Worker was restarted after an inconclusive credit lookup, after terminal confirmation, and after a reference conflict. A replay of the same lookup ID left activity counts unchanged. The earlier inconclusive and conflict checks could not advance the order on replay, and a delayed replay after confirmation did not restore a Today item. A new lookup confirmed the original order only after the required review. [Sandbox evidence cases](lender-sandbox-acceptance.md#credit-and-aus-order-lookup)

Worker `a393d9f7-9a4f-47ff-8456-84f61f4a35ca` serves all traffic with the same 23 bindings. Staged and live public and signed-out checks passed. A browser forced a lost HTTP response in the local fictional role fixture. The public Demo note was inspected at 1440, 900, and 390 px in staging and verified through ordinary production routing. Signed-in entry kept the same brokerage. All provider lookups used simulated outcomes. [Design and browser evidence](brand-ux-review.md#retry-after-a-lost-mock-underwriting-lookup-response)

## Operator CRM cutover and workspace continuity

Application source `b29b9e7` is live as Worker `3aa3b7fe-7599-4e3b-8c94-65d54cc1e22f` at 100 percent. The 23 complete bindings match the predecessor. The built source passed 513 tests, lint, typecheck, the production build and the 45-stage fictional working day. Ten staged and live public and signed-out checks passed.

In the fictional browser transfer, an owner exported a CRM file, imported it into a second brokerage, mapped a follow-up to the receiving LO, and opened its exact source from reconciliation with an older source pinned. The source-specific handoff HTML and re-export verified ownership, the call restriction, and the open task's lead link. The invited destination LO opened the task from Today. The source LO was denied destination access. The built working-day rehearsal separately exercised the MISMO and processor path. Both changes are described on the public Demo page. [Responsive evidence](brand-ux-review.md#cutover-checklist-source-selection)

The previous Team sample link reproduced a change to the account's sign-in default. The updated browser checks covered temporary sample visits, a scoped refresh, cookie-free return, an explicit sample default, and switching back to the operational workspace. The legacy sample switch link also preserved the default in the built rehearsal. Signed-in production opened the same brokerage before and after promotion, then returned to it after an ordinary temporary visit to a demo workspace. A previously saved sample default can be replaced from Team → Workspaces using **Make this my default**. [Switcher evidence](brand-ux-review.md#temporary-sample-workspace-visits)

## UWM import receipt recovery

Application source `c1d15cd` is live on Worker `9eaf337b-fd84-454d-b2cf-116e79b38d9a` at 100 percent. The previous Worker was `3aa3b7fe-7599-4e3b-8c94-65d54cc1e22f`. All 23 bindings were preserved. The release passed 518 tests, lint, typecheck, the namespaced Cloudflare build, and 46 local working-day stages.

The local built Worker received a synthetic authenticated callback for a registered transaction in a separate fictional lender workspace. The assigned LO saw the original uncertain commit settle. An unassigned LO was denied. Unauthorized and wrong-environment callbacks could not settle it. The same callback reused the original receipt, stayed out of the fallback inbox, and remained settled after a workspace restart. Request-level fixtures also covered a callback before the HTTP return, a verified failure, recovery of an already saved receipt, conflicting evidence, preservation of the sent revision after a newer 1003, and a subsequent explicit synthetic document action without a second commit.

Public and signed-out checks, including the lender file and webhook boundaries, passed in staging and on the ordinary production URL. UWM-originated stage acceptance remains open. The rehearsal and production smoke checks did not send a request to UWM. [Lender sandbox evidence](lender-sandbox-acceptance.md#activation-gate)

## Verified UWM loan routing

Application source `4c11f38` is live on Worker `c80376ee-d324-403b-be19-a07a0ca0c0f7` at 100 percent, replacing `9eaf337b-fd84-454d-b2cf-116e79b38d9a`. All 23 bindings match. The additive receipt column preserves existing stored receipts. The release passed 518 tests, lint, typecheck, the namespaced production build, and the 46-stage local working-day rehearsal.

The built Worker received an early synthetic import completion. An exact retry and a reformatted retry with the same lender timestamp both left the later committed request unresolved. Conditions and a ULAD file using the conflicting number went to the fictional reconciliation inbox. For the valid number, an interruption after reservation returned 503, a workspace restart kept the request unresolved, and a condition went to the inbox. Retrying the same completion settled the original request and kept its receipt through another restart. The verified number then routed a condition and a ULAD export to the owning brokerage. An unassigned LO was denied the file. The routing fixture also rejected a second transaction claiming the same number and a second number claiming the same transaction.

Public and signed-out checks, including the lender and webhook boundaries, passed on staged and ordinary production routing. A signed-in production browser opened its scoped workspace. All callback and restart evidence above comes from fictional data. No request was sent to UWM. Partner-originated stage validation and review of any conflicting legacy reservations remain open. [Callback handling](uwm-webhook-handoff.md#delivery-and-storage-behavior)

## UWM reconciliation inbox matching

Application source `d16f05e` is live on Worker `05d19d07-f3ac-40dd-aa2a-0d0dd7d19aff` at 100 percent. All 23 bindings match the previous Worker `c80376ee-d324-403b-be19-a07a0ca0c0f7`. The release passed 518 tests, lint, typecheck, the namespaced Cloudflare build, and 46 stages of the fictional working day.

A fictional admin of both workspaces matched a saved condition and a ULAD export after verification of the original import. Unknown routes and an admin lacking destination access were rejected. After the destination stored a condition receipt and the response was lost, concurrent retries retained one copy and marked the original entry Matched. The populated browser checked the ULAD path, keyboard focus, retry, refresh and destination read at desktop and phone sizes. Public browser checks and signed-out HTTP checks passed through staged and ordinary routing. No provider calls or live loan updates were made. Partner-originated stage delivery remains open. [UI acceptance](brand-ux-review.md#uwm-delivery-activity-receipt-matching)

## Closing checklist recovery

Built source `9cefc19` is live at 100 percent on Worker `4b6cbc85-709f-4864-ae4c-4c1ffa2944ae`. All 23 deployment bindings matched the previous version. The build passed 518 tests, lint, typecheck and the 47-stage fictional working day. The existing document due-date recovery also passed.

A fictional LO completed and reopened checklist items. With original item revisions restored in the local fixture, the pilot owner recovered both changes. The saved completion kept its original timestamp. A later checklist revision blocked replay. An LO could not initiate it, and repeated recovery reused the saved result without adding history. The browser exercised failure, preserved review reason, successful retry and reload at desktop, portrait and phone widths. The public Demo update and sign-in boundary passed through staged and ordinary production routing. The signed-in mutations ran in the local fictional pilot. [Recovery details and compatibility](workspace-recovery.md#closing-checklist-recovery--november-11-2026)

The subsequent isolated Cloudflare run `orbit-recovery-1104971d` restored a real named checkpoint on the published application build and verified both checklist replays after restart. The processor was denied recovery, a second brokerage was preserved, and the restored shared directory opened the recovered default for a new session. Both temporary environments were removed. Ordinary OrbitLOS.com smoke checks passed on the same published Worker. [Hosted restore evidence](evidence/hosted-closing-checklist-recovery-2026-11-11.json)

## Matched UWM receipt recovery after restore

Release source `eb74ceb` is live on Worker `d73fd102-0385-4efa-b6cc-a939ca783962` at 100 percent. All 23 binding definitions matched. The app passed 518 tests, lint, typecheck, and a 47-stage built working day. The staged and live public Demo and signed-out boundaries passed. A local fictional browser verified the new action, an interrupted check, retry, refreshed keyboard focus, and one exact destination copy at desktop and phone widths.

An isolated hosted drill on the same application source restored both the destination and the directory using Cloudflare bookmarks. The new check recovered a missing matched receipt even after another delivery reused the prior copy ID. It refused an inbox-only admin and refused the check during the older directory state without a verified route. Restoring the newer directory kept the verified route and original inbox receipt and allowed another check without duplication. The isolated Worker, bucket and token file were removed. Partner-originated stage delivery remains open. [Hosted evidence](evidence/hosted-uwm-match-recovery-2026-11-11.json)

## Managed branch routing during staff offboarding

Source `40eb72b` is live on Worker `1d7c7d98-0d21-43d0-afed-b88fac476949` at 100 percent, with the prior 23 binding definitions. All 518 tests, lint, typecheck, the namespaced build, and the 47-stage built working day passed. Public Demo, sign-in, and signed-out smoke passed through staged and ordinary live routing.

A fictional owner transferred the managed branch default to an eligible LO, transferred the departing LO’s open loan and leads, and removed access. A different branch default was sent to the shared inbox. An updated branch revision sent new ZIP intake to its replacement and left the earlier lead receipt intact. The replacement LO completed the original loan follow-up from Today with its deadline preserved. After urgent processor removal, the owner recovered the active file and the replacement processor accepted its original handoff note. Both departing sessions were denied entry. The owner browser checked failure, retry, filter, audit and keyboard return on desktop, portrait and phone. The signed-in rehearsal used a local fictional brokerage and no provider activity. [UI review](brand-ux-review.md#managed-branch-routing-during-staff-offboarding)

### November 11, 2026 internal compliance pilot

Published application `00498e79efca` as Worker `87d41312-c616-4615-b4e9-e4af0006e991`. Pilot owner opened Compliance, planned a monthly review from an obligation period, and drafted, reviewed and assigned fictional training. The LO opened the named assignment in Today, retried an assessment, and recorded completion. Processor personal access and the admin boundary were checked separately. Admin and employee writes used an isolated fictional workspace. Public Demo copy and signed-out entry were verified against the deployed build.

### Temporary visit during a workspace pause

Published Worker `2be8e8e9-e6c8-4680-b762-c77d4790a776`, app `c39629d`. A fictional pilot owner opened an alternate workspace from the pause screen, refreshed it, and opened the saved brokerage in a fresh session after reopening. The built rehearsal also verified the prior available-workspace URL and still covered revoked-access recovery. The public Demo copy and signed-out routes were checked staged and live. No production brokerage was paused for verification.

### Michigan application and disclosure timing pilot

Published app `e9aae63d8fb0` as Worker `8d95d30f-09ad-4ee1-bc9b-42c7d855ceb8`. The fictional owner corrected a receipt, the LO recorded the replacement and disclosure evidence, and the processor reviewed the timing without an edit control. The public Demo now describes the fictional Michigan workflow. No lender delivery occurred.

### Michigan intent and fee timing pilot

Published app `059280d5fa49` as Worker `b5097862-0963-4ffb-9539-5c3d7f366844`. The fictional owner and LO linked an intent to its Loan Estimate receipt, recorded fee activity, reviewed early timing and an unlinked credit report fee, and recovered a stale draft. Withdrawing the original receipt reopened the linked fee review. The assigned processor saw the result without edit controls. No fees were collected and no provider actions occurred. The public Demo was checked staged and live.

### Invited staff email-code sign-in

App `4684a5e1c7f7` serves production on Worker `4d051228-350f-4c86-a1a0-94c6afadc1aa`. The first staged code request returned 503 against the earlier directory. Compatibility source `35bd770` and Worker `12345564-6c08-44d8-94fa-28a5342f56d5` installed the new directory methods with email held. The final stage and ordinary production passed the public sign-in choice, uninvited request, Demo copy, and signed-out workspace checks. The 23 prior bindings matched. The added STAFF_EMAIL binding restricts sending to login@orbitlos.com.

The isolated browser rehearsal verified simulated delivery, exact invited email, wrong-code recovery, scoped Processor activation, and sign-out. The unit tests checked saved defaults, unrelated pending invites, revoked or expired codes, method-separated sessions, and sign-in reset after directory recovery. Delivery to an actual invited inbox remains unverified.

### Shared processor workspace visits

Worker `7fd37cca-2941-482f-a334-d243d97d95b5` serves application `3e0a68053ecb`. A fictional Processor opened one assigned file in each of two brokerages, with the unassigned file absent from Processing. A scoped visit and refresh preserved the original default, and the explicit default action changed it. The built rehearsal also verified cross-brokerage file denial and owner-only financial access. Staged and live verification checked the public Demo and signed-out entry. The contract fee agreement and commercial partner rehearsal remain separate.

### Original disclosure fee comparison pilot

Worker `3ba79b71-c220-4dbe-9f23-c0efa5c131a5` serves app `5ba15236711f`. Fictional owner and LO entered original and closing snapshots, recorded an unobtained service, and reviewed individual and aggregate changes. The assigned processor reviewed the same exact versions. A withdrawn closing source invalidated the selected comparison, and an incomplete replacement with conflicting classification kept the result open. The public Demo and signed-out routes passed staged and live. No provider actions or production loan changes occurred.

### Michigan revised Loan Estimate review pilot

Worker `9bc9df67-c3d6-47e7-b5ca-d39f730c126e` serves app `3e6679d0d8f5`. Fictional owner and LO selected exact disclosure versions and two charges, recovered a stale save, and reviewed the proposed amounts and date evidence. The assigned processor saw the chronology, then saw proposed amounts removed when the revised snapshot was withdrawn. The original comparison remained available. Public Demo and signed-out routes passed staged and live. The existing signed-in desktop workspace reloaded into the same brokerage after publication. No provider actions or production loan changes occurred.

### Michigan refund and corrected Closing Disclosure evidence

Worker `49c96af9-270a-4478-b13b-d6dcf701db48` serves app `f24e0c333654`. A fictional owner recorded and reviewed a corrected disclosure and the LO recorded the linked refund after a stale-save retry. The assigned processor reviewed the original and restarted dates, missing receipt and separately recorded refund and disclosure dates. Withdrawing the closing snapshot preserved refund timing and removed the amount comparison. Withdrawing the corrected send reopened its check. The processor reopened the file after reload. Public Demo and signed-out routes passed staged and live. The signed-in desktop reloaded into the same brokerage. No provider actions or production loan changes occurred.

### FV7 saved quarter evidence workpaper

Worker `02fd8b07-1849-4469-a5ee-3585f768f1a0` serves app `9a71b4eb0f20`. A fictional owner selected the earlier of two closed quarter versions, downloaded an exact-evidence template, corrected invalid JSON, and verified a checksum error on the other version. The matching version produced direct and third-party results, a state filter, loan facts drilldown with return focus, and a versioned workpaper download. A modified prior balance remained open for review. Hosted public Demo and signed-out routes passed. No provider actions or filing occurred.

### Saved FV7 workpaper history

Worker `1f6fb9e7-dd3d-43ed-af10-ac7a6a496f1c` serves app `52d4a57a0333`. The browser dropped a fictional owner’s successful save response and retried to the same receipt. A second evidence file saved a separate result with a difference. After reload the owner reopened the earlier review v1 workpaper while review v2 was current, recovered the exact uploaded evidence bytes and saw the original totals. Tests covered access, pagination and corrupted evidence. Public Demo and signed-out routes passed. No filing or provider action occurred.

### Guided FV7 evidence entry

Worker `9cdbc694-af00-4c97-bb3d-f6c8f93a4b7f` serves app `9b6f744d1bcd`. A fictional owner selected review v1, entered reviewed prior balances for Michigan and Ohio, preserved inputs when switching state and visiting loan facts, corrected a missing dated change, and saved and reopened the reconciled result. A separate scope removal produced the correct signed adjustment while preserving the earlier workpaper. The public Demo and sign-in passed staged and live. No filing or provider action occurred.
