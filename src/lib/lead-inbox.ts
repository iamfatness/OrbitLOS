import type { z } from "zod";
import { demoBrokerageId, portalToken } from "./brokerage-model";
import { defaultLeadRouting, leadSequenceSteps, quoteLeadInput, type LeadEvent, type LeadFollowUp, type LeadRouting,
  type assignInboxLeadInput, type leadContactInput, type leadSequenceInput, type saveLeadRoutingInput } from "./lead-inbox-model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

const hour = 3_600_000;
const after = (at: string, hours: number) => new Date(Date.parse(at) + hours * hour).toISOString();
type InboxAction = z.infer<typeof assignInboxLeadInput | typeof leadContactInput | typeof leadSequenceInput>;
type Outcome = { message: string } | { error: string };

export function leadRouting(db: Store): LeadRouting {
  const saved = db.prepare("SELECT value FROM settings WHERE key = 'leadRouting'").get();
  return saved ? JSON.parse(String(saved.value)) as LeadRouting : defaultLeadRouting;
}

export function changeLeadRouting(db: Store, staff: WorkspaceStaff | null, data: z.infer<typeof saveLeadRoutingInput>, members: StaffIdentity[]): Outcome {
  if (staff && staff.brokerage.role !== "Admin") return { error: "Only a brokerage admin can change lead routing." };
  const current = leadRouting(db);
  if (current.revision !== data.revision) return { error: "Routing changed. Refresh the inbox before saving." };
  const realtorOwner = data.realtorRoute === "Assigned officer" ? data.realtorOwner : null;
  if ((data.realtorRoute === "Assigned officer" && !realtorOwner) ||
      [data.websiteOwner, realtorOwner].some((email) => email && !members.some((member) => member.email === email))) {
    return { error: "Select an active loan officer or admin in this brokerage." };
  }
  const id = staff?.brokerage.id ?? demoBrokerageId;
  if (data.quoteForm === "Enable or replace" && id !== demoBrokerageId && !staff?.brokerage.pilot) {
    return { error: "The fictional quote form is available in pilot workspaces." };
  }
  const quoteToken = data.quoteForm === "Keep" ? current.quoteToken : data.quoteForm === "Disable" ? null : portalToken(id);
  const next: LeadRouting = {
    revision: current.revision + 1, websiteOwner: data.websiteOwner, realtorRoute: data.realtorRoute, realtorOwner,
    firstContactHours: data.firstContactHours, secondAfterHours: data.secondAfterHours, finalAfterHours: data.finalAfterHours, quoteToken,
  };
  db.prepare(`INSERT INTO settings (key, value) VALUES ('leadRouting', ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(next));
  return { message: "Lead routing and follow-up timing saved." };
}

type FollowUpRow = Omit<LeadFollowUp, "events">;
function followUpRow(db: Store, leadId: string): FollowUpRow {
  const row = db.prepare("SELECT status, revision, nextStep, nextAt, pausedAt, firstContactAt FROM lead_follow_up WHERE leadId = ?").get(leadId);
  return row ? row as unknown as FollowUpRow : { status: "Not started", revision: 0, nextStep: 0, nextAt: null, pausedAt: null, firstContactAt: null };
}

export function leadFollowUp(db: Store, leadId: string): LeadFollowUp {
  return { ...followUpRow(db, leadId), events: db.prepare("SELECT id, at, actor, kind, outcome, text FROM lead_events WHERE leadId = ? ORDER BY at DESC, rowid DESC")
    .all(leadId).map((row) => ({ ...row }) as unknown as LeadEvent) };
}

function leadEvent(db: Store, leadId: string, actor: string, at: string, text: string, kind: LeadEvent["kind"] = "Note", outcome: LeadEvent["outcome"] = null) {
  db.prepare("INSERT INTO lead_events (id, leadId, actor, at, kind, outcome, text) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), leadId, actor, at, kind, outcome, text);
}

export function firstContactDue(now: string, routing: LeadRouting) {
  return after(now, routing.firstContactHours);
}

export function startLeadFollowUp(db: Store, id: string, now: string) {
  db.prepare("INSERT INTO lead_follow_up (leadId, status, nextAt) VALUES (?, 'Active', ?)").run(id, now);
}

export function stopLeadFollowUp(db: Store, leadId: string) {
  db.prepare("UPDATE lead_follow_up SET status = 'Stopped', nextAt = NULL, pausedAt = NULL, revision = revision + 1 WHERE leadId = ? AND status IN ('Active','Paused')")
    .run(leadId);
}

export function carryLeadHistory(db: Store, leadId: string, loanId: string) {
  db.prepare(`INSERT INTO activity (id, loanId, text, createdAt, kind, outcome)
    SELECT id, ?, text || ' · ' || actor, at, kind, outcome FROM lead_events WHERE leadId = ?`).run(loanId, leadId);
  stopLeadFollowUp(db, leadId);
  return followUpRow(db, leadId).firstContactAt;
}

export function updateInboxLead(db: Store, staff: WorkspaceStaff | null, data: InboxAction, members: StaffIdentity[], now: string): Outcome {
  const lead = db.prepare("SELECT officerEmail, realtorId, resolvedAt FROM referral_leads WHERE id = ?").get(data.leadId);
  if (!lead || lead.resolvedAt || staff?.brokerage.role === "Processor") return { error: "This lead is no longer available." };
  const isOfficer = staff?.brokerage.role === "LO";
  const mayClaim = isOfficer && lead.realtorId === null && lead.officerEmail === null && data.type === "assignInboxLead" && data.email === staff.email;
  if (isOfficer && lead.officerEmail !== staff.email && !mayClaim) return { error: "This lead is outside your assigned work." };
  const actor = staff?.name || "Demo workspace";
  if (data.type === "assignInboxLead") {
    if (isOfficer && data.email !== staff.email) return { error: "A brokerage admin can reassign this lead." };
    const owner = isOfficer ? staff : members.find((member) => member.email === data.email);
    if (data.email && !owner) return { error: "Select an active loan officer or admin in this brokerage." };
    if (lead.officerEmail === data.email) return { message: "Lead assignment is up to date." };
    if (lead.officerEmail !== data.previousEmail) return { error: "The owner changed. Refresh the inbox before assigning." };
    db.prepare("UPDATE referral_leads SET officer = ?, officerEmail = ? WHERE id = ?")
      .run(owner?.name.slice(0, 160) ?? "", owner?.email ?? null, data.leadId);
    leadEvent(db, data.leadId, actor, now, owner ? `Assigned to ${owner.name}.` : "Returned to the shared inbox.");
    return { message: "Lead assignment saved." };
  }

  const row = followUpRow(db, data.leadId);
  if (row.revision !== data.revision) return { error: "This lead changed. Refresh the inbox before continuing." };
  const stop = () => { row.status = "Stopped"; row.nextAt = null; row.pausedAt = null; };
  let event: string;
  if (data.type === "leadContact") {
    row.firstContactAt ??= now;
    if (row.status !== "Completed" && (data.outcome === "Connected" || data.outcome === "Reply received")) stop();
    event = data.note ? `${data.outcome} · ${data.note}` : data.outcome;
  } else {
    switch (data.action) {
      case "Start":
        if (row.status !== "Not started") return { error: "This sequence has already started." };
        row.status = "Active";
        row.nextAt = now;
        event = "Started the mock lead follow-up sequence.";
        break;
      case "Pause":
        if (row.status !== "Active") return { error: "Only an active sequence can be paused." };
        row.status = "Paused";
        row.pausedAt = now;
        event = "Paused the mock sequence.";
        break;
      case "Resume":
        if (row.status !== "Paused" || !row.pausedAt || !row.nextAt) return { error: "Only a paused sequence can be resumed." };
        row.nextAt = new Date(Date.parse(now) + Math.max(0, Date.parse(row.nextAt) - Date.parse(row.pausedAt))).toISOString();
        row.pausedAt = null;
        row.status = "Active";
        event = "Resumed the mock sequence.";
        break;
      case "Stop":
        if (row.status !== "Active" && row.status !== "Paused") return { error: "This sequence has no scheduled steps." };
        stop();
        event = "Stopped the mock sequence.";
        break;
      case "Mock send": {
        const step = leadSequenceSteps[row.nextStep];
        if (row.status !== "Active" || !row.nextAt || row.nextAt > now || !step) return { error: "This mock step is not due." };
        event = `Mock delivery recorded · ${step.title}`;
        row.nextStep++;
        const timing = leadRouting(db);
        row.status = row.nextStep === leadSequenceSteps.length ? "Completed" : "Active";
        row.nextAt = row.status === "Completed" ? null : after(now, row.nextStep === 1 ? timing.secondAfterHours : timing.finalAfterHours);
        break;
      }
    }
  }
  db.prepare(`INSERT INTO lead_follow_up (leadId, status, revision, nextStep, nextAt, pausedAt, firstContactAt) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (leadId) DO UPDATE SET status = excluded.status, revision = excluded.revision, nextStep = excluded.nextStep,
    nextAt = excluded.nextAt, pausedAt = excluded.pausedAt, firstContactAt = excluded.firstContactAt`)
    .run(data.leadId, row.status, row.revision + 1, row.nextStep, row.nextAt, row.pausedAt, row.firstContactAt);
  leadEvent(db, data.leadId, actor, now, event, data.type === "leadContact" ? data.channel : "Note", data.type === "leadContact" ? data.outcome : null);
  return { message: event };
}

export function receiveQuoteLead(db: Store, input: unknown, routing: LeadRouting, owner: StaffIdentity | null, now = new Date().toISOString()) {
  const parsed = quoteLeadInput.safeParse(input);
  if (!parsed.success) return { status: 400, error: "Enter a name, an email or phone, a valid ZIP if provided, and permission to follow up." };
  const data = parsed.data;
  return db.transaction(() => {
    const current = leadRouting(db);
    if (!current.quoteToken || data.token !== current.quoteToken) return { status: 404, error: "This quote request link is unavailable." };
    if (current.revision !== routing.revision) return { status: 409, error: "Routing changed. Submit your request again." };
    if (db.prepare("SELECT 1 FROM referral_leads WHERE realtorId IS NULL AND requestId = ?").get(data.requestId)) return { value: { received: true } };
    const count = db.prepare("SELECT count(*) AS total FROM referral_leads WHERE realtorId IS NULL AND createdAt > ?").get(after(now, -1));
    if (Number(count?.total) >= 30) return { status: 429, error: "This form has reached its hourly limit. Try again later." };
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, zip)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, data.requestId, data.name, data.email, data.phone, data.purpose, owner?.name.slice(0, 160) ?? "", owner?.email ?? null, now,
        firstContactDue(now, current), data.zip);
    startLeadFollowUp(db, id, now);
    leadEvent(db, id, "Quote form", now, "Requested follow-up about this quote.");
    return { value: { received: true } };
  });
}
