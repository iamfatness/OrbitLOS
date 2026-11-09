import { createHash } from "node:crypto";
import { portalBrokerage } from "./brokerage-model";
import { pdfColumns } from "./document-files-model";
import { needsBorrowerDocument, type DocumentKind, type DocumentRequest, type DocumentStatus } from "./document-model";
import { leadDocumentPortalUnavailable, leadDocumentStaffInput, leadDocumentsUnavailable,
  type LeadDocumentLocation, type LeadDocumentPage, type LeadSampleUpload } from "./lead-document-model";
import { leadEvent } from "./lead-inbox";
import type { PilotPortalLink, ProtectPilotLinks } from "./pilot";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent, loanAccess } from "./workspace-access";

const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");
const unavailable = { status: 404, error: leadDocumentPortalUnavailable };
const changed = "This lead document changed. Refresh the checklist and try again.";
const openLeadSql = "lead.resolvedAt IS NULL AND lead.officerEmail IS NOT NULL";
const access = (db: Store, staff: WorkspaceStaff, leadId: string) => {
  if (!staff.brokerage.pilot || staff.brokerage.role === "Processor") return undefined;
  return db.prepare(`SELECT lead.heldAt FROM referral_leads lead WHERE lead.id = ? AND ${openLeadSql}
    AND (? = 'Admin' OR lead.officerEmail = ?)`).get(leadId, staff.brokerage.role, staff.email);
};

function requests(db: Store, leadId: string, clock: number): DocumentRequest[] {
  return db.prepare(`SELECT id, kind, instructions, status, replacementNote, submittedAt, dueOn, revision, ${pdfColumns(clock)}
    FROM lead_document_requests files WHERE leadId = ? ORDER BY requestedAt, rowid`).all(leadId).map((row) => ({ ...row }) as unknown as DocumentRequest);
}

function activeLink(db: Store, leadId: string, now: string) {
  return db.prepare(`SELECT id, tokenHash, codeHash, expiresAt, createdBy, createdAt FROM lead_document_links
    WHERE leadId = ? AND revokedAt IS NULL AND expiresAt > ? ORDER BY rowid DESC LIMIT 1`).get(leadId, now);
}

export async function leadDocumentWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  uploadsEnabled: boolean, protectLinks?: ProtectPilotLinks, clock = new Date()): Promise<LeadDocumentPage | { location: LeadDocumentLocation } | { error: string }> {
  const parsed = leadDocumentStaffInput.safeParse(input);
  if (!parsed.success) return { error: "Check the document type, instructions, and link details." };
  const data = parsed.data;
  const { leadId } = data;
  if (!staff || staff.brokerage.id !== brokerageId) return { error: leadDocumentsUnavailable };
  if (data.type === "locate") {
    if (!staff.brokerage.pilot || staff.brokerage.role === "Processor") return { error: leadDocumentsUnavailable };
    const lead = access(db, staff, leadId);
    if (lead && !lead.heldAt && db.prepare("SELECT 1 FROM lead_document_requests WHERE leadId = ? AND id = ?").get(leadId, data.requestId)) {
      return { location: { kind: "lead", recordId: leadId } };
    }
    const converted = db.prepare(`SELECT lead.loanId FROM referral_leads lead
      JOIN document_requests request ON request.loanId = lead.loanId
      WHERE lead.id = ? AND lead.resolvedAt IS NOT NULL AND request.id = ?`).get(leadId, data.requestId);
    if (typeof converted?.loanId === "string" && loanAccess(db, staff, converted.loanId)) {
      return { location: { kind: "loan", recordId: converted.loanId } };
    }
    return { error: "This document request is no longer available. Refresh My Tasks." };
  }
  if (!access(db, staff, leadId)) return { error: leadDocumentsUnavailable };
  const now = clock.toISOString();
  if (data.type === "revoke" && protectLinks) {
    const link = activeLink(db, leadId, now);
    if (link?.id === data.linkId && !await protectLinks([{ tokenHash: String(link.tokenHash), expiresAt: String(link.expiresAt) }])) {
      return { error: "Orbit could not protect the link change. Try revoking it again." };
    }
  }
  return db.transaction(() => {
    const lead = access(db, staff, leadId);
    if (!lead) return { error: leadDocumentsUnavailable };
    const page = () => {
      const link = activeLink(db, leadId, now);
      const items = requests(db, leadId, clock.getTime());
      return { requests: items, link: link ? { id: String(link.id), expiresAt: String(link.expiresAt) } : null,
        canRequest: !lead.heldAt, canIssue: uploadsEnabled && !lead.heldAt && items.length > 0 };
    };
    const log = (text: string) => {
      leadEvent(db, leadId, staff.name, now, text);
      accessEvent(db, staff, text, leadId, now);
    };
    if (data.type === "read") return page();
    if (lead.heldAt && data.type !== "revoke") return { error: "Reactivate the lead before requesting or reviewing sample documents." };
    if (data.type === "request") {
      const existing = db.prepare("SELECT id, instructions, dueOn FROM lead_document_requests WHERE leadId = ? AND kind = ?").get(leadId, data.kind);
      if (existing) return existing.id === data.requestId && existing.instructions === data.instructions && existing.dueOn === data.dueOn
        ? { ...page(), message: "Sample request is already on the lead." } : { error: "This document is already on the lead checklist." };
      if (db.prepare("SELECT 1 FROM lead_document_requests WHERE id = ? UNION ALL SELECT 1 FROM document_requests WHERE id = ?").get(data.requestId, data.requestId)) {
        return { error: "Start a new document request." };
      }
      db.prepare("INSERT INTO lead_document_requests (id, leadId, kind, instructions, requestedAt, dueOn) VALUES (?, ?, ?, ?, ?, ?)")
        .run(data.requestId, leadId, data.kind, data.instructions, now, data.dueOn);
      log(`Requested sample lead document · ${data.kind}`);
      return { ...page(), message: "Sample document requested." };
    }
    if (data.type === "issue") {
      if (!page().canIssue || portalBrokerage(data.token) !== brokerageId) return { error: "Add a sample request and enable mock uploads before issuing a link." };
      const tokenHash = hash(data.token);
      const codeHash = hash(data.code);
      const existing = activeLink(db, leadId, now);
      if (existing) return existing.id === data.linkId && existing.tokenHash === tokenHash && existing.codeHash === codeHash &&
        existing.createdBy === staff.email && Date.parse(String(existing.expiresAt)) - Date.parse(String(existing.createdAt)) === data.hours * 3_600_000
        ? { ...page(), createdId: data.linkId, message: "Sample document link issued." }
        : { error: "Revoke the current link before issuing another one." };
      if (db.prepare("SELECT 1 FROM lead_document_links WHERE id = ? OR tokenHash = ?").get(data.linkId, tokenHash)) return { error: "Start a new sample document link." };
      const expiresAt = new Date(clock.getTime() + data.hours * 3_600_000).toISOString();
      db.prepare("INSERT INTO lead_document_links (id, leadId, tokenHash, codeHash, createdBy, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(data.linkId, leadId, tokenHash, codeHash, staff.email, now, expiresAt);
      log("Issued sample lead document link");
      return { ...page(), createdId: data.linkId, message: "Sample document link issued." };
    }
    if (data.type === "revoke") {
      const row = db.prepare(`UPDATE lead_document_links SET revokedAt = ? WHERE id = ? AND leadId = ? AND revokedAt IS NULL RETURNING id`)
        .get(now, data.linkId, leadId);
      if (row) log("Revoked sample lead document link");
      else if (!db.prepare("SELECT 1 FROM lead_document_links WHERE id = ? AND leadId = ?").get(data.linkId, leadId)) {
        return { error: "This link is no longer available on the lead." };
      }
      return { ...page(), message: "Sample document link revoked." };
    }
    const item = db.prepare("SELECT kind, status, revision, objectId, replacementNote FROM lead_document_requests WHERE leadId = ? AND id = ?")
      .get(leadId, data.requestId);
    const note = data.decision === "Needs replacement" ? data.replacementNote : "";
    if (!item || !item.objectId) return { error: changed };
    if (item.revision === data.revision + 1 && item.status === data.decision && item.replacementNote === note) return { ...page(), message: "Sample document review is up to date." };
    if (item.revision !== data.revision || item.status !== "Received") return { error: changed };
    if (data.decision === "Needs replacement" && !note) return { error: "Explain what sample document to replace." };
    db.prepare("UPDATE lead_document_requests SET status = ?, replacementNote = ?, revision = revision + 1 WHERE id = ?")
      .run(data.decision, note, data.requestId);
    log(`${data.decision === "Accepted" ? "Accepted sample lead document" : "Requested sample lead document replacement"} · ${item.kind}`);
    return { ...page(), message: data.decision === "Accepted" ? "Sample document accepted." : "Replacement requested." };
  });
}

function portalLead(db: Store, { token, code }: Pick<LeadSampleUpload, "token" | "code">, now: number) {
  const row = db.prepare(`SELECT lead.id FROM lead_document_links link JOIN referral_leads lead ON lead.id = link.leadId
    WHERE link.tokenHash = ? AND link.codeHash = ? AND link.revokedAt IS NULL AND link.expiresAt > ?
      AND ${openLeadSql} AND lead.heldAt IS NULL`).get(hash(token), hash(code), new Date(now).toISOString());
  return typeof row?.id === "string" ? row.id : null;
}

export function readLeadDocumentPortal(db: Store, input: Pick<LeadSampleUpload, "token" | "code">, now = Date.now()) {
  const leadId = portalLead(db, input, now);
  return leadId ? { value: { requests: requests(db, leadId, now) } } : unavailable;
}

function uploadRequest(db: Store, input: LeadSampleUpload, now: number) {
  const leadId = portalLead(db, input, now);
  if (!leadId) return unavailable;
  const row = db.prepare("SELECT * FROM lead_document_requests WHERE leadId = ? AND id = ?").get(leadId, input.requestId);
  if (!row) return unavailable;
  if (row.revision !== input.revision || !needsBorrowerDocument(row.status as DocumentStatus)) return { status: 409, error: changed };
  return { row, leadId };
}

export function beginLeadSample(db: Store, input: LeadSampleUpload, now = Date.now()) {
  return db.transaction(() => {
    const result = uploadRequest(db, input, now);
    if ("error" in result) return result;
    if (Number(result.row.pendingUntil) > now) return { status: 409, error: "This sample PDF is already processing." };
    if (Number(result.row.attemptedAt) + 1_000 > now) return { status: 429, error: "Wait a moment before retrying the sample upload." };
    const objectId = crypto.randomUUID();
    db.prepare("UPDATE lead_document_requests SET pendingId = ?, pendingUntil = ?, attemptedAt = ?, failed = 0 WHERE id = ?")
      .run(objectId, now + 120_000, now, input.requestId);
    return { objectId };
  });
}

export function finishLeadSample(db: Store, input: LeadSampleUpload, objectId: string, now = Date.now()) {
  return db.transaction(() => {
    const result = uploadRequest(db, input, now);
    if ("error" in result) return result;
    if (result.row.pendingId !== objectId || Number(result.row.pendingUntil) <= now) return { status: 409, error: "This sample upload expired. Try again." };
    const at = new Date(now).toISOString();
    db.prepare(`UPDATE lead_document_requests SET objectId = ?, uploadedAt = ?, pendingId = NULL, pendingUntil = NULL, failed = 0,
      status = 'Received', submittedAt = ?, revision = revision + 1 WHERE id = ?`).run(objectId, at, at, input.requestId);
    leadEvent(db, result.leadId, "Borrower", at, `Received sample lead document · ${result.row.kind}`);
    return { received: true };
  });
}

export function failLeadSample(db: Store, requestId: string, objectId: string) {
  db.transaction(() => {
    db.prepare("UPDATE lead_document_requests SET pendingId = NULL, pendingUntil = NULL, failed = 1 WHERE id = ? AND pendingId = ?").run(requestId, objectId);
    db.prepare(`INSERT OR IGNORE INTO document_file_cleanup SELECT ? WHERE NOT EXISTS (
      SELECT 1 FROM lead_document_requests WHERE objectId = ? OR pendingId = ?
      UNION ALL SELECT 1 FROM document_files WHERE objectId = ?)`).run(objectId, objectId, objectId, objectId);
  });
}

export function downloadableLeadDocument(db: Store, staff: WorkspaceStaff, requestId: string) {
  const row = db.prepare("SELECT leadId, objectId, kind FROM lead_document_requests WHERE id = ? AND objectId IS NOT NULL").get(requestId);
  return row && access(db, staff, String(row.leadId)) ? { leadId: String(row.leadId), objectId: String(row.objectId), kind: row.kind as DocumentKind } : null;
}

export function recordLeadDocumentDownload(db: Store, staff: WorkspaceStaff, requestId: string, objectId: string) {
  return db.transaction(() => {
    const current = downloadableLeadDocument(db, staff, requestId);
    if (!current || current.objectId !== objectId) return false;
    accessEvent(db, staff, "Downloaded sample lead PDF", requestId, new Date().toISOString());
    return true;
  });
}

export function carryLeadDocuments(db: Store, leadId: string, loanId: string, at: string) {
  if (db.prepare("SELECT 1 FROM lead_document_requests WHERE leadId = ? AND pendingUntil > ?").get(leadId, Date.parse(at))) return null;
  const count = db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, dueOn, status, replacementNote, submittedAt, revision)
    SELECT id, ?, kind, instructions, requestedAt, dueOn, status, replacementNote, submittedAt, revision FROM lead_document_requests
    WHERE leadId = ? RETURNING id`).all(loanId, leadId).length;
  db.prepare(`INSERT INTO document_files (requestId, objectId, uploadedAt, attemptedAt, failed, uploadMode)
    SELECT id, objectId, uploadedAt, attemptedAt, failed OR pendingId IS NOT NULL, CASE WHEN objectId IS NOT NULL THEN 'mock' END
    FROM lead_document_requests WHERE leadId = ? AND (objectId IS NOT NULL OR failed = 1 OR pendingId IS NOT NULL)`).run(leadId);
  db.prepare("DELETE FROM lead_document_requests WHERE leadId = ?").run(leadId);
  db.prepare("UPDATE lead_document_links SET revokedAt = ? WHERE leadId = ? AND revokedAt IS NULL").run(at, leadId);
  if (count) leadEvent(db, leadId, "Orbit", at, `Moved ${count} sample document ${count === 1 ? "request" : "requests"} to the loan checklist.`);
  return count;
}

export function convertedLeadLinkHashes(db: Store, leadId: string, loanId: string, at = new Date().toISOString()): PilotPortalLink[] {
  return db.prepare(`SELECT link.tokenHash, link.expiresAt FROM lead_document_links link JOIN referral_leads lead ON lead.id = link.leadId
    WHERE lead.id = ? AND lead.loanId = ? AND link.expiresAt > ? AND link.revokedAt = lead.resolvedAt`).all(leadId, loanId, at)
    .map(({ tokenHash, expiresAt }) => ({ tokenHash: String(tokenHash), expiresAt: String(expiresAt) }));
}
