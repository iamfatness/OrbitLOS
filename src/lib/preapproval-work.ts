import { easternDate } from "./client-retention";
import { readPlaybook } from "./playbooks";
import { readPreapprovalPolicy } from "./preapproval-policy";
import type { PreapprovalWorkKind } from "./preapproval-policy-model";
import { currentPreapprovalLetterSql } from "./preapproval-sharing";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { isDemoStaff } from "./workspace-access";

export function preapprovalWorkSource(db: Store, staff: WorkspaceStaff, now: Date, requireSecondReview: boolean, loanId?: string) {
  const admin = staff.brokerage.role === "Admin";
  if (staff.brokerage.role === "Processor" || (!staff.brokerage.pilot && !isDemoStaff(staff))) return;
  const policy = readPreapprovalPolicy(db);
  const at = now.toISOString();
  // The first publication completes the queue item. Sharing with a second audience stays an explicit choice on the loan.
  const sql = `SELECT kind, loanId, name, receivedAt, revision, assignee, note FROM (
    SELECT CASE
      WHEN decision.decision = 'Changes requested' AND loan.officerEmail = ? THEN 'preapproval-revision'
      WHEN decision.decision IS NULL AND ? = 1 AND letter.issuerEmail <> ? THEN 'preapproval-review'
      WHEN loan.officerEmail = ? AND (decision.decision = 'Approved' OR (decision.decision IS NULL AND ? = 0))
        AND NOT EXISTS (SELECT 1 FROM sample_preapproval_shares share WHERE share.loanId = letter.loanId AND share.version = letter.version)
        AND ((app.token <> '' AND app.expiresAt > ? AND app.revokedAt IS NULL) OR EXISTS (
          SELECT 1 FROM contacts partner JOIN realtor_portals portal ON portal.realtorId = partner.id
          WHERE partner.id = loan.partnerId AND partner.role = 'Realtor' AND portal.token <> '' AND portal.expiresAt > ?
        )) THEN 'preapproval-share'
      END AS kind, loan.id AS loanId, contact.name, coalesce(decision.decidedAt, letter.issuedAt) AS receivedAt,
      letter.version AS revision, CASE WHEN decision.decision = 'Changes requested' THEN decision.reviewer ELSE letter.issuer END AS assignee,
      CASE WHEN decision.decision = 'Changes requested' THEN decision.note END AS note
    FROM sample_preapproval_letters letter JOIN loans loan ON loan.id = letter.loanId
    JOIN contacts contact ON contact.id = loan.contactId JOIN applications app ON app.loanId = loan.id
    LEFT JOIN past_client_profiles past ON past.loanId = loan.id LEFT JOIN closing_progress closing ON closing.loanId = loan.id
    LEFT JOIN sample_preapproval_reviews decision ON decision.rowid = (
      SELECT review.rowid FROM sample_preapproval_reviews review WHERE review.loanId = letter.loanId AND review.version = letter.version
        AND (review.policyRevision = ? OR review.decision = 'Changes requested') ORDER BY review.policyRevision DESC LIMIT 1
    )
    WHERE ${currentPreapprovalLetterSql(requireSecondReview)}
      ${admin ? "" : "AND loan.officerEmail = ?"}
      ${loanId ? "AND loan.id = ?" : ""}
    ) work WHERE kind IS NOT NULL`;
  const args = [staff.email, Number(admin && policy.requireApproval), staff.email, staff.email, Number(policy.requireApproval),
    at, at, policy.revision, easternDate(now), ...(admin ? [] : [staff.email]), ...(loanId ? [loanId] : [])];
  return { sql, args };
}

export function currentPreapprovalWork(db: Store, staff: WorkspaceStaff, loanId: string, now: Date) {
  const source = preapprovalWorkSource(db, staff, now, readPlaybook(db).requireSecondReview, loanId);
  if (!source) return;
  const row = db.prepare(`SELECT kind, revision, receivedAt FROM (${source.sql})`).get(...source.args) as
    { kind: PreapprovalWorkKind; revision: number; receivedAt: string } | undefined;
  return row && { ...row };
}
