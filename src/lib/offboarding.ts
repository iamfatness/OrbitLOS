import { createHash } from "node:crypto";
import { easternDate } from "./client-retention";
import { changeConversation } from "./conversations";
import { coverageWork } from "./coverage";
import { leadRouting, updateInboxLead, writeLeadRouting } from "./lead-inbox";
import { assignProcessor } from "./loan-processing";
import { loanReviewWork } from "./loan-reviews";
import { departureKinds, offboardingUnavailable, type DepartureItem, type DepartureKind, type DeparturePage,
  type DepartureRoster, type OffboardingInput } from "./offboarding-model";
import { saveRealtorLinkOwner } from "./realtor-portal";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { accessEvent, assignLoan } from "./workspace-access";

const pageSize = 20;
const continuingLoan = "loan.disposition IN ('Active', 'On hold')";
const linkKey = (token: string) => createHash("sha256").update(token).digest("hex");
const reviewSource = (participant: "requester" | "reviewer") => ({
  id: "review.id",
  fields: `review.loanId AS recordId, review.title, contact.name || ' · ' || review.status AS detail, review.revision, review.dueOn AS due,
    loan.officerEmail AS loanOfficer, processing.processorEmail AS processor, review.${participant === "reviewer" ? "requester" : "reviewer"}Email AS otherReviewer`,
  from: `loan_reviews review JOIN loans loan ON loan.id = review.loanId JOIN contacts contact ON contact.id = loan.contactId
    LEFT JOIN loan_processing processing ON processing.loanId = loan.id`,
  where: `review.${participant}Email = ? AND review.status IN ('Requested', 'Changes requested')`,
});
const sources = {
  Lead: {
    id: "lead.id",
    fields: `lead.id AS recordId, lead.name AS title, CASE WHEN lead.heldAt IS NOT NULL THEN 'On hold · ' ELSE '' END ||
      coalesce(campaign.name, CASE WHEN lead.realtorId IS NOT NULL THEN 'Realtor referral' ELSE 'Lead Inbox' END) AS detail,
      coalesce(follow.revision, 0) AS revision,
      CASE WHEN lead.heldAt IS NOT NULL THEN lead.revisitDate
        WHEN callback.dueAt IS NOT NULL THEN callback.dueAt
        WHEN follow.firstContactAt IS NULL AND follow.replyReceivedAt IS NULL THEN lead.dueAt ELSE follow.nextAt END AS due,
      CASE WHEN lead.heldAt IS NOT NULL THEN 'Revisit'
        WHEN callback.dueAt IS NOT NULL THEN CASE WHEN member.lastOutcome = 'Requested callback' THEN 'Callback due' ELSE 'Retry due' END
        WHEN follow.firstContactAt IS NULL THEN 'First contact due' ELSE 'Follow-up due' END AS dueLabel,
      campaign.id AS campaignId`,
    from: `referral_leads lead LEFT JOIN call_campaign_members member ON member.leadId = lead.id
      LEFT JOIN call_campaigns campaign ON campaign.id = member.campaignId
      LEFT JOIN lead_import_tasks callback ON callback.id = member.callbackTaskId AND callback.completedAt IS NULL
      LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id`,
    where: "lead.officerEmail = ? AND lead.resolvedAt IS NULL",
  },
  Loan: {
    id: "loan.id",
    fields: `loan.id AS recordId, contact.name AS title, loan.stage || CASE WHEN loan.disposition = 'On hold' THEN ' · On hold' ELSE '' END AS detail,
      0 AS revision, (SELECT dueAt FROM tasks WHERE loanId = loan.id AND completedAt IS NULL ORDER BY dueAt, id LIMIT 1) AS due,
      processing.processorEmail AS processor`,
    from: `loans loan JOIN contacts contact ON contact.id = loan.contactId LEFT JOIN loan_processing processing ON processing.loanId = loan.id`,
    where: `loan.officerEmail = ? AND ${continuingLoan}`,
  },
  Processing: {
    id: "processing.loanId",
    fields: `loan.id AS recordId, contact.name AS title, processing.status AS detail, processing.revision, loan.officerEmail AS loanOfficer`,
    from: "loan_processing processing JOIN loans loan ON loan.id = processing.loanId JOIN contacts contact ON contact.id = loan.contactId",
    where: `processing.processorEmail = ? AND processing.status <> 'Unassigned' AND ${continuingLoan}`,
  },
  "Contact follow-up": {
    id: "task.id",
    fields: "contact.id AS recordId, contact.name AS title, task.kind || ' · ' || task.purpose AS detail, task.revision, task.dueAt AS due",
    from: "contact_activity task JOIN contacts contact ON contact.id = task.contactId",
    where: "task.followUpOwnerEmail = ? AND task.completedAt IS NULL AND task.dueAt IS NOT NULL",
  },
  "Contact conversation": {
    id: "thread.id",
    fields: `thread.id AS recordId, contact.name AS title, contact.role || ' · ' || thread.status ||
      CASE WHEN thread.unread = 1 THEN ' · Unread' ELSE '' END AS detail,
      thread.revision, thread.dueOn AS due, 'Follow-up due' AS dueLabel`,
    from: "contact_conversations thread JOIN contacts contact ON contact.id = thread.contactId",
    where: "thread.ownerEmail = ? AND thread.status <> 'Closed'",
  },
  "Review requester": reviewSource("requester"),
  Reviewer: reviewSource("reviewer"),
  Coverage: {
    id: "coverage.id",
    fields: `coverage.id AS recordId, coverage.absentName || ' → ' || coverage.backupName AS title,
      coverage.startsOn || ' to ' || coverage.endsOn AS detail, 0 AS revision`,
    from: "staff_coverage coverage",
    where: "(coverage.absentEmail = ? OR coverage.backupEmail = ?) AND coverage.endedAt IS NULL AND coverage.endsOn >= ?",
  },
  "Realtor link": {
    id: "portal.realtorId",
    fields: `portal.realtorId AS recordId, contact.name AS title, portal.revision, portal.token, portal.expiresAt AS due, 'Expires' AS dueLabel`,
    from: "realtor_portals portal JOIN contacts contact ON contact.id = portal.realtorId AND contact.role = 'Realtor'",
    where: "portal.officerEmail = ? AND portal.expiresAt > ?",
  },
} satisfies Record<Exclude<DepartureKind, "Intake route">, { id: string; fields: string; from: string; where: string }>;

function rowsFor(db: Store, kind: DepartureKind, email: string, now: Date, limit: number, key?: { id: string; exact?: boolean }) {
  const item = (row: Pick<DepartureItem, "id" | "recordId" | "title" | "detail" | "revision"> & Partial<DepartureItem>): DepartureItem =>
    ({ due: null, dueLabel: "Due", campaignId: null, loanOfficer: null, processor: null, otherReviewer: null, ...row, kind });
  if (kind === "Intake route") {
    const routing = leadRouting(db);
    const routes = [
      { id: "quote", title: "Website quote form", applies: routing.quoteToken !== null && routing.websiteOwner === email },
      { id: "realtor", title: "Brokerage-wide realtor routing", applies: routing.realtorRoute === "Assigned officer" && routing.realtorOwner === email },
    ];
    return routes.filter((route) => route.applies && (!key || (key.exact ? route.id === key.id : route.id > key.id))).slice(0, limit)
      .map(({ id, title }) => item({ id, recordId: id, title, revision: routing.revision,
        detail: id === "quote" ? "Applies to new quote requests" : "Applies to new realtor referrals" }));
  }
  const source = sources[kind];
  const args: SqlValue[] = kind === "Coverage" ? [email, email, easternDate(now)] : kind === "Realtor link" ? [email, now.toISOString()] : [email];
  const keyFilter = key ? `AND ${source.id} ${key.exact ? "=" : ">"} ?` : "";
  if (key) args.push(key.id);
  type Row = Parameters<typeof item>[0];
  const rows = db.prepare(`SELECT ${source.id} AS id, ${source.fields} FROM ${source.from}
    WHERE ${source.where} ${keyFilter} ORDER BY ${source.id} LIMIT ?`).all(...args, limit);
  if (rows.length === 0) return [];
  if (kind !== "Realtor link") return (rows as unknown as Row[]).map(item);
  const linkRouting = leadRouting(db).realtorRoute === "Link owner";
  return (rows as unknown as (Row & { token: string })[]).map(({ token, ...row }) => item({ ...row, routeKey: linkKey(token),
    detail: linkRouting ? "Applies to new referrals" : "Saved link owner · Brokerage routing takes precedence" }));
}

export function hasDepartureWork(db: Store, email: string, now = new Date()) {
  return departureKinds.some((kind) => rowsFor(db, kind, email, now, 1).length > 0);
}

export function departureWork(db: Store, input: Exclude<OffboardingInput, { type: "offboardingRevoke" }>, roster: DepartureRoster,
  staff: WorkspaceStaff, brokerageId: string, now = new Date()): DeparturePage | { message: string } | { error: string } {
  if (staff.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin" || input.email !== roster.member.email) return { error: offboardingUnavailable };
  const { member, replacement, canRevoke } = roster;
  if (input.type === "offboardingPreview") {
    const kinds = input.filter === "All work" ? departureKinds : [input.filter];
    const after = input.after;
    if (after && !kinds.includes(after.kind)) return { error: "Refresh the offboarding list before continuing." };
    const items: DepartureItem[] = [];
    for (const kind of kinds.slice(after ? kinds.indexOf(after.kind) : 0)) {
      items.push(...rowsFor(db, kind, member.email, now, pageSize + 1 - items.length, after?.kind === kind ? after : undefined));
      if (items.length > pageSize) break;
    }
    const visible = items.slice(0, pageSize);
    const last = visible.at(-1);
    const remaining = visible.length > 0 || ((!!after || input.filter !== "All work") && hasDepartureWork(db, member.email, now));
    return { member, items: visible, next: items.length > pageSize && last ? { kind: last.kind, id: last.id } : null, remaining, canRevoke };
  }
  if (member.accessRevision !== input.memberRevision) return { error: "Staff access changed. Refresh the offboarding preview." };
  if (input.replacement && (replacement?.email !== input.replacement || replacement.status !== "Active" || replacement.email === member.email)) {
    return { error: "Choose another active staff member in this brokerage." };
  }
  const [row] = rowsFor(db, input.kind, member.email, now, 1, { id: input.id, exact: true });
  if (!row) return { message: "This work is no longer open for this staff member." };
  if (row.revision !== input.revision) return { error: "This item changed. Refresh the offboarding preview before handing it off." };
  const at = now.toISOString();
  switch (row.kind) {
    case "Realtor link":
    case "Intake route": {
      if (replacement?.role === "Processor") return { error: "Choose an active loan officer, admin, or the shared inbox." };
      return db.transaction(() => {
        if (row.kind === "Realtor link") {
          const current = db.prepare("SELECT token FROM realtor_portals WHERE realtorId = ? AND officerEmail = ?").get(row.recordId, member.email);
          if (typeof current?.token !== "string" || linkKey(current.token) !== input.routeKey) {
            return { error: "This realtor link changed. Refresh the offboarding preview." };
          }
          return saveRealtorLinkOwner(db, { realtorId: row.recordId, token: current.token, revision: row.revision }, replacement, staff, at);
        }
        const routing = leadRouting(db);
        if (routing.revision !== row.revision) return { error: "Intake routing changed. Refresh the offboarding preview." };
        const email = replacement?.email ?? null;
        if (row.id === "quote") {
          writeLeadRouting(db, { ...routing, websiteOwner: email });
        } else {
          writeLeadRouting(db, { ...routing, realtorOwner: email, realtorRoute: email ? "Assigned officer" : "Shared inbox" });
        }
        accessEvent(db, staff, "Updated intake route during offboarding", row.id, at);
        return { message: "Future leads will use the updated intake route." };
      });
    }
    case "Contact conversation": {
      if (!replacement || replacement.role === "Processor") return { error: "Choose an active loan officer or admin." };
      const result = changeConversation(db, { type: "assignContact", id: row.id, revision: row.revision,
        email: replacement.email, eventId: input.operationId }, staff, brokerageId, now, replacement);
      return "error" in result ? result : { message: "Contact conversation handed off with its reply state and follow-up date." };
    }
    case "Lead":
    case "Loan":
    case "Contact follow-up": {
      if (!replacement || replacement.role === "Processor") return { error: "Choose an active loan officer or admin." };
      if (row.kind === "Loan") {
        return assignLoan(db, staff, { loanId: row.id, previousEmail: member.email, member: replacement });
      }
      return db.transaction(() => {
        if (row.kind === "Lead") {
          const result = updateInboxLead(db, staff, { type: "assignInboxLead", leadId: row.id, email: replacement.email,
            previousEmail: member.email }, [replacement], at);
          if (!("error" in result)) accessEvent(db, staff, "Handed off lead", `${row.id} · ${member.email} → ${replacement.email}`, at);
          return result;
        }
        // Changing ownership leaves consent and outreach eligibility untouched.
        db.prepare("UPDATE contact_activity SET followUpOwner = ?, followUpOwnerEmail = ?, revision = revision + 1 WHERE id = ?")
          .run(replacement.name.slice(0, 160), replacement.email, row.id);
        accessEvent(db, staff, "Reassigned contact follow-up", `${row.id} · ${member.email} → ${replacement.email}`, at);
        return { message: "Contact follow-up handed off with its original deadline." };
      });
    }
    case "Processing": {
      if (!replacement && !row.loanOfficer) return { error: "Assign a loan officer to this file before removing its processor." };
      return assignProcessor(db, staff, { loanId: row.id, revision: row.revision, member: replacement, preserveHandoff: true });
    }
    case "Review requester":
    case "Reviewer": {
      const result = loanReviewWork(db, { type: "offboardingHandoff", loanId: row.recordId, id: row.id, eventId: input.operationId,
        participant: row.kind, from: member.email, replacement: replacement?.email ?? null, revision: row.revision,
        note: replacement ? "Handed off during staff offboarding." : "Canceled by an admin during staff offboarding." },
      staff, brokerageId, replacement ? [replacement] : [], now);
      return "error" in result ? result : { message: result.kind === "saved" ? result.message : "Internal review updated." };
    }
    case "Coverage": {
      if (replacement) return { error: "End this window and schedule new coverage for the remaining staff if needed." };
      const result = coverageWork(db, { type: "end", id: row.id }, staff, brokerageId, [], now);
      return "error" in result ? result : { message: "Coverage ended. Schedule a new window from Staff coverage if needed." };
    }
  }
}
