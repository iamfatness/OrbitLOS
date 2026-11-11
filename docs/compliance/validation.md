# Register validation — November 10, 2026

Scope: compliance research register integration only. No live providers were activated and no deployment was performed.

| Check | Result |
| --- | --- |
| `node --test tests/compliance-register.test.mjs` | 5 passed: unique 50-state coverage, federal sources, invalid/missing/duplicate entries, unknown jurisdiction handling, unapproved/unenforced export status |
| `npm run typecheck` | Passed |
| `npm run build` | Passed Next production build |
| ESLint on `src/lib/compliance-model.ts`, `src/lib/compliance-catalog.ts`, `src/components/compliance-register.tsx`, `src/components/orbit.tsx`, `tests/compliance-register.test.mjs` | Passed |
| Repository-wide `npm run lint` | Stopped because it traversed large pre-existing generated `.orbit` release bundles; no full-repository lint result claimed |
| Local production-build browser check | Compliance navigation rendered; federal default showed 25 families/50 states; TRID search returned one matching family; Michigan selection showed state summary, primary source and six review workstreams; desktop layout inspected |

Coverage tests check presence and shape, not whether statutes are complete, current or correctly interpreted. The UI does not mark any state approved, and the export explicitly reports `legalApproval: false` and `runtimeEnforcement: false`. Loan transactions, hosted Worker runtime, mobile layout, live consent/disclosure providers and production role sessions were not validated by this register-only check.

The same isolated local workspace showed an unrelated pipeline-load failure; server logs reported non-plain/null-prototype objects crossing a Server Component boundary. The Compliance view and tested interactions worked, but this check does not establish a clean end-to-end workspace rehearsal. The pipeline issue was not investigated or changed in this compliance scope.

All current implementation and legal gaps remain open in [the implementation specification](implementation.md). Research details and source limitations remain in the federal and state documents.
