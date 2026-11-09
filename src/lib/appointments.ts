import { addApplicationActivity } from "./applications";
import { appointmentInput, appointmentInstant, appointmentsUnavailable, type Appointment, type AppointmentPage } from "./appointment-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { loanAccess } from "./workspace-access";

const pageSize = 20;
const columns = "id, title, startsAt, durationMinutes, ownerRole, cancelledAt, revision";

export function workOnAppointment(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date()): AppointmentPage | { error: string } {
  if (!staff || staff.brokerage.id !== brokerageId) return { error: appointmentsUnavailable };
  const actor = staff;
  const parsed = appointmentInput.safeParse(input);
  if (!parsed.success) return { error: "Enter a title, valid date and time, and a duration from 5 to 480 minutes." };
  const data = parsed.data;
  const processor = staff.brokerage.role === "Processor";
  const checkedAt = now.toISOString();
  const scope = processor ? "AND ownerRole = 'Processor'" : "";

  function scopedLoan() {
    if (!loanAccess(db, actor, data.loanId)) return undefined;
    return db.prepare(`SELECT loan.officer, loan.disposition, processing.processorEmail, processing.processorName
      FROM loans loan LEFT JOIN loan_processing processing ON processing.loanId = loan.id WHERE loan.id = ?`).get(data.loanId);
  }

  function page(loan: NonNullable<ReturnType<typeof scopedLoan>>, focusId?: string, message?: string): AppointmentPage {
    const rows = db.prepare(`SELECT ${columns} FROM loan_appointments WHERE loanId = ? ${scope}
      ORDER BY startsAt DESC, id DESC LIMIT ?`).all(data.loanId, pageSize + 1).map((row) => ({ ...row }) as unknown as Appointment);
    const items = rows.slice(0, pageSize);
    if (focusId && !items.some((item) => item.id === focusId)) {
      const focused = db.prepare(`SELECT ${columns} FROM loan_appointments WHERE loanId = ? AND id = ? ${scope}`)
        .get(data.loanId, focusId) as unknown as Appointment | undefined;
      if (focused) items.unshift({ ...focused });
    }
    const owners: AppointmentPage["owners"] = [];
    if (!processor) owners.push({ role: "Loan officer", name: String(loan.officer || "Unassigned loan officer") });
    if (loan.processorEmail) owners.push({ role: "Processor", name: String(loan.processorName || "Assigned processor") });
    return { items, hasMore: rows.length > pageSize, checkedAt, canSchedule: loan.disposition === "Active", owners, message };
  }

  if (data.type === "list") {
    const loan = scopedLoan();
    return loan ? page(loan, data.focusId) : { error: appointmentsUnavailable };
  }

  return db.transaction(() => {
    const loan = scopedLoan();
    if (!loan) return { error: appointmentsUnavailable };
    const current = db.prepare(`SELECT loanId, ${columns} FROM loan_appointments WHERE id = ?`).get(data.id);
    if (current && (current.loanId !== data.loanId || (processor && current.ownerRole !== "Processor"))) return { error: appointmentsUnavailable };
    if (data.type === "cancel") {
      if (current?.cancelledAt && current.revision === data.revision + 1) return page(loan, data.id, "Appointment canceled.");
      if (!current || current.cancelledAt || current.revision !== data.revision) return { error: "This appointment changed. Refresh before canceling it." };
      db.prepare("UPDATE loan_appointments SET cancelledAt = ?, revision = revision + 1 WHERE id = ?").run(checkedAt, data.id);
      addApplicationActivity(db, data.loanId, `Appointment canceled · ${current.title}`, checkedAt);
      return page(loan, data.id, "Appointment canceled.");
    }

    if ((processor && data.ownerRole !== "Processor") || (data.ownerRole === "Processor" && !loan.processorEmail)) {
      return { error: "Choose an assigned appointment owner." };
    }
    const startsAt = appointmentInstant(data.localStart);
    if (!startsAt) return { error: "Choose an Eastern time outside the skipped or repeated hour on the clock-change date." };
    const unchanged = current && current.title === data.title && current.startsAt === startsAt &&
      current.durationMinutes === data.durationMinutes && current.ownerRole === data.ownerRole;
    if (unchanged && !current.cancelledAt && (current.revision === data.revision || current.revision === data.revision + 1)) {
      return page(loan, data.id, "Appointment saved.");
    }
    if (current?.cancelledAt || (current?.revision ?? 0) !== data.revision) return { error: "This appointment changed. Refresh before editing it." };
    if (loan.disposition !== "Active") return { error: "Resume this loan before scheduling or moving an appointment." };
    if (startsAt <= checkedAt) return { error: "Choose a start time in the future." };
    if (current) {
      db.prepare(`UPDATE loan_appointments SET title = ?, startsAt = ?, durationMinutes = ?, ownerRole = ?, revision = revision + 1 WHERE id = ?`)
        .run(data.title, startsAt, data.durationMinutes, data.ownerRole, data.id);
    } else {
      db.prepare(`INSERT INTO loan_appointments (id, loanId, title, startsAt, durationMinutes, ownerRole, revision) VALUES (?, ?, ?, ?, ?, ?, 1)`)
        .run(data.id, data.loanId, data.title, startsAt, data.durationMinutes, data.ownerRole);
    }
    addApplicationActivity(db, data.loanId, `Appointment ${current ? "updated" : "scheduled"} · ${data.title} · ${data.localStart.replace("T", " ")} ET`, checkedAt);
    return page(loan, data.id, "Appointment saved.");
  });
}
