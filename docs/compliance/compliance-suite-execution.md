# Compliance Suite execution and release ledger

## User decisions and release ownership

- Research all 50 states. Michigan is the first pilot team.
- User reviews first; a lawyer must review before launch. No legal review has been supplied or implied by engineering tests.
- User authorized execution and release coordination with the Gather UWM API information agent. That agent retains production promotion ownership; do not deploy a competing build during its active hold.
- This worktree is `feature/compliance-suite`, based on `3e85664`. Root checkout contains unrelated changes and must not be broadly staged.

## Package status

| Package | Evidence in this branch | Remaining work |
| --- | --- | --- |
| CS0 | All 50 states have preliminary reporting matrix rows; Michigan detailed review list; MCR/HMDA artifact inventory and training/policy content review packet | Verify exact pilot legal entity/licenses/fiscal year; resolve source conflicts; full field-level reporting mappings; user then lawyer review. State rows are research coverage, not approved rule coverage |
| CS1 | Implemented local entity/month internal work with admin ownership, target dates, evidence references, revisioned events, retry safety, monthly snapshots and restore protection | Browser acceptance; reviewed obligation templates/applicability; recurrence/jobs/reminders; canonical remediation links; calendar due-date rules; entity profile editing and delegated capabilities. This is partial CS1 |
| CS2 | Existing quarterly preparation retained; authoritative FV7 artifact links and section-level gaps documented | Complete field mapping/financial imports/XML serializer/schema fixtures/filing lifecycle. Proposed reporting ownership with release agent; acknowledgment and implementation pending |
| CS3 | 50-state reporting research plus HMDA scope/form inventory | State/HMDA adapters, authoritative fixtures, legal review and submission evidence; all remain unsupported as automated filings |
| CS4 | Twelve original draft training outlines, cadence distinctions, content and accessibility review requirements | Course/assignment/assessment/completion services and employee UI; reviewed content and qualified sign-off |
| CS5 | Policy/QC source and publication review matrix | Versioned builders, acknowledgments, reproducible QC cycles and program workflows |
| CS6 | Release checklist and scope boundaries documented | Examination packages/reviewer grants; operational/legal/commercial acceptance and measured design-partner outcomes |

The whole plan is **not complete**. Do not convert the package table to completed merely because a source document, placeholder or review category exists.

## First implementation behavior

`Compliance → Monthly review` is a pilot-admin workflow for internal planning. Add up to 50 legal-entity profiles per brokerage, choose a month, and schedule up to 200 review work items per entity/month. Caps reject additional creation; results are not silently truncated. Categories organize internal reviews and do not implement training delivery or regulatory filing.

Work can be assigned only to current active admins. Revocation/reinvitation makes the saved owner unavailable until reassigned. Targets are UTC internal planning dates, not statutory due dates. Completion requires prior Awaiting review status and an evidence reference; it records an admin review, not independent legal validation or regulator acceptance. Self-review is possible in this internal pilot and is not labeled independent.

Monthly review preserves a snapshot of counts, unresolved work, entity and coverage. Later changes to data, owner access or date make the snapshot historical. It never closes outstanding work. History displays the latest 50 events; monthly snapshots show the latest 20. Older records remain stored. General notes are not for borrower data or privileged investigations.

The additive `compliance_program_entities`, `compliance_program_items`, `compliance_program_events` and `compliance_program_reviews` tables initialize through existing storage setup. Mutations reuse the authenticated compliance action and current roster, run transactionally and audit atomically. Exact retries reuse prior effects; changed payloads with the same request ID and stale revisions are refused. Restore blocks a rewind when program tables differ from the checkpoint.

## Verification

- 525 repository tests passed on the final code candidate, including 12 program tests: tenant/role/pilot/current roster, replay, stale edits, cross-entity/period writes, evidence transition, historical snapshots, owner reinvitation, initialization, limits and restore blocking.
- Typecheck and lint passed; final production-target Cloudflare build passed.
- Built-Worker working-day rehearsal passed the new authenticated create/schedule/update/replay/monthly review and role/tenant assertions on the first build. The final code change separates the restore message and removes redundant table initialization; focused restore tests and final build passed. The final built-Worker working-day rehearsal also passed on the final candidate (local mock fixture, not production).
- Impeccable source detector scanned both changed components; it found no regex findings but explicitly did not run rendered-page rules.
- Browser attempt was blocked: local browser use disabled in Work settings. No desktop/phone screenshot, populated-screen visual inspection, keyboard/focus or UI error-recovery acceptance was completed for this candidate. Do not reuse prior portal screenshots as acceptance.

## Release checklist and next steps

1. Release agent reconciles this commit with its current release after the cutover production hold is released. Shared touchpoints: compliance-cases, compliance-case-store, compliance-workspace, workspace-restore and working-day script.
2. Complete final built-Worker rehearsal and UI gate when browser access is available. Inspect populated month, selected work and history at desktop/900px/390px; exercise filters, create/edit/review, return focus, refresh, stale save, denied access and local failure/retry.
3. Integrate only with truthful internal-pilot labels and feature scope. No new production legal capabilities or automatic filings are activated. User review and lawyer approval precede launch.
4. Continue CS1 obligation/applicability/rule versioning and monthly generation. Continue CS2/3 schema mapping and fixtures with reporting owner; then CS4/5 services and reviewed content, and CS6 controlled exam evidence.
5. On any deployment, record exact source/Worker identity, active traffic, binding/asset checks, new table/restore checks and signed-in pilot acceptance. No deployment occurred in this task at creation of this ledger.

## Review packet

## Backend integration follow-up

The authenticated compliance action now accepts `obligations` and `learning` requests, returning a distinct envelope with a service result. Storage initializes six additive tables for obligation versions, occurrences and events, plus learning versions, assignments and events. Restore protection includes all six tables. Both services run inside the existing tenant-authenticated transaction.

Obligations support internally reviewed applicability, versioned source/effective-date records and explicit repeat-safe generation of monthly, quarterly or annual planning occurrences. Missing applicability creates a review gap. Targets are internal dates; this does not implement a statutory scheduler, reminders or regulator filing.

Learning supports immutable policy/course versions, review evidence, internal publication, employee assignments, exact-version acknowledgments and server-graded attempts. Publication requires recorded user-review and lawyer-review attestations; references are not independently verified lawyer credentials or legal approval. This is not accredited CE. There is no learning or obligation screen yet.

Integration verification: all 542 repository tests, typecheck, lint and the production-target Cloudflare build pass. Tests cover the authenticated routing and atomic audit rollback as well as each service's lifecycle and access boundaries. This increment has not been deployed or visually accepted. Browser retry still reports local browser use disabled despite visibly enabled desktop controls; the user has authorized access, so no additional permission request is pending.

The suite remains incomplete. Employee screens, statutory cadence validation, reminders, reviewed course content and controlled exam workflows remain open; see the package ledger and plan. The release agent remains the sole production promotion owner.

- [Alabama–Missouri, including detailed Michigan pilot](reporting-states-a-m.md)
- [Montana–Wyoming](reporting-states-m-w.md)
- [MCR/HMDA form inventory and implementation gaps](reporting-form-inventory.md)
- [Training and policy content review](training-policy-content-review.md)
- [Delivery plan](compliance-suite-plan.md) and [specification](compliance-suite-spec.md)
