# OrbitLOS brand and UX review

Date: November 8, 2026 (user timezone). Status: first design pass deployed. Role-specific visual acceptance is in progress.

## Reference guidance

The [Orbit design system](design-system.md) defines the implementation direction for brand, fonts, icons, layout, interaction, and concise UI copy. Use the external references to refine that identity consistently.

These are the three references identified in the earlier project conversation:

- [Impeccable polish](https://impeccable.style/docs/polish/): preserve the established identity while improving hierarchy, spacing, interaction feedback, and states.
- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill): use as design-system and usability guidance across the expanded product.
- [21st.dev](https://21st.dev/): use selected navigation, form, and dashboard component patterns as inspiration. Do not adopt an unrelated theme or new dependencies solely for appearance.

## Evidence and limits

The initial live homepage artifacts are in `.playwright-cli/page-2026-11-09T01-40-15-289Z.png` and `.playwright-cli/page-2026-11-09T01-40-23-158Z.png` (UTC filenames). The Orbit visualization folder `design-pass` contains the before/after desktop homepage and authenticated pipeline, the desktop loan drawer, the 390 × 844 hosted homepage and sign-in, and the 390 × 844 fictional local pipeline and loan drawer.

Hosted release `939dacc3-1042-41b9-89b8-19d8d9a978a1` returned the 352,240-byte font with `font/woff2`. The hosted homepage, sign-in, and pipeline declared Inter first in the computed font stack. The desktop workspace showed 19 distinct navigation icons and no page overflow. The 390 × 844 public views had no page overflow. Browser tooling did not expose the loaded `FontFace` status.

The local fictional pipeline showed the stage selector above the fold at 390 × 844 and 900 × 1200. Selecting Processing showed that stage and its loan cards. Enter opened the loan drawer with focus on Close, and Escape returned focus to the originating card with a visible outline. The mobile drawer fit the viewport. Hosted follow-up release `9f80ea5d-16b5-45b8-b1fe-872e16e950b5` raised the stage selector to 44 px and darkened its border. The local 390 × 844 view measured a 44 px target beginning 530 px from the top, and the hosted CSS contained the same rule.

On the follow-up release, the hosted admin selected a two-row fictional CSV using Chrome's file picker. Migration showed two mapped records and the preview reconciled a contact and a lead with a Create decision for each. The verification stopped at preview. The `design-pass` folder includes `after-migration-file-picker.png`.

Measured color pairs included body text on white at 15.45:1, muted text on canvas at 5.52:1, white text on the violet action at 6.05:1, and the input border on white at 3.37:1.

## Role review and public gallery

The built Worker ran on loopback with synthetic sessions for the owner, LO, and processor, plus scoped borrower and realtor links. Desktop and 390 px captures in `design-pass/roles` cover owner funding and financials, LO Today, processing and conditions, the editable 1003, borrower status, and realtor referrals. The owner report reconciled $310,000 funded, $340,000 projected, and $290,000 in the prior period. The LO saw Riley's first-contact work. The processor opened Avery's exact income condition. Both portals retained their fictional and sample labels. The tested role views fit without page-level horizontal overflow.

Mobile checks covered keyboard access to the menu and Search, a loading search that resolved to the no-results state, the Calendar and Migration layouts, and the empty Conversations filter. The quote comparison now separates option labels from product names and shows a phone-width scroll hint. The comparison received visible keyboard focus and Arrow Right moved its horizontal scroll by 40 px. The linked-condition count now describes the actual scope even before the first workspace sync.

On `8e1854ba-20c8-4cf1-beaf-8fa887b11812`, the homepage and product gallery served refreshed fictional pipeline, playbook, 1003, quote, and condition captures. All five hosted PNG hashes matched their source assets. The live product page fit at 390 × 844 and the desktop homepage rendered the updated pipeline. `live-homepage-gallery.png` records that release. The [published website refresh](website-refresh-handoff.md) reused the same images and verified the four public routes and shared assets.

[Rehearsal D](demo-rehearsal-log.md#design-rehearsal-d-on-november-8-2026) added hosted evidence of the borrower scan rejection, successful replacement, and staff recovery from a stale edit.

## Authenticated workflow polish

### Owner Exceptions

Before the change, the file exception queue appeared beneath several settings and history panels in Playbooks. The new sidebar entry uses the Today and Lead Inbox count pattern. The queue places the reason, responsible staff member, and due time next to the action. The layout review kept the existing Orbit cards and controls, let the header and status wrap, and used a single filter select so the action stays readable on a phone. [Impeccable polish](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) · [21st.dev](https://21st.dev/)

Playwright and Chrome checked the owner path at 1440 × 1000, 900 × 1200, and 390 × 844. All three fit without page overflow. Enter opened the exact handoff, and Escape returned focus to its action while preserving the filter. The filtered empty state rendered clearly. In separate local browser sessions, an LO and processor saw their own navigation without the owner entry. The hosted smoke covered the signed-in owner and the exact handoff return. [Release evidence](demo-rehearsal-log.md#hosted-owner-exceptions)

### Staff handoff

The earlier handoff listed assigned staff and the status. The updated panel puts the next person and latest staff note alongside those facts. It uses the existing Orbit status notice to explain a competing edit and keeps the draft next to the notice. Playwright checked the open draft, processor acceptance and return, and the LO's keyboard review at desktop, portrait, and touch phone widths. The phone review led to consistent vertical spacing and wrapping for long staff notes. [Release evidence](demo-rehearsal-log.md#staff-handoff-draft-recovery)

### Processing attention

Processing uses the same sidebar count and mobile menu indicator as the other queues. The badge opens the incoming items it counts, including when an owner had selected Ready to accept. The 390 px touch check found the timestamp squeezing the heading into three lines. The revised heading wraps the timestamp below the title at that width. The desktop owner and portrait LO sessions also fit without horizontal overflow. [Working-day evidence](demo-rehearsal-log.md#processing-attention-and-working-day-acceptance)

### Manual lender closing

The previous Closing view could leave a manual quote file without a clear way to advance. Closing now links to the exact export or acknowledgment step when the terms change, using the existing hold pattern. Desktop and portrait sessions verified the hold. The 390 px check moved the export heading below the sticky drawer header and kept the selected quote and previous checklist reachable. The browser verified the revised download, acknowledgment and removal of the hold. [Release evidence](demo-rehearsal-log.md#manual-lender-terms-through-closing)

Release `2d3265d0-ec1e-486b-b0eb-8f5661b38e23` keeps **Refresh requested documents** available on the lender submission with one replacement outstanding. In a local built-Worker processor session, the pay stub was the only request still waiting. After the borrower attached the replacement, the control brought both received documents into review. The 320 px drawer had no horizontal overflow with the fixture's Inter request returning 404.

At 320 px, the funded check-in fields stack so the selected outcome stays legible. The required callback date retains focus on validation. **Save check-in** returned to the loan, and **Save & start repeat 1003** saved the check-in and focused the loan-purpose field. Search showed the existing funded purchase, a distinct refinance draft, and the same contact. The shortcut is absent for No response and does not replace the standard save.

Owner report and margin disclosures opened by keyboard. The CRM preview reconciled four fictional records at 320 px and the MISMO sample exposed its reviewed address. The hosted owner verified the new migration headings, file limits, and report definition. The approved public homepage fit at 390 × 844. Evidence includes `check-in-repeat-320.png` and `combined-release-home-390.png`.

Chrome's native 200% site zoom changed the signed-in desktop viewport from 1419 × 1187 to 709 × 593 CSS px. The funding report had no document overflow. The closing drawer measured 653 px with no horizontal overflow. Escape closed it and returned visible focus to Open closing workbench. Chrome was restored to its original 100% zoom. The earlier portrait pipeline capture and the desktop baseline are retained alongside the current role evidence. The [final same-release rehearsals](demo-rehearsal-log.md#final-same-release-rehearsals-e-and-f-on-november-8-2026) verified the revised flows and both phone portals.

## Keep

- Plum/night surfaces, lilac accents, Orbit mark, and restrained orbital lines connect the homepage and existing app imagery.
- The main headline and demo CTA are clear at the inspected sizes. The phone screenshot shows the headline and actions fitting the viewport.
- Clear fictional-pilot and simulated-connection copy sets expectations.
- App source includes visible keyboard focus and role-filtered navigation. Preserve these during refinement.

## Prioritized review and changes

| Priority | Observation | Action and acceptance |
| --- | --- | --- |
| Before demo sign-off | Homepage pipeline image shows older navigation missing many current workflows. | Refresh screenshots from the final demo candidate with fictional records. Match the visible product and role; preserve legibility and accurate captions. Include current dashboards where they substantiate the brokerage-management story. |
| Before demo sign-off | Current navigation source has 19 destinations before role filtering, including nine in Loan operations. | Rehearse locating each next step as owner, LO, and processor. Confirm grouping, selected state, and narrow-screen menu discoverability. Adjust confusing placement or labels only where observed; avoid a broad navigation rewrite during final verification. |
| Before demo sign-off | Many secondary app labels and task details use 10–11px text. | Inspect active queues, drawers, and dashboard cards at actual presentation size and on phone. Increase task-critical text where reading is difficult; preserve density through spacing and hierarchy rather than tiny essential labels. Test zoom and clipping. |
| Before demo sign-off | New dashboard, finance, review, communication, and migration screens need comparison against the original app design. | Compare heading levels, button hierarchy, filters, spacing, table density, date/money formatting, chips, and empty/loading/error states. Each screen should have an obvious next action. This remains unverified until screenshots and workflow evidence exist. |
| Before demo sign-off | The whole pipeline screenshot is readable as an overview but its individual contents are tiny on phone. | Keep the overview, provide an easy full-size view, and use focused crops for mobile feature explanations where needed. Verify phone users can understand each illustrated benefit without reading tiny screenshot labels. |
| Before demo sign-off | Focus styles exist, but complete interaction accessibility is unverified. | Rehearse keyboard navigation, dialogs/focus return, form errors, status labels beyond color, touch controls, and reduced-motion behavior. Record contrast checks for essential text and controls. |
| Later polish unless blocking | Orbit styling is shared through variables, with many component-specific literals still present. | Consolidate repeated semantic colors, spacing, typography, buttons, and status styles incrementally. Preserve distinct success/warning/error meaning and avoid visual churn in verified workflows. |

## Final review route

Compare homepage/product/demo entry → sign-in → owner dashboard → LO Today and loan drawer → processor queue/conditions → communications/calendar/search → borrower/realtor portals. Capture desktop and narrow-screen evidence on the final candidate, including non-happy-path states. Tie blockers and fixes to D08, D12, D13, and D15 of the [demo checklist](demo-completion-checklist.md). Do not mark visual acceptance complete from this source review alone.
## Manual lender rejection

The LO records the lender response from the prepared export, then follows the correction through Today. The owner sees the same phase, deadline and assignee in Exceptions. The borrower opens the existing application link and sees only their instructions. The processor keeps the existing role-based work queue.

The Impeccable review kept the less common rejection action collapsed beside acknowledgment. UI UX Pro Max's form and responsive guidance informed the field labels and layout. The 21st.dev form reference informed required-field validation and focus. The first phone review showed a clipped lender name, so the lender fields now stack on narrow screens. The owner filter now says **Manual lender responses**, and the action appears once on each response card. [Impeccable polish](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) · [21st.dev form validation](https://preview.21st.dev/blog/react-form-components)

## Joint borrower corrections

The LO records a lender response and chooses which borrower needs to act. The owner opens the same correction from Exceptions and sees who is waiting and who has submitted. The selected borrower uses their private link to change and resubmit their saved portion.

The baseline phone view offered one generic borrower instruction field. The revised form requires a recipient on joint files and puts that choice immediately before the borrower message. Today, Exceptions and the loan's next action open the joint portions. The desktop owner review showed a second-review prompt above the active correction, so the checkpoint now appears once both portions are submitted. The borrower view keeps its correction instructions and saved answers together. [Impeccable polish](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

## Non-QM manual pricing

The LO keeps the scenario inputs when EQ is unsupported and enters a manual offer against those inputs. The owner can compare the chosen and earlier terms, and the reviewed loan points to manual MISMO or to the missing manual offer. The coverage check remains an internal loan event.

The initial browser pass found that the comparison table widened the desktop loan drawer and lender names clipped on the phone. The table now scrolls inside a keyboard-focusable region, the long text fields span the phone form, and the unsupported result receives focus at the manual offer section. The heading and badges distinguish the unsupported outcome, estimates, and manual terms. [Impeccable polish](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

## Inbound review and Today

The owner chooses the matching record and attaches the event. Today gives the assigned LO the missed-call label, the linked record, and the promised time when one exists. Both views use Orbit's existing work cards and buttons.

The Impeccable review moved source diagnostics behind a disclosure and collapsed the simulator after a successful save so the matching decision takes focus. Closing review returns focus to the originating control. UI UX Pro Max's responsive and touch guidance informed the stacked phone card and 44 px primary controls. The portrait review exposed a clipped sidebar label and wordmark, so the narrow desktop sidebar now gives its labels more room. [Impeccable polish](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

## Referral and returning-client reporting

The LO can see when outreach is in progress and reopen the same repeat application from Past Clients after conversion. The owner sees the campaign and loan status together, with separate actions for the original loan and the funded refinance. The realtor report uses the original intake and opens the purchase associated with that referral.

Playwright exercised the report at desktop, portrait, and phone widths. The first phone review showed the officer's email running into their name and the conversion totals beyond the first visible columns. The final layout puts that metadata on its own line, explains when users can scroll across, and keeps keyboard focus and horizontal scrolling inside each table. The returning-client record stacks its actions on the phone. [Impeccable polish](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

## CRM migration preferences

The preview shows the source restrictions and the blocks that will be written to the record. The receipt compares the same source restrictions with the current Orbit record. Preview moves focus to the result heading, and automatically mapped files keep the column editor collapsed.

The first phone review placed the contact restrictions behind the horizontal edge of the reconciliation table. The final layout keeps the desktop table and stacks each source, result and action on a phone. The summary shows the results that need attention without listing empty categories. [Impeccable polish](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

## Processing work cutover

The source inventory previously led straight to comparisons. **Open work from source** now puts the owner, processor and eligible work together before the owner restores anything. Impeccable detected a nested assignment panel in the rendered first pass. The revised view uses dividers and plain assignment fields. Its focused rescan dropped the finding for this panel. The workspace scan still flags the existing avatar text, reference placeholder contrast, font and other nested cards. UI UX Pro Max informed the button hierarchy, tap size and focus on the restore receipt.

Playwright exercised desktop at 1440 × 900, portrait at 900 × 1200 and a touch phone at 390 × 844. Both controls measured at least 44 px and the panel fit without horizontal scrolling. Keyboard activation moved focus to the inline receipt and **Open restored work** opened the same loan's lender section. The processor sees the condition in the existing Processing queue with the same action labels as a manually entered condition. [Impeccable polish](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

## Cutover revision and receipt history

The prior comparison showed matching statuses even when they referred to different versions. The new row identifies missing evidence separately from a missing record. **Compare document revisions** and **Compare delivery evidence** reveal the source and Orbit values without expanding every receipt by default. The values stack on the phone and long receipt references wrap. Impeccable's rendered scan found the same workspace-level issues as the preceding release and no finding in the new comparison. The layout follows Orbit's disclosure and status patterns and the UI UX Pro Max guidance for readable values and touch controls.

Playwright verified the disclosures at 1440 × 900, 900 × 1200 and 390 × 844. Enter and touch activation opened the comparison, the disclosure measured at least 44 px, and a missing receipt disabled **Reconciled** in the affected file review. The owner could see the document version that Orbit held and the one from the source without a horizontal scroll. [Impeccable polish](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

## Cutover handoff review reference

The exported report puts the review reference beside the source basis so the owner can compare reports without opening each underlying file. It distinguishes the export time from the stable reference. The first rendered Impeccable scan flagged short trailing lines in the report copy. The revision shortened that copy and moved the reference above the export time on narrow screens. The rendered rescan returned zero findings.

Playwright downloaded the report by keyboard and opened it at 1440 × 900, 900 × 1200 and 390 × 844. The reference fit at every width. Two exports of the same reviewed state matched and an updated file decision changed the reference. [Impeccable polish](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

## Managed branches and intake routing

Team shows branch setup before the larger pilot and staff panels. The editor puts assigned staff before the default LO so the owner sees which active assignees are eligible. The first phone pass showed a clipped email in the LO picker. The revised picker shows a unique name when available and keeps the full email in the roster. The ZIP rule editor uses the existing preview and can link to a branch from Team or keep a separate rule.

Playwright checked 1440 × 900, 900 × 1200 and 390 × 844, including touch selection, 44 px controls, keyboard save, focus on the receipt, and published ZIP routing. The rendered Impeccable scan found existing workspace typography and placeholder issues outside the new branch editor. [Impeccable polish](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

The next rendered Impeccable pass measured the pipeline search placeholder at 3.1:1 on a 390 × 844 viewport. The placeholder now uses Orbit's muted text token, which measures 5.89:1 against white. Playwright verified the built Worker's computed color, full opacity, keyboard entry, and absence of page overflow at 1440 × 900, 900 × 1200 and 390 × 844. Inter stays as the established workspace typeface. The focused check covered the pipeline search and leaves the broader typography advisories open.

## Owner landing and shared loan navigation

The signed-in owner baseline opened personal Today. In the fictional role rehearsal at 1440 × 900, Staff access began 1,589 px down Team, below several pilot panels. The phone loan drawer placed its section buttons in a 150 px grid that scrolled away during long tasks.

Admins now land on **Brokerage overview**. Its exception, first-contact, and processing counts open the same queues they count. Personal Today remains available beside New Lead. Reports and setup open their named views. **Team** starts with Staff access and groups branches, assignments and templates, workspace switching, pilot tools, and access history by purpose. In the same fixture, Staff access began 279 px down the page.

The loan drawer uses the same role-filtered section options in a labeled picker in the phone header. Desktop retains visible section buttons. Deep links keep the active section selected and scroll the relevant work below the sticky header. Closing a queued loan restores keyboard focus to the originating action when it remains available.

The pass used the Impeccable source and rendered checks, UI UX Pro Max searches for keyboard focus and dashboard hierarchy, and 21st.dev dashboard references. The rendered detector flagged the existing Inter typography and global decorative effects. [Impeccable](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) · [21st.dev dashboards](https://21st.dev/community/components/s/dashboard)

Local browser acceptance covered 1440 × 900, 900 × 1200, and 390 × 844. It verified owner counts and filters, report and Team routes, a fictional staff invitation, New Lead to 1003, LO and processor access, phone drawer navigation and keyboard return. It also opened the fictional borrower status and realtor referral portals at 390 px. The 36-stage working-day rehearsal exercised owner, LO, processor, borrower and realtor handoffs. All 402 tests, lint, typecheck and the Cloudflare build passed.

Source `f137a94` serves 100% on Worker `1c2e38eb-3fd4-4845-842c-e08aae18625f`. The previous Worker `6d71a284-52ef-4fcc-82a0-941babe14ffa` is retained at 0%. Staged hosted QA checked exceptions, the first-contact filter, Staff access and personal Today. The ordinary live workspace verified the owner landing, processing, funding, Team, Today and the lender conditions drawer. Public routes, login, font and two asset passes at 376/376 passed. The temporary QA Worker and routes were removed.

Continue the design review through 1003, pricing, lender conditions and closing, then through borrower and realtor feedback and recovery states. The portal phone checks in this release cover entry and layout.

## Cross-role workflow refinement

The November 10 role walkthrough used the built Worker with fictional Admin, LO, Processor, borrower and realtor sessions. The baseline realtor portal put milestone updates 911 px down a 390 px phone page and lost an unfinished referral when a refresh returned 503. Pricing left newly returned offers below the input form, and the saved quote's lender action was separated from its summary. Borrower request failures were announced above the visible task, and a completed request removed the focused control.

Referral intake now collapses after submission and the milestone list stacks into readable phone rows. Temporary refresh failures retain the last loaded page and form values with a retry explanation. Revoked or invalid links remove the loaded portal. Pricing has named shortcuts to inputs, results and the saved quote; returned offers and saved selections receive focus, and the lender handoff stays with the saved quote. Quote percentages occupy a separate line. Borrower errors receive focus with a return-to-action control; successful document, answer and sample-signing actions focus the updated next-actions heading.

The design pass used Impeccable source checks, UI UX Pro Max error recovery and submit-feedback guidance, and the 21st.dev accordion reference to compare compact disclosure behavior. Orbit retains its native disclosure, status, form and button patterns. [Impeccable](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) · [21st.dev accordions](https://21st.dev/community/components/s/accordion)

The role walkthrough covers owner queue drilldowns and Staff access, New Lead to 1003, LO pricing and processor handoff, processor acceptance and linked document requests, borrower attachment failure/retry, mock document acceptance/delivery/clearance, closing review blockers, and realtor submission and refresh recovery. Local layout widths are 1440, 900 and 390 px. The 402 tests and the 36-stage working-day rehearsal passed, including role boundaries and funding. Final candidate and hosted release verification are recorded below after completion.

Final acceptance: the broad owner-navigation sweep opened all 22 workspace screens at 1440 × 900, 900 × 1200 and 390 × 844 with no page-level horizontal overflow. This is a layout and entry check, not exhaustive acceptance of every nested workflow. The interactive role walkthrough completed sample pricing, saved-quote focus, LO-to-processor handoff, linked document requests, borrower failed-attachment recovery and next-action focus, processor acceptance/delivery, zero outstanding mock UWM conditions, and the disclosure review blocker after repricing. Temporary 503 and HTML failures retained the realtor draft and list; a 403 removed the loaded portal. Referral updates appeared at 463 px on the phone immediately after submission, compared with 911 px before.

The rendered Impeccable review led to 12 px quote labels, percentages and manual-pricing help. The final scan no longer reported undersized functional pricing text. Remaining findings are the established font/decorative styles and padding heuristics on portal intros; browser screenshots show the actual inset and readable content. Typecheck, lint and the Cloudflare build passed. The working-day rehearsal and 402 tests passed during this release.

Live application source is `460d72c3514e` on Worker `b8305cd6-cfaf-4fde-a489-c30ce90e8f3c` at 100%. Previous Worker `1c2e38eb-3fd4-4845-842c-e08aae18625f` is retained at 0%. Staged and ordinary live asset checks each passed twice at 422/422. Public home, product, demo and login returned 200; anonymous workspace returned 303. The temporary QA Worker and routes were deleted. Binding names/types and UWM stage pricing mode were preserved; all provider actions exercised in this pass used samples.

Authenticated hosted QA verified returned sample pricing focus, saving the quote and its handoff, borrower attachment and updated next-action focus, staff acceptance, and realtor submission into the routed staff first-contact queue. The ordinary live realtor portal passed a 390 × 844 phone check, and the viewport override was reset. The separate LO and Processor credentials were exercised locally; the hosted staff walkthrough used the existing QA admin session. Screenshot evidence is retained locally as `.orbit/orbit-flow-ux-live-realtor-phone.png` with before/after role captures alongside it.

Next design slice: campaign enrollment → Today follow-up → conversation outcome, plus the owner's overdue-work drilldowns. Apply the same saved-state, mobile, keyboard and recovery checks to that growth workflow.

## CRM follow-up recovery release
Source a656e4e adds focus to enrollment preview results and conversation outcome feedback, an explicit All outcomes reset with result counts, keyboard-accessible response tables, clear callback filters, and an upcoming-work action for empty personal callback queues. UI UX Pro Max recovery/focus guidance informed the existing-component changes. Typecheck, lint, 402 tests and the working-day rehearsal passed. Browser acceptance covered fictional CSV campaign import and response filtering/recovery at 1440, 900 and 390 px. Signed-in live QA verified response counts, filter reset and upcoming callback navigation. The full workflow rehearsal covers enrollment, follow-ups, conversations and manager drilldowns; it is scripted local acceptance, not a claim that every transition was repeated live.
Published Worker 39c0bee0-e96a-4fc4-ad31-3ad6c693521e at 100%, predecessor b8305cd6-cfaf-4fde-a489-c30ce90e8f3c retained at 0%. Staged and live browser assets passed two checks each. Provider configuration is unchanged. Remaining design review should exercise longer campaign lists and returned conversation focus in a further pass.


## CRM navigation release — November 10, 2026

Published application source `70d68957182b`, Worker `082ceb43-7de7-4b32-948d-fcba1dd540f8` at 100%.

Long campaign lists now support name search, retain the selected campaign when filtered out, and provide clear empty-result recovery. Closing conversation details restores keyboard focus to the originating queue button, or the queue heading when a resolved conversation has left the filter.

Validation: 402 tests passed, typecheck/lint passed, production build passed, 36-stage local working-day workflow passed. Staged and ordinary live asset checks each passed twice (138/138). Signed-in fictional live QA verified matching/no-match/clear campaign search, selecting a filtered campaign, conversation close/reopen feedback, originating-row and missing-row focus return. The fictional conversation was reopened after the test. Mobile (390x844) and portrait desktop (900x1200) had no document horizontal overflow. Evidence: `.orbit/orbit-crm-navigation-live-mobile.png` in the parent workspace.

Provider configuration unchanged; pricing remains the existing UWM stage configuration. No real messages, scans, or lender submissions exercised. Local multi-role acceptance is distinct from the live admin-session checks. Cross-section return from Communications to the originating Today/campaign context remains the next navigation improvement.

## CRM conversation return — November 10, 2026

Published source `ec142e9` and Worker `0c726fcb-f9c8-411a-8046-3cb16353a430` at 100%. Conversation excursions from Today and Call Campaigns now offer an explicit return action. React Activity preserves the originating component state and suspends its effects while hidden. Campaign search, queue filters, disclosures and unfinished call notes survive; returning refreshes authorized data. Today preserves its selected time window. Other sidebar navigation releases the saved origin. Focus uses a stable lead/thread identity after refresh, with a heading fallback when the item has left the queue.

Design evidence: UI UX Pro Max keyboard/return-context guidance; existing outline button and spacing tokens retained. Impeccable source scan run (not a rendered accessibility guarantee). Desktop and mobile screenshots inspected; no added navigation panel or new dependency.

Validation: typecheck, lint, 402 tests, production build and 36-stage local working-day workflow passed on final code. Local browser verified Ready to call filter, unfinished note and post-refresh focus preservation, plus Today Next 7 days return and 1440/900/390 px overflow checks. Live fictional admin QA verified campaign search and note preservation, return-button focus, Today Next 7 days preservation, and mobile return layout. Final staged and ordinary live assets each passed twice, 230/230. Screenshot evidence in the parent workspace: `.orbit/orbit-crm-return-live.png` and `.orbit/orbit-crm-return-live-mobile.png`.

No provider actions or configuration changed. Existing pricing mode remains `uwm-stage`; email and scanning stayed simulated. Live checks used the fictional admin workspace; the multi-role working-day check was local. Next review: campaign readiness language and Today action labels, particularly where a sequence is scheduled for later but its lead card currently says Ready to call. Distinguish scheduled sequence work from actionable calls without weakening contact-hour or channel restrictions.
Deployment note: the first ordinary-traffic asset run encountered transient 404/fetch failures during propagation and reached one clean pass. A subsequent complete run passed 230/230 twice; acceptance is based on that completed rerun.

## Campaign readiness clarity — November 10, 2026

Published source `30c3739` and Worker `bb28be52-5e94-4f9b-b332-7596d4736b12` at 100%. The campaign card now derives first-call readiness from the existing queue rules. Reactivation/past-client sequence steps show their channel and scheduled/due state, paused steps show Sequence paused, and blocked calls no longer fall through to Ready to call. Contact-hour availability contributes to the sequence label. The assigned staff member can open Today from sequence progress; managers viewing another officer's lead do not receive a misleading personal-queue shortcut. No queue, consent, or execution rules changed.

Validation: typecheck, lint, 403 tests and production build passed, plus the 36-stage local working-day flow. The new regression covers reactivation exclusion from first calls, scheduled/due boundaries, paused state, contact-hour delay, email/text channels, and normal first-call eligibility. UI UX Pro Max guidance and Impeccable source scan informed review; source scanning is not a rendered accessibility audit. Live fictional admin QA verified the Cold Reactivation campaign now shows Call step scheduled alongside Ready to call zero, then paused and resumed one fictional lead back to its saved scheduled step. Desktop and 390px screenshots inspected, with no phone horizontal overflow. Evidence: parent `.orbit/orbit-readiness-live.png` and `.orbit/orbit-readiness-live-mobile.png`. Staged and ordinary live asset checks each passed twice, 276/276.

Provider configuration unchanged (existing UWM stage pricing retained), with no real sends or lender submissions. Live acceptance covered the admin's campaign view; the assigned-LO shortcut is wired to the existing Today navigation and remains a useful target for the next role-based walkthrough. Next coherent review: manager-to-LO follow-up handoff, overdue recovery, and confirmation that completed work leaves both queues with consistent counts.

## Manager assignment without leaving the report — November 10, 2026

Published application source `9eb0527`, Worker `bb7a762a-434e-4fc2-acf5-a4dfadbfc4cd` at 100%. Overdue and paused campaign rows now offer inline Assign owner. The panel loads the authorized current lead and roster, reuses the existing campaign assignment command and previous-owner conflict check, preserves report selection, and focuses explicit success feedback. A stale/converted/ineligible lead shows recovery guidance. Failed reads offer retry. Converted/archived rows retain their existing record actions.

Validation: typecheck/lint and 403 tests passed. The production build passed after correcting the newly inserted loading text to UTF-8. The 36-stage working-day script now also verifies campaign-command reassignment, stale-owner rejection, callback deadline retention, personal queue movement, and the manager overdue owner's name. Browser role acceptance used separate local owner and LO sessions: assign from the manager panel, verify owner/count refresh, receive the callback in the new LO's Today, log Connected, and verify manager overdue count becomes zero. Portrait and phone layouts passed overflow checks; success feedback received focus.

Live fictional admin QA reassigned Rowan Reactivation Example from Opus Audio to John Wallace and back without leaving Paused sequences; the saved step, schedule and count stayed consistent. The original owner and running sequence were restored, and the paused report cleared to zero. Mobile screenshot inspected at 390px, with no horizontal overflow: parent `.orbit/orbit-manager-assign-live-mobile.png`. Staged and ordinary live assets each passed twice (322/322). UI UX Pro Max guidance and Impeccable source review used; the source scan does not replace visual acceptance.

No provider settings changed; existing UWM stage pricing remains. No real messaging, scanning or lender submissions occurred. Live verification used the admin session; the independent owner/LO completion rehearsal was local. Next: improve manager exception recovery after actions remove rows, including focus and clear confirmation of what remains, then reconcile the next broader roadmap gate against the shipped evidence.

## Manager action feedback — combined-release candidate, November 10, 2026

Source `5c86442` on `release/manager-work-feedback-2026-11-10` keeps sequence pause/resume confirmation in the manager report after a row leaves the selected view. The confirmation receives keyboard focus and includes the refreshed selected-view count. It uses the existing successful-mutation callback; failures do not generate a success message. Assignment feedback uses the same summary. The component's accidental doubled line endings were normalized. The roadmap now acknowledges shipped branch management and separates local/mock acceptance from the remaining R4 onboarding and hosted recovery gates.

Typecheck, lint, 403 tests, production build and the 36-stage working-day run passed. Local browser verification resumed a paused fictional sequence and observed the row disappear, Paused sequences remain selected, the count become zero, and focus land on persistent confirmation. Portrait 900px and phone 390px widths had no document overflow. UI UX Pro Max focus guidance and Impeccable source scan used; the scan is not rendered accessibility certification.

Not published independently. Production promotion is held for the UWM coordinated source, after verifying that `release/uwm-live-2026-11-10` includes changes absent from this CRM branch. Merge this branch as a whole after their common `30c3739` ancestor; it also includes the previously verified inline manager assignment work. Combined build, provider configuration checks and ordinary live acceptance must run on the final merged source. No provider actions or settings changed in this candidate.

## Combined CRM publication acceptance — November 10, 2026

Published source `3f4ee6d` includes the manager assignment and persistent action feedback changes, together with the coordinated UWM contract corrections. Production Worker `36788277-ef0b-4039-9afc-112d7ec1a77b` serves 100% of traffic. The UWM release thread performed publication; no competing CRM deployment was issued.

Final candidate passed 428 tests, lint, typecheck and production build. This thread independently ran the 36-stage working-day rehearsal on the final built source, including campaign enrollment, manager assignment/stale-owner rejection, Today callbacks, conversation outcomes, sequence controls and manager counts. Staged assets matched 92/92 twice; the publishing thread also verified ordinary live assets twice.

Signed-in ordinary live acceptance in the fictional QA brokerage verified that the paused Rowan Reactivation Example survived deployment at step 2, scheduled November 11 at 9 AM ET, assigned to Opus Audio. Resuming from Manager view removed the row, preserved the Paused sequences filter, changed the count from one to zero and focused persistent confirmation with the refreshed count. The fictional sequence was restored to running with its original owner, step and schedule. Phone 390 px and portrait desktop 900 px checks showed no page-level horizontal overflow. Evidence: parent `.orbit/orbit-combined-manager-live-mobile.png`.

Campaign draft/selection return and Today Next 7 days return were verified on live traffic before promotion. The full multi-role workflow was tested locally on the combined build; the post-promotion browser check used the existing QA admin session. No real messages, scans or lender submissions were performed, and existing provider configuration was preserved.

Next coherent product gate: owner/LO/processor onboarding acceptance and hosted fictional-workspace recovery. Keep future publications based on the combined UWM source to prevent regression of either workstream.

## Staff entry and invitation recovery candidate — November 10, 2026

Source `4a9378a`, with rehearsal correction `0388324`, replaces the plain inaccessible-workspace response with a responsive recovery screen. Staff can open an available workspace or switch Google accounts while keeping the intended brokerage and guide. Invited accounts continue through sign-in activation; revoked accounts receive a 403 without brokerage details. API access checks and role grants are unchanged. The login screen explains exact invited-email matching; Team explains manual invitation sharing, role landing pages, and focuses saved feedback.

UI UX Pro Max error-recovery guidance and Impeccable source checks informed this pass. The source scan is not a full accessibility audit. Separate local owner, LO and processor browser sessions verified role landing pages, invitation save and focus, denied entry, account-switch target preservation and recovery to an available workspace. Widths 1440, 900 and 390 passed overflow checks. Screenshot: parent `.orbit/staff-entry-denied-mobile.png`.

429 tests, lint, typecheck and production build passed. The extended 37-stage working-day rehearsal verifies invited activation, revocation, denied entry, re-invitation and changed Processor membership against the built Worker, in addition to the full existing loan/CRM flow. The initial rehearsal attempted to insert a duplicate fixture session; the correction activates the existing session and the complete run passed. This is local role acceptance, not hosted OAuth certification.

Publication is coordinated with the concurrent Integrations UI release; shared handoff names the complete branch. No independent upload or production promotion has been issued. Live acceptance must be recorded after the final combined source publishes. Remaining R4 gates include operator-facing migration/reconciliation and hosted fictional-tenant recovery.

### Staff entry published acceptance

Combined source `38f8861` is live at 100% on Worker `6b20cec9-7b37-4cb5-85da-5bbd689371fe`, published by the coordinated UWM release thread with the Integrations redesign. Ordinary signed-in traffic verified the inaccessible-workspace page, account-switch link preserving brokerage and campaign guide, and return to an authorized workspace. Team in the fictional QA workspace shows manual invitation sharing and role landing guidance. Both entry and Team layouts fit at 390 px. Screenshot: parent `.orbit/staff-entry-live-mobile.png`.

The publisher verified 429 merged tests, typecheck/lint, production build and staged/ordinary assets. This thread independently matched the staged candidate's 45/45 assets twice. The corrected 37-stage local rehearsal lives in `0388324`; it changes only the test fixture, not deployed application code. The separate owner/LO/processor activation and revocation checks remain local acceptance; live entry used the existing QA admin account without changing staff permissions. No provider sends or real borrower records were involved.

## Migration operator workflow candidate — November 10, 2026

Source `35b5d0a` replaces the long mixed migration page with four focused views: CRM import/export, loan file import, cutover checklist and import recovery. React Activity preserves loaded files, mappings, decisions and reconciliation while suspending hidden view effects. The applied CRM report links directly to its cutover checklist. Unresolved or changed preview decisions now offer a nearby re-preview action and explain why import remains unavailable. Existing migration contracts, permissions and import limits are unchanged.

UI UX Pro Max active-navigation guidance informed this pass. Local admin browser acceptance mapped a missing owner, skipped an orphaned note and imported three valid records including an open task. It verified call restrictions, preserved preview and applied results across views, cutover navigation, CSV download and 900/390 px overflow. The exported 36-record source was then uploaded through the UI into a second fictional brokerage created through Team. Owner mapping resolved its dependent rows; all 36 records imported, the call restriction remained, and Today showed the transferred callback and future follow-up at the recorded deadline. An initial test checked button readiness before the asynchronous preview finished; the completed preview was enabled and the actual import passed.

Typecheck, lint, 429 tests, production build and the 37-stage working-day rehearsal passed. The scripted rehearsal supplies the broader multi-role and cross-brokerage boundary evidence; the operator walkthrough used the fictional admin. This is local acceptance, not hosted migration certification. Source is pushed at `origin/release/migration-workflow-2026-11-10`; publication is held for the active UWM production configuration release. No competing upload or deploy was issued.

### Migration focused views published

Combined application source `a0a6b3277b57` is live on Worker `e385563d-9ef3-4b59-8848-f1f0ad531e1d` at 100%, with predecessor `1d61ac69-6e2c-410c-a73f-75637c265cd7` retained at 0%. This source includes UWM production setup and its empty-state correction. The candidate's complete binding definitions matched the live baseline, including secret bindings; no credential values or provider modes changed. Retained 90 prior fingerprinted assets. Staged and ordinary asset checks each reached two clean 135/135 passes; the first staged pass saw transient propagation 404s before both successful passes.

The final merged build passed the 37-stage local working-day rehearsal. Ordinary signed-in QA verified the four migration views, preservation of a fictional source key and preview across CRM/MISMO/recovery navigation, and re-preview after choosing an existing duplicate contact. That resolved related rows to three creates and one reused contact. The live check stopped at preview; the complete import/export into a second brokerage was verified locally. Phone 390 px and portrait desktop 900 px fit. Screenshot: parent `.orbit/migration-focused-live-mobile.png`. No real sends, scans or lender actions occurred.

### Accepted PDF history candidate

Source `e84ea38` adds a collapsed **Accepted versions** section in each staff document card. It shows the revision, current/previous state, reviewer and acceptance time. A retained PDF opens through the same authenticated download path, with the requested revision checked before and after fetching its bytes. A missing historical association says **No retained PDF for this revision**, without substituting the current file. Borrower status and its primary next action are unchanged.

The design follows Orbit's progressive-disclosure pattern and the Impeccable polish guidance: keep the current document and next action prominent; expose history on demand; reuse existing controls and spacing. In the local fictional LO session, opening Quinn's loan, selecting the accepted pay stub, and expanding history showed revisions 5 and 2 beside their matching manual receipts. Both download links returned different expected PDFs. Desktop 1440 px, portrait 900 px and phone 390 px had no page or loan-dialog horizontal overflow. Screenshots are in `output/playwright/accepted-versions-{width}.png` (local ignored artifacts).

Typecheck, lint, 431 tests and the full 37-stage built-Worker working day passed. An additional focused legacy-ID migration test passed with the eight document regressions, preserving acceptance and PDF references across the upgrade. The isolated hosted recovery also preserved both distinct PDF byte hashes. This candidate is held for the separate UWM publication; merge its final published source before deploying. No competing OrbitLOS.com deployment has been issued.


### Accepted PDF history published acceptance — November 11, 2026

Combined source `505833c` is live at 100% on Worker `be705ae0-3e94-47c3-a04c-a5d0a65744a1`, with predecessor `8b5945ac-d846-473c-8874-eaf3da03f483` at 0%. It includes the UWM workstream through `e3a0db4` (application `8187613`). All 23 complete binding definitions matched the predecessor, preserving credential bindings and provider configuration. Both staged and ordinary live asset checks passed 106/106 twice. The combined source passed 443 tests, typecheck, lint, production build and the 37-stage working-day rehearsal.

Ordinary signed-in acceptance used the existing fictional Role Handoff QA brokerage and Disclosure Pilot QA loan. Staff requested a sample pay stub, accepted the first built-in PDF, requested its replacement and accepted the distinct replacement PDF. Accepted versions showed revision 5 as Current and revision 2 as Previous, each with reviewer and timestamp. Actual downloads matched their respective original and replacement SHA-256 hashes; neither was silently replaced by the other. Staff recorded mock UWM delivery and checked mock clearance, clearing Income while leaving the unrelated Assets condition outstanding. The borrower portal showed the accepted pay stub and no further upload action.

Staff phone 390 px and portrait desktop 900 px, plus the borrower portal at 390 px, showed no horizontal overflow. The live screenshot is parent `.orbit/accepted-pdf-live-mobile.png`; the collapsed history count is visible. The public product page describes retaining accepted PDFs through replacements. The full separate-role rehearsal remains local; live acceptance used the existing QA admin and fictional borrower portal. No real lender write, message or scan was performed. This publication does not certify production recovery or resolve the remaining R4 operating gates.


## Workspace maintenance candidate — November 11, 2026

Team → Workspaces now links pilot admins to a focused maintenance screen. It separates pause, reopening review and confirmation, with an expandable history. New activity is blocked at the workspace RPC boundary while tracked requests finish. The directory retains maintenance status outside the tenant, including through a tenant restart. The shared directory and non-pilot brokerages cannot be paused through these controls. Paused staff entry uses the existing branded entry surface; portal requests receive a temporary-unavailable result. Reopening records the reviewer and notes, checks the current revision and exact brokerage name, and reschedules background work. It does not restore data.

Orbit's design system and the [Impeccable hardening reference](https://github.com/pbakaus/impeccable/blob/main/.agent/skills/impeccable/reference/harden.md) informed retained form entries, explicit stale/error recovery, disabled incomplete actions, focused success feedback and wrapping. The local owner browser verified incorrect-name recovery, pause, the staff entry page, recorded review and reopening. Desktop 1440, portrait 900 and phone 390 had no page overflow. Screenshots: `output/playwright/maintenance-{width}.png`. A final follow-up prevents reopening while local review edits remain unrecorded.

The candidate passed 451 tests, lint, typecheck and an initial 38-stage working-day rehearsal covering staff, borrower, realtor, background-handler, restart and other-brokerage boundaries. Final acceptance additionally holds an actual owner-lookup request across pause and verifies the Draining state before review; record its result and live publication below. This is the maintenance control foundation, not a broker-operated restore or automatic reconciliation certification. Integration modes and credentials remain unchanged.


### Workspace maintenance published acceptance — November 11, 2026

Application source `ea45c70` is live at 100% on Worker `94808465-e8a0-4d5e-85c2-81366e878112`, with maintenance predecessor `cc556668-0404-46ee-ba91-ffcfde95b517` at 0%. The full feature first shipped from `a438642`; the final change moves Workspace maintenance above the potentially long workspace-switching list. Ordinary traffic confirmed that link appears near the active brokerage heading, within the first viewport. All 23 complete binding definitions matched the predecessor; credentials and provider settings were preserved. All 206 current and retained assets matched twice in both staged and ordinary routing after initial staged propagation.

The feature passed 451 tests, typecheck, lint, the production build and all 38 stages of the built-Worker working-day rehearsal. That rehearsal held a real owner-lookup request across pause, verified draining with one active request and refusal of early review, then released it and verified paused status. It also covered staff, borrower, realtor, background handlers, tenant restart and an unaffected second brokerage. The final link-only refinement passed typecheck, lint and build.

Live acceptance used the existing fictional Role Handoff QA brokerage. Pause produced the branded blocked staff entry; the admin could return to the maintenance review. The three-check review enabled reopening, an unsaved note edit disabled it, and recording the update enabled it again. Exact-name confirmation reopened the workspace; normal Team access returned and five history entries remained. The QA brokerage was left open. No production brokerage, real provider action or actual data restore was involved. Phone 390 px and portrait desktop 900 px fit without horizontal overflow; temporary viewport overrides were reset. Screenshots: parent `.orbit/maintenance-live-mobile.png` and `.orbit/maintenance-live-portrait.png`. The public product page now describes the pilot maintenance capability.

This release provides pilot maintenance and recorded reopening controls, not automatic recovery verification. Recovery inspection/reconciliation, controlled replay, directory recovery, populated provider-workflow recovery and retention policy remain separate gates.


## Paused-workspace inspection candidate — November 11, 2026

The maintenance review now offers an explicit read-only inspection. It shows saved-record totals, paged unresolved/acknowledged UWM records and pending uploads, and paged storage availability for current, accepted, linked-evidence, lead and lender-package PDFs. Missing tables remain unavailable instead of counting as zero. Missing associations, missing objects and unavailable storage checks have distinct labels. An available object is not presented as verified content or a proven restore. Provider payloads, object keys and tokens are omitted.

Orbit's progressive-disclosure pattern, Impeccable hardening guidance and UI UX Pro Max loading/focus/error guidance informed the panel. The first local browser review exposed technical IDs as the dominant row label; the final candidate uses borrower/lead names and expandable references. Requests and documents remain separate, with explicit page coverage and no retry action. Failed refresh retains the prior result with an error and preserves the owner's review draft. Local browser checks at 1440/900/390 px fit without horizontal overflow; final candidate and live acceptance follow below.

The inspection only runs for a current pilot admin while paused and drained, revalidates access/revision after storage reads, and does not initialize an old schema. The current local rehearsal verifies role denial, stale revision denial, records/available files, unchanged maintenance revision, restart and refusal after reopening. This is evidence inspection; operator reconciliation decisions and controlled replay remain subsequent work.


### Paused-workspace inspection published acceptance

Source `09cf922` is live on Worker `f6ffd915-a3bc-477c-a147-bbe03dde9f05` at 100%, with predecessor `94808465-e8a0-4d5e-85c2-81366e878112` at 0%. All 23 complete bindings matched the predecessor. Both staged and ordinary routing reached two clean 256/256 asset passes after initial propagation. Provider credentials and modes were unchanged; no provider actions ran.

The final candidate passed 455 tests, typecheck, lint, build and the 38-stage working-day rehearsal. Tests cover no database writes, absent/older stores, missing/unavailable/unassociated files, bounded paging, deduplicated storage checks, path-like references, masked payloads, recognized borrower names, role/stale-state refusal and restart. Browser acceptance also verified a failed refresh keeps the existing evidence and review draft. The final UI uses names with expandable references and fits 1440/900/390 px. The local cookie fixture required a real browser cookie instead of only an extra Cookie header; no production authentication was bypassed.

Ordinary signed-in live acceptance used Role Handoff QA only. It paused and inspected 38 loans, 30 applications, 1 co-borrower application, 78 loan tasks, 38 contacts, 10 document requests, 3 accepted revisions and 94 audit entries. No pending request rows were present in the inspected stores. Four document references included the original accepted sample PDF (638 bytes), replacement accepted PDF (644 bytes), current PDF (644 bytes), and one legacy fictional acceptance without a retained PDF. The UI distinguished that association gap from an available stored object. No content hashes were checked in this screen and no restore was performed.

The admin recorded the fictional result and known legacy limitation, reopened the workspace and returned to working Team navigation. Live 900 px portrait and 390 px phone layouts had no horizontal overflow, and viewport overrides were reset. Screenshots: parent `.orbit/inspection-live-portrait.png` and `.orbit/inspection-live-mobile.png`. The public product page reflects the inspection capability. The QA workspace was left open. Populated request paging and missing-object error coverage are local tests; live QA had no unresolved UWM rows.


## Recorded inspection decisions candidate — November 11, 2026

Paused pilot admins can record Needs investigation, Preserve observed result or Known sample limitation against one inspected document/request. The directory stores append-only decisions outside the paused tenant; reopening checks are cleared when a decision changes. A request fingerprint includes its recorded response and state; file fingerprints include stored identity, observed availability, size and ETag. These are matching observations, not content-hash or provider-outcome certification. A changed fingerprint is refused at save, and a prior decision is labeled changed on a new inspection. Idempotent repeats preserve one history event; current role, maintenance revision and cycle are required.

The design uses Orbit panels, native disclosures and retained form state, following the previously reviewed Impeccable hardening and UI UX Pro Max focus/error guidance. The local browser verified failed-save note retention, successful decision display, and invalidation of an earlier reopening review. The rendered pass led to collapsing the editor after success and moving page navigation above potentially long record lists. Phone 390, portrait 900 and desktop 1440 layouts fit without horizontal overflow. Final candidate verification and publication follow below.

Decisions are staff attestations only. They do not mark provider requests reconciled, restore files, or authorize replay. Unresolved investigations still belong in the owner's reopening review; automatic decision enforcement across a complete restore manifest and controlled replay remain separate acceptance work.


Maintenance decision final local acceptance: application `4817b85` passed the 38-stage built-Worker rehearsal after the fingerprint encoding correction, in addition to 457 prior full-suite tests, 10 focused maintenance/inspection tests, typecheck, lint and production build. Browser acceptance at 1440, 900 and 390 pixels covered failure input retention, review invalidation, saved feedback/focus, earlier-decision disclosure and reviewed reopening. The final phone screenshot was visually inspected: the editor collapses after save and decision history wraps within the card. Isolated hosted recovery also retained the gate and decision across tenant restoration; see `workspace-recovery.md`. Publication remains coordinated with the active UWM loan-controls release.


### Recorded inspection decisions — published acceptance

Combined application `ef4a99b` is live in Worker `f5085d5b-2a68-4738-910a-030346811b93` at 100%, with `f6ffd915` at 0%. This includes the UWM loan controls from the coordinated API release and the final `4817b85` fingerprint correction. All 23 binding definitions matched the predecessor. Staged and ordinary routing each passed twice for all 344 retained/current browser assets. The combined release passed 460 tests, typecheck, lint and build; this thread also ran all 38 built-Worker working-day stages on the combined application successfully.

Ordinary signed-in live acceptance used only OrbitLOS Role Handoff QA. It paused, inspected the unchanged record totals (38 loans, 30 applications, one joint application, 78 loan tasks, 38 contacts, ten document requests, three accepted revisions and 94 audit entries), and found zero pending provider rows. Four file references again distinguished the legacy acceptance without a retained PDF from both accepted sample revisions and the current PDF. No live provider outcome or content hash was inferred.

A completed reopening review initially enabled confirmation. Recording a Known sample limitation decision cleared all three checks, removed the prior review approval and disabled reopening. Reloading the page and inspecting again retained the decision. A second decision preserved the first in Previous decisions. Success collapsed the editor and focused its saved message. Live 900×1200 portrait and 390×844 phone layouts had no horizontal overflow; final screenshots were inspected and temporary viewport overrides reset. Evidence: parent `.orbit/decisions-live-portrait.png`, `.orbit/decisions-live-mobile.png`, and `.orbit/decisions-live-reopened.png`.

A fresh completed review and exact workspace-name confirmation reopened the fictional workspace; normal brokerage navigation returned. The QA workspace was left Open with 16 maintenance history entries. The public Product page now describes recorded evidence decisions before reopening. No real lender action, document upload or production restore was performed by this acceptance. The separate UWM release notes retain the outstanding account/storage and lender-acceptance requirements.


## Internal edit receipt review — November 11, 2026

The current pilot-admin maintenance flow adds optional Internal edits inspection for direct document due-date changes. It reuses Orbit panels, semantic status labels, native evidence disclosures, page controls above records and note-preserving forms. Impeccable hardening and UI UX Pro Max error/focus guidance informed the review; no claim of a locally installed automated detector. The rendered pass simplified receipt wording, collapsed the editor after successful verification, refreshed canonical history and focused saved feedback. Local error injection retained the note, retry succeeded, earlier reopening approval was cleared and all three responsive sizes (1440x900, 900x1200, 390x844) fit without horizontal overflow. Screenshots are in `output/playwright/recovery-edits-{1440,900,390}.png`.

Release `f77b13d` (application/build `3bf5fc2`) is live as Worker `db7ab9bb-c9b8-4ebc-832e-7c74f8d8c239` at 100%; predecessor `0c20d624` is at 0%. The prior workspace default, explicit demo URL and organized Team workspace list were merged. All 23 complete binding definitions match. All 424 current and retained assets passed staged and ordinary-traffic checks twice. The combined source passed 464 tests, typecheck, lint, production build and 39 working-day stages. Hosted isolated receipt-survival acceptance is documented in `workspace-recovery.md`.

Live signed-in acceptance used only OrbitLOS Role Handoff QA. The Photo ID deadline on Fictional Processing Cutover QA changed from November 12 to 13 and back to 12. Both successful edits appeared exactly once as Outcome recorded, with matching tenant and directory receipts. The newest row showed Saved revision present; the earlier row correctly showed Different revision present. Live 900x1200 portrait and 390x844 phone layouts fit without horizontal overflow; screenshots were visually inspected and viewport overrides reset. Evidence: parent `.orbit/recovery-receipts-live-portrait.png` and `.orbit/recovery-receipts-live-mobile.png`. Interrupted-confirmation verification remains a local controlled-failure test, not a production fault injection. No lender request was made by this acceptance.


The owner inspected the unchanged core record counts and zero pending provider rows, retained the documented legacy sample-file limitation in the reopening note, and reopened successfully. The fictional workspace was left Open with 20 maintenance-history entries and its original deadline. Public `/product` copy was checked live and includes covered edit receipts. No account, provider configuration, lender action, email or text was changed by this release.


## Controlled deadline recovery candidate — November 11, 2026

The pilot owner uses the existing paused Internal edits view. Eligible rows offer a collapsed Recover saved due-date change form with the exact document, original date and desired date. A reason is retained on failed dispatch. Pending recovery is surfaced above paginated history with Check pending recovery; the durable server reservation blocks reopening until the outcome is resolved. Applied/not-applied results preserve actor, reason and time, and require a new reopening review.

The pass used Orbit's design system and the previously reviewed Impeccable hardening/UI UX Pro Max guidance for disclosure, failure retention, truthful feedback and focus. Browser testing exposed a potentially misleading error after a committed change whose response was lost: the client now refreshes the authoritative receipt and shows the saved result. Desktop 1440x900, portrait 900x1200 and phone 390x844 fit without horizontal overflow; the phone screenshot was visually inspected. Proof: `output/playwright/replay-before-{1440,900,390}.png` and `replay-after-390.png`. All 466 tests and the 40-stage working day passed; actual isolated hosted restore and product replay also passed. Public copy is included in the candidate. Live publication follows below.


### Controlled replay publication and live acceptance

Release `7600977` / Worker `8e911e11-bf65-4150-9bef-30ce4d4464f9` serves 100%; predecessor `db7ab9bb` remains at 0%. All 23 complete binding definitions match. Staged and ordinary traffic each matched all 474 browser assets twice. The previous 50-asset release was recovered from its actual published manifest/upload references and verified byte-for-byte against ordinary live responses before retention; rebuilding that source in another worktree produced different names and was not used as the sole asset predecessor.

Live signed-in fictional Role Handoff QA inspection retained both earlier deadline receipts, the original November 12 deadline and unchanged core record counts. Saved and superseded revisions correctly offered no recovery action; no pending recovery existed. The admin recorded the known legacy sample-file limitation and reopened successfully. Public `/product` copy now includes recovering a confirmed deadline from its original revision. Production UI and ordinary asset routing were verified; actual restore and eligible replay were exercised only in the isolated hosted rehearsal. No production restore or provider action was performed. QA was left Open, and no integration configuration changed.


### Recovery checkpoint selection and comparison

Owner task: choose a known recovery point and understand differences before proceeding with recovery review. Reviewed Impeccable hardening guidance and UI UX Pro Max interaction/error guidance against Orbit's existing maintenance components. These were reference-guided reviews, not an installed detector run. Kept checkpoint controls collapsed by default; one save action, a labeled native selector and explicit comparison, grouped business areas with table details disclosed only on demand. Saved/failed/stale states retain context and report confirmed outcomes. Bookmark values, hashes and raw records are never shown.

Playwright CLI exercised the built Worker at1440x1000,900x1200,390x844. Empty state, checkpoint save, no-change comparison, status focus, interrupted successful save/retry, no duplicated option and stale comparison after a new reopening review passed. Screenshots: output/playwright/checkpoints-detail-{1440,900,390}.png. Native option text truncates on narrow screens; the selected checkpoint's full name and actor/time wrap in the comparison. Page width remained bounded. Hosted product restore comparison is independently recorded in workspace-recovery.md. Publication/live acceptance pending the coordinated UWM release.


Live acceptance: Worker aadaa0a5 passed checkpoint create,199-table unchanged comparison, evidence inspection, stale notice after review, refreshed comparison and reopening in Role Handoff QA.900/390-width overflow checks passed; overrides reset. Public product copy verified. Proof: output/playwright/checkpoints-live-reviewed.png and checkpoints-live-reopened.png. Existing missing legacy sample file was included in the review notes; no recovery or provider mutation was performed. Final combined480 tests and41-stage working day passed;543 retained/current assets verified twice before and after promotion.


### Loan retention inventory and holds

The owner inventory uses the existing Compliance navigation, a borrower search and an active-hold count that filters the records. The review names the borrower and the effect of the action. Feedback moves focus to the receipt, and closing history returns focus to its originating button. The Playwright pass checked 1440, 900 and 390 pixels, with a 44-pixel confirmation control and no horizontal overflow. UI UX Pro Max informed feedback and filter wrapping. Impeccable's rendered scan reported the existing Inter typeface and global theme effects. The new panel uses the shared typography and neutral surfaces. [Impeccable polish](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill).


### Retention export

Verified for the pilot owner download flow on the built Worker from `38c94d1`. A fictional loan had a long borrower name, two stored PDFs and a mix of active and released hold history. Screenshots at 1440 × 900, 900 × 1200 and 390 × 844 were inspected. Moving the download and close controls above the history kept them near the selected loan. The controls measured 44 pixels or more, and the panel fit each width. The browser exercised a failed response, retry, successful ZIP, and focus preservation on download and return. The rendered Impeccable scan reported the shared typeface and theme effects. [Impeccable polish](https://impeccable.style/docs/polish/) · [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill).


### Disposition review

Verified for the pilot owner queue on the built Worker from `0fb4550`. The review reused Orbit's inline retention form and actions previously informed by the 21st.dev component references. UI UX Pro Max informed labelled fields and explicit saving, error and saved feedback. The Impeccable check used the rendered panel and flagged existing shared theme and typeface patterns. The browser started with no configured policy, saved a fictional policy, excluded a held loan, recorded an outcome and verified focus on return. Screenshots at 1440 × 900, 900 × 1200 and 390 × 844 were inspected. The final phone pass kept each due-date label together and confirmed the form fit without horizontal overflow.


### Retention audit

Verified for the pilot owner audit on built Worker `721a4e1`. The view reused Orbit's policy and decision cards and native controls, following the 21st.dev references used for the existing retention forms. UI UX Pro Max informed labelled filters and pressed-state semantics. The selected view received a visible outline after the first screenshot pass. The final desktop, portrait and phone captures were inspected. Keyboard testing covered version drilldown, invalid filter recovery, JSON download and return focus. Impeccable reported existing shared theme and typography patterns.

### Conversation and compliance discoverability, and cutover inventory

Built Worker `89b9094`. The operational workspace starts Conversations with an explicit first step and a primary Contacts action. A filtered empty state offers a keyboard-operable reset that returns focus to the heading. The owner overview links to the workspace chooser and describes the fictional scope of Compliance. It preserves existing access and permission checks. The pilot owner downloads the cutover inventory from the source 1003, with transfer instructions in the download receipt.

The Playwright browser followed the workspace chooser, reset an empty Unread filter, entered Contacts from Communications, and moved a populated fictional CRM export, 1003 XML and inventory between two pilot brokerages. It opened the restored work from the destination receipt. The destination export retained the call restriction and open task, with the current owner remapped. The source fixture was prepared with an orphan task already reviewed and skipped. The 1440, 900 and 390 px screenshots of the empty queue and populated source-loan export were inspected. The primary action remained visible and the inventory button retained keyboard focus and a 44 px target. UI UX Pro Max informed the empty-state action and filter reset. The screens reuse Orbit's accepted actions and download patterns.

The live baseline showed an empty team conversation queue in the operational brokerage and a populated queue and outcomes in Role Handoff QA. The live QA loan drawer at desktop width was 660 px wide with nine visible sections. A deep link from a conversation landed 609 px down the Activity section, leaving the borrower identity, next action, and section navigation above the viewport. That is a concrete starting point for the next loan details design pass.

### Loan details and workspace continuity

Worker source `783e5ee` keeps the borrower name, stage age, next action and section controls above the scrolling record. The overview shows the property, lender condition count and people on the file. Activity links go to follow-ups, Communications, notes and audit history. Keyboard focus moves to the requested record below the measured header and returns to the same loan on the pipeline even if a save moved its card. Reopening a document no longer duplicates Service orders.

A fictional LO reviewed the submitted 1003, sent the file to processing and used the Activity shortcuts. A separate processor accepted the handoff, followed the next action to the exact pay stub and accepted the sample. The focused document stayed below the header. Final overview and processor screenshots were inspected at 1440, 900 and 390 px. The walkthrough exercised keyboard navigation and checked that exactly one Service orders section remained after repeated document jumps. Impeccable flagged the existing Inter and shared theme effects and two advisory text sizes below 12 px. UI UX Pro Max informed scroll offsets, focus and reflow. The layout reused the existing record drawer, native mobile section picker and approved action components.

An owner switched between separate operational and pilot workspaces through Team. Reload and the generic workspace entry kept the active choice. A demo-guide visit preserved the prior daily choice. The working-day regression also verified account scoping, denied revoked access, explicit fallback, and that background requests do not set the preference.

### Staff onboarding and branch routing

Source `c514b21` shows the saved invitation and scoped sign-in link together. The owner can copy a pending member’s link later and refresh activation while editing a branch. The branch editor keeps the draft and checks the refreshed assignments. The website routing action opens and focuses the existing Lead Inbox form. The design reuses the established Team cards, action buttons and disclosure patterns. UI UX Pro Max informed an optional path through the existing controls. The rendered Impeccable check surfaced the shared Inter and theme effects.

Compared the baseline and final invitation and branch panels. Inspected populated captures at 1440, 900 and 390 px, checked keyboard feedback and focus, and exercised creation, clipboard copy, activation refresh, default LO selection and the routing jump. Separate fictional browser contexts exercised the borrower request, the LO’s first contact and prefilled 1003, the processor’s assigned file, and a canceled invitation with denied entry. The loopback fixture activated test identities through the directory. Real Google OAuth and invitation delivery were outside this run.

## Workspace switcher and recovery resume

The Team → Workspaces list retains its existing operational and fictional workspace groups. Impeccable’s Clarify guidance informed the sentence that explains when a choice is saved. UI UX Pro Max’s navigation search supported preserving shareable brokerage-scoped URLs. The release reused Orbit’s approved links, buttons, and disclosure rather than introducing another component pattern. Impeccable reported no findings on the changed Team component.

In the populated fictional fixture, I inspected the switcher at 1440, 900, and 390 px. The current workspace, actions, and both sample rows fit at each width. Keyboard activation opened the chosen workspace and the browser kept it on reload and in a new tab. A clicked shared link opened its named brokerage while the saved default stayed intact. The separate current-workspace action set a new default successfully.

The paused recovery status card exposed the pending restore at the same three widths. Keyboard focus reached the restore heading, the verification control was visible on the phone layout, and completing the restore required a fresh reopening review.

### Paired pilot comparisons

Verified for the fictional pilot admin’s paired benchmark flow on built Worker source `367ad5a`. The form collects one workflow at a time and moves focus to the saved case. Pending cases show their next action and carry forward the comparison boundaries. The review reused Orbit’s accepted record list, buttons, and disclosures. Impeccable Clarify informed the outcome and recovery language. UI UX Pro Max informed progress visibility, error recovery, and error placement. The final Impeccable source check reported no findings on the changed surfaces.

The original populated screenshot showed two required run forms. The final form, pending case, and completed comparison were inspected at desktop, portrait, and phone widths. The narrow form kept its selected workflow names readable, and the comparison table fit without horizontal scrolling. Captures are `paired-pilot-form-1440.png`, `paired-pilot-form-900.png`, `paired-pilot-form-390.png`, `paired-pilot-pending-390.png`, and `paired-pilot-result-{1440,900,390}.png` in local release evidence. The test covered a legacy record, a lost response after a successful write, valid retry, reload, focus after save and discard, zero and unmeasured values, a blocked run, and a separate LO and brokerage. Observed broker comparisons and a signed-in production walkthrough remain unverified for this cycle.

### Pilot support report

Verified for the pilot admin in built Worker source `d39a8a2`. The report reuses the existing maintenance panel, action buttons, and key-value layout. Impeccable Clarify informed the preview, stale-state, and export labels. UI UX Pro Max informed local error recovery and save feedback. The source detector returned no findings on the changed surfaces.

The fixture included a handoff waiting for acceptance, an unconfirmed edit, a lender request requiring reconciliation, a completed request acknowledgment, and a failed lender operation. I inspected the populated `pilot-support-1440.png`, `pilot-support-900.png`, and `pilot-support-390.png` captures. The browser followed the Team link by keyboard, reached the report heading, rejected a stale download after pause, returned focus to Preview, refreshed and downloaded the JSON. The reference appeared in the exact Access history entry. Separate LO and brokerage checks, a cross-origin rejection, and inspection of the actual file covered the access and redaction boundary. Signed-in production acceptance remains unverified for this release.

## Account workspace preference and support report work

**Verified for stated scope** in built fictional fixtures. The Team workspace switcher on `bac372f` saves the sign-in default to the account. The populated operational workspace and two sample rows were visually checked at 1440, 900, and 390 px in the parent `.orbit/workspace-account-{1440,900,390}.png` captures. The browser filtered sample rows, switched by keyboard, reloaded the destination, removed the preference cookie, opened a shared workspace link and returned to the saved default. The 45-stage working-day fixture also checked an independent account, a new authenticated session and the revoked-workspace recovery path. Impeccable Clarify informed the switcher sentence. UI UX Pro Max's workspace switching search informed keeping shareable scoped links. This copy change reuses Orbit's accepted workspace list and disclosure, with no new 21st.dev pattern needed.

The support drilldown on `832d619` used Orbit's approved list, loan navigation, and recovery controls. Impeccable Clarify informed the return action, and UI UX Pro Max's navigation and focus search informed return-to-heading behavior. No new 21st.dev component was needed. The populated desktop and phone report, selected loan, and pending-only recovery filter were inspected in the parent `.orbit/support-drill-*.png` captures. Keyboard navigation opened the exact processing handoff, then restored the report list and focus on return and reload. The separate lender group opened the unresolved request and its loan section. A paused pilot hid loan drilldown and offered the unconfirmed receipt view. The fixture exercised the recovery filter only. LO and other-brokerage checks denied private work, and the downloaded JSON remained redacted. Signed-in production behavior was unavailable to verify in Work settings.

## Public Demo workspace continuity note

**Verified for stated scope** on staged source `2b75fc4`. The note reuses the existing public Demo list. Impeccable Clarify informed the short user action and its consequence. UI UX Pro Max's content guidance informed the wrapping check. The existing list was reused without new 21st.dev pattern research. Final captures at 1440, 900 and 390 px were visually inspected in the parent `.orbit/preference-evidence-demo-{1440,900,390}.png`. The note wraps and keeps the existing list alignment. Reload retained the note and the request form remained keyboard focusable. No form was submitted. The broader Demo page and recovery operator flow did not receive a visual redesign.

## Processor assignment receipt

**Verified for stated scope** on built source `6d62bf6`. The fictional admin searched for a loan, opened the populated Team assignment editor, lost the response after the save committed, reloaded, and reopened the same loan. The first receipt check failed and left an actionable retry. The next check confirmed the original save, focused the result, and refreshed the current processor without posting another change. From the loan editor, a second dropped request had no receipt and left access intact. Another receipt confirmed an earlier save while preserving a newer assignment. The 390 px layout now wraps the assignment heading and actions, and the processor controls fit with 44 px targets. Long loan names still shorten inside the native selector and appear in full in the selected heading.

Impeccable Clarify informed the distinction between an unconfirmed response and a rejected save. UI UX Pro Max's error recovery and feedback search informed the read-only check and keyboard feedback. Orbit's accepted status banner, native select and button patterns were reused without new 21st.dev research. The populated `.orbit/processor-receipt-pending-{1440,900,390}.png` and confirmed desktop and phone captures were inspected. The public Demo update used the existing list and was reviewed on the staged Worker at 1440, 900 and 390 px. The demo form received keyboard focus after reload. No request was submitted.

## Processor assignment checks from queues

**Verified for stated scope** on built source `c533b35`. A fictional owner lost the response after assigning a processor in Processing → Unassigned. After reload the receipt remained available even though the original loan left the filtered list. The first read failed and a keyboard retry confirmed the original save without another assignment request. The current-access action opened the exact file. In Playbooks → Ownership and deadlines the owner checked a missing receipt and reviewed unchanged access. A later lost response carried between the two queues. Checking confirmed that save and opened the newer processor assignment. Focus landed on the receipt status or alert.

Inspected desktop and phone screenshots of the populated pending state and the manager confirmation, with browser overflow checks at 1440, 900 and 390 px. The staged public Demo note fit at the same widths and the form retained keyboard focus after reload. Impeccable Clarify informed the distinct save outcomes. UI UX Pro Max's status and recovery guidance informed feedback focus and the check action. This reused Orbit's accepted status banner and actions without new 21st.dev pattern research. The signed-in fixture was local. Production verification used public and signed-out routes.

## Processor access during checkpoint restore

**Verified for stated scope** on built source `f31a825`. The fictional owner opened two saved checkpoints. The older preview listed both processor-access and assignment-receipt blockers, focused the status, and withheld the reserve button. Selecting the newer checkpoint invalidated the old preview. Previewing it offered the existing review form. No restore was initiated in the browser fixture. The blocked preview was inspected at 1440, 900 and 390 px in `.orbit/processor-restore-blocked-{1440,900,390}.png`. The safe phone state was inspected in `.orbit/processor-restore-safe-390.png`. A separate isolated Cloudflare rehearsal exercised actual restoration and reopening.

Impeccable Clarify informed the distinction between a saved checkpoint and its protected access. UI UX Pro Max's error recovery guidance informed the explicit next action. The preview and public Demo note reuse Orbit's accepted controls and list, with no new 21st.dev component. The staged public copy fit all three widths and the form remained keyboard focusable after reload. The broader maintenance page did not receive a redesign.
