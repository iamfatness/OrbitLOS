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

export function LeadLicenseStateReview({ brokerageId, propertyState }: { brokerageId: string; propertyState: string }) {
  const [jurisdiction, setJurisdiction] = useState(propertyState);
  const [result, setResult] = useState<LicenseStateCheck>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jurisdiction || checking) return;
    setChecking(true);
    setResult(undefined);
    setError("");
    try {
      const response = await accessComplianceCases({ type: "program", input: { operation: "licenseStateCheck", jurisdiction } }, brokerageId);
      if ("error" in response || response.kind !== "licenseStateCheck") {
        setError("Could not check license records. Try again.");
      } else setResult(response);
    } catch { setError("Could not check license records. Try again."); }
    finally { setChecking(false); }
  }

  return <details className="document-form license-state-review">
    <summary>Check state licenses</summary>
    <div className="record-form">
      <p className="muted">{propertyState
        ? `Intake listed ${propertyStateName(propertyState)}. A different selection applies to this check only.`
        : "Choose the property state to review company license records before assigning the lead."}</p>
      <form onSubmit={check}>
        <div className="loan-application-actions licensing-controls license-state-controls">
          <label className="field">Property state<select required value={jurisdiction} disabled={checking} onChange={event => {
            setJurisdiction(event.target.value);
            setResult(undefined);
            setError("");
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
      {result && <div className="work-queue license-state-result" aria-label="Company license check" role="status">
        <h4 className="font-semibold">{propertyStateName(result.jurisdiction)} company records</h4>
        {result.entities.length ? <ul>{result.entities.map(entity => <li key={entity.id}>
          <strong>{entity.name}</strong> · <LicenseRecordStatus counts={entity.company} />
        </li>)}</ul> : <p>No legal entities on file. Add one in Compliance → Licensing.</p>}
        <p className="muted">Staff-entered records for internal review. Verify authorization before originating.</p>
      </div>}
    </div>
  </details>;
}
