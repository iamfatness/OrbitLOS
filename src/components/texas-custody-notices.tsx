"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases, accessLoanRetention } from "@/app/actions";
import type { ProgramEntity } from "@/lib/compliance-program-model";
import type { TexasCustodyNoticeResult } from "@/lib/texas-custody-notice";
import { texasCustodyNoticeFacts, texasCustodyNoticeTenthDay, type TexasCustodyNoticeFacts } from "@/lib/texas-custody-notice-model";
import { texasRecordkeepingSources } from "@/lib/texas-recordkeeping-model";
import { dateTime } from "@/lib/utils";
import { RegisterChoice, RegisterField } from "./retention-register-fields";
import { Button } from "./ui/button";

type Facts = TexasCustodyNoticeFacts;
type List = Extract<TexasCustodyNoticeResult, { kind: "texasCustodyNoticeList" }>;
type History = Extract<TexasCustodyNoticeResult, { kind: "texasCustodyNoticeHistory" }>;
type Entry = History["versions"][number];
const kinds = ["Cessation", "Transfer received"] as const;
const authorities = ["SML mortgage company", "SML mortgage banker"] as const;
const zones = ["America/Chicago", "America/Denver"] as const;
const blank: Facts = { kind: "Cessation", authority: "SML mortgage company", authorityReference: "",
  zone: "America/Chicago", trigger: { on: "", reference: "" }, custodyReference: "" };
const kindLabel = (kind: Facts["kind"]) => kind === "Cessation" ? "Company stopped operating" : "Company received records";
const zoneLabel = (zone: Facts["zone"]) => zone === "America/Chicago" ? "Central time" : "Mountain time";

export function TexasCustodyNotices({ brokerageId, onBack, defaultTrigger, backLabel = "Back to loan retention" }: {
  brokerageId: string; onBack: () => void; defaultTrigger?: Facts["kind"]; backLabel?: string;
}) {
  const [entities, setEntities] = useState<ProgramEntity[]>();
  const [entityId, selectEntity] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [locked, setLocked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    let active = true;
    void accessComplianceCases({ type: "program", input: { operation: "entities" } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) setError(result.error);
      else if (result.kind === "programEntities") setEntities(result.entities);
    }).catch(() => { if (active) setError("Could not load legal entities."); });
    return () => { active = false; };
  }, [brokerageId, reload]);

  const company = entities?.find(entity => entity.id === entityId);
  return <section className="integration manager-panel record-form loan-retention">
    <div className="section-heading">
      <h2 ref={heading} tabIndex={-1}>Texas custody notices</h2>
      <Button className="min-h-11" variant="outline" disabled={locked} onClick={onBack}>{backLabel}</Button>
    </div>
    <p>Track the notice for the company that stopped operating or the Texas licensee or registrant that received its records. Record each company’s notice separately.</p>
    <p><a className="underline" href={texasRecordkeepingSources.rules}>Texas rules on custody of records</a></p>
    {error && <><p role="alert">{error}</p><div><Button variant="outline" onClick={() => { setError(""); setReload(value => value + 1); }}>Reload legal entities</Button></div></>}
    {!entities && !error && <p role="status">Loading legal entities…</p>}
    {entities?.length === 0 && <p>Add the company as a legal entity in the License register to start tracking its notice.</p>}
    {!!entities?.length && <div className="max-w-lg"><RegisterChoice label="Company responsible for this notice" value={entityId}
      options={["", ...entities.map(entity => entity.id)]} change={selectEntity} disabled={locked}
      optionLabel={id => entities.find(entity => entity.id === id)?.name ?? "Select legal entity"} />
      {company && <p className="mt-2 break-words sm:hidden">{company.name}</p>}</div>}
    {entityId && <NoticeRegister key={entityId} brokerageId={brokerageId} entityId={entityId} lock={setLocked} defaultTrigger={defaultTrigger} />}
  </section>;
}

function NoticeRegister({ brokerageId, entityId, lock, defaultTrigger }: {
  brokerageId: string; entityId: string; lock: (value: boolean) => void; defaultTrigger?: Facts["kind"];
}) {
  const [list, setList] = useState<List>();
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [listProblem, setListProblem] = useState("");
  const [problem, setProblem] = useState("");
  const [history, setHistory] = useState<History>();
  const [selection, setSelection] = useState("");
  const [view, setView] = useState<Entry>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const origin = useRef("");
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const retry = useRef<{ id: string; payload: string }>(null);
  const receipt = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let active = true;
    void accessLoanRetention({ type: "texasCustodyNotice", entityId, input: { operation: "list", offset } }, brokerageId)
      .then(result => {
        if (!active) return;
        if ("error" in result) setListProblem(result.error);
        else if (result.kind === "texasCustodyNoticeList") setList(result);
      }).catch(() => { if (active) setListProblem("Could not load the notices. Try again."); });
    return () => { active = false; };
  }, [brokerageId, entityId, offset, reload]);

  useEffect(() => {
    if (selection) heading.current?.focus();
    else if (list && origin.current) {
      buttons.current.get(origin.current)?.focus();
      origin.current = "";
    }
  }, [list, selection, editing]);
  useEffect(() => { if (message) receipt.current?.focus(); }, [message]);

  function refresh(nextOffset: number) {
    setList(undefined);
    setListProblem("");
    setOffset(nextOffset);
    setReload(value => value + 1);
  }

  async function read(id: string, before?: number) {
    setBusy(true);
    lock(true);
    setProblem("");
    try {
      const result = await accessLoanRetention({ type: "texasCustodyNotice", entityId,
        input: { operation: "history", noticeId: id, before } }, brokerageId);
      if ("error" in result) setProblem(result.error);
      else if (result.kind === "texasCustodyNoticeHistory") {
        if (before) setHistory(current => ({ ...result, versions: [...(current?.versions ?? []), ...result.versions] }));
        else { setHistory(result); setView(result.versions[0]); }
        if (!result.versions.length && !before) setProblem("This notice could not be found.");
      }
    } catch {
      setProblem("Could not open notice history. Try again.");
    } finally {
      setBusy(false);
      lock(false);
    }
  }

  function open(id: string, isNew = false) {
    origin.current = isNew ? "new" : id;
    setSelection(id);
    setProblem("");
    setMessage("");
    setEditing(isNew);
    if (!isNew) void read(id);
  }

  function back() {
    setSelection("");
    setHistory(undefined);
    setView(undefined);
    setEditing(false);
    setMessage("");
    setProblem("");
    retry.current = null;
  }

  async function save(facts: Facts, correction: string) {
    setProblem("");
    setMessage("");
    const parsed = texasCustodyNoticeFacts.safeParse(facts);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const field = first?.path[0];
      setProblem(first?.code === "custom" ? first.message : field === "calendar"
        ? "Enter valid dates for the reviewed calendar and its holidays."
        : "Check the dates and enter at least four characters for each evidence reference.");
      return;
    }
    const current = history?.versions[0];
    if (current && correction.trim().length < 4) {
      setProblem("Enter a reason for the correction (at least four characters).");
      return;
    }
    const input = { operation: "save" as const, noticeId: selection, expected: current?.version ?? 0,
      facts: parsed.data, correction: current ? correction.trim() : undefined };
    const payload = JSON.stringify(input);
    if (retry.current?.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
    setBusy(true);
    lock(true);
    try {
      const result = await accessLoanRetention({ type: "texasCustodyNotice", entityId,
        input: { ...input, requestId: retry.current.id } }, brokerageId);
      if ("error" in result) setProblem(result.error);
      else if (result.kind === "texasCustodyNoticeHistory") {
        setHistory(result);
        setView(result.versions[0]);
        setEditing(false);
        retry.current = null;
        setMessage("Notice evidence saved.");
        refresh(offset);
      }
    } catch {
      setProblem("Could not verify the save. Retry with the same entries to check it.");
    } finally {
      setBusy(false);
      lock(false);
    }
  }

  if (!selection) return <div className="record-form">
    <div><Button ref={node => { if (node) buttons.current.set("new", node); }} className="min-h-11" onClick={() => open(crypto.randomUUID(), true)}>Record notice evidence</Button></div>
    {listProblem && <><p role="alert">{listProblem}</p><div><Button variant="outline" onClick={() => refresh(offset)}>Reload notices</Button></div></>}
    {!list && !listProblem && <p role="status">Loading notices…</p>}
    {list?.items.length === 0 && <p>No custody notices recorded for this company.</p>}
    {list?.items.map(item => <div className="border-t border-[var(--line)] py-3" key={item.noticeId}>
      <div className="section-heading">
        <div><strong>{kindLabel(item.facts.kind)} · {item.facts.trigger.on}</strong>
          <p>{item.currentFinding.status}{item.currentFinding.dueOn ? " · Due " + item.currentFinding.dueOn : ""}</p></div>
        <Button ref={node => { if (node) buttons.current.set(item.noticeId, node); else buttons.current.delete(item.noticeId); }}
          variant="outline" className="min-h-11" onClick={() => open(item.noticeId)}>Open notice</Button>
      </div>
    </div>)}
    {(offset > 0 || list?.next != null) && <div className="loan-application-actions">
      <Button variant="outline" disabled={!list || offset === 0} onClick={() => refresh(Math.max(0, offset - 20))}>Previous notices</Button>
      <Button variant="outline" disabled={list?.next == null} onClick={() => refresh(list?.next ?? offset)}>Next notices</Button>
    </div>}
  </div>;

  const current = history?.versions[0];
  const liveFinding = list?.items.find(item => item.noticeId === selection && item.version === current?.version)?.currentFinding;
  return <div className="record-form border-t border-[var(--line)] pt-4">
    <div className="section-heading">
      <h3 ref={heading} tabIndex={-1}>{editing ? current ? "Correct notice evidence" : "Record notice evidence" : "Notice evidence"}</h3>
      <Button variant="outline" className="min-h-11" disabled={busy} onClick={back}>Back to notices</Button>
    </div>
    {message && <p ref={receipt} tabIndex={-1} role="status">{message}</p>}
    {problem && <p role="alert">{problem}</p>}
    {busy && <p role="status">{editing ? "Saving evidence…" : "Loading notice history…"}</p>}
    {editing && <NoticeEditor entry={current} defaultTrigger={defaultTrigger} busy={busy} onSave={save} />}
    {!editing && !view && problem && <div><Button variant="outline" onClick={() => void read(selection)}>Retry notice history</Button></div>}
    {!editing && view && <>
      {view.version === current?.version && liveFinding && liveFinding.status !== view.finding.status &&
        <p>Current status <strong>{liveFinding.status}</strong> as of {liveFinding.asOf}</p>}
      <NoticeEvidence entry={view} />
      <div className="loan-application-actions">
        {view.version === current?.version && <Button disabled={busy} onClick={() => { setMessage(""); setEditing(true); }}>Correct evidence</Button>}
        {view.version !== current?.version && <Button variant="outline" disabled={busy} onClick={() => setView(current)}>Show current version</Button>}
      </div>
      <details>
        <summary className="min-h-11 content-center">Version history</summary>
        {history?.versions.map(entry => <div className="section-heading border-t border-[var(--line)] py-2" key={entry.version}>
          <div><strong>Version {entry.version}</strong><p>{dateTime(entry.at)} · {entry.actor}</p>{entry.correction && <p>{entry.correction}</p>}</div>
          <Button variant="outline" disabled={busy || view.version === entry.version} onClick={() => setView(entry)}>View version {entry.version}</Button>
        </div>)}
        {history?.next != null && <Button variant="outline" disabled={busy} onClick={() => void read(selection, history.next ?? undefined)}>Load earlier versions</Button>}
      </details>
    </>}
    {editing && current && problem.includes("Reload") && <div><Button variant="outline" disabled={busy} onClick={() => {
      setEditing(false);
      void read(selection);
    }}>Reload current evidence</Button></div>}
  </div>;
}

function NoticeEvidence({ entry }: { entry: Entry }) {
  const { facts, finding } = entry;
  return <div className="record-form [overflow-wrap:anywhere]">
    <div><strong>{kindLabel(facts.kind)} · {entry.entity.name}</strong><p>Version {entry.version} · {finding.status} as of {finding.asOf}</p></div>
    <dl className="grid gap-3 sm:grid-cols-2">
      <div><dt className="font-semibold">Notice deadline</dt><dd>{finding.dueOn ?? "Needs review"} · {zoneLabel(facts.zone)}</dd></div>
      <div><dt className="font-semibold">Rule and license reference</dt><dd>{finding.authority} · {facts.authorityReference}</dd></div>
      <div><dt className="font-semibold">Trigger date and evidence</dt><dd>{facts.trigger.on} · {facts.trigger.reference}</dd></div>
      <div><dt className="font-semibold">Records location reference</dt><dd>{facts.custodyReference}</dd></div>
      {facts.calendar && <div><dt className="font-semibold">Reviewed calendar</dt><dd>{facts.calendar.from} to {facts.calendar.through} · {facts.calendar.reference}</dd>
        <dd>Holidays: {facts.calendar.holidays.join(", ") || "None recorded"}</dd></div>}
      {facts.delivered && <div><dt className="font-semibold">Notice delivery</dt><dd>{facts.delivered.on} · {facts.delivered.writtenNotice}</dd>
        <dd>{facts.delivered.deliveryEvidence}</dd></div>}
    </dl>
    {entry.correction && <p><strong>Correction reason</strong> {entry.correction}</p>}
  </div>;
}

function NoticeEditor({ entry, defaultTrigger, busy, onSave }: {
  entry?: Entry; defaultTrigger?: Facts["kind"]; busy: boolean; onSave: (facts: Facts, correction: string) => Promise<void>;
}) {
  const [facts, setFacts] = useState(entry?.facts ?? { ...blank, kind: defaultTrigger ?? blank.kind });
  const [holidays, setHolidays] = useState(entry?.facts.calendar?.holidays.join(", ") ?? "");
  const [correction, setCorrection] = useState("");
  const calendarHelp = useId();
  const tenthDay = texasCustodyNoticeTenthDay(facts.trigger.on);
  const triggerLabel = facts.kind === "Cessation" ? "Date operations stopped" : "Date records were received";
  const update = (changes: Partial<Facts>) => setFacts(current => ({ ...current, ...changes }));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    void onSave({ ...facts, calendar: facts.calendar && { ...facts.calendar, holidays: holidays.split(",").map(date => date.trim()).filter(Boolean) } }, correction);
  }

  return <form onSubmit={submit} className="record-form">
    <fieldset disabled={busy} className="record-form min-w-0">
      <div className="grid gap-3 sm:grid-cols-2">
        {entry ? <p><strong>Notice trigger</strong><br />{kindLabel(facts.kind)}</p> :
          <RegisterChoice label="Notice trigger" value={facts.kind} options={kinds} optionLabel={kindLabel} change={kind => update({ kind })} />}
        <RegisterField label={triggerLabel} value={facts.trigger.on} change={on => update({ trigger: { ...facts.trigger, on } })} date required />
        <RegisterChoice label="Texas license or registration type" value={facts.authority} options={authorities} change={authority => update({ authority })} />
        <RegisterField label="License or registration evidence reference" value={facts.authorityReference}
          change={authorityReference => update({ authorityReference })} limit={240} required />
        <RegisterField label="Trigger evidence reference" value={facts.trigger.reference}
          change={reference => update({ trigger: { ...facts.trigger, reference } })} limit={240} required />
        <RegisterField label="Records location reference" value={facts.custodyReference}
          change={custodyReference => update({ custodyReference })} limit={240} required />
      </div>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={!!facts.calendar}
        onChange={event => update({ calendar: event.target.checked ? { from: "", through: "", holidays: [], reference: "" } : undefined })} />
        Add a reviewed calendar to calculate the deadline</label>
      {facts.calendar && <section className="record-form" aria-label="Deadline calendar" aria-describedby={calendarHelp}>
        <p className="muted max-w-[72ch]" id={calendarHelp}>
          {tenthDay ? <>Start your review on or before <time dateTime={tenthDay}>{tenthDay}</time>, ten calendar days after the event.</>
            : "For notices under the current rule, start your review on or before the tenth calendar day after the event."}
          {" "}Include that day and any following weekends or legal holidays through the first eligible day.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <RegisterChoice label="Texas time zone" value={facts.zone} options={zones} optionLabel={zoneLabel} change={zone => update({ zone })} />
          <RegisterField label="Calendar evidence reference" value={facts.calendar.reference}
            change={reference => update({ calendar: { ...facts.calendar!, reference } })} limit={240} required />
          <RegisterField label="Calendar reviewed from" value={facts.calendar.from} change={from => update({ calendar: { ...facts.calendar!, from } })} date required />
          <RegisterField label="Calendar reviewed through" value={facts.calendar.through} change={through => update({ calendar: { ...facts.calendar!, through } })} date required />
          <RegisterField label="Holiday dates (YYYY-MM-DD, separated by commas)" value={holidays} change={setHolidays} limit={371} multiline />
        </div>
      </section>}
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={!!facts.delivered}
        onChange={event => update({ delivered: event.target.checked ? { on: "", writtenNotice: "", deliveryEvidence: "" } : undefined })} />
        Record delivery to Texas SML</label>
      {facts.delivered && <div className="grid gap-3 sm:grid-cols-2">
        <RegisterField label="Delivery date" value={facts.delivered.on} change={on => update({ delivered: { ...facts.delivered!, on } })} date required />
        <RegisterField label="Written notice reference" value={facts.delivered.writtenNotice}
          change={writtenNotice => update({ delivered: { ...facts.delivered!, writtenNotice } })} limit={240} required />
        <RegisterField label="Proof of delivery reference" value={facts.delivered.deliveryEvidence}
          change={deliveryEvidence => update({ delivered: { ...facts.delivered!, deliveryEvidence } })} limit={240} required />
      </div>}
      {entry && <RegisterField label="Correction reason" value={correction} change={setCorrection} multiline limit={240} required />}
      <div><Button type="submit" className="min-h-11" disabled={busy}>Save notice evidence</Button></div>
    </fieldset>
  </form>;
}
