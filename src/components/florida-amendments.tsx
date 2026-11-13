"use client";

import { useEffect, useRef, useState } from "react";
import { accessComplianceCases } from "@/app/actions";
import { floridaAmendmentFacts, type FloridaAmendmentRequest } from "@/lib/florida-amendment-model";
import type { FloridaAmendmentResult as Result } from "@/lib/florida-amendment";
import { Button } from "./ui/button";

type List = Extract<Result, { kind: "floridaAmendmentList" }>;
type History = Extract<Result, { kind: "floridaAmendmentHistory" }>;
type Version = History["versions"][number];
type Input = FloridaAmendmentRequest["input"];
const grid = "grid min-w-0 gap-3 sm:grid-cols-2";

function Field({ name, label, value, date, required }: { name: string; label: string; value?: string; date?: boolean; required?: boolean }) {
  return <label className="field min-w-0">{label}<input name={name} type={date ? "date" : "text"}
    defaultValue={value} required={required} minLength={date ? undefined : 4} maxLength={date ? undefined : 240} /></label>;
}

function NoticeForm({ current, onSave, busy, conflict }: {
  current?: Version; onSave: (form: FormData) => void; busy: boolean; conflict: boolean;
}) {
  const facts = current?.facts;
  const [kind, setKind] = useState(facts?.change.kind ?? "Principal loan originator");
  const principal = facts?.change.kind === "Principal loan originator" ? facts.change : undefined;
  const timing = facts?.change.kind === "Control person" ? facts.change.timing : undefined;
  const [route, setRoute] = useState(timing?.route ?? "Advance filing");
  const notice = timing?.route === "First notice" ? timing : undefined;
  const [calendar, setCalendar] = useState(Boolean(notice?.calendar));
  const [filed, setFiled] = useState(Boolean(facts?.filed));
  const [status, setStatus] = useState(facts?.status?.outcome ?? "");
  return <form className="record-form" onSubmit={event => { event.preventDefault(); onSave(new FormData(event.currentTarget)); }}>
    <fieldset className="record-form min-w-0" disabled={busy}>
      <div className={grid}>
        {current ? <p>{kind}</p> : <label className="field">Change type<select name="kind" value={kind}
          onChange={event => setKind(event.target.value as typeof kind)}>
          <option>Principal loan originator</option><option>Application information</option><option>Control person</option>
        </select></label>}
        <label className="field">Florida authority<select name="authority" defaultValue={facts?.authority}>
          <option>Mortgage broker</option><option>Mortgage lender</option>
        </select></label>
        <Field name="licenseReference" label="License evidence" value={facts?.licenseReference} required />
        <label className="field">Local time zone<select name="zone" defaultValue={facts?.zone}>
          <option value="America/New_York">Eastern time</option><option value="America/Chicago">Central time</option>
        </select></label>
        <Field name="effectiveOn" label="Change effective date" value={facts?.effective.on} date required />
        <Field name="effectiveReference" label="Effective date evidence" value={facts?.effective.reference} required />
        {kind === "Principal loan originator" && <>
          <Field name="designation" label="Designation evidence" value={principal?.designationReference} required />
          <Field name="eligibility" label="Qualification evidence (optional)" value={principal?.eligibilityReference} />
        </>}
        {kind === "Control person" && <label className="field">Reviewed timing route<select name="route" value={route}
          onChange={event => setRoute(event.target.value as typeof route)}><option>Advance filing</option><option>First notice</option>
        </select></label>}
      </div>
      {kind === "Control person" && route === "First notice" && <>
        <div className={grid}>
          <Field name="firstNoticeOn" label="Date first notice was received" value={notice?.firstNotice.on} date required />
          <Field name="firstNoticeReference" label="First notice evidence" value={notice?.firstNotice.reference} required />
        </div>
        <label className="flex min-h-11 items-center gap-2"><input name="calendar" type="checkbox" checked={calendar}
          onChange={event => setCalendar(event.target.checked)} />Record reviewed business-day calendar</label>
        {calendar && <div className={grid}>
          <Field name="through" label="Calendar reviewed through" value={notice?.calendar?.through} date required />
          <Field name="calendarReference" label="Calendar evidence" value={notice?.calendar?.reference} required />
          <label className="field min-w-0">Holidays after first notice, one YYYY-MM-DD per line<textarea name="holidays" rows={3}
            maxLength={400} defaultValue={notice?.calendar?.holidays.join("\n")} /></label>
        </div>}
      </>}
      <label className="flex min-h-11 items-center gap-2"><input name="filed" type="checkbox" checked={filed}
        onChange={event => setFiled(event.target.checked)} />Record Registry filing</label>
      {filed && <div className={grid}>
        <Field name="filedOn" label="Registry filing date" value={facts?.filed?.on} date required />
        <Field name="filedReference" label="Registry receipt reference" value={facts?.filed?.reference} required />
      </div>}
      <label className="field">Recorded regulator status<select name="status" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">No regulator status recorded</option><option>Pending</option><option>Acknowledged</option>
        <option>Deficiency</option><option>Other</option>
      </select></label>
      {status && <div className={grid}>
        <Field name="statusOn" label="Status verification date" value={facts?.status?.on} date required />
        <Field name="statusReference" label="Regulator status evidence" value={facts?.status?.reference} required />
      </div>}
      {current && <Field name="correction" label="Reason for update" required />}
      <div><Button className="min-h-11" type="submit" disabled={conflict}>{busy ? "Saving…" : "Save amendment"}</Button></div>
    </fieldset>
  </form>;
}

export function FloridaAmendments({ brokerageId, entityId, entityName, onBack }: {
  brokerageId: string; entityId: string; entityName: string; onBack: () => void;
}) {
  const [locked, setLocked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="record-form compliance-pilot-form" aria-label="Florida license amendments">
    <div className="section-heading"><h2 className="text-lg font-semibold" ref={heading} tabIndex={-1}>Florida license amendments</h2>
      <Button className="min-h-11" variant="outline" disabled={locked} onClick={onBack}>Back to obligations</Button></div>
    <p className="[overflow-wrap:anywhere]">{entityName}</p>
    <NoticeRegister entityId={entityId} brokerageId={brokerageId} lock={setLocked} />
  </section>;
}

function NoticeRegister({ brokerageId, entityId, lock }: { brokerageId: string; entityId: string; lock: (busy: boolean) => void }) {
  const [page, setPage] = useState<List>();
  const [query, setQuery] = useState({ offset: 0 });
  const [history, setHistory] = useState<History>();
  const [noticeId, setNoticeId] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState("");
  const [filter, setFilter] = useState("");
  const [conflict, setConflict] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const retry = useRef<{ signature: string; id: string }>(null);
  const origin = useRef("");
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const detail = useRef<HTMLHeadingElement>(null);
  const message = useRef<HTMLParagraphElement>(null);
  const current = history?.versions[0];
  const currentFinding = page?.items.find(item => item.noticeId === noticeId && item.version === current?.version)?.currentFinding;

  useEffect(() => {
    let active = true;
    void accessComplianceCases({ type: "floridaAmendment", entityId, input: { operation: "list", ...query } }, brokerageId)
      .then(result => {
        if (!active) return;
        if ("error" in result) setListError(result.error);
        else if (result.kind === "floridaAmendmentList") setPage(result);
      }).catch(() => { if (active) setListError("Could not load amendments."); });
    return () => { active = false; };
  }, [brokerageId, entityId, query]);
  useEffect(() => { if (noticeId) detail.current?.focus(); }, [noticeId, editing]);
  useEffect(() => { if (feedback) message.current?.focus(); }, [feedback]);
  useEffect(() => {
    if (!noticeId && page && origin.current) {
      (buttons.current.get(origin.current) ?? buttons.current.get("new"))?.focus();
      origin.current = "";
    }
  }, [noticeId, page]);

  function refresh(offset = query.offset) { setListError(""); setPage(undefined); setQuery({ offset }); }

  async function request(input: Input) {
    setBusy(true);
    lock(true);
    setFeedback(undefined);
    try {
      const result = await accessComplianceCases({ type: "floridaAmendment", entityId, input }, brokerageId);
      if ("error" in result) {
        if (input.operation === "save" && /amendment changed/i.test(result.error)) setConflict(true);
        setFeedback({ text: result.error, error: true });
      }
      else if (result.kind === "floridaAmendmentHistory") {
        if (input.operation === "history" && input.before && history) {
          setHistory({ ...result, versions: [...history.versions, ...result.versions] });
          setFeedback({ text: "Earlier versions loaded." });
        } else {
          setHistory(result);
          setEditing(false);
          setConflict(false);
          retry.current = null;
          if (input.operation === "save") {
            refresh(0);
            setFeedback({ text: "Amendment saved. Version " + result.versions[0]?.version + "." });
          }
        }
      }
    } catch {
      setFeedback({ text: input.operation === "save" ? "Could not confirm the save. Retry with the same evidence." : "Could not load the amendment. Try again.", error: true });
    } finally { setBusy(false); lock(false); }
  }

  function save(form: FormData) {
    const get = (field: string) => String(form.get(field) ?? "").trim();
    const kind = current?.facts.change.kind ?? get("kind");
    const dated = (name: string) => ({ on: get(name + "On"), reference: get(name + "Reference") });
    const status = get("status");
    const parsed = floridaAmendmentFacts.safeParse({
      authority: get("authority"), zone: get("zone"), licenseReference: get("licenseReference"),
      effective: dated("effective"),
      change: kind === "Principal loan originator" ? { kind, designationReference: get("designation"),
        eligibilityReference: get("eligibility") || undefined } : kind === "Control person" ? {
        kind, timing: get("route") === "Advance filing" ? { route: "Advance filing" } : {
          route: "First notice", firstNotice: dated("firstNotice"),
          calendar: form.has("calendar") ? { through: get("through"), reference: get("calendarReference"),
            holidays: get("holidays").split(/\s+/u).filter(Boolean) } : undefined,
        },
      } : { kind },
      filed: form.has("filed") ? dated("filed") : undefined,
      status: status ? { ...dated("status"), outcome: status } : undefined,
    });
    if (!parsed.success) {
      setFeedback({ text: "Check the required dates and evidence references. Use YYYY-MM-DD for holiday dates.", error: true });
      return;
    }
    const payload = { operation: "save" as const, noticeId, expected: current?.version ?? 0, facts: parsed.data, correction: get("correction") || undefined };
    const signature = JSON.stringify(payload);
    if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() };
    void request({ ...payload, requestId: retry.current.id });
  }

  function open(id?: string) {
    origin.current = id ?? "new";
    setNoticeId(id ?? crypto.randomUUID());
    setHistory(undefined);
    setFeedback(undefined);
    setEditing(!id);
    setConflict(false);
    if (id) void request({ operation: "history", noticeId: id });
  }

  if (noticeId) return <div className="record-form min-w-0">
    <div className="section-heading"><h3 ref={detail} tabIndex={-1}>{editing ? (current ? "Update amendment" : "Record amendment") :
      current?.facts.change.kind ?? "Amendment"}</h3>
      <Button className="min-h-11" variant="outline" disabled={busy} onClick={() => {
        retry.current = null; setNoticeId(""); setEditing(false); setHistory(undefined); setFeedback(undefined);
      }}>Back to amendments</Button></div>
    {feedback && <p ref={message} tabIndex={-1} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
    {editing ? <><NoticeForm current={current} onSave={save} busy={busy} conflict={conflict} />
      {conflict && current && <div><Button className="min-h-11" variant="outline" disabled={busy}
        onClick={() => void request({ operation: "history", noticeId })}>Reload amendment and discard draft</Button></div>}</> :
      busy && !history ? <p role="status">Loading amendment…</p> : !current ? <Button variant="outline" disabled={busy}
        onClick={() => void request({ operation: "history", noticeId })}>Reload amendment</Button> : <>
        {currentFinding && currentFinding.timingStatus !== current.finding.timingStatus && <p>Current status <strong>{currentFinding.timingStatus}</strong></p>}
        <NoticeEvidence version={current} />
        <div><Button className="min-h-11" disabled={busy} onClick={() => { setFeedback(undefined); setEditing(true); }}>Update amendment</Button></div>
        {history?.versions.slice(1).map(version => <details key={version.version}>
          <summary className="min-h-11 cursor-pointer">Version {version.version} · {version.finding.timingStatus}</summary>
          <NoticeEvidence version={version} />
        </details>)}
        {!!history?.next && <div><Button className="min-h-11" variant="outline" disabled={busy}
          onClick={() => void request({ operation: "history", noticeId, before: history.next ?? undefined })}>Load earlier versions</Button></div>}
      </>}
  </div>;

  const attach = (key: string, button: HTMLButtonElement | null) => {
    if (button) buttons.current.set(key, button);
    else buttons.current.delete(key);
  };
  return <div className="record-form min-w-0">
    <label className="field">Change type on this page<select value={filter} onChange={event => setFilter(event.target.value)}>
      <option value="">All changes</option><option>Principal loan originator</option><option>Application information</option><option>Control person</option>
    </select></label>
    <div><Button className="min-h-11" ref={button => attach("new", button)} onClick={() => open()}>Record amendment</Button></div>
    {listError ? <div><p role="alert">{listError}</p><Button variant="outline" onClick={() => refresh()}>Reload amendments</Button></div> :
      !page ? <p role="status">Loading amendments…</p> : !page.items.some(item => !filter || item.facts.change.kind === filter) ? <p>No amendments match this page.</p> :
        <ul className="grid gap-2">{page.items.filter(item => !filter || item.facts.change.kind === filter).map(item => <li key={item.noticeId}>
          <Button className="h-auto min-h-11 w-full justify-start whitespace-normal text-left" variant="outline"
            ref={button => attach(item.noticeId, button)} onClick={() => open(item.noticeId)}>
            {item.facts.change.kind} · {item.facts.effective.on} · {item.currentFinding.timingStatus}
          </Button></li>)}</ul>}
    {(query.offset > 0 || page?.next != null) && <div className="flex flex-wrap gap-2">
      <Button className="min-h-11" variant="outline" disabled={!page || query.offset === 0} onClick={() => refresh(Math.max(0, query.offset - 20))}>Previous amendments</Button>
      <Button className="min-h-11" variant="outline" disabled={page?.next == null} onClick={() => { if (page?.next != null) refresh(page.next); }}>Next amendments</Button>
    </div>}
  </div>;
}

function NoticeEvidence({ version }: { version: Version }) {
  const { facts, finding } = version;
  const { change } = facts;
  const timing = change.kind === "Control person" ? change.timing : undefined;
  const notice = timing?.route === "First notice" ? timing : undefined;
  const dated = (event?: { on: string; reference: string }) => event && event.on + " · " + event.reference;
  const values = [
    ["Authority", facts.authority + " · " + facts.licenseReference], ["Effective date", dated(facts.effective)],
    ["Nominal deadline", finding.dueOn], ["Timing route", timing?.route],
    ["First notice", dated(notice?.firstNotice)], ["Calendar evidence", notice?.calendar?.reference],
    ["Calendar reviewed through", notice?.calendar?.through], ["Holidays", notice?.calendar?.holidays.join(", ")],
    ["Designation", change.kind === "Principal loan originator" ? change.designationReference : undefined],
    ["Qualification", change.kind === "Principal loan originator" ? change.eligibilityReference ?? "Review qualification evidence" : undefined],
    ["Registry filing", dated(facts.filed)], ["Regulator status", [finding.regulatorStatus, dated(facts.status)].filter(Boolean).join(" · ")],
    ["Recorded by", version.actor], ["Reason for update", version.correction],
  ];
  return <div className="record-form min-w-0 [overflow-wrap:anywhere]">
    <p><strong>{finding.timingStatus}</strong> · Version {version.version} · Reviewed <time className="whitespace-nowrap" dateTime={finding.asOf}>{finding.asOf}</time></p>
    <dl className={grid}>{values.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl>
  </div>;
}
