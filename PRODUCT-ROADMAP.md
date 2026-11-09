# OrbitLOS product roadmap

An independent broker should be able to take a lead, collect and review a 1003, work the file through funding, and follow up with borrowers and realtors from the same workspace. This roadmap covers the work Orbit can build and test while lender and provider relationships develop. Use fictional borrowers, sample quotes and documents, mock UWM and Credit & AUS responses, mock email verification and scanning, and manual communication and lender handoffs. [Product vision and scope](PRODUCT-BRIEF.md) · [Current demo walkthrough](README.md#run-a-fictional-pilot)

## Direction and next release priorities

The [fictional-data demo checklist](docs/demo-completion-checklist.md) passed on hosted release `5b8c8ba4`. The [local brokerage recovery rehearsal](docs/workspace-recovery.md) verified a staged SQLite restore with revocation and checklist replay. The [delivery plan](DELIVERY-PLAN.md) tracks the remaining pilot and platform gates.

The goal is one workspace to run the brokerage, with measurable savings in time and cost. **Capacity, Security, and Features** are required together. Design toward **40,000 daily active staff users across 18,000–25,000 brokerages**, plus borrower and realtor traffic; this is a target, not a verified current capacity.

The [product north star](PRODUCT-NORTH-STAR.md) defines outcomes and the [delivery and scale plan](DELIVERY-PLAN.md) owns sequencing, assumptions, and release gates. Map ongoing implementation to this sequence before adding duplicate work:

| Increment | Outcome |
| --- | --- |
| 0 | Verify the deployed baseline, representative workflows, costs, access boundaries, and architecture risks. |
| 1 | Preserve client history and ownership through lead, loan, retention, and repeat business. |
| 2 | Make the daily queue reliable through exceptions, reassignment, retries, and recovery. |
| 3 | Deliver role-based dashboards, brokerage-specific configuration, and reconciled manager reporting. |
| 4 | Prove migration, onboarding, operation, export, and recovery. |
| 5 | Demonstrate broker savings and pass the applicable capacity, security, provider, and commercial gates. |

Capacity instrumentation, security verification, and recovery work start at increment 0 and continue throughout. Advance through measured capacity stages rather than assuming user count establishes readiness. Live provider work proceeds alongside this sequence; required provider workflows must pass before claiming brokerage replacement.

The [ARIVE feature specifications](docs/arive-feature-parity-spec.md) map F01–F19 into these increments. They include borrower intake and pricing, document exchange, reporting, Zapier, contract processing, and non-delegated operations. The [release baseline](docs/arive-feature-parity-spec.md#current-release-reconciliation) distinguishes existing fictional workflows from the capabilities and provider decisions still open.

## Customer API and MCP

Status: planned, not available to external customers. Deliver a documented, versioned customer API and an MCP server so authorized customer applications and AI assistants can work with Orbit. Both interfaces must reuse the same domain services and authorization rules as the app; do not expose internal app actions or create a second implementation of business logic.

| Phase | Scope | Acceptance |
| --- | --- | --- |
| 1. Contracts and delegated access | Define versioned resource schemas, pagination, errors, compatibility/deprecation policy, and an OpenAPI description. Design customer/client authorization, explicit brokerage selection and consent, read/write scopes, revocation, and admin controls. Verify current MCP authorization and transport requirements during implementation. | Document supported operations, sensitive fields, permissions, client identity, and lifecycle. Demonstrate grant, denied scope, expiry, revocation, and staff removal with fictional users across two brokerages. Google app sign-in alone is not delegated client authorization. |
| 2. Read-only API and MCP pilot | Search permitted contacts and loans; read loan status, conditions, deadlines, tasks, and scoped dashboard metrics. MCP tools expose these supported operations through the shared services. Return bounded records, source references, freshness, and explicit mock/provider status. | Equivalent API and MCP requests return equivalent authorized results. Verify cross-tenant access denial, role restrictions, revoked grants, pagination, minimized sensitive fields, and client compatibility in a fictional-data rehearsal. |
| 3. Narrow write pilot | Add task creation and internal notes with separate write scopes, validated inputs, idempotency, and audit records identifying both the user and client. Define confirmation requirements per operation and enforce required approvals server-side. | Replays do not duplicate work, stale or unauthorized writes fail safely, and an admin can inspect and revoke client activity. Validate permissions again at execution. External sends, lender submissions, credit orders, locks, financial changes, and deletion are excluded from initial tools. |
| 4. Customer release and expansion | Publish setup instructions, examples, supported-client matrix, quotas, troubleshooting, and version lifecycle. Expand operations only with explicit capability and release review. | Pass security, capacity, recovery, support, and applicable real-data gates; retain accurate limits and clear customer control over access. Do not claim compatibility with an AI client until tested. |

Capacity: enforce per-client and per-brokerage quotas, bounded query costs, pagination, timeouts, and tenant fairness. Include API/MCP traffic and automated tool loops in load modeling so they cannot starve interactive staff. Security: validate credentials and delegated permissions server-side; never trust a client-supplied tenant identifier alone. Mask secrets and sensitive fields in logs, treat returned borrower text as untrusted content rather than executable instructions, and prevent tool outputs from granting additional authority. Maintain attributable, appropriately minimized access and mutation audit trails.

Plan contracts and authorization with foundation increments 0–2, the read-only pilot with scoped services in 3, narrow writes and administration in 4, and customer release evidence in 5. Track API and MCP separately in the capability register. Initial development uses local fictional data and mocks under the existing budget. External activation is a separate release milestone; it does not silently expand the current presentation-demo completion gate.

## Foundation improvements paired with feature delivery

Priority: required alongside features, beginning in increment 0. These are planned improvements and validation gates, not completed architecture claims. Preserve working screens, stable record identifiers, and business workflows while replacing risky internals incrementally.

| Foundation | Required work and acceptance | Feature dependency |
| --- | --- | --- |
| Bounded data access | Replace broad workspace reads and mutation responses with permission-scoped queries, indexed pagination, focused aggregates, and targeted updates. Record rows examined, response size, and latency for small and heavy tenants. Migrate existing hot paths incrementally; new features must not add full-workspace reloads. | Dashboards, search, calendar, conversations, and daily queues; increments 0–3. |
| Shared directory capacity | Inventory shared membership, session, and brokerage lookups; benchmark contention and failure impact. Record a measured decision on partitioning or safe caching with explicit revocation behavior. Verify unrelated shops retain service under a hot tenant and directory failures. A shared dependency is a candidate bottleneck, not a proven incident. | Every authenticated workflow; investigation in 0, mitigation before the applicable capacity gate. |
| Durable integration execution | Persist job intent with the business change where atomicity is required; track inbound event identity and processing outcome. Add deduplication, bounded retries/backoff, terminal failure review, replay, reconciliation, and tenant fairness. Verify crashes before and after external acceptance, duplicate/out-of-order callbacks, and unknown outcomes without blindly repeating side effects. | Communications, reminders, automation, lender submissions, and document/provider work; increments 1–2 before live side effects. |
| Consistent provider contracts | Keep provider-specific payloads, credentials, capabilities, external references, and errors behind server-side adapters. Use common domain outcomes and contract tests for mocks and configured providers. Unsupported actions remain explicit; never silently substitute a successful mock result for an unavailable live operation. | Each integration as introduced; start with existing pricing and extend alongside features. |
| Database upgrades and recovery | Establish versioned, resumable tenant schema upgrades, compatibility rules, canary rollout, failure reporting, and tested restore/roll-forward procedures. Define when rollback is safe; preserve acknowledged changes. Test populated older schemas, interrupted upgrades, and per-tenant restoration with reconciled records. | Every persistent feature; start in 0–1, verify each schema change, complete operating recovery in 4. |
| Capacity and permission evidence | Test tenant/role restrictions, revocation, aggregate counts, exports, search, and jobs through server boundaries. Measure representative workloads and recovery against the delivery plan's capacity stages and service gates. Track cost, latency, failures, and queue lag without sensitive data in logs. | Acceptance for every increment; target-scale evidence before claiming 40,000-user readiness. |

Each feature plan must identify its foundation dependencies, implementation owner, test evidence, and remaining limitations in the capability register. Complete the relevant foundation in the same delivery slice or before the dependent feature is accepted. Keep the existing local fictional-data/no-new-spend constraints; local tests do not certify production capacity. Prefer focused changes backed by measurements over a speculative platform rewrite.

## Dashboards: explicit increment 3 deliverable

Status: planned; reuse and verify existing reports and queues before building new views. Dashboards are part of running the brokerage in Orbit. Each metric must lead to the permitted source records and a useful next action.

| Dashboard | Initial scope |
| --- | --- |
| Owner / brokerage | Projected versus actual funded count and volume, funnel conversion, stalled pipeline, production by officer and source, and progress against brokerage targets. |
| Loan officer | Today's follow-ups, overdue leads, stalled loans, upcoming locks and deadlines, personal production targets, and past-client opportunities with explainable triggers. |
| Processing / operations | Open and aging conditions, closing blockers, deadlines, unassigned work, and workload by responsible staff member. |
| Sales / relationships | Campaign response and conversion, realtor and lead-source attribution through funding, and past-client follow-up activity. Distinguish logged outreach from verified provider delivery. |

First-release requirements: date and authorized team/officer filters, saved views, configurable targets, comparable prior periods, and drilldowns that preserve the selected filters. Support useful empty states and show data freshness. Keep projected funding separate from recorded funding; label units, date basis, conversion denominator, and attribution rules. Never imply revenue or ROI from loan volume or missing cost data.

Acceptance across the three pillars:

- **Features:** Each role can identify an issue, open the contributing records, and perform an authorized follow-up, assignment, or file action. Totals reconcile after reassignment, hold/reopen, duplicate handling, and corrected funding dates. Persisted saved views and targets behave consistently across sessions.
- **Security:** Apply tenant and role permissions on the server to aggregates, drilldowns, saved views, and target management. Test two brokerages, restricted staff, and revoked access; hidden records must not leak through counts.
- **Capacity:** Use bounded, indexed queries or maintained aggregates rather than full-workspace scans. Include all four dashboards in the delivery plan's load stages and service gates, with representative tenant sizes and concurrent refreshes. Keep development local with fictional data under the existing demo budget.

Later expansion: configurable widgets, scheduled summaries, and a report builder, after the initial dashboard workflows and metric definitions are verified. Do not describe these as available until implemented and tested.

## Brokerage operations: required workstreams

Status: planned scope; inventory and verify existing foundations before rebuilding them. These eight areas extend the single-pane-of-glass goal beyond dashboards. Prioritize communications, calendar, collaboration, and global search alongside dashboard delivery. Build automation controls with the workflows they govern; financial visibility and operational oversight follow reliable source events. Complete business administration with switching and operating readiness.

| Workstream | Initial scope and acceptance | Delivery mapping |
| --- | --- | --- |
| Unified communications | Shared conversation and reply queues linked to the correct contact and loan, with ownership, unread/awaiting-response state, follow-up, and outreach preferences. Resolve ambiguous matches explicitly. Verify reassignment, duplicate events, suppression, and separate internal versus external content. Distinguish manual logs, mock events, provider acceptance, delivery, and replies. | Relationship history in 1; actionable queues in 2; management views in 3. |
| Calendar and deadlines | Appointments, closing dates, lock expirations, document deadlines, reminders, and absence coverage in one permission-scoped calendar. Verify timezone handling, rescheduling, cancellation, changed deadlines, and reassignment without stale or duplicate reminders. External calendar sync is a separate provider gate. | Daily work in 2; team views in 3. |
| Team collaboration | Internal comments, mentions, review requests, approvals, shared queues, and explicit handoff acceptance. Every request has an owner and completion or escalation state. Verify staff removal and reassignment; internal discussions never appear in borrower or realtor views. | Daily work and permissions in 2; configurable approvals in 3. |
| Global search | Permission-scoped search across contacts, loans, partners, document metadata, conversations, and tasks, with filters and links to permitted actions. Verify revoked access, deletion, ambiguous matches, and index freshness. Search results, snippets, and counts must not reveal inaccessible records. Document-content indexing is later scope requiring its own access and retention review. | Index/access foundations in 1–2; unified search alongside dashboards in 3. |
| Brokerage financial visibility | Expected versus received compensation, loan-level expenses, commission obligations, and estimated margin with explicit inputs and calculation definitions. Reconcile corrections, partial receipts, reversals, and exports to source records. Restrict compensation access separately from general loan access. Show incomplete costs as unknown, not zero. Retain explicit accounting and payroll handoffs. | Source definitions in 0; financial views and reconciliation in 3; operating/export handoffs in 4. |
| Operational oversight | Owned queues for outstanding reviews, missing evidence, exceptions, audit history, and reporting preparation. Track review decisions, evidence versions, unresolved items, and closure. Verify reopened exceptions and corrected records. Operational checklists do not establish regulatory compliance or replace qualified review. | Evidence and ownership in 1–2; oversight workspace in 3; operating procedures in 4. |
| Business administration | Brokerage/branch setup, role templates, staff onboarding/departure, coverage, subscription/entitlement visibility, and support diagnostics. Verify branch scope, offboarding/session revocation, work reassignment, and audited support access. Rehearse subscription states locally without live charges. | Access foundations in 0–2; configuration in 3; self-service operation in 4. |
| Automation controls | Explain triggers and actions; show run history, failures, safe retries, deduplication, pause/resume, and versioned rules. Verify repeated/out-of-order events, provider outage, rule changes affecting in-flight work, and tenant-fair execution. Admins can recover failures without direct database edits. | Foundations in 1; reliable execution in 2; admin controls in 3; support/recovery in 4. |

For every workstream, record an accountable owner, dependencies, current implementation status, known external steps, and acceptance evidence in the capability register. Apply the same Capacity, Security, and Features gates as dashboards: bounded reads and jobs, tenant/role checks on every surface, and measurable broker outcomes. Keep initial rehearsals local with fictional data and mocked providers under the existing budget. Live communications, calendar sync, billing, and other external actions require separate implementation and validation; this roadmap update does not activate them.

The combined acceptance test is a representative working day for an owner, LO, and processor: find work, communicate, schedule, hand off, resolve exceptions, and reconcile business outcomes in Orbit. Record every remaining external step, time spent, repeated entry, and system switch. Migration, export, recovery, and support remain required release gates.

## Documented pilot baseline

The earlier roadmap recorded the foundation below as shipped in the fictional pilot. These are historical scope statements, not fresh verification of the current deployment. Record commit, deployment, walkthrough evidence, and limitations in the delivery plan's capability register before promoting release status. [Brokerage replacement criteria](PRODUCT-BRIEF.md#brokerage-replacement-criteria)

| Order | Build | Acceptance |
| --- | --- | --- |
| 1 · Shipped in pilot | Lead inbox, public quote-request form, routing, and follow-up sequences | A website inquiry or realtor referral enters a shared queue. A routing rule assigns an LO, an overdue first contact appears in Tasks, and the LO can convert the lead to a prefilled 1003 with the same history. Staff can record mock sends and pause, resume, or stop the sequence. |
| 2 · Shipped in pilot | Fee worksheet, quote comparison, and shared processing | The LO prepares a sample quote with itemized fees and estimated cash to close. A borrower can compare up to three published options. The LO and processor work the same file with distinct permissions and handoff tasks. |
| 3 · Shipped in pilot | Migration and manager reporting | An admin imports a fictional brokerage export with open leads, contacts, owners, notes, and tasks. They resolve duplicates and reconcile counts. Managers can save views for lead response, conversion, and projected versus actual funding. Rehearse MISMO import and export with synthetic files. |

As partners provide access, verify UWM submissions, pricing, locks, and condition delivery and clearance in stage. Then validate live credit and AUS, secure borrower document intake, communication capture, and disclosure and signature workflows. Use each live test to update the replacement criteria with supported actions and manual handoffs.

## Pilot workflow acceptance reference

Retain these scenarios when evaluating current implementation. They supplement the delivery plan's stronger business, capacity, and real-data gates; they do not establish production readiness by themselves.

### 1. Make Orbit the LO’s daily workspace

- Put the current stage, owner, next action, due date, and blocker at the top of every loan. Show how long it has been in the current stage. Carry the same information into the pipeline and **My Tasks**, with filters for overdue, stalled, and unassigned work and links to the exact action.
- Build on existing assignments and alerts. Define when a milestone creates work, who gets it, and when it is complete. Reassign open work when a loan changes hands and keep a history of completed work.
- Add an on-hold status and dispositions for withdrawn and lost files. Capture a reason, date, and optional revisit date. Keep the history and define what work resumes when the file reopens.

**Ready when** an invited LO can create a lead, open its 1003, find the next step from **My Tasks**, and see the right work after reassignment, hold, and reopen. Repeating a milestone action creates only one follow-up per qualifying event.

### 2. Get a submitted 1003 ready for processing

- Keep save and resume and manual address entry. Guide borrowers to missing or conflicting answers, including co-borrower and self-employed details. Let LOs request corrections and compare the revised submission with the version they reviewed.
- Add reusable document checklists and a file readiness view that brings together the reviewed application, accepted documents, open items, and mock credit and AUS findings. Show the borrower what to upload, replace, or wait for.
- Produce a reviewable file summary with the current application version, relevant documents, and unresolved items. Let the LO prepare a clearly labeled sample preapproval draft and record the outcome of a manual handoff.

**Ready when** a borrower can resume, submit, correct an answer, and replace a document. The LO can identify what changed, review the latest version, and hand off the file with its unresolved items visible.

### 3. Work scenarios and move loans through closing

- Let LOs compare saved conventional, DSCR, and bank statement scenarios side by side with their inputs and sample terms. Keep the quote the borrower saw in history, flag it when its assumptions change, and record which quote the LO chose.
- Extend manual lender tracking to show outstanding conditions, the next owner, document revision, delivery, and lender confirmation separately. Use the existing UWM mock to rehearse failed deliveries, reopened conditions, and expiring locks.
- Build on the closing workbench with a handoff checklist for the LO and processor. Test permissions for a processor role limited to assigned files. Track disclosure and signature status manually. Record scheduled closing, actual closing, and funding as separate events, then use them to trigger the appropriate updates and past-client follow-ups.

**Ready when** staff can compare quotes, replace a condition document, record delivery and clearance, hand off a file for closing, and see the correct outcome and follow-up after funding.

### 4. Cover the CRM work brokers do alongside origination

- Keep one contact history across multiple loans. Add a CSV import preview with duplicate review and an export so a brokerage can bring over its contacts and referral partners. Keep referral attribution and communication history on the right loan when a client returns.
- Extend call, email, and text logging to capture outcomes and set the next follow-up. Let admins edit templates for the brokerage. Give the LO a queue for first contact, inactive leads, anniversaries, and rate-watch reviews with reasons they can check. Keep borrower and realtor drafts available for review and manual sharing.
- Build on partner conversion reporting with date, officer, and lead-source filters. Show the source counts behind conversion rates and use the recorded funding event for funded counts. Keep drilldowns limited to records the viewer can access.

**Ready when** an LO can import a contact, log first contact, convert a referral, and start a repeat loan from the same history. An admin can reconcile each report total to the underlying records.

### 5. Turn pilot runs into a release gate

Start this work alongside the first build. Give pilot feedback an owner, priority, status, and retest result. Use the same walkthroughs for a direct lead, a realtor referral, a returning client, and a file that pauses and resumes. Record time to first contact, time from submission to review, and time from document receipt to clearance. Compare time on task, repeated entry, and system switches with the brokerage’s current workflow.

Before widening the fictional pilot, rehearse admin, LO, and processor access across two brokerages. Cover expired and revoked links, invite removal, repeated submissions, blocked uploads, reset scope and file cleanup, and backup and restore. Track who changed a material record and when. Give admins a way to investigate issues with sensitive fields masked. Use a separate release decision for real borrower data, with access, retention and deletion, recovery, and support responsibilities verified.

**Ready when** invited staff in two fictional brokerages can complete the walkthroughs with no unresolved blockers involving lost work, cross-brokerage access, or inability to finish a core task. The admin can trace and retest each resolved pilot issue.

### 6. Add assistance the LO can verify

Once ownership, application versions, and condition history are reliable, use the existing record and templates to prepare condition-response drafts, realtor-safe milestone updates, and explainable past-client follow-up suggestions. Start with rules and fictional cases. Show the loan facts behind each draft so the LO can check and edit it before sharing.

**Ready when** an LO can trace a proposed action back to the relevant condition, milestone, or watchlist trigger and adjust it without re-entering the loan details.
