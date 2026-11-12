# 50-state compliance rollout

All 50 states are in delivery scope. Michigan is the first pilot. The 50-state catalog and reporting matrix are preliminary research. Completion is measured per state, legal entity, license, activity, product and effective period. The user reviews each release scope and a lawyer reviews it before regulatory use.

An admin in a workspace with Compliance enabled can open **Compliance → Research & gaps → State rollout**. Select a state and open a requirement review or control gap for licensing, reporting, loan terms and disclosures, communications, or records and examinations. Existing research cases retain their source snapshot, owner, internal follow-up and history. The counts show how many areas have tracked work. Each area can contain multiple legal obligations, and tracking alone does not establish their applicability or implementation.

Use **Compliance → Licensing** to select or add a legal entity and record its state licenses. The register stores the company, branch or loan officer holding the license, recorded status, optional effective and expiration dates, and an optional evidence reference. It shares entities with Monthly review. Set up branches in **Team → Branches** and officers in **Team → Staff access**. Archived branches and changed staff access leave a review flag on the retained license record. **Renewal review** shows active records expiring in the next 30 days and active or expired records with a past expiration date. Changes retain an audit event. The register supports internal review without driving loan eligibility or filing.

For each proposed state scope:

1. Record the entity, exact licenses and sponsorship, allowed activities and products, regulator and allocation of broker and lender duties. Resolve unknowns with the compliance reviewer.
2. Extract each applicable requirement and exception with its authoritative section, effective dates, facts, responsible party and evidence. Capture counsel's applicability decision for the stated scope.
3. Implement and test each control or document a reviewed operational procedure. Include an in-scope success, missing facts, exceptions, changed source versions and a boundary case for timing or eligibility.
4. Rehearse reporting, records, supervision and examination evidence for that scope. Track filing receipt or correction evidence where applicable.
5. Obtain the user's and lawyer's review of the exact supported scope. Record verification and production availability for that release. Keep unsupported combinations visible.

The reporting starting points in `state-reporting-review-sources.json` preserve all 50 rows from the November 11 draft reporting matrices. They retain the source links and unresolved questions. The other review areas use the existing state authority references and prompts for further rule extraction. Research must be refreshed and checked against the particular license and period. [NMLS licensing checklists](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/stateresourcecenter/SitePages/Checklist-Compiler.aspx) · [NMLS FV7 guide](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/pubs/mcr/licensing/mcr/topics/mcrUserGuide_start-1.html)

## Batch execution

| Batch | States | Current scope |
| --- | --- | --- |
| 1 | MI | Eight source-checked license, reporting and records review items added to the local candidate. Fictional TRID and reporting capabilities can support parts of the review. |
| 2 | OH, IN, IL, WI | Company or office authority starting items checked and added. Other requirements and control verification remain open. |
| 3 | MN, IA, MO, NE, SD, ND, KS | Preliminary catalog and reporting research. |
| 4 | PA, NY, NJ, DE, MD, VA, WV | Preliminary catalog and reporting research. |
| 5 | CT, RI, MA, VT, NH, ME | Preliminary catalog and reporting research. |
| 6 | KY, TN, NC, SC, GA, FL, AL, MS, AR, LA | Preliminary catalog and reporting research. |
| 7 | TX, OK, NM, CO, AZ, UT, NV | Preliminary catalog and reporting research. |
| 8 | CA, OR, WA, ID, MT, WY, AK, HI | Preliminary catalog and reporting research. |

Expand **Specific requirements** under the applicable review area. Each entry preserves the authority link, check date, evidence needed and a question for counsel. Admins can assign the specific requirement or control gap independently. The catalog is in [state-rollout-requirements.json](state-rollout-requirements.json).

Michigan counsel decisions include entity and license scope, treatment of first and secondary mortgages and individual exceptions, the MCR and Financial Condition scope and zero-activity handling, the separate fiscal-year financial statement, and the retention periods and triggers that apply to each record class. State-specific loan terms, disclosures, communications, remaining exam controls and operational tests are still open. [Michigan DIFS reporting FAQ](https://www.michigan.gov/difs/News-and-Outreach/faq/consumer-finance/1st-mortgage) · [Michigan DIFS compliance FAQ](https://www.michigan.gov/difs/news-and-outreach/faq/consumer-finance/mortgage-compliance2)

Batch 2 begins with company and branch authority. Counsel must review the named entity, office and activity scope and applicable exceptions before regulatory use. [Ohio Revised Code §1322.07](https://codes.ohio.gov/ohio-revised-code/section-1322.07) · [Indiana Securities Division](https://securities.sos.in.gov/loan-brokers/) · [Illinois General Assembly](https://ilga.gov/legislation/ILCS/details?ActID=1196&ActName=Residential+Mortgage+License+Act+of+1987.&ChapAct=205+ILCS+635%2F&Chapter=FINANCIAL+REGULATION&ChapterID=20&MajorTopic=REGULATION&SeqEnd=700000&SeqStart=100000) · [Wisconsin DFI](https://dfi.wi.gov/Pages/FinancialServices/MortgageBanking/FAQs.aspx)
