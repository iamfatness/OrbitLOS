import { z } from "zod";
import { insertContact, insertLoan, insertSubmission, readWorkspace, savedPricingRun, workspace, type Store } from "./store";
import { activityKinds, stages, type Contact, type Loan, type Purpose, type Workspace } from "./model";
import { sendMockConditionDocument, simulateMockUwmChanges, submitMockApplication, syncUwm, uwmSubmissionConditions } from "./uwm";
import { addApplicationActivity, getApplication, startApplication } from "./applications";
import { mockLockExtensionPeriods, mockLockPeriods, pricingScenario, type PricingOffer } from "./pricing-model";
import { cancelMockLock, extendMockLock, floatMockRate, lockMockRate } from "./uwm-rate-locks";
import { PricingError, pricingProvider } from "./pricing-provider";
import { cleanAnswers, lenderDetailsSchema, lenderQuestions, lenderSupplement } from "./urla";
import { createMilestoneDrafts, recordDraftCopy } from "./communications";
import { draftChannels } from "./communication-templates";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import { accessEvent, isDemoStaff, scopeWorkspace } from "./workspace-access";
import { demoBrokerageId, portalToken, portalTokenPattern } from "./brokerage-model";
import { clearPendingAnniversaries, easternDate, pastClientLoan, retentionInput, synchronizeRetentionTasks } from "./client-retention";
import { documentKinds } from "./document-model";
import { referralMatches } from "./referral-matches";
import { mockAusInput, mockCreditInput, mockRetryInput, runMockCreditAus } from "./mock-credit-aus";

const label = z.string().trim().min(1, "Fill in the required fields.").max(160);
const id = z.string().min(1).max(100);
const lockChange = { loanId: id, lockReference: id, expectedExpiresAt: z.iso.datetime() };
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
    officer: z.string().trim().max(160), assignToSelf: z.boolean().optional(), address: z.string().trim().max(240),
    amount: z.number().int().min(0).max(1_000_000_000),
    purpose: z.enum(["Purchase", "Refinance"]), stage: z.enum(stages),
  }),
  z.object({ type: z.literal("deleteLoan"), id }),
  z.object({ type: z.literal("move"), id, stage: z.enum(stages) }),
  z.object({ type: z.literal("copyDraft"), loanId: id, contactId: id, audience: z.enum(["Borrower", "Realtor"]),
    milestone: z.enum([...stages, "Application received", "Closing complete"]), channel: z.enum(draftChannels) }),
  retentionInput,
  z.object({ type: z.literal("saveClosingTarget"), loanId: id, targetDate: z.iso.date().nullable(), previous: z.iso.date().nullable() }),
  z.object({ type: z.literal("saveClosingItem"), loanId: id, itemId: z.uuid(), revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(120), owner: z.string().trim().min(1).max(120), dueDate: z.iso.date() }),
  z.object({ type: z.literal("completeClosingItem"), loanId: id, itemId: z.uuid(), revision: z.number().int().positive(), completed: z.boolean() }),
  z.object({ type: z.literal("recordClosing"), loanId: id, revision: z.number().int().nonnegative(), closingDate: z.iso.date() }),
  z.object({ type: z.literal("createRealtorPortal"), realtorId: id, officerEmail: z.email().optional() }),
  z.object({ type: z.literal("revokeRealtorPortal"), realtorId: id }),
  z.object({ type: z.literal("convertReferral"), referralId: z.uuid(), contactId: id.nullable(), allowDuplicate: z.boolean().default(false) }),
  z.object({ type: z.literal("dismissReferral"), referralId: z.uuid() }),
  z.object({ type: z.literal("note"), loanId: id, kind: z.enum(activityKinds).default("Note"), text: z.string().trim().min(1, "Write an activity summary first.").max(2000) }),
  z.object({ type: z.literal("submission"), id: id.optional(), loanId: id, lender: label, externalId: label, status: label }),
  z.object({ type: z.literal("deleteSubmission"), id }),
  z.object({ type: z.literal("sync") }),
  z.object({ type: z.literal("simulateUwmChanges") }),
  z.object({ type: z.literal("reviewUwmAlert"), loanId: id, alertId: z.uuid() }),
  z.object({ type: z.literal("startApplication"), loanId: id }),
  z.object({ type: z.literal("revokeApplication"), loanId: id, token: z.string().regex(portalTokenPattern) }),
  z.object({ type: z.literal("refreshApplication"), loanId: id }),
  z.object({ type: z.literal("requestDocument"), loanId: id, kind: z.enum(documentKinds), instructions: z.string().trim().max(500),
    condition: z.object({ submissionId: id, conditionId: z.string().min(1).max(240) }).optional() }),
  z.object({ type: z.literal("reviewDocument"), loanId: id, requestId: z.uuid(), revision: z.number().int().nonnegative(),
    decision: z.enum(["Accepted", "Needs replacement"]), replacementNote: z.string().trim().max(500) }),
  z.object({ type: z.literal("sendConditionDocument"), loanId: id, requestId: z.uuid() }),
  z.object({ type: z.literal("refreshWorkspace") }),
  z.object({ type: z.literal("completeTask"), id, completed: z.boolean() }),
  z.object({ type: z.literal("createTask"), loanId: id, title: z.string().trim().min(1, "Enter a task title.").max(120), days: z.union([z.literal(1), z.literal(3), z.literal(7)]) }),
  z.object({ type: z.literal("runPricing"), loanId: id, scenario: pricingScenario }),
  mockCreditInput,
  mockAusInput,
  mockRetryInput,
  z.object({ type: z.literal("selectOffer"), loanId: id, runId: id, offerId: id }),
  z.object({ type: z.literal("floatMockRate"), loanId: id, submissionId: id, runId: id, offerId: id, previousFloatReference: id.nullable() }),
  z.object({ type: z.literal("lockMockRate"), loanId: id, floatReference: id, days: z.literal(mockLockPeriods) }),
  z.object({ type: z.literal("extendMockLock"), ...lockChange, days: z.literal(mockLockExtensionPeriods) }),
  z.object({ type: z.literal("cancelMockLock"), ...lockChange }),
  z.object({ type: z.literal("publishQuote"), loanId: id, runId: id, offerId: id }),
  z.object({ type: z.literal("withdrawQuote"), loanId: id, publishedAt: z.iso.datetime() }),
  z.object({ type: z.literal("reviewApplication"), loanId: id }),
  z.object({ type: z.literal("saveLenderDetails"), loanId: id, revision: z.number().int().nonnegative(), details: lenderDetailsSchema }),
  z.object({ type: z.literal("sendApplication"), loanId: id }),
]);

class WorkspaceError extends Error {}

function authorizeLoanOfficer(db: Store, data: z.infer<typeof command>, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "LO") return;
  const denied = () => { throw new WorkspaceError("You don’t have access to this workspace action or loan."); };
  const owns = (loanId: unknown) => typeof loanId === "string" && !!db.prepare("SELECT 1 FROM loans WHERE id = ? AND officerEmail = ?").get(loanId, staff.email);
  if (data.type === "contact" || data.type === "deleteContact" || data.type === "deleteLoan" || data.type === "sync" || data.type === "simulateUwmChanges" ||
    data.type === "createRealtorPortal" || data.type === "revokeRealtorPortal") denied();
  if ("loanId" in data && !owns(data.loanId)) denied();
  if (data.type === "move" && !owns(data.id)) denied();
  if (data.type === "completeTask" && !owns(db.prepare("SELECT loanId FROM tasks WHERE id = ?").get(data.id)?.loanId)) denied();
  if (data.type === "deleteSubmission" && !owns(db.prepare("SELECT loanId FROM submissions WHERE id = ?").get(data.id)?.loanId)) denied();
  if (data.type === "submission" && data.id && db.prepare("SELECT loanId FROM submissions WHERE id = ?").get(data.id)?.loanId !== data.loanId) denied();
  if (data.type === "loan") {
    if (data.id && !owns(data.id)) denied();
    for (const contactId of [data.contactId, data.partnerId]) {
      if (contactId && !db.prepare("SELECT 1 FROM loans WHERE officerEmail = ? AND (contactId = ? OR partnerId = ?)").get(staff.email, contactId, contactId)) denied();
    }
  }
}

export async function executeCommand(db: Store, input: unknown, staff: WorkspaceStaff | null = null, referralOwner?: StaffIdentity):
  Promise<{ state: Workspace; message: string; referralLoanId?: string } | { error: string }> {
  const parsed = command.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form and try again." };
  const data = parsed.data;
  try {
    authorizeLoanOfficer(db, data, staff);
    if (data.type === "sync" || data.type === "simulateUwmChanges") {
      const result = data.type === "sync" ? await syncUwm(db) : simulateMockUwmChanges(db);
      if ("error" in result) throw new WorkspaceError(result.error);
      return { state: scopeWorkspace(readWorkspace(db), staff),
        message: `UWM sync complete · ${result.imported} imported · ${result.updated} refreshed · ${result.conditions} conditions · ${result.alerts} new alerts` };
    }
    if (data.type === "runPricing") {
      if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
      const result = await pricingProvider(isDemoStaff(staff) ? process.env : {}).quote(data.scenario);
      return db.transaction(() => {
        authorizeLoanOfficer(db, data, staff);
        db.prepare("INSERT INTO pricing_runs (id, loanId, provider, mode, reference, scenario, offers, notices, quotedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(crypto.randomUUID(), data.loanId, result.provider, result.mode, result.reference,
            JSON.stringify(data.scenario), JSON.stringify(result.offers), JSON.stringify(result.notices), new Date().toISOString());
        return { state: scopeWorkspace(workspace(db), staff), message: `${result.offers.length} pricing options returned.` };
      });
    }
    const now = new Date().toISOString();
    return db.transaction(() => {
      let message = data.type.startsWith("delete") ? "Removed successfully." : "Saved successfully.";
      let referralLoanId: string | undefined;
      switch (data.type) {
        case "reviewUwmAlert": {
          const alert = db.prepare("SELECT reviewedAt FROM uwm_alerts WHERE id = ? AND loanId = ?").get(data.alertId, data.loanId);
          if (!alert) throw new WorkspaceError("This alert is unavailable on the loan.");
          if (!alert.reviewedAt) db.prepare("UPDATE uwm_alerts SET reviewedAt = ? WHERE id = ?").run(now, data.alertId);
          message = "UWM alert marked reviewed.";
          break;
        }
        case "runMockCredit":
        case "runMockAus":
        case "retryMockCreditAus": {
          const result = runMockCreditAus(db, data, staff, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "saveRetention": {
          const loan = db.prepare("SELECT stage FROM loans WHERE id = ?").get(data.loanId);
          if (!loan || !pastClientLoan({ stage: loan.stage as Loan["stage"] })) throw new WorkspaceError("Choose a funded or closed loan for past-client follow-up.");
          if (data.closingDate && data.closingDate > easternDate()) throw new WorkspaceError("Enter the actual closing date on or before today.");
          const previous = db.prepare("SELECT revision, closingDate, observedRate, checkedAt FROM past_client_profiles WHERE loanId = ?").get(data.loanId);
          if (Number(previous?.revision ?? 0) !== data.revision) throw new WorkspaceError("Past-client details changed. Refresh before saving.");
          if (previous?.closingDate !== (data.closingDate || null)) {
            clearPendingAnniversaries(db, data.loanId);
          }
          const observedRate = data.observedRate ? Number(data.observedRate) : null;
          const checkedAt = observedRate === null ? null : observedRate === previous?.observedRate ? previous.checkedAt : now;
          db.prepare(`INSERT INTO past_client_profiles
            (loanId, closingDate, currentRate, targetRate, observedRate, checkedAt, watchEnabled, note, revision)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(loanId) DO UPDATE SET closingDate = excluded.closingDate, currentRate = excluded.currentRate,
              targetRate = excluded.targetRate, observedRate = excluded.observedRate, checkedAt = excluded.checkedAt,
              watchEnabled = excluded.watchEnabled, note = excluded.note, revision = excluded.revision`)
            .run(data.loanId, data.closingDate || null, data.currentRate ? Number(data.currentRate) : null,
              data.targetRate ? Number(data.targetRate) : null, observedRate,
              checkedAt, data.watchEnabled ? 1 : 0, data.note, data.revision + 1);
          addApplicationActivity(db, data.loanId, "Past-client follow-up details updated.", now);
          message = "Past-client details and reminders saved.";
          break;
        }
        case "saveClosingTarget": {
          if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
          const current = db.prepare("SELECT targetDate FROM closing_plans WHERE loanId = ?").get(data.loanId)?.targetDate ?? null;
          if (current !== data.targetDate) {
            if (current !== data.previous) throw new WorkspaceError("The target closing date changed. Refresh the loan before saving.");
            if (data.targetDate) {
              db.prepare(`INSERT INTO closing_plans (loanId, targetDate) VALUES (?, ?)
                ON CONFLICT(loanId) DO UPDATE SET targetDate = excluded.targetDate`).run(data.loanId, data.targetDate);
            } else db.prepare("DELETE FROM closing_plans WHERE loanId = ?").run(data.loanId);
            addApplicationActivity(db, data.loanId, data.targetDate ? `Target closing date set · ${data.targetDate}` : "Target closing date cleared.", now);
          }
          message = "Target closing date saved.";
          break;
        }
        case "saveClosingItem": {
          if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
          const item = db.prepare("SELECT loanId, revision, title, owner, dueDate FROM closing_items WHERE id = ?").get(data.itemId);
          if (item && item.loanId !== data.loanId) throw new WorkspaceError("This closing item is unavailable on the loan.");
          if (!item || item.title !== data.title || item.owner !== data.owner || item.dueDate !== data.dueDate) {
            if (Number(item?.revision ?? 0) !== data.revision) throw new WorkspaceError("This closing item changed. Refresh the loan before saving.");
            db.prepare(`INSERT INTO closing_items (id, loanId, title, owner, dueDate) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET title = excluded.title, owner = excluded.owner, dueDate = excluded.dueDate, revision = revision + 1`)
              .run(data.itemId, data.loanId, data.title, data.owner, data.dueDate);
            addApplicationActivity(db, data.loanId, `${item ? "Updated closing item" : "Added closing item"} · ${data.title}`, now);
          }
          message = "Closing checklist item saved.";
          break;
        }
        case "completeClosingItem": {
          const item = db.prepare("SELECT title, completedAt, revision FROM closing_items WHERE id = ? AND loanId = ?").get(data.itemId, data.loanId);
          if (!item) throw new WorkspaceError("This closing item is unavailable on the loan.");
          if (Boolean(item.completedAt) !== data.completed) {
            if (item.revision !== data.revision) throw new WorkspaceError("This closing item changed. Refresh the loan before updating it.");
            db.prepare("UPDATE closing_items SET completedAt = ?, revision = revision + 1 WHERE id = ?")
              .run(data.completed ? now : null, data.itemId);
            addApplicationActivity(db, data.loanId, `${data.completed ? "Completed closing item" : "Reopened closing item"} · ${item.title}`, now);
          }
          message = data.completed ? "Closing item completed." : "Closing item reopened.";
          break;
        }
        case "recordClosing": {
          if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
          if (data.closingDate > easternDate(new Date(now))) throw new WorkspaceError("Enter the actual closing date on or before today.");
          const profile = db.prepare("SELECT closingDate, revision FROM past_client_profiles WHERE loanId = ?").get(data.loanId);
          if (profile?.closingDate !== data.closingDate) {
            if (Number(profile?.revision ?? 0) !== data.revision) throw new WorkspaceError("The closing date changed. Refresh the loan before recording it.");
            clearPendingAnniversaries(db, data.loanId);
            db.prepare(`INSERT INTO past_client_profiles (loanId, closingDate, revision) VALUES (?, ?, 1)
              ON CONFLICT(loanId) DO UPDATE SET closingDate = excluded.closingDate, revision = revision + 1`).run(data.loanId, data.closingDate);
            addApplicationActivity(db, data.loanId, `Closing recorded · ${data.closingDate}`, now);
          }
          createMilestoneDrafts(db, data.loanId, "Closing complete", now);
          message = "Closing recorded. Milestone drafts are ready to preview.";
          break;
        }
        case "createRealtorPortal": {
          if (!db.prepare("SELECT 1 FROM contacts WHERE id = ? AND role = 'Realtor'").get(data.realtorId)) throw new WorkspaceError("Choose a realtor contact.");
          const owner = referralOwner ?? staff;
          if (data.officerEmail && owner?.email !== data.officerEmail) throw new WorkspaceError("Select an active staff member in this brokerage.");
          const token = portalToken(staff?.brokerage.id);
          const expiresAt = new Date(Date.parse(now) + 7 * 86_400_000).toISOString();
          db.prepare(`INSERT INTO realtor_portals (realtorId, token, expiresAt, officer, officerEmail) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(realtorId) DO UPDATE SET token = excluded.token, expiresAt = excluded.expiresAt,
              officer = excluded.officer, officerEmail = excluded.officerEmail`)
            .run(data.realtorId, token, expiresAt, owner?.name.slice(0, 160) || "Alex Morgan", owner?.email ?? null);
          accessEvent(db, staff, "Issued realtor link", data.realtorId, now);
          message = "Realtor referral link is ready. It expires in seven days.";
          break;
        }
        case "revokeRealtorPortal":
          if (db.prepare("SELECT 1 FROM realtor_portals WHERE realtorId = ?").get(data.realtorId)) accessEvent(db, staff, "Revoked realtor link", data.realtorId, now);
          db.prepare("DELETE FROM realtor_portals WHERE realtorId = ?").run(data.realtorId);
          message = "Realtor referral link revoked.";
          break;
        case "convertReferral":
        case "dismissReferral": {
          const lead = db.prepare("SELECT * FROM referral_leads WHERE id = ?").get(data.referralId);
          const limited = staff?.brokerage.role === "LO";
          if (!lead || (limited && lead.officerEmail !== staff.email)) throw new WorkspaceError("This referral is unavailable.");
          if (data.type === "dismissReferral") {
            if (lead.loanId) throw new WorkspaceError("This referral has already been converted.");
            db.prepare("UPDATE referral_leads SET resolvedAt = ? WHERE id = ? AND resolvedAt IS NULL").run(now, data.referralId);
            if (!lead.resolvedAt) accessEvent(db, staff, "Dismissed referral", data.referralId, now);
            message = "Referral dismissed.";
            break;
          }
          if (lead.resolvedAt) {
            const owner = db.prepare("SELECT officerEmail FROM loans WHERE id = ?").get(lead.loanId);
            if (!owner || (limited && owner.officerEmail !== staff.email)) throw new WorkspaceError("This referral has already been closed.");
            referralLoanId = String(lead.loanId);
            message = "The referral’s 1003 is already on the loan.";
            break;
          }
          const email = String(lead.email);
          const phone = String(lead.phone);
          const contacts = db.prepare("SELECT * FROM contacts WHERE role <> 'Realtor'").all().map((row) => ({
            id: String(row.id), name: String(row.name), email: String(row.email), phone: String(row.phone), role: row.role as Contact["role"],
          }));
          const matches = referralMatches({ email, phone }, contacts);
          const canUse = (id: string) => !limited || !!db.prepare("SELECT 1 FROM loans WHERE contactId = ? AND officerEmail = ?").get(id, staff.email);
          let contact = contacts.find((item) => item.id === data.contactId);
          if (data.contactId && (!contact || !canUse(data.contactId) || !matches.some((match) => match.id === data.contactId))) {
            throw new WorkspaceError("That contact match is unavailable. Refresh tasks and review the referral again.");
          }
          if (!contact) {
            if (matches.some((match) => !canUse(match.id))) throw new WorkspaceError("A possible match is outside your assigned loans. Ask a brokerage admin to review this referral.");
            if (matches.length && !data.allowDuplicate) throw new WorkspaceError("A possible contact match exists. Refresh tasks and choose how to handle it.");
            contact = { id: crypto.randomUUID(), name: String(lead.name), email, phone, role: "Borrower" };
            insertContact(db, contact);
          }
          const loanId = crypto.randomUUID();
          insertLoan(db, { id: loanId, contactId: contact.id, partnerId: String(lead.realtorId), officer: staff?.name.slice(0, 160) || "Alex Morgan",
            officerEmail: staff?.email ?? null, address: "", amount: 0, purpose: lead.purpose as Purpose, stage: "Lead", stageSince: now });
          if (!startApplication(db, loanId, now, staff?.brokerage.id, contact)) throw new WorkspaceError("Orbit could not create the borrower link.");
          db.prepare("UPDATE referral_leads SET resolvedAt = ?, loanId = ? WHERE id = ?").run(now, loanId, data.referralId);
          addApplicationActivity(db, loanId, "Converted realtor referral to a loan with a prefilled 1003.", now);
          accessEvent(db, staff, "Converted referral", data.referralId, now);
          referralLoanId = loanId;
          message = "Referral converted. The prefilled 1003 is ready to share.";
          break;
        }
        case "startApplication": {
          const before = getApplication(db, data.loanId);
          if (!startApplication(db, data.loanId, now, staff?.brokerage.id)) throw new WorkspaceError("This loan no longer exists.");
          if (!before || before.revokedAt || before.expiresAt <= now) accessEvent(db, staff, before ? "Replaced borrower link" : "Issued borrower link", data.loanId, now);
          message = "Demo application link is ready.";
          break;
        }
        case "revokeApplication": {
          const application = getApplication(db, data.loanId);
          if (!application || application.token !== data.token) throw new WorkspaceError("The borrower link changed. Refresh before revoking it.");
          if (!application.revokedAt) {
            db.prepare("UPDATE applications SET revokedAt = ? WHERE loanId = ?").run(now, data.loanId);
            accessEvent(db, staff, "Revoked borrower link", data.loanId, now);
          }
          message = "Borrower link revoked.";
          break;
        }
        case "refreshApplication":
          message = "Application and checklist refreshed.";
          break;
        case "requestDocument": {
          const source = data.condition;
          if (source) {
            const conditions = uwmSubmissionConditions(db, data.loanId, source.submissionId);
            if (!conditions) throw new WorkspaceError("This UWM submission is unavailable on this loan.");
            if (db.prepare("SELECT 1 FROM document_requests WHERE submissionId = ? AND conditionId = ?").get(source.submissionId, source.conditionId)) {
              message = "This UWM condition already has a checklist request.";
              break;
            }
            if (!conditions.some((item) => item.id === source.conditionId && !item.satisfiedAt)) {
              throw new WorkspaceError("This UWM condition is no longer outstanding. Refresh the loan to see its status.");
            }
            if (!data.instructions) throw new WorkspaceError("Enter instructions for the borrower.");
          } else {
            if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
            if (db.prepare("SELECT 1 FROM document_requests WHERE loanId = ? AND kind = ? AND conditionId IS NULL").get(data.loanId, data.kind)) {
              throw new WorkspaceError("This document is already on the checklist. Refresh the loan to see its status.");
            }
          }
          db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, submissionId, conditionId)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(crypto.randomUUID(), data.loanId, data.kind, data.instructions, now, source?.submissionId ?? null, source?.conditionId ?? null);
          addApplicationActivity(db, data.loanId, `Document requested · ${data.kind}${source ? " · UWM condition" : ""}`, now);
          message = source ? "UWM condition linked to the borrower checklist." : "Document added to the borrower checklist.";
          break;
        }
        case "reviewDocument": {
          const request = db.prepare("SELECT kind, status, revision FROM document_requests WHERE id = ? AND loanId = ?")
            .get(data.requestId, data.loanId);
          if (request?.status !== "Received" || request.revision !== data.revision) {
            throw new WorkspaceError("This document request changed. Refresh the checklist before reviewing it.");
          }
          if (data.decision === "Needs replacement" && !data.replacementNote) throw new WorkspaceError("Tell the borrower what to replace.");
          db.prepare("UPDATE document_requests SET status = ?, replacementNote = ?, revision = revision + 1 WHERE id = ?")
            .run(data.decision, data.decision === "Accepted" ? "" : data.replacementNote, data.requestId);
          const pdf = db.prepare("SELECT objectId FROM document_files WHERE requestId = ?").get(data.requestId)?.objectId;
          const accepted = pdf ? (staff?.brokerage.id === demoBrokerageId ? "Demo PDF accepted" : "Borrower PDF accepted") : "Sample document accepted";
          addApplicationActivity(db, data.loanId, `${data.decision === "Accepted" ? accepted : "Replacement requested"} · ${request.kind}`, now);
          message = data.decision === "Accepted" ? "Document accepted." : "Replacement requested on the borrower checklist.";
          break;
        }
        case "sendConditionDocument": {
          const result = sendMockConditionDocument(db, data.loanId, data.requestId, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = `Mock UWM document receipt · ${result.receipt}`;
          break;
        }
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
          const lastSaved = savedPricingRun(db, data.loanId);
          if (lastSaved?.id !== data.runId || lastSaved.selectedId !== offer.id) {
            db.prepare("UPDATE pricing_runs SET selectedId = ?, selectedAt = ? WHERE id = ?").run(offer.id, now, data.runId);
            addApplicationActivity(db, data.loanId, `Saved ${run.mode === "mock" ? "sample" : "stage"} quote · ${offer.product} at ${offer.rate.toFixed(3)}%`, now);
          }
          message = "Quote saved on the loan.";
          break;
        }
        case "floatMockRate":
        case "lockMockRate": {
          const result = data.type === "floatMockRate" ? floatMockRate(db, data, now) : lockMockRate(db, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "extendMockLock":
        case "cancelMockLock": {
          const result = data.type === "extendMockLock" ? extendMockLock(db, data, now) : cancelMockLock(db, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "publishQuote": {
          if (!getApplication(db, data.loanId)?.submittedAt) throw new WorkspaceError("The borrower must submit their 1003 before you can share a quote.");
          const run = savedPricingRun(db, data.loanId);
          if (run?.id !== data.runId || run.selectedId !== data.offerId || run.mode !== "mock") {
            throw new WorkspaceError("Select the current saved sample quote before sharing it.");
          }
          const offer = (JSON.parse(String(run.offers)) as PricingOffer[]).find((item) => item.id === data.offerId);
          if (!offer) throw new WorkspaceError("This sample quote is unavailable.");
          const previous = db.prepare("SELECT runId, offerId FROM published_quotes WHERE loanId = ?").get(data.loanId);
          if (previous?.runId !== data.runId || previous.offerId !== data.offerId) {
            db.prepare(`INSERT INTO published_quotes (loanId, runId, offerId, product, rate, principalAndInterest, quotedAt, publishedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(loanId) DO UPDATE SET runId = excluded.runId, offerId = excluded.offerId,
              product = excluded.product, rate = excluded.rate, principalAndInterest = excluded.principalAndInterest,
              quotedAt = excluded.quotedAt, publishedAt = excluded.publishedAt`)
              .run(data.loanId, data.runId, offer.id, offer.product, offer.rate, offer.principalAndInterest, run.quotedAt, now);
            addApplicationActivity(db, data.loanId, "Sample quote published to borrower status.", now);
          }
          message = "Sample quote published to borrower status.";
          break;
        }
        case "withdrawQuote": {
          const previous = db.prepare("SELECT publishedAt FROM published_quotes WHERE loanId = ?").get(data.loanId);
          if (previous && previous.publishedAt !== data.publishedAt) throw new WorkspaceError("The shared quote changed. Refresh before removing it.");
          if (previous) {
            db.prepare("DELETE FROM published_quotes WHERE loanId = ?").run(data.loanId);
            addApplicationActivity(db, data.loanId, "Sample quote removed from borrower status.", now);
          }
          message = "Sample quote removed from borrower status.";
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
            if (linkedAs.some((row) => data.role === "Realtor" ? row.contactId === data.id : row.partnerId === data.id) ||
              (data.role !== "Realtor" && db.prepare("SELECT 1 FROM referral_leads WHERE realtorId = ? AND resolvedAt IS NULL").get(data.id))) {
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
          if (db.prepare("SELECT 1 FROM referral_leads WHERE realtorId = ? AND resolvedAt IS NULL").get(data.id)) {
            throw new WorkspaceError("Review this realtor’s open referrals before deleting the contact.");
          }
          if (db.prepare("SELECT 1 FROM loans WHERE contactId = ? OR partnerId = ?").get(data.id, data.id)) {
            throw new WorkspaceError("This contact is linked to a loan. Update the loan before deleting the contact.");
          }
          db.prepare("DELETE FROM contacts WHERE id = ?").run(data.id);
          break;
        case "loan": {
          const current = data.id ? db.prepare("SELECT contactId, stage, stageSince, officer, officerEmail FROM loans WHERE id = ?").get(data.id) : undefined;
          if (data.id && !current) throw new WorkspaceError("This loan no longer exists.");
          if (data.id && current?.contactId !== data.contactId && getApplication(db, data.id)) {
            throw new WorkspaceError("This loan’s 1003 link belongs to its current borrower. Create a separate loan for another borrower.");
          }
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
          if (data.assignToSelf && !staff) throw new WorkspaceError("Sign in to assign this loan to your account.");
          const managed = !isDemoStaff(staff) || staff?.brokerage.role === "LO";
          const owner = (managed ? !current : data.assignToSelf) ? staff : null;
          const officer = owner?.name.slice(0, 160) ?? (managed && current ? String(current.officer) : data.officer);
          const unlinkSelf = data.assignToSelf === false && staff?.email === current?.officerEmail;
          const keepOwner = !unlinkSelf && data.officer === current?.officer && typeof current.officerEmail === "string";
          const officerEmail = owner?.email ?? (managed && current ? current.officerEmail as string | null : keepOwner ? String(current.officerEmail) : null);
          const stageSince = current?.stage === data.stage ? String(current.stageSince) : now;
          const loanId = data.id ?? crypto.randomUUID();
          if (data.id) {
            db.prepare("UPDATE loans SET contactId = ?, partnerId = ?, officer = ?, officerEmail = ?, address = ?, amount = ?, purpose = ?, stage = ?, stageSince = ? WHERE id = ?")
              .run(contactId, data.partnerId, officer, officerEmail, data.address, data.amount, data.purpose, data.stage, stageSince, loanId);
            if ((current?.officerEmail ?? null) !== officerEmail) accessEvent(db, staff, "Changed loan owner", `${loanId} · ${officerEmail ?? "Unassigned"}`, now);
          } else {
            insertLoan(db, { ...data, id: loanId, officer, officerEmail, contactId, stageSince });
          }
          if (current?.stage !== data.stage && (current || data.stage !== "Lead")) createMilestoneDrafts(db, loanId, data.stage, now);
          break;
        }
        case "deleteLoan":
          db.prepare("DELETE FROM loans WHERE id = ?").run(data.id);
          break;
        case "move": {
          const loan = db.prepare("SELECT stage FROM loans WHERE id = ?").get(data.id);
          if (!loan) throw new WorkspaceError("This loan no longer exists.");
          if (loan.stage !== data.stage) {
            db.prepare("UPDATE loans SET stage = ?, stageSince = ? WHERE id = ?").run(data.stage, now, data.id);
            createMilestoneDrafts(db, data.id, data.stage, now);
          }
          break;
        }
        case "copyDraft":
          if (!recordDraftCopy(db, data, now)) throw new WorkspaceError("This draft or recipient has changed. Refresh the loan before copying again.");
          message = "Draft copy recorded.";
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
      synchronizeRetentionTasks(db);
      return { state: scopeWorkspace(workspace(db), staff), message, referralLoanId };
    });
  } catch (error) {
    if (error instanceof WorkspaceError || error instanceof PricingError) return { error: error.message };
    if (data.type === "runPricing") return { error: "Pricing could not be completed. Try again." };
    console.error("Orbit mutation failed", error);
    return { error: "Orbit could not save the change. Please try again." };
  }
}
