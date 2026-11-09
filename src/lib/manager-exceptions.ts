import { approvedSecondReview } from "./application-review-checkpoint";
import type { BrokerageMember } from "./brokerage-model";
import { managerExceptionInput, managerExceptions, managerExceptionsUnavailable, type ManagerExceptionFilters, type ManagerExceptionPage,
  type ManagerExceptionSettings } from "./manager-exception-model";
import { playbookWork, type PlaybookFacts } from "./playbook-model";
import { readPlaybook } from "./playbooks";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";

const limit = 20;
const leadSource = "coalesce(lead.importSource, CASE WHEN lead.realtorId IS NULL THEN 'Website quote request' ELSE 'Realtor referral' END)";
const read = <T>(db: Store, sql: string, ...params: SqlValue[]) =>
  db.prepare(sql).all(...params).map((row) => ({ ...row })) as T[];

function leadFacts(db: Store, filters: ManagerExceptionFilters, officers: string, now: string, quietCutoff: string) {
  type Lead = PlaybookFacts["inboxLeads"][number];
  type Member = PlaybookFacts["callCampaignMembers"][number];
  type Raw = Omit<Lead, "outreachSuppressed" | "followUp" | "importedTasks"> &
    Pick<Lead["followUp"], "firstContactAt" | "replyReceivedAt" | "status"> & Pick<Member, "lastOutcome" | "callbackTaskId" | "callbackDueAt" | "followUpRunStatus"> & {
      email: string; phone: string; contactId: string | null; runId: string | null; runDueAt: string | null;
      latestAt: string | null; connectedAt: string | null; serviceDueAt: string | null; prospectingDueAt: string | null;
    };
  const leadRows = read<Raw>(db, `WITH roster AS (SELECT value FROM json_each(?)), candidates AS (
    SELECT lead.id, lead.name, lead.officer, lead.officerEmail, lead.dueAt, lead.heldAt, lead.revisitDate, lead.email, lead.phone,
      lead.importedContactId AS contactId, ${leadSource} AS source, member.campaignId, member.lastOutcome, member.callbackTaskId,
      callback.dueAt AS callbackDueAt, run.status AS followUpRunStatus, run.id AS runId, run.dueAt AS runDueAt,
      follow.firstContactAt, follow.replyReceivedAt, coalesce(follow.status, 'Not started') AS status,
      (SELECT at FROM lead_events WHERE leadId = lead.id AND outcome IS NOT NULL ORDER BY at DESC, rowid DESC LIMIT 1) AS latestAt
    FROM referral_leads lead
    LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
    LEFT JOIN call_campaign_members member ON member.leadId = lead.id
    LEFT JOIN lead_import_tasks callback ON callback.id = member.callbackTaskId AND callback.completedAt IS NULL
    LEFT JOIN campaign_follow_up_runs run ON run.leadId = lead.id AND run.campaignId = member.campaignId AND run.callNumber = member.attempts
      AND run.outcome = member.lastOutcome AND run.status IN ('Failed', 'Paused')
    WHERE lead.resolvedAt IS NULL
      ${filters.source ? `AND ${leadSource} = ?` : ""}
      ${filters.campaign === "none" ? "AND member.campaignId IS NULL" : filters.campaign ? "AND member.campaignId = ?" : ""}
      ${filters.type === "Campaign recovery" ? "AND run.id IS NOT NULL" : ""}
  )
  SELECT candidate.*,
    (SELECT max(at) FROM lead_events WHERE leadId = candidate.id AND outcome IN ('Connected', 'Reply received')) AS connectedAt,
    (SELECT min(dueAt) FROM lead_import_tasks WHERE leadId = candidate.id AND completedAt IS NULL AND purpose <> 'Prospecting') AS serviceDueAt,
    (SELECT min(dueAt) FROM lead_import_tasks WHERE leadId = candidate.id AND completedAt IS NULL AND purpose = 'Prospecting') AS prospectingDueAt
  FROM candidates candidate
  WHERE candidate.officerEmail IS NULL OR candidate.officerEmail NOT IN (SELECT value FROM roster)
    OR candidate.runId IS NOT NULL OR julianday(candidate.callbackDueAt) <= julianday(?)
    OR julianday(candidate.dueAt) <= julianday(?) OR julianday(coalesce(candidate.latestAt, candidate.firstContactAt)) <= julianday(?)`,
  officers, ...(filters.source ? [filters.source] : []), ...(filters.campaign && filters.campaign !== "none" ? [filters.campaign] : []),
  now, now, quietCutoff);
  const identity = (row: Raw) => ({ email: row.email, phone: row.phone, contactId: row.contactId, leadId: row.id });
  const suppressed = blockedOutreachKeys(db, leadRows.map(identity));
  const inboxLeads: PlaybookFacts["inboxLeads"] = [];
  const callCampaignMembers: PlaybookFacts["callCampaignMembers"] = [];
  for (const row of leadRows) {
    const { id, name, officer, officerEmail, dueAt, heldAt, revisitDate, campaignId, source, latestAt, connectedAt, firstContactAt, replyReceivedAt,
      status, serviceDueAt, prospectingDueAt, lastOutcome, callbackTaskId, callbackDueAt, followUpRunStatus, runId, runDueAt } = row;
    const blocked = lastOutcome === "Opted out" || outreachSuppressed(suppressed, identity(row));
    inboxLeads.push({ id, name, officer, officerEmail, dueAt, heldAt, revisitDate, campaignId, source, outreachSuppressed: blocked,
      followUp: { firstContactAt, replyReceivedAt, status, latestOutreach: latestAt, contacted: Boolean(connectedAt) },
      importedTasks: [
        ...(serviceDueAt ? [{ dueAt: serviceDueAt, purpose: "Loan service" as const, completedAt: null }] : []),
        ...(prospectingDueAt ? [{ dueAt: prospectingDueAt, purpose: "Prospecting" as const, completedAt: null }] : []),
      ],
    });
    if (campaignId) callCampaignMembers.push({ campaignId, leadId: id, resolvedAt: null, lastOutcome, callbackTaskId, callbackDueAt,
      followUpRunStatus, ...(runId && runDueAt ? { followUpRun: { id: runId, dueAt: runDueAt } } : {}), outreachSuppressed: blocked });
  }
  return { inboxLeads, callCampaignMembers };
}

function loanFacts(db: Store, officers: string, processors: string) {
  type Loan = PlaybookFacts["loans"][number];
  type Application = PlaybookFacts["applications"][number];
  type Processing = PlaybookFacts["loanProcessing"][number];
  type Raw = Loan & Pick<Application, "submittedAt" | "reviewedAt" | "correctionNote"> & Omit<Processing, "loanId"> & {
    appId: string | null; approved: number; corrected: number; processingId: string | null; name: string; role: string; email: string; phone: string;
  };
  const selected = read<Raw>(db, `WITH officers AS (SELECT value FROM json_each(?)), processors AS (SELECT value FROM json_each(?))
    SELECT loan.id, loan.contactId, loan.stage, loan.disposition, loan.officer, loan.officerEmail, loan.revisitDate,
      app.loanId AS appId, app.submittedAt, app.reviewedAt, app.correctionNote,
      EXISTS (SELECT 1 FROM application_versions WHERE loanId = loan.id AND revision < app.revision) AS corrected,
      ${approvedSecondReview} AS approved,
      processing.loanId AS processingId, processing.processorEmail, processing.processorName, processing.status, processing.updatedAt, processing.revision,
      contact.name, contact.role, contact.email, contact.phone
    FROM loans loan JOIN contacts contact ON contact.id = loan.contactId
    LEFT JOIN applications app ON app.loanId = loan.id LEFT JOIN loan_processing processing ON processing.loanId = loan.id
    WHERE loan.disposition IN ('Active', 'On hold') AND (
      (loan.disposition = 'Active' AND app.submittedAt IS NOT NULL AND app.reviewedAt IS NULL)
      OR (loan.disposition = 'Active' AND EXISTS (
        SELECT 1 FROM tasks WHERE loanId = loan.id AND completedAt IS NULL AND id GLOB 'post-funding:*'))
      OR (loan.stage NOT IN ('Funded', 'Closed') AND (
        loan.officerEmail NOT IN (SELECT value FROM officers)
        OR processing.processorEmail NOT IN (SELECT value FROM processors)
        OR (loan.disposition = 'Active' AND (processing.status = 'Ready for processing' OR
          (app.reviewedAt IS NOT NULL AND (processing.processorEmail IS NULL OR processing.status IN ('Assigned', 'Returned to LO')))))
      ))
    )`, officers, processors);
  const keys = JSON.stringify(selected.map(({ id }) => id));
  const tasks = selected.length ? read<PlaybookFacts["tasks"][number]>(db, `SELECT task.id, task.loanId, task.title, task.dueAt, task.completedAt, task.purpose
    FROM json_each(?) selected JOIN tasks task ON task.loanId = selected.value JOIN loans loan ON loan.id = task.loanId
    WHERE task.completedAt IS NULL AND (task.id GLOB 'post-funding:*' OR loan.officerEmail NOT IN (SELECT value FROM json_each(?)))`,
  keys, officers) : [];
  return { selected, tasks };
}

export function readManagerExceptionWork(db: Store, input: unknown, staff: WorkspaceStaff | null, members: BrokerageMember[] | null,
  now = new Date()): ManagerExceptionPage | ManagerExceptionSettings | { error: string } {
  const parsed = managerExceptionInput.safeParse(input);
  if (!parsed.success || (staff && staff.brokerage.role !== "Admin")) return { error: managerExceptionsUnavailable };
  const policy = readPlaybook(db);
  const active = members?.filter((member) => member.status === "Active") ?? null;
  if (parsed.data.view === "settings") return { kind: "settings", policy, members: active,
    campaigns: read(db, "SELECT id, name FROM call_campaigns ORDER BY name COLLATE NOCASE, id") };
  const { filters, after } = parsed.data;
  const officers = JSON.stringify(active?.filter(({ role }) => role !== "Processor").map(({ email }) => email) ?? []);
  const processors = JSON.stringify(active?.filter(({ role }) => role === "Processor").map(({ email }) => email) ?? []);
  const clock = now.toISOString();
  const leadOnly = Boolean(filters.source || filters.campaign || filters.type === "Campaign recovery");
  const { selected, tasks } = leadOnly ? { selected: [], tasks: [] } : loanFacts(db, officers, processors);
  const fundingCallback = "EXISTS (SELECT 1 FROM funding_check_ins WHERE activityId = activity.id)";
  const activity = leadOnly ? [] : read<PlaybookFacts["contactActivity"][number] & { name: string; role: string; email: string; phone: string }>(db,
    `SELECT activity.id, activity.contactId, activity.kind, activity.purpose, activity.outcome, activity.dueAt, activity.completedAt,
      activity.followUpOwner, activity.followUpOwnerEmail, activity.revision, ${fundingCallback} AS postFundingCheckIn,
      contact.name, contact.role, contact.email, contact.phone
    FROM contact_activity activity JOIN contacts contact ON contact.id = activity.contactId
    WHERE activity.completedAt IS NULL AND activity.dueAt IS NOT NULL AND (
      (? = 1 AND activity.followUpOwnerEmail NOT IN (SELECT value FROM json_each(?))) OR
      (activity.outcome = 'Requested callback' AND julianday(activity.dueAt) <= julianday(?) AND ${fundingCallback}))`,
    Number(!!active), officers, clock);
  const people = [...selected, ...activity];
  const blocked = blockedOutreachKeys(db, people);
  const state: PlaybookFacts = {
    playbook: policy,
    ...leadFacts(db, filters, officers, clock, new Date(now.getTime() - policy.quietHours * 3_600_000).toISOString()),
    callCampaigns: read<PlaybookFacts["callCampaigns"][number]>(db, `SELECT campaign.id, campaign.name, coalesce(rules.automaticPaused, 0) AS automaticPaused
      FROM call_campaigns campaign LEFT JOIN call_campaign_rules rules ON rules.campaignId = campaign.id`),
    loans: selected.map(({ id, contactId, stage, disposition, officer, officerEmail, revisitDate }) =>
      ({ id, contactId, stage, disposition, officer, officerEmail, revisitDate })),
    loanProcessing: selected.flatMap(({ processingId, processorEmail, processorName, status, updatedAt, revision }) =>
      processingId ? [{ loanId: processingId, processorEmail, processorName, status, updatedAt, revision }] : []),
    applications: selected.flatMap(({ appId, submittedAt, reviewedAt, correctionNote, approved, corrected }) =>
      appId ? [{ loanId: appId, submittedAt, reviewedAt, correctionNote, secondReviewApproved: Boolean(approved), previousAnswers: Boolean(corrected) }] : []),
    contacts: people.map(({ contactId, name, role, email, phone }) =>
      ({ id: contactId, name, outreachSuppressed: role !== "Realtor" && outreachSuppressed(blocked, { contactId, email, phone }) })),
    contactActivity: activity.map(({ id, contactId, kind, purpose, outcome, dueAt, completedAt, followUpOwner, followUpOwnerEmail, revision, postFundingCheckIn }) =>
      ({ id, contactId, kind, purpose, outcome, dueAt, completedAt, followUpOwner, followUpOwnerEmail, revision, postFundingCheckIn: Boolean(postFundingCheckIn) })),
    tasks,
  };
  const sorted = managerExceptions(state, playbookWork(state), active, Boolean(staff), now.getTime(), filters);
  const key = (item: (typeof sorted)[number]["item"]) => item.dueAt ?? "9999";
  const ordered = sorted.sort((a, b) => key(a.item).localeCompare(key(b.item)) || a.item.id.localeCompare(b.item.id));
  const rows = ordered.filter(({ item }) => !after || key(item).localeCompare(after.dueAt) > 0 ||
    (key(item) === after.dueAt && item.id.localeCompare(after.id) > 0)).slice(0, limit + 1);
  const file = new Map(selected.map((loan) => [loan.id, loan]));
  const last = rows[limit - 1]?.item;
  return { kind: "owners", rows: rows.slice(0, limit).map((row) => {
    const processing = row.item.kind === "assign" || row.item.kind === "accept" || row.item.kind === "processor-owner";
    const loan = processing || row.item.kind === "prepare" || row.item.kind === "review" ||
      row.item.kind === "funding" || row.item.kind === "loan-owner" ? file.get(row.item.recordId) : undefined;
    return { ...row, otherOwner: (processing ? loan?.officerEmail : loan?.processorEmail) ?? null, processingRevision: loan?.revision ?? 0 };
  }), next: rows.length > limit && last ? { dueAt: key(last), id: last.id } : null };
}
