import type { Store } from "./store";

export function createApplicationFollowUps(db: Store, loanId: string | null = null) {
  db.prepare(`
    INSERT INTO tasks (id, loanId, title, dueAt)
    SELECT 'application-follow-up:' || loanId, loanId, 'Follow up on 1003',
      strftime('%Y-%m-%dT%H:%M:%fZ', submittedAt, '+1 day')
    FROM applications
    WHERE submittedAt IS NOT NULL AND reviewedAt IS NULL AND (? IS NULL OR loanId = ?)
    ON CONFLICT(id) DO NOTHING
  `).run(loanId, loanId);
}

export function closeReviewedApplicationFollowUps(db: Store) {
  db.exec(`UPDATE tasks SET completedAt = application.reviewedAt
    FROM applications application
    WHERE tasks.id = 'application-follow-up:' || application.loanId
      AND tasks.loanId = application.loanId AND tasks.completedAt IS NULL AND application.reviewedAt IS NOT NULL`);
}
