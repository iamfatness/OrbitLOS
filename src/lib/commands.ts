import { z } from "zod";
import { insertContact, insertLoan, insertSubmission, readWorkspace, savedPricingRun, workspace, type Store } from "./store";
import { activityKinds, contactOutcomes, disclosureStatuses, dispositions, draftMilestones, leadSources, stages, type Condition, type Contact, type Loan, type Purpose, type Workspace } from "./model";
import { refreshMockUwmClearance, sendMockConditionDocument, simulateMockUwmChanges, submitMockApplication, syncUwm, uwmSubmissionConditions } from "./uwm";
import { addApplicationActivity, getApplication, saveApplicationVersion, startApplication } from "./applications";
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
import { checklistInstructions, checklistPresetNames, checklistPresets, documentKinds } from "./document-model";
import { referralMatches } from "./referral-matches";
import { mockAusInput, mockCreditInput, mockRetryInput, runMockCreditAus } from "./mock-credit-aus";
import { trackPilotBorrower } from "./pilot";
import { contactDuplicate, contactImportLimit, contactImportRow } from "./contact-csv";

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
  z.object({ type: z.literal("importContacts"), batchId: z.uuid(), rows: z.array(contactImportRow).min(1).max(contactImportLimit) }),
  z.object({
    type: z.literal("loan"), id: id.optional(), contactId: z.union([id, z.literal("")]),
    borrower: z.string().trim().max(160), partnerId: id.nullable(),
    borrowerEmail: z.union([z.email().max(160), z.literal("")]).optional(), borrowerPhone: z.string().trim().max(40).optional(),
    start1003: z.boolean().optional(),
    officer: z.string().trim().max(160), assignToSelf: z.boolean().optional(), address: z.string().trim().max(240),
    amount: z.number().int().min(0).max(1_000_000_000),
    purpose: z.enum(["Purchase", "Refinance"]), stage: z.enum(stages),
    leadSource: z.enum(leadSources).optional(),
  }),
  z.object({ type: z.literal("deleteLoan"), id }),
  z.object({ type: z.literal("move"), id, stage: z.enum(stages) }),
  z.object({ type: z.literal("loanDisposition"), loanId: id, disposition: z.enum(dispositions),
    reason: z.string().trim().max(500), revisitDate: z.iso.date().nullable(), revision: z.number().int().nonnegative() }),
  z.object({ type: z.literal("copyDraft"), loanId: id, contactId: id, audience: z.enum(["Borrower", "Realtor"]),
    milestone: z.enum([...stages, "Application received", "Closing complete"]), channel: z.enum(draftChannels) }),
  retentionInput,
  z.object({ type: z.literal("saveClosingTarget"), loanId: id, targetDate: z.iso.date().nullable(), previous: z.iso.date().nullable() }),
  z.object({ type: z.literal("saveClosingItem"), loanId: id, itemId: id, revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(120), owner: z.string().trim().min(1).max(120), dueDate: z.iso.date() }),
  z.object({ type: z.literal("completeClosingItem"), loanId: id, itemId: id, revision: z.number().int().positive(), completed: z.boolean() }),
  z.object({ type: z.literal("recordClosing"), loanId: id, revision: z.number().int().nonnegative(), closingDate: z.iso.date() }),
  z.object({ type: z.literal("recordFunding"), loanId: id, revision: z.number().int().nonnegative(), fundingDate: z.iso.date() }),
  z.object({ type: z.literal("saveDisclosureStatus"), loanId: id, revision: z.number().int().nonnegative(),
    status: z.enum(disclosureStatuses), date: z.iso.date().nullable() }),
  z.object({ type: z.literal("prepareClosingHandoff"), loanId: id, dueDate: z.iso.date() }),
  z.object({ type: z.literal("createRealtorPortal"), realtorId: id, officerEmail: z.email().optional() }),
  z.object({ type: z.literal("revokeRealtorPortal"), realtorId: id }),
  z.object({ type: z.literal("convertReferral"), referralId: z.uuid(), contactId: id.nullable(), allowDuplicate: z.boolean().default(false) }),
  z.object({ type: z.literal("dismissReferral"), referralId: z.uuid() }),
  z.object({ type: z.literal("note"), loanId: id, kind: z.enum(activityKinds).default("Note"), text: z.string().trim().min(1, "Write an activity summary first.").max(2000),
    eventId: z.uuid().optional(), outcome: z.enum(contactOutcomes).optional(), followUp: z.iso.date().optional() }),
  z.object({ type: z.literal("saveBrokerageTemplate"), audience: z.enum(["Borrower", "Realtor"]), milestone: z.enum(draftMilestones),
    body: z.string().trim().max(800), revision: z.number().int().nonnegative() }),
  z.object({ type: z.literal("submission"), id: id.optional(), loanId: id, lender: label, externalId: label, status: label }),
  z.object({ type: z.literal("saveManualCondition"), loanId: id, submissionId: id, conditionId: z.uuid(),
    revision: z.number().int().nonnegative(), category: label, owner: label, description: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal("recordManualDelivery"), loanId: id, submissionId: id, conditionId: z.uuid(),
    revision: z.number().int().positive(), documentRevision: z.number().int().nonnegative(), reference: label }),
  z.object({ type: z.literal("recordManualClearance"), loanId: id, submissionId: id, conditionId: z.uuid(),
    revision: z.number().int().positive(), cleared: z.boolean(), confirmation: label }),
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
  z.object({ type: z.literal("applyDocumentPreset"), loanId: id, preset: z.enum(checklistPresetNames) }),
  z.object({ type: z.literal("recordManualHandoff"), loanId: id, eventId: z.uuid(), revision: z.number().int().nonnegative(),
    outcome: z.enum(["Prepared", "Delivered manually", "Acknowledged", "Returned for changes"]), note: z.string().trim().max(500) }),
  z.object({ type: z.literal("sendConditionDocument"), loanId: id, requestId: z.uuid() }),
  z.object({ type: z.literal("simulateDeliveryFailure"), loanId: id, requestId: z.uuid(), revision: z.number().int().nonnegative() }),
  z.object({ type: z.literal("refreshMockUwmClearance"), loanId: id, submissionId: id }),
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
  z.object({ type: z.literal("reviewApplication"), loanId: id, revision: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("requestApplicationCorrection"), loanId: id, revision: z.number().int().nonnegative(),
    note: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal("saveLenderDetails"), loanId: id, revision: z.number().int().nonnegative(), details: lenderDetailsSchema }),
  z.object({ type: z.literal("sendApplication"), loanId: id }),
]);

class WorkspaceError extends Error {}

function authorizeLoanOfficer(db: Store, data: z.infer<typeof command>, staff: WorkspaceStaff | null) {
  if (!staff || staff.brokerage.role === "Admin") return;
  const denied = () => { throw new WorkspaceError("You don’t have access to this workspace action or loan."); };
  const owns = (loanId: unknown) => typeof loanId === "string" && !!db.prepare("SELECT 1 FROM loans WHERE id = ? AND officerEmail = ?").get(loanId, staff.email);
  if (data.type === "contact" || data.type === "deleteContact" || data.type === "deleteLoan" || data.type === "sync" || data.type === "simulateUwmChanges" || data.type === "saveBrokerageTemplate" ||
    data.type === "createRealtorPortal" || data.type === "revokeRealtorPortal") denied();
  if (staff.brokerage.role === "Processor") {
    const permitted = ["refreshWorkspace", "refreshApplication", "reviewApplication", "requestApplicationCorrection",
      "saveLenderDetails", "requestDocument", "applyDocumentPreset", "reviewDocument", "sendConditionDocument", "simulateDeliveryFailure",
      "refreshMockUwmClearance", "reviewUwmAlert", "createTask", "completeTask", "note", "copyDraft",
      "recordManualHandoff", "submission", "saveClosingTarget", "saveClosingItem", "completeClosingItem", "recordClosing",
      "recordFunding", "saveDisclosureStatus", "prepareClosingHandoff", "saveManualCondition", "recordManualDelivery", "recordManualClearance"];
    if (!permitted.includes(data.type)) denied();
  }
  if ("loanId" in data && !owns(data.loanId)) denied();
  if (data.type === "move" && !owns(data.id)) denied();
  if (data.type === "completeTask" && !owns(db.prepare("SELECT loanId FROM tasks WHERE id = ?").get(data.id)?.loanId)) denied();
  if (data.type === "deleteSubmission" && !owns(db.prepare("SELECT loanId FROM submissions WHERE id = ?").get(data.id)?.loanId)) denied();
  if (data.type === "submission" && data.id && db.prepare("SELECT loanId FROM submissions WHERE id = ?").get(data.id)?.loanId !== data.loanId) denied();
  if (data.type === "loan") {
    if (data.id && !owns(data.id)) denied();
    for (const contactId of [data.contactId, data.partnerId]) {
      if (contactId && !db.prepare("SELECT 1 FROM loans WHERE officerEmail = ? AND (contactId = ? OR partnerId = ?)").get(staff.email, contactId, contactId) &&
        !db.prepare("SELECT 1 FROM contacts WHERE id = ? AND addedBy = ?").get(contactId, staff.email)) denied();
    }
  }
}

const pilotLoanActions: Partial<Record<z.infer<typeof command>["type"], string>> = {
  reviewApplication: "Reviewed 1003", selectOffer: "Saved quote", publishQuote: "Shared sample quote",
  sendApplication: "Submitted to mock UWM", requestDocument: "Requested document", reviewDocument: "Reviewed document",
  sendConditionDocument: "Recorded mock UWM delivery", refreshMockUwmClearance: "Checked mock UWM clearance",
};

export interface WorkspaceMutationSuccess {
  state: Workspace;
  message: string;
  referralLoanId?: string;
  applicationLoanId?: string;
}

export async function executeCommand(db: Store, input: unknown, staff: WorkspaceStaff | null = null, referralOwner?: StaffIdentity):
  Promise<WorkspaceMutationSuccess | { error: string }> {
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
      const application = getApplication(db, data.loanId);
      const result = await pricingProvider(isDemoStaff(staff) ? process.env : {}).quote(data.scenario);
      return db.transaction(() => {
        authorizeLoanOfficer(db, data, staff);
        db.prepare(`INSERT INTO pricing_runs
          (id, loanId, provider, mode, reference, scenario, offers, notices, quotedAt, applicationRevision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(crypto.randomUUID(), data.loanId, result.provider, result.mode, result.reference,
            JSON.stringify(data.scenario), JSON.stringify(result.offers), JSON.stringify(result.notices), new Date().toISOString(),
            application?.submittedAt ? application.revision : null);
        if (staff?.brokerage.pilot) accessEvent(db, staff, "Ran sample pricing", data.loanId, new Date().toISOString());
        return { state: scopeWorkspace(workspace(db), staff), message: `${result.offers.length} pricing options returned.` };
      });
    }
    const now = new Date().toISOString();
    return db.transaction(() => {
      let message = data.type.startsWith("delete") ? "Removed successfully." : "Saved successfully.";
      let referralLoanId: string | undefined;
      let applicationLoanId: string | undefined;
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
          if (!item && !z.uuid().safeParse(data.itemId).success) throw new WorkspaceError("This closing item no longer exists.");
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
          const funding = db.prepare("SELECT fundingDate FROM closing_progress WHERE loanId = ?").get(data.loanId)?.fundingDate;
          if (typeof funding === "string" && data.closingDate > funding) throw new WorkspaceError("The closing date cannot be after the recorded funding date.");
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
        case "recordFunding": {
          const loan = db.prepare("SELECT stage, disposition FROM loans WHERE id = ?").get(data.loanId);
          const closing = db.prepare("SELECT closingDate FROM past_client_profiles WHERE loanId = ?").get(data.loanId)?.closingDate;
          if (!loan || loan.disposition !== "Active" || typeof closing !== "string" || data.fundingDate < closing || data.fundingDate > easternDate(new Date(now))) {
            throw new WorkspaceError("Record actual closing first. Funding must fall between closing and today on an active file.");
          }
          const previous = db.prepare("SELECT fundingDate, revision FROM closing_progress WHERE loanId = ?").get(data.loanId);
          if (previous?.fundingDate !== data.fundingDate) {
            if (Number(previous?.revision ?? 0) !== data.revision) throw new WorkspaceError("Funding status changed. Refresh the loan first.");
            db.prepare(`INSERT INTO closing_progress (loanId, fundingDate, revision) VALUES (?, ?, 1)
              ON CONFLICT(loanId) DO UPDATE SET fundingDate = excluded.fundingDate, revision = revision + 1`).run(data.loanId, data.fundingDate);
            if (loan.stage !== "Funded" && loan.stage !== "Closed") db.prepare("UPDATE loans SET stage = 'Funded', stageSince = ? WHERE id = ?").run(now, data.loanId);
            createMilestoneDrafts(db, data.loanId, "Funded", now);
            addApplicationActivity(db, data.loanId, `Funding recorded · ${data.fundingDate}`, now);
            accessEvent(db, staff, "Recorded loan funding", data.loanId, now);
          }
          message = "Funding recorded. Milestone drafts and past-client follow-up are ready.";
          break;
        }
        case "saveDisclosureStatus": {
          if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
          if (data.status !== "Not started" && (!data.date || data.date > easternDate(new Date(now)))) throw new WorkspaceError("Enter the date this step was completed.");
          const date = data.status === "Not started" ? null : data.date;
          const previous = db.prepare("SELECT disclosureStatus, disclosureDate, revision FROM closing_progress WHERE loanId = ?").get(data.loanId);
          if ((previous?.disclosureStatus ?? "Not started") !== data.status || (previous?.disclosureDate ?? null) !== date) {
            if (Number(previous?.revision ?? 0) !== data.revision) throw new WorkspaceError("Disclosure status changed. Refresh the loan first.");
            db.prepare(`INSERT INTO closing_progress (loanId, disclosureStatus, disclosureDate, revision) VALUES (?, ?, ?, 1)
              ON CONFLICT(loanId) DO UPDATE SET disclosureStatus = excluded.disclosureStatus, disclosureDate = excluded.disclosureDate, revision = revision + 1`)
              .run(data.loanId, data.status, date);
            addApplicationActivity(db, data.loanId, `Manual disclosure status · ${data.status}${date ? ` · ${date}` : ""}`, now);
          }
          message = "Manual disclosure status saved.";
          break;
        }
        case "prepareClosingHandoff": {
          if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
          const steps = [
            ["lo", "Review borrower and lender handoff", "Loan officer"],
            ["processor", "Confirm conditions and closing package", "Processor"],
            ["funding", "Confirm funding and prepare follow-up", "Loan officer"],
          ];
          let added = 0;
          for (const [key, title, owner] of steps) {
            const itemId = `closing-handoff:${data.loanId}:${key}`;
            if (db.prepare("SELECT 1 FROM closing_items WHERE id = ?").get(itemId)) continue;
            db.prepare("INSERT INTO closing_items (id, loanId, title, owner, dueDate) VALUES (?, ?, ?, ?, ?)").run(itemId, data.loanId, title, owner, data.dueDate);
            added++;
          }
          if (added) addApplicationActivity(db, data.loanId, "Prepared closing handoff checklist.", now);
          message = added ? "Closing handoff checklist added." : "Closing handoff checklist is already in place.";
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
          const canUse = (id: string) => !limited || !!db.prepare("SELECT 1 FROM loans WHERE contactId = ? AND officerEmail = ?").get(id, staff.email) ||
            !!db.prepare("SELECT 1 FROM contacts WHERE id = ? AND addedBy = ?").get(id, staff.email);
          let contact = contacts.find((item) => item.id === data.contactId);
          if (data.contactId && (!contact || !canUse(data.contactId) || !matches.some((match) => match.id === data.contactId))) {
            throw new WorkspaceError("That contact match is unavailable. Refresh tasks and review the referral again.");
          }
          if (!contact) {
            if (matches.some((match) => !canUse(match.id))) throw new WorkspaceError("A possible match is outside your assigned loans. Ask a brokerage admin to review this referral.");
            if (matches.length && !data.allowDuplicate) throw new WorkspaceError("A possible contact match exists. Refresh tasks and choose how to handle it.");
            contact = { id: crypto.randomUUID(), name: String(lead.name), email, phone, role: "Borrower" };
            insertContact(db, contact);
            if (staff?.brokerage.pilot) trackPilotBorrower(db, String(lead.realtorId), contact.id);
          }
          const loanId = crypto.randomUUID();
          insertLoan(db, { id: loanId, contactId: contact.id, partnerId: String(lead.realtorId), officer: staff?.name.slice(0, 160) || "Alex Morgan",
            officerEmail: staff?.email ?? null, address: "", amount: 0, purpose: lead.purpose as Purpose, stage: "Lead", stageSince: now, createdAt: String(lead.createdAt) });
          db.prepare("INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, 'Make first contact', ?)")
            .run(`first-contact:${loanId}`, loanId, lead.dueAt);
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
            const manual = db.prepare("SELECT conditions FROM submissions WHERE id = ? AND loanId = ? AND syncedAt IS NULL")
              .get(source.submissionId, data.loanId);
            const conditions = manual ? (JSON.parse(String(manual.conditions)) as Condition[]).filter((item) => item.manual)
              : uwmSubmissionConditions(db, data.loanId, source.submissionId);
            if (!conditions) throw new WorkspaceError("This lender submission is unavailable on this loan.");
            if (db.prepare("SELECT 1 FROM document_requests WHERE submissionId = ? AND conditionId = ?").get(source.submissionId, source.conditionId)) {
              message = "This condition already has a checklist request.";
              break;
            }
            if (!conditions.some((item) => item.id === source.conditionId && !item.satisfiedAt)) {
              throw new WorkspaceError("This condition is no longer outstanding. Refresh the loan to see its status.");
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
          addApplicationActivity(db, data.loanId, `Document requested · ${data.kind}${source ? " · Lender condition" : ""}`, now);
          message = source ? "Condition linked to the borrower checklist." : "Document added to the borrower checklist.";
          break;
        }
        case "reviewDocument": {
          const request = db.prepare("SELECT kind, status, revision, submissionId, conditionId FROM document_requests WHERE id = ? AND loanId = ?")
            .get(data.requestId, data.loanId);
          const submission = request?.submissionId && db.prepare("SELECT conditions FROM submissions WHERE id = ? AND loanId = ?").get(request.submissionId, data.loanId);
          const open = submission && (JSON.parse(String(submission.conditions)) as Condition[]).some((item) => item.id === request?.conditionId && !item.satisfiedAt);
          const replaceAccepted = request?.status === "Accepted" && data.decision === "Needs replacement" && open;
          if (!request || (request.status !== "Received" && !replaceAccepted) || request.revision !== data.revision) {
            throw new WorkspaceError("This document request changed. Refresh the checklist before reviewing it.");
          }
          if (data.decision === "Needs replacement" && !data.replacementNote) throw new WorkspaceError("Tell the borrower what to replace.");
          db.prepare("UPDATE document_requests SET status = ?, replacementNote = ?, revision = revision + 1 WHERE id = ?")
            .run(data.decision, data.decision === "Accepted" ? "" : data.replacementNote, data.requestId);
          if (replaceAccepted) {
            db.prepare(`INSERT INTO uwm_document_delivery_history (requestId, receipt, sentAt, documentRevision)
              SELECT requestId, receipt, sentAt, documentRevision FROM uwm_document_deliveries WHERE requestId = ?`).run(data.requestId);
            db.prepare("DELETE FROM uwm_document_deliveries WHERE requestId = ?").run(data.requestId);
          }
          const pdf = db.prepare("SELECT objectId FROM document_files WHERE requestId = ?").get(data.requestId)?.objectId;
          const accepted = pdf ? (staff?.brokerage.id === demoBrokerageId || staff?.brokerage.pilot ? "Demo PDF accepted" : "Borrower PDF accepted") : "Sample document accepted";
          addApplicationActivity(db, data.loanId, `${data.decision === "Accepted" ? accepted : "Replacement requested"} · ${request.kind}`, now);
          message = data.decision === "Accepted" ? "Document accepted." : "Replacement requested on the borrower checklist.";
          break;
        }
        case "applyDocumentPreset": {
          if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
          let added = 0;
          for (const kind of checklistPresets[data.preset]) {
            if (db.prepare("SELECT 1 FROM document_requests WHERE loanId = ? AND kind = ? AND conditionId IS NULL").get(data.loanId, kind)) continue;
            db.prepare("INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt) VALUES (?, ?, ?, ?, ?)")
              .run(crypto.randomUUID(), data.loanId, kind, checklistInstructions[kind], now);
            added++;
          }
          if (added) addApplicationActivity(db, data.loanId, `Applied ${data.preset.toLowerCase()} checklist · ${added} added`, now);
          message = added ? `Added ${added} document requests.` : "This checklist is already in place.";
          break;
        }
        case "recordManualHandoff": {
          const application = getApplication(db, data.loanId);
          if (!application?.submittedAt || !application.reviewedAt || application.revision !== data.revision) {
            throw new WorkspaceError("Review the current submitted application before recording a handoff.");
          }
          const detail = `Manual handoff · ${data.outcome} · Application revision ${data.revision}${data.note ? ` · ${data.note}` : ""}`;
          const previous = db.prepare("SELECT loanId, text FROM activity WHERE id = ?").get(data.eventId);
          if (previous && (previous.loanId !== data.loanId || previous.text !== detail)) throw new WorkspaceError("Start a new handoff entry.");
          if (!previous) {
            db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(data.eventId, data.loanId, detail, now);
            accessEvent(db, staff, `Manual handoff · ${data.outcome}`, data.loanId, now);
          }
          message = "Manual handoff recorded on the loan.";
          break;
        }
        case "sendConditionDocument": {
          const result = sendMockConditionDocument(db, data.loanId, data.requestId, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = `Mock UWM document receipt · ${result.receipt}`;
          break;
        }
        case "simulateDeliveryFailure": {
          const request = db.prepare("SELECT * FROM document_requests WHERE id = ? AND loanId = ?").get(data.requestId, data.loanId);
          const conditions = typeof request?.submissionId === "string" ? uwmSubmissionConditions(db, data.loanId, request.submissionId) : undefined;
          if (!request || request.revision !== data.revision || request.status !== "Accepted" ||
            !conditions?.some((item) => item.id === request.conditionId && !item.satisfiedAt) ||
            db.prepare("SELECT 1 FROM uwm_document_deliveries WHERE requestId = ?").get(data.requestId)) {
            throw new WorkspaceError("Select an accepted document with an outstanding mock UWM delivery.");
          }
          if (!db.prepare("SELECT 1 FROM mock_delivery_failures WHERE requestId = ? AND revision = ?").get(data.requestId, data.revision)) {
            db.prepare("INSERT INTO mock_delivery_failures VALUES (?, ?, ?)").run(data.requestId, data.revision, now);
            addApplicationActivity(db, data.loanId, `Mock UWM delivery failed · ${request.kind} · revision ${data.revision}`, now);
          }
          message = "Mock delivery failed. Retry from the document checklist.";
          break;
        }
        case "refreshMockUwmClearance": {
          const result = refreshMockUwmClearance(db, data.loanId, data.submissionId, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
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
            db.prepare("INSERT INTO shared_quote_history SELECT *, ?, 'Replaced' FROM published_quotes WHERE loanId = ?").run(now, data.loanId);
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
            db.prepare("INSERT INTO shared_quote_history SELECT *, ?, 'Removed' FROM published_quotes WHERE loanId = ?").run(now, data.loanId);
            db.prepare("DELETE FROM published_quotes WHERE loanId = ?").run(data.loanId);
            addApplicationActivity(db, data.loanId, "Sample quote removed from borrower status.", now);
          }
          message = "Sample quote removed from borrower status.";
          break;
        }
        case "reviewApplication": {
          const application = getApplication(db, data.loanId);
          if (!application?.submittedAt) throw new WorkspaceError("The borrower must submit the application before review.");
          if (data.revision !== undefined && application.revision !== data.revision) throw new WorkspaceError("Refresh to review the latest application.");
          if (!application.reviewedAt) {
            db.prepare("UPDATE applications SET reviewedAt = ? WHERE loanId = ?").run(now, data.loanId);
            saveApplicationVersion(db, { ...application, reviewedAt: now });
            db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ? AND completedAt IS NULL")
              .run(now, `application-correction:${data.loanId}:${application.revision}`);
            addApplicationActivity(db, data.loanId, "Loan officer reviewed the demo 1003.", now);
          }
          message = "Application marked reviewed.";
          break;
        }
        case "requestApplicationCorrection": {
          const application = getApplication(db, data.loanId);
          if (!application?.submittedAt || application.revision !== data.revision) throw new WorkspaceError("Refresh the submitted application before requesting corrections.");
          saveApplicationVersion(db, application);
          db.prepare(`UPDATE applications SET correctionNote = ?, submittedAt = NULL, reviewedAt = NULL,
            revision = revision + 1, step = 0, updatedAt = ? WHERE loanId = ?`).run(data.note, now, data.loanId);
          db.prepare(`UPDATE tasks SET completedAt = ? WHERE loanId = ? AND completedAt IS NULL
            AND (id = ? OR instr(id, ?) = 1)`).run(now, data.loanId, "application-follow-up:" + data.loanId, "application-correction:" + data.loanId + ":");
          addApplicationActivity(db, data.loanId, "Loan officer requested 1003 corrections.", now);
          message = "The borrower can reopen the same link to correct and resubmit the 1003.";
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
        case "importContacts": {
          const batch = `contact-import:${staff?.email ?? "local"}:${data.batchId}`;
          const prior = db.prepare("SELECT value FROM settings WHERE key = ?").get(batch);
          if (prior) {
            message = String(prior.value);
            break;
          }
          const contacts = db.prepare("SELECT name, role, email, phone FROM contacts").all() as unknown as Contact[];
          let imported = 0;
          for (const row of data.rows) {
            if (contactDuplicate(row, contacts) && !row.separate) continue;
            const contact = { ...row, id: crypto.randomUUID(), addedBy: staff?.email };
            insertContact(db, contact);
            contacts.push(contact);
            imported++;
          }
          accessEvent(db, staff, "Imported contacts", `${imported} added · ${data.rows.length - imported} possible duplicates skipped`, now);
          message = `${imported} contacts imported · ${data.rows.length - imported} possible duplicates skipped.`;
          db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(batch, message);
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
          const current = data.id ? db.prepare("SELECT contactId, stage, stageSince, officer, officerEmail, disposition FROM loans WHERE id = ?").get(data.id) : undefined;
          if (data.id && !current) throw new WorkspaceError("This loan no longer exists.");
          if (current && current.stage !== data.stage && current.disposition !== "Active") throw new WorkspaceError("Reopen the loan before changing its stage.");
          if (data.id && data.start1003) throw new WorkspaceError("Start the 1003 from the loan’s application panel.");
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
            insertContact(db, { id: contactId, name: data.borrower, email: data.borrowerEmail ?? "", phone: data.borrowerPhone ?? "", role: "Borrower" });
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
            db.prepare(`UPDATE loans SET contactId = ?, partnerId = ?, officer = ?, officerEmail = ?, address = ?, amount = ?,
              purpose = ?, stage = ?, stageSince = ?, leadSource = coalesce(?, leadSource) WHERE id = ?`)
              .run(contactId, data.partnerId, officer, officerEmail, data.address, data.amount, data.purpose, data.stage, stageSince, data.leadSource ?? null, loanId);
            if ((current?.officerEmail ?? null) !== officerEmail) accessEvent(db, staff, "Changed loan owner", `${loanId} · ${officerEmail ?? "Unassigned"}`, now);
          } else {
            insertLoan(db, { ...data, id: loanId, officer, officerEmail, contactId, stageSince });
          }
          if (current?.stage !== data.stage && (current || data.stage !== "Lead")) {
            createMilestoneDrafts(db, loanId, data.stage, now);
            if (current) addApplicationActivity(db, loanId, `Moved from ${current.stage} to ${data.stage}.`, now);
          }
          if (!current && staff?.brokerage.pilot) accessEvent(db, staff, "Created lead", loanId, now);
          if (!current && data.stage === "Lead") {
            db.prepare("INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, 'Make first contact', ?)")
              .run(`first-contact:${loanId}`, loanId, new Date(Date.parse(now) + 86_400_000).toISOString());
          }
          if (data.start1003) {
            const contact = db.prepare("SELECT email, phone FROM contacts WHERE id = ?").get(contactId);
            if (!startApplication(db, loanId, now, staff?.brokerage.id, { email: String(contact?.email ?? ""), phone: String(contact?.phone ?? "") })) {
              throw new WorkspaceError("Orbit could not start the 1003 for this lead.");
            }
            accessEvent(db, staff, "Issued borrower link", loanId, now);
            applicationLoanId = loanId;
            message = "Lead saved and 1003 started.";
          }
          break;
        }
        case "deleteLoan":
          db.prepare("DELETE FROM loans WHERE id = ?").run(data.id);
          break;
        case "move": {
          const loan = db.prepare("SELECT stage, disposition FROM loans WHERE id = ?").get(data.id);
          if (!loan) throw new WorkspaceError("This loan no longer exists.");
          if (loan.stage !== data.stage) {
            if (loan.disposition !== "Active") throw new WorkspaceError("Reopen the loan before changing its stage.");
            db.prepare("UPDATE loans SET stage = ?, stageSince = ? WHERE id = ?").run(data.stage, now, data.id);
            createMilestoneDrafts(db, data.id, data.stage, now);
            addApplicationActivity(db, data.id, `Moved from ${loan.stage} to ${data.stage}.`, now);
          }
          break;
        }
        case "loanDisposition": {
          const loan = db.prepare("SELECT stage, disposition, dispositionReason, revisitDate, dispositionRevision FROM loans WHERE id = ?").get(data.loanId);
          if (!loan || loan.dispositionRevision !== data.revision) throw new WorkspaceError("Refresh the loan before changing its status.");
          if (loan.stage === "Closed" || loan.stage === "Funded") throw new WorkspaceError("The loan has reached a closing outcome.");
          const reason = data.disposition === "Active" ? "" : data.reason;
          const revisit = data.disposition === "On hold" ? data.revisitDate : null;
          if (data.disposition !== "Active" && !reason) throw new WorkspaceError("Enter a reason for changing the loan status.");
          if (loan.disposition === data.disposition && loan.dispositionReason === reason && loan.revisitDate === revisit) break;
          db.prepare(`UPDATE loans SET disposition = ?, dispositionReason = ?, revisitDate = ?,
            dispositionRevision = dispositionRevision + 1 WHERE id = ?`).run(data.disposition, reason, revisit, data.loanId);
          if (data.disposition === "Active" && (loan.stage === "Lead" || loan.stage === "Pre-qual") && getApplication(db, data.loanId)?.submittedAt) {
            db.prepare("UPDATE loans SET stage = 'Application', stageSince = ? WHERE id = ?").run(now, data.loanId);
          }
          message = data.disposition === "Active" ? "Loan reopened. Open work has returned to the queue." : `Loan marked ${data.disposition.toLowerCase()}.`;
          addApplicationActivity(db, data.loanId, reason ? `${message} ${reason}` : message, now);
          accessEvent(db, staff, `Loan status set to ${data.disposition}`, data.loanId, now);
          break;
        }
        case "copyDraft":
          if (!recordDraftCopy(db, data, now)) throw new WorkspaceError("This draft or recipient has changed. Refresh the loan before copying again.");
          message = "Draft copy recorded.";
          break;
        case "note": {
          if (data.kind === "Note" && (data.outcome || data.followUp)) throw new WorkspaceError("Choose call, email, or text to record an outcome or follow-up.");
          if (data.followUp && data.followUp < easternDate(new Date(now))) throw new WorkspaceError("Choose today or a future date for follow-up.");
          const eventId = data.eventId ?? crypto.randomUUID();
          const previous = db.prepare("SELECT loanId, text, kind, outcome FROM activity WHERE id = ?").get(eventId);
          if (previous && (previous.loanId !== data.loanId || previous.text !== data.text || previous.kind !== data.kind ||
            previous.outcome !== (data.outcome ?? null))) throw new WorkspaceError("Start a new activity entry.");
          if (!previous) {
            db.prepare("INSERT INTO activity (id, loanId, text, createdAt, kind, outcome) VALUES (?, ?, ?, ?, ?, ?)")
              .run(eventId, data.loanId, data.text, now, data.kind, data.outcome ?? null);
            if (data.outcome) db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ? AND completedAt IS NULL")
              .run(now, `first-contact:${data.loanId}`);
            if (data.followUp) db.prepare("INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, ?, ?)")
              .run(`outreach:${eventId}`, data.loanId, `Follow up after ${data.kind.toLowerCase()}`, `${data.followUp}T17:00:00.000Z`);
          }
          message = `${data.kind} logged.`;
          break;
        }
        case "saveBrokerageTemplate": {
          const current = db.prepare("SELECT body, revision FROM brokerage_templates WHERE audience = ? AND milestone = ?").get(data.audience, data.milestone);
          if ((current?.body ?? "") !== data.body) {
            if (Number(current?.revision ?? 0) !== data.revision) throw new WorkspaceError("This template changed. Refresh it before saving.");
            db.prepare(`INSERT INTO brokerage_templates (audience, milestone, body, revision) VALUES (?, ?, ?, 1)
              ON CONFLICT(audience, milestone) DO UPDATE SET body = excluded.body, revision = revision + 1`).run(data.audience, data.milestone, data.body);
            accessEvent(db, staff, "Updated brokerage message template", `${data.audience} · ${data.milestone}`, now);
          }
          message = data.body ? "Brokerage template saved." : "Default template restored.";
          break;
        }
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
        case "saveManualCondition":
        case "recordManualDelivery":
        case "recordManualClearance": {
          const submission = db.prepare("SELECT lender, conditions FROM submissions WHERE id = ? AND loanId = ? AND syncedAt IS NULL")
            .get(data.submissionId, data.loanId);
          if (!submission) throw new WorkspaceError("Select a manual lender submission on this loan.");
          const conditions = JSON.parse(String(submission.conditions)) as Condition[];
          const prior = conditions.find((item) => item.id === data.conditionId);
          if ((prior?.manual?.revision ?? 0) !== data.revision) throw new WorkspaceError("This condition changed. Refresh the loan before saving.");
          const entry: Condition = prior ?? { id: data.conditionId, category: "", description: "", group: null, uploaded: false, satisfiedAt: null };
          const manual = entry.manual ?? { owner: "", revision: 0, deliveries: [], confirmedDelivery: null };
          if (data.type === "saveManualCondition") {
            if (entry.category === data.category && entry.description === data.description && manual.owner === data.owner) break;
            entry.category = data.category;
            entry.description = data.description;
            manual.owner = data.owner;
            message = "Manual lender condition saved.";
          } else if (data.type === "recordManualDelivery") {
            const request = db.prepare(`SELECT status, revision FROM document_requests
              WHERE submissionId = ? AND conditionId = ? AND loanId = ?`).get(data.submissionId, entry.id, data.loanId);
            if (entry.satisfiedAt || request?.status !== "Accepted" || request.revision !== data.documentRevision) {
              throw new WorkspaceError("Accept the current document for the outstanding condition before recording delivery.");
            }
            if (manual.deliveries.some((delivery) => delivery.documentRevision === data.documentRevision && delivery.reference === data.reference)) break;
            manual.deliveries.push({ documentRevision: data.documentRevision, reference: data.reference, at: now });
            entry.uploaded = true;
            message = `Manual delivery recorded · document revision ${data.documentRevision}`;
          } else {
            if (Boolean(entry.satisfiedAt) === data.cleared) break;
            entry.satisfiedAt = data.cleared ? now : null;
            manual.confirmedDelivery = data.cleared ? data.confirmation : null;
            if (!data.cleared) entry.uploaded = false;
            message = `Condition ${data.cleared ? "cleared by lender" : "reopened"} · ${data.confirmation}`;
          }
          entry.manual = { ...manual, revision: manual.revision + 1 };
          if (!prior) conditions.push(entry);
          db.prepare("UPDATE submissions SET conditions = ? WHERE id = ?").run(JSON.stringify(conditions), data.submissionId);
          addApplicationActivity(db, data.loanId, `${submission.lender} · ${entry.category} · ${message}`, now);
          break;
        }
      }
      synchronizeRetentionTasks(db);
      const action = pilotLoanActions[data.type];
      if (staff?.brokerage.pilot && action && "loanId" in data) accessEvent(db, staff, action, data.loanId, now);
      return { state: scopeWorkspace(workspace(db), staff), message, referralLoanId, applicationLoanId };
    });
  } catch (error) {
    if (error instanceof WorkspaceError || error instanceof PricingError) return { error: error.message };
    if (data.type === "runPricing") return { error: "Pricing could not be completed. Try again." };
    console.error("Orbit mutation failed", error);
    return { error: "Orbit could not save the change. Please try again." };
  }
}
