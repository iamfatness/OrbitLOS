import { compareDisclosureFees } from "./trid-fee-comparison";
import type { TridEntry, TridEvent } from "./trid-model";
import { tridOfficeDeadline, tridPreciseInterval } from "./trid-timing";

type FeeBasis = { estimateSequence: number; closingSequence: number };
type EstimateRevision = Extract<TridEvent, { type: "estimateRevision" }>;

function linkedSnapshots(active: TridEntry[]) {
  const sends = new Map(active.flatMap(({ sequence, event }) => event.type === "sent" ? [[sequence, event] as const] : []));
  return active.flatMap(({ sequence, event }) => {
    if (event.type !== "feeSnapshot") return [];
    const send = sends.get(event.evidenceSequence);
    return send ? [{ sequence, send, snapshot: event }] : [];
  });
}

export function estimateRevisionBasis(active: TridEntry[], event: EstimateRevision) {
  const snapshots = linkedSnapshots(active);
  const original = snapshots.find(item => item.sequence === event.originalSequence && item.send.document === "Initial LE");
  const revised = snapshots.find(item => item.sequence === event.revisedSequence && item.send.document === "Revised LE");
  if (!original || !revised || revised.send.on < original.send.on) return null;
  const keys = new Set(revised.snapshot.lines.map(line => line.key));
  return event.chargeKeys.every(key => keys.has(key)) ? { original, revised } : null;
}

export function reviewEstimateRevisions(active: TridEntry[]) {
  const events = active.map(entry => entry.event);
  const scope = events.findLast(event => event.type === "scope");
  const closing = events.findLast(event => event.type === "closing");
  const initialCd = events.filter(event => event.type === "sent").find(event => event.document === "Initial CD");
  const receipts = events.filter(event => event.type === "received");
  return active.flatMap(({ sequence, event }) => {
    if (event.type !== "estimateRevision") return [];
    const basis = estimateRevisionBasis(active, event);
    if (!basis) return [{ sequence, status: "Needs active original and revised estimate evidence", dueOn: null, receivedOn: null }];
    const { original, revised } = basis;
    const dueOn = scope ? tridOfficeDeadline(event.on, scope) : null;
    const receivedOn = receipts.find(receipt => receipt.document === "Revised LE" && receipt.version === revised.send.version)?.on ?? null;
    const earliest = receivedOn ? tridPreciseInterval(receivedOn, 4) : null;
    const issues = [];
    if (event.on < original.send.on || revised.send.on < event.on) issues.push("Review the chronology of the reason and disclosures");
    if (!dueOn) issues.push("Needs office calendar coverage");
    else if (revised.send.on > dueOn) issues.push("Revised estimate sent after the calculated date");
    if (!scope || revised.send.sender !== scope.leSender) issues.push("Review sender responsibility");
    if (!initialCd) issues.push("Needs initial Closing Disclosure send for comparison");
    else if (revised.send.on >= initialCd.on) issues.push("Revised estimate sent on or after the initial Closing Disclosure");
    if (!receivedOn || !closing || !earliest) issues.push("Needs actual revised estimate receipt and planned consummation");
    else if (closing.on < earliest) issues.push("Planned consummation falls within the four-day interval");
    if (!event.reviewReference) issues.push("Needs review evidence for the reason and affected charges");
    return [{ sequence, status: issues.length ? issues.join(". ") : "Recorded dates meet the checks. Review the proposed fee basis.",
      dueOn, receivedOn }];
  });
}

export function reviewDisclosureFees(active: TridEntry[], basis?: FeeBasis) {
  const snapshots = linkedSnapshots(active);
  const estimate = basis && snapshots.find(item => item.sequence === basis.estimateSequence && item.send.document === "Initial LE");
  const closing = basis && snapshots.find(item => item.sequence === basis.closingSequence && item.send.document.endsWith("CD"));
  const unavailable = Boolean(basis && (!estimate || !closing || closing.send.on < estimate.send.on));
  const comparison = estimate && closing && !unavailable
    ? compareDisclosureFees(
      { evidenceSequence: estimate.snapshot.evidenceSequence, reference: estimate.snapshot.reference,
        complete: estimate.snapshot.complete, lines: estimate.snapshot.lines },
      { evidenceSequence: closing.snapshot.evidenceSequence, reference: closing.snapshot.reference,
        complete: closing.snapshot.complete, lines: closing.snapshot.lines },
    ) : null;
  return {
    snapshots: snapshots.map(({ sequence, send, snapshot }) => ({
      sequence, document: send.document, version: send.version, sentOn: send.on, evidenceSequence: snapshot.evidenceSequence,
      complete: snapshot.complete, lineCount: snapshot.lines.length,
    })),
    unavailable,
    comparison,
  };
}
