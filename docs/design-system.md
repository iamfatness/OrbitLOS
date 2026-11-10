# Orbit design system

Status: user-approved design direction. The first implementation is live. Final sign-off requires the role, state, and responsive checks in the demo checklist.

## Identity

Orbit is a calm, capable workspace for people trusted with a home purchase. The interface should convey precision, continuity, and control. Preserve the Orbit mark and plum/lilac identity. Use orbital artwork sparingly on brand and entry surfaces; operational screens give priority to records, decisions, and actions.

Brand line: **Every loan. Every relationship. In Orbit.** Use on marketing and appropriate entry surfaces, not as recurring decoration inside workflows. Product naming is OrbitLOS; conversational copy may use Orbit. Avoid space-themed workflow terminology.

## Typography

The shared stylesheet and hosted sign-in declare self-hosted Inter Variable with font-display swap and a Segoe UI/system sans-serif fallback. The WOFF2 and its Open Font License are in `public/fonts/`. Verify the rendered font and wrapping during the final visual walkthrough. [Inter](https://rsms.me/inter/)

| Use | Target |
| --- | --- |
| Form inputs and borrower body | 16px, weight 400, line height 1.5 |
| Workspace body and table values | 14px, weight 400–500, line height 1.45 |
| Secondary metadata | 12–13px, readable contrast; never hide an essential action or deadline in tiny text |
| Labels and navigation | 14px, weight 500–600 |
| Section headings | 18–20px, weight 600 |
| Page headings | 28–32px desktop, 24–28px narrow screens, weight 600 |
| Marketing headline | Responsive 36–64px, weight 650–700; verify wrapping |

Use tabular numbers and right alignment for comparable financial columns. Define consistent currency, date, timezone, and missing-value formats. Unknown is not zero. Avoid excessive bold, letter spacing, all-caps labels, and decorative font pairing.

## Color and surfaces

Retain existing brand tokens: night `#211833`, plum `#2d1b4b`, lilac `#d9c7ff`, action violet `#6749d3`, ink `#252235`, muted ink `#686177`, canvas `#f8f7fb`, divider `#ebe8f1`, and white surfaces. Semantic success, warning, and error colors must be distinct from brand accents and paired with text or symbols. Verify contrast for actual foreground/background pairs; these tokens alone do not certify accessibility.

Use dark plum for navigation and brand framing, white/light surfaces for reading, violet for the primary action, and lilac for selection. Do not color every card or give all controls equal visual emphasis. Keep gradients out of dense data surfaces. Selected navigation needs a persistent shape/background as well as color.

## Icons

Use the existing Lucide family consistently. Follow its [design language](https://lucide.dev/contribute/icons/design-principles): a 24-unit source grid, 2-unit strokes, rounded ends and joins, and balanced optical weight. Standard rendered sizes: 16px inline, 20px navigation/actions, 24px larger status/empty-state accents. Verify detailed glyphs at their actual rendered size rather than shrinking them until they blur.

- Create a central semantic icon mapping so the same concept always uses the same symbol. Review installed exports before choosing exact glyph names.
- Distinguish Today from Calendar, Reviews from Tasks, and Processing from Reports. Current repeated calendar/clipboard/file symbols need review for recognizability.
- Use familiar concepts: clock/check for due work, calendar for dates, columns for pipeline, inbox for incoming leads, message bubble for conversations, chart for reports, shield/check for review, and people for team. Reserve the Orbit mark for identity and guided entry rather than unrelated tasks.
- Keep text beside primary navigation and consequential actions. Icon-only utility buttons need an accessible name, visible focus, and a tooltip available by keyboard as well as hover.
- Use a consistent 40px desktop utility hit area and 44px touch target. Optical alignment and hit area are separate from glyph size.
- Icons inherit text color; use subdued defaults and clear selected/hover/disabled states. Avoid emoji, mixed filled/outline styles, spinning decorations, and arbitrary colored icon tiles.
- A loading icon only signals actual pending work. Respect reduced-motion preferences; never use animation as the sole state cue.

## Layout and interaction

Use a 4px spacing base, primarily 8/12/16/24/32px gaps. Prefer 8px control radii and 12px panel radii; pills are for compact status, not every control. Align headers, filters, tables, and actions to shared edges. Keep density consistent within a role's workflow.

Each screen has a clear title and next action. Use one primary action per task region, secondary actions with less emphasis, and overflow menus for infrequent operations. Keep filter state when returning from a record. Preserve context in drawers and restore focus on close. Long forms use meaningful sections and progressive disclosure.

Show saving, saved, failed, stale, and pending states accurately. Avoid optimistic success where a server or provider has not confirmed it. Explain conflicts at the affected field/action; retain user input on recoverable errors. Confirm consequential actions with the actual record and effect, not generic warnings.

## Editorial standard: concise by design

Marketing sells the brokerage's working day: lead follow-up, loan progress, owner visibility, and lasting client relationships. State the benefit, show the workflow, and offer a demo. Keep roadmap gaps and implementation details in planning documents. Place concise sample-data and simulated-provider labels with the relevant demonstration; preserve truthful availability without turning every section into a disclaimer. Never imply a planned connection is live.

Do not make users read instructions to compensate for unclear controls. Remove paragraphs that restate the heading, narrate visible UI, or explain internal implementation. Put optional detail in contextual help, not permanent card introductions. Familiar controls need labels, not tutorials.

| Avoid | Prefer |
| --- | --- |
| Review and manage all of your upcoming tasks in one convenient place. | Tasks |
| Use the filters below to narrow down the results shown in this list. | Labeled filters without an introductory sentence |
| Click here to open the selected loan and review its details. | Open loan |
| No records were found matching your selected criteria. Please try adjusting your filters. | No matching loans. + Clear filters |
| Successfully saved your changes to this record. | Saved |

Retain information that changes a decision: required format, deadline/timezone, who receives a message, what a destructive action removes, conflicting changes, and whether an outcome is simulated. Keep demo disclosure visible at workspace level and on consequential simulated outputs, without repeating the same disclaimer on every card. Do not remove necessary consent or material limitations for visual minimalism.

## Design gate for each release

At roadmap planning, identify the work the LO or owner should be able to finish and the next handoff. Cover both business growth, such as acting on a referral, and daily operations, such as clearing a closing blocker. Include processors, borrowers, and realtors where they participate.

Before implementation, review the current path with Impeccable and UI UX Pro Max. Use 21st.dev to compare a specific interaction when the existing components need a new pattern. During implementation, use the Orbit components and tokens for shared labels, feedback, and controls. Review changes with a focused Impeccable detector scan and resolve findings against the rendered experience. [Reference review](brand-ux-review.md)

Verify the rendered candidate on desktop, 900 × 1200 portrait, and 390 × 844 phone widths. Walk through the applicable empty, loading, successful, blocked, stale, and error states with keyboard and touch behavior. On returning to a queue, verify the prior filters and meaningful focus remain. Compare the role views for terminology, count definitions, status and action hierarchy. Log before and after evidence, the decision it changed, and any limitation with the release. [Product roadmap design gate](../PRODUCT-ROADMAP.md#design-and-usability-gate-for-every-release)

## Final visual acceptance

Apply this standard to owner dashboards, LO Today/pipeline/drawer, processor conditions, communication/calendar/search, finance, migration, and borrower/realtor portals. Review desktop and narrow screens plus keyboard, loading, empty, error, and conflict states. Verify icons together as a set and in their actual controls. The font change requires clipping/wrapping, number alignment, zoom, and fallback checks.

Record before/after evidence against D08, D12, D13, and D15 in the [demo checklist](demo-completion-checklist.md). Use [the reference review](brand-ux-review.md) for Impeccable, UI UX Pro Max, and 21st.dev guidance. Work screen by screen on the current candidate; preserve business behavior and permission boundaries. A written specification is not a completed visual pass.
