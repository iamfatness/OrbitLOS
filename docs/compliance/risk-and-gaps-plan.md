# Compliance Risk & Gaps — delivery plan

Status: planned, November 10, 2026. User-directed sequence: **complete the UWM API implementation, then make compliance risk, gaps and enforcement the next priority**. This plan defines delivery of the [product/engineering specification](risk-and-gaps-spec.md); it extends, rather than replaces, the [C01–C12 regulatory-control backlog](implementation.md).

## Starting point and finish line

Delivered baseline: public-source research across all 50 states and 25 federal families, an admin research explorer, export and integrity tests. Not delivered: approved executable rules, tenant coverage approval, live finding/evidence services, risk dashboard, action enforcement, regulatory monitoring or operational compliance programs.

The finish line for a supported brokerage scope is an authorized user seeing current, actionable issues in their daily workflow; required evidence and decisions being retained; prohibited/undetermined protected actions being stopped server-side; and reviewers being able to reproduce why an action proceeded. Nationwide coverage requires separate completion of every applicable state/product/role/activity scope; a completed dashboard cannot establish it.

Planning can proceed now. Runtime delivery starts after the agreed UWM implementation milestone. Define that milestone with the UWM owner using the supported action matrix, receipts, recovery and tests; do not redefine it here as every possible lender API. Any compliance control already necessary for a proposed live UWM action remains a prerequisite to that action, even before this broader workstream starts. External access delays do not justify unsafe activation or false completion.

## Ownership and decisions

| Owner to assign | Accountability |
| --- | --- |
| Product owner | Approved launch states/products/roles/activities, queue usability, sequencing and claim scope |
| Brokerage compliance owner + qualified legal reviewer | Applicability, current authority, calendars/forms/thresholds, impact rubric, exceptions, operational obligations and release sign-off |
| Backend/platform owner | Tenant data model, evaluations, authorization, canonical findings/tasks, action gates and durable execution |
| UI owner | Brokerage dashboard, scoped file panels, workflow integration and accessibility |
| Provider/UWM owner | Responsibility mapping, evidence/receipt contracts, event semantics, unknown outcomes and provider reconciliation |
| Security/privacy owner | Restricted cases, exports, retention/holds, artifact access and incident/operational safeguards |
| QA/operations owner | Approved fixtures, adversarial and role tests, performance/recovery evidence, alerts and operating runbooks |

These are roles to assign, not named staffing commitments. Before live enforcement, resolve: initial supported scopes; primary/backup reviewers; legal source conflicts; lender versus broker duty ownership; minimum evidence per obligation; permissible manual alternatives; impact/escalation rubric; restricted-case access; and provider capabilities. Store decisions with evidence and expiry/revalidation triggers. Engineering foundations and fictional scenarios can proceed while these decisions remain open.

## Ordered delivery slices

| Slice | Work and dependency | Exit evidence |
| --- | --- | --- |
| RG-0 — Baseline and UWM handoff | After UWM milestone, inspect the actual release and shared working tree; reconcile current controls and service changes; inventory each protected action, event, receipt, evidence artifact and existing task. Preserve current source limitations. Depends on UWM owner handoff. | Action/responsibility matrix, exact baseline revision, evidence inventory, selected first scope, named owners and deduplicated backlog; no unsupported “live” claims |
| RG-1 — Canonical cases and coverage | Implement the three object types, independent statuses, tenant scope, revisions, confidentiality, ownership and event history. Add indexed list/detail/mutation services, coverage-health accounting and bounded legacy backfill. Depends on RG-0; maps to C01/C08. | RG-A01–03, A13, A16, A18–19; research entries remain unapproved; empty/backfilling tenant cannot appear safe |
| RG-2 — Risk visibility and daily work | Add Overview, Work queue and Coverage & gaps; embed scoped summary/detail in loans/leads; map canonical findings to Today/Tasks/Playbooks and Processing. Add review submission and truthful manual attestations. Depends on RG-1. | RG-A02, A05–07, A13, A18–20; manager-to-file-to-next-action walkthrough; counts reconcile; UI states and scoped roles verified. Label any detector not yet implemented |
| RG-3 — Evaluate and remediate | Build evaluator, evidence verification, approval/exception workflow, calendars and event-triggered reevaluation for selected approved rules. Add escalation, backup routing, staleness and worker health. Run in shadow mode on fictional/authorized pilot scope. Depends on RG-1/2 plus approved C rules. | RG-A04–07, A10–11, A14–19; findings match approved fixtures; original deadlines/history survive remediation; no auto-resolution on task completion |
| RG-4 — Protected actions | Integrate current checks into server mutations and durable provider dispatch. Cover local/hosted paths, existing customer APIs and automation paths. Begin with approved license/consent/credit requirements and extend to disclosures/fees/closing as their C packages are ready. Depends on RG-3 and provider evidence. | RG-A08–12, A14–17; direct-call bypass, concurrent changes, opt-out race and unknown-provider-outcome tests; explicit narrow scope release approval before enforcing live |
| RG-5 — Operations and evidence | Add restricted case handling or a reviewed external-system handoff, retained evidence exports, rule impact preview, reconciled reporting, source maintenance and recovery/incident runbooks. Depends on earlier slices and C08–C11; restricted data must never be placed in general cases in interim slices. | RG-A13, A15, A17, A19, A21–22; scoped export, retention/hold, on-call exercise, rollout/rollback and capacity results |
| RG-6 — State/product expansion | Complete atomic rule extraction and counsel review, provider templates/evidence and negative-path tests for each additional scope. Reuse the platform rather than copying state-specific screens. Depends on all applicable C/RG gates. | Per-scope signed release packet, correct coverage denominators and recorded unsupported cases; no blanket 50-state activation |

RG-2 is the first user-facing operational slice. It must expose incomplete detection honestly and must not enable activities whose controls are absent. Shadow mode observes proposed logic; it is not permission to run otherwise prohibited live activity. C09 organizational duties can require operational evidence without a new UI and remain release requirements where applicable.

## Traceability to the regulatory backlog

| Regulatory packages | Risk-system use | Required completion relationship |
| --- | --- | --- |
| C01 Scope/rules, C02 licenses | Coverage & gaps, authority findings, onboarding/assignment gates | Approved rules and current authority evidence precede protected actions in their scope |
| C03 clocks, C04 documents/signatures | Deadline findings, evidence review and corrected-package history | Legal calendars and validated receipt artifacts precede claims of timely fulfillment |
| C05 fees/compensation, C06 fair lending/credit/notices | Pricing/credit/notice findings and action-specific decisions | Reviewed calculators, notice responsibility and actual provider evidence required |
| C07 outreach | Lead/campaign findings and dispatch restrictions | Consent/suppression/local-time checks current at dispatch; existing Eastern CRM scheduling is not enough |
| C08 privacy/security/retention | Evidence custody, restricted access, incident and deletion findings | Tenant and confidentiality boundaries apply from RG-1, not as late hardening |
| C09 operational programs | Named program gaps, controlled attestations and restricted case handling | Software tasks alone cannot establish AML/training/testing or sanctions program performance |
| C10 reporting, C11 change maintenance | Filing/coverage gaps, rule impact previews, stale-review work | Accurate filing evidence and monitored rule changes required for applicable live scopes |
| C12 role/product expansion | Separate coverage and approval dimensions | Do not inherit broker closed-end approval for servicing, creditor, HELOC or other roles/products |

## Implementation map and reuse

- Extend `src/components/compliance-register.tsx` into a routed/view-based compliance workspace; retain research without reclassifying its data. Keep public catalog models separate from new tenant-sensitive operational models.
- Integrate scoped summaries into `orbit.tsx` and existing loan/lead workbenches. Reuse task/deep-link patterns in `file-exceptions`, `manager-exceptions`, Today, Processing and Playbooks; project the same canonical finding rather than writing independent completion state in each UI.
- Add proposed `compliance-risk-model`, query/store, evaluator, evidence and action-decision modules, with clear boundaries. Naming is provisional; confirm active UWM/shared integration work before adding modules or duplicating services.
- Use the existing SQLite/tenant Durable Object and shared provider execution/outbox. Expose authorized adapters through `actions.ts`, local/hosted workspace services and Worker routes as appropriate. All new mutating paths enforce tenant identity, role/capability, expected revision and idempotency server-side.
- Apply retention/hold checks to document replacement and cleanup, not only new uploads. Keep investigation artifacts out of ordinary activity/search/export projections from the first schema migration.
- Add incremental, restartable backfill and counter rebuild migrations. Migration output includes source mode, unknown timestamps, processed population and pending work; rehearsal must cover existing populated brokerages.

## Verification and release gates

Use RG-A01–A22 as the risk-workflow acceptance set; add legal-rule fixtures from each applicable C package. The first release packet includes domain tests, authorized role/tenant tests, deterministic event/calendar cases, provider contract/replay/failure cases, local and Worker service checks, browser workflows and representative performance/recovery results. Run ordinary repository typecheck/lint/build plus scoped tests; fix or disclose environmental limitations, rather than claiming full validation from catalog integrity checks.

Promote separately through: fictional demo → shadow evaluation on authorized scope → approved pilot enforcement → expanded production scope. Each promotion records code/rule/scope versions, reviewers, outstanding gaps, provider evidence, access test results, monitoring owner and rollback steps. A UI feature flag does not grant regulatory approval. No unresolved prerequisite can be hidden by an aggregate completion percentage.

Rollout uses tenant/scope feature controls and bounded migrations. Preserve old evidence/decisions and compatibility during deployment. If evaluator/provider health fails, keep affected protected actions unavailable and retain draft/remediation/history paths. Rollback disables affected activity or uses an explicitly still-valid reviewed version; it never silently restores a superseded legal rule or erases missed-event history.

## Success measures and prioritization

Measure reduction in unassigned overdue work, time to find and resolve a real issue, false findings/reopened cases, stale evidence and failed notification recovery. Display evaluated population and incomplete coverage alongside operational counts. Track reproducibility of sampled action decisions and completeness of required artifacts. No single compliance score, completion percentage or passing mock scenario is a readiness claim.

Engineering latency/backlog targets in the spec are proposed pilot objectives to measure against declared fixtures and load. Maintain delivery-plan capacity and security gates independently. Do not promise dates until RG-0 confirms available owners, actual UWM contracts, provider access, scope and legal-review effort. After RG-0, estimate each slice with dependencies and confidence; provider waits and legal review are separate from engineering effort.

## First execution checklist after UWM

1. Read the UWM completion report and verify supported actions, responsibility boundaries, receipt states, event ordering, dispatch/retry implementation and remaining access limitations.
2. Reconcile C01–C12 and RG-0–RG-6 against the current tree; create one owned backlog with links to requirements and RG acceptance IDs.
3. Select the first brokerage/state/product/activity fixture and the compliance reviewer; keep nationwide research breadth separate from release scope.
4. Finalize canonical finding/evidence/decision schema and capability matrix; start RG-1 migration and negative-path tests.
5. Build the RG-2 dashboard plus exact-file remediation path, then progressively wire reviewed detectors and protected-action checks. Keep coverage health visible throughout.

The plan/spec are planning deliverables only. Implementation, legal review, named owner assignments, live deployment and external notifications are not completed by publishing these documents.
