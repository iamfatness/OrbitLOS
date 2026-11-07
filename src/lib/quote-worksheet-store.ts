import type { z } from "zod";
import type { PricingOffer, PricingScenario } from "./pricing-model";
import { estimateFees, quoteOption, type FeeInputs, type FeeWorksheet, type quoteSelection, type saveFeeWorksheetInput } from "./quote-worksheet";
import type { Store } from "./store";

function priceOption(db: Store, loanId: string, runId: string, offerId: string) {
  const run = db.prepare("SELECT scenario, offers FROM pricing_runs WHERE id = ? AND loanId = ? AND mode = 'mock'").get(runId, loanId);
  if (!run) return null;
  const offer = (JSON.parse(String(run.offers)) as PricingOffer[]).find((item) => item.id === offerId);
  return offer ? { scenario: JSON.parse(String(run.scenario)) as PricingScenario, offer } : null;
}

export function quoteFeeWorksheet(db: Store, loanId: string, runId: string, offerId: string): FeeWorksheet | undefined {
  const row = db.prepare("SELECT inputs, revision FROM fee_worksheets WHERE runId = ? AND offerId = ?").get(runId, offerId);
  return row ? { loanId, runId, offerId, inputs: JSON.parse(String(row.inputs)) as FeeInputs, revision: Number(row.revision) } : undefined;
}

export function saveFeeWorksheet(db: Store, data: z.infer<typeof saveFeeWorksheetInput>) {
  const { loanId, runId, offerId, feeRevision, worksheet } = data;
  const option = priceOption(db, loanId, runId, offerId);
  if (!option) return { error: "Choose a sample pricing option on this loan." };
  if (!estimateFees(option.scenario, option.offer, worksheet)) {
    return { error: option.scenario.purpose === "Purchase" ? "Enter a purchase price at or above the loan amount." : "Enter estimated refinance payoffs, including zero if applicable." };
  }
  const before = quoteFeeWorksheet(db, loanId, runId, offerId);
  if (JSON.stringify(before?.inputs) === JSON.stringify(worksheet)) return { message: "Fee worksheet is up to date." };
  if ((before?.revision ?? 0) !== feeRevision) return { error: "The fee worksheet changed. Refresh the loan before saving." };
  db.prepare(`INSERT INTO fee_worksheets (runId, offerId, inputs, revision) VALUES (?, ?, ?, 1)
    ON CONFLICT (runId, offerId) DO UPDATE SET inputs = excluded.inputs, revision = revision + 1`)
    .run(runId, offerId, JSON.stringify(worksheet));
  return { message: "Sample fee worksheet saved." };
}

export function quoteSnapshot(db: Store, loanId: string, choice: z.infer<typeof quoteSelection>) {
  const option = priceOption(db, loanId, choice.runId, choice.offerId);
  if (!option) return { error: "Choose sample pricing options on this loan." };
  const worksheet = quoteFeeWorksheet(db, loanId, choice.runId, choice.offerId);
  if ((worksheet?.revision ?? 0) !== choice.feeRevision) return { error: "A fee worksheet changed. Refresh the comparison before sharing." };
  return { option: quoteOption({ ...option, id: choice.runId }, option.offer, worksheet) };
}

export function archiveSharedQuote(db: Store, loanId: string, now: string, outcome: "Replaced" | "Removed") {
  db.prepare(`INSERT INTO shared_quote_history (loanId, runId, offerId, product, rate, principalAndInterest, quotedAt, publishedAt, endedAt, outcome, presentation)
    SELECT loanId, runId, offerId, product, rate, principalAndInterest, quotedAt, publishedAt, ?, ?, presentation
    FROM published_quotes WHERE loanId = ?`).run(now, outcome, loanId);
}
