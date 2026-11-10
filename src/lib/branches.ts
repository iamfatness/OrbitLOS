import { branchAccessRevision, branchChange, branchLimit, branchesUnavailable, type BrokerageBranch } from "./branch-model";
import { demoBrokerageId, type VersionedBrokerageMember } from "./brokerage-model";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { accessEvent } from "./workspace-access";

const fields = "id, name, active, revision, staff, ownerEmail";
const branchChanged = "This branch changed. Reload Branches before saving.";

function readBranch(row: Record<string, SqlValue>): BrokerageBranch {
  return { id: String(row.id), name: String(row.name), active: Boolean(row.active), revision: Number(row.revision),
    staff: JSON.parse(String(row.staff)) as BrokerageBranch["staff"], ownerEmail: typeof row.ownerEmail === "string" ? row.ownerEmail : null };
}

export function branchById(db: Store, id: string) {
  const row = db.prepare(`SELECT ${fields} FROM brokerage_branches WHERE id = ?`).get(id);
  return row && readBranch(row);
}

export function readBranches(db: Store) {
  return db.prepare(`SELECT ${fields} FROM brokerage_branches ORDER BY active DESC, nameKey, id LIMIT ?`).all(branchLimit).map(readBranch);
}

export function canManageBranches(staff: WorkspaceStaff, brokerageId: string) {
  return staff.brokerage.id === brokerageId && staff.brokerage.role === "Admin" && (brokerageId === demoBrokerageId || !!staff.brokerage.pilot);
}

export function updateBranch(db: Store, input: unknown, staff: WorkspaceStaff, brokerageId: string, roster: VersionedBrokerageMember[],
  now = new Date().toISOString()): { message: string } | { error: string } {
  if (!canManageBranches(staff, brokerageId)) return { error: branchesUnavailable };
  const parsed = branchChange.safeParse(input);
  if (!parsed.success) return { error: "Enter a branch name and select eligible staff before saving." };
  const data = parsed.data;
  return db.transaction(() => {
    const current = branchById(db, data.id);
    if (data.type === "setBranchActive") {
      if (!current) return { error: branchChanged };
      if (current.active === data.active && (current.revision === data.revision || current.revision === data.revision + 1)) {
        return { message: data.active ? "Branch is active." : "Branch is archived." };
      }
      if (current.revision !== data.revision) return { error: branchChanged };
      db.prepare("UPDATE brokerage_branches SET active = ?, revision = revision + 1 WHERE id = ?").run(Number(data.active), data.id);
      accessEvent(db, staff, data.active ? "Reactivated branch" : "Archived branch", `${current.name} · v${current.revision + 1}`, now);
      return { message: data.active ? "Branch reactivated." : "Branch archived." };
    }

    const members = new Map(roster.filter(({ status }) => status !== "Revoked").map((member) => [member.email, member]));
    if (data.staffEmails.some((email) => !members.has(email))) return { error: "Choose current staff or an invited staff member in this brokerage." };
    if (data.ownerEmail) {
      const owner = members.get(data.ownerEmail);
      if (!data.staffEmails.includes(data.ownerEmail) || owner?.status !== "Active" || owner.role === "Processor") {
        return { error: "Choose an active loan officer or admin assigned to this branch." };
      }
    }
    const name = data.name.normalize("NFC").replace(/\s+/gu, " ");
    const staffList = data.staffEmails.toSorted().map((email) => ({ email, accessRevision: branchAccessRevision(members.get(email)!) }));
    const serialized = JSON.stringify(staffList);
    if (current?.name === name && current.ownerEmail === data.ownerEmail && JSON.stringify(current.staff) === serialized &&
      (current.revision === data.revision || current.revision === data.revision + 1)) return { message: "Branch is up to date." };
    if ((current?.revision ?? 0) !== data.revision) return { error: branchChanged };
    const nameKey = name.toLowerCase();
    if (db.prepare("SELECT 1 FROM brokerage_branches WHERE nameKey = ? AND id <> ?").get(nameKey, data.id)) {
      return { error: "A branch with this name already exists." };
    }
    if (!current && Number(db.prepare("SELECT count(*) AS total FROM brokerage_branches").get()?.total) >= branchLimit) {
      return { error: `This workspace supports up to ${branchLimit} branches.` };
    }
    db.prepare(`INSERT INTO brokerage_branches (id, name, nameKey, staff, ownerEmail) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, nameKey = excluded.nameKey, staff = excluded.staff,
        ownerEmail = excluded.ownerEmail, revision = revision + 1`).run(data.id, name, nameKey, serialized, data.ownerEmail);
    accessEvent(db, staff, current ? "Updated branch and staff" : "Created branch", `${name} · v${data.revision + 1}`, now);
    return { message: current ? "Branch updated." : "Branch created." };
  });
}
