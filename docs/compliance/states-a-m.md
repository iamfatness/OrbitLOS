# State compliance research: Alabama through Missouri

Research date: 2026-11-10. Scope: OrbitLOS independent wholesale mortgage broker LOS, POS, pricing and CRM, including proposed contract-processing/non-delegated expansion.

This is a sourced baseline and implementation backlog, **not an exhaustive legal inventory, a counsel-approved rule pack, or evidence that Orbit enforces these requirements**. Every jurisdiction remains **research-incomplete / legal-review-required / enforcement-unverified**. “Confirmed baseline” means the linked primary source supports the narrow finding; it does not mean every exception, amendment or related rule has been validated. Sources were searched and opened on the research date. An official agency page is stronger evidence than an industry checklist but may still contain outdated material.

## How to use this register

Assign a named compliance owner to each jurisdiction. Before activating a rule, record exact statute/regulation subsection, legal effective dates, applicability predicate, exceptions, triggering event, deadline/calendar convention, evidence required, responsible party, enforcement point and boundary tests. Preserve the source version used in the decision.

A property-state field alone cannot establish jurisdiction: review borrower residence, location of solicitation/origination, staff/branch location, collateral location, purpose, occupancy, lien, dwelling type, creditor identity and actual broker/lender/servicer role. DSCR, business purpose, non-QM and wholesale are product or channel descriptions, not universal exemptions. Do not infer that a lender's license covers a broker or processor.

## Cross-cutting unresolved state work

The following **must be investigated in every state below**; an omitted state-specific finding does not mean no obligation:

- Entity, branch, responsible-person and individual MLO licensing; sponsorship, temporary authority, continuing education, bonds/net worth, renewal, control changes, remote work, independent-contractor processing and lead generation.
- Required state broker/agency/compensation/lock/commitment disclosures; application trigger and delivery timing; electronic consent, translation and acknowledgment; lender delivery delegation; prohibited advance fees and refund/escrow rules.
- State high-cost, anti-predatory, usury, points-and-fees, prepayment, refinancing/net-benefit and anti-steering requirements. Source each threshold and fee definition separately; do not reuse federal HOEPA numbers as state thresholds.
- Consumer privacy and data-security statutes, financial institution versus GLBA-data exemptions, rights requests, vendors, breach notification recipients and timing, legal holds and preservation. An entity's exemption does not automatically exempt all CRM, employee or website data.
- Telemarketing registration, state do-not-call and suppression, consent, calling windows/holidays, text rules, call recording/interception, email and misleading-advertising rules. Evaluate contacted person's location and channel, not just property state.
- Record categories, retention clock, examiner access, authorized storage locations, reporting and Mortgage Call Report duties, complaints, state fair-lending protections and marketing claims.
- Real-estate referral payments, co-marketing, dual-license conflicts, attorney/title/escrow roles, notary/remote notarization, reverse mortgages, manufactured housing, servicing and foreclosure where the platform expands into those activities.
- AI/automated-decision obligations where operative: applicability, effective date, notices, assessment and human review. A draft rule or supervisory publication must not be represented as enacted law.

## Proposed shared platform controls

These are engineering requirements, not statements of current implementation.

| Control | Required behavior and evidence |
| --- | --- |
| Jurisdiction resolution | Preserve all relevant jurisdiction facts and reasons; unresolved facts return review-required, never a pass. |
| License gate | Validate entity, branch and staff authority for the exact role/product before regulated action; preserve dated source evidence and exemption review. |
| State disclosure workflow | Generate only approved versions; establish real trigger timestamps, due dates, delivery/receipt and signature evidence; preserve prior versions. |
| Fee and high-cost review | Retain itemized payer/payee/purpose, loan terms, reference rates, calculation version and lender result; unsupported calculations require review. |
| Outreach gate | Check channel consent and suppression at each attempt, including imports and retries; resolve recipient location and approved contact window. |
| Retention and evidence | Apply the longest applicable obligation per record, with legal holds; retain immutable history and examiner export; prevent replacement-file cleanup from deleting required evidence. |
| Release control | Require legal approval and passing integration tests for the exact state/product/channel before representing production coverage. |

## Jurisdiction entries

### AL — Alabama

**Confirmed baseline:** Banking Department distinguishes mortgage brokering/processing/underwriting/lead generation from mortgage lending authority and announced a September–December 2026 NMLS transition. [Primary source](https://banking.alabama.gov/bol/bol-forms-and-apps/).

**Required platform work:** Capture company, branch and individual authority by activity; monitor transition and renewal evidence.

**Unresolved legal research:** Resolve Mortgage Broker Licensing Act and Consumer Credit Act overlap, applicable fee limits/disclosures, record retention, advertising and lead-generation licensing. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### AK — Alaska

**Confirmed baseline:** Division licenses broker-lenders and MLOs. Its guidance flags loans below $25,000 for usury review and possible additional Small Loan Act licensing. [Primary source](https://www.commerce.alaska.gov/web/dbs/ConsumerFinance/MortgageBrokerLendersOriginators.aspx).

**Required platform work:** Route small-balance loans to an approved rate/licensing assessment; maintain sponsorship and license evidence.

**Unresolved legal research:** Validate AS 06.60 and 3 AAC 14 disclosure, fee, record rules; never treat archived emergency remote-work guidance as permanent permission. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### AZ — Arizona

**Confirmed baseline:** A.R.S. 6-903 distinguishes residential mortgage broker authority from commercial mortgage broker authority; residential brokering requires the mortgage broker license. [Primary source](https://www.azleg.gov/ars/6/00903.htm).

**Required platform work:** Store residential/commercial authority separately and block an unsupported activity; include responsible individual and bond evidence.

**Unresolved legal research:** Review Title 6 chapter 9 and rules for broker agreements, fees, advertising, records and any high-cost restrictions; do not assume DSCR is unregulated. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### AR — Arkansas

**Confirmed baseline:** Securities Department directs brokers, bankers, servicers and loan officers to the Fair Mortgage Lending Act and jurisdiction-specific NMLS requirements; company, control person, branch and MLO filings are separate. [Primary source](https://securities.arkansas.gov/loans/nmls/).

**Required platform work:** Maintain separate company/branch/MLO checks and lender versus broker roles.

**Unresolved legal research:** Extract current Act/rules for borrower disclosures, prohibited charges, high-cost lending, retention and advertisements before rule activation. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### CA — California

**Confirmed baseline:** DRE mortgage broker compliance manual covers borrower disclosures, trust funds, advertising, advance fees, regulated loans, private money, reporting and covered/higher-priced loans. It is a 2019-revised manual, not a complete current rulebook. [Primary source](https://www.dre.ca.gov/files/pdf/re7.pdf).

**Required platform work:** Select governing license regime before forms or fee checks; retain form version, delivery evidence, trust accounting and fee provenance.

**Unresolved legal research:** Reconcile DRE real estate/MLO endorsement with DFPI CFL/CRMLA authority; revalidate MLDS applicability and timing, Financial Code 4970/4995, translations, privacy and current amendments. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### CO — Colorado

**Confirmed baseline:** DORA explicitly repealed rules 5.7 and 5.8 effective September 30, 2025; the formerly required tangible net benefit disclosure form is no longer required under those rules. [Primary source](https://content.govdelivery.com/accounts/CODORA/bulletins/3edb44a).

**Required platform work:** Version rule packs by effective date; retire the repealed form obligation while preserving historical evidence.

**Unresolved legal research:** Validate current company registration/MLO licensing, dual-status and lock disclosures, record rules and professional duties against current 4 CCR 725-3; historical PDFs are insufficient. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### CT — Connecticut

**Confirmed baseline:** DOB states mortgage brokers and lenders need Connecticut licensing for consumer-purpose mortgage business; DOB also regulates residential mortgage lead generators. [Primary source](https://portal.ct.gov/dob/consumer/consumer-education/what-to-know-when-shopping-for-a-mortgage).

**Required platform work:** Gate lead routing, application and origination by verified entity/MLO role; assess lead-generator activity separately.

**Unresolved legal research:** Review Title 36a for current broker disclosures, advance fees, high-cost loans, records, branch/remote work and marketing; determine privacy exemptions by entity and data. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### DE — Delaware

**Confirmed baseline:** Title 5 chapter 21 covers mortgage loan brokers and defines consumer owner-occupied one-to-four family mortgages with transaction or property connections to Delaware. [Primary source](https://delcode.delaware.gov/title5/c021/).

**Required platform work:** Evaluate transaction nexus as well as property state; preserve broker agreement and fee records.

**Unresolved legal research:** Extract chapter 21 requirements and regulations for agreement/disclosure content, fees and retention; assess separate lender authority and high-cost rules where relevant. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### FL — Florida

**Confirmed baseline:** Section 494.0016 requires covered licensee records, including borrower expense receipts and signed closing statements, for at least three years after original entry; alternate storage may require authorization. [Primary source](https://www.leg.state.fl.us/Statutes/index.cfm/Ch0465/index.cfm?App_mode=Display_Statute&URL=0400-0499/0494/Sections/0494.0016.html).

**Required platform work:** Use original-entry retention anchors and examiner export; maintain storage-location authorization evidence and legal holds.

**Unresolved legal research:** Review remaining chapter 494 and 69V-40 rules for license roles, brokerage agreements, fees and advertising; separately assess Florida telemarketing, recording and breach duties. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### GA — Georgia

**Confirmed baseline:** DBF identifies GRMA, Georgia Fair Lending Act and chapter 80-11 rules. Its FAQ says bona fide discount-point analysis changed to CFPB APOR effective June 1, 2024. [Primary source](https://dbf.georgia.gov/mb-brokers-lenders-and-originators/mortgage-faq).

**Required platform work:** Keep dated APOR/rate/point evidence for the applicable GAFLA calculation; distinguish broker/processor and lender licenses.

**Unresolved legal research:** Validate all GAFLA coverage, fee inclusion, thresholds and remedies, state disclosures and retention; assess advertisements and remote-work controls. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### HI — Hawaii

**Confirmed baseline:** DFI FAQ identifies MLO and MLO-company licensing, sponsorship restrictions, manufactured-home coverage and potential licensing of wholesale lending activity. [Primary source](https://www.cca.hawaii.gov/dfi/faq-mlo/).

**Required platform work:** Require linked company/MLO authority; capture dwelling type and lender role even for indirect workflows.

**Unresolved legal research:** Review current chapter 454F forms, disclosures, fee restrictions, records, advertisements and high-cost overlays; confirm exemption and sponsorship details. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### ID — Idaho

**Confirmed baseline:** DOF describes broker/lender authority for Idaho residential property and independent-contractor processor/underwriter MLO licensing; regular nonmortgage lending can change license selection. [Primary source](https://www.finance.idaho.gov/consumer-finance-bureau/mortgage/mortgage-forms/).

**Required platform work:** Tie independent processors and originators to approved entity/location; record the applicable license regime.

**Unresolved legal research:** Validate IDAPA 12.01.10 disclosure, fee and deceptive-advertising rules and retention; confirm business-purpose scope and exemption analysis. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### IL — Illinois

**Confirmed baseline:** IDFPR administers the Residential Mortgage License Act and Anti-Predatory Lending Database; it flags private-mortgage exemption certificates in Cook, Kane, Will and Peoria counties. [Primary source](https://idfpr.illinois.gov/banks/resfin.html).

**Required platform work:** Capture county, APLD applicability, submission receipt, counseling and exemption certificate before closing release.

**Unresolved legal research:** Validate current APLD triggers/timings and responsible parties; review state high-risk loan restrictions, fee rules, record retention, privacy and recording. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### IN — Indiana

**Confirmed baseline:** Secretary of State regulates loan brokers and branch offices; its definition reaches paid assistance obtaining third-party residential loans even when no loan closes. [Primary source](https://securities.sos.in.gov/loan-brokers/).

**Required platform work:** Record regulator/license type and office authority; preserve unsuccessful applications and broker agreements.

**Unresolved legal research:** Resolve SOS broker versus DFI lender authority and current first/subordinate lien rules, disclosures, advance fees, high-cost restrictions and retention. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### IA — Iowa

**Confirmed baseline:** Iowa Code 535B.4 requires licensing for mortgage banker/broker/closing-agent activity and restricts use of banker/broker titles; applications identify principal and branch offices. [Primary source](https://www.legis.iowa.gov/docs/code/2026/535B.4.pdf).

**Required platform work:** Gate activity and public titles by authority; track company/branch and individual licensing separately.

**Unresolved legal research:** Review definitions/exemptions in 535B and MLO chapter 535D, current 187 chapter 18 rules, fee/disclosure and consumer-credit overlaps; validate retention/privacy applicability. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### KS — Kansas

**Confirmed baseline:** OSBC describes mortgage-company licensing broadly for compensated activity involving Kansas residential property and individual MLO licensing on behalf of a licensed company. [Primary source](https://www.osbckansas.gov/consumer-mortgage-lending/applications-forms/).

**Required platform work:** Require approved company/MLO linkage and remote-work evidence; retain branch and device-control attestations.

**Unresolved legal research:** Review KMBA, consumer-credit overlap, required agreements, fee and high-cost restrictions, retention and advertising; separately validate remote-work conditions under 9-2203. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### KY — Kentucky

**Confirmed baseline:** KRS 286.8-270 imposes borrower-interest/good-faith duties, material-fact disclosure and accounting for borrower property; broker fees must be disclosed before services. [Primary source](https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=14890).

**Required platform work:** Require a fee-disclosure receipt before the covered service; retain recommendation rationale, conflicts and borrower-funds ledger.

**Unresolved legal research:** Confirm entity/MLO licensing under chapter 286.8, applicable high-cost/fee limits and 808 KAR rules; extract exact disclosure, retention and advertisement requirements. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### LA — Louisiana

**Confirmed baseline:** OFI identifies separate covered mortgage broker, lender, MLO and servicing activities under the Louisiana SAFE/RMLA framework. [Primary source](https://ofi.la.gov/non-depository/residential-mortgage-lending/faqs/).

**Required platform work:** Classify actual activity and entity/MLO authority; retain authority/exemption evidence and borrower-facing agreement versions.

**Unresolved legal research:** Review R.S. 6:1081 et seq. and rules for state disclosures, fees, records and advertising; determine applicability of consumer credit/high-cost provisions and privacy/breach duties. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### ME — Maine

**Confirmed baseline:** 9-A section 10-303 requires disclosure before agreement or payment, whichever comes first, covering the bond, escrow treatment of consumer fees and written signed agreement. [Primary source](https://legislature.maine.gov/statutes/9-A/title9-Asec10-303.html).

**Required platform work:** Prevent covered agreement/payment until the state disclosure is evidenced; classify third-party versus broker fees and maintain escrow evidence.

**Unresolved legal research:** Review loan-broker versus supervised-lender authority, net-benefit/high-rate provisions, signed contract contents, refund/cancellation rules and retention; verify privacy/marketing duties. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### MD — Maryland

**Confirmed baseline:** OFR includes brokers within mortgage-lender licensing and publishes net-tangible-benefit, secondary-commercial-loan and electronic/off-site record forms. [Primary source](https://www.labor.maryland.gov/finance/industry/mortlend.shtml).

**Required platform work:** Distinguish actual broker/lender/servicer role; require approved state refinance assessment and off-site storage evidence where applicable.

**Unresolved legal research:** Resolve current Financial Institutions title 11, Commercial Law rate/fee elections, broker agreement and net-benefit triggers, retention and Maryland privacy/breach obligations. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### MA — Massachusetts

**Confirmed baseline:** Chapter 255E section 2 establishes mortgage broker/lender licensing and conditional exemptions; company exemptions must not be treated as blanket individual MLO exemptions. [Primary source](https://malegislature.gov/Laws/GeneralLaws/PartIII/TitleIV/Chapter255E/Section2).

**Required platform work:** Store exemption basis and volume/ownership facts separately from individual authorization; require reviewed Massachusetts form pack.

**Unresolved legal research:** Review current 209 CMR 42 and 53, chapter 183C high-cost rules, compensation/rate-lock agreements, suitability/refinance conditions, retention, security and call recording. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### MI — Michigan

**Confirmed baseline:** DIFS distinguishes first and secondary mortgage regimes and states a broker-only first-mortgage file is retained three years after closing; closing in one's own name requires lender authority. [Primary source](https://www.michigan.gov/difs/news-and-outreach/faq/consumer-finance/mortgage-compliance2).

**Required platform work:** Route by lien and broker/lender role; anchor applicable retention to closing and prevent broker-only own-name closing.

**Unresolved legal research:** Confirm nonclosed-file retention, secondary-lien requirements, fees/disclosures and advertising; validate exact business-purpose coverage and privacy/recording analysis. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### MN — Minnesota

**Confirmed baseline:** Chapter 58 governs residential mortgage originators/servicers, including licensing and prohibited conduct; company authority is distinct from individual SAFE licensing. [Primary source](https://www.revisor.mn.gov/statutes/2026/cite/58/full).

**Required platform work:** Map company and individual authorizations; retain recommendation/fee evidence and per-file state checklist.

**Unresolved legal research:** Extract 58.13 duties, 58.15 disclosure requirements, chapter 58A MLO rules, refinance suitability, high-cost/fee restrictions, records and privacy applicability. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### MS — Mississippi

**Confirmed baseline:** DBCF identifies SAFE Act licensing and links amended April 23, 2026 mortgage regulations, a June 26, 2026 cybersecurity reporting memo and an AI supervisory framework. [Primary source](https://dbcf.ms.gov/mortgage/).

**Required platform work:** Track rule revision and incident-reporting ownership; inventory AI usage and retain supervisory review evidence.

**Unresolved legal research:** Read the linked 2026 instruments before setting deadlines; extract state disclosure, fee/high-cost, retention, advertising, chattel and AI obligations rather than assuming older rules apply. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

### MO — Missouri

**Confirmed baseline:** Division states residential brokering, funding, servicing or purchasing requires authority unless exempt; MLO authority is separate and renewal must be approved to remain active. [Primary source](https://finance.mo.gov/mortgage-licensing).

**Required platform work:** Recheck entity/MLO status at origination; distinguish broker, funder and servicer and retain bond/renewal evidence.

**Unresolved legal research:** Reconcile current 443.701–443.893 and 20 CSR 1140-30, office exceptions, state disclosures, fees, records, high-cost and advertising obligations. Also complete every cross-cutting topic above.

**Status/confidence:** Primary-source baseline identified; incomplete rule extraction. No jurisdiction approval or runtime compliance attestation.

## Additional source evidence and freshness checks

- **California:** [DRE borrower guide](https://dre.ca.gov/files/pdf/re35a.pdf) discusses MLDS delivery; the [DRE form library](https://www.dre.ca.gov/forms/MLB.html) provides multiple forms. Do not apply a DRE-only rule indiscriminately to a DFPI licensee. The manual's revision age requires current statute/rule reconciliation.
- **Colorado:** [2025 manual chapter 9](https://dre.colorado.gov/sites/dre/files/documents/2025%20Colorado%20Real%20Estate%20Manual-Chapter%2009.pdf) was available in search excerpts but returned HTTP 403 on direct retrieval. An [older official rules PDF](https://www.sos.state.co.us/CCR/GenerateRulePdf.do?ruleVersionId=5565) opened successfully but contains older section references. It is historical evidence, **not the active ruleset**. The opened DORA repeal bulletin above demonstrates why effective-date controls are necessary. Confirm current dual-status/lock disclosures and retention from the current Secretary of State compilation.
- **Georgia:** [DBF laws/rules index](https://dbf.georgia.gov/mb-brokers-lenders-and-originators/mortgage-laws-and-rules) warns that recent legislative changes may not yet appear in the linked code compilation. Check session laws before approval.
- **Idaho:** [IDAPA 12.01.10](https://adminrules.idaho.gov/rules/current/12/120110.pdf) identifies disclosures, fees, deceptive advertising and prohibited practices; extract operative provisions before creating calculations.
- **Illinois:** [IDFPR May 2026 APLD report](https://idfpr.illinois.gov/content/dam/soi/en/web/idfpr/finlit101/sb1167/2026-05-01-apld-semi-annual-report-thru-2026-03-31.pdf) describes the four-county program and counseling-trigger categories. A report is context, not a substitute for current 765 ILCS 77 and detailed rules.
- **Indiana:** [DFI company checklist](https://mortgage.nationwidelicensingsystem.org/slr/PublishedStateDocuments/IN-DFI_Mortgage_Lending_License-Company-New-App-Checklist.pdf) distinguishes DFI lender authority from SOS broker-only licensing. Use actual authority rather than one generic Indiana license flag.
- **Iowa:** [September 16, 2026 administrative supplement](https://www.legis.iowa.gov/docs/aco/supplement/09-16-2026.pdf) includes mortgage rule amendments effective October 21, 2026. Reconcile the final/current rule text, not an older checklist.
- **Kansas:** [K.S.A. 9-2203](https://www.kslegislature.gov/b2025_26/laws/009_000_0000_chapter/009_022_0000_article/009_022_0003_section/009_022_0003_k/) addresses remote work, customer information security, device controls and annual certification. This is an operational duty beyond software configuration.
- **Maine:** [Bureau licensing page](https://www.maine.gov/pfr/consumercredit/industry/licensing/loan_broker.htm) search excerpts identify broker disclosures and net-benefit materials; direct retrieval was blocked. The opened statute above is the primary evidence for the pre-agreement/payment disclosure finding.
- **Massachusetts:** [209 CMR 42 regulator page](https://www.mass.gov/regulations/209-CMR-4200-the-licensing-of-mortgage-lenders-and-mortgage-brokers) and [2025 amendments download](https://www.mass.gov/doc/209-cmr-4200-the-licensing-of-mortgage-lenders-and-mortgage-brokers-2/download) were indexed but direct retrieval returned HTTP 403. The opened chapter 255E statute supports the licensing finding only; obtain current regulations before implementing form or lock rules.
- **Missouri:** [Company requirements](https://finance.mo.gov/mortgage-licensing/mortgage-licensing-forms-requirements) and [section 443.812](https://revisor.mo.gov/main/OneSection.aspx?section=443.812) require careful reconciliation of office requirements and exceptions. Do not encode an unconditional physical-office requirement from a summary page.

## Acceptance examples for the engineering backlog

1. A commercial-only Arizona license does not automatically authorize a residential mortgage; evidence of the proper authority is required.
2. A Delaware transaction with relevant in-state activity is not silently excluded because the property field points elsewhere.
3. A Florida record's retention clock is not changed from its original-entry basis to funding simply because funding is the common application event.
4. A Kentucky fee disclosure added after the covered service does not retroactively satisfy the prior-disclosure control.
5. A Maine agreement/payment cannot precede the required disclosure and still produce a passing assessment.
6. A Colorado loan after the repeal date does not receive the repealed state form requirement solely because an old manual lists it.
7. An Illinois file with unknown county cannot silently pass APLD review.
8. A Michigan broker-only workflow cannot represent an own-name closing as authorized by broker authority.
9. A reissued loan document keeps its prior version where a record obligation or hold applies.
10. A source/index entry, completed checklist or manager override alone never labels a state “fully compliant.”

