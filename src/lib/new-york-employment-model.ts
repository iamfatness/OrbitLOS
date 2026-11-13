import { z } from "zod";

const reference = z.string().trim().min(4).max(240);
const event = z.strictObject({ on: z.iso.date(), reference });
const originator = z.string().trim().regex(/^[1-9][0-9]{0,11}$/);
const separation = z.strictObject({
  originatorNmls: originator,
  event,
  kind: z.enum(["Termination", "Resignation", "Dismissal for cause"]),
  entityNotice: event.optional(),
  individualNotice: event.optional(),
});

export const newYorkEmploymentEvidence = z.strictObject({
  rosterReference: reference,
  temporaryAuthorityReference: reference,
  activity: z.enum(["Reportable activity", "No reportable activity", "Needs review"]),
  separations: z.array(separation).max(100),
  notarizedReport: event.optional(),
  mailed: event.optional(),
}).superRefine(({ activity, separations, notarizedReport, mailed }, ctx) => {
  if (activity === "No reportable activity" && separations.length)
    ctx.addIssue({ code: "custom", path: ["activity"], message: "Reconcile the no-activity finding with the recorded separations." });
  if (mailed && (!notarizedReport || mailed.on < notarizedReport.on))
    ctx.addIssue({ code: "custom", path: ["mailed"], message: "Record the notarized report on or before the mailing date." });
});
export type NewYorkEmploymentEvidence = z.infer<typeof newYorkEmploymentEvidence>;

export function reviewNewYorkEmployment(evidence: NewYorkEmploymentEvidence, dueOn: string, asOf: string) {
  const filingStatus = evidence.mailed ? (evidence.mailed.on <= dueOn ? "Mailing recorded by nominal date" : "Mailing recorded after nominal date") :
    asOf > dueOn ? "Nominal date passed without mailing evidence" : asOf === dueOn ? "Nominal date today" : "Awaiting mailing evidence";
  return {
    dueOn, asOf, filingStatus,
    entityNoticesMissing: evidence.separations.filter(item => !item.entityNotice).length,
    individualNoticesMissing: evidence.separations.filter(item => !item.individualNotice).length,
    verifyNoticeTiming: evidence.separations.some(item => item.entityNotice || item.individualNotice),
    verifyNoActivity: evidence.activity === "No reportable activity",
  };
}
