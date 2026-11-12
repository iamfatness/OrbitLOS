import { createHash } from "node:crypto";
import { closingGateInput, closingGateLabels, closingGatePhases, closingGateRules, closingGateUnavailable,
  type ClosingGateBlocker, type ClosingGateCheck, type ClosingGateOverride, type ClosingGatePhase, type ClosingGateResult,
  type ClosingGateRule, type ClosingGateSettings } from "./closing-gate-model";
import { addLoanAuditEntry } from "./loan-audit";
import { currentClosingGatePolicy } from "./closing-gate-policy-store";
import { canUseSampleDisclosures, readChangedClosingApproval } from "./disclosures";
import { changedClosingApprovalRequired } from "./disclosure-model";
import { closingChecklistListTarget, closingChecklistTarget } from "./loan-workflow";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { conditionTarget } from "./uwm-alert-model";
import { accessEvent, loanAccess } from "./workspace-access";

const visibleLimit = 20;
const missingChecklist = "missing-checklist";
type GateRow = Omit<ClosingGateBlocker, "rule" | "target"> & { evidence: string | null };

export { currentClosingGatePolicy } from "./closing-gate-policy-store";

export const closingGateFileJoins = `LEFT JOIN closing_plans plan ON plan.loanId = loan.id
  LEFT JOIN past_client_profiles profile ON profile.loanId = loan.id LEFT JOIN closing_progress progress ON progress.loanId = loan.id`;

export const closingGateSources = {
  "1003": { joins: "LEFT JOIN applications app ON app.loanId = loan.id", match: "(app.reviewedAt IS NULL OR app.submittedAt IS NULL OR app.correctionNote <> '')",
    id: "'1003'", parent: "loan.id", title: "'Current 1003 needs review'", due: "plan.targetDate", evidence: "json_array(app.revision, app.submittedAt, app.reviewedAt, app.correctionNote)",
    processor: "0" },
  conditions: { joins: `JOIN submissions file ON file.loanId = loan.id JOIN processing_open_conditions item ON item.submissionId = file.id
    LEFT JOIN document_requests request ON request.submissionId = item.submissionId AND request.conditionId = item.conditionId`, match: "1",
    id: "item.conditionId", parent: "file.id", title: "item.title || ' condition'", due: "coalesce(request.dueOn, plan.targetDate)",
    evidence: `json_array(item.openedAt, item.reopenedAt, item.manualOwner, request.revision, request.deadlineRevision,
      (SELECT condition.value FROM json_each(CASE WHEN json_valid(file.conditions) THEN file.conditions ELSE '[]' END) condition
        WHERE json_extract(condition.value, '$.id') = item.conditionId LIMIT 1))`,
    processor: "lower(trim(item.manualOwner)) = 'processor'" },
  checklist: { joins: "LEFT JOIN closing_items item ON item.loanId = loan.id", match: "item.completedAt IS NULL",
    id: `coalesce(item.id, '${missingChecklist}')`, parent: "loan.id", title: "coalesce(item.title, 'Closing checklist has no items')",
    due: "coalesce(item.dueDate, plan.targetDate)", evidence: "json_array(item.revision, item.owner)",
    processor: "lower(trim(item.owner)) = 'processor'" },
} satisfies Record<ClosingGateRule, Record<string, string>>;

export function closingGateTarget(rule: ClosingGateRule, parentId: string, id: string) {
  switch (rule) {
    case "conditions": return conditionTarget(parentId, id);
    case "checklist": return id === missingChecklist ? closingChecklistListTarget : closingChecklistTarget(id);
    case "1003": return "loan-application";
  }
}

function closingGateCheck(db: Store, loanId: string, phase: ClosingGatePhase, policy: ClosingGateSettings): ClosingGateCheck {
  const rules = policy.rules[phase];
  if (!rules.length) return { blockers: [], more: false, key: null };
  const evidence = rules.flatMap((rule) => {
    const source = closingGateSources[rule];
    const rows = db.prepare(`SELECT ${source.id} AS id, ${source.parent} AS parentId, ${source.title} AS title,
      ${source.due} AS dueOn, ${source.evidence} AS evidence FROM loans loan ${closingGateFileJoins} ${source.joins}
      WHERE loan.id = ? AND ${phase === "closing" ? "profile.closingDate" : "progress.fundingDate"} IS NULL AND ${source.match}
      ORDER BY dueOn, parentId, id LIMIT ?`).all(loanId, visibleLimit + 1) as unknown as GateRow[];
    return rows.map((row) => ({ ...row, rule }));
  });
  const more = evidence.length > visibleLimit;
  const key = evidence.length && !more ? createHash("sha256").update(JSON.stringify([loanId, phase, policy.revision, evidence])).digest("hex") : null;
  const blockers = evidence.slice(0, visibleLimit).map(({ id, parentId, title, dueOn, rule }) =>
    ({ id, parentId, title, dueOn, rule, target: closingGateTarget(rule, parentId, id) }));
  return { blockers, more, key };
}

export function closingGateWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date().toISOString()): ClosingGateResult {
  if (!staff || staff.brokerage.id !== brokerageId) return { error: closingGateUnavailable };
  const parsed = closingGateInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the closing and funding policy." };
  const data = parsed.data;
  const isAdmin = staff.brokerage.role === "Admin";
  if (data.type === "loan") {
    if (!loanAccess(db, staff, data.loanId)) return { error: closingGateUnavailable };
    const policy = currentClosingGatePolicy(db);
    return { kind: "loan", revision: policy.revision, canOverride: isAdmin,
      closing: closingGateCheck(db, data.loanId, "closing", policy), funding: closingGateCheck(db, data.loanId, "funding", policy),
      ...(canUseSampleDisclosures(staff) ? { changedClosingApproval: readChangedClosingApproval(db, data.loanId, policy) } : {}) };
  }
  if (!isAdmin) return { error: closingGateUnavailable };
  const sample = canUseSampleDisclosures(staff);
  const settings = (policy: ClosingGateSettings) => sample ? { ...policy, canRequireChangedPackageReview: true } : policy;
  if (data.type === "settings") return settings(currentClosingGatePolicy(db));
  if (!sample && data.rules.changedPackageReview) return { error: "This approval setting is available for sample closing packages." };
  return db.transaction(() => {
    const current = currentClosingGatePolicy(db);
    const requireReview = sample && (data.rules.changedPackageReview ?? current.rules.changedPackageReview);
    const rules = { closing: closingGateRules.filter((rule) => data.rules.closing.includes(rule)),
      funding: closingGateRules.filter((rule) => data.rules.funding.includes(rule)), ...(requireReview ? { changedPackageReview: true } : {}) };
    const serialized = JSON.stringify(rules);
    if (serialized === JSON.stringify(current.rules) &&
      (data.revision === current.revision || (data.revision + 1 === current.revision && data.reason === current.reason))) return settings(current);
    if (data.revision !== current.revision) return { error: "The closing and funding policy changed. Reload before publishing." };
    const next = { kind: "settings", revision: current.revision + 1, rules, reason: data.reason, publishedAt: now, publishedBy: staff.name } as const;
    db.prepare("INSERT INTO closing_gate_versions (revision, rules, reason, publishedAt, publishedBy) VALUES (?, ?, ?, ?, ?)")
      .run(next.revision, serialized, next.reason, now, staff.name);
    accessEvent(db, staff, "Published closing and funding policy", `Revision ${next.revision}`, now);
    return settings(next);
  });
}

export function checkClosingGate(db: Store, loanId: string, phase: ClosingGatePhase, staff: WorkspaceStaff | null,
  override: ClosingGateOverride | undefined, now: string) {
  const policy = currentClosingGatePolicy(db);
  if (canUseSampleDisclosures(staff) && policy.rules.changedPackageReview) {
    const approval = readChangedClosingApproval(db, loanId, policy);
    if (approval && approval.status !== "Approved") return changedClosingApprovalRequired;
  }
  const check = closingGateCheck(db, loanId, phase, policy);
  if (!override) return check.blockers.length ? `Resolve the required checks in Closing before recording ${phase}.` : null;
  if (staff?.brokerage.role !== "Admin") return "Only a brokerage admin can override closing or funding checks.";
  if (!check.key || override.key !== check.key) return "The required checks changed. Refresh Closing before overriding.";
  addLoanAuditEntry(db, loanId, staff, `Overrode required ${phase} checks`, now, [
    { field: "Policy version", before: null, after: policy.revision },
    { field: "Reason", before: null, after: override.reason },
    { field: "Open evidence", before: null, after: check.blockers.map(({ rule, title }) => `${closingGateLabels[rule]} · ${title}`).join("; ") },
    { field: "Evidence reference", before: null, after: check.key },
  ]);
  return null;
}

export function fundingStageGate(db: Store, loanId: string | undefined, staff?: WorkspaceStaff | null) {
  const policy = currentClosingGatePolicy(db);
  const approval = loanId && canUseSampleDisclosures(staff ?? null) && policy.rules.changedPackageReview ? readChangedClosingApproval(db, loanId, policy) : undefined;
  if (approval && approval.status !== "Approved") return changedClosingApprovalRequired;
  if (!closingGatePhases.some((phase) => policy.rules[phase].length)) return null;
  return loanId && db.prepare("SELECT 1 FROM closing_progress WHERE loanId = ? AND fundingDate IS NOT NULL").get(loanId) ? null :
    "Record the funding date and resolve any required checks in Closing before moving the file to this stage.";
}
