# Michigan pilot TRID evidence

Open an accessible Michigan pilot loan, choose **Disclosures**, then expand **TRID application and delivery evidence**. The panel appears after the application has a Michigan property state. Current loan officers and admins can record evidence on active files they can access. Assigned processors can review it.

1. Record the covered scenario, responsible Loan Estimate sender, creditor and documented office calendar. Confirm the file fits the pilot assumptions of a covered closed-end consumer mortgage, one required disclosure recipient and no timing exception.
2. Record the local date and evidence reference for each of the six submitted elements. Use the underlying intake evidence, including dates before a 1003 submission if applicable. Record references, never borrower values. The sixth receipt date starts the calculated application timeline.
3. Record each send with its exact disclosure version, sender, delivery method and evidence reference. Electronic delivery requires a consent reference. Record actual receipt against the same version. For mailed initial CDs, the panel shows presumed receipt until actual receipt is entered. Other delivery methods require recorded receipt for the CD comparison.
4. Enter the planned consummation date and review the individual checks. Record corrected CDs as separate versions. They surface a review item for whether a new waiting period applies. To correct an evidence entry, withdraw it with a reason and record the replacement. The earlier record stays in history.

The three-day initial LE send check uses the entered office calendar and its exceptions. Insufficient calendar coverage leaves the due date unresolved. The seven-day LE and three-day CD intervals use the precise business-day definition, including Saturday and excluding Sundays and federal legal holidays on their statutory dates. The timing comparisons assume the standard covered scenario and do not authorize closing. The panel tracks staff attestations and evidence references. Automatic import, live delivery verification, electronic receipt presumptions, multiple recipients, timing exceptions and corrected-CD restart determinations remain outside this slice. Dates use the documented Michigan Eastern or Central time zone.

Sources verified November 11, 2026. [Regulation Z §1026.2](https://www.consumerfinance.gov/rules-policy/regulations/1026/2/) and [§1026.19](https://www.consumerfinance.gov/rules-policy/regulations/1026/19/). [CFPB TRID FAQs](https://www.consumerfinance.gov/compliance/compliance-resources/mortgage-resources/tila-respa-integrated-disclosures/tila-respa-integrated-disclosure-faqs/).

Storage is an append-only loan evidence ledger with revision checks, idempotent retries and restore protection. The panel does not read credit-report identifiers or other element values. Scope is determined from the loan application's Michigan property state and staff-confirmed scenario. Current loan access and pilot membership are checked on the server for every request.

## Release acceptance

Use fictional records to verify the initial five receipts, sixth receipt, office exception, each document evidence state, date comparisons, duplicate retry, stale revision, withdrawal and role restrictions. Confirm desktop, portrait and phone layouts with a populated file and selected evidence form. Check focus, validation and retained input after an error. User and lawyer review remain required before regulatory use. Record exact production release and eligible workspace after promotion.

### Published pilot

Application `e9aae63d8fb0` is live on OrbitLOS.com as Worker `8d95d30f-09ad-4ee1-bc9b-42c7d855ceb8`. Open a Michigan file in a fictional pilot and choose **Disclosures → TRID application and delivery evidence**. Owner and LO recording and assigned processor read-only access were exercised in separate isolated browser sessions. Live verification exercised the Demo page and signed-out boundaries.

The browser pass verified the missing receipt state, corrected sixth receipt with original evidence retained, interrupted save and retry, concurrent stale change, electronic consent validation and calendar results. The built rehearsal covered the corrected Closing Disclosure review state, withdrawal, repeat request, and unrelated LO denial. See [UI review coverage](../ui-review-coverage.md). Real regulatory use remains subject to the existing owner and lawyer review.

### Intent to proceed and fee timing

1. Record receipt of the exact Loan Estimate version, then select that receipt when recording the borrower's intent to proceed. Record the date and source reference for each event. Add the local time when the sequence took place on one day.
2. Record when a fee was first imposed or a payment method was first required. Link the intent entry when the evidence supports it. Use evidence references without payment credentials.
3. Open **Intent and fee timing** to compare the recorded order. Unlinked records, missing times and ambiguous same-day order require review. A credit report fee that lacks the usual sequence is shown for exception review. The reviewer still needs source evidence that the fee was for obtaining a credit report and that its amount was bona fide and reasonable.
4. Withdrawing a receipt or intent preserves it in history and brings any dependent fee back for review. After verifying the corrected source, record replacement evidence with its original occurrence date and time.

The pilot uses documented actual receipt for this comparison and preserves staff attestations. It leaves legal review, tolerance and cure calculations, and fee authorization to their own workflows. [CFPB Regulation Z § 1026.19(e)(2)](https://www.consumerfinance.gov/rules-policy/regulations/1026/19/#e-2)

Released app `059280d5fa49` as Worker `b5097862-0963-4ffb-9539-5c3d7f366844`. The isolated rehearsal verified that a receipt or intent withdrawal reopens dependent evidence and that an in-progress edit keeps its selected reference until the operator chooses a replacement. The same-day comparison leaves ambiguous order for review. Owner and lawyer review are required for regulatory use.
