import { compareDisclosureFees } from "./trid-fee-comparison";
import type { TridEntry } from "./trid-model";

type FeeBasis = { estimateSequence: number; closingSequence: number };

export function reviewDisclosureFees(active: TridEntry[], basis?: FeeBasis) {
  const sends = new Map(active.flatMap(({ sequence, event }) => event.type === "sent" ? [[sequence, event] as const] : []));
  const snapshots = active.flatMap(({ sequence, event }) => {
    if (event.type !== "feeSnapshot") return [];
    const send = sends.get(event.evidenceSequence);
    return send ? [{ sequence, send, snapshot: event }] : [];
  });
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
