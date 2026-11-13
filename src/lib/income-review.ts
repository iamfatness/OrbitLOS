import { createHash } from "node:crypto";
import { addApplicationActivity } from "./applications";
import { easternDate } from "./client-retention";
import { documentRecipients, primaryDocumentRecipient, type DocumentRecipient } from "./document-model";
import { acceptedIncomeVerificationSql, incomeEvidenceMatchesSql } from "./income-review-freshness";
import { incomeCompletionIssue, incomeEvidenceKey, incomeReviewUnavailable, incomeWorksheetMethod, incomeWorksheetRequest, monthlyWorksheetTotal, sameIncomeEvidence,
  type IncomeEvidence, type IncomeStage, type IncomeWorksheetPage, type IncomeWorksheetRecord } from "./income-review-model";
import { flagIncomeQuoteReview } from "./quote-worksheet-store";
import { serviceOrderLimit } from "./service-order-model";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { accessEvent, loanAccess } from "./workspace-access";

type Row = Record<string, SqlValue>;
const reviewChanged = "The income worksheet changed. Reload it before continuing.";
const fileChanged = "The submitted 1003 changed. Reload the worksheet and check its inputs.";
const evidenceChanged = "Accepted income evidence changed. Select its current revision and review the worksheet again.";
const metadata = "revision, applicationRevision, stage, amount, method, updatedBy, updatedAt, note";
const acceptableEvidence = "status = 'Accepted' AND kind IN ('Pay stub', 'Bank statement', 'Tax form')";

function file(db: Store, loanId: string) {
  return db.prepare(`SELECT loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed') AS active,
    app.revision, app.submittedAt, app.reviewedAt, app.correctionNote,
    json_extract(app.draft, '$.confirmedDemo') AS fictional, json_extract(app.draft, '$.monthlyIncome') AS primaryIncome,
    json_extract(app.draft, '$.coBorrowerIncome') AS coIncome,
    EXISTS (SELECT 1 FROM joint_applications joint WHERE joint.loanId = loan.id) AS joint
    FROM loans loan LEFT JOIN applications app ON app.loanId = loan.id WHERE loan.id = ?`).get(loanId);
}

function currentApplication(file: Row | undefined) {
  return file?.submittedAt && !file.correctionNote && file.fictional === 1 && typeof file.revision === "number" ? file.revision : null;
}

function snapshot(row: Row): Omit<IncomeWorksheetRecord, "sources" | "evidence"> {
  return { revision: Number(row.revision), applicationRevision: Number(row.applicationRevision), stage: row.stage as IncomeStage,
    amount: Number(row.amount), method: String(row.method), updatedBy: String(row.updatedBy), updatedAt: String(row.updatedAt), note: String(row.note) };
}

function evidenceFromRow(row: Row): IncomeEvidence {
  return { id: String(row.id), revision: Number(row.revision), label: String(row.kind),
    recipient: (row.recipient ?? primaryDocumentRecipient) as DocumentRecipient };
}

function verificationEvidence(db: Store, loanId: string, applicationRevision: number): IncomeEvidence[] {
  return db.prepare(`SELECT service.id, service.revision, service.kind, service.recipient,
    json_extract(receipt.value, '$.reference') AS returnReference, json_extract(receipt.value, '$.returnedAt') AS returnedAt,
    json_extract(receipt.value, '$.review.at') AS acceptedAt, json_extract(receipt.value, '$.review.actor') AS acceptedBy
    FROM service_orders service JOIN json_each(service.returns) receipt
    WHERE service.loanId = ? AND service.applicationRevision = ? AND service.recipient IS NOT NULL AND ${acceptedIncomeVerificationSql}
    ORDER BY service.kind, returnedAt DESC, service.id LIMIT ?`).all(loanId, applicationRevision, serviceOrderLimit).map((row) => ({
    ...evidenceFromRow(row), returnReference: String(row.returnReference), verification: {
      kind: row.kind as NonNullable<IncomeEvidence["verification"]>["kind"],
      returnedAt: String(row.returnedAt), acceptedAt: String(row.acceptedAt), acceptedBy: String(row.acceptedBy),
    },
  }));
}

function worksheetRecord(row: Row): IncomeWorksheetRecord {
  return { ...snapshot(row), sources: JSON.parse(String(row.sources)), evidence: JSON.parse(String(row.evidence)) };
}

function validEvidence(db: Store, loanId: string, revision: number) {
  return Boolean(db.prepare(`SELECT 1 FROM loan_income_worksheets income WHERE income.loanId = ? AND income.revision = ?
    AND ${incomeEvidenceMatchesSql("income.loanId", "income.evidence", "income.applicationRevision")}`).get(loanId, revision));
}

function readWorksheet(db: Store, loanId: string, currentFile: Row, staff: WorkspaceStaff, asOf: string): IncomeWorksheetPage {
  const applicationRevision = currentApplication(currentFile);
  const rows = db.prepare(`SELECT ${metadata} FROM loan_income_worksheets WHERE loanId = ? ORDER BY revision DESC LIMIT 13`).all(loanId);
  const head = rows[0] && db.prepare(`SELECT ${metadata}, sources, evidence FROM loan_income_worksheets WHERE loanId = ? AND revision = ?`)
    .get(loanId, rows[0].revision);
  const record = head ? worksheetRecord(head) : null;
  const stale = record && (record.applicationRevision !== applicationRevision || record.stage === "Approved" && !currentFile.reviewedAt
    ? "1003 changed" : !validEvidence(db, loanId, record.revision) ? "Evidence changed" : null);
  const declared = documentRecipients.slice(0, currentFile.joint || currentFile.coIncome ? 2 : 1).map((recipient, index) => {
    const value = index ? currentFile.coIncome : currentFile.primaryIncome;
    return { recipient, amount: typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null };
  });
  const eligible = applicationRevision === null ? [] : [
    ...db.prepare(`SELECT id, revision, kind, recipient FROM document_requests
      WHERE loanId = ? AND ${acceptableEvidence} ORDER BY kind, requestedAt DESC, id LIMIT 60`).all(loanId).map(evidenceFromRow),
    ...verificationEvidence(db, loanId, applicationRevision),
  ];
  return { applicationRevision, reviewed: Boolean(currentFile.reviewedAt), canEdit: Boolean(currentFile.active) && applicationRevision !== null,
    canApprove: staff.brokerage.role !== "Processor", asOf, recipients: documentRecipients.slice(0, currentFile.joint ? 2 : 1),
    declared, eligible, record, stale, history: rows.slice(1).map(snapshot) };
}

export function incomeWorksheetWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date()) {
  const parsed = incomeWorksheetRequest.safeParse(input);
  if (!parsed.success) return { error: "Check the source dates, amounts and evidence before saving." };
  const data = parsed.data;
  const { loanId } = data;
  if (!staff?.brokerage.pilot || staff.brokerage.id !== brokerageId || !loanAccess(db, staff, loanId)) return { error: incomeReviewUnavailable };
  return db.transaction(() => {
    const current = file(db, loanId);
    if (!current) return { error: incomeReviewUnavailable };
    const asOf = easternDate(now);
    const page = () => readWorksheet(db, loanId, current, staff, asOf);
    if (data.type === "read") {
      if (data.worksheetRevision === undefined) return { page: page() };
      const row = db.prepare(`SELECT ${metadata}, sources, evidence FROM loan_income_worksheets WHERE loanId = ? AND revision = ?`)
        .get(loanId, data.worksheetRevision);
      return row ? { page: { ...page(), requested: worksheetRecord(row) } } : { error: "This worksheet revision is unavailable on the loan." };
    }
    if (data.type === "approve" && staff.brokerage.role === "Processor") return { error: "The loan officer or an admin approves the income worksheet." };
    const applicationRevision = currentApplication(current);
    if (!current.active || applicationRevision === null || data.applicationRevision !== applicationRevision) return { error: fileChanged };
    const requestHash = createHash("sha256").update(JSON.stringify([staff.email, data])).digest("hex");
    const previous = db.prepare("SELECT requestHash FROM loan_income_worksheets WHERE requestId = ?").get(data.requestId);
    if (previous) return previous.requestHash === requestHash ? { page: page(), message: "Income worksheet is up to date." } : { error: reviewChanged };
    const latest = page();
    const { record } = latest;
    if (data.revision !== (record?.revision ?? 0)) return { error: reviewChanged };
    const sources = data.type === "save" ? data.sources : record?.sources;
    if (!sources) return { error: "Save the worksheet before requesting review." };

    let stage: IncomeStage = "Draft";
    let note = "";
    let evidence: IncomeEvidence[];
    if (data.type === "save") {
      const sourceIds = new Set(sources.map(({ id }) => id));
      const labels = sources.filter(({ included, label }) => included && label).map(({ recipient, label }) => `${recipient}\u0000${label.toLowerCase()}`);
      if (sourceIds.size !== sources.length || new Set(labels).size !== labels.length) return { error: "Use a distinct name for each included income source." };
      const accepted = db.prepare(`SELECT id, revision, kind, recipient FROM document_requests
        WHERE loanId = ? AND id = ? AND revision = ? AND recipient = ? AND ${acceptableEvidence}`);
      const selected = new Map<string, IncomeEvidence>();
      for (const source of sources) {
        if (source.recipient !== primaryDocumentRecipient && !current.joint) return { error: "Select evidence for a separately linked borrower." };
        if (new Set(source.evidence.map(incomeEvidenceKey)).size !== source.evidence.length) return { error: "Choose distinct evidence for each source." };
        for (const reference of source.evidence) {
          const row = reference.returnReference ? undefined : accepted.get(loanId, reference.id, reference.revision, source.recipient);
          const item = reference.returnReference
            ? latest.eligible.find((entry) => entry.recipient === source.recipient && sameIncomeEvidence(entry, reference))
            : row && evidenceFromRow(row);
          if (!item) return { error: evidenceChanged };
          selected.set(incomeEvidenceKey(reference), item);
        }
      }
      evidence = [...selected.values()];
      if (record?.applicationRevision === applicationRevision && !latest.stale && JSON.stringify(record.sources) === JSON.stringify(sources)) {
        return { page: latest, message: "Income worksheet is up to date." };
      }
    } else {
      if (!record || record.applicationRevision !== applicationRevision) return { error: fileChanged };
      if (!validEvidence(db, loanId, record.revision)) return { error: evidenceChanged };
      const issue = incomeCompletionIssue(sources, asOf);
      if (issue) return { error: issue };
      evidence = record.evidence;
      if (data.type === "submit") {
        if (record.stage !== "Draft") return { error: "Only a draft can be sent for review." };
        stage = "Ready for review";
      } else {
        if (record.stage !== "Ready for review" || !current.reviewedAt) return { error: "Review the current 1003 and submit a complete worksheet before approving income." };
        stage = "Approved";
        note = data.note;
      }
    }
    const amount = monthlyWorksheetTotal(sources);
    const at = now.toISOString();
    const revision = data.revision + 1;
    db.prepare(`INSERT INTO loan_income_worksheets
      (loanId, revision, applicationRevision, stage, amount, method, sources, evidence, note, updatedBy, updatedAt, requestId, requestHash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(loanId, revision, applicationRevision, stage, amount,
      incomeWorksheetMethod, JSON.stringify(sources), JSON.stringify(evidence), note, staff.name, at, data.requestId, requestHash);
    flagIncomeQuoteReview(db, loanId, at);
    const action = stage === "Approved" ? "Approved sample income worksheet" : stage === "Ready for review" ?
      "Sent sample income worksheet for review" : "Saved sample income worksheet";
    addApplicationActivity(db, loanId, `${action} · Worksheet v${revision} · 1003 revision ${applicationRevision} · ${staff.name}`, at);
    accessEvent(db, staff, action, loanId, at);
    return { page: page(), message: `${action}.` };
  });
}
