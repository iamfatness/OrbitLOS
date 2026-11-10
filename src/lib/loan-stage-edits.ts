import { addLoanAuditEntry } from "./loan-audit";
import { stageEditInput, stageEditLabels, stageEditRules, stageEditUnavailable, type StageEditArea, type StageEditOverride,
  type StageEditResult, type StageEditSettings } from "./loan-stage-edit-model";
import { stages, type Stage } from "./model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent, loanAccess } from "./workspace-access";

const defaultSettings: StageEditSettings = {
  kind: "settings", revision: 0, rules: { application: [], fees: [] }, reason: "", publishedAt: null, publishedBy: null,
};
type PolicyRow = Omit<StageEditSettings, "kind" | "rules"> & { rules: string };

function currentStageEditPolicy(db: Store): StageEditSettings {
  const row = db.prepare("SELECT revision, rules, reason, publishedAt, publishedBy FROM loan_stage_edit_versions ORDER BY revision DESC LIMIT 1")
    .get() as PolicyRow | undefined;
  return row ? { ...row, kind: "settings", rules: stageEditRules.parse(JSON.parse(row.rules)) } : defaultSettings;
}

export function loanStageEditWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date().toISOString()): StageEditResult {
  if (!staff || staff.brokerage.id !== brokerageId) return { error: stageEditUnavailable };
  const parsed = stageEditInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the loan edit policy." };
  const data = parsed.data;
  const isAdmin = staff.brokerage.role === "Admin";
  if (data.type === "loan") {
    if (!loanAccess(db, staff, data.loanId)) return { error: stageEditUnavailable };
    const { stage } = db.prepare("SELECT stage FROM loans WHERE id = ?").get(data.loanId) as { stage: Stage };
    const { revision, rules } = currentStageEditPolicy(db);
    return { kind: "loan", stage, revision, locked: { application: rules.application.includes(stage), fees: rules.fees.includes(stage) },
      canOverride: isAdmin };
  }
  if (!isAdmin) return { error: stageEditUnavailable };
  if (data.type === "settings") return currentStageEditPolicy(db);
  return db.transaction(() => {
    const current = currentStageEditPolicy(db);
    const rules = { application: stages.filter((item) => data.rules.application.includes(item)),
      fees: stages.filter((item) => data.rules.fees.includes(item)) };
    const serialized = JSON.stringify(rules);
    if (serialized === JSON.stringify(current.rules) &&
      (data.revision === current.revision || (data.revision + 1 === current.revision && data.reason === current.reason))) return current;
    if (data.revision !== current.revision) return { error: "The stage policy changed. Reload it before publishing." };
    const next: StageEditSettings = { kind: "settings", revision: current.revision + 1, rules, reason: data.reason,
      publishedAt: now, publishedBy: staff.name };
    db.prepare("INSERT INTO loan_stage_edit_versions VALUES (?, ?, ?, ?, ?)").run(next.revision, serialized, next.reason, now, staff.name);
    accessEvent(db, staff, "Published loan stage edit policy", `Version ${next.revision}`, now);
    return next;
  });
}

export function authorizeStageEdit(db: Store, staff: WorkspaceStaff | null, loanId: string, area: StageEditArea,
  override: StageEditOverride | undefined): { error: string } | { override?: StageEditOverride } {
  const { revision, rules } = currentStageEditPolicy(db);
  if (!rules[area].length && !override) return {};
  const loan = db.prepare("SELECT stage FROM loans WHERE id = ?").get(loanId) as { stage: Stage } | undefined;
  const locked = loan && rules[area].includes(loan.stage);
  if (override && staff?.brokerage.role !== "Admin") return { error: "Only a brokerage admin can override a stage lock." };
  if (override && (!locked || override.revision !== revision || override.stage !== loan?.stage)) {
    return { error: "The loan stage or policy changed. Reload the edit controls before overriding." };
  }
  if (!locked) return {};
  if (override) return { override };
  return { error: `${stageEditLabels[area]} are locked at ${loan.stage}. A brokerage admin can record a reason to make this change.` };
}

export function auditStageOverride(db: Store, staff: WorkspaceStaff | null, loanId: string, action: string, at: string,
  override: StageEditOverride | undefined) {
  if (!override || !staff) return;
  addLoanAuditEntry(db, loanId, staff, `Admin stage override · ${action}`, at, [
    { field: "Pipeline stage", before: null, after: override.stage },
    { field: "Policy version", before: null, after: override.revision },
    { field: "Internal reason", before: null, after: override.reason },
  ]);
}
