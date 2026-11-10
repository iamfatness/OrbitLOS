"use client";

import { useRef, useState, type FormEvent } from "react";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import { dateLabel, easternDate } from "@/lib/client-retention";
import { shiftReportDate } from "@/lib/report-date-range";
import { serviceOrderKinds, serviceOrderLimit, serviceOrderSlug, serviceOrderTarget, serviceOrdersTarget, type ServiceOrder, type ServiceOrderCommand } from "@/lib/service-order-model";
import { serviceOrderPdf } from "@/lib/service-order-pdf";
import { dateTime } from "@/lib/utils";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

type Save = (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;
type OrderAction = Extract<ServiceOrderCommand, { type: "updateServiceOrder" }>["action"];

function ServiceOrderCard({ item, today, busy, editable, save, openClosing }: {
  item: ServiceOrder; today: string; busy: boolean; editable: boolean; save: Save; openClosing: () => void;
}) {
  const [dueOn, setDueOn] = useState(item.dueOn);
  const [note, setNote] = useState("");
  const open = item.status === "Ordered" || item.status === "Received";
  function update(action: OrderAction, date?: string) {
    void save({ type: "updateServiceOrder", loanId: item.loanId, orderId: item.id, revision: item.revision,
      action, dueOn: date, note: action === "Accept" || action === "Request replacement" || action === "Cancel" ? note : "" });
  }
  return <article className="document-item record-form" id={serviceOrderTarget(item.id)} tabIndex={-1} aria-label={`Mock ${item.kind.toLowerCase()} order`}>
    <div className="document-item-head"><strong>{item.kind}</strong><span className="pill">{item.status}</span></div>
    <p className="muted">{item.owner} · {open && item.dueOn < today ? "Overdue since" : "Due"} {dateLabel(item.dueOn)} ET</p>
    <p className="muted">Recorded by {item.createdBy} · {dateTime(item.createdAt)} ET</p>
    {item.note && <p>{item.note}</p>}
    {item.cancellation && <p>Cancelled · {item.cancellation}</p>}
    {item.returns.length > 0 && <ul className="loan-task-list" aria-label="Sample return history">{item.returns.map((receipt, index) => <li key={receipt.reference}>
      <div className="document-item record-form">
        <div className="document-item-head"><strong>Sample return {index + 1}</strong><span className="pill">{receipt.review?.decision ?? "Received"}</span></div>
        <p className="muted">{dateTime(receipt.returnedAt)} ET · {receipt.receivedBy}</p>
        <p className="muted">{receipt.reference}</p>
        {receipt.review && <p>{receipt.review.actor} · {dateTime(receipt.review.at)} ET{receipt.review.note && ` · ${receipt.review.note}`}</p>}
        <div><Button size="sm" variant="outline" onClick={() => downloadSampleFile(serviceOrderPdf(item.kind, receipt),
          `orbit-sample-${serviceOrderSlug(item.kind)}-${index + 1}.pdf`, "application/pdf")}>Download sample return {index + 1} PDF</Button></div>
      </div>
    </li>)}</ul>}
    {item.status === "Completed" && <div><Button size="sm" variant="outline" onClick={openClosing}>Open closing checklist</Button></div>}
    {open && editable && <>
      {item.status === "Ordered" ? <div><Button size="sm" disabled={busy} onClick={() => update("Simulate return")}>Simulate {item.kind.toLowerCase()} return</Button></div> :
        <p className="muted">Review the returned PDF, then accept it or request a replacement.</p>}
      <details className="document-form">
        <summary>Change order deadline</summary>
        <form className="record-form" onSubmit={(event) => { event.preventDefault(); update("Reschedule", dueOn); }}>
          <label className="field">New due date (Eastern)<input type="date" required value={dueOn} min={shiftReportDate(today, -30)}
            max={shiftReportDate(today, 365)} disabled={busy} onChange={(event) => setDueOn(event.target.value)} /></label>
          <div><Button size="sm" type="submit" disabled={busy || !dueOn || dueOn === item.dueOn}>Save due date</Button></div>
        </form>
      </details>
      <details className="document-form" open={item.status === "Received" || undefined}>
        <summary>{item.status === "Received" ? "Review or cancel order" : "Cancel order"}</summary>
        <label className="field">Internal order note<textarea value={note} rows={2} maxLength={500} disabled={busy} onChange={(event) => setNote(event.target.value)} /></label>
        <p className="muted">Include a reason if requesting a replacement or cancelling.</p>
        <div className="loan-application-actions">
          {item.status === "Received" && <>
            <Button size="sm" disabled={busy} onClick={() => update("Accept")}>Accept sample return</Button>
            <Button size="sm" variant="outline" disabled={busy || note.trim().length < 3} onClick={() => update("Request replacement")}>Request sample replacement</Button>
          </>}
          <Button size="sm" variant="outline" disabled={busy || note.trim().length < 3} onClick={() => update("Cancel")}>Cancel mock order</Button>
        </div>
      </details>
    </>}
  </article>;
}

export function LoanServiceOrders({ loanId, orders, owner, busy, editable, save, openClosing }: {
  loanId: string; orders: ServiceOrder[]; owner: string; busy: boolean; editable: boolean; save: Save; openClosing: () => void;
}) {
  const today = easternDate();
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const allowed = serviceOrderKinds.filter((kind) => !orders.some((item) => item.kind === kind && ["Ordered", "Received"].includes(item.status)));
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const kind = values.get("kind"), dueOn = values.get("dueOn"), note = String(values.get("note") ?? "").trim();
    const key = JSON.stringify([kind, dueOn, note]);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    void save({ type: "createServiceOrder", orderId: attempt.current.id, loanId, kind, dueOn, note }, () => {
      attempt.current = null;
      form.reset();
    });
  }
  return <section className="details-section document-section" id={serviceOrdersTarget} tabIndex={-1} aria-label="Loan service orders">
    <div className="section-heading"><h3>Service orders</h3><span className="pill">Mock services</span></div>
    <p className="muted">Track appraisal, title, homeowners insurance, flood, and mortgage insurance. New work goes to {owner}.</p>
    {editable && allowed.length > 0 && orders.length < serviceOrderLimit && <details className="document-form">
      <summary>New mock service order</summary>
      <form key={allowed.join(",")} className="record-form" onSubmit={create}>
        <div className="form-grid">
          <label className="field">Service<select name="kind" required disabled={busy}>{allowed.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
          <label className="field">Expected return date (Eastern)<input name="dueOn" type="date" required defaultValue={shiftReportDate(today, 3)}
            min={shiftReportDate(today, -30)} max={shiftReportDate(today, 365)} disabled={busy} /></label>
        </div>
        <p className="muted">Choose a past date to rehearse an overdue order.</p>
        <label className="field">Order instructions (optional)<textarea name="note" maxLength={500} rows={2} disabled={busy} /></label>
        <div><Button size="sm" type="submit" disabled={busy}>Record mock order</Button></div>
      </form>
    </details>}
    {orders.length ? orders.map((item) => <ServiceOrderCard key={`${item.id}:${item.revision}`} item={item} today={today}
      editable={editable} busy={busy} save={save} openClosing={openClosing} />) : <p className="empty-inline">No service orders on this loan yet.</p>}
  </section>;
}
