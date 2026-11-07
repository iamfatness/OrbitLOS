import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { addApplicationActivity } from "./applications";
import { needsBorrowerDocument, type DocumentKind, type DocumentStatus } from "./document-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";
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

function application(db: Store, token: string, now: number) {
  const row = db.prepare(`SELECT a.loanId, contacts.email FROM applications a JOIN loans ON loans.id = a.loanId
    JOIN contacts ON contacts.id = loans.contactId
    WHERE a.token = ? AND a.expiresAt > ? AND a.revokedAt IS NULL AND a.submittedAt IS NOT NULL`).get(token, new Date(now).toISOString());
  return row ? { loanId: String(row.loanId), email: String(row.email).trim().toLowerCase() } : null;
}

export function issueDocumentCode(db: Store, token: string, secret: string, mode: DocumentUploadMode, now = Date.now()) {
  return db.transaction(() => {
    const borrower = application(db, token, now);
    if (!borrower) return inactive();
    const email = verificationEmail(borrower.email, mode);
    const scope = verificationToken(token, mode);
    if (!emailAddress.safeParse(email).success) return failure(409, "Ask your loan officer to add your email to the loan before uploading.");
    const previous = db.prepare("SELECT sendWindow, sendCount, sentAt FROM borrower_upload_access WHERE loanId = ?").get(borrower.loanId);
    const inWindow = previous && Number(previous.sendWindow) + 60 * minute > now;
    if ((previous && Number(previous.sentAt) + minute > now) || (inWindow && Number(previous.sendCount) >= 5)) {
      return failure(429, "A verification code was requested recently. Try again later.");
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    db.prepare(`INSERT INTO borrower_upload_access (loanId,tokenHash,email,codeHash,codeUntil,sendWindow,sendCount,sentAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(loanId) DO UPDATE SET tokenHash = excluded.tokenHash,
      email = excluded.email, codeHash = excluded.codeHash, codeUntil = excluded.codeUntil, sendWindow = excluded.sendWindow,
      sendCount = excluded.sendCount, sentAt = excluded.sentAt, attempts = 0, sessionHash = NULL, sessionUntil = 0`)
      .run(borrower.loanId, digest(scope), email, issueHash(secret, scope, email, code),
        now + 10 * minute, inWindow ? Number(previous.sendWindow) : now, inWindow ? Number(previous.sendCount) + 1 : 1, now);
    return { email, code };
  });
}

export function verifyDocumentCode(db: Store, token: string, code: string, secret: string, mode: DocumentUploadMode, now = Date.now()) {
  return db.transaction(() => {
    const borrower = application(db, token, now);
    if (!borrower) return inactive();
    const email = verificationEmail(borrower.email, mode);
    const scope = verificationToken(token, mode);
    const access = db.prepare(`SELECT codeHash, codeUntil, attempts FROM borrower_upload_access
      WHERE loanId = ? AND tokenHash = ? AND email = ?`).get(borrower.loanId, digest(scope), email);
    if (typeof access?.codeHash !== "string" || Number(access.codeUntil) <= now || Number(access.attempts) >= 5) {
      return failure(409, "Request a new verification code.");
    }
    if (!timingSafeEqual(Buffer.from(access.codeHash, "hex"), Buffer.from(issueHash(secret, scope, email, code), "hex"))) {
      db.prepare("UPDATE borrower_upload_access SET attempts = attempts + 1 WHERE loanId = ?").run(borrower.loanId);
      return failure(400, "That verification code did not match.");
    }
    const session = randomBytes(32).toString("base64url");
    db.prepare("UPDATE borrower_upload_access SET codeHash = NULL, sessionHash = ?, sessionUntil = ? WHERE loanId = ?")
      .run(digest(session), now + 30 * minute, borrower.loanId);
    return { session };
  });
}

export type UploadAccess = { token: string; session: string; requestId: string; revision: number; mode: DocumentUploadMode };

function uploadRequest(db: Store, input: UploadAccess, now: number) {
  const borrower = application(db, input.token, now);
  if (!borrower) return inactive();
  if (!db.prepare(`SELECT 1 FROM borrower_upload_access WHERE loanId = ? AND tokenHash = ? AND email = ?
    AND sessionHash = ? AND sessionUntil > ?`).get(borrower.loanId, digest(verificationToken(input.token, input.mode)),
      verificationEmail(borrower.email, input.mode), digest(input.session), now)) return unverified();
  const item = db.prepare("SELECT kind, status, revision FROM document_requests WHERE id = ? AND loanId = ?").get(input.requestId, borrower.loanId);
  if (!item) return failure(404, "This document request is unavailable.");
  if (item.revision !== input.revision || !needsBorrowerDocument(item.status as DocumentStatus)) {
    return failure(409, "This request changed. Refresh your checklist before uploading.");
  }
  return { loanId: borrower.loanId, kind: item.kind as DocumentKind, replacement: item.status === "Needs replacement" };
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
    db.prepare(`UPDATE document_files SET objectId = ?, uploadedAt = ?, pendingId = NULL, pendingUntil = NULL, failed = 0 WHERE requestId = ?`)
      .run(objectId, at, input.requestId);
    db.prepare("UPDATE document_requests SET status = 'Received', submittedAt = ?, revision = revision + 1 WHERE id = ?").run(at, input.requestId);
    const action = input.mode === "mock" ? (item.replacement ? "Replacement demo PDF received" : "Demo PDF received")
      : item.replacement ? "Replacement PDF received" : "Borrower PDF received";
    addApplicationActivity(db, item.loanId, `${action} · ${item.kind}`, at);
    accessEvent(db, { email: "Borrower", name: "Borrower" }, action, input.requestId, at);
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

export function downloadableDocument(db: Store, staff: WorkspaceStaff, requestId: string) {
  const item = db.prepare(`SELECT files.objectId, requests.loanId, requests.kind FROM document_files files
    JOIN document_requests requests ON requests.id = files.requestId JOIN loans ON loans.id = requests.loanId
    WHERE requests.id = ? AND files.objectId IS NOT NULL AND (? = 'Admin' OR loans.officerEmail = ?)`)
    .get(requestId, staff.brokerage.role, staff.email);
  return item ? { objectId: String(item.objectId), loanId: String(item.loanId), kind: item.kind as DocumentKind } : null;
}

export function recordDocumentDownload(db: Store, staff: WorkspaceStaff, requestId: string, objectId: string) {
  return db.transaction(() => {
    const item = downloadableDocument(db, staff, requestId);
    if (!item || item.objectId !== objectId) return false;
    const now = new Date().toISOString();
    accessEvent(db, staff, "Downloaded borrower PDF", requestId, now);
    addApplicationActivity(db, item.loanId, `Borrower PDF downloaded · ${item.kind}`, now);
    return true;
  });
}

export function documentCleanupBatch(db: Store, now = Date.now()) {
  db.prepare("UPDATE document_files SET pendingId = NULL, pendingUntil = NULL, failed = 1 WHERE pendingUntil <= ?").run(now);
  return db.prepare("SELECT objectId FROM document_file_cleanup LIMIT 100").all().map((row) => String(row.objectId));
}

export function nextDocumentCleanup(db: Store, now = Date.now()) {
  if (db.prepare("SELECT 1 FROM document_file_cleanup LIMIT 1").get()) return now + minute;
  const lease = db.prepare("SELECT MIN(pendingUntil) AS due FROM document_files").get()?.due;
  return typeof lease === "number" ? Math.max(now + 1000, lease) : null;
}
