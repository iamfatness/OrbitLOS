"use client";

import { ArrowRight, BarChart3, Inbox, ListChecks, ShieldCheck, UsersRound } from "lucide-react";
import type { ActionCounts } from "./use-action-counts";
import { Button } from "./ui/button";
import { LicenseRenewalAttention, type LicenseRenewalVisit } from "./license-renewal-attention";
import { ReportScheduleAttentionPanel } from "./report-schedule-attention";

const queues = [
  { key: "exceptions", label: "File and delivery exceptions", action: "Open exceptions", icon: ShieldCheck },
  { key: "leads", label: "Leads needing first contact", action: "Open lead inbox", icon: Inbox },
  { key: "processing", label: "Incoming processing work", action: "Open processing work", icon: ListChecks },
] as const;
export type BrokerageQueue = (typeof queues)[number]["key"];
export const brokerageReports = ["Owner scorecard", "Funding dashboard", "Pipeline workload", "Sales conversion"] as const;
export type BrokerageReport = (typeof brokerageReports)[number];

function actionCount(count?: number) {
  return count === undefined ? "—" : count >= 100 ? "100+" : String(count);
}

export function BrokerageOverview({ brokerageId, counts, unavailable, busy, refresh, openQueue, openReport,
  openSchedule, scheduleReturn, openTeam, openCompliance, openRenewal, renewalReturn, openRegister, returnToRegisterAction }: {
  brokerageId: string; counts?: ActionCounts; unavailable: boolean; busy: boolean;
  refresh: () => void; openQueue: (queue: BrokerageQueue) => void; openReport: (report: BrokerageReport) => void;
  openSchedule: (reportId?: string) => void; scheduleReturn?: { reportId?: string };
  openRenewal?: (visit: LicenseRenewalVisit) => void; renewalReturn?: LicenseRenewalVisit;
  openRegister?: () => void; returnToRegisterAction?: boolean;
  openTeam: (panel: "Staff access" | "Branches" | "Loan settings" | "Workspaces") => void; openCompliance?: () => void;
}) {
  return <div className="brokerage-overview record-form">
    <section className="integration record-form" aria-labelledby="brokerage-attention-heading">
      <div className="section-heading">
        <h2 id="brokerage-attention-heading">Needs attention</h2>
        <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>Refresh counts</Button>
      </div>
      {unavailable ? <p className="muted" role="status">{counts ? "Showing the last available counts." : "Counts unavailable. The queues are still available."}</p> :
        !counts && <p className="muted" role="status">Checking team queues…</p>}
      <div className="brokerage-queue-grid">
        {queues.map(({ key, label, action, icon: Icon }) => <button key={key} className="brokerage-queue-card" disabled={busy}
          type="button" onClick={() => openQueue(key)} aria-label={`${action}${counts?.[key] === undefined ? "" : ` · ${actionCount(counts[key])} ${label.toLowerCase()}`}`}>
          <span className="brokerage-queue-label"><Icon size={18} aria-hidden="true" />{label}</span>
          <strong className="brokerage-queue-count">{actionCount(counts?.[key])}</strong>
          <span className="brokerage-queue-action">{action}<ArrowRight size={16} aria-hidden="true" /></span>
        </button>)}
      </div>
    </section>
    {openRenewal ? <LicenseRenewalAttention key={brokerageId} brokerageId={brokerageId} busy={busy} open={openRenewal}
      returning={renewalReturn} openRegister={openRegister} returnToRegisterAction={returnToRegisterAction} /> :
      <section className="integration record-form" aria-labelledby="brokerage-licensing-heading">
        <h2 id="brokerage-licensing-heading"><ShieldCheck size={19} aria-hidden="true" /> States &amp; licenses</h2>
        <p className="muted">Enable Compliance in workspace settings to record state licenses.</p>
        <div><Button size="sm" variant="outline" className="min-h-10 max-sm:min-h-11" disabled={busy} onClick={() => openTeam("Workspaces")}>
          Workspace settings<ArrowRight aria-hidden="true" /></Button></div>
      </section>}
    <ReportScheduleAttentionPanel key={brokerageId} brokerageId={brokerageId} busy={busy} open={openSchedule} returning={scheduleReturn} />
    <div className="brokerage-overview-links">
      <section className="integration record-form" aria-labelledby="brokerage-performance-heading">
        <h2 id="brokerage-performance-heading"><BarChart3 size={19} aria-hidden="true" /> Performance</h2>
        <ul className="brokerage-link-list">
          {brokerageReports.map((report) => <li key={report}><Button size="sm" variant="ghost" disabled={busy} onClick={() => openReport(report)}>
            {report}<ArrowRight size={16} aria-hidden="true" /></Button></li>)}
        </ul>
      </section>
      <section className="integration record-form" aria-labelledby="brokerage-setup-heading">
        <h2 id="brokerage-setup-heading"><UsersRound size={19} aria-hidden="true" /> Team and setup</h2>
        <ul className="brokerage-link-list">
          <li><Button size="sm" variant="ghost" disabled={busy} onClick={() => openTeam("Staff access")}>Staff access<ArrowRight size={16} aria-hidden="true" /></Button></li>
          <li><Button size="sm" variant="ghost" disabled={busy} onClick={() => openTeam("Branches")}>Branches<ArrowRight size={16} aria-hidden="true" /></Button></li>
          <li><Button size="sm" variant="ghost" disabled={busy} onClick={() => openTeam("Loan settings")}>Loan settings<ArrowRight size={16} aria-hidden="true" /></Button></li>
          {openCompliance && <li><Button size="sm" variant="ghost" disabled={busy} onClick={openCompliance}>Compliance overview<ArrowRight size={16} aria-hidden="true" /></Button></li>}
        </ul>
      </section>
    </div>
  </div>;
}
