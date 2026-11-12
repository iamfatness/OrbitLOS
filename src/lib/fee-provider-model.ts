import { z } from "zod";
import type { PricingScenario } from "./pricing-model";
import type { FeeInputs, FeePropertyLocation, FeeTemplateOrigin } from "./quote-worksheet";

const feeScope = { loanId: z.string().min(1).max(100), runId: z.string().min(1).max(100), offerId: z.string().min(1).max(100) };
export const feeEstimateLookup = z.object({ type: z.literal("recentFeeEstimate"), ...feeScope });
export const feeEstimateRequest = z.object({
  type: z.literal("requestFeeEstimate"), ...feeScope, requestId: z.uuid(), retryOf: z.uuid().optional(),
  scenario: z.enum(["Estimate", "No coverage", "Temporary error"]),
});

export type FeeProviderRequest = Pick<PricingScenario, "purpose" | "loanAmount" | "propertyValue" | "purchasePrice"> & {
  property: FeePropertyLocation; requestId: string; retryOf?: string;
};
type FeeProviderResult =
  | { status: "Available"; fees: FeeInputs["fees"]; allocations?: FeeInputs["allocations"] }
  | { status: "Unavailable" | "Failed"; message: string };

export interface FeeProvider {
  id: string;
  name: string;
  estimate(input: FeeProviderRequest): FeeProviderResult | Promise<FeeProviderResult>;
}

export type FeeProviderEvidence = {
  mode: "Simulated"; providerId: string; providerName: string; reference: string; receivedAt: string;
};
export type FeeProviderEstimate = FeeProviderResult & FeeProviderEvidence & {
  requestId: string; property: FeePropertyLocation; retryOf?: string;
};
export type FeeProviderResponse = { estimate: FeeProviderEstimate | null };

export function feeProviderOrigin(estimate: Extract<FeeProviderEstimate, { status: "Available" }>, effectiveOn: string): FeeTemplateOrigin {
  const { providerId, providerName, reference, receivedAt, mode, property, requestId, fees, allocations } = estimate;
  return {
    id: requestId, revision: 1, title: providerName, source: "Simulated fee estimate", effectiveOn, zip: property.zip,
    property, fees, ...(allocations ? { allocations } : {}), providerEstimate: { providerId, providerName, reference, receivedAt, mode },
  };
}
