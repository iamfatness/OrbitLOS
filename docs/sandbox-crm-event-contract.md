# Sandbox CRM events contract

The event payload uses the same version 1 shape as Orbit's simulated automation deliveries. The sandbox implementation reads a fixed fictional feed. It has no dependency on the staff pipeline, borrower data, or a lender.

## Pagination

Send `limit` as an integer from 1 to 50. The default is 20. Send `after` as the last `nextCursor` received. Each page returns `mode: "sandbox"`, `events`, `nextCursor`, and `hasMore`. Process events in the order returned. When `hasMore` is false, keep the cursor for the next poll. An empty page returns the same cursor. Retry the same cursor after an interrupted read and deduplicate by `eventId`. Invalid, duplicate, and unknown parameters are rejected. An unknown cursor returns an error so a poller can avoid silently losing its position.

The fixture covers realtor lead creation, 1003 submission, funding, funding date correction, and funding reversal. The three funding events share a fictional loan reference with increasing revisions.

## Hosted acceptance still required

- Issue a scoped sandbox credential from an active brokerage admin approval. Keep the credential separate from the grant and client identifiers.
- Resolve the brokerage from the credential binding and apply the current `events.read` grant, expiry, approving membership revision and revocation on every page. Return a consistent authorization failure when a grant or client is unavailable.
- Preserve an audit receipt with the grant, client, time and decision. Keep raw credentials and payloads out of the receipt.
- Verify denied missing scope, expired and revoked grants, staff access change, and credentials presented against another brokerage. Verify that a repeat after revocation cannot replay a previously allowed response.
- Keep the endpoint read-only and the hosted data fictional. Real CRM data and external delivery require separate approval and verification.
