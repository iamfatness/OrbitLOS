import { addApplicationActivity } from "./applications";
import { documentRecipientAvailable } from "./borrower-documents";
import { easternDate } from "./client-retention";
import { shiftReportDate } from "./report-date-range";
import { serviceOrderLimit, serviceOrdersUnavailable, serviceOrderSlug, serviceReturnLimit, staleVerificationOrder, type ServiceOrder,
  type ServiceOrderCommand, type ServiceOrderQueuePage, type ServiceOrderQueueQuery } from "./service-order-model";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { isDemoStaff, loanAccess } from "./workspace-access";

export const openServiceOrderSql = "service.status IN ('Ordered', 'Received')";
export const serviceOrderOwnerEmailSql = "coalesce(processing.processorEmail, loan.officerEmail)";
export const serviceOrderOwnerSql = "coalesce(nullif(processing.processorName, ''), nullif(loan.officer, ''), 'Unassigned')";
const activeLoan = "loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed')";
const serviceLoan = `JOIN loans loan ON loan.id = service.loanId LEFT JOIN loan_processing processing ON processing.loanId = loan.id`;
const publicColumns = "service.id, service.loanId, service.kind, service.status, service.dueOn, service.recipient";
const orderColumns = `${publicColumns}, service.revision, service.createdAt, service.createdBy, service.note, service.returns, service.cancellation, service.applicationRevision,
  ${serviceOrderOwnerSql} AS owner`;
type StoredServiceOrder = Omit<ServiceOrder, "returns"> & { returns: string; lastCommand: string | null; originalDueOn: string };
const orderView = ({ returns, ...order }: Omit<StoredServiceOrder, "lastCommand" | "originalDueOn">): ServiceOrder =>
  ({ ...order, returns: JSON.parse(returns) as ServiceOrder["returns"] });

export function canUseServiceOrders(staff: WorkspaceStaff | null) {
  return isDemoStaff(staff) || !!staff?.brokerage.pilot;
}

export function loanServiceOrders(db: Store, loanId: string) {
  const rows = db.prepare(`SELECT ${orderColumns} FROM service_orders service ${serviceLoan}
    WHERE service.loanId = ? ORDER BY NOT ${openServiceOrderSql}, service.dueOn, service.createdAt DESC, service.id LIMIT ?`)
    .all(loanId, serviceOrderLimit) as unknown as Omit<StoredServiceOrder, "lastCommand" | "originalDueOn">[];
  return rows.map(orderView);
}

export function readServiceOrderQueue(db: Store, query: ServiceOrderQueueQuery, staff: WorkspaceStaff, now: Date): ServiceOrderQueuePage {
  const today = easternDate(now);
  const filters: string[] = [activeLoan, openServiceOrderSql];
  const params: SqlValue[] = [];
  if (staff.brokerage.role === "Processor") {
    filters.push("processing.processorEmail = ?");
    params.push(staff.email);
  }
  if (query.view === "Overdue") {
    filters.push("service.dueOn < ?");
    params.push(today);
  }
  if (query.view === "Ready to review") filters.push("service.status = 'Received'");
  if (query.after) {
    filters.push("(service.dueOn, service.id) > (?, ?)");
    params.push(query.after.dueOn, query.after.id);
  }
  const limit = 20;
  const rows = db.prepare(`SELECT ${publicColumns}, ${serviceOrderOwnerSql} AS owner, contact.name FROM service_orders service
    ${serviceLoan} JOIN contacts contact ON contact.id = loan.contactId WHERE ${filters.join(" AND ")}
    ORDER BY service.dueOn, service.id LIMIT ?`).all(...params, limit + 1) as unknown as ServiceOrderQueuePage["rows"];
  const last = rows[limit - 1];
  return { today, rows: rows.slice(0, limit), next: rows.length > limit ? { dueOn: last.dueOn, id: last.id } : null };
}

export function changeServiceOrder(db: Store, data: ServiceOrderCommand, staff: WorkspaceStaff | null, at: string) {
  const { loanId, orderId } = data;
  if (!canUseServiceOrders(staff) || (staff && !loanAccess(db, staff, loanId))) return { error: serviceOrdersUnavailable } as const;
  const current = db.prepare(`SELECT ${orderColumns}, service.lastCommand, service.originalDueOn
    FROM service_orders service ${serviceLoan} WHERE service.id = ?`).get(orderId) as unknown as StoredServiceOrder | undefined;
  if (current && current.loanId !== loanId) return { error: "This order is unavailable on the loan." } as const;
  const actor = staff?.name ?? "Demo staff";
  if (!db.prepare(`SELECT 1 FROM loans loan WHERE loan.id = ? AND ${activeLoan}`).get(loanId)) {
    return { error: "Open an active loan to change a service order." } as const;
  }
  if (data.dueOn) {
    const today = easternDate(new Date(at));
    if (data.dueOn < shiftReportDate(today, -30) || data.dueOn > shiftReportDate(today, 365)) {
      return { error: "Choose a sample due date from the last 30 days through the next year." } as const;
    }
  }
  if (data.type === "createServiceOrder") {
    const recipient = data.recipient ?? null;
    if (current) return current.kind === data.kind && current.originalDueOn === data.dueOn && current.note === data.note && current.recipient === recipient &&
      (data.applicationRevision === undefined || current.applicationRevision === data.applicationRevision)
      ? { message: "Mock service order already recorded." } : { error: "This service order identifier has already been used." };
    if (recipient && !documentRecipientAvailable(db, loanId, recipient)) {
      return { error: "Add a co-borrower to this loan before recording their verification." };
    }
    if (recipient && data.applicationRevision === undefined) {
      return { error: "Reload the workspace to record a verification order with its 1003 revision." };
    }
    const applicationRevision = recipient ? db.prepare(`SELECT revision FROM applications
      WHERE loanId = ? AND submittedAt IS NOT NULL AND coalesce(correctionNote, '') = ''`).get(loanId)?.revision ?? null : null;
    if (recipient && data.applicationRevision !== applicationRevision) return { error: staleVerificationOrder };
    if (db.prepare(`SELECT 1 FROM service_orders service WHERE service.loanId = ? AND service.kind = ?
      AND coalesce(service.recipient, '') = ? AND ${openServiceOrderSql}`).get(loanId, data.kind, recipient ?? "")) {
      return { error: `An open mock ${data.kind.toLowerCase()} order already exists ${recipient ? `for the ${recipient.toLowerCase()}` : "on this loan"}.` };
    }
    if (Number(db.prepare("SELECT count(*) AS total FROM service_orders WHERE loanId = ?").get(loanId)?.total) >= serviceOrderLimit) {
      return { error: `This sample loan already has ${serviceOrderLimit} service orders.` };
    }
    db.prepare(`INSERT INTO service_orders (id, loanId, kind, dueOn, originalDueOn, createdAt, createdBy, note, recipient, applicationRevision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(orderId, loanId, data.kind, data.dueOn, data.dueOn, at, actor, data.note, recipient, applicationRevision);
    addApplicationActivity(db, loanId, `Recorded mock ${data.kind.toLowerCase()} order${recipient ? ` · ${recipient}` : ""} · Due ${data.dueOn} · ${actor}`, at);
    return { message: `Mock ${data.kind.toLowerCase()} order recorded.` };
  }

  const command = JSON.stringify(data);
  if (current?.revision === data.revision + 1 && current.lastCommand === command) return { message: "Mock service order already updated." };
  if (!current || current.revision !== data.revision) return { error: "This service order changed. Refresh the loan before updating it." } as const;
  if (current.status !== "Ordered" && current.status !== "Received") return { error: "This service order is closed." } as const;
  const returns = JSON.parse(current.returns) as ServiceOrder["returns"];
  let status: ServiceOrder["status"] = current.status;
  let cancellation = current.cancellation;
  let detail = "";
  switch (data.action) {
    case "Reschedule":
      detail = `Moved due date from ${current.dueOn} to ${data.dueOn}`;
      break;
    case "Simulate return":
      if (current.status !== "Ordered") return { error: "Review the returned evidence first." } as const;
      if (returns.length >= serviceReturnLimit) return { error: "This sample order reached its return limit. Start another order after closing it." } as const;
      returns.push({ reference: `MOCK-${serviceOrderSlug(current.kind).toUpperCase()}-${orderId.toUpperCase()}-V${returns.length + 1}`,
        returnedAt: at, receivedBy: actor });
      status = "Received";
      detail = "Received sample evidence";
      break;
    case "Accept":
    case "Request replacement": {
      const receipt = returns.at(-1);
      if (current.status !== "Received" || !receipt || receipt.review) return { error: "Refresh the order to review the current evidence." } as const;
      if (data.action === "Request replacement" && returns.length >= serviceReturnLimit) {
        return { error: "This sample order reached its return limit. Cancel it and start another order." } as const;
      }
      const accepted = data.action === "Accept";
      receipt.review = { at, actor, decision: accepted ? "Accepted" : "Replacement requested", note: data.note };
      status = accepted ? "Completed" : "Ordered";
      detail = accepted ? "Accepted sample evidence" : "Requested replacement sample evidence";
      break;
    }
    case "Cancel":
      status = "Cancelled";
      cancellation = data.note;
      detail = "Cancelled";
      break;
  }
  db.prepare(`UPDATE service_orders SET status = ?, dueOn = ?, returns = ?, cancellation = ?, lastCommand = ?, revision = revision + 1
    WHERE id = ?`).run(status, data.dueOn ?? current.dueOn, JSON.stringify(returns), cancellation, command, orderId);
  addApplicationActivity(db, loanId, `Mock ${current.kind.toLowerCase()} order${current.recipient ? ` · ${current.recipient}` : ""} · ${detail} · ${actor}${data.note ? ` · ${data.note}` : ""}`, at);
  return { message: `${detail} for mock ${current.kind.toLowerCase()} order.` };
}
