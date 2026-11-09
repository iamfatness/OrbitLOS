import type { CommunicationDraft, DraftAudience, DraftChannel, DraftMilestone } from "./model";
import type { Store } from "./store";
import { reopenedMockUwmAtSql } from "./processing-conditions";

function createDraft(db: Store, loanId: string, audience: DraftAudience, milestone: DraftMilestone, contactId: string, now: string, eventKey = "") {
  return db.prepare(`INSERT INTO communication_drafts (id, loanId, contactId, audience, milestone, createdAt, eventKey)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (loanId, contactId, audience, milestone, eventKey) DO NOTHING RETURNING id`)
    .get(crypto.randomUUID(), loanId, contactId, audience, milestone, now, eventKey)?.id;
}

export function createMilestoneDrafts(db: Store, loanId: string, milestone: DraftMilestone, now: string, eventKey = "") {
  const loan = db.prepare("SELECT contactId, partnerId FROM loans WHERE id = ?").get(loanId);
  if (!loan) return;
  createDraft(db, loanId, "Borrower", milestone, String(loan.contactId), now, eventKey);
  if (loan.partnerId) createDraft(db, loanId, "Realtor", milestone, String(loan.partnerId), now, eventKey);
}

export function supersedeClearToCloseDrafts(db: Store, loanId: string, now: string) {
  db.prepare("UPDATE communication_drafts SET supersededAt = ? WHERE loanId = ? AND milestone = 'Clear to Close' AND supersededAt IS NULL")
    .run(now, loanId);
}

export function restoreClearToCloseDrafts(db: Store, loanId: string, now: string, eventKey: string) {
  const ready = db.prepare(`SELECT 1 FROM loans loan
    LEFT JOIN past_client_profiles profile ON profile.loanId = loan.id
    LEFT JOIN closing_progress progress ON progress.loanId = loan.id
    WHERE loan.id = ? AND loan.stage = 'Clear to Close' AND loan.disposition = 'Active' AND profile.closingDate IS NULL
      AND progress.fundingDate IS NULL AND ${reopenedMockUwmAtSql("loan.id")} IS NULL`).get(loanId);
  if (ready) createMilestoneDrafts(db, loanId, "Clear to Close", now, eventKey);
}

export function createRealtorLenderDraft(db: Store, loanId: string,
  milestone: "Lender review started" | "Lender review resumed" | "Lender review complete", eventKey: string, now: string) {
  const loan = db.prepare("SELECT partnerId FROM loans WHERE id = ?").get(loanId);
  if (typeof loan?.partnerId !== "string") return;
  const draftId = createDraft(db, loanId, "Realtor", milestone, loan.partnerId, now, eventKey);
  if (!draftId) return;
  db.prepare(`UPDATE communication_drafts SET supersededAt = ? WHERE loanId = ? AND audience = 'Realtor'
    AND contactId = ? AND id <> ? AND supersededAt IS NULL
    AND milestone IN ('Lender review started', 'Lender review resumed', 'Lender review complete')`).run(now, loanId, loan.partnerId, draftId);
}

const fundingMilestones = ["Funded", "Post-funding check-in", "Realtor thank-you"] as const;

export function createFundingDrafts(db: Store, loanId: string, now: string, revision: number) {
  const loan = db.prepare("SELECT contactId, partnerId FROM loans WHERE id = ?").get(loanId);
  if (!loan) return;
  const active = db.prepare(`SELECT 1 FROM communication_drafts WHERE loanId = ? AND contactId = ? AND audience = ?
    AND milestone = ? AND supersededAt IS NULL`);
  function ensure(audience: DraftAudience, milestone: DraftMilestone, contactId: string) {
    if (!active.get(loanId, contactId, audience, milestone)) createDraft(db, loanId, audience, milestone, contactId, now, `funding:${revision}`);
  }
  ensure("Borrower", "Funded", String(loan.contactId));
  ensure("Borrower", "Post-funding check-in", String(loan.contactId));
  if (typeof loan.partnerId === "string") {
    ensure("Realtor", "Funded", loan.partnerId);
    ensure("Realtor", "Realtor thank-you", loan.partnerId);
  }
}

export function supersedeFundingDrafts(db: Store, loanId: string, now: string) {
  db.prepare("UPDATE communication_drafts SET supersededAt = ? WHERE loanId = ? AND supersededAt IS NULL AND milestone IN (?, ?, ?)")
    .run(now, loanId, ...fundingMilestones);
}

export function recordDraftCopy(db: Store, input: {
  loanId: string; contactId: string; audience: DraftAudience; milestone: DraftMilestone; channel: DraftChannel; draftId?: string;
}, now: string) {
  const { loanId, audience, milestone, contactId, channel, draftId } = input;
  const loan = db.prepare("SELECT stage, contactId, partnerId FROM loans WHERE id = ?").get(loanId);
  if (!loan || contactId !== (audience === "Borrower" ? loan.contactId : loan.partnerId)) return false;
  if (milestone === "Clear to Close" && db.prepare(`SELECT ${reopenedMockUwmAtSql("?")} AS since`).get(loanId)?.since) return false;
  if (milestone === "Closing complete" && !db.prepare("SELECT closingDate FROM past_client_profiles WHERE loanId = ?").get(loanId)?.closingDate) return false;
  const find = () => db.prepare(`SELECT * FROM communication_drafts WHERE loanId = ? AND contactId = ? AND audience = ? AND milestone = ?
    AND ${draftId ? "id = ?" : milestone === "Clear to Close" ? "supersededAt IS NULL" : "eventKey = ''"}
    ORDER BY createdAt DESC, rowid DESC LIMIT 1`)
    .get(loanId, contactId, audience, milestone, ...(draftId ? [draftId] : [])) as CommunicationDraft | undefined;
  let draft = find();
  if (!draftId && !draft && milestone === loan.stage) {
    createDraft(db, loanId, audience, milestone, contactId, now);
    draft = find();
  }
  if (!draft || draft.supersededAt) return false;

  const column = channel === "Email" ? "emailCopiedAt" : "textCopiedAt";
  if (draft[column]) return true;
  db.prepare(`UPDATE communication_drafts SET ${column} = ? WHERE id = ?`).run(now, draft.id);
  db.prepare("INSERT INTO activity (id, loanId, text, createdAt, kind) VALUES (?, ?, ?, ?, 'Note')")
    .run(crypto.randomUUID(), loanId, `Copied ${audience.toLowerCase()} ${channel.toLowerCase()} draft · ${milestone}`, now);
  return true;
}
