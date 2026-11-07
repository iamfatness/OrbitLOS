export interface UwmAlert {
  id: string;
  loanId: string;
  submissionId: string;
  kind: "Status changed" | "New condition" | "Reopened condition";
  conditionId: string | null;
  message: string;
  detectedAt: string;
  reviewedAt: string | null;
}

export function submissionTarget(submissionId: string) {
  return `lender-submission-${submissionId}`;
}

export function conditionTarget(submissionId: string, conditionId: string) {
  return `lender-condition-${submissionId}:${conditionId}`;
}
