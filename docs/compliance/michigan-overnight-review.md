# Michigan overnight disclosure review

The overnight batch starts from the published intent and fee timing release at `029f5eb`. Implementation is in `feature/michigan-fee-review`. The Gather UWM API information thread owns production promotion. Use fictional Michigan files and retain owner and lawyer review before regulatory use.

| Milestone | Acceptance |
| --- | --- |
| Original estimate and closing fee comparison | Capture itemized borrower amounts by exact active disclosure send and explicit charge key. Show missing or disputed classifications. Keep incomplete evidence visible. Compare individual increases separately from the aggregate and show evidence history after corrections. |
| Revised estimate review | Record reason, knowledge date and supporting evidence, then link the affected charges and exact revision. Preserve the original comparison alongside any reviewed alternative. Incomplete or withdrawn evidence leaves the alternative unresolved. |
| Cure evidence | Record actual consummation, refund amount/date/reference and the linked corrected disclosure. Display timing and gaps independently. Preserve the underlying comparison and correction history. |
| Corrected CD timing | Document what changed and whether review indicates a restarted interval. Link the exact corrected disclosure receipt. Preserve the initial timeline and show unresolved reasons or missing receipts. |
| Verification and handoff | Exercise role boundaries, stale changes, retry and withdrawal in the authenticated rehearsal. Inspect populated desktop and phone states under the UI quality gate. Send verified commits and scope to the release owner. |

The first milestone is implemented locally. In **Disclosures → TRID application and delivery evidence**, choose **Record disclosure fee snapshot** for each exact disclosure send. Compare the selected original Loan Estimate and Closing Disclosure in **Disclosure fee comparison**. Match charges by a stable key and preserve incomplete or disputed classifications. Withdrawal keeps the old evidence and excludes it from active comparisons. The authenticated rehearsal exercises duplicate retry, unauthorized writes, invalid sources and withdrawal. Browser acceptance and promotion are pending.

Next, link changed-circumstance evidence to the affected charges and exact revised estimate. Selection of a revised estimate, credits and actual cure evidence require their own review steps.

Regulatory basis for review. [CFPB Regulation Z §1026.19](https://www.consumerfinance.gov/rules-policy/regulations/1026/19/).
