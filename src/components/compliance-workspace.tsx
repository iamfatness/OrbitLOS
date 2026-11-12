"use client";

import { useEffect, useRef, useState } from "react";
import type { LicenseRenewalTarget, ProgramReviewTarget } from "@/lib/compliance-program-model";
import type { MigrationDestination } from "@/lib/migration-record-model";
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
import { ComplianceOwnerHome, type ComplianceSetupAction } from "./compliance-owner-home";

type View = "Home" | "Licensing" | "Training & policies" | "Obligations" | "Monthly review" | "Work queue" | "Coverage & gaps" | "Research & gaps" | "Loan retention";
const areas: { label: string; links: { view: View; label: string; pilot?: boolean }[] }[] = [
  { label: "Licenses & branches", links: [{ view: "Licensing", label: "License register" }] },
  { label: "Calendar & filings", links: [{ view: "Monthly review", label: "Monthly review" }, { view: "Obligations", label: "Recurring work", pilot: true }] },
  { label: "File reviews", links: [{ view: "Work queue", label: "File findings", pilot: true }, { view: "Coverage & gaps", label: "File inventory", pilot: true }] },
  { label: "Policies & evidence", links: [{ view: "Training & policies", label: "Training & policies", pilot: true }, { view: "Loan retention", label: "Loan retention", pilot: true }] },
  { label: "Research", links: [{ view: "Research & gaps", label: "Research & sources" }] },
];

export function ComplianceWorkspace({ brokerageId, pilot, paused, openLoan, openHistoryRecord, licenseTarget, returnToRenewals, returnToBrokerageLicenses,
  onLicenseSaved, openLicensing, branchId, onBranch, openBranches, returningFromBranches, openCallReport }: {
  brokerageId: string; pilot: boolean; paused: boolean; openLoan: (loanId: string, caseId?: string) => void;
  openHistoryRecord: (destination: MigrationDestination) => void;
  licenseTarget?: LicenseRenewalTarget; returnToRenewals?: () => void; returnToBrokerageLicenses?: () => void; onLicenseSaved?: () => void; openLicensing?: boolean;
  branchId: string; onBranch: (id: string) => void; openBranches: () => void; returningFromBranches?: boolean; openCallReport: () => void;
}) {
  const [view, setView] = useState<View>(licenseTarget || openLicensing ? "Licensing" : "Home");
  const [localLicense, setLocalLicense] = useState<LicenseRenewalTarget>();
  const [review, setReview] = useState<ProgramReviewTarget>();
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

  function show(next: View, origin?: string) {
    if (next === view) return;
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
    {view !== "Home" && <div><Button size="sm" variant="outline" disabled={paused} onClick={() => show("Home")}>Back to Compliance home</Button></div>}
    <section ref={panel} tabIndex={-1} aria-label={`Compliance ${view.toLowerCase()}`}>
      {view === "Home" && <ComplianceOwnerHome brokerageId={brokerageId} paused={paused} branchId={branchId} onBranch={onBranch} returningTo={returningTo}
        onSetup={openSetup} openArea={showArea} openFinding={openLoan}
        openLicense={target => { setSetup(undefined); setLocalLicense(target); show("Licensing", `compliance-renewal-${target.licenseId}`); }}
        openReview={target => { setReview(target); show("Monthly review", `compliance-review-${target.itemId}`); }} />}
      {view === "Licensing" && <ComplianceLicensing key={brokerageId} brokerageId={brokerageId} paused={paused}
        initialTarget={localLicense ?? licenseTarget} setupEntity={setup === "company"} setupBranch={setup === "licenses" ? branchId : undefined} onLicenseSaved={onLicenseSaved} />}
      {view === "Loan retention" && <LoanRetention brokerageId={brokerageId} paused={paused} openLoan={openLoan} />}
      {view === "Monthly review" && <ComplianceProgram key={brokerageId} brokerageId={brokerageId} paused={paused} target={review} />}
      {view === "Obligations" && <ComplianceObligations key={brokerageId} brokerageId={brokerageId} paused={paused} />}
      {view === "Training & policies" && <ComplianceLearning key={brokerageId} brokerageId={brokerageId} paused={paused} admin />}
      {view === "Research & gaps" && <ComplianceResearch key={brokerageId} brokerageId={brokerageId} paused={paused} startWithState={setup === "states"} />}
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
      {pilot && <p className="muted">File reviews and evidence use fictional records. Confirm applicable requirements with your reviewer.</p>}
    </details>}
  </div>;
}
