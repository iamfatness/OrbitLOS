import { addApplicationActivity, getApplication, startApplication } from "./applications";
import { applicationDraft } from "./application-model";
import { mismoFields, mismoXml, type MismoFields } from "./mismo-rehearsal-model";
import { insertContact, insertLoan, type Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";
import { accessEvent, loanAccess } from "./workspace-access";

export function createMismoRehearsal(db: Store, staff: WorkspaceStaff, requestId: string, fields: MismoFields, now: string) {
  const existing = db.prepare("SELECT loanId, fields FROM mismo_rehearsals WHERE requestId = ?").get(requestId);
  const serialized = JSON.stringify(fields);
  if (existing) return existing.fields === serialized
    ? { loanId: String(existing.loanId) } : { error: "Start a new rehearsal after changing the file." };

  const contactId = crypto.randomUUID();
  const loanId = crypto.randomUUID();
  const name = `${fields.firstName} ${fields.lastName}`;
  insertContact(db, { id: contactId, name, email: "", phone: "", role: "Borrower" });
  const address = [fields.street, fields.city, [fields.state, fields.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  insertLoan(db, { id: loanId, contactId, partnerId: null, officer: staff.name || staff.email, officerEmail: staff.email, address,
    amount: Math.round(Number(fields.amount)), purpose: fields.purpose, stage: "Lead", stageSince: now, createdAt: now, leadSource: "Other" });
  startApplication(db, loanId, now, staff.brokerage.id);
  const application = getApplication(db, loanId);
  if (!application) throw new Error("Could not initialize the rehearsal application.");
  const draft = applicationDraft.parse({ ...JSON.parse(application.draft), occupancy: fields.occupancy, loanAmount: fields.amount,
    propertyAddress: fields.street, propertyLocation: { unit: fields.unit, city: fields.city, state: fields.state, zip: fields.zip } });
  db.prepare("UPDATE applications SET draft = ? WHERE loanId = ?").run(JSON.stringify(draft), loanId);
  db.prepare("INSERT INTO mismo_rehearsals (loanId, requestId, fields) VALUES (?, ?, ?)").run(loanId, requestId, serialized);
  addApplicationActivity(db, loanId, "Created a fictional 1003 draft from a reviewed MISMO 3.4 mapping.", now);
  accessEvent(db, staff, "Imported a synthetic MISMO file", loanId, now);
  return { loanId };
}

export function exportMismoRehearsal(db: Store, staff: WorkspaceStaff, loanId: string) {
  if (staff.brokerage.role !== "Admin" && loanAccess(db, staff, loanId) !== "owner") return null;
  const row = db.prepare("SELECT fields FROM mismo_rehearsals WHERE loanId = ?").get(loanId);
  return row ? mismoXml(mismoFields.parse(JSON.parse(String(row.fields)))) : null;
}
