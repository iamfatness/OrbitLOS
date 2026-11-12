# Orbit Compliance Suite — product and engineering specification

Status: proposed. Companion [delivery plan](compliance-suite-plan.md). IDs CS-A01–CS-A24 are acceptance contracts for new work, not assertions of current test coverage. Reuse the [Risk & Gaps specification](risk-and-gaps-spec.md) for canonical cases, evidence review, confidentiality and action gates.

## 1. Scope and invariants

Deliver recurring compliance operations, regulatory reporting, employee training, policy management, quality control and examination evidence for independently operated mortgage brokerages. Initial filing mode is reviewed package preparation plus recorded manual submission. Automated submission is separately enabled per supported provider. Creditor, correspondent, servicing and additional product obligations are conditional; broker status is not a universal exemption.

Keep four independent states visible: research/review coverage, obligation applicability, operational completion and regulator filing outcome. A completed monthly review, approved policy, course completion, download or submission does not certify compliance or regulatory acceptance. Unknown applicability never becomes not applicable because data is missing. Zero activity never implies no filing duty.

## 2. Navigation and user journeys

Extend the existing Compliance workspace with Calendar & monthly review, Reporting, Training, Policies & QC, and Examinations as capabilities mature. Retain Research & gaps and the canonical Work queue. Reports → Call report links to the same reporting workbench and selected period; do not create a second reporting calculation. Employees access only their assigned training/policies through a scoped portal. External reviewers receive explicitly scoped examination access, not normal staff membership.

Owner journey: confirm entity/licenses → review proposed applicability → assign owners → resolve missing facts → approve a period snapshot → produce filing package → record submission and acceptance → retain corrections and evidence. Monthly review summarizes upcoming/overdue obligations, readiness gaps, training, policy acknowledgments, complaints, QC and management sign-off; every count links to its accessible records.

Selected entity, period, jurisdiction and filters survive drilldown/back navigation. A selected record shows source authority, applicability basis, rule/schema version, legal due date and internal target separately, owner, evidence, blockers and history. Loading, stale data, partial evaluation and empty results are distinct. No unsupported feature appears as a working action.

## 3. Capability and access model

Reuse current authenticated tenancy and member access revisions. Add explicit capabilities rather than equating every new function with Admin. Until those capabilities are implemented, keep new management functions within existing authorized pilot-admin boundaries.

| Actor | Allowed scope |
| --- | --- |
| Owner/admin | Configure authorized entity profile, assign compliance capabilities and see permitted aggregate status; restricted materials still require separate scope |
| Compliance manager | Review applicability, own calendar, manage program evidence, policy/QC workflows and permitted filings |
| Preparer | Import/map data, fix assigned facts and create draft packages; cannot independently approve unless explicit policy allows it |
| Reviewer/authorized filer | Approve exact snapshot or perform attested submission within assigned entity/report scope |
| Employee | Own assignments, assessment attempts, completion records and assigned policies; no company filings or other staff records |
| External reviewer | Time-limited, read-only named package/records with permitted download policy; no tenant search or unrelated history |

Dual review is configurable by obligation and risk. For sole operators, a permitted self-review path is explicit and audited, never silently represented as independent review. An applicable legal independence requirement cannot be overridden by that configuration. Revocation invalidates sessions, queued actions and future downloads at execution time.

## 4. Data contracts

All records carry tenant ID, stable ID, revision, timestamps and actor. Entity keys and foreign keys prevent tenant or legal-entity mixing. Sensitive payloads and document storage follow existing security/retention policies; schema upgrades must include restore/export contracts.

| Record | Required fields and invariants |
| --- | --- |
| ComplianceEntityProfile | Legal entity identity, NMLS/other identifiers, branches/licenses, role, jurisdictions, product/activity facts, fiscal year, reviewer and effective interval; a tenant can have multiple entities |
| ObligationTemplateVersion | Authority URL/section and retained source hash, regulator/form, frequency/trigger, applicability predicate/input requirements, deadline policy/timezone/calendar version, schema, effective/expiry dates, review status and supersession |
| ApplicabilityDecision | Entity, template version, period/effective interval, Required / Not applicable / Needs review, facts snapshot, reviewer, reason and supporting evidence; reviewed not-applicable decisions expire or reopen on relevant fact changes |
| ObligationOccurrence | Entity/template/applicability IDs, period or triggering event, computed legal due time plus basis, optional internal target, owner/access revision, status, canonical case/task links and evidence; unique generation key prevents duplicate rollover |
| MonthlyReview | Entity/month, included occurrence and program snapshots, exclusions/unknowns, findings, reviewer sign-off and superseded revision; sign-off cannot close unresolved obligations |
| ReportDefinitionVersion | Report family/form/schema, supported entity/jurisdiction/period, field mappings, transformations, validation rules and approved fixtures |
| FilingSnapshot | Frozen data rows, source IDs/revisions, import provenance, mapping/schema version, row counts/totals/checksums, unresolved edits and package hash; immutable after approval |
| FilingAttempt | Snapshot ID/hash, destination, authorized filer, method, request id, attempted/submitted times, external reference, receipt artifact, verified outcome and failure details; distinct from a preparation job |
| FilingAmendment | Original accepted/submitted attempt, reason, changed rows/totals, new snapshot, approvals and replacement attempt; never overwrites original evidence |
| FinancialImport | Accounting period/entity, file hash, mapping version, duplicate keys, reconciliation totals, row errors and approved adjustments |
| CourseVersion / Assignment / Attempt | Licensed/owned content and review/version, audience, due date, assessment policy, actual attempts/results, completion evidence and expiration; history survives offboarding |
| PolicyVersion / Acknowledgment | Document hash, owner, applicable entities/audiences, effective/review dates, reviewer/publication state, acknowledgment of exact version and timestamp |
| QCCycle / Sample | Reviewed program version, population snapshot, sampling method/seed or documented selection reason, exclusions, findings and remediation case links |
| ExamPackage / ReviewerGrant | Scope manifest, redactions, document versions/checksums, preparation state, expiration, reviewer identity, download policy and access history |

Regulatory interpretation approval is distinct from engineering approval and brokerage sign-off. No client-supplied actor, role, acceptance flag or computed total is authoritative.

## 5. Obligation scheduling and monthly close

Generate occurrences only from reviewed templates and explicit applicability decisions. For unresolved decisions, generate review work and display unknown coverage. Support monthly/quarterly/annual, rolling and event-driven rules; preserve regulator timezone, cutoff, calendar vs business-day definition and holiday/extension basis. Do not use a universal federal holiday calendar or assume all dates shift from weekends.

Extensions require reviewed evidence, original deadline preservation and the authorized revised deadline. Rescheduling an internal task cannot change a legal deadline. Source/rule changes produce an impact preview and reviewed recomputation; past occurrences retain the prior basis. Jobs run idempotently, reconcile missed runs and publish last successful generation/coverage status.

Occurrence workflow: Planned → In progress → Awaiting evidence → Awaiting review → Completed. Return to an earlier work state requires a reason and event. Filing-related occurrences cannot complete until their configured evidence requirement is met. Overdue is a computed dimension, not a terminal status. Waiver/not-applicable requests require a reviewed applicability decision; ordinary task closure cannot suppress obligations.

Reminder policy supports tenant-configured offsets, channels and escalation with delivery status. Notifications contain minimal metadata and authenticated links. Reassignment/revocation updates future reminders; a failed delivery never marks a user notified. Deduplicate by occurrence, reminder version, recipient and channel.

## 6. Reporting and filing engine

Use existing call-report facts, readiness index, quarterly review, loan history and canonical cases. Add missing facts without changing historical intake/outcome values silently. Each aggregate has drilldown to source facts and transformation version. Reconcile opening pipeline + applicable activity/adjustments to closing pipeline, counts and amounts under the specific form definition; do not force all forms into one equation. Include nonfunded outcomes, withdrawals, denials, duplicates, geography, originator attribution and period-boundary cases as the applicable instructions require.

Accounting imports are staged: upload → parse → map → validate → reconcile → approve. Reject wrong-entity/period data, distinguish duplicate files from legitimate corrections, and retain adjustment reasons/approvers. Fee and financial totals cannot be guessed from loan amount. Exceptions identify exact rows and an owner. Validate required formats, precision/rounding, totals, enumerations, conditional fields and supported schema.

MCR: select applicable current form version by reporting period and regulator requirements; maintain a section/field matrix showing source, formula, manual inputs, coverage and evidence. Label incomplete sections. Zero-activity packages require reviewed treatment. Full supported export must pass authoritative schema/fixture checks; workpaper CSV remains clearly distinct.

State adapters: one versioned adapter per agency/form/period regime; reuse common facts but preserve state-specific meaning. Maintain all 50 states in the inventory while enabling only reviewed/tested adapters. Scope includes separately applicable annual financial statements and other reports. DC/territories remain visibly unsupported until added.

HMDA: determine institutional and transaction coverage, lender/broker attribution, reporting year and partial exemptions before generating a LAR. Use applicable published filing specifications and edit checks. Protected demographic data has restricted access and is not exposed in unrelated operational decisions or dashboards. Thresholds and deadlines are versioned reviewed rules, not product constants inferred from this document.

Filing lifecycle: Draft → Validating → Ready for review → Approved → Exported → Submitted → Accepted, with Validation failed, Submission uncertain and Rejected branches. Exported may return for changes; any changed data/schema invalidates readiness/approval and creates a new snapshot. Submitted requires an authorized attestation and supporting submission reference/evidence. Accepted requires evidence of regulator acceptance, distinguished from upload acknowledgment and reviewer attestation. A receipt awaiting verification stays pending. Where a regulator provides no explicit acceptance, show Submitted — acceptance not available; do not synthesize Accepted.

Manual filing uses an approved package and official destination instructions, then captures evidence. No stored regulator password is needed. Automatic filing is disabled until an authorized provider contract/interface exists. Use idempotency keys, polling/callback verification and reconciliation of uncertain outcomes before resubmission. Never blindly retry a possibly completed filing. Amendments reference the original package and retain both histories.

## 7. Training, policy and QC modules

Training supports employee onboarding and recurring role/topic assignments, versioned course content, assessments with explicit pass/reattempt rules, accessibility alternatives, reminders, completion evidence and expiration/retraining. Viewing a page is not course completion. Imported historical records retain issuer/provenance and are labeled imported. Monthly course assignment is a configurable learning schedule, not a universal legal requirement. Course titles cannot imply NMLS CE credit unless that offering is separately approved and verified.

Policy builders collect entity-specific facts and produce drafts for review. Support CMS, QC and employee-handbook scope plus reviewed program documents as needed. Publish only approved versions; keep historical effective periods and require reacknowledgment when the approved change policy calls for it. Templates must disclose missing facts; AI drafting cannot turn placeholders into adopted policies. Acknowledgment proves receipt/attestation, not operational compliance.

QC freezes the review population, applies an approved sampling method, links selected files and checkpoints, and records findings in the canonical case system. Evidence-based remediation and independent review follow the program's requirements. Complaints, marketing review, vendor oversight, licensing/renewal and management review reuse shared assignments/cases with appropriate confidentiality. Do not create a competing task inbox or expose confidential complaint contents through aggregate counts.

## 8. Evidence, examination access and operations

Package approved versions only, with a scope manifest, checksums, exclusions and preparation time. Block missing/corrupt documents and recheck permissions when generating and downloading. Redaction creates a derived artifact with provenance; it does not overwrite originals. Respect holds, approved retention schedules and restricted materials. Reviewer grants expire and are immediately revocable; log views/downloads. Downloaded copies cannot be remotely revoked, so package review and export policy must acknowledge that boundary.

Persist jobs and events through the existing Worker/Durable Object architecture. Use bounded batches, durable cursors, idempotent commands/outbox notifications, optimistic concurrency and immutable approval events. Queue delivery can repeat; business effects cannot. Store large artifacts in the approved object store and keep checksummed metadata in the tenant's durable store. Reconcile incomplete artifact/database operations after restart. Transactional auditing must fail the mutation if its required audit event cannot be written.

Queries scope by authenticated tenant/entity/capability before count/filter/pagination. Enforce limits for row count, package size and concurrent exports; expose queued/progress/retry states. Do not silently truncate regulator output. Define numeric limits and latency targets from CS0 pilot workloads before load acceptance. Record import failures, stale mappings, scheduler lag, receipt failures, notification failures and data-source drift without logging borrower payloads or credentials.

## 9. Acceptance scenarios

| ID | Required result |
| --- | --- |
| CS-A01 | Same licensed state but different entity/activity yields separate reviewed applicability; missing facts remain Needs review |
| CS-A02 | All 50 states appear in coverage with approved/unknown/unsupported status; absent adapters cannot export a regulator-ready package |
| CS-A03 | Month/quarter/year rollover, leap day, timezone cutoff and jurisdiction-specific holiday fixtures produce the reviewed dates |
| CS-A04 | Repeated scheduler delivery and restart create one occurrence/reminder effect; missed jobs recover with visible lag |
| CS-A05 | Internal target edits do not alter legal deadlines; approved extensions preserve original authority/date |
| CS-A06 | Monthly sign-off retains unresolved cases and coverage gaps; no universal compliant badge appears |
| CS-A07 | MCR fixture covers opening/closing pipeline, nonfunded outcomes, fees, financial sections and zero activity for the supported form |
| CS-A08 | Duplicate import, wrong entity/period, invalid amounts and unreconciled accounting totals block approval with exact-row errors |
| CS-A09 | Every filed total reproduces from snapshot lineage; drilldowns and exports obey identical access scope |
| CS-A10 | A concurrent source correction or new schema invalidates old readiness; approval binds to an exact immutable hash |
| CS-A11 | Download alone cannot mark Submitted; upload acknowledgment alone cannot mark Accepted |
| CS-A12 | Uncertain automated outcome enters reconciliation without duplicate filing; failed/rejected submission creates owned work |
| CS-A13 | Amendment preserves original attempt/receipt and shows changed facts, reviewer and new outcome |
| CS-A14 | HMDA coverage/exemption and lender-attribution fixtures differ correctly; unsupported year/schema and unauthorized demographic access are denied |
| CS-A15 | Employee cannot view another employee's assessment or company filings; revoked staff cannot execute queued actions |
| CS-A16 | Course completion requires the configured evidence; content update/offboarding preserves old records and applies retraining policy |
| CS-A17 | Policy drafts/placeholders cannot publish as approved; acknowledgment identifies exact document version |
| CS-A18 | QC sample reconstructs the approved population/selection, with exclusions and remediation case links |
| CS-A19 | Restricted investigation/SAR-related content is excluded from general summaries, reminders and default exam packages |
| CS-A20 | External reviewer sees only granted artifacts; expiry/revocation denies further access including direct object/download requests |
| CS-A21 | Missing/corrupt evidence blocks export; holds survive cleanup and restored tenant state preserves sources, approvals and receipts |
| CS-A22 | Wrong tenant/entity, forged roles, stale revisions and request-ID reuse with a changed payload are rejected server-side |
| CS-A23 | Desktop and phone populated views/selected records, main actions, filters, back navigation, focus after refresh, loading/error/retry states pass the UI gate |
| CS-A24 | Measured high-volume period preparation completes through bounded jobs with reconciled totals; failures resume without silent truncation or duplicated effects |

## 10. Release evidence and open decisions

Each package records source commit, migrations, supported report/jurisdiction/schema/period matrix, authoritative fixtures, legal/content reviewers, automated and hosted tests, role/tenant evidence, final desktop/phone screenshots and observed defects, restore/performance results, deployment version and live verification. Keep local and deployed evidence separate. Training/policy availability does not imply filing coverage.

Resolve during CS0: first licensed states/entities and product scope; current MCR form/version and financial inputs; accounting import formats; HMDA-covered design partners; authorized reviewers/filers; content rights and qualified reviewers; notifications; sole-operator review policy; supported filing interfaces; data retention and reviewer-export rules. These are discovery outputs, not reasons to delay the authorized planning work. Any unresolved release-critical decision blocks only its affected capability.
