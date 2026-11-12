import { z } from "zod";

export const feeReviewBuckets = ["Individual", "Ten percent aggregate", "Variation review", "Unclassified"] as const;

const feeLine = z.strictObject({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  borrowerCents: z.number().int().min(0).max(100_000_000_00),
  bucket: z.enum(feeReviewBuckets),
});
export const disclosureFeeSnapshot = z.strictObject({
  evidenceSequence: z.number().int().positive(),
  reference: z.string().trim().min(1).max(180),
  complete: z.boolean(),
  lines: z.array(feeLine).max(150),
}).superRefine(({ lines }, ctx) => {
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (seen.has(line.key)) ctx.addIssue({ code: "custom", path: ["lines", index, "key"], message: "Use one line per matched charge key." });
    seen.add(line.key);
  }
});

export type DisclosureFeeSnapshot = z.infer<typeof disclosureFeeSnapshot>;

/** Compare staff-reviewed classifications and amounts against the selected original estimate.
 * Linking an eligible revised basis, credits, and recording a cure are separate review steps.
 */
export function compareDisclosureFees(estimateInput: DisclosureFeeSnapshot, actualInput: DisclosureFeeSnapshot) {
  const estimate = disclosureFeeSnapshot.parse(estimateInput);
  const actual = disclosureFeeSnapshot.parse(actualInput);
  const estimates = new Map(estimate.lines.map(line => [line.key, line]));
  const actuals = new Map(actual.lines.map(line => [line.key, line]));
  const keys = new Set([...estimates.keys(), ...actuals.keys()]);
  const rows = Array.from(keys, key => {
    const estimated = estimates.get(key);
    const charged = actuals.get(key);
    const classificationConflict = Boolean(estimated && charged && estimated.bucket !== charged.bucket);
    const bucket = classificationConflict ? "Unclassified" : (estimated ?? charged)!.bucket;
    const estimatedCents = estimated?.borrowerCents ?? (estimate.complete ? 0 : null);
    const chargedCents = charged?.borrowerCents ?? (actual.complete ? 0 : null);
    const differenceCents = estimatedCents === null || chargedCents === null ? null : chargedCents - estimatedCents;
    return {
      key, label: (charged ?? estimated)!.label, bucket, classificationConflict, estimatedCents, chargedCents, differenceCents,
      individualExcessCents: bucket === "Individual" && differenceCents !== null ? Math.max(0, differenceCents) : null,
    };
  });
  const aggregateRows = rows.filter(row => row.bucket === "Ten percent aggregate");
  const unresolvedKeys = rows.filter(row => row.bucket === "Unclassified" || row.differenceCents === null).map(row => row.key);
  const complete = estimate.complete && actual.complete && unresolvedKeys.length === 0;
  const aggregate = complete ? {
    estimatedCents: aggregateRows.reduce((sum, row) => sum + row.estimatedCents!, 0),
    chargedCents: aggregateRows.reduce((sum, row) => sum + row.chargedCents!, 0),
  } : null;
  const aggregateExcessCents = aggregate
    ? Math.max(0, aggregate.chargedCents - Math.floor(aggregate.estimatedCents * 11 / 10))
    : null;
  const individualExcessCents = rows.reduce((sum, row) => sum + (row.individualExcessCents ?? 0), 0);
  return {
    rows, unresolvedKeys, complete,
    estimateSequence: estimate.evidenceSequence, actualSequence: actual.evidenceSequence,
    aggregate, aggregateExcessCents, individualExcessCents,
    potentialExcessCents: aggregateExcessCents === null ? null : individualExcessCents + aggregateExcessCents,
  };
}
