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
| F01 | Mock credit and individual DU/LPA workbench | Run DU and LPA together with independent retry and consent and order evidence. |
| F02 | 1003 income answers and mock statement inputs | Review a documented income calculation against its source periods and evidence. |
| F03 | Hosted mock UWM intake, conditions, manual MISMO export, acknowledgment and returns | Define verified lender capabilities and reconcile delayed, rejected, and repeated updates. |
| F04 | Hosted request, mock-scanned PDF, replacement and clearance | Verify configurable checklist rules and production scan and delivery contracts. |
| F05 | Staff can track disclosure status on the closing file | Specify a versioned package and signer lifecycle with mock evidence before selecting providers. |
| F06 | Hosted save, resume, status, borrower requests and correction | Verify participant-specific permissions through a joint application and revocation. |
| F07 | Public quote requests, referrals and attributed campaign intake | Add versioned intake fields and preview brokerage branding at mobile sizes. |
| F08 | Hosted staff issue, replace, and download fictional PDFs with expiry, 1003 revision, and issuer history | Verify permissioned borrower and realtor publication, expiry and supersession on shared access, and qualified template review. |
| F09 | Hosted realtor referrals, conversion counts and milestone portal | Verify partner permissions for approved estimates and letter sharing. |
| F10 | Hosted staff comparison, exact mock offer, published borrower quote and mock UWM handoff | Validate provider coverage, quote provenance and changed terms. Confirm locks separately. |
| F11 | Itemized fee worksheets and saved quote estimates | Add source and effective-date metadata and confirm cash-to-close totals against a fixture. |
| F12 | Dashboard drilldowns, call-report preparation and exports | Reconcile report periods and data coverage before a custom report builder or filing claim. |
| F13 | Internal workflow actions and planned delegated API | Define bounded event subscriptions and safe replay for Zapier. |
| F14 | Borrower upload tied to a specific request and fictional document verification | Verify revocable, recipient-scoped exchange for leads and loan documents. |
| F15 | Broker financial visibility and a separate planned non-del channel | Specify investor price, margin policy and registry evidence with a non-del broker. |
| F16 | Reviewed 1003 revisions, closing checklist, and closing and funding dates | Specify change and package revisions, approvals, and applicable UCD contracts. |
| F17 | Funding and restricted expected versus received financial entries | Reconcile fictional purchase advice, receipt and reversal with reviewer history. |
| F18 | Brokerage membership and assigned processor scope | Rehearse one contract processor across two brokerages with isolated files and fees. |
| F19 | Workspace admin, invitations, roles and offboarding | Define seat entitlements and scoped support access, then rehearse role onboarding. |

## Shared implementation contract

Every feature uses server-enforced brokerage and role scope, versioned records, attributable history, bounded queries, and the existing service layer. Borrower/realtor projections must deliberately exclude internal notes, compensation and unrelated participants' private information. External actions persist intent, attempt, provider reference and reconciliation outcome. Unknown outcomes are not success and must not trigger blind retries.

Store the exact input/document/configuration revision used for every issued artifact or provider order. Distinguish sample, stage, live and manually recorded evidence. Require explicit unsupported outcomes instead of falling back to a mock result in a live workflow. Tests cover unauthorized access, revocation, stale edits, retries and provider outages where applicable. UI acceptance includes narrow mobile layouts, keyboard use, clear next actions and actionable errors.

## Feature specifications

### F01 — Credit and underwriting services

Status: partial mock workbench. LO records authorization evidence, selects borrowers and service, submits a provider order, then reviews results and resulting tasks. Model an order per service with input revision, consent reference, provider reference, attempts and findings. A dual run creates independently traceable DU and LPA orders; one failure cannot erase the other result. Reuse the credit/AUS workbench and provider contracts. Dependencies: vendor access, current service schemas, credentials and approved data handling. Acceptance: two independent results, partial failure/retry without duplicate chargeable orders, corrected application invalidation, and separate credit versus underwriting provenance. Build contracts in 1–2; gate live use in 5.

### F02 — Reviewed income analysis

Status: application income fields and sample non-agency calculations are a foundation, not a complete analyzer. Processor assembles income sources, periods and supporting document revisions; the LO reviews inclusions, exclusions and adjustments. Store calculation inputs, method/version, monthly result, rationale, reviewer and unresolved evidence. Initial scope covers agreed wage and self-employment cases, with unsupported methods clearly identified. Acceptance: independently calculated fixtures reconcile, missing periods block completion, replacing evidence invalidates review, and only a reviewed result is carried into qualification. Product/qualified mortgage review determines methods before implementation; no invented underwriting rules. Increments 2–3.

### F03 — Lender submission and updates

Status: mock UWM and manual handoffs exist. Staff validate the current application, submit/export, reconcile lender identity, and act on returned updates. Store submission revision, provider reference, receipt, lender status and internal stage separately. Add a capability matrix per lender. Acceptance: repeated imports, delayed/out-of-order updates, lender rejection and manual corrections preserve one traceable file and actionable work. The page's event label is ambiguous: confirm whether commercial announcements are expected in addition to operational updates; keep optional announcements separate from loan status. Increments 1–2; live integration gate in 5.

### F04 — Document and condition lifecycle

Status: partial implemented demo. Extend existing requests and review queues with versioned criteria-based checklist rules, reusable categories, ownership and deadlines. Track requested, received, scan-pending, blocked, reviewed, replacement-needed, delivered and lender-confirmed outcomes distinctly. Acceptance: a document replacement cannot inherit an old review/clearance, rule changes do not silently rewrite active requests, uploads recover, and lender confirmation alone establishes lender clearance. Reuse private storage and scan adapters; live evidence required separately. Increments 1–3.

### F05 — Disclosure and signature workspace

Status: planned provider handoffs; complete production behavior unverified. Staff assemble a versioned package, review recipients and consent, issue it, track completion/decline/expiry, and retain signed artifacts plus completion evidence. Model template, package, document hash/version, envelope, recipient role and provider events. Support a native Orbit signing experience through an evaluated service and a separately scoped DocuSign adapter; assess DocMagic for generation. Do not label a redirect-only experience as built-in signing. Acceptance: wrong signer denied, duplicate callbacks harmless, corrected package supersedes old versions, completion matches actual signed artifacts, and outages preserve recoverability. Validate current provider and applicable disclosure requirements before live use. Contracts in 1–2, workspace in 3, release in 5.

### F06 — Borrower work center

Status: partial functioning demo. Reuse application/status components for save/resume, distinct participant access, correction, borrower tasks and status. Provide one prioritized list of outstanding borrower actions with completion reflected in staff queues. Separate milestone visibility from internal stage detail. Acceptance: two borrowers cannot access each other's restricted data, revoked links fail immediately, saved drafts survive interrupted sessions, and mobile application/upload/correction flows finish end to end. Increments 1–2, recovery in 4, live gate in 5.

### F07 — Configurable intake and branding

Status: public intake foundation; full configuration unverified. Admin configures brokerage/branch defaults and allowed LO overrides for branding, short intake and application questions. Store versioned field definitions, validation, conditional visibility, consent text references and safe presentation tokens. New forms adopt new versions; existing submissions retain their original schema. Map permitted answers to the lead/application without losing source attribution. Acceptance: invalid branching rejected, required data preserved, preview matches published mobile form, and configuration cannot inject executable content or expose another brokerage. Include accessibility/contrast checks. Increments 1–3.

### F08 — Controlled preapproval letters

The fictional release stores an immutable staff PDF for each issued version. The officer reviews the current purchase 1003, confirms the sample amount and expiry, and selects the property scope. Issuance records the actor and application revision, while a replacement supersedes the prior version. Next verify borrower and realtor access, publication history, and expiry and supersession through shared links. Qualified review must approve templates, eligibility policy, and conditions for production. Build in increments 2–3 and gather provider-dependent evidence in 5. [Hosted letter rehearsal](demo-rehearsal-log.md#hosted-fictional-preapproval-letters)

### F09 — Realtor workspace

Status: referrals and milestone portal exist; pricing/qualification coverage unverified. Extend permitted partner views with approved borrower-safe scenarios, clearly limited estimates and authorized letter sharing. Store loan-partner grants and the published scenario/letter revision. Realtor calculations must not expose credit reports, raw income, tax IDs, internal notes or compensation. Acceptance: unrelated referral denied, revoked partner loses access, changed terms invalidate stale estimates, and qualification remains distinct from an LO-issued approval. Increments 2–3; broker walkthrough in 5.

### F10 — Product/pricing and comparison

The fictional release verifies a saved scenario recommendation against its exact mock pricing run and offer, through borrower publication and mock UWM handoff. The repository also includes a UWM stage adapter. Extend the offer contract to include lender and product, inputs, quote time, supplied expiry, rate, term, points and credits, payment assumptions, fee revision, eligibility result and supplied reasons. Preserve manual offer provenance and attachments. Compare offers on the same scenario and identify missing APR or fees. Acceptance covers changed-input repricing, published history, unavailable products, and separate lock confirmation. Validate UWM before evaluating wider provider coverage. Track single- and multi-lender production evidence separately in increment 5. [Hosted scenario rehearsal](demo-rehearsal-log.md#hosted-scenario-to-quote-rehearsal)

### F11 — Fee estimation service

Status: worksheets exist; external fee integration unverified. Combine approved lender fees, brokerage templates and selected third-party estimates with source, geography, effective date and overrides. Store line-item payer, paid-to, category, amount/basis and provenance; avoid double counting lender credits or financed costs. Acceptance: fixture totals reconcile to cash-to-close, changed location/terms invalidate estimates, unavailable fees remain unknown, and published quotes retain their fee snapshot. Decide provider after evaluating coverage and cost; do not assume ARIVE's branded fee service is available to Orbit. Increments 2–3; live validation in 5.

### F12 — Reporting

Status: call-report preparation and dashboards exist; complete filing coverage/custom builder unverified. Define report periods, metric formulas, field mappings, revisions and exceptions. Deliver reconciled exports and drilldowns first, followed by saved custom field/filter/group selections with role limits. Acceptance: corrections and funding reversals reconcile, missing data is explicit, exports reproduce a versioned snapshot, and restricted fields cannot leak through aggregate counts or downloads. Verify current required formats before claiming filing support; no automatic filing implied. Increments 3–4, operational acceptance in 5.

### F13 — Zapier and external automation

Status: API/MCP planned; no established Zapier release. Reuse delegated API permissions for a Zapier integration with initial lead-created, application-submitted and milestone triggers plus separately authorized lead/task creation. Define stable event IDs, delivery history, retry/backoff, deduplication and account disconnect. Minimize event payloads; fetch sensitive detail only with granted access. Acceptance: duplicate delivery creates one downstream record, revoked connection stops access, backlog is bounded and tenant-fair, and public connector availability is stated accurately. Increments 2–4; external release gate in 5. MCP alone does not satisfy this requirement.

### F14 — External file exchange

Status: loan upload foundation exists; generic lead upload/download sharing unverified. Issue recipient-scoped, expiring, revocable upload-only or download-only grants for specific leads, loans or document revisions. Record issuer, recipient verification, scope and access events. Downloads never expose a folder or newer revision implicitly. Acceptance: guessed identifiers and revoked/expired links fail, malicious files stay unavailable pending scan, and converting a lead preserves authorized attachments without widening access. Increments 2–3; real-data gate in 5.

### F15 — Non-delegated pricing and registry

Status: planned/unverified expansion, explicitly retained in scope. Introduce an enabled operating channel and permissions instead of overloading broker compensation. Model investor execution, price adjustments, margin policy versions, applicable fee treatment and registry identifiers/status. Staff review investor price and margin before publishing a borrower offer. Assess MERS interfaces and account requirements independently; never treat a stored identifier as a completed registration. Acceptance: broker/non-del calculations cannot mix, historical margins reproduce, unauthorized overrides fail, and registry requests reconcile with external acknowledgments. Dependency discovery in 0–2; configuration in 3; separate non-del provider gate in 5.

### F16 — Closing packages and changed terms

Status: closing coordination exists; regulated document generation/UCD delivery unverified. Track a change event, reason, effective date, impacted terms, required review and superseded package references. Build versioned closing packages with provider-generated documents and UCD validation/submission results where supported. Acceptance: revised terms invalidate stale package approvals, retries preserve submission identity, rejection details create assigned work, and signed documents match the reviewed version. Qualified review supplies applicability/timing rules; verify current schemas and provider contracts before implementation. Increments 2–4; separate live closing/non-del acceptance in 5.

### F17 — Funding and settlement reconciliation

Status: funding/financial records exist; purchase-advice/wire matching unverified. Record expected versus actual amounts, dated receipts, fees, adjustments and unresolved differences. Match externally supplied purchase advice and wire evidence to the correct loan and funding cycle, with reviewer approval and reversal history. Acceptance: partial/duplicate receipts, corrected statements and funding reversals reconcile without erasing prior records; restricted financial data stays restricted. Initial scope records and reconciles evidence, not initiating money movement. Increments 3–4; separate non-del operational acceptance in 5.

### F18 — Contract processing

Status: assigned processors exist; cross-broker contract workflow unverified. One identity can accept independently revocable invitations from multiple brokerages. Require explicit active-brokerage context, per-file assignment and separate fee agreements. Model organization membership, LO team membership, assigned loan scope and versioned processing fees. Acceptance: two brokerages grant different files, switching context never mixes documents/search/results, one revocation leaves the other membership intact, and fee changes do not alter prior agreed amounts. Increments 2–4; broker/pilot validation in 5.

### F19 — Administration and service operations

Status: staff administration exists; commercial entitlements and service operations need specification/validation. Model seat type, assignment, reassignment, role capabilities and subscription state separately from loan ownership. No billing provider or Orbit price is selected here. Provide contextual help, support request intake, named support ownership, onboarding material and scheduled training/community channels. Acceptance: seat transfer revokes prior privileges while preserving audit history, support access is approved/scoped/audited, requests route to an owner, and users can finish a role-specific onboarding rehearsal. Do not promise live chat hours or response SLAs without staffing. Increments 3–4; commercial readiness in 5.

## Delivery packages and dependencies

1. **Coverage reconciliation (increment 0):** Main agent maps F01–F19 to the active source revision, existing tasks and evidence. Record unknowns rather than rebuild working components. Resolve the ambiguous comparison/event labels through product research or a broker walkthrough.
2. **Broker workflow completion (increments 1–3):** Prioritize F04/F06/F07/F08/F10/F14 alongside the current scenario handoff. Develop F01/F02/F03/F05/F11 contracts with mocks while access is pending. Existing CRM, foundation and queue work remains required.
3. **Brokerage operation (increments 3–4):** Complete F09/F12/F13/F18/F19 and the broker portions of F16/F17. Apply shared access/recovery contracts to every package.
4. **Production providers (increment 5):** Validate the agreed credit/AUS, lender, PPE, fees, disclosure/signature and messaging services. A working mock does not close a live-provider gap. Document costs, coverage and manual exceptions before a replacement claim.
5. **Non-del release (own increment-5 evidence):** F15 and non-del portions of F16/F17 require their own channel policy, counterparties, calculations, documents, registry and settlement rehearsal. They are committed planning scope without being prerequisites for a broker-only release claim.

## Required evidence per feature

For each F-ID, maintain owner, current revision, status, dependent provider/access decision, supported audience, test cases, rehearsal evidence, manual steps and next action in the capability register or linked feature record. Mark distinct milestones: specified, locally implemented, fictional rehearsal passed, stage validated, production validated. Retain at least one failure/recovery scenario per external workflow. All F-IDs must have an explicit disposition at release review; none may be silently dropped. Functional equivalence is validated against brokerage tasks, not by the presence of a similarly named screen.
