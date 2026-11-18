# OrbitLOS UI/UX & Branding Polish Spec

**Goal**: Elevate OrbitLOS from a strong, intentional pilot to a polished, professional product that feels premium to independent mortgage brokers.

**Date**: 2026-11-18  
**Scope**: Design tokens, typography, elevation, brand consistency, marketing fidelity, workspace polish.

## Current State (Strengths)
- Cohesive purple/lilac orbit palette and rings motif
- Consistent component language (cards, lanes, pills, sidebar)
- Relationship- and workflow-focused information design
- Solid responsive and accessibility baselines

## Priority Improvements

### Phase 1 – Foundation (this commit / immediate)
1. **Shared design tokens**  
   Expand `:root` with semantic tokens for shadows, radii, type scale, and surface colors. Align marketing and app.

2. **Typography**  
   Move from Segoe UI to Inter as primary. Establish clear hierarchy, tighter heading tracking, tabular numerals for money/dates.

3. **Elevation & interaction**  
   Refine shadow system (rest / hover / raised). Stronger but still subtle hover states on cards and buttons. Consistent focus rings.

4. **Brand consistency**  
   Unify accent usage and brand mark treatment between marketing header and app sidebar.

### Phase 2 – Presentation & Micro-interactions
- High-fidelity product screenshots or improved CSS mocks on marketing site
- Better empty states (illustration + clear next action)
- Subtle motion (card lift, stage transition feedback)
- Loading / success / error state refinement

### Phase 3 – Advanced
- Density toggle or spacing rhythm improvements
- Light data visualization for reports/metrics
- Optional dark mode (tokens already support it)
- Animated orbit rings or refined logo mark

## Design Tokens (proposed)

```css
:root {
  /* existing colors stay */
  --shadow-sm: 0 1px 2px rgb(34 20 57 / 0.04);
  --shadow-md: 0 4px 12px rgb(34 20 57 / 0.06);
  --shadow-lg: 0 12px 32px rgb(23 13 50 / 0.12);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --font-sans: Inter, "Segoe UI Variable", system-ui, sans-serif;
  /* ... */
}
```

## Success Criteria
- Marketing and app feel like the same product
- Typography and spacing feel intentional and premium
- Interactions provide clear feedback without noise
- No regression in existing functionality or accessibility

## Implementation Notes
- Prefer CSS custom properties and existing class structure over large rewrites
- Keep Lucide icons
- Test both marketing site and workspace (local SQLite + demo)

## Phase 2 Progress (2026-11-18)
- Enhanced empty states with dashed orbit-edge treatment, better spacing, and hierarchy
- Refined banner/error surfaces to use shared radii and subtle elevation
- Added light hover lift on loan cards and smoother transitions on interactive elements
- Busy/disabled states now have clearer visual feedback
- Marketing styles already aligned from Phase 1; product preview uses shared tokens

Next for full Phase 2 close: higher-fidelity annotated screenshots on marketing pages and richer empty-state illustrations in the workspace.

## Phase 3 Progress (2026-11-18)
Started advanced polish:
- Density mode foundation (`[data-density="compact"]`) for tighter spacing on pipeline and cards
- Light visualization helpers (`.metric-bar`, `.metric-trend`) for reports and metrics
- Dark-mode token groundwork via `prefers-color-scheme` (surfaces, text, cards, tables)
- Subtle infinite rotation on `.orbit-rings` (respects reduced-motion preference)

These are opt-in / progressive. Next steps: wire a density toggle in the UI, add actual bar/trend usage in reports, and refine dark-mode contrast.
