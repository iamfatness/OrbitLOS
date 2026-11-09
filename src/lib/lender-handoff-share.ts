import { createHash } from "node:crypto";
import type { z } from "zod";
import { approvedSecondReview } from "./application-review-checkpoint";
import { addApplicationActivity } from "./applications";
import { portalBrokerage } from "./brokerage-model";
import { prepareLenderExport } from "./lender-export";
import { lenderPackageUnavailable, lenderShareStaffInput, type LenderPackageManifest, type LenderPackageStatus,
  type LenderSharePage, type PackageDownloadInput, type SharedLenderPackageInput } from "./lender-handoff-share-model";
import type { ProtectPilotLinks } from "./pilot";
import { readPlaybook } from "./playbooks";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { accessEvent, loanAccess } from "./workspace-access";

const staffUnavailable = "Lender packages are available to the loan owner or an admin in a fictional pilot.";
const changedFile = "The reviewed 1003 or selected evidence changed. Refresh the loan and review the current file.";
const unavailable = { status: 404, error: lenderPackageUnavailable };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const cleanPdf = `request.status = 'Accepted' AND pdf.uploadMode = 'mock' AND pdf.objectId IS NOT NULL
  AND pdf.pendingId IS NULL AND pdf.failed = 0`;
type Row = Record<string, SqlValue>;
type CreateShare = Extract<z.infer<typeof lenderShareStaffInput>, { type: "create" }>;

function reviewedFile(db: Store, loanId: string) {
  return db.prepare(`SELECT loan.contactId, app.revision, coalesce(lender.revision, 0) AS lenderRevision
    FROM loans loan JOIN applications app ON app.loanId = loan.id
    LEFT JOIN application_lender_details lender ON lender.loanId = loan.id
    LEFT JOIN past_client_profiles past ON past.loanId = loan.id LEFT JOIN closing_progress closing ON closing.loanId = loan.id
    WHERE loan.id = ? AND loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed')
      AND past.closingDate IS NULL AND closing.fundingDate IS NULL
      AND app.submittedAt IS NOT NULL AND app.reviewedAt IS NOT NULL AND coalesce(app.correctionNote, '') = ''
      AND json_extract(app.draft, '$.confirmedDemo') = 1${readPlaybook(db).requireSecondReview ? ` AND ${approvedSecondReview}` : ""}`).get(loanId);
}

function matchesFile(share: Row, current: Row | undefined) {
  return !!current && share.borrowerId === current.contactId && share.applicationRevision === current.revision && share.lenderRevision === current.lenderRevision;
}

function documentsStillMatch(db: Store, share: Row) {
  return !db.prepare(`SELECT 1 FROM lender_package_files item WHERE item.shareId = ? AND item.slot > 0 AND NOT EXISTS (
    SELECT 1 FROM document_requests request JOIN document_files pdf ON pdf.requestId = request.id
    WHERE request.id = item.requestId AND request.loanId = ? AND request.revision = item.documentRevision
      AND pdf.objectId = item.objectId AND ${cleanPdf}) LIMIT 1`).get(share.id, share.loanId);
}

function packageFiles(db: Store, shareId: SqlValue) {
  return db.prepare(`SELECT slot, label, downloads, firstDownloadedAt, lastDownloadedAt FROM lender_package_files
    WHERE shareId = ? ORDER BY slot`).all(shareId).map((file) => ({
    slot: Number(file.slot), label: String(file.label), downloads: Number(file.downloads),
    firstDownloadedAt: file.firstDownloadedAt as string | null, lastDownloadedAt: file.lastDownloadedAt as string | null,
  }));
}

function sharePage(db: Store, loanId: string, now: string): LenderSharePage {
  const current = reviewedFile(db, loanId);
  const eligible = current ? db.prepare(`SELECT request.id, request.revision, request.kind, request.recipient
    FROM document_requests request JOIN document_files pdf ON pdf.requestId = request.id
    WHERE request.loanId = ? AND ${cleanPdf} ORDER BY request.kind, request.recipient, request.id LIMIT 50`).all(loanId).map((row) => ({
    id: String(row.id), revision: Number(row.revision), label: `${row.kind} · ${row.recipient}`,
  })) : [];
  const shares = db.prepare(`SELECT id, loanId, borrowerId, applicationRevision, lenderRevision, recipient, createdAt, createdBy, expiresAt, revokedAt
    FROM lender_package_links WHERE loanId = ?
    ORDER BY (revokedAt IS NULL AND expiresAt > ?) DESC, createdAt DESC, rowid DESC LIMIT 15`).all(loanId, now).map((row) => {
    const canRevoke = !row.revokedAt && String(row.expiresAt) > now;
    const status: LenderPackageStatus = row.revokedAt ? "Revoked" : !canRevoke ? "Expired" :
      matchesFile(row, current) && documentsStillMatch(db, row) ? "Available" : "File changed";
    return { id: String(row.id), recipient: String(row.recipient), createdAt: String(row.createdAt), createdBy: String(row.createdBy),
      expiresAt: String(row.expiresAt), status, canRevoke, files: packageFiles(db, row.id) };
  });
  return { eligible, shares };
}

function createShare(db: Store, data: CreateShare, staff: WorkspaceStaff, now: string): LenderSharePage | { error: string } {
  const { loanId, shareId, token, code, names, revision, lenderRevision, recipient, hours, documents } = data;
  const current = reviewedFile(db, loanId);
  if (!current || current.revision !== revision || current.lenderRevision !== lenderRevision) return { error: changedFile };
  if (portalBrokerage(token) !== staff.brokerage.id) return { error: staffUnavailable };
  const requestHash = hash(JSON.stringify(data));
  const prior = db.prepare(`SELECT id, loanId, borrowerId, applicationRevision, lenderRevision, requestHash, expiresAt, revokedAt
    FROM lender_package_links WHERE id = ?`).get(shareId);
  if (prior) {
    if (prior.loanId !== loanId || prior.requestHash !== requestHash || prior.revokedAt || String(prior.expiresAt) <= now ||
      !matchesFile(prior, current) || !documentsStillMatch(db, prior)) return { error: "Open the current file and create a new package." };
    return { ...sharePage(db, loanId, now), createdId: shareId, message: "Fictional lender package created." };
  }
  if (db.prepare("SELECT 1 FROM lender_package_links WHERE loanId = ? AND revokedAt IS NULL AND expiresAt > ?").get(loanId, now)) {
    return { error: "Revoke the previous package before creating another link for this loan." };
  }
  const tokenHash = hash(token);
  if (db.prepare("SELECT 1 FROM lender_package_links WHERE tokenHash = ?").get(tokenHash)) return { error: "Start a new lender package." };
  const readPdf = db.prepare(`SELECT request.kind, request.recipient, pdf.objectId FROM document_requests request
    JOIN document_files pdf ON pdf.requestId = request.id
    WHERE request.id = ? AND request.revision = ? AND request.loanId = ? AND ${cleanPdf}`);
  const selected = documents.map((document) => ({ document, pdf: readPdf.get(document.id, document.revision, loanId) }));
  if (selected.some(({ pdf }) => !pdf)) return { error: changedFile };
  const prepared = prepareLenderExport(db, { type: "exportReviewedApplication", loanId, revision, lenderRevision, names, eventId: shareId }, staff, now);
  if ("error" in prepared) return { error: prepared.error ?? changedFile };
  const expiresAt = new Date(Date.parse(now) + hours * 3600000).toISOString();
  db.prepare(`INSERT INTO lender_package_links
    (id, loanId, borrowerId, applicationRevision, lenderRevision, recipient, tokenHash, codeHash, requestHash, xml, createdBy, createdAt, expiresAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(shareId, loanId, current.contactId, revision, lenderRevision, recipient, tokenHash, hash(code), requestHash, prepared.xml, staff.email, now, expiresAt);
  const insert = db.prepare("INSERT INTO lender_package_files (shareId, slot, label, requestId, documentRevision, objectId) VALUES (?, ?, ?, ?, ?, ?)");
  insert.run(shareId, 0, "Reviewed 1003 · MISMO 3.4 XML", null, null, null);
  selected.forEach(({ document, pdf }, index) => {
    insert.run(shareId, index + 1, `${pdf!.kind} · ${pdf!.recipient}`, document.id, document.revision, pdf!.objectId);
  });
  accessEvent(db, staff, "Created fictional lender package", loanId, now);
  addApplicationActivity(db, loanId, `Created fictional lender package · ${recipient} · ${selected.length + 1} files · Expires ${expiresAt}`, now);
  return { ...sharePage(db, loanId, now), createdId: shareId, message: "Fictional lender package created." };
}

export async function lenderShareWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  protectLinks?: ProtectPilotLinks, clock = new Date()): Promise<LenderSharePage | { error: string }> {
  const parsed = lenderShareStaffInput.safeParse(input);
  if (!parsed.success) return { error: "Check the recipient, reviewed names, expiry, and selected sample PDFs." };
  const data = parsed.data;
  if (!staff?.brokerage.pilot || staff.brokerage.id !== brokerageId || staff.brokerage.role === "Processor" ||
    !loanAccess(db, staff, data.loanId)) return { error: staffUnavailable };
  const now = clock.toISOString();
  if (data.type === "read") return sharePage(db, data.loanId, now);
  if (data.type === "create") return db.transaction(() => createShare(db, data, staff, now));

  const row = db.prepare("SELECT tokenHash, expiresAt, revokedAt FROM lender_package_links WHERE id = ? AND loanId = ?").get(data.shareId, data.loanId);
  if (!row) return { error: staffUnavailable };
  if (!row.revokedAt && String(row.expiresAt) > now && protectLinks &&
    !await protectLinks([{ tokenHash: String(row.tokenHash), expiresAt: String(row.expiresAt) }])) {
    return { error: "Orbit could not protect the old link. Retry revoking the package." };
  }
  return db.transaction(() => {
    if (!loanAccess(db, staff, data.loanId)) return { error: staffUnavailable };
    const saved = db.prepare(`UPDATE lender_package_links SET revokedAt = ? WHERE id = ? AND loanId = ? AND revokedAt IS NULL
      RETURNING recipient`).get(now, data.shareId, data.loanId);
    if (saved) {
      accessEvent(db, staff, "Revoked fictional lender package", data.loanId, now);
      addApplicationActivity(db, data.loanId, `Revoked fictional lender package · ${saved.recipient}`, now);
    }
    return { ...sharePage(db, data.loanId, now), message: "Lender package revoked." };
  });
}

export type PackageAccessResult =
  | { status: number; error: string }
  | { value: LenderPackageManifest }
  | { xml: string }
  | { objectId: string };

function recordDownload(db: Store, share: Row, file: Row, now: string) {
  db.prepare(`UPDATE lender_package_files SET downloads = downloads + 1,
    firstDownloadedAt = coalesce(firstDownloadedAt, ?), lastDownloadedAt = ? WHERE shareId = ? AND slot = ?`)
    .run(now, now, share.id, file.slot);
  if (file.firstDownloadedAt === null) {
    addApplicationActivity(db, String(share.loanId), `Lender package first download · ${file.label} · ${share.recipient}`, now);
  }
}

export function lenderPackageAccess(db: Store, input: SharedLenderPackageInput, now = new Date().toISOString()): PackageAccessResult {
  return db.transaction(() => {
    const share = authenticatedShare(db, input, now);
    if (!share) return unavailable;
    if (input.type === "read") return { value: { recipient: String(share.recipient), expiresAt: String(share.expiresAt),
      files: packageFiles(db, share.id).map(({ slot, label }) => ({ slot, label })) } };
    const file = db.prepare("SELECT * FROM lender_package_files WHERE shareId = ? AND slot = ?").get(share.id, input.slot);
    if (!file) return unavailable;
    if (input.slot > 0) return file.objectId ? { objectId: String(file.objectId) } : unavailable;
    recordDownload(db, share, file, now);
    const row = db.prepare("SELECT xml FROM lender_package_links WHERE id = ?").get(share.id);
    return { xml: String(row?.xml) };
  });
}

function authenticatedShare(db: Store, input: SharedLenderPackageInput, now: string) {
  const share = db.prepare(`SELECT id, loanId, borrowerId, applicationRevision, lenderRevision, recipient, expiresAt
    FROM lender_package_links WHERE tokenHash = ? AND codeHash = ? AND revokedAt IS NULL AND expiresAt > ?`)
    .get(hash(input.token), hash(input.code), now);
  if (share && matchesFile(share, reviewedFile(db, String(share.loanId))) && documentsStillMatch(db, share)) return share;
}

export function confirmLenderPackagePdf(db: Store, input: PackageDownloadInput, objectId: string, now = new Date().toISOString()) {
  return db.transaction(() => {
    const share = authenticatedShare(db, input, now);
    if (!share) return false;
    const file = db.prepare("SELECT * FROM lender_package_files WHERE shareId = ? AND slot = ? AND objectId = ?")
      .get(share.id, input.slot, objectId);
    if (!file) return false;
    recordDownload(db, share, file, now);
    return true;
  });
}
