import { z } from "zod";
import { shiftReportDate } from "./report-date-range";

const reference = z.string().trim().min(4).max(240);
const event = z.strictObject({ on: z.iso.date(), reference });
const component = z.enum(["Mortgage Call Report", "Financial Condition"]);
const receipt = z.strictObject({
  component,
  period: z.string().regex(/^20\d{2}-(01|04|07|10)$/),
  disposition: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("Filed"), receipt: event }),
    z.strictObject({ status: z.literal("Not applicable"), reference }),
  ]),
});
export const coloradoCompanyRenewalEvidence = z.strictObject({
  classification: z.enum(["Broker only", "Lending or servicing", "Needs review"]),
  classificationReference: reference,
  filingInventoryReference: reference,
  priorFiscalYearEnd: z.iso.date().optional(),
  receipts: z.array(receipt).max(8),
  olderDeficiencies: z.array(z.strictObject({
    itemReference: reference,
    identified: event,
    clearance: event.optional(),
  })).max(30).optional(),
  renewalRequest: event.optional(),
  regulatorStatus: event.extend({ status: z.enum(["Pending", "Renewed", "Expired", "Denied", "Other"]) }).optional(),
}).superRefine(({ receipts, olderDeficiencies }, ctx) => {
  const deficiencyKeys = olderDeficiencies?.map(item => item.itemReference.toLowerCase()) ?? [];
  if (new Set(deficiencyKeys).size !== deficiencyKeys.length)
    ctx.addIssue({ code: "custom", path: ["olderDeficiencies"], message: "Record each older filing deficiency once." });
  const keys = receipts.map(row => row.component + ":" + row.period);
  if (new Set(keys).size !== keys.length)
    ctx.addIssue({ code: "custom", path: ["receipts"], message: "Record one determination per component and period." });
});
export type ColoradoCompanyRenewalEvidence = z.infer<typeof coloradoCompanyRenewalEvidence>;

export function coloradoRenewalReportingPeriods(year: number, classification: ColoradoCompanyRenewalEvidence["classification"]) {
  const quarters = [
    { period: (year - 1) + "-10", through: (year - 1) + "-12-31" },
    { period: year + "-01", through: year + "-03-31" },
    { period: year + "-04", through: year + "-06-30" },
    { period: year + "-07", through: year + "-09-30" },
  ];
  const reporting = quarters.map(({ period, through }) => ({
    component: "Mortgage Call Report" as const, period, through, nominalDueOn: shiftReportDate(through, 45),
  }));
  const financial = (classification === "Broker only" ? quarters.slice(0, 1) : classification === "Lending or servicing" ? quarters : [])
    .map(({ period, through }) => ({ component: "Financial Condition" as const,
      period: classification === "Broker only" ? (year - 1) + "-01" : period,
      through, nominalDueOn: shiftReportDate(through, classification === "Broker only" ? 90 : 45) }));
  return [...reporting, ...financial];
}

export function reviewColoradoCompanyRenewal(evidence: ColoradoCompanyRenewalEvidence, year: number, asOf: string) {
  const rows = coloradoRenewalReportingPeriods(year, evidence.classification).map(period => {
    const record = evidence.receipts.find(row => row.component === period.component && row.period === period.period)?.disposition;
    const needsFiscalReview = evidence.classification === "Broker only" && period.component === "Financial Condition" &&
      evidence.priorFiscalYearEnd !== period.through;
    const nominalDueOn = needsFiscalReview ? null : period.nominalDueOn;
    const timing = nominalDueOn === null ? "Verify fiscal year and filing date" : record?.status === "Filed" ?
      (record.receipt.on <= nominalDueOn ? "Receipt by nominal date" : "Receipt after nominal date") :
      record?.status === "Not applicable" ? "Exclusion documented for review" :
      asOf > nominalDueOn ? "Nominal date passed without receipt" : "Awaiting receipt";
    return { ...period, nominalDueOn, timing };
  });
  return {
    asOf, rows,
    ...(evidence.olderDeficiencies ? { olderDeficiencies: evidence.olderDeficiencies.map(item => ({
      ...item,
      finding: item.clearance ? "Clearance evidence recorded" : "Clearance evidence needed",
    })) } : {}),
    classificationNeedsReview: evidence.classification === "Needs review",
    renewalStatus: evidence.regulatorStatus?.status ?? "No regulator status recorded",
    requestRecorded: Boolean(evidence.renewalRequest),
  };
}
