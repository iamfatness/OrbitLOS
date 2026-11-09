"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarPlus, RefreshCw } from "lucide-react";
import { saveAppointmentWork } from "@/app/actions";
import { appointmentLocalTime, appointmentTarget, type Appointment, type AppointmentInput, type AppointmentPage } from "@/lib/appointment-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Change = Exclude<AppointmentInput, { type: "list" }>;
type Submit = (change: Change, after?: () => void) => Promise<void>;

function AppointmentForm({ loanId, owners, item, busy, save }: {
  loanId: string; owners: AppointmentPage["owners"]; item?: Appointment; busy: boolean; save: Submit;
}) {
  const pendingId = useRef<string | null>(null);
  return <details className="document-form">
    <summary>{item ? "Edit appointment" : "Schedule appointment"}</summary>
    <form onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      const id = item?.id ?? (pendingId.current ??= crypto.randomUUID());
      const ownerRole = values.get("ownerRole") === "Processor" ? "Processor" : "Loan officer";
      void save({ type: "save", loanId, id, revision: item?.revision ?? 0, title: String(values.get("title") ?? ""),
        localStart: String(values.get("localStart") ?? ""), durationMinutes: Number(values.get("duration")), ownerRole }, () => {
        pendingId.current = null;
        form.reset();
        form.closest("details")?.removeAttribute("open");
      });
    }}>
      <label>Appointment title<input name="title" maxLength={100} required defaultValue={item?.title} placeholder="e.g. Borrower loan review" /></label>
      <label>Start (Eastern time)<input name="localStart" type="datetime-local" required defaultValue={item ? appointmentLocalTime(item.startsAt) : undefined} /></label>
      <label>Duration in minutes<input name="duration" type="number" min={5} max={480} required defaultValue={item?.durationMinutes ?? 30} /></label>
      <label>Appointment owner<select name="ownerRole" required defaultValue={item && owners.some(({ role }) => role === item.ownerRole) ? item.ownerRole : owners[0]?.role}>
        {owners.map(({ role, name }) => <option key={role} value={role}>{role} · {name}</option>)}
      </select></label>
      <Button size="sm" type="submit" disabled={busy}>Save appointment</Button>
    </form>
  </details>;
}

export function LoanAppointments({ loanId, brokerageId, focusId, onChange }: {
  loanId: string; brokerageId: string; focusId?: string; onChange: () => void;
}) {
  const [page, setPage] = useState<AppointmentPage>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    void saveAppointmentWork({ type: "list", loanId, focusId }, brokerageId).then((result) => {
      if (!active) return;
      if ("error" in result) { setPage(undefined); setError(result.error); }
      else { setPage(result); setError(""); }
    }, () => { if (active) setError("Could not load appointments. Try refreshing."); });
    return () => { active = false; };
  }, [brokerageId, loanId, focusId, refresh]);

  useEffect(() => {
    if (!focusId || !page?.items.some(({ id }) => id === focusId)) return;
    const row = document.getElementById(appointmentTarget(focusId));
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "start" });
  }, [focusId, page]);

  async function save(change: Change, after?: () => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await saveAppointmentWork(change, brokerageId);
      if ("error" in result) setError(result.error);
      else { setPage(result); onChange(); after?.(); }
    } catch {
      setError("Could not save the appointment. Try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <section className="details-section document-section" aria-label="Loan appointments">
    <div className="section-heading"><h3><CalendarPlus size={17} /> Appointments</h3>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setPage(undefined); setError(""); setRefresh(refresh + 1); }}><RefreshCw /> Refresh appointments</Button>
    </div>
    <p className="muted">Schedule a meeting or signing on this file. Times are Eastern. Orbit records it on the staff calendar.</p>
    {error && <p role="alert">{error}</p>}
    {!page && !error && <p role="status" className="muted">Loading appointments…</p>}
    {page && <>
      {page.message && <p role="status" className="muted">{page.message}</p>}
      {page.canSchedule && page.owners.length > 0 && <AppointmentForm loanId={loanId} owners={page.owners} busy={busy} save={save} />}
      {focusId && !page.items.some(({ id }) => id === focusId) && <p className="empty-inline">This appointment is unavailable on the loan.</p>}
      {page.items.length ? <ul className="document-list">{page.items.map((item) => <li className="document-item" id={appointmentTarget(item.id)}
        tabIndex={-1} key={`${item.id}:${item.revision}`}>
        <div className="document-item-head"><strong>{item.title}</strong><span className="pill">{item.cancelledAt ? "Canceled" : item.startsAt < page.checkedAt ? "Past" : "Scheduled"}</span></div>
        <p>{dateTime(item.startsAt)} ET · {item.durationMinutes} minutes</p>
        <p className="muted">{item.ownerRole} · {page.owners.find(({ role }) => role === item.ownerRole)?.name ?? "Unassigned"}</p>
        {!item.cancelledAt && <div className="loan-application-actions">
          {page.canSchedule && page.owners.length > 0 && <AppointmentForm loanId={loanId} owners={page.owners} item={item} busy={busy} save={save} />}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({ type: "cancel", loanId, id: item.id, revision: item.revision })}>Cancel appointment</Button>
        </div>}
      </li>)}</ul> : <p className="empty-inline">No appointments on this file.</p>}
      {page.hasMore && <p className="muted">Showing recent appointments by start date. Open a specific week in the calendar to find other scheduled appointments.</p>}
    </>}
  </section>;
}
