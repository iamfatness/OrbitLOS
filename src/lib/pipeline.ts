import { loanActionApplications } from "./applications";
import { loanNextAction, matchesWorkFilter, pausedLoan, type LoanNextActionState } from "./loan-workflow";
import { prospectingBlocked, stages, type Loan } from "./model";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import { pipelineQuery, pipelineUnavailable, type PipelineCursor, type PipelineLoan, type PipelinePage } from "./pipeline-model";
import { readPlaybook } from "./playbooks";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { stageDays } from "./utils";

type Candidate = Loan & { name: string; email: string; phone: string; lenderSearch: string };
const selectIds = "SELECT value FROM json_each(?)";

function byLoan<T extends { loanId: string }>(records: T[]) {
  const result = new Map<string, T[]>();
  for (const record of records) {
    const entries = result.get(record.loanId);
    if (entries) entries.push(record);
    else result.set(record.loanId, [record]);
  }
  return result;
}

function pipelineFacts(db: Store, candidates: Candidate[], role?: WorkspaceStaff["brokerage"]["role"]) {
  const loanIds = candidates.map(({ id }) => id);
  const ids = JSON.stringify(loanIds);
  const read = <T extends { loanId: string }>(sql: string) => db.prepare(sql).all(ids) as unknown as T[];
  const applications = byLoan(loanActionApplications(db, loanIds));
  const submissions = byLoan(read<Omit<LoanNextActionState["submissions"][number], "conditions"> & { conditions: string }>(`
    SELECT id, loanId, lender, externalId, status, syncedAt, conditions FROM submissions WHERE loanId IN (${selectIds})
    ORDER BY lender, id`).map(({ conditions, ...submission }) => ({
    ...submission, conditions: JSON.parse(conditions) as LoanNextActionState["submissions"][number]["conditions"],
  })));
  const tasks = byLoan(role === "Processor" ? [] : read<LoanNextActionState["tasks"][number]>(`
    SELECT id, loanId, title, dueAt, completedAt, purpose FROM tasks
    WHERE completedAt IS NULL AND loanId IN (${selectIds}) ORDER BY dueAt, id`));
  const documents = byLoan(read<LoanNextActionState["documentRequests"][number]>(`
    SELECT request.id, request.loanId, request.status, request.kind, request.conditionId, request.submissionId, delivery.receipt AS uwmReceipt
    FROM document_requests request LEFT JOIN uwm_document_deliveries delivery ON delivery.requestId = request.id
    WHERE request.loanId IN (${selectIds}) ORDER BY request.requestedAt, request.id`));
  const plans = byLoan(read<LoanNextActionState["closingPlans"][number]>(`SELECT loanId, targetDate FROM closing_plans WHERE loanId IN (${selectIds})`));
  const pastClients = byLoan(read<LoanNextActionState["pastClients"][number]>(`SELECT loanId, closingDate FROM past_client_profiles WHERE loanId IN (${selectIds})`));
  const progress = byLoan(read<LoanNextActionState["closingProgress"][number]>(`SELECT loanId, fundingDate FROM closing_progress WHERE loanId IN (${selectIds})`));
  const processing = byLoan(read<LoanNextActionState["loanProcessing"][number]>(`
    SELECT loanId, processorEmail, processorName, status, updatedAt FROM loan_processing WHERE loanId IN (${selectIds})`));
  const suppression = blockedOutreachKeys(db, candidates);
  const playbook = readPlaybook(db);
  return (loan: Candidate) => {
    const id = loan.id;
    const outreachBlocked = outreachSuppressed(suppression, loan);
    const pending = tasks.get(id) ?? [];
    const lenderFiles = submissions.get(id) ?? [];
    const action = loanNextAction(loan, {
      applications: applications.get(id) ?? [], contacts: [{ id: loan.contactId, outreachSuppressed: outreachBlocked }],
      tasks: pending, submissions: lenderFiles, documentRequests: documents.get(id) ?? [], closingPlans: plans.get(id) ?? [],
      pastClients: pastClients.get(id) ?? [], closingProgress: progress.get(id) ?? [], loanProcessing: processing.get(id) ?? [], playbook,
    }, role);
    return { action,
      lenders: [...new Set(lenderFiles.map(({ lender }) => lender))],
      openConditions: lenderFiles.reduce((total, file) => total + file.conditions.filter(({ satisfiedAt }) => !satisfiedAt).length, 0),
      overdueTask: (now: number) => !pausedLoan(loan) && pending.some((task) =>
        !prospectingBlocked(task.purpose, outreachBlocked) && Date.parse(task.dueAt) < now),
    };
  };
}

export function readPipeline(db: Store, input: unknown, staff: WorkspaceStaff | null, now = Date.now()): PipelinePage | { error: string } {
  const parsed = pipelineQuery.safeParse(input);
  if (!parsed.success) return { error: pipelineUnavailable };
  const { view, search, filters, after, lane } = parsed.data;
  const role = staff?.brokerage.role;
  const scope = role === "LO" ? "loan.officerEmail = ?" : role === "Processor" ? `EXISTS (
    SELECT 1 FROM loan_processing assigned WHERE assigned.loanId = loan.id AND assigned.processorEmail = ?)` : "1";
  const scopeArgs = staff && (role === "LO" || role === "Processor") ? [staff.email] : [];
  const conditions: string[] = [scope];
  const args: SqlValue[] = [...scopeArgs];
  for (const [column, value] of [["stage", filters.stage], ["officer", filters.officer], ["partnerId", filters.partner]]) {
    if (value) {
      conditions.push(`loan.${column} = ?`);
      args.push(value);
    }
  }
  if (filters.lender) {
    conditions.push("EXISTS (SELECT 1 FROM submissions source WHERE source.loanId = loan.id AND source.lender = ?)");
    args.push(filters.lender);
  }
  const candidates = db.prepare(`SELECT loan.id, loan.address, loan.officer, loan.officerEmail, loan.amount, loan.purpose,
    loan.stage, loan.stageSince, loan.contactId, loan.partnerId, loan.disposition, loan.dispositionReason, loan.revisitDate,
    borrower.name, borrower.email, borrower.phone,
    ${search ? `(SELECT json_group_array(json_array(source.lender, source.externalId)) FROM submissions source
      WHERE source.loanId = loan.id)` : "'[]'"} AS lenderSearch
    FROM loans loan JOIN contacts borrower ON borrower.id = loan.contactId WHERE ${conditions.join(" AND ")}
    ORDER BY loan.stageSince DESC, loan.id`).all(...args) as unknown as Candidate[];
  const needle = search.toLowerCase();
  const matching = candidates.filter((loan) => (!filters.days || stageDays(loan.stageSince, now) >= Number(filters.days)) &&
    (!needle || [loan.name, loan.address, loan.officer, ...(JSON.parse(loan.lenderSearch) as string[][]).flat()]
      .some((value) => value.toLowerCase().includes(needle))));
  const overdueFacts = filters.work === "Overdue" && matching.length ? pipelineFacts(db, matching, role) : null;
  const overdueActions = new Map<string, ReturnType<NonNullable<typeof overdueFacts>>>();
  const filtered = matching.filter((loan) => {
    if (!overdueFacts) return matchesWorkFilter(loan, null, filters.work, now, Boolean(staff));
    const facts = overdueFacts(loan);
    const include = matchesWorkFilter(loan, facts.action.dueAt, filters.work, now, Boolean(staff)) || facts.overdueTask(now);
    if (include) overdueActions.set(loan.id, facts);
    return include;
  });
  const page = (rows: Candidate[], limit: number) => {
    const remaining = after ? rows.filter((loan) => loan.stageSince < after.stageSince ||
      (loan.stageSince === after.stageSince && loan.id > after.id)) : rows;
    const items = remaining.slice(0, limit);
    const last = items.at(-1);
    const next: PipelineCursor | null = remaining.length > limit && last ? { id: last.id, stageSince: last.stageSince } : null;
    return { items, next };
  };
  const lanes = view === "Board" ? stages.filter((stage) => (!lane || lane === stage) && (!filters.stage || filters.stage === stage)).map((stage) => {
    const rows = filtered.filter((loan) => loan.stage === stage);
    return { stage, count: rows.length, volume: rows.reduce((sum, loan) => sum + loan.amount, 0), ...page(rows, 12) };
  }) : [];
  const list = view === "List" ? page(filtered, 30) : { items: [], next: null };
  const selected = [...lanes.flatMap(({ items }) => items), ...list.items];
  const facts = selected.length && !overdueFacts ? pipelineFacts(db, selected, role) : null;
  const toCard = (loan: Candidate): PipelineLoan => {
    const { id, name, address, officer, amount, purpose, stage, stageSince, disposition } = loan;
    const detail = overdueActions.get(id) ?? facts!(loan);
    return { id, name, address, officer, amount, purpose, stage, stageSince, disposition,
      action: detail.action, lenders: detail.lenders, openConditions: detail.openConditions };
  };
  const active = "coalesce(nullif(loan.disposition, ''), 'Active') = 'Active' AND loan.stage NOT IN ('Funded', 'Closed')";
  const counts = db.prepare(`SELECT count(*) AS total, count(*) FILTER (WHERE ${active}) AS active,
    coalesce(sum(loan.amount) FILTER (WHERE ${active}), 0) AS volume FROM loans loan WHERE ${scope}`).get(...scopeArgs);
  const open = db.prepare(`SELECT count(*) AS count FROM submissions submission JOIN loans loan ON loan.id = submission.loanId
    JOIN json_each(submission.conditions) condition WHERE ${scope}
    AND coalesce(json_extract(condition.value, '$.satisfiedAt'), '') = ''`).get(...scopeArgs);
  const options = (sql: string) => db.prepare(sql).all(...scopeArgs).map(({ value }) => String(value)).sort();
  return { metrics: { total: Number(counts?.total), active: Number(counts?.active), volume: Number(counts?.volume), openConditions: Number(open?.count) },
    matches: filtered.length,
    options: {
      lenders: options(`SELECT DISTINCT submission.lender AS value FROM submissions submission JOIN loans loan ON loan.id = submission.loanId WHERE ${scope}`),
      officers: options(`SELECT DISTINCT loan.officer AS value FROM loans loan WHERE ${scope} AND loan.officer <> ''`),
      partners: db.prepare(`SELECT DISTINCT contact.id, contact.name FROM loans loan JOIN contacts contact ON contact.id = loan.partnerId
        WHERE ${scope} AND contact.role = 'Realtor' ORDER BY contact.name COLLATE NOCASE, contact.id`).all(...scopeArgs) as unknown as PipelinePage["options"]["partners"],
    },
    lanes: lanes.map(({ items, ...entry }) => ({ ...entry, loans: items.map(toCard) })),
    list: { next: list.next, loans: list.items.map(toCard) },
  };
}
