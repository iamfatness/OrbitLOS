import { z } from "zod";
import { insertContact, insertLoan, type Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";
import type { VersionedBrokerageMember } from "./brokerage-model";
import { demoBrokerageId, portalToken } from "./brokerage-model";
import { easternDate, synchronizeRetentionTasks } from "./client-retention";
import { shiftReportDate } from "./report-date-range";
import { appointmentInstant } from "./appointment-model";
import { blankApplication, sampleApplication, applicationSteps } from "./application-model";
import { getApplication, saveApplicationVersion } from "./applications";
import { startLeadFollowUp } from "./lead-inbox";
import { beginCampaignAssignment } from "./campaign-response";
import { accessEvent } from "./workspace-access";
import { createMilestoneDrafts } from "./communications";
import { recordReviewNotice } from "./review-inbox";
import { sampleScenarioPlan } from "./loan-scenario-model";

export const explorationInput = z.object({ type: z.literal("loadPilotExploration"), officerEmail: z.email().max(254),
  processorEmail: z.email().max(254).nullable().default(null) });

const dateRules = {
  task: { table: "tasks", key: "id", column: "dueAt", active: "completedAt IS NULL", revision: "" },
  appointment: { table: "loan_appointments", key: "id", column: "startsAt", active: "cancelledAt IS NULL", revision: ", revision = revision + 1" },
  lead: { table: "referral_leads", key: "id", column: "dueAt", active: "resolvedAt IS NULL AND heldAt IS NULL", revision: "" },
  closing: { table: "closing_items", key: "id", column: "dueDate", active: "completedAt IS NULL", revision: ", revision = revision + 1" },
  document: { table: "document_requests", key: "id", column: "dueOn", active: "status IN ('Requested','Needs replacement')", revision: ", deadlineRevision = deadlineRevision + 1" },
  conversation: { table: "loan_conversations", key: "id", column: "dueOn", active: "status <> 'Closed'", revision: ", revision = revision + 1" },
  review: { table: "loan_reviews", key: "id", column: "dueOn", active: "status = 'Requested'", revision: ", revision = revision + 1" },
  plan: { table: "closing_plans", key: "loanId", column: "targetDate", active: "loanId IN (SELECT id FROM loans WHERE stage NOT IN ('Funded', 'Closed') AND disposition = 'Active')", revision: "" },
} as const;
const dateEntry = z.object({ kind: z.enum(["task", "appointment", "lead", "closing", "document", "conversation", "review", "plan"]),
  id: z.uuid(), offset: z.number().int().min(-7).max(14), hour: z.number().int().min(9).max(17).nullable(), value: z.string() });
const manifestSchema = z.object({ version: z.literal(1), dates: z.array(dateEntry).max(100), processorEmail: z.string().nullable() });
type DateEntry = z.infer<typeof dateEntry>;
const dateValue = (today: string, offset: number, hour: number | null) => hour === null ? shiftReportDate(today, offset) :
  appointmentInstant(`${shiftReportDate(today, offset)}T${String(hour).padStart(2, "0")}:00`)!;

// Members are resolved through the authenticated directory at the HTTP boundary.
// The additive pack is independent of the destructive presenter-scenario reset.
export function loadExplorationExamples(db: Store, staff: WorkspaceStaff, input: unknown,
  members: VersionedBrokerageMember[], clock = new Date()): { message: string } | { error: string } {
  if (staff.brokerage.role !== "Admin" || (staff.brokerage.pilot !== true && staff.brokerage.id !== demoBrokerageId)) return { error: "Only an admin in a demo or pilot workspace can add demo examples." };
  const parsed = explorationInput.safeParse(input);
  if (!parsed.success) return { error: "Choose an active or invited loan officer and an optional active processor." };
  const owner = members.find(m => m.email === parsed.data.officerEmail && (m.status === "Active" || m.status === "Invited") && m.role !== "Processor");
  const processor = parsed.data.processorEmail ? members.find(m => m.email === parsed.data.processorEmail && m.status === "Active" && m.role === "Processor") : null;
  if (!owner || (parsed.data.processorEmail && !processor)) return { error: "Choose an active or invited loan officer and an active processor in this brokerage." };
  // Accepting an existing invitation advances its access revision exactly once.
  // Preparing fictional records does not activate the membership or create a session.
  const reviewer = { ...owner, accessRevision: (owner.accessRevision ?? 0) + (owner.status === "Invited" ? 1 : 0) };
  const key = `pilot-exploration:v1:${owner.email}`;
  const now = clock.toISOString();
  const today = easternDate(clock);
  return db.transaction(() => {
    const existing = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    if (existing) {
      const manifest = manifestSchema.parse(JSON.parse(String(existing.value)));
      if (manifest.processorEmail !== (processor?.email ?? null)) return { error: "These examples already have a processor setup. Use Team assignments to change it." };
      manifest.dates = manifest.dates.filter(item => {
        const rule = dateRules[item.kind];
        const next = dateValue(today, item.offset, item.hour);
        if (next === item.value) return true;
        // Refresh only unchanged, still-open example dates. Preserve edits and completed work.
        const updated = db.prepare(`UPDATE ${rule.table} SET ${rule.column} = ?${rule.revision} WHERE ${rule.key} = ? AND ${rule.column} = ? AND ${rule.active} RETURNING ${rule.key}`)
          .get(next, item.id, item.value);
        item.value = next;
        return Boolean(updated);
      });
      db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(JSON.stringify(manifest), key);
      accessEvent(db, staff, "Refreshed exploration sample dates", owner.email, now);
      return { message: "Demo examples are ready. Open sample dates have been refreshed; your edits and completed work are preserved." };
    }
    const dates: DateEntry[] = [];
    const packId = crypto.randomUUID().slice(0, 8);
    const dated = (kind: DateEntry["kind"], id: string, offset: number, hour: number | null = null) => {
      const value = dateValue(today, offset, hour); dates.push({ kind, id, offset, hour, value }); return value;
    };
    const partnerIds = [crypto.randomUUID(), crypto.randomUUID()];
    ["Taylor Bennett", "Jordan Ellis"].forEach((name, i) => insertContact(db, { id: partnerIds[i], name,
      email: `explore-${packId}-realtor-${i}@example.test`, phone: `248-555-016${i}`, role: "Realtor", addedBy: owner.email }));
    const cases = [
      { name: "Olivia Parker", stage: "Lead", amount: 425000 },
      { name: "Ethan Brooks", stage: "Pre-qual", amount: 312000 },
      { name: "Maya Chen", stage: "Application", amount: 685000 },
      { name: "Sofia Martinez", stage: "Processing", amount: 398000 },
      { name: "Jackson Reed", stage: "Underwriting", amount: 542000 },
      { name: "Isabella Patel", stage: "Clear to Close", amount: 364500 },
      { name: "Lucas Rivera", stage: "Funded", amount: 349000 },
      { name: "Harper Wilson", stage: "Funded", amount: 468000 },
    ] as const;
    const loans = cases.map((file, i) => {
      const id = crypto.randomUUID(), contactId = crypto.randomUUID();
      const email = `explore-${packId}-${i}@example.test`, phone = `248-555-017${i}`;
      const street = `${120 + i} Example Lane`;
      const createdAt = new Date(clock.getTime() - (i + 2) * 86400000).toISOString();
      insertContact(db, { id: contactId, name: file.name, email, phone, role: "Borrower", addedBy: owner.email });
      insertLoan(db, { id, contactId, partnerId: partnerIds[i % 2], officer: owner.name, officerEmail: owner.email,
        address: `${street}, Troy, MI 48084`, amount: file.amount, purpose: i === 7 ? "Refinance" : "Purchase",
        stage: file.stage, stageSince: createdAt, createdAt, leadSource: i % 2 ? "Website quote request" : "Realtor referral" });
      db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)")
        .run(crypto.randomUUID(), id, "Fictional exploration example · Ready to explore", now);
      if (i === 0) {
        const plan = sampleScenarioPlan(file.amount * 100, "Purchase");
        plan.monthlyBudget = 350000;
        plan.cashBudget = 12000000;
        plan.recommendedId = plan.options[1].id;
        plan.recommendation = "Demo example: Lowest borrowing cost over five years, within the $3,500 monthly budget and $120,000 available for closing. The additional upfront cost breaks even after 32 months.";
        db.prepare("INSERT INTO loan_scenario_plans (loanId, plan, revision, updatedAt, updatedBy, applicationRevision) VALUES (?, ?, 1, ?, ?, NULL)")
          .run(id, JSON.stringify(plan), now, staff.name);
      }
      if (i >= 2) {
        const draft = { ...sampleApplication({ ...blankApplication(), borrowerName: file.name, email, phone,
          loanAmount: String(file.amount), purpose: i === 7 ? "Refinance" : "Purchase", propertyAddress: street, propertyLocation: { city: "Troy", state: "MI", zip: "48084", unit: "" } }), confirmedDemo: true };
        db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, step, revision, updatedAt, submittedAt, reviewedAt)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`)
          .run(id, portalToken(staff.brokerage.id), new Date(clock.getTime() + 7 * 86400000).toISOString(), JSON.stringify(draft),
            applicationSteps.length - 1, now, now, i === 2 ? null : now);
        const application = getApplication(db, id); if (application) saveApplicationVersion(db, application);
      }
      if (i >= 3 && i <= 5) {
        db.prepare("INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision) VALUES (?, ?, ?, ?, ?, ?, 1)")
          .run(id, processor?.email ?? null, processor?.name ?? "", processor ? "In processing" : "Unassigned", "Fictional file for exploring processing.", now);
        db.prepare("INSERT INTO closing_plans (loanId, targetDate) VALUES (?, ?)").run(id, dated("plan", id, i - 2));
        const closingId = crypto.randomUUID();
        db.prepare("INSERT INTO closing_items (id, loanId, title, owner, dueDate) VALUES (?, ?, ?, ?, ?)")
          .run(closingId, id, ["Confirm title package", "Review closing figures", "Confirm signing appointment"][i - 3], owner.name, dated("closing", closingId, i - 3));
        const requestId = crypto.randomUUID();
        db.prepare("INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, dueOn) VALUES (?, ?, ?, ?, ?, ?)")
          .run(requestId, id, ["Pay stub", "Bank statement", "Homeowners insurance"][i - 3], "Use a built-in sample document for this fictional file.", now, dated("document", requestId, i - 4));
      }
      const taskId = crypto.randomUUID();
      db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, purpose) VALUES (?, ?, ?, ?, 'Loan service')")
        .run(taskId, id, ["Call Olivia about her purchase plans", "Review Ethan’s pre-qualification", "Review Maya’s application", "Check Sofia’s document progress",
          "Follow up on Jackson’s underwriting", "Confirm Isabella’s closing details", "Check in after Lucas’s closing", "Discuss Harper’s next purchase"][i], dated("task", taskId, i % 4 - 1, 11 + i % 3));
      if (i < 6) {
        const appointmentId = crypto.randomUUID();
        db.prepare("INSERT INTO loan_appointments (id, loanId, title, startsAt, durationMinutes, ownerRole, revision) VALUES (?, ?, ?, ?, 30, ?, 1)")
          .run(appointmentId, id, ["Purchase planning call", "Pre-qualification review", "Application walkthrough", "Document check-in", "Loan progress call", "Closing preparation"][i],
            dated("appointment", appointmentId, i < 2 ? 0 : i - 1, 10 + i), processor && i === 3 ? "Processor" : "Loan officer");
      } else {
        db.prepare("INSERT INTO closing_progress (loanId, fundingDate, revision) VALUES (?, ?, 1)").run(id, today);
        db.prepare("INSERT INTO past_client_profiles (loanId, closingDate, currentRate, targetRate, observedRate, watchEnabled, checkedAt, note) VALUES (?, ?, 6.875, 6.125, ?, 1, ?, ?)")
          .run(id, today, i === 6 ? 6 : 6.375, now, "Fictional past-client relationship for exploring follow-ups and rate watch.");
        db.prepare("INSERT INTO loan_financials (loanId, cycle, fundingDate, expectedCents, commissionCents, expenseReviewed, receiptsCents, expensesCents, revision) VALUES (?, 1, ?, 720000, 360000, 1, 600000, 45000, 3)").run(id, today);
        for (const [kind, amount, reference] of [["Estimate", null, "Sample compensation"], ["Receipt", 600000, "Sample lender receipt"], ["Expense", 45000, "Sample file expense"]] as const) {
          db.prepare("INSERT INTO loan_financial_entries (id, loanId, cycle, kind, amountCents, occurredOn, reference, note, at, actorName, actorEmail, request) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, '{}')")
            .run(crypto.randomUUID(), id, kind, amount, today, reference, "Fictional example", now, staff.name, staff.email);
        }
      }
      if (i < 3) {
        const conversationId = crypto.randomUUID();
        db.prepare("INSERT INTO loan_conversations (id, loanId, contactId, audience, ownerRole, status, unread, dueOn, updatedAt) VALUES (?, ?, ?, 'Borrower', 'Loan officer', ?, ?, ?, ?)")
          .run(conversationId, id, contactId, ["Needs reply", "Waiting on contact", "Open"][i], i === 0 ? 1 : 0, dated("conversation", conversationId, i), now);
        db.prepare("INSERT INTO conversation_events (id, conversationId, kind, channel, origin, text, actor, actorEmail, at, request) VALUES (?, ?, 'Inbound', 'Email', 'Simulated', ?, ?, ?, ?, '{}')")
          .run(crypto.randomUUID(), conversationId, ["Can we talk about my down payment options this afternoon?", "I’ll have the requested details ready tomorrow.", "I’ve completed my application and would like to review next steps."][i], file.name, email, now);
        db.prepare("INSERT INTO conversation_events (id, conversationId, kind, origin, text, actor, actorEmail, at, request) VALUES (?, ?, 'Note', 'Internal', ?, ?, ?, ?, '{}')")
          .run(crypto.randomUUID(), conversationId, "Fictional example: keep the next follow-up with this loan.", owner.name, owner.email, now);
      }
      if (i >= 2) createMilestoneDrafts(db, id, file.stage, now);
      const requester = processor ?? members.find(member => member.status === "Active" && member.role === "Admin" && member.email !== owner.email);
      if (i === 3 && requester) {
        const reviewId = crypto.randomUUID(), eventId = crypto.randomUUID();
        db.prepare(`INSERT INTO loan_reviews (id, loanId, title, category, requesterEmail, requesterName, reviewerEmail, reviewerName,
          reviewerRole, reviewerAccessRevision, dueOn, status, applicationRevision, createdAt, updatedAt)
          VALUES (?, ?, 'Review Sofia’s document checklist', 'Document checklist', ?, ?, ?, ?, ?, ?, ?, 'Requested', NULL, ?, ?)`)
          .run(reviewId, id, requester.email, requester.name, owner.email, owner.name, owner.role, reviewer.accessRevision, dated("review", reviewId, 0), now, now);
        db.prepare(`INSERT INTO loan_review_events (id, reviewId, actorEmail, actorName, action, note, at, request, context)
          VALUES (?, ?, ?, ?, 'Requested', 'Fictional demo example: review the requested documents before the next handoff.', ?, '{}', 'Exploration example')`)
          .run(eventId, reviewId, requester.email, requester.name, now);
        recordReviewNotice(db, eventId, reviewer, "Demo review assigned", now);
      }
      return { id, contactId };
    });
    const campaignId = crypto.randomUUID();
    const campaignBase = "Purchase follow-ups · Demo";
    let campaignName = campaignBase;
    let campaignNumber = 1;
    while (db.prepare("SELECT 1 FROM call_campaigns WHERE name = ?").get(campaignName)) campaignName = `${campaignBase} ${++campaignNumber}`;
    db.prepare("INSERT INTO call_campaigns (id, name, createdAt) VALUES (?, ?, ?)").run(campaignId, campaignName, now);
    for (const [i, name] of ["Amelia Davis", "Noah Bennett", "Charlotte Kim", "Liam Thompson", "Avery Williams", "Elijah Robinson"].entries()) {
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt) VALUES (?, ?, ?, ?, ?, ?, 'Purchase', ?, ?, ?, ?)")
        .run(id, crypto.randomUUID(), i % 2 ? null : partnerIds[(i / 2) % 2], name, `explore-${packId}-lead-${i}@example.test`, `248-555-018${i}`,
          i < 4 ? owner.name : "", i < 4 ? owner.email : null, now, dated("lead", id, i % 3 - 1, 10));
      startLeadFollowUp(db, id, now);
      db.prepare("INSERT INTO call_campaign_members (leadId, campaignId, joinedAt, attempts) VALUES (?, ?, ?, 0)").run(id, campaignId, now);
      beginCampaignAssignment(db, id, now);
    }
    synchronizeRetentionTasks(db, clock);
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(key, JSON.stringify({ version: 1, dates, processorEmail: processor?.email ?? null }));
    accessEvent(db, staff, "Added fictional exploration examples", owner.email, now);
    return { message: `Added ${loans.length} loans, 6 leads, 6 appointments, conversations, and follow-ups. Today, Calendar, and Lead Inbox are ready to explore.` };
  });
}
