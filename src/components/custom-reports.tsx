"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessCustomReport } from "@/app/actions";
import { customReportChoices, customReportColumns, customReportDefinition, customReportLimit, customReportMetricLabels,
  customReportPeriods, customReportRoles, defaultCustomReport, type CustomReport, type CustomReportCounts, type CustomReportDefinition,
  type CustomReportGroup, type CustomReportMetric, type CustomReportRecord, type CustomReportRecords, type CustomReportRun } from "@/lib/custom-report-model";
import { leadSources } from "@/lib/model";
import { currentReportMonth } from "@/lib/report-date-range";
import { dateTime, money } from "@/lib/utils";
import { Button } from "./ui/button";
import { CrmFieldFilterEditor } from "./crm-fields";

type Edit = { id: string; revision: number; definition: CustomReportDefinition };
type Drill = { metric: CustomReportMetric; group?: CustomReportGroup; page: CustomReportRecords };

function toggle<T>(options: T[], value: T) {
  return options.includes(value) ? options.filter((option) => option !== value) : [...options, value];
}

function ReportEditor({ edit, brokerageId, busy, change, save, cancel }: {
  edit: Edit; brokerageId: string; busy: boolean; change: (update: Partial<CustomReportDefinition>) => void;
  save: (event: FormEvent<HTMLFormElement>) => void; cancel: () => void;
}) {
  const report = edit.definition;
  const { groups, metrics } = customReportChoices[report.dataset];
  return <form className="record-form document-item" aria-label="Custom report editor" onSubmit={save}>
    <h3>{edit.revision ? "Edit saved report" : "Build a report"}</h3>
    <div className="form-grid">
      <label className="field">Report name<input value={report.name} maxLength={80} required disabled={busy}
        onChange={(event) => change({ name: event.target.value })} /></label>
      <label className="field">Report type<select value={report.dataset} disabled={busy} onChange={(event) => {
        const dataset = event.target.value as CustomReportDefinition["dataset"];
        const choices = customReportChoices[dataset];
        change({ dataset, groupBy: choices.groups.some((group) => group === report.groupBy) ? report.groupBy : "None",
          metrics: [...choices.metrics], roles: report.roles.filter((role) => dataset === "Loan production" || role === "LO") });
      }}><option>Intake cohort</option><option>Loan production</option></select></label>
      <label className="field">Date period<select value={report.period.kind} disabled={busy} onChange={(event) => {
        const kind = event.target.value as CustomReportDefinition["period"]["kind"];
        change({ period: kind === "Fixed dates" ? { kind, ...currentReportMonth() } : { kind } });
      }}>{customReportPeriods.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="field">Group by<select value={report.groupBy} disabled={busy}
        onChange={(event) => change({ groupBy: event.target.value as CustomReportDefinition["groupBy"] })}>
        {groups.map((value) => <option key={value}>{value}</option>)}</select></label>
      {report.period.kind === "Fixed dates" && <>
        <label className="field">From<input type="date" value={report.period.from} required disabled={busy} onChange={(event) => {
          if (report.period.kind === "Fixed dates") change({ period: { ...report.period, from: event.target.value } });
        }} /></label>
        <label className="field">Through<input type="date" value={report.period.through} required disabled={busy} onChange={(event) => {
          if (report.period.kind === "Fixed dates") change({ period: { ...report.period, through: event.target.value } });
        }} /></label>
      </>}
      <label className="field">Lead source filter<select value={report.source} disabled={busy}
        onChange={(event) => change({ source: event.target.value as CustomReportDefinition["source"] })}>
        <option value="">All lead sources</option>{leadSources.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="field">Purpose filter<select value={report.purpose} disabled={busy}
        onChange={(event) => change({ purpose: event.target.value as CustomReportDefinition["purpose"] })}>
        <option value="">All purposes</option><option>Purchase</option><option>Refinance</option></select></label>
    </div>
    <CrmFieldFilterEditor brokerageId={brokerageId} value={report.customFilter} change={(customFilter) => change({ customFilter })} disabled={busy}
      scope={report.dataset === "Intake cohort" ? "Matches values saved on leads." : "Matches values saved on borrower contacts."} />
    <div className="form-grid">
      <fieldset className="document-item" disabled={busy}><legend>Counts to show</legend>
        {metrics.map((metric) => <label className="demo-confirm" key={metric}><input type="checkbox" checked={report.metrics.includes(metric)}
          onChange={() => change({ metrics: toggle(report.metrics, metric) })} /><span>{customReportMetricLabels[metric]}</span></label>)}
      </fieldset>
      <fieldset className="document-item" disabled={busy}><legend>Fields in the drilldown</legend>
        {customReportColumns.map((column) => <label className="demo-confirm" key={column}><input type="checkbox" checked={report.columns.includes(column)}
          onChange={() => change({ columns: toggle(report.columns, column) })} /><span>{column}</span></label>)}
      </fieldset>
      <fieldset className="document-item" disabled={busy}><legend>Share with</legend>
        <p className="muted">Admins can run all reports. Shared reports count each viewer’s own work.</p>
        {customReportRoles.filter((role) => report.dataset === "Loan production" || role === "LO").map((role) => <label className="demo-confirm" key={role}>
          <input type="checkbox" checked={report.roles.includes(role)} onChange={() => change({ roles: toggle(report.roles, role) })} />
          <span>{role === "LO" ? "Loan officers" : "Processors"}</span></label>)}
      </fieldset>
    </div>
    <div className="loan-application-actions">
      <Button size="sm" type="submit" disabled={busy}>Save and run report</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={cancel}>Cancel edit</Button>
    </div>
  </form>;
}

function MetricCounts({ report, counts, busy, onSelect, group }: {
  report: CustomReport; counts: CustomReportCounts; busy: boolean; onSelect: (metric: CustomReportMetric) => void; group?: string;
}) {
  return <div className="loan-application-actions">{report.metrics.map((metric) => <Button key={metric} size="sm" variant="outline" disabled={busy}
    aria-label={group ? `${customReportMetricLabels[metric]} for ${group} · ${counts[metric] ?? 0}` : undefined}
    onClick={() => onSelect(metric)}>{customReportMetricLabels[metric]} · {counts[metric] ?? 0}</Button>)}</div>;
}

export function CustomReports({ brokerageId, role, openRecord }: {
  brokerageId: string; role: "Admin" | "LO" | "Processor";
  openRecord: (record: CustomReportRecord, metric: CustomReportMetric) => void;
}) {
  const admin = role === "Admin";
  const [catalog, setCatalog] = useState<CustomReport[]>();
  const [selected, setSelected] = useState<string>();
  const [edit, setEdit] = useState<Edit>();
  const [run, setRun] = useState<CustomReportRun>();
  const [drill, setDrill] = useState<Drill>();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const drillRegion = useRef<HTMLElement>(null);
  const drillKey = drill && `${drill.metric}:${drill.group?.key ?? ""}`;
  const active = catalog?.find(({ id }) => id === selected);

  useEffect(() => {
    let disposed = false;
    void accessCustomReport({ type: "list" }, brokerageId).then((result) => {
      if (disposed) return;
      if ("error" in result) setMessage({ text: result.error, error: true });
      else if (result.kind === "list") setCatalog(result.reports);
    }, () => { if (!disposed) setMessage({ text: "Could not open saved reports.", error: true }); });
    return () => { disposed = true; };
  }, [brokerageId]);

  useEffect(() => {
    if (drillKey) {
      drillRegion.current?.focus({ preventScroll: true });
      drillRegion.current?.scrollIntoView({ block: "nearest" });
    }
  }, [drillKey]);

  async function perform(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Could not complete the report action.", error: true });
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }

  function reload() {
    void perform(async () => {
      const result = await accessCustomReport({ type: "list" }, brokerageId);
      if ("error" in result) throw new Error(result.error);
      if (result.kind === "list") {
        setCatalog(result.reports);
        setSelected((current) => result.reports.some(({ id }) => id === current) ? current : undefined);
        setEdit(undefined);
        setRun(undefined);
        setDrill(undefined);
        setArchiveOpen(false);
      }
    });
  }

  async function loadReport(report: CustomReport, more = false) {
    const after = more ? run?.next : undefined;
    if (!more) {
      setRun(undefined);
      setDrill(undefined);
    }
    const result = await accessCustomReport({ type: "run", id: report.id, revision: report.revision, after: after ?? undefined }, brokerageId);
    if ("error" in result) throw new Error(result.error);
    if (result.kind === "run") setRun(more && run ? { ...result, groups: [...run.groups, ...result.groups] } : result);
  }

  function readRecords(report: CustomReport, metric: CustomReportMetric, group?: CustomReportGroup, more = false) {
    void perform(async () => {
      const after = more ? drill?.page.next : undefined;
      if (!more) setDrill(undefined);
      const result = await accessCustomReport({ type: "records", id: report.id, revision: report.revision, metric,
        group: group?.key, after: after ?? undefined }, brokerageId);
      if ("error" in result) throw new Error(result.error);
      if (result.kind === "records") setDrill({ metric, group,
        page: more && drill ? { ...result, rows: [...drill.page.rows, ...result.rows] } : result });
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit) return;
    const definition = customReportDefinition.safeParse(edit.definition);
    if (!definition.success) {
      setMessage({ text: definition.error.issues[0].message, error: true });
      return;
    }
    void perform(async () => {
      const result = await accessCustomReport({ type: "save", ...edit, definition: definition.data }, brokerageId);
      if ("error" in result) throw new Error(result.error);
      if (result.kind === "saved") {
        const report = result.report;
        setCatalog((existing) => [...(existing ?? []).filter(({ id }) => id !== report.id), report].sort((a, b) => a.name.localeCompare(b.name)));
        setSelected(report.id);
        setEdit(undefined);
        await loadReport(report);
        setMessage({ text: "Saved and ran the report." });
      }
    });
  }

  return <section className="integration record-form manager-panel" aria-label="Custom reports">
    <div className="section-heading"><h2>Custom reports</h2>
      <Button size="sm" variant="outline" disabled={busy} onClick={reload}>Reload saved reports</Button></div>
    <p className="muted">{role === "Admin" ? "Build a report from intake or production, then choose who can run it." :
      role === "LO" ? "Shared reports count your own leads and loans." : "Shared reports count the loan files assigned to you."}</p>
    {message && <p role={message.error ? "alert" : "status"}>{message.text}</p>}
    {!catalog && !message && <p role="status">Loading saved reports…</p>}
    {catalog && <div className="loan-application-actions">
      <label className="field">Saved report<select value={selected ?? ""} disabled={busy || !!edit} onChange={(event) => {
        const report = catalog.find(({ id }) => id === event.target.value);
        setSelected(report?.id);
        setRun(undefined);
        setDrill(undefined);
        setArchiveOpen(false);
        if (report) void perform(() => loadReport(report));
      }}><option value="">Choose a saved report</option>{catalog.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</select></label>
      {admin && <Button size="sm" disabled={busy || !!edit || catalog.length >= customReportLimit} onClick={() => {
        setArchiveOpen(false);
        setMessage(undefined);
        setEdit({ id: crypto.randomUUID(), revision: 0, definition: defaultCustomReport });
      }}>New report</Button>}
    </div>}
    {catalog?.length === 0 && !edit && <p className="muted">{admin ? "No saved custom reports yet." : "No reports have been shared with your role."}</p>}
    {edit && <ReportEditor edit={edit} brokerageId={brokerageId} busy={busy} change={(update) => {
      setEdit({ ...edit, definition: { ...edit.definition, ...update } });
      setMessage(undefined);
    }} save={save} cancel={() => { setEdit(undefined); setMessage(undefined); }} />}
    {active && !edit && <>
      <div className="section-heading"><h3>{active.name}</h3>
        <div className="loan-application-actions">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(() => loadReport(active))}>Run report</Button>
          {admin && <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => {
              const { id, revision, ...definition } = active;
              setArchiveOpen(false);
              setMessage(undefined);
              setEdit({ id, revision, definition });
            }}>Edit report</Button>
            <Button size="sm" variant="ghost" disabled={busy} aria-expanded={archiveOpen} onClick={() => setArchiveOpen(!archiveOpen)}>Archive report</Button>
          </>}
        </div>
      </div>
      {archiveOpen && admin && <div className="document-item">
        <p>Archive {active.name} and remove it from shared reports?</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(async () => {
          const result = await accessCustomReport({ type: "archive", id: active.id, revision: active.revision }, brokerageId);
          if ("error" in result) throw new Error(result.error);
          if (result.kind === "archived") {
            setCatalog((existing) => existing?.filter(({ id }) => id !== active.id));
            setSelected(undefined);
            setRun(undefined);
            setDrill(undefined);
            setArchiveOpen(false);
            setMessage({ text: "Report archived." });
          }
        })}>Confirm archive</Button>
      </div>}
      {run && <section className="record-form" aria-label="Custom report results">
        <p className="muted">{active.dataset} · {run.from} through {run.through} ET · {admin ? "Brokerage" : "Your work"}</p>
        <p className="muted">{active.dataset === "Intake cohort"
          ? "Open and converted inquiries use the received date. Submission and funding can happen later."
          : "Files, first 1003 submissions, and recorded fundings use their respective event dates."}</p>
        <h4>All matching records</h4>
        <MetricCounts report={active} counts={run.totals} busy={busy} onSelect={(metric) => readRecords(active, metric)} />
        {run.groups.length > 0 && <ul className="document-list">{run.groups.map((group) => <li key={group.key} className="document-item">
          <strong>{group.name}</strong>
          <MetricCounts report={active} counts={group.counts} busy={busy} group={group.name} onSelect={(metric) => readRecords(active, metric, group)} />
        </li>)}</ul>}
        {run.next && <div><Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(() => loadReport(active, true))}>More report groups</Button></div>}
        {drill && <section className="work-queue" aria-label="Report records" tabIndex={-1} ref={drillRegion}>
          <h4>{customReportMetricLabels[drill.metric]}{drill.group && ` · ${drill.group.name}`}</h4>
          {drill.page.rows.length ? <ul className="document-list">{drill.page.rows.map((record) => <li className="document-item" key={record.id}>
            <div className="document-item-head"><strong>{record.name}</strong><span>{record.at.length === 10 ? record.at : `${dateTime(record.at)} ET`}</span></div>
            {active.columns.length > 0 && <p className="muted">{active.columns.map((column) => {
              const value = record.values[column];
              return `${column} · ${typeof value === "number" ? money(value) : value ?? "—"}`;
            }).join(" · ")}</p>}
            <div><Button size="sm" variant="outline" aria-label={`Open ${record.destination.kind} for ${record.name}`}
              onClick={() => openRecord(record, drill.metric)}>Open {record.destination.kind}</Button></div>
          </li>)}</ul> : <p className="muted">No records match this count.</p>}
          {drill.page.next && <div><Button size="sm" variant="outline" disabled={busy}
            onClick={() => readRecords(active, drill.metric, drill.group, true)}>More report records</Button></div>}
        </section>}
      </section>}
    </>}
  </section>;
}
