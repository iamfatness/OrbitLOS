import { pdfDocument, pdfText } from "./pdf-document";
import type { ServiceOrder, ServiceOrderReturn } from "./service-order-model";

const findings = {
  Appraisal: ["Sample property review", "A fictional appraisal report was returned for processor review.", "Use the return reference to distinguish replacements."],
  Title: ["Sample title review", "A fictional title commitment was returned for processor review.", "Sample follow-up: verify vesting against the loan record."],
};

export function serviceOrderPdf(kind: ServiceOrder["kind"], receipt: ServiceOrderReturn) {
  const lines = [
    [10, 733, "FICTIONAL SAMPLE  /  NOT FOR A REAL TRANSACTION"],
    [24, 684, `Sample ${kind.toLowerCase()} return`],
    [11, 641, receipt.reference],
    [11, 618, `Simulated return: ${receipt.returnedAt}`],
    [14, 565, findings[kind][0]],
    [11, 542, findings[kind][1]],
    [11, 522, findings[kind][2]],
  ] as const;
  const stream = "0.93 0.90 0.99 rg 46 719 520 28 re f\n0.15 0.11 0.22 rg\n" +
    lines.map(([size, y, value]) => `BT /F ${size} Tf 1 0 0 1 55 ${y} Tm <${pdfText(value)}> Tj ET`).join("\n");
  return pdfDocument([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]);
}
