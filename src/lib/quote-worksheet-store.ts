import type { z } from "zod";
import { addApplicationActivity } from "./applications";
import { easternDate } from "./client-retention";
import { feeTemplateChanged } from "./fee-template-model";
import { feeOriginForQuote } from "./fee-templates";
import { pricingInputError } from "./income-review-freshness";
import type { PricingApplication, PricingOffer, PricingScenario } from "./pricing-model";
import { estimateFees, feeAllocationIssue, quoteOption, type FeeInputs, type FeeTemplateOrigin, type FeeWorksheet, type QuotePresentation,
  type quoteSelection, type SaveFeeWorksheet } from "./quote-worksheet";
import { sharedQuoteReviewId } from "./shared-quote-model";
import type { Store } from "./store";

function priceOption(db: Store, loanId: string, runId: string, offerId: string) {
  const run = db.prepare("SELECT scenario, offers, applicationRevision, incomeReviewRevision FROM pricing_runs WHERE id = ? AND loanId = ? AND mode = 'mock'").get(runId, loanId);
  if (!run) return null;
  const offer = (JSON.parse(String(run.offers)) as PricingOffer[]).find((item) => item.id === offerId);
  return offer ? { scenario: JSON.parse(String(run.scenario)) as PricingScenario, offer, applicationRevision: run.applicationRevision,
    incomeReviewRevision: run.incomeReviewRevision } : null;
}

export function quoteFeeWorksheet(db: Store, loanId: string, runId: string, offerId: string): FeeWorksheet | undefined {
  const row = db.prepare("SELECT inputs, revision, origin FROM fee_worksheets WHERE runId = ? AND offerId = ?").get(runId, offerId);
  return row ? { loanId, runId, offerId, inputs: JSON.parse(String(row.inputs)) as FeeInputs, revision: Number(row.revision),
    ...(row.origin ? { origin: JSON.parse(String(row.origin)) as FeeTemplateOrigin } : {}) } : undefined;
}

export function saveFeeWorksheet(db: Store, data: SaveFeeWorksheet, now: string) {
  const { loanId, runId, offerId, feeRevision, worksheet, template } = data;
  const option = priceOption(db, loanId, runId, offerId);
  if (!option) return { error: "Choose a sample pricing option on this loan." };
  const app = db.prepare("SELECT revision, correctionNote FROM applications WHERE loanId = ?").get(loanId);
  const freshness = pricingInputError(db, loanId, option, app ? { revision: Number(app.revision), correctionNote: String(app.correctionNote ?? "") } : undefined);
  if (freshness) return { error: freshness };
  const allocationIssue = feeAllocationIssue(worksheet, option.scenario.purpose === "Purchase");
  if (allocationIssue) return { error: allocationIssue };
  if (option.offer.manual && option.offer.pricingAmount === null) return { error: "Enter a new manual offer with points or credit before estimating fees. Use zero when the lender quoted neither." };
  if (!estimateFees(option.scenario, option.offer, worksheet)) {
    return { error: option.scenario.purpose === "Purchase" ? "Enter a purchase price at or above the loan amount." : "Enter estimated refinance payoffs, including zero if applicable." };
  }
  const before = quoteFeeWorksheet(db, loanId, runId, offerId);
  if (data.type === "saveFeeWorksheet" && (before?.inputs.allocations || worksheet.allocations)) {
    return { error: "Refresh pricing before editing payer and payee details on this worksheet." };
  }
  let origin = template === null ? undefined : before?.origin;
  if (template && (template.id !== origin?.id || template.revision !== origin.revision)) {
    origin = feeOriginForQuote(db, template, option.scenario, easternDate(new Date(now)));
    if (!origin) return { error: feeTemplateChanged };
  }
  if (JSON.stringify(before?.inputs) === JSON.stringify(worksheet) && JSON.stringify(before?.origin) === JSON.stringify(origin)) {
    return { message: "Fee worksheet is up to date." };
  }
  if ((before?.revision ?? 0) !== feeRevision) return { error: "The fee worksheet changed. Refresh the loan before saving." };
  db.prepare(`INSERT INTO fee_worksheets (runId, offerId, inputs, revision, origin) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (runId, offerId) DO UPDATE SET inputs = excluded.inputs, origin = excluded.origin, revision = revision + 1`)
    .run(runId, offerId, JSON.stringify(worksheet), origin ? JSON.stringify(origin) : null);
  if (origin && (origin.id !== before?.origin?.id || origin.revision !== before.origin.revision)) {
    addApplicationActivity(db, loanId, `Saved sample fees from ${origin.title} · Version ${origin.revision} · Effective ${origin.effectiveOn}`, now);
  }
  return { message: "Sample fee worksheet saved.", revision: feeRevision + 1 };
}

export function quoteSnapshot(db: Store, loanId: string, choice: z.infer<typeof quoteSelection>, application: PricingApplication) {
  const option = priceOption(db, loanId, choice.runId, choice.offerId);
  if (!option) return { error: "Choose sample pricing options on this loan." };
  const freshness = pricingInputError(db, loanId, option, application);
  if (freshness) return { error: freshness };
  const worksheet = quoteFeeWorksheet(db, loanId, choice.runId, choice.offerId);
  if ((worksheet?.revision ?? 0) !== choice.feeRevision) return { error: "A fee worksheet changed. Refresh the comparison before sharing." };
  return { option: quoteOption({ ...option, id: choice.runId }, option.offer, worksheet), manualExpiresOn: option.offer.manual?.expiresOn };
}

export function archiveSharedQuote(db: Store, loanId: string, now: string, outcome: "Replaced" | "Removed") {
  db.prepare(`INSERT INTO shared_quote_history (loanId, runId, offerId, product, rate, principalAndInterest, quotedAt, publishedAt, endedAt, outcome, presentation, expiresOn)
    SELECT loanId, runId, offerId, product, rate, principalAndInterest, quotedAt, publishedAt, ?, ?, presentation, expiresOn
    FROM published_quotes WHERE loanId = ?`).run(now, outcome, loanId);
}

export function flagSharedQuoteReview(db: Store, loanId: string, reason: string, now: string,
  source?: { runId: string; offerId: string; change: "selection" | "fees" }) {
  const shared = db.prepare("SELECT runId, offerId, presentation FROM published_quotes WHERE loanId = ?").get(loanId);
  if (!shared) return;
  if (source) {
    const samePrimary = shared.runId === source.runId && shared.offerId === source.offerId;
    const presentation = shared.presentation ? JSON.parse(String(shared.presentation)) as QuotePresentation : null;
    if (source.change === "selection" && samePrimary) return;
    if (source.change === "fees" && !samePrimary && !presentation?.alternatives.some((option) =>
      option.runId === source.runId && option.offerId === source.offerId)) return;
  }
  db.prepare("UPDATE published_quotes SET reviewReason = ?, reviewRevision = reviewRevision + 1 WHERE loanId = ?").run(reason, loanId);
  db.prepare(`INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET
    title = excluded.title, dueAt = CASE WHEN tasks.completedAt IS NOT NULL THEN excluded.dueAt ELSE tasks.dueAt END, completedAt = NULL`)
    .run(sharedQuoteReviewId(loanId), loanId, "Review shared sample quote", now);
  addApplicationActivity(db, loanId, `Shared sample quote needs review · ${reason}.`, now);
}

export function finishSharedQuoteReview(db: Store, loanId: string, now: string) {
  db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ? AND completedAt IS NULL").run(now, sharedQuoteReviewId(loanId));
}
