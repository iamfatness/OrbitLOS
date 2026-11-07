export const maxPdfBytes = 5 * 1024 * 1024;
export const uploadSessionPattern = /^[A-Za-z0-9_-]{43}$/;
export type DocumentUploadMode = "mock" | "live";

export const demoPdfFixtures = {
  clean: "Clean sample PDF",
  replacement: "Clean replacement PDF",
  blocked: "Sample PDF that fails the demo scan",
};

export function documentKey(brokerageId: string, objectId: string) {
  return `${brokerageId}/${objectId}.pdf`;
}

export function pdfColumns(now = Date.now()) {
  return `CASE WHEN files.pendingUntil > ${now} THEN 'Processing'
    WHEN files.failed = 1 OR files.pendingId IS NOT NULL THEN 'Retry'
    WHEN files.objectId IS NOT NULL THEN 'Ready' END AS pdfStatus, files.uploadedAt AS pdfUploadedAt`;
}
