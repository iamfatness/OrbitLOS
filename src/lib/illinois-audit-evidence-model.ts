import { z } from "zod";
import { shiftReportDate } from "./report-date-range";

const date = z.iso.date().refine(value => value >= "1900-01-01" && value <= "2199-12-31");
const reference = z.string().trim().min(4).max(240);
const datedEvidence = z.strictObject({ on: date, reference });
const decision = z.discriminatedUnion("result", [
  z.strictObject({ ...datedEvidence.shape, result: z.literal("Denied") }),
  z.strictObject({ ...datedEvidence.shape, result: z.literal("Granted"), dueOn: date }),
]);

export const illinoisAuditEvidence = z.strictObject({
  originalDeadline: datedEvidence,
  extension: z.strictObject({ request: datedEvidence, grounds: reference, decision: decision.optional() }).optional(),
  filing: datedEvidence.optional(),
}).superRefine(({ originalDeadline, extension }, ctx) => {
  if (extension?.decision && extension.decision.on < extension.request.on)
    ctx.addIssue({ code: "custom", path: ["extension", "decision"], message: "The regulator decision cannot precede the request." });
  if (extension?.decision?.result === "Granted" && extension.decision.dueOn <= originalDeadline.on)
    ctx.addIssue({ code: "custom", path: ["extension", "decision", "dueOn"], message: "The granted deadline must extend the original date." });
});
export type IllinoisAuditEvidence = z.infer<typeof illinoisAuditEvidence>;

export function reviewIllinoisAuditEvidence(evidence: IllinoisAuditEvidence, asOf: string) {
  const requestDueOn = shiftReportDate(evidence.originalDeadline.on, -15);
  const decision = evidence.extension?.decision;
  const dueOn = decision?.result === "Granted" ? decision.dueOn : evidence.originalDeadline.on;
  const requestStatus = evidence.extension ? (evidence.extension.request.on <= requestDueOn ? "On time" : "Late") : "No request recorded";
  const filingStatus = evidence.filing ? (evidence.filing.on <= dueOn ? "Filed on time" : "Filed late") :
    asOf > dueOn ? "Past due" : asOf === dueOn ? "Due today" : "Pending filing";
  return { asOf, requestDueOn, dueOn, requestStatus, filingStatus,
    extensionStatus: decision?.result ?? (evidence.extension ? "Pending decision" : "No request recorded") };
}
