import { createHash } from "node:crypto";
import { applicationDraft } from "./application-model";
import { addApplicationActivity } from "./applications";
import { cutoverFileConditionLimit, cutoverFileDocumentLimit, cutoverFileLenderKey, cutoverFileLenderLimit, cutoverFileText,
  type CutoverFileComparison, type CutoverFileSource } from "./cutover-file-model";
import { documentKinds, primaryDocumentRecipient, type DocumentKind } from "./document-model";
import { addDocumentRequest } from "./document-requests";
import { addLoanAuditEntry } from "./loan-audit";
import type { CutoverApplicationQuery, CutoverOpenWork } from "./migration-cutover-model";
import type { Condition } from "./model";
import type { WorkspaceStaff } from "./staff-store";
import { insertSubmission, type Store } from "./store";
import { accessEvent } from "./workspace-access";

type PendingDocument = { kind: DocumentKind; instructions: string; dueOn: string | null };
type PendingLender = NonNullable<CutoverFileSource["lenderFiles"]>[number];
const supportedKinds = new Map(documentKinds.map((kind) => [cutoverFileText(kind), kind]));

export function planCutoverOpenWork(db: Store, scope: CutoverApplicationQuery, source: CutoverFileSource, revision: number,
  documents: CutoverFileComparison | null, lender: CutoverFileComparison | null) {
  const { loanId } = scope;
  const loan = db.prepare(`SELECT loan.officer, loan.officerEmail, processing.processorName, processing.processorEmail, app.draft,
    draft.sourceExtraBorrowers, EXISTS(SELECT 1 FROM joint_applications WHERE loanId = loan.id) AS joint
    FROM loans loan JOIN mismo_rehearsals draft ON draft.loanId = loan.id JOIN applications app ON app.loanId = loan.id
    LEFT JOIN loan_processing processing ON processing.loanId = loan.id
    WHERE loan.id = ? AND loan.disposition = 'Active' AND loan.stage NOT IN ('Closed', 'Funded')`).get(loanId);
  if (!loan || (!documents && !lender)) return null;

  const pendingDocuments: PendingDocument[] = [];
  const pendingLenders: PendingLender[] = [];
  let review = 0;
  if (source.documents && !documents) review += source.documents.length;
  if (source.documents && documents) {
    const rows = db.prepare(`SELECT kind, recipient, instructions, status, dueOn, conditionId FROM document_requests
      WHERE loanId = ? LIMIT ?`).all(loanId, cutoverFileDocumentLimit + 1);
    let primaryOnly = false;
    if (loan.sourceExtraBorrowers === 0 && !loan.joint) {
      try {
        const draft = applicationDraft.safeParse(JSON.parse(String(loan.draft)));
        primaryOnly = draft.success && draft.data.urla.credit.fields.type !== "Joint";
      } catch { /* An unreadable borrower draft requires review. */ }
    }
    const occurrences = new Map<string, number>();
    for (const { kind } of source.documents) {
      const key = cutoverFileText(kind);
      occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    }
    for (const document of source.documents) {
      const key = cutoverFileText(document.kind);
      const kind = supportedKinds.get(key);
      const existing = rows.filter((row) => cutoverFileText(String(row.kind)) === key);
      if (primaryOnly && occurrences.get(key) === 1 && existing.some((row) => row.recipient === primaryDocumentRecipient && row.conditionId === null &&
        row.status === document.status && row.dueOn === document.dueOn &&
        cutoverFileText(String(row.instructions)) === cutoverFileText(document.instructions))) continue;
      if (document.status === "Requested" && (document.evidence?.revision ?? 0) === 0 && kind && primaryOnly && occurrences.get(key) === 1 && !existing.length &&
        rows.length + pendingDocuments.length < cutoverFileDocumentLimit) {
        pendingDocuments.push({ kind, instructions: document.instructions, dueOn: document.dueOn });
      } else review++;
    }
    review = Math.max(review, documents.rows.filter(({ source, status }) => source && status !== "Matched").length - pendingDocuments.length);
  }
  if (source.lenderFiles && !lender) review += source.lenderFiles.reduce((count, file) => count + file.conditions.length + 1, 0);
  if (source.lenderFiles && lender) {
    const existing = db.prepare(`SELECT lender, externalId, conditions FROM submissions WHERE loanId = ? LIMIT ?`)
      .all(loanId, cutoverFileLenderLimit + 1);
    let conditionCount = existing.reduce((sum, row) => sum + (JSON.parse(String(row.conditions)) as Condition[]).length, 0);
    const existingKeys = new Set(existing.map((row) => cutoverFileLenderKey(String(row.lender), String(row.externalId))));
    for (const file of source.lenderFiles) {
      const key = cutoverFileLenderKey(file.lender, file.reference);
      const conditions = file.conditions.filter(({ status }) => status === "Open");
      const occupied = existingKeys.has(key) || !!db.prepare("SELECT 1 FROM submissions WHERE lender = ? AND externalId = ?")
        .get(file.lender, file.reference);
      if (cutoverFileText(file.lender) !== "uwm" && !occupied && conditions.length && existing.length + pendingLenders.length < cutoverFileLenderLimit &&
        conditionCount + conditions.length <= cutoverFileConditionLimit) {
        pendingLenders.push({ ...file, conditions });
        conditionCount += conditions.length;
      }
    }
    const restored = pendingLenders.reduce((count, file) => count + file.conditions.length + 1, 0);
    const pendingHistory = pendingLenders.reduce((count, file) => count + file.conditions.filter(({ evidence }) =>
      Boolean(evidence?.receipts?.length || evidence?.clearance)).length, 0);
    review += Math.max(0, lender.rows.filter(({ source, status }) => source && status !== "Matched").length - restored + pendingHistory);
  }
  const conditions = pendingLenders.reduce((count, file) => count + file.conditions.length, 0);
  const owner = loan.officerEmail ? String(loan.officer || loan.officerEmail) : null;
  const processor = loan.processorEmail ? String(loan.processorName || loan.processorEmail) : null;
  const fingerprint = createHash("sha256").update(JSON.stringify([scope, revision, documents?.fingerprint, lender?.fingerprint,
    loan.officerEmail, loan.processorEmail, owner, processor, pendingDocuments, pendingLenders])).digest("hex");
  const preview: CutoverOpenWork = { fingerprint, owner, processor, documents: pendingDocuments.length, conditions, review };
  return { preview, pendingDocuments, pendingLenders };
}

export function applyCutoverOpenWork(db: Store, loanId: string, plan: NonNullable<ReturnType<typeof planCutoverOpenWork>>, staff: WorkspaceStaff, now: string) {
  const { preview, pendingDocuments, pendingLenders } = plan;
  for (const { kind, instructions, dueOn } of pendingDocuments) addDocumentRequest(db, loanId, kind, instructions, now, undefined, dueOn);
  for (const file of pendingLenders) {
    const conditions: Condition[] = file.conditions.map(({ category, description }) => ({ id: crypto.randomUUID(), category, description,
      group: null, uploaded: false, satisfiedAt: null,
      manual: { owner: preview.processor ?? preview.owner ?? "", revision: 1, openedAt: now, deliveries: [], confirmedDelivery: null } }));
    insertSubmission(db, { id: crypto.randomUUID(), loanId, lender: file.lender, externalId: file.reference,
      status: file.status, conditions, syncedAt: null });
  }
  const action = "Restored fictional open work from cutover";
  const summary = [preview.documents ? `${preview.documents} document ${preview.documents === 1 ? "request" : "requests"}` : "",
    preview.conditions ? `${preview.conditions} lender ${preview.conditions === 1 ? "condition" : "conditions"}` : ""].filter(Boolean).join(" · ");
  addApplicationActivity(db, loanId, `${action} · ${summary}`, now);
  accessEvent(db, staff, action, loanId, now);
  addLoanAuditEntry(db, loanId, staff, action, now, [{ field: "Restored document requests", before: null, after: preview.documents },
    { field: "Restored lender conditions", before: null, after: preview.conditions }]);
  return { message: `Restored open work · ${summary}.` };
}
