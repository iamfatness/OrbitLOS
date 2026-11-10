# OrbitLOS

OrbitLOS combines loan origination and CRM in one workspace for wholesale mortgage brokers. The demo starts with fictional borrowers, realtor partners, and loans. See the [product vision and scope](PRODUCT-BRIEF.md) for the roadmap and MVP acceptance criteria.

## Run locally

Install Node.js 24 or later and run `npm ci` once. For a fresh solo rehearsal, run `npm run demo:local` and open the campaign or referral link printed in the terminal. It binds to `127.0.0.1:3410` and creates a fresh SQLite database in `.orbit/rehearsal-*/` each time. The campaign walkthrough supports mock UWM and fictional MISMO export. Use fictional data. Sign-in, invitations, and the optional processor handoff are covered in the signed-in pilot.

For everyday development, use the persistent local workspace.

```sh
npm run dev
```

Open [Orbit on localhost](http://127.0.0.1:3000) and choose **Log in** to open the local workspace. The app binds to localhost and saves records in `.orbit/orbit.sqlite`. Set `ORBIT_DB_PATH` before starting the app to use a different database file, such as one for a clean test workspace.

## Walk through the guided demo

For the CSV-to-funding walkthrough, use the [executive run sheet](docs/executive-rehearsal.md) for the presenter cues, exact controls, and live timing baseline.

1. Open the workspace and choose **Guided demo**. In the local SQLite demo, load the sample scenario. In a signed-in workspace, an admin can create a fictional pilot or load the scenario from an existing pilot. Admins can assign the scenario to an invited LO from **Team**.
2. Start the 1003 from the sample realtor referral. In the borrower view choose **Load sample and review**, confirm the sample answers, and submit. Back on the loan, refresh and mark it reviewed.
3. Open mock credit, confirm the fictional authorization, and run a report. Choose **Price with mock score** to carry the 1003 details into pricing. Run pricing, save an offer, and send the reviewed 1003 to mock UWM. From **My Tasks**, open a condition alert and request its suggested document.
4. Attach the sample from the borrower checklist, then refresh the condition. Accept and send the document in one action. Check mock clearance. Repeat for the outstanding conditions.
5. Preview the realtor draft created by clearance. Move the loan to **Clear to Close**, set a target date, and refresh the realtor view to see the milestone.
6. Record the sample observed rate in the guide. Open **My Tasks** to see the rate-watch task with the observed, target, and current rates.

**Reset sample scenario** replaces the walkthrough loans, referral, and links. Other workspace loans remain available.

## Try the pipeline

1. Use **New Lead** to enter a borrower name and optional contact details, or select an existing borrower. Choose **Save lead** to return to the pipeline or **Save and open 1003** to start the prefilled application.
2. Switch between the board and list views. Drag a card to another stage or use the **Pipeline stage** field in the loan details. Use **Contacts** to manage borrower and realtor details.
3. Click **Sync UWM**. The first sync refreshes Charlotte Kim and Amelia Davis and imports Benjamin Cole. Open Charlotte's loan to see the lender status, two outstanding conditions, and one cleared condition.
4. Sync again to refresh the same lender records. UWM status and pipeline stage are separate fields, so a sync preserves broker-managed stages.

The loan header shows its owner, stage age, next action, due date, and blocker. Use **Filters** in the pipeline or **Loan work status** in Tasks to find overdue, stalled, unassigned, or paused files. **Change loan status** records a hold, withdrawal, or lost lead with a reason. A hold can have a revisit date. Reopening brings the existing open work back to the assigned staff member.

A dated hold appears under **Holds to revisit** for the loan owner. The processor can review the shared file and resume the handoff after reopening. Mock UWM alerts for paused files are available under **All** tasks. Rate-lock deadlines can still require attention during a hold.

### Try the lead inbox

1. In a fictional pilot workspace, open **Lead Inbox → Lead routing and quote form** as an admin. Choose an active loan officer or the shared inbox for website leads. Realtor referrals can keep the link owner, use the shared inbox, or route to a selected officer. Set the first-contact deadline and mock follow-up intervals.
2. Choose **Enable link**, save routing, and open or copy the public quote form. Submit a fictional request with a name and an email or phone. A ZIP is optional. The form is scoped to this brokerage. Replace or disable the link to retire it.
3. Refresh **Lead Inbox**. An LO can claim an unassigned website lead. A brokerage admin can assign a lead to an active officer. Overdue first contacts surface in **Tasks** and open the lead directly.
4. In **Work lead**, record a mock sequence step, pause or resume the sequence, or stop it. Log a sample outreach outcome to clear the first-contact deadline. A connected conversation or reply stops the sequence. Mock sends stay in Orbit.
5. Review possible contact matches, then choose **Create loan and prefill 1003**. The loan retains its source, owner, and outreach history. Use **Record outreach opt-out** on an assigned lead to stop its mock sequence and callbacks, including matching records across the brokerage. The lead remains available for a borrower-requested application.

In **Call Campaigns**, select a conversion count to see the leads or loans behind it. Admins see the brokerage campaign or their selected segment. LOs see the leads they can access. After funding, open the borrower’s **Contact history** from **Past Clients** to start a separate returning-client 1003. The original campaign keeps its conversion credit.

The CSV preview shows the existing lead and its campaign when a phone number or email matches. Choose **Add existing lead** for an eligible match to enroll the same record and exclude that CSV row. Preview again to import the remaining leads. If two rows in the file match each other, keep one in the preview.

In **Call Campaigns → Unassigned**, the round-robin panel shows eligible shared leads, open slots, and the assigned count against each active officer’s cap across the campaign. Route eligible leads when a slot is available, or choose **Assign this lead** on a shared record to assign it manually. The first-contact deadline follows the lead into the receiving officer’s queue.

After a campaign CSV import, the receipt shows each newly enrolled lead’s assigned officer and first-contact deadline or its placement in the shared inbox. An invited LO can open their assigned work from **Today → Next 7 days** if the deadline falls after today. From **Ready to call**, logging **Connected** keeps the exact lead’s **Start 1003** action in view. Existing contact matches still go through duplicate review.

In **Playbooks → Ownership and deadlines**, combine exception type, lead source, and call campaign to triage across intake channels. Choose **Load more exceptions** to continue in deadline order. A lead keeps its original source when enrolled in a campaign. Open the exact campaign, lead, processing handoff, or post-funding follow-up from its row. Assign an available teammate from the queue to preserve the original deadline. Returning to Playbooks keeps the selected filters.

From **Workspace search → Leads**, open the current lead in Lead Inbox. Loan officers can use **Claim lead** on an eligible shared lead. Shared realtor referrals use the brokerage’s realtor claim queue. Individual claims and owner changes update the lead in place and retain its first-contact deadline and any scheduled callback.

When a campaign lead changes their availability, open the callback from **Today → Open campaign**. Choose **Reschedule callback** and save the new time and reason. The existing task moves to the new time, and the reason appears in lead activity. If another officer updated the callback first, use **Refresh queue** to load its current state without changing the selected filter.

In **Call Campaigns → Campaign follow-up rules**, an admin can set the Eastern time for new automatic retries. Orbit schedules the selected time on the retry weekday. Existing tasks and held retries retain their original deadlines, and a borrower-requested callback uses its entered time.

**My campaign callbacks** combines the signed-in officer’s due and upcoming work across campaigns. **Open loan callback** focuses the exact task when a promised call has carried onto a 1003, including dates beyond Today’s seven-day view. **Refresh callbacks** checks current assignments without reloading the workspace. Within a campaign, **Ready to call** shows due callbacks and retries before first calls, **Upcoming callbacks** shows future work, and **Scheduled follow-up** shows both.

Pilot admins can open **Callback performance** to see whether a borrower-requested callback was attempted by its promised deadline, with the exact request and attempt in the call history. The report covers tracked requests logged in the last 30 days for the selected campaign. In the manager exception queue, **Overdue callbacks** brings open missed promises together across campaigns for review and reassignment.

In **Call Campaigns → Manager view**, pilot admins can select the overdue, reply, conversion, and opt-out counts to open the leads behind them. Overdue includes open sequence steps, callbacks, and retries on campaign leads, including the shared queue. A conversion opens the linked 1003 file. Counts use the entire selected campaign and count each lead once per outcome. Campaign email and text are simulated.

In **Call Campaigns → Campaign sequence**, pilot admins can attach **New Lead**, **Cold Lead Reactivation**, or **Past Client Outreach**. Each template has its own reusable versions. New CSV enrollments use the campaign’s attachment. In **Saved CRM segments**, **Quiet leads** uses Cold Lead Reactivation, and **Past clients** or **Past clients at rate target** uses Past Client Outreach. Leads with an owner keep it. Shared leads use the campaign’s routing or assignment workflow. Existing enrollments keep their original version.

In **Call Campaigns → Saved CRM segments**, preview the segment for the selected campaign, check the eligible borrowers you want, and choose **Enroll selected**. The preview starts with no borrowers selected. You can select up to 100 across pages per enrollment. If eligibility or campaign settings change, refresh the preview before enrolling. Unselected borrowers remain available for a later preview if eligible.

On an open **Lead Inbox** record or in **Contact History**, expand **Contact preferences** to record whether the borrower accepts calls, email, and texts. Existing records start with all three channels allowed unless the brokerage-wide outreach opt-out is active. Linked leads share the borrower contact’s preferences, and preferences set on an unlinked lead carry into conversion. Campaign sequences skip blocked steps and log the skip without counting a touch. The next allowed step keeps its configured delay from the prior step’s scheduled time when that step is skipped. The standalone Lead Inbox sequence uses mock email.

Primary borrowers can change the same settings from **Contact preferences** on their active application link before or after submission. Each change records the allowed or blocked channels and the time in the loan’s **Activity** and the borrower’s **Contact History**. The brokerage-wide outreach opt-out takes precedence. Email and text remain simulated.

Under **Contact preferences**, borrowers can set separate windows for weekdays and weekends in one time zone. Existing daily hours carry forward to both windows. Campaign and Lead Inbox sequences keep their normal cadence and move out-of-hours steps to the next opening in the borrower’s zone, including daylight saving changes. If a step is still open when the window closes, it waits until the next opening. Staff can see the windows and preference history in **Contact History**.

Pilot admins can **Pause sequence** on a campaign lead or from its overdue report row. **Manager view → Paused sequences** keeps those leads together. Resuming restores the same step and original due time. A step whose deadline passed is ready immediately. Separate campaign callbacks and retries keep their own schedules.

**Manager view → Sequence performance** reports recorded touches, logged replies, and stalled leads for each step of the selected version. Counts open the underlying lead or loan records. A first reply is credited to the latest tracked sequence touch at or before the reply. Older replies without a tracked touch appear under **Unattributed replies**. Stalled leads have an active, overdue step. Paused, held, closed, and suppressed leads are excluded from stalls. Calls count when recorded and email and text touches stay simulated.

After conversion, open the carried task from the conversation and choose **Log callback outcome**. Connected, Left message, and No response each complete the task and record the same call in loan activity and the original campaign report. The report measures against the recorded promise, including a deadline already missed before rescheduling.

Choose **Reschedule callback** on the loan task to change the time and record the reason. Today, Calendar, and My campaign callbacks use the new time. Moving it before the deadline updates the campaign’s measured time. Moving it after the deadline keeps the missed deadline visible alongside the new time.

In **Playbooks → Overdue callbacks**, converted leads remain visible while their promised loan task is open. **Open loan callback** focuses the exact task. **Manage loan owner** opens the assignment editor. The task follows the loan owner at the existing deadline and leaves the exception queue when the callback is logged.

From **Lead Inbox** or **Call Campaigns**, choose **Open lead conversation** on an assigned lead. Start the thread to see existing outreach logs, record an incoming reply or staff note, and set a conversation follow-up. Use the linked lead or campaign to log outbound contact and its outcome. **Today** opens the exact conversation. On conversion, the same conversation opens from the loan with its history, unread state, and follow-up date. An open borrower-requested campaign callback keeps its original due time as a loan task. Prospecting reminders stay out of Today while the borrower has opted out or the lead is on hold.

Use **Log reply** to record an incoming message that already happened. The lead drops out of quiet outreach and automatic call retries stop. Borrower-requested callbacks and campaign attribution carry on. **Call Campaigns → Replies logged** shows these leads. Simulated replies exercise the conversation queue independently of campaign follow-up.

In a fictional pilot, an admin can use **Communications → Reply review** to queue a simulated email or text. Orbit shows contact, open lead, and loan participant matches for that sender. Select the intended record and attach the reply. From **Linked**, a receipt attached to a lead opens the same conversation before and after 1003 conversion. **Replay source event** increments the receipt’s replay count and keeps a single conversation entry. If the sender index is still processing existing leads, choose **Refresh replies** to continue.

In **Playbooks → Manager exception queue**, overdue campaign callbacks and retries appear with the lead owner and deadline. Choose **Open campaign** to review the lead or **Reassign lead** to move its open work to an available officer. The deadline follows the lead.

In **Playbooks → Automation run history → Review campaign follow-ups**, an admin can preview interrupted callbacks and release previously paused retries after the campaign resumes. Review the current owner and original deadline, choose up to 20 rows, and confirm. Orbit reports recovered, skipped, and failed items separately. Recovered tasks appear in the current owner’s Today queue at their original times.

Use **Playbooks → Manager exception queue → Campaign recovery** to see interruptions as soon as they occur. **Review recovery** opens the exact run with its original deadline and any current blocker. Confirming recovery clears the interruption from this view and keeps the callback in the owner’s queue.

To rehearse the full path, choose **Demo Guide → CSV to repeat loan** in a fictional pilot and select **Set up campaign rehearsal**. You can choose an active invited LO as the buyer’s owner before importing. Choose **Open campaign import → Load rehearsal leads**, then preview and import the two fictional rows. You can also download and upload the rehearsal CSV. The **LO walkthrough link** opens the selected guide after sign-in. A completed walkthrough can open a fresh fictional pilot for another run.

For the executive walkthrough, load the realtor and rate-watch examples from the campaign guide. After starting Jordan’s 1003, link Taylor Pilot Realtor from **Edit loan** or **Choose a realtor partner**. After both accepted samples are sent, choose **Check mock clearance for 2 documents** once. Preview the generated realtor milestone, move the file to Clear to Close, and open Taylor’s portal. After funding, record a check-in with a future callback date and open the owned task. Start a repeat 1003, use your browser’s Back button to return to the guide, then record the 6.000% sample rate and open the resulting past-client task.

After funding, use **Turn a funded loan into follow-up work** in the guide. Record **Requested callback** with a date, then choose **Open callback task** to reschedule it or record the outcome. The guide shows the callback’s current state and links to borrower history. You can start the linked repeat 1003 before or after recording the check-in.

In the campaign guide, run mock credit and choose **Price with mock score** from the report. Review the prefilled 1003 inputs and save a quote. The saved option links directly to the chosen handoff. **Send reviewed 1003 to mock UWM** opens the lender checklist after the receipt, and **Open manual MISMO export** opens the reviewed application’s export panel.

An admin can enable **Require second 1003 approval before handoff and mock UWM submission** in Playbooks. The processing panel, 1003, and saved quote link to the review when approval is pending. A corrected submission needs a decision on its new revision. Manual MISMO export remains available from the reviewed application.

In **Playbooks → File exceptions**, choose **Required 1003 approvals** to see files waiting for a reviewer, decision, or resubmission. The queue shows the current revision and who can act. Open the row to assign a reviewer or work the exact review. Approval of the current revision clears the row.

After reviewing the campaign 1003, open **Optional processor handoff** to assign the selected file. The LO sends it from the loan record. Use the **Processor task link** in the processor’s signed-in session to accept from My Tasks, work the file, and return it with a note. The LO can complete the handoff from the guide.

### Try brokerage playbooks

In a fictional pilot, open **Playbooks** as an admin to set deadlines and choose a suggested backup for quiet leads. Use **Manager exception queue** to find overdue work, missing owners, or stalled handoffs and assign an active team member.

Use **Overdue** to find borrower callbacks due after a post-funding check-in. Managers can open contact history, reassign the callback without moving its deadline, or record the outcome and complete it from the queue.

Choose **Reschedule callback** in the exception queue, **Reports → Returning clients**, or the assigned officer’s **My Tasks**. The date and required reason are saved to contact history. The callback stays open and uses the new date across the workspace.

Submit a sample 1003 and open its review item from **My Tasks**. After review, assign a processor and send the file from **Processing handoff**. Sign in as the processor and accept the handoff from **My Tasks**. Record actual closing and funding to queue a borrower check-in and, if a realtor is linked, a thank-you draft. Staff can preview the drafts and record follow-up completion.

After recording funding, **Closing workbench** shows the borrower check-in deadline and **Record borrower check-in** while that task is open. On the check-in, choose **Save & start repeat 1003**, select Purchase or Refinance, and open the new loan’s prefilled 1003 in the staff workspace. Open or copy the borrower link from that loan. The new lead uses the same contact and loan owner. **Past Clients** reopens that application, and the funded loan retains its campaign attribution.

Choose **Record check-in** to log the contact method and outcome in the borrower’s history and complete the check-in. Enter a next follow-up date to queue a reminder for the loan owner in **Tasks → Contact follow-ups**. A requested callback needs a date.

### Try UWM alerts

After the first mock sync, assign Charlotte Kim’s loan to your account from **Edit loan** or **Team**. In **Integrations**, choose **Simulate UWM changes**. This one-time update for the workspace changes her UWM status, adds an insurance condition, and reopens the property condition.

Open **Tasks → My Tasks → UWM alerts**. **Open lender status** jumps to the UWM submission. **Open condition** jumps to the specific condition on that submission. **Mark reviewed** moves the alert to the **Completed** view. Regular syncs compare the saved lender status and conditions with the refreshed snapshot, so refreshing the same data leaves the alert count unchanged.

## Try the demo 1003

1. Open a loan without a UWM submission, such as Olivia Parker, and choose **Start 1003**. Open the borrower view or copy its scoped link. It expires after seven days.
2. Choose **Load sample answers** or enter fictional answers. Use **Save draft**, then reopen the same link to resume. **Continue** also saves progress. Review and submit to open the borrower status page and document checklist.
3. On the original loan, choose **Refresh application**, review the submitted answers, and select **Mark reviewed**.
4. Choose **Send to UWM (mock)**. The lender card shows a demo reference, an approved-with-conditions status, two outstanding conditions, and one cleared condition. **Sync UWM** refreshes the same lender record.

On the loan, open **Document checklist** and choose **Request document** to add a sample document type with optional borrower instructions. The borrower reopens the same 1003 link, selects **Refresh status** as needed, and previews and attaches a built-in fictional sample. Back on the loan, select **Refresh checklist** to see what's waiting on the borrower, ready to review, or accepted. Open a received sample to preview or download it, then accept it or request a replacement with a message. The existing seven-day borrower link can be renewed on the loan.

The submitted borrower view and the staff loan’s **1003** and **Conditions** views check for handoff changes every 15 seconds while visible. Same-browser notifications and returning to a tab can refresh sooner. Staff automatic refresh waits while there are unsaved edits. A borrower who has submitted can see a correction request and resume the saved application from the open view.

**Incoming loan work** in **Today → My Tasks** shows submitted 1003s, received documents, and returned processing handoffs for the signed-in officer’s active loans, separately from due work. In **Processing → Assigned files**, it shows received documents and handoffs ready to accept. The newest incoming page and **Ready to accept** check every 15 seconds while visible and the loan drawer is closed. Each action opens the current 1003, document request, or handoff. Handoff notes stay in staff views.

Under **Lender submissions**, open **Request borrower document** on an outstanding mock UWM condition. Confirm the document type and edit the instructions before adding the request. The condition shows the checklist status and links to the review controls. Each condition has its own request, and **Sync UWM** preserves the link. UWM clearance remains a separate lender status.

For multiple standard mock UWM conditions on the same submission, use **Request suggested documents** to add the prefilled requests together. Open the borrower checklist once, attach each sample, and refresh the requested documents. Review and send each document individually, then use the submission’s mock clearance check to see all returned clearances.

Under **Tasks → My Tasks**, the **Loan work queue** shows new 1003s, samples ready to review, and requests waiting on the borrower. **Open item** jumps to the relevant section. From **Document checklist**, use **Preview document follow-up** to copy one email or text for the outstanding requests, with the borrower’s link and any replacement instructions.

In **Closing workbench**, save a target date and add checklist items with owners and due dates. **My Tasks** flags loans assigned to you that are due to close within seven days or past their target date and still have outstanding items. Open the flagged loan from the queue to work its checklist. Record the actual closing date to preview a closing update for the borrower and any linked realtor. The same actual date supplies the anniversary reminder once the loan is funded or closed.

After accepting a sample linked to a condition, record mock delivery to get a receipt. Choose **Check UWM clearance (mock)** from the checklist to refresh that submission. The checklist keeps the acceptance and receipt, and the lender card shows the clearance separately. The brokerage-wide **Sync UWM** also applies mock clearances.

Open **Mock UWM delivery timeline** on the lender card to see 1003 revisions, original acknowledgments, condition document receipts, failures, and tracked condition changes. In fictional workspaces, select a cleared condition and replay an older open update and a duplicate clearance. The timeline records each outcome and links to the condition.

Each submitted or corrected 1003 appears once under **Tasks → Playbook tasks**, with the brokerage’s review deadline. The loan officer and assigned processor can open the current application from their queue. **My Tasks** uses your signed-in account for matching. New loans start assigned to you. For existing loans, open **Edit loan** and select **Assign to my account** to connect the assignment to your login.

When a 1003 is submitted or a loan changes pipeline stage, Orbit creates a draft for the borrower and any linked realtor. Open **Communications** to see the queue or open a loan to see its draft history. Preview email or text and copy it to use in your messaging app. The history records when each channel was first copied. Realtor drafts contain only a milestone update. Drafts from earlier stages remain in the history.

Open **Realtors**, select a partner and the receiving loan officer, then choose **Create referral link**. The private link expires after seven days. From **Open realtor view**, submit a fictional prospect with an email or phone number and permission to share it. The portal shows **Referral received** and later shows the loan’s milestone.

To change who receives future referrals, choose an active officer or **Shared inbox** and select **Save referral routing**. The realtor keeps the same link and expiry. Earlier referrals keep their owners. When the brokerage has a shared inbox or assigned officer rule in **Lead Inbox**, that rule takes precedence over the saved link owner.

In **Team → Review offboarding**, hand off a departing teammate’s work and redirect any realtor links, brokerage-wide realtor routing, or enabled website quote form assigned to them. Choose an active officer or the shared inbox for each route. Use **Contact conversation** to find open contact threads and transfer them to an active officer or admin. Reply status, history, and follow-up dates carry over to the new owner. If access needs to be removed immediately, outstanding work and routes remain available in **Recover open work**.

Admins can opt in up to 20 active LOs under **Lead Inbox → Shared realtor claim eligibility**. Approved LOs choose **Shared realtor referrals** in the lead view to see the referring partner and first-contact status. Claiming moves the referral to **Mine**, opens borrower details, and keeps the original deadline. Clearing the approved officers closes the claim queue while they retain referrals already assigned to them.

In **Reports → Referral queue**, managers can open the oldest unassigned referrals, check first-contact status, and assign a waiting referral to an active officer without leaving the report. Assignment keeps the first-contact deadline. **Claim history** shows who picked up referrals in the past 7 or 30 days. Pickup time runs from entry into the shared inbox to the claim. The average uses claims with a recorded queue start.

The receiving officer opens **Tasks → My Tasks** and reviews **Incoming referrals**. A first-contact follow-up is due in 24 hours. Orbit flags existing borrower or co-borrower contacts with matching email or phone. The LO can use a match they have access to or choose a separate contact. A brokerage admin can review matches outside the LO’s assigned loans. Referrals from older links with no assigned officer appear in the brokerage admin queue.

Choose **Create loan and prefill 1003** to open the new loan’s application panel. Share its borrower link using **Copy link**. The draft starts with the saved contact name, the referred loan purpose, and the email and phone supplied with the referral. Missing contact fields use the saved contact details. The borrower can edit those fields and save and resume as usual. Email and document scanning are simulated in the original demo.

In **Realtors → Partner conversion**, filter the cohort by lead date, current officer, or source, then select a count to open the underlying records. A converted lead counts once. **Submitted 1003s** uses the first submission even while corrections are outstanding. **Funded loans** uses the recorded funding event. For older files, enter the funding date in **Closing workbench** if you want the file counted as funded.

**Past Clients** lists funded and closed loans. Choose **Edit follow-up** to record the actual closing date. Orbit schedules an annual task for the assigned loan officer and adds the next year's reminder when the workspace is opened after the anniversary. February 29 closings use February 28 in non-leap years. To enable the rate watchlist, record the current note rate and a lower target. Enter an observed rate to compare against that target. When it meets the target, Orbit adds a follow-up task.

## Rehearse sample disclosures and critical dates

In a fictional workspace, review the submitted 1003 and save a sample quote. Open **Disclosures** on the loan to load and save sample fees, choose the sample documents and signing target, then prepare and issue the package. Record each borrower’s simulated signature or decline. The workbench keeps the issued fee snapshot, the target dates, and mock receipts with their package version.

Open the issued package on the borrower’s existing application link. Each linked signer reviews the sample documents and records their own simulated response. The portal shows that signer’s receipt, and staff see the source and time on the loan. A package needing review or superseded by a draft cannot accept further responses.

A mock decline closes the signing reminder and adds a follow-up in **Today**. Open **Disclosures** to record a private note or prepare a revised package. Both options clear the follow-up, and the original response and receipt stay in history. A missed signing target appears as past due while pending mock responses remain available.

Edit the selected quote’s fee worksheet after preparing a package. **Today** shows a review task that opens **Disclosures**, where staff can compare the changed amounts and record an internal review note. The revised package retains who reviewed it and when, closes the task, and starts with pending signers. Earlier documents, fee estimates, and responses remain in the package history.

After each signer has a mock receipt, open **Closing → Sample disclosures for closing** and confirm that version. The assigned processor can review the same 1003 revision, fee worksheet, signer receipts, and change review. After a package changes, the prior confirmation stays in the closing history and the new package has its own confirmation.

Choose **Prepare sample closing packet** and download the internal PDF. It captures the confirmed disclosure, mock receipts, critical dates, and the current checklist. Updating the checklist or confirming a revised disclosure allows staff to prepare another packet while keeping earlier downloads intact.

In a fictional pilot, the finance owner can open a funded loan in **Financials** and record sample purchase advice and one or more settlement receipts. **Settlement exceptions** groups differences, matching totals to confirm, missing evidence, and reviewed differences. Each row opens its exact funding cycle. Corrected advice and receipt reversals keep the earlier evidence, and a funding reversal archives that cycle. Use fictional references and amounts.

## Rehearse a missing mock lender receipt

On an active fictional loan with a reviewed 1003, open **1003 → Rehearse a missing mock UWM acknowledgment** and simulate the missing receipt. In **Today**, open **Check mock UWM submission receipt**. Select **Check mock UWM for receipt** to recover the original acknowledgment and open its conditions. The receipt stays tied to the reviewed 1003 version, and recovering it closes the task.

## Rehearse a brokerage migration

1. As an admin in a fictional pilot brokerage, open **Migration**. Load the sample CSV or download the template. A lead can point to a contact's external ID. Each note or task points to a lead's external ID. Use active brokerage staff email addresses to assign owners, or leave them blank for the shared inbox.
2. Review the mapping and choose **Preview migration**. In **Owner mapping**, choose an active LO or admin for each missing staff email, or leave the work unassigned. Orbit saves those choices for later batches in the same numbered export. Resolve duplicate contacts by reusing an existing contact or skipping the flagged row. Preview your choices, review the counts, and choose **Import reviewed records**. Keep the source key stable across batches so the same external IDs reconcile without creating more records.
3. As the assigned LO, find imported tasks under **Tasks**, then open the lead. Converting the lead carries the notes and tasks onto the loan and prefills its 1003.
4. As a brokerage admin, open **Reports**. Choose an officer, source, or date range and save the view. Select a count to open its leads or loans. Lead response and conversion use a lead creation cohort. The funding totals use the target closing date and recorded funding date, respectively.

In **Reports → Returning clients**, select an officer’s count to open completed check-ins, open callbacks, or returning-client 1003s. The date range applies to check-in completion, callback due dates, and repeat lead creation. Callback counts follow the current assignee and exclude blocked prospecting reminders.

From **Open callbacks**, choose **Reassign follow-up** or **Complete follow-up** on a result. Reassignment moves the callback to the new officer’s count. Completing it saves the outcome to borrower history and removes it from open callbacks.
5. In **Migration**, load the synthetic MISMO 3.4 sample, review the mapped name, loan, and property fields, and confirm the values are fictional. Create the 1003 draft, then use **Export original XML mapping** on the loan to download the reviewed fields and load them back into the preview. This is a limited mapping rehearsal. Lender submission requires the applicable full mapping, schemas, and validation. [Fannie Mae Form 1003 and ULAD resources](https://singlefamily.fanniemae.com/delivering/uniform-mortgage-data-program/uniform-residential-loan-application)

To move a fictional CRM snapshot between Orbit brokerages, choose **Download CRM export** and save every numbered CSV from that export. You can also use **Copy CRM CSV** or **Copy batch** and open **Paste CRM CSV** in the destination. Load each batch in order. Each batch has up to 100 rows. The snapshot is capped at 1,000 records and 2 MB of CSV data. The destination records each committed batch and shows the next batch when you preview it again. Links use the source record IDs, so contacts and leads can be imported before related notes and tasks in later files.

Orbit exports carry tracked campaign callback promises on open leads, including original and measured deadlines, current tasks, and exact call evidence. Import the preceding call notes and tasks before their callback rows. The destination restores the campaign link and uses the mapped lead owner for open work.

In **Migration cutover checklist**, review callback readiness for each source before marking it reconciled. The check separates ready, held and closed promises from missing owners, missing evidence and tasks that need recovery. If the evidence changes after sign-off, the callback check asks for another review.

Original Orbit batch files restore contact follow-up outcomes and callback date changes with the recorded actors, dates, and reasons. Use owner mapping for staff who differ between brokerages. A restored post-funding callback remains usable as contact work. Loan files travel separately from the CRM snapshot.

When importing a synthetic MISMO 3.4 file in **Migration**, use **Search borrowers** to find the restored borrower and select them under **Borrower contact**. Search starts with the full XML name, including a middle name and suffix when supplied. The draft keeps the reviewed name and fills email and phone from the selected contact. Choose **Create a new borrower contact** when the file belongs to a new client. After saving, Orbit opens the draft on the loan’s **1003** tab.

If the selected borrower already has an imported 1003 with the same reviewed XML values, choose **Open matching 1003** to continue that file. Use **Create separate draft** when the matching values belong to another loan for the same borrower.

Use **CRM import recovery** in Migration to preview the latest 20 import receipts. It compares newly created records with their state at import and flags shared links, loan files, changes, completed work, and outreach opt-outs. Review numbered batches from last to first. Confirm undo to remove the eligible fictional records from the selected receipt. Orbit rechecks the preview, records each removal, and shows those source IDs as **Undone** if you load the CSV again.

Use **Open record** or **Open evidence** on a committed import row or recovery receipt. A converted lead opens its linked 1003, and a contact follow-up opens its task with the original deadline. If the link from that receipt was removed or replaced, Orbit reports that the original record is unavailable.

To reimport a corrected CSV, keep its source key and external IDs. Select **Reimport selected undone rows** and preview. Check individual records or use **Select all undo rows**. Preview again and choose **Import reviewed corrections**. Include any undone parent records in the selection or correct them first. The cutover checklist tracks pending restores separately from received batches. Orbit keeps the original undo receipt and records the correction separately.

Open **Migration cutover checklist** and choose the migration source. Compare received numbered batches, source links by record type, rows still awaiting reimport, and linked 1003 drafts. Expand **Linked 1003 drafts** and choose **Review file evidence** on the exact loan. Open its application, document checklist, lender conditions, or closing workbench directly. Record a decision and evidence note for each category. **Source reconciliation** keeps the export-wide checks separate. Orbit records the reviewer and time. A newly committed export under the same source starts a separate set of manual reviews.

**Imported 1003 comparison** shows changes, missing values, and additional borrower counts for the mapped source fields. Complete missing values before marking application coverage reconciled. Review the remaining 1003 sections separately and document accepted differences in the evidence note. A later change to application evidence asks for another comparison.

Under **Source file inventory**, download the sample JSON and upload the fictional source checklist for that draft. Include `documents` for document requests and `lenderFiles` for lender references, statuses, and conditions. An empty array confirms the source has no records in that category. Omit a category if its inventory is unavailable. Each upload replaces the previous inventory for the selected draft and export. Compare the source and Orbit records, restore missing items, and record an evidence note for each completed category. A subsequent change to the reviewed evidence can reopen its sign-off. Review document files, version equivalence, and lender confirmations separately.

Add `funding` to compare actual closing and funding dates, the funded loan principal in cents, and the current borrower check-in, realtor thank-you, and any next follow-up scheduled during the check-in (`borrowerCallback`). Use `null` for a missing date, amount, or follow-up. Orbit compares the principal used by its Funding Dashboard and dates in Eastern time. Historical reversals and settlement or accounting amounts require separate review.

Use **Cutover readiness** to see file counts and source checks together. **Ready** means all four file comparisons have current sign-offs. **Reviewed with exclusions** means at least one check was marked out of scope and the rest are current or excluded. **Needs review** shows the first issue on the file, with all checks, reasons, and recorded reviewers under **Checks and sign-offs**. The source checks report import completeness, unrecovered rows, callback status, and source-wide reviews separately. Whole-source file totals cover up to 100 linked drafts. Larger sources can be reviewed page by page.

Choose **Download handoff report** to save a timestamped, printable HTML snapshot of the selected source. Orbit checks the current export and every linked file at download time, including drafts on other pages, with the same 100-file limit. The report includes source receipt details, open checks, exclusions, file references, and reviewer attribution. Borrower details and review notes remain in Orbit.

To work a report item, select its **Migration source**, paste its full **Orbit file reference**, and choose **Find file**. Orbit opens the matching draft’s current checks, evidence, and reviewer attribution even if it is on a different page. Select **Back to linked files** to return to the list.

## Rehearse a manual lender upload

In **Demo Guide → Campaign**, choose **Manual MISMO path** after reviewing the 1003. Save a mock quote and download the fictional XML. Choose **Record simulated acknowledgment** in the export panel to record the response, create the fictional lender file, and open its checklist. Add a condition and work it from document request through recorded delivery and clearance. The guide then unlocks closing and funding. The walkthrough runs locally with the existing SQLite preview and fictional documents.

Open a reviewed pilot 1003 and expand **Manual lender export**. Confirm the borrowers' given and family names and download the MISMO 3.4 XML. The download uses the reviewed application and saved lender details. It records a preparation event on the loan. After an authorized handoff, use **File readiness** to log the lender's response or record delivery.

The fictional XML maps core borrower, property, employment, income, asset, liability, and loan details. Use the review list in Orbit to identify fields to finish in the receiving system. The pilot download excludes taxpayer and account identifiers and signatures. Validate the lender's accepted profile and import behavior with approved test files before a live upload. [Fannie Mae 1003 and ULAD resources](https://singlefamily.fanniemae.com/delivering/uniform-mortgage-data-program/uniform-residential-loan-application)

## Start with My Tasks today

First contacts and campaign callbacks open the current lead and campaign directly. If the lead moved to another officer or the task closed, refresh **My Tasks** to update the queue. A rescheduled callback opens with its latest due time.

Open **Today** to see your overdue and upcoming first contacts, callbacks, loan tasks, closing dates, and mock lock expirations. Choose **Due today** or **Next 7 days**. Select a row to open the lead, campaign, follow-up, or loan workbench. **Refresh My Tasks** reads the current queue. Use **Open full task queue** for the broader workflow and records added since the workspace opened.

In **Today → Stalled loans**, review active files assigned to you that have spent at least seven days in their current stage. Filter by stage and choose **Open next action** to load the latest task, condition, or loan section. The queue excludes paused, ended, and funded files. A fresh fictional scenario includes Morgan Pilot Borrower as a nine-day sample.

Brokerage admins can open **Reports → Pipeline workload** for active and stalled counts by stage. Select an owner or **Unassigned**, then choose a stage card to filter the stalled list. Owner counts cover all active stages. Use **Open next action** to check the file’s current task, condition, or loan section.

In **Today → My production**, set personal funded-count and principal targets for the current Eastern month. View current and prior month results and open the funding records behind each total. Results follow the currently assigned officer and recorded funding date. In **Past-client opportunities**, open a rate-watch task with its recorded rate and target or an anniversary follow-up due within 30 days or overdue. Completing the task removes it from this view.

**Replies needing attention** shows your lead, loan, and contact threads that still need a response. The newest reply page checks every 15 seconds while Today is visible and the loan drawer is closed. Open the conversation to work the reply. Marking it read clears the unread badge and keeps it in the queue until you log a response or close the thread. Any scheduled follow-up appears on that card and remains on Calendar. The card and conversation show an open campaign callback before and after 1003 conversion. **Open promised callback** checks the task and displayed time, then opens the campaign lead or focuses the carried task on the new loan.

## Work assigned processing files

Open **Processing** as a processor to see your active files or as an admin to see the team's assignments. Choose **Ready to accept** to find handoffs that need acknowledgment. Open the handoff to accept it, or jump to the next open lender condition or the closing workbench. **Refresh processing** finds new assignments. Opening a file reads that loan and checks your current access.

On **Assigned files**, **Replies needing attention** shows loan conversations owned by the current processor. Admins see the team's processor-owned replies, including threads awaiting a new processor. Open the exact thread to log a response or close it. Follow-up dates stay on the reply card.

Admins can use **Unassigned** to assign a processor, **Stalled handoffs** to work files past the brokerage playbook deadline, and **Aging conditions** to open the oldest dated conditions. Conditions are marked **Aging** after seven elapsed days. Reopening a condition starts its clock again. Older conditions without a recorded opening remain visible on their loan.

Choose **Manage assignment** on a processing file, its handoff, or a manager exception to change the loan officer or shared processor. Replacing a processor on an active handoff preserves the handoff note and deadline. The loan's open tasks follow the loan officer assignment. **Team → Loan reassignment** also lets an admin search the loan list and open the same editor.

## Work shared borrower and realtor conversations

Open a loan, choose **Activity**, then choose **Open borrower conversation** or **Open realtor conversation** under Communications. Start the conversation and log an outbound contact, an incoming reply, or an internal note. **Simulate sample reply** records a fictional inbound email. It moves the conversation to **Needs reply** and marks it unread for the staff team. **Mark read** clears the shared unread flag. An outbound log moves it to **Waiting on contact**.

Set a follow-up date to surface due work in **Communications → Follow-up due**. An LO-owned follow-up also appears in **Today**. Hand off to the loan’s assigned LO or processor to move responsibility while keeping the history. Only the current conversation owner or a brokerage admin can make changes. The participant must still be linked to the file. This history stays in the staff workspace. Use fictional information in the demo.

From a contact’s history, choose **Open contact conversation** to keep relationship outreach in a thread between loans. The staff member who starts the thread owns it. An admin can reassign it to an active LO or admin. Scheduled follow-ups appear in the owner’s **Today** and **Calendar**, subject to the contact’s outreach preferences.

Use **Search → Conversations** to find lead, loan, and contact threads you can access. Search by name or conversation status. Results distinguish the three record types and open the exact thread. Search indexes conversation metadata. Message text and internal notes are available in the authorized conversation history.

In a fictional pilot, admins can open **Communications → Reply review** and simulate an inbound email or text. Load the campaign example after completing **CSV to repeat loan** to see the contact and two loans for the same borrower. Replay the source event to see the duplicate count, then select the contact for a relationship follow-up or the matching loan for a file-specific reply. Open the linked conversation to review the simulated message. Replies with no match can stay pending while the contact is updated, or be dismissed.

## Compare campaigns and realtor referrals

Open **Realtors** as a brokerage admin. Search the partner directory, then open a referral, submitted 1003, or funded count to see its records. Open a prospect in Lead Inbox or its archive, or jump to the application or funding section of a loan. Conversion credit follows the original referral when present. Choose the realtor's name to manage their link and view loans currently linked to that partner.

Open **Reports → Sales conversion** as a brokerage admin. Select **Campaigns**, **Realtors**, or **Lead sources**, then set the inclusive Eastern date range and optional current owner. The selected period and the immediately preceding period use the same number of calendar days. Click a total to see its contributing records and open the relevant lead, loan, or repeat 1003.

Campaign cohorts use enrollment date. Realtor cohorts use referral receipt date. Lead sources use the original intake date and attribution, including direct files without a separate lead. A converted lead counts once. A campaign enrollment preserves the original source, and Campaign import applies to a lead first imported through a call campaign. Outreach means a manually logged call or contact outcome. Funding uses recorded funding, and repeat business requires a separate 1003 linked to that funded file. Outcomes can occur after the cohort date range. A lead can appear across channels, so compare each channel separately.

Choose **First 7 days**, **First 30 days**, or **First 90 days** to count outcomes only during the same number of Eastern calendar days after each lead enters, including the entry day. **Still maturing** opens leads whose window is still running. They enter the conversion denominator after the window closes. Older logged calls without a recoverable date count in **All recorded outcomes**.

Open **Saved views and conversion targets** to save applied filters and restore them after reload. Targets are percentages of eligible leads and apply across all owners for the selected channel and follow-up window. Filter to **All owners** to set or compare the targets.

## Review projected and actual funding

Open **Reports → Funding dashboard** as a brokerage admin, or **Reports** in the local development demo. Set an inclusive date range and officer, then choose **Apply filters**. Projected funding uses target closing dates on active unfunded loans. Actual funding uses recorded funding dates. Select any total to open its loan list and drill into the closing workbench. The previous period has the same number of days immediately before the selected period, and the timestamp shows when Orbit checked the records.

Save the applied filters and drilldown as a named funding view. Choose all officers and a full calendar month to set the brokerage’s funded loan count and principal targets. Select **Open loan** for a fresh view of its closing facts. Select **Open closing workbench** when that file is loaded in the workspace.

## Prepare a quarterly call report review

1. Sign in as a brokerage admin and open **Reports → Call report**. Select the reporting year and quarter. Filter by confirmed property state or originator NMLS ID. Choose a count to see the loan records behind it.
2. Open a loan in **Needs review**. Confirm eligibility, property state, originator ID, application date and amount, and any outcome. Orbit can suggest values from the first submitted 1003 and recorded funding. The review holds missing values and funding conflicts out of the confirmed subtotals.
3. Download the review CSV. It lists the loan IDs, confirmed facts, quarter categories, exclusions, and unresolved issues. The worksheet covers selected residential mortgage activity for broker review. It uses application intake amounts for beginning and ending pipeline and leaves net amount adjustments, fee data, financial condition, and submission to separate review. [NMLS Mortgage Call Report resources](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/pubs/mcr/index.html)
4. Open **Loan audit history** on a loan and load the timeline. It shows tracked changes and their actors, timestamps, and before and after values from the feature's release forward. An included loan must have its reporting eligibility reviewed before it can be deleted.

## Try mock credit and automated underwriting

Open any sample loan and find **Credit & AUS** in its details. Select **Confirm mock credit authorization** and **Run mock credit** to generate a fictional score and report reference. With that report available, run **Desktop Underwriter (DU)** or **Loan Product Advisor (LPA)** and review the sample findings.

Choose **Temporary failure** for credit, DU, or LPA to simulate a timeout. The corresponding **Retry** action creates a new attempt and preserves the failure in **Previous mock requests** and the loan’s activity. **Review required** returns findings for the LO to evaluate. Running AUS again after a new credit report links the new findings to that report.

## Work a loan and price a scenario

Open **Tasks** to filter by loan officer, due time, or completion. In the local demo without Google sign-in, **My Tasks** shows the sample officer Alex Morgan. From a loan, add a follow-up and log notes, calls, email, or texts on its activity timeline.

Choose **Prospecting** for new-business reminders and **Loan service** for work on a borrower’s file. An outreach opt-out blocks prospecting reminders in My Tasks and keeps them in the task history. Existing manual loan and imported reminders use Loan service, and existing contact reminders use Prospecting. In a migration CSV, the optional `taskPurpose` column accepts either label.

Admins can use **Tasks → Contact follow-ups → Reassign follow-up** to move an open reminder to an active officer. The new owner sees it in **My Tasks** and can record an outcome and optional note under **Complete follow-up**. Contact history shows the latest outcome and who recorded it, alongside the original activity. Reopening keeps the previous completion in history.

Open a loan’s **Activity** or a contact’s **Contact history** for the newest 30 events. Contact history includes logged inbound and outbound messages from accessible contact, linked lead, and loan conversations. Select an entry to open its thread. Internal notes and workflow changes stay in the source conversation. Use **Load older activity** to view earlier entries.

Admins can choose **Review duplicates** from **Contact history**. Select a match, choose the primary record, and preview the details and links that will move. Compatible records keep their existing loan files, campaign membership, conversation history, and opt-outs. The preview blocks conflicting contact details, separate threads or portal links, and records tied to a resettable scenario.

After importing contacts, open **Contacts → Possible duplicates** to find groups that share an email or phone. Choose a group and compare two records to preview their linked work. If a pair shares both fields, merging it resolves both matches when no other contacts share those details.

Use **Keep these contacts separate** after reviewing every contact in the group. Enter the reason to remove that email or phone group from the open queue. **Review history** shows who decided and why, and lets admins return the group to review. Orbit also returns the group when a contact’s name, email, phone, or role changes or membership changes.

In **Contacts → Merge history**, admins can review merge and undo receipts. Choose **Review undo** to see the links that will return to the original contact. Undo is available for merges with an unchanged primary and linked records. Older merges without a saved baseline and merges affected by outreach opt-outs remain in history for review.

Open a loan and select **Price loan**. A new pricing form uses available 1003 inputs and the current mock credit score. For a standalone pricing demo, choose **Load sample scenario**. Choose **Run pricing**, compare conventional fixed-rate examples, save an option, and use **Preview borrower quote**. A new pricing run preserves the last saved quote until the LO selects another.

Choose **DSCR** to enter rental income, property taxes, insurance, HOA dues, and reserves. Each mock offer shows housing cost and estimated rent coverage. Choose **Bank statement** to enter 12 or 24 months of personal or business statements, average eligible deposits, and other monthly debts. The business option also uses an expense factor and ownership percentage to estimate income and DTI. Both scenarios support sample rate-and-term and cash-out refinances. These are Orbit demo inputs. The live Easy Qualifier request fields and product rules need validation in UWM stage. [UWM program overview](https://www.uwm.com/real-estate-agent) · [UWM bank statement products](https://www.uwm.com/loan-products?bank-statement=bank-statement-fixed-blue&bank-statement=bank-statement-fixed-yellow)

After a 1003 is submitted, **Publish sample quote** in the quote preview shares the saved quote on the borrower status page. The LO can replace or remove the shared quote. Saving a different quote keeps the existing published terms visible until the LO publishes the replacement.

To demo a rate lock, open a loan with a synced UWM file, such as Charlotte Kim after **Sync UWM**. Save a sample quote and choose **Float rate (mock)** under **UWM rate lock**. Select a sample lock period and choose **Request lock (mock)**. Orbit records the float and lock confirmations, the selected terms, and the lock expiration in the loan record. A reviewed demo 1003 sent with **Send to UWM (mock)** also supplies a UWM file for this flow.

An active mock lock can be extended by 7 or 15 days from its current expiration, or cancelled with confirmation. Orbit keeps the original lock confirmation and records the change in the activity timeline. **Tasks → My Tasks** lists assigned active locks expiring within seven days, soonest first. **Open item** opens the lock panel on the loan.

The server-side pricing provider defaults to sample pricing. The initial UWM Easy Qualifier adapter supports conventional purchase and rate-and-term refinance in UWM stage. To test locally with UWM-issued EQ credentials, set `ORBIT_PRICING_MODE=uwm-stage`, `UWM_EQ_CLIENT_ID`, and `UWM_EQ_CLIENT_SECRET` in the server environment. Optionally set `UWM_EQ_BROKER_ALIAS` and `UWM_EQ_LO_EMAIL` for the broker shop. Use synthetic scenarios and confirm access with UWM. The adapter uses the EQ quote and disclosure endpoints and keeps credentials server-side. Future providers implement the same pricing interface. [UWM pricing documentation](https://developers.uwm.com/portal/instant-price-quote/docs/151)

The demo follows the [Uniform Residential Loan Application](https://singlefamily.fanniemae.com/delivering/uniform-mortgage-data-program/uniform-residential-loan-application) sections for personal information, employment and income, assets and debts, real estate, loan and property, declarations, acknowledgments, military service, and demographics. Add joint borrowers and repeatable records for jobs, accounts, debts, and properties. Staff can review answers and save the lender and originator supplement separately. The borrower link grants access only to its assigned application. Use fictional data, test tax IDs in the `000-00-####` format, and sample account references. Typed names demonstrate signing and are not a production e-signature integration. Live MISMO delivery is outside the demo.

Address fields support manual entry. Enter a U.S. ZIP to suggest an editable city and state. Without Places configured, type **100 Sample** to try a fictional street suggestion. The ZIP index in `src/data/us-zip-cities.json` contains ZIP, locality, and state columns extracted from the November 6, 2026 [GeoNames US postal code download](https://download.geonames.org/export/zip/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

To prepare an itemized sample quote, open **Preview borrower quote** and save the selected option’s **Fee worksheet**. For a purchase, enter the purchase price, fees, deposit, and any credits. For a refinance, enter estimated payoffs and fees. Points or lender credits come from the saved pricing option. **Choose alternatives to compare** lets you include up to two more options for the same loan purpose. Publish after the borrower submits the 1003. The borrower sees the exact terms and fees that were shared, and worksheet edits appear only when the LO publishes an update.

### Google Places street lookup

Link a billing account to the OrbitLOS Google Cloud project and enable [Places API (New)](https://developers.google.com/maps/documentation/places/web-service/cloud-setup). Create a separate server-side API key restricted to Places API (New), configure conservative API quotas, and store the key as `GOOGLE_PLACES_API_KEY` in the Orbit Worker. For local Next.js use, provide the same setting in the server environment. The key never goes to the browser. The **Search with Google Maps** button sends only the typed street and ZIP through the server. The endpoint checks the active borrower link and limits lookups to 35 requests per loan per 15-minute window. Only the address the borrower picks and saves is stored. The disclosure is available at `/address-lookup`.

## How it fits together

- `src/components` contains the Next.js workspace UI. Typed server actions in `src/app/actions.ts` validate and save changes.
- `src/lib/store.ts` defines the shared SQLite schema. Contacts, loans, lender submissions, and activity have separate records. Lender references are unique per lender within this workspace.
- `src/lib/uwm.ts` holds the mock connector, maps UWM's Insights and conditions response shapes, and saves a complete sync in one transaction. A live UWM adapter can implement the same connector. Other lenders can map their own payloads to Orbit's submission model. Syncing may re-import a loan removed locally if it is still present in the mock feed.
- The demo uses individual staff accounts, isolated brokerage workspaces, sample lender data, and manual sync. The separately maintained UWM API reference covers planned live credentials, events, and MISMO submission.

## Hosted demo

### Public website and demo requests

The public `/demo` form sends a notification from `demo@orbitlos.com` to the verified demo inbox through the `DEMO_EMAIL` Cloudflare binding. The prospect's email is the reply-to address. The form confirms only after the provider accepts the send; errors retain the visitor's entries and offer the email fallback. Requests are not saved in a brokerage workspace. The separate `demo@orbitlos.com` Email Routing rule forwards direct emails to the same inbox.

`DEMO_RATE_LIMIT` limits submissions to three per minute per client IP per Cloudflare location. The handler also checks origin, input sizes, required fields, and a honeypot. It accepts POST JSON at `/api/demo-request`; production depends on the configured Email Routing domain and verified destination. Local Wrangler uses simulated email unless a preview config explicitly enables the remote email binding without `--local`.

Run `node --test tests/demo-request.test.mjs` for request validation and delivery-failure checks. The website's sample workflow images and 1200×630 social preview live under `public/marketing`. Update the public asset allowlist in `src/worker.ts` when adding images. Product availability and buyer FAQ copy describe the fictional pilot; confirm release readiness before advertising additional capabilities.

The public site is [orbitlos.com](https://orbitlos.com/). Choose **Log in** to open the protected staff workspace at `/workspace`. The Cloudflare Worker uses a shared demo password until Google sign-in is enabled. Its SQLite database lives in a Durable Object and is separate from the local workspace. Use sample data for the demo.

Use `npm run build:cloudflare` for a hosted build. To preview it locally, set a disposable `DEMO_PASSWORD` in `dist/server/.dev.vars` after the build, then run `npm run preview:cloudflare`. The preview uses local storage and signs in with the username `orbit`.

Build from a clean checkout with Node 24, `npm ci`, and `npm run build:cloudflare`. Set `ORBIT_DEMO_INBOX` in the deployment environment or in the ignored `.orbit/release.env` file. Then run `npm run deploy:cloudflare`. The script supplies the verified address privately to the restricted email binding and tags the Worker version with the Git commit when the checkout is clean. The first deployment requires configured staff sign-in. A local shared-password preview uses the `DEMO_PASSWORD` Worker secret.

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

For engineering verification, the [local brokerage recovery rehearsal](docs/workspace-recovery.md) runs the built Worker against isolated fictional SQLite stores.
The [local working-day rehearsal](docs/working-day-rehearsal.md) exercises the imported-lead path through separate owner, LO, and processor sessions.

In **Team → Create brokerage**, select **Create as a fictional pilot workspace**. In the new workspace, invite staff by their Google account and share the workspace link. The invitee uses **Continue with Google** and lands in that pilot after signing in with the invited account. When the LO is active, select them and choose **Load fictional scenario**. The LO gets Riley Pilot Referral in **My Tasks** and Morgan Pilot Borrower in the pipeline. The admin can open or copy Taylor Pilot Realtor’s link in **Realtors**.

The pilot walkthrough under **Team** covers referral intake, a prefilled 1003, sample pricing, and mock UWM conditions. The pilot supports on-screen verification codes and built-in clean and blocked PDFs when document upload mode is set to `mock`. Staff can submit feedback by workflow step. Admins can review the feedback and activity from **Team**.

For a shared working-day rehearsal, use the invited LO’s **Today → Next 7 days** to open Riley’s campaign first contact. Convert the referral, submit and review the fictional 1003, then send it to mock UWM from the saved quote. The admin assigns a processor and the loan owner sends the handoff. From **Processing**, the assigned processor accepts, requests the two suggested documents, and clears the accepted mock deliveries after the borrower attaches the built-in samples. Return the file with a note. The loan owner opens the returned handoff from **Today**, completes it, and records closing and funding in the Closing workbench. The realtor link shows the pipeline milestone. Record the post-funding check-in from **Tasks**, then use **Past Clients** to start or reopen the prefilled repeat 1003.

For processor assignment, open **Processing → Unassigned**, choose **Assign processor** on the file, and select an active processor. The file moves to **Assigned files** and keeps its loan owner. Select **Open handoff** in the assignment confirmation to continue on the same file. **Ready to accept** shows handoffs with current application reviews and any required second approval. Review blocked handoffs from **Assigned files**.

Open **Processing → Closing workload** to see files past their target, due within the next seven days, scheduled later, missing a target, or with closing recorded. The seven-day window starts today in Eastern time. Managers can filter by processor or **Unassigned** and assign eligible files directly. Processors see their assigned files. **Open next closing item** jumps to the earliest open checklist item.

To include a callback handoff, record **Requested callback** with a future date during the check-in. In **Tasks → Contact follow-ups**, reassign it to an active LO and note the due time. Have that officer open the callback from **Today → Next 7 days** and complete it. Check the original due time, the completion in borrower history, and the disappearance of the completed callback from Today.

Open an outstanding borrower check-in from **Next action** on the funded loan, **Record check-in** in its follow-up tasks, or **Today** when it falls in the selected window. Saving the outcome completes the original task. If you schedule another call, it goes to the loan owner’s queue, including when an admin records the outcome.

**Reset fictional scenario** replaces the scenario’s seed records and loans converted from its referrals. It revokes the old scenario links and queues the sample files for cleanup. Staff access, feedback, activity history, and unrelated loans remain available.

### Walk through the expanded pilot

1. Create a lead and choose **Save and open 1003**. Save and resume with fictional answers. On the loan, mark the submission reviewed, **Request borrower corrections**, and use the same borrower link to resubmit. Open **Application version history** to compare the previous answers. In **File readiness**, apply a reusable checklist, preview the file summary, and record a manual handoff.
2. Price and save conventional, DSCR, and bank statement scenarios. Use **Compare saved scenarios** to choose a quote. Publish a sample quote, then replace it to see both the current quote and the terms previously shared.
3. Send a reviewed sample 1003 to mock UWM. Accept a sample document, choose **Simulate delivery failure**, and retry. Delivery and clearance are recorded separately. For another lender, add a manual condition, link a document request, record the accepted revision's delivery, and record the lender's clearance when it arrives.
4. Invite a **Processor** in **Team**, then add them as the **Shared processor** on a file after they accept. The LO stays the owner and sends the file from **Processing handoff**. The processor opens the handoff from **Tasks**, reviews documents, and returns it with a note. In **Closing workbench**, staff can record disclosure status, closing, and funding.
5. In **Contacts**, preview a CSV with the columns `name,email,phone,role`. Review duplicates before importing. Open a contact's history to start a repeat loan. From the loan's **Activity** section, log an outreach outcome and follow-up date. Admins can customize draft bodies in **Communications**. Review and edit condition and milestone drafts before copying them.
6. In **Team**, triage pilot feedback and record the retest result. **Pilot measurements** shows elapsed time for core transitions and lets admins record timed Orbit and brokerage walkthroughs for comparison.

### Private PDF upload preview

In the original demo or a fictional pilot, submit a fictional 1003 and request a document on the loan. In the borrower checklist, choose **Get demo code** and enter the code shown on the page. **Demo PDF** includes clean and blocked fixtures for showing both mock scan outcomes. A clean sample reaches the LO’s review checklist and can be downloaded as a demo PDF. The demo accepts only the built-in PDF choices and also offers the original text samples.

In a configured live brokerage preview, an admin adds an email to the borrower contact before sharing the 1003 link. After submission, the borrower requests a one-time code sent to that email and can upload a PDF of up to 5 MB against an open request. A file becomes downloadable after scanning and a second check of the borrower link and email session. Only a brokerage admin or the assigned LO can download it. A clean replacement becomes the current PDF. Private storage cleanup removes superseded files and files from deleted loans.

The hosted Worker binds the private `orbitlos-private-documents` bucket as `DOCUMENTS`. Keep public access disabled for the bucket. Before enabling uploads, onboard the sender domain for Cloudflare Email Sending and add a `send_email` binding named `DOCUMENT_EMAIL`. Use fictional PDFs and a test mailbox in the preview.

Run `node services/document-scanner.mjs` beside a private ClamAV daemon and place the bridge behind HTTPS. The bridge binds to loopback and reads `ORBIT_DOCUMENT_SCANNER_SECRET`. Set `ORBIT_CLAMD_SOCKET` for a private Unix socket or use local TCP port 3310. Keep ClamAV signatures current and configure the daemon to alert on encrypted documents and scan limits (`AlertEncrypted yes`, `AlertExceedsMax yes`). The Worker sends raw PDF bytes to `/scan`. Only an authenticated clean response carrying the matching SHA-256 digest releases the PDF for review.

Set `ORBIT_DOCUMENT_FROM` and `ORBIT_DOCUMENT_SCANNER_URL` on the Worker. Store `ORBIT_DOCUMENT_VERIFICATION_SECRET` and `ORBIT_DOCUMENT_SCANNER_SECRET` as two distinct secrets of at least 32 characters. Set `ORBIT_DOCUMENT_UPLOADS=enabled` once the bindings and scanner are ready. The hosted Worker currently uses `ORBIT_DOCUMENT_UPLOADS=mock` for the original demo and fictional pilot workspaces. Mock verification sessions are separate from live PDF upload sessions.

Run `npm run lint`, `npm run typecheck`, and `npm run build` to check the scaffold.
