import { createHash } from "node:crypto";
import type { ProgramLicense } from "./compliance-program-model";
import { stateRequirementSources, stateRolloutSources, sourceSnapshot } from "./compliance-research-model";

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
