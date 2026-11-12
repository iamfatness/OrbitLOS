"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import type { LicenseRenewalTarget, ProgramReviewTarget } from "@/lib/compliance-program-model";
import { propertyStateName } from "@/lib/property-state";
import { observeTabReturn } from "@/lib/tab-return";
import { Button } from "./ui/button";

type Home = Extract<ComplianceCaseResult, { kind: "ownerHome" }>;
export type ComplianceSetupAction = "company" | "branches" | "licenses" | "states";
type WorkArea = "Licensing" | "Monthly review" | "Work queue";
const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const displayDate = (value: string) => date.format(new Date(value));

function WorkRow({ title, children, action, onOpen, id }: {
  title: string; children: ReactNode; action: string; onOpen: () => void; id: string;
}) {
  return <li className="compliance-home-row">
    <div><strong>{title}</strong>{children}</div>
    <Button id={id} size="sm" variant="outline" aria-label={`${action}: ${title}`} onClick={onOpen}>{action}</Button>
  </li>;
}

export function ComplianceOwnerHome({ brokerageId, paused, branchId, onBranch, returningTo, onSetup, openLicense, openReview, openFinding, openArea, openFilingArchive, openPolicyFollowUp }: {
  brokerageId: string; paused: boolean; branchId: string; onBranch: (id: string) => void; returningTo?: string;
  onSetup: (step: ComplianceSetupAction, createCompany?: boolean) => void; openLicense: (target: LicenseRenewalTarget) => void;
  openReview: (target: ProgramReviewTarget) => void; openFinding: (loanId: string, caseId: string) => void; openArea: (area: WorkArea) => void; openFilingArchive?: () => void; openPolicyFollowUp?: () => void;
}) {
  const [response, setResponse] = useState<{ branch: string; data: Home | { error: string } }>();
  const [revision, refresh] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusReturn = useRef(returningTo);
  const retryFocus = useRef<HTMLButtonElement>(null);
  const result = response?.branch === branchId ? response.data : undefined;
  const home = result && "kind" in result ? result : undefined;
  const branch = home?.branches.find(item => item.id === home.branchId);

  useEffect(() => {
    if (paused) return;
    let active = true;
    let reading = false;
    async function read(isCurrent: () => boolean) {
      if (reading) return;
      reading = true;
      try {
        const data = await accessComplianceCases({ type: "program", input: { operation: "ownerHome", branchId: branchId || undefined } }, brokerageId);
        if (active && isCurrent() && ("error" in data || data.kind === "ownerHome")) setResponse({ branch: branchId, data });
      } catch {
        if (active && isCurrent()) setResponse({ branch: branchId, data: { error: "Could not load Compliance work." } });
      } finally { reading = false; }
    }
    void read(() => true);
    const stop = observeTabReturn(document, window, isCurrent => void read(isCurrent));
    return () => { active = false; stop(); };
  }, [brokerageId, branchId, paused, revision]);

  useEffect(() => {
    const target = focusReturn.current;
    if (!target || !result || paused) return;
    const button = document.getElementById(target);
    if (button instanceof HTMLElement) {
      const details = button.closest("details");
      if (details) details.open = true;
      button.focus();
    } else (heading.current ?? retryFocus.current)?.focus();
    focusReturn.current = undefined;
  }, [result, paused]);

  const branches = home?.branches ?? (response && "kind" in response.data ? response.data.branches : []);
  const renewalTotal = home?.renewals.total ?? 0;
  const reviewTotal = home?.reviews.total ?? 0;
  const findingTotal = home?.fileFindings?.total ?? 0;
  const hasWork = renewalTotal + reviewTotal + findingTotal > 0;
  const activeBranches = home?.branches.filter(item => item.active) ?? [];
  const missingBranchRecords = branch ? Number(branch.active && !branch.licenseCount) : activeBranches.filter(item => !item.licenseCount).length;
  const steps: { id: ComplianceSetupAction; name: string; status: string; action: string; ready: boolean; enabled: boolean }[] = home ? [
    { id: "company", name: "Company profile", status: home.entityCount ? `${home.entityCount} on file` : "Add the legal name of your brokerage.",
      action: home.entityCount ? "View company profiles" : "Add company profile", ready: home.entityCount > 0, enabled: true },
    { id: "branches", name: "Offices and staff", status: activeBranches.length ? `${activeBranches.length} active ${activeBranches.length === 1 ? "branch" : "branches"}` : "Record the offices you manage and the staff assigned to each.",
      action: "Manage branches", ready: activeBranches.length > 0, enabled: true },
    { id: "licenses", name: "License records", status: !home.companyLicenseCount ? "No company licenses on file." :
      missingBranchRecords ? `${missingBranchRecords} ${missingBranchRecords === 1 ? "active branch has" : "active branches have"} no license record on file.` : `${home.companyLicenseCount} company license ${home.companyLicenseCount === 1 ? "record" : "records"} on file.`,
      action: "Open license register", ready: home.companyLicenseCount > 0 && !missingBranchRecords, enabled: home.entityCount > 0 },
    { id: "states", name: "States and activities", status: home.savedStateCount ? `${home.savedStateCount} ${home.savedStateCount === 1 ? "state has" : "states have"} saved business facts.` : "Record where and how your company operates for review.",
      action: "Review states and activities", ready: home.savedStateCount > 0, enabled: home.entityCount > 0 },
  ] : [];
  const next = steps.find(step => !step.ready && step.enabled);
  const showSetupFirst = !!next && !hasWork;
  const setup = home && <div className="compliance-home-setup">
    {showSetupFirst && <h2>Set up Compliance</h2>}
    {showSetupFirst && next && <div className="compliance-home-next">
      <p>{next.status}</p><Button id={`compliance-setup-${next.id}`} size="sm" onClick={() => onSetup(next.id, !home.entityCount)}>{next.action}</Button>
    </div>}
    <details className="compliance-home-disclosure">
      <summary>{showSetupFirst ? "All setup steps" : "Compliance setup"}{next && !showSetupFirst ? ` · Next step is ${next.name.toLowerCase()}` : ""}</summary>
      <ul className="compliance-home-list">
        {steps.filter(step => !showSetupFirst || step.id !== next?.id).map(step => <li className="compliance-home-row" key={step.id}>
          <div><strong>{step.name}</strong><p className="muted">{step.enabled ? step.status : "Add a company profile first."}</p></div>
          {step.enabled && <Button id={`compliance-setup-${step.id}`} size="sm" variant="outline" onClick={() => onSetup(step.id, !home.entityCount)}>{step.action}</Button>}
        </li>)}
      </ul>
      <p className="muted">These are recorded business facts. Confirm applicable requirements with your reviewer.</p>
    </details>
  </div>;

  return <div className="integration manager-panel compliance-home">
    {branches.length > 0 && <label className="field compliance-home-branch">Branch<select value={branchId} disabled={paused}
      onChange={event => onBranch(event.target.value)}>
      <option value="">All branches</option>
      {branchId && !branches.some(item => item.id === branchId) && <option value={branchId}>Unavailable branch</option>}
      {branches.map(item => <option key={item.id} value={item.id}>{item.name}{item.active ? "" : " (Archived)"}</option>)}
    </select></label>}
    {branch && <p className="compliance-home-context"><strong>{branch.name}{branch.active ? "" : " · Archived"}</strong><span className="muted">License renewals are filtered to this branch. Review work stays visible for the whole brokerage.</span></p>}
    {home && branchId && !branch && <p role="status">The selected branch is unavailable. Showing all branches.</p>}
    {!result && <p role="status">{paused ? "Compliance work is unavailable while the workspace is paused." : "Loading Compliance work…"}</p>}
    {result && "error" in result && <div className="compliance-home-next">
      <p role="alert">{result.error}</p><Button ref={retryFocus} size="sm" variant="outline" disabled={paused} onClick={() => {
        focusReturn.current = "compliance-attention-heading";
        setResponse(undefined);
        refresh(value => value + 1);
      }}>Retry Compliance</Button>
    </div>}
    {showSetupFirst && setup}
    {home && <section className="compliance-home-attention" aria-labelledby="compliance-attention-heading">
      <div className="section-heading">
        <h2 id="compliance-attention-heading" ref={heading} tabIndex={-1}>Needs attention</h2>
        {openFilingArchive && <Button id="compliance-filing-history" size="sm" variant="outline" onClick={openFilingArchive}>Filing history</Button>}
      </div>
      {openPolicyFollowUp && <div><Button id="compliance-policy-follow-up" size="sm" variant="outline" onClick={openPolicyFollowUp}>Policy acknowledgments</Button></div>}
      {!hasWork && <p className="muted">No recorded renewals or review work due through {displayDate(home.through)}{home.fileFindings ? ", and no sample file findings" : ""}.</p>}
      {renewalTotal > 0 && <section aria-label="License renewals">
        <h3>License renewals</h3>
        <ul className="compliance-home-list">{home.renewals.items.map(item => {
          const holder = home.branches.find(entry => entry.id === item.branchId);
          const title = `${propertyStateName(item.jurisdiction)} · ${holder?.name ?? item.holderLabel}`;
          return <WorkRow key={item.licenseId} id={`compliance-renewal-${item.licenseId}`} title={title} action="Review license" onOpen={() => openLicense(item)}>
            <p>{item.renewal === "Past expiration" ? "Expired" : "Expires"} {displayDate(item.expiresOn)} · {item.renewalOwner?.available ? item.renewalOwner.name : item.renewalOwner ? "Owner needs review" : "Unassigned"}</p>
            <p className="muted">{item.entityName} · {item.licenseType} · {item.licenseNumber}</p>
          </WorkRow>;
        })}</ul>
        {renewalTotal > home.renewals.items.length && <Button size="sm" variant="outline" onClick={() => openArea("Licensing")}>Open license register ({renewalTotal} renewals)</Button>}
      </section>}
      {reviewTotal > 0 && <section aria-label="Internal review work">
        <h3>{branch ? "Brokerage-wide review work" : "Internal review work"}</h3>
        <ul className="compliance-home-list">{home.reviews.items.map(item => <WorkRow key={item.id} id={`compliance-review-${item.id}`} title={item.title}
          action="Open review" onOpen={() => openReview({ entityId: item.entityId, month: item.month, itemId: item.id })}>
          <p>{item.internalTarget < home.asOf ? "Past internal target" : "Internal target"} · {displayDate(item.internalTarget)} · {item.ownerName ?? "Owner needs review"}</p>
          <p className="muted">{item.entityName} · {item.status}</p>
        </WorkRow>)}</ul>
        {reviewTotal > home.reviews.items.length && <Button size="sm" variant="outline" onClick={() => openArea("Monthly review")}>Open monthly review ({reviewTotal} open items)</Button>}
      </section>}
      {home.fileFindings && findingTotal > 0 && <section aria-label="Sample file findings">
        <h3>{branch ? "Brokerage-wide sample file findings" : "Sample file findings"}</h3>
        <ul className="compliance-home-list">{home.fileFindings.items.map(item => <WorkRow key={item.id} id={`compliance-finding-${item.id}`} title={item.title}
          action="Open finding" onOpen={() => openFinding(item.loanId, item.id)}>
          <p>{item.borrower} · {item.status} · {item.ownerName ?? "Owner needs review"}</p>
        </WorkRow>)}</ul>
        {findingTotal > home.fileFindings.items.length && <Button size="sm" variant="outline" onClick={() => openArea("Work queue")}>Open work queue ({findingTotal} findings)</Button>}
      </section>}
    </section>}
    {!showSetupFirst && setup}
  </div>;
}
