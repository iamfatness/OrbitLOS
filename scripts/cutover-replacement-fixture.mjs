import assert from "node:assert/strict";

export async function recordFictionalReplacement({ read, write, borrower, submissionId, conditionId }) {
  const document = async () => (await read()).documentRequests.find((request) => request.conditionId === conditionId);
  const condition = async () => (await read()).submissions.find(({ id }) => id === submissionId).conditions.find(({ id }) => id === conditionId);
  const mutate = async (input) => {
    const result = await write(input);
    assert.ok(result.message, result.error);
  };
  async function receiveSample() {
    const current = await document();
    const result = await borrower({ type: "attachSample", statusOnly: true, requestId: current.id, revision: current.revision });
    assert.equal(result.error, undefined);
    const received = await document();
    assert.equal(received.status, "Received");
    await mutate({ type: "reviewDocument", requestId: received.id, revision: received.revision, decision: "Accepted", replacementNote: "" });
    return document();
  }
  async function recordDelivery(documentRevision, reference) {
    await mutate({ type: "recordManualDelivery", submissionId, conditionId, revision: (await condition()).manual.revision, documentRevision, reference });
  }
  const priorReference = "CUTOVER-PRIOR-RECEIPT";
  const currentReference = "CUTOVER-CURRENT-RECEIPT";
  const clearanceReference = "CUTOVER-CLEARANCE";
  const prior = await receiveSample();
  await recordDelivery(prior.revision, priorReference);
  await mutate({ type: "reviewDocument", requestId: prior.id, revision: prior.revision, decision: "Needs replacement", replacementNote: "Use the newer fictional pay stub." });
  const current = await receiveSample();
  await recordDelivery(current.revision, currentReference);
  await mutate({ type: "recordManualClearance", submissionId, conditionId, revision: (await condition()).manual.revision, cleared: true, confirmation: clearanceReference });
  const cleared = await condition();
  return {
    document: { kind: current.kind, instructions: current.instructions, status: "Accepted", dueOn: current.dueOn,
      evidence: { revision: current.revision, acceptedRevisions: [prior.revision, current.revision] } },
    condition: { category: cleared.category, description: cleared.description, status: "Cleared",
      evidence: { receipts: [{ reference: priorReference, documentRevision: prior.revision, state: "Prior" },
        { reference: currentReference, documentRevision: current.revision, state: "Current" }],
      clearance: { at: cleared.satisfiedAt, reference: clearanceReference } } },
  };
}
