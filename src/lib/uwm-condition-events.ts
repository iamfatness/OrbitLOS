import type { Condition } from "./model";
import type { Store } from "./store";

type ConditionUpdate = {
  id: string;
  conditionId: string;
  version: number;
  state: "Open" | "Cleared";
  occurredAt: string;
};

export function latestMockConditionUpdate(db: Store, submissionId: string, conditionId: string) {
  return db.prepare(`SELECT id, conditionId, version, state, occurredAt FROM mock_uwm_condition_events
    WHERE submissionId = ? AND conditionId = ? AND outcome = 'Applied' ORDER BY version DESC LIMIT 1`)
    .get(submissionId, conditionId) as ConditionUpdate | undefined;
}

// The mock feed assigns versions per condition. Delivery order and timestamps never determine precedence.
export function receiveMockConditionUpdate(db: Store, submissionId: string, category: string, event: ConditionUpdate,
  receivedAt: string, apply: (state: ConditionUpdate["state"]) => void) {
  const { id, conditionId, version, state, occurredAt } = event;
  const existing = db.prepare(`SELECT conditionId, version, state, occurredAt FROM mock_uwm_condition_events WHERE submissionId = ? AND id = ?`)
    .get(submissionId, id);
  if (existing) {
    if (existing.conditionId !== conditionId || existing.version !== version || existing.state !== state || existing.occurredAt !== occurredAt) {
      return "Conflicting identity" as const;
    }
    db.prepare("UPDATE mock_uwm_condition_events SET duplicates = min(duplicates + 1, 9999), lastDuplicateAt = ? WHERE submissionId = ? AND id = ?")
      .run(receivedAt, submissionId, id);
    return "Duplicate" as const;
  }
  const current = latestMockConditionUpdate(db, submissionId, conditionId);
  const outcome = current && version <= current.version ? "Ignored stale" : "Applied";
  if (outcome === "Applied") apply(state);
  db.prepare(`INSERT INTO mock_uwm_condition_events (submissionId, id, conditionId, category, version, state, occurredAt, receivedAt, outcome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(submissionId, id, conditionId, category, version, state, occurredAt, receivedAt, outcome);
  return outcome;
}

export function nextMockConditionUpdate(db: Store, submissionId: string, condition: Pick<Condition, "id" | "satisfiedAt">,
  occurredAt: string): ConditionUpdate {
  return { id: crypto.randomUUID(), conditionId: condition.id, version: (latestMockConditionUpdate(db, submissionId, condition.id)?.version ?? 0) + 1,
    state: condition.satisfiedAt ? "Cleared" : "Open", occurredAt };
}

export function recordMockConditionChanges(db: Store, submissionId: string, conditions: Condition[], previous: Condition[], now: string) {
  const before = new Map(previous.map((item) => [item.id, item]));
  for (const condition of conditions) {
    const old = before.get(condition.id);
    if (old && old.satisfiedAt === condition.satisfiedAt) continue;
    const event = nextMockConditionUpdate(db, submissionId, condition, condition.satisfiedAt ?? now);
    receiveMockConditionUpdate(db, submissionId, condition.category, event, now, () => {});
  }
}
