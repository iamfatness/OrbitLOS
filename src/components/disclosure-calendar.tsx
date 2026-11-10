"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessDisclosureCalendar } from "@/app/actions";
import { dateLabel, easternDate } from "@/lib/client-retention";
import { disclosureCalendarRules, disclosureHolidayLimit, type DisclosureCalendarInput, type DisclosureCalendarPreview,
  type DisclosureCalendarResult, type DisclosureCalendarRules } from "@/lib/disclosure-calendar-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Settings = Extract<DisclosureCalendarResult, { kind: "settings" }>;

export function DisclosureCalendar({ brokerageId, openLoan }: { brokerageId: string; openLoan: (loanId: string) => void }) {
  const [opened, setOpened] = useState(false);
  const [published, setPublished] = useState<Settings>();
  const [draft, setDraft] = useState<DisclosureCalendarRules>();
  const [anchorOn, setAnchorOn] = useState(easternDate);
  const [preview, setPreview] = useState<DisclosureCalendarPreview>();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const pending = useRef(false);

  useEffect(() => {
    if (!opened) return;
    let disposed = false;
    void accessDisclosureCalendar({ type: "read" }, brokerageId).then((result) => {
      if (disposed) return;
      if ("error" in result) setMessage({ text: result.error, error: true });
      else if (result.kind === "settings") { setPublished(result); setDraft(result.current.rules); }
    }, () => { if (!disposed) setMessage({ text: "Could not load the deadline calendar.", error: true }); });
    return () => { disposed = true; };
  }, [brokerageId, opened]);

  function change(update: Partial<DisclosureCalendarRules>) {
    setDraft((current) => current && { ...current, ...update });
    setPreview(undefined);
    setMessage(undefined);
  }

  async function perform(input: DisclosureCalendarInput) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await accessDisclosureCalendar(input, brokerageId);
      if ("error" in result) setMessage({ text: result.error, error: true });
      else if (result.kind === "preview") setPreview(input.type === "preview" && input.after && preview
        ? { ...result, checked: preview.checked + result.checked, affected: [...preview.affected, ...result.affected] } : result);
      else {
        setPublished(result);
        setDraft(result.current.rules);
        setNote("");
        setPreview(undefined);
        if (input.type === "publish") setMessage({ text: `Disclosure deadline calendar v${result.current.version} published.` });
      }
    } catch {
      setMessage({ text: "Could not complete the deadline calendar action.", error: true });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function submit(kind: "preview" | "publish", after?: NonNullable<DisclosureCalendarPreview["next"]>) {
    if (!published || !draft) return;
    const parsed = disclosureCalendarRules.safeParse(draft);
    if (!parsed.success) {
      setMessage({ text: parsed.error.issues[0].message, error: true });
      return;
    }
    const { version } = published.current;
    if (kind === "preview") void perform({ type: kind, version, rules: parsed.data, anchorOn, after });
    else void perform({ type: kind, version, rules: parsed.data, note });
  }

  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit("publish");
  }

  const changed = !!draft && JSON.stringify(draft) !== JSON.stringify(published?.current.rules);
  return <details className="integration document-form" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
    <summary>Disclosure deadline calendar</summary>
    {opened && <section className="record-form" aria-label="Disclosure deadline calendar">
      <p className="muted">Plan internal follow-up for mock signatures. Count open days after the package preparation date.</p>
      {message && <p role={message.error ? "alert" : "status"}>{message.text}</p>}
      {!published && !message && <p role="status">Opening deadline calendar…</p>}
      <div><Button size="sm" variant="outline" disabled={busy} onClick={() => void perform({ type: "read" })}>Reload deadline calendar</Button></div>
      {draft && published && <form className="record-form" onSubmit={publish}>
        <p>Current calendar v{published.current.version}{published.current.publishedBy && ` · Published by ${published.current.publishedBy}`}</p>
        <fieldset className="document-item" disabled={busy}>
          <legend>Open days</legend>
          <p className="muted">Monday through Friday are open except for the closures below.</p>
          <label className="demo-confirm"><input type="checkbox" checked={draft.saturday} onChange={(event) => change({ saturday: event.target.checked })} />
            <span>Saturday is open</span></label>
          <label className="demo-confirm"><input type="checkbox" checked={draft.sunday} onChange={(event) => change({ sunday: event.target.checked })} />
            <span>Sunday is open</span></label>
          <label className="field">Open days until signing target<input type="number" min={1} max={10} required
            value={draft.signingDays || ""} onChange={(event) => change({ signingDays: Number(event.target.value) })} /></label>
        </fieldset>
        <fieldset className="document-item" disabled={busy}>
          <legend>Holidays and office closures</legend>
          <p className="muted">Each date closes the office for this calendar, including an otherwise open weekend.</p>
          {draft.holidays.map((holiday, index) => <div className="form-grid" key={index}>
            <label className="field">Closure date {index + 1}<input type="date" required value={holiday.on}
              onChange={(event) => change({ holidays: draft.holidays.map((item, position) => position === index ? { ...item, on: event.target.value } : item) })} /></label>
            <label className="field">Closure label {index + 1}<input required maxLength={70} value={holiday.label}
              onChange={(event) => change({ holidays: draft.holidays.map((item, position) => position === index ? { ...item, label: event.target.value } : item) })} /></label>
            <div><Button size="sm" variant="outline" aria-label={`Remove closure ${index + 1}`}
              onClick={() => change({ holidays: draft.holidays.filter((_, position) => position !== index) })}>Remove closure</Button></div>
          </div>)}
          <div><Button size="sm" variant="outline" disabled={draft.holidays.length >= disclosureHolidayLimit}
            onClick={() => change({ holidays: [...draft.holidays, { on: "", label: "" }] })}>Add closure</Button></div>
        </fieldset>
        <section className="work-queue" aria-label="Preview signing dates">
          <h4>Preview signing dates</h4>
          <p className="muted">Compare the test date under both calendars and check open packages against their recorded targets.</p>
          <label className="field">Test preparation date<input type="date" value={anchorOn} disabled={busy}
            onChange={(event) => { setAnchorOn(event.target.value); setPreview(undefined); }} /></label>
          <div><Button size="sm" variant="outline" disabled={busy || !anchorOn} onClick={() => submit("preview")}>Preview date changes</Button></div>
          {preview && <>
            <p>Calendar v{preview.before.version} · <strong>{dateLabel(preview.before.signBy)}</strong> → Draft v{preview.after.version} · <strong>{dateLabel(preview.after.signBy)}</strong></p>
            {!!preview.after.skipped.length && <p className="muted">Draft skips {preview.after.skipped.map(({ on, label }) => `${dateLabel(on)} · ${label}`).join(", ")}.</p>}
            <p role="status">{preview.affected.length} proposed date {preview.affected.length === 1 ? "change" : "changes"} across {preview.checked} checked {preview.checked === 1 ? "package" : "packages"}.</p>
            {preview.affected.length > 0 && <ul className="document-list">{preview.affected.map((item) => <li className="document-item" key={item.loanId}>
              <strong>{item.borrower} · {item.state} v{item.version}</strong>
              <p>Calendar v{item.calendarVersion} target {dateLabel(item.from)} → {dateLabel(item.to)}</p>
              <p className="muted">{item.state === "Issued" ? "Keeps the issued signing target." : "Prepare a revised draft after publishing."}</p>
              <div><Button size="sm" variant="outline" aria-label={`Open disclosures for ${item.borrower}`} onClick={() => openLoan(item.loanId)}>Open disclosures</Button></div>
            </li>)}</ul>}
            {preview.next && <div><Button size="sm" variant="outline" disabled={busy}
              onClick={() => submit("preview", preview.next ?? undefined)}>Check more packages</Button></div>}
          </>}
        </section>
        <label className="field">Reason for calendar change<textarea required maxLength={300} rows={2} value={note}
          disabled={busy} onChange={(event) => setNote(event.target.value)} /></label>
        <div><Button size="sm" type="submit" disabled={busy || !changed}>Publish deadline calendar</Button></div>
      </form>}
      {!!published?.history.length && <details className="document-form">
        <summary>Calendar version history</summary>
        <ul className="document-list">{published.history.map(({ version, rules, publishedAt, publishedBy, note }) => <li className="document-item" key={version}>
          <strong>Calendar v{version}</strong>
          <p>{publishedBy} · {publishedAt && `${dateTime(publishedAt)} ET`} · {note}</p>
          <p className="muted">{rules.signingDays} open days · Saturday {rules.saturday ? "open" : "closed"} · Sunday {rules.sunday ? "open" : "closed"}</p>
          {!!rules.holidays.length && <ul>{rules.holidays.map(({ on, label }) => <li key={on}>{dateLabel(on)} · {label}</li>)}</ul>}
        </li>)}</ul>
      </details>}
    </section>}
  </details>;
}
