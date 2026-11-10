import { reconcileCampaignSequence } from "./campaign-sequences";
import { reconcileInboxSequence } from "./lead-inbox";
import type { Store } from "./store";

export function reconcileBorrowerSequences(db: Store, leadIds: string[], now: string) {
  let skipped = 0;
  for (const leadId of leadIds) {
    skipped += reconcileCampaignSequence(db, leadId, now);
    skipped += reconcileInboxSequence(db, leadId, now);
  }
  return skipped;
}
