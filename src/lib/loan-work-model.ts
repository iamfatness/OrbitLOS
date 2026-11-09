import type { readEditableLoan } from "./editable-loan";
import type { Workspace } from "./model";

export type EditableLoan = Exclude<ReturnType<typeof readEditableLoan>, { error: string }>;
export type LoanMutationResult = { loanWork: EditableLoan; message: string; loanFormSaved?: true; applicationToken?: string; applicationLoanId?: string };

export function applyLoanMutation(state: Workspace, work: EditableLoan): Workspace {
  const { loanId } = work;
  const { id, officer, amount, stage } = work.loans[0];
  const application = work.applications[0];
  const campaignQueueFiles = state.campaignQueueFiles?.map((file) => file.id === loanId ? {
    id, officer, amount, stage, submittedAt: application?.versions.at(-1)?.submittedAt ?? application?.submittedAt ?? null,
    fundingDate: work.closingProgress[0]?.fundingDate ?? null,
  } : file);
  // A scoped queue may open a loan created after the workspace snapshot loaded.
  // Keep that file in the dialog until the workspace is loaded again.
  if (!state.loans.some(({ id }) => id === loanId)) return campaignQueueFiles ? { ...state, campaignQueueFiles } : { ...state };
  const replace = <T extends { loanId: string }>(rows: T[], updated: T[]) =>
    [...rows.filter((item) => item.loanId !== loanId), ...updated];
  return {
    ...state,
    ...(campaignQueueFiles ? { campaignQueueFiles } : {}),
    playbook: work.playbook,
    loans: state.loans.map((loan) => loan.id === loanId ? work.loans[0] : loan),
    applications: replace(state.applications, work.applications),
    closingPlans: replace(state.closingPlans, work.closingPlans),
    closingItems: replace(state.closingItems, work.closingItems),
    pastClients: replace(state.pastClients, work.pastClients),
    tasks: replace(state.tasks, work.tasks),
    documentRequests: replace(state.documentRequests, work.documentRequests),
    submissions: replace(state.submissions, work.submissions),
    communicationDrafts: replace(state.communicationDrafts, work.communicationDrafts)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    uwmAlerts: replace(state.uwmAlerts, work.uwmAlerts)
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)),
  };
}
