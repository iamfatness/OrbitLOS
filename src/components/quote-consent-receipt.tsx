import type { QuoteConsentReceipt } from "@/lib/quote-intake-model";
import { quotePrefillLabels, type QuoteOverrideEvidence } from "@/lib/quote-intake-questions";
import { dateTime } from "@/lib/utils";

export function QuoteConsentEvidence({ receipt }: { receipt: QuoteConsentReceipt | null }) {
  return <details className="document-form quote-consent-receipt">
    <summary>Website consent at submission</summary>
    {receipt ? <div className="record-form">
      <p className="muted">{receipt.profile} form v{receipt.formRevision} · {dateTime(receipt.acceptedAt)} ET</p>
      <p className="quote-consent-copy">{receipt.wording}</p>
    </div> : <p className="muted">Orbit began saving the exact wording after this request arrived.</p>}
  </details>;
}

export function QuoteCorrectionEvidence({ receipt }: { receipt: QuoteOverrideEvidence }) {
  return <details className="document-form quote-consent-receipt">
    <summary>Website intake corrections</summary>
    <div className="record-form">
      <p className="muted">{receipt.changedBy} · {dateTime(receipt.changedAt)} ET · {receipt.profile} form v{receipt.formRevision}</p>
      <ul className="document-list">
        {receipt.changes.map(({ field, submitted, entered }) => <li key={field}>
          <strong>{quotePrefillLabels[field]}</strong>
          <p>Submitted: {submitted}</p>
          <p>Entered in draft: {entered}</p>
        </li>)}
      </ul>
      <p className="quote-consent-copy"><strong>Reason</strong> {receipt.reason}</p>
    </div>
  </details>;
}
