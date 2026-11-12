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
| CS1 | Implemented local entity/month internal work; versioned obligation registry and local screen; explicit period generation/history; tenant/owner checks, retry safety, monthly snapshots and restore protection | Browser acceptance; reviewed obligation templates/applicability; automatic recurrence/jobs/reminders; canonical remediation links; statutory deadline rules; entity profile editing and delegated capabilities. This is partial CS1 |
| CS2 | Existing quarterly preparation retained; authoritative FV7 artifact links and section-level gaps documented | Complete field mapping/financial imports/XML serializer/schema fixtures/filing lifecycle. Proposed reporting ownership with release agent; acknowledgment and implementation pending |
| CS3 | 50-state reporting research plus HMDA scope/form inventory | State/HMDA adapters, authoritative fixtures, legal review and submission evidence; all remain unsupported as automated filings |
| CS4 | Twelve original draft outlines; version/assignment/assessment/completion services; local draft/review/assign and employee screens; admin assignment completion and revocation | Visual acceptance; reviewed production content and qualified sign-off; rich authoring/version replacement, reminders and accessibility verification |
| CS5 | Policy source review matrix; immutable policy versions and employee acknowledgment workflow; assignment revocation with retained completion evidence | Revision authoring screens; reproducible QC cycles, complaints and remediation integration; operational acceptance |
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

The suite remains incomplete. Statutory cadence validation, reminders, reviewed course content and controlled exam workflows remain open; see the package ledger and plan. The release agent remains the sole production promotion owner.

### User workflow follow-up

### Obligation-to-work follow-up

Period history now offers Plan review work. It creates exactly one monthly review item from the immutable occurrence basis, including applicability gaps, source, original rule version, owner and internal target. Retries and separate requests return the same work item. Later obligation edits do not change that basis. Unavailable original owners are rejected with instructions to review and manually reassign the work; exclusions remain reviewable and are never silently completed. The new `compliance_obligation_work` linkage is transactionally audited and restore-protected. This is explicit internal planning, not an automatic statutory scheduler or reminder service.

Validation: 546 tests, typecheck, lint, production-target build and the expanded authenticated built-Worker rehearsal passed. Source-only design scan ran; visual acceptance remains pending with the release agent. The release agent confirmed integration of the earlier three commits is next after its current offboarding release, with separate admin/staff browser acceptance before promotion. Current live reporting includes quarterly readiness; separate FV7 workpaper commits are not confirmed in the published source.

Local Obligations now supports entity selection, paginated internal applicability review, version creation, explicit period generation and history retaining the original rule version. Local Training & policies supports draft policy/course authoring, recorded user/lawyer review evidence, internal publication and assignment. The daily compliance work panel exposes My training & policies, including current employees' own assignments, acknowledgments and assessments. Admins can also retrieve their own assignments without receiving the entire library in that view.

The course editor currently creates two-answer questions (up to 20). Version replacement remains a backend capability without a dedicated editor. Admins can inspect paginated assignment completion and revoke assignments with a reason; completed evidence is retained after revocation. No production content or lawyer review was fabricated; rehearsal attestations are explicitly synthetic. No automatic notification or filing is performed.

All 544 repository tests, typecheck, lint and the production-target build passed for this increment. The UI source detector did not report regex findings; rendered checks did not run. Browser control is unavailable, so these screens remain unverified and undeployed. The expanded built-Worker rehearsal passed on the final candidate, including obligation generation/history, role denial, policy publication review gate, assignment access and exact-retry acknowledgment. All rehearsal content and review references are fictional.

- [Alabama–Missouri, including detailed Michigan pilot](reporting-states-a-m.md)
- [Montana–Wyoming](reporting-states-m-w.md)
- [MCR/HMDA form inventory and implementation gaps](reporting-form-inventory.md)
- [Training and policy content review](training-policy-content-review.md)
- [Delivery plan](compliance-suite-plan.md) and [specification](compliance-suite-spec.md)

## Internal compliance pilot published November 11, 2026

OrbitLOS.com serves Worker `87d41312-c616-4615-b4e9-e4af0006e991` from application source `00498e79efca`. The pilot admin can open Monthly review, Obligations, and Training & policies from Compliance. An obligation period can create one owned monthly review item and retains the original obligation version. An LO opens personal assignments from Today and a processor opens them from Processing.

A built fictional 47-stage rehearsal and separate owner, LO, and processor browser sessions verified the release. The checks covered filtering, a concurrent edit with retained input, monthly snapshot evidence, obligation period history and retry, interrupted draft recovery, course review and assignment, assessment retry and completion, policy acknowledgment, and role boundaries. See [UI review coverage](../ui-review-coverage.md) for screenshot evidence. The public Demo describes the internal fictional scope.

State coverage, applicability, statutory calculations, real training content and filing remain subject to the existing review gates. Course revision authoring and the FV7 workpaper are separate increments.
