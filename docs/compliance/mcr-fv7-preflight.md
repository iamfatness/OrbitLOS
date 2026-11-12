# FV7 reporting preparation

Source inspection and engineering rehearsal for the fictional Michigan pilot, November 11, 2026. The scripts are local tools. The workpaper checks arithmetic for the application pipeline in 2026 FV7 and has no filing or acceptance status. Filing applicability, data provenance, other sections, regulator validation and the user and lawyer review are open.

## Source verification

NMLS publishes the versioned definitions, workbook, upload schema and two sample files. The March release notice identifies Q1 2026 as the first FV7 period. The local workpaper accepts 2026 quarters while subsequent reporting years await version selection and verification. [XML guide and downloads](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/pubs/mcr/licensing/mcr/topics/nmls_mcrXML.html) · [March release notice](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/aboutNMLS/Shared%20Documents/NMLS%20Release%20Overview%20March%202026.pdf) · [Definitions, page 8](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/stateresourcecenter/Shared%20Documents/MCR_FV7Definitions.pdf)

| Download or member | SHA-256 |
| --- | --- |
| MCRUploadSchemaV7.zip | `56a221183fae7e04557a88f00db124061cd24e059c0fb6717872dae7769eb5f` |
| MCR_FV7_XML_Sample_Pack.zip | `31a2a808f058ca291f6a42c0acd762908e226bc741f8312bddfc46588865c1bd` |
| MCRBatchFileSchemaV7.xsd, identical in both ZIPs | `905facff69980bfb0d1862935c0883162599bc77011e1cb438222812b575c97f` |
| MCR_FV7Definitions.pdf | `772ad80781506bdabaa4978df98613d7b7d9cb40f87af61f94466953d96d0a16` |
| MCR_FV7Sample.xlsx | `94bb35d3341dac289b095e0741d435fe1ad2c103ac6e9a4391c74acb4af42c25` |

The compiled XSD validated `MCRv7AllFieldsSample.xml` and `MCRv7Annual.xml`. The inventory identifies 1,260 distinct leaf/attribute paths across the four components and envelope. It identifies 38 numeric application-pipeline inputs with a workpaper key and marks other paths as unmapped. An XSD path inventory does not cover portal completeness checks, calculated workbook lines or filing rules. The workbook has separate direct and third-party amount and count columns. AC063 count uses the signed-dollar type in the XSD, while the workbook assigns those columns to signed application counts. The workpaper uses integers and preserves the workbook's column meanings. [Sample workbook](https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/stateresourcecenter/Shared%20Documents/MCR_FV7Sample.xlsx)

## Application pipeline crosswalk

This crosswalk is for source design. All numeric inputs are supplied to the local workpaper. An unknown input stays blank and stops reconciliation for that column.

| FV7 line | Orbit source candidate | Missing evidence or decision |
| --- | --- | --- |
| AC010 | Opening group and prior-quarter saved ending | Approved ending by entity, state and intake source. The saved Orbit ending is an internal comparison and has no source split. |
| AC020 | Reviewed received date and amount | Evidence of first qualifying application and reviewed intake source. CRM lead source and submission timestamps alone cannot decide these fields. |
| AC030 | Reviewed approved-but-not-accepted outcome/date/amount | Approval evidence, expiry or nonacceptance basis, and same application/source linkage. |
| AC040 | Reviewed denied outcome/date/amount | Applicable credit decision evidence and reporting attribution. |
| AC050 | Reviewed withdrawn outcome/date/amount | Express withdrawal evidence and its relation to the credit decision. |
| AC060 | Reviewed incomplete outcome/date/amount | Notice and response-period evidence. Operational incomplete stages alone are insufficient. |
| AC063 | No verified equivalent | Signed counts and amounts from a reviewed adjustment ledger, with commentary and support references. |
| AC065 | No verified equivalent | Signed net amount from dated application-amount change evidence. The last loan amount alone cannot reconstruct it. |
| AC066 | Workpaper calculation | Reconciled source lines AC010–AC065 and tested portal rules. |
| AC070 | Reviewed funded outcome/date/amount and recorded funding date | Reconcile eligible funded amount, closed-loan classification and MLO totals. |
| AC080 | Ending group in the internal review | Exact ending balance and in-process amounts by entity, state and intake source. Initial amounts may differ. |
| AC090 | Workpaper calculation | Reconciled AC070 and AC080 and tested portal rules. |

The first source integration should add the reviewed intake source, reporting entity and dated amount/adjustment evidence to the existing reporting facts and quarter reviews. Keep prior accepted opening totals distinct from the existing versioned internal baseline. Verify AC070 against closed-loan and MLO totals before treating the pipeline as complete. Remaining groups include closed-loan classifications and fees, MLO detail, company-level activity, SSSF and the applicable FC package. The first Michigan pilot also needs an approved entity and license scope. [Michigan DIFS mortgage licensing](https://www.michigan.gov/difs/industry/licensing-cf/mortgage)

## Reproduce locally

Download the schema ZIP and sample pack from the XML guide into one directory. The check reads the archives directly. A changed checksum requires comparing the new official files before re-pinning.

```powershell
./scripts/validate-mcr-fv7-sources.ps1 -SourceDirectory ./sources -FieldInventory ./fv7-field-inventory.csv
node scripts/mcr-fv7-pipeline-workpaper.mjs tests/fixtures/mcr-fv7-pipeline.json
node --test tests/mcr-fv7-pipeline.test.mjs
```

The fictional Michigan Q2 workpaper covers all five outcomes, signed adjustments and carryover. Tests exercise netting across channels, mismatched prior totals, zero activity, missing inputs, missing commentary and unsupported input. The CLI returns 0 when the pipeline arithmetic reconciles, 1 when evidence or totals differ, and 2 for invalid input. These statuses describe the local workpaper only.
