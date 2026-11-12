"use client";

import { useRef, useState } from "react";
import { accessComplianceCases } from "@/app/actions";
import { type LicenseRecordCounts, type LicenseRegisterScope, type LicenseStateCheck } from "@/lib/compliance-program-model";
import { propertyStateName } from "@/lib/property-state";
import { LicenseRecordStatus } from "./license-record-status";
import { LicenseRegisterDialog } from "./license-register-dialog";
import { PropertyStateOptions } from "./property-state-field";
import { Button } from "./ui/button";

export function LeadLicenseStateReview({ brokerageId, leadId, propertyState, officerEmail, busy, onLicenseSaved }: {
  brokerageId: string; leadId: string; propertyState: string; officerEmail: string | null;
  busy: boolean; onLicenseSaved?: () => void;
}) {
  const [jurisdiction, setJurisdiction] = useState(propertyState);
  const [outcome, setOutcome] = useState<{ scope: string; result?: LicenseStateCheck; error?: string }>();
  const [checking, setChecking] = useState(false);
  const [register, setRegister] = useState<LicenseRegisterScope>();
  const opener = useRef<HTMLButtonElement>(null);
  const checkButton = useRef<HTMLButtonElement>(null);
  const scope = JSON.stringify([jurisdiction, officerEmail]);
  const { result, error } = outcome?.scope === scope ? outcome : {};
  const assignment = result?.assignment;

  async function check(keepResult = false) {
    if (!jurisdiction || checking || busy) return;
    setChecking(true);
    if (!keepResult) setOutcome(undefined);
    const failure = { scope, result: keepResult ? result : undefined, error: "Could not check license records. Try again." };
    try {
      const response = await accessComplianceCases({ type: "program", input: {
        operation: "licenseStateCheck", jurisdiction, assignment: { leadId, officerEmail },
      } }, brokerageId);
      setOutcome("error" in response || response.kind !== "licenseStateCheck" ? failure : { scope, result: response });
    } catch { setOutcome(failure); }
    finally {
      setChecking(false);
      if (keepResult) {
        const hadFocus = document.activeElement === opener.current;
        requestAnimationFrame(() => {
          if (hadFocus && !opener.current?.isConnected && document.activeElement === document.body)
            checkButton.current?.focus({ preventScroll: true });
        });
      }
    }
  }

  function registerAction(entity: LicenseStateCheck["entities"][number], counts: LicenseRecordCounts,
    holder: LicenseRegisterScope["holder"], holderName: string, licenseId?: string) {
    if (!counts.current && !counts.expired && !counts.review) return null;
    const label = licenseId ? "Open license" : "View licenses";
    return <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy}
      aria-label={`${label} · ${entity.name} · ${holderName}`}
      onClick={event => {
        opener.current = event.currentTarget;
        setRegister({ entityId: entity.id, jurisdiction, holder, holderName, licenseId });
      }}>{label}</Button>;
  }

  function backToLead() {
    setRegister(undefined);
    requestAnimationFrame(() => {
      const button = opener.current?.isConnected ? opener.current : checkButton.current;
      button?.focus({ preventScroll: true });
    });
    void check(true);
  }

  return <details className="document-form license-state-review">
    <summary>Check state licenses</summary>
    <div className="record-form">
      <p className="muted">{propertyState
        ? `Saved property state is ${propertyStateName(propertyState)}. A different selection applies to this check only.`
        : "Choose a property state to review license records for this assignment."}</p>
      <form onSubmit={event => { event.preventDefault(); void check(); }}>
        <div className="loan-application-actions licensing-controls license-state-controls">
          <label className="field">Property state<select required value={jurisdiction} disabled={checking} onChange={event => {
            setJurisdiction(event.target.value);
            setOutcome(undefined);
          }}>
            <PropertyStateOptions />
          </select></label>
          <Button ref={checkButton} type="submit" size="sm" className="min-h-10" variant="outline" aria-disabled={checking || busy || !jurisdiction}>
            {checking ? "Checking…" : result ? "Refresh check" : "Check records"}
          </Button>
        </div>
      </form>
      {checking && <p className="muted" role="status">Checking license records…</p>}
      {error && <p role="alert">{error}</p>}
      {result && <section className="work-queue license-state-result record-form" aria-label="Assignment license records">
        <h4 className="font-semibold">{propertyStateName(result.jurisdiction)} license records</h4>
        <p className="sr-only" role="status">License check updated for {propertyStateName(result.jurisdiction)}.</p>
        {assignment?.officer?.name ? <p>Proposed owner · <strong>{assignment.officer.name}</strong></p> :
          assignment?.officer ? <p>The selected officer is unavailable. Refresh the workspace before assigning.</p> :
            <p>Shared inbox selected. Choose an owner to check their license records.</p>}
        {assignment?.intakeBranchWithoutLink && <p className="muted">Intake branch · {assignment.intakeBranchWithoutLink} has no managed branch link.</p>}
        {assignment?.officer?.name && !assignment.branches.length &&
          <p className="muted">No active branch assignments on file for this officer.</p>}
        {result.entities.length ? result.entities.map(entity => <div key={entity.id} className="license-state-entity">
          <h5 className="font-semibold">{entity.name}</h5>
          <ul>
            <li className="license-state-holder">
              <span>Company · <LicenseRecordStatus counts={entity.company} /></span>
              {registerAction(entity, entity.company, { kind: "Company" }, "Company", entity.singleRecords?.company)}
            </li>
            {entity.officer && officerEmail && <li className="license-state-holder">
              <span>Loan officer · <LicenseRecordStatus counts={entity.officer} /></span>
              {registerAction(entity, entity.officer, { kind: "Loan officer", id: officerEmail },
                assignment?.officer?.name ?? "Loan officer", entity.singleRecords?.officer)}
            </li>}
            {assignment?.branches.map(branch => {
              const counts = entity.branches?.find(item => item.id === branch.id)?.counts;
              return counts && <li key={branch.id} className="license-state-holder">
                <div>
                  Branch · <strong>{branch.name}</strong>{branch.atIntake && " · At intake"}{!branch.active && " · Archived"} · <LicenseRecordStatus counts={counts} />
                  {branch.atIntake && branch.active && branch.officerAssigned === false &&
                    <div className="muted">The proposed owner has no current assignment at this branch.</div>}
                </div>
                {registerAction(entity, counts, { kind: "Branch", id: branch.id }, branch.name, entity.singleRecords?.branches[branch.id])}
              </li>;
            })}
          </ul>
        </div>) : <p>No legal entities on file. Add one in Compliance → Licensing.</p>}
        <p className="muted">Staff-entered records for internal review. Verify authorization before originating.</p>
      </section>}
      {register && <LicenseRegisterDialog brokerageId={brokerageId} paused={busy} scope={register}
        onBack={backToLead} onLicenseSaved={onLicenseSaved} />}
    </div>
  </details>;
}
