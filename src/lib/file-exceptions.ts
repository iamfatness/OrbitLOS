import type { BrokerageRole, VersionedBrokerageMember } from "./brokerage-model";
import { closingGateLabels, closingGateRules, type ClosingGateRule } from "./closing-gate-model";
import { closingGateFileJoins, closingGateSources, closingGateTarget, currentClosingGatePolicy } from "./closing-gates";
import { easternDate } from "./client-retention";
import { closingPackageReviewCategory, disclosureClosingReviewPrefix, disclosureIssuePrefix, disclosureReviewPrefix, disclosureTarget } from "./disclosure-model";
import { canUseSampleDisclosures, currentSignedClosingPackageSql } from "./disclosures";
import { creditAusAttemptTarget, unconfirmedMockOrder } from "./credit-aus-model";
import { fictionalUwmWorkspace } from "./uwm-live";
import { closingPackageException, fileExceptionKinds, fileExceptionQuery, fileExceptionsUnavailable, overdueManualReturnFilter, unattendedManualReturnFilter,
  type FileException, type FileExceptionPage, type FileExceptionQuery } from "./file-exception-model";
import { loanReviewsTarget, reviewTarget } from "./loan-review-model";
import { closingDisclosureReviewTarget } from "./file-preflight-model";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { conditionTarget } from "./uwm-alert-model";
import { openSecondReview, pendingRequiredApproval } from "./application-review-checkpoint";
import { readPlaybook } from "./playbooks";
import { latestManualReturnFollowUp, manualReturnDueAt, manualReturnLender, manualReturnPhase, manualReturnTitle, manualReturnWorkId,
  pendingManualReturn } from "./manual-lender-work";
import { manualReturnSteps, type ManualReturnStatus } from "./lender-export-model";

const limit = 20;
const active = "loan.disposition = 'Active'";
const activePipeline = `${active} AND loan.stage NOT IN ('Funded', 'Closed')`;
const loanColumns = "loan.id AS loanId, contact.name AS borrower, loan.officerEmail, processing.processorEmail";
const loanJoins = `JOIN contacts contact ON contact.id = loan.contactId LEFT JOIN loan_processing processing ON processing.loanId = loan.id`;
type Base = Omit<FileException, "target" | "action" | "evidence" | "owner" | "ownerAvailable" | "overdue" | "escalated" | "returnEventId" | "returnFollowUp"> & {
  rank: number;
  ownerName: string | null; ownerEmail: string | null; officerEmail: string | null; processorEmail: string | null;
  reviewerRole: BrokerageRole | null; reviewerAccessRevision: number | null; escalated: number;
  version: number | null; changed: number; requestStatus: string | null;
  returnEventId: string | null; returnFollowUp: string | null;
};
type Candidates = { rows: Base[]; next: FileExceptionPage["next"]; today: string; checkedAt: string };

function selectFileExceptions(db: Store, { filter, after }: FileExceptionQuery, staff: WorkspaceStaff, now: Date, countCap?: number) {
  const today = easternDate(now);
  const checkedAt = now.toISOString();
  const overdueReturns = filter === overdueManualReturnFilter || filter === unattendedManualReturnFilter;
  const { requireSecondReview: requireApproval, handoffHours } = readPlaybook(db);
  const showCheckpoint = (filter === "All file exceptions" || filter === "Required 1003 approvals") && requireApproval;
  const parts: { sql: string; args: SqlValue[] }[] = [];
  function add(kind: FileException["kind"], select: string, sort: string, parent: string, id: string, params: SqlValue[] = [], returnEvent = "NULL") {
    if (filter !== "All file exceptions" && filter !== kind && !(overdueReturns && kind === "Manual lender returns")) return;
    if (countCap !== undefined) {
      parts.push({ sql: `SELECT count(*) AS total FROM (SELECT ${select} LIMIT ?)`, args: params });
      return;
    }
    const rank = fileExceptionKinds.indexOf(kind);
    parts.push({ sql: `SELECT '${kind}' AS kind, ${rank} AS rank, ${sort} AS sortOn, ${parent} AS parentId, ${id} AS id, ${returnEvent} AS returnEventId, ${select}
      ${after ? `AND (${sort}, ${rank}, ${parent}, ${id}) > (?, ?, ?, ?)` : ""}
      ORDER BY ${sort}, ${parent}, ${id} LIMIT ?`,
      args: [...params, ...(after ? [after.sortOn, fileExceptionKinds.indexOf(after.kind), after.parentId, after.id] : []), limit + 1] });
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
      AND review.category <> '${closingPackageReviewCategory}'
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

  add("Unassigned handoffs", `${loanColumns}, 'Assign a processor' AS title, 'Processor needed' AS status,
    NULL AS dueOn, NULL AS reopenedAt, NULL AS nextParty, loan.officer AS ownerName, loan.officerEmail AS ownerEmail,
    NULL AS reviewerRole, NULL AS reviewerAccessRevision, 0 AS escalated, NULL AS version, 0 AS changed, NULL AS requestStatus
    FROM applications app JOIN loans loan ON loan.id = app.loanId ${loanJoins}
    WHERE ${activePipeline} AND app.submittedAt IS NOT NULL AND app.reviewedAt IS NOT NULL
      AND coalesce(app.correctionNote, '') = '' AND processing.processorEmail IS NULL`,
  `strftime('%Y-%m-%dT%H:%M:%fZ', app.reviewedAt, '+${handoffHours} hours')`, "loan.id", "loan.id");

  if (canUseSampleDisclosures(staff)) {
    const packageChanged = "package.version IS NULL";
    const packageRequesterActs = `review.status = 'Changes requested' OR ${packageChanged}`;
    add(closingPackageException, `${loanColumns}, 'Sample closing review' AS title,
      CASE WHEN review.status = 'Changes requested' THEN 'Returned for corrections' WHEN ${packageChanged} THEN 'Package outdated'
        WHEN review.dueOn < ? THEN 'Review overdue' ELSE 'Escalated' END AS status,
      review.dueOn, NULL AS reopenedAt, NULL AS nextParty,
      CASE WHEN ${packageRequesterActs} THEN review.requesterName ELSE review.reviewerName END AS ownerName,
      CASE WHEN ${packageRequesterActs} THEN review.requesterEmail ELSE review.reviewerEmail END AS ownerEmail,
      CASE WHEN NOT (${packageRequesterActs}) THEN review.reviewerRole END AS reviewerRole,
      CASE WHEN NOT (${packageRequesterActs}) THEN review.reviewerAccessRevision END AS reviewerAccessRevision,
      review.escalatedAt IS NOT NULL AS escalated, pinned.version, (${packageChanged}) AS changed, NULL AS requestStatus
      FROM loan_reviews review JOIN loans loan ON loan.id = review.loanId ${loanJoins}
      JOIN loan_review_events event ON event.sequence = (
        SELECT candidate.sequence FROM loan_review_events candidate
        WHERE candidate.reviewId = review.id AND candidate.action IN ('Requested', 'Resubmitted') ORDER BY candidate.sequence DESC LIMIT 1
      ) JOIN loan_review_closing_packages pinned ON pinned.eventId = event.id
      LEFT JOIN disclosure_packages package ON package.loanId = loan.id AND package.version = pinned.version AND package.revision = pinned.revision
        AND ${currentSignedClosingPackageSql}
      WHERE ${activePipeline} AND review.category = '${closingPackageReviewCategory}' AND review.status IN ('Requested', 'Changes requested')
        AND (review.dueOn < ? OR review.escalatedAt IS NOT NULL OR ${packageRequesterActs})`,
    "review.dueOn", "loan.id", "review.id", [today, today]);
    add("Disclosure reviews", `${loanColumns}, 'Sample disclosure v' || package.version AS title, coalesce(package.reviewReason,task.title) AS status,
      NULL AS dueOn, NULL AS reopenedAt, NULL AS nextParty, loan.officer AS ownerName, loan.officerEmail AS ownerEmail,
      NULL AS reviewerRole, NULL AS reviewerAccessRevision, 0 AS escalated, NULL AS version, 0 AS changed, NULL AS requestStatus
      FROM tasks task JOIN loans loan ON loan.id = task.loanId ${loanJoins}
      JOIN disclosure_packages package ON package.loanId = loan.id
        AND package.version = (SELECT max(latest.version) FROM disclosure_packages latest WHERE latest.loanId = loan.id)
        AND task.id IN ('${disclosureReviewPrefix}' || loan.id || ':' || package.version,
          '${disclosureIssuePrefix}' || loan.id || ':' || package.version, '${disclosureClosingReviewPrefix}' || loan.id || ':' || package.version)
      WHERE ${activePipeline} AND task.completedAt IS NULL AND package.supersededAt IS NULL
      ${filter === "All file exceptions" ? `AND NOT EXISTS (SELECT 1 FROM loan_reviews assigned
        WHERE assigned.loanId = loan.id AND assigned.category = '${closingPackageReviewCategory}' AND assigned.status IN ('Requested', 'Changes requested'))` : ""}`,
    "task.dueAt", "loan.id", "task.id");
  }

  if (fictionalUwmWorkspace(staff)) {
    const detected = "json_extract(attempt.result, '$.conflict.detectedAt')";
    add("Underwriting conflicts", `${loanColumns}, 'Mock ' || CASE attempt.service WHEN 'Credit' THEN 'credit' ELSE attempt.service END || ' reference conflict' AS title,
      'Needs admin review' AS status, NULL AS dueOn, NULL AS reopenedAt, NULL AS nextParty,
      loan.officer AS ownerName, loan.officerEmail AS ownerEmail, NULL AS reviewerRole, NULL AS reviewerAccessRevision,
      0 AS escalated, attempt.applicationRevision AS version, 0 AS changed, NULL AS requestStatus
      FROM mock_credit_aus_runs attempt JOIN loans loan ON loan.id = attempt.loanId ${loanJoins}
      WHERE json_extract(attempt.result, '$.status') = ? AND ${detected} IS NOT NULL
        AND json_extract(attempt.result, '$.conflict.reviewedAt') IS NULL`,
    detected, "loan.id", "attempt.id", [unconfirmedMockOrder]);
  }

  add("Manual lender returns", `${loanColumns}, ${manualReturnTitle} AS title, ${manualReturnPhase(requireApproval)} AS status,
    NULL AS dueOn, returnEntry.createdAt AS reopenedAt, ${manualReturnLender} AS nextParty,
    loan.officer AS ownerName, loan.officerEmail AS ownerEmail, NULL AS reviewerRole, NULL AS reviewerAccessRevision,
    0 AS escalated, app.revision AS version, 0 AS changed, returned.outcome AS requestStatus
    FROM loans loan JOIN applications app ON app.loanId = loan.id ${loanJoins} ${pendingManualReturn}
    WHERE ${activePipeline} AND (${manualReturnWorkId}) IS NOT NULL${overdueReturns ? ` AND ${manualReturnDueAt} < ?` : ""}
      ${filter === unattendedManualReturnFilter ? `AND NOT EXISTS (SELECT 1 FROM manual_return_follow_ups followUp
        WHERE followUp.returnEventId = returned.activityId)` : ""}`,
  manualReturnDueAt, "loan.id", manualReturnWorkId, overdueReturns ? [checkedAt] : [], "returned.activityId");

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

  if (filter === "All file exceptions" || filter === "Closing and funding holds") {
    const { rules } = currentClosingGatePolicy(db);
    for (const rule of closingGateRules) {
      const closing = rules.closing.includes(rule);
      const funding = rules.funding.includes(rule);
      if (!closing && !funding) continue;
      const source = closingGateSources[rule];
      const assignedProcessor = `(${source.processor}) AND processing.processorEmail IS NOT NULL`;
      const phase = closing && funding ? "1" : `profile.closingDate IS ${closing ? "" : "NOT "}NULL`;
      add("Closing and funding holds", `${loanColumns}, ${source.title} AS title,
        CASE WHEN profile.closingDate IS NULL THEN 'Before closing' ELSE 'Before funding' END AS status,
        ${source.due} AS dueOn, NULL AS reopenedAt, NULL AS nextParty,
        CASE WHEN ${assignedProcessor} THEN processing.processorName ELSE loan.officer END AS ownerName,
        CASE WHEN ${assignedProcessor} THEN processing.processorEmail ELSE loan.officerEmail END AS ownerEmail,
        NULL AS reviewerRole, NULL AS reviewerAccessRevision, 0 AS escalated, NULL AS version, 0 AS changed, '${rule}' AS requestStatus
        FROM loans loan ${loanJoins} ${closingGateFileJoins} ${source.joins}
        WHERE ${activePipeline} AND progress.fundingDate IS NULL AND (${phase}) AND (${source.match})
          AND (loan.stage = 'Clear to Close' OR plan.targetDate IS NOT NULL OR profile.closingDate IS NOT NULL)`,
      `coalesce(${source.due}, substr(loan.stageSince, 1, 10))`, source.parent, source.id);
    }
  }

  return { parts, today, checkedAt };
}

export function countFileExceptions(db: Store, staff: WorkspaceStaff, brokerageId: string, now: Date, cap: number) {
  if (staff.brokerage.role !== "Admin" || staff.brokerage.id !== brokerageId) return undefined;
  const { parts } = selectFileExceptions(db, { filter: "All file exceptions" }, staff, now, cap);
  let count = 0;
  for (const { sql, args } of parts) {
    count += Number(db.prepare(sql).get(...args, cap - count)?.total ?? 0);
    if (count >= cap) break;
  }
  return count;
}

// Dates and generated record keys use binary order, matching the SQL cursor.
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function readFileExceptions(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date()): Candidates | { error: string } {
  if (!staff || staff.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin") return { error: fileExceptionsUnavailable };
  const parsed = fileExceptionQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid file exception view." };
  const { parts, today, checkedAt } = selectFileExceptions(db, parsed.data, staff, now);
  // Keep each read bounded and within the hosted SQLite compound-query limit.
  const all = parts.flatMap(({ sql, args }) => db.prepare(`SELECT page.*, ${latestManualReturnFollowUp} AS returnFollowUp
    FROM (${sql}) page`).all(...args) as unknown as Base[])
    .sort((a, b) => compare(a.sortOn, b.sortOn) || a.rank - b.rank || compare(a.parentId, b.parentId) || compare(a.id, b.id));
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
    const closingReview = kind === closingPackageException;
    const internalReview = kind === "Internal reviews" || required;
    const manual = kind === "Manual lender returns" ? manualReturnSteps[status as ManualReturnStatus] : undefined;
    const gate = kind === "Closing and funding holds" ? requestStatus as ClosingGateRule : undefined;
    const handoff = kind === "Unassigned handoffs";
    const disclosure = kind === "Disclosure reviews";
    const underwriting = kind === "Underwriting conflicts";
    const dueAt = handoff || disclosure ? sortOn : undefined;
    const target = underwriting ? creditAusAttemptTarget(id) : handoff ? "processing-handoff" : disclosure ?
      id.startsWith(disclosureClosingReviewPrefix) ? closingDisclosureReviewTarget : disclosureTarget : closingReview ? reviewTarget(id) : gate ? closingGateTarget(gate, parentId, id) : manual ? manual.target : kind === "Missing evidence" ? `document-${id}` : internalReview ?
      (status === "Reviewer needed" ? loanReviewsTarget : reviewTarget(id)) : conditionTarget(parentId, id);
    const action = underwriting ? "Review the unmatched response on the original order" : handoff ? "Reviewed 1003 is ready for a processor" : disclosure ?
      id.startsWith(disclosureReviewPrefix) ? "Review the change and prepare an updated sample package" : status :
      closingReview ? (!available ? "Check staff availability" : status === "Returned for corrections" ? "Correct and resubmit the signed replacement" :
        changed ? "Resubmit with the current signed package" : "Review the signed package") :
      gate ? closingGateLabels[gate] : manual ? manual.action : kind === "Missing evidence" ? (status === "Needs replacement" ? "Follow up on replacement evidence" : "Follow up on requested evidence") :
      internalReview ? (status === "Reviewer needed" ? requestStatus ?? "Assign a second reviewer for the current 1003" :
        changed ? "Resubmit the review for the current 1003" : status === "Changes requested" ? "Respond to requested changes" :
        available ? "Record a review decision" : "Reassign the reviewer") :
        requestStatus === "Received" ? "Review received evidence" : requestStatus === "Accepted" ? "Check delivery and clearance" :
          requestStatus ? "Follow up on borrower evidence" : "Review the lender request and request evidence";
    const evidence = version === null ? null : closingReview ? `Package v${version}` :
      `${manual ? "Current 1003" : internalReview || underwriting ? "Submitted 1003" : "Document"} revision ${version}`;
    const currentStatus = required && status === "Awaiting approval" && !available ? "Reviewer unavailable" : status;
    return { kind, id, parentId, sortOn, loanId, borrower, title, status: currentStatus, target, action, owner: member?.name || ownerName || null,
      ...(returnEventId ? { returnEventId, returnSubmissionId: requestStatus === "Rejected" ? null : id, returnDueAt: sortOn } : {}),
      ...(dueAt ? { dueAt } : {}),
      ...(closingReview && version !== null ? { closingPackageVersion: version } : {}),
      ...(returnFollowUp ? { returnFollowUp: JSON.parse(returnFollowUp) } : {}),
      ownerAvailable: available, nextParty, dueOn, reopenedAt, evidence, overdue: returnEventId || dueAt ? sortOn < checkedAt : !!dueOn && dueOn < today,
      escalated: Boolean(escalated) };
  });
  return { items, next, today };
}
