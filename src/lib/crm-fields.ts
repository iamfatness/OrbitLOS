import type { BrokerageRole } from "./brokerage-model";
import { fullContactScope } from "./contact-directory";
import { crmFieldDefinition, crmFieldInput, crmFieldLimit, crmFieldUnavailable, normalizeCrmFieldValue,
  type CrmField, type CrmFieldFilter, type CrmFieldInput, type CrmFieldResult, type CrmFieldTarget } from "./crm-field-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

type FieldRow = { id: string; revision: number; definition: string; archivedAt: string | null };
const parseField = (row: FieldRow): CrmField => ({ ...crmFieldDefinition.parse(JSON.parse(row.definition)), id: row.id, revision: row.revision });
export const crmFieldValueTable = { lead: "crm_lead_field_values", contact: "crm_contact_field_values" } as const;
export const canSeeCrmField = (field: CrmField, role: BrokerageRole) => role === "Admin" || field.roles.includes(role);

function activeFields(db: Store, role: BrokerageRole) {
  const rows = db.prepare("SELECT id, revision, definition FROM crm_fields WHERE archivedAt IS NULL ORDER BY label COLLATE NOCASE, id LIMIT ?")
    .all(crmFieldLimit) as unknown as FieldRow[];
  return rows.map(parseField).filter((field) => canSeeCrmField(field, role));
}

export function activeCrmField(db: Store, id: string) {
  const row = db.prepare("SELECT id, revision, definition FROM crm_fields WHERE id = ? AND archivedAt IS NULL").get(id) as FieldRow | undefined;
  return row ? parseField(row) : null;
}

export function resolveCrmFieldFilter(db: Store, filter: CrmFieldFilter) {
  const field = activeCrmField(db, filter.fieldId);
  if (!field) return null;
  const value = normalizeCrmFieldValue(field, filter.value);
  return typeof value === "string" ? { field, value } : null;
}

function recordAccess(db: Store, staff: WorkspaceStaff, target: CrmFieldTarget) {
  const { role } = staff.brokerage;
  if (target.record === "lead") {
    return role !== "Processor" && !!db.prepare(`SELECT 1 FROM referral_leads WHERE id = ? AND resolvedAt IS NULL
      ${role === "LO" ? "AND officerEmail = ?" : ""}`).get(target.recordId, ...(role === "LO" ? [staff.email] : []));
  }
  return !!db.prepare(`SELECT 1 FROM contacts contact CROSS JOIN (SELECT ? AS email) actor
    WHERE contact.id = ? AND contact.role <> 'Realtor' AND (${fullContactScope(role)})`).get(staff.email, target.recordId);
}

function recordValues(db: Store, staff: WorkspaceStaff, target: CrmFieldTarget): CrmFieldResult {
  const rows = db.prepare(`SELECT fieldId, value, revision FROM ${crmFieldValueTable[target.record]} WHERE recordId = ?`)
    .all(target.recordId) as { fieldId: string; value: string | null; revision: number }[];
  const stored = new Map(rows.map((row) => [row.fieldId, row]));
  return { kind: "values", editable: staff.brokerage.role !== "Processor", entries: activeFields(db, staff.brokerage.role).map((field) => {
    const row = stored.get(field.id);
    return { field, value: row?.value ?? null, revision: row?.revision ?? 0 };
  }) };
}

function fieldSettings(db: Store, staff: WorkspaceStaff, input: Extract<CrmFieldInput, { type: "saveField" | "archiveField" }>, now: string): CrmFieldResult {
  if (staff.brokerage.role !== "Admin") return { error: crmFieldUnavailable };
  const row = db.prepare("SELECT id, revision, definition, archivedAt FROM crm_fields WHERE id = ?").get(input.fieldId) as FieldRow | undefined;
  const changed = { error: "This CRM field changed. Reload the field settings." };
  if (input.type === "archiveField") {
    if (row?.archivedAt && row.revision === input.revision + 1) return { kind: "archived" };
    if (!row || row.archivedAt || row.revision !== input.revision) return changed;
    db.prepare("UPDATE crm_fields SET archivedAt = ?, revision = revision + 1 WHERE id = ?").run(now, row.id);
    accessEvent(db, staff, "Archived CRM field", row.id, now);
    return { kind: "archived" };
  }
  const { definition, fieldId } = input;
  const serialized = JSON.stringify(definition);
  if (row && !row.archivedAt && row.definition === serialized) return { kind: "savedField", field: parseField(row) };
  if (row?.archivedAt || (row?.revision ?? 0) !== input.revision) return changed;
  const previous = row ? parseField(row) : null;
  if (previous && (previous.kind !== definition.kind || previous.options.some((option) => !definition.options.includes(option)))) {
    return { error: "Keep the existing field type and choices. You can add new choices." };
  }
  if (db.prepare("SELECT 1 FROM crm_fields WHERE label = ? COLLATE NOCASE AND archivedAt IS NULL AND id <> ?").get(definition.label, fieldId)) {
    return { error: "Use a different field label." };
  }
  if (!row && Number(db.prepare("SELECT count(*) AS total FROM crm_fields WHERE archivedAt IS NULL").get()?.total) >= crmFieldLimit) {
    return { error: "Archive a field before creating another one." };
  }
  const revision = input.revision + 1;
  db.prepare(`INSERT INTO crm_fields (id, label, revision, definition) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET label = excluded.label, revision = excluded.revision, definition = excluded.definition`)
    .run(fieldId, definition.label, revision, serialized);
  accessEvent(db, staff, row ? "Updated CRM field" : "Created CRM field", fieldId, now);
  return { kind: "savedField", field: { id: fieldId, revision, ...definition } };
}

function saveValue(db: Store, staff: WorkspaceStaff, input: Extract<CrmFieldInput, { type: "saveValue" }>, now: string): CrmFieldResult {
  const role = staff.brokerage.role;
  const field = activeCrmField(db, input.fieldId);
  if (role === "Processor" || !field || !canSeeCrmField(field, role)) return { error: crmFieldUnavailable };
  if (field.revision !== input.fieldRevision) return { error: "The field definition changed. Reload the record fields." };
  const value = normalizeCrmFieldValue(field, input.value);
  if (value === undefined) return { error: `Enter a valid value for ${field.label}.` };
  const table = crmFieldValueTable[input.record];
  const current = db.prepare(`SELECT revision, value FROM ${table} WHERE recordId = ? AND fieldId = ?`).get(input.recordId, field.id);
  if ((current?.value ?? null) === value) return recordValues(db, staff, input);
  if (Number(current?.revision ?? 0) !== input.revision) return { error: "This field value changed. Reload the record fields." };
  db.prepare(`INSERT INTO ${table} (recordId, fieldId, value, revision) VALUES (?, ?, ?, ?)
    ON CONFLICT(recordId, fieldId) DO UPDATE SET value = excluded.value, revision = excluded.revision`)
    .run(input.recordId, field.id, value, input.revision + 1);
  accessEvent(db, staff, "Updated CRM field value", `${input.record} ${input.recordId} · ${field.id}`, now);
  return recordValues(db, staff, input);
}

export function crmFieldWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date().toISOString()): CrmFieldResult {
  if (!staff || staff.brokerage.id !== brokerageId) return { error: crmFieldUnavailable };
  const parsed = crmFieldInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the CRM field settings." };
  const data = parsed.data;
  if (data.type === "list") return { kind: "list", fields: activeFields(db, staff.brokerage.role) };
  return db.transaction(() => {
    if (data.type === "saveField" || data.type === "archiveField") return fieldSettings(db, staff, data, now);
    if (!recordAccess(db, staff, data)) return { error: crmFieldUnavailable };
    return data.type === "values" ? recordValues(db, staff, data) : saveValue(db, staff, data, now);
  });
}

export function carryCrmFields(db: Store, from: CrmFieldTarget, contactId: string) {
  db.prepare(`INSERT INTO crm_contact_field_values (recordId, fieldId, value, revision)
    SELECT ?, fieldId, value, 1 FROM ${crmFieldValueTable[from.record]} WHERE recordId = ? AND value IS NOT NULL
    ON CONFLICT(recordId, fieldId) DO UPDATE SET value = excluded.value, revision = crm_contact_field_values.revision + 1
      WHERE crm_contact_field_values.value IS NULL`).run(contactId, from.recordId);
}
