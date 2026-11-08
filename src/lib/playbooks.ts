import { afterHours, defaultPlaybook, fundingTaskPrefix, type PlaybookSettings } from "./playbook-model";
import type { Store } from "./store";

const key = "brokeragePlaybook";

export function readPlaybook(db: Store): PlaybookSettings {
  const value = db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value;
  return typeof value === "string" ? JSON.parse(value) as PlaybookSettings : defaultPlaybook;
}

export function writePlaybook(db: Store, settings: PlaybookSettings) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify({ ...settings, revision: settings.revision + 1 }));
}

export function createFundingFollowUps(db: Store, loanId: string, fundingDate: string, dateChanged: boolean) {
  const dueAt = afterHours(`${fundingDate}T21:00:00.000Z`, readPlaybook(db).fundingDays * 24);
  const add = db.prepare(`INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET dueAt = excluded.dueAt WHERE tasks.completedAt IS NULL AND ? = 1`);
  add.run(`${fundingTaskPrefix}borrower:${loanId}`, loanId, "Post-funding borrower check-in", dueAt, Number(dateChanged));
  if (db.prepare("SELECT partnerId FROM loans WHERE id = ?").get(loanId)?.partnerId) {
    add.run(`${fundingTaskPrefix}realtor:${loanId}`, loanId, "Thank the referring realtor", dueAt, Number(dateChanged));
  }
}
