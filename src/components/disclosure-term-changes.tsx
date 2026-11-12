import type { DisclosureTermChange } from "@/lib/disclosure-change-model";

export function DisclosureTermChanges({ changes }: { changes: DisclosureTermChange[] }) {
  return changes.length ? <ul className="document-list" aria-label="Changed sample terms">
    {changes.map(({ key, label, before, after }) => <li className="document-item record-form" key={key}>
      <strong>{label}</strong>
      <dl className="grid grid-cols-2 gap-3">
        <div className="min-w-0 break-words"><dt className="muted">Before</dt><dd>{before}</dd></div>
        <div className="min-w-0 break-words"><dt className="muted">After</dt><dd>{after}</dd></div>
      </dl>
    </li>)}
  </ul> : <p className="muted">The listed terms and fees match.</p>;
}

export function SavedDisclosureTermChanges({ changes, legacyChanges }: {
  changes?: DisclosureTermChange[]; legacyChanges?: DisclosureTermChange[];
}) {
  const comparison = changes ?? legacyChanges;
  return comparison ? <details className="document-form">
    <summary className="min-h-11 content-center">Before and after</summary>
    {legacyChanges && <p className="muted">Comparison from the two saved packages.</p>}
    <DisclosureTermChanges changes={comparison} />
  </details> : <p className="muted">The earlier package is unavailable for comparison.</p>;
}
