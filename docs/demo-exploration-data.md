# Self-guided demo examples

Admins in the shared Orbit demo or a fictional pilot can open **Team → Self-guided demo examples**, choose an active or already-invited loan officer/admin and optional active processor, and select **Add or refresh demo examples**. Ordinary brokerage workspaces do not expose or accept this action. Preparing an invited evaluator's examples leaves their invitation and authentication unchanged; the records become available through their normal sign-in. Review assignments use the next invitation-acceptance revision so the review inbox works on that first visit.

Each officer's additive pack contains:

- Eight linked borrower/contact/loan records across Lead, Pre-qual, Application, Processing, Underwriting, Clear to Close, and Funded.
- Six open leads, including two unassigned referrals, in a sample call campaign.
- Six appointments spread over today and the following four days, plus overdue, today, and upcoming tasks.
- Three conversations with realistic incoming replies and follow-up dates; twelve borrower/realtor communication drafts.
- Submitted applications, three processing files, document requests, closing targets and checklists.
- Two funded loans with fictional receipts, expenses, compensation and past-client rate-watch profiles.
- One requested document review and review-inbox notice when another eligible active staff member exists. A single-person workspace does not fabricate another staff identity.
- A saved three-option comparison on Olivia Parker, with a five-year horizon, $3,500 monthly budget, $120,000 cash budget and an explicitly fictional recommendation. Existing packs and edited comparisons are preserved by refresh.

The records use fictional names, `.test` emails and example addresses. Setup sends no email or text. Data flows through the existing queries and permissions, so linked navigation opens working records.

Dates are relative to the Eastern calendar date at setup. Repeating the action adds no duplicates and refreshes only unchanged, open sample deadlines and appointments. Manually edited or completed records leave the refresh set. Processor changes use normal Team assignments. The pack is independent of the presenter scenario and its reset.

Validation on November 9, 2026: four SQLite integration tests cover actual role-scoped Today, Calendar, Lead Inbox, Communications, Reviews, Processing and Finance queries, repeat loading, date preservation, permission restrictions, and the shared demo. Full regression: 269 tests passed; TypeScript and scoped ESLint passed. Hosted release and UI verification will be recorded below.

Published in combined Worker release `f6938400-5392-4057-9ea8-addafa8a5b0d`. The release owner also passed full lint, typecheck, Cloudflare build, working-day and recovery checks. Loaded the pack into the signed-in shared Orbit demo for the existing demo owner and active processor on November 9 at 8:11 AM ET. Repeated setup returned the refresh message and preserved the records.

Hosted UI confirmed: Today has twelve work items plus one incoming 1003 and one borrower reply; Calendar has a populated week agenda; Lead Inbox has six leads and opens the lead details; Processing has three assigned files; Reviews has the document-checklist review; Communications has three conversations and twelve drafts. Screenshot: `.orbit/demo-exploration-today.png`. Each additional officer can receive their own personal examples through the same Team control; shared views show the existing pack to authorized staff.
