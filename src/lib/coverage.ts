import { recordCampaignCall } from "./call-campaigns";
import { unansweredCampaignCall } from "./call-campaign-model";
import { campaignRefillNotice, campaignReleaseRouting, captureCampaignOptOutCapacity, refillCampaignsAfterOptOut,
  refillReleasedCampaignSlot, type CampaignOptOutRoster, type CampaignRefillRoster } from "./campaign-routing";
import { easternDate } from "./client-retention";
import type { VersionedBrokerageMember } from "./brokerage-model";
import { coverageUnavailable, type CoverageDetail, type CoverageInput, type CoverageItem, type CoverageResult, type CoverageWindow } from "./coverage-model";
import { completeContactFollowUp, setClosingChecklistStatus, setClosingTarget, setDocumentDeadline } from "./deadline-actions";
import { setImportedLeadTaskStatus } from "./lead-inbox";
import { loanAuditSnapshot, recordLoanAudit } from "./loan-audit";
import type { CalendarItem } from "./officer-queue-model";
import type { OutreachOptOutTarget } from "./outreach-preferences";
import { readCoverageDeadlines } from "./officer-queue";
import { shiftReportDate } from "./report-date-range";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const windowFields = "id, absentEmail, absentName, absentRole, backupEmail, backupName, backupRole, startsOn, endsOn, endedAt";
type StoredWindow = CoverageWindow & { absentAccessRevision: number; backupAccessRevision: number };
function findWindow(db: Store, id: string) {
  return db.prepare("SELECT * FROM staff_coverage WHERE id = ?").get(id) as unknown as StoredWindow | undefined;
}

function activeBackup(window: StoredWindow, staff: WorkspaceStaff, members: VersionedBrokerageMember[], today: string) {
  const backup = members.find(({ email, status }) => email === window.backupEmail && status === "Active");
  const absent = members.find(({ email, status }) => email === window.absentEmail && status === "Active");
  return window.backupEmail === staff.email && window.backupRole === staff.brokerage.role && !window.endedAt &&
    today >= window.startsOn && today <= window.endsOn && backup?.role === window.backupRole && absent?.role === window.absentRole &&
    (backup.accessRevision ?? 0) === window.backupAccessRevision && (absent.accessRevision ?? 0) === window.absentAccessRevision;
}

export function coverageParticipants(db: Store, input: CoverageInput, staff: WorkspaceStaff): string[] | "team" | null {
  const admin = staff.brokerage.role === "Admin";
  if (input.type === "list") return admin ? "team" : [];
  if (input.type === "schedule") return admin ? [input.absentEmail, input.backupEmail] : null;
  if (input.type === "end") return admin ? [] : null;
  const window = findWindow(db, input.id);
  return window?.backupEmail === staff.email ? [window.absentEmail, window.backupEmail] : null;
}

function asItem(row: CalendarItem): CoverageItem {
  const { kind, id, name, title, dueAt, overdue } = row;
  return { kind: kind as CoverageItem["kind"], id, name, title, dueAt, overdue };
}

function detail(db: Store, row: CalendarItem): CoverageDetail {
  let fields;
  switch (row.kind) {
    case "campaign":
      fields = db.prepare(`SELECT lead.phone, lead.email, campaign.name AS context, coalesce(follow.revision, 0) AS revision
        FROM referral_leads lead JOIN call_campaigns campaign ON campaign.id = ?
        LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id WHERE lead.id = ?`).get(row.campaignId ?? "", row.recordId);
      break;
    case "contact":
      fields = db.prepare(`SELECT contact.phone, contact.email, task.text AS context, task.revision
        FROM contact_activity task JOIN contacts contact ON contact.id = task.contactId WHERE task.id = ?`).get(row.id);
      break;
    case "lead-task": fields = db.prepare("SELECT phone, email FROM referral_leads WHERE id = ?").get(row.recordId); break;
    case "checklist": fields = db.prepare("SELECT revision FROM closing_items WHERE id = ?").get(row.id); break;
    case "document": fields = db.prepare("SELECT revision, deadlineRevision FROM document_requests WHERE id = ?").get(row.id); break;
  }
  return { ...asItem(row), revision: Number(fields?.revision ?? 0), deadlineRevision: Number(fields?.deadlineRevision ?? 0),
    phone: String(fields?.phone ?? ""), email: String(fields?.email ?? ""), context: String(fields?.context ?? "").slice(0, 500) };
}

export function coveredCampaignRouting(db: Store, input: CoverageInput, staff: WorkspaceStaff,
  members: VersionedBrokerageMember[], now = new Date()): {
  optOut?: OutreachOptOutTarget; release?: ReturnType<typeof campaignReleaseRouting>;
} {
  if (!staff.brokerage.pilot || input.type !== "act" || input.update.kind !== "campaign" || input.update.outcome === "Connected") return {};
  const window = findWindow(db, input.id);
  if (!window || !activeBackup(window, staff, members, easternDate(now)) ||
    db.prepare("SELECT 1 FROM coverage_operations WHERE id = ?").get(input.operationId)) return {};
  const [row] = readCoverageDeadlines(db, window, now, undefined, input.update).items;
  if (row?.kind !== "campaign" || detail(db, row).revision !== input.update.revision) return {};
  return input.update.outcome === "Opted out" ? { optOut: { kind: "lead", id: row.recordId } } : {
    release: campaignReleaseRouting(db, staff, { leadId: row.recordId, retryOutcome: input.update.outcome, coveredOwnerEmail: window.absentEmail }),
  };
}

export function coverageWork(db: Store, input: CoverageInput, staff: WorkspaceStaff, brokerageId: string,
  members: VersionedBrokerageMember[], now = new Date(), campaignOptOutRoster?: CampaignOptOutRoster,
  campaignRefillRoster?: CampaignRefillRoster): CoverageResult {
  const participants = staff.brokerage.id === brokerageId ? coverageParticipants(db, input, staff) : null;
  if (!participants) return { error: coverageUnavailable };
  const today = easternDate(now);
  const at = now.toISOString();
  const admin = staff.brokerage.role === "Admin";
  const active = (email: string) => members.find((member) => member.email === email && member.status === "Active");
  if (input.type === "list") {
    const rows = db.prepare(`SELECT ${windowFields} FROM staff_coverage ${admin ? "" : "WHERE absentEmail = ? OR backupEmail = ?"}
      ORDER BY CASE WHEN endedAt IS NOT NULL OR endsOn < ? THEN 2 WHEN startsOn <= ? THEN 0 ELSE 1 END,
      startsOn DESC, id DESC LIMIT 50`).all(...(admin ? [] : [staff.email, staff.email]), today, today);
    return { kind: "list", windows: rows.map((row) => ({ ...row }) as unknown as CoverageWindow),
      members: admin ? members.filter((member) => member.status === "Active") : [], today };
  }

  const saved = (message: string) => ({ kind: "saved" as const, message });
  return db.transaction(() => {
    if (input.type === "schedule") {
      const absent = active(input.absentEmail);
      const backup = active(input.backupEmail);
      if (!absent || !backup || absent.email === backup.email || (backup.role !== "Admin" &&
        ((absent.role === "Processor") !== (backup.role === "Processor")))) {
        return { error: "Choose an active backup who can cover this staff member’s role." };
      }
      const current = findWindow(db, input.id);
      if (current) return current.absentEmail === absent.email && current.backupEmail === backup.email &&
        current.startsOn === input.startsOn && current.endsOn === input.endsOn ? saved(current.endedAt ? "Coverage already ended." : "Coverage scheduled.") :
        { error: "Start a new coverage schedule." };
      if (input.startsOn < today || input.endsOn < input.startsOn || input.endsOn > shiftReportDate(input.startsOn, 29)) {
        return { error: "Choose an Eastern date range from today forward, up to 30 days." };
      }
      const conflict = db.prepare(`SELECT 1 FROM staff_coverage WHERE endedAt IS NULL AND startsOn <= ? AND endsOn >= ?
        AND (absentEmail IN (?, ?) OR backupEmail = ?)`).get(input.endsOn, input.startsOn, absent.email, backup.email, absent.email);
      if (conflict) return { error: "These dates overlap an absence or another coverage assignment for the selected staff." };
      db.prepare(`INSERT INTO staff_coverage (id, absentEmail, absentName, absentRole, backupEmail, backupName, backupRole,
        startsOn, endsOn, absentAccessRevision, backupAccessRevision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.id, absent.email, absent.name, absent.role, backup.email, backup.name, backup.role,
          input.startsOn, input.endsOn, absent.accessRevision ?? 0, backup.accessRevision ?? 0);
      accessEvent(db, staff, "Scheduled staff coverage", `${absent.name} → ${backup.name} · ${input.startsOn} to ${input.endsOn}`, at);
      return saved("Coverage scheduled.");
    }
    const window = findWindow(db, input.id);
    if (!window) return { error: coverageUnavailable };
    if (input.type === "end") {
      if (!window.endedAt && window.endsOn >= today) {
        db.prepare("UPDATE staff_coverage SET endedAt = ? WHERE id = ?").run(at, window.id);
        accessEvent(db, staff, "Ended staff coverage", `${window.absentName} → ${window.backupName}`, at);
      }
      return saved("Coverage ended.");
    }
    if (!activeBackup(window, staff, members, today)) return { error: coverageUnavailable };

    if (input.type === "queue") {
      const page = readCoverageDeadlines(db, window, now, input.after);
      return { kind: "queue", items: page.items.map(asItem), next: page.next };
    }
    if (input.type === "item") {
      const [row] = readCoverageDeadlines(db, window, now, undefined, input.item).items;
      return row ? { kind: "item", item: detail(db, row) } : { error: coverageUnavailable };
    }
    const request = JSON.stringify(input.update);
    const prior = db.prepare("SELECT coverageId, actor, request, message FROM coverage_operations WHERE id = ?").get(input.operationId);
    if (prior) return prior.coverageId === window.id && prior.actor === staff.email && prior.request === request ? saved(String(prior.message)) :
      { error: "This action ID was already used. Reopen the work item." };
    const change = input.update;
    const [row] = readCoverageDeadlines(db, window, now, undefined, change).items;
    if (!row) return { error: coverageUnavailable };
    if ("dueOn" in change && (change.dueOn < today || change.dueOn === row.dueAt)) return { error: "Choose a different due date on or after today." };

    const loanId = row.recordId;
    const optOutCapacity = change.kind === "campaign" && change.outcome === "Opted out"
      ? captureCampaignOptOutCapacity(db, staff, campaignOptOutRoster) : [];
    const release = campaignRefillRoster && change.kind === "campaign" && unansweredCampaignCall(change.outcome)
      ? campaignReleaseRouting(db, staff, { leadId: row.recordId, retryOutcome: change.outcome, coveredOwnerEmail: window.absentEmail }) : undefined;
    let result;
    switch (change.kind) {
      case "campaign":
        if (!row.campaignId) return { error: coverageUnavailable };
        result = recordCampaignCall(db, staff, { type: "recordCampaignCall", campaignId: row.campaignId, leadId: row.recordId,
          revision: change.revision, outcome: change.outcome, note: change.note, callbackAt: null }, at, window.absentEmail);
        break;
      case "lead-task":
        if (row.dueAt !== change.previous) return { error: "The follow-up deadline changed. Reopen the work item." };
        result = setImportedLeadTaskStatus(db, { leadId: row.recordId, taskId: row.id, completed: true }, at, window.absentEmail);
        break;
      case "contact":
        result = completeContactFollowUp(db, { contactId: row.recordId, eventId: row.id, revision: change.revision, completed: true,
          resolution: { outcome: change.outcome, note: change.note } }, staff, db.prepare("SELECT * FROM contact_activity WHERE id = ?").get(row.id), false, at);
        break;
      case "closing": {
        const before = loanAuditSnapshot(db, loanId);
        result = setClosingTarget(db, loanId, change.previous, change.dueOn, at);
        if (!("error" in result)) recordLoanAudit(db, loanId, staff, "Updated closing target during coverage", at, before);
        break;
      }
      case "checklist": result = setClosingChecklistStatus(db, { loanId, itemId: row.id, revision: change.revision, completed: true }, at); break;
      case "document": result = setDocumentDeadline(db, { loanId, requestId: row.id, revision: change.revision,
        deadlineRevision: change.deadlineRevision, dueOn: change.dueOn }, staff, at); break;
    }
    if ("error" in result) return { error: result.error ?? coverageUnavailable };
    const refilled = "releasedCampaignSlot" in result && result.releasedCampaignSlot ?
      refillReleasedCampaignSlot(db, staff, release, at, campaignRefillRoster) : 0;
    const message = result.message + campaignRefillNotice(refilled + refillCampaignsAfterOptOut(db, staff, optOutCapacity, at, campaignOptOutRoster));
    accessEvent(db, staff, "Worked staff coverage item", `${window.id} · ${change.kind} · ${row.id}`, at);
    db.prepare("INSERT INTO coverage_operations VALUES (?, ?, ?, ?, ?)").run(input.operationId, window.id, staff.email, request, message);
    return saved(message);
  });
}
