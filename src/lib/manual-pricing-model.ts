import { z } from "zod";
import type { PricingOffer } from "./pricing-model";
import type { LenderDetails } from "./urla";

const id = z.string().min(1).max(100);
const percent = z.number().min(0.001).max(25);
export const manualQuoteReference = z.object({ runId: id, offerId: z.uuid() });
export type ManualQuoteReference = z.infer<typeof manualQuoteReference>;
export const manualQuoteDetails = z.object({
  lender: z.string().trim().min(2).max(100).refine((name) => !/^(uwm|united wholesale mortgage)$/i.test(name), "Use mock Easy Qualifier for UWM offers."),
  reference: z.string().trim().min(1).max(100),
  quotedOn: z.iso.date(), expiresOn: z.iso.date(),
  product: z.string().trim().min(2).max(100), years: z.number().int().min(5).max(40), rate: percent,
  apr: percent.nullable(), adjustment: z.number().min(-10).max(10).nullable(),
});
export const addManualQuoteInput = z.object({ type: z.literal("addManualQuote"), loanId: id,
  ...manualQuoteReference.shape, details: manualQuoteDetails });
export type ManualQuoteDetails = z.infer<typeof manualQuoteDetails>;
export type ManualQuoteBasis = ManualQuoteReference & ManualQuoteDetails & { loanAmount: number };
export type PreparedManualQuote = ManualQuoteReference & { profile: import("./lender-export-model").LenderExportProfile };
export const manualQuoteLimit = 6;
export const manualQuoteRouteMessage = "The selected manual lender quote belongs in Manual lender export. Choose a UWM quote for a new mock UWM handoff.";
export const manualQuoteChanged = "The selected manual lender quote changed. Refresh pricing and review the current quote before continuing.";

export function sameManualQuote(left: ManualQuoteReference | null | undefined, right: ManualQuoteReference | null | undefined) {
  return (left?.runId ?? null) === (right?.runId ?? null) && (left?.offerId ?? null) === (right?.offerId ?? null);
}

export function offerDisplayName(offer: PricingOffer) {
  return offer.manual ? `${offer.manual.lender} · ${offer.product}` : offer.product;
}

export function findPricingOffer(offers: unknown, id: unknown) {
  return (JSON.parse(String(offers)) as PricingOffer[]).find((offer) => offer.id === id);
}

export function manualQuoteBasis(runId: string, loanAmount: number, offer: PricingOffer | undefined): ManualQuoteBasis | undefined {
  return offer?.manual ? { ...offer.manual, runId, offerId: offer.id, loanAmount } : undefined;
}

export function manualQuoteLenderDetails(details: LenderDetails, quote: Pick<ManualQuoteBasis, "loanAmount" | "rate" | "years"> | null): LenderDetails {
  return quote ? { ...details, supplement: { ...details.supplement, fields: { ...details.supplement.fields,
    loanAmount: String(quote.loanAmount), rate: String(quote.rate), term: String(quote.years * 12), amortization: "Fixed rate",
  } } } : details;
}
