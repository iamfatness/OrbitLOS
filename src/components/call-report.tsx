"use client";

import { useState } from "react";
import { callReportAmount, callReportCsv, callReportGroups, callReportFacts, exclusionReasons, quarterRange, quarterlyCallReport, reportOutcomes, reportStates,
  type CallReportFile } from "@/lib/call-report-model";
import { easternDate } from "@/lib/client-retention";
import { money } from "@/lib/utils";
import { Button } from "./ui/button";
import { downloadSampleFile } from "./sample-download";
import type { Workspace } from "@/lib/model";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import { callReportFactsTarget, type ReportingPeriod } from "@/lib/call-report-readiness-model";
import { ReconciledCallReportExport, ReportingPeriodFields } from "./call-report-readiness";
import { CallReportQuarterReview } from "./call-report-quarter";

type Save = (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;

export function CallReportWorkbench({ state, brokerageId, period, setPeriod, openLoan, openReadiness }: {
  state: Workspace; brokerageId: string; period: ReportingPeriod; setPeriod: (period: ReportingPeriod) => void;
  openLoan: (loanId: string) => void; openReadiness: () => void;
}) {
  const [today] = useState(() => easternDate());
  const currentYear = Number(today.slice(0, 4));
  const { year, quarter } = period;
  const [propertyState, setPropertyState] = useState("");
  const [originator, setOriginator] = useState("");
  const [group, setGroup] = useState<(typeof callReportGroups)[number]>("Needs review");
  const validYear = /^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= currentYear;
  const range = quarterRange(validYear ? Number(year) : currentYear, quarter);
  const files = state.callReportFiles ?? [];
  const rows = quarterlyCallReport(files, range);
  const filtered = rows.filter(({ file }) =>
    (!propertyState || (file.facts.state || "unconfirmed") === propertyState)
    && (!originator || (file.facts.originator || "unconfirmed") === originator));
  const selected = filtered.filter((row) => row.groups.includes(group));
  const loans = new Map(state.loans.map((loan) => [loan.id, loan]));
  const names = new Map(state.contacts.map((contact) => [contact.id, contact.name]));
  const states = [...new Set(rows.map(({ file }) => file.facts.state).filter(Boolean))].sort();
  const originators = [...new Set(rows.map(({ file }) => file.facts.originator).filter(Boolean))].sort();
  const changePeriod = (value: ReportingPeriod) => { setPeriod(value); setPropertyState(""); setOriginator(""); };

  return <section className="integration record-form manager-panel" aria-label="Mortgage Call Report preparation">
    <div><h2>Mortgage Call Report prep</h2><p>Reconcile quarterly application activity for a wholesale broker and open the files behind the totals.</p></div>
    <p className="muted">Confirm each file’s reporting eligibility and facts. Beginning and ending pipeline amounts use the confirmed application amount at intake. Outcomes use their separately confirmed amounts. It covers selected residential mortgage activity and leaves net amount adjustments, fee and financial data, and filing to separate review.</p>
    <div className="form-grid">
      <ReportingPeriodFields period={period} maxYear={String(currentYear)} change={changePeriod} />
      <label className="field">Property state filter<select value={propertyState} onChange={(event) => setPropertyState(event.target.value)}>
        <option value="">All states</option><option value="unconfirmed">Unconfirmed state</option>
        {states.map((code) => <option key={code}>{code}</option>)}</select></label>
      <label className="field">Originator filter<select value={originator} onChange={(event) => setOriginator(event.target.value)}>
        <option value="">All originators</option><option value="unconfirmed">Unconfirmed originator</option>
        {originators.map((id) => <option key={id}>{id}</option>)}</select></label>
    </div>
    {!validYear ? <p role="alert">Enter a four-digit reporting year through {currentYear}.</p> : <>
      <div className="loan-application-actions">
        <span className="pill">{range.from} through {range.through}</span>
        <Button variant="outline" size="sm" disabled={!filtered.length} onClick={() =>
          downloadSampleFile(callReportCsv(filtered, range.from, range.through), `orbit-call-report-review-${year}-Q${quarter}.csv`, "text/csv")
        }>Download draft review CSV</Button>
      </div>
      <ReconciledCallReportExport key={`${year}:${quarter}`} brokerageId={brokerageId} period={period} openReadiness={openReadiness} />
      <CallReportQuarterReview key={`quarter:${year}:${quarter}`} brokerageId={brokerageId} period={period} openLoan={openLoan}
        openReadiness={openReadiness} openPrior={changePeriod} version={state} />
      <div className="loan-application-actions">
        {callReportGroups.map((label) => {
          const items = filtered.filter((item) => item.groups.includes(label));
          return <Button key={label} size="sm" variant={group === label ? "default" : "outline"} aria-pressed={group === label} onClick={() => setGroup(label)}>
            {label} · {items.length}{items.length > 0 && label !== "Needs review" && label !== "Excluded" &&
              ` · ${money(items.reduce((total, row) => total + callReportAmount(row, label), 0))}`}
          </Button>;
        })}
      </div>
      <div className="work-queue">
        <h3>{group} · {selected.length} files</h3>
        {selected.length === 0 ? <p className="muted">No files match these filters.</p> : <ul className="loan-task-list">{selected.map((row) => {
          const loan = loans.get(row.file.loanId);
          const { facts } = row.file;
          return <li className="loan-task" key={row.file.loanId}>
            <div className="loan-task-copy">
              <strong>{loan ? names.get(loan.contactId) ?? "Loan record" : "Loan record"}</strong>
              <span>{loan?.officer || "Unassigned"} · {facts.state || "State to review"} · {row.file.stage}</span>
              {row.issues.length > 0 ? <span>{row.issues.join(" · ")}</span> : facts.exclusionReason ? <span>{facts.exclusionReason}</span> :
                <span>{[facts.receivedDate && `Received ${facts.receivedDate}`, facts.outcomeDate && `Outcome ${facts.outcomeDate}`].filter(Boolean).join(" · ")}</span>}
            </div>
            <Button size="sm" variant="outline" onClick={() => openLoan(row.file.loanId)}>Review loan</Button>
          </li>;
        })}</ul>}
      </div>
    </>}
  </section>;
}

export function CallReportLoanFacts({ file, busy, save }: { file: CallReportFile; busy: boolean; save: Save }) {
  const [facts, setFacts] = useState(file.facts);
  const checked = callReportFacts.safeParse(facts);
  const updateAmount = (value: string) => value === "" ? null : Number(value);
  return <section className="details-section" id={callReportFactsTarget} aria-label="Call report facts" tabIndex={-1}>
    <h3>Call report facts</h3>
    <p className="muted">Confirm the first received date and amount, property state, and reportable outcome. Orbit keeps these separate from pipeline status.</p>
    <p className="muted">Orbit records · First 1003 {file.suggested.receivedDate || "—"} · Funding {file.suggested.fundingDate || "—"} · Current loan amount {money(file.suggested.currentAmount)}</p>
    <form className="record-form" onSubmit={(event) => {
      event.preventDefault();
      if (checked.success) void save({ type: "saveCallReport", loanId: file.loanId, revision: file.revision, facts: checked.data });
    }}>
      {file.suggested.receivedDate && <div><Button size="sm" variant="outline" disabled={busy} onClick={() => setFacts({
        ...facts, receivedDate: facts.receivedDate || file.suggested.receivedDate,
        receivedAmount: facts.receivedAmount ?? file.suggested.receivedAmount,
        state: facts.state || (reportStates.includes(file.suggested.state) ? file.suggested.state : ""),
      })}>Use first 1003 as a starting point</Button></div>}
      {facts.outcome === "Closed and funded" && file.suggested.fundingDate && facts.outcomeDate !== file.suggested.fundingDate &&
        <div><Button size="sm" variant="outline" disabled={busy} onClick={() => setFacts({ ...facts, outcomeDate: file.suggested.fundingDate })}>
          Use recorded funding date
        </Button></div>}
      <div className="form-grid">
        <label className="field">Reporting eligibility<select value={facts.eligibility} onChange={(event) => {
          const eligibility = event.target.value as typeof facts.eligibility;
          setFacts({ ...facts, eligibility, exclusionReason: eligibility === "Exclude" ? facts.exclusionReason : "" });
        }}>
          <option value="Review">Needs review</option><option value="Include">Include</option><option value="Exclude">Exclude</option>
        </select></label>
        {facts.eligibility === "Exclude" && <label className="field">Exclusion reason<select value={facts.exclusionReason}
          onChange={(event) => setFacts({ ...facts, exclusionReason: event.target.value as typeof facts.exclusionReason })}>
          <option value="">Choose reason</option>{exclusionReasons.map((reason) => <option key={reason}>{reason}</option>)}
        </select></label>}
        <label className="field">Property state<select value={facts.state} onChange={(event) => setFacts({ ...facts, state: event.target.value })}>
          <option value="">Choose state</option>{reportStates.map((code) => <option key={code}>{code}</option>)}
        </select></label>
        <label className="field">Originator NMLS ID<input inputMode="numeric" maxLength={15} value={facts.originator}
          onChange={(event) => setFacts({ ...facts, originator: event.target.value })} /></label>
        <label className="field">Application received date<input type="date" value={facts.receivedDate}
          onChange={(event) => setFacts({ ...facts, receivedDate: event.target.value })} /></label>
        <label className="field">Application amount<input type="number" min={0} max={1_000_000_000} step={1} value={facts.receivedAmount ?? ""}
          onChange={(event) => setFacts({ ...facts, receivedAmount: updateAmount(event.target.value) })} /></label>
        <label className="field">Reporting outcome<select value={facts.outcome} onChange={(event) => {
          const outcome = event.target.value as typeof facts.outcome;
          setFacts({ ...facts, outcome, outcomeDate: outcome === "Closed and funded" ? file.suggested.fundingDate : "",
            outcomeAmount: null });
        }}><option value="">Still in process or unconfirmed</option>{reportOutcomes.map((outcome) => <option key={outcome}>{outcome}</option>)}</select></label>
        {facts.outcome && <>
          <label className="field">Reporting outcome date<input type="date" value={facts.outcomeDate}
            onChange={(event) => setFacts({ ...facts, outcomeDate: event.target.value })} /></label>
          <label className="field">Reporting outcome amount<input type="number" min={0} max={1_000_000_000} step={1} value={facts.outcomeAmount ?? ""}
            onChange={(event) => setFacts({ ...facts, outcomeAmount: updateAmount(event.target.value) })} /></label>
        </>}
      </div>
      {!checked.success && <p role="alert" className="application-error">{checked.error.issues[0]?.message}</p>}
      <div><Button size="sm" type="submit" disabled={busy || !checked.success || JSON.stringify(facts) === JSON.stringify(file.facts)}>Save call report facts</Button></div>
    </form>
  </section>;
}
