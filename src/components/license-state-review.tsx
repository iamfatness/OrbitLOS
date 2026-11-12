"use client";

import { useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import { type LicenseRecordCounts, type LicenseStateCheck } from "@/lib/compliance-program-model";
import { propertyStateName } from "@/lib/property-state";
import { PropertyStateOptions } from "./property-state-field";
import { Button } from "./ui/button";

export function LicenseRecordStatus({ counts }: { counts: LicenseRecordCounts }) {
  const { current, expired, review } = counts;
  if (!current && !expired && !review) return <>No records on file</>;
  return <>{current ? `${current} current` : "No current records"}
    {expired > 0 && ` · ${expired} expired`}{review > 0 && ` · ${review} to review`}</>;
}

export function LeadLicenseStateReview({ brokerageId, leadId, propertyState, officerEmail }: {
  brokerageId: string; leadId: string; propertyState: string; officerEmail: string | null;
}) {
  const [jurisdiction, setJurisdiction] = useState(propertyState);
  const [outcome, setOutcome] = useState<{ scope: string; result?: LicenseStateCheck; error?: string }>();
  const [checking, setChecking] = useState(false);
  const scope = JSON.stringify([jurisdiction, officerEmail]);
  const { result, error } = outcome?.scope === scope ? outcome : {};
  const assignment = result?.assignment;

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jurisdiction || checking) return;
    setChecking(true);
    setOutcome(undefined);
    const failure = { scope, error: "Could not check license records. Try again." };
    try {
      const response = await accessComplianceCases({ type: "program", input: {
        operation: "licenseStateCheck", jurisdiction, assignment: { leadId, officerEmail },
      } }, brokerageId);
      setOutcome("error" in response || response.kind !== "licenseStateCheck" ? failure : { scope, result: response });
    } catch { setOutcome(failure); }
    finally { setChecking(false); }
  }

  return <details className="document-form license-state-review">
    <summary>Check state licenses</summary>
    <div className="record-form">
      <p className="muted">{propertyState
        ? `Saved property state is ${propertyStateName(propertyState)}. A different selection applies to this check only.`
        : "Choose a property state to review license records for this assignment."}</p>
      <form onSubmit={check}>
        <div className="loan-application-actions licensing-controls license-state-controls">
          <label className="field">Property state<select required value={jurisdiction} disabled={checking} onChange={event => {
            setJurisdiction(event.target.value);
            setOutcome(undefined);
          }}>
            <PropertyStateOptions />
          </select></label>
          <Button type="submit" size="sm" className="min-h-10" variant="outline" aria-disabled={checking || !jurisdiction}>
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
            <li>Company · <LicenseRecordStatus counts={entity.company} /></li>
            {entity.officer && <li>Loan officer · <LicenseRecordStatus counts={entity.officer} /></li>}
            {assignment?.branches.map(branch => {
              const counts = entity.branches?.find(item => item.id === branch.id)?.counts;
              return counts && <li key={branch.id}>
                Branch · <strong>{branch.name}</strong>{branch.atIntake && " · At intake"}{!branch.active && " · Archived"} · <LicenseRecordStatus counts={counts} />
                {branch.atIntake && branch.active && branch.officerAssigned === false &&
                  <div className="muted">The proposed owner has no current assignment at this branch.</div>}
              </li>;
            })}
          </ul>
        </div>) : <p>No legal entities on file. Add one in Compliance → Licensing.</p>}
        <p className="muted">Staff-entered records for internal review. Verify authorization before originating.</p>
      </section>}
    </div>
  </details>;
}
