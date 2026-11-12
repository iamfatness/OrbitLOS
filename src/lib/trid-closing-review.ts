import { shiftReportDate } from "./report-date-range";
import { reviewDisclosureFees } from "./trid-fee-evidence";
import type { TridEntry, TridEvent } from "./trid-model";
import { tridPreciseInterval } from "./trid-timing";

type FeeCure = Extract<TridEvent, { type: "feeCure" }>;
type Sent = Extract<TridEvent, { type: "sent" }>;

export function feeCureBasis(active: TridEntry[], event: FeeCure) {
  const consummation = active.find(entry => entry.sequence === event.consummationSequence)?.event;
  if (consummation?.type !== "consummated") return null;
  const review = reviewDisclosureFees(active, event);
  const original = review.snapshots.find(item => item.sequence === event.estimateSequence && item.document === "Initial LE");
  const closing = review.snapshots.find(item => item.sequence === event.closingSequence && item.document.endsWith("CD"));
  const comparison = closing && closing.sentOn <= consummation.on ? review.comparison : null;
  const send = active.find(entry => entry.sequence === event.correctedSendSequence)?.event;
  const corrected = send?.type === "sent" && send.document === "Corrected CD" && send.on >= consummation.on
    ? send : null;
  return { consummation, corrected, original, closing, comparison };
}

export function reviewFeeCures(active: TridEntry[]) {
  return active.flatMap(({ sequence, event }) => {
    if (event.type !== "feeCure") return [];
    const basis = feeCureBasis(active, event);
    const dueOn = basis ? shiftReportDate(basis.consummation.on, 60) : null;
    const potential = basis?.comparison?.potentialExcessCents ?? null;
    return [{
      sequence, dueOn, potential, refundCents: event.refundCents, refundOn: event.on, reference: event.reference,
      estimateSequence: event.estimateSequence, estimateVersion: basis?.original?.version ?? null,
      closingSequence: event.closingSequence, closingVersion: basis?.closing?.version ?? null,
      correctedSequence: event.correctedSendSequence, correctedVersion: basis?.corrected?.version ?? null,
      correctedOn: basis?.corrected?.on ?? null,
      refundStatus: !dueOn ? "Needs active consummation evidence" : event.on > dueOn ? "Recorded after deadline" : "Recorded within 60 days",
      amountStatus: potential === null ? "Needs complete fee comparison" : event.refundCents < potential
        ? "Below the potential excess" : "Meets or exceeds the potential excess",
      correctionStatus: !basis?.corrected || !dueOn ? "Needs linked corrected disclosure evidence"
        : basis.corrected.on > dueOn ? "Recorded after deadline" : "Recorded within 60 days",
    }];
  });
}

export function reviewCorrectedCds(active: TridEntry[]) {
  const events = active.map(entry => entry.event);
  const planned = events.findLast(event => event.type === "closing")?.on;
  const actual = events.find(event => event.type === "consummated")?.on;
  const closingOn = actual ?? planned;
  const receipts = events.filter(event => event.type === "received");
  function receipt(send: Sent) {
    const observed = receipts.find(item => item.document === send.document && item.version === send.version);
    if (observed) return { on: observed.on, basis: "Recorded receipt" };
    if (send.method === "Mail") return { on: tridPreciseInterval(send.on, 3), basis: "Presumed mail receipt" };
    return { on: null, basis: "Missing receipt" };
  }
  return active.flatMap(({ sequence, event: sent }) => {
    if (sent.type !== "sent" || sent.document !== "Corrected CD") return [];
    const review = events.filter(event => event.type === "correctedCdReview").find(event => event.sendSequence === sequence);
    const received = receipt(sent);
    let status = "Needs reason and reviewer evidence";
    let earliest = null;
    if (review?.reason === "Post-consummation correction") {
      status = !actual || sent.on <= actual ? "Verify that the correction followed actual consummation"
        : "Review under post-consummation rules";
    } else if (review && actual && sent.on > actual) {
      status = "Review correction recorded after actual consummation";
    } else if (review?.reason === "Other pre-consummation correction") {
      status = !received.on || !closingOn ? "Needs receipt and consummation evidence"
        : received.on < closingOn ? "Recorded receipt precedes consummation"
        : received.on === closingOn ? "Verify same-day receipt order" : "Recorded receipt follows consummation";
    } else if (review) {
      earliest = received.on ? tridPreciseInterval(received.on, 3) : null;
      status = !earliest || !closingOn ? "Needs receipt and consummation evidence"
        : closingOn < earliest ? "Consummation falls short of restarted interval" : "Consummation date meets restarted interval";
    }
    return [{
      sequence, version: sent.version, sentOn: sent.on, reason: review?.reason ?? null, reference: review?.reference ?? null,
      receiptOn: received.on, receiptBasis: received.basis, earliest, closingOn: closingOn ?? null, status,
    }];
  });
}
