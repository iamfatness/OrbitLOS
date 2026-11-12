import { createHash } from "node:crypto";
import type { VersionedBrokerageMember } from "./brokerage-model";
import { easternDate, easternDayStart } from "./client-retention";
import { customReportWork } from "./custom-reports";
import { customReportLimit } from "./custom-report-model";
import { shiftReportDate } from "./report-date-range";
import { reportScheduleQuery, type ReportSchedule, type ReportScheduleCadence, type ReportSchedulePreview, type ReportScheduleReceipt,
  type ReportScheduleRecipient, type ReportScheduleResult } from "./report-schedule-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

type Recipient = ReportScheduleRecipient & { accessRevision: number };
type ScheduleRow = Omit<ReportSchedule, "state" | "recipients" | "paused"> & {
  recipients: string;
  paused: number;
  archivedAt: string | null;
  operationId: string;
  operationDigest: string;
};

const selectSchedule = `SELECT s.rowid AS archiveSequence, s.*, r.name AS reportName, r.revision AS currentReportRevision, r.archivedAt
  FROM custom_report_schedules s JOIN custom_reports r ON r.id = s.reportId`;
const changed = { error: "The schedule changed. Refresh it before continuing." };
const unavailable = { error: "Report schedules are available to admins in this brokerage." };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function monthlySlot(startsOn: string, monthOf: string, addMonth: number) {
  const month = new Date(`${monthOf.slice(0, 7)}-01T12:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() + addMonth + 1, 0);
  const end = month.toISOString().slice(0, 10);
  return end.slice(0, 8) + String(Math.min(Number(startsOn.slice(8)), Number(end.slice(8)))).padStart(2, "0");
}

function nextSlot(cadence: ReportScheduleCadence, startsOn: string, current: string) {
  return cadence === "Weekly" ? shiftReportDate(current, 7) : monthlySlot(startsOn, current, 1);
}

function firstSlot(cadence: ReportScheduleCadence, startsOn: string, from: string) {
  if (startsOn >= from) return startsOn;
  if (cadence === "Weekly") {
    const days = (Date.parse(from) - Date.parse(startsOn)) / 86_400_000;
    return shiftReportDate(startsOn, Math.ceil(days / 7) * 7);
  }
  const inMonth = monthlySlot(startsOn, from, 0);
  return inMonth < from ? monthlySlot(startsOn, from, 1) : inMonth;
}

function currentRecipients(row: ScheduleRow, roster: Recipient[]) {
  const configured = JSON.parse(row.recipients) as Recipient[];
  const matching = configured.map(recipient => roster.find(member =>
    member.email === recipient.email && member.accessRevision === recipient.accessRevision));
  return { configured, matching, valid: matching.every(Boolean) };
}

function project(row: ScheduleRow, roster: Recipient[]): ReportSchedule {
  const { reportId, reportName, reportRevision, currentReportRevision, revision, cadence, startsOn, nextOn, paused, archivedAt } = row;
  const { configured, matching, valid } = currentRecipients(row, roster);
  const state = archivedAt ? "Report archived" : reportRevision !== currentReportRevision ? "Report changed" :
    !valid ? "Recipients changed" : paused ? "Paused" : "Active";
  const recipients = configured.map(({ email, name }, index) => ({ email, name: matching[index]?.name ?? name }));
  return { reportId, reportName, reportRevision, currentReportRevision, revision, cadence, startsOn, nextOn, paused: Boolean(paused), recipients, state };
}

function previewReport(db: Store, row: ScheduleRow, roster: Recipient[], staff: WorkspaceStaff,
  date: string, today: string): ReportSchedulePreview | { error: string } {
  const schedule = project(row, roster);
  if (schedule.state !== "Active") return { error: "Review the saved report, recipients and schedule status before running it." };
  if (date > today) return { error: "The report is scheduled for a future day." };
  const run = customReportWork(db, { type: "run", id: schedule.reportId, revision: schedule.reportRevision },
    staff, staff.brokerage.id, new Date(easternDayStart(date)));
  if ("error" in run) return run;
  if (run.kind !== "run") return { error: "Could not calculate the report summary." };
  const { reportId, reportName, reportRevision, revision: scheduleRevision, recipients } = schedule;
  const { from, through, totals } = run;
  const metrics = Object.keys(totals) as ReportSchedulePreview["metrics"];
  const summary = { reportId, reportName, reportRevision, scheduleRevision, scheduledOn: date, recipients, from, through, metrics, totals };
  return { kind: "preview", ...summary, fingerprint: digest(summary) };
}

export function reportScheduleWork(db: Store, input: unknown, staff: WorkspaceStaff, brokerageId: string,
  members: VersionedBrokerageMember[], now = new Date()): ReportScheduleResult {
  const roster = members.filter((member): member is VersionedBrokerageMember & { accessRevision: number } =>
    member.status === "Active" && member.role === "Admin" && member.accessRevision !== undefined);
  if (staff.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin" ||
    !roster.some(member => member.email === staff.email && member.accessRevision === staff.brokerage.accessRevision)) return unavailable;
  const parsed = reportScheduleQuery.safeParse(input);
  if (!parsed.success) return { error: "Check the report schedule and recipient settings." };
  const query = parsed.data;
  const today = easternDate(now);
  const read = (id: string) => db.prepare(`${selectSchedule} WHERE s.reportId = ?`).get(id) as unknown as ScheduleRow | undefined;

  if (query.type === "list") {
    const active = db.prepare(`${selectSchedule} WHERE r.archivedAt IS NULL ORDER BY r.name COLLATE NOCASE, r.id LIMIT ?`)
      .all(customReportLimit) as unknown as ScheduleRow[];
    const archived = db.prepare(`${selectSchedule}
      WHERE r.archivedAt IS NOT NULL ${query.archiveBefore ? "AND s.rowid < ?" : ""} ORDER BY s.rowid DESC LIMIT 21`)
      .all(...(query.archiveBefore ? [query.archiveBefore] : [])) as unknown as (ScheduleRow & { archiveSequence: number })[];
    return { kind: "list", today, schedules: [...active, ...archived.slice(0, 20)].map(row => project(row, roster)),
      recipients: roster.map(({ email, name }) => ({ email, name })), nextArchive: archived.length > 20 ? archived[19].archiveSequence : null };
  }
  if (query.type === "history") {
    const rows = db.prepare(`SELECT sequence, receipt FROM custom_report_schedule_receipts WHERE reportId = ?
      ${query.before ? "AND sequence < ?" : ""} ORDER BY sequence DESC LIMIT 11`)
      .all(query.reportId, ...(query.before ? [query.before] : []));
    return { kind: "history", receipts: rows.slice(0, 10).map(row => JSON.parse(String(row.receipt)) as ReportScheduleReceipt),
      next: rows.length > 10 ? Number(rows[9].sequence) : null };
  }
  if (query.type === "preview") {
    const row = read(query.reportId);
    return row?.revision === query.revision && row.nextOn === query.scheduledOn
      ? previewReport(db, row, roster, staff, query.scheduledOn, today) : changed;
  }

  return db.transaction(() => {
    const row = read(query.reportId);
    const requestDigest = digest([staff.email, query]);
    const at = now.toISOString();
    if (query.type === "run") {
      const prior = db.prepare("SELECT requestDigest, receipt FROM custom_report_schedule_receipts WHERE operationId = ?").get(query.operationId);
      if (prior) return prior.requestDigest === requestDigest ? JSON.parse(String(prior.receipt)) as ReportScheduleReceipt : changed;
      if (!row || row.revision !== query.revision || row.nextOn !== query.scheduledOn) return changed;
      const preview = previewReport(db, row, roster, staff, query.scheduledOn, today);
      if ("error" in preview) return preview;
      const { fingerprint, ...summary } = preview;
      if (fingerprint !== query.fingerprint) return { error: "The report summary changed. Preview it again before running." };
      const nextOn = nextSlot(row.cadence, row.startsOn, row.nextOn);
      const receipt: ReportScheduleReceipt = {
        ...summary, kind: "receipt", id: query.operationId, recordedAt: at, actor: staff.name, nextOn,
      };
      db.prepare(`INSERT INTO custom_report_schedule_receipts (operationId, reportId, scheduledOn, actorEmail, requestDigest, receipt)
        VALUES (?, ?, ?, ?, ?, ?)`).run(receipt.id, query.reportId, query.scheduledOn, staff.email, requestDigest, JSON.stringify(receipt));
      db.prepare("UPDATE custom_report_schedules SET nextOn = ? WHERE reportId = ?").run(nextOn, row.reportId);
      return receipt;
    }

    if (row?.operationId === query.operationId) return row.operationDigest === requestDigest ? { kind: "saved", schedule: project(row, roster) } : changed;
    if ((row?.revision ?? 0) !== query.revision) return changed;
    if (db.prepare("SELECT 1 FROM custom_report_schedules WHERE operationId = ?").get(query.operationId)) return changed;
    if (query.type === "setPaused") {
      if (!row || row.archivedAt) return { error: "This saved report is unavailable." };
      const schedule = project(row, roster);
      if (!query.paused && schedule.state !== "Active" && schedule.state !== "Paused") return { error: "Review the report version and recipients before resuming." };
      if (schedule.paused === query.paused) return { kind: "saved", schedule };
      db.prepare("UPDATE custom_report_schedules SET paused = ?, revision = revision + 1, operationId = ?, operationDigest = ? WHERE reportId = ?")
        .run(Number(query.paused), query.operationId, requestDigest, query.reportId);
      accessEvent(db, staff, query.paused ? "Paused report schedule" : "Resumed report schedule", query.reportId, at);
    } else {
      const report = db.prepare("SELECT revision FROM custom_reports WHERE id = ? AND archivedAt IS NULL").get(query.reportId);
      if (!report || Number(report.revision) !== query.reportRevision) return { error: "Reload the current saved report before scheduling it." };
      const selected = roster.filter(member => query.recipients.includes(member.email));
      if (selected.length !== query.recipients.length) return { error: "Select active brokerage admins as recipients." };
      const recipients = JSON.stringify(selected.map(({ email, name, accessRevision }) => ({ email, name, accessRevision })));
      const newStart = query.startsOn !== row?.startsOn;
      if (newStart && query.startsOn < today) return { error: "Choose a first delivery date of today or later." };
      const last = db.prepare("SELECT max(scheduledOn) AS day FROM custom_report_schedule_receipts WHERE reportId = ?").get(query.reportId);
      const afterLast = typeof last?.day === "string" ? shiftReportDate(last.day, 1) : today;
      if (newStart && query.startsOn < afterLast) return { error: "Choose a first delivery date after the last recorded occurrence." };
      const nextOn = row && !newStart && row.cadence === query.cadence ? row.nextOn :
        firstSlot(query.cadence, query.startsOn, afterLast > today ? afterLast : today);
      db.prepare(`INSERT INTO custom_report_schedules
        (reportId, reportRevision, revision, cadence, startsOn, nextOn, recipients, paused, operationId, operationDigest)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(reportId) DO UPDATE SET
        reportRevision = excluded.reportRevision, revision = excluded.revision, cadence = excluded.cadence, startsOn = excluded.startsOn,
        nextOn = excluded.nextOn, recipients = excluded.recipients, operationId = excluded.operationId, operationDigest = excluded.operationDigest`)
        .run(query.reportId, query.reportRevision, query.revision + 1, query.cadence, query.startsOn, nextOn,
          recipients, row?.paused ?? 0, query.operationId, requestDigest);
      accessEvent(db, staff, "Saved report schedule", query.reportId, at);
    }
    const saved = read(query.reportId);
    if (!saved) throw new Error("Could not read the saved report schedule.");
    return { kind: "saved", schedule: project(saved, roster) };
  });
}
