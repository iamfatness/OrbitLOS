import { z } from "zod";

const reference = z.string().trim().min(4).max(240);
const datedEvidence = z.strictObject({ on: z.iso.date(), reference });
export const michiganOriginatorId = z.string().trim().regex(/^[1-9][0-9]{0,11}$/, "Enter the individual NMLS ID.");
export const michiganMloRenewalEvidence = z.strictObject({
  education: z.discriminatedUnion("route", [
    datedEvidence.extend({ route: z.literal("Continuing education"), sameDaySequenceReference: reference.optional() }),
    datedEvidence.extend({ route: z.literal("First-year exception"), issued: datedEvidence }),
  ]).optional(),
  request: datedEvidence.optional(),
  feeReference: reference.optional(),
  bondReference: reference.optional(),
  regulatorStatus: datedEvidence.extend({
    status: z.enum(["Pending", "Renewed", "Expired", "Denied", "Other"]),
  }).optional(),
}).refine(value => Object.values(value).some(Boolean), "Enter at least one piece of renewal evidence.");
export type MichiganMloRenewalEvidence = z.infer<typeof michiganMloRenewalEvidence>;

export function reviewMichiganMloRenewal(evidence: MichiganMloRenewalEvidence, from: string, dueOn: string, asOf: string) {
  const { education, request, regulatorStatus } = evidence;
  let educationStatus = "No education evidence";
  if (education) {
    if (education.on < from || education.on > dueOn) {
      educationStatus = "Review education outside the renewal year";
    } else if (education.route === "First-year exception") {
      educationStatus = education.issued.on < education.on || education.issued.on > dueOn ||
        Boolean(request && education.issued.on > request.on) ? "Review first-year exception dates" : "First-year exception documented";
    } else if (!request) {
      educationStatus = "Continuing education recorded";
    } else if (education.on > request.on) {
      educationStatus = "Education recorded after request";
    } else if (education.on === request.on && !education.sameDaySequenceReference) {
      educationStatus = "Verify same-day sequence";
    } else {
      educationStatus = "Education documented before request";
    }
  }
  const requestStatus = request ? (request.on <= dueOn ? "Request recorded by nominal date" : "Request recorded after nominal date") :
    asOf > dueOn ? "Nominal date passed without a recorded request" : "No request recorded";
  return { asOf, educationStatus, requestStatus, feeRecorded: Boolean(evidence.feeReference), bondRecorded: Boolean(evidence.bondReference),
    regulatorStatus: regulatorStatus?.status ?? "No regulator status recorded" };
}
