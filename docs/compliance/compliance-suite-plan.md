# Orbit Compliance Suite — delivery plan

Status: proposed implementation scope, not a deployment or compliance certification. Requested by the user as a Simply Compliant competitor. This extends [Compliance Risk & Gaps](risk-and-gaps-plan.md) and [C01–C12](implementation.md); it does not replace their live-operation gates. Detailed behavior is in the [suite specification](compliance-suite-spec.md).

## Outcome and positioning

A brokerage owner can identify applicable obligations, close the month, prepare and reconcile filings, prove staff training and policy acknowledgments, and assemble examination evidence from one workspace. Report totals trace to loan and financial records; missing facts become owned remediation work rather than disconnected spreadsheets.

Monthly internal review is a product workflow, not a claim that every regulator requires monthly filings. Actual obligations may be monthly, quarterly, annual or event-driven. Applicability and cadence must be reviewed for each entity, license, jurisdiction, activity and reporting period.

Simply Compliant publicly advertises employee training, completion records, QC/CMS/handbook builders and a branded employee portal. Those are the competitive baseline. Its public pages reviewed for this plan do not establish a complete regulatory filing offering; do not claim it lacks one. Orbit's proposed differentiation is integrated LOS evidence and regulatory reporting, subject to demonstrated results. Use independently authored or licensed training and templates, not copied competitor content. [Vendor source](https://simplycompliant.com/).

## Current baseline and gaps

The root checkout contains substantial unrelated edits and older pilot code. Planning also inspected the active release checkout at `704284d`; this is a source baseline, not proof every capability is deployed or enabled for every tenant. Reconcile the release and user role before each implementation package.

| Area | Existing foundation | Required expansion |
| --- | --- | --- |
| Research and findings | 50-state/federal source library, canonical compliance cases, owners, notes and evidence workflows | Reviewed atomic obligations, applicability decisions, effective dates and maintained authority |
| Call reporting | Quarterly application prep, source-loan drilldowns, readiness checks, prior-quarter review and CSV workpapers | Complete supported MCR schema, fees/financials, authoritative validation and filing lifecycle |
| Retention | Pilot loan hold/history/export workflows | Approved record-category schedules and suite-wide preservation/restore coverage |
| Staff and operations | Tenant membership, roles, tasks, review queues, playbooks and audit events | Delegated compliance capabilities, training records and acknowledgment workflows |
| Filing coverage | Research identifies reporting obligations | Entity-specific calendar, state adapters, HMDA coverage and filing packages, receipts/amendments |
| Policy/QC/exams | Documents and canonical case infrastructure | Versioned policies, repeatable QC programs, controlled exam packages and reviewer access |

Existing CSV output remains an internal workpaper. No existing feature is relabeled as regulator-ready, submitted or accepted by this plan.

## Delivery packages

Sequence follows the user's UWM-first direction. Reconcile already completed UWM/release work before starting; do not duplicate active call-report or retention work. Packages are dependency milestones, not promised dates.

| ID | Package and accountable disciplines | Dependencies | Exit gate |
| --- | --- | --- | --- |
| CS0 | Baseline and obligation inventory — product, compliance reviewer, engineering | Current release inventory | Representative brokerage profiles; all 50 states plus federal tracked with explicit unknowns; reporting forms/cadences/schema versions sourced; priority states chosen from actual licenses; competitive scope and metrics agreed |
| CS1 | Obligation calendar and monthly close — backend, product, design, compliance | CS0 reviewed seed obligations; existing RG ownership/access | Entity-specific occurrences, reminders, owners, evidence and monthly review; no false exemption, overdue suppression or unsupported deadline claims |
| CS2 | Complete supported MCR preparation — reporting engineering, accounting reviewer, compliance | CS0 schema approval, CS1 periods; current call-report infrastructure | Full scoped form/sections, reviewed field mappings, financial imports, reconciled totals, immutable approved package, accepted-format export and controlled manual filing/receipts |
| CS3 | State reporting and HMDA — reporting engineering, jurisdiction reviewers | CS1/CS2 common filing engine | Named state adapters and conditional HMDA coverage/data validation pass authoritative fixtures; corrections and receipts verified; unsupported combinations remain explicit |
| CS4 | Training and employee portal — content lead, compliance reviewer, product | CS0 roles/content rights; CS1 assignment machinery | Reviewed course versions, assignments, assessments, completions, acknowledgments and accessible employee portal; training never misrepresented as NMLS CE |
| CS5 | Policies, QC and compliance operations — compliance lead, operations, engineering | Existing RG cases; CS1; CS4 acknowledgments | Approved policy versions, QC population/sampling evidence, complaints and remediation, recurring management reviews and controlled publication |
| CS6 | Examination readiness and commercial release — security, QA, product, compliance | Applicable CS1–5 modules | Scoped export/reviewer access, restore/security/performance evidence, design-partner acceptance and supported-scope matrix; replacement claims backed by evidence |

CS4 content preparation may proceed while CS2/CS3 reporting adapters are developed; shared authorization and task infrastructure have one owner. Report-family releases can be independent when their own gates pass. Do not hold a valid MCR slice for every state adapter, or market a subset as nationwide coverage.

## First implementation increment

Implement CS1 with one reviewed obligation type and a fictional brokerage profile before introducing broad deadline calculations:

1. Verify current tenant, legal-entity, member-role, case, task and reporting contracts; add schema migration/restore coverage.
2. Add versioned obligation templates, applicability decisions and idempotent period occurrences.
3. Add the owner calendar/list and monthly review checklist, backed by canonical remediation cases.
4. Preserve evidence, ownership changes and review history; surface unreviewed applicability and incomplete coverage.
5. Rehearse period rollover, revoked owners, a corrected due date, stale saves, retries, rejected evidence and restart recovery.
6. Complete local desktop/phone visual acceptance, then release under existing authorization and verify the deployed role-specific workflow.

In parallel planning, CS2 must produce a field-by-field mapping of the applicable NMLS form version to existing LOS facts, accounting data and missing inputs. Do not assume an older NMLS guide link establishes the correct reporting schema for a new period.

## Research and content deliverables

The 50-state matrix must record agency, license/form, covered entity/activity, frequency, period, legal deadline formula, extensions/holiday rules, zero-activity requirements, destination, schema, authority section, effective dates, reviewer and unresolved questions. Include financial statements, renewals and event notifications where applicable, without treating every obligation as a report. Federal coverage is separate, including conditional HMDA and specially restricted reporting workflows. DC and territories are separate inventory rows marked unsupported until researched.

Publish source/reviewer/change history for each approved obligation. Establish source monitoring with triage ownership and manual review fallback; monitoring failure must show stale coverage. Training and policy content require topic owner, rights, audience, accessibility review, effective/review dates and qualified review. AI can draft material but cannot approve applicability, certify training, make legal conclusions or submit filings.

## Validation and measurable success

Before a replacement claim, pilot with at least three agreed representative brokerage profiles: small single-state broker, multistate broker, and an entity requiring a different reporting scope. If a profile is unavailable, record that scope as unverified rather than substituting a fictitious customer claim. Use synthetic data for engineering tests and authorized data for operational pilots.

Proposed release targets, to confirm with design partners: 100% of supported obligation scenarios have approved sources and tests; 100% of filing totals have reproducible lineage; no acceptance claims without verified evidence; no cross-tenant access; and at least 30% reduction in active report-preparation time against the same-scope measured baseline. Track deadline completion, unresolved coverage, stale rules, rejected filings, corrections, training completion, overdue remediation and evidence assembly time. A green dashboard is never a global compliance score.

Test end-of-period concurrency, schema changes, multi-entity isolation, large exports, partial job failure, backup/restore and revocation. Size loads from measured tenant distributions and the existing delivery/scale plan; cap and resume work instead of loading all loans into browser memory. Budget implementation only after CS0 data/schema discovery; estimate engineering, legal/content review, vendor integration and visual acceptance separately. No deployment date or nationwide support date is committed here.

## Release boundaries

Release flags are module + tenant + legal entity + report family + jurisdiction + period/schema, with authoritative server checks. Unsupported jurisdictions, incomplete mappings or unresolved applicability cannot produce a ready-to-file label. Manual assisted filing is the first delivery mode; automated submission requires a supported interface, credentials, authorization, receipts and duplicate-submission protection. Do not assume NMLS or a regulator provides a public submission API.

Restricted investigations and SAR-related material must remain outside general training, reporting summaries and examiner bundles unless specifically authorized and legally reviewed. Initial scope tracks generic AML program work only; SAR preparation/submission is a separately gated capability.

Each visible implementation must use the repository UI quality gate, installed Impeccable and UI UX Pro Max skills, and approved 21st.dev/accepted pattern routing. Inspect populated screens and selected records at desktop and phone sizes, actions/filters/return navigation/focus, and loading/error/recovery states; update `docs/ui-review-coverage.md`. This planning task makes no visual-acceptance claim.

## Primary references and maintenance

- [Simply Compliant public offering](https://simplycompliant.com/): competitive product description only, not legal authority.
- [NMLS annual and quarterly reporting](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/pubs/ugCompState/licensing/company/topics/licCompMaint_annQtrReporting.html): reporting varies by state/license; use current form instructions and state checklists per reporting period.
- [Regulation C §1003.5](https://www.consumerfinance.gov/rules-policy/regulations/1003/5/): annual reporting and conditional quarterly reporting; determine institutional and transaction coverage separately.
- [Existing federal research](federal.md), [state A–M research](states-a-m.md), [state M–W research](states-m-w.md): preliminary inputs requiring review, not approved rules.

Sources were revisited during preparation of this plan. At CS0, preserve retrieval timestamps/content hashes and applicable versions in the rule inventory; links alone are not a maintained legal rule set.
