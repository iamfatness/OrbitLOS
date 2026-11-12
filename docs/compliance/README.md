# Mortgage compliance program and platform register

Research baseline: November 10, 2026. Scope: OrbitLOS, a US wholesale mortgage broker LOS/CRM, including lead intake, campaigns, applications, pricing, credit/AUS, lender delivery, processing, closing records and post-close relationships.

This is a source-linked research baseline and engineering specification, **not an exhaustive legal inventory, legal opinion, certification or live-operation approval**. A research entry for a state does not mean its legal rules are encoded or its workflows are safe to enable. Exact applicability depends on the brokerage's legal entities, licenses, role, products, loan purpose/security, activity locations, counterparties and current law. Unresolved items are deliberately retained as release blockers rather than filled with guessed rules.

## Deliverables

- [Federal obligations and platform gaps](federal.md): source-linked applicability, controls, evidence and unresolved interpretations.
- [Alabama–Missouri](states-a-m.md) and [Montana–Wyoming](states-m-w.md): all 50 states, with regulator/statute sources and state-specific implementation considerations.
- [Implementation and release specification](implementation.md): data contracts, server enforcement points, ownership, acceptance tests and staged release criteria.
- [Compliance Risk & Gaps plan](risk-and-gaps-plan.md) and [product/engineering specification](risk-and-gaps-spec.md): the next workstream after UWM, covering operational dashboards, file-level findings, ownership, evidence review, action gates, confidentiality and ongoing maintenance. These are planned capabilities, not current enforcement.
- Machine-readable sources: [federal](federal-sources.json), [first 25 states](state-sources-a-m.json), [remaining 25 states](state-sources-m-w.json).
- **Workspace → Compliance → Research & gaps**: pilot-admin source explorer and persistent requirement-review/control-gap workflow. See [implemented pilot slice](research-workspace-implementation.md) for access, storage, validation and remaining scope.
- [FV7 reporting preparation](mcr-fv7-preflight.md) records the pinned schema, Michigan fictional pipeline rehearsal, and the data needed to connect it to quarterly review.
- [50-state rollout criteria](state-rollout-criteria.md) defines what to verify for each jurisdiction and how to track the work in Orbit.

The state JSON entries summarize research; full notes, multiple sources and unresolved issues live in the state documents. Federal and state sources must be read together. Common state workstreams are review prompts, not a representation that every state imposes an identical rule.

## What is implemented

The pilot research workspace implements source lookup for 50 states and 25 federal areas, tracked review/gap cases, ownership, internal follow-up dates, next actions and audit history. Tests check catalog integrity, authenticated tenant/role boundaries, restricted-case exclusion, revisions, retry safety, pagination, ownership changes and transaction rollback. These tests validate register integrity, **not the legal truth or completeness of research**. No source-refresh service or automatic regulatory monitoring is enabled.

Existing application controls provide pieces of the eventual compliance program: tenancy and access checks, application history, document handling, activity history, opt-out handling, and manual disclosure status. Those pieces need requirement-specific verification. The new register does not add transaction enforcement, approve licenses, calculate statutory dates, issue legally validated disclosures, screen DNC lists, file regulatory reports or satisfy organizational duties.

## Scope boundaries to resolve before production

1. Identify company/branch/MLO licenses and exemptions and the jurisdictions in which the brokerage will act. Property state alone is insufficient. DC and territories were outside the requested 50-state research and are unsupported by this register.
2. Confirm consumer closed-end first/second lien, HELOC, reverse, manufactured housing, DSCR/business-purpose, high-cost and other product scope. A DSCR label does not itself establish a business-purpose exemption. Distinguish broker, creditor, table funding, correspondent/non-delegated and servicing roles.
3. Assign disclosure issuance, adverse-action notices, record custody, reporting and complaint duties between broker and lender. Delegation is not proof that a duty was fulfilled.
4. Confirm marketing channels and technologies (manual calls, dialers, prerecorded/AI voice, text, email, recorded conversations), data vendors, referral arrangements and compensation models.
5. Appoint the brokerage compliance owner and qualified legal reviewer. Review applicable authorities, effective dates, amendments, exemptions and any conflicting guidance before translating them into production decisions.

## Maintenance

Retain the source, section, retrieval date, effective dates and reviewer for each approved atomic rule. Review amendments and agency/court developments before affected releases; a calendar review interval alone cannot guarantee freshness. Record supersession instead of overwriting historical rules. Run regression scenarios against both the previous and proposed rule sets. A new or unresolved jurisdiction/product/role combination remains unavailable for live use until a separate enforcement implementation and release review are complete.

Run `node --test tests/compliance-research.test.mjs tests/compliance-cases.test.mjs`, `npm run typecheck`, `npm run lint` and `npm run build:cloudflare` to validate the pilot integration. Legal review and operational evidence remain separate release requirements.


## Compliance Suite execution

The user authorized execution of the [suite plan](compliance-suite-plan.md) and [specification](compliance-suite-spec.md). Michigan is the first pilot, all 50 states remain research scope, and user then lawyer review is required before launch. See the [execution and release ledger](compliance-suite-execution.md) for implemented scope, remaining packages and unverified browser acceptance.
