"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { workOnStaffCoverage } from "@/app/actions";
import { dateLabel } from "@/lib/client-retention";
import { coveredCampaignOutcomes, coveredContactOutcomes, type CoverageChange, type CoverageDetail, type CoverageInput, type CoverageResult, type CoverageWindow } from "@/lib/coverage-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Schedule = Extract<CoverageInput, { type: "schedule" }>;
type List = Extract<CoverageResult, { kind: "list" }>;
type Queue = Extract<CoverageResult, { kind: "queue" }>;
const workActions = {
  campaign: "Record callback outcome",
  contact: "Record callback outcome",
  "lead-task": "Complete imported follow-up",
  closing: "Save new due date",
  checklist: "Complete closing item",
  document: "Save new due date",
} satisfies Record<CoverageDetail["kind"], string>;

function deadline(value: string) {
  return value.length === 10 ? dateLabel(value) : `${dateTime(value)} ET`;
}

function CoverageSchedule({ members, today, busy, save }: { members: List["members"]; today: string; busy: boolean;
  save: (input: Schedule, after: () => void) => void }) {
  const [absentEmail, setAbsentEmail] = useState("");
  const attempt = useRef<{ id: string; fields: string } | null>(null);
  const absent = members.find((member) => member.email === absentEmail);
  const backups = members.filter((member) => member.email !== absentEmail && (!absent || member.role === "Admin" ||
    (absent.role === "Processor") === (member.role === "Processor")));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const fields = { absentEmail, backupEmail: String(data.get("backupEmail")), startsOn: String(data.get("startsOn")), endsOn: String(data.get("endsOn")) };
    const encoded = JSON.stringify(fields);
    if (attempt.current?.fields !== encoded) attempt.current = { id: crypto.randomUUID(), fields: encoded };
    save({ type: "schedule", id: attempt.current.id, ...fields }, () => {
      attempt.current = null;
      form.reset();
      setAbsentEmail("");
      form.closest("details")?.removeAttribute("open");
    });
  }
  if (members.length < 2) return <p className="empty-inline">Two active staff members are needed to schedule coverage. Invite staff from Team.</p>;
  return <details className="document-form">
    <summary>Schedule staff coverage</summary>
    <form onSubmit={submit}>
      <label>Staff member who will be out<select name="absentEmail" required value={absentEmail} onChange={(event) => setAbsentEmail(event.target.value)}>
        <option value="">Choose staff member</option>{members.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.role}</option>)}
      </select></label>
      <label>Backup staff member<select key={absentEmail} name="backupEmail" defaultValue="" required>
        <option value="">Choose backup</option>{backups.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.role}</option>)}
      </select></label>
      <label>First day out<input name="startsOn" type="date" min={today} defaultValue={today} required /></label>
      <label>Last day out<input name="endsOn" type="date" min={today} defaultValue={today} required /></label>
      <p className="muted">Dates are inclusive in Eastern time. Choose up to 30 days.</p>
      <Button size="sm" type="submit" disabled={busy}>Save coverage</Button>
    </form>
  </details>;
}

function CoveredWorkForm({ item, today, busy, submit, close }: { item: CoverageDetail; today: string; busy: boolean;
  submit: (change: CoverageChange) => void; close: () => void }) {
  const callback = item.kind === "contact" || item.kind === "campaign";
  const move = item.kind === "closing" || item.kind === "document";
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const { id, kind, revision, deadlineRevision } = item;
    const note = String(data.get("note") ?? "");
    const dueOn = String(data.get("dueOn") ?? "");
    switch (kind) {
      case "campaign": submit({ id, kind, revision, outcome: data.get("outcome") as (typeof coveredCampaignOutcomes)[number], note }); break;
      case "contact": submit({ id, kind, revision, outcome: data.get("outcome") as (typeof coveredContactOutcomes)[number], note }); break;
      case "lead-task": submit({ id, kind, previous: item.dueAt }); break;
      case "closing": submit({ id, kind, previous: item.dueAt, dueOn }); break;
      case "document": submit({ id, kind, revision, deadlineRevision, dueOn }); break;
      case "checklist": submit({ id, kind, revision }); break;
    }
  }
  return <section className="document-item" aria-label="Covered work detail" tabIndex={-1}>
    <div className="section-heading"><h3>{item.title}</h3><Button size="sm" variant="ghost" onClick={close}>Close work detail</Button></div>
    {item.kind === "lead-task" && <p className="muted">Imported lead follow-up</p>}
    <p>{item.name} · Due {deadline(item.dueAt)}</p>
    {item.context && <p className="muted">{item.context}</p>}
    {(item.phone || item.email) && <p>{[item.phone, item.email].filter(Boolean).join(" · ")}</p>}
    <form className="record-form" onSubmit={save}>
      {callback && <>
        <label className="field">Callback outcome<select name="outcome" defaultValue="" required><option value="">Choose an outcome</option>
          {(item.kind === "campaign" ? coveredCampaignOutcomes : coveredContactOutcomes).map((outcome) => <option key={outcome}>{outcome}</option>)}
        </select></label>
        <label className="field">Callback note (optional)<textarea name="note" rows={2} maxLength={item.kind === "campaign" ? 400 : 500} /></label>
        <p className="muted">Record an outcome for a callback already handled by staff.</p>
      </>}
      {move && <label className="field">New due date<input name="dueOn" type="date" min={today} defaultValue={item.dueAt >= today ? item.dueAt : today} required /></label>}
      <Button size="sm" type="submit" disabled={busy}>{workActions[item.kind]}</Button>
    </form>
  </section>;
}

export function StaffCoverage({ brokerageId, staffEmail, admin, onWorkSaved }: {
  brokerageId: string; staffEmail: string; admin: boolean; onWorkSaved: () => void;
}) {
  const [list, setList] = useState<List>();
  const [current, setCurrent] = useState<CoverageWindow>();
  const [queue, setQueue] = useState<Queue>();
  const [item, setItem] = useState<CoverageDetail>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const attempt = useRef<{ id: string; fields: string } | null>(null);
  const scope = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    void workOnStaffCoverage({ type: "list" }, brokerageId).then((result) => {
      if (!active) return;
      if ("error" in result) { setList(undefined); setError(result.error); }
      else if (result.kind === "list") { setList(result); setError(""); }
    }, () => { if (active) setError("Could not load staff coverage. Try refreshing."); });
    return () => { active = false; };
  }, [brokerageId, revision]);

  useEffect(() => { if (item) scope.current?.querySelector<HTMLElement>("[aria-label='Covered work detail']")?.focus(); }, [item]);

  async function run(input: CoverageInput, accept: (result: Exclude<CoverageResult, { error: string }>) => void | Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await workOnStaffCoverage(input, brokerageId);
      if ("error" in result) {
        if (input.type === "queue" || input.type === "item" || input.type === "act") { setItem(undefined); setQueue(undefined); }
        setError(result.error);
      } else await accept(result);
    } catch { setError("Could not reach Orbit. Try again."); }
    finally { pending.current = false; setBusy(false); }
  }

  function openQueue(window: CoverageWindow, after?: Queue["next"]) {
    setCurrent(window);
    setQueue(undefined);
    setItem(undefined);
    void run({ type: "queue", id: window.id, after: after ?? undefined }, (result) => { if (result.kind === "queue") setQueue(result); });
  }

  function saveWork(update: CoverageChange) {
    if (!current) return;
    const fields = JSON.stringify({ id: current.id, update });
    if (attempt.current?.fields !== fields) attempt.current = { id: crypto.randomUUID(), fields };
    void run({ type: "act", id: current.id, operationId: attempt.current.id, update }, async (result) => {
      if (result.kind !== "saved") return;
      attempt.current = null;
      setNotice(result.message);
      setItem(undefined);
      setQueue(undefined);
      onWorkSaved();
      await workOnStaffCoverage({ type: "queue", id: current.id }, brokerageId).then((response) => {
        if ("error" in response) setError(response.error);
        else if (response.kind === "queue") setQueue(response);
      }, () => setError("The work was saved. Refresh the coverage queue to see what remains."));
    });
  }

  return <section className="integration record-form manager-panel" aria-label="Staff coverage" ref={scope}>
    <div className="section-heading"><h2>Coverage schedule</h2><Button size="sm" variant="outline" disabled={busy} onClick={() => {
      setRevision((value) => value + 1); if (current) openQueue(current);
    }}>Refresh coverage</Button></div>
    <p className="muted">A backup can work eligible follow-ups and deadlines through the last day out. The original owner keeps the assignment.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status" className="muted">{notice}</p>}
    {!list && !error && <p role="status" className="muted">Loading coverage…</p>}
    {list && <>
      {admin && <CoverageSchedule members={list.members} today={list.today} busy={busy} save={(input, after) => void run(input, (result) => {
        if (result.kind === "saved") { setNotice(result.message); setRevision((value) => value + 1); after(); }
      })} />}
      {list.windows.length ? <ul className="loan-task-list">{list.windows.map((window) => {
        const status = window.endedAt ? "Ended" : window.endsOn < list.today ? "Expired" : window.startsOn > list.today ? "Scheduled" : "Active";
        return <li className="loan-task coverage-window" key={window.id}>
          <div className="loan-task-copy"><strong>{window.absentName} → {window.backupName}</strong><span>{dateLabel(window.startsOn)} – {dateLabel(window.endsOn)} ET</span></div>
          <span className="pill">{status}</span>
          {status === "Active" && window.backupEmail === staffEmail && <Button size="sm" variant="outline" disabled={busy} onClick={() => openQueue(window)}>Open coverage work</Button>}
          {admin && (status === "Active" || status === "Scheduled") && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ type: "end", id: window.id }, (result) => {
            if (result.kind !== "saved") return;
            if (current?.id === window.id) { setCurrent(undefined); setQueue(undefined); setItem(undefined); }
            setNotice(result.message); setRevision((value) => value + 1);
          })}>End coverage</Button>}
        </li>;
      })}</ul> : <p className="empty-inline">There are no staff coverage windows to show.</p>}
    </>}
    {current && <div className="section-heading"><h3>Covering {current.absentName}</h3><Button size="sm" variant="ghost" disabled={busy} onClick={() => {
      setCurrent(undefined); setQueue(undefined); setItem(undefined);
    }}>Close coverage work</Button></div>}
    {queue && current && <>
      {queue.items.length ? <ul className="loan-task-list">{queue.items.map((row) => <li className="loan-task" key={`${row.kind}:${row.id}`}>
        <div className="loan-task-copy"><strong>{row.title}</strong><span>{row.name}</span><span>{row.overdue ? "Overdue" : "Due"} · {deadline(row.dueAt)}</span></div>
        <Button size="sm" variant="outline" disabled={busy} aria-label={`Review ${row.title} for ${row.name}`} onClick={() => void run({ type: "item", id: current.id,
          item: { kind: row.kind, id: row.id } }, (result) => { if (result.kind === "item") setItem(result.item); })}>Review work</Button>
      </li>)}</ul> : <p className="empty-inline">{queue.next ? "No actionable work on this page. Check the next page." : "No eligible follow-ups or deadlines in this coverage window."}</p>}
      {queue.next && <div><Button size="sm" variant="outline" disabled={busy} onClick={() => openQueue(current, queue.next)}>Next page</Button></div>}
    </>}
    {item && list && <CoveredWorkForm key={`${item.kind}:${item.id}`} item={item} today={list.today} busy={busy} submit={saveWork} close={() => setItem(undefined)} />}
  </section>;
}
