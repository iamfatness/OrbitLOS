import { z } from "zod";
import type { Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";
import { loanAccess } from "./workspace-access";
import { UwmError, uwmWorkspaceEnabled, type UwmEnvironment } from "./uwm-live";
import { uwmUserSettings } from "./uwm-user-access";
import { uwmPublicClient, UwmRequestError } from "./uwm-public-client";
import { bindUwmTransaction, correlateUwmImport, prepareUwmOperation, uwmRequestDigest } from "./uwm-operations";
import { requireUwmBranchContact, uwmScanRequest, uwmScanResponse, uwmLoanNumber, uwmDocumentName,
  uwmConditionAttachments, uwmProductSearch, uwmFloatRequest, uwmLockRequest, uwmRelockRequest } from "./uwm-public-contracts";

const base = { id: z.uuid(), loanId: z.uuid(), applicationRevision: z.number().int().positive(), confirmed: z.literal(true) };
export const uwmWorkflowRequest = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("prepare-import"), ...base, xml: z.string().min(1).max(1024 * 1024), scan: uwmScanRequest }),
  z.strictObject({ action: z.literal("amend-import"), ...base, importId: z.uuid(), values: z.array(z.string().max(10000)).max(500) }),
  z.strictObject({ action: z.literal("commit-import"), ...base, importId: z.uuid() }),
  z.strictObject({ action: z.literal("upload-document"), ...base, fileName: uwmDocumentName, content: z.string().min(1).max(8 * 1024 * 1024) }),
  z.strictObject({ action: z.literal("attach-documents"), ...base, body: uwmConditionAttachments }),
  z.strictObject({ action: z.literal("submit-documents"), ...base, attachments: z.array(z.strictObject({ attachmentId: z.number().int().positive(), revisionId: z.string().min(1) })).min(1).max(100) }),
  z.strictObject({ action: z.literal("float"), ...base, body: uwmFloatRequest }),
  z.strictObject({ action: z.literal("lock"), ...base, body: uwmLockRequest }),
  z.strictObject({ action: z.literal("relock"), ...base, body: uwmRelockRequest }),
  z.strictObject({ action: z.literal("extend-lock"), ...base, body: uwmRelockRequest }),
  z.strictObject({ action: z.literal("cancel-lock"), ...base }),
  z.strictObject({ action: z.literal("reconcile-request"), ...base, requestId: z.uuid(),
    outcome: z.enum(["Not applied", "Verified in UWM"]), evidence: z.string().trim().min(20).max(2000) }),
]);
type Input = z.infer<typeof uwmWorkflowRequest>;
type Client = ReturnType<typeof uwmPublicClient>;

export function initializeUwmWorkflows(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS uwm_live_requests (
    id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id), environment TEXT NOT NULL,
    actor TEXT NOT NULL, action TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL,
    result TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS uwm_live_requests_loan ON uwm_live_requests(loanId,environment,state);
  CREATE TABLE IF NOT EXISTS uwm_import_checks (
    operationId TEXT PRIMARY KEY REFERENCES uwm_operations(id), scan TEXT NOT NULL, ready INTEGER NOT NULL,
    committed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS uwm_request_evidence (
    requestId TEXT PRIMARY KEY REFERENCES uwm_live_requests(id), applicationRevision INTEGER NOT NULL, details TEXT NOT NULL
  );`);
}

function context(db: Store, env: UwmEnvironment, staff: WorkspaceStaff, loanId: string, writing = false) {
  if (!uwmWorkspaceEnabled(env, staff) || !loanAccess(db, staff, loanId)) throw new UwmError("This UWM file is unavailable.");
  if (writing && !["Admin", "LO", "Processor"].includes(staff.brokerage.role)) throw new UwmError("This UWM action is unavailable.");
  return uwmUserSettings(env).environment;
}
function reviewed(db: Store, input: Pick<Input, "loanId" | "applicationRevision">) {
  const row = db.prepare("SELECT revision,reviewedAt,submittedAt,correctionNote FROM applications WHERE loanId=?").get(input.loanId);
  if (!row || row.revision !== input.applicationRevision || !row.reviewedAt || !row.submittedAt || row.correctionNote) {
    throw new UwmError("Review the current application before continuing. The file may have changed.");
  }
}
function linkedLoan(db: Store, loanId: string, environment: string) {
  const rows = db.prepare("SELECT DISTINCT lenderLoanNumber FROM uwm_operations WHERE loanId=? AND environment=? AND kind='import' AND state='Completed'").all(loanId, environment);
  if (rows.length !== 1) throw new UwmError("A confirmed UWM import is required before working on this lender file.");
  return uwmLoanNumber.parse(rows[0].lenderLoanNumber);
}
function importCheck(db: Store, staff: WorkspaceStaff, input: Input & { importId: string }, environment: string) {
  const op = db.prepare("SELECT * FROM uwm_operations WHERE id=? AND loanId=? AND environment=? AND kind='import'").get(input.importId, input.loanId, environment);
  const check = db.prepare("SELECT * FROM uwm_import_checks WHERE operationId=?").get(input.importId);
  if (!op || op.actor !== staff.email || op.applicationRevision !== input.applicationRevision || !op.transactionId || !check || check.committed || op.state !== "Prepared") {
    throw new UwmError("This import is unavailable or already sent. Check its activity before continuing.");
  }
  return { op, check, transactionId: String(op.transactionId), scan: uwmScanResponse.parse(JSON.parse(String(check.scan))) };
}

export function reconcileUwmImportReceipt(db: Store, receiptId: number) {
  return correlateUwmImport(db, receiptId, (outcome) => {
    const requests = db.prepare(`SELECT request.id FROM uwm_live_requests request
      JOIN uwm_request_evidence evidence ON evidence.requestId = request.id
      JOIN uwm_import_checks checks ON checks.operationId = ? AND checks.committed = 1
      WHERE request.loanId = ? AND request.environment = ? AND request.actor = ? AND request.action = 'commit-import'
        AND request.state IN ('Dispatching', 'Unknown', 'Acknowledged')
        AND evidence.applicationRevision = ? AND json_extract(evidence.details, '$.importId') = checks.operationId
      LIMIT 2`).all(outcome.id, outcome.loanId, outcome.environment, outcome.actor, outcome.applicationRevision);
    if (requests.length !== 1) return;
    const result = {
      importId: outcome.id, receiptId: outcome.receiptId, outcome: outcome.state,
      message: outcome.state === "Completed" ? "UWM confirmed the loan import." : "UWM reported that the loan import failed.",
    };
    db.prepare("UPDATE uwm_live_requests SET state='Reconciled',result=?,updatedAt=? WHERE id=?")
      .run(JSON.stringify(result), new Date().toISOString(), requests[0].id);
  });
}

function recoverSavedImportReceipt(db: Store, loanId: string, environment: string) {
  const completed = db.prepare(`SELECT DISTINCT op.receiptId FROM uwm_live_requests request
    JOIN uwm_request_evidence evidence ON evidence.requestId = request.id
    JOIN uwm_operations op ON op.id = json_extract(evidence.details, '$.importId') AND op.kind = 'import'
      AND op.loanId = request.loanId AND op.environment = request.environment AND op.actor = request.actor
      AND op.applicationRevision = evidence.applicationRevision
    JOIN uwm_webhook_receipts receipt ON receipt.id = op.receiptId AND receipt.kind = 'import'
      AND receipt.environment = op.environment AND receipt.transactionId = op.transactionId
    WHERE request.loanId = ? AND request.environment = ? AND request.action = 'commit-import'
      AND request.state IN ('Dispatching','Unknown','Acknowledged') AND op.state IN ('Completed','Failed') AND op.receiptId IS NOT NULL`)
    .all(loanId, environment);
  for (const row of completed) reconcileUwmImportReceipt(db, Number(row.receiptId));
}

function requestResult(row: { id?: unknown; state?: unknown; result?: unknown }) {
  return { id: String(row.id), state: String(row.state), result: row.result ? JSON.parse(String(row.result)) as unknown : null };
}

// Every mutation is claimed synchronously before any await. An interrupted request
// stays Dispatching; neither that state nor Unknown is automatically replayed.
export async function runUwmWorkflow(db: Store, env: UwmEnvironment, staff: WorkspaceStaff, raw: unknown, client?: Client, registerTransaction?: (operationId: string, transactionId: string) => Promise<void>) {
  const input = uwmWorkflowRequest.parse(raw);
  const environment = context(db, env, staff, input.loanId, true);
  if (staff.brokerage.role === "Processor" && !["upload-document", "attach-documents", "submit-documents"].includes(input.action)) {
    throw new UwmError("Only an authorized loan officer or administrator can submit or price a loan.");
  }
  recoverSavedImportReceipt(db, input.loanId, environment);
  const digest = uwmRequestDigest(JSON.stringify(input));
  const existing = db.prepare("SELECT * FROM uwm_live_requests WHERE id=?").get(input.id);
  if (existing) {
    if (existing.actor !== staff.email || existing.loanId !== input.loanId || existing.environment !== environment || existing.digest !== digest) {
      throw new UwmError("This request reference belongs to a different action.");
    }
    return requestResult(existing);
  }
  if (input.action === "reconcile-request" && staff.brokerage.role !== "Admin") throw new UwmError("An administrator must record the lender verification.");
  if (input.action !== "reconcile-request") reviewed(db, input);
  if (input.action !== "reconcile-request" && db.prepare("SELECT id FROM uwm_live_requests WHERE loanId=? AND environment=? AND state IN ('Dispatching','Unknown')").get(input.loanId, environment)) {
    throw new UwmError("An earlier UWM request needs reconciliation before another action can be sent.");
  }
  if (input.action === "prepare-import") {
    if (!env.UWM_STORAGE_ORIGIN) throw new UwmError("The approved UWM XML storage address must be configured first.");
    if (/<!DOCTYPE|<!ENTITY/i.test(input.xml) || !/<(?:[\w.-]+:)?MESSAGE[\s>]/.test(input.xml) || !input.xml.includes("http://www.mismo.org/residential/2009/schemas")) {
      throw new UwmError("Provide a reviewed MISMO XML file without document types or external entities.");
    }
    if (db.prepare("SELECT id FROM uwm_operations WHERE loanId=? AND environment=? AND kind='import' AND state='Completed'").get(input.loanId, environment)) {
      throw new UwmError("This file already has a completed UWM import.");
    }
  }
  if (input.action === "upload-document" && !env.UWM_DOCUMENT_STORAGE_ORIGIN) throw new UwmError("The approved UWM document storage address must be configured first.");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO uwm_live_requests VALUES(?,?,?,?,?,?,'Dispatching',NULL,?,?)").run(input.id, input.loanId, environment, staff.email, input.action, digest, now, now);
  const evidence = input.action === "prepare-import" ? { scan: input.scan, xmlDigest: uwmRequestDigest(input.xml) }
    : input.action === "upload-document" ? { fileName: input.fileName, documentDigest: uwmRequestDigest(Buffer.from(input.content, "base64")) }
    : input.action === "amend-import" ? { importId: input.importId, correctedFieldCount: input.values.length }
    : input;
  db.prepare("INSERT INTO uwm_request_evidence VALUES(?,?,?)").run(input.id, input.applicationRevision, JSON.stringify(evidence));
  const api = client ?? uwmPublicClient(db, env, staff);
  let sent = false;
  const beforeSend = () => {
    context(db, env, staff, input.loanId, true); reviewed(db, input);
    if (db.prepare("SELECT state FROM uwm_live_requests WHERE id=?").get(input.id)?.state !== "Dispatching") throw new UwmError("This action was reconciled while it was running.");
    sent = true;
  };
  let result: unknown;
  try {
    if (input.action === "reconcile-request") {
      const previous = db.prepare("SELECT * FROM uwm_live_requests WHERE id=? AND loanId=? AND environment=?").get(input.requestId, input.loanId, environment);
      if (!previous || !["Dispatching", "Unknown", "Acknowledged"].includes(String(previous.state)) ||
        (previous.state === "Dispatching" && Date.parse(String(previous.updatedAt)) > Date.now() - 300000)) {
        throw new UwmError("This request cannot be reconciled yet. Let an in-progress request finish first.");
      }
      db.prepare("UPDATE uwm_live_requests SET state='Reconciled',updatedAt=? WHERE id=?").run(now, input.requestId);
      if (input.outcome === "Not applied") {
        const prior = db.prepare("SELECT details FROM uwm_request_evidence WHERE requestId=?").get(input.requestId);
        const details = prior ? JSON.parse(String(prior.details)) as { importId?: string } : null;
        const importId = previous.action === "prepare-import" ? input.requestId : previous.action === "commit-import" ? details?.importId : null;
        if (importId) db.prepare("UPDATE uwm_operations SET state='Rejected',updatedAt=? WHERE id=? AND state IN ('Prepared','Dispatching','Unknown','Acknowledged')").run(now, importId);
      }
      result = { message: "Lender verification recorded. This is a staff attestation; it does not replace UWM's completion notification.", outcome: input.outcome };
    } else if (input.action === "prepare-import") {
      const associations = await api.brokerAssociations();
      requireUwmBranchContact(associations.body, input.scan);
      if (input.scan.alternativeContactId) {
        const alternatives = await api.alternativeContacts(input.scan.entityId);
        const contacts = z.array(z.object({ contactId: z.number().int() })).parse(alternatives.body);
        if (!contacts.some(contact => String(contact.contactId) === input.scan.alternativeContactId)) throw new UwmError("Choose an alternative contact returned by this UWM branch.");
      }
      reviewed(db, input);
      prepareUwmOperation(db, staff, { id: input.id, loanId: input.loanId, applicationRevision: input.applicationRevision, environment, kind: "import", requestDigest: digest });
      beforeSend();
      const transaction = await api.createTransaction();
      bindUwmTransaction(db, input.id, transaction.transactionId);
      await registerTransaction?.(input.id, transaction.transactionId);
      beforeSend();
      const bytes = new TextEncoder().encode(input.xml);
      await api.uploadXml(transaction.uri, bytes, uwmRequestDigest(bytes));
      beforeSend();
      const scan = await api.scanTransaction(transaction.transactionId, input.scan);
      db.prepare("INSERT INTO uwm_import_checks(operationId,scan,ready) VALUES(?,?,?)").run(input.id, JSON.stringify(scan.body), scan.readyToCommit ? 1 : 0);
      result = { importId: input.id, transactionId: transaction.transactionId, readyToCommit: scan.readyToCommit, scan: scan.body.data };
    } else if (input.action === "amend-import") {
      const current = importCheck(db, staff, input, environment);
      if (input.values.length !== current.scan.data.fields.length) throw new UwmError("The UWM fields changed. Reload the import review.");
      const fields = current.scan.data.fields.map((field, index) => ({ ...field, value: input.values[index] }));
      beforeSend();
      const scan = await api.amendTransaction(current.transactionId, { transferStatus: current.scan.data.transferStatus, fields });
      db.prepare("UPDATE uwm_import_checks SET scan=?,ready=? WHERE operationId=?").run(JSON.stringify(scan.body), scan.readyToCommit ? 1 : 0, input.importId);
      result = { importId: input.importId, readyToCommit: scan.readyToCommit, scan: scan.body.data };
    } else if (input.action === "commit-import") {
      const current = importCheck(db, staff, input, environment);
      if (!current.check.ready) throw new UwmError("Resolve the UWM import checks before submitting this file.");
      await registerTransaction?.(input.importId, current.transactionId);
      beforeSend();
      db.transaction(() => {
        db.prepare("UPDATE uwm_import_checks SET committed=1 WHERE operationId=?").run(input.importId);
        db.prepare("UPDATE uwm_operations SET state='Dispatching',updatedAt=? WHERE id=?").run(now, input.importId);
      });
      await api.commitTransaction(current.transactionId);
      db.prepare("UPDATE uwm_operations SET state='Acknowledged',updatedAt=? WHERE id=? AND state='Dispatching'").run(new Date().toISOString(), input.importId);
      result = { importId: input.importId, message: "UWM accepted the import request. Waiting for its completion notification." };
    } else {
      const number = linkedLoan(db, input.loanId, environment);
      if (input.action === "upload-document") {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content)) throw new UwmError("Document encoding is invalid.");
        const bytes = new Uint8Array(Buffer.from(input.content, "base64"));
        if (!bytes.length) throw new UwmError("The document is empty.");
        beforeSend();
        const target = await api.createConditionUpload(number, input.fileName);
        // Save the lender document reference before the binary request, including
        // when upload completion becomes uncertain. Never persist the SAS token.
        db.prepare("UPDATE uwm_live_requests SET result=? WHERE id=?").run(JSON.stringify({ documentId: target.documentId, fileName: target.fileName }), input.id);
        beforeSend();
        await api.uploadConditionBytes(target.sasUri, bytes, uwmRequestDigest(bytes));
        const held = await api.listConditionDocuments(number);
        if (!held.body.documents.some(doc => doc.documentId === target.documentId)) throw new UwmRequestError("The uploaded document is not yet visible in UWM. Reconcile before retrying.", null, "unknown");
        result = { documentId: target.documentId, fileName: target.fileName, message: "Document held by UWM. Attach and submit it for underwriting review." };
      } else if (input.action === "attach-documents") {
        const held = await api.listConditionDocuments(number), current = await api.listConditionAttachments(number);
        for (const attachment of input.body.attachments) {
          if (attachment.files.some(file => !held.body.documents.some(doc => doc.documentId === file.documentId))) throw new UwmError("Choose documents held on this UWM loan.");
          if (attachment.attachmentId) {
            const match = current.body.attachments.find(item => item.attachmentId === attachment.attachmentId);
            if (!match || match.revisionId !== attachment.revisionId || match.SubmittedDateTime) throw new UwmError("This attachment changed or was already submitted. Refresh before editing.");
          }
        }
        beforeSend();
        result = (await api.attachConditions(number, input.body)).body;
      } else if (input.action === "submit-documents") {
        const current = await api.listConditionAttachments(number);
        if (new Set(input.attachments.map(item => item.attachmentId)).size !== input.attachments.length) throw new UwmError("Select each attachment only once.");
        const attachments = input.attachments.map(selected => {
          const match = current.body.attachments.find(item => item.attachmentId === selected.attachmentId);
          if (!match || match.revisionId !== selected.revisionId || match.SubmittedDateTime) throw new UwmError("This attachment changed or was already submitted. Refresh before sending.");
          return { documentType: match.documentType, comments: match.comments, files: match.files, conditions: match.conditions };
        });
        beforeSend();
        result = (await api.submitConditions(number, { attachments })).body;
      } else {
        // Product terms are explicit, schema-checked user choices. No defaults,
        // pricing substitutions or automatic retries are introduced here.
        if (input.action === "lock" && !db.prepare("SELECT id FROM uwm_live_requests WHERE loanId=? AND environment=? AND action='float' AND state='Acknowledged'").get(input.loanId, environment)) {
          throw new UwmError("Float the selected product before requesting a lock.");
        }
        if (db.prepare("SELECT id FROM uwm_live_requests WHERE loanId=? AND environment=? AND action IN ('lock','relock','extend-lock','cancel-lock') AND state='Acknowledged'").get(input.loanId, environment)) {
          throw new UwmError("Verify the earlier rate request in UWM and record its outcome before changing the rate again.");
        }
        beforeSend();
        if (input.action === "float") result = (await api.float(number, input.body)).body;
        else if (input.action === "lock") result = (await api.lock(number, input.body)).body;
        else if (input.action === "relock") result = (await api.relock(number, input.body)).body;
        else if (input.action === "extend-lock") result = (await api.extendLock(number, input.body)).body;
        else result = (await api.cancelLock(number)).body;
      }
    }
    db.prepare("UPDATE uwm_live_requests SET state='Acknowledged',result=?,updatedAt=? WHERE id=? AND state='Dispatching'").run(JSON.stringify(result), new Date().toISOString(), input.id);
    return requestResult(db.prepare("SELECT id,state,result FROM uwm_live_requests WHERE id=?").get(input.id)!);
  } catch (error) {
    // A multi-step action may already have created a transaction or document.
    // Even a later 4xx cannot make that whole workflow safe to replay.
    const state = sent ? "Unknown" : "Rejected";
    db.prepare("UPDATE uwm_live_requests SET state=?,updatedAt=? WHERE id=? AND state='Dispatching'").run(state, new Date().toISOString(), input.id);
    if (input.action === "commit-import" && sent) db.prepare("UPDATE uwm_operations SET state='Unknown',updatedAt=? WHERE id=? AND state='Dispatching'").run(new Date().toISOString(), input.importId);
    const recorded = requestResult(db.prepare("SELECT id,state,result FROM uwm_live_requests WHERE id=?").get(input.id)!);
    if (recorded.state !== state) return recorded;
    return { id: input.id, state, error: sent ? "UWM has not confirmed the full outcome. Check the lender file before taking another action."
      : error instanceof UwmError ? error.message : "The UWM request could not be validated." };
  }
}

export async function readUwmFile(db: Store, env: UwmEnvironment, staff: WorkspaceStaff, raw: unknown) {
  const input = z.strictObject({ loanId: z.uuid(), view: z.enum(["activity", "documents", "products"]), body: uwmProductSearch.optional() }).parse(raw);
  const environment = context(db, env, staff, input.loanId);
  recoverSavedImportReceipt(db, input.loanId, environment);
  if (input.view === "activity") return {
    uploads: { xml: Boolean(env.UWM_STORAGE_ORIGIN), documents: Boolean(env.UWM_DOCUMENT_STORAGE_ORIGIN) },
    imports: db.prepare(`SELECT op.id,op.actor,op.applicationRevision,op.state,op.transactionId,op.lenderLoanNumber,checks.scan,checks.ready,checks.committed
      FROM uwm_operations op LEFT JOIN uwm_import_checks checks ON checks.operationId=op.id
      WHERE op.loanId=? AND op.environment=? AND op.kind='import' ORDER BY op.startedAt DESC LIMIT 20`).all(input.loanId, environment),
    requests: db.prepare("SELECT id,action,state,createdAt,updatedAt FROM uwm_live_requests WHERE loanId=? AND environment=? ORDER BY createdAt DESC LIMIT 50").all(input.loanId, environment),
  };
  const number = linkedLoan(db, input.loanId, environment), api = uwmPublicClient(db, env, staff);
  if (input.view === "products") {
    if (!input.body) throw new UwmError("Choose pricing options first.");
    return (await api.searchProducts(number, input.body)).body;
  }
  const documents = await api.listConditionDocuments(number), attachments = await api.listConditionAttachments(number);
  return { ...documents.body, ...attachments.body };
}
