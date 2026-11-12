import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { loanAccess } from "./workspace-access";
import { activeTridEntries, tridLocalDate, tridTiming } from "./trid-timing";
import { isLoanEstimateReceipt, type TridEntry, type TridEvent, type TridRequest } from "./trid-model";
import { estimateRevisionBasis, reviewDisclosureFees, reviewEstimateRevisions } from "./trid-fee-evidence";
import { feeCureBasis, reviewCorrectedCds, reviewFeeCures } from "./trid-closing-review";
import { reviewMichiganCharges } from "./michigan-charge-review";
import { reviewMichiganBooklet } from "./michigan-booklet-review";

export function initializeTridEvidence(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS compliance_trid_evidence (
    brokerageId TEXT NOT NULL, loanId TEXT NOT NULL, sequence INTEGER NOT NULL,
    requestId TEXT NOT NULL, actor TEXT NOT NULL, actorRevision INTEGER NOT NULL, at TEXT NOT NULL, event TEXT NOT NULL,
    PRIMARY KEY(brokerageId,loanId,sequence), UNIQUE(brokerageId,requestId));`);
}

const unavailable = { error: "TRID evidence is available on accessible Michigan pilot applications." };
const changed = { error: "TRID evidence changed. Refresh and review before saving." };

function validateEvent(event: TridEvent, entries: TridEntry[], now: string) {
  const active = activeTridEntries(entries);
  const scope = active.map(entry => entry.event).findLast(item => item.type === "scope");
  if (event.type === "scope") {
    if (event.calendarFrom > event.calendarThrough || event.closures.some(day => event.extraOpen.includes(day))) {
      return "Check the office calendar date range and conflicting open and closed dates.";
    }
    if (scope && scope.zone !== event.zone && active.some(entry => "on" in entry.event)) {
      return "Resolve the previously recorded dates before changing the review time zone.";
    }
    if (scope && scope.creditor !== event.creditor && active.some(entry => entry.event.type === "sent")) {
      return "Resolve the existing disclosure evidence before changing the creditor.";
    }
    return;
  }
  const sent = active.map(entry => entry.event).filter(item => item.type === "sent");
  const receipts = active.map(entry => entry.event).filter(item => item.type === "received");
  if (event.type === "void") {
    const target = active.find(entry => entry.sequence === event.sequence)?.event;
    if (!target) return "Select an active evidence entry.";
    if (target.type === "scope" && active.some(entry => "on" in entry.event || entry.event.type === "miChargeReview")) {
      return "Record an updated scope instead of withdrawing the scope for existing evidence.";
    }
    if (target.type === "sent" && receipts.some(item => item.document === target.document && item.version === target.version)) {
      return "Withdraw the matching receipt evidence before withdrawing its send record.";
    }
    if (target.type === "sent" && sent.some(item =>
      (target.document === "Initial CD" && item.document === "Corrected CD") ||
      (target.document === "Initial LE" && item.document === "Revised LE"))) {
      return "Resolve later disclosure versions before withdrawing the initial send.";
    }
    return;
  }
  if (!scope) return "Record the covered scenario and office calendar first.";
  if (event.type === "miBookletReview") {
    if (active.some(entry => entry.event.type === "miBookletReview"))
      return "Withdraw the earlier booklet review before recording a correction.";
    const today = tridLocalDate(now, scope.zone);
    if (event.on > today || (event.delivery && event.delivery.on > today))
      return "Application and booklet delivery evidence cannot be dated in the future.";
    return;
  }
  if (event.type === "miChargeReview") {
    if (active.some(entry => entry.event.type === "miChargeReview" && entry.event.key === event.key))
      return "Withdraw the earlier review for this charge before recording a correction.";
    return;
  }
  if (event.type === "feeSnapshot") {
    const source = active.find(entry => entry.sequence === event.evidenceSequence)?.event;
    if (source?.type !== "sent") {
      return "Select an active disclosure send as the source for the amounts.";
    }
    if (!source.document.endsWith("CD") && event.lines.some(line => line.notObtained)) {
      return "Record services the borrower did not obtain on the Closing Disclosure snapshot.";
    }
    const snapshots = active.map(entry => entry.event).filter(item => item.type === "feeSnapshot");
    if (snapshots.some(item => item.evidenceSequence === event.evidenceSequence)) {
      return "Withdraw the prior fee snapshot before recording a correction for this disclosure.";
    }
    if (snapshots.length >= 12) return "This file reached the active fee snapshot limit. Review its existing snapshots.";
    if (entries.filter(entry => entry.event.type === "feeSnapshot").length >= 24) {
      return "This file reached the fee snapshot history limit. Contact the compliance owner.";
    }
    return;
  }
  if (event.type === "correctedCdReview") {
    if (!active.some(entry => entry.sequence === event.sendSequence && entry.event.type === "sent" && entry.event.document === "Corrected CD")) {
      return "Choose an active corrected Closing Disclosure send.";
    }
    if (active.some(entry => entry.event.type === "correctedCdReview" && entry.event.sendSequence === event.sendSequence)) {
      return "Withdraw the earlier review before recording a replacement.";
    }
    return;
  }
  if (event.type !== "closing" && event.on > tridLocalDate(now, scope.zone)) return "Receipt and delivery evidence cannot be dated in the future.";
  if (event.type === "consummated" && active.some(entry => entry.event.type === "consummated")) {
    return "Withdraw the earlier consummation entry before recording a correction.";
  }
  if (event.type === "feeCure") {
    const basis = feeCureBasis(active, event);
    if (!basis?.comparison) return "Choose active consummation, original estimate and closing disclosure evidence.";
    if (event.on < basis.consummation.on) return "The refund date cannot precede actual consummation in this review.";
    if (event.correctedSendSequence && !basis.corrected) return "Choose an active corrected disclosure sent on or after consummation.";
    if (active.some(entry => entry.event.type === "feeCure")) return "Withdraw the earlier cure record before recording a replacement.";
  }
  if (event.type === "estimateRevision") {
    if (!estimateRevisionBasis(active, event)) return "Choose active original and revised Loan Estimates with the affected charge keys.";
    if (active.some(entry => entry.event.type === "estimateRevision" && entry.event.revisedSequence === event.revisedSequence)) {
      return "Withdraw the earlier revision review before recording a replacement.";
    }
  }
  if (event.type === "element" && active.some(entry => entry.event.type === "element" && entry.event.element === event.element)) {
    return "Withdraw the original entry with a correction reference before recording a replacement.";
  }
  if (event.type === "sent") {
    if (event.method === "Electronic" && !event.consentReference) return "Enter the electronic consent evidence reference.";
    if (event.document.endsWith("CD") && event.sender === "Broker") return "Record the creditor or settlement agent as the CD sender.";
    if (sent.some(item => item.document === event.document && (item.version === event.version || event.document.startsWith("Initial")))) {
      return "This send is already recorded. Use a new revision or correct the original entry.";
    }
    if ((event.document === "Corrected CD" || event.document === "Revised LE") &&
      !sent.some(item => item.document === (event.document === "Corrected CD" ? "Initial CD" : "Initial LE") && item.on <= event.on)) {
      return "Record the corresponding initial disclosure first.";
    }
  }
  if (event.type === "received") {
    const dispatch = sent.find(item => item.document === event.document && item.version === event.version);
    if (!dispatch || dispatch.on > event.on) return "Match an existing sent version and use a receipt date on or after send.";
    if (receipts.some(item => item.document === event.document && item.version === event.version)) {
      return "Withdraw the original receipt entry before recording a correction.";
    }
  }
  if (event.type === "intent") {
    const receipt = active.find(entry => entry.sequence === event.receiptSequence)?.event;
    if (!receipt || !isLoanEstimateReceipt(receipt)) return "Choose a recorded Loan Estimate receipt.";
  }
  if (event.type === "fee" && event.intentSequence !== undefined &&
    !active.some(entry => entry.sequence === event.intentSequence && entry.event.type === "intent")) {
    return "Choose an active intent entry or leave the fee unlinked for review.";
  }
}

/** Runs inside the authenticated compliance transaction. Dates are staff attestations with source references. */
export function tridEvidenceWork(db: Store, input: TridRequest, staff: WorkspaceStaff, now: string) {
  const { loanId } = input;
  const tenant = staff.brokerage.id;
  const access = loanAccess(db, staff, loanId);
  if (!access || !db.prepare(`SELECT 1 FROM applications WHERE loanId=?
    AND upper(trim(json_extract(draft,'$.propertyLocation.state')))='MI'`).get(loanId)) return unavailable;
  const records = db.prepare(`SELECT sequence,actor,actorRevision,at,event,requestId FROM compliance_trid_evidence
    WHERE brokerageId=? AND loanId=? ORDER BY sequence`).all(tenant, loanId);
  const entries: TridEntry[] = records.map(row => ({
    sequence: Number(row.sequence), at: String(row.at), actor: String(row.actor), event: JSON.parse(String(row.event)) as TridEvent,
  }));
  const current = () => {
    const active = activeTridEntries(entries);
    return {
      revision: entries.at(-1)?.sequence ?? 0,
      entries,
      timing: tridTiming(entries, now),
      feeReview: reviewDisclosureFees(active, input.operation === "read" ? input.feeBasis : undefined),
      estimateRevisions: reviewEstimateRevisions(active),
      feeCures: reviewFeeCures(active),
      correctedCds: reviewCorrectedCds(active),
      michiganCharges: reviewMichiganCharges(active),
      michiganBooklet: reviewMichiganBooklet(active),
    };
  };
  if (input.operation === "read") return current();
  if (access === "processor") return { error: "Only the assigned loan officer or an admin can record TRID evidence." };
  if (db.prepare("SELECT disposition FROM loans WHERE id=?").get(loanId)?.disposition !== "Active") {
    return { error: "This loan is paused. Resume it before recording evidence." };
  }
  const eventJson = JSON.stringify(input.event);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const replay = db.prepare("SELECT loanId,actor,actorRevision,event FROM compliance_trid_evidence WHERE brokerageId=? AND requestId=?")
    .get(tenant, input.requestId);
  if (replay) return replay.loanId === loanId && replay.actor === staff.email && replay.actorRevision === actorRevision && replay.event === eventJson
    ? current() : changed;
  if (input.expectedRevision !== entries.length) return changed;
  if (entries.length >= 200) return { error: "This file reached the pilot evidence limit. Contact the compliance owner to continue review." };
  const invalid = validateEvent(input.event, entries, now);
  if (invalid) return { error: invalid };
  const sequence = entries.length + 1;
  db.prepare("INSERT INTO compliance_trid_evidence VALUES (?,?,?,?,?,?,?,?)")
    .run(tenant, loanId, sequence, input.requestId, staff.email, actorRevision, now, eventJson);
  entries.push({ sequence, at: now, actor: staff.email, event: input.event });
  return current();
}
