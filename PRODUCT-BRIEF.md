# OrbitLOS product vision and scope

The [product north star](PRODUCT-NORTH-STAR.md) defines the shared outcome: a single pane of glass that helps brokers run their business with less cost and repeated work. **Capacity, Security, and Features** are the three delivery pillars. The design target is **40,000 daily active staff users across 18,000–25,000 brokerages**, plus borrower and realtor traffic. This target requires measured validation; it is not a current capacity claim. The [delivery and scale plan](DELIVERY-PLAN.md) owns sequencing and release gates.

OrbitLOS is a one-stop loan origination system (LOS) and customer relationship manager (CRM) for independent wholesale mortgage brokers. A loan officer should be able to take a referral, collect a 1003, work with lenders, close the loan, and keep the relationship in one workspace. The loan record connects borrower and realtor activity to tasks, lender actions, and next steps.

ARIVE is the benchmark for origination. Salesforce is the benchmark for the relationship and sales workflows a brokerage depends on. Start with UWM-heavy independent wholesale brokers and small teams, including teams that place some loans with other lenders. Calyx is a reference for migrating legacy loan files.

## Brokerage replacement criteria

OrbitLOS should let a brokerage bring over its open pipeline and contact history, take new leads through funding, and keep working its borrower and realtor relationships. Test this with a brokerage that currently uses a separate LOS and CRM.

| Workflow | What the brokerage must be able to do in Orbit |
| --- | --- |
| Capture and work new business | Receive website inquiries and realtor referrals, route them to an owner or shared queue, track first contact, and follow up before opening a 1003. Keep the lead source and activity when the prospect becomes an applicant. |
| Win and originate the loan | Prepare a borrower-ready comparison with fees and estimated cash to close. Verify eligibility, review income, order credit and AUS, and record the lender's pricing, lock, submission, and condition decisions. Support a validated file handoff for manual lenders. |
| Process, close, and report | Let the LO and processor work the same file with role-based access. Track disclosures, signatures, closing, and funding. Reconcile production and prepare brokerage reporting, including Mortgage Call Report data where applicable. |
| Keep clients and run the team | Capture outreach and replies, run follow-up sequences, grow realtor relationships, and plan repeat business. Give managers response time, conversion, and projected versus actual funding by officer and source, with access to the records behind each figure. |
| Switch with a verifiable cutover | Import open leads, contact and partner relationships, loan records, ownership, notes, and tasks. Review duplicates, reconcile counts, and retain access to exportable records. Confirm the brokerage can work its day-to-day CRM queue entirely in Orbit. |

Measure re-entry and system switches on actual broker walkthroughs, including a purchase, a refinance, and a referral that needs follow-up before application. Pass the real-data release checks before using real borrower files. Validate the live lender and provider handoffs separately from the fictional pilot. [ARIVE product features](https://www.arive.com/pricing) · [Salesforce small-business CRM](https://help.salesforce.com/s/articleView?id=xcloud.easy_help_understand_smb.htm&language=en_US&type=5)

## What makes OrbitLOS different

1. **Act on lender updates.** A condition should show what the lender needs, who owns the next step, and what happened after delivery. An LO can request the document, review or replace it, and submit or resubmit it where the lender supports that action. Lender confirmation determines clearance. UWM sets the standard for this workflow, and other lenders can start with manual tracking.
2. **Generate business from relationships.** Make realtor referrals, borrower follow-ups, closing anniversaries, and refinance opportunities visible in the LO’s queue. Use the loan’s actual milestones to keep partners informed and track which referrals become applications and funded loans.
3. **Shorten the work.** Carry information forward from referral to 1003 and from loan to lender. Give each queue item a clear action and take the LO directly to the relevant part of the record. Measure time, clicks, repeated entry, and system switches on the same scenarios used to evaluate ARIVE.
4. **Use AI where the LO can verify the result.** Draft a condition response using the specific request and reviewed documents, summarize lender feedback with links to its source, prepare realtor-safe milestone updates, and explain why a past client may be a refinance candidate. The LO reviews outward-facing drafts and decides what to send or submit.

Prioritize features that advance at least one of these outcomes. For each new workflow, identify the broker task it improves and how to tell whether it improved.

## What the demo covers today

| Workflow | Current demo |
| --- | --- |
| Lead intake and CRM | Website quote requests and realtor referrals enter **Lead Inbox**. Admins set routing rules and first-contact deadlines. Staff work mock follow-up sequences, review contact matches, and convert prospects into prefilled 1003s with their outreach history. |
| Partner conversion | Brokerage admins can compare referrals, submitted 1003s, and loans with a recorded funding date by realtor, then open the loan records behind each count. |
| Application and pipeline | Borrowers can save and resume the demo 1003, add co-borrowers and repeatable financial records, and check status after submission. LOs can review the application and lender supplement. The pipeline has board and list views, a loan timeline, tasks, and lender cards. |
| Documents and UWM | LOs can turn a mock UWM condition into a document request and review or request a replacement. The original demo uses an on-screen verification code and built-in fictional PDFs to show clean and blocked scans. Mock submission, delivery receipts, and sync demonstrate the lender workflow. Other lenders can be tracked manually. |
| UWM alerts | Mock sync puts lender status changes and new or reopened conditions in the assigned LO’s **My Tasks**. Each alert opens the corresponding lender card or condition and can be marked reviewed. |
| Pricing and locks | LOs can price conventional, DSCR, and bank statement scenarios, itemize fees, and share up to three sample options side by side. Published terms and fee estimates are saved in quote history. LOs can also simulate floating, locking, extending, or cancelling a UWM rate. Expiring mock locks surface in **My Tasks**. An initial UWM Easy Qualifier (EQ) stage adapter exists for conventional purchase and rate-and-term refinance. |
| Credit and AUS | LOs can confirm demo authorization, generate a mock credit report, and run DU or LPA with fictional findings. Failed requests can be retried from the loan, with earlier attempts and credit references available for review. |
| Communications and retention | Orbit prepares borrower and realtor milestone drafts for preview and copy. Realtors can check milestones in their portal. The closing workbench tracks dates, owners, and open items. Past-client tools include anniversary reminders and a rate watchlist driven by manually entered rates. |
| Brokerage workspace | Approved staff sign in with Google. Admins can assign a processor to a loan while the LO keeps ownership. The LO and processor can review the same file and track the handoff in **My Tasks**. Each brokerage has isolated storage. |

The hosted demo uses fictional borrower data, mock UWM activity, mock email verification, and mock document scans. See the [demo walkthrough](README.md).

## Initial lender and pilot scope

### UWM submission and conditions

Make the UWM workflow the first live lender integration. Validate account entitlements and stage behavior, then connect securely stored brokerage credentials to pipeline and condition sync. Keep the lender’s status distinct from the brokerage’s pipeline stage. Surface meaningful changes in **My Tasks** with an owner, a timestamp, and a link to the next action. Start with reliable refresh and reconciliation, and add event-driven updates where delivery and loan matching are verified.

Map the reviewed 1003 and lender supplement to MISMO, validate the application before sending, and track import confirmation against the correct loan. For condition delivery or resubmission, keep the document revision, lender receipt, and last known status together. Make retries safe and show when delivery, lender review, or clearance is still pending. Preserve manual tracking for lenders without a connector. The separately maintained UWM API reference covers the planned lender connector.

### Borrower and partner handoffs

Carry the referral’s details into the editable 1003 and keep the same loan record through document collection and closing. Give borrowers a clear list of what is outstanding and what is under review. Give LOs a queue for first contact, submitted applications, documents, conditions, and closing follow-ups. Keep realtor views and drafts limited to referral milestones.

Use partner attribution, referral-to-application conversion, and funded outcomes to help the brokerage understand where new business comes from. Keep anniversary reminders and rate-watch follow-ups in the LO’s queue. Support manual sharing while the messaging provider decision is pending.

### Credit and automated underwriting

Use the loan-level **Credit & AUS** workbench to show authorization readiness, track a credit reference, and choose Desktop Underwriter (DU) or Loan Product Advisor (LPA). Keep credit provider and AUS handoffs separate so each can connect when partner access is available.

### Pilot readiness

Before a live borrower pilot, verify workspace and document access, link expiration and revocation, and recovery from interrupted actions. Establish secure credential storage, retention and deletion practices, audit history, and support procedures. Enable live verification and file scanning only after the sender and scanner are configured and clean, blocked, and unavailable outcomes have been tested. Keep partner and lender data separated at every handoff.

## Live provider and expansion scope

The [feature specifications](docs/arive-feature-parity-spec.md) cover the 19 feature groups drawn from ARIVE’s public comparison. Orbit starts with independent brokers and retains contract processing and non-delegated operations as explicit expansion work with separate acceptance. The specification tracks fictional, stage, and production evidence separately.

These are capability scopes, not a separate delivery order. Live credit, AUS, pricing, locks, disclosures, and signatures are requirements wherever the target brokerage's supported workflow depends on them. Their validation is part of the replacement gate, even when provider access controls scheduling. Additional lenders and assistance can expand after the core workflow is proven.

- **Live credit and AUS.** Connect the selected credit partner and validate DU/LPA order, findings, and error handling. A limited pilot can move earlier when access, authorization, and data-handling requirements are ready.
- **Live pricing and locks.** Validate UWM EQ in stage, then expand into a product and pricing engine (PPE) with lender-specific quote, lock, extension, and cancellation capabilities. Evaluate additional providers such as Optimal Blue after the UWM flow is proven.
- **Disclosures and e-sign.** Add provider handoffs, document versioning, signature status, and an auditable completion record.
- **Additional lender connectors.** Reuse the UWM patterns for account setup, submissions, statuses, conditions, receipts, and retries. Define which actions each lender supports.
- **Targeted AI and relationship automation.** Pilot condition response drafts and lender feedback summaries, then add explainable refinance ranking and more partner and past-client follow-ups. Keep borrower and realtor messages subject to LO review.

## Technical foundation

OrbitLOS uses Next.js, TypeScript, Tailwind, and shadcn-style components. The hosted demo runs on Cloudflare Workers with SQLite in a Durable Object per brokerage, private R2 document storage, and Google staff sign-in. Use that deployment and tenancy model for the MVP. Keep provider credentials on the server and use explicit adapter boundaries for lenders, pricing, credit, AUS, messaging, and scanning.

Preserve the loan and lender activity history across provider calls. Record ownership, document versions, delivery receipts, and external references so an LO can recover from a failed handoff and tell which system confirmed each step.

## Build sequence

Follow the canonical increments in the [delivery and scale plan](DELIVERY-PLAN.md): verify the baseline; complete the client lifecycle; make daily work reliable; support brokerage configuration and reporting; prove switching and operation; then demonstrate business value and release readiness. Map existing agent work to these increments before creating new implementation tasks.

Begin capacity measurement, tenant access verification, and recovery work with the baseline. Confirm provider entitlements and validate stage and live workflows in parallel, with explicit supported actions and manual handoffs. Do not accept live borrower files before the real-data gate passes.

## MVP acceptance

The scenarios below cover fictional and credentialed stage behavior as specified. Brokerage replacement additionally requires the delivery plan's live workflow, migration, economic, capacity, security, and operational evidence.

- **Referral to application.** A realtor submits a referral and the assigned LO finds it in **My Tasks**, resolves any contact match, and shares a prefilled 1003. The borrower can resume and submit, and the LO can review it in the same loan record.
- **Application to lender action.** In a credentialed UWM stage test, the LO can validate and import the application, reconcile the lender reference, request and review a document against a condition, and see separate delivery and clearance outcomes. A failed or repeated request leaves a clear next action and a single traceable record of the successful handoff.
- **Communication and follow-up.** An actionable status change reaches the assigned LO. Borrowers see their document requests, and realtors see only the appropriate milestone for their own referrals. The LO can preview the corresponding update before sharing it.
- **Credit and AUS readiness.** The LO can walk through a simulated request, findings, and retry from the loan. The record identifies which inputs and partner handoffs are required for a live order.
- **Daily usability.** Compare referral-to-1003, application-to-UWM, and condition turnaround scenarios with the broker’s current workflow. Record LO time, clicks, fields entered twice, system switches, and any steps that need a workaround. Also track first-contact time, conversion by referral source, and the time from document receipt to lender delivery.
