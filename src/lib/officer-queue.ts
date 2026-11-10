import { easternDate, easternDayStart } from "./client-retention";
import { approvedSecondReview } from "./application-review-checkpoint";
import { appointmentTarget } from "./appointment-model";
import type { BrokerageRole } from "./brokerage-model";
import { carriedCallbackSource, openCarriedCallback } from "./carried-campaign-callback";
import { coverageKinds, type CoverageItem, type CoverageWindow } from "./coverage-model";
import { currentConversationContact, readOwnedConversationReplies } from "./conversations";
import { campaignFollowUpRecipient } from "./call-campaign-model";
import { sequenceStep } from "./campaign-sequence-model";
import { borrowerChannelBits } from "./borrower-channel-model";
import { leadBorrowerHoursSql, leadChannelBlocksSql, storedBorrowerHours } from "./borrower-channels";
import { nextBorrowerContactTime } from "./borrower-hours";
import { reviewTarget } from "./loan-review-model";
import { closingChecklistTarget, loanTaskTarget } from "./loan-workflow";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import { calendarGroups, calendarQuery, calendarUnavailable, campaignCallbackQuery, campaignCallbacksUnavailable, officerQueueQuery, officerQueueUnavailable,
  workspaceTaskGroups, workspaceTasksInput, workspaceTasksUnavailable, type CalendarItem, type CalendarPage, type CalendarQuery, type CampaignCallbackPage, type ContactTaskWork,
  type OfficerQueueItem, type OfficerQueuePage, type WorkspaceTaskList, type WorkspaceTaskPage } from "./officer-queue-model";
import { afterHours, fundingTaskPrefix } from "./playbook-model";
import { readPlaybook } from "./playbooks";
import { contactCompletionSql } from "./record-history";
import { shiftReportDate } from "./report-date-range";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";

const pageSize = 20;
const scanSize = 60;
const sparseDeadlineLimit = scanSize * 4;
const dueForLoan = `loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed')`;
const openCampaignCallback = `lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND task.completedAt IS NULL
  AND member.lastOutcome IS NOT 'Opted out' AND (follow.replyReceivedAt IS NULL OR member.lastOutcome = 'Requested callback')`;
const campaignCallbackSource = (join: "JOIN" | "CROSS JOIN" = "JOIN") => `FROM referral_leads lead
  ${join} call_campaign_members member ON member.leadId = lead.id
  ${join} lead_import_tasks task ON task.id = member.callbackTaskId AND task.leadId = lead.id
  LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id`;
type Candidate = Omit<CalendarItem, "overdue" | "target" | "owner"> & {
  owner: string | null;
  email?: string; phone?: string; contactId?: string; leadId?: string; purpose?: string; optedOut?: number; reason?: string;
  sequenceStep?: string; sequenceVersion?: number; sequencePosition?: number; sequenceHours?: string | null;
};
type CampaignCallbackCandidate = Omit<CampaignCallbackPage["items"][number], "requested" | "loanId"> & {
  requested: number | null; loanId: string | null; email: string; phone: string; contactId: string | null;
};

const dueInstant = (value: string) => value.length === 10 ? easternDayStart(value) : value;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const addSqlHours = (time: string, hours: number) =>
  `strftime('%Y-%m-%dT%H:%M:%fZ', ${time}, '+${Number.isFinite(hours) ? hours : 0} hours')`;

export function readOfficerQueue(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date(), localName?: string): OfficerQueuePage | { error: string } {
  if (!staff || staff.brokerage.id !== brokerageId || (staff.brokerage.role !== "LO" && staff.brokerage.role !== "Admin")) {
    return { error: officerQueueUnavailable };
  }
  const parsed = officerQueueQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid date window and work queue page." };
  const page = readDeadlines(db, { email: staff.email, role: staff.brokerage.role }, now,
    shiftReportDate(easternDate(now), parsed.data.horizon - 1), parsed.data.after, { localName });
  const items = page.items.map((row) => {
    const item: OfficerQueueItem & { owner?: string } = { ...row };
    delete item.owner;
    return item;
  });
  return { ...page, items, replies: readOwnedConversationReplies(db, staff, parsed.data.replyAfter, now, localName) };
}

export function readCampaignCallbacks(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date()): CampaignCallbackPage | { error: string } {
  if (!staff || staff.brokerage.id !== brokerageId || (staff.brokerage.role !== "LO" && staff.brokerage.role !== "Admin")) {
    return { error: campaignCallbacksUnavailable };
  }
  const parsed = campaignCallbackQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid campaign callback view and page." };
  const { view, after } = parsed.data;
  const checkedAt = now.toISOString();
  const timing = `task.dueAt ${view === "Due" ? "<=" : ">"} ?${after ? " AND (task.dueAt, task.id) > (?, ?)" : ""}`;
  const ownerWindow = [staff.email, checkedAt, ...(after ? [after.dueAt, after.id] : [])];
  const candidates = db.prepare(`SELECT lead.id AS leadId, NULL AS loanId, task.id AS taskId, task.dueAt AS dueAt, lead.name, campaign.name AS campaignName,
      member.lastOutcome = 'Requested callback' AS requested, lead.email, lead.phone, lead.importedContactId AS contactId
    ${campaignCallbackSource("CROSS JOIN")} JOIN call_campaigns campaign ON campaign.id = member.campaignId
    WHERE ${openCampaignCallback} AND lead.officerEmail = ? AND ${timing}
    UNION ALL
    SELECT lead.id, loan.id, task.id, task.dueAt, borrower.name, campaign.name, 1, borrower.email, borrower.phone, loan.contactId
    ${carriedCallbackSource} JOIN call_campaigns campaign ON campaign.id = member.campaignId
    JOIN contacts borrower ON borrower.id = loan.contactId
    WHERE ${openCarriedCallback} AND loan.officerEmail = ? AND ${timing}
    ORDER BY dueAt, taskId LIMIT ?`)
    .all(...ownerWindow, ...ownerWindow, scanSize + 1) as unknown as CampaignCallbackCandidate[];
  const scan = candidates.slice(0, scanSize);
  const suppression = blockedOutreachKeys(db, scan);
  const items: CampaignCallbackPage["items"] = [];
  let consumed = 0;
  for (const row of scan) {
    consumed++;
    if (outreachSuppressed(suppression, row)) continue;
    const { leadId, loanId, taskId, dueAt, campaignName, name, requested } = row;
    items.push({ leadId, ...(loanId ? { loanId } : {}), taskId, dueAt, campaignName, name, requested: Boolean(requested) });
    if (items.length === pageSize) break;
  }
  const last = candidates[consumed - 1];
  return { checkedAt, items, next: last && consumed < candidates.length ? { dueAt: last.dueAt, id: last.taskId } : null };
}

export function readWorkspaceCalendar(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date(), localName?: string): CalendarPage | { error: string } {
  if (!staff || staff.brokerage.id !== brokerageId) return { error: calendarUnavailable };
  const parsed = calendarQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid calendar week and filter." };
  const query = parsed.data;
  if (query.scope === "Team" && staff.brokerage.role !== "Admin") return { error: calendarUnavailable };
  const weekEnd = shiftReportDate(query.week, 6);
  if (query.day && (query.day < query.week || query.day > weekEnd)) return { error: "Choose a day in the displayed week." };
  return readDeadlines(db, { email: staff.email, role: staff.brokerage.role }, now, query.day ?? weekEnd, query.after, { localName, calendar: query });
}

export function readWorkspaceTasks(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date()): WorkspaceTaskPage | ContactTaskWork | { error: string } {
  if (!staff || staff.brokerage.id !== brokerageId) return { error: workspaceTasksUnavailable };
  const parsed = workspaceTasksInput.safeParse(input);
  if (!parsed.success) return { error: workspaceTasksUnavailable };
  const query = parsed.data;
  const role = staff.brokerage.role;
  if (query.type === "contact") {
    if (role === "Processor") return { error: "This contact follow-up is unavailable." };
    const row = db.prepare(`SELECT activity.*, contact.name, contact.role, contact.email, contact.phone,
      EXISTS (SELECT 1 FROM funding_check_ins WHERE activityId = activity.id) AS postFundingCheckIn,
      ${contactCompletionSql} AS completion
      FROM contact_activity activity JOIN contacts contact ON contact.id = activity.contactId
      WHERE activity.id = ? AND activity.dueAt IS NOT NULL ${role === "LO" ? "AND activity.followUpOwnerEmail = ?" : ""}`)
      .get(query.id, ...(role === "LO" ? [staff.email] : []));
    if (!row) return { error: "This contact follow-up is unavailable." };
    const { name, role: contactRole, email, phone, postFundingCheckIn, completion, ...activity } = row;
    const identity = { contactId: activity.contactId, email, phone };
    return { kind: "contact", contact: { id: String(activity.contactId), name: String(name), role: contactRole as ContactTaskWork["contact"]["role"] },
      blocked: activity.purpose === "Prospecting" && contactRole !== "Realtor" && outreachSuppressed(blockedOutreachKeys(db, [identity]), identity),
      item: { ...activity, postFundingCheckIn: Boolean(postFundingCheckIn), latestCompletion: completion ? JSON.parse(String(completion)) : null } as ContactTaskWork["item"] };
  }
  if ((query.scope === "Team" && role !== "Admin") || (query.scope === "Available" && role !== "LO")) return { error: workspaceTasksUnavailable };
  const checked = query.after && query.checkedAt ? new Date(query.checkedAt) : now;
  if (checked.getTime() > now.getTime() || now.getTime() - checked.getTime() > 900_000) {
    return { error: "Refresh the task queue before loading another page." };
  }
  const { checkedAt, items, next } = readDeadlines(db, { email: staff.email, role }, checked, easternDate(checked), query.after, { tasks: query });
  return { kind: "list", checkedAt, items, next };
}

export function readCoverageDeadlines(db: Store, window: CoverageWindow, now: Date, after?: CalendarQuery["after"],
  target?: Pick<CoverageItem, "kind" | "id">) {
  return readDeadlines(db, { email: window.absentEmail, role: window.absentRole }, now, window.endsOn, after, { coverage: { target } });
}

function readDeadlines(db: Store, subject: { email: string; role: BrokerageRole }, now: Date, through: string, after: CalendarQuery["after"],
  { localName, calendar, coverage, tasks }: { localName?: string; calendar?: CalendarQuery; coverage?: { target?: Pick<CoverageItem, "kind" | "id"> };
    tasks?: WorkspaceTaskList }): CalendarPage {
  const checkedAt = now.toISOString();
  const today = easternDate(now);
  const throughInstant = easternDayStart(shiftReportDate(through, 1));
  const from = calendar?.day ?? calendar?.week;
  const fromInstant = from ? easternDayStart(from) : null;
  const processor = subject.role === "Processor";
  const team = calendar?.scope === "Team" || tasks?.scope === "Team";
  const completed = tasks?.view === "Completed";
  const policy = tasks && !completed ? readPlaybook(db) : undefined;
  const taskWindowEnd = tasks?.view === "Due in 24 hours" ? new Date(now.getTime() + 86_400_000) : undefined;
  const kinds: readonly Candidate["kind"][] | undefined = tasks ? workspaceTaskGroups[tasks.group] : coverage ? coverageKinds : calendar && calendarGroups[calendar.group];
  const replyDeadline = calendar ? "" : "AND thread.status <> 'Needs reply'";

  function select(kind: Candidate["kind"], query: string | ((loanJoin: "JOIN" | "CROSS JOIN") => string),
    id: string, due: string, ownerEmail: string, ownerName: string, dateOnly = false, whereParams: SqlValue[] = [], sparseSource?: string) {
    if (!calendar && kind === "appointment") return [];
    if (tasks && tasks.view !== "Open" && kind === "handoff") return [];
    if (kinds && !kinds.includes(kind)) return [];
    if (coverage?.target && kind !== coverage.target.kind) return [];
    if (processor && !(tasks && ["handoff", "application-review", "playbook-handoff"].includes(kind)) &&
      !["closing", "checklist", "conversation", "document", "document-review", "appointment", "review"].includes(kind)) return [];
    const sharedLead = (kind === "lead" || kind === "quiet-lead") && tasks?.scope === "Available";
    const owner = sharedLead ? `(${ownerEmail} = ? OR (${ownerEmail} IS NULL AND lead.realtorId IS NULL))` :
      kind === "quiet-lead" && tasks && subject.role === "Admin" ? `(${ownerEmail} = ? OR ${ownerEmail} IS NULL)` :
      localName ? `(${ownerEmail} = ? OR (${ownerEmail} IS NULL AND ${ownerName} = ?))` : `${ownerEmail} = ?`;
    let deadlineRange = `AND ${due} ${dateOnly ? "<=" : "<"} ? ${from ? `AND ${due} >= ?` : ""}`;
    let deadlineParams = [dateOnly ? through : throughInstant, ...(from ? [dateOnly ? from : fromInstant] : [])];
    if (tasks) {
      deadlineRange = tasks.view === "Open" ? "" : taskWindowEnd ? `AND ${due} >= ? AND ${due} <= ?` : `AND ${due} ${completed ? "<=" : "<"} ?`;
      deadlineParams = tasks.view === "Open" ? [] : taskWindowEnd ?
        [dateOnly ? today : checkedAt, dateOnly ? easternDate(taskWindowEnd) : taskWindowEnd.toISOString()] : [dateOnly ? today : checkedAt];
    }
    // Empty or sparse deadline indexes are cheaper to read before the loan join.
    // Dense queues retain the owner-first plan to avoid scanning other owners' work.
    let loanJoin: "JOIN" | "CROSS JOIN" = "JOIN";
    if (sparseSource && !team && !coverage?.target) {
      const count = Number(db.prepare(`SELECT count(*) AS count FROM (SELECT 1 FROM ${sparseSource} ${deadlineRange} LIMIT ?)`)
        .get(...deadlineParams, sparseDeadlineLimit + 1)?.count);
      if (count === 0) return [];
      if (count <= sparseDeadlineLimit) loanJoin = "CROSS JOIN";
    }
    let cursor = "";
    const cursorParams: SqlValue[] = [];
    if (after) {
      if (after.kind === kind) {
        cursor = `AND (${due}, ${id}) ${completed ? "<" : ">"} (?, ?)`;
        cursorParams.push(after.dueAt, after.id);
      } else {
        const instant = dueInstant(after.dueAt);
        const day = easternDate(new Date(instant));
        const sameDeadline = !dateOnly || easternDayStart(day) === instant;
        cursor = completed ? `AND ${due} ${kind < after.kind ? "<=" : "<"} ?` :
          `AND ${due} ${sameDeadline && kind > after.kind ? ">=" : ">"} ?`;
        cursorParams.push(dateOnly ? day : instant);
      }
    }
    const params: SqlValue[] = [...whereParams, ...(team ? [] : [subject.email, ...(localName ? [localName] : [])]), ...deadlineParams,
      ...(coverage?.target ? [coverage.target.id] : []),
      ...cursorParams, scanSize + 1];
    const rows = db.prepare(`SELECT ${ownerName} AS owner, ${typeof query === "string" ? query : query(loanJoin)} ${team ? "" : `AND ${owner}`}
      ${deadlineRange} ${coverage?.target ? `AND ${id} = ?` : ""} ${cursor}
      ORDER BY ${due} ${completed ? "DESC" : "ASC"}, ${id} ${completed ? "DESC" : "ASC"} LIMIT ?`).all(...params);
    return rows.map((row) => ({ ...row, kind })) as unknown as Candidate[];
  }

  const loanOwnerEmail = processor ? "processing.processorEmail" : "loan.officerEmail";
  const loanOwnerName = processor ? "processing.processorName" : "loan.officer";
  const processingJoin = processor ? "JOIN loan_processing processing ON processing.loanId = loan.id" : "";
  const conversationOwnerName = team ? "CASE thread.ownerRole WHEN 'Processor' THEN processing.processorName ELSE loan.officer END" : loanOwnerName;
  const appointmentOwnerName = team ? "CASE appointment.ownerRole WHEN 'Processor' THEN processing.processorName ELSE loan.officer END" : loanOwnerName;
  const reviewLoanScope = !team && subject.role !== "Admin";
  const reviewOwner = "CASE review.status WHEN 'Changes requested' THEN review.requesterEmail ELSE review.reviewerEmail END";
  const reviewOwnerName = "CASE review.status WHEN 'Changes requested' THEN review.requesterName ELSE review.reviewerName END";
  const dueConversation = "thread.status <> 'Closed' AND thread.dueOn IS NOT NULL";
  const openLoanTask = "task.completedAt IS NULL";
  const openClosingItem = "item.completedAt IS NULL";
  const dueDocument = "request.dueOn IS NOT NULL AND request.status IN ('Requested', 'Needs replacement')";
  const lenderAlertTitle = "CASE alert.kind WHEN 'Reopened condition' THEN 'Reopened · ' || alert.message ELSE alert.message END";
  const openLeadDocument = "lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND lead.officerEmail IS NOT NULL";
  const showSequences = !calendar && !tasks && !coverage;
  const currentSequenceStep = "json_extract(template.steps, '$[' || run.position || ']')";
  const sequenceChannelBit = `CASE json_extract(${currentSequenceStep}, '$.channel')
    WHEN 'Call' THEN ${borrowerChannelBits.Call} WHEN 'Email' THEN ${borrowerChannelBits.Email} WHEN 'Text' THEN ${borrowerChannelBits.Text} END`;
  const currentSequenceId = "(run.leadId || ':' || run.version || ':' || run.position)";
  // Returning audiences have their own cadence. New Lead only replaces a duplicate first call.
  const sequenceFirstCall = showSequences ? `AND NOT EXISTS (SELECT 1 FROM campaign_sequence_enrollments run
    JOIN campaign_sequence_versions template ON template.version = run.version
    WHERE run.leadId = lead.id AND (template.kind <> 'New Lead' OR
      ((run.dueAt <= lead.dueAt OR (run.dueAt IS NOT NULL AND ${leadBorrowerHoursSql} IS NOT NULL))
        AND json_extract(${currentSequenceStep}, '$.channel') = 'Call')))` : "";
  const receivedDocumentAt = "coalesce(request.submittedAt, request.requestedAt)";
  const fundingTask = `(task.id GLOB '${fundingTaskPrefix}borrower:*' OR task.id GLOB '${fundingTaskPrefix}realtor:*')`;
  const lastOutreach = `coalesce((SELECT event.at FROM lead_events event WHERE event.leadId = lead.id AND event.outcome IS NOT NULL
    ORDER BY event.at DESC, event.rowid DESC LIMIT 1), follow.firstContactAt)`;
  const quietDue = `coalesce(${addSqlHours(lastOutreach, policy?.quietHours ?? 0)}, lead.dueAt)`;
  const quietReady = `coalesce(follow.status, '') NOT IN ('Paused', 'Stopped') AND follow.replyReceivedAt IS NULL
    AND NOT EXISTS (SELECT 1 FROM campaign_sequence_enrollments sequence JOIN campaign_sequence_versions template ON template.version = sequence.version
      WHERE sequence.leadId = lead.id AND sequence.dueAt IS NOT NULL AND template.kind <> 'New Lead')
    AND NOT EXISTS (SELECT 1 FROM lead_events event WHERE event.leadId = lead.id AND event.outcome IN ('Connected', 'Reply received'))
    AND NOT EXISTS (SELECT 1 FROM lead_import_tasks callback WHERE callback.id = member.callbackTaskId AND callback.completedAt IS NULL)
    AND NOT EXISTS (SELECT 1 FROM campaign_follow_up_runs run WHERE run.leadId = lead.id AND run.campaignId = member.campaignId
      AND run.callNumber = member.attempts AND run.outcome = member.lastOutcome AND run.status IN ('Failed', 'Paused'))
    AND ${quietDue} <= ?`;
  const firstReview = "(app.submittedAt IS NOT NULL AND app.reviewedAt IS NULL)";
  const reviewDue = addSqlHours("app.submittedAt", policy?.reviewHours ?? 0);
  const acceptHandoff = "coalesce(handoff.status = 'Ready for processing' AND handoff.processorEmail IS NOT NULL AND coalesce(app.correctionNote, '') = '', 0)";
  const prepareHandoff = "(app.reviewedAt IS NOT NULL AND (handoff.processorEmail IS NULL OR handoff.status IN ('Assigned', 'Returned to LO')))";
  const approvalBlocked = policy?.requireSecondReview ?
    `(coalesce(handoff.status IN ('Assigned', 'Ready for processing'), 0) AND (app.submittedAt IS NULL OR app.reviewedAt IS NULL OR NOT ${approvedSecondReview}))` : "0";
  const handoffDue = addSqlHours(`CASE WHEN ${acceptHandoff} OR handoff.status = 'Returned to LO' THEN handoff.updatedAt ELSE app.reviewedAt END`,
    policy?.handoffHours ?? 0);
  const actionableHandoff = processor ? acceptHandoff : subject.role === "Admin" ? `(${acceptHandoff} OR ${prepareHandoff})` :
    `(NOT ${acceptHandoff} AND ${prepareHandoff})`;
  const completedWork = completed ? [
    ...(["loan", "funding"] as const).flatMap((kind) => select(kind, (join) => `task.id, loan.id AS recordId, contact.id AS contactId, contact.name,
      task.completedAt AS dueAt, contact.email, contact.phone, task.title, task.purpose
      FROM tasks task ${join} loans loan ON loan.id = task.loanId JOIN contacts contact ON contact.id = loan.contactId
      WHERE task.completedAt IS NOT NULL AND ${kind === "loan" ? `NOT ${fundingTask}` : fundingTask}`,
    "task.id", "task.completedAt", "loan.officerEmail", "loan.officer", false, [], "tasks task WHERE task.completedAt IS NOT NULL")),
    ...select("lead-task", `task.id, lead.id AS recordId, lead.name, task.title, task.completedAt AS dueAt
      FROM lead_import_tasks task JOIN referral_leads lead ON lead.id = task.leadId
      WHERE lead.resolvedAt IS NULL AND task.completedAt IS NOT NULL`,
    "task.id", "task.completedAt", "lead.officerEmail", "lead.officer"),
    ...select("contact", `task.id, contact.id AS recordId, contact.id AS contactId, contact.name, task.completedAt AS dueAt,
      contact.email, contact.phone, task.purpose,
      CASE WHEN task.outcome = 'Requested callback' THEN 'Borrower callback' ELSE 'Contact follow-up' END AS title
      FROM contact_activity task JOIN contacts contact ON contact.id = task.contactId
      WHERE task.completedAt IS NOT NULL AND task.dueAt IS NOT NULL`,
    "task.id", "task.completedAt", "task.followUpOwnerEmail", "task.followUpOwner"),
    ...select("checklist", `item.id, loan.id AS recordId, contact.name, item.completedAt AS dueAt, item.title
      FROM closing_items item JOIN loans loan ON loan.id = item.loanId JOIN contacts contact ON contact.id = loan.contactId
      ${processingJoin} WHERE item.completedAt IS NOT NULL`,
    "item.id", "item.completedAt", loanOwnerEmail, loanOwnerName),
    ...select("uwm-alert", `alert.id, loan.id AS recordId, contact.name, alert.reviewedAt AS dueAt, ${lenderAlertTitle} AS title
      FROM uwm_alerts alert JOIN loans loan ON loan.id = alert.loanId JOIN contacts contact ON contact.id = loan.contactId
      WHERE alert.reviewedAt IS NOT NULL`, "alert.id", "alert.reviewedAt", "loan.officerEmail", "loan.officer"),
  ] : [];
  const candidates = (completed ? completedWork : [
    ...(showSequences ? select("sequence", `${currentSequenceId} AS id, lead.id AS recordId, lead.id AS leadId, lead.name, run.dueAt,
      lead.email, lead.phone, lead.importedContactId AS contactId, member.campaignId, 'Prospecting' AS purpose,
      template.kind || ' · ' || json_extract(${currentSequenceStep}, '$.title') AS title, ${currentSequenceStep} AS sequenceStep,
      ${leadBorrowerHoursSql} AS sequenceHours,
      run.version AS sequenceVersion, run.position AS sequencePosition
      FROM campaign_sequence_enrollments run JOIN referral_leads lead ON lead.id = run.leadId
      JOIN call_campaign_members member ON member.leadId = lead.id JOIN campaign_sequence_versions template ON template.version = run.version
      LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
      WHERE run.dueAt IS NOT NULL AND run.outcome IS NULL AND lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND follow.replyReceivedAt IS NULL
        AND (${leadChannelBlocksSql} & (${sequenceChannelBit})) = 0`,
    currentSequenceId, "run.dueAt", "lead.officerEmail", "lead.officer") : []),
    ...(policy ? [
      ...select("lead-hold", `lead.id, lead.id AS recordId, lead.name, (lead.revisitDate || 'T17:00:00.000Z') AS dueAt,
        'Review lead on hold' AS title, lead.holdReason AS reason FROM referral_leads lead
        WHERE lead.resolvedAt IS NULL AND lead.heldAt IS NOT NULL AND lead.revisitDate IS NOT NULL`,
      "lead.id", "(lead.revisitDate || 'T17:00:00.000Z')", "lead.officerEmail", "lead.officer"),
      ...select("loan-hold", `loan.id, loan.id AS recordId, contact.name, (loan.revisitDate || 'T17:00:00.000Z') AS dueAt,
        'Review loan on hold' AS title, loan.dispositionReason AS reason FROM loans loan JOIN contacts contact ON contact.id = loan.contactId
        WHERE loan.disposition = 'On hold' AND loan.revisitDate IS NOT NULL`,
      "loan.id", "(loan.revisitDate || 'T17:00:00.000Z')", "loan.officerEmail", "loan.officer"),
      ...select("funding", (join) => `task.id, loan.id AS recordId, contact.id AS contactId, contact.name, task.dueAt,
        contact.email, contact.phone, task.title, task.purpose, 'Actual funding recorded' AS reason
        FROM tasks task ${join} loans loan ON loan.id = task.loanId JOIN contacts contact ON contact.id = loan.contactId
        WHERE loan.disposition = 'Active' AND ${openLoanTask} AND ${fundingTask}`,
      "task.id", "task.dueAt", "loan.officerEmail", "loan.officer", false, [], `tasks task WHERE ${openLoanTask} AND ${fundingTask}`),
      ...select("quiet-lead", `lead.id, lead.id AS recordId, lead.id AS leadId, lead.name, ${quietDue} AS dueAt,
        lead.email, lead.phone, lead.importedContactId AS contactId, member.campaignId,
        coalesce(member.lastOutcome = 'Opted out', 0) AS optedOut, 'Escalate quiet lead' AS title, 'Prospecting' AS purpose,
        CASE WHEN ${lastOutreach} IS NULL THEN 'First contact has not been logged' ELSE 'No reply logged after the last outreach' END AS reason
        FROM referral_leads lead LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
        LEFT JOIN call_campaign_members member ON member.leadId = lead.id
        WHERE lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND ${quietReady} ${sequenceFirstCall}`,
      "lead.id", quietDue, "lead.officerEmail", "lead.officer", false, [checkedAt]),
      ...select("application-review", `loan.id, loan.id AS recordId, contact.name, ${reviewDue} AS dueAt,
        CASE WHEN EXISTS (SELECT 1 FROM application_versions version WHERE version.loanId = app.loanId AND version.revision < app.revision)
          THEN 'Review corrected 1003' ELSE 'Review submitted 1003' END AS title
        FROM applications app JOIN loans loan ON loan.id = app.loanId JOIN contacts contact ON contact.id = loan.contactId
        ${processingJoin} WHERE loan.disposition = 'Active' AND ${firstReview}`,
      "loan.id", reviewDue, loanOwnerEmail, loanOwnerName),
      ...select("playbook-handoff", `loan.id, loan.id AS recordId, contact.name, ${handoffDue} AS dueAt,
        CASE WHEN ${acceptHandoff} THEN 'Accept processing handoff'
          WHEN handoff.status = 'Returned to LO' THEN 'Review returned processing handoff'
          WHEN handoff.processorEmail IS NULL THEN 'Assign a processor'
          ELSE 'Prepare processing handoff' END AS title
        FROM loans loan JOIN contacts contact ON contact.id = loan.contactId LEFT JOIN applications app ON app.loanId = loan.id
        LEFT JOIN loan_processing handoff ON handoff.loanId = loan.id
        WHERE ${dueForLoan} AND NOT ${firstReview} AND NOT ${approvalBlocked} AND ${actionableHandoff}`,
      "loan.id", handoffDue,
      `CASE WHEN ${acceptHandoff} THEN handoff.processorEmail ELSE loan.officerEmail END`,
      `CASE WHEN ${acceptHandoff} THEN handoff.processorName ELSE loan.officer END`),
    ] : []),
    ...select("lead", `lead.id, lead.id AS recordId, lead.id AS leadId, lead.name, lead.dueAt, lead.email, lead.phone,
      lead.importedContactId AS contactId, member.campaignId, coalesce(member.lastOutcome = 'Opted out', 0) AS optedOut,
      'First contact' AS title, 'Prospecting' AS purpose
      FROM referral_leads lead LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
      LEFT JOIN call_campaign_members member ON member.leadId = lead.id
      WHERE lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND follow.firstContactAt IS NULL AND follow.replyReceivedAt IS NULL
      AND (member.leadId IS NULL OR (${leadChannelBlocksSql} & ${borrowerChannelBits.Call}) = 0)
      ${policy ? `AND NOT (${quietReady})` : ""} ${sequenceFirstCall}`,
    "lead.id", "lead.dueAt", "lead.officerEmail", "lead.officer", false, policy ? [checkedAt] : []),
    ...select("campaign", `task.id, lead.id AS recordId, lead.id AS leadId, lead.name, task.dueAt, lead.email, lead.phone,
      lead.importedContactId AS contactId, member.campaignId,
      CASE member.lastOutcome WHEN 'Requested callback' THEN 'Campaign callback' ELSE 'Campaign call retry' END AS title, task.purpose
      ${campaignCallbackSource()} WHERE ${openCampaignCallback}`,
    "task.id", "task.dueAt", "lead.officerEmail", "lead.officer"),
    ...select("lead-task", `task.id, lead.id AS recordId, lead.id AS leadId, lead.name, task.dueAt, lead.email, lead.phone,
      lead.importedContactId AS contactId, task.title, task.purpose,
      CASE WHEN task.purpose = 'Prospecting' THEN coalesce(member.lastOutcome = 'Opted out', 0) ELSE 0 END AS optedOut
      FROM referral_leads lead JOIN lead_import_tasks task ON task.leadId = lead.id
      LEFT JOIN call_campaign_members member ON member.leadId = lead.id
      WHERE lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND task.completedAt IS NULL
        AND (member.callbackTaskId IS NULL OR member.callbackTaskId <> task.id)`,
    "task.id", "task.dueAt", "lead.officerEmail", "lead.officer"),
    ...select("contact", `task.id, contact.id AS recordId, contact.id AS contactId, contact.name, task.dueAt, contact.email, contact.phone,
      CASE WHEN task.outcome = 'Requested callback' THEN 'Borrower callback' ELSE 'Contact follow-up' END AS title, task.purpose
      FROM contact_activity task JOIN contacts contact ON contact.id = task.contactId
      WHERE task.completedAt IS NULL AND task.dueAt IS NOT NULL ${coverage ? "AND task.outcome = 'Requested callback'" : ""}`,
    "task.id", "task.dueAt", "task.followUpOwnerEmail", "task.followUpOwner"),
    ...select("conversation", (join) => `thread.id, thread.id AS recordId, contact.name, thread.dueOn AS dueAt,
      thread.audience || ' conversation follow-up' AS title,
      CASE WHEN thread.sourceLeadId IS NOT NULL THEN 'Prospecting' END AS purpose,
      thread.sourceLeadId AS leadId, contact.id AS contactId, contact.email, contact.phone
      FROM loan_conversations thread ${join} loans loan ON loan.id = thread.loanId JOIN contacts contact ON contact.id = thread.contactId
      ${team ? "LEFT JOIN loan_processing processing ON processing.loanId = loan.id" : processingJoin}
      WHERE loan.disposition = 'Active' ${team ? "" : `AND thread.ownerRole = '${processor ? "Processor" : "Loan officer"}'`}
      AND ${dueConversation} AND ${currentConversationContact} ${replyDeadline}`,
    "thread.id", "thread.dueOn", loanOwnerEmail, conversationOwnerName, true, [],
    `loan_conversations thread WHERE ${dueConversation}`),
    ...(!processor ? select("conversation", `thread.id, thread.id AS recordId, lead.name, thread.dueOn AS dueAt,
      'Lead conversation follow-up' AS title, 'Prospecting' AS purpose, lead.id AS leadId, lead.importedContactId AS contactId,
      lead.email, lead.phone, coalesce(member.lastOutcome = 'Opted out', 0) AS optedOut
      FROM lead_conversations thread JOIN referral_leads lead ON lead.id = thread.leadId
      LEFT JOIN call_campaign_members member ON member.leadId = lead.id
      WHERE lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND thread.status <> 'Closed' AND thread.dueOn IS NOT NULL ${replyDeadline}`,
    "thread.id", "thread.dueOn", "lead.officerEmail", "lead.officer", true) : []),
    ...(!processor ? select("conversation", `thread.id, thread.id AS recordId, contact.name, thread.dueOn AS dueAt,
      CASE contact.role WHEN 'Realtor' THEN 'Realtor conversation follow-up' ELSE 'Contact conversation follow-up' END AS title,
      CASE WHEN contact.role <> 'Realtor' THEN 'Prospecting' END AS purpose, contact.id AS contactId, contact.email, contact.phone
      FROM contact_conversations thread JOIN contacts contact ON contact.id = thread.contactId
      WHERE thread.status <> 'Closed' AND thread.dueOn IS NOT NULL ${replyDeadline}`,
    "thread.id", "thread.dueOn", "thread.ownerEmail", "thread.ownerName", true) : []),
    ...select("loan", (join) => `task.id, loan.id AS recordId, contact.id AS contactId, contact.name, task.dueAt, contact.email, contact.phone,
      task.title, task.purpose FROM tasks task ${join} loans loan ON loan.id = task.loanId JOIN contacts contact ON contact.id = loan.contactId
      WHERE loan.disposition = 'Active' AND ${openLoanTask} ${policy ? `AND NOT ${fundingTask}
        AND NOT ((task.id GLOB 'application-follow-up:*' OR task.id GLOB 'application-correction:*') AND
          EXISTS (SELECT 1 FROM applications app WHERE app.loanId = loan.id AND ${firstReview}))` : ""}`,
    "task.id", "task.dueAt", "loan.officerEmail", "loan.officer", false, [], `tasks task WHERE ${openLoanTask}`),
    ...select("handoff", `loan.id, loan.id AS recordId, contact.name, handoff.updatedAt AS dueAt,
      CASE handoff.status WHEN 'Returned to LO' THEN 'Returned from processing' ELSE handoff.status END AS title
      FROM loans loan JOIN loan_processing handoff ON handoff.loanId = loan.id JOIN contacts contact ON contact.id = loan.contactId
      ${policy ? "LEFT JOIN applications app ON app.loanId = loan.id" : ""}
      WHERE ${dueForLoan} AND ${tasks && (processor || subject.role === "Admin") ?
        `handoff.status IN ('Ready for processing', 'In processing'${processor ? "" : ", 'Returned to LO'"})` : "handoff.status = 'Returned to LO'"}
      ${policy ? `AND NOT ${firstReview} AND NOT ${approvalBlocked}
        AND NOT (handoff.status = 'Ready for processing' AND coalesce(app.correctionNote, '') <> '')
        AND NOT (${actionableHandoff} AND ${team || processor ? "1" : `NOT ${acceptHandoff}`})` : ""}
      AND handoff.updatedAt <= ?`, "loan.id", "handoff.updatedAt", processor ? "handoff.processorEmail" : "loan.officerEmail",
    processor ? "handoff.processorName" : "loan.officer", false, [checkedAt]),
    ...select("closing", `loan.id, loan.id AS recordId, contact.name, plan.targetDate AS dueAt, 'Target closing' AS title
      FROM loans loan JOIN closing_plans plan ON plan.loanId = loan.id JOIN contacts contact ON contact.id = loan.contactId
      ${processingJoin}
      LEFT JOIN past_client_profiles profile ON profile.loanId = loan.id WHERE ${dueForLoan} AND profile.closingDate IS NULL`,
    "loan.id", "plan.targetDate", loanOwnerEmail, loanOwnerName, true),
    ...select("checklist", (join) => `item.id, loan.id AS recordId, contact.name, item.dueDate AS dueAt, item.title
      FROM closing_items item ${join} loans loan ON loan.id = item.loanId JOIN contacts contact ON contact.id = loan.contactId
      ${processingJoin} WHERE ${dueForLoan} AND ${openClosingItem}`,
    "item.id", "item.dueDate", loanOwnerEmail, loanOwnerName, true, [], `closing_items item WHERE ${openClosingItem}`),
    ...select("document", (join) => `request.id, loan.id AS recordId, contact.name, request.dueOn AS dueAt,
      CASE request.status WHEN 'Needs replacement' THEN 'Replacement ' || lower(request.kind) || ' due' ELSE request.kind || ' due' END ||
        CASE WHEN request.recipient = 'Co-borrower' THEN ' · Co-borrower' ELSE '' END AS title
      FROM document_requests request ${join} loans loan ON loan.id = request.loanId JOIN contacts contact ON contact.id = loan.contactId
      ${processingJoin} WHERE loan.disposition = 'Active' AND ${dueDocument}`,
    "request.id", "request.dueOn", loanOwnerEmail, loanOwnerName, true, [],
    `document_requests request WHERE ${dueDocument}`),
    ...select("lead-document", `request.id, lead.id AS recordId, lead.name, request.dueOn AS dueAt,
      CASE request.status WHEN 'Needs replacement' THEN 'Replacement ' || lower(request.kind) || ' due' ELSE request.kind || ' due' END AS title
      FROM lead_document_requests request JOIN referral_leads lead ON lead.id = request.leadId WHERE ${openLeadDocument} AND ${dueDocument}`,
    "request.id", "request.dueOn", "lead.officerEmail", "lead.officer", true),
    ...(tasks?.view === "Open" ? select("lead-document-review", `request.id, lead.id AS recordId, lead.name,
      ${receivedDocumentAt} AS dueAt, 'Review ' || lower(request.kind) AS title
      FROM lead_document_requests request JOIN referral_leads lead ON lead.id = request.leadId WHERE ${openLeadDocument} AND request.status = 'Received'`,
    "request.id", receivedDocumentAt, "lead.officerEmail", "lead.officer") : []),
    ...(tasks?.view === "Open" ? select("document-review", (join) => `request.id, loan.id AS recordId, contact.name,
      coalesce(request.submittedAt, request.requestedAt) AS dueAt, 'Review ' || lower(request.kind) ||
        CASE WHEN request.recipient = 'Co-borrower' THEN ' · Co-borrower' ELSE '' END AS title
      FROM document_requests request ${join} loans loan ON loan.id = request.loanId JOIN contacts contact ON contact.id = loan.contactId
      ${processingJoin} WHERE loan.disposition = 'Active' AND request.status = 'Received'`,
    "request.id", "coalesce(request.submittedAt, request.requestedAt)", loanOwnerEmail, loanOwnerName, false, [],
    "document_requests request WHERE request.status = 'Received'") : []),
    ...(tasks?.view === "Open" ? select("uwm-alert", (join) => `alert.id, loan.id AS recordId, contact.name, alert.detectedAt AS dueAt, ${lenderAlertTitle} AS title
      FROM uwm_alerts alert ${join} loans loan ON loan.id = alert.loanId JOIN contacts contact ON contact.id = loan.contactId
      WHERE loan.disposition = 'Active' AND alert.reviewedAt IS NULL`,
    "alert.id", "alert.detectedAt", "loan.officerEmail", "loan.officer", false, [],
    "uwm_alerts alert WHERE alert.reviewedAt IS NULL") : []),
    ...select("appointment", `appointment.id, loan.id AS recordId, contact.name, appointment.startsAt AS dueAt, appointment.title
      FROM loan_appointments appointment JOIN loans loan ON loan.id = appointment.loanId JOIN contacts contact ON contact.id = loan.contactId
      ${team ? "LEFT JOIN loan_processing processing ON processing.loanId = loan.id" : processingJoin}
      WHERE loan.disposition = 'Active' AND appointment.cancelledAt IS NULL
      ${team ? "" : `AND appointment.ownerRole = '${processor ? "Processor" : "Loan officer"}'`}`,
    "appointment.id", "appointment.startsAt", loanOwnerEmail, appointmentOwnerName),
    ...select("review", `review.id, loan.id AS recordId, contact.name, review.dueOn AS dueAt,
      CASE review.status WHEN 'Changes requested' THEN 'Respond to review · ' ELSE 'Internal review · ' END || review.title AS title
      FROM loan_reviews review JOIN loans loan ON loan.id = review.loanId JOIN contacts contact ON contact.id = loan.contactId
      ${processingJoin} WHERE loan.disposition = 'Active' AND review.status IN ('Requested', 'Changes requested')
      ${reviewLoanScope ? `AND ${loanOwnerEmail} = ?` : ""}
      ${team ? "" : "AND (review.status = 'Changes requested' OR review.reviewerRole = ?)"}`,
    "review.id", "review.dueOn", reviewOwner, reviewOwnerName, true, [...(reviewLoanScope ? [subject.email] : []), ...(team ? [] : [subject.role])]),
    ...select("lock", `loan.id, loan.id AS recordId, contact.name, rate.lockExpiresAt AS dueAt, 'Mock rate lock expires' AS title
      FROM loans loan JOIN mock_uwm_rates rate ON rate.loanId = loan.id JOIN contacts contact ON contact.id = loan.contactId
      WHERE ${dueForLoan} AND rate.lockCancelledAt IS NULL AND rate.lockExpiresAt > ?`,
    "loan.id", "rate.lockExpiresAt", "loan.officerEmail", "loan.officer", false, [checkedAt]),
  ]).map((row) => ({ ...row, instant: dueInstant(row.dueAt) }))
    .sort((a, b) => {
      const order = compare(a.instant, b.instant) || compare(a.kind, b.kind) || compare(a.id, b.id);
      return completed ? -order : order;
    });

  const scan = candidates.slice(0, scanSize);
  const suppression = blockedOutreachKeys(db, scan.filter((item) => item.purpose === "Prospecting"));
  const handoffHours = scan.some((item) => item.kind === "handoff") ? readPlaybook(db).handoffHours : undefined;
  const items: CalendarItem[] = [];
  let consumed = 0;
  for (const row of scan) {
    consumed++;
    const dateOnly = row.dueAt.length === 10;
    const blocked = !!row.optedOut || (row.purpose === "Prospecting" && outreachSuppressed(suppression, row));
    if (blocked && !completed) continue;
    const { kind, id, recordId, name, title, dueAt, campaignId, owner, reason } = row;
    const step = row.sequenceStep ? sequenceStep.parse(JSON.parse(row.sequenceStep)) : undefined;
    const available = step && row.sequenceHours && dueAt <= checkedAt ? nextBorrowerContactTime(checkedAt, storedBorrowerHours(row.sequenceHours)) : checkedAt;
    const sequence = step && row.sequenceVersion !== undefined && row.sequencePosition !== undefined ? {
      ...step, version: row.sequenceVersion, position: row.sequencePosition,
      ...(available > checkedAt ? { waitUntil: available } : {}),
      recipient: step.channel === "Call" ? null : campaignFollowUpRecipient(step.channel, { email: row.email ?? "", phone: row.phone ?? "" }) || null,
    } : undefined;
    const target = kind === "handoff" || kind === "playbook-handoff" ? "processing-handoff" : kind === "review" ? reviewTarget(id) :
      kind === "application-review" ? "loan-application" :
      kind === "appointment" ? appointmentTarget(id) : kind === "document" || kind === "document-review" ? `document-${id}` :
      kind === "loan" || kind === "funding" ? loanTaskTarget(id, processor || completed) : kind === "loan-hold" ? "loan-workflow" :
      kind === "checklist" && (calendar || tasks) ? closingChecklistTarget(id) :
      kind === "closing" || kind === "checklist" ? "closing-workbench" : undefined;
    // Use the return time for visibility and paging, and the playbook deadline for urgency.
    const handoffDueAt = kind === "handoff" && title === "Returned from processing" && handoffHours !== undefined ? afterHours(dueAt, handoffHours) : undefined;
    items.push({ kind, id, recordId, name, title, dueAt, owner: owner || "Unassigned", ...(campaignId ? { campaignId } : {}), ...(target ? { target } : {}),
      ...(handoffDueAt ? { handoffDueAt } : {}), ...(reason ? { reason } : {}), ...(sequence ? { sequence } : {}),
      ...(completed ? { completedAt: dueAt, blocked } : {}),
      overdue: !completed && !["appointment", "document-review", "lead-document-review", "uwm-alert"].includes(kind) && (kind !== "handoff" || !!handoffDueAt) &&
        (dateOnly ? dueAt < today : Date.parse(handoffDueAt ?? dueAt) < now.getTime()) });
    if (items.length === pageSize) break;
  }
  const last = candidates[consumed - 1];
  return { checkedAt, through, items, next: last && consumed < candidates.length ? { kind: last.kind, dueAt: last.dueAt, id: last.id } : null };
}
