import { z } from "zod";

const reference = z.string().trim().min(5).max(1500);
const record = z.strictObject({ on: z.iso.date(), reference });
const submission = record.extend({ route: z.enum(["DFS Portal", "Mail"]) });
export const isNewYorkVoorSource = (key: string | undefined) =>
  key === "REQ-NY-REPORTING-VOOR" || key === "REQ-NY-REPORTING-BANKER-VOOR";

export const newYorkVoorEvidence = z.strictObject({
  reviewedInstructions: z.strictObject({
    url: z.url().max(2000).refine(value => new URL(value).protocol === "https:", "Use an HTTPS source."),
    deadline: z.iso.date(),
    reference,
  }).optional(),
  reconciliation: z.strictObject({
    activity: z.enum(["Reported activity", "No New York applications or closings"]),
    reference,
  }).optional(),
  attestation: record.extend({
    capacity: z.enum(["Owner", "Authorized principal officer"]),
    authorityReference: reference,
    dfsApplicationOwnerReference: reference.optional(),
    notarizationReference: reference.optional(),
  }).optional(),
  original: submission.optional(),
  amendment: submission.extend({ reason: reference, attestationReference: reference.optional() }).optional(),
});
export type NewYorkVoorEvidence = z.infer<typeof newYorkVoorEvidence>;

export function reviewNewYorkVoor(evidence: NewYorkVoorEvidence, nominalDueOn: string | null, asOf: string) {
  const dueOn = evidence.reviewedInstructions?.deadline ?? nominalDueOn;
  const gaps: string[] = [];
  if (!evidence.reviewedInstructions) gaps.push("Verify the report-year instructions and deadline.");
  if (!evidence.reconciliation) gaps.push("Reconcile the report to the entity's records, including no-activity reporting where applicable.");
  if (!evidence.attestation) gaps.push("Record the owner or authorized principal officer's attestation.");
  if (!evidence.original) gaps.push("Record the initial DFS submission.");
  if (evidence.original?.route === "DFS Portal" && !evidence.attestation?.dfsApplicationOwnerReference)
    gaps.push("Verify the signer's DFS Application Owner assignment.");
  if (evidence.original?.route === "Mail" && !evidence.attestation?.notarizationReference)
    gaps.push("Record the notarized affidavit and keep the dated postmark evidence.");
  if (evidence.amendment && (evidence.original?.route !== "DFS Portal" || evidence.amendment.route !== "DFS Portal"))
    gaps.push("Confirm the amendment procedure with DFS for this filing route.");
  if (evidence.amendment && !evidence.amendment.attestationReference)
    gaps.push("Record the attestation for the amended report.");
  const initialTiming = !dueOn ? "Deadline needs review" : evidence.original
    ? evidence.original.on <= dueOn ? "On or before recorded deadline" : "After recorded deadline"
    : asOf > dueOn ? "Past recorded deadline" : "Awaiting initial submission";
  return { asOf, dueOn, initialTiming, gaps };
}
