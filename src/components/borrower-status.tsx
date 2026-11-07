import { Calculator, CheckCircle2, FileCheck2, RefreshCw } from "lucide-react";
import { needsBorrowerDocument, type BorrowerLoanStatus, type DocumentRequest } from "@/lib/document-model";
import type { Stage } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { DocumentStatusPill, SampleDocument } from "./sample-document";
import { Button } from "./ui/button";

const stageUpdates: Record<Stage, { label: string; next: string }> = {
  Lead: { label: "Getting started", next: "Your loan officer will review your application and share the next steps." },
  "Pre-qual": { label: "Prequalification", next: "Your loan officer will review your application and share the next steps." },
  Application: { label: "Application review", next: "Your loan officer will review your application and add any document requests here." },
  Processing: { label: "Processing", next: "Your loan team is preparing the file. Check back here for document requests." },
  Underwriting: { label: "Underwriting", next: "Your loan team will let you know if the underwriter needs any additional information." },
  "Clear to Close": { label: "Clear to close", next: "Your loan team will confirm closing details with you." },
  Funded: { label: "Funded", next: "Your loan team can help with any questions about your funded loan." },
  Closed: { label: "Closed", next: "Your loan team can help with any follow-up questions." },
};
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function BorrowerStatus({ status, submittedAt, busy, refresh, attach }: {
  status: BorrowerLoanStatus; submittedAt: string; busy: boolean; refresh: () => void; attach: (request: DocumentRequest) => void;
}) {
  const stage = stageUpdates[status.stage];
  const waiting = status.documents.filter((item) => needsBorrowerDocument(item.status)).length;
  const received = status.documents.filter((item) => item.status === "Received").length;
  const next = waiting > 0 ? "Attach a sample for each document that needs your attention below." : received > 0
    ? "Your loan team will review the samples you attached. Check back for their updates."
    : status.stage === "Application" && status.reviewed ? "Your loan officer reviewed your application and will post any additional requests here." : stage.next;

  return <div className="borrower-status">
    <section className="application-panel application-receipt">
      <div className="document-item-head">
        <CheckCircle2 size={30} className="text-emerald-700" aria-hidden="true" />
        <Button variant="outline" size="sm" disabled={busy} onClick={refresh}><RefreshCw /> Refresh status</Button>
      </div>
      <h2>Application received</h2>
      <p className="muted">Submitted {dateTime(submittedAt)} ET</p>
      <div className="borrower-next">
        <div className="document-item-head"><strong>What’s next</strong><span className="pill">{stage.label}</span></div>
        <p>{next}</p>
        <small className="muted">Loan stage updated {dateTime(status.stageSince)} ET</small>
      </div>
    </section>
    {status.quote && <section className="application-panel application-receipt document-section" aria-labelledby="borrower-quote-heading">
      <div className="section-heading"><h2 id="borrower-quote-heading"><Calculator size={19} /> Your shared quote</h2><span className="pill">Sample pricing</span></div>
      <div className="borrower-next">
        <strong>{status.quote.product}</strong>
        <dl className="quote-terms">
          <div><dt>Rate</dt><dd>{status.quote.rate.toFixed(3)}%</dd></div>
          <div><dt>Monthly principal and interest</dt><dd>{usd.format(status.quote.principalAndInterest)}</dd></div>
        </dl>
        <small className="muted">Quoted {dateTime(status.quote.quotedAt)} ET · Demo estimate</small>
      </div>
    </section>}
    <section className="application-panel application-receipt document-section" aria-labelledby="borrower-documents-heading">
      <div className="section-heading"><h2 id="borrower-documents-heading"><FileCheck2 size={19} /> Document checklist</h2></div>
      {status.documents.length > 0 && <p className="document-counts">{waiting} to attach · {received} in review · {status.documents.length - waiting - received} accepted</p>}
      {status.documents.length ? <ul className="document-list">{status.documents.map((request) =>
        <li className="document-item" key={request.id}>
          <div className="document-item-head"><strong>{request.kind}</strong><DocumentStatusPill status={request.status} /></div>
          {request.instructions && <p>{request.instructions}</p>}
          {request.status === "Needs replacement" && <p><strong>From your loan team</strong> · {request.replacementNote}</p>}
          <SampleDocument kind={request.kind} />
          {needsBorrowerDocument(request.status)
            ? <Button size="sm" disabled={busy} onClick={() => attach(request)}>{request.status === "Needs replacement" ? "Attach replacement sample" : "Attach sample document"}</Button>
            : request.submittedAt && <small className="muted">Sample attached {dateTime(request.submittedAt)} ET</small>}
        </li>
      )}</ul> : <p className="muted">There are no document requests right now. If your loan team needs something, it will appear here.</p>}
    </section>
  </div>;
}
