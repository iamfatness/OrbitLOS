# Fictional brokerage working-day rehearsal

Run `npm run build:cloudflare` and then `node scripts/workspace-working-day.mjs`. The built Worker runs on loopback with ephemeral storage. A fictional owner creates the pilot and invites two LOs and a processor. The script activates the invited identities and establishes separate local sessions in place of Google sign-in. The second LO participates in the shared campaign claim check. The primary LO, processor, and owner work the loan.

The JSON output records the write acknowledgment and first independent recipient queue read for each staff handoff. It checks that the item is absent before the write and visible with its exact note and revision on the first read afterward. These measurements cover the local Worker and exclude browser polling. [Paired hosted and local measurements](demo-rehearsal-log.md#paired-processor-rehearsal-from-the-tagged-demo).

## Observed workflow

| Actor | Action and verification |
| --- | --- |
| Owner | Imports a borrower, realtor, linked lead, and overdue callback. Enrolls the lead in a round-robin campaign. Imports additional leads to verify routing caps and overflow. Replaying that import produces no new leads. |
| Two invited LOs | Both read the same shared campaign lead before attempting to claim it concurrently. One becomes the owner and can log a call. The other receives a claim conflict and cannot log a call. The lead keeps its first-contact deadline, and replaying the winning claim creates no extra assignment event. |
| Invited LO | Opens the exact imported task from Today. Records a Connected call and completes the callback. Converts the lead and confirms that the original owner, realtor source, callback, and call note follow the file. The freed slot refills from the shared queue and the new first contact appears in Today at its original deadline. A retry returns the same application and creates no extra assignment event. |
| Borrower and LO | The borrower sees their name, email, phone, and ZIP already filled. They save, reopen, and submit the sample 1003. The LO reviews it, runs mock credit and DU, saves and shares a quote, and sends the reviewed revision with the selected quote to mock UWM. |
| Owner and processor | The owner assigns the file. The LO sends it to Processing. The processor sees it in the ready queue, accepts it, requests the two suggested documents, and accepts both samples with mock deliveries. A single mock check clears both conditions and creates the realtor draft. The processor returns the file with an internal note. |
| Invited LO and realtor | The original LO finds the return in Today and completes the handoff. The LO opens Review closing readiness and marks the file Clear to Close, completes a closing checklist item, and records closing and funding. The realtor portal shows the pipeline milestones without the internal note. |
| Invited LO | Records a post-funding check-in and sees its callback in Today. Starts a distinct refinance draft, reuses the original borrower contact, and safely reopens the same draft on retry. The processor cannot open the unassigned repeat file. |
| Invited LO | Places a lead with an open callback on hold and sees the next shared lead take the slot. Reactivation at capacity returns the held lead to Shared queue with the callback intact. Archiving the active lead refills the slot and closes its callback. Restoring it at capacity keeps that closed callback in history. Reactivation with available capacity retains the original owner. |
| Coverage LO | Records a fictional opt-out on a covered campaign callback. The source, a matching owned lead in another campaign, and a matching shared lead are suppressed. The two released slots refill with unrelated eligible leads at their original deadlines. The source records the call attempt, the matching callback closes without an attempt, and replay creates no new assignments. |

## Hosted callback verification

On `5212a59c-4719-4c5b-a5b0-b0ce8b127246`, the QA admin imported a fictional contact, lead, and callback. After enrolling the lead, Today opened the exact callback in Call Campaigns at its imported deadline. The operator logged a Connected call, completed the callback, and selected Start 1003 from the same campaign card. The borrower view showed the prefilled name and the loan timeline showed the original Connected call and note. The product page described the updated workflow. The local three-role rehearsal, recovery check, typecheck, lint, and 138 automated tests passed for this slice.

## Hosted shared campaign queue

On `5fc78039-82d8-4ce9-80ed-a3c6ba075f3a`, the owner imported the fictional pair into brokerage `9a60cc9e-05b4-4762-919e-ee121cf1cc77`. Jordan appeared under Ready to call. Casey appeared under Shared queue with the first-contact deadline and a claim action. Claiming Casey focused the exact campaign card, retained the deadline, and moved the counts from one ready and one shared to two ready and zero shared. The owner then logged a fictional Connected call and opened Casey’s prefilled borrower view. The public product page describes both queues. The `design-pass/roles` evidence directory contains `hosted-shared-campaign-queue.png`.

The two-officer claim race ran against the built Worker in local preview. The script also rejected an admin’s attempt to log a call before assignment and a losing officer’s attempt after assignment. The campaign queue test excludes unassigned first calls and callbacks from callable work. All 227 tests, lint, typecheck, the production build, and the local working-day and recovery rehearsals passed.

## Hosted campaign slot refill

On `cee36421-ffca-4faf-a68e-410d65f0254e`, the fictional pilot `7466efff-dbdc-48cc-948d-e15211a6df14` imported one lead into an owned slot and left Casey in Shared queue. The owner logged a Connected outcome for Jordan and selected Start 1003. The conversion opened the prefilled application and routed Casey into Ready to call. The first-contact deadline stayed November 10, 2026, at 3:42 a.m. ET. Today opened Casey’s exact campaign card. The public product copy was verified and the sampled tab had no application errors. The `design-pass/roles` evidence directory contains `hosted-campaign-slot-refill.png`.

The local working-day rehearsal verified the same action from an invited LO. Automated cases also covered a rejected contact match, repeated conversion, a routing revision change, and a conversion that left the officer at their cap. Where two officers had space, one conversion routed at most one lead in round-robin order. An LO converting the file could not see the lead routed to another officer in the response. All 231 tests, lint, typecheck, the production build, and both local rehearsals passed.

## Hosted campaign hold and archive routing

In the fictional pilot `8f12d886-0165-4494-b746-bfa7cb34053e`, the owner logged a callback for Jordan and put the lead on hold on `0a5ad35e-7c51-41f9-be55-96a7d8f4dea6`. Casey took the only routing slot. Reactivating Jordan returned the lead to Shared queue and kept the callback due November 10, 2026, at 10:50 a.m. ET. The `design-pass/roles` evidence directory contains `hosted-campaign-reactivation-at-cap.png`.

On final release `acd051f4-dc1c-4815-ac5b-128b6f4e22a9`, the inline archive confirmation explained the effect on callbacks. Archiving Casey routed Jordan back to the same upcoming callback. Restoring Casey returned the lead to Shared queue and kept its archived callback closed. One old client bundle logged an error during the release switch. A fresh final-release tab verified both queues and the empty archive without console errors. The public product page reflects hold and archive refill. The evidence directory contains `hosted-campaign-restore-at-cap.png`.

All 231 tests, lint, typecheck, the production build, and both local rehearsals passed. The invited-LO rehearsal also verified that an already-held retry caused no additional refill, a repeated restore was rejected, and reactivation with a spare slot kept the same owner and callback.

## Hosted campaign opt-out refill

On `8d723380-12d0-411c-bba4-ffbe43c7caab`, the fictional brokerage `1bc861b6-227d-416c-96f2-4d939dac5142` started with Jordan assigned and Casey shared. The call form explained that an opt-out stops outreach on matching borrower records. The owner logged a callback and then recorded Jordan’s opt-out. Upcoming callbacks went from one to zero, Jordan’s call action disappeared, and Casey moved to Ready to call with the same November 10, 2026, 4:04 a.m. ET deadline. The public product copy was verified and the sampled browser tab logged no application errors. The `design-pass/roles` evidence directory contains `hosted-campaign-opt-out-refill.png`.

The local built Worker exercised a coverage opt-out that suppressed three matching records across two campaigns and filled two newly opened slots. It skipped an older shared record that matched the opt-out and left extra waiting work shared. The source callback recorded an attempt and the alias callback closed without one. Coverage replay and a subsequent matching contact opt-out made no additional assignments. An automated case verified that an opt-out leaving an officer at cap could not consume a pre-existing vacancy, then a later contact opt-out freed an actual slot. All 232 tests, lint, typecheck, the production build, and both local rehearsals passed.

On `884d6244-47f9-4fdf-842c-7ab018cb5716`, the owner selected a local two-row fictional CSV in Chrome and imported it into a fresh pilot. After Jordan’s callback and opt-out, the callback count returned to zero, Jordan had no call action, and Casey took the open slot with the same November 10, 2026, 4:14 a.m. ET deadline. The updated product page and campaign tab had no console errors in the sampled run. The `design-pass/roles` evidence directory contains `hosted-targeted-opt-out-refill.png`. All 233 tests, lint, typecheck, the production build, and both local rehearsals passed. The [local benchmark](workspace-baseline.md#campaign-opt-out-routing) records the narrower roster checks.

## Hosted campaign CSV and bulk assignment

On `657c6e1e-310f-4f5b-a65e-686412cedf8e`, the owner uploaded and previewed four fictional CSV rows. Round-robin routing assigned one lead and left three shared. The owner selected the three shared leads and assigned them in one save. Ready to call rose from one to four and Shared queue fell from three to zero without a refresh. All three leads kept their November 10, 2026, 4:24 a.m. ET first-contact deadline. The campaign tab had no sampled console errors, and the updated product copy was verified. The `design-pass/roles` evidence directory contains `hosted-campaign-bulk-assignment.png`.

Automated checks compared the scoped campaign updates with a fresh workspace, including manager reporting and the rehearsal checkpoint. Stale owner changes failed atomically, retries kept the same assignment state, and an LO could not claim a campaign lead that had since been held or opted out. All 235 tests, lint, typecheck, the production build, and both local rehearsals passed. The [local benchmark](workspace-baseline.md#campaign-csv-and-assignment-responses) records response sizes and timing boundaries.

## Hosted selected campaign refresh

On `14c3c758-4067-40fc-8234-e9e25e00fa79`, two signed-in owner tabs opened the same fictional campaign. One logged a requested callback for Jordan. In the other, Refresh queue kept Upcoming callbacks selected and displayed the original November 10, 2026, 10:32 a.m. ET deadline. The first tab logged Connected and started the 1003. Refresh queue in the second tab cleared the callback count, displayed the new loan under 1003s started, and opened the correct loan file. Neither tab logged a sampled application error. The updated product copy was verified. The `design-pass/roles` evidence directory contains `hosted-selected-campaign-refresh.png`.

The authenticated local rehearsal confirmed that the former LO lost access to a reassigned campaign, the owner saw its assignment and callback, and a processor could not read the queue. The converted and funded summaries matched the full loan file. All 236 tests, lint, typecheck, the production build, and both local rehearsals passed. The [local benchmark](workspace-baseline.md#selected-campaign-refresh) measures the selected response against the full workspace read.

## Hosted campaign entry and switching

On `95354994-3f13-4912-9fb0-05a602af9a58`, the owner opened the correct rehearsal importer from the Demo Guide and imported two leads. A second tab created a separate fictional campaign and imported three leads. Returning to Call Campaigns in the first tab discovered the new campaign and kept the prior selection. The owner switched to the new campaign, back to the rehearsal, then returned to the new campaign. The queue showed Morgan’s callback at its original November 10, 2026, 10:41 a.m. ET deadline. My campaign callbacks opened the exact card. Neither tab logged a sampled application error and the updated product copy was verified. The `design-pass/roles` evidence directory contains `hosted-campaign-navigation.png`.

The authenticated local rehearsal verified discovery after assignment and denied a processor. Automated coverage also removed a campaign after the LO lost access and verified that the admin picker returned eligible, unenrolled leads while excluding held and suppressed leads. All 237 tests, lint, typecheck, the production build, and both local rehearsals passed. The [local benchmark](workspace-baseline.md#entering-call-campaigns) measures the campaign entry response.

## Hosted staff entry and deferred Pipeline

On `d5614e26-79e9-43f0-b1a6-1ee02e33c08a`, an ordinary signed-in owner opened Today. Before opening Pipeline, workspace search found Jordan and opened the existing fictional 1003 loan. Pipeline then loaded its records on demand and displayed Jordan. Returning to Today showed Casey’s first-contact work. Opening the explicit campaign guide in a separate tab preserved the completed call and 1003 step. The live product copy was verified and neither tab logged a sampled application error. The `design-pass/roles` evidence directory contains `hosted-staff-entry-today.png`.

The authenticated local fixture checked all three roles, the scoped loan reader, brokerage isolation, and the explicit guide paths. The retention test verified that officer entry creates only that officer’s rate-watch and anniversary tasks and preserves custom templates. All 238 tests, lint, typecheck, the production build, and both local rehearsals passed. The [local benchmark](workspace-baseline.md#signed-in-workspace-entry) records initial HTML sizes.

## Hosted paged Pipeline

On `b67f23e8-2b35-4974-b2fd-d5e021e64915`, the owner opened Pipeline from Today in an isolated pilot with 13 fictional Lead-stage records. The board displayed 12 cards and the full count of 13. Search found the oldest loan before it was loaded in the lane. After clearing search, Load more showed the 13th card. In List view the Overdue filter showed no matches. The owner cleared it, searched for the oldest loan, and opened the first-contact workbench from its Next action. The 820 × 1180 viewport had no page-level horizontal overflow. The product copy was verified and the workspace tab logged no sampled application errors. The `design-pass/roles` evidence directory contains `hosted-paged-pipeline-portrait.png`.

The authenticated local fixture verified 10,000 matching loans, 60 distinct loans across two list pages, scoped LO and processor data, and a denied brokerage request. The action comparison covered tied stage timestamps, Unicode and literal search, an overdue hold revisit, an overdue service task whose headline action had no deadline, and suppressed prospecting. All 239 tests, lint, typecheck, the production build, and both local rehearsals passed. The [local benchmark](workspace-baseline.md#paged-pipeline) records response sizes.

## Hosted loan contact pickers

On `2e11e2cb-02ee-40af-828b-e5012971b87b`, the owner opened New Lead from a fresh Pipeline session and searched for an existing fictional borrower and realtor. Pressing Enter in the search left the form open. Save and open 1003 navigated to an application prefilled with the selected borrower. From a second staff tab, Edit Loan kept the borrower locked and preserved the selected realtor during a search with no results. Saving a new amount returned to the same loan with the revised amount and realtor visible. The product copy was verified and neither tab logged a sampled application error. The `design-pass/roles` evidence directory contains `hosted-new-lead-contact-pickers.png`.

Automated checks covered case-insensitive ties across pages, accented names, formatted phones, current officer access, processor denial, and the locked 1003 on a scoped edit. All 241 tests, lint, typecheck, the production build, and both local rehearsals passed. The [local benchmark](workspace-baseline.md#loan-contact-pickers-and-scoped-form-save) records the authenticated page, search, and save results.

## Hosted imported follow-up coverage

On `6ea0b8d7-7d39-44e1-a494-279146d1a1e4`, the QA admin imported two fictional service follow-ups and scheduled coverage for an invited LO. The backup completed the first follow-up from Coverage. After the admin ended coverage, a save from the backup’s still-open second follow-up returned an unavailable message. Reloading as the backup showed the ended window without a work action. The original owner’s Today queue kept the second follow-up at Nov 8, 2026, 1:00 PM ET and omitted the completed item. The local test also verified original ownership and deadline on the completed task, actor audit, and replay behavior. All 140 automated tests, typecheck, lint, the production build, and the local working-day and recovery rehearsals passed. The public product copy was verified.

After the browser plugin’s file upload permission was updated, Chrome selected a local fictional CSV through Migration. The live preview proposed one contact and one lead in the shared inbox. The preview was left uncommitted. Captures `hosted-imported-lead-coverage.png` and `hosted-crm-file-upload-preview.png` are in `design-pass/roles`.

## Concurrent borrower and staff work

On the build deployed as `131da232-6648-458d-bbc3-e36f09c9e16c`, the local three-role rehearsal sent two different 1003 submissions from the same saved revision. One succeeded and the other returned a conflict. An exact retry after the LO reviewed the accepted application kept the original revision and submission timestamp. Two simultaneous retries of a sample attachment advanced its request once while a processor read the loan and a realtor read the public milestone. The processor’s stale review was rejected. After refresh, the current evidence was accepted and both mock conditions cleared. The realtor response omitted document details and the private handoff note, and the rest of the rehearsal reached funding and the repeat application. All 143 automated tests, lint, typecheck, the production build, and the separate recovery rehearsal passed. The [local mixed workload](workspace-baseline.md#borrower-and-realtor-traffic-alongside-staff) records the sustained portal timings.

The `4e1818b1-bfb6-458d-ab12-1fd59e68db2d` rehearsal added a staff correction before pricing. The compact refresh returned the resume state, the full read restored the prior answers and correction note, and the corrected revision reached mock pricing and lender handoff. The same compact response kept the published quote and the current document revisions while omitting the draft. Hosted browser verification covered the correction and preserved pay-stub state. All 143 automated tests, lint, typecheck, the production build, and the recovery rehearsal passed again.

## Mock document reminder recovery

On hosted release `e9d34a9a-3cc3-4e84-a7ba-89a5210bdc52`, an admin set a fictional bank statement deadline and used **Playbooks → Automation run history → Run due mock reminders** with the interruption option. The failed run opened and focused the exact request. One retry recorded a mock receipt, kept the original due date, and showed both attempts. A second check found no new work. An interrupted tax-form reminder became Superseded after the borrower attached the sample. The public product copy was verified. Capture `hosted-document-reminder-recovery.png` is in `design-pass/roles`.

Admins can start a manual check from Playbooks. A check processes up to 20 eligible document requests in Eastern deadline order. Completed attempts record a simulated receipt. Interrupted attempts keep their document and deadline revisions and can be retried after a temporary hold or an expired link is resolved. Revised deadlines, received evidence, and closed files retire the old failed attempt. The tests cover Eastern midnight, a real SQLite rollback, request replay, stale revisions, held files, link validity, backlog paging, and role and brokerage scope. The built Worker rehearsal verified a processor was denied the admin check, then the admin recovered the mock reminder before sample review and lender clearance. All 146 automated tests, lint, typecheck, the production build, and the separate recovery rehearsal passed.

On `1241709a-9f09-4067-9b9c-c0ca2d61fdd2`, the admin opened **Review failed reminders** for three fictional requests. Cancel cleared the selection. After a new preview, the borrower attached the photo ID sample before confirmation. The confirmed batch recovered the bank statement and homeowners insurance reminders and skipped the photo ID. History showed mock receipts and the superseded request. Public product copy was verified. Capture `hosted-batch-document-reminder-recovery.png` is in `design-pass/roles`.

The review shows up to 20 ready reminders in deadline order and a separate sample of blocked work. Confirmation checks the selected attempt against the current request, deadline, link, and loan state. The result records each recovery or skip and can be replayed with the original operation ID. The local Worker rehearsal confirmed one recovery and one skip on the same loan, replayed the batch result, and completed the mock lender and funding workflow. The SQLite tests also covered a concurrent single retry, a link expiring after preview, and atomic rollback partway through confirmation. All 148 automated tests, lint, typecheck, the production build, and the recovery rehearsal passed.

On `50c1358e-0287-414b-8f03-5f64b8835c10`, the hosted admin saved **2 days before the borrower due date** in Playbook settings. A bank statement due Nov 10, 2026 produced an interrupted mock run eligible on Nov 8. After the admin switched the rule to **2 days after**, the bank statement stayed eligible under the original timing and recovered from the batch review. A separate insurance request due Nov 7 waited under the new rule. The original QA timing was restored, existing history showed its original due-date rule, and the public product copy was verified. Capture `hosted-document-reminder-timing.png` is in `design-pass/roles`.

Timing ranges from 14 Eastern calendar days before to 14 days after the borrower due date. Each new mock run captures its eligibility date and offset. An existing run keeps those values while the current request and deadline remain valid. The automated checks cover the Eastern date boundary, older settings and reminder rows, stale playbook saves, and an older client updating other settings. The built Worker rehearsal exercised early and late timing on the same loan through recovery and mock condition clearance. All 150 automated tests, lint, typecheck, the production build, and the recovery rehearsal passed.

On `7b0e8811-fe2f-4d3e-8a4e-07f7835822e2`, the fictional QA admin enabled **Scheduled mock reminders** in Playbooks. The hosted check recorded one homeowners insurance reminder in history with a mock receipt and a scheduled actor. The next check showed midnight Eastern. The admin paused scheduling and verified that manual checking and recovery were still available. The public product update was verified. Capture `hosted-scheduled-document-reminders.png` shows the completed check before pausing.

Scheduling is off by default and uses the workspace alarm that also handles document cleanup. An enabled workspace gets an initial check, a daily midnight Eastern check, and additional bounded checks while a backlog remains. A delayed wake checks the current eligible backlog once. The built Worker rehearsal removed an expected alarm and verified that opening the admin schedule rearmed the overdue check, which produced one receipt before mock lender clearance. SQLite tests cover scope, rollback, repeated wake, a 21-request backlog, and the transition off daylight saving time. All 152 automated tests, lint, typecheck, the production build, and the recovery rehearsal passed.

## Campaign follow-up batch recovery

On `2251ba93-2640-4e5f-bde8-a636351a6178`, the QA admin imported three fictional leads, logged interrupted follow-ups, and previewed the selected runs in Playbooks. A newer call in a second tab superseded one selection. The batch restored the other two tasks, which appeared in My Tasks at the two original Eastern deadlines. The skipped lead had no callback task.

On `5ab952e2-b965-4029-84d8-dada289c69c8`, a fresh batch showed the reviewed owner and original deadline for both selections. The result reported one restored task and one skip with the specific newer-call reason. My Tasks showed the restored time and omitted the stale task. The public product copy was verified. Capture `hosted-campaign-batch-recovery.png` is in `design-pass/roles`.

Admins can select up to 20 ready runs at once. A held lead or an automatic retry under paused campaign rules appears separately from ready work. A borrower-requested callback can be restored during a pause. Confirmation checks the current call, lead owner, outreach preference, and attempt. Replayed requests return the original outcome and unexpected database failures roll back the batch. The built Worker rehearsal restored the callback in the invited LO’s Today queue at its original time and continued through 1003, mock pricing and clearance, funding, and the repeat application. All 158 tests, lint, typecheck, the production build, and both local rehearsals passed.

On `d1429d0b-9661-425d-b8c6-1b3e0fe1a7af`, the hosted QA admin used **Manager exception queue → Campaign recovery** to see two future-due interruptions. Opening Taylor’s row showed only that retry and explained the campaign pause. Opening Avery’s row selected only the requested callback. Recovering it immediately removed Avery’s exception while Taylor’s stayed. The admin resumed automation and recovered Taylor’s retry. The queue cleared and My Tasks showed the original Nov 10 at 10:00 AM ET and Nov 12 at 2:30 PM ET deadlines. Public product copy was verified. Capture `hosted-manager-campaign-recovery.png` is in `design-pass/roles`.

The built Worker rehearsal followed the manager’s exact run through recovery and verified the invited LO’s task before proceeding to 1003. SQLite tests cover future-due visibility, filtering, current ownership and original time, access, held and paused rows, and removal after recovery, a newer call, opt-out, or archive. All 164 tests, lint, typecheck, the production build, and both local rehearsals passed.

## Configurable campaign retry time

On `4f184c71-8531-4aed-b18a-79004a546aee`, the hosted QA admin changed the automatic retry time to 3:30 PM Eastern. Taylor’s existing retry stayed at Nov 10 at 10:00 AM. A new no-answer retry for Morgan appeared in My Tasks at Nov 11 at 3:30 PM. Avery’s explicitly requested callback appeared at Nov 12 at 2:45 PM. Restoring the campaign’s original rule left the new task at 3:30 PM. Captures `hosted-campaign-retry-time-rule.png` and `hosted-campaign-retry-time-tasks.png` are in `design-pass/roles`. The public product copy was verified.

Chrome blocked a generated module on the initial release. The rebuilt release handles older workspace snapshots with the default time and loaded successfully in a fresh Chrome tab. Tests cover both Eastern daylight-saving boundaries, late and early times, old schema and save formats, campaign isolation, pause and resume, and scheduled and recovered deadlines. The built Worker scheduled an automatic 3:30 PM retry and preserved the invited LO’s separately requested callback before continuing through funding. All 183 tests passed.

## Campaign callback priority

On `1a955773-5e88-4d22-be69-b54ddac2bf7f`, the fictional pilot admin saw three upcoming callbacks in deadline order. Avery’s rescheduled 12:41 AM Eastern callback moved into Due callbacks as the deadline passed in the open tab, ahead of Quinn’s first call. Upcoming callbacks kept Taylor and Morgan in deadline order. My Tasks focused Avery’s exact card and showed the same deadline. The admin restored the original Nov 12 at 2:45 PM Eastern callback. The updated public product copy was verified. Capture `hosted-campaign-call-priority.png` is in `design-pass/roles`.

Chrome’s file chooser accepted a separate fictional campaign CSV. Orbit previewed one ready row and no review issues. The preview was left uncommitted.

Tests exercise the exact cutoff, chronological order, older callback records, logged replies, and exclusion of held, opted-out, and unresolved recovery work. The built Worker rehearsal exercised imported callbacks before and at their deadline. All 185 tests, lint, typecheck, the production build, and both local rehearsals passed.

## Personal callbacks across campaigns

On `9b57cee0-f68b-437f-8bce-10bf9472572d`, a signed-in fictional pilot admin saw an empty personal queue before the two deadlines. Avery’s 12:46 AM Eastern callback appeared before Riley’s 12:47 AM callback in a different campaign. Opening Avery from the second campaign’s Replies logged view changed the selection and focused the exact card. Riley’s row opened the second campaign and focused Riley’s card. The panel and action fit at 375 px. The admin restored Avery’s original deadline and moved the newly imported Riley fixture to a future deadline. The public product copy was verified. Capture `hosted-cross-campaign-callbacks.png` is in `design-pass/roles`.

In the built Worker rehearsal, an invited LO saw only the first callback a millisecond before the second was due, then both in order. A different owner’s retry was visible in that owner’s queue. The scoped read opened the second campaign task and rejected the first campaign’s task ID paired with the second lead. All 185 tests, lint, typecheck, the production build, and both local rehearsals passed.

## Scoped callback refresh and upcoming work

On `8fd10dbf-9622-43ea-97c0-159433dce2ab`, the hosted fictional pilot showed an empty Due view and four Upcoming rows from two campaigns in deadline order. The admin reassigned Riley from another tab. Opening the old row was rejected, and Refresh callbacks removed it while keeping the other three. Restoring the original owner returned Riley’s Nov 13 at 10:00 AM Eastern callback. Opening it focused the exact campaign card with Upcoming still selected. The panel fit at 375 px and the public product copy was verified. Capture `hosted-campaign-callback-refresh.png` is in `design-pass/roles`.

The feed reads the signed-in officer’s current open callbacks with a server-side deadline boundary and a 20-row page. The first page refreshes every 30 seconds while the panel is expanded and the tab is visible. SQLite tests cover the exact cutoff, tied deadlines, suppressed rows between pages, role and brokerage isolation, and retaining requested callbacks after a reply. The built Worker rehearsal verified that reassignment moved the same task and deadline to the new owner’s feed, and that the former owner could no longer open it. All 188 tests, lint, typecheck, the production build, and both local rehearsals passed.

## Promised callback performance

On `ad04b0cc-8c34-45fe-aa7b-65cbef7d295d`, the fictional pilot admin logged two callback requests. Moving June’s request before the original deadline updated its measured deadline and retained the original time. The next logged call counted as on time. Noah’s request became overdue. Moving it to a later time preserved the missed 1:02 AM Eastern deadline. The fictional voicemail at 1:02:33 AM Eastern counted as late. Both rows opened the exact request and attempt notes.

On `5bab8144-61b3-4440-9644-64bbe5840040`, the Late filter returned only Noah while the campaign totals stayed at one on time and one late. The report showed the 33-second difference and fit at 375 px after the long campaign header was allowed to wrap. The public product copy was verified. Capture `hosted-callback-performance.png` is in `design-pass/roles`.

The pilot-admin report covers newly tracked requests in the selected campaign’s last 30 days. Tests cover exact event links, same-timestamp calls, cutoff, rescheduling, failed scheduling and recovery, archive, opt-out, conversion, role and brokerage scope, schema upgrade, and paging. In the built Worker rehearsal, a simulated task-write failure left the promise visible, and the invited LO’s subsequent call moved the promise to On time with the exact call evidence. All 199 tests, lint, typecheck, the production build, and both local rehearsals passed.

## Manager overdue callback promises

On `8b4b0124-6856-440b-b348-f812b3b12a5b`, the hosted pilot admin opened Playbooks → Overdue callbacks. Dana’s missed 1:09 AM Eastern deadline and June’s 1:10 AM deadline appeared in order across two campaigns. Dana’s current callback had moved to the next day. The admin filtered by campaign and owner, reassigned Dana’s lead, and opened the exact campaign card. The new owner’s filter showed both original timestamps and the exact request note.

June’s recovery action opened only the matching interrupted run. Recovering it restored the task at 1:10 AM. Logging the fictional call removed June’s exception. The admin restored Dana’s original owner, logged the second fictional call, and verified the queue cleared. The two-row view fit at 375 px and the public product copy was verified. Capture `hosted-manager-overdue-callbacks.png` is in `design-pass/roles`.

The built Worker rehearsal confirmed that the invited LO could open the same scheduled task after reassignment and that the old promise action failed after completion. Tests cover exact deadlines, campaign and owner filters, hidden rows between pages, pilot-admin scope, stale promises, and assignment guards. All 202 tests, lint, typecheck, the production build, and both local rehearsals passed.

## Campaign callback promise migration

On `d5a25a7f-5781-4cd9-928a-103e753de841`, the hosted admin downloaded an eight-record Orbit CSV from the fictional source and uploaded the same file to a separate fictional destination. The preview showed two tracked promises on Avery’s open lead. The import created eight records. Replaying the file recognized all eight without another write.

The destination report showed an on-time attempt with the source call notes, author, and timestamp. The owner’s upcoming queue showed the Nov 10 at 1:21 AM Eastern task. The manager queue also retained the missed Nov 9 at 1:21 AM promise and its original request. The exact callback action focused the restored lead in the destination campaign. The public product copy was verified. Capture `hosted-callback-promise-cutover.png` is in `design-pass/roles`.

The SQLite round trip split source notes and tasks from callback links, remapped an LO, rejected a changed destination task, protected linked evidence from earlier undo, and reimported an untouched callback after undo. It also restored an original call author on a matching older imported note, retried a restored interrupted scheduling attempt, and logged a new call against the original promise. All 203 tests, lint, typecheck, the production build, and both local rehearsals passed.

## Callback cutover sign-off

On `c8f52970-d231-4cc6-8cb2-e7df49e54895`, the hosted destination loaded the earlier eight-record fictional import. With the active lead in the shared inbox, the checklist counted one promise needing an owner and one closed promise, and disabled reconciliation. The evidence opened the exact imported lead. Restoring its owner in another tab and refreshing the checklist changed the active promise to Ready. The admin saved a reconciliation note.

Changing the current callback from Nov 10 at 1:21 AM to 2:21 AM Eastern left the Nov 9 at 1:21 AM promised deadline intact and changed the checklist to Review again. Both promises and the prior note stayed visible. The expanded panel fit at 375 px. The admin restored the original fictional schedule and verified the recorded review was current. The public product copy was verified. Capture `hosted-callback-cutover-signoff.png` is in `design-pass/roles`.

Reconciliation checks the current source and completed numbered batch, active owners, matched call evidence and tasks, and the reviewed evidence fingerprint. Tests cover held and closed promises, recovery, owner availability, opt-out, missing links, undo, cursor paging, stale reviews, and upgrades that preserve existing source and file decisions. All 206 tests, lint, typecheck, the production build, and both local rehearsals passed.

## Imported 1003 source comparison

On hosted release `ea45c7c7-4036-49d1-9cec-8affd872aa4a`, a signed-in admin uploaded a fictional two-borrower MISMO XML, created a draft against the imported Riley Example contact, and opened the file evidence under Migration. All nine mapped fields matched. Orbit reported one missing additional borrower and disabled Reconciled. After adding the fictional co-borrower to the joint application, the admin could save a reconciliation with an evidence note.

Navigating to Property without changing answers preserved sign-off. Changing the requested amount from $280,000.50 to $285,000.50 displayed both values and changed the review to Review again. Restoring the original amount returned the comparison to nine matches and made the existing review current. The panel fit at 375 px without horizontal overflow, and the public Product page described the new comparison. The other 1003 sections require a separate review.

Cloudflare build, typecheck, lint, all 209 automated tests, the local working-day rehearsal, and the recovery rehearsal passed. The targeted tests cover scoped access, missing values and borrowers, stale evidence, legacy imports, and revision-only navigation.

## Document and lender cutover comparison

On hosted release `d59569fe-e951-44fb-b285-60ccd90462a3`, a pilot admin selected Riley Example's linked draft and uploaded a fictional source inventory. The source expected a Photo ID request, an acknowledged Example Wholesale submission, and one open income condition. Orbit reported one missing document request and two missing lender records, with Reconciled disabled for both categories. The links opened the document and lender sections of the same loan. After the admin restored the three records, Orbit showed one document match and two lender matches. Both reviews accepted an evidence note and sign-off.

Changing the lender status from Acknowledged to In review displayed both values and reopened only the lender review. On final release `efcdc638-0ed5-4e43-95b4-a05e2e40dbc1`, the comparison stacked the two values at 375 px without horizontal overflow. The updated public Product page was verified. Restoring the lender status made its original sign-off current. Adding a Photo ID deadline then reopened only the document review. Removing the deadline restored the visible match and the admin recorded a fresh sign-off against the new document deadline revision.

Build, typecheck, lint, all 213 automated tests, the local working-day rehearsal, and the recovery rehearsal passed. Focused tests cover role and export scoping, explicit empty versus omitted categories, inventory replacement, retries, duplicate requests, and manual and mock UWM condition evidence. The hosted workflow uses fictional metadata and a manual sample lender.

## Closing and funding cutover comparison

On hosted release `69cdc3bf-47f4-4e18-8727-cfafe430194d`, a pilot admin opened the saved fictional document and lender inventory on Riley Example’s linked draft. The replacement upload added funding evidence and preserved both earlier sign-offs. A November 5 target date left all four source funding records missing. The admin recorded actual closing on November 5 and funding on November 6 with a simulated follow-up failure. The dates and $280,001.00 principal matched, while the missing borrower check-in blocked reconciliation. Retrying the run in Playbooks restored its November 13 deadline. The comparison showed four matches, and the admin signed off with a note.

Removing the target date left the review current. Correcting recorded funding to November 7 changed the check-in deadline to November 14 and reopened the funding review. Both changed values fit at 375 px without horizontal overflow. Restoring the original fictional funding date returned the file to four current reviews. The live product page described funding follow-up verification.

Build, typecheck, lint, all 216 automated tests, the working-day rehearsal, and the recovery rehearsal passed. Local checks cover follow-up recovery, source and role scoping, principal precision, date-only targets, completed tasks, the next follow-up from a check-in, and funding reversal and re-funding. The comparison uses the current loan principal from Orbit’s Funding Dashboard and the current funding cycle. Settlement amounts and prior cycles remain separate evidence.

## Owner cutover readiness

On hosted release `32a3be5b-54fa-4d3f-8c1e-cea2cf0179eb`, a pilot admin selected the fictional MISMO cutover source. Two drafts for Riley Example appeared as separate files with distinct property addresses and amounts. The totals showed one Ready and one Needs review. The ready draft listed four reviewer names and Eastern timestamps. The pending draft identified a missing additional borrower and opened the exact application evidence. The unnumbered CRM receipt, callback status, and source-wide sign-offs were listed separately from the file count.

Marking the ready draft’s funding check Out of scope moved it to Reviewed with exclusions. Reinstating the funding sign-off returned it to Ready. Editing the same draft’s lender status showed the stale check and its prior reviewer, and increased Needs review to two. Restoring the original status returned the counts to one Ready and one Needs review. The page fit at 375 px without horizontal overflow, and the live Product page described the readiness view.

Build, lint, typecheck, all 218 automated tests, the working-day rehearsal, and the recovery rehearsal passed. Local tests put ready and excluded files on the second page, cover source and brokerage scope and new export receipts, and verify exact totals at 100 drafts and truthful page-level status at 101.

## Cutover handoff download

On hosted release `7460554b-f566-4346-b9b2-92082d4aee1f`, a pilot admin downloaded the fictional MISMO source handoff from Cutover readiness. The first HTML file contained both file references, the selected source and basis, the recorded reviewers, one Ready file, and one Needs review file with a missing co-borrower. The browser created the file in Downloads, where the exact contents were verified.

After a lender status edit in a second tab, the first tab still displayed one Ready. Its next download contained zero Ready, two Needs review, and Review again for the lender check with the prior decision and reviewer. The downloaded HTML omitted borrower names, property addresses, loan amounts, and review notes. Restoring the original lender status returned the workspace to one Ready and one Needs review. The live download controls fit at 375 px, and the public Product page described the report.

Build, typecheck, lint, all 222 automated tests, the working-day rehearsal, and the recovery rehearsal passed. Tests cover a single current snapshot, files beyond the first page, exactly 100 files, refusal at 101, zero-file sources, stale and unauthorized requests, and HTML escaping. The downloaded evidence is a point-in-time report. Review underlying records and notes in Orbit.

## Exact cutover file lookup

On hosted release `fd39a057-757f-4562-a9b6-96a9b49783b7`, a pilot admin copied both references from the downloaded fictional handoff. The first, pasted with surrounding whitespace, opened the 731 Fictional Avenue draft and its missing additional borrower evidence. The exact 1003 button opened that loan. The second opened the 102 Fictional Avenue draft with its current Ready status and prior reviewer timestamps. Its older report had captured a stale check before the lender status was restored. A shortened reference returned no file, and the full reference returned no file under the other migration source. Switching sources cleared the input. The live Product page described the lookup.

On `191ddadb-02e0-42c4-9e88-1549443ce9ef`, the result focused the file heading and placed the open checks at the top of a 375 px viewport without horizontal overflow. Back to linked files returned to the two separate file cards.

Build, lint, typecheck, all 223 automated tests, the working-day rehearsal, and the recovery rehearsal passed. The exact lookup regression covers a file outside the first page, two nearly identical references for the same contact, sources with over 100 drafts, current and stale evidence, access denial, source rollover, and unlinking.

## First-day campaign routing and 1003 handoff

The hosted First Day Routing Rehearsal pilot started empty. The owner created it, invited an existing test identity as LO, and verified that the invite activated through Google sign-in. Back as owner, both staff were configured for round robin with one open lead each. The first three-row CSV assigned Elena to the LO, Jordan to the owner, and Morgan to the shared inbox. A replay preview recognized all three source IDs with zero importable rows. The original commit still showed generic routing text. The invited LO found Elena under Today → Next 7 days and opened the exact campaign record. Logging Connected in Ready to call removed the card and its Start 1003 action. Reached still opened the prefilled application.

On hosted release `b6b81d65-24d8-4e9a-a1a8-a00cd23e0663`, the same pilot repeated the flow with a clean campaign and second three-row CSV. The committed receipt showed Nora assigned to the LO, Casey assigned to the owner, and Parker in the shared inbox. It showed both assigned first-contact deadlines at Nov 10, 2026, 2:38 AM ET. Today’s empty Due today view pointed to Next 7 days, where the LO found Nora at that deadline. Casey was absent from the LO queue. At 375 px, a Connected call in Ready to call left Start 1003 in the same view, focused and within the viewport. The action created the LO-owned application and cleared the continuation. The borrower link showed Nora’s name, Purchase, and ZIP 48084, and the same link reopened the saved Property step. The owner session was restored and the public Product page was verified.

Build, typecheck, lint, all 223 automated tests, the local working-day rehearsal, and the recovery rehearsal passed. The campaign regression verifies actual recipient and deadline reporting, replay behavior, denied access for another LO and brokerage, and exact imported name, email, phone, purpose, and ZIP in the resulting borrower draft. Chrome masks email and phone in the browser evidence. No external messages were sent in the rehearsal.

## First-day processor handoff

The First Day Routing Rehearsal pilot continued with Nora’s converted campaign loan on `b6b81d65-24d8-4e9a-a1a8-a00cd23e0663`. The borrower submitted the fictional 1003, the admin reviewed it, and mock UWM returned two conditions. The loan was transferred to the admin and the invited test identity changed from LO to Processor in this fictional brokerage. Assigning Nora in Processing → Unassigned removed the card and its Open handoff action, so the owner continued from Assigned files. The invited processor signed in, accepted from Ready to accept, requested the pay stub and bank statement, then accepted and sent both built-in text samples to mock UWM. A single check cleared both conditions. The processor returned the file with a private note. The owner opened the returned handoff from Today → Next 7 days at the original deadline, read the note, and completed it. Review closing readiness became the next action.

On hosted release `2a0b2be1-952a-49b4-a103-d1cca2b16798`, assigning the reviewed Elena file at 375 px focused Open handoff in the confirmation and opened Elena’s exact file while Unassigned stayed selected. After the owner sent the file, Elena appeared in Ready to accept. Requesting a correction removed the ready row but left the file in Assigned files. The borrower reopened the same link and resubmitted, then the owner reviewed the current revision and verified the ready row returned. The public Product page described the updated handoff. The admin session was restored, with the invited test identity still assigned as Processor in this pilot.

Build, lint, typecheck, all 223 automated tests, the local working-day rehearsal, and the recovery rehearsal passed. The Ready to accept regression covers a borrower correction, missing first review, stale and current second approvals, processor scope, and pagination when more than one page of blocked files precedes eligible work. All lender activity in the hosted rehearsal was mocked.

## Closing, funding, and repeat business

On hosted release `2a0b2be1-952a-49b4-a103-d1cca2b16798`, the owner continued Nora’s cleared campaign file. The owner marked it Clear to Close, added and completed a fictional signing item, and recorded closing and funding separately. Funding on November 9 created a borrower check-in due November 16 at 4:00 PM ET. Today’s seven-day view ended November 15. The loan’s next action opened the check-in, where the owner recorded a requested callback for November 10 at noon Eastern and created a distinct refinance draft. The callback appeared in Today, and Past Clients reopened the exact same repeat draft. Creation initially moved the staff tab into the borrower view.

On `dd019ed3-abeb-4568-bd7a-fa1b8367194a`, a separate fictional Maya loan was used to retest the funding controls. Recording same-day funding showed the same November 16 deadline and Record borrower check-in in Closing at 375 px. Saving the check-in and starting the repeat opened the new staff loan’s 1003 with Open borrower view and Copy link. Opening the borrower link separately showed Maya’s name and Refinance. Past Clients reopened the same draft, and the original loan stayed funded with the completed check-in action removed. The live Product page and presenter instructions reflect the updated flow.

Build, lint, typecheck, all 223 automated tests, the local working-day rehearsal, and the recovery rehearsal passed. The hosted evidence uses fictional loans, simulated funding, and manual check-in logging.

## Configurable second 1003 review

On `65b1cddb-aeb2-4d7a-8bf7-6f853663707e`, the fictional pilot admin enabled a second-review rule with a two-day deadline. The invited LO marked Casey’s submitted revision 5 reviewed. Orbit placed a request in the designated admin’s Reviews queue with a Nov 11, 2026 deadline and recorded the playbook revision. The admin opened and approved that exact revision. Capture `hosted-second-1003-review-routing.png` is in `design-pass/roles`.

The fictional borrower resubmitted a corrected 1003. The configured admin recorded the first review of revision 8. Orbit saved it and raised **Reviewer needed** under the manager’s internal review exceptions. The exception opened the loan’s Team reviews with the type and target date prefilled. A manual assignment to the invited LO cleared the exception, and the LO approved revision 8. The original admin session, QA loan owner, and manual routing setting were restored. The public product copy was verified.

Routing is opt-in. The rule creates a request after the first staff review of a submitted revision. The designated admin must differ from the first reviewer. Existing open reviews retain their assignment and require resubmission after changed evidence. The built Worker rehearsal verified that one request reached the admin’s Today queue and that a corrected 1003 prevented a decision on the old revision. Staff resubmitted and approved the new revision before continuing through mock pricing, clearance, and funding. All 170 tests, lint, typecheck, the production build, and both local rehearsals passed.

## Second-review handoff checkpoint

On `f1f903ea-25fe-4722-b26f-2e731c857462`, the hosted QA playbook started with the checkpoint off. After enabling it, the admin saw approval for revision 8. A fictional correction and resubmission advanced the application to revision 11. The invited LO completed the first review and saw the required second review in Pipeline, the 1003, and Processing handoff. The designated admin approved revision 11. The 1003 showed that approval, and mock UWM recorded a receipt for revision 11. The admin confirmed the approved state in Processing handoff, restored the QA playbook and original owner, and verified the public product page. Capture `hosted-1003-handoff-checkpoint.png` shows the loan awaiting approval.

The built Worker rehearsal attempted a mock send and a processor handoff while approval was pending and verified both were blocked. After the current approval, the LO submitted the mock 1003, sent the handoff, and the processor accepted it and cleared the conditions. Tests cover the optional policy, exact-revision decisions, correction after send, separate manual MISMO export, and receipt replay. All 173 tests, lint, typecheck, the production build, and both local rehearsals passed.

On `731ad67b-d4fe-46ea-84ee-738605c6aed6`, the hosted admin opened **File exceptions → Required 1003 approvals**. A first review of fictional revision 14 produced **Reviewer needed**. Assigning the invited LO added the chosen Nov 12 due date and changed the row to **Awaiting approval**. A corrected submission changed the row to **Resubmission needed**, showed revision 17, and opened the original review. Resubmission retained its date and returned it to the invited LO. Approval of revision 17 cleared the manager queue. The original QA owner and playbook setting were restored, and the public product copy was verified. Captures `hosted-required-1003-approvals.png` and `hosted-required-1003-resubmission.png` are in `design-pass/roles`.

The checkpoint view returns one row per active reviewed file awaiting required approval for an outstanding handoff. The built Worker rehearsal verified the assigned reviewer, date, exact link, requester after a correction, and removal after approval. SQLite coverage includes policy and role scope, stale assignments, an existing mock receipt, prior reviews, and tied-date pagination. All 177 tests, lint, typecheck, the production build, and both local rehearsals passed.

### Hosted Contacts directory

On `58a5db63-4c64-4424-9066-6ab0a3e247f6`, the admin searched for Fictional Paging 01, opened its history, and verified New Lead selected the existing borrower and Returning client. The admin saved an example.test email on the fictional contact and opened the exact linked loan from history. Chrome selected a local two-row fictional CSV, and the preview flagged the existing contact as a possible duplicate. The preview was left uncommitted. The public product page described the directory and contact history. Capture `hosted-contacts-directory.png` is in `design-pass/roles`.

The built Worker verified directory paging and access boundaries with 100,000 contacts. SQLite regression coverage includes tied names, normalized phone and accent matching, role scope, and linked-loan pagination across older loans without creation dates. All 242 tests, lint, typecheck, the Cloudflare build, and both local rehearsals passed. Integrations stayed mocked.

### Hosted scoped contact CSV

On `e866801a-c823-402d-8697-62bd268ba31e`, the admin opened Contacts from a fresh workspace entry and previewed a local two-row fictional CSV. Import skipped the existing email and added one realtor. The admin edited the new contact, filtered the directory to that single row, and downloaded a CSV with all 15 accessible contacts, including the edited realtor and contacts outside the filter. The public product page described scoped CSV preview and export. Capture `hosted-scoped-contact-import.png` is in `design-pass/roles`.

SQLite coverage confirms that preview and export respect role visibility, import also skips duplicates outside the importing officer's scope, and retrying the same batch records only one import event. All 244 tests, lint, typecheck, the Cloudflare build, both local rehearsals, and the 100,000-contact benchmark passed.

### Hosted paged Lead Inbox

On `067591ef-0e50-403b-9ab4-4f21a58be183`, a fictional quote request entered the shared inbox. The admin opened the lead from Unassigned, assigned it, verified it in Mine, and converted it. The loan opened at the 1003, and the borrower view showed the prefilled name. The temporary quote link was disabled after the check. The product page showed the new inbox copy. Capture `hosted-paged-lead-inbox.png` is in `design-pass/roles`.

The built Worker rehearsal gave two invited LOs the same shared lead and verified a single claim, the original due date, denial of the exact record to the other LO, and no duplicate claim history on retry. SQLite tests cover tied deadline paging, holds, opt-outs, exact record access, archive and restore, and the prefilled email and ZIP. All 246 tests, lint, typecheck, the Cloudflare build, the large fixture, and both local rehearsals passed.

### Hosted active task queue

On `f2f00673-aa68-401e-aa1f-634ab6bcb345`, the admin opened the fictional first-contact task at the loan's Activity section and completed it from the active queue. A dated pay stub request appeared in Documents and opened the exact checklist item. The admin opened a fictional contact callback, recorded Connected, and verified the completed entry in Detailed queues. In the guided pilot, the bank statement alert opened its matching mock UWM condition. The public product page showed the new queue copy. Capture `hosted-active-task-queue.png` is in `design-pass/roles`.

SQLite regression coverage checks timestamp boundaries, tied deadlines, assigned contact access and reassignment, processor documents and handoffs, and alert review. All 248 tests, lint, typecheck, the Cloudflare build, the dense other-owner benchmark, and both local rehearsals passed.

### Hosted task history and playbook work

On `fb827950-ba85-4743-9e3e-2bd710102e47`, the admin opened a completed callback and saw its saved Connected outcome. Reopening the fictional first-contact task moved it into Open. A temporary hold showed the original reason and November 10 noon Eastern revisit in Holds. The admin opened the exact workflow and restored the loan to Active, then completed the first-contact task again. In the guided pilot, Assign a processor opened the current unassigned processing handoff. The public product page showed the updated Tasks copy. Capture `hosted-task-history.png` is in `design-pass/roles`.

The local regression covers tied completion timestamps, blocked history, quiet-lead timing and deduplication, corrected 1003 review, post-funding work, and the current-revision approval gate. All 250 tests, lint, typecheck, the Cloudflare build, the combined task and inbox fixture, and both local rehearsals passed.

### Hosted Communications and milestone drafts

On `ae1f2185-7c7f-4c11-bba6-8144355870f4`, the admin opened Communications from a fresh workspace entry, saved a temporary borrower template, opened the exact Application received draft, and copied the fictional email. Orbit showed the first copy timestamp and moved the item into Copied. The admin restored the default template, started the linked borrower conversation, and saved an internal note. After reloading the workspace, the admin reopened the thread and saw the note. Reply review and the public product copy were verified. Capture `hosted-paged-milestone-drafts.png` is in `design-pass/roles`.

The local regression checks role scope, historical recipient redaction, tied timestamps, current milestones across every stage, template revisions, relinking, and separate email and text copy receipts. All 253 tests, lint, typecheck, the Cloudflare build, the 50,000-draft fixture, and both local rehearsals passed.

## Hosted Past Clients

On `072f482a-0d90-4d52-aca3-20d7aa9a7fa8`, the admin opened Past Clients from Today in Presenter Rehearsal C. Search narrowed the four funded files to Riley while keeping the four-file summary. Open repeat 1003 landed on Riley's separate refinance draft in the staff workspace. Rate watchlist showed Casey at 6% against a 6.125% target. Saving the existing profile returned to Casey's loan, preserved the observed-rate timestamp, and refreshed the list. Anniversaries showed Casey's next closing anniversary. The public Product page reflected the release.

The signed-in hosted check used four records and an existing repeat. Local regressions cover a second page, tied dates, leap-day anniversaries, role scope, exact retention saves, new repeat creation and replay, reassignment, and loss of funding. The 255 tests, lint, typecheck, Cloudflare build, working-day and recovery rehearsals passed.

## Hosted realtor conversion drilldowns

On `b075de78-1f93-4653-a69f-3f4be1cce452`, the admin opened Realtors from Today in Presenter Rehearsal C and searched for Taylor. Partner conversion showed seven referrals, five submitted 1003s, and four funded loans. From the funded and submitted counts, Riley's record opened directly at Funding and 1003, respectively. The referrals count opened seven records, including Fictional Partner Referral C, which went directly to its Lead Inbox work card. Taylor's contact history opened from the selected profile. The public Product page reflected the release.

The signed-in local working-day rehearsal checked compact link creation, selected profile, role and brokerage restrictions, and reconciliation of a funded record with its filtered count. Local regressions cover archived and held intake, tied pages, preservation of attribution after relinking, funding reversal, and portal token boundaries. All 257 tests, lint, typecheck, the Cloudflare build, and the recovery rehearsal passed.

## Hosted manager ownership and deadlines

On `63afe4da-7f32-4ff4-8715-e34c36872ffa`, the admin opened Playbooks from Today in Presenter Rehearsal C, then chose Ownership and deadlines. Quinn's unassigned file opened at Processing handoff. Alex's unassigned lead opened at the current campaign card, showing the same November 9, 8:10 PM ET deadline as the queue. Returning to Playbooks kept the selected view. The public Product page reflected the release.

The signed-in local run verified brokerage and role restrictions, campaign recovery before the deadline, compact policy saves and lead reassignment, and removal of the unassigned processor exception after assignment using its current revision. Local regressions reconcile the previous exception rules with the paged reader, including tied deadlines and source and campaign filters. All 258 tests, lint, typecheck, the Cloudflare build, and the recovery rehearsal passed. Hosted verification opened the records without changing their assignments.

## Hosted focused loan assignment

On `c3927cf3-eceb-4f37-addc-0e5cb91fcbb2`, the admin opened Manage assignment for Quinn from Ownership and deadlines. The editor showed the current loan officer and unassigned processor. Open loan took the admin to Quinn's processing handoff, where Manage assignment reopened the editor. Closing it returned to the same exception view. Searching for Quinn in Team selected the same file and loaded the same assignment. The public Product page reflected the release.

The signed-in local rehearsal exercised the exact GET and assignment POST. It denied other roles and a different brokerage, confirmed the assigned processor could open the loan, removed the unassigned exception, and returned the borrower name on the audit event. Local tests cover stable paging, exact off-page opening, stale assignments, same-target replay, and retention of an active handoff's note and timestamp during replacement. All 260 tests, lint, typecheck, the Cloudflare build, and recovery rehearsal passed. Hosted verification opened existing records without changing assignments.

## Hosted migration receipt drilldowns

On `bbeed7ac-0c1b-40e9-a432-2baac8097a8f`, a hosted admin opened a 14-row correction receipt in the fictional Numbered CRM Destination QA workspace. **Open evidence** on follow-up 036 landed on that exact contact task, with its assigned owner and February 1, 2027 noon Eastern deadline. After Chrome file upload was enabled, selecting a local fictional MISMO XML produced the reviewed 1003 preview. The draft action stayed disabled until the borrower choice and fictional-data confirmation. The public Product page carried the new migration copy.

The signed-in local rehearsal verified the exact lead and converted 1003 opens, role and brokerage restrictions, and scoped MISMO creation, replay, and duplicate handling. Automated checks cover a removed source link and a replaced receipt target. All 262 tests, lint, typecheck, the Cloudflare build, and both local rehearsals passed.

## Measurement boundary

The November 8, 2026 local run measured 122 ms of setup and 450 ms across the six scripted stages, excluding Worker startup. The run used 74 authenticated and portal requests, including negative checks. It included two staff handoffs, zero role changes, and zero re-entry of the imported borrower identity fields. The mock path called no external system. These are local request timings and scripted workflow counts. A brokerage working day adds handling time, sign-in, waiting for borrower evidence, and the actual lender, title, credit, and communication handoffs.

Manual decisions exercised in Orbit include mapping the CRM import, recording the outreach outcome, reviewing the 1003, selecting the quote, accepting documents, deciding when the file is clear to close, recording funding, and choosing the repeat-loan purpose. Use the same boundaries in a paired design-partner run and time each actor's active handling separately from waiting and external work.

### Run a paired brokerage walkthrough

1. Pick one fictional case and use the same team in both workflows. For **Campaign lead to repeat loan**, start with an assigned lead and stop after funding and opening the repeat application. Use equivalent borrower and lender responses in both runs.
2. Keep a wall-clock timer for the whole run. Each operator records their active seconds by role. Count a staff handoff when responsibility changes hands. Record each field re-entered and each move between separate systems.
3. Record waiting as wall-clock time blocked on a borrower, lender, or vendor. Count overlapping waits once. Active times can overlap across roles. Leave unobserved fields blank and enter zero for a measured absence.
4. In **Team → Pilot measurements → Record a paired benchmark**, enter both runs. Open **Handling and handoffs** for each workflow to enter the role times, waiting, and staff transfers. Review the differences and record the manual or external steps alongside the comparison.

Use observed brokerage timings for the comparison. The local harness and hosted presenter rehearsals provide fixture and workflow evidence.

On hosted release `6058bd3f-00cb-4078-beb1-415e0df16b4a`, a pilot admin saved and reopened a fictional QA comparison with role-specific active time, waiting, and handoffs. A measured zero rendered as zero. An unmeasured processor time had no computed difference. The table accepted keyboard focus, and the public demo page described the paired comparison at 390 × 844. The local browser also retained a legacy pair and preserved entered values when waiting time exceeded elapsed time. The 139 automated tests cover compatibility, retries, and admin scope. The QA values exercise the form. The design-partner comparison remains unmeasured.

Release evidence is in `design-pass/roles`. The 273-file archive `orbitlos-6058bd3f-source.tar.gz` has SHA-256 `3b9039a4ffc839f413f623575034a8dded4787ccd4ffabbd6c4440ade74f21b1`. Build `2bae4737-0d0c-43e1-8928-574256a0a428` has Worker SHA-256 `894f6270d57586bd6e21f94d3efb994d949d5e7a018c3d9221621cdb5954e0b9`. The comparison capture is `hosted-fictional-paired-benchmark.png`.

## Guarded closing and design candidate

The closing action checks the reviewed 1003 revision, mock UWM receipt, condition clearance, accepted documents, and completed processing handoff. The local run confirmed that the LO was blocked before handoff completion and after a condition reopened, and that the processor could not mark the loan Clear to Close. After the LO replaced the document and confirmed mock clearance, the action succeeded and a retry left one realtor milestone draft. The run used 86 requests across the same three staff sessions and both portals.

The hosted QA admin ran the borrower sample 1003 through review, mock submission, document requests, acceptance, and clearance on `9354b32e-94ec-470e-9827-e6b11d915961`. The guarded action moved the fictional file to Clear to Close and surfaced Review closing checklist next. The local three-role run and recovery rehearsal passed again on the first design candidate, `939dacc3-1042-41b9-89b8-19d8d9a978a1`.
