# Workspace read baseline

Local C0 evidence for the daily queue. The task queue renders from the current workspace, and opening **Tasks** requests `refreshWorkspace`, which rebuilds and returns the entire role-scoped workspace. This baseline measures the database read, the refresh response, and when the browser displays and updates the queue.

## Reproduce the SQLite read

From the repository root, run the fixture on Node 24. It creates an in-memory database using Orbit’s schema and actual workspace read and scope functions.

```powershell
node scripts/workspace-baseline.mjs small Admin 5
node scripts/workspace-baseline.mjs small LO 5
node scripts/workspace-baseline.mjs heavy Admin 3
node scripts/workspace-baseline.mjs heavy LO 3
```

The small fixture has 5,000 contacts, 500 loans, and 10,000 activity events. The heavy fixture has 100,000 contacts, 10,000 loans, and 250,000 activity events. The fixture uses a 60/40 loan and contact history split, two officer identities, a mix of pipeline stages, and sample tasks. It omits lead imports, documents, pricing, and provider traffic. JSON byte counts are uncompressed. The LO sees roughly half the records after the database read.

## Observed on November 8, 2026

Windows localhost, Node 24.13.0, single requests. Times include the SQLite read, role scoping, and JSON encoding. The heavy admin sample before the index is a single observation. Other cells are medians of three or five reads.

| Fixture | Role | Before index | With index | Workspace JSON | Activity history |
| --- | --- | ---: | ---: | ---: | ---: |
| Small | Admin | 155 ms | 62 ms | 4.76 MB | 3.17 MB |
| Small | LO | 52 ms | 55 ms | 2.18 MB | 1.59 MB |
| Heavy | Admin | 96.40 s | 1.96 s | 110.99 MB | 79.30 MB |
| Heavy | LO | 1.71 s | 1.79 s | 51.43 MB | 39.70 MB |

The admin report computes first outreach per loan. Before the index, SQLite’s query plan showed an activity search without a supporting index inside that correlated subquery. After adding the partial index on `(loanId, createdAt)` for rows with an outreach outcome, both report branches use an indexed lookup by loan. The index applies on new and existing SQLite stores and uses the existing outreach predicate.

In the local Worker preview, the small fixture’s actual Tasks refresh returned 2.23 MB for an LO and 4.84 MB for an admin. The median response times with the index were 201 ms and 299 ms respectively across three requests with identity encoding. In one desktop Chrome run per role, the queue heading appeared 146 ms after the Tasks click for the LO and 342 ms after for the admin. The refresh finished and the control became available after 339 ms and 575 ms respectively.

The heavy fixture returned HTTP 500 on workspace entry and Tasks refresh for both roles. The local runtime rejected the serialized response at its 32 MiB RPC limit. The index reduced the read time while leaving the response size unchanged. The indexed and unindexed report queries returned identical rows on the small fixture, and the preview denied workspace entry to staff from the other brokerage.

## Next capacity check

Loan and contact timelines now load 30 events at a time when staff open the record. Queues retain the last-activity timestamps and contact follow-up rows they need to render. On the small fixture, the JSON payload dropped from 4.76 MB to 1.65 MB for admins and from 2.18 MB to 0.62 MB for loan officers. The median local SQLite read, scope, and serialization fell from 62 ms to 21 ms for admins and from 55 ms to 17 ms for loan officers.

The demo is sized for small pilot brokerages. The heavy fixture remains a design reference for separating and bounding contacts, loans, reports, and other workspace data as the product grows. The current verification is local and fictional.

## Owner funding read

The funding dashboard reads selected and previous period totals and one record page through a separate server query. The date range is capped at 366 days and pages contain up to 30 loans. SQLite used the `closing_plans_by_target` and `closing_progress_by_funding` covering indexes for date-range searches.

In a local heavy fixture with 100,000 fictional contacts, 10,000 loans, and 250,000 activity events, each loan received a target closing date and the funded-stage loans received recorded funding dates. The selected November 2026 range returned 2,994 projections and 910 actual fundings. The median of 11 synchronous reads and JSON encodes was 6.8 ms, with 30 actual records and 4,434 bytes in the response. This measures the SQLite read and encoding for one local request at a time. Authentication, network latency, and concurrent refreshes need separate measurement.

## Officer Today read

The Today view uses the signed-in owner's identity for each source, takes at most 61 candidates per source, and returns up to 20 work items with a keyset cursor. The browser does not request a workspace refresh when it opens Today. The full queue remains available for broader work.

The same local heavy fixture, with 100 added first-contact leads and 2,000 projected closing dates, returned 20 work items in 3,899 bytes. Over 11 reads and JSON encodes the median was 7.5 ms without opt-outs and 98.8 ms after adding one opt-out. The difference includes the existing alias expansion, which scans borrower contacts when opt-outs are present. Indexing contact identity aliases and measuring authenticated concurrent reads remain capacity work.

After indexing normalized contact identities, the same opt-out fixture returned 20 work items in 3,899 bytes in a median 6.5 ms across 11 local reads and encodes. The local backfill took 200 batches of up to 500 contacts and about 631 ms in total. For an older workspace, suppression still checks pending contacts until their index entries are available. Authentication, network time, and concurrent reads need separate measurement.

## Editable loan read

Processing, Today, and the funding dashboard can open an editable loan with a dedicated read. The server checks the brokerage and current ownership or processing assignment before reading the loan and its related rows. In the local heavy fixture, one assigned processor file with a mock condition and closing item returned 1,725 bytes in a median 0.39 ms across 11 reads and encodes. The measurement excludes authentication, network, concurrency, and unusually large individual files. Authenticated document, mock clearance, and closing saves can return the updated loan directly.

## Manager lead drilldown

Opening a lead from **Playbooks → Ownership and deadlines** checks the current admin and brokerage and reads the selected lead, its tasks and events, its duplicate matches, and its current campaign membership. In the local heavy fixture with 100,000 fictional contacts, 10,000 loans, 250,000 activity entries, and 10,000 added campaign leads, a lead with one contact match and one activity event returned 1,426 JSON bytes. The median of 11 warm SQLite reads and JSON encodes was 0.26 ms after contact indexing. The measurement covers a single request and excludes authentication, network, concurrency, cold backfill, and unusually large individual leads.

Today’s first-contact and campaign callback links reuse the scoped read with a current owner and task check. The LO response includes permitted contact matches and an indication that a restricted match needs review. Campaign routing settings stay scoped to admins.

## Manager processing exceptions

In the local heavy fixture with 10,000 loans, 1,000 processing assignments and 4,000 mock conditions, each manager view returned 20 rows. Median local read and JSON encode across 11 runs measured 2.47 ms and 6,897 bytes for unassigned files, 2.04 ms and 8,295 bytes for stalled handoffs, and 0.24 ms and 8,125 bytes for aging conditions. The condition index is reconciled when the lender submission changes. These measurements exclude authentication, network latency, cold upgrades, and concurrent refreshes.

## Sales conversion cohorts

The local heavy fixture included 10,000 enrollments across 100 campaigns, split evenly between the selected month and the prior period. Across 11 SQLite reads and JSON encodes, the median was 26.1 ms for the cohort totals and first 20 campaign groups, returning 4,273 bytes. The first 20 funded drilldown rows returned 5,531 bytes in 4.6 ms. The aggregate covers the requested date ranges, and the response and drilldown are paged. The measurement excludes authentication, network latency, and concurrent refreshes.

With a 30-day observation window and dated call events, the same-size fixture returned the first 20 campaign groups and both cohort totals in a median 59.5 ms and 4,844 bytes. The first 20 funded records took 9.4 ms and 6,311 bytes. The fixed-window reads include Eastern day boundaries and exclude recent leads from conversion totals. These are single-request local measurements.

## Conversation queue

The local heavy fixture included 10,000 fictional loan conversations. The first 20 admin rows returned in a median 0.14 ms for Active, 0.15 ms for Unread, and 0.18 ms for Follow-up due across 11 SQLite reads and encodes. Responses ranged from 6,669 to 6,773 bytes. Conversation history also pages 20 entries at a time and rechecks current loan and participant access. These measurements exclude authentication, network latency, and concurrent refreshes.

## Workspace calendar

With 10,000 fictional loans, 250,000 activity entries, and 2,000 closing targets with matching checklist dates, the first 20 items returned in a median 8.10 ms for My calendar and 2.52 ms for the Brokerage calendar across 11 local reads and JSON encodes. Response sizes were 4,422 and 4,412 bytes. The test selected all work types for one Eastern week with active callbacks and closings. These measurements exclude authentication, network latency, opt-out backfill, and concurrent refreshes.

## Workspace search

The heavy fixture produced 112,000 searchable records from 100,000 fictional contacts, 10,000 loans, and 2,000 tasks. Resumable backfill finished in 501 calls in the in-memory harness. Each call reads up to 200 older rows per source type and reindexes up to 250 changed rows. Across 11 warm SQLite reads and JSON encodes, an address match took a median 2.15 ms and returned 202 bytes. A contact email match took 7.10 ms and returned 197 bytes. The broad `Fictional` query returned 20 rows in 175.53 ms for an admin and 146.80 ms for an LO. These timings exclude authentication, network latency, concurrent writes, and hosted storage costs.

## Concurrent authenticated reads

Build the Worker and run the local Miniflare harness on Node 24.

```powershell
npm run build:cloudflare
node scripts/workspace-concurrency.mjs
```

The harness uses one heavy and three small fictional brokerages in separate local SQLite objects. It seeds synthetic sessions, restarts the runtime, and calls the built Worker's actual Today and editable-loan actions over loopback. It validates the returned borrower and record scope. The warm runs alternate queue and loan reads, with an even spread and an 87.5% concentration on the heavy brokerage. The local wrapper supplies fixtures and counts directory calls. Google, providers, and the public site receive no benchmark traffic.

Observed November 8, 2026 on Windows, Node 24.13.0. Times are local response latency in milliseconds. Each burst phase is ten rounds of 32 requests. The serial phase uses 15 requests per action.

| Phase | Today p50 before → after | Today p95 before → after | Loan p95 before → after | After p99, Today / loan |
| --- | ---: | ---: | ---: | ---: |
| Serial heavy | 13.7 → 10.8 | 15.4 → 15.2 | 7.8 → 5.4 | 15.2 / 5.4 |
| Even spread | 177.2 → 135.4 | 182.4 → 142.9 | 182.5 → 142.9 | 143.2 / 143.3 |
| Hot brokerage | 248.0 → 182.9 | 296.7 → 266.6 | 296.7 → 266.5 | 267.4 / 267.3 |

Each ordinary request made two directory calls before the change and one after it. The merged lookup rechecks session expiry and current memberships on every request. The separate PDF download recheck remains part of that workflow. Combining the directory calls alone did not improve burst latency in two intermediate runs. SQLite query plans showed that the Today branches for loan tasks, documents, closing items, and loan conversations visited loans before checking deadline indexes. They now skip empty deadline ranges and use the deadline index first for small candidate sets. Dense ranges retain the owner-first plan. In 20 interleaved SQLite comparisons, the heavy queue median moved from 8.14 ms to 4.20 ms. With 50,000 other-owner deadlines it moved from 8.50 ms to 5.07 ms. Both comparisons returned identical queue data.

The final Worker run completed 700 measured reads with no unexpected errors. Today returned at most 20 work items and 4,027 response bytes. The exact loan response was 1,515 bytes in this fixture. The first heavy and small queue requests after restart took 271 and 58 ms, with the directory already warmed by the session check. Cross-brokerage requests, mismatched action scope, forged staff headers, anonymous requests, and revoked memberships yielded no borrower data. A separate brokerage remained readable after revocation.

These measurements cover the local read workload. They exclude browser rendering, hosted network latency, sustained traffic, concurrent writes, portal traffic, and provider calls. The proposed capacity gates still require those measurements.

## Concurrent loan saves

After building the Worker, run `node scripts/workspace-concurrency.mjs --writes` to exercise the authenticated loan actions in local Workerd. The harness seeds distinct LO and processor sessions and gives both access to a shared fictional loan.

| Heavy fixture | Response bytes before → after | Local median ms before → after |
| --- | ---: | ---: |
| LO closing-item save | 12,544,361 → 2,364 | 657.9 → 7.4 |
| Processor closing-item save | 2,778 → 2,034 | 494.5 → 7.0 |

Each median uses three warm serial saves. Two edits using the same revision produced one accepted save and one stale conflict. Retrying the winning edit returned the same revision. Separate closing-item and document-review edits both persisted, and an unrelated LO was denied. The loan dialog can refresh the current file after a stale save without reloading the workspace. The timings cover the local Worker and authentication over loopback.

## Concurrent mixed staff work

Run `npm run build:cloudflare` and `node scripts/workspace-concurrency.mjs --mixed`. This mode uses the same four isolated fictional brokerages and sends the actual Today, Calendar, exact and broad Search, Communications, and owner Financials actions. The heavy fixture has 100,000 contacts, 10,000 loans, 250,000 activity entries, 10,000 conversations, and 2,000 funded ledger rows. The harness restores the synthetic staff sessions after a local runtime restart and measures index warmup separately. The heavy index took 501 bounded search requests and 5.45 to 5.68 seconds to warm in the two final runs.

Each run measures 688 authenticated reads and 10 closing saves. It starts with 48 serial heavy reads, then runs ten 32-read bursts across four brokerages. The last ten bursts add one closing edit apiece and route 27 of the 32 reads to the heavy brokerage. The LO and processor alternate saves on the same file. The figures below are loopback response latencies in milliseconds on Windows, Node 24.13.0.

| Measure | Before | Two final runs |
| --- | ---: | ---: |
| Heavy serial exact search p50 | 8.6 | 8.6–9.0 |
| Heavy serial broad search p50 | 214.5 | 21.1–21.8 |
| Heavy serial broad search p95 | 239.5 | 156.8–157.2 |
| Distributed broad search p95 | 982.6 | 257.0–267.2 |
| Hot brokerage broad search p95 | 1,157.8 | 483.6–523.5 |
| Hot brokerage Calendar p95 | 1,157.6 | 483.5–523.8 |
| Hot brokerage closing save p95 | 1,158.0 | 483.8–523.9 |

Single-prefix All records searches for admins and LOs can return the loan-first page when authorized loan results fill its page and lookahead. Other searches use the mixed result order. Matching lender references still collapse to one loan, including across a page boundary. The local improvement leaves one hot-brokerage run above the proposed 500 ms routine-read target. Broad processor search can still inspect many matches when only a few files are assigned. Workerd loopback also shares a local execution environment across the synthetic tenants. Hosted load, sustained traffic, browser time, and provider work remain separate measurements.

Each measured action used one current session and membership lookup. The harness reconciled owner financial totals, checked personal and team calendar scope, denied a forged-header request from an unrelated owner, denied cross-brokerage and revoked requests, and confirmed another brokerage kept working. All ten closing revisions persisted. Search pages were at most 3,048 response bytes, owner financial pages at most 6,280, and closing edits at most 2,537. The complete local working-day and recovery rehearsals also passed.

### Processor search and sustained staff traffic

Run `node scripts/workspace-concurrency.mjs --sustained` after building the Worker. It adds 30 serial broad searches under the heavy brokerage's processor session and a minute of continuous mixed bursts with one alternating LO or processor closing edit per burst. The final burst runs to completion. Staff actions use signed synthetic sessions. All four brokerages run on local Workerd.

For a processor with up to 32 assigned loans and up to 256 related rows, search narrows full-text matches to those loans, their borrowers and realtors, lender submissions, documents, and loan conversations. The query retains live scope and stale-participant checks before results are paged. Larger caseloads and files use the regular search. Tests compare pages across both limits, deny access immediately after reassignment, and reject historical realtor threads after the linked partner changes.

| Local workload | Before | After |
| --- | ---: | ---: |
| Serial processor broad search p50 / p95 | 152.8 / 157.4 ms | 8.9 / 10.8 ms |
| Sustained broad search p95, all staff | 494.2 ms | 226.6 ms |
| Sustained Calendar p95 | 493.8 ms | 227.1 ms |
| Sustained closing save p95 | 494.2 ms | 228.4 ms |
| Sustained actions per second | 88 | 159 |

The final 60.17-second phase finished 9,280 authenticated reads and 290 closing edits across the four fictional brokerages. All revisions persisted, authorization checks passed, and each action made one directory lookup. Across the full run, the heavy loan kept all 300 closing edits. The result covers local staff traffic with a warm search index. Hosted capacity and sustained borrower and realtor traffic are separate measurements.

On hosted release `b8548b72-598a-429d-ab2e-d37937ca0837`, the signed-in demo processor found Amelia Davis and opened her assigned Pay stub request from Search. A separate search for unassigned Olivia Parker showed no matches. The admin session was restored and the public product copy was verified. The release also passed 142 automated tests, typecheck, lint, the production build, and the complete local working-day and recovery rehearsals.

### Borrower and realtor traffic alongside staff

Run `node scripts/workspace-concurrency.mjs --portals` after building the Worker. The sustained phase adds three borrower checklist reads and three realtor milestone reads per burst. Two of each go to the heavy brokerage and the others rotate through the three small brokerages. Four borrowers attach a sample during the staff workload. The heavy realtor has 9,999 linked loans. Each page returns up to 20 milestones with separate indexed windows for linked loans and open referrals.

| Work during the 60.17-second local phase | Requests | p95 | Largest response |
| --- | ---: | ---: | ---: |
| Borrower checklist reads | 819 | 239.7 ms | 1,636 bytes |
| Realtor milestone reads | 819 | 239.2 ms | 2,152 bytes |
| Sample attachments | 4 | 237.0 ms | 1,636 bytes |
| Broad staff search | 1,456 | 238.9 ms | 3,048 bytes |
| Closing checklist saves | 273 | 239.9 ms | 4,263 bytes |

The phase completed 10,651 requests, including 8,736 staff reads. All 273 closing edits persisted, and processors saw each sample on the intended request at revision 1. A borrower link could not attach a sample to a different brokerage's request. A realtor token with a substituted brokerage prefix returned 404. The realtor payloads kept private notes and contact details out of milestone rows. Each measured staff and portal request used one lookup for its corresponding directory access check. These are local timings with a warm index, synthetic data, and sample attachments. They exclude browser rendering, real PDFs, external providers, and hosted load.

On hosted release `131da232-6648-458d-bbc3-e36f09c9e16c`, an isolated CRM import supplied 21 fictional referrals to one partner. The portal showed the newest 20, reached the single older row, and returned to the newest page with either Newer referrals or Refresh referrals. The product page copy was verified. The capture `hosted-realtor-referrals-page-two.png` is in `design-pass/roles`.

### Compact borrower status responses

The subsequent `--portals` run compared the full and compact reads of the same submitted application after a sample attachment. Both returned the same stage, timestamps, quote state, and checklist. The uncompressed response fell from 1,636 to 399 bytes, a 76% reduction on this fixture. The compact path reads application metadata and skips loading the draft. The full read remains available for initial entry and for opening a correction draft.

The 60.04-second local phase completed 10,573 requests, including 813 compact borrower refreshes, 813 realtor reads, four compact sample attachments, and 271 closing saves. Borrower refresh p95 was 241.6 ms and each compact response was at most 399 bytes. All samples and closing changes persisted. The four-brokerage test continued to deny a borrower attaching to another brokerage’s request and a realtor using a substituted brokerage prefix. The figures cover loopback staff and portal traffic with fictional data.

On hosted release `4e1818b1-bfb6-458d-ab12-1fd59e68db2d`, a fictional borrower refreshed to see a new pay-stub request and attached a text sample. After the staff member requested a correction, the same tab’s Refresh status action opened the original saved answers and the correction note. The borrower changed the requested amount and resubmitted. The pay stub stayed in review after another refresh. Public product copy was verified. Capture `hosted-borrower-status-after-correction.png` is in `design-pass/roles`.

### Campaign opt-out routing

Run `node scripts/campaign-routing-baseline.mjs 100 100 11` for 11 warm SQLite samples per case. The fixture has 10,000 leads across 100 campaigns, 10,002 contacts, and four distinct configured officers per campaign. Each sample runs the routing plan, suppression, and refill in a rolled-back transaction. The matching opt-out suppresses a shared alias and releases one slot in each of two campaigns. The unrelated opt-out releases no slots.

| Opt-out | Owners to check before → after | Modeled roster batches before → after | Local median before → after |
| --- | ---: | ---: | ---: |
| Matches two campaigns | 400 → 8 | 14 → 1 | 153.92 ms → 44.01 ms |
| Unrelated to campaigns | 400 → 0 | 14 → 0 | 148.41 ms → 28.82 ms |

Both runs routed two eligible leads for the matching case and zero for the unrelated case. The batch estimate uses the Worker’s 30-owner limit. The local medians exclude directory network calls, workspace serialization, and browser rendering.

### Campaign CSV and assignment responses

Run `node scripts/campaign-write-baseline.mjs 10000` to preview and import 100 fictional CSV rows, then assign all 100 to an active officer. The local fixture contains 10,000 existing campaign leads, 5,000 contacts, 500 loans, and 10,000 history events. The same command ran before and after scoping the server responses.

| Action | JSON bytes before → after | Local elapsed before → after |
| --- | ---: | ---: |
| Preview 100 CSV rows | 21,054,773 → 13,535 | 2,683 ms → 375 ms |
| Import 100 reviewed rows | 21,281,883 → 240,770 | 2,691 ms → 430 ms |
| Assign the 100 imported leads | 21,290,567 → 249,454 | 2,252 ms → 16 ms |

Each figure is a single SQLite run including JSON encoding. The harness checks that every imported lead gets the selected owner, all 100 deadlines are preserved, and the other campaign is untouched. The timings exclude authentication, directory and network calls, and browser work. Import validation still searches brokerage-wide contacts and open leads for duplicates.

### Selected campaign refresh

The same harness compares the previous full workspace refresh with the new selected campaign refresh. It checks that the selected campaign returns the same 100 ordered members and open leads as the full read. The other 10,000 campaign leads are outside the selected response.

| Read | JSON bytes | Local elapsed |
| --- | ---: | ---: |
| Full workspace | 21,290,542 | 2,363 ms |
| Selected campaign | 189,170 | 8 ms |

The single local run includes SQLite and JSON encoding. The selected response size still grows with the size and history of the selected campaign.

### Entering Call Campaigns

The same fixture compared entering Call Campaigns with the previous full workspace refresh. Scoped entry included the current catalog, 100 selected lead records, and the pilot admin’s intake options. The result contained the same selected queue as Refresh queue.

| Read | JSON bytes | Local elapsed |
| --- | ---: | ---: |
| Full workspace | 21,290,542 | 2,757 ms |
| Campaign catalog and selected queue | 189,687 | 14 ms |

These are single local SQLite and JSON measurements. The fixture had two campaigns and all existing leads were enrolled. The admin intake options also grow with the number of eligible unenrolled leads.

### Signed-in workspace entry

After building the Worker, run `node scripts/workspace-concurrency.mjs --entry`. The harness opens signed-in pages for all three staff roles against both fixtures. It verifies that the default page contains no seeded borrower record, then opens an owned or assigned loan through the existing scoped reader. It also checks a denied brokerage entry, the explicit Demo Guide, and the processor’s campaign-guide Tasks entry. The previous build was measured with `--entry-before`.

| Fixture | Role | Initial HTML before → after |
| --- | --- | ---: |
| Heavy | Admin | 45,979,078 → 30,505 bytes |
| Heavy | LO | 14,290,538 → 27,977 bytes |
| Heavy | Processor | 27,276 → 25,461 bytes |
| Small | Admin | 2,331,185 → 30,505 bytes |
| Small | LO | 738,510 → 27,977 bytes |
| Small | Processor | 27,276 → 25,461 bytes |

The figures are uncompressed local page responses. They exclude the scoped queue requests that follow hydration, browser rendering time, and hosted traffic. Admins and LOs open Today and processors open Processing. At this release, Pipeline and other views that depended on the full workspace loaded it on demand. Explicit guide routes retained their existing data and first view.

### Paged Pipeline

Run `node scripts/workspace-concurrency.mjs --pipeline` against the built Worker. The authenticated heavy fixture contains 10,000 loans and 100,000 contacts. The board returns up to 12 loans per stage. The list returns 30 at a time. Scope, filters, and totals apply before paging. The harness checks that the first two list pages contain 60 distinct loans, confirms LO and processor scope, and denies a request for another brokerage.

| Read | Local response bytes | Local elapsed |
| --- | ---: | ---: |
| Full workspace used by the former Pipeline | 32,438,883 | 947 ms |
| First board view | 24,294 | 56 ms |
| First list page | 11,892 | 50 ms |

These are single local Worker responses and include authentication and encoding. Search and Overdue evaluate matching records before paging. The reader still scans compact candidates within the authorized pipeline. At this release, the legacy New Lead and Edit Loan pickers still loaded the workspace on demand.

### Loan contact pickers and scoped form save

Run `node scripts/workspace-concurrency.mjs --loan-pickers` against the built Worker. The fixture has 100,000 contacts and 10,000 loans. It verifies a 20-contact page and a separately pinned selection, denies access to a different officer’s contact and to another brokerage, then saves one lead and reads the prefilled borrower application through its issued link.

| Authenticated action | Local response bytes | Local elapsed |
| --- | ---: | ---: |
| First borrower page and pinned contact | 2,202 | 4 ms |
| Exact search near the end of the contact index | 306 | 133 ms |
| Save and open 1003 | 2,296 | 14 ms |

The initial tail search took 1,332 ms because SQLite scanned the name index again for each batch. The revised cursor adds a name bound SQLite can seek on and uses the contact ID to break name ties. Search still evaluates compact contact rows for accent-insensitive matching. These are single local Worker observations.

### Paged Contacts directory and history

Run `node scripts/workspace-concurrency.mjs --contacts` against the built Worker. On the 100,000-contact, 10,000-loan fixture, the first two pages returned 60 distinct contacts. The harness verified assigned processor access, denial for an unrelated LO contact, and rejection of another brokerage. Linked loans page separately from contact activity.

| Authenticated action | Local response bytes | Local elapsed |
| --- | ---: | ---: |
| First directory page, 30 contacts | 3,877 | 4 ms |
| Exact search near the end of the contact index | 199 | 158 ms |
| Open one contact with one linked loan | 374 | 3 ms |

These are single local Worker responses. Search evaluates compact contact rows for accent-insensitive substring and formatted phone matching. At this release, CSV tools and contact saves still used the full workspace.

### Scoped contact CSV and saves

The same `--contacts` harness now previews a duplicate at the end of the 100,000-contact fixture, imports a second row, and verifies the complete 100,001-contact CSV. The preview returns flags only. Import returns a receipt and preserves the duplicate check inside the write transaction.

| Authenticated action | Local response bytes | Local elapsed |
| --- | ---: | ---: |
| Preview two CSV rows | 85 | 188 ms |
| Import one contact and skip one duplicate | 153 | 204 ms |
| Export the complete fixture | 7,200,170 | 198 ms |

CSV reads scan compact contact fields in batches. The export includes all accessible contacts independent of the current directory filter, up to 16 MB. Larger exports return an explicit error. Contact forms and CSV writes invalidate scoped reads. Per-contact duplicate review and legacy views still load the workspace when opened.

### Paged Lead Inbox

Run `node scripts/workspace-concurrency.mjs --inbox` against the built Worker. The fixture has 10,000 leads, 10,000 loans, and 100,000 contacts. The first two pages returned 50 distinct rows at the same due timestamp, with the unrelated owner's rows excluded. The harness checks an off-page lead, processor denial, brokerage isolation, and a compact claim receipt.

| Authenticated action | Local response bytes | Local elapsed |
| --- | ---: | ---: |
| First inbox page, 25 leads | 9,463 | 8 ms |
| Open one lead without prior activity | 810 | 3 ms |
| Claim a shared lead | 179 | 11 ms |

These are single local Worker responses. The overdue count covers the officer's visible inbox. The list omits contact methods and activity. The exact work record loads that lead's history, tasks, and duplicate candidates on demand. The unsigned local conversion keeps its existing full response.

### Paged active Tasks

Run `node scripts/workspace-concurrency.mjs --tasks` against the built Worker. The heavy fixture includes 50,000 deadlines assigned to another officer. The first two pages returned 40 distinct accessible items. The harness also verifies denial of the team view to an LO, brokerage isolation, and removal after a scoped completion.

| Authenticated action | Local response bytes | Local elapsed |
| --- | ---: | ---: |
| First active task page, 20 items | 4,796 | 11 ms |
| Second active task page, 20 items | 4,781 | 12 ms |
| Complete one loan task | 87 | 11 ms |

These are single local Worker responses. The initial queue supported Open, Due in 24 hours, and Overdue, with a fixed time window across pages.

### Paged task history and playbook work

Run `node scripts/workspace-concurrency.mjs --tasks --inbox`. The harness verifies 40 distinct rows across the first two history pages, newest completion first, and an officer's quiet-lead page on the 10,000-lead fixture.

| Authenticated action | Local response bytes | Local elapsed |
| --- | ---: | ---: |
| First completed task page, 20 items | 6,041 | 10 ms |
| First playbook task page, 20 items | 6,247 | 12 ms |

The paged Tasks view now includes completed work, dated holds, and playbook work. Detailed queues still reads the workspace for its combined All view and advanced loan work filters.

### Scoped Communications and milestone drafts

Run `node scripts/workspace-concurrency.mjs --drafts` against the built Worker. The fixture contains 50,000 drafts on another officer's files and 45 drafts on one accessible file. It verifies two distinct pages, assigned processor visibility, brokerage isolation, and movement from Ready to copy to Copied.

| Authenticated action | Local response bytes | Local elapsed |
| --- | ---: | ---: |
| First draft page, 20 items | 6,820 | 7 ms |
| Second draft page, 20 items | 6,820 | 7 ms |
| Copy a draft and refresh its loan | 14,087 | 13 ms |

The draft list orders equal creation timestamps by draft ID. Preview and copy use the authorized loan record. Admin template edits return only the affected template. Shared conversations and reply review retain their existing paged readers and open without a workspace snapshot.

### Paged Past Clients

A local in-memory SQLite fixture held 50,021 fictional funded loans, with 21 assigned to the selected LO. Every first page held 20 records and returned about 7.5 kB of JSON. The LO's next page held one record and the admin's held 20. The table reports one direct reader timing per view, including scoped totals and excluding browser and network time.

| View | LO | Admin |
| --- | ---: | ---: |
| All clients | 1.81 ms | 33.52 ms |
| Anniversaries | 0.96 ms | 125.40 ms |
| Rate watchlist | 0.73 ms | 35.06 ms |

The anniversary and watchlist views sort before applying the cursor. The first page includes the authorized totals across all views. Follow-up changes refresh the authorized loan, while a repeat action rechecks funding and access before opening the application. Admin anniversary sort and deep pages remain candidates for hosted measurement.

### Paged Realtors and conversion records

A local in-memory SQLite fixture held 5,000 realtors, 20,000 referrals, and 10,000 loans. The selected partner had at least 2,000 referrals. Both first pages had a usable second-page cursor. These are single reader measurements and exclude browser and network time.

| Admin read | Rows | JSON bytes | Local elapsed |
| --- | ---: | ---: | ---: |
| Realtor directory and conversion totals | 30 | 3,493 | 12.32 ms |
| Selected realtor's referral records | 20 | 4,835 | 4.54 ms |

The directory returns compact counts, with current referral link metadata loaded only for the selected partner. The conversion list and its drilldowns share the same attribution and filters. Current linked-loan records use the active loan partner. Large hosted catalogs and deeper pages remain unmeasured.

### Paged manager ownership and deadlines

A local in-memory SQLite fixture held 30,000 fictional leads, including 20,000 open leads and 1,200 overdue leads. A single direct read returned 20 exception rows in 46.38 ms and used 8,559 bytes of JSON. The second page returned the next 20 distinct rows. Timings exclude browser, network, and hosted roster lookup.

The reader evaluates current ownership and deadlines from compact candidate records. It sorts those candidates on the server and sends only the requested page. The read excludes application drafts, links, and full outreach history. Deep pages and dense mixed loan, callback, and lead workloads need separate hosted measurements.

### Paged Team assignment picker

On a local SQLite fixture with 50,000 fictional loans tied on stage time, the first 20-row page returned 4,022 bytes of JSON in 1.27 ms. The next page started with row 21, and an exact read for the last loan returned 246 bytes before adding the active roster. The timings exclude roster lookup, network, and browser rendering.

The picker returns borrower name and loan summary fields. The exact editor adds the current processing assignment and revision. Assignment actions invalidate the active queues, and the staff audit links are labeled from the visible history IDs.

### Scoped migration receipts and exact record opens

On a local SQLite fixture with 10,000 unrelated contacts, a one-row CRM import preview returned 310 bytes of JSON with the migration scope. The legacy full response returned 1,618,183 bytes. Both carried the same preview fingerprint. This measures response size. Import planning still evaluates existing records for duplicate and link checks.

Receipt links resolve the stored source and verify the expected target before opening a lead, loan, task, or evidence. The receipt reader requires an authorized admin in the active brokerage. The MISMO importer searches borrowers through the same paged picker as loan creation.

### Foreground borrower and staff handoff checks

An open staff 1003 or Conditions view checks the current application and indexed document requests for that loan every 15 seconds while visible and free of unsaved edits. An unchanged check returns 18 JSON bytes before the server action envelope. On a change, it returns the authorized single-loan record. The open submitted borrower view reads its existing status projection on the same interval. Hidden views stop scheduling periodic checks. The system uses the existing Worker, Durable Object, and SQLite store. Separate-browser timings are in the [demo rehearsal log](demo-rehearsal-log.md#separate-browser-handoffs-on-november-9-2026).

### Incoming borrower review queue

A local SQLite fixture with 10,000 assigned processing files and 12 received documents returned eight rows and a next-page cursor in 1,679 JSON bytes. The first admin read took 1.25 ms locally and started from the partial index on received documents. The newest queue page checks every 15 seconds while visible. It stops periodic reads behind an open loan drawer, and older pages stay in place. This measurement excludes server-action serialization, network time, and concurrent traffic.
