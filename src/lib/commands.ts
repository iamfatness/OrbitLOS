import { z } from "zod";
import { insertContact, insertLoan, insertSubmission, workspace, type Store } from "./store";
import { activityKinds, stages, type Workspace } from "./model";
import { submitMockApplication, syncUwm } from "./uwm";
import { addApplicationActivity, getApplication, startApplication } from "./applications";
import { pricingScenario, type PricingOffer } from "./pricing-model";
import { PricingError, pricingProvider } from "./pricing-provider";
import { cleanAnswers, lenderDetailsSchema, lenderQuestions, lenderSupplement } from "./urla";

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
  z.object({ type: z.literal("note"), loanId: id, kind: z.enum(activityKinds).default("Note"), text: z.string().trim().min(1, "Write an activity summary first.").max(2000) }),
  z.object({ type: z.literal("submission"), id: id.optional(), loanId: id, lender: label, externalId: label, status: label }),
  z.object({ type: z.literal("deleteSubmission"), id }),
  z.object({ type: z.literal("sync") }),
  z.object({ type: z.literal("startApplication"), loanId: id }),
  z.object({ type: z.literal("refreshApplication"), loanId: id }),
  z.object({ type: z.literal("refreshWorkspace") }),
  z.object({ type: z.literal("completeTask"), id, completed: z.boolean() }),
  z.object({ type: z.literal("createTask"), loanId: id, title: z.string().trim().min(1, "Enter a task title.").max(120), days: z.union([z.literal(1), z.literal(3), z.literal(7)]) }),
  z.object({ type: z.literal("runPricing"), loanId: id, scenario: pricingScenario }),
  z.object({ type: z.literal("selectOffer"), loanId: id, runId: id, offerId: id }),
  z.object({ type: z.literal("reviewApplication"), loanId: id }),
  z.object({ type: z.literal("saveLenderDetails"), loanId: id, revision: z.number().int().nonnegative(), details: lenderDetailsSchema }),
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
    if (data.type === "runPricing") {
      if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
      const result = await pricingProvider().quote(data.scenario);
      return db.transaction(() => {
        db.prepare("INSERT INTO pricing_runs (id, loanId, provider, mode, reference, scenario, offers, notices, quotedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(crypto.randomUUID(), data.loanId, result.provider, result.mode, result.reference,
            JSON.stringify(data.scenario), JSON.stringify(result.offers), JSON.stringify(result.notices), new Date().toISOString());
        return { state: workspace(db), message: `${result.offers.length} pricing options returned.` };
      });
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
          const task = db.prepare("SELECT loanId, title, completedAt FROM tasks WHERE id = ?").get(data.id);
          if (!task) throw new WorkspaceError("This task no longer exists.");
          message = data.completed ? "Task completed." : "Task reopened.";
          if (data.completed !== Boolean(task.completedAt)) {
            db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ?").run(data.completed ? now : null, data.id);
            addApplicationActivity(db, String(task.loanId), `${data.completed ? "Completed task" : "Reopened task"} · ${task.title}`, now);
          }
          break;
        }
        case "createTask":
          db.prepare("INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, ?, ?)")
            .run(crypto.randomUUID(), data.loanId, data.title, new Date(Date.parse(now) + data.days * 86_400_000).toISOString());
          message = "Follow-up task added.";
          break;
        case "selectOffer": {
          const run = db.prepare("SELECT offers, selectedId, mode FROM pricing_runs WHERE id = ? AND loanId = ?").get(data.runId, data.loanId);
          const offer = run && (JSON.parse(String(run.offers)) as PricingOffer[]).find((item) => item.id === data.offerId);
          if (!run || !offer) throw new WorkspaceError("That pricing option is unavailable. Refresh the loan and try again.");
          const lastSaved = db.prepare("SELECT id, selectedId FROM pricing_runs WHERE loanId = ? AND selectedId IS NOT NULL ORDER BY selectedAt DESC, rowid DESC LIMIT 1").get(data.loanId);
          if (lastSaved?.id !== data.runId || lastSaved.selectedId !== offer.id) {
            db.prepare("UPDATE pricing_runs SET selectedId = ?, selectedAt = ? WHERE id = ?").run(offer.id, now, data.runId);
            addApplicationActivity(db, data.loanId, `Saved ${run.mode === "mock" ? "sample" : "stage"} quote · ${offer.product} at ${offer.rate.toFixed(3)}%`, now);
          }
          message = "Quote saved on the loan.";
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
        case "saveLenderDetails": {
          const application = getApplication(db, data.loanId);
          if (!application) throw new WorkspaceError("Start an application before saving lender details.");
          const existing = db.prepare("SELECT revision FROM application_lender_details WHERE loanId = ?").get(data.loanId);
          if (Number(existing?.revision ?? 0) !== data.revision) throw new WorkspaceError("Lender details changed. Refresh the application before saving.");
          const originator = cleanAnswers(lenderQuestions, data.details.originator);
          const supplement = cleanAnswers(lenderSupplement, data.details.supplement);
          db.prepare(`INSERT INTO application_lender_details (loanId, details, revision) VALUES (?, ?, ?)
            ON CONFLICT(loanId) DO UPDATE SET details = excluded.details, revision = excluded.revision`)
            .run(data.loanId, JSON.stringify({ originator: originator.answers, supplement: supplement.answers }), data.revision + 1);
          message = "Lender details saved.";
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
          db.prepare("INSERT INTO activity (id, loanId, text, createdAt, kind) VALUES (?, ?, ?, ?, ?)")
            .run(crypto.randomUUID(), data.loanId, data.text, now, data.kind);
          message = `${data.kind} logged.`;
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
    if (error instanceof WorkspaceError || error instanceof PricingError) return { error: error.message };
    if (data.type === "runPricing") return { error: "Pricing could not be completed. Try again." };
    console.error("Orbit mutation failed", error);
    return { error: "Orbit could not save the change. Please try again." };
  }
}
