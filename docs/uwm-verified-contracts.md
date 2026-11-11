# UWM authenticated contract review — November 10, 2026

The portal was accessible after John signed in. These are verified request contracts, not evidence of a successful live loan operation.

| Operation | Verified behavior |
| --- | --- |
| [Create transaction](https://developers.uwm.com/portal/loan-origination/docs/88) | POST with no body. Require successful envelope and transaction ID, URI and filename. |
| [Scan](https://developers.uwm.com/portal/loan-origination/docs/161) | Requires entityId and contactId. `success: true` alone does not establish readiness. Orbit requires `UpdateUploaded` and no returned correction fields before reporting ready. |
| [Commit](https://developers.uwm.com/portal/loan-origination/docs/91) | POST with no body. Acknowledgment is not completion; retain transaction identity. Callbacks use `Completed` and `NotCompleted`; null status is retained for review. |
| [Broker associations](https://developers.uwm.com/portal/loan-origination/docs/86) | User-authorized response provides root entity and branches, each with contacts. Never infer a branch/contact from the Orbit workspace or use pricing credentials as a user grant. |
| Condition upload (portal document 75) | Empty POST reserves a SAS URI/document ID; a separate binary POST uploads to that URI. This differs from the XML import PUT. Storage origin must be independently configured as `UWM_DOCUMENT_STORAGE_ORIGIN`; the actual method/origin still require a stage upload test. |
| Attachments (portal document 76) | PUT with attachments, documentType/comments/files/conditions and attachmentId/revisionId. New attachment ID is null or zero with null revision; existing attachments require current revision. A submitted attachment cannot be modified. |
| Condition submission (portal document 77) | POST omits attachmentId/revisionId. A 200 can contain errors; 422 can describe partial results. Orbit requires exactly the requested document types and no errors. Otherwise preserve unknown outcome; do not retry automatically. |
| [Lock](https://developers.uwm.com/portal/products-and-pricing/docs/93) | Float first. Requires selected product, calculation/price/rate/cash, commitment and fee/escrow/compensation options. A response describes the lock request; never treat arbitrary 2xx as a confirmed rate lock. |
| [Extension](https://developers.uwm.com/portal/products-and-pricing/docs/95) | Full pricing selection plus isQuickLock; not a standalone number of extra days. |
| [Cancellation](https://developers.uwm.com/portal/products-and-pricing/docs/96) | PUT with no body. Example ItemId is numeric although schema says string; do not rely on that field without stage confirmation. |

Document types are not condition categories. Signed upload URLs and borrower payloads must not appear in logs. Live operation routes remain disabled pending validated MISMO generation, configured user access and real stage acceptance; the transport helpers are not a finished submission or lock workflow.

For callbacks, document 119 explicitly allows a null outstanding satisfaction date despite the email's general non-null statement. Document 121's examples omit the loan number despite the email saying it is included. Preserve receipts and resolve these discrepancies using real synthetic deliveries before automatic condition/status updates. ULAD mapping still requires Phil's sample.
