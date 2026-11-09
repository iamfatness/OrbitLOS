import { z } from "zod";
import { easternDate } from "./client-retention";
import type { CutoverFundingInventory } from "./cutover-file-model";
import { fundingTaskId, reversedFundingTaskPrefix } from "./playbook-model";
import { recordedFundingCheckIn } from "./playbooks";
import type { Store } from "./store";

type FollowUpKey = "borrowerFollowUp" | "realtorFollowUp" | "borrowerCallback";
type FollowUp = CutoverFundingInventory[FollowUpKey];
type FundingEvidence = { inventory: CutoverFundingInventory; cycle: number; proof: Record<FollowUpKey, unknown> };

const date = z.iso.date();
const dueTime = z.union([date, z.iso.datetime({ offset: true })]);
const storedFunding = z.object({
  closingDate: date.nullable(), fundingDate: date.nullable(), cycle: z.int().positive(),
  fundedAmount: z.int().nonnegative().max(Math.floor(Number.MAX_SAFE_INTEGER / 100)).nullable(),
  borrowerDueAt: dueTime.nullable(), borrowerCompletedAt: dueTime.nullable(),
  realtorDueAt: dueTime.nullable(), realtorCompletedAt: dueTime.nullable(),
});
const storedCallback = z.object({ id: z.string().min(1).max(240), fundingRevision: z.int().nonnegative(),
  outcome: z.string().nullable(), dueAt: dueTime, completedAt: dueTime.nullable() });

function followUp(dueAt: string | null, completedAt: string | null): FollowUp {
  if (!dueAt) return null;
  const dueOn = dueAt.length === 10 ? dueAt : easternDate(new Date(dueAt));
  return { dueOn, status: completedAt ? "Completed" : "Open" };
}

function currentCallback(db: Store, loanId: string, borrowerTaskId: string) {
  const id = recordedFundingCheckIn(db, loanId);
  if (!id) return undefined;
  const suffix = `:${borrowerTaskId}`;
  const prefix = reversedFundingTaskPrefix;
  // The same completion instant can appear in a later cycle. Anchor the activity to the post-reversal funding revision,
  // with the retired task's revision as evidence for older rows that lack a playbook run.
  return db.prepare(`SELECT activity.id, checkIn.fundingRevision, activity.outcome, activity.dueAt, activity.completedAt
    FROM funding_check_ins checkIn JOIN contact_activity activity ON activity.id = checkIn.activityId
    JOIN loans loan ON loan.id = checkIn.loanId AND loan.contactId = activity.contactId
    WHERE checkIn.activityId = ? AND checkIn.loanId = ? AND activity.dueAt IS NOT NULL
      AND checkIn.fundingRevision >= coalesce((SELECT run.fundingRevision FROM playbook_runs run WHERE run.loanId = checkIn.loanId
        AND run.fundingRevision > (SELECT prior.fundingRevision FROM playbook_runs prior WHERE prior.loanId = checkIn.loanId
          AND prior.status = 'Superseded' AND prior.reason = 'Funding reversed' ORDER BY prior.fundingRevision DESC LIMIT 1)
        ORDER BY run.fundingRevision LIMIT 1), 0)
      AND NOT EXISTS (SELECT 1 FROM tasks retired WHERE retired.loanId = checkIn.loanId AND retired.completedAt = activity.createdAt
        AND substr(retired.id, 1, ?) = ? AND substr(retired.id, -?) = ?
        AND CAST(substr(retired.id, ?, length(retired.id) - ?) AS INTEGER) > checkIn.fundingRevision)`)
    .get(id, loanId, prefix.length, prefix, suffix.length, suffix, prefix.length + 1, prefix.length + suffix.length);
}

export function readFundingInventory(db: Store, loanId: string): FundingEvidence | null {
  const borrowerTaskId = fundingTaskId(loanId, "borrower");
  const row = db.prepare(`SELECT profile.closingDate, progress.fundingDate, coalesce(progress.fundingCycle, 1) AS cycle,
    CASE WHEN progress.fundingDate IS NOT NULL THEN loan.amount END AS fundedAmount,
    borrower.dueAt AS borrowerDueAt, borrower.completedAt AS borrowerCompletedAt,
    realtor.dueAt AS realtorDueAt, realtor.completedAt AS realtorCompletedAt
    FROM loans loan LEFT JOIN past_client_profiles profile ON profile.loanId = loan.id
    LEFT JOIN closing_progress progress ON progress.loanId = loan.id
    LEFT JOIN tasks borrower ON borrower.id = ? AND borrower.loanId = loan.id AND progress.fundingDate IS NOT NULL
    LEFT JOIN tasks realtor ON realtor.id = ? AND realtor.loanId = loan.id AND progress.fundingDate IS NOT NULL
    WHERE loan.id = ?`).get(borrowerTaskId, fundingTaskId(loanId, "realtor"), loanId);
  const parsed = storedFunding.safeParse(row);
  if (!parsed.success) return null;
  const { closingDate, fundingDate, cycle, fundedAmount, borrowerDueAt, borrowerCompletedAt, realtorDueAt, realtorCompletedAt } = parsed.data;
  const current = borrowerCompletedAt ? currentCallback(db, loanId, borrowerTaskId) : undefined;
  const callback = current ? storedCallback.safeParse(current) : undefined;
  if (callback && !callback.success) return null;
  const callbackRecord = callback?.data;
  const inventory = { closingDate, fundingDate, fundedPrincipalCents: fundedAmount === null ? null : fundedAmount * 100,
    borrowerFollowUp: followUp(borrowerDueAt, borrowerCompletedAt), realtorFollowUp: followUp(realtorDueAt, realtorCompletedAt),
    borrowerCallback: callbackRecord ? followUp(callbackRecord.dueAt, callbackRecord.completedAt) : null };
  return { inventory, cycle, proof: { borrowerFollowUp: [borrowerDueAt, borrowerCompletedAt],
    realtorFollowUp: [realtorDueAt, realtorCompletedAt], borrowerCallback: callbackRecord } };
}
