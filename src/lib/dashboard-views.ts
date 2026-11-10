import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const tables = { Funding: "funding_dashboard_views", Sales: "sales_dashboard_views", "Owner scorecard": "owner_scorecard_views" } as const;
type Dashboard = keyof typeof tables | { name: "Processing"; scope: string };
type ViewChange = { type: "saveView"; id: string; name: string; filters: unknown } | { type: "removeView"; id: string };
const limit = 30;

function viewLocation(dashboard: Dashboard) {
  return typeof dashboard === "string"
    ? { name: dashboard, table: tables[dashboard], filter: "", args: [] }
    : { name: dashboard.name, table: "processing_dashboard_views", filter: " AND scope = ?", args: [dashboard.scope] };
}

export function readDashboardViews<T>(db: Store, dashboard: Dashboard, schema: { parse(input: unknown): T }) {
  const { table, filter, args } = viewLocation(dashboard);
  return db.prepare(`SELECT id, name, filters FROM ${table} WHERE deletedAt IS NULL${filter}
    ORDER BY name COLLATE NOCASE, id LIMIT ?`).all(...args, limit)
    .map((row) => ({ id: String(row.id), name: String(row.name), filters: schema.parse(JSON.parse(String(row.filters))) }));
}

// The caller checks workspace permissions and owns the write transaction.
export function changeDashboardView(db: Store, staff: WorkspaceStaff, dashboard: Dashboard, data: ViewChange, now: string) {
  const { name, table, filter, args } = viewLocation(dashboard);
  const label = name.toLowerCase();
  const existing = db.prepare(`SELECT name, filters, deletedAt FROM ${table} WHERE id = ?${filter}`).get(data.id, ...args);
  if (data.type === "removeView") {
    if (existing && !existing.deletedAt) {
      db.prepare(`UPDATE ${table} SET deletedAt = ? WHERE id = ?${filter}`).run(now, data.id, ...args);
      accessEvent(db, staff, `Removed ${label} view`, data.id, now);
    }
    return { message: `${name} view removed.` };
  }
  const filters = JSON.stringify(data.filters);
  const saved = { message: `${name} view saved.` };
  if (existing) return !existing.deletedAt && existing.name === data.name && existing.filters === filters ? saved :
    { error: `This ${label} view changed. Refresh before saving.` };
  if (db.prepare(`SELECT 1 FROM ${table} WHERE name = ? COLLATE NOCASE AND deletedAt IS NULL${filter}`).get(data.name, ...args)) {
    return { error: `Use a different name for this ${label} view.` };
  }
  if (Number(db.prepare(`SELECT count(*) AS count FROM ${table} WHERE deletedAt IS NULL${filter}`).get(...args)?.count) >= limit) {
    return { error: `Remove a ${label} view before adding another.` };
  }
  db.prepare(`INSERT INTO ${table} (id, name, filters${filter ? ", scope" : ""}) VALUES (?, ?, ?${filter ? ", ?" : ""})`)
    .run(data.id, data.name, filters, ...args);
  accessEvent(db, staff, `Saved ${label} view`, data.id, now);
  return saved;
}
