import type { BrokerageRole, VersionedBrokerageMember } from "./brokerage-model";
import { easternDate } from "./client-retention";
import { reviewsUnavailable, type ReviewFileInput, type ReviewHistoryEvent, type ReviewInput, type ReviewMutation, type ReviewOffboarding, type ReviewOption, type ReviewQueueQuery,
  type ReviewResult, type ReviewSummary } from "./loan-review-model";
import { recordReviewNotice, reviewInbox } from "./review-inbox";
import type { PlaybookSettings } from "./playbook-model";
import { shiftReportDate } from "./report-date-range";
import { openSecondReview, pendingRequiredApproval } from "./application-review-checkpoint";
import { readPlaybook } from "./playbooks";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { loanAccess } from "./workspace-access";

const pageSize = 20;
const active = "review.status IN ('Requested', 'Changes requested')";
const joined = "FROM loan_reviews review JOIN loans loan ON loan.id = review.loanId JOIN contacts contact ON contact.id = loan.contactId";
const columns = "review.id, review.loanId, contact.name AS borrower, review.title, review.category, review.status, review.dueOn, review.reviewerName, review.requesterName, review.escalatedAt";
type Base = Omit<ReviewSummary, "overdue">;
type Stored = Base & { revision: number; reviewerEmail: string; requesterEmail: string; reviewerRole: BrokerageRole;
  reviewerAccessRevision: number; applicationRevision: number | null };
type LoanContext = { officerEmail: string | null; processorEmail: string | null; active: boolean; inPipeline: boolean; applicationRevision: number | null };

function scopeLoan(db: Store, staff: WorkspaceStaff, loanId: string): LoanContext | undefined {
  if (!loanAccess(db, staff, loanId)) return;
  const row = db.prepare(`SELECT loan.officerEmail, loan.disposition, loan.stage, processing.processorEmail, app.submittedAt, app.revision
    FROM loans loan LEFT JOIN loan_processing processing ON processing.loanId = loan.id
    LEFT JOIN applications app ON app.loanId = loan.id WHERE loan.id = ?`).get(loanId);
  if (row) return { officerEmail: row.officerEmail as string | null, processorEmail: row.processorEmail as string | null,
    active: row.disposition === "Active", inPipeline: row.stage !== "Funded" && row.stage !== "Closed",
    applicationRevision: row.submittedAt ? Number(row.revision) : null };
}

function scopedReview(db: Store, loanId: string, id: string) {
  return db.prepare(`SELECT ${columns}, review.revision, review.reviewerEmail, review.requesterEmail, review.reviewerRole,
    review.reviewerAccessRevision, review.applicationRevision ${joined} WHERE review.loanId = ? AND review.id = ?`)
    .get(loanId, id) as unknown as Stored | undefined;
}

export function reviewParticipants(db: Store, input: ReviewFileInput, staff: WorkspaceStaff) {
  const loan = scopeLoan(db, staff, input.loanId);
  if (!loan) return null;
  const review = "id" in input && input.type !== "create" ? scopedReview(db, input.loanId, input.id) : undefined;
  if ("id" in input && input.type !== "create" && !review) return null;
  const emails = [loan.officerEmail, loan.processorEmail, review?.reviewerEmail, review?.requesterEmail,
    "reviewerEmail" in input ? input.reviewerEmail : null, "mentionEmail" in input ? input.mentionEmail : null];
  return [...new Set(emails.filter((email): email is string => typeof email === "string" && !!email))];
}

function eligible(member: VersionedBrokerageMember, loan: LoanContext, requester: string) {
  return member.status === "Active" && member.email !== requester && (member.role === "Admin" ||
    (member.role === "LO" && member.email === loan.officerEmail) || (member.role === "Processor" && member.email === loan.processorEmail));
}

function options(members: VersionedBrokerageMember[], loan: LoanContext, requester: string): ReviewOption[] {
  return members.filter((member) => eligible(member, loan, requester)).map(({ email, name, role }) => ({ email, name, role }));
}

function summary({ id, loanId, borrower, title, category, status, dueOn, reviewerName, requesterName, escalatedAt }: Base, today: string): ReviewSummary {
  return { id, loanId, borrower, title, category, status, dueOn, reviewerName, requesterName, escalatedAt, overdue: isOpen({ status }) && dueOn < today };
}

function isOpen(row: Pick<Base, "status">) {
  return row.status === "Requested" || row.status === "Changes requested";
}

function currentReviewer(row: Stored, loan: LoanContext, members: VersionedBrokerageMember[]) {
  return members.some((member) => member.email === row.reviewerEmail && member.role === row.reviewerRole &&
    (member.accessRevision ?? 0) === row.reviewerAccessRevision && eligible(member, loan, row.requesterEmail));
}

function evidenceChanged(row: Stored, loan: LoanContext) {
  return row.category === "1003 second review" && row.applicationRevision !== loan.applicationRevision;
}

function queue(db: Store, input: ReviewQueueQuery, staff: WorkspaceStaff, today: string): ReviewResult {
  const role = staff.brokerage.role;
  if (input.view === "Brokerage" && role !== "Admin") return { error: reviewsUnavailable };
  const filters: string[] = [];
  const args: SqlValue[] = [];
  if (input.view !== "Brokerage") {
    filters.push(input.view === "Assigned to me" ? "review.reviewerEmail = ?" : "review.requesterEmail = ?");
    args.push(staff.email);
  }
  if (role === "LO") { filters.push("loan.officerEmail = ?"); args.push(staff.email); }
  if (role === "Processor") {
    filters.push("EXISTS (SELECT 1 FROM loan_processing processing WHERE processing.loanId = loan.id AND processing.processorEmail = ?)");
    args.push(staff.email);
  }
  if (input.filter !== "All") filters.push(active);
  if (input.filter === "Overdue") { filters.push("review.dueOn < ?"); args.push(today); }
  if (input.filter === "Escalated") filters.push("review.escalatedAt IS NOT NULL");
  if (input.after) { filters.push("(review.dueOn, review.id) > (?, ?)"); args.push(input.after.dueOn, input.after.id); }
  const rows = db.prepare(`SELECT ${columns} ${joined} ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY review.dueOn, review.id LIMIT ?`).all(...args, pageSize + 1) as unknown as Base[];
  const reviews = rows.slice(0, pageSize).map((row) => summary(row, today));
  const last = reviews.at(-1);
  return { kind: "queue", reviews, next: rows.length > pageSize && last ? { id: last.id, dueOn: last.dueOn } : null };
}

function history(db: Store, id: string, before?: number) {
  const rows = db.prepare(`SELECT sequence, action, actorName, note, context, at FROM loan_review_events WHERE reviewId = ?
    ${before ? "AND sequence < ?" : ""} ORDER BY sequence DESC LIMIT ?`).all(id, ...(before ? [before] : []), pageSize + 1) as unknown as ReviewHistoryEvent[];
  const events = rows.slice(0, pageSize).map((event) => ({ ...event }));
  return { history: events, before: rows.length > pageSize ? events.at(-1)?.sequence ?? null : null };
}

function canManage(row: Stored, staff: WorkspaceStaff) {
  return isOpen(row) && (row.requesterEmail === staff.email || staff.brokerage.role === "Admin");
}

export function routeSecondApplicationReview(db: Store, staff: WorkspaceStaff, trigger: {
  loanId: string; applicationRevision: number; settings: PlaybookSettings; reviewer: VersionedBrokerageMember | null; at: string;
}) {
  const { loanId, applicationRevision, settings, reviewer, at } = trigger;
  const rule = settings.secondReview;
  if (!rule || !db.prepare("SELECT 1 FROM loans WHERE id = ? AND disposition = 'Active' AND stage NOT IN ('Funded', 'Closed')").get(loanId)) return;
  if (db.prepare(`SELECT 1 FROM loan_reviews review WHERE loanId = ? AND category = '1003 second review'
    AND ((${active}) OR (status = 'Approved' AND applicationRevision = ?)) LIMIT 1`).get(loanId, applicationRevision)) return;

  const today = easternDate(new Date(at));
  const dueOn = shiftReportDate(today, rule.dueDays);
  if (reviewer?.email === rule.reviewerEmail && reviewer.email !== staff.email && reviewer.role === "Admin" && reviewer.status === "Active") {
    const result = mutate(db, { type: "create", id: crypto.randomUUID(), loanId, title: "Second review of submitted 1003",
      category: "1003 second review", reviewerEmail: reviewer.email, dueOn,
      note: `Assigned by the brokerage playbook after the first staff review. Playbook revision ${settings.revision}.` }, staff, [reviewer], today, at);
    if ("kind" in result && result.kind === "saved") return "routed";
  }

  const reason = rule.reviewerEmail === staff.email ? "The configured reviewer recorded the first review. Assign another active staff member." :
    "The configured reviewer is unavailable. Assign an active staff member with access to this loan.";
  db.prepare(`INSERT INTO application_review_routing_blocks (loanId, applicationRevision, dueOn, policyRevision, reason, at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(loanId) DO UPDATE SET applicationRevision = excluded.applicationRevision, dueOn = excluded.dueOn,
      policyRevision = excluded.policyRevision, reason = excluded.reason, at = excluded.at`)
    .run(loanId, applicationRevision, dueOn, settings.revision, reason, at);
  return "blocked";
}

export function loanReviewWork(db: Store, input: ReviewInput | ReviewOffboarding, staff: WorkspaceStaff, brokerageId: string, members: VersionedBrokerageMember[], now = new Date()): ReviewResult {
  if (staff.brokerage.id !== brokerageId) return { error: reviewsUnavailable };
  const today = easternDate(now);
  if (input.type === "queue") return queue(db, input, staff, today);
  if (input.type === "inbox" || input.type === "readNotice") {
    const member = members.find(({ email, role, status }) => email === staff.email && role === staff.brokerage.role && status === "Active");
    if (!member) return { error: reviewsUnavailable };
    return input.type === "readNotice" ? db.transaction(() => reviewInbox(db, input, member, today)) : reviewInbox(db, input, member, today);
  }
  if (input.type !== "loan" && input.type !== "detail") return db.transaction(() => mutate(db, input, staff, members, today, now.toISOString()));
  const loan = scopeLoan(db, staff, input.loanId);
  if (!loan) return { error: reviewsUnavailable };
  if (input.type === "loan") {
    const rows = db.prepare(`SELECT ${columns} ${joined} WHERE review.loanId = ? ORDER BY NOT (${active}), review.dueOn DESC, review.id DESC LIMIT ?`)
      .all(input.loanId, pageSize + 1) as unknown as Base[];
    const reviews = rows.slice(0, pageSize).map((row) => summary(row, today));
    if (input.focusId && !reviews.some(({ id }) => id === input.focusId)) {
      const focused = db.prepare(`SELECT ${columns} ${joined} WHERE review.loanId = ? AND review.id = ?`).get(input.loanId, input.focusId) as unknown as Base | undefined;
      if (focused) reviews.unshift(summary(focused, today));
    }
    const requireApproval = readPlaybook(db).requireSecondReview;
    const inReviewPipeline = loan.active && loan.inPipeline && loan.applicationRevision !== null;
    const pendingApproval = inReviewPipeline && requireApproval && db.prepare(`SELECT NOT EXISTS (
      SELECT 1 FROM loan_reviews pending WHERE ${openSecondReview}) AS needsAssignment
      FROM applications app LEFT JOIN loan_processing processing ON processing.loanId = app.loanId
      WHERE app.loanId = ? AND ${pendingRequiredApproval}`).get(input.loanId);
    const routingBlock = inReviewPipeline && (!requireApproval || pendingApproval) ? db.prepare(`SELECT dueOn, reason FROM application_review_routing_blocks
      WHERE loanId = ? AND applicationRevision = ?`).get(input.loanId, loan.applicationRevision) : undefined;
    return { kind: "loan", reviews, options: loan.active ? options(members, loan, staff.email) : [], today,
      hasMore: rows.length > pageSize, canReview1003: loan.applicationRevision !== null,
      ...(routingBlock ? { routingBlock: { dueOn: String(routingBlock.dueOn), reason: String(routingBlock.reason) } } :
        pendingApproval && pendingApproval.needsAssignment
          ? { routingBlock: { dueOn: null, reason: "Assign a second reviewer for the current 1003 before handoff." } } : {}) };
  }
  const row = scopedReview(db, input.loanId, input.id);
  if (!row) return { error: reviewsUnavailable };
  const reviewerAvailable = currentReviewer(row, loan, members);
  const changed = evidenceChanged(row, loan);
  return { kind: "detail", review: { ...summary(row, today), revision: row.revision, reviewerEmail: row.reviewerEmail,
    applicationRevision: row.applicationRevision, evidenceChanged: changed, reviewerAvailable, canManage: canManage(row, staff),
    canDecide: loan.active && row.status === "Requested" && row.reviewerEmail === staff.email && reviewerAvailable && !changed,
    options: options(members, loan, row.requesterEmail), mentionOptions: options(members, loan, staff.email) }, ...history(db, row.id, input.before), today };
}

function mutate(db: Store, input: ReviewMutation | ReviewOffboarding, staff: WorkspaceStaff, members: VersionedBrokerageMember[], today: string, at: string): ReviewResult {
  const loan = scopeLoan(db, staff, input.loanId);
  if (!loan) return { error: reviewsUnavailable };
  const row = scopedReview(db, input.loanId, input.id);
  const eventId = input.type === "create" ? input.id : input.eventId;
  const receipt = JSON.stringify(input);
  const prior = db.prepare("SELECT actorEmail, reviewId, request FROM loan_review_events WHERE id = ?").get(eventId);
  const saved = { kind: "saved" as const, id: input.id, message: "Internal review updated." };
  if (prior) return prior.actorEmail === staff.email && prior.reviewId === input.id && prior.request === receipt ? saved :
    { error: "This action was already used. Refresh the review before continuing." };
  const log = (action: ReviewHistoryEvent["action"], context = "") => db.prepare(`INSERT INTO loan_review_events
    (id, reviewId, actorEmail, actorName, action, note, at, request, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(eventId, input.id, staff.email, staff.name, action, input.note, at, receipt, context);
  const assigned = (name: string, date: string, version: number | null) =>
    `${name} · Due ${date}${version === null ? "" : ` · 1003 revision ${version}`}`;
  const selectReviewer = (email: string, requester: string) => members.find((member) => member.email === email && eligible(member, loan, requester));
  const notify = (email: string, label: string) => {
    const recipient = selectReviewer(email, staff.email);
    if (recipient) recordReviewNotice(db, eventId, recipient, label, at);
  };
  if (input.type === "create") {
    const reviewer = selectReviewer(input.reviewerEmail, staff.email);
    if (row || !loan.active || !reviewer) return { error: "Choose another active staff member with access to this loan." };
    if (input.dueOn < today) return { error: "Choose today or a future review date." };
    if (input.category === "1003 second review" && loan.applicationRevision === null) return { error: "A submitted 1003 is required before requesting a second review." };
    db.prepare(`INSERT INTO loan_reviews (id, loanId, title, category, requesterEmail, requesterName, reviewerEmail, reviewerName,
      reviewerRole, reviewerAccessRevision, dueOn, status, applicationRevision, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Requested', ?, ?, ?)`)
      .run(input.id, input.loanId, input.title, input.category, staff.email, staff.name, reviewer.email, reviewer.name,
        reviewer.role, reviewer.accessRevision ?? 0, input.dueOn, input.category === "1003 second review" ? loan.applicationRevision : null, at, at);
    log("Requested", assigned(reviewer.name, input.dueOn, input.category === "1003 second review" ? loan.applicationRevision : null));
    notify(reviewer.email, "Review assigned");
    if (input.category === "1003 second review") {
      db.prepare("DELETE FROM application_review_routing_blocks WHERE loanId = ? AND applicationRevision = ?").run(input.loanId, loan.applicationRevision);
    }
    return { ...saved, message: "Internal review requested." };
  }
  if (!row) return { error: reviewsUnavailable };
  if (input.type === "comment") {
    const mentioned = input.mentionEmail ? selectReviewer(input.mentionEmail, staff.email) : undefined;
    if (input.mentionEmail && !mentioned) return { error: "Choose an active teammate with access to this loan." };
    log("Commented", mentioned ? `Mentioned ${mentioned.name}` : "");
    if (mentioned) notify(mentioned.email, "Mentioned in a comment");
    return { ...saved, message: mentioned ? "Internal comment added and teammate notified in Orbit." : "Internal comment added." };
  }
  if (row.revision !== input.revision) return { error: "This review changed. Refresh it before continuing." };
  if (input.type === "offboardingHandoff") {
    const reviewer = input.participant === "Reviewer";
    if (staff.brokerage.role !== "Admin" || !isOpen(row) || (reviewer ? row.reviewerEmail : row.requesterEmail) !== input.from) {
      return { error: reviewsUnavailable };
    }
    if (input.replacement === null) {
      db.prepare("UPDATE loan_reviews SET status = 'Canceled', escalatedAt = NULL, updatedAt = ?, revision = revision + 1 WHERE id = ?")
        .run(at, row.id);
      log("Canceled", "Staff offboarding");
      return { ...saved, message: "Review canceled. Its history remains on the loan." };
    }
    const member = selectReviewer(input.replacement, reviewer ? row.requesterEmail : row.reviewerEmail);
    if (!member || member.email === input.from) return { error: "Choose another active staff member with access to this loan." };
    if (reviewer) {
      db.prepare(`UPDATE loan_reviews SET reviewerEmail = ?, reviewerName = ?, reviewerRole = ?, reviewerAccessRevision = ?,
        updatedAt = ?, revision = revision + 1 WHERE id = ?`).run(member.email, member.name, member.role, member.accessRevision ?? 0, at, row.id);
    } else {
      db.prepare("UPDATE loan_reviews SET requesterEmail = ?, requesterName = ?, updatedAt = ?, revision = revision + 1 WHERE id = ?")
        .run(member.email, member.name, at, row.id);
    }
    log(reviewer ? "Reviewer handed off" : "Requester handed off",
      `${reviewer ? row.reviewerName : row.requesterName} → ${assigned(member.name, row.dueOn, row.applicationRevision)}`);
    if (member.email !== staff.email) recordReviewNotice(db, eventId, member, reviewer ? "Review assigned" : "Review requester handoff", at);
    return { ...saved, message: "Review handed off with its original deadline and evidence." };
  }
  if (input.type === "decide") {
    if (!loan.active || row.status !== "Requested" || row.reviewerEmail !== staff.email || !currentReviewer(row, loan, members)) {
      return { error: "Only the current assigned reviewer can record a decision on this active file." };
    }
    if (evidenceChanged(row, loan)) return { error: "The submitted 1003 changed. Ask the requester to resubmit this review." };
    db.prepare("UPDATE loan_reviews SET status = ?, escalatedAt = NULL, updatedAt = ?, revision = revision + 1 WHERE id = ?")
      .run(input.decision, at, row.id);
    log(input.decision, row.applicationRevision === null ? "" : `1003 revision ${row.applicationRevision}`);
    notify(row.requesterEmail, input.decision === "Approved" ? "Review approved" : "Changes requested");
    return { ...saved, message: input.decision === "Approved" ? "Internal approval recorded." : "Changes requested." };
  }
  if (!canManage(row, staff)) return { error: "Only the requester or a brokerage admin can manage this review." };
  if ("dueOn" in input && input.dueOn < today) return { error: "Choose today or a future review date." };
  if (input.type === "reassign") {
    const reviewer = selectReviewer(input.reviewerEmail, row.requesterEmail);
    if (!reviewer) return { error: "Choose an active reviewer with access to this loan." };
    db.prepare(`UPDATE loan_reviews SET reviewerEmail = ?, reviewerName = ?, reviewerRole = ?, reviewerAccessRevision = ?, dueOn = ?,
      escalatedAt = NULL, updatedAt = ?, revision = revision + 1 WHERE id = ?`)
      .run(reviewer.email, reviewer.name, reviewer.role, reviewer.accessRevision ?? 0, input.dueOn, at, row.id);
    log("Reassigned", `${row.reviewerName} → ${assigned(reviewer.name, input.dueOn, row.applicationRevision)}`);
    notify(reviewer.email, "Reviewer or deadline updated");
  } else if (input.type === "resubmit") {
    if (row.status !== "Changes requested" && !evidenceChanged(row, loan)) return { error: "Resubmit after changes were requested or the 1003 changed." };
    if (!loan.active || !currentReviewer(row, loan, members)) return { error: "Resume the file and confirm its reviewer before resubmitting." };
    if (row.category === "1003 second review" && loan.applicationRevision === null) return { error: "Wait for the updated 1003 submission before resubmitting the review." };
    db.prepare(`UPDATE loan_reviews SET status = 'Requested', dueOn = ?, applicationRevision = ?, escalatedAt = NULL, updatedAt = ?, revision = revision + 1 WHERE id = ?`)
      .run(input.dueOn, row.category === "1003 second review" ? loan.applicationRevision : null, at, row.id);
    log("Resubmitted", assigned(row.reviewerName, input.dueOn, row.category === "1003 second review" ? loan.applicationRevision : null));
    notify(row.reviewerEmail, "Review resubmitted");
  } else if (input.type === "escalate") {
    if (row.escalatedAt) return { error: "This review is already escalated." };
    db.prepare("UPDATE loan_reviews SET escalatedAt = ?, updatedAt = ?, revision = revision + 1 WHERE id = ?").run(at, at, row.id);
    log("Escalated");
  } else {
    db.prepare("UPDATE loan_reviews SET status = 'Canceled', escalatedAt = NULL, updatedAt = ?, revision = revision + 1 WHERE id = ?").run(at, row.id);
    log("Canceled");
    notify(row.reviewerEmail, "Review canceled");
  }
  return saved;
}
