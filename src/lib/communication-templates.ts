import type { CommunicationDraft, DraftAudience, DraftChannel, DraftMilestone, Loan, Stage } from "./model";

export const draftChannels = ["Email", "Text"] as const;

const borrowerUpdates: Record<DraftMilestone, string> = {
  Lead: "Thanks for getting in touch about a mortgage. Let me know a good time to talk through your plans.",
  "Pre-qual": "We’ve reached the prequalification step. I’ll be in touch to go over the details and next steps.",
  Application: "We’ve reached the application step. Let me know if you need help completing it.",
  "Application received": "We received your mortgage application. I’ll review it and follow up with the next steps.",
  "Closing complete": "Your closing is complete. I’ll be in touch with any remaining next steps.",
  Processing: "Your loan has moved into processing. I’ll let you know if we need anything else from you.",
  Underwriting: "Your loan has moved to underwriting for review. I’ll share updates as they become available.",
  "Clear to Close": "Your loan has reached clear to close. I’ll be in touch to confirm the closing details.",
  Funded: "Your loan has funded. Thank you for working with me.",
  Closed: "Your loan file has moved to the closed stage. Please reach out if you have any questions.",
};

export function draftRecipient(loan: Loan, audience: DraftAudience) {
  return audience === "Borrower" ? loan.contactId : loan.partnerId;
}

export function draftCopied(draft: CommunicationDraft) {
  return Boolean(draft.emailCopiedAt || draft.textCopiedAt);
}

export function currentDraftMilestone(milestone: DraftMilestone, stage: Stage, hasClosingDate: boolean) {
  return milestone === "Closing complete" ? hasClosingDate : milestone === "Application received" || milestone === stage;
}

export function renderDraft(audience: DraftAudience, milestone: DraftMilestone, channel: DraftChannel, recipientName: string, officerName: string, customBody?: string) {
  const officer = officerName || "Your loan team";
  const realtorUpdate = milestone === "Application received"
    ? "A quick milestone update on your referral. The application was received."
    : milestone === "Closing complete" ? "A quick milestone update on your referral. The closing is complete."
      : `A quick milestone update on your referral. The loan reached ${milestone}.`;
  const message = customBody ? customBody.replaceAll("{{milestone}}", milestone) : audience === "Borrower" ? borrowerUpdates[milestone] : realtorUpdate;
  const subject = milestone === "Closing complete" ? "Closing complete"
    : audience === "Borrower" && milestone === "Application received" ? "We received your mortgage application" : "Loan milestone update";
  return channel === "Email"
    ? { subject, body: `Hi ${recipientName},\n\n${message}\n\nThanks,\n${officer}` }
    : { subject: "", body: `Hi ${recipientName}, ${message} — ${officer}, OrbitLOS` };
}
