import { Calculator, CheckCircle2, FileCheck2, RefreshCw } from "lucide-react";
import { SampleQuotePresentation } from "./quote-worksheet";
import { needsBorrowerDocument, type BorrowerLoanStatus, type DocumentRequest } from "@/lib/document-model";
import type { Stage } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { dateLabel } from "@/lib/client-retention";
import { DocumentStatusPill, SampleDocument } from "./sample-document";
import { Button } from "./ui/button";
import { BorrowerPdfForm, BorrowerPdfVerification, useBorrowerPdf } from "./borrower-pdf";
import type { DocumentUploadMode } from "@/lib/document-files-model";
import { SharedPreapprovalDownload } from "./shared-preapproval";

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

export function BorrowerStatus({ token, status, submittedAt, busy, refresh, attach, uploadsMode }: {
  token: string; status: BorrowerLoanStatus; submittedAt: string; busy: boolean; refresh: () => void; attach: (request: DocumentRequest) => void;
  uploadsMode?: DocumentUploadMode;
}) {
  const pdf = useBorrowerPdf(token, refresh, uploadsMode);
  const demo = uploadsMode === "mock";
  const stage = stageUpdates[status.stage];
  const waiting = status.documents.filter((item) => needsBorrowerDocument(item.status)).length;
  const received = status.documents.filter((item) => item.status === "Received").length;
  const next = waiting > 0 ? (uploadsMode === "live" ? "Upload the requested PDFs." : "Attach the requested samples.") : received > 0
    ? "Your loan team will review the documents you attached."
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
        {status.quote.presentation ? <SampleQuotePresentation quote={status.quote.presentation} /> : <dl className="quote-terms">
          <div><dt>Rate</dt><dd>{status.quote.rate.toFixed(3)}%</dd></div>
          <div><dt>Monthly principal and interest</dt><dd>{usd.format(status.quote.principalAndInterest)}</dd></div>
        </dl>}
        <small className="muted">Quoted {dateTime(status.quote.quotedAt)} ET · Demo estimate</small>
      </div>
    </section>}
    {status.preapproval && <section className="application-panel application-receipt document-section" aria-labelledby="borrower-letter-heading">
      <h2 id="borrower-letter-heading">Your shared sample preapproval</h2>
      <SharedPreapprovalDownload key={status.preapproval.grantId} letter={status.preapproval} token={token} audience="Borrower" />
    </section>}
    <section className="application-panel application-receipt document-section" aria-labelledby="borrower-documents-heading">
      <div className="section-heading"><h2 id="borrower-documents-heading"><FileCheck2 size={19} /> Document checklist</h2></div>
      {uploadsMode && waiting > 0 && !pdf.session && <BorrowerPdfVerification pdf={pdf} busy={busy} demo={demo} />}
      {pdf.error && <p role="alert" className="application-message banner-error">{pdf.error}</p>}
      {pdf.notice && <p role="status" className="muted">{pdf.notice}</p>}
      {status.documents.length > 0 && <p className="document-counts">{waiting} to attach · {received} in review · {status.documents.length - waiting - received} accepted</p>}
      {status.documents.length ? <ul className="document-list">{status.documents.map((request) =>
        <li className="document-item" key={request.id}>
          <div className="document-item-head"><strong>{request.kind}</strong><DocumentStatusPill status={request.status} /></div>
          {request.instructions && <p>{request.instructions}</p>}
          {request.status === "Needs replacement" && <p><strong>From your loan team</strong> · {request.replacementNote}</p>}
          {request.dueOn && needsBorrowerDocument(request.status) && <p><strong>Due <time dateTime={request.dueOn}>{dateLabel(request.dueOn)}</time></strong></p>}
          {uploadsMode !== "live" && !request.pdfUploadedAt && <SampleDocument kind={request.kind} />}
          {(pdf.processing === request.id || request.pdfStatus === "Processing") && <p role="status">PDF is processing. Refresh status to check for updates.</p>}
          {request.pdfStatus === "Retry" && <p className="muted">The last PDF upload needs a retry.</p>}
          {needsBorrowerDocument(request.status) ? <>
            {uploadsMode && pdf.session && request.pdfStatus !== "Processing" && <BorrowerPdfForm key={request.revision} pdf={pdf} request={request} busy={busy} demo={demo} />}
            {uploadsMode !== "live" && !request.pdfUploadedAt && request.pdfStatus !== "Processing" && <Button size="sm" variant={demo ? "outline" : "default"} disabled={busy || pdf.busy} onClick={() => attach(request)}>
              {demo ? "Attach text sample" : request.status === "Needs replacement" ? "Attach replacement sample" : "Attach sample document"}
            </Button>}
          </> : request.submittedAt && <small className="muted">{request.pdfUploadedAt ? (demo ? "Demo PDF received" : "PDF received") : "Sample attached"} {dateTime(request.submittedAt)} ET</small>}
        </li>
      )}</ul> : <p className="muted">No documents requested.</p>}
    </section>
  </div>;
}
