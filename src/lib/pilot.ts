import { z } from "zod";
import { pilotSteps, portalToken, type PilotFeedback, type PilotScenario } from "./brokerage-model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import { insertContact, insertLoan, type Store } from "./store";
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

function scenarioRow(db: Store) {
  return db.prepare("SELECT id, realtorId, loanId, loadedAt, officerEmail FROM pilot_scenario WHERE singleton = 1").get();
}

export function pilotReview(db: Store) {
  const row = scenarioRow(db);
  const pilotScenario: PilotScenario | undefined = row
    ? { id: String(row.id), loadedAt: String(row.loadedAt), officerEmail: String(row.officerEmail) } : undefined;
  const pilotFeedback = db.prepare("SELECT id, author, step, message, createdAt FROM pilot_feedback ORDER BY rowid DESC LIMIT 100")
    .all().map((item) => ({ ...item }) as unknown as PilotFeedback);
  return { pilotScenario, pilotFeedback };
}

export function trackPilotBorrower(db: Store, realtorId: string, contactId: string) {
  db.prepare(`INSERT INTO pilot_sample_contacts (contactId) SELECT ? WHERE EXISTS
    (SELECT 1 FROM pilot_scenario WHERE realtorId = ?)`).run(contactId, realtorId);
}

export function loadPilotScenario(db: Store, staff: WorkspaceStaff, input: unknown, owner: StaffIdentity): PilotMutation {
  const parsed = pilotScenarioInput.safeParse(input);
  if (!staff.brokerage.pilot || staff.brokerage.role !== "Admin" || !parsed.success || parsed.data.officerEmail !== owner.email) {
    return { error: "Select an active staff member in this pilot workspace." } as const;
  }
  const { id, previousId } = parsed.data;
  return db.transaction(() => {
    const previous = scenarioRow(db);
    if (previous?.id === id && previous.officerEmail === owner.email) return { message: "Pilot scenario is ready." };
    if ((previous?.id ?? null) !== previousId) return { error: "The scenario changed. Refresh Team before trying again." } as const;
    if (previous) {
      db.prepare(`DELETE FROM loans WHERE id = ? OR id IN
        (SELECT loanId FROM referral_leads WHERE realtorId = ? AND loanId IS NOT NULL)`).run(previous.loanId, previous.realtorId);
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
    const officer = owner.name.slice(0, 160) || owner.email.slice(0, 160);
    insertContact(db, { id: realtorId, name: "Taylor Pilot Realtor", email: "taylor-pilot@example.test", phone: "", role: "Realtor" });
    insertContact(db, { id: contactId, name: "Morgan Pilot Borrower", email: "morgan-pilot@example.test", phone: "248-555-0141", role: "Borrower" });
    insertLoan(db, { id: loanId, contactId, partnerId: realtorId, officer, officerEmail: owner.email, address: "",
      amount: 0, purpose: "Purchase", stage: "Lead", stageSince: now });
    db.prepare("INSERT INTO pilot_sample_contacts VALUES (?), (?)").run(realtorId, contactId);
    db.prepare(`INSERT INTO realtor_portals (realtorId, token, expiresAt, officer, officerEmail) VALUES (?, ?, ?, ?, ?)`)
      .run(realtorId, portalToken(staff.brokerage.id), new Date(nowMs + 7 * day).toISOString(), officer, owner.email);
    db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt)
      VALUES (?, ?, ?, ?, ?, ?, 'Purchase', ?, ?, ?, ?)`).run(crypto.randomUUID(), crypto.randomUUID(), realtorId,
      "Riley Pilot Referral", "riley-pilot@example.test", "248-555-0142", officer, owner.email, now, new Date(nowMs + day).toISOString());
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
    if (!existing) db.prepare("INSERT INTO pilot_feedback VALUES (?, ?, ?, ?, ?)").run(id, staff.email, step, message, new Date().toISOString());
    return { message: "Feedback saved for the pilot admin." };
  });
}
