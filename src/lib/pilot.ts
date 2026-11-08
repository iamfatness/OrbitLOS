import { z } from "zod";
import { pilotFeedbackStatuses, pilotPriorities, pilotSteps, pilotWalkthroughs, portalToken, type PilotFeedback, type PilotMeasurement, type PilotScenario } from "./brokerage-model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import { insertContact, insertLoan, type Store } from "./store";
import { easternDate, synchronizeRetentionTasks } from "./client-retention";
import { startLeadFollowUp } from "./lead-inbox";
import type { DemoGuideState } from "./brokerage-model";
import { accessEvent } from "./workspace-access";

const day = 86_400_000;
type PilotMutation = { message: string } | { error: string };
export const pilotScenarioInput = z.object({
  type: z.literal("loadPilotScenario"), id: z.uuid(), previousId: z.uuid().nullable(), officerEmail: z.email().max(254),
});
export const pilotFeedbackInput = z.object({
  type: z.literal("pilotFeedback"), id: z.uuid(), step: z.enum(pilotSteps),
  message: z.string().trim().min(1, "Describe what happened.").max(1000),
});
export const pilotTriageInput = z.object({
  type: z.literal("triagePilotFeedback"), id: z.uuid(), owner: z.email().max(254).nullable(),
  status: z.enum(pilotFeedbackStatuses), priority: z.enum(pilotPriorities),
  retest: z.string().trim().max(500), revision: z.number().int().nonnegative(),
});
export const pilotMeasurementInput = z.object({
  type: z.literal("recordPilotMeasurement"), id: z.uuid(), walkthrough: z.enum(pilotWalkthroughs),
  workflow: z.enum(["Orbit", "Current brokerage workflow"]), seconds: z.number().int().positive().max(86_400),
  repeatEntries: z.number().int().nonnegative().max(2000), systemSwitches: z.number().int().nonnegative().max(2000),
});

function scenarioRow(db: Store) {
  return db.prepare("SELECT id, realtorId, loanId, loadedAt, officerEmail FROM pilot_scenario WHERE singleton = 1").get();
}

export function demoGuideState(db: Store): DemoGuideState | null {
  const row = db.prepare(`SELECT scenario.id, scenario.officerEmail, lead.id AS leadId, lead.loanId,
    CASE WHEN portal.expiresAt > ? THEN portal.token END AS realtorToken, rate.id AS rateLoanId
    FROM pilot_scenario scenario LEFT JOIN referral_leads lead ON lead.realtorId = scenario.realtorId AND lead.requestId = scenario.id
    LEFT JOIN realtor_portals portal ON portal.realtorId = scenario.realtorId
    LEFT JOIN loans rate ON rate.id = 'demo-rate:' || scenario.id WHERE scenario.singleton = 1`).get(new Date().toISOString());
  if (!row) return null;
  return { id: String(row.id), officerEmail: String(row.officerEmail), leadId: row.leadId as string | null,
    loanId: row.loanId as string | null, realtorToken: row.realtorToken as string | null, rateLoanId: row.rateLoanId as string | null };
}

export function pilotReview(db: Store) {
  const row = scenarioRow(db);
  const pilotScenario: PilotScenario | undefined = row
    ? { id: String(row.id), loadedAt: String(row.loadedAt), officerEmail: String(row.officerEmail) } : undefined;
  const pilotFeedback = db.prepare("SELECT * FROM pilot_feedback ORDER BY rowid DESC LIMIT 100")
    .all().map((item) => ({ ...item }) as unknown as PilotFeedback);
  const metrics = [
    { label: "Lead to first recorded outreach", sql: `SELECT loans.createdAt AS start, min(activity.createdAt) AS finish
      FROM loans JOIN activity ON loans.id = activity.loanId WHERE activity.outcome IS NOT NULL GROUP BY loans.id` },
    { label: "1003 submission to review", sql: `SELECT submittedAt AS start, reviewedAt AS finish FROM application_versions
      UNION ALL SELECT submittedAt, reviewedAt FROM applications a WHERE NOT EXISTS (
        SELECT 1 FROM application_versions v WHERE v.loanId = a.loanId AND v.revision = a.revision)` },
    { label: "Document receipt to lender clearance", sql: `SELECT requests.submittedAt AS start, deliveries.mockClearedAt AS finish
      FROM document_requests requests JOIN uwm_document_deliveries deliveries ON deliveries.requestId = requests.id` },
  ];
  const pilotMetrics = metrics.map(({ label, sql }) => {
    const result = db.prepare(`SELECT count(*) AS count, avg((unixepoch(finish) - unixepoch(start)) / 60.0) AS minutes
      FROM (${sql}) WHERE unixepoch(finish) >= unixepoch(start)`).get();
    return { label, count: Number(result?.count ?? 0), minutes: result?.minutes == null ? null : Number(result.minutes) };
  });
  const pilotMeasurements = db.prepare("SELECT * FROM pilot_measurements ORDER BY createdAt DESC, rowid DESC LIMIT 100")
    .all().map((item) => ({ ...item }) as unknown as PilotMeasurement);
  return { pilotScenario, pilotFeedback, pilotMetrics, pilotMeasurements };
}

export function trackPilotBorrower(db: Store, realtorId: string, contactId: string) {
  db.prepare(`INSERT INTO pilot_sample_contacts (contactId) SELECT ? WHERE EXISTS
    (SELECT 1 FROM pilot_scenario WHERE realtorId = ?)`).run(contactId, realtorId);
}

export function loadPilotScenario(db: Store, staff: WorkspaceStaff | null, input: unknown, owner: StaffIdentity): PilotMutation {
  const parsed = pilotScenarioInput.safeParse(input);
  if ((staff && (!staff.brokerage.pilot || staff.brokerage.role !== "Admin")) || !parsed.success || parsed.data.officerEmail !== owner.email) {
    return { error: "Select an active staff member in this pilot workspace." } as const;
  }
  const { id, previousId } = parsed.data;
  return db.transaction(() => {
    const previous = scenarioRow(db);
    if (previous?.id === id && previous.officerEmail === owner.email) return { message: "Pilot scenario is ready." };
    if ((previous?.id ?? null) !== previousId) return { error: "The scenario changed. Refresh the workspace before trying again." } as const;
    if (previous) {
      db.prepare(`DELETE FROM loans WHERE id = ? OR id = ? OR id IN
        (SELECT loanId FROM referral_leads WHERE realtorId = ? AND loanId IS NOT NULL)`).run(previous.loanId, `demo-rate:${previous.id}`, previous.realtorId);
      db.prepare("DELETE FROM referral_leads WHERE realtorId = ?").run(previous.realtorId);
      db.prepare("DELETE FROM realtor_portals WHERE realtorId = ?").run(previous.realtorId);
      db.exec(`DELETE FROM contacts WHERE id IN (SELECT contactId FROM pilot_sample_contacts)
        AND NOT EXISTS (SELECT 1 FROM loans WHERE loans.contactId = contacts.id OR loans.partnerId = contacts.id)
        AND NOT EXISTS (SELECT 1 FROM communication_drafts WHERE communication_drafts.contactId = contacts.id);
        DELETE FROM pilot_sample_contacts;`);
    }

    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const realtorId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const loanId = crypto.randomUUID();
    const rateContactId = crypto.randomUUID();
    const rateLoanId = `demo-rate:${id}`;
    const assignedEmail = staff ? owner.email : null;
    const officer = owner.name.slice(0, 160) || owner.email.slice(0, 160);
    insertContact(db, { id: realtorId, name: "Taylor Pilot Realtor", email: "taylor-pilot@example.test", phone: "", role: "Realtor" });
    insertContact(db, { id: contactId, name: "Morgan Pilot Borrower", email: "morgan-pilot@example.test", phone: "248-555-0141", role: "Borrower" });
    insertLoan(db, { id: loanId, contactId, partnerId: realtorId, officer, officerEmail: assignedEmail, address: "",
      amount: 0, purpose: "Purchase", stage: "Lead", stageSince: now });
    insertContact(db, { id: rateContactId, name: "Casey Pilot Past Client", email: "casey-pilot@example.test", phone: "", role: "Borrower" });
    insertLoan(db, { id: rateLoanId, contactId: rateContactId, partnerId: null, officer, officerEmail: assignedEmail,
      address: "24 Fictional Lane, Troy, MI 48084", amount: 305000, purpose: "Purchase", stage: "Funded", stageSince: now });
    const closingDate = easternDate(new Date(nowMs - 330 * day));
    db.prepare(`INSERT INTO past_client_profiles (loanId, closingDate, currentRate, targetRate, observedRate, watchEnabled, checkedAt, note)
      VALUES (?, ?, 6.750, 6.125, 6.375, 1, ?, 'Fictional client asked for a follow-up when rates improve.')`).run(rateLoanId, closingDate, now);
    db.prepare("INSERT INTO pilot_sample_contacts VALUES (?), (?), (?)").run(realtorId, contactId, rateContactId);
    db.prepare(`INSERT INTO realtor_portals (realtorId, token, expiresAt, officer, officerEmail) VALUES (?, ?, ?, ?, ?)`)
      .run(realtorId, portalToken(staff?.brokerage.id), new Date(nowMs + 7 * day).toISOString(), officer, assignedEmail);
    const leadId = crypto.randomUUID();
    db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt)
      VALUES (?, ?, ?, ?, ?, ?, 'Purchase', ?, ?, ?, ?)`).run(leadId, id, realtorId,
      "Riley Pilot Referral", "riley-pilot@example.test", "248-555-0142", officer, assignedEmail, now, new Date(nowMs + day).toISOString());
    startLeadFollowUp(db, leadId, now);
    synchronizeRetentionTasks(db, new Date(nowMs));
    db.prepare(`INSERT INTO pilot_scenario VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET id = excluded.id, realtorId = excluded.realtorId,
      loanId = excluded.loanId, loadedAt = excluded.loadedAt, officerEmail = excluded.officerEmail`)
      .run(id, realtorId, loanId, now, owner.email);
    accessEvent(db, staff, previous ? "Reset fictional pilot scenario" : "Loaded fictional pilot scenario", id, now);
    return { message: previous ? "Pilot scenario reset. Fresh sample records and links are ready." : "Pilot scenario is ready in My Tasks and the pipeline." };
  });
}

export function savePilotFeedback(db: Store, staff: WorkspaceStaff, input: unknown): PilotMutation {
  const parsed = pilotFeedbackInput.safeParse(input);
  if (!staff.brokerage.pilot || !parsed.success) return { error: "Choose a pilot step and enter feedback up to 1,000 characters." } as const;
  const { id, step, message } = parsed.data;
  return db.transaction(() => {
    const existing = db.prepare("SELECT author, step, message FROM pilot_feedback WHERE id = ?").get(id);
    if (existing && (existing.author !== staff.email || existing.step !== step || existing.message !== message)) {
      return { error: "Start a new feedback entry and try again." } as const;
    }
    if (!existing) db.prepare("INSERT INTO pilot_feedback (id, author, step, message, createdAt) VALUES (?, ?, ?, ?, ?)").run(id, staff.email, step, message, new Date().toISOString());
    return { message: "Feedback saved for the pilot admin." };
  });
}

export function triagePilotFeedback(db: Store, staff: WorkspaceStaff, input: unknown): PilotMutation {
  const parsed = pilotTriageInput.safeParse(input);
  if (!staff.brokerage.pilot || staff.brokerage.role !== "Admin" || !parsed.success) return { error: "Only a pilot admin can update feedback." };
  const { id, owner, status, priority, retest, revision } = parsed.data;
  if (status === "Closed" && !retest) return { error: "Record a retest result before closing this issue." };
  if (status !== "Open" && !owner) return { error: "Choose a staff owner before moving this issue forward." };
  return db.transaction(() => {
    const before = db.prepare("SELECT revision FROM pilot_feedback WHERE id = ?").get(id);
    if (!before || before.revision !== revision) return { error: "Feedback changed. Refresh Team before updating it." };
    db.prepare(`UPDATE pilot_feedback SET owner = ?, status = ?, priority = ?, retest = ?, revision = revision + 1
      WHERE id = ?`).run(owner, status, priority, retest, id);
    accessEvent(db, staff, `Updated pilot feedback · ${status}`, id, new Date().toISOString());
    return { message: "Pilot feedback updated." };
  });
}

export function recordPilotMeasurement(db: Store, staff: WorkspaceStaff, input: unknown): PilotMutation {
  const parsed = pilotMeasurementInput.safeParse(input);
  if (!staff.brokerage.pilot || staff.brokerage.role !== "Admin" || !parsed.success) return { error: "Check the walkthrough and measurement fields." };
  const { id, walkthrough, workflow, seconds, repeatEntries, systemSwitches } = parsed.data;
  return db.transaction(() => {
    const existing = db.prepare("SELECT 1 FROM pilot_measurements WHERE id = ?").get(id);
    if (!existing) {
      const now = new Date().toISOString();
      db.prepare("INSERT INTO pilot_measurements VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, walkthrough, workflow, seconds, repeatEntries, systemSwitches, now);
      accessEvent(db, staff, "Recorded pilot walkthrough measurement", id, now);
    }
    return { message: "Walkthrough measurement recorded." };
  });
}
