import { afterHours, fundingTaskId } from "./playbook-model";
import { demoBrokerageId } from "./brokerage-model";
import { campaignFollowUpPage, previewCampaignRecovery, recoverCampaignFollowUps, retryCampaignFollowUp } from "./campaign-follow-up-runs";
import { checkDocumentReminders, documentReminderPage, previewDocumentRecovery, readDocumentReminderSchedule, recoverDocumentReminders,
  retryDocumentReminder, setDocumentReminderSchedule } from "./document-reminder-runs";
import { playbookRunInput, playbookRunsUnavailable, type FundingPlaybookRun, type PlaybookAttempt, type PlaybookRun, type PlaybookRunResult } from "./playbook-run-model";
import { createFundingFollowUps, readPlaybook } from "./playbooks";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

type RunRow = Omit<FundingPlaybookRun, "borrower" | "canRetry" | "source"> & { rescheduleOpen: number };
const pageSize = 20;
const runColumns = `run.id, run.loanId, run.status, run.reason, run.at, run.attemptCount, run.fundingDate, run.fundingRevision,
  run.ruleRevision, run.delayDays, run.dueAt`;

export function supersedeFundingPlaybook(db: Store, loanId: string, reason: "Funding date corrected" | "Funding reversed") {
  db.prepare("UPDATE playbook_runs SET status = 'Superseded', reason = ? WHERE loanId = ? AND status <> 'Superseded'").run(reason, loanId);
}

function attemptFundingTasks(db: Store, run: RunRow, mode: PlaybookAttempt["mode"], operationId: string, actor: string, at: string, simulate = false) {
  let status: PlaybookAttempt["status"] = "Failed";
  let reason = "Fictional pilot interrupted the task write.";
  let taskChanges = 0;
  if (!simulate) {
    try {
      taskChanges = createFundingFollowUps(db, run.loanId, run.dueAt, Boolean(run.rescheduleOpen) && mode !== "Reconcile");
      status = "Completed";
      reason = taskChanges ? `${taskChanges} ${taskChanges === 1 ? "task created or updated" : "tasks created or updated"}.` : "Follow-up tasks were already up to date.";
    } catch {
      reason = "Orbit could not write the follow-up tasks. Retry this run from Playbooks.";
    }
  }
  if (status === "Failed" && mode === "Trigger" && run.rescheduleOpen) {
    db.prepare("DELETE FROM tasks WHERE loanId = ? AND completedAt IS NULL AND id IN (?, ?)")
      .run(run.loanId, fundingTaskId(run.loanId, "borrower"), fundingTaskId(run.loanId, "realtor"));
  }
  const attempt = run.attemptCount + 1;
  db.prepare(`INSERT INTO playbook_run_attempts (runId, attempt, operationId, mode, status, reason, actor, at, taskChanges)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(run.id, attempt, operationId, mode, status, reason, actor, at, taskChanges);
  db.prepare("UPDATE playbook_runs SET status = ?, reason = ?, attemptCount = ? WHERE id = ?").run(status, reason, attempt, run.id);
  return status;
}

export function startFundingPlaybook(db: Store, trigger: { loanId: string; fundingDate: string; fundingRevision: number; dateChanged: boolean;
  actor: string; at: string; simulate: boolean }) {
  const { loanId, fundingDate, fundingRevision, dateChanged, actor, at, simulate } = trigger;
  if (dateChanged) supersedeFundingPlaybook(db, loanId, "Funding date corrected");
  else {
    const current = db.prepare(`SELECT ${runColumns}, run.rescheduleOpen FROM playbook_runs run WHERE loanId = ? AND status <> 'Superseded'`)
      .get(loanId) as unknown as RunRow | undefined;
    if (current) {
      if (current.status === "Failed") return current.status;
      const missing = db.prepare(`SELECT 1 FROM loans loan WHERE loan.id = ? AND (NOT EXISTS (SELECT 1 FROM tasks WHERE id = ?) OR
        (loan.partnerId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = ?)))`)
        .get(loanId, fundingTaskId(loanId, "borrower"), fundingTaskId(loanId, "realtor"));
      return missing ? attemptFundingTasks(db, current, "Reconcile", crypto.randomUUID(), actor, at) : current.status;
    }
  }
  const policy = readPlaybook(db);
  const id = crypto.randomUUID();
  const dueAt = afterHours(`${fundingDate}T21:00:00.000Z`, policy.fundingDays * 24);
  const run: RunRow = { id, loanId, fundingDate, fundingRevision, ruleRevision: policy.revision, delayDays: policy.fundingDays, dueAt,
    rescheduleOpen: Number(dateChanged), status: "Failed", reason: "", attemptCount: 0, at };
  db.prepare(`INSERT INTO playbook_runs (id, loanId, fundingDate, fundingRevision, ruleRevision, delayDays, dueAt, rescheduleOpen, status, reason, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, loanId, fundingDate, fundingRevision, policy.revision, policy.fundingDays, dueAt, run.rescheduleOpen, run.status, run.reason, at);
  return attemptFundingTasks(db, run, dateChanged ? "Trigger" : "Reconcile", id, actor, at, simulate);
}

function retryResult(status: RunRow["status"]): PlaybookRunResult {
  return { kind: "retry", status, message: status === "Completed" ? "Post-funding follow-up is ready." : status === "Failed" ?
    "The follow-up still needs attention. The attempt was recorded." : "The funding entry changed. This run has been superseded." };
}

export function playbookRunWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date(), canSchedule = false): PlaybookRunResult {
  if (staff?.brokerage.role !== "Admin" || staff.brokerage.id !== brokerageId) return { error: playbookRunsUnavailable };
  const parsed = playbookRunInput.safeParse(input);
  if (!parsed.success) return { error: "Check the automation run selection and try again." };
  const data = parsed.data;
  const documentReminders = staff.brokerage.pilot || brokerageId === demoBrokerageId;
  if (data.type === "documentSchedule") return readDocumentReminderSchedule(db, documentReminders && canSchedule);
  if (data.type === "setDocumentSchedule") return documentReminders && canSchedule ? setDocumentReminderSchedule(db, data, staff, now) : { error: playbookRunsUnavailable };
  if (data.type === "checkDocuments") return documentReminders ? checkDocumentReminders(db, data, staff, now) : { error: playbookRunsUnavailable };
  if (data.type === "previewDocumentRecovery") return documentReminders ? previewDocumentRecovery(db, now) : { error: playbookRunsUnavailable };
  if (data.type === "recoverDocuments") return documentReminders ? recoverDocumentReminders(db, data, staff, now) : { error: playbookRunsUnavailable };
  if (data.type === "previewCampaignRecovery") return previewCampaignRecovery(db, data.runId);
  if (data.type === "recoverCampaignFollowUps") return recoverCampaignFollowUps(db, data, staff, now.toISOString());
  if (data.type !== "list" && data.source === "document" && !documentReminders) return { error: playbookRunsUnavailable };
  if (data.type === "list") {
    const status = data.filter === "All runs" ? [] : [data.filter];
    const after = data.after ? [data.after.at, data.after.id] : [];
    const all = !data.automation || data.automation === "All automations";
    const funding = (!all && data.automation !== "Post-funding follow-up") || data.filter === "Paused" ? [] : db.prepare(`SELECT 'funding' AS source, ${runColumns}, contact.name AS borrower,
      (run.status = 'Failed' AND loan.disposition = 'Active' AND progress.fundingDate = run.fundingDate) AS canRetry
      FROM playbook_runs run JOIN loans loan ON loan.id = run.loanId JOIN contacts contact ON contact.id = loan.contactId
      LEFT JOIN closing_progress progress ON progress.loanId = loan.id
      WHERE 1 = 1 ${status.length ? "AND run.status = ?" : ""} ${after.length ? "AND (run.at, run.id) < (?, ?)" : ""}
      ORDER BY run.at DESC, run.id DESC LIMIT ?`).all(...status, ...after, pageSize + 1) as unknown as FundingPlaybookRun[];
    const campaign = all || data.automation === "Campaign follow-up" ? campaignFollowUpPage(db, data, pageSize + 1) : [];
    const documents = documentReminders && (all || data.automation === "Document reminders") ? documentReminderPage(db, data, now, pageSize + 1) : [];
    const rows: PlaybookRun[] = [...funding, ...campaign, ...documents];
    rows.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
    const runs = rows.slice(0, pageSize).map((run) => ({ ...run, canRetry: Boolean(run.canRetry) }));
    const last = runs.at(-1);
    return { kind: "list", runs, next: rows.length > pageSize && last ? { id: last.id, at: last.at } : null };
  }
  if (data.type === "attempts") {
    const tables = { campaign: ["campaign_follow_up_runs", "campaign_follow_up_attempts"],
      document: ["document_reminder_runs", "document_reminder_attempts"], funding: ["playbook_runs", "playbook_run_attempts"] } as const;
    const [table, attemptsTable] = tables[data.source ?? "funding"];
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(data.id)) return { error: playbookRunsUnavailable };
    const rows = db.prepare(`SELECT attempt, mode, status, reason, actor, at, taskChanges FROM ${attemptsTable}
      WHERE runId = ? ${data.before ? "AND attempt < ?" : ""} ORDER BY attempt DESC LIMIT ?`)
      .all(data.id, ...(data.before ? [data.before] : []), pageSize + 1) as unknown as PlaybookAttempt[];
    const attempts = rows.slice(0, pageSize);
    return { kind: "attempts", attempts, before: rows.length > pageSize ? attempts.at(-1)?.attempt ?? null : null };
  }
  return db.transaction(() => {
    if (data.source === "campaign") return retryCampaignFollowUp(db, data, staff.name, now.toISOString());
    if (data.source === "document") return retryDocumentReminder(db, data, staff, now);
    const run = db.prepare(`SELECT ${runColumns}, run.rescheduleOpen, loan.disposition, progress.fundingDate AS currentFundingDate
      FROM playbook_runs run JOIN loans loan ON loan.id = run.loanId LEFT JOIN closing_progress progress ON progress.loanId = run.loanId WHERE run.id = ?`)
      .get(data.id) as unknown as (RunRow & { disposition: string; currentFundingDate: string | null }) | undefined;
    if (!run) return { error: playbookRunsUnavailable };
    const prior = db.prepare("SELECT attempt, mode FROM playbook_run_attempts WHERE runId = ? AND operationId = ?").get(data.id, data.operationId);
    if (prior) return prior.mode === "Retry" && prior.attempt === data.attempt + 1 ? retryResult(run.status) : { error: "This retry identifier is already in use." };
    if (run.status !== "Failed" || run.currentFundingDate !== run.fundingDate || run.disposition !== "Active") {
      return { error: "Only a failed run for the current funding entry on an active file can be retried." };
    }
    if (data.attempt !== run.attemptCount) return { error: "This run changed. Refresh the automation history before retrying." };
    return retryResult(attemptFundingTasks(db, run, "Retry", data.operationId, staff.name, now.toISOString()));
  });
}
