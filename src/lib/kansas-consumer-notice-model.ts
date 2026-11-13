import { z } from "zod";
import { compareLocalEvidenceOrder } from "./local-evidence-order";
import { shiftReportDate } from "./report-date-range";

const lawBook = "https://www.osbckansas.gov/legal/cml_lawbook_2026.pdf";
export const kansasNoticeStatute = `${lawBook}#page=81`;
export const kansasNoticeRule = `${lawBook}#page=104`;
const currentRuleFrom = "2026-07-24";
const reference = z.string().trim().min(1).max(180);
const evidence = z.strictObject({
  on: z.iso.date().refine(value => value >= "2022-01-01" && value <= "2099-12-31"),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  reference,
});
export const kansasNoticeConsumers = ["Primary consumer", "Additional consumer"] as const;
export const kansasNoticeEvents = [
  { key: "contract", label: "Service contract entered" },
  { key: "compensation", label: "Compensation or promise received" },
  { key: "transfer", label: "Servicing transfer accepted" },
] as const;
const consumer = z.strictObject({
  recipient: z.enum(kansasNoticeConsumers),
  notice: evidence.extend({ version: reference, reviewedContents: z.boolean() }).optional(),
  contract: evidence.optional(),
  compensation: evidence.optional(),
  transfer: evidence.optional(),
  reviewedTriggers: z.boolean(),
});
export const kansasNoticeFacts = z.strictObject({
  state: z.literal("KS"),
  zone: z.enum(["America/Chicago", "America/Denver"]),
  scopeReference: reference,
  recipientScope: z.enum(["Unresolved", "Primary consumer only", "Two consumers"]),
  consumers: z.array(consumer).min(1).max(2),
}).superRefine((facts, ctx) => {
  const recipients = new Set(facts.consumers.map(item => item.recipient));
  if (!recipients.has("Primary consumer") || recipients.size !== facts.consumers.length ||
    (facts.recipientScope === "Primary consumer only" && recipients.size > 1)) {
    ctx.addIssue({ code: "custom", path: ["consumers"], message: "Review each consumer once and match the recipient scope." });
  }
});
export const kansasNoticeRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("read"), state: z.literal("KS"), loanId: z.string().min(1).max(100) }),
  z.strictObject({ operation: z.literal("save"), loanId: z.string().min(1).max(100), expectedRevision: z.number().int().nonnegative(),
    requestId: z.uuid(), facts: kansasNoticeFacts, correction: reference.optional() }),
]);
export type KansasNoticeFacts = z.infer<typeof kansasNoticeFacts>;
export type KansasNoticeRequest = z.infer<typeof kansasNoticeRequest>;
export type KansasNoticeConsumer = z.infer<typeof consumer>;

export function kansasNoticeDates(facts: KansasNoticeFacts) {
  return facts.consumers.flatMap(item => [item.notice?.on, ...kansasNoticeEvents.map(({ key }) => item[key]?.on)]);
}

export function reviewKansasNotice(facts: KansasNoticeFacts) {
  const scopeGaps: string[] = [];
  if (facts.recipientScope === "Unresolved") scopeGaps.push("Confirm all consumers who must receive the notice.");
  if (facts.recipientScope === "Two consumers" && facts.consumers.length !== 2)
    scopeGaps.push("Record evidence for the additional consumer.");
  const consumers = facts.consumers.map(item => {
    const { notice, contract, compensation, transfer } = item;
    const cutoff = transfer ? shiftReportDate(transfer.on, 15) : null;
    const earliestDate = [contract?.on, compensation?.on, cutoff].filter((value): value is string => !!value).sort()[0];
    const historical = [earliestDate, notice?.on, transfer?.on].some(value => value && value < currentRuleFrom);
    const gaps: string[] = [];
    if (historical) gaps.push("This record includes dates before July 24, 2026. Confirm the applicable notice or acknowledgment requirements.");
    if (!notice) gaps.push("Record the written notice and delivery evidence.");
    if (notice && !historical && !notice.reviewedContents)
      gaps.push("Review the notice date, company name and address, and the prescribed boldface statement.");
    if (!item.reviewedTriggers) gaps.push("Review which statutory timing events apply to this consumer.");
    if (!earliestDate) gaps.push("No applicable timing event is documented yet.");
    const timing = [
      ...(contract ? [{ label: "Notice relative to the service contract", result: compareLocalEvidenceOrder(notice, contract) }] : []),
      ...(compensation ? [{ label: "Notice relative to compensation or promise", result: compareLocalEvidenceOrder(notice, compensation) }] : []),
      ...(cutoff ? [{ label: "Notice relative to the servicing transfer cutoff",
        result: compareLocalEvidenceOrder(notice, { on: cutoff }) }] : []),
    ];
    for (const row of timing) {
      if (row.result !== "Before") gaps.push(`Review ${row.label.toLowerCase()}.`);
    }
    return { recipient: item.recipient, earliestDate: earliestDate ?? null, cutoff, timing, gaps };
  });
  return { scopeGaps, consumers };
}
