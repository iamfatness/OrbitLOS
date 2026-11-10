import { createHash } from "node:crypto";
import { z } from "zod";
import { sampleWorkbenchReview } from "./compliance-inventory";
import type { Store } from "./store";

const revision = z.number().int().positive();
const workbenchReview = z.object({ reviewer: z.string(), reviewedAt: z.string() });
const caseEvidence = workbenchReview.extend({ revision, recordedBy: z.string(), recordedAt: z.string() });
const basis = z.object({
  packageVersion: revision,
  packageRevision: revision,
  workbenchReview: workbenchReview.nullable(),
  caseEvidence: caseEvidence.nullable(),
});
const outcomes = ["Workbench review missing", "Case evidence missing", "Case evidence out of date", "Sample evidence matches"] as const;

const ruleId = "sample-receipt-evidence";
const ruleVersion = 1;
export const sampleReceiptFingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const sampleReceiptEvaluation = z.object({
  version: z.literal(ruleVersion),
  fingerprint: sampleReceiptFingerprint,
  basis,
  outcome: z.enum(outcomes),
});
export type SampleReceiptEvaluation = z.infer<typeof sampleReceiptEvaluation>;
const recordedReview = z.object({ sampleEvidence: workbenchReview });
type Basis = z.infer<typeof basis>;

export function evaluateSampleReceipt(evidence: Basis): SampleReceiptEvaluation {
  const { workbenchReview, caseEvidence } = evidence;
  let outcome: (typeof outcomes)[number];
  if (!workbenchReview) outcome = "Workbench review missing";
  else if (!caseEvidence) outcome = "Case evidence missing";
  else if (caseEvidence.reviewer !== workbenchReview.reviewer || caseEvidence.reviewedAt !== workbenchReview.reviewedAt) outcome = "Case evidence out of date";
  else outcome = "Sample evidence matches";
  const fingerprint = createHash("sha256").update(JSON.stringify([ruleId, ruleVersion, basis.parse(evidence)])).digest("hex");
  return { version: ruleVersion, fingerprint, basis: evidence, outcome };
}

export function sampleReceiptBasis(db: Store, scope: { brokerageId: string; caseId: string; loanId: string }, packageVersion: number, packageRevision: number): Basis {
  const workbench = sampleWorkbenchReview(db, scope.loanId, packageVersion, packageRevision);
  const recorded = db.prepare(`SELECT revision, actor, at, payload FROM compliance_case_events
    WHERE brokerageId = ? AND caseId = ? AND action = 'recordSampleReview' AND json_extract(payload, '$.request.packageRevision') = ?
    ORDER BY revision DESC LIMIT 1`).get(scope.brokerageId, scope.caseId, packageRevision);
  const evidence = typeof recorded?.payload === "string" ? recordedReview.safeParse(JSON.parse(recorded.payload)) : undefined;
  return { packageVersion, packageRevision,
    workbenchReview: workbench ? { reviewer: String(workbench.actor), reviewedAt: String(workbench.reviewedAt) } : null,
    caseEvidence: evidence?.success ? { ...evidence.data.sampleEvidence, revision: Number(recorded?.revision),
      recordedBy: String(recorded?.actor), recordedAt: String(recorded?.at) } : null,
  };
}

export function lastSampleReceiptEvaluation(db: Store, brokerageId: string, caseId: string) {
  const row = db.prepare(`SELECT revision, actor, at, payload FROM compliance_case_events
    WHERE brokerageId = ? AND caseId = ? AND action = 'evaluateSampleReceipt' ORDER BY revision DESC LIMIT 1`).get(brokerageId, caseId);
  const payload = typeof row?.payload === "string" ? JSON.parse(row.payload) : null;
  const parsed = sampleReceiptEvaluation.safeParse(payload?.sampleEvaluation);
  return parsed.success ? { ...parsed.data, revision: Number(row?.revision), actor: String(row?.actor), at: String(row?.at) } : null;
}
