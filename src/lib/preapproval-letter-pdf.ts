import { dateLabel } from "./client-retention";
import { pdfDocument, pdfText, pdfWrappedLines } from "./pdf-document";
import { preapprovalAmount, preapprovalDemoLabel } from "./preapproval-model";

export function preapprovalLetterPdf(data: {
  names: string[]; property: string | null; version: number; issuedOn: string; expiresOn: string;
  issuer: string; brokerage: string; amountCents: number; note?: string;
}) {
  const ink = "0.15 0.11 0.22";
  const muted = "0.34 0.29 0.42";
  const purple = "0.33 0.22 0.62";
  const stream: string[] = [];
  function text(value: string, x: number, y: number, size: number, color = ink, bold = false) {
    stream.push(`BT /${bold ? "B" : "R"} ${size} Tf ${color} rg 1 0 0 1 ${x} ${y} Tm <${pdfText(value)}> Tj ET`);
  }
  stream.push("0.93 0.90 0.99 rg 54 710 504 28 re f");
  text(preapprovalDemoLabel, 67, 720, 10, purple, true);
  text("OrbitLOS", 54, 677, 17, purple, true);
  text("Sample preapproval letter", 54, 636, 28, ink, true);
  text(`VERSION ${data.version}  /  ISSUED ${dateLabel(data.issuedOn).toUpperCase()}`, 54, 607, 10, muted, true);
  stream.push("0.88 0.85 0.92 RG 54 586 m 558 586 l S");
  text("ILLUSTRATIVE LOAN AMOUNT", 54, 560, 10, muted, true);
  text(preapprovalAmount(data.amountCents), 54, 531, 23, ink, true);
  text("EXPIRES ON (EASTERN)", 325, 560, 10, muted, true);
  text(dateLabel(data.expiresOn), 325, 531, 23, ink, true);

  let y = 496;
  const groups = [
    { label: "FICTIONAL BORROWERS", values: data.names },
    { label: "PROPERTY SCOPE", values: [data.property ?? "Property search - no address specified"] },
    { label: "PREPARED FOR THE DEMO BY", values: [data.issuer, data.brokerage] },
    ...(data.note ? [{ label: "BROKERAGE SAMPLE NOTE", values: [data.note] }] : []),
  ].map(({ label, values }) => ({ label, values: values.flatMap((value) => pdfWrappedLines(value, 55)) }));
  const count = groups.reduce((total, group) => total + group.values.length, 0);
  const leading = count > 23 ? 11 : 13;
  for (const { label, values } of groups) {
    text(label, 54, y, 9, purple, true);
    y -= 19;
    for (const line of values) {
      text(line, 54, y, 10, ink);
      y -= leading;
    }
    y -= 13;
  }
  if (y < 92) throw new Error("The fictional letter details are too long for one page.");
  stream.push("0.88 0.85 0.92 RG 54 86 m 558 86 l S");
  text("For a fictional workflow rehearsal only. No credit decision or lending commitment.", 54, 64, 10, muted);
  text("OrbitLOS demo   /   1 of 1", 54, 45, 9, muted);

  const contents = stream.join("\n") + "\n";
  return pdfDocument([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /R 4 0 R /B 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${contents.length} >>\nstream\n${contents}endstream`,
  ]);
}
