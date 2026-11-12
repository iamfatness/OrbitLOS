import type { z } from "zod";
import { easternDate } from "./client-retention";
import { feeProviderOrigin, type FeeProvider, type FeeProviderEstimate, type FeeProviderResponse,
  type feeEstimateLookup, type feeEstimateRequest } from "./fee-provider-model";
import { pricingInputError } from "./income-review-freshness";
import type { PricingOffer, PricingScenario } from "./pricing-model";
import { propertyStateCodes } from "./property-state";
import { blankFees, type FeePropertyLocation } from "./quote-worksheet";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { loanAccess } from "./workspace-access";
import { zipCityState } from "./zip-city-state";

const sampleFeeProvider = {
  id: "orbit-sample-fees",
  name: "Orbit sample fee provider",
  estimate({ property, purpose }) {
    if (!property.state) return { status: "Unavailable", message: "The sample provider has no estimate for this property." };
    return { status: "Available", fees: {
      ...blankFees(), appraisal: 67500, settlement: purpose === "Purchase" ? 132500 : 97500, government: 28500,
    } };
  },
} satisfies FeeProvider;

export function feeProperty(zip: string): FeePropertyLocation {
  const state = zipCityState(zip)?.state;
  return state && propertyStateCodes.includes(state) ? { zip, state } : { zip };
}

type Request = z.infer<typeof feeEstimateLookup> | z.infer<typeof feeEstimateRequest>;
export function feeEstimateWork(db: Store, data: Request, staff: WorkspaceStaff | null, now: string): FeeProviderResponse | { error: string } {
  if (!staff?.brokerage.pilot || !loanAccess(db, staff, data.loanId)) return { error: "Simulated fee estimates are unavailable for this loan." };
  const { runId, offerId } = data;
  const run = db.prepare(`SELECT scenario, offers, applicationRevision, incomeReviewRevision FROM pricing_runs
    WHERE id = ? AND loanId = ? AND mode = 'mock'`).get(runId, data.loanId);
  if (!run || !(JSON.parse(String(run.offers)) as PricingOffer[]).some((offer) => offer.id === offerId)) {
    return { error: "Choose a current sample pricing option before requesting a fee estimate." };
  }
  const app = db.prepare("SELECT revision, correctionNote FROM applications WHERE loanId = ?").get(data.loanId);
  const freshness = pricingInputError(db, data.loanId, { applicationRevision: run.applicationRevision, incomeReviewRevision: run.incomeReviewRevision },
    app ? { revision: Number(app.revision), correctionNote: String(app.correctionNote ?? "") } : undefined);
  if (freshness) return { error: freshness };
  const read = (id: string) => db.prepare("SELECT * FROM fee_provider_estimates WHERE id = ?").get(id);
  const estimateFrom = (row: { result?: unknown }) => JSON.parse(String(row.result)) as FeeProviderEstimate;
  if (data.type === "recentFeeEstimate") {
    const latest = db.prepare(`SELECT result FROM fee_provider_estimates WHERE runId = ? AND offerId = ? AND actorEmail = ?
      ORDER BY rowid DESC LIMIT 1`).get(runId, offerId, staff.email);
    return { estimate: latest ? estimateFrom(latest) : null };
  }
  return db.transaction(() => {
    const inScope = (row: ReturnType<typeof read>) => row?.runId === runId && row.offerId === offerId && row.actorEmail === staff.email;
    const prior = read(data.requestId);
    if (prior) {
      if (!inScope(prior) || prior.scenario !== data.scenario || prior.retryOf !== (data.retryOf ?? null)) {
        return { error: "This request belongs to a different fee estimate." };
      }
      return { estimate: estimateFrom(prior) };
    }
    if (data.retryOf) {
      const previous = read(data.retryOf);
      if (!previous || !inScope(previous) || previous.scenario !== data.scenario || estimateFrom(previous).status !== "Failed") {
        return { error: "Retry the failed estimate for this pricing option." };
      }
    }
    const scenario = JSON.parse(String(run.scenario)) as PricingScenario;
    const property = feeProperty(scenario.zip);
    const result = data.scenario === "No coverage"
      ? { status: "Unavailable", message: "The sample provider has no estimate for this property." } as const
      : data.scenario === "Temporary error" && !data.retryOf
        ? { status: "Failed", message: "The sample provider could not complete this request." } as const
        : sampleFeeProvider.estimate({ property, requestId: data.requestId, retryOf: data.retryOf, purpose: scenario.purpose, loanAmount: scenario.loanAmount,
          propertyValue: scenario.propertyValue, purchasePrice: scenario.purchasePrice });
    const estimate: FeeProviderEstimate = {
      ...result, requestId: data.requestId, providerId: sampleFeeProvider.id, providerName: sampleFeeProvider.name,
      reference: data.requestId, mode: "Simulated", receivedAt: now, property, ...(data.retryOf ? { retryOf: data.retryOf } : {}),
    };
    db.prepare(`INSERT INTO fee_provider_estimates (id, runId, offerId, actorEmail, scenario, retryOf, result)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(data.requestId, runId, offerId, staff.email, data.scenario, data.retryOf ?? null, JSON.stringify(estimate));
    return { estimate };
  });
}

export function savedFeeProviderOrigin(db: Store, id: string, runId: string, offerId: string) {
  const row = db.prepare("SELECT result FROM fee_provider_estimates WHERE id = ? AND runId = ? AND offerId = ?").get(id, runId, offerId);
  if (!row) return;
  const estimate = JSON.parse(String(row.result)) as FeeProviderEstimate;
  if (estimate.status === "Available") return feeProviderOrigin(estimate, easternDate(new Date(estimate.receivedAt)));
}
