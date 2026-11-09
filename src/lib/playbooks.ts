import { defaultPlaybook, fundingTaskId, reversedFundingTaskPrefix, type PlaybookSettings } from "./playbook-model";
import type { Store } from "./store";

const key = "brokeragePlaybook";

export function readPlaybook(db: Store): PlaybookSettings {
  const value = db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value;
  return typeof value === "string" ? { ...defaultPlaybook, ...JSON.parse(value) as Partial<PlaybookSettings> } : defaultPlaybook;
}

export function writePlaybook(db: Store, settings: PlaybookSettings) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify({ ...settings, revision: settings.revision + 1 }));
}

export function createFundingFollowUps(db: Store, loanId: string, dueAt: string, rescheduleOpen: boolean) {
  // Both audiences are written by one statement so a failed write cannot leave half the follow-up in place.
  return db.prepare(`INSERT INTO tasks (id, loanId, title, dueAt)
    SELECT ?, id, 'Post-funding borrower check-in', ? FROM loans WHERE id = ?
    UNION ALL SELECT ?, id, 'Thank the referring realtor', ? FROM loans WHERE id = ? AND partnerId IS NOT NULL
    ON CONFLICT(id) DO UPDATE SET dueAt = excluded.dueAt
      WHERE tasks.completedAt IS NULL AND tasks.dueAt <> excluded.dueAt AND ? = 1 RETURNING id`)
    .all(fundingTaskId(loanId, "borrower"), dueAt, loanId, fundingTaskId(loanId, "realtor"), dueAt, loanId, Number(rescheduleOpen)).length;
}

export function recordedFundingCheckIn(db: Store, loanId: string): string | undefined {
  const record = db.prepare(`SELECT checkIn.activityId FROM tasks task
    JOIN funding_check_ins checkIn ON checkIn.loanId = task.loanId
    JOIN contact_activity activity ON activity.id = checkIn.activityId AND activity.createdAt = task.completedAt
    WHERE task.id = ? AND task.loanId = ? ORDER BY checkIn.fundingRevision DESC LIMIT 1`).get(fundingTaskId(loanId, "borrower"), loanId);
  return typeof record?.activityId === "string" ? record.activityId : undefined;
}

export function retireFundingFollowUps(db: Store, loanId: string, revision: number) {
  const ids = [fundingTaskId(loanId, "borrower"), fundingTaskId(loanId, "realtor")];
  db.prepare("DELETE FROM tasks WHERE loanId = ? AND id IN (?, ?) AND completedAt IS NULL").run(loanId, ...ids);
  db.prepare(`UPDATE tasks SET id = ? || id, title = title || ' · Before funding reversal'
    WHERE loanId = ? AND id IN (?, ?) AND completedAt IS NOT NULL`).run(`${reversedFundingTaskPrefix}${revision}:`, loanId, ...ids);
}
