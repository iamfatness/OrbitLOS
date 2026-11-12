import type { CreditAusService } from "./credit-aus-model";

export type UnderwritingOrderIdentity = {
  brokerageId: string;
  loanId: string;
  orderId: string;
  service: CreditAusService;
  applicationRevision: number | null;
  borrowerCount: number;
};

export type UnderwritingLookup =
  | { outcome: "inconclusive" }
  | { outcome: "accepted" | "rejected"; identity: UnderwritingOrderIdentity; reference: string };

// The connector selects the brokerage account before lookup and normalizes the
// returned evidence. Unknown identifiers must never be filled from the request.
export function classifyUnderwritingLookup(expected: UnderwritingOrderIdentity, lookup: UnderwritingLookup, knownReference?: string) {
  if (lookup.outcome === "inconclusive") return { outcome: lookup.outcome } as const;
  const { identity, reference } = lookup;
  if (identity.brokerageId !== expected.brokerageId || identity.loanId !== expected.loanId ||
    identity.orderId !== expected.orderId || identity.service !== expected.service ||
    identity.applicationRevision !== expected.applicationRevision || identity.borrowerCount !== expected.borrowerCount ||
    (knownReference !== undefined && reference !== knownReference)) {
    return { outcome: "conflict", reference } as const;
  }
  return { outcome: lookup.outcome } as const;
}
