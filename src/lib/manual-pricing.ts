import type { z } from "zod";
import { requestedLoanAmount } from "./application-model";
import { getApplication } from "./applications";
import { easternDate } from "./client-retention";
import { pricingInputError } from "./income-review-freshness";
import { findPricingOffer, manualQuoteBasis, manualQuoteChanged, manualQuoteLimit, sameManualQuote,
  type addManualQuoteInput, type ManualQuoteReference } from "./manual-pricing-model";
import { nonAgencyManualHandoffMessage, type PricingOffer } from "./pricing-model";
import { principalAndInterest } from "./pricing-provider";
import { latestPricingUnsupported, savedPricingRun, type Store } from "./store";

export function addManualQuote(db: Store, input: z.infer<typeof addManualQuoteInput>, now: string) {
  const run = db.prepare(`SELECT run.offers, run.scenario, run.applicationRevision, run.incomeReviewRevision
    FROM pricing_runs run JOIN loans loan ON loan.id = run.loanId
    WHERE run.id = ? AND loan.id = ? AND (run.mode = 'mock' OR run.outcome = 'unsupported') AND loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed')`)
    .get(input.runId, input.loanId);
  if (!run) return { error: "Run sample pricing or save an unsupported EQ scenario on an active loan before adding a manual offer." };
  const offers = JSON.parse(String(run.offers)) as PricingOffer[];
  const prior = offers.find(({ id }) => id === input.offerId);
  const details = input.details;
  if (prior) return JSON.stringify(prior.manual) === JSON.stringify(details) ? { added: false } : { error: "Start a new manual offer." };
  const freshness = pricingInputError(db, input.loanId, { applicationRevision: run.applicationRevision, incomeReviewRevision: run.incomeReviewRevision }, getApplication(db, input.loanId));
  if (freshness) return { error: freshness };
  const today = easternDate(new Date(now));
  if (details.quotedOn > today || details.expiresOn < today || details.expiresOn < details.quotedOn) {
    return { error: "Use a quote date on or before today and an expiration on or after today." };
  }
  if (offers.filter(({ manual }) => manual).length >= manualQuoteLimit) return { error: "This scenario already has six manual offers. Run pricing again to start a new comparison." };
  const { loanAmount } = JSON.parse(String(run.scenario)) as { loanAmount: number };
  const adjustment = details.adjustment;
  const offer: PricingOffer = { id: input.offerId, product: details.product, years: details.years, rate: details.rate, apr: details.apr,
    principalAndInterest: principalAndInterest(loanAmount, details.rate, details.years),
    pricingPercent: adjustment, pricingAmount: adjustment === null ? null : Math.round(loanAmount * adjustment) / 100,
    pricingLabel: adjustment === null ? "Pricing not provided" : adjustment < 0 ? "Lender credit" : "Discount points", manual: details };
  db.prepare("UPDATE pricing_runs SET offers = ? WHERE id = ? AND loanId = ?").run(JSON.stringify([...offers, offer]), input.runId, input.loanId);
  return { added: true };
}

export function selectedManualQuote(run: ReturnType<typeof savedPricingRun>) {
  const basis = run && manualQuoteBasis(String(run.id), Number(run.quotedAmount), findPricingOffer(run.offers, run.selectedId));
  return run && basis ? { run, basis } : undefined;
}

export function manualQuoteForHandoff(db: Store, loanId: string, reference: ManualQuoteReference | undefined, now: string) {
  const run = savedPricingRun(db, loanId);
  const selected = selectedManualQuote(run);
  if (!sameManualQuote(selected?.basis, reference)) return { error: manualQuoteChanged };
  const application = getApplication(db, loanId);
  if (!selected) return run?.nonAgencyProgram || (!run && latestPricingUnsupported(db, loanId, application?.revision ?? null)) ?
    { error: nonAgencyManualHandoffMessage } : { basis: null };
  const freshness = pricingInputError(db, loanId, { applicationRevision: selected.run.applicationRevision,
    incomeReviewRevision: selected.run.incomeReviewRevision }, application);
  if (freshness) return { error: freshness };
  if (selected.basis.expiresOn < easternDate(new Date(now))) return { error: "The selected manual quote expired. Enter and choose a current offer before preparing the handoff." };
  const amount = application && requestedLoanAmount(JSON.parse(application.draft).loanAmount);
  if (amount === null || amount === undefined || Math.round(amount * 100) !== Math.round(selected.basis.loanAmount * 100)) {
    return { error: "Choose a manual quote for the exact loan amount on the reviewed 1003 before preparing the handoff." };
  }
  return { basis: selected.basis };
}
