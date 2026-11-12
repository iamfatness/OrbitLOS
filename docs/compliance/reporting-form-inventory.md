# Reporting form inventory and implementation gaps

Researched 2026-11-11 for CS2/CS3. Michigan is the first pilot. Status: **research and implementation specification; user review then lawyer approval required before launch**. No regulatory submission, provider acceptance, or complete filing adapter is demonstrated by this document.

Read-only code scope: `src/lib/call-report-model.ts`; related UWM documentation was searched for fixture/transport context. Other data models might contain useful fields, but their existence and reporting semantics have not been certified here. This is a section-level gap analysis, not a complete line-by-line regulatory mapping.

**Orbit's existing internal CSV is not an accepted MCR, HMDA, Michigan, or other regulatory filing.** It is a review worksheet. Downloading a worksheet, passing local validation, or obtaining lender loan-import acceptance must never set a regulatory report to submitted or accepted.

## 1. MCR FV7 authority and artifacts

The [current NMLS FV7 guide](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/pubs/mcr/licensing/mcr/topics/mcrUserGuide_start-1.html) states:

- RMLA and applicable SSSF are quarterly, within 45 days of calendar-quarter end: May 15, August 14, November 14 and February 14.
- Lender/servicer FC is quarterly with RMLA; broker FC is annual within 90 days of **calendar** year end.
- FC is company-level; RMLA contains state and company information. State license requirements still determine applicability.

[NMLS XML instructions](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/pubs/mcr/licensing/mcr/topics/nmls_mcrXML.html) describe manual entry or formatted XML upload in NMLS. Upload supports initial, pending and amended filings. These instructions establish a portal workflow, not an authenticated public machine-to-machine submission API for Orbit.

| Artifact | Exact authoritative link | Verification and next step |
|---|---|---|
| FV7 field definitions | [MCR_FV7Definitions.pdf](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/stateresourcecenter/Shared%20Documents/MCR_FV7Definitions.pdf) | Readable 39-page definition document. Use this guide-linked version as the mapping starting point; preserve download date/hash during implementation. |
| FV7 sample workbook | [MCR_FV7Sample.xlsx](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/stateresourcecenter/Shared%20Documents/MCR_FV7Sample.xlsx) | Official link resolved; browser text extraction rejects XLSX. Contents/formulas not inspected in this task. |
| XML schema archive | [MCRUploadSchemaV7.zip](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/stateresourcecenter/Shared%20Documents/MCRUploadSchemaV7.zip) | Official link resolved; browser extraction rejects ZIP. Archive members, schema namespaces, imports and constraints have not been locally validated. |
| XML examples | [MCR_FV7_XML_Sample_Pack.zip](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/stateresourcecenter/Shared%20Documents/MCR_FV7_XML_Sample_Pack.zip) | Official examples are available upstream, but not downloaded/parsed or proven to pass a validator here. Do not call them unavailable from NMLS. |
| Version/source hub | [NMLS reporting files](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/stateresourcecenter/SitePages/NMLSreportingFiles.aspx) | Direct page produced no readable body in this session; use the guide's direct artifacts above. Preserve older versions for amendments. |

[Texas SML's FV7 implementation notice](https://www.sml.texas.gov/news/announcement-mortgage-call-report-version-7-mcr-fv7-guidance/) identifies Q1 2026 as the start and describes released XML specifications and testing availability. That does not prove Orbit possesses test credentials or an accepted test filing.

### Current source conflicts requiring resolution

The guide still contains a Q1 **2024** grace-period reference alongside FV7 content. Do not use it as evidence of 2026 relief. The newer calendar-year broker FC wording conflicts with fiscal-year wording in several state/older guides documented in `reporting-states-m-w.md`. Separately mandated fiscal-year CPA financial statements are not necessarily conflicting FC instructions: retain distinct obligations until reviewed.

A second official search result, [Ad Hoc MCR Definitions FV7 PDF](https://mortgage.nationwidelicensingsystem.org/Ad%20Hoc%20Document%20Library/MCR%20Definitions%20FV7.pdf), uses a different URL from the guide-linked definitions. Equivalence was not compared. Pin the approved source/version and compare changes before using either for production. State-specific relief and SSSF requirements must be versioned by jurisdiction and period, never globally inferred.

## 2. Section-level mapping against the existing model

The model currently stores eligibility/exclusion, property state, MLO ID, application received date/amount, and one final outcome/date/amount. It groups beginning/ending pipeline, received applications, five outcomes, review items and exclusions. Its CSV contains 13 worksheet columns. It has no regulatory form version, legal-entity identifier, section IDs, approved mapping version or regulator receipt.

The following section names and line references are grounded in the [FV7 definitions](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/stateresourcecenter/Shared%20Documents/MCR_FV7Definitions.pdf). The implementation findings are direct code analysis.

| Section / representative fields | Existing contribution | Missing source or control |
|---|---|---|
| RMLA I pipeline: AC010–AC090, including AC063/AC065 adjustments | Dates and basic outcome groups can seed draft counts and amounts. | No signed adjustment ledger or adjustment explanations. Historical balances are recalculated from mutable current facts. Add approved prior-quarter snapshot, amendment history, reconciled opening balance and explicit adjustment events. |
| RMLA I closed-loan breakdown | Closed/funded outcome and amount. | No channel, product, purpose, lien, HOEPA, reverse-mortgage or retained-fee mapping in this model. Need source contracts and reviewed definitions; missing must not mean zero. |
| RMLA I MLO data / notes | One numeric MLO ID per file. | No effective employment/licensing evidence, state-specific MLO reconciliation, attribution policy or report commentary. |
| RMLA II first-mortgage operational metrics | No complete mapping. | No investor/warehouse, purchase/sale, credit-profile or weighted-metric data contract. Obtain underlying source ledgers and role applicability before calculating. |
| RMLA III servicing | No mapping. | No servicing ledger, modifications, delinquency/loss-mitigation transitions or approved not-applicable evidence. |
| Company-level RMLA | No mapping. | No company-wide reconciliation across all licensed states and systems; no credit-line, repurchase or servicing source contract. |
| SSSF, including processor/underwriter SF600–SF660 | No mapping. | Missing state/role applicability and assigned/returned/completed processing events. Never reuse ordinary loan funding as processing completion. |
| FC | No mapping. | Need accounting chart-of-accounts crosswalk, approved financial statements, period close, consolidation policy, review and separate annual/quarterly role logic. |
| XML envelope, validation and submission | CSV escaping protects spreadsheet consumers. | No FV7 serializer, XSD validator, import diagnostics, submitter entitlement, portal acceptance evidence or amendment transport. CSV sanitization is not regulatory format validation. |

Specific implementation risks observed: all input amounts are nonnegative, while adjustments need a distinct signed representation; pipeline dollars use initial received amount, so later changes cannot be reconstructed; one generic eligibility decision cannot express different MCR and HMDA scopes; automatic suggestions from funding dates need source provenance and explicit review. The current outcome list also cannot represent every HMDA action code. These are gaps, not evidence that upstream loan data does not exist elsewhere.

## 3. Michigan pilot applicability

[Michigan DIFS's mortgage licensing page](https://www.michigan.gov/difs/industry/licensing-cf/mortgage) distinguishes the first-mortgage Act 173 and secondary-mortgage Act 125 and links both NMLS MCR/FC and financial-statement guidance. The pilot must identify the actual legal entity, company NMLS ID, applicable licenses/registrations, first/secondary activities, lending/servicing/processing roles and effective dates. “Michigan team” alone does not establish the filing entity or broker-only status.

Start with fictional Michigan broker records and accounting fixtures. Add representative denied, withdrawn, incomplete, approved-not-accepted, open-pipeline and funded cases, amount changes and prior-period corrections. Counsel must approve application/outcome definitions and role scope. Separate DIFS-specific financial disclosures or assessments remain an applicability investigation; this inventory does not certify that MCR exhausts Michigan obligations.

## 4. HMDA is a separate coverage decision and file format

[Regulation C §1003.2(g)](https://www.consumerfinance.gov/rules-policy/regulations/1003/2/) requires institutional coverage analysis. A nondepository institution's test includes for-profit mortgage-lending status, metropolitan-area office criteria and origination thresholds: at least 25 covered closed-end loans or 200 covered open-end lines in each of the two preceding calendar years, subject to the rule's exclusions. Do not apply depository asset thresholds to a broker simply because they appear on the same page.

[§1003.4 official interpretations](https://www.consumerfinance.gov/rules-policy/regulations/1003/4/) make credit-decision responsibility and agency relationships material where multiple institutions participate. A broker forwarding an application to a lender is not automatically the HMDA reporter. Store the decision-maker and evidence; counsel must determine institutional coverage and reportable actions. [§1003.3](https://www.consumerfinance.gov/rules-policy/regulations/1003/3/) separately governs excluded transactions and partial exemptions; an exclusion cannot be inferred solely from a product label.

[§1003.5](https://www.consumerfinance.gov/rules-policy/regulations/1003/5/) sets annual submission by March 1 following the collection year. Institutions reporting at least 60,000 covered loans/applications in the preceding year, excluding purchased loans, also submit for the first three quarters within 60 calendar days after quarter end. This does not establish universal monthly filing.

| HMDA artifact / source | Purpose and Orbit gap |
|---|---|
| [2026 Filing Instructions Guide](https://ffiec.cfpb.gov/documentation/fig/2026/overview) | Governs 2026 data filed in 2027; includes file, data and edit specifications. Requires pipe-delimited LAR and institution certification through the HMDA Platform. Orbit's comma-delimited worksheet cannot satisfy it. |
| [HMDA tools](https://ffiec.cfpb.gov/tools/) | Official formatting, verification and check-digit tools are available; no generated Orbit LAR has been validated with them. |
| [Developer API catalog](https://ffiec.cfpb.gov/documentation/category/developer-apis) | Public API documentation exists, but no authenticated filing/certification integration or authorization for Orbit was established here. Data/query/tool APIs must not be represented as submission access. |
| [HMDA Platform](https://ffiec.cfpb.gov/) | Official filing destination. An authorized institutional representative and current account access are still required. No pilot account or receipt was used. |

Source contract backlog: entity/LEI and report-year transmittal information; ULI/NUL and check-digit handling; reporter/decision-maker; action/preapproval and dates; loan purpose/product/lien; property geography; applicant/coapplicant demographic collection and unavailable/exempt codes; pricing/costs; credit/income/underwriting inputs; purchaser and other annual FIG fields. This is a category inventory, not a substitute for the FIG's full field order and edit rules. The current model supplies only a small subset of potentially reusable dates, amounts, state and MLO identity. A field-by-field coverage matrix remains required before any HMDA adapter claim.

## 5. Exact missing fixtures and submission evidence

Public schema/example links are known. What remains **unavailable in the inspected implementation evidence**:

1. Locally pinned FV7 XSD and official sample archive contents, checksum/version manifest, and a successful schema-validation log. Binary extraction was not performed under this document-only assignment.
2. Counsel-approved synthetic broker-only, lender/servicer, no-activity, cross-state, adjustment, prior-period amendment and SSSF examples with expected section totals. No test fixture proves the existing worksheet is a complete MCR.
3. Michigan entity/license applicability evidence, reconciled prior-period accepted MCR, approved accounting crosswalk, and financial-condition source fixtures.
4. A full 2026 HMDA transmittal/LAR fixture with expected syntax, validity, quality and macro edit results, coverage rationale and institutional certification workflow.
5. NMLS authorized test/production access, tested XML-import response, manual certification/attestation procedure, submission receipt, amendment receipt and failed-import recovery evidence. Public XML-upload documentation is not a provider submission API contract.
6. A verified HMDA authenticated submission/certification interface, pilot account authorization, test acceptance and durable receipt. Do not invent endpoint paths from public data APIs.
7. Verified UWM-to-reporting mappings for application lifecycle, decision-maker, amounts/adjustments, fees, product/lien and outcomes. `docs/uwm-origination-onboarding.md` describes a fictional MISMO 3.4 export awaiting lender schema validation; UWM loan-origination transport is separate from NMLS or CFPB reporting. Even later UWM acceptance would not establish reporting acceptance.

Release gate: finish source and field mappings; validate official format and reconciliation fixtures; review examples with the user; obtain lawyer approval of rules/training/applicability; exercise authorized provider workflow; preserve the actual receipt and exact submitted artifact digest. Until then expose research gaps and internal preparation status, with no accepted-filing or compliance-complete claim.
