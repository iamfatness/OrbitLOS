import { createHash } from "node:crypto";
import type { AutomationDestination, AutomationDestinationPage, AutomationEventType } from "./automation-event-model";
import { automationDestinationQuery } from "./automation-event-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

type Row = Omit<AutomationDestination, "eventTypes"> & { sequence: number; eventTypes: string };

function project(row: Row): AutomationDestination {
  return { id: row.id, name: row.name, state: row.state, revision: row.revision, eventTypes: JSON.parse(row.eventTypes) as AutomationEventType[] };
}

function rowById(db: Store, id: string) {
  return db.prepare("SELECT * FROM automation_destinations WHERE id = ?").get(id) as unknown as Row | undefined;
}

export function automationDestination(db: Store, id: string) {
  const row = rowById(db, id);
  return row && project(row);
}

export function automationDestinationWork(db: Store, staff: WorkspaceStaff, input: unknown, at = new Date().toISOString()):
  AutomationDestinationPage | { kind: "destination"; destination: AutomationDestination } | { error: string } {
  if (staff.brokerage.role !== "Admin") return { error: "Only a brokerage admin can manage automation destinations." };
  const parsed = automationDestinationQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose at least one event type and a destination name." };
  const query = parsed.data;
  if (query.type === "destinations") {
    const { before } = query;
    const limit = 20;
    const rows = db.prepare(`SELECT * FROM automation_destinations ${before ? "WHERE sequence < ?" : ""}
      ORDER BY sequence DESC LIMIT ?`).all(...(before ? [before] : []), limit + 1) as unknown as Row[];
    return { kind: "destinations", destinations: rows.slice(0, limit).map(project), next: rows.length > limit ? rows[limit - 1].sequence : null };
  }

  if (query.type === "destination") {
    const destination = automationDestination(db, query.id);
    return destination ? { kind: "destination", destination } : { error: "This destination is unavailable in this brokerage." };
  }
  return db.transaction(() => {
    const current = rowById(db, query.id);
    const create = query.type === "createDestination";
    const expectedRevision = create ? 0 : query.revision;
    const operationId = create ? query.id : query.operationId;
    const configuration = query.type !== "setDestinationState";
    const request = configuration ? { name: query.name, eventTypes: [...query.eventTypes].sort() } : { state: query.state };
    const fingerprint = createHash("sha256").update(JSON.stringify([query.type, query.id, expectedRevision, request])).digest("hex");
    const previous = db.prepare("SELECT actorEmail, fingerprint FROM automation_destination_history WHERE operationId = ?").get(operationId);
    if (previous) {
      return current && previous.actorEmail === staff.email && previous.fingerprint === fingerprint
        ? { kind: "destination", destination: project(current) } : { error: "This destination operation identifier is already in use." };
    }
    if (create ? Boolean(current) : !current || current.revision !== expectedRevision) {
      return { error: "This destination changed. Refresh the list before trying again." };
    }
    if (current?.state === "Disconnected") return { error: "This destination is disconnected. Create a new destination to begin another subscription." };

    if (configuration) {
      if (db.prepare(`SELECT 1 FROM automation_destinations WHERE name = ? COLLATE NOCASE AND state <> 'Disconnected' AND id <> ?`)
        .get(query.name, query.id)) return { error: "Choose a different name. An active or paused destination already uses this one." };
      const eventTypes = JSON.stringify([...query.eventTypes].sort());
      if (create) {
        const open = db.prepare("SELECT count(*) AS total FROM automation_destinations WHERE state IN ('Active', 'Paused')").get();
        if (Number(open?.total) >= 12) return { error: "This brokerage already has 12 active or paused destinations. Disconnect one before creating another." };
        db.prepare(`INSERT INTO automation_destinations (id, name, eventTypes, state, revision) VALUES (?, ?, ?, 'Active', 1)`)
          .run(query.id, query.name, eventTypes);
      } else {
        db.prepare("UPDATE automation_destinations SET name = ?, eventTypes = ?, revision = revision + 1 WHERE id = ?")
          .run(query.name, eventTypes, query.id);
      }
    } else {
      if (current?.state === query.state) return { kind: "destination", destination: project(current) };
      db.prepare("UPDATE automation_destinations SET state = ?, revision = revision + 1 WHERE id = ?").run(query.state, query.id);
    }
    const saved = automationDestination(db, query.id);
    if (!saved) throw new Error("The automation destination was not saved.");
    db.prepare(`INSERT INTO automation_destination_history (destinationId, revision, operationId, actorEmail, snapshot, fingerprint, at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(saved.id, saved.revision, operationId, staff.email, JSON.stringify(saved), fingerprint, at);
    return { kind: "destination", destination: saved };
  });
}
