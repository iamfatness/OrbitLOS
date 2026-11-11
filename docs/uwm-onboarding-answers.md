# UWM onboarding answers — November 10, 2026

Source: Sanjay Patel's 3:59 PM ET reply, forwarded by John Wallace at 4:12 PM ET under **Fw: OrbitLOS - Credentials - Public APIs**. [Open forwarded email](https://mail.google.com/mail/u/0/#inbox/1a1c74f83b1a14e3). This note intentionally excludes all client credentials from the quoted email history.

| Topic | UWM answer | Orbit action / remaining gap |
| --- | --- | --- |
| Webhook authentication | Bearer-token webhook authentication is unsupported; UWM sends the supplied `X-API-Key` header. | Receiver and credential generator now use the raw key in `X-API-Key`. Current/previous-key rotation remains supported. A bearer-only request is rejected. Existing JSON config fields remain named `token`/`previousToken`; their values are the API keys, not OAuth tokens. |
| Payload limit | 1 MB is sufficient; XML import files are normally a few KB. | Retain the 1 MiB bound; also verify actual ULAD export samples. |
| Broker entities and API authorization | Entities/branches depend on the logged-in user. Token generation requires the supplied client credentials and the user's credentials. | Treat loan/user operations as user-authorized. The earlier successful client-credentials stage pricing/disclosure checks do not prove access to user-scoped loan operations. No user credentials were supplied in this reply. |
| Import outcomes | UWM refers to portal document 91 for success and failure contracts. | Authenticated portal verified: `Completed` / `NotCompleted`; nullable loan number and status. Real stage deliveries remain pending. |
| Dates/status correlation | The response payload includes the loan number; UWM points to document 121. | Loan number presence is confirmed, but exact casing, type and location have not been verified. Preserve the full body; do not guess a mapping. |
| Conditions | Fields are non-null. Events are exported on condition creation and modification. | Authenticated document 119 contradicts the email: outstanding `conditionSatisfactionDate` is explicitly null. Receiver now preserves null and string dates; other fields remain non-null. Clarify the discrepancy and obtain ordered clearance/reopen samples. |
| ULAD samples | Phil Abraham can supply sample XML export files. UWM checks for duplicate loans on its side. | Await Phil's sample. UWM duplicate-loan checks do not replace Orbit webhook deduplication or justify overwriting a local application. |
| Delivery/retry policy | UWM refers to import response codes in document 91. | Retry intervals, timeout, replay, retention, stable delivery IDs and ordering remain unanswered; response codes alone do not establish those policies. |

The email confirms receipt of our URLs, not completed registration or successful delivery. It contains no webhook API key, synthetic event payload, or ULAD attachment (only inline signature images). Dedicated keys still need configuration and secure delivery to UWM after brokerage setup. No reply was sent from Orbit during this review.

Follow-up content and current endpoint URLs are in [the UWM handoff](uwm-webhook-handoff.md).
