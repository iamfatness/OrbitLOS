import { z } from "zod";
import { firstDaySteps, type FirstDayProgress } from "./staff-first-day-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

export const setFirstDayStep = z.object({
  step: z.string().min(1).max(40),
  completed: z.boolean(),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();

export function readStaffFirstDay(db: Store, staff: WorkspaceStaff): FirstDayProgress {
  const saved = db.prepare("SELECT step, completedAt, revision FROM staff_first_day WHERE email = ? AND role = ?")
    .all(staff.email, staff.brokerage.role);
  const progress = new Map(saved.map(row => [row.step, row]));
  return { kind: "staffFirstDay", steps: firstDaySteps[staff.brokerage.role].map(({ id }) => {
    const row = progress.get(id);
    return { id, revision: Number(row?.revision ?? 0), completed: typeof row?.completedAt === "string" };
  }) };
}

export function updateStaffFirstDay(db: Store, staff: WorkspaceStaff, input: unknown): FirstDayProgress | { error: string } {
  const parsed = setFirstDayStep.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid checklist step." };
  const { step, completed, revision } = parsed.data;
  return db.transaction(() => {
    const progress = readStaffFirstDay(db, staff);
    const current = progress.steps.find(({ id }) => id === step);
    if (!current) return { error: "This step isn’t available for your role." };
    if (current.completed === completed) return progress;
    if (current.revision !== revision) return { error: "This step changed in another session. Refresh your checklist before trying again." };
    db.prepare(`INSERT INTO staff_first_day (email, role, step, completedAt, revision) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(email, role, step) DO UPDATE SET completedAt = excluded.completedAt, revision = excluded.revision`)
      .run(staff.email, staff.brokerage.role, step, completed ? new Date().toISOString() : null, revision + 1);
    return readStaffFirstDay(db, staff);
  });
}
