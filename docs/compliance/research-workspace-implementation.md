# Research and control-gap workspace implementation

Implemented November 11, 2026 on branch `feature/compliance-research-workspace-20261111`, based on release checkout commit `1165731`. This slice extends the existing fictional-pilot Compliance workspace. It has not been deployed by this task.

## Delivered behavior

Pilot brokerage admins can open Compliance → Research & gaps, browse 50 state source entries and 25 federal research areas, and create a requirement review or control gap for an entry. Repeated creation reuses the same case. Work has an accountable active admin, workflow status, next action, optional internal follow-up date, required progress/reason note and revisioned history. The date is a UTC planning target, not a statutory deadline.

Research work uses the existing `compliance_cases` and `compliance_case_events` records. An additive `compliance_research_work` table retains source snapshots and research metadata. Research cases also appear in the canonical work queue. No parallel issue store or new role grant is introduced.

The research queue filters by jurisdiction, workflow status and ownership, with bounded pagination and internal overdue counts. Owner revocation/reinvitation invalidates the saved ownership revision. Historical source snapshots remain intact; changed catalog content is flagged for review. Review history displays the latest 50 events and indicates when more history exists.

## Boundaries

The existing authenticated server action and current-roster checks remain authoritative. Research operations additionally require Admin, pilot access and the current tenant. Restricted and loan-linked cases are excluded from the research projection, including counts and duplicate-create responses. Saves are transactional, reject stale revisions, and accept only exact retries of an already recorded request.

The preliminary research baseline is November 10, 2026. The catalog is not an exhaustive rule set. DC and territories remain outside its scope. Workflow progress cannot grant legal approval, resolve a legal violation, activate a jurisdiction, waive a requirement or claim runtime enforcement. No borrower information, privileged advice or investigation material belongs in general research notes.

## Verification

- 495 automated tests passed across the repository, including nine new research tests and existing canonical-case tests.
- Typecheck, lint and production-target Cloudflare build passed.
- Built-Worker working-day rehearsal passed authenticated creation, deduplication, update, exact retry, stale-write rejection, role denial, tenant denial and filtered-list assertions.
- Desktop browser rehearsal opened the source library, created a federal control gap, saved a next action and note, and verified revision 2 plus actor/time/history. The rendered page retains explicit unverified legal-approval and enforcement notices.
- No live UWM request or deployment was performed. Browser rehearsal used fictional local test data. Mobile-specific visual testing was not performed.

## Integration and next slices

Integrate this branch after the active UWM work at a clean checkpoint. Review the additive table against any intervening restore/export changes: full-database snapshot handling must preserve research metadata along with canonical cases and events. The working-day script has new assertions within the existing compliance stage; reconcile any concurrent edits there.

Next implement reviewed atomic requirements and applicability/version management, map them to tested platform controls, and connect file findings to actual evidence and server-side action gates. Expand beyond pilot access only with the corresponding product and authorization work. A restricted external reviewer portal remains a later, separate slice. Existing risk-and-gaps plan/spec define the broader program; this implementation does not mark that program complete.
