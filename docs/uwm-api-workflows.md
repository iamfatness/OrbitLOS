# UWM outbound API workflows

Implemented November 11, 2026. These are authenticated backend workflows, separate from the existing simulated pricing and loan-action screens. A successful local test is not UWM certification. Production personal sign-in, approved upload origins, actual lender deliveries and end-to-end stage acceptance remain required.

## Orbit endpoints

Both endpoints require the current Google staff session, the explicit brokerage query parameter, same-origin requests, and `Content-Type: application/json`. The server chooses the configured UWM environment; callers cannot select another host, brokerage or bearer token. Only the configured non-pilot workspace can use them.

- `POST /api/uwm-file?brokerage=<workspace UUID>` performs a confirmed action.
- `POST /api/uwm-file/read?brokerage=<workspace UUID>` reads file activity, held documents/attachments, or product pricing.
- `POST /api/uwm-account?brokerage=<workspace UUID>` with `{"action":"verify"}` now validates and returns the authorized branch/contact associations, rather than accepting any HTTP success.

Every mutation contains `id` (new UUID for a new intent), `loanId`, `applicationRevision`, `confirmed: true`, and `action`. Retrying the identical request ID returns its saved state without repeating the lender call. Changing its contents is rejected. The application must still be submitted and reviewed at that exact revision. A processor may deliver documents; import and pricing actions require an administrator or assigned loan officer.

Responses include `id`, `state`, and either `result` or `error`. `Acknowledged` means the request contract was acknowledged, not that underwriting approved the loan or a rate lock is final. `Unknown` or an interrupted `Dispatching` request blocks additional writes on that loan until reconciliation. No lender request is automatically retried.

## Import

1. `prepare-import`: supply a reviewed MISMO `xml` string and `scan` with explicit branch `entityId` and officer `contactId`. An optional alternative contact is checked against that branch's returned contact list. Orbit checks current user associations before creating an empty transaction, records its ID, uploads the exact digest-checked XML, then scans it. The signed storage URL never appears in the client response or durable audit evidence.
2. The result contains `importId`, `transactionId`, `readyToCommit`, and UWM's scan fields. `amend-import` takes `importId` and a `values` array in the order of those fields. The server preserves UWM's other field metadata, including its opaque XPath; it never executes the lender's regular expression or XPath.
3. `commit-import` takes `importId` and explicitly submits a ready transaction. A changed application, wrong actor, duplicate commit or unresolved required field is rejected. UWM's acknowledgment is followed by the exact transaction/environment webhook correlation. Only a successful import callback supplies the permanent lender loan number for downstream operations.

The endpoint accepts a reviewed lender XML artifact; it does not certify Orbit's pilot XML generator or silently convert a fictional export to a production file. `UWM_STORAGE_ORIGIN` must be a separately approved HTTPS storage origin. Obtain and validate it with UWM; do not derive an allowlist from an arbitrary client URL.

## Documents and underwriting

Downstream actions derive the lender loan number from the completed import. The client cannot supply a different lender loan number.

- `upload-document`: `fileName` and base64 `content`. Reserves an upload URI, saves the lender document ID, posts exact binary bytes, and verifies the held-document list. Supports the extensions documented by UWM. The JSON request is capped at 9 MiB and base64 content at 8 MiB. `UWM_DOCUMENT_STORAGE_ORIGIN` is separately approved. UWM's timestamped filename is preserved.
- `attach-documents`: `body.attachments` uses the validated UWM contract. Files must already be held on this loan. Existing attachment IDs must match their current revision and be unsubmitted. The response must contain every requested attachment with matching files, conditions and comments.
- `submit-documents`: `attachments` contains only selected `attachmentId`/`revisionId` pairs. Orbit re-reads the current attachments and constructs the submission body itself, omitting revision/attachment identifiers as required by UWM. An outdated or already-submitted attachment is rejected. Partial responses and HTTP 422 are treated as uncertain and must be reconciled.

Uploading is not delivery to underwriting. Attachment and submission are explicit separate steps.

## Pricing and rate requests

Read pricing using `{loanId, view:"products", body:<validated pricing options>}` on the read endpoint. This uses the documented v3 lightweight product search and the connected user's permissions. It does not replace the legacy demo quote provider.

`float`, `lock`, `relock`, and `extend-lock` take the validated UWM request as `body`. `cancel-lock` takes no lender body. Required product, rate, price, compensation, fees and lock-period choices are explicit; Orbit invents no terms. Relock and extension require the full pricing body plus `isQuickLock`, rather than an extension-day-only request. A first lock requires a previously acknowledged float. Another rate mutation is blocked until the prior rate request's outcome has been checked in UWM and recorded.

The public client verifies business acknowledgments: `success:true` with empty float errors, a successful `LockSuccessFul` rate item, or the cancellation success envelope. Empty 2xx and malformed/negative responses are not success. No production rate commitment has been executed as part of implementation testing.

## Read and reconciliation

Read `{loanId, view:"activity"}` for the latest import checks and 50 request summaries, or `{loanId, view:"documents"}` for current lender documents and attachments. Access is checked against current loan assignment. Responses are private and non-cacheable.

An administrator can use `reconcile-request` with `requestId`, `outcome` (`Not applied` or `Verified in UWM`) and a 20–2,000 character `evidence` note after independently checking the lender. An active request must be at least five minutes old before it can be treated as interrupted. The staff attestation is audited and never creates a fabricated lender completion notification. A confirmed-not-applied import can be started again with a new request ID. Original IDs are never replayed.

Audit evidence retains actor, application revision, timestamps, request digest, explicit terms and reconciliation notes. XML/document payloads are represented by digests rather than copied to the audit record. Scanned correction fields remain private borrower information.

## Acceptance still required

- User's production personal UWM login (the user will complete it later).
- UWM-approved XML/document storage origins in each environment.
- UWM registers the endpoints in [webhook handoff](uwm-webhook-handoff.md) and sends actual deliveries.
- A UWM-approved synthetic stage file exercises create/upload/scan/correct/commit/callback, document upload/attach/submit, and each rate action independently.
- Actual CloudEvents loan-number location and ULAD samples before automatically applying status/date/XML payloads to borrower files.
- Loan-screen controls still use their existing manual/simulated behavior; these API endpoints do not silently enable those old buttons for live lender actions.
