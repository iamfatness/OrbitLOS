import { closingGatePolicy, type ClosingGateSettings } from "./closing-gate-model";
import type { Store } from "./store";

const defaults: ClosingGateSettings = { kind: "settings", revision: 0, rules: { closing: [], funding: [] },
  reason: "", publishedAt: null, publishedBy: null };

export function currentClosingGatePolicy(db: Store): ClosingGateSettings {
  const row = db.prepare("SELECT revision, rules, reason, publishedAt, publishedBy FROM closing_gate_versions ORDER BY revision DESC LIMIT 1")
    .get() as Omit<ClosingGateSettings, "kind" | "rules"> & { rules: string } | undefined;
  return row ? { ...row, kind: "settings", rules: closingGatePolicy.parse(JSON.parse(row.rules)) } : defaults;
}
