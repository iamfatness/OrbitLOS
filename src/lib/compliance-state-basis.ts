import { createHash } from "node:crypto";
import type { ProgramLicense } from "./compliance-program-model";
import { federalObligationSources, type ObligationDraft, type ObligationStateSource } from "./compliance-obligations-model";
import { stateRequirementSources, stateRolloutSources, sourceSnapshot } from "./compliance-research-model";
import type { Store } from "./store";

const requirementsByState = Map.groupBy(stateRequirementSources.map(item => item.source), source => source.jurisdiction);
const sourceBasisByState = new Map([...Map.groupBy(stateRolloutSources, source => source.jurisdiction)].map(([jurisdiction, areas]) => {
  const requirements = requirementsByState.get(jurisdiction) ?? [];
  const sourceSnapshots = JSON.stringify([...areas, ...requirements].map(sourceSnapshot));
  return [jurisdiction, { sourceSnapshots, sourceHash: createHash("sha256").update(sourceSnapshots).digest("hex") }];
}));

export function stateScopeSourceBasis(jurisdiction: string) {
  return sourceBasisByState.get(jurisdiction);
}

export function stateScopeLicenseSnapshot(licenses: readonly ProgramLicense[]) {
  return JSON.stringify(licenses.map(({ id, revision, licenseType, licenseNumber, status, effectiveOn, expiresOn,
    evidence, holder, holderLabel, holderAvailable }) => ({
    id, revision, licenseType, licenseNumber, status, effectiveOn, expiresOn, evidence, holder, holderLabel, holderAvailable,
  })));
}

export function stateScopeBasisChanges(saved: { sourceHash?: unknown; entitySnapshot?: unknown; licenseSnapshots?: unknown },
  current: { sourceHash?: string; entitySnapshot: string; licenseSnapshots: string }) {
  return {
    sourceChanged: saved.sourceHash !== current.sourceHash,
    entityChanged: saved.entitySnapshot !== current.entitySnapshot,
    licensesChanged: typeof saved.licenseSnapshots === "string" && saved.licenseSnapshots !== current.licenseSnapshots,
    licenseBasisMissing: typeof saved.licenseSnapshots !== "string",
  };
}

export function sameStateScopeFacts(saved: Record<string, unknown>, current: Record<string, unknown>) {
  return typeof saved.licenseSnapshots === "string" && saved.licenseSnapshots === current.licenseSnapshots &&
    saved.entitySnapshot === current.entitySnapshot && saved.facts === current.facts;
}

const roleBasedFinancialCondition = new Set([
  "REQ-MI-REPORTING-FC", "REQ-TX-REPORTING-FC", "REQ-CA-REPORTING-DRE-FC", "REQ-CA-REPORTING-CFL-FC",
]);
const quarterlyFinancialCondition = new Set(["REQ-CA-REPORTING-CRMLA-FC", "REQ-CO-REPORTING-QUARTER-FC"]);
export const financialConditionCadenceReview = "The filing cadence conflicts with the recorded brokerage activity. Verify the period and date before filing.";

export function usesFinancialConditionScope(sourceKey: string) {
  return roleBasedFinancialCondition.has(sourceKey) || quarterlyFinancialCondition.has(sourceKey);
}

export function financialConditionScopeMatches(db: Store, brokerageId: string, entityId: string, basis: ObligationStateSource,
  cadence: ObligationDraft["cadence"]) {
  if (!usesFinancialConditionScope(basis.sourceKey)) return true;
  const scope = db.prepare(`SELECT json_extract(facts,'$.activity') AS activity FROM compliance_state_scope_versions
    WHERE brokerageId=? AND entityId=? AND jurisdiction=? AND revision=?`).get(brokerageId, entityId, basis.jurisdiction, basis.revision);
  return roleBasedFinancialCondition.has(basis.sourceKey) && cadence === "Annual" ? scope?.activity === "Brokerage" :
    cadence === "Quarterly" && (scope?.activity === "Brokerage and lending" || scope?.activity === "Brokerage and servicing");
}


export function savedFilingScopeMatches(db: Store, brokerageId: string, entityId: string, basis: ObligationStateSource & { snapshot?: string }, currentBasis: () => { entitySnapshot: string; licenseSnapshots: string }) {
  const snapshot = basis.snapshot;
  if (!snapshot) return true;
  if (basis.jurisdiction === "US") {
    const entity = db.prepare("SELECT id,name,nmls,scopeNote FROM compliance_program_entities WHERE brokerageId=? AND id=?").get(brokerageId, entityId);
    return Boolean(entity && federalObligationSources(entity).some(source => source.snapshot === snapshot));
  }
  const rows = db.prepare(`SELECT revision, facts, entitySnapshot, licenseSnapshots, sourceSnapshots FROM compliance_state_scope_versions
    WHERE brokerageId=? AND entityId=? AND jurisdiction=? AND revision>=? ORDER BY revision`)
    .all(brokerageId, entityId, basis.jurisdiction, basis.revision);
  const saved = rows[0];
  if (!saved || saved.revision !== basis.revision) return false;
  const latest = rows.at(-1);
  const current = currentBasis();
  if (latest?.entitySnapshot !== current.entitySnapshot || latest?.licenseSnapshots !== current.licenseSnapshots) return false;
  const currentSource = requirementsByState.get(basis.jurisdiction)?.find(source => source.key === basis.sourceKey);
  return Boolean(currentSource && sourceSnapshot(currentSource) === snapshot &&
    rows.every((row, index) => Number(row.revision) === basis.revision + index &&
      (index === 0 || (sameStateScopeFacts(saved, row) && row.sourceSnapshots !== rows[index - 1].sourceSnapshots)) &&
      (JSON.parse(String(row.sourceSnapshots)) as string[]).includes(snapshot)));
}
