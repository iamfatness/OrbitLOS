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
