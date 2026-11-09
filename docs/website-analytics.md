# Public website analytics

Google Tag Manager container: `GTM-WGL2P6H7`.

Installed in `src/app/(marketing)/layout.tsx` using the user's supplied async loader and initialization snippet, matching Google's current installation instructions: https://support.google.com/tagmanager/answer/14847097?hl=en. The framework emits both scripts in the document head before hydration. The marketing route group covers `/`, `/product`, `/integrations`, `/demo`, and `/address-lookup`.

QA: marketing-layout ESLint and an isolated production build passed. Browser checks on all five public routes confirmed one loader, both scripts in head, the initialized gtag function, and the registered container. The container responded HTTP 200 and contains Google Analytics destination `G-XPTCCEE6SE`. No custom form-field values or borrower data are pushed by this implementation.

Publication: coordinated with the app implementation agent's next verified combined release because the last hosted app release had no matching immutable source snapshot. The old isolated build is for analytics QA only and must not be deployed over current app changes. Record final version and hosted analytics verification below.

Published November 9, 2026 in combined release `9f31d336-7ab2-4f9f-b7cc-4d5fd82d5929`. Live browser checks confirmed exactly one loader in the head, initialized gtag, and the registered container on all five public routes. Observed a homepage `page_view` to `analytics.google.com/g/collect` for `G-XPTCCEE6SE` with no failed requests. A subsequent Product page view received HTTP 204 from Google Analytics. Dashboard reporting itself was not inspected. The public-site installation is complete.
