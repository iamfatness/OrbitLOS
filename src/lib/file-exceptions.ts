import type { BrokerageRole, VersionedBrokerageMember } from "./brokerage-model";
import { easternDate } from "./client-retention";
import { fileExceptionKinds, fileExceptionQuery, fileExceptionsUnavailable, overdueManualReturnFilter, unattendedManualReturnFilter,
  type FileException, type FileExceptionPage } from "./file-exception-model";
import { loanReviewsTarget, reviewTarget } from "./loan-review-model";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { conditionTarget } from "./uwm-alert-model";
import { openSecondReview, pendingRequiredApproval } from "./application-review-checkpoint";
import { readPlaybook } from "./playbooks";
import { latestManualReturnFollowUp, manualReturnDueAt, manualReturnPhase, pendingManualReturn } from "./manual-lender-work";
import { manualReturnSteps, type ManualReturnStatus } from "./lender-export-model";

const limit = 20;
const active = "loan.disposition = 'Active'";
const activePipeline = `${active} AND loan.stage NOT IN ('Funded', 'Closed')`;
const loanColumns = "loan.id AS loanId, contact.name AS borrower, loan.officerEmail, processing.processorEmail";
const loanJoins = `JOIN contacts contact ON contact.id = loan.contactId LEFT JOIN loan_processing processing ON processing.loanId = loan.id`;
type Base = Omit<FileException, "target" | "action" | "evidence" | "owner" | "ownerAvailable" | "overdue" | "escalated" | "returnEventId" | "returnFollowUp"> & {
  ownerName: string | null; ownerEmail: string | null; officerEmail: string | null; processorEmail: string | null;
  reviewerRole: BrokerageRole | null; reviewerAccessRevision: number | null; escalated: number;
  version: number | null; changed: number; requestStatus: string | null;
  returnEventId: string | null; returnFollowUp: string | null;
};
type Candidates = { rows: Base[]; next: FileExceptionPage["next"]; today: string; checkedAt: string };

export function readFileExceptions(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date()): Candidates | { error: string } {
  if (!staff || staff.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin") return { error: fileExceptionsUnavailable };
  const parsed = fileExceptionQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid file exception view." };
  const { filter, after } = parsed.data;
  const today = easternDate(now);
  const checkedAt = now.toISOString();
  const overdueReturns = filter === overdueManualReturnFilter || filter === unattendedManualReturnFilter;
  const requireApproval = readPlaybook(db).requireSecondReview;
  const showCheckpoint = (filter === "All file exceptions" || filter === "Required 1003 approvals") && requireApproval;
  const parts: string[] = [];
  const args: SqlValue[] = [];
  function add(kind: FileException["kind"], select: string, sort: string, parent: string, id: string, params: SqlValue[] = [], returnEvent = "NULL") {
    if (filter !== "All file exceptions" && filter !== kind && !(overdueReturns && kind === "Manual lender returns")) return;
    const rank = fileExceptionKinds.indexOf(kind);
    parts.push(`SELECT * FROM (SELECT '${kind}' AS kind, ${rank} AS rank, ${sort} AS sortOn, ${parent} AS parentId, ${id} AS id, ${returnEvent} AS returnEventId, ${select}
      ${after ? `AND (${sort}, ${rank}, ${parent}, ${id}) > (?, ?, ?, ?)` : ""}
      ORDER BY ${sort}, ${parent}, ${id} LIMIT ?)`);
    args.push(...params, ...(after ? [after.sortOn, fileExceptionKinds.indexOf(after.kind), after.parentId, after.id] : []), limit + 1);
  }
  const reviewChanged = `review.category = '1003 second review' AND review.applicationRevision IS NOT CASE WHEN app.submittedAt IS NOT NULL THEN app.revision END`;
  const requesterActs = `review.status = 'Changes requested' OR (${reviewChanged})`;
  const processorActs = `processing.processorEmail IS NOT NULL AND (lower(trim(item.manualOwner)) = 'processor' OR
    (coalesce(trim(item.manualOwner), '') = '' AND processing.status IN ('Ready for processing', 'In processing')))`;

  add("Missing evidence", `${loanColumns}, request.kind || CASE WHEN request.recipient = 'Co-borrower' THEN ' · Co-borrower' ELSE '' END AS title,
    request.status, request.dueOn, NULL AS reopenedAt, NULL AS nextParty,
    loan.officer AS ownerName, loan.officerEmail AS ownerEmail, NULL AS reviewerRole, NULL AS reviewerAccessRevision,
    0 AS escalated, request.revision AS version, 0 AS changed, NULL AS requestStatus
    FROM document_requests request JOIN loans loan ON loan.id = request.loanId ${loanJoins}
    LEFT JOIN processing_open_conditions item ON item.submissionId = request.submissionId AND item.conditionId = request.conditionId
    WHERE ${activePipeline} AND request.status IN ('Requested', 'Needs replacement')
      AND (request.conditionId IS NULL OR item.conditionId IS NOT NULL)
      ${filter === "All file exceptions" ? "AND item.reopenedAt IS NULL" : ""}`,
  "coalesce(request.dueOn, substr(request.requestedAt, 1, 10))", "'-'", "request.id");

  add("Internal reviews", `${loanColumns}, review.title, review.status, review.dueOn, NULL AS reopenedAt, NULL AS nextParty,
    CASE WHEN ${requesterActs} THEN review.requesterName ELSE review.reviewerName END AS ownerName,
    CASE WHEN ${requesterActs} THEN review.requesterEmail ELSE review.reviewerEmail END AS ownerEmail,
    CASE WHEN NOT (${requesterActs}) THEN review.reviewerRole END AS reviewerRole,
    CASE WHEN NOT (${requesterActs}) THEN review.reviewerAccessRevision END AS reviewerAccessRevision,
    review.escalatedAt IS NOT NULL AS escalated, review.applicationRevision AS version, (${reviewChanged}) AS changed, NULL AS requestStatus
    FROM loan_reviews review JOIN loans loan ON loan.id = review.loanId ${loanJoins} LEFT JOIN applications app ON app.loanId = loan.id
    WHERE ${active} AND review.status IN ('Requested', 'Changes requested')
      AND (review.dueOn < ? OR review.escalatedAt IS NOT NULL OR (${reviewChanged}))
      ${showCheckpoint ? `AND NOT (review.category = '1003 second review' AND ${activePipeline} AND ${pendingRequiredApproval})` : ""}`,
  "review.dueOn", "'-'", "review.id", [today]);

  if (!requireApproval) add("Internal reviews", `${loanColumns}, 'Assign second 1003 reviewer' AS title, 'Reviewer needed' AS status, route.dueOn,
    NULL AS reopenedAt, NULL AS nextParty, loan.officer AS ownerName, loan.officerEmail AS ownerEmail,
    NULL AS reviewerRole, NULL AS reviewerAccessRevision, 0 AS escalated, route.applicationRevision AS version,
    0 AS changed, route.reason AS requestStatus
    FROM application_review_routing_blocks route JOIN loans loan ON loan.id = route.loanId ${loanJoins}
    JOIN applications app ON app.loanId = route.loanId AND app.revision = route.applicationRevision
    WHERE ${activePipeline} AND app.submittedAt IS NOT NULL AND app.reviewedAt IS NOT NULL`,
  "route.dueOn", "loan.id", "CAST(route.applicationRevision AS TEXT)");

  add("Reopened conditions", `${loanColumns}, item.title, 'Reopened' AS status, request.dueOn, item.reopenedAt, item.manualOwner AS nextParty,
    CASE WHEN ${processorActs} THEN processing.processorName ELSE loan.officer END AS ownerName,
    CASE WHEN ${processorActs} THEN processing.processorEmail ELSE loan.officerEmail END AS ownerEmail,
    NULL AS reviewerRole, NULL AS reviewerAccessRevision, 0 AS escalated, request.revision AS version, 0 AS changed, request.status AS requestStatus
    FROM processing_open_conditions item JOIN submissions file ON file.id = item.submissionId JOIN loans loan ON loan.id = file.loanId ${loanJoins}
    LEFT JOIN document_requests request ON request.submissionId = item.submissionId AND request.conditionId = item.conditionId
    WHERE ${activePipeline} AND item.reopenedAt IS NOT NULL`, "substr(item.reopenedAt, 1, 10)", "item.submissionId", "item.conditionId");

  add("Manual lender returns", `${loanColumns}, 'Manual lender return' AS title, ${manualReturnPhase(requireApproval)} AS status,
    NULL AS dueOn, returnEntry.createdAt AS reopenedAt, returnFile.lender || ' · ' || returnFile.externalId AS nextParty,
    loan.officer AS ownerName, loan.officerEmail AS ownerEmail, NULL AS reviewerRole, NULL AS reviewerAccessRevision,
    0 AS escalated, app.revision AS version, 0 AS changed, NULL AS requestStatus
    FROM loans loan JOIN applications app ON app.loanId = loan.id ${loanJoins} ${pendingManualReturn}
    WHERE ${activePipeline} AND returnFile.id IS NOT NULL${overdueReturns ? ` AND ${manualReturnDueAt} < ?` : ""}
      ${filter === unattendedManualReturnFilter ? `AND NOT EXISTS (SELECT 1 FROM manual_return_follow_ups followUp
        WHERE followUp.returnEventId = returned.activityId)` : ""}`,
  manualReturnDueAt, "loan.id", "returnFile.id", overdueReturns ? [checkedAt] : [], "returned.activityId");

  if (showCheckpoint) {
    add("Required 1003 approvals", `${loanColumns}, 'Required 1003 approval' AS title,
      CASE WHEN review.id IS NULL THEN 'Reviewer needed' WHEN ${reviewChanged} THEN 'Resubmission needed'
        WHEN review.status = 'Changes requested' THEN 'Changes requested' ELSE 'Awaiting approval' END AS status,
      coalesce(review.dueOn, route.dueOn) AS dueOn, NULL AS reopenedAt, NULL AS nextParty,
      CASE WHEN review.id IS NULL THEN loan.officer WHEN ${requesterActs} THEN review.requesterName ELSE review.reviewerName END AS ownerName,
      CASE WHEN review.id IS NULL THEN loan.officerEmail WHEN ${requesterActs} THEN review.requesterEmail ELSE review.reviewerEmail END AS ownerEmail,
      CASE WHEN NOT (${requesterActs}) THEN review.reviewerRole END AS reviewerRole,
      CASE WHEN NOT (${requesterActs}) THEN review.reviewerAccessRevision END AS reviewerAccessRevision,
      review.escalatedAt IS NOT NULL AS escalated, app.revision AS version, (${reviewChanged}) AS changed, route.reason AS requestStatus
      FROM applications app JOIN loans loan ON loan.id = app.loanId ${loanJoins}
      LEFT JOIN application_review_routing_blocks route ON route.loanId = app.loanId AND route.applicationRevision = app.revision
      LEFT JOIN loan_reviews review ON review.id = coalesce(
        (SELECT pending.id FROM loan_reviews pending WHERE ${openSecondReview} AND pending.applicationRevision = app.revision ORDER BY pending.dueOn, pending.id LIMIT 1),
        (SELECT pending.id FROM loan_reviews pending WHERE ${openSecondReview} ORDER BY pending.dueOn, pending.id LIMIT 1))
      WHERE ${activePipeline} AND ${pendingRequiredApproval}`,
    "coalesce(review.dueOn, route.dueOn, substr(app.reviewedAt, 1, 10))", "loan.id", "coalesce(review.id, CAST(app.revision AS TEXT))");
  }

  if (!parts.length) return { rows: [], next: null, today, checkedAt };
  const all = db.prepare(`WITH page AS (${parts.join(" UNION ALL ")} ORDER BY sortOn, rank, parentId, id LIMIT ?)
    SELECT page.*, ${latestManualReturnFollowUp} AS returnFollowUp FROM page ORDER BY sortOn, rank, parentId, id`)
    .all(...args, limit + 1) as unknown as Base[];
  const rows = all.slice(0, limit);
  const last = rows.at(-1);
  return { rows, next: all.length > limit && last ? { sortOn: last.sortOn, kind: last.kind, parentId: last.parentId, id: last.id } : null, today, checkedAt };
}

export function fileExceptionOwners(page: Candidates) {
  return [...new Set(page.rows.flatMap(({ ownerEmail }) => ownerEmail ? [ownerEmail] : []))];
}

export function nameFileExceptions({ rows, next, today, checkedAt }: Candidates, roster: VersionedBrokerageMember[]): FileExceptionPage {
  const members = new Map(roster.filter(({ status }) => status === "Active").map((member) => [member.email, member]));
  const items = rows.map(({ kind, id, parentId, sortOn, loanId, borrower, title, status, ownerName, ownerEmail, officerEmail, processorEmail,
    reviewerRole, reviewerAccessRevision, dueOn, reopenedAt, version, changed, escalated, requestStatus, nextParty, returnEventId, returnFollowUp }): FileException => {
    const member = ownerEmail ? members.get(ownerEmail) : undefined;
    const available = !!member && (member.role === "Admin" || (member.role === "LO" && member.email === officerEmail) ||
      (member.role === "Processor" && member.email === processorEmail)) &&
      (!reviewerRole || (member.role === reviewerRole && (member.accessRevision ?? 0) === reviewerAccessRevision));
    const required = kind === "Required 1003 approvals";
    const internalReview = kind === "Internal reviews" || required;
    const manual = kind === "Manual lender returns" ? manualReturnSteps[status as ManualReturnStatus] : undefined;
    const target = manual ? manual.target : kind === "Missing evidence" ? `document-${id}` : internalReview ?
      (status === "Reviewer needed" ? loanReviewsTarget : reviewTarget(id)) : conditionTarget(parentId, id);
    const action = manual ? manual.action : kind === "Missing evidence" ? (status === "Needs replacement" ? "Follow up on replacement evidence" : "Follow up on requested evidence") :
      internalReview ? (status === "Reviewer needed" ? requestStatus ?? "Assign a second reviewer for the current 1003" :
        changed ? "Resubmit the review for the current 1003" : status === "Changes requested" ? "Respond to requested changes" :
        available ? "Record a review decision" : "Reassign the reviewer") :
        requestStatus === "Received" ? "Review received evidence" : requestStatus === "Accepted" ? "Check delivery and clearance" :
          requestStatus ? "Follow up on borrower evidence" : "Review the lender request and request evidence";
    const evidence = version === null ? null : `${manual ? "Current 1003" : internalReview ? "Submitted 1003" : "Document"} revision ${version}`;
    const currentStatus = required && status === "Awaiting approval" && !available ? "Reviewer unavailable" : status;
    return { kind, id, parentId, sortOn, loanId, borrower, title, status: currentStatus, target, action, owner: member?.name || ownerName || null,
      ...(returnEventId ? { returnEventId, returnDueAt: sortOn } : {}),
      ...(returnFollowUp ? { returnFollowUp: JSON.parse(returnFollowUp) } : {}),
      ownerAvailable: available, nextParty, dueOn, reopenedAt, evidence, overdue: returnEventId ? sortOn < checkedAt : !!dueOn && dueOn < today,
      escalated: Boolean(escalated) };
  });
  return { items, next, today };
}
