import { scenarioRequest, type ScenarioRecord, type ScenarioResponse } from "./loan-scenario-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent, loanAccess } from "./workspace-access";

export function loanScenarioWork(db: Store, input: unknown, staff: WorkspaceStaff, brokerageId: string, clock = new Date()): ScenarioResponse | { error: string } {
  const parsed = scenarioRequest.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the scenario inputs." };
  const data = parsed.data;
  if (staff.brokerage.id !== brokerageId || !loanAccess(db, staff, data.loanId)) return { error: "This loan is unavailable in your workspace." };
  const canEdit = staff.brokerage.role !== "Processor";
  return db.transaction(() => {
    const app = db.prepare("SELECT revision FROM applications WHERE loanId = ?").get(data.loanId);
    const currentApplicationRevision = app ? Number(app.revision) : null;
    const row = db.prepare("SELECT * FROM loan_scenario_plans WHERE loanId = ?").get(data.loanId);
    const record: ScenarioRecord | null = row ? { plan: JSON.parse(String(row.plan)), revision: Number(row.revision),
      updatedAt: String(row.updatedAt), updatedBy: String(row.updatedBy), applicationRevision: row.applicationRevision === null ? null : Number(row.applicationRevision) } : null;
    if (data.type === "read") return { record, currentApplicationRevision, canEdit };
    if (!canEdit) return { error: "Only the loan officer or an admin can save scenarios." };
    if (data.applicationRevision !== currentApplicationRevision) return { error: "The 1003 changed. Reload and review the scenario assumptions before saving." };
    if (data.revision !== (record?.revision ?? 0)) return { error: "These scenarios changed. Reload the saved version before saving." };
    const now = clock.toISOString();
    const next = { plan: data.plan, revision: data.revision + 1, updatedAt: now, updatedBy: staff.name, applicationRevision: currentApplicationRevision };
    db.prepare(`INSERT INTO loan_scenario_plans (loanId, plan, revision, updatedAt, updatedBy, applicationRevision) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (loanId) DO UPDATE SET plan=excluded.plan, revision=excluded.revision, updatedAt=excluded.updatedAt,
      updatedBy=excluded.updatedBy, applicationRevision=excluded.applicationRevision`)
      .run(data.loanId, JSON.stringify(data.plan), next.revision, now, staff.name, currentApplicationRevision);
    accessEvent(db, staff, data.plan.recommendedId ? "Saved loan scenarios and recommendation" : "Saved loan scenarios", data.loanId, now);
    return { record: next, currentApplicationRevision, canEdit };
  });
}
