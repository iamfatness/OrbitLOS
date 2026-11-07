import type { CommunicationDraft, DraftAudience, DraftChannel, DraftMilestone } from "./model";
import type { Store } from "./store";

function createDraft(db: Store, loanId: string, audience: DraftAudience, milestone: DraftMilestone, contactId: string, now: string) {
  db.prepare(`INSERT INTO communication_drafts (id, loanId, contactId, audience, milestone, createdAt)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (loanId, contactId, audience, milestone) DO NOTHING`)
    .run(crypto.randomUUID(), loanId, contactId, audience, milestone, now);
}

export function createMilestoneDrafts(db: Store, loanId: string, milestone: DraftMilestone, now: string) {
  const loan = db.prepare("SELECT contactId, partnerId FROM loans WHERE id = ?").get(loanId);
  if (!loan) return;
  createDraft(db, loanId, "Borrower", milestone, String(loan.contactId), now);
  if (loan.partnerId) createDraft(db, loanId, "Realtor", milestone, String(loan.partnerId), now);
}

export function recordDraftCopy(db: Store, input: {
  loanId: string; contactId: string; audience: DraftAudience; milestone: DraftMilestone; channel: DraftChannel;
}, now: string) {
  const { loanId, audience, milestone, contactId, channel } = input;
  const loan = db.prepare("SELECT stage, contactId, partnerId FROM loans WHERE id = ?").get(loanId);
  if (!loan || contactId !== (audience === "Borrower" ? loan.contactId : loan.partnerId)) return false;
  if (milestone === "Closing complete" && !db.prepare("SELECT closingDate FROM past_client_profiles WHERE loanId = ?").get(loanId)?.closingDate) return false;
  const find = () => db.prepare("SELECT * FROM communication_drafts WHERE loanId = ? AND contactId = ? AND audience = ? AND milestone = ?")
    .get(loanId, contactId, audience, milestone) as CommunicationDraft | undefined;
  let draft = find();
  if (!draft && milestone === loan.stage) {
    createDraft(db, loanId, audience, milestone, contactId, now);
    draft = find();
  }
  if (!draft) return false;

  const column = channel === "Email" ? "emailCopiedAt" : "textCopiedAt";
  if (draft[column]) return true;
  db.prepare(`UPDATE communication_drafts SET ${column} = ? WHERE id = ?`).run(now, draft.id);
  db.prepare("INSERT INTO activity (id, loanId, text, createdAt, kind) VALUES (?, ?, ?, ?, 'Note')")
    .run(crypto.randomUUID(), loanId, `Copied ${audience.toLowerCase()} ${channel.toLowerCase()} draft · ${milestone}`, now);
  return true;
}
