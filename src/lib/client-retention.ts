import { z } from "zod";
import type { Loan, PastClientProfile } from "./model";
import type { Store } from "./store";

const rateInput = z.string().trim().refine((value) => value === "" || /^(?:\d{1,2}(?:\.\d{1,3})?|\.\d{1,3})$/.test(value),
  "Enter a rate with up to three decimal places.");
export const retentionInput = z.object({
  type: z.literal("saveRetention"), loanId: z.string().min(1).max(100), revision: z.number().int().nonnegative(),
  closingDate: z.union([z.iso.date(), z.literal("")]), currentRate: rateInput, targetRate: rateInput, observedRate: rateInput,
  watchEnabled: z.boolean(), note: z.string().trim().max(1000),
}).superRefine((input, context) => {
  if (input.watchEnabled && (!input.currentRate || !input.targetRate || Number(input.targetRate) >= Number(input.currentRate))) {
    context.addIssue({ code: "custom", message: "Enter a current rate and a lower target rate to enable the watchlist." });
  }
});

export function easternDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function pastClientLoan(loan: Pick<Loan, "stage">) {
  return loan.stage === "Funded" || loan.stage === "Closed";
}

export function nextAnniversary(closingDate: string, today: string) {
  const [year, month, day] = closingDate.split("-").map(Number);
  const candidate = (targetYear: number) => {
    const days = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
    return `${targetYear}-${String(month).padStart(2, "0")}-${String(Math.min(day, days)).padStart(2, "0")}`;
  };
  let targetYear = Math.max(year + 1, Number(today.slice(0, 4)));
  if (candidate(targetYear) < today) targetYear++;
  return candidate(targetYear);
}

export function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium" }).format(new Date(date + "T12:00:00Z"));
}

export function rateTargetReached(profile: Pick<PastClientProfile, "watchEnabled" | "targetRate" | "observedRate">) {
  return profile.watchEnabled && profile.targetRate !== null && profile.observedRate !== null && profile.observedRate <= profile.targetRate;
}

export function synchronizeRetentionTasks(db: Store, now = new Date()) {
  const today = easternDate(now);
  const profiles = db.prepare(`SELECT profile.*, loans.stage FROM past_client_profiles profile JOIN loans ON loans.id = profile.loanId`).all();
  for (const row of profiles) {
    const profile = row as Omit<PastClientProfile, "watchEnabled"> & { watchEnabled: number; stage: Loan["stage"]; rateTriggered: number };
    const active = pastClientLoan(profile);
    const rateReady = active && rateTargetReached({ ...profile, watchEnabled: Boolean(profile.watchEnabled) });
    const rateId = "rate-watch:" + profile.loanId;
    const rateTask = db.prepare("SELECT completedAt FROM tasks WHERE id = ?").get(rateId);
    if (rateReady && (!profile.rateTriggered || !rateTask)) {
      db.prepare(`INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, 'Review past-client rate target', ?)
        ON CONFLICT (id) DO UPDATE SET dueAt = excluded.dueAt, completedAt = NULL`).run(rateId, profile.loanId, now.toISOString());
    }
    if (!rateReady && rateTask?.completedAt === null) db.prepare("DELETE FROM tasks WHERE id = ?").run(rateId);
    if (Boolean(profile.rateTriggered) !== rateReady) {
      db.prepare("UPDATE past_client_profiles SET rateTriggered = ? WHERE loanId = ?").run(rateReady ? 1 : 0, profile.loanId);
    }
    if (!active || !profile.closingDate) {
      db.prepare("DELETE FROM tasks WHERE loanId = ? AND id LIKE 'closing-anniversary:%' AND completedAt IS NULL").run(profile.loanId);
      continue;
    }
    const date = nextAnniversary(profile.closingDate, today);
    // Future tasks remain available even if the workspace is opened after the anniversary.
    db.prepare(`INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, 'Closing anniversary follow-up', ?)
      ON CONFLICT (id) DO NOTHING`).run("closing-anniversary:" + profile.loanId + ":" + date, profile.loanId, date + "T17:00:00.000Z");
  }
}
