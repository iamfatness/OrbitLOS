# Compliance Risk & Gaps baseline

November 10, 2026. RG-0 engineering inventory. Cloudflare reports Worker `e596597e-9c0e-4083-8547-3c1f62151f9f` serving 100% of OrbitLOS.com traffic, with source `f0055788acd3f04ef3ab78865c12423d707381c9`. Release record `5e50011` confirms admin verification and 35 UWM stage offers from a fictional purchase. The deployed source is the reference for this inventory. The separate compliance research work remains in the shared checkout and is research only. [UWM release verification](uwm-release-2026-11-10.md)

## Actions and evidence

| Action | Current path and persisted evidence | Boundary and accountable role to assign |
| --- | --- | --- |
| Intake and assignment | `applications.ts`, `lead-inbox.ts`, `commands.ts`, and `application_versions` preserve file changes and reviewed 1003 revisions. Assignment and handoff work identify staff owners. | A completed 1003 is one file event. Per-element receipt and regulatory-clock applicability still need validation. Assign intake operations and compliance reviewers for C01–C03. |
| Credit and AUS | `mock-credit-aus.ts` records fictional runs and findings in `mock_credit_aus_runs`. | Assign the credit integration and compliance reviewers to verify permission, notice responsibility, and actual provider evidence for C06. |
| Price | `commands.ts` and `pricing-provider.ts` record provider, mode, scenario reference, input, result, and 1003 and income-review revisions in `pricing_runs`. UWM stage pricing was verified on a fictional conventional purchase. Non-QM stage pricing returns unsupported and the LO can record a manual offer. | Keep stage inputs fictional. Before an Insights brokerage is mapped, review `uwmPricingEnvironment` because its exact-brokerage path can also select `uwm-stage`. Assign pricing and provider owners to confirm permitted input/environment and current product mappings for C05. |
| Read lender status and conditions | `uwm-live.ts` scopes Insights to one brokerage. `uwm.ts` stores accepted status, conditions and sync time in `submissions` and creates `uwm_alerts`. The deployed fictional workflow uses sample data. | Separate Insights credentials and brokerage mapping are pending. Before operational use, the provider owner must verify completeness, timestamps, matching and missing or reordered events against the authorized shop. A read snapshot establishes observed lender status. |
| Submit, lock, deliver, clear | `commands.ts` guards simulated lender mutations in a connected brokerage. Fictional files use `mock_uwm_acceptances`, `mock_uwm_rates`, and `uwm_document_deliveries` with delivery history. `lender-export.ts` provides staff-recorded handoff evidence. | Assign provider and processing owners to validate separate write permissions, lifecycle callbacks, unknown outcomes and recovery. Keep provider-confirmed, simulated, and staff-recorded evidence distinct. [Connector acceptance](lender-sandbox-acceptance.md) |
| Prepare, issue, and review disclosures | `disclosures.ts` records versioned sample packages against application, quote and fee revisions. It also records sample issuance and signer activity. `commands.ts` records manually entered disclosure status, and the workbench records closing disclosure review. | Treat each record as evidence of the action Orbit actually observed. Assign the brokerage reviewer and lender counterpart to confirm responsibility and evidence for delivery, receipt, revised versions, and waiting-period calculations under C03–C04. |
| Outreach | `outreach-preferences.ts` and campaign commands use contact preferences and suppression records. Email and text execution is simulated. | Before live dispatch, assign communications and compliance owners to validate purpose, permission, local time and current suppression at the dispatch boundary for C07. |
| Closing, reporting and records | Closing/funding commands, pipeline exports, document requests, accepted file revisions and cleanup each have a separate operational path. | Assign closing, reporting and privacy owners to verify custody, export scope and holds across replacement, cleanup, filing and deletion for C08–C11. |

## First engineering fixture

Use a fictional Michigan conventional purchase with a single brokerage, assigned LO and processor, and an owner reviewing one versioned disclosure package. This is a test fixture. Test a staff-entered status, a missing receipt, an older package version, and an authorized review of sample evidence. Retain the Michigan applicability question as a requirement review, the unverified delivery connector as a control gap, and the exact-version receipt issue as an operational finding. Give each independent status and history. No statutory timer or production action is enabled by the fixture.

| Sequence | Work | Acceptance and owner role |
| --- | --- | --- |
| RG-1 / C01, C08 | Add tenant-scoped case types, ownership, revision, event history, and coverage health. Exercise restartable backfill and unapproved research separately. | Platform and privacy review. RG-A01–03, A13, A16, A18–19. |
| RG-2 / C03, C04 | Connect owner overview to the exact filtered queue and versioned file. Surface assigned work in the LO or processor's existing queue. Preserve queue state on return. | Design and QA review. RG-A02, A05–07, A13, A18–20. |
| RG-3 and RG-4 / C01, C03, C04 | Add reviewer-approved evidence and decisions, then test stale input, duplicate events, and denied actions using approved fixtures before any enforcement. | Named brokerage compliance reviewer, lender counterpart, and engineering owner required. |

RG-0 still needs named brokerage and legal reviewers, an agreed operational scope, and approved evidence and responsibility assignments. The fixture and design can progress while those decisions remain open.

## RG-1 foundation

The service in `src/lib/compliance-cases.ts` uses the existing workspace SQLite store. Its three case types have independent workflow status, ownership, optimistic revision checks, and append-only application history. The server caller must supply the authenticated staff session, its actual brokerage store and ID, and the directory's current roster. Brokerage admins see general workspace cases. LOs and processors can read findings for their assigned loans, and only a current case owner or admin can change workflow status. Restricted case rows are excluded before detail, counts, links, and paging. If the stored owner loses access, the projection routes work to an active admin or shows it needs assignment.

The only case creation path is an explicit pilot-admin fixture for a fictional Michigan conventional purchase with a current sample disclosure package. Opening the same version reuses its case and shared review/gap. A new package version can open a distinct finding. The sample workbench review must match the latest package version and revision. Its provenance is retained separately from case workflow status and current coverage. Manual disclosure status and task completion provide no sample review. Both new and existing stores begin with coverage **Not evaluated**, with the eligible population unknown.

RG-1 acceptance here covers foundational role and tenant scope, visibility, idempotent changes, stale queue pages, sample evidence and owner fallback. The remaining work includes a bounded inventory and backfill with health reporting, organization and rule scope, and delegated reviewer capabilities. Keep legal approval, rule evaluation, operational evidence, and action enforcement for their gated stages.

## Fictional pilot queue

- A signed-in pilot owner can open **Workspace → Compliance** for case counts, filters and detail. **Open file finding** returns to the specific loan and case. The case owner or admin can move workflow status. Only admins can assign active staff or record an exact-version sample workbench review.
- An assigned LO or processor opens **Loan details → Compliance** to see only findings for that file. The page distinguishes a missing review, current sample review, and a changed or superseded package. Coverage remains **Not evaluated** in each view.
- Start on a fictional Michigan conventional purchase. Submit and review its 1003, run sample pricing, select an offer, and prepare a sample disclosure package. With UWM stage configured, **Run sample pricing** selects Orbit's fictional quote generator for that request and makes no UWM call. In **Loan details → Compliance**, the owner opens the finding for the current sample package. Mock signing and the closing disclosure review make the exact workbench review available to record in the case.
- Browser rehearsal uses separate signed-in owner, LO and processor fixtures at 1440 × 900, 900 × 1200 and 390 × 844. The queue keeps the issue, status and owner together with its action. Narrow rows stack, filters survive opening a case, and keyboard focus returns to the originating row. The code scan and responsive review use Orbit's existing components and spacing. [Impeccable detector](https://impeccable.style/docs/detector/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) · [21st.dev dashboard patterns](https://21st.dev/community/components/explore/dashboard-component)

## UX acceptance for the first queue

- Owner opens **Review needed** and sees the same population in the filtered queue. Each row shows the issue, owner, timing, and next action. Coverage distinguishes waiting for evaluation, current results, and a failed or stale evaluation. [21st.dev dashboard patterns](https://21st.dev/community/components/explore/dashboard-component)
- LO or processor opens the exact package from Today or the file and sees the issue and next authorized action before supporting detail. Test keyboard focus on entry and return, and use stacked rows on portrait and phone. [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- Use distinct plain-language messages for no matching results, no evaluated files, missing evidence, and permission denial. Scan the rendered workflow and check it at desktop, 900 × 1200 and 390 × 844. [Impeccable detector](https://impeccable.style/docs/detector/) · [Orbit design gate](design-system.md#design-gate-for-each-release)

## Fictional pilot release

Worker `a2010980-7eba-4722-b11a-3a03ce4b7df7` serves source `9d37bd7`. In a fictional pilot, an admin can open the brokerage queue and create cases from the exact current sample disclosure package on a matching file. Assigned staff can review permitted file cases, and the case owner can update workflow status. The queue keeps the staff work status, sample evidence review, and unevaluated coverage separate. An explicit conventional purchase **Run sample pricing** action supports sample disclosures without a provider request. Normal stage pricing and manual lender pricing are separate actions.

All 393 tests, lint, typecheck, the Cloudflare build, the working-day rehearsal, concurrency, and recovery passed. The built-Worker browser verified admin assignment, exact-version sample evidence, queue-to-file navigation and keyboard focus, LO scope, processor assignment, and the separate operational manual quote. At desktop, 900 × 1200, and 390 × 844 the queue fit the viewport. The existing phone header may truncate its breadcrumb while the Compliance page heading stays visible. All 46 staged assets matched twice. The public routes returned HTTP 200 after promotion. The signed-in live fictional pilot showed the owner queue, file-level coverage, and a sample pricing run with four options.

This release also compares shared MISMO XML against the reviewed export digest when available. Legacy manual downloads still work, and the offline upload check requires matching bytes and a signed URL at an approved origin. The next compliance slice is a bounded coverage inventory and backfill. The signed-in UWM contract pages require a renewed portal session. [UWM origination gates](uwm-origination-onboarding.md)

## Bounded fictional file inventory

In **Compliance → Fictional file inventory**, a pilot admin starts or resumes a 25-file scan. Each batch records its cursor and category counts together. The owner can open files by category while the scan is in progress. Partial totals are labeled and the completed inventory shows its observation time. If a relevant loan, sample package, or review changes, the next inventory read reports stale state and offers a rebuild. Older snapshots are excluded from the new scan. An older page cursor cannot access a changed snapshot.

The denominator is files scanned in the fictional pilot. The categories describe whether the Michigan purchase sample applies and whether a current conventional sample package or exact-version workbench review is available. Coverage remains **Not evaluated**. The inventory does not create findings, infer regulatory deadlines, or record sample workbench activity as verified delivery. This slice tracks existing loan and disclosure records. Lead-event backfill and approved policy evaluation remain separate work.

All 395 tests, typecheck, lint, and the built-Worker browser inventory rehearsal passed. The browser checked two batches, pagination, exact-file navigation, stale rebuild, LO scope, and desktop, portrait, and phone widths. Inventory schema setup now runs only on the authorized owner action, inside its transaction.

The first inventory rollout from `a920a6e` was rolled back after two live signed-in browser failures loading JavaScript modules. All 46 staged assets matched twice, and Chromium imported both affected modules from the staged build with a version override. The signed-in failure remains unexplained. Worker `a2010980-7eba-4722-b11a-3a03ce4b7df7` was restored at 100% and verified in the browser.

## Hosted asset rollout follow-up

The compatibility build `22fd051`, Worker `701eaac7-78e1-4a2d-8a6d-79253cb2e272`, carries 51 fingerprinted assets for the previous and inventory builds. Both previously failing modules loaded on ordinary public routing and the signed-in Compliance queue worked. Promoting inventory Worker `cdd77572-0490-4671-a0ee-e31a781b11ea` still reproduced the signed-in route manifest and workspace import errors at 16:10 ET. Restoring the compatibility build recovered the same browser tab. The sampled Workers logs had no matching requests at the failure time. The cause remains unconfirmed.

Candidate `b69c1da`, Worker `d417cab6-7780-4943-b0f3-6d4a43e700c0`, was first staged at 0%. It uses `ORBIT_ASSET_RELEASE=b69c1da9667f` at build time for fresh same-origin JS and CSS URLs, retains the previous files, and marks missing generated assets as non-cacheable. The stylesheet's public Inter font is served from the existing asset. All 395 tests, lint, typecheck, and the production build passed. All 97 staged JS and CSS files matched the build twice. Chrome imported the two changed modules through the staged public origin. The owner and LO inventory rehearsal also passed while loading 62 staged asset responses against a local fictional workspace.

For a new namespaced build, set `ORBIT_ASSET_RELEASE` to a fresh 12-character lowercase hexadecimal build ID before `npm run build:cloudflare`. Run `node scripts/retain-cloudflare-assets.mjs <previous verified dist/client>` before uploading, then run `node scripts/check-cloudflare-assets.mjs <staged Worker version>`. The check can also run with `--live` after promotion. Retain the immediately preceding asset generation through the rollback window. [Cloudflare version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/) · [Cloudflare static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/)

## Live inventory acceptance

A temporary same-origin route pinned the signed-in fictional QA workspace to the staged frontend and kept normal sign-in and brokerage authorization. Chrome loaded the staged workspace and both modules at their new URLs. The inventory action became available once the backend-first release `37f0d44`, Worker `c03e7856-94dc-4f2f-b1e4-adeb8896b536`, took over the existing Durable Objects. That build used the same client manifest as the compatibility release and served both generations of assets. [Cloudflare Durable Object version assignment](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/)

The hosted QA inventory scanned 25 files on its first batch and completed at 35. The admin opened the single file in **Sample review available** and returned to the same category. The temporary route was removed before promoting `d417cab6-7780-4943-b0f3-6d4a43e700c0` to 100%. A fresh signed-in tab on the normal workspace URL showed the persisted scan and opened the same file. The file view showed **Coverage not evaluated**. Public pages, unauthenticated workspace routing, the public font, and both generations of JS and CSS passed the live checks. The backend-first build remains available for rollback. Lead-event backfill is the next RG-1 slice.

## Live fictional lead history backfill

In **Compliance → Fictional lead history backfill**, a pilot admin scans existing lead records, lead activity, and task references in 25-record batches. Each batch commits its cursor, source references, and counts together. A changed source marks the backfill stale and the owner can rebuild it. Loan copies of lead activity and tasks share their original IDs. The scan counts each source once and uses the carried loan task's completion when available. Notes and task titles stay on their original records.

The backfill preserves recorded event times and CRM provenance. A legacy imported value at the fixed time used for date-only values is presented as a date with unknown original time. A pending task's deadline never supplies an occurrence timestamp. The filter lists records without an exact timestamp. The results link to the original lead, archive, or loan. Coverage stays **Not evaluated**.

All 396 tests, lint, typecheck, and the Cloudflare build passed. The browser rehearsed pagination, timestamp filtering, source navigation, and the LO boundary at 1440 × 900, 900 × 1200, and 390 × 844. The phone filter measured 44 px and the list fit without horizontal overflow. Impeccable's rendered scan flagged the existing Inter font and two global effects from the shared stylesheet. The feature reused the Orbit controls and row layout. [Impeccable detector](https://impeccable.style/docs/detector/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

The signed-in hosted QA backfill finished at 189 records in eight batches, including 15 without an exact timestamp. Opening a loan returned to the same filtered results. After removing the review route, Worker `4cfa9274-9a81-4ee1-8f30-2d149c71bbce` from source `0c27035` was promoted to 100%. A fresh browser tab at the normal workspace URL reopened the completed backfill, matched the 15 filtered records, and opened the original lead. Public pages, workspace sign-in routing, and the Inter font passed. All 143 JS and CSS assets matched twice. Backend-first Worker `a092d39d-9556-4de2-bf5f-aaa8d49c7bbd` remains available for rollback.

## Daily compliance work and review handoff

Assigned staff in fictional pilots can open file findings from Today and Tasks. Assigned processors can also open them from Processing. Each row opens the same finding on its loan and shows when the work opened. The compliance deadline remains undetermined.

Staff can submit a review note against the current sample package revision. The finding moves to **Playbooks → Compliance reviews**. Managers can return it for evidence or change the owner, and past notes remain in the case history. The separate sample workbench review is still available. Coverage remains **Not evaluated**.

Application source `ca0c3cd` is live on Worker `9f11052c-84c2-4cec-8836-a107766763d7`. Backend source `3807a30`, Worker `5df13716-3ed9-4197-b6f1-c33e677dd26f`, is the compatible rollback version. Both versions retain all 192 tested browser assets. The temporary signed-in QA route was removed before promotion.

All 398 tests, lint, typecheck and the Cloudflare build passed. Local browser acceptance covered LO Today and Tasks, manager return and reassignment, the assigned processor resubmitting, preserved history, unrelated LO scope, and 1440, 900 and 390 px widths. The staged QA admin submitted a fictional note from Today and opened it from the manager queue. On the ordinary live URL, the admin reopened that exact case and returned it to Today for evidence. The public pages, login boundary, font and two live asset checks passed.

## Brokerage overview and sample evidence

Pilot admins can open **Compliance → Overview** to see distinct file and finding counts for work awaiting evidence, review, or ownership review. Each count opens the matching list, and each finding opens on its exact loan. One file can appear in more than one category. Restricted cases are excluded before counting. **Coverage & gaps** includes the file inventory and lead-history backfill. Inventory totals describe scanned files in the pilot. Compliance coverage, blockers and deadlines remain unevaluated.

Staff with permission to update a finding can add a sample evidence note on its current package. Case history records the source, note, actor, recording time and package revision. Recording the note leaves the workflow status and sample workbench review intact.

Application source `6c0e470` serves 100% on Worker `6542881a-d512-430c-8016-31b16f13e351`. Compatible backend source `8eb0f69`, Worker `fb74d2d8-15a7-49b5-a1b8-3f1b9242a31d`, is at 0% for rollback. Both carry the same 238 fingerprinted JS and CSS assets. The temporary signed-in QA route was removed before promotion.

All 400 tests, lint, typecheck and the Cloudflare build passed. Local browser acceptance covered desktop, portrait and phone widths, keyboard drilldown, finding updates, a two-batch inventory and the LO access boundary. Hosted QA saved an observation from the overview, opened the exact case, and verified the inventory file drilldown. The ordinary live URL verified the saved note, submission and return between the two filtered queues, all 35 inventory files and the lead history view. Public pages, sign-in boundary, font and two live asset passes passed.

## Sample review decisions

From **Playbooks → Compliance reviews** or the overview's **Awaiting review** queue, a pilot admin can accept the current sample review or return it for evidence. The reviewer records a reason. A return puts the finding back with its current owner. Acceptance moves the finding to **In progress** so the owner can continue work. Case history keeps the decision, reviewer, time, package revision and review request revision. The app rejects a decision for a replaced package or a superseded request. Regulatory coverage and deadlines remain unevaluated.

Application source `c2b6cfc` serves 100% on Worker `bc8077fa-30c1-43ec-8592-5519fbf420e7`. Backend source `d22e507`, Worker `8d2e2777-6fe9-475d-ae94-1874fea08cc9`, remains available for rollback. Both versions retain the same 284 checked browser assets. The temporary signed-in QA route was removed before promotion.

All 401 tests, lint, typecheck and the Cloudflare build passed. Local browser acceptance used separate LO and admin accounts and covered both decisions, resubmission, the exact case history and desktop, portrait and phone widths. The hosted fictional QA workspace used its signed-in admin to exercise both sides. Hosted staging verified a return and resubmission from Today. The ordinary live URL verified acceptance, both reasons and revision references in history, and the updated manager and owner queues. Public routes, the login boundary, the font and two live asset checks passed.

## Versioned sample receipt evidence check

A pilot admin or current finding owner can run **Sample receipt evidence check** on a current sample disclosure package. The check compares the review in the disclosure workbench with the review recorded on the finding. Each result records the check version, sample package version and revision, and the reviewer and times from each source. A repeat with the same inputs reuses the existing event. Changes to either source mark the previous result out of date. The prior result and the evidence it used remain in case history.

The check is limited to the fictional Michigan conventional purchase sample. It records a comparison of sample evidence and leaves the finding's workflow status intact. Compliance coverage and deadlines remain unevaluated.

Application source `93c6b39` serves 100% on Worker `6d71a284-52ef-4fcc-82a0-941babe14ffa`. Compatible backend source `677c1a2`, Worker `33578587-8b76-44e4-8f4a-79a489c37cac`, remains available for rollback. Both versions retain all 330 checked browser assets. The temporary QA route was removed before promotion.

All 402 tests, lint, typecheck and the Cloudflare build passed. Local browser acceptance used separate LO and admin sessions and covered keyboard access, repeated inputs, stale and matching results, historical evidence, and three viewport widths. Hosted staging verified the missing case evidence and stale result after the reviewer recorded the sample evidence. The ordinary live URL verified the matching result, original missing-evidence snapshot and unchanged in-progress status. Public routes, login boundary, font and two live asset checks passed.
