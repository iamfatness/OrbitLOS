# OrbitLOS: one workspace to run the brokerage

Updated: 2026-11-08. This is the shared product direction for ongoing implementation. It does not certify current capabilities or assign a second agent to work already underway.

## The outcome

OrbitLOS is the mortgage broker's single pane of glass: one place to find the client, understand the file, do the next action, manage the team, and grow the next relationship.

The business case is measurable: reduce software overhead, repeated work, and time spent coordinating the business. A broker should be able to run the agreed daily workflows in Orbit without maintaining a second operational spreadsheet or CRM. External providers can remain behind the scenes; one workspace does not require rebuilding every specialized service. Any required external step must be explicit, retain context, and reconcile back into the same record.

**Every loan. Every relationship. In Orbit.**

Start with UWM-heavy independent wholesale brokers and small teams. Design for a broader mix of brokerage sizes without making the small-shop experience complicated. Initial supported workflows are lead intake, qualification and follow-up, origination, processing and closing coordination, partner relationships, retention, and team management. Do not imply that Orbit replaces general accounting, payroll, or every lender portal.

## Three pillars, one customer outcome

| Pillar | Product commitment | Evidence required |
| --- | --- | --- |
| Capacity | Stay responsive, reliable, and economical at **40,000 daily active staff users across 18,000–25,000 brokerages**, plus borrower and realtor traffic. | Measured workload, tenant-level and platform-level load tests, failure recovery, and cost reports. DAU is not peak concurrency. |
| Security | Keep each brokerage's information isolated, give people only the access they need, and preserve a recoverable history. | Positive and negative access tests, revocation tests, document lifecycle checks, audit completeness, restore drills, and an incident response owner. |
| Features | Let brokers complete the work of running the business, rather than merely storing records across disconnected screens. | End-to-end broker walkthroughs, actionable daily queues, reliable exceptions, migration reconciliation, and demonstrated reduction in duplicate work. |

A release must satisfy all three within its declared audience and capacity envelope. More features do not compensate for lost data, cross-brokerage access, or unacceptable latency. Scale readiness does not compensate for a workflow brokers cannot finish.

## What makes this worth switching to

1. **One relationship history:** preserve the person, source, consent and outreach preferences, partners, previous loans, conversations, and commitments across conversion, reassignment, and repeat business. Distinguish contact ownership from ownership of an individual loan.
2. **One actionable day:** unite prospects, applications, documents, conditions, callbacks, closing work, and retention into an owned queue. Show why each item matters, its due date, blocker, and the action that resolves it.
3. **One management view:** show workload, response times, aging, conversion, and production; let managers intervene without chasing staff or reconstructing facts in a spreadsheet.
4. **Continuity through exceptions:** handle duplicates, opt-outs, changed terms, staff absence, lost and reopened files, corrected dates, stale edits, and interrupted operations without losing the story or silently duplicating work.
5. **A practical switch:** migrate and reconcile useful records, teach each role its daily workflow, provide support and recovery, and allow usable exports. Savings must include transition and support costs.

ARIVE is the origination benchmark; the brokerage's actual LOS + CRM + spreadsheet workflow is the comparison baseline. We will differentiate through observed workflow and economic outcomes, not claim uniqueness for generic all-in-one functionality.

## How we measure value

These are proposed internal validation targets, not customer promises or results already achieved. Establish the baseline before testing and record any target change with its reason.

| Measure | Initial validation target |
| --- | --- |
| Complete the job | All agreed critical scenarios finish with no lost work, unauthorized disclosure, or unresolved blocker. Every required external action is recorded. |
| Administrative effort | At least 25% lower median staff handling time across the paired core-workflow suite; investigate any scenario that becomes slower. Exclude provider waiting time from staff handling time and report it separately. |
| Repeated entry | At least 50% fewer repeated field entries across the paired suite. Track system switches separately, including external handoffs. |
| Daily adoption | At least 90% of agreed operational queue actions completed in Orbit during the evaluated pilot period; report excluded workflows explicitly. |
| Broker economics | Positive projected net monthly savings for each target customer profile, with every retained subscription and fee included. No savings claim until production usage substantiates it. |
| Manager trust | Every displayed count and conversion result reconciles to authorized source records, with metric definitions visible. |

Monthly value = removable subscription cost + staff hours saved × the brokerage's supplied loaded hourly cost − Orbit price − incremental provider costs − incremental administration/support cost. Show cash savings separately from the value of time freed; they are not the same thing. Report one-time migration/training cost and payback separately. Do not count unproven extra closings as guaranteed savings.

Use at least two design-partner brokerages and the same people and fictional scenarios in both systems for initial paired walkthroughs. This is directional pilot evidence, not a statistically representative market claim. Follow with an agreed observation period after the real-data gate passes.

## Shared delivery rules

- The current implementation agent continues closing gaps. Map that work to the gates in [the delivery plan](DELIVERY-PLAN.md); verify existing behavior before creating duplicate work.
- Distinguish **planned**, **present in source**, **verified in a fictional pilot**, **verified with a live provider**, and **released for real borrower data**. A screenshot or merged change is not release evidence.
- For every meaningful change, record the broker outcome, acceptance scenario, permission boundary, tenant and load impact, operating cost impact, and test evidence.
- Keep pilot, daily CRM adoption, and full brokerage replacement as distinct milestones. Mock success does not establish live reliability.
- Capacity and security work start alongside feature development. They are not cleanup phases after launch.
- Defer speculative AI, broad enterprise customization, unrelated back-office modules, and additional provider breadth when they delay the core daily workflow or the three release gates.

See [the roadmap](PRODUCT-ROADMAP.md) for the sequence, [the delivery plan](DELIVERY-PLAN.md) for evidence and scale assumptions, and [the product brief](PRODUCT-BRIEF.md) for workflow scope.
