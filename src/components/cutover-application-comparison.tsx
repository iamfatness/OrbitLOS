"use client";

import type { CutoverApplicationComparison } from "@/lib/cutover-application-model";

type Field = CutoverApplicationComparison["rows"][number];

function ComparisonFields({ rows }: { rows: Field[] }) {
  return <ul className="document-list">{rows.map(({ key, label, source, draft, status }) => <li key={key} className="document-item">
    <div className="document-item-head"><strong>{label}</strong><span className={status === "Missing in draft" || status === "Changed" ? "open-chip" : "pill"}>{status}</span></div>
    <dl className="details-grid">
      <div><dt>Source mapping</dt><dd>{source || "Blank"}</dd></div>
      <div><dt>Current draft</dt><dd>{draft || "Blank"}</dd></div>
    </dl>
  </li>)}</ul>;
}

export function ApplicationCutoverComparison({ comparison }: { comparison?: CutoverApplicationComparison | { error: string } }) {
  if (!comparison) return <p role="status">Loading the imported 1003 comparison…</p>;
  if ("error" in comparison) return <p role="alert">{comparison.error}</p>;
  const { rows, sourceExtraBorrowers, draftExtraBorrowers, missingExtraBorrowers } = comparison;
  const differences = rows.filter(({ status }) => status === "Changed" || status === "Missing in draft" || status === "Added in draft");
  const remaining = rows.filter(({ status }) => status === "Matched" || status === "Not supplied");
  const matched = remaining.filter(({ status }) => status === "Matched").length;
  const missing = differences.filter(({ status }) => status === "Missing in draft").length;

  return <section className="document-item record-form" aria-label="Imported 1003 comparison">
    <h3>Imported 1003 comparison</h3>
    <p className="muted">Compare the values saved from the source XML with this draft. Record any accepted changes in the application coverage review.</p>
    <div className="loan-application-actions">
      <span className="pill">{matched} matched</span>
      <span className="pill">{differences.length - missing} changed or added</span>
      <span className={missing ? "open-chip" : "pill"}>{missing} missing in draft</span>
    </div>
    {differences.length > 0 ? <ComparisonFields rows={differences} /> : <p className="empty-inline">The mapped values agree with the source.</p>}
    {remaining.length > 0 && <details className="document-form">
      <summary>View matched and blank fields</summary>
      <ComparisonFields rows={remaining} />
    </details>}
    <div>
      <strong>Additional borrowers</strong>
      <p className="muted">{sourceExtraBorrowers === null ? `Earlier import · Confirm the source count manually · ${draftExtraBorrowers} in draft` :
        `${sourceExtraBorrowers} in source · ${draftExtraBorrowers} in draft`}</p>
      {missingExtraBorrowers > 0 && <p role="status">Add {missingExtraBorrowers} more {missingExtraBorrowers === 1 ? "borrower" : "borrowers"} before reconciling.</p>}
    </div>
    <p className="muted"><strong>Review separately</strong> · Contact and identity details, employment, finances, real estate, declarations, military service, demographics, acknowledgments, and lender-specific fields.</p>
  </section>;
}
