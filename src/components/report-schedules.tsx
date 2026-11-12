"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarClock, ChevronDown } from "lucide-react";
import { dateLabel } from "@/lib/client-retention";
import { customReportMetricLabels, type CustomReport } from "@/lib/custom-report-model";
import { reportScheduleCadences, type ReportSchedule, type ReportScheduleCadence, type ReportScheduleList,
  type ReportSchedulePreview, type ReportScheduleReceipt, type ReportScheduleRecipient, type ReportScheduleResult } from "@/lib/report-schedule-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Response = Exclude<ReportScheduleResult, { error: string }>;

async function scheduleRequest(endpoint: string, action?: object, signal?: AbortSignal): Promise<Response> {
  const response = await fetch(endpoint, { cache: "no-store", signal, ...(action ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action),
  } : {}) }).catch(() => { throw new Error("Could not confirm the request. Try again or refresh schedules."); });
  const result = await response.json().catch(() => null) as ReportScheduleResult | null;
  if (!response.ok || !result || "error" in result) {
    throw new Error(result && "error" in result ? result.error : "Could not open report schedules. Try again.");
  }
  return result;
}

export function OwnerReportSchedules({ brokerageId, reports, selectedReportId }: {
  brokerageId: string; reports: CustomReport[]; selectedReportId?: string;
}) {
  const [open, setOpen] = useState(false);
  return <details className="uwm-deliveries automation-deliveries report-schedule-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>
      <CalendarClock size={19} aria-hidden="true" />
      <span><strong>Report delivery schedules</strong><small>Simulation only</small></span>
      <ChevronDown className="uwm-disclosure-icon" size={17} aria-hidden="true" />
    </summary>
    {open && <ScheduleCatalog brokerageId={brokerageId} reports={reports} initialReportId={selectedReportId} />}
  </details>;
}

function ScheduleCatalog({ brokerageId, reports, initialReportId }: { brokerageId: string; reports: CustomReport[]; initialReportId?: string }) {
  const endpoint = `/api/brokerages?brokerage=${encodeURIComponent(brokerageId)}&view=report-schedules`;
  const [reportId, setReportId] = useState(initialReportId ?? "");
  const [data, setData] = useState<ReportScheduleList>();
  const [read, setRead] = useState({ before: null as number | null, version: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    scheduleRequest(endpoint + (read.before ? `&before=${read.before}` : ""), undefined, controller.signal).then(result => {
      if (controller.signal.aborted || result.kind !== "list") return;
      setError("");
      setData(previous => read.before && previous ? { ...result,
        schedules: [...new Map([...previous.schedules, ...result.schedules].map(item => [item.reportId, item])).values()],
      } : result);
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, read, reports]);

  function refresh(before: number | null = null) {
    setLoading(true);
    setError("");
    setRead(previous => ({ before, version: previous.version + 1 }));
  }

  const report = reports.find(item => item.id === reportId);
  const saved = data?.schedules.find(item => item.reportId === reportId);
  const archived = data?.schedules.filter(item => item.state === "Report archived" && !reports.some(report => report.id === item.reportId));
  return <div className="uwm-delivery-body record-form">
    <p className="muted">Schedule report summaries for active brokerage admins. Run due deliveries here to record a receipt without sending email.</p>
    <div className="loan-application-actions">
      <label className="field automation-destination-name">Report to schedule<select value={reportId} disabled={editing}
        onChange={event => setReportId(event.target.value)}>
        <option value="">Choose a saved report</option>
        {reports.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        {!!archived?.length && <optgroup label="Archived reports">{archived.map(item =>
          <option key={item.reportId} value={item.reportId}>{item.reportName}</option>)}</optgroup>}
      </select></label>
      <Button size="sm" variant="outline" disabled={loading || editing} onClick={() => refresh()}>Refresh schedules</Button>
    </div>
    {loading && <p className="muted" role="status">Loading report schedules…</p>}
    {error && <p className="application-message banner-error" role="alert">{error}</p>}
    {data && !report && !saved && <p className="empty-inline">{reports.length || archived?.length ?
      "Choose a report to set its schedule or view receipts." : "Save a custom report to schedule its summary."}</p>}
    {data && (report || saved) && <ScheduleDetail key={reportId} endpoint={endpoint} reportId={reportId} report={report} saved={saved}
      today={data.today} recipients={data.recipients} onBusy={setEditing} onRun={refresh} onSave={schedule =>
        setData(previous => previous ? { ...previous, schedules: [...previous.schedules.filter(item => item.reportId !== reportId), schedule] } : previous)} />}
    {data?.nextArchive != null && <div className="loan-application-actions">
      <Button size="sm" variant="outline" disabled={loading || editing} onClick={() => refresh(data.nextArchive)}>Load older archived reports</Button>
    </div>}
  </div>;
}

function ScheduleDetail({ endpoint, reportId, report, saved, today, recipients, onSave, onRun, onBusy }: {
  endpoint: string; reportId: string; report?: CustomReport; saved?: ReportSchedule; today: string; recipients: ReportScheduleRecipient[];
  onSave: (schedule: ReportSchedule) => void; onRun: () => void; onBusy: (busy: boolean) => void;
}) {
  const [cadence, setCadence] = useState<ReportScheduleCadence>(saved?.cadence ?? "Weekly");
  const [startsOn, setStartsOn] = useState(saved?.startsOn ?? today);
  const [selected, setSelected] = useState(saved?.recipients.map(item => item.email) ?? []);
  const [preview, setPreview] = useState<ReportSchedulePreview>();
  const [receipt, setReceipt] = useState<ReportScheduleReceipt>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const pending = useRef<{ key: string; operationId: string } | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { if (notice) feedback.current?.focus(); }, [notice]);
  useEffect(() => { if (preview) previewHeading.current?.focus(); }, [preview]);

  async function perform(action: object, remember = true) {
    if (busy) return;
    const key = JSON.stringify(action);
    if (remember && pending.current?.key !== key) pending.current = { key, operationId: crypto.randomUUID() };
    setBusy(true);
    onBusy(true);
    setNotice(undefined);
    try {
      const result = await scheduleRequest(endpoint, { reportId, ...action, ...(remember ? { operationId: pending.current?.operationId } : {}) });
      if (result.kind === "saved") {
        onSave(result.schedule);
        setPreview(undefined);
        setSelected(result.schedule.recipients.map(item => item.email));
        setNotice({ text: "type" in action && action.type === "setPaused" ?
          (result.schedule.paused ? "Schedule paused." : "Schedule resumed.") : "Schedule saved." });
      }
      if (result.kind === "preview") setPreview(result);
      if (result.kind === "receipt" && saved) {
        onSave({ ...saved, nextOn: result.nextOn });
        setReceipt(result);
        setPreview(undefined);
        setNotice({ text: "Simulated delivery recorded." });
        onRun();
      }
      pending.current = null;
    } catch (failure) {
      setNotice({ text: failure instanceof Error ? failure.message : "Could not complete the schedule action.", error: true });
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!report) return;
    const approved = selected.filter(email => recipients.some(item => item.email === email));
    if (!approved.length || approved.length !== selected.length) {
      setNotice({ text: "Choose active brokerage admins as recipients.", error: true });
      return;
    }
    void perform({ type: "save", reportRevision: report.revision, revision: saved?.revision ?? 0, cadence, startsOn, recipients: approved });
  }

  const canEdit = report && saved?.state !== "Report archived";
  const due = saved?.state === "Active" && saved.nextOn <= today;
  return <section className="document-item record-form" aria-label="Selected report schedule">
    <div className="document-item-head"><h3>{report?.name ?? saved?.reportName}</h3>{saved && <span className="pill">{saved.state}</span>}</div>
    {saved && <p className="muted">Report version {saved.reportRevision} · Schedule version {saved.revision}
      {saved.state !== "Report archived" && ` · Next delivery ${dateLabel(saved.nextOn)} ET`}</p>}
    {saved?.state === "Report changed" && <p>Review the current saved report and save these schedule settings to use its new version.</p>}
    {saved?.state === "Recipients changed" && <p>Review the recipients and save the schedule again.</p>}
    {notice && <p ref={feedback} tabIndex={-1} role={notice.error ? "alert" : "status"}
      className={`application-message${notice.error ? " banner-error" : ""}`}>{notice.text}</p>}
    {canEdit && <form className="record-form" onSubmit={save} aria-label="Report delivery settings">
      <div className="form-grid">
        <label className="field">Frequency<select value={cadence} disabled={busy}
          onChange={event => setCadence(event.target.value as ReportScheduleCadence)}>
          {reportScheduleCadences.map(item => <option key={item}>{item}</option>)}
        </select></label>
        <label className="field">First delivery date (ET)<input type="date" value={startsOn} required
          min={saved && saved.startsOn < today ? saved.startsOn : today} disabled={busy} onChange={event => setStartsOn(event.target.value)} /></label>
      </div>
      <fieldset className="automation-subscriptions" disabled={busy}>
        <legend>Recipients</legend>
        {recipients.map(({ email, name }) => <label className="automation-subscription" key={email}>
          <input type="checkbox" checked={selected.includes(email)} disabled={!selected.includes(email) && selected.length >= 5}
            onChange={event => setSelected(previous => event.target.checked ? [...previous, email] : previous.filter(value => value !== email))} />
          <span>{name} · {email}</span>
        </label>)}
        {saved?.recipients.filter(item => !recipients.some(member => member.email === item.email)).map(({ email, name }) =>
          <label className="automation-subscription" key={email}><input type="checkbox" checked={selected.includes(email)}
            disabled={!selected.includes(email)} onChange={() => setSelected(previous => previous.filter(value => value !== email))} />
            <span>{name} · Access unavailable</span></label>)}
      </fieldset>
      <div className="loan-application-actions">
        <Button type="submit" size="sm" disabled={busy}>{busy ? "Working…" : "Save schedule"}</Button>
        {saved && <Button type="button" size="sm" variant="outline" disabled={busy || (saved.paused && saved.state !== "Paused")}
          onClick={() => void perform({ type: "setPaused", revision: saved.revision, paused: !saved.paused })}>
          {saved.paused ? "Resume schedule" : "Pause schedule"}
        </Button>}
      </div>
    </form>}
    {due && saved && <div className="loan-application-actions">
      <Button type="button" size="sm" variant="outline" disabled={busy}
        onClick={() => void perform({ type: "preview", revision: saved.revision, scheduledOn: saved.nextOn }, false)}>Preview due delivery</Button>
    </div>}
    {preview && due && saved.revision === preview.scheduleRevision && saved.nextOn === preview.scheduledOn &&
      <section className="record-form" aria-labelledby="report-schedule-preview">
      <h4 id="report-schedule-preview" ref={previewHeading} tabIndex={-1}>Due delivery preview</h4>
      <ReportSummary summary={preview} />
      <div className="loan-application-actions"><Button type="button" size="sm" disabled={busy}
        onClick={() => void perform({ type: "run", revision: preview.scheduleRevision, scheduledOn: preview.scheduledOn, fingerprint: preview.fingerprint })}>
        Simulate delivery
      </Button></div>
    </section>}
    {saved && <ReceiptHistory endpoint={endpoint} reportId={reportId} latest={receipt} />}
  </section>;
}

function ReportSummary({ summary }: { summary: ReportSchedulePreview | ReportScheduleReceipt }) {
  return <div className="record-form">
    <p><strong>{summary.reportName}</strong> · Report version {summary.reportRevision}</p>
    <p className="muted">Scheduled for {dateLabel(summary.scheduledOn)} ET · Schedule version {summary.scheduleRevision}</p>
    <p className="muted">{dateLabel(summary.from)} through {dateLabel(summary.through)} ET</p>
    <p className="muted">Recipients · {summary.recipients.map(item => `${item.name} (${item.email})`).join(", ")}</p>
    <dl className="details-grid">
      {summary.metrics.map(metric => <div key={metric}><dt>{customReportMetricLabels[metric]}</dt><dd>{summary.totals[metric] ?? 0}</dd></div>)}
    </dl>
  </div>;
}

function ReceiptHistory({ endpoint, reportId, latest }: { endpoint: string; reportId: string; latest?: ReportScheduleReceipt }) {
  const [page, setPage] = useState<Extract<Response, { kind: "history" }>>();
  const [before, setBefore] = useState<number>();
  const [selected, setSelected] = useState<ReportScheduleReceipt>();
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    scheduleRequest(`${endpoint}&reportId=${encodeURIComponent(reportId)}${before ? `&before=${before}` : ""}`, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted && result.kind === "history") setPage(result); })
      .catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [endpoint, reportId, before, latest, version]);

  useEffect(() => { if (selected) heading.current?.focus(); }, [selected]);
  const receipts = page?.receipts ?? [];
  const rows = latest && !before && !receipts.some(item => item.id === latest.id) ? [latest, ...receipts] : receipts;
  return <section className="record-form" aria-label="Delivery receipts">
    <h4>Delivery receipts</h4>
    {error && <p role="alert">{error}</p>}
    {selected && <div className="record-form">
      <h4 ref={heading} tabIndex={-1}>Simulated delivery receipt</h4>
      <ReportSummary summary={selected} />
      <p className="muted">Recorded {dateTime(selected.recordedAt)} · {selected.actor}</p>
      <div className="loan-application-actions"><Button type="button" size="sm" variant="outline" onClick={() => {
        setSelected(undefined);
        opener.current?.focus();
      }}>Back to receipts</Button></div>
    </div>}
    {rows.length ? <ul className="automation-attempts">{rows.map(item => <li key={item.id}>
      <strong>{dateLabel(item.scheduledOn)} · Simulated</strong>
      <span className="muted">Report version {item.reportRevision} · {item.recipients.length} {item.recipients.length === 1 ? "recipient" : "recipients"}</span>
      <div><Button type="button" size="sm" variant="outline" onClick={event => {
        opener.current = event.currentTarget;
        if (selected?.id === item.id) heading.current?.focus();
        else setSelected(item);
      }}>Open receipt</Button></div>
    </li>)}</ul> : <p className="empty-inline">{page ? "No deliveries have been simulated for this schedule." : "Loading delivery receipts…"}</p>}
    <div className="loan-application-actions">
      {error && <Button type="button" size="sm" variant="outline" onClick={() => { setError(""); setVersion(value => value + 1); }}>Reload receipts</Button>}
      {before && <Button type="button" size="sm" variant="outline" onClick={() => { setSelected(undefined); setBefore(undefined); }}>Newest receipts</Button>}
      {page?.next != null && <Button type="button" size="sm" variant="outline"
        onClick={() => { setSelected(undefined); setBefore(page.next ?? undefined); }}>Older receipts</Button>}
    </div>
  </section>;
}
