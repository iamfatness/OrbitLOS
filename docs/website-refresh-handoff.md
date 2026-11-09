# Website refresh release handoff

Status: published at https://orbitlos.com. Version `26d665ca-f82f-41c1-877d-e3d6b8e14666` (copy review; supersedes `8eabfb39-2c13-4e57-a944-4c358f94ffc2`). Production build and local browser QA passed. Hosted homepage, product, integrations, demo, pipeline image, and Inter font returned HTTP 200 after publication.

The approved website copy and assets were built against the immutable app snapshot recorded in the rehearsal log.

## Changes

- Homepage: split editorial hero, current pipeline capture, lifecycle strip, owner/LO/processor stories, condition workflow, daily tools, and relationship retention.
- Product: replaced the expanding feature inventory with concise workflow sections and accurate coverage of dashboards, communications, calendar, search, finance, review, automation, and migration.
- Lender workflows: quote comparison, conditions, document requests, and closing milestones, with a clearly labeled simulated UWM walkthrough. Detailed availability remains in the capability register.
- Demo: refreshed walkthrough expectations and CTA; existing form behavior and mail destination preserved.
- Design: approved Inter/plum/lilac identity, consistent Lucide icons, quieter layouts, responsive hierarchy, and reduced-motion rule. Uses the app agent's refreshed public/marketing images.

Owned source: src/app/(marketing)/page.tsx, product/page.tsx, integrations/page.tsx, layout.tsx, marketing.css, demo/page.tsx, demo-cta.tsx, buyer-faq.tsx. No app business logic or Worker configuration changed by this website pass.

## Verification

- The website was checked against an isolated app snapshot before the combined release.
- Marketing-scoped ESLint passed.
- Homepage, product, integrations, and demo checked at 1440, 390, and 320px: no document overflow.
- Product images decoded successfully after scrolling each lazy image into view. One early bulk check encountered a not-yet-loaded lazy image; targeted decode confirmed it loads.
- Local internal-link checks returned 200. Login excluded from the link crawler because it initiates authentication.
- Browser-mocked demo-request failure retained form entries; browser-mocked success displayed confirmation. No test email sent.
- Desktop/mobile homepage visually inspected. Screenshots: .playwright-cli/page-2026-11-09T02-43-37-707Z.png and .playwright-cli/page-2026-11-09T02-44-26-642Z.png. QA scripts in the host temp folder: orbit-website-qa.js and orbit-website-functional-qa.js.

## Combined release

The app implementation agent is rehearsing the current hosted release. After that rehearsal, build current shared source with these website changes plus the verified app candidate, deploy once under the existing release process, and check /, /product, /integrations, /demo and their assets on the hosted version. Record the deployment and public check in the demo evidence. Do not deploy the isolated snapshot over newer app changes. Preserve the demo-request endpoint and its existing binding. Final app acceptance remains owned by the implementation agent.

## November 8 copy and content review

Reviewed every marketing route, metadata, navigation, shared CTA, FAQ, demo form, and address-lookup disclosure against the approved editorial standard. Rewrote sales copy around running the brokerage, moving loans forward, and retaining relationships. Removed roadmap/status inventories from sales sections. Reframed `/integrations` as lender workflows, with concise sample and simulated-activity labeling in its walkthrough. Privacy/terms retain the information needed to understand address lookup.

Shortened the form confirmation and FAQs. Mobile navigation now uses two deliberate rows with 44px action targets at 320px and 390px. The brand, self-hosted Inter, restrained plum/lilac palette, and Lucide icon family are preserved. The three established references inform hierarchy, spacing, purposeful actions, and contextual help.

Checks: marketing ESLint and whitespace checks passed; isolated Cloudflare production build passed. All five public pages fit at 1440, 390, and 320px with one h1 each. Internal links and all product images loaded. Browser-intercepted form failure preserved input; success showed confirmation without sending test email. The only console error was the deliberately intercepted HTTP 503. After the header refinement, checked 320, 390, 768, and 1440px and visually inspected the final 390px homepage. Screenshots are in the host temp folder as `orbit-copy-*.png`.

The existing app agent owns authenticated UI changes and their final release: redundant section copy, primary actions, contextual calculation/import help, and the rehearsal's document-refresh and repeat-application shortcuts. No app files were changed by this website copy release. Do not confuse website publication with completed app acceptance.

Published copy review: `26d665ca-f82f-41c1-877d-e3d6b8e14666`. Hosted five public routes, pipeline image, and Inter font returned HTTP 200. Hosted mobile browser confirmed the two-row header, no page overflow, the new lender-workflow headline, and its simulated-activity label. Final app acceptance remains with the app implementation agent.
