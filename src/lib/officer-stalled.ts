import { loanNextAction, stalledLoanCutoff, type LoanNextActionState } from "./loan-workflow";
import type { Loan } from "./model";
import { stalledLoanStages, type BrokerageStalledPage, type StalledLoanPage, type StalledLoanQuery } from "./officer-dashboard-model";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import { readPlaybook } from "./playbooks";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { stageDays } from "./utils";

type StalledRow = Pick<Loan, "id" | "stage" | "stageSince" | "officer" | "officerEmail" | "contactId"> & {
  enteredAt: number; name: string; email: string; phone: string;
};
type ApplicationRow = Omit<LoanNextActionState["applications"][number], "versions"> & { uwmReceipt: string | null; uwmSentAt: string | null };
const pageSize = 12;
const pageIds = "SELECT value FROM json_each(?)";
const activePipeline = "loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed')";
const stageAge = "julianday(loan.stageSince)";
const stalled = `${stageAge} <= julianday(?)`;

function actionState(db: Store, page: StalledRow[]): LoanNextActionState {
  const ids = JSON.stringify(page.map(({ id }) => id));
  const read = <T>(sql: string, ...args: SqlValue[]) => db.prepare(sql).all(ids, ...args) as unknown as T[];
  const suppressed = blockedOutreachKeys(db, page);
  const contacts = page.map((loan) => ({ id: loan.contactId, outreachSuppressed: outreachSuppressed(suppressed, loan) }));
  const blockedIds = JSON.stringify(contacts.filter(({ outreachSuppressed }) => outreachSuppressed).map(({ id }) => id));
  const applications = read<ApplicationRow>(`SELECT app.loanId, app.submittedAt, app.reviewedAt, app.revision, app.uwmReference,
      CASE WHEN app.correctionNote <> '' THEN 'Pending' ELSE '' END AS correctionNote, version.uwmReceipt, version.uwmSentAt
    FROM applications app LEFT JOIN application_versions version ON version.loanId = app.loanId AND version.revision = app.revision
    WHERE app.loanId IN (${pageIds})`).map(({ uwmReceipt, uwmSentAt, ...app }) => ({ ...app,
    versions: typeof uwmReceipt === "string" && typeof uwmSentAt === "string" ? [{ revision: app.revision, uwmReceipt: { reference: uwmReceipt, sentAt: uwmSentAt } }] : [],
  }));
  const submissions = read<Omit<LoanNextActionState["submissions"][number], "conditions"> & { conditions: string }>(`
    SELECT id, loanId, lender, syncedAt, conditions FROM submissions
    WHERE loanId IN (${pageIds}) AND lender = 'UWM' COLLATE BINARY AND syncedAt IS NOT NULL ORDER BY id`)
    .map((row) => ({ ...row, conditions: JSON.parse(row.conditions) as LoanNextActionState["submissions"][number]["conditions"] }));
  return { contacts, applications, submissions, playbook: readPlaybook(db),
    tasks: read<LoanNextActionState["tasks"][number]>(`WITH pageLoans AS (${pageIds})
      SELECT task.id, task.loanId, task.title, task.dueAt, task.completedAt, task.purpose
      FROM loans loan JOIN tasks task ON task.id = (SELECT pending.id FROM tasks pending WHERE pending.loanId = loan.id AND pending.completedAt IS NULL
        AND (pending.purpose IS NOT 'Prospecting' OR loan.contactId NOT IN (${pageIds})) ORDER BY pending.dueAt, pending.id LIMIT 1)
      WHERE loan.id IN (SELECT value FROM pageLoans)`, blockedIds),
    documentRequests: read<LoanNextActionState["documentRequests"][number]>(`SELECT request.id, request.loanId, request.status, request.kind,
      request.conditionId, request.submissionId, delivery.receipt AS uwmReceipt
      FROM document_requests request LEFT JOIN uwm_document_deliveries delivery ON delivery.requestId = request.id
      WHERE request.loanId IN (${pageIds}) ORDER BY request.requestedAt, request.id`),
    pastClients: read<LoanNextActionState["pastClients"][number]>(`SELECT loanId, closingDate FROM past_client_profiles WHERE loanId IN (${pageIds})`),
    closingPlans: read<LoanNextActionState["closingPlans"][number]>(`SELECT loanId, targetDate FROM closing_plans WHERE loanId IN (${pageIds})`),
    closingProgress: read<LoanNextActionState["closingProgress"][number]>(`SELECT loanId, fundingDate FROM closing_progress WHERE loanId IN (${pageIds})`),
    loanProcessing: read<LoanNextActionState["loanProcessing"][number]>(`SELECT loanId, processorEmail, processorName, status, updatedAt
      FROM loan_processing WHERE loanId IN (${pageIds})`),
  };
}

export function stalledLoanPage(db: Store, staff: WorkspaceStaff, query: StalledLoanQuery, now: Date, localName?: string): StalledLoanPage | BrokerageStalledPage {
  const { stage, after } = query;
  const team = query.type === "brokerageStalledLoans";
  const owner = team ? query.owner : staff.email;
  const selectedOwner = !team && localName ? { sql: "AND (loan.officerEmail = ? OR (loan.officerEmail IS NULL AND loan.officer = ?))", args: [owner, localName] } :
    owner === "unassigned" ? { sql: "AND loan.officerEmail IS NULL", args: [] } :
      owner ? { sql: "AND loan.officerEmail = ?", args: [owner] } : { sql: "", args: [] };
  const cutoff = new Date(stalledLoanCutoff(now.getTime())).toISOString();
  const rows = db.prepare(`SELECT loan.id, loan.contactId, loan.officer, loan.officerEmail, loan.stage, loan.stageSince, ${stageAge} AS enteredAt,
      contact.name, contact.email, contact.phone
    FROM loans loan JOIN contacts contact ON contact.id = loan.contactId
    WHERE ${activePipeline} AND ${stalled} ${selectedOwner.sql}
      ${stage ? "AND loan.stage = ?" : ""} ${after ? `AND (${stageAge}, loan.id) > (?, ?)` : ""}
    ORDER BY ${stageAge}, loan.id LIMIT ?`)
    .all(cutoff, ...selectedOwner.args, ...(stage ? [stage] : []), ...(after ? [after.enteredAt, after.id] : []), pageSize + 1) as unknown as StalledRow[];
  const page = rows.slice(0, pageSize);
  const last = page.at(-1);
  const state = page.length ? actionState(db, page) : null;
  const result = { checkedAt: now.toISOString(),
    next: last && rows.length > pageSize ? { id: last.id, enteredAt: last.enteredAt } : null,
    items: state ? page.map((loan) => {
      const action = loanNextAction(loan, state, staff.brokerage.role);
      return { id: loan.id, name: loan.name, stage: loan.stage, days: stageDays(loan.stageSince, now.getTime()),
        action: action.title, blocker: action.blocker, dueAt: action.dueAt,
        ...(team ? { owner: loan.officerEmail ? loan.officer || loan.officerEmail : "Unassigned" } : {}) };
    }) : [],
  };
  if (!team) return { kind: "stalledLoans", ...result };

  const stageTotals = db.prepare(`SELECT loan.stage, count(*) AS active, sum(CASE WHEN ${stalled} THEN 1 ELSE 0 END) AS stalled
    FROM loans loan WHERE ${activePipeline} ${selectedOwner.sql} GROUP BY loan.stage`).all(cutoff, ...selectedOwner.args);
  const ownerTotals = db.prepare(`SELECT loan.officerEmail AS email, max(nullif(loan.officer, '')) AS name,
      sum(CASE WHEN ${stalled} THEN 1 ELSE 0 END) AS stalled
    FROM loans loan WHERE ${activePipeline} GROUP BY loan.officerEmail ORDER BY name COLLATE NOCASE, email`).all(cutoff);
  return { kind: "brokerageStalledLoans", ...result,
    stages: stalledLoanStages.map((stage) => {
      const entry = stageTotals.find((row) => row.stage === stage);
      return { stage, active: Number(entry?.active ?? 0), stalled: Number(entry?.stalled ?? 0) };
    }),
    owners: ownerTotals.map((row) => ({ email: String(row.email ?? "unassigned"), name: row.email ? String(row.name ?? row.email) : "Unassigned",
      stalled: Number(row.stalled) })),
  };
}
