import { z } from "zod";

export const feeReviewBuckets = ["Individual", "Ten percent aggregate", "Variation review", "Unclassified"] as const;

const feeLine = z.strictObject({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  borrowerCents: z.number().int().min(0).max(100_000_000_00),
  bucket: z.enum(feeReviewBuckets),
  notObtained: z.literal(true).optional(),
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
    if (line.notObtained && line.borrowerCents !== 0) ctx.addIssue({ code: "custom", path: ["lines", index, "borrowerCents"], message: "Use zero for a service the borrower did not obtain." });
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
    const needsClosingEvidence = bucket === "Ten percent aggregate" && !!estimated && !charged;
    const notObtained = charged?.notObtained === true;
    const estimatedCents = estimated?.borrowerCents ?? (estimate.complete ? 0 : null);
    const chargedCents = charged?.borrowerCents ?? (actual.complete && !needsClosingEvidence ? 0 : null);
    const differenceCents = estimatedCents === null || chargedCents === null ? null : chargedCents - estimatedCents;
    return {
      key, label: (charged ?? estimated)!.label, bucket, classificationConflict, needsClosingEvidence, notObtained,
      estimatedCents, chargedCents, differenceCents,
      individualExcessCents: bucket === "Individual" && differenceCents !== null ? Math.max(0, differenceCents) : null,
    };
  });
  const aggregateRows = rows.filter(row => row.bucket === "Ten percent aggregate" && !row.notObtained);
  const unresolved = rows.filter(row => row.bucket === "Unclassified" || row.differenceCents === null);
  const variationRows = rows.filter(row => row.bucket === "Variation review");
  const amountsComplete = estimate.complete && actual.complete && unresolved.length === 0;
  const complete = amountsComplete && variationRows.length === 0;
  const aggregate = amountsComplete ? {
    estimatedCents: aggregateRows.reduce((sum, row) => sum + row.estimatedCents!, 0),
    chargedCents: aggregateRows.reduce((sum, row) => sum + row.chargedCents!, 0),
  } : null;
  const aggregateExcessCents = aggregate
    ? Math.max(0, aggregate.chargedCents - Math.floor(aggregate.estimatedCents * 11 / 10))
    : null;
  const individualExcessCents = rows.reduce((sum, row) => sum + (row.individualExcessCents ?? 0), 0);
  return {
    rows, unresolvedKeys: rows.filter(row => row.bucket === "Unclassified" || row.bucket === "Variation review" || row.differenceCents === null).map(row => row.key), complete,
    estimateSequence: estimate.evidenceSequence, actualSequence: actual.evidenceSequence,
    aggregate, aggregateExcessCents, individualExcessCents,
    potentialExcessCents: complete && aggregateExcessCents !== null ? individualExcessCents + aggregateExcessCents : null,
  };
}
