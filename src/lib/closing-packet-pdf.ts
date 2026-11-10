import { dateLabel } from "./client-retention";
import type { ClosingPacket } from "./closing-packet-model";
import { pdfDocument, pdfSafeBodyText, pdfText, pdfWrappedLines } from "./pdf-document";
import { feeAllocationLabel, feeLabels } from "./quote-worksheet";
import { dateTime, requestedMoney } from "./utils";

const ink = "0.15 0.11 0.22";
const muted = "0.34 0.29 0.42";
const purple = "0.33 0.22 0.62";
const pageFloor = 73;
const lineHeight = 15;
const stamp = (value: string) => `${dateTime(value)} ET`;
const day = (value: string | null) => value ? dateLabel(value) : "Unscheduled";
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Conservative point widths for the 10-point Helvetica body.
function bodyWidth(value: string) {
  let points = 0;
  for (const character of value) {
    if (/[ijltfrI.,:;!'"| ]/.test(character)) points += 4.5;
    else if (/[mMwW]/.test(character)) points += 9.5;
    else if (/[a-z0-9]/.test(character)) points += 6.3;
    else if (/[A-Z]/.test(character)) points += 7.9;
    else points += 10.5;
  }
  return points;
}

export function closingPacketPdf({ version, preparedAt, preparedBy, snapshot }: ClosingPacket) {
  const { disclosure, checklist } = snapshot;
  const pages: string[][] = [];
  let stream: string[] = [];
  let y = 0;
  function text(value: string, x: number, baseline: number, size: number, color = ink, bold = false) {
    stream.push(`BT /${bold ? "B" : "R"} ${size} Tf ${color} rg 1 0 0 1 ${x} ${baseline} Tm <${pdfText(pdfSafeBodyText(value))}> Tj ET`);
  }
  function page() {
    stream = [];
    pages.push(stream);
    stream.push("0.93 0.90 0.99 rg 54 720 504 27 re f");
    text("SAMPLE ONLY  /  FICTIONAL CLOSING REHEARSAL", 66, 729, 10, purple, true);
    text("Sample closing packet", 54, 683, 27, ink, true);
    text(`OrbitLOS  /  Packet v${version}  /  Internal staff copy`, 54, 659, 10, muted);
    stream.push("0.88 0.85 0.92 RG 54 644 m 558 644 l S");
    y = 625;
  }
  function ensure(lines: number) {
    if (y - (lines - 1) * lineHeight < pageFloor) page();
  }
  function heading(value: string) {
    ensure(4);
    text(value.toUpperCase(), 54, y, 9, purple, true);
    y -= 19;
  }
  function rows(values: string[], inset = 0, size = 10) {
    const lines = values.flatMap((value) => pdfWrappedLines(pdfSafeBodyText(value), (500 - inset) * 10 / size, bodyWidth));
    ensure(lines.length);
    for (const line of lines) {
      ensure(1);
      text(line, 54 + inset, y, size);
      y -= lineHeight;
    }
  }

  page();
  heading("Loan and critical dates");
  rows([`Borrower: ${snapshot.borrower}`, `Property: ${snapshot.property || "Unspecified"}`,
    `Assigned loan officer: ${snapshot.officer || "Unassigned"}`, `Prepared by ${preparedBy} on ${stamp(preparedAt)}`]);
  rows([`Target closing: ${day(snapshot.targetDate)}`, `Recorded closing: ${day(snapshot.closingDate)}`,
    `Recorded funding: ${day(snapshot.fundingDate)}`]);
  y -= 7;
  heading("Confirmed disclosure evidence");
  rows([`Package v${disclosure.version} / 1003 revision ${disclosure.applicationRevision} / Fee worksheet revision ${disclosure.feeRevision}`,
    `Confirmed by ${disclosure.actor} on ${stamp(disclosure.at)}`,
    `Issued: ${disclosure.issuedAt ? stamp(disclosure.issuedAt) : "Unissued"} / Signing target: ${day(disclosure.signBy)}`,
    `${disclosure.product} / ${disclosure.rate.toFixed(3)}% / ${requestedMoney(disclosure.loanAmount)}`,
    `Estimated cash to close: ${disclosure.cashToClose === null ? "Unavailable" : cents.format(disclosure.cashToClose / 100)}`,
    `Sample documents: ${disclosure.documents.join(", ")}`]);
  for (const signer of disclosure.signers) {
    rows([`${signer.role}: ${signer.name} / ${signer.status}`,
      `${signer.receipt ?? "Receipt unavailable"}${signer.actedAt ? ` / ${stamp(signer.actedAt)}` : ""}`,
      ...(signer.respondedVia ? [signer.respondedVia] : [])], 12);
  }
  if (disclosure.changeReview) {
    const review = disclosure.changeReview;
    rows([`Change review from v${review.fromVersion}: ${review.reason}`,
      `${review.actor} on ${stamp(review.at)}`, review.note], 12);
  }
  if (disclosure.feeAllocations?.length) {
    y -= 7;
    heading("Sample fee allocations");
    for (const line of disclosure.feeAllocations) {
      rows([`${feeLabels[line.key]}: ${cents.format(line.amount / 100)}`, feeAllocationLabel(line)], 12);
    }
  }
  y -= 7;
  heading("Closing checklist at preparation");
  if (!checklist.length) rows(["No closing checklist items were recorded."]);
  for (const [index, item] of checklist.entries()) {
    rows([`${index + 1}. ${item.title}`, `${item.completedAt ? `Completed ${stamp(item.completedAt)}` : "Open"} / Due ${day(item.dueDate)}`,
      `Owner: ${item.owner}`], 12);
    for (const evidence of item.serviceEvidence ?? []) {
      ensure(4);
      rows([`Sample ${evidence.kind.toLowerCase()} evidence`], 24);
      rows([evidence.reference], 24, 9);
      rows([`Accepted by ${evidence.acceptedBy} on ${stamp(evidence.acceptedAt)}`,
        `Linked by ${evidence.linkedBy} on ${stamp(evidence.linkedAt)}`], 24);
    }
    y -= 5;
  }

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${5 + index * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  for (const [index, content] of pages.entries()) {
    stream = content;
    stream.push("0.88 0.85 0.92 RG 54 63 m 558 63 l S");
    text("Fictional record. Signatures and receipts are simulated.", 54, 44, 9, muted);
    text(`${index + 1} of ${pages.length}`, 505, 44, 9, muted);
    const body = stream.join("\n") + "\n";
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /R 3 0 R /B 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`,
      `<< /Length ${body.length} >>\nstream\n${body}endstream`);
  }
  return pdfDocument(objects);
}
