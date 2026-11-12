import { approvedSecondReview } from "./application-review-checkpoint";
import { readPlaybook } from "./playbooks";
import { defaultPreapprovalPolicy, preapprovalPolicyConfig, type PreapprovalPendingLetter, type PreapprovalPolicy,
  type PreapprovalPolicyRequest, type PreapprovalPolicyResult, type PreapprovalReviewReceipt } from "./preapproval-policy-model";
import { activePreapprovalLoan } from "./preapproval-sharing";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

type SettingsRequest = Exclude<PreapprovalPolicyRequest, { type: "reviewLetter" }>;
type ReviewRequest = Extract<PreapprovalPolicyRequest, { type: "reviewLetter" }>;
export const preapprovalPolicyChanged = "The sample letter policy changed. Refresh before continuing.";

export function readPreapprovalPolicy(db: Store): PreapprovalPolicy {
  const row = db.prepare("SELECT revision, config FROM sample_preapproval_policy ORDER BY revision DESC LIMIT 1").get();
  return row ? { revision: Number(row.revision), ...preapprovalPolicyConfig.parse(JSON.parse(String(row.config))) } : defaultPreapprovalPolicy;
}

export function preapprovalReviewReceipt(db: Store, loanId: string, version: number, revision: number) {
  // A return always requires a replacement. Approvals apply to the current policy version.
  return (db.prepare(`SELECT decision, reviewer, decidedAt, note, policyRevision FROM sample_preapproval_reviews
    WHERE loanId = ? AND version = ? AND (policyRevision = ? OR decision = 'Changes requested')
    ORDER BY policyRevision DESC LIMIT 1`).get(loanId, version, revision) as PreapprovalReviewReceipt | undefined) ?? null;
}

export function decidePreapprovalReview(db: Store, data: ReviewRequest, staff: WorkspaceStaff, policy: PreapprovalPolicy,
  issuerEmail: string, now: string): { message: string } | { error: string } {
  if (staff.brokerage.role !== "Admin") return { error: "Only brokerage admins can decide a sample letter review." };
  if (staff.email === issuerEmail) return { error: "Ask another brokerage admin to review this sample letter." };
  if (!policy.requireApproval || policy.revision !== data.revision) return { error: preapprovalPolicyChanged };
  if (data.decision === "Changes requested" && !data.note) return { error: "Add a reason for returning this letter." };
  const prior = preapprovalReviewReceipt(db, data.loanId, data.version, policy.revision);
  if (prior) {
    const retry = prior.decision === data.decision && prior.note === data.note &&
      db.prepare(`SELECT 1 FROM sample_preapproval_reviews WHERE loanId = ? AND version = ?
        AND policyRevision = ? AND reviewerEmail = ?`).get(data.loanId, data.version, policy.revision, staff.email);
    return retry ? { message: `Sample letter v${data.version} review recorded.` } :
      { error: "This sample letter already has a decision. Refresh letters." };
  }
  db.prepare(`INSERT INTO sample_preapproval_reviews
    (loanId, version, policyRevision, decision, reviewer, reviewerEmail, decidedAt, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.loanId, data.version, policy.revision, data.decision, staff.name, staff.email, now, data.note);
  if (data.decision === "Changes requested") {
    db.prepare("UPDATE sample_preapproval_shares SET revokedAt = ? WHERE loanId = ? AND version = ? AND revokedAt IS NULL")
      .run(now, data.loanId, data.version);
  }
  const event = data.decision === "Approved" ? "Approved for sharing" : "Requested changes to";
  accessEvent(db, staff, `${event} sample letter v${data.version}`, data.loanId, now);
  db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), data.loanId,
    `${event} fictional preapproval letter v${data.version} · ${staff.name} · Policy v${policy.revision}`, now);
  return { message: data.decision === "Approved" ? "Approved for portal sharing." : "Changes requested. Prepare a replacement to share." };
}

export function workOnPreapprovalPolicy(db: Store, data: SettingsRequest, staff: WorkspaceStaff, today: string, now: string):
  PreapprovalPolicyResult | { error: string } {
  if (staff.brokerage.role !== "Admin") return { error: "Only brokerage admins can manage the sample letter policy." };
  let policy = readPreapprovalPolicy(db);
  if (data.type === "policySave") {
    const { revision, ...config } = policy;
    const encoded = JSON.stringify(data.config);
    const same = JSON.stringify(config) === encoded;
    if (revision !== data.revision && !(same && revision === data.revision + 1)) return { error: preapprovalPolicyChanged };
    if (!same) {
      policy = { revision: revision + 1, ...data.config };
      db.prepare("INSERT INTO sample_preapproval_policy (revision, config, savedAt, savedBy) VALUES (?, ?, ?, ?)")
        .run(policy.revision, encoded, now, staff.email);
      accessEvent(db, staff, "Updated sample preapproval policy", `Policy v${policy.revision}`, now);
    }
  }

  const search = data.type === "policyRead" ? data.search : "";
  const after = data.type === "policyRead" ? data.after : undefined;
  const rows = policy.requireApproval ? db.prepare(`SELECT loan.id AS loanId, contact.name AS borrower, letter.issuedAt,
      letter.version, letter.issuer, letter.amountCents, letter.expiresOn FROM sample_preapproval_letters letter
    JOIN loans loan ON loan.id = letter.loanId JOIN contacts contact ON contact.id = loan.contactId
    JOIN applications app ON app.loanId = loan.id
    LEFT JOIN past_client_profiles past ON past.loanId = loan.id LEFT JOIN closing_progress closing ON closing.loanId = loan.id
    WHERE ${activePreapprovalLoan} AND loan.purpose = 'Purchase' AND letter.expiresOn >= ?
      AND letter.version = (SELECT max(version) FROM sample_preapproval_letters WHERE loanId = loan.id)
      AND app.revision = letter.applicationRevision AND app.submittedAt IS NOT NULL AND app.reviewedAt IS NOT NULL
      AND coalesce(app.correctionNote, '') = '' AND json_extract(app.draft, '$.confirmedDemo') = 1
      ${readPlaybook(db).requireSecondReview ? `AND ${approvedSecondReview}` : ""}
      AND NOT EXISTS (SELECT 1 FROM sample_preapproval_reviews review WHERE review.loanId = loan.id AND review.version = letter.version
        AND (review.policyRevision = ? OR review.decision = 'Changes requested'))
      AND (instr(lower(contact.name), lower(?)) > 0 OR instr(lower(letter.issuer), lower(?)) > 0)
      ${after ? "AND (letter.issuedAt, loan.id) > (?, ?)" : ""}
    ORDER BY letter.issuedAt, loan.id LIMIT 21`).all(today, policy.revision, search, search,
      ...(after ? [after.issuedAt, after.loanId] : [])) as PreapprovalPendingLetter[] : [];
  const pending = rows.slice(0, 20);
  const last = pending.at(-1);
  return { policy, pending, after: rows.length > 20 && last ? { issuedAt: last.issuedAt, loanId: last.loanId } : null };
}
