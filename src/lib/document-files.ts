import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { addApplicationActivity } from "./applications";
import { coBorrowerDocumentRecipient, needsBorrowerDocument, primaryDocumentRecipient, type DocumentKind, type DocumentStatus } from "./document-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent, loanAccess } from "./workspace-access";
import type { DocumentUploadMode } from "./document-files-model";

const minute = 60_000;
const uploadLease = 2 * minute;
const emailAddress = z.email().max(254);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const verificationToken = (token: string, mode: DocumentUploadMode) => mode === "mock" ? `mock:${token}` : token;
const verificationEmail = (email: string, mode: DocumentUploadMode) => mode === "mock" ? "borrower@example.test" : email;
const issueHash = (secret: string, token: string, email: string, code: string) =>
  createHmac("sha256", secret).update(JSON.stringify([token, email, code])).digest("hex");
const failure = (status: number, error: string) => ({ status, error });
const inactive = () => failure(404, "This borrower link is unavailable. Ask your loan officer for a new link.");
const unverified = () => failure(401, "Verify your email before uploading a PDF.");

function application(db: Store, token: string, mode: DocumentUploadMode, now: number) {
  const at = new Date(now).toISOString();
  const row = db.prepare(`SELECT a.loanId, contacts.email FROM applications a JOIN loans ON loans.id = a.loanId
    JOIN contacts ON contacts.id = loans.contactId
    WHERE a.token = ? AND a.expiresAt > ? AND a.revokedAt IS NULL AND a.submittedAt IS NOT NULL`).get(token, at);
  if (row) return { loanId: String(row.loanId), email: String(row.email).trim().toLowerCase(), recipient: primaryDocumentRecipient };
  if (mode !== "mock") return null;
  const co = db.prepare(`SELECT joint.loanId FROM joint_applications joint JOIN applications app ON app.loanId = joint.loanId
    WHERE joint.token = ? AND joint.expiresAt > ? AND joint.revokedAt IS NULL AND joint.submittedAt IS NOT NULL
    AND app.submittedAt IS NOT NULL`).get(token, at);
  return co ? { loanId: String(co.loanId), email: "", recipient: coBorrowerDocumentRecipient } : null;
}

export function issueDocumentCode(db: Store, token: string, secret: string, mode: DocumentUploadMode, now = Date.now()) {
  return db.transaction(() => {
    const borrower = application(db, token, mode, now);
    if (!borrower) return inactive();
    const email = verificationEmail(borrower.email, mode);
    const scope = verificationToken(token, mode);
    if (!emailAddress.safeParse(email).success) return failure(409, "Ask your loan officer to add your email to the loan before uploading.");
    const previous = db.prepare("SELECT sendWindow, sendCount, sentAt FROM borrower_upload_access WHERE loanId = ? AND recipient = ?")
      .get(borrower.loanId, borrower.recipient);
    const inWindow = previous && Number(previous.sendWindow) + 60 * minute > now;
    if ((previous && Number(previous.sentAt) + minute > now) || (inWindow && Number(previous.sendCount) >= 5)) {
      return failure(429, "A verification code was requested recently. Try again later.");
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    db.prepare(`INSERT INTO borrower_upload_access (loanId,recipient,tokenHash,email,codeHash,codeUntil,sendWindow,sendCount,sentAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(loanId,recipient) DO UPDATE SET tokenHash = excluded.tokenHash,
      email = excluded.email, codeHash = excluded.codeHash, codeUntil = excluded.codeUntil, sendWindow = excluded.sendWindow,
      sendCount = excluded.sendCount, sentAt = excluded.sentAt, attempts = 0, sessionHash = NULL, sessionUntil = 0`)
      .run(borrower.loanId, borrower.recipient, digest(scope), email, issueHash(secret, scope, email, code),
        now + 10 * minute, inWindow ? Number(previous.sendWindow) : now, inWindow ? Number(previous.sendCount) + 1 : 1, now);
    return { email, code };
  });
}

export function verifyDocumentCode(db: Store, token: string, code: string, secret: string, mode: DocumentUploadMode, now = Date.now()) {
  return db.transaction(() => {
    const borrower = application(db, token, mode, now);
    if (!borrower) return inactive();
    const email = verificationEmail(borrower.email, mode);
    const scope = verificationToken(token, mode);
    const access = db.prepare(`SELECT codeHash, codeUntil, attempts FROM borrower_upload_access
      WHERE loanId = ? AND recipient = ? AND tokenHash = ? AND email = ?`).get(borrower.loanId, borrower.recipient, digest(scope), email);
    if (typeof access?.codeHash !== "string" || Number(access.codeUntil) <= now || Number(access.attempts) >= 5) {
      return failure(409, "Request a new verification code.");
    }
    if (!timingSafeEqual(Buffer.from(access.codeHash, "hex"), Buffer.from(issueHash(secret, scope, email, code), "hex"))) {
      db.prepare("UPDATE borrower_upload_access SET attempts = attempts + 1 WHERE loanId = ? AND recipient = ?").run(borrower.loanId, borrower.recipient);
      return failure(400, "That verification code did not match.");
    }
    const session = randomBytes(32).toString("base64url");
    db.prepare("UPDATE borrower_upload_access SET codeHash = NULL, sessionHash = ?, sessionUntil = ? WHERE loanId = ? AND recipient = ?")
      .run(digest(session), now + 30 * minute, borrower.loanId, borrower.recipient);
    return { session };
  });
}

export type UploadAccess = { token: string; session: string; requestId: string; revision: number; mode: DocumentUploadMode };

function uploadRequest(db: Store, input: UploadAccess, now: number) {
  const borrower = application(db, input.token, input.mode, now);
  if (!borrower) return inactive();
  if (!db.prepare(`SELECT 1 FROM borrower_upload_access WHERE loanId = ? AND recipient = ? AND tokenHash = ? AND email = ?
    AND sessionHash = ? AND sessionUntil > ?`).get(borrower.loanId, borrower.recipient, digest(verificationToken(input.token, input.mode)),
      verificationEmail(borrower.email, input.mode), digest(input.session), now)) return unverified();
  const item = db.prepare("SELECT kind, status, revision FROM document_requests WHERE id = ? AND loanId = ? AND recipient = ?")
    .get(input.requestId, borrower.loanId, borrower.recipient);
  if (!item) return failure(404, "This document request is unavailable.");
  if (item.revision !== input.revision || !needsBorrowerDocument(item.status as DocumentStatus)) {
    return failure(409, "This request changed. Refresh your checklist before uploading.");
  }
  return { loanId: borrower.loanId, recipient: borrower.recipient, kind: item.kind as DocumentKind, replacement: item.status === "Needs replacement" };
}

export function beginDocumentUpload(db: Store, input: UploadAccess, now = Date.now()) {
  return db.transaction(() => {
    const item = uploadRequest(db, input, now);
    if ("error" in item) return item;
    const file = db.prepare("SELECT pendingUntil, attemptedAt FROM document_files WHERE requestId = ?").get(input.requestId);
    if (file && Number(file.pendingUntil) > now) return failure(409, "This PDF is already processing.");
    if (file && Number(file.attemptedAt) + (input.mode === "mock" ? 1_000 : 10_000) > now) return failure(429, "Wait a moment before retrying the upload.");
    const objectId = crypto.randomUUID();
    db.prepare(`INSERT INTO document_files (requestId,pendingId,pendingUntil,attemptedAt) VALUES (?, ?, ?, ?)
      ON CONFLICT(requestId) DO UPDATE SET pendingId = excluded.pendingId, pendingUntil = excluded.pendingUntil,
      attemptedAt = excluded.attemptedAt, failed = 0`).run(input.requestId, objectId, now + uploadLease, now);
    return { objectId };
  });
}

export function finishDocumentUpload(db: Store, input: UploadAccess, objectId: string, now = Date.now()) {
  return db.transaction(() => {
    const item = uploadRequest(db, input, now);
    if ("error" in item) return item;
    const pending = db.prepare("SELECT 1 FROM document_files WHERE requestId = ? AND pendingId = ? AND pendingUntil > ?").get(input.requestId, objectId, now);
    if (!pending) return failure(409, "The upload expired. Refresh your checklist and try again.");
    const at = new Date(now).toISOString();
    db.prepare(`UPDATE document_files SET objectId = ?, uploadedAt = ?, uploadMode = ?, pendingId = NULL, pendingUntil = NULL, failed = 0 WHERE requestId = ?`)
      .run(objectId, at, input.mode, input.requestId);
    db.prepare("UPDATE document_requests SET status = 'Received', submittedAt = ?, revision = revision + 1 WHERE id = ?").run(at, input.requestId);
    const action = input.mode === "mock" ? (item.replacement ? "Replacement demo PDF received" : "Demo PDF received")
      : item.replacement ? "Replacement PDF received" : "Borrower PDF received";
    const actor = item.recipient === coBorrowerDocumentRecipient ? item.recipient : "Borrower";
    addApplicationActivity(db, item.loanId, `${action} · ${item.kind}${actor === "Borrower" ? "" : ` · ${actor}`}`, at);
    accessEvent(db, { email: actor, name: actor }, action, input.requestId, at);
    return { received: true };
  });
}

export function failDocumentUpload(db: Store, requestId: string, objectId: string) {
  db.transaction(() => {
    db.prepare("UPDATE document_files SET pendingId = NULL, pendingUntil = NULL, failed = 1 WHERE requestId = ? AND pendingId = ?").run(requestId, objectId);
    db.prepare(`INSERT OR IGNORE INTO document_file_cleanup SELECT ? WHERE NOT EXISTS
      (SELECT 1 FROM document_files WHERE objectId = ? OR pendingId = ?)`).run(objectId, objectId, objectId);
  });
}

export function downloadableDocument(db: Store, staff: WorkspaceStaff, requestId: string, evidenceId?: string, acceptedRevision?: number) {
  if (evidenceId && acceptedRevision !== undefined) return null;
  const item = acceptedRevision !== undefined ? db.prepare(`SELECT retained.objectId, request.loanId, request.kind FROM document_accepted_files retained
    JOIN document_requests request ON request.id = retained.requestId WHERE retained.requestId = ? AND retained.revision = ?`).get(requestId, acceptedRevision) :
    evidenceId ? db.prepare(`SELECT evidence.objectId, request.loanId, evidence.kind FROM condition_document_sources evidence
    JOIN document_requests request ON request.id = evidence.requestId
    WHERE evidence.id = ? AND request.id = ? AND evidence.objectId IS NOT NULL`).get(evidenceId, requestId) :
    db.prepare(`SELECT files.objectId, requests.loanId, requests.kind FROM document_files files
    JOIN document_requests requests ON requests.id = files.requestId
    WHERE requests.id = ? AND files.objectId IS NOT NULL`).get(requestId);
  return item && loanAccess(db, staff, String(item.loanId))
    ? { objectId: String(item.objectId), loanId: String(item.loanId), kind: item.kind as DocumentKind } : null;
}

export function recordDocumentDownload(db: Store, staff: WorkspaceStaff, requestId: string, objectId: string, evidenceId?: string, acceptedRevision?: number) {
  return db.transaction(() => {
    const item = downloadableDocument(db, staff, requestId, evidenceId, acceptedRevision);
    if (!item || item.objectId !== objectId) return false;
    const now = new Date().toISOString();
    const revisionLabel = acceptedRevision !== undefined ? `Accepted document revision ${acceptedRevision} downloaded` :
      evidenceId ? "Linked evidence revision downloaded" : "Borrower PDF downloaded";
    accessEvent(db, staff, revisionLabel, evidenceId ?? requestId, now);
    addApplicationActivity(db, item.loanId, `${revisionLabel} · ${item.kind}`, now);
    return true;
  });
}

export function documentCleanupBatch(db: Store, now = Date.now()) {
  db.prepare("UPDATE document_files SET pendingId = NULL, pendingUntil = NULL, failed = 1 WHERE pendingUntil <= ?").run(now);
  db.prepare("UPDATE lead_document_requests SET pendingId = NULL, pendingUntil = NULL, failed = 1 WHERE pendingUntil <= ?").run(now);
  return db.prepare("SELECT objectId FROM document_file_cleanup LIMIT 100").all().map((row) => String(row.objectId));
}

export function nextDocumentCleanup(db: Store, now = Date.now()) {
  if (db.prepare("SELECT 1 FROM document_file_cleanup LIMIT 1").get()) return now + minute;
  const lease = db.prepare(`SELECT min(due) AS due FROM (
    SELECT min(pendingUntil) AS due FROM document_files UNION ALL SELECT min(pendingUntil) FROM lead_document_requests)`).get()?.due;
  return typeof lease === "number" ? Math.max(now + 1000, lease) : null;
}
