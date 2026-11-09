import { demoPdfFixtures } from "./document-files-model";
import { pdfDocument } from "./pdf-document";

export function demoDocumentPdf(fixture: keyof typeof demoPdfFixtures) {
  const stream = `BT /F1 16 Tf 40 220 Td (OrbitLOS fictional demo document) Tj 0 -28 Td (${demoPdfFixtures[fixture]}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 280] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  return new TextEncoder().encode(pdfDocument(objects));
}
