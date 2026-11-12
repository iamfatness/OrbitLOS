import { countMyLicenseRenewals } from "./compliance-program";
import { readIncomingLoanWorkPage } from "./incoming-loan-work";
import { countFileExceptions } from "./file-exceptions";
import { countDeliveryExceptions } from "./automation-exceptions";
import { countLeadAttention } from "./lead-inbox-query";
import { readOfficerQueue } from "./officer-queue";
import type { OfficerQueueQuery } from "./officer-queue-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

export const actionCountsUnavailable = "Workspace action counts are unavailable.";
const countLimit = 100;

export function readActionCounts(db: Store, staff: WorkspaceStaff | null, brokerageId: string, now = new Date(), localName?: string) {
  if (!staff || staff.brokerage.id !== brokerageId) {
    return { error: actionCountsUnavailable };
  }
  const processing = staff.brokerage.role === "LO" ? undefined :
    readIncomingLoanWorkPage(db, { view: "processing" }, staff, brokerageId, localName, now, countLimit);
  if (processing && "error" in processing) return { error: actionCountsUnavailable };
  if (staff.brokerage.role === "Processor") return { processing: processing?.items.length ?? 0 };
  const incoming = readIncomingLoanWorkPage(db, { view: "today" }, staff, brokerageId, localName, now, countLimit);
  if ("error" in incoming) return { error: actionCountsUnavailable };
  const actions = new Set(incoming.items.map(({ kind, id }) => `${kind}:${id}`));
  const applicationWork = new Set(incoming.items.flatMap((item) =>
    item.kind === "application" || item.kind === "lender-return" ? [item.loanId] : []));
  let after: OfficerQueueQuery["after"];
  do {
    if (actions.size >= countLimit) break;
    const page = readOfficerQueue(db, { horizon: 1, after }, staff, brokerageId, now, localName, countLimit);
    if ("error" in page) return { error: actionCountsUnavailable };
    for (const { kind, id, recordId } of page.items) {
      // A submitted 1003 and its generated follow-up both point to the same review.
      if (kind === "loan" && applicationWork.has(recordId) &&
        (id === `application-follow-up:${recordId}` || id.startsWith(`application-correction:${recordId}:`))) continue;
      actions.add(`${kind}:${id}`);
    }
    for (const { id } of page.replies.items) actions.add(`conversation:${id}`);
    after = page.next ?? undefined;
  } while (after);
  const fileExceptions = countFileExceptions(db, staff, brokerageId, now, countLimit);
  const deliveryExceptions = countDeliveryExceptions(db, staff, brokerageId, now.toISOString(), countLimit);
  const renewals = actions.size >= countLimit ? 0 : countMyLicenseRenewals(db, staff, now.toISOString(), countLimit - actions.size);
  return { today: Math.min(actions.size + renewals, countLimit), leads: countLeadAttention(db, staff, countLimit),
    ...(fileExceptions === undefined || deliveryExceptions === undefined ? {} :
      { exceptions: Math.min(fileExceptions + deliveryExceptions, countLimit), ...(deliveryExceptions ? { deliveryExceptions } : {}) }), ...(processing ? { processing: processing.items.length } : {}) };
}
