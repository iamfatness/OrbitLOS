import type { Loan } from "@/lib/model";
import type { UwmAlert } from "@/lib/uwm-alert-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function UwmAlertQueue({ items, borrower, open, review, busy }: {
  items: { loan: Loan; alert: UwmAlert }[]; borrower: (loan: Loan) => string;
  open: (alert: UwmAlert) => void; review: (alert: UwmAlert) => void; busy: boolean;
}) {
  return <section className="work-queue" aria-label="UWM alerts">
    <div className="section-heading"><h3>UWM alerts</h3><span className="pill">Mock sync</span></div>
    {items.length ? <ul className="loan-task-list">{items.map(({ loan, alert }) => <li className="loan-task uwm-alert-row" key={alert.id}>
      <div className="loan-task-copy"><strong>{alert.kind}</strong>
        <span>{borrower(loan)} · {loan.officer || "Unassigned"}</span>
        <p>{alert.message}</p>
        <span className="muted">Detected {dateTime(alert.detectedAt)} ET{alert.reviewedAt && ` · Reviewed ${dateTime(alert.reviewedAt)} ET`}</span>
      </div>
      <div className="loan-application-actions">
        <Button size="sm" variant="outline" onClick={() => open(alert)}>{alert.conditionId ? "Open condition" : "Open lender status"}</Button>
        {!alert.reviewedAt && <Button size="sm" variant="ghost" disabled={busy} onClick={() => review(alert)}>Mark reviewed</Button>}
      </div>
    </li>)}</ul> : <p className="empty-inline">No UWM alerts in this view.</p>}
  </section>;
}
