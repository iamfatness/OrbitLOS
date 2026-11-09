# OrbitLOS delivery and scale plan

Updated: 2026-11-08. Planning targets below are unvalidated until measured. This plan guides the implementation already underway; it does not describe a completed scale or security assessment.

## Presentation demo milestone

The [fictional demo](docs/demo-completion-checklist.md) passed all 15 acceptance checks with the approved design on hosted release `2d3265d0-ec1e-486b-b0eb-8f5661b38e23`. The final same-release browser rehearsals took 4:04 and 5:55. The [working-day rehearsal](docs/working-day-rehearsal.md) kept three role sessions active through CRM intake, guarded closing, and the repeat 1003. The [local recovery rehearsal](docs/workspace-recovery.md) verified rollback during a populated upgrade and resumption of a numbered import. The next evidence milestone is a paired design-partner run that measures each actor's active handling time and handoffs against the brokerage's current process. The pilot, live integration, customer API/MCP, and capacity gates continue separately.

## Demo operating budget

Use local SQLite for development, rehearsals, and load checks with fictional data. Keep the hosted demo on its existing footprint and keep lender, credit, AUS, pricing, email, and scanning integrations mocked in the demo workflow. Defer new paid services and higher hosting tiers until funding is available and the owner approves the spend. Keep brokerage data boundaries, stable record IDs, and provider interfaces in place so the same workflows can carry forward when infrastructure changes.

## Authority and responsibilities

The [product north star](PRODUCT-NORTH-STAR.md) defines the outcome and three pillars: Capacity, Security, Features. This document owns the release sequence and gates. The roadmap summarizes it; the product brief defines scope. Resolve conflicting older sequences in favor of this plan.

Assign a named accountable person to each role before its release gate: product owner (scope and value), engineering owner (architecture and delivery), security owner (access and data handling), pilot owner (broker evidence), and operations owner (recovery and support). One person may cover multiple roles initially. These are responsibilities to assign, not staffing commitments or assignments to additional agents.

## Baseline before new work

The pilot foundation documents lead intake, 1003 review, quote worksheets, processing, conditions, retention, migration, and reports. Current working-tree files also contain campaign routing, segments, suppression, response tracking, and paired benchmarks. Their presence is evidence of implementation activity, not production release readiness.

Maintain the [capability register](docs/capability-register.md) against an immutable revision and deployment version. For each workflow record: status, responsible owner, test scenario, evidence, manual handoffs, known limits, next gap, and the release gate it supports. Use the README walkthroughs and existing measurement UI before creating another tracking mechanism. Do not classify an entire section as shipped because one happy path works.

## Ordered delivery increments

| Increment | Feature outcome and acceptance | Capacity and security work in the same increment | Exit evidence |
| --- | --- | --- | --- |
| 0. Establish the baseline | Run a direct lead, realtor referral, returning client, condition replacement, and paused/reopened file. Inventory the tools, costs, duplicate entry, and manual steps in the current brokerage workflow. Reconcile source and deployment status. | Map request paths, shared services, data access boundaries, payload sizes, and tenant data growth. Identify current access, recovery, and performance blockers. | Capability register, benchmark baseline, threat/risk register, architecture decision list, named gate owners. |
| 1. Complete the relationship lifecycle | Unify lead states, qualification, nurture, disqualification, reactivation, campaign enrollment, callbacks, and repeat loans. Preserve source and history. Demonstrate safe duplicate review and preference/suppression behavior across matching records. | Define stable tenant and record identifiers, idempotent transitions, history and deletion rules, indexed/paginated contact access, and permission tests for every role. | A lead can pause, opt out, return, convert, and start a repeat loan without lost attribution, inappropriate outreach, or duplicate tasks. |
| 2. Make the daily queue dependable | Connect all actionable work to owner, priority, due date, blocker, and exact action. Define dependencies, escalation, absence coverage, reassignment, and staff departure. Complete staged imports, follow-ups, document work, and handoffs from the queue. | Bounded queue reads and updates; revision checks for competing edits; durable jobs and replay rules; no brokerage-wide scan on every user action. Tenant and role checks survive reassignment and revocation. | Admin, LO, and processor complete a simulated working day; interrupted or repeated actions recover safely; managers can resolve unowned and overdue work. |
| 3. Make the brokerage configurable and observable | Version routing, checklists, templates, deadlines, supported stage mappings, and role capabilities. Explain how changes affect in-flight work. Reconcile workload, aging, response, conversion, and funding reports. Handle corrected dates and changed terms. | Server-side filtering and aggregates; bounded reports and exports; configuration audit; permissions tested against two separate brokerages; safe schema/config migrations. | Two brokerages can use different supported configurations without forks. Every report reconciles and historical attribution survives reassignment and corrections. |
| 4. Make switching and operating practical | Rehearse import preview, duplicate decisions, source-key retry, interrupted import, reconciliation, safe correction/rollback, and usable exports. Deliver role-based setup, help, support diagnostics, and commercial/pilot terms. | Stream imports/exports; tenant-scoped jobs; test backup/restore and tenant recovery; establish retention/deletion and support-access controls. Measure cost and large-data performance. | A brokerage moves a representative fictional pipeline, reconciles it, operates it, exports it, and rehearses recovery without engineering editing its records by hand. |
| 5. Prove the business and platform | Run paired broker walkthroughs and an agreed daily-use pilot; demonstrate savings and complete supported end-to-end origination handoffs. Publish accurate product limits and availability. | Pass the capacity stages and real-data security gate below. Validate provider behavior separately and document all remaining external work. | A versioned release dossier with workflow, economic, access, recovery, load, and live-provider evidence. Only then claim readiness for the supported replacement scope. |

Increment dependencies are 0 → 1 → 2 → 3 → 4 → 5. Start instrumentation, security verification, migration discovery, and architectural bottleneck removal in increment 0 and continue them throughout. Existing verified functionality can satisfy a gate without being rebuilt. Provider onboarding can progress independently, but cannot bypass the real-data gate.

### Customer API and MCP workstream

The [customer API and MCP roadmap](PRODUCT-ROADMAP.md#customer-api-and-mcp) is required planning scope. Deliver one shared service and permission layer with two supported external interfaces: a versioned customer API and an MCP server. Track contracts, authorization, read tools, write tools, and client verification independently in the capability register with owner, dependencies, evidence, and limitations.

In increments 0–2, inventory reusable scoped services, define resource contracts and delegated authorization, and verify the current protocol requirements before implementation. In increment 3, deliver a read-only fictional-data pilot for contacts, loans, conditions, tasks, deadlines, and dashboard metrics. In increment 4, add separately authorized task creation and internal notes with idempotency, attribution, and revocable admin controls. Increment 5 gates external customer release on equivalent permissions across app/API/MCP, client compatibility, security review, capacity, recovery, and support evidence. Broader consequential actions remain outside initial tool scope.

Required evidence includes two-brokerage negative tests, limited roles/scopes, expiry/revocation and staff removal, replayed writes, bounded pagination, minimized outputs, and measured automated-client traffic alongside staff workloads. Preserve mock/live labeling and the local fictional-data/no-new-spend constraints. Customer API/MCP activation and real-data use are separate from the presentation-demo milestone; plan them without delaying existing demo verification for an unvalidated external launch.

### Foundation priority and feature acceptance

The [foundation improvements](PRODUCT-ROADMAP.md#foundation-improvements-paired-with-feature-delivery) are mandatory companion work for feature delivery: bounded data access, shared-directory capacity, durable integration execution, consistent provider contracts, database upgrades/recovery, and capacity/permission evidence. Do not defer them to a cleanup phase after features are complete.

At increment 0, inventory the broad workspace read/write paths, shared directory calls, provider execution paths, and schema initialization behavior. Record measured baselines and explicit architecture decisions. Increments 1–2 establish durable execution, provider contracts, versioned upgrades, and focused data access as their dependent workflows are built. Increment 3 dashboards/search/calendar/communications must use bounded access and permission-scoped aggregates. Increment 4 proves tenant upgrade and recovery operations; increment 5 supplies the release evidence at the supported scale.

For each feature slice, add foundation dependencies to the existing capability register with owner, status, acceptance evidence, and unresolved limits. A dependent feature is not accepted until its required foundation checks pass. New screens must not expand full-workspace loading; external side effects require durable intent and reconciliation; schema changes require an upgrade/recovery test; permissions must be enforced and tested on the server. Benchmark the shared directory before choosing a partition/cache strategy, preserving revocation guarantees. Carry out changes incrementally without duplicating existing verified work or replacing working UI unnecessarily.

Use local fictional data and provider simulators within the current budget. Large hosted load tests, paid infrastructure, live provider activation, and deployment retain their existing gates. Passing local checks is not proof of target production scale.

### Increment 3 dashboard workstream

Deliver four role-based dashboards: owner/brokerage, loan officer, processing/operations, and sales/relationships. The [roadmap dashboard specification](PRODUCT-ROADMAP.md#dashboards-explicit-increment-3-deliverable) defines their initial metrics and acceptance criteria. This is required scope, not an optional reporting enhancement.

At increment 0, inventory existing reports, queues, and source events and record gaps. Build dependable ownership and lifecycle events through increments 1–2. In increment 3, define metric formulas and permissions, implement bounded query/aggregation paths, then deliver filters, saved views, targets, period comparisons, and actionable drilldowns for all four roles. Reuse verified components. Track each dashboard separately in the capability register with an owner, status, evidence, and remaining gaps.

Increment 3 exits only when dashboard totals reconcile to permission-scoped records, corrected and reopened files remain accurate, and staff can move from an insight to its authorized action. Verify cross-tenant and role restrictions on aggregate counts as well as records. Include dashboard requests and concurrent refreshes in the capacity stages and apply the same service gates. During increment 5, measure whether these views reduce time to identify and resolve brokerage work. Configurable widgets, scheduled summaries, and a report builder are later expansion; no new paid service is required for the initial local fictional-data implementation.

### Brokerage operations workstreams across increments

The eight [brokerage operations workstreams](PRODUCT-ROADMAP.md#brokerage-operations-required-workstreams) are required planning scope: unified communications, calendar/deadlines, collaboration, global search, financial visibility, operational oversight, business administration, and automation controls. Their roadmap table defines initial scope, acceptance, and increment mapping. This extends the existing sequence rather than creating a competing backlog.

At increment 0, inventory each against current code and verified behavior; assign an owner and explicit gaps. Prioritize communications, calendar, collaboration, and global search with the dashboards, building on lifecycle and queue foundations in increments 1–2. Build automation observability and recovery with those foundations. Deliver financial visibility and operational oversight in increment 3 once source events reconcile; finish administration, support, and accounting/export handoffs in increment 4. Preserve the existing demo budget and provider validation gates.

Track each workstream separately in the capability register. Evidence must cover tenant/role and branch boundaries where applicable, stale and repeated events, revocation, recovery, bounded queries/jobs, and freshness. Include search, calendar, conversation queues, automation bursts, and financial aggregates in the capacity workload. Financial access must be narrower where required than ordinary loan visibility. All eight workstreams feed increment 5's owner/LO/processor working-day rehearsal; measure external steps, handling time, duplicate entry, and system switches. Existing implementation satisfies scope only when its acceptance evidence is recorded.

## Required exception suite

Run the suite across admin, LO, processor, borrower, and realtor boundaries as applicable: duplicate contact and ambiguous match; multiple loans for one person; opt-out and requested recontact; lost/reopened lead; hold/resume; unavailable or removed owner; stale simultaneous edits; changed quote assumptions; document revision after delivery; reopened condition; corrected funding date; repeated/out-of-order events; interrupted import/export; expired/revoked link; failed save; provider outage and replay. Define the expected actor, record state, history, task state, and recovery action for each case.

## Capacity design target

**User requirement: 40,000 daily active users across 18,000–25,000 shops.** For initial modeling, treat DAU as authenticated staff performing meaningful work in a rolling day. Count borrowers, realtors, APIs, and jobs separately. Confirm this definition with product telemetry; do not silently include these audiences in the staff budget.

At that ratio there are about 1.6–2.2 daily active staff per shop on average, not a maximum seat count. Large shops, uneven activity, and dormant tenants must be modeled independently. The system must not rely on every shop being small.

### Initial workload hypothesis

These are engineering test inputs, not measured behavior or forecasts. Replace them with observed pilot usage and rerun the budget before expanding admission.

| Input | Initial assumption and derivation |
| --- | --- |
| Staff usage | 40,000 DAU × one hour of active use over a ten-hour business window = 4,000 average concurrent active sessions. |
| Peak concurrency | A 3× peak factor = 12,000 concurrent staff sessions. Separately exercise 40,000 simultaneously connected but mostly idle sessions if realtime connections are introduced. |
| Staff request rate | One foreground request per ten active-session seconds at peak = 1,200 requests/second. Count actual network requests and internal calls, not button clicks alone. |
| Portal and background allowance | Initially add 300 requests/second for borrower/realtor activity and 500 equivalent jobs/requests per second for background work: 2,000 combined operations/second. Test CPU-heavy jobs separately; these units are not interchangeable in cost or capacity. |
| Burst and headroom | Test 4,000 combined operations/second for a five-minute burst. Separately test a 2× population envelope of 80,000 DAU / up to 50,000 tenants under the same usage assumptions; this is a headroom test, not a launch commitment. |
| Work mix | Start foreground testing at 80% reads / 20% writes; include login, queue, search, detail, save, and report actions. Exercise imports, exports, documents, and provider callbacks as separately measured workloads. |
| Tenant distribution | Include 18,000 and 25,000 provisioned-tenant runs; spread normal traffic realistically and direct 20% of load at the busiest 1% of tenants in a skew test. Verify unrelated shops retain their service levels. |
| Data size | Start with small-shop fixtures of 5,000 contacts / 500 lifetime loans / 10,000 history events; heavy-shop fixtures of 100,000 contacts / 10,000 lifetime loans / 250,000 events. Record actual encoded bytes, indexes, document sizes and retention. These are fixture classes, not a claim that every shop has this volume. |

Avoid fixed polling that multiplies idle sessions into uncontrolled traffic. Model overlapping browser tabs, login bursts, background deadlines at the same time of day, growing history, cold tenants, imports by many shops, and repeated callbacks during provider recovery. Document the geographic distribution and network conditions used for each result.

### Architecture decisions to make early

| Area | Required design decision and validation |
| --- | --- |
| Brokerage data boundary | Preserve per-brokerage isolation. The current SQLite Durable Object per brokerage is a starting point, not evidence of capacity. Benchmark single-tenant contention and storage growth; document when and how a large tenant would be partitioned, archived, or migrated without breaking identifiers and permissions. |
| Shared identity/directory | `src/worker.ts` and `src/lib/hosted-workspace-service.ts` route directory and membership checks through `getByName(demoBrokerageId)`. Treat this shared object as a candidate bottleneck and failure concentration. Evaluate partitioned identity/directory access and bounded caches with explicit revocation semantics; measure before selecting the design. |
| Reads and browser state | Current `loadWorkspace`/`readWorkspace` paths load broad workspace state. Move toward scoped paginated reads, indexed queries, incremental updates, and bounded responses. Enforce permissions before fetching/serializing unnecessary records. No full contact/history reload after every mutation. |
| Background work | Queue imports, exports, provider reconciliation, scheduled follow-up, scanning and large reports. Persist accepted work, use idempotency keys, retries with backoff, dead-letter handling, replay, per-tenant fairness and explicit job states. User requests must not wait on unbounded jobs. |
| Files and reports | Keep document bytes out of transactional state. Stream bounded uploads/downloads, scope authorization to current tenant/record/revision, and isolate scanning work. Keep analytical workloads from blocking loan edits; use reconciled aggregates or separate read models when measurements require them. |
| Resilience and rollout | Define timeouts, backpressure, provider circuit breaking, tenant admission limits, resumable jobs, canary deployment, schema compatibility, and rollback. A failing tenant or provider must not create a platform-wide retry storm. |
| Telemetry and economics | Measure latency/error/queue lag, payload sizes, storage, CPU, provider traffic and costs by operation and tenant class without logging sensitive borrower content. Report cost per active brokerage, staff DAU, and funded loan; include inactive-tenant overhead. |

Cloudflare documents each Durable Object as a single-threaded instance with its own storage; adding many tenant objects does not remove contention in a shared object. Its currently documented SQLite storage limit is 10 GB per object. Check current limits, account quotas and costs before each capacity decision; never translate a provider limit into an application throughput claim. Sources reviewed 2026-11-08: [Durable Object design rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), [platform limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

### Proposed service and recovery gates

These are internal targets to validate and refine with workload evidence, not published SLAs.

- Routine authenticated reads: p95 ≤ 500 ms and p99 ≤ 1.5 seconds server response; routine writes: p95 ≤ 1 second and p99 ≤ 2 seconds, excluding clearly separated external-provider completion.
- Usable daily queue within three seconds at p95 on the declared reference device/network. Reports and long jobs may complete asynchronously, with progress and a defined timeout.
- Application failure rate below 0.1% under the admitted normal load. Report validation errors, enforced rate limits and provider failures separately so they cannot hide platform failures.
- Operational reminders ready within 60 seconds at p95 under normal load; settle a tested five-minute burst backlog within 15 minutes without starving unrelated tenants.
- Initial availability objective of 99.9% monthly for core staff workflows, with independent monitoring, incident ownership, and an error-budget policy for stopping rollout.
- Acknowledged writes survive process restarts and replay tests with no duplicate business effect. Separately target disaster-recovery RPO ≤ 15 minutes and RTO ≤ four hours for a tenant; verify actual backup coverage and document exclusions. Do not equate ordinary persistence with disaster recovery.

### Capacity stages and admission

| Stage | Exercise | Evidence required to advance |
| --- | --- | --- |
| C0: baseline | Representative small and heavy tenants, contention, cold starts, repeated actions, tenant-isolation negatives. | Reproducible fixture and request mix, traces, identified bottlenecks, instrumented unit-cost baseline. |
| C1: controlled pilot | Synthetic 1,000 DAU / 500 tenant envelope, morning login and background-job bursts. | Meet proposed latency/error gates; working backpressure and alerts; recover jobs and tenant data in a drill. |
| C2: growth | Synthetic 10,000 DAU / 5,000 tenant envelope with skew and simultaneous migrations. | No shared-directory bottleneck, bounded reads, tenant fairness, storage-growth and cost forecast, canary/rollback rehearsal. |
| C3: target | 40,000 DAU equivalent workload, both 18,000 and 25,000 tenant distributions, 12,000 peak active sessions, burst test and 24-hour soak. Include portal traffic and background work. | All gates pass on production-equivalent configuration; reconciliation after load; failure-injection and restore evidence; support and infrastructure budget accepted. |
| C4: headroom | 2× population and bottleneck-focused overload/failure tests. | Documented maximum tested envelope, safe overload behavior, partition/upgrade triggers, and rollout limits. |

Scale synthetic tests in a dedicated environment with fictional data and provider simulators. Obtain a cost budget before large runs; never aim a load generator at production or third-party providers by default. Advance customer admission only within the demonstrated envelope. Before each rollout, record users/tenants admitted, maximum per-tenant size, observed headroom, current vendor quotas, and stop/rollback triggers.

## Security and real-data gate

Security is part of every increment. Before real borrower data, verify server-side tenant and role authorization for every read, write, search, report, export, job, and file; borrower/realtor record scoping; invitation and session revocation; staff removal; support access; credential handling; private-file access and scanning; data minimization; retention and deletion; audit events and correction history; backup/restore; incident response; dependency and application vulnerability triage. Include direct API negative tests, not just hidden UI controls.

Define stronger authentication and session requirements for privileged staff, auditable support access with an expiration, and administrative action review. Pin roles to capabilities and test changes during active sessions. Mask sensitive data in logs and diagnostic bundles. Validate credential rotation, access revocation, deletion propagation to derived stores, and recovery without crossing tenant boundaries.

Exit evidence: reviewed access matrix, threat model, automated negative tests, security review findings with owners/dispositions, recovery drill, documented retention/deletion and support procedures, incident contact, and an explicit real-data release decision. No unresolved critical access or data-loss defect may be waived by a feature deadline. This is an engineering gate, not a claim of regulatory certification.

## Feature and business release gates

**Fictional pilot:** core scenarios and exception suite work with fictional data; limitations are visible; feedback has an owner and retest result. Do not represent simulated external outcomes as live.

**Daily CRM adoption:** at least two design partners complete the agreed day from Orbit, including follow-up and management intervention. Evaluate the north-star targets for time, re-entry, queue adoption, and report reconciliation. Model real communication capture separately from manually logged demo events.

**Brokerage replacement:** daily CRM gate plus migration/cutover and recovery evidence, suitable capacity stage, real-data security gate, validated live origination requirements for the supported business, economic evidence, and an operational support plan. Credit/AUS, pricing/locks, disclosures/signatures, and lender handoffs are explicit required capabilities for relevant workflows, not automatically optional because an older document called them expansion. Any permitted manual handoff is listed and included in the benchmark and cost calculation.

Commercial gate: define seat/role entitlement, pilot boundaries, pricing, provider charges, onboarding responsibilities, support coverage and escalation, data export/offboarding, and customer-facing availability claims. Support scale must be modeled at 18,000–25,000 shops, including tenant provisioning, training, password/access issues, and incident communication. Prefer self-service with clear recovery over routine engineering intervention.

## Release dossier and immediate handoff

Every release dossier records the source revision, deployment ID, supported audience and workflows, capacity envelope, security evidence, benchmark results, economic assumptions, remaining handoffs, known limits, responsible owners, rollout/canary steps, rollback and recovery plan, and decision. Until evidence exists, mark the gate **not verified**.

Close each verified development cycle with a deployment to OrbitLOS.com, a public product update for that cycle, and a live check of the affected pages and workflows. Record the deployment version and whether each workflow was verified locally or in the hosted fictional pilot. Keep the existing hosting budget and separate release decisions for real borrower data and live providers.

Next actions for the existing implementation effort:

1. Map current gap work to increments 0–4; preserve completed work and identify the next unverified scenario rather than starting a duplicate feature build.
2. Record the capability baseline and the five paired walkthroughs; add the exception suite to acceptance evidence.
3. Measure shared-directory calls, whole-workspace payloads, and busy-tenant query time. Produce architecture decisions for the identified bottlenecks before committing to the C1/C2 envelope.
4. Establish the role/tenant negative-test suite and recovery drill alongside daily-queue work.
5. Name gate owners, choose design partners, and collect actual tool costs and workload observations. Use those to revise assumptions and prioritize by broker value.

No implementation changes, production migrations, capacity tests, additional staffing, or commercial commitments are authorized merely by the existence of this planning document.
