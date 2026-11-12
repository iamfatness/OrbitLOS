# Loan-level compliance controls: user checklist reconciliation

Updated November 11, 2026. Input: the user's pasted 11-area LOS checklist. This is an implementation crosswalk, not legal approval or a claim that these controls are deployed. It supplements C01–C12 and CS0–CS6 rather than creating a separate backlog. All 50 states remain research scope; Michigan remains the pilot.

## Priority and acceptance map

| User checklist area | Existing foundation in this branch | Work to prove before claiming supported coverage | Backlog |
| --- | --- | --- | --- |
| TRID | Disclosure packages, versioned templates and internal signing calendar | Six-element receipt event history; separate applicable business-day definitions; broker/creditor responsibility; LE/CD generation or verified provider artifacts; delivery/receipt evidence; changed-circumstance eligibility; tolerance buckets and cures; APR/finance-charge validation; waiting-period gates | P0 C03–C05 |
| HMDA | Application facts, reporting research and workpapers | Entity/transaction/year coverage; protected demographic collection/refusal handling; field-level LAR mapping; official validation/export fixtures; corrections and receipts; restrict demographic analytics access | C06/C10, CS3 |
| ECOA, fair lending, adverse action | Application/activity records and credit-provider contracts | Complete/incomplete/withdrawn/counteroffer/adverse-action lifecycle; actor responsibility; specific reason provenance; FCRA disclosures where applicable; appraisal notice/copy rights; reviewed statistical monitoring and explainability. Do not use protected attributes in routing or credit decisions | P0 C06 |
| ATR/QM | Application and pricing facts | Applicable role/product scope; eight-factor evidence; versioned QM categories and thresholds; points/fees and APR tests; independent boundary fixtures; retained creditor analysis. A product label is not a legal determination | P0 C05/C12 |
| Compensation and licensing | Tenant staff records and pricing workflow | Company/branch/MLO/state/sponsorship eligibility; dated verification and expiry; identifiers on relevant artifacts; lender-paid/borrower-paid checks; dual-compensation and steering controls; agreement/evidence linkage | P0 C02/C05 |
| RESPA | Fees, vendors and referral workflow foundations | AfBA relationship/disclosure/receipt evidence; Section 8 risk review; permissible fee and provider treatment with exceptions; accountable reviewer. Do not encode a blanket fee rule from checklist wording alone | P0 C05/C09 |
| AML, identity and sanctions | Internal learning/policy/program services | Entity-specific AML applicability; restricted escalation/investigation access; reviewed sanctions/identity provider evidence and false-positive handling; separately assessed lender-delegated CIP. No SAR material in general notes, employee screens or ordinary exam exports | P0 C09/C08 |
| HOEPA/state high-cost | Pricing and state research | Annual threshold versions; fee/APR boundaries and exclusions; state scope; required notices/counseling where applicable; reviewer-approved jurisdiction/role-specific treatment. No generic preemption override | P0 C01/C05/C12 |
| Audit, retention and exams | Transactional events, retained versions, loan holds/exports, restore protection | Record-class schedules and correct trigger dates; suite-wide hold scope; integrity/export verification; scoped examiner access; MCD field/version mapping and authoritative fixtures | P0 C08, CS6 |
| Documents, eSign and workflow | Disclosure/package history and provider contracts | Actual ESIGN consent/access/withdrawal evidence, signature and delivery artifacts; verified provider callbacks; role-scoped action gates; lender responsibility evidence. A manual status or mock provider is not proof of delivery/signature | P0 C04/C08 |
| Security and privacy | Tenant/current-roster checks and recovery controls | System-wide safeguards evidence, MFA/SSO scope, encryption/key/access review, incident process, vendor oversight and secure disposition. Independent assurance reports require an actual assessor; tests cannot manufacture SOC 2 attestation | P0 C08 |

Cross-cutting broker needs: preserve lender identity and division of responsibilities on every loan/disclosure/notice; validate compensation data in exported packages; verify multi-state licenses rather than treating an NMLS number as authorization; retain submission and lender acknowledgment evidence. Existing MISMO borrower exports are not demonstrated MCD examination exports.

The [Michigan TRID evidence pilot](michigan-trid-pilot.md) implements recorded application receipt triggers, initial timing comparisons and version-specific disclosure evidence. See its scope and release acceptance before use.

## Implementation order

1. Ship only the verified internal-pilot program/obligation/learning features through the sole release owner. Keep coverage unknown and user/lawyer review gates intact.
2. C03/C04 first loan-level increment: six-element receipt ledger, responsibility evidence and explicit calendar selection. Reuse disclosure records; do not relabel `disclosure-calendar-model.ts` internal `signingDays` as TRID compliance. Establish authoritative rule-version fixtures before enabling calculated legal deadlines.
3. C02/C05/C06: licensing eligibility, fees/compensation/high-cost checks and notice lifecycles, with negative-path tests and provider evidence.
4. Reporting owner continues MCR/FV7 and conditional HMDA mapping. Independent work continues source maintenance, reminders, QC and examination evidence. Applicable obligations are not deferred merely because their engineering package is later.

Each item tracks research, legal review, implementation, tests, operational evidence and deployment separately. Existing module names establish reusable foundations, not passed controls. Software should surface unknown applicability, absent implementation, missing evidence, overdue work and pending legal review separately.

## Corrections and primary-source checks

- The LE trigger and delivery rules need the actual application event and applicable timing definition. The existing internal signing calendar does not establish these rules. See [Regulation Z §1026.19](https://www.consumerfinance.gov/rules-policy/regulations/1026/19/) and [TRID FAQs](https://www.consumerfinance.gov/compliance/compliance-resources/mortgage-resources/tila-respa-integrated-disclosures/tila-respa-integrated-disclosure-faqs/).
- Replace “forced demographic collection” with covered-institution collection/reporting rules that preserve applicant nonresponse, partial responses and channel-specific handling. See [CFPB HMDA FAQs](https://www.consumerfinance.gov/compliance/compliance-resources/mortgage-resources/hmda-reporting-requirements/home-mortgage-disclosure-act-faqs/).
- A single “30 days from application” automation would conflate different notice events. Model completed/incomplete applications, withdrawals and third-party responsibilities separately. FCRA score factors do not substitute for specific ECOA denial reasons. See [Regulation B §1002.9](https://www.consumerfinance.gov/rules-policy/regulations/1002/9/).
- Do not apply one deletion timer to all LE/CD evidence. The retention rule distinguishes evidence categories, trigger dates, creditor obligations and transfers; state duties and holds require separate resolution. See [Regulation Z §1026.25](https://www.consumerfinance.gov/rules-policy/regulations/1026/25/).
- Bank CIP delegation can involve a mortgage broker; that does not establish that every broker has the same standalone bank CIP duty. Resolve entity and lender-agency obligations separately. See [FinCEN CIP guidance](https://www.fincen.gov/resources/statutes-regulations/guidance/guidance-customer-identification-regulations-financial).
- The FTC identifies mortgage brokers among potentially covered financial institutions. Maintain substantive safeguards evidence separately from external assurance claims. See [FTC Safeguards guidance](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know).
- MCD belongs in the examination roadmap. California implementation is supported by [CSBS's October 29, 2026 announcement](https://www.csbs.org/california-dfpi-implement-mortgage-compliance-dataset). The pasted Iowa statement remains unverified here; do not represent jurisdictional adoption or export compatibility without separate evidence.

Sources checked November 11, 2026. Exact legal applicability, thresholds, exceptions and operational scope still require qualified review. No checklist sentence automatically becomes a production rule.
