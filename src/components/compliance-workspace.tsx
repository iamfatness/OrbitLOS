"use client";

import { useEffect, useRef, useState } from "react";
import { accessComplianceCases } from "@/app/actions";
import { complianceAttentionLabels, type ComplianceAttention } from "@/lib/compliance-case-model";
import type { LicenseRenewalTarget } from "@/lib/compliance-program-model";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import type { MigrationDestination } from "@/lib/migration-record-model";
import { observeTabReturn } from "@/lib/tab-return";
import { dateTime } from "@/lib/utils";
import { ComplianceInventory } from "./compliance-inventory";
import { ComplianceLeadBackfill } from "./compliance-lead-backfill";
import { ComplianceQueue } from "./compliance-queue";
import { LoanRetention } from "./loan-retention";
import { ComplianceProgram } from "./compliance-program";
import { ComplianceObligations } from "./compliance-obligations";
import { ComplianceLicensing } from "./compliance-licensing";
import { ComplianceLearning } from "./compliance-learning";
import { ComplianceResearch } from "./compliance-research";
import { Button } from "./ui/button";

type Overview = Extract<ComplianceCaseResult, { kind: "overview" }>;
type View = "Licensing" | "Training & policies" | "Obligations" | "Monthly review" | "Overview" | "Work queue" | "Coverage & gaps" | "Research & gaps" | "Loan retention";
const views: View[] = ["Overview", "Licensing", "Monthly review", "Obligations", "Training & policies", "Work queue", "Coverage & gaps", "Research & gaps", "Loan retention"];
const attentionActions: Record<ComplianceAttention, string> = {
  review: "View findings awaiting review",
  evidence: "View findings awaiting evidence",
  ownership: "View findings needing ownership review",
};

function findingsLabel(cases: number, files: number) {
  return `${cases} ${cases === 1 ? "finding" : "findings"} · ${files} ${files === 1 ? "file" : "files"}`;
}

function inventoryStatus(data: Overview) {
  const { state, scanned, asOf } = data.inventory;
  if (state === "Not started") return `Inventory not started · ${data.fileTotal} files in this pilot.`;
  if (state === "Stale") return "File data changed. Rebuild the inventory for current counts.";
  return `${scanned} of ${data.fileTotal} files inventoried${state === "Scanning" ? " · Scan in progress" : ""}${asOf ? ` · ${dateTime(asOf)} ET` : ""}`;
}

export function ComplianceWorkspace({ brokerageId, pilot, paused, openLoan, openHistoryRecord, licenseTarget, returnToRenewals, onLicenseSaved }: {
  brokerageId: string; pilot: boolean; paused: boolean; openLoan: (loanId: string, caseId?: string) => void;
  openHistoryRecord: (destination: MigrationDestination) => void;
  licenseTarget?: LicenseRenewalTarget; returnToRenewals?: () => void; onLicenseSaved?: () => void;
}) {
  const [view, setView] = useState<View>(pilot && !licenseTarget ? "Overview" : "Licensing");
  const [attention, setAttention] = useState<ComplianceAttention>();
  const [overview, setOverview] = useState<Overview | { error: string }>();
  const [revision, refresh] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const focusPanel = useRef(false);
  useEffect(() => {
    if (view !== "Overview" || paused) return;
    let active = true;
    let reading = false;
    async function read(isCurrent: () => boolean) {
      if (reading) return;
      reading = true;
      try {
        const result = await accessComplianceCases({ type: "overview" }, brokerageId);
        if (active && isCurrent() && ("error" in result || result.kind === "overview")) setOverview(result);
      } catch {
        if (active && isCurrent()) setOverview({ error: "Could not load the compliance overview. Try again." });
      } finally { reading = false; }
    }
    void read(() => true);
    const stop = observeTabReturn(document, window, (isCurrent) => void read(isCurrent));
    return () => { active = false; stop(); };
  }, [brokerageId, paused, revision, view]);
  useEffect(() => {
    if (focusPanel.current) {
      panel.current?.focus();
      focusPanel.current = false;
    }
  }, [view, attention]);

  function show(next: View, filter?: ComplianceAttention, focus = false) {
    if (next === view && filter === attention) return;
    focusPanel.current = focus;
    if (next === "Overview") setOverview(undefined);
    setAttention(filter);
    setView(next);
  }

  return <div className="record-form compliance-work">
    <div className="document-item compliance-coverage">
      <strong>Coverage not evaluated</strong>
      <p>{pilot ? "Fictional pilot for internal planning and evidence review. Regulatory coverage remains undetermined." :
        "Record licenses and use the research register and monthly review for internal planning. File-level evidence workflows are available in fictional pilots."}</p>
    </div>
    {returnToRenewals && <div><Button size="sm" variant="outline" disabled={paused} onClick={returnToRenewals}>Back to license renewals</Button></div>}
    <nav className="loan-application-actions" aria-label="Compliance views">
      {views.filter((option) => pilot || option === "Licensing" || option === "Research & gaps" || option === "Monthly review").map((option) => <Button key={option} size="sm" variant={view === option ? "default" : "outline"}
        aria-current={view === option ? "page" : undefined} onClick={() => show(option)}>{option}</Button>)}
    </nav>
    <section ref={panel} tabIndex={-1} aria-label={`Compliance ${view.toLowerCase()}`}>
      {view === "Licensing" && <ComplianceLicensing key={brokerageId} brokerageId={brokerageId} paused={paused} initialTarget={licenseTarget} onLicenseSaved={onLicenseSaved} />}
      {view === "Loan retention" && <LoanRetention brokerageId={brokerageId} paused={paused} openLoan={openLoan} />}
      {view === "Monthly review" && <ComplianceProgram key={brokerageId} brokerageId={brokerageId} paused={paused} />}
      {view === "Obligations" && <ComplianceObligations key={brokerageId} brokerageId={brokerageId} paused={paused} />}
      {view === "Training & policies" && <ComplianceLearning key={brokerageId} brokerageId={brokerageId} paused={paused} admin />}
      {view === "Research & gaps" && <ComplianceResearch key={brokerageId} brokerageId={brokerageId} paused={paused} />}
      {view === "Overview" && <div className="integration manager-panel record-form">
        <div className="section-heading">
          <h2>Brokerage overview</h2>
          <Button size="sm" variant="outline" disabled={paused} onClick={() => { setOverview(undefined); refresh((value) => value + 1); }}>
            Refresh overview</Button>
        </div>
        {!overview && <p role="status">Checking sample findings…</p>}
        {overview && ("error" in overview ? <p role="alert">{overview.error}</p> : <>
          <p className="muted">{findingsLabel(overview.findings.cases, overview.findings.files)} in the sample queue · Checked {dateTime(overview.checkedAt)} ET</p>
          <div className="compliance-overview-grid">
            {overview.attention.map(({ key, cases, files }) => <div key={key} className="document-item record-form">
              <strong>{complianceAttentionLabels[key]}</strong>
              <span>{findingsLabel(cases, files)}</span>
              <div><Button size="sm" variant="outline" aria-label={attentionActions[key]}
                onClick={() => show("Work queue", key, true)}>View findings</Button></div>
            </div>)}
          </div>
          <div className="document-item record-form">
            <strong>File inventory</strong>
            <p className="muted">{inventoryStatus(overview)}</p>
            <div><Button size="sm" variant="outline" onClick={() => show("Coverage & gaps", undefined, true)}>Open coverage &amp; gaps</Button></div>
          </div>
        </>)}
      </div>}
      {view === "Work queue" && <ComplianceQueue key={attention ?? "all"} brokerageId={brokerageId} admin initialAttention={attention}
        paused={paused} openLoan={openLoan} />}
      {view === "Coverage & gaps" && <div className="integration manager-panel record-form">
        <h2>Coverage &amp; gaps</h2>
        <div className="document-item record-form">
          <strong>Michigan conventional purchase · Disclosure receipt</strong>
          <p className="muted">Sample evidence for a mortgage brokerage. Use the inventory to find files with unknown scope, a missing sample package, or a missing sample review.</p>
          <p>Approved rule coverage is undetermined for every state, product, role and activity.</p>
        </div>
        <ComplianceInventory brokerageId={brokerageId} openLoan={openLoan} initiallyOpen />
        <ComplianceLeadBackfill brokerageId={brokerageId} openRecord={openHistoryRecord} />
      </div>}
    </section>
  </div>;
}
