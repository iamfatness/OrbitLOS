import type { QuoteConsentReceipt } from "@/lib/quote-intake-model";
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
