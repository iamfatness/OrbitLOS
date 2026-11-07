import type { Submission } from "./model";
import type { Store } from "./store";
import type { UwmAlert } from "./uwm-alert-model";

type Snapshot = Pick<Submission, "status" | "conditions">;

export function recordUwmAlerts(db: Store, next: Snapshot & Pick<Submission, "id" | "loanId">, previous: Snapshot | null, now: string) {
  const insert = db.prepare(`INSERT INTO uwm_alerts (id, loanId, submissionId, kind, conditionId, message, detectedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  let count = 0;
  function add(kind: UwmAlert["kind"], message: string, conditionId: string | null = null) {
    insert.run(crypto.randomUUID(), next.loanId, next.id, kind, conditionId, message, now);
    count++;
  }
  if (previous && previous.status !== next.status) {
    const display = (status: string) => status.replace(/^Wholesale - /, "");
    add("Status changed", `${display(previous.status)} → ${display(next.status)}`);
  }
  const before = new Map(previous?.conditions.map((condition) => [condition.id, condition]));
  for (const condition of next.conditions) {
    const old = before.get(condition.id);
    if (condition.satisfiedAt || (old && !old.satisfiedAt)) continue;
    add(old ? "Reopened condition" : "New condition", `${condition.category} · ${condition.description}`, condition.id);
  }
  return count;
}
