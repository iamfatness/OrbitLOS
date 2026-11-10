import { ArrowRight, ListChecks } from "lucide-react";
import type { BorrowerActionItem } from "@/lib/borrower-action-model";
import { dateLabel, easternDate } from "@/lib/client-retention";
import { Button } from "./ui/button";

export function BorrowerActionCenter({ actions, correction, processing = 0 }: {
  actions: BorrowerActionItem[];
  correction?: string;
  processing?: number;
}) {
  const today = easternDate();
  return <section className="application-panel application-receipt borrower-action-center" aria-labelledby="borrower-actions-heading">
    <div className="document-item-head">
      <h2 id="borrower-actions-heading"><ListChecks size={19} aria-hidden="true" /> Your next actions</h2>
      <span className="pill" role="status">{actions.length} to do</span>
    </div>
    {correction && <div className="borrower-next">
      <strong>Corrections requested</strong><p>{correction}</p>
      <p>Your previous answers are filled in. Make the requested changes and submit again.</p>
    </div>}
    {actions.length ? <ol className="document-list" role="list">{actions.map(({ target, kind, title, button, date }, index) => <li className="document-item" key={target}>
      <div className="document-item-head">
        <div className="borrower-action-title">
          <strong>{title}</strong>
          {date && <small className="muted">{kind === "Signature" ? "Signing target" : date < today ? "Overdue" : "Due"} <time dateTime={date}>{dateLabel(date)}</time></small>}
        </div>
        <Button size="sm" variant={index === 0 ? "default" : "outline"} onClick={() => document.getElementById(target)?.focus()}>
          {button}<ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </li>)}</ol> : <p className="muted">You’re caught up for now. New requests will appear here.</p>}
    {processing > 0 && <p className="muted" role="status">{processing === 1 ? "One PDF is processing." : `${processing} PDFs are processing.`} Check the document checklist for updates.</p>}
  </section>;
}
