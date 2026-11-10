import { skipBlockedCampaignSteps } from "./campaign-sequences";
import { skipBlockedInboxEmail } from "./lead-inbox";
import type { Store } from "./store";

export function reconcileBorrowerSequenceChannels(db: Store, leadIds: string[], now: string) {
  let skipped = 0;
  for (const leadId of leadIds) {
    skipped += skipBlockedCampaignSteps(db, leadId, now);
    skipped += skipBlockedInboxEmail(db, leadId, now);
  }
  return skipped;
}
