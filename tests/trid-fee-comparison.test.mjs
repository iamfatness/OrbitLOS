import assert from "node:assert/strict";
import test from "node:test";
import { compareDisclosureFees } from "../src/lib/trid-fee-comparison.ts";

const individual = "Individual";
const aggregate = "Ten percent aggregate";
const line = (key, borrowerCents, bucket) => ({ key, label: key, borrowerCents, bucket });
const snapshot = (evidenceSequence, lines, complete = true) => ({ evidenceSequence, reference: "Fictional evidence", lines, complete });

test("individual decreases do not offset increases and the aggregate includes new charges", () => {
  const result = compareDisclosureFees(
    snapshot(1, [line("appraisal", 10000, individual), line("origination", 80000, individual), line("title", 10000, aggregate)]),
    snapshot(2, [line("appraisal", 11000, individual), line("origination", 75000, individual), line("title", 10250, aggregate), line("notary", 1000, aggregate)]),
  );
  assert.equal(result.individualExcessCents, 1000);
  assert.equal(result.aggregateExcessCents, 250);
  assert.equal(result.potentialExcessCents, 1250);
  assert.deepEqual([result.estimateSequence, result.actualSequence], [1, 2]);
});

test("aggregate checks exact cent boundaries and refuses an incomplete comparison", () => {
  const original = snapshot(1, [line("title", 101, aggregate)]);
  assert.equal(compareDisclosureFees(original, snapshot(2, [line("title", 111, aggregate)])).aggregateExcessCents, 0);
  assert.equal(compareDisclosureFees(original, snapshot(2, [line("title", 112, aggregate)])).aggregateExcessCents, 1);
  const incomplete = compareDisclosureFees(snapshot(1, [], false), snapshot(2, [line("title", 112, aggregate)]));
  assert.equal(incomplete.rows[0].estimatedCents, null);
  assert.equal(incomplete.potentialExcessCents, null);
});

test("classification disagreement, unknowns, and duplicate matches require review", () => {
  const original = snapshot(1, [line("title", 1000, aggregate)]);
  const result = compareDisclosureFees(original, snapshot(2, [line("title", 1200, individual), line("other", 500, "Unclassified")]));
  assert.deepEqual(result.unresolvedKeys, ["title", "other"]);
  assert.equal(result.rows[0].classificationConflict, true);
  assert.equal(result.potentialExcessCents, null);
  assert.throws(() => compareDisclosureFees(original, snapshot(2, [line("title", 1000, aggregate), line("title", 1200, aggregate)])), /matched charge key/);
});
