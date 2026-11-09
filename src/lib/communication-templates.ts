import { stages, type DraftAudience, type DraftChannel, type DraftMilestone, type Loan, type Stage } from "./model";

export const draftChannels = ["Email", "Text"] as const;

const borrowerUpdates: Record<DraftMilestone, string> = {
  Lead: "Thanks for getting in touch about a mortgage. Let me know a good time to talk through your plans.",
  "Pre-qual": "We’ve reached the prequalification step. I’ll be in touch to go over the details and next steps.",
  Application: "We’ve reached the application step. Let me know if you need help completing it.",
  "Application received": "We received your mortgage application. I’ll review it and follow up with the next steps.",
  "Closing complete": "Your closing is complete. I’ll be in touch with any remaining next steps.",
  Processing: "Your loan has moved into processing. I’ll let you know if we need anything else from you.",
  "Lender review started": "The lender has started reviewing your loan.",
  "Lender review resumed": "The lender is reviewing a follow-up item. I’ll be in touch with any next steps.",
  "Lender review complete": "This lender review step is complete. I’ll be in touch with what comes next.",
  Underwriting: "Your loan has moved to underwriting for review. I’ll share updates as they become available.",
  "Clear to Close": "Your loan has reached clear to close. I’ll be in touch to confirm the closing details.",
  Funded: "Your loan has funded. Thank you for working with me.",
  Closed: "Your loan file has moved to the closed stage. Please reach out if you have any questions.",
  "Post-funding check-in": "I wanted to check in now that your loan has funded. Please reach out if you have questions about the transition or need anything from me.",
  "Realtor thank-you": "Thank you for working with our team on this loan.",
};

export function draftRecipient(loan: Loan, audience: DraftAudience) {
  return audience === "Borrower" ? loan.contactId : loan.partnerId;
}

const fundedStages = ["Funded", "Closed"] as const;
const activeStages = stages.filter((stage) => stage !== "Funded" && stage !== "Closed");
export const draftMilestoneStages: Partial<Record<DraftMilestone, readonly Stage[]>> = {
  "Post-funding check-in": fundedStages, "Realtor thank-you": fundedStages,
  "Lender review started": ["Lead", "Pre-qual", "Application", "Processing", "Underwriting"],
  "Lender review complete": activeStages, "Lender review resumed": activeStages,
};

export function currentDraftMilestone(milestone: DraftMilestone, stage: Stage, hasClosingDate: boolean) {
  if (milestone === "Closing complete") return hasClosingDate;
  return milestone === "Application received" || (draftMilestoneStages[milestone]?.includes(stage) ?? milestone === stage);
}

export function renderDraft(audience: DraftAudience, milestone: DraftMilestone, channel: DraftChannel, recipientName: string, officerName: string, customBody?: string) {
  const officer = officerName || "Your loan team";
  const realtorUpdate = milestone === "Realtor thank-you" ? "Thank you for trusting me with your referral. The loan has funded, and I appreciated working with you."
    : milestone === "Application received"
    ? "A quick milestone update on your referral. The application was received."
    : milestone === "Lender review started" ? "The loan is in lender review. I’ll keep you posted on the next milestone."
      : milestone === "Lender review resumed" ? "Lender review has resumed for a follow-up item. I’ll share an update when that review is complete."
      : milestone === "Lender review complete" ? "The lender review step is complete. I’ll be in touch about closing preparations."
      : milestone === "Closing complete" ? "A quick milestone update on your referral. The closing is complete."
      : `A quick milestone update on your referral. The loan reached ${milestone}.`;
  const message = customBody ? customBody.replaceAll("{{milestone}}", milestone) : audience === "Borrower" ? borrowerUpdates[milestone] : realtorUpdate;
  const subject = milestone === "Realtor thank-you" ? "Thank you for the referral" : milestone === "Post-funding check-in" ? "Checking in after funding" : milestone === "Closing complete" ? "Closing complete"
    : audience === "Borrower" && milestone === "Application received" ? "We received your mortgage application" : "Loan milestone update";
  return channel === "Email"
    ? { subject, body: `Hi ${recipientName},\n\n${message}\n\nThanks,\n${officer}` }
    : { subject: "", body: `Hi ${recipientName}, ${message} — ${officer}, OrbitLOS` };
}
