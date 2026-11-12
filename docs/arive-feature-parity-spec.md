# Orbit feature coverage and implementation specifications

Updated November 9, 2026. This document specifies Orbit's planned coverage for broker, non-delegated correspondent, and contract-processor workflows. It uses the public feature descriptions as the comparison baseline. [ARIVE pricing and feature comparison](https://www.arive.com/pricing)

## Source and interpretation

The public page was reviewed on the date above. Its detailed comparison uses image-based availability markers; the text extraction does not reliably establish every plan entitlement. Do not infer a tier from those markers. Repeated entries for lead intake and preapproval are consolidated below. Plan-card additions and operational services are included. Pricing, seat prices, and unlimited usage promises are not adopted as Orbit requirements.

The following compact inventory groups the page's functional labels. All design details after this inventory are Orbit's proposed requirements, not claims about ARIVE behavior. Ambiguous labels require a product walkthrough before claiming equivalent behavior.

| ID | Source feature family |
| --- | --- |
| F01 | Credit integrations; DU/LPA and dual AUS |
| F02 | Income analysis |
| F03 | Electronic/manual registration; lender events |
| F04 | Client needs, conditions, secure uploads; document management |
| F05 | Disclosures/custom forms; DocMagic; DocuSign; built-in e-sign |
| F06 | Mobile borrower portal; tasks; loan details/stages |
| F07 | Lead forms/public leads; custom questionnaires; branded pre-applications; POS themes; LOS branding |
| F08 | Preapproval creation, download and delivery |
| F09 | Realtor pipeline, pricing and qualification |
| F10 | Integrated/manual lender pricing; quotes; product/offer comparisons |
| F11 | Integrated fees |
| F12 | Call reports and custom reporting |
| F13 | Zapier integration |
| F14 | Lead/loan upload links; external document sharing |
| F15 | MERS; non-del pricing; margins; enhanced fees |
| F16 | Changed circumstances; closing disclosure/package; UCD |
| F17 | Funding/revenue; purchase-advice/wire reconciliation |
| F18 | Cross-broker processor access, team membership and fees |
| F19 | Seat administration; support, community and training |

## Baseline, ownership and release policy

Release `f0ae23d3f57e` is the starting point for the reconciliation below. The table separates demonstrated fictional workflows and repository foundations from open product and provider work. **Partial** identifies a foundation. **Planned or unverified** identifies an open acceptance check.

Engineering owns implementation, the product owner resolves scope/ambiguities, and a pilot brokerage reviews workflow acceptance. Provider specialists validate external contracts and results. Named people and provider access dates must be recorded before release; no dates are invented here. All IDs remain in required planning scope, including non-del. Broker readiness and non-del readiness are separate release milestones, so non-del cannot quietly disappear or be advertised before validation.

The canonical delivery increments remain 0–5. Start with a baseline and provider discovery; build lifecycle and dependable queues in 1–2, configuration/reporting in 3, switching/operation in 4, and release evidence in 5. Use mocks and fictional data within the current budget. Provider selection does not authorize purchase or activation.

## Current release reconciliation

The [implementation register](capability-register.md) and [hosted rehearsal log](demo-rehearsal-log.md) record release evidence. The next column identifies the acceptance work to carry into the listed delivery increment. Provider readiness and external brokerage results require their own evidence.

| Group | Release baseline | Next evidence |
| --- | --- | --- |
| F01 | Hosted paired mock DU/LPA with separate findings and retry history, tied to the submitted 1003 and authorized sample credit | Verify borrower selection, real consent evidence, service contracts, and reconciliation before any provider order. |
| F02 | Hosted income worksheet with source periods, adjustments, exact accepted documents and verification returns, and reviewed income in mock pricing. A mock quote opens its exact worksheet revision. | Verify approved calculation policies and supported evidence before using real files. |
| F03 | Hosted mock UWM intake and conditions, original receipt recovery, a scoped delivery timeline, fictional lender profile checks for manual MISMO export and sample packages, acknowledgment and returns | Verify real lender capabilities and map their import, ordering, rejection, and replay contracts. |
| F04 | Hosted conditional checklists, reusable per-borrower question sets, selected document batches, same-loan reuse of accepted evidence, and borrower-specific mock verification orders and returns. | Validate production scan and delivery contracts and expand conditional request criteria. |
| F05 | Hosted versioned sample packages with signer-specific portal responses, receipt history, configurable internal deadline calendars, reusable templates matched by purpose and property state, and tasks for fee changes or declines. Drafts flag moved calendar targets and issued packages retain their original dates. Stage policy guards 1003 reopening, lender details, selected quotes, and fee edits, with a reason recorded for an admin override. | Validate document generation, signing, and applicable timing policies before live use. |
| F06 | Hosted 1003 and a borrower action list for corrections, questions, documents, and sample signatures, scoped to each borrower on a joint file | Validate live identity verification and configurable borrower needs in an approved pilot. |
| F07 | Versioned general, purchase, and refinance intake profiles with a mobile preview, conditional questions, staff-selected 1003 prefill, branded themes, and campaign, branch ZIP, or direct LO routing | Verify allowed LO editing, configurable consent references, and branch setup with a design partner. |
| F08 | Fictional staff issuance and separate publication to borrower and realtor portals, with expiry, withdrawal, and supersession | Verify qualified template and eligibility policy before production. |
| F09 | Realtor referrals, conversion counts, milestones, and scoped sample letter access | Verify partner permissions for approved pricing estimates and qualification. |
| F10 | Staff can compare a manually entered fictional fixed-rate offer with mock UWM on the same scenario, choose one, and prepare the matching handoff. Manual note terms and quote provenance stay with the export and lender acknowledgment. Borrower comparison supports expiration, five-year cost, and break-even. | Validate lender profiles, live provider coverage, and lock contracts. |
| F11 | Hosted brokerage templates by purpose and ZIP, with effective dates and staff overrides. Sample payer and payee details carry from shared quote to closing. Finance compares the confirmed gross fees, borrower shares, and payees with sample settlement figures and reviews differences on the funding cycle. | Verify broader geographic matching, external fee sources, and live settlement inputs. |
| F12 | Owner scorecard with saved date and owner views, campaign conversion, current follow-ups and conditions, and projected and recorded funding. Quarterly call-report review retains versioned internal CSVs. Saved custom intake and production reports have role-scoped counts, field filters, record drilldowns, and CSV downloads. | Validate filing field coverage and formats. Add approved report delivery policies. |
| F13 | Brokerage-scoped lifecycle events, versioned subscriptions, simulated retry scheduling and archived history, an owner exception queue, and a credentialed fictional event API | Verify an external connector against the sandbox contract, with provider-specific delivery reconciliation and retention rules. |
| F14 | Hosted fictional lead upload and lender download links with separate codes, document revisions, and conversion history | Verify stronger recipient identity, authorized delivery, and live scanning before real use. |
| F15 | Broker financial visibility and a separate planned non-del channel | Specify investor price, margin policy and registry evidence with a non-del broker. |
| F16 | Reviewed 1003 revisions, closing checklist and dates, version-specific disclosure confirmation, downloadable sample closing packets, and internal file preflight. Brokerage policies can require current 1003 review, cleared lender conditions, or a completed checklist separately for closing and funding. The manager queue opens the exact evidence and overrides stay in the loan audit. | Validate actual document generation, approval, and applicable UCD contracts. |
| F17 | Funding, restricted compensation entries, owner-only sample settlement reconciliation, and an exception queue that opens the exact funding cycle | Validate external evidence contracts and workflow with a non-delegated pilot. |
| F18 | A fictional contract processor worked assigned files in two brokerages without changing the sign-in default on a visit. The rehearsal verified cross-brokerage file denial and owner-only financial access. | Fictional fee offers and decisions now passed with two brokerage contexts. Verify commercial acceptance with design partners. |
| F19 | Workspace admin, invitations, roles, offboarding, pilot support requests, and first-day checklists with personal progress for owners, LOs and processors | Define seat entitlements and scoped support access. Validate first-day self-service with a design partner. |

## Shared implementation contract

Every feature uses server-enforced brokerage and role scope, versioned records, attributable history, bounded queries, and the existing service layer. Borrower/realtor projections must deliberately exclude internal notes, compensation and unrelated participants' private information. External actions persist intent, attempt, provider reference and reconciliation outcome. Unknown outcomes are not success and must not trigger blind retries.

Store the exact input/document/configuration revision used for every issued artifact or provider order. Distinguish sample, stage, live and manually recorded evidence. Require explicit unsupported outcomes instead of falling back to a mock result in a live workflow. Tests cover unauthorized access, revocation, stale edits, retries and provider outages where applicable. UI acceptance includes narrow mobile layouts, keyboard use, clear next actions and actionable errors.

## Feature specifications

### F01 — Credit and underwriting services

The hosted workbench records staff demo authorization for the sample credit report. A paired mock order ties both services to the same submitted 1003 revision and credit report. DU and LPA store separate references, findings, and retries. A corrected 1003 requires fresh sample credit before another paired run. [Hosted paired underwriting rehearsal](demo-rehearsal-log.md#hosted-paired-mock-underwriting)

For a joint 1003, the mock credit order records whether the LO attested to authorization for the primary borrower or all borrowers. The request retains the staff actor, timestamp, borrower count, and exact application revision. Mock AUS requires credit covering every borrower on the current submitted 1003. When a simulated response is missing, the LO can check the original reference. The check confirms the existing order and is safe to repeat, even when the application has since changed. A confirmed failure retains its separate retry path.

Today lists unconfirmed orders on active loans for the current LO. The item opens and focuses the exact order, and reassignment moves the item with the loan. A simulated inconclusive lookup preserves the count and records the check. A definitive acceptance or rejection clears the item without replacing the original reference. [Sandbox lookup cases](lender-sandbox-acceptance.md#credit-and-aus-order-lookup)

Live ordering still needs provider-accepted consent evidence, vendor access, current service schemas, credentials, and approved data handling. For each service, confirm which borrower identifiers and consent records the sandbox accepts, whether a status query can locate an order by the original correlation key, and how the provider identifies a safe retry or duplicate charge. The mock workbench attestation records the fictional order scope.

### F02 — Reviewed income analysis

An assigned processor can prepare a sample worksheet for the primary or separately linked co-borrower. The worksheet records dates, amounts, inclusions and exclusions, adjustments, and accepted evidence revisions. Missing source periods block review. Staff enter the arithmetic basis and rationale, and the LO or admin records approval against the current reviewed 1003. Conventional mock pricing records the worksheet revision and amount. Changes to the 1003, evidence, or worksheet block reuse of the earlier quote while preserving history. [Hosted income worksheet rehearsal](demo-rehearsal-log.md#hosted-reviewed-income-worksheet)

The demonstrated methods cover staff-entered monthly amounts, totals over a specified number of months, and gross amounts per pay period. Underwriting eligibility, calculation policies, additional borrower structures, and live pricing still need qualified review and provider validation.

Accepted mock employment and income verification returns can be cited by borrower, order revision, and return receipt. The worksheet keeps the original review attribution and sample PDF. The amount and source periods are entered by staff and approved before pricing. A saved quote can reopen the exact worksheet even after a later version requires repricing. [Hosted quote evidence rehearsal](demo-rehearsal-log.md#hosted-income-verification-behind-a-mock-quote)

### F03 — Lender submission and updates

The mock delivery timeline shows exact acknowledged 1003 revisions, missing and recovered receipts, document deliveries and failures, and recorded condition changes. The mock condition feed keeps a version per condition. It records late and duplicate delivery evidence without changing the current state. The rehearsal proves an older open update cannot undo a newer clearance.

Manual handoffs support reviewed export, acknowledgment, and returns. Remaining work covers the capability matrix, validated provider event identity and ordering, lender rejection reasons, and the workflow for recovering failed or unconfirmed provider handoffs. Keep provider status and internal stage separate. Increments 1–2 with the live integration gate in 5.

The fictional wholesale profile checks the saved borrower and lender fields used by the current XML mapping. A blocker opens the exact lender field or the borrower correction form. Downloads and shared packages enforce the same profile against current application and lender detail revisions. The preparation event records its profile and exact XML digest. A real lender import still needs its implementation guide, field coverage, test files, and acceptance from that lender.

### F04 — Document and condition lifecycle

The [hosted checklist](demo-rehearsal-log.md#hosted-brokerage-document-checklist-templates) gives admins reusable versions with purpose filters, borrower instructions and deadline offsets. Loan staff preview what will be added and can open the current file assignment. Requests inherit that assignment and keep their original version when a template changes. Each request uses the existing borrower, review, and manager queues.

Each item can require an occupancy answer, current employment type for the selected borrower, or both. The preview uses the current reviewed 1003, identifies unanswered or unmatched rules, and requires staff to add requests explicitly. Each conditional request retains its source template and reviewed application revision. [Hosted conditional checklist rehearsal](demo-rehearsal-log.md#conditional-borrower-document-rules)

Staff can ask a dated short-answer or yes-or-no question on a fictional loan. Answers appear in Incoming loan work. Reviewing clears that entry. Clarification returns the question to the same borrower and preserves earlier answers for staff. [Hosted borrower question rehearsal](demo-rehearsal-log.md#borrower-question-review)

Admins publish categorized question sets in Playbooks. Staff preview a set against the current submitted application, choose individual prompts, and set each recipient and deadline. Orbit adds the questions together and retains the set version in staff history. Each answer follows the same review and clarification path as a single request. [Hosted question set rehearsal](demo-rehearsal-log.md#hosted-reusable-borrower-question-sets)

On one loan, assigned staff can preview and choose up to 20 documents for acceptance, mock delivery or retry, or a selective clearance check. Acceptance requires a review confirmation. A stale item stops the batch, and repeating a completed selection preserves the original deliveries. [Hosted batch rehearsal](demo-rehearsal-log.md#hosted-selective-bulk-document-work)

Staff can link a directly accepted document to another open condition on the same loan. An untouched target request retains its recipient and document type. The condition keeps the source revision, the original PDF when present, and separate records for linking, delivery, and lender clearance. [Hosted evidence reuse rehearsal](demo-rehearsal-log.md#hosted-accepted-evidence-reuse)

The processor queue also tracks sample employment, income, and asset verification for each borrower. Open and returned orders link to the exact staff record. Accepted returns carry the borrower role and receipt into the closing checklist and sample packet. [Hosted verification rehearsal](demo-rehearsal-log.md#hosted-borrower-verification-service-orders)

Remaining scope covers additional request criteria and production scan and delivery. Track requested, received, scan-pending, blocked, reviewed, replacement-needed, delivered and lender-confirmed outcomes distinctly. Verify that replacement requests require fresh review, uploads recover, and lender confirmation alone establishes lender clearance. Reuse private storage and scan adapters. Increments 1–3.

### F05 — Disclosure and signature workspace

Status: planned provider handoffs; complete production behavior unverified. Staff assemble a versioned package, review recipients and consent, issue it, track completion/decline/expiry, and retain signed artifacts plus completion evidence. Model template, package, document hash/version, envelope, recipient role and provider events. Support a native Orbit signing experience through an evaluated service and a separately scoped DocuSign adapter; assess DocMagic for generation. Do not label a redirect-only experience as built-in signing. Acceptance: wrong signer denied, duplicate callbacks harmless, corrected package supersedes old versions, completion matches actual signed artifacts, and outages preserve recoverability. Validate current provider and applicable disclosure requirements before live use. Contracts in 1–2, workspace in 3, release in 5.

### F06 — Borrower work center

The [hosted joint 1003](demo-rehearsal-log.md#hosted-separate-joint-borrower-links) gives a primary borrower and a co-borrower separate drafts, private correction notes, and independent revocation. Orbit creates the reviewable version after both submit. Staff review both on one loan and can export the reviewed fictional version. Recovery keeps retired links blocked when an older workspace snapshot is restored.

The [hosted evidence flow](demo-rehearsal-log.md#hosted-borrower-specific-document-requests) gives each participant a separate checklist, mock verification session, and replacement instructions. Staff can reuse a template for either borrower, prepare a follow-up for the selected recipient, and review both checklists from the loan and manager queue. A linked lender condition uses one request with one recipient.

**Your next actions** opens the current correction, exact outstanding document or question, or pending mock signature. Dated work appears first. Processing, received, and accepted evidence stays in the checklist while the borrower’s outstanding list reflects only their own work. Active actions appear above the status receipt. [Hosted borrower action rehearsal](demo-rehearsal-log.md#borrower-next-actions)

Live identity verification, scan, delivery, and real-data admission have separate release gates. Increments 1–2, recovery in 4, live gate in 5.

### F07 — Configurable intake and branding

The [hosted quote form](demo-rehearsal-log.md#hosted-configurable-website-quote-intake) supports a brokerage title, introduction, one of three themes, contact requirements, ZIP and timeline visibility and one short question. Admins can publish separate purchase and refinance versions and give each a campaign and direct owner or shared inbox. The original link and purpose links use the current published forms. Prior submissions retain their source, profile, version and answer. Eligible phone leads can enter a call campaign with its existing assignment caps.

Admins can add up to four typed questions. A follow-up can depend on a choice from an earlier visible question. The accepted receipt retains visible answers and their original prompts. Staff can select occupancy, requested loan amount, or estimated property value to prefill the draft, using values checked against the accepted receipt. The borrower can still edit the draft.

Admins can add exact ZIP or three-digit branch defaults and preview the draft destination with and without a phone number. The lead receipt preserves the applied rule, published version, and original destination. Branch labels apply to intake routing. Remaining scope covers allowed LO overrides, consent text references and configurable application questions. Increments 1–3.

### F08 — Controlled preapproval letters

The fictional release stores an immutable PDF for each issued version. The officer reviews the current purchase 1003, confirms the sample amount and expiry, and selects the property scope. The officer can publish separately to the borrower and linked realtor after confirming permission. The portal checks the exact grant, version, application revision, recipient, and current link at download time. Staff can withdraw each audience independently. Replacements start private. Qualified review must approve templates, eligibility policy, and conditions for production. Build in increments 2–3 and gather provider-dependent evidence in 5. [Hosted letter rehearsal](demo-rehearsal-log.md#hosted-fictional-preapproval-letters)

### F09 — Realtor workspace

Status: referrals and milestone portal exist; pricing/qualification coverage unverified. Extend permitted partner views with approved borrower-safe scenarios, clearly limited estimates and authorized letter sharing. Store loan-partner grants and the published scenario/letter revision. Realtor calculations must not expose credit reports, raw income, tax IDs, internal notes or compensation. Acceptance: unrelated referral denied, revoked partner loses access, changed terms invalidate stale estimates, and qualification remains distinct from an LO-issued approval. Increments 2–3; broker walkthrough in 5.

### F10 — Product/pricing and comparison

The fictional release verifies a saved scenario recommendation against its exact mock pricing run and offer, through borrower publication and mock UWM handoff. The repository also includes a UWM stage adapter. Extend the offer contract to include lender and product, inputs, quote time, supplied expiry, rate, term, points and credits, payment assumptions, fee revision, eligibility result and supplied reasons. Preserve manual offer provenance and attachments. Compare offers on the same scenario and identify missing APR or fees. Acceptance covers changed-input repricing, published history, unavailable products, and separate lock confirmation. Validate UWM before evaluating wider provider coverage. Track single- and multi-lender production evidence separately in increment 5. [Hosted scenario rehearsal](demo-rehearsal-log.md#hosted-scenario-to-quote-rehearsal)

Staff can enter a dated fixed-rate manual offer for an existing sample UWM scenario. Missing APR or points are visible. The selected manual terms flow into the sample MISMO note amount, rate, and term. The lender acknowledgment must use that lender and a prepared export for the same quote. A changed quote invalidates an earlier lender package link. Private quote references stay out of the borrower view. Eligibility, attachments, and production imports remain separate validation work.

### F11 — Fee estimation service

Brokerage admins publish sample fee templates with a source, effective date, loan purpose, and optional ZIP. Staff can override individual fees. Unknown amounts stay blank and quote totals identify which fees are missing. The worksheet and shared quote preserve the selected version and edited amounts. The borrower view shows estimates without the internal source record. The fictional cash-to-close fixture reconciles the lender credit, deposit, and seller credit. [Hosted fee template rehearsal](demo-rehearsal-log.md#hosted-brokerage-fee-templates)

Remaining scope includes payer, payee, amount basis, broader geographic rules, and approved external estimates. Verify financed costs and provider coverage before live use.

### F12 — Reporting

The owner scorecard reuses the campaign enrollment and funding report calculations and lets brokerage admins save the common date and owner filters. Campaign counts open the contributing lead or loan. Current work counts overdue follow-ups and one row per active loan with conditions. Funding projection uses scheduled closings, while actual funding uses recorded dates.

The internal quarter review uses confirmed application intake amounts and property states. It compares the opening files with the latest saved prior-quarter ending, identifies added or removed loans and changed states or amounts, and links each difference to the reporting facts. Each export retains its baseline version, note, and facts revisions even after later corrections.

Saved custom reports let admins select a date basis, filters, metrics, grouping, and drilldown fields. Shared intake and production views apply current LO ownership before counting. Processor access is limited to production views and assigned files. Brokerage admins can filter a saved report or CRM segment on one typed lead or borrower-contact field. Production reports also support a typed loan-file field with independent view and edit permissions. Field visibility gates report counts, drilldowns, and exports. Staff can download a CSV of all matching events or one count. The download uses the same scoped query, requires the current report version and viewed dates, and records who prepared it. Remaining work includes filing validation and saved export or delivery policies. Acceptance requires reconciled corrections and funding reversals, explicit missing data, reproducible snapshots, and protection of restricted fields in aggregate counts and downloads. Increments 3–4, operational acceptance in 5.

### F13 — Zapier and external automation

Status: CRM automation deliveries shipped in simulation on Worker `032198ce-5e71-46ca-bccd-a4e661fadad3`. Direct leads, website requests, realtor referrals and new campaign CSV rows record `lead.created`. A completed 1003 records `application.submitted` at the actual revision, including after both portions of a joint 1003. Funding, date corrections and reversals record distinct event types. The source transaction saves the event with a stable ID and unique source revision. Historical migration and linking an existing lead to a campaign leave this new-lead event history unchanged. The version 1 payload carries event ID, type, time, source and an opaque record reference with revision. A brokerage admin can review an event and record a simulation. Fictional workspaces support a deliberate failure and a retry of the same payload. The attempt ID and expected attempt number distinguish a repeated acknowledgment from a new request.

Simulated destination subscriptions shipped on Worker `aea92362-7e68-420f-b83d-4a8467aa81e0`. Admins choose event types for a named destination. The source transaction snapshots the matching subscription version into each delivery. Changes apply to new events. A paused destination keeps queuing matching events and requires resume before a new attempt. Disconnect ends capture and simulation while preserving past evidence. Independent destination attempts preserve the same source event ID and payload without sharing delivery state. The source write has a bounded fan-out of up to 12 active or paused destinations per brokerage.

Simulated destination batches shipped on Worker `70a1d8b7-4efa-4fe6-a807-5c4f47d8e7d6`. A preview pins the destination revision and the oldest ten matching event IDs and attempt counts. A concurrent change to the reviewed batch requires a fresh preview. Attempts and the receipt commit in one local transaction, and an exact repeat returns that receipt. Queued and failed events have separate previews, and a retry advances failed events only. Past receipts retain each attempt and the original subscription version.

Brokerage admins can approve, test and revoke sandbox grants for CRM events, lead summaries and loan status. Each grant records an expiry and approving membership revision. A changed approving membership invalidates the grant. The built-in test returns fictional samples and records authorization decisions. Fictional pilot admins can issue and replace a CRM event credential on an active grant. The read-only feed uses version 1 events, bounded pagination and receipt IDs. Reads check the approving membership revision, grant expiry and revocation, and the workspace maintenance revision. See the [sandbox CRM events contract](sandbox-crm-event-contract.md). Simulated destinations support immediate, 5-minute or 30-minute retry eligibility captured by subscription revision. A destination delivery can retry once. Closed deliveries move to the archived view after 30 days and retain their exact attempts and receipts. Owner Exceptions counts ready and exhausted deliveries and opens the exact destination attempt. An owner can acknowledge an exhausted delivery with attributed evidence. Scheduled or paused retries have a separate filter. Delegated access to real records, MCP, external delivery, provider retry behavior and approved retention remain open. Reuse delegated API permissions for a Zapier integration with initial lead-created, application-submitted and milestone triggers plus separately authorized lead/task creation. Define stable event IDs, delivery history, retry/backoff, deduplication and account disconnect. Minimize event payloads; fetch sensitive detail only with granted access. Acceptance: duplicate delivery creates one downstream record, revoked connection stops access, backlog is bounded and tenant-fair, and public connector availability is stated accurately. Increments 2–4; external release gate in 5. MCP alone does not satisfy this requirement.

### F14 — External file exchange

A fictional pilot owner or admin can issue one active package per loan for an hour, a day, or three days. The recipient enters a separate code to download the reviewed MISMO file and up to eight selected, accepted demo-scanned PDF revisions. The staff view retains issue, expiry, download and revocation evidence. Changes to the reviewed 1003, lender details, or selected files block the package. Explicit revocation and scenario reset retire the token hash in the directory. [Hosted manual lender package rehearsal](demo-rehearsal-log.md#hosted-manual-lender-package)

Assigned fictional leads can receive a private upload-only link and separate code. The lead owner can review the built-in PDFs from My Tasks and adjust outstanding deadlines from Calendar before creating a loan. Conversion moves request IDs, deadline revisions, statuses, accepted object references, and review events in one transaction. The old lead link closes and the borrower continues from the 1003. [Hosted lead document rehearsals](demo-rehearsal-log.md#hosted-lead-document-conversion)

Before handling real files, validate recipient identity, authorized delivery, scanning, and retirement of all affected grants during snapshot recovery. Earlier PDFs without a recorded mock upload mode require a new sample upload to qualify for lender sharing.

### F15 — Non-delegated pricing and registry

Status: planned/unverified expansion, explicitly retained in scope. Introduce an enabled operating channel and permissions instead of overloading broker compensation. Model investor execution, price adjustments, margin policy versions, applicable fee treatment and registry identifiers/status. Staff review investor price and margin before publishing a borrower offer. Assess MERS interfaces and account requirements independently; never treat a stored identifier as a completed registration. Acceptance: broker/non-del calculations cannot mix, historical margins reproduce, unauthorized overrides fail, and registry requests reconcile with external acknowledgments. Dependency discovery in 0–2; configuration in 3; separate non-del provider gate in 5.

### F16 — Closing packages and changed terms

Status: closing coordination exists; regulated document generation/UCD delivery unverified. Track a change event, reason, effective date, impacted terms, required review and superseded package references. Build versioned closing packages with provider-generated documents and UCD validation/submission results where supported. Acceptance: revised terms invalidate stale package approvals, retries preserve submission identity, rejection details create assigned work, and signed documents match the reviewed version. Qualified review supplies applicability/timing rules; verify current schemas and provider contracts before implementation. Increments 2–4; separate live closing/non-del acceptance in 5.

### F17 — Funding and settlement reconciliation

The fictional owner-only queue groups active funding cycles into differences, matches to confirm, missing evidence, and reviewed differences. A row opens the exact cycle and its source entries. Funding-date corrections can reopen a review. Reversals leave the earlier cycle in the archived ledger. [Hosted settlement exception rehearsal](demo-rehearsal-log.md#sample-settlement-exception-queue)

External evidence matching and operational acceptance still require a non-delegated pilot. Validate purchase-advice and receipt contracts, source identity, reviewer approval, and recovery after delayed or duplicate evidence. The demonstrated flow records sample evidence. Increments 3–4; separate non-del operational acceptance in 5.

### F18 — Contract processing

Status: versioned fee terms and processor responses shipped after fictional two-brokerage acceptance on Worker `a4e25303-280f-4cf2-bcb7-44f35de041a9`. An admin records an offer against the current assignment and the assigned processor responds to the exact version. Pending or declined amendments leave an earlier accepted fee in place. Removal ends active terms and access while preserving history. **Processing → Pending fee offers** on Worker `f009e619-1a3f-4b8c-8aa7-dc6d7a2bec43` lists waiting versions in the current brokerage. The assigned processor opens the exact offer, and a concurrent replacement leaves the selected version read-only until the current terms are opened explicitly. Signed contract handling, billing and design-partner acceptance remain open. One identity can accept independently revocable invitations from multiple brokerages. Require explicit active-brokerage context, per-file assignment and separate fee agreements. Model organization membership, LO team membership, assigned loan scope and versioned processing fees. Acceptance: two brokerages grant different files, switching context never mixes documents/search/results, one revocation leaves the other membership intact, and fee changes do not alter prior agreed amounts. Increments 2–4; broker/pilot validation in 5.

### F19 — Administration and service operations

Status: pilot staff can file and track their own support requests in Team on Worker `e603d00f-bac4-47eb-9901-ebefa64b50fd`. The brokerage admin can filter the queue, assign active staff, publish requester updates, and keep retest notes private. The rehearsal verified idempotent intake, stale-update recovery, and cross-role and cross-workspace boundaries. Role-specific first-day checklists shipped on Worker `78d07b9f-d0b0-4895-90de-fc5d99f38a4d`, with direct navigation, personal review progress, and fictional role acceptance. Commercial entitlements and external support access need specification and validation. Model seat type, assignment, reassignment, role capabilities and subscription state separately from loan ownership. No billing provider or Orbit price is selected here. Provide contextual help, support request intake, named support ownership, onboarding material and scheduled training/community channels. Acceptance: seat transfer revokes prior privileges while preserving audit history, support access is approved/scoped/audited, requests route to an owner, and users can finish a role-specific onboarding rehearsal. Do not promise live chat hours or response SLAs without staffing. Increments 3–4; commercial readiness in 5.

## Delivery packages and dependencies

1. **Coverage reconciliation (increment 0):** Main agent maps F01–F19 to the active source revision, existing tasks and evidence. Record unknowns rather than rebuild working components. Resolve the ambiguous comparison/event labels through product research or a broker walkthrough.
2. **Broker workflow completion (increments 1–3):** Prioritize F04/F06/F07/F08/F10/F14 alongside the current scenario handoff. Develop F01/F02/F03/F05/F11 contracts with mocks while access is pending. Existing CRM, foundation and queue work remains required.
3. **Brokerage operation (increments 3–4):** Complete F09/F12/F13/F18/F19 and the broker portions of F16/F17. Apply shared access/recovery contracts to every package.
4. **Production providers (increment 5):** Validate the agreed credit/AUS, lender, PPE, fees, disclosure/signature and messaging services. A working mock does not close a live-provider gap. Document costs, coverage and manual exceptions before a replacement claim.
5. **Non-del release (own increment-5 evidence):** F15 and non-del portions of F16/F17 require their own channel policy, counterparties, calculations, documents, registry and settlement rehearsal. They are committed planning scope without being prerequisites for a broker-only release claim.

## Required evidence per feature

For each F-ID, maintain owner, current revision, status, dependent provider/access decision, supported audience, test cases, rehearsal evidence, manual steps and next action in the capability register or linked feature record. Mark distinct milestones: specified, locally implemented, fictional rehearsal passed, stage validated, production validated. Retain at least one failure/recovery scenario per external workflow. All F-IDs must have an explicit disposition at release review; none may be silently dropped. Functional equivalence is validated against brokerage tasks, not by the presence of a similarly named screen.
