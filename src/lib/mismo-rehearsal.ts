import { addApplicationActivity, getApplication, startApplication } from "./applications";
import { applicationDraft } from "./application-model";
import { mismoBorrowerName, mismoFields, mismoXml, type MismoImport } from "./mismo-rehearsal-model";
import { insertContact, insertLoan, type Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";
import { accessEvent, loanAccess } from "./workspace-access";
import { recordLoanAudit } from "./loan-audit";

export function createMismoRehearsal(db: Store, staff: WorkspaceStaff, input: MismoImport, now: string) {
  const { requestId, fields, existingContactId, confirmedDuplicateLoanId, extraBorrowers } = input;
  const existing = db.prepare("SELECT loanId, fields, existingContactId, sourceExtraBorrowers FROM mismo_rehearsals WHERE requestId = ?").get(requestId);
  const serialized = JSON.stringify(fields);
  if (existing) return existing.fields === serialized && existing.existingContactId === (existingContactId ?? null) &&
    (extraBorrowers === undefined || existing.sourceExtraBorrowers === null || existing.sourceExtraBorrowers === extraBorrowers)
    ? { loanId: String(existing.loanId) } : { error: "This rehearsal was already imported with a different file or borrower. Load the file again to start a new import." };

  if (existingContactId && !db.prepare("SELECT 1 FROM contacts WHERE id = ? AND role IN ('Borrower', 'Co-borrower')").get(existingContactId)) {
    return { error: "Choose an available borrower contact in this brokerage." };
  }
  // Older rehearsal imports stored only the first and last name from the same XML.
  const legacyFields = { ...fields };
  delete legacyFields.middleName;
  delete legacyFields.suffix;
  const duplicateLoanId = existingContactId ? db.prepare(`SELECT loan.id FROM loans loan
    JOIN mismo_rehearsals rehearsal ON rehearsal.loanId = loan.id
    JOIN applications application ON application.loanId = loan.id
    WHERE loan.contactId = ? AND rehearsal.fields IN (?, ?)
    ORDER BY rehearsal.fields = ? DESC, rehearsal.rowid DESC LIMIT 1`).get(existingContactId, serialized, JSON.stringify(legacyFields), serialized)?.id : undefined;
  if (typeof duplicateLoanId === "string" && duplicateLoanId !== confirmedDuplicateLoanId) return { duplicateLoanId };

  const contactId = existingContactId ?? crypto.randomUUID();
  const loanId = crypto.randomUUID();
  const name = mismoBorrowerName(fields);
  if (!existingContactId) insertContact(db, { id: contactId, name, email: "", phone: "", role: "Borrower" });
  const address = [fields.street, fields.city, [fields.state, fields.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  insertLoan(db, { id: loanId, contactId, partnerId: null, officer: staff.name || staff.email, officerEmail: staff.email, address,
    amount: Math.round(Number(fields.amount)), purpose: fields.purpose, stage: "Lead", stageSince: now, createdAt: now, leadSource: "Other" });
  startApplication(db, loanId, now, staff.brokerage.id);
  const application = getApplication(db, loanId);
  if (!application) throw new Error("Could not initialize the rehearsal application.");
  const draft = applicationDraft.parse({ ...JSON.parse(application.draft), borrowerName: name, occupancy: fields.occupancy, loanAmount: fields.amount,
    propertyAddress: fields.street, propertyLocation: { unit: fields.unit, city: fields.city, state: fields.state, zip: fields.zip } });
  db.prepare("UPDATE applications SET draft = ? WHERE loanId = ?").run(JSON.stringify(draft), loanId);
  db.prepare("INSERT INTO mismo_rehearsals (loanId, requestId, fields, existingContactId, sourceExtraBorrowers) VALUES (?, ?, ?, ?, ?)")
    .run(loanId, requestId, serialized, existingContactId ?? null, extraBorrowers ?? null);
  addApplicationActivity(db, loanId, existingContactId ? "Created a fictional 1003 from a reviewed MISMO mapping and linked the existing borrower contact."
    : "Created a fictional 1003 draft from a reviewed MISMO 3.4 mapping.", now);
  recordLoanAudit(db, loanId, staff, "Created synthetic 1003 draft", now, null);
  accessEvent(db, staff, duplicateLoanId ? "Imported a separate synthetic MISMO draft after reviewing a match" : "Imported a synthetic MISMO file", loanId, now);
  return { loanId };
}

export function exportMismoRehearsal(db: Store, staff: WorkspaceStaff, loanId: string) {
  if (staff.brokerage.role !== "Admin" && loanAccess(db, staff, loanId) !== "owner") return null;
  const row = db.prepare("SELECT fields FROM mismo_rehearsals WHERE loanId = ?").get(loanId);
  return row ? mismoXml(mismoFields.parse(JSON.parse(String(row.fields)))) : null;
}
