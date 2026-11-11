// Test-only, single-command recovery policy. Never infer a client acknowledgment
// from a matching value. A reviewer may preserve an observed, exact revision.
const fields = ["id", "revision", "deadlineRevision", "dueOn"];
export const sameDocument = (a, b) => !!a && !!b && fields.every(key => Object.hasOwn(a,key) && Object.hasOwn(b,key) && a[key] === b[key]);

export function expectedDeadline(receipt) {
  const { before, command } = receipt;
  if (!before || command?.type !== "setDocumentDeadline" || command.requestId !== before.id ||
      command.revision !== before.revision || command.deadlineRevision !== before.deadlineRevision ||
      !Number.isSafeInteger(before.revision) || before.revision < 0 ||
      !Number.isSafeInteger(before.deadlineRevision) || before.deadlineRevision < 0 ||
      !(command.dueOn === null || /^\d{4}-\d{2}-\d{2}$/.test(command.dueOn))) throw new Error("Invalid deadline receipt");
  return {...before, deadlineRevision: before.deadlineRevision + (before.dueOn === command.dueOn ? 0 : 1), dueOn: command.dueOn};
}

export function reviewPending(receipt, current, identity) {
  if (receipt.tenant !== identity.tenant || receipt.run !== identity.run || receipt.source !== identity.source || receipt.status !== "pending") {
    throw new Error("Pending receipt provenance mismatch");
  }
  const expected = expectedDeadline(receipt);
  if (!current) return "unavailable";
  // A no-op cannot prove this request ran. Preserve it as unresolved.
  if (sameDocument(current, receipt.before)) return "not-observed";
  if (sameDocument(current, expected)) return "matches-intended-revision";
  return "conflict";
}

export function assertReplayReceipt(receipt, identity) {
  if (receipt.tenant !== identity.tenant || receipt.run !== identity.run || receipt.source !== identity.source ||
      !sameDocument(receipt.after, expectedDeadline(receipt))) throw new Error("Recovery receipt provenance or result mismatch");
  if (receipt.status === "acknowledged") return;
  if (receipt.status === "reconciled" && receipt.review?.decision === "preserve-observed" &&
      receipt.review.by && receipt.review.at && sameDocument(receipt.review.observed, receipt.after)) return;
  throw new Error("Unverified recovery receipt");
}

export function remainingReplay(receipts, current, identity) {
  if (!receipts.length) throw new Error("Missing recovery receipts");
  receipts.forEach(receipt => assertReplayReceipt(receipt, identity));
  for (let i=1;i<receipts.length;i++) {
    if (receipts[i].command.loanId !== receipts[0].command.loanId || !sameDocument(receipts[i-1].after,receipts[i].before)) {
      throw new Error("Recovery receipt chain differs");
    }
  }
  if (sameDocument(current, receipts[0].before)) return receipts;
  const applied = receipts.findLastIndex(receipt => sameDocument(current, receipt.after));
  if (applied < 0) throw new Error("Receipt conflicts with restored document");
  return receipts.slice(applied+1);
}
