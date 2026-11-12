import { closingWorkloadWindows, processingWorkspaceInput, processingViewFilters, processorQueueQuery, processorQueueUnavailable, type ProcessingWorkload, type ProcessorQueueFile, type ProcessorQueuePage, type ProcessorQueueQuery } from "./processor-queue-model";
import { easternDate } from "./client-retention";
import { readProcessingConversationReplies } from "./conversations";
import { activeProcessingLoan, processingAcceptanceReady, processingReviewReady, unassignedProcessingLoan } from "./loan-processing";
import { afterHours } from "./playbook-model";
import { readPlaybook } from "./playbooks";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { conditionTarget } from "./uwm-alert-model";
import { closingChecklistTarget } from "./loan-workflow";
import { shiftReportDate } from "./report-date-range";
import { canUseServiceOrders, readServiceOrderQueue } from "./service-orders";
import { serviceOrdersUnavailable } from "./service-order-model";
import { changeDashboardView, readDashboardViews } from "./dashboard-views";
import { processorFeeWork } from "./processor-fee-terms";

const pageSize = 20;
const fields = "loan.id, contact.name, loan.officer, plan.targetDate, profile.closingDate";
const closingJoins = `JOIN contacts contact ON contact.id = loan.contactId LEFT JOIN closing_plans plan ON plan.loanId = loan.id
  LEFT JOIN past_client_profiles profile ON profile.loanId = loan.id`;
type BaseFile = Omit<ProcessorQueueFile, "condition" | "closing">;
const assignedProcessing = `processing.processorEmail IS NOT NULL
  AND processing.status IN ('Assigned', 'Ready for processing', 'In processing', 'Returned to LO')`;

function closingWorkload(db: Store, query: NonNullable<ProcessorQueueQuery["workload"]>, staff: WorkspaceStaff, now: Date) {
  const personal = staff.brokerage.role === "Processor";
  const selected = personal ? staff.email : query.processor;
  const today = easternDate(now);
  const through = shiftReportDate(today, 6);
  const cohort = `WITH cohort AS (
    SELECT loan.id, loan.officer, loan.contactId, plan.targetDate, profile.closingDate,
      coalesce(processing.processorEmail, 'unassigned') AS processorEmail, coalesce(processing.processorName, '') AS processorName,
      coalesce(processing.status, 'Unassigned') AS status, coalesce(processing.updatedAt, app.reviewedAt, loan.stageSince) AS updatedAt,
      CASE WHEN processing.processorEmail IS NULL THEN coalesce(processing.revision, 0) END AS assignmentRevision,
      coalesce(profile.closingDate, plan.targetDate, '9999-12-31') AS sortDate,
      CASE WHEN profile.closingDate IS NOT NULL THEN 'Closing recorded' WHEN plan.targetDate IS NULL THEN 'No target'
        WHEN plan.targetDate < ? THEN 'Past target' WHEN plan.targetDate <= ? THEN 'Next 7 days' ELSE 'Later' END AS window
    FROM loans loan LEFT JOIN loan_processing processing ON processing.loanId = loan.id
    LEFT JOIN applications app ON app.loanId = loan.id LEFT JOIN closing_plans plan ON plan.loanId = loan.id
    LEFT JOIN past_client_profiles profile ON profile.loanId = loan.id
    WHERE ${activeProcessingLoan} AND (${assignedProcessing} OR (${unassignedProcessingLoan} AND ${processingReviewReady}))
      ${personal ? "AND processing.processorEmail = ?" : ""}
  )`;
  const args = [today, through, ...(personal ? [staff.email] : [])];
  const groups = db.prepare(`${cohort} SELECT processorEmail, max(nullif(processorName, '')) AS name, window, count(*) AS files
    FROM cohort GROUP BY processorEmail, window`).all(...args);
  const processors = new Map<string, ProcessingWorkload["processors"][number]>();
  const windowCounts = new Map<string, number>();
  for (const group of groups) {
    const email = String(group.processorEmail);
    const files = Number(group.files);
    const processor = processors.get(email);
    if (processor) processor.files += files;
    else processors.set(email, { email, name: email === "unassigned" ? "Unassigned" : String(group.name ?? email), files });
    if (!selected || email === selected) {
      const window = String(group.window);
      windowCounts.set(window, (windowCounts.get(window) ?? 0) + files);
    }
  }
  const rows = db.prepare(`${cohort} SELECT cohort.id, contact.name, officer, processorName, status, updatedAt,
      assignmentRevision, targetDate, closingDate, sortDate
    FROM cohort JOIN contacts contact ON contact.id = cohort.contactId WHERE 1 = 1
    ${selected ? "AND processorEmail = ?" : ""} ${query.window ? "AND window = ?" : ""}
    ${query.after ? "AND (sortDate, cohort.id) > (?, ?)" : ""} ORDER BY sortDate, cohort.id LIMIT ?`)
    .all(...args, ...(selected ? [selected] : []), ...(query.window ? [query.window] : []),
      ...(query.after ? [query.after.date, query.after.id] : []), pageSize + 1);
  const last = rows[pageSize - 1];
  const workload: ProcessingWorkload = { through, processors: personal ? [] : [...processors.values()].sort((a, b) => a.name.localeCompare(b.name)),
    windows: closingWorkloadWindows.map((window) => ({ window, files: windowCounts.get(window) ?? 0 })),
    next: rows.length > pageSize && last ? { id: String(last.id), date: String(last.sortDate) } : null };
  const files = rows.slice(0, pageSize).map(({ id, name, officer, processorName, status, updatedAt, targetDate, closingDate, assignmentRevision }) => ({
    id, name, officer, processorName, status, updatedAt, targetDate, closingDate,
    ...(typeof assignmentRevision === "number" ? { assignmentRevision } : {}),
  })) as unknown as BaseFile[];
  return { workload, files };
}

function handoffExceptions(db: Store, query: ProcessorQueueQuery, checkedAt: string, handoffHours: number, requireApproval: boolean) {
  const unassigned = query.exception === "Unassigned";
  const since = unassigned ? "coalesce(app.reviewedAt, loan.stageSince)" :
    "CASE WHEN processing.status = 'Assigned' THEN app.reviewedAt ELSE processing.updatedAt END";
  const filter = unassigned ? unassignedProcessingLoan :
    `processing.processorEmail IS NOT NULL
      AND processing.status IN ('Assigned', 'Ready for processing', 'Returned to LO')
      AND (processing.status = 'Ready for processing' OR app.reviewedAt IS NOT NULL)
      AND (${since}) <= ?`;
  const { after } = query;
  return db.prepare(`SELECT ${fields}, coalesce(processing.processorName, '') AS processorName,
    coalesce(processing.status, 'Unassigned') AS status, ${since} AS updatedAt
    ${unassigned ? ", coalesce(processing.revision, 0) AS assignmentRevision" : ""}
    FROM loans loan LEFT JOIN loan_processing processing ON processing.loanId = loan.id
    LEFT JOIN applications app ON app.loanId = loan.id ${closingJoins}
    WHERE ${activeProcessingLoan} AND ${filter} AND ${processingReviewReady}
    ${!unassigned && requireApproval ? `AND (processing.status = 'Returned to LO' OR (${processingAcceptanceReady(true)}))` : ""}
    ${after ? `AND ((${since}), loan.id) > (?, ?)` : ""} ORDER BY updatedAt, loan.id LIMIT ?`)
    .all(...(unassigned ? [] : [afterHours(checkedAt, -handoffHours)]), ...(after ? [after.updatedAt, after.id] : []), pageSize + 1)
    .map((row) => ({ ...row, ...(unassigned ? {} : { handoffDueAt: afterHours(String(row.updatedAt), handoffHours) }) })) as unknown as BaseFile[];
}

function nextCondition(item: Record<string, SqlValue>): NonNullable<ProcessorQueueFile["condition"]> {
  const action = item.status === "Received" ? "Review received document" : item.status === "Accepted" ?
    (item.receipt ? "Check mock clearance" : "Review accepted document and delivery") :
    item.status ? "Follow up on borrower document" : "Review lender request";
  return { count: Number(item.count), title: String(item.title || "Lender condition"), action,
    target: conditionTarget(String(item.submissionId), String(item.conditionId)),
    ...(typeof item.openedAt === "string" ? { openedAt: item.openedAt, lender: String(item.lender) } : {}) };
}

function agingConditions(db: Store, after: ProcessorQueueQuery["after"]) {
  return db.prepare(`SELECT ${fields}, coalesce(processing.processorName, '') AS processorName,
    coalesce(processing.status, 'Unassigned') AS status, item.openedAt AS updatedAt, item.openedAt, item.title,
    file.id AS submissionId, item.conditionId, file.lender, request.status AS requestStatus, delivery.receipt
    FROM processing_open_conditions item JOIN submissions file ON file.id = item.submissionId
    JOIN loans loan ON loan.id = file.loanId LEFT JOIN loan_processing processing ON processing.loanId = loan.id
    ${closingJoins}
    LEFT JOIN document_requests request ON request.submissionId = item.submissionId AND request.conditionId = item.conditionId
    LEFT JOIN uwm_document_deliveries delivery ON delivery.requestId = request.id
      AND (delivery.documentRevision = request.revision OR delivery.documentRevision IS NULL)
    WHERE item.openedAt IS NOT NULL AND ${activeProcessingLoan}
    ${after ? "AND (item.openedAt, item.submissionId, item.conditionId) > (?, ?, ?)" : ""}
    ORDER BY item.openedAt, item.submissionId, item.conditionId LIMIT ?`)
    .all(...(after ? [after.updatedAt, after.id, after.conditionId ?? ""] : []), pageSize + 1)
    .map(({ openedAt, title, submissionId, conditionId, lender, requestStatus, receipt, ...file }) => ({
      file: file as unknown as BaseFile,
      condition: nextCondition({ openedAt, title, submissionId, conditionId, lender, status: requestStatus, receipt, count: 1 }),
      cursor: { id: String(submissionId), conditionId: String(conditionId), updatedAt: String(openedAt) },
    }));
}

function canUseProcessorQueue(staff: WorkspaceStaff | null, brokerageId: string): staff is WorkspaceStaff {
  return staff?.brokerage.id === brokerageId && (staff.brokerage.role === "Admin" || staff.brokerage.role === "Processor");
}

function processingViewScope(staff: WorkspaceStaff) {
  return { name: "Processing", scope: JSON.stringify([staff.email, staff.brokerage.role]) } as const;
}

function canUseProcessingFilters(staff: WorkspaceStaff, { exception, workload }: ProcessorQueueQuery) {
  return staff.brokerage.role === "Admin" || (!exception && !workload?.processor);
}

export function changeProcessingView(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date()) {
  if (!canUseProcessorQueue(staff, brokerageId)) return { error: processorQueueUnavailable };
  const parsed = processingWorkspaceInput.safeParse(input);
  if (!parsed.success) return { error: "Check the processing view or fee terms." };
  const change = parsed.data;
  if (change.type !== "saveView" && change.type !== "removeView") return processorFeeWork(db, change, staff, now.toISOString());
  if (change.type === "saveView" && !canUseProcessingFilters(staff, change.filters)) return { error: processorQueueUnavailable };
  return db.transaction(() => changeDashboardView(db, staff, processingViewScope(staff), change, now.toISOString()));
}

export function readProcessorQueue(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date()): ProcessorQueuePage | { error: string } {
  if (!canUseProcessorQueue(staff, brokerageId)) return { error: processorQueueUnavailable };
  const parsed = processorQueueQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid processing queue page." };
  if (!canUseProcessingFilters(staff, parsed.data)) return { error: processorQueueUnavailable };
  if (parsed.data.serviceOrders) {
    if (!canUseServiceOrders(staff)) return { error: serviceOrdersUnavailable };
    return { checkedAt: now.toISOString(), files: [], next: null, views: [],
      serviceOrders: readServiceOrderQueue(db, parsed.data.serviceOrders, staff, now) };
  }
  const { readyOnly, after, exception, replyAfter, workload } = parsed.data;
  const processor = staff.brokerage.role === "Processor";
  const views = readDashboardViews(db, processingViewScope(staff), processingViewFilters);
  const checkedAt = now.toISOString();
  const replies = !readyOnly && !exception && !workload ? readProcessingConversationReplies(db, staff, replyAfter, now) : undefined;
  const closingPage = workload ? closingWorkload(db, workload, staff, now) : undefined;
  const handoffPolicy = exception === "Stalled handoffs" || readyOnly ? readPlaybook(db) : undefined;
  const handoffHours = exception === "Stalled handoffs" ? handoffPolicy?.handoffHours : undefined;
  const requireApproval = handoffPolicy?.requireSecondReview ?? false;
  const aged = exception === "Aging conditions" ? agingConditions(db, after) : null;
  const params: SqlValue[] = [...(processor ? [staff.email] : []), ...(after ? [after.updatedAt, after.id] : []), pageSize + 1];
  const rows = closingPage ? closingPage.files : aged ? aged.map(({ file }) => file) : exception ? handoffExceptions(db, parsed.data, checkedAt, handoffHours ?? 0, requireApproval) :
    db.prepare(`SELECT ${fields}, processing.processorName, processing.status, processing.updatedAt
    FROM loan_processing processing JOIN loans loan ON loan.id = processing.loanId
    ${readyOnly ? "LEFT JOIN applications app ON app.loanId = loan.id" : ""} ${closingJoins}
    WHERE ${activeProcessingLoan} AND processing.processorEmail IS NOT NULL
    AND processing.status ${readyOnly ? "= 'Ready for processing'" : "IN ('Assigned', 'Ready for processing', 'In processing', 'Returned to LO')"}
    ${readyOnly ? `AND ${processingAcceptanceReady(requireApproval)}` : ""}
    ${processor ? "AND processing.processorEmail = ?" : ""} ${after ? "AND (processing.updatedAt, processing.loanId) > (?, ?)" : ""}
    ORDER BY processing.updatedAt, processing.loanId LIMIT ?`).all(...params) as unknown as BaseFile[];
  const files = rows.slice(0, pageSize);
  if (!files.length) return { checkedAt, files: [], next: null, handoffHours, replies, workload: closingPage?.workload, views };
  const ids = JSON.stringify([...new Set(files.map(({ id }) => id))]);
  const conditions = aged ? [] : db.prepare(`WITH pending AS (
    SELECT file.loanId, file.id AS submissionId, json_extract(item.value, '$.id') AS conditionId,
      json_extract(item.value, '$.category') AS title, request.status, delivery.receipt,
      count(*) OVER (PARTITION BY file.loanId) AS count,
      row_number() OVER (PARTITION BY file.loanId ORDER BY CASE request.status WHEN 'Received' THEN 0
        WHEN 'Accepted' THEN 1 WHEN 'Requested' THEN 3 WHEN 'Needs replacement' THEN 3 ELSE 2 END, file.id, item.key) AS priority
    FROM json_each(?) selected JOIN submissions file ON file.loanId = selected.value JOIN json_each(file.conditions) item
    LEFT JOIN document_requests request ON request.submissionId = file.id AND request.conditionId = json_extract(item.value, '$.id')
    LEFT JOIN uwm_document_deliveries delivery ON delivery.requestId = request.id
      AND (delivery.documentRevision = request.revision OR delivery.documentRevision IS NULL)
    WHERE json_extract(item.value, '$.satisfiedAt') IS NULL AND
      (file.syncedAt IS NOT NULL OR json_extract(item.value, '$.manual') IS NOT NULL)
  ) SELECT * FROM pending WHERE priority = 1`).all(ids);
  const byCondition = new Map(conditions.map((item) => [item.loanId, nextCondition(item)]));
  const closing = db.prepare(`WITH pending AS (
    SELECT item.loanId, item.id, item.dueDate, count(*) OVER (PARTITION BY item.loanId) AS count,
      row_number() OVER (PARTITION BY item.loanId ORDER BY item.dueDate, item.id) AS priority
    FROM json_each(?) selected JOIN closing_items item ON item.loanId = selected.value WHERE item.completedAt IS NULL
  ) SELECT loanId, id, dueDate, count FROM pending WHERE priority = 1`).all(ids);
  const byClosing = new Map(closing.map((item) => [item.loanId, { count: Number(item.count), dueDate: String(item.dueDate),
    ...(workload ? { target: closingChecklistTarget(String(item.id)) } : {}) }]));
  const last = files.at(-1);
  return { checkedAt, handoffHours, replies, workload: closingPage?.workload, views,
    files: files.map((file, index) => ({ ...file, condition: aged?.[index]?.condition ?? byCondition.get(file.id) ?? null, closing: byClosing.get(file.id) ?? null })),
    next: rows.length > pageSize && last ? aged?.[pageSize - 1]?.cursor ?? { id: last.id, updatedAt: last.updatedAt } : null };
}
