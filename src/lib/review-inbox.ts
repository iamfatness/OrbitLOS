import type { VersionedBrokerageMember } from "./brokerage-model";
import type { ReviewInput, ReviewNotice, ReviewResult } from "./loan-review-model";
import type { Store } from "./store";

type InboxInput = Extract<ReviewInput, { type: "inbox" | "readNotice" }>;
const pageSize = 20;

export function recordReviewNotice(db: Store, eventId: string, recipient: VersionedBrokerageMember, label: string, at: string) {
  db.prepare(`INSERT INTO loan_review_notices (eventId, recipientEmail, recipientRole, recipientRevision, label, at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(eventId, recipient.email, recipient.role, recipient.accessRevision ?? 0, label, at);
}

export function reviewInbox(db: Store, input: InboxInput, member: VersionedBrokerageMember, today: string): ReviewResult {
  const revision = member.accessRevision ?? 0;
  const reading = input.type === "readNotice";
  const id = reading ? input.id : input.after?.id ?? null;
  const after = reading ? null : input.after?.at ?? null;
  const reviewId = reading ? input.reviewId : null;
  const unread = !reading && input.unread;
  const common = `review.loanId, review.id AS reviewId, review.title, contact.name AS borrower, review.status, review.dueOn`;
  const file = `JOIN loans loan ON loan.id = review.loanId JOIN contacts contact ON contact.id = loan.contactId`;
  const scoped = `AND (viewer.role = 'Admin' OR (viewer.role = 'LO' AND loan.officerEmail = viewer.email) OR
    (viewer.role = 'Processor' AND EXISTS (SELECT 1 FROM loan_processing processing WHERE processing.loanId = loan.id AND processing.processorEmail = viewer.email)))`;
  const readJoin = (key: string) => `LEFT JOIN loan_review_notice_reads seen ON seen.reviewId = review.id AND seen.noticeId = ${key}
    AND seen.recipientEmail = viewer.email AND seen.recipientRevision = viewer.revision AND seen.recipientRole = viewer.role`;
  const readFilter = unread ? "AND seen.noticeId IS NULL" : "";
  const date = "review.dueOn || 'T00:00:00.000Z'";
  const reminderId = `review.id || ':' || schedule.id || CASE WHEN review.dueOn = viewer.today THEN ':due' ELSE ':overdue' END`;
  const match = (key: string, at: string) => reading ? `AND review.id = viewer.reviewId AND (${key}) = viewer.noticeId` :
    after ? `AND ((${at}), (${key})) < (viewer.afterAt, viewer.noticeId)` : "";
  const rows = db.prepare(`WITH viewer(email, role, revision, today, noticeId, afterAt, reviewId) AS (VALUES (?, ?, ?, ?, ?, ?, ?)),
    events AS (
      SELECT notice.eventId AS id, notice.at AS at, ${common}, notice.label AS label, event.actorName AS actor,
        seen.noticeId IS NOT NULL AS read
      FROM viewer CROSS JOIN loan_review_notices notice JOIN loan_review_events event ON event.id = notice.eventId
        JOIN loan_reviews review ON review.id = event.reviewId ${file} ${readJoin("notice.eventId")}
      WHERE notice.recipientEmail = viewer.email AND notice.recipientRole = viewer.role AND notice.recipientRevision = viewer.revision
        ${scoped} ${match("notice.eventId", "notice.at")} ${readFilter}
      ORDER BY notice.at DESC, notice.eventId DESC LIMIT ${pageSize + 1}
    ), reminders AS (
      SELECT ${reminderId} AS id, ${date} AS at, ${common},
        CASE WHEN review.dueOn = viewer.today THEN 'Review due today' ELSE 'Review overdue' END AS label, NULL AS actor,
        seen.noticeId IS NOT NULL AS read
      FROM viewer CROSS JOIN loan_reviews review ${file} JOIN loan_review_events schedule ON schedule.sequence = (
        SELECT sequence FROM loan_review_events WHERE reviewId = review.id
          AND action IN ('Requested', 'Changes requested', 'Resubmitted', 'Reassigned') ORDER BY sequence DESC LIMIT 1
      ) ${readJoin(reminderId)}
      WHERE review.status IN ('Requested', 'Changes requested') AND loan.disposition = 'Active' AND review.dueOn <= viewer.today
        AND (CASE review.status WHEN 'Changes requested' THEN review.requesterEmail ELSE review.reviewerEmail END) = viewer.email
        AND (review.status = 'Changes requested' OR (review.reviewerRole = viewer.role AND review.reviewerAccessRevision = viewer.revision))
        ${after ? "AND review.dueOn <= substr(viewer.afterAt, 1, 10)" : ""}
        ${scoped} ${match(reminderId, date)} ${readFilter}
      ORDER BY review.dueOn DESC, review.id DESC LIMIT ${pageSize + 1}
    ) SELECT * FROM events UNION ALL SELECT * FROM reminders ORDER BY at DESC, id DESC LIMIT ${pageSize + 1}`)
    .all(member.email, member.role, revision, today, id, after, reviewId) as unknown as (Omit<ReviewNotice, "read"> & { read: number })[];
  if (reading) {
    const notice = rows[0];
    if (!notice) return { error: "This notice is no longer available. Refresh your review inbox." };
    db.prepare(`INSERT OR IGNORE INTO loan_review_notice_reads (reviewId, noticeId, recipientEmail, recipientRevision, recipientRole) VALUES (?, ?, ?, ?, ?)`)
      .run(notice.reviewId, notice.id, member.email, revision, member.role);
    return { kind: "noticeRead", loanId: notice.loanId, reviewId: notice.reviewId };
  }
  const notices = rows.slice(0, pageSize).map((row) => ({ ...row, read: Boolean(row.read) }));
  const last = notices.at(-1);
  return { kind: "inbox", notices, next: rows.length > pageSize && last ? { id: last.id, at: last.at } : null };
}
