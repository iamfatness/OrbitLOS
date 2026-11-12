# UI review coverage

Scope: internal compliance pilot, 2026-11-11. Built source `00498e79efca`; production Worker `87d41312-c616-4615-b4e9-e4af0006e991`.

| Surface | Status | Evidence and remaining checks |
| --- | --- | --- |
| Compliance → Monthly review | Verified with fictional owner | Populated entity and month, status filter and selected work at 1440, 900 and 390 px. Scheduled work, saved evidence, rejected a concurrent stale update without clearing the note, and recorded a monthly snapshot with outstanding work. Checked keyboard return and refresh focus. Screenshots: `.orbit/compliance-pilot-month-{list,detail}-{1440,900,390}.png`. |
| Compliance → Obligations | Verified with fictional owner | Selected entity and filtered empty/populated list, opened record, saved a new version, retained the earlier period, and planned one monthly review item across retries. Checked keyboard return and long labels at phone width. Screenshots: `.orbit/compliance-pilot-obligation-{list,detail}-{1440,900,390}.png`. |
| Compliance → Training & policies; Today and Processing → My training & policies | Verified for stated role and flow | Drafted, interrupted and retried save, recorded fictional review before internal publication, assigned a named course, checked failed and successful LO attempts, refreshed, revoked and retained completion evidence. Separate processor confirmed personal training access and the admin boundary. Policy acknowledgment verified by the built rehearsal. Screenshots: `.orbit/compliance-pilot-learning-{list,detail}-{1440,900,390}.png` and `.orbit/compliance-pilot-employee-assessment-{1440,900,390}.png`. |
| Public Demo and signed-out workspace | Verified staged and live | Demo scope copy, keyboard form entry and login redirect on refresh. Screenshots: `.orbit/compliance-pilot-demo-{staged,live}-{1440,900,390}.png`. |
| Workspace pause and temporary alternate visit | Verified for stated scope | App `c39629d`, rehearsal `7a6bfe7`, Worker `2be8e8e9-e6c8-4680-b762-c77d4790a776`. Fictional owner opened a scoped alternate by keyboard at phone width, refreshed it, and returned to the saved workspace after reopening. The built rehearsal checked the older alternate link and a fresh session. Paused page and public Demo screenshots at 1440/900/390 px: `.orbit/workspace-pause-panel-*.png` and `.orbit/workspace-pause-demo-*.png`. Public and signed-out routes checked staged and live. |

The owner and staff mutations ran in an isolated fictional workspace. Live verification exercised public routes and signed-out boundaries. Tests cover tenant and role checks. Course revision authoring, filing and real regulatory coverage remain outside this release.

The review used the approved Orbit design system and brand references, Impeccable, and UI UX Pro Max. It reused the accepted Orbit form, list/detail, action and feedback patterns for the 21st.dev component reference requirement.
