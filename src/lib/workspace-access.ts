import { demoBrokerageId, type AccessEvent, type BrokerageMember } from "./brokerage-model";
import type { Workspace } from "./model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

export function scopeWorkspace(state: Workspace, staff: WorkspaceStaff | null): Workspace {
  if (!staff || staff.brokerage.role === "Admin") return state;
  const loans = state.loans.filter((loan) => loan.officerEmail === staff.email);
  const loanIds = new Set(loans.map((loan) => loan.id));
  const contacts = new Set(loans.flatMap((loan) => [loan.contactId, loan.partnerId]));
  if (staff.brokerage.role === "LO") {
    for (const contact of state.contacts) if (contact.addedBy === staff.email) contacts.add(contact.id);
  }
  const scoped = <T extends { loanId: string }>(items: T[]) => items.filter((item) => loanIds.has(item.loanId));
  const referralLeads = state.referralLeads.filter((lead) => staff.brokerage.role === "LO" && lead.officerEmail === staff.email).map((lead) => {
    const matches = lead.matches.filter((match) => contacts.has(match.id));
    return { ...lead, matches, restrictedMatch: matches.length !== lead.matches.length };
  });
  return { ...state, loans, contacts: state.contacts.filter((contact) => contacts.has(contact.id)), realtorPortals: [],
    referralLeads, unlinkedReferrals: [],
    submissions: scoped(state.submissions), activity: scoped(state.activity), tasks: scoped(state.tasks),
    communicationDrafts: scoped(state.communicationDrafts), pastClients: scoped(state.pastClients),
    closingPlans: scoped(state.closingPlans), closingItems: scoped(state.closingItems), applications: scoped(state.applications),
    closingProgress: scoped(state.closingProgress),
    documentRequests: scoped(state.documentRequests), pricingRuns: scoped(state.pricingRuns), publishedQuotes: scoped(state.publishedQuotes),
    sharedQuoteHistory: scoped(state.sharedQuoteHistory),
    mockUwmRates: scoped(state.mockUwmRates), mockCreditAusRuns: scoped(state.mockCreditAusRuns),
    uwmAlerts: scoped(state.uwmAlerts),
  };
}

export function accessEvent(db: Store, staff: StaffIdentity | null, action: string, subject: string, now: string) {
  db.prepare("INSERT INTO workspace_access_history VALUES (?, ?, ?, ?, ?)").run(crypto.randomUUID(), staff?.email ?? "Demo workspace", action, subject, now);
}

export function workspaceAccessHistory(db: Store): AccessEvent[] {
  return db.prepare("SELECT * FROM workspace_access_history ORDER BY createdAt DESC LIMIT 100").all()
    .map((row) => ({ ...row, subject: row.action === "Reassigned loan" && typeof row.subject === "string" && row.subject.includes(" → ")
      ? "Legacy loan assignment" : row.subject }) as unknown as AccessEvent);
}

export function assignLoan(db: Store, staff: WorkspaceStaff, target: { loanId: string; previousEmail: string | null; member: BrokerageMember }) {
  if (staff.brokerage.role !== "Admin" || target.member.status !== "Active") return { error: "Select an active staff member in this brokerage." };
  return db.transaction(() => {
    const { loanId, previousEmail, member } = target;
    const loan = db.prepare("SELECT officerEmail FROM loans WHERE id = ?").get(loanId);
    if (!loan) return { error: "This loan no longer exists." };
    if (loan.officerEmail !== member.email) {
      if (loan.officerEmail !== previousEmail) return { error: "The loan owner changed. Refresh the workspace before reassigning it." };
      const now = new Date().toISOString();
      db.prepare("UPDATE loans SET officer = ?, officerEmail = ? WHERE id = ?").run(member.name.slice(0, 160), member.email, loanId);
      accessEvent(db, staff, "Reassigned loan", loanId, now);
      db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), loanId, `Loan reassigned to ${member.name}.`, now);
    }
    return { message: "Loan reassigned. Open tasks now follow its new owner." };
  });
}

export function isDemoStaff(staff: WorkspaceStaff | null) {
  return !staff || staff.brokerage.id === demoBrokerageId;
}
