# Sandbox CRM events contract

The event payload uses the same version 1 shape as Orbit's simulated automation deliveries. The sandbox implementation reads a fixed fictional feed. It has no dependency on the staff pipeline, borrower data, or a lender.

## Pagination

Send `limit` as an integer from 1 to 50. The default is 20. Send `after` as the last `nextCursor` received. Each page returns `mode: "sandbox"`, `events`, `nextCursor`, and `hasMore`. Process events in the order returned. When `hasMore` is false, keep the cursor for the next poll. An empty page returns the same cursor. Retry the same cursor after an interrupted read and deduplicate by `eventId`. Invalid, duplicate, and unknown parameters are rejected. An unknown cursor returns an error so a poller can avoid silently losing its position.

The fixture covers realtor lead creation, 1003 submission, funding, funding date correction, and funding reversal. The three funding events share a fictional loan reference with increasing revisions.

## Hosted sandbox

A fictional pilot admin opens **Integrations → Partner permissions**, approves a grant with **CRM events**, and issues a credential from that grant. Copy it before leaving the detail. Orbit keeps a hash and issue metadata. If the response is interrupted, refresh the grant and replace the credential. Replacement disables the previous value immediately. Credentials are restricted to fictional pilot workspaces.

Request `GET /api/sandbox/v1/events?limit=2` on OrbitLOS.com with the credential in the `Authorization: Bearer` header. Keep it in your client's secret storage. Orbit resolves the workspace from the credential binding and checks the current grant, expiry, approving admin membership revision and workspace maintenance revision on each read. A workspace pause blocks the feed. After reopening, replace credentials issued under the prior maintenance revision. Revocation and expiration require a new grant.

Responses use private, no-store caching. A recognized credential receives an `Orbit-Receipt-Id` header for allowed reads, rejected paging parameters and grant denials recorded in the pilot workspace. The grant detail shows the latest 20 receipts and the workspace keeps the latest 100 per grant. Receipts include the time, decision and event count. They contain neither the credential nor the returned payload.

- **200** returns a page.
- **400** identifies invalid paging parameters or a missing checkpoint.
- **401** means the credential is missing, unknown, or replaced.
- **403** means the grant or workspace is unavailable.
- **405** means the endpoint accepts GET.
- **429** limits recorded requests to 30 per grant per minute. Honor the `Retry-After` header.
- **503** means Orbit could not complete the read. Retry the current checkpoint.

This contract is for fictional data. Real CRM data and external delivery need a separate approved contract and acceptance pass.
