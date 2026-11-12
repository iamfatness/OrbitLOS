"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import { kansasNoticeConsumers, kansasNoticeEvents, kansasNoticeFacts, kansasNoticeRule, kansasNoticeStatute,
  reviewKansasNotice, type KansasNoticeConsumer, type KansasNoticeFacts } from "@/lib/kansas-consumer-notice-model";
import { Button } from "./ui/button";

type Result = Extract<ComplianceCaseResult, { kind: "kansasNotice" }>;
const eventFields = [{ key: "notice", label: "Written notice delivered" }, ...kansasNoticeEvents] as const;

function NoticeSummary({ facts }: { facts: KansasNoticeFacts }) {
  const review = reviewKansasNotice(facts);
  return <div className="record-form">
    <p className="break-words">{facts.recipientScope} · {facts.scopeReference}</p>
    {review.scopeGaps.map(gap => <p key={gap}>{gap}</p>)}
    {facts.consumers.map((consumer, index) => {
      const result = review.consumers[index];
      return <section key={consumer.recipient} className="record-form" aria-label={consumer.recipient}>
        <h3 className="font-semibold">{consumer.recipient}</h3>
        {consumer.notice && <p className="break-words">Notice version · {consumer.notice.version}</p>}
        <dl>{eventFields.map(({ key, label }) => {
          const event = consumer[key];
          return event && <div key={key}><dt>{label}</dt><dd className="break-words">
            {event.on}{event.time && ` ${event.time}`} · {event.reference}
          </dd></div>;
        })}</dl>
        {result.earliestDate && <p>Earliest recorded timing date · {result.earliestDate}</p>}
        {result.cutoff && <p>Servicing transfer cutoff for review · {result.cutoff}</p>}
        {result.timing.length > 0 && <ul>{result.timing.map(row => <li key={row.label}>{row.label} · {row.result}</li>)}</ul>}
        {result.gaps.length > 0 && <div><strong>Open evidence</strong><ul>{result.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
      </section>;
    })}
  </div>;
}

function ConsumerFields({ prefix, recipient, saved, hidden }: {
  prefix: string; recipient: string; saved?: KansasNoticeConsumer; hidden?: boolean;
}) {
  return <fieldset className={hidden ? undefined : "record-form"} hidden={hidden} disabled={hidden}>
    <legend>{recipient}</legend>
    {eventFields.map(({ key, label }) => {
      const evidence = saved?.[key];
      return <details className="details-section" key={key} open={key === "notice" || undefined}>
        <summary className="min-h-11 content-center">{label}</summary>
        <div className="record-form">
          <div className="form-grid">
            <label className="field">Date<input type="date" name={`${prefix}-${key}-date`} defaultValue={evidence?.on} /></label>
            <label className="field">Local time if documented<input type="time" name={`${prefix}-${key}-time`} defaultValue={evidence?.time} /></label>
          </div>
          <label className="field">Evidence reference<input name={`${prefix}-${key}-reference`} maxLength={180} defaultValue={evidence?.reference} /></label>
          {key === "notice" && <>
            <label className="field">Notice version<input name={`${prefix}-notice-version`} maxLength={180} defaultValue={saved?.notice?.version} /></label>
            <label className="flex min-h-11 items-start gap-2">
              <input className="mt-1" type="checkbox" name={`${prefix}-contents`} defaultChecked={saved?.notice?.reviewedContents} />
              <span>Reviewed the date, company name and address, and prescribed statement in at least 10-point boldface</span>
            </label>
          </>}
        </div>
      </details>;
    })}
    <label className="flex min-h-11 items-start gap-2">
      <input className="mt-1" type="checkbox" name={`${prefix}-triggers`} defaultChecked={saved?.reviewedTriggers} />
      <span>Reviewed which timing events apply to this consumer</span>
    </label>
  </fieldset>;
}

function NoticeEditor({ facts, busy, revision, onSave }: {
  facts?: KansasNoticeFacts; busy: boolean; revision: number; onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [scope, setScope] = useState<string>(facts?.recipientScope ?? "Unresolved");
  const additional = facts?.consumers.find(item => item.recipient === kansasNoticeConsumers[1]);
  const showAdditional = scope === "Two consumers" || (scope === "Unresolved" && !!additional);
  return <form className="record-form" onSubmit={onSave}>
    <fieldset className="record-form" disabled={busy}>
      <label className="field">Consumer scope<select name="recipientScope" value={scope} onChange={event => setScope(event.target.value)}>
        <option>Unresolved</option><option>Primary consumer only</option><option>Two consumers</option>
      </select></label>
      <label className="field">Scope reference<input name="scopeReference" defaultValue={facts?.scopeReference} maxLength={180} required /></label>
      <label className="field">Review time zone<select name="zone" defaultValue={facts?.zone ?? "America/Chicago"}>
        <option value="America/Chicago">Central</option><option value="America/Denver">Mountain</option>
      </select></label>
      <ConsumerFields prefix="primary" recipient={kansasNoticeConsumers[0]}
        saved={facts?.consumers.find(item => item.recipient === kansasNoticeConsumers[0])} />
      {showAdditional && <input type="hidden" name="includeAdditional" value="yes" />}
      <ConsumerFields prefix="additional" recipient={kansasNoticeConsumers[1]} hidden={!showAdditional} saved={additional} />
      {revision > 0 && <label className="field">Correction reference<input name="correction" maxLength={180} required /></label>}
      <div><Button type="submit" size="sm" className="min-h-11">{busy ? "Saving…" : "Save Kansas notice evidence"}</Button></div>
    </fieldset>
  </form>;
}

export function KansasConsumerNotice({ brokerageId, loanId, readOnly }: { brokerageId: string; loanId: string; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Result>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: true }>();
  const retry = useRef<{ body: string; id: string } | undefined>(undefined);
  const feedback = useRef<HTMLParagraphElement>(null);
  const latest = data?.history[0];

  useEffect(() => {
    if (!open) return;
    let active = true;
    void accessComplianceCases({ type: "kansasNotice", input: { operation: "read", loanId, state: "KS" } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) throw new Error(result.error);
      if (result.kind !== "kansasNotice") throw new Error("Could not load Kansas notice evidence. Reload to try again.");
      setData(current => current && current.revision > result.revision ? current : result);
    }).catch(error => {
      if (active) setMessage({ text: error instanceof Error && !(error instanceof TypeError) ? error.message :
        "Could not load Kansas notice evidence. Reload to try again.", error: true });
    });
    return () => { active = false; };
  }, [brokerageId, loanId, open, refresh]);
  useEffect(() => { if (message) feedback.current?.focus(); }, [message]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || readOnly || busy) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim() || undefined;
    const recipientScope = value("recipientScope");
    const consumers = kansasNoticeConsumers.slice(0, form.has("includeAdditional") ? 2 : 1).map((recipient, index) => {
      const prefix = index === 0 ? "primary" : "additional";
      const dates = Object.fromEntries(eventFields.map(({ key }) => {
        const on = value(`${prefix}-${key}-date`);
        const time = value(`${prefix}-${key}-time`);
        const reference = value(`${prefix}-${key}-reference`);
        const version = key === "notice" ? value(`${prefix}-notice-version`) : undefined;
        const reviewedContents = key === "notice" && form.has(`${prefix}-contents`);
        return [key, on || time || reference || version || reviewedContents
          ? { on, time, reference, ...(key === "notice" ? { version, reviewedContents } : {}) } : undefined];
      }));
      return { recipient, ...dates, reviewedTriggers: form.has(`${prefix}-triggers`) };
    });
    const parsed = kansasNoticeFacts.safeParse({ state: "KS", recipientScope, zone: value("zone"), scopeReference: value("scopeReference"), consumers });
    if (!parsed.success) {
      setMessage({ text: "Enter a date and reference for each event you record, and a version for each recorded notice.", error: true });
      return;
    }
    const input = { operation: "save", loanId, expectedRevision: data.revision, facts: parsed.data, correction: value("correction") };
    const body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, id: crypto.randomUUID() };
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await accessComplianceCases({ type: "kansasNotice", input: { ...input, requestId: retry.current.id } }, brokerageId);
      if ("error" in result) throw new Error(result.error);
      if (result.kind !== "kansasNotice") throw new Error("Save could not be confirmed. Retry the same evidence.");
      setData(result);
      retry.current = undefined;
      setMessage({ text: `Kansas notice evidence version ${result.revision} saved.` });
    } catch (error) {
      setMessage({ text: error instanceof Error && !(error instanceof TypeError) ? error.message :
        "Save could not be confirmed. Retry the same evidence.", error: true });
    } finally { setBusy(false); }
  }

  return <details className="details-section" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 content-center">Kansas consumer notice evidence</summary>
    {open && <div className="record-form">
      <p><a className="underline" href={kansasNoticeStatute} target="_blank" rel="noreferrer">K.S.A. 9-2208</a>
        {" · "}<a className="underline" href={kansasNoticeRule} target="_blank" rel="noreferrer">K.A.R. 17-24-1</a></p>
      <p className="muted">Use evidence references and the same local time zone for the recorded events. Counsel reviews the applicable timing and notice version.</p>
      <div><Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={() => {
        setMessage(undefined); setRefresh(value => value + 1);
      }}>Reload saved evidence</Button></div>
      {message && <p ref={feedback} tabIndex={-1} role={message.error ? "alert" : "status"}>{message.text}</p>}
      {!data && !message && <p role="status">Loading Kansas notice evidence…</p>}
      {data && (latest ? <NoticeSummary facts={latest.facts} /> : <p>No Kansas notice evidence recorded.</p>)}
      {data && !readOnly && <details className="details-section">
        <summary className="min-h-11 content-center">{latest ? "Record a notice evidence correction" : "Record Kansas notice evidence"}</summary>
        <NoticeEditor key={data.revision} facts={latest?.facts} busy={busy} revision={data.revision} onSave={save} />
      </details>}
      {data && data.history.length > 1 && <details className="details-section">
        <summary className="min-h-11 content-center">Kansas notice evidence history</summary>
        {data.history.slice(1).map(entry => <details className="details-section" key={entry.revision}>
          <summary className="min-h-11 content-center">Version {entry.revision} · {entry.at.slice(0, 10)}</summary>
          <p>{entry.actor}{entry.correction && ` · ${entry.correction}`}</p>
          <NoticeSummary facts={entry.facts} />
        </details>)}
        {data.moreHistory && <p>Showing the latest 20 versions.</p>}
      </details>}
    </div>}
  </details>;
}
