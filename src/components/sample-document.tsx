import { sampleDocuments, type DocumentKind, type DocumentStatus } from "@/lib/document-model";

export function DocumentStatusPill({ status }: { status: DocumentStatus }) {
  return <span className="pill document-pill" data-status={status}>{status}</span>;
}

export function SampleDocument({ kind }: { kind: DocumentKind }) {
  const sample = sampleDocuments[kind];
  const text = `ORBITLOS DEMO • FICTIONAL SAMPLE\n\n${sample.content}\n`;
  return <details className="sample-document">
    <summary>Preview {sample.name}</summary>
    <pre>{text}</pre>
    <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download={sample.name}>Download sample</a>
  </details>;
}
