"use client";

import { useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import { licenseJurisdictions, type LicenseRecordCounts, type LicenseStateCheck } from "@/lib/compliance-program-model";
import { researchSources } from "@/lib/compliance-research-model";
import { Button } from "./ui/button";

const stateNames = new Map(researchSources.map(source => [source.jurisdiction, source.title]));
export const licenseStateName = (code: string) => code === "DC" ? "District of Columbia" : stateNames.get(code) ?? code;

export function LicenseRecordStatus({ counts }: { counts: LicenseRecordCounts }) {
  const { current, expired, review } = counts;
  if (!current && !expired && !review) return <>No records on file</>;
  return <>{current ? `${current} current` : "No current records"}
    {expired > 0 && ` · ${expired} expired`}{review > 0 && ` · ${review} to review`}</>;
}

export function LeadLicenseStateReview({ brokerageId }: { brokerageId: string }) {
  const [jurisdiction, setJurisdiction] = useState("");
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

  return <details className="document-form">
    <summary>Check state licenses</summary>
    <div className="record-form">
      <p className="muted">Choose the property state to review company license records before assigning the lead.</p>
      <form className="loan-application-actions licensing-controls" onSubmit={check}>
        <label className="field">Property state<select required value={jurisdiction} disabled={checking} onChange={event => {
          setJurisdiction(event.target.value);
          setResult(undefined);
          setError("");
        }}>
          <option value="">Select a state</option>
          {licenseJurisdictions.map(code => <option key={code} value={code}>{code} · {licenseStateName(code)}</option>)}
        </select></label>
        <Button type="submit" size="sm" className="min-h-11" variant="outline" aria-disabled={checking || !jurisdiction}>
          {checking ? "Checking…" : result ? "Refresh check" : "Check records"}
        </Button>
      </form>
      {checking && <p className="muted" role="status">Checking license records…</p>}
      {error && <p role="alert">{error}</p>}
      {result && <div className="work-queue" aria-label="Company license check" role="status">
        <h4>{licenseStateName(result.jurisdiction)} company records</h4>
        {result.entities.length ? <ul>{result.entities.map(entity => <li key={entity.id}>
          <strong>{entity.name}</strong> · <LicenseRecordStatus counts={entity.company} />
        </li>)}</ul> : <p>No legal entities on file. Add one in Compliance → Licensing.</p>}
        <p className="muted">Staff-entered records for internal review. Verify authorization before originating.</p>
      </div>}
    </div>
  </details>;
}
