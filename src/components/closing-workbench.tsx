"use client";

import { useRef, type FormEvent } from "react";
import { CalendarCheck, CheckCircle2, Plus, RotateCcw } from "lucide-react";
import { dateLabel, easternDate } from "@/lib/client-retention";
import type { ClosingItem, DraftAudience, Loan, Workspace } from "@/lib/model";
import { Button } from "./ui/button";

type Save = (input: unknown, after?: () => void) => Promise<void>;

function ClosingItemForm({ loan, item, targetDate, busy, save }: {
  loan: Loan; item?: ClosingItem; targetDate?: string; busy: boolean; save: Save;
}) {
  const pendingId = useRef<string | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const itemId = item?.id ?? (pendingId.current ??= crypto.randomUUID());
    void save({ type: "saveClosingItem", loanId: loan.id, itemId, revision: item?.revision ?? 0,
      title: data.get("title"), owner: data.get("owner"), dueDate: data.get("dueDate"),
    }, () => {
      pendingId.current = null;
      form.reset();
      form.closest("details")?.removeAttribute("open");
    });
  }

  return <details className="document-form">
    <summary>{item ? "Edit item" : <><Plus size={15} /> Add closing item</>}</summary>
    <form onSubmit={submit}>
      <label className="field">Checklist item<input name="title" required maxLength={120} defaultValue={item?.title} placeholder="e.g. Confirm signing appointment" /></label>
      <label className="field">Owner<input name="owner" required maxLength={120} defaultValue={item?.owner ?? loan.officer} /></label>
      <label className="field">Due date<input name="dueDate" type="date" required defaultValue={item?.dueDate ?? targetDate} /></label>
      <Button type="submit" size="sm" disabled={busy}>{item ? "Save changes" : "Add to closing checklist"}</Button>
    </form>
  </details>;
}

export function ClosingWorkbench({ loan, state, busy, save, preview }: {
  loan: Loan; state: Workspace; busy: boolean; save: Save; preview: (audience: DraftAudience, draftId: string) => void;
}) {
  const target = state.closingPlans.find((plan) => plan.loanId === loan.id)?.targetDate;
  const profile = state.pastClients.find((item) => item.loanId === loan.id);
  const actual = profile?.closingDate;
  const items = state.closingItems.filter((item) => item.loanId === loan.id);
  const drafts = state.communicationDrafts.filter((draft) => draft.loanId === loan.id && draft.milestone === "Closing complete");
  const borrowerDraft = drafts.find((draft) => draft.audience === "Borrower" && draft.contactId === loan.contactId);
  const realtorDraft = drafts.find((draft) => draft.audience === "Realtor" && draft.contactId === loan.partnerId);
  const today = easternDate();
  const outstanding = items.filter((item) => !item.completedAt).length;

  return <section className="details-section document-section" aria-label="Closing workbench" id="closing-workbench" tabIndex={-1}>
    <div className="section-heading"><h3><CalendarCheck size={17} /> Closing workbench</h3>{actual && <span className="pill">Closing recorded</span>}</div>
    <div className="closing-dates">
      <form key={target ?? "no-target"} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void save({ type: "saveClosingTarget", loanId: loan.id, targetDate: data.get("targetDate") || null, previous: target ?? null });
      }}>
        <label className="field">Target closing date<input type="date" name="targetDate" defaultValue={target} /></label>
        <Button size="sm" type="submit" variant="outline" disabled={busy}>Save target date</Button>
      </form>
      <form key={actual ?? "no-actual"} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void save({ type: "recordClosing", loanId: loan.id, closingDate: data.get("closingDate"), revision: profile?.revision ?? 0 });
      }}>
        <label className="field">Actual closing date<input type="date" name="closingDate" required max={today} defaultValue={actual ?? undefined} /></label>
        <Button size="sm" type="submit" variant="outline" disabled={busy}>{actual ? "Save closing date" : "Record closing"}</Button>
      </form>
    </div>
    {actual && <div className="loan-application-actions">
      {borrowerDraft && <Button size="sm" variant="outline" onClick={() => preview("Borrower", borrowerDraft.id)}>Preview borrower closing update</Button>}
      {realtorDraft && <Button size="sm" variant="outline" onClick={() => preview("Realtor", realtorDraft.id)}>Preview realtor closing update</Button>}
    </div>}
    <div className="section-heading"><h4>Closing checklist</h4><span className="pill">{outstanding} outstanding</span></div>
    <ClosingItemForm loan={loan} targetDate={target} busy={busy} save={save} />
    {items.length ? <ul className="document-list">{items.map((item) => <li className="document-item" key={`${item.id}:${item.revision}`}>
      <div className="document-item-head"><strong>{item.title}</strong><span className="pill">{item.completedAt ? "Complete" : item.dueDate < today ? "Overdue" : "Open"}</span></div>
      <p className="muted">{item.owner} · Due {dateLabel(item.dueDate)}</p>
      <div className="loan-application-actions">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "completeClosingItem", loanId: loan.id, itemId: item.id,
          revision: item.revision, completed: !item.completedAt,
        })}>{item.completedAt ? <><RotateCcw /> Reopen</> : <><CheckCircle2 /> Mark complete</>}</Button>
        <ClosingItemForm loan={loan} item={item} busy={busy} save={save} />
      </div>
    </li>)}</ul> : <p className="empty-inline">Add the items your team needs to finish before closing.</p>}
  </section>;
}
