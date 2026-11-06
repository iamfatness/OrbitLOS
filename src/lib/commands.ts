import { z } from "zod";
import { insertContact, insertLoan, insertSubmission, workspace, type Store } from "./store";
import { stages, type Workspace } from "./model";
import { submitMockApplication, syncUwm } from "./uwm";
import { addApplicationActivity, getApplication, startApplication } from "./applications";

const label = z.string().trim().min(1, "Fill in the required fields.").max(160);
const id = z.string().min(1).max(100);
const contactFields = {
  name: label,
  email: z.union([z.email(), z.literal("")]),
  phone: z.string().trim().max(40),
  role: z.enum(["Borrower", "Co-borrower", "Realtor"]),
};
const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("contact"), id: id.optional(), ...contactFields }),
  z.object({ type: z.literal("deleteContact"), id }),
  z.object({
    type: z.literal("loan"), id: id.optional(), contactId: z.union([id, z.literal("")]),
    borrower: z.string().trim().max(160), partnerId: id.nullable(),
    officer: z.string().trim().max(160), address: z.string().trim().max(240),
    amount: z.number().int().min(0).max(1_000_000_000),
    purpose: z.enum(["Purchase", "Refinance"]), stage: z.enum(stages),
  }),
  z.object({ type: z.literal("deleteLoan"), id }),
  z.object({ type: z.literal("move"), id, stage: z.enum(stages) }),
  z.object({ type: z.literal("note"), loanId: id, text: z.string().trim().min(1, "Write a note first.").max(2000) }),
  z.object({ type: z.literal("submission"), id: id.optional(), loanId: id, lender: label, externalId: label, status: label }),
  z.object({ type: z.literal("deleteSubmission"), id }),
  z.object({ type: z.literal("sync") }),
  z.object({ type: z.literal("startApplication"), loanId: id }),
  z.object({ type: z.literal("refreshApplication"), loanId: id }),
  z.object({ type: z.literal("refreshWorkspace") }),
  z.object({ type: z.literal("completeTask"), id, completed: z.boolean() }),
  z.object({ type: z.literal("reviewApplication"), loanId: id }),
  z.object({ type: z.literal("sendApplication"), loanId: id }),
]);

class WorkspaceError extends Error {}

export async function executeCommand(db: Store, input: unknown): Promise<{ state: Workspace; message: string } | { error: string }> {
  const parsed = command.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form and try again." };
  const data = parsed.data;
  try {
    if (data.type === "sync") {
      const result = await syncUwm(db);
      return { state: workspace(db), message: `UWM sync complete · ${result.imported} imported · ${result.updated} refreshed · ${result.conditions} conditions` };
    }
    const now = new Date().toISOString();
    return db.transaction(() => {
      let message = data.type.startsWith("delete") ? "Removed successfully." : "Saved successfully.";
      switch (data.type) {
        case "startApplication":
          if (!startApplication(db, data.loanId, now)) throw new WorkspaceError("This loan no longer exists.");
          message = "Demo application link is ready.";
          break;
        case "refreshApplication":
          message = "Application status refreshed.";
          break;
        case "refreshWorkspace":
          message = "Workspace refreshed.";
          break;
        case "completeTask": {
          const task = db.prepare("SELECT loanId, completedAt FROM tasks WHERE id = ?").get(data.id);
          if (!task) throw new WorkspaceError("This task no longer exists.");
          message = data.completed ? "Task completed." : "Task reopened.";
          if (data.completed !== Boolean(task.completedAt)) {
            db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ?").run(data.completed ? now : null, data.id);
            addApplicationActivity(db, String(task.loanId), data.completed ? "1003 follow-up task completed." : "1003 follow-up task reopened.", now);
          }
          break;
        }
        case "reviewApplication": {
          const application = getApplication(db, data.loanId);
          if (!application?.submittedAt) throw new WorkspaceError("The borrower must submit the application before review.");
          if (!application.reviewedAt) {
            db.prepare("UPDATE applications SET reviewedAt = ? WHERE loanId = ?").run(now, data.loanId);
            addApplicationActivity(db, data.loanId, "Loan officer reviewed the demo 1003.", now);
          }
          message = "Application marked reviewed.";
          break;
        }
        case "sendApplication": {
          const result = submitMockApplication(db, data.loanId, now);
          if (result.error) throw new WorkspaceError(result.error);
          message = `Mock UWM import confirmed · ${result.reference}`;
          break;
        }
        case "contact": {
          if (data.id) {
            const linkedAs = db.prepare("SELECT contactId, partnerId FROM loans WHERE contactId = ? OR partnerId = ?").all(data.id, data.id);
            if (linkedAs.some((row) => data.role === "Realtor" ? row.contactId === data.id : row.partnerId === data.id)) {
              throw new WorkspaceError("Change this contact’s role after updating the linked loans.");
            }
            db.prepare("UPDATE contacts SET name = ?, email = ?, phone = ?, role = ? WHERE id = ?")
              .run(data.name, data.email, data.phone, data.role, data.id);
          } else {
            insertContact(db, { ...data, id: crypto.randomUUID() });
          }
          break;
        }
        case "deleteContact":
          if (db.prepare("SELECT 1 FROM loans WHERE contactId = ? OR partnerId = ?").get(data.id, data.id)) {
            throw new WorkspaceError("This contact is linked to a loan. Update the loan before deleting the contact.");
          }
          db.prepare("DELETE FROM contacts WHERE id = ?").run(data.id);
          break;
        case "loan": {
          const current = data.id ? db.prepare("SELECT stage, stageSince FROM loans WHERE id = ?").get(data.id) : undefined;
          if (data.id && !current) throw new WorkspaceError("This loan no longer exists.");
          if (data.partnerId && !db.prepare("SELECT 1 FROM contacts WHERE id = ? AND role = 'Realtor'").get(data.partnerId)) {
            throw new WorkspaceError("Select an existing realtor.");
          }
          let contactId = data.contactId;
          if (contactId) {
            if (!db.prepare("SELECT 1 FROM contacts WHERE id = ? AND role <> 'Realtor'").get(contactId)) {
              throw new WorkspaceError("Select an existing borrower.");
            }
          } else {
            if (!data.borrower) throw new WorkspaceError("Enter a borrower name or select an existing contact.");
            contactId = crypto.randomUUID();
            insertContact(db, { id: contactId, name: data.borrower, email: "", phone: "", role: "Borrower" });
          }
          const stageSince = current?.stage === data.stage ? String(current.stageSince) : now;
          if (data.id) {
            db.prepare("UPDATE loans SET contactId = ?, partnerId = ?, officer = ?, address = ?, amount = ?, purpose = ?, stage = ?, stageSince = ? WHERE id = ?")
              .run(contactId, data.partnerId, data.officer, data.address, data.amount, data.purpose, data.stage, stageSince, data.id);
          } else {
            insertLoan(db, { ...data, id: crypto.randomUUID(), contactId, stageSince });
          }
          break;
        }
        case "deleteLoan":
          db.prepare("DELETE FROM loans WHERE id = ?").run(data.id);
          break;
        case "move":
          db.prepare("UPDATE loans SET stage = ?, stageSince = ? WHERE id = ? AND stage <> ?").run(data.stage, now, data.id, data.stage);
          break;
        case "note":
          db.prepare("INSERT INTO activity VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), data.loanId, data.text, now);
          break;
        case "submission": {
          const lender = data.lender.toUpperCase() === "UWM" ? "UWM" : data.lender;
          if (data.id && db.prepare("SELECT 1 FROM submissions WHERE id = ? AND syncedAt IS NOT NULL").get(data.id)) {
            throw new WorkspaceError("Synced submissions are managed by the lender connection.");
          }
          if (db.prepare("SELECT 1 FROM submissions WHERE lender = ? AND externalId = ? AND id <> ?").get(lender, data.externalId, data.id ?? "")) {
            throw new WorkspaceError("That lender reference is already linked to a loan.");
          }
          if (data.id) {
            db.prepare("UPDATE submissions SET lender = ?, externalId = ?, status = ? WHERE id = ? AND loanId = ?")
              .run(lender, data.externalId, data.status, data.id, data.loanId);
          } else {
            insertSubmission(db, { ...data, id: crypto.randomUUID(), lender, conditions: [], syncedAt: null });
          }
          break;
        }
        case "deleteSubmission":
          db.prepare("DELETE FROM submissions WHERE id = ? AND syncedAt IS NULL").run(data.id);
          break;
      }
      return { state: workspace(db), message };
    });
  } catch (error) {
    if (error instanceof WorkspaceError) return { error: error.message };
    console.error("Orbit mutation failed", error);
    return { error: "Orbit could not save the change. Please try again." };
  }
}
