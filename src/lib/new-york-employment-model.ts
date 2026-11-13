import { z } from "zod";

const reference = z.string().trim().min(4).max(240);
const event = z.strictObject({ on: z.iso.date(), reference });
const originator = z.string().trim().regex(/^[1-9][0-9]{0,11}$/);
const workpaperRow = z.strictObject({
  legalName: z.string().trim().min(2).max(160),
  originatorNmls: originator,
  hiredOn: z.iso.date().optional(),
  departedOn: z.iso.date().optional(),
  dismissalForCause: z.enum(["Yes", "No", "Needs review"]).optional(),
  departureReason: reference.optional(),
  temporaryAuthority: z.boolean(),
  evidenceReference: reference,
}).superRefine((row, ctx) => {
  if (!row.hiredOn && !row.departedOn && !row.temporaryAuthority)
    ctx.addIssue({ code: "custom", path: ["originatorNmls"], message: "Record a hire, departure or Temporary Authority basis for this row." });
  if (!row.departedOn && (row.dismissalForCause || row.departureReason))
    ctx.addIssue({ code: "custom", path: ["departedOn"], message: "Record the departure date before adding departure details." });
});
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
  workpaperRows: z.array(workpaperRow).max(100).optional(),
  notarizedReport: event.optional(),
  mailed: event.optional(),
}).superRefine(({ activity, separations, workpaperRows, notarizedReport, mailed }, ctx) => {
  if (activity === "No reportable activity" && (separations.length || workpaperRows?.length))
    ctx.addIssue({ code: "custom", path: ["activity"], message: "Reconcile the no-activity finding with the recorded roster or separations." });
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


export function prepareNewYorkEmploymentWorkpaper(evidence: NewYorkEmploymentEvidence, period: { from: string; through: string }) {
  const rows = evidence.workpaperRows ?? [];
  const gaps: string[] = [];
  if (!evidence.workpaperRows) gaps.push("Record or reconcile the quarter's filing rows.");
  if (evidence.activity === "Needs review") gaps.push("Resolve the quarter activity review.");
  if (evidence.activity === "Reportable activity" && !rows.length) gaps.push("Add the reportable originators.");
  if (evidence.activity === "No reportable activity") gaps.push("Confirm the applicable DFS instructions for a quarter without reportable activity.");
  const departureKey = (nmls: string, on: string) => nmls + ":" + on;
  const departures = new Map<string, typeof evidence.separations>();
  for (const item of evidence.separations) {
    const key = departureKey(item.originatorNmls, item.event.on);
    const sameDeparture = departures.get(key) ?? [];
    sameDeparture.push(item);
    departures.set(key, sameDeparture);
  }
  const reconciled = new Set<string>();
  const names = new Map<string, string>();
  for (const row of rows) {
    const priorName = names.get(row.originatorNmls);
    if (priorName && priorName !== row.legalName)
      gaps.push("Reconcile different legal names for NMLS " + row.originatorNmls + ".");
    names.set(row.originatorNmls, row.legalName);
    if (!row.departedOn) continue;
    const key = departureKey(row.originatorNmls, row.departedOn);
    const candidates = departures.get(key);
    if (row.hiredOn && row.hiredOn > row.departedOn)
      gaps.push("Review the hire and departure sequence for NMLS " + row.originatorNmls + ".");
    if (!row.dismissalForCause || row.dismissalForCause === "Needs review" || !row.departureReason)
      gaps.push("Complete the departure details for NMLS " + row.originatorNmls + ".");
    if (!candidates) gaps.push("Reconcile the departure and prompt notices for NMLS " + row.originatorNmls + ".");
    else if (row.dismissalForCause && row.dismissalForCause !== "Needs review" &&
      candidates.some(item => (item.kind === "Dismissal for cause") !== (row.dismissalForCause === "Yes")))
      gaps.push("Reconcile the recorded dismissal for cause for NMLS " + row.originatorNmls + ".");
    reconciled.add(key);
  }
  for (const [key, entries] of departures) {
    const { originatorNmls } = entries[0];
    if (!reconciled.has(key)) gaps.push("Review the filing treatment of the recorded departure for NMLS " + originatorNmls + ".");
    if (entries.length > 1) gaps.push("Reconcile multiple departures recorded on the same date for NMLS " + originatorNmls + ".");
    if (entries.some(item => !item.entityNotice)) gaps.push("Review missing brokerage notice evidence for NMLS " + originatorNmls + ".");
    if (entries.some(item => !item.individualNotice)) gaps.push("Review missing individual notice evidence for NMLS " + originatorNmls + ".");
  }
  return { period: { from: period.from, through: period.through }, rows, gaps: [...new Set(gaps)] };
}
