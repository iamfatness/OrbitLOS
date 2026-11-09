import { addApplicationActivity } from "./applications";
import type { ContactActivity } from "./model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { accessEvent } from "./workspace-access";

export function setClosingTarget(db: Store, loanId: string, previous: string | null, targetDate: string | null, now: string) {
  if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(loanId)) return { error: "This loan no longer exists." } as const;
  const current = db.prepare("SELECT targetDate FROM closing_plans WHERE loanId = ?").get(loanId)?.targetDate ?? null;
  if (current !== targetDate) {
    if (current !== previous) return { error: "The target closing date changed. Refresh the loan before saving." } as const;
    if (targetDate) {
      db.prepare(`INSERT INTO closing_plans (loanId, targetDate) VALUES (?, ?)
        ON CONFLICT(loanId) DO UPDATE SET targetDate = excluded.targetDate`).run(loanId, targetDate);
    } else db.prepare("DELETE FROM closing_plans WHERE loanId = ?").run(loanId);
    addApplicationActivity(db, loanId, targetDate ? `Target closing date set · ${targetDate}` : "Target closing date cleared.", now);
  }
  return { message: "Target closing date saved." };
}

export function setClosingChecklistStatus(db: Store, input: { loanId: string; itemId: string; revision: number; completed: boolean }, now: string) {
  const item = db.prepare("SELECT title, completedAt, revision FROM closing_items WHERE id = ? AND loanId = ?").get(input.itemId, input.loanId);
  if (!item) return { error: "This closing item is unavailable on the loan." } as const;
  if (Boolean(item.completedAt) !== input.completed) {
    if (item.revision !== input.revision) return { error: "This closing item changed. Refresh the loan before updating it." } as const;
    db.prepare("UPDATE closing_items SET completedAt = ?, revision = revision + 1 WHERE id = ?").run(input.completed ? now : null, input.itemId);
    addApplicationActivity(db, input.loanId, `${input.completed ? "Completed closing item" : "Reopened closing item"} · ${item.title}`, now);
  }
  return { message: input.completed ? "Closing item completed." : "Closing item reopened." };
}

export function setDocumentDeadline(db: Store, input: { loanId: string; requestId: string; revision: number; deadlineRevision: number; dueOn: string | null },
  staff: WorkspaceStaff | null, now: string) {
  const request = db.prepare(`SELECT kind, revision, deadlineRevision, dueOn FROM document_requests
    WHERE id = ? AND loanId = ? AND status IN ('Requested', 'Needs replacement')`).get(input.requestId, input.loanId);
  if (!request || request.revision !== input.revision || (request.deadlineRevision !== input.deadlineRevision &&
    !(request.deadlineRevision === input.deadlineRevision + 1 && request.dueOn === input.dueOn))) {
    return { error: "This document request changed. Refresh the checklist before updating the due date." } as const;
  }
  const message = input.dueOn ? "Document due date saved." : "Document due date cleared.";
  if (request.dueOn !== input.dueOn) {
    db.prepare("UPDATE document_requests SET dueOn = ?, deadlineRevision = deadlineRevision + 1 WHERE id = ?").run(input.dueOn, input.requestId);
    const previous = request.dueOn ? ` from ${request.dueOn}` : "";
    const change = input.dueOn ? `due date set${previous} to ${input.dueOn}` : `due date cleared${previous}`;
    addApplicationActivity(db, input.loanId, `Document ${change} · ${request.kind}`, now);
    if (staff?.brokerage.pilot) accessEvent(db, staff, "Changed document due date", input.loanId, now);
  }
  return { message };
}

export function completeContactFollowUp(db: Store, input: { contactId: string; eventId: string; revision: number; completed: boolean;
  resolution?: Pick<NonNullable<ContactActivity["latestCompletion"]>, "outcome" | "note"> }, staff: StaffIdentity | null,
  prior: Record<string, SqlValue> | undefined, suppressed: boolean, now: string) {
  if (!prior?.dueAt || prior.contactId !== input.contactId) return { error: "This follow-up is unavailable." } as const;
  const author = staff?.email ?? null;
  if (Boolean(prior.completedAt) !== input.completed) {
    if (prior.revision !== input.revision) return { error: "The follow-up changed. Refresh before continuing." } as const;
    if (suppressed && prior.purpose === "Prospecting") return { error: "This borrower opted out of brokerage outreach." } as const;
    db.prepare("UPDATE contact_activity SET completedAt = ?, revision = revision + 1 WHERE id = ?").run(input.completed ? now : null, input.eventId);
    if (input.completed) {
      db.prepare(`INSERT INTO contact_follow_up_completions (activityId, revision, completedAt, actor, actorEmail, outcome, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(input.eventId, input.revision + 1, now, staff?.name || "Alex Morgan", author, input.resolution?.outcome ?? null, input.resolution?.note ?? "");
    }
  } else if (input.resolution) {
    const existing = db.prepare(`SELECT actorEmail, outcome, note FROM contact_follow_up_completions
      WHERE activityId = ? AND revision = ?`).get(input.eventId, input.revision + 1);
    if (prior.revision !== input.revision + 1 || !existing || existing.actorEmail !== author ||
      existing.outcome !== input.resolution.outcome || existing.note !== input.resolution.note) {
      return { error: "The follow-up was already completed. Refresh to see the recorded outcome." } as const;
    }
  }
  return { message: input.completed ? "Contact follow-up completed." : "Contact follow-up reopened." };
}
