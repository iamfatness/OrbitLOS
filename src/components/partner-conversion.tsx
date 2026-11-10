import { dateLabel } from "@/lib/client-retention";
import { leadSources } from "@/lib/model";
import { conversionMetrics, type ConversionPartner, type RealtorDirectoryPage, type RealtorFilters,
  type RealtorRecord, type RealtorRecordsPage, type RealtorRecordView } from "@/lib/realtor-work-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export type ConversionMetric = keyof typeof conversionMetrics;
export type ConversionSelection = { partnerId: string; view: ConversionMetric };
const metricKeys = Object.keys(conversionMetrics) as ConversionMetric[];

export function PartnerConversion({ page, selected, selection, filters, search, busy, setFilters, setSearch, selectPartner, open, refresh, loadMore }: {
  page?: RealtorDirectoryPage; selected: string; selection?: ConversionSelection; filters: RealtorFilters; search: string; busy: boolean;
  setFilters: (filters: RealtorFilters) => void; setSearch: (search: string) => void; selectPartner: (partnerId: string) => void;
  open: (selection: ConversionSelection) => void; refresh: () => void; loadMore?: () => void;
}) {
  const report = page ? [...page.partners, ...(page.direct ? [page.direct] : [])] : [];
  function change<K extends keyof RealtorFilters>(key: K, value: RealtorFilters[K]) {
    setFilters({ ...filters, [key]: value });
  }

  return <section className="pipeline partner-conversion" aria-label="Partner conversion">
    <div className="pipeline-heading"><div><h2>Partner conversion</h2>
      <p>Open a realtor to manage the relationship or a count to see the records behind it. Conversion credit follows the original referral.</p></div></div>
    <div className="filter-row">
      <label className="field">Search realtors<input type="search" value={search} maxLength={120}
        placeholder="Name, email, or phone" onChange={(event) => setSearch(event.target.value)} /></label>
      <label className="field">Leads from<input type="date" value={filters.from} max={filters.through || undefined} onChange={(event) => change("from", event.target.value)} /></label>
      <label className="field">Leads through<input type="date" value={filters.through} min={filters.from || undefined} onChange={(event) => change("through", event.target.value)} /></label>
      <label className="field">Officer<select value={filters.officer} onChange={(event) => change("officer", event.target.value)}><option value="">All officers</option>
        {page?.officers?.map(({ key, name }) => <option key={key} value={key}>{name || key}</option>)}
        {filters.officer && !page?.officers?.some(({ key }) => key === filters.officer) && <option value={filters.officer}>{filters.officer}</option>}</select></label>
      <label className="field">Lead source<select value={filters.source} onChange={(event) => change("source", event.target.value as RealtorFilters["source"])}><option value="">All lead sources</option>
        {leadSources.map((value) => <option key={value}>{value}</option>)}</select></label>
      <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>Refresh realtors</Button>
    </div>
    <p className="relationship-inset muted">Dates filter original intake in Eastern time. Officer follows the current owner. Funding uses the recorded date.</p>
    {report.length > 0 && <p className="relationship-inset muted report-scroll-hint">Scroll across for submitted and funded counts.</p>}
    {page && (report.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Partner conversion table"><table className="data-table">
      <thead><tr><th scope="col">Realtor</th>{metricKeys.map((key) => <th scope="col" key={key}>{conversionMetrics[key]}</th>)}<th scope="col">Funded conversion</th></tr></thead>
      <tbody>{report.map((row: ConversionPartner) => <tr key={row.id}>
        <th scope="row">{row.id ? <button className="name-link" type="button" aria-pressed={selected === row.id}
          disabled={busy} onClick={() => selectPartner(row.id)}>{row.name}</button> : <>{row.name}<small>Direct and other unattributed loans</small></>}</th>
        {metricKeys.map((view) => {
          const count = row.counts[view];
          const active = selection?.partnerId === row.id && selection.view === view;
          return <td key={view}><Button size="sm" variant={active ? "default" : "outline"} aria-pressed={active} disabled={busy || !count}
            aria-label={`${row.name} · ${conversionMetrics[view]} · ${count}`}
            onClick={() => open({ partnerId: row.id, view })}>{count}</Button></td>;
        })}
        <td>{row.counts.referrals ? `${Math.round(100 * row.counts.funded / row.counts.referrals)}%` : "—"}
          <small>{row.counts.funded} funded / {row.counts.referrals} leads</small></td>
      </tr>)}</tbody>
    </table></div> : <p className="empty-inline no-matches">No realtors match your search.</p>)}
    {loadMore && <div className="filter-row"><Button variant="outline" size="sm" onClick={loadMore} disabled={busy}>Load more realtors</Button></div>}
  </section>;
}

const recordTitles: Record<RealtorRecordView, string> = { ...conversionMetrics, linked: "Referred loans", open: "Open referrals" };
export function RealtorRecords({ view, page, busy, error, openRecord, loadMore, close }: {
  view: RealtorRecordView; page?: RealtorRecordsPage; busy: boolean; error?: string; openRecord: (row: RealtorRecord) => void;
  loadMore?: () => void; close?: () => void;
}) {
  return <section className="pipeline" aria-label={recordTitles[view]} tabIndex={-1} id={close ? "partner-conversion-details" : "realtor-partner-records"}>
    <div className="pipeline-heading"><div><h3>{page?.partnerName && `${page.partnerName} · `}{recordTitles[view]}</h3>
      {page?.total != null && <p>{page.rows.length} of {page.total} records</p>}</div>
      {close && <Button size="sm" variant="outline" onClick={close}>Close conversion records</Button>}</div>
    {error && <p className="empty-inline" role="alert">{error}</p>}
    {!page && !error && <p className="empty-inline" role="status">Loading records…</p>}
    {!!page?.rows.length && <p className="relationship-inset muted report-scroll-hint">Scroll across for more loan details.</p>}
    {page && (page.rows.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label={`${recordTitles[view]} table`}><table className="data-table">
      <thead><tr><th scope="col">Borrower or prospect</th><th scope="col">Status</th><th scope="col">Loan officer</th>
        {view === "linked" ? <><th scope="col">Open tasks</th><th scope="col">Last activity</th></> :
          <><th scope="col">Submitted 1003</th><th scope="col">Funded</th></>}</tr></thead>
      <tbody>{page.rows.map((row) => <tr key={`${row.kind}:${row.id}`}><td>
        {row.kind === "loan" || row.archived || row.status !== "Closed without a linked loan" ?
          <button className="name-link" type="button" disabled={busy} onClick={() => openRecord(row)}>{row.name}</button> : row.name}
        {row.kind === "lead" && <small>Referred {dateTime(row.at)} ET</small>}</td>
        <td>{row.archived ? "Archived" : row.status}<small>{row.source}</small></td><td>{row.officer || "Shared inbox"}</td>
        {view === "linked" ? <><td>{row.openTasks}</td><td>{row.lastActivityAt ? `${dateTime(row.lastActivityAt)} ET` : "—"}</td></> :
          <><td>{row.submittedAt ? `${dateTime(row.submittedAt)} ET` : "—"}</td><td>{row.fundedOn ? dateLabel(row.fundedOn) : "—"}</td></>}
      </tr>)}</tbody>
    </table></div> : <p className="empty-inline no-matches">{view === "linked" ? "Link this realtor on a loan to see it here." :
      view === "open" ? "No open referrals for this realtor." : "No records match the current filters."}</p>)}
    {loadMore && <div className="filter-row"><Button variant="outline" size="sm" onClick={loadMore} disabled={busy}>Load more records</Button></div>}
  </section>;
}
