"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LicenseRenewalTarget, ProgramReviewTarget, StateScopeTarget } from "@/lib/compliance-program-model";
import type { ObligationReviewBasis } from "@/lib/compliance-obligations-model";
import type { ReportingPeriod } from "@/lib/call-report-readiness-model";
import type { MigrationDestination } from "@/lib/migration-record-model";
import { ComplianceFilingArchive } from "./compliance-filing-archive";
import { CompliancePolicyFollowUp } from "./compliance-policy-follow-up";
import { ComplianceInventory } from "./compliance-inventory";
import { ComplianceLeadBackfill } from "./compliance-lead-backfill";
import { ComplianceQueue } from "./compliance-queue";
import { LoanRetention } from "./loan-retention";
import { ComplianceProgram } from "./compliance-program";
import { ComplianceObligations } from "./compliance-obligations";
import { ComplianceLicensing } from "./compliance-licensing";
import { ComplianceLearning } from "./compliance-learning";
import { ComplianceResearch } from "./compliance-research";
import { AdvertisingReview } from "./advertising-review";
import { Button } from "./ui/button";
import { ComplianceOwnerHome, type ComplianceSetupAction } from "./compliance-owner-home";

type View = "Home" | "Filing history" | "Policy acknowledgments" | "Licensing" | "Training & policies" | "Obligations" | "Monthly review" | "Work queue" | "Coverage & gaps" | "Research & gaps" | "Loan retention" | "Advertising review";
const areas: { label: string; links: { view: View; label: string; pilot?: boolean }[] }[] = [
  { label: "Licenses & branches", links: [{ view: "Licensing", label: "License register" }] },
  { label: "Calendar & filings", links: [{ view: "Monthly review", label: "Monthly review" }, { view: "Obligations", label: "Recurring work" }] },
  { label: "File reviews", links: [{ view: "Work queue", label: "File findings", pilot: true }, { view: "Coverage & gaps", label: "File inventory", pilot: true }] },
  { label: "Policies & evidence", links: [{ view: "Training & policies", label: "Training & policies" }, { view: "Loan retention", label: "Loan evidence & retention", pilot: true }, { view: "Advertising review", label: "Advertising evidence" }] },
  { label: "Research", links: [{ view: "Research & gaps", label: "Research & sources" }] },
];

export function ComplianceWorkspace({ brokerageId, pilot, paused, openLoan, openEvidence, openHistoryRecord, licenseTarget, returnToRenewals, returnToBrokerageLicenses,
  onLicenseSaved, openLicensing, branchId, onBranch, openBranches, returningFromBranches, openCallReport, renderReport }: {
  brokerageId: string; pilot: boolean; paused: boolean; openLoan: (loanId: string, caseId?: string) => void; openEvidence: (loanId: string) => void;
  openHistoryRecord: (destination: MigrationDestination) => void;
  licenseTarget?: LicenseRenewalTarget; returnToRenewals?: () => void; returnToBrokerageLicenses?: () => void; onLicenseSaved?: () => void; openLicensing?: boolean;
  branchId: string; onBranch: (id: string) => void; openBranches: () => void; returningFromBranches?: boolean; openCallReport: () => void;
  renderReport: (period: ReportingPeriod, setPeriod: (period: ReportingPeriod) => void) => ReactNode;
}) {
  const [view, setView] = useState<View>(licenseTarget || openLicensing ? "Licensing" : "Home");
  const [localLicense, setLocalLicense] = useState<LicenseRenewalTarget>();
  const [review, setReview] = useState<ProgramReviewTarget>();
  const [obligationVisit, setObligationVisit] = useState<{ itemId: string; returning: boolean }>();
  const [scopeVisit, setScopeVisit] = useState<string>();
  const [stateTarget, setStateTarget] = useState<StateScopeTarget>();
  const [stateOffset, setStateOffset] = useState(0);
  const [report, setReport] = useState<{ basis: ObligationReviewBasis; entity: string; period: ReportingPeriod }>();
  const reportOpen = !!report;
  const reportHeading = useRef<HTMLHeadingElement>(null);
  const returningFromReport = useRef(false);
  const [setup, setSetup] = useState<ComplianceSetupAction>();
  const [returningTo, setReturningTo] = useState(returningFromBranches ? "compliance-setup-branches" : undefined);
  const panel = useRef<HTMLElement>(null);
  const focusPanel = useRef(false);

  useEffect(() => {
    if (focusPanel.current) {
      if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
      focusPanel.current = false;
    }
  }, [view]);

  useEffect(() => {
    if (reportOpen) reportHeading.current?.focus();
    else if (returningFromReport.current) {
      document.getElementById("compliance-open-report-prep")?.focus();
      returningFromReport.current = false;
    }
  }, [reportOpen]);

  function show(next: View, origin?: string) {
    if (next === view) return;
    if (next === "Home") {
      setObligationVisit(undefined);
      setScopeVisit(undefined);
      setStateTarget(undefined);
    }
    focusPanel.current = next !== "Home" || !returningTo;
    if (next !== "Home") setReturningTo(origin);
    setView(next);
  }

  function showArea(next: View, origin?: string) {
    setSetup(undefined);
    setLocalLicense(undefined);
    setReview(undefined);
    show(next, origin);
  }

  function openSetup(step: ComplianceSetupAction, createCompany = false) {
    if (step === "branches") {
      openBranches();
      return;
    }
    setSetup(step === "company" && !createCompany ? undefined : step);
    setLocalLicense(undefined);
    setReview(undefined);
    show(step === "states" ? "Research & gaps" : "Licensing", `compliance-setup-${step}`);
  }

  return <div className="record-form compliance-work">
    {returnToBrokerageLicenses && <div><Button size="sm" variant="outline" className="min-h-10 max-sm:min-h-11"
      disabled={paused} onClick={returnToBrokerageLicenses}>Back to States &amp; licenses</Button></div>}
    {returnToRenewals && <div><Button size="sm" variant="outline" disabled={paused} onClick={returnToRenewals}>Back to license renewals</Button></div>}
    {view !== "Home" && !report && !(view === "Licensing" && returnToRenewals) && <div><Button size="sm" variant="outline" disabled={paused} onClick={() => show("Home")}>Back to Compliance home</Button></div>}
    {report && <section className="record-form" aria-label="Reporting from Compliance">
      <div><Button size="sm" variant="outline" onClick={() => { returningFromReport.current = true; setReport(undefined); }}>Back to review item</Button></div>
      <div className="integration manager-panel record-form">
        <h2 ref={reportHeading} tabIndex={-1}>{report.entity} · Recorded Q{report.basis.report?.quarter} {report.basis.report?.year}</h2>
        <p className="muted">Obligation version {report.basis.version}{report.basis.stateBasis ? ` · ${report.basis.stateBasis.jurisdiction} scope version ${report.basis.stateBasis.revision}` : ""}. Report totals and saved reviews cover the brokerage.</p>
      </div>
      {renderReport(report.period, period => setReport({ ...report, period }))}
    </section>}
    <section ref={panel} tabIndex={-1} hidden={!!report} aria-label={`Compliance ${view.toLowerCase()}`}>
      {view === "Home" && <ComplianceOwnerHome brokerageId={brokerageId} paused={paused} branchId={branchId} onBranch={onBranch} returningTo={returningTo}
        stateOffset={stateOffset} onStatePage={setStateOffset} openState={(target, origin) => { setStateTarget(target); showArea("Research & gaps", origin); }}
        onSetup={openSetup} openArea={showArea} openFinding={openLoan}
        openFilingArchive={() => showArea("Filing history", "compliance-filing-history")}
        openPolicyFollowUp={() => showArea("Policy acknowledgments", "compliance-policy-follow-up")}
        openRecurringWork={() => showArea("Obligations", "compliance-recurring-work")}
        openLicense={target => { setSetup(undefined); setLocalLicense(target); show("Licensing", `compliance-renewal-${target.licenseId}`); }}
        openReview={target => { setReview(target); show("Monthly review", `compliance-review-${target.itemId}`); }} />}
      {view === "Licensing" && <ComplianceLicensing key={brokerageId} brokerageId={brokerageId} paused={paused}
        initialTarget={localLicense ?? licenseTarget} setupEntity={setup === "company"} onLicenseSaved={onLicenseSaved}
        returnFromRenewal={returnToRenewals ?? (() => show("Home"))} />}
      {view === "Policy acknowledgments" && <CompliancePolicyFollowUp brokerageId={brokerageId} paused={paused} />}
      {view === "Filing history" && <ComplianceFilingArchive brokerageId={brokerageId} paused={paused} />}
      {view === "Loan retention" && <LoanRetention brokerageId={brokerageId} paused={paused} openLoan={openLoan} openEvidence={openEvidence} />}
      {view === "Monthly review" && <>
        {scopeVisit && <Button size="sm" variant="outline" className="mb-3 min-h-11" onClick={() => {
          setView("Research & gaps");
          requestAnimationFrame(() => document.getElementById(scopeVisit)?.focus());
        }}>Back to state review questions</Button>}
        {obligationVisit && <Button size="sm" variant="outline" className="mb-3" onClick={() => {
          setObligationVisit({ ...obligationVisit, returning: true });
          setView("Obligations");
        }}>Back to recorded periods</Button>}
        <ComplianceProgram key={brokerageId} brokerageId={brokerageId} paused={paused} target={review}
          openReport={(basis, entity) => { if (basis.report) setReport({ basis, entity, period: basis.report }); }} />
      </>}
      {(view === "Obligations" || obligationVisit) && <div hidden={view !== "Obligations"}>
        <ComplianceObligations key={brokerageId} brokerageId={brokerageId} paused={paused} returnToItem={obligationVisit?.returning ? obligationVisit.itemId : undefined}
          openReview={target => {
            setReview(target);
            setObligationVisit({ itemId: target.itemId, returning: false });
            focusPanel.current = true;
            setView("Monthly review");
          }} />
      </div>}
      {view === "Training & policies" && <ComplianceLearning key={brokerageId} brokerageId={brokerageId} paused={paused} admin />}
      {(view === "Research & gaps" || scopeVisit) && <div hidden={view !== "Research & gaps"}>
        <ComplianceResearch key={brokerageId} brokerageId={brokerageId} paused={paused} startWithState={setup === "states" || !!stateTarget}
          stateTarget={stateTarget}
          active={view === "Research & gaps"} openReview={(target, origin) => {
            setScopeVisit(origin);
            setReview(target);
            focusPanel.current = true;
            setView("Monthly review");
          }} />
      </div>}
      {view === "Advertising review" && <AdvertisingReview key={brokerageId} brokerageId={brokerageId} paused={paused}
        openMonthlyReview={() => show("Monthly review")} />}
      {view === "Work queue" && <ComplianceQueue brokerageId={brokerageId} admin paused={paused} openLoan={openLoan} />}
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
    {view === "Home" && <details className="integration manager-panel compliance-home-disclosure compliance-home-tools">
      <summary>Compliance tools</summary>
      <nav aria-label="Compliance tools">
        {areas.map(({ label, links }) => {
          const available = links.filter(link => !link.pilot || pilot);
          if (!available.length) return null;
          return <div key={label}>
            <h3>{label}</h3>
            <div className="loan-application-actions">
              {available.map(link => <Button key={link.view} size="sm" variant="outline" onClick={() => showArea(link.view, `compliance-tool-${link.view.replaceAll(" ", "-")}`)}
                id={`compliance-tool-${link.view.replaceAll(" ", "-")}`}>{link.label}</Button>)}
              {label === "Licenses & branches" && <Button size="sm" variant="outline" onClick={openBranches}>Branches</Button>}
              {label === "Calendar & filings" && <Button size="sm" variant="outline" onClick={openCallReport}>Mortgage Call Report</Button>}
            </div>
          </div>;
        })}
      </nav>
      <p className="muted">{pilot ? "File reviews and evidence use fictional records." : "Sample loan findings and retention tools are available in fictional pilots."}</p>
    </details>}
  </div>;
}
