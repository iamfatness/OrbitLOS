import { z } from "zod";
import { pilotFeedbackStatuses, pilotPriorities, pilotSteps, pilotWalkthroughs, portalToken,
  type PilotBenchmark, type PilotFeedback, type PilotMeasurement, type PilotScenario } from "./brokerage-model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import { insertContact, insertLoan, type Store } from "./store";
import { easternDate, synchronizeRetentionTasks } from "./client-retention";
import { startLeadFollowUp } from "./lead-inbox";
import type { DemoGuideState } from "./brokerage-model";
import { accessEvent } from "./workspace-access";
import { applicationSteps, blankApplication, sampleApplication } from "./application-model";
import { addApplicationActivity, getApplication, saveApplicationVersion } from "./applications";
import { pilotSegmentLeadPrefix } from "./crm-segment-model";
import { beginCampaignAssignment, closeCampaignAssignment, recordCampaignFirstOutreach } from "./campaign-response";
import { stalledLoanCutoff } from "./loan-workflow";
import { currentReportMonth, priorReportPeriod, shiftReportDate } from "./report-date-range";

const day = 86_400_000;
const hour = 3_600_000;
const sampleCampaignName = (id: string) => `Fictional purchase follow-up · ${id.slice(0, 8)}`;
const presenterLoanIds = (scenarioId: string) => ({
  current: `demo-presenter:${scenarioId}:current`, previous: `demo-presenter:${scenarioId}:previous`, closing: `demo-presenter:${scenarioId}:closing`,
});
type PilotMutation = { message: string } | { error: string };
export const pilotScenarioInput = z.object({
  type: z.literal("loadPilotScenario"), id: z.uuid(), previousId: z.uuid().nullable(), officerEmail: z.email().max(254),
  presenter: z.boolean().default(false),
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
const pilotRunMetrics = {
  seconds: z.number().int().positive().max(86_400),
  repeatEntries: z.number().int().nonnegative().max(2000), systemSwitches: z.number().int().nonnegative().max(2000),
};
const optionalSeconds = z.number().int().nonnegative().max(86_400).optional();
const pilotBenchmarkRun = z.object({
  ...pilotRunMetrics,
  handling: z.object({
    ownerSeconds: optionalSeconds,
    officerSeconds: optionalSeconds,
    processorSeconds: optionalSeconds,
    waitingSeconds: optionalSeconds,
    staffHandoffs: z.number().int().nonnegative().max(2000).optional(),
  }).optional(),
});
const pilotMeasurementBase = z.object({
  type: z.literal("recordPilotMeasurement"), id: z.uuid(), walkthrough: z.enum(pilotWalkthroughs),
});
const pilotMeasurementInput = z.union([
  pilotMeasurementBase.extend({
    caseLabel: z.string().trim().min(2).max(80), orbit: pilotBenchmarkRun, baseline: pilotBenchmarkRun,
  }),
  pilotMeasurementBase.extend({
    workflow: z.enum(["Orbit", "Current brokerage workflow"]), ...pilotRunMetrics,
  }),
]);

function scenarioRow(db: Store) {
  return db.prepare("SELECT id, realtorId, loanId, loadedAt, officerEmail, presenter FROM pilot_scenario WHERE singleton = 1").get();
}

type ScenarioRow = NonNullable<ReturnType<typeof scenarioRow>>;
export type PilotPortalLink = { token: string; expiresAt: string };
export type ProtectPilotLinks = (links: PilotPortalLink[]) => Promise<boolean>;
const resetPortalLimit = 100;
const resetLoanScope = `id IN (?, ?, ?, ?, ?) OR id IN
  (SELECT loanId FROM referral_leads WHERE (realtorId = ? OR instr(requestId, ?) = 1) AND loanId IS NOT NULL)`;

function resetLoanArgs(scenario: ScenarioRow) {
  const id = String(scenario.id);
  const { current, previous, closing } = presenterLoanIds(id);
  return [current, previous, closing, scenario.loanId, `demo-rate:${id}`, scenario.realtorId, pilotSegmentLeadPrefix(id)];
}

function activeResetLinks(db: Store, scenario: ScenarioRow, now: string): PilotPortalLink[] {
  return db.prepare(`WITH resetLoans AS (SELECT id FROM loans WHERE ${resetLoanScope})
    SELECT token, expiresAt FROM applications WHERE revokedAt IS NULL AND expiresAt > ? AND loanId IN resetLoans
    UNION ALL SELECT token, expiresAt FROM joint_applications WHERE revokedAt IS NULL AND expiresAt > ? AND loanId IN resetLoans
    UNION ALL SELECT token, expiresAt FROM realtor_portals WHERE realtorId = ? AND expiresAt > ? LIMIT ?`)
    .all(...resetLoanArgs(scenario), now, now, scenario.realtorId, now, resetPortalLimit + 1)
    .map(({ token, expiresAt }) => ({ token: String(token), expiresAt: String(expiresAt) }));
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
    ? { id: String(row.id), loadedAt: String(row.loadedAt), officerEmail: String(row.officerEmail), presenter: Boolean(row.presenter) } : undefined;
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
  const pilotBenchmarks = db.prepare("SELECT * FROM pilot_benchmarks ORDER BY createdAt DESC, rowid DESC LIMIT 30").all().map((item): PilotBenchmark => ({
    id: String(item.id), walkthrough: item.walkthrough as PilotBenchmark["walkthrough"], caseLabel: String(item.caseLabel),
    orbit: JSON.parse(String(item.orbit)), baseline: JSON.parse(String(item.baseline)), createdAt: String(item.createdAt),
  }));
  return { pilotScenario, pilotFeedback, pilotMetrics, pilotMeasurements, pilotBenchmarks };
}

export function trackPilotBorrower(db: Store, realtorId: string, contactId: string) {
  db.prepare(`INSERT INTO pilot_sample_contacts (contactId) SELECT ? WHERE EXISTS
    (SELECT 1 FROM pilot_scenario WHERE realtorId = ?)`).run(contactId, realtorId);
}

function seedReviewedApplication(db: Store, { loanId, name, email, phone, amount, street, at, brokerageId }: {
  loanId: string; name: string; email: string; phone: string; amount: number; street: string; at: string; brokerageId?: string;
}) {
  const draft = { ...sampleApplication({ ...blankApplication(), borrowerName: name, email, phone, loanAmount: String(amount),
    propertyAddress: street, propertyLocation: { city: "Troy", state: "MI", zip: "48084", unit: "" } }), confirmedDemo: true };
  db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, step, revision, updatedAt, submittedAt, reviewedAt, revokedAt)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
    .run(loanId, portalToken(brokerageId), at, JSON.stringify(draft), applicationSteps.length - 1, at, at, at, at);
  const application = getApplication(db, loanId);
  if (application) saveApplicationVersion(db, application);
}

function seedPresenterFiles(db: Store, { id, realtorId, officer, officerEmail, clock, brokerageId }: {
  id: string; realtorId: string; officer: string; officerEmail: string | null; clock: Date; brokerageId?: string;
}) {
  const ids = presenterLoanIds(id);
  const today = easternDate(clock);
  const month = currentReportMonth(clock);
  const prior = priorReportPeriod(month);
  const now = clock.toISOString();
  const next = shiftReportDate(today, 3);
  const target = next < month.through ? next : month.through;
  const cases = [
    { id: ids.current, key: "avery", number: 54, name: "Avery Demo Funded", amount: 310_000, date: today, at: now, stage: "Funded" },
    { id: ids.previous, key: "jordan", number: 55, name: "Jordan Demo Funded", amount: 290_000, date: prior.through, at: `${prior.through}T17:00:00.000Z`, stage: "Funded" },
    { id: ids.closing, key: "quinn", number: 56, name: "Quinn Demo Closing", amount: 340_000, date: target, at: now, stage: "Processing" },
  ] as const;
  const addSampleContact = db.prepare("INSERT INTO pilot_sample_contacts VALUES (?)");
  for (const file of cases) {
    const contactId = crypto.randomUUID();
    const email = `${file.key}-demo@example.test`;
    const phone = `248-555-01${file.number}`;
    const street = `${file.number} Fictional Lane`;
    insertContact(db, { id: contactId, name: file.name, email, phone, role: "Borrower" });
    addSampleContact.run(contactId);
    insertLoan(db, { id: file.id, contactId, partnerId: realtorId, officer, officerEmail, address: `${street}, Troy, MI 48084`,
      amount: file.amount, purpose: "Purchase", stage: file.stage, stageSince: file.at, createdAt: file.at, leadSource: "Realtor referral" });
    seedReviewedApplication(db, { loanId: file.id, name: file.name, email, phone, amount: file.amount, street, at: file.at, brokerageId });
    if (file.stage === "Processing") {
      const dueOn = shiftReportDate(today, 1);
      db.prepare("INSERT INTO closing_plans (loanId, targetDate) VALUES (?, ?)").run(file.id, file.date);
      db.prepare("INSERT INTO closing_items (id, loanId, title, owner, dueDate) VALUES (?, ?, ?, ?, ?)")
        .run(`${file.id}:title`, file.id, "Confirm the sample title package", officer, dueOn);
      db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, dueOn)
        VALUES (?, ?, 'Homeowners insurance', ?, ?, ?)`)
        .run(crypto.randomUUID(), file.id, "Attach the fictional coverage evidence for the closing package.", now, dueOn);
      addApplicationActivity(db, file.id, `Document requested · Homeowners insurance · Due ${dueOn}`, now);
      continue;
    }
    db.prepare("INSERT INTO closing_progress (loanId, fundingDate, revision) VALUES (?, ?, 1)").run(file.id, file.date);
    db.prepare("INSERT INTO past_client_profiles (loanId, closingDate) VALUES (?, ?)").run(file.id, file.date);
    db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail,
      createdAt, dueAt, resolvedAt, loanId) VALUES (?, ?, ?, ?, ?, ?, 'Purchase', ?, ?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), file.id, realtorId, file.name, email, phone, officer, officerEmail, file.at, file.at, file.at, file.id);
  }
}

export async function loadProtectedPilotScenario(db: Store, staff: WorkspaceStaff | null, input: unknown, owner: StaffIdentity,
  protectLinks: ProtectPilotLinks | undefined, clock = new Date()): Promise<PilotMutation> {
  const parsed = pilotScenarioInput.safeParse(input);
  if (!protectLinks || !staff?.brokerage.pilot || staff.brokerage.role !== "Admin" || !parsed.success ||
    parsed.data.officerEmail !== owner.email || !parsed.data.previousId || parsed.data.id === parsed.data.previousId) {
    return loadPilotScenario(db, staff, input, owner, clock);
  }
  const scenario = scenarioRow(db);
  if (!scenario || scenario.id !== parsed.data.previousId) return loadPilotScenario(db, staff, input, owner, clock);
  const links = activeResetLinks(db, scenario, clock.toISOString());
  if (links.length > resetPortalLimit) return { error: "Revoke some active sample links before resetting this scenario." };
  if (links.length && !await protectLinks(links)) return { error: "Orbit could not protect the old links. Try resetting again." };
  return loadPilotScenario(db, staff, input, owner, clock, new Set(links.map(({ token }) => token)));
}

export function loadPilotScenario(db: Store, staff: WorkspaceStaff | null, input: unknown, owner: StaffIdentity, clock = new Date(),
  protectedTokens?: ReadonlySet<string>): PilotMutation {
  const parsed = pilotScenarioInput.safeParse(input);
  if ((staff && (!staff.brokerage.pilot || staff.brokerage.role !== "Admin")) || !parsed.success || parsed.data.officerEmail !== owner.email) {
    return { error: "Select an active staff member in this pilot workspace." } as const;
  }
  const { id, previousId, presenter } = parsed.data;
  return db.transaction(() => {
    const previous = scenarioRow(db);
    if (previous?.id === id) return previous.officerEmail === owner.email && Boolean(previous.presenter) === presenter
      ? { message: "Pilot scenario is ready." } : { error: "Start a new scenario request to change its setup." };
    if ((previous?.id ?? null) !== previousId) return { error: "The scenario changed. Refresh the workspace before trying again." } as const;
    if (previous) {
      if (protectedTokens && activeResetLinks(db, previous, clock.toISOString()).some(({ token }) => !protectedTokens.has(token))) {
        return { error: "A sample link changed during reset. Review the scenario and try again." } as const;
      }
      db.prepare("DELETE FROM outreach_opt_outs WHERE scenarioId = ?").run(previous.id);
      const returningLeadPrefix = pilotSegmentLeadPrefix(String(previous.id));
      db.prepare(`DELETE FROM loans WHERE ${resetLoanScope}`).run(...resetLoanArgs(previous));
      db.prepare("DELETE FROM referral_leads WHERE realtorId = ? OR instr(requestId, ?) = 1").run(previous.realtorId, returningLeadPrefix);
      db.prepare(`DELETE FROM call_campaigns WHERE id = ? AND name = ?
        AND NOT EXISTS (SELECT 1 FROM call_campaign_members WHERE campaignId = call_campaigns.id)`)
        .run(previous.id, sampleCampaignName(String(previous.id)));
      db.prepare("DELETE FROM realtor_portals WHERE realtorId = ?").run(previous.realtorId);
      db.exec(`DELETE FROM contacts WHERE id IN (SELECT contactId FROM pilot_sample_contacts)
        AND NOT EXISTS (SELECT 1 FROM loans WHERE loans.contactId = contacts.id OR loans.partnerId = contacts.id)
        AND NOT EXISTS (SELECT 1 FROM communication_drafts WHERE communication_drafts.contactId = contacts.id);
        DELETE FROM pilot_sample_contacts;`);
    }

    const nowMs = clock.getTime();
    const now = clock.toISOString();
    const realtorId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const loanId = crypto.randomUUID();
    const rateContactId = crypto.randomUUID();
    const rateLoanId = `demo-rate:${id}`;
    const rateBorrower = { id: rateContactId, name: "Casey Pilot Past Client", email: "casey-pilot@example.test", phone: "248-555-0143", role: "Borrower" as const };
    const historicalLeadAt = new Date(nowMs - 365 * day).toISOString();
    const historicalCallAt = new Date(nowMs - 365 * day + 20 * 60_000).toISOString();
    const historicalApplicationAt = new Date(nowMs - 362 * day).toISOString();
    const stalledAt = new Date(stalledLoanCutoff(nowMs) - 2 * day).toISOString();
    const closingDate = easternDate(new Date(nowMs - 330 * day));
    const assignedEmail = staff ? owner.email : null;
    const officer = owner.name.slice(0, 160) || owner.email.slice(0, 160);
    insertContact(db, { id: realtorId, name: "Taylor Pilot Realtor", email: "taylor-pilot@example.test", phone: "", role: "Realtor" });
    insertContact(db, { id: contactId, name: "Morgan Pilot Borrower", email: "morgan-pilot@example.test", phone: "248-555-0141", role: "Borrower" });
    insertLoan(db, { id: loanId, contactId, partnerId: realtorId, officer, officerEmail: assignedEmail, address: "",
      amount: 0, purpose: "Purchase", stage: "Lead", stageSince: stalledAt, createdAt: stalledAt });
    insertContact(db, rateBorrower);
    insertLoan(db, { id: rateLoanId, contactId: rateContactId, partnerId: realtorId, officer, officerEmail: assignedEmail,
      address: "24 Fictional Lane, Troy, MI 48084", amount: 305000, purpose: "Purchase", stage: "Funded",
      stageSince: new Date(nowMs - 330 * day).toISOString(), createdAt: historicalLeadAt });
    db.prepare(`INSERT INTO past_client_profiles (loanId, closingDate, currentRate, targetRate, observedRate, watchEnabled, checkedAt, note)
      VALUES (?, ?, 6.750, 6.125, 6.375, 1, ?, 'Fictional client asked for a follow-up when rates improve.')`).run(rateLoanId, closingDate, now);
    db.prepare("INSERT INTO pilot_sample_contacts VALUES (?), (?), (?)").run(realtorId, contactId, rateContactId);
    db.prepare(`INSERT INTO realtor_portals (realtorId, token, expiresAt, officer, officerEmail) VALUES (?, ?, ?, ?, ?)`)
      .run(realtorId, portalToken(staff?.brokerage.id), new Date(nowMs + 7 * day).toISOString(), officer, assignedEmail);
    const leadId = crypto.randomUUID();
    const referralAt = presenter ? new Date(nowMs - 3 * hour).toISOString() : now;
    const referralDue = new Date(nowMs + (presenter ? -hour : day)).toISOString();
    db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt)
      VALUES (?, ?, ?, ?, ?, ?, 'Purchase', ?, ?, ?, ?)`).run(leadId, id, realtorId,
      "Riley Pilot Referral", "riley-pilot@example.test", "248-555-0142", officer, assignedEmail, referralAt, referralDue);
    startLeadFollowUp(db, leadId, referralAt);

    const historicalLeadId = crypto.randomUUID();
    db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail,
      createdAt, dueAt, resolvedAt, loanId) VALUES (?, ?, ?, ?, ?, ?, 'Purchase', ?, ?, ?, ?, ?, ?)`)
      .run(historicalLeadId, `campaign-funded:${id}`, realtorId, rateBorrower.name, rateBorrower.email, rateBorrower.phone,
        officer, assignedEmail, historicalLeadAt, new Date(nowMs - 364 * day).toISOString(), historicalApplicationAt, rateLoanId);
    db.prepare("INSERT INTO call_campaigns (id, name, createdAt) VALUES (?, ?, ?)").run(id, sampleCampaignName(id), historicalLeadAt);
    db.prepare(`INSERT INTO call_campaign_members (leadId, campaignId, joinedAt, attempts, lastOutcome, reachedAt, firstCallAt)
      VALUES (?, ?, ?, 1, 'Connected', ?, ?), (?, ?, ?, 0, NULL, NULL, NULL)`)
      .run(historicalLeadId, id, historicalLeadAt, historicalCallAt, historicalCallAt, leadId, id, referralAt);
    beginCampaignAssignment(db, historicalLeadId, historicalLeadAt);
    recordCampaignFirstOutreach(db, historicalLeadId, historicalCallAt);
    closeCampaignAssignment(db, historicalLeadId, historicalApplicationAt);
    beginCampaignAssignment(db, leadId, referralAt);
    db.prepare(`INSERT INTO activity (id, loanId, text, createdAt, kind, outcome)
      VALUES (?, ?, 'Connected · Fictional purchase follow-up', ?, 'Call', 'Connected')`)
      .run(crypto.randomUUID(), rateLoanId, historicalCallAt);
    db.prepare("INSERT INTO closing_progress (loanId, fundingDate, revision) VALUES (?, ?, 1)").run(rateLoanId, closingDate);
    const brokerageId = staff?.brokerage.id;
    seedReviewedApplication(db, { loanId: rateLoanId, name: rateBorrower.name, email: rateBorrower.email, phone: rateBorrower.phone,
      amount: 305_000, street: "24 Fictional Lane", at: historicalApplicationAt, brokerageId });
    if (presenter) seedPresenterFiles(db, { id, realtorId, officer, officerEmail: assignedEmail, clock, brokerageId });
    synchronizeRetentionTasks(db, clock);
    db.prepare(`INSERT INTO pilot_scenario (singleton, id, realtorId, loanId, loadedAt, officerEmail, presenter) VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET id = excluded.id, realtorId = excluded.realtorId,
      loanId = excluded.loanId, loadedAt = excluded.loadedAt, officerEmail = excluded.officerEmail, presenter = excluded.presenter`)
      .run(id, realtorId, loanId, now, owner.email, Number(presenter));
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
  const measurement = parsed.data;
  const { id, walkthrough } = measurement;
  if ("caseLabel" in measurement && [measurement.orbit, measurement.baseline].some((run) => (run.handling?.waitingSeconds ?? 0) > run.seconds)) {
    return { error: "Waiting time must fit within the elapsed time for each run." };
  }
  return db.transaction(() => {
    if ("caseLabel" in measurement) {
      const { caseLabel, orbit, baseline } = measurement;
      const orbitJson = JSON.stringify(orbit);
      const baselineJson = JSON.stringify(baseline);
      const existing = db.prepare("SELECT walkthrough, caseLabel, orbit, baseline FROM pilot_benchmarks WHERE id = ?").get(id);
      if (existing) {
        return existing.walkthrough === walkthrough && existing.caseLabel === caseLabel && existing.orbit === orbitJson && existing.baseline === baselineJson
          ? { message: "Paired benchmark recorded." } : { error: "This benchmark was already recorded with different measurements." };
      }
      const now = new Date().toISOString();
      db.prepare("INSERT INTO pilot_benchmarks (id, walkthrough, caseLabel, orbit, baseline, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, walkthrough, caseLabel, orbitJson, baselineJson, now);
      accessEvent(db, staff, "Recorded paired pilot benchmark", id, now);
      return { message: "Paired benchmark recorded." };
    }
    const { workflow, seconds, repeatEntries, systemSwitches } = measurement;
    const existing = db.prepare("SELECT 1 FROM pilot_measurements WHERE id = ?").get(id);
    if (!existing) {
      const now = new Date().toISOString();
      db.prepare("INSERT INTO pilot_measurements VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, walkthrough, workflow, seconds, repeatEntries, systemSwitches, now);
      accessEvent(db, staff, "Recorded pilot walkthrough measurement", id, now);
    }
    return { message: "Walkthrough measurement recorded." };
  });
}
