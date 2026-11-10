import type { Store } from "./store";

export const mockUwmReceiptTaskPrefix = "uwm-receipt:";
export type MockUwmPendingReceipt = { revision: number; attemptedAt: string };

type MockAcceptance = MockUwmPendingReceipt & { loanId: string; reference: string; receipt: string };

export function pendingMockUwmAcceptance(db: Store, loanId: string) {
  return db.prepare("SELECT loanId, revision, attemptedAt, reference, receipt FROM mock_uwm_acceptances WHERE loanId = ? AND reconciledAt IS NULL")
    .get(loanId) as MockAcceptance | undefined;
}

export function saveMockUwmAcceptance(db: Store, acceptance: MockAcceptance) {
  const { loanId, revision, attemptedAt, reference, receipt } = acceptance;
  db.prepare("INSERT INTO mock_uwm_acceptances (loanId, revision, attemptedAt, reference, receipt) VALUES (?, ?, ?, ?, ?)")
    .run(loanId, revision, attemptedAt, reference, receipt);
  db.prepare("INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, 'Check mock UWM submission receipt', ?)")
    .run(`${mockUwmReceiptTaskPrefix}${loanId}:${revision}`, loanId, attemptedAt);
}

export function closeMockUwmAcceptance(db: Store, loanId: string, revision: number, now: string) {
  db.prepare("UPDATE mock_uwm_acceptances SET reconciledAt = ? WHERE loanId = ? AND revision = ?")
    .run(now, loanId, revision);
  db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ? AND completedAt IS NULL")
    .run(now, `${mockUwmReceiptTaskPrefix}${loanId}:${revision}`);
}
