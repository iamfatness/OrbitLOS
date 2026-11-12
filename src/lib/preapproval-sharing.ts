import { createHash } from "node:crypto";
import type { z } from "zod";
import { approvedSecondReview } from "./application-review-checkpoint";
import { easternDate } from "./client-retention";
import { readPlaybook } from "./playbooks";
import { preapprovalAudiences, sharedPreapprovalRequest, sharedPreapprovalUnavailable, type PreapprovalAudience,
  type PreapprovalShareState, type SharedPreapprovalLetter, type preapprovalRequest } from "./preapproval-model";
import type { StaffIdentity } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

export const activePreapprovalLoan = `loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed')
  AND past.closingDate IS NULL AND closing.fundingDate IS NULL`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function recipient(db: Store, loanId: string, audience: PreapprovalAudience, now: string) {
  const row = audience === "Borrower" ?
    db.prepare(`SELECT contact.id, contact.name, app.token FROM loans loan
      JOIN contacts contact ON contact.id = loan.contactId JOIN applications app ON app.loanId = loan.id
      WHERE loan.id = ? AND app.expiresAt > ? AND app.revokedAt IS NULL`).get(loanId, now) :
    db.prepare(`SELECT contact.id, contact.name, portal.token FROM loans loan
      JOIN contacts contact ON contact.id = loan.partnerId AND contact.role = 'Realtor'
      JOIN realtor_portals portal ON portal.realtorId = contact.id
      WHERE loan.id = ? AND portal.expiresAt > ?`).get(loanId, now);
  if (!row || !row.token) return null;
  const portalHash = hash(String(row.token));
  return { id: String(row.id), name: String(row.name), stamp: hash(JSON.stringify([row.id, portalHash])), portalHash };
}

function activeGrant(db: Store, loanId: string, version: number, audience: PreapprovalAudience) {
  return db.prepare(`SELECT id, recipientStamp, firstDownloadedAt FROM sample_preapproval_shares
    WHERE loanId = ? AND version = ? AND audience = ? AND revokedAt IS NULL`).get(loanId, version, audience);
}

export function preapprovalShareStates(db: Store, loanId: string, version: number, canPublish: boolean, now: string): PreapprovalShareState[] {
  return preapprovalAudiences.map((audience) => {
    const grant = activeGrant(db, loanId, version, audience);
    const target = recipient(db, loanId, audience, now);
    return { audience, recipient: target && { name: target.name, stamp: target.stamp }, grantId: grant ? String(grant.id) : null,
      visible: canPublish && !!grant && !!target && grant.recipientStamp === target.stamp,
      firstDownloadedAt: typeof grant?.firstDownloadedAt === "string" ? grant.firstDownloadedAt : null };
  });
}

type ShareChange = Extract<z.infer<typeof preapprovalRequest>, { type: "publish" | "withdraw" }>;
export function changePreapprovalShare(db: Store, input: ShareChange, staff: StaffIdentity, blocker: string | null, now: string): { message: string } | { error: string } {
  const { loanId, version, audience, grantId } = input;
  const grant = activeGrant(db, loanId, version, audience);
  if (input.type === "withdraw") {
    if (grant?.id !== grantId) {
      const withdrawn = !grant && db.prepare(`SELECT 1 FROM sample_preapproval_shares WHERE id = ? AND loanId = ?
        AND version = ? AND audience = ? AND revokedAt IS NOT NULL`).get(grantId, loanId, version, audience);
      return withdrawn ? { message: `${audience} access withdrawn.` } : { error: "Sharing changed. Refresh letters before updating access." };
    }
    db.prepare("UPDATE sample_preapproval_shares SET revokedAt = ? WHERE id = ?").run(now, grantId);
  } else {
    const target = recipient(db, loanId, audience, now);
    if (!target || target.stamp !== input.recipientStamp) return { error: "The recipient or portal link changed. Refresh letters before sharing." };
    if (grant?.id === grantId && grant.recipientStamp === target.stamp) return { message: `Sample letter shared in the ${audience.toLowerCase()} portal.` };
    if (blocker) return { error: blocker };
    if ((grant?.id ?? null) !== input.previousGrantId ||
      db.prepare("SELECT 1 FROM sample_preapproval_shares WHERE id = ?").get(grantId)) return { error: "Sharing changed. Refresh letters before updating access." };
    if (grant) db.prepare("UPDATE sample_preapproval_shares SET revokedAt = ? WHERE id = ?").run(now, grant.id);
    db.prepare(`INSERT INTO sample_preapproval_shares
      (id, loanId, version, audience, recipientId, recipientStamp, portalHash, publishedAt, publishedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(grantId, loanId, version, audience, target.id, target.stamp, target.portalHash, now, staff.email);
  }
  const action = input.type === "publish" ? `Shared sample letter v${version} with ${audience.toLowerCase()}` :
    `Withdrew ${audience.toLowerCase()} access to sample letter v${version}`;
  accessEvent(db, staff, action, loanId, now);
  db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), loanId, `${action} · ${staff.name}`, now);
  return { message: input.type === "publish" ? `Sample letter shared in the ${audience.toLowerCase()} portal.` : `${audience} access withdrawn.` };
}

function sharedLettersSql(db: Store, audience: PreapprovalAudience, columns: string, restriction: string) {
  const partner = audience === "Realtor";
  const portal = partner ? "JOIN contacts contact ON contact.id = loan.partnerId AND contact.role = 'Realtor' JOIN realtor_portals portal ON portal.realtorId = contact.id" : "";
  const tokenScope = partner ? "loan.partnerId = share.recipientId AND portal.token = ? AND portal.expiresAt > ?" :
    "loan.contactId = share.recipientId AND app.token = ? AND app.expiresAt > ? AND app.revokedAt IS NULL";
  return `SELECT ${columns} FROM sample_preapproval_shares share
    JOIN sample_preapproval_letters letter ON letter.loanId = share.loanId AND letter.version = share.version
    JOIN loans loan ON loan.id = letter.loanId JOIN applications app ON app.loanId = loan.id
    LEFT JOIN past_client_profiles past ON past.loanId = loan.id LEFT JOIN closing_progress closing ON closing.loanId = loan.id
    ${portal}
    WHERE ${restriction} AND share.audience = ? AND share.portalHash = ? AND share.revokedAt IS NULL AND ${tokenScope}
      AND letter.expiresOn >= ? AND letter.version = (SELECT max(version) FROM sample_preapproval_letters WHERE loanId = loan.id)
      AND ${activePreapprovalLoan} AND loan.purpose = 'Purchase' AND app.revision = letter.applicationRevision
      AND app.submittedAt IS NOT NULL AND app.reviewedAt IS NOT NULL AND coalesce(app.correctionNote, '') = ''
      AND json_extract(app.draft, '$.confirmedDemo') = 1${readPlaybook(db).requireSecondReview ? ` AND ${approvedSecondReview}` : ""}`;
}

export function readSharedPreapprovalLetters(db: Store, loanIds: string[], audience: PreapprovalAudience, token: string, now: string) {
  const letters = new Map<string, SharedPreapprovalLetter>();
  if (!loanIds.length) return letters;
  const rows = db.prepare(sharedLettersSql(db, audience, "loan.id AS loanId, share.id AS grantId, letter.version, letter.expiresOn",
    "share.loanId IN (SELECT value FROM json_each(?))")).all(JSON.stringify(loanIds), audience, hash(token), token, now, easternDate(new Date(now)));
  for (const { loanId, grantId, version, expiresOn } of rows) letters.set(String(loanId), {
    grantId: String(grantId), version: Number(version), expiresOn: String(expiresOn),
  });
  return letters;
}

export function sharedPreapprovalDownload(db: Store, input: unknown, clock = new Date()) {
  const parsed = sharedPreapprovalRequest.safeParse(input);
  const unavailable = { status: 404, error: sharedPreapprovalUnavailable };
  if (!parsed.success) return unavailable;
  const { token, audience, grantId } = parsed.data;
  const now = clock.toISOString();
  return db.transaction(() => {
    const row = db.prepare(sharedLettersSql(db, audience, "letter.pdf, letter.version, share.loanId, share.firstDownloadedAt",
      "share.id = ?")).get(grantId, audience, hash(token), token, now, easternDate(clock));
    if (!row) return unavailable;
    if (row.firstDownloadedAt === null) {
      db.prepare("UPDATE sample_preapproval_shares SET firstDownloadedAt = ? WHERE id = ?").run(now, grantId);
      db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), row.loanId,
        `${audience} portal first requested sample preapproval v${row.version}`, now);
    }
    return { value: { pdf: String(row.pdf), filename: `orbit-fictional-preapproval-v${row.version}.pdf` } };
  });
}
